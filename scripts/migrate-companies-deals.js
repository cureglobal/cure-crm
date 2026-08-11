// Engangsmigrering: splitter gamle `leads` i `companies` + `deals`.
// Kjøres med: node scripts/migrate-companies-deals.js
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "..", "data", "crm.db"));
db.pragma("foreign_keys = OFF");

const hasLeads = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'")
  .get();
if (!hasLeads) {
  console.log("Ingen gammel leads-tabell — ingenting å migrere.");
  process.exit(0);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT,
    website TEXT,
    logo_url TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deals (
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
  );
`);

const migrate = db.transaction(() => {
  db.exec(`
    INSERT INTO companies (id, name, domain, website, logo_url, created_at)
      SELECT id, company_name, domain, website, logo_url, created_at FROM leads;

    INSERT INTO deals (id, company_id, title, stage, value, follow_up_at, comment, owner_id, created_at, updated_at)
      SELECT id, id, 'Deal', stage, value, follow_up_at, NULL, owner_id, created_at, updated_at FROM leads;

    -- contacts: lead_id -> company_id
    CREATE TABLE contacts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO contacts_new (id, company_id, name, email, phone, role, created_at)
      SELECT id, lead_id, name, email, phone, role, created_at FROM contacts;
    DROP TABLE contacts;
    ALTER TABLE contacts_new RENAME TO contacts;

    -- email_messages: lead_id -> company_id
    CREATE TABLE email_messages_new (
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
      UNIQUE(account_id, message_id)
    );
    INSERT INTO email_messages_new (id, account_id, company_id, direction, subject, from_addr, to_addr, snippet, body_text, message_id, sent_at, created_at)
      SELECT id, account_id, lead_id, direction, subject, from_addr, to_addr, snippet, body_text, message_id, sent_at, created_at FROM email_messages;
    DROP TABLE email_messages;
    ALTER TABLE email_messages_new RENAME TO email_messages;

    -- email_access_grants: lead_id -> company_id
    CREATE TABLE email_access_grants_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      grantee_user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'requested',
      created_at INTEGER NOT NULL,
      responded_at INTEGER,
      UNIQUE(company_id, owner_user_id, grantee_user_id)
    );
    INSERT INTO email_access_grants_new (id, company_id, owner_user_id, grantee_user_id, status, created_at, responded_at)
      SELECT id, lead_id, owner_user_id, grantee_user_id, status, created_at, responded_at FROM email_access_grants;
    DROP TABLE email_access_grants;
    ALTER TABLE email_access_grants_new RENAME TO email_access_grants;

    -- deal_lines: lead_id -> deal_id
    CREATE TABLE deal_lines_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      rate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    INSERT INTO deal_lines_new (id, deal_id, title, hours, rate, created_at)
      SELECT id, lead_id, title, hours, rate, created_at FROM deal_lines;
    DROP TABLE deal_lines;
    ALTER TABLE deal_lines_new RENAME TO deal_lines;

    -- activities: lead_id -> deal_id
    CREATE TABLE activities_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO activities_new (id, deal_id, user_id, type, content, created_at)
      SELECT id, lead_id, user_id, type, content, created_at FROM activities;
    DROP TABLE activities;
    ALTER TABLE activities_new RENAME TO activities;

    DROP TABLE leads;
  `);
});

migrate();
db.pragma("foreign_keys = ON");

const companies = db.prepare("SELECT COUNT(*) AS n FROM companies").get().n;
const deals = db.prepare("SELECT COUNT(*) AS n FROM deals").get().n;
console.log(`Migrering ferdig: ${companies} selskaper, ${deals} deals.`);
