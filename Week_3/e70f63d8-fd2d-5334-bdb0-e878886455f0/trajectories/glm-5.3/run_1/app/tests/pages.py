#!/usr/bin/env python3
"""Page and viewer-link checks."""
import json
import re
import sys
import urllib.request
import urllib.error
import uuid

BASE = "http://127.0.0.1:4173"
KEY = "gk-overcall-7f3a91c2"

def fetch(path, headers=None):
    url = BASE + path
    r = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)

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

def check_true(name, value):
    check(name, bool(value), True)

# ---- landing page ----
status, html, _ = fetch("/")
check("landing status", status, 200)
check_true("landing has one main", len(re.findall(r"<main", html)) == 1)
check_true("landing has one h1", len(re.findall(r"<h1", html)) == 1)
check_true("landing has Main nav", 'aria-label="Main"' in html)
check_true("landing has Start scoring", "Start scoring →" in html)
check_true("landing has Follow a match", "Follow a match" in html)
check_true("landing has Tournaments link", "Tournaments" in html)
check_true("landing has Careers link", "Careers" in html)
check_true("landing hero sentence", "Score every ball. Everyone sees it land." in html)
check_true("landing split name OVER", ">OVER<" in html)
check_true("landing split name CALL", ">CALL<" in html)

# ---- sign up / sign in pages ----
for path in ["/signup", "/signin", "/follow"]:
    status, html, _ = fetch(path)
    check(f"{path} status", status, 200)
    check_true(f"{path} has one main", len(re.findall(r"<main", html)) == 1)
    check_true(f"{path} has one h1", len(re.findall(r"<h1", html)) == 1)

status, html, _ = fetch("/signin")
check_true("signin has Email textbox", 'name="email"' in html)
check_true("signin has Password textbox", 'name="password"' in html)
check_true("signin has Sign in button", ">Sign in</button>" in html)

# ---- static assets ----
status, css, _ = fetch("/styles.css")
check("styles.css status", status, 200)
check_true("css has fonts", "DM Sans" in css)
status, js, _ = fetch("/app.js")
check("app.js status", status, 200)
check_true("js has ball tick", "ball-tick" in js)

# ---- 404 page ----
status, html, _ = fetch("/nonexistent-page")
check("unknown page status", status, 404)
check_true("unknown page answers 404 with a single h1", len(re.findall(r"<h1", html)) == 1)

# ---- a full match's pages ----
tag = uuid.uuid4().hex[:8]
seed = {
    "users": [
        {"key": "olga", "email": f"pg{tag}@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"},
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
        "scorers": [], "viewer_link": True,
        "innings": [{"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1"],
                     "deliveries": ["0", "D0", "1", "N4", "B2", "L1", "6", "D1", "2"]}],
        "summary": None,
        "played_on": "2026-11-04",
    }],
}
status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed", status, 201)
match_id = resp["matches"]["m"]["id"]
code = resp["matches"]["m"]["viewer_code"]
H = {"Cookie": f"oc_session={resp['users']['olga']['session']}"}

# ---- signed-in pages ----
for path in ["/matches", "/teams", "/tournaments", "/players", "/matches/new", "/teams/new", "/tournaments/new"]:
    status, html, _ = fetch(path, H)
    check(f"{path} status", status, 200)

status, html, _ = fetch("/matches", H)
check_true("matches lists the match", "Kestrels v Herons" in html)
check_true("matches has New match link", "New match" in html)

status, html, _ = fetch(f"/matches/{match_id}", H)
check("match page status", status, 200)
check_true("match page h1", "<h1>Kestrels v Herons</h1>" in html)
check_true("match page has Viewer link switch", 'id="viewer-link"' in html)
check_true("match page has viewer url", f"/live/{code}" in html)
check_true("match page has invitation form", "Send invitation" in html)
check_true("match page has Score this match", "Score this match" in html)

