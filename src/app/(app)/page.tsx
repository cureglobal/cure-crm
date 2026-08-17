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
import { formatDateTime, startOfDay } from "@/lib/format";
import NewDealButton from "@/components/NewDealButton";
import AccessRequestCard from "@/components/AccessRequestCard";
import FollowUpList, { type FollowUpItem } from "@/components/FollowUpList";
import MonthCalendar from "@/components/MonthCalendar";
import { CalendarDays, TrendingUp, Users, CircleCheck } from "lucide-react";

function toFollowUpItem(d: {
  id: number;
  title: string;
  companyName: string;
  logoUrl: string | null;
  stage: string;
  followUpAt: Date | null;
  ownerName?: string | null;
  ownerAvatarUrl?: string | null;
}): FollowUpItem {
  return {
    id: d.id,
    title: d.title,
    companyName: d.companyName,
    logoUrl: d.logoUrl,
    stage: d.stage,
    followUpAt: d.followUpAt!,
    ownerName: d.ownerName ?? null,
    ownerAvatarUrl: d.ownerAvatarUrl ?? null,
  };
}

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
      companyId: deals.companyId,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
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
  const wonCount = allDeals.filter((d) => wonStageIds.has(d.stage)).length;

  const withFollowUp = activeDeals
    .filter((d) => d.followUpAt)
    .sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());

  const today = startOfDay(new Date());
  const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  // Denne uken = mandag til søndag i inneværende uke, fra og med i dag.
  const weekday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getTime() - weekday * 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const overdue = withFollowUp.filter((d) => d.followUpAt! < today);
  const dueToday = withFollowUp.filter(
    (d) => d.followUpAt! >= today && d.followUpAt! < endOfToday
  );
  // I dag først, deretter kronologisk resten av uken.
  const thisWeek = withFollowUp.filter(
    (d) => d.followUpAt! >= today && d.followUpAt! < endOfWeek
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

  const dealForCompany = new Map<number, number>();
  for (const d of allDeals) {
    if (!dealForCompany.has(d.companyId)) dealForCompany.set(d.companyId, d.id);
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
    { label: "Aktive deals", value: activeDeals.length, icon: <Users size={16} /> },
    { label: "Å følge opp i dag", value: dueToday.length, icon: <CalendarDays size={16} /> },
    { label: "Forfalt oppfølging", value: overdue.length, icon: <TrendingUp size={16} />, danger: overdue.length > 0 },
    { label: "Vunnet totalt", value: wonCount, icon: <CircleCheck size={16} /> },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{greeting(me.name)}</h1>
          <p className="mt-1 text-ink-soft">Her er status i salgsarbeidet.</p>
        </div>
        <NewDealButton companies={companyOptions} />
      </div>

      {pendingRequests.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {pendingRequests.map((r) => (
            <AccessRequestCard
              key={r.id}
              grantId={r.id}
              requesterName={r.requesterName}
              companyName={r.companyName}
              dealId={dealForCompany.get(r.companyId) ?? null}
            />
          ))}
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] ${s.danger ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent"}`}>
              {s.icon}
            </div>
            <p className={`text-[26px] font-semibold tracking-tight ${s.danger ? "text-danger" : ""}`}>
              {s.value}
            </p>
            <p className="text-[12.5px] text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <FollowUpList
          heading="Oppfølginger denne uken"
          items={thisWeek.map(toFollowUpItem)}
          seeAllHref="/leads?view=liste&dato=uke&aktive=1"
          emptyText="Ingen oppfølginger igjen denne uken."
          stages={stages}
        />
        <FollowUpList
          heading="Oppfølginger, forfalt"
          items={overdue.map(toFollowUpItem)}
          seeAllHref="/leads?view=liste&dato=forfalt&aktive=1"
          emptyText="Ingenting er forfalt. Godt jobbet."
          tone="danger"
          stages={stages}
        />
      </div>

      <div className="mb-6">
        <MonthCalendar
          deals={withFollowUp.map((d) => ({
            id: d.id,
            title: d.title,
            companyName: d.companyName,
            followUpAt: d.followUpAt!.getTime(),
          }))}
        />
      </div>

      <div className="grid gap-6">
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
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
                  <div className="min-w-0">
                    <p className="text-ink">
                      <span className="font-medium">{a.userName ?? "System"}</span>{" "}
                      <span className="text-ink-soft">{a.content}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      <Link href={`/leads/${a.dealId}`} className="hover:text-accent">
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
  );
}
