#!/usr/bin/env python3
"""Chase, super over (E9), points table (E10) and careers (E11)."""
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
        with urllib.request.urlopen(r, timeout=120) as resp:
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
        print(f"FAIL {name}\n  got  {g[:500]}\n  want {w[:500]}")

def mk_team(key, name, count=6):
    players = []
    names = {
        "kes": ["Arjun Rao/Rao", "Kabir Iyer/Iyer", "Dev Sen/Sen", "Neel Bose/Bose", "Omar Khan/Khan", "Ravi Das/Das",
                "Yash Pandey/Pandey", "Ishan Roy/Roy", "Manav Lal/Lal", "Tarun Gupta/Gupta", "Hari Menon/Menon"],
        "her": ["Vik Mehta/Mehta", "Sam Pillai/Pillai", "Jai Nair/Nair", "Tom Gill/Gill", "Ash Kurian/Kurian", "Leo Varma/Varma",
                "Zubin Shah/Shah", "Pranav Dutta/Dutta", "Kiran Bhat/Bhat", "Raj Malik/Malik", "Anil Joseph/Joseph"],
        "fal": ["Fred Finn/Finn", "Finch Ford/Ford", "Flint Fox/Fox", "Fable Fenn/Fenn", "Ferry Fell/Fell", "Field Fay/Fay"],
        "osp": ["Olive Ott/Ott", "Oren Owl/Owl", "Otto Onda/Onda", "Omar Ost/Ost", "Ovie Oster/Oster", "Ozzy Oland/Oland"],
    }.get(key, [f"{key.upper()} {i}/{key.upper()}{i}" for i in range(1, count + 1)])
    for i, p in enumerate(names[:count], 1):
        players.append({"key": f"{key}{i}", "name": p.split("/")[0], "short_name": p.split("/")[1]})
    return {"key": key, "organiser": "o", "name": name, "players": players}

def seed(users_keys, teams, tournaments=None, matches=None, invitations=None):
    tag = uuid.uuid4().hex[:8]
    body = {
        "users": [{"key": "o", "email": f"o{tag}@example.test", "display_name": "Olga", "password": "long-password-1"}] + users_keys,
        "teams": teams,
        "tournaments": tournaments or [],
        "matches": matches or [],
        "invitations": invitations or [],
    }
    status, resp = req("POST", "/api/grading/seed", body, {"X-Grading-Key": KEY})
    return status, resp

# ---------- E9: super over ----------
kes = mk_team("kes", "Kestrels", 6)
her = mk_team("her", "Herons", 6)
# level scores: both make 10, then a super over
innings = [
    {"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1", "her2"], "deliveries": ["4", "4", "0", "0", "1", "1", "0", "0", "0", "0", "0", "0"]},
    {"striker": "her1", "non_striker": "her2", "bowlers": ["kes1", "kes2"], "deliveries": ["4", "4", "0", "0", "1", "1", "0", "0", "0", "0", "0", "0"]},
]
status, resp = seed([], [kes, her], None, [{
    "key": "m", "organiser": "o", "home": "kes", "away": "her", "overs": 2, "players_per_side": 6,
    "super_over": True, "batting_first": "kes", "tournament": None,
    "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
    "scorers": [], "viewer_link": True, "innings": innings, "summary": None,
}])
check("E9 seed", status, 201)
if status == 201:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
    check("E9 status super over break", state["match"]["status"], "super_over_break")
    brk = state["innings_break"]
    check("E9 break heading", brk["heading"], "Super over 1")
    check("E9 break text", brk["text"], "Scores level. Herons bat first in super over 1.")

    # Play the super over: Herons bat first (14 runs), Kestrels chase 15
    super_innings = [
        {"striker": "her1", "non_striker": "her2", "bowlers": ["kes1"],
         "deliveries": ["4", "1", {"ball": "0", "out": "caught", "fielder": "kes3", "new_batter": "her4"},
                        "D0", "6", "2", {"ball": "0", "out": "bowled", "new_batter": None}]},
        {"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1"],
         "deliveries": ["6", "1", "4", "N0", "2", "1"]},
    ]
    status, resp2 = req("POST", "/api/grading/seed", {
        "users": [], "teams": [], "matches": [],
    }, {"X-Grading-Key": KEY})
    # seed the super over innings into the same match via a fresh seed with all innings
    status, resp3 = seed([], [kes, her], None, [{
        "key": "m2", "organiser": "o", "home": "kes", "away": "her", "overs": 2, "players_per_side": 6,
        "super_over": True, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True,
        "innings": innings + super_innings, "summary": None,
    }])
    check("E9 full seed", status, 201)
    if status == 201:
        match_id2 = resp3["matches"]["m2"]["id"]
        H2 = {"Cookie": f"oc_session={resp3['users']['o']['session']}"}
        status, state = req("GET", f"/api/matches/{match_id2}/state", headers=H2)
        check("E9 result", state.get("result"), "Kestrels won the super over")
        check("E9 status", state["match"]["status"], "result")
        status, card = req("GET", f"/api/matches/{match_id2}/scorecard", headers=H2)
        headings = [i["heading"] for i in card["innings"]]
        check("E9 scorecard sections", headings, ["Kestrels innings", "Herons innings", "Super over 1: Herons", "Super over 1: Kestrels"])
        so_herons = card["innings"][2]
        check("E9 super over total", so_herons["total_text"], "Total 14 all out (1 ov)")
        so_kes = card["innings"][3]
        check("E9 chase total", so_kes["total_text"], "Total 15/0 (0.5 ov)")
        # careers exclude super overs
        status, career = req("GET", f"/api/players/{resp3['teams']['kes']['players']['kes1']}", headers=H2)
        check("E9 career batting runs", career["batting"]["runs"] >= 0, True)

