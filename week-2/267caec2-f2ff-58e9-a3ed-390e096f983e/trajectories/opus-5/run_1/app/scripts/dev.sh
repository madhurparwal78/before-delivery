#!/bin/sh
# Developer helper: rebuild the server and restart it in the background.
set -e
cd "$(dirname "$0")/.."
for p in /proc/[0-9]*; do
  if grep -qa "dist/server/index.js" "$p/cmdline" 2>/dev/null; then kill "${p#/proc/}" || true; fi
done
sleep 1
npx tsc -p tsconfig.json
cp src/server/schema.sql dist/server/schema.sql
node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 6
curl -s localhost:4173/api/health
echo
