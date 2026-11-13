"""Checks tide revisions returning moves to Ordered, and detention billing, on a side instance."""

import json
import os
import subprocess
import time

PORT = os.environ.get("CHECK_PORT", "4190")
BASE = f"http://localhost:{PORT}"
JAR = "/tmp/check-tide.txt"
PASSWORD = "Slackwater-2026"


def call(method, path, body=None, headers=None, jar=JAR):
    args = ["curl", "-s", "-b", jar, "-c", jar, "-X", method, f"{BASE}{path}", "-w", "\n%{http_code}"]
    if body is not None:
        args += ["-H", "content-type: application/json", "-d", json.dumps(body)]
    for name, value in (headers or {}).items():
        args += ["-H", f"{name}: {value}"]
    out = subprocess.run(args, capture_output=True, text=True).stdout
    text, _, status = out.rpartition("\n")
    return int(status), (json.loads(text) if text.strip().startswith(("{", "[")) else text)


def show(label, actual, expected):
    ok = str(actual) == str(expected)
    print(f"{'ok  ' if ok else 'FAIL'} {label}: {actual}" + ("" if ok else f" (expected {expected})"))


call("POST", "/api/session", {"email": "dispatch1@ebbstone.example", "password": PASSWORD})

# --- a tide revision that drops the water returns committed moves to Ordered
status, move = call("GET", "/api/moves/MV-1003")
date = move["committed"]["boarding_at"][:10]
print("MV-1003 committed:", move["committed"])
status, revision = call(
    "POST",
    "/api/tide-revisions",
    {
        "date": date,
        "events": [
            {"at": "00:45", "type": "low", "height_mm": 400},
            {"at": "06:55", "type": "high", "height_mm": 5200},
            {"at": "13:05", "type": "low", "height_mm": 300},
            {"at": "19:15", "type": "high", "height_mm": 5000},
        ],
    },
)
show("revision published", status, 201)
show("tide version advanced", revision["version"], 2)
show("MV-1003 named as returned", "MV-1003" in revision["returned_to_ordered"], True)
status, after = call("GET", "/api/moves/MV-1003")
show("MV-1003 back to Ordered", after["status"], "Ordered")
show("committed values cleared", after["committed"], None)
show("order amended notice sent", [n["kind"] for n in after["notices"]], "['Order amended']")
status, assigned = call("GET", "/api/moves/MV-1004")
show("MV-1004 released", f'{assigned["status"]} {assigned["pilot"]}', "Ordered None")
show(
    "withdrawn notice to the pilot",
    sorted({n["kind"] for n in assigned["notices"]}),
    "['Assignment withdrawn', 'Order amended']",
)
status, badEvent = call(
    "POST",
    "/api/tide-revisions",
    {"date": "2027-03-14", "events": [{"at": "02:30", "type": "low", "height_mm": 500}, {"at": "08:00", "type": "high", "height_mm": 6000}]},
)
show("event in a skipped hour is refused", f'{status} {list(badEvent.get("errors", {}))}', "422 ['events']")

# --- detention billing with a short half-hour unit
status, moves = call("GET", "/api/moves")
on_board = next(m for m in moves["moves"] if m["status"] == "On board")
ref = on_board["ref"]
status, started = call("POST", f"/api/moves/{ref}/detention", {"action": "start"})
show("detention started", f'{status} {started["detained"]}', "200 True")
status, blocked = call("POST", f"/api/moves/{ref}/transitions", {"to": "Completed"})
show("completion refused while detained", f'{status} {blocked.get("error")}', "409 detention_open")
status, again = call("POST", f"/api/moves/{ref}/detention", {"action": "start"})
show("second start refused", f'{status} {again.get("error")}', "409 detention_already_open")
time.sleep(25)
status, stopped = call("POST", f"/api/moves/{ref}/detention", {"action": "stop"})
show("detention accrued", stopped["detention"]["seconds"] >= 25, True)
status, done = call("POST", f"/api/moves/{ref}/transitions", {"to": "Completed"})
detention_line = next((line for line in done["lines"] if line["label"] == "Detention"), None)
print("lines:", [(line["label"], line["quantity"], line["amount_cents"]) for line in done["lines"]])
unit = int(os.environ.get("DETENTION_UNIT_SECONDS", "1800"))
expected = max(0, -(-(stopped["detention"]["seconds"] - unit) // unit))
show("detention billed by started half hour", detention_line["quantity"], expected)
show("detention amount", detention_line["amount_cents"], expected * 16500)
