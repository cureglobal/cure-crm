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

  const sellerStats = allUsers
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
      };
    })
    .filter((s) => s.byStage.length > 0 || s.soldCount > 0 || s.hitRate !== null);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Statistikk</h1>
          <p className="mt-1 text-ink-soft">Oversikt per selger.</p>
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
          {sellerStats.map((s) => (
            <section key={s.user.id} className="card p-6">
              <div className="mb-4 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2.5">
                  <Avatar name={s.user.name} imageUrl={s.user.avatarDataUrl} size={32} />
                  <span className="text-[15px] font-semibold tracking-tight">{s.user.name}</span>
                </div>

                <div className="flex flex-1 flex-wrap gap-6">
                  <div>
                    <p className="text-[20px] font-semibold tracking-tight">
                      {s.hitRate == null ? "—" : `${Math.round(s.hitRate * 100)}%`}
                    </p>
                    <p className="text-[11.5px] text-ink-soft">Hit rate</p>
                  </div>
                  <div>
                    <p className="text-[20px] font-semibold tracking-tight">
                      {formatMoney(s.soldValue) || "0kr"}
                    </p>
                    <p className="text-[11.5px] text-ink-soft">Solgt for</p>
                  </div>
                  <div>
                    <p className="text-[20px] font-semibold tracking-tight">{s.soldCount}</p>
                    <p className="text-[11.5px] text-ink-soft">Deals solgt</p>
                  </div>
                  <div>
                    <p className="text-[20px] font-semibold tracking-tight">{s.pipelineCount}</p>
                    <p className="text-[11.5px] text-ink-soft">Leads i pipeline</p>
                  </div>
                </div>
              </div>

              {s.byStage.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  {s.byStage.map((g) => (
                    <span
                      key={g.stage.id}
                      className="flex items-center gap-1.5 rounded-full bg-mist/[0.05] px-3 py-1.5 text-[12px]"
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
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
