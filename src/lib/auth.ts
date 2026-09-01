import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, users, type User } from "@/lib/db";
import { eq } from "drizzle-orm";

const COOKIE = "crm_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET mangler i .env.local");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    // Ikke satt i dev — en Secure-cookie blir stille forkastet av nettleseren
    // på et usikret http://localhost, som ville brutt innlogging lokalt.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// Hvor sjelden lastSeenAt oppdateres — trenger ikke være sekund-nøyaktig
// (kun til "Sist online"-oversikten for admin), og sparer en skrivning per
// request ellers siden getCurrentUser kalles på så godt som hver side/action.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = payload.uid as number;
    const user = await db.query.users.findFirst({ where: eq(users.id, uid) });
    if (!user) return null;
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, uid));
    }
    return user;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
