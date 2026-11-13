import copy
import hashlib
import json
import os
import socket
import subprocess
import tempfile
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP, Meilisearch, Postgres, S3, advance, animations, axe,
    check, click, fill, held, layout, licence_allowed, open_app, select,
    shipped_packages, style, tab_order, tap, unique,
)

TICK_RATE = 20
MAX_TICKS = 18000
MAX_COMMANDS = 2000
MAX_WAVES = 40
MAX_CREATURES = 600
COMMAND_BYTES = 262144
OTHER_BYTES = 1048576
MAX_DEPTH = 16
MAX_SEED = 4294967295
FRAME_PAGE = 201
INITIAL_RESERVE = 120000
GENERATION = 1000
PERIOD = 20
SPAWN_POSITION = 8999
CELL_WIDTH = 1000
FORECAST_TICKS = 100
BEAM_MS = 180
CONTACT_MS = 260
TARGET_SIZE = 44
LIVE_MS = 2000
USAGE_SCALE = 1000
PASSWORD = "harbour-passphrase"
POLL_SECONDS = 30
HTTP_SECONDS = 30
INDEX_SECONDS = 5
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"}

DEVICE_ORDER = ["wick", "chime", "siphon", "wall", "prism", "gong"]
DEVICE_NAMES = [
    "Wickwarden", "Undertow Chime", "Brine Siphon", "Foldwall",
    "Salt Prism", "Crosswake Gong",
]
DEVICE_ROWS = [
    (20000, 10000, 3500, 10, 12, 1),
    (30000, 15000, 2500, 20, 10, 2),
    (25000, 12500, None, None, 0, 0),
    (15000, 7500, 1000, None, 0, 0),
    (35000, 17500, 3000, 15, 9, 1),
    (40000, 20000, 2000, 25, 8, 1),
]
CREATURE_ROWS = {
    "mote": (24, 30, 0),
    "shell": (60, 20, 4),
    "skipper": (32, 40, 0),
    "mass": (120, 15, 0),
}
SKIPPER_PERIOD = 40
SHIFTS = (13, 17, 5)
WORD_MASK = 4294967295
RULE_ROOT = {
    "ruleset", "tickRate", "arithmetic", "randomness", "tickOrder", "devices",
    "creatures", "limits", "commandRules", "rankingRules", "seasonRules", "transitions",
}
REASONS = [
    "Unknown command",
    "Command sequence is not increasing",
    "Command tick moved backwards",
    "Command follows terminal state",
    "Invalid cell",
    "Device is outside the loadout",
    "Cell is occupied",
    "No installed device",
    "Device is already upgraded",
    "Insufficient charge",
]
TICK_ORDER = [
    "commands", "spawn", "move-and-change-lane", "prepare-attacks",
    "simultaneous-damage", "deaths", "generation", "breaches", "terminal-check",
]
DEVICES = dict(zip(DEVICE_ORDER, DEVICE_ROWS))


def canonical(value):
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fresh():
    token = hashlib.sha256(repr(unique()).encode()).hexdigest()
    email = token + "@squallglass.example"
    return email, token[:8]


class API:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.client = httpx.Client(
            base_url=self.base, timeout=HTTP_SECONDS,
            headers={"Origin": self.base},
        )

    def request(self, method, path, body=None, status=200, **kwargs):
        if body is not None:
            kwargs["json"] = body
        response = self.client.request(method, path, **kwargs)
        assert response.status_code == status, (
            method, path, response.status_code, response.text
        )
        if status == 204:
            assert response.content == b""
            return None
        assert response.headers["content-type"].split(";")[0] == "application/json"
        return response.json()

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, body, **kwargs):
        return self.request("POST", path, body, **kwargs)

    def put(self, path, body, **kwargs):
        return self.request("PUT", path, body, **kwargs)


def account(base):
    api = API(base)
    email, name = fresh()
    person = api.post("/api/accounts", {
        "email": email, "password": PASSWORD, "playerName": name,
    }, status=201)["account"]
    assert person["email"] == email
    assert person["playerName"] == name
    return api, person


def login(base, person):
    api = API(base)
    actual = api.post("/api/session", {
        "email": person["email"], "password": PASSWORD,
    })["account"]
    assert actual == person
    return api


def error(api, method, path, body, status, code, message=None, fields=None):
    value = api.request(method, path, body, status=status)
    assert set(value) == {"error"}
    assert set(value["error"]) == {"code", "message", "fields"}
    assert value["error"]["code"] == code
    if message is not None:
        assert value["error"]["message"] == message
    if fields is not None:
        assert value["error"]["fields"] == fields
    elif code != "INVALID_FIELDS":
        assert value["error"]["fields"] == {}
    return value


def eventually(fetch, predicate, contract, seconds=POLL_SECONDS):
    deadline = time.monotonic() + seconds
    last = None
    for _ in range(MAX_TICKS):
        if time.monotonic() >= deadline:
            break
        last = fetch()
        if predicate(last):
            return last
    pytest.fail(f"{contract}; last response: {last!r}")


def terminal(api, ticket_id, commands, end_tick=MAX_TICKS, claims=None):
    body = {"commands": commands, "endTick": end_tick}
    if claims is not None:
        body["claims"] = claims
    response = api.client.post(f"/api/runs/{ticket_id}/submit", json=body)
    assert response.status_code in (200, 202), response.text
    result = response.json()
    if result["state"] not in ("accepted", "rejected"):
        def retry():
            response = api.client.post(f"/api/runs/{ticket_id}/retry", json={})
            assert response.status_code in (200, 202), response.text
            return response.json()
        result = eventually(
            retry, lambda r: r["state"] in ("accepted", "rejected"),
            "verification must reach one terminal result",
        )
    return result


def definition(title=None):
    if title is None:
        _, title = fresh()
    return {
        "title": title,
        "description": "",
        "difficulty": "calm",
        "seed": 1,
        "buildable": [
            {"lane": lane, "cell": cell}
            for lane in range(1, 6) for cell in range(1, 10)
        ],
        "waves": [
            {"tick": 0, "creature": "mote", "count": 1, "interval": 1, "lane": 3}
        ],
    }


def command(seq=1, tick=0, kind="deploy", lane=3, cell=8, device="wick"):
    return {
        "seq": seq, "tick": tick, "type": kind, "lane": lane, "cell": cell,
        "device": device if kind == "deploy" else None,
    }


def issue(api, mode="campaign", source="c1", revision=None, loadout=None):
    loadout = ["wick"] if loadout is None else loadout
    ticket = api.post("/api/runs", {
        "mode": mode, "sourceId": source, "revision": revision, "loadout": loadout,
    }, status=201)["ticket"]
    started = api.post(f"/api/runs/{ticket['id']}/start", {})
    assert started["ticket"] == ticket
    assert started["state"] == "playing"
    return ticket


def level(api, value=None):
    value = definition() if value is None else value
    saved = api.post("/api/levels", {"definition": value}, status=201)
    assert saved["definition"] == value
    assert saved["digest"] == digest(value)
    assert saved["revision"] == 1
    assert saved["state"] == "private"
    return saved


def proof(api, saved, commands=None, loadout=None):
    commands = [command()] if commands is None else commands
    ticket = issue(api, "playtest", saved["id"], saved["revision"], loadout)
    result = terminal(api, ticket["id"], commands)
    assert result["state"] == "accepted"
    assert result["metrics"]["outcome"] == "victory"
    return ticket, result


def publish(api, saved, proof_id):
    body = {"expectedRevision": saved["revision"], "proofRunId": proof_id}
    def attempt():
        response = api.client.post(f"/api/levels/{saved['id']}/publish", json=body)
        assert response.status_code in (200, 201, 202), response.text
        return response.json()
    return eventually(
        attempt, lambda x: "digest" in x and "creatorName" in x,
        "qualified publication must commit",
    )


def published(base):
    api, person = account(base)
    saved = level(api)
    ticket, _ = proof(api, saved)
    challenge = publish(api, saved, ticket["id"])
    return api, person, saved, ticket, challenge


def all_frames(api, run_id, last_tick):
    frames = []
    for start in range(0, last_tick + 1, FRAME_PAGE):
        stop = min(last_tick + 1, start + FRAME_PAGE)
        page = api.get(f"/api/runs/{run_id}/frames?from={start}&to={stop}")
        assert page["runId"] == run_id
        assert (page["from"], page["to"]) == (start, stop)
        assert len(page["frames"]) == stop - start
        frames.extend(page["frames"])
    return frames


