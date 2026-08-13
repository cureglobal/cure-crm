#!/bin/sh
set -e

chown -R nextjs:nodejs /app/data

exec su nextjs -s /bin/sh -c 'exec "$0" "$@"' -- "$@"
