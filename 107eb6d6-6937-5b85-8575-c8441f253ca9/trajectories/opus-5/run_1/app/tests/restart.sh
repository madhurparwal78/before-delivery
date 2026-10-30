#!/bin/sh
# Development helper: restart the server and wait for health.
cd "$(dirname "$0")/.." || exit 1
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if grep -qa "server.js" "/proc/$pid/cmdline" 2>/dev/null; then kill "$pid"; fi
done
sleep 1
npm run build >/dev/null || exit 1
node server.js >/tmp/server.log 2>&1 &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -sf -m 2 http://127.0.0.1:4173/api/health >/dev/null; then
    echo "server up"
    exit 0
  fi
done
echo "server did not come up"
tail -20 /tmp/server.log
exit 1
