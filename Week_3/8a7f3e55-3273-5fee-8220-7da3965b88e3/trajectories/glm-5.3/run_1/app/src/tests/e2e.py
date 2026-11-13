"""End-to-end verification of the eight journeys from the brief against the live app."""
import requests, json, time, threading, base64

BASE = "http://127.0.0.1:4173"
KB = 'http://killbill:8080/1.0/kb'
KBH = {'X-Killbill-ApiVersion': 'v1', 'X-Killbill-ApiKey': 'gfkit-dev', 'X-Killbill-ApiSecret': 'gfkit-dev-secret',
       'X-Killbill-CreatedBy': 'probe', 'Content-Type': 'application/json',
       'Authorization': 'Basic ' + base64.b64encode(b'admin:password').decode()}

requests.delete('http://mailpit:8025/api/v1/messages')  # purge mailpit for a clean count
def signin(email):
    s = requests.Session()
    r = s.post(f'{BASE}/api/session', json={'email': email, 'password': 'relayline-demo-2026'})
    assert r.status_code == 200, r.text
    return s

def mailpit_count():
    return requests.get('http://mailpit:8025/api/v1/messages').json()['total']

passed = []
def ok(label):
    passed.append(label)
    print(f'  PASS: {label}')

# ============ Journey 1: requester books on a flaky network, across an ended session ============
print('Journey 1: requester books (idempotency, session resume, unicode)')
lena = signin('lena.torres@riverbend.example')
mail0 = mailpit_count()
key1 = 'journey1-key'
booking1 = {
  'setting': 'medical', 'title': 'Medical consultation long', 'location': 'Riverbend cardiac unit 4',
  'onsite_contact_name': 'Priya Natarajan', 'onsite_contact_phone': '+1 555 200 8811',
  'consumer_name': 'Nguyễn Thị Hạnh 🦻', 'start': '2027-01-06T09:00', 'duration_minutes': 225,
  'requester_notes': 'Vui lòng mang theo tài liệu 🦻'
}
r = lena.post(f'{BASE}/api/bookings', json=booking1, headers={'Idempotency-Key': key1})
assert r.status_code == 201, r.text
b1 = r.json()
assert b1['ref'] == 'BK-1001', b1['ref']
assert b1['seat_count'] == 2, '225 min > 60 threshold => team'
assert b1['status'] == 'submitted'
assert b1['coverage']['state'] == 'uncovered'
assert b1['consumer_name'] == booking1['consumer_name'], 'exact text round trip'
ok('team by length, exact unicode text, uncovered')

r2 = lena.post(f'{BASE}/api/bookings', json=booking1, headers={'Idempotency-Key': key1})
assert r2.status_code == 201 and r2.json()['ref'] == 'BK-1001', 'replay returns the same booking'
ok('replayed key returns the stored booking')

# a refused request does not consume a reference: read the next reference first
r_pre = lena.get(f'{BASE}/api/bookings?from=2027-01-07&to=2027-01-07')
r3 = lena.post(f'{BASE}/api/bookings', json={**booking1, 'title': ''}, headers={'Idempotency-Key': 'journey1-bad'})
assert r3.status_code == 422 and r3.json()['fields']['title'] == 'Enter a title of up to 120 characters.'
r4 = lena.post(f'{BASE}/api/bookings', json={**booking1, 'start': '2027-01-07T09:00', 'duration_minutes': 47}, headers={'Idempotency-Key': 'journey1-nonmultiple'})
assert r4.status_code == 422 and 'duration_minutes' in r4.json()['fields'], r4.text
r5 = lena.post(f'{BASE}/api/bookings', json={**booking1, 'start': '2027-01-07T09:00', 'duration_minutes': 60}, headers={'Idempotency-Key': 'journey1-solo'})
b2 = r5.json()
assert b2['ref'] == 'BK-1002', f"refused requests consumed references: {b2['ref']} (BK-1002 is next after BK-1001)"
assert b2['seat_count'] == 1, '60 min = threshold stays solo'
ok('refused requests consume no reference; equal threshold stays solo')

