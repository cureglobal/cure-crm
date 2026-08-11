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

// Skjemaet opprettes automatisk bare mot den lokale fila. Mot en ekte
// database (produksjon) kjøres `npm run db:migrate` manuelt én gang før
// første deploy — se scripts/migrate.ts — for å unngå at flere samtidige
// kalde starter kjører ALTER TABLE mot hverandre.
if (url.startsWith("file:")) {
  await migrate(client);
}

export const db = drizzle(client, { schema });
export * from "./schema";
