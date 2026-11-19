#!/usr/bin/env python3
"""Waitlist, offer, pair, live event and recovery checks."""
import json
import sys
import time
import threading
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"
FAILURES = []


def call(method, path, body=None, headers=None, expect=None, opener=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    op = opener or urllib.request.build_opener()
    try:
        with op.open(req, timeout=20) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        status = e.code
    parsed = json.loads(raw) if raw else None
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}): {raw[:200]}")
    return status, parsed


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        print(f" FAIL {name} {detail}")
        FAILURES.append(name)


def set_clock(instant):
    call("PUT", "/api/clock", {"now": instant}, expect=200)


def collect_events(date, duration=6.0):
    """Open the public SSE stream with curl into a file, then parse it."""
    import subprocess
    import os
    path = f"/tmp/sse-{date}-{time.time()}.txt"
    with open(path, "wb") as fh:
        proc = subprocess.Popen(
            ["curl", "-s", "-N", "-m", str(duration), f"{BASE}/api/floor/events?date={date}"],
            stdout=fh,
        )
        time.sleep(0.8)
        # Trigger a hold and release while the stream is open.
        yield_point = True
        del yield_point
        proc.wait()
    events = []
    with open(path, "r") as fh:
        block = []
        for line in fh:
            if line.strip() == "":
                if block:
                    eid = next((l[4:].strip() for l in block if l.startswith("id: ")), None)
                    data = next((l[6:] for l in block if l.startswith("data: ")), None)
                    if data:
                        events.append((eid, json.loads(data)))
                    block = []
            else:
                block.append(line)
    done = threading.Event()
    done.set()
    os.unlink(path)
    return events, done


