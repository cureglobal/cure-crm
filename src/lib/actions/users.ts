"use server";

import bcrypt from "bcryptjs";
import {
  deleteObject } from "@/lib/objectStorage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import {
  db,
  users } from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import {
  perEmailLoginLimiter,
  perIpLoginLimiter } from "@/lib/rateLimit";
import {
  revalidateDealViews,
  storeUploadedImage } from "./_shared";

// ---------- Auth ----------

export async function setupFirstUser(formData: FormData) {
  const existing = await db.query.users.findFirst();
  if (existing) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || password.length < 8) {
    redirect("/login?error=setup");
  }
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 12), isAdmin: true })
    .returning();
  await createSession(user.id);
  redirect("/");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (perEmailLoginLimiter.isLocked(email) || perIpLoginLimiter.isLocked(ip)) {
    redirect("/login?error=locked");
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    perEmailLoginLimiter.recordFailure(email);
    perIpLoginLimiter.recordFailure(ip);
    redirect("/login?error=1");
  }
  perEmailLoginLimiter.recordSuccess(email);
  perIpLoginLimiter.recordSuccess(ip);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function addUser(formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan legge til brukere");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || password.length < 8) {
    redirect("/settings?error=bruker");
  }
  const rawBusinessUnitId = String(formData.get("businessUnitId") ?? "");
  const businessUnitId = rawBusinessUnitId ? Number(rawBusinessUnitId) : null;
  await db.insert(users).values({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    businessUnitId: businessUnitId && businessUnitId > 0 ? businessUnitId : null,
  });
  revalidatePath("/settings");
}

// Admin kan endre navn på hvem som helst; alle andre kan bare endre sitt eget
// — samme tilgangsmønster som updateAvatar.
export async function updateUserName(userId: number, formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin && me.id !== userId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.update(users).set({ name }).where(eq(users.id, userId));
  revalidatePath("/settings");
  revalidateDealViews();
}



export async function updateAvatar(userId: number, formData: FormData) {
  const me = await requireUser();
  if (me.id !== userId && !me.isAdmin) return;
  const avatar = String(formData.get("avatar") ?? "");
  const stored = await storeUploadedImage(avatar, `avatars/${userId}`);
  if (!stored) return;

  // Rydd bort det forrige bildet, ellers samler det seg opp filer i R2 som
  // ingenting peker på.
  const previous = await db
    .select({ key: users.avatarObjectKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // avatarUpdatedAt er cache-nøkkelen i bilde-URL-en (se src/lib/avatar.ts).
  // Uten at den settes her ville nettleseren fortsatt vist det gamle bildet.
  // avatarDataUrl nulles: bildet bor i R2 nå, ikke i raden.
  await db
    .update(users)
    .set({ avatarObjectKey: stored.key, avatarDataUrl: null, avatarUpdatedAt: new Date() })
    .where(eq(users.id, userId));

  const oldKey = previous[0]?.key;
  // Feiler slettingen, er bildet likevel byttet — en foreldreløs fil i R2 er
  // ikke verdt å velte handlingen for.
  if (oldKey && oldKey !== stored.key) await deleteObject(oldKey).catch(() => {});
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

// Kan ikke endre egen admin-status — unngår å låse seg selv ute ved en feilklikk.
export async function setUserAdmin(userId: number, isAdmin: boolean) {
  const me = await requireUser();
  if (!me.isAdmin || userId === me.id) return;
  await db.update(users).set({ isAdmin }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

export async function setUserBusinessUnit(userId: number, businessUnitId: number | null) {
  const me = await requireUser();
  if (!me.isAdmin) return;
  await db.update(users).set({ businessUnitId }).where(eq(users.id, userId));
  revalidatePath("/settings");
}