def round_div(value, divisor):
    sign = -1 if value < 0 else 1
    return sign * ((abs(value) * 2 + divisor) // (2 * divisor))


def reproduce(value, seed, loadout, commands, end_tick):
    state = {
        "tick": 0, "rngState": seed, "nextEntityId": 1, "nextMovementId": 1,
        "health": 10, "breaches": 0, "reserve": 0, "source": 0, "sink": 0,
        "devices": [], "creatures": [], "spawned": [0] * len(value["waves"]),
        "events": [], "transfers": [], "outcome": None,
    }
    ledger = []

    def transfer(tick, debit, credit, amount, reason, installation=None):
        movement = state["nextMovementId"]
        state["nextMovementId"] += 1
        for name, delta in ((debit, -amount), (credit, amount)):
            entry = {
                "movementId": movement, "tick": tick, "account": name,
                "delta": delta, "reason": reason,
                "deviceId": installation if name.startswith("installed:") else None,
            }
            ledger.append(entry)
            state["transfers"].append(entry)
            if name.startswith("installed:"):
                owner = next(d for d in state["devices"] if d["id"] == installation)
                owner["installedCharge"] += delta
            else:
                state[name] += delta

    transfer(0, "source", "reserve", INITIAL_RESERVE, "initial")
    frames = [copy.deepcopy(state)]
    cursor = 0
    previous = None
    failure = None
    buildable = {(c["lane"], c["cell"]) for c in value["buildable"]}

    def refuse(c):
        nonlocal previous
        if c["type"] not in ("deploy", "upgrade", "salvage"):
            return REASONS[0]
        if previous is not None and c["seq"] <= previous["seq"]:
            return REASONS[1]
        if previous is not None and c["tick"] < previous["tick"]:
            return REASONS[2]
        if state["outcome"] is not None:
            return REASONS[3]
        location = (c["lane"], c["cell"])
        if not (1 <= c["lane"] <= 5 and 1 <= c["cell"] <= 9):
            return REASONS[4]
        if c["type"] == "deploy" and location not in buildable:
            return REASONS[4]
        installed = next(
            (d for d in state["devices"] if (d["lane"], d["cell"]) == location), None,
        )
        if c["type"] == "deploy":
            if c["device"] not in loadout:
                return REASONS[5]
            if installed is not None:
                return REASONS[6]
            price = DEVICES[c["device"]][0]
        else:
            if installed is None:
                return REASONS[7]
            if c["type"] == "upgrade" and installed["tier"] == "upgraded":
                return REASONS[8]
            price = DEVICES[installed["device"]][1] if c["type"] == "upgrade" else 0
        if price > state["reserve"]:
            return REASONS[9]
        return None

    def apply(c):
        location = (c["lane"], c["cell"])
        if c["type"] == "deploy":
            identifier = state["nextEntityId"]
            state["nextEntityId"] += 1
            row = DEVICES[c["device"]]
            installed = {
                "id": identifier, "device": c["device"], "lane": c["lane"],
                "cell": c["cell"], "tier": "base", "installedCharge": 0,
                "nextFireTick": c["tick"] if row[3] is not None else None,
            }
            state["devices"].append(installed)
            transfer(c["tick"], "reserve", f"installed:{identifier}",
                     row[0], "deploy", identifier)
            return
        installed = next(
            d for d in state["devices"] if (d["lane"], d["cell"]) == location
        )
        identifier = installed["id"]
        if c["type"] == "upgrade":
            transfer(c["tick"], "reserve", f"installed:{identifier}",
                     DEVICES[installed["device"]][1], "upgrade", identifier)
            installed["tier"] = "upgraded"
        else:
            invested = installed["installedCharge"]
            refund = invested // 2
            transfer(c["tick"], f"installed:{identifier}", "reserve",
                     refund, "salvage-refund", identifier)
            transfer(c["tick"], f"installed:{identifier}", "sink",
                     invested - refund, "salvage-loss", identifier)
            state["devices"].remove(installed)

    for tick in range(end_tick):
        if state["outcome"] is not None:
            break
        state["events"] = []
        state["transfers"] = []
        for _ in range(len(commands) - cursor):
            c = commands[cursor]
            if previous is not None and (
                c["type"] not in ("deploy", "upgrade", "salvage")
                or c["seq"] <= previous["seq"] or c["tick"] < previous["tick"]
            ):
                reason = refuse(c)
            elif c["tick"] != tick:
                break
            else:
                reason = refuse(c)
            if reason is not None:
                failure = {"tick": c["tick"], "seq": c["seq"], "reason": reason}
                break
            apply(c)
            previous = c
            cursor += 1
        if failure is not None:
            break

        for index, wave in enumerate(value["waves"]):
            count = state["spawned"][index]
            if count < wave["count"] and tick == wave["tick"] + count * wave["interval"]:
                word = state["rngState"]
                word = (word ^ (word << SHIFTS[0])) & WORD_MASK
                word = (word ^ (word >> SHIFTS[1])) & WORD_MASK
                word = (word ^ (word << SHIFTS[2])) & WORD_MASK
                state["rngState"] = word
                lane = wave["lane"] or 1 + word % 5
                identifier = state["nextEntityId"]
                state["nextEntityId"] += 1
                state["creatures"].append({
                    "id": identifier, "creature": wave["creature"], "lane": lane,
                    "position": SPAWN_POSITION,
                    "health": CREATURE_ROWS[wave["creature"]][0], "movements": 0,
                })
                state["spawned"][index] += 1

        for creature in state["creatures"]:
            divisor = 1
            for device in state["devices"]:
                if device["device"] != "wall" or device["lane"] != creature["lane"]:
                    continue
                centre = CELL_WIDTH * device["cell"] - CELL_WIDTH // 2
                if abs(creature["position"] - centre) <= DEVICES["wall"][2]:
                    divisor = max(divisor, 4 if device["tier"] == "upgraded" else 2)
            speed = CREATURE_ROWS[creature["creature"]][1]
            creature["position"] -= round_div(speed, divisor)
            creature["movements"] += 1
            if (creature["creature"] == "skipper"
                    and creature["movements"] % SKIPPER_PERIOD == 0):
                creature["lane"] = 1 + creature["lane"] % 5

        hits = []
        totals = Counter()
        for device in state["devices"]:
            row = DEVICES[device["device"]]
            if row[3] is None or tick < device["nextFireTick"]:
                continue
            centre = CELL_WIDTH * device["cell"] - CELL_WIDTH // 2
            candidates = [
                c for c in state["creatures"]
                if abs(c["position"] - centre) <= row[2]
                and (
                    abs(c["lane"] - device["lane"]) <= 1
                    if device["device"] == "gong"
                    else c["lane"] == device["lane"]
                )
            ]
            candidates.sort(key=lambda c: (c["position"], c["id"]))
            targets = candidates[:row[5]]
            if targets:
                device["nextFireTick"] = tick + row[3]
            for creature in targets:
                amount = row[4] * (2 if device["tier"] == "upgraded" else 1)
                if device["device"] != "prism":
                    amount = max(1, amount - CREATURE_ROWS[creature["creature"]][2])
                hits.append((device, creature, amount))
                totals[creature["id"]] += amount

        def contact(creature):
            return 1 + min(SPAWN_POSITION, max(0, creature["position"])) // CELL_WIDTH

        for device, creature, amount in hits:
            state["events"].append({
                "kind": "damage", "tick": tick + 1, "deviceId": device["id"],
                "targetId": creature["id"], "lane": creature["lane"],
                "cell": contact(creature), "damage": amount,
                "resultingHealth": creature["health"] - totals[creature["id"]],
            })
        for creature in state["creatures"]:
            creature["health"] -= totals[creature["id"]]
        dead = [c for c in state["creatures"] if c["health"] <= 0]
        for creature in dead:
            state["events"].append({
                "kind": "death", "tick": tick + 1, "creatureId": creature["id"],
                "lane": creature["lane"], "cell": contact(creature),
            })
        state["creatures"] = [c for c in state["creatures"] if c["health"] > 0]

        if (tick + 1) % PERIOD == 0:
            transfer(tick + 1, "source", "reserve", GENERATION, "harbour-generation")
            for device in state["devices"]:
                if device["device"] == "siphon":
                    amount = GENERATION * 3 * (2 if device["tier"] == "upgraded" else 1)
                    transfer(tick + 1, "source", "reserve", amount, "collector-generation")
        breached = [c for c in state["creatures"] if c["position"] <= 0]
        for creature in breached:
            state["events"].append({
                "kind": "breach", "tick": tick + 1, "creatureId": creature["id"],
                "lane": creature["lane"], "cell": 1,
            })
        state["breaches"] += len(breached)
        state["health"] = max(0, state["health"] - len(breached))
        state["creatures"] = [c for c in state["creatures"] if c["position"] > 0]
        state["tick"] = tick + 1
        if state["health"] == 0:
            state["outcome"] = "defeat"
        elif (all(state["spawned"][i] == w["count"]
                  for i, w in enumerate(value["waves"]))
              and not state["creatures"]):
            state["outcome"] = "victory"
        elif state["tick"] == MAX_TICKS:
            state["outcome"] = "defeat"
        frames.append(copy.deepcopy(state))

    if failure is None and state["outcome"] is not None and cursor < len(commands):
        c = commands[cursor]
        failure = {"tick": c["tick"], "seq": c["seq"], "reason": refuse(c)}
    if failure is None and state["outcome"] is None:
        failure = {
            "tick": end_tick, "seq": None, "reason": "Run has no terminal outcome",
        }
    return frames, ledger, failure


def metrics(frame):
    return {
        "outcome": frame["outcome"], "breaches": frame["breaches"],
        "completionTick": frame["tick"], "remainingCharge": frame["reserve"],
        "health": frame["health"],
    }


def verify_run(api, ticket, value, commands, result, end_tick=MAX_TICKS):
    expected, ledger, failure = reproduce(
        value, ticket["seed"], ticket["loadout"], commands, end_tick,
    )
    run = api.get(f"/api/runs/{ticket['id']}")
    assert run["ticket"] == ticket
    assert run["result"] == result
    assert run["ledger"] == ledger
    assert result["evidenceDigest"] == digest({"commands": commands, "endTick": end_tick})
    assert result["runId"] == ticket["id"]
    assert result["failure"] == failure
    if failure is None:
        assert result["state"] == "accepted"
        assert result["metrics"] == metrics(expected[-1])
    else:
        assert result["state"] == "rejected"
        assert result["metrics"] is None
    actual = all_frames(api, ticket["id"], expected[-1]["tick"])
    assert actual == expected
    return expected, ledger


def stored_objects(ticket, value, commands, end_tick=MAX_TICKS):
    store = S3()
    level_key = f"levels/{ticket['levelDigest']}.json"
    evidence_key = f"evidence/{digest({'commands': commands, 'endTick': end_tick})}.json"
    assert store.get(level_key) == canonical(value)
    assert store.get(evidence_key) == canonical({"commands": commands, "endTick": end_tick})


def persisted(needle):
    observer = Postgres()
    escaped = str(needle).replace("'", "''")
    records = []
    for table in observer.tables():
        quoted = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        records.extend(observer.rows(
            f"SELECT to_jsonb(t) AS record FROM {quoted} AS t "
            f"WHERE strpos(to_jsonb(t)::text, '{escaped}') > 0"
        ))
    assert records, f"PostgreSQL must contain this test's durable record: {needle}"
    return records


def charge(value):
    return ("−" if value < 0 else "") + f"{abs(value) // CELL_WIDTH}.{abs(value) % CELL_WIDTH:03d}"


def game_time(tick):
    milliseconds = tick * (CELL_WIDTH // TICK_RATE)
    minutes, milliseconds = divmod(milliseconds, CELL_WIDTH * 60)
    seconds, milliseconds = divmod(milliseconds, CELL_WIDTH)
    return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def from_browser(page, base):
    api = API(base)
    for cookie in page.context.cookies():
        api.client.cookies.set(cookie["name"], cookie["value"])
    return api


def ui_login(page, person):
    click(page.get_by_role("button", name="Account", exact=True))
    fill(page.get_by_role("textbox", name="Email", exact=True), person["email"])
    fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in", exact=True))
    expect(page.get_by_role("region", name="Current player", exact=True)).to_contain_text(
        person["playerName"]
    )


def ui_account(page, base):
    email, name = fresh()
    click(page.get_by_role("button", name="Account", exact=True))
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_role("textbox", name="Player name", exact=True), name)
    fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/api/accounts")
    ) as response:
        click(page.get_by_role("button", name="Create account", exact=True))
    assert response.value.status == 201
    person = response.value.json()["account"]
    expect(page.get_by_role("region", name="Current player", exact=True)).to_contain_text(name)
    return from_browser(page, base), person


def ui_campaign(page):
    click(page.get_by_role("button", name="Campaign", exact=True))
    click(page.get_by_role("button", name="Inspect First Lantern", exact=True))
    click(page.get_by_role("button", name="Choose loadout", exact=True))
    check(page.get_by_role("checkbox", name="Wickwarden", exact=False))
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/api/runs")
    ) as response:
        click(page.get_by_role("button", name="Start defence", exact=True))
    assert response.value.status == 201
    ticket = response.value.json()["ticket"]
    expect(page.get_by_role("region", name="Defence", exact=True)).to_be_visible()
    return ticket


def ui_place(page, lane=3, cell=8, use_touch=False):
    activate = tap if use_touch else click
    activate(page.get_by_role("button", name="Plan", exact=True))
    planning = page.get_by_role("dialog", name="Planning", exact=True)
    expect(planning).to_be_visible()
    activate(page.get_by_role("button", name="Wickwarden", exact=True).last)
    square = planning.get_by_role("gridcell", name=f"Lane {lane}, cell {cell}", exact=True)
    activate(square)
    square.press("Enter")
    placement = page.get_by_role("dialog", name="Placement", exact=True)
    expect(placement).to_be_visible()
    activate(placement.get_by_role("button", name="Preview", exact=True))
    advance(page, BEAM_MS + CONTACT_MS)
    expect(page.get_by_role("region", name="Lantern Cast", exact=True)).to_have_attribute(
        "data-phase", "ready"
    )
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/commands/check")
    ) as checked:
        activate(placement.get_by_role("button", name="Place", exact=True))
    assert checked.value.status == 200
    return checked.value.request.post_data_json


