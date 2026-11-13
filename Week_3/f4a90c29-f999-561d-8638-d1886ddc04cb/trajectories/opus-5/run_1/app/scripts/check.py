#!/usr/bin/env python3
"""Check the published examples of the brief against the running server."""
import json
import sys
import urllib.request
import http.cookiejar

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
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw)
        except Exception:
            return err.code, raw


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")
        print(f"FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {name}")


ines = session("ines@sundialwren.example")
dara = session("dara@sundialwren.example")
tane = session("tane@sundialwren.example")
marit = session("marit@sundialwren.example")

# Partners' weekly across the clock change.
_, got = call(ines, "GET", "/api/occurrences?from=2026-10-06&to=2026-10-07&calendars=cal-dara")
clocks = {c["city"]: c["time"] for c in got["occurrences"][0]["clocks"]}
check("partners weekly 6 Oct 2026", clocks, {"New York": "09:00", "London": "14:00", "Auckland": "02:00"})

for date, want in [
    ("2027-03-09", {"New York": "09:00", "London": "14:00", "Auckland": "03:00"}),
    ("2027-03-16", {"New York": "09:00", "London": "13:00", "Auckland": "02:00"}),
    ("2027-03-30", {"New York": "09:00", "London": "14:00", "Auckland": "02:00"}),
    ("2027-04-06", {"New York": "09:00", "London": "14:00", "Auckland": "01:00"}),
]:
    end = date[:8] + f"{int(date[8:]) + 1:02d}"
    _, got = call(ines, "GET", f"/api/occurrences?from={date}&to={end}&calendars=cal-dara")
    row = [o for o in got["occurrences"] if o["event_id"] == "evt-partners-weekly"][0]
    check(f"partners weekly {date}", {c["city"]: c["time"] for c in row["clocks"]}, want)

# rsvp counts of Tue 9 Mar 2027.
_, got = call(dara, "GET", "/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270309T0900")
check("rsvp 9 Mar", got["rsvp"], {"yes": 1, "no": 0, "maybe": 1, "invited": 1})
check("guest rows", [(g["name"], g["answer"]) for g in got["guests"]],
      [("Ines Okafor", "yes"), ("Marit Holloway", "invited"), ("Tane Whitcombe", "maybe")])

# Tane declined 16 Mar with the out-of-office message.
_, got = call(dara, "GET", "/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270316T0900")
tane_row = [g for g in got["guests"] if g["name"] == "Tane Whitcombe"][0]
check("tane 16 Mar answer", tane_row["answer"], "no")
check("tane 16 Mar message", tane_row["message"],
      "Tane Whitcombe is out of office until Fri 19 Mar 2027, so Partners' weekly was declined automatically.")

# Gap and repeated hours.
_, got = call(session("joss@sundialwren.example"), "GET",
              "/api/occurrences?from=2027-03-07&to=2027-03-22&calendars=cal-joss")
rows = [(o["start_local"], o["end_local"]) for o in got["occurrences"]]
check("sunday markets gap", rows, [("2027-03-07T02:30", "2027-03-07T03:00"),
                                   ("2027-03-14T03:00", "2027-03-14T03:30"),
                                   ("2027-03-21T02:30", "2027-03-21T03:00")])

# Private event reads as Busy below full access and not a guest.
_, got = call(marit, "GET", "/api/events/evt-pay-talk")
check("private title", got["title"], "Busy")
check("private access", got["access"], "busy")
check("private fields", sorted(got.keys()), sorted(
    ["id", "calendar_id", "title", "all_day", "start_local", "end_local", "zone", "access",
     "clocks", "start_utc", "end_utc"]))

# Published field list at details access.
_, got = call(marit, "GET", "/api/events/evt-board-review")
check("details access", got["access"], "details")
check("details fields", sorted(got.keys()), sorted(
    ["id", "calendar_id", "series_id", "organiser", "title", "location", "notes", "kind", "colour",
     "all_day", "start_local", "end_local", "zone", "rrule", "access", "adjusted", "clocks",
     "start_utc", "end_utc"]))

