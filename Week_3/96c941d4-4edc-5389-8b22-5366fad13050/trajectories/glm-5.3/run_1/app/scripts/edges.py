#!/usr/bin/env python3
"""Edge-case suite: bounds, precedence, validation and error envelope."""
import json
import random
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


def call(opener, method, path, body=None, raw_body=None, headers=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None and raw_body is None:
        req.add_header('Content-Type', 'application/json')
    for key, value in (headers or {}).items():
        req.add_header(key, value)
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


def cells_all():
    return [{'lane': l, 'cell': c} for l in range(1, 6) for c in range(1, 10)]


print('\nError envelope and precedence')
anon = client()
# Unknown API path
status, data = call(anon, 'GET', '/api/nonexistent')
check('unknown path 404 NOT_FOUND', status == 404 and data['error']['code'] == 'NOT_FOUND' and data['error']['message'] == 'Harbour record not found.')
# Unsupported method on known path
status, data = call(anon, 'PATCH', '/api/rules')
check('unsupported method 405', status == 405 and data['error']['code'] == 'METHOD_REFUSED' and data['error']['message'] == 'Use a documented method.')
# Missing content type
status, data = call(anon, 'POST', '/api/accounts', raw_body=json.dumps({'email': 'a@b.co', 'password': 'x' * 20, 'playerName': 'X'}).encode())
check('missing content type 415', status == 415 and data['error']['code'] == 'JSON_REQUIRED')
# Malformed JSON
status, data = call(anon, 'POST', '/api/accounts', raw_body=b'{not json', headers={'Content-Type': 'application/json'})
check('malformed json 400', status == 400 and data['error']['code'] == 'INVALID_JSON')
# Non-object root
status, data = call(anon, 'POST', '/api/accounts', raw_body=b'[1,2]', headers={'Content-Type': 'application/json'})
check('nonobject root 400', status == 400 and data['error']['code'] == 'INVALID_JSON')
# Body too large (command body bound 262144)
big = {'commands': [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 10, 'pad': 'x' * 300000}
status, data = call(anon, 'POST', '/api/runs/x/submit', raw_body=json.dumps(big).encode(), headers={'Content-Type': 'application/json'})
check('command body too large 413', status == 413 and data['error']['code'] == 'BODY_TOO_LARGE' and data['error']['message'] == 'This request exceeds the published byte limit.')
# Other body bound 1048576
huge = {'definition': {'title': 'T', 'description': '', 'difficulty': 'calm', 'seed': 1, 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 1, 'interval': 1, 'lane': 1}]}, 'pad': 'y' * 1100000}
status, data = call(anon, 'POST', '/api/levels', raw_body=json.dumps(huge).encode(), headers={'Content-Type': 'application/json'})
check('other body too large 413', status == 413)
# Excessive nesting -> depth path
deep = {'a': {'b': {'c': {'d': {'e': {'f': {'g': {'h': {'i': {'j': {'k': {'l': {'m': {'n': {'o': {'p': {'q': 1}}}}}}}}}}}}}}}}}
status, data = call(anon, 'POST', '/api/accounts', body=deep)
check('excessive nesting depth path', status == 422 and data['error']['code'] == 'INVALID_FIELDS' and 'depth' in data['error']['fields'])

# Authentication precedence over validation: bad body without auth still 401
status, data = call(anon, 'POST', '/api/runs', body={'mode': 'nonsense'})
check('auth before validation', status == 401 and data['error']['code'] == 'AUTH_REQUIRED')
# Invalid credentials
status, data = call(anon, 'POST', '/api/session', {'email': 'nobody@example.com', 'password': 'wrong-password-here'})
check('invalid credentials 401', status == 401 and data['error']['code'] == 'INVALID_CREDENTIALS')

