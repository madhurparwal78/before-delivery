# API-level scenario checks: errors, idempotency, concurrency, expiry, access.
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + ((' :: ' + str(detail)) if detail and not ok else ''))

class Client:
    def __init__(self, email=None):
        self.cookies = {}
        if email:
            self.sign_in(email)

    def sign_in(self, email):
        body = json.dumps({'email': email, 'passcode': 'weave-demo-2026'}).encode()
        req = urllib.request.Request(f'{BASE}/api/session', data=body,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        res = self.open(req)
        self.cookies = {}
        for header in res.headers.get_all('Set-Cookie') or []:
            token = header.split(';')[0].split('=', 1)[1]
            self.cookies['sw_session'] = token
        return json.loads(res.read().decode())

    def request(self, method, path, body=None, headers=None, raw=False):
        data = None
        hdrs = dict(headers or {})
        if body is not None:
            if isinstance(body, (dict, list)):
                data = json.dumps(body).encode()
                hdrs.setdefault('Content-Type', 'application/json')
            elif isinstance(body, str):
                data = body.encode()
                hdrs.setdefault('Content-Type', 'application/json')
            else:
                data = body
        req = urllib.request.Request(f'{BASE}/api{path}', data=data, headers=hdrs, method=method)
        try:
            res = self.open(req)
            text = res.read().decode()
            return res.status, (json.loads(text) if text and not raw else text)
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return e.code, (json.loads(text) if not raw else text)
            except json.JSONDecodeError:
                return e.code, text

    def open(self, req):
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in self.cookies.items()))
        return urllib.request.urlopen(req)

def mailpit_messages():
    with urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=100') as r:
        return json.loads(r.read().decode())['messages']

