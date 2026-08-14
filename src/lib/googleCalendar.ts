// OAuth2 + Kalender-klient mot Google. Rene fetch-kall mot Googles REST-
// endepunkter (samme mønster som brreg.ts) — ingen googleapis-SDK-avhengighet
// trengs for de fire kallene vi bruker (auth-URL, token-bytte, token-fornyelse,
// hente events).

import { SignJWT, jwtVerify } from "jose";

function stateSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET mangler i .env.local");
  return new TextEncoder().encode(s);
}

// Signert state-parameter for OAuth-callbacken — enkel CSRF-beskyttelse uten
// egen serverside sesjonslagring for selve OAuth-flyten, samme signeringsnøkkel
// (SESSION_SECRET) som innloggingscookien i src/lib/auth.ts.
export async function signCalendarState(userId: number): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());
}

export async function verifyCalendarState(state: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(state, stateSecret());
    return typeof payload.uid === "number" ? payload.uid : null;
  } catch {
    return null;
  }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function clientId(): string {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CALENDAR_CLIENT_ID mangler i .env.local");
  return id;
}

function clientSecret(): string {
  const s = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!s) throw new Error("GOOGLE_CALENDAR_CLIENT_SECRET mangler i .env.local");
  return s;
}

function redirectUri(): string {
  const u = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!u) throw new Error("GOOGLE_CALENDAR_REDIRECT_URI mangler i .env.local");
  return u;
}

// Brukes til å skjule "Koble til Google Kalender" hvis miljøvariablene ikke
// er satt opp ennå, i stedet for å krasje siden.
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
      process.env.GOOGLE_CALENDAR_REDIRECT_URI
  );
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token-utveksling feilet: ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Kunne ikke fornye Google-tilgang: ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  return data.access_token;
}

interface GoogleUserInfo {
  email?: string;
}

// Brukes bare til visning i Innstillinger (hvilken Google-konto er koblet
// til) — ikke til autentisering, det styres av refresh-tokenet.
export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as GoogleUserInfo;
  return data.email ?? null;
}

interface GoogleEventAttendee {
  email?: string;
}

interface GoogleEventItem {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: GoogleEventAttendee[];
}

interface GoogleEventsResponse {
  items?: GoogleEventItem[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  startedAt: Date | null;
  attendeeEmails: string[];
}

// Henter møter i et gitt tidsvindu fra brukerens primære Google-kalender.
export async function fetchCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    maxResults: "250",
    orderBy: "startTime",
  });
  const res = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Henting av kalenderhendelser feilet: ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleEventsResponse;
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
      const startStr = e.start?.dateTime ?? e.start?.date ?? null;
      return {
        id: e.id,
        summary: e.summary ?? "(uten tittel)",
        startedAt: startStr ? new Date(startStr) : null,
        attendeeEmails: (e.attendees ?? [])
          .map((a) => (a.email ?? "").toLowerCase().trim())
          .filter(Boolean),
      };
    });
}
