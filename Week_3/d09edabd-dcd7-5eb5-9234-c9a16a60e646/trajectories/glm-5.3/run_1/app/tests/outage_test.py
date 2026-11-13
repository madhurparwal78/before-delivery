#!/usr/bin/env python3
"""Outage and recovery scenarios: a third instance with a dead Valkey picks it up."""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from http.cookiejar import CookieJar

C = 'http://127.0.0.1:4175'

def req(method, path, body=None, jar=None):
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {'Content-Type': 'application/json'} if body is not None else {}
    r = urllib.request.Request(C + path, data=data, headers=hdrs, method=method)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar if jar is not None else CookieJar()))
    try:
        resp = opener.open(r)
        return resp.status, json.loads(resp.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'null')
        except Exception:
            return e.code, None

results = []
def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS' if ok else 'FAIL') + ' ' + name + ((' -- ' + str(detail)[:120]) if not ok else ''))

# Boot instance C with an unreachable Valkey
proc = subprocess.Popen(
    ['node', 'dist/server.js'],
    cwd='/app',
    stdout=open('/tmp/server-c.log', 'w'),
    stderr=subprocess.STDOUT,
    env={
        'PATH': '/usr/local/bin:/usr/bin:/bin',
        'APP_PUBLIC_PORT': '4175',
        'INSTANCE_NAME': 'c',
        'VALKEY_URL': 'redis://127.0.0.1:6399/0',  # nothing listens here
        'DATABASE_URL': 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev',
        'S3_ENDPOINT': 'http://minio:9000',
        'S3_REGION': 'us-east-1',
        'S3_BUCKET': 'gf-dev',
        'S3_FORCE_PATH_STYLE': 'true',
        'S3_ACCESS_KEY_ID': 'gf-dev-root-71c3e0',
        'S3_SECRET_ACCESS_KEY': 'gf-dev-secret-4b8d92',
        'SMTP_HOST': 'mailpit',
        'SMTP_PORT': '1025',
        'MAIL_FROM': 'Keyway Bench <playtests@keyway.test>',
        'APP_PUBLIC_URL': 'http://127.0.0.1:4175',
    },
)

# Health answers while Valkey is down
deadline = time.time() + 15
up = False
while time.time() < deadline:
    try:
        c, b = req('GET', '/api/health')
        if c == 200:
            up = True
            check('health answers with valkey down', b['services']['valkey'] == 'down' and b['status'] == 'ok', b)
            break
    except Exception:
        time.sleep(0.5)
if not up:
    check('health answers with valkey down', False, 'no answer')
    proc.terminate()
    sys.exit(1)

# The rest of the app still serves
jar = CookieJar()
req('POST', '/api/auth/login', {'email': 'mara@lanternlane.test', 'password': 'keyway-owner-1'}, jar)
c, b = req('GET', '/api/rooms', jar=jar)
check('rooms list works while valkey down', c == 200, c)
c, b = req('GET', '/api/rooms/room_vault', jar=jar)
vault_room = b['room']
p2 = b['placements'][1]
c, b = req('PATCH', f'/api/rooms/room_vault/placements/{p2["id"]}', {'version': p2['version'], 'xMm': p2['xMm'] + 20}, jar=jar)
check('placement edit still saves (solo editing)', c == 200, f'{c} {b}')
c, b = req('POST', '/api/rooms/room_vault/locks', {'targetType': 'placement', 'targetId': p2['id']}, jar=jar)
check('locks refused 503', c == 503 and b == {'error': 'live_unavailable'}, f'{c} {b}')
c, b = req('POST', '/api/rooms/room_vault/walk-in', jar=jar)
check('walk-in refused 503', c == 503, f'{c}')
c, b = req('POST', '/api/rooms/room_vault/versions', {'label': 'Solo freeze'}, jar=jar)
check('freeze still works while valkey down', c == 201, f'{c} {b}')

# Now start a real Valkey on port 6399 (a second redis server) to test pickup
try:
    r = subprocess.run(['which', 'redis-server'], capture_output=True, text=True)
    have = r.stdout.strip()
except Exception:
    have = ''
if have:
    vproc = subprocess.Popen(['redis-server', '--port', '6399', '--save', '', '--appendonly', 'no'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    t0 = time.time()
    recovered = False
    while time.time() - t0 < 12:
        c, b = req('GET', '/api/health')
        if c == 200 and b['services']['valkey'] == 'up':
            recovered = True
            check('valkey picked up within 10s', True, f'{time.time()-t0:.1f}s')
            break
        time.sleep(1)
    if not recovered:
        check('valkey picked up within 10s', False, 'still down after 12s')
    # locks work again with no restart
    c, b = req('POST', '/api/rooms/room_vault/locks', {'targetType': 'placement', 'targetId': p2['id']}, jar=jar)
    check('locks work after recovery (no restart)', c == 200, f'{c} {b}')
    vproc.terminate()
else:
    # use the shared valkey via port-forward-free URL instead: point the env at the real one
    print('NOTE: redis-server not available; skipping live-recovery probe')

proc.terminate()
proc.wait()

print()
print(f'{sum(1 for r in results if r)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