def ui_practice_place(page):
    click(page.get_by_role("button", name="Plan", exact=True))
    planning = page.get_by_role("dialog", name="Planning", exact=True)
    expect(planning).to_be_visible()
    click(page.get_by_role("button", name="Wickwarden", exact=True).last)
    square = planning.get_by_role("gridcell", name="Lane 3, cell 8", exact=True)
    click(square)
    square.press("Enter")
    placement = page.get_by_role("dialog", name="Placement", exact=True)
    expect(placement).to_be_visible()
    click(placement.get_by_role("button", name="Preview", exact=True))
    advance(page, BEAM_MS + CONTACT_MS)
    expect(page.get_by_role("region", name="Lantern Cast", exact=True)).to_have_attribute(
        "data-phase", "ready"
    )
    click(placement.get_by_role("button", name="Place", exact=True))
    expect(planning).not_to_be_visible()
    expect(page.get_by_role("region", name="Selected cell", exact=True)).to_contain_text(
        "Wickwarden"
    )


def ui_finish(page):
    advance(page, MAX_TICKS * CELL_WIDTH // TICK_RATE)
    expect(page.get_by_role("region", name="Run result", exact=True)).to_be_visible()
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/submit")
    ) as submitted:
        click(page.get_by_role("button", name="Submit result", exact=True))
    assert submitted.value.status in (200, 202)
    return submitted.value.request.post_data_json


def ui_verify(page, api, ticket, value, body):
    result = eventually(
        lambda: api.get(f"/api/runs/{ticket['id']}")["result"],
        lambda r: r is not None and r["state"] in ("accepted", "rejected"),
        "browser submission must complete verification",
    )
    click(page.get_by_role("button", name="Refresh result", exact=True))
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
        "Harbour records loaded."
    )
    assert result["state"] == "accepted"
    assert result["metrics"]["outcome"] == "victory"
    expect(page.get_by_role("region", name="Run result", exact=True)).to_contain_text(
        "victory", ignore_case=True
    )
    frames, ledger = verify_run(
        api, ticket, value, body["commands"], result, body["endTick"],
    )
    expect(page.get_by_role("region", name="Run result", exact=True)).to_contain_text(
        game_time(result["metrics"]["completionTick"])
    )
    expect(page.get_by_role("region", name="Run result", exact=True)).to_contain_text(
        charge(result["metrics"]["remainingCharge"])
    )
    return result, frames, ledger


def ui_open_level(page, saved):
    click(page.get_by_role("button", name="Editor", exact=True))
    click(page.get_by_role("button", name=f"Open {saved['definition']['title']}", exact=True))
    expect(page.get_by_role("region", name="Saved revision", exact=True)).to_contain_text(
        saved["digest"]
    )


def ui_challenge(page, challenge):
    click(page.get_by_role("button", name="Community", exact=True))
    fill(page.get_by_role("textbox", name="Search challenges", exact=True), challenge["title"])
    click(page.get_by_role("button", name="Search", exact=True))
    click(page.get_by_role("button", name=f"Open challenge {challenge['title']}", exact=True))


def ui_board(page, challenge):
    ui_challenge(page, challenge)
    click(page.get_by_role("button", name="View leaderboard", exact=True))
    expect(page.get_by_role("table", name="Verified leaderboard", exact=True)).to_be_visible()


def ui_attempt(page):
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith("/api/runs")
    ) as response:
        click(page.get_by_role("button", name="Attempt challenge", exact=True))
        start = page.get_by_role("button", name="Start defence", exact=True)
        choose = page.get_by_role("button", name="Choose loadout", exact=True)
        defence = page.get_by_role("region", name="Defence", exact=True)
        expect(start.or_(choose).or_(defence).first).to_be_visible()
        if choose.is_visible():
            click(choose)
        if start.is_visible():
            check(page.get_by_role("checkbox", name="Wickwarden", exact=False))
            click(start)
    assert response.value.status == 201
    expect(page.get_by_role("region", name="Defence", exact=True)).to_be_visible()
    return response.value.json()["ticket"]


def expected_board(digest_value, contenders, viewer):
    best = {}
    for person, ticket, result, commands in contenders:
        m = result["metrics"]
        if result["state"] != "accepted" or m["outcome"] != "victory":
            continue
        key = (m["breaches"], m["completionTick"], -m["remainingCharge"])
        old = best.get(person["id"])
        if old is None or key < old[0]:
            best[person["id"]] = (key, person, ticket, result, commands)
    selected = sorted(best.values(), key=lambda x: (x[0], x[1]["id"]))
    rows = []
    prior = None
    rank = 0
    counts = Counter()
    for index, (key, person, ticket, result, commands) in enumerate(selected):
        if key != prior:
            rank = index + 1
        prior = key
        m = result["metrics"]
        rows.append({
            "rank": rank, "accountId": person["id"], "playerName": person["playerName"],
            "runId": ticket["id"], "breaches": m["breaches"],
            "completionTick": m["completionTick"], "remainingCharge": m["remainingCharge"],
        })
        counts.update(c["device"] for c in commands if c["type"] == "deploy")
    total = sum(counts.values())
    percentages = {
        device: counts[device] * USAGE_SCALE // total if total else 0
        for device in DEVICE_ORDER
    }
    if total:
        order = sorted(
            DEVICE_ORDER,
            key=lambda d: (-(counts[d] * USAGE_SCALE % total), DEVICE_ORDER.index(d)),
        )
        for device in order[:USAGE_SCALE - sum(percentages.values())]:
            percentages[device] += 1
    return {
        "digest": digest_value, "ruleset": "orrel-1", "rows": rows,
        "personalBest": next((r for r in rows if r["accountId"] == viewer), None),
        "completions": len(rows),
        "crewUsage": [
            {"device": d, "deployments": counts[d], "tenthsPercent": percentages[d]}
            for d in DEVICE_ORDER
        ],
    }


def compete(api, person, challenge, commands, loadout=None):
    ticket = issue(api, "challenge", challenge["digest"], loadout=loadout)
    result = terminal(api, ticket["id"], commands)
    assert result["state"] == "accepted"
    return person, ticket, result, commands


@contextmanager
def second_process():
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    with tempfile.TemporaryDirectory() as directory:
        logfile = Path(directory) / "serve.log"
        with logfile.open("w+") as output:
            environment = dict(os.environ, APP_PUBLIC_PORT=str(port))
            process = subprocess.Popen(
                manifest["serve"], cwd=DEPLOYED_APP, shell=True,
                env=environment, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            base = f"http://127.0.0.1:{port}"
            try:
                def health():
                    if process.poll() is not None:
                        output.flush()
                        pytest.fail("second app process exited:\n" + logfile.read_text())
                    try:
                        return httpx.get(base + "/api/health", timeout=HTTP_SECONDS)
                    except httpx.HTTPError:
                        return None
                eventually(
                    health, lambda r: r is not None and r.status_code == 200,
                    "second app process must serve liveness",
                )
                yield base
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, __import__("signal").SIGTERM)
                try:
                    process.wait(timeout=HTTP_SECONDS)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, __import__("signal").SIGKILL)
                    process.wait(timeout=HTTP_SECONDS)


def test_wf_arrival_victory(page, app_url):
    api, person = ui_account(page, app_url)
    click(page.get_by_role("button", name="Account", exact=True))
    click(page.get_by_role("button", name="Sign out", exact=True))
    ui_login(page, person)
    api = from_browser(page, app_url)
    assert api.get("/api/session")["account"] == person
    ticket = ui_campaign(page)
    assert ticket["accountId"] == person["id"]
    assert ticket["sourceId"] == "c1"
    ui_place(page)
    body = ui_finish(page)
    encounter = next(e for e in api.get("/api/campaign")["encounters"] if e["id"] == "c1")
    ui_verify(page, api, ticket, encounter["definition"], body)
    assert api.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    stored_objects(ticket, encounter["definition"], body["commands"], body["endTick"])
    persisted(ticket["id"])


