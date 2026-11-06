#!/bin/bash
# Final compliance checks: origin check, size limits, never-served paths,
# validation shapes and upload type rules.
set -e
cd /app
BASE=http://127.0.0.1:4173

echo "== cross-origin state-changing request => 403 cross_origin"
CODE=$(curl -s -o /tmp/co.json -w "%{http_code}" -X POST $BASE/api/holds -H 'Content-Type: application/json' -H "Origin: http://evil.example" -d '{"benches":["C1"]}')
echo "$CODE $(cat /tmp/co.json)"

echo "== same-origin request passes the check"
JAR=/tmp/compliance.txt
rm -f $JAR
curl -s -c $JAR -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{"name":"Com Ply","email":"comply@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
CODE=$(curl -s -o /tmp/so.json -w "%{http_code}" -b $JAR -X POST $BASE/api/holds -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{"benches":["C6"]}')
echo "$CODE $(head -c 80 /tmp/so.json)"
RID=$(python3 -c 'import json; print(json.load(open("/tmp/so.json"))["reservations"][0]["id"])')

echo "== JSON body over 65,536 bytes => 413 payload_too_large (exactly that is allowed)"
BIG=$(python3 -c 'print("x" * 65537)')
CODE=$(curl -s -o /tmp/big.json -w "%{http_code}" -b $JAR -X POST $BASE/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Origin: $BASE" -d "{\"billing_name\":\"$BIG\"}")
echo "$CODE $(cat /tmp/big.json | head -c 100)"

echo "== malformed JSON => 400 malformed_json"
CODE=$(curl -s -o /tmp/mj.json -w "%{http_code}" -b $JAR -X POST $BASE/api/reservations/$RID/release -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{nope')
echo "$CODE $(cat /tmp/mj.json | head -c 90)"

echo "== bench label outside A1-D6 => 422 on the field"
CODE=$(curl -s -o /tmp/bl.json -w "%{http_code}" -b $JAR -X POST $BASE/api/holds -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{"benches":["Z9"]}')
echo "$CODE $(cat /tmp/bl.json | head -c 130)"

echo "== missing Idempotency-Key on a payment => 422 idempotency_key"
CODE=$(curl -s -o /tmp/ik.json -w "%{http_code}" -b $JAR -X POST $BASE/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{"billing_name":"Com Ply"}')
echo "$CODE $(cat /tmp/ik.json | head -c 130)"

echo "== never-served paths answer 404"
for path in /run.json /package.json /package-lock.json /tsconfig.json /.env /src/server/main.ts; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE$path)
  echo "$path -> $CODE"
done

echo "== directory traversal attempt => 404"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/..%2F..%2Fpackage.json")
echo "traversal -> $CODE"

echo "== API 404 uses the one error shape"
curl -s $BASE/api/nope; echo

echo "== anonymous and signed-in bench states differ"
curl -s $BASE/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); states=set(b["state"] for b in d["benches"]); print("anonymous states:", states)'
curl -s -b $JAR $BASE/api/benches | python3 -c 'import sys,json; d=json.load(sys.stdin); mine=[b for b in d["benches"] if b["state"]=="held_by_you"]; print("signed-in held_by_you:", [b["label"] for b in mine])'

echo "== uploads: SVG content refused with 415"
printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>' > /tmp/fake.svg
curl -s -b $JAR -X POST $BASE/api/reservations/$RID/licence -F "licence_number=IL-1" -F "licence_state=IL" -F "file=@/tmp/fake.svg;type=image/svg+xml" | head -c 120; echo

echo "== uploads: a real PDF is stored and the licence reads submitted"
printf '%%PDF-1.4 compliance licence' > /tmp/licence.pdf
curl -s -b $JAR -X POST $BASE/api/reservations/$RID/licence -F "licence_number=IL-88123" -F "licence_state=Illinois" -F "file=@/tmp/licence.pdf;type=application/pdf" | python3 -c 'import sys,json; r=json.load(sys.stdin)["reservation"]; print("licence:", r["licence_status"], "documents:", r["documents"])'

echo "== the licence link is a short-lived signed URL"
curl -s -b $JAR $BASE/api/reservations/$RID/licence | python3 -c 'import sys,json; d=json.load(sys.stdin); print("expires_in:", d["expires_in"], "url starts:", d["url"][:60])'

echo "== the registrar can read the licence; the buyer cannot see numbers"
rm -f /tmp/compliance_reg.txt
curl -s -c /tmp/compliance_reg.txt -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"registrar@opaline-institute.test","password":"bench-days-registrar-2027"}' > /dev/null
curl -s -b /tmp/compliance_reg.txt $BASE/api/reservations/$RID/licence | python3 -c 'import sys,json; d=json.load(sys.stdin); print("registrar licence:", d.get("licence_number"))'

echo "== staff roles are gated: front desk cannot read a reservation"
rm -f /tmp/compliance_fd.txt
curl -s -c /tmp/compliance_fd.txt -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"frontdesk@opaline-institute.test","password":"bench-days-frontdesk-2027"}' > /dev/null
CODE=$(curl -s -o /tmp/fd.json -w "%{http_code}" -b /tmp/compliance_fd.txt $BASE/api/reservations/$RID)
echo "$CODE $(cat /tmp/fd.json)"

echo "== a practitioner cannot call another person's reservation"
JAR2=/tmp/compliance2.txt
rm -f $JAR2
curl -s -c $JAR2 -X POST $BASE/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Other One","email":"other@example.test","password":"bench-days-2027-pass","kind":"practitioner"}' > /dev/null
CODE=$(curl -s -o /tmp/o.json -w "%{http_code}" -b $JAR2 $BASE/api/reservations/$RID)
echo "$CODE $(cat /tmp/o.json)"

echo "== a staff role never gets 403 on a payment row it can never pass: director => 403"
rm -f /tmp/compliance_dir.txt
curl -s -c /tmp/compliance_dir.txt -X POST $BASE/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"director@opaline-institute.test","password":"bench-days-director-2027"}' > /dev/null
CODE=$(curl -s -o /tmp/dir.json -w "%{http_code}" -b /tmp/compliance_dir.txt -X POST $BASE/api/reservations/$RID/deposit -H 'Content-Type: application/json' -H "Idempotency-Key: compliance-director-1" -d '{"billing_name":"Nope"}')
echo "$CODE $(cat /tmp/dir.json)"

echo "== practitioner blocked from the desks: 403"
CODE=$(curl -s -o /tmp/pd.json -w "%{http_code}" -b $JAR2 $BASE/api/desk/reservations)
echo "$CODE $(cat /tmp/pd.json)"
CODE=$(curl -s -o /tmp/pc.json -w "%{http_code}" -b $JAR2 $BASE/api/desk/inventory)
echo "$CODE $(cat /tmp/pc.json)"

echo "== content desk gated to the director: registrar => 403"
CODE=$(curl -s -o /tmp/rc.json -w "%{http_code}" -b /tmp/compliance_reg.txt $BASE/api/desk/content/faq)
echo "$CODE $(cat /tmp/rc.json)"

echo COMPLIANCE CHECKS DONE
