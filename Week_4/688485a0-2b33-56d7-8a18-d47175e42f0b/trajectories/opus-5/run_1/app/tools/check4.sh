#!/usr/bin/env bash
set -u
BASE=${BASE:-http://localhost:4173}
J='Content-Type: application/json'
S=$(date +%s)

SEED=$(curl -s -X POST "$BASE/api/grading/seed" -H "$J" -H "X-Grading-Key: grade-7f3c" -d "{
  \"users\":[{\"email\":\"api$S@example.test\",\"password\":\"jarful-pass\",\"name\":\"Api Ace\"},
             {\"email\":\"mate$S@example.test\",\"password\":\"jarful-pass\",\"name\":\"Mate Moss\"}],
  \"projects\":[{\"name\":\"Api $S\",\"owner\":\"api$S@example.test\",
    \"members\":[{\"email\":\"mate$S@example.test\",\"role\":\"editor\"}],
    \"collections\":[{\"name\":\"items\",\"documents\":[
      {\"_id\":\"f00000000000000000000001\",\"g\":\"x\",\"n\":1},
      {\"_id\":\"f00000000000000000000002\",\"g\":\"x\",\"n\":2},
      {\"_id\":\"f00000000000000000000003\",\"g\":\"y\",\"n\":3}]}]}]}")
PID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Api $S']['id'])" "$SEED")
CID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Api $S']['collections']['items']['id'])" "$SEED")
UID2=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['users']['mate$S@example.test'])" "$SEED")
C="$BASE/api/projects/$PID/collections/$CID"
curl -s -c /tmp/a.jar -X POST "$BASE/api/auth/signin" -H "$J" -d "{\"email\":\"api$S@example.test\",\"password\":\"jarful-pass\"}" > /dev/null
curl -s -c /tmp/m.jar -X POST "$BASE/api/auth/signin" -H "$J" -d "{\"email\":\"mate$S@example.test\",\"password\":\"jarful-pass\"}" > /dev/null

echo "== pipeline draft =="
curl -s -b /tmp/a.jar -X PUT "$C/pipeline" -H "$J" -d '{"stages":["{\"$match\":{}}","{\"$count\":\"n\"}"],"disabled":[1]}'; echo
echo -n "owner draft: "; curl -s -b /tmp/a.jar "$C/pipeline"; echo
echo -n "other person draft: "; curl -s -b /tmp/m.jar "$C/pipeline"; echo

echo "== paged aggregate =="
curl -s -b /tmp/a.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$group":{"_id":"$g","total":{"$sum":"$n"}}}],"page":1}'; echo
echo -n "disabled stage passes through: "
curl -s -b /tmp/a.jar -X POST "$C/aggregate" -H "$J" -d '{"pipeline":[{"$match":{"g":"y"}},{"$count":"n"}],"disabled":[0],"preview":true}'; echo

echo "== saved query update and run =="
QID=$(curl -s -b /tmp/m.jar -X POST "$C/saved-queries" -H "$J" -d '{"name":"Xs","filter":{"g":"x"},"projection":null,"sort":null,"limit":0}' | python3 -c "import json,sys;print(json.load(sys.stdin)['saved_query']['id'])")
curl -s -b /tmp/m.jar -X PUT "$C/saved-queries/$QID" -H "$J" -d '{"name":"Xs","filter":{"g":"x"},"projection":{"g":1},"sort":{"n":-1},"limit":1}' > /dev/null
curl -s -b /tmp/a.jar -X POST "$C/saved-queries/$QID/run" -H "$J" -d '{"page":1}' | head -c 300; echo
echo -n "name taken: "; curl -s -b /tmp/m.jar -X POST "$C/saved-queries" -H "$J" -d '{"name":"Xs","filter":{}}'; echo

echo "== members and invitations =="
curl -s -b /tmp/a.jar -X PATCH "$BASE/api/projects/$PID/members/$UID2" -H "$J" -d '{"role":"reader"}'; echo
echo -n "editor turned reader may not write: "; curl -s -b /tmp/m.jar -X POST "$C/documents" -H "$J" -d '{"document":{"x":1}}'; echo
echo -n "bad role: "; curl -s -b /tmp/a.jar -X PATCH "$BASE/api/projects/$PID/members/$UID2" -H "$J" -d '{"role":"owner"}'; echo
OWNER_ID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['users']['api$S@example.test'])" "$SEED")
echo -n "owner row fixed: "; curl -s -b /tmp/a.jar -X PATCH "$BASE/api/projects/$PID/members/$OWNER_ID" -H "$J" -d '{"role":"reader"}'; echo
IID=$(curl -s -b /tmp/a.jar -X POST "$BASE/api/projects/$PID/invitations" -H "$J" -d "{\"email\":\"new$S@example.test\",\"role\":\"reader\"}" | python3 -c "import json,sys;print(json.load(sys.stdin)['invitation']['id'])")
echo -n "already invited: "; curl -s -b /tmp/a.jar -X POST "$BASE/api/projects/$PID/invitations" -H "$J" -d "{\"email\":\"new$S@example.test\",\"role\":\"reader\"}"; echo
echo -n "already member: "; curl -s -b /tmp/a.jar -X POST "$BASE/api/projects/$PID/invitations" -H "$J" -d "{\"email\":\"mate$S@example.test\",\"role\":\"reader\"}"; echo
echo -n "revoke: "; curl -s -b /tmp/a.jar -X DELETE "$BASE/api/projects/$PID/invitations/$IID"; echo
echo -n "revoke again: "; curl -s -b /tmp/a.jar -X DELETE "$BASE/api/projects/$PID/invitations/$IID"; echo
echo -n "accept someone else's: "; curl -s -b /tmp/m.jar -X POST "$BASE/api/invitations/$IID/accept"; echo

echo "== accounts =="
echo -n "short password: "; curl -s -X POST "$BASE/api/auth/signup" -H "$J" -d '{"email":"short@example.test","password":"1234567","name":"Shorty"}'; echo
echo -n "bad email: "; curl -s -X POST "$BASE/api/auth/signup" -H "$J" -d '{"email":"nope","password":"jarful-pass","name":"Nope"}'; echo
echo -n "existing confirmed: "; curl -s -X POST "$BASE/api/auth/signup" -H "$J" -d "{\"email\":\"api$S@example.test\",\"password\":\"jarful-pass\",\"name\":\"Api Ace\"}"; echo
echo -n "wrong code: "; curl -s -X POST "$BASE/api/auth/confirm" -H "$J" -d "{\"email\":\"api$S@example.test\",\"code\":\"000000\"}"; echo
echo -n "wrong password: "; curl -s -X POST "$BASE/api/auth/signin" -H "$J" -d "{\"email\":\"api$S@example.test\",\"password\":\"nope-nope\"}"; echo
echo -n "resend: "; curl -s -X POST "$BASE/api/auth/resend" -H "$J" -d '{"email":"nobody@example.test"}'; echo

echo "== index rules =="
echo -n "drop _id_: "; curl -s -b /tmp/a.jar -X DELETE "$C/indexes/_id_"; echo
echo -n "bad keys: "; curl -s -b /tmp/a.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"a":2}}'; echo
echo -n "empty keys: "; curl -s -b /tmp/a.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{}}'; echo
echo -n "compound: "; curl -s -b /tmp/a.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"g":1,"n":-1}}'; echo
echo -n "same name: "; curl -s -b /tmp/a.jar -X POST "$C/indexes" -H "$J" -d '{"keys":{"g":1,"n":-1}}'; echo
echo -n "plan with compound: "; curl -s -b /tmp/a.jar -X POST "$C/query" -H "$J" -d '{"filter":{"g":"x","n":{"$gte":2}}}' | python3 -c "import json,sys;a=json.load(sys.stdin);print(a['plan'])"
echo -n "collection route: "; curl -s -b /tmp/a.jar "$C" ; echo
