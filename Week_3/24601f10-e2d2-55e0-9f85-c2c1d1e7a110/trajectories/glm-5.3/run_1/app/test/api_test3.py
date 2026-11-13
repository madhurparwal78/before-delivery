#!/usr/bin/env python3
"""Third suite: report/confirm/dispute/resolve as players, Shutter trace, live, timers, grading."""
import json, random, string, sys, time, urllib.request, urllib.error, threading

BASE = "http://127.0.0.1:4173"
FAILED = []
PASSED = 0

def api(method, path, body=None, cookie=None, expect=None):
    global PASSED
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
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

def rname(p):
    return p + "".join(random.choices(string.ascii_lowercase, k=6))

# organizer + two players
org = rname("org")
api("POST", "/api/auth/signup", {"username": org, "password": "password-1"}, expect=201)
r = api("POST", "/api/auth/signin", {"username": org, "password": "password-1"}, expect=200)
org_ck = r["set_cookie"].split(";")[0]
players = {}
for n in ["Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal"]:
    un = rname("p" + n.lower())
    api("POST", "/api/auth/signup", {"username": un, "password": "password-1"}, expect=201)
    r = api("POST", "/api/auth/signin", {"username": un, "password": "password-1"}, expect=200)
    players[n] = {"username": un, "cookie": r["set_cookie"].split(";")[0]}

def make(format_, name, n=8, link=True):
    r = api("POST", "/api/tournaments", {"name": name, "format": format_, "time_zone": "UTC", "fill": "lilac"}, cookie=org_ck, expect=201)
    tid = r["body"]["tournament"]["id"]
    names = list(players.keys())[:n]
    for nm in names:
        api("POST", f"/api/tournaments/{tid}/entrants", {"name": nm, "username": players[nm]["username"] if link else None}, cookie=org_ck, expect=201)
    api("POST", f"/api/tournaments/{tid}/start", {}, cookie=org_ck, expect=200)
    return tid

def matches_of(tid, ck=org_ck):
    return {m["label"]: m for m in api("GET", f"/api/tournaments/{tid}/matches", cookie=ck, expect=200)["body"]["matches"]}

print("== player report and confirm ==")
tid = make("single_elimination", "Report Cup")
ms = matches_of(tid)
m = ms["Round 1, match 1"]  # Ana vs Hal
check("r1m1 is Ana vs Hal", m["upper"]["name"] == "Ana" and m["lower"]["name"] == "Hal")
# a non-player cannot report
r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=None, expect=401)
# Ana reports
r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 1, "version": m["version"]}, cookie=players["Ana"]["cookie"], expect=200)
check("reported state", r["body"]["match"]["state"] == "reported")
check("reported outcome", r["body"]["outcome"] == "reported")
check("report by name", r["body"]["match"]["report"]["by"] == "Ana")
check("auto_confirm_at set", r["body"]["match"]["report"]["auto_confirm_at"] is not None)
v = r["body"]["match"]["version"]
# Ana cannot confirm her own report
r = api("POST", f"/api/matches/{m['id']}/confirm", {"version": v}, cookie=players["Ana"]["cookie"], expect=403)
check("cannot confirm own", r["body"]["message"] == "You cannot confirm your own report.")
# Ana cannot report twice
r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 1, "version": v}, cookie=players["Ana"]["cookie"], expect=409)
check("already reported", r["body"]["message"] == "You already reported this match.")
# Hal confirms
r = api("POST", f"/api/matches/{m['id']}/confirm", {"version": v}, cookie=players["Hal"]["cookie"], expect=200)
check("confirmed", r["body"]["match"]["state"] == "confirmed")
check("confirmed winner", r["body"]["match"]["winner"] == "upper")
check("confirm updated_by hidden from player", "updated_by" not in r["body"]["match"])
ov = api("GET", f"/api/tournaments/{tid}/matches", cookie=org_ck, expect=200)["body"]["matches"]
ovm = next((x for x in ov if x["id"] == m["id"]), None)
check("confirm updated_by for organizer", ovm is not None and ovm["updated_by"] == players["Hal"]["username"], str(ovm.get("updated_by") if ovm else None))
# confirmed match refuses new reports
r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 1, "version": ovm["version"]}, cookie=players["Hal"]["cookie"], expect=409)
check("already has result", r["body"]["message"] == "This match already has a result.")
# organizer cannot confirm with no report on another match
m2 = ms["Round 1, match 2"]
r = api("POST", f"/api/matches/{m2['id']}/confirm", {"version": m2["version"]}, cookie=org_ck, expect=409)
check("no report to answer", r["body"]["message"] == "There is no report to answer.")

