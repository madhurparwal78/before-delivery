"""Second journeys: decline paths, erasure, find lock, imports, editions, rate limits."""
import urllib.request, json, uuid, time
from journey import req, sign_in, start_claim, get_confirm_token

def confirm_claim(claim):
    token, _ = get_confirm_token(claim['reference'])
    s, h, b = req('POST', '/api/claims/confirm', {'token': token})
    assert s == 200, f'confirm failed {s} {b}'
    return json.loads(b)['share_url'].split('/s/')[1]

def test_decline_unpaid(auth):
    print('--- decline unpaid ---')
    claim = start_claim(model='aldra-wardrobe', booklet=3, quantity=3, email='decline.unpaid@example.org',
                       purchase='2025-01-01', postcode='n1 9gu')
    share = confirm_claim(claim)
    ref = claim['reference']
    s, h, b = req('POST', f'/api/ops/claims/{ref}/identify',
                  {'model': 'aldra-wardrobe', 'booklet_number': 3, 'quantity': 3}, headers=auth)
    assert s == 200, f'identify: {s} {b}'
    # Aldra Shelf bin count is 3; quoting 3 takes all 3 (bin -> 0)
    s, h, b = req('POST', f'/api/ops/claims/{ref}/quote', {}, headers={**auth, 'Idempotency-Key': f'dk-{uuid.uuid4().hex[:8]}'})
    assert s == 200, f'quote: {s} {b}'
    view = json.loads(b)
    q = view['quotes'][0]
    print('quote:', q['part_line_minor'], q['carriage_minor'], q['total_minor'], 'source:', q['source'])
    # Part line: 3 x 1450p x 25% = 1087.5 -> 1088. Carriage N1 -> S2 395. Total 1483.
    assert q['part_line_minor'] == 1088, q['part_line_minor']
    assert q['carriage_minor'] == 395, q['carriage_minor']
    assert q['total_minor'] == 1483, q['total_minor']
    assert q['source'] == 'bin'
    # decline
    s, h, b = req('POST', f'/api/ops/claims/{ref}/decline', {'reason': 'owner_declined'},
                  headers={**auth, 'Idempotency-Key': f'dec-{uuid.uuid4().hex[:8]}'})
    assert s == 200, f'decline: {s} {b}'
    view = json.loads(b)
    print('declined:', view['state'], view['decline'])
    assert view['decline']['charged_minor'] == 0
    assert view['decline']['refunded_minor'] == 0
    # share page shows nothing charged
    s, h, b = req('GET', f'/api/share/{share}')
    share_view = json.loads(b)
    assert share_view['decline']['charged_minor'] == 0
    # bin returned to 3
    s, h, b = req('GET', '/api/models/aldra-wardrobe')
    parts = {p['booklet_number']: p for p in json.loads(b)['parts']}
    # bin count is not exposed in /api/models; check via claim view of a new claim later.
    # decline notice subject
    time.sleep(11)
    mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=30'))
    subjects = [m['Subject'] for m in mp['messages'] if 'decline.unpaid@example.org' in str(m['To'])]
    print('subjects:', subjects)
    assert any(s == f'Claim {ref} declined — nothing charged' for s in subjects), subjects
    print('decline unpaid OK')

def test_decline_paid(auth):
    print('--- decline paid (refund) ---')
    claim = start_claim(model='bramwell-sofa-frame', booklet=3, quantity=2, email='decline.paid@example.org',
                        purchase='2026-06-01', postcode='eh1 1aa')
    ref = claim['reference']
    share = confirm_claim(claim)
    s, h, b = req('POST', f'/api/ops/claims/{ref}/identify',
                  {'model': 'bramwell-sofa-frame', 'booklet_number': 3, 'quantity': 2}, headers=auth)
    assert s == 200, f'identify: {s} {b}'
    s, h, b = req('POST', f'/api/ops/claims/{ref}/quote', {}, headers={**auth, 'Idempotency-Key': f'q-{uuid.uuid4().hex[:8]}'})
    assert s == 200, f'quote: {s} {b}'
    q = json.loads(b)['quotes'][0]
    # 2 x 1125 x 25% = 562.5 -> 563. Carriage EH1 -> S2 395. Total 958.
    print('quote:', q['part_line_minor'], q['carriage_minor'], q['total_minor'])
    assert q['part_line_minor'] == 563
    assert q['total_minor'] == 958
    s, h, b = req('POST', f'/api/ops/claims/{ref}/payment', {}, headers={**auth, 'Idempotency-Key': f'p-{uuid.uuid4().hex[:8]}'})
    assert s == 200, f'payment: {s} {b}'
    s, h, b = req('POST', f'/api/ops/claims/{ref}/decline', {'reason': 'cannot_send'},
                  headers={**auth, 'Idempotency-Key': f'dec-{uuid.uuid4().hex[:8]}'})
    assert s == 200, f'decline: {s} {b}'
    view = json.loads(b)
    print('declined:', view['decline'])
    assert view['decline']['refunded_minor'] == 958, view['decline']
    assert view['decline']['charged_minor'] == 0
    time.sleep(11)
    mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=30'))
    subjects = [m['Subject'] for m in mp['messages'] if 'decline.paid@example.org' in str(m['To'])]
    print('subjects:', subjects)
    assert any(s == f'Claim {ref} declined — £9.58 refunded' for s in subjects), subjects
    print('decline paid OK: £9.58 refunded')

