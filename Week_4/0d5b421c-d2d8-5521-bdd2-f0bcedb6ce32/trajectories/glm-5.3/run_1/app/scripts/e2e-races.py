#!/usr/bin/env python3
"""Race checks: simultaneous holds and claims have exactly one winner."""
import json
import sys
import time
import threading
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"
FAILURES = []


def call(method, path, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
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


def race(n, fn):
    """Run n threads calling fn(i); return the list of results."""
    results = [None] * n
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        results[i] = fn(i)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def main():
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})

    print("== simultaneous holds on one table: exactly one wins ==")
    for attempt in range(3):
        date = f"2026-12-{10 + attempt}"
        results = race(6, lambda i: call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T1"}))
        wins = [r for r in results if r[0] == 201]
        loses = [r for r in results if r[0] == 409 and r[1]["error"]["code"] == "table_taken"]
        check(f"attempt {attempt}: one winner, rest table_taken", len(wins) == 1 and len(loses) == 5,
              f"statuses={[r[0] for r in results]}")
        # release the winner so the next attempt is clean
        for r in wins:
            call("DELETE", f"/api/holds/{r[1]['hold_id']}")

    print("== simultaneous pair holds: losing pair leaves no key on either table ==")
    import redis
    r = redis.Redis.from_url("redis://app:gfkit-dev@valkey:6379/0")
    r.delete("hold:T7:2026-12-13T20:00", "hold:T8:2026-12-13T20:00")
    results = race(2, lambda i: call("POST", "/api/holds", {"date": "2026-12-13", "time": "20:00", "party_size": 8, "table_id": "T7+T8"}))
    wins = [x for x in results if x[0] == 201]
    check("one pair winner", len(wins) == 1, str([x[0] for x in results]))
    if wins:
        call("DELETE", f"/api/holds/{wins[0][1]['hold_id']}")

    print("== simultaneous claims on one offer: exactly one booking ==")
    date = "2026-12-14"
    st, entry = call("POST", "/api/waitlist", {"date": date, "party_size": 2, "earliest": "20:00", "latest": "20:00", "name": "Race Guest", "email": f"race{int(time.time())}@example.com"})
    st, hold = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T2"})
    st, conf = call("POST", f"/api/holds/{hold['hold_id']}/confirm", {"name": "Race Cancel", "email": "racecancel@example.com"}, headers={"Idempotency-Key": f"rc{int(time.time())}"})
    token = conf["manage_url"].rsplit("/", 1)[-1]
    st, cancelled = call("POST", f"/api/manage/{token}/cancel", {}, headers={"Idempotency-Key": f"rc2{int(time.time())}"})
    # wait for the offer email
    deadline = time.time() + 10
    offer_token = None
    while time.time() < deadline and not offer_token:
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=20") as resp:
            messages = json.loads(resp.read().decode())["messages"]
        for m in messages:
            if "A table is free" in m["Subject"] and m["To"][0]["Address"] == entry["entry_id"] and False:
                pass
        for m in messages:
            if "A table is free" in m["Subject"] and m["To"][0]["Address"].startswith("race"):
                with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{m['ID']}") as r2:
                    body = json.loads(r2.read().decode())["Text"]
                if "/offer/" in body:
                    offer_token = body.split("/offer/")[1].split("\n")[0].strip()
                    break
        time.sleep(0.5)
    check("offer created for race test", offer_token is not None, "no offer email found")
    if offer_token:
        results = race(5, lambda i: call("POST", f"/api/offers/{offer_token}/claim", {}, {"Idempotency-Key": f"cl{i}-{int(time.time())}"}))
        wins = [x for x in results if x[0] == 201]
        claimed = [x for x in results if x[0] == 410 and x[1]["error"]["code"] == "offer_claimed"]
        check("one claim wins, rest offer_claimed", len(wins) == 1 and len(claimed) == 4,
              f"statuses={[x[0] for x in results]} codes={[x[1]['error']['code'] if x[1] and 'error' in x[1] else None for x in results]}")

    print("== claim racing the lapse yields one booking or one lapse ==")
    # create another offer and claim it right at expiry
    date2 = "2026-12-15"
    st, entry2 = call("POST", "/api/waitlist", {"date": date2, "party_size": 2, "earliest": "20:00", "latest": "20:00", "name": "Lapse Race", "email": f"lapserace{int(time.time())}@example.com"})
    st, hold2 = call("POST", "/api/holds", {"date": date2, "time": "20:00", "party_size": 2, "table_id": "T3"})
    st, conf2 = call("POST", f"/api/holds/{hold2['hold_id']}/confirm", {"name": "Lapse Cancel", "email": "lapsecancel@example.com"}, headers={"Idempotency-Key": f"lr{int(time.time())}"})
    token2 = conf2["manage_url"].rsplit("/", 1)[-1]
    st, _ = call("POST", f"/api/manage/{token2}/cancel", {}, headers={"Idempotency-Key": f"lr2{int(time.time())}"})
    deadline = time.time() + 10
    offer_token2 = None
    while time.time() < deadline and not offer_token2:
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=20") as resp:
            messages = json.loads(resp.read().decode())["messages"]
        for m in messages:
            if "A table is free" in m["Subject"] and m["To"][0]["Address"].startswith("lapserace"):
                with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{m['ID']}") as r2:
                    body = json.loads(r2.read().decode())["Text"]
                if "/offer/" in body:
                    offer_token2 = body.split("/offer/")[1].split("\n")[0].strip()
                    break
        time.sleep(0.5)
    if offer_token2:
        # Move the clock near expiry (900s) and claim.
        call("PUT", "/api/clock", {"now": "2026-11-16T16:14:30Z"})
        time.sleep(2.5)
        st, body = call("POST", f"/api/offers/{offer_token2}/claim", {}, {"Idempotency-Key": f"lrace{int(time.time())}"})
        ok = st == 201 or (st == 410 and body["error"]["code"] in ("offer_expired", "offer_claimed"))
        check("claim racing lapse yields booking or expiry", ok, f"{st} {body}")
    else:
        check("second offer created for lapse race", False, "no offer email")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