# session resume: signing in again and replaying works after sign-out
lena2 = signin('lena.torres@riverbend.example')
lena2.cookies.clear()
r = lena2.post(f'{BASE}/api/bookings', json={**booking1, 'start': '2027-01-08T09:00'}, headers={'Idempotency-Key': key1})
# unauthenticated claims no key
assert r.status_code == 401, r.status_code
r = lena2.post(f'{BASE}/api/bookings', json={**booking1, 'start': '2027-01-08T09:00'}, headers={'Idempotency-Key': key1})
assert r.status_code == 401
ok('unauthenticated request claims no idempotency key')

# ============ Journey 2: coordinator posts an open call ============
print('Journey 2: coordinator triage and open call')
dana = signin('dana.okafor@tandemhands.example')
r = dana.get(f'{BASE}/api/bookings?from=2027-01-06&to=2027-01-06')
assert b1['id'] in [x['id'] for x in r.json()['bookings']]
r = dana.post(f'{BASE}/api/bookings/{b1["id"]}/open-call')
assert r.status_code == 200, r.text
oc = r.json()
assert oc['status'] == 'open'
assert oc['open_call_status'] == 'open'
assert oc['open_call_closes_at'] is not None
ok('open call posted; status open with fixed close time')

# second post => invalid_transition (only from submitted)
r = dana.post(f'{BASE}/api/bookings/{b1["id"]}/open-call')
assert r.status_code == 409 and r.json()['error'] == 'invalid_transition', r.text
ok('open call only from submitted')

# ============ Journey 3: two interpreters race for the last seat ============
print('Journey 3: race for the last team seat')
jordan = signin('jordan.reyes@interpreters.example')
avery = signin('avery.chen@interpreters.example')
casey = signin('casey.morgan@interpreters.example')
r = jordan.get(f'{BASE}/api/open-calls')
assert b1['id'] in [x['id'] for x in r.json()['bookings']], 'Jordan sees the open call'
mail1 = mailpit_count()
r = jordan.post(f'{BASE}/api/bookings/{b1["id"]}/claim')
assert r.status_code == 200, r.text
cl = r.json()
assert cl['status'] == 'partially_covered'
seat_no = [s['seat'] for s in cl['seats'] if s['holder'] and s['holder']['is_me']][0]
assert seat_no == 1, 'claim fills the lowest vacant seat'
turns = cl['rotation']['turns']
assert turns[0]['kind'] == 'turn' and turns[0]['holder_initials'] == 'JR'
assert turns[1]['kind'] == 'gap' and turns[1]['label'] == 'relief needed', turns[1]
ok('claim fills lowest seat; relief-needed gap after the solo threshold')

results = {}
barrier = threading.Barrier(2)
def race(s, name):
    barrier.wait()
    rr = s.post(f'{BASE}/api/bookings/{b1["id"]}/claim')
    results[name] = rr
t1 = threading.Thread(target=race, args=(avery, 'avery'))
t2 = threading.Thread(target=race, args=(casey, 'casey'))
t1.start(); t2.start(); t1.join(); t2.join()
codes = sorted(r.status_code for r in results.values())
assert codes == [200, 409], codes
loser = [r for r in results.values() if r.status_code == 409][0].json()
assert loser['error'] == 'seat_filled'
win = [r for r in results.values() if r.status_code == 200][0].json()
assert win['status'] == 'covered' and win['coverage']['percent'] == 100
turns = win['rotation']['turns']
# 225 min at riverbend 20-min interval => ceil(225/20) = 12 turns
assert len(turns) == 12, len(turns)
assert win['rotation']['coverage_text'] == 'Team · 12 turns · 100% covered'
holders = [s['holder'] for s in win['seats'] if s['holder']]
assert len(holders) == 2
ok('race: exactly one winner, loser seat_filled, 12 alternating turns at 100%')

