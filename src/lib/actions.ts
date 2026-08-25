"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  people,
  companyPeople,
  activities,
  contactEvents,
  emailAccounts,
  emailMessages,
  emailAccessGrants,
  dealLines,
  referenceProjects,
  dealOwners,
  companyOwners,
  savedViews,
  pipelines,
  stages,
  businessUnits,
  calendarAccounts,
  lostReasons,
  tags,
  dealTags,
  personTags,
} from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { perEmailLoginLimiter, perIpLoginLimiter } from "@/lib/rateLimit";
import { encrypt, decrypt } from "@/lib/crypto";
import {
  isGoogleCalendarConfigured,
  buildGoogleAuthUrl,
  refreshAccessToken,
  fetchCalendarEvents,
  signCalendarState,
} from "@/lib/googleCalendar";
import { domainFromEmail, enrichFromEmail, fallbackNameFromDomain } from "@/lib/enrich";
import {
  fetchBrregCompany,
  matchBrregCompany,
  searchBrreg,
  normalizeName,
  type BrregHit,
} from "@/lib/brreg";
import { getStages, getDefaultStageId } from "@/lib/stages.server";
import { getDefaultPipelineId } from "@/lib/pipelines.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { slugify } from "@/lib/slugify";
import { firstStageId } from "@/lib/stages";
import { syncAccount } from "@/lib/imap";
import { scanWebsite, type SiteScanResult } from "@/lib/siteScan";
import { PHASES } from "@/lib/estimator";
import * as companyInsight from "@/lib/companyInsight";
import { generateQuotePdf } from "@/lib/pdf";
import { sendMailFromAccount } from "@/lib/mailer";
import { formatDateShort, formatMoney } from "@/lib/format";

// ---------- Lagrede visninger (Pipeline) ----------
// Navngitte, delbare filterkombinasjoner — delt/team-synlig, ingen
// per-bruker-privatliste. Se PipelineView.tsx for hvordan feltene brukes.

export interface SavedViewFilters {
  view: string | null;
  search: string | null;
  pipelineId: number | null;
  ownerId: number | null;
  businessUnitId: number | null;
  tagId: number | null;
  datePreset: string | null;
  fromDate: string | null;
  toDate: string | null;
  activeDays: number | null;
  groupByStage: boolean | null;
}

export interface SavedViewRow extends SavedViewFilters {
  id: number;
  slug: string;
  name: string;
  createdByName: string | null;
}

export async function createSavedView(
  name: string,
  filters: SavedViewFilters
): Promise<{ ok: boolean; message: string; slug?: string }> {
  const me = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Gi visningen et navn." };

  const base = slugify(trimmed) || "visning";
  const existingSlugs = new Set((await db.query.savedViews.findMany()).map((v) => v.slug));
  let slug = base;
  let n = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${n}`;
    n++;
  }

  await db.insert(savedViews).values({
    slug,
    name: trimmed,
    createdByUserId: me.id,
    ...filters,
  });

  return { ok: true, message: "Visning lagret.", slug };
}

export async function listSavedViews(): Promise<SavedViewRow[]> {
  await requireUser();
  const rows = await db.query.savedViews.findMany({ orderBy: [desc(savedViews.createdAt)] });
  const userIds = [
    ...new Set(rows.map((r) => r.createdByUserId).filter((id): id is number => id != null)),
  ];
  const userRows = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdByName: r.createdByUserId != null ? (nameById.get(r.createdByUserId) ?? null) : null,
    view: r.view,
    search: r.search,
    pipelineId: r.pipelineId,
    ownerId: r.ownerId,
    businessUnitId: r.businessUnitId,
    tagId: r.tagId,
    datePreset: r.datePreset,
    fromDate: r.fromDate,
    toDate: r.toDate,
    activeDays: r.activeDays,
    groupByStage: r.groupByStage,
  }));
}

export async function deleteSavedView(id: number): Promise<void> {
  await requireUser();
  await db.delete(savedViews).where(eq(savedViews.id, id));
}

// Standard oppfølgingsdato for nyopprettede deals — dagens dato, samme
// klokkeslett-konvensjon som datofelter ellers bruker ("${dateStr}T09:00:00").
function todayFollowUpDate() {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

// Fornavnet brukt i aktivitetsmeldinger om vunnet/tapt deals — samme idé som
// hilsenen på oversikten, som også bare bruker fornavnet.
function firstName(fullName: string) {
  return fullName.split(" ")[0];
}

// "Odd-Erik" / "Odd-Erik og Anita" / "Odd-Erik, TK og Anita".
function formatNameList(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length === 0) return "Noen";
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} og ${unique[unique.length - 1]}`;
}

// Fornavnene til alle som er tagget på en deal (hovedeier + med-eiere) —
// brukt i vunnet-/tapt-meldingene i aktivitetsloggen.
async function taggedNames(dealId: number, ownerId: number | null): Promise<string[]> {
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

function revalidateDealViews(dealId?: number) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/[slug]", "page");
  revalidatePath("/companies");
  revalidatePath("/companies/[id]", "page");
  revalidatePath("/people");
  if (dealId) revalidatePath(`/leads/${dealId}`);
}

// ---------- Auth ----------

export async function setupFirstUser(formData: FormData) {
  const existing = await db.query.users.findFirst();
  if (existing) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || password.length < 8) {
    redirect("/login?error=setup");
  }
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 12), isAdmin: true })
    .returning();
  await createSession(user.id);
  redirect("/");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (perEmailLoginLimiter.isLocked(email) || perIpLoginLimiter.isLocked(ip)) {
    redirect("/login?error=locked");
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    perEmailLoginLimiter.recordFailure(email);
    perIpLoginLimiter.recordFailure(ip);
    redirect("/login?error=1");
  }
  perEmailLoginLimiter.recordSuccess(email);
  perIpLoginLimiter.recordSuccess(ip);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function addUser(formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan legge til brukere");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || password.length < 8) {
    redirect("/settings?error=bruker");
  }
  const rawBusinessUnitId = String(formData.get("businessUnitId") ?? "");
  const businessUnitId = rawBusinessUnitId ? Number(rawBusinessUnitId) : null;
  await db.insert(users).values({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    businessUnitId: businessUnitId && businessUnitId > 0 ? businessUnitId : null,
  });
  revalidatePath("/settings");
}

// Admin kan endre navn på hvem som helst; alle andre kan bare endre sitt eget
// — samme tilgangsmønster som updateAvatar.
export async function updateUserName(userId: number, formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin && me.id !== userId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.update(users).set({ name }).where(eq(users.id, userId));
  revalidatePath("/settings");
  revalidateDealViews();
}

// Admin kan endre bilde på hvem som helst; alle andre kan bare endre sitt eget.
export async function updateAvatar(userId: number, formData: FormData) {
  const me = await requireUser();
  if (me.id !== userId && !me.isAdmin) return;
  const avatar = String(formData.get("avatar") ?? "");
  if (!avatar.startsWith("data:image/")) return;
  await db.update(users).set({ avatarDataUrl: avatar }).where(eq(users.id, userId));
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

// Kan ikke endre egen admin-status — unngår å låse seg selv ute ved en feilklikk.
export async function setUserAdmin(userId: number, isAdmin: boolean) {
  const me = await requireUser();
  if (!me.isAdmin || userId === me.id) return;
  await db.update(users).set({ isAdmin }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

export async function setUserBusinessUnit(userId: number, businessUnitId: number | null) {
  const me = await requireUser();
  if (!me.isAdmin) return;
  await db.update(users).set({ businessUnitId }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

// ---------- Egne selskap (business units) ----------

export async function createBusinessUnit(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return null;
  const existing = await db.query.businessUnits.findMany({
    orderBy: [asc(businessUnits.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [unit] = await db
    .insert(businessUnits)
    .values({ name, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return unit;
}

export async function updateBusinessUnit(id: number, formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.update(businessUnits).set({ name }).where(eq(businessUnits.id, id));
  revalidatePath("/settings");
}

export async function deleteBusinessUnit(
  id: number
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const usedByUser = await db.query.users.findFirst({
    where: eq(users.businessUnitId, id),
  });
  if (usedByUser) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt brukerne til et annet selskap først.",
    };
  }
  const usedByCompany = await db.query.companies.findFirst({
    where: eq(companies.businessUnitId, id),
  });
  if (usedByCompany) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt kundene til et annet selskap først.",
    };
  }
  await db.delete(businessUnits).where(eq(businessUnits.id, id));
  revalidatePath("/settings");
  return { ok: true, message: "Selskapet ble slettet." };
}

export async function bulkSetCompanyBusinessUnit(
  companyIds: number[],
  businessUnitId: number | null
) {
  await requireUser();
  if (companyIds.length === 0) return;
  await db
    .update(companies)
    .set({ businessUnitId })
    .where(inArray(companies.id, companyIds));
  revalidateDealViews();
}

export async function setUserPassword(
  userId: number,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan sette passord for andre");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { ok: false, message: "Passordet må være minst 8 tegn." };
  }
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12) })
    .where(eq(users.id, userId));
  return { ok: true, message: "Passordet ble oppdatert." };
}

// Blokkerer sletting dersom brukeren fortsatt eier data — samme mønster som
// deleteStage — for å unngå å bryte NOT NULL-fremmednøkler (foreign_keys=ON).
export async function deleteUser(
  userId: number
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan slette brukere");
  if (userId === me.id) {
    return { ok: false, message: "Du kan ikke slette deg selv." };
  }
  const ownsDeals = await db.query.deals.findFirst({ where: eq(deals.ownerId, userId) });
  if (ownsDeals) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren eier deals. Overfør dem til en annen bruker først.",
    };
  }
  const coOwns = await db.query.dealOwners.findFirst({ where: eq(dealOwners.userId, userId) });
  if (coOwns) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren er med-eier på en eller flere deals.",
    };
  }
  const hasEmail = await db.query.emailAccounts.findFirst({ where: eq(emailAccounts.userId, userId) });
  if (hasEmail) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har en e-postkonto koblet til. Fjern den først.",
    };
  }
  const hasCalendar = await db.query.calendarAccounts.findFirst({
    where: eq(calendarAccounts.userId, userId),
  });
  if (hasCalendar) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har en kalenderkonto koblet til. Fjern den først.",
    };
  }
  const hasAccessGrant = await db.query.emailAccessGrants.findFirst({
    where: or(
      eq(emailAccessGrants.ownerUserId, userId),
      eq(emailAccessGrants.granteeUserId, userId)
    ),
  });
  if (hasAccessGrant) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har innsynsforespørsler koblet til seg.",
    };
  }
  await db.update(contactEvents).set({ userId: null }).where(eq(contactEvents.userId, userId));
  await db.update(activities).set({ userId: null }).where(eq(activities.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/settings");
  return { ok: true, message: "Brukeren ble slettet." };
}

// ---------- Deals ----------

// Finner selskapet ut fra e-postdomene, eller fra personen hvis adressen er privat.
async function findCompanyByEmail(email: string) {
  const domain = domainFromEmail(email);
  if (domain) {
    const byDomain = await db.query.companies.findFirst({
      where: eq(companies.domain, domain),
    });
    if (byDomain) return byDomain;
  }
  const person = await db.query.people.findFirst({ where: eq(people.email, email) });
  if (!person) return undefined;
  const link = await db.query.companyPeople.findFirst({
    where: eq(companyPeople.personId, person.id),
  });
  if (!link) return undefined;
  return db.query.companies.findFirst({ where: eq(companies.id, link.companyId) });
}

// Ny deal. Selskapet kommer fra ett av tre steder, i denne rekkefølgen:
// et valgt companyId, et nytt selskapsnavn, eller utledet fra kontaktens e-post.
export async function createDeal(formData: FormData) {
  const me = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const dealTitle = String(formData.get("dealTitle") ?? "").trim();
  const companyIdRaw = String(formData.get("companyId") ?? "").trim();
  const newCompanyName = String(formData.get("companyName") ?? "").trim();
  const orgNumber = String(formData.get("orgNumber") ?? "").replace(/\D/g, "");
  const pipelineIdRaw = Number(formData.get("pipelineId"));
  const pipelineId = Number.isFinite(pipelineIdRaw) && pipelineIdRaw > 0
    ? pipelineIdRaw
    : await getDefaultPipelineId();

  const chosenId = Number(companyIdRaw);
  let company =
    companyIdRaw && Number.isFinite(chosenId)
      ? await db.query.companies.findFirst({ where: eq(companies.id, chosenId) })
      : undefined;

  if (!company && !newCompanyName && !email) {
    redirect("/leads?error=selskap");
  }

  // Ingen valgt: prøv å finne selskapet ut fra e-posten før vi lager nytt.
  if (!company && email.includes("@")) {
    company = await findCompanyByEmail(email);
  }

  if (!company) {
    const enriched = email.includes("@")
      ? await enrichFromEmail(email)
      : { companyName: "", website: null, logoUrl: null, domain: null };
    const name =
      newCompanyName ||
      enriched.companyName ||
      contactName ||
      fallbackNameFromDomain(email.split("@")[0] || "Ukjent");
    [company] = await db
      .insert(companies)
      .values({
        name,
        domain: enriched.domain,
        website: enriched.website,
        logoUrl: enriched.logoUrl,
        orgNumber: orgNumber.length === 9 ? orgNumber : null,
      })
      .returning();

    // Oppgitt orgnummer går rett inn; ellers prøver vi å finne selskapet selv.
    if (orgNumber.length === 9) {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
    } else {
      await autoMatchCompany(company.id);
    }
  }

  if (email.includes("@")) {
    await linkPersonByEmail(company.id, email, contactName || email.split("@")[0]);
  } else if (contactName) {
    await linkPersonByEmail(company.id, null, contactName);
  }

  const [deal] = await db
    .insert(deals)
    .values({
      companyId: company.id,
      title: dealTitle || "Ny deal",
      ownerId: me.id,
      stage: await getDefaultStageId(pipelineId),
      followUpAt: todayFollowUpDate(),
    })
    .returning();

  await db.insert(activities).values({
    dealId: deal.id,
    userId: me.id,
    type: "created",
    content: email ? `Deal opprettet fra ${email}` : "Deal opprettet",
  });

  revalidateDealViews(deal.id);
  const slug = (await getDealSlugMap()).get(deal.id) ?? deal.id;
  redirect(`/leads/${slug}`);
}

// Ny deal rett på et kjent selskap (fra selskapssiden).
export async function createDealForCompany(companyId: number, formData: FormData) {
  const me = await requireUser();
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company) redirect("/companies");

  const title = String(formData.get("dealTitle") ?? "").trim() || "Ny deal";
  const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
  const dateStr = String(formData.get("followUpAt") ?? "");
  const pipelineIdRaw = Number(formData.get("pipelineId"));
  const pipelineId = Number.isFinite(pipelineIdRaw) && pipelineIdRaw > 0
    ? pipelineIdRaw
    : await getDefaultPipelineId();

  const [deal] = await db
    .insert(deals)
    .values({
      companyId,
      title,
      ownerId: me.id,
      stage: await getDefaultStageId(pipelineId),
      value: valueRaw ? Number(valueRaw) : null,
      followUpAt: dateStr ? new Date(`${dateStr}T09:00:00`) : null,
    })
    .returning();

  await db.insert(activities).values({
    dealId: deal.id,
    userId: me.id,
    type: "created",
    content: `Deal opprettet på ${company.name}`,
  });

  revalidateDealViews(deal.id);
  const slug = (await getDealSlugMap()).get(deal.id) ?? deal.id;
  redirect(`/leads/${slug}`);
}

