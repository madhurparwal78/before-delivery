#!/usr/bin/env python3
"""End-to-end check of the Overcall API against the brief's worked examples."""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"
KEY = "gk-overcall-7f3a91c2"

def req(method, path, body=None, headers=None, raw=False):
    url = BASE + path
    data = None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    if body is not None and not raw:
        data = json.dumps(body).encode()
    elif body is not None:
        data = body
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

# ---- seed the E1 match ----
seed = {
    "users": [
        {"key": "olga", "email": "olga@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"},
        {"key": "mira", "email": "mira@example.test", "display_name": "Mira Joshi", "password": "long-password-2"},
    ],
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
         "players_per_side": 6, "super_over": False, "batting_first": "kes", "tournament": None,
         "xi": {"kes": ["k1", "k2", "k3", "k4", "k5", "k6"], "her": ["h1", "h2", "h3", "h4", "h5", "h6"]},
         "scorers": ["mira"], "viewer_link": True,
         "innings": [{"striker": "k1", "non_striker": "k2", "bowlers": ["h1"],
                      "deliveries": ["0", "D0", "1", "N4", "B2", "L1", "6", "D1", "2"]}],
         "summary": None},
    ],
}

status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed status", status, 201)
if status != 201:
    print(json.dumps(resp, indent=2))
    sys.exit(1)

match_id = resp["matches"]["m1"]["id"]
viewer_code = resp["matches"]["m1"]["viewer_code"]
session = resp["users"]["olga"]["session"]
print(f"match {match_id} viewer {viewer_code}")

# grading without key -> 404
status, resp = req("POST", "/api/grading/seed", seed)
check("grading without key", status, 404)

# ---- state via organiser session ----
status, state = req("GET", f"/api/matches/{match_id}/state", headers={"Cookie": f"oc_session={session}"})
check("state status", status, 200)
check("E1 scoreboard", state.get("scoreboard"), "Kestrels 20/0 (1 ov)")
check("E1 runs", state.get("runs"), 20)
check("E1 overs text", state.get("overs_text"), "1")
check("E1 legal balls", state.get("legal_balls"), 6)
check("E1 status", state.get("match", {}).get("status"), "innings_1")
check("E1 batters", [b["text"] for b in state.get("batters", [])], ["Rao* 7 (3)", "Iyer 6 (4)"])
check("E1 bowler", state.get("bowler", {}).get("text"), "Mehta 1-0-17-0")
check("E1 run rate", state.get("run_rate"), "Run rate 20.00")
check("E1 innings break absent", state.get("innings_break"), None)
check("E1 this over", state.get("this_over"), ["0", "1wd", "1", "5nb", "2b", "1lb", "6", "2wd", "2"])
check("E1 next bowler needed", state.get("next_bowler_needed"), True)
lines = [c["line"] for c in state.get("commentary", [])]
check("E1 commentary order", lines[:3], [
    "End of over 1: 20 runs. Kestrels 20/0",
    "0.6 Mehta to Iyer, 2 runs",
    "0.6 Mehta to Rao, 2 wides",
])
check("E1 free hit gone", state.get("free_hit"), False)
announced = [c for c in state.get("commentary", []) if c["kind"] == "delivery"][0]
check("E1 newest delivery line", announced["line"], "0.6 Mehta to Iyer, 2 runs")

# ---- scorecard ----
status, card = req("GET", f"/api/matches/{match_id}/scorecard", headers={"Cookie": f"oc_session={session}"})
check("scorecard status", status, 200)
inn = card["innings"][0]
check("scorecard heading", inn["heading"], "Kestrels innings")
check("E1 extras", inn["extras"]["text"], "Extras 7 (b 2, lb 1, w 3, nb 1)")
check("E1 total", inn["total_text"], "Total 20/0 (1 ov)")
check("E1 fow", inn["fall_of_wickets"], "Fall of wickets: none")
check("E1 did not bat", inn["did_not_bat"], ["Sen", "Bose", "Khan", "Das"])
check("E1 batting rows", [[b["name"], b["dismissal"], b["runs"], b["balls"], b["fours"], b["sixes"], b["strike_rate"]] for b in inn["batting"]],
      [["Arjun Rao", "not out", 7, 3, 0, 1, "233.33"], ["Kabir Iyer", "not out", 6, 4, 1, 0, "150.00"]])
check("E1 bowling rows", [[b["name"], b["overs"], b["maidens"], b["runs"], b["wickets"], b["wides"], b["no_balls"], b["economy"]] for b in inn["bowling"]],
      [["Vik Mehta", "1", 0, 17, 0, 2, 1, "17.00"]])

# ---- viewer endpoints ----
status, vstate = req("GET", f"/api/live/{viewer_code}/state")
check("viewer state status", status, 200)
check("viewer state scoreboard", vstate.get("scoreboard"), "Kestrels 20/0 (1 ov)")
check("viewer state has no email", "email" in json.dumps(vstate), False)
check("viewer state has no scorers", "scorers" in json.dumps(vstate), False)
status, vcard = req("GET", f"/api/live/{viewer_code}/scorecard")
check("viewer scorecard status", status, 200)

status, me = req("GET", "/api/me", headers={"Cookie": f"oc_session={session}"})
check("me", me["user"]["email"], "olga@example.test")

# privacy: another organiser's records answer 404
import time as _time
other_email = f"other{int(_time.time())}@example.test"
status, resp = req("POST", "/api/auth/signup", {"email": other_email, "password": "long-password-3", "display_name": "Other"})
check("signup status", status, 201)
other_session = resp.get("session")
status, resp = req("GET", f"/api/matches/{match_id}", headers={"Cookie": f"oc_session={other_session or 'unknown'}"})
check("other user sees 404", status, 404)
status, resp = req("GET", f"/api/matches/{match_id}/state", headers={"Cookie": "oc_session=unknown-token"})
check("unknown session sees 401", status, 401)

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
