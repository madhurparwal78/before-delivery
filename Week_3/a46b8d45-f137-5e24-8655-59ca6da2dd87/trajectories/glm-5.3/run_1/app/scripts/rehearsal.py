"""Rehearsal-copy settings: frozen clocks, TTL edges, zero settings.

Each copy runs with its own environment, sharing the main database.
"""
import subprocess, time, json, urllib.request, os, signal, sys
sys.path.insert(0, os.path.dirname(__file__))

PORT = 4299

def start_copy(env_overrides):
    env = dict(os.environ)
    env.update({
        'APP_PUBLIC_PORT': str(PORT),
        'APP_PUBLIC_URL': f'http://127.0.0.1:{PORT}',
    })
    env.update(env_overrides)
    proc = subprocess.Popen(
        ['node', 'dist/server.js'],
        cwd='/app',
        env=env,
        stdout=open('/tmp/copy.log', 'a'),
        stderr=subprocess.STDOUT,
    )
    # wait for health
    for _ in range(40):
        try:
            r = urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/health', timeout=1)
            if r.status == 200:
                return proc
        except Exception:
            pass
        time.sleep(0.25)
    proc.kill()
    raise RuntimeError('copy did not become healthy')

def stop_copy(proc):
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    time.sleep(1.0)

def req(method, path, data=None, headers=None, raw=None):
    r = urllib.request.Request(f'http://127.0.0.1:{PORT}' + path, method=method)
    if headers:
        for k, v in headers.items(): r.add_header(k, v)
    if raw is not None:
        r.data = raw
    elif data is not None:
        r.add_header('Content-Type', 'application/json')
        r.data = json.dumps(data).encode()
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

def sign_in():
    s, h, b = req('POST', '/api/ops/session', {'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'})
    assert s == 204, f'sign-in: {s} {b}'
    return {'Cookie': h.get('Set-Cookie', '').split(';')[0]}

def start_claim(model='kestle-shelving-unit', booklet=3, quantity=10, email='clock.test@example.org',
                purchase='2024-07-15', postcode='n1 9gu', language='en-GB'):
    import uuid
    boundary = '----B' + uuid.uuid4().hex
    def field(name, value):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    def filepart(name, filename, content):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + b'\r\n'
    png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
    body = b''
    for k, v in [('name', 'Clock Test'), ('email', email), ('postcode', postcode),
                 ('model', model), ('booklet_number', str(booklet)), ('quantity', str(quantity)),
                 ('purchase_date', purchase), ('description', 'x'), ('language', language)]:
        body += field(k, v)
    body += filepart('photos', 'p.png', png)
    body += f'--{boundary}--\r\n'.encode()
    s, h, b = req('POST', '/api/claims', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    assert s == 201, f'claim start: {s} {b[:300]}'
    return json.loads(b)

def read_postgres(query):
    import psycopg2
    conn = psycopg2.connect('postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev')
    cur = conn.cursor()
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return rows

def test_london_edge(settings, purchase, expect_inside, label):
    """On london-edge (2026-07-14T23:00:00Z = 00:00 BST 15 July), AC-2026 decides."""
    proc = start_copy(settings)
    try:
        auth = sign_in()
        claim = start_claim(email=f'{label}@example.org', purchase=purchase)
        reference = claim['reference']
        # confirm
        s, h, b = req('GET', f'/api/claims/{reference}/confirmation')
        info = json.loads(b)
        assert info['link_state'] == 'live'
        # pull the token from Postgres (Mailpit holds it too, but direct is faster)
        rows = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")
        token = rows[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200, f'confirm on {label}: {s} {b[:200]}'
        # identify and check the ruling
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 10}, headers=auth)
        assert s == 200, f'identify on {label}: {s} {b[:300]}'
        view = json.loads(b)
        ruling = view['ruling']
        print(f'[{label}] edition={ruling["edition"]} inside={ruling["inside"]} '
              f'cover={ruling["cover_ends_on"]} term={ruling["term_months"]}')
        expected_edition = 'AC-2025' if label == 'london-edge-before' else 'AC-2026'
        assert ruling['edition'] == expected_edition, ruling
        assert ruling['inside'] == expect_inside, f'{label}: expected inside={expect_inside}, got {ruling["inside"]}'
    finally:
        stop_copy(proc)

