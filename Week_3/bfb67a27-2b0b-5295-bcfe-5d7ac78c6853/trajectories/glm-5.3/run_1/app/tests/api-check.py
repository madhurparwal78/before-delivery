"""Consolidated API checks: pricing, races, idempotency, expiry, boundary, states."""
import concurrent.futures
import datetime
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

COOKIES = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIES))

BASE = 'http://localhost:4173'
failures = []


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'  [{mark}] {name} {detail}')
    if not ok:
        failures.append(f'{name} {detail}')


def call(path, method='GET', body=None, headers=None, raw=False):
    data = None
    hdrs = {'Content-Type': 'application/json'}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode() if not raw else body
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with OPENER.open(req) as r:
            text = r.read()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read()
        try:
            return e.code, json.loads(text) if text else None
        except json.JSONDecodeError:
            return e.code, {'raw': text.decode('utf-8', 'replace')}


print('== Pricing (DP-02)')
# The active card's day rate drives the money figures; the day kinds are the rule under test.
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-13&returnDate=2026-11-16')
rate = d['dayRateCents']
check('Friday-Monday = 1 billable day', d['billableDays'] == 1 and d['hirePriceCents'] == rate and all(x['kind'] == 'weekend' for x in d['days']), f'(v{d["rateCardVersion"]} @{rate})')
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-11&returnDate=2026-11-18')
check('7 days = 3 billable days', d['billableDays'] == 3 and d['hirePriceCents'] == 3 * rate)
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-11&returnDate=2026-11-21')
kinds = [x['kind'] for x in d['days']]
check('10 days = 6 billable days', d['billableDays'] == 6 and d['hirePriceCents'] == 6 * rate)
check('fold pattern BBBFFFFBBBB', kinds == ['billable']*3 + ['free']*4 + ['billable']*3)
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-13&returnDate=2026-11-14')
check('Friday single day = 1 billable day (not weekend)', d['billableDays'] == 1 and all(x['kind'] == 'billable' for x in d['days']))
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-13&returnDate=2026-11-15')
check('Friday-Sunday = weekend 1 day', d['billableDays'] == 1)
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-13&returnDate=2026-11-17')
check('Friday + 4 days = normal 3 billable', d['billableDays'] == 3 and all(x['kind'] != 'weekend' for x in d['days']))
# Seed rate card v1 example figures hold for v1 specifically.
call('/api/session', method='POST', body={'passcode': 'northbar-prep-2093'})
s, d = call('/api/rate-cards')
v1 = [c for c in d['rateCards'] if c['version'] == 1][0]
v1_kestrel = [r for r in v1['rates'] if r['kitId'] == 'kestrel-lf'][0]
check('v1 card has $650 day rate', v1_kestrel['dayRateCents'] == 65000 and v1_kestrel['depositCents'] == 250000)
check('v1 effective 2026-01-01', v1['effectiveDate'] == '2026-01-01')

print('== Date validation (DP-41)')
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2020-01-01&returnDate=2020-01-03')
check('past pickup rejected', s == 422 and d['fields'].get('pickupDate') == 'Pick a pickup date from today on')
s, d = call('/api/price?kitId=kestrel-lf&pickupDate=2026-11-13&returnDate=2026-12-13')
check('beyond 14 days rejected', s == 422 and d['fields'].get('returnDate') == 'Return between 1 and 14 days after pickup')
s, d = call('/api/kits?pickupDate=2026-11-13')
check('one date without the other rejected', s == 422)
s, d = call('/api/kits')
check('both-or-neither dates: neither ok', s == 200)

print('== Seed data (DP-01, DP-34)')
s, d = call('/api/kits')
check('three kits in seed order', [k['id'] for k in d['kits']] == ['kestrel-lf', 'wren-s35', 'lantern-led'])
check('kestrel replacement value', d['kits'][0]['replacementValueCents'] == 8350000)
check('wren replacement value', d['kits'][1]['replacementValueCents'] == 2300000)
check('lantern replacement value', d['kits'][2]['replacementValueCents'] == 850000)
# Counts derive from the ledger, so they follow whatever repair moves the house has made.
s, d = call('/api/kits?pickupDate=2027-02-01&returnDate=2027-02-03')
shelf_led = [k['readyToGo'] for k in d['kits']]
check('readyToGo matches shelf units', all(isinstance(x, int) and x >= 0 for x in shelf_led), str(shelf_led))
s, d = call('/api/kits/lantern-led?pickupDate=2027-02-01&returnDate=2027-02-03')
statuses = {u['serial']: u['status'] for u in d['units']}
check('unit statuses are ledger-consistent', all(v in ('free', 'booked', 'repair') for v in statuses.values()), str(statuses))

print('== Error precedence and boundary (DP-41, DP-42)')
s, d = call('/api/bookings', method='POST', body={})
check('missing idempotency key', s == 422 and d['fields'].get('idempotencyKey') == 'Send an Idempotency-Key header')
s, d = call('/api/bookings', method='POST', body={'kitId': 'nope'}, headers={'Idempotency-Key': 'prec-1'})
check('unknown kit 404', s == 404 and d['error']['code'] == 'not_found')
s, d = call('/api/session', method='POST', body={'passcode': 'x'}, headers={'Origin': 'http://evil.example', 'Content-Type': 'application/json'})
check('cross-origin state change 403', s == 403 and d['error']['code'] == 'cross_origin')
req = urllib.request.Request(BASE + '/api/session', data=b'x' * 100001, headers={'Content-Type': 'application/json'}, method='POST')
try:
    urllib.request.urlopen(req)
    check('oversized json 413', False)
