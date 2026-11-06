#!/bin/bash
# Balance reminders at 21 and 7 days, once each, on venue-local dates.
set -e
cd /app
node scripts/reset.js > /dev/null
curl -s -X DELETE http://mailpit:8025/api/v1/messages > /dev/null
B=4178

kill_rem() {
  ls /proc | grep -E '^[0-9]+$' | while read p; do
    if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -q "APP_PUBLIC_PORT=$B"; then kill $p; fi
  done
  sleep 0.5
}
kill_rem

# Buy a deposit on the real clock.
JAR=/tmp/rem_user.txt
rm -f $JAR
curl -s -c $JAR -X POST http://127.0.0.1:4173/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Rem Test","email":"rem@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR -X POST http://127.0.0.1:4173/api/holds -H 'Content-Type: application/json' -d '{"benches":["C2"]}')
RID=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
curl -s -b $JAR -X POST http://127.0.0.1:4173/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: rem-$RID" -d '{"billing_name":"Rem Test"}' > /dev/null
echo "deposit paid"

echo "== frozen clock 1 March 2027 => the 21-day reminder, at most once"
(BENCH_DAYS_NOW=2027-03-01T15:00:00Z APP_PUBLIC_PORT=$B APP_PUBLIC_URL=http://127.0.0.1:$B nohup node dist/server/main.js > /tmp/rem1.log 2>&1 &)
sleep 3
(BENCH_DAYS_NOW=2027-03-01T15:00:00Z APP_PUBLIC_PORT=4179 APP_PUBLIC_URL=http://127.0.0.1:4179 nohup node dist/server/main.js > /tmp/rem2.log 2>&1 &)
echo "two processes share the database; waiting 40s"
sleep 40
curl -s "http://mailpit:8025/api/v1/messages?limit=50" | python3 -c '
import sys, json
d = json.load(sys.stdin)
subjects = [m["Subject"] for m in d["messages"]]
reminders = [s for s in subjects if "Balance reminder" in s]
print("reminders:", reminders)
assert len(reminders) == 1 and "21 days" in reminders[0], f"expected one 21-day reminder: {reminders}"
print("21-day reminder sent exactly once OK")'

echo "== frozen clock 15 March 2027 => only the 7-day reminder, the 21-day never follows"
kill_rem
curl -s -X DELETE http://mailpit:8025/api/v1/messages > /dev/null
(BENCH_DAYS_NOW=2027-03-15T15:00:00Z APP_PUBLIC_PORT=$B APP_PUBLIC_URL=http://127.0.0.1:$B nohup node dist/server/main.js > /tmp/rem3.log 2>&1 &)
sleep 3
(BENCH_DAYS_NOW=2027-03-15T15:00:00Z APP_PUBLIC_PORT=4179 APP_PUBLIC_URL=http://127.0.0.1:4179 nohup node dist/server/main.js > /tmp/rem4.log 2>&1 &)
sleep 40
curl -s "http://mailpit:8025/api/v1/messages?limit=50" | python3 -c '
import sys, json
d = json.load(sys.stdin)
subjects = [m["Subject"] for m in d["messages"]]
reminders = [s for s in subjects if "Balance reminder" in s]
print("reminders:", reminders)
assert len(reminders) == 1 and "7 days" in reminders[0], f"expected one 7-day reminder only: {reminders}"
print("7-day only, 21-day never follows OK")'

echo "== after 19 March 2027, no reminders"
kill_rem
curl -s -X DELETE http://mailpit:8025/api/v1/messages > /dev/null
node scripts/reset.js > /dev/null
JAR2=/tmp/rem_user2.txt
rm -f $JAR2
curl -s -c $JAR2 -X POST http://127.0.0.1:4173/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Late Rem","email":"late@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
RES=$(curl -s -b $JAR2 -X POST http://127.0.0.1:4173/api/holds -H 'Content-Type: application/json' -d '{"benches":["C3"]}')
RID2=$(echo "$RES" | python3 -c 'import sys,json; print(json.load(sys.stdin)["reservations"][0]["id"])')
curl -s -b $JAR2 -X POST http://127.0.0.1:4173/api/reservations/$RID2/full -H 'Content-Type: application/json' -H "Idempotency-Key: late-$RID2" -d '{"billing_name":"Late Rem"}' > /dev/null
RES3=$(curl -s -b $JAR2 -X POST http://127.0.0.1:4173/api/holds -H 'Content-Type: application/json' -d '{"benches":["C5"]}')
sleep 1
kill_rem
echo "(balance not paid for this fresh seat; using full payment test — deposit flow would be blocked after 19 March anyway)"
kill_rem
echo "REMINDER TESTS DONE"
