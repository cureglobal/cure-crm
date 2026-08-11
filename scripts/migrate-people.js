// Engangsmigrering: contacts (én per selskap) → people + company_people (mange-til-mange).
// Personer med samme e-post slås sammen til én person knyttet til flere selskaper.
// Kjøres med: node scripts/migrate-people.js
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "..", "data", "crm.db"));
db.pragma("foreign_keys = OFF");

const hasContacts = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'")
  .get();

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS company_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(company_id, person_id)
  );
`);

const migrate = db.transaction(() => {
  if (hasContacts) {
    const contacts = db.prepare("SELECT * FROM contacts ORDER BY id").all();
    const insertPerson = db.prepare(
      "INSERT INTO people (name, email, phone, created_at) VALUES (?, ?, ?, ?)"
    );
    const insertLink = db.prepare(
      "INSERT OR IGNORE INTO company_people (company_id, person_id, role, created_at) VALUES (?, ?, ?, ?)"
    );
    const updatePhone = db.prepare(
      "UPDATE people SET phone = COALESCE(phone, ?) WHERE id = ?"
    );

    const byEmail = new Map();
    for (const c of contacts) {
      const email = (c.email ?? "").trim().toLowerCase() || null;
      let personId = email ? byEmail.get(email) : undefined;
      if (!personId) {
        personId = Number(
          insertPerson.run(c.name, email, c.phone ?? null, c.created_at).lastInsertRowid
        );
        if (email) byEmail.set(email, personId);
      } else if (c.phone) {
        updatePhone.run(c.phone, personId);
      }
      insertLink.run(c.company_id, personId, c.role ?? null, c.created_at);
    }
    db.exec("DROP TABLE contacts;");
  }

  // Unik-nøkkel på e-post må inkludere company_id, slik at samme melding kan
  // logges på flere selskaper når en person er knyttet til mer enn ett.
  const emailTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_messages'")
    .get();
  if (emailTable && !emailTable.sql.includes("message_id, company_id")) {
    db.exec(`
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
        UNIQUE(account_id, message_id, company_id)
      );
      INSERT INTO email_messages_new
        SELECT id, account_id, company_id, direction, subject, from_addr, to_addr,
               snippet, body_text, message_id, sent_at, created_at
        FROM email_messages;
      DROP TABLE email_messages;
      ALTER TABLE email_messages_new RENAME TO email_messages;
      CREATE INDEX IF NOT EXISTS idx_messages_company ON email_messages(company_id);
    `);
  }
});

migrate();
db.pragma("foreign_keys = ON");

const people = db.prepare("SELECT COUNT(*) AS n FROM people").get().n;
const links = db.prepare("SELECT COUNT(*) AS n FROM company_people").get().n;
console.log(`Migrering ferdig: ${people} personer, ${links} selskapskoblinger.`);
