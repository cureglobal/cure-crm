// Enkel minne-basert rate limiter for innloggingsforsøk. Nullstilles ved
// redeploy/restart, og deles ikke på tvers av flere instanser — grei nok
// beskyttelse mot brute force så lenge appen kjører som én replika.
function createLimiter(maxAttempts: number, windowMs: number, lockoutMs: number) {
  const attempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

  function prune(now: number) {
    for (const [key, entry] of attempts) {
      if (entry.lockedUntil < now && now - entry.windowStart > windowMs) attempts.delete(key);
    }
  }

  return {
    isLocked(key: string): boolean {
      const entry = attempts.get(key);
      return !!entry && entry.lockedUntil > Date.now();
    },
    recordFailure(key: string) {
      const now = Date.now();
      prune(now);
      const entry = attempts.get(key);
      if (!entry || now - entry.windowStart > windowMs) {
        attempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
        return;
      }
      entry.count += 1;
      if (entry.count >= maxAttempts) entry.lockedUntil = now + lockoutMs;
    },
    recordSuccess(key: string) {
      attempts.delete(key);
    },
  };
}

// Låser et konkret e-postforsøk etter 5 feil på 10 minutter.
export const perEmailLoginLimiter = createLimiter(5, 10 * 60 * 1000, 15 * 60 * 1000);
// Grovere sperre per IP, så én klient ikke kan prøve seg gjennom mange kontoer.
export const perIpLoginLimiter = createLimiter(20, 10 * 60 * 1000, 15 * 60 * 1000);

// Enkelt "maks N ganger per vindu"-vern for kostbare/misbrukbare handlinger
// (utsendt e-post, ekstern synk) — til forskjell fra loginLimiteren over
// teller denne alle forsøk, ikke bare feilede.
function createActionLimiter(maxPerWindow: number, windowMs: number) {
  const counts = new Map<string, { count: number; windowStart: number }>();
  return {
    tryConsume(key: string): boolean {
      const now = Date.now();
      const entry = counts.get(key);
      if (!entry || now - entry.windowStart > windowMs) {
        counts.set(key, { count: 1, windowStart: now });
        return true;
      }
      if (entry.count >= maxPerWindow) return false;
      entry.count += 1;
      return true;
    },
  };
}

// Maks 40 pristilbud sendt per bruker per time — langt over reelt behov for
// et lite salgsteam, men stopper at en konto brukt til å spamme ut e-post.
export const sendQuoteLimiter = createActionLimiter(40, 60 * 60 * 1000);
// Maks én manuell synk-utløsning per bruker/konto per 30 sekunder.
export const manualSyncLimiter = createActionLimiter(1, 30 * 1000);
// Maks én "match alle mot Brreg"-kjøring per bruker per 5 minutter — den
// looper allerede over alle uverifiserte selskaper i ett kall.
export const brregMatchAllLimiter = createActionLimiter(1, 5 * 60 * 1000);
