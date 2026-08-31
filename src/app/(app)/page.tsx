import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  deals,
  companies,
  activities,
  users,
  emailAccessGrants,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines } from "@/lib/pipelines.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { formatDateTime, formatMoney, startOfDay } from "@/lib/format";
import NewDealButton from "@/components/NewDealButton";
import AccessRequestCard from "@/components/AccessRequestCard";
import MonthCalendar from "@/components/MonthCalendar";
import { CalendarDays, TrendingUp, Coins, CircleCheck } from "lucide-react";

function greeting(name: string) {
  const hour = new Date().getHours();
  const first = name.split(" ")[0];
  if (hour < 5) return `God natt, ${first}`;
  if (hour < 10) return `God morgen, ${first}`;
  if (hour < 18) return `God dag, ${first}`;
  return `God kveld, ${first}`;
}

export default async function Dashboard() {
  const me = await requireUser();

  const allDeals = await db
    .select({
      id: deals.id,
      title: deals.title,
      stage: deals.stage,
      value: deals.value,
      followUpAt: deals.followUpAt,
      updatedAt: deals.updatedAt,
      closedAt: deals.closedAt,
      companyId: deals.companyId,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
      ownerId: deals.ownerId,
      ownerName: users.name,
      ownerAvatarUrl: users.avatarDataUrl,
    })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(users, eq(deals.ownerId, users.id));

  const stages = await getStages();
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));

  const activeDeals = allDeals.filter(
    (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
  );
  const pipelineValue = activeDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);

  const withFollowUp = activeDeals
    .filter((d) => d.followUpAt)
    .sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());

  const today = startOfDay(new Date());
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const soldLast30Value = allDeals
    .filter((d) => wonStageIds.has(d.stage) && (d.closedAt ?? d.updatedAt) >= thirtyDaysAgo)
    .reduce((acc, d) => acc + (d.value ?? 0), 0);

  // Denne uken = mandag til søndag i inneværende uke, fra og med i dag.
  const weekday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getTime() - weekday * 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const overdue = withFollowUp.filter((d) => d.followUpAt! < today);
  // I dag først, deretter kronologisk resten av uken.
  const thisWeek = withFollowUp.filter(
    (d) => d.followUpAt! >= today && d.followUpAt! < endOfWeek
  );

  // "Mine oppfølginger" — samme ukeavgrensning som over, men kun mine egne
  // deals (hovedeier), delt i "i dag" og "resten av uken".
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const myWithFollowUp = withFollowUp.filter((d) => d.ownerId === me.id);
  const myToday = myWithFollowUp.filter((d) => d.followUpAt! >= today && d.followUpAt! < tomorrow);
  const myRestOfWeek = myWithFollowUp.filter(
    (d) => d.followUpAt! >= tomorrow && d.followUpAt! < endOfWeek
  );

  // Innsynsforespørsler til meg — lenker til nyeste deal på selskapet.
  const pendingRequests = await db
    .select({
      id: emailAccessGrants.id,
      companyId: emailAccessGrants.companyId,
      requesterName: users.name,
      companyName: companies.name,
    })
    .from(emailAccessGrants)
    .innerJoin(users, eq(emailAccessGrants.granteeUserId, users.id))
    .innerJoin(companies, eq(emailAccessGrants.companyId, companies.id))
    .where(
      and(
        eq(emailAccessGrants.ownerUserId, me.id),
        eq(emailAccessGrants.status, "requested")
      )
    );

  const companyOptions = (
    await db.query.companies.findMany({ orderBy: [asc(companies.name)] })
  ).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl }));
  const pipelineOptions = (await getPipelines()).map((p) => ({ id: p.id, name: p.name }));

  const dealForCompany = new Map<number, number>();
  for (const d of allDeals) {
    if (!dealForCompany.has(d.companyId)) dealForCompany.set(d.companyId, d.id);
  }
  const slugMap = await getDealSlugMap();
  function dealSlugForCompany(companyId: number): string | null {
    const dealId = dealForCompany.get(companyId);
    return dealId == null ? null : (slugMap.get(dealId) ?? String(dealId));
  }

  const recent = await db
    .select({
      id: activities.id,
      content: activities.content,
      type: activities.type,
      createdAt: activities.createdAt,
      userName: users.name,
      dealId: activities.dealId,
      dealTitle: deals.title,
      companyName: companies.name,
    })
    .from(activities)
    .innerJoin(deals, eq(activities.dealId, deals.id))
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(users, eq(activities.userId, users.id))
    .orderBy(desc(activities.createdAt))
    .limit(8);

  const stats = [
    {
      label: "Oppfølginger denne uken",
      value: thisWeek.length,
      icon: <CalendarDays size={16} />,
      href: "/leads?view=liste&dato=uke&aktive=1",
    },
    {
      label: "Oppfølginger forfalt",
      value: overdue.length,
      icon: <TrendingUp size={16} />,
      danger: overdue.length > 0,
      href: "/leads?view=liste&dato=forfalt&aktive=1",
    },
    {
      label: "Verdi i pipeline",
      value: formatMoney(pipelineValue),
      icon: <Coins size={16} />,
      href: "/leads?view=liste&aktive=1",
    },
    {
      label: "Solgt siste 30 dager",
      value: formatMoney(soldLast30Value),
      icon: <CircleCheck size={16} />,
      href: "/statistikk?periode=30",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{greeting(me.name)}</h1>
          <p className="mt-1 text-ink-soft">Her er status i salgsarbeidet.</p>
        </div>
        <NewDealButton companies={companyOptions} pipelines={pipelineOptions} />
      </div>

      {pendingRequests.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {pendingRequests.map((r) => (
            <AccessRequestCard
              key={r.id}
              grantId={r.id}
              requesterName={r.requesterName}
              companyName={r.companyName}
              dealSlug={dealSlugForCompany(r.companyId)}
            />
          ))}
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card p-5 transition hover:bg-mist/[0.03]"
          >
            <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] ${s.danger ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent"}`}>
              {s.icon}
            </div>
            <p className={`text-[26px] font-semibold tracking-tight ${s.danger ? "text-danger" : ""}`}>
              {s.value}
            </p>
            <p className="text-[12.5px] text-ink-soft">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <MonthCalendar
          deals={withFollowUp.map((d) => ({
            id: d.id,
            title: d.title,
            companyName: d.companyName,
            followUpAt: d.followUpAt!.getTime(),
          }))}
        />

        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <h2 className="mb-4 text-[16px] font-semibold tracking-tight">Mine oppfølginger</h2>
            {myToday.length === 0 && myRestOfWeek.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-faint">
                Ingen oppfølginger på dine deals denne uken.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {myToday.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      I dag
                    </p>
                    <ul className="flex flex-col gap-2">
                      {myToday.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={`/leads/${slugMap.get(d.id) ?? d.id}`}
                            className="flex items-center justify-between gap-3 text-[13px] hover:text-accent"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium">{d.companyName}</span>{" "}
                              <span className="text-ink-soft">· {d.title}</span>
                            </span>
                            {d.value != null && (
                              <span className="shrink-0 tabular-nums text-ink-soft">
                                {formatMoney(d.value)}
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {myRestOfWeek.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Resten av uken
                    </p>
                    <ul className="flex flex-col gap-2">
                      {myRestOfWeek.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={`/leads/${slugMap.get(d.id) ?? d.id}`}
                            className="flex items-center justify-between gap-3 text-[13px] hover:text-accent"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium">{d.companyName}</span>{" "}
                              <span className="text-ink-soft">· {d.title}</span>
                            </span>
                            <span className="shrink-0 text-[11.5px] text-ink-faint">
                              {d.followUpAt!.toLocaleDateString("nb-NO", { weekday: "short" })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-[16px] font-semibold tracking-tight">Siste aktivitet</h2>
            {recent.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-faint">
                Ingen aktivitet ennå. Opprett din første deal for å komme i gang.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {recent.map((a) => (
                  <li key={a.id} className="flex gap-3 text-[13px]">
                    <span
                      className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.type === "won" ? "bg-success" : "bg-ink-faint"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className={a.type === "won" ? "text-success-ink" : "text-ink"}>
                        <span className="font-medium">{a.userName ?? "System"}</span>{" "}
                        <span className={a.type === "won" ? "text-success-ink" : "text-ink-soft"}>
                          {a.content}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        <Link
                          href={`/leads/${slugMap.get(a.dealId) ?? a.dealId}`}
                          className="hover:text-accent"
                        >
                          {a.companyName} · {a.dealTitle}
                        </Link>{" "}
                        · {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
