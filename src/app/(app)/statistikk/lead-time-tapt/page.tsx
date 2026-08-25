import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { parsePeriodeParam, periodRange } from "@/lib/statistikkPeriod";
import { getDealListContext, toStatDealRow } from "@/lib/statDeals.server";
import StatDealsList from "@/components/StatDealsList";

export default async function LeadTimeTaptPage({
  searchParams,
}: PageProps<"/statistikk/lead-time-tapt">) {
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
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));
  const stageById = new Map(stages.map((s) => [String(s.id), s]));

  const allDeals = await db.query.deals.findMany();
  const lostInPeriod = allDeals.filter(
    (d) =>
      pipelineStageIds.has(d.stage) &&
      lostStageIds.has(d.stage) &&
      (d.closedAt ?? d.updatedAt) >= start &&
      (d.closedAt ?? d.updatedAt) <= end
  );

  const ctx = await getDealListContext();
  const rows = lostInPeriod.map((d) =>
    toStatDealRow(d, ctx, stageById, (d.closedAt ?? d.updatedAt).getTime())
  );
  const totalMs = lostInPeriod.reduce(
    (acc, d) => acc + ((d.closedAt ?? d.updatedAt).getTime() - d.createdAt.getTime()),
    0
  );
  const avgLeadTimeDays =
    lostInPeriod.length > 0 ? Math.round(totalMs / lostInPeriod.length / 86_400_000) : null;

  return (
    <StatDealsList
      rows={rows}
      variant="leadtimetapt"
      title="Lead time, tapt"
      sublabel="Tapt i valgt periode — tid fra opprettet til tapt"
      totalDisplay={`${avgLeadTimeDays != null ? `${avgLeadTimeDays} dager i snitt` : "Ingen data"} · ${rows.length} deals`}
    />
  );
}
