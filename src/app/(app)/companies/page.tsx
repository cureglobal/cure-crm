import { asc, eq } from "drizzle-orm";
import { db, companies, deals, people, companyPeople, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import CompaniesTable, { type CompanyRow } from "@/components/CompaniesTable";
import NewCompanyButton from "@/components/NewCompanyButton";

export default async function CompaniesPage() {
  await requireUser();
  const stages = await getStages();
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));

  const allCompanies = await db.query.companies.findMany({
    orderBy: [asc(companies.name)],
  });

  const allDeals = await db
    .select({
      companyId: deals.companyId,
      stage: deals.stage,
      value: deals.value,
    })
    .from(deals);

  const links = await db
    .select({ companyId: companyPeople.companyId, name: people.name })
    .from(companyPeople)
    .innerJoin(people, eq(companyPeople.personId, people.id))
    .orderBy(asc(companyPeople.createdAt));

  const peopleByCompany = new Map<number, string[]>();
  for (const l of links) {
    const list = peopleByCompany.get(l.companyId) ?? [];
    list.push(l.name);
    peopleByCompany.set(l.companyId, list);
  }

  const rows: CompanyRow[] = allCompanies.map((c) => {
    const own = allDeals.filter((d) => d.companyId === c.id);
    const open = own.filter((d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage));
    return {
      id: c.id,
      name: c.name,
      orgName: c.orgName,
      orgNumber: c.orgNumber,
      brregVerified: c.brregVerified,
      logoUrl: c.logoUrl,
      website: c.website,
      dealCount: own.length,
      openCount: open.length,
      openValue: open.reduce((acc, d) => acc + (d.value ?? 0), 0),
      wonValue: own
        .filter((d) => wonStageIds.has(d.stage))
        .reduce((acc, d) => acc + (d.value ?? 0), 0),
      people: peopleByCompany.get(c.id) ?? [],
    };
  });

  const totalOpen = rows.reduce((acc, r) => acc + r.openValue, 0);
  const totalWon = rows.reduce((acc, r) => acc + r.wonValue, 0);

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Bedrifter</h1>
          <p className="mt-1 text-ink-soft">
            {rows.length} selskaper · {rows.reduce((a, r) => a + r.dealCount, 0)} deals totalt
          </p>
        </div>
        <NewCompanyButton />
      </div>
      <CompaniesTable
        rows={rows}
        totalOpen={totalOpen}
        totalWon={totalWon}
        owners={allUsers.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
