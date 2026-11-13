#!/usr/bin/env python3
"""End-to-end API test for Cupfold against a running server on :4173."""
import json, random, string, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:4173"
FAILED = []
PASSED = 0

def api(method, path, body=None, cookie=None, expect=None):
    global PASSED
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        resp = urllib.request.urlopen(req)
        status = resp.status
        text = resp.read()
        setc = resp.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        status = e.code
        text = e.read()
        setc = None
    except Exception as e:
        status = 0
        text = str(e).encode()
        setc = None
    if expect is not None:
        if status == expect:
            PASSED += 1
        else:
            FAILED.append(f"{method} {path} -> {status}, expected {expect}: {text[:200]}")
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
    return prefix + "".join(random.choices(string.ascii_lowercase, k=7))

print("== auth ==")
u1, u2 = rname("org"), rname("co")
api("POST", "/api/auth/signup", {"username": u1, "password": "password-1"}, expect=201)
api("POST", "/api/auth/signup", {"username": u2, "password": "password-1"}, expect=201)
r = api("POST", "/api/auth/signup", {"username": u1, "password": "password-2"}, expect=409)
r = api("POST", "/api/auth/signup", {"username": "x", "password": "password-1"}, expect=422)
check("signup validation message", r["body"].get("fields", {}).get("username") == "Use 3 to 24 characters: a-z, 0-9 or _.")
r = api("POST", "/api/auth/signin", {"username": u1, "password": "wrong-pass-1"}, expect=401)
check("bad credentials message", r["body"]["message"] == "Username or password is wrong.")
r = api("POST", "/api/auth/signin", {"username": u1, "password": "password-1"}, expect=200)
cookie1 = r["set_cookie"].split(";")[0]
r = api("GET", "/api/me", cookie=cookie1, expect=200)
check("me username", r["body"]["user"]["username"] == u1)
r = api("GET", "/api/me", expect=401)
check("unauthenticated message", r["body"]["message"] == "Sign in to continue.")

print("== login rate limit (10 per 60s) ==")
limited = False
for i in range(12):
    r = api("POST", "/api/auth/signin", {"username": "nobody", "password": "wrongwrong"})
    if r["status"] == 429:
        limited = True
        check("rate limited message", "Too many sign-in attempts." in r["body"]["message"])
        break
check("sign-in rate limit hits 429", limited)
r = api("POST", "/api/auth/signin", {"username": u2, "password": "password-1"}, expect=200)
cookie2 = r["set_cookie"].split(";")[0]

print("== tournament creation ==")
r = api("POST", "/api/tournaments", {"name": "Test Cup", "format": "bad_format", "time_zone": "UTC", "fill": "lilac"}, cookie=cookie1, expect=422)
check("format validation", r["body"]["fields"].get("format") == "Choose a format.")
r = api("POST", "/api/tournaments", {"name": "Back Room Cup", "format": "single_elimination", "time_zone": "Europe/Lisbon", "fill": "lemon"}, cookie=cookie1, expect=201)
tid = r["body"]["tournament"]["id"]
check("tournament state draft", r["body"]["tournament"]["state"] == "draft")
check("my_role organizer", r["body"]["tournament"]["my_role"] == "organizer")
share_code = r["body"]["tournament"]["share_url"].split("/s/")[1]
check("share code 22 chars", len(share_code) == 22)

print("== draft visibility (404 for non-organizers) ==")
r = api("GET", f"/api/tournaments/{tid}", cookie=cookie2, expect=404)
check("draft hidden from other user", r["body"]["message"] == "We couldn't find that tournament.")
r = api("GET", f"/api/tournaments/{tid}", expect=401)

