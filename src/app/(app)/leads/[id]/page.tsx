import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  deals,
  companies,
  people,
  companyPeople,
  activities as activitiesTable,
  users,
  emailMessages,
  emailAccounts,
  emailAccessGrants,
  dealLines as dealLinesTable,
  contactEvents,
  dealOwners,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  addPersonToCompany,
  addNote,
  unlinkPersonFromCompany,
  setFollowUp,
  updateDealDetails,
} from "@/lib/actions";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumberInput,
  relativeDay,
  toDateInputValue,
} from "@/lib/format";
import DealLines from "@/components/DealLines";
import CompanyLogo from "@/components/CompanyLogo";
import StageSelect from "@/components/StageSelect";
import DeleteDealButton from "@/components/DeleteDealButton";
import EmailThread from "@/components/EmailThread";
import RequestAccessButton from "@/components/RequestAccessButton";
import AccessRequestCard from "@/components/AccessRequestCard";
import SendQuoteButton from "@/components/SendQuoteButton";
import DialogLog from "@/components/DialogLog";
import DealOwners from "@/components/DealOwners";
import { ArrowLeft, Globe, Mail, Phone, Trash2, Lock, Calculator } from "lucide-react";
import { getStages } from "@/lib/stages.server";
import { stageDot, stageLabel } from "@/lib/stages";
import { getLostReasons } from "@/lib/lostReasons.server";

