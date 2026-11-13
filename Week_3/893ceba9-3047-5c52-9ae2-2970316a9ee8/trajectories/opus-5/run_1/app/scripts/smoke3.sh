#!/usr/bin/env bash
# Checks the branch, conflict, merge and review journeys.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
RJAR=/tmp/desk-reviewer
P="$BASE/api/projects/larkspur-rider"
J='Content-Type: application/json'
say() { printf '\n== %s\n' "$1"; }
pj() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

curl -s -c "$JAR" -X POST "$BASE/api/session" -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

say "new branch"
curl -s -b "$JAR" -X POST "$P/branches" -H "$J" -d '{"name":"feature/garage-copy"}'

KEY=$(curl -s -b "$JAR" "$P/branches/main/keys" | python3 -c '
import sys,json
for k in json.load(sys.stdin)["keys"]:
    if k["name"] == "garage.chain_wear":
        print(k["id"])')
say "rename and edit on branch (key $KEY)"
curl -s -b "$JAR" -X PATCH "$P/branches/feature%2Fgarage-copy/keys/$KEY" -H "$J" \
  -d '{"name":"garage.chain_wear_pct","source":"Chain wear percentage"}'

say "edit same source on main"
curl -s -b "$JAR" -X PATCH "$P/branches/main/keys/$KEY" -H "$J" -d '{"source":"Chain wear level"}'

say "branch preview"
curl -s -b "$JAR" "$P/branches/feature%2Fgarage-copy/merge-preview"

CID="$KEY:source"
say "hold conflict"
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fgarage-copy/conflicts/$CID/hold" -H "$J" -d '{}'

say "resolve without hold from another session"
curl -s -X PUT "$P/branches/feature%2Fgarage-copy/conflicts/$CID" -H "$J" -d '{"choice":"branch"}' | head -c 200

say "resolve custom"
curl -s -b "$JAR" -X PUT "$P/branches/feature%2Fgarage-copy/conflicts/$CID" -H "$J" \
  -d '{"choice":"custom","value":"Chain wear (%)"}'

say "merge from open (illegal)"
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fgarage-copy/merge" -H "$J" -d '{}'

say "request review"
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fgarage-copy/transitions" -H "$J" -d '{"to":"in_review"}'

say "edit locked while in review"
curl -s -b "$JAR" -X PATCH "$P/branches/feature%2Fgarage-copy/keys/$KEY" -H "$J" -d '{"source":"Nope"}'

say "merge"
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fgarage-copy/merge" -H "$J" -d '{}'

say "key history after rename and merge"
curl -s -b "$JAR" "$P/keys/$KEY/history"

say "invite reviewer"
INVITE=$(curl -s -b "$JAR" -X POST "$P/reviewers" -H "$J" -d '{"name":"Ines Quandt","email":"ines@example.test"}')
echo "$INVITE"
RID=$(echo "$INVITE" | pj 'd["id"]')
RKEY=$(echo "$INVITE" | pj 'd["access_key"]')

say "invite again (reviewer_exists)"
curl -s -b "$JAR" -X POST "$P/reviewers" -H "$J" -d '{"name":"Ines Quandt","email":"ines@example.test"}'

say "assign japanese review on main"
ASSIGN=$(curl -s -b "$JAR" -X POST "$P/assignments" -H "$J" \
  -d "{\"reviewer_id\":\"$RID\",\"branch\":\"main\",\"language\":\"ja\"}")
echo "$ASSIGN" | head -c 300

say "assign again (no_segments_to_review)"
curl -s -b "$JAR" -X POST "$P/assignments" -H "$J" \
  -d "{\"reviewer_id\":\"$RID\",\"branch\":\"main\",\"language\":\"ja\"}" | head -c 200

say "reviewer signs in"
curl -s -c "$RJAR" -X POST "$BASE/api/session" -H "$J" \
  -d "{\"email\":\"ines@example.test\",\"password\":\"$RKEY\"}"

say "reviewer queue size"
curl -s -b "$RJAR" "$BASE/api/review-queue" | pj 'len(d["segments"])'

say "reviewer cannot see owner endpoints"
curl -s -b "$RJAR" "$BASE/api/workspace/stats" | head -c 120
curl -s -b "$RJAR" "$P/branches" | head -c 120

say "reviewer approves one and corrects one"
SEGS=$(curl -s -b "$RJAR" "$BASE/api/review-queue")
S1=$(echo "$SEGS" | pj 'd["segments"][0]["segment_id"]')
S2=$(echo "$SEGS" | pj 'd["segments"][1]["segment_id"]')
curl -s -b "$RJAR" -X POST "$BASE/api/segments/$S1/approve" -H "$J" -d '{}' | head -c 160
echo
curl -s -b "$RJAR" -X POST "$BASE/api/segments/$S2/correct" -H "$J" \
  -d '{"value":"修正済みの訳","comment":"Tightened the register."}' | head -c 200

say "assignments"
curl -s -b "$JAR" "$P/assignments" | head -c 400
echo