# Guest with See guest list off and Modify event off gets no guests or counts.
hana = session("hana@sundialwren.example")
_, got = call(hana, "GET", "/api/events/evt-board-review")
check("guest access", got["access"], "guest")
check("guest without list", "guests" in got or "rsvp" in got, False)

# Repeat rule limits.
accepted = ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=TU,MO", "COUNT=4;FREQ=WEEKLY;INTERVAL=2",
            "FREQ=MONTHLY;UNTIL=20271231", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=MONTHLY;BYDAY=-1FR",
            "FREQ=YEARLY;INTERVAL=2"]
rejected = ["freq=daily", "FREQ=WEEKLY;BYDAY=mo", "FREQ=WEEKLY;BYDAY=MO,MO", "FREQ=WEEKLY;BYDAY=1MO",
            "FREQ=WEEKLY;INTERVAL=0", "FREQ=WEEKLY;INTERVAL=100", "FREQ=WEEKLY;COUNT=0",
            "FREQ=WEEKLY;COUNT=1000", "FREQ=MONTHLY;BYDAY=MO", "FREQ=MONTHLY;BYDAY=5TU",
            "FREQ=MONTHLY;BYDAY=2TU,3TU", "FREQ=MONTHLY;BYMONTHDAY=1",
            "FREQ=MONTHLY;UNTIL=20271231T000000Z", "FREQ=YEARLY;COUNT=2;UNTIL=20301231",
            "INTERVAL=2", "FREQ=HOURLY"]
# 2027-03-09 is a Tuesday and the second Tuesday of March 2027; 2027-03-26 is the last Friday.
for rule in accepted:
    start = "2027-03-09T09:00"
    end = "2027-03-09T10:00"
    if "BYDAY=-1FR" in rule:
        start, end = "2027-03-26T09:00", "2027-03-26T10:00"
    status, body = call(ines, "POST", "/api/events", {
        "calendar_id": "cal-ines", "title": "Rule check", "kind": "event", "all_day": False,
        "start_local": start, "end_local": end, "zone": "Europe/London", "rrule": rule})
    check(f"accept {rule}", status, 201)
    if status == 201:
        version = body["version"]
        call(ines, "DELETE", f"/api/events/{body['id']}?scope=all", headers={"If-Match": f'"{version}"'})
for rule in rejected:
    status, body = call(ines, "POST", "/api/events", {
        "calendar_id": "cal-ines", "title": "Rule check", "kind": "event", "all_day": False,
        "start_local": "2027-03-09T09:00", "end_local": "2027-03-09T10:00",
        "zone": "Europe/London", "rrule": rule})
    check(f"reject {rule}", (status, body.get("fields", {}).get("rrule")),
          (422, "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."))

# Calendar-date repeats.
_, got = call(marit, "GET", "/api/occurrences?from=2027-01-01&to=2028-01-01&calendars=cal-marit")
dates = sorted(o["start_local"][:10] for o in got["occurrences"] if o["event_id"] == "evt-month-end")
check("monthly on the 31st skips short months", dates,
      ["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31", "2027-08-31", "2027-10-31", "2027-12-31"])

_, got = call(marit, "GET", "/api/occurrences?from=2028-01-01&to=2028-12-31&calendars=cal-firm")
check("yearly on 29 February", [o["start_local"] for o in got["occurrences"] if o["event_id"] == "evt-founders-day"],
      ["2028-02-29"])
_, got = call(marit, "GET", "/api/occurrences?from=2029-01-01&to=2029-12-31&calendars=cal-firm")
check("not a leap year", [o["start_local"] for o in got["occurrences"] if o["event_id"] == "evt-founders-day"], [])