def test_wf_arrival_practice(page, app_url):
    api, _ = ui_account(page, app_url)
    before = api.get("/api/progress")
    run_requests = []
    page.on("request", lambda r: run_requests.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/runs") else None)
    click(page.get_by_role("button", name="Tutorial", exact=True))
    click(page.get_by_role("button", name="Begin practice", exact=True))
    expect(page.get_by_role("region", name="Tutorial instructions", exact=True)).to_be_visible()
    ui_practice_place(page)
    advance(page, MAX_TICKS * CELL_WIDTH // TICK_RATE)
    click(page.get_by_role("button", name="Finish practice", exact=True))
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
        "Practice complete. No ranked result is submitted."
    )
    assert api.get("/api/progress") == before == {"completed": [], "unlocked": ["c1"]}
    assert not run_requests
    click(page.get_by_role("button", name="Restart practice", exact=True))
    expect(page.get_by_role("region", name="Tutorial instructions", exact=True)).to_be_visible()


def test_identity(app_url):
    api, person = account(app_url)
    persisted(person["email"])
    error(API(app_url), "GET", "/api/session", None, 401, "AUTH_REQUIRED",
          "Sign in to continue.")
    error(API(app_url), "POST", "/api/session",
          {"email": person["email"], "password": PASSWORD + "x"},
          401, "INVALID_CREDENTIALS", "Email or password is incorrect.")
    email, name = fresh()
    payload = {"email": email.upper(), "password": PASSWORD, "playerName": name}
    def create(_):
        return API(app_url).client.post("/api/accounts", json=payload)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["error"] == {
        "code": "EMAIL_EXISTS", "message": "This email already has an account.", "fields": {},
    }
    concurrent = login(app_url, person)
    revoked_cookie = api.client.cookies.get("squallglass_session")
    assert revoked_cookie
    api.request("DELETE", "/api/session", status=204)
    stale = API(app_url)
    stale.client.cookies.set("squallglass_session", revoked_cookie)
    error(stale, "GET", "/api/session", None, 401, "AUTH_REQUIRED")
    assert concurrent.get("/api/session")["account"] == person
    assert login(app_url, person).get("/api/session")["account"] == person


def test_rules(page, app_url):
    rules = API(app_url).get("/api/rules")
    assert set(rules) == RULE_ROOT
    assert rules["ruleset"] == "orrel-1"
    assert rules["tickRate"] == TICK_RATE
    assert rules["tickOrder"] == TICK_ORDER
    assert rules["arithmetic"] == {
        "positionUnit": "thousandth-cell", "chargeUnit": "milli-charge",
        "division": "half-away-from-zero", "salvageDivision": "floor",
        "contactDivision": "floor", "integerOnly": True, "wallClockInputs": False,
    }
    rng = rules["randomness"]
    assert rng["algorithm"] == "xorshift32"
    assert rng["example"] == {
        "seed": 1, "draws": [270369, 67634689, 2647435461], "lanes": [5, 5, 2],
    }
    assert rng["drawForExplicitLane"] is True
    assert rng["drawsPerSpawn"] == 1
    assert rng["otherGameplayDraws"] == rng["cosmeticDraws"] == 0
    assert rules["commandRules"]["reasonOrder"] == REASONS
    assert rules["commandRules"]["forecastTransitions"] == FORECAST_TICKS
    assert rules["commandRules"]["forecastPhases"] == [
        {"phase": "beam", "durationMs": BEAM_MS},
        {"phase": "contacts", "durationMs": CONTACT_MS},
        {"phase": "ready", "durationMs": 0},
    ]
    assert [d["id"] for d in rules["devices"]] == DEVICE_ORDER
    for actual, identifier, name, row in zip(
        rules["devices"], DEVICE_ORDER, DEVICE_NAMES, DEVICE_ROWS
    ):
        assert (actual["id"], actual["name"]) == (identifier, name)
        assert [actual[k] for k in ("cost", "upgradeCost", "range", "cooldown",
                                    "damage", "maxTargets")] == list(row)
    assert rules["limits"]["maxCompletedTicks"] == MAX_TICKS
    assert rules["limits"]["maxCommands"] == MAX_COMMANDS
    assert rules["limits"]["maxFramePage"] == FRAME_PAGE
    assert rules["rankingRules"]["usageScale"] == USAGE_SCALE
    assert rules["seasonRules"]["timeZone"] == "Asia/Kathmandu"
    click(page.get_by_role("button", name="Rules", exact=True))
    reference = page.get_by_role("region", name="Rules reference", exact=True)
    expect(reference).to_contain_text("orrel-1")
    for name in DEVICE_NAMES:
        expect(reference).to_contain_text(name)


def test_campaign_gates(app_url):
    api, _ = account(app_url)
    initial = api.get("/api/progress")
    assert initial == {"completed": [], "unlocked": ["c1"]}
    error(api, "POST", "/api/runs", {
        "mode": "campaign", "sourceId": "c2", "revision": None, "loadout": ["wick"],
    }, 409, "ENCOUNTER_LOCKED", "Complete the preceding encounter first.")
    ticket = issue(api)
    rejected = terminal(api, ticket["id"], [], end_tick=0)
    assert rejected["state"] == "rejected"
    assert api.get("/api/progress") == initial
    ticket = issue(api)
    result = terminal(api, ticket["id"], [command()])
    assert result["metrics"]["outcome"] == "victory"
    progress = api.get("/api/progress")
    assert progress == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    campaign = api.get("/api/campaign")
    assert campaign["progress"] == progress
    assert [e["id"] for e in campaign["encounters"] if e["completed"]] == ["c1"]
    assert [e["id"] for e in campaign["encounters"] if e["unlocked"]] == ["c1", "c2"]


def test_ticket_bindings(app_url):
    api, person = account(app_url)
    outsider, _ = account(app_url)
    saved = level(api)
    ticket = issue(api, "playtest", saved["id"], saved["revision"], ["wall", "wick"])
    assert ticket == {
        "id": ticket["id"], "accountId": person["id"], "mode": "playtest",
        "sourceId": saved["id"], "revision": saved["revision"], "seed": 1,
        "levelDigest": saved["digest"], "loadout": ["wall", "wick"],
        "ruleset": "orrel-1", "initialReserve": INITIAL_RESERVE, "initialHealth": 10,
        "seasonDay": None, "daily": False,
    }
    changed = copy.deepcopy(saved["definition"])
    changed["seed"] = MAX_SEED
    api.put(f"/api/levels/{saved['id']}", {
        "expectedRevision": 1, "definition": changed,
    })
    assert api.get(f"/api/runs/{ticket['id']}")["ticket"] == ticket
    error(outsider, "GET", f"/api/runs/{ticket['id']}", None, 404, "NOT_FOUND")
    result = terminal(api, ticket["id"], [command()])
    verify_run(api, ticket, saved["definition"], [command()], result)


def test_wf_defence_conservation(page, app_url):
    api, _ = ui_account(page, app_url)
    ticket = ui_campaign(page)
    ui_place(page)
    body = ui_finish(page)
    value = next(e["definition"] for e in api.get("/api/campaign")["encounters"]
                 if e["id"] == "c1")
    _, frames, ledger = ui_verify(page, api, ticket, value, body)
    movements = defaultdict(list)
    balances = Counter()
    for entry in ledger:
        movements[entry["movementId"]].append(entry)
        balances[entry["account"]] += entry["delta"]
    for entries in movements.values():
        assert len(entries) == 2
        assert entries[0]["delta"] <= 0
        assert entries[0]["delta"] + entries[1]["delta"] == 0
    last = frames[-1]
    assert balances["reserve"] == last["reserve"]
    assert balances["source"] == last["source"]
    assert balances["sink"] == last["sink"]
    assert last["reserve"] + last["sink"] + sum(
        d["installedCharge"] for d in last["devices"]
    ) == -last["source"]
    persisted(ticket["id"])


def test_wf_defence_forecast(page, app_url):
    api, _ = ui_account(page, app_url)
    ticket = ui_campaign(page)
    click(page.get_by_role("button", name="Plan", exact=True))
    planning = page.get_by_role("dialog", name="Planning", exact=True)
    click(page.get_by_role("button", name="Wickwarden", exact=True).last)
    observed = []
    for cell in (8, 9):
        square = planning.get_by_role("gridcell", name=f"Lane 3, cell {cell}", exact=True)
        click(square)
        square.press("Enter")
        placement = page.get_by_role("dialog", name="Placement", exact=True)
        click(placement.get_by_role("button", name="Preview", exact=True))
        advance(page, BEAM_MS + CONTACT_MS)
        forecast = page.get_by_role("region", name="Lantern Cast", exact=True)
        expect(forecast).to_have_attribute("data-phase", "ready")
        observed.append((
            page.get_by_role("table", name="Forecast events", exact=True)
                .get_by_role("row").count(),
            forecast.inner_text(),
        ))
        if cell == 8:
            click(placement.get_by_role("button", name="Cancel", exact=True))
            expect(square).to_be_focused()
        else:
            with page.expect_response(lambda r: r.url.endswith("/commands/check")) as checked:
                click(placement.get_by_role("button", name="Place", exact=True))
    request = checked.value.request.post_data_json
    tick = request["atTick"]
    value = next(e["definition"] for e in api.get("/api/campaign")["encounters"]
                 if e["id"] == "c1")
    baseline, _, _ = reproduce(value, 1, ticket["loadout"], request["commands"],
                               tick + FORECAST_TICKS)
    for cell, (row_count, text) in zip((8, 9), observed):
        proposal = dict(request["proposal"], cell=cell)
        proposed, _, _ = reproduce(
            value, 1, ticket["loadout"], request["commands"] + [proposal],
            tick + FORECAST_TICKS,
        )
        event_count = sum(len(f["events"]) for f in baseline[tick + 1:])
        event_count += sum(len(f["events"]) for f in proposed[tick + 1:])
        assert row_count == event_count + 1
        assert charge(DEVICES["wick"][0]) in text
        for branch in (baseline, proposed):
            assert game_time(branch[-1]["tick"]) in text
            assert charge(branch[-1]["reserve"]) in text
    body = ui_finish(page)
    _, actual, _ = ui_verify(page, api, ticket, value, body)
    confirmed, _, _ = reproduce(
        value, 1, ticket["loadout"], body["commands"], body["endTick"],
    )
    assert actual == confirmed


def test_integer_frames(app_url):
    api, _ = account(app_url)
    value = definition()
    value["seed"] = MAX_SEED
    value["waves"] = [
        {"tick": 0, "creature": creature, "count": 3, "interval": PERIOD, "lane": lane}
        for creature, lane in zip(CREATURE_ROWS, (3, 3, 0, 3))
    ]
    saved = level(api, value)
    commands = [
        command(1, cell=8), command(2, cell=9),
        command(3, lane=3, cell=7, device="wall"),
        command(4, lane=2, cell=8, device="gong"),
    ]
    ticket = issue(api, "playtest", saved["id"], 1, ["wick", "wall", "gong"])
    result = terminal(api, ticket["id"], commands)
    frames, _ = verify_run(api, ticket, value, commands, result)
    assert any(f["events"] for f in frames)
    assert any(e["kind"] == "damage" for f in frames for e in f["events"])
    assert any(e["kind"] == "death" for f in frames for e in f["events"])
    assert any(e["kind"] == "breach" for f in frames for e in f["events"])


def test_ledger_prefix(app_url):
    api, _ = account(app_url)
    saved = level(api)
    ticket = issue(api, "playtest", saved["id"], 1, ["siphon", "wick"])
    commands = [
        command(1, device="siphon", lane=1, cell=1),
        command(2, tick=PERIOD, kind="upgrade", lane=1, cell=1),
        command(3, tick=PERIOD, kind="salvage", lane=1, cell=1),
        command(4, tick=PERIOD, kind="salvage", lane=1, cell=1),
    ]
    result = terminal(api, ticket["id"], commands)
    frames, ledger = verify_run(api, ticket, saved["definition"], commands, result)
    assert result["failure"] == {
        "tick": PERIOD, "seq": 4, "reason": "No installed device",
    }
    assert frames[-1]["tick"] == PERIOD
    assert [e["reason"] for e in ledger if e["tick"] == PERIOD][-6:] == [
        "upgrade", "upgrade", "salvage-refund", "salvage-refund",
        "salvage-loss", "salvage-loss",
    ]
    assert sum(e["delta"] for e in ledger) == 0
    before = copy.deepcopy(ledger)
    assert api.post(f"/api/runs/{ticket['id']}/retry", {}) == result
    assert api.get(f"/api/runs/{ticket['id']}")["ledger"] == before
    persisted(ticket["id"])


def test_first_illegal_command(app_url):
    api, person = account(app_url)
    saved = level(api)
    cases = [
        ([command(kind="unknown")], "Unknown command"),
        ([command(), command(seq=1, cell=9)], "Command sequence is not increasing"),
        ([command(tick=1), command(seq=2, tick=0, cell=9)], "Command tick moved backwards"),
        ([command(lane=0)], "Invalid cell"),
        ([command(device="gong")], "Device is outside the loadout"),
        ([command(), command(seq=2)], "Cell is occupied"),
        ([command(kind="upgrade")], "No installed device"),
        ([command(), command(2, kind="upgrade"), command(3, kind="upgrade")],
         "Device is already upgraded"),
    ]
    for commands, reason in cases:
        ticket = issue(api, "playtest", saved["id"], 1)
        result = terminal(api, ticket["id"], commands, claims={
            "outcome": "victory", "health": 10, "remainingCharge": INITIAL_RESERVE,
        })
        assert result["state"] == "rejected"
        assert result["failure"]["reason"] == reason
        assert result["metrics"] is None
        assert api.get("/api/session")["account"] == person
        assert api.get("/api/progress") == {"completed": [], "unlocked": ["c1"]}
        assert api.get(f"/api/runs/{ticket['id']}")["proof"]["state"] == "failed"


def test_installation_lifecycle(app_url):
    api, _ = account(app_url)
    saved = level(api)
    commands = [
        command(), command(2, tick=1, kind="upgrade"),
        command(3, tick=2, kind="salvage"), command(4, tick=3),
    ]
    ticket = issue(api, "playtest", saved["id"], 1)
    result = terminal(api, ticket["id"], commands)
    frames, _ = verify_run(api, ticket, saved["definition"], commands, result)
    original = frames[1]["devices"][0]
    upgraded = frames[2]["devices"][0]
    assert original["id"] == upgraded["id"]
    assert original["nextFireTick"] == upgraded["nextFireTick"]
    assert upgraded["tier"] == "upgraded"
    assert frames[3]["devices"] == []
    replacement = frames[4]["devices"][0]
    assert replacement["id"] != original["id"]
    assert replacement["tier"] == "base"
    assert frames[3]["sink"] == (
        DEVICES["wick"][0] + DEVICES["wick"][1]
    ) // 2


def test_wf_verification_return_recovery(page, app_url):
    api, person = ui_account(page, app_url)
    ticket = ui_campaign(page)
    ui_place(page)
    body = ui_finish(page)
    result = terminal(api, ticket["id"], body["commands"], body["endTick"])
    click(page.get_by_role("button", name="Retry verification", exact=True))
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
        "Verified victory – your strategy's recorded."
    )
    assert api.get(f"/api/runs/{ticket['id']}")["result"] == result
    illegal = issue(api)
    rejected = terminal(api, illegal["id"], [command(kind="salvage")])
    assert rejected["failure"] == {"tick": 0, "seq": 1, "reason": "No installed device"}
    click(page.get_by_role("button", name="Account", exact=True))
    click(page.get_by_role("button", name="Sign out", exact=True))
    ui_login(page, person)
    returned = from_browser(page, app_url)
    assert returned.get(f"/api/runs/{ticket['id']}")["result"] == result
    assert returned.get(f"/api/runs/{illegal['id']}")["result"] == rejected
    assert returned.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}


