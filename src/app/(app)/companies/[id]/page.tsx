import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  companies,
  deals,
  people,
  companyPeople,
  contactEvents,
  users,
  emailMessages,
  emailAccounts,
  emailAccessGrants,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addPersonToCompany, unlinkPersonFromCompany } from "@/lib/actions";
import CompanyFacts from "@/components/CompanyFacts";
import CompanyEditForm from "@/components/CompanyEditForm";
import NewDealOnCompanyButton from "@/components/NewDealOnCompanyButton";
import ContactLog from "@/components/ContactLog";
import { formatDate, formatMoney, relativeDay } from "@/lib/format";
import { getStages } from "@/lib/stages.server";
import { stageDot, stageLabel } from "@/lib/stages";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import EmailThread from "@/components/EmailThread";
import RequestAccessButton from "@/components/RequestAccessButton";
import {
  ArrowLeft,
  Globe,
  Mail,
  Phone,
  Trash2,
  Lock,
  Plus,
  Star,
  TriangleAlert,
} from "lucide-react";

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const companyId = Number(id);
  if (!Number.isFinite(companyId)) notFound();

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company) notFound();

  const companyDeals = await db
    .select({
      id: deals.id,
      title: deals.title,
      stage: deals.stage,
      value: deals.value,
      followUpAt: deals.followUpAt,
      comment: deals.comment,
      ownerName: users.name,
    })
    .from(deals)
    .leftJoin(users, eq(deals.ownerId, users.id))
    .where(eq(deals.companyId, companyId))
    .orderBy(desc(deals.updatedAt));

  const contacts = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      phone: people.phone,
      role: companyPeople.role,
    })
    .from(companyPeople)
    .innerJoin(people, eq(companyPeople.personId, people.id))
    .where(eq(companyPeople.companyId, companyId))
    .orderBy(asc(companyPeople.createdAt));

  const messages = await db
    .select({
      id: emailMessages.id,
      direction: emailMessages.direction,
      subject: emailMessages.subject,
      fromAddr: emailMessages.fromAddr,
      toAddr: emailMessages.toAddr,
      snippet: emailMessages.snippet,
      bodyText: emailMessages.bodyText,
      sentAt: emailMessages.sentAt,
      ownerUserId: emailAccounts.userId,
    })
    .from(emailMessages)
    .innerJoin(emailAccounts, eq(emailMessages.accountId, emailAccounts.id))
    .where(eq(emailMessages.companyId, companyId))
    .orderBy(desc(emailMessages.sentAt));

  const dialogOwners = [...new Set(messages.map((m) => m.ownerUserId))];
  const grants = dialogOwners.length
    ? await db.query.emailAccessGrants.findMany({
        where: and(
          eq(emailAccessGrants.companyId, companyId),
          eq(emailAccessGrants.granteeUserId, me.id),
          inArray(emailAccessGrants.ownerUserId, dialogOwners)
        ),
      })
    : [];
  const ownerUsers = dialogOwners.length
    ? await db.query.users.findMany({ where: inArray(users.id, dialogOwners) })
    : [];
  const ownerNameById = new Map(ownerUsers.map((u) => [u.id, u.name]));

  // Kontakthistorikk = manuelt loggede hendelser + automatisk fra logget e-post.
  const manualContacts = await db
    .select({
      id: contactEvents.id,
      kind: contactEvents.kind,
      note: contactEvents.note,
      occurredAt: contactEvents.occurredAt,
      userName: users.name,
    })
    .from(contactEvents)
    .leftJoin(users, eq(contactEvents.userId, users.id))
    .where(eq(contactEvents.companyId, companyId))
    .orderBy(desc(contactEvents.occurredAt));

  const emailContacts = messages
    .filter((m) => m.sentAt)
    .map((m) => ({
      id: m.id,
      kind: "epost",
      note: m.subject,
      occurredAt: m.sentAt!,
      userName: ownerNameById.get(m.ownerUserId) ?? null,
    }));

  const contactHistory = [
    ...manualContacts.map((c) => ({ ...c, source: "manuell" as const })),
    ...emailContacts.map((c) => ({ ...c, source: "epost" as const })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 12);

  const lastContact = contactHistory[0]
    ? {
        at: contactHistory[0].occurredAt.getTime(),
        by: contactHistory[0].userName,
        kind: contactHistory[0].kind,
      }
    : null;

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const companyOwner = allUsers.find((u) => u.id === company.ownerId);

  const stages = await getStages();
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => String(s.id)));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => String(s.id)));

  const openDeals = companyDeals.filter(
    (d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage)
  );
  const openValue = openDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);
  const wonValue = companyDeals
    .filter((d) => wonStageIds.has(d.stage))
    .reduce((acc, d) => acc + (d.value ?? 0), 0);

  const addPersonBound = addPersonToCompany.bind(null, companyId, null);
  const primaryContact = contacts.find((c) => c.id === company.primaryContactId);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/companies"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={14} />
        Bedrifter
      </Link>

      <div className="mb-6 flex items-center gap-4">
        <CompanyLogo logoUrl={company.logoUrl} name={company.name} size={56} radius={14} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[24px] font-semibold tracking-tight">
            {company.name}
            {!company.brregVerified && (
              <TriangleAlert
                size={17}
                className="shrink-0 text-warning-ink"
                aria-label="Ikke bekreftet mot Enhetsregisteret"
              />
            )}
          </h1>
          {company.orgName && company.orgName !== company.name && (
            <p className="text-[13px] text-ink-soft">{company.orgName}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
            {companyOwner && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={companyOwner.name} size={18} />
                {companyOwner.name}
              </span>
            )}
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-accent"
              >
                <Globe size={13} />
                {company.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {company.orgNumber && (
              <span className="tabular-nums">
                Org nr {company.orgNumber.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}
              </span>
            )}
            {primaryContact && (
              <Link
                href={`/people/${primaryContact.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent transition hover:brightness-95"
              >
                <Star size={11} strokeWidth={2.5} />
                {primaryContact.name}
              </Link>
            )}
            <span>Lagt inn {formatDate(company.createdAt)}</span>
          </div>
        </div>
        <NewDealOnCompanyButton companyId={company.id} companyName={company.name} />
      </div>

      <div className="mb-6 grid grid-cols-4 gap-4">
        {[
          { label: "Deals totalt", value: String(companyDeals.length) },
          { label: "Åpne deals", value: String(openDeals.length) },
          { label: "Åpen verdi", value: openValue > 0 ? formatMoney(openValue) : "—" },
          { label: "Vunnet verdi", value: wonValue > 0 ? formatMoney(wonValue) : "—" },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-[19px] font-semibold tracking-tight">{s.value}</p>
            <p className="text-[12px] text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-6">
          <CompanyFacts
            company={{
              id: company.id,
              name: company.name,
              orgName: company.orgName,
              orgNumber: company.orgNumber,
              brregVerified: company.brregVerified,
              phone: company.phone,
              address: company.address,
              postalCode: company.postalCode,
              city: company.city,
              employees: company.employees,
              industry: company.industry,
              ceoName: company.ceoName,
              revenue: company.revenue,
              profit: company.profit,
              fiscalYear: company.fiscalYear,
              brregSyncedAt: company.brregSyncedAt ? company.brregSyncedAt.getTime() : null,
            }}
            lastContact={lastContact}
          />

          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Deals</h2>
            {companyDeals.length === 0 ? (
              <p className="py-3 text-[13px] text-ink-faint">Ingen deals på dette selskapet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {companyDeals.map((d) => {
                  const rel = d.followUpAt ? relativeDay(d.followUpAt) : null;
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/leads/${d.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-mist/[0.03]"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: stageDot(stages, d.stage) }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {d.title}
                          </span>
                          <span className="text-[12px] text-ink-soft">
                            {stageLabel(stages, d.stage)}
                            {d.comment ? ` · ${d.comment}` : ""}
                          </span>
                        </span>
                        {rel && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              rel.tone === "overdue"
                                ? "bg-danger/10 text-danger"
                                : rel.tone === "today"
                                  ? "bg-warning/15 text-warning-ink"
                                  : "bg-mist/[0.05] text-ink-soft"
                            }`}
                          >
                            {rel.label}
                          </span>
                        )}
                        <span className="shrink-0 text-[13px] font-medium tabular-nums">
                          {d.value ? formatMoney(d.value) : "—"}
                        </span>
                        {d.ownerName && <Avatar name={d.ownerName} size={22} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <Mail size={15} className="text-ink-soft" />
              E-postdialog
            </h2>
            {messages.length === 0 ? (
              <p className="py-3 text-[13px] text-ink-faint">
                Ingen e-poster logget på dette selskapet ennå.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {dialogOwners.map((ownerId) => {
                  const ownerMessages = messages.filter((m) => m.ownerUserId === ownerId);
                  const isMine = ownerId === me.id;
                  const grant = grants.find((g) => g.ownerUserId === ownerId);
                  const canSee = isMine || grant?.status === "granted";
                  const ownerName = ownerNameById.get(ownerId) ?? "Ukjent";

                  if (canSee) {
                    return (
                      <EmailThread
                        key={ownerId}
                        ownerName={isMine ? null : ownerName}
                        messages={ownerMessages.map((m) => ({
                          id: m.id,
                          direction: m.direction,
                          subject: m.subject,
                          fromAddr: m.fromAddr,
                          toAddr: m.toAddr,
                          snippet: m.snippet,
                          bodyText: m.bodyText,
                          sentAt: m.sentAt ? m.sentAt.getTime() : null,
                        }))}
                      />
                    );
                  }
                  return (
                    <div
                      key={ownerId}
                      className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-mist/[0.02] p-4"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mist/[0.05] text-ink-soft">
                        <Lock size={15} />
                      </span>
                      <div className="flex-1">
                        <p className="text-[13.5px] font-medium">
                          {ownerMessages.length} e-post
                          {ownerMessages.length === 1 ? "" : "er"} i {ownerName}s dialog
                        </p>
                        <p className="text-[12.5px] text-ink-soft">
                          {grant?.status === "requested"
                            ? "Forespørsel sendt — venter på godkjenning."
                            : grant?.status === "denied"
                              ? "Forespørselen ble avslått."
                              : "Innholdet er privat. Be om innsyn for å lese dialogen."}
                        </p>
                      </div>
                      {grant?.status !== "requested" && (
                        <RequestAccessButton companyId={companyId} ownerUserId={ownerId} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Personer</h2>
            <ul className="mb-4 flex flex-col gap-3">
              {contacts.length === 0 && (
                <li className="text-[13px] text-ink-faint">Ingen personer registrert.</li>
              )}
              {contacts.map((c) => (
                <li key={c.id} className="group flex items-start gap-3">
                  <Avatar name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">
                      <Link href={`/people/${c.id}`} className="hover:text-accent">
                        {c.name}
                      </Link>
                      {c.id === company.primaryContactId && (
                        <Star
                          size={11}
                          strokeWidth={2.5}
                          className="ml-1.5 inline align-middle text-accent"
                          aria-label="Hovedkontakt"
                        />
                      )}
                      {c.role && (
                        <span className="ml-1.5 font-normal text-ink-faint">{c.role}</span>
                      )}
                    </p>
                    <div className="mt-0.5 flex flex-col gap-0.5 text-[12.5px] text-ink-soft">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="inline-flex items-center gap-1.5 hover:text-accent"
                        >
                          <Mail size={12} /> {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone size={12} /> {c.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <form action={unlinkPersonFromCompany.bind(null, c.id, companyId, undefined)}>
                    <button
                      type="submit"
                      title="Fjern fra selskapet"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addPersonBound} className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <input name="name" required placeholder="Navn" className="field" />
                <input name="role" placeholder="Rolle" className="field" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input name="email" type="email" placeholder="E-post" className="field" />
                <input name="phone" placeholder="Telefon" className="field" />
              </div>
              <button type="submit" className="btn btn-ghost self-start">
                <Plus size={14} />
                Legg til person
              </button>
            </form>
          </section>

          <ContactLog
            companyId={company.id}
            items={contactHistory.map((c) => ({
              id: c.id,
              kind: c.kind,
              note: c.note,
              occurredAt: c.occurredAt.getTime(),
              userName: c.userName,
              source: c.source,
            }))}
          />

          <CompanyEditForm
            company={{
              id: company.id,
              name: company.name,
              orgName: company.orgName,
              orgNumber: company.orgNumber,
              website: company.website,
              phone: company.phone,
              primaryContactId: company.primaryContactId,
              ownerId: company.ownerId,
            }}
            people={contacts.map((c) => ({ id: c.id, name: c.name }))}
            users={allUsers.map((u) => ({ id: u.id, name: u.name }))}
          />
        </div>
      </div>
    </div>
  );
}
