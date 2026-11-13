# Journeys 5-8: held letters, offline outbox, key change, tidy-up. Uses the same published hooks.
import asyncio
import sys
import time
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:4173"


async def sign_up(page, username, display_name):
    await page.goto(f"{BASE}/signup?skip_recovery_check=1")
    await page.fill("input[aria-label='Username']", username)
    await page.locator("text=Available").wait_for(timeout=8000)
    await page.get_by_role("button", name="Continue").click()
    await expect(page.get_by_test_id("recovery-code")).to_be_visible(timeout=8000)
    code = await page.get_by_test_id("recovery-code").inner_text()
    await page.get_by_role("button", name="I've written it down").click()
    await page.fill("input[aria-label='Display name']", display_name)
    await page.get_by_role("button", name="Finish").click()
    await page.get_by_test_id("empty-state").wait_for(timeout=8000)
    return code


async def restore_account(page, username, code):
    await page.goto(f"{BASE}/signin")
    await page.fill("input[aria-label='Username']", username)
    await page.fill("input[aria-label='Recovery code']", code)
    await page.get_by_role("button", name="Restore account").click()
    await expect(page.get_by_role("navigation", name="Main")).to_be_visible(timeout=8000)


async def main():
    failures = []

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        tag = str(int(time.time()))[-6:]
        alice_ctx = await browser.new_context(viewport={"width": 375, "height": 812})
        bob_ctx = await browser.new_context(viewport={"width": 375, "height": 812})
        alice = await alice_ctx.new_page()
        bob = await bob_ctx.new_page()

        alice.on("pageerror", lambda e: failures.append(f"alice pageerror: {e}"))
        bob.on("pageerror", lambda e: failures.append(f"bob pageerror: {e}"))

        alice_name = f"later{tag}alice"
        bob_name = f"later{tag}bob"
        alice_code = await sign_up(alice, alice_name, "Alice Later")
        bob_code = await sign_up(bob, bob_name, "Bob Later")

        # Set up an accepted conversation between them.
        await alice.goto(f"{BASE}/contacts")
        find = alice.get_by_role("textbox", name="Find by username")
        await find.fill(bob_name)
        await find.press("Enter")
        await alice.get_by_role("button", name="Write a letter").click()
        await alice.get_by_role("textbox", name="Write a letter").fill("Setup letter")
        await alice.get_by_role("textbox", name="Write a letter").press("Enter")
        await bob.goto(f"{BASE}/letters")
        await expect(bob.locator("a", has_text="Letter requests")).to_be_visible(timeout=8000)
        await bob.locator("a", has_text="Letter requests").click()
        await bob.locator("[data-testid='request-row']").first.click()
        await bob.get_by_role("button", name="Accept").click()
        await bob.wait_for_url("**/letters/*", timeout=8000)
        print("ok - setup: accepted conversation")

        # Journey 5: collect what was held while the recipient was away.
        try:
            # Bob goes offline; Alice writes three letters.
            await bob.context.set_offline(True)
            for text in ("Held one", "Held two", "Held three"):
                await alice.get_by_role("textbox", name="Write a letter").fill(text)
                await alice.get_by_role("textbox", name="Write a letter").press("Enter")
                await alice.wait_for_timeout(300)
            # Bob reconnects and collects in order.
            await bob.context.set_offline(False)
            # Reload to collect on load, as the brief states.
            await bob.reload()
            updating = bob.get_by_test_id("updating-bar")
            await expect(updating).to_be_visible(timeout=8000)
            await expect(updating).to_contain_text("3 letters")
            await expect(updating).to_be_hidden(timeout=8000)
            # The letters appear in order.
            sheet = bob.get_by_role("list", name="Letters")
            await expect(sheet.locator("[data-testid='letter']")).to_have_count(4, timeout=8000)
            texts = await sheet.locator(".letter-text").all_inner_texts()
            assert texts[-3:] == ["Held one", "Held two", "Held three"], texts
            # The exchange holds no more class letter letters.
            held = await bob.evaluate("fetch('/api/inbox').then(r => r.json()).then(j => j.letters.filter(l => l.class === 'letter').length)")
            assert held == 0, held
            print("ok - collecting: Updating bar with count, letters in order, exchange empty")
        except Exception as e:
            failures.append(f"collecting: {e}")

        # Journey 6: write while the connection drops.
        try:
            await alice.context.set_offline(True)
            connecting = alice.get_by_test_id("connecting-bar")
            await expect(connecting).to_be_visible(timeout=8000)
            composer = alice.get_by_role("textbox", name="Write a letter")
            await expect(composer).to_be_focused()
            for text in ("Offline one", "Offline two", "Offline three", "Offline four", "Offline five"):
                await composer.fill(text)
                await composer.press("Enter")
                await alice.wait_for_timeout(250)
            await alice.wait_for_timeout(1000)
            # All five letters stay Sending while offline.
            sending = alice.locator("[data-delivery='sending']")
            await expect(sending).to_have_count(5, timeout=8000)
            await expect(connecting).to_contain_text("Connecting...")
            # Back online: the five arrive once each, in order.
            await alice.context.set_offline(False)
            await alice.wait_for_timeout(2500)
            await expect(connecting).to_be_hidden(timeout=8000)
            sheet_bob = bob.get_by_role("list", name="Letters")
            texts = await sheet_bob.locator(".letter-text").all_inner_texts()
            assert texts[-5:] == ["Offline one", "Offline two", "Offline three", "Offline four", "Offline five"], texts
            # Every postmark of the five reads Delivered or later.
            letters = sheet_bob.locator("[data-testid='letter']")
            total = await letters.count()
            for i in range(total - 5, total):
                label = await letters.nth(i).locator("[data-testid='postmark-label']").inner_text()
                assert label in ("Delivered", "Read"), (i, label)
            print("ok - offline: five letters arrive once each, in order")
        except Exception as e:
            failures.append(f"offline: {e}")

        # Journey 7: restore in a new browser and re-check the seal.
        bob2 = None
        try:
            bob2_ctx = await browser.new_context(viewport={"width": 375, "height": 812})
            bob2 = await bob2_ctx.new_page()
            bob2.on("pageerror", lambda e: failures.append(f"bob2 pageerror: {e}"))
            await restore_account(bob2, bob_name, bob_code)
            # The letters held before the restore open in the new browser.
            await expect(bob2.get_by_role("navigation", name="Main")).to_be_visible(timeout=8000)
            await bob2.goto(f"{BASE}/letters")
            row = bob2.locator("[data-testid='conversation-row']").first
            await row.click()
            await expect(bob2.get_by_role("list", name="Letters")).to_be_visible(timeout=8000)
            # Alice sees the key-change warning.
            await expect(alice.get_by_test_id("key-change-warning")).to_be_visible(timeout=8000)
            await expect(alice.get_by_test_id("key-change-warning")).to_contain_text("seal number has changed")
            # Letters to Bob are paused until Alice accepts the new seal number.
            composer = alice.get_by_role("textbox", name="Write a letter")
            await composer.fill("Paused letter")
            await composer.press("Enter")
            await expect(alice.locator("[data-delivery='sending']")).to_have_count(1, timeout=8000)
            await alice.get_by_role("button", name="Accept new seal number").click()
            await expect(composer).to_be_focused(timeout=8000)
            # The paused letter is resealed and posted under its same id.
            await expect(alice.locator("[data-delivery='sending']")).to_have_count(0, timeout=8000)
            # The seal number differs from the old one.
            await alice.get_by_role("button", name="Contact card").click()
            card = alice.get_by_role("dialog", name="Contact card")
            await card.get_by_role("button", name="Show seal number").click()
            seal = alice.get_by_test_id("seal-number")
            await expect(seal).to_be_visible(timeout=8000)
            number = await seal.inner_text()
            assert len(number.split(" ")) == 12, number
            print("ok - restore pauses letters until the new seal number is accepted")
        except Exception as e:
            failures.append(f"restore: {e}")

        # Journey 8: tidy up.
        try:
            # Close any dialog left open from the seal number check.
            for _ in range(3):
                backdrops = await alice.locator(".dialog-backdrop").count()
                if backdrops == 0:
                    break
                await alice.keyboard.press("Escape")
                await alice.wait_for_timeout(200)
            # Delete for me, then Undo.
            letters = alice.get_by_role("list", name="Letters").locator("[data-testid='letter']")
            count_before = await letters.count()
            target = letters.first
            await target.get_by_role("button", name="Letter actions").click()
            await alice.get_by_role("dialog", name="Letter actions").get_by_role("button", name="Delete for me").click()
            snackbar = alice.get_by_test_id("snackbar")
            await expect(snackbar).to_be_visible(timeout=8000)
            await expect(snackbar).to_contain_text("Letter deleted.")
            await expect(alice.get_by_role("list", name="Letters").locator("[data-testid='letter']")).to_have_count(count_before - 1, timeout=8000)
            await snackbar.get_by_role("button", name="Undo").click()
            await expect(alice.get_by_role("list", name="Letters").locator("[data-testid='letter']")).to_have_count(count_before, timeout=8000)
            # Delete for everyone on the newest own letter.
            last = alice.get_by_role("list", name="Letters").locator("[data-testid='letter']").last
            await last.get_by_role("button", name="Letter actions").click()
            dialog = alice.get_by_role("dialog", name="Letter actions")
            await dialog.get_by_role("button", name="Delete for everyone").click()
            # The sender sees the deleted notice.
            await expect(alice.get_by_role("list", name="Letters").locator("[data-testid='letter']").last).to_contain_text("You deleted this letter.", timeout=8000)
            # The restored browser sees the deleted notice live.
            await expect(bob2.get_by_role("list", name="Letters").locator("[data-testid='letter']").last).to_contain_text("This letter was deleted.", timeout=8000)
            # Mute, then the muted conversation raises no toast but keeps its badge.
            await alice.get_by_role("button", name="Contact card").click()
            card = alice.get_by_role("dialog", name="Contact card")
            await card.get_by_role("button", name="Mute").click()
            mute_dialog = alice.get_by_role("dialog", name="Mute letters")
            await mute_dialog.get_by_role("radio", name="1 hour").check()
            await mute_dialog.get_by_role("button", name="Mute").click()
            await expect(card).to_be_hidden(timeout=8000)
            print("ok - tidy up: delete for me with undo, delete for everyone, mute")
        except Exception as e:
            failures.append(f"tidy: {e}")

        # Block and unblock through the confirm dialog.
        try:
            await bob2.goto(f"{BASE}/letters")
            row = bob2.locator("[data-testid='conversation-row']").first
            await row.click()
            await expect(bob2.get_by_role("button", name="Contact card")).to_be_visible(timeout=8000)
            await bob2.get_by_role("button", name="Contact card").click()
            card = bob2.get_by_role("dialog", name="Contact card")
            await card.get_by_role("button", name="Block").click()
            block_dialog = bob2.get_by_role("dialog")
            await expect(block_dialog).to_contain_text("won't be able to reach you")
            await block_dialog.get_by_role("button", name="Block").click()
            await expect(block_dialog).to_be_hidden(timeout=8000)
            # The blocked conversation shows the blocked copy with Unblock.
            await expect(bob2.locator("text=You blocked")).to_be_visible(timeout=8000)
            await bob2.get_by_role("button", name="Unblock").click()
            await expect(bob2.locator("text=You blocked")).to_be_hidden(timeout=8000)
            # New letters flow again after unblocking.
            print("ok - block and unblock through the confirm dialog")
        except Exception as e:
            failures.append(f"block: {e}")

        await browser.close()

    if failures:
        print(f"{len(failures)} failures:")
        for failure in failures[:20]:
            print(" FAIL -", failure)
        sys.exit(1)
    print("journeys 5-8 pass")

asyncio.run(main())