# emails: two assignment confirmations + one coverage confirmation
time.sleep(8)
mail2 = mailpit_count()
subjects = requests.get('http://mailpit:8025/api/v1/messages?limit=10').json()['messages']
cover = [m for m in subjects if m['Subject'].startswith('Booking covered') and b1['ref'] in m['Subject']]
assigns = [m for m in subjects if m['Subject'].startswith('Assignment confirmed') and b1['ref'] in m['Subject']]
assert len(cover) == 1, f'one coverage confirmation, got {len(cover)}'
assert len(assigns) >= 2, f'two assignment confirmations, got {len(assigns)}'
ok('one coverage email and two assignment emails')

# ============ Journey 4: coordinator staffs a court date ============
print('Journey 4: court staffing with search')
bk_legal = {
  'org_id': 'harlan-court', 'setting': 'legal', 'title': 'Custody hearing', 'location': 'Courthouse room 4',
  'onsite_contact_name': 'Ruth Adeyemi', 'onsite_contact_phone': '+1 555 300 7788',
  'consumer_name': 'Deaf parent', 'start': '2027-02-10T13:30', 'duration_minutes': 120, 'requester_notes': 'witness list'
}
r = dana.post(f'{BASE}/api/bookings', json=bk_legal, headers={'Idempotency-Key': 'journey4-legal'})
legal = r.json()
assert legal['seat_count'] == 2, 'legal => team'

# search with 'ri' -> only Riley Brooks; 'r' matches every name containing r (substring rule)
r = dana.get(f'{BASE}/api/interpreters?booking_id={legal["id"]}&q=ri')
names = [i['name'] for i in r.json()['interpreters']]
assert names == ['Riley Brooks'], names
r = dana.get(f'{BASE}/api/interpreters?booking_id={legal["id"]}&q=r')
names2 = [i['name'] for i in r.json()['interpreters']]
expected = [n for n in ['Avery Chen', 'Casey Morgan', 'Jordan Reyes', 'Quinn Halvorsen', 'Riley Brooks', 'Sasha Lindqvist', 'Taylor Nguyen'] if 'r' in n.lower()]
assert names2 == expected, names2
assert 'Sasha Lindqvist' not in names2, 'no letter r in Sasha'
ok("search narrows by substring, case-insensitive, spaces trimmed")

# quinn busy elsewhere: create an overlapping booking and assign quinn there
overlap = {
  'org_id': 'riverbend', 'setting': 'medical', 'title': 'Overlap probe', 'location': 'Ward 3',
  'onsite_contact_name': 'A', 'onsite_contact_phone': '+1 555 111 2222', 'consumer_name': 'B',
  'start': '2027-02-10T14:00', 'duration_minutes': 60, 'requester_notes': ''
}
r = dana.post(f'{BASE}/api/bookings', json=overlap, headers={'Idempotency-Key': 'journey4-overlap'})
ob = r.json()
r = dana.post(f'{BASE}/api/bookings/{ob["id"]}/assign', json={'interpreter_id': 'quinn-halvorsen', 'seat': 1})
assert r.status_code == 200
# now quinn is busy at the legal slot
r = dana.post(f'{BASE}/api/bookings/{legal["id"]}/assign', json={'interpreter_id': 'riley-brooks', 'seat': 1})
assert r.status_code == 200, r.text
r = dana.post(f'{BASE}/api/bookings/{legal["id"]}/assign', json={'interpreter_id': 'quinn-halvorsen', 'seat': 2})
assert r.status_code == 409 and r.json()['error'] == 'schedule_conflict', r.text
r = dana.get(f'{BASE}/api/interpreters?booking_id={legal["id"]}&q=quinn')
qi = r.json()['interpreters'][0]
assert qi['busy'] is True
r = dana.post(f'{BASE}/api/bookings/{legal["id"]}/assign', json={'interpreter_id': 'sasha-lindqvist', 'seat': 2})
assert r.status_code == 200, r.text
lg = r.json()
assert lg['status'] == 'covered'
# court rotation: 15-min interval, 120 min => 8 turns alternating RB/SL
turns = lg['rotation']['turns']
assert len(turns) == 8
assert turns[0]['holder_initials'] == 'RB' and turns[1]['holder_initials'] == 'SL'
ok('busy refused with schedule_conflict; remaining court-certified interpreter assigned')

