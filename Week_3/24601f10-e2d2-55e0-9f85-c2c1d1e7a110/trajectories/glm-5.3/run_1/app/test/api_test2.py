#!/usr/bin/env python3
"""Second test suite: DE, RR, Swiss, Shutter trace, share, history, live."""
import json, random, string, sys, urllib.request, urllib.error, time

BASE = "http://127.0.0.1:4173"
FAILED = []
PASSED = 0

def api(method, path, body=None, cookie=None, expect=None, headers=None):
    global PASSED
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        resp = urllib.request.urlopen(req)
        status, text, setc = resp.status, resp.read(), resp.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        status, text, setc = e.code, e.read(), None
    except Exception as e:
        status, text, setc = 0, str(e).encode(), None
    if expect is not None:
        if status == expect:
            PASSED += 1
        else:
            FAILED.append(f"{method} {path} -> {status}, expected {expect}: {text[:300]}")
    try:
        parsed = json.loads(text) if text else text
    except Exception:
        parsed = text
    return {"status": status, "body": parsed, "set_cookie": setc}

def check(name, cond, detail=""):
    global PASSED
    if cond:
        PASSED += 1
    else:
        FAILED.append(f"{name}: {detail}")

def rname(prefix):
    return prefix + "".join(random.choices(string.ascii_lowercase, k=6))

u1 = rname("org")
api("POST", "/api/auth/signup", {"username": u1, "password": "password-1"}, expect=201)
r = api("POST", "/api/auth/signin", {"username": u1, "password": "password-1"}, expect=200)
cookie = r["set_cookie"].split(";")[0]

def make(format_, n=8, name="Cup"):
    u = rname("mk")
    api("POST", "/api/auth/signup", {"username": u, "password": "password-1"}, expect=201)
    rr = api("POST", "/api/auth/signin", {"username": u, "password": "password-1"}, expect=200)
    ck = rr["set_cookie"].split(";")[0]
    globals()["last_make_user"] = u
    r = api("POST", "/api/tournaments", {"name": name, "format": format_, "time_zone": "UTC", "fill": "lilac"}, cookie=ck, expect=201)
    tid = r["body"]["tournament"]["id"]
    names = ["Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal"][:n]
    for i, nm in enumerate(names):
        api("POST", f"/api/tournaments/{tid}/entrants", {"name": nm}, cookie=ck, expect=201)
    globals()["cookie"] = ck
    return tid

def matches_of(tid):
    return {m["label"]: m for m in api("GET", f"/api/tournaments/{tid}/matches", cookie=cookie, expect=200)["body"]["matches"]}

print("== double elimination of 8 ==")
tid = make("double_elimination", 8, "DE Cup")
de_cookie = cookie
de_user = last_make_user
# link players to accounts so history rows are written at finish
de_players = {}
for nm in ["Ana", "Ben", "Cai", "Dov"]:
    pu = rname("p" + nm.lower())
    api("POST", "/api/auth/signup", {"username": pu, "password": "password-1"}, expect=201)
    de_players[nm] = pu
ents = api("GET", f"/api/tournaments/{tid}/entrants", cookie=de_cookie, expect=200)["body"]["entrants"]
for e in ents:
    if e["name"] in de_players:
        api("PATCH", f"/api/entrants/{e['id']}", {"username": de_players[e["name"]]}, cookie=de_cookie, expect=200)
api("POST", f"/api/tournaments/{tid}/start", {}, cookie=cookie, expect=200)
ms = matches_of(tid)
check("W1M1", ms["Winners round 1, match 1"]["upper"]["name"] == "Ana" and ms["Winners round 1, match 1"]["lower"]["name"] == "Hal")
check("W1M2", ms["Winners round 1, match 2"]["upper"]["name"] == "Dov" and ms["Winners round 1, match 2"]["lower"]["name"] == "Eli")
check("W1M3", ms["Winners round 1, match 3"]["upper"]["name"] == "Ben" and ms["Winners round 1, match 3"]["lower"]["name"] == "Gus")
check("W1M4", ms["Winners round 1, match 4"]["upper"]["name"] == "Cai" and ms["Winners round 1, match 4"]["lower"]["name"] == "Fen")
check("grand final waiting entrants", ms["Grand final"]["upper"] is None and ms["Grand final"]["lower"] is None)
check("gfr waiting", ms["Grand final reset"]["state"] == "waiting")
check("L1M1 pending", ms["Losers round 1, match 1"]["upper"] is None)

