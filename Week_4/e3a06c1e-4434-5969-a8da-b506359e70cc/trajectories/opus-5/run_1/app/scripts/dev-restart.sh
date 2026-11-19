#!/bin/bash
# Development helper: rebuild and restart the server, replacing any running instance.
cd /app || exit 1
for d in /proc/[0-9]*; do
  if tr '\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q 'dist/server/index.js'; then
    kill "$(basename "$d")" 2>/dev/null
  fi
done
sleep 1
if [ "$1" != "--no-build" ]; then
  npm run build > /tmp/build.log 2>&1 || { tail -20 /tmp/build.log; exit 1; }
fi
rm -f /tmp/server.log
node dist/server/index.js > /tmp/server.log 2>&1 &
for _ in $(seq 1 60); do
  sleep 1
  if curl -sf -m 2 http://127.0.0.1:4173/api/health > /dev/null 2>&1; then
    echo "server ready"
    exit 0
  fi
done
echo "server did not become ready"
tail -20 /tmp/server.log
exit 1
