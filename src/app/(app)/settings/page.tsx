import { eq } from "drizzle-orm";
import { db, emailAccounts, companies } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  addUser,
  connectEmailAccount,
  disconnectEmailAccount,
  updateSignature,
} from "@/lib/actions";
import { formatDateTime, initials } from "@/lib/format";
import SyncButton from "@/components/SyncButton";
import BrregMatchAll from "@/components/BrregMatchAll";
import { Mail, ShieldCheck, TriangleAlert, Building2, Signature } from "lucide-react";

// E-postsynk og brreg-matching kan ta lenger enn Vercels standard 10 sekunder.
// Krever Vercel Pro (eller Fluid Compute) for å faktisk få mer enn 10–15 sek;
// på Hobby er dette et ønske, ikke en garanti.
export const maxDuration = 60;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const me = await requireUser();
  const params = await searchParams;

  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  const allUsers = await db.query.users.findMany();
  const unverifiedCount = (
    await db.query.companies.findMany({ where: eq(companies.brregVerified, false) })
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-[26px] font-semibold tracking-tight">Innstillinger</h1>
      <p className="mb-8 text-ink-soft">E-postkobling og brukere.</p>

      <section className="card mb-6 p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
            <Mail size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Din e-postkonto</h2>
            <p className="text-[12.5px] text-ink-soft">
              E-poster til og fra kontaktene dine logges automatisk på riktig lead.
              Innholdet er privat for deg til du gir andre innsyn.
            </p>
          </div>
        </div>

        {params.connected && (
          <p className="mb-3 rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-[#1d7a3a]">
            E-postkontoen er koblet til. Kjør en synkronisering for å hente dialogen.
          </p>
        )}

        {account ? (
          <div>
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-black/[0.03] p-4">
              <ShieldCheck size={18} className="text-success" />
              <div className="flex-1">
                <p className="text-[13.5px] font-medium">{account.email}</p>
                <p className="text-[12.5px] text-ink-soft">
                  {account.imapHost} ·{" "}
                  {account.lastSyncAt
                    ? `Sist synkronisert ${formatDateTime(account.lastSyncAt)}`
                    : "Ikke synkronisert ennå"}
                </p>
              </div>
              <form action={disconnectEmailAccount}>
                <button type="submit" className="btn btn-danger">
                  Koble fra
                </button>
              </form>
            </div>
            {account.lastError && (
              <p className="mb-4 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                Siste synk feilet: {account.lastError}
              </p>
            )}
            <SyncButton />
          </div>
        ) : (
          <form action={connectEmailAccount} className="flex flex-col gap-2.5">
            <label className="text-[12px] font-medium text-ink-soft">
              E-postadresse
              <input
                name="email"
                type="email"
                required
                defaultValue={me.email}
                className="field mt-1"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-soft">
              App-passord
              <input
                name="password"
                type="password"
                required
                placeholder="xxxx xxxx xxxx xxxx"
                className="field mt-1"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-soft">
              IMAP-server
              <input name="imapHost" defaultValue="imap.gmail.com" className="field mt-1" />
            </label>
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              For Google Workspace: lag et app-passord på{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              (krever totrinnsbekreftelse). Passordet lagres kryptert og brukes kun til å
              lese innboks og sendte e-poster.
            </p>
            <button type="submit" className="btn btn-primary mt-1 self-start">
              Koble til
            </button>
            {params.error === "imap" && (
              <p className="text-[13px] text-danger">Fyll inn e-post og app-passord.</p>
            )}
          </form>
        )}
      </section>

      <section className="card mb-6 p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
            <Signature size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">E-postsignatur</h2>
            <p className="text-[12.5px] text-ink-soft">
              Legges til under pristilbud og andre e-poster som sendes fra appen.
            </p>
          </div>
        </div>
        <form action={updateSignature} className="flex flex-col gap-2.5">
          <textarea
            name="signature"
            rows={4}
            defaultValue={me.signature ?? ""}
            placeholder={"Med vennlig hilsen\nOdd-Erik\nCure"}
            className="field resize-none"
          />
          <button type="submit" className="btn btn-secondary self-start">
            Lagre signatur
          </button>
        </form>
      </section>

      <section className="card mb-6 p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
            <Building2 size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Enhetsregisteret
            </h2>
            <p className="text-[12.5px] text-ink-soft">
              Kobler selskapene til organisasjonsnummer, offisielt navn, regnskap og
              daglig leder.
            </p>
          </div>
        </div>
        <BrregMatchAll unverified={unverifiedCount} />
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Brukere</h2>
        <p className="mb-4 text-[12.5px] text-ink-soft">
          Alle brukere ser leads, faser og kontakter — men e-postdialog er privat per bruker.
        </p>
        <ul className="mb-5 flex flex-col gap-2">
          {allUsers.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-xl bg-black/[0.03] px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                {initials(u.name)}
              </span>
              <div className="flex-1">
                <p className="text-[13.5px] font-medium">
                  {u.name}
                  {u.id === me.id && <span className="ml-1.5 text-ink-faint">(deg)</span>}
                </p>
                <p className="text-[12.5px] text-ink-soft">{u.email}</p>
              </div>
              {u.isAdmin && (
                <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium text-ink-soft">
                  Administrator
                </span>
              )}
            </li>
          ))}
        </ul>

        {me.isAdmin && (
          <form action={addUser} className="flex flex-col gap-2.5 border-t border-line pt-5">
            <h3 className="text-[13.5px] font-semibold">Legg til bruker</h3>
            <div className="grid grid-cols-2 gap-2">
              <input name="name" required placeholder="Fullt navn" className="field" />
              <input name="email" type="email" required placeholder="E-post" className="field" />
            </div>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Midlertidig passord (minst 8 tegn)"
              className="field"
            />
            {params.error === "bruker" && (
              <p className="text-[13px] text-danger">Kunne ikke opprette brukeren.</p>
            )}
            <button type="submit" className="btn btn-secondary self-start">
              Opprett bruker
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
