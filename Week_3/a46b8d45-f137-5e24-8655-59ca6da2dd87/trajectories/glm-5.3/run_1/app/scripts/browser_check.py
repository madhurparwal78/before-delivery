"""Browser checks: the fitting fan, the pages and the keyboard path."""
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # --- Home page ---
        await page.goto(BASE + '/')
        heading = page.locator('h1.brand')
        assert await heading.count() == 1, 'no brand heading'
        assert await heading.inner_text() == 'Holmgarth Aftercare'
        start = page.get_by_role('link', name='Start a claim')
        find = page.get_by_role('link', name='Find my claim')
        assert await start.count() == 1 and await find.count() == 1
        print('home OK')

        # --- Claim form: the fan draws and the slider works ---
        await page.goto(BASE + '/claim/new')
        await page.wait_for_selector('select')
        model = page.locator('select')
        await model.select_option('kestle-shelving-unit')
        await page.wait_for_selector('.fan')
        fan = page.locator('.fan')
        # The fan root carries the published attributes.
        axis = await fan.get_attribute('data-fan-axis')
        assert axis == 'iso', axis
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '0', sep
        scale = await fan.get_attribute('data-fan-scale')
        assert scale == '1.000', scale
        active = await fan.get_attribute('data-active-part')
        assert active == 'none', active
        slider = page.get_by_role('slider', name='Separate parts')
        assert await slider.count() == 1
        # Move to 25: separation = round(0.25 × 48 × 4) = 48; scale = 0.938.
        await slider.fill('25')
        await page.wait_for_timeout(80)
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '48', f'separation at 25: {sep}'
        scale = await fan.get_attribute('data-fan-scale')
        assert scale == '0.938', f'scale at 25: {scale}'
        # Move to 100: separation = 48 × 4 = 192; scale = 0.750.
        await slider.fill('100')
        await page.wait_for_timeout(350)
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '192', sep
        scale = await fan.get_attribute('data-fan-scale')
        assert scale == '0.750', scale
        # On-screen geometry: the vector between part 0 and part k, divided by
        # the scale, matches data-part-offset within 1 px along the axis.
        parts = page.locator('.fan-part')
        count = await parts.count()
        assert count == 5, count
        boxes = []
        for i in range(count):
            boxes.append(await parts.nth(i).bounding_box())
        p0 = boxes[0]
        pk = boxes[4]
        dx = (pk['x'] + pk['width'] / 2) - (p0['x'] + p0['width'] / 2)
        dy = (pk['y'] + pk['height'] / 2) - (p0['y'] + p0['height'] / 2)
        offset4 = await parts.nth(4).get_attribute('data-part-offset')
        assert offset4 == '192', offset4
        import math
        expected_x = 192 * math.cos(math.pi / 6)
        expected_y = -192 * math.sin(math.pi / 6)
        assert abs(dx - expected_x) <= 1, f'dx {dx} vs {expected_x}'
        assert abs(dy - expected_y) <= 1, f'dy {dy} vs {expected_y}'
        print('fan geometry OK: iso offsets and on-screen positions match')

        # Select a part by Enter on the focused button.
        await page.get_by_role('button', name='Part 2: Shelf board').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(50)
        active = await fan.get_attribute('data-active-part')
        assert active == '2', active
        # The part line shows under the form.
        part_line = page.locator('.part-line')
        text = await part_line.inner_text()
        assert 'Shelf board' in text and '607701' in text, text
        print('part selection by keyboard OK, part line shows')

        # Bracket shortcut: ] selects the next active part.
        await page.keyboard.press(']')
        await page.wait_for_timeout(50)
        active = await fan.get_attribute('data-active-part')
        assert active == '3', f'] from 2 should be 3, got {active}'
        await page.keyboard.press('[')
        await page.wait_for_timeout(50)
        active = await fan.get_attribute('data-active-part')
        assert active == '2', f'[ from 3 should be 2, got {active}'
        # The withdrawn part 5 is skipped from part 4.
        await page.get_by_role('button', name='Part 4: Wall bracket').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(30)
        active = await fan.get_attribute('data-active-part')
        assert active == '4', active
        await page.keyboard.press(']')
        await page.wait_for_timeout(30)
        active = await fan.get_attribute('data-active-part')
        assert active == '4', f'] at the last active part does nothing, got {active}'
        # At either end the key does nothing; it never wraps.
        await page.get_by_role('button', name='Part 1: Upright').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(30)
        active = await fan.get_attribute('data-active-part')
        assert active == '1', active
        await page.keyboard.press('[')
        await page.wait_for_timeout(30)
        active = await fan.get_attribute('data-active-part')
        assert active == '1', f'[ at the first part does nothing, got {active}'
        print('bracket shortcut OK, withdrawn parts skipped, no wrapping')

        # Fenwick has no axis: the fallback list shows, no slider.
        await model.select_option('fenwick-bed-frame')
        await page.wait_for_selector('.fan-fallback-list')
        slider_count = await page.get_by_role('slider').count()
        assert slider_count == 0, f'fallback should have no slider, got {slider_count}'
        list_role = page.locator('.fan-fallback-list')
        assert await list_role.count() == 1
        buttons = list_role.locator('.fan-part')
        assert await buttons.count() == 4
        print('fallback list OK: no slider in the tree')

        # --- Operator sign-in and queue ---
        op = await browser.new_page(viewport={'width': 1280, 'height': 800})
        await op.goto(BASE + '/ops/claims')
        # Without a session it goes to /ops/sign-in.
        await op.wait_for_url('**/ops/sign-in')
        await op.fill('#ops-email', 'operator@holmgarth.example')
        await op.fill('#ops-password', 'fan-out-2026-desk')
        await op.get_by_role('button', name='Sign in').click()
        await op.wait_for_url('**/ops/claims')
        decided = op.locator('.decided-status')
        text = await decided.inner_text()
        assert text.startswith('Decided claims: '), text
        print('operator sign-in OK, decided count:', text)

        # Open a confirmed claim workspace and check the three panes at 1280.
        link = op.locator('.claims-table a').first
        ref = await link.inner_text()
        await link.click()
        await op.wait_for_url(f'**/ops/claims/{ref}')
        await op.wait_for_selector('.workspace-queue')
        # The queue pane takes 15-22% at 1280.
        queue_box = await op.locator('.workspace-queue').bounding_box()
        fan_box = await op.locator('.workspace-fan').bounding_box()
        slip_box = await op.locator('.workspace-slip').bounding_box()
        total = queue_box['width'] + fan_box['width'] + slip_box['width']
        queue_pct = queue_box['width'] / total * 100
        fan_pct = fan_box['width'] / total * 100
        assert 15 <= queue_pct <= 22, queue_pct
        assert 45 <= fan_pct <= 55, fan_pct
        print(f'workspace 1280 layout OK: queue {queue_pct:.1f}%, fan {fan_pct:.1f}%')

        # Gutter at least 40px between panes.
        gutter1 = fan_box['x'] - (queue_box['x'] + queue_box['width'])
        gutter2 = slip_box['x'] - (fan_box['x'] + fan_box['width'])
        assert gutter1 >= 40 and gutter2 >= 40, (gutter1, gutter2)
        print(f'gutters OK: {gutter1:.0f}px, {gutter2:.0f}px')

        # No sideways scrolling.
        scroll_w = await op.evaluate('document.documentElement.scrollWidth')
        assert scroll_w <= 1280, scroll_w
        print('no sideways scroll at 1280')

        # 768: queue pane not rendered, All claims link present.
        await op.set_viewport_size({'width': 768, 'height': 1024})
        await op.wait_for_timeout(100)
        assert await op.locator('.workspace-queue').count() == 0
        assert await op.get_by_role('link', name='All claims').count() >= 1
        scroll_w = await op.evaluate('document.documentElement.scrollWidth')
        assert scroll_w <= 768, scroll_w
        print('768 layout OK: queue hidden, All claims link, no sideways scroll')

        # 375: one column, no sideways scrolling.
        await op.set_viewport_size({'width': 375, 'height': 812})
        await op.wait_for_timeout(100)
        scroll_w = await op.evaluate('document.documentElement.scrollWidth')
        assert scroll_w <= 375, scroll_w
        print('375 layout OK: no sideways scroll')

        # --- Polish switch on an owner page ---
        await page.goto(BASE + '/find')
        heading_en = await page.locator('h2').inner_text()
        assert heading_en == 'Find my claim', heading_en
        scroll_before = await page.evaluate('window.scrollY')
        await page.get_by_role('radio', name='Polski').check()
        await page.wait_for_timeout(100)
        heading_pl = await page.locator('h2').inner_text()
        assert heading_pl == 'Znajdź moje zgłoszenie', heading_pl
        assert await page.evaluate('document.documentElement.lang') == 'pl-PL'
        scroll_after = await page.evaluate('window.scrollY')
        assert abs(scroll_after - scroll_before) <= 1, (scroll_before, scroll_after)
        # Switch back
        await page.get_by_role('radio', name='English').check()
        await page.wait_for_timeout(100)
        assert await page.locator('h2').inner_text() == 'Find my claim'
        print('language switch OK: headings swap in place, scroll kept')

        if errors:
            print('PAGE ERRORS:', errors)
            raise AssertionError('browser errors')
        await browser.close()
        print('\nBROWSER CHECKS PASSED')

asyncio.run(main())
