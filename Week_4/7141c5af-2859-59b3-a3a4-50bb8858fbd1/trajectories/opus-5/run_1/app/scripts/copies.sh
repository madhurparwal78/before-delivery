#!/bin/sh
# Starts one named copy on its own port with the published differences.
# Verification only.
set -e
cd "$(dirname "$0")/.."

COPY="$1"
PORT="$2"
if [ -z "$COPY" ] || [ -z "$PORT" ]; then
  echo "usage: copies.sh <copy> <port>"
  exit 2
fi

export APP_PUBLIC_PORT="$PORT"
export APP_PUBLIC_URL="http://127.0.0.1:$PORT"

case "$COPY" in
  storage)
    export S3_ENDPOINT="http://127.0.0.1:9"
    export COPY_SCHEMA="copy_storage"
    export S3_BUCKET="${S3_BUCKET}-storage"
    export SEARCH_INDEX_PREFIX="storage"
    export CLOSURE_WAIT_SECONDS=5
    ;;
  render)
    export GOTENBERG_URL="http://127.0.0.1:9"
    export COPY_SCHEMA="copy_render"
    export S3_BUCKET="${S3_BUCKET}-render"
    export SEARCH_INDEX_PREFIX="render"
    ;;
  search)
    export MEILISEARCH_URL="http://127.0.0.1:9"
    export COPY_SCHEMA="copy_search"
    export S3_BUCKET="${S3_BUCKET}-search"
    export SEARCH_INDEX_PREFIX="search"
    export CLOSURE_WAIT_SECONDS=5
    ;;
  short)
    export COPY_SCHEMA="copy_short"
    export S3_BUCKET="${S3_BUCKET}-short"
    export SEARCH_INDEX_PREFIX="short"
    export CLIENT_PAGE_SECONDS=20
    export REMINDER_AFTER_SECONDS=10
    export ENQUIRY_RATE_WINDOW_SECONDS=30
    export FILE_RATE_WINDOW_SECONDS=30
    export STOCK_CACHE_SECONDS=10
    export CLOSURE_WAIT_SECONDS=20
    ;;
  session)
    export COPY_SCHEMA="copy_session"
    export S3_BUCKET="${S3_BUCKET}-session"
    export SEARCH_INDEX_PREFIX="session"
    export SESSION_SECONDS=20
    ;;
  spare)
    export COPY_SCHEMA="copy_spare"
    export S3_BUCKET="${S3_BUCKET}-spare"
    export SEARCH_INDEX_PREFIX="spare"
    ;;
  *)
    echo "unknown copy $COPY"
    exit 2
    ;;
esac

node scripts/make-db.mjs "$DATABASE_URL" "$COPY_SCHEMA"
case "$DATABASE_URL" in
  *\?*) export DATABASE_URL="$DATABASE_URL&options=-c%20search_path%3D$COPY_SCHEMA" ;;
  *)    export DATABASE_URL="$DATABASE_URL?options=-c%20search_path%3D$COPY_SCHEMA" ;;
esac
node dist/server/index.js > "/tmp/copy-$COPY.log" 2>&1 &

for i in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "$COPY up on $PORT"
    exit 0
  fi
  sleep 1
done
echo "$COPY failed to start"
tail -20 "/tmp/copy-$COPY.log"
exit 1
