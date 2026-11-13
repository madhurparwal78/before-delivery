#!/usr/bin/env bash
# End-to-end API smoke test for the critical journeys.
set -u
BASE="http://127.0.0.1:4173"
JAR1=/tmp/jar1.txt
JAR2=/tmp/jar2.txt
rm -f $JAR1 $JAR2
PASS=0; FAIL=0

check() {
  local name="$1"; local expected="$2"; local actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS+1)); echo "PASS: $name";
  else FAIL=$((FAIL+1)); echo "FAIL: $name — expected [$expected] got [$actual]"; fi
}

echo "=== Journey 4: sign in, bag, codes, checkout, pay ==="
# sign in as Asha
R=$(curl -s -c $JAR1 -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"asha@roamhouse.example","password":"travel-asha-01"}')
check "sign in" "Asha Menon" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["user"]["name"])')"

# add MER-GRA-C to bag
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/lines" -H "content-type: application/json" -d '{"sku":"MER-GRA-C","quantity":1}')
check "bag count 1" "1" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')"

# add packing cubes
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/lines" -H "content-type: application/json" -d '{"sku":"PCK-SAG-O","quantity":1}')
check "bag count 2" "2" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')"

# apply TRAVEL10 (worked example: subtotal 13744, discount 1375)
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"travel10"}')
check "TRAVEL10 discount" "1375" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["discount"])')"
check "subtotal" "13744" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["subtotal"])')"
check "tax" "2227" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["tax"])')"
check "total" "14596" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["total"])')"

# expired code
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"SPRING15"}')
check "SPRING15 code_expired" "code_expired" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# exhausted code
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"LAUNCH25"}')
check "LAUNCH25 code_exhausted" "code_exhausted" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# not applicable
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"DUFFEL20"}')
check "DUFFEL20 code_not_applicable" "code_not_applicable" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# minimum not met
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"BIG1500"}')
check "BIG1500 minimum_not_met" "minimum_not_met" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# invalid
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"NOPE123"}')
check "NOPE code_invalid" "code_invalid" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# reapply TRAVEL10
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/cart/codes" -H "content-type: application/json" -d '{"code":"TRAVEL10"}')
check "reapply TRAVEL10" "1375" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["discount"])')"

# create checkout
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/checkout" -H "content-type: application/json" -d '{}')
CO=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
check "checkout created at contact" "contact" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["step"])')"

# invalid contact
R=$(curl -s -b $JAR1 -c $JAR1 -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"contact","email":"bad","phone":"123"}')
check "contact validation" "email" "$(echo "$R" | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["fields"].keys())[0])')"

# good contact
R=$(curl -s -b $JAR1 -c $JAR1 -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"contact","email":"asha@roamhouse.example","phone":"9820012345"}')
check "contact ok → delivery" "delivery" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["step"])')"

# delivery with new address
R=$(curl -s -b $JAR1 -c $JAR1 -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"delivery","address":{"label":"Home","name":"Asha Menon","line1":"14 Carter Road","line2":"","city":"Mumbai","state":"Maharashtra","postcode":"400050","phone":"9820012345"}}')
check "delivery ok → shipping" "shipping" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["step"])')"

# shipping standard
R=$(curl -s -b $JAR1 -c $JAR1 -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"shipping","method":"standard","gift":false}')
check "shipping ok → payment" "payment" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["step"])')"
check "hold none yet" "none" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hold"]["status"])')"

# reserve
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/checkout/$CO/reserve" -H "content-type: application/json" -d '{}')
check "hold active" "active" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hold"]["status"])')"
SECONDS_LEFT=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hold"]["seconds_left"])')
if [ "$SECONDS_LEFT" -le 600 ] && [ "$SECONDS_LEFT" -ge 590 ]; then PASS=$((PASS+1)); echo "PASS: hold seconds ~600"; else FAIL=$((FAIL+1)); echo "FAIL: hold seconds ~600 — got [$SECONDS_LEFT]"; fi

# declined card
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: abc12345" -d "{\"checkout_id\":$CO,\"card\":{\"number\":\"4000 0000 0000 0002\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}")
check "declined card" "card_declined" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# good card with a fresh key
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: def67891" -d "{\"checkout_id\":$CO,\"card\":{\"number\":\"4242 4242 4242 4242\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}")
ON=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["number"])')
check "order placed" "placed" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
check "order total 14596" "14596" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"]["total"])')"
check "payment captured" "captured" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["payment"]["status"])')"
check "confirmation emailed" "True" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["confirmation_emailed_at"] is not None)')"
echo "order number: $ON"

