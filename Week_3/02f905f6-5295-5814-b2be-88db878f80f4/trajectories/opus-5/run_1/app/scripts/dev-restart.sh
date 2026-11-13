#!/bin/sh
# Stops any running Shelfmark instances and starts the pair used while working:
# the default clock on 4173 and a fast clock on 4174.
set -u
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if grep -qa "dist/server/server/index.js" "/proc/$pid/cmdline" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 1
cd /app || exit 1
node dist/server/server/index.js >/tmp/server.log 2>&1 &
APP_PUBLIC_PORT=4174 FIRING_HOUR_SECONDS=1 PICKUP_DAY_SECONDS=1 \
  node dist/server/server/index.js >/tmp/server2.log 2>&1 &
sleep 3
printf '4173: '
curl -s -m 3 localhost:4173/api/health
printf '\n4174: '
curl -s -m 3 localhost:4174/api/health
printf '\n'
