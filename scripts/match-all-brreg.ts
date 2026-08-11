// Engangsjobb: matcher alle ubekreftede selskaper mot Enhetsregisteret.
// Kjøres med: node --experimental-strip-types scripts/match-all-brreg.ts
import Database from "better-sqlite3";
import path from "path";
import { matchBrregCompany, fetchBrregCompany } from "../src/lib/brreg.ts";

const db = new Database(path.join(process.cwd(), "data", "crm.db"));
db.pragma("foreign_keys = ON");

interface Row {
  id: number;
  name: string;
  domain: string | null;
  brreg_verified: number;
}

const pending = db
  .prepare(
    "SELECT id, name, domain, brreg_verified FROM companies WHERE brreg_verified = 0 ORDER BY name"
  )
  .all() as Row[];

const update = db.prepare(`UPDATE companies SET
  org_number = ?, org_name = ?, brreg_verified = 1, address = ?, postal_code = ?,
  city = ?, employees = ?, industry = ?, industry_code = ?, ceo_name = ?,
  revenue = ?, profit = ?, fiscal_year = ?, brreg_synced_at = ?
  WHERE id = ?`);

let matched = 0;
const unresolved: string[] = [];

console.log(`Sjekker ${pending.length} selskaper mot Enhetsregisteret …\n`);

for (const company of pending) {
  const result = await matchBrregCompany(company.name, company.domain);

  if (!result.confident || !result.best) {
    unresolved.push(`${company.name} — ${result.reason}`);
    console.log(`??  ${company.name.padEnd(38)} ${result.reason}`);
    continue;
  }

  const data = await fetchBrregCompany(result.best.orgNumber);
  if (!data) {
    unresolved.push(`${company.name} — kunne ikke hente detaljer`);
    continue;
  }

  update.run(
    data.orgNumber,
    data.name,
    data.address,
    data.postalCode,
    data.city,
    data.employees,
    data.industry,
    data.industryCode,
    data.ceoName,
    data.revenue,
    data.profit,
    data.fiscalYear,
    Date.now(),
    company.id
  );
  matched++;
  console.log(`OK  ${company.name.padEnd(38)} -> ${data.name} (${data.orgNumber})`);
}

console.log(`\nFerdig: ${matched} bekreftet, ${unresolved.length} må gjøres manuelt.`);
if (unresolved.length > 0) {
  console.log("\nMå bekreftes manuelt:");
  for (const u of unresolved) console.log(`  · ${u}`);
}
