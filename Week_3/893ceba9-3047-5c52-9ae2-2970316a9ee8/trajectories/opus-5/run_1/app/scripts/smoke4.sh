#!/usr/bin/env bash
# Checks the server boundary, the error precedence and the segment state rules.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
P="$BASE/api/projects/larkspur-rider"
J='Content-Type: application/json'
say() { printf '\n== %s\n' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

curl -s -c "$JAR" -X POST "$BASE/api/session" -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

say "unknown api path"
curl -s "$BASE/api/nothing"

say "unauthenticated owner endpoint"
curl -s "$BASE/api/workspace/stats"

say "unknown project is 404 before 403"
curl -s -b "$JAR" "$BASE/api/projects/missing/branches"

say "wrong content type is 415"
curl -s -b "$JAR" -X POST "$P/branches" -H 'Content-Type: text/plain' -d 'name=x'

say "upload endpoint with json body is 415"
curl -s -b "$JAR" -X POST "$P/tm/imports" -H "$J" -d '{}'

say "oversized json body is 413"
python3 -c "print('{\"name\":\"' + 'a'*1000001 + '\"}')" > /tmp/big.json
curl -s -b "$JAR" -X POST "$P/branches" -H "$J" --data-binary @/tmp/big.json

say "exactly 1,000,000 bytes is allowed (validation, not 413)"
python3 - <<'PY' > /tmp/exact.json
pad = 'a' * (1000000 - len('{"name":""}'))
open('/tmp/exact.json', 'w').write('{"name":"%s"}' % pad)
PY
wc -c < /tmp/exact.json
curl -s -b "$JAR" -X POST "$P/branches" -H "$J" --data-binary @/tmp/exact.json | head -c 150

say "oversized upload is 413"
python3 -c "open('/tmp/big.csv','w').write('source,target,target_language\n' + 'a,b,de\n'*900000)"
wc -c < /tmp/big.csv
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/big.csv;type=text/csv'

say "publish without idempotency key is 422 on the header"
curl -s -b "$JAR" -X POST "$P/publishes" -H "$J" -d '{"branch":"main"}'

say "idempotency key reused with a different body"
curl -s -b "$JAR" -X POST "$P/publishes" -H "$J" -H 'Idempotency-Key: k1' -d '{"branch":"main"}' > /dev/null
sleep 8
curl -s -b "$JAR" -X POST "$P/publishes" -H "$J" -H 'Idempotency-Key: k1' \
  -d '{"branch":"feature/checkout-redesign"}'

say "never served: sources, manifest, lockfiles, dot dirs"
for path in /main.go /run.json /package.json /go.mod /web/src/main.ts /.git/config /assets/app.js.map; do
  printf '%s -> %s\n' "$path" "$(code "$BASE$path")"
done

say "no CORS headers"
curl -s -D - -o /dev/null "$BASE/api/health" -H 'Origin: https://elsewhere.test' | grep -i 'access-control' || echo "none"

say "approving an untranslated segment is illegal"
SEG=$(curl -s -b "$JAR" "$P/branches/main/keys?lang=de" | python3 -c '
import sys,json
for k in json.load(sys.stdin)["keys"]:
    t = k["translations"]["de"]
    if t["status"] == "untranslated":
        print(t["segment_id"]); break')
curl -s -b "$JAR" -X POST "$BASE/api/segments/$SEG/approve" -H "$J" -d '{}'

say "scoring an untranslated segment is illegal"
curl -s -b "$JAR" -X POST "$BASE/api/segments/$SEG/score" -H "$J" -d '{"issues":[]}'

say "correcting a scored segment is illegal"
APPROVED=$(curl -s -b "$JAR" "$P/branches/main/keys?lang=de" | python3 -c '
import sys,json
for k in json.load(sys.stdin)["keys"]:
    t = k["translations"]["de"]
    if t["status"] == "approved":
        print(t["segment_id"]); break')
curl -s -b "$JAR" -X POST "$BASE/api/segments/$APPROVED/correct" -H "$J" -d '{"value":"Neu"}'

say "main cannot transition"
curl -s -b "$JAR" -X POST "$P/branches/main/transitions" -H "$J" -d '{"to":"in_review"}'

say "branch limit"
for n in 1 2 3 4 5 6; do
  curl -s -b "$JAR" -X POST "$P/branches" -H "$J" -d "{\"name\":\"limit/$n\"}" | head -c 90
  echo
done

say "audit csv neutralises formulas"
curl -s -b "$JAR" "$BASE/api/audit.csv" | head -3 | od -c | head -5

say "ci token of another project"
TOKEN=$(curl -s -b "$JAR" -X POST "$P/tokens" -H "$J" -d '{"label":"ci2"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
printf 'own project: %s\n' "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/ci/projects/larkspur-rider/locales/de.json")"
printf 'other project: %s\n' "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/ci/projects/other/locales/de.json")"
printf 'unknown language: %s\n' "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/ci/projects/larkspur-rider/locales/zz.json")"
printf 'session cookie instead of token: %s\n' "$(code -b "$JAR" "$BASE/api/ci/projects/larkspur-rider/locales/de.json")"
printf 'token on a normal endpoint: %s\n' "$(code -H "Authorization: Bearer $TOKEN" "$P/branches")"
echo
