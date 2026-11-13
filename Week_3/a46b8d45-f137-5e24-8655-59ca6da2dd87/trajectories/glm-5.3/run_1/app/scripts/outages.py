"""Outage copies: a service address pointing at nothing.

Each copy boots with one service unreachable; the desk must still serve
health and pages, answer the published status, leave nothing behind, and
recover once the service answers again (tested by pointing back at the real
service without a restart of the main copy).
"""
import subprocess, time, json, urllib.request, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from rehearsal import start_copy, stop_copy, req, sign_in, start_claim, read_postgres, PORT

def wait_notice_free():
    time.sleep(12)

def test_minio_down():
    print('--- MinIO down ---')
    proc = start_copy({'S3_ENDPOINT': 'http://nothing:9000'})
    try:
        # health still answers
        s, h, b = req('GET', '/api/health')
        assert s == 200 and json.loads(b) == {'status': 'ok'}
        print('health OK while MinIO is down')
        # claim start answers 503 storage_unavailable and stores nothing
        claim_body = None
        import uuid
        boundary = '----B' + uuid.uuid4().hex
        def field(name, value):
            return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
        def filepart(name, filename, content):
            return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + b'\r\n'
        png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
        body = b''
        for k, v in [('name', 'Outage Test'), ('email', 'minio.down@example.org'), ('postcode', 'n1 9gu'),
                     ('model', 'kestle-shelving-unit'), ('booklet_number', '3'), ('quantity', '1'),
                     ('purchase_date', '2025-01-01'), ('description', 'x'), ('language', 'en-GB')]:
            body += field(k, v)
        body += filepart('photos', 'p.png', png)
        body += f'--{boundary}--\r\n'.encode()
        s, h, b = req('POST', '/api/claims', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
        assert s == 503, f'claim start with MinIO down: {s} {b[:200]}'
        assert json.loads(b)['error']['code'] == 'storage_unavailable', b[:200]
        print('claim start answered 503 storage_unavailable')
        # nothing was stored
        rows = read_postgres("SELECT count(*) FROM claims WHERE owner_email = 'minio.down@example.org'")
        assert rows[0][0] == 0, rows
        rows = read_postgres("SELECT count(*) FROM notice_queue")
        print('no claim row stored OK')
    finally:
        stop_copy(proc)

def test_carrier_down():
    print('--- carrier down ---')
    proc = start_copy({'WIREMOCK_URL': 'http://nothing:8080'})
    try:
        s, h, b = req('GET', '/api/carriage-estimate?model=kestle-shelving-unit&part=3&quantity=1&postcode=n1%209gu')
        assert s == 503, f'carrier down: {s}'
        assert json.loads(b)['error']['code'] == 'carrier_unavailable', b[:200]
        print('estimate answered 503 carrier_unavailable')
        # a quote on an identified claim answers the operator copy and changes nothing
        auth = sign_in()
        claim = start_claim(email='carrier.down@example.org')
        reference = claim['reference']
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': 'carrier-down-q'})
        assert s == 503, f'quote with carrier down: {s} {b[:200]}'
        assert json.loads(b)['error']['message'] == "The carrier isn't answering. No quote was made.", b[:200]
        print('quote answered 503 with operator copy')
        rows = read_postgres(f"SELECT state FROM claims WHERE reference = '{reference}'")
        assert rows[0][0] == 'identified', rows
        rows = read_postgres(f"SELECT count(*) FROM quote_revisions WHERE reference = '{reference}'")
        assert rows[0][0] == 0, rows
        print('no revision, no state change OK')
    finally:
        stop_copy(proc)

def test_killbill_down():
    print('--- Kill Bill down ---')
    proc = start_copy({'KILLBILL_URL': 'http://nothing:8080'})
    try:
        auth = sign_in()
        claim = start_claim(email='kb.down@example.org')
        reference = claim['reference']
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        # identify works while Kill Bill is down (it never calls billing)
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 200, f'identify while billing down: {s} {b[:200]}'
        print('identify works while Kill Bill is down')
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': 'kb-down-q'})
        assert s == 503, f'quote: {s} {b[:200]}'
        assert json.loads(b)['error']['message'] == "Billing isn't answering. Nothing was charged or changed.", b[:200]
        print('quote answered 503 billing_unavailable')
        rows = read_postgres(f"SELECT state FROM claims WHERE reference = '{reference}'")
        assert rows[0][0] == 'identified', rows
        rows = read_postgres(f"SELECT count(*) FROM quote_revisions WHERE reference = '{reference}'")
        assert rows[0][0] == 0, rows
        # no Kill Bill account was created
        rows = read_postgres(f"SELECT count(*) FROM idempotency_records WHERE reference = '{reference}'")
        assert rows[0][0] == 0, rows
        print('nothing changed, no account OK')
    finally:
        stop_copy(proc)

def test_mailpit_down():
    print('--- Mailpit down ---')
    # A claim created while mail is UP, then quoted while mail is DOWN.
    import psycopg2
    proc = start_copy({})
    try:
        claim = start_claim(email='mail.down2@example.org')
        reference = claim['reference']
    finally:
        stop_copy(proc)
    proc = start_copy({'SMTP_HOST': 'nothing', 'MAILPIT_URL': 'http://nothing:8025'})
    try:
        import uuid
        boundary = '----B' + uuid.uuid4().hex
        def field(name, value):
            return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
        def filepart(name, filename, content):
            return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + b'\r\n'
        png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001')
        body = b''
        for k, v in [('name', 'Mail Down'), ('email', 'mail.down@example.org'), ('postcode', 'n1 9gu'),
                     ('model', 'kestle-shelving-unit'), ('booklet_number', '3'), ('quantity', '1'),
                     ('purchase_date', '2025-01-01'), ('description', 'x'), ('language', 'en-GB')]:
            body += field(k, v)
        body += filepart('photos', 'p.png', png)
        body += f'--{boundary}--\r\n'.encode()
        s, h, b = req('POST', '/api/claims', raw=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
        assert s == 503, f'claim start with mail down: {s} {b[:200]}'
        assert json.loads(b)['error']['code'] == 'mail_unavailable', b[:200]
        rows = read_postgres("SELECT count(*) FROM claims WHERE owner_email = 'mail.down@example.org'")
        assert rows[0][0] == 0, rows
        print('claim start answered 503 mail_unavailable, nothing stored')

        # Quotes still succeed while Mailpit is down; the notice waits in the queue.
        auth = sign_in()
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': 'mail-down-q'})
        assert s == 200, f'quote while mail down: {s} {b[:200]}'
        view = json.loads(b)
        assert view['notices_pending'] >= 1, view
        print('quote succeeded; notices pending:', view['notices_pending'])
    finally:
        stop_copy(proc)

def test_postgres_down():
    print('--- Postgres down ---')
    proc = start_copy({'DATABASE_URL': 'postgresql://gf_app:wrong@nothing:5432/gf_dev'})
    try:
        # health still answers 200
        s, h, b = req('GET', '/api/health')
        assert s == 200 and json.loads(b) == {'status': 'ok'}, (s, b[:100])
        print('health OK while Postgres is down')
        # pages still serve
        s, h, b = req('GET', '/')
        assert s == 200, f'home page: {s}'
        print('pages still serve')
        # an operator endpoint without a session cookie answers 401 (no records needed)
        s, h, b = req('GET', '/api/ops/stats')
        assert s == 401, f'stats without cookie: {s} {b[:200]}'
        print('unauthenticated operator endpoint answers 401 without records')
        # every action needing records answers 503 database_unavailable
        s, h, b = req('POST', '/api/claims/lookup', {'reference': 'HG-AAAAAA', 'email': 'x@example.org'})
        assert s == 503, f'lookup: {s} {b[:200]}'
        assert json.loads(b)['error']['code'] == 'database_unavailable', b[:200]
        s, h, b = req('POST', '/api/claims/confirm', {'token': 'x' * 40})
        assert s == 503, f'confirm: {s} {b[:200]}'
        print('confirm answers 503 database_unavailable')
        s, h, b = req('POST', '/api/ops/session', {'email': 'operator@holmgarth.example', 'password': 'fan-out-2026-desk'})
        assert s == 503, f'sign-in: {s} {b[:200]}'
        assert json.loads(b)['error']['code'] == 'database_unavailable', b[:200]
        print('operator sign-in answers 503 database_unavailable (it needs records)')
    finally:
        stop_copy(proc)

def test_waiting_notices_send_once():
    """Notices queued while mail was down are sent exactly once when mail returns."""
    print('--- waiting notices sent once ---')
    # The queue holds the notice from the mail-down test; the MAIN copy's pump
    # will send it once Mailpit answers again.
    time.sleep(12)
    mp = json.load(urllib.request.urlopen('http://mailpit:8025/api/v1/messages?limit=100'))
    subjects = [m['Subject'] for m in mp['messages'] if 'mail.down2@example.org' in str(m['To'])]
    print('subjects after recovery:', subjects)
    quoted = [s for s in subjects if s.startswith('Quote for claim')]
    assert len(quoted) >= 1, subjects
    # no duplicate subject: each waiting notice went out exactly once
    assert len(quoted) == len(set(quoted)), f'duplicates: {quoted}'
    print('waiting notices sent exactly once each OK')

if __name__ == '__main__':
    test_minio_down()
    test_carrier_down()
    test_killbill_down()
    test_mailpit_down()
    test_postgres_down()
    test_waiting_notices_send_once()
    print('\nOUTAGE COPIES PASSED')