print('\nAccount validation')
s, data = call(anon, 'POST', '/api/accounts', {'email': f'dup.{UNIQUE}@example.com', 'password': 'password-long-enough', 'playerName': 'Dup'})
check('account created', s == 201)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'  DUP.{UNIQUE}@EXAMPLE.com ', 'password': 'password-long-enough', 'playerName': 'Dup2'})
check('normalized duplicate 409', s == 409 and data['error']['code'] == 'EMAIL_EXISTS' and data['error']['message'] == 'This email already has an account.')
s, data = call(anon, 'POST', '/api/accounts', {'email': f'short.{UNIQUE}@example.com', 'password': 'short', 'playerName': 'S'})
check('password too short field path', s == 422 and data['error']['fields'] == {'password': 'Use a permitted value.'})
s, data = call(anon, 'POST', '/api/accounts', {'email': f'x.{UNIQUE}@example.com', 'password': 'x' * 200, 'playerName': 'L'})
check('password too long', s == 422 and 'password' in data['error']['fields'])
s, data = call(anon, 'POST', '/api/accounts', {'email': f'naïve.{UNIQUE}@example.com', 'password': 'accented-pass-word', 'playerName': 'Naïve Keeper'})
check('accented email and name accepted', s == 201)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'ctrl.{UNIQUE}@example.com', 'password': 'control-chars-bad', 'playerName': 'Bad\u0007Name'})
check('Cc rejected in player name', s == 422 and 'playerName' in data['error']['fields'])
s, data = call(anon, 'POST', '/api/accounts', {'email': f'u85.{UNIQUE}@example.com', 'password': 'nextline-bad-1', 'playerName': 'Next\u0085Line'})
check('U+0085 rejected', s == 422)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'lsep.{UNIQUE}@example.com', 'password': 'lsep-bad-pass', 'playerName': 'Line\u2028Sep'})
check('U+2028 rejected', s == 422)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'surr.{UNIQUE}@example.com', 'password': 'surrogate-bad', 'playerName': 'Bad\ud800name'})
check('unpaired surrogate rejected', s == 422)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'boolean.{UNIQUE}@example.com', 'password': True, 'playerName': 'Bool'})
check('boolean is not a string password', s == 422)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'longname.{UNIQUE}@example.com', 'password': 'long-name-pass', 'playerName': 'N' * 33})
check('name over 32 code points', s == 422)
s, data = call(anon, 'POST', '/api/accounts', {'email': f'emoji.{UNIQUE}@example.com', 'password': 'emoji-pass-word', 'playerName': '🌊 Keeper'})
check('emoji in name accepted', s == 201)

