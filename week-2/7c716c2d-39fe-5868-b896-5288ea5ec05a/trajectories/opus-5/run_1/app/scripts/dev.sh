#!/bin/sh
set -u
cd /app || exit 1
for dir in /proc/[0-9]*; do
  if grep -qa 'dist/server/index.js' "$dir/cmdline" 2>/dev/null; then
    kill "$(basename "$dir")" 2>/dev/null
  fi
done
sleep 1
npm run build > /tmp/build.log 2>&1 || { tail -20 /tmp/build.log; exit 1; }
nohup node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 3
curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:4173/api/health
