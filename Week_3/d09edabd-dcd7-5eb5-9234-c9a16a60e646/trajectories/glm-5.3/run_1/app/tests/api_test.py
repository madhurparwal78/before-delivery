#!/usr/bin/env python3
"""Full API test pass against the running app (both instances)."""
import json
import sys
import time
import math
import struct
import urllib.request
import urllib.error
from http.cookiejar import CookieJar

A = 'http://127.0.0.1:4173'
B = 'http://127.0.0.1:4174'
results = []
RUN_ID = str(int(time.time()))

def req(base, method, path, body=None, headers=None, jar=None, raw=False):
    url = base + path
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        if raw:
            data = body
        else:
            data = json.dumps(body).encode()
            hdrs.setdefault('Content-Type', 'application/json')
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar if jar is not None else CookieJar()))
    try:
        resp = opener.open(r)
        payload, code, rh = resp.read(), resp.status, dict(resp.headers)
    except urllib.error.HTTPError as e:
        payload, code, rh = e.read(), e.code, dict(e.headers)
    try:
        return code, json.loads(payload) if payload else None, rh
    except Exception:
        return code, payload, rh

def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS' if ok else 'FAIL') + ' ' + name + ((' -- ' + str(detail)[:140]) if not ok else ''))

def login(base, email, pw, jar=None):
    return req(base, 'POST', '/api/auth/login', {'email': email, 'password': pw}, jar=jar)

# Clean any leftover running sessions so room edits are not refused.
_jar_clean = CookieJar()
req(A, 'POST', '/api/auth/login', {'email': 'mara@lanternlane.test', 'password': 'keyway-owner-1'}, jar=_jar_clean)
c, b, _ = req(A, 'GET', '/api/rooms', jar=_jar_clean)
for _r in (b or {}).get('rooms', []):
    c2, s2, _ = req(A, 'GET', f"/api/rooms/{_r['id']}/playtests", jar=_jar_clean)
    for _s in (s2 or {}).get('sessions', []):
        if _s['state'] == 'running':
            req(A, 'POST', f"/api/playtests/{_s['id']}/end", jar=_jar_clean)

jar_a, jar_b, jar_ines = CookieJar(), CookieJar(), CookieJar()
c, b, _ = login(A, 'mara@lanternlane.test', 'keyway-owner-1', jar_a)
check('login 200', c == 200 and b['user']['role'] == 'owner', f'{c} {b}')
c, b, _ = login(B, 'tobi@lanternlane.test', 'keyway-codesign-1', jar_b)
check('co-designer login on B', c == 200 and b['user']['role'] == 'co_designer', f'{c}')
login(A, 'ines@brasskey.test', 'keyway-other-1', jar_ines)
c, b, _ = req(A, 'GET', '/api/me', jar=jar_a)
check('GET /me shape', c == 200 and b['workspace']['name'] == 'Lantern Lane Escapes', f'{c} {b}')

# DP-02 signed out
c, b, _ = req(A, 'GET', '/api/rooms')
check('signed out rooms 401', c == 401 and b == {'error': 'unauthenticated'}, f'{c} {b}')
c, b, _ = req(A, 'POST', '/api/playtests', {'roomId': 'x', 'startsAt': '2026-01-01T00:00:00Z'})
check('signed out post 401', c == 401, f'{c}')

# signup
jar_new = CookieJar()
c, b, _ = req(A, 'POST', '/api/auth/signup', {'email': f'own{int(time.time())}@v.test', 'password': 'longenough1', 'displayName': 'Olive', 'venueName': 'Olive Rooms'}, jar=jar_new)
check('signup 201', c == 201 and b['user']['role'] == 'owner', f'{c} {b}')
c, b, _ = req(A, 'GET', '/api/rooms', jar=jar_new)
check('signup seeds 5 starters', c == 200 and sum(1 for r in b['rooms'] if r['starter']) == 5, f'{c} {len(b.get("rooms", []))}')
c, b, _ = req(A, 'POST', '/api/auth/signup', {'email': 'mara@lanternlane.test', 'password': 'longenough1', 'displayName': 'X', 'venueName': 'X'})
check('duplicate email 409', c == 409 and b == {'error': 'email_taken'}, f'{c} {b}')
c, b, _ = login(A, 'MARA@Lanternlane.test', 'keyway-owner-1')
check('email case-insensitive', c == 200, f'{c}')
c, b, _ = login(A, 'mara@lanternlane.test', 'wrong-password-x')
check('bad credentials 401', c == 401 and b == {'error': 'invalid_credentials'}, f'{c}')

