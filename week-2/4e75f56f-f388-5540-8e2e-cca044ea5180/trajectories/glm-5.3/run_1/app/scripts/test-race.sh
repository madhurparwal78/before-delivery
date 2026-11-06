#!/bin/bash
# Concurrency: two app processes sharing one database; simultaneous holds on
# the same bench and on the last Atelier place.
set -e
cd /app
node scripts/reset.js > /dev/null
B1=4176
B2=4177

kill_race() {
  ls /proc | grep -E '^[0-9]+$' | while read p; do
    if grep -q "dist/server/main.js" /proc/$p/cmdline 2>/dev/null && tr '\0' ' ' < /proc/$p/environ | grep -qE "APP_PUBLIC_PORT=$B1|APP_PUBLIC_PORT=$B2"; then kill $p; fi
  done
  sleep 0.5
}
kill_race
(APP_PUBLIC_PORT=$B1 APP_PUBLIC_URL=http://127.0.0.1:$B1 nohup node dist/server/main.js > /tmp/race1.log 2>&1 &)
(APP_PUBLIC_PORT=$B2 APP_PUBLIC_URL=http://127.0.0.1:$B2 nohup node dist/server/main.js > /tmp/race2.log 2>&1 &)
sleep 3

JA=/tmp/race_a.txt
JB=/tmp/race_b.txt
rm -f $JA $JB
curl -s -c $JA -X POST http://127.0.0.1:$B1/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Ava Pike","email":"ava@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
curl -s -c $JB -X POST http://127.0.0.1:$B2/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Bea Quinn","email":"bea2@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null

echo "== simultaneous holds on the same bench (C4), across two processes"
curl -s -b $JA -X POST http://127.0.0.1:$B1/api/holds -H 'Content-Type: application/json' -d '{"benches":["C4"]}' > /tmp/race_a_out.json &
curl -s -b $JB -X POST http://127.0.0.1:$B2/api/holds -H 'Content-Type: application/json' -d '{"benches":["C4"]}' > /tmp/race_b_out.json &
wait
CODES=$(python3 - <<'EOF'
import json
a = json.load(open("/tmp/race_a_out.json"))
b = json.load(open("/tmp/race_b_out.json"))
for name, r in [("A", a), ("B", b)]:
    print(name, "reservations" if "reservations" in r else r.get("error"))
EOF
)
echo "$CODES"
python3 - <<'EOF'
import json
results = []
for path in ["/tmp/race_a_out.json", "/tmp/race_b_out.json"]:
    r = json.load(open(path))
    results.append(r)
winners = [r for r in results if "reservations" in r]
losers = [r for r in results if "error" in r]
assert len(winners) == 1, f"expected exactly one winner, got {len(winners)}"
assert len(losers) == 1, f"expected exactly one loser, got {len(losers)}"
assert losers[0]["error"] == "bench_taken", f"loser code: {losers[0]}"
print("exactly one 201 and one 409 bench_taken OK")
EOF

echo "== the map agrees across processes"
curl -s http://127.0.0.1:$B1/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("P1 remaining:", d["seats_remaining"])'
curl -s http://127.0.0.1:$B2/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("P2 remaining:", d["seats_remaining"])'

echo "== ten concurrent holds on the last Atelier place"
# Fill 9 atelier places with a clinic group.
JC=/tmp/race_c.txt
rm -f $JC
curl -s -c $JC -X POST http://127.0.0.1:$B1/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Corbett","email":"corb@example.test","password":"bench-days-2027-pass","kind":"clinic","clinic_name":"Corbett Dental"}' > /dev/null
G1=$(curl -s -b $JC -X POST http://127.0.0.1:$B1/api/holds -H 'Content-Type: application/json' -d '{"benches":["A1","A2","A3","A4","A5","A6"]}')
GID1=$(echo "$G1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["group_id"])')
curl -s -b $JC -X POST http://127.0.0.1:$B1/api/groups/$GID1/checkout -H 'Content-Type: application/json' -H "Idempotency-Key: race-$GID1" -d '{"billing_name":"Corbett Dental"}' > /dev/null
G2=$(curl -s -b $JC -X POST http://127.0.0.1:$B2/api/holds -H 'Content-Type: application/json' -d '{"benches":["B1","B2","B3"]}')
GID2=$(echo "$G2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["group_id"])')
curl -s -b $JC -X POST http://127.0.0.1:$B2/api/groups/$GID2/checkout -H 'Content-Type: application/json' -H "Idempotency-Key: race-$GID2" -d '{"billing_name":"Corbett Dental"}' > /dev/null
echo "9 atelier places sold"
curl -s http://127.0.0.1:$B2/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("atelier:", d["tiers"]["atelier"])'

# 6 practitioners race for B4 (the last atelier bench).
PIDS=()
for i in 1 2 3 4 5 6; do
  J=/tmp/race_p$i.txt
  rm -f $J
  curl -s -c $J -X POST http://127.0.0.1:$((4175 + i % 2))/api/auth/signup -H 'Content-Type: application/json' -d "{\"name\":\"P$i\",\"email\":\"p$i@example.test\",\"password\":\"bench-days-2027-pass\",\"kind\":\"practitioner\"}" > /dev/null
done
for i in 1 2 3 4 5 6; do
  J=/tmp/race_p$i.txt
  PORT=$((i % 2 == 0 ? 4176 : 4177))
  curl -s -b $J -X POST http://127.0.0.1:$PORT/api/holds -H 'Content-Type: application/json' -d '{"benches":["B4"]}' > /tmp/race_p${i}_out.json &
done
wait
python3 - <<'EOF'
import json
results = []
for i in range(1, 7):
    r = json.load(open(f"/tmp/race_p{i}_out.json"))
    results.append(r)
winners = [r for r in results if "reservations" in r]
losers = [r for r in results if "error" in r]
print("winners:", len(winners), "losers:", len(losers))
for r in losers:
    print("loser:", r.get("error"), "waitlist:", r.get("waitlist"))
assert len(winners) == 1, f"expected one winner, got {len(winners)}"
assert len(losers) == 5
codes = {r["error"] for r in losers}
assert codes == {"bench_taken"}, f"loser codes: {codes}"
print("last atelier place: exactly one 201, five 409 bench_taken OK")
EOF
curl -s http://127.0.0.1:$B2/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); print("atelier after race:", d["tiers"]["atelier"])'

kill_race
echo "RACE TESTS DONE"
