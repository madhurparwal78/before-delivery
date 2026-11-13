#!/bin/sh
# Rebuilds, resets this copy's data and runs the API check against a fresh server.
set -e
cd /app

export S3_BUCKET="${S3_BUCKET}-check$(date +%s)"
export APP_PUBLIC_PORT=4188
export APP_PUBLIC_URL="http://127.0.0.1:4188"
export CHECK_URL="http://127.0.0.1:4188"

npm run build >/dev/null
node scripts/reset.mjs

node dist/server.js > /tmp/check-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  if curl -sf "$CHECK_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

node scripts/run-ts.mjs scripts/api-check.ts
STATUS=$?
echo "--- server log tail ---"
tail -5 /tmp/check-server.log
exit $STATUS
