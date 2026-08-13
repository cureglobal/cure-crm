import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  // Vises på slutten av e-poster sendt fra appen, f.eks. pristilbud til kunde.
  signature: text("signature"),
  // Design brukeren har valgt for grensesnittet sitt: 'lys' | 'dark' | 'elguide'.
  theme: text("theme").notNull().default("lys"),
  // Profilbilde som data-URL (samme mønster som referanseprosjektenes screenshot).
  avatarDataUrl: text("avatar_data_url"),
  // Satt når brukeren har fullført (eller lukket) onboarding-gjennomgangen.
  onboardingSeenAt: integer("onboarding_seen_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const emailAccounts = sqliteTable("email_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  email: text("email").notNull(),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull().default(993),
  imapUser: text("imap_user").notNull(),
  passwordEnc: text("password_enc").notNull(),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Et selskap (lead). Kan ha flere deals over tid.
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  domain: text("domain"),
  website: text("website"),
  logoUrl: text("logo_url"),
  // Felter hentet fra Brønnøysundregistrene (data.brreg.no), unntatt telefon
  // som ikke finnes i deres API og derfor fylles inn manuelt.
  // `name` er kallenavnet vi bruker internt (f.eks. «AdO Arena»), `orgName` er
  // det offisielle navnet fra Enhetsregisteret («AdO Arena Drift AS»).
  orgName: text("org_name"),
  orgNumber: text("org_number"),
  // Satt når orgnummeret er bekreftet — enten manuelt eller med sikker match.
  brregVerified: integer("brreg_verified", { mode: "boolean" }).notNull().default(false),
  ownerId: integer("owner_id"),
  phone: text("phone"),
  address: text("address"),
  postalCode: text("postal_code"),
  city: text("city"),
  employees: integer("employees"),
  industry: text("industry"),
  industryCode: text("industry_code"),
  ceoName: text("ceo_name"),
  revenue: integer("revenue"),
  profit: integer("profit"),
  fiscalYear: text("fiscal_year"),
  brregSyncedAt: integer("brreg_synced_at", { mode: "timestamp_ms" }),
  primaryContactId: integer("primary_contact_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fasene i pipelinen — fritt redigerbare av admin (navn, farge, rekkefølge).
// `deals.stage` lagrer denne radens `id` (som tekst, se kommentar der).
export const stages = sqliteTable("stages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  color: text("color").notNull().default("#8e8e93"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Styrer konfetti/vunnet-/tapt-logikk som før var hardkodet på stage-id.
  isWon: integer("is_won", { mode: "boolean" }).notNull().default(false),
  isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// En deal/salgsmulighet under et selskap, f.eks. «Nettsider» eller «Reklame».
export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // Fritekstkolonne av historiske grunner, men lagrer i praksis alltid
  // `String(stages.id)` — se stages-tabellen over.
  stage: text("stage").notNull().default("ny"),
  value: integer("value"),
  followUpAt: integer("follow_up_at", { mode: "timestamp_ms" }),
  comment: text("comment"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Med-eiere på en deal, i tillegg til hoved-eieren (deals.ownerId). Speilet
// etter company_people — selve UNIQUE-constrainten ligger i migrate.ts.
export const dealOwners = sqliteTable("deal_owners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// En person eksisterer på egne bein og kan knyttes til flere selskaper.
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Koblingen person ↔ selskap, med rolle i det aktuelle selskapet.
export const companyPeople = sqliteTable("company_people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  personId: integer("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  role: text("role"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const emailMessages = sqliteTable("email_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // 'in' | 'out'
  subject: text("subject"),
  fromAddr: text("from_addr"),
  toAddr: text("to_addr"),
  snippet: text("snippet"),
  bodyText: text("body_text"),
  messageId: text("message_id"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Tilgang til e-postdialog per selskap: eier av e-postkontoen godkjenner.
export const emailAccessGrants = sqliteTable("email_access_grants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => users.id),
  granteeUserId: integer("grantee_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("requested"), // 'requested' | 'granted' | 'denied'
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
});

// Varelinjer på en deal: fase (f.eks. design, utvikling), timer × timepris.
export const dealLines = sqliteTable("deal_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  hours: real("hours").notNull().default(0),
  rate: integer("rate").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Registrert kontakt med et selskap — møte, telefon eller e-post. Brukes til
// «Sist kontakt» sammen med logget e-post fra IMAP-synken.
export const contactEvents = sqliteTable("contact_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  kind: text("kind").notNull(), // 'moete' | 'telefon' | 'epost' | 'annet'
  note: text("note"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Referanseprosjekt for prisverktøyet: et kjent, tidligere prosjekt man kan
// sammenligne et nytt estimat mot. `phaseHours` er en JSON-blob
// ({[faseNøkkel]: {estimert, faktisk}}) — egen tabell per fase er unødvendig
// siden dette bare leses i sin helhet på prisverktøy-siden, aldri filtreres
// i SQL.
export const referenceProjects = sqliteTable("reference_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url"),
  notes: text("notes"),
  screenshot: text("screenshot"), // data-URL (base64), valgfritt
  phaseHours: text("phase_hours"), // JSON: Record<PhaseKey, {estimert?, faktisk?}>
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(), // 'note' | 'stage' | 'created' | 'followup' | 'contact'
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Person = typeof people.$inferSelect;
export type CompanyPerson = typeof companyPeople.$inferSelect;
export type DealOwner = typeof dealOwners.$inferSelect;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailAccessGrant = typeof emailAccessGrants.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type DealLine = typeof dealLines.$inferSelect;
export type ContactEvent = typeof contactEvents.$inferSelect;
export type ReferenceProject = typeof referenceProjects.$inferSelect;
