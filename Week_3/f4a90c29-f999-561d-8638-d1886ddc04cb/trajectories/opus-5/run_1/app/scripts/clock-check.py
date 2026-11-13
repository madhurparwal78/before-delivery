#!/usr/bin/env python3
"""Check the rules that read the server clock: reminders firing once, snooze,
and the trash purging when its retention ends."""
import datetime
import http.cookiejar
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

APP_PORT = 4275
BASE = f"http://127.0.0.1:{APP_PORT}"
failures = []


def check(name, got, want):
    if got != want:
        failures.append(name)
        print(f"FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {name}")


def call(opener, method, path, body=None, headers=None):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with opener.open(req) as res:
            payload = res.read()
            return res.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as err:
        payload = err.read()
        try:
            return err.code, json.loads(payload)
        except Exception:
            return err.code, None


def session(email):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    call(opener, "POST", "/api/session", {"email": email, "passcode": "wren-seed-2027"})
    return opener


environment = dict(os.environ)
environment["APP_PUBLIC_PORT"] = str(APP_PORT)
# The clock starts ten server seconds before London offsite's reminder is due
# and runs sixty times real time, so a minute of waiting is a second.
environment["CLOCK_START"] = "2027-03-11T16:59:50Z"
environment["CLOCK_RATE"] = "60"
environment["TRASH_RETENTION_SECONDS"] = "600"
environment["SHARE_LINK_TTL_SECONDS"] = "300"
app = subprocess.Popen(["/app/bin/server"], env=environment,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        time.sleep(0.5)
        try:
            with urllib.request.urlopen(f"{BASE}/api/health") as res:
                if json.loads(res.read())["status"] == "ok":
                    break
        except Exception:
            continue

    marit = session("marit@sundialwren.example")
    status, now = call(marit, "GET", "/api/time")
    check("the server clock starts where it was told", now["now_utc"].startswith("2027-03-11T1"), True)

    # The all-day reminder fires once, writing one notice.
    reminder = None
    for _ in range(40):
        time.sleep(0.4)
        status, body = call(marit, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
        rows = [r for r in body["reminders"] if r["occurrence_id"] == "evt-london-offsite"]
        if rows and rows[0]["status"] == "fired":
            reminder = rows[0]
            break
    check("the all-day reminder fired", reminder is not None and reminder["status"], "fired")
    notices = call(marit, "GET", "/api/notices")[1]["notices"]
    tomorrow = [n for n in notices if n["text"] == "Reminder: London offsite is tomorrow."]
    check("it wrote one notice", len(tomorrow), 1)

    # Snooze moves it by the chosen minutes and it fires once more.
    status, snoozed = call(marit, "POST", f"/api/reminders/{reminder['id']}/snooze", {"minutes": 5})
    check("snoozed", (status, snoozed["status"]), (200, "snoozed"))
    check("only a fired reminder can be snoozed",
          call(marit, "POST", f"/api/reminders/{reminder['id']}/snooze", {"minutes": 5})[1]["error"],
          "not_fired")
    for _ in range(40):
        time.sleep(0.4)
        status, body = call(marit, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
        rows = [r for r in body["reminders"] if r["id"] == reminder["id"]]
        if rows and rows[0]["status"] == "fired":
            break
    check("it fired again", rows[0]["status"], "fired")
    notices = call(marit, "GET", "/api/notices")[1]["notices"]
    tomorrow = [n for n in notices if n["text"] == "Reminder: London offsite is tomorrow."]
    check("and wrote one more notice", len(tomorrow), 2)

    # A timed reminder fires its minutes before the occurrence starts. London
    # is on Greenwich time in March, so its clock reads UTC.
    now_utc = datetime.datetime.strptime(call(marit, "GET", "/api/time")[1]["now_utc"][:19],
                                         "%Y-%m-%dT%H:%M:%S")
    start = (now_utc + datetime.timedelta(minutes=20)).replace(second=0)
    due = (start - datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:00Z")
    status, timed = call(marit, "POST", "/api/events",
                         {"calendar_id": "cal-marit", "title": "Clock check", "kind": "event",
                          "all_day": False, "start_local": start.strftime("%Y-%m-%dT%H:%M"),
                          "end_local": (start + datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M"),
                          "zone": "Europe/London", "reminders": [10]})
    check("timed event created", status, 201)
    fired = None
    for _ in range(80):
        time.sleep(0.4)
        status, body = call(marit, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
        rows = [r for r in body["reminders"] if r["occurrence_id"] == timed["id"]]
        if rows and rows[0]["status"] == "fired":
            fired = rows[0]
            break
    check("the timed reminder fired", fired is not None, True)
    check("it was due ten minutes before", fired["due_utc"], due)
    notices = call(marit, "GET", "/api/notices")[1]["notices"]
    wanted = f"Reminder: Clock check starts at {start.strftime('%H:%M')} London."
    check("with the published copy", any(n["text"] == wanted for n in notices), True)

    # The trash purges when its retention ends, within five seconds.
    record = call(marit, "GET", f"/api/events/{timed['id']}")[1]
    status, trashed = call(marit, "DELETE", f"/api/events/{timed['id']}?scope=all", None,
                           {"If-Match": f'"{record["version"]}"'})
    check("trashed", status, 200)
    items = call(marit, "GET", "/api/trash")[1]["items"]
    check("listed in the trash", any(item["id"] == trashed["trash_id"] for item in items), True)
    purged = False
    for _ in range(60):
        time.sleep(0.5)
        items = call(marit, "GET", "/api/trash")[1]["items"]
        if not any(item["id"] == trashed["trash_id"] for item in items):
            purged = True
            break
    check("purged when its retention ended", purged, True)
    check("gone from search",
          call(marit, "GET", "/api/search?q=Clock%20check")[1]["results"], [])
    check("restoring a purged item answers 404",
          call(marit, "POST", f"/api/trash/{trashed['trash_id']}/restore")[0], 404)

    # A shared link expires at its published lifetime.
    tane = session("tane@sundialwren.example")
    status, link = call(tane, "POST", "/api/events/evt-harbour-kickoff/share-link")
    check("a shared link is made", status, 201)
    check("the new link works", call(tane, "GET", f"/api/share/{link['token']}")[0], 200)
    expired = False
    for _ in range(40):
        time.sleep(0.5)
        if call(tane, "GET", f"/api/share/{link['token']}")[0] == 404:
            expired = True
            break
    check("and expires at its lifetime", expired, True)
    status, body = call(tane, "GET", f"/api/share/{link['token']}")
    check("an expired link answers as an unknown one", body["message"], "This link no longer works.")
finally:
    app.send_signal(signal.SIGTERM)
    app.wait(timeout=10)

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("every clock check passed")