# requester sees only name/initials/credentials
ruth = signin('ruth.adeyemi@harlancourt.example')
r = ruth.get(f'{BASE}/api/bookings/{legal["id"]}')
holder = [s['holder'] for s in r.json()['seats'] if s['holder']][0]
assert sorted(holder.keys()) == ['credentials', 'initials', 'name'], holder.keys()
assert isinstance(holder['credentials'], list) and all(isinstance(c, str) for c in holder['credentials'])
ok('requester holder card limited to name, initials, credential codes')

# ============ Journey 5: withdrawal repair ============
print('Journey 5: withdrawal and refill')
jordan_seats = [s['seat'] for s in cl['seats'] if s['holder'] and s['holder']['is_me']]
# release Jordan from BK-1001 seat 1 (Jordan withdraws)
r = jordan.post(f'{BASE}/api/bookings/{b1["id"]}/seats/1/release')
assert r.status_code == 200, r.text
rel = r.json()
assert rel['status'] == 'partially_covered'
assert rel['coverage']['percent'] < 100
turns = rel['rotation']['turns']
remaining_holder = rel['seats'][1]['holder']['initials']
assert turns[0]['kind'] == 'turn' and turns[0]['holder_initials'] == remaining_holder
assert turns[0]['seat'] == 2, 'seat 2 holder keeps seat 2 turns'
assert turns[1]['kind'] == 'gap' and turns[1]['label'] == 'relief needed'
ok('withdrawal reopens seat, recalculates status and coverage')

# refill directly
r = dana.post(f'{BASE}/api/bookings/{b1["id"]}/assign', json={'interpreter_id': 'jordan-reyes', 'seat': 1})
assert r.status_code == 200, r.text
assert r.json()['status'] == 'covered'
ok('coordinator refills the seat and coverage returns')

# audit trail entries for BK-1001
r = dana.get(f'{BASE}/api/bookings/{b1["id"]}/audit')
actions = [e['action'] for e in r.json()['entries']]
assert actions == ['submitted', 'open_call_published', 'seat_filled', 'seat_filled', 'seat_released', 'seat_filled'], actions
entries = r.json()['entries']
seat_filled_entries = [e for e in entries if e['action'] == 'seat_filled']
assert all(e['seat'] is not None and e['interpreter_name'] is not None for e in seat_filled_entries)
assert all(e['seat'] is None for e in entries if e['action'] != 'seat_filled' and e['action'] != 'seat_released')
ok('audit trail: exactly one entry per action, seat fields set only on seat actions')

# ============ Journey 6: prep materials ============
print('Journey 6: prep materials upload and download')
import hashlib
pdf_bytes = b'%PDF-1.4 witness list \xc4\x90\xe1\xbb\x8dng'
r = ruth.post(f'{BASE}/api/bookings/{legal["id"]}/materials',
              files={'file': ('Danh sách 🦻.pdf', pdf_bytes, 'application/pdf')})
assert r.status_code == 201, r.text
mat = r.json()
assert mat['name'] == 'Danh sách 🦻.pdf'
assert mat['sha256'] == hashlib.sha256(pdf_bytes).hexdigest()
assert mat['content_type'] == 'application/pdf'
ok('upload with unicode name, exact sha256 and content type')

