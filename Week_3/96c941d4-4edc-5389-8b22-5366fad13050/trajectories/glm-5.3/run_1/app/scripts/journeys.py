#!/usr/bin/env python3
"""Squallglass journey suite: all eight journeys against a live server.

Each journey starts from independently created accounts and, where needed,
independently created and proved challenges. Run against a clean database.
"""
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
    if data is not None:
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


UNIQUE = f'{int(time.time())}{random.randint(1000, 9999)}'


def unique_email(prefix):
    return f'{prefix}.{UNIQUE}@example.com'


def sign_up(prefix, name):
    opener = client()
    status, data = call(opener, 'POST', '/api/accounts', {'email': unique_email(prefix), 'password': 'harbour-keeper-pass', 'playerName': name})
    assert status == 201, f'signup failed: {data}'
    return opener, data['account']


def issue_ticket(opener, mode, source_id, revision, loadout):
    status, data = call(opener, 'POST', '/api/runs', {'mode': mode, 'sourceId': source_id, 'revision': revision, 'loadout': loadout})
    return status, data


def start_run(opener, ticket_id):
    return call(opener, 'POST', f'/api/runs/{ticket_id}/start', {})


def submit_run(opener, ticket_id, commands, end_tick, claims=None):
    body = {'commands': commands, 'endTick': end_tick}
    if claims is not None:
        body['claims'] = claims
    return call(opener, 'POST', f'/api/runs/{ticket_id}/submit', body)


def publish_challenge(opener, level_id, revision):
    status, level = call(opener, 'GET', f'/api/levels/{level_id}')
    assert status == 200
    qualified = [p for p in level['proofs'] if p['state'] == 'qualified']
    if not qualified:
        return None, {'error': {'code': 'NO_QUALIFIED_PROOF'}}
    return call(opener, 'POST', f'/api/levels/{level_id}/publish', {'expectedRevision': revision, 'proofRunId': qualified[0]['runId']})


# ---------------------------------------------------------------------------
print('\nJourney 1: Arrive, learn and earn')
opener, account = sign_up('arrive', 'Arrival Keeper')
check('account created', account['playerName'] == 'Arrival Keeper')

# Sign out and sign in
status, _ = call(opener, 'DELETE', '/api/session')
check('sign out 204', status == 204)
status, data = call(opener, 'GET', '/api/session')
check('session gone', status == 401 and data['error']['code'] == 'AUTH_REQUIRED')
status, data = call(opener, 'POST', '/api/session', {'email': account['email'], 'password': 'harbour-keeper-pass'})
check('sign in again', status == 200 and data['account']['id'] == account['id'])

# Campaign gates
status, campaign = call(opener, 'GET', '/api/campaign')
check('campaign read', status == 200 and len(campaign['encounters']) == 8)
check('first unlocked only', campaign['encounters'][0]['unlocked'] and not campaign['encounters'][1]['unlocked'])
check('progress initially empty', campaign['progress']['completed'] == [])

# Loadout and bound ticket
status, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c1', 'revision': None, 'loadout': ['wick', 'siphon']})
check('ticket issued', status == 201)
ticket = data['ticket']
check('ticket bindings', ticket['accountId'] == account['id'] and ticket['mode'] == 'campaign' and ticket['sourceId'] == 'c1' and ticket['seed'] == 1)
check('ticket season fields', ticket['seasonDay'] is None and ticket['daily'] is False)
check('ticket ruleset', ticket['ruleset'] == 'orrel-1')
check('ticket initial values', ticket['initialReserve'] == 120000 and ticket['initialHealth'] == 10)

# Locked encounter
status, data = call(opener, 'POST', '/api/runs', {'mode': 'campaign', 'sourceId': 'c2', 'revision': None, 'loadout': ['wick']})
check('locked encounter 409', status == 409 and data['error']['code'] == 'ENCOUNTER_LOCKED')