# play W1: winners advance, losers drop
for label, u, l in [("Winners round 1, match 1", 2, 0), ("Winners round 1, match 2", 2, 1), ("Winners round 1, match 3", 2, 1), ("Winners round 1, match 4", 0, 2)]:
    m = ms[label]
    r = api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=cookie, expect=200)
ms = matches_of(tid)
check("L1M1 has losers", ms["Losers round 1, match 1"]["upper"]["name"] == "Hal" and ms["Losers round 1, match 1"]["lower"]["name"] == "Eli")
check("L1M2 has losers", ms["Losers round 1, match 2"]["upper"]["name"] == "Gus" and ms["Losers round 1, match 2"]["lower"]["name"] == "Cai")
check("W2M1", ms["Winners round 2, match 1"]["upper"]["name"] == "Ana" and ms["Winners round 2, match 1"]["lower"]["name"] == "Dov")
check("W2M2", ms["Winners round 2, match 2"]["upper"]["name"] == "Ben" and ms["Winners round 2, match 2"]["lower"]["name"] == "Fen")
check("current round", api("GET", f"/api/tournaments/{tid}", cookie=cookie)["body"]["tournament"]["current_round"] == {"bracket": "winners", "round": 2})

# play L1 and W2
for label, u, l in [("Losers round 1, match 1", 2, 1), ("Losers round 1, match 2", 0, 2), ("Winners round 2, match 1", 2, 0), ("Winners round 2, match 2", 1, 2)]:
    m = ms[label]
    api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=cookie, expect=200)
ms = matches_of(tid)
# L2: winners of L1 vs losers of W2 (reversed order): L2M1 = winner L1M1 vs loser W2M2, L2M2 = winner L1M2 vs loser W2M1
check("L2M1 upper", ms["Losers round 2, match 1"]["upper"]["name"] == "Hal", str(ms["Losers round 2, match 1"]["upper"]))
check("L2M1 lower (loser W2M2)", ms["Losers round 2, match 1"]["lower"]["name"] == "Ben")
check("L2M2 upper", ms["Losers round 2, match 2"]["upper"]["name"] == "Cai")
check("L2M2 lower (loser W2M1)", ms["Losers round 2, match 2"]["lower"]["name"] == "Dov")

print("== grand final reset ==")
# fast-forward: play all remaining until grand final
def play_all(tid, decisions):
    ms = matches_of(tid)
    for label, (u, l) in decisions.items():
        m = ms.get(label)
        if m and m["state"] in ("pending", "called"):
            api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=cookie)

play_all(tid, {
    "Losers round 2, match 1": (2, 0), "Losers round 2, match 2": (1, 2),
    "Winners round 3, match 1": (2, 1),
    "Losers round 3, match 1": (2, 0),
    "Losers round 4, match 1": (2, 0),
    "Grand final": (0, 2),
})
ms = matches_of(tid)
check("gfr becomes pending after lower wins GF1", ms["Grand final reset"]["state"] == "pending")
check("gfr entrants", ms["Grand final reset"]["upper"] is not None and ms["Grand final reset"]["upper"]["name"] == "Ana" and ms["Grand final reset"]["lower"] is not None and ms["Grand final reset"]["lower"]["name"] is not None, str(ms["Grand final reset"])[:300])
r = api("GET", f"/api/tournaments/{tid}", cookie=cookie)
check("still running after reset needed", r["body"]["tournament"]["state"] == "running")
m = ms["Grand final reset"]
api("POST", f"/api/matches/{m['id']}/result", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=cookie, expect=200)
r = api("GET", f"/api/tournaments/{tid}", cookie=cookie, expect=200)
check("finished after reset", r["body"]["tournament"]["state"] == "finished")
ms = matches_of(tid)
check("gfr has result", ms["Grand final reset"]["winner"] == "upper")

