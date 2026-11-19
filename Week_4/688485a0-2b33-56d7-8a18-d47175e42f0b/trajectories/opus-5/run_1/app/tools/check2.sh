#!/usr/bin/env bash
set -u
S=$(date +%s)
export S
BASE=${BASE:-http://localhost:4173}
KEY=${GRADING_KEY:-grade-7f3c}
J='Content-Type: application/json'

SEED=$(curl -s -X POST "$BASE/api/grading/seed" -H "$J" -H "X-Grading-Key: $KEY" -d "{
  \"users\":[{\"email\":\"owner2@example.test\",\"password\":\"jarful-pass\",\"name\":\"Owen Reed\"},
           {\"email\":\"editor2@example.test\",\"password\":\"jarful-pass\",\"name\":\"Edie Torr\"},
           {\"email\":\"reader2@example.test\",\"password\":\"jarful-pass\",\"name\":\"Reed Ames\"}],
  \"projects\":[{\"name\":\"Files $S\",\"owner\":\"owner2@example.test\",
    \"members\":[{\"email\":\"editor2@example.test\",\"role\":\"editor\"},{\"email\":\"reader2@example.test\",\"role\":\"reader\"}],
    \"collections\":[{\"name\":\"stock\",\"documents\":[{\"_id\":\"a00000000000000000000001\",\"sku\":\"A\",\"qty\":1}]},
                   {\"name\":\"big\",\"documents\":[]}]}]}")
PID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Files ' + __import__('os').environ['S']]['id'])" "$SEED")
CID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Files ' + __import__('os').environ['S']]['collections']['stock']['id'])" "$SEED")
BIG=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Files ' + __import__('os').environ['S']]['collections']['big']['id'])" "$SEED")
C="$BASE/api/projects/$PID/collections/$CID"
B="$BASE/api/projects/$PID/collections/$BIG"
curl -s -c /tmp/o.jar -X POST "$BASE/api/auth/signin" -H "$J" -d '{"email":"owner2@example.test","password":"jarful-pass"}' > /dev/null
curl -s -c /tmp/e.jar -X POST "$BASE/api/auth/signin" -H "$J" -d '{"email":"editor2@example.test","password":"jarful-pass"}' > /dev/null
curl -s -c /tmp/r.jar -X POST "$BASE/api/auth/signin" -H "$J" -d '{"email":"reader2@example.test","password":"jarful-pass"}' > /dev/null

echo "== jsonl import with bad lines =="
printf '{"sku":"B","qty":2}\n\nnot json\n[1,2]\n{"sku":"C","$bad":1}\n{"sku":"D","deep":{"a":{"b":{"c":{"d":{"e":1}}}}}}\n' > /tmp/bad.jsonl
curl -s -b /tmp/e.jar -X POST "$C/imports?format=jsonl" -H 'X-File-Name: bad.jsonl' --data-binary @/tmp/bad.jsonl; echo
echo "   count after refused import:"
curl -s -b /tmp/e.jar "$C" | python3 -c "import json,sys;print(json.load(sys.stdin)['count'])"

echo "== jsonl import clean =="
printf '{"sku":"B","qty":2}\n{"sku":"C","qty":3}\n' > /tmp/good.jsonl
IMP=$(curl -s -b /tmp/e.jar -X POST "$C/imports?format=jsonl" -H 'X-File-Name: good.jsonl' --data-binary @/tmp/good.jsonl)
echo "$IMP"
IID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['import_id'])" "$IMP")
echo "== original download byte for byte =="
curl -s -b /tmp/e.jar "$C/imports/$IID/original" -D /tmp/h.txt -o /tmp/back.jsonl
grep -i 'content-disposition\|content-type' /tmp/h.txt
cmp /tmp/good.jsonl /tmp/back.jsonl && echo "   identical"

echo "== csv import =="
printf 'sku,size.w,size.h,when,ok\nE,2,3,2026-01-02T03:04:05Z,true\n"F,1",4,5,,false\n' > /tmp/in.csv
curl -s -b /tmp/e.jar -X POST "$C/imports?format=csv" -H 'X-File-Name: in.csv' --data-binary @/tmp/in.csv; echo
curl -s -b /tmp/e.jar -X POST "$C/query" -H "$J" -d '{"filter":{"sku":{"$in":["E","F,1"]}}}' | python3 -m json.tool --compact

echo "== csv header problems =="
printf 'a,a\n1,2\n' > /tmp/dup.csv
curl -s -b /tmp/e.jar -X POST "$C/imports?format=csv" -H 'X-File-Name: dup.csv' --data-binary @/tmp/dup.csv; echo
printf 'a,a.b\n1,2\n' > /tmp/con.csv
curl -s -b /tmp/e.jar -X POST "$C/imports?format=csv" -H 'X-File-Name: con.csv' --data-binary @/tmp/con.csv; echo
printf 'a,b\n1\n' > /tmp/cells.csv
curl -s -b /tmp/e.jar -X POST "$C/imports?format=csv" -H 'X-File-Name: cells.csv' --data-binary @/tmp/cells.csv; echo

echo "== exports =="
EXP=$(curl -s -b /tmp/r.jar -X POST "$C/exports" -H "$J" -d '{"format":"csv","filter":{},"sort":{"sku":1}}')
echo "$EXP"
URL=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['download_url'])" "$EXP")
curl -s -b /tmp/r.jar "$BASE$URL" -D /tmp/h2.txt | head -5
grep -i 'content-disposition' /tmp/h2.txt
EXP2=$(curl -s -b /tmp/r.jar -X POST "$C/exports" -H "$J" -d '{"format":"jsonl","filter":{"sku":"B"}}')
curl -s -b /tmp/r.jar "$BASE$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['download_url'])" "$EXP2")"

echo "== formula guard =="
curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"=cmd()","n":-5,"t":"-7x"}}' > /dev/null
EXP3=$(curl -s -b /tmp/e.jar -X POST "$C/exports" -H "$J" -d '{"format":"csv","filter":{"sku":"=cmd()"}}')
curl -s -b /tmp/e.jar "$BASE$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['download_url'])" "$EXP3")"