export interface DealCompanyMatch {
  id: number;
  name: string;
  orgNumber: string | null;
}

export interface DealCompanyPreviewRow {
  input: string;
  matches: DealCompanyMatch[];
}

// Fjerner en avsluttende parentes ("Firma (notat)") før matching — det er
// tydelig en kommentar fra den som limte inn listen, ikke del av navnet.
function stripTrailingAnnotation(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Fritt søk i vår egen selskapsdatabase — brukes når forslagene i
// previewBulkDealCompanies bommer helt (f.eks. et akronym som "NMF" for
// "Norges Musikkorps Forbund", som normaliseringen ikke fanger opp), slik
// at man kan finne og velge riktig selskap manuelt i stedet for å opprette
// en duplikat.
export async function searchCompaniesAction(query: string): Promise<DealCompanyMatch[]> {
  await requireUser();
  const q = query.trim();
  if (q.length < 2) return [];
  const needle = `%${q}%`;
  const rows = await db
    .select({ id: companies.id, name: companies.name, orgNumber: companies.orgNumber })
    .from(companies)
    .where(
      or(
        like(companies.name, needle),
        like(companies.orgName, needle),
        like(companies.orgNumber, needle)
      )
    )
    .orderBy(asc(companies.name))
    .limit(8);
  return rows;
}

// Foreslår hvilket eksisterende selskap hvert navn i en limt inn liste mest
// sannsynlig tilsvarer — brukes til å unngå duplikater ved bulk-opprettelse
// av deals (se bulkCreateDealsForCompanies). Bruker samme normalisering som
// Brreg-matchingen (fjerner AS/ASA/tegnsetting), ikke bare eksakt tekstlikhet
// slik CSV-importen gjør, nettopp for å fange opp "Framo" vs. "Framo AS".
export async function previewBulkDealCompanies(
  names: string[]
): Promise<DealCompanyPreviewRow[]> {
  await requireUser();
  const rows = await db.query.companies.findMany({ orderBy: [asc(companies.name)] });

  return names.map((raw) => {
    const input = stripTrailingAnnotation(raw);
    const normInput = normalizeName(input);
    if (!normInput) return { input, matches: [] };

    const matches = rows
      .map((c) => {
        const normName = normalizeName(c.name);
        let score = -1;
        if (normName === normInput) score = 100;
        else if (normName.includes(normInput) || normInput.includes(normName)) {
          score = 50 - Math.abs(normName.length - normInput.length);
        }
        return { c, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => ({ id: x.c.id, name: x.c.name, orgNumber: x.c.orgNumber }));

    return { input, matches };
  });
}

export interface BulkDealItem {
  name: string;
  companyId: number | null; // null = opprett nytt selskap med dette navnet
}

// Oppretter én deal per rad — på et eksisterende selskap hvis valgt, ellers
// et nytt med akkurat det navnet raden hadde. Med-eiere legges til som
// dealOwners i tillegg til hovedeieren, samme mønster som addDealOwner.
export async function bulkCreateDealsForCompanies(
  items: BulkDealItem[],
  title: string,
  ownerId: number,
  coOwnerIds: number[],
  followUpAt: string, // yyyy-mm-dd, tom streng = ingen dato
  pipelineId: number
): Promise<{ created: number; companiesCreated: number }> {
  const me = await requireUser();
  const dealTitle = title.trim() || "Deal";
  const followUp = /^\d{4}-\d{2}-\d{2}$/.test(followUpAt)
    ? new Date(`${followUpAt}T09:00:00`)
    : null;
  const defaultStageId = await getDefaultStageId(pipelineId);

  let created = 0;
  let companiesCreated = 0;

  for (const item of items) {
    const name = stripTrailingAnnotation(item.name);
    if (!name) continue;

    let companyId = item.companyId;
    if (companyId == null) {
      const [company] = await db.insert(companies).values({ name }).returning();
      companyId = company.id;
      companiesCreated++;
    }

    const [deal] = await db
      .insert(deals)
      .values({
        companyId,
        title: dealTitle,
        ownerId,
        stage: defaultStageId,
        followUpAt: followUp,
      })
      .returning();

    await db.insert(activities).values({
      dealId: deal.id,
      userId: me.id,
      type: "created",
      content: "Opprettet i bulk",
    });

    for (const coOwnerId of coOwnerIds) {
      if (coOwnerId === ownerId) continue;
      await db.insert(dealOwners).values({ dealId: deal.id, userId: coOwnerId }).onConflictDoNothing();
    }

    created++;
  }

  revalidateDealViews();
  return { created, companiesCreated };
}

export async function updateDealStage(dealId: number, stage: string) {
  const me = await requireUser();
  const stageRow = await db.query.stages.findFirst({ where: eq(stages.id, Number(stage)) });
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return;

  const set: Record<string, unknown> = { stage, updatedAt: new Date() };
  if (stageRow?.isWon) set.closedAt = new Date();
  await db.update(deals).set(set).where(eq(deals.id, dealId));

  let type = "stage";
  let content = `Flyttet til «${stageRow?.label ?? stage}»`;
  if (stageRow?.isWon) {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, deal.companyId),
    });
    const names = await taggedNames(dealId, deal.ownerId);
    type = "won";
    content = `${formatNameList(names)} solgte «${deal.title}» til ${
      company?.name ?? "kunden"
    } for ${formatMoney(deal.value ?? 0)}! 🎉`;
  }

  await db.insert(activities).values({ dealId, userId: me.id, type, content });
  revalidateDealViews(dealId);
}

// Flytter en deal til en tapt-fase sammen med en påkrevd tapt-grunn og en
// valgfri fritekstkommentar. Kommentaren legges til på deals.comment (samme
// felt som "Kommentar" ellers i appen), og hele hendelsen logges som ÉN rad
// under "Notater og aktivitet" — deal-en slettes aldri.
export async function markDealLost(
  dealId: number,
  stage: string,
  lostReasonId: number,
  comment: string
) {
  const me = await requireUser();
  const [reasonRow, deal] = await Promise.all([
    db.query.lostReasons.findFirst({ where: eq(lostReasons.id, lostReasonId) }),
    db.query.deals.findFirst({ where: eq(deals.id, dealId) }),
  ]);
  if (!deal) return;

  const trimmedComment = comment.trim();
  const newComment = trimmedComment
    ? [deal.comment, trimmedComment].filter(Boolean).join("\n")
    : deal.comment;

  await db
    .update(deals)
    .set({
      stage,
      lostReasonId,
      followUpAt: null,
      comment: newComment,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deals.id, dealId));

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, deal.companyId),
  });
  const names = await taggedNames(dealId, deal.ownerId);
  const reasonLabel = reasonRow?.label ?? "Ukjent grunn";
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "lost",
    content: `${formatNameList(names)} markerte «${deal.title}» hos ${
      company?.name ?? "kunden"
    } som tapt (${reasonLabel})${trimmedComment ? `: ${trimmedComment}` : ""}`,
  });
  revalidateDealViews(dealId);
}

// Bulk-variant av markDealLost — samme grunn og kommentar på flere deals
// samtidig, fra flervalg i listevisningen. Kommentaren må appendes per deal
// (ulik eksisterende comment-verdi), så hver deal oppdateres for seg selv,
// mens aktivitetsloggen batches i ett innlegg.
export async function bulkMarkDealsLost(
  dealIds: number[],
  stage: string,
  lostReasonId: number,
  comment: string
) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const [reasonRow, targetDeals] = await Promise.all([
    db.query.lostReasons.findFirst({ where: eq(lostReasons.id, lostReasonId) }),
    db.query.deals.findMany({ where: inArray(deals.id, dealIds) }),
  ]);

  const trimmedComment = comment.trim();
  const reasonLabel = reasonRow?.label ?? "Ukjent grunn";
  for (const deal of targetDeals) {
    const newComment = trimmedComment
      ? [deal.comment, trimmedComment].filter(Boolean).join("\n")
      : deal.comment;
    await db
      .update(deals)
      .set({
        stage,
        lostReasonId,
        followUpAt: null,
        comment: newComment,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, deal.id));

    const company = await db.query.companies.findFirst({
      where: eq(companies.id, deal.companyId),
    });
    const names = await taggedNames(deal.id, deal.ownerId);
    await db.insert(activities).values({
      dealId: deal.id,
      userId: me.id,
      type: "lost",
      content: `${formatNameList(names)} markerte «${deal.title}» hos ${
        company?.name ?? "kunden"
      } som tapt (${reasonLabel})${trimmedComment ? `: ${trimmedComment}` : ""}`,
    });
  }

  revalidateDealViews();
}

