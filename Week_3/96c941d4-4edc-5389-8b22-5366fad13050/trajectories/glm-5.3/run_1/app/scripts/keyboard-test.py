#!/usr/bin/env python3
"""Keyboard completeness tests (DP-31): roving board, dialogs, shortcuts."""
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

    stamp = str(int(time.time()))
    page.get_by_role('textbox', name='Email').first.fill(f'keys.{stamp}@example.com')
    page.get_by_role('textbox', name='Player name').fill('Key Keeper')
    page.locator('input[type="password"]').first.fill('keyboard-keeper-pass')
    page.get_by_role('button', name='Create account').click()
    page.wait_for_timeout(800)
    page.get_by_role('button', name='Choose loadout').first.click()
    page.wait_for_timeout(500)
    page.get_by_role('button', name='Start defence').click()
    page.wait_for_timeout(1500)

    # Focus the roving gridcell directly and walk with arrows.
    page.locator('[role="gridcell"][tabindex="0"]').focus()
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('gridcell focusable', active is not None and 'Lane' in active, str(active))

    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('arrow right moves one cell', active == 'Lane 3, cell 6', str(active))

    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('arrow down clamps at lane 5 from lane 3 twice? no: lane 4', active == 'Lane 4, cell 6', str(active))

    page.keyboard.press('End')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('End moves to lane end', active == 'Lane 4, cell 9', str(active))

    page.keyboard.press('Home')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('Home moves to lane start', active == 'Lane 4, cell 1', str(active))

    page.keyboard.press('ArrowUp')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('arrow up moves up', active == 'Lane 3, cell 1', str(active))

    # Boundary clamping
    for _ in range(6):
        page.keyboard.press('ArrowUp')
    page.wait_for_timeout(150)
    active = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('up clamps at lane 1', active == 'Lane 1, cell 1', str(active))

    # Number keys select devices while a nontext control has focus (loadout has wick)
    page.keyboard.press('1')
    page.wait_for_timeout(200)
    status = page.locator('#harbour-status').inner_text()
    check('number key selects device', 'Wickwarden' in status, status)

    # Enter on a cell opens Planning
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    check('Enter opens Planning', page.get_by_role('dialog', name='Planning').count() == 1)

    # Tab trap within the dialog: Tab from the last focusable wraps inside.
    focusables = page.locator('#planning-dialog button, #planning-dialog input, #planning-dialog select')
    last = focusables.nth(focusables.count() - 1)
    last.focus()
    page.keyboard.press('Tab')
    page.wait_for_timeout(150)
    inside = page.evaluate('document.activeElement.closest("#planning-dialog") !== null')
    check('Tab trapped inside dialog', inside)

    # Shift+Tab from the first focusable wraps to the last
    first = focusables.nth(0)
    first.focus()
    page.keyboard.press('Shift+Tab')
    page.wait_for_timeout(150)
    still_inside = page.evaluate('document.activeElement.closest("#planning-dialog") !== null')
    check('Shift+Tab trapped inside dialog', still_inside)

    # Escape closes only the topmost layer (Planning), restoring its opener
    opener_cell = page.evaluate('document.activeElement.getAttribute("aria-label")')
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    check('Escape closes Planning', page.get_by_role('dialog', name='Planning').count() == 0)
    focused_after = page.evaluate('document.activeElement.getAttribute("aria-label")')
    check('focus returns to opener cell', focused_after is not None and 'Lane' in focused_after, str(focused_after))

    # Reopen Planning through the Plan button; Escape there too.
    page.get_by_role('button', name='Plan', exact=True).click()
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    check('Escape from Plan closes Planning again', page.get_by_role('dialog', name='Planning').count() == 0)

    # Pause dialog: Escape/Resume behavior and Leave run chain
    page.get_by_role('button', name='Pause', exact=True).click()
    page.wait_for_timeout(300)
    check('Pause dialog opens', page.locator('#paused-dialog').count() == 1)
    page.locator('#paused-dialog').get_by_role('button', name='Leave run', exact=True).click()
    page.wait_for_timeout(300)
    check('Leave run dialog opens from Paused', page.locator('#leave-dialog').count() == 1)
    page.locator('#leave-dialog').get_by_role('button', name='Keep playing', exact=True).click()
    page.wait_for_timeout(300)
    check('Keep playing returns to Paused', page.locator('#paused-dialog').count() == 1)
    page.locator('#paused-dialog').get_by_role('button', name='Resume', exact=True).click()
    page.wait_for_timeout(300)
    check('Resume closes Paused', page.locator('#paused-dialog').count() == 0)

    # Number keys do not fire while typing in a text field: focus the lane input
    # inside Planning and type a digit without device selection side effects.
    page.get_by_role('button', name='Plan', exact=True).click()
    page.wait_for_timeout(300)
    lane_input = page.locator('#plan-lane')
    lane_input.fill('2')
    lane_input.focus()
    status_before = page.locator('#harbour-status').inner_text()
    page.keyboard.type('5')
    page.wait_for_timeout(200)
    check('typing in text field not intercepted', '5' in lane_input.input_value(), lane_input.input_value())
    check('typing does not announce device selection', page.locator('#harbour-status').inner_text() == status_before, f'{status_before!r} -> {page.locator("#harbour-status").inner_text()!r}')

    # Escape closes Placement only, keeping Planning open
    page.get_by_role('button', name='Open placement').click()
    page.wait_for_timeout(300)
    check('Placement opens over Planning', page.get_by_role('dialog', name='Placement').count() == 1)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    check('Escape closes only Placement', page.get_by_role('dialog', name='Placement').count() == 0 and page.get_by_role('dialog', name='Planning').count() == 1)

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
