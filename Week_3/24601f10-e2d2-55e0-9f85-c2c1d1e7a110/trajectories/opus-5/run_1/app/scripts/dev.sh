#!/bin/sh
# Rebuild and restart the local server, then print health.
cd /app || exit 1
for pid in $(cd /proc && for p in [0-9]*; do grep -qa "dist/server/server/index.js" "$p/cmdline" 2>/dev/null && echo "$p"; done); do
  kill "$pid" 2>/dev/null
done
sleep 1
npm run build > /tmp/build.log 2>&1 || { tail -20 /tmp/build.log; exit 1; }
npm run start > /tmp/server.log 2>&1 &
sleep 2
curl -s localhost:4173/api/health
echo
