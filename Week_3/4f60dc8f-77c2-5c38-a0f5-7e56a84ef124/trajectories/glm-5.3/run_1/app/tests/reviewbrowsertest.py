"""Reduced motion + review journey browser checks (with deposit paid)."""
import asyncio
import re
import time
import json as jsonlib
import urllib.request
import base64
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'
failures = []

def check(name, ok, detail=''):
    print(('ok   ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
    if not ok:
        failures.append(name)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # ---- reduced motion ----
        rm = await browser.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
        page = await rm.new_page()
        await page.goto(BASE + '/', wait_until='networkidle')
        await page.wait_for_timeout(1200)
        hero = await page.get_attribute('[aria-label="Hero"]', 'data-scrub-progress')
        check('reduced motion: hero fixed at 1.000', hero == '1.000', str(hero))
        idle = await page.get_attribute('.shot-table tbody tr:first-child .shot-object', 'data-idle')
        check('reduced motion: services still', idle == 'still', str(idle))
        process_step = await page.get_attribute('section#process', 'data-process-step')
        check('reduced motion: process step all', process_step == 'all', str(process_step))
        await page.locator('.shot-table tbody tr').first.hover()
        await page.wait_for_timeout(600)
        tilt_after = await page.get_attribute('.shot-table tbody tr:first-child .shot-object', 'data-tilt')
        check('reduced motion: hover does not tilt', tilt_after == '0', str(tilt_after))
        await rm.close()

        # ---- review journey with a paid deposit ----
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(BASE + '/start', wait_until='networkidle')
        stamp = int(time.time())
        email = f'rev{stamp}@r.test'
        await page.fill('#brand_name', 'Review Brand')
        await page.fill('#contact_name', 'R Eviewer')
        await page.fill('#email', email)
        await page.fill('#finance_email', f'fin{stamp}@r.test')
        await page.fill('#reviewer_email', f'view{stamp}@r.test')
        await page.fill('#title', 'Review journey')
        await page.check('#currency-GBP')
        await page.click('button[type="submit"]')
        await page.wait_for_url(re.compile(r'/rig/.+'), timeout=20000)
        engagement_id = page.url.split('/rig/')[1]

        # Upload the model GLB through the rig page.
        glb = open('/tmp/product.glb', 'rb').read()
        async with page.expect_file_chooser() as fc_info:
            await page.click('#upload-button')
        file_chooser = await fc_info.value
        await file_chooser.set_files({'name': 'model.glb', 'mimeType': 'model/gltf-binary', 'buffer': glb})
        await page.wait_for_timeout(1000)
        # select a shot and wait for measurement
        await page.check('#shot-hero_front')
        for _ in range(15):
            await page.wait_for_timeout(1500)
            note = await page.text_content('#intake-files li .intake-note')
            if note and note.startswith('Measured'):
                break
        note = await page.text_content('#intake-files li .intake-note')
        check('model measured on rig page', note is not None and note.startswith('Measured'), str(note))

        # Pay the deposit by keyboard: tab to Pay deposit and fill the dialog.
        await page.click('text=Pay deposit')
        await page.wait_for_timeout(500)
        await page.fill('#deposit-number', '4242 4242 4242 4242')
        await page.fill('#deposit-expiry', '12/28')
        await page.fill('#deposit-cvc', '123')
        await page.fill('#deposit-name', 'R Eviewer')
        await page.click('dialog button:has-text("Pay")')
        await page.wait_for_timeout(2500)
        confirmation = await page.text_content('#deposit-confirmation h2')
        check('deposit confirmation heading', confirmation == 'Deposit received', str(confirmation))

        # Studio: post a still and send for review.
        studio = await context.new_page()
        await studio.goto(BASE + '/studio', wait_until='networkidle')
        await studio.fill('#studio-password', 'rig-founder-2026')
        await studio.click('button[type="submit"]')
        await studio.wait_for_timeout(1500)
        await studio.goto(f'{BASE}/studio/engagements/{engagement_id}', wait_until='networkidle')
        await studio.wait_for_timeout(1500)
        inputs = await studio.query_selector_all('input[type="file"]')
        check('studio still upload controls present', len(inputs) >= 1, str(len(inputs)))
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
        await inputs[0].set_input_files({'name': 'still.png', 'mimeType': 'image/png', 'buffer': png})
        await studio.wait_for_timeout(3000)
        send = await studio.query_selector('button:has-text("Send for review")')
        if send:
            await send.click()
            await studio.wait_for_timeout(6000)

        # The reviewer's emailed link opens the review page: take the newest
        # email created after Send for review ran.
        import datetime
        sent_at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M')
        review_url = None
        for _ in range(20):
            data = jsonlib.loads(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=50').read())
            candidates = [m for m in data['messages'] if 'Look-dev stills ready' in m['Subject'] and m['Created'] >= sent_at]
            candidates.sort(key=lambda m: m['Created'], reverse=True)
            if candidates:
                body = jsonlib.loads(urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{candidates[0]['ID']}").read())
                match = re.search(r'http://[^\s]+/review/[^\s]+', body['Text'])
                if match:
                    review_url = match.group(0)
                    break
            time.sleep(1.5)
        check('review link emailed', review_url is not None, str(review_url))
        if review_url:
            reviewer = await context.new_page()
            await reviewer.goto(review_url, wait_until='networkidle')
            heading = await reviewer.text_content('h1')
            check('review page heading carries reference', 'GW-' in (heading or ''), str(heading))
            stills = await reviewer.eval_on_selector_all('.review-stills img', 'els => els.length')
            check('review stills listed', stills >= 1, str(stills))
            rounds = await reviewer.text_content('main')
            check('round counter shown', 'Revision rounds used: 0 of 2' in (rounds or ''), '')
            accept = await reviewer.query_selector('button:has-text("Accept look-dev")')
            check('accept button present', accept is not None)
            if accept:
                await accept.click()
                await reviewer.wait_for_timeout(2500)
                accepted = await reviewer.text_content('h2')
                check('acceptance heading', accepted == 'Milestone accepted', str(accepted))
        check('no page errors (review journey)', len(errors) == 0, '; '.join(errors[:2]))
        await browser.close()
    print('ALL REDUCED-MOTION/REVIEW CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}')
    return 0 if not failures else 1

asyncio.run(main())