def test_dispatch_promise(settings, label, expect_kind, expect_date):
    proc = start_copy(settings)
    try:
        auth = sign_in()
        claim = start_claim(email=f'{label}@example.org', purchase='2024-01-01')
        reference = claim['reference']
        rows = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")
        s, h, b = req('POST', '/api/claims/confirm', {'token': rows[0][0]})
        assert s == 200, f'confirm: {s}'
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 10}, headers=auth)
        assert s == 200, f'identify: {s} {b[:200]}'
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': f'k-{label}'})
        assert s == 200, f'quote on {label}: {s} {b[:300]}'
        quote = json.loads(b)['quotes'][0]
        print(f'[{label}] promise={quote["promise"]}')
        assert quote['promise']['kind'] == expect_kind, quote['promise']
        assert quote['promise']['date'] == expect_date, quote['promise']
    finally:
        stop_copy(proc)

def test_ttl_one():
    """CONFIRM_LINK_TTL_SECONDS=1 with the clock frozen: the link lives for one second."""
    proc = start_copy({'DESK_CLOCK_FROZEN_AT': '2026-07-15T09:00:00Z', 'CONFIRM_LINK_TTL_SECONDS': '1'})
    try:
        claim = start_claim(email='ttl.one@example.org', purchase='2024-01-01')
        reference = claim['reference']
        assert claim['confirm_by'] == '2026-07-15T09:00:01.000Z', claim['confirm_by']
        print('[ttl-one] confirm_by:', claim['confirm_by'])
        # sent page line names 10:00 on 15 July 2026 (BST)
        rows = read_postgres(f"SELECT confirm_by FROM claims WHERE reference = '{reference}'")
        print('[ttl-one] stored confirm_by:', rows[0][0])
        # confirming at the frozen instant (one second before closing) succeeds
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200, f'confirm: {s} {b[:200]}'
        print('[ttl-one] confirm at frozen instant OK')
    finally:
        stop_copy(proc)

def test_zero_ttl():
    """CONFIRM_LINK_TTL_SECONDS=0: every new link is lapsed at its own start instant;
    claim start still answers 201 and sends the email."""
    proc = start_copy({'CONFIRM_LINK_TTL_SECONDS': '0'})
    try:
        claim = start_claim(email='zero.ttl@example.org', purchase='2024-01-01')
        reference = claim['reference']
        assert claim['confirm_by'] is not None
        print('[zero-ttl] started, confirm_by:', claim['confirm_by'])
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 410, f'expected 410 lapsed, got {s} {b[:200]}'
        print('[zero-ttl] confirm refused as lapsed OK')
    finally:
        stop_copy(proc)

def test_zero_term():
    """AFTERCARE months 0: the anniversary is the purchase date, so every claim is outside."""
    proc = start_copy({'AFTERCARE_STANDARD_MONTHS': '0', 'AFTERCARE_CLUB_MONTHS': '0'})
    try:
        auth = sign_in()
        claim = start_claim(email='zero.term@example.org', purchase='2026-01-01')
        reference = claim['reference']
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        view = json.loads(b)
        print('[zero-term] ruling:', view['ruling'])
        assert view['ruling']['inside'] is False
        assert view['ruling']['term_months'] == 0
    finally:
        stop_copy(proc)

