"""Browser test for the public packet page."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:4173"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errors = []
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(BASE + "/signin")
        await page.get_by_role("textbox", name="Email").fill("ines@halsted-kitchen.test")
        await page.get_by_label("Password").fill("prep-shift-2026")
        await page.get_by_role("button", name="Sign in").click()
        await page.wait_for_load_state("networkidle")

        token = await page.evaluate("""async () => {
          const res = await fetch('/api/packets', {credentials: 'same-origin'});
          const data = await res.json();
          const active = data.packets.find(p => p.status === 'active');
          return active ? active.token : null;
        }""")
        print("token:", token)
        if not token:
            # create one directly
            token = await page.evaluate("""async () => {
              const res = await fetch('/api/packets', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({from: '2027-02-01', to: '2027-02-28', expires_at: '2027-03-01T12:00:00-06:00'})
              });
              const data = await res.json();
              return data.packet ? data.packet.token : null;
            }""")
            print("created token:", token)
        assert token, "a packet token"

        ctx2 = await browser.new_context(viewport={"width": 1280, "height": 800})
        page2 = await ctx2.new_page()
        page2.on("pageerror", lambda e: errors.append(str(e)))
        await page2.goto(BASE + f"/packet/{token}")
        await page2.wait_for_load_state("networkidle")
        await page2.wait_for_timeout(500)
        body = await page2.inner_text("body")
        print("public packet page:", body[:300])
        assert "Compliance packet" in body, "packet heading"
        assert "Rosa's Tamal Cart" in body, "visit business"
        assert "Tomás Reyes" in body, "crew cook"
        assert "Valid" in body, "validity words"
        assert await page2.get_by_role("link", name="Download PDF").count() == 1, "pdf link"
        assert await page2.get_by_role("navigation", name="Main").count() == 0, "no navigation"
        print("public packet page OK")

        resp = await page2.goto(BASE + "/packet/definitelynotavalidtoken000000000000000000000000")
        print("invalid status:", resp.status if resp else None)
        assert resp and resp.status == 404, "invalid link 404"
        await page2.wait_for_timeout(1500)
        body2 = await page2.inner_text("body")
        assert "This packet link is not valid." in body2, "invalid copy"
        print("invalid link copy OK")

        real_errors = [e for e in errors if "401" not in e]
        assert not real_errors, real_errors
        await browser.close()
        print("PACKET PAGE CHECKS PASSED")


asyncio.run(main())
