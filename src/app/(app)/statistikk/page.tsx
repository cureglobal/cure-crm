import { asc } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { formatMoney } from "@/lib/format";
import { parseDateStr } from "@/components/CalendarPopover";
import Avatar from "@/components/Avatar";
import StatistikkPeriodPicker from "@/components/StatistikkPeriodPicker";
import { Coins, Target, Timer, Hourglass } from "lucide-react";

type Periode = "30" | "kvartal" | "ar" | "egendefinert";

function periodRange(periode: Periode, fra: string, til: string): { start: Date; end: Date } {
  const now = new Date();
  if (periode === "egendefinert") {
    const start = parseDateStr(fra) ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDay = parseDateStr(til) ?? now;
    const end = new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate(),
      23,
      59,
      59,
      999
    );
    return { start, end };
  }
  if (periode === "kvartal") {
    return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end: now };
  }
  if (periode === "ar") return { start: new Date(now.getFullYear(), 0, 1), end: now };
  return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
}

interface StageBreakdown {
  stage: { id: number; label: string; color: string };
  count: number;
  value: number;
}

interface SellerStat {
  user: { id: number; name: string; avatarDataUrl: string | null };
  byStage: StageBreakdown[];
  hitRate: number | null;
  soldValue: number;
  soldCount: number;
  pipelineCount: number;
  pipelineValue: number;
  // Øyeblikksbilde — ALLE åpne deals eieren har nå, uavhengig av valgt
  // periode (til forskjell fra pipelineCount/pipelineValue over, som bare
  // teller NYE leads opprettet i perioden). Brukes til forecasting.
  openValue: number;
  estimatedValue: number;
  // Gjennomsnittlig antall dager fra opprettet til vunnet/tapt, for deals
  // som ble lukket i valgt periode. Null = ingen lukkede deals i perioden.
  leadTimeDays: number | null;
  leadTimeLostDays: number | null;
}

function StatTile({
  label,
  value,
  sublabel,
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
        {icon}
      </div>
      <p className="text-[24px] font-semibold tracking-tight">{value}</p>
      <p className="text-[12.5px] text-ink-soft">{label}</p>
      {sublabel && <p className="mt-0.5 text-[11px] text-ink-faint">{sublabel}</p>}
    </div>
  );
}

