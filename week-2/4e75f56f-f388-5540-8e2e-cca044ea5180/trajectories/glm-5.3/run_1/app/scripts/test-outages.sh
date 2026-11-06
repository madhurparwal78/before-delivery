#!/bin/bash
# Outage and recovery tests. Dependencies are simulated by pointing extra app
# processes at unreachable endpoints; recovery is tested by restarting the same
# process with the real endpoints — no restart of anything else.
set -e
cd /app
node scripts/reset.js > /dev/null
DEAD_KB=http://127.0.0.1:9999
DEAD_S3=http://127.0.0.1:9998
DEAD_SMTP=127.0.0.1
DEAD_PB=http://127.0.0.1:9997
B=4175

kill_frozen() {
  ls /proc | grep -E '^[0-9]+$' | while read p; do
    if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "APP_PUBLIC_PORT=$B"; then kill $p; fi
  done
  sleep 0.6
}
start_with() {
  kill_frozen
  (env "$@" APP_PUBLIC_PORT=$B APP_PUBLIC_URL=http://127.0.0.1:$B nohup node dist/server/main.js > /tmp/server_outage.log 2>&1 &)
  sleep 2
}

JAR=/tmp/outage_user.txt
rm -f $JAR

JAR2=/tmp/outage_user2.txt
JAR3=/tmp/outage_user3.txt
rm -f $JAR2 $JAR3

echo "== payments while Kill Bill is unreachable => 503, hold keeps running"
start_with KILLBILL_URL=$DEAD_KB
curl -s -c $JAR -X POST http://127.0.0.1:$B/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Ora Falk","email":"ora@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR -X POST http://127.0.0.1:$B/api/holds -H 'Content-Type: application/json' -d '{"benches":["C3"]}')
RID=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
CODE=$(curl -s -o /tmp/pay_out.json -w "%{http_code}" -b $JAR -X POST http://127.0.0.1:$B/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: outage-$RID-1" -d '{"billing_name":"Ora Falk"}')
echo "deposit with dead KB: $CODE $(cat /tmp/pay_out.json | head -c 120)"
echo "hold still live:"
curl -s -b $JAR http://127.0.0.1:$B/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print("state:", d["reservations"][0]["state"], "hold:", d["reservations"][0]["hold"] is not None)'

echo "== desk with dead KB => billing unavailable, kb null"
rm -f /tmp/outage_reg.txt
curl -s -c /tmp/outage_reg.txt -X POST http://127.0.0.1:$B/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"registrar@opaline-institute.test","password":"bench-days-registrar-2027"}' > /dev/null
curl -s -b /tmp/outage_reg.txt "http://127.0.0.1:$B/api/desk/reservations" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("billing:", d["billing"], "kb:", d["reservations"][0].get("kb"))'

echo "== Kill Bill answers again => the same retry succeeds with one charge"
start_with
CODE=$(curl -s -o /tmp/pay_out2.json -w "%{http_code}" -b $JAR -X POST http://127.0.0.1:$B/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: outage-$RID-2" -d '{"billing_name":"Ora Falk"}')
echo "deposit retry: $CODE $(cat /tmp/pay_out2.json | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d["reservation"]; print(r["state"], r["paid_cents"])')"
echo "exactly one Kill Bill purchase for this seat:"
curl -s -u admin:password -H "X-Killbill-ApiKey: gfkit-dev" -H "X-Killbill-ApiSecret: gfkit-dev-secret" "http://killbill:8080/1.0/kb/payments/search/ob-deposit-$RID" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("payments:", len(d), "purchased:", [p["purchasedAmount"] for p in d])'

echo "== payment while MinIO is unreachable => 202 pending, finished within 10s of return"
start_with S3_ENDPOINT=$DEAD_S3
curl -s -c $JAR2 -X POST http://127.0.0.1:$B/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Ida Moss","email":"ida@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR2 -X POST http://127.0.0.1:$B/api/holds -H 'Content-Type: application/json' -d '{"benches":["D2"]}')
RID2=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
CODE=$(curl -s -o /tmp/pay_out3.json -w "%{http_code}" -b $JAR2 -X POST http://127.0.0.1:$B/api/reservations/$RID2/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: outage-$RID2-1" -d '{"billing_name":"Ida Moss"}')
echo "deposit with dead storage: $CODE $(cat /tmp/pay_out3.json | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d["reservation"]; print(r["state"], r["payment_pending"])')"
echo "one Kill Bill charge only:"
curl -s -u admin:password -H "X-Killbill-ApiKey: gfkit-dev" -H "X-Killbill-ApiSecret: gfkit-dev-secret" "http://killbill:8080/1.0/kb/payments/search/ob-deposit-$RID2" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("payments:", len(d), "purchased:", [p["purchasedAmount"] for p in d])'

echo "== storage returns => pending payment finishes, no restart"
start_with
sleep 20
curl -s -b $JAR2 http://127.0.0.1:$B/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); r=[x for x in d["reservations"] if x["id"]=="'"$RID2"'"][0]; print("state:", r["state"], "pending:", r["payment_pending"], "documents:", r["documents"])'

echo "== mail while Mailpit is unreachable => queued, sent on return"
start_with SMTP_HOST=$DEAD_SMTP
curl -s -c $JAR3 -X POST http://127.0.0.1:$B/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Finn Marsh","email":"finn@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR3 -X POST http://127.0.0.1:$B/api/holds -H 'Content-Type: application/json' -d '{"benches":["D4"]}')
RID3=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
curl -s -b $JAR3 -X POST http://127.0.0.1:$B/api/reservations/$RID3/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: outage-$RID3-1" -d '{"billing_name":"Finn Marsh"}' > /dev/null
echo "receipt queued while SMTP is down; now restore and wait:"
start_with
sleep 20
curl -s "http://mailpit:8025/api/v1/messages?limit=10" | python3 -c 'import sys,json; d=json.load(sys.stdin); [print("-", m["Subject"]) for m in d["messages"] if "Deposit" in m["Subject"]]'

echo "== PocketBase unreachable => 503 content_unavailable"
start_with POCKETBASE_URL=$DEAD_PB
CODE=$(curl -s -o /tmp/content_out.json -w "%{http_code}" http://127.0.0.1:$B/api/content)
echo "content: $CODE $(cat /tmp/content_out.json | head -c 100)"

echo "== content desk writes while PocketBase is down"
rm -f /tmp/outage_dir.txt
curl -s -c /tmp/outage_dir.txt -X POST http://127.0.0.1:$B/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"director@opaline-institute.test","password":"bench-days-director-2027"}' > /dev/null
CODE=$(curl -s -o /tmp/dir_out.json -w "%{http_code}" -b /tmp/outage_dir.txt -X POST http://127.0.0.1:$B/api/desk/content/faq -H 'Content-Type: application/json' -d '{"question":"Are meals included?","answer":"Lunch both days.","sort":9}')
echo "faq create with dead PocketBase: $CODE $(cat /tmp/dir_out.json | head -c 100)"

kill_frozen
echo "OUTAGE TESTS DONE"
