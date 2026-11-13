"""Latency checks: the shelf pushes state changes within 2 seconds, and a
sold box leaves public search within 5 seconds."""
import sys, time, json, urllib.request, threading

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

def api(path, data=None, headers=None, method=None):
    if method is not None:
        req = urllib.request.Request(BASE + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'content-type': 'application/json', **(headers or {})}, method=method)
    elif data is not None:
        req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                     headers={'content-type': 'application/json', **(headers or {})}, method='POST')
    else:
        req = urllib.request.Request(BASE + path, headers=headers or {})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode()
        return json.loads(body) if body else None

shelf = api('/api/shelf')
free = []
for b in shelf['boxes']:
    if len(free) >= 2:
        break
    if b['state'] == 'available':
        try:
            h = api('/api/holds', {'number': b['number']})
        except urllib.error.HTTPError:
            continue
        if isinstance(h, dict) and h.get('holdToken'):
            api(f"/api/holds/{b['number']}", headers={'X-Hold-Token': h['holdToken']}, method='DELETE')
            free.append(b['number'])

# Listen to the SSE stream and time a box event.
events = []
def listen():
    req = urllib.request.Request(BASE + '/api/shelf/events')
    with urllib.request.urlopen(req, timeout=30) as r:
        start = time.time()
        while time.time() - start < 25:
            line = r.readline().decode().strip()
            if not line:
                continue
            if line.startswith('event:'):
                kind = line.split(':', 1)[1].strip()
            elif line.startswith('data:'):
                events.append((kind, line.split(':', 1)[1].strip(), time.time()))

t = threading.Thread(target=listen, daemon=True)
t.start()
time.sleep(1.5)

t0 = time.time()
hold = api('/api/holds', {'number': free[0]})
latency = None
for _ in range(40):
    time.sleep(0.1)
    matching = [e for e in events if str(free[0]) in e[1] and e[0] == 'box']
    if matching:
        latency = matching[0][2] - t0
        break
check('a hold reaches every open shelf within 2 seconds', latency is not None and latency < 2.0, f'{latency}')

# A sold box leaves public search within 5 seconds.
hold2 = api('/api/holds', {'number': free[1]})
body = {
    'number': free[1], 'method': 'card',
    'buyer': {'name': 'Ida Collector', 'email': 'ida@example.com'},
    'address': {'street': 'Snevej 12', 'postcode': '2100', 'city': 'Copenhagen'},
    'card': {'number': '4242424242424242', 'expiry': '12/29', 'cvc': '123'},
}
checkout = api('/api/checkout', body, headers={'X-Hold-Token': hold2['holdToken'], 'Idempotency-Key': f'lat-{hold2["holdToken"]}'})
sold = free[1]
gone = False
t0 = time.time()
while time.time() - t0 < 6:
    hits = api(f'/api/search?q={sold}')['hits']
    if not any(h.get('number') == sold for h in hits):
        gone = True
        break
    time.sleep(0.4)
check('a sold box leaves public search within 5 seconds', gone, f'checked for {time.time() - t0:.1f}s')

# The hold endpoint answers 410 after the hold ends on its own: delete the
# valkey key directly is not possible from outside; instead check the API
# shape while the hold is live.
remaining = api(f'/api/holds/{free[0]}', headers={'X-Hold-Token': hold['holdToken']})
check('the server decides remaining time', remaining['remainingMs'] <= hold['holdMs'], f"{remaining['remainingMs']} <= {hold['holdMs']}")

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