// ---------- Tapte grunner (lost reasons) ----------

export async function createLostReason(formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const existing = await db.query.lostReasons.findMany({
    orderBy: [asc(lostReasons.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [reason] = await db
    .insert(lostReasons)
    .values({ label, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return reason;
}

export async function updateLostReason(id: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await db.update(lostReasons).set({ label }).where(eq(lostReasons.id, id));
  revalidatePath("/settings");
}

export async function deleteLostReason(
  id: number
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const inUse = await db.query.deals.findFirst({ where: eq(deals.lostReasonId, id) });
  if (inUse) {
    return {
      ok: false,
      message: "Kan ikke slette — den er i bruk på minst én deal.",
    };
  }
  await db.delete(lostReasons).where(eq(lostReasons.id, id));
  revalidatePath("/settings");
  return { ok: true, message: "Grunnen ble slettet." };
}

// `orderedIds` er hele lista i sin nye rekkefølge.
export async function reorderLostReasons(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(lostReasons).set({ sortOrder: i }).where(eq(lostReasons.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

// ---------- Tagger (deals og personer) ----------
// Fritt redigerbare per entitetstype, samme mønster som tapt-grunner —
// forhåndsdefinerte via seedTags i migrate.ts, men kan utvides/omdøpes/
// slettes fra Innstillinger etterpå.

export async function createTag(
  entityType: "deal" | "person",
  formData: FormData
) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const existing = await db.query.tags.findMany({
    where: eq(tags.entityType, entityType),
    orderBy: [asc(tags.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [tag] = await db
    .insert(tags)
    .values({ entityType, label, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return tag;
}

export async function updateTag(id: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await db.update(tags).set({ label }).where(eq(tags.id, id));
  revalidatePath("/settings");
}

// Ingen "i bruk"-sperre som på tapt-grunner — en tag er trygg å slette når
// den er i bruk, siden den bare fjernes fra det den var koblet til
// (fremmednøklene har ON DELETE CASCADE på selve koblingstabellene).
export async function deleteTag(id: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  await db.delete(tags).where(eq(tags.id, id));
  revalidatePath("/settings");
  revalidateDealViews();
  revalidatePath("/people");
  return { ok: true, message: "Taggen ble slettet." };
}

// `orderedIds` er hele lista (for én entitetstype) i sin nye rekkefølge.
export async function reorderTags(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(tags).set({ sortOrder: i }).where(eq(tags.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

export async function addDealTag(dealId: number, tagId: number) {
  await requireUser();
  await db.insert(dealTags).values({ dealId, tagId }).onConflictDoNothing();
  revalidateDealViews(dealId);
}

export async function removeDealTag(dealId: number, tagId: number) {
  await requireUser();
  await db.delete(dealTags).where(and(eq(dealTags.dealId, dealId), eq(dealTags.tagId, tagId)));
  revalidateDealViews(dealId);
}

// Brukes fra bulk-verktøylinjen i Pipeline-listen — legger til (ikke
// fjerner) samme tag på flere valgte deals samtidig.
export async function bulkAddDealTag(dealIds: number[], tagId: number) {
  await requireUser();
  for (const dealId of dealIds) {
    await db.insert(dealTags).values({ dealId, tagId }).onConflictDoNothing();
  }
  revalidateDealViews();
}

export async function addPersonTag(personId: number, tagId: number) {
  await requireUser();
  await db.insert(personTags).values({ personId, tagId }).onConflictDoNothing();
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function removePersonTag(personId: number, tagId: number) {
  await requireUser();
  await db
    .delete(personTags)
    .where(and(eq(personTags.personId, personId), eq(personTags.tagId, tagId)));
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

// Brukes fra bulk-verktøylinjen i Personer-listen — samme "legg til, ikke
// fjern"-oppførsel som bulkAddDealTag.
export async function bulkAddPersonTag(personIds: number[], tagId: number) {
  await requireUser();
  for (const personId of personIds) {
    await db.insert(personTags).values({ personId, tagId }).onConflictDoNothing();
  }
  revalidatePath("/people");
}

// ---------- Faser (pipeline-stages) ----------

export async function createStage(pipelineId: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const color = String(formData.get("color") ?? "").trim() || "#8e8e93";
  const existing = await db.query.stages.findMany({ orderBy: [asc(stages.sortOrder)] });
  const inPipeline = existing.filter((s) => s.pipelineId === pipelineId);
  const nextOrder = inPipeline.length > 0 ? inPipeline[inPipeline.length - 1].sortOrder + 1 : 0;
  const [stage] = await db
    .insert(stages)
    .values({ pipelineId, label, color, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  revalidateDealViews();
  return stage;
}

export async function updateStage(stageId: number, formData: FormData) {
  await requireUser();
  const set: Record<string, unknown> = {};
  if (formData.has("label")) {
    const label = String(formData.get("label") ?? "").trim();
    if (label) set.label = label;
  }
  if (formData.has("color")) {
    set.color = String(formData.get("color") ?? "").trim() || "#8e8e93";
  }
  if (formData.has("isWon")) set.isWon = formData.get("isWon") === "1";
  if (formData.has("isLost")) set.isLost = formData.get("isLost") === "1";
  if (formData.has("probability")) {
    const p = Number(formData.get("probability"));
    if (Number.isFinite(p)) set.probability = Math.max(0, Math.min(100, Math.round(p)));
  }
  if (Object.keys(set).length === 0) return;
  await db.update(stages).set(set).where(eq(stages.id, stageId));
  revalidatePath("/settings");
  revalidateDealViews();
}

export async function deleteStage(
  stageId: number
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const inUse = await db.query.deals.findFirst({ where: eq(deals.stage, String(stageId)) });
  if (inUse) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt deals ut av fasen først.",
    };
  }
  await db.delete(stages).where(eq(stages.id, stageId));
  revalidatePath("/settings");
  revalidateDealViews();
  return { ok: true, message: "Fasen ble slettet." };
}

// `orderedIds` er hele fase-listen i sin nye rekkefølge.
export async function reorderStages(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(stages).set({ sortOrder: i }).where(eq(stages.id, orderedIds[i]));
  }
  revalidatePath("/settings");
  revalidateDealViews();
}

// ---------- Pipelines ----------
// Egne pipeline-løp (f.eks. "Salg", "Anbud"), hver med sitt eget sett
// stages — se stages.pipelineId. Samme CRUD-mønster som business_units.

export async function createPipeline(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return null;
  const existing = await db.query.pipelines.findMany({ orderBy: [asc(pipelines.sortOrder)] });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [pipeline] = await db
    .insert(pipelines)
    .values({ name, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return pipeline;
}

export async function renamePipeline(id: number, formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.update(pipelines).set({ name }).where(eq(pipelines.id, id));
  revalidatePath("/settings");
}

export async function deletePipeline(id: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const all = await db.query.pipelines.findMany();
  if (all.length <= 1) {
    return { ok: false, message: "Kan ikke slette den siste pipelinen." };
  }
  const stageIds = (
    await db.query.stages.findMany({ where: eq(stages.pipelineId, id) })
  ).map((s) => String(s.id));
  if (stageIds.length > 0) {
    const inUse = await db.query.deals.findFirst({ where: inArray(deals.stage, stageIds) });
    if (inUse) {
      return {
        ok: false,
        message: "Kan ikke slette — flytt deals ut av pipelinens faser først.",
      };
    }
  }
  await db.delete(stages).where(eq(stages.pipelineId, id));
  await db.delete(pipelines).where(eq(pipelines.id, id));
  revalidatePath("/settings");
  revalidateDealViews();
  return { ok: true, message: "Pipelinen ble slettet." };
}

// `orderedIds` er hele pipeline-listen i sin nye rekkefølge.
export async function reorderPipelines(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(pipelines).set({ sortOrder: i }).where(eq(pipelines.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

export async function updateDealDetails(dealId: number, formData: FormData) {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return;

  const title = String(formData.get("dealTitle") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const hasValueField = formData.has("value");
  const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
  const hasProbabilityField = formData.has("probabilityOverride");
  const probabilityRaw = String(formData.get("probabilityOverride") ?? "").trim();
  const probabilityNum = probabilityRaw === "" ? null : Number(probabilityRaw);
  const probabilityOverride =
    probabilityNum != null && Number.isFinite(probabilityNum)
      ? Math.max(0, Math.min(100, Math.round(probabilityNum)))
      : null;

  if (comment !== deal.comment) {
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "comment",
      content: comment ? `Oppdaterte kommentaren: «${comment}»` : "Fjernet kommentaren",
    });
  }

  await db
    .update(deals)
    .set({
      ...(title ? { title } : {}),
      comment,
      // Verdi styres av varelinjene når de finnes; da sendes ikke feltet inn.
      ...(hasValueField ? { value: valueRaw ? Number(valueRaw) : null } : {}),
      ...(hasProbabilityField ? { probabilityOverride } : {}),
      updatedAt: new Date(),
    })
    .where(eq(deals.id, dealId));

  const companyName = String(formData.get("companyName") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim() || null;
  await db
    .update(companies)
    .set({ ...(companyName ? { name: companyName } : {}), website })
    .where(eq(companies.id, deal.companyId));

  revalidateDealViews(dealId);
}

// Klikk-for-å-endre-navn direkte på deal-siden (overskriften). Returnerer
// den nye, gjeldende slug-en slik at klienten kan oppdatere adressefeltet.
export async function renameDeal(dealId: number, title: string): Promise<{ slug: string } | null> {
  await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return null;
  await db.update(deals).set({ title: trimmed, updatedAt: new Date() }).where(eq(deals.id, dealId));
  revalidateDealViews(dealId);
  const slug = (await getDealSlugMap()).get(dealId) ?? String(dealId);
  return { slug };
}

// Inline-redigering fra listevisningen: kun feltene som sendes inn oppdateres.
export async function updateDealInline(dealId: number, formData: FormData) {
  const me = await requireUser();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  let newComment: string | null | undefined;

  if (formData.has("title")) {
    const title = String(formData.get("title") ?? "").trim();
    if (title) set.title = title;
  }
  if (formData.has("comment")) {
    newComment = String(formData.get("comment") ?? "").trim() || null;
    set.comment = newComment;
  }
  if (formData.has("followUpAt")) {
    const dateStr = String(formData.get("followUpAt") ?? "");
    set.followUpAt = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  }
  if (formData.has("value")) {
    const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
    set.value = valueRaw ? Number(valueRaw) : null;
  }

  // Logges kun i "Notater og aktivitet" hvis kommentaren faktisk endres —
  // ellers ville hver blur på et uendret felt skapt en aktivitetsrad.
  if (newComment !== undefined) {
    const current = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
    if (current && current.comment !== newComment) {
      await db.insert(activities).values({
        dealId,
        userId: me.id,
        type: "comment",
        content: newComment ? `Oppdaterte kommentaren: «${newComment}»` : "Fjernet kommentaren",
      });
    }
  }

  await db.update(deals).set(set).where(eq(deals.id, dealId));
  revalidateDealViews(dealId);
}

export async function setFollowUp(dealId: number, formData: FormData) {
  const me = await requireUser();
  const dateStr = String(formData.get("followUpAt") ?? "");
  const date = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  await db
    .update(deals)
    .set({ followUpAt: date, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "followup",
    content: date
      ? `Oppfølging satt til ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "long" })}`
      : "Oppfølging fjernet",
  });
  revalidateDealViews(dealId);
}

// Setter samme oppfølgingsdato på flere valgte deals samtidig, fra
// flervalg i listevisningen.
export async function bulkSetFollowUp(dealIds: number[], dateStr: string) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const date = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  await db
    .update(deals)
    .set({ followUpAt: date, updatedAt: new Date() })
    .where(inArray(deals.id, dealIds));
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "followup",
      content: date
        ? `Oppfølging satt til ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "long" })}`
        : "Oppfølging fjernet",
    }))
  );
  revalidateDealViews();
}

export async function deleteDeal(dealId: number) {
  await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) redirect("/leads");
  await db.delete(deals).where(eq(deals.id, dealId));
  // Rydd bort selskapet hvis dette var siste deal og ingen e-post er logget.
  const remaining = await db.query.deals.findFirst({
    where: eq(deals.companyId, deal.companyId),
  });
  if (!remaining) {
    const hasMail = await db.query.emailMessages.findFirst({
      where: (m, { eq: eqOp }) => eqOp(m.companyId, deal.companyId),
    });
    if (!hasMail) {
      await db.delete(companies).where(eq(companies.id, deal.companyId));
    }
  }
  revalidateDealViews();
  redirect("/leads");
}

// Flytter flere deals til samme fase samtidig, fra flervalg i listevisningen.
export async function bulkSetDealStage(dealIds: number[], stage: string) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const stageRow = await db.query.stages.findFirst({ where: eq(stages.id, Number(stage)) });

  const set: Record<string, unknown> = { stage, updatedAt: new Date() };
  if (stageRow?.isWon) set.closedAt = new Date();
  await db.update(deals).set(set).where(inArray(deals.id, dealIds));

  if (stageRow?.isWon) {
    // Hver deal har eget selskap/verdi/tagget-liste, så meldingen bygges per deal.
    const targetDeals = await db.query.deals.findMany({ where: inArray(deals.id, dealIds) });
    for (const deal of targetDeals) {
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, deal.companyId),
      });
      const names = await taggedNames(deal.id, deal.ownerId);
      await db.insert(activities).values({
        dealId: deal.id,
        userId: me.id,
        type: "won",
        content: `${formatNameList(names)} solgte «${deal.title}» til ${
          company?.name ?? "kunden"
        } for ${formatMoney(deal.value ?? 0)}! 🎉`,
      });
    }
  } else {
    await db.insert(activities).values(
      dealIds.map((dealId) => ({
        dealId,
        userId: me.id,
        type: "stage",
        content: `Flyttet til «${stageRow?.label ?? stage}»`,
      }))
    );
  }
  revalidateDealViews();
}

// Endrer hoved-eieren på en enkelt deal — fra oversiktsbildet (listevisningen).
// ownerId === null fjerner hovedeieren — en deal kan stå uten eier.
export async function updateDealOwner(dealId: number, ownerId: number | null) {
  const me = await requireUser();
  if (ownerId == null) {
    await db.update(deals).set({ ownerId: null, updatedAt: new Date() }).where(eq(deals.id, dealId));
    await db.insert(activities).values({ dealId, userId: me.id, type: "owner", content: "Fjernet eier" });
    revalidateDealViews(dealId);
    return;
  }
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) return;
  await db.update(deals).set({ ownerId, updatedAt: new Date() }).where(eq(deals.id, dealId));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "owner",
    content: `Endret eier til ${owner.name}`,
  });
  revalidateDealViews(dealId);
}

// Samme som over, for flere valgte deals samtidig.
export async function bulkSetDealOwner(dealIds: number[], ownerId: number) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) return;
  await db
    .update(deals)
    .set({ ownerId, updatedAt: new Date() })
    .where(inArray(deals.id, dealIds));
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "owner",
      content: `Endret eier til ${owner.name}`,
    }))
  );
  revalidateDealViews();
}

// Bytter hovedeier, men uten å miste den forrige — den blir med-eier i
// stedet for å falle helt av dealen. Brukes fra flervalg-eier-velgeren i
// Pipeline-listen (DealOwnerCell), der man kan velge flere eiere.
export async function swapDealMainOwner(dealId: number, newOwnerId: number) {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal || deal.ownerId === newOwnerId) return;
  const newOwner = await db.query.users.findFirst({ where: eq(users.id, newOwnerId) });
  if (!newOwner) return;
  const oldOwnerId = deal.ownerId;

  await db
    .update(deals)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  if (oldOwnerId != null) {
    await db.insert(dealOwners).values({ dealId, userId: oldOwnerId }).onConflictDoNothing();
  }
  await db
    .delete(dealOwners)
    .where(and(eq(dealOwners.dealId, dealId), eq(dealOwners.userId, newOwnerId)));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "owner",
    content: `Endret hovedeier til ${newOwner.name}`,
  });
  revalidateDealViews(dealId);
}

// Legger til én med-eier på flere valgte deals samtidig — bulk-motstykket til
// addDealOwner, brukt fra "Legg til eier"-verktøylinjen i DealsTable.
export async function bulkAddDealOwner(dealIds: number[], userId: number) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  for (const dealId of dealIds) {
    await db.insert(dealOwners).values({ dealId, userId }).onConflictDoNothing();
  }
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "owner",
      content: `La til ${user.name} som eier`,
    }))
  );
  revalidateDealViews();
}

