import { asc } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { formatMoney } from "@/lib/format";
import { parseDateStr } from "@/components/CalendarPopover";
import Avatar from "@/components/Avatar";
import StatistikkPeriodPicker from "@/components/StatistikkPeriodPicker";

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

  const sellerStats: SellerStat[] = allUsers
    .map((user) => {
      const ownDeals = allDeals.filter((d) => d.ownerId === user.id);

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

      // Lukkede deals i perioden — vunnet via closedAt, tapt via updatedAt
      // (det finnes ikke noe eget "lostAt"-felt, så updatedAt er nærmeste vi har).
      const wonInPeriod = ownDeals.filter(
        (d) =>
          wonStageIds.has(d.stage) &&
          (d.closedAt ?? d.updatedAt) >= start &&
          (d.closedAt ?? d.updatedAt) <= end
      );
      const lostInPeriod = ownDeals.filter(
        (d) => lostStageIds.has(d.stage) && d.updatedAt >= start && d.updatedAt <= end
      );
      const closedTotal = wonInPeriod.length + lostInPeriod.length;
      const hitRate = closedTotal > 0 ? wonInPeriod.length / closedTotal : null;
      const soldValue = wonInPeriod.reduce((acc, d) => acc + (d.value ?? 0), 0);

      return {
        user,
        byStage,
        hitRate,
        soldValue,
        soldCount: wonInPeriod.length,
        pipelineCount: activeInPeriod.length,
        pipelineValue,
      };
    })
    .filter((s) => s.byStage.length > 0 || s.soldCount > 0 || s.hitRate !== null);

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
        </div>
      )}
    </div>
  );
}
