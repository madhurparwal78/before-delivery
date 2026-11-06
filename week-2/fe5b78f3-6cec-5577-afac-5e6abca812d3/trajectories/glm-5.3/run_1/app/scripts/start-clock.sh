#!/bin/bash
# Start the server with a given RAIL_CLOCK_START / RATE.
set -u
for d in /proc/[0-9]*/cmdline; do
  pid=$(basename $(dirname $d))
  cmd=$(tr '\0' ' ' < $d 2>/dev/null)
  case "$cmd" in *dist/server.js*) kill "$pid" 2>/dev/null ;; esac
done
sleep 1
cd /app
RAIL_CLOCK_START="${RAIL_CLOCK_START:-}" RAIL_CLOCK_RATE="${RAIL_CLOCK_RATE:-1}" nohup node dist/server.js > server.log 2>&1 &
for i in $(seq 1 60); do
  sleep 0.5
  if curl -s -m 2 http://localhost:4173/api/health 2>/dev/null | grep -q '"ok"'; then
    echo "server up at $(curl -s -m 2 http://localhost:4173/api/clock)"
    exit 0
  fi
done
echo "server FAILED"; tail -20 /app/server.log; exit 1
