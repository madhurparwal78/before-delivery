"""Browser test for the role screens: Hours, Documents, Invoices, Shifts,
Review, Members, Usage, Packets and the public packet page."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:4173"
PASSWORD = "prep-shift-2026"


async def sign_in(browser, email):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
    page = await ctx.new_page()
    await page.goto(BASE + "/signin")
    await page.get_by_role("textbox", name="Email").fill(email)
    await page.get_by_label("Password").fill(PASSWORD)
    await page.get_by_role("button", name="Sign in").click()
    await page.wait_for_load_state("networkidle")
    return page


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errors = []
        page = await sign_in(browser, "rosa@tamalcart.test")
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE + "/hours")
        await page.wait_for_load_state("networkidle")
        assert await page.get_by_role("heading", name="Hours").count() == 1, "hours heading"
        assert await page.get_by_role("button", name="Buy 10-hour pack").count() == 1, "pack button"
        assert await page.get_by_role("button", name="Buy 25-hour pack").count() == 1, "pack button 2"
        ledger = page.get_by_role("table", name="Hours ledger")
        assert await ledger.count() == 1, "ledger table"
        headers = [h.lower() for h in await ledger.locator("thead th").all_inner_texts()]
        print("ledger headers:", headers)
        assert headers == ["date", "kind", "hours", "booking"], "ledger columns"
        print("Hours screen OK")

        # ----- Documents (member)
        await page.goto(BASE + "/documents")
        await page.wait_for_load_state("networkidle")
        form = page.get_by_role("form", name="Upload document")
        assert await form.count() == 1, "upload form"
        await form.get_by_role("combobox", name="Document type").select_option("liability_insurance")
        await form.get_by_label("Expires on").fill("2029-01-01")
        async with page.expect_file_chooser() as fc:
            await form.get_by_label("File").click()
        chooser = await fc.value
        await chooser.set_files("/tmp/test-cert.pdf")
        await form.get_by_role("button", name="Upload document").click()
        await page.wait_for_timeout(1500)
        updates = await page.get_by_role("status", name="Updates").inner_text()
        print("upload updates:", updates)
        assert "Document uploaded and waiting for review." in updates, "upload copy"
        table = page.get_by_role("table", name="Documents on file")
        assert await table.count() == 1, "documents table"
        print("Documents screen OK")

        # ----- Invoices (member, billing down)
        await page.goto(BASE + "/invoices")
        await page.wait_for_timeout(1500)
        problems = await page.get_by_role("alert", name="Problems").inner_text()
        print("invoices problems:", problems)
        assert "Invoices are unavailable while billing is unreachable." in problems, "billing down copy"

        # ----- Crew cook: Shifts
        page2 = await sign_in(browser, "tomas@tamalcart.test")
        page2.on("pageerror", lambda e: errors.append(str(e)))
        assert "/shifts" in page2.url, "crew home"
        await page2.wait_for_selector('ul[aria-label="Upcoming shifts"]')
        shifts = page2.get_by_role("list", name="Upcoming shifts")
        assert await shifts.count() == 1, "shift list"
        checkin = shifts.get_by_role("button", name="Check in: Prep Station A, 2027-02-10 08:00")
        checked = shifts.get_by_text("Checked in")
        n_checkin, n_checked = await checkin.count(), await checked.count()
        print("check-in buttons:", n_checkin, "checked-in rows:", n_checked)
        assert n_checkin == 1 or n_checked >= 1, "check-in control or checked-in state"
        print("Shifts screen OK")

        # ----- Operator: Review, Members, Usage, Packets
        page3 = await sign_in(browser, "ines@halsted-kitchen.test")
        page3.on("pageerror", lambda e: errors.append(str(e)))
        assert "/review" in page3.url, "operator home"
        await page3.wait_for_selector('table[aria-label="Documents to review"]')
        review = page3.get_by_role("table", name="Documents to review")
        count = await review.locator("tbody tr").count()
        print("review queue rows:", count)
        assert count >= 1, "review queue has the uploaded document"
        # Approve it
        row = review.locator("tbody tr").first
        await row.get_by_role("link", name="Download").count()
        await row.get_by_role("button", name="Approve").click()
        await page3.wait_for_timeout(1200)
        updates = await page3.get_by_role("status", name="Updates").inner_text()
        print("review updates:", updates)
        assert updates == "Document approved.", "approve copy"
        print("Review screen OK")

        # Members
        await page3.goto(BASE + "/members")
        await page3.wait_for_selector('table[aria-label="Members"]')
        members = page3.get_by_role("table", name="Members")
        assert await members.locator("tbody tr").count() == 3, "three members"
        assert await members.get_by_role("form", name="Adjust hours").count() == 3, "adjust forms"
        print("Members screen OK")
        late = page3.get_by_role("table", name="Late cancellations")
        assert await late.count() == 1, "late cancellations table"
        assert await late.get_by_role("button", name="Waive fee").count() >= 1, "waive controls"

        # Usage
        await page3.goto(BASE + "/usage")
        await page3.wait_for_selector('table[aria-label="Daily usage"]')
        assert await page3.get_by_role("textbox", name="Usage date").count() == 1, "usage date"
        assert await page3.get_by_role("textbox", name="Export month").count() == 1, "export month"
        link = page3.get_by_role("link", name="Export month CSV")
        assert await link.count() == 1, "export link"
        print("Usage screen OK")

        # Packets
        await page3.goto(BASE + "/packets")
        await page3.wait_for_selector('form[aria-label="New packet"]')
        form = page3.get_by_role("form", name="New packet")
        assert await form.get_by_role("textbox", name="From").count() == 1
        assert await form.get_by_role("textbox", name="To").count() == 1
        assert await form.get_by_role("textbox", name="Link expires at").count() == 1
        assert await form.get_by_role("button", name="Create packet link").count() == 1
        assert "Times are kitchen time" in (await page3.inner_text("body"))
        links = page3.get_by_role("table", name="Packet links")
        assert await links.count() == 1
        assert await links.get_by_role("button", name="Copy link").count() >= 1
        print("Packets screen OK")

        # Operator board shows business names and no painting
        await page3.goto(BASE + "/board")
        await page3.wait_for_selector('[role="grid"]')
        labels = await page3.locator('[role="gridcell"][data-cell-state="your booking"], [role="gridcell"][data-cell-state="occupied"]').count()
        print("operator sees occupied/booking cells:", labels)
        body_text = await page3.inner_text("body")
        print("operator board has business names:", "Rosa's Tamal Cart" in body_text)
        assert "Rosa's Tamal Cart" in body_text, "operator board business names"

        # Crew board: own member's bookings and anonymous spans, no painting
        await page2.goto(BASE + "/board")
        await page2.wait_for_selector('[role="grid"]')
        own = await page2.locator('[data-cell-state="your booking"]').count()
        occ = await page2.locator('[data-cell-state="occupied"]').count()
        print(f"crew board: own bookings cells={own}, occupied cells={occ}")
        assert own > 0, "crew sees own member's booking"
        text = await page2.inner_text("body")
        assert "Northside" not in text and "Lakefront" not in text, "no other business names on crew board"

        # Member board hides other members' names
        await page.goto(BASE + "/board")
        await page.wait_for_selector('[role="grid"]')
        await page.wait_for_timeout(500)
        text = await page.inner_text("body")
        assert "Northside" not in text and "Lakefront" not in text, "no other business names on member board"
        print("board visibility rules OK")

        real_errors = [e for e in errors if "401" not in e]
        assert not real_errors, f"console errors {real_errors}"
        await browser.close()
        print("ALL SCREEN CHECKS PASSED")


asyncio.run(main())