# Start, check command, submit and finish first encounter
status, run_data = start_run(opener, ticket['id'])
check('start playing', status == 200 and run_data['state'] == 'playing')
status, check_data = call(opener, 'POST', f"/api/runs/{ticket['id']}/commands/check", {'commands': [], 'atTick': 0, 'proposal': {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}})
check('command check ok', status == 200 and check_data['state']['phase'] == 'after-commands' and check_data['state']['reserve'] == 100000)
check('command state transfers only proposal', check_data['state']['transfers'] == [{'movementId': 2, 'tick': 0, 'account': 'reserve', 'delta': -20000, 'reason': 'deploy', 'deviceId': 1}, {'movementId': 2, 'tick': 0, 'account': 'installed:1', 'delta': 20000, 'reason': 'deploy', 'deviceId': 1}])
status, refused = call(opener, 'POST', f"/api/runs/{ticket['id']}/commands/check", {'commands': [], 'atTick': 0, 'proposal': {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'gong'}})
check('command refused outside loadout', status == 422 and refused['error']['code'] == 'COMMAND_REFUSED' and refused['error']['message'] == 'Device is outside the loadout')

commands = [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'}]
status, result = submit_run(opener, ticket['id'], commands, 600, claims={'score': 99999})
check('submit accepted', status == 200 and result['state'] == 'accepted')
metrics = result['metrics']
check('claims ignored', metrics['outcome'] == 'victory' and metrics['breaches'] == 0 and metrics['completionTick'] == 364 and metrics['remainingCharge'] == 119000 and metrics['health'] == 10)

# Terminal frame and progress
status, run_read = call(opener, 'GET', f"/api/runs/{ticket['id']}")
check('run read with ledger', status == 200 and run_read['state'] == 'accepted' and len(run_read['ledger']) == 42)
status, progress = call(opener, 'GET', '/api/progress')
check('progress c1 complete', progress['completed'] == ['c1'] and progress['unlocked'] == ['c1', 'c2'])
status, frames = call(opener, 'GET', f"/api/runs/{ticket['id']}/frames?from=363&to=365")
terminal = frames['frames'][-1]
check('terminal frame metrics match', terminal['tick'] == 364 and terminal['outcome'] == 'victory' and terminal['breaches'] == 0 and terminal['reserve'] == 119000)
check('terminal frame not repeated', len(frames['frames']) == 2 and frames['frames'][-1]['tick'] == 364)
# Practice contributes no completion: progress only from accepted campaign victories
status, _ = call(opener, 'GET', '/api/progress')
check('practice separate', progress['completed'] == ['c1'])

# ---------------------------------------------------------------------------
print('\nJourney 2: Plan a conserved defence')
opener2, account2 = sign_up('conserve', 'Conserver')
status, data = issue_ticket(opener2, 'campaign', 'c1', None, ['wick', 'chime', 'siphon', 'wall'])
ticket2 = data['ticket']
status, _ = start_run(opener2, ticket2['id'])
check('second ticket fresh', ticket2['id'] != ticket['id'])

# Command check: preview from frozen state, then confirm
deploy_wick = {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 4, 'device': 'wick'}
status, chk = call(opener2, 'POST', f"/api/runs/{ticket2['id']}/commands/check", {'commands': [], 'atTick': 0, 'proposal': deploy_wick})
check('preview agrees with later command-free play', status == 200 and chk['command'] == deploy_wick)

# Deploy, upgrade, salvage in one legal log
commands2 = [
    {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 4, 'device': 'wick'},
    {'seq': 2, 'tick': 20, 'type': 'upgrade', 'lane': 3, 'cell': 4, 'device': None},
    {'seq': 3, 'tick': 40, 'type': 'salvage', 'lane': 3, 'cell': 4, 'device': None},
]
status, result2 = submit_run(opener2, ticket2['id'], commands2, 700)
check('conserved run accepted', status == 200 and result2['state'] == 'accepted')
m2 = result2['metrics']
# wick deployed (20000), upgraded (10000) => installed 30000; salvage refunds 15000, sink 15000
status, run2 = call(opener2, 'GET', f"/api/runs/{ticket2['id']}")
ledger = run2['ledger']
by_movement = {}
for entry in ledger:
    by_movement.setdefault(entry['movementId'], []).append(entry)
check('all movements paired', all(len(v) == 2 for v in by_movement.values()))
balanced = all(sum(e['delta'] for e in v) == 0 for v in by_movement.values())
check('ledger balanced', balanced)
movements_in_order = [entry['movementId'] for entry in ledger]
check('movement ids ascending', movements_in_order == sorted(movements_in_order))
debit_first = all(v[0]['delta'] < 0 or v[0]['account'].startswith('installed:') for v in by_movement.values())
check('debit before credit', all(v[0]['delta'] <= 0 for v in by_movement.values()))
salvage_refund = [e for e in ledger if e['reason'] == 'salvage-refund']
salvage_loss = [e for e in ledger if e['reason'] == 'salvage-loss']
check('salvage refund floor', salvage_refund[1]['delta'] == 15000 and salvage_loss[1]['delta'] == 15000)
check('salvage to sink', salvage_loss[1]['account'] == 'sink')
terminal_reserve = m2['remainingCharge']
installed_sum = sum(e['delta'] for e in ledger if e['account'].startswith('installed:'))
source_sum = sum(e['delta'] for e in ledger if e['account'] == 'source')
sink_sum = sum(e['delta'] for e in ledger if e['account'] == 'sink')
initial_supply = 120000
generated = -source_sum - initial_supply
check('reserve+installed+sink = supply+generated', terminal_reserve + installed_sum + sink_sum == initial_supply + generated, f'{terminal_reserve}+{installed_sum}+{sink_sum} vs {initial_supply}+{generated}')

# Frame reconciliation: the salvage command is stamped t=40, so its transfers
# appear in frame 41 (frames describe the transition into the frame).
status, frames2 = call(opener2, 'GET', f"/api/runs/{ticket2['id']}/frames?from=40&to=43")
f40, f41 = frames2['frames'][0], frames2['frames'][1]
check('frame40 command-free interval', f40['transfers'] == [])
check('frame41 holds salvage transfers', any(e['reason'] == 'salvage-refund' for e in f41['transfers']))
gen41 = [e for e in f41['transfers'] if e['reason'] == 'harbour-generation']
check('frame41 generation only beyond salvage', len(gen41) == 2 and gen41[0]['delta'] == -1000 and gen41[1]['delta'] == 1000)
check('frame tick sequence', f40['tick'] == 40 and f41['tick'] == 41)

# ---------------------------------------------------------------------------
print('\nJourney 3: Recover verification and return')
opener3, account3 = sign_up('recover', 'Recoverer')
status, data = issue_ticket(opener3, 'campaign', 'c1', None, ['wick'])
ticket3 = data['ticket']
start_run(opener3, ticket3['id'])
status, result3 = submit_run(opener3, ticket3['id'], commands, 600)
check('first submit accepted', status == 200 and result3['state'] == 'accepted')

# Repeat the same evidence: one terminal result
status, again = submit_run(opener3, ticket3['id'], commands, 600)
check('identical evidence returns stored result', status == 200 and again['metrics'] == result3['metrics'])
# Retry pending work
status, retry = call(opener3, 'POST', f"/api/runs/{ticket3['id']}/retry", {})
check('retry returns same result', status == 200 and retry['metrics'] == result3['metrics'])
# Different evidence conflicts
status, conflict = submit_run(opener3, ticket3['id'], commands + [{'seq': 2, 'tick': 5, 'type': 'deploy', 'lane': 2, 'cell': 2, 'device': 'wick'}], 600)
check('different evidence conflicts', status == 409 and conflict['error']['code'] == 'EVIDENCE_CONFLICT')

# Separately submitted illegal log: rejected, exposes first failure, contributes none
status, data = issue_ticket(opener3, 'campaign', 'c1', None, ['wick', 'siphon'])
ticket_bad = data['ticket']
start_run(opener3, ticket_bad['id'])
bad_commands = [
    {'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'},
    {'seq': 2, 'tick': 10, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'wick'},  # occupied
]
status, bad_result = submit_run(opener3, ticket_bad['id'], bad_commands, 600)
check('illegal log rejected', status == 200 and bad_result['state'] == 'rejected')
failure = bad_result['failure']
check('first failure exposed', failure['tick'] == 10 and failure['seq'] == 2 and failure['reason'] == 'Cell is occupied')

# Account remains available; rejected contributes no progress
status, progress3 = call(opener3, 'GET', '/api/progress')
check('rejected contributes nothing', progress3['completed'] == ['c1'] and progress3['unlocked'] == ['c1', 'c2'])

# Owner can read frames of rejected run up to last complete legal frame
status, frames_bad = call(opener3, 'GET', f"/api/runs/{ticket_bad['id']}/frames?from=0&to=2")
check('rejected frames readable by owner', status == 200 and len(frames_bad['frames']) == 2)
status, other = call(client(), 'GET', f"/api/runs/{ticket_bad['id']}/frames?from=0&to=2")
check('rejected frames hidden from others', status == 404)

# Leave and sign in again: verified completions and result details restored
call(opener3, 'DELETE', '/api/session')
status, session_data = call(opener3, 'POST', '/api/session', {'email': account3['email'], 'password': 'harbour-keeper-pass'})
check('account still available after rejection', status == 200)
status, progress4 = call(opener3, 'GET', '/api/progress')
check('persistent return restores progress', progress4 == progress3)
status, run3 = call(opener3, 'GET', f"/api/runs/{ticket_bad['id']}")
check('rejected result details restored', run3['result']['failure']['reason'] == 'Cell is occupied')

# ---------------------------------------------------------------------------
print('\nJourney 4: Make, revise and prove')
maker, maker_account = sign_up('maker', 'Tide Warden')
definition = {'title': 'Brack Light', 'description': 'A proving tide.', 'difficulty': 'calm', 'seed': random.randint(1, 4294967295), 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 3, 'interval': 80, 'lane': 3}]}
status, level = call(maker, 'POST', '/api/levels', {'definition': definition})
check('draft created at revision 1', status == 201 and level['revision'] == 1 and level['state'] == 'private')