print("== share link ==")
r = api("GET", f"/api/tournaments/{tid}", cookie=de_cookie)
share_code = r["body"]["tournament"]["share_url"].split("/s/")[1]
r = api("GET", f"/api/share/{share_code}", expect=200)
check("share tournament name", r["body"]["tournament"]["name"] == "DE Cup")
check("share has no organizer", "organizer" not in r["body"]["tournament"])
check("share has no share_url", "share_url" not in r["body"]["tournament"])
check("share entrants public shape", set(r["body"]["entrants"][0].keys()) == {"name", "seed"})
check("share match no updated_by", "updated_by" not in r["body"]["matches"][0])
r = api("POST", f"/api/share/{share_code}/start", {}, expect=405)
check("share read only", r["body"]["message"] == "Share links are read-only.")
r = api("GET", f"/api/share/badcode123", expect=404)
check("unknown share link", r["body"]["message"] == "This link no longer works.")

# rotate: old link dies
r = api("POST", f"/api/tournaments/{tid}/share/rotate", {}, cookie=cookie, expect=200)
new_url = r["body"]["share_url"]
r = api("GET", f"/api/share/{share_code}", expect=404)
check("old link dead after rotate", r["body"]["message"] == "This link no longer works.")
new_code = new_url.split("/s/")[1]
r = api("GET", f"/api/share/{new_code}", expect=200)
check("new link works", r["body"]["tournament"]["name"] == "DE Cup")

print("== history rows ==")
r = api("GET", f"/api/users/{de_players['Ana']}/history", expect=200)
rows = r["body"]["rows"]
check("history has DE cup", any(row["tournament_name"] == "DE Cup" for row in rows), str(rows)[:200])
de_row = next((row for row in rows if row["tournament_name"] == "DE Cup"), None)
if de_row:
    check("history row text", de_row["text"].startswith("DE Cup · 1st of 8 · "), str(de_row))
    check("history field size", de_row["field_size"] == 8)

print("== round robin ==")
tid = make("round_robin", 5, "RR Cup")
api("POST", f"/api/tournaments/{tid}/start", {}, cookie=cookie, expect=200)
ms = matches_of(tid)
# 5 entrants -> 6 positions, 5 rounds, 3 matches each (one bye)
check("rr match count", len(ms) == 15, str(len(ms)))
check("rr round 1 m1 bye", ms["Round 1, match 1"]["upper"]["name"] == "Ana" and ms["Round 1, match 1"]["lower"] == {"bye": True})
check("rr round 1 m2", ms["Round 1, match 2"]["upper"]["name"] == "Ben" and ms["Round 1, match 2"]["lower"]["name"] == "Eli")
check("rr round 1 m3", ms["Round 1, match 3"]["upper"]["name"] == "Cai" and ms["Round 1, match 3"]["lower"]["name"] == "Dov")
check("rr round 2 m2 bye", ms["Round 2, match 2"]["upper"] == {"bye": True} and ms["Round 2, match 2"]["lower"]["name"] == "Dov")
check("rr round 4 m3 bye", ms["Round 4, match 3"]["upper"]["name"] == "Eli" and ms["Round 4, match 3"]["lower"] == {"bye": True})
check("rr round 5 m1", ms["Round 5, match 1"]["upper"]["name"] == "Ana" and ms["Round 5, match 1"]["lower"]["name"] == "Ben")

# standings before results
r = api("GET", f"/api/tournaments/{tid}/standings", cookie=cookie, expect=200)
check("standings columns", r["body"]["columns"] == ["Place", "Entrant", "Played", "Match points", "Head-to-head", "Game difference", "Games won", "Seed", "Decided by"])
check("standings zero rows", all(row["played"] == 0 for row in r["body"]["rows"]))