print("== co-organizers ==")
r = api("POST", f"/api/tournaments/{tid}/co-organizers", {"username": u2}, cookie=cookie1, expect=201)
check("co added", u2 in r["body"]["co_organizers"])
r = api("POST", f"/api/tournaments/{tid}/co-organizers", {"username": u2}, cookie=cookie1, expect=422)
check("repeat co message", "is already a co-organizer." in r["body"]["fields"]["username"])
r = api("POST", f"/api/tournaments/{tid}/co-organizers", {"username": u1}, cookie=cookie1, expect=422)
check("organizer as co message", r["body"]["fields"]["username"] == "You already organize this tournament.")
r = api("POST", f"/api/tournaments/{tid}/co-organizers", {"username": "ghost_user"}, cookie=cookie1, expect=422)
check("no account message", "No account named @ghost_user." == r["body"]["fields"]["username"])
r = api("POST", f"/api/tournaments/{tid}/co-organizers", {"username": u2}, cookie=cookie2, expect=403)
check("co cannot manage co", r["body"]["message"] == "Only the organizer can do this.")
r = api("GET", f"/api/tournaments/{tid}", cookie=cookie2, expect=200)
check("co sees draft", r["body"]["tournament"]["my_role"] == "co_organizer")

print("== entrants ==")
for n in ["Ana", "Ben", "Cai", "Dov", "Eli", "Fen"]:
    api("POST", f"/api/tournaments/{tid}/entrants", {"name": n}, cookie=cookie1, expect=201)
r = api("POST", f"/api/tournaments/{tid}/entrants", {"name": "ana"}, cookie=cookie1, expect=422)
check("duplicate entrant message", r["body"]["fields"]["name"] == "That name is already in the field.")
r = api("GET", f"/api/tournaments/{tid}/entrants", cookie=cookie1, expect=200)
check("6 entrants", len(r["body"]["entrants"]) == 6)

print("== seeding and round 1 preview ==")
r = api("GET", f"/api/tournaments/{tid}/preview", cookie=cookie1, expect=200)
m = r["body"]["matches"]
check("preview match 1 (seed 1 bye)", m[0]["upper"] == "Ana" and m[0]["lower"] is None)
check("preview match 2 (4v5)", m[1]["upper"] == "Dov" and m[1]["lower"] == "Eli")
check("preview match 3 (seed 2 bye)", m[2]["upper"] == "Ben" and m[2]["lower"] is None)
check("preview match 4 (3v6)", m[3]["upper"] == "Cai" and m[3]["lower"] == "Fen")
entrants = api("GET", f"/api/tournaments/{tid}/entrants", cookie=cookie1)["body"]["entrants"]
sv = api("GET", f"/api/tournaments/{tid}", cookie=cookie1)["body"]["tournament"]["seeding_version"]
order = [e["id"] for e in entrants]
new_order = [order[1], order[2], order[0]] + order[3:]
r = api("PUT", f"/api/tournaments/{tid}/seeding", {"order": new_order, "seeding_version": sv}, cookie=cookie1, expect=200)
check("seeding version bumps", r["body"]["seeding_version"] == sv + 1)
r = api("PUT", f"/api/tournaments/{tid}/seeding", {"order": new_order, "seeding_version": sv}, cookie=cookie1, expect=409)
check("stale seeding message", r["body"]["message"].startswith("The seeding was changed by"))

print("== roster upload ==")
def upload_roster(tid, cookie, text, fname="field.cupfold.txt"):
    boundary = "----boundary" + "".join(random.choices(string.ascii_letters, k=8))
    body = f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\nContent-Type: text/plain\r\n\r\n{text}\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + f"/api/tournaments/{tid}/roster", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Cookie", cookie)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

st, body = upload_roster(tid, cookie1, "1 | A @nosuchuser\n2 | B\n")
check("roster unknown account 422", st == 422, f"{st} {body[:200]}")
check("roster invalid headline", json.loads(body)["message"] == "The roster was not added. Fix these lines and upload again.")
check("roster line error", json.loads(body)["errors"][0] == "Line 1: no account named @nosuchuser")

usernames = {}
for n in ["ana", "ben", "cai"]:
    un = rname(n)
    api("POST", "/api/auth/signup", {"username": un, "password": "password-1"})
    usernames[n] = un
roster_text = f"# Back room cup\n1 | Ana @{usernames['ana']}\n2 | Ben @{usernames['ben']}\nCai @{usernames['cai']}\nDov\nEli\nFen\n"
st, body = upload_roster(tid, cookie1, roster_text)
check("roster upload 201", st == 201, f"{st} {body[:300]}")
d = json.loads(body)
check("roster sha256", len(d["sha256"]) == 64)
check("roster file name", d["file_name"] == "field.cupfold.txt")

