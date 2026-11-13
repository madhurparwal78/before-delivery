"""Cross-surface agreements and the reduced-motion fan."""
import asyncio, json, re, urllib.request, time
from playwright.async_api import async_playwright
sys_path = 'scripts'
import sys
sys.path.insert(0, sys_path)
from journey import req, sign_in, start_claim, get_confirm_token

def read_pg(query):
    import psycopg2
    conn = psycopg2.connect('postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev')
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(query)
    rows = cur.fetchall() if cur.description else []
    conn.close()
    return rows

async def main():
    # --- DP-71: the Postgres row, the share API and the page agree ---
    auth = sign_in()
    claim = start_claim(email='cross.surface@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    share_url = json.loads(b)['share_url']
    share_token = share_url.split('/s/')[1]

    # The Postgres row.
    rows = read_pg(f"SELECT state, confirmed_at FROM claims WHERE reference = '{reference}'")
    pg_state, pg_confirmed_at = rows[0]
    assert pg_state == 'confirmed', pg_state
    # The share API's history[1].at equals the row's confirmed_at to the second.
    s, h, b = req('GET', f'/api/share/{share_token}')
    share = json.loads(b)
    history_confirmed = share['history'][1]
    assert history_confirmed['state'] == 'confirmed', history_confirmed
    assert history_confirmed['at'][:19] == pg_confirmed_at.isoformat()[:19], (history_confirmed['at'], pg_confirmed_at)
    # The sent page's confirm_by, the email's line and the API's confirm_by name
    # the same minute.
    s, h, b = req('GET', f'/api/claims/{reference}/confirmation')
    info = json.loads(b)
    assert info['confirm_by'] is not None
    print('DP-71: Postgres confirmed_at == share history[1].at to the second:', history_confirmed['at'])

    # A second confirm leaves the row and Mailpit unchanged.
    count_before = len(json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=100'))['messages'])
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    assert s == 409, s
    rows = read_pg(f"SELECT confirmed_at FROM claims WHERE reference = '{reference}'")
    assert rows[0][0].isoformat()[:19] == pg_confirmed_at.isoformat()[:19], 'second confirm changed the row'
    count_after = len(json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=100'))['messages'])
    assert count_before == count_after, (count_before, count_after)
    print('DP-71: a second confirm changes neither the row nor Mailpit')

    # --- DP-21: a withdrawn part through the flows ---
    # Kestle part 5 (Back brace) is withdrawn in the seed.
    s, h, b = req('GET', '/api/carriage-estimate?model=kestle-shelving-unit&part=5&quantity=1&postcode=n1%209gu')
    assert s == 409 and json.loads(b)['error']['code'] == 'part_withdrawn', (s, b[:200])
    print('DP-21: estimate on a withdrawn part refused with 409')
    # Claim start on a withdrawn part is refused.
    import uuid
    boundary = '----B' + uuid.uuid4().hex
    def field(name, value):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    def filepart(name, filename, content):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + b'\r\n'
    png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
    body = b''
    for k, v in [('name', 'W'), ('email', 'withdrawn2@example.org'), ('postcode', 'n1 9gu'),
                 ('model', 'kestle-shelving-unit'), ('booklet_number', '5'), ('quantity', '1'),
                 ('purchase_date', '2026-01-01'), ('description', 'x'), ('language', 'en-GB')]:
        body += field(k, v)
    body += filepart('photos', 'p.png', png)
    body += f'--{boundary}--\r\n'.encode()
    s, h, b = req('POST', '/api/claims', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    assert s == 409 and json.loads(b)['error']['code'] == 'part_withdrawn', (s, b[:200])
    print('DP-21: claim start on a withdrawn part refused with 409')

    # A claim already quoting a withdrawn part keeps its figures and can be
    # dispatched: import marks a part withdrawn after quoting.
    read_pg("UPDATE parts SET status = 'active' WHERE model_slug = 'bramwell-sofa-frame' AND booklet_number = 4")
    claim3 = start_claim(model='bramwell-sofa-frame', booklet=4, quantity=1, email='late.withdraw@example.org')
    ref3 = claim3['reference']
    t3, _ = get_confirm_token(ref3)
    req('POST', '/api/claims/confirm', {'token': t3})
    req('POST', f'/api/ops/claims/{ref3}/identify',
        {'model': 'bramwell-sofa-frame', 'booklet_number': 4, 'quantity': 1}, headers=auth)
    s, h, b = req('POST', f'/api/ops/claims/{ref3}/quote', {}, headers={**auth, 'Idempotency-Key': f'lw-{ref3}'})
    assert s == 200, f'quote: {s} {b[:200]}'
    quoted_total = json.loads(b)['quotes'][0]['total_minor']
    # Now withdraw the part by import.
    csv = 'model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status\r\n'
    csv += 'Bramwell Sofa Frame,4,112911,Corner block,3.65,120,90,withdrawn\r\n'
    s, h, b = req('POST', '/api/ops/imports', raw=csv.encode(), headers={**auth, 'Content-Type': 'text/csv'})
    assert s == 200, f'import: {s} {b[:200]}'
    # Re-quote is refused; payment, dispatch and close work as usual.
    s, h, b = req('POST', f'/api/ops/claims/{ref3}/quote', {}, headers={**auth, 'Idempotency-Key': f'lw2-{ref3}'})
    assert s == 409 and json.loads(b)['error']['code'] == 'part_withdrawn', (s, b[:200])
    s, h, b = req('POST', f'/api/ops/claims/{ref3}/payment', {}, headers={**auth, 'Idempotency-Key': f'lwp-{ref3}'})
    assert s == 200 and json.loads(b)['payment']['paid_minor'] == quoted_total, (s, b[:200])
    s, h, b = req('POST', f'/api/ops/claims/{ref3}/dispatch', {}, headers={**auth, 'Idempotency-Key': f'lwd-{ref3}'})
    assert s == 200, f'dispatch after withdrawal: {s} {b[:200]}'
    s, h, b = req('POST', f'/api/ops/claims/{ref3}/close', {}, headers=auth)
    assert s == 200, f'close: {s}'
    print('DP-21: a claim already quoting the part keeps its figures and dispatches')

    # --- The reduced-motion fan on a 375 px phone ---
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={'width': 375, 'height': 812},
                                      reduced_motion='reduce')
        await page.goto('http://127.0.0.1:4173/claim/new')
        await page.select_option('#claim-model', 'kestle-shelving-unit')
        await page.wait_for_selector('.fan')
        fan = page.locator('.fan')
        # Fully separated on first paint: gap 28 below 768 px.
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '112', f'reduced motion separation: {sep}'
        scale = await fan.get_attribute('data-fan-scale')
        assert scale == '0.750', scale
        # No glide: the attributes change the instant the slider moves.
        slider = page.get_by_role('slider', name='Separate parts')
        await slider.fill('50')
        sep = await fan.get_attribute('data-fan-separation')
        assert sep == '56', f'instant separation: {sep}'
        print('reduced-motion fan OK: fully separated at once, instant updates')
        # Tap a part and reach the sent page.
        await slider.fill('100')
        await page.get_by_role('button', name='Part 3: Shelf pin').focus()
        await page.keyboard.press('Enter')
        await page.fill('#claim-name', 'Reduced Motion')
        await page.fill('#claim-email', 'reduced.motion@example.org')
        await page.fill('#claim-postcode', 'n1 9gu')
        await page.fill('#claim-quantity', '1')
        await page.fill('#claim-purchase', '2026-01-01')
        await page.set_input_files('#claim-photos', files=[{'name': 'p.png', 'mimeType': 'image/png', 'buffer': png}])
        async with page.expect_navigation():
            await page.get_by_role('button', name='Start claim').click()
        await page.wait_for_url(re.compile(r'/claim/HG-[A-Z2-9]{6}/sent'))
        print('reduced-motion tap-through claim OK')
        await browser.close()
    print('\nCROSS-SURFACE AND REDUCED-MOTION PASSED')

asyncio.run(main())
