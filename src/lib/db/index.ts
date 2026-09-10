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
  // WAL i stedet for standard rollback-journal. Uten WAL tar hver skriving
  // en eksklusiv lås på hele databasefila, så alle som leser blokkeres mens
  // én person lagrer — merkbart på et Railway-volum, der hver fsync går til
  // en nettverksdisk. WAL lar lesere jobbe videre under skriving.
  // Innstillingen lagres i selve fila og overlever restart, men settes hver
  // gang siden en fersk database (lokalt, i bygget) starter i "delete".
  await client.execute("PRAGMA journal_mode = WAL");
  // NORMAL fsync'er ved checkpoint i stedet for ved hver eneste commit.
  // Trygt sammen med WAL: en krasj kan miste de aller siste transaksjonene,
  // men databasen kan ikke bli korrupt. Dette er per tilkobling, ikke lagret
  // i fila, så det må settes ved hver oppstart.
  await client.execute("PRAGMA synchronous = NORMAL");
  await migrate(client);
}

export const db = drizzle(client, { schema });
export * from "./schema";
