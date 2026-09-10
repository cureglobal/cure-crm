"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  emailAccounts,
  emailAccessGrants } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  manualSyncLimiter } from "@/lib/rateLimit";
import { encrypt } from "@/lib/crypto";
import { syncAccount } from "@/lib/imap";
import {
  revalidateDealViews } from "./_shared";

// ---------- E-postkonto ----------

export async function connectEmailAccount(formData: FormData) {
  const me = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").replace(/\s+/g, "");
  const imapHost = String(formData.get("imapHost") ?? "imap.gmail.com").trim();
  if (!email || !password) redirect("/settings?error=imap");

  const existing = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  const values = {
    email,
    imapHost,
    imapPort: 993,
    imapUser: email,
    passwordEnc: encrypt(password),
    lastError: null,
  };
  if (existing) {
    await db.update(emailAccounts).set(values).where(eq(emailAccounts.id, existing.id));
  } else {
    await db.insert(emailAccounts).values({ ...values, userId: me.id });
  }
  revalidatePath("/settings");
  redirect("/settings?connected=1");
}

export async function disconnectEmailAccount() {
  const me = await requireUser();
  await db.delete(emailAccounts).where(eq(emailAccounts.userId, me.id));
  revalidatePath("/settings");
}

export async function updateSignature(formData: FormData) {
  const me = await requireUser();
  const signature = String(formData.get("signature") ?? "");
  await db
    .update(users)
    .set({ signature: signature.trim() ? signature : null })
    .where(eq(users.id, me.id));
  revalidatePath("/settings");
}

// Markerer onboarding-gjennomgangen som sett — enten fullført eller lukket
// underveis — slik at den ikke dukker opp igjen ved neste innlogging.
export async function completeOnboarding() {
  const me = await requireUser();
  await db.update(users).set({ onboardingSeenAt: new Date() }).where(eq(users.id, me.id));
  revalidatePath("/", "layout");
}

const THEMES = ["lys", "dark", "elguide", "pokemon"] as const;

export async function updateTheme(formData: FormData) {
  const me = await requireUser();
  const theme = String(formData.get("theme") ?? "");
  if (!THEMES.includes(theme as (typeof THEMES)[number])) return;
  await db.update(users).set({ theme }).where(eq(users.id, me.id));
  // Selve <html data-theme> settes i rotlayouten, som ligger over (app)-gruppen.
  revalidatePath("/", "layout");
}

export async function syncEmailsNow(): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!manualSyncLimiter.tryConsume(String(me.id))) {
    return { ok: false, message: "Vent litt før du synker igjen." };
  }
  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  if (!account) return { ok: false, message: "Ingen e-postkonto er koblet til." };
  const result = await syncAccount(account);
  revalidatePath("/settings");
  revalidateDealViews();
  if (result.error) return { ok: false, message: `Synk feilet: ${result.error}` };
  if (result.capped) {
    return {
      ok: true,
      message: `Delvis synk — ${result.matched} nye e-poster koblet til (${result.scanned} gjennomgått). Kontoen har mer historikk enn det som får plass i én kjøring; kjør synk på nytt for å fortsette.`,
    };
  }
  return {
    ok: true,
    message: `Synk ferdig — ${result.matched} nye e-poster koblet til selskaper (${result.scanned} gjennomgått).`,
  };
}


// ---------- Tilgang til e-postdialog ----------

export async function requestEmailAccess(companyId: number, ownerUserId: number) {
  const me = await requireUser();
  if (me.id === ownerUserId) return;
  await db
    .insert(emailAccessGrants)
    .values({ companyId, ownerUserId, granteeUserId: me.id, status: "requested" })
    .onConflictDoUpdate({
      target: [
        emailAccessGrants.companyId,
        emailAccessGrants.ownerUserId,
        emailAccessGrants.granteeUserId,
      ],
      set: { status: "requested", respondedAt: null },
    });
  revalidateDealViews();
}

export async function respondEmailAccess(grantId: number, grant: boolean) {
  const me = await requireUser();
  const request = await db.query.emailAccessGrants.findFirst({
    where: and(eq(emailAccessGrants.id, grantId), eq(emailAccessGrants.ownerUserId, me.id)),
  });
  if (!request) return;
  await db
    .update(emailAccessGrants)
    .set({ status: grant ? "granted" : "denied", respondedAt: new Date() })
    .where(eq(emailAccessGrants.id, grantId));
  revalidateDealViews();
}
