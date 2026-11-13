#!/usr/bin/env python3
"""Dependency recovery tests (object-absence variant).

Simulates unavailable evidence by deleting stored objects, then verifies:
- pending evidence work remains retryable and later settles;
- retry restores an absent object from authoritative staged bytes;
- database-backed reads stay readable while evidence is unavailable.

Run in the development environment against the live providers.
"""
import json
import random
import subprocess
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar

BASE = 'http://127.0.0.1:4173'
PASS = 0
FAIL = 0
FAILURES = []
UNIQUE = f'{int(time.time())}{random.randint(1000, 9999)}'


def check(name, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f'  ok  {name}')
    else:
        FAIL += 1
        FAILURES.append((name, detail))
        print(f'  FAIL {name} — {detail}')


def client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(opener, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with opener.open(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text) if text else None
        except json.JSONDecodeError:
            return e.code, {'raw': text}


def delete_object(key):
    script = (
        "const { AwsClient } = await import('aws4fetch');\n"
        "const client = new AwsClient({accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, region: process.env.S3_REGION, service: 's3'});\n"
        "const r = await client.fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/" + key + "`, {method: 'DELETE'});\n"
        "console.log(r.status);\n"
    )
    result = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, timeout=30, cwd='/app')
    return result.stdout.strip()


opener = client()
s, _ = call(opener, 'POST', '/api/accounts', {'email': f'dep.{UNIQUE}@example.com', 'password': 'dependency-pass', 'playerName': 'Dep Tester'})
s, t = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': ['wick']})
ticket = t['ticket']['id']
call(opener, 'POST', f'/api/runs/{ticket}/start', {})
commands = [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}]

print('\nPending evidence stays retryable and restores an absent object')
s, result = call(opener, 'POST', f'/api/runs/{ticket}/submit', {'commands': commands, 'endTick': 600})
check('submit accepted immediately', s == 200 and result['state'] == 'accepted')
digest = result['evidenceDigest']

# Delete the evidence object: replay evidence is now unavailable.
status = delete_object(f'evidence/{digest}.json')
check('evidence object deleted', status == '204', status)

# Replay-dependent reads return the evidence-unavailable response.
s, err = call(opener, 'GET', f'/api/results/{ticket}/replay')
check('replay evidence unavailable 503', s == 503 and err['error']['code'] == 'EVIDENCE_UNAVAILABLE' and err['error']['message'] == 'Replay evidence unavailable. Try again.')
# Database-backed result summaries remain readable.
s, run = call(opener, 'GET', f'/api/runs/{ticket}')
check('result summary readable during evidence absence', s == 200 and run['result']['state'] == 'accepted')
s, progress = call(opener, 'GET', '/api/progress')
check('progress readable during evidence absence', s == 200)

# Retry restores the absent object from authoritative staged bytes.
s, retry = call(opener, 'POST', f'/api/runs/{ticket}/retry', {})
check('retry restores absent object and keeps result', s == 200 and retry['state'] == 'accepted' and retry['metrics'] == result['metrics'])
s, replay = call(opener, 'GET', f'/api/results/{ticket}/replay')
check('replay available after restoration', s == 200 and replay['commands'] == commands)

print('\nDiscovery truthfulness')
s, found = call(opener, 'GET', '/api/challenges?q=')
check('discovery responds', s == 200 and isinstance(found.get('challenges'), list))
check('indexing state reported', found.get('indexing') in ('pending', 'current'))

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL else 0)
