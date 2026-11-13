#!/usr/bin/env python3
"""Check the business rules: series edits, first save wins, declines,
proposals, guest switches, trash, reminders, sharing and find a time."""
import http.cookiejar
import json
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4173"
failures = []


def session(email):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    call(opener, "POST", "/api/session", {"email": email, "passcode": "wren-seed-2027"})
    return opener


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


def check(name, got, want):
    if got != want:
        failures.append(name)
        print(f"FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {name}")


def event(opener, event_id, occurrence_id=None):
    path = f"/api/events/{event_id}"
    if occurrence_id:
        path += f"?occurrence_id={occurrence_id}"
    return call(opener, "GET", path)[1]


def occurrences(opener, start, end, calendars):
    return call(opener, "GET", f"/api/occurrences?from={start}&to={end}&calendars={calendars}")[1]["occurrences"]


dara = session("dara@sundialwren.example")
ines = session("ines@sundialwren.example")
marit = session("marit@sundialwren.example")
tane = session("tane@sundialwren.example")
hana = session("hana@sundialwren.example")
oren = session("oren@sundialwren.example")
sam = session("sam@sundialwren.example")

# This event writes an exception and leaves the rest where they were.
record = event(dara, "evt-partners-weekly")
status, result = call(dara, "PATCH", "/api/events/evt-partners-weekly",
                      {"scope": "this", "occurrence_id": "evt-partners-weekly@20270302T0900",
                       "start_local": "2027-03-02T11:00", "end_local": "2027-03-02T12:00"},
                      {"If-Match": f'"{record["version"]}"'})
check("this event saved", status, 200)
rows = occurrences(dara, "2027-03-01", "2027-03-17", "cal-dara")
moved = [o for o in rows if o["occurrence_id"] == "evt-partners-weekly@20270302T0900"]
check("the one occurrence moved", (moved[0]["start_local"], moved[0]["is_exception"]),
      ("2027-03-02T11:00", True))
others = [o["start_local"] for o in rows
          if o["event_id"] == "evt-partners-weekly" and o["occurrence_id"] != "evt-partners-weekly@20270302T0900"]
check("the others stayed", others, ["2027-03-09T09:00", "2027-03-16T09:00"])

# All events leaves an exception's overridden values in place.
record = event(dara, "evt-partners-weekly")
status, _ = call(dara, "PATCH", "/api/events/evt-partners-weekly",
                 {"scope": "all", "occurrence_id": "evt-partners-weekly@20270309T0900",
                  "location": "Tower Room"},
                 {"If-Match": f'"{record["version"]}"'})
check("all events saved", status, 200)
rows = occurrences(dara, "2027-03-01", "2027-03-17", "cal-dara")
moved = [o for o in rows if o["occurrence_id"] == "evt-partners-weekly@20270302T0900"][0]
check("the exception keeps its own time", moved["start_local"], "2027-03-02T11:00")
check("the exception takes the new location", moved["location"], "Tower Room")

# This and following splits the series at that occurrence.
record = event(dara, "evt-partners-weekly")
status, result = call(dara, "PATCH", "/api/events/evt-partners-weekly",
                      {"scope": "following", "occurrence_id": "evt-partners-weekly@20270316T0900",
                       "start_local": "2027-03-16T10:00", "end_local": "2027-03-16T11:00"},
                      {"If-Match": f'"{record["version"]}"'})
check("following saved", status, 200)
check("a split is reported", result["split"]["earlier_id"], "evt-partners-weekly")
later_id = result["split"]["later_id"]
rows = occurrences(dara, "2027-03-01", "2027-04-01", "cal-dara")
earlier = sorted(o["start_local"] for o in rows if o["event_id"] == "evt-partners-weekly")
later = sorted(o["start_local"] for o in rows if o["event_id"] == later_id)
check("the earlier series ends at the split", earlier, ["2027-03-02T11:00", "2027-03-09T09:00"])
check("the later series starts there", later,
      ["2027-03-16T10:00", "2027-03-23T10:00", "2027-03-30T10:00"])
