"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  people,
  companyPeople,
  contactEvents,
  calendarAccounts } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import {
  isGoogleCalendarConfigured,
  buildGoogleAuthUrl,
  refreshAccessToken,
  fetchCalendarEvents,
  signCalendarState } from "@/lib/googleCalendar";
import {
  revalidateDealViews } from "./_shared";

// ---------- Google Kalender ----------

export async function startGoogleCalendarAuth() {
  const me = await requireUser();
  if (!isGoogleCalendarConfigured()) {
    redirect("/settings?error=kalender-ikke-satt-opp");
  }
  const state = await signCalendarState(me.id);
  redirect(buildGoogleAuthUrl(state));
}

export async function disconnectGoogleCalendar() {
  const me = await requireUser();
  await db.delete(calendarAccounts).where(eq(calendarAccounts.userId, me.id));
  revalidatePath("/settings");
}

// Henter møter i et vindu (30 dager tilbake, 14 dager frem) fra den
// tilkoblede Google-kalenderen, og logger et møte som kontakthistorikk
// (contact_events, kind="moete") på hver kunde der BÅDE minst én av oss OG
// minst én person knyttet til kunden var blant deltakerne på samme hendelse.
export async function syncGoogleCalendarNow(): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const account = await db.query.calendarAccounts.findFirst({
    where: eq(calendarAccounts.userId, me.id),
  });
  if (!account) return { ok: false, message: "Ingen kalender er koblet til." };

  try {
    const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));

    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const events = await fetchCalendarEvents(accessToken, timeMin, timeMax);

    const allUsers = await db.query.users.findMany();
    const ourEmailToUser = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));

    const peopleWithCompany = await db
      .select({
        personEmail: people.email,
        companyId: companyPeople.companyId,
      })
      .from(companyPeople)
      .innerJoin(people, eq(companyPeople.personId, people.id));

    const emailToCompanyIds = new Map<string, Set<number>>();
    for (const row of peopleWithCompany) {
      if (!row.personEmail) continue;
      const email = row.personEmail.toLowerCase();
      const set = emailToCompanyIds.get(email) ?? new Set<number>();
      set.add(row.companyId);
      emailToCompanyIds.set(email, set);
    }

    const candidates: { companyId: number; occurredAt: Date; note: string | null }[] = [];
    for (const event of events) {
      if (!event.startedAt) continue;

      const hasOurAttendee = event.attendeeEmails.some((email) => ourEmailToUser.has(email));
      if (!hasOurAttendee) continue;

      const matchedCompanyIds = new Set<number>();
      for (const email of event.attendeeEmails) {
        const companyIds = emailToCompanyIds.get(email);
        if (companyIds) for (const id of companyIds) matchedCompanyIds.add(id);
      }
      if (matchedCompanyIds.size === 0) continue;

      for (const companyId of matchedCompanyIds) {
        candidates.push({ companyId, occurredAt: event.startedAt, note: event.summary });
      }
    }

    // Unngår duplikater ved gjentatt synk av samme møte — henter eksisterende
    // møter i HELE vinduet i én spørring i stedet for én per kandidat.
    let logged = 0;
    if (candidates.length > 0) {
      const existing = await db
        .select({ companyId: contactEvents.companyId, occurredAt: contactEvents.occurredAt })
        .from(contactEvents)
        .where(
          and(
            eq(contactEvents.kind, "moete"),
            gte(contactEvents.occurredAt, timeMin),
            lte(contactEvents.occurredAt, timeMax)
          )
        );
      const existingKeys = new Set(existing.map((e) => `${e.companyId}:${e.occurredAt.getTime()}`));
      const toInsert = candidates.filter(
        (c) => !existingKeys.has(`${c.companyId}:${c.occurredAt.getTime()}`)
      );
      if (toInsert.length > 0) {
        await db.insert(contactEvents).values(
          toInsert.map((c) => ({
            companyId: c.companyId,
            userId: me.id,
            kind: "moete",
            note: c.note,
            occurredAt: c.occurredAt,
          }))
        );
        logged = toInsert.length;
      }
    }

    await db
      .update(calendarAccounts)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(calendarAccounts.id, account.id));
    revalidateDealViews();
    revalidatePath("/settings");
    return { ok: true, message: `Synk fullført — ${logged} nye møter logget.` };
  } catch (err) {
    // Samme prinsipp som i sendQuoteEmail: rå Google API-feil kan inneholde
    // interne detaljer, logges i sin helhet server-side, generell melding
    // til brukeren (også den som lagres som lastError og vises i UI).
    console.error("syncGoogleCalendarNow feilet:", err);
    const message = "Synk feilet. Prøv å koble til Google Kalender på nytt om problemet vedvarer.";
    await db
      .update(calendarAccounts)
      .set({ lastError: message })
      .where(eq(calendarAccounts.id, account.id));
    return { ok: false, message };
  }
}