// Sletter flere deals samtidig, med samme selskaps-opprydding som deleteDeal.
export async function bulkDeleteDeals(dealIds: number[]): Promise<{ deleted: number }> {
  await requireUser();
  if (dealIds.length === 0) return { deleted: 0 };
  const rows = await db.query.deals.findMany({ where: inArray(deals.id, dealIds) });
  const companyIds = [...new Set(rows.map((d) => d.companyId))];

  await db.delete(deals).where(inArray(deals.id, dealIds));

  for (const companyId of companyIds) {
    const remaining = await db.query.deals.findFirst({ where: eq(deals.companyId, companyId) });
    if (remaining) continue;
    const hasMail = await db.query.emailMessages.findFirst({
      where: (m, { eq: eqOp }) => eqOp(m.companyId, companyId),
    });
    if (!hasMail) await db.delete(companies).where(eq(companies.id, companyId));
  }

  revalidateDealViews();
  return { deleted: rows.length };
}

// ---------- Varelinjer ----------

function lineMultiplier(line: { billingType: string; months: number | null }): number {
  return line.billingType === "recurring" ? Math.max(1, line.months ?? 1) : 1;
}

function parseBillingFields(formData: FormData): { billingType: "once" | "recurring"; months: number | null } {
  const billingType = formData.get("billingType") === "recurring" ? "recurring" : "once";
  const monthsRaw = Number(String(formData.get("months") ?? ""));
  const months =
    billingType === "recurring" && Number.isFinite(monthsRaw) && monthsRaw >= 1
      ? Math.round(monthsRaw)
      : billingType === "recurring"
        ? 1
        : null;
  return { billingType, months };
}

async function recalcDealValue(dealId: number) {
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

export async function addDealLine(dealId: number, formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const hours = Number(String(formData.get("hours") ?? "0").replace(",", "."));
  const rate = Number(String(formData.get("rate") ?? "0").replace(/[^\d]/g, ""));
  if (!title || !Number.isFinite(hours) || hours < 0) return;
  const { billingType, months } = parseBillingFields(formData);
  await db.insert(dealLines).values({ dealId, title, hours, rate, billingType, months });
  await recalcDealValue(dealId);
  revalidateDealViews(dealId);
}

export async function updateDealLine(lineId: number, dealId: number, formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const hours = Number(String(formData.get("hours") ?? "0").replace(",", "."));
  const rate = Number(String(formData.get("rate") ?? "0").replace(/[^\d]/g, ""));
  if (!title || !Number.isFinite(hours) || hours < 0) return;
  const { billingType, months } = parseBillingFields(formData);
  await db
    .update(dealLines)
    .set({ title, hours, rate, billingType, months })
    .where(eq(dealLines.id, lineId));
  await recalcDealValue(dealId);
  revalidateDealViews(dealId);
}

export async function deleteDealLine(lineId: number, dealId: number) {
  await requireUser();
  await db.delete(dealLines).where(eq(dealLines.id, lineId));
  await recalcDealValue(dealId);
  revalidateDealViews(dealId);
}

// ---------- Prisverktøy ----------

export async function scanWebsiteForEstimate(
  url: string
): Promise<{ ok: true; result: SiteScanResult } | { ok: false; message: string }> {
  await requireUser();
  const result = await scanWebsite(url);
  if (!result) {
    return {
      ok: false,
      message: "Fant ikke siden, eller den svarte ikke innen rimelig tid. Sjekk adressen.",
    };
  }
  return { ok: true, result };
}

function domainFromUrlInput(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function lookupCompanyInsight(
  url: string,
  companyNameGuess: string,
  ecommerceDetected: boolean
) {
  await requireUser();
  return companyInsight.lookupCompanyInsight(companyNameGuess, domainFromUrlInput(url), ecommerceDetected);
}

export async function lookupCompanyInsightByOrgNumber(
  orgNumber: string,
  candidates: BrregHit[],
  ecommerceDetected: boolean
) {
  await requireUser();
  return companyInsight.lookupCompanyInsightByOrgNumber(orgNumber, candidates, ecommerceDetected);
}

export interface EstimateLineInput {
  title: string;
  hours: number;
  rate: number;
}

// Erstatter ALLE varelinjer på dealen med det nye estimatet — "lagre" her
// betyr synkronisere, ikke legge til på toppen av det som var der fra før.
export async function saveEstimateToDeal(
  dealId: number,
  lines: EstimateLineInput[]
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return { ok: false, message: "Fant ikke dealen." };

  const clean = lines
    .map((l) => ({ title: l.title.trim(), hours: Number(l.hours), rate: Number(l.rate) }))
    .filter((l) => l.title && Number.isFinite(l.hours) && Number.isFinite(l.rate));

  if (clean.length === 0) {
    return { ok: false, message: "Ingen gyldige rader å lagre." };
  }

  await db.delete(dealLines).where(eq(dealLines.dealId, dealId));
  await db.insert(dealLines).values(clean.map((l) => ({ dealId, ...l })));
  await recalcDealValue(dealId);

  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "estimate",
    content: "Varelinjer oppdatert fra prisverktøyet",
  });

  revalidateDealViews(dealId);
  return { ok: true, message: `Lagret ${clean.length} rader på ${deal.title}.` };
}

// Oppretter en helt ny deal (og evt. nytt selskap) direkte fra prisverktøyet,
// og lagrer estimatet på den med det samme — uten å forlate siden, slik at
// brukeren kan sende tilbudet til kunden rett etterpå.
export async function createDealFromEstimate(
  formData: FormData,
  lines: EstimateLineInput[]
): Promise<
  | { ok: true; dealId: number; dealSlug: string; companyName: string; logoUrl: string | null }
  | { ok: false; message: string }
> {
  const me = await requireUser();
  const companyIdRaw = String(formData.get("companyId") ?? "").trim();
  const newCompanyName = String(formData.get("companyName") ?? "").trim();
  const orgNumber = String(formData.get("orgNumber") ?? "").replace(/\D/g, "");
  const dealTitle = String(formData.get("dealTitle") ?? "").trim();

  const chosenId = Number(companyIdRaw);
  let company =
    companyIdRaw && Number.isFinite(chosenId)
      ? await db.query.companies.findFirst({ where: eq(companies.id, chosenId) })
      : undefined;

  if (!company && !newCompanyName) {
    return { ok: false, message: "Velg eller opprett et selskap først." };
  }

  if (!company) {
    [company] = await db
      .insert(companies)
      .values({
        name: newCompanyName,
        orgNumber: orgNumber.length === 9 ? orgNumber : null,
      })
      .returning();

    if (orgNumber.length === 9) {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
    } else {
      await autoMatchCompany(company.id);
    }
  }

  const [deal] = await db
    .insert(deals)
    .values({
      companyId: company.id,
      title: dealTitle || "Ny deal",
      ownerId: me.id,
      stage: await getDefaultStageId(await getDefaultPipelineId()),
      followUpAt: todayFollowUpDate(),
    })
    .returning();

  await db.insert(activities).values({
    dealId: deal.id,
    userId: me.id,
    type: "created",
    content: "Deal opprettet fra prisverktøyet",
  });

  await saveEstimateToDeal(deal.id, lines);

  revalidateDealViews(deal.id);
  const dealSlug = (await getDealSlugMap()).get(deal.id) ?? String(deal.id);
  return {
    ok: true,
    dealId: deal.id,
    dealSlug,
    companyName: company.name,
    logoUrl: company.logoUrl,
  };
}

