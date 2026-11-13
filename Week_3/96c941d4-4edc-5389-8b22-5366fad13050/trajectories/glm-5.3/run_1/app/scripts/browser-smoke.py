#!/usr/bin/env python3
"""Browser smoke test for the Squallglass SPA.

Loads the app in headless Chromium, walks the public screens, checks the ARIA
contract landmarks and captures console errors.
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173'
PASS = 0
FAIL = 0
FAILURES = []
CONSOLE_ERRORS = []


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
    page.on('console', lambda msg: CONSOLE_ERRORS.append(msg.text) if msg.type == 'error' else None)
    page.on('pageerror', lambda err: CONSOLE_ERRORS.append(str(err)))

    page.goto(BASE + '/', wait_until='networkidle')
    check('page title loads', 'Squallglass' in (page.title() or ''), page.title())

    # Public screen contract
    check('heading Squallglass', page.get_by_role('heading', name='Squallglass').count() == 1)
    check('navigation labelled', page.get_by_role('navigation', name='Harbour navigation').count() == 1)
    for label in ['Account', 'Tutorial', 'Campaign', 'Editor', 'Community', 'Rules']:
        buttons = page.locator('#harbour-navigation').get_by_role('button', name=label, exact=True)
        check(f'button {label}', buttons.count() == 1, str(buttons.count()))

    # Rules screen
    page.locator('#harbour-navigation').get_by_role('button', name='Rules', exact=True).click()
    page.wait_for_timeout(400)
    check('rules reference region', page.get_by_role('region', name='Rules reference').count() == 1)
    rules_text = page.get_by_role('region', name='Rules reference').inner_text()
    check('rules show ruleset', 'orrel-1' in rules_text)
    check('rules show tick order', 'simultaneous-damage' in rules_text)
    check('rules show worked example', '270369' in rules_text)

    # Campaign screen
    page.locator('#harbour-navigation').get_by_role('button', name='Campaign', exact=True).click()
    page.wait_for_timeout(600)
    check('campaign encounters region', page.get_by_role('region', name='Campaign encounters').count() == 1)
    check('campaign first encounter button', page.get_by_role('button', name='Inspect First Lantern').count() == 1)
    page.get_by_role('button', name='Inspect First Lantern').click()
    page.wait_for_timeout(300)
    check('encounter manifest region', page.get_by_role('region', name='Encounter manifest').count() == 1)
    manifest = page.get_by_role('region', name='Encounter manifest').inner_text()
    check('manifest shows seed', 'Seed' in manifest and '1' in manifest)
    check('manifest shows gate', 'Unlocked' in manifest)

    # Community screen (season surfaces)
    page.locator('#harbour-navigation').get_by_role('button', name='Community', exact=True).click()
    page.wait_for_timeout(800)
    check('search textbox', page.get_by_role('textbox', name='Search challenges').count() == 1)
    check('difficulty filter', page.get_by_role('combobox', name='Filter difficulty').count() == 1)
    check('ruleset filter', page.get_by_role('combobox', name='Filter ruleset').count() == 1)
    check('discovery indexing region', page.get_by_role('region', name='Discovery indexing').count() + page.locator('[aria-label="Discovery indexing"]').count() >= 1)
    check('season summary region', page.get_by_role('region', name='Season summary').count() == 1)
    check('daily challenge region', page.get_by_role('region', name='Daily challenge').count() == 1)
    season_text = page.get_by_role('region', name='Season summary').inner_text()
    check('season shows local time', 'UTC+05:45' in season_text or '+05:45' in season_text)
    check('season instant field', page.get_by_role('textbox', name='Season instant').count() == 1)
    check('inspect season button', page.get_by_role('button', name='Inspect season').count() == 1)

    # Account screen
    page.locator('#harbour-navigation').get_by_role('button', name='Account', exact=True).click()
    page.wait_for_timeout(300)
    check('email textbox', page.get_by_role('textbox', name='Email').count() >= 1)
    check('player name textbox', page.get_by_role('textbox', name='Player name').count() == 1)
    check('password textbox', page.locator('input[type="password"]').count() == 2)
    check('create account button', page.get_by_role('button', name='Create account').count() == 1)
    check('sign in button', page.locator('#harbour-navigation ~ * #sign-in, #sign-in').count() >= 1)
    check('current player region', page.get_by_role('region', name='Current player').count() == 1)

    # Tutorial screen
    page.locator('#harbour-navigation').get_by_role('button', name='Tutorial', exact=True).click()
    page.wait_for_timeout(400)
    check('tutorial instructions region', page.get_by_role('region', name='Tutorial instructions').count() == 1)
    check('begin practice button', page.get_by_role('button', name='Begin practice').count() == 1)
    check('restart practice button', page.get_by_role('button', name='Restart practice').count() == 1)
    check('finish practice button', page.get_by_role('button', name='Finish practice').count() == 1)

    # Editor screen (signed out)
    page.locator('#harbour-navigation').get_by_role('button', name='Editor', exact=True).click()
    page.wait_for_timeout(400)
    check('private levels region', page.get_by_role('region', name='Private levels').count() == 1)
    check('new level button', page.get_by_role('button', name='New level').count() == 1)

    # Feedback live regions exist
    check('status live region', page.locator('#harbour-status[role="status"]').count() == 1)
    check('error alert region', page.locator('#harbour-error[role="alert"]').count() == 1)

    # No horizontal overflow on the page at reference viewports
    for width, height in [(1280, 800), (768, 1024), (375, 812)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(250)
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check(f'no horizontal overflow at {width}x{height}', overflow <= 0, f'overflow {overflow}px')

    browser.close()

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if CONSOLE_ERRORS:
    print('Console errors:')
    for error in CONSOLE_ERRORS[:10]:
        print(f'  - {error}')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL or CONSOLE_ERRORS else 0)
