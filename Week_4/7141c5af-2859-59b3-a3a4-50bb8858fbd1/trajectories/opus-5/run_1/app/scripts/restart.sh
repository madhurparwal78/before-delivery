#!/bin/sh
# Rebuilds, clears the primary database and starts one fresh copy. Verification only.
set -e
cd "$(dirname "$0")/.."

for d in /proc/[0-9]*; do
  if tr '\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q "dist/server/index.js"; then
    kill "${d#/proc/}" 2>/dev/null || true
  fi
done
sleep 1

if [ "$1" = "--fresh" ]; then
  node scripts/reset-db.mjs
fi

npm run build >/dev/null
npm run serve > /tmp/server.log 2>&1 &

for i in $(seq 1 40); do
  if curl -fsS -m 2 http://127.0.0.1:4173/api/health >/dev/null 2>&1; then
    echo "up"
    exit 0
  fi
  sleep 1
done
echo "failed to start"
tail -20 /tmp/server.log
exit 1
