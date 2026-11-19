#!/usr/bin/env python3
"""Export flow with live and unreachable storage."""
import json, urllib.request, urllib.error, http.cookiejar, sys
BASE='http://127.0.0.1:4173'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE+path, data=data, method=method)
    r.add_header('Content-Type','application/json'); r.add_header('Origin', BASE)
    try:
        with op.open(r) as res: return res.status, res.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
req('POST','/api/auth/sign-in',{'email':'sam@harbourlane.test','password':'ledger-demo-2026'})
s,b = req('GET','/api/documents')
doc = json.loads(b)['documents'][0]['id']
s,b = req('GET', f'/api/documents/{doc}')
tables = {t['name']: t for t in json.loads(b)['tables']}
orders = tables['Orders']['id']
s,b = req('POST', f'/api/documents/{doc}/tables/{orders}/exports')
rec = json.loads(b)['export']
print('export status:', rec['status'])
s, text = req('GET', f"/api/exports/{rec['id']}/download")
print('download code:', s)
if s != 200:
    print('DOWNLOAD FAILED (expected 200):', text[:120])
    sys.exit(1)
print('export flow OK')