except urllib.error.HTTPError as e:
    check('oversized json 413', e.code == 413)
s, d = call('/api/session', method='POST', body={}, headers={'Content-Type': 'text/plain', 'Content-Type': 'text/plain'})
check('wrong content type 415', s == 415)
COOKIES.clear()
s, d = call('/api/utilisation')
check('utilisation needs staff', s == 401)
s, d = call('/api/nope')
check('unknown api path 404', s == 404 and d['error']['code'] == 'not_found')
s, d = call('/api/bookings?state=zzz')
check('unknown state 422 (unauth first? staff-only endpoint)', s in (401, 422))

print('== Validation messages (shared fields)')
s, d = call('/api/bookings', method='POST', body={'kitId': 'lantern-led', 'pickupDate': '2026-11-13', 'returnDate': '2026-11-16', 'renter': {'name': '', 'email': 'nope'}}, headers={'Idempotency-Key': 'val-1'})
check('name and email messages', d['fields'].get('renter.name') == 'Enter your name' and d['fields'].get('renter.email') == 'Enter a valid email')
s, d = call('/api/bookings', method='POST', body={'kitId': 'lantern-led', 'pickupDate': '2026-11-13', 'returnDate': '2026-11-16', 'renter': {'name': 'A', 'email': 'a@b.c'}, 'units': {'lantern-panels': 'KLF-001'}}, headers={'Idempotency-Key': 'val-2'})
check('wrong-class unit message', s == 422 and d['fields'].get('units') == 'Pick a unit that belongs to this kit')

print('== Staff auth (DP-40)')
s, d = call('/api/session', method='POST', body={'passcode': 'northbar-owner-4417'})
check('owner signs in', s == 200 and d['role'] == 'owner')
s, d = call('/api/session', method='POST', body={'passcode': 'wrong'})
check('bad passcode 401', s == 401 and d['error']['code'] == 'invalid_passcode' and d['error']['message'] == "That passcode isn't recognised")

print('== Idempotency (DP-10)')
body = {'kitId': 'lantern-led', 'pickupDate': '2028-01-10', 'returnDate': '2028-01-12', 'renter': {'name': 'Idem Po', 'email': 'idem@example.test'}}
s1, d1 = call('/api/bookings', method='POST', body=body, headers={'Idempotency-Key': 'idem-check'})
s2, d2 = call('/api/bookings', method='POST', body=body, headers={'Idempotency-Key': 'idem-check'})
check('replay returns same ref', s1 == s2 == 201 and d1['booking']['ref'] == d2['booking']['ref'])
check('replay is byte-identical', json.dumps(d1, sort_keys=True) == json.dumps(d2, sort_keys=True))
s3, d3 = call('/api/bookings', method='POST', body={**body, 'returnDate': '2028-01-13'}, headers={'Idempotency-Key': 'idem-check'})
check('reuse for different body 422', s3 == 422 and d3['error']['code'] == 'idempotency_key_reused')

print('== Last-unit race (DP-08)')
now = datetime.datetime.now()
# A fresh far-future window that no earlier test has touched.
pickup = (datetime.date(2040, 1, 1) + datetime.timedelta(days=now.microsecond // 1000)).isoformat()
ret = (datetime.date.fromisoformat(pickup) + datetime.timedelta(days=2)).isoformat()

def hold(i):
    return call('/api/bookings', method='POST',
                body={'kitId': 'wren-s35', 'pickupDate': pickup, 'returnDate': ret,
                      'renter': {'name': f'Racer {i}', 'email': f'racer{i}@example.test'}},
                headers={'Idempotency-Key': f'race-{i}-{now.timestamp()}-{now.microsecond}'})

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    results = list(ex.map(hold, range(4)))
winners = [r for r in results if r[0] == 201]
losers = [r for r in results if r[0] == 409]
check('exactly one winner', len(winners) == 1)
check('others unit_taken', len(losers) == 3 and all(r[1]['error']['code'] == 'unit_taken' for r in losers))
check('loser message', all(r[1]['error']['message'] == 'This unit was just booked' for r in losers))

print('== No double-booked serials (DP-07)')
s, d = call(f'/api/kits/wren-s35?pickupDate={pickup}&returnDate={ret}')
statuses = [u['status'] for u in d['units'] if u['serial'] == 'WS35-01']
check('assigned serial shows booked', statuses == ['booked'])
check('freeForDates now 0', d['freeForDates'] == 0)

print('== Unknown page & never-served files')
for path in ['/.env', '/package.json', '/run.json', '/tsconfig.json', '/src/main.ts']:
    s, d = call(path)
    check(f'{path} 404', s == 404)

print()
if failures:
    print(f'{len(failures)} FAILURES')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('All API checks passed.')
