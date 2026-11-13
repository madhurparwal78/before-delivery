"""End-to-end journey driver against the live services."""
import urllib.request, json, uuid, time, sys

BASE = 'http://127.0.0.1:4173'
MAILPIT = 'http://mailpit:8025'

def req(method, path, data=None, headers=None, raw=None):
    r = urllib.request.Request(BASE + path, method=method)
    if headers:
        for k, v in headers.items():
            r.add_header(k, v)
    if raw is not None:
        r.data = raw
    elif data is not None:
        r.add_header('Content-Type', 'application/json')
        r.data = json.dumps(data).encode()
    try:
        resp = urllib.request.urlopen(r, timeout=90)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

def sign_in():
    s, h, b = req('POST', '/api/ops/session', {'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'})
    assert s == 204, f'sign in failed: {s} {b}'
    return {'Cookie': h.get('Set-Cookie', '').split(';')[0]}

def start_claim(model='kestle-shelving-unit', booklet=3, quantity=10, email='ines.kowalczyk@example.org',
                purchase='2025-02-11', postcode='ze1 0aa', language='en-GB', name='Ines Kowalczyk'):
    boundary = '----B' + uuid.uuid4().hex
    def field(name, value):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    def filepart(name, filename, content):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + b'\r\n'
    png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
    body = b''
    for k, v in [('name', name), ('email', email), ('postcode', postcode),
                 ('model', model), ('booklet_number', str(booklet)), ('quantity', str(quantity)),
                 ('purchase_date', purchase), ('description', 'Pins lost.'), ('language', language)]:
        body += field(k, v)
    body += filepart('photos', 'pins.png', png)
    body += f'--{boundary}--\r\n'.encode()
    s, h, b = req('POST', '/api/claims', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    assert s == 201, f'claim start failed: {s} {b[:300]}'
    return json.loads(b)

def get_confirm_token(reference):
    time.sleep(1)
    mp = json.load(urllib.request.urlopen(f'{MAILPIT}/api/v1/messages?limit=20'))
    msgs = [m for m in mp['messages'] if reference in m['Subject']]
    assert msgs, 'no confirmation email'
    detail = json.load(urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{msgs[0]['ID']}"))
    line = [l for l in detail['Text'].splitlines() if '/confirm/' in l][0]
    return line.strip().split('/confirm/')[-1], detail

def journey_full():
    auth = sign_in()
    claim = start_claim()
    reference = claim['reference']
    token, email_detail = get_confirm_token(reference)
    print(f'[claim] {reference} confirm_by={claim["confirm_by"]}')
    print(f'[email] subject={email_detail["Subject"]}')

    s, h, b = req('GET', f'/api/claims/{reference}/confirmation')
    print('[confirmation status]', s, b.decode()[:120])

    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    assert s == 200, f'confirm failed: {s} {b}'
    share_url = json.loads(b)['share_url']
    share_token = share_url.split('/s/')[1]
    print('[confirm]', s, share_url)

    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    assert s == 409, f'second confirm should be 409, got {s}'
    print('[second confirm]', s, b.decode()[:80])

    s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                  {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 10}, headers=auth)
    assert s == 200, f'identify failed: {s} {b[:400]}'
    view = json.loads(b)
    print('[identify]', view['state'], 'ruling:', view['ruling'])
    assert view['ruling']['inside'] is True, 'expected inside (club member, 36 months)'

    key = f'quote-{uuid.uuid4().hex[:12]}'
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': key})
    assert s == 200, f'quote failed: {s} {b[:400]}'
    view = json.loads(b)
    quote = view['quotes'][0]
    print('[quote]', quote)
    # Part line: 10 pins at 15p, inside, 25% contribution => 150*25/100 = 37.5 -> 38
    # Carriage ZE: 695. Total 733.
    assert quote['part_line_minor'] == 38, f'part line {quote["part_line_minor"]} != 38'
    assert quote['carriage_minor'] == 695, f'carriage {quote["carriage_minor"]} != 695'
    assert quote['total_minor'] == 733, f'total {quote["total_minor"]} != 733'
    assert quote['source'] == 'bin', 'expected bin source (1000 pins available)'
    print('[quote figures] OK: 38 + 695 = 733')

    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': key})
    assert s == 200, f'replay failed: {s}'
    assert json.loads(b)['quotes'][0]['revision'] == 1, 'replay must return same revision'
    print('[replay] OK same response')

    s, h, b = req('POST', f'/api/ops/claims/{reference}/payment', {}, headers={**auth, 'Idempotency-Key': key})
    assert s == 409, f'conflict expected, got {s}'
    print('[conflict]', s, b.decode()[:80])

    pkey = f'pay-{uuid.uuid4().hex[:12]}'
    s, h, b = req('POST', f'/api/ops/claims/{reference}/payment', {}, headers={**auth, 'Idempotency-Key': pkey})
    assert s == 200, f'payment failed: {s} {b[:300]}'
    view = json.loads(b)
    assert view['payment']['paid_minor'] == 733, f'paid {view["payment"]["paid_minor"]} != 733'
    print('[payment]', view['payment'])

    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': f'q2-{uuid.uuid4().hex[:8]}'})
    assert s == 409, f're-quote after payment expected 409, got {s}'
    print('[re-quote after payment]', s, b.decode()[:90])

    dkey = f'dispatch-{uuid.uuid4().hex[:12]}'
    s, h, b = req('POST', f'/api/ops/claims/{reference}/dispatch', {}, headers={**auth, 'Idempotency-Key': dkey})
    assert s == 200, f'dispatch failed: {s} {b[:300]}'
    view = json.loads(b)
    print('[dispatch]', view['state'], view['dispatched_at'])

    s, h, b = req('GET', f'/api/ops/claims/{reference}/dispatch-note', headers=auth)
    assert s == 200, f'dispatch note failed: {s}'
    note = b.decode()
    for expected in ['Dispatch note', f'Claim {reference}', 'Part 3: Shelf pin', 'Part number 101345',
                     'Part £0.38', 'Carriage, band £6.95', 'Total £7.33', 'Paid £7.33', 'Quantity 10']:
        assert expected in note, f'missing {expected!r} in note'
    print('[dispatch note] OK')

    s, h, b = req('GET', f'/api/share/{share_token}')
    share = json.loads(b)
    assert share['state'] == 'dispatched'
    assert share['quote']['total_minor'] == 733
    assert share['paid_minor'] == 733
    print('[share view] OK')

    s, h, b = req('POST', f'/api/ops/claims/{reference}/close', {}, headers=auth)
    assert s == 200, f'close failed: {s} {b[:200]}'
    print('[close]', json.loads(b)['state'])

    s, h, b = req('GET', f'/api/share/{share_token}')
    assert s == 410, f'expected 410, got {s}'
    print('[share after close]', s, b.decode()[:80])

    time.sleep(12)
    mp = json.load(urllib.request.urlopen(f'{MAILPIT}/api/v1/messages?limit=50'))
    subjects = [m['Subject'] for m in mp['messages'] if 'ines.kowalczyk@example.org' in str(m['To'])]
    print('[mail subjects]', subjects)
    assert any('Quote for claim' in s for s in subjects), 'no quote notice'
    assert any('Part on its way' in s for s in subjects), 'no dispatched notice'
    assert any('is closed' in s for s in subjects), 'no closed notice'
    quoted = [s for s in subjects if s.startswith('Quote for claim')][0]
    assert '£7.33' in quoted, f'quote subject figures wrong: {quoted}'
    print('[notices] OK with money format in subjects')

    s, h, b = req('GET', '/api/ops/stats', headers=auth)
    print('[stats]', b.decode())
    return reference

if __name__ == '__main__':
    journey_full()
    print('\nFULL JOURNEY PASSED')