print("== dispute and resolve ==")
m3 = ms["Round 1, match 3"]  # Ben vs Gus
r = api("POST", f"/api/matches/{m3['id']}/report", {"upper_games": 2, "lower_games": 0, "version": m3["version"]}, cookie=players["Ben"]["cookie"], expect=200)
v = r["body"]["match"]["version"]
# Gus disputes with a different score
r = api("POST", f"/api/matches/{m3['id']}/dispute", {"upper_games": 0, "lower_games": 2, "version": v}, cookie=players["Gus"]["cookie"], expect=200)
check("disputed state", r["body"]["match"]["state"] == "disputed")
check("dispute by name", r["body"]["match"]["dispute"]["by"] == "Gus")
check("report kept", r["body"]["match"]["report"]["by"] == "Ben")
# disputes list
r = api("GET", f"/api/tournaments/{tid}/disputes", cookie=org_ck, expect=200)
check("disputes listed", len(r["body"]["matches"]) == 1 and r["body"]["matches"][0]["label"] == "Round 1, match 3")
# non-organizer cannot resolve
r = api("POST", f"/api/matches/{m3['id']}/resolve", {"upper_games": 2, "lower_games": 1, "version": r["body"]["matches"][0]["version"]}, cookie=players["Ben"]["cookie"], expect=403)
check("only organizers resolve", r["body"]["message"] == "Only organizers can resolve disputes.")
# organizer resolves
v = matches_of(tid)["Round 1, match 3"]["version"]
r = api("POST", f"/api/matches/{m3['id']}/resolve", {"upper_games": 2, "lower_games": 1, "version": v}, cookie=org_ck, expect=200)
check("resolved state", r["body"]["match"]["state"] == "resolved")
check("resolved winner", r["body"]["match"]["winner"] == "upper")
# resolving again after a resolution names the resolver and result
r = api("POST", f"/api/matches/{m3['id']}/resolve", {"upper_games": 0, "lower_games": 2, "version": r["body"]["match"]["version"]}, cookie=org_ck, expect=409)
check("already resolved names resolver", r["body"]["message"] == f"This dispute was already resolved by {org}. Result: 2-1.", str(r["body"])[:200])
check("already resolved carries match", r["body"]["match"]["id"] == m3["id"])
# resolving a never-disputed match answers no open dispute
m4 = matches_of(tid)["Round 1, match 4"]
r = api("POST", f"/api/matches/{m4['id']}/resolve", {"upper_games": 2, "lower_games": 0, "version": m4["version"]}, cookie=org_ck, expect=409)
check("no open dispute", r["body"].get("message") == "There is no open dispute.", str(r["body"])[:200])

print("== simultaneous conflicting reports -> exactly one dispute ==")
tid2 = make("single_elimination", "Conflict Cup")
ms = matches_of(tid2)
m = ms["Round 1, match 1"]
# both players report conflicting scores with the same version
res = {}
def report(player):
    r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=players[player]["cookie"])
    res[player] = r
t1 = threading.Thread(target=report, args=("Ana",))
t2 = threading.Thread(target=report, args=("Hal",))
t1.start(); t2.start(); t1.join(); t2.join()
final = matches_of(tid2)["Round 1, match 1"]
is_one = (final["state"] == "disputed" and final["report"] is not None and final["dispute"] is not None)
is_confirmed = final["state"] == "confirmed"
check("conflicting reports end as exactly one dispute or one confirm", is_one or is_confirmed, str(final)[:300])
if final["state"] == "disputed":
    check("dispute has both claims", (final["report"]["by"], final["dispute"]["by"]) in (("Ana", "Hal"), ("Hal", "Ana")), str((final["report"], final["dispute"])))

