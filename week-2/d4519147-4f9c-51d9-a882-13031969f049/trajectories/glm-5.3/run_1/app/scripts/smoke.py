#!/usr/bin/env python3
"""Backend smoke test against the running server."""
import json
import urllib.request
import urllib.error
import sys

BASE = 'http://127.0.0.1:4173'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect)

class Client:
    def __init__(self):
        self.cookie = None
        self.csrf = None

    def request(self, method, path, body=None, headers=None, raw=None):
        url = BASE + path
        data = None
        if body is not None:
            data = json.dumps(body).encode()
        if raw is not None:
            data = raw
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        if self.cookie:
            req.add_header('Cookie', self.cookie)
        if self.csrf:
            req.add_header('X-CSRF-Token', self.csrf)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            resp = OPENER.open(req)
            set_cookie = resp.headers.get('Set-Cookie')
            if set_cookie:
                self.cookie = set_cookie.split(';')[0]
            payload = resp.read()
            return resp.status, dict(resp.headers), payload
        except urllib.error.HTTPError as e:
            set_cookie = e.headers.get('Set-Cookie')
            if set_cookie:
                self.cookie = set_cookie.split(';')[0]
            return e.code, dict(e.headers), e.read()

    def json(self, method, path, body=None, headers=None):
        status, headers, payload = self.request(method, path, body, headers)
        try:
            parsed = json.loads(payload)
        except Exception:
            parsed = None
        return status, headers, parsed

def main():
    failures = []
    # Clear Mailpit so delivery counts reflect this run only.
    OPENER.open(urllib.request.Request('http://mailpit:8025/api/v1/messages', method='DELETE')).read()
    def check(name, cond, detail=''):
        if cond:
            print(f'ok    {name}')
        else:
            print(f'FAIL  {name}  {detail}')
            failures.append(name)

    dana = Client()
    ravi = Client()
    lee = Client()

    # Sign in as Dana.
    status, headers, body = dana.json('POST', '/api/session', {'email': 'dana.okafor@harborlane.test', 'password': 'Harbor-Lead-2026!'})
    check('dana sign-in', status == 200 and 'csrfToken' in body, f'{status} {body}')
    dana.csrf = body['csrfToken']

    # Wrong password.
    status, headers, body = dana.json('POST', '/api/session', {'email': 'dana.okafor@harborlane.test', 'password': 'wrong'})
    check('wrong password 401', status == 401 and body.get('error') == 'invalid_credentials', f'{status} {body}')

    # Diagrams list.
    status, _, body = dana.json('GET', '/api/diagrams')
    harbor = [d for d in body['diagrams'] if d['title'] == 'Harbor Lane CDE scope']
    check('diagrams list', status == 200 and len(harbor) == 1, f'{status} {body}')

    # Page read with derived values.
    status, _, body = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')
    check('flows page read', status == 200, f'{status}')
    zones = {z['id']: z for z in body['derived']['zones']}
    check('cde tally 3/5', zones['zone-cde']['systems'] == 3 and zones['zone-cde']['crossings'] == 5, str(zones['zone-cde']))
    check('connected tally 2/2', zones['zone-connected']['systems'] == 2 and zones['zone-connected']['crossings'] == 2, str(zones['zone-connected']))
    check('out tally 1/1', zones['zone-out']['systems'] == 1 and zones['zone-out']['crossings'] == 1, str(zones['zone-out']))

    # Restore the seed state if a previous run moved fraud screening.
    page = body['page']
    changed = False
    for s in page['shapes']:
        if s['id'] == 'shp-fraud' and (s['x'], s['y']) != (600, 600):
            s['x'], s['y'] = 600, 600
            changed = True
    for c in page['connectors']:
        if c['id'] == 'con-fraud-settle' and c['points'] != [[744, 636], [912, 636], [912, 432]]:
            c['points'] = [[744, 636], [912, 636], [912, 432]]
            changed = True
    if changed:
        status, _, resp = dana.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', page)
        check('restore seed page', status == 200, f'{status}')
        status, _, body = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')

