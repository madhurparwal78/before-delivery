#!/usr/bin/env python3
"""Recovery: a table freed while Valkey is unreachable is offered after return."""
import json
import os
import signal
import subprocess
import sys
import time
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


def waitlist_pending_rows():
    import pg8000.native as pg
    c = pg.Connection("gf_app", host="postgres", port=5432, database="gf_dev", password="gf-app-dev-2b7d41")
    rows = c.run("SELECT count(*) FROM pending_freed_tables")
    return rows[0][0]


def main():
    # The secondary instance (dead Valkey) writes pending_freed_tables rows when a
    # table frees. The primary then processes them when it sees them.
    print("== preparing: waitlist entry on a date the secondary will free ==")
    call("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})
    date = "2026-12-14"
    st, entry = call("POST", "/api/waitlist", {"date": date, "party_size": 2, "earliest": "20:00", "latest": "20:00", "name": "Recover Guest", "email": "recover@example.com"})
    check("waitlist entry created", st == 201, str(entry))

    # Create a booking on the primary that the secondary will cancel.
    st, hold = call("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T13"})
    check("booking hold created", st == 201, str(hold))
    st, conf = call("POST", f"/api/holds/{hold['hold_id']}/confirm", {"name": "Recover Cancel", "email": "recovercancel@example.com"}, headers={"Idempotency-Key": "rv1"})
    check("booking confirmed", st == 201, str(st))
    token = conf["manage_url"].rsplit("/", 1)[-1]

    print("== secondary cancels the booking while its Valkey is down ==")
    env = dict(os.environ)
    env["APP_PUBLIC_PORT"] = "4199"
    env["APP_PUBLIC_URL"] = "http://127.0.0.1:4199"
    env["VALKEY_URL"] = "redis://127.0.0.1:6390/0"
    env["KILLBILL_URL"] = "http://killbill:8080"  # Kill Bill works for the secondary
    env["APP_CLOCK_CONTROL"] = "1"
    proc = subprocess.Popen(["node", "/app/dist/server/main.js"], env=env,
                            stdout=open("/tmp/recovery-server.log", "w"), stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 30
        up = False
        while time.time() < deadline:
            try:
                st, _ = call2(env, "GET", "/api/health")
                if st == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.5)
        check("secondary up", up, "log: /tmp/recovery-server.log")
        # cancel via the secondary: it commits in Postgres but cannot publish or claim
        st, body = call2(env, "POST", f"/api/manage/{token}/cancel", {}, {"Idempotency-Key": "rv2"})
        check("cancel via secondary succeeds", st == 200, f"{st} {body}")
        pending = waitlist_pending_rows()
        check("freed table recorded as pending", pending >= 1, f"pending={pending}")
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()

    print("== primary processes the pending freed table within 15 seconds ==")
    # The primary's sweep runs every second and flushes pending rows when Valkey is healthy.
    deadline = time.time() + 16
    offered = False
    while time.time() < deadline:
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=20") as r:
            messages = json.loads(r.read().decode())["messages"]
        if any("A table is free" in m["Subject"] and m["To"][0]["Address"] == "recover@example.com" for m in messages):
            offered = True
            break
        time.sleep(1)
    check("offer email sent after recovery", offered, "")
    pending_after = waitlist_pending_rows()
    check("pending rows cleared", pending_after == 0, f"pending={pending_after}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


def call2(env_unused, method, path, body=None, headers=None):
    url = "http://127.0.0.1:4199" + path
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


if __name__ == "__main__":
    main()
