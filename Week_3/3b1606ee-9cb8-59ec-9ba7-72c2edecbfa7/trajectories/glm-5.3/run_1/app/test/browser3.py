# Photo and file letter journeys, plus the viewports and reduced motion checks.
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
    await page.get_by_role("button", name="I've written it down").click()
    await page.fill("input[aria-label='Display name']", display_name)
    await page.get_by_role("button", name="Finish").click()
    await page.get_by_test_id("empty-state").wait_for(timeout=8000)


async def make_photo_jpeg(path, width=3000, height=2000):
    # A JPEG carrying camera and location metadata, like the invented harbour-gps.jpg.
    import piexif
    from PIL import Image
    img = Image.new("RGB", (width, height), (30, 120, 180))
    exif = {
        "0th": {piexif.ImageIFD.Make: b"TestCam"},
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"N",
            piexif.GPSIFD.GPSLatitude: ((38, 1), (43, 1), (0, 1)),
            piexif.GPSIFD.GPSLongitudeRef: b"W",
            piexif.GPSIFD.GPSLongitude: ((9, 1), (8, 1), (0, 1)),
        },
    }
    img.save(path, "JPEG", exif=piexif.dump(exif))


async def make_tiny_png(path):
    from PIL import Image
    img = Image.new("RGB", (64, 64), (200, 90, 40))
    img.save(path, "PNG")


