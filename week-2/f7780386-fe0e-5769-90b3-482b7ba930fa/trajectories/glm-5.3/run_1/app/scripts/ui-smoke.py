"""Browser smoke test for Passboard: sign in, board rendering, painting a
hold with the pointer, confirming it, and the role screens' structure."""
import asyncio
import json
import urllib.request
import http.cookiejar
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:4173"


class Api:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        with self.opener.open(req) as res:
            text = res.read().decode()
            return json.loads(text) if text else None

    def sign_in(self, email):
        return self.request("POST", "/api/session", {"email": email, "password": "prep-shift-2026"})


def cleanup_board_slots(api):
    """Cancel leftover test bookings and release leftover holds so the test
    is repeatable."""
    api.sign_in("rosa@tamalcart.test")
    kitchen = api.request("GET", "/api/kitchen")
    today = kitchen["today"]
    board = api.request("GET", f"/api/board?date={today}")
    for station in board["stations"]:
        for seg in station["segments"]:
            if seg["kind"] == "hold" and seg["status"] == "live":
                api.request("DELETE", f"/api/holds/{seg['id']}")
    bookings = api.request("GET", f"/api/bookings?from={today}&to={today}")["bookings"]
    for b in bookings:
        if b["station_id"] == "oven-2" and b["start"] == "14:00" and b["status"] in ("confirmed", "checked_in"):
            api.request("POST", f"/api/bookings/{b['id']}/cancel", {})



