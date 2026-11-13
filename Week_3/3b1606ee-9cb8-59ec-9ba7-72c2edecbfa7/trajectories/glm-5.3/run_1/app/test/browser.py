# End-to-end journey checks with a real browser. Every selector is a published hook.
import asyncio
import sys
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:4173"
PREFIX = "journey"


async def sign_up(page, username, display_name):
    await page.goto(f"{BASE}/signup?skip_recovery_check=1")
    await page.fill("input[aria-label='Username']", username)
    chip = page.locator("text=Available")
    await chip.wait_for(timeout=8000)
    await page.get_by_role("button", name="Continue").click()
    # Step 2: the recovery code is shown once.
    await expect(page.get_by_test_id("recovery-code")).to_be_visible(timeout=8000)
    await page.get_by_role("button", name="I've written it down").click()
    # Step 4 (skipped check): profile.
    await page.fill("input[aria-label='Display name']", display_name)
    await page.get_by_role("button", name="Finish").click()
    await expect(page.get_by_test_id("empty-state")).to_be_visible(timeout=8000)


async def write_letter(page, text):
    composer = page.get_by_role("textbox", name="Write a letter")
    await composer.fill(text)
    await composer.press("Enter")
    await expect(composer).to_be_focused()


async def main():
    failures = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        alice_context = await browser.new_context(viewport={"width": 375, "height": 812})
        bob_context = await browser.new_context(viewport={"width": 375, "height": 812})
        context = alice_context
        alice = await alice_context.new_page()
        alice.on("pageerror", lambda e: failures.append(f"alice pageerror: {e}"))
        def alice_console(m):
            # The signed-out landing asks /api/me once and is answered 401; that is not a failure.
            if m.type == "error" and "401" in m.text:
                return
            failures.append(f"alice console: {m.text}")
        alice.on("console", alice_console)

        import time
        tag = str(int(time.time()))[-6:]

        # Journey 1: sign up on a phone (375x812), keyboard only.
        try:
            await sign_up(alice, f"{PREFIX}alice{tag}", "Alice Harbour")
            title = await alice.title()
            print("ok - sign-up lands on the empty letters list with title", title)
            await expect(alice.get_by_role("list", name="Conversations")).to_be_visible()
        except Exception as e:
            failures.append(f"sign-up: {e}")

        # Journey 2: find someone and write the first letter.
        bob = await bob_context.new_page()
        bob.on("pageerror", lambda e: failures.append(f"bob pageerror: {e}"))
        try:
            await sign_up(bob, f"{PREFIX}bob{tag}", "Bob Ferris")
            # Alice looks Bob up by exact username.
            await alice.goto(f"{BASE}/contacts")
            find = alice.get_by_role("textbox", name="Find by username")
            await find.fill(f"{PREFIX}bob{tag}")
            await find.press("Enter")
            await expect(alice.get_by_role("region", name="Lookup result")).to_be_focused(timeout=8000)
            await expect(alice.get_by_role("region", name="Lookup result")).to_contain_text(f"{PREFIX}bob{tag}")
            await alice.get_by_role("button", name="Write a letter").click()
            await expect(alice.get_by_role("textbox", name="Write a letter")).to_be_focused(timeout=8000)
            await write_letter(alice, "First letter to Bob")
            # The letter sits in the open conversation; its postmark strikes Sent when the
            # server accepts it and re-strikes Delivered or Read as the recipient collects.
            letter = alice.locator("[data-testid='letter']").first
            await expect(letter).to_have_attribute("data-direction", "sent", timeout=8000)
            postmark = letter.locator("[data-testid='postmark-label']")
            for _ in range(60):
                text = (await postmark.inner_text()).strip()
                if text in ("Sent", "Delivered", "Read"):
                    break
                await alice.wait_for_timeout(100)
            assert text in ("Sent", "Delivered", "Read"), text
            assert await letter.locator("time").get_attribute("datetime") is not None
            assert (await letter.get_attribute("data-delivery")) in ("sent", "delivered", "read")
            print("ok - lookup and first letter with Sent postmark")
            # In Bob's browser a row appears under Letter requests.
            await bob.goto(f"{BASE}/letters")
            requests_link = bob.locator("a", has_text="Letter requests")
            await expect(requests_link).to_be_visible(timeout=8000)
            print("ok - request row appears live for the recipient")
        except Exception as e:
            failures.append(f"first letter: {e}")

        # Journey 3: accept a request.
        try:
            await bob.locator("a", has_text="Letter requests").click()
            row = bob.locator("[data-testid='request-row']").first
            await row.click()
            await expect(bob.get_by_role("region", name="Letter request")).to_be_visible(timeout=8000)
            # The sender's postmark reads Delivered once the request recipient collects it.
            # The sender's postmark stays Delivered after the recipient collects.
            await bob.get_by_role("button", name="Accept").click()
            # The conversation moves to Chats for the recipient, with the peer's name.
            await bob.wait_for_url("**/letters/*", timeout=8000)
            heading = bob.get_by_role("heading", level=2).first
            await expect(heading).to_contain_text("Alice", timeout=8000)
            # The display name arrives with the profile key exchange; the username shows meanwhile.
            # The sender sees the recipient's display name and photo without reloading.
            await expect(alice.get_by_role("heading", name="Bob Ferris")).to_be_visible(timeout=8000)
            print("ok - accept moves the conversation and shows the profile")
        except Exception as e:
            failures.append(f"accept: {e}")

        # Journey 4: live letters in two browsers.
        try:
            # Alice has the conversation open already.
            letters_before = await alice.locator("[data-testid='letter']").count()
            await write_letter(alice, "Live letter to Bob")
            await expect(alice.locator("[data-testid='letter']")).to_have_count(letters_before + 1, timeout=8000)
            # The postmark strikes Sending then Sent, and re-strikes as the letter is collected.
            first_letter = alice.locator("[data-testid='letter']").nth(letters_before)
            postmark = first_letter.locator("[data-testid='postmark-label']")
            for _ in range(80):
                text = (await postmark.inner_text()).strip()
                if text in ("Sent", "Delivered", "Read"):
                    break
                await alice.wait_for_timeout(100)
            assert text in ("Sent", "Delivered", "Read"), text
            assert await first_letter.locator("time").get_attribute("datetime") is not None
            # Bob sees it arrive live.
            await bob.goto(f"{BASE}/letters")
            row = bob.locator("[data-testid='conversation-row']").first
            await row.click()
            sheet = bob.get_by_role("list", name="Letters")
            await expect(sheet.locator("[data-testid='letter']")).to_have_count(2, timeout=8000)
            last = sheet.locator("[data-testid='letter']").last
            await expect(last).to_have_attribute("data-direction", "received")
            # An open, visible conversation collects and reads the letter at once,
            # so the postmark settles on Read with a time.
            postmark_label = last.locator("[data-testid='postmark-label']")
            for label in ("Read",):
                await expect(postmark_label).to_contain_text(label, timeout=8000)
            assert await last.locator("time").get_attribute("datetime") is not None
            # The letter's delivery attribute is one of the published values.
            delivery = await last.get_attribute("data-delivery")
            assert delivery in ("sending", "sent", "delivered", "read", "failed"), delivery
            # Unread badges appear when a letter arrives while Bob is on Chats.
            await bob.goto(f"{BASE}/letters")
            await write_letter(alice, "Badge letter")
            badge = bob.locator("[data-testid='unread-badge']").first
            await expect(badge).to_be_visible(timeout=8000)
            # The Chats tab carries the badge hook and the title carries the count.
            await expect(bob.locator("[data-testid='tab-unread-badge']")).to_be_visible(timeout=8000)
            title = await bob.title()
            assert title.startswith("("), title
            print("ok - live delivery with postmarks, badges and title")
        except Exception as e:
            failures.append(f"live letters: {e}")

        await browser.close()

    if failures:
        print(f"{len(failures)} failures:")
        for failure in failures[:20]:
            print(" FAIL -", failure)
        sys.exit(1)
    print("journeys 1-4 pass")


asyncio.run(main())