print("== auto-confirm on server time ==")
tid3 = make("single_elimination", "AutoConfirm Cup")
ms = matches_of(tid3)
m = ms["Round 1, match 1"]
r = api("POST", f"/api/matches/{m['id']}/report", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=players["Ana"]["cookie"], expect=200)
auto_at = r["body"]["match"]["report"]["auto_confirm_at"]
check("auto_confirm_at future", auto_at > r["body"]["match"]["report"]["reported_at"])
# confirm window is 20s in this environment; advance the server clock
r = api("POST", "/api/grading/clock", {"advance_ms": 21000}, expect=200)
check("clock advanced", "server_time" in r["body"])
final = matches_of(tid3)["Round 1, match 1"]
check("auto-confirmed after window", final["state"] == "confirmed", str(final["state"]))
check("auto-confirm updated_by system", final["updated_by"] == "system")
check("winner placed", final["winner"] == "upper")
r2 = matches_of(tid3)["Round 2, match 1"]
check("winner advanced after auto-confirm", r2["upper"]["name"] == "Ana", str(r2))

print("== overdue flag (organizers only) ==")
tid4 = make("single_elimination", "Overdue Cup")
ms = matches_of(tid4)
m = ms["Round 1, match 1"]
r = api("POST", f"/api/matches/{m['id']}/call", {"version": m["version"]}, cookie=org_ck, expect=200)
# match limit is 15s in this environment
api("POST", "/api/grading/clock", {"advance_ms": 16000}, expect=200)
time.sleep(1.5)
final = matches_of(tid4)["Round 1, match 1"]
check("overdue for organizer", final.get("overdue") is True, str(final.get("overdue")))
# a player must NOT see overdue
r = api("GET", f"/api/tournaments/{tid4}/matches", cookie=players["Ana"]["cookie"], expect=200)
pview = {mm["label"]: mm for mm in r["body"]["matches"]}["Round 1, match 1"]
check("overdue hidden from players", "overdue" not in pview, str(pview.get("overdue")))
check("updated_by hidden from players", "updated_by" not in pview)

print("== Shutter trace preview and commit ==")
tid5 = make("single_elimination", "Shutter Cup")
ms = matches_of(tid5)
# play round 1 and round 2 so a round-1 edit has dependents
plays = [("Round 1, match 1", 2, 0), ("Round 1, match 2", 2, 1), ("Round 1, match 3", 2, 0), ("Round 1, match 4", 0, 2),
         ("Round 2, match 1", 2, 1), ("Round 2, match 2", 1, 2)]
for label, u, l in plays:
    m = matches_of(tid5)[label]
    api("POST", f"/api/matches/{m['id']}/result", {"upper_games": u, "lower_games": l, "version": m["version"]}, cookie=org_ck, expect=200)
