#!/bin/sh
# Rebuilds, resets the database and restarts the app for a clean check run.
set -e
cd /app
for dir in /proc/[0-9]*; do
  if tr '\0' ' ' < "$dir/cmdline" 2>/dev/null | grep -q 'dist/server/index.js'; then
    kill "${dir#/proc/}" 2>/dev/null || true
  fi
done
sleep 1
if [ "$1" = "--reset" ]; then node scripts/reset.mjs; fi
nohup node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 3
curl -s -m 5 http://127.0.0.1:4173/api/health
echo
