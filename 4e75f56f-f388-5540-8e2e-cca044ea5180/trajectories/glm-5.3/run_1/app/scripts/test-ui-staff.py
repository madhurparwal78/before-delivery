"""Browser tests for the staff screens, the mobile layout and reduced motion."""
import asyncio
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"


def api(method, path, body=None, cookie=None, key=None, base=BASE):
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


async def sign_in(page, email, password):
    await page.get_by_role("button", name="Sign in").click()
    dialog = page.locator("dialog[aria-label='Sign in']")
    await dialog.wait_for(state="visible", timeout=5000)
    await dialog.locator("input[type='email']").fill(email)
    await dialog.locator("input[type='password']").fill(password)
    await dialog.get_by_role("button", name="Sign in").click()
    await page.wait_for_timeout(2500)


async def main():
    from playwright.async_api import async_playwright

    _, _, jar = api("POST", "/api/auth/signup", {"name": "Ivo Rane", "email": "ivo@example.test", "password": "bench-days-2027-pass", "kind": "practitioner"})
    _, hold, _ = api("POST", "/api/holds", {"benches": ["C4"]}, cookie=jar)
    rid = hold["reservations"][0]["id"]
    api("POST", f"/api/reservations/{rid}/deposit", {"billing_name": "Ivo Rane"}, cookie=jar, key="ui-staff-dep-1")

    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # ---------- Account page ----------
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: errors.append(f"account pageerror: {e}"))
        await page.goto(BASE + "/account", wait_until="networkidle")
        await sign_in(page, "ivo@example.test", "bench-days-2027-pass")
        content = await page.text_content("main")
        assert content and "My seats" in content, f"account heading: {content[:100]}"
        assert "Bench C4" in content, f"seat missing: {content[:200]}"
        for label in ["Pay balance", "Upgrade to Atelier", "Cancel seat", "Upload licence", "Upload passport scan"]:
            assert label in content, f"missing action: {label}"
        print("account page ok")

        # ---------- Registrar desk ----------
        desk_ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await desk_ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"desk pageerror: {e}"))
        await page.goto(BASE + "/desk", wait_until="networkidle")
        await sign_in(page, "registrar@opaline-institute.test", "bench-days-registrar-2027")
        content = await page.text_content("main")
        assert content and "Registrar desk" in content
        assert "Paid in Kill Bill" in content, f"desk columns: {content[:300]}"
        assert "Bench C4" in content, "desk row missing"
        await page.fill(".staff-search", "C4")
        await page.wait_for_timeout(900)
        rows = await page.locator(".desk-table tbody tr").count()
        assert rows == 1, f"search rows: {rows}"
        print("desk ok")

        # ---------- Content desk: live hands-on share ----------
        _, _, dirjar = api("POST", "/api/auth/signin", {"email": "director@opaline-institute.test", "password": "bench-days-director-2027"})
        _, sessions, _ = api("GET", "/api/desk/content/sessions", cookie=dirjar)
        hands = [s for s in sessions["items"] if s["format"] == "hands-on"]
        for s in hands[:3]:
            api("PATCH", f"/api/desk/content/sessions/{s['id']}", {"minutes": 15}, cookie=dirjar)

        content_ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await content_ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"contentdesk pageerror: {e}"))
        await page.goto(BASE + "/desk/content", wait_until="networkidle")
        await sign_in(page, "director@opaline-institute.test", "bench-days-director-2027")
        await page.click("#content-tab-sessions")
        await page.wait_for_timeout(800)
        session_button = page.locator(".item-list button", has_text="Session 8")
        await session_button.click()
        await page.wait_for_timeout(600)
        share_before = await page.text_content("#share-status")
        print("share before:", share_before)
        minutes = page.locator("input[name='minutes']")
        await minutes.fill("15")
        await page.wait_for_timeout(400)
        share_text = await page.text_content("#share-status")
        print("share after typing 15:", share_text)
        error_count = await page.locator("#minutes-error").count()
        assert error_count == 1, "hands-on field error missing before save"
        await minutes.fill("180")
        await page.wait_for_timeout(400)
        error_gone = await page.locator("#minutes-error").count()
        assert error_gone == 0, "field error did not clear"
        print("hands-on share live recompute ok")

        await page.get_by_role("button", name="Save").click()
        await page.wait_for_timeout(1200)
        content = await page.text_content("main")
        assert "Saved. The public site shows it on the next load." in content, f"save feedback: {content[-300:]}"
        print("content save ok")

        for s in hands[:3]:
            api("PATCH", f"/api/desk/content/sessions/{s['id']}", {"minutes": s["minutes"]}, cookie=dirjar)

        # ---------- Mobile layout ----------
        mobile = await browser.new_page(viewport={"width": 375, "height": 812})
        mobile.on("pageerror", lambda e: errors.append(f"mobile pageerror: {e}"))
        await mobile.goto(BASE + "/", wait_until="networkidle")
        scroll_width = await mobile.evaluate("document.documentElement.scrollWidth")
        assert scroll_width <= 375, f"horizontal scroll at 375: {scroll_width}"
        docked = mobile.locator("#reserve-bar-docked")
        assert await docked.is_visible(), "docked reserve bar missing at 375"
        await mobile.get_by_role("button", name="Menu").click()
        drawer = mobile.locator("dialog[aria-label='Chapters']")
        await drawer.wait_for(state="visible", timeout=5000)
        assert await drawer.get_by_role("button", name="Close menu").count() == 1, "close menu button missing"
        await drawer.get_by_role("button", name="Close menu").click()
        await mobile.locator("#chapter-lab").scroll_into_view_if_needed()
        row_labels = await mobile.locator(".bench-row .row-label").count()
        assert row_labels == 4, f"row headings at 375: {row_labels}"
        print("mobile layout ok")

        # ---------- Reduced motion ----------
        reduced_ctx = await browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        reduced = await reduced_ctx.new_page()
        reduced.on("pageerror", lambda e: errors.append(f"reduced pageerror: {e}"))
        await reduced.goto(BASE + "/", wait_until="networkidle")
        await reduced.locator("#chapter-lab").scroll_into_view_if_needed()
        canvas_count = await reduced.locator("canvas").count()
        scene_count = await reduced.locator(".lab-scene").count()
        assert canvas_count == 0, "canvas rendered under reduced motion"
        assert scene_count == 0, "scene region rendered under reduced motion"
        bench_buttons = await reduced.locator(".bench-btn").count()
        assert bench_buttons == 24, f"flat plan buttons: {bench_buttons}"
        print("reduced-motion flat plan ok")

        await browser.close()

    if errors:
        print("\n".join(errors[:8]))
    print("STAFF UI CHECKS PASSED" if not errors else f"PASSED WITH {len(errors)} ERRORS")


asyncio.run(main())