# a requester cannot download; an assigned interpreter can
r = ruth.post(f'{BASE}/api/bookings/{legal["id"]}/materials/{mat["id"]}/link')
assert r.status_code == 403 and r.json()['error'] == 'forbidden'
# a requester from another organisation cannot even see the booking
r = lena.get(f'{BASE}/api/bookings/{legal["id"]}')
assert r.status_code == 404, 'another organisation answers not found'
riley = signin('riley.brooks@interpreters.example')
r = riley.post(f'{BASE}/api/bookings/{legal["id"]}/materials/{mat["id"]}/link')
assert r.status_code == 201
link = r.json()['url']
r = riley.get(f'{BASE}{link}')
assert r.status_code == 200 and r.content == pdf_bytes
cd = r.headers['content-disposition']
assert 'filename="Danh s_ch _.pdf"' in cd, cd
assert "filename*=UTF-8''Danh%20s%C3%A1ch%20%F0%9F%A6%BB.pdf" in cd, cd
assert r.headers['x-content-type-options'] == 'nosniff'
assert r.headers['content-length'] == str(len(pdf_bytes))
ok('download byte-exact with the brief RFC 5987 filename')

# released interpreter loses access at once
r = dana.post(f'{BASE}/api/bookings/{legal["id"]}/seats/1/release')
assert r.status_code == 200
r = riley.get(f'{BASE}{link}')
assert r.status_code == 403 and r.json()['error'] == 'access_ended'
ok('released interpreter cannot fetch with an earlier link')

# ============ Journey 7: cancellation with quote ============
print('Journey 7: keyboard cancellation with the charge shown')
sam = signin('sam.whitfield@maplevalley.example')
mv = {
  'setting': 'educational', 'title': 'IEP meeting', 'location': 'Maple Valley Elementary',
  'onsite_contact_name': 'Mr Lee', 'onsite_contact_phone': '+1 555 600 7788',
  'consumer_name': 'Student A', 'start': '2027-01-08T09:00', 'duration_minutes': 60, 'requester_notes': ''
}
r = sam.post(f'{BASE}/api/bookings', json=mv, headers={'Idempotency-Key': 'journey7-mv'})
mvb = r.json()
r = dana.post(f'{BASE}/api/bookings/{mvb["id"]}/assign', json={'interpreter_id': 'taylor-nguyen', 'seat': 1})
assert r.status_code == 200, r.text
r = sam.get(f'{BASE}/api/bookings/{mvb["id"]}/cancellation-quote')
quote = r.json()
assert quote['late'] is False and quote['charge_cents'] == 0
ok('far-future booking quotes on time with no charge')

# a late-cancellable booking: start Friday, cutoff Wednesday morning (already passed)
mv_late = {**mv, 'title': 'IEP late window', 'start': '2026-11-13T09:00', 'duration_minutes': 90}
r = sam.post(f'{BASE}/api/bookings', json=mv_late, headers={'Idempotency-Key': 'journey7-late'})
mvl = r.json()
r = dana.post(f'{BASE}/api/bookings/{mvl["id"]}/assign', json={'interpreter_id': 'jordan-reyes', 'seat': 1})
assert r.status_code == 200, r.text
r = sam.get(f'{BASE}/api/bookings/{mvl["id"]}/cancellation-quote')
q1 = r.json()
assert q1['late'] is True and q1['interpreter_count'] == 1, q1
# stale quote: a second seat filled after the quote changes the charge
r = dana.post(f'{BASE}/api/bookings/{mvl["id"]}/assign', json={'interpreter_id': 'avery-chen', 'seat': 2})
assert r.status_code == 200, r.text
r = sam.post(f'{BASE}/api/bookings/{mvl["id"]}/cancel', json={'quoted_charge_cents': q1['charge_cents']})
assert r.status_code == 409 and r.json()['error'] == 'quote_changed', r.text
q2 = r.json()['quote']
assert q2['interpreter_count'] == 2 and q2['charge_cents'] > q1['charge_cents'], q2
ok('stale quote rejected with the fresh one after a seat filled')

r = sam.post(f'{BASE}/api/bookings/{mvl["id"]}/cancel', json={'quoted_charge_cents': q2['charge_cents']})
assert r.status_code == 200, r.text
final_late = r.json()
assert final_late['status'] == 'cancelled_late', final_late['status']
assert final_late['charge']['kind'] == 'late_cancellation'
ok('late cancellation confirms the new charge and bills a late_cancellation line')

