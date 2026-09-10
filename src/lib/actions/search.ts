"use server";

import { desc, eq, like, or } from "drizzle-orm";
import {
  db,
  companies,
  deals,
  people } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getDealSlugMap } from "@/lib/dealSlugs.server";

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
