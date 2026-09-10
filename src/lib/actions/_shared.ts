// Hjelpere som brukes av flere av action-modulene i denne mappen.
// Ingen "use server" her: filen eksporterer også konstanter og
// synkrone funksjoner, og en "use server"-fil kan kun eksportere
// async-funksjoner. Modulene som importerer herfra har direktivet.

import { randomUUID } from "crypto";
import {
  putObject,
  decodeDataUrl,
  extensionFor } from "@/lib/objectStorage";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  people,
  companyPeople,
  dealLines,
  dealOwners,
  notifications } from "@/lib/db";

// Standard oppfølgingsdato for nyopprettede deals — dagens dato, samme
// klokkeslett-konvensjon som datofelter ellers bruker ("${dateStr}T09:00:00").
export function todayFollowUpDate() {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

// Fornavnet brukt i aktivitetsmeldinger om vunnet/tapt deals — samme idé som
// hilsenen på oversikten, som også bare bruker fornavnet.
export function firstName(fullName: string) {
  return fullName.split(" ")[0];
}

// "Odd-Erik" / "Odd-Erik og Anita" / "Odd-Erik, TK og Anita".
export function formatNameList(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length === 0) return "Noen";
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} og ${unique[unique.length - 1]}`;
}

// Fornavnene til alle som er tagget på en deal (hovedeier + med-eiere) —
// brukt i vunnet-/tapt-meldingene i aktivitetsloggen.
export async function taggedNames(dealId: number, ownerId: number | null): Promise<string[]> {
  const [owner, coOwnerRows] = await Promise.all([
    ownerId == null ? null : db.query.users.findFirst({ where: eq(users.id, ownerId) }),
    db
      .select({ name: users.name })
      .from(dealOwners)
      .innerJoin(users, eq(dealOwners.userId, users.id))
      .where(eq(dealOwners.dealId, dealId)),
  ]);
  const names = [owner?.name, ...coOwnerRows.map((r) => r.name)].filter(
    (n): n is string => !!n
  );
  return names.map(firstName);
}

// Samme som taggedNames + selskapsnavn, men for en HEL gruppe deals i tre
// batchede spørringer i stedet for taggedNames + et selskapsoppslag per deal
// — brukt i bulkMarkDealsLost/bulkSetDealStage sine vunnet-/tapt-meldinger,
// som ellers gjorde 3 runder per deal.
export async function bulkDealMessageContext(
  targetDeals: { id: number; companyId: number; ownerId: number | null }[]
): Promise<{
  companyNameById: Map<number, string>;
  namesFor: (deal: { id: number; ownerId: number | null }) => string[];
}> {
  const companyIds = [...new Set(targetDeals.map((d) => d.companyId))];
  const ownerIds = [
    ...new Set(targetDeals.map((d) => d.ownerId).filter((id): id is number => id != null)),
  ];
  const dealIds = targetDeals.map((d) => d.id);

  const [companyRows, ownerRows, coOwnerRows] = await Promise.all([
    companyIds.length
      ? db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([]),
    ownerIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds))
      : Promise.resolve([]),
    db
      .select({ dealId: dealOwners.dealId, name: users.name })
      .from(dealOwners)
      .innerJoin(users, eq(dealOwners.userId, users.id))
      .where(inArray(dealOwners.dealId, dealIds)),
  ]);

  const companyNameById = new Map(companyRows.map((c) => [c.id, c.name]));
  const ownerNameById = new Map(ownerRows.map((u) => [u.id, u.name]));
  const coOwnerNamesByDeal = new Map<number, string[]>();
  for (const r of coOwnerRows) {
    const list = coOwnerNamesByDeal.get(r.dealId) ?? [];
    list.push(r.name);
    coOwnerNamesByDeal.set(r.dealId, list);
  }

  function namesFor(deal: { id: number; ownerId: number | null }): string[] {
    const owner = deal.ownerId != null ? ownerNameById.get(deal.ownerId) : undefined;
    const names = [owner, ...(coOwnerNamesByDeal.get(deal.id) ?? [])].filter(
      (n): n is string => !!n
    );
    return names.map(firstName);
  }

  return { companyNameById, namesFor };
}

export function revalidateDealViews(dealId?: number) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/[slug]", "page");
  revalidatePath("/companies");
  revalidatePath("/companies/[id]", "page");
  if (dealId) revalidatePath(`/leads/${dealId}`);
}

// Lettere variant for endringer som kun vises på selve deal-siden og i
// Pipeline-lista (deal-tagger) — verken dashboardet eller selskapssiden
// viser deal-tagger noe sted, så de trenger ikke revalideres her. Bruk
// revalidateDealViews() for alt som KAN vises andre steder (f.eks.
// followUpAt/comment/kontaktlogg, som selskapssiden viser direkte).
export function revalidateDealTagViews(dealId?: number) {
  revalidatePath("/leads");
  revalidatePath("/leads/[slug]", "page");
  if (dealId) revalidatePath(`/leads/${dealId}`);
}

// Admin kan endre bilde på hvem som helst; alle andre kan bare endre sitt eget.
// Grensen matcher klientens 1,5 MB-sjekk (AvatarUpload/CompanyLogoUpload),
// med litt margin for base64-overhead (~33 %) — klientsjekken alene stopper
// ikke noen som kaller server-handlingen direkte med et større bilde.
export const MAX_IMAGE_DATA_URL_LENGTH = 2.1 * 1024 * 1024;

// Tar imot en data-URL fra klienten (allerede nedskalert i nettleseren, se
// src/lib/downscaleImage.ts), legger bildet i R2 og gir tilbake nøkkelen og
// URL-en det skal serveres på. Selve bytene skal ALDRI i databasen — det var
// dét som gjorde appen treg.
//
// Det tilfeldige leddet i nøkkelen gjør at et nytt bilde alltid får en ny
// URL (så nettleseren ikke viser det gamle), og at nøklene ikke kan gjettes.
export async function storeUploadedImage(
  dataUrl: string,
  prefix: string
): Promise<{ key: string; url: string } | null> {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const key = `${prefix}/${randomUUID()}.${extensionFor(decoded.contentType)}`;
  await putObject(key, decoded.body, decoded.contentType);
  return { key, url: `/api/media/${key}` };
}

export async function notifyDealOwnerAssigned(actorId: number, dealId: number, newOwnerUserId: number) {
  if (newOwnerUserId === actorId) return;
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return;
  await db.insert(notifications).values({
    userId: newOwnerUserId,
    actorUserId: actorId,
    dealId,
    companyId: deal.companyId,
  });
}

export async function notifyCompanyOwnerAssigned(actorId: number, companyId: number, newOwnerUserId: number) {
  if (newOwnerUserId === actorId) return;
  await db.insert(notifications).values({
    userId: newOwnerUserId,
    actorUserId: actorId,
    companyId,
  });
}

export function lineMultiplier(line: { billingType: string; months: number | null }): number {
  return line.billingType === "recurring" ? Math.max(1, line.months ?? 1) : 1;
}

export async function recalcDealValue(dealId: number) {
  const lines = await db.query.dealLines.findMany({
    where: eq(dealLines.dealId, dealId),
  });
  const total =
    lines.length === 0
      ? null
      : Math.round(lines.reduce((acc, l) => acc + l.hours * l.rate * lineMultiplier(l), 0));
  await db
    .update(deals)
    .set({ value: total, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
}

// Finner personen på e-post eller oppretter den, og knytter den til selskapet.
export async function linkPersonByEmail(
  companyId: number,
  email: string | null,
  name: string,
  phone: string | null = null,
  role: string | null = null
): Promise<number> {
  let person = email
    ? await db.query.people.findFirst({ where: eq(people.email, email) })
    : undefined;

  if (!person) {
    [person] = await db.insert(people).values({ name, email, phone }).returning();
  } else if (phone && !person.phone) {
    await db.update(people).set({ phone }).where(eq(people.id, person.id));
  }

  await db
    .insert(companyPeople)
    .values({ companyId, personId: person.id, role })
    .onConflictDoNothing();

  return person.id;
}