def test_wf_verification_return_replay(page, app_url):
    api, _ = ui_account(page, app_url)
    ticket = ui_campaign(page)
    ui_place(page)
    body = ui_finish(page)
    value = next(e["definition"] for e in api.get("/api/campaign")["encounters"]
                 if e["id"] == "c1")
    cookie = api.client.cookies.get("squallglass_session")
    def replay(_):
        client = API(app_url)
        client.client.cookies.set("squallglass_session", cookie)
        return client.client.post(f"/api/runs/{ticket['id']}/submit", json=body)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(replay, range(2)))
    assert all(r.status_code in (200, 202) for r in responses)
    result = terminal(api, ticket["id"], body["commands"], body["endTick"])
    before = api.get(f"/api/runs/{ticket['id']}")["ledger"]
    assert api.post(f"/api/runs/{ticket['id']}/retry", {}) == result
    different = dict(body, commands=[])
    error(api, "POST", f"/api/runs/{ticket['id']}/submit", different,
          409, "EVIDENCE_CONFLICT", "This ticket already holds different command evidence.")
    assert api.get(f"/api/runs/{ticket['id']}")["ledger"] == before
    verify_run(api, ticket, value, body["commands"], result, body["endTick"])
    stored_objects(ticket, value, body["commands"], body["endTick"])
    persisted(ticket["id"])


def test_independent_acceptance(app_url):
    api, _ = account(app_url)
    value = definition()
    value["waves"][0]["count"] = 10
    saved = level(api, value)
    ticket = issue(api, "playtest", saved["id"], 1)
    commands = []
    result = terminal(api, ticket["id"], commands, claims={
        "outcome": "victory", "breaches": 0, "completionTick": 1,
        "remainingCharge": INITIAL_RESERVE, "health": 10, "unlocks": ["c2"],
    })
    frames, _ = verify_run(api, ticket, value, commands, result)
    assert frames[-1]["outcome"] == "defeat"
    assert frames[-1]["health"] == 0
    stored_objects(ticket, value, commands)
    assert api.get("/api/progress") == {"completed": [], "unlocked": ["c1"]}


def test_persistent_return(app_url):
    api, person = account(app_url)
    ticket = issue(api)
    result = terminal(api, ticket["id"], [command()])
    before = api.get(f"/api/runs/{ticket['id']}")
    api.request("DELETE", "/api/session", status=204)
    returned = login(app_url, person)
    assert returned.get(f"/api/runs/{ticket['id']}") == before
    assert returned.get(f"/api/runs/{ticket['id']}")["result"] == result
    assert returned.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    persisted(person["email"])
    persisted(ticket["id"])


def test_accepted_effects(app_url):
    api, _ = account(app_url)
    ticket = issue(api)
    result = terminal(api, ticket["id"], [command()])
    assert result["metrics"]["outcome"] == "victory"
    assert api.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    assert api.post(f"/api/runs/{ticket['id']}/retry", {}) == result
    assert api.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    persisted(ticket["id"])


def test_wf_maker_proof_revision(page, app_url):
    api, person = account(app_url)
    saved = level(api)
    old_ticket, _ = proof(api, saved)
    ui_login(page, person)
    ui_open_level(page, saved)
    _, title = fresh()
    fill(page.get_by_role("textbox", name="Level title", exact=True), title)
    fill(page.get_by_role("textbox", name="Description", exact=True), "雪 🌊 é")
    fill(page.get_by_role("spinbutton", name="Seed", exact=True), str(MAX_SEED))
    select(page.get_by_role("combobox", name="Difficulty", exact=True), "rough")
    fill(page.get_by_role("textbox", name="Wave 1 time", exact=True), game_time(1))
    fill(page.get_by_role("textbox", name="Wave 1 interval", exact=True), game_time(PERIOD))
    with page.expect_response(
        lambda r: r.request.method == "PUT" and r.url.endswith(f"/api/levels/{saved['id']}")
    ) as response:
        click(page.get_by_role("button", name="Save private level", exact=True))
    assert response.value.status == 200
    revised = response.value.json()
    expected = copy.deepcopy(saved["definition"])
    expected.update(title=title, description="雪 🌊 é", seed=MAX_SEED, difficulty="rough")
    expected["waves"][0].update(tick=1, interval=PERIOD)
    assert revised["definition"] == expected
    assert revised["digest"] == digest(expected)
    assert revised["revision"] == 2
    assert revised["proofRunId"] is None
    assert next(p for p in revised["proofs"] if p["runId"] == old_ticket["id"])["state"] == "obsolete"
    ui_open_level(page, revised)
    expect(page.get_by_role("textbox", name="Wave 1 time", exact=True)).to_have_value(game_time(1))
    expect(page.get_by_role("textbox", name="Wave 1 interval", exact=True)).to_have_value(game_time(PERIOD))
    new_ticket, result = proof(api, revised)
    verify_run(api, new_ticket, expected, [command()], result)
    stored_objects(new_ticket, expected, [command()])
    assert api.get(f"/api/runs/{old_ticket['id']}")["ticket"] == old_ticket
    error(api, "POST", f"/api/levels/{saved['id']}/publish", {
        "expectedRevision": 2, "proofRunId": old_ticket["id"],
    }, 409, "PROOF_REQUIRED")


def test_wf_maker_proof_isolation(page, app_url):
    api, person = account(app_url)
    outsider, other = account(app_url)
    saved = level(api)
    with open_app(page.context.browser, app_url) as other_page:
        ui_login(other_page, other)
        click(other_page.get_by_role("button", name="Editor", exact=True))
        expect(other_page.get_by_role("region", name="Private levels", exact=True)).not_to_contain_text(
            saved["definition"]["title"]
        )
    error(outsider, "GET", f"/api/levels/{saved['id']}", None, 404, "NOT_FOUND")
    ui_login(page, person)
    ui_open_level(page, saved)
    cookie = api.client.cookies.get("squallglass_session")
    variants = [copy.deepcopy(saved["definition"]) for _ in range(2)]
    variants[0]["seed"] = 1
    variants[1]["seed"] = MAX_SEED
    def save(value):
        client = API(app_url)
        client.client.cookies.set("squallglass_session", cookie)
        return client.client.put(f"/api/levels/{saved['id']}", json={
            "expectedRevision": 1, "definition": value,
        })
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, variants))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert next(r for r in responses if r.status_code == 409).json()["error"]["code"] == "REVISION_CHANGED"
    winner = next(r.json() for r in responses if r.status_code == 200)
    ui_open_level(page, winner)
    assert api.get(f"/api/levels/{saved['id']}") == winner


def test_wf_maker_proof_limits(page, app_url):
    api, person = account(app_url)
    ui_login(page, person)
    for seed in (1, MAX_SEED):
        value = definition()
        value["seed"] = seed
        assert level(api, value)["definition"]["seed"] == seed
    cases = []
    for seed in (0, MAX_SEED + 1, True, "1"):
        value = definition()
        value["seed"] = seed
        cases.append((value, "definition.seed"))
    value = definition()
    value["waves"] = value["waves"] * (MAX_WAVES + 1)
    cases.append((value, "definition.waves"))
    value = definition()
    value["waves"][0]["count"] = MAX_CREATURES + 1
    cases.append((value, "definition.waves"))
    value = definition()
    value["waves"][0]["interval"] = 0
    cases.append((value, "definition.waves[0].interval"))
    value = definition()
    value["waves"][0]["tick"] = MAX_TICKS
    cases.append((value, "definition.waves[0].tick"))
    for value, path in cases:
        before = {x["id"] for x in api.get("/api/levels")["levels"]}
        started = time.monotonic()
        error(api, "POST", "/api/levels", {"definition": value}, 422, "INVALID_FIELDS",
              "Check the highlighted fields.", {path: "Use a permitted value."})
        assert time.monotonic() - started < 2
        assert {x["id"] for x in api.get("/api/levels")["levels"]} == before
    saved = level(api)
    ticket = issue(api, "playtest", saved["id"], 1)
    for path, size in (
        (f"/api/runs/{ticket['id']}/submit", COMMAND_BYTES),
        ("/api/levels", OTHER_BYTES),
    ):
        response = api.client.post(
            path, content=b" " * (size + 1), headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert response.json()["error"] == {
            "code": "BODY_TOO_LARGE",
            "message": "This request exceeds the published byte limit.", "fields": {},
        }
    assert api.get(f"/api/runs/{ticket['id']}")["state"] == "playing"
    ui_open_level(page, saved)
    before = api.get(f"/api/levels/{saved['id']}")
    fill(page.get_by_role("spinbutton", name="Seed", exact=True), str(MAX_SEED + 1))
    click(page.get_by_role("button", name="Save private level", exact=True))
    expect(page.get_by_role("alert", name="Harbour error", exact=True)).to_contain_text(
        "Use a permitted value."
    )
    assert api.get(f"/api/levels/{saved['id']}") == before
    fill(page.get_by_role("spinbutton", name="Seed", exact=True), str(MAX_SEED))
    with page.expect_response(
        lambda r: r.request.method == "PUT"
        and r.url.endswith(f"/api/levels/{saved['id']}")
    ) as response:
        click(page.get_by_role("button", name="Save private level", exact=True))
    assert response.value.status == 200
    changed = response.value.json()
    expected = copy.deepcopy(saved["definition"])
    expected["seed"] = MAX_SEED
    assert changed["definition"] == expected
    assert changed["revision"] == saved["revision"] + 1
    assert api.get(f"/api/levels/{saved['id']}") == changed
    ui_open_level(page, changed)


def test_proof_qualification(app_url):
    api, _ = account(app_url)
    saved = level(api)
    pending = issue(api, "playtest", saved["id"], 1)
    assert api.get(f"/api/runs/{pending['id']}")["proof"]["state"] == "pending"
    error(api, "POST", f"/api/levels/{saved['id']}/publish", {
        "expectedRevision": 1, "proofRunId": pending["id"],
    }, 409, "PROOF_REQUIRED")
    failed = issue(api, "playtest", saved["id"], 1)
    terminal(api, failed["id"], [], end_tick=0)
    assert api.get(f"/api/runs/{failed['id']}")["proof"]["state"] == "failed"
    qualified, _ = proof(api, saved)
    current = api.get(f"/api/levels/{saved['id']}")
    assert current["proofRunId"] == qualified["id"]
    assert api.get(f"/api/runs/{qualified['id']}")["proof"] == {
        "runId": qualified["id"], "revision": 1, "state": "qualified",
    }
    revised = api.put(f"/api/levels/{saved['id']}", {
        "expectedRevision": 1, "definition": saved["definition"],
    })
    assert revised["proofRunId"] is None
    assert api.get(f"/api/runs/{qualified['id']}")["proof"]["state"] == "obsolete"
    assert api.get(f"/api/runs/{failed['id']}")["proof"]["state"] == "failed"


def test_wf_publication_commit(page, app_url, meilisearch):
    api, person = account(app_url)
    saved = level(api)
    ticket, _ = proof(api, saved)
    ui_login(page, person)
    ui_open_level(page, saved)
    with page.expect_response(lambda r: r.url.endswith(f"/api/levels/{saved['id']}/publish")) as response:
        click(page.get_by_role("button", name="Publish challenge", exact=True))
    assert response.value.status in (201, 202)
    publication_response = response.value
    if publication_response.status == 202:
        expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
            "Publication pending. Your challenge is still private; retry publication."
        )

        def retry_publication():
            with page.expect_response(
                lambda r: r.request.method == "POST"
                and r.url.endswith(f"/api/levels/{saved['id']}/publish")
            ) as retried:
                click(page.get_by_role("button", name="Retry publication", exact=True))
            assert retried.value.status in (200, 201, 202)
            return retried.value

        publication_response = eventually(
            retry_publication, lambda r: r.status in (200, 201),
            "browser Retry publication must recover pending publication",
        )
    challenge = publication_response.json()
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
        "Challenge published."
    )
    current = api.get(f"/api/levels/{saved['id']}")
    assert current["state"] == "published"
    assert current["challengeDigest"] == digest({
        "levelDigest": saved["digest"], "ruleset": "orrel-1",
    })
    assert challenge["digest"] == current["challengeDigest"]
    assert challenge["definition"] == saved["definition"]
    assert challenge["proofRunId"] == ticket["id"]
    stored_objects(ticket, saved["definition"], [command()])
    replay = API(app_url).get(f"/api/results/{ticket['id']}/replay")
    assert replay["definition"] == saved["definition"]
    assert replay["commands"] == [command()]
    assert publish(api, saved, ticket["id"]) == challenge
    eventually(
        lambda: api.get("/api/challenges", params={"q": saved["definition"]["title"]}),
        lambda r: any(c["digest"] == challenge["digest"] for c in r["challenges"]),
        "published challenge must become discoverable",
    )
    meilisearch.settled()
    assert meilisearch.document("published_challenges", challenge["digest"]) == {
        k: challenge[k]
        for k in ("digest", "ruleset", "title", "description", "difficulty", "creatorName")
    }


