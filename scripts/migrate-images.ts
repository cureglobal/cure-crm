// Engangsflytting av bilder fra databasen til R2.
//
// Profilbilder, firmalogoer og skjermbilder av referanseprosjekter lå som
// base64 data-URL rett i radene. Sju profilbilder utgjorde 3,8 MB av en
// database på 4,9 MB, og fulgte med i hver spørring som ikke eksplisitt
// utelot kolonnen. Etter denne kjøringen ligger filene i R2 og raden har
// bare en nøkkel.
//
//   railway ssh --service cure-crm
//   node --experimental-strip-types scripts/migrate-images.ts
//
// Trygg å kjøre flere ganger: rader som allerede er flyttet hoppes over.
// Databasen skrives først når opplastingen har gått bra, så en avbrutt
// kjøring gir ingen rader som peker på filer som ikke finnes.
import { createClient } from "@libsql/client";
import { randomUUID } from "crypto";
import path from "path";
import {
  putObject,
  decodeDataUrl,
  extensionFor,
  isObjectStorageEnabled,
} from "../src/lib/objectStorage.ts";
import { migrate } from "../src/lib/db/migrate.ts";

const url = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "crm.db")}`;
const client = createClient(
  process.env.DATABASE_AUTH_TOKEN
    ? { url, authToken: process.env.DATABASE_AUTH_TOKEN }
    : { url }
);

// Kolonnene for objektnøklene lages av den vanlige skjemamigreringen. Kjøres
// dette skriptet mot en database som ikke har vært oppe med ny kode ennå,
// finnes de ikke — så vi sørger for dem her i stedet for å feile.
await migrate(client);

if (!isObjectStorageEnabled()) {
  console.error("R2 er ikke konfigurert. Sett R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY og R2_ENDPOINT.");
  process.exit(1);
}

interface Job {
  table: string;
  idColumn: string;
  dataColumn: string;
  keyColumn: string;
  // Kolonnen som skal peke på den nye URL-en. Profilbilder har ingen — de
  // serveres av /api/avatar/[id], som slår opp nøkkelen selv.
  urlColumn: string | null;
  prefix: (id: number) => string;
}

const JOBS: Job[] = [
  {
    table: "users",
    idColumn: "id",
    dataColumn: "avatar_data_url",
    keyColumn: "avatar_object_key",
    urlColumn: null,
    prefix: (id) => `avatars/${id}`,
  },
  {
    table: "companies",
    idColumn: "id",
    dataColumn: "logo_url",
    keyColumn: "logo_object_key",
    urlColumn: "logo_url",
    prefix: (id) => `logos/${id}`,
  },
  {
    table: "reference_projects",
    idColumn: "id",
    dataColumn: "screenshot",
    keyColumn: "screenshot_object_key",
    urlColumn: "screenshot",
    prefix: () => "reference",
  },
];

let moved = 0;
let skipped = 0;
let failed = 0;
let bytesFreed = 0;

for (const job of JOBS) {
  // Kun rader som faktisk har base64 i seg. Firmalogoer er som regel vanlige
  // favicon-URL-er og skal stå urørt — derfor LIKE 'data:%', ikke NOT NULL.
  const rows = await client.execute({
    sql: `SELECT ${job.idColumn} AS id, ${job.dataColumn} AS data
          FROM ${job.table}
          WHERE ${job.dataColumn} LIKE 'data:%' AND ${job.keyColumn} IS NULL`,
    args: [],
  });

  if (rows.rows.length === 0) {
    console.log(`${job.table}: ingenting å flytte`);
    continue;
  }

  for (const row of rows.rows) {
    const id = Number(row.id);
    const dataUrl = String(row.data);
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      console.warn(`  ${job.table}#${id}: ikke en gyldig data-URL, hoppet over`);
      skipped++;
      continue;
    }

    const key = `${job.prefix(id)}/${randomUUID()}.${extensionFor(decoded.contentType)}`;
    try {
      // Opplasting FØR databaseskriving: feiler den, står raden urørt og
      // kjøringen kan gjentas.
      await putObject(key, decoded.body, decoded.contentType);
    } catch (err) {
      console.error(`  ${job.table}#${id}: opplasting feilet — ${(err as Error).message}`);
      failed++;
      continue;
    }

    const sets = [`${job.keyColumn} = ?`];
    const args: unknown[] = [key];
    if (job.urlColumn) {
      sets.push(`${job.urlColumn} = ?`);
      args.push(`/api/media/${key}`);
    } else {
      // Profilbilder: base64-en skal bort, nøkkelen er nok.
      sets.push(`${job.dataColumn} = NULL`);
    }
    args.push(id);

    await client.execute({
      sql: `UPDATE ${job.table} SET ${sets.join(", ")} WHERE ${job.idColumn} = ?`,
      args: args as never[],
    });

    bytesFreed += dataUrl.length;
    moved++;
    console.log(`  ${job.table}#${id}: ${Math.round(dataUrl.length / 1024)} kB → ${key}`);
  }
}

console.log(
  `\nFlyttet ${moved}, hoppet over ${skipped}, feilet ${failed}. ` +
    `${Math.round(bytesFreed / 1024)} kB ut av databasen.`
);
if (moved > 0) {
  console.log("Kjør VACUUM for å faktisk krympe fila:");
  console.log('  node -e "require(\'@libsql/client\').createClient({url:process.env.DATABASE_URL||\'file:data/crm.db\'}).execute(\'VACUUM\')"');
}
if (failed > 0) process.exitCode = 1;