// Én rangert liste over selgerne for én enkelt metrikk — brukt fire ganger
// under, én per målestørrelse, i stedet for ett kort per selger som viste alt.
function RankingSection({
  title,
  rows,
}: {
  title: string;
  rows: { user: SellerStat["user"]; display: string; extra?: React.ReactNode }[];
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[13.5px] font-semibold tracking-tight">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-ink-faint">Ingen data ennå.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={r.user.id} className="flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-[12px] font-semibold text-ink-faint">
                {i + 1}
              </span>
              <Avatar name={r.user.name} imageUrl={r.user.avatarDataUrl} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {r.user.name}
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums">{r.display}</span>
              {r.extra}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function StatistikkPage({ searchParams }: PageProps<"/statistikk">) {
  await requireUser();
  const params = await searchParams;
  const periode: Periode =
    params.periode === "kvartal" || params.periode === "ar" || params.periode === "egendefinert"
      ? params.periode
      : "30";
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
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const allDeals = (await db.query.deals.findMany()).filter((d) =>
    pipelineStageIds.has(d.stage)
  );

  const stageById = new Map(stages.map((s) => [String(s.id), s]));
  // Deal-nivå overstyrer fasens standardsannsynlighet når satt — se
  // deals.probabilityOverride. Alle deals over er allerede vunnet/tapt-
  // ekskludert der det trengs av kallerne under.
  function effectiveProbability(d: (typeof allDeals)[number]): number {
    if (d.probabilityOverride != null) return d.probabilityOverride;
    return stageById.get(d.stage)?.probability ?? 50;
  }
  function avgLeadTimeDays(list: (typeof allDeals)[number][]): number | null {
    if (list.length === 0) return null;
    const totalMs = list.reduce(
      (acc, d) => acc + ((d.closedAt ?? d.updatedAt).getTime() - d.createdAt.getTime()),
      0
    );
    return Math.round(totalMs / list.length / 86_400_000);
  }

  // Øyeblikksbilde uavhengig av periodevelgeren — brukes til forecasting
  // (formålet er "hvor mye kan vi forvente å selge", ikke "hvor mange nye
  // leads kom inn nylig"), samme prinsipp som "Verdi i pipeline" på
  // Oversikt-siden.
  const openDealsAll = allDeals.filter(
    (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
  );
  const totalPipelineValue = openDealsAll.reduce((acc, d) => acc + (d.value ?? 0), 0);
  const totalEstimatedValue = openDealsAll.reduce(
    (acc, d) => acc + (d.value ?? 0) * (effectiveProbability(d) / 100),
    0
  );
  const wonInPeriodAll = allDeals.filter(
    (d) =>
      wonStageIds.has(d.stage) &&
      (d.closedAt ?? d.updatedAt) >= start &&
      (d.closedAt ?? d.updatedAt) <= end
  );
  const lostInPeriodAll = allDeals.filter(
    (d) =>
      lostStageIds.has(d.stage) &&
      (d.closedAt ?? d.updatedAt) >= start &&
      (d.closedAt ?? d.updatedAt) <= end
  );
  const leadTimeOverall = avgLeadTimeDays(wonInPeriodAll);
  const leadTimeLostOverall = avgLeadTimeDays(lostInPeriodAll);

  const sellerStats: SellerStat[] = allUsers
    .map((user) => {
      const ownDeals = allDeals.filter((d) => d.ownerId === user.id);
      const openDeals = ownDeals.filter(
        (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
      );
      const openValue = openDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);
      const estimatedValue = openDeals.reduce(
        (acc, d) => acc + (d.value ?? 0) * (effectiveProbability(d) / 100),
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
      const leadTimeLostDays = avgLeadTimeDays(lostInPeriod);

      return {
        user,
        byStage,
        hitRate,
        openValue,
        estimatedValue,
        leadTimeDays,
        leadTimeLostDays,
        soldValue,
        soldCount: wonInPeriod.length,
        pipelineCount: activeInPeriod.length,
        pipelineValue,
      };
    })
    .filter(
      (s) => s.byStage.length > 0 || s.soldCount > 0 || s.hitRate !== null || s.openValue > 0
    );

  const hitRateRows = sellerStats
    .filter((s) => s.hitRate != null)
    .sort((a, b) => b.hitRate! - a.hitRate!)
    .map((s) => ({ user: s.user, display: `${Math.round(s.hitRate! * 100)}%` }));

  const soldValueRows = sellerStats
    .slice()
    .sort((a, b) => b.soldValue - a.soldValue)
    .map((s) => ({ user: s.user, display: formatMoney(s.soldValue) || "0kr" }));

  const soldCountRows = sellerStats
    .slice()
    .sort((a, b) => b.soldCount - a.soldCount)
    .map((s) => ({ user: s.user, display: String(s.soldCount) }));

  const pipelineRows = sellerStats
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

  const openValueRows = sellerStats
    .filter((s) => s.openValue > 0)
    .slice()
    .sort((a, b) => b.openValue - a.openValue)
    .map((s) => ({ user: s.user, display: formatMoney(s.openValue) || "0kr" }));

  const estimatedValueRows = sellerStats
    .filter((s) => s.estimatedValue > 0)
    .slice()
    .sort((a, b) => b.estimatedValue - a.estimatedValue)
    .map((s) => ({ user: s.user, display: formatMoney(Math.round(s.estimatedValue)) || "0kr" }));

  const leadTimeRows = sellerStats
    .filter((s) => s.leadTimeDays != null)
    .slice()
    .sort((a, b) => a.leadTimeDays! - b.leadTimeDays!)
    .map((s) => ({ user: s.user, display: `${s.leadTimeDays} dager` }));

  const leadTimeLostRows = sellerStats
    .filter((s) => s.leadTimeLostDays != null)
    .slice()
    .sort((a, b) => a.leadTimeLostDays! - b.leadTimeLostDays!)
    .map((s) => ({ user: s.user, display: `${s.leadTimeLostDays} dager` }));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Statistikk</h1>
          <p className="mt-1 text-ink-soft">Selgerne rangert per målestørrelse.</p>
        </div>
        <StatistikkPeriodPicker
          periode={periode}
          fra={fra}
          til={til}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
          pipelineId={pipelineId}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Sum i pipeline"
          sublabel="Alle åpne deals nå"
          value={formatMoney(totalPipelineValue) || "0kr"}
          icon={<Coins size={16} />}
        />
        <StatTile
          label="Estimert salg i pipeline"
          sublabel="Verdi × sannsynlighet per fase"
          value={formatMoney(Math.round(totalEstimatedValue)) || "0kr"}
          icon={<Target size={16} />}
        />
        <StatTile
          label="Lead time"
          sublabel="Opprettet → vunnet, valgt periode"
          value={leadTimeOverall != null ? `${leadTimeOverall} dager` : "—"}
          icon={<Timer size={16} />}
        />
        <StatTile
          label="Lead time, tapt"
          sublabel="Opprettet → tapt, valgt periode"
          value={leadTimeLostOverall != null ? `${leadTimeLostOverall} dager` : "—"}
          icon={<Hourglass size={16} />}
        />
      </div>

      {sellerStats.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink-faint">
          Ingen data å vise for denne perioden ennå.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <RankingSection title="Hit rate" rows={hitRateRows} />
            <RankingSection title="Solgt for" rows={soldValueRows} />
            <RankingSection title="Deals solgt" rows={soldCountRows} />
          </div>
          <RankingSection title="Leads i pipeline" rows={pipelineRows} />
          <div className="grid gap-4 md:grid-cols-2">
            <RankingSection title="Sum i pipeline per selger" rows={openValueRows} />
            <RankingSection title="Estimert salg per selger" rows={estimatedValueRows} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <RankingSection title="Lead time per selger" rows={leadTimeRows} />
            <RankingSection title="Lead time tapt per selger" rows={leadTimeLostRows} />
          </div>
        </div>
      )}
    </div>
  );
}
