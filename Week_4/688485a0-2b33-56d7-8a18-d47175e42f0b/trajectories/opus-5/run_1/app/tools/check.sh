#!/usr/bin/env bash
set -u
S=$(date +%s)
export S
BASE=${BASE:-http://localhost:4173}
KEY=${GRADING_KEY:-grade-7f3c}
J='Content-Type: application/json'

echo "== seed =="
cat > /tmp/seed.json <<'EOF'
{
  "users": [
    {"email": "ada@example.test", "password": "jarful-pass", "name": "Ada Birch"},
    {"email": "ben@example.test", "password": "jarful-pass", "name": "Ben Clay"},
    {"email": "cleo@example.test", "password": "jarful-pass", "name": "Cleo Dune"}
  ],
  "projects": [
    {
      "name": "Catalogue",
      "owner": "ada@example.test",
      "members": [{"email": "ben@example.test", "role": "editor"}, {"email": "cleo@example.test", "role": "reader"}],
      "collections": [
        {
          "name": "pots",
          "documents": [
            {"_id": "e00000000000000000000001", "sku": "POT-1", "price": 12, "tags": ["red", "blue"], "items": [{"sku": "S1", "qty": 2}, {"sku": "S2", "qty": 5}], "note": null},
            {"_id": "e00000000000000000000002", "sku": "POT-2", "price": 7.5, "tags": ["green"], "items": [{"sku": "S2", "qty": 1}]},
            {"_id": "e00000000000000000000003", "sku": "POT-3", "price": "12", "tags": [], "items": [], "note": "chipped"},
            {"_id": "e00000000000000000000004", "sku": "POT-4", "price": 20, "tags": ["red"], "items": [{"sku": "S3", "qty": 5}, {"sku": "S1", "qty": 9}], "made": {"$date": "2026-03-01T00:00:00Z"}}
          ],
          "indexes": [],
          "validator": null,
          "saved_queries": [{"name": "Cheap pots", "filter": {"price": {"$lt": 13}}, "projection": null, "sort": null, "limit": 0}]
        },
        {
          "name": "mixed",
          "documents": [
            {"_id": "b00000000000000000000001"},
            {"_id": "b00000000000000000000002", "v": null},
            {"_id": "b00000000000000000000003", "v": 3},
            {"_id": "b00000000000000000000004", "v": "3"},
            {"_id": "b00000000000000000000005", "v": [5, 1]},
            {"_id": "b00000000000000000000006", "v": true},
            {"_id": "b00000000000000000000007", "v": {"$date": "2026-01-01T00:00:00Z"}},
            {"_id": "b00000000000000000000008", "v": {"a": 1}},
            {"_id": "b00000000000000000000009", "v": []}
          ]
        }
      ]
    }
  ]
}
EOF
sed -i "s/\"Catalogue\"/\"Catalogue $S\"/" /tmp/seed.json
SEED=$(curl -s -X POST "$BASE/api/grading/seed" -H "$J" -H "X-Grading-Key: $KEY" --data-binary @/tmp/seed.json)
echo "$SEED" | head -c 400; echo
PID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Catalogue ' + __import__('os').environ['S']]['id'])" "$SEED")
CID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Catalogue ' + __import__('os').environ['S']]['collections']['pots']['id'])" "$SEED")
MID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Catalogue ' + __import__('os').environ['S']]['collections']['mixed']['id'])" "$SEED")
echo "pid=$PID cid=$CID mid=$MID"

echo "== signin =="
curl -s -c /tmp/ada.jar -X POST "$BASE/api/auth/signin" -H "$J" -d '{"email":"ada@example.test","password":"jarful-pass"}'
echo

C="$BASE/api/projects/$PID/collections/$CID"
M="$BASE/api/projects/$PID/collections/$MID"

q() { curl -s -b /tmp/ada.jar -X POST "$C/query" -H "$J" -d "$1" | python3 -c "
import json,sys
a=json.load(sys.stdin)
if 'error' in a: print('  ERROR', a)
else: print('  ids', [i[-1] for i in a['ids']], 'matched', a['matched'], 'plan', a['plan']['kind'], a['plan']['index'], a['plan']['docs_examined'])
"; }

echo "== filters =="
for f in '{"price":12}' '{"price":{"$ne":12}}' '{"price":{"$gt":10}}' '{"price":{"$gte":12}}' '{"price":{"$lt":12}}' '{"price":{"$lte":7.5}}' \
  '{"sku":{"$in":["POT-1","POT-3"]}}' '{"tags":{"$nin":["red"]}}' '{"note":{"$exists":true}}' '{"note":{"$exists":false}}' \
  '{"note":null}' '{"note":{"$ne":null}}' '{"$and":[{"price":{"$gt":5}},{"tags":"red"}]}' '{"$or":[{"price":7.5},{"note":"chipped"}]}' \
  '{"$nor":[{"tags":"red"},{"price":7.5}]}' '{"price":{"$not":{"$gt":10}}}' '{"tags":{"$size":1}}' '{"tags":{"$size":0}}' \
  '{"tags":"red"}' '{"tags":["red","blue"]}' '{"tags":["blue","red"]}' '{"items.0.sku":"S2"}' '{"items.sku":"S1","items.qty":5}' \
  '{"items":{"$elemMatch":{"sku":"S1","qty":5}}}' '{"items":{"$elemMatch":{"sku":"S1","qty":{"$gt":5}}}}' \
  '{"items.qty":{"$gt":3,"$lt":4}}' '{"items":{"$elemMatch":{"qty":{"$gt":3,"$lt":4}}}}' \
  '{"made":{"$gte":{"$date":"2026-01-01T00:00:00Z"}}}' '{"$foo":1}' '{"price":{"$bogus":1}}'; do
  printf '%s\n' "$f"
  q "{\"filter\":$f}"
done

echo "== sort =="
for s in '{"v":1}' '{"v":-1}'; do
  printf '%s ' "$s"
  curl -s -b /tmp/ada.jar -X POST "$M/query" -H "$J" -d "{\"sort\":$s}" | python3 -c "
import json,sys;a=json.load(sys.stdin);print([i[-1] for i in a['ids']])"
done

echo "== projection =="
for p in '{"sku":1,"items.sku":1}' '{"sku":1,"_id":0}' '{"items":0,"tags":0,"note":0}' '{"sku":1,"price":0}'; do
  printf '%s => ' "$p"
  curl -s -b /tmp/ada.jar -X POST "$C/query" -H "$J" -d "{\"filter\":{\"_id\":\"e00000000000000000000001\"},\"projection\":$p}" \
    | python3 -c "
import json,sys;a=json.load(sys.stdin);print(a.get('error') or json.dumps(a['documents'][0]))"
done

echo "== aggregate group =="
curl -s -b /tmp/ada.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$group":{"_id":null,"total":{"$sum":"$price"},"avg":{"$avg":"$price"},"lo":{"$min":"$price"},"hi":{"$max":"$price"},"skus":{"$push":"$sku"},"first":{"$first":"$sku"},"last":{"$last":"$sku"},"n":{"$count":{}}}}],"preview":true}' \
 | python3 -c "
import json,sys;a=json.load(sys.stdin);print(json.dumps(a['stages'][0]['documents'][0]))"

echo "== aggregate unwind+group =="
curl -s -b /tmp/ada.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$unwind":"$tags"},{"$group":{"_id":"$tags","n":{"$count":{}}}}],"preview":true,"pin":"e00000000000000000000003"}' \
 | python3 -c "
import json,sys;a=json.load(sys.stdin);print('input',a['input']);print([ (s['index'],s['count']) for s in a['stages']]);print(json.dumps(a['stages'][1]['documents']));print('pin',a['pin'])"

echo "== project stage copy =="
curl -s -b /tmp/ada.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$project":{"sku":1,"first_item":"$items.0.sku"}}],"preview":true}' \
 | python3 -c "
import json,sys;a=json.load(sys.stdin);print(json.dumps(a['stages'][0]['documents'][0]))"

echo "== sort/limit/skip stages =="
curl -s -b /tmp/ada.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$sort":{"price":-1}},{"$limit":2},{"$skip":1}],"preview":true}' \
 | python3 -c "
import json,sys;a=json.load(sys.stdin)
print([[d['_id'][-1] for d in s['documents']] for s in a['stages']])"

echo "== schema =="
curl -s -b /tmp/ada.jar "$C/schema"; echo

echo "== indexes =="
curl -s -b /tmp/ada.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"sku":1},"unique":true}'; echo
curl -s -b /tmp/ada.jar "$C/indexes"; echo
q '{"filter":{"sku":"POT-1","price":12}}'
q '{"filter":{"price":12}}'
echo "== duplicate on insert =="
curl -s -b /tmp/ada.jar -X POST "$C/documents" -H "$J" -d '{"document":{"sku":"POT-1"}}'; echo
echo "== unique over duplicates =="
curl -s -b /tmp/ada.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"note":1},"unique":true,"name":"note_u"}'; echo
echo "== sample sieve =="
curl -s "$BASE/api/sample/sieve" | python3 -c "
import json,sys;a=json.load(sys.stdin);print('input',a['input'],[s['count'] for s in a['stages']])"