check("no undo after a split is wanted here", result["event"]["id"], later_id)
later = event(dara, later_id)
check("the later series copies the guests", sorted(g["name"] for g in later["guests"]),
      ["Ines Okafor", "Marit Holloway", "Tane Whitcombe"])

# The exception dated after the split moved with it, on the same date.
exceptions = [x["occurrence_id"] for x in later["exceptions"]]
check("the dated exception moved", any("20270323" in x for x in exceptions), True)

# First save wins: of two saves against one version, exactly one succeeds.
record = event(dara, "evt-client-readout")
answers = []


def race():
    status, body = call(dara, "PATCH", "/api/events/evt-client-readout",
                        {"title": f"Client readout {threading.current_thread().name}"},
                        {"If-Match": f'"{record["version"]}"'})
    answers.append((status, body))


threads = [threading.Thread(target=race, name=str(index)) for index in range(4)]
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()
check("exactly one save wins", sorted(status for status, _ in answers), [200, 412, 412, 412])
losers = [body for status, body in answers if status == 412]
check("the conflict names the winner", losers[0]["message"], "Dara Kessler saved this first.")
check("the conflict carries the winner's values", "title" in losers[0]["current"], True)
check("a missing If-Match answers 428",
      call(dara, "PATCH", "/api/events/evt-client-readout", {"title": "No version"})[0], 428)

# Focus time declines new and existing meetings, and the organiser hears it.
status, focus = call(hana, "POST", "/api/events",
                     {"calendar_id": "cal-hana", "title": "Deep work", "kind": "focus_time",
                      "all_day": False, "start_local": "2027-03-11T03:00",
                      "end_local": "2027-03-11T06:00", "zone": "Pacific/Auckland",
                      "decline_mode": "new_and_existing"})
check("focus time created", status, 201)
board = event(ines, "evt-board-review")
hana_row = [g for g in board["guests"] if g["name"] == "Hana Rewiti"][0]
check("the existing meeting is declined", hana_row["answer"], "no")
check("the decline carries the published copy", hana_row["message"],
      "Hana Rewiti is in focus time until 06:00, so Northgate board review was declined automatically.")
notices = call(ines, "GET", "/api/notices")[1]["notices"]
check("the organiser has the notice", any(
    notice["text"] == hana_row["message"] for notice in notices), True)

# Out of office lists the conflicts to answer without changing them.
status, away = call(ines, "POST", "/api/events",
                    {"calendar_id": "cal-ines", "title": "Out of office",
                     "kind": "out_of_office", "all_day": True,
                     "start_local": "2027-03-10", "end_local": "2027-03-10",
                     "zone": "Europe/London", "decline_message": "Away from the desk."})
check("out of office created", status, 201)
status, conflicts = call(ines, "GET", f"/api/events/{away['id']}/conflicts")
check("conflicts listed", status, 200)
check("out of office changes nothing by itself", conflicts["conflicts"], [])

# A new invitation into an out-of-office week is declined with its message.
status, meeting = call(dara, "POST", "/api/events",
                       {"calendar_id": "cal-dara", "title": "Harbour sync", "kind": "event",
                        "all_day": False, "start_local": "2027-03-10T10:00",
                        "end_local": "2027-03-10T10:30", "zone": "America/New_York",
                        "guest_ids": ["p-ines"]})
check("meeting created", status, 201)
fresh = event(dara, meeting["id"])
row = [g for g in fresh["guests"] if g["name"] == "Ines Okafor"][0]
check("the new invitation is declined", row["answer"], "no")
check("the window's own message is used", row["message"], "Away from the desk.")

# A guest proposes a new time and the organiser accepts it.
status, proposal = call(tane, "POST", "/api/events/evt-partners-weekly/proposals",
                        {"occurrence_id": "evt-partners-weekly@20270309T0900",
                         "start_local": "2027-03-09T15:00", "end_local": "2027-03-09T16:00",
                         "note": "Earlier suits Auckland."})
check("proposal sent", status, 201)
check("a second open proposal is refused",
      call(tane, "POST", "/api/events/evt-partners-weekly/proposals",
           {"occurrence_id": "evt-partners-weekly@20270309T0900",
            "start_local": "2027-03-09T16:00", "end_local": "2027-03-09T17:00"})[1]["error"],
      "proposal_open")