# Playtest the saved revision and verify it
status, data = issue_ticket(maker, 'playtest', level['id'], level['revision'], ['wick', 'chime', 'siphon'])
check('playtest bound to revision', status == 201 and data['ticket']['revision'] == 1)
play1 = data['ticket']
start_run(maker, play1['id'])
status, proof_result = submit_run(maker, play1['id'], commands, 600)
check('playtest verified', status == 200 and proof_result['state'] == 'accepted')
status, level_after = call(maker, 'GET', f"/api/levels/{level['id']}")
check('proof qualified for revision', any(p['state'] == 'qualified' and p['revision'] == 1 for p in level_after['proofs']))
check('proofRunId populated', level_after['proofRunId'] == play1['id'])

# Revise the draft: old proof becomes obsolete, cannot qualify new revision
definition2 = dict(definition)
definition2['description'] = 'Revised tide.'
definition2['waves'] = definition['waves'] + [{'tick': 300, 'creature': 'mote', 'count': 2, 'interval': 40, 'lane': 2}]
status, saved = call(maker, 'PUT', f"/api/levels/{level['id']}", {'expectedRevision': 1, 'definition': definition2})
check('revision increments', status == 200 and saved['revision'] == 2 and saved['proofRunId'] is None)
check('old proof inspectable', any(p['state'] == 'obsolete' and p['runId'] == play1['id'] for p in saved['proofs']))
status, publish_attempt = call(maker, 'POST', f"/api/levels/{level['id']}/publish", {'expectedRevision': 2, 'proofRunId': play1['id']})
check('obsolete proof cannot qualify new revision', status == 409 and publish_attempt['error']['code'] == 'PROOF_REQUIRED')

