#!/usr/bin/env python3
"""Interactive browser journey: account creation through campaign victory.

Drives the SPA the way a player would: create an account, choose a loadout,
start defence, place a device through Planning with a forecast preview, let the
run resolve, and submit for verification.
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173'
PASS = 0
FAIL = 0
FAILURES = []


def check(name, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f'  ok  {name}')
    else:
        FAIL += 1
        FAILURES.append((name, detail))
        print(f'  FAIL {name} — {detail}')


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))

    page.goto(BASE + '/', wait_until='networkidle')

    # Create an account through the UI
    stamp = str(int(time.time()))
    page.locator('#harbour-navigation').get_by_role('button', name='Account', exact=True).click()
    page.wait_for_timeout(300)
    page.get_by_role('textbox', name='Email').first.fill(f'player.{stamp}@example.com')
    page.get_by_role('textbox', name='Player name').fill('Browser Keeper')
    page.locator('input[type="password"]').first.fill('browser-keeper-pass')
    page.get_by_role('button', name='Create account').click()
    page.wait_for_timeout(500)
    check('account creation navigates to campaign', page.locator('main h1').first.inner_text() == 'Campaign', page.locator('main h1').first.inner_text())
    # Opening Campaign is an inspection: its loading messages legitimately
    # replace the creation success copy in the status region.
    page.wait_for_timeout(600)
    check('campaign inspection announced', 'Harbour records loaded' in page.locator('#harbour-status').inner_text(), page.locator('#harbour-status').inner_text())
    # Identity is available on the Account screen.
    page.locator('#harbour-navigation').get_by_role('button', name='Account', exact=True).click()
    page.wait_for_timeout(400)
    check('current player shows identity', 'Browser Keeper' in page.get_by_role('region', name='Current player').inner_text())
    page.locator('#harbour-navigation').get_by_role('button', name='Campaign', exact=True).click()
    page.wait_for_timeout(600)

    # Inspect the first encounter and choose a loadout
    page.get_by_role('button', name='Inspect First Lantern').click()
    page.wait_for_timeout(300)
    check('manifest appears', page.get_by_role('region', name='Encounter manifest').count() == 1)
    page.get_by_role('button', name='Choose loadout').first.click()
    page.wait_for_timeout(500)
    check('loadout group', page.get_by_role('group', name='Crew loadout').count() == 1)
    # Wickwarden is preselected
    check('wick checkbox checked', page.locator('#device-wick').is_checked())

    # Start defence
    page.get_by_role('button', name='Start defence').click()
    page.wait_for_timeout(1200)
    check('defence region appears', page.get_by_role('region', name='Defence').count() == 1)
    check('harbour chart grid', page.get_by_role('grid', name='Harbour chart').count() == 1)
    check('charge account region', page.get_by_role('region', name='Charge account').count() == 1)
    charge = page.get_by_role('region', name='Charge account').inner_text()
    check('reserve is whole charge with three decimals', '120.000' in charge or '121.000' in charge or '122.000' in charge, charge)
    check('defence toolbar', page.get_by_role('toolbar', name='Defence controls').count() == 1)
    check('playback speed combobox', page.get_by_role('combobox', name='Playback speed').count() == 1)

    # Roving tab stop: exactly one gridcell with tabindex 0
    tabbable = page.locator('[role="gridcell"][tabindex="0"]').count()
    check('one roving tab stop', tabbable == 1, str(tabbable))

    # Select a cell by click, then open Planning
    page.get_by_role('gridcell', name='Lane 3, cell 5').click()
    page.wait_for_timeout(200)
    check('selected cell region', page.get_by_role('region', name='Selected cell').count() == 1)
    selected = page.get_by_role('region', name='Selected cell').inner_text()
    check('selection shows coordinates', 'Lane 3, cell 5' in selected, selected)

    page.get_by_role('button', name='Plan', exact=True).click()
    page.wait_for_timeout(400)
    check('planning dialog opens', page.get_by_role('dialog', name='Planning').count() == 1)

    # Open Placement, run the forecast preview, then confirm
    page.get_by_role('button', name='Open placement').click()
    page.wait_for_timeout(400)
    check('placement dialog opens', page.get_by_role('dialog', name='Placement').count() == 1)
    page.get_by_role('button', name='Preview', exact=True).click()
    page.wait_for_timeout(600)
    check('preview ready announced', 'Preview ready' in page.locator('#harbour-status').inner_text(), page.locator('#harbour-status').inner_text())
    cast = page.get_by_role('region', name='Lantern Cast')
    check('lantern cast region', cast.count() == 1)
    check('forecast events table', page.get_by_role('table', name='Forecast events').count() == 1)
    check('cast shows immediate cost', '20.000' in cast.inner_text(), cast.inner_text()[:120])
    # Phase transitions on the lantern cast element
    check('cast reaches ready phase', page.locator('#lantern-cast').get_attribute('data-phase') == 'ready', page.locator('#lantern-cast').get_attribute('data-phase'))

    page.get_by_role('button', name='Place', exact=True).click()
    page.wait_for_timeout(1000)
    check('command placed status', 'Command placed' in page.locator('#harbour-status').inner_text(), page.locator('#harbour-status').inner_text())
    check('planning closes after place', page.get_by_role('dialog', name='Planning').count() == 0)
    charge = page.get_by_role('region', name='Charge account').inner_text()
    # The reserve reflects the deploy plus any generation ticks already elapsed.
    check('reserve reflects deploy and generation', ('100.000' in charge or '101.000' in charge or '102.000' in charge or '103.000' in charge), charge)

    # Let the run resolve to its terminal outcome.
    deadline = time.time() + 90
    reached_result = False
    while time.time() < deadline:
        if page.locator('main h1').first.inner_text() == 'Result':
            reached_result = True
            break
        time.sleep(1.5)
    check('run reaches result screen', reached_result)
    if reached_result:
        page.wait_for_timeout(400)
        result_text = page.get_by_role('region', name='Run result').inner_text()
        check('local outcome shown', 'victory' in result_text.lower() or 'defeat' in result_text.lower(), result_text[:120])

        # Submit for verification
        page.get_by_role('button', name='Submit result').click()
        page.wait_for_timeout(3500)
        status = page.locator('#harbour-status').inner_text()
        check('verification status announced', "strategy's recorded" in status or 'Verified defence ended' in status or 'pending' in status, status)
        verification = page.get_by_role('region', name='Run result').inner_text()
        check('verified victory read back', "Verified victory" in verification or 'Verified defence' in verification, verification[:160])

    browser.close()

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if errors:
    print('Page errors:')
    for error in errors[:10]:
        print(f'  - {error}')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL or errors else 0)
