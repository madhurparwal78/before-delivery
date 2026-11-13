#!/usr/bin/env bash
# Starts a second copy of the app with dead service URLs and checks the
# published outage behaviour.
set -u
cd /app
J='Content-Type: application/json'
JAR=/tmp/desk-outage
say() { printf '\n== %s\n' "$1"; }

APP_PUBLIC_PORT=4273 \
GIT_HOST_URL=http://127.0.0.1:9 \
AI_ENGINE_URL=http://127.0.0.1:9 \
SVIX_URL=http://127.0.0.1:9 \
S3_ENDPOINT=http://127.0.0.1:9 \
  ./bin/interline-desk > /tmp/desk-outage.log 2>&1 &

sleep 4
BASE=http://localhost:4273
P="$BASE/api/projects/larkspur-rider"

say "health with every service down"
curl -s "$BASE/api/health"

curl -s -c "$JAR" -X POST "$BASE/api/session" -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

say "integrations"
curl -s -b "$JAR" "$BASE/api/integrations"

say "drafting stops with ai_engine_unavailable"
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fcheckout-redesign/drafts" -H "$J" -d '{"language":"ja"}'

say "webhook endpoint save is 503"
curl -s -b "$JAR" -X PUT "$P/webhook" -H "$J" -d '{"url":"https://ci.example.test/hooks/down"}'

say "import is storage_unavailable"
printf 'source,target,target_language\nShipping,Versand,de\n' > /tmp/outage.csv
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/outage.csv;type=text/csv'

say "publish fails with git_host_unavailable"
PUB=$(curl -s -b "$JAR" -X POST "$P/publishes" -H "$J" -H 'Idempotency-Key: outage-1' -d '{"branch":"main"}')
PUBID=$(echo "$PUB" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
for i in $(seq 1 20); do
  STATE=$(curl -s -b "$JAR" "$P/publishes/$PUBID" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["state"], d["failure_reason"])')
  case "$STATE" in
    failed*) break ;;
  esac
  sleep 2
done
echo "$STATE"

say "the first instance still works"
curl -s http://localhost:4173/api/health

for p in /proc/[0-9]*; do
  if grep -qa 'APP_PUBLIC_PORT' /proc/self/environ 2>/dev/null; then break; fi
done
PID=$(grep -l . /dev/null 2>/dev/null; echo)
for p in /proc/[0-9]*; do
  if grep -qa bin/interline-desk $p/cmdline 2>/dev/null; then
    if grep -qa 'APP_PUBLIC_PORT=4273' $p/environ 2>/dev/null; then
      kill ${p#/proc/}
    fi
  fi
done
echo