# replay same key same body
R=$(curl -s -b $JAR1 -c $JAR1 -o /tmp/replay.json -w "%{http_code}" -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: def67891" -d "{\"checkout_id\":$CO,\"card\":{\"number\":\"4242 4242 4242 4242\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}")
check "replay returns 201" "201" "$R"
check "replay same order" "$ON" "$(python3 -c 'import json; print(json.load(open("/tmp/replay.json"))["number"])')"

# same key different body → mismatch
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: def67891" -d "{\"checkout_id\":$CO,\"card\":{\"number\":\"4242 4242 4242 4241\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}")
check "idempotency mismatch" "idempotency_mismatch" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# missing key
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/orders" -H "content-type: application/json" -d "{\"checkout_id\":$CO,\"card\":{\"number\":\"4242 4242 4242 4242\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}")
check "missing idempotency key" "Idempotency-Key" "$(echo "$R" | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["fields"].keys())[0])')"

echo ""
echo "=== Isolation: another shopper cannot read the order ==="
R=$(curl -s -c $JAR2 -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"dev@roamhouse.example","password":"travel-dev-02"}' > /dev/null)
R=$(curl -s -b $JAR2 -c $JAR2 "$BASE/api/orders/$ON")
check "other customer order not_found" "not_found" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

echo ""
echo "=== Staff fulfilment ==="
JAR_OPS=/tmp/jar_ops.txt
curl -s -c $JAR_OPS -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"ops@roamhouse.example","password":"ops-priya-03"}' > /dev/null
R=$(curl -s -b $JAR_OPS -c $JAR_OPS "$BASE/api/admin/orders/$ON")
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
LINES=$(echo "$R" | python3 -c 'import json,sys; print(",".join(str(l["id"]) for l in json.load(sys.stdin)["lines"]))')
L1=$(echo "$LINES" | cut -d, -f1)
echo "order version: $V lines: $LINES"

# mark packed (with wrong version → stale)
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/status" -H "content-type: application/json" -d "{\"version\":999,\"status\":\"packed\"}")
check "stale version refused" "stale_version" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

# mark packed (correct version, re-read fresh)
R=$(curl -s -b $JAR_OPS -c $JAR_OPS "$BASE/api/admin/orders/$ON")
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/status" -H "content-type: application/json" -d "{\"version\":$V,\"status\":\"packed\"}")
check "order packed" "packed" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
V2=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')

# ship line 1 only → partially shipped
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/shipments" -H "content-type: application/json" -d "{\"version\":$V2,\"line_ids\":[$L1],\"carrier\":\"Coastline Couriers\",\"tracking_number\":\"CL-123456\"}")
check "partial shipment" "partially_shipped" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
V3=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')

# ship the rest → shipped
REST=$(echo "$LINES" | cut -d, -f2)
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/shipments" -H "content-type: application/json" -d "{\"version\":$V3,\"line_ids\":[$REST],\"carrier\":\"Peak Express\",\"tracking_number\":\"PE-654321\"}")
check "full shipment" "shipped" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
V4=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')

# out for delivery → delivered
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/status" -H "content-type: application/json" -d "{\"version\":$V4,\"status\":\"out_for_delivery\"}")
V5=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(curl -s -b $JAR_OPS -c $JAR_OPS -X POST "$BASE/api/admin/orders/$ON/status" -H "content-type: application/json" -d "{\"version\":$V5,\"status\":\"delivered\"}")
check "delivered" "delivered" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
TL=$(echo "$R" | python3 -c 'import json,sys; print(",".join(t["status"] for t in json.load(sys.stdin)["timeline"]))')
check "timeline full" "placed,packed,partially_shipped,shipped,out_for_delivery,delivered" "$TL"

echo ""
echo "=== Return and refund ==="
R=$(curl -s -b $JAR1 -c $JAR1 "$BASE/api/orders/$ON")
LINE=$(echo "$R" | python3 -c 'import json,sys; print([l["id"] for l in json.load(sys.stdin)["lines"] if l["sku"]=="MER-GRA-C"][0])')
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/returns" -H "content-type: application/json" -d "{\"order_line_id\":$LINE,\"quantity\":1,\"reason\":\"Wrong size\",\"outcome\":\"refund\"}")
RT=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["number"])')
check "return requested" "requested" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

