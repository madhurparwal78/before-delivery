#!/usr/bin/env bash
# Checks imports, drafting, review, publish and restore against the local stack.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
P="$BASE/api/projects/larkspur-rider"
say() { printf '\n== %s\n' "$1"; }

curl -s -c "$JAR" -X POST "$BASE/api/session" -H 'Content-Type: application/json' \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

printf 'source,target,target_language,note\n' > /tmp/legacy.csv
printf 'Remove,Entfernen,de,seen\n' >> /tmp/legacy.csv
printf 'Checkout,Kasse,de,\n' >> /tmp/legacy.csv
printf '"total:   %%s","Summe: %%s",de,\n' >> /tmp/legacy.csv
printf 'Garage,Garaje,xx,\n' >> /tmp/legacy.csv
printf ',Etwas,de,\n' >> /tmp/legacy.csv
printf 'Shipping,,de,\n' >> /tmp/legacy.csv
printf 'Shipping,Versand,de,\n' >> /tmp/legacy.csv
printf 'Not a key here,Blah,fr,\n' >> /tmp/legacy.csv
printf 'Checkout,Kassa,de,\n' >> /tmp/legacy.csv

say "import csv"
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F "file=@/tmp/legacy.csv;type=text/csv"

say "import same file again"
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F "file=@/tmp/legacy.csv;type=text/csv"

say "download original identical?"
IMPORT_ID=$(curl -s -b "$JAR" "$P/tm/imports" | python3 -c 'import sys,json;print(json.load(sys.stdin)["imports"][-1]["import_id"])')
curl -s -b "$JAR" "$P/tm/imports/$IMPORT_ID/original" > /tmp/legacy.back
cmp /tmp/legacy.csv /tmp/legacy.back && echo "byte for byte identical"

say "operations"
curl -s -b "$JAR" "$P/operations"

say "restore newest import"
OP=$(curl -s -b "$JAR" "$P/operations" | python3 -c 'import sys,json;print(json.load(sys.stdin)["operations"][0]["id"])')
curl -s -b "$JAR" -X POST "$P/operations/$OP/restore" -H 'Content-Type: application/json' -d '{}'

say "restore again (already_restored)"
curl -s -b "$JAR" -X POST "$P/operations/$OP/restore" -H 'Content-Type: application/json' -d '{}'

say "tm total after restore"
curl -s -b "$JAR" "$P/tm" | python3 -c 'import sys,json;print(json.load(sys.stdin)["total"])'

say "draft japanese on main"
curl -s -b "$JAR" -X POST "$P/branches/main/drafts" -H 'Content-Type: application/json' -d '{"language":"ja"}'

say "stats after drafting"
curl -s -b "$JAR" "$BASE/api/workspace/stats"

say "webhook endpoint"
curl -s -b "$JAR" -X PUT "$P/webhook" -H 'Content-Type: application/json' -d '{"url":"https://ci.example.test/hooks/interline"}'

say "token + ci pull"
TOKEN=$(curl -s -b "$JAR" -X POST "$P/tokens" -H 'Content-Type: application/json' -d '{"label":"ci"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/ci/projects/larkspur-rider/locales/de.json" | head -c 300

say "publish main"
PUB=$(curl -s -b "$JAR" -X POST "$P/publishes" -H 'Content-Type: application/json' -H 'Idempotency-Key: pub-1' -d '{"branch":"main"}')
echo "$PUB"
PUBID=$(echo "$PUB" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
say "replay same key"
curl -s -b "$JAR" -X POST "$P/publishes" -H 'Content-Type: application/json' -H 'Idempotency-Key: pub-1' -d '{"branch":"main"}' | head -c 200
say "second publish while running"
curl -s -b "$JAR" -X POST "$P/publishes" -H 'Content-Type: application/json' -H 'Idempotency-Key: pub-2' -d '{"branch":"main"}' | head -c 200
sleep 6
say "publish state"
curl -s -b "$JAR" "$P/publishes/$PUBID"
say "events"
curl -s -b "$JAR" "$P/events"
echo