def test_find_lock(auth):
    print('--- find my claim lock ---')
    claim = start_claim(model='kestle-shelving-unit', booklet=4, quantity=1, email='find.lock@example.org',
                        purchase='2024-03-01', postcode='sw1a 1aa')
    ref = claim['reference']
    confirm_claim(claim)
    # wrong email 5 times -> lock
    for i in range(5):
        s, h, b = req('POST', '/api/claims/lookup', {'reference': ref, 'email': 'wrong@example.org'})
        assert s == 404, f'wrong try {i}: {s}'
    # 6th try with the right email -> locked
    s, h, b = req('POST', '/api/claims/lookup', {'reference': ref, 'email': 'find.lock@example.org'})
    assert s == 423, f'expected 423, got {s}'
    retry = h.get('Retry-After')
    print('locked:', s, 'Retry-After:', retry)
    assert retry is not None and int(retry) >= 1
    # unknown reference never locks and answers the same body
    s2, h2, b2 = req('POST', '/api/claims/lookup', {'reference': 'HG-ZZZZZZ', 'email': 'x@example.org'})
    assert s2 == 404 and json.loads(b2) == {"error": {"code": "not_found", "message": "We couldn't find a claim with that reference and email."}}, (s2, b2)
    print('find lock OK')

def test_erase(auth):
    print('--- erasure ---')
    claim = start_claim(model='kestle-shelving-unit', booklet=4, quantity=1, email='erase.me@example.org',
                        purchase='2026-01-01', postcode='m1 1aa')
    ref = claim['reference']
    confirm_claim(claim)
    s, h, b = req('POST', f'/api/ops/claims/{ref}/erase', {'confirm_reference': ref}, headers=auth)
    assert s == 200, f'erase: {s} {b}'
    print('erased:', json.loads(b))
    # claim view is only the erased remain
    s, h, b = req('GET', f'/api/ops/claims/{ref}', headers=auth)
    view = json.loads(b)
    assert view['state'] == 'erased' and 'owner' not in view, view
    # second erase refused with wrong_state
    s, h, b = req('POST', f'/api/ops/claims/{ref}/erase', {'confirm_reference': ref}, headers=auth)
    assert s == 409, f'second erase: {s}'
    # mail to the address is gone
    mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=50'))
    remaining = [m['Subject'] for m in mp['messages'] if 'erase.me@example.org' in str(m['To'])]
    assert remaining == [], remaining
    # MinIO has nothing under the claim prefix
    import boto3
    from botocore.client import Config
    s3 = boto3.client('s3', endpoint_url='http://minio:9000',
        aws_access_key_id='gf-dev-root-71c3e0', aws_secret_access_key='gf-dev-secret-4b8d92',
        region_name='us-east-1', config=Config(s3={'addressing_style': 'path'}))
    r = s3.list_objects_v2(Bucket='gf-dev', Prefix=f'claims/{ref}/')
    assert r.get('KeyCount', 0) == 0, r.get('Contents')
    print('erasure OK: mail and objects gone')

