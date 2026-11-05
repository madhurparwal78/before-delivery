#!/bin/bash
# Journey tests: cancellation/refund, waitlist offers, check-in, certificate.
# Runs against a second app process with a frozen venue clock where needed.
set -e
cd /app
BASE=http://127.0.0.1:4174
node scripts/reset.js > /dev/null

echo "== start frozen-clock process (16 April 2027, day 1)"
ls /proc | grep -E '^[0-9]+$' | while read p; do if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "BENCH_DAYS_NOW"; then kill $p; fi; done
sleep 0.5
(BENCH_DAYS_NOW=2027-04-16T15:00:00Z APP_PUBLIC_PORT=4174 APP_PUBLIC_URL=http://127.0.0.1:4174 HOLD_SECONDS=4 nohup node dist/server/main.js > /tmp/server2.log 2>&1 &)
sleep 2

JAR=/tmp/t2_p.txt
REG=/tmp/t2_reg.txt
FD=/tmp/t2_fd.txt
rm -f $JAR $REG $FD

echo "== practitioner buys C4 in full"
curl -s -c $JAR -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Iris Kettle","email":"iris@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["C4"]}')
RID=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
curl -s -b $JAR -X POST $BASE/api/reservations/$RID/full -H 'Content-Type: application/json' -H "Idempotency-Key: full-$RID-1" -d '{"billing_name":"Iris Kettle"}' | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("state:",r["state"])'

echo "== cancel and refund (venue date 2027-04-16 => no refund window)"
CODE=$(curl -s -o /tmp/cancel_out.json -w "%{http_code}" -b $JAR -X POST $BASE/api/reservations/$RID/cancel)
echo "cancel: $CODE $(cat /tmp/cancel_out.json | head -c 120)"