// ---------- Referanseprosjekter ----------

export async function createReferenceProject(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const url = String(formData.get("url") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const screenshot = String(formData.get("screenshot") ?? "").trim() || null;

  const phaseHours: Record<string, { estimert?: number; faktisk?: number }> = {};
  for (const phase of PHASES) {
    const estRaw = String(formData.get(`est_${phase.key}`) ?? "").replace(",", ".");
    const actRaw = String(formData.get(`act_${phase.key}`) ?? "").replace(",", ".");
    const est = estRaw ? Number(estRaw) : null;
    const act = actRaw ? Number(actRaw) : null;
    if ((est && est > 0) || (act && act > 0)) {
      phaseHours[phase.key] = {
        ...(est && est > 0 ? { estimert: est } : {}),
        ...(act && act > 0 ? { faktisk: act } : {}),
      };
    }
  }

  await db.insert(referenceProjects).values({
    name,
    url,
    notes,
    screenshot,
    phaseHours: Object.keys(phaseHours).length > 0 ? JSON.stringify(phaseHours) : null,
  });

  revalidatePath("/estimat");
}

export async function deleteReferenceProject(id: number) {
  await requireUser();
  await db.delete(referenceProjects).where(eq(referenceProjects.id, id));
  revalidatePath("/estimat");
}

// ---------- Import fra Productive ----------

export interface ImportDealRow {
  companyName: string;
  dealTitle: string;
  stage: string;
  value: number | null;
  followUpAt: string | null; // yyyy-mm-dd
  comment: string | null;
}

export interface ImportDealResult {
  companyName: string;
  dealTitle: string;
  status: "imported" | "skipped";
  reason?: string;
}

export async function importProductiveDeals(
  rows: ImportDealRow[],
  pipelineId: number
): Promise<{
  imported: number;
  skipped: number;
  companiesCreated: number;
  results: ImportDealResult[];
}> {
  const me = await requireUser();
  const currentStages = await getStages(pipelineId);
  const validStageIds = new Set(currentStages.map((s) => String(s.id)));
  const fallbackStageId = firstStageId(currentStages);

  const companyByName = new Map<string, number>();
  for (const c of await db.query.companies.findMany()) {
    companyByName.set(c.name.trim().toLowerCase(), c.id);
  }
  // Duplikat kun når BÅDE selskap og dealnavn er like — samme dealnavn på
  // to ulike selskap (f.eks. to forskjellige kunder som begge har en deal
  // kalt "Anbud") skal ikke regnes som duplikat.
  const existingDeals = new Set<string>();
  for (const d of await db.query.deals.findMany()) {
    existingDeals.add(`${d.companyId}::${d.title.trim().toLowerCase()}`);
  }

  let imported = 0;
  let skipped = 0;
  let companiesCreated = 0;
  const results: ImportDealResult[] = [];

  for (const row of rows.slice(0, 500)) {
    const companyName = String(row.companyName ?? "").trim();
    const dealTitle = String(row.dealTitle ?? "").trim() || "Deal";
    if (!companyName) {
      results.push({
        companyName: companyName || "(uten selskap)",
        dealTitle,
        status: "skipped",
        reason: "Mangler selskapsnavn",
      });
      continue;
    }

    let companyId = companyByName.get(companyName.toLowerCase());
    if (!companyId) {
      const [company] = await db
        .insert(companies)
        .values({ name: companyName })
        .returning();
      companyId = company.id;
      companyByName.set(companyName.toLowerCase(), companyId);
      companiesCreated++;
    }

    const dealKey = `${companyId}::${dealTitle.toLowerCase()}`;
    if (existingDeals.has(dealKey)) {
      skipped++;
      results.push({
        companyName,
        dealTitle,
        status: "skipped",
        reason: `Finnes fra før på ${companyName}`,
      });
      continue;
    }

    const followUpAt =
      row.followUpAt && /^\d{4}-\d{2}-\d{2}$/.test(row.followUpAt)
        ? new Date(`${row.followUpAt}T09:00:00`)
        : null;
    const value =
      row.value != null && Number.isFinite(row.value) && row.value > 0
        ? Math.round(row.value)
        : null;

    const [deal] = await db
      .insert(deals)
      .values({
        companyId,
        title: dealTitle,
        stage: validStageIds.has(row.stage) ? row.stage : fallbackStageId,
        value,
        followUpAt,
        comment: String(row.comment ?? "").trim() || null,
        ownerId: me.id,
      })
      .returning();
    existingDeals.add(dealKey);

    await db.insert(activities).values({
      dealId: deal.id,
      userId: me.id,
      type: "created",
      content: "Importert fra Productive",
    });
    imported++;
    results.push({ companyName, dealTitle, status: "imported" });
  }

  revalidateDealViews();
  return { imported, skipped, companiesCreated, results };
}

// ---------- Import av bedrifter og personer ----------

export interface ImportCompanyRow {
  name: string;
  orgNumber: string | null;
  website: string | null;
  phone: string | null;
}

export async function importCompanies(rows: ImportCompanyRow[]): Promise<{
  created: number;
  skipped: number;
  verified: number;
}> {
  await requireUser();

  const existing = new Map<string, number>();
  for (const c of await db.query.companies.findMany()) {
    existing.set(c.name.trim().toLowerCase(), c.id);
    if (c.orgNumber) existing.set(c.orgNumber, c.id);
  }

  let created = 0;
  let skipped = 0;
  let verified = 0;

  for (const row of rows.slice(0, 500)) {
    const name = row.name.trim();
    if (!name) continue;
    const orgNumber = (row.orgNumber ?? "").replace(/\D/g, "");
    const key = name.toLowerCase();

    if (existing.has(key) || (orgNumber && existing.has(orgNumber))) {
      skipped++;
      continue;
    }

    const rawSite = row.website?.trim() || "";
    const host = rawSite
      ? rawSite.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "")
      : "";
    const hasHost = host.includes(".");

    const [company] = await db
      .insert(companies)
      .values({
        name,
        website: rawSite ? (rawSite.startsWith("http") ? rawSite : `https://${rawSite}`) : null,
        domain: hasHost ? host : null,
        logoUrl: hasHost
          ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
          : null,
        phone: row.phone?.trim() || null,
        orgNumber: orgNumber.length === 9 ? orgNumber : null,
      })
      .returning();

    existing.set(key, company.id);
    if (orgNumber.length === 9) existing.set(orgNumber, company.id);
    created++;

    // Hent offisielle data: direkte når orgnummer finnes, ellers prøv å matche.
    if (orgNumber.length === 9) {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
      verified++;
    } else {
      const res = await autoMatchCompany(company.id);
      if (res.matched) verified++;
    }
  }

  revalidateDealViews();
  return { created, skipped, verified };
}

export interface ImportPersonRow {
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  role: string | null;
}

export async function importPeople(rows: ImportPersonRow[]): Promise<{
  created: number;
  linked: number;
  skipped: number;
  companiesCreated: number;
}> {
  await requireUser();

  const companyByName = new Map<string, number>();
  for (const c of await db.query.companies.findMany()) {
    companyByName.set(c.name.trim().toLowerCase(), c.id);
    if (c.orgName) companyByName.set(c.orgName.trim().toLowerCase(), c.id);
  }

  const peopleByEmail = new Map<string, number>();
  const peopleByName = new Map<string, number>();
  for (const p of await db.query.people.findMany()) {
    if (p.email) peopleByEmail.set(p.email.toLowerCase(), p.id);
    peopleByName.set(p.name.trim().toLowerCase(), p.id);
  }

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let companiesCreated = 0;

  for (const row of rows.slice(0, 1000)) {
    const name = row.name.trim();
    if (!name) continue;
    const email = row.email?.trim().toLowerCase() || null;

    let personId = email ? peopleByEmail.get(email) : undefined;
    if (personId === undefined && !email) personId = peopleByName.get(name.toLowerCase());

    if (personId === undefined) {
      const [person] = await db
        .insert(people)
        .values({ name, email, phone: row.phone?.trim() || null })
        .returning();
      personId = person.id;
      if (email) peopleByEmail.set(email, personId);
      peopleByName.set(name.toLowerCase(), personId);
      created++;
    } else {
      skipped++;
    }

    const companyName = row.companyName?.trim();
    if (!companyName) continue;

    let companyId = companyByName.get(companyName.toLowerCase());
    if (companyId === undefined) {
      const [company] = await db.insert(companies).values({ name: companyName }).returning();
      companyId = company.id;
      companyByName.set(companyName.toLowerCase(), companyId);
      companiesCreated++;
      await autoMatchCompany(companyId);
    }

    const before = await db.query.companyPeople.findFirst({
      where: and(
        eq(companyPeople.companyId, companyId),
        eq(companyPeople.personId, personId)
      ),
    });
    if (!before) {
      await db
        .insert(companyPeople)
        .values({ companyId, personId, role: row.role?.trim() || null })
        .onConflictDoNothing();
      linked++;
    }
  }

  revalidateDealViews();
  revalidatePath("/people");
  return { created, linked, skipped, companiesCreated };
}

// ---------- Personer ----------

// Finner personen på e-post eller oppretter den, og knytter den til selskapet.
async function linkPersonByEmail(
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

export async function addPersonToCompany(
  companyId: number,
  dealId: number | null,
  formData: FormData
) {
  const me = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "").trim() || null;
  if (!name) return;

  await linkPersonByEmail(companyId, email, name, phone, role);

  if (dealId) {
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "contact",
      content: `La til kontakt ${name}`,
    });
  }
  revalidateDealViews(dealId ?? undefined);
}

// Knytter en eksisterende person til et selskap til (person i flere selskap).
export async function linkPersonToCompany(personId: number, formData: FormData) {
  await requireUser();
  const companyId = Number(formData.get("companyId"));
  const role = String(formData.get("role") ?? "").trim() || null;
  if (!Number.isFinite(companyId)) return;
  await db
    .insert(companyPeople)
    .values({ companyId, personId, role })
    .onConflictDoNothing();
  revalidateDealViews();
  revalidatePath(`/people/${personId}`);
}

export async function unlinkPersonFromCompany(
  personId: number,
  companyId: number,
  dealId?: number
) {
  await requireUser();
  await db
    .delete(companyPeople)
    .where(and(eq(companyPeople.personId, personId), eq(companyPeople.companyId, companyId)));
  revalidateDealViews(dealId);
  revalidatePath(`/people/${personId}`);
}

// ---------- Med-eiere på deal ----------

export async function addDealOwner(dealId: number, userId: number) {
  const me = await requireUser();
  await db.insert(dealOwners).values({ dealId, userId }).onConflictDoNothing();
  const added = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (added) {
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "owner",
      content: `La til ${added.name} som eier`,
    });
  }
  revalidateDealViews(dealId);
}

export async function removeDealOwner(dealId: number, userId: number) {
  const me = await requireUser();
  await db.delete(dealOwners).where(and(eq(dealOwners.dealId, dealId), eq(dealOwners.userId, userId)));
  const removed = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (removed) {
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "owner",
      content: `Fjernet ${removed.name} som eier`,
    });
  }
  revalidateDealViews(dealId);
}

export async function updatePerson(personId: number, formData: FormData) {
  await requireUser();
  const set: Record<string, unknown> = {};
  if (formData.has("name")) {
    const name = String(formData.get("name") ?? "").trim();
    if (name) set.name = name;
  }
  if (formData.has("email")) {
    set.email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  }
  if (formData.has("phone")) {
    set.phone = String(formData.get("phone") ?? "").trim() || null;
  }
  if (formData.has("notes")) {
    set.notes = String(formData.get("notes") ?? "").trim() || null;
  }
  if (Object.keys(set).length === 0) return;
  await db.update(people).set(set).where(eq(people.id, personId));
  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  revalidatePath("/companies/[id]", "page");
  revalidatePath("/leads/[slug]", "page");
}

