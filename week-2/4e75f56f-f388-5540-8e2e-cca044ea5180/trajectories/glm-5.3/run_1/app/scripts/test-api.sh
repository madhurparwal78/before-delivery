#!/bin/bash
# End-to-end API smoke test for Opaline Bench Days.
set -e
node scripts/reset.js > /dev/null
BASE=http://127.0.0.1:4173
JAR=/tmp/ob_cookies.txt
JARG=/tmp/ob_group_cookies.txt
rm -f $JAR $JARG

echo "== health"
curl -s $BASE/api/health
echo

echo "== signup practitioner"
curl -s -c $JAR -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Dana Whitfield","email":"dana@example.test","password":"bench-days-2027-pass","kind":"practitioner"}'
echo

echo "== signup clinic"
curl -s -c $JARG -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Nora Vale","email":"nora@clinic.test","password":"clinic-days-2027-pass","kind":"clinic","clinic_name":"Vale Dental Studio"}'
echo

echo "== hold C4"
HOLD=$(curl -s -b $JAR -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["C4"]}')
echo "$HOLD" | head -c 400
echo
RES_ID=$(echo "$HOLD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
echo "RES_ID=$RES_ID"

echo "== pay deposit (idempotency)"
KEY="test-key-$(date +%s)"
PAY=$(curl -s -b $JAR -X POST $BASE/api/reservations/$RES_ID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d '{"billing_name":"Dana Whitfield"}')
echo "$PAY" | head -c 500
echo
echo "-- replay:"
curl -s -b $JAR -X POST $BASE/api/reservations/$RES_ID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d '{"billing_name":"Dana Whitfield"}' | head -c 300
echo

echo "== benches after sale"
curl -s $BASE/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("remaining",d["seats_remaining"],"held",d["held"],"sold",d["sold"])'

echo "== balance payment"
curl -s -b $JAR -X POST $BASE/api/reservations/$RES_ID/balance -H 'Content-Type: application/json' -H "Idempotency-Key: bal-$RES_ID-1" -d '{"billing_name":"Dana Whitfield"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d["reservation"]; print(r["state"], r["paid_cents"], r["balance_cents"])'

echo "== upgrade to A3"
curl -s -b $JAR -X POST $BASE/api/reservations/$RES_ID/upgrade -H 'Content-Type: application/json' -H "Idempotency-Key: up-$RES_ID-1" -d '{"billing_name":"Dana Whitfield","bench":"A3"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d["reservation"]; print(r["state"], r["tier"], r["bench"], r["paid_cents"], r["balance_cents"])'

echo "== clinic group hold + checkout"
GH=$(curl -s -b $JARG -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["C1","C2","D1","D2"]}')
echo "$GH" | head -c 200
echo
GRP_ID=$(echo "$GH" | python3 -c 'import sys,json; print(json.load(sys.stdin)["group_id"])')
echo "GRP_ID=$GRP_ID"
curl -s -b $JARG -X POST $BASE/api/groups/$GRP_ID/checkout -H 'Content-Type: application/json' -H "Idempotency-Key: grp-$GRP_ID-1" \
  -d '{"billing_name":"Vale Dental Studio","assignments":[{"bench":"C1","name":"Rosa Bell","email":"rosa@clinic.test"},{"bench":"C2","name":"Milo Trent","email":"milo@clinic.test"}]}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); g=d["group"]; print("state:",g["state"]); print("invoice:",g["invoice"]["total_cents"], [i["amount_cents"] for i in g["invoice"]["items"]])'

echo "== me (clinic)"
curl -s -b $JARG $BASE/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print([(r["bench"],r["state"],r["attendee"]) for r in d["reservations"]])'

echo "== registrar desk"
rm -f /tmp/ob_reg.txt
curl -s -c /tmp/ob_reg.txt -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"registrar@opaline-institute.test","password":"bench-days-registrar-2027"}' > /dev/null
curl -s -b /tmp/ob_reg.txt "$BASE/api/desk/reservations" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("billing:",d["billing"]); [(print(r["bench"], r["state"], r["kb"], r["buyer_email"])) for r in d["reservations"]]'

echo "== content"
curl -s $BASE/api/content | python3 -c 'import sys,json; d=json.load(sys.stdin); print("sessions:",len(d["sessions"])); print("hospitality:",[(h["title"],h.get("gated")) for h in d["hospitality"]]); print("hotels:",len(d["hotels"]),"faq:",len(d["faq"]))'