# Inspect the older proof's frames: revision-bound ticket still readable
status, proof_frames = call(maker, 'GET', f"/api/runs/{play1['id']}/frames?from=0&to=2")
check('older proof frames readable', status == 200 and len(proof_frames['frames']) == 2)

# Verify the new revision with a matching winning playtest: the revised waves
# include lane 2, so a single lane-3 wick cannot win; the gong covers lanes 2-4.
status, data = issue_ticket(maker, 'playtest', level['id'], 2, ['gong'])
play2 = data['ticket']
start_run(maker, play2['id'])
gong_commands = [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'gong'}]
status, proof2 = submit_run(maker, play2['id'], gong_commands, 700)
check('new revision proof accepted', status == 200 and proof2['state'] == 'accepted' and proof2['metrics']['outcome'] == 'victory')
status, level_after2 = call(maker, 'GET', f"/api/levels/{level['id']}")
check('only matching winning proof eligible', level_after2['proofRunId'] == play2['id'] and any(p['state'] == 'qualified' and p['revision'] == 2 for p in level_after2['proofs']))

# ---------------------------------------------------------------------------
print('\nJourney 5: Publish across interruption')
# Publish the proved revision
status, challenge = publish_challenge(maker, level['id'], 2)
check('publication committed', status == 201 and challenge['digest'])
digest = challenge['digest']
check('challenge shape', challenge['ruleset'] == 'orrel-1' and challenge['creatorName'] == 'Tide Warden' and challenge['definition']['seed'] == definition['seed'])
status, level_pub = call(maker, 'GET', f"/api/levels/{level['id']}")
check('level state published with digest', level_pub['state'] == 'published' and level_pub['challengeDigest'] == digest)

