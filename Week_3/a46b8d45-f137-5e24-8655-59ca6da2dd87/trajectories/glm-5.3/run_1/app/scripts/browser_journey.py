"""A full browser journey: claim a part through to dispatch, with dialogs."""
import asyncio, json, re, sys
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # --- The owner claims a part ---
        await page.goto(BASE + '/claim/new')
        await page.fill('#claim-name', 'Wanda Browser')
        await page.fill('#claim-email', 'wanda.browser@example.org')
        await page.fill('#claim-postcode', 'ze1 0aa')
        await page.select_option('#claim-model', 'aldra-wardrobe')
        await page.wait_for_selector('.fan-part')
        # Scrub the fan and tap the shelf (booklet 3).
        slider = page.get_by_role('slider', name='Separate parts')
        await slider.fill('100')
        await page.wait_for_timeout(320)
        await page.get_by_role('button', name='Part 3: Shelf').focus()
        await page.keyboard.press('Enter')
        await page.fill('#claim-quantity', '2')
        await page.fill('#claim-purchase', '2025-01-15')
        await page.fill('#claim-description', 'The shelf cracked.')
        # A damage photo.
        png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
        await page.set_input_files('#claim-photos', files=[{'name': 'shelf.png', 'mimeType': 'image/png', 'buffer': png}])
        # Carriage estimate while claiming.
        await page.get_by_role('button', name='Estimate carriage').click()
        await page.wait_for_timeout(4000)
        estimate = await page.locator('.estimate-content').inner_text()
        assert 'S3' in estimate and '£6.95' in estimate, estimate
        print('estimate shown:', estimate)
        # Start claim: the address bar moves to the sent page.
        async with page.expect_navigation():
            await page.get_by_role('button', name='Start claim').click()
        await page.wait_for_url(re.compile(r'/claim/HG-[A-Z2-9]{6}/sent'))
        reference = page.url.split('/claim/')[1].split('/sent')[0]
        print('claim started:', reference)
        sent_line = await page.locator('.sent-line').inner_text()
        assert reference in sent_line, sent_line
        lifetime = await page.locator('.link-lifetime').inner_text()
        assert 'This link works until' in lifetime and '(UK time)' in lifetime, lifetime
        print('sent page shows the link-lifetime line:', lifetime)

        # --- The confirmation email ---
        import urllib.request, time
        time.sleep(1)
        mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=10'))
        msg = [m for m in mp['messages'] if reference in m['Subject']][0]
        detail = json.load(urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{msg['ID']}"))
        token = [l for l in detail['Text'].splitlines() if '/confirm/' in l][0].strip().split('/confirm/')[-1]

        # --- Confirm on a new page (any device) ---
        page2 = await browser.new_page(viewport={'width': 375, 'height': 812})
        await page2.goto(f'{BASE}/confirm/{token}')
        # The confirmation page is one centred column.
        button = page2.get_by_role('button', name='Confirm my claim')
        box = await button.bounding_box()
        main_box = await page2.locator('main').bounding_box()
        assert box is not None and main_box is not None
        assert box['width'] >= main_box['width'] - 2, 'button should be the column width at 375'
        assert box['height'] >= 44, box['height']
        await button.click()
        await page2.wait_for_url(re.compile(r'/s/.+'))
        share_url = page2.url
        share_token = share_url.split('/s/')[1]
        print('confirmed; share page at', share_url[:50] + '...')
        state = await page2.locator('.slip-state').inner_text()
        assert state == 'Confirmed', state
        # A cold reload shows the same screen in the same state.
        await page2.reload()
        await page2.wait_for_selector('.slip-state')
        state = await page2.locator('.slip-state').inner_text()
        assert state == 'Confirmed', state
        print('share page cold reload OK')
        # The Claim history disclosure starts collapsed and expands in place.
        history_button = page2.get_by_role('button', name='Claim history')
        expanded = await history_button.get_attribute('aria-expanded')
        assert expanded == 'false', expanded
        await history_button.click()
        await page2.wait_for_timeout(200)
        history_button = page2.get_by_role('button', name='Claim history')
        expanded = await history_button.get_attribute('aria-expanded')
        assert expanded == 'true', expanded
        entries = await page2.locator('.history-entry').count()
        assert entries == 2, entries
        first = await page2.locator('.history-entry').first.inner_text()
        assert first.startswith('Started,'), first
        print('claim history OK:', first)

        # --- The operator identifies and rules ---
        op = await browser.new_page(viewport={'width': 1280, 'height': 800})
        await op.goto(BASE + '/ops/sign-in')
        await op.fill('#ops-email', 'operator@holmgarth.example')
        await op.fill('#ops-password', 'fan-out-2026-desk')
        await op.get_by_role('button', name='Sign in').click()
        await op.wait_for_url('**/ops/claims')
        await op.goto(f'{BASE}/ops/claims/{reference}')
        await op.wait_for_selector('.fan-part')
        # Scrub the fan, select part 3 with the pointer, set quantity, identify.
        op_slider = op.get_by_role('slider', name='Separate parts')
        await op_slider.fill('100')
        await op.wait_for_timeout(320)
        await op.get_by_role('button', name='Part 3: Shelf').focus()
        await op.keyboard.press('Enter')
        await op.fill('#ops-quantity', '2')
        await op.get_by_role('button', name='Identify part').click()
        await op.wait_for_url(f'**/ops/claims/{reference}/quote')
        ruling = await op.locator('.slip-ruling').inner_text()
        assert ruling in ('Inside aftercare', 'Outside aftercare'), ruling
        edition = await op.locator('.slip-edition').inner_text()
        assert edition.startswith('Ruled by edition '), edition
        status_text = await op.locator('.status-region').inner_text()
        assert status_text == f'Part identified. {edition}.', status_text
        print('identify OK:', ruling, '|', edition, '| status:', status_text)

        # --- Quote ---
        quote_button = op.get_by_role('button', name='Get quote')
        await quote_button.click()
        await op.wait_for_url(re.compile(rf'/ops/claims/{reference}/quote/\d+'))
        revision = op.url.split('/')[-1]
        print('quote revision page:', revision)
        total = await op.locator('.slip-total').inner_text()
        print('slip total:', total)
        # The button is now Re-quote.
        assert await op.get_by_role('button', name='Re-quote').count() == 1
        print('Re-quote label OK')

        # --- Record payment and dispatch ---
        await op.get_by_role('button', name='Record payment').click()
        await op.wait_for_timeout(600)
        paid = await op.locator('.slip-paid').inner_text()
        print('paid line:', paid)
        await op.get_by_role('button', name='Dispatch').click()
        await op.wait_for_url(f'**/ops/claims/{reference}/dispatched')
        dispatched_status = await op.locator('.status-region').inner_text()
        assert dispatched_status == 'Dispatched. Dispatch note stored.', dispatched_status
        note_link = op.get_by_role('link', name='Dispatch note')
        assert await note_link.count() == 1
        print('dispatch OK with dispatch note link')

        # --- The share page updates in place ---
        await page2.wait_for_timeout(31000)
        await page2.wait_for_selector('.slip-paid')
        state = await page2.locator('.slip-state').inner_text()
        assert state == 'Dispatched', state
        paid = await page2.locator('.slip-paid').inner_text()
        print('share page updated in place:', state, '|', paid)

        # --- Decline dialog on a quoted claim (keyboard path) ---
        # Start a fresh claim for the decline dialog check.
        await page.goto(BASE + '/claim/new')
        await page.fill('#claim-name', 'Decline Dialog')
        await page.fill('#claim-email', 'decline.dialog@example.org')
        await page.fill('#claim-postcode', 'n1 9gu')
        await page.select_option('#claim-model', 'kestle-shelving-unit')
        await page.wait_for_selector('.fan-part')
        await page.get_by_role('slider', name='Separate parts').fill('100')
        await page.wait_for_timeout(320)
        await page.get_by_role('button', name='Part 3: Shelf pin').focus()
        await page.keyboard.press('Enter')
        await page.fill('#claim-quantity', '1')
        await page.fill('#claim-purchase', '2026-01-01')
        await page.set_input_files('#claim-photos', files=[{'name': 'p.png', 'mimeType': 'image/png', 'buffer': png}])
        async with page.expect_navigation():
            await page.get_by_role('button', name='Start claim').click()
        await page.wait_for_url(re.compile(r'/claim/HG-[A-Z2-9]{6}/sent'))
        ref2 = page.url.split('/claim/')[1].split('/sent')[0]
        time.sleep(1)
        mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=10'))
        msg = [m for m in mp['messages'] if ref2 in m['Subject']][0]
        detail = json.load(urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{msg['ID']}"))
        token2 = [l for l in detail['Text'].splitlines() if '/confirm/' in l][0].strip().split('/confirm/')[-1]
        await page.goto(f'{BASE}/confirm/{token2}')
        await page.get_by_role('button', name='Confirm my claim').click()
        await page.wait_for_url(re.compile(r'/s/.+'))
        # The operator quotes then opens the Decline dialog by keyboard.
        await op.goto(f'{BASE}/ops/claims/{ref2}')
        await op.wait_for_selector('.fan-part')
        await op.get_by_role('button', name='Part 3: Shelf pin').focus()
        await op.keyboard.press('Enter')
        await op.fill('#ops-quantity', '1')
        await op.get_by_role('button', name='Identify part').click()
        await op.wait_for_url(f'**/ops/claims/{ref2}/quote')
        await op.get_by_role('button', name='Get quote').click()
        await op.wait_for_url(re.compile(rf'/ops/claims/{ref2}/quote/\d+'))
        # Open the Decline dialog by keyboard: Tab to Decline and press Enter.
        decline = op.get_by_role('button', name='Decline')
        await decline.focus()
        # The dialog opens with focus on its first control.
        await op.keyboard.press('Enter')
        await op.wait_for_selector('dialog[open]')
        dialog = op.locator('dialog')
        first_radio = dialog.locator('input[type="radio"]').first
        first_handle = await first_radio.element_handle()
        focused = await op.evaluate('(el) => document.activeElement === el', first_handle)
        assert focused, 'focus should be on the first radio'
        print('decline dialog opened by keyboard, focus on first radio')
        # Tab from Cancel wraps to the first control.
        cancel = op.get_by_role('button', name='Cancel')
        first_handle = await first_radio.element_handle()
        # Tab from the dialog's last control wraps to its first control.
        await cancel.focus()
        await op.keyboard.press('Tab')
        focused = await op.evaluate('(el) => document.activeElement === el', first_handle)
        assert focused, 'Tab from Cancel should wrap to the first radio'
        # Shift+Tab from the first control wraps back to Cancel.
        cancel_handle = await cancel.element_handle()
        await op.keyboard.press('Shift+Tab')
        focused = await op.evaluate('(el) => document.activeElement === el', cancel_handle)
        assert focused, 'Shift+Tab from the first control should wrap to Cancel'
        print('dialog focus wrap OK both ways')
        # Escape closes without acting, and focus returns to the opener.
        await op.keyboard.press('Escape')
        await op.wait_for_timeout(250)
        assert await op.locator('dialog[open]').count() == 0
        decline_handle = await decline.element_handle()
        focused = await op.evaluate('(el) => document.activeElement === el', decline_handle)
        assert focused, 'focus should return to Decline after Escape'
        print('Escape closes the dialog, focus returns to the opener')
        # Reopen and confirm a decline.
        await decline.click()
        await op.wait_for_selector('dialog[open]')
        await op.get_by_role('radio', name='Owner declined the quote').check()
        await op.get_by_role('button', name='Confirm decline').click()
        await op.wait_for_url(f'**/ops/claims/{ref2}/declined')
        await op.wait_for_timeout(400)
        status_text = await op.locator('.status-region').inner_text()
        assert status_text == 'Claim declined.', status_text
        decline_line = await op.locator('.slip-decline').inner_text()
        assert decline_line == 'Nothing charged', decline_line
        print('decline confirmed, address moved to the declined stage')

        # --- Close the claim ---
        await op.get_by_role('button', name='Close claim').click()
        await op.wait_for_url(f'**/ops/claims/{ref2}')
        status_text = await op.locator('.status-region').inner_text()
        assert status_text == 'Claim closed.', status_text
        print('close OK')

        if errors:
            print('PAGE ERRORS:', errors)
            raise AssertionError('browser errors')
        await browser.close()
        print('\nFULL BROWSER JOURNEY PASSED')

asyncio.run(main())
