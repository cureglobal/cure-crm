#!/bin/zsh
# Deler CRM-et på en midlertidig, offentlig lenke via Cloudflare Quick Tunnel.
# Ingen konto eller innlogging kreves. Lenken lever så lenge kommandoen kjører.
set -e

export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Fant ikke cloudflared. Installer med:"
  echo '  curl -sL -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
  echo '  tar -xzf /tmp/cf.tgz -C /tmp && mv /tmp/cloudflared ~/.local/bin/'
  exit 1
fi

PORT="${PORT:-3000}"

if ! curl -s -o /dev/null "http://localhost:$PORT"; then
  echo "Starter appen på port $PORT …"
  npm run start >/tmp/crm-share-server.log 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
  for _ in $(seq 1 40); do
    curl -s -o /dev/null "http://localhost:$PORT" && break
    sleep 0.5
  done
fi

echo ""
echo "──────────────────────────────────────────────────────────────"
echo " Åpner offentlig lenke. Den vises som «trycloudflare.com» her:"
echo "──────────────────────────────────────────────────────────────"
echo ""

# --no-autoupdate hindrer at tunnelen restarter midt i en demo.
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT"
