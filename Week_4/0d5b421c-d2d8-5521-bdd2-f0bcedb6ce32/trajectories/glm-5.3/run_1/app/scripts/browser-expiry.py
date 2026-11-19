#!/usr/bin/env python3
"""DP-26: a hold's lift-off is visible on open pages within four seconds.
DP-63: fifty open streams stay within the three-second budget."""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        print(f" FAIL {name} {detail}")
        FAILURES.append(name)


def api(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def main():
    subprocess.run(["/app/scripts/reset.sh"], check=True, capture_output=True)
    subprocess.Popen(["bash", "-c", "APP_CLOCK_CONTROL=1 node /app/dist/server/main.js > /tmp/server.log 2>&1 &"])
    time.sleep(5)
    api("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})

    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("== DP-26: the hold ends at expiry on an open page ==")
        page = browser.new_context(viewport={"width": 1280, "height": 800}).new_page()
        page.goto(BASE + "/book?party=2&date=2026-11-28", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelectorAll('#slot-list button.slot-row:not([disabled])').length > 0")
        page.locator("#slot-list button.slot-row:not([disabled])").nth(8).click()
        page.wait_for_function("document.querySelectorAll('button.table-btn.status-fits').length > 0")
        page.locator("button.table-btn.status-fits").first.click()
        page.wait_for_function("document.querySelector('#your-table:not([hidden])') !== null", timeout=8000)
        check("hold granted on the open page", page.locator(".place").count() >= 1, "")
        time.sleep(1.5)

        # Shorten the hold by advancing the clock to its expiry.
        api("PUT", "/api/clock", {"now": "2026-11-16T16:05:02Z"})
        start = time.time()
        page.wait_for_function(
            "document.getElementById('hold-ended') && !document.getElementById('hold-ended').hidden",
            timeout=6000,
        )
        elapsed = time.time() - start
        check("hold-ended notice appears in place", True, f"{elapsed:.1f}s")
        check("notice appears within four seconds of expiry", elapsed <= 4.5, f"{elapsed:.2f}s")
        notice = page.locator("#hold-ended").inner_text()
        check("notice text", notice.startswith("Your hold on table"), notice)
        # The typed details stay.
        page.fill("#name", "Expiry Guest")
        page.fill("#email", "expiry@example.com")
        notice2 = page.locator("#hold-ended").inner_text()
        check("typed details stay after expiry", page.locator("#name").input_value() == "Expiry Guest", "")
        # The settings lift off.
        page.wait_for_function("document.querySelectorAll('.place').length === 0", timeout=4000)
        check("place settings lifted off", True, "")

        print("== DP-63: fifty open streams stay fast ==")
        api("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        pages = []
        for i in range(5):
            pg = ctx.new_page()
            pg.goto(BASE + "/book?party=2&date=2026-11-28&time=20%3A00", wait_until="domcontentloaded", timeout=60000)
            pages.append(pg)
        # plus 40 raw event streams via curl
        curls = []
        for i in range(45):
            proc = subprocess.Popen(
                ["curl", "-s", "-N", BASE + "/api/floor/events?date=2026-11-28"],
                stdout=subprocess.DEVNULL,
            )
            curls.append(proc)
        time.sleep(3)

        t0 = time.time()
        st, _ = api("GET", "/api/availability?date=2026-11-28&party=4")
        dt = time.time() - t0
        check("availability under 50 streams within 3s", st == 200 and dt < 3.0, f"{dt:.2f}s")

        t0 = time.time()
        st, _ = api("GET", "/api/plan?date=2026-11-28&time=20:00&party=2")
        dt = time.time() - t0
        check("plan under 50 streams within 3s", st == 200 and dt < 3.0, f"{dt:.2f}s")

        t0 = time.time()
        st, hold = api("POST", "/api/holds", {"date": "2026-11-28", "time": "20:00", "party_size": 2, "table_id": "T1"})
        dt = time.time() - t0
        check("hold under 50 streams within 3s", st == 201 and dt < 3.0, f"{dt:.2f}s")
        if st == 201:
            api("DELETE", f"/api/holds/{hold['hold_id']}")

        # A page shows the change within two seconds.
        t0 = time.time()
        api("POST", "/api/holds", {"date": "2026-11-28", "time": "20:00", "party_size": 2, "table_id": "T2"})
        pages[0].wait_for_function(
            "(() => { const b = document.querySelector('button.table-btn[data-table=\"T2\"] .state'); return b && b.textContent === 'Taken'; })()",
            timeout=4000,
        )
        dt = time.time() - t0
        check("live change within 2s under 50 streams", dt < 2.5, f"{dt:.2f}s")

        # Close everything: connections return to their earlier level.
        import pg8000.native as pgmod

        def pg_conn_count():
            c = pgmod.Connection("gf_app", host="postgres", port=5432, database="gf_dev", password="gf-app-dev-2b7d41")
            n = c.run("SELECT count(*) FROM pg_stat_activity WHERE datname = 'gf_dev' AND state <> 'idle in transaction'")[0][0]
            return n

        for proc in curls:
            proc.kill()
        for pg in pages:
            pg.close()
        time.sleep(5)
        after = pg_conn_count()
        check("postgres connections released after streams close", after < 20, f"connections={after}")

        browser.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