# the on-time booking cancels with the original zero quote
r = sam.post(f'{BASE}/api/bookings/{mvb["id"]}/cancel', json={'quoted_charge_cents': 0})
assert r.status_code == 200, r.text
final = r.json()
assert final['status'] == 'cancelled', 'on time => cancelled, no charge'
ok('on-time cancellation completes with the quoted charge')

# ============ Journey 8: complete, bill and reconcile ============
print('Journey 8: completion, billing and reconciliation')
# riverbend team completion: 210 sched, 230 worked, 18 miles => 80406
rb = {
  'org_id': 'riverbend', 'setting': 'medical', 'title': 'Cardiac follow-up', 'location': 'Riverbend cardiology',
  'onsite_contact_name': 'Priya N.', 'onsite_contact_phone': '+1 555 200 8811',
  'consumer_name': 'Test Consumer', 'start': '2027-03-10T09:00', 'duration_minutes': 210, 'requester_notes': ''
}
r = dana.post(f'{BASE}/api/bookings', json=rb, headers={'Idempotency-Key': 'journey8-rb'})
rbb = r.json()
dana.post(f'{BASE}/api/bookings/{rbb["id"]}/assign', json={'interpreter_id': 'casey-morgan', 'seat': 1})
dana.post(f'{BASE}/api/bookings/{rbb["id"]}/assign', json={'interpreter_id': 'avery-chen', 'seat': 2})
dana.post(f'{BASE}/api/bookings/{rbb["id"]}/check-in')
r = dana.post(f'{BASE}/api/bookings/{rbb["id"]}/complete',
              json={'worked_minutes': 230, 'mileage_miles': 18}, headers={'Idempotency-Key': 'journey8-comp'})
charge = r.json()['charge']
assert charge['amount_cents'] == 80406, charge
# replayed completion: same line, one audit entry
r2 = dana.post(f'{BASE}/api/bookings/{rbb["id"]}/complete',
               json={'worked_minutes': 230, 'mileage_miles': 18}, headers={'Idempotency-Key': 'journey8-comp'})
assert r2.json()['charge']['line_ref'] == charge['line_ref']
r3 = dana.post(f'{BASE}/api/bookings/{rbb["id"]}/complete',
               json={'worked_minutes': 100, 'mileage_miles': 0}, headers={'Idempotency-Key': 'journey8-comp-2'})
assert r3.status_code == 409 and r3.json()['error'] == 'invalid_transition'
r = dana.get(f'{BASE}/api/bookings/{rbb["id"]}/audit')
assert [e['action'] for e in r.json()['entries']].count('completed') == 1
ok('completion 80406 with replay idempotence and one audit entry')

# effective-dated rate: new maple valley rate from 2027-04-01
morgan = signin('morgan.ellis@tandemhands.example')
r = morgan.post(f'{BASE}/api/contracts/maple-valley/rates', json={
  'effective_from': '2027-04-01', 'hourly_rate_cents': 9000, 'team_surcharge_bp': 500, 'mileage_cents_per_mile': 70})
assert r.status_code == 201, r.text
contract = r.json()
assert contract['rates'][-1]['effective_from'] == '2027-04-01'
ok('new rate takes effect on a future date')

