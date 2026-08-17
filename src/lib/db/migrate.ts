import type { Client } from "@libsql/client";

// Skjemaoppsett delt mellom appens automatiske lokale bootstrap og
// scripts/migrate.ts, som kjøres manuelt mot en ekte database (Turso) før
// første deploy. CREATE TABLE/INDEX er idempotente; addMissingColumns
// håndterer felt som er lagt til etter at en database allerede fantes.
const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    theme TEXT NOT NULL DEFAULT 'lys',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_user TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    last_sync_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    refresh_token_enc TEXT NOT NULL,
    last_sync_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT,
    website TEXT,
    logo_url TEXT,
    org_name TEXT,
    org_number TEXT,
    brreg_verified INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER,
    phone TEXT,
    address TEXT,
    postal_code TEXT,
    city TEXT,
    employees INTEGER,
    industry TEXT,
    industry_code TEXT,
    ceo_name TEXT,
    revenue INTEGER,
    profit INTEGER,
    fiscal_year TEXT,
    brreg_synced_at INTEGER,
    primary_contact_id INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#8e8e93',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_won INTEGER NOT NULL DEFAULT 0,
    is_lost INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'ny',
    value INTEGER,
    follow_up_at INTEGER,
    comment TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS company_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(company_id, person_id)
  )`,
  `CREATE TABLE IF NOT EXISTS deal_owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    UNIQUE(deal_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS email_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    subject TEXT,
    from_addr TEXT,
    to_addr TEXT,
    snippet TEXT,
    body_text TEXT,
    message_id TEXT,
    sent_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(account_id, message_id, company_id)
  )`,
  `CREATE TABLE IF NOT EXISTS email_access_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    grantee_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'requested',
    created_at INTEGER NOT NULL,
    responded_at INTEGER,
    UNIQUE(company_id, owner_user_id, grantee_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS deal_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    hours REAL NOT NULL DEFAULT 0,
    rate INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL,
    note TEXT,
    occurred_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reference_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    notes TEXT,
    screenshot TEXT,
    phase_hours TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS business_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lost_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
];

const INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(org_number)",
  "CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage)",
  "CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_company_people_company ON company_people(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_company_people_person ON company_people(person_id)",
  "CREATE INDEX IF NOT EXISTS idx_people_email ON people(email)",
  "CREATE INDEX IF NOT EXISTS idx_messages_company ON email_messages(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_deal_lines_deal ON deal_lines(deal_id)",
  "CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id)",
  "CREATE INDEX IF NOT EXISTS idx_contact_events_company ON contact_events(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_deal_owners_deal ON deal_owners(deal_id)",
  "CREATE INDEX IF NOT EXISTS idx_deal_owners_user ON deal_owners(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_stages_sort_order ON stages(sort_order)",
  "CREATE INDEX IF NOT EXISTS idx_companies_business_unit ON companies(business_unit_id)",
  "CREATE INDEX IF NOT EXISTS idx_users_business_unit ON users(business_unit_id)",
  "CREATE INDEX IF NOT EXISTS idx_calendar_accounts_user ON calendar_accounts(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_lost_reasons_sort_order ON lost_reasons(sort_order)",
  "CREATE INDEX IF NOT EXISTS idx_deals_lost_reason ON deals(lost_reason_id)",
];

// Kolonner lagt til etter at tabellene først ble opprettet. libSQL/SQLite har
// ingen "ADD COLUMN IF NOT EXISTS", så vi sjekker mot table_info per tabell.
const EXPECTED_COLUMNS: Record<string, Record<string, string>> = {
  companies: {
    org_name: "TEXT",
    brreg_verified: "INTEGER NOT NULL DEFAULT 0",
    owner_id: "INTEGER",
    org_number: "TEXT",
    phone: "TEXT",
    address: "TEXT",
    postal_code: "TEXT",
    city: "TEXT",
    employees: "INTEGER",
    industry: "TEXT",
    industry_code: "TEXT",
    ceo_name: "TEXT",
    revenue: "INTEGER",
    profit: "INTEGER",
    fiscal_year: "TEXT",
    brreg_synced_at: "INTEGER",
    primary_contact_id: "INTEGER",
    business_unit_id: "INTEGER",
  },
  people: { notes: "TEXT" },
  deals: { comment: "TEXT", lost_reason_id: "INTEGER", closed_at: "INTEGER" },
  users: {
    signature: "TEXT",
    theme: "TEXT NOT NULL DEFAULT 'lys'",
    avatar_data_url: "TEXT",
    onboarding_seen_at: "INTEGER",
    business_unit_id: "INTEGER",
  },
};

