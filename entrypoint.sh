#!/bin/sh
set -e

chown -R nextjs:nodejs /app/data

# Litestream tar kontinuerlig sikkerhetskopi av databasen til Cloudflare R2
# og starter appen som sin egen underprosess, slik at replikeringen lever
# nøyaktig like lenge som appen. -restore-if-db-not-exists henter databasen
# ned igjen automatisk hvis volumet er tomt — altså hele gjenopprettingen
# etter at et volum er tapt.
#
# Mangler nøklene, starter appen som før. Et glemt miljøvariabelnavn skal
# ikke ta ned CRM-et; det skal bare bety at det ikke tas sikkerhetskopi.
if [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_ENDPOINT" ]; then
  echo "litestream: replikerer /app/data/crm.db til R2" >&2
  # $0 spises av su som argv[0], derfor et fyllord først: da blir "$*" den
  # komplette kommandoen fra CMD ("node server.js").
  exec su nextjs -s /bin/sh -c \
    'exec litestream replicate -restore-if-db-not-exists -exec "$*"' -- litestream "$@"
fi

echo "litestream: R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ENDPOINT mangler — starter UTEN sikkerhetskopi" >&2
exec su nextjs -s /bin/sh -c 'exec "$0" "$@"' -- "$@"
