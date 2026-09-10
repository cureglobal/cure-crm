"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  companies,
  deals,
  people,
  companyPeople,
  activities,
  dealTags,
  personTags,
  companyTags } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { firstStageId } from "@/lib/stages";
import {
  revalidateDealViews } from "./_shared";
import { autoMatchCompany, syncCompanyFromBrreg } from "./companies";

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
  pipelineId: number,
  tagIds: number[] = []
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
  const importedDealIds: number[] = [];

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
    importedDealIds.push(deal.id);
    results.push({ companyName, dealTitle, status: "imported" });
  }

  for (const tagId of tagIds) {
    for (const dealId of importedDealIds) {
      await db.insert(dealTags).values({ dealId, tagId }).onConflictDoNothing();
    }
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

export async function importCompanies(
  rows: ImportCompanyRow[],
  tagIds: number[] = []
): Promise<{
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
  const createdCompanyIds: number[] = [];

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
    createdCompanyIds.push(company.id);

    // Hent offisielle data: direkte når orgnummer finnes, ellers prøv å matche.
    if (orgNumber.length === 9) {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
      verified++;
    } else {
      const res = await autoMatchCompany(company.id);
      if (res.matched) verified++;
    }
  }

  for (const tagId of tagIds) {
    for (const companyId of createdCompanyIds) {
      await db.insert(companyTags).values({ companyId, tagId }).onConflictDoNothing();
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

export async function importPeople(
  rows: ImportPersonRow[],
  tagIds: number[] = []
): Promise<{
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
  const createdPersonIds: number[] = [];

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
      createdPersonIds.push(personId);
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

  for (const tagId of tagIds) {
    for (const personId of createdPersonIds) {
      await db.insert(personTags).values({ personId, tagId }).onConflictDoNothing();
    }
  }

  revalidateDealViews();
  revalidatePath("/people");
  return { created, linked, skipped, companiesCreated };
}