req = urllib.request.Request(BASE + f"/api/tournaments/{tid}/roster")
req.add_header("Cookie", cookie1)
resp = urllib.request.urlopen(req)
downloaded = resp.read()
check("roster download byte for byte", downloaded == roster_text.encode())
check("roster content type", resp.headers.get("Content-Type") == "text/plain; charset=utf-8")
check("roster disposition", resp.headers.get("Content-Disposition") == 'attachment; filename="field.cupfold.txt"')
r = api("GET", f"/api/tournaments/{tid}/entrants", cookie=cookie1, expect=200)
check("roster replaced field", len(r["body"]["entrants"]) == 6)
check("roster linked username", r["body"]["entrants"][0]["username"] == usernames["ana"])

st, body = upload_roster(tid, cookie1, "1 | A\n2 | A\nbadseed | B\n")
check("dup name error", st == 422 and "Line 2: duplicate name \"A\" (first on line 1)" in json.loads(body)["errors"])
st, body = upload_roster(tid, cookie1, "x | A\n2 | B\n")
check("bad seed error", st == 422 and "Line 1: seed must be a whole number from 1 to 128" in json.loads(body)["errors"])
st, body = upload_roster(tid, cookie1, "", fname="f.cupfold.txt")
check("empty roster", st == 422 and json.loads(body)["message"] == "The roster file is empty.")
st, body = upload_roster(tid, cookie1, "1 | A\n2 | B\n", fname="f.txt")
check("bad extension", st == 422 and json.loads(body)["message"] == "Roster files end in .cupfold.txt.")
print("== roster per-line errors (fresh tournament) ==")
r = api("POST", "/api/tournaments", {"name": "Roster Errors Cup", "format": "single_elimination", "time_zone": "UTC", "fill": "mint"}, cookie=cookie1, expect=201)
tid2 = r["body"]["tournament"]["id"]
st, body = upload_roster(tid2, cookie1, "1 | A\n")
check("too few entrants", st == 422 and json.loads(body)["errors"][0] == "The roster has 1 entrants. A roster needs 2 to 128.", f"{st} {body[:300]}")
st, body = upload_roster(tid2, cookie1, "x | A\n2 | B\n")
check("bad seed error", st == 422 and "Line 1: seed must be a whole number from 1 to 128" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "1 | A\n2 | A\n")
check("dup name error 2", st == 422 and "Line 2: duplicate name \"A\" (first on line 1)" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "1 | A\n1 | B\n")
check("dup seed error", st == 422 and "Line 2: seed 1 is already used on line 1" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "5 | A\n1 | B\n")
check("seed too large", st == 422 and "Line 1: seed 5 is larger than the number of entrants (2)" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "1 | \n2 | B\n")
check("empty name", st == 422 and "Line 1: name is empty" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "1 | " + "x"*41 + "\n2 | B\n")
check("long name", st == 422 and "Line 1: name is longer than 40 characters" in json.loads(body)["errors"])
st, body = upload_roster(tid2, cookie1, "1 | A @ghostuser\n2 | B\n")
check("no account line", st == 422 and "Line 1: no account named @ghostuser" in json.loads(body)["errors"])

print("== check-in lifecycle ==")
r = api("POST", f"/api/tournaments/{tid}/checkin/open", {}, cookie=cookie1, expect=200)
check("checkin open", r["body"]["tournament"]["state"] == "checkin_open")
check("checkin closes default", r["body"]["tournament"]["checkin_closes_at"] is not None)
r = api("POST", f"/api/tournaments/{tid}/checkin/open", {}, cookie=cookie1, expect=409)
check("checkin already open", r["body"]["message"] == "Check-in is already open.")
r = api("POST", f"/api/tournaments/{tid}/checkin/close", {}, cookie=cookie1, expect=200)
check("checkin closed", r["body"]["tournament"]["state"] == "checkin_closed")
r = api("POST", f"/api/tournaments/{tid}/checkin", {}, cookie=cookie1, expect=409)
check("checkin after close", r["body"]["message"] == "Check-in is closed.")
r = api("POST", f"/api/tournaments/{tid}/draft", {}, cookie=cookie1, expect=200)
check("back to draft", r["body"]["tournament"]["state"] == "draft")
r = api("GET", f"/api/tournaments/{tid}/entrants", cookie=cookie1)
check("checkins cleared", all(e["checked_in"] is False for e in r["body"]["entrants"]))
r = api("POST", f"/api/tournaments/{tid}/draft", {}, cookie=cookie1, expect=409)
check("already draft", r["body"]["message"] == "The tournament is already a draft.")

