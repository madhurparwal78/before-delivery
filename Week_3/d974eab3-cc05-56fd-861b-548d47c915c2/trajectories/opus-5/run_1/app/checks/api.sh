#!/usr/bin/env bash
# Run with the site serving on 127.0.0.1:4173 and GRADING_KEY set.
# Developer check of the published API contract. Not shipped.
set -u
B=http://127.0.0.1:4173
K=${GRADING_KEY}
pass=0
fail=0

check() {
  local label="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$label"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       want: %s\n       got:  %s\n' "$label" "$want" "$got"
  fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }

check 'health' '200' "$(status $B/api/health)"
check 'health body' '{"status":"ok"}' "$(body $B/api/health)"
check 'content status' '200' "$(status $B/api/content)"
check 'content type' 'application/json; charset=utf-8' \
  "$(curl -s -o /dev/null -D - $B/api/content | grep -i '^content-type' | sed 's/^[^:]*: //' | tr -d '\r')"
check 'edition' '1' "$(body $B/api/content | python3 -c 'import sys,json;print(json.load(sys.stdin)["edition"])')"
check 'content keys' "['edition', 'product', 'interviews', 'scenarios']" \
  "$(body $B/api/content | python3 -c 'import sys,json;print(list(json.load(sys.stdin).keys()))')"
check 'interview summary keys' "['slug', 'name', 'role', 'category', 'lede', 'hue']" \
  "$(body $B/api/content | python3 -c 'import sys,json;print(list(json.load(sys.stdin)["interviews"][0].keys()))')"
check 'scenario order' 'on-work,on-sports,on-hobby,on-housework,off-break,off-holiday,off-relax,off-rest' \
  "$(body $B/api/content | python3 -c 'import sys,json;print(",".join(s["id"] for s in json.load(sys.stdin)["scenarios"]))')"
check 'scenario summary keys' "['id', 'mode', 'name']" \
  "$(body $B/api/content | python3 -c 'import sys,json;print(list(json.load(sys.stdin)["scenarios"][0].keys()))')"

check 'interview ok' '200' "$(status $B/api/interviews/mina-okabe)"
check 'interview keys' "['slug', 'name', 'role', 'category', 'lede', 'hue', 'answers', 'previous', 'next']" \
  "$(body $B/api/interviews/mina-okabe | python3 -c 'import sys,json;print(list(json.load(sys.stdin).keys()))')"
check 'first has no previous' 'None' \
  "$(body $B/api/interviews/mina-okabe | python3 -c 'import sys,json;print(json.load(sys.stdin)["previous"])')"
check 'last has no next' 'None' \
  "$(body $B/api/interviews/tom-achebe | python3 -c 'import sys,json;print(json.load(sys.stdin)["next"])')"
check 'interview neighbour' "{'slug': 'daniel-reyes', 'name': 'Daniel Reyes'}" \
  "$(body $B/api/interviews/mina-okabe | python3 -c 'import sys,json;print(json.load(sys.stdin)["next"])')"
check 'unknown interview status' '404' "$(status $B/api/interviews/nobody)"
check 'unknown interview body' '{"error":"not_found","message":"This interview does not exist."}' \
  "$(body $B/api/interviews/nobody)"

check 'scenario ok' '200' "$(status $B/api/scenarios/off-rest)"
check 'scenario body' '{"id":"off-rest","mode":"off","name":"Rest","title":"Lights out","time":"23:00","copy":"The day put away, the room dark and cool.","moment":"Nothing at all. Rest is part of the pace."}' \
  "$(body $B/api/scenarios/off-rest)"
check 'unknown scenario' '{"error":"not_found","message":"This scenario does not exist."}' \
  "$(body $B/api/scenarios/off-nap)"

check 'sheet status' '200' "$(status $B/api/product/sheet)"
check 'sheet disposition' 'attachment; filename="vireo-pace-product-sheet.pdf"' \
  "$(curl -s -o /dev/null -D - $B/api/product/sheet | grep -i '^content-disposition' | sed 's/^[^:]*: //' | tr -d '\r')"
check 'sheet content type' 'application/pdf' \
  "$(curl -s -o /dev/null -D - $B/api/product/sheet | grep -i '^content-type' | sed 's/^[^:]*: //' | tr -d '\r')"

check 'unknown api path' '{"error":"not_found","message":"Not found."}' "$(body $B/api/nope)"
check 'unknown api status' '404' "$(status $B/api/nope)"
check 'wrong method on content' '404' "$(status -X POST $B/api/content)"
check 'grading without key' '404' "$(status -X DELETE $B/api/grading/content)"
check 'grading wrong key' '{"error":"not_found","message":"Not found."}' \
  "$(body -X DELETE -H 'X-Grading-Key: wrong' $B/api/grading/content)"
check 'grading method not listed' '404' "$(status -H "X-Grading-Key: $K" $B/api/grading/content)"
check 'grading delete' '{"edition":1}' \
  "$(body -X DELETE -H "X-Grading-Key: $K" $B/api/grading/content)"


check 'cors absent' '' \
  "$(curl -s -o /dev/null -D - $B/api/content | grep -i 'access-control' | tr -d '\r')"

# body limit: exactly 262144 bytes is accepted (and then fails the shape)
python3 -c "
import sys
pad = 'x' * (262144 - 10)
sys.stdout.write('{\"pad\":\"' + pad + '\"}')" > /tmp/exact.json
check 'exact limit is a shape error' '{"error":"invalid","message":"The content does not match the published shape."}' \
  "$(curl -s -X PUT -H "X-Grading-Key: $K" -H 'content-type: application/json' --data-binary @/tmp/exact.json $B/api/grading/content)"
check 'exact limit size' '262144' "$(wc -c < /tmp/exact.json | tr -d ' ')"

python3 -c "
import sys
pad = 'x' * (262145 - 10)
sys.stdout.write('{\"pad\":\"' + pad + '\"}')" > /tmp/over.json
check 'over limit' '{"error":"too_large","message":"The request body is too large."}' \
  "$(curl -s -X PUT -H "X-Grading-Key: $K" -H 'content-type: application/json' --data-binary @/tmp/over.json $B/api/grading/content)"
check 'over limit status' '413' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "X-Grading-Key: $K" -H 'content-type: application/json' --data-binary @/tmp/over.json $B/api/grading/content)"
check 'over limit without key is 404' '404' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: application/json' --data-binary @/tmp/over.json $B/api/grading/content)"
check 'not json' '{"error":"invalid","message":"The content does not match the published shape."}' \
  "$(body -X PUT -H "X-Grading-Key: $K" --data-binary 'not json' $B/api/grading/content)"

# pages
for path in / /store /contact /privacy /legal /interviews/mina-okabe; do
  check "page $path" '200' "$(status $B$path)"
done
check 'page /interviews/nobody' '404' "$(status $B/interviews/nobody)"
check 'page /nope' '404' "$(status $B/nope)"
check 'package.json is hidden' '404' "$(status $B/package.json)"
check 'run.json is hidden' '404' "$(status $B/run.json)"
check 'source is hidden' '404' "$(status $B/src/server/main.ts)"
check 'env is hidden' '404' "$(status $B/.env)"
check 'traversal is hidden' '404' "$(status $B/assets/../../package.json)"
check 'assets served' '200' "$(status $B/assets/site.css)"
check 'client served' '200' "$(status $B/assets/client.js)"
check 'font served' '200' "$(status $B/assets/fonts/shippori-mincho-400-latin.woff2)"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
