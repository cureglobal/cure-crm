import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  people,
  companies,
  companyPeople,
  deals,
  users,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { linkPersonToCompany, unlinkPersonFromCompany, updatePerson } from "@/lib/actions";
import { formatDate, formatMoney, relativeDay } from "@/lib/format";
import { stageDot, stageLabel } from "@/lib/stages";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import DeletePersonButton from "@/components/DeletePersonButton";
import { ArrowLeft, Mail, Phone, Plus, Trash2 } from "lucide-react";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  await requireUser();
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isFinite(personId)) notFound();

  const person = await db.query.people.findFirst({ where: eq(people.id, personId) });
  if (!person) notFound();

  const links = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
      website: companies.website,
      role: companyPeople.role,
      since: companyPeople.createdAt,
    })
    .from(companyPeople)
    .innerJoin(companies, eq(companyPeople.companyId, companies.id))
    .where(eq(companyPeople.personId, personId))
    .orderBy(asc(companies.name));

  const companyIds = links.map((l) => l.companyId);
  const relatedDeals = companyIds.length
    ? await db
        .select({
          id: deals.id,
          title: deals.title,
          stage: deals.stage,
          value: deals.value,
          followUpAt: deals.followUpAt,
          companyId: deals.companyId,
          companyName: companies.name,
          ownerName: users.name,
        })
        .from(deals)
        .innerJoin(companies, eq(deals.companyId, companies.id))
        .leftJoin(users, eq(deals.ownerId, users.id))
        .where(inArray(deals.companyId, companyIds))
        .orderBy(desc(deals.updatedAt))
    : [];

  const availableCompanies = await db.query.companies.findMany({
    orderBy: [asc(companies.name)],
  });
  const unlinked = availableCompanies.filter((c) => !companyIds.includes(c.id));

  const updateBound = updatePerson.bind(null, personId);
  const linkBound = linkPersonToCompany.bind(null, personId);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/people"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft size={14} />
        Personer
      </Link>

      <div className="mb-6 flex items-center gap-4">
        <Avatar name={person.name} size={56} />
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">{person.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
            {person.email && (
              <a
                href={`mailto:${person.email}`}
                className="inline-flex items-center gap-1 hover:text-accent"
              >
                <Mail size={13} />
                {person.email}
              </a>
            )}
            {person.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={13} />
                {person.phone}
              </span>
            )}
            <span>Lagt inn {formatDate(person.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
              Selskaper ({links.length})
            </h2>
            <ul className="mb-4 flex flex-col gap-2">
              {links.length === 0 && (
                <li className="text-[13px] text-ink-faint">
                  Ikke knyttet til noe selskap ennå.
                </li>
              )}
              {links.map((l) => (
                <li key={l.companyId} className="group flex items-center gap-3">
                  <CompanyLogo logoUrl={l.logoUrl} name={l.companyName} size={32} radius={9} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/companies/${l.companyId}`}
                      className="block truncate text-[13.5px] font-medium hover:text-accent"
                    >
                      {l.companyName}
                    </Link>
                    <p className="text-[12px] text-ink-soft">
                      {l.role || "Ingen rolle satt"} · siden {formatDate(l.since)}
                    </p>
                  </div>
                  <form action={unlinkPersonFromCompany.bind(null, personId, l.companyId, undefined)}>
                    <button
                      type="submit"
                      title="Fjern tilknytning"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>

            {unlinked.length > 0 && (
              <form action={linkBound} className="flex flex-col gap-2 border-t border-line pt-4">
                <p className="text-[12px] font-medium text-ink-soft">
                  Knytt til et selskap til
                </p>
                <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                  <select name="companyId" required defaultValue="" className="field">
                    <option value="" disabled>
                      Velg selskap …
                    </option>
                    {unlinked.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input name="role" placeholder="Rolle" className="field" />
                </div>
                <button type="submit" className="btn btn-ghost self-start">
                  <Plus size={14} />
                  Legg til
                </button>
              </form>
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Kontaktinfo</h2>
            <form action={updateBound} className="flex flex-col gap-2.5">
              <label className="text-[12px] font-medium text-ink-soft">
                Navn
                <input name="name" defaultValue={person.name} className="field mt-1" />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                E-post
                <input
                  name="email"
                  type="email"
                  defaultValue={person.email ?? ""}
                  className="field mt-1"
                />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Telefon
                <input name="phone" defaultValue={person.phone ?? ""} className="field mt-1" />
              </label>
              <label className="text-[12px] font-medium text-ink-soft">
                Notat
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={person.notes ?? ""}
                  placeholder="Fritekst om personen …"
                  className="field mt-1 resize-none"
                />
              </label>
              <button type="submit" className="btn btn-secondary mt-1 self-start">
                Lagre
              </button>
            </form>
          </section>

          <div className="self-start">
            <DeletePersonButton personId={personId} name={person.name} />
          </div>
        </div>

        <section className="card p-6">
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
            Deals i disse selskapene
          </h2>
          {relatedDeals.length === 0 ? (
            <p className="py-3 text-[13px] text-ink-faint">Ingen deals ennå.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {relatedDeals.map((d) => {
                const rel = d.followUpAt ? relativeDay(d.followUpAt) : null;
                return (
                  <li key={d.id}>
                    <Link
                      href={`/leads/${d.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-black/[0.03]"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: stageDot(d.stage) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {d.title}
                        </span>
                        <span className="text-[12px] text-ink-soft">
                          {d.companyName} · {stageLabel(d.stage)}
                        </span>
                      </span>
                      {rel && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            rel.tone === "overdue"
                              ? "bg-danger/10 text-danger"
                              : rel.tone === "today"
                                ? "bg-warning/15 text-[#b06a00]"
                                : "bg-black/[0.05] text-ink-soft"
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
      </div>
    </div>
  );
}
