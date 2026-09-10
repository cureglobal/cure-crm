import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, users, userColumns, deals as dealsTable, dealLines as dealLinesTable } from "@/lib/db";
import type { Deal, Stage } from "@/lib/db/schema";
import { avatarUrlFor } from "@/lib/avatar";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines } from "@/lib/pipelines.server";
import { formatMoney } from "@/lib/format";
import { effectiveProbability } from "@/lib/dealProbability";
import {
  parsePeriodeParam,
  parseGrupperingParam,
  periodRange,
  statistikkQuery,
} from "@/lib/statistikkPeriod";
import {
  getSalesTarget,
  getMonthlyActuals,
  getBusinessUnitTargets,
  getRecurringTargets,
} from "@/lib/salesTarget.server";
import { getBusinessUnits } from "@/lib/businessUnits.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import Avatar from "@/components/Avatar";
import StatistikkPeriodPicker from "@/components/StatistikkPeriodPicker";
import { Coins, Target, Timer, Scale, Flag, ChevronDown, Check, X } from "lucide-react";

interface StageBreakdown {
  stage: { id: number; label: string; color: string };
  count: number;
  value: number;
}

interface RankedDeal {
  id: number;
  slug: string;
  title: string;
  companyName: string;
  value: number | null;
  outcome: "won" | "lost";
  closedAt: number;
}

interface SellerStat {
  user: {
    id: number;
    name: string;
    avatarUrl: string | null;
    businessUnitName: string | null;
    businessUnitColor: string | null;
  };
  byStage: StageBreakdown[];
  hitRate: number | null;
  soldValue: number;
  soldCount: number;
  lostCount: number;
  pipelineCount: number;
  pipelineValue: number;
  // Øyeblikksbilde — ALLE åpne deals eieren har nå, uavhengig av valgt
  // periode (til forskjell fra pipelineCount/pipelineValue over, som bare
  // teller NYE leads opprettet i perioden). Brukes til forecasting.
  openValue: number;
  estimatedValue: number;
  // Gjennomsnittlig antall dager fra opprettet til vunnet, for deals som
  // ble vunnet i valgt periode. Null = ingen vunnet i perioden.
  leadTimeDays: number | null;
  // De faktiske dealene bak vunnet-/tapt-tallene i perioden — til
  // "vis dealene"-utvidelsen på rangeringslistene.
  wonDeals: RankedDeal[];
  lostDeals: RankedDeal[];
}

interface RankingRow {
  user: SellerStat["user"];
  display: string;
  prefix?: React.ReactNode;
  extra?: React.ReactNode;
  deals?: RankedDeal[];
}

// Alt Statistikk-siden trenger for å tegne nøkkeltall + rangeringer for ÉTT
// utvalg av deals — regnet ut av computeGroup() i sidekomponenten under, én
// gang for "Samlet", eller én gang per pipeline/selskap i de andre
// visningsmodiene. Ren datastruktur, ingen forretningslogikk her.
interface GroupStats {
  totalPipelineValue: number;
  totalEstimatedValue: number;
  avgDealValue: number | null;
  openDealsWithValueCount: number;
  leadTimeOverall: number | null;
  sellerStats: SellerStat[];
  hitRateRows: RankingRow[];
  soldValueRows: RankingRow[];
  soldCountRows: RankingRow[];
  pipelineRows: RankingRow[];
  openValueRows: RankingRow[];
  estimatedValueRows: RankingRow[];
  leadTimeRows: RankingRow[];
}

function StatTile({
  label,
  value,
  sublabel,
  icon,
  href,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
        {icon}
      </div>
      <p className="text-[24px] font-semibold tracking-tight">{value}</p>
      <p className="text-[12.5px] text-ink-soft">{label}</p>
      {sublabel && <p className="mt-0.5 text-[11px] text-ink-faint">{sublabel}</p>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card block p-5 transition hover:bg-mist/[0.03]">
        {body}
      </Link>
    );
  }
  return <div className="card p-5">{body}</div>;
}

