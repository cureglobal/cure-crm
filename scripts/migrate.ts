// Kjører skjemaoppsettet mot en database via miljøvariabler — lokal fil eller
// en ekte Turso-database. Kjør denne mot produksjonsmiljøet FØR første
// deploy, og på nytt hver gang skjemaet endres (nye felt/tabeller).
//
// Lokalt (bruker data/crm.db, samme som appen ellers):
//   node --experimental-strip-types scripts/migrate.ts
//
// Mot Turso (hent env-variablene fra Vercel eller Turso-dashbordet først):
//   DATABASE_URL="libsql://ditt-navn.turso.io" DATABASE_AUTH_TOKEN="…" \
//     node --experimental-strip-types scripts/migrate.ts
import { createClient } from "@libsql/client";
import path from "path";
import { migrate } from "../src/lib/db/migrate.ts";

const url = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "crm.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

console.log(`Migrerer mot: ${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//***@")}`);

const client = createClient(authToken ? { url, authToken } : { url });
await migrate(client);

console.log("Ferdig — skjemaet er oppdatert.");