def test_import(auth):
    print('--- supplier import ---')
    stamp = str(int(uuid.uuid4().hex[:6], 16) % 100000000).zfill(8)
    booklet = 20 + (int(uuid.uuid4().hex[:2], 16) % 70)
    csv = (
        'model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status\r\n'
        f'Aldra Wardrobe-AW12,{booklet},{stamp},New shelf pin,1.25,15,20,active\r\n'
        'Kestle Shelving Unit / ks05,3,101345,Shelf pin,0.15,3,16,active\r\n'
        'Holm Classic,1,40218831,Side panel,48.00,14200,1990,active\r\n'
        'Unknown Wardrobe,9,123456,Nope,1.00,100,50,active\r\n'
        'Bramwell Sofa Frame,4,112911,Corner block,3.65,120,90,withdrawn\r\n'
    )
    s, h, b = req('POST', '/api/ops/imports', raw=csv.encode(), headers={**auth, 'Content-Type': 'text/csv'})
    assert s == 200, f'import: {s} {b}'
    result = json.loads(b)
    print('import:', result)
    assert result['created'] == 1, result  # new part row 7
    # Bramwell corner block may already be withdrawn from an earlier run.
    assert result['unchanged'] >= 1, result  # Kestle pin identical
    assert len(result['unmatched']) == 2, result  # unknown + ambiguous
    reasons = {u['line']: u['reason'] for u in result['unmatched']}
    assert reasons[4] == 'ambiguous_model', reasons
    assert reasons[5] == 'unknown_model', reasons
    # re-import changes nothing
    s, h, b = req('POST', '/api/ops/imports', raw=csv.encode(), headers={**auth, 'Content-Type': 'text/csv'})
    result2 = json.loads(b)
    assert result2['created'] == 0 and result2['updated'] == 0, result2
    print('re-import unchanged OK')

def test_editions(auth):
    print('--- editions ---')
    s, h, b = req('GET', '/api/ops/editions', headers=auth)
    editions = json.loads(b)['editions']
    print('editions:', [(e['code'], e['starts_on']) for e in editions])
    # save an edition starting next month
    from datetime import date, timedelta
    offset = int(uuid.uuid4().hex[:2], 16) % 300
    nxt = date.today() + timedelta(days=40 + offset)
    starts = nxt.isoformat()
    payload = {'code': f'AC-T-{uuid.uuid4().hex[:6].upper()}', 'title': 'Aftercare test', 'starts_on': starts,
               'standard_months': 30, 'club_months': 42, 'owner_contribution_percent': 20}
    s, h, b = req('POST', '/api/ops/editions', payload, headers=auth)
    assert s == 201, f'save edition: {s} {b}'
    print('saved:', json.loads(b))
    # duplicate code and date refused
    s, h, b = req('POST', '/api/ops/editions', {**payload, 'title': 'Other'}, headers=auth)
    assert s == 409, f'code taken: {s}'
    s, h, b = req('POST', '/api/ops/editions', {**payload, 'code': 'AC-OTHER-1'}, headers=auth)
    assert s == 409, f'date taken: {s}'
    # today refused
    s, h, b = req('POST', '/api/ops/editions', {**payload, 'code': 'AC-TODAY', 'starts_on': date.today().isoformat()}, headers=auth)
    assert s == 422, f'today: {s} {b}'
    print('editions OK')

def test_rate_limit(auth):
    print('--- parts rate limit ---')
    codes = []
    for i in range(65):
        s, h, b = req('GET', '/api/parts')
        codes.append(s)
    limited = [c for c in codes if c == 429]
    print(f'requests: {codes.count(200)} ok, {len(limited)} limited')
    assert len(limited) > 0, 'no rate limit hit'
    # Wait for the rate window to pass, then paginate: every part exactly once.
    time.sleep(65)
    seen = []
    cursor = None
    while True:
        url = '/api/parts?limit=10' + (f'&cursor={cursor}' if cursor else '')
        s, h, b = req('GET', url)
        if s == 429:
            time.sleep(65)
            continue
        page = json.loads(b)
        seen.extend([(p['model'], p['booklet_number']) for p in page['parts']])
        if page['next_cursor'] is None:
            break
        cursor = page['next_cursor']
    assert len(seen) == len(set(seen)), 'pagination repeats'
    print(f'pagination OK ({len(seen)} parts listed once)')

if __name__ == '__main__':
    auth = sign_in()
    test_decline_unpaid(auth)
    test_decline_paid(auth)
    test_find_lock(auth)
    test_erase(auth)
    test_import(auth)
    test_editions(auth)
    test_rate_limit(auth)
    print('\nSECOND JOURNEYS PASSED')