echo "== roles =="
echo -n "reader insert: "; curl -s -b /tmp/r.jar -X POST "$C/documents" -H "$J" -d '{"document":{"x":1}}'; echo
echo -n "editor index: "; curl -s -b /tmp/e.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"sku":1}}'; echo
echo -n "editor validator: "; curl -s -b /tmp/e.jar -X PUT "$C/validator" -H "$J" -d '{"validator":null}'; echo
echo -n "outsider project: "; curl -s -b /tmp/r.jar "$BASE/api/projects/00000000-0000-4000-8000-000000000000"; echo
echo -n "no cookie: "; curl -s "$C"; echo

echo "== validator =="
curl -s -b /tmp/o.jar -X PUT "$C/validator" -H "$J" -d '{"validator":{"required":["sku","qty"],"properties":{"qty":{"bsonType":"int","minimum":1,"maximum":9},"sku":{"bsonType":"string"}}}}'; echo
echo -n "missing required: "; curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"Z"}}'; echo
echo -n "bad type: "; curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"Z","qty":2.5}}'; echo
echo -n "too small: "; curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"Z","qty":0}}'; echo
echo -n "too big: "; curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"Z","qty":20}}'; echo
echo -n "ok: "; curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"_id":"a0000000000000000000000f","sku":"Z","qty":2}}'; echo
curl -s -b /tmp/o.jar -X PUT "$C/validator" -H "$J" -d '{"validator":null}' > /dev/null

echo "== versions =="
echo -n "stale save: "; curl -s -b /tmp/e.jar -X PUT "$C/documents/a0000000000000000000000f" -H "$J" -d '{"document":{"sku":"Z","qty":3},"version":7}'; echo
echo -n "good save: "; curl -s -b /tmp/e.jar -X PUT "$C/documents/a0000000000000000000000f" -H "$J" -d '{"document":{"sku":"Z","qty":3},"version":1}'; echo
echo -n "id mismatch: "; curl -s -b /tmp/e.jar -X PUT "$C/documents/a0000000000000000000000f" -H "$J" -d '{"document":{"_id":"a00000000000000000000001","sku":"Z"},"version":2}'; echo
echo -n "missing version: "; curl -s -b /tmp/e.jar -X PUT "$C/documents/a0000000000000000000000f" -H "$J" -d '{"document":{"sku":"Z"}}'; echo

echo "== scan guard =="
python3 - <<'PY' > /tmp/many.jsonl
for i in range(1, 41):
    print('{"n":%d,"g":"%s"}' % (i, "abcd"[i %% 4]))
PY
for round in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -b /tmp/e.jar -X POST "$B/imports?format=jsonl" -H 'X-File-Name: many.jsonl' --data-binary @/tmp/many.jsonl > /dev/null
done
echo -n "count: "; curl -s -b /tmp/e.jar "$B" | python3 -c "import json,sys;print(json.load(sys.stdin)['count'])"
echo -n "empty query: "; curl -s -b /tmp/e.jar -X POST "$B/query" -H "$J" -d '{}' | head -c 120; echo
echo -n "pipeline: "; curl -s -b /tmp/e.jar -X POST "$B/aggregate" -H "$J" -d '{"pipeline":[{"$match":{}}],"preview":true}' | head -c 120; echo
echo -n "deep query: "; curl -s -b /tmp/e.jar -X POST "$C/query" -H "$J" -d "{\"filter\":$(python3 -c "print('{\"a\":'*34 + '1' + '}'*34)")}"; echo
echo -n "too many stages: "; curl -s -b /tmp/e.jar -X POST "$C/aggregate" -H "$J" -d "{\"pipeline\":[$(python3 -c "print(','.join(['{\"\$match\":{}}']*9))")],\"preview\":true}"; echo
echo -n "unknown stage: "; curl -s -b /tmp/e.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$match":{}},{"$bogus":1}],"preview":true}'; echo
echo -n "invalid stage: "; curl -s -b /tmp/e.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$sort":{"a":2}}],"preview":true}'; echo

echo "== boundary =="
echo -n "wrong content type: "; curl -s -X POST "$BASE/api/auth/signin" -H 'Content-Type: text/plain' -d 'x'; echo
echo -n "too large: "; python3 -c "print('{\"a\":\"' + 'x'*1000100 + '\"}')" > /tmp/huge.json; curl -s -b /tmp/e.jar -X POST "$C/query" -H "$J" --data-binary @/tmp/huge.json; echo
echo -n "package.json: "; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/package.json"
echo -n "src file: "; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/src/server/index.ts"
echo -n "run.json: "; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/run.json"
echo -n "grading without key: "; curl -s -X POST "$BASE/api/grading/seed" -H "$J" -d '{}'; echo

echo "== events =="
(curl -s -N --max-time 3 -b /tmp/e.jar "$C/events?after=0" > /tmp/sse.txt &)
sleep 1
curl -s -b /tmp/e.jar -X POST "$C/documents" -H "$J" -d '{"document":{"_id":"a0000000000000000000001a","sku":"SSE"}}' > /dev/null
sleep 2
head -6 /tmp/sse.txt
echo "   events received: $(grep -c '^event: change' /tmp/sse.txt)"
