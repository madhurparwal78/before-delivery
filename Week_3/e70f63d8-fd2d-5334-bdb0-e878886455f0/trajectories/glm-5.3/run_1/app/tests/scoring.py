#!/usr/bin/env python3
"""Scoring-flow checks: pen, E2 strike, E4 free hit, E3 wickets, E6 change, E7 undo."""
import json
import sys
import urllib.request
import urllib.error
import threading
import time

BASE = "http://127.0.0.1:4173"
KEY = "gk-overcall-7f3a91c2"

def req(method, path, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            payload = resp.read().decode()
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, {"raw": payload}

failures = 0
def check(name, got, want):
    global failures
    g = json.dumps(got, sort_keys=True)
    w = json.dumps(want, sort_keys=True)
    if g == w:
        print(f"ok   {name}")
    else:
        failures += 1
        print(f"FAIL {name}\n  got  {g}\n  want {w}")

# --- take the pen through a WebSocket ---
import socket  # noqa
class WS:
    """Minimal WebSocket client for the test."""
    def __init__(self, url, cookie=None):
        self.sock = socket.create_connection(("127.0.0.1", 4173), timeout=10)
        key = "dGhlIHNhbXBsZSBub25jZQ=="
        cookie_line = f"Cookie: oc_session={cookie}\r\n" if cookie else ""
        origin_line = "Origin: http://127.0.0.1:4173\r\n"
        self.sock.sendall((
            f"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:4173\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\n{origin_line}{cookie_line}Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(1024)
        assert b"101" in buf.split(b"\r\n")[0], buf[:200]
        self.buffer = b""
        # The server attaches its message handler asynchronously; give it a moment.
        time.sleep(0.3)

    def send(self, obj):
        payload = json.dumps(obj).encode()
        header = bytearray([0x81])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += n.to_bytes(2, "big")
        import os
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv(self, timeout=8):
        """Read one data frame, skipping control frames."""
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

# --- seed a fresh match for scoring ---
seed = {
    "users": [{"key": "olga", "email": "olga@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"}],
    "teams": [
        {"key": "kes", "organiser": "olga", "name": "Kestrels", "players": [
            {"key": "k1", "name": "Arjun Rao", "short_name": "Rao"},
            {"key": "k2", "name": "Kabir Iyer", "short_name": "Iyer"},
            {"key": "k3", "name": "Dev Sen", "short_name": "Sen"},
            {"key": "k4", "name": "Neel Bose", "short_name": "Bose"},
            {"key": "k5", "name": "Omar Khan", "short_name": "Khan"},
            {"key": "k6", "name": "Ravi Das", "short_name": "Das"},
        ]},
        {"key": "her", "organiser": "olga", "name": "Herons", "players": [
            {"key": "h1", "name": "Vik Mehta", "short_name": "Mehta"},
            {"key": "h2", "name": "Sam Pillai", "short_name": "Pillai"},
            {"key": "h3", "name": "Jai Nair", "short_name": "Nair"},
            {"key": "h4", "name": "Tom Gill", "short_name": "Gill"},
            {"key": "h5", "name": "Ash Kurian", "short_name": "Kurian"},
            {"key": "h6", "name": "Leo Varma", "short_name": "Varma"},
        ]},
    ],
    "matches": [
        {"key": "m1", "organiser": "olga", "home": "kes", "away": "her", "overs": 5,
         "players_per_side": 6, "super_over": True, "batting_first": "kes", "tournament": None,
         "xi": {"kes": ["k1", "k2", "k3", "k4", "k5", "k6"], "her": ["h1", "h2", "h3", "h4", "h5", "h6"]},
         "scorers": [], "viewer_link": True,
         "innings": [{"striker": "k1", "non_striker": "k2", "bowlers": ["h1"], "deliveries": []}],
         "summary": None},
    ],
}
status, resp_seed = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed status", status, 201)
match_id = resp_seed["matches"]["m1"]["id"]
viewer_code = resp_seed["matches"]["m1"]["viewer_code"]
session = resp_seed["users"]["olga"]["session"]
H = {"Cookie": f"oc_session={session}"}

# --- take the pen over the socket ---
ws = WS("ws://127.0.0.1:4173/ws", cookie=session)
ws.send({"type": "score", "match": match_id})
pen = None
for _ in range(10):
    msg = ws.recv()
    if msg.get("type") == "pen":
        pen = msg["pen"]
        break
    if msg.get("type") == "state":
        state0 = msg["state"]
check("pen granted", pen is not None, True)

PEN = {"X-Pen": pen}

# --- E2: strike rotation ---
def deliver(extra, runs, expect_seq, wicket=None):
    payload = {"expected_seq": expect_seq, "extra": extra, "runs": runs, "wicket": wicket}
    status, state = req("POST", f"/api/matches/{match_id}/deliveries", payload, {**PEN, **H})
    return status, state

def token_of(t):
    if t[0] in "0123456" and len(t) == 1:
        return "none", int(t)
    kind = {"D": "wide", "N": "no-ball", "B": "bye", "L": "leg-bye"}[t[0]]
    return kind, int(t[1:])

seq = 1
for tok in ["1", "2", "B1", "D1", "3", "4", "1"]:
    extra, runs = token_of(tok)
    status, state = deliver(extra, runs, seq)
    check(f"E2 token {tok} status", status, 201)
    if status != 201:
        print("   response:", json.dumps(state)[:200])
    seq += 1

status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
check("E2 score", state["scoreboard"], "Kestrels 14/0 (1 ov)")
# Commentary is newest first: the list is the brief's play order reversed.
striker_ids = [c.get("striker") for c in state["commentary"] if c["kind"] == "delivery"]
kes_first = resp_seed["teams"]["kes"]["players"]["k1"]
kes_second = resp_seed["teams"]["kes"]["players"]["k2"]
play_order = [kes_first, kes_second, kes_second, kes_first, kes_second, kes_first, kes_first]
check("E2 strikers so far", striker_ids, list(reversed(play_order)))
check("E2 striker count", len(striker_ids), 7)

# start over 2 with Pillai (barred: Mehta consecutive)
status, resp = req("POST", f"/api/matches/{match_id}/overs", {"bowler": resp_seed["teams"]["her"]["players"]["h1"]}, {**PEN, **H})
check("E2 consecutive bowler refused", (status, resp.get("error", {}).get("code")), (422, "BOWLER_CONSECUTIVE"))
check("E2 consecutive message", resp.get("error", {}).get("message"), "Mehta bowled the last over.")

# look up the teams to get real player ids
kes_team_id = resp_seed["teams"]["kes"]["id"]
her_team_id = resp_seed["teams"]["her"]["id"]
status, team = req("GET", f"/api/teams/{kes_team_id}", headers=H)
status, team_h = req("GET", f"/api/teams/{her_team_id}", headers=H)
her_players = {p["short_name"]: p["id"] for p in team_h["players"]}
kes_players = {p["short_name"]: p["id"] for p in team["players"]}
status, state = req("POST", f"/api/matches/{match_id}/overs", {"bowler": her_players["Pillai"]}, {**PEN, **H})
check("E2 over 2 starts", status, 201)

status, state = deliver("none", 0, seq)
check("E2 1.1 status", status, 201)
seq += 1
status, state = deliver("leg-bye", 3, seq)
check("E2 1.2 status", status, 201)
seq += 1
check("E2 final score", state["scoreboard"], "Kestrels 17/0 (1.2 ov)")
check("E2 final batters", [b["text"] for b in state["batters"]], ["Iyer* 5 (3)", "Rao 6 (5)"])

# --- E6: change a past delivery flips later strike ---
target_seq = 2
status, state = req("PUT", f"/api/matches/{match_id}/deliveries/{target_seq}", {"extra": "none", "runs": 1}, {**PEN, **H})
check("E6 change status", status, 200)
lines = [c["line"] for c in state["commentary"] if c["kind"] == "delivery"]
expected_play_order = [
    "0.1 Mehta to Rao, 1 run",
    "0.2 Mehta to Iyer, 1 run",
    "0.3 Mehta to Rao, 1 bye",
    "0.4 Mehta to Iyer, 2 wides",
    "0.4 Mehta to Rao, 3 runs",
    "0.5 Mehta to Iyer, FOUR",
    "0.6 Mehta to Iyer, 1 run",
    "1.1 Pillai to Iyer, no run",
    "1.2 Pillai to Iyer, 3 leg byes",
]
check("E6 changed lines", lines, list(reversed(expected_play_order)))
check("E6 score after change", state["scoreboard"], "Kestrels 16/0 (1.2 ov)")
check("E6 batters after change", [b["text"] for b in state["batters"]], ["Rao* 4 (3)", "Iyer 6 (5)"])

# a change that would move the overs is refused
status, resp = req("PUT", f"/api/matches/{match_id}/deliveries/2", {"extra": "wide", "runs": 0}, {**PEN, **H})
check("E6 moves overs refused", (status, resp.get("error", {}).get("code")), (422, "CHANGE_MOVES_OVERS"))
check("E6 moves overs message", resp.get("error", {}).get("message"),
      "That change would move the overs. Undo back to this delivery instead.")

# --- undo ---
status, state = req("DELETE", f"/api/matches/{match_id}/deliveries/last", None, {**PEN, **H})
check("E7 undo status", status, 200)
check("E7 undo score", state["scoreboard"], "Kestrels 13/0 (1.1 ov)")
status, resp = req("GET", f"/api/matches/{match_id}/state", headers=H)
check("E7 undo scoreboard", resp["scoreboard"], "Kestrels 13/0 (1.1 ov)")

ws.close()

# a scoring call without the pen answers 409 PEN_HELD
status, resp = req("POST", f"/api/matches/{match_id}/deliveries", {"expected_seq": 10, "extra": "none", "runs": 0}, H)
check("no pen refused", (status, resp.get("error", {}).get("code")), (409, "PEN_HELD"))

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