# Reminders of the all-day London offsite.
_, got = call(marit, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
due = {r["occurrence_id"]: r["due_utc"] for r in got["reminders"]}
check("marit offsite reminder", due.get("evt-london-offsite"), "2027-03-11T17:00:00Z")
_, got = call(dara, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
due = {r["occurrence_id"]: r["due_utc"] for r in got["reminders"]}
check("dara offsite reminder", due.get("evt-london-offsite"), "2027-03-11T22:00:00Z")
_, got = call(tane, "GET", "/api/reminders?from=2027-03-01&to=2027-04-01")
due = {r["occurrence_id"]: r["due_utc"] for r in got["reminders"]}
check("tane offsite reminder", due.get("evt-london-offsite"), "2027-03-11T04:00:00Z")

# Shared link of Harbour kickoff, and a dead one.
status, got = call(ines, "GET", "/api/share/seed-harbour-link")
check("shared link", (status, got["title"]), (200, "Harbour kickoff"))
status, got = call(ines, "GET", "/api/share/no-such-token")
check("unknown link", (status, got["message"]), (404, "This link no longer works."))

# An outside guest cannot read the people list.
sam = session("sam@sundialwren.example")
status, _ = call(sam, "GET", "/api/people")
check("outside guest people", status, 403)
status, _ = call(sam, "GET", "/api/zone-rules")
check("outside guest zone rules", status, 403)

# Find a time draws Tane's out-of-office week as five whole days.
auckland = hana
_, got = call(auckland, "GET", "/api/find-a-time?people=p-tane&minutes=30&from=2027-03-15&to=2027-03-19")
blocks = [b for b in got["busy"] if b["person_id"] == "p-tane"][0]["blocks"]
check("tane busy week merged", blocks, [{"start_utc": "2027-03-14T11:00:00Z", "end_utc": "2027-03-19T11:00:00Z"}])

# A recorded Auckland rule warns only the weeks whose shift is not zero, and
# Move splits the series at the first of them.
hana_cal = session("hana@sundialwren.example")
oren_guest = session("oren@sundialwren.example")
status, rule = call(marit, "POST", "/api/zone-rules", {
    "zone": "Pacific/Auckland", "effective_date": "2026-06-01", "new_offset": "+13:00",
    "note": "Auckland holds summer time all year."})
check("rule recorded", status, 201)


def focus_rows():
    _, body = call(hana_cal, "GET", "/api/occurrences?from=2027-03-22&to=2027-12-20&calendars=cal-hana")
    return {
        o["start_local"][:10]: (o["start_local"][11:], o["start_utc"],
                                (o.get("zone_warnings") or [{}])[0].get("shift_minutes"))
        for o in body["occurrences"] if o["title"] == "Focus time"
    }


before = focus_rows()
check("a zero-shift week carries no warning", before["2027-03-29"], ("09:00", "2027-03-28T20:00:00Z", None))
check("a shifted week shows an hour later", before["2027-04-19"], ("10:00", "2027-04-18T21:00:00Z", 60))
check("a later zero-shift week is untouched", before["2027-12-06"], ("09:00", "2027-12-05T20:00:00Z", None))

event = call(hana_cal, "GET", "/api/events/evt-hana-focus")[1]
status, moved = call(hana_cal, "POST", "/api/events/evt-hana-focus/zone-moves",
                     {"rule_id": rule["id"]}, {"If-Match": f'"{event["version"]}"'})
check("move splits the series", (status, moved["split"]["earlier_id"]), (200, "evt-hana-focus"))
after = focus_rows()
check("the week before the split is as it was", after["2027-03-29"], ("09:00", "2027-03-28T20:00:00Z", None))
check("a warned week returns to its saved clock time", after["2027-04-19"],
      ("09:00", "2027-04-18T20:00:00Z", None))
check("a zero-shift week keeps its instant", after["2027-12-06"], ("09:00", "2027-12-05T20:00:00Z", None))
check("Move on an unwarned event answers 409",
      call(marit, "POST", "/api/events/evt-queen-street/zone-moves", {"rule_id": rule["id"]},
           {"If-Match": '"1"'})[1]["error"], "not_warned")
check("the server refuses Move to a guest",
      call(oren_guest, "POST", "/api/events/evt-harbour-kickoff/zone-moves",
           {"rule_id": rule["id"]}, {"If-Match": '"1"'})[1]["error"], "forbidden")
check("a guest reads the same warning",
      [w["shown_time"] for w in call(hana_cal, "GET", "/api/events/evt-board-review")[1].get("zone_warnings", [])], [])
check("an all-day event never warns",
      (call(tane, "GET", "/api/events/evt-tane-away")[1]["zone_warnings"]), [])

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("every check passed")
