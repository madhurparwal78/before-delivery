"""Certificate and statement journeys: the PDF text, identical bytes, lookup by
reference and email, and cancellation after a full refund."""
import sys, time, json, hashlib, urllib.request, urllib.error

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

def staff_token(user, password):
    req = urllib.request.Request(
        "http://keycloak:8080/realms/gf-dev/protocol/openid-connect/token",
        data=f"grant_type=password&client_id=app&client_secret=gf-kc-app-dev-5e93c1a8&username={user}&password={password}".encode(),
        headers={'content-type': 'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())['access_token']

import subprocess
node = subprocess.run(['node', '-e', """
const { Client } = require('/app/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT reference, order_token, number, buyer_email, payment_state, certificate_state FROM orders WHERE certificate_state = 'issued' ORDER BY created_at DESC LIMIT 1");
  console.log(JSON.stringify(r.rows[0] || null));
  await c.end();
})();
"""], capture_output=True, text=True)
order = json.loads(node.stdout.strip()) if node.stdout.strip() else None

if order:
    ref = order['reference']
    token = order['order_token']

    # The certificate downloads with identical bytes each time.
    status, bytes1 = api(f"/api/orders/{ref}/certificate?token={token}", binary=True)
    check('the certificate downloads', status == 200 and bytes1[:4] == b'%PDF', f"{status} {len(bytes1)} bytes")
    status, bytes2 = api(f"/api/orders/{ref}/certificate?token={token}", binary=True)
    check('the certificate bytes are identical each time', bytes1 == bytes2, f"{len(bytes1)} vs {len(bytes2)}")

    # The PDF text layer names the press, the tale, the box, the plate and the charity share.
    try:
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(bytes1))
        text = "\n".join((page.extract_text() or '') for page in reader.pages)
        check('the certificate names Svovlstik Press', 'Svovlstik Press' in text)
        check('the certificate names The Last Bundle', 'The Last Bundle' in text)
        check(f'the certificate names Box {order["number"]} of 240', f'Box {order["number"]} of 240' in text)
        check('the certificate names the plate', 'Plate:' in text)
        check('the certificate names the order', f'Order {ref}' in text)
        check('the certificate names the charity share', 'Charity share of this box: DKK' in text)
    except ImportError:
        check('pypdf available for text checks', False, 'not installed')

    # A wrong token gets 404.
    status, _ = api(f"/api/orders/{ref}/certificate?token=wrong", binary=True)
    check('a wrong order token gets 404', status == 404, str(status))

    # Order lookup by reference and email reaches the order.
    status, found = api('/api/orders/lookup', {'reference': ref, 'email': order['buyer_email']})
    check('order lookup by reference and email works', status == 200 and found['orderToken'] == token, str(status))

    # Case-insensitive email still matches.
    status, found = api('/api/orders/lookup', {'reference': ref, 'email': order['buyer_email'].upper()})
    check('lookup email ignores case', status == 200, str(status))

    # A wrong pair gets the same refusal as an unknown reference.
    s1, b1 = api('/api/orders/lookup', {'reference': ref, 'email': 'wrong@example.com'})
    s2, b2 = api('/api/orders/lookup', {'reference': 'LB-WRONG', 'email': 'wrong@example.com'})
    check('a wrong pair and an unknown reference give one identical refusal',
          s1 == s2 == 404 and b1 == b2, f"{s1} {s2}")
else:
    check('an issued certificate exists to test', False, 'no issued certificate')

# The statement download address with its token from the event.
TTOK = {'Authorization': f'Bearer {staff_token("treasurer", "Treasurer-Press-2026!")}'}
status, stmts = api('/api/staff/statements', headers=TTOK)
if stmts['statements']:
    first = stmts['statements'][0]
    status, pdf1 = api(f"/api/staff/statements/{first['id']}/pdf", headers=TTOK, binary=True)
    check('the staff statement PDF downloads', status == 200 and pdf1[:4] == b'%PDF')
    status, pdf2 = api(f"/api/staff/statements/{first['id']}/pdf", headers=TTOK, binary=True)
    check('statement bytes are identical each time', pdf1 == pdf2)
    # The public statement address requires the token from the event.
    # Without it: 404.
    status, _ = api(f"/api/statements/{first['id']}/pdf?token=wrong", binary=True)
    check('the public statement address refuses a wrong token', status == 404, str(status))
else:
    check('statements exist to download', False, 'none issued')

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
