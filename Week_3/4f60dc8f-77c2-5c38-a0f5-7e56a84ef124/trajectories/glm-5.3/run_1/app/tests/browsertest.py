"""Browser journey test for Gloamwork Shot Rig."""
import asyncio
import re
import sys

from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'
MAILPIT = 'http://mailpit:8025'
failures = []


def check(name, ok, detail=''):
    status = 'ok  ' if ok else 'FAIL'
    if not ok:
        failures.append(name)
    print(f'{status} {name}' + (f' — {detail}' if detail else ''))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))

        # ---- home page journey ----
        await page.goto(BASE + '/', wait_until='networkidle')
        heading = await page.text_content('h1')
        check('home hero heading', heading == 'Your CAD, lit like a launch.', str(heading))
        nav_labels = await page.eval_on_selector_all('.nav-links a', 'els => els.map(e => e.textContent.trim())')
        check('main navigation labels', nav_labels == ['01 Work', '02 Services', '03 Studio', '04 Insights', '05 Start a project'], str(nav_labels))
        skip = await page.eval_on_selector('a.skip-link', 'el => el.getBoundingClientRect().left < 0')
        check('skip link present', skip)
        search = await page.query_selector('input#studio-search')
        check('search box present', search is not None)
        check('webgl data on hero', await page.get_attribute('[aria-label="Hero"]', 'data-webgl') in ('on', 'off'))
        hero_progress = await page.get_attribute('[aria-label="Hero"]', 'data-scrub-progress')
        check('hero scrub progress starts', hero_progress in ('0.000', '1.000'), str(hero_progress))

        # Hero scrub follows scroll both ways.
        await page.evaluate('window.scrollTo(0, 1200)')
        await page.wait_for_timeout(400)
        progress_down = await page.get_attribute('[aria-label="Hero"]', 'data-scrub-progress')
        await page.evaluate('window.scrollTo(0, 0)')
        await page.wait_for_timeout(400)
        progress_up = await page.get_attribute('[aria-label="Hero"]', 'data-scrub-progress')
        check('hero scrub moves with scroll', float(progress_down or 0) > 0 and float(progress_up or 0) < float(progress_down or 0), f'{progress_up} -> {progress_down}')
        check('hero scrub reverses', abs(float(progress_up or 0)) < 0.05, str(progress_up))

        # Services table with tilting objects.
        rows = await page.query_selector_all('.shot-table tbody tr')
        check('six service rows', len(rows) == 6, str(len(rows)))
        tilt = await page.get_attribute('.shot-table tbody tr:first-child .shot-object', 'data-tilt')
        check('service object tilt starts at 0', tilt == '0', str(tilt))
        idle = await page.get_attribute('.shot-table tbody tr:first-child .shot-object', 'data-idle')
        check('service object idle turning', idle == 'turning', str(idle))

        # Process region.
        process_step = await page.get_attribute('section#process', 'data-process-step')
        check('process step 1 at top', process_step == '1', str(process_step))
        await page.locator('section#process').scroll_into_view_if_needed()
        await page.evaluate("document.querySelector('section#process').scrollIntoView({block: 'end'})")
        await page.wait_for_timeout(400)
        process_step_late = await page.get_attribute('section#process', 'data-process-step')
        check('process step advances', process_step_late in ('2', '3', '4', '5'), str(process_step_late))

        # Marquee.
        marquee = await page.query_selector('div#clients')
        check('marquee region present', marquee is not None)
        pause_button = await page.text_content('button.marquee-toggle')
        check('pause button copy', pause_button == 'Pause client names', str(pause_button))

        # Studio search: type kettle and open the result.
        await page.fill('input#studio-search', 'kettle')
        await page.wait_for_timeout(900)
        status_text = await page.text_content('#search-status')
        check('search status announces matches', status_text == 'Matches: 1', str(status_text))
        results = await page.eval_on_selector_all('.search-results a', 'els => els.map(e => e.textContent)')
        check('kettle search result', any('Arc kettle' in r for r in results), str(results))
        await page.click('.search-results a')
        await page.wait_for_load_state('networkidle')
        case_title = await page.text_content('h1')
        check('case study page opens', case_title == 'Brant & Vale Arc kettle', str(case_title))
        data_morph = await page.get_attribute('figure[aria-label$="in 3D"]', 'data-morph')
        check('case study morph data', data_morph is not None, str(data_morph))

        # Clay view toggle.
        clay = page.locator('button[role="switch"]')
        await clay.click()
        await page.wait_for_timeout(750)
        morph = await page.get_attribute('figure[aria-label$="in 3D"]', 'data-morph')
        check('clay morph to 1', morph == '1.000', str(morph))
        await clay.click()
        await page.wait_for_timeout(750)
        morph_back = await page.get_attribute('figure[aria-label$="in 3D"]', 'data-morph')
        check('clay morph back to 0', morph_back == '0.000', str(morph_back))

        # ---- start a project ----
        await page.goto(BASE + '/start', wait_until='networkidle')
        import time as timelib
        email = f'bel{int(timelib.time())}@browser.test'
        await page.fill('#brand_name', 'Browser Brand')
        await page.fill('#contact_name', 'Bel Reader')
        await page.fill('#email', email)
        await page.fill('#title', 'Headset hero')
        await page.check('#currency-JPY')
        await page.click('button[type="submit"]')
        await page.wait_for_url(re.compile(r'/rig/.+'), timeout=15_000)
        rig_path = page.url
        check('start redirects to rig', '/rig/' in rig_path, rig_path)
        check('rig page heading', await page.text_content('h1') == 'Shot Rig')

        # Build the shot list by keyboard: tab into the group, arrows, space.
        group = page.locator('[aria-label="Shot Rig"]')
        await group.click()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        focused = await group.get_attribute('data-focused-shot')
        check('keyboard focus moves stations', focused is not None, str(focused))
        await page.keyboard.press('Space')
        await page.wait_for_timeout(2200)
        frustum_count = await group.get_attribute('data-frustum-count')
        check('space selects the focused shot', frustum_count == '1', str(frustum_count))
        phase = await group.get_attribute('data-rig-phase')
        check('rig returns to idle', phase == 'idle', str(phase))
        pip_shot = await page.get_attribute('figure[aria-label="Camera view"]', 'data-pip-shot')
        check('pip shows selected shot', pip_shot not in (None, 'overview'), str(pip_shot))

        # R resets the orbit.
        await page.keyboard.press('r')
        await page.wait_for_timeout(750)
        azimuth = await group.get_attribute('data-orbit-azimuth')
        check('R resets orbit', azimuth == '0', str(azimuth))

        # Quote updates in place.
        total_before = await page.text_content('#quote [data-numeral="total"]')
        checkbox_codes = await page.eval_on_selector_all('#shots-list input[type="checkbox"]', 'els => els.map(e => e.id)')
        await page.check('#shot-hero_front' if checkbox_codes and 'shot-hero_front' in str(checkbox_codes) else checkbox_codes[0] if checkbox_codes else '#shot-hero_front')
        await page.wait_for_timeout(1500)
        total_after = await page.text_content('#quote [data-numeral="total"]')
        check('quote total updates in place', total_before != total_after, f'{total_before} -> {total_after}')

        # Sign out and back in via emailed code.
        await page.context.clear_cookies()
        await page.goto(rig_path, wait_until='networkidle')
        check('signed-out rig redirects to sign-in', '/sign-in' in page.url, page.url)
        await page.fill('#email', email)
        await page.click('button:has-text("Send code")')
        await page.wait_for_timeout(2000)
        # Fetch the code from Mailpit, polling until it arrives.
        import urllib.request
        import json as jsonlib
        code = None
        for _ in range(10):
            data = jsonlib.loads(urllib.request.urlopen(MAILPIT + '/api/v1/messages?limit=30').read())
            for message in data['messages']:
                if 'sign-in code' in message['Subject'] and message['To'] and message['To'][0]['Address'] == email:
                    body = jsonlib.loads(urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{message['ID']}").read())
                    match = re.search(r'\b(\d{6})\b', body['Text'])
                    if match:
                        code = match.group(1)
            if code:
                break
            timelib.sleep(1.5)
        check('sign-in code emailed', code is not None)
        if code:
            await page.fill('#code', code)
            await page.click('button[type="submit"]')
            await page.wait_for_url(re.compile(r'/rig/.+'), timeout=15_000)
            check('sign-in lands on the rig', '/rig/' in page.url, page.url)

        # ---- phone viewport: drawer and deck ----
        phone = await browser.new_context(viewport={'width': 375, 'height': 812})
        phone_page = await phone.new_page()
        await phone_page.goto(BASE + '/', wait_until='networkidle')
        menu = phone_page.locator('button.menu-toggle')
        check('menu button visible on phone', await menu.is_visible())
        expanded = await menu.get_attribute('aria-expanded')
        check('menu starts closed', expanded == 'false', str(expanded))
        await menu.click()
        await phone_page.wait_for_timeout(400)
        check('menu opens', await menu.get_attribute('aria-expanded') == 'true')
        focus_tag = await phone_page.evaluate('document.activeElement.tagName')
        check('drawer focus moves to first link', focus_tag == 'A', str(focus_tag))
        await phone_page.keyboard.press('Escape')
        await phone_page.wait_for_timeout(400)
        check('escape closes drawer', await menu.get_attribute('aria-expanded') == 'false')
        check('focus returns to menu', await phone_page.evaluate('document.activeElement.className') == 'menu-toggle')

        # Deck on phone home.
        deck_index = await phone_page.get_attribute('#case-study-list', 'data-deck-index')
        check('deck index starts at 1', deck_index == '1', str(deck_index))
        deck_tiles = await phone_page.query_selector_all('#case-study-list .tile')
        check('deck has published studies', len(deck_tiles) >= 3, str(len(deck_tiles)))
        front_link = deck_tiles[0]
        await front_link.focus()
        await phone_page.keyboard.press('ArrowRight')
        await phone_page.wait_for_timeout(700)
        new_index = await phone_page.get_attribute('#case-study-list', 'data-deck-index')
        check('arrow advances the deck', new_index == '2', str(new_index))

        # ---- no console errors ----
        check('no page errors', len(errors) == 0, '; '.join(errors[:3]))

        await browser.close()

    print('ALL BROWSER CHECKS PASSED' if not failures else f'{len(failures)} BROWSER CHECKS FAILED: {failures}')
    return 0 if not failures else 1


sys.exit(asyncio.run(main()))
