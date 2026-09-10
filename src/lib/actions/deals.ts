"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  people,
  companyPeople,
  activities,
  emailAccounts,
  emailMessages,
  emailAccessGrants,
  dealLines,
  dealOwners,
  stages,
  lostReasons,
  tags,
  dealTags,
  personTags } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { domainFromEmail, enrichFromEmail, fallbackNameFromDomain } from "@/lib/enrich";
import {
  normalizeName } from "@/lib/brreg";
import { getDefaultStageId } from "@/lib/stages.server";
import { getDefaultPipelineId } from "@/lib/pipelines.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { formatMoney } from "@/lib/format";
import {
  bulkDealMessageContext,
  formatNameList,
  linkPersonByEmail,
  notifyDealOwnerAssigned,
  recalcDealValue,
  revalidateDealViews,
  taggedNames,
  todayFollowUpDate } from "./_shared";
import { autoMatchCompany, syncCompanyFromBrreg } from "./companies";

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

  const tagIds = formData
    .getAll("tagIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (tagIds.length > 0) {
    await db
      .insert(dealTags)
      .values(tagIds.map((tagId) => ({ dealId: deal.id, tagId })))
      .onConflictDoNothing();
  }

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

    await notifyDealOwnerAssigned(me.id, deal.id, ownerId);
    for (const coOwnerId of coOwnerIds) {
      if (coOwnerId === ownerId) continue;
      await notifyDealOwnerAssigned(me.id, deal.id, coOwnerId);
    }

    created++;
  }

  revalidateDealViews();
  return { created, companiesCreated };
}

export async function updateDealStage(dealId: number, stage: string) {
  const me = await requireUser();
  const [stageRow, deal] = await Promise.all([
    db.query.stages.findFirst({ where: eq(stages.id, Number(stage)) }),
    db.query.deals.findFirst({ where: eq(deals.id, dealId) }),
  ]);
  if (!deal) return;

  const set: Record<string, unknown> = { stage, updatedAt: new Date() };
  if (stageRow?.isWon) set.closedAt = new Date();

  if (stageRow?.isWon) {
    const [, company, names] = await Promise.all([
      db.update(deals).set(set).where(eq(deals.id, dealId)),
      db.query.companies.findFirst({ where: eq(companies.id, deal.companyId) }),
      taggedNames(dealId, deal.ownerId),
    ]);
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "won",
      content: `${formatNameList(names)} solgte «${deal.title}» til ${
        company?.name ?? "kunden"
      } for ${formatMoney(deal.value ?? 0)}! 🎉`,
    });
  } else {
    // Vanligste tilfellet (flytting mellom vanlige faser) — oppdatering og
    // aktivitetslogg er uavhengige av hverandre, kjøres samtidig i stedet for
    // i serie. Dette er den hyppigst brukte handlingen i hele appen
    // (dra-og-slipp i Pipeline), så antall runder her merkes godt.
    await Promise.all([
      db.update(deals).set(set).where(eq(deals.id, dealId)),
      db.insert(activities).values({
        dealId,
        userId: me.id,
        type: "stage",
        content: `Flyttet til «${stageRow?.label ?? stage}»`,
      }),
    ]);
  }
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
  const { companyNameById, namesFor } = await bulkDealMessageContext(targetDeals);
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
  }

  await db.insert(activities).values(
    targetDeals.map((deal) => ({
      dealId: deal.id,
      userId: me.id,
      type: "lost",
      content: `${formatNameList(namesFor(deal))} markerte «${deal.title}» hos ${
        companyNameById.get(deal.companyId) ?? "kunden"
      } som tapt (${reasonLabel})${trimmedComment ? `: ${trimmedComment}` : ""}`,
    }))
  );

  revalidateDealViews();
}


// ---------- Varelinjer ----------


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
  await notifyDealOwnerAssigned(me.id, dealId, userId);
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

