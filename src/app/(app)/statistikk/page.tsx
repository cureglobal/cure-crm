import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { formatMoney } from "@/lib/format";
import Avatar from "@/components/Avatar";

type Periode = "30" | "kvartal" | "ar";

const PERIODS: { key: Periode; label: string }[] = [
  { key: "30", label: "Siste 30 dager" },
  { key: "kvartal", label: "Siste kvartal" },
  { key: "ar", label: "I år" },
];

function periodStart(periode: Periode): Date {
  const now = new Date();
  if (periode === "kvartal") return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (periode === "ar") return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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
    params.periode === "kvartal" || params.periode === "ar" ? params.periode : "30";
  const start = periodStart(periode);

  const stages = await getStages();
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const allDeals = await db.query.deals.findMany();

  const sellerStats: SellerStat[] = allUsers
    .map((user) => {
      const ownDeals = allDeals.filter((d) => d.ownerId === user.id);

      // Faseoversikt: aktive (ikke vunnet/tapt) deals opprettet i valgt periode.
      const activeInPeriod = ownDeals.filter(
        (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage) && d.createdAt >= start
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
        (d) => wonStageIds.has(d.stage) && (d.closedAt ?? d.updatedAt) >= start
      );
      const lostInPeriod = ownDeals.filter(
        (d) => lostStageIds.has(d.stage) && d.updatedAt >= start
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
        <div className="flex rounded-full bg-mist/[0.05] p-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/statistikk?periode=${p.key}`}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                periode === p.key ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
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
