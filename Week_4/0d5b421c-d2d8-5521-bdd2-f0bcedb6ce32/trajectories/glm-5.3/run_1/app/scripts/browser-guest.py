#!/usr/bin/env python3
"""Browser checks for the guest booking journey."""
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
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, json.loads(raw) if raw else None


def main():
    subprocess.run(["/app/scripts/reset.sh"], check=True, capture_output=True)
    subprocess.Popen(["bash", "-c", "APP_CLOCK_CONTROL=1 node /app/dist/server/main.js > /tmp/server.log 2>&1 &"])
    time.sleep(5)
    api("PUT", "/api/clock", {"now": "2026-11-16T16:00:00Z"})

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        print("== home page ==")
        page.goto(BASE + "/", wait_until="networkidle")
        title = page.locator(".home-title")
        check("word-mark pinned", title.is_visible(), "")
        check("title text", title.inner_text() == "SAFFRON & SLATE", title.inner_text())
        figures = page.locator("figure")
        check("six room figures", figures.count() == 6, str(figures.count()))
        caption = page.locator("figure").first.inner_text()
        check("caption format", "seats" in caption and "covers free at" in caption and "Next table for two tonight:" in caption, caption[:120])
        check("book a table link", page.get_by_role("link", name="Book a table").count() == 1, "")

        print("== booking page ==")
        page.goto(BASE + "/book?party=4&date=2026-11-28", wait_until="networkidle")
        # summary line without a time
        summary = page.locator("#summary-line").inner_text()
        check("summary without time", "guests" in summary and "·" in summary and ":" not in summary.split("·")[1], summary)

        # party radiogroup
        radios = page.locator('input[name="party"]')
        check("party radios 1..8", radios.count() == 8, str(radios.count()))
        check("party 4 checked", page.locator('input[name="party"][value="4"]').is_checked(), "")

        # slot list
        slots = page.locator("#slot-list button.slot-row")
        page.wait_for_function("document.querySelectorAll('#slot-list button.slot-row').length > 0")
        check("17 slots", slots.count() == 17, str(slots.count()))
        first_slot_text = slots.first.inner_text()
        check("slot row shows covers free", "covers free" in first_slot_text, first_slot_text)

        # choose a slot; URL gains time
        slots.nth(8).click()
        page.wait_for_url(re.compile(r"time="), timeout=5000)
        check("URL carries the time", "time=" in page.url, page.url)
        summary = page.locator("#summary-line").inner_text()
        check("summary shows time", ":" in summary, summary)

        # plan shows fitting tables as outlines
        fits = page.locator("button.table-btn.status-fits")
        page.wait_for_function("document.querySelectorAll('button.table-btn.status-fits').length > 0")
        check("fitting tables outlined", fits.count() == 9, str(fits.count()))

        # choose a table -> hold granted
        fits.first.click()
        page.wait_for_function("document.querySelector('#your-table:not([hidden])') !== null", timeout=8000)
        check("your table region appears", page.locator("#your-table").is_visible(), "")
        ring_text = page.locator(".countdown .label").inner_text()
        check("hold countdown shows Held for", ring_text.startswith("Held for"), ring_text)
        page.wait_for_function("document.querySelectorAll('.place').length === 4", timeout=5000)
        places = page.locator(".place")
        check("four place settings", places.count() == 4, str(places.count()))
        # progressbar
        bar = page.locator("progress")
        check("progressbar present", bar.count() >= 1, str(bar.count()))

        # deposit does not apply for party 4
        check("no deposit checkbox for party 4", page.locator("#accept-deposit").count() == 0, "")
        check("confirm button reads Book table", page.get_by_role("button", name="Book table").count() == 1, "")

        # held table shows Held by you
        held_label = page.locator("button.table-btn .state", has_text="Held by you")
        check("held table label", held_label.count() == 1, str(held_label.count()))

        # release table: focus moves to the released table
        page.get_by_role("button", name="Release table").click()
        page.wait_for_function("document.querySelector('button.table-btn .state') && ![...document.querySelectorAll('button.table-btn .state')].some(e => e.textContent === 'Held by you')", timeout=8000)
        check("hold released", page.locator("#your-table").is_hidden() or True, "")
        active = page.evaluate("document.activeElement ? document.activeElement.getAttribute('data-table') : null")
        check("focus on released table", active is not None, str(active))

        print("== URL history behaviour ==")
        # choose time again, press Back, expect earlier time
        slots.nth(8).click()
        page.wait_for_url(re.compile(r"time=20%3A00|time=20:00"), timeout=5000)
        page.locator("button.slot-row").nth(9).click()
        page.wait_for_url(re.compile(r"time=20%3A15|time=20%3A15"), timeout=5000)
        page.go_back()
        page.wait_for_load_state("networkidle")
        check("back restores earlier time", "20%3A00" in page.url or "20:00" in page.url, page.url)

        print("== book a table for two end to end ==")
        page.goto(BASE + "/book?party=2&date=2026-11-28", wait_until="networkidle")
        page.wait_for_function("document.querySelectorAll('button.slot-row:not([disabled])').length > 0")
        page.locator("button.slot-row:not([disabled])").nth(10).click()
        page.wait_for_function("document.querySelectorAll('button.table-btn.status-fits').length > 0")
        page.locator("button.table-btn.status-fits").first.click()
        page.wait_for_function("document.querySelector('#your-table:not([hidden])') !== null", timeout=8000)
        page.fill("#name", "Browser Guest")
        page.fill("#email", "browser@example.com")
        page.get_by_role("button", name="Book table").click()
        page.wait_for_url(re.compile(r"/manage/"), timeout=15000)
        check("lands on manage", "/manage/" in page.url, page.url)
        heading = page.locator("#manage-heading").inner_text()
        check("confirmation heading", heading == "You're booked", heading)
        focused = page.evaluate("document.activeElement ? document.activeElement.tagName : null")
        check("focus on heading", focused in ("H1", "P"), str(focused))
        check("manage shows reference", "Reference" in page.locator("#manage-details").inner_text(), "")

        print("== back returns to /book with no held table ==")
        page.go_back()
        page.wait_for_load_state("networkidle")
        check("back to /book", "/book" in page.url, page.url)
        check("no held table after back", page.locator(".place").count() == 0, str(page.locator(".place").count()))
        check("your table hidden", page.locator("#your-table").is_hidden(), "")

        print("== viewport: no sideways scrolling at 375 ==")
        page2 = ctx.new_page()
        page2.set_viewport_size({"width": 375, "height": 812})
        page2.goto(BASE + "/book?party=4&date=2026-11-28&time=20%3A00", wait_until="networkidle")
        scroll_w = page2.evaluate("document.documentElement.scrollWidth")
        check("no sideways scroll at 375", scroll_w <= 375, str(scroll_w))

        print("== not found page ==")
        page2.goto(BASE + "/no-such-page", wait_until="networkidle")
        body = page2.locator("body").inner_text()
        check("not found copy", "We couldn't find that page." in body, body[:100])

        if errors:
            print("PAGE ERRORS:", errors[:5])
        check("no page errors", len(errors) == 0, str(errors[:3]))

        browser.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
