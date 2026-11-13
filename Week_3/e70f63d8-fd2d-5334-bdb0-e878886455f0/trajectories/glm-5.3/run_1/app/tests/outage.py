#!/usr/bin/env python3
"""Outage-instance checks: scoring saves with Valkey down, mail and storage answer 503."""
import json
import os
import socket
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE = "http://127.0.0.1:4199"
KEY = "gk-overcall-7f3a91c2"

def req(method, path, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            payload = resp.read().decode()
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"raw": e.read().decode()[:200]}

failures = 0
def check(name, got, want):
    global failures
    if got == want:
        print(f"ok   {name}")
    else:
        failures += 1
        print(f"FAIL {name}\n  got  {str(got)[:200]}\n  want {str(want)[:200]}")

# health answers even with everything down
status, resp = req("GET", "/api/health")
check("health on the outage instance", (status, resp), (200, {"status": "ok"}))

# services report each one
status, resp = req("GET", "/api/services")
check("services", resp, {"postgres": "up", "valkey": "down", "minio": "down", "mailpit": "down"})

# seed a match, take the pen over a socket, score a delivery: saves with Valkey down
tag = uuid.uuid4().hex[:8]
seed = {
    "users": [{"key": "o", "email": f"out{tag}@example.test", "display_name": "O", "password": "long-password-1"}],
    "teams": [
        {"key": "kes", "organiser": "o", "name": "Kestrels", "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "o", "name": "Herons", "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "o", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True,
        "innings": [{"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1"], "deliveries": []}],
        "summary": None,
    }],
}
status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed on the outage instance", status, 201)
match_id = resp["matches"]["m"]["id"]
session = resp["users"]["o"]["session"]
H = {"Cookie": f"oc_session={session}"}

# take the pen over a socket (Valkey down: the pen falls back to memory)
class WS:
    def __init__(self, cookie, port=4199):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=15)
        self.sock.sendall((f"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: http://127.0.0.1:{port}\r\nCookie: oc_session={cookie}\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(1024)
        self.buffer = b""
        time.sleep(0.3)
    def send(self, obj):
        payload = json.dumps(obj).encode()
        mask = os.urandom(4)
        self.sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + bytes(x ^ mask[i % 4] for i, x in enumerate(payload)))
    def recv(self, timeout=8):
        self.sock.settimeout(timeout)
        def read(n):
            while len(self.buffer) < n:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise EOFError
                self.buffer += chunk
            out, self.buffer = self.buffer[:n], self.buffer[n:]
            return out
        while True:
            head = read(2)
            opcode = head[0] & 0x0F
            length = head[1] & 0x7F
            if length == 126:
                length = int.from_bytes(read(2), "big")
            elif length == 127:
                length = int.from_bytes(read(8), "big")
            payload = read(length)
            if opcode == 0x1:
                return json.loads(payload)
    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

ws = WS(session)
ws.send({"type": "score", "match": match_id})
pen = None
for _ in range(6):
    msg = ws.recv()
    if msg.get("type") == "pen":
        pen = msg["pen"]
        break
check("pen granted with Valkey down (memory fallback)", pen is not None, True)

status, state = req("POST", f"/api/matches/{match_id}/deliveries",
                   {"expected_seq": 1, "extra": "none", "runs": 4, "wicket": None},
                   {"Cookie": f"oc_session={session}", "X-Pen": pen})
check("delivery saves with Valkey down", status, 201)
check("the delivery's runs", state.get("runs"), 4)
ws.close()

# the state is still readable
status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
check("state readable with Valkey down", (status, state.get("scoreboard")), (200, "Kestrels 4/0 (0.1 ov)"))

# an invitation answers 503 with the mail outage copy
status, resp2 = req("POST", f"/api/matches/{match_id}/invitations", {"email": f"x{tag}@example.test"}, H)
check("invitation mail outage", (status, resp2.get("error", {}).get("code"), resp2.get("error", {}).get("message")),
      (503, "MAIL_UNAVAILABLE", "The invitation could not be sent. Try again later."))
# no invitation was stored
status, resp2 = req("POST", "/api/grading/seed", {"users": [], "teams": []}, {"X-Grading-Key": KEY})
check("no-op seed fine", status, 201)

# a logo upload answers 503 with the storage outage copy
import zlib
import struct
def make_png():
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")

team_id = resp["teams"]["kes"]["id"]
boundary = "----overcalltest"
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"logo\"; filename=\"logo.png\"\r\nContent-Type: image/png\r\n\r\n").encode() + make_png() + f"\r\n--{boundary}--\r\n".encode()
r = urllib.request.Request(f"{BASE}/api/teams/{team_id}/logo", data=body, method="POST",
                           headers={**H, "Content-Type": f"multipart/form-data; boundary={boundary}"})
try:
    with urllib.request.urlopen(r, timeout=60) as resp3:
        check("logo upload with storage down", resp3.status, 503)
except urllib.error.HTTPError as e:
    payload = json.loads(e.read().decode())
    check("logo storage outage", (e.code, payload.get("error", {}).get("code"), payload.get("error", {}).get("message")),
          (503, "STORAGE_UNAVAILABLE", "Logo storage is unavailable. The team keeps its previous logo."))
    status, team = req("GET", f"/api/teams/{team_id}", headers=H)
    check("the team keeps no logo", team.get("logo_url"), None)

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
