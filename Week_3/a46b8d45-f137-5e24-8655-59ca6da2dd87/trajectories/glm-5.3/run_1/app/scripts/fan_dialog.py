"""Fan start positions and DP-68 dialog reopen behaviour."""
import asyncio, json, re, urllib.request
from playwright.async_api import async_playwright
import sys
sys.path.insert(0, 'scripts')
from journey import req, sign_in, start_claim, get_confirm_token

async def main():
    # Prepare a confirmed claim for the share page.
    claim = start_claim(email='fan.start@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    share_token = json.loads(b)['share_url'].split('/s/')[1]

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()

        # --- The share page fan starts at 100 with the part selected ---
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        await page.goto(f'http://127.0.0.1:4173/s/{share_token}')
        await page.wait_for_selector('.fan')
        fan = page.locator('.fan')
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '192', f'share fan should start fully separated, got {sep}'
        active = await fan.get_attribute('data-active-part')
        assert active == '3', f'claimed part selected, got {active}'
        # The owner cannot change the selection.
        await page.get_by_role('button', name='Part 3: Shelf pin').focus()
        await page.keyboard.press('Enter')
        active = await fan.get_attribute('data-active-part')
        assert active == '3', 'selection must not change on the share page'
        # The slider still works.
        await page.get_by_role('slider', name='Separate parts').fill('50')
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '96', sep
        # The bracket shortcut does nothing on the share page.
        await page.keyboard.press(']')
        active = await fan.get_attribute('data-active-part')
        assert active == '3', 'the shortcut must not act on the share page'
        print('share fan OK: starts at 100, selection locked, slider works, shortcut inert')

        # --- The workspace fan starts at 100 when a part is selected ---
        auth = sign_in()
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 200, f'identify: {s}'
        op = await browser.new_page(viewport={'width': 1280, 'height': 800})
        # Sign in inside the browser.
        await op.goto('http://127.0.0.1:4173/ops/sign-in')
        await op.fill('#ops-email', 'operator@holmgarth.example')
        await op.fill('#ops-password', 'fan-out-2026-desk')
        await op.get_by_role('button', name='Sign in').click()
        await op.wait_for_url('**/ops/claims')
        await op.goto(f'http://127.0.0.1:4173/ops/claims/{reference}')
        await op.wait_for_selector('.fan')
        op_fan = op.locator('.fan')
        sep = await op_fan.get_attribute('data-fan-separation')
        assert sep == '192', f'workspace fan with a selected part starts at 100, got {sep}'
        print('workspace fan starts at 100 when a part is already selected')

        # --- DP-68: reopening a dialog during its fade-out ---
        # Quote the claim so Decline is available, then test the reopen.
        await op.get_by_role('button', name='Get quote').click()
        await op.wait_for_url(re.compile(r'/quote/\d+'))
        decline = op.get_by_role('button', name='Decline')
        await decline.focus()
        await op.keyboard.press('Enter')
        await op.wait_for_selector('dialog[open]')
        # Close it, then immediately reopen while it would be fading.
        await op.keyboard.press('Escape')
        await decline.click()
        await op.wait_for_selector('dialog[open]')
        # The dialog stays open with focus on its first control.
        dialog = op.locator('dialog[open]')
        assert await dialog.count() == 1
        first_radio = dialog.locator('input[type="radio"]').first
        first_handle = await first_radio.element_handle()
        focused = await op.evaluate('(el) => document.activeElement === el', first_handle)
        assert focused, 'reopening during the fade must focus the first control'
        print('DP-68: reopening during the fade-out keeps the dialog open and focused')

        # Close it and make sure no leftover timer closes it later.
        await op.keyboard.press('Escape')
        await op.wait_for_timeout(300)
        assert await op.locator('dialog[open]').count() == 0
        print('the dialog closes cleanly; no leftover timer')

        await browser.close()
    print('\nFAN STARTS AND DIALOG REOPEN PASSED')

asyncio.run(main())