# play the worked example: Ana-Ben 2-1, Ana-Cai 0-2, Ana-Dov 2-0, Ana-Eli 2-0,
# Ben-Cai 2-0, Ben-Dov 2-1, Ben-Eli 2-0, Cai-Dov 2-1, Cai-Eli 2-1, Dov-Eli 2-1
results = {
    ("Ana","Ben"): (2,1), ("Ana","Cai"): (0,2), ("Ana","Dov"): (2,0), ("Ana","Eli"): (2,0),
    ("Ben","Cai"): (2,0), ("Ben","Dov"): (2,1), ("Ben","Eli"): (2,0),
    ("Cai","Dov"): (2,1), ("Cai","Eli"): (2,1), ("Dov","Eli"): (2,1),
}
ms = matches_of(tid)
for label, m in ms.items():
    if m["state"] != "pending":
        continue
    u = m["upper"]["name"] if m["upper"] and "name" in m["upper"] else None
    l = m["lower"]["name"] if m["lower"] and "name" in m["lower"] else None
    if u in ("Ana","Ben","Cai","Dov","Eli") and l in ("Ana","Ben","Cai","Dov","Eli"):
        # find which pair (order may differ); games always upper-first
        if (u, l) in results:
            ug, lg = results[(u, l)]
        elif (l, u) in results:
            lg, ug = results[(l, u)]
        else:
            continue
        api("POST", f"/api/matches/{m['id']}/result", {"upper_games": ug, "lower_games": lg, "version": m["version"]}, cookie=cookie, expect=200)

r = api("GET", f"/api/tournaments/{tid}", cookie=cookie)
check("rr finished", r["body"]["tournament"]["state"] == "finished")
r = api("GET", f"/api/tournaments/{tid}/standings", cookie=cookie, expect=200)
rows = r["body"]["rows"]
by_name = {row["name"]: row for row in rows}
check("rr Ben first", rows[0]["name"] == "Ben", str([(x["name"], x["match_points"], x["game_difference"], x["decided_by"]) for x in rows]))
check("rr Ana second", rows[1]["name"] == "Ana")
check("rr Cai third", rows[2]["name"] == "Cai")
check("rr Ben mp 9", by_name["Ben"]["match_points"] == 9)
check("rr Ben gd +4", by_name["Ben"]["game_difference"] == 4)
check("rr Ben h2h 3", by_name["Ben"]["head_to_head"] == 3)
check("rr Ben games won 7", by_name["Ben"]["games_won"] == 7)
check("rr Ben decided by Game difference", by_name["Ben"]["decided_by"] == "Game difference", str(by_name["Ben"]["decided_by"]))
check("rr Dov 4th mp 3", by_name["Dov"]["place"] == 4 and by_name["Dov"]["match_points"] == 3)
check("rr Dov decided by Match points", by_name["Dov"]["decided_by"] == "Match points")
check("rr Eli last", by_name["Eli"]["place"] == 5 and by_name["Eli"]["match_points"] == 0)

print("== Swiss ==")
tid = make("swiss", 6, "Swiss Cup")
api("POST", f"/api/tournaments/{tid}/start", {}, cookie=cookie, expect=200)
ms = matches_of(tid)
check("swiss round 1 pairs 1v4 2v5 3v6", ms["Round 1, match 1"]["upper"]["name"] == "Ana" and ms["Round 1, match 1"]["lower"]["name"] == "Dov"
      and ms["Round 1, match 2"]["upper"]["name"] == "Ben" and ms["Round 1, match 2"]["lower"]["name"] == "Eli"
      and ms["Round 1, match 3"]["upper"]["name"] == "Cai" and ms["Round 1, match 3"]["lower"]["name"] == "Fen")
r = api("GET", f"/api/tournaments/{tid}", cookie=cookie)
check("swiss rounds = 3", r["body"]["tournament"]["swiss_rounds"] == 3)
# no next round until current complete
r = api("POST", f"/api/tournaments/{tid}/rounds", {}, cookie=cookie, expect=409)
check("finish round first", r["body"]["message"] == "Finish every match in round 1 first.")
# worked round 1: Ana-Dov 2-0, Ben-Eli 1-2, Cai-Fen 1-1 (draw)
for label, (u, l) in [("Round 1, match 1", (2, 0)), ("Round 1, match 2", (1, 2)), ("Round 1, match 3", (1, 1))]:
    m = ms[label]
    r = api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=cookie, expect=200)
    if r["status"] != 200:
        FAILED.append(f"swiss r1 {label}: {r['status']} {str(r['body'])[:200]}")
