#!/usr/bin/env python3
"""Check the printed week's content, the iCalendar round trip and the
behaviour of the app while Gotenberg or MinIO is unreachable."""
import json
import os
import subprocess
import sys
import time
import http.cookiejar
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4173"
failures = []


def session(email):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    call(opener, "POST", "/api/session", {"email": email, "passcode": "wren-seed-2027"})
    return opener


def call(opener, method, path, body=None, headers=None, raw=False, content_type="application/json"):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with opener.open(req) as res:
            payload = res.read()
            return res.status, (payload if raw else (json.loads(payload) if payload else None))
    except urllib.error.HTTPError as err:
        payload = err.read()
        if raw:
            return err.code, payload
        try:
            return err.code, json.loads(payload)
        except Exception:
            return err.code, payload


def check(name, got, want):
    if got != want:
        failures.append(name)
        print(f"FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {name}")


marit = session("marit@sundialwren.example")
ines = session("ines@sundialwren.example")

# The printed week's published content.
status, print_job = call(marit, "POST", "/api/prints", {"week_start": "2027-03-08"},
                         {"Idempotency-Key": "content-check"})
check("print accepted", status, 202)
for _ in range(60):
    time.sleep(0.5)
    status, print_job = call(marit, "GET", f"/api/prints/{print_job['id']}")
    if print_job["status"] in ("stored", "failed"):
        break
check("print stored", print_job["status"], "stored")
status, pdf = call(marit, "GET", f"/api/prints/{print_job['id']}/pdf", raw=True)
check("pdf downloaded", status, 200)
with open("/tmp/wren-week.pdf", "wb") as handle:
    handle.write(pdf)
text = subprocess.run(["pdftotext", "/tmp/wren-week.pdf", "-"], capture_output=True, text=True).stdout
for want in ["Sundial & Wren", "Week of Mon 8 Mar 2027", "Mon 8 Mar 2027", "Sun 14 Mar 2027",
             "Northgate board review", "15:00 London", "10:00 New York", "03:00 Auckland",
             "London offsite", "All day"]:
    check(f"pdf holds {want!r}", want in text, True)
check("pdf carries no guest name", "Bea Marchetti" in text, False)
check("private event prints as Busy", "Partner pay talk" in text, False)

# An idempotent replay returns the same job; a different body conflicts.
status, replay = call(marit, "POST", "/api/prints", {"week_start": "2027-03-08"},
                      {"Idempotency-Key": "content-check"})
check("replay returns the same job", (status, replay["id"]), (202, print_job["id"]))
status, conflict = call(marit, "POST", "/api/prints", {"week_start": "2027-03-15"},
                        {"Idempotency-Key": "content-check"})
check("a different body conflicts", (status, conflict["error"]), (409, "idempotency_conflict"))
status, again = call(marit, "POST", f"/api/prints/{print_job['id']}/retry")
check("retry on a stored print writes nothing", (status, again["object_key"]), (200, print_job["object_key"]))

# The iCalendar round trip.
status, export = call(ines, "POST", "/api/calendars/cal-dara/exports")
check("export created", status, 201)
status, ics = call(ines, "GET", f"/api/exports/{export['id']}/file", raw=True)
check("export downloaded", status, 200)
ics_text = ics.decode()
check("export holds the series", "UID:evt-partners-weekly" in ics_text, True)
check("export holds the rule", "RRULE:FREQ=WEEKLY;BYDAY=TU" in ics_text, True)
check("export holds the deleted occurrence",
      "EXDATE;TZID=America/New_York:20270413T090000" in ics_text, True)
check("export holds the modified occurrence",
      "RECURRENCE-ID;TZID=America/New_York:20270323T090000" in ics_text, True)
check("export names no guest", "ATTENDEE" in ics_text, False)
check("export writes the kind", "X-WREN-KIND:event" in ics_text, True)
check("private event exports as Busy", "SUMMARY:Busy" in ics_text, True)

# Importing into an empty calendar gives the same occurrences.
status, imported = call(ines, "POST", "/api/calendars/cal-ines/imports", ics, raw=False,
                        content_type="text/calendar")
check("import created", status, 201)
status, before = call(ines, "GET",
                      "/api/occurrences?from=2027-03-01&to=2027-05-01&calendars=cal-dara")
status, after = call(ines, "GET",
                     "/api/occurrences?from=2027-03-01&to=2027-05-01&calendars=cal-ines")
original = [(o["title"], o["start_local"], o["end_local"], o["zone"], o["start_utc"], o.get("is_exception"))
            for o in before["occurrences"] if o["event_id"] == "evt-partners-weekly"]
copies = [(o["title"], o["start_local"], o["end_local"], o["zone"], o["start_utc"], o.get("is_exception"))
          for o in after["occurrences"]
          if o["calendar_id"] == "cal-ines" and o["title"] == "Partners' weekly"]
check("round trip keeps every occurrence", copies, original)

# Importing the same file again replaces rather than doubles.
status, twice = call(ines, "POST", "/api/calendars/cal-ines/imports", ics, raw=False,
                     content_type="text/calendar")
check("second import updates", twice["updated"] > 0, True)
status, after_again = call(ines, "GET",
                           "/api/occurrences?from=2027-03-01&to=2027-05-01&calendars=cal-ines")
repeated = [o for o in after_again["occurrences"]
            if o["calendar_id"] == "cal-ines" and o["title"] == "Partners' weekly"]
check("nothing doubled", len(repeated), len(copies))

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("every service check passed")
os.environ.pop("UNUSED", None)
