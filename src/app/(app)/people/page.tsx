import { asc, eq } from "drizzle-orm";
import { db, people, companies, companyPeople } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import PeopleTable, { type PersonRow } from "@/components/PeopleTable";

export default async function PeoplePage() {
  await requireUser();

  const allPeople = await db.query.people.findMany({ orderBy: [asc(people.name)] });
  const allCompanies = await db.query.companies.findMany({ orderBy: [asc(companies.name)] });

  const links = await db
    .select({
      personId: companyPeople.personId,
      companyId: companies.id,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
      role: companyPeople.role,
    })
    .from(companyPeople)
    .innerJoin(companies, eq(companyPeople.companyId, companies.id))
    .orderBy(asc(companies.name));

  const rows: PersonRow[] = allPeople.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    companies: links
      .filter((l) => l.personId === p.id)
      .map((l) => ({
        id: l.companyId,
        name: l.companyName,
        logoUrl: l.logoUrl,
        role: l.role,
      })),
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Personer</h1>
        <p className="mt-1 text-ink-soft">
          {rows.length} personer · en person kan være knyttet til flere selskaper
        </p>
      </div>
      <PeopleTable
        rows={rows}
        companies={allCompanies.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