r = api("GET", f"/api/tournaments/{tid}/standings", cookie=cookie, expect=200)
rows = r["body"]["rows"]
check("swiss columns", r["body"]["columns"] == ["Place", "Entrant", "Played", "Match points", "Buchholz cut 1", "Buchholz", "Sonneborn-Berger", "Seed", "Decided by"])
by_name = {row["name"]: row for row in rows}
check("swiss Ana 3 pts", by_name["Ana"]["match_points"] == 3)
check("swiss Eli 3 pts", by_name["Eli"]["match_points"] == 3)
check("swiss draw gives 1 each", by_name["Cai"]["match_points"] == 1 and by_name["Fen"]["match_points"] == 1)
r = api("POST", f"/api/tournaments/{tid}/rounds", {}, cookie=cookie, expect=201)
if r["status"] != 201:
    FAILED.append(f"swiss rounds: {r['status']} {str(r['body'])[:300]}")
ms = matches_of(tid)
if "Round 2, match 1" not in ms:
    FAILED.append(f"swiss r2 missing: labels={sorted(ms.keys())}")
# worked round 2: m1 Ana vs Eli; m2 Cai vs Ben; m3 Fen vs Dov
r2m1 = ms.get("Round 2, match 1")
r2m2 = ms.get("Round 2, match 2")
r2m3 = ms.get("Round 2, match 3")
check("swiss r2 m1", r2m1 is not None and r2m1["upper"]["name"] == "Ana" and r2m1["lower"]["name"] == "Eli", str([r2m1, r2m2, r2m3])[:400])
check("swiss r2 m2", r2m2 is not None and r2m2["upper"]["name"] == "Cai" and r2m2["lower"]["name"] == "Ben", str(r2m2))
check("swiss r2 m3", r2m3 is not None and r2m3["upper"]["name"] == "Fen" and r2m3["lower"]["name"] == "Dov", str(r2m3))
# play round 2 with the worked example then check standings
for label, (u, l) in [("Round 2, match 1", (2, 1)), ("Round 2, match 2", (2, 0)), ("Round 2, match 3", (1, 1))]:
    m = ms.get(label)
    if m is None:
        FAILED.append(f"missing {label} in play round 2: {sorted(ms.keys())}")
        continue
    api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=cookie, expect=200)
r = api("GET", f"/api/tournaments/{tid}/standings", cookie=cookie, expect=200)
rows = r["body"]["rows"]
by_name = {row["name"]: row for row in rows}
check("swiss Ana 1st", by_name["Ana"]["place"] == 1 and by_name["Ana"]["match_points"] == 6, str(rows))
check("swiss Ana buchholz 4", by_name["Ana"]["buchholz"] == 4)
check("swiss Ana buchholz cut 3", by_name["Ana"]["buchholz_cut_1"] == 3)
check("swiss Ana sb 4", by_name["Ana"]["sonneborn_berger"] == 4)
check("swiss Cai 2nd", by_name["Cai"]["place"] == 2 and by_name["Cai"]["match_points"] == 4)
check("swiss Fen sb 2.5", by_name["Fen"]["sonneborn_berger"] == 2.5)
check("swiss Dov buchholz 8", by_name["Dov"]["buchholz"] == 8)
check("swiss all decided by Match points", all(row["decided_by"] == "Match points" for row in rows))

print("== Swiss bye (odd field) ==")
tid = make("swiss", 5, "Bye Cup")
api("POST", f"/api/tournaments/{tid}/start", {}, cookie=cookie, expect=200)
ms = matches_of(tid)
check("bye is last card", ms["Round 1, match 3"]["upper"]["name"] == "Eli" and ms["Round 1, match 3"]["lower"] == {"bye": True}, str(ms["Round 1, match 3"]))
check("bye state", ms["Round 1, match 3"]["state"] == "bye")
check("bye 2-0", ms["Round 1, match 3"]["upper_games"] == 2 and ms["Round 1, match 3"]["lower_games"] == 0)
check("bye winner upper", ms["Round 1, match 3"]["winner"] == "upper")
r = api("GET", f"/api/tournaments/{tid}/standings", cookie=cookie)
by_name = {row["name"]: row for row in r["body"]["rows"]}
check("bye worth 3", by_name["Eli"]["match_points"] == 3, str(r["body"]["rows"]))
check("bye counts played", by_name["Eli"]["played"] == 1)

print(f"\n=== {PASSED} passed, {len(FAILED)} failed ===")
for f in FAILED:
    print("FAIL:", f)
sys.exit(1 if FAILED else 0)
