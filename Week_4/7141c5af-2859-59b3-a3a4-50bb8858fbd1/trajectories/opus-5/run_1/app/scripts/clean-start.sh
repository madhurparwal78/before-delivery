#!/bin/sh
# Proves the published start-up path: empty database, build, serve.
# Verification only.
set -e
cd "$(dirname "$0")/.."

for d in /proc/[0-9]*; do
  if tr '\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q "dist/server/index.js"; then
    kill "${d#/proc/}" 2>/dev/null || true
  fi
done
sleep 2

node scripts/reset-db.mjs
rm -rf dist
npm run build
npm run serve > /tmp/final.log 2>&1 &

for i in $(seq 1 90); do
  if curl -fsS -m 2 http://127.0.0.1:4173/api/health >/dev/null 2>&1; then
    echo "health: $(curl -s -m 5 http://127.0.0.1:4173/api/health)"
    sleep 14
    echo "--- log ---"
    tail -5 /tmp/final.log
    exit 0
  fi
  sleep 1
done
echo "failed to start"
tail -20 /tmp/final.log
exit 1