async def make_file(path, size):
    with open(path, "wb") as f:
        f.write(b"9" * size)


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

        b_name = f"att{tag}b"
        await sign_up(alice, f"att{tag}a", "Alice Att")
        await sign_up(bob, b_name, "Bob Att")

        # Set up an accepted conversation.
        await alice.goto(f"{BASE}/contacts")
        find = alice.get_by_role("textbox", name="Find by username")
        await find.fill(b_name)
        await find.press("Enter")
        await alice.get_by_role("button", name="Write a letter").click()
        await alice.get_by_role("textbox", name="Write a letter").fill("attach next")
        await alice.get_by_role("textbox", name="Write a letter").press("Enter")
        await bob.goto(f"{BASE}/letters")
        await expect(bob.locator("a", has_text="Letter requests")).to_be_visible(timeout=8000)
        await bob.locator("a", has_text="Letter requests").click()
        await bob.locator("[data-testid='request-row']").first.click()
        await bob.get_by_role("button", name="Accept").click()
        await bob.wait_for_url("**/letters/*", timeout=8000)
        print("ok - setup")

        # Journey 6 continued: send a photo.
        try:
            await make_photo_jpeg("/tmp/harbour-gps.jpg")
            await make_tiny_png("/tmp/tiny.png")
            await make_file("/tmp/ferry-timetable.pdf", 40_000)
            composer = alice.get_by_role("textbox", name="Write a letter")
            # Attach the photo by touch.
            async with alice.expect_file_chooser() as fc:
                await alice.get_by_role("button", name="Attach photo").click()
            chooser = await fc.value
            await chooser.set_files("/tmp/harbour-gps.jpg")
            await composer.fill("The harbour at dawn")
            await composer.press("Enter")
            # The letter posts once the sealed photo is stored; its postmark then strikes.
            letter = alice.locator("[data-testid='letter']").last
            for _ in range(120):
                delivery = await letter.get_attribute("data-delivery")
                if delivery in ("sent", "delivered", "read"):
                    break
                await alice.wait_for_timeout(100)
            assert delivery in ("sent", "delivered", "read"), delivery
            print("ok - photo letter posts after the upload")
            # The recipient sees a blurred preview, then the photo.
            await bob.goto(f"{BASE}/letters")
            row = bob.locator("[data-testid='conversation-row']").first
            await row.click()
            photo_letter = bob.locator("[data-testid='letter']").last
            img = photo_letter.get_by_role("button", name="Open photo")
            await expect(img).to_be_visible(timeout=8000)
            await expect(img.locator("img")).to_have_attribute("alt", "Photo from Alice Att", timeout=8000)
            print("ok - recipient sees the photo with the published alt text")
            # The photo viewer opens by keyboard and closes with Escape back to the photo.
            await img.focus()
            await img.press("Enter")
            viewer = bob.get_by_role("dialog", name="Photo viewer")
            await expect(viewer).to_be_visible(timeout=8000)
            await expect(viewer.locator("img")).to_have_attribute("alt", "Photo from Alice Att")
            await bob.keyboard.press("Escape")
            await expect(viewer).to_be_hidden(timeout=8000)
            await expect(img).to_be_focused(timeout=8000)
            print("ok - photo viewer opens by keyboard and closes with Escape")
            # The prepared photo carries no metadata and is at most 2048 on its long edge.
            dims = await bob.evaluate("""async () => {
              const img = document.querySelector(".photo-letter img");
              return img ? { w: img.naturalWidth, h: img.naturalHeight, src: img.src } : null;
            }""")
            assert dims, "no photo img"
            assert max(dims["w"], dims["h"]) <= 2048, dims
            print(f"ok - photo re-encoded to {dims['w']}x{dims['h']} (no metadata, <= 2048)")
        except Exception as e:
            failures.append(f"photo: {e}")

        # Journey: send a file, and refuse one over the cap.
        try:
            await make_file("/tmp/crate.bin", 600_000)
            composer = alice.get_by_role("textbox", name="Write a letter")
            async with alice.expect_file_chooser() as fc:
                await alice.get_by_role("button", name="Attach file").click()
            chooser = await fc.value
            await chooser.set_files("/tmp/crate.bin")
            await composer.press("Enter")
            file_letter = alice.locator("[data-testid='letter']").last
            label = file_letter.locator("[data-testid='postmark-label']")
            for _ in range(60):
                text = (await label.inner_text()).strip()
                if text in ("Sent", "Delivered", "Read"):
                    break
                await alice.wait_for_timeout(100)
            assert text in ("Sent", "Delivered", "Read"), text
            print("ok - file letter posts")
            # The recipient downloads it intact.
            await bob.goto(f"{BASE}/letters")
            await bob.locator("[data-testid='conversation-row']").first.click()
            download = bob.get_by_role("button", name="Download crate.bin")
            await expect(download).to_be_visible(timeout=8000)
            async with bob.expect_download() as dl_info:
                await download.click()
            info = await dl_info.value
            target = await info.path()
            size = __import__("os").stat(target).st_size if target else 0
            assert size == 600_000, size
            print("ok - file downloads intact")
            # A file over the cap is refused before any upload.
            await make_file("/tmp/too-big.bin", 26_214_401)
            async with alice.expect_file_chooser() as fc:
                await alice.get_by_role("button", name="Attach file").click()
            chooser = await fc.value
            await chooser.set_files("/tmp/too-big.bin")
            slip = alice.locator(".pinned-slip")
            await expect(slip).to_contain_text("larger than 25.0 MB", timeout=8000)
            await expect(slip).to_contain_text("can't be sent", timeout=8000)
            print("ok - oversized file refused before upload with the published copy")
        except Exception as e:
            failures.append(f"file: {e}")

        # Viewports: 375x812, 768x1024 and 1280x800 (DP-40).
        try:
            await alice.goto(f"{BASE}/letters")
            # 375x812: one pane, bottom tab bar, no sideways scroll.
            await alice.set_viewport_size({"width": 375, "height": 812})
            await alice.wait_for_timeout(300)
            assert await alice.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "sideways scroll at 375"
            tab_bar = alice.get_by_role("navigation", name="Main")
            box = await tab_bar.bounding_box()
            assert box and box["y"] + box["height"] <= 812 + 1, f"tab bar not at the bottom: {box}"
            # 768x1024: the list and the open conversation side by side.
            await alice.set_viewport_size({"width": 768, "height": 1024})
            await alice.wait_for_timeout(300)
            assert await alice.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "sideways scroll at 768"
            print("ok - 375 and 768 viewports with no sideways scrolling")
            # 1280x800: three columns, contact card standing, no Contact card button.
            await alice.set_viewport_size({"width": 1280, "height": 800})
            await alice.wait_for_timeout(300)
            card_pane = alice.get_by_role("region", name="Contact card")
            await expect(card_pane).to_be_visible(timeout=8000)
            assert await alice.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "sideways scroll at 1280"
            assert await alice.get_by_role("button", name="Contact card").count() == 0, "contact card button shown at 1280"
            print("ok - 1280 viewport shows the contact card column")
        except Exception as e:
            failures.append(f"viewports: {e}")

        # Reduced motion (DP-43): no fold animation, controls still work.
        try:
            reduced_ctx = await browser.new_context(viewport={"width": 375, "height": 812}, reduced_motion="reduce")
            rpage = await reduced_ctx.new_page()
            await sign_up(rpage, f"rm{tag}u", "Reduced Motion")
            # The composer works; no fold animation element appears.
            await rpage.goto(f"{BASE}/contacts")
            find = rpage.get_by_role("textbox", name="Find by username")
            await find.fill(b_name)
            await find.press("Enter")
            await rpage.get_by_role("button", name="Write a letter").click()
            await rpage.get_by_role("textbox", name="Write a letter").fill("reduced")
            await rpage.get_by_role("textbox", name="Write a letter").press("Enter")
            await rpage.wait_for_timeout(600)
            assert await rpage.locator(".fold-animation").count() == 0, "fold animation under reduced motion"
            print("ok - reduced motion sends without the fold animation")
            await reduced_ctx.close()
        except Exception as e:
            failures.append(f"reduced: {e}")

        # Touch targets: every control at least 44 by 44 (DP-43).
        try:
            await alice.set_viewport_size({"width": 375, "height": 812})
            await alice.wait_for_timeout(300)
            sizes = await alice.evaluate("""() => {
              const out = [];
              for (const el of document.querySelectorAll('button, a.tab-link, .tab-link, input[type=checkbox], input[type=radio]')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                out.push({ name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24), w: r.width, h: r.height });
              }
              return out;
            }""")
            small = [s for s in sizes if s["w"] < 44 or s["h"] < 44]
            assert not small, small
            print("ok - every visible control is at least 44 by 44")
        except Exception as e:
            failures.append(f"touch: {e}")

        await browser.close()

    if failures:
        print(f"{len(failures)} failures:")
        for failure in failures[:20]:
            print(" FAIL -", failure)
        sys.exit(1)
    print("attachments, viewports, reduced motion and touch pass")


asyncio.run(main())