# duplicate open return refused
R=$(curl -s -b $JAR1 -c $JAR1 -X POST "$BASE/api/returns" -H "content-type: application/json" -d "{\"order_line_id\":$LINE,\"quantity\":1,\"reason\":\"Wrong size\",\"outcome\":\"refund\"}")
check "duplicate return refused" "duplicate_request" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"

JAR_SUP=/tmp/jar_sup.txt
curl -s -c $JAR_SUP -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"support@roamhouse.example","password":"support-tomas-04"}' > /dev/null

approve() {
  local num="$1"; local to="$2"; local ver="$3"; local extra="${4:-}"
  curl -s -b $JAR_SUP -c $JAR_SUP -X POST "$BASE/api/admin/returns/$num/transition" -H "content-type: application/json" -d "{\"version\":$ver,\"to\":\"$to\"$extra}"
}
R=$(curl -s -b $JAR_SUP -c $JAR_SUP "$BASE/api/admin/returns/$RT")
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(approve $RT approved $V)
check "return approved" "approved" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(approve $RT in_transit $V)
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(approve $RT received $V)
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(approve $RT inspected $V)
V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
R=$(approve $RT refunded $V)
check "return refunded" "refunded" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
# Paid share: (12499-1250) + tax 2025 = 13274
R=$(curl -s -b $JAR1 -c $JAR1 "$BASE/api/returns/$RT")
check "refund amount 13274" "13274" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["refund_amount"])')"

echo ""
echo "=== Roles ==="
R=$(curl -s -b $JAR1 "$BASE/api/admin/orders")
check "customer refused admin" "forbidden" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"
R=$(curl -s -b $JAR_OPS "$BASE/api/admin/returns")
check "operations refused support route" "forbidden" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"
R=$(curl -s -b $JAR_SUP "$BASE/api/admin/orders")
check "support reads orders" "$ON" "$(echo "$R" | python3 -c 'import json,sys; print([o["number"] for o in json.load(sys.stdin)][0])' 2>/dev/null | head -c 30)"

echo ""
echo "=== Stock ledger ==="
R=$(curl -s -b $JAR_OPS "$BASE/api/admin/inventory/MER-GRA-C/movements")
echo "movements: $(echo "$R" | head -c 120)"
ZERO=$(echo "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(all(sum(e["quantity"] for e in m["entries"])==0 for m in d))')
check "movements sum to zero" "True" "$ZERO"

echo ""
echo "=== Boundary ==="
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/cart/lines" -H "content-type: application/json" -H "Origin: http://evil.example" -d '{"sku":"MER-GRA-C","quantity":1}')
check "cross-origin write" "403" "$R"
R=$(curl -s -X POST "$BASE/api/cart/lines" -H "content-type: text/plain" -d '{}')
check "wrong content type" "unsupported_media_type" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])')"
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/.env")
check "env file denied" "404" "$R"
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/package.json")
check "package.json denied" "404" "$R"
R=$(curl -s "$BASE/api/wishlist" -X POST -H "content-type: application/json" -d '{}')
check "unknown method on known path" "405" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/wishlist" -X POST -H "content-type: application/json" -d '{}')"

echo ""
echo "========================"
echo "PASS: $PASS  FAIL: $FAIL"

echo ""
echo "=== Journey 3: last-unit race ==="
JARA=/tmp/jarA.txt; JARB=/tmp/jarB.txt
rm -f $JARA $JARB
curl -s -c $JARA -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"asha@roamhouse.example","password":"travel-asha-01"}' > /dev/null
curl -s -c $JARB -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"dev@roamhouse.example","password":"travel-dev-02"}' > /dev/null
curl -s -b $JARA -c $JARA -X POST "$BASE/api/cart/lines" -H "content-type: application/json" -d '{"sku":"MER-RED-C","quantity":1}' > /dev/null
curl -s -b $JARB -c $JARB -X POST "$BASE/api/cart/lines" -H "content-type: application/json" -d '{"sku":"MER-RED-C","quantity":1}' > /dev/null
# both check out
COA=$(curl -s -b $JARA -c $JARA -X POST "$BASE/api/checkout" -H "content-type: application/json" -d '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
COB=$(curl -s -b $JARB -c $JARB -X POST "$BASE/api/checkout" -H "content-type: application/json" -d '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
for CO in $COA $COB; do
  J=$JARA; if [ "$CO" = "$COB" ]; then J=$JARB; fi
  curl -s -b $J -c $J -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"contact","email":"a@example.test","phone":"9800000001"}' > /dev/null
  curl -s -b $J -c $J -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"delivery","address":{"label":"Home","name":"A B","line1":"1 Lane","line2":"","city":"Pune","state":"Maharashtra","postcode":"411001","phone":"9800000001"}}' > /dev/null
  curl -s -b $J -c $J -X PATCH "$BASE/api/checkout/$CO" -H "content-type: application/json" -d '{"step":"shipping","method":"standard","gift":false}' > /dev/null
