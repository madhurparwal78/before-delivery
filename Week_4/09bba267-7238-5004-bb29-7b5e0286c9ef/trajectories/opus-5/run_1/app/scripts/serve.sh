#!/bin/sh
# Restarts the built server for local checks. Usage: scripts/serve.sh [HOLD_SECONDS] [OFFER_SECONDS]
for proc in /proc/[0-9]*; do
  if grep -qa 'dist/server/index.js' "$proc/cmdline" 2>/dev/null; then
    kill "${proc#/proc/}" 2>/dev/null
  fi
done
sleep 1
HOLD_SECONDS="${1:-600}" OFFER_SECONDS="${2:-900}" node /app/dist/server/index.js > /tmp/server.log 2>&1 &
sleep 3
curl -s localhost:4173/api/health
echo " (HOLD_SECONDS=${1:-600} OFFER_SECONDS=${2:-900})"
