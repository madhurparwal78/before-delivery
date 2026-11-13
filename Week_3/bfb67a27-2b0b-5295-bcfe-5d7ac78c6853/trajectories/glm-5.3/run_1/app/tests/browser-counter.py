"""Counter checkout by keyboard (DP-25, DP-27) and reduced motion (DP-43)."""
import datetime
import json
import struct
import sys
import urllib.request
import zlib
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
failures = []


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'  [{mark}] {name} {detail}')
    if not ok:
        failures.append(f'{name} {detail}')


def png_bytes():
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


with open('/tmp/counter-photo.png', 'wb') as fh:
    fh.write(png_bytes())

# Create a fully confirmed booking to check out at the counter.
_now = datetime.datetime.now()
# Keep the window inside the certificate coverage the test approves (2030-01-01 .. 2030-12-31).
PICKUP = (datetime.date(2030, 1, 1) + datetime.timedelta(days=(_now.microsecond // 3000) % 330)).isoformat()
payload = json.dumps({
    'kitId': 'kestrel-lf',
    'pickupDate': PICKUP,
    'returnDate': PICKUP,  # corrected below
    'renter': {'name': 'Kai Roa', 'email': f'kai{datetime.datetime.now().second}@example.test'},
}).encode()
# Fix returnDate below to pickup+2
data = json.loads(payload.decode())
data['returnDate'] = (datetime.date.fromisoformat(PICKUP) + datetime.timedelta(days=2)).isoformat()
payload = json.dumps(data).encode()

req = urllib.request.Request(
    f'{BASE}/api/bookings',
    data=payload,
    headers={'Content-Type': 'application/json', 'Idempotency-Key': f"counter-{datetime.datetime.now().timestamp()}-{datetime.datetime.now().microsecond}"},
    method='POST')
with urllib.request.urlopen(req) as r:
    created = json.loads(r.read())
REF = created['booking']['ref']
KEY = created['renterKey']
print(f'booking {REF} held')

# certificate + approval
with open('/tmp/counter-cert.pdf', 'wb') as fh:
    fh.write(b'%PDF-1.4\nCounter checkout certificate\n%EOF')
import uuid
boundary = uuid.uuid4().hex
file_bytes = open('/tmp/counter-cert.pdf', 'rb').read()
multipart = (
    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="cert.pdf"\r\n'
    f'Content-Type: application/pdf\r\n\r\n').encode() + file_bytes + f'\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request(
    f'{BASE}/api/bookings/{REF}/certificate',
    data=multipart,
    headers={'X-Renter-Key': KEY, 'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST')
with urllib.request.urlopen(req) as r:
    pass

# sign in as owner to approve
import http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
req = urllib.request.Request(
    f'{BASE}/api/session',
    data=json.dumps({'passcode': 'northbar-owner-4417'}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST')
opener.open(req)
with opener.open(f'{BASE}/api/certificates?status=pending_review') as r:
    certs = json.loads(r.read())['certificates']
cert_id = [c for c in certs if c['bookingRef'] == REF][0]['id']
req = urllib.request.Request(
    f'{BASE}/api/certificates/{cert_id}/review',
    data=json.dumps({
        'decision': 'approve',
        'coverageStart': '2030-01-01',
        'coverageEnd': '2030-12-31',
        'limitCents': 9000000,
        'lossPayeeNamed': True,
    }).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST')
opener.open(req)

# confirm as renter
req = urllib.request.Request(
    f'{BASE}/api/bookings/{REF}/confirm',
    data=b'{}',
    headers={'Content-Type': 'application/json', 'X-Renter-Key': KEY, 'Idempotency-Key': f'confirm-{REF}-ui'},
    method='POST')
with urllib.request.urlopen(req) as r:
    confirmed = json.loads(r.read())
check('booking confirmed', confirmed['state'] == 'confirmed')

with sync_playwright() as p:
    browser = p.chromium.launch()

    print('== Counter prep + checkout by keyboard (DP-25, DP-27)')
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/desk', wait_until='networkidle')
    page.fill('#passcode', 'northbar-prep-2093')
    page.click('button[type="submit"]')
    page.wait_for_url('**/desk/counter', timeout=5000)
    page.wait_for_timeout(1500)
    page.click(f'button:has-text("{REF}")')
    page.wait_for_timeout(800)
    check('detail opens', REF in page.locator('#booking-detail').inner_text())

    page.click('button:has-text("Prep kit")')
    page.wait_for_timeout(800)
    check('prepped announced', f'Kit prepped · {REF}' in page.locator('#counter-status').inner_text(),
          page.locator('#counter-status').inner_text())

    page.click('button:has-text("Start checkout")')
    page.wait_for_timeout(400)
    scan = page.locator('[aria-label="Scan serial"]')
    check('scan field focused', page.evaluate('document.activeElement === document.querySelector("[aria-label=\\"Scan serial\\"]")'))

    units = [u['serial'] for u in created['booking']['units']]
    for serial in units:
        scan.fill(serial)
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)
        group = page.locator(f'[role="group"][aria-label="{serial}"]')
        check(f'{serial} group opens', group.count() == 1)
        # tick all three checks with Space
        boxes = group.locator('input[type="checkbox"]')
        for i in range(boxes.count()):
            boxes.nth(i).focus()
            page.keyboard.press('Space')
        group.locator('[aria-label="Condition notes"]').fill('Checked at the bench')
        page.set_input_files('[role="group"][aria-label="' + serial + '"] [aria-label="Condition photo"]', '/tmp/counter-photo.png')
        page.wait_for_timeout(900)
        photo_status = group.locator('.serial-photo-status').inner_text()
        check(f'{serial} photo stored', photo_status == 'Stored', photo_status)
        group.locator('button:has-text("Done with unit")').click()
        page.wait_for_timeout(300)
        check(f'focus back to scan after {serial}',
              page.evaluate('document.activeElement === document.querySelector("[aria-label=\\"Scan serial\\"]")'))

    review = page.locator('button:has-text("Review checkout")')
    check('review enabled', not review.is_disabled())
    review.focus()
    check('tab reaches review from scan', page.evaluate('document.activeElement && document.activeElement.textContent.includes("Review checkout")'))
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    dialog = page.locator('dialog[open]')
    check('confirm dialog opens', dialog.count() == 1, f'(found {dialog.count()})')
    page.click('button:has-text("Check out kit")')
    page.wait_for_timeout(1000)
    check('kit out announced', f'Kit out · {REF}' in page.locator('#counter-status').inner_text(),
          page.locator('#counter-status').inner_text())
    detail_state = page.locator('#booking-detail .state-line').inner_text()
    check('booking is out', detail_state.lower() == 'out', detail_state)

    # Check the kit back in through the app so the shelf recovers for the next run.
    page.wait_for_selector('button:has-text("Start check-in")', timeout=10000)
    page.wait_for_timeout(600)
    page.click('button:has-text("Start check-in")')
    page.wait_for_timeout(600)
    for serial in units:
        scan_field = page.locator('[aria-label="Scan serial"]')
        scan_field.click()
        scan_field.fill(serial)
        page.keyboard.press('Enter')
        page.wait_for_selector(f'[role="group"][aria-label="{serial}"] button:has-text("Check in unit")', timeout=8000)
        page.locator(f'[role="group"][aria-label="{serial}"] button:has-text("Check in unit")').click()
        page.wait_for_timeout(900)
    page.wait_for_timeout(600)
    final_state = page.locator('#booking-detail .state-line').inner_text()
    check('kit returned after check-in', final_state.lower() in ('returned', 'out'), final_state)
    page.close()

    print('== Reduced motion (DP-43)')
    page = browser.new_page(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
    page.goto(f'{BASE}/kits/kestrel-lf', wait_until='networkidle')
    page.fill('#pickup-date', '2026-11-12')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(800)
    page.locator('#return-day').focus()
    for _ in range(4):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(700)
    texts = [page.locator('[aria-label="Hire days"] li').nth(i).inner_text()
             for i in range(page.locator('[aria-label="Hire days"] li').count())]
    check('reduced-motion free band', 'free' in texts, str(texts))
    total = page.locator('[role="status"][aria-label="Hire total"]').inner_text()
    check('reduced-motion total', 'Hire total $2,100.00 for 3 billable days' == total, total)
    page.close()

    browser.close()

print()
if failures:
    print(f'{len(failures)} FAILURES:')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('Counter journey passed.')