// De 12 fasene brukeren har definert, i den rekkefølgen de ble oppgitt —
// rekkefølgen kan endres fritt fra Innstillinger etterpå.
const DEFAULT_STAGES: { label: string; color: string; isWon?: boolean; isLost?: boolean }[] = [
  { label: "Tapt", color: "#ff453a", isLost: true },
  { label: "Vunnet", color: "#30d158", isWon: true },
  { label: "Anbud", color: "#ff9f0a" },
  { label: "Har sendt kontrakt til signering", color: "#5e5ce6" },
  { label: "Send kontrakt", color: "#bf5af2" },
  { label: "Aktiv oppfølging", color: "#64d2ff" },
  { label: "Tilbud sendt", color: "#ff9f0a" },
  { label: "Har møtt, skal sende tilbud", color: "#5ac8fa" },
  { label: "Møte avtalt", color: "#0071e3" },
  { label: "Kontaktfase", color: "#0071e3" },
  { label: "Prospect", color: "#8e8e93" },
  { label: "Mulighet", color: "#8e8e93" },
];

// Gamle, hardkodede fase-nøkler fra før faser ble redigerbare, mappet til
// den nye fasen med nærmest tilsvarende betydning — kjøres kun for deals som
// fortsatt har en av disse nøklene (se seedStagesAndMigrateLegacy under).
const LEGACY_STAGE_MAP: Record<string, string> = {
  ny: "Prospect",
  kontaktet: "Kontaktfase",
  dialog: "Aktiv oppfølging",
  tilbud: "Tilbud sendt",
  vunnet: "Vunnet",
  tapt: "Tapt",
};

// Kjøres én gang: seeder standardfasene og migrerer eksisterende deals fra de
// gamle hardkodede nøklene til de nye fase-id-ene. Idempotent — hopper over
// seedingen (og dermed også migreringen) hvis stages-tabellen ikke er tom.
async function seedStagesAndMigrateLegacy(client: Client) {
  const existing = await client.execute("SELECT COUNT(*) as c FROM stages");
  if (Number(existing.rows[0].c) > 0) return;

  const idByLabel: Record<string, number> = {};
  for (let i = 0; i < DEFAULT_STAGES.length; i++) {
    const s = DEFAULT_STAGES[i];
    const res = await client.execute({
      sql: "INSERT INTO stages (label, color, sort_order, is_won, is_lost, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [s.label, s.color, i, s.isWon ? 1 : 0, s.isLost ? 1 : 0, Date.now()],
    });
    idByLabel[s.label] = Number(res.lastInsertRowid);
  }

  for (const [legacyKey, newLabel] of Object.entries(LEGACY_STAGE_MAP)) {
    const newId = idByLabel[newLabel];
    if (!newId) continue;
    await client.execute({
      sql: "UPDATE deals SET stage = ? WHERE stage = ?",
      args: [String(newId), legacyKey],
    });
  }
}

// Våre tre juridiske enheter ved innføringen av dette. Fritt redigerbart
// etterpå fra Innstillinger — denne listen brukes kun til førstegangs-seeding.
const DEFAULT_BUSINESS_UNITS = ["Cure AS", "Cure Christiania AS", "Cure Placebo AS"];

const DEFAULT_LOST_REASONS = [
  "Tapt til konkurrent",
  "Ingen respons",
  "Prosjekter er kansellert",
  "Ikke aktuelt for Cure",
  "For dyrt",
  "Vi kansellerer",
  "Korrupt anbud",
];

