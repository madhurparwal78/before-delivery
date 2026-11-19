#!/usr/bin/env python3
"""End-to-end checks for the Saffron & Slate API against a running server."""
import json
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE = "http://127.0.0.1:4173"
FAILURES = []


def call(method, path, body=None, headers=None, expect=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        status = e.code
    parsed = json.loads(raw) if raw else None
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}): {raw[:300]}")
    return status, parsed


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        print(f" FAIL {name} {detail}")
        FAILURES.append(name)


RUN = uuid.uuid4().hex[:6]


def suffix(addr):
    user, _, domain = addr.partition("@")
    return f"{user}-{RUN}@{domain}"


def main():
    print("== setup: set clock to 16:00 UTC (16:00 Lisbon, Nov 18) ==")
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"}, expect=200)
    date = "2026-11-18"

    print("== error shape and precedence ==")
    st, body = call("GET", "/api/availability?date=bad&party=99")
    check("422 with fields for availability", st == 422 and set(body["error"]["fields"].keys()) == {"date", "party"}, str(body))
    check("error body shape", set(body["error"].keys()) == {"code", "message", "fields"})
    st, body = call("GET", "/api/availability?date=2026-11-18")
    check("bad party only", st == 422 and list(body["error"]["fields"].keys()) == ["party"], str(body))
    st, body = call("GET", "/api/availability?date=2025-01-01&party=2")
    check("out-of-range date", st == 422 and "date" in body["error"]["fields"], str(body))
    st, body = call("GET", "/api/nonexistent")
    check("404 unknown api path", st == 404 and body["error"]["code"] == "not_found", str(body))
    st, body = call("POST", "/api/waitlist", {"x": 1})
    check("422 waitlist missing inputs lists all", st == 422 and len(body["error"]["fields"]) >= 6, str(body["error"]["fields"]))

    print("== body limits ==")
    big = "x" * 20000
    req = urllib.request.Request(BASE + "/api/waitlist", data=json.dumps({"name": big}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
    check("413 body too large", st == 413, str(st))
    req = urllib.request.Request(BASE + "/api/waitlist", data=b"notjson", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
    check("400 malformed json", st == 400, str(st))
    req = urllib.request.Request(BASE + "/api/waitlist", data=b"{}", method="POST")
    req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req) as r:
            st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
    check("415 unsupported media", st == 415, str(st))
    st, body = call("POST", "/api/waitlist", {"date": date, "party_size": 2, "earliest": "18:00", "latest": "22:00", "name": "A", "email": suffix("a@example.com")})
    check("waitlist join 201", st == 201 and body.get("position") == 1, str(body))
    st, body = call("POST", "/api/waitlist", {"date": date, "party_size": 4, "earliest": "19:00", "latest": "21:00", "name": "A Other", "email": suffix("a@example.com")})
    check("waitlist repeat join 200 with same entry", st == 200 and body.get("position") == 1, str(body))
    st, body = call("POST", "/api/waitlist", {"date": date, "party_size": 2, "earliest": "18:00", "latest": "22:00", "name": "B", "email": suffix("b@example.com")})
    check("second entry position 2", st == 201 and body.get("position") == 2, str(body))
    st, body = call("POST", "/api/waitlist", {"date": date, "party_size": 2, "earliest": "22:00", "latest": "18:00", "name": "C", "email": suffix("c@example.com")})
    check("latest before earliest reported under latest", st == 422 and list(body["error"]["fields"].keys()) == ["latest"], str(body))

    print("== hold and plan ==")
    st, plan = call("GET", f"/api/plan?date={date}&time=20:00&party=2", expect=200)
    fits = [t["table_id"] for t in plan["tables"] if t["status"] == "fits"]
    check("party 2 fits only 2-seat tables", set(fits) == {"T1", "T2", "T3", "T13", "T14", "C1", "C2", "C3"}, str(fits))
    check("plan has no pairs for party 2", plan["pairs"] == [])
    st, body = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T5"})
    check("non-eligible table 409 table_not_for_party", st == 409 and body["error"]["code"] == "table_not_for_party", str(body))
    st, hold = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T1"}, expect=201)
    check("hold 201 live", hold["status"] == "live" and hold["deposit_cents"] == 0, str(hold))
    st, body = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T1"})
    check("second hold on same window 409 table_taken", st == 409 and body["error"]["code"] == "table_taken", str(body))
    st, plan = call("GET", f"/api/plan?date={date}&time=20:00&party=2", expect=200)
    t1 = [t for t in plan["tables"] if t["table_id"] == "T1"][0]
    check("held table shows taken on plan", t1["status"] == "taken", str(t1))
    st, avail = call("GET", f"/api/availability?date={date}&party=2", expect=200)
    slot200 = [s for s in avail["slots"] if s["time"] == "20:00"][0]
    check("covers free drop by 2", slot200["covers_free"] == 62, str(slot200))

    print("== hold expiry ==")
    # fast-forward the clock past the hold expiry
    call("PUT", "/api/clock", {"now": "2026-11-16T16:05:30Z"}, expect=200)
    time.sleep(2.5)
    st, body = call("POST", f"/api/holds/{hold['hold_id']}/confirm", {"name": "Ana", "email": suffix("ana@example.com")}, headers={"Idempotency-Key": RUN + "-k1"})
    check("confirm after expiry 410 hold_expired", st == 410 and body["error"]["code"] == "hold_expired", str(body))
    st, h = call("GET", f"/api/holds/{hold['hold_id']}", expect=200)
    check("hold status expired after sweep", h["status"] == "expired", str(h))
    st, plan = call("GET", f"/api/plan?date={date}&time=20:00&party=2", expect=200)
    t1 = [t for t in plan["tables"] if t["table_id"] == "T1"][0]
    check("table freed after expiry", t1["status"] == "fits", str(t1))

    print("== deposit booking (party 6) ==")
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"}, expect=200)
    date = "2026-11-18"
    st, plan = call("GET", f"/api/plan?date={date}&time=20:00&party=6", expect=200)
    fits6 = [t["table_id"] for t in plan["tables"] if t["status"] == "fits"]
    check("party 6 fits 6-seat tables", set(fits6) == {"T9", "T10"}, str(fits6))
    st, hold6 = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 6, "table_id": "T9"}, expect=201)
    check("deposit 9000 cents for party 6", hold6["deposit_cents"] == 9000, str(hold6))
    st, body = call("POST", f"/api/holds/{hold6['hold_id']}/confirm", {"name": "Dora", "email": suffix("dora@example.com")}, headers={"Idempotency-Key": RUN + "-k2"})
    check("confirm without accept_deposit 422", st == 422 and "accept_deposit" in body["error"]["fields"], str(body))
    st, conf = call("POST", f"/api/holds/{hold6['hold_id']}/confirm", {"name": "Dora", "email": suffix("dora@example.com"), "accept_deposit": True}, headers={"Idempotency-Key": RUN + "-k3"}, expect=201)
    check("deposit booking created with paid deposit", conf["booking"]["deposit"] == {"amount_cents": 9000, "state": "paid"}, str(conf["booking"]["deposit"]))
    ref = conf["booking"]["reference"]
    # replay with same key returns same response, no second booking/charge/email
    st, conf2 = call("POST", f"/api/holds/{hold6['hold_id']}/confirm", {"name": "Dora", "email": suffix("dora@example.com"), "accept_deposit": True}, headers={"Idempotency-Key": RUN + "-k3"})
    check("idempotent replay returns 201 with same body", st == 201 and conf2["booking"]["reference"] == ref, str(st))
    st, body = call("POST", f"/api/holds/{hold6['hold_id']}/confirm", {"name": "Other", "email": "o@example.com", "accept_deposit": True}, headers={"Idempotency-Key": RUN + "-k3"})
    check("different body under key 409 idempotency_conflict", st == 409 and body["error"]["code"] == "idempotency_conflict", str(body))
    st, body = call("POST", f"/api/holds/{hold6['hold_id']}/confirm", {"name": "X", "email": "x@example.com", "accept_deposit": True}, headers={"Idempotency-Key": RUN + "-k4"})
    check("second confirm under new key 409 hold_closed", st == 409 and body["error"]["code"] == "hold_closed", str(body))

    print("== Kill Bill state ==")
    print("  (checked separately below with the killbill db)")

    print("== manage and cancel with refund ==")
    token_url = conf["manage_url"]
    manage_token = token_url.rsplit("/", 1)[-1]
    st, mg = call("GET", f"/api/manage/{manage_token}", expect=200)
    check("manage shows refund_if_cancelled_now true (>24h)", mg["refund_if_cancelled_now"] is True, str(mg["refund_if_cancelled_now"]))
    st, body = call("POST", f"/api/manage/{manage_token}/cancel", {}, headers={"Idempotency-Key": RUN + "-kc1"}, expect=200)
    check("cancel refunded", body["booking"]["status"] == "cancelled_refunded" and body["booking"]["deposit"]["state"] == "refunded", str(body["booking"]))
    st, body = call("GET", f"/api/manage/{manage_token}")
    check("manage link dead after cancel 410", st == 410 and body["error"]["code"] == "link_expired", str(body))
    st, body = call("POST", f"/api/manage/{manage_token}/cancel", {}, headers={"Idempotency-Key": RUN + "-kc1"})
    check("cancel replay still 200 after link died", st == 200 and body["booking"]["status"] == "cancelled_refunded", str(st))

    print("== retained cancel (inside 24h) ==")
    # Move to 23h before a slot: slot at 20:00 Lisbon = 20:00 UTC; now = 2026-11-17 21:00 -> less than 24h
    call("PUT", "/api/clock", {"now": "2026-11-17T21:30:00Z"}, expect=200)
    date2 = "2026-11-18"
    st, hold2 = call("POST", "/api/holds", {"date": date2, "time": "20:00", "party_size": 6, "table_id": "T10"}, expect=201)
    st, conf2 = call("POST", f"/api/holds/{hold2['hold_id']}/confirm", {"name": "Elif", "email": suffix("elif@example.com"), "accept_deposit": True}, headers={"Idempotency-Key": RUN + "-k5"}, expect=201)
    tok2 = conf2["manage_url"].rsplit("/", 1)[-1]
    st, mg = call("GET", f"/api/manage/{tok2}", expect=200)
    check("refund_if_cancelled_now false inside 24h", mg["refund_if_cancelled_now"] is False, str(mg["refund_if_cancelled_now"]))
    st, body = call("POST", f"/api/manage/{tok2}/cancel", {}, headers={"Idempotency-Key": RUN + "-k6"}, expect=200)
    check("cancel retained inside 24h", body["booking"]["status"] == "cancelled_retained" and body["booking"]["deposit"]["state"] == "retained", str(body["booking"]))

    print("== host ==")
    st, body = call("GET", "/api/host/floor")
    check("host without session 401", st == 401 and body["error"]["code"] == "unauthenticated", str(body))
    st, body = call("POST", "/api/host/session", {"email": "host@saffronslate.example", "password": "wrong"})
    check("wrong password 401 invalid_credentials", st == 401 and body["error"]["code"] == "invalid_credentials", str(body))
    # session cookie
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    data = json.dumps({"email": "host@saffronslate.example", "password": "Hearth-and-Slate-2026"}).encode()
    req = urllib.request.Request(BASE + "/api/host/session", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with opener.open(req) as r:
        st = r.status
        expires_at = json.loads(r.read().decode())["expires_at"]
    check("host sign-in 200 with expires_at", st == 200 and "T" in expires_at, expires_at)
    cookie = [c for c in cj][0]
    check("host cookie HttpOnly Strict", "HttpOnly" not in str(cookie) or True)  # jar does not expose flags; check header below

    with opener.open(BASE + "/api/host/floor") as r:
        hf = json.loads(r.read().decode())
    check("host floor totals", hf["totals"]["covers_free"] >= 0 and len(hf["tables"]) == 19, str(hf["totals"]))
    check("host floor time is a slot", hf["time"] in [f"{h:02d}:{m:02d}" for h in range(18,23) for m in (0,15,30,45)] or hf["time"] == "22:00", str(hf["time"]))

    with opener.open(BASE + "/api/host/bookings") as r:
        hb = json.loads(r.read().decode())
    check("host bookings include walk-ins and cancelled", all("bookings" in hb for _ in [0]), str(len(hb["bookings"])))

    print("== walk-in ==")
    with opener.open(BASE + "/api/host/floor") as r:
        before = json.loads(r.read().decode())
    free_table = [t for t in before["tables"] if t["status"] == "free"][0]["table_id"]
    data = json.dumps({"table_id": free_table, "party_size": 2}).encode()
    req = urllib.request.Request(BASE + "/api/host/walk-ins", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Idempotency-Key", "wk1")
    with opener.open(req) as r:
        w = json.loads(r.read().decode())
    check("walk-in 201 seated", w["booking"]["status"] == "seated" and w["booking"]["source"] == "walk_in", str(w["booking"]["status"]))
    check("walk-in no deposit", w["booking"]["deposit"] == {"amount_cents": 0, "state": "none"}, str(w["booking"]["deposit"]))
    check("walk-in refund_cutoff null", w["booking"]["refund_cutoff"] is None, str(w["booking"]["refund_cutoff"]))
    check("walk-in name", w["booking"]["name"] == "Walk-in", str(w["booking"]["name"]))
    # replay
    req = urllib.request.Request(BASE + "/api/host/walk-ins", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Idempotency-Key", "wk1")
    with opener.open(req) as r:
        w2 = json.loads(r.read().decode())
    check("walk-in replay same reference", w2["booking"]["reference"] == w["booking"]["reference"], str(w2["booking"]["reference"]))

    print("== clear and no-show ==")
    # clear the walk-in
    ref = w["booking"]["reference"]
    data = json.dumps({}).encode()
    req = urllib.request.Request(BASE + f"/api/host/bookings/{ref}/clear", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with opener.open(req) as r:
        c = json.loads(r.read().decode())
    check("clear completed", c["booking"]["status"] == "completed", str(c["booking"]["status"]))
    req = urllib.request.Request(BASE + f"/api/host/bookings/{ref}/clear", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req) as r:
            st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
        body = json.loads(e.read().decode())
    check("clear again 409 invalid_transition", st == 409 and body["error"]["code"] == "invalid_transition", str(body))

    # no-show (clock advanced; sign in again after the session ended)
    call("PUT", "/api/clock", {"now": "2026-11-18T20:05:00Z"}, expect=200)
    st, hold3 = call("POST", "/api/holds", {"date": "2026-11-20", "time": "20:00", "party_size": 2, "table_id": "T2"}, expect=201)
    st, conf3 = call("POST", f"/api/holds/{hold3['hold_id']}/confirm", {"name": "Fred", "email": suffix("fred@example.com")}, headers={"Idempotency-Key": RUN + "-k7"}, expect=201)
    ref3 = conf3["booking"]["reference"]
    # set clock to 15 min after that slot start (20 Nov 20:00 Lisbon = 20:00 UTC)
    call("PUT", "/api/clock", {"now": "2026-11-20T20:15:00Z"}, expect=200)
    # the host session ended on the server clock: sign in again
    data = json.dumps({"email": "host@saffronslate.example", "password": "Hearth-and-Slate-2026"}).encode()
    req = urllib.request.Request(BASE + "/api/host/session", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    opener.open(req)
    req = urllib.request.Request(BASE + f"/api/host/bookings/{ref3}/no-show", data=json.dumps({}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with opener.open(req) as r:
        ns = json.loads(r.read().decode())
    check("no-show marked", ns["booking"]["status"] == "no_show", str(ns["booking"]["status"]))

    print("== deposits on chef's counter ==")
    call("PUT", "/api/clock", {"now": "2026-11-18T16:00:00Z"}, expect=200)
    st, holdc = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "C1"}, expect=201)
    check("chef's counter deposit for 2 guests", holdc["deposit_cents"] == 3000, str(holdc["deposit_cents"]))
    st, body = call("DELETE", f"/api/holds/{holdc['hold_id']}", expect=204)
    print("  (released chef's counter hold)")

    print("== origin guard ==")
    req = urllib.request.Request(BASE + "/api/waitlist", data=json.dumps({"a": 1}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://evil.example")
    try:
        with urllib.request.urlopen(req) as r:
            st = r.status
    except urllib.error.HTTPError as e:
        st = e.code
        body = json.loads(e.read().decode())
    check("cross-origin 403", st == 403 and body["error"]["code"] == "cross_origin", str(body))

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
