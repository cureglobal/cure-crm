// Manuell kjøring av bildeflyttingen. Den samme jobben kjører automatisk
// ved oppstart (se src/instrumentation.ts) — dette skriptet er for å kjøre
// den mot en lokal kopi, eller for å se resultatet skrevet ut.
//
//   npm run migrate:images
//
// Trygg å kjøre om igjen: rader som alt er flyttet hoppes over. Databasen
// velges med DATABASE_URL, ellers data/crm.db.
import { migrateImagesToObjectStorage } from "../src/lib/migrateImages.server.ts";
import { isObjectStorageEnabled } from "../src/lib/objectStorage.ts";

if (!isObjectStorageEnabled()) {
  console.error(
    "R2 er ikke konfigurert. Sett R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY og R2_ENDPOINT."
  );
  process.exit(1);
}

const r = await migrateImagesToObjectStorage();
console.log(
  `Flyttet ${r.moved}, hoppet over ${r.skipped}, feilet ${r.failed}. ` +
    `${Math.round(r.bytesFreed / 1024)} kB ut av databasen.`
);
if (r.moved > 0) {
  console.log("Kjør VACUUM for å faktisk krympe fila.");
}
if (r.failed > 0) process.exitCode = 1;