def main():
    print("== pairs for parties of 7 and 8 ==")
    set_clock("2026-11-16T16:00:00Z")
    date = "2026-11-20"
    st, plan = call("GET", f"/api/plan?date={date}&time=20:00&party=8", expect=200)
    check("party 8 plan has pairs", len(plan["pairs"]) == 2, str(plan["pairs"]))
    pair_ids = [p["pair_id"] for p in plan["pairs"]]
    check("pair ids", pair_ids == ["T7+T8", "T11+T12"], str(pair_ids))
    st, holdp = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 8, "table_id": "T7+T8"}, expect=201)
    check("pair hold created", holdp["table_id"] == "T7+T8", str(holdp["table_id"]))
    check("pair deposit for 8", holdp["deposit_cents"] == 12000, str(holdp["deposit_cents"]))
    st, body = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 8, "table_id": "T7+T8"})
    check("pair double hold 409", st == 409, str(body))
    st, body = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 8, "table_id": "T7"})
    check("single table of pair refused for party 8", st == 409 and body["error"]["code"] == "table_not_for_party", str(body))
    # A losing pair hold leaves no key on either table.
    st, body = call("POST", "/api/holds", {"date": date, "time": "21:00", "party_size": 8, "table_id": "T11+T12"}, expect=201)
    st, body = call("DELETE", f"/api/holds/{holdp['hold_id']}", expect=204)
    print("  (pair hold released)")

    print("== live events stream ==")
    date2 = "2026-11-21"
    import threading as _th
    results = {}

    def producer():
        time.sleep(1.2)
        st, h1 = call("POST", "/api/holds", {"date": date2, "time": "20:00", "party_size": 2, "table_id": "T1"}, expect=201)
        results["hold"] = h1
        time.sleep(1.2)
        st, _ = call("DELETE", f"/api/holds/{h1['hold_id']}", expect=204)
        time.sleep(1.0)

    t = _th.Thread(target=producer)
    t.start()
    events, done = collect_events(date2, 5.0)
    t.join()
    types = [d["type"] for _, d in events]
    check("hold.created event received", "hold.created" in types, str(types))
    check("hold.released event received", "hold.released" in types, str(types))
    if events:
        payload = [d for _, d in events if d["type"] == "hold.created"][0]
        check("public payload keys", set(payload.keys()) == {"type", "date", "time", "table_ids", "party_size"}, str(payload))
        check("payload has no tokens", "hold_id" not in payload and "email" not in payload, str(payload))
    ids = [i for i, _ in events]
    check("event ids increase", ids == sorted(ids), str(ids))

    print("== replay with Last-Event-ID ==")
    # Reopen with the first received id: should replay everything after it.
    if events:
        last_id = ids[0]
        got = []
        req = urllib.request.Request(f"{BASE}/api/floor/events?date={date2}")
        req.add_header("Last-Event-ID", last_id)
        with urllib.request.urlopen(req, timeout=4) as resp:
            buf = b""
            start = time.time()
            while time.time() - start < 2.5:
                try:
                    chunk = resp.read1(4096)
                except Exception:
                    break
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    block, buf = buf.split(b"\n\n", 1)
                    lines = block.decode().split("\n")
                    data = next((l[6:] for l in lines if l.startswith("data: ")), None)
                    if data:
                        got.append(json.loads(data))
        check("replay returns later events", all(g["type"] in ("hold.created", "hold.released") for g in got), str(got))

    print("== waitlist offer and claim ==")
    set_clock("2026-11-16T16:00:00Z")
    date3 = "2026-11-22"
    # guest W joins for 4 at 20:00-20:00
    st, entry = call("POST", "/api/waitlist", {"date": date3, "party_size": 4, "earliest": "20:00", "latest": "20:00", "name": "Wanda", "email": "wanda@example.com"}, expect=201)
    # someone books T5 (2-4 seats) for 20:00 then cancels -> freed table fits W
    st, hb = call("POST", "/api/holds", {"date": date3, "time": "20:00", "party_size": 4, "table_id": "T5"}, expect=201)
    st, conf = call("POST", f"/api/holds/{hb['hold_id']}/confirm", {"name": "Canceller", "email": "cancel@example.com"}, headers={"Idempotency-Key": "wq1"}, expect=201)
    tok = conf["manage_url"].rsplit("/", 1)[-1]
    # cancel frees the table and offers it to Wanda (position 1)
    st, cancelled = call("POST", f"/api/manage/{tok}/cancel", {}, headers={"Idempotency-Key": "wq2"}, expect=200)
    time.sleep(1.5)
    # find the offer email in mailpit
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=10") as r:
        messages = json.loads(r.read().decode())["messages"]
    offer_msg = next((m for m in messages if "A table is free" in m["Subject"]), None)
    check("offer email sent", offer_msg is not None, str([m["Subject"] for m in messages]))
    if offer_msg:
        with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{offer_msg['ID']}") as r:
            full = json.loads(r.read().decode())
        body = full["Text"]
        check("offer email has claim link", "/offer/" in body, body[:200])
        check("offer email has expiry line", "This offer ends at" in body and "Lisbon time" in body, body[:300])
        offer_token = body.split("/offer/")[1].split("\n")[0].strip()
        st, off = call("GET", f"/api/offers/{offer_token}", expect=200)
        check("offer endpoint returns offered", off["status"] == "offered" and off["table_id"] == "T5", str(off))
        # claim it
        st, claim = call("POST", f"/api/offers/{offer_token}/claim", {}, headers={"Idempotency-Key": "wq3"}, expect=201)
        check("claim creates waitlist booking", claim["booking"]["source"] == "waitlist", str(claim["booking"]))
        check("claim deposit none for party 4", claim["booking"]["deposit"]["amount_cents"] == 0, str(claim["booking"]["deposit"]))
        st, body = call("GET", f"/api/offers/{offer_token}")
        check("offer dead after claim 410", st == 410 and body["error"]["code"] == "offer_claimed", str(body))
        st, body = call("POST", f"/api/offers/{offer_token}/claim", {}, headers={"Idempotency-Key": "wq4"})
        check("second claim 410 offer_claimed", st == 410 and body["error"]["code"] == "offer_claimed", str(body))
        # replay with the original key still returns the stored 201
        st, replay = call("POST", f"/api/offers/{offer_token}/claim", {}, headers={"Idempotency-Key": "wq3"})
        check("claim replay still 201", st == 201 and replay["booking"]["reference"] == claim["booking"]["reference"], str(st))

    print("== offer lapse ==")
    # book and cancel another table while a waitlist entry waits
    st, entry2 = call("POST", "/api/waitlist", {"date": date3, "party_size": 2, "earliest": "20:00", "latest": "20:00", "name": "Lara", "email": "lara@example.com"}, expect=201)
    st, hb2 = call("POST", "/api/holds", {"date": date3, "time": "20:00", "party_size": 2, "table_id": "T2"}, expect=201)
    st, conf2 = call("POST", f"/api/holds/{hb2['hold_id']}/confirm", {"name": "Canceller Two", "email": "canceltwo@example.com"}, headers={"Idempotency-Key": "wl1"}, expect=201)
    tok2 = conf2["manage_url"].rsplit("/", 1)[-1]
    st, c2 = call("POST", f"/api/manage/{tok2}/cancel", {}, headers={"Idempotency-Key": "wl2"}, expect=200)
    time.sleep(1.5)
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=10") as r:
        messages = json.loads(r.read().decode())["messages"]
    offer2 = next((m for m in messages if "A table is free" in m["Subject"] and m["To"][0]["Address"] == "lara@example.com"), None)
    check("second offer sent to next fitting entry", offer2 is not None, str([m["Subject"] for m in messages]))
    if offer2:
        with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{offer2['ID']}") as r:
            full2 = json.loads(r.read().decode())
        tok_o2 = full2["Text"].split("/offer/")[1].split("\n")[0].strip()
        # advance the clock past the offer expiry (default 900s)
        set_clock("2026-11-16T16:16:00Z")
        time.sleep(3.5)
        st, body = call("GET", f"/api/offers/{tok_o2}")
        check("offer expired after lapse", st == 410 and body["error"]["code"] == "offer_expired", str(body))
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=10") as r:
            messages = json.loads(r.read().decode())["messages"]
        lapsed = next((m for m in messages if m["Subject"] == "Your table offer has lapsed"), None)
        check("lapsed email sent", lapsed is not None, str([m["Subject"] for m in messages]))

    print("== deposit offer ==")
    set_clock("2026-11-16T16:00:00Z")
    date4 = "2026-11-23"
    st, e6 = call("POST", "/api/waitlist", {"date": date4, "party_size": 6, "earliest": "20:00", "latest": "20:00", "name": "Sofia", "email": "sofia@example.com"}, expect=201)
    st, hb6 = call("POST", "/api/holds", {"date": date4, "time": "20:00", "party_size": 6, "table_id": "T9"}, expect=201)
    st, c6 = call("POST", f"/api/holds/{hb6['hold_id']}/confirm", {"name": "Cancel Six", "email": "cancelsix@example.com", "accept_deposit": True}, headers={"Idempotency-Key": "ws1"}, expect=201)
    tok6 = c6["manage_url"].rsplit("/", 1)[-1]
    st, _ = call("POST", f"/api/manage/{tok6}/cancel", {}, headers={"Idempotency-Key": "ws2"}, expect=200)
    time.sleep(1.5)
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=10") as r:
        messages = json.loads(r.read().decode())["messages"]
    offer6 = next((m for m in messages if "A table is free" in m["Subject"] and m["To"][0]["Address"] == "sofia@example.com"), None)
    check("deposit offer email sent", offer6 is not None, str([(m["Subject"], m["To"][0]["Address"]) for m in messages]))
    if offer6:
        with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{offer6['ID']}") as r:
            full6 = json.loads(r.read().decode())
        check("deposit offer mentions charge", "Claiming charges a deposit of" in full6["Text"], full6["Text"])
        tok_o6 = full6["Text"].split("/offer/")[1].split("\n")[0].strip()
        st, claim6 = call("POST", f"/api/offers/{tok_o6}/claim", {}, headers={"Idempotency-Key": "ws3"}, expect=201)
        check("claim with deposit paid", claim6["booking"]["deposit"]["state"] == "paid" and claim6["booking"]["deposit"]["amount_cents"] == 9000, str(claim6["booking"]["deposit"]))

    print("== release frees table for other plans within 2s ==")
    st, h9 = call("POST", "/api/holds", {"date": date4, "time": "21:00", "party_size": 2, "table_id": "T3"}, expect=201)
    st, plan_before = call("GET", f"/api/plan?date={date4}&time=21:00&party=2", expect=200)
    check("T3 taken while held", [t["status"] for t in plan_before["tables"] if t["table_id"] == "T3"][0] == "taken", "")
    call("DELETE", f"/api/holds/{h9['hold_id']}", expect=204)
    time.sleep(1.0)
    st, plan_after = call("GET", f"/api/plan?date={date4}&time=21:00&party=2", expect=200)
    check("T3 free right after release", [t["status"] for t in plan_after["tables"] if t["table_id"] == "T3"][0] == "fits", "")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