def test_wf_publication_outage(browser, app_url):
    outage = os.environ["APP_MINIO_DOWN_URL"]
    api, person = account(app_url)
    saved = level(api)
    ticket, _ = proof(api, saved)
    down = login(outage, person)
    with open_app(browser, outage) as page:
        ui_login(page, person)
        ui_open_level(page, saved)
        with page.expect_response(lambda r: r.url.endswith(f"/api/levels/{saved['id']}/publish")) as response:
            click(page.get_by_role("button", name="Publish challenge", exact=True))
        assert response.value.status == 202
        pending = response.value.json()
        assert pending["state"] == "proof-pending"
        expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
            "Publication pending. Your challenge is still private; retry publication."
        )
        identity = digest({"levelDigest": saved["digest"], "ruleset": "orrel-1"})
        error(api, "GET", f"/api/challenges/{identity}", None, 404, "NOT_FOUND")
        error(api, "GET", f"/api/challenges/{identity}/leaderboard", None, 404, "NOT_FOUND")
        assert down.get(f"/api/levels/{saved['id']}")["state"] == "proof-pending"
    challenge = publish(api, saved, ticket["id"])
    assert challenge["digest"] == identity
    assert API(app_url).get(f"/api/challenges/{identity}") == challenge


def test_wf_discovery_attempt(page, app_url, meilisearch):
    maker, _, saved, _, challenge = published(app_url)
    competitor, person = account(app_url)
    meilisearch.settled()
    ui_login(page, person)
    ui_challenge(page, challenge)
    ticket = ui_attempt(page)
    assert ticket["sourceId"] == challenge["digest"]
    assert ticket["levelDigest"] == saved["digest"]
    assert ticket["seed"] == saved["definition"]["seed"]
    assert ticket["revision"] is None
    ui_place(page)
    body = ui_finish(page)
    result, _, _ = ui_verify(page, competitor, ticket, challenge["definition"], body)
    board = competitor.get(f"/api/challenges/{challenge['digest']}/leaderboard")
    assert board == expected_board(
        challenge["digest"], [(person, ticket, result, body["commands"])], person["id"],
    )
    ui_board(page, challenge)
    table = page.get_by_role("table", name="Verified leaderboard", exact=True)
    expect(table).to_contain_text(person["playerName"])
    expect(table).to_contain_text(game_time(result["metrics"]["completionTick"]))
    expect(table).to_contain_text(charge(result["metrics"]["remainingCharge"]))
    stored_objects(ticket, challenge["definition"], body["commands"], body["endTick"])


def test_discovery_provider(app_url, meilisearch):
    api, person = account(app_url)
    _, token = fresh()
    value = definition("É" + token)
    value["description"] = "雪"
    saved = level(api, value)
    ticket, _ = proof(api, saved)
    challenge = publish(api, saved, ticket["id"])
    eventually(
        lambda: api.get("/api/challenges", params={"q": "e" + token.upper()}),
        lambda r: any(c["digest"] == challenge["digest"] for c in r["challenges"]),
        "case/accent normalized indexed challenge must arrive",
    )
    meilisearch.settled()
    document = meilisearch.document("published_challenges", challenge["digest"])
    assert document == {k: challenge[k] for k in (
        "digest", "ruleset", "title", "description", "difficulty", "creatorName",
    )}
    settings = meilisearch.settings("published_challenges")
    assert {"difficulty", "ruleset"} <= set(settings["filterableAttributes"])
    assert {"title", "digest"} <= set(settings["sortableAttributes"])
    assert settings["typoTolerance"]["enabled"] is False
    provider = meilisearch.search(
        "published_challenges", "e" + token.upper(),
        filter='difficulty = "calm" AND ruleset = "orrel-1"',
        matchingStrategy="all",
    )
    assert challenge["digest"] in {hit["digest"] for hit in provider["hits"]}
    for difficulty, present in (("calm", True), ("rough", False)):
        response = api.get("/api/challenges", params={
            "q": "e" + token.upper(), "difficulty": difficulty, "ruleset": "orrel-1",
        })
        assert (challenge["digest"] in {c["digest"] for c in response["challenges"]}) is present
    error(api, "GET", "/api/challenges?ruleset=unknown", None, 422, "INVALID_FIELDS",
          fields={"ruleset": "Use a permitted value."})
    api.post(f"/api/levels/{saved['id']}/withdraw", {"expectedRevision": 1})
    assert challenge["digest"] not in {
        c["digest"] for c in api.get("/api/challenges", params={"q": value["title"]})["challenges"]
    }
    eventually(
        lambda: meilisearch.document("published_challenges", challenge["digest"]),
        lambda d: d is None, "withdrawal index work must settle without restart",
        seconds=INDEX_SECONDS,
    )


def test_wf_discovery_withdrawal(page, app_url):
    maker, person, saved, proof_ticket, challenge = published(app_url)
    competitor, other = account(app_url)
    issued = issue(competitor, "challenge", challenge["digest"])
    ui_login(page, person)
    ui_open_level(page, maker.get(f"/api/levels/{saved['id']}"))
    click(page.get_by_role("button", name="Withdraw level", exact=True))
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_contain_text(
        "Challenge withdrawn."
    )
    assert maker.get(f"/api/levels/{saved['id']}")["state"] == "unlisted"
    public = API(app_url)
    error(public, "GET", f"/api/challenges/{challenge['digest']}", None, 404, "NOT_FOUND")
    error(competitor, "POST", "/api/runs", {
        "mode": "challenge", "sourceId": challenge["digest"], "revision": None,
        "loadout": ["wick"],
    }, 404, "NOT_FOUND")
    result = terminal(competitor, issued["id"], [command()])
    assert result["state"] == "accepted"
    board = public.get(f"/api/challenges/{challenge['digest']}/leaderboard")
    assert board["rows"][0]["runId"] == issued["id"]
    replay = public.get(f"/api/results/{issued['id']}/replay")
    assert replay["definition"] == challenge["definition"]
    assert replay["metrics"] == result["metrics"]
    assert public.get(f"/api/results/{proof_ticket['id']}/replay")["ticket"] == proof_ticket
    assert challenge["digest"] not in {
        c["digest"] for c in public.get("/api/challenges", params={"q": challenge["title"]})["challenges"]
    }


def test_wf_season_comparison_ties(page, app_url):
    _, _, _, _, challenge = published(app_url)
    a, alice = account(app_url)
    b, bob = account(app_url)
    contenders = [
        compete(a, alice, challenge, [command()]),
        compete(b, bob, challenge, [command()]),
    ]
    worse = [command(), command(2, lane=1, cell=1, device="siphon")]
    contenders.append(compete(a, alice, challenge, worse, ["wick", "siphon"]))
    board = a.get(f"/api/challenges/{challenge['digest']}/leaderboard")
    assert board == expected_board(challenge["digest"], contenders, alice["id"])
    assert [row["rank"] for row in board["rows"]] == [1, 1]
    assert [row["accountId"] for row in board["rows"]] == sorted([alice["id"], bob["id"]])
    ui_login(page, alice)
    ui_board(page, challenge)
    table = page.get_by_role("table", name="Verified leaderboard", exact=True)
    expect(table).to_contain_text(alice["playerName"])
    expect(table).to_contain_text(bob["playerName"])
    expect(page.get_by_role("region", name="Challenge completions", exact=True)).to_contain_text("2")
    for usage in board["crewUsage"]:
        percentage = f"{usage['tenthsPercent'] // 10}.{usage['tenthsPercent'] % 10}%"
        expect(page.get_by_role("table", name="Crew usage", exact=True)).to_contain_text(
            percentage
        )
    assert API(app_url).get(
        f"/api/challenges/{challenge['digest']}/leaderboard"
    )["personalBest"] is None


