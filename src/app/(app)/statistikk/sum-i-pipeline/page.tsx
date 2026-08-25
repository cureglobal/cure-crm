import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { formatMoney } from "@/lib/format";
import { getDealListContext, toStatDealRow } from "@/lib/statDeals.server";
import StatDealsList from "@/components/StatDealsList";

export default async function SumIPipelinePage({
  searchParams,
}: PageProps<"/statistikk/sum-i-pipeline">) {
  await requireUser();
  const params = await searchParams;

  const pipelines = await getPipelines();
  const pipelineParam = typeof params.pipeline === "string" ? Number(params.pipeline) : NaN;
  const pipelineId = pipelines.some((p) => p.id === pipelineParam)
    ? pipelineParam
    : await getDefaultPipelineId();

  const stages = await getStages(pipelineId);
  const pipelineStageIds = new Set(stages.map((s) => String(s.id)));
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));
  const stageById = new Map(stages.map((s) => [String(s.id), s]));

  const allDeals = await db.query.deals.findMany();
  const openDealsWithValue = allDeals.filter(
    (d) =>
      pipelineStageIds.has(d.stage) &&
      !wonStageIds.has(d.stage) &&
      !lostStageIds.has(d.stage) &&
      d.value != null
  );

  const ctx = await getDealListContext();
  const rows = openDealsWithValue.map((d) => toStatDealRow(d, ctx, stageById));
  const total = rows.reduce((acc, r) => acc + (r.value ?? 0), 0);

  return (
    <StatDealsList
      rows={rows}
      variant="sum"
      title="Sum i pipeline"
      sublabel="Alle åpne deals med verdi satt, uavhengig av periode"
      totalDisplay={`${formatMoney(total) || "0kr"} · ${rows.length} deals`}
    />
  );
}