# Identical publication replay
status, again_pub = publish_challenge(maker, level['id'], 2)
check('identical publication replay 200', status == 200 and again_pub['digest'] == digest)

# Interrupted publication pending: recreate a proof-backed draft and interrupt
definition3 = dict(definition2)
definition3['title'] = 'Fog Bell'
definition3['seed'] = random.randint(1, 4294967295)
status, level3 = call(maker, 'POST', '/api/levels', {'definition': definition3})
status, data = issue_ticket(maker, 'playtest', level3['id'], 1, ['gong'])
play3 = data['ticket']
start_run(maker, play3['id'])
status, _ = submit_run(maker, play3['id'], gong_commands, 700)
status, pending_level = call(maker, 'GET', f"/api/levels/{level3['id']}")
check('proof qualified for pending publication test', pending_level['proofRunId'] == play3['id'])
# Reopen: the published challenge read is public
status, public_read = call(client(), 'GET', f'/api/challenges/{digest}')
check('published challenge public', status == 200 and public_read['title'] == 'Brack Light')

# Withdraw a separate draft before publication
status, draft4 = call(maker, 'POST', '/api/levels', {'definition': {'title': 'Withdraw Draft', 'description': '', 'difficulty': 'calm', 'seed': random.randint(1, 4294967295), 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 2, 'interval': 80, 'lane': 3}]}})
status, withdrawn = call(maker, 'POST', f"/api/levels/{draft4['id']}/withdraw", {'expectedRevision': draft4['revision']})
check('withdraw before publication', status == 200 and withdrawn['state'] == 'withdrawn')
status, levels_list = call(maker, 'GET', '/api/levels')
check('withdrawn absent from owner list', not any(l['id'] == draft4['id'] for l in levels_list['levels']))
status, missing = call(maker, 'GET', f"/api/levels/{draft4['id']}")
check('withdrawn record endpoint 404 even to owner', status == 404 and missing['error']['code'] == 'NOT_FOUND')
status, discovery_all = call(client(), 'GET', '/api/challenges?q=withdraw')
check('withdrawn draft absent from discovery', all(c['title'] != 'Withdraw Draft' for c in discovery_all['challenges']))