# Save the page with the same version: version conflict check.
    page = body['page']
    status, _, resp = dana.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', page)
    check('save page ok', status == 200 and resp['page']['version'] == page['version'] + 1, f'{status} {resp}')
    status, _, resp = dana.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', page)
    check('version conflict', status == 409 and resp.get('error') == 'version_conflict', f'{status} {resp}')

    # CSRF missing.
    status, _, resp = dana.request('POST', '/api/diagrams', {'title': 'x'}, headers=None)
    # Note: this used dana.csrf automatically; do a manual no-CSRF request.
    req = urllib.request.Request(BASE + '/api/diagrams', data=json.dumps({'title': 'x'}).encode(), method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Cookie', dana.cookie)
    try:
        urllib.request.urlopen(req)
        status = 200
    except urllib.error.HTTPError as e:
        status = e.code
        resp = e.read()
    check('missing csrf 403', status == 403, f'{status} {resp}')

    # Cross-site origin.
    status, _, resp = dana.json('POST', '/api/diagrams', {'title': 'x'}, {'Origin': 'https://evil.example'})
    check('cross-site 403', status == 403 and resp.get('error') == 'cross_site_request', f'{status} {resp}')

    # Ravi signs in, saves (editor).
    status, _, body = ravi.json('POST', '/api/session', {'email': 'ravi.sato@harborlane.test', 'password': 'Harbor-Net-2026!a'})
    ravi.csrf = body['csrfToken']
    status, _, body = ravi.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')
    page = body['page']
    # Move fraud screening into the CDE zone and reroute its connector:
    # its from port moves with the shape.
    for s in page['shapes']:
        if s['id'] == 'shp-fraud':
            s['x'] = 648
            s['y'] = 456
    for c in page['connectors']:
        if c['id'] == 'con-fraud-settle':
            c['points'] = [[792, 492], [912, 492], [912, 432]]
    status, _, resp = ravi.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', page)
    check('ravi save', status == 200, f'{status} {resp}')
    zones = {z['id']: z for z in resp['derived']['zones']}
    check('fraud in cde 4 systems', zones['zone-cde']['systems'] == 4, str(zones['zone-cde']))

    # Lee (viewer) sees the same derived values.
    status, _, body = lee.json('POST', '/api/session', {'email': 'lee.varga@northgate-qsa.test', 'password': 'Northgate-QSA-2026!'})
    lee.csrf = body['csrfToken']
    status, _, body = lee.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')
    zones = {z['id']: z for z in body['derived']['zones']}
    check('lee sees 4 systems', zones['zone-cde']['systems'] == 4, str(zones['zone-cde']))
    # Lee cannot save.
    status, _, resp = lee.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', body['page'])
    check('viewer save forbidden', status == 403, f'{status} {resp}')

    # Morgan sees nothing.
    morgan = Client()
    status, _, body = morgan.json('POST', '/api/session', {'email': 'morgan.fell@harborlane.test', 'password': 'Harbor-Ops-2026!'})
    morgan.csrf = body['csrfToken']
    status, _, body = morgan.json('GET', '/api/diagrams')
    check('morgan sees no diagrams', len(body['diagrams']) == 0, str(body))
    status, _, resp = morgan.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01')
    check('morgan diagram 404', status == 404, f'{status}')

    # Kestrel diagram invisible to Dana.
    status, _, resp = dana.json('GET', '/api/diagrams/9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702')
    check('kestrel 404 for dana', status == 404, f'{status}')

    # Dana invites a new engineer.
    invite_email = 'new.engineer+%d@harborlane.test' % int(__import__('time').time())
    status, _, resp = dana.json('POST', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/shares', {'email': invite_email, 'role': 'editor'})
    check('invite 201', status == 201, f'{status} {resp}')

    # Get the invitation token from Mailpit.
    import time
    time.sleep(2)
    with urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=10') as r:
        messages = json.load(r)
    invite = None
    for m in messages['messages']:
        if m['Subject'] == 'You have been invited to a diagram on Scopewright':
            invite = m
            break
    check('invitation email delivered', invite is not None, str(messages['total']))
    with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{invite['ID']}") as r:
        msg = json.load(r)
    link = None
    for line in msg['Text'].split('\n'):
        if line.startswith('Accept: '):
            link = line[len("Accept: "):].strip()
    token = link.rsplit('/', 1)[-1]
    check('accept link from public url', 'http://127.0.0.1:4173/invite/' in link, link)

    # Look up the invite.
    status, _, resp = Client().json('GET', f'/api/invites/{token}')
    check('invite lookup', status == 200 and resp['invite']['accountExists'] is False, f'{status} {resp}')

    # Accept with a new account.
    status, headers, resp = Client().json('POST', f'/api/invites/{token}/accept', {'displayName': 'New Engineer', 'password': 'New-Engineer-2026!x'})
    check('invite accept', status == 200 and resp['role'] == 'editor', f'{status} {resp}')

    # Accept again: used token.
    status, _, resp = Client().json('POST', f'/api/invites/{token}/accept', {'displayName': 'X', 'password': 'New-Engineer-2026!x'})
    check('used token 404', status == 404, f'{status} {resp}')

    # Dana downgrades Jo.
    status, _, body = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/shares')
    jo_share = next((s for s in body['shares'] if s['email'] == 'jo.mendes@harborlane.test'), None)
    check('shares listed', jo_share is not None and jo_share['status'] == 'active', str(body))
    status, _, resp = dana.json('PATCH', f"/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/shares/{jo_share['id']}", {'role': 'viewer'})
    check('jo downgraded', status == 200 and resp['share']['role'] == 'viewer', f'{status} {resp}')

    # Jo's next save is refused.
    jo = Client()
    status, _, body = jo.json('POST', '/api/session', {'email': 'jo.mendes@harborlane.test', 'password': 'Harbor-Net-2026!b'})
    jo.csrf = body['csrfToken']
    status, _, body = jo.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')
    status, _, resp = jo.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', body['page'])
    check('jo save forbidden', status == 403, f'{status}')

    # Downgrade notice email.
    time.sleep(2)
    with urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=20') as r:
        messages = json.load(r)
    notice = [m for m in messages['messages'] if m['Subject'] == 'Your access to a diagram on Scopewright changed']
    check('downgrade notice delivered', len(notice) == 1, str(len(notice)))

    # Export with idempotency.
    status, headers, resp = dana.json('POST', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/exports', {}, {'Idempotency-Key': 'smoke-1'})
    check('export created', status == 201 and resp['export']['status'] == 'ready', f'{status} {resp}')
    files = resp['export']['files']
    check('export 3 files', len(files) == 3, str(files))
    status, headers, resp2 = dana.json('POST', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/exports', {}, {'Idempotency-Key': 'smoke-1'})
    check('export replay', status == 201 and headers.get('Idempotent-Replayed') == 'true' and resp2['export']['id'] == resp['export']['id'], f'{status} {headers.get("Idempotent-Replayed")}')

    # Download the PNG.
    status, headers, resp = dana.request('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/exports/%s/files/png' % resp['export']['id'])
    check('file 303', status == 303, f'{status}')
    location = headers['Location']
    status, headers, payload = dana.request('GET', location)
    check('png download', status == 200 and payload[:4] == b'\x89PNG', f'{status} {payload[:8]}')
    check('content-disposition', 'attachment' in headers.get('Content-Disposition', ''), headers.get('Content-Disposition'))
    check('sandbox csp', 'sandbox' in headers.get('Content-Security-Policy', ''), headers.get('Content-Security-Policy'))

    # Audit trail: invitation, acceptance, role change, export.
    status, _, resp = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/audit')
    actions = [e['action'] for e in resp['events']]
    check('audit has invite', 'share.invited' in actions, str(actions))
    check('audit has accepted', 'share.accepted' in actions, str(actions))
    check('audit has role change', 'share.role_changed' in actions, str(actions))
    check('audit has export', 'export.created' in actions, str(actions))
    # Lee cannot read the audit trail.
    status, _, resp = lee.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/audit')
    check('lee audit forbidden', status == 403, f'{status}')

    # Import a diagram XML.
    boundary = '----smokeboundary'
    xml = b'<?xml version="1.0"?><diagram><page name="Imported"><zone id="z1" kind="cde" name="CDE" x="0" y="0" width="480" height="336"/><system id="s1" kind="server" label="Srv" x="96" y="96" width="144" height="72"/><system id="s2" kind="database" label="DB" x="288" y="96" width="144" height="72"/><flow id="f1" from="s1" to="s2" label="q"/></page></diagram>'
    body_bytes = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="legacy.xml"\r\nContent-Type: application/xml\r\n\r\n').encode() + xml + (f'\r\n--{boundary}--\r\n').encode()
    status, headers, resp = dana.request('POST', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/imports', raw=body_bytes, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    parsed = json.loads(resp)
    check('import 201', status == 201 and parsed['import']['fileName'] == 'legacy.xml', f'{status} {parsed}')

    # Unsafe import rejected.
    unsafe = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" onload="alert(1)"/></svg>'
    body_bytes = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.svg"\r\nContent-Type: image/svg+xml\r\n\r\n').encode() + unsafe + (f'\r\n--{boundary}--\r\n').encode()
    status, headers, resp = dana.request('POST', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/imports', raw=body_bytes, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    parsed = json.loads(resp)
    check('unsafe import 422', status == 422 and parsed.get('error') == 'unsafe_file', f'{status} {parsed}')

    # Import original download carries the checksum.
    status, _, body = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/imports')
    import_id = body['imports'][0]['id']
    sha = body['imports'][0]['sha256']
    status, headers, resp = dana.request('GET', f'/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/imports/{import_id}/original')
    check('original 303', status == 303, f'{status}')
    status, headers, payload = dana.request('GET', headers['Location'])
    check('original bytes', status == 200 and payload == xml, f'{status}')
    check('original checksum', headers.get('X-Content-SHA256') == sha, headers.get('X-Content-SHA256'))

    # HTML responses carry the nonce CSP.
    status, headers, payload = dana.request('GET', '/')
    check('html csp nonce', 'nonce-' in headers.get('Content-Security-Policy', ''), headers.get('Content-Security-Policy'))
    check('html 200', status == 200, f'{status}')
    status, headers, payload = dana.request('GET', '/d/unknown-id')
    check('unknown diagram 404 html', status == 404, f'{status}')

    # Session expiry and lockout with short timers is not tested here.

    # Restore the seed state: move Fraud screening back outside every zone.
    status, _, body = dana.json('GET', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12')
    page = body['page']
    for s in page['shapes']:
        if s['id'] == 'shp-fraud':
            s['x'], s['y'] = 600, 600
    for c in page['connectors']:
        if c['id'] == 'con-fraud-settle':
            c['points'] = [[744, 636], [912, 636], [912, 432]]
    status, _, resp = dana.json('PUT', '/api/diagrams/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01/pages/5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12', page)
    check('seed restored', status == 200, f'{status}')

    # Sign out everywhere.
    status, _, resp = dana.request('DELETE', '/api/session')
    check('sign out 204', status == 204, f'{status}')
    status, _, resp = dana.json('GET', '/api/session')
    check('session gone', status == 401, f'{status}')

    print()
    if failures:
        print(f'{len(failures)} failures: {failures}')
        sys.exit(1)
    print('all checks passed')

main()