// Kjøres én gang: seeder de tre selskapene og gjetter en fornuftig
// standardkobling ut fra det brukeren oppga da funksjonen ble innført
// (Anita og TK i Cure Christiania AS, resten i Cure AS; FBN Norsk
// Familieeierskap i Cure Christiania AS). Idempotent — hopper over alt
// dette hvis business_units-tabellen ikke er tom, akkurat som fasene.
async function seedBusinessUnits(client: Client) {
  const existing = await client.execute("SELECT COUNT(*) as c FROM business_units");
  if (Number(existing.rows[0].c) > 0) return;

  const idByName: Record<string, number> = {};
  for (let i = 0; i < DEFAULT_BUSINESS_UNITS.length; i++) {
    const name = DEFAULT_BUSINESS_UNITS[i];
    const res = await client.execute({
      sql: "INSERT INTO business_units (name, sort_order, created_at) VALUES (?, ?, ?)",
      args: [name, i, Date.now()],
    });
    idByName[name] = Number(res.lastInsertRowid);
  }

  const cureId = idByName["Cure AS"];
  const christianiaId = idByName["Cure Christiania AS"];

  await client.execute({
    sql: "UPDATE users SET business_unit_id = ? WHERE business_unit_id IS NULL AND (name LIKE 'Anita%' OR name LIKE 'TK%' OR name LIKE '% TK')",
    args: [christianiaId],
  });
  await client.execute({
    sql: "UPDATE users SET business_unit_id = ? WHERE business_unit_id IS NULL",
    args: [cureId],
  });
  await client.execute({
    sql: "UPDATE companies SET business_unit_id = ? WHERE business_unit_id IS NULL AND name = 'FBN Norsk Familieeierskap'",
    args: [christianiaId],
  });
}

// Kjøres én gang: seeder standard tapt-grunner (fra det opprinnelige
// dropdown-utvalget). Idempotent, akkurat som fasene og business units.
async function seedLostReasons(client: Client) {
  const existing = await client.execute("SELECT COUNT(*) as c FROM lost_reasons");
  if (Number(existing.rows[0].c) > 0) return;

  for (let i = 0; i < DEFAULT_LOST_REASONS.length; i++) {
    await client.execute({
      sql: "INSERT INTO lost_reasons (label, sort_order, created_at) VALUES (?, ?, ?)",
      args: [DEFAULT_LOST_REASONS[i], i, Date.now()],
    });
  }
}

async function addMissingColumns(client: Client) {
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const exists = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      args: [table],
    });
    if (exists.rows.length === 0) continue;

    const info = await client.execute(`PRAGMA table_info(${table})`);
    const present = new Set(info.rows.map((row) => String(row.name)));

    for (const [column, type] of Object.entries(columns)) {
      if (!present.has(column)) {
        try {
          await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        } catch (err) {
          // ALTER TABLE har ingen "IF NOT EXISTS". Flere byggeprosesser kan
          // begge se kolonnen som fraværende og forsøke å legge den til
          // samtidig — vinnertapernes feil er harmløs og skal ignoreres.
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("duplicate column name")) throw err;
        }
      }
    }
  }
}

export async function migrate(client: Client) {
  // next build kjører flere byggeprosesser parallelt, som hver importerer
  // denne modulen og migrerer samtidig mot samme lokale fil. Uten
  // busy_timeout feiler samtidige skrivinger momentant med SQLITE_BUSY i
  // stedet for å vente på hverandre.
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA foreign_keys = ON");
  for (const stmt of CREATE_STATEMENTS) await client.execute(stmt);
  // Må kjøre før indeksene, som kan peke på kolonner lagt til her.
  await addMissingColumns(client);
  for (const stmt of INDEX_STATEMENTS) await client.execute(stmt);
  // Må kjøre etter at både stages- og deals-tabellen finnes.
  await seedStagesAndMigrateLegacy(client);
  // Må kjøre etter at business_units-tabellen og users/companies-kolonnene finnes.
  await seedBusinessUnits(client);
  await seedLostReasons(client);
}