export async function createPerson(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const companyIdRaw = String(formData.get("companyId") ?? "");
  const role = String(formData.get("role") ?? "").trim() || null;

  const companyId = Number(companyIdRaw);
  if (Number.isFinite(companyId) && companyId > 0) {
    await linkPersonByEmail(companyId, email, name, phone, role);
  } else {
    await db.insert(people).values({ name, email, phone });
  }
  revalidatePath("/people");
  revalidateDealViews();
}

export async function deletePerson(personId: number) {
  await requireUser();
  await db.delete(people).where(eq(people.id, personId));
  revalidatePath("/people");
  revalidateDealViews();
  redirect("/people");
}

// Knytter flere valgte personer til samme selskap samtidig, fra flervalg i listevisningen.
export async function bulkLinkPeopleToCompany(personIds: number[], companyId: number) {
  await requireUser();
  if (personIds.length === 0 || !Number.isFinite(companyId)) return;
  await db
    .insert(companyPeople)
    .values(personIds.map((personId) => ({ companyId, personId })))
    .onConflictDoNothing();
  revalidatePath("/people");
  revalidateDealViews();
}

// Sletter flere personer samtidig (selskapskoblinger kaskaderer via schema).
export async function bulkDeletePeople(personIds: number[]): Promise<{ deleted: number }> {
  await requireUser();
  if (personIds.length === 0) return { deleted: 0 };
  await db.delete(people).where(inArray(people.id, personIds));
  revalidatePath("/people");
  revalidateDealViews();
  return { deleted: personIds.length };
}

// ---------- Selskap ----------

// Oppretter et selskap direkte fra Bedrifter-siden — enten fra et valgt
// brreg-treff (orgnummer sendes med, og vi henter full firmainfo rett etter)
// eller helt manuelt uten noen kobling til Enhetsregisteret.
export async function createCompany(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const orgNumber = String(formData.get("orgNumber") ?? "").replace(/\D/g, "");
  const website = String(formData.get("website") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name) {
    redirect("/companies?error=selskap");
  }

  let domain: string | null = null;
  let logoUrl: string | null = null;
  if (website) {
    const host = website.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    if (host.includes(".")) {
      domain = host;
      logoUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    }
  }

  const [company] = await db
    .insert(companies)
    .values({
      name,
      website: website || null,
      domain,
      logoUrl,
      phone: phone || null,
      orgNumber: orgNumber.length === 9 ? orgNumber : null,
    })
    .returning();

  if (orgNumber.length === 9) {
    await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
  }

  revalidateDealViews();
  redirect(`/companies/${company.id}`);
}

// Overstyrer det auto-genererte favicon-baserte logoUrl med et opplastet
// bilde (data-URL, samme mønster som avatar og referanseprosjekt-skjermbilder).
export async function updateCompanyLogo(companyId: number, formData: FormData) {
  await requireUser();
  const logo = String(formData.get("logo") ?? "");
  if (!logo.startsWith("data:image/")) return;
  await db.update(companies).set({ logoUrl: logo }).where(eq(companies.id, companyId));
  revalidatePath(`/companies/${companyId}`);
  revalidateDealViews();
}

export async function updateCompany(companyId: number, formData: FormData) {
  await requireUser();
  const set: Record<string, unknown> = {};

  if (formData.has("name")) {
    const name = String(formData.get("name") ?? "").trim();
    if (name) set.name = name;
  }
  if (formData.has("orgName")) {
    set.orgName = String(formData.get("orgName") ?? "").trim() || null;
  }
  if (formData.has("ownerId")) {
    const raw = String(formData.get("ownerId") ?? "");
    const id = Number(raw);
    set.ownerId = raw && Number.isFinite(id) && id > 0 ? id : null;
  }
  if (formData.has("businessUnitId")) {
    const raw = String(formData.get("businessUnitId") ?? "");
    const id = Number(raw);
    set.businessUnitId = raw && Number.isFinite(id) && id > 0 ? id : null;
  }
  let manualOrgNumber: string | null = null;
  if (formData.has("orgNumber")) {
    const raw = String(formData.get("orgNumber") ?? "").replace(/\D/g, "");
    set.orgNumber = raw.length === 9 ? raw : null;
    manualOrgNumber = raw.length === 9 ? raw : null;
  }
  if (formData.has("phone")) {
    set.phone = String(formData.get("phone") ?? "").trim() || null;
  }
  if (formData.has("primaryContactId")) {
    const raw = String(formData.get("primaryContactId") ?? "");
    const id = Number(raw);
    set.primaryContactId = raw && Number.isFinite(id) && id > 0 ? id : null;
  }
  if (formData.has("website")) {
    const website = String(formData.get("website") ?? "").trim();
    set.website = website || null;
    // Utled domene og logo på nytt når nettsiden endres manuelt.
    const host = website.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    if (host.includes(".")) {
      set.domain = host;
      set.logoUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    }
  }

  if (Object.keys(set).length === 0) return;
  await db.update(companies).set(set).where(eq(companies.id, companyId));

  // Velger man en person som hovedkontakt, skal personen automatisk regnes
  // som tilknyttet dette selskapet — selv om de ikke var koblet fra før.
  if (typeof set.primaryContactId === "number") {
    await db
      .insert(companyPeople)
      .values({ companyId, personId: set.primaryContactId })
      .onConflictDoNothing();
  }

  // Setter brukeren orgnummeret selv, regnes selskapet som bekreftet og vi
  // henter offisielle data med én gang.
  if (manualOrgNumber) {
    await syncCompanyFromBrreg(companyId, manualOrgNumber, { verified: true });
  }

  revalidateDealViews();
  revalidatePath(`/companies/${companyId}`);
}

// ---------- Universelt søk ----------

// Søk på tvers av deals, personer og selskap — brukt av GlobalSearch.tsx i
// sidemenyen. Deals matches også på selskapsnavn, slik at man finner en
// kundes deals ved å søke på kunden. Grense på 6 per kategori holder
// forslagslisten kort mens man skriver.
export async function globalSearch(query: string) {
  await requireUser();
  const q = query.trim();
  if (q.length < 2) {
    return { deals: [], people: [], companies: [] };
  }
  const needle = `%${q}%`;

  const dealRows = await db
    .select({
      id: deals.id,
      title: deals.title,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
    })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .where(
      or(
        like(deals.title, needle),
        like(companies.name, needle),
        like(companies.orgName, needle)
      )
    )
    .orderBy(desc(deals.updatedAt))
    .limit(6);

  const peopleRows = await db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(or(like(people.name, needle), like(people.email, needle)))
    .limit(6);

  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      orgName: companies.orgName,
      logoUrl: companies.logoUrl,
    })
    .from(companies)
    .where(or(like(companies.name, needle), like(companies.orgName, needle)))
    .limit(6);

  const slugMap = await getDealSlugMap();
  const dealsWithSlug = dealRows.map((d) => ({
    ...d,
    slug: slugMap.get(d.id) ?? String(d.id),
  }));

  return { deals: dealsWithSlug, people: peopleRows, companies: companyRows };
}

// ---------- Brønnøysundregistrene ----------

export async function searchBrregAction(query: string): Promise<BrregHit[]> {
  await requireUser();
  return searchBrreg(query);
}

// Henter fersk info fra brreg og lagrer på selskapet. `orgNumberInput` brukes
// når selskapet ikke har orgnummer registrert ennå.
export async function syncCompanyFromBrreg(
  companyId: number,
  orgNumberInput?: string,
  options?: { verified?: boolean }
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company) return { ok: false, message: "Fant ikke selskapet." };

  const orgNumber = orgNumberInput?.trim() || company.orgNumber;
  if (!orgNumber) {
    return { ok: false, message: "Legg inn organisasjonsnummer først." };
  }

  const data = await fetchBrregCompany(orgNumber);
  if (!data) {
    return {
      ok: false,
      message: "Fant ikke selskapet i Enhetsregisteret. Sjekk organisasjonsnummeret.",
    };
  }

  await db
    .update(companies)
    .set({
      orgNumber: data.orgNumber,
      // Offisielt navn lagres for seg; kallenavnet i `name` røres ikke.
      orgName: data.name,
      brregVerified: options?.verified ?? true,
      address: data.address,
      postalCode: data.postalCode,
      city: data.city,
      employees: data.employees,
      industry: data.industry,
      industryCode: data.industryCode,
      ceoName: data.ceoName,
      revenue: data.revenue,
      profit: data.profit,
      fiscalYear: data.fiscalYear,
      brregSyncedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");

  const notes: string[] = [];
  if (data.bankrupt) notes.push("⚠︎ registrert konkurs");
  if (data.liquidating) notes.push("⚠︎ under avvikling");
  return {
    ok: true,
    message: `Oppdatert fra Brønnøysundregistrene${notes.length ? ` — ${notes.join(", ")}` : ""}.`,
  };
}

// Slår opp selskapet automatisk ut fra navn/domene. Bare sikre treff lagres —
// usikre lar selskapet stå ubekreftet, med gul trekant i grensesnittet.
export async function autoMatchCompany(
  companyId: number
): Promise<{ matched: boolean; message: string }> {
  await requireUser();
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company) return { matched: false, message: "Fant ikke selskapet." };
  if (company.brregVerified) {
    return { matched: true, message: "Allerede bekreftet." };
  }

  const result = await matchBrregCompany(company.name, company.domain);
  if (!result.confident || !result.best) {
    revalidatePath(`/companies/${companyId}`);
    return { matched: false, message: result.reason };
  }

  await syncCompanyFromBrreg(companyId, result.best.orgNumber, { verified: true });
  return { matched: true, message: `Koblet til ${result.best.name}.` };
}

// Kjører automatisk matching for alle ubekreftede selskaper.
export interface UnresolvedCompany {
  id: number;
  name: string;
  // Beste (men usikre) gjetning fra Enhetsregisteret — tom hvis vi ikke
  // fant noe som helst å foreslå. Brukeren velger selv riktig treff.
  candidateOrgName: string | null;
  candidateOrgNumber: string | null;
}

export async function autoMatchAllCompanies(): Promise<{
  checked: number;
  matched: number;
  unresolved: UnresolvedCompany[];
}> {
  await requireUser();
  const pending = await db.query.companies.findMany({
    where: eq(companies.brregVerified, false),
  });

  let matched = 0;
  const unresolved: UnresolvedCompany[] = [];
  for (const company of pending) {
    const res = await autoMatchCompany(company.id);
    if (res.matched) {
      matched++;
      continue;
    }
    const guess = await matchBrregCompany(company.name, company.domain);
    unresolved.push({
      id: company.id,
      name: company.name,
      candidateOrgName: guess.best?.name ?? null,
      candidateOrgNumber: guess.best?.orgNumber ?? null,
    });
  }

  revalidateDealViews();
  return { checked: pending.length, matched, unresolved };
}

// Setter samme ansvarlig (eier) på flere valgte selskaper samtidig.
export async function bulkSetCompanyOwner(companyIds: number[], ownerId: number | null) {
  await requireUser();
  if (companyIds.length === 0) return;
  await db.update(companies).set({ ownerId }).where(inArray(companies.id, companyIds));
  revalidateDealViews();
}

// ---------- Med-eiere på selskap ("våre kontakter") ----------
// Speiler mønsteret fra deal-eiere (updateDealOwner/addDealOwner/
// removeDealOwner): companies.ownerId er hovedkontakten, company_owners er
// med-kontaktene, redigerbart fra samme flervalgs-popover som i Pipeline.

