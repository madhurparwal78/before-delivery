#!/bin/sh
# Rebuilds the server, optionally resets the database, and restarts it for local checks.
set -e
cd /app
MATCH='dist/server/server/index.js'

for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  if tr '\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q "$MATCH"; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 1

npx tsc -p tsconfig.server.json
if [ "$1" = "--reset" ]; then node scripts/reset-db.mjs; fi

node dist/server/server/index.js > /tmp/server.log 2>&1 &
NEW=$!

for _ in $(seq 1 40); do
  if ! kill -0 "$NEW" 2>/dev/null; then echo "server exited"; cat /tmp/server.log; exit 1; fi
  if curl -fsS -m 2 http://127.0.0.1:4173/api/health > /dev/null 2>&1; then
    sleep 2
    echo "server up (pid $NEW)"
    exit 0
  fi
  sleep 0.5
done
echo "server failed to start"
cat /tmp/server.log
exit 1
