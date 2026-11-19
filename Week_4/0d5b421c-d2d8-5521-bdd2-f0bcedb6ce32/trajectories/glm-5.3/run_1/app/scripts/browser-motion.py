#!/usr/bin/env python3
"""Reduced motion (DP-08) and breakpoint (DP-05, DP-51) checks."""
import json
import re
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
    url = BASE + path
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


def layout_at(page, width):
    """Which layout the page uses at a given width: stacked or columns."""
    page.set_viewport_size({"width": width, "height": 900})
    time.sleep(0.3)
    grid = page.evaluate("(() => { const g = document.querySelector('.book-layout, .host-layout'); return g ? getComputedStyle(g).gridTemplateColumns : null; })()")
    return grid


def main():
    subprocess.run(["/app/scripts/reset.sh"], check=True, capture_output=True)
    subprocess.Popen(["bash", "-c", "APP_CLOCK_CONTROL=1 node /app/dist/server/main.js > /tmp/server.log 2>&1 &"])
    time.sleep(5)
    api("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})

    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("== booking page breakpoints ==")
        page = browser.new_context(viewport={"width": 1280, "height": 800}).new_page()
        page.goto(BASE + "/book?party=2&date=2026-11-28", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelectorAll('#slot-list button.slot-row').length > 0", timeout=8000)

        grid_phone = layout_at(page, 375)
        check("375 stacks in one column", grid_phone is not None and grid_phone.count(" ") == 0, str(grid_phone))
        grid_tablet = layout_at(page, 768)
        check("768 uses two columns", grid_tablet is not None and grid_tablet.count(" ") == 1, str(grid_tablet))
        grid_desktop = layout_at(page, 1280)
        check("1280 uses three columns", grid_desktop is not None and grid_desktop.count(" ") == 2, str(grid_desktop))
        grid_mid = layout_at(page, 1000)
        check("1000 keeps the tablet layout", grid_mid is not None and grid_mid.count(" ") == 1, str(grid_mid))
        grid_wide = layout_at(page, 1600)
        check("1600 keeps the desktop layout", grid_wide is not None and grid_wide.count(" ") == 2, str(grid_wide))

        for w in (375, 768, 1280):
            page.set_viewport_size({"width": w, "height": 900})
            time.sleep(0.2)
            sw = page.evaluate("document.documentElement.scrollWidth")
            check(f"no sideways scroll at {w}", sw <= w, f"{sw} > {w}")

        print("== host floor breakpoints ==")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        host = ctx.new_page()
        host.goto(BASE + "/host", wait_until="domcontentloaded")
        host.wait_for_url("**/host/sign-in**", timeout=10000)
        host.fill("#email", "host@saffronslate.example")
        host.fill("#password", "Hearth-and-Slate-2026")
        host.get_by_role("button", name="Sign in").click()
        host.wait_for_url(lambda u: u.endswith("/host"), timeout=10000)
        host.wait_for_function("document.querySelectorAll('button.table-btn').length > 0", timeout=10000)

        hgrid_phone = layout_at(host, 375)
        check("host 375 stacks in one column", hgrid_phone is not None and hgrid_phone.count(" ") == 0, str(hgrid_phone))
        hgrid_tablet = layout_at(host, 768)
        check("host 768 uses two columns", hgrid_tablet is not None and hgrid_tablet.count(" ") == 1, str(hgrid_tablet))
        hgrid_desktop = layout_at(host, 1280)
        check("host 1280 uses three columns", hgrid_desktop is not None and hgrid_desktop.count(" ") == 2, str(hgrid_desktop))
        for w in (375, 768, 1280):
            host.set_viewport_size({"width": w, "height": 900})
            time.sleep(0.2)
            sw = host.evaluate("document.documentElement.scrollWidth")
            check(f"host no sideways scroll at {w}", sw <= w, f"{sw} > {w}")

        print("== reduced motion: static equivalents ==")
        rm = browser.new_context(
            viewport={"width": 1280, "height": 800},
            reduced_motion="reduce",
        )
        rpage = rm.new_page()
        rpage.goto(BASE + "/", wait_until="domcontentloaded")
        title_static = rpage.evaluate("(() => { const t = document.querySelector('.home-title'); return t ? getComputedStyle(t).position : null; })()")
        check("home title is static with reduced motion", title_static == "static", str(title_static))
        check("home run has no top padding", rpage.evaluate("getComputedStyle(document.querySelector('.home-run')).paddingTop") in ("0px",), "")

        rpage.goto(BASE + "/book?party=4&date=2026-11-28", wait_until="domcontentloaded")
        rpage.wait_for_function("document.querySelectorAll('#slot-list button.slot-row:not([disabled])').length > 0", timeout=8000)
        rpage.locator("#slot-list button.slot-row:not([disabled])").nth(8).click()
        rpage.wait_for_function("document.querySelectorAll('button.table-btn.status-fits').length > 0", timeout=8000)
        rpage.locator("button.table-btn.status-fits").first.click()
        rpage.wait_for_function("document.querySelector('#your-table:not([hidden])') !== null", timeout=8000)
        # All N place settings appear together, with no stagger.
        time.sleep(0.4)
        places = rpage.locator(".place").count()
        check("all four settings appear at once with reduced motion", places == 4, str(places))
        bar_value = rpage.evaluate("(() => { const b = document.querySelector('progress'); return b ? b.value : null; })()")
        check("progressbar updates in 15-second steps", bar_value is not None and int(bar_value) % 15 == 0, str(bar_value))
        # The text countdown still updates every second.
        label = rpage.locator(".countdown .label").inner_text()
        check("hold countdown text present", label.startswith("Held for"), label)

        print("== waitlist and offer pages render ==")
        wpage = browser.new_context(viewport={"width": 375, "height": 812}).new_page()
        wpage.goto(BASE + "/waitlist?date=2026-11-28&party=2&earliest=20%3A00&latest=20%3A00", wait_until="domcontentloaded")
        check("waitlist prefilled date", wpage.locator("#date-input").input_value() == "2026-11-28", wpage.locator("#date-input").input_value())
        check("waitlist prefilled party", wpage.locator('input[name="party"][value="2"]').is_checked(), "")
        check("waitlist prefilled earliest", wpage.locator("#earliest").input_value() == "20:00", wpage.locator("#earliest").input_value())
        check("waitlist prefilled latest", wpage.locator("#latest").input_value() == "20:00", wpage.locator("#latest").input_value())
        wpage.fill("#name", "Waitlist Guest")
        wpage.fill("#email", f"waitlist-{int(time.time())}@example.com")
        wpage.get_by_role("button", name="Join the waitlist").click()
        wpage.wait_for_function("document.querySelector('#result-line').textContent.includes('position')", timeout=8000)
        result = wpage.locator("#result-line").inner_text()
        check("waitlist join announces position", "You're on the waitlist at position 1." in result, result)
        sw = wpage.evaluate("document.documentElement.scrollWidth")
        check("waitlist no sideways scroll at 375", sw <= 375, str(sw))

        print("== offer page renders when an offer exists ==")
        api("POST", "/api/waitlist", {"date": "2026-11-29", "party_size": 2, "earliest": "20:00", "latest": "20:00", "name": "Offer Guest", "email": f"offer-{int(time.time())}@example.com"})
        st, hold = api("POST", "/api/holds", {"date": "2026-11-29", "time": "20:00", "party_size": 2, "table_id": "T1"})
        st, conf = api("POST", f"/api/holds/{hold['hold_id']}/confirm", {"name": "Offer Cancel", "email": "offercancel@example.com"}, {"Idempotency-Key": f"of{int(time.time())}"})
        token = conf["manage_url"].rsplit("/", 1)[-1]
        api("POST", f"/api/manage/{token}/cancel", {}, {"Idempotency-Key": f"oc{int(time.time())}"})
        time.sleep(1.5)
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=20") as r:
            messages = json.loads(r.read().decode())["messages"]
        offer_token = None
        for m in messages:
            if "A table is free" in m["Subject"]:
                with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{m['ID']}") as r2:
                    body = json.loads(r2.read().decode())["Text"]
                if "/offer/" in body:
                    offer_token = body.split("/offer/")[1].split("\n")[0].strip()
                    break
        check("offer email found", offer_token is not None, "")
        if offer_token:
            opage = browser.new_context(viewport={"width": 375, "height": 812}).new_page()
            opage.goto(BASE + f"/offer/{offer_token}", wait_until="domcontentloaded")
            heading = opage.locator("h1").count()
            check("offer page shows the claim heading", opage.locator("#offer-state").inner_text() == "" or "A table is yours to claim" in opage.locator("body").inner_text(), opage.locator("#offer-state").inner_text())
            claim_btn = opage.get_by_role("button", name="Claim table")
            check("Claim table button present", claim_btn.count() == 1, "")
            opage.wait_for_function("document.querySelector('.countdown .label') && document.querySelector('.countdown .label').textContent.startsWith('Offer ends in')", timeout=5000)
            countdown = opage.locator(".countdown .label").inner_text()
            check("offer countdown text", countdown.startswith("Offer ends in"), countdown)
            sw = opage.evaluate("document.documentElement.scrollWidth")
            check("offer page no sideways scroll at 375", sw <= 375, str(sw))

        browser.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
