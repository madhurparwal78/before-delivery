#!/bin/sh
# Restarts the built server in the background for local checking.
for p in /proc/[0-9]*; do
  if grep -qa "dist/server/index.js" "$p/cmdline" 2>/dev/null; then
    kill "${p#/proc/}" 2>/dev/null
  fi
done
sleep 1
cd /app && node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 4
echo "server restarted"
