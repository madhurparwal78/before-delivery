# Outage scenario checks: mail, Kill Bill and storage outages, with recovery.
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
    print(('PASS ' if ok else 'FAIL ') + name + ((' :: ' + str(detail)[:400]) if detail and not ok else ''))

def mailpit_messages():
    with urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=100') as r:
        return json.loads(r.read().decode())['messages']

def start_server(extra_env=None, port='4173'):
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    proc = subprocess.Popen(['node', 'dist/server.js'], env=env, cwd='/app',
                            stdout=open('/tmp/server-outage.log', 'ab'),
                            stderr=subprocess.STDOUT)
    for _ in range(40):
        try:
            with urllib.request.urlopen(f'http://localhost:{port}/api/health', timeout=1) as res:
                if json.loads(res.read().decode())['status'] == 'ok':
                    return proc
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError('server did not come up')

def stop_server(proc):
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    # Port can take a moment to free.
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://localhost:4173/api/health', timeout=0.5):
                pass
        except Exception:
            return
        time.sleep(0.3)

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
            self.cookies['sw_session'] = header.split(';')[0].split('=', 1)[1]

    def open(self, req):
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in self.cookies.items()))
        return urllib.request.urlopen(req)

    def request(self, method, path, body=None, headers=None):
        data = None
        hdrs = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
            hdrs.setdefault('Content-Type', 'application/json')
        req = urllib.request.Request(f'{BASE}/api{path}', data=data, headers=hdrs, method=method)
        try:
            res = self.open(req)
            text = res.read().decode()
            return res.status, (json.loads(text) if text else {})
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return e.code, json.loads(text)
            except json.JSONDecodeError:
                return e.code, text

def reset():
    subprocess.run(['sh', '/app/tests/reset.sh'], capture_output=True)
    kill_all_servers()

def kill_all_servers():
    for attempt in range(10):
        alive = False
        for p in '/proc/[0-9]*/cmdline'.split() if False else __import__('glob').glob('/proc/[0-9]*/cmdline'):
            try:
                with open(p, 'rb') as f:
                    if b'dist/server.js' in f.read():
                        alive = True
                        pid = int(p.split('/')[2])
                        if attempt == 0:
                            __import__('os').kill(pid, 15)
                        else:
                            __import__('os').kill(pid, 9)
            except (OSError, ValueError, ProcessLookupError):
                pass
        if not alive:
            return
        time.sleep(1)