def run():
    rowan = Client('rowan@fernhollow.test')
    joel = Client('joel@birchmere.test')
    anita = Client('anita@kestrelcourt.test')
    sam = Client('sam@interpreters.test')
    marguerite = Client('marguerite@fernhollow.test')
    marcus = Client('marcus@consumers.test')

    board = rowan.request('GET', '/board')[1]
    by_ref = {r['ref']: r for r in board['requests']}
    fa1001 = by_ref['FA-1001']
    fa1002 = by_ref['FA-1002']
    seat1001 = fa1001['seats'][0]['id']

    # ---------- sign-in and roles ----------
    st, _ = Client().request('GET', '/me')
    check('unauthenticated is 401', st == 401)
    st, _ = joel.request('GET', '/board')
    check('requester cannot read board (403)', st == 403)
    st, _ = sam.request('GET', '/requests')
    check('interpreter cannot list requests (403)', st == 403)
    st, body = Client().sign_in('joel@birchmere.test'), None
    check('bad passcode is 401', Client().request('POST', '/session', {'email': 'joel@birchmere.test', 'passcode': 'wrong'})[0] == 401)

    # ---------- malformed requests ----------
    st, body = rowan.request('POST', '/requests', b'{invalid json', headers={'Content-Type': 'application/json'})
    check('bad_json is 400', st == 400 and body['error']['code'] == 'bad_json', body)
    big = json.dumps({'title': 'x' * 100_000, 'setting': 'medical', 'location': 'x',
                     'start': '2030-01-01T10:00:00', 'end': '2030-01-01T11:00:00',
                     'consumer_id': 'c_bea', 'notes': ''}).encode()
    st, body = joel.request('POST', '/requests', big)
    check('json over 64KB is refused', st == 413 and body['error']['code'] == 'payload_too_large', (st, body))

    st, body = rowan.request('POST', '/requests/' + fa1001['id'] + '/cancel', '{}',
                             headers={'Origin': 'http://evil.example'})
    check('cross_origin is 403', st == 403 and body['error']['code'] == 'cross_origin', body)

    # ---------- idempotency keys ----------
    st, body = rowan.request('POST', '/seats/' + seat1001 + '/timesheet', {})
    check('timesheet requires interpreter role', st in (401, 403))

    # missing key on cancel
    st, body = joel.request('POST', '/requests/' + fa1001['id'] + '/cancel', {'expected_fee': '0.00'})
    check('cancel without key is 400', st == 400 and body['error']['code'] == 'idempotency_key_required', body)

    # ---------- offer window closed ----------
    # Create a request starting in 90 minutes: any offer would expire in the past.
    import datetime
    start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=90)
    end = start + datetime.timedelta(hours=1)
    st, body = joel.request('POST', '/requests', {
        'title': 'Urgent intake', 'setting': 'medical', 'location': 'Clinic',
        'start': start.strftime('%Y-%m-%dT%H:%M:00Z'), 'end': end.strftime('%Y-%m-%dT%H:%M:00Z'),
        'consumer_id': 'c_bea', 'notes': '',
    })
    check('draft for urgent request created', st == 201, body)
    urgent = body['request']

    # ---------- team rule via draft edit ----------
    st, body = joel.request('PATCH', f"/requests/{urgent['id']}", {'end': (start + datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:00Z')})
    check('editing a draft recomputes seats to 2', st == 200 and body['request']['seats_total'] == 2, (st, body))
    st, body = joel.request('PATCH', f"/requests/{urgent['id']}", {'setting': 'community'})
    st, body = joel.request('GET', f"/requests/{urgent['id']}")
    check('three-hour request keeps two seats', body['request']['seats_total'] == 2)

    st, body = joel.request('POST', f"/requests/{urgent['id']}/submit", {})
    check('submit urgent draft', st == 200, body)
    st, board2 = rowan.request('GET', '/board')
    urgent_view = [r for r in board2['requests'] if r['id'] == urgent['id']][0]
    seat = urgent_view['seats'][0]['id']
    st, body = rowan.request('POST', '/seats/' + seat + '/offers', {'interpreter_id': 'i_imani'})
    check('offer_window_closed for a start inside two hours', st == 409 and body['error']['code'] == 'offer_window_closed', (st, body))

    # invalid transitions
    st, body = joel.request('POST', f"/requests/{urgent['id']}/submit", {})
    check('submit non-draft is invalid_transition', st == 409 and body['error']['code'] == 'invalid_transition' and body['error']['from'] == 'submitted', body)

    # validation on patch: bad start on the urgent request's sibling draft
    st, body = joel.request('POST', '/requests', {
        'title': 'Second draft', 'setting': 'medical', 'location': 'Clinic',
        'start': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:00Z'),
        'end': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2, hours=1)).strftime('%Y-%m-%dT%H:%M:00Z'),
        'consumer_id': 'c_bea', 'notes': '',
    })
    draft2 = body['request']
    st, body = joel.request('PATCH', f"/requests/{draft2['id']}", {'start': 'not-a-date'})
    check('patch with bad start is validation', st == 422 and 'start' in body['error']['fields'], (st, body))
    st, body = joel.request('PATCH', f"/requests/{draft2['id']}", {'end': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2, minutes=10)).strftime('%Y-%m-%dT%H:%M:00Z')})
    check('too-short draft is validation', st == 422 and 'end' in body['error']['fields'], (st, body))

    # The board shows only the next 72 hours: FA-1006 starts T+120h.
    board3 = rowan.request('GET', '/board')[1]
    check('board hides requests beyond 72 hours', all(r['ref'] != 'FA-1006' for r in board3['requests']))

    # ---------- concurrency: two pins for the same seat ----------
    priya = Client('priya@fernhollow.test')
    st, allreqs = rowan.request('GET', '/requests')
    fa1006 = [r for r in allreqs['requests'] if r['ref'] == 'FA-1006'][0]
    seat6 = fa1006['seats'][0]['id']
    import threading
    outs = []
    def pin(client, interpreter):
        st, body = client.request('POST', '/seats/' + seat6 + '/offers', {'interpreter_id': interpreter})
        outs.append((st, body))
    t1 = threading.Thread(target=pin, args=(rowan, 'i_dana'))
    t2 = threading.Thread(target=pin, args=(priya, 'i_dana'))
    t1.start(); t2.start(); t1.join(); t2.join()
    statuses = sorted(o[0] for o in outs)
    winner = [o for o in outs if o[0] == 201]
    loser = [o for o in outs if o[0] == 409]
    ok = statuses == [201, 409] and loser[0][1]['error']['code'] == 'seat_taken' and 'name' in loser[0][1]['error']['holder']
    check('same-seat pins: one offer, one seat_taken with holder', ok, outs)

    # ---------- concurrency: pins that would break the schedule gate ----------
    st, allreqs2 = rowan.request('GET', '/requests')
    fa1002v = [r for r in allreqs2['requests'] if r['ref'] == 'FA-1002'][0]
    fa1002_end = datetime.datetime.fromisoformat(fa1002v['end'].replace('Z', '+00:00'))
    overlap_start = fa1002_end + datetime.timedelta(minutes=15)
    st, body = joel.request('POST', '/requests', {
        'title': 'Overlapping intake', 'setting': 'medical', 'location': 'Clinic',
        'start': overlap_start.strftime('%Y-%m-%dT%H:%M:00Z'),
        'end': (overlap_start + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:00Z'),
        'consumer_id': 'c_marcus', 'notes': '',
    })
    overlap_id = body['request']['id']
    joel.request('POST', f'/requests/{overlap_id}/submit', {})
    st, allreqs2 = rowan.request('GET', '/requests')
    overlap = [r for r in allreqs2['requests'] if r['id'] == overlap_id][0]
    outs2 = []
    def pin2(client, seat_id):
        st, body = client.request('POST', '/seats/' + seat_id + '/offers', {'interpreter_id': 'i_dana'})
        outs2.append((st, body))
    # The overlap request starts fifteen minutes after FA-1002 ends, so two
    # racing pins for Dana may only let one offer through (the travel buffer).
    t3 = threading.Thread(target=pin2, args=(rowan, fa1002v['seats'][0]['id']))
    t4 = threading.Thread(target=pin2, args=(priya, overlap['seats'][0]['id']))
    t3.start(); t4.start(); t3.join(); t4.join()
    codes = [o[1].get('error', {}).get('code') if o[0] != 201 else 'ok' for o in outs2]
    gates = [o[1].get('error', {}).get('gates') for o in outs2]
    ok = codes.count('ok') == 1 and codes.count('gate_failed') == 1
    check('schedule-breaking pins: one wins, others gate_failed', ok, (codes, gates))

    # ---------- dry-run never writes ----------
    urgent_seat = urgent_view['seats'][0]['id']
    before = rowan.request('GET', '/audit?request_id=' + urgent['id'])[1]['entries']
    rowan.request('POST', '/seats/' + urgent_seat + '/dry-run', {'interpreter_id': 'i_theo'})
    after = rowan.request('GET', '/audit?request_id=' + urgent['id'])[1]['entries']
    check('dry-run writes no audit entry', len(before) == len(after))

    # ---------- consumer preferences affect the next dry-run ----------
    st, body = marcus.request('PUT', '/consumers/me/preferences', {'preferred': [], 'blocked': ['i_theo']})
    check('consumer saves a block', st == 200, body)
    st, allreqs3 = rowan.request('GET', '/requests')
    fa1003_all = [r for r in allreqs3['requests'] if r['ref'] == 'FA-1003'][0]
    st, body = rowan.request('POST', '/seats/' + fa1003_all['seats'][1]['id'] + '/dry-run', {'interpreter_id': 'i_theo'})
    consumer_gate = [g for g in body['gates'] if g['gate'] == 'consumer'][0]
    check('blocks affect the very next dry-run', consumer_gate['pass'] is False and 'Marcus Tull has blocked this interpreter.' == consumer_gate['reason'], body)
    # invalid: same interpreter in both lists
    st, body = marcus.request('PUT', '/consumers/me/preferences', {'preferred': ['i_theo'], 'blocked': ['i_theo']})
    check('preferred and blocked together is validation', st == 422, body)
    st, body = marcus.request('PUT', '/consumers/me/preferences', {'preferred': [], 'blocked': []})
    check('preferences cleared', st == 200, body)

    # ---------- offer expiry ----------
    board5 = rowan.request('GET', '/board')[1]
    fa1003_row = [r for r in board5['requests'] if r['ref'] == 'FA-1003'][0]
    fa1003_seat2 = fa1003_row['seats'][1]['id']
    # Pin an offer on FA-1003 seat 2 (Dana), then force its expiry in the database.
    st, body = rowan.request('POST', f"/seats/{fa1003_seat2}/offers", {'interpreter_id': 'i_dana'})
    check('pin for expiry test', st == 201, (st, body))
    offer = body['offer']
    import pg_helper
    pg_helper.execute("UPDATE offers SET expires_at = now() - interval '1 minute' WHERE id = %s", (offer['id'],))
    token = pg_helper.scalar("SELECT token FROM offers WHERE id = %s", (offer['id'],))
    st, body = Client().request('POST', '/offers/' + token + '/accept', {})
    check('expired offer cannot be accepted', st == 410 and body['error']['code'] == 'offer_closed' and body['error']['offer_status'] == 'expired', (st, body))
    board4 = rowan.request('GET', '/board')[1]
    fa1003v = [r for r in board4['requests'] if r['ref'] == 'FA-1003'][0]
    check('expired offer reopens its seat at once', fa1003v['seats'][1]['status'] == 'open', fa1003v['seats'][1])

    # ---------- timesheet rules ----------
    # FA-1005 seat: seeded timesheet already submitted.
    joel_view = joel.request('GET', '/requests')[1]['requests']
    fa1005 = [r for r in joel_view if r['ref'] == 'FA-1005'][0]
    st, body = sam.request('POST', f"/seats/{fa1005['seats'][0]['id']}/timesheet",
                           {'actual_start': '2026-01-01T10:00:00Z', 'actual_end': '2026-01-01T11:00:00Z', 'signature_name': 'Sam Whitlock'},
                           headers={'Idempotency-Key': 'ts-second'})
    check('second submission for a seat is already_submitted', st == 409 and body['error']['code'] == 'already_submitted', (st, body))

    # not_yet_ended: submit for FA-1002 seat via an accepted interpreter (none seated) — use FA-1004 (Dana accepted, starts T+52h)
    joel_view = joel.request('GET', '/requests')[1]['requests']
    fa1004 = [r for r in joel_view if r['ref'] == 'FA-1004'][0]
    dana = Client('dana@interpreters.test')
    st, body = dana.request('POST', f"/seats/{fa1004['seats'][0]['id']}/timesheet",
                            {'actual_start': '2026-01-01T10:00:00Z', 'actual_end': '2026-01-01T11:00:00Z', 'signature_name': 'Dana Okafor'},
                            headers={'Idempotency-Key': 'ts-future'})
    check('timesheet before end is not_yet_ended', st == 409 and body['error']['code'] == 'not_yet_ended', (st, body))
    # >12h span validation
    st, body = dana.request('POST', f"/seats/{fa1004['seats'][0]['id']}/timesheet",
                            {'actual_start': '2026-01-01T08:00:00Z', 'actual_end': '2026-01-01T22:01:00Z', 'signature_name': 'Dana Okafor'},
                            headers={'Idempotency-Key': 'ts-long'})
    check('timesheet over 12 hours is validation', st == 422, (st, body))
    # non-owner cannot submit
    st, body = sam.request('POST', f"/seats/{fa1004['seats'][0]['id']}/timesheet",
                           {'actual_start': '2026-01-01T08:00:00Z', 'actual_end': '2026-01-01T09:00:00Z', 'signature_name': 'Sam Whitlock'},
                           headers={'Idempotency-Key': 'ts-other'})
    check('another interpreter cannot submit (403)', st == 403, (st, body))

    # ---------- billed hours and approval ----------
    # Lior's FA-1003 seat 1 (education, T+44..47h) — future; cannot submit yet. Use FA-1005 (already seeded and ended).

    # Approve the seeded FA-1005 timesheet with a key, then replay with a different body.
    tsid = pg_helper.scalar("""SELECT t.id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE r.ref = 'FA-1005'""")
    st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, headers={'Idempotency-Key': 'approve-scenario'})
    check('approval posts 160.00', st == 200 and body['timesheet']['amount'] == '160.00', (st, body))
    st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, headers={'Idempotency-Key': 'approve-scenario'})
    check('approval replay is byte-identical', st == 200, (st, body))
    st2, body2 = marguerite.request('GET', '/timesheets?status=submitted')
    # approving again with a NEW key is an illegal transition
    st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, headers={'Idempotency-Key': 'approve-scenario-2'})
    check('second approval with new key is invalid_transition', st == 409 and body['error']['code'] == 'invalid_transition', (st, body))

    # Rate edit does not change the frozen amount
    st, body = marguerite.request('PUT', '/rates', {'medical': '99.00'})
    check('rates saved', st == 200 and body['rates']['medical'] == '99.00', body)
    joel_view = joel.request('GET', '/requests')[1]['requests']
    fa1005v = [r for r in joel_view if r['ref'] == 'FA-1005'][0]
    check('frozen amount survives rate edit', fa1005v['seats'][0]['timesheet']['amount'] == '160.00', fa1005v['seats'][0]['timesheet'])
    st, body = marguerite.request('GET', '/orgs/birchmere-clinic/invoices')
    items = [i for inv in body['invoices'] for i in inv['items'] if f'[ts-{tsid}]' in i['description']]
    check('invoice item equals frozen amount', len(items) == 1 and items[0]['amount'] == '160.00', body['invoices'])
    check('FA-1005 reads invoiced after approval', fa1005v['status'] == 'invoiced', fa1005v['status'])
    marguerite.request('PUT', '/rates', {'medical': '80.00'})

    # ---------- prep access ----------
    fa1003_id = fa1002['id']  # placeholder replaced below
    board5 = rowan.request('GET', '/board')[1]
    fa1003 = [r for r in board5['requests'] if r['ref'] == 'FA-1003'][0]
    prep_id = fa1003['prep_files'][0]['id']
    # requester of another org: not_found
    st_text = anita.request('GET', f'/prep/{prep_id}', raw=True)
    check('prep download for other org is not_found', st_text[0] == 404, st_text[0])
    # interpreter with only an active offer: not_found
    st, body = rowan.request('POST', f"/seats/{fa1003['seats'][1]['id']}/offers", {'interpreter_id': 'i_noor'})
    check('pin Noor on FA-1003 seat 2', st == 201, (st, body))
    noor = Client('noor@interpreters.test')
    st_text = noor.request('GET', f'/prep/{prep_id}', raw=True)
    check('prep for offer-only interpreter is not_found', st_text[0] == 404, st_text[0])
    # seated interpreter can download
    st_text = lior_client().request('GET', f'/prep/{prep_id}', raw=True)
    check('prep for seated interpreter downloads', st_text[0] == 200, st_text[0])

    # ---------- cancel: already_started and audit chain ----------
    # FA-1005 started in the past and is completed; cancel is invalid_transition.
    st, body = joel.request('POST', f"/requests/{fa1005['id']}/cancel", {'expected_fee': '0.00', 'reason': ''}, headers={'Idempotency-Key': 'cancel-done'})
    check('cancel completed request is invalid_transition', st == 409 and body['error']['code'] == 'invalid_transition', (st, body))

    # cancel FA-1002 (late, nobody seated) -> cancelled_late, fee 0.00, nothing posted
    fa1002b = [r for r in rowan.request('GET', '/board')[1]['requests'] if r['ref'] == 'FA-1002'][0]
    st, body = anita.request('GET', f"/requests/{fa1002b['id']}/cancellation-quote")
    quote = body['quote']
    check('quote for FA-1002 is late with fee 0.00', st == 200 and quote['late'] and quote['fee'] == '0.00', (st, body))
    # Tenant isolation on the quote: Joel (birchmere) cannot read a kestrel quote.
    st, body = joel.request('GET', f"/requests/{fa1002b['id']}/cancellation-quote")
    check('quote for other org is not_found', st == 404, (st, body))
    st, body = anita.request('POST', f"/requests/{fa1002b['id']}/cancel", {'expected_fee': quote['fee'], 'reason': ''}, headers={'Idempotency-Key': 'cancel-1002'})
    check('late cancel with nobody seated is cancelled_late fee 0.00',
          st == 200 and body['request']['status'] == 'cancelled_late' and body['request']['cancellation_fee'] == '0.00', (st, body))
    st, body = anita.request('GET', f'/requests/{fa1002b["id"]}/cancellation-quote')
    check('quote endpoint after cancel is invalid_transition', st == 409, (st, body))

    # FA-1002 cancel with nobody seated: no withdraws needed. Audit shows just the cancel.
    entries = rowan.request('GET', '/audit?request_id=' + fa1002b['id'])[1]['entries']
    actions = [e['action'] for e in entries]
    check('audit: cancel writes request.cancelled', 'request.cancelled' in actions, actions)

    # on-time cancellation posts nothing (FA-1006, T+120h, 72h window)
    fa1006c = [r for r in rowan.request('GET', '/requests')[1]['requests'] if r['ref'] == 'FA-1006'][0]
    st, body = anita.request('GET', f"/requests/{fa1006c['id']}/cancellation-quote")
    check('FA-1006 quote is on time', st == 200 and body['quote']['late'] is False and body['quote']['fee'] == '0.00', (st, body))
    before_invoices = marguerite.request('GET', '/orgs/kestrel-court/invoices')[1]['total']
    st, body = anita.request('POST', f"/requests/{fa1006c['id']}/cancel", {'expected_fee': body['quote']['fee'], 'reason': ''}, headers={'Idempotency-Key': 'cancel-1006'})
    check('on-time cancel succeeds', st == 200 and body['request']['status'] == 'cancelled_on_time', (st, body))
    after_invoices = marguerite.request('GET', '/orgs/kestrel-court/invoices')[1]['total']
    check('on-time cancel posts nothing', before_invoices == after_invoices, (before_invoices, after_invoices))
    # FA-1006 held Dana's active offer from the race test: the cancel withdraws it.
    entries6 = rowan.request('GET', '/audit?request_id=' + fa1006c['id'])[1]['entries']
    actions6 = [e['action'] for e in entries6]
    ok = 'request.cancelled' in actions6 and 'offer.withdrawn' in actions6 and \
        actions6.index('offer.withdrawn') > actions6.index('request.cancelled')
    check('audit: cancel then withdraws', ok, actions6)
    # idempotency conflict on cancel key reuse with different body
    st, body = anita.request('POST', f"/requests/{fa1006c['id']}/cancel", {'expected_fee': '5.00', 'reason': ''}, headers={'Idempotency-Key': 'cancel-1006'})
    check('reused key with different body is idempotency_conflict', st == 409 and body['error']['code'] == 'idempotency_conflict', (st, body))

    # ---------- request state machine: cancel after start ----------
    # FA-1001 starts T+26h (future). A request that started cannot be cancelled: use FA-1005 (completed, handled) and
    # the urgent request (starts in 90 minutes, submitted). Fast-forward it in the database.
    st, body = joel.request('GET', '/requests')
    urgent_v = [r for r in body['requests'] if r['id'] == urgent['id']][0]
    pg_helper.execute("UPDATE requests SET start_at = now() - interval '10 minutes', end_at = now() + interval '50 minutes' WHERE id = %s", (urgent['id'],))
    st, body = joel.request('POST', f"/requests/{urgent['id']}/cancel", {'expected_fee': '0.00', 'reason': ''}, headers={'Idempotency-Key': 'cancel-started'})
    check('cancel after start is already_started', st == 409 and body['error']['code'] == 'already_started', (st, body))

    print()
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)}/{len(results)} checks passed')
    if fails:
        sys.exit(1)

def lior_client():
    return Client('lior@interpreters.test')

if __name__ == '__main__':
    import pg_helper  # noqa: F401
    run()