# DP-03 isolation
c, b, _ = req(A, 'GET', '/api/rooms', jar=jar_ines)
brass_room = b['rooms'][0]['id']
c, b, _ = req(A, 'GET', f'/api/rooms/{brass_room}', jar=jar_a)
check('cross-workspace room 404', c == 404 and b == {'error': 'not_found'}, f'{c} {b}')
c, b, _ = req(A, 'GET', '/api/rooms', jar=jar_a)
vault = [r for r in b['rooms'] if r['name'] == 'Vault'][0]['id']
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}/versions', jar=jar_ines)
check('other workspace versions 404', c == 404, f'{c}')

# DP-04 error shapes
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
placements, nodes = b['placements'], b['nodes']
p2 = placements[1]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': p2['version'] - 1, 'xMm': 100}, jar=jar_a)
check('stale 412 with current', c == 412 and b['error'] == 'stale_version' and 'current' in b, f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'box', 'label': '', 'xMm': 0, 'zMm': 0, 'widthMm': 100, 'depthMm': 100, 'heightMm': 100}, jar=jar_a)
check('validation 422 shape', c == 422 and b['error'] == 'validation' and isinstance(b['errors'], dict), f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'chair', 'label': 'x', 'xMm': 0, 'zMm': 0, 'widthMm': 100, 'depthMm': 100, 'heightMm': 100}, jar=jar_a)
check('unknown kind 422 on field', c == 422 and 'kind' in b['errors'], f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/locks', {'targetType': 'chair', 'targetId': 'x'}, jar=jar_a)
check('lock unknown targetType 422', c == 422 and 'targetType' in b['errors'], f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'box', 'label': 'Big', 'xMm': 0, 'zMm': 0, 'widthMm': 4000, 'depthMm': 100, 'heightMm': 100}, jar=jar_a)
check('placement wider than room 422', c == 422, f'{c}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}/placements/never-existed', jar=jar_a)
check('never-had id 404', c == 404, f'{c}')

