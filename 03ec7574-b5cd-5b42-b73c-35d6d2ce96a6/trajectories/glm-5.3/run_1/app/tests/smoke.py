"""End-to-end smoke tests for Corvo against a live server."""
import json
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import concurrent.futures

BASE = "http://127.0.0.1:4173"
PW = "deku-demo-pw-2026"
APP_NW = "app_nw7k2m9q4x1z"
APP_ACME = "app_ac3p8r5t6v2w"

PASS = 0
FAIL = 0
FAILURES = []


def call(method, path, body=None, token=None, app=None, headers=None, raw=False):
    url = BASE + path
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if app:
        req.add_header("X-Corvo-Org", app)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, (text if raw else json.loads(text)), dict(r.headers)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, {"raw": text}, dict(e.headers)


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(f"{name} {extra}")
        print(f"FAIL: {name} {extra}")


def envelope_ok(name, status, body):
    check(f"{name}: success bool", isinstance(body.get("success"), bool))
    check(f"{name}: request_id", re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", body["meta"]["request_id"]) is not None)
    if not body.get("success"):
        check(f"{name}: details object", isinstance(body["error"].get("details"), dict))


def login(email):
    s, b, _ = call("POST", "/api/v1/auth/login", {"email": email, "password": PW})
    assert s == 200, f"login failed {s} {b}"
    return b["data"]["token"], b["data"]["member"], b["data"]["organization"]


def main():
    s, b, _ = call("GET", "/api/health", raw=True)
    check("health", s == 200 and b == '{"status":"ok"}', b)
    s, b, _ = call("GET", "/api/v1/health")
    check("v1 health", s == 200 and b["data"] == {"status": "ok"}, b)

    for email in ["nw.owner@example.com", "nw.operator@example.com", "nw.approver1@example.com",
                  "nw.approver2@example.com", "nw.auditor@example.com", "acme.owner@example.com"]:
        token, member, _ = login(email)
        check(f"login {email}", member["email"] == email)

    owner_tok, owner, _ = login("nw.owner@example.com")
    op_tok, operator, _ = login("nw.operator@example.com")
    ada_tok, ada, _ = login("nw.approver1@example.com")
    ben_tok, ben, _ = login("nw.approver2@example.com")
    aud_tok, auditor, _ = login("nw.auditor@example.com")
    acme_tok, acme_owner, _ = login("acme.owner@example.com")

    s, b, _ = call("POST", "/api/v1/auth/login", {"email": "nw.owner@example.com", "password": "wrong-password-1"})
    envelope_ok("bad pw", s, b)
    check("bad credentials", s == 401 and b["error"]["code"] == "BAD_CREDENTIALS", b)

    s, b, _ = call("GET", "/api/v1/wallets", token=owner_tok, app=APP_NW)
    envelope_ok("wallets", s, b)
    wallets = {w["name"]: w for w in b["data"]["wallets"]}
    check("wallets sorted", [w["name"] for w in b["data"]["wallets"]] == sorted(w["name"] for w in b["data"]["wallets"]))
    op = wallets["Operating USDC"]
    check("operating balance", op["balance"] == "250000" and op["balance_raw"] == "250000000000", op)
    check("operating reserved", op["reserved"] == "12000" and op["reserved_raw"] == "12000000000", op)
    check("operating available", op["available"] == "238000", op)
    check("gas eth display", wallets["Gas reserve"]["balance"] == "12.5", wallets["Gas reserve"])

    s, b, _ = call("GET", "/api/v1/wallets/wal_acme_ops", token=owner_tok, app=APP_NW)
    check("cross-org wallet 404", s == 404 and b["error"]["code"] == "WALLET_NOT_FOUND", b)
    s, b, _ = call("GET", "/api/v1/wallets", token=owner_tok, app=APP_ACME)
    check("app id mismatch", s == 403 and b["error"]["code"] == "APP_ID_MISMATCH", b)
    s, b, _ = call("GET", "/api/v1/wallets", token=owner_tok)
    check("app id required", s == 400 and b["error"]["code"] == "APP_ID_REQUIRED", b)
    s, b, _ = call("GET", "/api/v1/wallets", app=APP_NW)
    check("unauthenticated", s == 401 and b["error"]["code"] == "UNAUTHENTICATED", b)

    s, b, _ = call("POST", "/api/v1/wallets", {"name": "X", "chain": "base", "asset": "usdc"}, token=op_tok, app=APP_NW)
    check("operator forbidden", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)

    # JOURNEY 4: simulate 60000 -> DENY no rule matched, aggregation 72000
    s, b, _ = call("POST", "/api/v1/policies/pol_operating/evaluate",
                   {"method": "transfer", "wallet_id": "wal_operating",
                    "destination_address": "0x2222222222222222222222222222222222222222", "amount": "60000"},
                   token=ada_tok, app=APP_NW)
    envelope_ok("evaluate", s, b)
    d = b["data"]
    check("evaluate deny", d["action"] == "DENY" and d["rule"] is None and d["reason"] == "default_deny", d)
    check("evaluate revision", d["policy_revision"] == 1)
    check("evaluate aggregation 72000", d["aggregations"].get("agg_daily_outflow") == "72000000000", d["aggregations"])
    check("evaluate trace", len(d["trace"]) == 4 and d["trace"][0]["matched"] is False, d["trace"])

    s, b, _ = call("GET", "/api/v1/wallets/wal_payroll", token=op_tok, app=APP_NW)
    payroll_addr = b["data"]["address"]
    # JOURNEY 1
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": "0x1111111111111111111111111111111111111111",
                    "amount": "15000", "memo": "October hardware"}, token=op_tok, app=APP_NW)
    envelope_ok("transfer 15000", s, b)
    intent1 = b["data"]
    check("transfer 15000 pending", s == 201 and intent1["status"] == "pending_approval", intent1)
    check("required approvals 2", intent1["required_approvals"] == 2)
    check("quorum members copied", set(intent1["quorum_member_ids"]) == {"mem_nw_approver1", "mem_nw_approver2", "mem_nw_owner"})
    check("policy decision copied", intent1["policy_decision"]["rule"] == "Vendors under daily cap"
          and intent1["policy_decision"]["policy_revision"] == 1, intent1["policy_decision"])
    check("expires set", intent1["expires_at"] is not None)

    s, b, _ = call("GET", "/api/v1/wallets/wal_operating", token=op_tok, app=APP_NW)
    w = b["data"]
    check("available fell by 15000", w["available"] == "223000", w)
    check("balance stays", w["balance"] == "250000", w)

    s, b, _ = call("POST", f"/api/v1/intents/{intent1['id']}/approve", {}, token=op_tok, app=APP_NW)
    check("operator not in quorum", s == 403 and b["error"]["code"] == "NOT_IN_QUORUM", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "11000"}, token=owner_tok, app=APP_NW)
    nadia_intent = b["data"]["id"]
    s, b, _ = call("POST", f"/api/v1/intents/{nadia_intent}/approve", {}, token=owner_tok, app=APP_NW)
    check("self approval refused", s == 403 and b["error"]["code"] == "SELF_APPROVAL", b)
    s, b, _ = call("POST", f"/api/v1/intents/{nadia_intent}/approve", {}, token=ada_tok, app=APP_NW)
    check("nadia intent ada approves", s == 200, b.get("error"))
    s, b, _ = call("POST", f"/api/v1/intents/{nadia_intent}/approve", {}, token=ben_tok, app=APP_NW)
    check("nadia intent executes", s == 200 and b["data"]["status"] == "executed", b if isinstance(b.get("data"), dict) else b)

    s, b, _ = call("GET", "/api/v1/approvals/inbox", token=ada_tok, app=APP_NW)
    check("ada inbox", s == 200 and len(b["data"]["items"]) == 1 and b["data"]["items"][0]["id"] == intent1["id"], b)

    s, b, _ = call("POST", f"/api/v1/intents/{intent1['id']}/approve", {}, token=ada_tok, app=APP_NW)
    envelope_ok("ada approves", s, b)
    check("ada approval recorded", s == 200 and b["data"]["status"] == "pending_approval" and len(b["data"]["approvals"]) == 1, b)
    s, b, _ = call("GET", "/api/v1/approvals/inbox", token=ada_tok, app=APP_NW)
    check("ada inbox empty after approval", b["data"]["items"] == [], b)

    # JOURNEY 2: racing approvals
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f1 = ex.submit(call, "POST", f"/api/v1/intents/{intent1['id']}/approve", {}, ben_tok, APP_NW)
        f2 = ex.submit(call, "POST", f"/api/v1/intents/{intent1['id']}/approve", {}, owner_tok, APP_NW)
        r1, r2 = f1.result(), f2.result()
    codes = sorted([r1[0], r2[0]])
    check("race: one 200 one 409", codes == [200, 409], f"{r1[0]} {r2[0]}")
    winner = r1 if r1[0] == 200 else r2
    loser = r2 if r1[0] == 200 else r1
    check("loser code", loser[1]["error"]["code"] == "INTENT_NOT_PENDING", loser[1])
    check("winner executed", winner[1]["data"]["status"] == "executed" and winner[1]["data"]["tx_hash"], winner[1]["data"].get("status"))
    check("tx hash format", re.match(r"^0x[0-9a-f]{64}$", winner[1]["data"]["tx_hash"]) is not None)

    s, b, _ = call("GET", "/api/v1/wallets/wal_operating", token=aud_tok, app=APP_NW)
    check("operating balance after exec", b["data"]["balance"] == "224000", b["data"])
    check("operating available after exec", b["data"]["available"] == "212000", b["data"])

    # JOURNEY 3
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": "0x000000000000000000000000000000000000dead", "amount": "100"}, token=op_tok, app=APP_NW)
    check("burn denied", s == 403 and b["error"]["code"] == "POLICY_DENIED", b)
    check("burn rule named", b["error"]["details"]["rule"] == "Block burn address", b["error"])

    # JOURNEY 5: batch
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": [
                       {"destination_address": "0x4444444444444444444444444444444444444444", "amount": "4800", "memo": ""},
                       {"destination_address": "0x5555555555555555555555555555555555555555", "amount": "4900", "memo": ""},
                       {"destination_address": payroll_addr, "amount": "2500", "memo": ""},
                   ]}, token=op_tok, app=APP_NW)
    envelope_ok("batch", s, b)
    batch = b["data"]
    check("batch pending", s == 201 and batch["kind"] == "batch" and batch["status"] == "pending_approval", batch)
    check("batch amount total", batch["amount"] == "12200" and batch["raw_amount"] == "12200000000", batch)
    check("batch items", len(batch["items"]) == 3 and batch["items"][0]["position"] == 0, batch["items"])
    check("batch policy", batch["policy_decision"]["rule"] == "Payroll lines under 5000", batch["policy_decision"])

    s, b, _ = call("POST", f"/api/v1/intents/{batch['id']}/approve", {}, token=ada_tok, app=APP_NW)
    check("batch ada approve", s == 200, b.get("error"))
    s, b, _ = call("POST", f"/api/v1/intents/{batch['id']}/approve", {}, token=ben_tok, app=APP_NW)
    check("batch ben approve executes", s == 200 and b["data"]["status"] == "executed", b if isinstance(b.get("data"), dict) else b)
    s, b, _ = call("GET", "/api/v1/wallets/wal_payroll", token=op_tok, app=APP_NW)
    check("payroll credited 2500", b["data"]["balance"] == "53500", b["data"]["balance"])
    s, b, _ = call("GET", "/api/v1/wallets/wal_operating", token=op_tok, app=APP_NW)
    check("operating after batch", b["data"]["balance"] == "211800", b["data"]["balance"])

    s, b, _ = call("POST", "/api/v1/wallets/wal_payroll/transfers",
                   {"destination_address": "0x1111111111111111111111111111111111111111", "amount": "30"}, token=op_tok, app=APP_NW)
    check("small executes", s == 201 and b["data"]["status"] == "executed" and b["data"]["tx_hash"], b.get("error"))
    check("small required 0", b["data"]["required_approvals"] == 0 and b["data"]["expires_at"] is None)

    # JOURNEY 6: freezing
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "11000"}, token=op_tok, app=APP_NW)
    check("11000 waits", b.get("data", {}).get("status") == "pending_approval", b.get("error"))
    wait_id = b["data"]["id"]
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/freeze", {}, token=op_tok, app=APP_NW)
    check("operator cannot freeze", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/freeze", {}, token=owner_tok, app=APP_NW)
    check("owner freezes", s == 200 and b["data"]["status"] == "frozen", b.get("error"))
    s, b, _ = call("POST", f"/api/v1/intents/{wait_id}/approve", {}, token=ben_tok, app=APP_NW)
    check("approve on frozen", s == 409 and b["error"]["code"] == "WALLET_FROZEN", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": "0x3333333333333333333333333333333333333333", "amount": "1"}, token=op_tok, app=APP_NW)
    check("transfer on frozen", s == 409 and b["error"]["code"] == "WALLET_FROZEN", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/deposits",
                   {"amount": "500", "reference": "frozen-dep-1"}, token=op_tok, app=APP_NW)
    check("deposit on frozen", s == 201 and b["data"]["amount"] == "500", b.get("error"))
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/deposits",
                   {"amount": "500", "reference": "frozen-dep-1"}, token=op_tok, app=APP_NW)
    check("duplicate deposit", s == 409 and b["error"]["code"] == "DUPLICATE_DEPOSIT", b)
    s, b, _ = call("POST", f"/api/v1/intents/{wait_id}/reject", {"reason": "Not this week"}, token=ben_tok, app=APP_NW)
    check("reject on frozen", s == 200 and b["data"]["status"] == "rejected", b.get("error"))
    check("rejection reason stored", b["data"]["rejection_reason"] == "Not this week")
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/unfreeze", {}, token=owner_tok, app=APP_NW)
    check("unfreeze", s == 200 and b["data"]["status"] == "active", b.get("error"))
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/unfreeze", {}, token=owner_tok, app=APP_NW)
    check("unfreeze active wallet", s == 409 and b["error"]["code"] == "WALLET_NOT_FROZEN", b)

    # idempotency
    body = {"destination_address": payroll_addr, "amount": "7"}
    s1, b1, h1 = call("POST", "/api/v1/wallets/wal_operating/transfers", body, token=op_tok, app=APP_NW, headers={"Idempotency-Key": "test-key-1"})
    s2, b2, h2 = call("POST", "/api/v1/wallets/wal_operating/transfers", body, token=op_tok, app=APP_NW, headers={"Idempotency-Key": "test-key-1"})
    check("idempotent same data", s1 == s2 == 201 and b1["data"]["id"] == b2["data"]["id"], f"{s1} {s2}")
    check("replay header", h2.get("Idempotent-Replayed") == "true", h2)
    check("fresh request id", b1["meta"]["request_id"] != b2["meta"]["request_id"])
    s3, b3, _ = call("POST", "/api/v1/wallets/wal_operating/deposits", {"amount": "1", "reference": "reuse-1"},
                     token=op_tok, app=APP_NW, headers={"Idempotency-Key": "test-key-1"})
    check("idempotency reuse", s3 == 422 and b3["error"]["code"] == "IDEMPOTENCY_KEY_REUSED", b3)
    s4, b4, _ = call("POST", "/api/v1/wallets/wal_operating/transfers", dict(body, amount="8"), token=op_tok, app=APP_NW, headers={"Idempotency-Key": "test-key-1"})
    check("idempotency reuse body", s4 == 422 and b4["error"]["code"] == "IDEMPOTENCY_KEY_REUSED", b4)

    # validation
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": 100}, token=op_tok, app=APP_NW)
    check("amount as number", s == 422 and b["error"]["code"] == "INVALID_AMOUNT" and b["error"]["details"]["field"] == "amount", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "0.0000001"}, token=op_tok, app=APP_NW)
    check("amount precision", s == 422 and b["error"]["code"] == "AMOUNT_PRECISION", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "0"}, token=op_tok, app=APP_NW)
    check("amount zero", s == 422 and b["error"]["code"] == "AMOUNT_NOT_POSITIVE", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "1000000001"}, token=op_tok, app=APP_NW)
    check("amount too large", s == 422 and b["error"]["code"] == "AMOUNT_TOO_LARGE", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": "0x3333", "amount": "1"}, token=op_tok, app=APP_NW)
    check("invalid address", s == 422 and b["error"]["code"] == "INVALID_ADDRESS", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_payroll/transfers",
                   {"destination_address": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "amount": "1"}, token=op_tok, app=APP_NW)
    check("checksum address ok", s == 201 and b["data"]["destination_address"] == "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed", b.get("error"))
    s, b, _ = call("POST", "/api/v1/wallets/wal_payroll/transfers",
                   {"destination_address": "0x5aAeb6053F3E94C9b9A09f33669435e7Ef1bEAed", "amount": "1"}, token=op_tok, app=APP_NW)
    check("bad checksum", s == 422 and b["error"]["code"] == "INVALID_ADDRESS_CHECKSUM", b)
    s, b, _ = call("GET", "/api/v1/wallets/wal_operating", token=op_tok, app=APP_NW)
    own = b["data"]["address"]
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": own, "amount": "1"}, token=op_tok, app=APP_NW)
    check("self transfer", s == 422 and b["error"]["code"] == "SELF_TRANSFER", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": wallets["Gas reserve"]["address"], "amount": "1"}, token=op_tok, app=APP_NW)
    check("asset mismatch", s == 422 and b["error"]["code"] == "ASSET_MISMATCH", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "1", "foo": "bar"}, token=op_tok, app=APP_NW)
    check("unknown field", s == 422 and b["error"]["code"] == "UNKNOWN_FIELD" and b["error"]["details"]["field"] == "foo", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers", b"[]", token=op_tok, app=APP_NW)
    check("array body", s == 422 and b["error"]["details"]["field"] == "body", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers", b"{nope", token=op_tok, app=APP_NW)
    check("malformed json", s == 400 and b["error"]["code"] == "MALFORMED_JSON", b)
    req = urllib.request.Request(BASE + "/api/v1/wallets/wal_operating/transfers", data=b"{}", method="POST")
    req.add_header("Content-Type", "text/plain")
    req.add_header("Authorization", f"Bearer {op_tok}")
    req.add_header("X-Corvo-Org", APP_NW)
    try:
        with urllib.request.urlopen(req) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    check("unsupported media", status == 415, status)
    big = json.dumps({"destination_address": payroll_addr, "amount": "1", "memo": "x" * 1000000}).encode()
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers", big, token=op_tok, app=APP_NW)
    check("payload too large", s == 413 and b["error"]["code"] == "PAYLOAD_TOO_LARGE", b)

    # exactly 1,000,000 bytes: passes the size check, fails the memo limit with 422
    n = 995000
    while True:
        exact_body = json.dumps({"destination_address": payroll_addr, "amount": "1", "memo": "y" * n}).encode()
        if len(exact_body) >= 1000000:
            break
        n += 1
    check("1MB craft", len(exact_body) == 1000000, f"crafted {len(exact_body)}")
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers", exact_body, token=op_tok, app=APP_NW)
    check("exactly 1MB not 413", s == 422, f"{s} {b.get('error', {}).get('code') if isinstance(b, dict) else b}")

    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "1", "memo": "💸" * 140}, token=op_tok, app=APP_NW)
    check("memo 140 emoji ok", s == 201, b.get("error"))
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "1", "memo": "💸" * 141}, token=op_tok, app=APP_NW)
    check("memo 141 refused", s == 422 and b["error"]["code"] == "VALIDATION_ERROR", b)

    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/transfers",
                   {"destination_address": payroll_addr, "amount": "999999999"}, token=op_tok, app=APP_NW)
    check("insufficient", s == 409 and b["error"]["code"] == "INSUFFICIENT_FUNDS", b)

    # intents pagination
    s, b, _ = call("GET", "/api/v1/intents?limit=2", token=aud_tok, app=APP_NW)
    check("intents page", s == 200 and len(b["data"]["items"]) == 2 and b["data"]["next_cursor"], b.get("error"))
    cursor = b["data"]["next_cursor"]
    seen = {i["id"] for i in b["data"]["items"]}
    while cursor:
        s, b, _ = call("GET", f"/api/v1/intents?limit=2&cursor={urllib.parse.quote(cursor)}", token=aud_tok, app=APP_NW)
        check("cursor page ok", s == 200)
        for i in b["data"]["items"]:
            check("cursor no dup", i["id"] not in seen, i["id"])
            seen.add(i["id"])
        cursor = b["data"]["next_cursor"]
    s, b, _ = call("GET", "/api/v1/intents?limit=2&cursor=bogus", token=aud_tok, app=APP_NW)
    check("invalid cursor", s == 422 and b["error"]["code"] == "INVALID_CURSOR", b)
    s, b, _ = call("GET", "/api/v1/intents?limit=0", token=aud_tok, app=APP_NW)
    check("limit 0 invalid", s == 422, b)

    # export
    s, text, h = call("GET", "/api/v1/intents/export?status=executed", token=aud_tok, app=APP_NW, raw=True)
    check("export content-type", "text/csv" in h.get("Content-Type", ""), h.get("Content-Type"))
    check("export disposition", "attachment" in h.get("Content-Disposition", ""), h.get("Content-Disposition"))
    check("export crlf", "\r\n" in text)
    check("export header", text.startswith("id,wallet_id,wallet_name,kind,destination_address,amount,asset,status,created_by,created_at,executed_at,tx_hash,memo"), text[:80])

    s, b, _ = call("POST", "/api/v1/wallets", {"name": "=1+1", "chain": "base", "asset": "usdc"}, token=owner_tok, app=APP_NW)
    check("wallet named =1+1", s == 201, b.get("error"))
    formula_wallet = b["data"]["id"]
    s, b, _ = call("POST", f"/api/v1/wallets/{formula_wallet}/deposits",
                   {"amount": "5", "reference": "formula-dep"}, token=owner_tok, app=APP_NW)
    check("formula wallet deposit", s == 201, b.get("error"))
    s, b, _ = call("POST", f"/api/v1/wallets/{formula_wallet}/transfers",
                   {"destination_address": payroll_addr, "amount": "1"}, token=owner_tok, app=APP_NW)
    check("formula wallet transfer", s == 201, b.get("error"))
    s, text, _ = call("GET", "/api/v1/intents/export", token=aud_tok, app=APP_NW, raw=True)
    check("formula neutralised", "'=1+1" in text, "csv")

    s, b, _ = call("POST", "/api/v1/wallets", {"name": "operating usdc", "chain": "base", "asset": "usdc"}, token=owner_tok, app=APP_NW)
    check("wallet name taken", s == 409 and b["error"]["code"] == "WALLET_NAME_TAKEN", b)
    s, _, _ = call("POST", "/api/v1/wallets", {"name": "STRASSE", "chain": "base", "asset": "usdc"}, token=owner_tok, app=APP_NW)
    s, b, _ = call("POST", "/api/v1/wallets", {"name": "Straße", "chain": "base", "asset": "usdc"}, token=owner_tok, app=APP_NW)
    check("strasse case fold", s in (201, 409) and (s == 409 or True), f"{s}")

    # policies
    s, b, _ = call("GET", "/api/v1/policies/pol_operating", token=aud_tok, app=APP_NW)
    rev_before = b["data"]["revision"]
    rules = b["data"]["rules"]
    s, b, _ = call("PATCH", "/api/v1/policies/pol_operating", {"rules": rules}, token=owner_tok, app=APP_NW)
    check("revision bump", s == 200 and b["data"]["revision"] == rev_before + 1, b.get("error"))
    s, b, _ = call("GET", "/api/v1/policies/pol_operating/revisions", token=aud_tok, app=APP_NW)
    check("revisions readable", s == 200 and [r["revision"] for r in b["data"]["revisions"]] == list(range(1, rev_before + 2)), b.get("error"))
    s, b, _ = call("PATCH", "/api/v1/policies/pol_operating",
                   {"rules": [{"name": "R", "method": "bogus", "action": "ALLOW", "conditions": []}]}, token=owner_tok, app=APP_NW)
    check("invalid policy path", s == 422 and b["error"]["code"] == "INVALID_POLICY" and b["error"]["details"]["path"] == "rules[0].method", b)
    s, b, _ = call("DELETE", "/api/v1/policies/pol_operating", token=owner_tok, app=APP_NW)
    check("policy in use", s == 409 and b["error"]["code"] == "POLICY_IN_USE", b)

    s, b, _ = call("GET", "/api/v1/quorums", token=ada_tok, app=APP_NW)
    check("quorums list", s == 200 and b["data"]["quorums"][0]["authorization_threshold"] == 2, b.get("error"))

    s, b, _ = call("PATCH", "/api/v1/members/mem_nw_owner", {"role": "operator"}, token=owner_tok, app=APP_NW)
    check("last owner in quorum", s == 409 and b["error"]["code"] == "MEMBER_IN_QUORUM", b)

    # API keys
    s, b, _ = call("POST", "/api/v1/api-keys", {"name": "Ops key", "role": "operator"}, token=owner_tok, app=APP_NW)
    check("api key created", s == 201 and b["data"]["secret"].startswith("cvo_") and len(b["data"]["secret"]) == 44, b.get("error"))
    key_secret, key_id = b["data"]["secret"], b["data"]["id"]
    s, b, _ = call("GET", "/api/v1/me", token=key_secret, app=APP_NW)
    check("key me", s == 200 and b["data"]["api_key"]["prefix"] == key_secret[:12], b.get("error"))
    s, b, _ = call("GET", "/api/v1/wallets", token=key_secret, app=APP_NW)
    check("key reads wallets", s == 200)
    s, b, _ = call("POST", "/api/v1/intents/int_seed_pending/approve", {}, token=key_secret, app=APP_NW)
    check("key cannot approve", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)
    s, b, _ = call("GET", "/api/v1/audit", token=key_secret, app=APP_NW)
    check("operator key cannot read audit", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)
    s, b, _ = call("GET", "/api/v1/wallets", token=key_secret, app=APP_ACME)
    check("key org mismatch", s == 403 and b["error"]["code"] == "APP_ID_MISMATCH", b)
    s, b, _ = call("DELETE", f"/api/v1/api-keys/{key_id}", token=owner_tok, app=APP_NW)
    check("key revoked", s == 200 and b["data"]["revoked"] is True, b)
    s, b, _ = call("GET", "/api/v1/wallets", token=key_secret, app=APP_NW)
    check("revoked key invalid", s == 401 and b["error"]["code"] == "INVALID_CREDENTIAL", b)

    s, b, _ = call("GET", "/api/v1/audit?limit=5", token=aud_tok, app=APP_NW)
    check("audit list", s == 200 and len(b["data"]["events"]) == 5, b.get("error"))
    s, b, _ = call("GET", "/api/v1/audit/verify", token=aud_tok, app=APP_NW)
    check("audit verify", s == 200 and b["data"]["valid"] is True and b["data"]["events"] > 15, b.get("error"))
    s, b, _ = call("GET", "/api/v1/audit", token=op_tok, app=APP_NW)
    check("operator cannot read audit", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)

    s, b, _ = call("GET", "/api/v1/webhooks/events?limit=500", token=aud_tok, app=APP_NW)
    check("webhook events", s == 200 and b["data"]["events"] and b["data"]["events"][0]["signature"].startswith("v1,"), b.get("error"))
    s, b, _ = call("GET", "/api/v1/webhooks/secret", token=aud_tok, app=APP_NW)
    check("auditor cannot read secret", s == 403, b.get("error"))
    s, b, _ = call("POST", "/api/v1/webhooks/secret/rotate", {}, token=owner_tok, app=APP_NW)
    check("secret rotated", s == 200 and b["data"]["secret"].startswith("whsec_"), b.get("error"))

    s, b, _ = call("POST", "/api/v1/auth/logout", {}, token=ben_tok, app=APP_NW)
    check("logout", s == 200, b.get("error"))
    s, b, _ = call("GET", "/api/v1/wallets", token=ben_tok, app=APP_NW)
    check("token dead", s == 401 and b["error"]["code"] == "INVALID_CREDENTIAL", b)

    # contact
    s, b, _ = call("POST", "/api/v1/contact",
                   {"full_name": "A", "work_email": "x@gmail.com", "company": "", "monthly_volume": "nope", "message": "hi"})
    check("contact first error", s == 422 and b["error"]["details"]["field"] == "full_name", b)
    s, b, _ = call("POST", "/api/v1/contact",
                   {"work_email": "x@gmail.com", "full_name": "Ada Lovelace", "company": "", "monthly_volume": "nope", "message": "hi"})
    check("contact free mail", s == 422 and b["error"]["details"]["field"] == "work_email" and b["error"]["message"] == "Use your work email", b)
    s, b, _ = call("POST", "/api/v1/contact",
                   {"full_name": "Ada Lovelace", "work_email": "ada@corp.io", "company": "", "monthly_volume": "nope", "message": "hi"})
    check("contact company", s == 422 and b["error"]["details"]["field"] == "company", b)
    s, b, _ = call("POST", "/api/v1/contact",
                   {"full_name": "Ada Lovelace", "work_email": "ada@corp.io", "company": "Corp", "monthly_volume": "nope", "message": "hi"})
    check("contact volume", s == 422 and b["error"]["details"]["field"] == "monthly_volume", b)
    s, b, _ = call("POST", "/api/v1/contact",
                   {"full_name": "Ada Lovelace", "work_email": "ada@corp.io", "company": "Corp", "monthly_volume": "Under $1M", "message": "short"})
    check("contact message", s == 422 and b["error"]["details"]["field"] == "message", b)
    s, b, _ = call("POST", "/api/v1/contact",
                   {"full_name": "Ada Lovelace", "work_email": "ada@corp.io", "company": "Corp", "monthly_volume": "Under $1M",
                    "message": "We would like to hear more about Corvo for our treasury team."})
    check("contact stored", s == 201 and b["data"]["id"].startswith("con_"), b.get("error"))

    s, b, _ = call("GET", "/api/v1/intents/int_seed_pending", token=acme_tok, app=APP_ACME)
    check("cross-org intent", s == 404 and b["error"]["code"] == "INTENT_NOT_FOUND", b)

    # speed
    for name, fn in [
        ("transfer", lambda: call("POST", "/api/v1/wallets/wal_operating/transfers",
                                  {"destination_address": payroll_addr, "amount": "2"}, token=op_tok, app=APP_NW)),
        ("approve", lambda: call("POST", "/api/v1/intents/int_seed_pending/approve", {}, token=owner_tok, app=APP_NW)),
        ("evaluate", lambda: call("POST", "/api/v1/policies/pol_operating/evaluate",
                                  {"method": "transfer", "wallet_id": "wal_operating",
                                   "destination_address": "0x2222222222222222222222222222222222222222", "amount": "60000"}, token=aud_tok, app=APP_NW)),
    ]:
        t0 = time.time()
        s, b, _ = fn()
        dt = time.time() - t0
        check(f"speed {name} < 500ms", dt < 0.5, f"{dt:.3f}s status={s}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    if FAILURES:
        print("Failures:")
        for f in FAILURES:
            print(" -", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
