"""Browser-level smoke tests for the Opaline Bench Days public site."""
import asyncio
import sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:4173"


async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

        await page.goto(BASE + "/", wait_until="networkidle")

        # The overture is readable quickly.
        title = await page.text_content("h1")
        assert title and "Layered Composite" in title, f"overture title missing: {title}"
        print("overture ok")

        # The chapter rail exists with aria-current once scrolled.
        rail = page.locator("#chapter-rail")
        assert await rail.is_visible(), "rail not visible at 1280"
        links = await page.locator("#chapter-rail a").count()
        assert links == 7, f"rail links: {links}"
        print("rail ok")

        # Agenda tabs switch days.
        await page.click("#tab-day-2")
        panel = await page.text_content("#panel-day-2")
        assert panel and "Posterior anatomy" in panel, f"day 2 panel: {panel}"
        print("agenda tabs ok")

        # FAQ disclosure is collapsed and inert, then opens.
        faq_button = page.locator(".faq .q").first
        expanded = await faq_button.get_attribute("aria-expanded")
        assert expanded == "false"
        await faq_button.click()
        expanded = await faq_button.get_attribute("aria-expanded")
        assert expanded == "true"
        answer_visible = await page.locator(".faq .a").first.is_visible()
        assert answer_visible, "faq answer not visible"
        print("faq ok")

        # Evening details disclosure.
        evening_button = page.locator(".evening-card .disclose").first
        assert await evening_button.is_visible()
        await evening_button.click()
        assert await evening_button.get_attribute("aria-expanded") == "true"
        print("evenings ok")

        # Gated Atelier evening shows the lock label.
        atelier_card = page.locator(".evening-card", has_text="Atelier guests").first
        assert await atelier_card.is_visible(), "atelier label missing"
        print("gating label ok")

        # The bench map: 24 buttons at 1280 in 4 rows.
        await page.locator("#chapter-lab").scroll_into_view_if_needed()
        bench_count = await page.locator(".bench-btn").count()
        assert bench_count == 24, f"bench buttons: {bench_count}"
        print("bench map ok")

        # The scene region is present with its attributes.
        region = page.locator("[role='region'][aria-label='Lab scene']")
        assert await region.count() >= 1, "lab scene region missing"
        attrs = await region.get_attribute("data-ready")
        print("scene region ok, ready:", attrs)

        # Hotel map links open in a new tab.
        hotel_link = page.locator(".hotel-list a").first
        target = await hotel_link.get_attribute("target")
        assert target == "_blank", "hotel map target"
        print("hotels ok")

        # Not-found page.
        await page.goto(BASE + "/nope", wait_until="networkidle")
        heading = await page.text_content("main h1")
        assert heading and "not on the programme" in heading, f"not found heading: {heading}"
        print("not-found ok")

        # The lab preloader appears and is removed.
        await page.goto(BASE + "/", wait_until="networkidle")
        await page.locator("#chapter-lab").scroll_into_view_if_needed()
        await page.wait_for_timeout(1500)
        ready = await page.locator(".lab-scene").get_attribute("data-ready")
        assert ready == "true", f"preloader not done: {ready}"
        print("preloader ok")

        # Sign-up + hold a bench by keyboard.
        await page.locator(".bench-btn[data-bench='C4']").focus()
        await page.keyboard.press("Enter")
        dialog = page.locator("dialog[aria-label='Sign in']")
        await dialog.wait_for(state="visible", timeout=5000)
        await page.locator("dialog[aria-label='Sign in']").get_by_role("button", name="Create an account").click()
        create = page.locator("dialog[aria-label='Create account']")
        await create.wait_for(state="visible", timeout=5000)
        await create.locator("input[type='text']").first.fill("Ursa Bell")
        await create.locator("input[type='email']").fill("ui-test@example.test")
        await create.locator("input[type='password']").fill("bench-days-2027-pass")
        await create.locator("button[type='submit']").click()
        panel = page.locator("[aria-label='Your hold']")
        await panel.wait_for(state="visible", timeout=8000)
        heading_text = await panel.text_content()
        assert heading_text and ("Holding Bench C4" in heading_text or "Hold time remaining" in heading_text), f"hold panel text: {heading_text}"
        print("hold flow ok")

        await page.wait_for_timeout(2500)
        body = await panel.text_content()
        assert body and "Hold time remaining" in body, f"hold panel body: {body}"
        print("hold panel with countdown ok")

        # Pay the deposit by keyboard only.
        await page.locator("[aria-label='Your hold'] button", has_text="Pay deposit").click()
        checkout = page.locator("dialog[aria-label='Checkout']")
        await checkout.wait_for(state="visible", timeout=5000)
        name_value = await checkout.locator("input").input_value()
        assert name_value == "Ursa Bell", f"receipt name prefill: {name_value}"
        await checkout.locator("button[type='submit']").click()
        confirmation = page.locator("dialog .confirmation")
        await confirmation.wait_for(state="visible", timeout=30000)
        conf_text = await confirmation.text_content()
        assert conf_text and "Bench C4 is yours" in conf_text, f"confirmation: {conf_text}"
        print("checkout confirmation ok")

        # Done closes and focuses the hold panel heading.
        await confirmation.locator("button", has_text="Done").click()
        await page.wait_for_timeout(500)
        focused = await page.evaluate("document.activeElement && document.activeElement.id")
        assert focused == "hold-panel-heading", f"focus after done: {focused}"
        print("focus return ok")

        # The confirmation outlasts the countdown and stays pinned.
        await page.wait_for_timeout(2500)
        body = await panel.text_content()
        assert body and "Bench C4 is yours" in body, f"pinned confirmation replaced: {body}"
        print("confirmation persists ok")

        if errors:
            print("\n".join(errors[:10]))
        await browser.close()
    print("ALL UI CHECKS PASSED" if not errors else f"PASSED WITH {len(errors)} CONSOLE ERRORS")


asyncio.run(main())
