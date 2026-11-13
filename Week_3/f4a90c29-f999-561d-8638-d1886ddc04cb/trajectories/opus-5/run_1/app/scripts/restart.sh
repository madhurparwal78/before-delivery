#!/bin/sh
# Rebuild and restart the server for local checks.
set -e
cd /app
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'bin/server'; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 1
go build -o bin/server .
nohup ./bin/server > /tmp/wren.log 2>&1 &
sleep 2
curl -s localhost:4173/api/health
echo