export async function updateCompanyOwner(companyId: number, ownerId: number | null) {
  await requireUser();
  if (ownerId != null) {
    const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
    if (!owner) return;
  }
  await db.update(companies).set({ ownerId }).where(eq(companies.id, companyId));
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

export async function addCompanyOwner(companyId: number, userId: number) {
  await requireUser();
  await db.insert(companyOwners).values({ companyId, userId }).onConflictDoNothing();
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

export async function removeCompanyOwner(companyId: number, userId: number) {
  await requireUser();
  await db
    .delete(companyOwners)
    .where(and(eq(companyOwners.companyId, companyId), eq(companyOwners.userId, userId)));
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

// Kjører Brreg-oppslag for flere valgte selskaper samtidig (samme logikk som
// enkelt-oppslaget, bare avgrenset til flervalget i stedet for alle ubekreftede).
export async function bulkMatchCompaniesBrreg(companyIds: number[]): Promise<{
  checked: number;
  matched: number;
  unresolved: string[];
}> {
  await requireUser();
  let matched = 0;
  const unresolved: string[] = [];
  for (const companyId of companyIds) {
    const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) continue;
    const res = await autoMatchCompany(companyId);
    if (res.matched) matched++;
    else unresolved.push(company.name);
  }
  revalidateDealViews();
  return { checked: companyIds.length, matched, unresolved };
}

// Sletter flere selskaper samtidig — deals, kontakter og e-postlogg
// kaskaderer via schema (ON DELETE CASCADE).
export async function bulkDeleteCompanies(companyIds: number[]): Promise<{ deleted: number }> {
  await requireUser();
  if (companyIds.length === 0) return { deleted: 0 };
  await db.delete(companies).where(inArray(companies.id, companyIds));
  revalidateDealViews();
  return { deleted: companyIds.length };
}

// ---------- Slå sammen selskaper ----------

// Feltene brukeren kan velge vinner for i sammenslåings-dialogen —
// tekniske/utledede felt (domain, logoUrl, brregVerified osv.) håndteres
// i stedet automatisk i mergeCompanies (behold hovedselskapets verdi,
// ellers første ikke-tomme). Kan ikke eksporteres herfra — en "use
// server"-fil kan bare eksportere async-funksjoner.
const MERGEABLE_COMPANY_FIELDS = [
  "name",
  "orgName",
  "orgNumber",
  "ownerId",
  "businessUnitId",
  "primaryContactId",
  "website",
  "phone",
  "address",
  "postalCode",
  "city",
  "employees",
  "industry",
  "ceoName",
  "revenue",
  "profit",
  "fiscalYear",
] as const;

export interface MergeCandidate {
  id: number;
  name: string;
  domain: string | null;
  website: string | null;
  logoUrl: string | null;
  orgName: string | null;
  orgNumber: string | null;
  ownerId: number | null;
  ownerName: string | null;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  employees: number | null;
  industry: string | null;
  ceoName: string | null;
  revenue: number | null;
  profit: number | null;
  fiscalYear: string | null;
  primaryContactId: number | null;
  primaryContactName: string | null;
  businessUnitId: number | null;
  businessUnitName: string | null;
  dealCount: number;
  peopleCount: number;
}

// Henter alt en sammenslåings-dialog trenger for de valgte selskapene,
// inkl. utledede navn for eier/hovedkontakt/vårt selskap og noen nøkkeltall
// (antall deals/personer) så brukeren kan se hvilket selskap som virker
// "riktigst" å beholde som hovedselskap.
export async function getCompaniesForMerge(companyIds: number[]): Promise<MergeCandidate[]> {
  await requireUser();
  if (companyIds.length < 2) return [];

  const rows = await db.query.companies.findMany({ where: inArray(companies.id, companyIds) });

  const ownerIds = [...new Set(rows.map((c) => c.ownerId).filter((id): id is number => id != null))];
  const contactIds = [
    ...new Set(rows.map((c) => c.primaryContactId).filter((id): id is number => id != null)),
  ];
  const buIds = [
    ...new Set(rows.map((c) => c.businessUnitId).filter((id): id is number => id != null)),
  ];

  const [ownerRows, contactRows, buRows, dealRows, peopleLinks] = await Promise.all([
    ownerIds.length ? db.query.users.findMany({ where: inArray(users.id, ownerIds) }) : [],
    contactIds.length ? db.query.people.findMany({ where: inArray(people.id, contactIds) }) : [],
    buIds.length ? db.query.businessUnits.findMany({ where: inArray(businessUnits.id, buIds) }) : [],
    db.query.deals.findMany({ where: inArray(deals.companyId, companyIds) }),
    db.query.companyPeople.findMany({ where: inArray(companyPeople.companyId, companyIds) }),
  ]);

  const ownerNameById = new Map(ownerRows.map((u) => [u.id, u.name]));
  const contactNameById = new Map(contactRows.map((p) => [p.id, p.name]));
  const buNameById = new Map(buRows.map((b) => [b.id, b.name]));
  const dealCountByCompany = new Map<number, number>();
  for (const d of dealRows) {
    dealCountByCompany.set(d.companyId, (dealCountByCompany.get(d.companyId) ?? 0) + 1);
  }
  const peopleCountByCompany = new Map<number, number>();
  for (const link of peopleLinks) {
    peopleCountByCompany.set(link.companyId, (peopleCountByCompany.get(link.companyId) ?? 0) + 1);
  }

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    website: c.website,
    logoUrl: c.logoUrl,
    orgName: c.orgName,
    orgNumber: c.orgNumber,
    ownerId: c.ownerId,
    ownerName: c.ownerId != null ? (ownerNameById.get(c.ownerId) ?? null) : null,
    phone: c.phone,
    address: c.address,
    postalCode: c.postalCode,
    city: c.city,
    employees: c.employees,
    industry: c.industry,
    ceoName: c.ceoName,
    revenue: c.revenue,
    profit: c.profit,
    fiscalYear: c.fiscalYear,
    primaryContactId: c.primaryContactId,
    primaryContactName:
      c.primaryContactId != null ? (contactNameById.get(c.primaryContactId) ?? null) : null,
    businessUnitId: c.businessUnitId,
    businessUnitName: c.businessUnitId != null ? (buNameById.get(c.businessUnitId) ?? null) : null,
    dealCount: dealCountByCompany.get(c.id) ?? 0,
    peopleCount: peopleCountByCompany.get(c.id) ?? 0,
  }));
}

// Slår sammen flere selskaper til ett: `keepId` overlever, `mergeIds`
// slettes etter at alt tilhørende data er flyttet over. `overrides` sier
// hvilket selskap sin verdi som skal vinne for de feltene brukeren fikk
// velge mellom i dialogen (felt uten override beholder keepId sin egen
// verdi uendret). Rekkefølgen under er bevisst: metadata og relaterte
// rader flyttes FØR de tapende selskapene slettes, slik at en feil
// underveis aldri etterlater data koblet til et slettet selskap.
export async function mergeCompanies(
  keepId: number,
  mergeIds: number[],
  overrides: Record<string, number>
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const loserIds = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (loserIds.length === 0) {
    return { ok: false, message: "Velg minst to selskaper å slå sammen." };
  }

  try {
    const allIds = [keepId, ...loserIds];
    const rows = await db.query.companies.findMany({ where: inArray(companies.id, allIds) });
    const byId = new Map(rows.map((c) => [c.id, c as Record<string, unknown>]));
    if (!byId.has(keepId) || loserIds.some((id) => !byId.has(id))) {
      return { ok: false, message: "Fant ikke ett eller flere av selskapene." };
    }

    const set: Record<string, unknown> = {};
    for (const field of MERGEABLE_COMPANY_FIELDS) {
      const sourceId = overrides[field];
      if (sourceId != null && sourceId !== keepId && byId.has(sourceId)) {
        set[field] = byId.get(sourceId)![field];
      }
    }

    // Brreg-status følger samme selskap som organisasjonsnummeret ble
    // hentet fra, slik at "bekreftet"-merket ikke havner løsrevet fra
    // hvilket org.nr som faktisk ble valgt.
    const orgNumberSourceId = overrides.orgNumber ?? keepId;
    if (orgNumberSourceId !== keepId && byId.has(orgNumberSourceId)) {
      const source = byId.get(orgNumberSourceId)!;
      set.brregVerified = source.brregVerified;
      set.brregSyncedAt = source.brregSyncedAt;
      set.industryCode = source.industryCode;
    }

    // Domene/logo har ingen egen velger — behold hovedselskapets verdi
    // hvis satt, ellers første ikke-tomme blant de andre.
    for (const field of ["domain", "logoUrl"] as const) {
      const keepValue = byId.get(keepId)![field];
      if (keepValue == null || keepValue === "") {
        for (const id of loserIds) {
          const v = byId.get(id)![field];
          if (v != null && v !== "") {
            set[field] = v;
            break;
          }
        }
      }
    }

    if (Object.keys(set).length > 0) {
      await db.update(companies).set(set).where(eq(companies.id, keepId));
    }

    await db.update(deals).set({ companyId: keepId }).where(inArray(deals.companyId, loserIds));
    await db
      .update(contactEvents)
      .set({ companyId: keepId })
      .where(inArray(contactEvents.companyId, loserIds));
    await db
      .update(emailMessages)
      .set({ companyId: keepId })
      .where(inArray(emailMessages.companyId, loserIds));
    await db
      .update(emailAccessGrants)
      .set({ companyId: keepId })
      .where(inArray(emailAccessGrants.companyId, loserIds));

    // company_people har UNIQUE(company_id, person_id) — flytt kun
    // koblinger som ikke allerede finnes på det gjenværende selskapet,
    // resten (duplikater) slettes i stedet for å flyttes.
    const existingLinks = await db.query.companyPeople.findMany({
      where: eq(companyPeople.companyId, keepId),
    });
    const linkedPersonIds = new Set(existingLinks.map((l) => l.personId));
    const movingLinks = await db.query.companyPeople.findMany({
      where: inArray(companyPeople.companyId, loserIds),
    });
    for (const link of movingLinks) {
      if (linkedPersonIds.has(link.personId)) {
        await db.delete(companyPeople).where(eq(companyPeople.id, link.id));
      } else {
        await db
          .update(companyPeople)
          .set({ companyId: keepId })
          .where(eq(companyPeople.id, link.id));
        linkedPersonIds.add(link.personId);
      }
    }

    await db.delete(companies).where(inArray(companies.id, loserIds));

    // Hent fersk offisiell info fra Enhetsregisteret på det gjenværende
    // selskapet — sikrer at man alltid ender opp med komplett bedriftsinfo
    // etter en sammenslåing, ikke bare det som tilfeldigvis lå på ett av de
    // opprinnelige duplikatene. Beste innsats: feiler oppslaget (f.eks. nett),
    // skal ikke selve sammenslåingen rapporteres som mislykket.
    let brregNote = "";
    const merged = await db.query.companies.findFirst({ where: eq(companies.id, keepId) });
    if (merged?.orgNumber) {
      const res = await syncCompanyFromBrreg(keepId).catch(() => null);
      if (res?.ok) brregNote = " Oppdatert mot Enhetsregisteret.";
    } else if (merged) {
      const res = await autoMatchCompany(keepId).catch(() => null);
      if (res?.matched) brregNote = " Koblet mot Enhetsregisteret.";
    }

    revalidateDealViews();
    revalidatePath("/companies");
    revalidatePath(`/companies/${keepId}`);
    return { ok: true, message: `Slo sammen ${loserIds.length + 1} selskaper.${brregNote}` };
  } catch (err) {
    console.error("mergeCompanies feilet", err);
    return {
      ok: false,
      message: "Sammenslåing feilet underveis. Sjekk selskapene og prøv igjen.",
    };
  }
}

export interface DuplicateGroup {
  reason: "orgnr" | "domene" | "navn";
  matchValue: string;
  companies: {
    id: number;
    name: string;
    orgNumber: string | null;
    domain: string | null;
    dealCount: number;
  }[];
}

