import { asc, eq, sql, isNotNull } from "drizzle-orm";
import { db, companies, deals, people, companyPeople, users, contactEvents, emailMessages } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getBusinessUnits } from "@/lib/businessUnits.server";
import { getTags } from "@/lib/tags.server";
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

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const ownerNames = new Map(allUsers.map((u) => [u.id, u.name]));
  const ownerAvatars = new Map(allUsers.map((u) => [u.id, u.avatarDataUrl]));

  const coOwnerRows = await db.query.companyOwners.findMany();
  const coOwnerIdsByCompany = new Map<number, number[]>();
  for (const r of coOwnerRows) {
    const list = coOwnerIdsByCompany.get(r.companyId) ?? [];
    list.push(r.userId);
    coOwnerIdsByCompany.set(r.companyId, list);
  }

  const tagOptions = await getTags("company");
  const tagLinks = await db.query.companyTags.findMany();
  const tagIdsByCompany = new Map<number, number[]>();
  for (const l of tagLinks) {
    const list = tagIdsByCompany.get(l.companyId) ?? [];
    list.push(l.tagId);
    tagIdsByCompany.set(l.companyId, list);
  }

  // "Sist kontakt" = nyeste av manuelt loggført kontakt og synket e-post —
  // samme kombinasjon som bedriftssidens egen "Sist kontakt" (se
  // companies/[id]/page.tsx), bare aggregert på tvers av alle selskap her.
  const lastManualContact = await db
    .select({ companyId: contactEvents.companyId, maxAt: sql<number>`MAX(${contactEvents.occurredAt})` })
    .from(contactEvents)
    .groupBy(contactEvents.companyId);
  const lastEmailContact = await db
    .select({ companyId: emailMessages.companyId, maxAt: sql<number>`MAX(${emailMessages.sentAt})` })
    .from(emailMessages)
    .where(isNotNull(emailMessages.sentAt))
    .groupBy(emailMessages.companyId);
  const lastContactByCompany = new Map<number, number>();
  for (const r of lastManualContact) {
    lastContactByCompany.set(r.companyId, Number(r.maxAt));
  }
  for (const r of lastEmailContact) {
    const at = Number(r.maxAt);
    const existing = lastContactByCompany.get(r.companyId);
    if (existing == null || at > existing) lastContactByCompany.set(r.companyId, at);
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
      ownerId: c.ownerId,
      ownerName: c.ownerId == null ? "" : (ownerNames.get(c.ownerId) ?? ""),
      ownerAvatarUrl: c.ownerId == null ? null : (ownerAvatars.get(c.ownerId) ?? null),
      coOwnerIds: coOwnerIdsByCompany.get(c.id) ?? [],
      people: peopleByCompany.get(c.id) ?? [],
      tagIds: tagIdsByCompany.get(c.id) ?? [],
      createdAt: c.createdAt.getTime(),
      lastContactAt: lastContactByCompany.get(c.id) ?? null,
    };
  });

  const totalOpen = allDeals
    .filter((d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage))
    .reduce((acc, d) => acc + (d.value ?? 0), 0);
  const totalWon = allDeals
    .filter((d) => wonStageIds.has(d.stage))
    .reduce((acc, d) => acc + (d.value ?? 0), 0);

  const businessUnitRows = await getBusinessUnits();

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
        owners={allUsers.map((u) => ({ id: u.id, name: u.name, avatarDataUrl: u.avatarDataUrl }))}
        businessUnits={businessUnitRows.map((b) => ({ id: b.id, name: b.name }))}
        tags={tagOptions.map((t) => ({ id: t.id, label: t.label }))}
      />
    </div>
  );
}