ms = matches_of(tid5)
edited = ms["Round 1, match 1"]  # Ana beat Hal; Ana advanced to R2M1 and won R2M1
check("r2m1 played", ms["Round 2, match 1"]["state"] == "confirmed")
# preview an edit that flips the winner (Hal wins 0-2)
r = api("POST", f"/api/matches/{edited['id']}/edit-preview", {"upper_games": 0, "lower_games": 2, "version": edited["version"]}, cookie=org_ck, expect=200)
check("preview returns dependents", len(r["body"]["dependents"]) >= 1, str(r["body"])[:300])
check("preview count matches", r["body"]["count"] == len(r["body"]["dependents"]))
check("preview confirmed count", r["body"]["confirmed_count"] == sum(1 for d in r["body"]["dependents"] if d["state"] in ("confirmed", "resolved")))
check("preview token", len(r["body"]["preview_token"]) > 10)
expected_labels = {"Round 2, match 1", "Round 3, match 1"}
check("dependent set is the feed path", {d["label"] for d in r["body"]["dependents"]} == expected_labels, str([d["label"] for d in r["body"]["dependents"]]))
# preview changes nothing
ms_after = matches_of(tid5)
check("preview changed nothing", ms_after["Round 2, match 1"]["state"] == "confirmed" and ms_after["Round 2, match 1"]["upper"]["name"] == "Ana")
# commit with a stale token (simulate changed bracket): first make a change that bumps a dependent's version
r2m2 = ms["Round 2, match 2"]
# same-winner edits commit with an empty dependent set
r = api("POST", f"/api/matches/{r2m2['id']}/edit-preview", {"upper_games": 1, "lower_games": 2, "version": r2m2["version"]}, cookie=org_ck, expect=200)
same_winner_token = r["body"]["preview_token"]
check("same-winner edit has empty set", r["body"]["count"] == 0, str(r["body"])[:200])
r = api("POST", f"/api/matches/{r2m2['id']}/edit", {"upper_games": 1, "lower_games": 2, "preview_token": same_winner_token}, cookie=org_ck, expect=200)
check("same-winner edit commit", r["body"]["match"]["upper_games"] == 1)
# stale preview: preview, change a member of the set, then commit the stale token
r = api("POST", f"/api/matches/{edited['id']}/edit-preview", {"upper_games": 0, "lower_games": 2, "version": edited["version"]}, cookie=org_ck, expect=200)
stale_token = r["body"]["preview_token"]
r2m1v = matches_of(tid5)["Round 2, match 1"]
r = api("POST", f"/api/matches/{r2m1v['id']}/edit-preview", {"upper_games": 3, "lower_games": 1, "version": r2m1v["version"]}, cookie=org_ck, expect=200)
r = api("POST", f"/api/matches/{r2m1v['id']}/edit", {"upper_games": 3, "lower_games": 1, "preview_token": r["body"]["preview_token"]}, cookie=org_ck, expect=200)
check("set member edited", r["body"]["match"]["upper_games"] == 3)
r = api("POST", f"/api/matches/{edited['id']}/edit", {"upper_games": 0, "lower_games": 2, "preview_token": stale_token}, cookie=org_ck, expect=409)
check("stale preview refused", r["body"].get("message") == "The bracket changed since this preview. Review the edit again.", str(r["body"])[:300])
# fresh preview then commit: resets exactly the previewed set
r = api("POST", f"/api/matches/{edited['id']}/edit-preview", {"upper_games": 0, "lower_games": 2, "version": matches_of(tid5)['Round 1, match 1']['version']}, cookie=org_ck, expect=200)
token = r["body"]["preview_token"]
preview_ids = [d["match_id"] for d in r["body"]["dependents"]]
r = api("POST", f"/api/matches/{edited['id']}/edit", {"upper_games": 0, "lower_games": 2, "preview_token": token}, cookie=org_ck, expect=200)
check("edit returns reset ids", sorted(r["body"]["reset"]) == sorted(preview_ids), f"{r['body']['reset']} vs {preview_ids}")
check("edited winner flipped", r["body"]["match"]["winner"] == "lower")
ms = matches_of(tid5)
check("R2M1 reset to pending", ms["Round 2, match 1"]["state"] == "pending")
check("R2M1 slot now holds the new winner", ms["Round 2, match 1"]["upper"]["name"] == "Hal", str(ms["Round 2, match 1"]["upper"]))
check("final reset too", ms["Round 3, match 1"]["state"] == "pending")
check("edit only confirmed results", True)
# editing a pending match is refused
pending = ms["Round 2, match 1"]
r = api("POST", f"/api/matches/{pending['id']}/edit-preview", {"upper_games": 2, "lower_games": 0, "version": pending["version"]}, cookie=org_ck, expect=409)
check("edit only confirmed", r["body"]["message"] == "Only confirmed or resolved results can be edited.")

print("== live channel ==")
import socket
def ws_connect(path, cookie=None):
    import base64, os
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:4173\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n")
    if cookie:
        req += f"Cookie: {cookie}\r\n"
    req += "\r\n"
    s = socket.create_connection(("127.0.0.1", 4173), timeout=5)
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("connection closed during handshake")
        buf += chunk
    status = buf.split(b"\r\n")[0].decode()
    if "101" not in status:
        raise RuntimeError(f"handshake failed: {status}")
    return s