async def main():
    cleanup_board_slots(Api())
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        await page.goto(BASE + "/signin")
        await page.wait_for_load_state("networkidle")
        print("title:", await page.title())
        body = await page.inner_text("body")
        print("body text:", body[:200])
        # Sign in form
        assert await page.get_by_role("form", name="Sign in").count() == 1, "sign-in form"
        print("sign-in form present")
        await page.get_by_role("textbox", name="Email").fill("rosa@tamalcart.test")
        await page.get_by_label("Password").fill("prep-shift-2026")
        await page.get_by_role("button", name="Sign in").click()
        await page.wait_for_url("**/board")
        await page.wait_for_selector('[role="grid"]')
        print("board grid present")

        # Headings and controls
        assert await page.get_by_role("heading", name="Line board").count() == 1, "board heading"
        for name in ["Previous day", "Next day", "Today", "Sign out"]:
            assert await page.get_by_role("button", name=name).count() == 1, f"button {name}"
        nav = page.get_by_role("navigation", name="Main")
        assert await nav.count() == 1, "nav"
        for link in ["Board", "Hours", "Documents", "Invoices"]:
            assert await nav.get_by_role("link", name=link).count() == 1, f"nav link {link}"
        print("nav and controls present")

        # Live regions
        assert await page.get_by_role("status", name="Updates").count() == 1, "updates"
        assert await page.get_by_role("alert", name="Problems").count() == 1, "problems"

        # Gridcells with names
        cell = page.locator('[role="gridcell"]').first
        label = await cell.get_attribute("aria-label")
        print("first cell label:", label)
        assert label and "Convection Oven 1" in label and "05:00" in label, "cell label"

        # Rail region and balance
        rail = page.get_by_role("region", name="My tickets")
        assert await rail.count() == 1, "rail"
        print("balance text present:", "Prepaid" in (await rail.inner_text()))

        # Paint a hold with the pointer: drag across Deck Oven from 14:00 to 16:00
        async def cell_bbox(station_id, minutes):
            idx = (minutes - 300) // 15
            loc = page.locator(f'[data-station-id="{station_id}"][data-cell-index="{idx}"]')
            assert await loc.count() == 1, f"cell {station_id} {minutes}"
            return await loc.bounding_box()

        start = await cell_bbox("oven-2", 14 * 60)
        end = await cell_bbox("oven-2", 16 * 60)
        await page.mouse.move(start["x"] + 5, start["y"] + 10)
        await page.mouse.down()
        await page.mouse.move(end["x"] - 5, end["y"] + 10, steps=8)
        await page.mouse.up()
        await page.wait_for_timeout(800)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("updates:", updates)
        assert "Hold placed: Deck Oven, 14:00–16:00" in updates, "hold placed copy"

        # The rail now holds a ticket with a countdown timer
        ticket = page.get_by_role("button", name="Ticket Deck Oven, 2027-02-10 14:00–16:00, hold")
        assert await ticket.count() == 1, "ticket in rail"
        timer = ticket.get_by_role("timer", name="Hold time left")
        assert await timer.count() == 1, "countdown timer"
        print("countdown:", await timer.inner_text())

        # Open the drawer from the ticket and confirm
        await ticket.click()
        drawer = page.get_by_role("complementary", name="Ticket details")
        assert await drawer.count() == 1, "drawer"
        await page.get_by_role("button", name="Confirm booking").click()
        await page.wait_for_timeout(1200)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("updates:", updates)
        assert "Booking confirmed: Deck Oven, 2027-02-10 14:00–16:00" in updates, "confirmed copy"

        # The ticket state follows the payment outcome named in Updates.
        banner = page.get_by_role("status", name="Billing status")
        assert await banner.count() == 1, "billing banner"
        assert "Billing is unreachable" in (await banner.inner_text()), "banner copy"
        if "Payment pending" in updates:
            ticket2 = page.get_by_role("button", name="Ticket Deck Oven, 2027-02-10 14:00–16:00, payment pending")
            await ticket2.wait_for(state="visible", timeout=5000)
            assert "Payment pending" in (await ticket2.inner_text()), "payment pending slip text"
        else:
            ticket2 = page.get_by_role("button", name="Ticket Deck Oven, 2027-02-10 14:00–16:00, confirmed")
            await ticket2.wait_for(state="visible", timeout=5000)
        print("UI hold -> confirm journey OK")

        # Keyboard painting: focus the grid, move the cursor with arrows,
        # grow a selection with Shift+Arrow, place with Enter.
        await page.locator('[role="grid"]').focus()
        await page.wait_for_timeout(100)
        cursor_cells = await page.locator(".board-cell.cursor").count()
        print("cursor cells:", cursor_cells)
        assert cursor_cells >= 1, "keyboard cursor visible"

        async def cursor_pos():
            el = await page.locator(".board-cell.cursor").first.get_attribute("data-cell-index")
            return int(el)

        target_cell = (18 * 60 - 300) // 15  # 18:00
        target_row = 5  # Walk-in Shelf 1
        cur = await cursor_pos()
        for _ in range(target_row):
            await page.keyboard.press("ArrowDown")
        for _ in range(target_cell - cur):
            await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(100)
        assert await cursor_pos() == target_cell, "cursor moved"
        await page.keyboard.press("Shift+ArrowRight")
        await page.keyboard.press("Shift+ArrowRight")
        await page.wait_for_timeout(200)
        tag = await page.get_by_role("status", name="Paint cost").inner_text()
        print("paint cost tag:", tag)
        assert tag.startswith("0:45"), "cost tag duration"
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(1000)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("updates after Enter:", updates)
        assert "Hold placed: Walk-in Shelf 1" in updates, "keyboard hold"
        print("keyboard painting OK")

        # Release the keyboard hold: the cursor is on the hold's start cell.
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(900)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("updates after Escape:", updates)
        assert "Hold released." in updates, "keyboard release"
        print("keyboard release OK")

        # Cancel the booking so the test can rerun: open it from the rail.
        await ticket2.click()
        await page.get_by_role("button", name="Cancel booking").click()
        await page.get_by_role("button", name="Yes, cancel booking").click()
        await page.wait_for_timeout(1200)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("updates after cancel:", updates)
        assert "Booking cancelled." in updates, "cancel copy"

        # Narrow viewport: page never scrolls sideways
        await page.set_viewport_size({"width": 375, "height": 812})
        await page.wait_for_timeout(400)
        overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        print("375px sideways overflow:", overflow)
        assert not overflow, "no sideways page scroll at 375"
        for width in (768, 1280):
            await page.set_viewport_size({"width": width, "height": 1024 if width == 768 else 800})
            await page.wait_for_timeout(300)
            overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            print(f"{width}px sideways overflow:", overflow)
            assert not overflow, f"no sideways page scroll at {width}"

        if errors:
            print("BROWSER ERRORS:", errors)
        real_errors = [e for e in errors if "401" not in e]
        assert not real_errors, f"console errors {real_errors}"
        await browser.close()
        print("ALL UI CHECKS PASSED")


asyncio.run(main())