export default async function DealPage({ params }: PageProps<"/leads/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isFinite(dealId)) notFound();

  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) notFound();
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, deal.companyId),
  });
  if (!company) notFound();

  const owner = await db.query.users.findFirst({ where: eq(users.id, deal.ownerId) });

  const coOwnerRows = await db
    .select({ id: users.id, name: users.name, avatarDataUrl: users.avatarDataUrl })
    .from(dealOwners)
    .innerJoin(users, eq(dealOwners.userId, users.id))
    .where(eq(dealOwners.dealId, dealId))
    .orderBy(asc(dealOwners.createdAt));

  const allUsers = await db.query.users.findMany({ orderBy: [asc(users.name)] });
  const stages = await getStages();
  const lostReasons = await getLostReasons();

  const otherDeals = await db.query.deals.findMany({
    where: and(eq(deals.companyId, company.id), ne(deals.id, deal.id)),
    orderBy: [desc(deals.updatedAt)],
  });

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
    .where(eq(companyPeople.companyId, company.id))
    .orderBy(asc(companyPeople.createdAt));

  const lines = await db.query.dealLines.findMany({
    where: eq(dealLinesTable.dealId, dealId),
    orderBy: [asc(dealLinesTable.createdAt)],
  });

  const activityRows = await db
    .select({
      id: activitiesTable.id,
      type: activitiesTable.type,
      content: activitiesTable.content,
      createdAt: activitiesTable.createdAt,
      userName: users.name,
    })
    .from(activitiesTable)
    .leftJoin(users, eq(activitiesTable.userId, users.id))
    .where(eq(activitiesTable.dealId, dealId))
    .orderBy(desc(activitiesTable.createdAt));

  // E-postdialog: meldinger på selskapet, gruppert per kontoeier, med tilgangssjekk.
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
    .where(eq(emailMessages.companyId, company.id))
    .orderBy(desc(emailMessages.sentAt));

  // Manuelt loggede kontaktpunkter (møte/mail/telefon/tilbud) — selskapsbredt,
  // vises i "Dialog med X" sammen med den ekte e-postdialogen under.
  const dialogEvents = await db
    .select({
      id: contactEvents.id,
      kind: contactEvents.kind,
      note: contactEvents.note,
      occurredAt: contactEvents.occurredAt,
      userName: users.name,
    })
    .from(contactEvents)
    .leftJoin(users, eq(contactEvents.userId, users.id))
    .where(eq(contactEvents.companyId, company.id))
    .orderBy(desc(contactEvents.occurredAt))
    .limit(15);

  const dialogOwners = [...new Set(messages.map((m) => m.ownerUserId))];
  const grants = dialogOwners.length
    ? await db.query.emailAccessGrants.findMany({
        where: and(
          eq(emailAccessGrants.companyId, company.id),
          eq(emailAccessGrants.granteeUserId, me.id),
          inArray(emailAccessGrants.ownerUserId, dialogOwners)
        ),
      })
    : [];

  const ownerUsers = dialogOwners.length
    ? await db.query.users.findMany({ where: inArray(users.id, dialogOwners) })
    : [];
  const ownerNameById = new Map(ownerUsers.map((u) => [u.id, u.name]));

  const myPendingRequests = await db
    .select({
      id: emailAccessGrants.id,
      requesterName: users.name,
    })
    .from(emailAccessGrants)
    .innerJoin(users, eq(emailAccessGrants.granteeUserId, users.id))
    .where(
      and(
        eq(emailAccessGrants.companyId, company.id),
        eq(emailAccessGrants.ownerUserId, me.id),
        eq(emailAccessGrants.status, "requested")
      )
    );

  const rel = deal.followUpAt ? relativeDay(deal.followUpAt) : null;

  const addContactBound = addPersonToCompany.bind(null, company.id, dealId);
  const addNoteBound = addNote.bind(null, dealId);
  const setFollowUpBound = setFollowUp.bind(null, dealId);
  const updateDetailsBound = updateDealDetails.bind(null, dealId);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/leads"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={14} />
        Pipeline
      </Link>

      <div className="mb-6 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <CompanyLogo logoUrl={company.logoUrl} name={company.name} size={56} radius={14} />
          <div>
            <Link
              href={`/companies/${company.id}`}
              className="text-[13px] font-medium text-ink-soft transition hover:text-accent"
            >
              {company.name}
            </Link>
            <h1 className="text-[24px] font-semibold tracking-tight">{deal.title}</h1>
            <div className="mt-1 flex items-center gap-3 text-[13px] text-ink-soft">
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
              <DealOwners
                dealId={deal.id}
                primaryOwner={{
                  id: deal.ownerId,
                  name: owner?.name ?? "Ukjent",
                  avatarDataUrl: owner?.avatarDataUrl ?? null,
                }}
                coOwners={coOwnerRows}
                allUsers={allUsers.map((u) => ({
                  id: u.id,
                  name: u.name,
                  avatarDataUrl: u.avatarDataUrl,
                }))}
              />
              <span>Opprettet {formatDate(deal.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <StageSelect
          dealId={deal.id}
          stage={deal.stage}
          dealName={`${company.name} · ${deal.title}`}
          stages={stages}
          lostReasons={lostReasons.map((r) => ({ id: r.id, label: r.label }))}
        />
      </div>

      {myPendingRequests.map((r) => (
        <div key={r.id} className="mb-4">
          <AccessRequestCard
            grantId={r.id}
            requesterName={r.requesterName}
            companyName={company.name}
            dealId={deal.id}
          />
        </div>
      ))}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.25fr]">
        {/* Venstre kolonne */}
        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Oppfølging</h2>
            <form action={setFollowUpBound} className="flex items-center gap-2">
              <input
                type="date"
                name="followUpAt"
                defaultValue={toDateInputValue(deal.followUpAt)}
                className="field flex-1"
              />
              <button type="submit" className="btn btn-secondary">
                Lagre
              </button>
            </form>
            {rel && (
              <p
                className={`mt-3 text-[13px] font-medium ${
                  rel.tone === "overdue"
                    ? "text-danger"
                    : rel.tone === "today"
                      ? "text-warning-ink"
                      : "text-ink-soft"
                }`}
              >
                {rel.tone === "overdue" ? "Forfalt: " : "Neste oppfølging: "}
                {rel.label}
              </p>
            )}
          </section>

          {otherDeals.length > 0 && (
            <section className="card p-6">
              <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
                Andre deals med {company.name}
              </h2>
              <ul className="flex flex-col gap-1">
                {otherDeals.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/leads/${d.id}`}
                      className="-mx-2 flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-mist/[0.03]"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: stageDot(stages, d.stage) }}
                      />
                      <span className="flex-1 truncate text-[13.5px] font-medium">
                        {d.title}
                      </span>
                      <span className="text-[12px] text-ink-soft">{stageLabel(stages, d.stage)}</span>
                      {d.value ? (
                        <span className="text-[12px] font-medium text-ink-soft">
                          {formatMoney(d.value)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Kontakter</h2>
            <ul className="mb-4 flex flex-col gap-3">
              {contacts.map((c) => (
                <li key={c.id} className="group flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mist/[0.05] text-[12px] font-semibold text-ink-soft">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">
                      <Link href={`/people/${c.id}`} className="hover:text-accent">
                        {c.name}
                      </Link>
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
                  <form action={unlinkPersonFromCompany.bind(null, c.id, company.id, dealId)}>
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
            <form action={addContactBound} className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <input name="name" required placeholder="Navn" className="field" />
                <input name="role" placeholder="Rolle" className="field" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input name="email" type="email" placeholder="E-post" className="field" />
                <input name="phone" placeholder="Telefon" className="field" />
              </div>
              <button type="submit" className="btn btn-ghost self-start">
                + Legg til kontakt
              </button>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Detaljer</h2>
            <form action={updateDetailsBound} className="flex flex-col gap-2.5">
              <label className="text-[12px] font-medium text-ink-soft">
                Dealnavn
                <input name="dealTitle" defaultValue={deal.title} className="field mt-1" />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Kommentar
                <textarea
                  name="comment"
                  rows={2}
                  defaultValue={deal.comment ?? ""}
                  placeholder="Kort status eller huskelapp …"
                  className="field mt-1 resize-none"
                />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Firmanavn
                <input name="companyName" defaultValue={company.name} className="field mt-1" />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Nettside
                <input
                  name="website"
                  defaultValue={company.website ?? ""}
                  className="field mt-1"
                />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Estimert verdi (kr)
                {lines.length > 0 ? (
                  <span className="field mt-1 block bg-mist/[0.03] text-ink-soft">
                    {formatMoney(deal.value)} — beregnes fra varelinjene
                  </span>
                ) : (
                  <input
                    name="value"
                    inputMode="numeric"
                    defaultValue={formatNumberInput(deal.value)}
                    className="field mt-1"
                  />
                )}
              </label>
              <button type="submit" className="btn btn-secondary mt-1 self-start">
                Lagre endringer
              </button>
            </form>
          </section>

          <div className="self-start">
            <DeleteDealButton dealId={deal.id} />
          </div>
        </div>

        {/* Høyre kolonne */}
        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight">Varelinjer</h2>
              <div className="flex items-center gap-3">
                {deal.value != null && lines.length > 0 && (
                  <span className="text-[12.5px] text-ink-soft">
                    Dealverdi: {formatMoney(deal.value)}
                  </span>
                )}
                <Link
                  href={`/estimat?dealId=${deal.id}`}
                  className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
                >
                  <Calculator size={13} />
                  Prisverktøy
                </Link>
              </div>
            </div>
            {lines.length === 0 && (
              <p className="mb-3 text-[13px] text-ink-faint">
                Legg til fasene i prosjektet med timer og timepris — totalsummen blir
                verdien på dealen.
              </p>
            )}
            <DealLines
              dealId={deal.id}
              lines={lines.map((l) => ({
                id: l.id,
                title: l.title,
                hours: l.hours,
                rate: l.rate,
              }))}
            />
            {lines.length > 0 && (
              <div className="mt-3">
                <SendQuoteButton
                  dealId={deal.id}
                  dealTitle={deal.title}
                  contacts={contacts
                    .filter((c): c is typeof c & { email: string } => !!c.email)
                    .map((c) => ({ id: c.id, name: c.name, email: c.email }))}
                />
              </div>
            )}
          </section>

          <section className="card p-6">
            <DialogLog
              companyId={company.id}
              companyName={company.name}
              items={dialogEvents.map((e) => ({
                id: e.id,
                kind: e.kind,
                note: e.note,
                occurredAt: e.occurredAt.getTime(),
                userName: e.userName,
              }))}
            />

            <div className="mt-5 border-t border-line pt-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
                <Mail size={14} />
                E-post
              </h3>
              {messages.length === 0 ? (
                <p className="py-2 text-[13px] text-ink-faint">
                  Ingen e-poster logget ennå. Koble til e-postkontoen din under Innstillinger,
                  så matches dialog med kontaktene automatisk.
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
                        <RequestAccessButton companyId={company.id} ownerUserId={ownerId} />
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Notater og aktivitet</h2>
            <form action={addNoteBound} className="mb-5 flex flex-col gap-2">
              <textarea
                name="content"
                rows={2}
                required
                placeholder="Skriv et notat …"
                className="field resize-none"
              />
              <button type="submit" className="btn btn-secondary self-end">
                Legg til notat
              </button>
            </form>
            <ul className="flex flex-col gap-4">
              {activityRows.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span
                    className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      a.type === "note" ? "bg-accent" : a.type === "won" ? "bg-success" : "bg-ink-faint"
                    }`}
                  />
                  <div>
                    <p
                      className={`text-[13px] ${
                        a.type === "note" ? "" : a.type === "won" ? "text-success-ink" : "text-ink-soft"
                      }`}
                    >
                      {a.type !== "note" && (
                        <span
                          className={`font-medium ${a.type === "won" ? "text-success-ink" : "text-ink"}`}
                        >
                          {a.userName ?? "System"}{" "}
                        </span>
                      )}
                      {a.content}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint">
                      {a.type === "note" ? `${a.userName ?? "Ukjent"} · ` : ""}
                      {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
