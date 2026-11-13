#!/usr/bin/env python3
"""Invitations (Mailpit), rate limit, expiry, and logo upload (MinIO)."""
import json
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE = "http://127.0.0.1:4173"
KEY = "gk-overcall-7f3a91c2"

def req(method, path, body=None, headers=None, raw_body=None, content_type=None):
    url = BASE + path
    hdrs = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    elif raw_body is not None:
        data = raw_body
        hdrs["Content-Type"] = content_type or "application/octet-stream"
    if headers:
        hdrs.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
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
        print(f"FAIL {name}\n  got  {g[:300]}\n  want {w[:300]}")

def mailpit(path):
    r = urllib.request.Request(f"http://mailpit:8025{path}")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

# --- seed a match and its organiser ---
tag = uuid.uuid4().hex[:8]
seed = {
    "users": [
        {"key": "olga", "email": f"inv{tag}@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"},
        {"key": "sam", "email": f"sam{tag}@example.test", "display_name": "Sam Kapoor", "password": "long-password-2"},
    ],
    "teams": [
        {"key": "kes", "organiser": "olga", "name": "Kestrels",
         "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "olga", "name": "Herons",
         "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "olga", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True, "innings": [], "summary": None,
        "played_on": "2026-11-04",
    }],
}
status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed", status, 201)
match_id = resp["matches"]["m"]["id"]
organiser_session = resp["users"]["olga"]["session"]
sam_session = resp["users"]["sam"]["session"]
H = {"Cookie": f"oc_session={organiser_session}"}

# --- send an invitation ---
before = mailpit("/api/v1/messages")["total"]
status, resp = req("POST", f"/api/matches/{match_id}/invitations", {"email": f"sam{tag}@example.test"}, H)
check("invitation sent", status, 202)
check("invitation message", resp.get("message"), f"Invitation sent to sam{tag}@example.test.")

after = mailpit("/api/v1/messages")["total"]
check("mailpit message count grew", after, before + 1)
messages = mailpit("/api/v1/messages")["messages"]
latest = [m for m in messages if f"sam{tag}@example.test" in str(m.get("To"))]
check("mailpit has the invitation", len(latest) >= 1, True)
if latest:
    msg = mailpit(f"/api/v1/message/{latest[0]['ID']}")
    body_text = str(msg.get("Text", "")) + str(msg.get("HTML", ""))
    check("mail subject", latest[0]["Subject"], "Score Kestrels v Herons on Overcall")
    check("mail has link", f"/invitations/" in body_text, True)
    check("mail has expiry line", "This invitation works once and expires after 48 hours." in body_text, True)
    check("mail from", latest[0]["From"]["Address"], "scorers@overcall.test")

# extract the token from the mail body
import re
m2 = re.search(r"/invitations/([A-Za-z0-9_-]+)", body_text)
check("token extracted", m2 is not None, True)
token = m2.group(1) if m2 else ""

# --- invitation status ---
status, resp = req("GET", f"/api/invitations/{token}")
check("invitation status open", (status, resp.get("status")), (200, "open"))
check("invitation match title", resp.get("match", {}).get("title"), "Kestrels v Herons")

# --- accept with the wrong (unsigned) session is 401 ---
status, resp = req("POST", f"/api/invitations/{token}/accept")
check("accept needs sign in", status, 401)

# --- accept ---
status, resp = req("POST", f"/api/invitations/{token}/accept", None, {"Cookie": f"oc_session={sam_session}"})
check("invitation accepted", (status, resp.get("match_id")), (200, match_id))

# --- accept again ---
status, resp = req("POST", f"/api/invitations/{token}/accept", None, {"Cookie": f"oc_session={sam_session}"})
check("invitation used", (status, resp.get("error", {}).get("code")), (409, "INVITATION_USED"))
check("invitation used message", resp.get("error", {}).get("message"), "This invitation has already been used.")

# --- sam can now open the match and team ---
status, resp = req("GET", f"/api/matches/{match_id}", None, {"Cookie": f"oc_session={sam_session}"})
check("scorer sees match", status, 200)
status, resp = req("GET", f"/api/teams/{resp['teams']['kes']['id']}" if "teams" in resp else "/api/teams/none",
                   None, {"Cookie": f"oc_session={sam_session}"})
check("scorer sees team", status in (200, 404), True)

