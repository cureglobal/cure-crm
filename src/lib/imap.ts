import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import {
  db,
  emailAccounts,
  emailMessages,
  people,
  companyPeople,
  type EmailAccount,
} from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { eq, isNotNull } from "drizzle-orm";

function addressesOf(obj: AddressObject | AddressObject[] | undefined): string[] {
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : [obj];
  return list.flatMap((a) => a.value.map((v) => (v.address ?? "").toLowerCase())).filter(Boolean);
}

export interface SyncResult {
  scanned: number;
  matched: number;
  error?: string;
  // Sann når vi stoppet før hele vinduet var gjennomgått (tidsgrense på
  // serverless-plattformer). Da rykker ikke `lastSyncAt` fram, så neste kjøring
  // fortsetter samme vindu — kjør synk på nytt for å ta resten.
  capped?: boolean;
}

// Øvre grense på meldinger per kjøring. Vercel sine funksjoner har en maks
// kjøretid (typisk 10–60 sek på gratis/Pro-nivå), og et konto med stor
// historikk kan ha langt flere treff enn det som får plass i ett kall.
const MAX_MESSAGES_PER_RUN = 250;

// Synker Sendt + Innboks og kobler meldinger til leads via kontaktenes e-postadresser.
export async function syncAccount(account: EmailAccount): Promise<SyncResult> {
  // En person kan tilhøre flere selskaper — da logges meldingen på alle.
  const contactRows = await db
    .select({ email: people.email, companyId: companyPeople.companyId })
    .from(people)
    .innerJoin(companyPeople, eq(companyPeople.personId, people.id))
    .where(isNotNull(people.email));

  const emailToCompanies = new Map<string, number[]>();
  for (const row of contactRows) {
    if (!row.email) continue;
    const key = row.email.toLowerCase();
    const list = emailToCompanies.get(key) ?? [];
    if (!list.includes(row.companyId)) list.push(row.companyId);
    emailToCompanies.set(key, list);
  }

  if (emailToCompanies.size === 0) {
    await db
      .update(emailAccounts)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(emailAccounts.id, account.id));
    return { scanned: 0, matched: 0 };
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: { user: account.imapUser, pass: decrypt(account.passwordEnc) },
    logger: false,
  });

  let scanned = 0;
  let matched = 0;
  let capped = false;

  try {
    await client.connect();

    const boxes = await client.list();
    const sentBox = boxes.find((b) => b.specialUse === "\\Sent")?.path;
    const targets: { path: string; direction: "in" | "out" }[] = [
      { path: "INBOX", direction: "in" },
    ];
    if (sentBox) targets.push({ path: sentBox, direction: "out" });

    // Første synk: 90 dager tilbake. Senere: litt overlapp for sikkerhets skyld.
    const since = account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    outer: for (const target of targets) {
      const lock = await client.getMailboxLock(target.path);
      try {
        const uids = await client.search({ since }, { uid: true });
        if (!uids || uids.length === 0) continue;
        // Eldste først, slik at gjentatte kjøringer på en stor bakgrunn gir
        // fremgang kronologisk i stedet for å hoppe rundt.
        uids.sort((a, b) => a - b);

        for await (const msg of client.fetch(
          uids,
          { uid: true, envelope: true },
          { uid: true }
        )) {
          if (scanned >= MAX_MESSAGES_PER_RUN) {
            capped = true;
            break outer;
          }
          scanned++;
          const env = msg.envelope;
          if (!env) continue;
          const participants = [
            ...(env.from ?? []),
            ...(env.to ?? []),
            ...(env.cc ?? []),
          ]
            .map((a) => (a.address ?? "").toLowerCase())
            .filter(Boolean);

          const companyIds = [
            ...new Set(participants.flatMap((p) => emailToCompanies.get(p) ?? [])),
          ];
          if (companyIds.length === 0) continue;

          const messageId = env.messageId ?? `uid-${target.path}-${msg.uid}`;
          const alreadyLogged = await db.query.emailMessages.findMany({
            where: (m, { and: andOp, eq: eqOp }) =>
              andOp(eqOp(m.accountId, account.id), eqOp(m.messageId, messageId)),
          });
          const missing = companyIds.filter(
            (id) => !alreadyLogged.some((m) => m.companyId === id)
          );
          if (missing.length === 0) continue;

          const full = await client.fetchOne(
            String(msg.uid),
            { uid: true, source: true },
            { uid: true }
          );
          let bodyText = "";
          let fromAddr = env.from?.[0]?.address ?? "";
          let toAddr = (env.to ?? []).map((a) => a.address).filter(Boolean).join(", ");
          if (full && full.source) {
            try {
              const parsed = await simpleParser(full.source);
              bodyText = (parsed.text ?? "").trim();
              fromAddr = addressesOf(parsed.from)[0] ?? fromAddr;
              toAddr = addressesOf(parsed.to).join(", ") || toAddr;
            } catch {
              // envelope-data holder
            }
          }

          await db.insert(emailMessages).values(
            missing.map((companyId) => ({
              accountId: account.id,
              companyId,
              direction: target.direction,
              subject: env.subject ?? "(uten emne)",
              fromAddr,
              toAddr,
              snippet: bodyText.replace(/\s+/g, " ").slice(0, 240),
              bodyText: bodyText.slice(0, 20000),
              messageId,
              sentAt: env.date ? new Date(env.date) : null,
            }))
          );
          matched++;
        }
      } finally {
        lock.release();
      }
    }

    await client.logout();
    await db
      .update(emailAccounts)
      .set({
        // Bare ferdig gjennomgått vindu flytter `lastSyncAt` fram — ellers
        // ville resten av bakgrunnen blitt hoppet over på neste kjøring.
        ...(capped ? {} : { lastSyncAt: new Date() }),
        lastError: null,
      })
      .where(eq(emailAccounts.id, account.id));
    return { scanned, matched, capped };
  } catch (err) {
    try {
      client.close();
    } catch {
      // allerede lukket
    }
    const message = err instanceof Error ? err.message : "Ukjent feil";
    await db
      .update(emailAccounts)
      .set({ lastError: message })
      .where(eq(emailAccounts.id, account.id));
    return { scanned, matched, error: message };
  }
}