check("a guest cannot decide",
      call(tane, "POST", f"/api/proposals/{proposal['proposal']['id']}/accept")[0], 403)
status, decided = call(dara, "POST", f"/api/proposals/{proposal['proposal']['id']}/accept")
check("the organiser accepts", status, 200)
check("deciding twice conflicts",
      call(dara, "POST", f"/api/proposals/{proposal['proposal']['id']}/decline")[1]["error"],
      "proposal_decided")
rows = occurrences(dara, "2027-03-08", "2027-03-15", "cal-dara")
moved = [o for o in rows if o["occurrence_id"] == "evt-partners-weekly@20270309T0900"][0]
check("acceptance moves that occurrence only", moved["start_local"], "2027-03-09T15:00")
after = event(dara, "evt-partners-weekly", "evt-partners-weekly@20270309T0900")
answers = {g["name"]: g["answer"] for g in after["guests"]}
check("the accepted proposer answers yes", answers["Tane Whitcombe"], "yes")
check("the other guests return to waiting", answers["Ines Okafor"], "invited")

# Guest switches: Modify event shows the guest list, See guest list off hides it.
check("the guest sees no list with both switches off",
      "guests" in event(sam, "evt-board-review"), False)
record = event(ines, "evt-board-review")
status, _ = call(ines, "PATCH", "/api/events/evt-board-review",
                 {"switches": {"modify_event": True, "invite_others": False, "see_guest_list": False}},
                 {"If-Match": f'"{record["version"]}"'})
check("switches saved", status, 200)
check("Modify event shows the guest list", "guests" in event(sam, "evt-board-review"), True)
check("a details viewer still sees neither", "guests" in event(marit, "evt-board-review"), False)

# Turning See guest list off kills the shared link for good.
record = event(tane, "evt-harbour-kickoff")
check("the shared link works", call(sam, "GET", "/api/share/seed-harbour-link")[0], 200)
status, _ = call(tane, "PATCH", "/api/events/evt-harbour-kickoff",
                 {"switches": {"modify_event": True, "invite_others": False, "see_guest_list": False}},
                 {"If-Match": f'"{record["version"]}"'})
check("See guest list turned off", status, 200)
status, body = call(sam, "GET", "/api/share/seed-harbour-link")
check("the link is dead", (status, body["message"]), (404, "This link no longer works."))
record = event(tane, "evt-harbour-kickoff")
status, _ = call(tane, "PATCH", "/api/events/evt-harbour-kickoff",
                 {"switches": {"modify_event": True, "invite_others": False, "see_guest_list": True}},
                 {"If-Match": f'"{record["version"]}"'})
check("See guest list turned back on", status, 200)
check("the dead link never revives", call(sam, "GET", "/api/share/seed-harbour-link")[0], 404)

# A guest without Modify event cannot edit, and the server refuses anyway.
board = event(sam, "evt-board-review")
check("a guest with Modify event may edit",
      call(sam, "PATCH", "/api/events/evt-board-review", {"title": "Guest edit"},
           {"If-Match": f'"{board["version"]}"'})[0], 200)
record = event(ines, "evt-board-review")
call(ines, "PATCH", "/api/events/evt-board-review",
     {"switches": {"modify_event": False, "invite_others": False, "see_guest_list": False}},
     {"If-Match": f'"{record["version"]}"'})
board = event(sam, "evt-board-review")
check("without Modify event the server refuses",
      call(sam, "PATCH", "/api/events/evt-board-review", {"title": "Guest edit again"},
           {"If-Match": f'"{board["version"]}"'})[0], 403)

# Trash: a series restores exactly, an occurrence is its own item.
record = event(dara, "evt-partners-weekly")
status, trashed = call(dara, "DELETE",
                       "/api/events/evt-partners-weekly?scope=all",
                       None, {"If-Match": f'"{record["version"]}"'})
check("the series is trashed", status, 200)
check("it leaves the grid",
      [o for o in occurrences(dara, "2027-03-08", "2027-03-15", "cal-dara")
       if o["event_id"] == "evt-partners-weekly"], [])
