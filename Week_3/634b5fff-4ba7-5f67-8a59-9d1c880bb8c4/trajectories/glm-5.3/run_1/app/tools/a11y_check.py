"""Accessibility and interaction checks: axe-core on the shelf with a box held,
dialog focus management, certificate text, statement bytes, lookup."""
import sys, time, json, urllib.request, urllib.error, hashlib
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

def api(path, data=None, headers=None, method=None):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'content-type': 'application/json', **(headers or {})},
        method=method or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body) if body else None
        except Exception:
            return e.code, None

AXE_JS = 'https://unpkg.com/axe-core@4.10.0/axe.min.js'

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={'width': 1280, 'height': 800}).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # Grab axe-core once.
    axe_src = None
    with urllib.request.urlopen(AXE_JS, timeout=30) as r:
        axe_src = r.read().decode()
    check('axe-core loaded', axe_src is not None and len(axe_src) > 10000, str(len(axe_src or '')))

    # Journey 2 with a box held: the shelf has no axe violations of the tags.
    page.goto(BASE + '/shelf', wait_until='networkidle')
    page.evaluate(axe_src)
    res = page.evaluate("""async () => {
      const r = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
      return r.violations;
    }""")
    brief = [(v['id'], [n['html'][:60] for n in v['nodes'][:2]]) for v in res]
    check('the shelf has no axe violations of the four rule tags', len(res) == 0, json.dumps(brief)[:400])

    # Hold a box, then check again with the hold bar live.
    shelf = api('/api/shelf')[1]
    free = []
    for b in shelf['boxes']:
        if len(free) >= 2:
            break
        if b['state'] == 'available':
            s, h = api('/api/holds', {'number': b['number']})
            if isinstance(h, dict) and h.get('holdToken'):
                api(f"/api/holds/{b['number']}", headers={'X-Hold-Token': h['holdToken']}, method='DELETE')
                free.append(b['number'])
    page.locator(f'[role=gridcell][data-number="{free[0]}"]').first.click()
    for _ in range(20):
        time.sleep(0.5)
        if 'yours' in page.locator('#hold-status').inner_text():
            break
    page.evaluate(axe_src)
    res = page.evaluate("""async () => {
      const r = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
      return r.violations;
    }""")
    brief = [(v['id'], [n['html'][:60] for n in v['nodes'][:2]]) for v in res]
    check('the shelf with a box held has no axe violations', len(res) == 0, json.dumps(brief)[:400])

    # Focus moves to Go to checkout after choosing.
    focused = page.evaluate("document.activeElement.id")
    check('focus moves to Go to checkout', focused == 'go-checkout', focused)

    # Put it back returns focus to the cell.
    page.locator('#put-back').click()
    time.sleep(1.0)
    focused = page.evaluate("document.activeElement && document.activeElement.getAttribute('data-number')")
    check('Put it back returns focus to the box cell', focused == str(free[0]), str(focused))

    # The hold bar with no hold shows only the statuses.
    held_text = page.locator('#boxes-held').inner_text()
    check('boxes held back to 0', held_text == '0', held_text)

    # Dialog focus: the bank check keeps Tab inside.
    page.goto(BASE + '/shelf', wait_until='networkidle')
    time.sleep(0.5)
    page.locator(f'[role=gridcell][data-number="{free[1]}"]').first.click()
    for _ in range(20):
        time.sleep(0.5)
        if 'yours' in page.locator('#hold-status').inner_text():
            break
    page.locator('#go-checkout').click()
    time.sleep(0.5)
    page.get_by_label('Your name').fill('Fokus Person')
    page.get_by_label('Your email').fill('focus@example.com')
    page.get_by_label('Street').fill('Snevej 12')
    page.get_by_label('Postcode').fill('2100')
    page.get_by_label('City').fill('Copenhagen')
    page.get_by_label('Card number').fill('4000000000003220')
    page.get_by_label('Expiry').fill('12/29')
    page.get_by_label('Security code').fill('123')
    page.locator('#checkout-form button[type=submit]').click()
    time.sleep(2.5)
    dialog = page.locator('dialog[aria-label="Bank check"]')
    if dialog.count() == 1:
        # Tab wraps inside the dialog.
        first_id = page.evaluate("document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') || document.activeElement.id)")
        for _ in range(8):
            page.keyboard.press('Tab')
        still_inside = page.evaluate("!!document.activeElement.closest('dialog')")
        check('Tab stays inside the open dialog', still_inside, page.evaluate("document.activeElement.tagName"))
        # Escape acts as Cancel.
        page.keyboard.press('Escape')
        time.sleep(1.0)
        gone = page.locator('dialog[aria-label="Bank check"]').count() == 0
        check('Escape closes the bank check like Cancel', gone)
    else:
        check('bank check opens for focus test', False, 'no dialog')

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
