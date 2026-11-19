#!/usr/bin/env python3
"""Browser checks for the host floor, walk-in dialog and deposit journey."""
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


def main():
    run = str(int(time.time()))
    subprocess.run(["/app/scripts/reset.sh"], check=True, capture_output=True)
    subprocess.Popen(["bash", "-c", "APP_CLOCK_CONTROL=1 node /app/dist/server/main.js > /tmp/server.log 2>&1 &"])
    time.sleep(5)
    # set the clock to a service time so the host floor has a current slot
    api("PUT", "/api/clock", {"now": "2026-11-18T18:30:00Z"})  # 18:30 Lisbon
    date = "2026-11-18"

    # make one booking for tonight so the floor shows something
    st, hold = api("POST", "/api/holds", {"date": date, "time": "20:00", "party_size": 2, "table_id": "T1"})
    st, conf = api("POST", f"/api/holds/{hold['hold_id']}/confirm",
                   {"name": "Host Guest", "email": "hostguest@example.com"},
                   {"Idempotency-Key": f"hg-{run}"})
    booking_ref = conf["booking"]["reference"]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        def on_console(m):
            if m.type == "error" and "401" in m.text:
                return  # the host session flow sends an expected 401
            if m.type == "error":
                errors.append(m.text)
        page.on("console", on_console)

        print("== host sign-in ==")
        page.goto(BASE + "/host", wait_until="networkidle")
        check("redirects to sign-in", "/host/sign-in" in page.url, page.url)
        page.fill("#email", "host@saffronslate.example")
        page.fill("#password", "Hearth-and-Slate-2026")
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(re.compile(r"/host"), timeout=10000)
        check("lands on host floor", page.url.startswith(BASE + "/host"), page.url)

        print("== host floor ==")
        summary = page.locator("#summary-line").inner_text()
        check("summary line", summary.startswith("Tonight ·"), summary)
        totals = page.locator("#totals").inner_text()
        check("covers totals line", "covers free at" in totals, totals[:80])
        check("room lines", "of" in totals and "seats free" in totals, totals[:200])
        bookings = page.locator("#bookings-list li")
        page.wait_for_function("document.querySelectorAll('#bookings-list li').length > 0")
        first_booking = bookings.first.inner_text()
        check("bookings list line", "·" in first_booking and "Table" in first_booking, first_booking)
        signout = page.get_by_role("button", name="Sign out")
        check("sign out button", signout.count() == 1, "")

        print("== showing time: the plan describes the last value chosen ==")
        showing = page.locator("#showing")
        showing.select_option("20:00")
        time.sleep(1.0)
        t1_state = page.locator('button.table-btn[data-table="T1"] .state').inner_text()
        check("T1 shows Booked at 20:00", t1_state == "Booked 20:00", t1_state)
        check("URL carries the showing time", "time=20%3A00" in page.url or "time=20:00" in page.url, page.url)

        print("== table dialog: seat a booking ==")
        page.locator(f'button.table-btn[data-table="T1"]').click()
        page.wait_for_selector("#table-overlay", timeout=5000)
        check("dialog opens with title", page.locator(".dialog h2").inner_text() == "Table T1", page.locator(".dialog h2").inner_text())
        seat_btn = page.get_by_role("button", name="Seat")
        check("Seat offered for booked table", seat_btn.count() == 1, "")
        check("dialog fully in viewport", page.evaluate(
            "(() => { const d = document.querySelector('.dialog'); const r = d.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()"), "")
        # focus trap: Tab stays inside
        page.keyboard.press("Tab")
        in_dialog = page.evaluate("document.querySelector('.dialog').contains(document.activeElement)")
        check("Tab stays inside dialog", in_dialog, "")
        seat_btn.click()
        page.wait_for_function("document.querySelector('#table-overlay') === null", timeout=10000)
        check("dialog closed after seat", page.locator("#table-overlay").count() == 0, "")
        time.sleep(1.0)
        t1_state = page.locator('button.table-btn[data-table="T1"] .state').inner_text()
        check("T1 shows Seated", t1_state == "Seated", t1_state)

        print("== clear the table ==")
        page.locator('button.table-btn[data-table="T1"]').click()
        page.wait_for_selector("#table-overlay")
        page.get_by_role("button", name="Clear table").click()
        page.wait_for_function("document.querySelector('#table-overlay') === null", timeout=10000)
        time.sleep(1.0)
        t1_state = page.locator('button.table-btn[data-table="T1"] .state').inner_text()
        check("T1 back to Free", t1_state == "Free", t1_state)

        print("== walk-in dialog on a phone viewport ==")
        phone = ctx.new_page()
        phone.set_viewport_size({"width": 375, "height": 812})
        phone.goto(BASE + "/host", wait_until="networkidle")
        check("phone no sideways scroll", phone.evaluate("document.documentElement.scrollWidth <= 375"), str(phone.evaluate("document.documentElement.scrollWidth")))
        phone.locator('button.table-btn[data-table="T2"]').click()
        phone.wait_for_selector("#table-overlay")
        in_vp = phone.evaluate(
            "(() => { const d = document.querySelector('.dialog'); const r = d.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; })()")
        check("walk-in dialog fits viewport", in_vp, "")
        phone.get_by_role("button", name="Add walk-in").click()
        party_select = phone.locator("#walkin-party")
        check("party size select appears", party_select.is_visible(), "")
        check("party size default 2", party_select.input_value() == "2", party_select.input_value())
        check("seat walk-in visible", phone.get_by_role("button", name="Seat walk-in").is_visible(), "")
        in_vp2 = phone.evaluate(
            "(() => { const d = document.querySelector('.dialog'); const r = d.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; })()")
        check("walk-in step still fits viewport", in_vp2, "")
        phone.get_by_role("button", name="Seat walk-in").click()
        phone.wait_for_function("document.querySelector('#table-overlay') === null", timeout=10000)
        time.sleep(1.2)
        t2_state = phone.locator('button.table-btn[data-table="T2"] .state').inner_text()
        check("T2 shows Seated after walk-in", t2_state == "Seated", t2_state)

        print("== deposit journey in the browser ==")
        guest = ctx.new_page()
        guest.goto(BASE + "/book?party=6&date=2026-11-28", wait_until="networkidle")
        guest.wait_for_function("document.querySelectorAll('#slot-list button.slot-row:not([disabled])').length > 0")
        guest.locator("#slot-list button.slot-row:not([disabled])").nth(8).click()
        guest.wait_for_function("document.querySelectorAll('button.table-btn.status-fits').length > 0")
        fits = guest.locator("button.table-btn.status-fits")
        check("party 6 fits 6-seat tables", fits.count() == 2, str(fits.count()))
        fits.first.click()
        guest.wait_for_function("document.querySelector('#your-table:not([hidden])') !== null", timeout=8000)
        guest.wait_for_function("document.querySelectorAll('.place').length === 6", timeout=6000)
        check("six place settings", guest.locator(".place").count() == 6, str(guest.locator(".place").count()))
        check("deposit paragraph shown", "A deposit of €90.00 is charged now" in guest.locator("#your-table").inner_text(), "")
        check("pay button text", guest.get_by_role("button", name="Pay €90.00 and book").count() == 1, "")
        # fill the details, then press pay without ticking the checkbox
        guest.fill("#name", "Deposit Guest")
        guest.fill("#email", f"deposit-{run}@example.com")
        guest.get_by_role("button", name="Pay €90.00 and book").click()
        guest.wait_for_selector(".field-error", timeout=5000)
        err = guest.locator(".field-error").first.inner_text()
        check("deposit field error", err == "Tick the box to accept the deposit.", err)
        guest.locator("#accept-deposit").check()
        guest.get_by_role("button", name="Pay €90.00 and book").click()
        guest.wait_for_url(re.compile(r"/manage/"), timeout=25000)
        details = guest.locator("#manage-details").inner_text()
        check("manage shows paid deposit", "Deposit €90.00 paid" in details, details[:200])

        print("== cancel with refund dialog ==")
        cancel_btn = guest.get_by_role("button", name="Cancel booking")
        cancel_btn.click()
        guest.wait_for_selector("#cancel-overlay")
        preview = guest.locator("#refund-preview").inner_text()
        check("refund preview line", preview == "Cancelling now refunds your €90.00 deposit in full.", preview)
        keep = guest.get_by_role("button", name="Keep booking")
        yes = guest.get_by_role("button", name="Yes, cancel")
        check("focus on Keep booking", guest.evaluate("document.activeElement.textContent") == "Keep booking", str(guest.evaluate("document.activeElement.textContent")))
        guest.keyboard.press("Escape")
        time.sleep(0.3)
        check("Escape closes the dialog", guest.locator("#cancel-overlay").count() == 0, "")
        check("focus returns to Cancel booking", guest.evaluate("document.activeElement.textContent") == "Cancel booking", str(guest.evaluate("document.activeElement.textContent")))
        cancel_btn.click()
        guest.wait_for_selector("#cancel-overlay")
        guest.get_by_role("button", name="Yes, cancel").click()
        guest.wait_for_function("document.querySelector('#cancelled-heading') !== null", timeout=15000)
        cancelled = guest.locator("#cancelled-heading").inner_text()
        check("cancelled heading", cancelled == "Booking cancelled", cancelled)
        guest.wait_for_function("document.activeElement && document.activeElement.id === 'cancelled-heading'", timeout=5000)
        focused = guest.evaluate("document.activeElement.id")
        check("focus on cancelled heading", focused == "cancelled-heading", str(focused))

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