// Finner sannsynlige duplikat-selskaper for hurtig-sammenslåing i
// innstillinger — sjekker fra sikrest til svakest signal, og lar hvert
// selskap inngå i maks én gruppe (det sterkeste signalet vinner).
export async function findDuplicateCompanies(): Promise<DuplicateGroup[]> {
  await requireUser();
  const rows = await db.query.companies.findMany({ orderBy: [asc(companies.name)] });
  const dealRows = await db.query.deals.findMany();
  const dealCountByCompany = new Map<number, number>();
  for (const d of dealRows) {
    dealCountByCompany.set(d.companyId, (dealCountByCompany.get(d.companyId) ?? 0) + 1);
  }

  function toLite(c: (typeof rows)[number]) {
    return {
      id: c.id,
      name: c.name,
      orgNumber: c.orgNumber,
      domain: c.domain,
      dealCount: dealCountByCompany.get(c.id) ?? 0,
    };
  }

  const groups: DuplicateGroup[] = [];
  const grouped = new Set<number>();

  function collectGroups(
    reason: DuplicateGroup["reason"],
    keyFor: (c: (typeof rows)[number]) => string | null
  ) {
    const byKey = new Map<string, (typeof rows)[number][]>();
    for (const c of rows) {
      if (grouped.has(c.id)) continue;
      const key = keyFor(c);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(c);
      byKey.set(key, list);
    }
    for (const [key, list] of byKey) {
      if (list.length < 2) continue;
      groups.push({ reason, matchValue: key, companies: list.map(toLite) });
      for (const c of list) grouped.add(c.id);
    }
  }

  // Sikrest først: samme org.nr, så samme nettside-domene, og til slutt
  // likt normalisert navn (fjerner AS/ASA/tegnsetting) som svakeste signal.
  collectGroups("orgnr", (c) => c.orgNumber || null);
  collectGroups("domene", (c) => c.domain || null);
  collectGroups("navn", (c) => normalizeName(c.name) || null);

  return groups;
}

// ---------- Kontakt med selskap ----------

export async function logContact(companyId: number, formData: FormData) {
  const me = await requireUser();
  const kind = String(formData.get("kind") ?? "moete");
  const note = String(formData.get("note") ?? "").trim() || null;
  const dateStr = String(formData.get("occurredAt") ?? "");
  const occurredAt = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();

  await db.insert(contactEvents).values({
    companyId,
    userId: me.id,
    kind,
    note,
    occurredAt,
  });

  revalidateDealViews();
}

export async function deleteContactEvent(eventId: number, companyId: number) {
  await requireUser();
  await db
    .delete(contactEvents)
    .where(and(eq(contactEvents.id, eventId), eq(contactEvents.companyId, companyId)));
  revalidateDealViews();
}

// ---------- Notater ----------

export async function addNote(dealId: number, formData: FormData) {
  const me = await requireUser();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  await db.insert(activities).values({ dealId, userId: me.id, type: "note", content });
  revalidateDealViews(dealId);
}

// ---------- E-postkonto ----------

export async function connectEmailAccount(formData: FormData) {
  const me = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").replace(/\s+/g, "");
  const imapHost = String(formData.get("imapHost") ?? "imap.gmail.com").trim();
  if (!email || !password) redirect("/settings?error=imap");

  const existing = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  const values = {
    email,
    imapHost,
    imapPort: 993,
    imapUser: email,
    passwordEnc: encrypt(password),
    lastError: null,
  };
  if (existing) {
    await db.update(emailAccounts).set(values).where(eq(emailAccounts.id, existing.id));
  } else {
    await db.insert(emailAccounts).values({ ...values, userId: me.id });
  }
  revalidatePath("/settings");
  redirect("/settings?connected=1");
}

export async function disconnectEmailAccount() {
  const me = await requireUser();
  await db.delete(emailAccounts).where(eq(emailAccounts.userId, me.id));
  revalidatePath("/settings");
}

export async function updateSignature(formData: FormData) {
  const me = await requireUser();
  const signature = String(formData.get("signature") ?? "");
  await db
    .update(users)
    .set({ signature: signature.trim() ? signature : null })
    .where(eq(users.id, me.id));
  revalidatePath("/settings");
}

// Markerer onboarding-gjennomgangen som sett — enten fullført eller lukket
// underveis — slik at den ikke dukker opp igjen ved neste innlogging.
export async function completeOnboarding() {
  const me = await requireUser();
  await db.update(users).set({ onboardingSeenAt: new Date() }).where(eq(users.id, me.id));
  revalidatePath("/", "layout");
}

const THEMES = ["lys", "dark", "elguide"] as const;

export async function updateTheme(formData: FormData) {
  const me = await requireUser();
  const theme = String(formData.get("theme") ?? "");
  if (!THEMES.includes(theme as (typeof THEMES)[number])) return;
  await db.update(users).set({ theme }).where(eq(users.id, me.id));
  // Selve <html data-theme> settes i rotlayouten, som ligger over (app)-gruppen.
  revalidatePath("/", "layout");
}

export async function syncEmailsNow(): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  if (!account) return { ok: false, message: "Ingen e-postkonto er koblet til." };
  const result = await syncAccount(account);
  revalidatePath("/settings");
  revalidateDealViews();
  if (result.error) return { ok: false, message: `Synk feilet: ${result.error}` };
  if (result.capped) {
    return {
      ok: true,
      message: `Delvis synk — ${result.matched} nye e-poster koblet til (${result.scanned} gjennomgått). Kontoen har mer historikk enn det som får plass i én kjøring; kjør synk på nytt for å fortsette.`,
    };
  }
  return {
    ok: true,
    message: `Synk ferdig — ${result.matched} nye e-poster koblet til selskaper (${result.scanned} gjennomgått).`,
  };
}

// ---------- Google Kalender ----------

export async function startGoogleCalendarAuth() {
  const me = await requireUser();
  if (!isGoogleCalendarConfigured()) {
    redirect("/settings?error=kalender-ikke-satt-opp");
  }
  const state = await signCalendarState(me.id);
  redirect(buildGoogleAuthUrl(state));
}

export async function disconnectGoogleCalendar() {
  const me = await requireUser();
  await db.delete(calendarAccounts).where(eq(calendarAccounts.userId, me.id));
  revalidatePath("/settings");
}

// Henter møter i et vindu (30 dager tilbake, 14 dager frem) fra den
// tilkoblede Google-kalenderen, og logger et møte som kontakthistorikk
// (contact_events, kind="moete") på hver kunde der BÅDE minst én av oss OG
// minst én person knyttet til kunden var blant deltakerne på samme hendelse.
export async function syncGoogleCalendarNow(): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const account = await db.query.calendarAccounts.findFirst({
    where: eq(calendarAccounts.userId, me.id),
  });
  if (!account) return { ok: false, message: "Ingen kalender er koblet til." };

  try {
    const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));

    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const events = await fetchCalendarEvents(accessToken, timeMin, timeMax);

    const allUsers = await db.query.users.findMany();
    const ourEmailToUser = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));

    const peopleWithCompany = await db
      .select({
        personEmail: people.email,
        companyId: companyPeople.companyId,
      })
      .from(companyPeople)
      .innerJoin(people, eq(companyPeople.personId, people.id));

    const emailToCompanyIds = new Map<string, Set<number>>();
    for (const row of peopleWithCompany) {
      if (!row.personEmail) continue;
      const email = row.personEmail.toLowerCase();
      const set = emailToCompanyIds.get(email) ?? new Set<number>();
      set.add(row.companyId);
      emailToCompanyIds.set(email, set);
    }

    let logged = 0;
    for (const event of events) {
      if (!event.startedAt) continue;

      const hasOurAttendee = event.attendeeEmails.some((email) => ourEmailToUser.has(email));
      if (!hasOurAttendee) continue;

      const matchedCompanyIds = new Set<number>();
      for (const email of event.attendeeEmails) {
        const companyIds = emailToCompanyIds.get(email);
        if (companyIds) for (const id of companyIds) matchedCompanyIds.add(id);
      }
      if (matchedCompanyIds.size === 0) continue;

      for (const companyId of matchedCompanyIds) {
        // Unngår duplikater ved gjentatt synk av samme møte.
        const already = await db.query.contactEvents.findFirst({
          where: and(
            eq(contactEvents.companyId, companyId),
            eq(contactEvents.kind, "moete"),
            eq(contactEvents.occurredAt, event.startedAt)
          ),
        });
        if (already) continue;

        await db.insert(contactEvents).values({
          companyId,
          userId: me.id,
          kind: "moete",
          note: event.summary,
          occurredAt: event.startedAt,
        });
        logged++;
      }
    }

    await db
      .update(calendarAccounts)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(calendarAccounts.id, account.id));
    revalidateDealViews();
    revalidatePath("/settings");
    return { ok: true, message: `Synk fullført — ${logged} nye møter logget.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(calendarAccounts)
      .set({ lastError: message })
      .where(eq(calendarAccounts.id, account.id));
    return { ok: false, message: `Synk feilet: ${message}` };
  }
}

// ---------- Pristilbud på e-post ----------

export async function sendQuoteEmail(
  dealId: number,
  recipients: string[]
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const clean = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return { ok: false, message: "Velg minst én mottaker." };

  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  if (!account) {
    return { ok: false, message: "Du må koble til e-postkontoen din i Innstillinger først." };
  }

  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return { ok: false, message: "Fant ikke dealen." };
  const company = await db.query.companies.findFirst({ where: eq(companies.id, deal.companyId) });
  if (!company) return { ok: false, message: "Fant ikke selskapet." };

  const lines = await db.query.dealLines.findMany({ where: eq(dealLines.dealId, dealId) });
  if (lines.length === 0) {
    return { ok: false, message: "Ingen varelinjer å sende — legg til priser under Prisverktøy først." };
  }

  const dateLabel = formatDateShort(new Date());
  const pdfBuffer = await generateQuotePdf({
    companyName: company.name,
    dealTitle: deal.title,
    dateLabel,
    lines: lines.map((l) => ({
      title: l.billingType === "recurring" ? `${l.title} (× ${lineMultiplier(l)} mnd)` : l.title,
      sum: l.hours * l.rate * lineMultiplier(l),
    })),
  });

  const filename = `${company.name} - ${deal.title}, ${dateLabel}.pdf`;
  const subject = `Cure for ${company.name} - Pristilbud: ${deal.title}, ${dateLabel}`;
  const text = [`Hei,`, ``, `Se vedlagt PDF for estimat på pris for «${deal.title}».`]
    .concat(me.signature ? ["", me.signature] : [])
    .join("\n");

  try {
    await sendMailFromAccount(account, {
      fromName: me.name,
      to: clean,
      subject,
      text,
      attachment: { filename, content: pdfBuffer },
    });
  } catch (err) {
    return {
      ok: false,
      message: `Sending feilet: ${err instanceof Error ? err.message : "ukjent feil"}`,
    };
  }

  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "contact",
    content: `Pristilbud sendt til ${clean.join(", ")}`,
  });
  await db.insert(contactEvents).values({
    companyId: company.id,
    userId: me.id,
    kind: "tilbud",
    note: `Pristilbud: ${deal.title}`,
    occurredAt: new Date(),
  });
  revalidateDealViews(dealId);

  return { ok: true, message: `Pristilbud sendt til ${clean.join(", ")}.` };
}

// ---------- Tilgang til e-postdialog ----------

export async function requestEmailAccess(companyId: number, ownerUserId: number) {
  const me = await requireUser();
  if (me.id === ownerUserId) return;
  await db
    .insert(emailAccessGrants)
    .values({ companyId, ownerUserId, granteeUserId: me.id, status: "requested" })
    .onConflictDoUpdate({
      target: [
        emailAccessGrants.companyId,
        emailAccessGrants.ownerUserId,
        emailAccessGrants.granteeUserId,
      ],
      set: { status: "requested", respondedAt: null },
    });
  revalidateDealViews();
}

export async function respondEmailAccess(grantId: number, grant: boolean) {
  const me = await requireUser();
  const request = await db.query.emailAccessGrants.findFirst({
    where: and(eq(emailAccessGrants.id, grantId), eq(emailAccessGrants.ownerUserId, me.id)),
  });
  if (!request) return;
  await db
    .update(emailAccessGrants)
    .set({ status: grant ? "granted" : "denied", respondedAt: new Date() })
    .where(eq(emailAccessGrants.id, grantId));
  revalidateDealViews();
}
