#!/usr/bin/env bash
# Checks review.completed events, exact restore and the concurrency rules.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
P="$BASE/api/projects/larkspur-rider"
J='Content-Type: application/json'
say() { printf '\n== %s\n' "$1"; }
pj() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

curl -s -c "$JAR" -X POST "$BASE/api/session" -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

say "register a webhook endpoint"
curl -s -b "$JAR" -X PUT "$P/webhook" -H "$J" -d '{"url":"https://ci.example.test/hooks/interline"}' | head -c 120

say "invite a reviewer and assign the seeded japanese review"
INVITE=$(curl -s -b "$JAR" -X POST "$P/reviewers" -H "$J" \
  -d "{\"name\":\"Mira Solberg\",\"email\":\"mira$(date +%s)@example.test\"}")
RID=$(echo "$INVITE" | pj 'd["id"]')
RKEY=$(echo "$INVITE" | pj 'd["access_key"]')
REMAIL=$(echo "$INVITE" | pj 'd["email"]')
ASSIGN=$(curl -s -b "$JAR" -X POST "$P/assignments" -H "$J" \
  -d "{\"reviewer_id\":\"$RID\",\"branch\":\"main\",\"language\":\"ja\"}")
AID=$(echo "$ASSIGN" | pj 'd["id"]')
echo "assignment $AID holds $(echo "$ASSIGN" | pj 'len(d["segment_ids"])') segments"

say "reviewer approves every segment"
RJAR=/tmp/desk-reviewer2
curl -s -c "$RJAR" -X POST "$BASE/api/session" -H "$J" \
  -d "{\"email\":\"$REMAIL\",\"password\":\"$RKEY\"}" > /dev/null
for SEG in $(echo "$ASSIGN" | python3 -c 'import sys,json;print(" ".join(json.load(sys.stdin)["segment_ids"]))'); do
  curl -s -b "$RJAR" -X POST "$BASE/api/segments/$SEG/approve" -H "$J" -d '{}' > /dev/null
done
curl -s -b "$JAR" "$P/assignments" | python3 -c '
import sys, json
for a in json.load(sys.stdin)["assignments"]:
    print(a["id"], a["state"])'

say "events now hold review.completed"
curl -s -b "$JAR" "$P/events" | python3 -c '
import sys, json
for e in json.load(sys.stdin)["events"]:
    print(e["event_id"], e["type"], e["state"], e["attempts"])'

say "state before an import"
BEFORE=$(curl -s -b "$JAR" "$P/branches/main/keys")
TM_BEFORE=$(curl -s -b "$JAR" "$P/tm")
echo "$BEFORE" | python3 -c 'import sys,json,hashlib;print(hashlib.sha256(json.dumps(json.load(sys.stdin),sort_keys=True).encode()).hexdigest())'

say "import, then restore"
printf 'source,target,target_language\nShipping,Versand,de\nPrivacy,Confidentialité,fr\n' > /tmp/restore.csv
IMPORT=$(curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/restore.csv;type=text/csv')
echo "$IMPORT" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("added",d["added"],"applied",d["applied"])'
OP=$(echo "$IMPORT" | pj 'd["import_id"]')
curl -s -b "$JAR" -X POST "$P/operations/$OP/restore" -H "$J" -d '{}' | head -c 120

say "state after the restore matches byte for byte"
AFTER=$(curl -s -b "$JAR" "$P/branches/main/keys")
TM_AFTER=$(curl -s -b "$JAR" "$P/tm")
python3 - "$BEFORE" "$AFTER" "$TM_BEFORE" "$TM_AFTER" <<'PY'
import sys, json
before, after, tm_before, tm_after = (json.loads(arg) for arg in sys.argv[1:5])
print("keys identical:", before == after)
print("memory identical:", tm_before == tm_after)
PY

say "restore again is refused"
curl -s -b "$JAR" -X POST "$P/operations/$OP/restore" -H "$J" -d '{}'

say "a later change supersedes an older restore"
IMPORT2=$(curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/restore.csv;type=text/csv')
OP2=$(echo "$IMPORT2" | pj 'd["import_id"]')
printf 'source,target,target_language\nUnits,Einheiten,de\n' > /tmp/later.csv
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/later.csv;type=text/csv' > /dev/null
curl -s -b "$JAR" -X POST "$P/operations/$OP2/restore" -H "$J" -d '{}'

say "simultaneous holds: exactly one wins"
BR=$(curl -s -b "$JAR" "$P/branches" | python3 -c '
import sys, json
for b in json.load(sys.stdin)["branches"]:
    if not b["is_main"] and b["state"] in ("open", "in_review"):
        print(b["name"]); break')
CID=$(curl -s -b "$JAR" "$P/branches/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$BR")/merge-preview" | python3 -c '
import sys, json
conflicts = json.load(sys.stdin)["conflicts"]
print(conflicts[0]["id"] if conflicts else "")')
if [ -n "$CID" ]; then
  ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$BR")
  for i in 1 2 3 4; do
    curl -s -c "/tmp/hold-$i" -X POST "$BASE/api/session" -H "$J" \
      -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null
    (curl -s -b "/tmp/hold-$i" -X POST "$P/branches/$ENC/conflicts/$CID/hold" -H "$J" -d '{}' \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);print("won" if "held_until" in d else d["error"]["code"])' &)
  done
  wait
  sleep 2
else
  echo "no conflict to hold"
fi

say "simultaneous publishes: exactly one is accepted"
for i in 1 2 3; do
  (curl -s -b "$JAR" -X POST "$P/publishes" -H "$J" -H "Idempotency-Key: race-$(date +%s)-$i" \
    -d '{"branch":"main"}' \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("state") or d["error"]["code"])' &)
done
wait
echo