def ws_read(s, timeout=3):
    """Read complete text frames (server frames are unmasked)."""
    s.settimeout(timeout)
    frames = []
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
        except socket.timeout:
            break
        # parse as many complete frames as available
        i = 0
        while i + 2 <= len(buf):
            ln = buf[i+1] & 0x7F
            if ln == 126:
                if i + 4 > len(buf):
                    break
                ln = int.from_bytes(buf[i+2:i+4], "big")
                hdr = 4
            elif ln == 127:
                if i + 10 > len(buf):
                    break
                ln = int.from_bytes(buf[i+2:i+10], "big")
                hdr = 10
            else:
                hdr = 2
            if i + hdr + ln > len(buf):
                break
            payload = buf[i+hdr:i+hdr+ln]
            frames.append(json.loads(payload.decode()))
            i += hdr + ln
        if i > 0:
            buf = buf[i:]
        # drain fully: keep reading until a quiet period passes
        if frames:
            time.sleep(0.3)
            s.settimeout(0.3)
            try:
                while True:
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
                    j = 0
                    while j + 2 <= len(buf):
                        ln = buf[j+1] & 0x7F
                        if ln == 126:
                            if j + 4 > len(buf): break
                            ln = int.from_bytes(buf[j+2:j+4], "big")
                            hdr = 4
                        elif ln == 127:
                            if j + 10 > len(buf): break
                            ln = int.from_bytes(buf[j+2:j+10], "big")
                            hdr = 10
                        else:
                            hdr = 2
                        if j + hdr + ln > len(buf): break
                        frames.append(json.loads(buf[j+hdr:j+hdr+ln].decode()))
                        j += hdr + ln
                    if j > 0:
                        buf = buf[j:]
            except socket.timeout:
                pass
            return frames
    return frames

tid6 = make("single_elimination", "Live Cup", n=8)
s = ws_connect(f"/api/tournaments/{tid6}/live", org_ck)
# send a result, expect a match.updated message
m = matches_of(tid6)["Round 1, match 1"]
api("POST", f"/api/matches/{m['id']}/result", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=org_ck, expect=200)
msgs = ws_read(s)
check("live message received", msgs is not None and len(msgs) >= 1, str(msgs)[:200])
if msgs:
    types = [mm["type"] for mm in msgs]
    check("live has match.updated", "match.updated" in types, str(types))
    check("live message has seq", all("seq" in mm and "at" in mm for mm in msgs))
    seqs = [mm["seq"] for mm in msgs]
    # frames arrive in order; the parser may over-read a batch boundary, so dedupe
    unique = []
    for x in seqs:
        if x not in unique:
            unique.append(x)
    check("live seq strictly increasing", unique == sorted(unique), str(seqs))
s.close()

# catch-up with after=<seq>
tid7 = make("single_elimination", "Catchup Cup")
m = matches_of(tid7)["Round 1, match 1"]
api("POST", f"/api/matches/{m['id']}/result", {"upper_games": 2, "lower_games": 0, "version": m["version"]}, cookie=org_ck, expect=200)
m2 = matches_of(tid7)["Round 1, match 2"]
api("POST", f"/api/matches/{m2['id']}/result", {"upper_games": 1, "lower_games": 2, "version": m2["version"]}, cookie=org_ck, expect=200)
# connect with after=0: replay everything from seq 1
s = ws_connect(f"/api/tournaments/{tid7}/live?after=0", org_ck)
msgs = ws_read(s)
check("catch-up replays", msgs is not None and len(msgs) >= 2, str(len(msgs) if msgs else None) + " " + str([m["seq"] for m in (msgs or [])]))
if msgs:
    check("replay starts at seq 1", msgs[0]["seq"] == 1, str(msgs[0]["seq"]))
    check("replay in order", [mm["seq"] for mm in msgs] == list(range(msgs[0]["seq"], msgs[0]["seq"] + len(msgs))))
s.close()

# share socket gets the public shape
t = api("GET", f"/api/tournaments/{tid7}", cookie=org_ck, expect=200)["body"]["tournament"]
code = t["share_url"].split("/s/")[1]
s = ws_connect(f"/api/tournaments/{tid7}/live?share={code}")
m3 = matches_of(tid7)["Round 1, match 3"]
api("POST", f"/api/matches/{m3['id']}/result", {"upper_games": 2, "lower_games": 1, "version": m3["version"]}, cookie=org_ck, expect=200)
msgs = ws_read(s)
check("share socket receives", msgs is not None, str(msgs)[:200])
if msgs:
    mu = next((mm for mm in msgs if mm["type"] == "match.updated"), None)
    check("share socket public shape", mu is not None and "updated_by" not in mu["data"]["match"], str(mu)[:200])
    check("share tournament has no share_url", all("share_url" not in (mm["data"].get("tournament") or {}) for mm in msgs if mm["type"] == "tournament.updated"))
