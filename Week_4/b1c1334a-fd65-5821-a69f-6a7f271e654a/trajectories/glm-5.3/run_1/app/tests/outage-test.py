#!/usr/bin/env python3
"""Outage behaviour: storage down and mail down, on a second instance."""
import json, urllib.request, urllib.error, http.cookiejar, sys
BASE='http://127.0.0.1:4174'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE+path, data=data, method=method)
    r.add_header('Content-Type','application/json'); r.add_header('Origin', BASE)
    try:
        with op.open(r) as res: return res.status, res.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

# health answers at all times
print('health:', req('GET', '/api/health'))

print('sign-in:', req('POST','/api/auth/sign-in',{'email':'mara@harbourlane.test','password':'ledger-demo-2026'})[0])
s,b = req('GET','/api/documents')
doc = json.loads(b)['documents'][0]['id']
s,b = req('GET', f'/api/documents/{doc}')
tables = {t['name']: t for t in json.loads(b)['tables']}
orders = tables['Orders']['id']

# share during mail outage: still 201, invite not sent
s,b = req('POST', f'/api/documents/{doc}/shares', {'email': 'outage@example.test', 'role': 'viewer', 'row_scope': 'all'})
parsed = json.loads(b)
print('share during outage:', s, parsed['share']['invite_status'])
assert s == 201 and parsed['share']['invite_status'] == 'not_sent', b[:200]

# resend still fails with 503
share_id = parsed['share']['id']
s,b = req('POST', f'/api/documents/{doc}/shares/{share_id}/resend')
print('resend during outage:', s)
assert s == 503, b[:200]

# export with storage down: 201, failed, no download
s,b = req('POST', f'/api/documents/{doc}/tables/{orders}/exports')
parsed = json.loads(b)
print('export during outage:', s, parsed['export']['status'])
assert s == 201 and parsed['export']['status'] == 'failed'
assert parsed['export']['download_url'] is None

# download of the failed export: 409 export_not_ready
s,b = req('GET', f'/api/exports/{parsed["export"]["id"]}/download')
print('download of failed export:', s)
assert s == 409

# grid editing keeps working while storage is down
s,b = req('GET', f'/api/documents/{doc}/tables/{orders}')
rows = json.loads(b)['table']['rows']
qty = [c for c in json.loads(b)['table']['columns'] if c['name'] == 'Qty'][0]['id']
cell = rows[0]['cells'][qty]
s,b = req('PUT', f'/api/documents/{doc}/tables/{orders}/rows/{rows[0]["id"]}/cells/{qty}', {'value': '7', 'revision': cell['revision']})
print('cell edit during outage:', s)
assert s == 200, b[:200]
s,b = req('POST', f'/api/documents/{doc}/undo')
print('undo during outage:', s)

# history still readable
s,b = req('GET', f'/api/documents/{doc}/history')
print('history entries:', len(json.loads(b)['entries']) >= 1)
print('OUTAGE TEST OK')
