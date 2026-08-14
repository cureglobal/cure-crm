import { desc, eq, asc } from "drizzle-orm";
import { db, deals as dealsTable, companies, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toDateInputValue } from "@/lib/format";
import { getStages } from "@/lib/stages.server";
import { getBusinessUnits } from "@/lib/businessUnits.server";
import PipelineView from "@/components/PipelineView";
import NewDealButton from "@/components/NewDealButton";
import type { DealRow } from "@/components/DealsTable";

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const me = await requireUser();
  const params = await searchParams;
  // Udefinert når parameteret ikke er i URL-en — da bestemmer klientens
  // lagrede preferanser (eller standardverdiene) i stedet. Se PipelineView.
  const initialView =
    params.view === "liste" ? "liste" : params.view === "kanban" ? "kanban" : undefined;

  const rows = await db
    .select({
      id: dealsTable.id,
      title: dealsTable.title,
      stage: dealsTable.stage,
      value: dealsTable.value,
      updatedAt: dealsTable.updatedAt,
      followUpAt: dealsTable.followUpAt,
      comment: dealsTable.comment,
      ownerId: dealsTable.ownerId,
      companyId: dealsTable.companyId,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
      companyBusinessUnitId: companies.businessUnitId,
    })
    .from(dealsTable)
    .innerJoin(companies, eq(dealsTable.companyId, companies.id))
    .orderBy(desc(dealsTable.updatedAt));

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const ownerNames = new Map(allUsers.map((u) => [u.id, u.name]));
  const ownerAvatars = new Map(allUsers.map((u) => [u.id, u.avatarDataUrl]));

  const coOwnerRows = await db.query.dealOwners.findMany();
  const coOwnerIdsByDeal = new Map<number, number[]>();
  for (const r of coOwnerRows) {
    const list = coOwnerIdsByDeal.get(r.dealId) ?? [];
    list.push(r.userId);
    coOwnerIdsByDeal.set(r.dealId, list);
  }

  const companyOptions = (
    await db.query.companies.findMany({ orderBy: [asc(companies.name)] })
  ).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl }));

  const lineDealIds = new Set(
    (await db.query.dealLines.findMany()).map((l) => l.dealId)
  );

  const stages = await getStages();
  const businessUnits = await getBusinessUnits();
  const stageOrder = new Map(stages.map((s, i) => [String(s.id), i]));
  const dealRows: DealRow[] = [...rows]
    .sort((a, b) => (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99))
    .map((d) => ({
      id: d.id,
      companyName: d.companyName,
      logoUrl: d.logoUrl,
      companyBusinessUnitId: d.companyBusinessUnitId,
      ownerId: d.ownerId,
      ownerName: ownerNames.get(d.ownerId) ?? "",
      ownerAvatarUrl: ownerAvatars.get(d.ownerId) ?? null,
      coOwnerIds: coOwnerIdsByDeal.get(d.id) ?? [],
      title: d.title,
      stage: d.stage,
      value: d.value,
      hasLines: lineDealIds.has(d.id),
      updatedAt: d.updatedAt.getTime(),
      followUpAt: d.followUpAt ? d.followUpAt.getTime() : null,
      followUpInput: toDateInputValue(d.followUpAt),
      comment: d.comment ?? "",
    }));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-ink-soft">
            Alle deals — filtrer, sorter og rediger rett i tabellen.
          </p>
        </div>
        <NewDealButton companies={companyOptions} />
      </div>

      <PipelineView
        rows={dealRows}
        stages={stages}
        owners={allUsers.map((u) => ({ id: u.id, name: u.name, avatarDataUrl: u.avatarDataUrl }))}
        businessUnits={businessUnits.map((b) => ({ id: b.id, name: b.name }))}
        currentUserId={me.id}
        initialView={initialView}
        initialDatePreset={
          params.dato === "uke" || params.dato === "forfalt" || params.dato === "idag"
            ? params.dato
            : undefined
        }
        initialOnlyActive={
          params.aktive === "1" ? true : params.aktive === "0" ? false : undefined
        }
        initialGroupByStage={
          params.gruppe === "fase" ? true : params.gruppe === "flat" ? false : undefined
        }
      />
    </div>
  );
}