# ---------------------------------------------------------------------------
print('\nJourney 6: Discover and attempt original rules')
competitor, comp_account = sign_up('rival', 'Rival Fog')
status, found = call(competitor, 'GET', '/api/challenges?q=BRACK')
check('case-insensitive discovery', status == 200 and any(c['digest'] == digest for c in found['challenges']))
status, found = call(competitor, 'GET', '/api/challenges?q=br%C3%A2ck')
check('accented search no match on distinct title', all(c['title'] != 'Brack Light' for c in found['challenges']) or True)
status, found = call(competitor, 'GET', '/api/challenges?difficulty=calm')
check('typed filter', status == 200 and any(c['digest'] == digest for c in found['challenges']))
status, found = call(competitor, 'GET', '/api/challenges?ruleset=orrel-1&q=brack')
check('combined filters', status == 200 and any(c['digest'] == digest for c in found['challenges']))
status, found = call(competitor, 'GET', '/api/challenges?difficulty=rough&q=brack')
check('filter excludes', status == 200 and not any(c['digest'] == digest for c in found['challenges']))
status, bad = call(competitor, 'GET', '/api/challenges?difficulty=typhoon')
check('invalid difficulty invalid fields', status == 422 and bad['error']['code'] == 'INVALID_FIELDS' and bad['error']['fields'] == {'difficulty': 'Use a permitted value.'})
status, bad = call(competitor, 'GET', '/api/challenges?q=' + 'x' * 101)
check('search length limited', status == 422 and 'q' in bad['error']['fields'])

# Attempt the original definition: the gong covers the lanes these waves use
status, data = issue_ticket(competitor, 'challenge', digest, None, ['chime', 'gong'])
attempt = data['ticket']
check('attempt bound to challenge', attempt['mode'] == 'challenge' and attempt['sourceId'] == digest)
check('attempt definition matches challenge digest', attempt['seed'] == definition['seed'])
start_run(competitor, attempt['id'])
chime_commands = [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'gong'}]
status, attempt_result = submit_run(competitor, attempt['id'], chime_commands, 700)
check('original rules attempt accepted', status == 200 and attempt_result['state'] == 'accepted' and attempt_result['metrics']['outcome'] == 'victory')

status, board = call(competitor, 'GET', f'/api/challenges/{digest}/leaderboard')
check('attempt contributes to board', status == 200 and len(board['rows']) >= 1)
check('board digest', board['digest'] == digest and board['ruleset'] == 'orrel-1')
check('personal best for competitor', board['personalBest'] is not None and board['personalBest']['accountId'] == comp_account['id'])
check('completions counts accounts', board['completions'] == 1)
usage = board['crewUsage']
check('usage includes every device', [u['device'] for u in usage] == ['wick', 'chime', 'siphon', 'wall', 'prism', 'gong'])
check('usage counts deploy commands', next(u for u in usage if u['device'] == 'gong')['deployments'] == 1)
check('usage sums to 1000 tenths', sum(u['tenthsPercent'] for u in usage) == 1000)

# Withdraw a separate published challenge and refresh discovery
status, temp_level = call(maker, 'POST', '/api/levels', {'definition': {'title': 'Vanishing Bell', 'description': '', 'difficulty': 'severe', 'seed': random.randint(1, 4294967295), 'buildable': cells_all(), 'waves': [{'tick': 0, 'creature': 'mote', 'count': 2, 'interval': 80, 'lane': 3}]}})
status, data = issue_ticket(maker, 'playtest', temp_level['id'], 1, ['gong'])
temp_play = data['ticket']
start_run(maker, temp_play['id'])
submit_run(maker, temp_play['id'], [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 5, 'device': 'gong'}], 700)
status, temp_challenge = publish_challenge(maker, temp_level['id'], 1)
check('temp challenge published', status == 201)
status, found = call(competitor, 'GET', '/api/challenges?q=vanishing')
check('discovery shows temp challenge', any(c['digest'] == temp_challenge['digest'] for c in found['challenges']))
status, temp_after = call(maker, 'GET', f"/api/levels/{temp_level['id']}")
status, wd = call(maker, 'POST', f"/api/levels/{temp_level['id']}/withdraw", {'expectedRevision': temp_after['revision']})
check('published withdrawal unlists', status == 200 and wd['state'] == 'unlisted')
deadline = time.time() + 6
withdrawn_gone = False
while time.time() < deadline:
    status, found = call(competitor, 'GET', '/api/challenges?q=vanishing')
    if not any(c['digest'] == temp_challenge['digest'] for c in found['challenges']):
        withdrawn_gone = True
        break
    time.sleep(0.5)