// Én rangert liste over selgerne for én enkelt metrikk — brukt fire ganger
// under, én per målestørrelse, i stedet for ett kort per selger som viste alt.
function RankingSection({ title, rows }: { title: string; rows: RankingRow[] }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[13.5px] font-semibold tracking-tight">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-ink-faint">Ingen data ennå.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((r, i) => {
            const rank = (
              <span className="w-4 shrink-0 text-[12px] font-semibold text-ink-faint">
                {i + 1}
              </span>
            );
            const name = (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium">
                {r.user.businessUnitColor && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: r.user.businessUnitColor }}
                    title={r.user.businessUnitName ?? undefined}
                  />
                )}
                <span className="truncate">{r.user.name}</span>
              </span>
            );
            const metric = (
              <span className="shrink-0 text-[13px] font-semibold tabular-nums">{r.display}</span>
            );
            if (!r.deals || r.deals.length === 0) {
              return (
                <li key={r.user.id} className="flex items-center gap-2.5 px-1.5 py-1.5">
                  {rank}
                  <Avatar name={r.user.name} imageUrl={r.user.avatarUrl} size={24} />
                  {name}
                  {r.prefix}
                  {metric}
                  {r.extra}
                </li>
              );
            }
            return (
              <li key={r.user.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-1.5 py-1.5 [&::-webkit-details-marker]:hidden transition hover:bg-mist/[0.04]">
                    {rank}
                    <Avatar name={r.user.name} imageUrl={r.user.avatarUrl} size={24} />
                    {name}
                    {r.prefix}
                    {metric}
                    {r.extra}
                    <ChevronDown
                      size={13}
                      className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <ul className="ml-[26px] mt-1 mb-1.5 flex flex-col gap-0.5 border-l border-line pl-3">
                    {r.deals.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/leads/${d.slug}`}
                          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] transition hover:bg-mist/[0.04]"
                        >
                          {d.outcome === "won" ? (
                            <Check size={12} className="shrink-0 text-success-ink" />
                          ) : (
                            <X size={12} className="shrink-0 text-danger" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          <span className="shrink-0 truncate text-ink-faint">{d.companyName}</span>
                          {d.value != null && (
                            <span className="shrink-0 tabular-nums text-ink-soft">
                              {formatMoney(d.value)}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// Nøkkeltall-tiles + alle selger-rangeringer for ÉTT utvalg (Samlet, eller
// én pipeline/ett selskap i de andre visningsmodiene) — rendres 1× eller N×
// avhengig av gruppering, se StatistikkPage under.
function StatsBlock({ stats, q }: { stats: GroupStats; q: string }) {
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Sum i pipeline"
          sublabel="Alle åpne deals nå"
          value={formatMoney(stats.totalPipelineValue) || "0kr"}
          icon={<Coins size={16} />}
          href={`/statistikk/sum-i-pipeline?${q}`}
        />
        <StatTile
          label="Estimert salg i pipeline"
          sublabel="Verdi × sannsynlighet per fase"
          value={formatMoney(Math.round(stats.totalEstimatedValue)) || "0kr"}
          icon={<Target size={16} />}
          href={`/statistikk/estimert-salg?${q}`}
        />
        <StatTile
          label="Snittverdi på deal"
          sublabel={`Basert på ${stats.openDealsWithValueCount} deals med verdi`}
          value={stats.avgDealValue != null ? formatMoney(stats.avgDealValue) || "0kr" : "—"}
          icon={<Scale size={16} />}
          href={`/statistikk/sum-i-pipeline?${q}`}
        />
        <StatTile
          label="Lead time"
          sublabel="Opprettet → vunnet, valgt periode"
          value={stats.leadTimeOverall != null ? `${stats.leadTimeOverall} dager` : "—"}
          icon={<Timer size={16} />}
          href={`/statistikk/lead-time?${q}`}
        />
      </div>

      {stats.sellerStats.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink-faint">
          Ingen data å vise for denne perioden ennå.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <RankingSection title="Hit rate" rows={stats.hitRateRows} />
            <RankingSection title="Solgt for" rows={stats.soldValueRows} />
            <RankingSection title="Deals solgt" rows={stats.soldCountRows} />
          </div>
          <RankingSection title="Leads i pipeline" rows={stats.pipelineRows} />
          <div className="grid gap-4 md:grid-cols-2">
            <RankingSection title="Sum i pipeline per selger" rows={stats.openValueRows} />
            <RankingSection title="Estimert salg per selger" rows={stats.estimatedValueRows} />
          </div>
          <RankingSection title="Lead time per selger" rows={stats.leadTimeRows} />
        </div>
      )}
    </>
  );
}

export default async function StatistikkPage({ searchParams }: PageProps<"/statistikk">) {
  await requireUser();
  const params = await searchParams;
  const periode = parsePeriodeParam(params.periode);
  const fra = typeof params.fra === "string" ? params.fra : "";
  const til = typeof params.til === "string" ? params.til : "";
  const { start, end } = periodRange(periode, fra, til);
  const gruppering = parseGrupperingParam(params.gruppering);

  // Salgsmål er selskapsbredt — regnes derfor på tvers av ALLE pipelines,
  // ikke bare den valgte, til forskjell fra resten av siden.
  const salesTargetYear = new Date().getFullYear();

  // Alt under er uavhengig av hverandre — hentes parallelt i stedet for i
  // serie (produksjon går mot en ekstern Turso-database, så hvert await er
  // en ekte nettverkstur).
  const [
    pipelines,
    allUsers,
    allDealsEverywhere,
    salesTarget,
    manualActuals,
    allStagesEverywhere,
    businessUnitTargetRows,
    businessUnitRowsAll,
    allCompaniesEverywhere,
    dealSlugMap,
    recurringTargetRows,
    recurringLinesEverywhere,
  ] = await Promise.all([
    getPipelines(),
    db.select(userColumns).from(users).orderBy(asc(users.name)),
    db.query.deals.findMany(),
    getSalesTarget(salesTargetYear),
    getMonthlyActuals(salesTargetYear),
    getStages(),
    getBusinessUnitTargets(salesTargetYear),
    getBusinessUnits(),
    db.query.companies.findMany({ columns: { id: true, name: true, businessUnitId: true } }),
    getDealSlugMap(),
    getRecurringTargets(),
    // Regner "dagens recurring" for recurring-målet under — kun timer×pris
    // (den MÅNEDLIGE verdien), ALDRI ganget med months (det ville gitt
    // kontraktens totalverdi, ikke løpende inntekt), se DealLines.tsx.
    // Vunnet-fase og selskaps-filtrering skjer i JS etterpå, siden
    // wonStageIdsEverywhere/businessUnitIdByCompany ikke er klare før
    // resten av batchen er hentet.
    db
      .select({
        hours: dealLinesTable.hours,
        rate: dealLinesTable.rate,
        dealStage: dealsTable.stage,
        companyId: dealsTable.companyId,
      })
      .from(dealLinesTable)
      .innerJoin(dealsTable, eq(dealLinesTable.dealId, dealsTable.id))
      .where(eq(dealLinesTable.billingType, "recurring")),
  ]);
  const companyNameById = new Map(allCompaniesEverywhere.map((c) => [c.id, c.name]));

  const manualByMonth = new Map(manualActuals.map((m) => [m.month, m.amount]));
  const wonStageIdsEverywhere = new Set(
    allStagesEverywhere.filter((s) => s.isWon).map((s) => String(s.id))
  );

  function monthActual(month: number): number {
    const manual = manualByMonth.get(month);
    if (manual != null) return manual;
    const monthStart = new Date(salesTargetYear, month - 1, 1);
    const monthEnd = new Date(salesTargetYear, month, 1);
    return allDealsEverywhere
      .filter((d) => {
        if (!wonStageIdsEverywhere.has(d.stage)) return false;
        const closed = d.closedAt ?? d.updatedAt;
        return closed >= monthStart && closed < monthEnd;
      })
      .reduce((acc, d) => acc + (d.value ?? 0), 0);
  }

  const monthlyActualValues = Array.from({ length: 12 }, (_, i) => monthActual(i + 1));
  const quarterActuals = [0, 1, 2, 3].map((q) =>
    monthlyActualValues.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0)
  );
  // Manuelt registrert "solgt hittil" per selskap (Innstillinger) legges
  // oppå månedstallene over — det er salg som ikke er sporet som deal her,
  // så det telles ikke allerede med i monthActual()-summen.
  const manualActualTotal = businessUnitTargetRows.reduce(
    (acc, t) => acc + t.manualActualAmount,
    0
  );
  const totalActual = monthlyActualValues.reduce((a, b) => a + b, 0) + manualActualTotal;
  const quarterWeights = salesTarget
    ? [salesTarget.q1Weight, salesTarget.q2Weight, salesTarget.q3Weight, salesTarget.q4Weight]
    : [25, 25, 25, 25];
  // Årsmålet er ikke lenger et eget tall — det er summen av salgsmål per
  // selskap, satt under Innstillinger (se updateBusinessUnitTarget).
  const totalTarget = businessUnitTargetRows.reduce((acc, t) => acc + t.totalAmount, 0);
  const quarterTargets = quarterWeights.map((w) => Math.round((totalTarget * w) / 100));

  // Per selskap: kan bare regnes ut fra vunnet-deals REGISTRERT I DENNE
  // APPEN (koblet via companies.business_unit_id) — historikken fra det
  // gamle CRM-et i monthly_actuals er ikke brutt ned per selskap, så den
  // blandes ikke inn her slik totalen over gjør.
  const businessUnitIdByCompany = new Map(
    allCompaniesEverywhere.map((c) => [c.id, c.businessUnitId])
  );
  // Til fargekoding av selgere etter selskap i rangeringene under.
  const businessUnitById = new Map(businessUnitRowsAll.map((u) => [u.id, u]));
  const yearStart = new Date(salesTargetYear, 0, 1);
  const yearEnd = new Date(salesTargetYear + 1, 0, 1);
  const actualByBusinessUnit = new Map<number, number>();
  for (const d of allDealsEverywhere) {
    if (!wonStageIdsEverywhere.has(d.stage)) continue;
    const closed = d.closedAt ?? d.updatedAt;
    if (closed < yearStart || closed >= yearEnd) continue;
    const buId = businessUnitIdByCompany.get(d.companyId);
    if (buId == null) continue;
    actualByBusinessUnit.set(buId, (actualByBusinessUnit.get(buId) ?? 0) + (d.value ?? 0));
  }
  const businessUnitTargetDisplay = businessUnitTargetRows
    .filter((t) => t.totalAmount > 0)
    .map((t) => ({
      name: businessUnitRowsAll.find((u) => u.id === t.businessUnitId)?.name ?? "Ukjent selskap",
      target: t.totalAmount,
      // Vunnet-deals registrert i denne appen + manuelt registrert "solgt
      // hittil" (Innstillinger) for salg som ikke er sporet som deal her.
      actual: (actualByBusinessUnit.get(t.businessUnitId) ?? 0) + t.manualActualAmount,
    }));

  // "Dagens recurring" per selskap — kun vunnet-deals, uavhengig av når de
  // ble vunnet (en recurring-avtale vunnet i fjor gir fortsatt løpende
  // inntekt i dag; ingen "avtalen er avsluttet"-felt finnes å filtrere på).
  const recurringMonthlyByBusinessUnit = new Map<number, number>();
  for (const line of recurringLinesEverywhere) {
    if (!wonStageIdsEverywhere.has(line.dealStage)) continue;
    const buId = businessUnitIdByCompany.get(line.companyId);
    if (buId == null) continue;
    recurringMonthlyByBusinessUnit.set(
      buId,
      (recurringMonthlyByBusinessUnit.get(buId) ?? 0) + line.hours * line.rate
    );
  }
  const recurringTargetDisplay = recurringTargetRows.map((t) => ({
    name: businessUnitRowsAll.find((u) => u.id === t.businessUnitId)?.name ?? "Ukjent selskap",
    target: t.monthlyCostTarget,
    actual: recurringMonthlyByBusinessUnit.get(t.businessUnitId) ?? 0,
  }));

  function avgLeadTimeDays(list: Deal[]): number | null {
    if (list.length === 0) return null;
    const totalMs = list.reduce(
      (acc, d) => acc + ((d.closedAt ?? d.updatedAt).getTime() - d.createdAt.getTime()),
      0
    );
    return Math.round(totalMs / list.length / 86_400_000);
  }

  // Regner nøkkeltall + selger-rangeringer for ETT utvalg av deals (alt,
  // én pipeline, eller ett selskap sine deals) + fasesettet som gjelder
  // for det utvalget — kalt 1× (Samlet) eller N× (Per pipeline/selskap)
  // under. Samme matematikk som før omleggingen, bare kalt flere ganger.
  function computeGroup(deals: Deal[], stages: Stage[]): GroupStats {
    const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
    const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));
    const stageById = new Map(stages.map((s) => [String(s.id), s]));

    // Øyeblikksbilde uavhengig av periodevelgeren — brukes til forecasting
    // (formålet er "hvor mye kan vi forvente å selge", ikke "hvor mange nye
    // leads kom inn nylig"), samme prinsipp som "Verdi i pipeline" på
    // Oversikt-siden.
    const openDealsAll = deals.filter(
      (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
    );
    const totalPipelineValue = openDealsAll.reduce((acc, d) => acc + (d.value ?? 0), 0);
    const totalEstimatedValue = openDealsAll.reduce(
      (acc, d) => acc + (d.value ?? 0) * (effectiveProbability(d, stageById) / 100),
      0
    );
    const wonInPeriodAll = deals.filter(
      (d) =>
        wonStageIds.has(d.stage) &&
        (d.closedAt ?? d.updatedAt) >= start &&
        (d.closedAt ?? d.updatedAt) <= end
    );
    const leadTimeOverall = avgLeadTimeDays(wonInPeriodAll);

    // Snitt regnes kun av deals som faktisk har en verdi satt — ellers ville
    // deals uten verdi (0 i praksis) dratt gjennomsnittet kunstig ned.
    const openDealsWithValue = openDealsAll.filter((d) => d.value != null);
    const avgDealValue =
      openDealsWithValue.length > 0
        ? Math.round(
            openDealsWithValue.reduce((acc, d) => acc + (d.value ?? 0), 0) /
              openDealsWithValue.length
          )
        : null;

    const sellerStats: SellerStat[] = allUsers
      .map((user) => {
        const ownDeals = deals.filter((d) => d.ownerId === user.id);
        const openDeals = ownDeals.filter(
          (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
        );
        const openValue = openDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);
        const estimatedValue = openDeals.reduce(
          (acc, d) => acc + (d.value ?? 0) * (effectiveProbability(d, stageById) / 100),
          0
        );

        // Faseoversikt: aktive (ikke vunnet/tapt) deals opprettet i valgt periode.
        const activeInPeriod = ownDeals.filter(
          (d) =>
            !wonStageIds.has(d.stage) &&
            !lostStageIds.has(d.stage) &&
            d.createdAt >= start &&
            d.createdAt <= end
        );
        const byStage = stages
          .map((s) => {
            const items = activeInPeriod.filter((d) => d.stage === String(s.id));
            return {
              stage: s,
              count: items.length,
              value: items.reduce((acc, d) => acc + (d.value ?? 0), 0),
            };
          })
          .filter((g) => g.count > 0);
        const pipelineValue = byStage.reduce((acc, g) => acc + g.value, 0);

        // Lukket i perioden — vunnet og tapt bruker begge closedAt (satt uansett
        // utfall), med updatedAt som fallback for deals lukket før feltet ble
        // satt på tapte deals også.
        const wonInPeriod = ownDeals.filter(
          (d) =>
            wonStageIds.has(d.stage) &&
            (d.closedAt ?? d.updatedAt) >= start &&
            (d.closedAt ?? d.updatedAt) <= end
        );
        const lostInPeriod = ownDeals.filter(
          (d) =>
            lostStageIds.has(d.stage) &&
            (d.closedAt ?? d.updatedAt) >= start &&
            (d.closedAt ?? d.updatedAt) <= end
        );
        const closedTotal = wonInPeriod.length + lostInPeriod.length;
        const hitRate = closedTotal > 0 ? wonInPeriod.length / closedTotal : null;
        const soldValue = wonInPeriod.reduce((acc, d) => acc + (d.value ?? 0), 0);
        const leadTimeDays = avgLeadTimeDays(wonInPeriod);

        function toRankedDeal(d: Deal, outcome: "won" | "lost"): RankedDeal {
          const closedAt = d.closedAt ?? d.updatedAt;
          return {
            id: d.id,
            slug: dealSlugMap.get(d.id) ?? String(d.id),
            title: d.title,
            companyName: companyNameById.get(d.companyId) ?? "Ukjent selskap",
            value: d.value,
            outcome,
            closedAt: closedAt.getTime(),
          };
        }
        const wonDeals = wonInPeriod
          .map((d) => toRankedDeal(d, "won"))
          .sort((a, b) => b.closedAt - a.closedAt);
        const lostDeals = lostInPeriod
          .map((d) => toRankedDeal(d, "lost"))
          .sort((a, b) => b.closedAt - a.closedAt);

        return {
          // Kun det listen trenger — bildet peker på /api/avatar/[id] i stedet
          // for å bakes inn som base64 i svaret.
          user: {
            id: user.id,
            name: user.name,
            avatarUrl: avatarUrlFor(user.id, user.avatarUpdatedAt),
            businessUnitName:
              user.businessUnitId != null
                ? (businessUnitById.get(user.businessUnitId)?.name ?? null)
                : null,
            businessUnitColor:
              user.businessUnitId != null
                ? (businessUnitById.get(user.businessUnitId)?.color ?? null)
                : null,
          },
          byStage,
          hitRate,
          openValue,
          estimatedValue,
          leadTimeDays,
          soldValue,
          soldCount: wonInPeriod.length,
          lostCount: lostInPeriod.length,
          pipelineCount: activeInPeriod.length,
          pipelineValue,
          wonDeals,
          lostDeals,
        };
      })
      .filter(
        (s) => s.byStage.length > 0 || s.soldCount > 0 || s.hitRate !== null || s.openValue > 0
      );

    const hitRateRows: RankingRow[] = sellerStats
      .filter((s) => s.hitRate != null)
      .sort((a, b) => b.hitRate! - a.hitRate!)
      .map((s) => ({
        user: s.user,
        display: `${Math.round(s.hitRate! * 100)}%`,
        // Stilling (vunnet-tapt) i perioden, f.eks. "2-1" — vist til venstre
        // for selve prosenten.
        prefix: (
          <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
            {s.soldCount}-{s.lostCount}
          </span>
        ),
        deals: [...s.wonDeals, ...s.lostDeals].sort((a, b) => b.closedAt - a.closedAt),
      }));

    const soldValueRows: RankingRow[] = sellerStats
      .slice()
      .sort((a, b) => b.soldValue - a.soldValue)
      .map((s) => ({ user: s.user, display: formatMoney(s.soldValue) || "0kr", deals: s.wonDeals }));

    const soldCountRows: RankingRow[] = sellerStats
      .slice()
      .sort((a, b) => b.soldCount - a.soldCount)
      .map((s) => ({ user: s.user, display: String(s.soldCount), deals: s.wonDeals }));

    const pipelineRows: RankingRow[] = sellerStats
      .slice()
      .sort((a, b) => b.pipelineCount - a.pipelineCount)
      .map((s) => ({
        user: s.user,
        display: `${s.pipelineCount}`,
        extra:
          s.byStage.length > 0 ? (
            <div className="mt-1.5 flex w-full flex-wrap gap-1.5 pl-[34px]">
              {s.byStage.map((g) => (
                <span
                  key={g.stage.id}
                  className="flex items-center gap-1 rounded-full bg-mist/[0.05] px-2 py-1 text-[11px]"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: g.stage.color }}
                  />
                  <span className="font-medium">{g.stage.label}</span>
                  <span className="text-ink-faint">{g.count}</span>
                  <span className="text-ink-soft">· {formatMoney(g.value)}</span>
                </span>
              ))}
            </div>
          ) : undefined,
      }));

    const openValueRows: RankingRow[] = sellerStats
      .filter((s) => s.openValue > 0)
      .slice()
      .sort((a, b) => b.openValue - a.openValue)
      .map((s) => ({ user: s.user, display: formatMoney(s.openValue) || "0kr" }));

    const estimatedValueRows: RankingRow[] = sellerStats
      .filter((s) => s.estimatedValue > 0)
      .slice()
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
      .map((s) => ({ user: s.user, display: formatMoney(Math.round(s.estimatedValue)) || "0kr" }));

    const leadTimeRows: RankingRow[] = sellerStats
      .filter((s) => s.leadTimeDays != null)
      .slice()
      .sort((a, b) => a.leadTimeDays! - b.leadTimeDays!)
      .map((s) => ({ user: s.user, display: `${s.leadTimeDays} dager` }));

    return {
      totalPipelineValue,
      totalEstimatedValue,
      avgDealValue,
      openDealsWithValueCount: openDealsWithValue.length,
      leadTimeOverall,
      sellerStats,
      hitRateRows,
      soldValueRows,
      soldCountRows,
      pipelineRows,
      openValueRows,
      estimatedValueRows,
      leadTimeRows,
    };
  }

  // Bygger blokkene som faktisk rendres: én "Samlet" (standard, på tvers av
  // alle pipelines), eller én per pipeline/selskap i de andre modiene.
  interface Block {
    heading: string | null;
    stats: GroupStats;
    q: string;
  }
  let blocks: Block[];
  if (gruppering === "pipeline") {
    blocks = await Promise.all(
      pipelines.map(async (p) => {
        const stages = await getStages(p.id);
        const stageIds = new Set(stages.map((s) => String(s.id)));
        const deals = allDealsEverywhere.filter((d) => stageIds.has(d.stage));
        return {
          heading: p.name,
          stats: computeGroup(deals, stages),
          q: statistikkQuery({ periode, fra, til, pipelineId: p.id }),
        };
      })
    );
  } else if (gruppering === "selskap") {
    const q = statistikkQuery({ periode, fra, til });
    blocks = businessUnitRowsAll.map((u) => {
      const deals = allDealsEverywhere.filter(
        (d) => businessUnitIdByCompany.get(d.companyId) === u.id
      );
      return { heading: u.name, stats: computeGroup(deals, allStagesEverywhere), q };
    });
  } else {
    blocks = [
      {
        heading: null,
        stats: computeGroup(allDealsEverywhere, allStagesEverywhere),
        q: statistikkQuery({ periode, fra, til }),
      },
    ];
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Statistikk</h1>
          <p className="mt-1 text-ink-soft">Selgerne rangert per målestørrelse.</p>
        </div>
        <StatistikkPeriodPicker periode={periode} fra={fra} til={til} gruppering={gruppering} />
      </div>

      {(totalTarget > 0 || recurringTargetDisplay.length > 0) && (
        <section className="card mb-4 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold tracking-tight">
              <Flag size={15} className="text-accent" />
              Salgsmål {salesTargetYear}
            </h2>
            {totalTarget > 0 && (
              <span className="text-[13px] font-medium tabular-nums">
                {formatMoney(totalActual) || "0kr"} / {formatMoney(totalTarget) || "0kr"}
                <span className="ml-1.5 text-ink-soft">
                  ({Math.round((totalActual / totalTarget) * 100)} %)
                </span>
              </span>
            )}
          </div>
          {totalTarget > 0 && (
            <>
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-mist/[0.08]">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, (totalActual / totalTarget) * 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {["Q1", "Q2", "Q3", "Q4"].map((label, i) => {
                  const target = quarterTargets[i];
                  const actual = quarterActuals[i];
                  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
                  return (
                    <div key={label} className="rounded-xl bg-mist/[0.03] p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                        {label} · {quarterWeights[i]}%
                      </p>
                      <p className="mt-1 text-[14px] font-semibold tabular-nums">
                        {formatMoney(actual) || "0kr"}
                      </p>
                      <p className="text-[11.5px] text-ink-soft">
                        av {formatMoney(target) || "0kr"} ({pct} %)
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {businessUnitTargetDisplay.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Per selskap · vunnet i denne appen i {salesTargetYear}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {businessUnitTargetDisplay.map((u) => {
                  const pct = u.target > 0 ? Math.round((u.actual / u.target) * 100) : 0;
                  return (
                    <div key={u.name} className="rounded-xl bg-mist/[0.03] p-3">
                      <p className="truncate text-[11.5px] font-medium">{u.name}</p>
                      <p className="mt-1 text-[14px] font-semibold tabular-nums">
                        {formatMoney(u.actual) || "0kr"}
                      </p>
                      <p className="text-[11.5px] text-ink-soft">
                        av {formatMoney(u.target) || "0kr"} ({pct} %)
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {recurringTargetDisplay.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Recurring vs. månedlige kostnader
              </p>
              <div className="flex flex-col gap-3">
                {recurringTargetDisplay.map((r) => {
                  const pct = r.target > 0 ? Math.round((r.actual / r.target) * 100) : 0;
                  const gap = Math.max(0, r.target - r.actual);
                  return (
                    <div key={r.name} className="rounded-xl bg-mist/[0.03] p-3">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[12.5px] font-medium">Recurring {r.name}</p>
                        <span className="text-[12.5px] font-semibold tabular-nums">
                          {formatMoney(r.actual) || "0kr"} / {formatMoney(r.target) || "0kr"}
                          <span className="ml-1.5 text-ink-soft">({pct} %)</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-mist/[0.08]">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-ink-soft">
                        {gap > 0
                          ? `${formatMoney(gap)} igjen for å dekke kostnadene`
                          : "Kostnadene er dekket 🎉"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {blocks.map((b, i) => (
        <div key={b.heading ?? "samlet"} className={i > 0 ? "mt-8" : undefined}>
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            {b.heading ? b.heading : "Nøkkeltall"}
          </h2>
          <StatsBlock stats={b.stats} q={b.q} />
        </div>
      ))}
    </div>
  );
}
