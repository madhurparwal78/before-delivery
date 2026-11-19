#!/bin/sh
# Restart the app in the background for local checking.
cd /app || exit 1
# This image carries no pkill, so find the process through /proc.
for dir in /proc/[0-9]*; do
  if tr '\0' ' ' < "$dir/cmdline" 2>/dev/null | grep -q "src/server.js"; then
    kill "$(basename "$dir")" 2>/dev/null
  fi
done
sleep 1.5
node src/server.js > /tmp/server.log 2>&1 &
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${APP_PUBLIC_PORT}/api/health" > /dev/null 2>&1; then
    echo "ready"
    exit 0
  fi
  sleep 0.5
done
echo "did not become ready"
tail -20 /tmp/server.log
exit 1