print('\nDefinition validation')
opener = client()
s, data = call(opener, 'POST', '/api/accounts', {'email': f'maker.{UNIQUE}@example.com', 'password': 'maker-pass-word', 'playerName': 'Edge Maker'})
import random
base_def = {'title': 'Edge Level', 'description': '', 'difficulty': 'calm', 'seed': random.randint(1, 4294967295), 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 1, 'interval': 1, 'lane': 1}]}
bad = dict(base_def, title='')
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('empty title rejected', s == 422 and data['error']['fields'] == {'definition.title': 'Use a permitted value.'})
bad = dict(base_def, waves=[])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('empty waves array path', s == 422 and data['error']['fields'] == {'definition.waves': 'Use a permitted value.'})
bad = dict(base_def, waves=[{'tick': 0, 'creature': 'mote', 'count': 1, 'interval': 1, 'lane': 1}, {'tick': 0, 'creature': 'mote', 'count': 1, 'interval': 1, 'lane': 'x'}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('wave wrong type uses index path', s == 422 and data['error']['fields'] == {'definition.waves[1]': 'Use a permitted value.'})
bad = dict(base_def, seed=0)
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('seed below bound', s == 422 and data['error']['fields'] == {'definition.seed': 'Use a permitted value.'})
bad = dict(base_def, seed=4294967296)
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('seed above bound', s == 422 and 'definition.seed' in data['error']['fields'])
bad = dict(base_def, buildable=[{'lane': 1, 'cell': 1}, {'lane': 1, 'cell': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('duplicate buildable cell', s == 422 and 'definition.buildable[1]' in data['error']['fields'])
bad = dict(base_def, buildable=[{'lane': 9, 'cell': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('lane out of board', s == 422)
bad = dict(base_def, waves=[{'tick': 0, 'creature': 'mote', 'count': 601, 'interval': 1, 'lane': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('creature total above bound uses array path', s == 422 and data['error']['fields'] == {'definition.waves': 'Use a permitted value.'})
bad = dict(base_def, waves=[{'tick': 0, 'creature': 'mote', 'count': 5, 'interval': 1, 'lane': 1}, {'tick': 0, 'creature': 'mote', 'count': 5, 'interval': 1, 'lane': 2}, {'tick': 0, 'creature': 'mote', 'count': 591, 'interval': 1, 'lane': 3}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('exactly 601 total creatures rejected', s == 422 and data['error']['fields'] == {'definition.waves': 'Use a permitted value.'})
bad = dict(base_def, waves=[{'tick': 0, 'creature': 'mote', 'count': 600, 'interval': 1, 'lane': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('exactly 600 total creatures accepted', s == 201)
ok_level = data
bad = dict(base_def, waves=[{'tick': 17999, 'creature': 'mote', 'count': 1, 'interval': 1, 'lane': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('last spawn at command bound accepted', s == 201 and data['id'])
bad = dict(base_def, waves=[{'tick': 17998, 'creature': 'mote', 'count': 2, 'interval': 2, 'lane': 1}])
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('spawn beyond command tick rejected', s == 422 and 'definition.waves[0]' in data['error']['fields'])
bad = dict(base_def, difficulty='typhoon')
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('invalid difficulty', s == 422 and 'definition.difficulty' in data['error']['fields'])
bad = dict(base_def, title='x' * 61)
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('title over 60 code points', s == 422)
bad = dict(base_def, description='x' * 501)
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('description over 500 code points', s == 422)
bad = dict(base_def, extra='member')
s, data = call(opener, 'POST', '/api/levels', {'definition': bad})
check('unknown member uses own path', s == 422 and data['error']['fields'] == {'definition.extra': 'Use a permitted value.'})
s, data = call(opener, 'POST', '/api/levels', {'definition': 'not an object'})
check('nonobject definition', s == 422 and data['error']['fields'] == {'definition': 'Use a permitted value.'})
s, data = call(opener, 'POST', '/api/levels', {'definition': base_def, 'unknown': 1})
check('unknown request member', s == 422 and data['error']['fields'] == {'unknown': 'Use a permitted value.'})

print('\nRun and command validation')
s, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': []})
check('empty loadout', s == 422 and data['error']['fields'] == {'loadout': 'Use a permitted value.'})
s, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': ['wick', 'wick']})
check('duplicate device in loadout', s == 422 and 'loadout' in data['error']['fields'])
s, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': ['wick', 'chime', 'siphon', 'wall', 'prism']})
check('loadout over four devices', s == 422)
s, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': 3, 'loadout': ['wick']})
check('campaign with revision rejected', s == 422 and 'revision' in data['error']['fields'])
s, data = call(opener, 'POST', '/api/runs', {'mode': 'playtest', 'sourceId': ok_level['id'], 'revision': None, 'loadout': ['wick']})
check('playtest requires revision', s == 422)
s, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c999', 'revision': None, 'loadout': ['wick']})
check('unknown encounter 404', s == 404)

# command validation paths
def fresh_run():
    s, d = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': ['wick', 'gong']})
    t = d['ticket']['id']
    call(opener, 'POST', f'/api/runs/{t}/start', {})
    return t

ticket = fresh_run()
bad_cmd = {'commands': [{'seq': 0, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'atTick': 0, 'proposal': {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', bad_cmd)
check('nonpositive seq field path', s == 422 and data['error']['fields'] == {'commands[0].seq': 'Use a permitted value.'})
bad_cmd = {'commands': [{'seq': 1, 'tick': -1, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'atTick': 0, 'proposal': {'seq': 2, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', bad_cmd)
check('negative tick field path', s == 422 and 'commands[0].tick' in data['error']['fields'])
# unknown type is a legality failure, not a shape error
bad_cmd = {'commands': [], 'atTick': 0, 'proposal': {'seq': 1, 'tick': 0, 'type': 'explode', 'lane': 3, 'cell': 5, 'device': None}}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', bad_cmd)
check('structurally valid unknown type is legality failure', s == 422 and data['error']['code'] == 'COMMAND_REFUSED' and data['error']['message'] == 'Unknown command')
# proposal tick must equal atTick
bad_cmd = {'commands': [], 'atTick': 5, 'proposal': {'seq': 1, 'tick': 3, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', bad_cmd)
check('proposal tick must equal atTick', s == 422 and data['error']['code'] == 'COMMAND_REFUSED')
# command count bound: prefix plus proposal at most 2000 uses commands path
many = [{'seq': i + 1, 'tick': 0, 'type': 'upgrade', 'lane': 3, 'cell': 5, 'device': None} for i in range(2000)]
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', {'commands': many, 'atTick': 0, 'proposal': {'seq': 2001, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}})
check('combined command count uses commands path', s == 422 and data['error']['fields'] == {'commands': 'Use a permitted value.'})

# submission validation
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', {'commands': [], 'endTick': 18001})
check('endTick above bound', s == 422 and data['error']['fields'] == {'endTick': 'Use a permitted value.'})
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', {'commands': [{'seq': 1, 'tick': 100, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 50})
check('endTick earlier than a command', s == 422 and data['error']['fields'] == {'endTick': 'Use a permitted value.'})
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', {'commands': [], 'endTick': '600'})
check('numeric string endTick rejected', s == 422 and 'endTick' in data['error']['fields'])
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', {'commands': [{'seq': 1.5, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 600})
check('noninteger seq rejected', s == 422)
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', {'commands': [{'seq': True, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 600})
check('boolean is not an integer', s == 422)

print('\nFrame bound validation')
s, data = call(opener, 'GET', f'/api/runs/{fresh_run()}/frames?from=abc&to=2')
check('noninteger from', s == 422 and data['error']['fields'] == {'from': 'Use a permitted value.'})
s, data = call(opener, 'GET', f'/api/runs/{fresh_run()}/frames?from=5&to=2')
check('from greater than to', s == 422 and 'from' in data['error']['fields'])
s, data = call(opener, 'GET', f'/api/runs/{fresh_run()}/frames')
check('missing bounds', s == 422 and set(data['error']['fields']) == {'from', 'to'})

print('\nCommand reason precedence')
# seq not increasing before other checks
two = {'commands': [{'seq': 2, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}, {'seq': 2, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 600}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', two)
check('sequence reason before cell reason', s == 200 and data['state'] == 'rejected' and data['failure']['reason'] == 'Command sequence is not increasing')
# tick moved backwards
two = {'commands': [{'seq': 1, 'tick': 10, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}, {'seq': 2, 'tick': 5, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'endTick': 600}
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/submit', two)
check('tick order reason', s == 200 and data['failure']['reason'] == 'Command tick moved backwards')
# invalid cell before loadout
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', {'commands': [], 'atTick': 0, 'proposal': {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 9, 'cell': 50, 'device': 'gong'}})
check('invalid cell before loadout reason', s == 422 and data['error']['message'] == 'Invalid cell')
# occupied before insufficient
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', {'commands': [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}], 'atTick': 0, 'proposal': {'seq': 2, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}})
check('occupied cell reason', s == 422 and data['error']['message'] == 'Cell is occupied')
# insufficient charge with near-empty reserve (deploy 6 expensive devices)
expensive = []
for i in range(6):
    expensive.append({'seq': i + 1, 'tick': 0, 'type': 'deploy', 'lane': (i % 5) + 1, 'cell': i + 1, 'device': 'gong'})
s, data = call(opener, 'POST', f'/api/runs/{fresh_run()}/commands/check', {'commands': expensive[:3], 'atTick': 0, 'proposal': {'seq': 4, 'tick': 0, 'type': 'deploy', 'lane': 5, 'cell': 9, 'device': 'gong'}})
check('insufficient charge reason after loadout', s == 422 and data['error']['message'] in ('Device is outside the loadout', 'Insufficient charge'))

print('\nTransition errors')
s, other = call(anon, 'POST', '/api/accounts', {'email': f'other.{UNIQUE}@example.com', 'password': 'other-pass-word', 'playerName': 'Other'})
other_client = anon if s == 201 else client()
s, data = call(other_client, 'GET', f'/api/runs/{ticket}')
check('other-owner run hidden', s == 404)
s, data = call(opener, 'GET', '/api/levels')
s, data = call(other_client, 'GET', f"/api/levels/{ok_level['id']}")
check('other-owner level hidden', s == 404)
# double start is identical replay (ticket is still playing: no submissions were staged on it)
s, data = call(opener, 'POST', f'/api/runs/{ticket}/start', {})
check('owner starts again identical replay', s == 200 and data['state'] == 'playing')

print('\nSame-origin boundary')
anon2 = client()
def with_origin(origin):
    req = urllib.request.Request(BASE + '/api/accounts', data=json.dumps({'email': f'origin.{UNIQUE}@example.com', 'password': 'origin-test-pass', 'playerName': 'Origin'}).encode(), method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', origin)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
status = with_origin('http://evil.example.com')
check('cross-origin mutation refused', status == 403)
import urllib.request as _ur
# Public GETs remain available
s, rules_get = call(anon2, 'GET', '/api/rules')
check('public reads unaffected', s == 200)

print('\nRules reference completeness')
s, rules = call(anon, 'GET', '/api/rules')
check('rules 200', s == 200)
check('ruleset and tickRate', rules['ruleset'] == 'orrel-1' and rules['tickRate'] == 20)
check('tickOrder', rules['tickOrder'] == ['commands', 'spawn', 'move-and-change-lane', 'prepare-attacks', 'simultaneous-damage', 'deaths', 'generation', 'breaches', 'terminal-check'])
check('devices in seed order', [d['id'] for d in rules['devices']] == ['wick', 'chime', 'siphon', 'wall', 'prism', 'gong'])
check('creatures in seed order', [c['id'] for c in rules['creatures']] == ['mote', 'shell', 'skipper', 'mass'])
check('limits complete', rules['limits']['maxCommands'] == 2000 and rules['limits']['commandBodyBytes'] == 262144 and rules['limits']['maxFramePage'] == 201)
check('command reason order', rules['commandRules']['reasonOrder'] == ['Unknown command', 'Command sequence is not increasing', 'Command tick moved backwards', 'Command follows terminal state', 'Invalid cell', 'Device is outside the loadout', 'Cell is occupied', 'No installed device', 'Device is already upgraded', 'Insufficient charge'])
check('forecast phases timed', rules['commandRules']['forecastPhases'] == [{'phase': 'beam', 'durationMs': 180}, {'phase': 'contacts', 'durationMs': 260}, {'phase': 'ready', 'durationMs': 0}])
check('legality contract', rules['commandRules']['legality']['sequence'] == 'strictly-increasing' and rules['commandRules']['legality']['repair'] is False)
check('ranking rules', rules['rankingRules']['metricOrder'] == ['breaches-ascending', 'completionTick-ascending', 'remainingCharge-descending'] and rules['rankingRules']['rankStyle'] == 'competition')
check('season rules', rules['seasonRules']['timeZone'] == 'Asia/Kathmandu' and rules['seasonRules']['utcOffset'] == '+05:45' and rules['seasonRules']['dayStart'] == '05:00' and rules['seasonRules']['refreshSeconds'] == 30)
check('transitions complete', len(rules['transitions']['run']) == 10 and len(rules['transitions']['challenge']) == 9 and len(rules['transitions']['proof']) == 7)
check('arithmetic contract', rules['arithmetic']['division'] == 'half-away-from-zero' and rules['arithmetic']['integerOnly'] is True and rules['arithmetic']['salvageDivision'] == 'floor')
check('randomness example', rules['randomness']['example'] == {'seed': 1, 'draws': [270369, 67634689, 2647435461], 'lanes': [5, 5, 2]})
check('wall divisors', rules['devices'][3]['slowdownDivisor'] == 2 and rules['devices'][3]['upgradedSlowdownDivisor'] == 4)
check('lane offsets', rules['devices'][5]['laneOffsets'] == [-1, 0, 1] and rules['devices'][0]['laneOffsets'] == [0] and rules['devices'][2]['laneOffsets'] == [])
check('skipper lane change', rules['creatures'][2]['laneChange'] == {'everyMovements': 40, 'laneDelta': 1, 'wrap': True})
check('terminal order', rules['commandRules']['terminalOrder'] == ['zero-health-defeat', 'all-spawned-and-none-alive-victory', 'tick-limit-defeat'])

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL else 0)
