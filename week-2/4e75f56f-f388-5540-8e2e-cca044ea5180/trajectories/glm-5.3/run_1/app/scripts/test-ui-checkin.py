"""Browser test for the check-in screen with a frozen course-day clock."""
import asyncio
import json
import urllib.request
import urllib.error
import subprocess
import time

BASE = "http://127.0.0.1:4180"


def api(method, path, body=None, cookie=None, base=BASE, key=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    if key:
        headers["Idempotency-Key"] = key
    r = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            set_cookie = resp.headers.get("Set-Cookie")
            return resp.status, json.loads(resp.read() or b"null"), (set_cookie.split(";")[0] if set_cookie else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null"), None


def stop_frozen():
    subprocess.run(
        ["bash", "-c",
         "ls /proc | grep -E '^[0-9]+$' | while read p; do "
         "if grep -q 'dist/server/main.js' /proc/$p/cmdline 2>/dev/null && tr '\\0' ' ' < /proc/$p/environ | grep -q 'APP_PUBLIC_PORT=4180'; then kill $p; fi; done"],
        capture_output=True)
    time.sleep(0.6)


def start_frozen(date):
    subprocess.Popen(
        ["bash", "-c",
         f"BENCH_DAYS_NOW={date} APP_PUBLIC_PORT=4180 APP_PUBLIC_URL=http://127.0.0.1:4180 nohup node dist/server/main.js > /tmp/checkin_server.log 2>&1 &"],
        cwd="/app")
    time.sleep(2.5)


async def main():
    from playwright.async_api import async_playwright

    stop_frozen()
    start_frozen("2027-04-16T15:00:00Z")

    # A paid attendee with an accepted assignment.
    _, _, clinic_jar = api("POST", "/api/auth/signup", {"name": "Casey Orr", "email": "casey@clinic.test", "password": "clinic-days-2027-pass", "kind": "clinic", "clinic_name": "Orr Dental"})
    _, group, _ = api("POST", "/api/holds", {"benches": ["C2"]}, cookie=clinic_jar)
    gid = group["group_id"]
    rid = group["reservations"][0]["id"]
    api("POST", f"/api/groups/{gid}/checkout", {"billing_name": "Orr Dental", "assignments": [{"bench": "C2", "name": "Talia Marsh", "email": "talia@example.test"}]}, cookie=clinic_jar, key="checkin-grp-1")
    # The assigned colleague signs up with the invited email and accepts.
    _, _, talia_jar = api("POST", "/api/auth/signup", {"name": "Talia Marsh", "email": "talia@example.test", "password": "bench-days-2027-pass", "kind": "practitioner"})
    code, res, _ = api("POST", f"/api/reservations/{rid}/accept", {}, cookie=talia_jar)
    assert code == 200, f"accept failed: {code} {res}"

    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: errors.append(f"checkin pageerror: {e}"))

        await page.goto(BASE + "/checkin", wait_until="networkidle")
        # The heading comes from the server's open day.
        await page.get_by_role("button", name="Sign in").click()
        dialog = page.locator("dialog[aria-label='Sign in']")
        await dialog.wait_for(state="visible", timeout=5000)
        await dialog.locator("input[type='email']").fill("frontdesk@opaline-institute.test")
        await dialog.locator("input[type='password']").fill("bench-days-frontdesk-2027")
        await dialog.get_by_role("button", name="Sign in").click()
        await page.wait_for_timeout(2000)

        heading = await page.locator("#checkin-heading").text_content()
        assert heading == "Day 1 check-in", f"checkin heading: {heading}"
        print("day heading ok")

        # The search shortcut: / focuses the search box.
        await page.keyboard.press("/")
        focused = await page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')")
        assert focused == "Attendee name", f"focus after /: {focused}"
        print("search shortcut ok")

        # Typing two characters lists matches for the current text.
        await page.keyboard.type("ta")
        await page.wait_for_timeout(700)
        matches = await page.locator("#match-list button").count()
        assert matches == 1, f"matches: {matches}"
        status = await page.text_content("[id='live-Check-in updates']")
        assert status and "Found 1" in status, f"announcement: {status}"
        print("match list and announcement ok")

        # Down moves to the match; Enter checks them in for today's day.
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(1500)
        status = await page.text_content("[id='live-Check-in updates']")
        assert status and "Talia Marsh checked in for day 1." in status, f"checked-in announcement: {status}"
        # Focus returns to the search box, selected.
        focused = await page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')")
        assert focused == "Attendee name", f"focus after check-in: {focused}"
        print("keyboard check-in ok")

        # The server records the check-in.
        _, _, frontjar = api("POST", "/api/auth/signin", {"email": "frontdesk@opaline-institute.test", "password": "bench-days-frontdesk-2027"})
        status_code, results, _ = api("GET", "/api/checkin?q=talia", cookie=frontjar)
        assert results["results"][0]["day1"] is True, f"server day1: {results}"

        # Day 2 on the next venue date.
        stop_frozen()
        start_frozen("2027-04-17T15:00:00Z")
        await page.goto(BASE + "/checkin", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        heading = await page.locator("#checkin-heading").text_content()
        assert heading == "Day 2 check-in", f"day 2 heading: {heading}"
        await page.fill("[aria-label='Attendee name']", "Talia")
        await page.wait_for_timeout(700)
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(1500)
        status = await page.text_content("[id='live-Check-in updates']")
        assert status and "Talia Marsh checked in for day 2." in status, f"day 2 announcement: {status}"
        print("day 2 check-in ok")

        # Any other date closes check-in.
        stop_frozen()
        start_frozen("2027-04-18T15:00:00Z")
        await page.goto(BASE + "/checkin", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        heading = await page.locator("#checkin-heading").text_content()
        assert heading == "Check-in is closed today", f"closed heading: {heading}"
        print("closed-day heading ok")

        await browser.close()

    stop_frozen()
    if errors:
        print("\n".join(errors[:6]))
    print("CHECK-IN UI CHECKS PASSED" if not errors else f"PASSED WITH {len(errors)} ERRORS")


asyncio.run(main())
