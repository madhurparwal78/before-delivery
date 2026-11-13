"""Remaining spec edges: cross-origin, share-link withdrawal, the new link,
DP-62 newest estimate, awaiting-notice copies, DP-14 counts, DP-19 imports,
plus a few error-precedence checks."""
import json, urllib.request, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from journey import req, sign_in, start_claim, get_confirm_token, BASE

def test_cross_origin():
    print('--- cross-origin ---')
    # A state-changing request whose Origin names another origin: 403.
    s, h, b = req('POST', '/api/claims/confirm', {'token': 'x' * 40}, headers={'Origin': 'http://evil.example'})
    assert s == 403, f'cross-origin: {s} {b[:200]}'
    assert json.loads(b)['error']['code'] == 'cross_origin', b[:200]
    print('cross-origin POST refused with 403')
    # Same-origin requests still work.
    s, h, b = req('GET', '/api/health')
    assert s == 200
    print('same-origin requests unaffected')

def test_share_link_withdraw_and_new():
    print('--- share link withdrawal and replacement ---')
    auth = sign_in()
    claim = start_claim(email='link.swap@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    share_token = json.loads(b)['share_url'].split('/s/')[1]
    # The share link answers while active.
    s, h, b = req('GET', f'/api/share/{share_token}')
    assert s == 200, f'active share: {s}'
    # Withdraw it: the next request answers 410 link_withdrawn.
    s, h, b = req('DELETE', f'/api/ops/claims/{reference}/share-link', headers=auth)
    assert s == 204, f'withdraw: {s} {b[:200]}'
    s, h, b = req('GET', f'/api/share/{share_token}')
    assert s == 410, f'withdrawn share: {s} {b[:200]}'
    assert json.loads(b)['error']['code'] == 'link_withdrawn', b[:200]
    print('withdraw: 204, then the token answers 410 link_withdrawn')
    # A new link replaces the old one; the new one works.
    s, h, b = req('POST', f'/api/ops/claims/{reference}/share-link', {}, headers=auth)
    assert s == 201, f'new link: {s} {b[:200]}'
    view = json.loads(b)
    new_share = view['share_link']['url'].split('/s/')[1]
    assert new_share != share_token
    s, h, b = req('GET', f'/api/share/{new_share}')
    assert s == 200, f'new share: {s}'
    s, h, b = req('GET', f'/api/share/{share_token}')
    assert s == 410, f'old share after replacement: {s}'
    print('new link created; the old token no longer works')
    # The new-link notice reaches the owner once.
    time.sleep(12)
    mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=30'))
    subjects = [m['Subject'] for m in mp['messages'] if 'link.swap@example.org' in str(m['To'])]
    assert any(s == f'New link for claim {reference}' for s in subjects), subjects
    assert subjects.count(f'New link for claim {reference}') == 1, subjects
    print('new-link notice sent exactly once')

def test_awaiting_notices_surface():
    print('--- awaiting notices ---')
    # Copy with mail down queues a notice; the claim view counts it.
    sys.path.insert(0, os.path.dirname(__file__))
    import subprocess
    env = dict(os.environ)
    env.update({'APP_PUBLIC_PORT': '4399', 'SMTP_HOST': 'nothing', 'MAILPIT_URL': 'http://nothing:8025'})
    proc = subprocess.Popen(['node', 'dist/server.js'], cwd='/app', env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen('http://127.0.0.1:4399/api/health', timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        r = urllib.request.Request('http://127.0.0.1:4399/api/ops/session', method='POST')
        r.add_header('Content-Type', 'application/json')
        r.data = json.dumps({'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'}).encode()
        resp = urllib.request.urlopen(r, timeout=10)
        cookie = resp.headers.get('Set-Cookie', '').split(';')[0]
        claim = start_claim(email='await.notice@example.org')
        reference = claim['reference']
        import psycopg2
        conn = psycopg2.connect('postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev')
        cur = conn.cursor()
        cur.execute(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")
        token = cur.fetchone()[0]
        conn.close()
        r = urllib.request.Request('http://127.0.0.1:4399/api/claims/confirm', method='POST')
        r.add_header('Content-Type', 'application/json')
        r.data = json.dumps({'token': token}).encode()
        urllib.request.urlopen(r, timeout=10)
        r = urllib.request.Request(f'http://127.0.0.1:4399/api/ops/claims/{reference}/identify', method='POST')
        r.add_header('Content-Type', 'application/json')
        r.add_header('Cookie', cookie)
        r.data = json.dumps({'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}).encode()
        urllib.request.urlopen(r, timeout=10)
        r = urllib.request.Request(f'http://127.0.0.1:4399/api/ops/claims/{reference}/quote', method='POST')
        r.add_header('Content-Type', 'application/json')
        r.add_header('Cookie', cookie)
        r.add_header('Idempotency-Key', 'await-notice-q')
        r.data = b'{}'
        resp = urllib.request.urlopen(r, timeout=30)
        view = json.loads(resp.read())
        assert view['notices_pending'] == 1, view
        print('claim view counts 1 waiting notice')
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

def test_decided_counts():
    print('--- decided claims count ---')
    auth = sign_in()
    s, h, b = req('GET', '/api/ops/stats', headers=auth)
    before = json.loads(b)
    # A new identification raises the count by one and never falls.
    claim = start_claim(email='count.one@example.org', purchase='2026-01-01')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    req('POST', '/api/claims/confirm', {'token': token})
    req('POST', f'/api/ops/claims/{reference}/identify',
        {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
    s, h, b = req('GET', '/api/ops/stats', headers=auth)
    after = json.loads(b)
    assert after['decided_claims'] == before['decided_claims'] + 1, (before, after)
    assert after['decided_inside'] + after['decided_outside'] == after['decided_claims'], after
    print('decided count rises by one; inside + outside = total:', after)
    # Erasure does not change the counts.
    req('POST', f'/api/ops/claims/{reference}/erase', {'confirm_reference': reference}, headers=auth)
    s, h, b = req('GET', '/api/ops/stats', headers=auth)
    erased = json.loads(b)
    assert erased == after, (after, erased)
    print('erasure leaves the decided-claims count unchanged')

def test_model_name_matching_rules():
    print('--- model name matching ---')
    import sys as _sys
    _sys.path.insert(0, '/app/scripts')
    # The rules live in the domain module; exercise them through the import API.
    auth = sign_in()
    stamp = str(int(time.time()))[-6:]
    rows = [
        'ALDRA WARDROBE-AW12,7,40218800,Test pin,1.00,10,20,active',   # code suffix removed
        'Kestle Shelving Unit / ks05,3,101345,Shelf pin,0.15,3,16,active',  # slash + code
        'holm classic,1,40218831,Side panel,48.00,14200,1990,active',  # ambiguous (lowercase)
        'Bramwell Sofa Frame,2,503319,Seat slat,6.90,700,760,active',   # exact name
    ]
    csv = 'model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status\r\n'
    csv += '\r\n'.join(rows) + '\r\n'
    s, h, b = req('POST', '/api/ops/imports', raw=csv.encode(), headers={**auth, 'Content-Type': 'text/csv'})
    result = json.loads(b)
    # Row 2 (Kestle pin, identical) is unchanged; row 3 ambiguous; rows 1 and 4 valid.
    reasons = {u['line']: u['reason'] for u in result['unmatched']}
    # Data lines are 2..5; the ambiguous 'holm classic' is line 4.
    assert reasons.get(4) == 'ambiguous_model', reasons
    assert 2 not in reasons and 3 not in reasons and 5 not in reasons, reasons
    print('code suffix and slash forms matched; lowercase retired name ambiguous')

def test_error_precedence():
    print('--- error precedence ---')
    auth = sign_in()
    # 415 wrong content type on a JSON endpoint.
    s, h, b = req('POST', '/api/claims/lookup', None, headers={**auth, 'Content-Type': 'text/plain'})
    assert s == 415, f'wrong type: {s}'
    # 405 read_only on the share path.
    s, h, b = req('POST', '/api/share/some-token-value', {})
    assert s == 405, f'share write: {s} {b[:200]}'
    assert json.loads(b)['error']['code'] == 'read_only', b[:200]
    # 401 for operator endpoints without a session.
    s, h, b = req('GET', '/api/ops/stats')
    assert s == 401, f'no session: {s}'
    # 422 with the published message.
    s, h, b = req('POST', '/api/claims/lookup', {'reference': ''})
    assert s == 422 and json.loads(b)['error']['message'] == 'Some fields need attention.', (s, b[:200])
    print('precedence OK: 415, 405 read_only, 401, 422 message')

if __name__ == '__main__':
    test_cross_origin()
    test_share_link_withdraw_and_new()
    test_awaiting_notices_surface()
    test_decided_counts()
    test_model_name_matching_rules()
    test_error_precedence()
    print('\nREMAINING EDGES PASSED')
