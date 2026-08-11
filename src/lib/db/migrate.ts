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
  },
  people: { notes: "TEXT" },
  deals: { comment: "TEXT" },
};

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
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
  }
}

export async function migrate(client: Client) {
  await client.execute("PRAGMA foreign_keys = ON");
  for (const stmt of CREATE_STATEMENTS) await client.execute(stmt);
  // Må kjøre før indeksene, som kan peke på kolonner lagt til her.
  await addMissingColumns(client);
  for (const stmt of INDEX_STATEMENTS) await client.execute(stmt);
}
