#!/usr/bin/env bash
set -u
S=$(date +%s)
export S
BASE=${BASE:-http://localhost:4173}
J='Content-Type: application/json'
SEED=$(curl -s -X POST "$BASE/api/grading/seed" -H "$J" -H "X-Grading-Key: grade-7f3c" -d "{\"users\":[{\"email\":\"guard@example.test\",\"password\":\"jarful-pass\",\"name\":\"Gus Ard\"}],\"projects\":[{\"name\":\"Guard $S\",\"owner\":\"guard@example.test\",\"collections\":[{\"name\":\"big\",\"documents\":[]}]}]}")
PID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Guard ' + __import__('os').environ['S']]['id'])" "$SEED")
BIG=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Guard ' + __import__('os').environ['S']]['collections']['big']['id'])" "$SEED")
B="$BASE/api/projects/$PID/collections/$BIG"
curl -s -c /tmp/g.jar -X POST "$BASE/api/auth/signin" -H "$J" -d '{"email":"guard@example.test","password":"jarful-pass"}' > /dev/null
python3 -c "
import sys
for i in range(1, 41): sys.stdout.write('{\"n\":%d,\"g\":\"%s\"}\n' % (i, 'abcd'[i % 4]))" > /tmp/many.jsonl
for r in $(seq 1 10); do
  curl -s -b /tmp/g.jar -X POST "$B/imports?format=jsonl" -H 'X-File-Name: many.jsonl' --data-binary @/tmp/many.jsonl > /dev/null
done
echo -n "count: "; curl -s -b /tmp/g.jar "$B" | python3 -c "import json,sys;print(json.load(sys.stdin)['count'])"
echo -n "empty query: "; curl -s -b /tmp/g.jar -X POST "$B/query" -H "$J" -d '{}' | head -c 150; echo
echo -n "pipeline: "; curl -s -b /tmp/g.jar -X POST "$B/aggregate" -H "$J" -d '{"pipeline":[{"$match":{}}],"preview":true}' | head -c 150; echo
echo -n "export: "; curl -s -b /tmp/g.jar -X POST "$B/exports" -H "$J" -d '{"format":"jsonl","filter":{}}' | head -c 150; echo
curl -s -b /tmp/g.jar -X POST "$B/indexes" -H "$J" -d '{"keys":{"g":1}}' > /dev/null
echo -n "with index: "; curl -s -b /tmp/g.jar -X POST "$B/query" -H "$J" -d '{"filter":{"g":"a"}}' | python3 -c "
import json,sys;a=json.load(sys.stdin);print(a.get('error') or (a['matched'], a['plan']))"
echo -n "import over line limit: "; python3 -c "
import sys
for i in range(45): sys.stdout.write('{\"n\":%d}\n' % i)" > /tmp/over.jsonl
curl -s -b /tmp/g.jar -X POST "$B/imports?format=jsonl" -H 'X-File-Name: over.jsonl' --data-binary @/tmp/over.jsonl; echo