export interface PersonExportData {
  exportedAt: string;
  person: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    notes: string | null;
    createdAt: string;
  };
  tags: string[];
  companies: { name: string; role: string | null; since: string }[];
  emails: {
    direction: string;
    subject: string | null;
    fromAddr: string | null;
    toAddr: string | null;
    sentAt: string | null;
    bodyText: string | null;
  }[];
}

// GDPR-innsyn/dataportabilitet (art. 15/20): samler alt CRM-et faktisk har
// lagret om én navngitt person — selve personkortet, selskapskoblinger og
// e-poster adressert til/fra e-posten deres. Utelater bevisst frie
// deal-notater (activities) — de er ikke strukturert per person, og å
// grave etter navnetreff i fritekst ville gitt et upålitelig utvalg.
export async function exportPersonData(personId: number): Promise<PersonExportData | null> {
  const me = await requireUser();
  const person = await db.query.people.findFirst({ where: eq(people.id, personId) });
  if (!person) return null;

  const tagRows = await db
    .select({ label: tags.label })
    .from(personTags)
    .innerJoin(tags, eq(personTags.tagId, tags.id))
    .where(eq(personTags.personId, personId));

  const companyRows = await db
    .select({ name: companies.name, role: companyPeople.role, since: companyPeople.createdAt })
    .from(companyPeople)
    .innerJoin(companies, eq(companyPeople.companyId, companies.id))
    .where(eq(companyPeople.personId, personId));

  const email = person.email?.trim().toLowerCase();
  const emailRowsRaw = email
    ? await db
        .select({
          companyId: emailMessages.companyId,
          direction: emailMessages.direction,
          subject: emailMessages.subject,
          fromAddr: emailMessages.fromAddr,
          toAddr: emailMessages.toAddr,
          sentAt: emailMessages.sentAt,
          bodyText: emailMessages.bodyText,
          ownerUserId: emailAccounts.userId,
        })
        .from(emailMessages)
        .innerJoin(emailAccounts, eq(emailMessages.accountId, emailAccounts.id))
        .where(or(like(emailMessages.fromAddr, `%${email}%`), like(emailMessages.toAddr, `%${email}%`)))
    : [];

  // Ikke-admin får bare med e-poster de selv eier eller har fått godkjent
  // innsyn i, akkurat som på selskapssiden — ellers ville "eksporter data"
  // vært en bakvei forbi hele godkjenningsflyten i emailAccessGrants og latt
  // hvem som helst lese en kollegas private dialog. Admin får hele
  // historikken, siden et reelt GDPR-innsynskrav er et virksomhetsansvar.
  let emailRows = emailRowsRaw;
  if (!me.isAdmin) {
    const ownerIds = [...new Set(emailRowsRaw.map((m) => m.ownerUserId))];
    const grants = ownerIds.length
      ? await db.query.emailAccessGrants.findMany({
          where: and(
            eq(emailAccessGrants.granteeUserId, me.id),
            eq(emailAccessGrants.status, "granted"),
            inArray(emailAccessGrants.ownerUserId, ownerIds)
          ),
        })
      : [];
    const grantedPairs = new Set(grants.map((g) => `${g.companyId}:${g.ownerUserId}`));
    emailRows = emailRowsRaw.filter(
      (m) => m.ownerUserId === me.id || grantedPairs.has(`${m.companyId}:${m.ownerUserId}`)
    );
  }

  return {
    exportedAt: new Date().toISOString(),
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      phone: person.phone,
      notes: person.notes,
      createdAt: person.createdAt.toISOString(),
    },
    tags: tagRows.map((t) => t.label),
    companies: companyRows.map((c) => ({
      name: c.name,
      role: c.role,
      since: c.since.toISOString(),
    })),
    emails: emailRows.map((m) => ({
      direction: m.direction,
      subject: m.subject,
      fromAddr: m.fromAddr,
      toAddr: m.toAddr,
      sentAt: m.sentAt ? m.sentAt.toISOString() : null,
      bodyText: m.bodyText,
    })),
  };
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
