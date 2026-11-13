#!/bin/sh
# Rebuilds, resets this copy's data and runs the browser checks against a fresh server.
set -e
cd /app

export S3_BUCKET="${S3_BUCKET}-ui$(date +%s)"
export APP_PUBLIC_PORT=4188
export APP_PUBLIC_URL="http://127.0.0.1:4188"
export CHECK_URL="http://127.0.0.1:4188"

npm run build >/dev/null
node scripts/reset.mjs

node dist/server.js > /tmp/ui-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  if curl -sf "$CHECK_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

node scripts/ui-check.mjs
STATUS=$?
echo "--- server log tail ---"
tail -5 /tmp/ui-server.log
exit $STATUS