# ---- scoring page ----
status, html, _ = fetch(f"/matches/{match_id}/score", H)
check("scoring page status", status, 200)
check_true("scoring has scoreboard", 'id="scoreboard"' in html)
check_true("scoring has batters", 'id="batters"' in html)
check_true("scoring has bowler", 'id="bowler"' in html)
check_true("scoring has run rate", 'id="run-rate"' in html)
check_true("scoring has this over", 'id="this-over"' in html)
check_true("scoring has commentary", 'id="commentary"' in html)
check_true("scoring has pad group", 'aria-label="Scoring pad"' in html)
check_true("scoring pad has all keys", all(k in html for k in ["0", "1", "2", "3", "4", "5", "6", "Wide", "No-ball", "Bye", "Leg bye", "Wicket", "Undo"]))
check_true("scoring has Retire batter", "Retire batter" in html)
check_true("scoring has pen notice", 'id="pen-notice"' in html)
check_true("scoring has live status", 'id="live-status"' in html)
check_true("scoring has change buttons", "Change delivery" in html)
check_true("scoring scoreboard shows score", "20/0" in html)
check_true("scoring shows over end line", "End of over 1: 20 runs. Kestrels 20/0" in html)
check_true("scoring has digits", 'class="digit"' in html)
check_true("scoring has this-over chips", "5nb" in html)
check_true("scoring has free hit absent", 'id="free-hit"' not in html or "hidden" in html)

# ---- scorecard page ----
status, html, _ = fetch(f"/matches/{match_id}/scorecard", H)
check("scorecard page status", status, 200)
check_true("scorecard batting table", "<caption>Batting</caption>" in html)
check_true("scorecard bowling table", "<caption>Bowling</caption>" in html)
check_true("scorecard extras line", "Extras 7 (b 2, lb 1, w 3, nb 1)" in html)
check_true("scorecard total line", "Total 20/0 (1 ov)" in html)
check_true("scorecard fow line", "Fall of wickets: none" in html)
check_true("scorecard batting headers", all(h in html for h in ["Batter", "Dismissal", "R", "B", "4s", "6s", "SR"]))
check_true("scorecard bowling headers", all(h in html for h in ["Bowler", "O", "M", "R", "W", "Wd", "Nb", "Econ"]))

# ---- viewer page ----
status, html, _ = fetch(f"/live/{code}")
check("viewer page status", status, 200)
check_true("viewer has scoreboard", 'id="scoreboard"' in html)
check_true("viewer has no pad", 'aria-label="Scoring pad"' not in html)
check_true("viewer has notice", 'id="notice"' in html)
check_true("viewer has live status", 'id="live-status"' in html)
check_true("viewer has Scorecard link", ">Scorecard</a>" in html)
check_true("viewer has polite announcer", 'id="announcer"' in html)
check_true("viewer has alert", 'id="alert"' in html)
check_true("viewer shows score", "20/0" in html)

status, html, _ = fetch(f"/live/{code}/scorecard")
check("viewer scorecard status", status, 200)
check_true("viewer scorecard has batting", "<caption>Batting</caption>" in html)

# ---- turning the viewer link off ----
status, resp2 = req("PATCH", f"/api/matches/{match_id}/viewer-link", {"on": False}, H)
check("link turned off", (status, resp2.get("viewer_link")), (200, False))
status, resp2 = req("GET", f"/api/live/{code}/state")
check("viewer state 404 after off", status, 404)
status, html, _ = fetch(f"/live/{code}")
check("viewer page 404 after off", status, 404)

# turning it back on issues a new code
status, resp2 = req("PATCH", f"/api/matches/{match_id}/viewer-link", {"on": True}, H)
check("link turned on", (status, resp2.get("viewer_link")), (200, True))
new_code = resp2["viewer_code"]
check("new code issued", new_code != code, True)
status, resp2 = req("GET", f"/api/live/{code}/state")
check("old code stays 404", status, 404)
status, resp2 = req("GET", f"/api/live/{new_code}/state")
check("new code works", status, 200)

# viewer code is long enough
check_true("viewer code length", len(new_code) >= 22)

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
