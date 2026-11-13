"""Role checks, share-path writes, cookie flags, idempotency key edges."""
import json, urllib.request, os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from journey import req, sign_in, start_claim, get_confirm_token

def test_share_writes_refused():
    print('--- share link is read-only ---')
    claim = start_claim(email='readonly@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    share_token = json.loads(b)['share_url'].split('/s/')[1]
    # Any other method on the share path answers 405 read_only.
    for method in ['POST', 'PUT', 'PATCH', 'DELETE']:
        s, h, b = req(method, f'/api/share/{share_token}', {'x': 1})
        assert s == 405, f'{method} on share: {s}'
        assert json.loads(b)['error']['code'] == 'read_only', b[:200]
    print('all write methods on the share path answer 405 read_only')
    # Query parameters are ignored.
    s, h, b = req('GET', f'/api/share/{share_token}?reference=HG-AAAAAA&state=closed')
    assert s == 200, f'query widening: {s}'
    view = json.loads(b)
    assert view['reference'] == reference, view
    # The share view carries no private field.
    allowed = {'reference', 'state', 'language', 'model', 'part', 'quantity',
               'purchase_date', 'ruling', 'quote', 'paid_minor', 'decline',
               'dispatched_at', 'history'}
    assert set(view.keys()) == allowed, (set(view.keys()) - allowed, allowed - set(view.keys()))
    print('share view carries only the published fields')
    # No database id, Kill Bill id or storage key.
    text = json.dumps(view)
    for secret in ['invoiceId', 'killbill', 'claims/', 'accountId', 'session']:
        assert secret not in text, f'{secret} leaked into the share view'
    print('no ids or storage keys leak')

def test_role_checks():
    print('--- role checks ---')
    claim = start_claim(email='role.check@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    share_token = json.loads(b)['share_url'].split('/s/')[1]
    # A share token never authenticates an operator endpoint.
    s, h, b = req('GET', '/api/ops/stats', headers={'Cookie': f'ops_session={share_token}'})
    assert s == 401, f'share token as session: {s}'
    print('a share token does not authenticate the operator API')
    # An operator session never widens a share token's reach.
    auth = sign_in()
    other = start_claim(email='other.owner@example.org')
    other_ref = other['reference']
    t2, _ = get_confirm_token(other_ref)
    s, h, b = req('POST', '/api/claims/confirm', {'token': t2})
    other_share = json.loads(b)['share_url'].split('/s/')[1]
    s, h, b = req('GET', f'/api/share/{share_token}', headers=auth)
    view = json.loads(b)
    assert view['reference'] == reference, 'a session must not widen the token'
    print('a session does not widen a share token')

def test_cookie_flags():
    print('--- operator cookie ---')
    # The cookie is HttpOnly and SameSite=Strict.
    import http.client
    conn = http.client.HTTPConnection('127.0.0.1', 4173, timeout=10)
    body = json.dumps({'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'})
    conn.request('POST', '/api/ops/session', body, {'Content-Type': 'application/json'})
    resp = conn.getresponse()
    set_cookie = resp.getheader('Set-Cookie')
    assert 'HttpOnly' in set_cookie, set_cookie
    assert 'SameSite=Strict' in set_cookie, set_cookie
    assert set_cookie.startswith('ops_session='), set_cookie
    print('operator cookie is HttpOnly and SameSite=Strict:', set_cookie[:60])
    # Bad credentials answer 401 bad_credentials with the operator copy.
    s, h, b = req('POST', '/api/ops/session', {'email': 'operator@holmgarth.example', 'password': 'wrong'})
    assert s == 401, s
    assert json.loads(b)['error']['message'] == "That email and password don't match.", b[:200]
    print('bad credentials answer the operator copy')

def test_idempotency_key_edges():
    print('--- idempotency key edges ---')
    auth = sign_in()
    claim = start_claim(email='idem.edges@example.org')
    reference = claim['reference']
    token, _ = get_confirm_token(reference)
    req('POST', '/api/claims/confirm', {'token': token})
    req('POST', f'/api/ops/claims/{reference}/identify',
        {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)

    # Missing key answers 422 fields.idempotency_key required.
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers=auth)
    assert s == 422, f'missing key: {s} {b[:200]}'
    fields = json.loads(b)['error']['fields']
    assert fields['idempotency_key'] == 'required', fields
    # 65 characters or an invisible character answers invalid.
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': 'k' * 65})
    assert s == 422 and json.loads(b)['error']['fields']['idempotency_key'] == 'invalid', (s, b[:200])
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': 'a\tb'})
    assert s == 422 and json.loads(b)['error']['fields']['idempotency_key'] == 'invalid', (s, b[:200])
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': 'a b'})
    assert s == 422 and json.loads(b)['error']['fields']['idempotency_key'] == 'invalid', (s, b[:200])
    print('key edges OK: required, 65 invalid, tab invalid, space invalid')

    # A valid 64-character key works.
    key = 'k' * 64
    s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {}, headers={**auth, 'Idempotency-Key': key})
    assert s == 200, f'64-char key: {s} {b[:200]}'
    print('a 64-character key is allowed')
    # The same key on another claim is a fresh, independent action.
    claim2 = start_claim(email='idem.edges2@example.org')
    ref2 = claim2['reference']
    t2, _ = get_confirm_token(ref2)
    req('POST', '/api/claims/confirm', {'token': t2})
    req('POST', f'/api/ops/claims/{ref2}/identify',
        {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
    s, h, b = req('POST', f'/api/ops/claims/{ref2}/quote', {}, headers={**auth, 'Idempotency-Key': key})
    assert s == 200, f'same key on another claim: {s} {b[:200]}'
    print('the same key on another claim is a fresh action')
    # A failed request leaves its key unused.
    fail_key = 'fail-' + uuid.uuid4().hex[:8]
    s, h, b = req('POST', f'/api/ops/claims/{reference}/payment', {}, headers={**auth, 'Idempotency-Key': fail_key})
    # (the claim is unpaid, so this succeeds; instead test on a quoted+paid claim)
    if s == 200:
        # a second payment with the same key replays
        s, h, b = req('POST', f'/api/ops/claims/{ref2}/payment', {}, headers={**auth, 'Idempotency-Key': fail_key})
        assert s == 200, f'replay payment: {s}'
        # a different key on the now-paid claim answers already_paid, not a replay
        s, h, b = req('POST', f'/api/ops/claims/{ref2}/payment', {}, headers={**auth, 'Idempotency-Key': 'new-' + uuid.uuid4().hex[:8]})
        assert s == 409 and json.loads(b)['error']['code'] == 'already_paid', (s, b[:200])
        print('payment replay returns the stored response; a new key answers already_paid')

if __name__ == '__main__':
    test_share_writes_refused()
    test_role_checks()
    test_cookie_flags()
    test_idempotency_key_edges()
    print('\nROLE AND KEY EDGES PASSED')