# DP-21 trigger rules
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
check('nodes carry version', b['nodes'] and all('version' in n for n in b['nodes']), f'{b["nodes"][:1]}')
ledger = b['nodes'][0]
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/nodes', {'title': 'Second exit', 'kind': 'exit'}, jar=jar_a)
check('second exit 422', c == 422 and b['errors']['kind'] == 'room already has an exit', f'{c} {b}')
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/nodes/{ledger["id"]}', {'version': ledger['version'], 'prerequisites': [ledger['id']]}, jar=jar_a)
check('self prerequisite 422', c == 422 and 'prerequisites' in b['errors'], f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
exit_node = [n for n in b['nodes'] if n['kind'] == 'exit'][0]
drawer = [n for n in b['nodes'] if n['title'] == 'Drawer sensor'][0]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/nodes/{drawer["id"]}', {'version': drawer['version'], 'prerequisites': [exit_node['id']]}, jar=jar_a)
check('loop 422', c == 422 and b['errors']['prerequisites'] == 'would create a loop', f'{c} {b}')

# DP-18 locks
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/locks', {'targetType': 'placement', 'targetId': p2['id']}, jar=jar_a)
check('mara takes lock', c == 200 and b['lock']['holder']['displayName'] == 'Mara Quint', f'{c} {b}')
c, b, _ = req(B, 'POST', f'/api/rooms/{vault}/locks', {'targetType': 'placement', 'targetId': p2['id']}, jar=jar_b)
check('tobi 409 names holder', c == 409 and b['error'] == 'locked' and b['holder']['displayName'] == 'Mara Quint' and 'expiresInSeconds' in b, f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
p2v = [p for p in b['placements'] if p['id'] == p2['id']][0]
c, b, _ = req(B, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': p2v['version'], 'xMm': 500}, jar=jar_b)
check('patch while locked 409', c == 409 and b['error'] == 'locked', f'{c} {b}')
c, b, _ = req(B, 'POST', f'/api/rooms/{vault}/locks', {'targetType': 'placement', 'targetId': p2['id'], 'takeOver': True}, jar=jar_b)
check('takeover to tobi', c == 200 and b['lock']['holder']['displayName'] == 'Tobi Ferreira', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/locks', {'targetType': 'placement', 'targetId': p2['id']}, jar=jar_a)
check('former holder 409', c == 409 and b['holder']['displayName'] == 'Tobi Ferreira', f'{c} {b}')
c, b, _ = req(A, 'DELETE', f'/api/rooms/{vault}/locks/placement/{p2["id"]}', jar=jar_a)
check('release by non-holder 409', c == 409, f'{c}')
c, b, _ = req(B, 'DELETE', f'/api/rooms/{vault}/locks/placement/{p2["id"]}', jar=jar_b)
check('holder release 204', c == 204, f'{c}')

# DP-49 revisions, change log, Op-Id
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
rev0 = b['room']['revision']
p2v = [p for p in b['placements'] if p['id'] == p2['id']][0]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': p2v['version'], 'xMm': p2v['xMm'] + 10}, {'Op-Id': 'op-abc-' + RUN_ID}, jar_a)
check('patch with Op-Id 200', c == 200 and b['placement']['xMm'] == p2v['xMm'] + 10, f'{c}')
first_version = b['placement']['version']
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
check('revision +1', b['room']['revision'] == rev0 + 1, f'{b["room"]["revision"]} vs {rev0}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}/changes?since={rev0}', jar=jar_a)
check('change log entry', c == 200 and len(b['changes']) == 1 and b['changes'][0]['opId'] == 'op-abc-' + RUN_ID and b['changes'][0]['kind'] == 'update', f'{b}')
c, b2, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': p2v['version'], 'xMm': p2v['xMm'] + 10}, {'Op-Id': 'op-abc-' + RUN_ID}, jar_a)
check('replay returns first result', c == 200 and b2['placement']['version'] == first_version, f'{c} {b2 and b2.get("placement", {}).get("version")} vs {first_version}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
p3 = b['placements'][2]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p3["id"]}', {'version': p3['version'], 'xMm': 5}, {'Op-Id': 'op-abc-' + RUN_ID}, jar_a)
check('same op id other placement 409', c == 409 and b == {'error': 'op_id_reused'}, f'{c} {b}')
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': 99, 'xMm': 1}, {'Op-Id': 'short!'}, jar_a)
check('bad op id 422', c == 422 and 'opId' in b['errors'], f'{c} {b}')

# DP-51 undo (drain any entries from earlier runs first)
for _ in range(20):
    c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/undo', jar=jar_a)
    if c != 200:
        break
# make one fresh editable change, then undo it
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
p2v2 = [p for p in b['placements'] if p['id'] == p2['id']][0]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p2["id"]}', {'version': p2v2['version'], 'xMm': p2v2['xMm'] + 5}, None, jar_a)
check('fresh patch for undo', c == 200, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/undo', jar=jar_a)
check('undo 200 position', c == 200 and b['undone']['field'] == 'position' and b['undone']['placementId'] == p2['id'], f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/undo', jar=jar_a)
check('nothing to undo 409', c == 409 and b == {'error': 'nothing_to_undo'}, f'{c} {b}')

# DP-49 deleted placement 410
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'box', 'label': 'Doomed'}, jar=jar_a)
doomed = b['placement']
c, b, _ = req(A, 'DELETE', f'/api/rooms/{vault}/placements/{doomed["id"]}', jar=jar_a)
check('delete placement 204', c == 204, f'{c}')
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{doomed["id"]}', {'version': doomed['version'], 'xMm': 1}, jar=jar_a)
check('deleted placement PATCH 410', c == 410 and b['error'] == 'placement_deleted' and b['label'] == 'Doomed' and b['deletedBy']['displayName'] == 'Mara Quint', f'{c} {b}')
c, b, _ = req(A, 'DELETE', f'/api/rooms/{vault}/placements/{doomed["id"]}', jar=jar_a)
check('deleted placement DELETE 410', c == 410, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements/{doomed["id"]}/scene-move', {'direction': 'up'}, jar=jar_a)
check('deleted placement scene-move 410', c == 410, f'{c}')

# DP-52 scene move
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
order = b['sceneOrder']
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements/{order[1]}/scene-move', {'direction': 'up'}, {'Op-Id': 'scene-op-' + RUN_ID}, jar_a)
check('scene move up 200', c == 200 and b['sceneOrder'][0] == order[1] and b['revision'] > 0, f'{c} {b}')
c, cur2, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements/{cur2["sceneOrder"][0]}/scene-move', {'direction': 'up'}, jar=jar_a)
check('already first 422', c == 422 and b['errors']['direction'] == 'already first', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements/{cur2["sceneOrder"][-1]}/scene-move', {'direction': 'down'}, jar=jar_a)
check('already last 422', c == 422 and b['errors']['direction'] == 'already last', f'{c} {b}')

# DP-28 playtest lifecycle
c, b, _ = req(B, 'POST', '/api/playtests', {'roomId': vault, 'startsAt': '2020-01-01T00:00:00Z'}, jar=jar_b)
check('co-designer schedule 403', c == 403 and b == {'error': 'forbidden'}, f'{c} {b}')
c, b, _ = req(A, 'POST', '/api/playtests', {'roomId': vault, 'startsAt': '2020-01-01T00:00:00Z'}, jar=jar_a)
check('past time 422', c == 422 and b['errors']['startsAt'] == 'must be between 5 minutes ago and 30 days ahead', f'{c} {b}')
c, b, _ = req(A, 'POST', '/api/playtests', {'roomId': vault, 'startsAt': 'not-a-time'}, jar=jar_a)
check('unparseable 422', c == 422 and b['errors']['startsAt'] == 'not a valid time', f'{c} {b}')
starts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))
c, b, _ = req(A, 'POST', '/api/playtests', {'roomId': vault, 'startsAt': starts}, jar=jar_a)
check('schedule 201', c == 201 and b['session']['state'] == 'scheduled', f'{c}')
sid = b['session']['id']
c, b, _ = req(A, 'POST', f'/api/playtests/{sid}/start', jar=jar_a)
check('start from scheduled 409', c == 409 and b['error'] == 'invalid_transition' and b['state'] == 'scheduled', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/playtests/{sid}/open', jar=jar_a)
check('open to lobby', c == 200 and b['session']['state'] == 'lobby', f'{c}')
c, b, _ = req(A, 'POST', f'/api/playtests/{sid}/cancel', jar=jar_a)
check('cancel from lobby', c == 200 and b['session']['state'] == 'cancelled', f'{c}')
c, b, _ = req(A, 'POST', f'/api/playtests/{sid}/open', jar=jar_a)
check('open from cancelled 409', c == 409, f'{c}')

# walk-in
c, w1, _ = req(A, 'POST', f'/api/rooms/{vault}/walk-in', jar=jar_a)
check('walk-in 201 running', c == 201 and w1['session']['state'] == 'running' and w1['session']['kind'] == 'walk_in', f'{c}')
wid = w1['session']['id']
c, b, _ = req(B, 'POST', f'/api/rooms/{vault}/walk-in', jar=jar_b)
check('second walk-in room_busy', c == 409 and b == {'error': 'room_busy'}, f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
p3 = b['placements'][2]
c, b, _ = req(A, 'PATCH', f'/api/rooms/{vault}/placements/{p3["id"]}', {'version': p3['version'], 'xMm': 50}, jar=jar_a)
check('edit during playtest 409', c == 409 and b == {'error': 'playtest_running'}, f'{c} {b}')

# host solves the chain up to the lock, which then fires on its own
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
by_title = {n['title']: n for n in b['nodes']}
for title in ['Ledger cipher', 'Drawer sensor']:
    c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/solves', {'nodeId': by_title[title]['id']}, jar=jar_a)
    check(f'host solve {title}', c == 200 and b['alreadySolved'] is False, f'{c}')
solves = b['session']['solves']
check('lock fired on its own', any(s['solvedBy'] is None for s in solves), f'{solves}')

# hints
c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/hints', {'text': 'look at the desk'}, jar=jar_a)
check('hint 201', c == 201 and b['hintCooldownSeconds'] > 0, f'{c}')
c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/hints', {'text': 'again'}, jar=jar_a)
check('hint cooldown 429', c == 429 and b['error'] == 'hint_cooldown' and b['retryAfterSeconds'] > 0, f'{c} {b}')
c, b, _ = req(B, 'POST', f'/api/playtests/{wid}/hints', {'text': 'tobi hint'}, jar=jar_b)
check('non-host hint 403', c == 403, f'{c}')

# invites
c, inv1, _ = req(A, 'POST', f'/api/playtests/{wid}/invites', {'email': 'rae@example.test'}, jar=jar_a)
check('invite 201 with joinUrl', c == 201 and '/play/' in inv1['invite']['joinUrl'], f'{c} {inv1}')
c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/invites', {'email': 'rae@example.test'}, jar=jar_a)
check('duplicate invite 422', c == 422 and b['errors']['email'] == 'already invited', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/invites', {'email': 'bad'}, jar=jar_a)
check('bad email 422', c == 422, f'{c}')

# tester flow
token = inv1['invite']['joinUrl'].split('/play/')[1]
c, b, _ = req(A, 'GET', f'/api/play/{token}')
check('play page 200', c == 200 and 'nodes' in b and 'session' in b and 'me' in b, f'{c}')
check('play page hides answers and emails', all(n.get('answer') is None for n in b['nodes']) and all('email' not in t for t in b['testers']), f'{b["nodes"][:1]}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/solves', {'nodeId': ledger['id']})
check('solve not joined 409', c == 409 and b == {'error': 'not_joined'}, f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/join', {'displayName': 'Rae'})
check('join 200', c == 200 and b['me'] == {'displayName': 'Rae', 'joined': True}, f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/join', {'displayName': '  Rae Two  '})
check('rejoin replaces name', c == 200 and b['me']['displayName'] == 'Rae Two', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/join', {'displayName': ''})
check('empty name 422', c == 422 and 'displayName' in b['errors'], f'{c} {b}')

# after ledger, drawer and the maglock fired, Blacklight cue fires too and Safe dial opens
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
by_title2 = {n['title']: n for n in b['nodes']}
safe = by_title2.get('Safe dial')
c, b, _ = req(A, 'POST', f'/api/play/{token}/solves', {'nodeId': safe['id'], 'answer': 'definitely-wrong'})
check('wrong answer 422', c == 422 and b['errors']['answer'] == 'incorrect', f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
by_title3 = {n['title']: n for n in b['nodes']}
exit_n = by_title3['Vault door']
c, b, _ = req(A, 'POST', f'/api/play/{token}/solves', {'nodeId': exit_n['id']})
check('prereq unsolved 409', c == 409 and b == {'error': 'prerequisites_unsolved'}, f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
maglock = [n for n in b['nodes'] if n['kind'] == 'lock'][0]
c, b, _ = req(A, 'POST', f'/api/play/{token}/solves', {'nodeId': maglock['id']})
check('solve lock 422 fires on its own', c == 422 and b['errors']['nodeId'] == 'fires on its own', f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/solves', {'nodeId': by_title2['Ledger cipher']['id']})
check('already solved 200 true', c == 200 and b.get('alreadySolved') is True, f'{c} {str(b)[:80]}')
c, b, _ = req(A, 'POST', f'/api/play/{token}/position', {'xMm': 100, 'zMm': 200, 'headingDeg': 45})
check('position 204', c == 204, f'{c}')
c, b, _ = req(A, 'GET', '/api/rooms')
check('capability token is not a session', c == 401, f'{c}')

# control rules
c, b, _ = req(B, 'POST', f'/api/playtests/{wid}/end', jar=jar_b)
check('non-host end 403', c == 403, f'{c}')
c, b, _ = req(A, 'POST', f'/api/playtests/{wid}/end', jar=jar_a)
check('host ends stopped', c == 200 and b['session']['state'] == 'ended' and b['session']['outcome'] == 'stopped', f'{c}')
c, b, _ = req(A, 'GET', f'/api/playtests/{wid}/debrief', jar=jar_a)
check('debrief 200', c == 200 and b['outcome'] == 'stopped' and 'puzzles' in b and 'chokePoint' in b and 'hintsUsed' in b and 'emailStatus' in b, f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/play/{token}')
check('expired invite 410', c == 410 and b == {'error': 'invite_expired'}, f'{c} {b}')
c, b, _ = req(A, 'GET', '/api/play/unknown-token-xyz')
check('unknown play token 404', c == 404 and b == {'error': 'not_found'}, f'{c} {b}')

# DP-40 freeze idempotency
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/versions', {'label': 'Idem test'}, {'Idempotency-Key': 'idem-' + RUN_ID}, jar_a)
check('freeze with key 201', c == 201, f'{c}')
num1 = b['version']['number']
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/versions', {'label': 'Idem test'}, {'Idempotency-Key': 'idem-' + RUN_ID}, jar_a)
check('idempotent replay same number', c == 201 and b['version']['number'] == num1, f'{c} {b["version"]["number"] if b and "version" in b else b} vs {num1}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/versions', {'label': 'Different'}, {'Idempotency-Key': 'idem-' + RUN_ID}, jar_a)
check('same key different body 409', c == 409 and b == {'error': 'idempotency_key_reused'}, f'{c} {b}')

# DP-41 numbering and states
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/versions', {'label': 'Second'}, jar=jar_a)
num2 = b['version']['number']
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}/versions', jar=jar_a)
vs = b['versions']
check('gap-free numbering', sorted(v['number'] for v in vs) == list(range(1, len(vs) + 1)), f'{[v["number"] for v in vs]}')
check('exactly one frozen', sum(1 for v in vs if v['state'] == 'frozen') == 1, f'{[(v["number"], v["state"]) for v in vs]}')
sup = [v for v in vs if v['state'] == 'superseded']
check('supersededBy n+1', all(v['supersededBy'] == v['number'] + 1 for v in sup), f'{[(v["number"], v["supersededBy"]) for v in sup]}')

# DP-42 link controls
frozen = [v for v in vs if v['state'] == 'frozen'][0]
c, b, _ = req(B, 'POST', f'/api/versions/{frozen["id"]}/link', jar=jar_b)
check('co-designer regenerate 403', c == 403, f'{c}')
c, b, _ = req(A, 'POST', f'/api/versions/{frozen["id"]}/link', jar=jar_a)
check('regenerate 201', c == 201 and '/pack/' in b['packUrl'], f'{c} {b}')
new_token = b['packUrl'].split('/pack/')[1]
c, b, _ = req(A, 'POST', f'/api/versions/{frozen["id"]}/link', jar=jar_a)
check('regenerate again makes new', c == 201 and b['packUrl'].split('/pack/')[1] != new_token, f'{c}')
final_token = b['packUrl'].split('/pack/')[1]
c, b, _ = req(A, 'GET', f'/api/pack/{new_token}')
check('old link 404 after regenerate', c == 404, f'{c}')
c, b, _ = req(A, 'GET', f'/api/pack/{final_token}')
check('new link 200', c == 200 and b['version']['number'] == frozen['number'], f'{c}')
c, b, _ = req(A, 'DELETE', f'/api/versions/{frozen["id"]}/link', jar=jar_a)
check('revoke 204', c == 204, f'{c}')
c, b, _ = req(A, 'GET', f'/api/pack/{final_token}')
check('revoked link 404', c == 404, f'{c}')
c, b, _ = req(A, 'DELETE', f'/api/pack/{final_token}')
check('pack write 405 read_only', c == 405 and b == {'error': 'read_only'}, f'{c} {b}')

# DP-39/43 freeze with prop bytes
glb = b'glTF' + struct.pack('<II', 2, 12) + b'PROPBYTES123'
boundary = '----KB'
def mp(fields, file_bytes=None, filename='chest.glb'):
    out = b''
    for k, v in fields:
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    if file_bytes is not None:
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        out += file_bytes + b'\r\n'
    out += f'--{boundary}--\r\n'.encode()
    return out

c, b, _ = req(A, 'POST', '/api/props', mp([('name', 'Coffre à secrets'), ('widthMm', '900'), ('depthMm', '550'), ('heightMm', '500')], glb), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, jar_a, raw=True)
check('prop upload 201', c == 201 and b['prop']['bytes'] == len(glb), f'{c} {b}')
prop = b['prop']
c, b, h = req(A, 'GET', f'/api/props/{prop["id"]}/file', jar=jar_a)
check('download byte-identical', c == 200 and b == glb, f'{c} {len(b) if isinstance(b, bytes) else b}')
etag = h.get('ETag', '')
check('etag sha256 quoted', etag == f'"{prop["sha256"]}"', f'{etag}')
cd = h.get('Content-Disposition', '')
check('content-disposition exact', cd == 'attachment; filename="Coffre _ secrets.glb"; filename*=UTF-8\'\'Coffre%20%C3%A0%20secrets.glb', cd)
c, b, h = req(A, 'GET', f'/api/props/{prop["id"]}/file', None, {'If-None-Match': etag}, jar_a)
check('conditional 304', c == 304, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'prop', 'label': 'Coffre à secrets', 'propId': prop['id'], 'xMm': 100, 'zMm': 100}, jar=jar_a)
check('place prop 201 with prop sizes', c == 201 and b['placement']['widthMm'] == 900, f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'box', 'label': 'P', 'propId': prop['id'], 'xMm': 0, 'zMm': 0}, jar=jar_a)
check('box with propId 422', c == 422, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/placements', {'kind': 'prop', 'label': 'P', 'xMm': 0, 'zMm': 0}, jar=jar_a)
check('prop without propId 422', c == 422, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/versions', {'label': 'With prop'}, jar=jar_a)
check('freeze with prop 201', c == 201, f'{c}')
pk = b['version']['packUrl'].split('/pack/')[1]
c, b, _ = req(A, 'GET', f'/api/pack/{pk}')
check('pack json length objects', c == 200 and b['room']['width'] == {'mm': 3000, 'm': '3.000', 'ft': '9\' 10 1/8"'}, f'{c} {b and b.get("room", {}).get("width")}')
check('pack nodes needs titles', c == 200 and all(isinstance(n['needs'], list) for n in b['nodes']), f'{b and b.get("nodes", [])[:1]}')
c, b, _ = req(A, 'DELETE', f'/api/props/{prop["id"]}', jar=jar_a)
check('delete placed prop 409 in use', c == 409 and b == {'error': 'prop_in_use'}, f'{c} {b}')
c, cur, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
placed = [p for p in cur['placements'] if p['propId'] == prop['id']][0]
req(A, 'DELETE', f'/api/rooms/{vault}/placements/{placed["id"]}', jar=jar_a)
c, b, _ = req(A, 'DELETE', f'/api/props/{prop["id"]}', jar=jar_a)
check('delete prop after unplace 204', c == 204, f'{c}')
c, b, _ = req(A, 'GET', f'/api/pack/{pk}')
check('pack still lists prop file', c == 200 and any(p['id'] == prop['id'] for p in b['props']), f'{c}')
c, data, h = req(A, 'GET', f'/api/pack/{pk}/props/{prop["id"]}')
check('pack prop bytes identical', c == 200 and data == glb, f'{c} {len(data) if isinstance(data, bytes) else data}')
c, b, _ = req(A, 'GET', f'/api/pack/{pk}/snapshot')
check('snapshot 200 json', c == 200, f'{c}')

# DP-24 prop validation
c, b, _ = req(A, 'POST', '/api/props', mp([('name', 'Bad'), ('widthMm', '900'), ('depthMm', '550'), ('heightMm', '500')], b'plain text', 'x.txt'), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, jar_a, raw=True)
check('non-gltf 422', c == 422 and b['errors']['file'] == 'not a glTF 2.0 file', f'{c} {b}')
big = b'glTF' + struct.pack('<II', 2, 12) + b'x' * 5_000_001
c, b, _ = req(A, 'POST', '/api/props', mp([('name', 'Big'), ('widthMm', '900'), ('depthMm', '550'), ('heightMm', '500')], big, 'big.glb'), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, jar_a, raw=True)
check('oversize prop 413', c == 413 and b == {'error': 'too_large'}, f'{c} {b}')
c, b, _ = req(A, 'POST', '/api/props', mp([('name', ''), ('widthMm', '900'), ('depthMm', '550'), ('heightMm', '500')], glb), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, jar_a, raw=True)
check('prop without name 422', c == 422, f'{c}')
gltf_json = json.dumps({'asset': {'version': '2.0'}, 'scenes': []}).encode()
c, b, _ = req(A, 'POST', '/api/props', mp([('name', 'Json gltf'), ('widthMm', '900'), ('depthMm', '550'), ('heightMm', '500')], gltf_json, 'm.gltf'), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, jar_a, raw=True)
check('json gltf accepted', c == 201 and b['prop']['contentType'] == 'model/gltf+json', f'{c} {b}')
req(A, 'DELETE', f'/api/props/{b["prop"]["id"]}', jar=jar_a)

# DP-44 units rule
def ft_inches(mm):
    s = (mm * 160 + 127) // 254
    feet = s // 192
    r = s % 192
    inches = r // 16
    num = r % 16
    if num == 0:
        return f"{feet}' {inches}\""
    g = math.gcd(num, 16)
    return f"{feet}' {inches} {num//g}/{16//g}\""
samples = {10: '0\' 0 3/8"', 304: '0\' 11 15/16"', 305: '1\' 0"', 2400: '7\' 10 1/2"', 3000: '9\' 10 1/8"', 3658: '12\' 0"', 4000: '13\' 1 1/2"', 5000: '16\' 4 7/8"'}
bad = [(mm, ft_inches(mm), want) for mm, want in samples.items() if ft_inches(mm) != want]
check('feet-inches published examples', not bad, bad)
def inch_field(mm):
    s = (mm * 160 + 127) // 254
    r = s % 192
    return r // 16
check('no unreduced fractions', all('16/16' not in ft_inches(mm) for mm in range(0, 30001, 37)), '16/16 found')
check('inches never reach 12', all(inch_field(mm) < 12 for mm in range(0, 30001, 37)), '12 inches found')

# DP-05 limits/origin
big_json = ('{"a":"' + 'x' * 200000 + '"}').encode()
c, b, _ = req(A, 'POST', '/api/rooms', big_json, {'Content-Type': 'application/json'}, jar_a, raw=True)
check('oversize json 413', c == 413 and b == {'error': 'too_large'}, f'{c} {b}')
c, b, _ = req(A, 'POST', '/api/auth/signup', {'email': 'x@y.test', 'password': 'longenough1', 'displayName': 'A', 'venueName': 'V'}, {'Origin': 'http://evil.example'})
check('cross-origin write 403', c == 403 and b == {'error': 'cross_origin'}, f'{c} {b}')

# DP-07 health
c, b, _ = req(A, 'GET', '/api/health')
check('health shape', c == 200 and b['status'] == 'ok' and b['instance'] and set(b['services']) == {'postgres', 'valkey', 'minio', 'mail'}, f'{c} {b}')

# DP-32 invite limits
starts2 = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 7200))
c, s2, _ = req(A, 'POST', '/api/playtests', {'roomId': vault, 'startsAt': starts2}, jar=jar_a)
sid2 = s2['session']['id']
req(A, 'POST', f'/api/playtests/{sid2}/open', jar=jar_a)
codes = []
for i in range(6):
    c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites', {'email': f't{i}@ex.test'}, jar=jar_a)
    codes.append(c)
check('six invites accepted', codes == [201] * 6, codes)
c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites', {'email': 't7@ex.test'}, jar=jar_a)
check('seventh roster_full', c == 409 and b == {'error': 'roster_full'}, f'{c} {b}')
c, b, _ = req(A, 'GET', f'/api/playtests/{sid2}', jar=jar_a)
first_invite = b['session']['testers'][0]['inviteId']
c, b, _ = req(A, 'DELETE', f'/api/playtests/{sid2}/invites/{first_invite}', jar=jar_a)
check('revoke invite 204', c == 204, f'{c}')
c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites', {'email': 't7@ex.test'}, jar=jar_a)
check('invite after revoke 201', c == 201, f'{c}')
c, cur3, _ = req(A, 'GET', f'/api/playtests/{sid2}', jar=jar_a)
kept_invite = [t for t in cur3['session']['testers'] if t['inviteId'] != first_invite][0]['inviteId']
c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites/{kept_invite}/resend', jar=jar_a)
check('resend 202', c == 202 and b['invite']['emailStatus'] in ('sent', 'queued'), f'{c} {b}')
c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites/{first_invite}/resend', jar=jar_a)
check('resend revoked invite 404', c == 404, f'{c}')
req(A, 'POST', f'/api/playtests/{sid2}/cancel', jar=jar_a)
c, b, _ = req(A, 'POST', f'/api/playtests/{sid2}/invites', {'email': 'later@example.test'}, jar=jar_a)
check('invite to closed session 409', c == 409 and b == {'error': 'session_closed'}, f'{c} {b}')

# DP-22 stats everywhere
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
check('stats after edits', b['room']['stats']['total'] == 6 and 'longestRun' in b['room']['stats'], f'{b["room"]["stats"]}')

# DP-55 restore
c, b, _ = req(A, 'GET', f'/api/rooms/{vault}/versions', jar=jar_a)
target = [v for v in b['versions'] if v['state'] == 'superseded'][0]
c, b, _ = req(B, 'POST', f'/api/rooms/{vault}/restore', {'versionId': target['id']}, jar=jar_b)
check('co-designer restore 403', c == 403, f'{c}')
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/restore', {'versionId': 'unknown-version-zzz'}, jar=jar_a)
check('unknown version 422', c == 422 and b['errors']['versionId'] == 'unknown version', f'{c} {b}')
c, before, _ = req(A, 'GET', f'/api/rooms/{vault}', jar=jar_a)
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/restore', {'versionId': target['id']}, jar=jar_a)
check('restore 200 keeps name', c == 200 and b['room']['name'] == 'Vault' and 'revision' in b, f'{c}')

# DP-09 thumbnails
png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 40
c, b, _ = req(A, 'PUT', f'/api/rooms/{vault}/thumbnail', png, {'Content-Type': 'image/png'}, jar_a, raw=True)
check('thumbnail PUT 204', c == 204, f'{c}')
c, data, h = req(A, 'GET', f'/api/rooms/{vault}/thumbnail', jar=jar_a)
check('thumbnail GET png', c == 200 and isinstance(data, bytes) and data[:4] == b'\x89PNG', f'{c}')
c, b, _ = req(A, 'PUT', f'/api/rooms/{vault}/thumbnail', b'NOTPNG-not-a-png', {'Content-Type': 'image/png'}, jar_a, raw=True)
check('non-png thumbnail 422', c == 422 and b['errors']['file'] == 'must be a PNG', f'{c} {b}')

# DP-26 props list
c, b, _ = req(A, 'GET', '/api/props', jar=jar_a)
check('props list ok', c == 200 and isinstance(b['props'], list), f'{c}')

# server clock
c, b, _ = req(A, 'POST', f'/api/rooms/{vault}/walk-in', jar=jar_a)
wid2 = b['session']['id']
c, s2, _ = req(A, 'GET', f'/api/playtests/{wid2}', jar=jar_a)
check('server time and remaining', s2['session']['serverTime'] and s2['session']['remainingSeconds'] == s2['session']['durationSeconds'], f'{s2["session"]["remainingSeconds"]}/{s2["session"]["durationSeconds"]}')
c, b, _ = req(A, 'POST', f'/api/playtests/{wid2}/end', jar=jar_a)
check('remaining stays at end value', b['session']['remainingSeconds'] >= 0, f'{b["session"]["remainingSeconds"]}')

print()
print(f'{sum(1 for r in results if r)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
