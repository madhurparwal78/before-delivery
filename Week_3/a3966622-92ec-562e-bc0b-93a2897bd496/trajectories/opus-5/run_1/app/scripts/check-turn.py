"""Checks the turn, override, skip and ladder-notice rules against a running instance."""

import json
import subprocess
import urllib.request

BASE = "http://localhost:4173"
PASSWORD = "Slackwater-2026"


def login(name, email):
    jar = f"/tmp/turn-{name}.txt"
    subprocess.run(
        [
            "curl", "-s", "-c", jar, "-X", "POST", f"{BASE}/api/session",
            "-H", "content-type: application/json",
            "-d", json.dumps({"email": email, "password": PASSWORD}), "-o", "/dev/null",
        ],
        check=True,
    )
    return jar


def call(jar, method, path, body=None, headers=None, raw=None, content_type=None):
    args = ["curl", "-s", "-b", jar, "-X", method, f"{BASE}{path}", "-w", "\n%{http_code}"]
    if body is not None:
        args += ["-H", "content-type: application/json", "-d", json.dumps(body)]
    if raw is not None:
        args += ["-H", f"content-type: {content_type}", "--data-binary", f"@{raw}"]
    for name, value in (headers or {}).items():
        args += ["-H", f"{name}: {value}"]
    out = subprocess.run(args, capture_output=True, text=True).stdout
    text, _, status = out.rpartition("\n")
    return int(status), (json.loads(text) if text.strip().startswith(("{", "[")) else text)


def show(label, actual, expected):
    ok = str(actual) == str(expected)
    print(f"{'ok  ' if ok else 'FAIL'} {label}: {actual}" + ("" if ok else f" (expected {expected})"))


dispatcher = login("dispatcher", "dispatch1@ebbstone.example")
agent = login("agent", "agent@corvane.example")

status, port = call(dispatcher, "GET", "/api/port")
tide_version = port["tide_version"]
status, moves = call(dispatcher, "GET", "/api/moves")
by_ref = {move["ref"]: move for move in moves["moves"]}


def commit(ref, boarding):
    move = call(dispatcher, "GET", f"/api/moves/{ref}")[1]
    return call(
        dispatcher,
        "POST",
        f"/api/moves/{ref}/commit",
        {"boarding_at": boarding, "tide_version": tide_version, "draught_mm": move["draught_mm"]},
        {"If-Match": f'"{move["version"]}"'},
    )


def assign(ref, pilot, reason=None, note=None, key=None):
    move = call(dispatcher, "GET", f"/api/moves/{ref}")[1]
    body = {"pilot_id": pilot}
    if reason is not None:
        body["rest_override_reason"] = reason
    if note is not None:
        body["note"] = note
    headers = {"If-Match": f'"{move["version"]}"'}
    if key is not None:
        headers["Idempotency-Key"] = key
    return call(dispatcher, "POST", f"/api/moves/{ref}/assignment", body, headers)


# Rotate the first eligible pilots to the end of the turn list.
for ref in ["MV-1001", "MV-1002"]:
    boarding = by_ref[ref]["boarding_at"][:11] + "04:30"
    code, reply = commit(ref, boarding)
    show(f"commit {ref}", code, 200)
    eligibility = call(dispatcher, "GET", f"/api/moves/{ref}/eligibility")[1]
    code, reply = assign(ref, eligibility["next_eligible"])
    show(f"assign next eligible to {ref}", f'{code} {reply.get("pilot", {}).get("id")}', f'200 {eligibility["next_eligible"]}')

turn_before = [entry["pilot_id"] for entry in call(dispatcher, "GET", "/api/moves/MV-1003/eligibility")[1]["turn"]]
print("turn order:", turn_before)
eligibility = call(dispatcher, "GET", "/api/moves/MV-1003/eligibility")[1]
next_eligible = eligibility["next_eligible"]
next_position = next(e["position"] for e in eligibility["turn"] if e["pilot_id"] == next_eligible)
rest_codes = {"rest", "night_rest", "rota_days"}
ahead = [
    entry
    for entry in eligibility["turn"]
    if entry["position"] < next_position
    and "licence" not in entry["reasons"]
    and rest_codes.intersection(entry["reasons"])
]
print("next eligible:", next_eligible, "position", next_position)
print("breaching ahead:", [(e["pilot_id"], e["position"], e["reasons"]) for e in ahead])

