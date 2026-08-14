import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, calendarAccounts } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  exchangeCodeForTokens,
  fetchGoogleAccountEmail,
  verifyCalendarState,
} from "@/lib/googleCalendar";

// Google redirigerer hit med et vanlig nettleser-GET etter samtykke — dette
// MÅ være en route handler (ikke en server action), siden en ekstern
// omdirigering ikke kan treffe en server action direkte.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/settings?error=kalender-avbrutt", request.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?error=kalender-feil", request.url));
  }

  const me = await getCurrentUser();
  const stateUserId = await verifyCalendarState(state);
  if (!me || !stateUserId || stateUserId !== me.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { accessToken, refreshToken } = await exchangeCodeForTokens(code);
    if (!refreshToken) {
      // Google gir bare refresh_token ved førstegangs samtykke — siden vi
      // alltid ber om prompt=consent skjer dette i praksis aldri, men vi
      // håndterer det uten å krasje hvis det likevel skjer.
      return NextResponse.redirect(
        new URL("/settings?error=kalender-ingen-refresh-token", request.url)
      );
    }
    const email = (await fetchGoogleAccountEmail(accessToken)) ?? me.email;

    const existing = await db.query.calendarAccounts.findFirst({
      where: eq(calendarAccounts.userId, me.id),
    });
    const values = {
      email,
      refreshTokenEnc: encrypt(refreshToken),
      lastError: null,
    };
    if (existing) {
      await db.update(calendarAccounts).set(values).where(eq(calendarAccounts.id, existing.id));
    } else {
      await db.insert(calendarAccounts).values({ ...values, userId: me.id });
    }
    return NextResponse.redirect(new URL("/settings?calendar=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?error=kalender-feil", request.url));
  }
}
