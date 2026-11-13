"""Browser-level checks against the running app."""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
failures = []


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'  [{mark}] {name} {detail}')
    if not ok:
        failures.append(f'{name} {detail}')


def no_horizontal_scroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')


with sync_playwright() as p:
    browser = p.chromium.launch()

    print('== Catalogue (DP-01, DP-04, DP-05)')
    for width, height in VIEWPORTS:
        page = browser.new_page(viewport={'width': width, 'height': height})
        page.goto(BASE + '/', wait_until='networkidle')
        check(f'{width}x{height} no horizontal scroll', no_horizontal_scroll(page))
        if width == 1280:
            rail = page.locator('nav[aria-label="Kit categories"]')
            check('category rail visible at desktop', rail.is_visible())
            check('three kit sheets', page.locator('article.rental-sheet').count() == 3)
            check('no-dates prompt shown', page.locator('#no-dates').is_visible())
            check('masthead title', page.locator('.masthead-title').inner_text().lower() == 'tallyslate')
            check('only one h1 on catalogue', page.locator('h1').count() == 0, f'(found {page.locator("h1").count()})')
        page.close()

    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '/', wait_until='networkidle')
    page.fill('#pickup-date', '2026-11-13')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(900)
    check('no-dates prompt hidden after dates', not page.locator('#no-dates').is_visible())
    total = page.locator('[role="status"][aria-label="Hire total"]').inner_text()
    check('hire total announced', 'Hire total $' in total, total)
    slider = page.locator('#return-day')
    check('slider value 3', slider.input_value() == '3')
    page.fill('#pickup-date', '2026-11-10')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(900)
    page.locator('#return-day').focus()
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(900)
    check('address has pickup+return', 'pickup=2026-11-10' in page.url and 'return=' in page.url)
    page.close()

    print('== Kit sheet (DP-06)')
    page = browser.new_page(viewport={'width': 375, 'height': 812})
    page.goto(BASE + '/kits/kestrel-lf', wait_until='networkidle')
    check('kit heading is h1', page.locator('main h1').inner_text().lower() == 'kestrel lf camera package')
    tables = page.locator('table.units-table')
    check('three unit tables', tables.count() == 3)
    captions = [page.locator('table.units-table').nth(i).locator('caption').inner_text() for i in range(3)]
    check('captions use class names', all('units' in c for c in captions), str(captions))
    hold_button = page.locator('#hold-button')
    check('hold disabled without dates', hold_button.is_disabled())
    page.fill('#pickup-date', '2026-11-13')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(600)
    check('hold enabled with dates', not hold_button.is_disabled())
    check('phone no horizontal scroll', no_horizontal_scroll(page))
    page.close()

    print('== Booking page (DP-18)')
    page = browser.new_page(viewport={'width': 768, 'height': 1024})
    page.goto(BASE + '/bookings/NB-10002?key=need-a-key', wait_until='networkidle')
    check('booking h1 present', page.locator('h1').is_visible())
    check('confirm button present', page.locator('#confirm-button').is_visible())
    page.close()

    print('== Desk sign-in (DP-40)')
    page = browser.new_page(viewport={'width': 375, 'height': 812})
    page.goto(BASE + '/desk', wait_until='networkidle')
    check('passcode field present', page.locator('#passcode').is_visible())
    page.fill('#passcode', 'wrong-passcode')
    page.click('button[type="submit"]')
    page.wait_for_timeout(500)
    check('bad passcode message', "recognised" in page.locator('#signin-error').inner_text())
    page.fill('#passcode', 'northbar-owner-4417')
    page.click('button[type="submit"]')
    page.wait_for_url('**/desk/owner', timeout=5000)
    check('owner redirected to owner desk', '/desk/owner' in page.url)
    page.close()

    print('== Counter (DP-26)')
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '/desk', wait_until='networkidle')
    page.fill('#passcode', 'northbar-prep-2093')
    page.click('button[type="submit"]')
    page.wait_for_url('**/desk/counter', timeout=5000)
    check('prep tech lands on counter', '/desk/counter' in page.url)
    page.wait_for_timeout(1200)
    list_visible = page.locator('#bookings-list').is_visible()
    detail_visible = page.locator('#booking-detail').is_visible()
    check('desktop shows both panes', list_visible and detail_visible)
    buttons = page.locator('#bookings-list button')
    check('bookings listed', buttons.count() > 0, f'({buttons.count()} shown)')
    check('desktop no horizontal scroll', no_horizontal_scroll(page))
    page.close()

    page = browser.new_page(viewport={'width': 768, 'height': 1024})
    page.goto(BASE + '/desk', wait_until='networkidle')
    page.fill('#passcode', 'northbar-prep-2093')
    page.click('button[type="submit"]')
    page.wait_for_url('**/desk/counter', timeout=5000)
    page.wait_for_timeout(1200)
    check('tablet shows list only', page.locator('#bookings-list').is_visible())
    check('tablet hides detail', not page.locator('#booking-detail').is_visible())
    page.close()

    print('== Owner desk')
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '/desk', wait_until='networkidle')
    page.fill('#passcode', 'northbar-owner-4417')
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    check('utilisation region', page.locator('#utilisation').is_visible())
    util_text = page.locator('#utilisation-numbers').inner_text()
    check('utilisation numbers', 'units out' in util_text and 'utilisation' in util_text, util_text.replace('\n', ' | '))
    check('rate card table has rows', page.locator('#rate-card-table tbody tr').count() >= 1)
    check('units region populated', page.locator('#units-region button').count() >= 16)
    page.close()

    print('== Owner-only notice for prep tech')
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '/desk', wait_until='networkidle')
    page.fill('#passcode', 'northbar-prep-2093')
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle')
    page.goto(BASE + '/desk/owner', wait_until='networkidle')
    page.wait_for_timeout(1200)
    check('owner-only notice shown', page.locator('#owner-only').is_visible())
    page.close()

    print('== Unknown route')
    page = browser.new_page(viewport={'width': 375, 'height': 812})
    page.goto(BASE + '/nowhere-at-all', wait_until='networkidle')
    check('not-found heading', "We couldn't find that page" in page.content())
    page.close()

    browser.close()

print()
if failures:
    print(f'{len(failures)} FAILURES:')
    for failure in failures:
        print(' -', failure)
    sys.exit(1)
print('All browser checks passed.')