def run():
    kill_all_servers()
    # ---------- Kill Bill outage ----------
    reset()
    proc = start_server({'KILLBILL_URL': 'http://127.0.0.1:59999'})
    try:
        rowan = Client('rowan@fernhollow.test')
        marguerite = Client('marguerite@fernhollow.test')
        anita = Client('anita@kestrelcourt.test')
        joel = Client('joel@birchmere.test')

        st, body = rowan.request('GET', '/system/status')
        check('billing outage is visible in system status', body['killbill'] == 'down', body)

        # Dispatch, offers and timesheet submission keep working.
        st, board = rowan.request('GET', '/board')
        check('board loads during billing outage', st == 200)
        fa1001 = [r for r in board['requests'] if r['ref'] == 'FA-1001'][0]
        st, body = rowan.request('POST', f"/seats/{fa1001['seats'][0]['id']}/offers", {'interpreter_id': 'i_imani'})
        check('pins keep working during billing outage', st == 201, (st, body))
        token = subprocess.check_output(['node', '-e', '''
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT o.token FROM offers o JOIN seats s ON s.id = o.seat_id JOIN requests r ON r.id = s.request_id WHERE r.ref = 'FA-1001' AND o.status = 'active'");
  console.log(res.rows[0].token);
  await pool.end();
})();
'''], cwd='/app').decode().strip()
        st, body = Client().request('POST', f'/offers/{token}/accept', {})
        check('accepts keep working during billing outage', st == 200, (st, body))

        # Invoice reads fail with billing_unavailable and change nothing.
        st, body = joel.request('GET', '/orgs/birchmere-clinic/invoices')
        check('invoice reads fail with billing_unavailable', st == 503 and body['error']['code'] == 'billing_unavailable', (st, body))

        # Approval fails with billing_unavailable and nothing changes.
        tsid = subprocess.check_output(['node', '-e', '''
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT t.id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE r.ref = 'FA-1005'");
  console.log(res.rows[0].id);
  await pool.end();
})();
'''], cwd='/app').decode().strip()
        st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, {'Idempotency-Key': 'approve-outage'})
        check('approval fails with billing_unavailable', st == 503 and body['error']['code'] == 'billing_unavailable', (st, body))
        st, body = marguerite.request('GET', '/timesheets?status=submitted')
        still_queued = any(t['id'] == tsid for t in body['timesheets'])
        check('timesheet stays submitted after failed approval', still_queued, body)

        # A late cancellation with nobody seated keeps working.
        fa1002 = [r for r in rowan.request('GET', '/board')[1]['requests'] if r['ref'] == 'FA-1002'][0]
        st, quote = anita.request('GET', f"/requests/{fa1002['id']}/cancellation-quote")
        st, body = anita.request('POST', f"/requests/{fa1002['id']}/cancel",
                                {'expected_fee': quote['quote']['fee'], 'reason': ''},
                                {'Idempotency-Key': 'cancel-outage'})
        check('late cancel with nobody seated works during outage',
              st == 200 and body['request']['status'] == 'cancelled_late', (st, body))

        # A late cancellation with a fee fails with billing_unavailable and changes nothing.
        # FA-1001 is now staffed by Imani (accepted above) and late (T+26 < 48h).
        fa1001b = [r for r in joel.request('GET', '/requests')[1]['requests'] if r['ref'] == 'FA-1001'][0]
        st, quote = joel.request('GET', f"/requests/{fa1001b['id']}/cancellation-quote")
        check('staffed FA-1001 quote is late with fee 160.00',
              quote['quote']['late'] and quote['quote']['fee'] == '160.00', quote)
        st, body = joel.request('POST', f"/requests/{fa1001b['id']}/cancel",
                                {'expected_fee': quote['quote']['fee'], 'reason': ''},
                                {'Idempotency-Key': 'cancel-fee-outage'})
        check('charged cancel fails with billing_unavailable', st == 503 and body['error']['code'] == 'billing_unavailable', (st, body))
        st, body = joel.request('GET', f"/requests/{fa1001b['id']}")
        check('request unchanged after failed charged cancel', body['request']['status'] == 'staffed', body['request']['status'])
        st, body = rowan.request('GET', '/audit?request_id=' + fa1001b['id'])
        actions = [e['action'] for e in body['entries']]
        check('no audit entries from failed cancels', 'request.cancelled' not in actions, actions)
    finally:
        stop_server(proc)

    # ---------- Kill Bill returns: approve the timesheet ----------
    proc = start_server()
    try:
        marguerite = Client('marguerite@fernhollow.test')
        joel = Client('joel@birchmere.test')
        tsid = subprocess.check_output(['node', '-e', '''
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT t.id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE r.ref = 'FA-1005'");
  console.log(res.rows[0].id);
  await pool.end();
})();
'''], cwd='/app').decode().strip()
        # The key from the failed attempt stays free; retry runs afresh.
        st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, {'Idempotency-Key': 'approve-outage'})
        check('approval succeeds once billing returns', st == 200 and body['timesheet']['amount'] == '160.00', (st, body))
    finally:
        stop_server(proc)

    # ---------- Reconciliation: adopt an uncertain charge ----------
    reset()
    proc = start_server()
    try:
        rowan = Client('rowan@fernhollow.test')
        marguerite = Client('marguerite@fernhollow.test')
        # Sam accepts his seeded FA-1005 seat is already accepted; the seeded
        # timesheet is submitted. Simulate an earlier uncertain attempt by
        # posting the charge directly to Kill Bill with the charge key.
        tsid = subprocess.check_output(['node', '-e', '''
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT t.id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE r.ref = 'FA-1005'");
  console.log(res.rows[0].id);
  await pool.end();
})();
'''], cwd='/app').decode().strip()
        acc = json.loads(urllib.request.urlopen(urllib.request.Request(
            'http://killbill:8080/1.0/kb/accounts?externalKey=fernhollow-birchmere-clinic',
            headers=kb_headers())).read())['accountId']
        # A timed-out attempt may have left this charge behind (uncertain outcome).
        data = json.dumps([{'amount': 150.00, 'currency': 'USD', 'description': f'[ts-{tsid}] FA-1005 interpreting: Sam Whitlock, 2.00 h at $75.00/h'}]).encode()
        req = urllib.request.Request(f'http://killbill:8080/1.0/kb/invoices/charges/{acc}?autoCommit=true',
                                     data=data, headers=kb_headers(), method='POST')
        urllib.request.urlopen(req)
        # Now approve: the app adopts the existing item, with its rate and amount.
        st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, {'Idempotency-Key': 'approve-reconcile'})
        check('approval adopts the uncertain charge as frozen amount', st == 200 and body['timesheet']['amount'] == '150.00'
              and body['timesheet']['hourly_rate'] == '75.00', (st, body))
        st, body = marguerite.request('GET', '/orgs/birchmere-clinic/invoices')
        items = [i for inv in body['invoices'] for i in inv['items'] if f'[ts-{tsid}]' in i['description']]
        check('exactly one item for the charge key after adoption', len(items) == 1 and items[0]['amount'] == '150.00', body)
    finally:
        stop_server(proc)

    # ---------- Mail outage ----------
    reset()
    proc = start_server({'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': '59998', 'MAILPIT_URL': 'http://127.0.0.1:59998'})
    try:
        rowan = Client('rowan@fernhollow.test')
        st, body = rowan.request('GET', '/system/status')
        check('mail outage is visible in system status', body['mail'] == 'down', body)
        st, board = rowan.request('GET', '/board')
        fa1001 = [r for r in board['requests'] if r['ref'] == 'FA-1001'][0]
        before = len(mailpit_messages())
        st, body = rowan.request('POST', f"/seats/{fa1001['seats'][0]['id']}/offers", {'interpreter_id': 'i_imani'})
        check('pin succeeds during mail outage', st == 201, (st, body))
        time.sleep(12)
        check('no email delivered during mail outage', len(mailpit_messages()) == before)
        st, body = rowan.request('GET', '/board')
        fa1001v = [r for r in body['requests'] if r['ref'] == 'FA-1001'][0]
        check('offer email field reads queued during outage', fa1001v['seats'][0]['offer']['email'] == 'queued', fa1001v['seats'][0])
    finally:
        stop_server(proc)

    # ---------- Mail returns: queued email delivered exactly once ----------
    proc = start_server()
    try:
        # The outbox sweep delivers the queued message within ~15 seconds.
        deadline = time.time() + 30
        delivered = []
        while time.time() < deadline:
            msgs = [m for m in mailpit_messages() if m['Subject'].startswith('Offer for FA-1001')]
            if msgs:
                delivered = msgs
                break
            time.sleep(2)
        check('queued email delivered after mail returns', len(delivered) == 1, delivered)
        mids = {m['MessageID'] for m in delivered}
        time.sleep(20)
        msgs = [m for m in mailpit_messages() if m['Subject'].startswith('Offer for FA-1001')]
        check('each queued email delivered exactly once', len(msgs) == 1 and {m['MessageID'] for m in msgs} == mids, msgs)
        rowan = Client('rowan@fernhollow.test')
        st, body = rowan.request('GET', '/board')
        fa1001v = [r for r in body['requests'] if r['ref'] == 'FA-1001'][0]
        check('offer email field reads sent after delivery', fa1001v['seats'][0]['offer']['email'] == 'sent', fa1001v['seats'][0])
    finally:
        stop_server(proc)

    # ---------- Storage outage ----------
    reset()
    proc = start_server({'S3_ENDPOINT': 'http://127.0.0.1:59997'})
    try:
        rowan = Client('rowan@fernhollow.test')
        marguerite = Client('marguerite@fernhollow.test')
        joel = Client('joel@birchmere.test')
        st, body = rowan.request('GET', '/system/status')
        check('storage outage is visible in system status', body['storage'] == 'down', body)
        # Prep upload fails with storage_unavailable.
        fa1001 = [r for r in joel.request('GET', '/requests')[1]['requests'] if r['ref'] == 'FA-1001'][0]
        boundary = '----probe'
        pdf = b'%PDF-1.4\n% probe\n'
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.pdf"\r\n'
                   f'Content-Type: application/pdf\r\n\r\n').encode() + pdf + f'\r\n--{boundary}--\r\n'.encode()
        req = urllib.request.Request(f"{BASE}/api/requests/{fa1001['id']}/prep", data=payload,
                                     headers={'Content-Type': f'multipart/form-data; boundary={boundary}',
                                              'Cookie': 'sw_session=' + joel.cookies['sw_session']}, method='POST')
        try:
            res = urllib.request.urlopen(req)
            st, body = res.status, {}
        except urllib.error.HTTPError as e:
            st, body = e.code, json.loads(e.read().decode())
        check('prep upload fails with storage_unavailable', st == 503 and body['error']['code'] == 'storage_unavailable', (st, body))
        # Approval fails with storage_unavailable.
        tsid = subprocess.check_output(['node', '-e', '''
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT t.id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE r.ref = 'FA-1005'");
  console.log(res.rows[0].id);
  await pool.end();
})();
'''], cwd='/app').decode().strip()
        st, body = marguerite.request('POST', f'/timesheets/{tsid}/approve', {}, {'Idempotency-Key': 'approve-storage-outage'})
        check('approval fails with storage_unavailable', st == 503 and body['error']['code'] == 'storage_unavailable', (st, body))
    finally:
        stop_server(proc)

    print()
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)}/{len(results)} checks passed')
    if fails:
        sys.exit(1)

def kb_headers():
    import base64
    auth = base64.b64encode(f"{os.environ['KILLBILL_USERNAME']}:{os.environ['KILLBILL_PASSWORD']}".encode()).decode()
    return {
        'Authorization': f'Basic {auth}',
        'X-Killbill-ApiKey': os.environ['KILLBILL_API_KEY'],
        'X-Killbill-ApiSecret': os.environ['KILLBILL_API_SECRET'],
        'X-Killbill-CreatedBy': 'probe',
        'Content-Type': 'application/json',
    }

if __name__ == '__main__':
    run()