def test_rankings(app_url):
    _, _, _, _, challenge = published(app_url)
    a, alice = account(app_url)
    b, bob = account(app_url)
    contenders = [compete(a, alice, challenge, [command()])]
    two_devices = [command(), command(2, lane=1, cell=1, device="wall")]
    contenders.append(compete(b, bob, challenge, two_devices, ["wick", "wall"]))
    contenders.append(compete(a, alice, challenge, [command()]))
    rejected = issue(a, "challenge", challenge["digest"])
    assert terminal(a, rejected["id"], [command(kind="salvage")])["state"] == "rejected"
    expected = expected_board(challenge["digest"], contenders, alice["id"])
    assert a.get(f"/api/challenges/{challenge['digest']}/leaderboard") == expected
    assert b.get(f"/api/challenges/{challenge['digest']}/leaderboard") == expected_board(
        challenge["digest"], contenders, bob["id"],
    )
    assert sum(x["tenthsPercent"] for x in expected["crewUsage"]) == USAGE_SCALE
    assert expected["rows"][0]["runId"] == contenders[0][1]["id"]
    assert expected["crewUsage"][0]["tenthsPercent"] == (
        2 * USAGE_SCALE // 3 + 1
    )


def test_wf_season_comparison_surfaces(page, app_url, meilisearch):
    api, person = account(app_url)
    ui_login(page, person)
    click(page.get_by_role("button", name="Community", exact=True))
    cases = [
        ("1970-01-01T04:59:59.999+05:45", "1969-12-31"),
        ("1970-01-01T05:00:00.000+05:45", "1970-01-01"),
    ]
    for instant, day in cases:
        fill(page.get_by_role("textbox", name="Season instant", exact=True), instant)
        with page.expect_response(lambda r: "/api/season?" in r.url) as response:
            click(page.get_by_role("button", name="Inspect season", exact=True))
        assert response.value.status == 200
        season = response.value.json()
        assert season["seasonDay"] == day
        assert season["localTime"] == instant
        assert season["streak"] == 0
        summary = page.get_by_role("region", name="Season summary", exact=True)
        expect(summary).to_contain_text(day)
        expect(summary).to_contain_text(season["localTime"])
        expect(page.get_by_role("region", name="Season streak", exact=True)).to_contain_text("0")
        if season["dailyDigest"] is not None:
            expect(page.get_by_role("region", name="Daily challenge", exact=True)).to_be_visible()
            assert season["standings"]["digest"] == season["dailyDigest"]
    _, _, _, _, challenge = published(app_url)
    meilisearch.settled()
    ui_challenge(page, challenge)
    ticket = ui_attempt(page)
    ui_place(page)
    body = ui_finish(page)
    ui_verify(page, api, ticket, challenge["definition"], body)
    board = api.get(f"/api/challenges/{challenge['digest']}/leaderboard")
    assert board["digest"] == challenge["digest"] and len(board["rows"]) == 1


def test_season_computation(app_url):
    api, _ = account(app_url)
    season_rules = api.get("/api/rules")["seasonRules"]
    local = datetime.fromisoformat(
        season_rules["selectionEpoch"] + "T" + season_rules["dayStart"]
        + ":00.000" + season_rules["utcOffset"]
    )
    local_text = local.isoformat(timespec="milliseconds")
    utc_text = local.astimezone(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    first = api.get("/api/season", params={"at": local_text})
    equivalent = api.get("/api/season", params={"at": utc_text})
    assert first == equivalent
    assert first["instant"] == utc_text
    assert first["localTime"] == local_text
    assert first["seasonDay"] == local.date().isoformat()
    assert first["streak"] == 0
    _, _, _, _, challenge = published(app_url)
    assert api.get("/api/season", params={
        "at": local_text
    })["dailyDigest"] == first["dailyDigest"]
    ticket = issue(api, "challenge", challenge["digest"])
    context = api.get("/api/season", params={
        "at": ticket["seasonDay"] + "T05:00:00.000+05:45"
    })
    assert context["seasonDay"] == ticket["seasonDay"]
    assert ticket["daily"] is (context["dailyDigest"] == challenge["digest"])
    for invalid in (
        "1970-01-01T05:00:00",
        "1970-02-30T05:00:00Z",
        "1970-01-01T05:00:00.0000Z",
    ):
        response = api.client.get("/api/season", params={"at": invalid})
        assert response.status_code == 422
        assert response.json()["error"]["fields"] == {"at": "Use a permitted value."}


def test_wf_shared_replay_presentation(page, app_url):
    _, _, _, _, challenge = published(app_url)
    api, person = account(app_url)
    commands = [command(cell=1)]
    ticket = issue(api, "challenge", challenge["digest"])
    result = terminal(api, ticket["id"], commands)
    frames, _ = verify_run(api, ticket, challenge["definition"], commands, result)
    ui_login(page, person)
    ui_board(page, challenge)
    click(page.get_by_role("button", name=f"Watch replay {ticket['id']}", exact=True))
    initial = api.get(f"/api/results/{ticket['id']}/snapshot")
    assert initial["playback"] == {"version": 0, "tick": 0, "playing": False}
    click(page.get_by_role("button", name="Share playback", exact=True))
    click(page.get_by_role("button", name="Play replay", exact=True))
    advance(page, CELL_WIDTH)
    click(page.get_by_role("button", name="Pause replay", exact=True))
    snapshot = eventually(
        lambda: api.get(f"/api/results/{ticket['id']}/snapshot"),
        lambda s: s["playback"]["tick"] > 0 and not s["playback"]["playing"],
        "owner playback must persist an advanced paused cursor",
    )
    assert snapshot["playback"]["version"] > initial["playback"]["version"]
    assert snapshot["frame"] == frames[snapshot["playback"]["tick"]]
    assert snapshot["leaderboard"] == api.get(
        f"/api/challenges/{challenge['digest']}/leaderboard"
    )
    click(page.get_by_role("button", name="Restart replay", exact=True))
    restarted = eventually(
        lambda: api.get(f"/api/results/{ticket['id']}/snapshot"),
        lambda s: s["playback"]["tick"] == 0,
        "restart must publish cursor zero immediately",
    )
    assert restarted["frame"] == frames[0]
    persisted(ticket["id"])


def test_replay_evidence_access(app_url):
    api, _ = account(app_url)
    outsider, _ = account(app_url)
    saved = level(api)
    ticket, result = proof(api, saved)
    for client in (api, outsider, API(app_url)):
        for suffix in ("replay", "snapshot"):
            error(client, "GET", f"/api/results/{ticket['id']}/{suffix}",
                  None, 404, "NOT_FOUND")
    challenge = publish(api, saved, ticket["id"])
    replay = API(app_url).get(f"/api/results/{ticket['id']}/replay")
    assert replay == {
        "ticket": ticket, "definition": saved["definition"], "commands": [command()],
        "endTick": MAX_TICKS, "metrics": result["metrics"],
    }
    stored_objects(ticket, saved["definition"], [command()])
    foreign = outsider.put(f"/api/results/{ticket['id']}/playback", {
        "expectedVersion": 0, "tick": 0, "playing": False,
    }, status=403)
    assert foreign["error"] == {
        "code": "FORBIDDEN", "message": "Only this run's owner can share playback.", "fields": {},
    }
    assert API(app_url).get(f"/api/results/{ticket['id']}/snapshot")["playback"] == {
        "version": 0, "tick": 0, "playing": False,
    }
    assert challenge["proofRunId"] == ticket["id"]


def test_wf_shared_replay_cross_process(browser, app_url):
    _, _, _, _, challenge = published(app_url)
    owner, person = account(app_url)
    viewer, other = account(app_url)
    ticket = issue(owner, "challenge", challenge["digest"])
    result = terminal(owner, ticket["id"], [command(cell=1)])
    with second_process() as other_url:
        remote_owner = login(other_url, person)
        with open_app(browser, app_url) as presenter, open_app(browser, other_url) as follower:
            ui_login(presenter, person)
            ui_login(follower, other)
            for page in (presenter, follower):
                ui_board(page, challenge)
                click(page.get_by_role("button", name=f"Watch replay {ticket['id']}", exact=True))
            click(presenter.get_by_role("button", name="Share playback", exact=True))
            click(follower.get_by_role("button", name="Follow playback", exact=True))
            initial = owner.get(f"/api/results/{ticket['id']}/snapshot")["playback"]
            updated = owner.put(f"/api/results/{ticket['id']}/playback", {
                "expectedVersion": initial["version"], "tick": 1, "playing": False,
            })
            advance(follower, LIVE_MS)
            click(follower.get_by_role("button", name="Inspect crew 3, 1", exact=True))
            inspector = follower.get_by_role("region", name="Crew inspector", exact=True)
            close = follower.get_by_role("button", name="Close inspector", exact=True)
            close.focus()
            before = inspector.inner_text()
            attempt = compete(viewer, other, challenge, [command()])
            owner.put(f"/api/results/{ticket['id']}/playback", {
                "expectedVersion": updated["version"], "tick": 2, "playing": False,
            })
            advance(follower, LIVE_MS)
            expect(close).to_be_focused()
            expect(inspector).to_have_text(before)
            remote = remote_owner.get(f"/api/results/{ticket['id']}/snapshot")
            assert remote["playback"]["tick"] == 2
            expected_frames, _, _ = reproduce(
                challenge["definition"], ticket["seed"], ticket["loadout"],
                [command(cell=1)], MAX_TICKS,
            )
            assert remote["frame"] == expected_frames[2]
            assert attempt[1]["id"] in {r["runId"] for r in remote["leaderboard"]["rows"]}
            expect(follower.get_by_role("region", name="Shared playback", exact=True)).to_contain_text(
                str(remote["playback"]["version"])
            )


def test_wf_cross_cutting_keyboard(page, app_url):
    ui_account(page, app_url)
    ui_campaign(page)
    click(page.get_by_role("button", name="Plan", exact=True))
    planning = page.get_by_role("dialog", name="Planning", exact=True)
    chart = planning.get_by_role("grid", name="Harbour chart", exact=True)
    cells = chart.get_by_role("gridcell")
    assert sum(c.get_attribute("tabindex") == "0" for c in cells.all()) == 1
    square = chart.get_by_role("gridcell", name="Lane 3, cell 8", exact=True)
    square.focus()
    square.press("Home")
    expect(chart.get_by_role("gridcell", name="Lane 3, cell 1", exact=True)).to_be_focused()
    page.keyboard.press("ArrowLeft")
    expect(chart.get_by_role("gridcell", name="Lane 3, cell 1", exact=True)).to_be_focused()
    page.keyboard.press("End")
    end = chart.get_by_role("gridcell", name="Lane 3, cell 9", exact=True)
    expect(end).to_be_focused()
    button = page.get_by_role("button", name="Wickwarden", exact=True).last
    button.focus()
    page.keyboard.press("1")
    end.focus()
    end.press("Enter")
    placement = page.get_by_role("dialog", name="Placement", exact=True)
    expect(placement).to_be_visible()
    tab_order(page, placement.get_by_role("button").count() + 1)
    assert placement.evaluate("(d) => d.contains(document.activeElement)")
    page.keyboard.press("Shift+Tab")
    assert placement.evaluate("(d) => d.contains(document.activeElement)")
    page.keyboard.press("Escape")
    expect(end).to_be_focused()
    expect(planning).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.get_by_role("region", name="Defence", exact=True)).to_be_visible()


