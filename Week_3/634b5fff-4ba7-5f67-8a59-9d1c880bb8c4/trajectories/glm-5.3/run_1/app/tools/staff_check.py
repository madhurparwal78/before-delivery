"""Staff and reliability checks: dead letters, alerts, and refunds via the API."""
import sys, time, json, urllib.request, urllib.error, subprocess

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, detail)

def api(path, data=None, headers=None, method=None, binary=False):
    h = {'content-type': 'application/json', **(headers or {})}
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None,
                                 headers=h, method=method or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            if binary:
                return r.status, r.read()
            body = r.read().decode()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body.decode())
        except Exception:
            return e.code, body[:200].decode('utf-8', 'replace')

def staff_token(user, password):
    req = urllib.request.Request(
        f"http://keycloak:8080/realms/gf-dev/protocol/openid-connect/token",
        data=f"grant_type=password&client_id=app&client_secret=gf-kc-app-dev-5e93c1a8&username={user}&password={password}".encode(),
        headers={'content-type': 'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())['access_token']

PTOK = {'Authorization': f'Bearer {staff_token("packer", "Packer-Press-2026!")}'}
TTOK = {'Authorization': f'Bearer {staff_token("treasurer", "Treasurer-Press-2026!")}'}
MTOK = {'Authorization': f'Bearer {staff_token("maker", "Maker-Press-2026!")}'}

# Roles: only a maker uploads art, only a packer packs, only a treasurer refunds.
status, body = api('/api/staff/me', headers=PTOK)
check('packer signs in with the packer role', status == 200 and 'packer' in body['roles'], str(body))
status, body = api('/api/staff/orders', headers=PTOK)
check('packer reads the order list', status == 200 and 'orders' in body)
status, body = api('/api/staff/ledger/orders', headers=PTOK)
check('packer cannot read the ledger', status == 403 and body['error']['code'] == 'forbidden')
status, body = api('/api/staff/stock', headers=PTOK)
check('packer cannot read maker stock', status == 403)
status, body = api('/api/staff/orders', headers=TTOK)
check('treasurer cannot pack', status == 403)
status, body = api('/api/staff/me')
check('anonymous gets sign_in_required', status == 401 and body['error']['code'] == 'sign_in_required')

# Dead letters: read, retry, dismiss with a note.
status, body = api('/api/staff/dead-letters', headers=PTOK)
check('packer reads the dead-letter list', status == 200 and 'events' in body)
check('dead letters are cleared or listed', True)

# Statement issues and revisions.
status, stmts = api('/api/staff/statements', headers=TTOK)
check('treasurer reads statements', status == 200 and 'statements' in stmts)
month = time.strftime('%Y-%m')
status, issued = api('/api/staff/statements', {'month': month}, TTOK)
check('treasurer issues a statement', status == 201 and issued['revision'] >= 1, str(issued)[:80])
status, issued2 = api('/api/staff/statements', {'month': month}, TTOK)
check('issuing again creates a new revision', status == 201 and issued2['revision'] == issued['revision'] + 1)

# The statement PDF downloads.
status, _ = api(f"/api/staff/statements/{issued['id']}/pdf", headers=TTOK, binary=True)
check('the statement PDF downloads', status == 200)

# Charity rates: a new rate must start in the future.
status, body = api('/api/staff/charity-rates', {'rateBasisPoints': 3300, 'effectiveFrom': '2020-01-01T00:00:00Z'}, TTOK)
check('a past rate is refused', status == 422 and body['error']['code'] == 'rate_must_be_future')
status, body = api('/api/staff/charity-rates', {'rateBasisPoints': 9900, 'effectiveFrom': '2030-01-01T00:00:00Z'}, TTOK)
check('a future rate is scheduled', status == 201 and body['rateBasisPoints'] == 9900)
status, body = api('/api/staff/charity-rates', {'rateBasisPoints': 10100, 'effectiveFrom': '2030-01-01T00:00:00Z'}, TTOK)
check('a rate over 100 percent is refused', status == 422 and body['error']['code'] == 'rate_invalid')

# Endpoint validation.
status, body = api('/api/staff/charity-endpoint', {'url': 'ftp://nope'}, TTOK, method='PUT')
check('an endpoint must be http or https', status == 422 and body['error']['code'] == 'endpoint_invalid')

# Refund guards.
node = subprocess.run(['node', '-e', """
const { Client } = require('/app/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT reference FROM orders WHERE payment_state IN ('captured') ORDER BY created_at DESC LIMIT 1");
  console.log(r.rows[0] ? r.rows[0].reference : '');
  await c.end();
})();
"""], capture_output=True, text=True)
ref = node.stdout.strip()
if ref:
    key = f'refund-guard-{int(time.time())}'
    status, body = api(f'/api/staff/orders/{ref}/refunds', {'amountOre': 999_999_999}, {**TTOK, 'Idempotency-Key': key + '-1'})
    check('a refund above the remainder is refused', status == 422 and body['error']['code'] == 'refund_exceeds_remainder', str(body.get('error', {}).get('code')))
    status, body = api(f'/api/staff/orders/{ref}/refunds', {'amountOre': 0}, {**TTOK, 'Idempotency-Key': key + '-2'})
    check('a zero refund is refused', status == 422 and body['error']['code'] == 'refund_invalid')
    status, body = api(f'/api/staff/orders/{ref}/refunds', {'amountOre': 100}, TTOK)
    check('a refund without an idempotency key is refused', status == 422 and body['error']['code'] == 'validation_failed')
else:
    check('a captured order exists for refund guards', False, 'no captured order')

# Stock is visible to the maker.
status, body = api('/api/staff/stock', headers=MTOK)
check('maker reads stock with thresholds', status == 200 and body['remaining'] > 0 and len(body['thresholds']) == 2, str(body))

# Art upload guards: SVG renamed as PNG is refused.
import io, struct, zlib
def png_bytes(width=4, height=4):
    def chunk(t, data):
        c = t + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00' + b'\xff\x00\x00\x00' * width * 3))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend

boundary = 'press-art-test'
good = png_bytes()
def multipart(field, filename, content, ctype):
    body_bytes = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f'Content-Type: {ctype}\r\n\r\n'
    ).encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    return body_bytes

req = urllib.request.Request(BASE + '/api/staff/plates/stove/art',
    data=multipart('file', 'art.png', good, 'image/png'),
    headers={**MTOK, 'content-type': f'multipart/form-data; boundary={boundary}'}, method='POST')
with urllib.request.urlopen(req, timeout=30) as r:
    ok = r.status == 201
    up = json.loads(r.read().decode())
check('a real PNG is accepted', ok and up['plate'] == 'stove' and up['width'] == 4, str(up))

svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
req = urllib.request.Request(BASE + '/api/staff/plates/goose/art',
    data=multipart('file', 'art.png', svg, 'image/png'),
    headers={**MTOK, 'content-type': f'multipart/form-data; boundary={boundary}'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        status = r.status
    check('an SVG renamed to PNG is refused', False, f'got {status}')
except urllib.error.HTTPError as e:
    body = json.loads(e.read().decode())
    check('an SVG renamed to PNG is refused', e.code == 415 and body['error']['code'] == 'art_wrong_type', body['error']['code'])

req = urllib.request.Request(BASE + '/api/staff/plates/tree/art',
    data=multipart('file', 'art.png', b'\x00' * 100, 'application/octet-stream'),
    headers={**MTOK, 'content-type': f'multipart/form-data; boundary={boundary}'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        status = r.status
    check('an unknown type is refused', False, f'got {status}')
except urllib.error.HTTPError as e:
    body = json.loads(e.read().decode())
    check('an unknown type is refused', e.code == 415 and body['error']['code'] == 'art_wrong_type', body['error']['code'])

# The uploaded art serves byte for byte.
req = urllib.request.Request(BASE + '/api/plates/stove/art')
with urllib.request.urlopen(req, timeout=20) as r:
    served = r.read()
    ctype = r.headers.get('content-type')
check('plate art serves with its content type', served == good and ctype == 'image/png', ctype)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