done
# both press pay at the same moment
(curl -s -b $JARA -c $JARA -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: race-key-a1" -d "{\"checkout_id\":$COA,\"card\":{\"number\":\"4242424242424242\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}" > /tmp/raceA.json) &
(curl -s -b $JARB -c $JARB -X POST "$BASE/api/orders" -H "content-type: application/json" -H "Idempotency-Key: race-key-b2" -d "{\"checkout_id\":$COB,\"card\":{\"number\":\"4242424242424242\",\"expiry\":\"11/28\",\"cvc\":\"123\"}}" > /tmp/raceB.json) &
wait
A=$(python3 -c 'import json; d=json.load(open("/tmp/raceA.json")); print(d.get("error","ok"))')
B=$(python3 -c 'import json; d=json.load(open("/tmp/raceB.json")); print(d.get("error","ok"))')
if { [ "$A" = "ok" ] && [ "$B" = "out_of_stock" ]; } || { [ "$B" = "ok" ] && [ "$A" = "out_of_stock" ]; }; then
  PASS=$((PASS+1)); echo "PASS: last-unit race — exactly one wins"
else
  FAIL=$((FAIL+1)); echo "FAIL: last-unit race — A=[$A] B=[$B]"
fi
# stock is gone
R=$(curl -s "$BASE/api/variants/MER-RED-C/stock")
check "last unit gone" "0" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["available"])')"

echo ""
echo "=== Warranty journey ==="
JAR_W=/tmp/jarw.txt
rm -f $JAR_W
# Asha's delivered order has MER-GRA-C line
ORD=$(curl -s -b $JARA "$BASE/api/orders" | python3 -c 'import json,sys; print([o["number"] for o in json.load(sys.stdin) if o["status"]=="delivered"][0])')
R=$(curl -s -b $JARA -c $JARA "$BASE/api/orders/$ORD")
MERLINE=$(echo "$R" | python3 -c 'import json,sys; print([l["id"] for l in json.load(sys.stdin)["lines"] if l["sku"]=="MER-GRA-C"][0])')
R=$(curl -s -b $JARA -c $JARA -X POST "$BASE/api/warranty/registrations" -H "content-type: application/json" -d "{\"order_line_id\":$MERLINE}")
REG=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
check "warranty registered" "True" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["covered_until"] is not None)')"

# make a tiny photo
python3 -c "
import struct, zlib
def chunk(t, data):
    c = t + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)
raw = b''.join(b'\x00' + b'\xff\x40\x40' * 8 for _ in range(8))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('/tmp/photo.png','wb').write(png)
"
R=$(curl -s -b $JARA -c $JARA -X POST "$BASE/api/warranty/evidence" -F "kind=photo" -F "file=@/tmp/photo.png")
EV=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
check "evidence stored" "stored" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

R=$(curl -s -b $JARA -c $JARA -X POST "$BASE/api/warranty/claims" -H "content-type: application/json" -d "{\"registration_id\":$REG,\"component\":\"Wheels\",\"description\":\"The front left wheel snapped off on the first trip.\",\"evidence_ids\":[$EV]}")
WC=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["number"])')
check "claim submitted" "submitted" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

# support moves it through to replacement
JAR_S=/tmp/jars.txt
rm -f $JAR_S
curl -s -c $JAR_S -X POST "$BASE/api/session" -H "content-type: application/json" -d '{"email":"support@roamhouse.example","password":"support-tomas-04"}' > /dev/null
wmove() {
  curl -s -b $JAR_S -c $JAR_S -X POST "$BASE/api/admin/warranty/$WC/transition" -H "content-type: application/json" -d "{\"version\":$2,\"to\":\"$3\"}"
}
V=1
for TO in under_review approved replacement; do
  R=$(wmove $WC $V $TO)
  V=$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
done
check "claim replacement" "replacement" "$(echo "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

echo ""
echo "========================"
echo "PASS: $PASS  FAIL: $FAIL"