def test_wf_cross_cutting_touch(browser, app_url):
    api, person = account(app_url)
    for width, height in VIEWPORTS:
        with open_app(browser, app_url) as page:
            page.set_viewport_size({"width": width, "height": height})
            ui_login(page, person)
            ticket = ui_campaign(page)
            layout(page)
            grid = page.get_by_role("grid", name="Harbour chart", exact=True).last
            for square in grid.get_by_role("gridcell").all():
                box = square.bounding_box()
                assert box is not None
                assert box["width"] >= TARGET_SIZE
                assert box["height"] >= TARGET_SIZE
            tap(page.get_by_role("button", name="Plan", exact=True))
            planning = page.get_by_role("dialog", name="Planning", exact=True)
            tap(page.get_by_role("button", name="Wickwarden", exact=True).last)
            cell = planning.get_by_role("gridcell", name="Lane 3, cell 8", exact=True)
            tap(cell)
            tap(cell)
            cell.press("Enter")
            placement = page.get_by_role("dialog", name="Placement", exact=True)
            reserve_before = api.get(f"/api/runs/{ticket['id']}")["ledger"]
            tap(placement.get_by_role("button", name="Preview", exact=True))
            advance(page, BEAM_MS + CONTACT_MS)
            assert api.get(f"/api/runs/{ticket['id']}")["ledger"] == reserve_before
            expect(placement).to_be_visible()
            with page.expect_response(lambda r: r.url.endswith("/commands/check")) as response:
                tap(placement.get_by_role("button", name="Place", exact=True))
            assert response.value.status == 200
            assert response.value.json()["state"]["reserve"] < INITIAL_RESERVE
            layout(page)


def test_forecast_motion(browser, app_url):
    for reduced in ("no-preference", "reduce"):
        with open_app(browser, app_url, reduced_motion=reduced) as page:
            ui_account(page, app_url)
            ui_campaign(page)
            click(page.get_by_role("button", name="Plan", exact=True))
            planning = page.get_by_role("dialog", name="Planning", exact=True)
            click(page.get_by_role("button", name="Wickwarden", exact=True).last)
            square = planning.get_by_role("gridcell", name="Lane 3, cell 8", exact=True)
            click(square)
            square.press("Enter")
            click(page.get_by_role("dialog", name="Placement", exact=True)
                  .get_by_role("button", name="Preview", exact=True))
            cast = page.get_by_role("region", name="Lantern Cast", exact=True)
            if reduced == "reduce":
                expect(cast).to_have_attribute("data-phase", "ready")
                assert animations(cast) == []
                durations = page.evaluate("""() => {
                    const result = [];
                    const walker = document.createTreeWalker(
                        document.documentElement, NodeFilter.SHOW_ELEMENT);
                    for (let node = walker.currentNode; node; node = walker.nextNode())
                        result.push(getComputedStyle(node).transitionDuration);
                    return result;
                }""")
                assert all(
                    all(float(part.strip().removesuffix("s")) == 0
                        for part in duration.split(","))
                    for duration in durations
                )
            else:
                expect(cast).to_have_attribute("data-phase", "beam")
                advance(page, BEAM_MS - 1)
                expect(cast).to_have_attribute("data-phase", "beam")
                advance(page, 1)
                expect(cast).to_have_attribute("data-phase", "contacts")
                advance(page, CONTACT_MS - 1)
                expect(cast).to_have_attribute("data-phase", "contacts")
                advance(page, 1)
                expect(cast).to_have_attribute("data-phase", "ready")
            expect(page.get_by_role("table", name="Forecast events", exact=True)).to_be_visible()


def test_announced_feedback(page, app_url):
    email, name = fresh()
    click(page.get_by_role("button", name="Account", exact=True))
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_role("textbox", name="Player name", exact=True), name)
    fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
    button = page.get_by_role("button", name="Create account", exact=True)
    with held(page, "**/api/accounts") as request:
        click(button)
        expect(button).to_be_disabled()
        expect(button).to_be_focused()
        expect(page.get_by_role("status", name="Harbour status", exact=True)).to_have_text(
            "Creating your harbour account…"
        )
        request.release()
    expect(page.get_by_role("status", name="Harbour status", exact=True)).to_have_text(
        "Account ready – your harbour's open."
    )
    assert from_browser(page, app_url).get("/api/session")["account"]["email"] == email


def test_dependency_recovery(app_url):
    down_db = API(os.environ["APP_POSTGRES_DOWN_URL"])
    assert down_db.get("/api/health") == {"status": "ok"}
    assert down_db.client.get("/").status_code == 200
    email, name = fresh()
    error(down_db, "POST", "/api/accounts", {
        "email": email, "password": PASSWORD, "playerName": name,
    }, 503, "DATABASE_UNAVAILABLE", "Harbour records unavailable. Try again.")
    api, person = account(app_url)
    down = login(os.environ["APP_MINIO_DOWN_URL"], person)
    ticket = issue(down)
    body = {"commands": [command()], "endTick": MAX_TICKS}
    first = down.post(f"/api/runs/{ticket['id']}/submit", body, status=202)
    assert first["metrics"] is None and first["failure"] is None
    assert first["state"] == "submitted"
    assert down.post(f"/api/runs/{ticket['id']}/submit", body, status=202) == first
    assert down.get("/api/progress") == {"completed": [], "unlocked": ["c1"]}
    result = terminal(api, ticket["id"], [command()])
    assert result["state"] == "accepted"
    assert api.get("/api/progress") == {"completed": ["c1"], "unlocked": ["c1", "c2"]}
    error(down, "GET", f"/api/results/{ticket['id']}/replay", None,
          503, "EVIDENCE_UNAVAILABLE", "Replay evidence unavailable. Try again.")
    assert down.get(f"/api/runs/{ticket['id']}")["result"] == result


def test_runtime_boundary(page, app_url):
    api = API(app_url)
    assert api.get("/api/health") == {"status": "ok"}
    email, name = fresh()
    response = api.client.post("/api/accounts", json={
        "email": email, "password": PASSWORD, "playerName": name,
    }, headers={"Origin": "https://outside.example"})
    assert response.status_code == 403
    assert response.json()["error"] == {
        "code": "ORIGIN_REFUSED", "message": "Use this harbour's own page.", "fields": {},
    }
    error(api, "GET", "/api/session", None, 401, "AUTH_REQUIRED")
    malformed = api.client.post("/api/accounts", content=b"{",
                                headers={"Content-Type": "application/json"})
    assert malformed.status_code == 400
    assert malformed.json()["error"] == {
        "code": "INVALID_JSON", "message": "Send a valid JSON object.", "fields": {},
    }
    wrong_type = api.client.post("/api/accounts", content=b"{}",
                                 headers={"Content-Type": "text/plain"})
    assert wrong_type.status_code == 415
    assert wrong_type.json()["error"]["code"] == "JSON_REQUIRED"
    error(api, "PUT", "/api/rules", {}, 405, "METHOD_REFUSED", "Use a documented method.")
    error(api, "GET", "/api/not-a-harbour-record", None, 404, "NOT_FOUND")
    origins = []
    page.on("request", lambda r: origins.append(r.url))
    click(page.get_by_role("button", name="Rules", exact=True))
    expect(page.get_by_role("region", name="Rules reference", exact=True)).to_be_visible()
    expected_origin = httpx.URL(app_url)
    for url in origins:
        parsed = httpx.URL(url)
        if parsed.scheme in ("http", "https"):
            assert (parsed.scheme, parsed.host, parsed.port) == (
                expected_origin.scheme, expected_origin.host, expected_origin.port,
            )


def test_exact_values(page, app_url):
    api, person = account(app_url)
    value = definition()
    value["waves"][0].update(tick=PERIOD + 1, interval=PERIOD + 1)
    saved = level(api, value)
    ui_login(page, person)
    ui_open_level(page, saved)
    expect(page.get_by_role("textbox", name="Wave 1 time", exact=True)).to_have_value(
        "00:01.050"
    )
    expect(page.get_by_role("textbox", name="Wave 1 interval", exact=True)).to_have_value(
        "00:01.050"
    )
    before = api.get(f"/api/levels/{saved['id']}")
    fill(page.get_by_role("textbox", name="Wave 1 time", exact=True),
         "00:01.001")
    click(page.get_by_role("button", name="Save private level", exact=True))
    expect(page.get_by_role("alert", name="Harbour error", exact=True)).to_contain_text(
        "Use a permitted value."
    )
    assert api.get(f"/api/levels/{saved['id']}") == before
    ticket, result = proof(api, saved)
    frames, ledger = verify_run(api, ticket, value, [command()], result)
    for frame in frames:
        for key in ("reserve", "source", "sink", "tick", "breaches"):
            assert type(frame[key]) is int
    assert all(type(entry["delta"]) is int for entry in ledger)


def test_transitions(app_url):
    api, _ = account(app_url)
    saved = level(api)
    ticket = api.post("/api/runs", {
        "mode": "playtest", "sourceId": saved["id"], "revision": 1, "loadout": ["wick"],
    }, status=201)["ticket"]
    error(api, "POST", f"/api/runs/{ticket['id']}/submit",
          {"commands": [], "endTick": 0}, 409, "INVALID_TRANSITION")
    started = api.post(f"/api/runs/{ticket['id']}/start", {})
    assert api.post(f"/api/runs/{ticket['id']}/start", {}) == started
    result = terminal(api, ticket["id"], [command()])
    error(api, "POST", f"/api/runs/{ticket['id']}/start", {}, 409, "INVALID_TRANSITION")
    challenge = publish(api, saved, ticket["id"])
    error(api, "PUT", f"/api/levels/{saved['id']}", {
        "expectedRevision": 1, "definition": saved["definition"],
    }, 409, "INVALID_TRANSITION")
    assert api.get(f"/api/runs/{ticket['id']}")["result"] == result
    assert api.get(f"/api/challenges/{challenge['digest']}")["definition"] == saved["definition"]
    private = level(api)
    assert api.post(f"/api/levels/{private['id']}/withdraw", {
        "expectedRevision": 1,
    }) == {"id": private["id"], "state": "withdrawn"}
    error(api, "GET", f"/api/levels/{private['id']}", None, 404, "NOT_FOUND")
    assert private["id"] not in {x["id"] for x in api.get("/api/levels")["levels"]}


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str)
        assert manifest[key].strip()
    deployed = json.loads((DEPLOYED_APP / "run.json").read_text())
    assert deployed == manifest


def test_if_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices
    assert "Bricolage Grotesque" in notices
    assert "Atkinson Hyperlegible" in notices
    assert "OFL-1.1" in notices


def test_if_licences():
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWLIST), (
            package.name, package.licence,
        )
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL-1.1" in notices


def test_if_real_providers(app_url, meilisearch):
    api, person, saved, ticket, challenge = published(app_url)
    persisted(person["email"])
    persisted(ticket["id"])
    stored_objects(ticket, saved["definition"], [command()])
    eventually(
        lambda: meilisearch.document("published_challenges", challenge["digest"]),
        lambda d: d is not None and d["digest"] == challenge["digest"],
        "publication must produce a real Meilisearch document",
    )
    assert api.get(f"/api/challenges/{challenge['digest']}")["definition"] == saved["definition"]


def test_if_observer_credentials(app_url):
    declared = Path("/logs/agent/trajectory.json")
    trajectory = declared.read_text() if declared.exists() else ""
    public = API(app_url)
    responses = [
        public.client.get("/").text,
        public.client.get("/api/rules").text,
        public.client.get("/api/health").text,
    ]
    credentials = [
        value for key, value in os.environ.items()
        if "OBSERVER" in key and ("KEY" in key or "PASSWORD" in key)
        and value
    ]
    for credential in credentials:
        assert credential not in trajectory
        assert all(credential not in response for response in responses)
