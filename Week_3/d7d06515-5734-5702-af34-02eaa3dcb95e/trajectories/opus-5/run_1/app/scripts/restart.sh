#!/bin/sh
# Rebuilds and restarts the local server for manual checks.
set -e
cd "$(dirname "$0")/.."
for p in /proc/[0-9]*; do
  if grep -qa 'dist/server.js' "$p/cmdline" 2>/dev/null; then kill "${p##*/}" 2>/dev/null || true; fi
done
sleep 1
node build.mjs
node dist/server.js > /tmp/server.log 2>&1 &
sleep 3
curl -s localhost:4173/api/health
echo
