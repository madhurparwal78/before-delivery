"""Polish copy, money formats, field errors, and the newest estimate winning."""
import asyncio, json, re, urllib.request
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 375, 'height': 812})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # --- Polish money format on the claim form's estimate ---
        await page.goto(BASE + '/claim/new')
        await page.get_by_role('radio', name='Polski').check()
        await page.wait_for_timeout(100)
        # The claim form heading is Polish.
        assert await page.locator('h2').inner_text() == 'Zgłoś część'
        # Fill the form in Polish: the estimate shows "Strefa S2 · 3,95 £".
        await page.fill('#claim-name', 'Pani Wanda')
        await page.fill('#claim-email', 'polish.format@example.org')
        await page.fill('#claim-postcode', 'n1 9gu')
        await page.select_option('#claim-model', 'kestle-shelving-unit')
        await page.wait_for_selector('.fan-part')
        await page.get_by_role('button', name='Część 3: Shelf pin').focus()
        await page.keyboard.press('Enter')
        await page.fill('#claim-quantity', '1')
        await page.fill('#claim-purchase', '2026-01-01')
        png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
        await page.set_input_files('#claim-photos', files=[{'name': 'p.png', 'mimeType': 'image/png', 'buffer': png}])
        await page.get_by_role('button', name='Oszacuj przesyłkę').click()
        await page.wait_for_timeout(1500)
        estimate = await page.locator('.estimate-content').inner_text()
        assert estimate == 'Strefa S2 · 3,95\u00a0£', repr(estimate)
        print('Polish estimate format OK:', estimate)

        # Start the claim in Polish: the email arrives in Polish.
        async with page.expect_navigation():
            await page.get_by_role('button', name='Wyślij zgłoszenie').click()
        await page.wait_for_url(re.compile(r'/claim/HG-[A-Z2-9]{6}/sent'))
        reference = page.url.split('/claim/')[1].split('/sent')[0]
        heading = await page.locator('h2').inner_text()
        assert heading == 'Sprawdź pocztę', heading
        lifetime = await page.locator('.link-lifetime').inner_text()
        assert lifetime.startswith('Link działa do ') and '(czas brytyjski).' in lifetime, lifetime
        print('Polish sent page OK:', lifetime)

        import time
        time.sleep(1)
        mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=10'))
        msg = [m for m in mp['messages'] if reference in m['Subject']][0]
        assert msg['Subject'] == f'Potwierdź zgłoszenie Holmgarth {reference}', msg['Subject']
        print('Polish confirmation email subject OK')

        # --- Field errors show next to their fields in the chosen language ---
        await page.goto(BASE + '/claim/new')
        await page.wait_for_selector('#claim-name')
        # Leave the form empty and press Start claim.
        await page.get_by_role('button', name='Wyślij zgłoszenie').click()
        await page.wait_for_timeout(800)
        name_error = await page.locator('#error-name').inner_text()
        assert name_error == 'Podaj imię i nazwisko.', name_error
        email_error = await page.locator('#error-email').inner_text()
        assert email_error == 'Podaj poprawny adres e-mail.', email_error
        postcode_error = await page.locator('#error-postcode').inner_text()
        assert postcode_error == 'Podaj brytyjski kod pocztowy.', postcode_error
        model_error = await page.locator('#error-model').inner_text()
        assert model_error == 'Wybierz uszkodzoną lub brakującą część.', model_error
        photos_error = await page.locator('#error-photos').inner_text()
        assert photos_error == 'Dodaj od 1 do 4 zdjęć.', photos_error
        # The alert region carries the first refusal message, and focus moves to it.
        alert = page.locator('.alert-region')
        assert await alert.inner_text() != '', 'alert should carry the first refusal'
        focused = await page.evaluate('document.activeElement === document.querySelector(".alert-region")')
        assert focused, 'focus should move to the alert region'
        print('Polish field errors OK; alert announced and focused')

        # Switching back to English shows the English field errors.
        await page.get_by_role('radio', name='English').check()
        await page.wait_for_timeout(100)
        await page.get_by_role('button', name='Start claim').click()
        await page.wait_for_timeout(800)
        name_error = await page.locator('#error-name').inner_text()
        assert name_error == 'Enter your name.', name_error
        print('English field errors OK')

        # --- The newest carriage estimate wins ---
        await page.fill('#claim-name', 'Estimate Winner')
        await page.fill('#claim-email', 'estimate.winner@example.org')
        await page.fill('#claim-postcode', 'ze1 0aa')
        await page.select_option('#claim-model', 'kestle-shelving-unit')
        await page.wait_for_selector('.fan-part')
        await page.get_by_role('button', name='Part 3: Shelf pin').focus()
        await page.keyboard.press('Enter')
        await page.fill('#claim-quantity', '1')
        await page.fill('#claim-purchase', '2026-01-01')
        await page.set_input_files('#claim-photos', files=[{'name': 'p.png', 'mimeType': 'image/png', 'buffer': png}])

        # Press estimate with ZE (2.5s delay), then change to N1 and press again.
        estimate_button = page.get_by_role('button', name='Estimate carriage')
        await estimate_button.click()
        await page.fill('#claim-postcode', 'n1 9gu')
        await estimate_button.click()
        # The region shows only the answer to the newest press (N1, fast) —
        # the older ZE answer arrives later and is dropped.
        await page.wait_for_timeout(5000)
        estimate = await page.locator('.estimate-content').inner_text()
        assert estimate == 'Band S2 · £3.95', f'newest estimate should win, got {estimate}'
        print('newest estimate wins: the older answer was dropped')

        if errors:
            print('PAGE ERRORS:', errors)
            raise AssertionError('browser errors')
        await browser.close()
        print('\nPOLISH AND ESTIMATE CHECKS PASSED')

asyncio.run(main())