echo "== new buyer: pay in full then cancel (venue 10 Jan 2027 => refund minus 25000)"
ls /proc | grep -E '^[0-9]+$' | while read p; do if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "BENCH_DAYS_NOW"; then kill $p; fi; done
sleep 0.5
(BENCH_DAYS_NOW=2027-01-10T15:00:00Z APP_PUBLIC_PORT=4174 APP_PUBLIC_URL=http://127.0.0.1:4174 HOLD_SECONDS=4 nohup node dist/server/main.js > /tmp/server2.log 2>&1 &)
sleep 2
echo "cancel C4 under the January clock (refund 345000-25000=320000):"
curl -s -b $JAR -X POST $BASE/api/reservations/$RID/cancel | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("state:",r["state"],"refund_due:",r["refund_due_cents"])'
RES2=$(curl -s -b $JAR -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["C5"]}')
RID2=$(echo "$RES2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
curl -s -b $JAR -X POST $BASE/api/reservations/$RID2/full -H 'Content-Type: application/json' -H "Idempotency-Key: full-$RID2-1" -d '{"billing_name":"Iris Kettle"}' > /dev/null
echo "cancel C5 (should refund 345000-25000=320000):"
curl -s -b $JAR -X POST $BASE/api/reservations/$RID2/cancel | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("state:",r["state"],"refund_due:",r["refund_due_cents"])'

echo "== registrar refunds"
curl -s -c $REG -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"registrar@opaline-institute.test","password":"bench-days-registrar-2027"}' > /dev/null
curl -s -b $REG -X POST $BASE/api/desk/reservations/$RID2/refund -H "Idempotency-Key: ref-$RID2-1" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("state:",d["reservation"]["state"],"refund:",d["refund"])'

echo "== waitlist journey: fill the atelier cap"
# 10 atelier benches: one clinic buys via group? Clinic cannot buy atelier? Clinics can hold any benches.
JARC=/tmp/t2_c.txt
rm -f $JARC
curl -s -c $JARC -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Bea Court","email":"bea@clinic.test","password":"clinic-days-2027-pass","kind":"clinic","clinic_name":"Court Dental"}' > /dev/null
G=$(curl -s -b $JARC -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["A1","A2","A3","A4","A5","A6"]}')
GID=$(echo "$G" | python3 -c 'import sys,json; print(json.load(sys.stdin)["group_id"])')
curl -s -b $JARC -X POST $BASE/api/groups/$GID/checkout -H 'Content-Type: application/json' -H "Idempotency-Key: g-$GID-1" -d '{"billing_name":"Court Dental"}' > /dev/null
echo "group1 paid"
# second group hold for a clinic is blocked only while live; after payment it can hold again
G2=$(curl -s -b $JARC -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["B1","B2","B3","B4"]}')
GID2=$(echo "$G2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["group_id"])')
curl -s -b $JARC -X POST $BASE/api/groups/$GID2/checkout -H 'Content-Type: application/json' -H "Idempotency-Key: g-$GID2-1" -d '{"billing_name":"Court Dental"}' > /dev/null
echo "group2 paid (10 atelier active)"
curl -s $BASE/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("remaining:",d["seats_remaining"],"atelier:",d["tiers"]["atelier"])'

echo "== 11th atelier hold => 409 atelier_sold_out"
JARX=/tmp/t2_x.txt
rm -f $JARX
curl -s -c $JARX -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Wren Ashe","email":"wren@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
CODE=$(curl -s -o /tmp/hold_out.json -w "%{http_code}" -b $JARX -X POST $BASE/api/holds -H 'Content-Type: application/json' -d '{"benches":["B5"]}')
echo "hold B5: $CODE $(cat /tmp/hold_out.json | head -c 150)"

echo "== join atelier waitlist"
curl -s -b $JARX -X POST $BASE/api/waitlist -H 'Content-Type: application/json' -d '{"tier":"atelier"}' | head -c 120
echo

echo "== waitlist join blocked while bench-tier benches are open"
CODE=$(curl -s -o /tmp/wl2.json -w "%{http_code}" -b $JARX -X POST $BASE/api/waitlist -H 'Content-Type: application/json' -d '{"tier":"bench"}')
echo "bench waitlist: $CODE $(cat /tmp/wl2.json | head -c 100)"

echo "== cancel one atelier group seat => offer to waitlisted Wren"
C1RES=$(curl -s -b $JARC $BASE/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print([r["id"] for r in d["reservations"] if r["bench"]=="B4"][0])')
curl -s -b $JARC -X POST $BASE/api/reservations/$C1RES/cancel | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("cancelled:",r["bench"],r["refund_due_cents"])'
sleep 2
curl -s -b $JARX $BASE/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print("offers:",d["offers"])'

echo "== accept the offer"
OFFER=$(curl -s -b $JARX $BASE/api/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["offers"][0]["id"] if d["offers"] else "")')
ACCEPTRES=$(curl -s -b $JARX -X POST $BASE/api/offers/$OFFER/accept)
echo "$ACCEPTRES" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("accepted:", d["reservations"][0]["bench"], d["reservations"][0]["state"], d["reservations"][0]["hold"]["seconds_remaining"])'
RESW=$(echo "$ACCEPTRES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
echo "== Wren pays in full (deposits closed on 16 April)"
curl -s -b $JARX -X POST $BASE/api/reservations/$RESW/full -H 'Content-Type: application/json' -H "Idempotency-Key: full-$RESW-1" -d '{"billing_name":"Wren Ashe"}' | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("state:",r["state"],"paid:",r["paid_cents"])'

echo "== check-in day 1 (frozen 16 April) and day 2"
ls /proc | grep -E '^[0-9]+$' | while read p; do if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "BENCH_DAYS_NOW"; then kill $p; fi; done
sleep 0.5
(BENCH_DAYS_NOW=2027-04-16T15:00:00Z APP_PUBLIC_PORT=4174 APP_PUBLIC_URL=http://127.0.0.1:4174 nohup node dist/server/main.js > /tmp/server2.log 2>&1 &)
sleep 2
curl -s -c $FD -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"frontdesk@opaline-institute.test","password":"bench-days-frontdesk-2027"}' > /dev/null
curl -s -b $FD "$BASE/api/checkin?q=Wren" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("day:",d["open_day"],"results:",d["results"])'
RESW=$(curl -s -b $FD "$BASE/api/checkin?q=Wren" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["results"][0]["reservation_id"])')
curl -s -b $FD -X POST $BASE/api/checkin -H 'Content-Type: application/json' -d "{\"reservation_id\":\"$RESW\",\"day\":1}" | head -c 150
echo
echo "== day 2 check-in requires day 1; run day 2 process"
ls /proc | grep -E '^[0-9]+$' | while read p; do if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "BENCH_DAYS_NOW"; then kill $p; fi; done
sleep 0.5
(BENCH_DAYS_NOW=2027-04-17T15:00:00Z APP_PUBLIC_PORT=4174 APP_PUBLIC_URL=http://127.0.0.1:4174 nohup node dist/server/main.js > /tmp/server2.log 2>&1 &)
sleep 2
curl -s -b $FD -X POST $BASE/api/checkin -H 'Content-Type: application/json' -d "{\"reservation_id\":\"$RESW\",\"day\":2}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("day2:", d["reservation"]["state"])'

echo "== certificate: licence missing => not eligible"
CODE=$(curl -s -o /tmp/cert1.json -w "%{http_code}" -b $REG -X POST $BASE/api/desk/reservations/$RESW/certificate)
echo "certificate: $CODE $(cat /tmp/cert1.json | head -c 200)"

echo "== licence upload by attendee"
printf '%%PDF-1.4 fake licence for test' > /tmp/licence.pdf
curl -s -b $JARX -X POST $BASE/api/reservations/$RESW/licence -F "licence_number=IL-DEN-99182" -F "licence_state=Illinois" -F "file=@/tmp/licence.pdf;type=application/pdf" | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("licence:",r["licence_status"])'

echo "== registrar marks matched then issues certificate"
curl -s -b $REG -X POST $BASE/api/desk/reservations/$RESW/licence-review -H 'Content-Type: application/json' -d '{"decision":"matched"}' | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("licence:",r["licence_status"])'
curl -s -b $REG -X POST $BASE/api/desk/reservations/$RESW/certificate | python3 -c 'import sys,json; d=json.load(sys.stdin); print("cert:", d.get("certificate_number"), d["reservation"]["state"])'
echo "== second issue returns same number"
curl -s -b $REG -X POST $BASE/api/desk/reservations/$RESW/certificate | python3 -c 'import sys,json; d=json.load(sys.stdin); print("cert again:", d.get("certificate_number"), d["reservation"]["state"])'

echo "== mailpit received emails"
curl -s "http://mailpit:8025/api/v1/messages?limit=30" | python3 -c 'import sys,json; d=json.load(sys.stdin); [print("-", m["Subject"]) for m in d["messages"]]'