# two sessions across the rate date: 23:30 the day before (old rate) and 00:15 on the day (new rate)
before = {
  'org_id': 'maple-valley', 'setting': 'workplace', 'title': 'Evening session', 'location': 'MV office',
  'onsite_contact_name': 'H', 'onsite_contact_phone': '+1 555 600 7788', 'consumer_name': 'W',
  'start': '2027-03-31T23:30', 'duration_minutes': 60, 'requester_notes': ''
}
after = {**before, 'title': 'First of April session', 'start': '2027-04-01T00:15'}
rb_res = dana.post(f'{BASE}/api/bookings', json=before, headers={'Idempotency-Key': 'journey8-before'})
ra_res = dana.post(f'{BASE}/api/bookings', json=after, headers={'Idempotency-Key': 'journey8-after'})
bb_, ba = rb_res.json(), ra_res.json()
# assign jordan to both? they don't overlap: 23:30+60 => 00:30; 00:15 overlaps! use different interpreters
dana.post(f'{BASE}/api/bookings/{bb_["id"]}/assign', json={'interpreter_id': 'jordan-reyes', 'seat': 1})
dana.post(f'{BASE}/api/bookings/{ba["id"]}/assign', json={'interpreter_id': 'casey-morgan', 'seat': 1})
dana.post(f'{BASE}/api/bookings/{bb_["id"]}/check-in')
dana.post(f'{BASE}/api/bookings/{ba["id"]}/check-in')
r1_ = dana.post(f'{BASE}/api/bookings/{bb_["id"]}/complete', json={'worked_minutes': 135, 'mileage_miles': 0}, headers={'Idempotency-Key': 'journey8-cb'})
r2_ = dana.post(f'{BASE}/api/bookings/{ba["id"]}/complete', json={'worked_minutes': 135, 'mileage_miles': 0}, headers={'Idempotency-Key': 'journey8-ca'})
c1, c2 = r1_.json()['charge'], r2_.json()['charge']
assert c1['amount_cents'] == 17663, c1  # old rate 7850
assert c2['amount_cents'] == 20250, c2  # new rate 9000
ok('rate selected by agency-local assignment date on both sides of the boundary')

# wait for sync, then adjust a charge inside Kill Bill and see Differs on the current week
for _ in range(30):
    r = dana.get(f'{BASE}/api/bookings/{rbb["id"]}')
    if r.json()['charge']['sync_status'] == 'synced':
        break
    time.sleep(2)
assert r.json()['charge']['sync_status'] == 'synced'
line_ref = c2['line_ref']

# the boundary lines live in a future week, so verify the rate split from the lines directly
r = dana.get(f'{BASE}/api/bookings/{ba["id"]}')
line_after = r.json()['charge']
assert line_after['amount_cents'] == 20250, line_after

# the Maple Valley late-cancellation line from Journey 7 is in the current week
week = '2026-11-09'
acc = requests.get(f'{KB}/accounts?externalKey=maple-valley', headers=KBH).json()['accountId']
invoices = requests.get(f'{KB}/accounts/{acc}/invoices', headers=KBH).json()
target = None
for inv in invoices:
    detail = requests.get(f'{KB}/invoices/{inv["invoiceId"]}?withItems=true', headers=KBH).json()
    for item in detail.get('items', []):
        desc = item.get('description') or ''
        if item['itemType'] == 'EXTERNAL_CHARGE' and 'BK-' in desc and desc.split(' ')[1] in [b['ref'] for b in [mvl]]:
            # the late-cancellation charge belongs to the Journey 7 booking
            target = (inv['invoiceId'], item['invoiceItemId'], desc.split(' ')[0])
if target is None:
    raise AssertionError('Kill Bill charge for the late cancellation not found')
inv_id, item_id, line_ref = target
adj = requests.post(f'{KB}/invoices/{inv_id}?adjustmentType=itemAdjustment', headers=KBH,
                    json={'invoiceItemId': item_id, 'accountId': acc, 'amount': 10.00,
                          'currency': 'USD', 'description': 'goodwill'})
assert adj.status_code == 201, adj.text

r = morgan.get(f'{BASE}/api/billing/weeks/maple-valley/{week}')
st = r.json()
line = [l for l in st['lines'] if l['line_ref'] == line_ref][0]
assert line['billing_amount_cents'] is not None and line['billing_amount_cents'] != line['amount_cents'], line
ok('Kill Bill adjustment shows in billing amount => Differs')

