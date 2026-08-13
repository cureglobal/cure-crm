# Bygg som kjører Next.js i standalone-modus med SQLite på et montert volum.
FROM node:22-slim AS base
# better-sqlite3 kompileres fra kilde, så byggeverktøy må være med i byggesteget.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Bygget trenger ikke ekte hemmeligheter, men koden krever at de finnes.
ENV SESSION_SECRET=build-time-placeholder
ENV CRYPTO_KEY=0000000000000000000000000000000000000000000000000000000000000000
RUN mkdir -p data && npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Native modul kopieres inn ferdig kompilert fra byggesteget.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Databasen ligger på et volum montert her, slik at den overlever nye versjoner.
# Volumet monteres som root ved oppstart uansett hva som chownes i byggesteget,
# så eierskap må settes på nytt av entrypointet hver gang containeren starter.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
