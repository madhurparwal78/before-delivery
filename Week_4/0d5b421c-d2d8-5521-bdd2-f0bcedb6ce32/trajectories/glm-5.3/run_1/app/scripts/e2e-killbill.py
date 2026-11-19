#!/usr/bin/env python3
"""Kill Bill recording and the deposits_paused path."""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"
OUTAGE = "http://127.0.0.1:4199"
FAILURES = []


def call(method, path, body=None, headers=None, base=BASE):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, json.loads(raw) if raw else None


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        print(f" FAIL {name} {detail}")
        FAILURES.append(name)


def kb_payment(reference):
    """Read the Kill Bill payment by external key through its API."""
    req = urllib.request.Request(
        f"http://killbill:8080/1.0/kb/payments?externalKey={urllib.parse.quote(reference)}"
    )
    req.add_header("Authorization", "Basic " + _b64("admin:password"))
    req.add_header("X-Killbill-ApiKey", "gfkit-dev")
    req.add_header("X-Killbill-ApiSecret", "gfkit-dev-secret")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


import base64 as _b64mod


def _b64(s):
    return _b64mod.b64encode(s.encode()).decode()


import urllib.parse


def main():
    run = str(int(time.time()))
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})
    date = "2026-11-28"

    print("== deposit booking records one PURCHASE on the guest's account ==")
    email = f"kb-{run}@example.com"
    st, hold = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 6, "table_id": "T9"})
    check("hold for party 6", st == 201, str(hold))
    st, conf = call("POST", f"/api/holds/{hold['hold_id']}/confirm",
                    {"name": "KB Guest", "email": email, "accept_deposit": True},
                    {"Idempotency-Key": f"kb-{run}"})
    check("deposit booking confirmed", st == 201, str(conf)[:200] if conf else "")
    if st != 201:
        return
    ref = conf["booking"]["reference"]
    amount = conf["booking"]["deposit"]["amount_cents"]
    check("deposit is 9000 cents", amount == 9000, str(amount))

    time.sleep(1)
    payment = kb_payment(ref)
    check("Kill Bill payment exists with external key", payment.get("paymentExternalKey") == ref, str(payment)[:200])
    check("purchased amount is 90.00", payment.get("purchasedAmount") == 90.0, str(payment.get("purchasedAmount")))
    txns = payment.get("transactions") or []
    deposit_txn = [t for t in txns if t.get("transactionExternalKey") == f"{ref}-deposit"]
    check("transaction external key is <ref>-deposit", len(deposit_txn) == 1, str([t.get("transactionExternalKey") for t in txns]))
    check("transaction status SUCCESS", deposit_txn and deposit_txn[0]["status"] == "SUCCESS", str(deposit_txn))

    print("== refunded cancel records one REFUND ==")
    token = conf["manage_url"].rsplit("/", 1)[-1]
    st, cancelled = call("POST", f"/api/manage/{token}/cancel", {}, {"Idempotency-Key": f"kbc-{run}"})
    check("cancel refunded", st == 200 and cancelled["booking"]["deposit"]["state"] == "refunded", str(cancelled)[:150] if cancelled else "")
    time.sleep(1)
    payment = kb_payment(ref)
    check("refunded amount is 90.00", payment.get("refundedAmount") == 90.0, str(payment.get("refundedAmount")))
    refund_txn = [t for t in (payment.get("transactions") or []) if t.get("transactionExternalKey") == f"{ref}-refund"]
    check("refund transaction recorded once", len(refund_txn) == 1, str([t.get("transactionExternalKey") for t in payment.get("transactions") or []]))
    check("refund status SUCCESS", refund_txn and refund_txn[0]["status"] == "SUCCESS", str(refund_txn))
    # A second cancel replay sends no second refund.
    st, replay = call("POST", f"/api/manage/{token}/cancel", {}, {"Idempotency-Key": f"kbc-{run}"})
    check("cancel replay 200", st == 200, str(st))
    time.sleep(1)
    payment = kb_payment(ref)
    refund_txn = [t for t in (payment.get("transactions") or []) if t.get("transactionExternalKey") == f"{ref}-refund"]
    check("still exactly one refund", len(refund_txn) == 1, str(len(refund_txn)))

    print("== retained cancel records no refund ==")
    email2 = f"kb2-{run}@example.com"
    st, hold2 = call("POST", "/api/holds", {"date": date, "time": "20:15", "party_size": 6, "table_id": "T10"})
    st, conf2 = call("POST", f"/api/holds/{hold2['hold_id']}/confirm",
                     {"name": "KB Retained", "email": email2, "accept_deposit": True},
                     {"Idempotency-Key": f"kb2-{run}"})
    ref2 = conf2["booking"]["reference"]
    token2 = conf2["manage_url"].rsplit("/", 1)[-1]
    # move inside 24h of the slot
    call("PUT", "/api/clock", {"now": "2026-11-27T21:00:00Z"})
    st, cancelled2 = call("POST", f"/api/manage/{token2}/cancel", {}, {"Idempotency-Key": f"kb2c-{run}"})
    check("cancel retained", st == 200 and cancelled2["booking"]["deposit"]["state"] == "retained", str(cancelled2)[:150] if cancelled2 else "")
    time.sleep(1)
    payment2 = kb_payment(ref2)
    check("no refund on retained cancel", payment2.get("refundedAmount") in (0, None, 0.0), str(payment2.get("refundedAmount")))

    print("== deposits paused: confirm with deposit answers 503 ==")
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})
    # A hold created on the primary, confirmed on the secondary (Kill Bill dead there)
    # is not possible because the secondary cannot create holds. Instead: use the
    # secondary for a deposit confirm by making the hold on the primary and confirming
    # on the secondary. The secondary shares Postgres and its own (working) Valkey is
    # dead, so it answers holds_paused first. To reach deposits_paused we need the
    # secondary's Valkey alive: so this instance has a WORKING valkey and dead Kill Bill.
    env = dict(os.environ)
    env["APP_PUBLIC_PORT"] = "4199"
    env["APP_PUBLIC_URL"] = "http://127.0.0.1:4199"
    env["KILLBILL_URL"] = "http://127.0.0.1:6391"  # dead
    env["APP_CLOCK_CONTROL"] = "1"
    proc = subprocess.Popen(["node", "/app/dist/server/main.js"], env=env,
                            stdout=open("/tmp/kb-outage.log", "w"), stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 30
        up = False
        while time.time() < deadline:
            try:
                st, _ = call("GET", "/api/health", base=OUTAGE)
                if st == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.5)
        check("secondary (dead Kill Bill) up", up, "see /tmp/kb-outage.log")
        # wait for its probe to mark deposits paused
        deadline = time.time() + 12
        paused = False
        while time.time() < deadline:
            st, s = call("GET", "/api/status", base=OUTAGE)
            if s and s.get("deposits") == "paused":
                paused = True
                break
            time.sleep(1)
        check("secondary reports deposits paused", paused, "")

        # make a hold on the secondary and confirm with a deposit
        st, hold3 = call("POST", "/api/holds", {"date": "2026-11-28", "time": "20:30", "party_size": 6, "table_id": "T9"}, base=OUTAGE)
        check("hold on secondary works (valkey shared)", st == 201, str(hold3))
        if st == 201:
            st, body = call("POST", f"/api/holds/{hold3['hold_id']}/confirm",
                            {"name": "Paused Guest", "email": f"paused-{run}@example.com", "accept_deposit": True},
                            {"Idempotency-Key": f"pk-{run}"}, base=OUTAGE)
            check("deposit confirm 503 deposits_paused", st == 503 and body["error"]["code"] == "deposits_paused", f"{st} {body}")
            # the hold is still live
            st, h = call("GET", f"/api/holds/{hold3['hold_id']}")
            check("hold stays live after deposits_paused", st == 200 and h["status"] == "live", str(h))
            # bookings without a deposit still go through on the secondary
            st, hold4 = call("POST", "/api/holds", {"date": "2026-11-28", "time": "20:30", "party_size": 2, "table_id": "T1"}, base=OUTAGE)
            st, conf4 = call("POST", f"/api/holds/{hold4['hold_id']}/confirm", {"name": "No Deposit", "email": f"nodep-{run}@example.com"}, {"Idempotency-Key": f"nd-{run}"}, base=OUTAGE)
            check("booking without deposit still works", st == 201, f"{st} {conf4}")
            # the pending freed tables must not include the failed hold
            st, plan = call("GET", "/api/plan?date=2026-11-28&time=20:30&party=6")
            check("T9 still occupied by the live hold", [t["status"] for t in plan["tables"] if t["table_id"] == "T9"][0] == "taken", str(plan["tables"][:2]))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
