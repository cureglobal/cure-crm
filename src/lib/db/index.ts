import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";
import * as schema from "./schema";
import { migrate } from "./migrate";

// Samme SQLite-dialekt lokalt og i produksjon: en fil på disk under
// utvikling, en fjern libSQL-database (Turso) når DATABASE_URL er satt av
// Vercel. Ingen kodeforskjell mellom miljøene, bare hvilken URL som brukes.
const url = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "crm.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const globalForDb = globalThis as unknown as {
  __libsqlClient?: ReturnType<typeof createClient>;
};

const client =
  globalForDb.__libsqlClient ?? createClient(authToken ? { url, authToken } : { url });
globalForDb.__libsqlClient = client;

// Produksjon på Railway kjører også `file:` — SQLite-fila ligger på volumet
// montert på /app/data — så migreringen under kjører der ved hver oppstart.
// DATABASE_URL er kun for et eventuelt Vercel/Turso-oppsett; da kjøres
// `npm run db:migrate` manuelt i stedet (se scripts/migrate.ts), for å unngå
// at flere samtidige kalde starter kjører ALTER TABLE mot hverandre.
if (url.startsWith("file:")) {
  // MÅ settes først. `next build` kjører flere byggeprosesser parallelt som
  // alle åpner den samme ferske fila samtidig, og uten busy_timeout feiler
  // den første låsekrangelen momentant med SQLITE_BUSY i stedet for å vente.
  await client.execute("PRAGMA busy_timeout = 5000");

  // WAL i stedet for standard rollback-journal. Uten WAL tar hver skriving
  // en eksklusiv lås på hele databasefila, så alle som leser blokkeres mens
  // én person lagrer — merkbart på et Railway-volum, der hver fsync går til
  // en nettverksdisk. WAL lar lesere jobbe videre under skriving.
  //
  // Å BYTTE journalmodus krever en eksklusiv lås på hele fila. Når flere
  // byggeprosesser starter samtidig, kan en av dem tape kappløpet selv med
  // busy_timeout. Det er harmløst: modusen lagres i selve fila, så det
  // holder at én prosess vinner. Å la feilen boble opp ville derimot
  // velte hele bygget — som er nøyaktig det som skjedde.
  try {
    await client.execute("PRAGMA journal_mode = WAL");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("SQLITE_BUSY") && !message.includes("database is locked")) throw err;
  }

  // NORMAL fsync'er ved checkpoint i stedet for ved hver eneste commit.
  // Trygt sammen med WAL: en krasj kan miste de aller siste transaksjonene,
  // men databasen kan ikke bli korrupt. Dette er per tilkobling, ikke lagret
  // i fila, så det må settes ved hver oppstart. Krever ingen fillås.
  await client.execute("PRAGMA synchronous = NORMAL");

  await migrate(client);
}

export const db = drizzle(client, { schema });
export * from "./schema";
