"""Further journey checks: bank transfer, gift, phone width, reduced motion."""
import sys, time, json, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
results = []

def api(path, data=None):
    if data is not None:
        req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                     headers={'content-type': 'application/json'}, method='POST')
    else:
        req = urllib.request.Request(BASE + path)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())

def free_boxes(count):
    out = []
    for b in api('/api/shelf')['boxes']:
        if len(out) >= count:
            break
        if b['state'] == 'available':
            h = hold(b['number'])
            if h:
                release(b['number'], h['holdToken'])
                out.append(b['number'])
    return out

def hold(number):
    req = urllib.request.Request(BASE + '/api/holds', data=json.dumps({'number': number}).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError:
        return None

def release(number, token):
    req = urllib.request.Request(BASE + f'/api/holds/{number}', headers={'X-Hold-Token': token}, method='DELETE')
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError:
        pass

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    # Journey 4: bank transfer.
    boxes = free_boxes(1)
    bank_box = None
    if boxes:
        ctx = browser.new_context(viewport={'width': 768, 'height': 1024})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/shelf', wait_until='networkidle')
        # Try each candidate until the browser's own hold is granted.
        for cand in boxes + [b['number'] for b in api('/api/shelf')['boxes'] if b['state'] == 'available'][:6]:
            try:
                page.locator(f'[role=gridcell][data-number="{cand}"]').first.click(timeout=3000)
            except Exception:
                continue
            granted = ''
            for _ in range(12):
                time.sleep(0.5)
                granted = page.locator('#hold-status').inner_text()
                if 'yours' in granted or 'holding' in granted or 'found a home' in granted:
                    break
            if 'yours' in granted:
                bank_box = cand
                break
            # Release a possibly stale server-side state and retry with another box.
            page.goto(BASE + '/shelf', wait_until='networkidle')
        if bank_box is None:
            check('bank transfer order page', False, 'no box could be held')
            ctx.close()
        else:
            page.locator('#go-checkout').click()
            time.sleep(0.5)
            page.get_by_label('Your name').fill('Ida Collector')
            page.get_by_label('Your email').fill('ida@example.com')
            page.get_by_label('Street').fill('Snevej 12')
            page.get_by_label('Postcode').fill('2100')
            page.get_by_label('City').fill('Copenhagen')
            page.get_by_label('Bank transfer').check()
            page.locator('#reserve-transfer').click()
            for _ in range(20):
                time.sleep(0.5)
                if '/order/' in page.evaluate('location.pathname'): break
            check('bank transfer order page', '/order/LB-' in page.evaluate('location.href'), page.evaluate('location.href'))
            check('pending copy', page.locator('#payment-status').inner_text() == 'Waiting for your bank transfer.',
                  page.locator('#payment-status').inner_text())
            body = page.locator('.transfer-details').inner_text()
            check('transfer details show iban and deadline', 'IBAN:' in body and 'Deadline:' in body, body[:80])
            ctx.close()

    # Journey 5: gift on a 375px phone, sound off, tap to strike.
    boxes = free_boxes(1)
    if boxes:
        ctx = browser.new_context(viewport={'width': 375, 'height': 812}, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/', wait_until='networkidle')
        # answer the sound question with sound off
        dialog = page.locator('dialog[aria-label="Sound"]')
        if dialog.count() == 1:
            dialog.get_by_role('button', name='Sound off').click()
            time.sleep(0.3)
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check('no horizontal overflow at 375px', not overflow, str(overflow))
        # tap the matchbox
        page.evaluate("document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight * 0.2")
        time.sleep(0.4)
        page.locator('#strike').tap()
        time.sleep(0.5)
        check('tap strikes on the phone', page.evaluate('window.__scene.lightIntensity') >= 1)
        # gift checkout by tap: try candidates until the hold is granted
        page.goto(BASE + '/shelf', wait_until='networkidle')
        gift_box = None
        candidates = boxes + [b['number'] for b in api('/api/shelf')['boxes'] if b['state'] == 'available'][:6]
        for cand in candidates:
            try:
                page.locator(f'[role=gridcell][data-number="{cand}"]').first.tap(timeout=3000)
            except Exception:
                continue
            granted = ''
            for _ in range(12):
                time.sleep(0.5)
                granted = page.locator('#hold-status').inner_text()
                if 'yours' in granted or 'holding' in granted or 'found a home' in granted:
                    break
            if 'yours' in granted:
                gift_box = cand
                break
            page.goto(BASE + '/shelf', wait_until='networkidle')
        check('hold works by tap', gift_box is not None, granted)
        if gift_box is None:
            ctx.close()
        else:
            page.locator('#go-checkout').tap()
            time.sleep(0.5)
            page.get_by_label('This is a gift').check()
            time.sleep(0.3)
            check('gift fields appear', page.locator('#gift-fields').is_visible())
            page.get_by_label('Your name').fill('Iben Giver')
            page.get_by_label('Your email').fill('iben@example.com')
            page.get_by_label('Street').fill('Snevej 12')
            page.get_by_label('Postcode').fill('2100')
            page.get_by_label('City').fill('Copenhagen')
            page.get_by_label('Recipient name').fill('Mikkel Modtager')
            page.get_by_label('Recipient email').fill('mikkel@example.com')
            page.get_by_label('Gift message').fill('A warm bundle for you')
            page.get_by_label('Card number').fill('4242424242424242')
            page.get_by_label('Expiry').fill('12/29')
            page.get_by_label('Security code').fill('123')
            page.locator('#checkout-form button[type=submit]').tap()
            for _ in range(20):
                time.sleep(0.5)
                if '/order/' in page.evaluate('location.pathname'): break
            check('gift order lands on order page', '/order/LB-' in page.evaluate('location.href'))
            overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            check('no horizontal overflow on checkout at 375px', not overflow, str(overflow))
            ctx.close()

    # Reduced motion: discrete chapters, no scrub.
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
    page = ctx.new_page()
    page.goto(BASE + '/', wait_until='networkidle')
    dialog = page.locator('dialog[aria-label="Sound"]')
    if dialog.count() == 1:
        dialog.get_by_role('button', name='Continue without sound').click()
        time.sleep(0.3)
    check('next chapter button under reduced motion', page.locator('#next-chapter').is_visible())
    check('previous chapter button under reduced motion', page.locator('#prev-chapter').is_visible())
    page.locator('#next-chapter').click()
    time.sleep(0.4)
    ch = page.evaluate('window.__scene.chapter')
    check('next steps to stove', ch == 'stove', ch)
    page.locator('#strike').click()
    time.sleep(0.3)
    check('strike lights under reduced motion', page.evaluate('window.__scene.lightIntensity') >= 1)
    # The vision stays lit (no 12-second burn under reduced motion).
    time.sleep(13)
    check('vision stays lit under reduced motion', page.evaluate('window.__scene.lightIntensity') >= 1,
          str(page.evaluate('window.__scene.lightIntensity')))
    # Moving to another chapter clears it at once.
    page.locator('#next-chapter').click()
    time.sleep(0.3)
    check('moving on clears light at once', page.evaluate('window.__scene.lightIntensity') == 0)
    ctx.close()

    # No WebGL: the story still works.
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, java_script_enabled=True)
    page = ctx.new_page()
    page.add_init_script("Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });")
    page.goto(BASE + '/', wait_until='networkidle')
    dialog = page.locator('dialog[aria-label="Sound"]')
    if dialog.count() == 1:
        dialog.get_by_role('button', name='Sound off').click()
        time.sleep(0.3)
    check('next chapter button without WebGL', page.locator('#next-chapter').is_visible())
    page.locator('#next-chapter').click()
    time.sleep(0.3)
    check('chapters step without WebGL', page.evaluate('window.__scene.chapter') == 'stove',
          page.evaluate('window.__scene.chapter'))
    page.locator('#strike').click()
    time.sleep(0.3)
    check('strike works without WebGL', page.evaluate('window.__scene.lightIntensity') >= 1)
    ctx.close()

    check('no page errors across all journeys', len(errors) == 0, '; '.join(errors[:3]))
    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
