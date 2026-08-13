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