if ahead:
    target = ahead[0]["pilot_id"]
    code, reply = assign("MV-1003", target)
    show("no override is refused", f'{code} {reply.get("error")}', "409 rest_breach")
    code, reply = assign("MV-1003", target, reason="too short")
    show("short reason refused", f'{code} {list(reply.get("errors", {}))}', "422 ['rest_override_reason']")
    code, reply = assign("MV-1003", next_eligible, reason="a rested pilot needs no override at all")
    show("override on a rested pilot refused", f'{code} {list(reply.get("errors", {}))}', "422 ['rest_override_reason']")
    code, reply = assign(
        "MV-1003",
        target,
        reason="Immediate safety: inbound tanker is set to ground without a pilot",
        note="Rest overridden after a call with the harbour master",
        key="override-key-1",
    )
    show("override accepted", f'{code} {reply.get("status")}', "200 Pilot assigned")
    replay = assign("MV-1003", target, reason="Immediate safety: inbound tanker is set to ground without a pilot", note="Rest overridden after a call with the harbour master", key="override-key-1")
    show("replay returns the first reply", f'{replay[0]} {replay[1].get("version")}', f'200 {reply.get("version")}')
    overrides = call(dispatcher, "GET", "/api/overrides")[1]["overrides"]
    show("one override recorded", len(overrides), 1)
    show("override attributed", overrides[0]["by"], "Hana Lindqvist")
    code, blocked = call(dispatcher, "PATCH", f"/api/overrides/{overrides[0]['id']}", {"reason": "x"})
    show("override cannot be altered", f'{code} {blocked.get("error")}', "405 method_not_allowed")
    skips = call(dispatcher, "GET", "/api/skips")[1]["skips"]
    print("skips:", skips)
    show("one skip per pilot ahead", len([s for s in skips if s["move_ref"] == "MV-1003"]), ahead[0]["position"] - 1)
    after = call(dispatcher, "GET", "/api/moves/MV-1003/eligibility")[1]["turn"]
    show("assigned pilot moves to the end", after[-1]["pilot_id"], target)
    agent_view = call(agent, "GET", "/api/moves/MV-1003")[1]
    show("agent of another agency cannot read it", agent_view.get("error"), "not_found")

# A ladder notice carries the photo bytes.
pilot_moves = call(dispatcher, "GET", "/api/moves")[1]["moves"]
away = next((move for move in pilot_moves if move["status"] == "Pilot away"), None)
if away is not None:
    pilot_email = f"p{away['pilot']['id'][2:]}@ebbstone.example"
    pilot = login("pilot", pilot_email)
    with open("/tmp/turn-photo.jpg", "wb") as handle:
        handle.write(bytes([0xFF, 0xD8, 0xFF]) + b"turn check evidence")
    code, photo = call(
        pilot,
        "POST",
        f"/api/moves/{away['ref']}/photos",
        raw="/tmp/turn-photo.jpg",
        content_type="image/jpeg",
    )
    show("photo stored", code, 201)
    code, report = call(
        pilot,
        "POST",
        f"/api/moves/{away['ref']}/ladder-reports",
        {"compliant": False, "defects": ["man_ropes"], "photo_ids": [photo["photo_id"]]},
    )
    show("report filed", code, 201)
    code, foreign = call(
        pilot,
        "POST",
        f"/api/moves/{away['ref']}/ladder-reports",
        {"compliant": False, "defects": ["man_ropes"], "photo_ids": ["PHO-9999"]},
    )
    show("unknown photo answers not found", f"{code} {foreign.get('error')}", "404 not_found")

    import time

    time.sleep(3)
    data = json.load(urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=30"))
    notice = next((m for m in data["messages"] if m["Subject"].startswith("Non-compliant")), None)
    if notice is None:
        print("FAIL ladder notice not sent")
    else:
        full = json.load(urllib.request.urlopen("http://mailpit:8025/api/v1/message/" + notice["ID"]))
        show("notice to agent and authority", len(full["To"]), 2)
        show("photo attached", len(full.get("Attachments", [])), 1)
        show("checksum in body", photo["sha256"] in full["Text"], True)
        show("no dispatcher note in body", "harbour master" not in full["Text"], True)
