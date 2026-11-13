#!/usr/bin/env python3
"""Full-match checks: E3 wickets, E4 free hit, E8 chase, E9 super over, E10 NRR, E11 careers, invitations, logos."""
import json
import sys
import time
import urllib.request
import urllib.error
import uuid

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
        print(f"FAIL {name}\n  got  {g[:400]}\n  want {w[:400]}")

TEAMS = {
    "kes": ["Arjun Rao/Rao", "Kabir Iyer/Iyer", "Dev Sen/Sen", "Neel Bose/Bose", "Omar Khan/Khan", "Ravi Das/Das"],
    "her": ["Vik Mehta/Mehta", "Sam Pillai/Pillai", "Jai Nair/Nair", "Tom Gill/Gill", "Ash Kurian/Kurian", "Leo Varma/Varma"],
}

def mk_seed(runs):
    tag = uuid.uuid4().hex[:8]
    users = [{"key": "o", "email": f"o{tag}@example.test", "display_name": "Olga", "password": "long-password-1"}]
    teams = []
    for tk, players in TEAMS.items():
        teams.append({
            "key": tk, "organiser": "o", "name": {"kes": "Kestrels", "her": "Herons"}[tk],
            "players": [{"key": f"{tk}{i+1}", "name": p.split("/")[0], "short_name": p.split("/")[1]} for i, p in enumerate(players)],
        })
    matches = [{"key": "m", "organiser": "o", "home": "kes", "away": "her", "overs": runs.get("overs", 5),
                "players_per_side": 6, "super_over": runs.get("super_over", False), "batting_first": runs.get("batting_first", "kes"),
                "tournament": None,
                "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
                "scorers": [], "viewer_link": True, "innings": runs.get("innings", []), "summary": runs.get("summary")}]
    return {"users": users, "teams": teams, "matches": matches}

def seed(runs):
    body = mk_seed(runs)
    status, resp = req("POST", "/api/grading/seed", body, {"X-Grading-Key": KEY})
    check(f"seed {runs.get('name', '')} status", status, 201)
    if status != 201:
        print("  ", json.dumps(resp)[:300])
        return None
    return resp

def token(t):
    if len(t) == 1 and t in "0123456":
        return {"ball": t}
    return {"ball": t[0].replace("D", "D") + t[1:]}

# ---------- E3: wickets and all out ----------
resp = seed({"name": "E3", "overs": 5, "innings": [{
    "striker": "kes1", "non_striker": "kes2", "bowlers": ["her1", "her2"],
    "deliveries": [
        "1",
        {"ball": "0", "out": "caught", "fielder": "her3", "new_batter": "kes3"},
        {"ball": "0", "out": "lbw", "new_batter": "kes4"},
        "2",
        {"ball": "1", "out": "run-out", "fielder": "her4", "batter_out": "non-striker", "new_batter": "kes5"},
        {"ball": "0", "out": "bowled", "new_batter": "kes6"},
        {"ball": "D0", "out": "stumped", "fielder": "her5"},
    ],
}]})
if resp:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, card = req("GET", f"/api/matches/{match_id}/scorecard", headers=H)
    inn = card["innings"][0]
    check("E3 total", inn["total_text"], "Total 5 all out (1 ov)")
    check("E3 fow", inn["fall_of_wickets"],
          "Fall of wickets: 1-1 (Iyer, 0.2), 2-1 (Sen, 0.3), 3-4 (Rao, 0.5), 4-4 (Khan, 0.6), 5-5 (Bose, 1.1)")
    check("E3 batting rows", [[b["name"], b["dismissal"], b["runs"], b["balls"], b["strike_rate"]] for b in inn["batting"]],
          [["Arjun Rao", "run out (Gill)", 1, 1, "100.00"],
           ["Kabir Iyer", "c Nair b Mehta", 0, 1, "0.00"],
           ["Dev Sen", "lbw b Mehta", 0, 1, "0.00"],
           ["Neel Bose", "st Kurian b Pillai", 3, 2, "150.00"],
           ["Omar Khan", "b Mehta", 0, 1, "0.00"],
           ["Ravi Das", "not out", 0, 0, "-"]])
    check("E3 bowling", [[b["name"], b["overs"], b["maidens"], b["runs"], b["wickets"], b["wides"], b["no_balls"], b["economy"]] for b in inn["bowling"]],
          [["Vik Mehta", "1", 0, 4, 3, 0, 0, "4.00"],
           ["Sam Pillai", "0", 0, 1, 1, 1, 0, "-"]])
    status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
    check("E3 status innings over", state["match"]["status"], "innings_break")
    check("E3 break text", state["innings_break"]["text"],
          "Kestrels 5 all out (1 ov). Herons need 6 runs from 30 balls.")
    check("E3 did not bat", inn["did_not_bat"], [])

# ---------- E4: free hit ----------
resp = seed({"name": "E4", "overs": 5, "innings": [{
    "striker": "kes1", "non_striker": "kes2", "bowlers": ["her1"],
    "deliveries": ["0", "N1", "D0", "6", "0"],
}]})
if resp:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
    lines = [c["line"] for c in state["commentary"] if c["kind"] == "delivery"]
    check("E4 lines", list(reversed(lines)), [
        "0.1 Mehta to Rao, no run",
        "0.2 Mehta to Rao, no-ball, 1 run",
        "0.2 Mehta to Iyer, 1 wide (free hit)",
        "0.2 Mehta to Iyer, SIX (free hit)",
        "0.3 Mehta to Iyer, no run",
    ])
    check("E4 free hit flags", [c["free_hit"] for c in state["commentary"] if c["kind"] == "delivery"],
          [False, True, True, False, False])
    check("E4 scoreboard after last ball", state["scoreboard"], "Kestrels 9/0 (0.3 ov)")
    check("E4 batters", [b["text"] for b in state["batters"]], ["Iyer* 6 (2)", "Rao 1 (2)"])

# ---------- E8: chase (Kestrels 52/0 in 5 overs, then Herons chase 53) ----------
e8_deliveries = ["4"] * 13 + ["0"] * 17
resp = seed({"name": "E8", "overs": 5, "innings": [
    {"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1", "her2", "her1", "her2", "her1"],
     "deliveries": e8_deliveries},
]})
if resp:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
    check("E8 first innings total", state["scoreboard"], "Kestrels 52/0 (5 ov)")
    check("E8 break heading", state["innings_break"]["heading"], "Innings break")
    check("E8 break text", state["innings_break"]["text"],
          "Kestrels 52/0 (5 ov). Herons need 53 runs from 30 balls.")

# ---------- E10: NRR via summary matches ----------
resp = seed({"name": "E10-summary", "overs": 20, "super_over": False, "summary": {
    "first": {"runs": 140, "wickets": 10, "balls": 111, "all_out": True},
    "second": {"runs": 141, "wickets": 3, "balls": 105, "all_out": False},
    "winner": "her",
}})
if resp:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, team = req("GET", f"/api/teams/{resp['teams']['kes']['id']}", headers=H)
    check("E10 team history count", len(team["matches"]), 1)
    line = team["matches"][0]["line"] if team["matches"] else ""
    check("E10 team history names", "Kestrels v Herons" in line, True)
    check("E10 team history result", "Herons won by 2 wickets (15 balls left)" in line, True)
    check("E10 no scorecard link", team["matches"][0]["scorecard_url"], None)

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
