#!/bin/zsh
# Tar en sikkerhetskopi av produksjonsdatabasen og legger den i R2.
#
# Krever kun at du er logget inn i `railway` og `wrangler` — ingen R2-nøkler.
# Det er forskjellen fra Litestream (se DEPLOY.md), som replikerer
# fortløpende men trenger egne S3-nøkler satt i Railway. Denne kan kjøres
# når som helst, og er den enkleste måten å ta en kopi før noe risikabelt.
#
#   npm run db:backup
set -e

BUCKET=cure-crm-backup
SERVICE=cure-crm
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
LOCAL=$(mktemp -t crm-backup)

cleanup() { rm -f "$LOCAL"; }
trap cleanup EXIT

echo "1/3  Lager et konsistent øyeblikksbilde på serveren …"
# VACUUM INTO skriver én komplett fil, WAL inkludert. Å kopiere crm.db
# alene ville mistet alt som ennå bare ligger i WAL-en.
railway ssh --service "$SERVICE" "cd /app && node -e \"
const {createClient}=require('@libsql/client');
createClient({url:'file:/app/data/crm.db'})
  .execute(\\\"VACUUM INTO '/tmp/crm-backup.db'\\\")
  .then(()=>console.log('ok'))
  .catch(e=>{console.error(e.message);process.exit(1)});
\"" >/dev/null

echo "2/3  Henter den ned …"
railway ssh --service "$SERVICE" "base64 < /tmp/crm-backup.db" | base64 -d > "$LOCAL"
railway ssh --service "$SERVICE" "rm -f /tmp/crm-backup.db" >/dev/null 2>&1 || true

# En tom eller halv fil er verre enn ingen kopi, fordi den ser ut som en kopi.
SIZE=$(wc -c < "$LOCAL" | tr -d ' ')
if [ "$SIZE" -lt 100000 ]; then
  echo "AVBRYTER: kopien ble bare $SIZE byte — det er for lite til å være ekte."
  exit 1
fi
if command -v sqlite3 >/dev/null 2>&1; then
  CHECK=$(sqlite3 "$LOCAL" "PRAGMA integrity_check;" 2>&1 | head -1)
  [ "$CHECK" = "ok" ] || { echo "AVBRYTER: integrity_check sa '$CHECK'"; exit 1; }
  DEALS=$(sqlite3 "$LOCAL" "SELECT COUNT(*) FROM deals;")
  echo "     $SIZE byte, integrity_check ok, $DEALS deals"
fi

echo "3/3  Laster opp til R2 …"
npx wrangler r2 object put "$BUCKET/manual/crm-$STAMP.db" --file "$LOCAL" --remote >/dev/null

echo
echo "Ferdig: r2://$BUCKET/manual/crm-$STAMP.db"
echo "Hent den ned igjen med:"
echo "  npx wrangler r2 object get $BUCKET/manual/crm-$STAMP.db --remote --file crm.db"
echo "(wrangler kan ikke liste bøtta — oversikten finnes i Cloudflare-dashbordet)"