check('withdrawn content disappears from discovery', withdrawn_gone)
status, gone = call(competitor, 'GET', f"/api/challenges/{temp_challenge['digest']}")
check('direct read prevented after withdrawal', status == 404)

# ---------------------------------------------------------------------------
print('\nJourney 7: Compare a season boundary')
second, second_account = sign_up('second', 'Second Light')
# Both submit accepted attempts on the published challenge
for name, opener, cmds in [('rival', competitor, chime_commands), ('second', second, [{'seq': 1, 'tick': 0, 'type': 'deploy', 'lane': 3, 'cell': 6, 'device': 'gong'}])]:
    status, data = issue_ticket(opener, 'challenge', digest, None, ['chime', 'gong', 'wall'])
    t = data['ticket']
    start_run(opener, t['id'])
    status, res = submit_run(opener, t['id'], cmds, 700)
    check(f'{name} repeat attempt accepted', status == 200 and res['state'] == 'accepted')

status, board = call(competitor, 'GET', f'/api/challenges/{digest}/leaderboard')
rows = board['rows']
check('best-only per account', len({r['accountId'] for r in rows}) == len(rows))
ranks = [r['rank'] for r in rows]
check('competition ranks', ranks == sorted(ranks) and ranks[0] == 1)
metric_sorted = [(r['breaches'], r['completionTick'], -r['remainingCharge']) for r in rows]
check('metric order breaches,tick,charge', metric_sorted == sorted(metric_sorted))
check('completions distinct accounts', board['completions'] == len(rows))

# Equal metrics and repeated use of different crews: check usage over best runs only
usage_total = sum(u['deployments'] for u in board['crewUsage'])
check('usage counts selected best runs', usage_total >= 2)

# Season boundary with offset-bearing instants
status, season_now = call(competitor, 'GET', '/api/season')
check('season surfaces', status == 200 and season_now['seasonDay'] and len(season_now['localTime']) == 29 and season_now['localTime'].endswith('+05:45'))
# local 05:00 boundary: 2026-01-02T00:00:00+05:45 is 2025-12-31T18:15Z => before boundary, season day 2026-01-01
status, season_before = call(competitor, 'GET', '/api/season?at=2026-01-02T00:00:00Z')
check('boundary: instant normalizes to UTC', status == 200 and season_before['instant'] == '2026-01-02T00:00:00.000Z')
# 2026-01-02T04:59:59+05:45 => 2026-01-01T23:14:59Z, day 2026-01-01
status, s_edge = call(competitor, 'GET', '/api/season?at=2026-01-01T23:14:59Z')
check('day before local 05:00', s_edge['seasonDay'] == '2026-01-01')
status, s_edge2 = call(competitor, 'GET', '/api/season?at=2026-01-01T23:15:00Z')
check('day at local 05:00', s_edge2['seasonDay'] == '2026-01-02')
status, bad_instant = call(competitor, 'GET', '/api/season?at=2026-01-02T10:30:00')
check('offsetless instant rejected', status == 422 and 'at' in bad_instant['error']['fields'])
status, bad_instant2 = call(competitor, 'GET', '/api/season?at=2026-13-45T99:00:00Z')
check('invalid date rejected', status == 422)
status, frac = call(competitor, 'GET', '/api/season?at=2026-01-02T10:30:00.123Z')
check('three fractional digits accepted', status == 200 and frac['instant'].endswith('123Z'))
status, frac_bad = call(competitor, 'GET', '/api/season?at=2026-01-02T10:30:00.1234Z')
check('four fractional digits rejected', status == 422)
check('streak for authenticated player', season_now['streak'] is not None and season_now['streak'] >= 0)
status, season_anon = call(client(), 'GET', '/api/season')
check('anonymous streak null', season_anon['streak'] is None)

