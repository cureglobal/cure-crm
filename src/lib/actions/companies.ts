"use server";

import {
  deleteObject } from "@/lib/objectStorage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  people,
  companyPeople,
  contactEvents,
  emailMessages,
  emailAccessGrants,
  companyOwners,
  businessUnits,
  notifications } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  brregMatchAllLimiter } from "@/lib/rateLimit";
import {
  fetchBrregCompany,
  matchBrregCompany,
  searchBrreg,
  normalizeName,
  type BrregHit } from "@/lib/brreg";
import {
  notifyCompanyOwnerAssigned,
  revalidateDealViews,
  storeUploadedImage } from "./_shared";

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
  const stored = await storeUploadedImage(logo, `logos/${companyId}`);
  if (!stored) return;

  const previous = await db
    .select({ key: companies.logoObjectKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  // logoUrl holder alltid en URL — her en intern /api/media-lenke. Dermed
  // trenger ingen av listevisningene å vite at bildet ligger i R2.
  await db
    .update(companies)
    .set({ logoUrl: stored.url, logoObjectKey: stored.key })
    .where(eq(companies.id, companyId));

  const oldKey = previous[0]?.key;
  if (oldKey && oldKey !== stored.key) await deleteObject(oldKey).catch(() => {});
  revalidatePath(`/companies/${companyId}`);
  revalidateDealViews();
}

export async function updateCompany(companyId: number, formData: FormData) {
  const me = await requireUser();
  const before = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
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

  if (
    typeof set.ownerId === "number" &&
    set.ownerId !== before?.ownerId
  ) {
    await notifyCompanyOwnerAssigned(me.id, companyId, set.ownerId);
  }

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

// Samme idé som syncCompanyFromBrreg/autoMatchCompany, men for våre EGNE
// selskap (business_units) — brukt til kontrakter o.l. som trenger full
// offisiell info (org.nr, adresse, regnskap) på egne juridiske enheter.
export interface BusinessUnitBrregSummary {
  orgNumber: string;
  orgName: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
}

export async function syncBusinessUnitFromBrreg(
  businessUnitId: number,
  orgNumberInput?: string
): Promise<{ ok: boolean; message: string; unit?: BusinessUnitBrregSummary }> {
  await requireUser();
  const unit = await db.query.businessUnits.findFirst({
    where: eq(businessUnits.id, businessUnitId),
  });
  if (!unit) return { ok: false, message: "Fant ikke selskapet." };

  const orgNumber = orgNumberInput?.trim() || unit.orgNumber;
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
    .update(businessUnits)
    .set({
      orgNumber: data.orgNumber,
      orgName: data.name,
      brregVerified: true,
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
    .where(eq(businessUnits.id, businessUnitId));

  revalidatePath("/settings");

  const notes: string[] = [];
  if (data.bankrupt) notes.push("⚠︎ registrert konkurs");
  if (data.liquidating) notes.push("⚠︎ under avvikling");
  return {
    ok: true,
    message: `Oppdatert fra Brønnøysundregistrene${notes.length ? ` — ${notes.join(", ")}` : ""}.`,
    unit: {
      orgNumber: data.orgNumber,
      orgName: data.name,
      address: data.address,
      postalCode: data.postalCode,
      city: data.city,
    },
  };
}

// Slår opp automatisk ut fra navn når orgnummer ikke er satt ennå.
export async function autoMatchBusinessUnit(
  businessUnitId: number
): Promise<{ matched: boolean; message: string; unit?: BusinessUnitBrregSummary }> {
  await requireUser();
  const unit = await db.query.businessUnits.findFirst({
    where: eq(businessUnits.id, businessUnitId),
  });
  if (!unit) return { matched: false, message: "Fant ikke selskapet." };
  if (unit.brregVerified) return { matched: true, message: "Allerede bekreftet." };

  const result = await matchBrregCompany(unit.name, null);
  if (!result.confident || !result.best) {
    return { matched: false, message: result.reason };
  }

  const synced = await syncBusinessUnitFromBrreg(businessUnitId, result.best.orgNumber);
  return { matched: true, message: `Koblet til ${result.best.name}.`, unit: synced.unit };
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
  limited?: boolean;
}> {
  const me = await requireUser();
  if (!brregMatchAllLimiter.tryConsume(String(me.id))) {
    return { checked: 0, matched: 0, unresolved: [], limited: true };
  }
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
  const me = await requireUser();
  if (companyIds.length === 0) return;
  await db.update(companies).set({ ownerId }).where(inArray(companies.id, companyIds));
  if (ownerId != null && ownerId !== me.id) {
    await db.insert(notifications).values(
      companyIds.map((companyId) => ({
        userId: ownerId,
        actorUserId: me.id,
        companyId,
      }))
    );
  }
  revalidateDealViews();
}


// ---------- Med-eiere på selskap ("våre kontakter") ----------
// Speiler mønsteret fra deal-eiere (updateDealOwner/addDealOwner/
// removeDealOwner): companies.ownerId er hovedkontakten, company_owners er
// med-kontaktene, redigerbart fra samme flervalgs-popover som i Pipeline.

export async function updateCompanyOwner(companyId: number, ownerId: number | null) {
  const me = await requireUser();
  if (ownerId != null) {
    const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
    if (!owner) return;
  }
  await db.update(companies).set({ ownerId }).where(eq(companies.id, companyId));
  if (ownerId != null) await notifyCompanyOwnerAssigned(me.id, companyId, ownerId);
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

export async function addCompanyOwner(companyId: number, userId: number) {
  const me = await requireUser();
  await db.insert(companyOwners).values({ companyId, userId }).onConflictDoNothing();
  await notifyCompanyOwnerAssigned(me.id, companyId, userId);
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

export interface BulkMarkContactedResult {
  matchedPeople: number;
  matchedCompanies: number;
  unmatched: string[];
}

// Engangsverktøy: etter en masseutsendelse kan man laste opp CSV-en med hvem
// som ble kontaktet og få «sist kontakt» satt til i dag på selskapene bak.
// Matcher på e-post (det utsendelsen faktisk er basert på), ikke navn — én
// contact_events-rad per RAMT selskap, ikke per person, siden «sist kontakt»
// uansett er selskapsnivå.
export async function bulkMarkContactedByEmail(
  emails: string[],
  note: string
): Promise<BulkMarkContactedResult> {
  const me = await requireUser();
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return { matchedPeople: 0, matchedCompanies: 0, unmatched: [] };

  const allPeople = await db.query.people.findMany();
  const matchedPersonIds: number[] = [];
  const matchedEmails = new Set<string>();
  for (const p of allPeople) {
    const email = (p.email ?? "").trim().toLowerCase();
    if (email && wanted.has(email)) {
      matchedPersonIds.push(p.id);
      matchedEmails.add(email);
    }
  }
  const unmatched = [...wanted].filter((e) => !matchedEmails.has(e)).sort();

  const companyIds = new Set<number>();
  if (matchedPersonIds.length > 0) {
    const links = await db
      .select({ companyId: companyPeople.companyId })
      .from(companyPeople)
      .where(inArray(companyPeople.personId, matchedPersonIds));
    for (const l of links) companyIds.add(l.companyId);
  }

  const occurredAt = new Date();
  const trimmedNote = note.trim() || null;
  if (companyIds.size > 0) {
    await db.insert(contactEvents).values(
      [...companyIds].map((companyId) => ({
        companyId,
        userId: me.id,
        kind: "epost",
        note: trimmedNote,
        occurredAt,
      }))
    );
  }

  revalidateDealViews();
  return { matchedPeople: matchedPersonIds.length, matchedCompanies: companyIds.size, unmatched };
}

export async function deleteContactEvent(eventId: number, companyId: number) {
  await requireUser();
  await db
    .delete(contactEvents)
    .where(and(eq(contactEvents.id, eventId), eq(contactEvents.companyId, companyId)));
  revalidateDealViews();
}
