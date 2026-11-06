#!/bin/sh
# Restart the built desk, killing any running instance first.
for p in /proc/[0-9]*; do
  cmd=$(tr '\0' ' ' < $p/cmdline 2>/dev/null)
  if echo "$cmd" | grep -q "build/server.js"; then
    kill -9 "${p#/proc/}" 2>/dev/null
  fi
done
sleep 1
cd /app || exit 1
nohup node build/server.js > /tmp/server.log 2>&1 &
echo "restarted pid $!"