items = call(dara, "GET", "/api/trash")[1]["items"]
check("the trash item is listed", any(item["id"] == trashed["trash_id"] for item in items), True)
check("days left is published",
      [item["days_left"] for item in items if item["id"] == trashed["trash_id"]], [30])
status, restored = call(dara, "POST", f"/api/trash/{trashed['trash_id']}/restore")
check("restored", status, 200)
back = event(dara, "evt-partners-weekly")
check("guests come back", sorted(g["name"] for g in back["guests"]),
      ["Ines Okafor", "Marit Holloway", "Tane Whitcombe"])
check("exceptions come back", len(back["exceptions"]) > 0, True)
check("restoring twice conflicts",
      call(dara, "POST", f"/api/trash/{trashed['trash_id']}/restore")[1]["error"], "not_trashed")

record = event(dara, "evt-partners-weekly")
status, one = call(dara, "DELETE",
                   "/api/events/evt-partners-weekly?scope=this&occurrence_id=evt-partners-weekly@20270309T0900",
                   None, {"If-Match": f'"{record["version"]}"'})
check("one occurrence trashed", status, 200)
check("it is gone from the grid",
      [o for o in occurrences(dara, "2027-03-08", "2027-03-15", "cal-dara")
       if o["occurrence_id"] == "evt-partners-weekly@20270309T0900"], [])
status, _ = call(dara, "POST", f"/api/trash/{one['trash_id']}/restore")
check("the occurrence restores on its own", status, 200)
again = [o for o in occurrences(dara, "2027-03-08", "2027-03-15", "cal-dara")
         if o["occurrence_id"] == "evt-partners-weekly@20270309T0900"]
check("with its own values", again[0]["start_local"], "2027-03-09T15:00")

# Sharing: only the right people set levels, and a change applies at once.
check("a colleague cannot read another calendar's shares",
      call(tane, "GET", "/api/shares?calendar_id=cal-dara")[0], 403)
check("the office manager can", call(marit, "GET", "/api/shares?calendar_id=cal-dara")[0], 200)
check("manage can", call(session("priya@sundialwren.example"), "GET",
                         "/api/shares?calendar_id=cal-dara")[0], 200)
status, _ = call(dara, "PUT", "/api/calendars/cal-dara/shares/p-ines", {"level": "free_busy"})
check("level lowered", status, 200)
readout = event(ines, "evt-client-readout")
check("the lowered level applies on the next request", readout["access"], "busy")
check("and the title reads Busy", readout["title"], "Busy")
status, _ = call(dara, "PUT", "/api/calendars/cal-dara/shares/p-ines", {"level": "edit"})
check("level restored", status, 200)

# Reminders follow their occurrence and are cancelled by the trash.
status, _ = call(dara, "PATCH", "/api/calendars/cal-dara", {"default_reminders": [10, 60]})
check("default reminders saved", status, 200)
status, timed = call(dara, "POST", "/api/events",
                     {"calendar_id": "cal-dara", "title": "Reminder check", "kind": "event",
                      "all_day": False, "start_local": "2027-05-04T09:00",
                      "end_local": "2027-05-04T10:00", "zone": "America/New_York"})
check("a new timed event copies the list", timed["reminders"], [10, 60])
reminders = call(dara, "GET", "/api/reminders?from=2027-05-01&to=2027-05-10")[1]["reminders"]
mine = sorted(r["due_utc"] for r in reminders if r["occurrence_id"] == timed["id"])
check("one reminder per entry", mine, ["2027-05-04T12:00:00Z", "2027-05-04T12:50:00Z"])
record = event(dara, timed["id"])
call(dara, "PATCH", f"/api/events/{timed['id']}",
     {"start_local": "2027-05-04T11:00", "end_local": "2027-05-04T12:00"},
     {"If-Match": f'"{record["version"]}"'})
