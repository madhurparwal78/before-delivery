"""Frontend smoke tests with a real browser against the running app."""
import asyncio
import sys
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + f' {name}' + (f' -- {detail}' if detail and not ok else ''))

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # public page
        await page.goto(BASE + '/')
        await page.wait_for_load_state('networkidle')
        h1 = await page.locator('h1').first.text_content()
        check('public h1', h1 == 'Walk the room before you build it.', repr(h1))
        chain = page.get_by_role('list', name='Vault chain')
        items = await chain.locator('li').count()
        check('vault chain 6 items', items == 6, f'{items}')
        signup = page.get_by_role('form', name='Create your venue')
        check('signup form', await signup.count() == 1)
        boxes = await signup.locator('input').count()
        check('signup fields 4', boxes == 4, f'{boxes}')

        # scroll lights cues
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        await page.wait_for_timeout(300)
        lit = await page.locator('.chain-side li.lit').count()
        check('cues lit on scroll', lit >= 1, f'{lit}')

        # sign in
        await page.goto(BASE + '/signin')
        await page.fill('#si-email', 'mara@lanternlane.test')
        await page.fill('#si-pw', 'keyway-owner-1')
        await page.click('button[type=submit]')
        await page.wait_for_url('**/app')
        await page.wait_for_load_state('networkidle')
        # the picker should open on the editor
        dialog = page.get_by_role('dialog', name='Open a room')
        await dialog.wait_for(state='visible', timeout=5000)
        check('picker opens on load', True)
        opt = dialog.get_by_role('option')
        names = []
        for i in range(await opt.count()):
            names.append((await opt.nth(i).inner_text()).split('\n')[0])
        check('picker alphabetical first', names and names[0] == 'Apothecary', str(names))
        check('picker lists 6 rooms', len(names) == 6, str(names))

        # keyboard: arrow right moves highlight
        first = dialog.get_by_role('option').first
        await first.focus()
        await page.keyboard.press('ArrowRight')
        await page.wait_for_timeout(100)
        sel = await dialog.locator('[aria-selected="true"]').inner_text()
        check('arrow right highlights second', "Clockmaker's Study" in sel, repr(sel))
        await page.keyboard.press('Home')
        await page.wait_for_timeout(100)

        # enter walks in
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(1500)
        url = page.url
        check('enter opens room', '/app/rooms/' in url, url)

        # play button and transport
        transport = page.get_by_role('toolbar', name='Transport')
        check('transport present', await transport.count() == 1)
        play = page.get_by_role('button', name='Start playtest')
        check('play button', await play.count() == 1)
        await play.click()
        await page.wait_for_timeout(1200)
        stop = page.get_by_role('button', name='Stop playtest')
        check('play becomes stop', await stop.count() == 1)

        # clock and figures (Apothecary: 6 nodes)
        clock = page.get_by_role('timer', name='Playtest clock')
        clock_text = await clock.text_content() if await clock.count() else ''
        check('clock counts from 60:00', clock_text in ('60:00', '59:59'), repr(clock_text))
        figs = await page.get_by_role('group', name='Chain figures').inner_text()
        check('chain figures group', '0 of 6 solved' in figs and 'Longest run 3' in figs and '4 props' in figs, repr(figs))

        # debrief on stop
        await page.get_by_role('button', name='Stop playtest').click()
        debrief = page.get_by_role('dialog', name='Debrief')
        await debrief.wait_for(state='visible', timeout=5000)
        heading = await debrief.locator('h2').text_content()
        check('debrief heading', heading == 'Playtest ended', repr(heading))

        # after closing, focus on play
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        focused = await page.evaluate('document.activeElement && document.activeElement.getAttribute("aria-label")')
        check('focus returns to play', focused == 'Start playtest', repr(focused))

        # picker via Rooms button
        await page.get_by_role('button', name='Rooms').first.click()
        await page.wait_for_timeout(200)
        check('rooms reopens picker', await page.get_by_role('dialog', name='Open a room').count() == 1)

        # service status: check pill
        pill = page.get_by_role('toolbar', name='Live session')
        pill_text = await pill.inner_text()
        check('pill shows Live', 'Live' in pill_text, repr(pill_text[:80]))

        # console errors (401s before sign-in are expected)
        real_errors = [e for e in errors if '401' not in e and '401 (Unauthorized)' not in e]
        check('no console errors', not real_errors, '; '.join(real_errors[:3]))

        await browser.close()

    failed = [r for r in results if not r[1]]
    print(f'\n{len(results)-len(failed)}/{len(results)} passed')
    return 1 if failed else 0

sys.exit(asyncio.run(main()))