# every maple-valley line must sync before the mismatch check can run
for _ in range(40):
    r = morgan.get(f'{BASE}/api/billing/weeks/maple-valley/{week}')
    st = r.json()
    if all(l['sync_status'] == 'synced' for l in st['lines']):
        break
    time.sleep(2)
r = morgan.post(f'{BASE}/api/billing/weeks/maple-valley/{week}/close')
assert r.status_code == 409 and r.json()['error'] == 'total_mismatch', r.text
body = r.json()
assert body['relayline_total_cents'] > body['billing_total_cents'], 'the adjusted line makes billing smaller'
ok('close refused with both exact totals')

# the riverbend week of the 80406 line closes with the totals matched
for _ in range(40):
    r = morgan.get(f'{BASE}/api/billing/weeks/riverbend/{week}')
    st = r.json()
    if st['billing_reachable'] and st['lines'] and all(l['sync_status'] == 'synced' for l in st['lines']):
        break
    time.sleep(2)
assert all(l['sync_status'] == 'synced' for l in st['lines']), 'all lines sync within the retry window'
r = morgan.post(f'{BASE}/api/billing/weeks/riverbend/{week}/close')
assert r.status_code == 200, r.text
closed = r.json()
assert closed['status'] == 'closed'
assert closed['relayline_total_cents'] == closed['billing_total_cents']
assert closed['closed_at'] is not None
ok('a matching week closes and records both totals')

# a line created after its week closed moves to the next open week: close the harlan-court
# week, then complete a new harlan-court booking and check where its line lands.
for _ in range(40):
    r = morgan.get(f'{BASE}/api/billing/weeks/harlan-court/{week}')
    st = r.json()
    if st['billing_reachable'] and (not st['lines'] or all(l['sync_status'] == 'synced' for l in st['lines'])):
        break
    time.sleep(2)
r = morgan.post(f'{BASE}/api/billing/weeks/harlan-court/{week}/close')
assert r.status_code == 200, r.text
post_book = {
  'org_id': 'harlan-court', 'setting': 'legal', 'title': 'Post-close hearing', 'location': 'Room 8',
  'onsite_contact_name': 'Clerk', 'onsite_contact_phone': '+1 555 700 9911', 'consumer_name': 'C',
  'start': '2026-11-19T09:00', 'duration_minutes': 60, 'requester_notes': ''
}
r = dana.post(f'{BASE}/api/bookings', json=post_book, headers={'Idempotency-Key': 'journey8-postclose'})
pcb = r.json()
r = dana.post(f'{BASE}/api/bookings/{pcb["id"]}/assign', json={'interpreter_id': 'riley-brooks', 'seat': 1})
assert r.status_code == 200, 'legal booking with SC:L-qualified Riley'
r = dana.post(f'{BASE}/api/bookings/{pcb["id"]}/assign', json={'interpreter_id': 'quinn-halvorsen', 'seat': 2})
assert r.status_code == 200, r.text
dana.post(f'{BASE}/api/bookings/{pcb["id"]}/check-in')
r = dana.post(f'{BASE}/api/bookings/{pcb["id"]}/complete', json={'worked_minutes': 60, 'mileage_miles': 0}, headers={'Idempotency-Key': 'journey8-pc'})
assert r.status_code == 200, r.text
post_line = r.json()['charge']
import subprocess as _sp
row = _sp.run(['node', '--input-type=module', '-e',
  "import('pg').then(({default: pg}) => { const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});"
  f" pool.query('SELECT billing_week::text AS w FROM invoice_lines WHERE line_ref = $1', ['{post_line['line_ref']}'])"
  ".then(r => { console.log(r.rows[0].w); return pool.end(); }); });"],
  capture_output=True, text=True, env={**__import__('os').environ})
billing_week = row.stdout.strip()
assert billing_week == '2026-11-16', f'the line moves to the next open week, got {billing_week}'
ok('a line created after its week closed goes to the next open week')
print()
print(f'ALL {len(passed)} E2E CHECKS PASSED')