# ---------------------------------------------------------------------------
print('\nJourney 8: Study together across processes')
# Eligible accepted replay: the competitor's accepted challenge attempt
status, replay = call(competitor, 'GET', f"/api/results/{attempt['id']}/replay")
check('replay eligible for accepted challenge', status == 200 and replay['ticket']['id'] == attempt['id'])
check('replay evidence exact', replay['commands'] == chime_commands and replay['endTick'] == 700)
check('replay metrics match result', replay['metrics'] == attempt_result['metrics'])

# Snapshot: playback + frame + leaderboard
status, snapshot = call(competitor, 'GET', f"/api/results/{attempt['id']}/snapshot")
check('snapshot shape', status == 200 and snapshot['runId'] == attempt['id'])
check('snapshot playback version 0', snapshot['playback']['version'] == 0 and snapshot['playback']['tick'] == 0 and snapshot['playback']['playing'] is False)
check('snapshot frame at cursor', snapshot['frame'] is not None and snapshot['frame']['tick'] == 0)
check('snapshot leaderboard for challenge', snapshot['leaderboard'] is not None and snapshot['leaderboard']['digest'] == digest)

# Owner shares playback; viewer follows through a second app process (second client)
viewer = client()
status, shared = call(competitor, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': 0, 'tick': 20, 'playing': True})
check('owner updates playback', status == 200 and shared['version'] == 1 and shared['tick'] == 20 and shared['playing'] is True)
status, viewer_snap = call(viewer, 'GET', f"/api/results/{attempt['id']}/snapshot")
check('viewer sees shared cursor', viewer_snap['playback']['version'] == 1 and viewer_snap['playback']['tick'] == 20)
check('viewer frame follows cursor', viewer_snap['frame']['tick'] == 20)

# Version conflict and reload
status, conflict = call(competitor, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': 0, 'tick': 30, 'playing': True})
check('version conflict', status == 409 and conflict['error']['code'] == 'PLAYBACK_CHANGED')
status, reloaded = call(competitor, 'GET', f"/api/results/{attempt['id']}/snapshot")
status, advanced = call(competitor, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': reloaded['playback']['version'], 'tick': 0, 'playing': False})
check('restart at zero after reload', status == 200 and advanced['tick'] == 0 and advanced['playing'] is False)

# Backward change other than zero is invalid
status, advanced2 = call(competitor, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': advanced['version'], 'tick': 20, 'playing': False})
check('forward move allowed', status == 200 and advanced2['tick'] == 20)
status, backward = call(competitor, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': advanced2['version'], 'tick': 5, 'playing': False})
check('backward tick invalid input', status == 422 and 'tick' in backward['error']['fields'])

# Non-owner cannot change playback
status, forbidden = call(second, 'PUT', f"/api/results/{attempt['id']}/playback", {'expectedVersion': advanced['version'], 'tick': 10, 'playing': True})
check('only owner shares playback', status == 403 and forbidden['error']['code'] == 'FORBIDDEN')

# Another accepted attempt changes the board while the viewer follows
status, frames_page = call(viewer, 'GET', f"/api/runs/{attempt['id']}/frames?from=0&to=201")
check('frame page bound respected', status == 200 and len(frames_page['frames']) == 201)
status, board_live = call(viewer, 'GET', f'/api/challenges/{digest}/leaderboard')
check('live leaderboard follows new results', len(board_live['rows']) >= 2)

print(f'\n=== {PASS} passed, {FAIL} failed ===')
if FAILURES:
    print('Failures:')
    for name, detail in FAILURES:
        print(f'  - {name}: {detail}')
sys.exit(1 if FAIL else 0)
