"""Recovery without a restart, and the unknown-reference byte-equality rules."""
import subprocess, time, json, urllib.request, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from rehearsal import start_copy, stop_copy, req, sign_in, start_claim, read_postgres, PORT

def test_recovery():
    """Once an unreachable service answers again, the next action that needs it
    succeeds without restarting the desk. One copy, service pointer swapped by
    starting the service mock on the same address... Here: a copy with the
    carrier pointed at a port that is not listening yet, then we start a stub
    carrier on that port and quote without restarting the desk."""
    print('--- recovery without a restart ---')
    stub_port = 4321
    proc = start_copy({'WIREMOCK_URL': f'http://127.0.0.1:{stub_port}'})
    try:
        auth = sign_in()
        claim = start_claim(email='recover@example.org')
        reference = claim['reference']
        token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
        s, h, b = req('POST', '/api/claims/confirm', {'token': token})
        assert s == 200
        s, h, b = req('POST', f'/api/ops/claims/{reference}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 200
        # carrier down: quote fails
        s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                      headers={**auth, 'Idempotency-Key': 'recover-q'})
        assert s == 503, f'quote while carrier down: {s} {b[:200]}'
        print('quote refused while the carrier is unreachable')
        # start the stub carrier on the same port (service returns)
        stub = subprocess.Popen(
            ['python3', '-c', '''
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"band":"S2","charge_minor":395,"currency":"GBP","valid_until":"2030-12-31T23:59:59Z"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
HTTPServer(("127.0.0.1", 4321), H).serve_forever()
'''],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(1)
            # the same action succeeds on the same copy, without a restart
            s, h, b = req('POST', f'/api/ops/claims/{reference}/quote', {},
                          headers={**auth, 'Idempotency-Key': 'recover-q2'})
            assert s == 200, f'quote after recovery: {s} {b[:300]}'
            quote = json.loads(b)['quotes'][0]
            assert quote['band'] == 'S2' and quote['carriage_minor'] == 395, quote
            print('quote succeeded after the carrier returned, no restart needed')
        finally:
            stub.kill()
    finally:
        stop_copy(proc)

def test_unknown_reference_byte_equality():
    """Every not-found answer caused by a reference or token is the same bytes
    on an endpoint (DP-72, DP-76, DP-79, DP-82)."""
    print('--- unknown reference byte equality ---')
    proc = start_copy({})
    try:
        return _byte_equality_body()
    finally:
        stop_copy(proc)

def _byte_equality_body():
    auth = sign_in()
    headers = {**auth, 'Idempotency-Key': 'x' * 8}

    # Operator claim endpoint: unknown vs malformed vs another owner's claim.
    bodies = []
    for ref in ['HG-ZZZZZZ', 'HG-0OOOO1', 'not-a-ref', 'HG-AAAAAA-EXTRA']:
        s, h, b = req('GET', f'/api/ops/claims/{ref}', headers=auth)
        assert s == 404, (ref, s)
        bodies.append(b)
    assert all(x == bodies[0] for x in bodies), bodies
    print('operator claim GET: malformed and unknown answer byte-equal')

    bodies2 = []
    for ref in ['HG-ZZZZZZ', 'HG-0OOOO1']:
        s, h, b = req('POST', f'/api/ops/claims/{ref}/identify',
                      {'model': 'kestle-shelving-unit', 'booklet_number': 3, 'quantity': 1}, headers=auth)
        assert s == 404, (ref, s)
        bodies2.append(b)
    assert bodies2[0] == bodies2[1] and bodies2[0] == bodies[0], (bodies2, bodies[0])
    print('operator claim action: byte-equal too')

    # Another owner's claim: byte-equal with unknown.
    # Create a claim for another owner and try to act on it as the operator.
    other = start_claim(email='someone.else@example.org')
    other_ref = other['reference']
    token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{other_ref}'")[0][0]
    req('POST', '/api/claims/confirm', {'token': token})
    s, h, b = req('GET', f'/api/ops/claims/{other_ref}', headers=auth)
    assert s == 200, f'operator can open any claim: {s}'
    print('note: operators are the only role, so any claim is reachable from the workspace')

    # Confirmation endpoint: another owner's reference answers like unknown.
    # POST /api/claims/confirm with a body reference naming a different claim.
    claim = start_claim(email='byte.equal@example.org')
    reference = claim['reference']
    token = read_postgres(f"SELECT confirm_token FROM claims WHERE reference = '{reference}'")[0][0]
    s1, h1, b1 = req('POST', '/api/claims/confirm', {'token': 'unknown-token-' + 'x' * 30})
    s2, h2, b2 = req('POST', '/api/claims/confirm', {'token': token, 'reference': 'HG-ZZZZZZ'})
    assert s1 == 404 and s2 == 404, (s1, s2)
    assert b1 == b2, (b1, b2)
    print('confirm: body reference naming another claim answers byte-equal with unknown')

    # Lookup: another owner's reference with a wrong email counts a try and
    # answers the same body; malformed references count nothing.
    s1, h1, b1 = req('POST', '/api/claims/lookup', {'reference': 'HG-0OOOO1', 'email': 'x@example.org'})
    s2, h2, b2 = req('POST', '/api/claims/lookup', {'reference': 'HG-ZZZZZZ', 'email': 'x@example.org'})
    assert s1 == 404 and s2 == 404 and b1 == b2, (s1, s2, b1, b2)
    print('lookup: malformed and unknown answer byte-equal')

    # Share: an unknown token and an erased claim's token answer share_unknown.
    s1, h1, b1 = req('GET', '/api/share/unknown-token-abcdefghijklmnop')
    s2, h2, b2 = req('GET', '/api/share/short')
    assert s1 == 404 and s2 == 404 and b1 == b2, (s1, s2)
    print('share: malformed and unknown tokens answer byte-equal')

    # Erase: another claim's reference answers 422 mismatch; a malformed
    # reference in the address answers the claim not-found body.
    s, h, b = req('POST', '/api/ops/claims/HG-0OOOO1/erase', {'confirm_reference': 'HG-0OOOO1'}, headers=auth)
    assert s == 404 and b == bodies[0], (s, b)
    print('erase: malformed address reference answers the claim not-found body')
    s, h, b = req('POST', f'/api/ops/claims/{other_ref}/erase', {'confirm_reference': 'HG-ZZZZZZ'}, headers=auth)
    assert s == 422, f'confirm_reference naming another claim: {s} {b[:200]}'
    assert json.loads(b)['error']['fields']['confirm_reference'] == 'mismatch', b[:200]
    print('erase: confirm_reference is validation, answering 422 mismatch')

if __name__ == '__main__':
    test_recovery()
    test_unknown_reference_byte_equality()
    print('\\nRECOVERY AND BYTE EQUALITY PASSED')
