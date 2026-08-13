import { db } from "@/lib/db";
import { login, setupFirstUser } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const params = await searchParams;
  const hasUsers = Boolean(await db.query.users.findFirst());
  const error = params.error;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-xl font-semibold text-white shadow-pop">
            C
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {hasUsers ? "Logg inn i Cure CRM" : "Velkommen til Cure CRM"}
          </h1>
          <p className="mt-1.5 text-ink-soft">
            {hasUsers
              ? "Bruk e-post og passord."
              : "Opprett administratorkontoen din for å komme i gang."}
          </p>
        </div>

        <form
          action={hasUsers ? login : setupFirstUser}
          className="card flex flex-col gap-3 p-6"
        >
          {!hasUsers && (
            <input name="name" placeholder="Fullt navn" required className="field" />
          )}
          <input
            name="email"
            type="email"
            placeholder="E-post"
            required
            className="field"
            defaultValue=""
          />
          <input
            name="password"
            type="password"
            placeholder={hasUsers ? "Passord" : "Velg passord (minst 8 tegn)"}
            required
            minLength={hasUsers ? undefined : 8}
            className="field"
          />
          {error && (
            <p className="text-[13px] text-danger">
              {error === "1"
                ? "Feil e-post eller passord."
                : error === "locked"
                  ? "For mange mislykkede forsøk. Prøv igjen om litt."
                  : "Kunne ikke opprette bruker."}
            </p>
          )}
          <button type="submit" className="btn btn-primary mt-1 w-full py-2.5">
            {hasUsers ? "Logg inn" : "Opprett konto"}
          </button>
        </form>
      </div>
    </main>
  );
}