# --- expiry via the clock route ---
seed2 = {
    "users": [{"key": "olga", "email": f"exp{tag}@example.test", "display_name": "O", "password": "long-password-1"}],
    "teams": [
        {"key": "kes", "organiser": "olga", "name": "Kestrels",
         "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "olga", "name": "Herons",
         "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "olga", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True, "innings": [], "summary": None,
    }],
    "invitations": [{
        "key": "i1", "match": "m", "email": f"old{tag}@example.test", "sent_at": "2026-11-01T10:00:00+05:30",
    }],
}
status, resp2 = req("POST", "/api/grading/seed", seed2, {"X-Grading-Key": KEY})
check("expiry seed", status, 201)
old_token = resp2["invitations"]["i1"]["token"]
H2 = {"Cookie": f"oc_session={resp2['users']['olga']['session']}"}
# set the server clock past the invitation's age
req("POST", "/api/grading/clock", {"now": "2026-11-05T12:00:00+05:30"}, {"X-Grading-Key": KEY})
status, resp = req("GET", f"/api/invitations/{old_token}")
check("invitation expired", (status, resp.get("status")), (200, "expired"))
status, resp = req("POST", f"/api/invitations/{old_token}/accept", None, H2)
check("accept expired", (status, resp.get("error", {}).get("code")), (409, "INVITATION_EXPIRED"))
req("POST", "/api/grading/clock", {"now": None}, {"X-Grading-Key": KEY})

# --- rate limit ---
seed3 = {
    "users": [{"key": "olga", "email": f"rate{tag}@example.test", "display_name": "O", "password": "long-password-1"}],
    "teams": [
        {"key": "kes", "organiser": "olga", "name": "Kestrels",
         "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "olga", "name": "Herons",
         "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "olga", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True, "innings": [], "summary": None,
    }],
}
status, resp3 = req("POST", "/api/grading/seed", seed3, {"X-Grading-Key": KEY})
match3 = resp3["matches"]["m"]["id"]
H3 = {"Cookie": f"oc_session={resp3['users']['olga']['session']}"}
codes = []
for i in range(21):
    status, resp = req("POST", f"/api/matches/{match3}/invitations", {"email": f"r{tag}{i}@example.test"}, H3)
    codes.append(status)
check("first 20 invitations accepted", codes[:20], [202] * 20)
check("21st invitation rate limited", codes[20], 429)
status, resp = req("POST", f"/api/matches/{match3}/invitations", {"email": f"r{tag}x@example.test"}, H3)
check("rate limit message", resp.get("error", {}).get("message"), "Too many invitations. Try again later.")

# --- logo upload ---
team_id = resp3["teams"]["kes"]["id"]
# A minimal 1x1 PNG
import zlib
import struct

def make_png():
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    idat = zlib.compress(raw)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

png = make_png()
boundary = "----overcalltest"
body = (
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"logo\"; filename=\"logo.png\"\r\n"
    f"Content-Type: image/png\r\n\r\n"
).encode() + png + f"\r\n--{boundary}--\r\n".encode()
status, resp = req("POST", f"/api/teams/{team_id}/logo", None, {**H3, "Content-Type": f"multipart/form-data; boundary={boundary}"}, raw_body=body)
check("logo uploaded", status, 201)
check("logo url", resp.get("logo_url"), f"/api/teams/{team_id}/logo")

r = urllib.request.Request(f"{BASE}/api/teams/{team_id}/logo", headers={"Cookie": H3["Cookie"]})
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        logo_bytes = resp.read()
        check("logo served", resp.status, 200)
        check("logo is a png", logo_bytes[:4] == b"\x89PNG", True)
        check("logo content type", resp.headers.get("Content-Type"), "image/png")
except urllib.error.HTTPError as e:
    check("logo served", e.code, 200)

# wrong type
body = (
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"logo\"; filename=\"logo.txt\"\r\n"
    f"Content-Type: text/plain\r\n\r\n"
).encode() + b"not an image" + f"\r\n--{boundary}--\r\n".encode()
status, resp = req("POST", f"/api/teams/{team_id}/logo", None, {**H3, "Content-Type": f"multipart/form-data; boundary={boundary}"}, raw_body=body)
check("wrong type refused", (status, resp.get("error", {}).get("fields", {}).get("logo")), (422, "Logo must be a PNG or JPEG image."))

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
