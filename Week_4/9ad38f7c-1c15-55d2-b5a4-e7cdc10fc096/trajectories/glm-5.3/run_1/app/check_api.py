"""End-to-end checks against a running instance."""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:4173")
PASSWORD = "deku-demo-pw-2026"
passed = 0
failed = 0


def request(method, path, body=None, token=None, headers=None, raw_body=None,
            content_type="application/json"):
    url = BASE + path
    data = None
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None or raw_body is not None:
        req.add_header("Content-Type", content_type)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            payload = response.read()
            return response.status, dict(response.headers), payload
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def jrequest(method, path, body=None, token=None, **kwargs):
    status, headers, payload = request(method, path, body, token, **kwargs)
    try:
        data = json.loads(payload) if payload else None
    except Exception:
        data = None
    return status, headers, data


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -- " + str(detail) if detail else ""))


def section(title):
    print(title)


def login(email, password=PASSWORD):
    status, headers, data = jrequest("POST", "/api/auth/login",
                                     {"email": email, "password": password})
    return data["token"] if status == 200 and data else None


def signup(email, display_name="Test Player", password=PASSWORD):
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     {"email": email, "display_name": display_name,
                                      "password": password})
    return status, (data or {}).get("token")


def main():
    section("health and event")
    status, headers, data = jrequest("GET", "/api/health")
    check("health 200 ok", status == 200 and data == {"status": "ok"}, data)
    status, headers, data = jrequest("GET", "/api/event")
    check("event fields", status == 200 and data["start"] == "2026-10-22T16:00:00Z"
          and data["certificate_enabled"] is True and "server_time" in data, data)
    status, headers, payload = request("GET", "/api/event/calendar.ics")
    text = payload.decode()
    check("calendar CRLF", "\r\n" in text and not text.endswith("\n") or
          text.endswith("\r\n"), repr(text[-4:]))
    check("calendar fields", "DTSTART:20261022T160000Z" in text and
          "DTEND:20261026T235900Z" in text and "BEGIN:VEVENT" in text and
          "VERSION:2.0" in text and "PRODID" in text, text[:200])
    check("calendar content type", "text/calendar" in headers.get("Content-Type", ""),
          headers.get("Content-Type"))

    section("scenarios")
    status, headers, data = jrequest("GET", "/api/scenarios")
    check("eight scenarios", status == 200 and len(data["scenarios"]) == 8)
    slugs = [s["slug"] for s in data["scenarios"]]
    check("scenario order", slugs[0] == "repossessed" and slugs[-1] == "dead-endpoint")
    check("no flag leaked", all("flag_sha256" not in s and "flag" not in s
                                for s in data["scenarios"]))
    status, headers, data = jrequest("GET", "/api/scenarios/repossessed")
    check("scenario detail booleans false", status == 200 and
          data["team_solved"] is False and data["solved_by_me"] is False)
    status, headers, data = jrequest("GET", "/api/scenarios/%00bad")
    check("NUL slug 404 unknown_scenario", status == 404 and
          data["error"] == "unknown_scenario", (status, data))
    status, headers, data = jrequest("GET", "/api/scenarios/" + "x" * 65)
    check("long slug 404", status == 404 and data["error"] == "unknown_scenario")
    status, headers, data = jrequest("GET", "/api/scenarios/" +
                                     urllib.parse.quote("ünknown"))
    check("non-ascii slug 404", status == 404 and data["error"] == "unknown_scenario")

    section("published surface")
    status, headers, data = jrequest("GET", "/api/nope")
    check("unknown api 404 json", status == 404 and data == {"error": "not_found"},
          (status, data))
    status, headers, data = jrequest("DELETE", "/api/scenarios")
    check("405 with Allow", status == 405 and data == {"error": "method_not_allowed"}
          and "GET" in headers.get("Allow", ""), (status, headers.get("Allow")))
    status, headers, data = jrequest("GET", "/api/teams/join")
    check("GET join 405 Allow POST", status == 405 and "POST" in headers.get("Allow", ""))
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b"{}", content_type="text/plain")
    check("wrong content type 415", status == 415 and
          data == {"error": "unsupported_media_type"}, (status, data))
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b"x" * 20000)
    check("oversized body 413", status == 413 and data == {"error": "payload_too_large"})
    status, headers, data = jrequest("POST", "/api/auth/signup", raw_body=b"{")
    check("invalid json 400", status == 400 and data == {"error": "invalid_json"})
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b'{"email":"a@b.co","email":"c@d.co"}')
    check("duplicate keys 400", status == 400 and data == {"error": "invalid_json"})
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b'{"email":"\\ud800"}')
    check("lone surrogate 400", status == 400 and data == {"error": "invalid_json"})
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b'{"email":NaN}')
    check("NaN 400", status == 400 and data == {"error": "invalid_json"})
    deep = "[" * 40 + "]" * 40
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=('{"a":' + deep + "}").encode())
    check("deep nesting 400", status == 400 and data == {"error": "invalid_json"})
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b'[]')
    check("non-object top level 400", status == 400 and data == {"error": "invalid_json"})
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     raw_body=b'\xff\xfe')
    check("invalid utf-8 400", status == 400 and data == {"error": "invalid_json"})

    section("accounts")
    email = "race-%d@example.com" % int(time.time())
    results = []
    def try_signup(case_email, name):
        status, _, data = jrequest("POST", "/api/auth/signup",
                                   {"email": case_email, "display_name": name,
                                    "password": PASSWORD})
        results.append((status, (data or {}).get("error")))
    threads = [
        threading.Thread(target=try_signup, args=(email.upper(), "Alpha Tab")),
        threading.Thread(target=try_signup, args=("  " + email + "  ", "Beta Tab")),
    ]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    statuses = sorted(status for status, _ in results)
    check("simultaneous signup one 201 one 409", statuses == [201, 409], results)
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                    {"email": email, "display_name": "Gamma",
                                     "password": PASSWORD})
    check("taken email 409 email_taken", status == 409 and
          data["error"] == "email_taken", (status, data))
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     {"email": "not-an-email", "display_name": "X",
                                      "password": PASSWORD})
    check("bad email 400 validation", status == 400 and
          data["error"] == "validation" and "email" in data["fields"], data)
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     {"email": "ok@example.com", "display_name": "a\u200eb",
                                      "password": PASSWORD})
    check("direction char refused", status == 400 and
          "display_name" in data["fields"], data)
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                    {"email": "ok2@example.com", "display_name": "",
                                     "password": PASSWORD})
    check("blank display name 400", status == 400 and
          "display_name" in data["fields"])
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     {"email": "ok3@example.com", "display_name": "x",
                                      "password": "short"})
    check("short password 400", status == 400 and "password" in data["fields"])
    emoji_email = "emoji%d@example.com" % int(time.time())
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                    {"email": emoji_email, "display_name": "🦇 Bat",
                                     "password": PASSWORD})
    check("emoji display name ok", status == 201, (status, data))
    emoji_token = data["token"]
    status, headers, data = jrequest("GET", "/api/me", token=emoji_token)
    check("emoji display name stored", status == 200 and
          data["user"]["display_name"] == "🦇 Bat", data)

    section("sign in and throttle")
    status, headers, data = jrequest("POST", "/api/auth/login",
                                     {"email": "unknown@example.com", "password": "nope"})
    check("unknown email 401 invalid_credentials", status == 401 and
          data == {"error": "invalid_credentials"}, (status, data))
    lock_email = "lock-%d@example.com" % int(time.time())
    for index in range(10):
        status, headers, data = jrequest("POST", "/api/auth/login",
                                         {"email": lock_email, "password": "wrong"})
        if index < 9:
            check("attempt %d gives 401" % (index + 1), status == 401)
    check("tenth attempt 401 or 429", status in (401, 429), status)
    status, headers, data = jrequest("POST", "/api/auth/login",
                                     {"email": lock_email, "password": "wrong"})
    check("locked 429 too_many_attempts", status == 429 and
          data == {"error": "too_many_attempts"} and
          "Retry-After" in headers, (status, data, headers.get("Retry-After")))
    retry_after = int(headers.get("Retry-After", "0"))
    check("Retry-After bounded", 1 <= retry_after <= 900, retry_after)

    section("me and teams")
    token = login("captain@example.com")
    check("captain login", token is not None)
    teammate = login("teammate@example.com")
    check("teammate login", teammate is not None)
    status, headers, data = jrequest("GET", "/api/me", token=token)
    check("me shape", status == 200 and data["team"]["name"] == "Lantern Watch"
          and data["team"]["is_captain"] is True and "tickets" in data, data)
    check("me has no password fields", "password" not in data["user"])
    status, headers, data = jrequest("GET", "/api/me", token=teammate)
    check("teammate in room", data["team"]["name"] == "Lantern Watch", data)
    status, headers, data = jrequest("GET", "/api/teams/mine", token=token)
    check("team room shape", status == 200 and data["team"]["invite_code"] == "LANTERN1"
          and len(data["members"]) == 2 and data["score"] == 560, data)
    member = data["members"][1]
    check("member fields exact", set(member) == {"user_id", "display_name",
          "joined_at", "is_captain", "tickets"}, member)
    check("members oldest first", data["members"][0]["display_name"] == "Rowan Vale")
    check("room scenarios eight", len(data["scenarios"]) == 8)
    state = [s for s in data["scenarios"] if s["slug"] == "repossessed"][0]
    check("repossessed solved by team", state["team_solved"] is True)
    status, headers, data = jrequest("GET", "/api/me", token=None)
    check("no token 401 unauthenticated", status == 401 and
          data == {"error": "unauthenticated"})

    section("flags")
    solo = login("solo@example.com")
    status, headers, data = jrequest("POST", "/api/scenarios/day-o/flag",
                                    {"flag": "flag{payload_unpacked}"}, token=solo)
    check("teamless flag 409 no_team", status == 409 and
          data == {"error": "no_team"}, (status, data))
    status, headers, data = jrequest("POST", "/api/scenarios/day-o/flag",
                                    {"flag": "   "}, token=solo)
    check("blank flag 400 validation", status == 400 and
          "flag" in data["fields"], (status, data))
    status, headers, data = jrequest("POST", "/api/scenarios/nope/flag",
                                    {"flag": "x"}, token=solo)
    check("unknown scenario flag 404", status == 404 and
          data["error"] == "unknown_scenario")
    status, headers, data = jrequest("POST", "/api/scenarios/day-o/flag",
                                    {"flag": "flag{wrong}"}, token=solo)
    check("wrong flag 200 correct false", status == 200 and
          data["correct"] is False and data["team_points_awarded"] == 0, data)

    # correct flag through a new player in a new team
    email2 = "player-%d@example.com" % int(time.time())
    status, _, data = jrequest("POST", "/api/auth/signup",
                               {"email": email2, "display_name": "Player Two",
                                "password": PASSWORD})
    player2 = data["token"]
    status, _, data = jrequest("POST", "/api/teams", {"name": "Test Crew %d" %
                                                     int(time.time())}, token=player2)
    check("create team 201", status == 201 and data["team"]["captain_id"] and
          len(data["team"]["invite_code"]) == 8, (status, data))
    team2 = data["team"]
    email_dup = "dup-%d@example.com" % int(time.time())
    status, _, dup = jrequest("POST", "/api/auth/signup",
                              {"email": email_dup, "display_name": "Dup Checker",
                               "password": PASSWORD})
    status, _, data = jrequest("POST", "/api/teams", {"name": team2["name"].upper()},
                               token=dup["token"])
    check("case-insensitive name taken", status == 409 and
          data["error"] == "name_taken", (status, data))
    status, _, data = jrequest("POST", "/api/scenarios/day-o/flag",
                               {"flag": "  flag{payload_unpacked}  "}, token=player2)
    check("correct flag awards", status == 200 and data["correct"] is True and
          data["team_points_awarded"] == 90 and data["tickets"] == 1 and
          data["team_score"] == 90, data)
    status, _, data = jrequest("POST", "/api/scenarios/day-o/flag",
                               {"flag": "flag{payload_unpacked}"}, token=player2)
    check("repeat flag already completed", status == 200 and
          data["correct"] is True and data["already_completed"] is True and
          data["team_points_awarded"] == 0, data)

    section("webinar")
    status, _, data = jrequest("POST", "/api/webinar/flag",
                               {"flag": "flag{comfort_zone_exit}"}, token=player2)
    check("webinar claim 200 +2", status == 200 and data["claimed"] is True and
          data["tickets"] == 3, (status, data))
    status, _, data = jrequest("POST", "/api/webinar/flag",
                              {"flag": "flag{comfort_zone_exit}"}, token=player2)
    check("second webinar claim 409", status == 409 and
          data["error"] == "already_claimed")
    status, _, data = jrequest("POST", "/api/webinar/flag",
                               {"flag": "flag{nope}"}, token=solo)
    check("wrong webinar flag 422", status == 422 and data["error"] == "wrong_flag")

    section("leaderboard")
    status, _, data = jrequest("GET", "/api/leaderboard")
    check("board default page", status == 200 and data["page"] == 1 and
          data["limit"] == 5 and data["total"] >= 16 and data["pages"] >= 4, data)
    ranks = [entry["rank"] for entry in data["entries"]]
    check("ranks 1..5", ranks == [1, 2, 3, 4, 5], ranks)
    check("cold ledger first", data["entries"][0]["team_name"] == "Cold Ledger")
    entry = data["entries"][0]
    check("entry fields exact", set(entry) == {"rank", "team_id", "team_name",
          "soc_sim", "th_sim", "tabletop", "challenges_solved", "challenges_total",
          "points"}, entry)
    status, _, data = jrequest("GET", "/api/leaderboard?page=3")
    check("board page 3 ranks 11-15", [e["rank"] for e in data["entries"]] ==
          [11, 12, 13, 14, 15], [e["rank"] for e in data["entries"]])
    check("no email or id leak", all("email" not in e and "invite_code" not in e
                                     for e in data["entries"]))
    status, _, data = jrequest("GET", "/api/leaderboard?page=999")
    check("past the end empty", status == 200 and data["entries"] == [] and
          data["pages"] >= 4)
    status, _, data = jrequest("GET", "/api/leaderboard?page=abc")
    check("malformed page 400", status == 400 and data["error"] == "validation")
    status, _, data = jrequest("GET", "/api/leaderboard?limit=999")
    check("limit capped at 50", data["limit"] == 50)
    status, _, data = jrequest("GET", "/api/leaderboard?include_feed=1")
    check("feed included", data["feed"] and set(data["feed"][0]) ==
          {"team_name", "scenario_title", "points", "created_at"}, data["feed"][:1])
    feed_newest = max(f["created_at"] for f in data["feed"])
    check("feed newest first", data["feed"][0]["created_at"] == feed_newest,
          data["feed"][:2])

    section("captain powers")
    status, _, data = jrequest("POST", "/api/teams/mine/invite-code",
                               {"x": 1}, token=teammate)
    check("non-captain new code 403", status == 403 and
          data == {"error": "not_captain"}, (status, data))
    captain_token = login("captain@example.com")
    status, _, data = jrequest("POST", "/api/teams/mine/members/999999/remove",
                               token=captain_token)
    check("unknown member 404 not_a_member", status == 404 and
          data == {"error": "not_a_member"})
    status, _, data = jrequest("GET", "/api/me", token=teammate)
    teammate_id = data["user"]["id"]
    captain_id = data["team"]["id"] and None
    status, _, data = jrequest("GET", "/api/me", token=captain_token)
    captain_user_id = data["user"]["id"]
    status, _, data = jrequest("POST", "/api/teams/mine/members/%d/remove" %
                               captain_user_id, token=captain_token)
    check("captain remove self 409", status == 409 and
          data == {"error": "captain_cannot_remove_self"})
    status, _, data = jrequest("POST", "/api/teams/mine/members/0abc/remove",
                               token=captain_token)
    check("malformed user id 404", status == 404 and
          data == {"error": "not_a_member"})
    status, _, data = jrequest("POST", "/api/teams/mine/members/%d/remove" %
                               teammate_id, token=captain_token)
    check("captain removes member 204", status == 204, (status, data))
    status, _, data = jrequest("GET", "/api/teams/mine", token=teammate)
    check("removed player teamless 404", status == 404 and
          data == {"error": "not_in_team"}, (status, data))
    status, _, data = jrequest("GET", "/api/me", token=teammate)
    check("removed player keeps tickets", data["team"] is None and
          data["tickets"] == 0)
    status, _, data = jrequest("GET", "/api/teams/mine", token=captain_token)
    check("code rotated after removal", data["team"]["invite_code"] != "LANTERN1",
          data["team"]["invite_code"])
    old_code = "LANTERN1"
    status, _, data = jrequest("POST", "/api/teams/join", {"invite_code": old_code},
                               token=teammate)
    check("old code joins nobody", status == 404 and
          data == {"error": "unknown_invite_code"})

    section("leaving and empties")
    email3 = "leaver-%d@example.com" % int(time.time())
    status, _, data = jrequest("POST", "/api/auth/signup",
                               {"email": email3, "display_name": "Leaver",
                                "password": PASSWORD})
    leaver = data["token"]
    status, _, data = jrequest("POST", "/api/teams", {"name": "Empty Crew %d" %
                                                      int(time.time())}, token=leaver)
    team3 = data["team"]
    status, _, data = jrequest("POST", "/api/teams/leave", token=leaver)
    check("leave 204", status == 204, status)
    status, _, data = jrequest("GET", "/api/teams/mine", token=leaver)
    check("teamless after leave", status == 404)
    status, _, data = jrequest("GET", "/api/leaderboard?limit=50")
    emptied = [e for e in data["entries"] if e["team_name"] == team3["name"]]
    check("emptied team kept on board", len(emptied) == 1, team3["name"])
    status, _, data = jrequest("POST", "/api/teams/join",
                               {"invite_code": team3["invite_code"]}, token=leaver)
    check("emptied team code still works", status == 200 and
          data["team"]["captain_id"] is not None, (status, data))
    status, _, data = jrequest("GET", "/api/me", token=leaver)
    check("first joiner becomes captain", data["team"]["is_captain"] is True)

    section("team cap")
    grey = login("greystatic@example.com")
    check("grey static login", grey is not None)
    status, _, data = jrequest("POST", "/api/teams/leave", token=leaver)
    check("leaver leaves own team first", status == 204, status)
    status, _, data = jrequest("POST", "/api/teams/join",
                               {"invite_code": "greyStat"}, token=leaver)
    check("full team 409 team_full", status == 409 and
          data == {"error": "team_full"}, (status, data))

    section("certificate")
    cold = login("coldledger@example.com")
    status, _, data = jrequest("GET", "/api/me/certificate", token=cold)
    check("cold ledger certificate", status == 200 and
          data["issued_on"] == "2026-10-23T07:30:00Z" and
          data["event_name"] == "Strange & Unusual Activity" and
          data["team_name"] == "Cold Ledger", data)
    check("certificate fields exact", set(data) == {"display_name", "team_name",
          "event_name", "issued_on"}, data)
    status, _, data = jrequest("GET", "/api/me/certificate", token=leaver)
    check("unfinished team 403 not_complete", status == 403 and
          data == {"error": "not_complete"}, (status, data))
    status, headers, payload = request("GET", "/api/me/certificate/image", token=cold)
    check("certificate image svg", status == 200 and
          "image/svg+xml" in headers.get("Content-Type", "") and
          payload.startswith(b"<svg"), headers.get("Content-Type"))
    status, _, data = jrequest("GET", "/api/me/certificate", token=None)
    check("certificate signed out 401", status == 401)

    section("logout")
    status, _, data = jrequest("POST", "/api/auth/logout", token=cold)
    check("logout 204", status == 204)
    status, _, data = jrequest("GET", "/api/me", token=cold)
    check("token dead after logout", status == 401)

    section("pages")
    for path in ("/downtime", "/downtime/team", "/downtime/scenarios/repossessed",
                 "/downtime/certificate", "/signup", "/login", "/", "/hacktivities",
                 "/aisecurity", "/classrooms", "/pricing", "/business",
                 "/certifications", "/about", "/glossary",
                 "/cyber-security-careers", "/community"):
        status, headers, payload = request("GET", path)
        check("page %s 200" % path, status == 200, status)
    status, headers, payload = request("GET", "/nope")
    check("unknown page 404", status == 404)
    status, headers, payload = request("GET", "/assets/moths-drawn-to-park-lights-246f8064.webm")
    check("film served", status == 200 and
          headers.get("Content-Type") == "video/webm")
    status, headers, payload = request("GET", "/media/briefing.vtt")
    check("vtt served", status == 200 and
          "text/vtt" in headers.get("Content-Type", "") and
          b"WEBVTT" in payload)
    status, headers, payload = request("GET", "/static/style.css")
    check("css served", status == 200 and b"--lime" in payload)

    print("\n%d passed, %d failed" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
