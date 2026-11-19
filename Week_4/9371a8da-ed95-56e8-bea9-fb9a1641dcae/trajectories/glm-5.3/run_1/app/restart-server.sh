#!/bin/bash
# Test helper: stop any running server, reset the database, start fresh.
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null; then kill $p 2>/dev/null; fi
done
sleep 1
node /app/reset-db.mjs
(
  cd /app
  DATABASE_URL=postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev \
  S3_ENDPOINT=http://minio:9000 S3_BUCKET=gf-dev \
  S3_ACCESS_KEY_ID=gf-dev-root-71c3e0 S3_SECRET_ACCESS_KEY=gf-dev-secret-4b8d92 \
  S3_FORCE_PATH_STYLE=true S3_REGION=us-east-1 \
  SMTP_HOST=mailpit SMTP_PORT=1025 \
  node dist/server/main.js > /tmp/server.log 2>&1 &
)
for i in $(seq 1 30); do
  sleep 1
  if curl -sf http://127.0.0.1:4173/api/health > /dev/null 2>&1; then
    if curl -sf -X POST http://127.0.0.1:4173/api/session -H "Content-Type: application/json" \
      -d '{"email":"ilse.varga@varga-lab.test","password":"quill-owner-2026"}' > /dev/null 2>&1; then
      echo "server ready with seed"
      exit 0
    fi
  fi
done
echo "server failed to become ready"
exit 1
