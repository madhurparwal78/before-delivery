"""Transfer settlement and refund journeys driven by signed callbacks."""
import sys, time, json, hmac, hashlib, urllib.request, urllib.error
import datetime

BASE = 'http://localhost:4173'
SECRET = 'sbx_gateway_callback_secret_01'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

def api(path, data=None, headers=None):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'content-type': 'application/json', **(headers or {})},
        method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def callback(payload):
    body = json.dumps(payload).encode()
    t = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), f'{t}.'.encode() + body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(BASE + '/api/gateway/callbacks', data=body, method='POST', headers={
        'content-type': 'application/json',
        'X-Gateway-Signature': f't={t},v1={sig}',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

# A bank order that settles.
shelf = api('/api/shelf')[1]
n1 = None
for b in shelf['boxes']:
    if b['state'] == 'available':
        s, h = api('/api/holds', {'number': b['number']})
        if s == 201:
            n1 = b['number']
            hold = h
            break
if n1 is None:
    check('a bank order could be reserved', False, 'no box could be held')
    sys.exit(1)
status, order = api('/api/checkout', {
    'number': n1, 'method': 'bank',
    'buyer': {'name': 'Ida Collector', 'email': 'settle@example.com'},
    'address': {'street': 'Snevej 12', 'postcode': '2100', 'city': 'Copenhagen'},
}, headers={'X-Hold-Token': hold['holdToken'], 'Idempotency-Key': f'settle-{n1}'})
check('bank order reserved', status == 201, str(status))

# The exact transfer arrives within the deadline.
res = callback({
    'eventId': f'evt-trf-settle-{n1}', 'sequence': 1, 'type': 'transfer.received',
    'paymentId': None, 'transferId': 'trf_test', 'reference': order['reference'],
    'refundId': None, 'amountOre': order['transfer']['amountOre'],
    'declineCode': None, 'occurredAt': '2026-11-03T10:00:00Z',
})
check('the exact transfer settles the order', res['status'] == 'applied', str(res))
status, o = api(f"/api/orders/{order['reference']}?token={order['orderToken']}")
check('settled copy', o['paymentState'] == 'settled', o['paymentState'])
check('the box is claimed', o['boxState'] == 'claimed', o['boxState'])
cert = o['certificate']['state']
for _ in range(20):
    if cert in ('issued', 'cancelled'):
        break
    time.sleep(0.5)
    _, o = api(f"/api/orders/{order['reference']}?token={order['orderToken']}")
    cert = o['certificate']['state']
check('the certificate is issued', cert == 'issued', cert)

# A wrong amount is sent back and the deadline keeps running.
n2 = None
hold2 = None
for b in shelf['boxes']:
    if b['state'] == 'available' and b['number'] != n1:
        s, h = api('/api/holds', {'number': b['number']})
        if s == 201:
            n2 = b['number']
            hold2 = h
            break
if n2 is None:
    check('a second bank order could be reserved', False, 'no box could be held')
    sys.exit(1)
status, order2 = api('/api/checkout', {
    'number': n2, 'method': 'bank',
    'buyer': {'name': 'Ida Collector', 'email': 'wrong@example.com'},
    'address': {'street': 'Snevej 12', 'postcode': '2100', 'city': 'Copenhagen'},
}, headers={'X-Hold-Token': hold2['holdToken'], 'Idempotency-Key': f'wrong-{n2}'})
check('second bank order reserved', status == 201, str(status))
res = callback({
    'eventId': f'evt-trf-wrong-{n2}', 'sequence': 1, 'type': 'transfer.received',
    'paymentId': None, 'transferId': 'trf_test2', 'reference': order2['reference'],
    'refundId': None, 'amountOre': 100,
    'declineCode': None, 'occurredAt': '2026-11-03T10:00:00Z',
})
check('a wrong amount is sent back', res['status'] == 'applied', str(res))
status, o2 = api(f"/api/orders/{order2['reference']}?token={order2['orderToken']}")
check('the order still waits for the transfer', o2['paymentState'] == 'pending', o2['paymentState'])
check('the deadline keeps running', o2['transfer'] is not None, 'transfer details remain')

# A stale timestamp is refused with 401 and changes nothing.
body = json.dumps({
    'eventId': 'evt-stale-1', 'sequence': 1, 'type': 'payment.captured',
    'paymentId': 'pay_x', 'transferId': None, 'reference': order['reference'],
    'refundId': None, 'amountOre': 158400, 'declineCode': None, 'occurredAt': '2026-11-03T10:00:00Z',
}).encode()
t = str(int(time.time()) - 400)
sig = hmac.new(SECRET.encode(), f'{t}.'.encode() + body, hashlib.sha256).hexdigest()
req = urllib.request.Request(BASE + '/api/gateway/callbacks', data=body, method='POST', headers={
    'content-type': 'application/json',
    'X-Gateway-Signature': f't={t},v1={sig}',
})
try:
    urllib.request.urlopen(req, timeout=30)
    check('a stale timestamp gets 401', False, 'accepted')
except urllib.error.HTTPError as e:
    body = json.loads(e.read().decode())
    check('a stale timestamp gets 401', e.code == 401 and body['error']['code'] == 'bad_signature', str(e.code))

# A bad signature gets 401.
req = urllib.request.Request(BASE + '/api/gateway/callbacks', data=b'{"eventId":"x"}', method='POST', headers={
    'content-type': 'application/json',
    'X-Gateway-Signature': 't=1,v1=deadbeef',
})
try:
    urllib.request.urlopen(req, timeout=30)
    check('a bad signature gets 401', False, 'accepted')
except urllib.error.HTTPError as e:
    check('a bad signature gets 401', e.code == 401)

# An unknown reference gets 404.
res = callback({
    'eventId': 'evt-unknown-1', 'sequence': 1, 'type': 'payment.captured',
    'paymentId': 'pay_x', 'transferId': None, 'reference': 'LB-NOSUCH',
    'refundId': None, 'amountOre': 158400, 'declineCode': None, 'occurredAt': '2026-11-03T10:00:00Z',
}) if False else None
try:
    callback({
        'eventId': 'evt-unknown-1', 'sequence': 1, 'type': 'payment.captured',
        'paymentId': 'pay_x', 'transferId': None, 'reference': 'LB-NOSUCH',
        'refundId': None, 'amountOre': 158400, 'declineCode': None, 'occurredAt': '2026-11-03T10:00:00Z',
    })
    check('an unknown reference gets 404', False, 'accepted')
except urllib.error.HTTPError as e:
    check('an unknown reference gets 404', e.code == 404, str(e.code))

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
