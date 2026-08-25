import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { parsePeriodeParam, periodRange } from "@/lib/statistikkPeriod";
import { getDealListContext, toStatDealRow } from "@/lib/statDeals.server";
import StatDealsList from "@/components/StatDealsList";

export default async function LeadTimePage({
  searchParams,
}: PageProps<"/statistikk/lead-time">) {
  await requireUser();
  const params = await searchParams;
  const periode = parsePeriodeParam(params.periode);
  const fra = typeof params.fra === "string" ? params.fra : "";
  const til = typeof params.til === "string" ? params.til : "";
  const { start, end } = periodRange(periode, fra, til);

  const pipelines = await getPipelines();
  const pipelineParam = typeof params.pipeline === "string" ? Number(params.pipeline) : NaN;
  const pipelineId = pipelines.some((p) => p.id === pipelineParam)
    ? pipelineParam
    : await getDefaultPipelineId();

  const stages = await getStages(pipelineId);
  const pipelineStageIds = new Set(stages.map((s) => String(s.id)));
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const stageById = new Map(stages.map((s) => [String(s.id), s]));

  const allDeals = await db.query.deals.findMany();
  const wonInPeriod = allDeals.filter(
    (d) =>
      pipelineStageIds.has(d.stage) &&
      wonStageIds.has(d.stage) &&
      (d.closedAt ?? d.updatedAt) >= start &&
      (d.closedAt ?? d.updatedAt) <= end
  );

  const ctx = await getDealListContext();
  const rows = wonInPeriod.map((d) =>
    toStatDealRow(d, ctx, stageById, (d.closedAt ?? d.updatedAt).getTime())
  );
  const totalMs = wonInPeriod.reduce(
    (acc, d) => acc + ((d.closedAt ?? d.updatedAt).getTime() - d.createdAt.getTime()),
    0
  );
  const avgLeadTimeDays =
    wonInPeriod.length > 0 ? Math.round(totalMs / wonInPeriod.length / 86_400_000) : null;

  return (
    <StatDealsList
      rows={rows}
      variant="leadtime"
      title="Lead time"
      sublabel="Vunnet i valgt periode — tid fra opprettet til vunnet"
      totalDisplay={`${avgLeadTimeDays != null ? `${avgLeadTimeDays} dager i snitt` : "Ingen data"} · ${rows.length} deals`}
    />
  );
}