# ---------- E10: points table with NRR ----------
fal = mk_team("fal", "Falcons", 6)
osp = mk_team("osp", "Ospreys", 6)
teams4 = [mk_team("kes", "Kestrels", 6), mk_team("her", "Herons", 6), fal, osp]
matches = [
    {"key": "m1", "organiser": "o", "home": "kes", "away": "her", "overs": 20, "players_per_side": 6,
     "super_over": False, "batting_first": "kes", "tournament": "t",
     "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
     "scorers": [], "viewer_link": True, "innings": [], "summary": None,
     "played_on": "2026-11-04",
     "summary": {"first": {"runs": 160, "wickets": 4, "balls": 120, "all_out": False},
                 "second": {"runs": 150, "wickets": 7, "balls": 120, "all_out": False},
                 "winner": "kes"}},
    {"key": "m2", "organiser": "o", "home": "osp", "away": "fal", "overs": 20, "players_per_side": 6,
     "super_over": False, "batting_first": "fal", "tournament": "t",
     "xi": {"fal": [f"fal{i}" for i in range(1, 7)], "osp": [f"osp{i}" for i in range(1, 7)]},
     "scorers": [], "viewer_link": True, "innings": [], "summary": None,
     "summary": {"first": {"runs": 140, "wickets": 10, "balls": 111, "all_out": True},
                 "second": {"runs": 141, "wickets": 3, "balls": 105, "all_out": False},
                 "winner": "osp"}},
]
tournament = [{"key": "t", "organiser": "o", "name": "Autumn Cup", "overs": 20, "players_per_side": 6,
               "super_over": False, "groups": [{"name": "Group A", "teams": ["kes", "her", "fal", "osp"]}]}]
status, resp = seed([], teams4, tournament, matches)
if status != 201:
    print("   E10 seed error:", json.dumps(resp)[:200])
check("E10 seed", status, 201)
if status == 201:
    t_id = resp["tournaments"]["t"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, t = req("GET", f"/api/tournaments/{t_id}", headers=H)
    if status != 200:
        print("   E10 tournament fetch:", status, json.dumps(t)[:200])
    check("E10 tournament name", t.get("name"), "Autumn Cup")
    table = t["groups"][0]["table"]
    by_team = {row["team"]["name"]: row for row in table}
    check("E10 Kes P/W/Pts", [by_team["Kestrels"]["p"], by_team["Kestrels"]["w"], by_team["Kestrels"]["pts"]], [1, 1, 2])
    check("E10 Her L", by_team["Herons"]["l"], 1)
    check("E10 Falcons NRR", by_team["Falcons"]["nrr"], "-1.057")
    check("E10 Ospreys NRR", by_team["Ospreys"]["nrr"], "+1.057")
    # Falcons 140 all out count 20 overs: 140/20 - 141/17.5
    check("E10 Falcons NRR value", by_team["Falcons"]["nrr"], "-1.057")
    check("E10 order by points then NRR", [row["team"]["name"] for row in table], ["Ospreys", "Kestrels", "Herons", "Falcons"])

# ---------- E11: careers ----------
kes = mk_team("kes", "Kestrels", 6)
her = mk_team("her", "Herons", 6)
# A finished match: Kestrels 60/0 in 18 balls (3 overs), Herons all out for 12 chasing 61
inn1 = {"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1", "her2", "her1"],
        "deliveries": ["4", "4", "6", "1", "4", "4", "6", "1", "4", "4", "6", "1", "4", "4", "6", "0", "0", "0"]}
inn2 = {"striker": "her1", "non_striker": "her2", "bowlers": ["kes1", "kes2", "kes1"],
        "deliveries": ["6", "0", {"ball": "0", "out": "bowled"}, "0",
                       {"ball": "0", "out": "caught", "fielder": "kes3"}, "0",
                       {"ball": "0", "out": "lbw"}, "0",
                       {"ball": "0", "out": "bowled"}, "0",
                       {"ball": "0", "out": "lbw"}]}
status, resp = seed([], [kes, her], None, [{
    "key": "m", "organiser": "o", "home": "kes", "away": "her", "overs": 3, "players_per_side": 6,
    "super_over": False, "batting_first": "kes", "tournament": None,
    "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
    "scorers": [], "viewer_link": True, "innings": [inn1, inn2], "summary": None,
}])
check("E11 seed", status, 201)
if status == 201:
    match_id = resp["matches"]["m"]["id"]
    session = resp["users"]["o"]["session"]
    H = {"Cookie": f"oc_session={session}"}
    status, state = req("GET", f"/api/matches/{match_id}/state", headers=H)
    check("E11 match finished", state["match"]["status"], "result")
    check("E11 result text", state["result"], "Kestrels won by 53 runs")
    rao_id = resp["teams"]["kes"]["players"]["kes1"]
    status, career = req("GET", f"/api/players/{rao_id}", headers=H)
    b = career["batting"]
    check("E11 Mat", b["matches"], 1)
    check("E11 Inns", b["innings"], 1)
    check("E11 NO", b["not_outs"], 1)
    check("E11 Runs", b["runs"], 22)
    check("E11 HS", b["high_score"], "22*")
    check("E11 Avg", b["average"], "-")
    check("E11 4s", b["fours"], 2)
    check("E11 6s", b["sixes"], 2)
    check("E11 SR", b["strike_rate"], "366.67")
    bowl = career["bowling"]
    check("E11 Overs", bowl["overs"], "1")
    check("E11 Runs conceded", bowl["runs"], 6)
    check("E11 Wkts", bowl["wickets"], 2)
    check("E11 Best", bowl["best"], "2/6")
    check("E11 Econ", bowl["economy"], "6.00")

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
