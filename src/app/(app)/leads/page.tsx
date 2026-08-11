import { desc, eq, asc } from "drizzle-orm";
import { db, deals as dealsTable, companies, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toDateInputValue } from "@/lib/format";
import { STAGES } from "@/lib/stages";
import PipelineView from "@/components/PipelineView";
import NewDealButton from "@/components/NewDealButton";
import type { DealRow } from "@/components/DealsTable";

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await requireUser();
  const params = await searchParams;
  const initialView = params.view === "liste" ? "liste" : "kanban";

  const rows = await db
    .select({
      id: dealsTable.id,
      title: dealsTable.title,
      stage: dealsTable.stage,
      value: dealsTable.value,
      followUpAt: dealsTable.followUpAt,
      comment: dealsTable.comment,
      ownerId: dealsTable.ownerId,
      companyId: dealsTable.companyId,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
    })
    .from(dealsTable)
    .innerJoin(companies, eq(dealsTable.companyId, companies.id))
    .orderBy(desc(dealsTable.updatedAt));

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const ownerNames = new Map(allUsers.map((u) => [u.id, u.name]));

  const companyOptions = (
    await db.query.companies.findMany({ orderBy: [asc(companies.name)] })
  ).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl }));

  const lineDealIds = new Set(
    (await db.query.dealLines.findMany()).map((l) => l.dealId)
  );

  const stageOrder = new Map(STAGES.map((s, i) => [s.id as string, i]));
  const dealRows: DealRow[] = [...rows]
    .sort((a, b) => (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99))
    .map((d) => ({
      id: d.id,
      companyName: d.companyName,
      logoUrl: d.logoUrl,
      ownerId: d.ownerId,
      ownerName: ownerNames.get(d.ownerId) ?? "",
      title: d.title,
      stage: d.stage,
      value: d.value,
      hasLines: lineDealIds.has(d.id),
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
        owners={allUsers.map((u) => ({ id: u.id, name: u.name }))}
        initialView={initialView}
        initialDatePreset={
          params.dato === "uke" || params.dato === "forfalt" || params.dato === "idag"
            ? params.dato
            : "alle"
        }
        initialOnlyActive={params.aktive === "1"}
        initialGroupByStage={params.gruppe === "fase"}
      />
    </div>
  );
}