print("== start from draft with 6 ==")
r = api("POST", f"/api/tournaments/{tid}/start", {}, cookie=cookie1, expect=200)
check("started", r["body"]["tournament"]["state"] == "running")
check("no removed from draft start", r["body"]["removed"] == [])
r = api("GET", f"/api/tournaments/{tid}/matches", cookie=cookie1, expect=200)
matches = r["body"]["matches"]
check("match count 7", len(matches) == 7, f"got {len(matches)}")
by_label = {m["label"]: m for m in matches}
check("bye card name", by_label["Round 1, match 1"]["upper"]["name"] == "Ana" and by_label["Round 1, match 1"]["lower"] == {"bye": True})
check("bye state", by_label["Round 1, match 1"]["state"] == "bye")
check("r2 m1 has Ana", by_label["Round 2, match 1"]["upper"]["name"] == "Ana")
check("r2 m2 has Ben", by_label["Round 2, match 2"]["upper"]["name"] == "Ben")
check("round 3 pending", by_label["Round 3, match 1"]["state"] == "pending")

print("== match writes and lifecycle errors ==")
m1 = by_label["Round 1, match 1"]
r = api("POST", f"/api/matches/{m1['id']}/report", {"upper_games": 2, "lower_games": 1, "version": m1["version"]}, cookie=cookie1, expect=409)
check("bye not ready", r["body"]["message"] == "This match is not ready to play.")
m2 = by_label["Round 1, match 2"]
r = api("POST", f"/api/matches/{m2['id']}/report", {"upper_games": 2, "lower_games": 2, "version": m2["version"]}, cookie=cookie1, expect=422)
check("elimination draw refused", r["body"]["message"] == "Elimination matches need a winner.")
r = api("POST", f"/api/matches/{m2['id']}/report", {"upper_games": 0, "lower_games": 0, "version": m2["version"]}, cookie=cookie1, expect=422)
check("zero games refused", r["body"]["message"] == "A score needs at least one game.")
r = api("POST", f"/api/matches/{m2['id']}/report", {"upper_games": 2, "lower_games": 1, "version": 99}, cookie=cookie1, expect=409)
check("stale match", r["body"]["message"].startswith("This match was updated by") and "Current score: not played." in r["body"]["message"])
check("stale match carries match", r["body"]["match"]["id"] == m2["id"])
r = api("POST", f"/api/matches/{m2['id']}/call", {"version": m2["version"]}, cookie=cookie1, expect=200)
check("called state", r["body"]["match"]["state"] == "called")
v = r["body"]["match"]["version"]
r = api("POST", f"/api/matches/{m2['id']}/result", {"upper_games": 2, "lower_games": 0, "version": v}, cookie=cookie1, expect=200)
check("organizer save result", r["body"]["match"]["state"] == "confirmed")
check("updated_by organizer", r["body"]["match"]["updated_by"] == u1)
m3 = by_label["Round 1, match 4"]
r = api("POST", f"/api/matches/{m3['id']}/result", {"upper_games": 2, "lower_games": 0, "version": m3["version"]}, cookie=cookie1, expect=200)
# Ana won R1 bye -> R2 m1 upper = Ana; Ben -> R2 m2 upper
r = api("GET", f"/api/tournaments/{tid}/matches", cookie=cookie1)
by_label = {m["label"]: m for m in r["body"]["matches"]}
check("winner advanced to R2m1", by_label["Round 2, match 1"]["lower"]["name"] == "Dov")
check("winner advanced to R2m2", by_label["Round 2, match 2"]["lower"]["name"] == "Cai")

print(f"\n=== {PASSED} passed, {len(FAILED)} failed ===")
for f in FAILED:
    print("FAIL:", f)
sys.exit(1 if FAILED else 0)
