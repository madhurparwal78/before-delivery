"""The full refund and restock journey: partial refund, full refund, back on
the shelf, certificate cancellation, and the Svix deliveries view."""
import sys, time, json, urllib.request, urllib.error, subprocess

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

def api(path, data=None, headers=None, method=None, binary=False):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'content-type': 'application/json', **(headers or {})},
        method=method or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            if binary:
                return r.status, body
            return r.status, json.loads(body.decode())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body.decode())
        except Exception:
            return e.code, None

_TOKEN_CACHE = {}
def staff_token(user, password):
    if user in _TOKEN_CACHE:
        return _TOKEN_CACHE[user]
    last = None
    for _ in range(5):
        req = urllib.request.Request(
            "http://keycloak:8080/realms/gf-dev/protocol/openid-connect/token",
            data=f"grant_type=password&client_id=app&client_secret=gf-kc-app-dev-5e93c1a8&username={user}&password={password}".encode(),
            headers={'content-type': 'application/x-www-form-urlencoded'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                tok = json.loads(r.read().decode())['access_token']
                _TOKEN_CACHE[user] = tok
                return tok
        except urllib.error.HTTPError as e:
            last = e
            time.sleep(2)
    raise last

# Create a fresh order, pack it (capture), then refund part and the rest.
shelf = api('/api/shelf')[1]
candidates = [b['number'] for b in shelf['boxes'] if b['state'] == 'available']
n = None
for cand in candidates:
    s, h = api('/api/holds', {'number': cand})
    if s == 201:
        n = cand
        break
check('a fresh hold was granted', n is not None, 'no free box could be held')
if n is None:
    sys.exit(1)
status, order = api('/api/checkout', {
    'number': n, 'method': 'card',
    'buyer': {'name': 'Ida Refund', 'email': 'refund@example.com'},
    'address': {'street': 'Snevej 12', 'postcode': '2100', 'city': 'Copenhagen'},
    'card': {'number': '4242424242424242', 'expiry': '12/29', 'cvc': '123'},
}, headers={'X-Hold-Token': h['holdToken'], 'Idempotency-Key': f'refund-journey-{n}'})
check('the order is authorised', status == 201 and order['paymentState'] == 'authorised', str(status))

PTOK = {'Authorization': f'Bearer {staff_token("packer", "Packer-Press-2026!")}'}
_treasurer_token = staff_token("treasurer", "Treasurer-Press-2026" + "!")
TTOK = {'Authorization': f'Bearer {_treasurer_token}'}

status, packed = api(f"/api/staff/orders/{order['reference']}/pack", {}, PTOK)
check('packing captures and packs', status == 202 and packed['paymentState'] == 'captured', str(packed))

# The certificate is issued.
cert = None
for _ in range(20):
    _, o = api(f"/api/orders/{order['reference']}?token={order['orderToken']}")
    cert = o['certificate']['state']
    if cert == 'issued':
        break
    time.sleep(0.5)
check('the certificate is issued after packing', cert == 'issued', cert)

# Partial refund of DKK 333.33.
status, r1 = api(f"/api/staff/orders/{order['reference']}/refunds", {'amountOre': 33_333}, {**TTOK, 'Idempotency-Key': f'refund-1-{n}'})
check('the partial refund settles', status == 202 and r1['state'] == 'settled', json.dumps(r1)[:120])
check('the partial refund parts match the published split',
      (r1['netOre'], r1['vatOre'], r1['charityOre'], r1['makerOre']) == (26_666, 6_667, 8_400, 18_266),
      str((r1['netOre'], r1['vatOre'], r1['charityOre'], r1['makerOre'])))

# The same idempotency key returns the same refund, not a second one.
status, r1b = api(f"/api/staff/orders/{order['reference']}/refunds", {'amountOre': 33_333}, {**TTOK, 'Idempotency-Key': f'refund-1-{n}'})
check('a repeated refund key returns the first refund', status == 202 and r1b['refundId'] == r1['refundId'], str(status))

# The same key with a different amount is a conflict.
status, _ = api(f"/api/staff/orders/{order['reference']}/refunds", {'amountOre': 1_000}, {**TTOK, 'Idempotency-Key': f'refund-1-{n}'})
check('the same key with a different amount is a conflict', status == 409, str(status))

# Refund the rest: the exact remainder.
status, rem = api(f"/api/staff/orders/{order['reference']}/refund-remainder", headers=TTOK)
check('the remainder is read', status == 200 and rem['amountOre'] == 149_500 - 33_333, str(rem))
status, r2 = api(f"/api/staff/orders/{order['reference']}/refunds", {'amountOre': rem['amountOre']}, {**TTOK, 'Idempotency-Key': f'refund-2-{n}'})
check('the final refund settles', status == 202 and r2['state'] == 'settled', str(status))

# The ledger view shows charity and maker totals at exactly zero.
status, ledger = api(f"/api/staff/orders/{order['reference']}/ledger", headers=TTOK)
totals = ledger['totals']
check('the ledger totals are all exactly zero',
      totals['grossOre'] == 0 and totals['netOre'] == 0 and totals['vatOre'] == 0
      and totals['charityOre'] == 0 and totals['makerOre'] == 0, str(totals))

# The certificate stops downloading.
status, _ = api(f"/api/orders/{order['reference']}/certificate?token={order['orderToken']}", binary=True)
check('a cancelled certificate stops downloading', status == 410, str(status))

# The box stays out of sale until the packer marks it back.
_, o = api(f"/api/orders/{order['reference']}?token={order['orderToken']}")
check('the order is fully refunded', o['paymentState'] == 'refunded', o['paymentState'])
status, box = api(f'/api/boxes/{n}')
check('the box is returned, not yet on sale', box['state'] == 'taken', box['state'])

# It does not appear in public search.
time.sleep(6)
status, res_hits = api(f'/api/search?q={n}')
hits = res_hits['hits'] if isinstance(res_hits, dict) else res_hits
check('the returned box is out of public search', not any((h.get('number') == n if isinstance(h, dict) else False) for h in hits), 'still listed')

# The packer marks it Back on the shelf.
status, back = api(f'/api/staff/boxes/{n}/back-on-shelf', {}, PTOK)
check('back on the shelf answers available', status == 200 and back['state'] == 'available', str(back))
time.sleep(6)
status, res_hits = api(f'/api/search?q={n}')
hits = res_hits['hits'] if isinstance(res_hits, dict) else res_hits
check('the box returns to public search', any((h.get('number') == n if isinstance(h, dict) else False) for h in hits), 'missing')

# The Svix deliveries view shows the events.
status, deliveries = api('/api/staff/deliveries', headers=TTOK)
if status == 200:
    kinds = [d['eventType'] for d in deliveries['deliveries']]
    check('the deliveries view lists the events', 'order.paid' in kinds, str(kinds[:5]))
    check('refund.settled was delivered', 'refund.settled' in kinds, str(sorted(set(kinds))))
else:
    check('the deliveries view is readable', status == 200, str(status))

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