def test_zero_limits():
    """REFERENCE_LOCK_SECONDS=0, PARTS_RATE_LIMIT_PER_MINUTE=0, TERM override 0, cutoff 00:00."""
    proc = start_copy({
        'REFERENCE_LOCK_SECONDS': '0',
        'PARTS_RATE_LIMIT_PER_MINUTE': '0',
        'AFTERCARE_TERM_SECONDS_OVERRIDE': '0',
        'DISPATCH_CUTOFF_LOCAL': '00:00',
    })
    try:
        # parts list refuses every request with Retry-After: 60
        s, h, b = req('GET', '/api/parts')
        assert s == 429, f'rate 0: expected 429, got {s}'
        assert h.get('Retry-After') == '60', h.get('Retry-After')
        print('[zero-limits] parts refused with Retry-After 60 OK')
        # claim, confirm, identify: term override 0 makes cover end at the start instant -> outside
        auth = sign_in()
        claim = start_claim(email='zero.limits@example.org', purchase='2026-01-01')
        reference = claim['reference']
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        view = json.loads(b)
        print('[zero-limits] ruling:', view['ruling'])
        assert view['ruling']['inside'] is False
        assert view['ruling']['term_months'] is None
        # quote: cutoff 00:00 means no same-day promise
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': 'zl-quote'})
        assert s == 200, f'quote: {s} {b[:200]}'
        quote = json.loads(b)['quotes'][0]
        print('[zero-limits] promise:', quote['promise'])
        assert quote['promise']['kind'] == 'later'
        # find lock zero: the lock ends at the 5th try's own instant
        for i in range(5):
            s, h, b = req('POST', '/api/claims/lookup', {'reference': reference, 'email': 'wrong@example.org'})
            assert s == 404, f'wrong try {i}: {s}'
        # with lock seconds 0 the next lookup is judged normally: right email works
        s, h, b = req('POST', '/api/claims/lookup', {'reference': reference, 'email': 'zero.limits@example.org'})
        assert s == 200, f'lock 0 lookup: {s} {b[:200]}'
        print('[zero-limits] reference lock zero OK')
    finally:
        stop_copy(proc)

def test_short_session():
    """OPERATOR_SESSION_SECONDS=10: sign-in answers 204, later requests 401."""
    proc = start_copy({'OPERATOR_SESSION_SECONDS': '10'})
    try:
        s, h, b = req('POST', '/api/ops/session', {'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'})
        assert s == 204
        cookie = h.get('Set-Cookie', '').split(';')[0]
        s, h, b = req('GET', '/api/ops/stats', headers={'Cookie': cookie})
        assert s == 200, f'stats within session: {s}'
        print('[short-session] works while live; waiting for expiry...')
        time.sleep(11)
        s, h, b = req('GET', '/api/ops/stats', headers={'Cookie': cookie})
        assert s == 401, f'expected 401 after expiry, got {s}'
        print('[short-session] 401 after expiry OK')
    finally:
        stop_copy(proc)

if __name__ == '__main__':
    # london-edge: 00:00 BST 15 July 2026 — AC-2026 decides.
    # A 24-month purchase dated 2024-07-15 is outside; 2024-07-16 is inside.
    test_london_edge({'DESK_CLOCK_FROZEN_AT': '2026-07-14T23:00:00Z'}, '2024-07-15', False, 'london-edge')
    test_london_edge({'DESK_CLOCK_FROZEN_AT': '2026-07-14T23:00:00Z'}, '2024-07-16', True, 'london-edge-inside')
    # london-edge-before: AC-2025 decides, and the 2024-07-15 purchase is inside.
    test_london_edge({'DESK_CLOCK_FROZEN_AT': '2026-07-14T22:59:59Z'}, '2024-07-15', True, 'london-edge-before')
    # Dispatch cut-off: before 14:00 same day; at/after, the next working day.
    test_dispatch_promise({'DESK_CLOCK_FROZEN_AT': '2026-07-15T12:59:59Z'}, 'before-cutoff', 'same_day', '2026-07-15')
    test_dispatch_promise({'DESK_CLOCK_FROZEN_AT': '2026-07-15T13:00:00Z'}, 'after-cutoff', 'later', '2026-07-16')
    test_ttl_one()
    test_zero_ttl()
    test_zero_term()
    test_zero_limits()
    test_short_session()
    print('\nREHEARSAL COPIES PASSED')