reminders = call(dara, "GET", "/api/reminders?from=2027-05-01&to=2027-05-10")[1]["reminders"]
mine = sorted(r["due_utc"] for r in reminders if r["occurrence_id"] == timed["id"])
check("moving the occurrence moves them", mine, ["2027-05-04T14:00:00Z", "2027-05-04T14:50:00Z"])
record = event(dara, timed["id"])
call(dara, "DELETE", f"/api/events/{timed['id']}?scope=all", None,
     {"If-Match": f'"{record["version"]}"'})
reminders = call(dara, "GET", "/api/reminders?from=2027-05-01&to=2027-05-10")[1]["reminders"]
check("trashing cancels them",
      [r for r in reminders if r["occurrence_id"] == timed["id"]], [])

# Find a time keeps to everyone's working hours and lists slots in order.
status, found = call(dara, "GET",
                     "/api/find-a-time?people=p-ines&minutes=30&from=2027-06-07&to=2027-06-07")
check("find a time answers", status, 200)
check("slots are inside both offices", all(
    clock["inside_hours"] for slot in found["slots"] for clock in slot["clocks"]
    if clock["city"] in ("New York", "London")), True)
check("slots are in order", [slot["start_utc"] for slot in found["slots"]],
      sorted(slot["start_utc"] for slot in found["slots"]))
check("at most twenty slots", len(found["slots"]) <= 20, True)
check("no titles in the answer", "title" in json.dumps(found["busy"]), False)
check("an outside guest cannot find a time",
      call(sam, "GET", "/api/find-a-time?people=p-ines&minutes=30&from=2027-06-07&to=2027-06-07")[0], 403)

# Duplicate and move to another calendar.
status, copy = call(dara, "POST", "/api/events/evt-client-readout/duplicate")
check("duplicated", status, 201)
check("the copy is titled by the rule", copy["title"].endswith(" copy"), True)
check("the copy has no guests", copy["guests"], [])
record = event(dara, copy["id"])
status, moved = call(dara, "POST", f"/api/events/{copy['id']}/move",
                     {"calendar_id": "cal-ines"}, {"If-Match": f'"{record["version"]}"'})
check("moved to another calendar", (status, moved["calendar_id"]), (200, "cal-ines"))
check("the id stayed the same", moved["id"], copy["id"])
check("moving to Public holidays is refused",
      call(dara, "POST", f"/api/events/{copy['id']}/move", {"calendar_id": "cal-holidays"},
           {"If-Match": f'"{moved["version"]}"'})[0], 403)

# Public holidays is read only for everyone.
check("holidays read at details", event(oren, "hol-good-friday")["access"], "details")
check("the server refuses a change to it",
      call(oren, "PATCH", "/api/events/hol-good-friday", {"title": "Nope"})[0], 403)
check("a details viewer carries no version", "version" in event(oren, "hol-good-friday"), False)

# Search never carries anything the caller cannot read in full.
check("a free/busy viewer matches nothing on that calendar",
      [r["title"] for r in call(session("joss@sundialwren.example"), "GET",
                                "/api/search?q=Partners")[1]["results"]], [])
check("a private event is never matched",
      [r["title"] for r in call(marit, "GET", "/api/search?q=Partner%20pay")[1]["results"]], [])
check("a readable guest name matches",
      any(r["event_id"] == "evt-board-review"
          for r in call(ines, "GET", "/api/search?q=Marchetti")[1]["results"]), True)
check("a guest name nobody may read matches nothing for them",
      call(marit, "GET", "/api/search?q=Marchetti")[1]["results"], [])
check("too short answers 422", call(ines, "GET", "/api/search?q=a")[0], 422)

# A foreign origin on a state-changing request is refused.
check("a foreign origin is refused",
      call(dara, "POST", "/api/events", {"calendar_id": "cal-dara"},
           {"Origin": "http://elsewhere.example"})[0], 403)
try:
    request = urllib.request.Request(BASE + "/api/events", data=b"x", method="POST",
                                     headers={"Content-Type": "text/plain"})
    with urllib.request.urlopen(request) as res:
        wrong_type = res.status
except urllib.error.HTTPError as err:
    wrong_type = err.code
check("a wrong content type is refused", wrong_type, 415)

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("every domain check passed")
time.sleep(0)
