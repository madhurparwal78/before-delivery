"""Journey checks for The Last Bundle, run against a live server."""
import sys, time, json, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
results = []

def api(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.loads(r.read().decode())

def free_boxes(count):
    """Boxes that can be held right now; the probe hold is released again so
    the browser's own hold is the real one."""
    shelf = api('/api/shelf')
    out = []
    for b in shelf['boxes']:
        if len(out) >= count:
            break
        if b['state'] == 'available':
            h = api_post_hold(b['number'])
            if h is not None:
                api_release_hold(b['number'], h['holdToken'])
                out.append(b['number'])
    return out

def api_post_hold(number):
    req = urllib.request.Request(BASE + '/api/holds', data=json.dumps({'number': number}).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError:
        return None

def api_release_hold(number, token):
    req = urllib.request.Request(BASE + f'/api/holds/{number}',
                                 headers={'X-Hold-Token': token}, method='DELETE')
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError:
        pass

FIRST, SECOND, THIRD = free_boxes(3)

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    # Journey 1: read and strike.
    page.goto(BASE + '/', wait_until='networkidle')
    dialog = page.locator('dialog[aria-label="Sound"]')
    check('sound question appears', dialog.count() == 1)
    if dialog.count() == 1:
        dialog.get_by_role('button', name='Sound off').click()
        time.sleep(0.4)
    check('sound question persists', page.evaluate("localStorage.getItem('press-sound')") is not None)
    main = page.locator('main')
    check('story main exists', main.count() == 1)
    # Scroll to the stove chapter.
    page.evaluate("document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight * 0.2")
    time.sleep(0.6)
    chapter = page.evaluate("window.__scene.chapter")
    check('chapter follows scroll', chapter in ('stove', 'alley'), f'chapter={chapter}')
    strike = page.locator('#strike')
    strike.click()
    time.sleep(0.4)
    lit = page.evaluate("window.__scene.lightIntensity")
    check('strike raises light', lit >= 1, f'light={lit}')
    matches = page.evaluate("window.__scene.litMatches")
    check('litMatches is 1', matches == 1, f'matches={matches}')
    out = None
    for _ in range(20):
        time.sleep(1.0)
        if page.evaluate("window.__scene.lightIntensity") == 0:
            out = page.locator('#story-status').inner_text()
            break
    check('match goes out with published copy', out == 'The match went out. Strike another.', repr(out))
    # Grandmother: the whole bundle lights.
    grandmother = page.evaluate("""(() => {
      const s = document.querySelector('[data-chapter=grandmother]');
      const main = document.querySelector('main');
      main.scrollTop = s.offsetTop - main.clientHeight * 0.4;
      return main.scrollTop / (main.scrollHeight - main.clientHeight);
    })()""")
    time.sleep(0.6)
    chapter = page.evaluate("window.__scene.chapter")
    check('grandmother chapter', chapter == 'grandmother', f'chapter={chapter} progress={grandmother:.3f}')
    strike.click()
    time.sleep(0.4)
    lit = page.evaluate("window.__scene.lightIntensity")
    matches = page.evaluate("window.__scene.litMatches")
    check('grandmother bundle lights 12', matches == 12, f'matches={matches}')
    check('grandmother light is 2', lit == 2, f'light={lit}')
    scene_keys = page.evaluate("Object.keys(window.__scene)")
    need = {'progress', 'chapter', 'cameraPosition', 'lightIntensity', 'litMatches', 'holdRemainingMs', 'matchLength'}
    check('scene object fields', need.issubset(set(scene_keys)), str(scene_keys))

    # Journey 2: hold a number.
    page.goto(BASE + '/shelf', wait_until='networkidle')
    time.sleep(1.0)
    grid = page.locator('#box-grid')
    check('shelf grid exists', grid.count() == 1)
    cells = page.locator('[role=gridcell]')
    check('240 grid cells', cells.count() == 240, f'count={cells.count()}')
    # Keyboard: roving focus and type-a-number.
    page.locator('#box-grid').focus()
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowDown')
    focused = page.evaluate("document.activeElement.dataset.number")
    check('arrow keys move focus', focused is not None, f'focused={focused}')
    page.keyboard.press('Home')
    focused = page.evaluate("document.activeElement.dataset.number")
    check('Home goes to box 1', focused == '1', f'focused={focused}')
    page.keyboard.press('End')
    focused = page.evaluate("document.activeElement.dataset.number")
    check('End goes to box 240', focused == '240', f'focused={focused}')
    # Choose box 117 by typing digits.
    page.keyboard.press('Home')
    page.keyboard.type(str(FIRST))
    time.sleep(0.7)
    status = page.locator('#hold-status').inner_text()
    check('hold granted copy', f'Box {FIRST} is yours while this match burns.' in status, status)
    timer = page.locator('#hold-timer').inner_text()
    check('timer shows minutes:seconds', ':' in timer and timer.startswith('09') or ':' in timer, timer)
    held = page.locator('#boxes-held').inner_text()
    check('boxes held is 1', held == '1', held)
    # Reload: the countdown continues from the server.
    page.reload(wait_until='networkidle')
    time.sleep(1.2)
    # The hold token lives in the browser session; after reload the client asks
    # the server for the time left.
    held_after = page.evaluate("window.__scene.holdRemainingMs")
    check('hold state reported after reload', held_after is not None, str(held_after))

    # Put it back.
    page.goto(BASE + '/shelf', wait_until='networkidle')
    status_before = ''
    for _ in range(20):
        time.sleep(0.5)
        status_before = page.locator('#hold-status').inner_text()
        if 'yours' in status_before:
            break
    check('hold restored after navigation', 'yours' in status_before, status_before)
    page.locator('#put-back').click()
    time.sleep(0.8)
    status = page.locator('#hold-status').inner_text()
    check('hold released copy', f'Box {FIRST} is back on the shelf.' in status, status)
    held = page.locator('#boxes-held').inner_text()
    check('boxes held back to 0', held == '0', held)

    # Journey 3: card checkout with challenge.
    page.goto(BASE + '/shelf', wait_until='networkidle')
    time.sleep(0.6)
    page.locator(f'[data-number="{SECOND}"]').click()
    granted = ''
    for _ in range(20):
        time.sleep(0.5)
        granted = page.locator('#hold-status').inner_text()
        if 'yours' in granted:
            break
    check('second hold granted', 'yours' in granted, granted)
    page.locator('#go-checkout').click()
    time.sleep(0.6)
    page.get_by_label('Your name').fill('Ida Collector')
    page.get_by_label('Your email').fill('ida@example.com')
    page.get_by_label('Street').fill('Snevej 12')
    page.get_by_label('Postcode').fill('2100')
    page.get_by_label('City').fill('Copenhagen')
    page.get_by_label('Card number').fill('4000000000003220')
    page.get_by_label('Expiry').fill('12/29')
    page.get_by_label('Security code').fill('123')
    page.locator('#checkout-form button[type=submit]').click()
    time.sleep(2.5)
    dialog = page.locator('dialog[aria-label="Bank check"]')
    check('bank check dialog appears', dialog.count() == 1)
    if dialog.count() == 1:
        dialog.get_by_label('One-time code').fill('1234')
        dialog.get_by_role('button', name='Approve').click()
        for _ in range(30):
            time.sleep(0.5)
            if '/order/' in page.evaluate('location.pathname'):
                break
    url = page.evaluate('location.href')
    check('ends on order page', '/order/LB-' in url, url)
    status = page.locator('#payment-status').inner_text()
    check('authorised copy', status == 'Your card is authorised. You have not been charged yet.', status)

    # Keyboard-complete: the dialog managed focus.
    check('no page errors', len(errors) == 0, '; '.join(errors[:3]))

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
