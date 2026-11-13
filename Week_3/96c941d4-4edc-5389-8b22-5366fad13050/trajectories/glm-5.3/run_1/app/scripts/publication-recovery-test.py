#!/usr/bin/env python3
"""Publication recovery: interrupted publication, pending state and retry.

Simulates the challenge maker's publication arriving while the definition
object is absent: the challenge stays private in proof-pending, and the retry
completes the publication once the object is restored.
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


def restore_level_object(digest, definition):
    # The definition object is restored by the maker retry path; we emulate the
    # server by writing the canonical bytes back with the same helper the app
    # uses (put-if-absent is idempotent for identical bytes).
    script = (
        "const { AwsClient } = await import('aws4fetch');\n"
        "const client = new AwsClient({accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, region: process.env.S3_REGION, service: 's3'});\n"
        "const body = " + json.dumps(json.dumps(definition, ensure_ascii=False).encode('utf-8').decode('utf-8')) + ";\n"
        f"const r = await client.fetch(`${{process.env.S3_ENDPOINT}}/${{process.env.S3_BUCKET}}/levels/{digest}.json`, {{method: 'PUT', body, headers: {{'Content-Type': 'application/json'}}}});\n"
        "console.log(r.status);\n"
    )
    result = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, timeout=30, cwd='/app')
    return result.stdout.strip()


def cells_all():
    return [{'lane': l, 'cell': c} for l in range(1, 6) for c in range(1, 10)]


maker = client()
s, _ = call(maker, 'POST', '/api/accounts', {'email': f'pubrecover.{UNIQUE}@example.com', 'password': 'publish-recover-pass', 'playerName': 'Recovery Maker'})
definition = {'title': 'Pending Tide', 'description': 'Interrupted publication.', 'difficulty': 'rough', 'seed': random.randint(1, 4294967295), 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 3, 'interval': 80, 'lane': 3}]}
s, level = call(maker, 'POST', '/api/levels', {'definition': definition})
check('level created', s == 201 and level['revision'] == 1)

# Prove the level with a winning playtest.
s, t = call(maker, 'POST', '/api/runs', {'mode': 'playtest', 'sourceId': level['id'], 'revision': 1, 'loadout': ['wick']})
proof = t['ticket']['id']
call(maker, 'POST', f'/api/runs/{proof}/start', {})
s, res = call(maker, 'POST', f'/api/runs/{proof}/submit', {'commands': [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 600})
check('proof accepted', s == 200 and res['state'] == 'accepted')

# Delete the definition object: publication is now interrupted.
status = delete_object(f"levels/{level['digest']}.json")
check('definition object removed', status == '204', status)

# Publish: must stay pending and private.
s, pending = call(maker, 'POST', f"/api/levels/{level['id']}/publish", {'expectedRevision': 1, 'proofRunId': proof})
check('publication pending 202', s == 202 and pending['state'] == 'proof-pending', f'{s} {pending}')
check('pending level pins the proof', pending['proofRunId'] == proof)
check('pending level keeps challenge private', pending['challengeDigest'] is None)

# No public card exists yet: direct reads are absent.
s, gone = call(client(), 'GET', f"/api/challenges/{pending['digest']}")
check('no public card while pending', s == 440 if False else s == 404, str(s))

# Retry the same publication (objects still absent): identical pending replay.
s, pending2 = call(maker, 'POST', f"/api/levels/{level['id']}/publish", {'expectedRevision': 1, 'proofRunId': proof})
check('retry publication stays pending', s == 202 and pending2['state'] == 'proof-pending')

# Restore the definition object, then retry: publication commits.
status = restore_level_object(level['digest'], definition)
check('definition object restored', status == '200', status)
s, committed = call(maker, 'POST', f"/api/levels/{level['id']}/publish", {'expectedRevision': 1, 'proofRunId': proof})
check('retry completes publication', s == 201 and committed.get('digest'), f'{s} {committed}')
digest = committed.get('digest')

# The challenge is now public and playable.
s, public_read = call(client(), 'GET', f'/api/challenges/{digest}')
check('published challenge readable', s == 200 and public_read['title'] == 'Pending Tide')
s, board = call(client(), 'GET', f'/api/challenges/{digest}/leaderboard')
check('board available', s == 200)

# Withdrawal after publication unlists it.
s, wd = call(maker, 'POST', f"/api/levels/{level['id']}/withdraw", {'expectedRevision': 1})
check('withdrawal unlists published challenge', s == 200 and wd['state'] == 'unlisted')

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL else 0)
