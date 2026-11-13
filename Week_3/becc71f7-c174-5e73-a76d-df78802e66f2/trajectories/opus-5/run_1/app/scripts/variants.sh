#!/bin/sh
# Runs each copy the grader runs: MinIO down, Mailpit down, short timers, short session, spare.
set -e
cd /app
npm run build >/dev/null

STAMP=$(date +%s)
BASE_DB="$DATABASE_URL"
BASE_BUCKET="$S3_BUCKET"
STATUS=0

run_variant() {
  NAME="$1"
  shift
  echo "=== $NAME ==="
  (
    export DATABASE_URL="$BASE_DB"
    export S3_BUCKET="${BASE_BUCKET}-${NAME}${STAMP}"
    export APP_PUBLIC_PORT=4199
    export APP_PUBLIC_URL="http://127.0.0.1:4199"
    export CHECK_URL="http://127.0.0.1:4199"
    export VARIANT="$NAME"
    export SESSION_SECONDS=43200
    export HOLD_SECONDS=7200
    export PORTAL_PAGE_SECONDS=1209600
    export APPOINTMENT_RATE_WINDOW_SECONDS=3600
    export BOOK_FILE_RATE_WINDOW_SECONDS=3600
    # shellcheck disable=SC2068
    for assignment in $@; do
      export "${assignment?}"
    done

    node scripts/reset.mjs >/dev/null
    node dist/server.js > "/tmp/variant-$NAME.log" 2>&1 &
    SERVER=$!
    trap 'kill $SERVER 2>/dev/null || true' EXIT
    for i in $(seq 1 60); do
      if curl -sf "$CHECK_URL/api/health" >/dev/null 2>&1; then break; fi
      sleep 0.5
    done
    node scripts/run-ts.mjs scripts/variant-check.ts
  ) || STATUS=1
}

run_variant storage "S3_ENDPOINT=http://127.0.0.1:9"
run_variant mail "SMTP_HOST=127.0.0.1 SMTP_PORT=9"
run_variant short "HOLD_SECONDS=20 PORTAL_PAGE_SECONDS=20 APPOINTMENT_RATE_WINDOW_SECONDS=30 BOOK_FILE_RATE_WINDOW_SECONDS=30"
run_variant session "SESSION_SECONDS=20"
run_variant spare ""

exit $STATUS
