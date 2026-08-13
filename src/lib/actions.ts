"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
  emailAccessGrants,
  dealLines,
  referenceProjects,
  dealOwners,
} from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { domainFromEmail, enrichFromEmail, fallbackNameFromDomain } from "@/lib/enrich";
import {
  fetchBrregCompany,
  matchBrregCompany,
  searchBrreg,
  type BrregHit,
} from "@/lib/brreg";
import { stageLabel, type StageId } from "@/lib/stages";
import { syncAccount } from "@/lib/imap";
import { scanWebsite, type SiteScanResult } from "@/lib/siteScan";
import { PHASES } from "@/lib/estimator";
import * as companyInsight from "@/lib/companyInsight";
import { generateQuotePdf } from "@/lib/pdf";
import { sendMailFromAccount } from "@/lib/mailer";
import { formatDateShort } from "@/lib/format";

function revalidateDealViews(dealId?: number) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
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
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    redirect("/login?error=1");
  }
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
  await db
    .insert(users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 12) });
  revalidatePath("/settings");
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
      stage: "ny",
    })
    .returning();

  await db.insert(activities).values({
    dealId: deal.id,
    userId: me.id,
    type: "created",
    content: email ? `Deal opprettet fra ${email}` : "Deal opprettet",
  });

  revalidateDealViews(deal.id);
  redirect(`/leads/${deal.id}`);
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

  const [deal] = await db
    .insert(deals)
    .values({
      companyId,
      title,
      ownerId: me.id,
      stage: "ny",
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
  redirect(`/leads/${deal.id}`);
}

export async function updateDealStage(dealId: number, stage: StageId) {
  const me = await requireUser();
  await db
    .update(deals)
    .set({ stage, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "stage",
    content: `Flyttet til «${stageLabel(stage)}»`,
  });
  revalidateDealViews(dealId);
}

export async function updateDealDetails(dealId: number, formData: FormData) {
  await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return;

  const title = String(formData.get("dealTitle") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const hasValueField = formData.has("value");
  const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");

  await db
    .update(deals)
    .set({
      ...(title ? { title } : {}),
      comment,
      // Verdi styres av varelinjene når de finnes; da sendes ikke feltet inn.
      ...(hasValueField ? { value: valueRaw ? Number(valueRaw) : null } : {}),
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

// Inline-redigering fra listevisningen: kun feltene som sendes inn oppdateres.
export async function updateDealInline(dealId: number, formData: FormData) {
  await requireUser();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (formData.has("title")) {
    const title = String(formData.get("title") ?? "").trim();
    if (title) set.title = title;
  }
  if (formData.has("comment")) {
    set.comment = String(formData.get("comment") ?? "").trim() || null;
  }
  if (formData.has("followUpAt")) {
    const dateStr = String(formData.get("followUpAt") ?? "");
    set.followUpAt = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  }
  if (formData.has("value")) {
    const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
    set.value = valueRaw ? Number(valueRaw) : null;
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

// ---------- Varelinjer ----------

async function recalcDealValue(dealId: number) {
  const lines = await db.query.dealLines.findMany({
    where: eq(dealLines.dealId, dealId),
  });
  const total =
    lines.length === 0
      ? null
      : Math.round(lines.reduce((acc, l) => acc + l.hours * l.rate, 0));
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
  await db.insert(dealLines).values({ dealId, title, hours, rate });
  await recalcDealValue(dealId);
  revalidateDealViews(dealId);
}

export async function updateDealLine(lineId: number, dealId: number, formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const hours = Number(String(formData.get("hours") ?? "0").replace(",", "."));
  const rate = Number(String(formData.get("rate") ?? "0").replace(/[^\d]/g, ""));
  if (!title || !Number.isFinite(hours) || hours < 0) return;
  await db
    .update(dealLines)
    .set({ title, hours, rate })
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

export async function importProductiveDeals(rows: ImportDealRow[]): Promise<{
  imported: number;
  skipped: number;
  companiesCreated: number;
}> {
  const me = await requireUser();
  const validStages = new Set(["ny", "kontaktet", "dialog", "tilbud", "vunnet", "tapt"]);

  const companyByName = new Map<string, number>();
  for (const c of await db.query.companies.findMany()) {
    companyByName.set(c.name.trim().toLowerCase(), c.id);
  }
  const existingDeals = new Set<string>();
  for (const d of await db.query.deals.findMany()) {
    existingDeals.add(`${d.companyId}::${d.title.trim().toLowerCase()}`);
  }

  let imported = 0;
  let skipped = 0;
  let companiesCreated = 0;

  for (const row of rows.slice(0, 500)) {
    const companyName = String(row.companyName ?? "").trim();
    const dealTitle = String(row.dealTitle ?? "").trim() || "Deal";
    if (!companyName) continue;

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
        stage: validStages.has(row.stage) ? row.stage : "ny",
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
  }

  revalidateDealViews();
  return { imported, skipped, companiesCreated };
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
  revalidatePath("/leads/[id]", "page");
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

// ---------- Selskap ----------

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

  // Setter brukeren orgnummeret selv, regnes selskapet som bekreftet og vi
  // henter offisielle data med én gang.
  if (manualOrgNumber) {
    await syncCompanyFromBrreg(companyId, manualOrgNumber, { verified: true });
  }

  revalidateDealViews();
  revalidatePath(`/companies/${companyId}`);
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
export async function autoMatchAllCompanies(): Promise<{
  checked: number;
  matched: number;
  unresolved: string[];
}> {
  await requireUser();
  const pending = await db.query.companies.findMany({
    where: eq(companies.brregVerified, false),
  });

  let matched = 0;
  const unresolved: string[] = [];
  for (const company of pending) {
    const res = await autoMatchCompany(company.id);
    if (res.matched) matched++;
    else unresolved.push(company.name);
  }

  revalidateDealViews();
  return { checked: pending.length, matched, unresolved };
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
    lines: lines.map((l) => ({ title: l.title, sum: l.hours * l.rate })),
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