s.close()

# share link replaced: old socket closed with 4404
r = api("POST", f"/api/tournaments/{tid7}/share/rotate", {}, cookie=org_ck, expect=200)
time.sleep(0.5)
check("rotated share url", r["body"]["share_url"].endswith("/s/" + r["body"]["share_url"].split("/s/")[1]))
old_code = code
r = api("GET", f"/api/share/{old_code}", expect=404)
check("old share dead", r["body"]["message"] == "This link no longer works.")

print("== grading seed with steps ==")
suffix = rname("g")
users = [{"username": n + suffix, "password": n + "-pass-1"} for n in ["dana", "eve", "ana", "ben", "cai", "dov", "eli", "fen", "gus", "hal"]]
seed = {
  "users": users,
  "tournaments": [{
    "key": "cup", "name": "Back Room Cup", "format": "single_elimination", "organizer": "dana" + suffix,
    "co_organizers": ["eve" + suffix], "time_zone": "Europe/Lisbon", "fill": "lemon", "state": "running",
    "checkin_closes_at": "2026-11-04T19:30:00.000Z",
    "entrants": [{"name": nm, "seed": i + 1, "username": nm + suffix} for i, nm in enumerate(["Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal"])],
    "steps": [
      {"match": "Round 1, match 1", "action": "confirmed", "upper_games": 2, "lower_games": 1, "by": "Ana"},
      {"match": "Round 1, match 2", "action": "confirmed", "upper_games": 2, "lower_games": 0, "by": "Dov"},
      {"match": "Round 1, match 3", "action": "confirmed", "upper_games": 2, "lower_games": 1, "by": "Ben"},
      {"match": "Round 1, match 4", "action": "confirmed", "upper_games": 2, "lower_games": 0, "by": "Cai"},
      {"match": "Round 2, match 1", "action": "reported", "upper_games": 2, "lower_games": 0, "by": "Ana"},
      {"match": "Round 2, match 2", "action": "disputed", "upper_games": 2, "lower_games": 0, "by": "Ben", "counter": {"upper_games": 0, "lower_games": 2}},
      {"match": "Round 2, match 2", "action": "resolved", "upper_games": 2, "lower_games": 1, "resolver": "eve" + suffix},
    ],
  }],
}
r = api("POST", "/api/grading/seed", seed, expect=201)
check("grading seed ok", "tournaments" in r["body"], str(r["body"])[:300])
if "tournaments" in r["body"]:
    cup = r["body"]["tournaments"]["cup"]
    check("grading returns ids", len(cup["id"]) > 5)
    check("grading share code", len(cup["share_code"]) == 22)
    check("grading entrant map", cup["entrants"]["Ana"] and len(cup["entrants"]) == 8)
    check("grading match map", "Round 1, match 1" in cup["matches"])
    # verify the dispute got resolved by eve
    mid = cup["matches"]["Round 2, match 2"]
    rs = api("POST", "/api/grading/session", {"username": "dana" + suffix}, expect=200)
    danack = rs["set_cookie"].split(";")[0]
    rr = api("GET", f"/api/tournaments/{cup['id']}/matches", cookie=danack, expect=200)
    m = next((x for x in rr["body"]["matches"] if x["id"] == mid), None)
    check("grading resolved state", m is not None and m["state"] == "resolved", str(m)[:200])
    check("grading resolver updated_by", m is not None and m["updated_by"] == "eve" + suffix, str(m.get("updated_by")))

# grading session
r = api("POST", "/api/grading/session", {"username": "dana" + suffix}, expect=200)
check("grading session", r["body"]["user"]["username"] == "dana" + suffix)
check("grading session cookie", r["set_cookie"] is not None)
r = api("POST", "/api/grading/session", {"username": "nosuchuser"}, expect=404)

# grading clock bounds
r = api("POST", "/api/grading/clock", {"advance_ms": -1}, expect=422)
r = api("POST", "/api/grading/clock", {"advance_ms": 604800001}, expect=422)
r = api("POST", "/api/grading/clock", {"advance_ms": 0}, expect=200)

print(f"\n=== {PASSED} passed, {len(FAILED)} failed ===")
for f in FAILED:
    print("FAIL:", f)
sys.exit(1 if FAILED else 0)
