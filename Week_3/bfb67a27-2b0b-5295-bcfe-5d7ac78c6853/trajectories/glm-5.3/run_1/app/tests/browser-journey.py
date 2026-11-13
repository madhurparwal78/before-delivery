"""Full browser journey: hold -> certificate -> confirm, plus the day-strip fold."""
import datetime
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
# A unique pickup date per run keeps the test independent of earlier bookings.
PICKUP = (datetime.date(2027, 3, 1) + datetime.timedelta(days=datetime.datetime.now().second)).isoformat()
failures = []


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'  [{mark}] {name} {detail}')
    if not ok:
        failures.append(f'{name} {detail}')


with sync_playwright() as p:
    browser = p.chromium.launch()

    print('== Day strip fold (DP-03)')
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '/kits/kestrel-lf', wait_until='networkidle')
    page.fill('#pickup-date', '2026-11-12')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(800)
    cells = page.locator('[aria-label="Hire days"] li')
    count = cells.count()
    texts = [cells.nth(i).inner_text() for i in range(count)]
    check('billable cells show day+weekday', '1 Thu' in texts, str(texts[:6]))

    # extend to 7 days -> days 4-7 fold into one 'free' band
    page.locator('#return-day').focus()
    for _ in range(4):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(900)
    texts = [page.locator('[aria-label="Hire days"] li').nth(i).inner_text() for i in range(page.locator('[aria-label="Hire days"] li').count())]
    check('free band appears', 'free' in texts, str(texts))
    total = page.locator('[role="status"][aria-label="Hire total"]').inner_text()
    check('7-day total announced', '$2,100.00' in total and '3 billable days' in total, total)

    # Friday pickup collapses to a weekend cell (reset the handle to 3 days first)
    page.locator('#return-day').focus()
    page.keyboard.press('Home')
    for _ in range(2):
        page.keyboard.press('ArrowRight')
    page.fill('#pickup-date', '2026-11-13')
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(900)
    texts = [page.locator('[aria-label="Hire days"] li').nth(i).inner_text() for i in range(page.locator('[aria-label="Hire days"] li').count())]
    check('Friday weekend cell', 'weekend · 1 day' in texts, str(texts[:4]))
    total = page.locator('[role="status"][aria-label="Hire total"]').inner_text()
    check('weekend total 1 billable day', '1 billable day' in total, total)
    page.close()

    print('== Hold journey in the browser (DP-06, DP-09, DP-13)')
    page = browser.new_page(viewport={'width': 375, 'height': 812})
    page.goto(BASE + '/kits/lantern-led', wait_until='networkidle')
    page.fill('#pickup-date', PICKUP)
    page.dispatch_event('#pickup-date', 'change')
    page.wait_for_timeout(700)
    page.fill('#renter-name', 'Per Rider')
    page.fill('#renter-email', 'per@example.test')
    page.click('#hold-button')
    page.wait_for_url('**/bookings/**', timeout=8000)
    check('lands on booking page', '/bookings/' in page.url, page.url)
    check('key in address', 'key=' in page.url)
    ref = page.url.split('/bookings/')[1].split('?')[0]
    page.wait_for_timeout(1000)
    heading = page.locator('#booking-heading-area').inner_text()
    check('held-for-you heading', 'held for you' in heading.lower(), heading.split('\n')[0])
    hold_region = page.locator('#hold-region')
    check('hold countdown shown', hold_region.is_visible())
    countdown = page.locator('#hold-label').inner_text()
    check('countdown text', countdown.startswith('Hold ends in'), countdown)
    check('deposit not taken', 'Not taken' in page.locator('#deposit-label').inner_text())
    check('confirm disabled without certificate', page.locator('#confirm-button').is_disabled())

    print('== Certificate upload (DP-11)')
    import struct, zlib

    def png_bytes():
        sig = b'\x89PNG\r\n\x1a\n'
        def chunk(t, d):
            c = t + d
            return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
        idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
        iend = chunk(b'IEND', b'')
        return sig + ihdr + idat + iend

    pdf = b'%PDF-1.4\nBrowser journey certificate\n%EOF'
    with open('/tmp/browser-cert.pdf', 'wb') as fh:
        fh.write(pdf)
    page.set_input_files('#certificate-file', '/tmp/browser-cert.pdf')
    page.click('text=Send certificate')
    page.wait_for_timeout(1200)
    cert_status = page.locator('#certificate-status').inner_text()
    check('certificate under review', 'Certificate under review' in cert_status or 'received' in cert_status, cert_status)

    print('== Owner approves (DP-12)')
    owner = browser.new_page(viewport={'width': 1280, 'height': 800})
    owner.goto(BASE + '/desk', wait_until='networkidle')
    owner.fill('#passcode', 'northbar-owner-4417')
    owner.click('button[type="submit"]')
    owner.wait_for_url('**/desk/owner', timeout=5000)
    owner.wait_for_timeout(1500)
    review_button = owner.locator(f'button:has-text("Review {ref}")')
    check('certificate in owner queue', review_button.count() == 1, f'({review_button.count()} for {ref})')
    if review_button.count() == 1:
        review_button.click()
        owner.wait_for_timeout(400)
        dialog = owner.locator('dialog[open]')
        check('review dialog opens', dialog.count() == 1)
        owner.locator('[aria-label="Cover starts"]').fill('2026-12-01')
        owner.locator('[aria-label="Cover ends"]').fill('2026-12-31')
        owner.locator('[aria-label="Limit"]').fill('90000')
        owner.locator('label:has-text("loss payee")').click()
        owner.click('button:has-text("Approve")')
        owner.wait_for_timeout(800)
        status = owner.locator('#desk-status').inner_text()
        check('approval announced', f'Certificate for {ref} approved' in status, status)
    owner.close()

    print('== Confirm and pay (DP-13, DP-14)')
    page.bring_to_front()
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(1000)
    check('confirm enabled after approval', not page.locator('#confirm-button').is_disabled())
    page.click('#confirm-button')
    page.wait_for_timeout(4000)
    heading = page.locator('#booking-heading-area').inner_text()
    check('you-re-booked heading', "you're booked" in heading.lower(), heading.split('\n')[0])
    deposit = page.locator('#deposit-label').inner_text()
    check('deposit paid', 'Paid' in deposit, deposit)
    page.close()

    print('== Confirmation mail arrived (DP-16)')
    import urllib.request, json as js
    with urllib.request.urlopen('http://mailpit:8025/api/v1/messages') as r:
        messages = js.loads(r.read())['messages']
    subject = f'Booking confirmed · {ref} · Lantern 4-Light LED Package'
    match = [m for m in messages if m['Subject'] == subject]
    check('exactly one confirmation mail', len(match) == 1, f'({len(match)})')

    browser.close()

print()
if failures:
    print(f'{len(failures)} FAILURES:')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('Full journey passed.')
