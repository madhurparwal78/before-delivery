from __future__ import annotations

import hashlib
import http.server
import json
import math
import os
import re
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    Postgres,
    advance,
    animations,
    axe,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout as no_overflow,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    ready,
    same_origin,
    scene_frames,
    select,
    session as cdp_session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
)

PASSWORD = "gandyboard-demo-1"
FOUNDER = "founder@fishplate.example"
SEEDED_PEOPLE = {
    "founder@fishplate.example": "Founder Fishplate",
    "manager@tarnvalley.example": "Morgan Tarn",
    "member@tarnvalley.example": "Robin Tarn",
    "member2@tarnvalley.example": "Sam Tarn",
    "operator@tarnvalley.example": "Alex Tarn",
    "operator2@tarnvalley.example": "Jo Tarn",
    "newmember@tarnvalley.example": "Riley Tarn",
    "manager@saltmarsh.example": "Casey Marsh",
    "operator@saltmarsh.example": "Dale Marsh",
}
COOKIE = "gandyboard_session"
EXPIRED_COPY = "Your sign-in has ended. Sign in to carry on."
FORBIDDEN_COPY = "You do not have access to this."
NOT_FOUND_COPY = "That item is not in this workspace."
REUSED_COPY = "This key was already used with different details."
STALE_COPY = "Someone changed this first. Review the latest and try again."
VALKEY_COPY = "Live updates are paused. Sessions are held at their last committed tick."
ROUTE_HEADER = "X-Gandyboard-Route"
INSTANCE_HEADER = "X-Gandyboard-Instance"
BODY_LIMIT = 1000000
TICK_MS = 1000
SPEED_FACTOR = 16093440
SPEED_DIVISOR = 3135600
DEFAULT_LIMIT_S = 3600
MIN_RADIUS = 1067
TILE_STRAIGHT = 305
END_STRAIGHT = 152
REVERSE_STRAIGHT = 305
ELEVATION_STEP = 1905
SINGLE_ENDPLATE_WIDTH = 610
MIN_TRAIN_MM = 300
MAX_TRAIN_MM = 2400
MIN_SPEED = 5
MAX_SPEED = 60
SEED_SPEED = 40
SHUTTLE_SPEED = 25
SEED_HEAD = 2800
TT1_DEPART = 720
BLOCK_1_LENGTH = 3000
BLOCK_3_LENGTH = 1500
STREAM_KEEP = 2000
STREAM_CEILING = 2100
LEASE_MS = 3000
TAKEOVER_S = 5
PACKET_S = 25
VALKEY_NOTICE_S = 3
VALKEY_RETURN_S = 5
QUIET_MS = 250
RIBBON_BLOCK_MS = 180
SHEET_MS = 300
TOUCH_TARGET = 44
WORDMARK_WIDTH = 484
PILL_WIDTH = 420
PILL_HEIGHT = 54
PILL_GAP = 60
CARD_WIDTH = 350
CARD_HEIGHT = 495
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
SWITCH_WIDTH = 116
ROUND_BUTTON = 50
PRESS_PX = 4
STAGE_NAME = "Club-hall layout stage"
PAUSED_COPY = "The 3D view is paused. Your session is still running."
GOTENBERG_NOTICE = "The PDF service is not answering. New packets will fail until it returns."
GOTENBERG_FAILED = "Crew packet failed: the PDF service did not answer. Nothing was issued."
ALLOWLIST = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1"}
COUNTER_LABELS = ("Occupied", "Reserved", "Free", "Trains", "Conflicts")
CLOCK_TEXT = re.compile(r"^\d{2}:\d{2}:\d{2}$")
STATUS_TEXT = re.compile(r"^(Scheduled|Running|Held|Interrupted|Ended)$")
VERSION_TEXT = re.compile(r"^Session version \d+$")
PREVIEW_TEXT = re.compile(r"^(Route: |Blocked at Block )")
WALKTHROUGH_STEPS = [
    ("Pick an open end", "Select the end of a module where track should continue."),
    ("Add track", "Press a tile to add a piece to that end."),
    ("Check the standard", "Check layout shows every rule your layout breaks."),
    ("Switch to Operate", "Use the switch to open a session and watch the blocks."),
    ("Give the road", "Select a train, choose a destination and press Highball."),
]
TILE_NAMES = [
    "Straight 12 in", "Straight 6 in", "Curve left", "Curve right", "Turnout left",
    "Turnout right", "Rise", "Fall", "Undo last piece",
]
ROAD_TO_NINE = (3, 4, 5, 6, 8, 9)

OUTAGE_PORT = 9
HTTP_TIMEOUT_S = 40
POLL_S = 0.1
API_WAIT_S = 30
UI_WAIT_S = 45
UI_STEP_MS = 200
RUN_WAIT_S = 120
SLACK_S = 12
HOLD_WATCH_S = 8
TICK_RATE_LOW = 0.8
TICK_RATE_HIGH = 1.3
ALL_DOWN_MS = 9000
SURVIVOR_DOWN_MS = 12000
SHORT_DOWN_MS = 3000
TOO_LONG_RESTART_MS = 60001
AGE_OUT_EDITS = STREAM_CEILING + 10
SKEW_MS = 10800000
SKEWED_DEVICE_TIME = datetime(2031, 3, 9, 4, 30, tzinfo=timezone.utc)
SIZE_TOLERANCE = 0.2
VALKEY_DEFAULT_PORT = 6379
WRONG_PASSWORD = "wrong-password"
UNKNOWN_WORKSPACE = "no-such-workspace"
UNKNOWN_SESSION = "no-such-session"
SOURCE_PATHS = ("/run.json", "/package.json", "/.env", "/src/main.tsx")
TINY_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
)
AUTO = object()


def tag() -> str:
    return uuid.uuid4().hex[:8]


def pause() -> None:
    threading.Event().wait(POLL_S)


def poll(probe, what: str, seconds: float = API_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        pause()
    pytest.fail(f"timed out after {seconds}s: {what}")


def steady(probe, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        probe()
        pause()


def together(*calls):
    gate = threading.Barrier(len(calls))

    def go(call):
        gate.wait(API_WAIT_S)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(go, c) for c in calls]]


def ok(resp: httpx.Response, *expected: int):
    if resp.status_code not in expected:
        pytest.fail(f"{resp.request.method} {resp.request.url} answered {resp.status_code}: "
                    f"{resp.text[:500]}; expected {expected}")
    return resp.json() if resp.content else None


def refused(resp: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert resp.status_code == status, f"{resp.request.url}: {resp.status_code} {resp.text[:500]}"
    error = resp.json()["error"]
    assert error["code"] == code
    if message is not None:
        assert error["message"] == message
    return error


def canonical_hash(value) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clock_label(seconds: int) -> str:
    return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"


def ribbon(*numbers) -> str:
    return ",".join(str(n) for n in numbers)


def route_line(*numbers) -> str:
    joined = ", ".join(str(n) for n in numbers)
    return f"Route: {joined}"


def squeezed(text: str) -> str:
    return re.sub(r"\s+", " ", text)


class Api:

    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.email = email
        self.user: dict = {}
        if email:
            self.user = ok(self.http.post("/api/auth/sign-in", json={"email": email, "password": password}), 200)["user"]

    def send(self, method, path, body=None, key=AUTO, route=None, headers=None):
        merged = dict(headers or {})
        if route:
            merged[ROUTE_HEADER] = route
        if key is AUTO:
            merged["Idempotency-Key"] = idempotency_key()
        elif key is not None:
            merged["Idempotency-Key"] = key
        kwargs = {} if body is None else {"json": body}
        return self.http.request(method, path, headers=merged, **kwargs)

    def get(self, path, route=None):
        return self.send("GET", path, key=None, route=route)

    def post(self, path, body, key=AUTO, route=None):
        return self.send("POST", path, body, key, route)

    def patch(self, path, body, key=AUTO, route=None):
        return self.send("PATCH", path, body, key, route)

    def put(self, path, body, key=AUTO, route=None):
        return self.send("PUT", path, body, key, route)


def straight(length, rise=0):
    return {"kind": "straight", "length_mm": length, "rise_mm": rise, "mainline": True}


def curve(radius, hand="left", mainline=True):
    return {"kind": "curve", "radius_mm": radius, "angle_deg": 15, "hand": hand, "rise_mm": 0, "mainline": mainline}


def turnout(frog, hand="left"):
    return {"kind": "turnout", "frog_number": frog, "hand": hand, "length_mm": TILE_STRAIGHT, "rise_mm": 0, "mainline": True}


def endplates(width=SINGLE_ENDPLATE_WIDTH, offsets=(0,)):
    return [{"end": "A", "width_mm": width, "track_offsets_mm": list(offsets)},
            {"end": "B", "width_mm": SINGLE_ENDPLATE_WIDTH, "track_offsets_mm": [0]}]


class Bench:

    def __init__(self, club, api, module_id):
        self.club, self.api, self.id = club, api, module_id
        self.path = f"{club.L}/modules/{module_id}"
        self.refresh()

    def refresh(self):
        lay = self.club.lay()
        module = next(m for m in lay["content"]["modules"] if m["id"] == self.id)
        self.name = module["name"]
        self.revision = lay["module_revisions"][self.id]
        self.ends = module["open_ends"]
        self.pieces = module["pieces"]
        self.end = self.ends[0] if self.ends else None

    def append(self, piece, end=None, api=None, key=AUTO, route=None, revision=None):
        body = {"revision": self.revision if revision is None else revision,
                "open_end_id": (end or self.end)["id"], "piece": piece}
        return (api or self.api).post(f"{self.path}/pieces", body, key=key, route=route)

    def grow(self, piece):
        known = {e["id"] for e in self.ends}
        answer = ok(self.append(piece), 201)
        self.revision = answer["module_revision"]
        self.ends = answer["open_ends"]
        self.end = next((e for e in self.ends if e["id"] not in known), self.ends[0] if self.ends else None)
        return answer


class Run:

    def __init__(self, club, api, snapshot):
        self.club, self.api, self.id = club, api, snapshot["id"]
        self.S = f"{club.W}/sessions/{self.id}"
        self.stream = f"gandyboard:session:{self.id}:events"

    def snap(self, route=None):
        return ok(self.api.get(self.S, route=route), 200)

    def control(self, command, key=AUTO, route=None, api=None):
        return (api or self.api).post(f"{self.S}/{command}", {"revision": self.snap()["control_revision"]}, key=key, route=route)

    @staticmethod
    def train(snapshot, number):
        return next(t for t in snapshot["trains"] if str(t["number"]) == str(number))

    @staticmethod
    def block(snapshot, number):
        return next(b for b in snapshot["blocks"] if b["number"] == number)

    def highball_body(self, number, destination, via=None, limit=None):
        snapshot = self.snap()
        body = {"revision": self.train(snapshot, number)["revision"],
                "destination_block_id": self.block(snapshot, destination)["id"]}
        if via is not None:
            body["via_block_id"] = self.block(snapshot, via)["id"]
        if limit is not None:
            body["time_limit_fast_seconds"] = limit
        return self.train(snapshot, number)["id"], body

    def highball(self, number, destination, via=None, limit=None, key=AUTO, route=None, api=None):
        train_id, body = self.highball_body(number, destination, via, limit)
        return (api or self.api).post(f"{self.S}/trains/{train_id}/authorities", body, key=key, route=route)

    def move(self, number, command, api=None):
        train = self.train(self.snap(), number)
        return (api or self.api).post(f"{self.S}/trains/{train['id']}/{command}", {"revision": train["revision"]})

    def service(self, number, out):
        snapshot = self.snap()
        block = self.block(snapshot, number)
        return self.api.post(f"{self.S}/blocks/{block['id']}/service",
                             {"revision": snapshot["control_revision"], "out_of_service": out})

    def extra(self, number, start, length=MIN_TRAIN_MM, speed=SEED_SPEED, direction="east", api=None, name="Extra"):
        snapshot = self.snap()
        return (api or self.api).post(f"{self.S}/trains", {
            "revision": snapshot["session_version"], "number": str(number), "name": name, "length_mm": length,
            "speed_mph": speed, "direction": direction, "start_block_id": self.block(snapshot, start)["id"]})

    def until(self, predicate, what, seconds=API_WAIT_S):
        def probe():
            snapshot = self.snap()
            return snapshot if predicate(snapshot) else None
        return poll(probe, what, seconds)

    def at_tick(self, tick, seconds=API_WAIT_S):
        return self.until(lambda s: s["tick"] >= tick, f"session reached tick {tick}", seconds)

    def head_in(self, number, block, seconds=RUN_WAIT_S):
        return self.until(lambda s: self.train(s, number)["head_block_id"] == self.block(s, block)["id"],
                          f"Train {number} head reached block {block}", seconds)

    def packet(self, api=None, key=AUTO, route=None):
        snapshot = self.snap()
        return ok((api or self.api).post(f"{self.S}/packets", {"revision": snapshot["session_version"]}, key=key, route=route), 202)["packet"]

    def packet_done(self, packet_id, seconds=PACKET_S + SLACK_S):
        def probe():
            packet = ok(self.api.get(f"{self.S}/packets/{packet_id}"), 200)
            return packet if packet["state"] in ("Ready", "Failed") else None
        return poll(probe, f"packet {packet_id} reached Ready or Failed", seconds)

    def pdf(self, packet_id):
        resp = self.api.get(f"{self.S}/packets/{packet_id}/pdf")
        assert resp.status_code == 200 and resp.headers["Content-Type"].startswith("application/pdf")
        return resp.content


class Club:

    def __init__(self, base):
        self.base = base
        self.founder = Api(base, FOUNDER)
        self.name = f"Club {tag()}"
        made = ok(self.founder.post("/api/workspaces", {"name": self.name, "template": "reference"}), 201)
        self.id, self.layout_id, self.version_id = made["workspace"]["id"], made["layout"]["id"], made["version"]["id"]
        self.W = f"/api/workspaces/{self.id}"
        self.L = f"{self.W}/layouts/{self.layout_id}"
        self.runs: list[Run] = []

    def person(self, role, walked=True):
        email = f"{role}-{tag()}@fishplate.example"
        display = f"{role.title()} {tag()}"
        ok(self.founder.post(f"{self.W}/members", {"display_name": display, "email": email, "password": PASSWORD, "role": role}), 201)
        api = Api(self.base, email)
        if walked:
            ok(api.post("/api/me/walkthrough", {"done": True}, key=None), 200)
        return api

    def lay(self):
        return ok(self.founder.get(self.L), 200)

    def block_id(self, number):
        return next(b["id"] for b in self.lay()["content"]["blocks"] if b["number"] == number)

    def module(self, api, name=None, plates=None):
        lay = self.lay()
        body = {"revision": lay["revision"], "name": name or f"Module {tag()}", "endplates": plates or endplates()}
        made = ok(api.post(f"{self.L}/modules", body), 201)["module"]
        return Bench(self, api, made["id"])

    def run(self, api=None, ratio=6, start=True, version_id=None):
        api = api or self.founder
        body = {"name": f"Run {tag()}", "layout_version_id": version_id or self.version_id, "ratio": ratio}
        run = Run(self, api, ok(api.post(f"{self.W}/sessions", body), 201))
        self.runs.append(run)
        if start:
            ok(run.control("start"), 200)
        return run

    def save_version(self, api=None, label=None):
        body = {"revision": self.lay()["revision"], "label": label or f"Label {tag()}"}
        return ok((api or self.founder).post(f"{self.L}/versions", body), 201)["version"]

    def validate(self, version, api=None):
        return (api or self.founder).post(f"{self.L}/versions/{version['id']}/validate", {"revision": version["revision"]})

    def publish(self, version, api=None):
        return (api or self.founder).post(f"{self.L}/versions/{version['id']}/publish", {"revision": version["revision"]})

    def version(self, version_id):
        return ok(self.founder.get(f"{self.L}/versions/{version_id}"), 200)

    def standards(self, api=None, **changes):
        api = api or self.founder
        profile = ok(api.get(f"{self.W}/standards"), 200)
        return ok(api.put(f"{self.W}/standards", {**profile, **changes}), 200)

    def rename_block(self, block_id, name, api=None):
        body = {"revision": self.lay()["revision"], "name": name}
        return ok((api or self.founder).patch(f"{self.L}/blocks/{block_id}", body), 200)

    def operate(self, run, **extra):
        return {"workspace": self.id, "layout": self.layout_id, "session": run.id, "mode": "operate", **extra}

    def build(self, **extra):
        return {"workspace": self.id, "layout": self.layout_id, "mode": "build", **extra}

    def close(self):
        for run in self.runs:
            try:
                status = run.api.get(run.S).json().get("status")
                if status in ("Running", "Held", "Interrupted"):
                    run.control("end")
            except (httpx.HTTPError, ValueError, KeyError):
                continue


@pytest.fixture
def clubs(app_url):
    made: list[Club] = []

    def build(base=app_url):
        club = Club(base)
        made.append(club)
        return club

    yield build
    for club in made:
        club.close()


def recount(snapshot) -> dict:
    states = [b["state"] for b in snapshot["blocks"]]
    return {
        "occupied_blocks": states.count("occupied") + states.count("out_of_service"),
        "reserved_blocks": states.count("reserved"),
        "free_blocks": states.count("free"),
        "trains": len(snapshot["trains"]),
        "open_conflicts": sum(1 for c in snapshot["conflicts"] if c["state"] == "Open"),
    }


def assert_recount(snapshot):
    assert snapshot["counters"] == recount(snapshot), f"counters at tick {snapshot['tick']}"
    assert sum(snapshot["counters"][k] for k in ("occupied_blocks", "reserved_blocks", "free_blocks")) == len(snapshot["blocks"])


def derived_occupancy(train, lengths) -> set:
    left, out = train["length_mm"], set()
    for index, block_id in enumerate(train["trail_block_ids"]):
        stretch = train["head_offset_mm"] if index == 0 else lengths[block_id]
        if left > 0 and stretch > 0:
            out.add(block_id)
        left -= stretch
    return out


def read_events(api, path, want, seconds=API_WAIT_S, last_id=None, route=None) -> list[dict]:
    headers = {}
    if route:
        headers[ROUTE_HEADER] = route
    if last_id is not None:
        headers["Last-Event-ID"] = str(last_id)
    events, current = [], {}
    deadline = time.monotonic() + seconds
    try:
        with api.http.stream("GET", path, headers=headers, timeout=httpx.Timeout(seconds)) as resp:
            assert resp.status_code == 200 and resp.headers["Content-Type"].startswith("text/event-stream")
            for line in resp.iter_lines():
                if line == "":
                    if "data" in current:
                        current["json"] = json.loads(current["data"])
                        events.append(current)
                    current = {}
                    if len(events) >= want:
                        break
                elif not line.startswith(":"):
                    field, _, value = line.partition(":")
                    current[field] = value.lstrip()
                if time.monotonic() > deadline:
                    break
    except httpx.ReadTimeout:
        return events
    return events


def stream_entry(valkey, key, seq):
    entries = valkey.command("XRANGE", key, f"{seq}-0", f"{seq}-0")
    assert entries, f"no entry {seq}-0 on {key}"
    flat = [v.decode() if isinstance(v, bytes) else v for v in entries[0][1]]
    return dict(zip(flat[::2], flat[1::2]))


def lease_holder(valkey, run):
    value = valkey.command("GET", f"gandyboard:session:{run.id}:tick-lease")
    return value.decode() if isinstance(value, bytes) else value


def other_instance(name):
    return "b" if name == "a" else "a"


def instances_up(api):
    def probe():
        try:
            resp = api.get("/api/ops/instances")
        except httpx.HTTPError:
            return False
        return resp.status_code == 200 and all(i["up"] for i in resp.json()["instances"])
    poll(probe, "GET /api/ops/instances reported every instance up", RUN_WAIT_S)


def stop_instance(api, name, restart_ms, route):
    try:
        return api.post(f"/api/ops/instances/{name}/stop", {"restart_after_ms": restart_ms}, key=None, route=route)
    except httpx.HTTPError:
        return None


def stored_ticks(run, store=None) -> list[int]:
    rows = (store or Postgres()).rows(f"select tick from session_ticks where session_id = '{run.id}' order by tick")
    return [int(r["tick"]) for r in rows]


def await_ui(page, probe, what, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        advance(page, UI_STEP_MS)
        try:
            if probe():
                return
        except (AssertionError, PlaywrightError) as problem:
            last = problem
    pytest.fail(f"timed out after {seconds}s: {what} ({last})")


def stage_of(page):
    return page.get_by_role("application", name=STAGE_NAME, include_hidden=True)


def attr(page, name) -> str:
    return stage_of(page).get_attribute(name) or ""


def tick_of(page) -> int:
    return int(attr(page, "data-scene-tick") or 0)


def wait_stage(page):
    pill = page.get_by_role("progressbar", name="Loading layout")
    await_ui(page, lambda: stage_of(page).count() == 1 and attr(page, "data-scene-mode") != ""
             and (pill.count() == 0 or not pill.is_visible()), "the club-hall layout stage opened after loading")


def enter(page, base, email, query, route=None):
    if route:
        page.context.set_extra_http_headers({ROUTE_HEADER: route})
    answer = page.context.request.post(f"{base}/api/auth/sign-in", data={"email": email, "password": PASSWORD})
    assert answer.status == 200
    page.goto(f"{base}/?{urlencode(query)}")
    wait_stage(page)


def status_text(page) -> str:
    return page.get_by_role("status", name="Gandyboard status").inner_text()


def announced(page, copy):
    await_ui(page, lambda: copy in status_text(page), f"status region announced {copy!r}")


def on_screen(scope, pattern):
    for item in scope.get_by_text(pattern).all():
        if item.is_visible():
            return item
    return None


def shown(scope, pattern) -> str:
    item = on_screen(scope, pattern)
    return item.inner_text().strip() if item else ""


def fast_clock(page) -> str:
    return shown(page, CLOCK_TEXT)


def session_status(page) -> str:
    return shown(page, STATUS_TEXT)


def session_version(page) -> str:
    return shown(page, VERSION_TEXT)


def preview_line(page) -> str:
    return shown(page.get_by_role("region", name="Route"), PREVIEW_TEXT)


def counters(page) -> dict:
    text = page.get_by_role("group", name="Counters").inner_text()
    tokens = [t for t in re.findall(r"[A-Za-z]+|\d+", text) if t.isdigit() or t in COUNTER_LABELS]
    if not tokens:
        return {}
    pairs = zip(tokens[::2], tokens[1::2])
    if tokens[0].isdigit():
        return {label: int(value) for value, label in pairs}
    return {label: int(value) for label, value in pairs}


def figure(page, label) -> int:
    return counters(page).get(label, -1)


def block_row(page, number):
    rows = page.get_by_role("table", name="Block schematic").get_by_role("row")
    return rows.filter(has_text=re.compile(rf"^\s*(Block\s+)?{number}(?!\d)"))


def block_text(page, number) -> str:
    row = block_row(page, number)
    return row.first.inner_text() if row.count() else ""


def block_state(page, number) -> str:
    text = block_text(page, number)
    for word in ("Reserved", "Occupied", "Free"):
        if word in text:
            return word
    return "Out of service" if text else ""


def sheet_of(page, title):
    return page.get_by_role("dialog", name=title, exact=True)


def sheet_ready(page, title):
    sheet = sheet_of(page, title)
    await_ui(page, sheet.is_visible, f"{title} opened")
    advance(page, SHEET_MS + UI_STEP_MS)
    return sheet


def open_sheet(page, item):
    click(page.get_by_role("button", name="Sheets"))
    entry = page.get_by_role("menu", name="Sheets").get_by_role("menuitem", name=item)
    await_ui(page, entry.is_visible, f"Sheets menu listed {item}")
    click(entry)
    return sheet_ready(page, item)


def bar_sheet(page, name):
    click(page.get_by_role("navigation", name="Session bar").get_by_role("button", name=name))
    return sheet_ready(page, name)


def word_count(sheet, word) -> int:
    return len(re.findall(rf"\b{word}\b", sheet.inner_text()))


def box(locator):
    rect = locator.bounding_box()
    assert rect, "element has no box"
    return rect


def row_button(scope, word, name):
    anchor = on_screen(scope, re.compile(rf"\b{word}\b"))
    assert anchor is not None, f"no row shows {word}"
    top = box(anchor)["y"]
    boxes = [(box(b), b) for b in scope.get_by_role("button", name=name, exact=True).all()]
    below = [(rect["y"], index) for index, (rect, _b) in enumerate(boxes) if rect["y"] + rect["height"] > top]
    assert below, f"no {name} button at the row showing {word}"
    return boxes[min(below)[1]][1]


def stage_item(page, name):
    options = page.get_by_role("listbox", name="Stage items").get_by_role("option", name=name, exact=True)
    await_ui(page, lambda: options.count() >= 1, f"Stage items listed {name}")
    option = options.first
    ready(option).focus()
    page.keyboard.press("Enter")


def train_option(page, number, **state):
    return page.get_by_role("listbox", name="Trains").get_by_role("option", name=f"Train {number}", **state)


def pick_train(page, number, by=click):
    option = train_option(page, number)
    await_ui(page, lambda: option.count() == 1, f"Trains listed Train {number}")
    by(option)
    advance(page, UI_STEP_MS)


def pick_destination(page, number, name):
    select(page.get_by_role("combobox", name="Destination block"), f"Block {number} {name}")
    advance(page, QUIET_MS)


def press_highball(page):
    click(page.get_by_role("button", name="Highball"))


def session_button(page, name):
    return page.get_by_role("group", name="Session controls").get_by_role("button", name=name).first


def no_error_sheet(page) -> bool:
    return page.get_by_role("button", name="Dismiss").count() == 0


def query_of(page) -> dict:
    return parse_qs(urlparse(page.url).query)


def expired_body() -> str:
    return json.dumps({"error": {"code": "session_required", "message": EXPIRED_COPY}})


def expire_once(page, glob, method="POST"):
    seen = []

    def handler(route):
        request = route.request
        if request.method != method:
            route.fallback()
            return
        seen.append((request.headers.get("idempotency-key"), request.post_data))
        if len(seen) == 1:
            route.fulfill(status=401, content_type="application/json", body=expired_body())
        else:
            route.fallback()

    page.route(glob, handler)
    return seen


def expire_pair(page, first_glob, second_glob):
    seen = {first_glob: [], second_glob: []}
    waiting = []

    def handler_for(glob):
        def handler(route):
            request = route.request
            if request.method != "POST":
                route.fallback()
                return
            seen[glob].append((request.headers.get("idempotency-key"), request.post_data))
            if len(seen[glob]) > 1:
                route.fallback()
                return
            waiting.append(route)
            if len(waiting) == 2:
                for held_route in waiting:
                    held_route.fulfill(status=401, content_type="application/json", body=expired_body())
        return handler

    page.route(first_glob, handler_for(first_glob))
    page.route(second_glob, handler_for(second_glob))
    return seen[first_glob], seen[second_glob]


def count_sign_ins(page):
    calls = []
    page.on("request", lambda r: calls.append(r.url) if r.url.endswith("/api/auth/sign-in") else None)
    return calls


def mark_no_reload(page):
    page.evaluate("() => { window.__gandyboardNoReload = true; }")


def assert_no_reload(page):
    assert page.evaluate("() => window.__gandyboardNoReload === true"), "the page reloaded"


def near(value, target) -> bool:
    return abs(value - target) <= target * SIZE_TOLERANCE


class Relay:

    def __init__(self, target):
        self.target, self.sockets, self.listener = target, [], None

    def start(self):
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", OUTAGE_PORT))
        self.listener.listen()
        threading.Thread(target=self._accept, args=(self.listener,), daemon=True).start()

    def _accept(self, listener):
        for _ in range(100000):
            try:
                client, _addr = listener.accept()
                upstream = socket.create_connection(self.target)
            except OSError:
                return
            self.sockets += [client, upstream]
            threading.Thread(target=self._pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pipe(source, sink):
        for _ in range(100000000):
            try:
                data = source.recv(65536)
                if not data:
                    return
                sink.sendall(data)
            except OSError:
                return

    def stop(self):
        if self.listener is None:
            return
        for item in [self.listener, *self.sockets]:
            try:
                item.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            item.close()
        self.listener, self.sockets = None, []


def valkey_relay() -> Relay:
    parsed = urlparse(os.environ["VALKEY_OBSERVER_URL"])
    return Relay((parsed.hostname, parsed.port or VALKEY_DEFAULT_PORT))


class StubPdfService:

    def __init__(self):
        outer = self
        self.calls: list[tuple[str, bytes]] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def _send(self, payload, kind):
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                self._send(b'{"status":"up"}', "application/json")

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                outer.calls.append((self.path, body))
                self._send(TINY_PDF, "application/pdf")

        http.server.ThreadingHTTPServer.allow_reuse_address = True
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", OUTAGE_PORT), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        try:
            self.server.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.server.server_close()


def service_state(api, name, state, seconds):
    poll(lambda: ok(api.get("/api/status"), 200)[name] == state, f"/api/status read {name} {state}", seconds)


def test_sign_in_and_role_table(clubs, app_url):
    for email, display in SEEDED_PEOPLE.items():
        me = ok(Api(app_url, email).get("/api/me"), 200)
        assert me["user"]["email"] == email and me["user"]["display_name"] == display
    wrong = httpx.post(f"{app_url}/api/auth/sign-in", json={"email": FOUNDER, "password": WRONG_PASSWORD})
    refused(wrong, 401, "invalid_credentials", "That email and password do not match.")
    assert COOKIE not in wrong.cookies
    right = httpx.post(f"{app_url}/api/auth/sign-in", json={"email": FOUNDER, "password": PASSWORD})
    cookie = right.headers["Set-Cookie"].lower()
    assert f"{COOKIE}=" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie

    club = clubs()
    founder = club.founder
    roles = {"founder": founder, "manager": club.person("manager"), "member": club.person("member"),
             "operator": club.person("operator")}
    every = set(roles)
    managers = {"founder", "manager"}
    builders = {"founder", "manager", "member"}
    runners = {"founder", "manager", "operator"}

    def validated():
        version = club.save_version()
        return ok(club.validate(version), 200)["version"]

    def trashed():
        bench = club.module(founder)
        ok(founder.post(f"{bench.path}/trash", {"revision": club.lay()["revision"]}), 200)
        return bench.id

    def in_trash(api, action):
        return api.post(f"{club.L}/trash/{trashed()}/{action}", {"revision": club.lay()["revision"]})

    def timetable(api):
        lay = club.lay()
        return api.put(f"{club.L}/timetable", {"revision": lay["revision"], "entries": lay["content"]["timetable"]["entries"]})

    def standards(api):
        return api.put(f"{club.W}/standards", ok(founder.get(f"{club.W}/standards"), 200))

    def new_member(api):
        return api.post(f"{club.W}/members", {"display_name": "Added", "email": f"added-{tag()}@fishplate.example",
                                              "password": PASSWORD, "role": "member"})

    def new_block(api):
        return api.post(f"{club.L}/blocks", {"revision": club.lay()["revision"], "name": f"Block {tag()}", "kind": "plain"})

    def new_session(api):
        return api.post(f"{club.W}/sessions", {"name": f"Run {tag()}", "layout_version_id": club.version_id})

    def session_command(api):
        run = club.run(start=False)
        return api.post(f"{run.S}/start", {"revision": run.snap()["control_revision"]})

    scheduled = club.run(start=False)
    actions = [
        ("validate", builders, lambda a: club.validate(club.save_version(), a)),
        ("publish", managers, lambda a: club.publish(validated(), a)),
        ("save version", builders, lambda a: a.post(f"{club.L}/versions", {"revision": club.lay()["revision"], "label": "Roles"})),
        ("create workspace", {"founder"}, lambda a: a.post("/api/workspaces", {"name": f"Club {tag()}", "template": "empty"})),
        ("operations", {"founder"}, lambda a: a.get("/api/ops/instances")),
        ("members", managers, new_member),
        ("standards", managers, standards),
        ("timetable", managers, timetable),
        ("rename", managers, lambda a: a.patch(f"{club.L}/blocks/{club.block_id(4)}", {"revision": club.lay()["revision"], "name": f"Line {tag()}"})),
        ("restore", managers, lambda a: a.post(f"{club.L}/versions/{club.version_id}/restore", {"revision": club.lay()["revision"]})),
        ("undo trash", managers, lambda a: in_trash(a, "undo")),
        ("purge", managers, lambda a: in_trash(a, "purge")),
        ("add module", builders, lambda a: a.post(f"{club.L}/modules", {"revision": club.lay()["revision"], "name": f"M {tag()}", "endplates": endplates()})),
        ("add block", builders, new_block),
        ("trash", builders, lambda a: a.post(f"{club.L}/modules/{club.module(founder).id}/trash", {"revision": club.lay()["revision"]})),
        ("check layout", builders, lambda a: a.post(f"{club.L}/check", {}, key=None)),
        ("create session", runners, new_session),
        ("session command", runners, session_command),
        ("packet", runners, lambda a: a.post(f"{scheduled.S}/packets", {"revision": 1})),
        ("read workspace", every, lambda a: a.get(club.W)),
        ("read layout", every, lambda a: a.get(club.L)),
        ("read sessions", every, lambda a: a.get(f"{club.W}/sessions")),
    ]
    for name, allowed, act in actions:
        for role, api in roles.items():
            resp = act(api)
            if role in allowed:
                assert resp.status_code < 400, f"{role} may {name}: {resp.status_code} {resp.text[:300]}"
            else:
                refused(resp, 403, "forbidden", FORBIDDEN_COPY)


def test_wf_founder_workspaces_new_client(browser, app_url):
    name = f"Client {tag()}"
    founder = Api(app_url, FOUNDER)
    people = [(role_label, f"{role_label.lower()}-{tag()}@fishplate.example", f"{role_label} {tag()}")
              for role_label in ("Manager", "Member", "Operator")]
    with open_app(browser, app_url) as page:
        email_box = page.get_by_role("textbox", name="Email")
        await_ui(page, email_box.is_visible, "sign-in sheet showed")
        fill(email_box, FOUNDER)
        fill(page.get_by_label("Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        wait_stage(page)
        click(page.get_by_role("button", name="New workspace"))
        dialog = sheet_ready(page, "New workspace")
        fill(dialog.get_by_role("textbox", name="Workspace name"), name)
        select(dialog.get_by_role("combobox", name="Template"), "Reference layout")
        click(dialog.get_by_role("button", name="Create workspace"))
        await_ui(page, lambda: not dialog.is_visible(), "New workspace dialog closed on success")

        def created():
            return next((w for w in ok(founder.get("/api/workspaces"), 200)["workspaces"] if w["name"] == name), None)
        workspace = poll(created, "GET /api/workspaces listed the new client")
        await_ui(page, lambda: query_of(page).get("workspace") == [workspace["id"]], "workspace in the URL")
        path = f"/api/workspaces/{workspace['id']}"
        assert [m["role"] for m in ok(founder.get(f"{path}/members"), 200)["members"]] == ["founder"]
        sheet = open_sheet(page, "Members")
        for role_label, email, display in people:
            click(sheet.get_by_role("button", name="Add member"))
            advance(page, UI_STEP_MS)
            fill(sheet.get_by_role("textbox", name="Display name"), display)
            fill(sheet.get_by_role("textbox", name="Email"), email)
            fill(sheet.get_by_label("Password"), PASSWORD)
            select(sheet.get_by_role("combobox", name="Role"), role_label)
            click(sheet.get_by_role("button", name="Save member"))
            await_ui(page, lambda e=email: any(m["email"] == e for m in ok(founder.get(f"{path}/members"), 200)["members"]), "member stored")
            announced(page, "Member added.")
    members = {m["email"]: m["role"] for m in ok(founder.get(f"{path}/members"), 200)["members"]}
    for role_label, email, _display in people:
        assert members[email] == role_label.lower()
        memberships = ok(Api(app_url, email).get("/api/me"), 200)["memberships"]
        assert [m["workspace_id"] for m in memberships] == [workspace["id"]]
    layouts = ok(founder.get(f"{path}/layouts"), 200)["layouts"]
    versions = ok(founder.get(f"{path}/layouts/{layouts[0]['id']}/versions"), 200)["versions"]
    assert [(v["number"], v["state"]) for v in versions] == [(1, "Published")]
    assert ok(founder.get(f"{path}/sessions"), 200)["sessions"] == []


def test_wf_founder_workspaces_expired_add_member(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    email = f"late-{tag()}@fishplate.example"
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Members")
        click(sheet.get_by_role("button", name="Add member"))
        advance(page, UI_STEP_MS)
        fill(sheet.get_by_role("textbox", name="Display name"), "Late Joiner")
        fill(sheet.get_by_role("textbox", name="Email"), email)
        fill(sheet.get_by_label("Password"), PASSWORD)
        select(sheet.get_by_role("combobox", name="Role"), "Member")
        seen = expire_once(page, "**/members")
        sign_ins = count_sign_ins(page)
        click(sheet.get_by_role("button", name="Save member"))
        dialog = page.get_by_role("dialog", name="Sign in again")
        await_ui(page, dialog.is_visible, "Sign in again opened on the same screen")
        fill(dialog.get_by_label("Password"), WRONG_PASSWORD)
        click(dialog.get_by_role("button", name="Sign in"))
        announced(page, "That email and password do not match.")
        assert dialog.is_visible()
        assert sheet.get_by_role("textbox", name="Email").input_value() == email
        assert len(seen) == 1
        fill(dialog.get_by_label("Password"), PASSWORD)
        click(dialog.get_by_role("button", name="Sign in"))
        announced(page, "Member added.")
        assert len(sign_ins) == 2
        assert len(seen) == 2 and seen[0] == seen[1], "replay kept its key and body"
        assert no_error_sheet(page)
    rows = [m for m in ok(club.founder.get(f"{club.W}/members"), 200)["members"] if m["email"] == email]
    assert len(rows) == 1


def test_member_rules(clubs):
    club = clubs()
    manager = club.person("manager")
    email = f"person-{tag()}@fishplate.example"
    body = {"display_name": "Person", "email": email, "password": PASSWORD, "role": "member"}
    member = ok(manager.post(f"{club.W}/members", body), 201)["member"]
    refused(manager.post(f"{club.W}/members", body), 422, "member_exists", "That person is already a member.")
    blank = manager.post(f"{club.W}/members", {**body, "email": ""})
    assert blank.status_code == 422
    changed_member = ok(manager.patch(f"{club.W}/members/{member['user_id']}", {"revision": member["revision"], "role": "operator"}), 200)["member"]
    assert changed_member["role"] == "operator"
    stale = manager.patch(f"{club.W}/members/{member['user_id']}", {"revision": member["revision"], "role": "member"})
    refused(stale, 409, "stale_revision", STALE_COPY)
    empty = ok(club.founder.post("/api/workspaces", {"name": f"Empty {tag()}", "template": "empty"}), 201)
    assert empty["version"] is None
    path = f"/api/workspaces/{empty['workspace']['id']}"
    assert ok(club.founder.get(f"{path}/layouts/{empty['layout']['id']}/versions"), 200)["versions"] == []
    assert ok(club.founder.get(path), 200)["counts"]["layouts"] == 1


def test_interleaved_requests_stay_scoped(clubs):
    first, second = clubs(), clubs()
    one, two = first.person("manager"), second.person("manager")
    run_one, run_two = first.run(api=one), second.run(api=two)
    packet_one, packet_two = run_one.packet(), run_two.packet()
    done_one, done_two = run_one.packet_done(packet_one["id"]), run_two.packet_done(packet_two["id"])
    assert done_one["state"] == "Ready" and done_two["state"] == "Ready"

    def read(api, club, run, packet):
        me = ok(api.get("/api/me"), 200)
        assert me["user"]["email"] == api.email
        assert [m["workspace_id"] for m in me["memberships"]] == [club.id]
        assert ok(api.get(club.W), 200)["id"] == club.id
        assert ok(api.get(run.S), 200)["id"] == run.id
        assert packet["content_hash"] in re.sub(r"\s", "", pdf_text(run.pdf(packet["id"])))
        return True

    calls = []
    for _ in range(12):
        calls.append(lambda: read(one, first, run_one, done_one))
        calls.append(lambda: read(two, second, run_two, done_two))
    with ThreadPoolExecutor(8) as pool:
        assert all(f.result() for f in [pool.submit(c) for c in calls])
    streams = together(lambda: read_events(one, f"{run_one.S}/events", 3),
                       lambda: read_events(two, f"{run_two.S}/events", 3))
    assert streams[0] and all(e["json"]["session"]["id"] == run_one.id for e in streams[0])
    assert streams[1] and all(e["json"]["session"]["id"] == run_two.id for e in streams[1])
    refused(one.get(run_two.S), 403, "forbidden", FORBIDDEN_COPY)
    refused(two.get(f"{run_one.S}/packets/{done_one['id']}/pdf"), 403, "forbidden", FORBIDDEN_COPY)
    refused(one.get(f"{run_two.S}/events"), 403, "forbidden", FORBIDDEN_COPY)


def test_wf_founder_workspaces_two_tabs(clubs, browser, app_url):
    first, second = clubs(), clubs()
    name_one, name_two = f"Alpha {tag()}", f"Beta {tag()}"
    run_one, run_two = first.run(ratio=6), second.run(ratio=2)
    first.rename_block(first.block_id(4), name_one)
    second.rename_block(second.block_id(4), name_two)
    packet = run_one.packet()
    assert run_one.packet_done(packet["id"])["state"] == "Ready"
    with open_app(browser, app_url) as tab_one:
        enter(tab_one, app_url, FOUNDER, first.operate(run_one))
        tab_two = tab_one.context.new_page()
        tab_two.goto(f"{app_url}/?{urlencode(second.operate(run_two))}")
        wait_stage(tab_two)
        for tab, ratio, own, foreign in ((tab_one, 6, name_one, name_two), (tab_two, 2, name_two, name_one)):
            mark_no_reload(tab)
            start = tick_of(tab)
            await_ui(tab, lambda t=tab, s=start: tick_of(t) >= s + 2, "ticks streamed into the tab")
            await_ui(tab, lambda t=tab, r=ratio: fast_clock(t) == clock_label(tick_of(t) * r), "tab clock follows its own session")
            row = block_text(tab, 4)
            assert own in row and foreign not in row
            assert_no_reload(tab)
        link = "Download PDF"
        sheet_one = bar_sheet(tab_one, "Crew packets")
        await_ui(tab_one, lambda: sheet_one.get_by_role("link", name=link).count() == 1, "packet listed in its own club")
        sheet_two = bar_sheet(tab_two, "Crew packets")
        advance(tab_two, SHEET_MS)
        assert sheet_two.get_by_role("link", name=link).count() == 0
        assert word_count(sheet_two, "Ready") == 0


def test_wf_module_editing_add_and_undo(clubs, browser, app_url):
    club = clubs()
    member = club.person("member")
    module_name = f"Module {tag()}"
    with open_app(browser, app_url) as page:
        enter(page, app_url, member.email, club.build())
        click(page.get_by_role("button", name="Add module"))
        dialog = page.get_by_role("dialog", name="Add module")
        await_ui(page, dialog.is_visible, "Add module dialog opened")
        fill(dialog.get_by_role("textbox", name="Module name"), module_name)
        select(dialog.get_by_role("combobox", name="Endplate"), "Single")
        click(dialog.get_by_role("button", name="Create module"))

        def made():
            return next((m for m in club.lay()["content"]["modules"] if m["name"] == module_name), None)
        module = poll(made, "the module reached the working copy")
        bench = Bench(club, member, module["id"])
        page.goto(f"{app_url}/?{urlencode(club.build(end=bench.end['id']))}")
        wait_stage(page)
        advance(page, SHEET_MS)
        rail = page.get_by_role("toolbar", name="Track pieces")
        pending_items = page.get_by_role("listbox", name="Stage items").get_by_role("option", name=re.compile(r"^Piece "))
        pieces_before = pending_items.count()
        revision_before = attr(page, "data-scene-revision")
        counts_before = club.lay()["counts"]
        with held(page, "**/pieces") as release:
            click(rail.get_by_role("button", name="Straight 12 in"))
            announced(page, "Adding piece.")
            advance(page, SHEET_MS + UI_STEP_MS)
            bench.refresh()
            assert bench.pieces == [], "nothing lands before the server answers"
            assert pending_items.count() == pieces_before, "no piece is drawn before the server answers"
            assert attr(page, "data-scene-revision") == revision_before
            assert club.lay()["counts"] == counts_before
            release()
        announced(page, "Piece added.")
        bench.refresh()
        assert [(p["kind"], p["length_mm"]) for p in bench.pieces] == [("straight", TILE_STRAIGHT)]
        items = page.get_by_role("listbox", name="Stage items")
        await_ui(page, lambda: items.get_by_role("option", name=f"Piece {bench.pieces[0]['id']}").count() == 1, "piece on the stage")
        click(rail.get_by_role("button", name="Undo last piece"))
        announced(page, "Piece removed.")
        bench.refresh()
        assert bench.pieces == []
        club.standards(min_radius_mm=MIN_RADIUS + 133, display_units="mm")
        hash_before = club.lay()["working_hash"]
        page.goto(f"{app_url}/?{urlencode(club.build(end=bench.end['id']))}")
        wait_stage(page)
        click(rail.get_by_role("button", name="Curve left"))
        announced(page, f"Curve radius {MIN_RADIUS} mm is under the {MIN_RADIUS + 133} mm minimum.")
        assert club.lay()["working_hash"] == hash_before


def test_one_open_end_one_winner(clubs):
    club = clubs()
    one, two = club.person("member"), club.person("member")
    for _round in range(3):
        bench = club.module(one)
        answers = together(lambda: bench.append(straight(TILE_STRAIGHT), api=one, route="a"),
                           lambda: bench.append(straight(TILE_STRAIGHT // 2), api=two, route="b"))
        codes = sorted(a.status_code for a in answers)
        assert codes == [201, 409]
        winner = next(a for a in answers if a.status_code == 201)
        loser = next(a for a in answers if a.status_code == 409)
        taker = one if winner is answers[0] else two
        error = refused(loser, 409, "open_end_taken",
                        f"Open end {bench.end['label']} was just extended by {taker.user['display_name']}. Nothing was changed.")
        assert error["piece_id"] == winner.json()["piece"]["id"]
        kept = bench.pieces
        bench.refresh()
        assert len(bench.pieces) == len(kept) + 1 and bench.pieces[0]["id"] == error["piece_id"]
    forked = club.module(one)
    forked.grow(turnout(6))
    first_end, second_end = forked.ends[0], forked.ends[1]
    old = forked.revision
    ok(forked.append(straight(TILE_STRAIGHT), end=first_end, revision=old), 201)
    stale = forked.append(straight(TILE_STRAIGHT), end=second_end, api=two, revision=old)
    refused(stale, 409, "stale_revision", STALE_COPY)


def test_wf_module_editing_same_end_loser(clubs, browser, app_url):
    club = clubs()
    loser, winner = club.person("member"), club.person("member")
    bench = club.module(loser)
    with open_app(browser, app_url) as page:
        enter(page, app_url, loser.email, club.build(end=bench.end["id"]))
        rail = page.get_by_role("toolbar", name="Track pieces")
        with held(page, "**/pieces") as release:
            click(rail.get_by_role("button", name="Straight 6 in"))
            announced(page, "Adding piece.")
            ok(bench.append(straight(TILE_STRAIGHT), api=winner), 201)
            release()
        announced(page, f"Open end {bench.end['label']} was just extended by {winner.user['display_name']}. Nothing was changed.")
    bench.refresh()
    assert [p["length_mm"] for p in bench.pieces] == [TILE_STRAIGHT]


def test_wf_module_editing_double_tap(clubs, browser, app_url):
    club = clubs()
    member = club.person("member")
    bench = club.module(member)
    with open_app(browser, app_url) as page:
        enter(page, app_url, member.email, club.build(end=bench.end["id"]))
        writes = []
        page.on("request", lambda r: writes.append(r.url) if r.method == "POST" and r.url.endswith("/pieces") else None)
        tile = page.get_by_role("toolbar", name="Track pieces").get_by_role("button", name="Straight 12 in")
        ready(tile).dblclick()
        announced(page, "Piece added.")
        assert len(writes) == 1
        bench.refresh()
        assert len(bench.pieces) == 1
        ok(club.founder.post(f"{bench.path}/trash", {"revision": club.lay()["revision"]}), 200)
        trashed = club.lay()["revision"]
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(trashed), "the trash reached the page")
        before = len(ok(club.founder.get(f"{club.L}/versions"), 200)["versions"])
        ready(page.get_by_role("button", name="Save version").first).dblclick()
        await_ui(page, lambda: "saved." in status_text(page), "Save version answered")
        advance(page, SHEET_MS)
    assert len(ok(club.founder.get(f"{club.L}/versions"), 200)["versions"]) == before + 1


def test_double_tap_across_instances(clubs):
    club = clubs()
    member = club.person("member")
    bench = club.module(member)
    key = idempotency_key()
    first, second = together(lambda: bench.append(straight(TILE_STRAIGHT), key=key, route="a"),
                             lambda: bench.append(straight(TILE_STRAIGHT), key=key, route="b"))
    assert first.status_code == second.status_code == 201 and first.json() == second.json()
    bench.refresh()
    assert len(bench.pieces) == 1
    ok(member.post(f"{bench.path}/trash", {"revision": club.lay()["revision"]}), 200)
    body = {"revision": club.lay()["revision"], "label": f"Label {tag()}"}
    before = len(ok(member.get(f"{club.L}/versions"), 200)["versions"])
    key = idempotency_key()
    first, second = together(lambda: member.post(f"{club.L}/versions", body, key=key, route="a"),
                             lambda: member.post(f"{club.L}/versions", body, key=key, route="b"))
    assert first.status_code == second.status_code == 201 and first.json() == second.json()
    assert len(ok(member.get(f"{club.L}/versions"), 200)["versions"]) == before + 1


def test_piece_inspector_survives(clubs, browser, app_url):
    club = clubs()
    member, other = club.person("member"), club.person("member")
    bench = club.module(member)
    piece = bench.grow(straight(TILE_STRAIGHT))["piece"]
    peer = club.module(other)
    draft = f"Half typed {tag()}"
    query = club.build(piece=piece["id"], sheet="piece-inspector")
    with open_app(browser, app_url) as page:
        enter(page, app_url, member.email, query)
        inspector = page.get_by_role("dialog", name="Piece inspector")
        await_ui(page, inspector.is_visible, "inspector restored from the URL")
        note = inspector.get_by_role("textbox", name="Piece note")
        fill(note, draft)
        ready(note).focus()
        note.evaluate("el => el.setSelectionRange(3, 3)")
        revision = attr(page, "data-scene-revision")
        peer.grow(straight(TILE_STRAIGHT))
        ok(other.patch(f"{bench.path}/pieces/{piece['id']}", {"revision": club.lay()["module_revisions"][bench.id], "note": "Theirs"}), 200)
        await_ui(page, lambda: attr(page, "data-scene-revision") != revision, "live edits reached the stage")
        advance(page, SHEET_MS)
        assert note.input_value() == draft
        assert note.evaluate("el => document.activeElement === el && el.selectionStart") == 3
        page.reload()
        wait_stage(page)
        await_ui(page, lambda: note.is_visible() and note.input_value() == draft, "refresh restored the unsaved note")
        click(inspector.get_by_role("button", name="Close"))
        stage_item(page, f"Piece {piece['id']}")
        advance(page, SHEET_MS * 3)
        assert inspector.is_visible(), "a stale close timer must not hide the reopened inspector"


def test_wf_module_editing_live_peer(clubs, browser, app_url):
    club = clubs()
    viewer, editor = club.person("member"), club.person("member")
    bench = club.module(editor)
    with open_app(browser, app_url) as page:
        enter(page, app_url, viewer.email, club.build(), route="b")
        mark_no_reload(page)
        sheet = open_sheet(page, "Layouts")
        answer = ok(bench.append(straight(TILE_STRAIGHT), route="a"), 201)
        items = page.get_by_role("listbox", name="Stage items")
        option = items.get_by_role("option", name=f"Piece {answer['piece']['id']}")
        await_ui(page, lambda: option.count() == 1, "peer's piece appeared on the stage")
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(answer["layout_revision"]), "scene revision followed")
        pieces = club.lay()["counts"]["pieces"]
        await_ui(page, lambda: word_count(sheet, pieces) >= 1, "layout counts updated in place")
        changed_piece = ok(editor.patch(f"{bench.path}/pieces/{answer['piece']['id']}", {"revision": answer["module_revision"], "note": "Peer note"}, route="a"), 200)
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(changed_piece["layout_revision"]), "change reached the stage")
        removed = ok(editor.post(f"{bench.path}/pieces/{answer['piece']['id']}/remove", {"revision": changed_piece["module_revision"]}, route="a"), 200)
        await_ui(page, lambda: option.count() == 0, "removed piece left the stage")
        await_ui(page, lambda: word_count(sheet, pieces - 1) >= 1, "counts fell in place")
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(removed["layout_revision"]), "removal revision applied")
        assert_no_reload(page)


def test_sign_in_expiry_replays_commands(clubs, browser, app_url):
    club = clubs()
    member = club.person("member")
    bench = club.module(member)
    with open_app(browser, app_url) as page:
        enter(page, app_url, member.email, club.build(end=bench.end["id"]))
        seen_piece, seen_check = expire_pair(page, "**/pieces", "**/check")
        sign_ins = count_sign_ins(page)
        click(page.get_by_role("toolbar", name="Track pieces").get_by_role("button", name="Straight 12 in"))
        click(page.get_by_role("button", name="Check layout"))
        dialog = page.get_by_role("dialog", name="Sign in again")
        await_ui(page, dialog.is_visible, "Sign in again opened")
        assert dialog.count() == 1
        assert member.email in dialog.inner_text() or dialog.get_by_role("textbox").first.input_value() == member.email
        fill(dialog.get_by_label("Password"), PASSWORD)
        click(dialog.get_by_role("button", name="Sign in"))
        await_ui(page, lambda: len(seen_piece) == 2 and len(seen_check) == 2, "each pending command was sent once more")
        poll(lambda: (bench.refresh(), len(bench.pieces) == 1)[1], "the replayed piece reached the working copy")
        advance(page, SHEET_MS)
        assert len(sign_ins) == 1 and seen_piece[0] == seen_piece[1] and len(seen_piece) == 2
        assert seen_check[0] == seen_check[1] and len(seen_check) == 2
        assert no_error_sheet(page)
    bench.refresh()
    assert len(bench.pieces) == 1


def test_standards_drive_later_checks(clubs):
    club = clubs()
    manager, member = club.person("manager"), club.person("member")
    profile = ok(manager.get(f"{club.W}/standards"), 200)
    assert (profile["min_radius_mm"], profile["end_straight_mm"], profile["elevation_step_hundredths_mm"], profile["display_units"]) == (MIN_RADIUS, END_STRAIGHT, ELEVATION_STEP, "in")
    bench = club.module(member)
    tight = MIN_RADIUS - 100
    refused(bench.append(curve(tight)), 422, "validation_failed", "This piece breaks the club standard.")
    club.standards(api=manager, min_radius_mm=tight)
    assert ok(manager.get(club.W), 200)["standards"]["min_radius_mm"] == tight
    ok(bench.append(curve(tight)), 201)
    current = ok(manager.get(f"{club.W}/standards"), 200)
    bad = manager.put(f"{club.W}/standards", {**current, "min_radius_mm": "not a number"})
    assert bad.status_code == 422
    stale = manager.put(f"{club.W}/standards", {**current, "revision": current["revision"] - 1})
    refused(stale, 409, "stale_revision", STALE_COPY)
    assert ok(manager.get(f"{club.W}/standards"), 200)["min_radius_mm"] == tight


def test_standards_lost_update(clubs):
    club = clubs()
    one, two = club.person("manager"), club.person("manager")
    profile = ok(one.get(f"{club.W}/standards"), 200)
    answers = together(lambda: one.put(f"{club.W}/standards", {**profile, "end_straight_mm": END_STRAIGHT + 1}, route="a"),
                       lambda: two.put(f"{club.W}/standards", {**profile, "end_straight_mm": END_STRAIGHT + 2}, route="b"))
    assert sorted(a.status_code for a in answers) == [200, 409]
    winner = next(a for a in answers if a.status_code == 200).json()
    refused(next(a for a in answers if a.status_code == 409), 409, "stale_revision", STALE_COPY)
    assert ok(one.get(f"{club.W}/standards"), 200)["end_straight_mm"] == winner["end_straight_mm"]


def test_standards_sheet_units(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    club.standards(elevation_step_hundredths_mm=ELEVATION_STEP + 95)
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Standards")
        fill(sheet.get_by_role("spinbutton", name="Minimum radius"), "24")
        fill(sheet.get_by_role("spinbutton", name="Elevation step"), "0.75")
        fill(sheet.get_by_role("spinbutton", name="Maximum grade"), "2.5")
        click(sheet.get_by_role("button", name="Save standards"))
        announced(page, "Standards saved.")
        saved = ok(manager.get(f"{club.W}/standards"), 200)
        assert saved["min_radius_mm"] == SINGLE_ENDPLATE_WIDTH, "24 in is 610 mm"
        assert saved["elevation_step_hundredths_mm"] == ELEVATION_STEP
        assert saved["max_grade_tenths_percent"] == 25
        check(sheet.get_by_role("radio", name="Millimetres"))
        click(sheet.get_by_role("button", name="Save standards"))
        await_ui(page, lambda: ok(manager.get(f"{club.W}/standards"), 200)["display_units"] == "mm", "units stored")
        await_ui(page, lambda: float(sheet.get_by_role("spinbutton", name="Minimum radius").input_value()) == saved["min_radius_mm"], "radius shown in millimetres")
        assert float(sheet.get_by_role("spinbutton", name="Elevation step").input_value()) == ELEVATION_STEP / 100


def test_piece_rules(clubs):
    club = clubs()
    member = club.person("member")
    club.standards(display_units="mm")
    bench = club.module(member)

    def refuse(piece, rule, measured, limit, message):
        before = club.lay()
        resp = bench.append(piece)
        error = refused(resp, 422, "validation_failed", "This piece breaks the club standard.")
        finding = next(f for f in error["findings"] if f["rule"] == rule)
        assert (finding["measured_mm"], finding["limit_mm"], finding["message"]) == (measured, limit, message)
        assert finding["module_id"] == bench.id
        after = club.lay()
        assert (after["working_hash"], after["revision"], after["counts"]) == (before["working_hash"], before["revision"], before["counts"])

    grade, limit = 13.1, 2.0
    refuse(curve(MIN_RADIUS - 1), "min_radius", MIN_RADIUS - 1, MIN_RADIUS, f"Curve radius {MIN_RADIUS - 1} mm is under the {MIN_RADIUS} mm minimum.")
    refuse(straight(TILE_STRAIGHT, 40), "max_grade", 131, 20, f"Grade {grade}% is over the {limit}% maximum.")
    refuse(turnout(4), "min_turnout", 4, 6, f"Turnout #{4} is under the #{6} minimum.")
    bench.grow(straight(100, 2))
    bench.grow(curve(MIN_RADIUS, "left"))
    bench.grow(straight(100))
    refuse(curve(MIN_RADIUS, "right"), "reverse_curve", 100, REVERSE_STRAIGHT, f"Only {100} mm of straight between reverse curves; {REVERSE_STRAIGHT} mm needed.")
    bench.grow(straight(REVERSE_STRAIGHT - 100))
    bench.grow(curve(MIN_RADIUS, "right"))
    siding = club.module(member)
    siding.grow(curve(MIN_RADIUS - 100, "left", mainline=False))
    siding.refresh()
    assert len(siding.pieces) == 1
    grown = siding.pieces[0]
    assert grown["length_mm"] == round((MIN_RADIUS - 100) * math.radians(15))
    for field in ("x_mm", "y_mm", "elevation_mm", "heading_deg"):
        assert field in grown["start"] and field in grown["end"]
    bench.refresh()
    first = bench.pieces[0]
    edit = member.patch(f"{bench.path}/pieces/{first['id']}", {"revision": bench.revision, "rise_mm": 40})
    finding = refused(edit, 422, "validation_failed")["findings"][0]
    assert finding["rule"] == "max_grade" and finding["limit_mm"] == 20


def test_module_rules(clubs):
    club = clubs()
    member = club.person("member")
    club.standards(display_units="mm")
    assert ok(member.post(f"{club.L}/check", {}, key=None), 200) == {"passed": True, "findings": []}
    wide = club.module(member, plates=endplates(width=600))
    skew = club.module(member, plates=endplates(offsets=(10,)))
    bent = club.module(member)
    bent.grow(curve(MIN_RADIUS))
    risen = club.module(member)
    risen.grow(straight(2000, 40))
    near_step = club.module(member)
    near_step.grow(straight(2000, 39))
    before = club.lay()
    report = ok(member.post(f"{club.L}/check", {}, key=None), 200)
    assert report["passed"] is False
    assert club.lay()["revision"] == before["revision"]

    def found(rule, module):
        return [f for f in report["findings"] if f["rule"] == rule and f["module_id"] == module.id]

    end = "A"
    width = found("endplate_width", wide)[0]
    assert (width["measured_mm"], width["limit_mm"], width["message"]) == (600, SINGLE_ENDPLATE_WIDTH, f"Endplate {end} is {600} mm; the standard is {SINGLE_ENDPLATE_WIDTH} mm.")
    centred = found("track_centred", skew)[0]
    assert centred["measured_mm"] == 10 and centred["message"] == f"Track at endplate {end} is off-centre by {10} mm."
    assert found("empty_module", wide)[0]["message"] == f"Module {wide.name} has no track."
    assert found("end_straight", bent)[0]["limit_mm"] == END_STRAIGHT
    step = found("elevation_step", risen)[0]
    assert (step["measured_mm"], step["limit_mm"]) == (4000, ELEVATION_STEP)
    assert found("elevation_step", near_step) == [], "39 mm is within 1 mm of two steps"
    bent.refresh()
    assigned = found("unassigned_block", bent)[0]
    assert assigned["piece_id"] == bent.pieces[0]["id"] and assigned["message"] == f"Piece {bent.pieces[0]['id']} has no block."


def test_refused_piece_replay(clubs):
    club = clubs()
    member = club.person("member")
    bench = club.module(member)
    key = idempotency_key()
    tight = MIN_RADIUS - 67
    first = bench.append(curve(tight), key=key)
    assert first.status_code == 422
    club.standards(min_radius_mm=tight)
    replay = bench.append(curve(tight), key=key)
    assert replay.status_code == 422 and replay.json() == first.json()
    refused(bench.append(curve(tight + 1), key=key), 422, "idempotency_key_reused", REUSED_COPY)
    bench.refresh()
    assert bench.pieces == []


def test_wf_geometry_validation_publish_journey(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    number = 2
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Versions")
        published = word_count(sheet, "Published")
        click(sheet.get_by_role("button", name="Save version"))
        announced(page, f"Version {number} saved.")
        await_ui(page, lambda: word_count(sheet, "Draft") == 1, "new row reads Draft")
        click(row_button(sheet, "Draft", "Validate"))
        announced(page, f"Version {number} validated.")
        await_ui(page, lambda: word_count(sheet, "Validated") == 1, "row reads Validated")
        click(row_button(sheet, "Validated", "Publish"))
        announced(page, f"Version {number} published.")
        await_ui(page, lambda: word_count(sheet, "Published") == published + 1, "row reads Published")
    versions = ok(manager.get(f"{club.L}/versions"), 200)["versions"]
    saved = next(v for v in versions if v["number"] == number)
    assert saved["state"] == "Published"
    stored = Postgres().rows(f"select state, canonical_hash from layout_versions where id = '{saved['id']}'")
    assert stored == [{"state": "Published", "canonical_hash": saved["canonical_hash"]}]


def test_wf_geometry_validation_invalid_recovery(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    bench = club.module(manager)
    findings = ok(manager.post(f"{club.L}/check", {}, key=None), 200)["findings"]
    count = len(findings)
    assert count > 0
    failing, fixed = 2, 3
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        click(page.get_by_role("button", name="Check layout"))
        announced(page, f"Layout has {count} findings.")
        sheet = open_sheet(page, "Versions")
        click(sheet.get_by_role("button", name="Save version"))
        announced(page, f"Version {failing} saved.")
        await_ui(page, lambda: word_count(sheet, "Draft") == 1, "new row reads Draft")
        click(row_button(sheet, "Draft", "Validate"))
        announced(page, f"Version {failing} has {count} findings.")
        assert word_count(sheet, "Draft") == 1
        ok(manager.post(f"{bench.path}/trash", {"revision": club.lay()["revision"]}), 200)
        trashed = club.lay()["revision"]
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(trashed), "the trash reached the page")
        click(sheet.get_by_role("button", name="Save version"))
        announced(page, f"Version {fixed} saved.")
    versions = {v["number"]: v for v in ok(manager.get(f"{club.L}/versions"), 200)["versions"]}
    assert versions[failing]["state"] == "Draft"
    assert ok(club.validate(versions[fixed], manager), 200)["version"]["state"] == "Validated"


def test_replayed_publish_one_transition(clubs):
    club = clubs()
    manager = club.person("manager")
    draft = club.save_version(manager)
    refused(club.publish(draft, manager), 422, "version_transition", "A Draft version cannot do that.")
    bench = club.module(manager)
    failing = club.save_version(manager)
    error = refused(club.validate(failing, manager), 422, "validation_failed", "This version breaks the club standard.")
    assert error["findings"]
    assert club.version(failing["id"])["state"] == "Draft"
    ok(manager.post(f"{bench.path}/trash", {"revision": club.lay()["revision"]}), 200)
    report = ok(club.validate(draft, manager), 200)
    assert report["report"] == {"passed": True, "findings": []}
    validated = report["version"]
    refused(club.validate(validated, manager), 422, "version_transition", "A Validated version cannot do that.")
    key = idempotency_key()
    body = {"revision": validated["revision"]}
    path = f"{club.L}/versions/{validated['id']}/publish"
    first, second = together(lambda: manager.post(path, body, key=key, route="a"), lambda: manager.post(path, body, key=key, route="b"))
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    published = club.version(validated["id"])
    assert published["state"] == "Published" and published["revision"] == first.json()["version"]["revision"]
    refused(club.validate(published, manager), 422, "version_transition", "A Published version cannot do that.")


def test_wf_rename_history_live_rename(clubs, browser, app_url):
    club = clubs()
    manager, operator = club.person("manager"), club.person("operator")
    run = club.run(api=operator)
    fresh = f"Long Straight {tag()}"
    with open_app(browser, app_url) as watcher, open_app(browser, app_url) as page:
        enter(watcher, app_url, operator.email, club.operate(run), route="b")
        mark_no_reload(watcher)
        enter(page, app_url, manager.email, club.operate(run), route="a")
        click(block_row(page, 4).get_by_role("button", name="Rename"))
        dialog = page.get_by_role("dialog", name="Rename")
        await_ui(page, dialog.is_visible, "Rename dialog opened")
        fill(dialog.get_by_role("textbox", name="New name"), fresh)
        click(dialog.get_by_role("button", name="Save name"))
        announced(page, f"Renamed to {fresh}.")
        await_ui(watcher, lambda: fresh in block_text(watcher, 4), "name reached the other instance live")
        assert_no_reload(watcher)
        sheet = bar_sheet(watcher, "Crew packets")
        await_ui(watcher, lambda: fresh in sheet.inner_text(), "unissued preview shows the new name")
    block_id = club.block_id(4)
    assert next(b for b in club.lay()["content"]["blocks"] if b["id"] == block_id)["name"] == fresh
    assert run.block(run.snap(), 4)["name"] == fresh
    assert [b["id"] for b in ok(operator.get(f"{run.S}/blocks?{urlencode({'q': fresh})}"), 200)["blocks"]] == [block_id]
    assert fresh in json.dumps(ok(operator.get(f"{run.S}/packets/preview"), 200)["content"], ensure_ascii=False)
    types = Postgres().rows(f"select type from event_outbox where stream = '{run.stream}' and type = 'name.changed'")
    assert len(types) == 1


def test_wf_rename_history_station_rename(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    run = club.run(api=manager)
    fresh = f"Harbour {tag()}"
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Timetable")
        click(sheet.get_by_role("button", name="Rename").first)
        dialog = page.get_by_role("dialog", name="Rename")
        await_ui(page, dialog.is_visible, "Rename dialog opened")
        fill(dialog.get_by_role("textbox", name="New name"), fresh)
        click(dialog.get_by_role("button", name="Save name"))
        announced(page, f"Renamed to {fresh}.")
        await_ui(page, lambda: fresh in sheet.inner_text(), "timetable shows the new station name")
    row = next(h for h in ok(manager.get(f"{club.L}/history"), 200)["history"] if h["action"] == "station.renamed")
    assert row["to"] == fresh and row["from"] in ("Wren Quay", "Fernhill", "Tarn Head")
    station = next(s for s in club.lay()["content"]["stations"] if s["id"] == row["object_id"])
    assert station["name"] == fresh
    assert fresh in json.dumps(ok(manager.get(f"{run.S}/packets/preview"), 200)["content"], ensure_ascii=False)


def test_rename_scoped_to_workspace(clubs):
    first, second = clubs(), clubs()
    run_one, run_two = first.run(), second.run()
    block_id = first.block_id(4)
    assert second.block_id(4) == block_id
    original = run_two.block(run_two.snap(), 4)["name"]
    fresh = f"Only Here {tag()}"
    first.rename_block(block_id, fresh)
    assert run_one.block(run_one.snap(), 4)["name"] == fresh
    assert run_two.block(run_two.snap(), 4)["name"] == original
    assert next(b for b in second.lay()["content"]["blocks"] if b["id"] == block_id)["name"] == original
    assert fresh not in json.dumps(ok(second.founder.get(f"{run_two.S}/packets/preview"), 200)["content"], ensure_ascii=False)


def test_records_keep_names(clubs):
    club = clubs()
    manager = club.person("manager")
    run = club.run(api=manager)
    ended = club.run(api=manager)
    ok(ended.control("end"), 200)
    done = run.packet_done(run.packet()["id"])
    assert done["state"] == "Ready"
    before = run.pdf(done["id"])
    old = "Single Line West"
    fresh = f"Renamed Line {tag()}"
    block_id = club.block_id(4)
    assert old in squeezed(pdf_text(before))
    club.rename_block(block_id, fresh, api=manager)
    after = run.pdf(done["id"])
    assert after == before and fresh not in squeezed(pdf_text(after))
    version = club.version(club.version_id)
    assert next(b for b in version["content"]["blocks"] if b["id"] == block_id)["name"] == old
    assert run.block(run.snap(), 4)["name"] == fresh
    assert ended.block(ended.snap(), 4)["name"] == old
    history = ok(manager.get(f"{club.L}/history?{urlencode({'object_id': block_id})}"), 200)["history"]
    row = history[0]
    assert (row["action"], row["object_id"], row["from"], row["to"]) == ("block.renamed", block_id, old, fresh)
    assert manager.user["display_name"] in json.dumps(row["actor"]) or manager.user["id"] in json.dumps(row["actor"])


def test_restore_exact(clubs):
    club = clubs()
    manager = club.person("manager")
    source = club.version(club.version_id)
    assert canonical_hash(source["content"]) == source["canonical_hash"]
    run = club.run(api=manager)
    bench = club.module(manager)
    bench.grow(straight(TILE_STRAIGHT, 2))
    lay = club.lay()
    entries = [dict(e) for e in lay["content"]["timetable"]["entries"]]
    entries[0]["depart_fast_seconds"] += 60
    ok(manager.put(f"{club.L}/timetable", {"revision": lay["revision"], "entries": entries}), 200)
    club.rename_block(club.block_id(4), f"Other {tag()}", api=manager)
    run_name = run.block(run.snap(), 4)["name"]
    saved = club.save_version(manager)
    assert saved["canonical_hash"] != source["canonical_hash"]
    restored = ok(manager.post(f"{club.L}/versions/{source['id']}/restore", {"revision": club.lay()["revision"]}), 201)
    version = restored["version"]
    assert (version["number"], version["state"], version["restored_from"]) == (saved["number"] + 1, "Draft", source["id"])
    assert version["canonical_hash"] == source["canonical_hash"] == restored["working_hash"]
    lay = club.lay()
    assert lay["working_hash"] == source["canonical_hash"] == canonical_hash(lay["content"])
    assert lay["content"] == source["content"]
    assert club.version(version["id"])["content"] == source["content"]
    assert lay["counts"]["modules"] == len(lay["content"]["modules"])
    assert lay["counts"]["blocks"] == len(lay["content"]["blocks"])
    assert lay["counts"]["pieces"] == sum(len(m["pieces"]) for m in lay["content"]["modules"])
    snapshot = run.snap()
    assert run.block(snapshot, 4)["name"] == run_name
    assert_recount(snapshot)


def test_restore_retry(clubs):
    club = clubs()
    manager = club.person("manager")
    body = {"revision": club.lay()["revision"]}
    key = idempotency_key()
    path = f"{club.L}/versions/{club.version_id}/restore"
    first = ok(manager.post(path, body, key=key), 201)
    replay = manager.post(path, body, key=key)
    assert replay.status_code == 201 and replay.json() == first
    refused(manager.post(path, {"revision": body["revision"] + 1}, key=key), 422, "idempotency_key_reused", REUSED_COPY)
    assert len(ok(manager.get(f"{club.L}/versions"), 200)["versions"]) == 2


def test_wf_version_restore_restore_journey(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    club.module(manager).grow(straight(TILE_STRAIGHT))
    club.save_version(manager)
    source = club.version(club.version_id)
    restored = 3
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Versions")
        await_ui(page, lambda: word_count(sheet, "Draft") == 1, "saved version listed")
        click(row_button(sheet, "Published", "Restore"))
        announced(page, f"Restored as version {restored}.")
        await_ui(page, lambda: word_count(sheet, "Draft") == 2, "restored row shows Draft")
    assert club.lay()["working_hash"] == source["canonical_hash"]


def test_wf_version_restore_trash_undo_purge(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    before = club.lay()
    module = next(m for m in before["content"]["modules"] if m["name"] == "Single Line West")
    piece = module["pieces"][0]
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        trash = page.get_by_role("button", name="Trash module")
        assert trash.is_disabled()
        stage_item(page, f"Piece {piece['id']}")
        await_ui(page, trash.is_enabled, "Trash module enabled for the selected piece")
        click(trash)
        announced(page, "Moved to trash.")
        gone = club.lay()
        assert module["id"] not in [m["id"] for m in gone["content"]["modules"]]
        assert gone["counts"]["trash"] == before["counts"]["trash"] + 1
        assert gone["counts"]["pieces"] == before["counts"]["pieces"] - len(module["pieces"])
        assert gone["counts"]["blocks"] == before["counts"]["blocks"] - 1
        sheet = open_sheet(page, "Trash")
        click(sheet.get_by_role("button", name="Undo"))
        announced(page, "Module restored.")
        back = club.lay()
        assert back["working_hash"] == before["working_hash"] and back["content"] == before["content"]
        assert back["counts"] == before["counts"]
        click(sheet.get_by_role("button", name="Close"))
        advance(page, SHEET_MS)
        stage_item(page, f"Piece {piece['id']}")
        await_ui(page, trash.is_enabled, "module selectable again")
        click(trash)
        announced(page, "Moved to trash.")
        sheet = open_sheet(page, "Trash")
        purge = sheet.get_by_role("button", name="Purge")
        click(purge)
        announced(page, "Purged.")
        await_ui(page, lambda: purge.count() == 0, "row left the Trash sheet")
        click(sheet.get_by_role("button", name="Close"))
        advance(page, SHEET_MS)
        history = open_sheet(page, "History")
        await_ui(page, lambda: "Purged module" in history.inner_text(), "history shows the placeholder")
    assert ok(manager.get(f"{club.L}/trash"), 200)["modules"] == []


def test_purge_everywhere(clubs):
    club = clubs()
    manager, member = club.person("manager"), club.person("member")
    lay = club.lay()
    module = next(m for m in lay["content"]["modules"] if m["name"] == "Single Line West")
    ok(manager.patch(f"{club.L}/modules/{module['id']}/pieces/{module['pieces'][0]['id']}", {"revision": lay["module_revisions"][module["id"]], "note": "Marked"}), 200)
    club.save_version(manager, label="Before purge")
    ok(member.post(f"{club.L}/modules/{module['id']}/trash", {"revision": club.lay()["revision"]}), 200)
    listed = ok(member.get(f"{club.L}/trash"), 200)["modules"]
    assert [m["id"] for m in listed] == [module["id"]] and listed[0]["name"] == "Single Line West"
    search = f"{club.L}/blocks?{urlencode({'q': 'Single Line West'})}"
    assert ok(member.get(search), 200)["blocks"] == []
    refused(member.post(f"{club.L}/trash/{module['id']}/purge", {"revision": club.lay()["revision"]}), 403, "forbidden", FORBIDDEN_COPY)
    ok(manager.post(f"{club.L}/trash/{module['id']}/purge", {"revision": club.lay()["revision"]}), 200)
    after = club.lay()
    assert ok(member.get(f"{club.L}/trash"), 200)["modules"] == []
    assert module["id"] not in json.dumps(after["content"])
    assert after["counts"]["trash"] == 0 and after["counts"]["modules"] == lay["counts"]["modules"] - 1
    assert ok(member.get(search), 200)["blocks"] == []
    refused(manager.post(f"{club.L}/trash/{module['id']}/undo", {"revision": after["revision"]}), 404, "not_found", NOT_FOUND_COPY)
    history = ok(manager.get(f"{club.L}/history"), 200)["history"]
    assert any(h["action"] == "purged" and h["object_id"] is None for h in history)
    assert all(h["object_id"] != module["id"] for h in history)
    assert "Single Line West" in json.dumps(club.version(club.version_id)["content"])


def test_pinned_session(clubs):
    club = clubs()
    manager = club.person("manager")
    draft = club.save_version(manager)
    refused(manager.post(f"{club.W}/sessions", {"name": "Draft", "layout_version_id": draft["id"]}), 422, "version_not_published", "Only a Published version can run a session.")
    bad_ratio = manager.post(f"{club.W}/sessions", {"name": "Fast", "layout_version_id": club.version_id, "ratio": 13})
    assert bad_ratio.status_code == 422
    run = club.run(api=manager, start=False)
    pinned = run.snap()
    assert (pinned["status"], pinned["layout_version_id"], pinned["layout_version_number"], pinned["ratio"]) == ("Scheduled", club.version_id, 1, 6)
    bench = club.module(manager)
    bench.grow(straight(TILE_STRAIGHT))
    lay = club.lay()
    entries = [dict(e) for e in lay["content"]["timetable"]["entries"]]
    entries[0]["depart_fast_seconds"] += 60
    ok(manager.put(f"{club.L}/timetable", {"revision": lay["revision"], "entries": entries}), 200)
    west = next(m for m in club.lay()["content"]["modules"] if m["name"] == "Single Line West")
    ok(manager.post(f"{club.L}/modules/{west['id']}/trash", {"revision": club.lay()["revision"]}), 200)
    club.save_version(manager)
    after = run.snap()
    for field in ("layout_version_id", "layout_version_number", "timetable_version", "blocks", "trains", "turnouts", "revision"):
        assert after[field] == pinned[field], field


def test_wf_session_setup_timetable_to_session(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    old_run = club.run(api=manager, start=False)
    entries = club.lay()["content"]["timetable"]["entries"]
    departs = [e["depart_fast_seconds"] for e in entries]
    entry = next(e for e in entries if departs.count(e["depart_fast_seconds"]) == 1)
    moved = entry["depart_fast_seconds"] + 60
    with open_app(browser, app_url) as page:
        enter(page, app_url, manager.email, club.build())
        sheet = open_sheet(page, "Timetable")
        boxes = sheet.get_by_role("spinbutton", name="Depart").all()
        fill(next(b for b in boxes if b.input_value() == str(entry["depart_fast_seconds"])), str(moved))
        click(sheet.get_by_role("button", name="Save timetable"))
        announced(page, "Timetable saved.")
        click(sheet.get_by_role("button", name="Close"))
        advance(page, SHEET_MS)
        version = club.save_version(manager)
        version = ok(club.validate(version, manager), 200)["version"]
        ok(club.publish(version, manager), 200)
        sessions = bar_sheet(page, "Sessions")
        click(sessions.get_by_role("button", name="New session"))
        dialog = page.get_by_role("dialog", name="New session")
        await_ui(page, dialog.is_visible, "New session dialog opened")
        name = f"Run {tag()}"
        fill(dialog.get_by_role("textbox", name="Session name"), name)
        select(dialog.get_by_role("combobox", name="Published version"), f"Version {version['number']} {version['label']}")
        click(dialog.get_by_role("button", name="Create session"))
        announced(page, "Session created.")
    made = next(s for s in ok(manager.get(f"{club.W}/sessions"), 200)["sessions"] if s["name"] == name)
    run = Run(club, manager, made)
    club.runs.append(run)
    snapshot = run.snap()
    assert snapshot["layout_version_number"] == version["number"]
    assert snapshot["timetable_version"] == club.lay()["content"]["timetable"]["version"]
    assert snapshot["timetable_version"] > old_run.snap()["timetable_version"]
    published = club.version(version["id"])["content"]["timetable"]["entries"]
    assert next(e for e in published if e["id"] == entry["id"])["depart_fast_seconds"] == moved
    plan = json.dumps(ok(manager.get(f"{run.S}/packets/preview"), 200)["content"])
    assert clock_label(moved) in plan or str(moved) in plan


def test_extra_train_rules(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ready = run.packet_done(run.packet()["id"])
    assert ready["state"] == "Ready"
    base = run.snap()
    for number, kwargs in (("7", {"length": MIN_TRAIN_MM - 1, "start": 4}), ("8", {"length": MAX_TRAIN_MM + 1, "start": 4}),
                           ("9", {"speed": MIN_SPEED - 1, "start": 4}), ("10", {"speed": MAX_SPEED + 1, "start": 4}),
                           ("101", {"start": 4}), ("11", {"direction": "north", "start": 4})):
        resp = run.extra(number, **kwargs)
        assert resp.status_code == 422, resp.text
    refused(run.extra("12", 1), 422, "block_in_use", "Wren Quay Road is in use.")
    assert run.snap()["session_version"] == base["session_version"] == 1
    stale = operator.post(f"{run.S}/trains", {"revision": 0, "number": "13", "name": "Stale", "length_mm": MIN_TRAIN_MM,
                                              "speed_mph": MIN_SPEED, "direction": "east", "start_block_id": run.block(base, 4)["id"]})
    refused(stale, 409, "stale_revision", STALE_COPY)
    added = ok(run.extra("404", 4, length=MIN_TRAIN_MM, speed=MIN_SPEED), 201)
    assert added["session_version"] == 2
    assert_recount(added)
    assert added["counters"]["trains"] == len(base["trains"]) + 1
    train = run.train(added, "404")
    assert train["head_block_id"] == run.block(added, 4)["id"] and train["head_offset_mm"] == run.block(added, 4)["length_mm"]
    assert ok(run.extra("405", 9, length=MAX_TRAIN_MM, speed=MAX_SPEED, direction="west"), 201)["session_version"] == 3
    assert ok(operator.get(f"{run.S}/packets/{ready['id']}"), 200)["state"] == "Superseded"
    ok(run.control("end"), 200)
    refused(run.extra("406", 6), 422, "session_transition", "A Ended session cannot do that.")


def test_wf_session_setup_extra_train(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    number, version = "404", 2
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        click(session_button(page, "Add extra train"))
        dialog = page.get_by_role("dialog", name="Add extra train")
        await_ui(page, dialog.is_visible, "Add extra train dialog opened")
        fill(dialog.get_by_role("textbox", name="Train number"), number)
        fill(dialog.get_by_role("textbox", name="Train name"), "Night Extra")
        fill(dialog.get_by_role("spinbutton", name="Length"), str(MIN_TRAIN_MM))
        fill(dialog.get_by_role("spinbutton", name="Speed"), str(SEED_SPEED))
        select(dialog.get_by_role("combobox", name="Direction"), "West")
        select(dialog.get_by_role("combobox", name="Start block"), "Block 9 Single Line East")
        click(dialog.get_by_role("button", name="Add train"))
        announced(page, f"Train {number} added. Session version {version}.")
        await_ui(page, lambda: session_version(page) == f"Session version {version}" and figure(page, "Trains") == 4, "readout rose")
    snapshot = run.snap()
    train = run.train(snapshot, number)
    assert (train["length_mm"], train["speed_mph"], train["direction"]) == (MIN_TRAIN_MM, SEED_SPEED, "west")
    assert run.block(snapshot, 9)["state"] == "occupied"


def test_session_state_machine(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator, start=False)

    def illegal(status, commands):
        for command in commands:
            before = run.snap()
            assert before["status"] == status
            refused(run.control(command), 422, "session_transition", f"A {status} session cannot do that.")
            after = run.snap()
            assert (after["status"], after["control_revision"]) == (status, before["control_revision"])

    illegal("Scheduled", ["hold", "resume", "end"])
    body = {"revision": run.snap()["control_revision"]}
    key = idempotency_key()
    first = operator.post(f"{run.S}/start", body, key=key)
    assert first.status_code == 200 and first.json()["status"] == "Running"
    replay = operator.post(f"{run.S}/start", body, key=key)
    assert replay.status_code == 200 and replay.json() == first.json()
    stale = operator.post(f"{run.S}/hold", body)
    refused(stale, 409, "stale_revision", STALE_COPY)
    illegal("Running", ["start", "resume"])
    held_at = ok(run.control("hold"), 200)
    assert (held_at["status"], held_at["hold_reason"]) == ("Held", "operator")
    illegal("Held", ["start", "hold"])
    assert ok(run.control("resume"), 200)["status"] == "Running"
    assert ok(run.control("end"), 200)["status"] == "Ended"
    illegal("Ended", ["start", "hold", "resume", "end"])
    refused(run.highball("101", 4), 422, "session_not_active", "This session is not running.")
    scheduled = club.run(api=operator, start=False)
    refused(scheduled.highball("101", 4), 422, "session_not_active", "This session is not running.")


def test_wf_session_setup_skewed_clock(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator, start=False)
    with open_app(browser, app_url) as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        enter(page, app_url, operator.email, club.operate(run))
        await_ui(page, lambda: session_status(page) == "Scheduled", "status read Scheduled")
        click(session_button(page, "Start"))
        announced(page, "Session running.")
        await_ui(page, lambda: session_status(page) == "Running", "status read Running")
        assert run.snap()["status"] == "Running"
        click(session_button(page, "Hold"))
        await_ui(page, lambda: session_status(page) == "Held", "status read Held")
        tick = run.snap()["tick"]
        announced(page, f"Session held at tick {tick}.")


def test_wf_highball_grant(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        pick_destination(page, 4, "Single Line West")
        await_ui(page, lambda: preview_line(page) == route_line(3, 4) and attr(page, "data-preview-blocks") == ribbon(3, 4), "preview read the road")
        with held(page, "**/authorities") as release:
            press_highball(page)
            announced(page, "Requesting the road for Train 101.")
            assert attr(page, "data-ribbon-blocks") == ""
            assert figure(page, "Reserved") == 0
            assert block_state(page, 3) == "Free"
            release()
        announced(page, "Train 101 has the road to Single Line West, 2 blocks.")
        await_ui(page, lambda: attr(page, "data-ribbon-blocks") == ribbon(3, 4) and figure(page, "Reserved") == 2
                 and block_state(page, 3) == "Reserved" and block_state(page, 4) == "Reserved"
                 and attr(page, "data-limit-flag-block") == "4", "authority shown on stage, schematic and counter")
        snapshot = run.snap()
        assert attr(page, "data-scene-revision") == str(snapshot["revision"])
        authority = snapshot["authorities"][0]
        assert (authority["state"], authority["block_ids"]) == ("Granted", [club.block_id(3), club.block_id(4)])
        assert authority["limit_block_id"] == club.block_id(4)
        assert authority["expires_fast_seconds"] == snapshot["fast_clock_seconds"] + DEFAULT_LIMIT_S
        ok(run.control("resume"), 200)
        await_ui(page, lambda: block_state(page, 3) == "Occupied", "train runs on committed ticks")


def test_wf_highball_meet_at_fernhill(clubs, browser, app_url):
    club = clubs()
    operator, second = club.person("operator"), club.person("operator")
    run = club.run(api=operator)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        pick_destination(page, 6, "Fernhill Main")
        press_highball(page)
        announced(page, "Train 101 has the road to Fernhill Main, 4 blocks.")
        ok(run.highball("202", 7, api=second), 201)
        done = run.until(lambda s: all(a["state"] == "Released" for a in s["authorities"]) and len(s["authorities"]) == 2,
                         "both trains reached their limits", RUN_WAIT_S)
        assert {a["ended_reason"] for a in done["authorities"]} == {"completed"}
        await_ui(page, lambda: "101" in block_text(page, 6) and "202" in block_text(page, 7), "schematic shows the meet")
        pick_train(page, "101")
        pick_destination(page, 11, "Tarn Head Road")
        press_highball(page)
        announced(page, "Train 101 has the road to Tarn Head Road, 4 blocks.")
        ok(run.highball("202", 1, api=second), 201)
    snapshot = run.snap()
    assert sum(1 for a in snapshot["authorities"] if a["state"] == "Granted") == 2
    assert snapshot["conflicts"] == []


def test_wf_highball_phone_touch(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(PHONE)
        enter(page, app_url, operator.email, club.operate(run))
        tap(page.get_by_role("button", name="Schematic"))
        route = page.get_by_role("region", name="Route")
        await_ui(page, route.is_visible, "route panel opened in the bottom sheet")
        pick_train(page, "101", by=tap)
        pick_destination(page, 4, "Single Line West")
        await_ui(page, lambda: preview_line(page) == route_line(3, 4), "preview answered")
        page.keyboard.press("Escape")
        advance(page, UI_STEP_MS)
        tap(page.get_by_role("button", name="Highball"))
        announced(page, "Train 101 has the road to Single Line West, 2 blocks.")
        advance(page, UI_STEP_MS)
        assert attr(page, "data-ribbon-blocks") == ribbon(3, 4) and figure(page, "Reserved") == 2
        no_overflow(page)
    assert run.snap()["counters"]["reserved_blocks"] == 2


def test_one_winner_per_block(clubs):
    club = clubs()
    one, two = club.person("operator"), club.person("operator")
    for _round in range(3):
        run = club.run(api=one)
        ok(run.control("hold"), 200)
        answers = together(lambda: run.highball("101", 4, api=one, route="a"), lambda: run.highball("303", 4, api=two, route="b"))
        assert sorted(a.status_code for a in answers) == [201, 422]
        granted = next(a for a in answers if a.status_code == 201).json()
        loss = next(a for a in answers if a.status_code == 422)
        winner_id = granted["authority"]["train_id"]
        snapshot = run.snap()
        winner = next(t for t in snapshot["trains"] if t["id"] == winner_id)
        error = refused(loss, 422, "route_conflict", f"Train {winner['number']} holds Wren Approach.")
        assert error["authority"]["state"] == "Refused" and error["reachable_block_ids"] == []
        assert error["conflict"]["other_train_id"] == winner_id
        assert error["conflict"]["block_id"] == run.block(snapshot, 3)["id"]
        assert [a["train_id"] for a in snapshot["authorities"] if a["state"] == "Granted"] == [winner_id]
        assert snapshot["counters"]["reserved_blocks"] == 2 and snapshot["counters"]["open_conflicts"] == 1
        assert_recount(snapshot)
        ok(run.control("end"), 200)


def test_refused_highball_replays(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    granted = ok(run.highball("303", 4), 201)["authority"]
    train_id, body = run.highball_body("101", 4)
    key = idempotency_key()
    path = f"{run.S}/trains/{train_id}/authorities"
    first = operator.post(path, body, key=key)
    assert first.status_code == 422
    ok(operator.post(f"{run.S}/authorities/{granted['id']}/cancel", {"revision": granted["revision"]}), 200)
    before = run.snap()
    replay = operator.post(path, body, key=key)
    assert replay.status_code == 422 and replay.json() == first.json()
    after = run.snap()
    assert len(after["authorities"]) == len(before["authorities"]) and len(after["conflicts"]) == len(before["conflicts"])
    assert run.train(after, "101")["revision"] == run.train(before, "101")["revision"]
    refused(run.highball("101", 2), 422, "no_route", "There is no road from here to Wren Quay Loop.")
    ok(run.highball("101", 4), 201)
    refused(run.highball("101", 5), 422, "authority_active", "Train 101 already has the road.")


def test_route_preview_latest_wins(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        stash = []

        def hold_first(route):
            if stash:
                route.fallback()
            else:
                stash.append(route)

        page.route("**/route-preview", hold_first)
        pick_destination(page, 4, "Single Line West")
        await_ui(page, lambda: len(stash) == 1, "first preview left the browser")
        pick_destination(page, 3, "Wren Approach")
        await_ui(page, lambda: preview_line(page) == route_line(3) and attr(page, "data-preview-blocks") == ribbon(3), "newest preview shown")
        stash[0].fallback()
        advance(page, QUIET_MS * 2)
        assert preview_line(page) == route_line(3) and attr(page, "data-preview-blocks") == ribbon(3)
        page.unroute("**/route-preview", hold_first)

        late = []

        def hold_search(route):
            if late:
                route.fallback()
            else:
                late.append(route)

        page.route("**/blocks?q=*", hold_search)
        search = page.get_by_role("searchbox", name="Block search")
        results = page.get_by_role("listbox", name="Block results")
        fill(search, "Wren")
        await_ui(page, lambda: len(late) == 1, "first search left the browser")
        fill(search, "Fernhill Main")
        await_ui(page, lambda: results.get_by_role("option", name="Block 6 Fernhill Main").count() == 1, "newest results shown")
        late[0].fallback()
        advance(page, QUIET_MS * 2)
        assert results.get_by_role("option", name="Block 1 Wren Quay Road").count() == 0
        page.unroute("**/blocks?q=*", hold_search)
        search.fill("")
        ready(search).press_sequentially("Tarn Ap")
        await_ui(page, lambda: results.get_by_role("option", name="Block 10 Tarn Approach").count() == 1
                 and results.get_by_role("option").count() == 1, "final keystroke searched")


def test_route_locking_and_cancelling(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    granted = ok(run.highball("303", 4), 201)
    authority = granted["authority"]
    t1 = next(t for t in granted["session"]["turnouts"] if t["id"] == "T1")
    assert (t1["position"], t1["locked_by_authority_id"]) == ("reverse", authority["id"])
    snapshot = run.snap()
    thrown = operator.post(f"{run.S}/turnouts/T1/throw", {"revision": snapshot["control_revision"], "position": "normal"})
    refused(thrown, 422, "turnout_locked", "Turnout T1 is locked by Train 303.")
    assert next(t for t in run.snap()["turnouts"] if t["id"] == "T1")["position"] == "reverse"
    free_throw = ok(operator.post(f"{run.S}/turnouts/T4/throw", {"revision": run.snap()["control_revision"], "position": "reverse"}), 200)
    assert next(t for t in free_throw["turnouts"] if t["id"] == "T4")["position"] == "reverse"
    run.head_in("303", 3)
    ok(run.control("hold"), 200)
    current = next(a for a in run.snap()["authorities"] if a["id"] == authority["id"])
    cancel = f"{run.S}/authorities/{authority['id']}/cancel"
    refused(operator.post(cancel, {"revision": current["revision"]}), 422, "approach_locked", "Train 303 is on the approach. The authority cannot be cancelled.")
    assert next(a for a in run.snap()["authorities"] if a["id"] == authority["id"])["state"] == "Granted"
    ok(run.control("resume"), 200)
    run.head_in("303", 4)
    ok(run.control("hold"), 200)
    current = next(a for a in run.snap()["authorities"] if a["id"] == authority["id"])
    released = ok(operator.post(cancel, {"revision": current["revision"]}), 200)
    assert (released["authority"]["state"], released["authority"]["ended_reason"]) == ("Released", "cancelled")
    t1 = next(t for t in released["session"]["turnouts"] if t["id"] == "T1")
    assert t1["locked_by_authority_id"] is None
    refused(operator.post(cancel, {"revision": released["authority"]["revision"]}), 422, "authority_ended", "That authority has already ended.")


def assert_granted(run, authority_id):
    assert next(a for a in run.snap()["authorities"] if a["id"] == authority_id)["state"] == "Granted"


def test_authority_expiry(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator, ratio=1)
    ok(run.control("hold"), 200)
    authority = ok(run.highball("101", 9, limit=6), 201)["authority"]
    expires = authority["expires_fast_seconds"]
    steady(lambda: assert_granted(run, authority["id"]), HOLD_WATCH_S)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        page.clock.fast_forward(SKEW_MS)
        assert_granted(run, authority["id"])
        ok(run.control("resume"), 200)
        ended = run.until(lambda s: next(a for a in s["authorities"] if a["id"] == authority["id"])["state"] != "Granted", "authority ended")
        announced(page, "Authority for Train 101 expired.")
    record = next(a for a in ended["authorities"] if a["id"] == authority["id"])
    assert (record["state"], record["ended_reason"]) == ("Revoked", "expired")
    assert ended["counters"]["reserved_blocks"] == 0 and ended["fast_clock_seconds"] >= expires
    rows = Postgres().rows(f"select payload->'detail' as detail from event_outbox where stream = '{run.stream}' "
                           f"and type = 'tick.committed' and payload->'detail'->>'authorities_revoked' like '%{authority['id']}%'")
    assert len(rows) == 1 and "expired" in json.dumps(rows[0]["detail"]["authorities_revoked"])
    tick = int(rows[0]["detail"]["tick"])
    assert tick >= expires and tick - 1 < expires
    stopped = run.train(run.snap(), "101")
    assert run.block(run.snap(), 3)["id"] == stopped["head_block_id"], "train stopped where it stood on the approach"
    position = stopped["distance_run_mm"]
    run.at_tick(run.snap()["tick"] + 2)
    assert run.train(run.snap(), "101")["distance_run_mm"] == position


def test_gapless_ticks(clubs):
    club = clubs()
    run = club.run(ratio=7)
    ok(run.highball("101", 4), 201)
    snapshot = run.at_tick(8)
    assert snapshot["fast_clock_seconds"] == snapshot["tick"] * 7
    assert snapshot["fast_clock_label"] == clock_label(snapshot["tick"] * 7)
    pg = Postgres()
    rows = pg.rows(f"select tick, revision, positions, counters, extract(epoch from committed_at) as at from session_ticks "
                   f"where session_id = '{run.id}' order by tick")
    ticks = [int(r["tick"]) for r in rows]
    assert ticks == list(range(1, len(ticks) + 1)) and len(ticks) >= 8
    spacing = (float(rows[-1]["at"]) - float(rows[0]["at"])) / (len(rows) - 1)
    assert TICK_RATE_LOW <= spacing * 1000 / TICK_MS <= TICK_RATE_HIGH
    outbox = {int(r["seq"]): r for r in pg.rows(f"select seq, type, payload->'detail'->>'tick' as tick from event_outbox where stream = '{run.stream}'")}
    for row in rows:
        event = outbox[int(row["revision"])]
        assert event["type"] == "tick.committed" and int(event["tick"]) == int(row["tick"])
        assert row["positions"] and row["counters"]
    assert len([e for e in outbox.values() if e["type"] == "tick.committed"]) >= len(rows)


def test_scale_speed(clubs):
    club = clubs()
    run = club.run()
    ok(run.extra("600", 6, speed=MAX_SPEED), 201)
    ok(run.extra("500", 7, speed=MIN_SPEED, direction="west"), 201)
    ok(run.highball("600", 10), 201)
    ok(run.highball("500", 5), 201)
    ok(run.highball("303", 4), 201)
    speeds = {"600": MAX_SPEED, "500": MIN_SPEED, "303": SHUTTLE_SPEED}

    def ran(train, mph):
        scaled = train["distance_run_mm"] * SPEED_DIVISOR + train["carry"]
        assert scaled % (mph * SPEED_FACTOR) == 0, f"Train {train['number']} left the formula"
        return scaled // (mph * SPEED_FACTOR)

    first = run.until(lambda s: all(run.train(s, n)["distance_run_mm"] > 0 for n in speeds), "trains started")
    counted = {n: ran(run.train(first, n), mph) for n, mph in speeds.items()}
    later = run.at_tick(first["tick"] + 4)
    for number, mph in speeds.items():
        assert ran(run.train(later, number), mph) == counted[number] + later["tick"] - first["tick"]
    paused = ok(run.control("hold"), 200)
    resumed = ok(run.control("resume"), 200)
    for number in speeds:
        assert run.train(resumed, number)["carry"] == run.train(paused, number)["carry"]
    final = run.at_tick(resumed["tick"] + 2)
    for number, mph in speeds.items():
        assert ran(run.train(final, number), mph) == counted[number] + final["tick"] - first["tick"]
    limited = club.run()
    ok(limited.highball("101", 3), 201)
    done = limited.until(lambda s: s["authorities"][0]["state"] == "Released", "Train 101 reached its limit", RUN_WAIT_S)
    train = limited.train(done, "101")
    assert done["authorities"][0]["ended_reason"] == "completed"
    assert train["head_block_id"] == limited.block(done, 3)["id"] and train["head_offset_mm"] == BLOCK_3_LENGTH
    assert train["distance_run_mm"] == BLOCK_1_LENGTH - SEED_HEAD + BLOCK_3_LENGTH


def test_committed_occupancy(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.highball("101", 5), 201)
    seen_two = False
    last_tick = -1
    enough = 12
    deadline = time.monotonic() + API_WAIT_S
    while time.monotonic() < deadline and not (seen_two and last_tick > enough):
        snapshot = run.snap()
        if snapshot["tick"] == last_tick:
            pause()
            continue
        last_tick = snapshot["tick"]
        lengths = {b["id"]: b["length_mm"] for b in snapshot["blocks"]}
        occupied = set()
        for train in snapshot["trains"]:
            derived = derived_occupancy(train, lengths)
            assert set(train["occupied_block_ids"]) == derived, f"tick {last_tick}: Train {train['number']}"
            occupied |= derived
            seen_two = seen_two or len(derived) > 1
        reserved = {b for a in snapshot["authorities"] if a["state"] == "Granted" for b in a["remaining_block_ids"]} - occupied
        for block in snapshot["blocks"]:
            expected = "occupied" if block["id"] in occupied else "reserved" if block["id"] in reserved else "free"
            assert block["state"] == expected, f"block {block['number']} at tick {last_tick}"
    if not (seen_two and last_tick > enough):
        pytest.fail("GET S never showed a train straddling two blocks over several ticks")
    ok(run.control("hold"), 200)
    busy = next(b for b in run.snap()["blocks"] if b["state"] == "occupied")
    refused(run.service(busy["number"], True), 422, "block_in_use", f"{busy['name']} is in use.")
    other = club.run(api=operator)
    before = other.snap()["counters"]["occupied_blocks"]
    taken = ok(other.service(4, True), 200)
    assert other.block(taken, 4)["state"] == "out_of_service"
    assert taken["counters"]["occupied_blocks"] == before + 1
    error = refused(other.highball("101", 5), 422, "route_conflict", "Single Line West is out of service.")
    assert error["conflict"]["other_train_id"] is None and error["reachable_block_ids"] == [other.block(taken, 3)["id"]]
    assert other.block(ok(other.service(4, False), 200), 4)["state"] == "free"


def test_counters_recount(clubs):
    club = clubs()
    operator, manager = club.person("operator"), club.person("manager")
    run = club.run(api=operator)
    train_id, body = run.highball_body("101", 5)
    key = idempotency_key()
    path = f"{run.S}/trains/{train_id}/authorities"
    ok(operator.post(path, body, key=key), 201)
    assert_recount(run.snap())
    ok(operator.post(path, body, key=key), 201)
    assert_recount(run.snap())
    tick = run.snap()["tick"]
    for target in range(tick + 1, tick + 5):
        assert_recount(run.at_tick(target))
    assert_recount(ok(run.control("hold"), 200))
    assert_recount(ok(run.control("resume"), 200))
    ok(manager.post(f"{club.L}/versions/{club.version_id}/restore", {"revision": club.lay()["revision"]}), 201)
    assert_recount(run.snap())
    refused(run.highball("303", 5), 422, "route_conflict")
    refusal = run.snap()
    assert refusal["counters"]["open_conflicts"] == 1
    assert_recount(refusal)
    moved = ok(run.move("303", "back-to-loop"), 200)
    assert moved["counters"]["open_conflicts"] == 0
    assert_recount(moved)
    assert_recount(ok(run.extra("404", 12, direction="west"), 201))
    assert_recount(run.at_tick(run.snap()["tick"] + 1))


def test_wf_running_ticks_live_stage(clubs, browser, app_url, valkey):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    holder = poll(lambda: lease_holder(valkey, run), "a tick lease holder appeared")
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run), route=other_instance(holder))
        mark_no_reload(page)
        assert stage_of(page).count() == 1
        start = tick_of(page)
        clock = fast_clock(page)
        occupied = figure(page, "Occupied")
        ok(run.highball("101", 4), 201)
        await_ui(page, lambda: tick_of(page) >= start + 3 and fast_clock(page) != clock, "ticks reached the screen")
        await_ui(page, lambda: block_state(page, 3) == "Occupied", "block state followed the train")
        await_ui(page, lambda: figure(page, "Occupied") > occupied, "occupied counter rose")
        await_ui(page, lambda: fast_clock(page) == clock_label(tick_of(page) * 6), "clock is the committed tick times the ratio")
        assert_no_reload(page)
        assert lease_holder(valkey, run) == holder


def test_wf_running_ticks_phone_reduced_motion(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.highball("101", 3), 201)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(PHONE)
        enter(page, app_url, operator.email, club.operate(run))
        start = tick_of(page)
        await_ui(page, lambda: tick_of(page) >= start + 2, "ticks stream on the phone")
        bar = box(page.get_by_role("navigation", name="Session bar"))
        readout = on_screen(page, CLOCK_TEXT)
        assert readout is not None and box(readout)["y"] >= bar["y"] + bar["height"] - 1, "readout on a second line under the bar"
        ok(run.control("hold"), 200)
        held_at = run.snap()
        await_ui(page, lambda: attr(page, "data-scene-tick") == str(held_at["tick"]), "screen caught the last tick")
        figures = held_at["counters"]
        expected = {"Occupied": figures["occupied_blocks"], "Reserved": figures["reserved_blocks"], "Free": figures["free_blocks"],
                    "Trains": figures["trains"], "Conflicts": figures["open_conflicts"]}
        await_ui(page, lambda: counters(page) == expected, "readout equals the recount")
        assert_recount(held_at)
        no_overflow(page)


def test_device_clock_ignored(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    authority = ok(run.highball("101", 9), 201)["authority"]
    with open_app(browser, app_url) as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        enter(page, app_url, operator.email, club.operate(run))
        await_ui(page, lambda: fast_clock(page) == clock_label(tick_of(page) * 6), "clock is tick times ratio")
        assert session_status(page) == "Running"
        ok(run.control("hold"), 200)
        snapshot = run.snap()
        await_ui(page, lambda: session_status(page) == "Held" and fast_clock(page) == snapshot["fast_clock_label"], "held on the server's clock")
        page.clock.fast_forward(SKEW_MS)
        advance(page, UI_STEP_MS)
        assert fast_clock(page) == snapshot["fast_clock_label"]
        assert session_status(page) == "Held"
        assert attr(page, "data-scene-tick") == str(snapshot["tick"])
        assert "expired" not in status_text(page)
        assert_granted(run, authority["id"])


def test_wf_conflict_deadlock_refused_conflict_sheet(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    ok(run.highball("303", 4), 201)
    note = f"Wait at the board {tag()}"
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        pick_destination(page, 4, "Single Line West")
        press_highball(page)
        announced(page, "Train 101 refused at Wren Approach: held by Train 303.")
        sheet = sheet_of(page, "Conflict")
        await_ui(page, lambda: sheet.is_visible() and "303" in sheet.inner_text(), "Conflict sheet names the other train")
        fill(sheet.get_by_role("textbox", name="Dispatcher note"), note)
        click(sheet.get_by_role("button", name="Save note"))
        announced(page, "Note saved.")
        conflict = run.snap()["conflicts"][0]
        assert (conflict["note"], conflict["state"]) == (note, "Open")
        click(sheet.get_by_role("button", name="Withdraw request"))
        announced(page, "Request withdrawn.")
        await_ui(page, lambda: figure(page, "Conflicts") == 0, "conflict counter fell")
        assert run.snap()["conflicts"][0]["state"] == "Closed"
        pick_train(page, "101")
        pick_destination(page, 4, "Single Line West")
        press_highball(page)
        await_ui(page, lambda: sheet.is_visible() and figure(page, "Conflicts") == 1, "second refusal opened the sheet")
        click(sheet.get_by_role("button", name="Back to loop"))
        announced(page, "Train 101 is in Fernhill Loop.")
    snapshot = run.snap()
    assert run.train(snapshot, "101")["head_block_id"] == run.block(snapshot, 7)["id"]
    assert snapshot["counters"]["open_conflicts"] == 0


def test_wf_conflict_deadlock_rescue(clubs, browser, app_url):
    club = clubs()
    one, two = club.person("operator"), club.person("operator")
    run = club.run(api=one)
    with open_app(browser, app_url) as page:
        enter(page, app_url, FOUNDER, club.operate(run))
        refused(run.highball("101", 11, api=one), 422, "route_conflict", "Train 202 holds Tarn Head Road.")
        refused(run.highball("202", 1, api=two), 422, "route_conflict", "Train 101 holds Wren Quay Road.")
        announced(page, "Deadlock: Trains 101, 202 are waiting on each other.")
        page.goto(f"{app_url}/?{urlencode(club.operate(run, sheet='deadlock'))}")
        wait_stage(page)
        sheet = sheet_of(page, "Deadlock")
        await_ui(page, lambda: sheet.is_visible() and "101" in sheet.inner_text() and "202" in sheet.inner_text(), "Deadlock sheet lists members")
        buttons = sheet.get_by_role("button", name="Back to loop")
        assert buttons.count() == 2
        target = next(buttons.nth(i) for i in range(2) if "101" in buttons.nth(i).evaluate(
            "el => (el.getAttribute('aria-describedby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ')"))
        click(target)
        announced(page, "Train 101 is in Fernhill Loop.")
    snapshot = run.snap()
    assert snapshot["deadlocks"][0]["state"] == "Cleared"
    assert ok(run.highball("202", 1, api=two), 201)["authority"]["state"] == "Granted"


def assert_no_deadlock(run):
    assert run.snap()["deadlocks"] == []


def test_deadlock_raised_on_tick(clubs):
    club = clubs()
    one, two = club.person("operator"), club.person("operator")
    run = club.run(api=one)
    ok(run.control("hold"), 200)
    answers = together(lambda: run.highball("101", 11, api=one, route="a"), lambda: run.highball("202", 1, api=two, route="b"))
    assert [a.status_code for a in answers] == [422, 422]
    assert all(a.json()["error"]["code"] == "route_conflict" for a in answers)
    steady(lambda: assert_no_deadlock(run), VALKEY_NOTICE_S)
    tick = run.snap()["tick"]
    ok(run.control("resume"), 200)
    raised = run.until(lambda s: s["deadlocks"], "deadlock raised after resume")
    assert len(raised["deadlocks"]) == 1
    deadlock = raised["deadlocks"][0]
    assert deadlock["state"] == "Open" and deadlock["raised_at_tick"] == tick + 1
    assert {str(n) for n in deadlock["train_numbers"]} == {"101", "202"}
    stuck = "Trains 101, 202 are deadlocked. Use Back to loop or Recall."
    refused(run.highball("101", 4), 422, "deadlock_open", stuck)
    conflict = next(c for c in raised["conflicts"] if c["state"] == "Open")
    refused(one.post(f"{run.S}/conflicts/{conflict['id']}/withdraw", {"revision": conflict["revision"]}), 422, "deadlock_open", stuck)
    assert run.snap()["deadlocks"][0]["state"] == "Open"
    assert len(run.at_tick(tick + 4)["deadlocks"]) == 1
    rows = Postgres().rows(f"select payload->'detail'->'deadlocks_raised' as raised from event_outbox where stream = '{run.stream}' "
                           f"and type = 'tick.committed' and (payload->'detail'->>'tick')::bigint = {tick + 1}")
    assert rows and rows[0]["raised"]
    single = club.run(api=one)
    refused(single.highball("101", 11), 422, "route_conflict")
    single.at_tick(single.snap()["tick"] + 2)
    assert single.snap()["deadlocks"] == []


def test_back_to_loop_and_recall(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    authority = ok(run.highball("101", 4), 201)["authority"]
    refused(run.highball("303", 4), 422, "route_conflict")
    moved = ok(run.move("101", "back-to-loop"), 200)
    train = run.train(moved, "101")
    loop = run.block(moved, 7)
    assert (train["head_block_id"], train["head_offset_mm"], train["trail_block_ids"]) == (loop["id"], loop["length_mm"], [loop["id"]])
    record = next(a for a in moved["authorities"] if a["id"] == authority["id"])
    assert (record["state"], record["ended_reason"]) == ("Revoked", "moved")
    assert all(c["state"] == "Closed" for c in moved["conflicts"])
    assert_recount(moved)
    assert moved["counters"]["reserved_blocks"] == 0 and moved["counters"]["open_conflicts"] == 0
    types = Postgres().rows(f"select type from event_outbox where stream = '{run.stream}' and seq = {moved['revision']}")
    assert types == [{"type": "train.moved"}]
    ok(run.extra("404", 1), 201)
    refused(run.move("101", "recall"), 422, "recall_blocked", "Wren Quay Road is not free.")
    assert run.train(run.snap(), "101")["head_block_id"] == loop["id"]
    second = club.run(api=operator)
    ok(second.service(7, True), 200)
    ok(second.service(12, True), 200)
    refused(second.move("101", "back-to-loop"), 422, "no_free_loop", "No loop is free for Train 101.")
    third = club.run(api=operator)
    ok(third.highball("101", 4), 201)
    third.head_in("101", 4)
    recalled = ok(third.move("101", "recall"), 200)
    train = third.train(recalled, "101")
    start = third.block(recalled, 1)["id"]
    assert (train["head_block_id"], train["head_offset_mm"], train["trail_block_ids"]) == (start, SEED_HEAD, [start])
    assert recalled["authorities"][0]["ended_reason"] == "moved"
    assert_recount(recalled)


def test_working_state_survives_ticks(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.highball("303", 4), 201)
    draft = f"Half typed {tag()}"
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        pick_destination(page, 4, "Single Line West")
        press_highball(page)
        sheet = sheet_of(page, "Conflict")
        await_ui(page, sheet.is_visible, "Conflict sheet opened")
        note = sheet.get_by_role("textbox", name="Dispatcher note")
        fill(note, draft)
        ready(note).focus()
        note.evaluate("el => el.setSelectionRange(2, 2)")
        start = tick_of(page)
        await_ui(page, lambda: tick_of(page) >= start + 3, "ticks kept landing")
        assert sheet.is_visible() and note.input_value() == draft
        assert note.evaluate("el => document.activeElement === el && el.selectionStart") == 2
        assert train_option(page, "101", selected=True).count() == 1

        def failing(route):
            route.fulfill(status=409, content_type="application/json",
                          body=json.dumps({"error": {"code": "stale_revision", "message": STALE_COPY}}))

        page.route("**/conflicts/*", failing)
        click(sheet.get_by_role("button", name="Save note"))
        announced(page, STALE_COPY)
        now = tick_of(page)
        await_ui(page, lambda: tick_of(page) >= now + 2, "repaints passed")
        assert STALE_COPY in status_text(page) or page.get_by_role("alert").filter(has_text=STALE_COPY).count() == 1
        page.unroute("**/conflicts/*", failing)
        assert query_of(page)["sheet"] == ["conflict"]
        page.reload()
        wait_stage(page)
        await_ui(page, lambda: sheet.is_visible() and note.input_value() == draft, "refresh restored sheet and note")
        await_ui(page, lambda: train_option(page, "101", selected=True).count() == 1, "refresh restored the selected train")


def test_tick_lease_takeover(clubs, valkey):
    club = clubs()
    run = club.run()
    founder = club.founder
    holder = poll(lambda: lease_holder(valkey, run), "a tick lease holder appeared")
    assert holder in ("a", "b")
    expiry = valkey.command("PTTL", f"gandyboard:session:{run.id}:tick-lease")
    assert 0 < int(expiry) <= LEASE_MS
    leases = {i["id"]: i["leases"] for i in ok(founder.get("/api/ops/instances"), 200)["instances"]}
    assert run.id in leases[holder] and run.id not in leases[other_instance(holder)]
    survivor = other_instance(holder)
    tick = run.at_tick(3)["tick"]
    ok(founder.post(f"/api/ops/instances/{holder}/stop", {"restart_after_ms": SURVIVOR_DOWN_MS}, key=None, route=survivor), 202)
    poll(lambda: lease_holder(valkey, run) == survivor, "survivor took the lease", TAKEOVER_S + 2)
    snapshot = ok(founder.get(run.S, route=survivor), 200)
    assert snapshot["status"] == "Running"

    def later():
        current = ok(founder.get(run.S, route=survivor), 200)
        return current if current["tick"] >= tick + 8 else None
    poll(later, "ticks went on after takeover", API_WAIT_S)
    ticks = stored_ticks(run)
    assert ticks == list(range(1, len(ticks) + 1))
    instances_up(founder)


def restarting(api):
    try:
        resp = api.get("/api/health")
    except httpx.HTTPError:
        return None
    return resp if resp.status_code == 503 else None


def test_wf_resume_recovery_interrupted(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    founder = club.founder
    authority = ok(run.highball("101", 9), 201)["authority"]
    earlier = run.at_tick(3)
    with open_app(browser, app_url) as page:
        page.clock.set_system_time(SKEWED_DEVICE_TIME)
        enter(page, app_url, operator.email, club.operate(run))
        assert stop_instance(founder, "a", ALL_DOWN_MS, "b").status_code == 202
        stop_instance(founder, "b", ALL_DOWN_MS, "b")
        down = poll(lambda: restarting(founder), "origin answered instances_restarting with no instance up")
        refused(down, 503, "instances_restarting", "Gandyboard is restarting. Try again in a moment.")
        instances_up(founder)
        interrupted = run.until(lambda s: s["status"] == "Interrupted", "session read Interrupted", API_WAIT_S)
        ticks = stored_ticks(run)
        assert ticks == list(range(1, len(ticks) + 1)) and interrupted["tick"] == ticks[-1]
        assert_recount(interrupted)
        await_ui(page, lambda: session_status(page) == "Interrupted", "screen read Interrupted", RUN_WAIT_S)
        click(session_button(page, "Resume"))
        announced(page, f"Session resumed at tick {interrupted['tick']}.")
    resumed = run.snap()
    assert resumed["status"] == "Running" and resumed["tick"] >= interrupted["tick"]
    assert next(a for a in resumed["authorities"] if a["id"] == authority["id"])["state"] == "Granted"

    def scaled(train):
        return train["distance_run_mm"] * SPEED_DIVISOR + train["carry"]

    gained = scaled(run.train(interrupted, "101")) - scaled(run.train(earlier, "101"))
    assert gained == (interrupted["tick"] - earlier["tick"]) * SEED_SPEED * SPEED_FACTOR
    arrived = [p for p in interrupted["timetable_progress"] if p["arrived_fast_seconds"] is not None]
    assert all(p in resumed["timetable_progress"] for p in arrived)
    assert interrupted["fast_clock_seconds"] == interrupted["tick"] * 6
    run.at_tick(interrupted["tick"] + 2)
    ticks = stored_ticks(run)
    assert ticks == list(range(1, len(ticks) + 1))
    assert_recount(run.snap())


def assert_tick(run, tick):
    assert run.snap()["tick"] == tick


def test_wf_resume_recovery_held(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    run.at_tick(2)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        click(session_button(page, "Hold"))
        await_ui(page, lambda: session_status(page) == "Held", "status read Held")
        tick = run.snap()["tick"]
        announced(page, f"Session held at tick {tick}.")
        steady(lambda: assert_tick(run, tick), VALKEY_NOTICE_S)
        click(session_button(page, "Resume"))
        announced(page, f"Session resumed at tick {tick}.")
        await_ui(page, lambda: tick_of(page) >= tick + 1, "next tick reached the screen")
    run.at_tick(tick + 1)
    ticks = stored_ticks(run)
    assert ticks == list(range(1, len(ticks) + 1))


def test_two_resumes_one_acts(clubs):
    club = clubs()
    one, two = club.person("operator"), club.person("operator")
    run = club.run(api=one)
    held_at = ok(run.control("hold"), 200)
    body = {"revision": held_at["control_revision"]}
    answers = together(lambda: one.post(f"{run.S}/resume", body, route="a"), lambda: two.post(f"{run.S}/resume", body, route="b"))
    assert sorted(a.status_code for a in answers) == [200, 409]
    refused(next(a for a in answers if a.status_code == 409), 409, "stale_revision", STALE_COPY)
    after = run.snap()
    assert after["status"] == "Running" and after["control_revision"] == held_at["control_revision"] + 1


def test_retried_commands(clubs):
    club = clubs()
    operator, other = club.person("operator"), club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    train_id, body = run.highball_body("101", 4)
    path = f"{run.S}/trains/{train_id}/authorities"
    key = idempotency_key()
    first = operator.post(path, body, key=key, route="a")
    assert first.status_code == 201
    replay = operator.post(path, body, key=key, route="b")
    assert replay.status_code == 201 and replay.json() == first.json()
    assert len(run.snap()["authorities"]) == 1
    refused(operator.post(path, {**body, "time_limit_fast_seconds": 60}, key=key), 422, "idempotency_key_reused", REUSED_COPY)
    train_id, body = run.highball_body("202", 9)
    path = f"{run.S}/trains/{train_id}/authorities"
    racing = idempotency_key()
    left, right = together(lambda: operator.post(path, body, key=racing, route="a"), lambda: operator.post(path, body, key=racing, route="b"))
    assert left.status_code == right.status_code == 201 and left.json() == right.json()
    assert len(run.snap()["authorities"]) == 2
    refused(run.highball("303", 4, key=key, api=other), 422, "route_conflict")
    control = {"revision": run.snap()["control_revision"]}
    key = idempotency_key()
    first = operator.post(f"{run.S}/resume", control, key=key)
    assert first.status_code == 200
    level = run.snap()["control_revision"]
    replay = operator.post(f"{run.S}/resume", control, key=key)
    assert replay.status_code == 200 and replay.json() == first.json()
    assert run.snap()["control_revision"] == level
    key = idempotency_key()
    packet_body = {"revision": run.snap()["session_version"]}
    first = operator.post(f"{run.S}/packets", packet_body, key=key)
    assert first.status_code == 202
    replay = operator.post(f"{run.S}/packets", packet_body, key=key)
    assert replay.status_code == 202 and replay.json() == first.json()
    refused(operator.post(f"{run.S}/packets", {"revision": packet_body["revision"] + 1}, key=key), 422, "idempotency_key_reused", REUSED_COPY)
    assert len(ok(operator.get(f"{run.S}/packets"), 200)["packets"]) == 1
    assert_recount(run.snap())


def test_wf_crew_packets_issue_download(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        sheet = bar_sheet(page, "Crew packets")
        with held(page, "**/packets") as release:
            click(sheet.get_by_role("button", name="Issue packet"))
            announced(page, "Issuing crew packet.")
            assert ok(operator.get(f"{run.S}/packets"), 200)["packets"] == []
            release()
        listed = poll(lambda: ok(operator.get(f"{run.S}/packets"), 200)["packets"], "packet recorded")
        assert len(listed) == 1
        await_ui(page, lambda: word_count(sheet, "Ready") >= 1, "row reached Ready", PACKET_S + SLACK_S)
        announced(page, "Crew packet ready.")
        link = sheet.get_by_role("link", name="Download PDF")
        assert link.count() == 1
        answer = page.context.request.get(urljoin(f"{app_url}/", link.get_attribute("href")))
        assert answer.status == 200 and answer.headers["content-type"].startswith("application/pdf")
        data = answer.body()
    packet = ok(operator.get(f"{run.S}/packets/{listed[0]['id']}"), 200)
    assert packet["state"] == "Ready" and packet["byte_length"] == len(data) and pdf_pages(data) >= 1
    stored = Postgres().rows(f"select encode(sha256(pdf_bytes), 'hex') as digest from crew_packets where id = '{packet['id']}'")
    assert stored == [{"digest": hashlib.sha256(data).hexdigest()}]


def test_packet_contents(clubs):
    club = clubs()
    run = club.run()
    preview = ok(club.founder.get(f"{run.S}/packets/preview"), 200)
    assert preview["content_hash"] == canonical_hash({"session_version": preview["session_version"], "content": preview["content"]})
    done = run.packet_done(run.packet()["id"])
    assert done["state"] == "Ready" and done["content_hash"] == preview["content_hash"] and done["session_version"] == 1
    data = run.pdf(done["id"])
    text = pdf_text(data)
    flat = squeezed(text)
    for heading in ("Timetable", "Train orders", "Block table", "Track diagram"):
        assert heading in flat
    number, name, direction, first, last = "101", "Wren Quay Pickup", "east", "Wren Quay", "Tarn Head"
    assert f"Train {number} {name}: run {direction} from {first} to {last}, departing {clock_label(TT1_DEPART)}." in flat
    assert "Fernhill East Approach" in flat
    pages = [p for p in text.split("\f") if p.strip()]
    assert len(pages) == pdf_pages(data) >= 1
    stamp = re.sub(r"\s", "", f"Session version {done['session_version']} | Content hash {done['content_hash']}")
    for page_text in pages:
        assert stamp in re.sub(r"\s", "", page_text)


def test_gotenberg_html_document(clubs):
    base = os.environ["APP_GOTENBERG_DOWN_URL"]
    club = clubs(base)
    run = club.run()
    stub = StubPdfService()
    try:
        service_state(club.founder, "gotenberg", "up", TAKEOVER_S + SLACK_S)
        done = run.packet_done(run.packet()["id"])
        assert done["state"] == "Ready"
        assert run.pdf(done["id"]) == TINY_PDF
    finally:
        stub.stop()
    renders = [body for path, body in stub.calls if path == "/forms/chromium/convert/html"]
    assert len(renders) == 1
    for heading in (b"Timetable", b"Train orders", b"Block table", b"Track diagram", b"Content hash"):
        assert heading in renders[0]


def test_wf_crew_packets_superseded(clubs, browser, app_url):
    club = clubs()
    operator, manager = club.person("operator"), club.person("manager")
    run = club.run(api=operator)
    first = run.packet_done(run.packet()["id"])
    original = run.pdf(first["id"])
    fresh = f"New Line {tag()}"
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        sheet = bar_sheet(page, "Crew packets")
        await_ui(page, lambda: word_count(sheet, "Ready") >= 1, "row read Ready")
        club.rename_block(club.block_id(4), fresh, api=manager)
        await_ui(page, lambda: word_count(sheet, "Superseded") == 1, "rename superseded the row")
        await_ui(page, lambda: fresh in sheet.inner_text(), "preview shows the new name")
        assert sheet.get_by_role("link", name="Download PDF").count() == 1
        second = run.packet_done(run.packet()["id"])
        assert second["state"] == "Ready" and fresh in squeezed(pdf_text(run.pdf(second["id"])))
        kept = run.pdf(second["id"])
        ok(run.extra("404", 9), 201)
        await_ui(page, lambda: word_count(sheet, "Superseded") == 2, "extra train superseded the row")
    assert run.pdf(first["id"]) == original and run.pdf(second["id"]) == kept
    assert ok(operator.get(f"{run.S}/packets/{first['id']}"), 200)["state"] == "Superseded"


def seeded_session(api):
    workspace = next(w for w in ok(api.get("/api/workspaces"), 200)["workspaces"] if w["name"] == "Tarn Valley Model Railway Club")
    path = f"/api/workspaces/{workspace['id']}/sessions"
    listed = next(s for s in ok(api.get(path), 200)["sessions"] if "tarn-shakedown" in (s["id"], s["name"]))
    return f"{path}/{listed['id']}", listed["id"]


def test_packet_all_or_nothing(clubs):
    club = clubs()
    run = club.run()
    ready = run.packet_done(run.packet()["id"])
    row = Postgres().rows(f"select state, content_hash, length(pdf_bytes) as size from crew_packets where id = '{ready['id']}'")[0]
    assert (row["state"], row["content_hash"], int(row["size"])) == ("Ready", ready["content_hash"], ready["byte_length"])
    assert Postgres().rows(f"select seq from event_outbox where stream = '{run.stream}' and type = 'packet.changed'")

    down = clubs(os.environ["APP_GOTENBERG_DOWN_URL"])
    service_state(down.founder, "gotenberg", "down", TAKEOVER_S + SLACK_S)
    failing = down.run()
    failed = failing.packet_done(failing.packet()["id"])
    assert (failed["state"], failed["failure"]) == ("Failed", "gotenberg_unreachable")
    refused(down.founder.get(f"{failing.S}/packets/{failed['id']}/pdf"), 422, "packet_no_pdf", "This packet has no PDF.")
    store = Postgres("_gotenbergdown")
    assert store.rows(f"select state, pdf_bytes is null as empty from crew_packets where id = '{failed['id']}'") == [{"state": "Failed", "empty": True}]
    assert store.rows(f"select seq from event_outbox where stream = '{failing.stream}' and payload::text like '%Ready%'") == []

    base = os.environ["APP_VALKEY_DOWN_URL"]
    founder = Api(base, FOUNDER)
    service_state(founder, "valkey", "down", VALKEY_NOTICE_S + SLACK_S)
    path, _session_id = seeded_session(founder)
    version = ok(founder.get(path), 200)["session_version"]
    packet = ok(founder.post(f"{path}/packets", {"revision": version}), 202)["packet"]

    def finished():
        current = ok(founder.get(f"{path}/packets/{packet['id']}"), 200)
        return current if current["state"] in ("Ready", "Failed") else None
    ended = poll(finished, "packet ended on the Valkey outage instance", PACKET_S + SLACK_S)
    assert (ended["state"], ended["failure"]) == ("Failed", "valkey_unreachable")
    stored = Postgres("_valkeydown").rows(f"select pdf_bytes is null as empty from crew_packets where id = '{packet['id']}'")
    assert stored == [{"empty": True}]


def test_issue_replay_one_render(clubs):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    body = {"revision": run.snap()["session_version"]}
    key = idempotency_key()
    left, right = together(lambda: operator.post(f"{run.S}/packets", body, key=key, route="a"),
                           lambda: operator.post(f"{run.S}/packets", body, key=key, route="b"))
    assert left.status_code == right.status_code == 202 and left.json() == right.json()
    done = run.packet_done(left.json()["packet"]["id"])
    assert done["state"] == "Ready"
    rows = Postgres().rows(f"select id from crew_packets where session_id = '{run.id}'")
    assert rows == [{"id": done["id"]}]


def test_stream_delivery_and_replay(clubs, valkey):
    club = clubs()
    member = club.person("member")
    run = club.run()
    api = club.founder
    left, right = together(lambda: read_events(api, f"{run.S}/events", 4, route="a"), lambda: read_events(api, f"{run.S}/events", 4, route="b"))
    assert len(left) == 4 and len(right) == 4
    for events in (left, right):
        ids = [int(e["id"]) for e in events]
        assert ids == sorted(ids) and all(e["event"] == "tick.committed" and e["json"]["seq"] == int(e["id"]) for e in events)
    assert set(int(e["id"]) for e in left) & set(int(e["id"]) for e in right)
    event = left[0]
    entry = stream_entry(valkey, run.stream, int(event["id"]))
    assert entry["type"] == "tick.committed" and "payload" in entry
    tick = event["json"]["session"]["tick"]
    assert Postgres().rows(f"select revision from session_ticks where session_id = '{run.id}' and tick = {tick}") == [{"revision": int(event["id"])}]
    mark = int(left[0]["id"])
    replayed = read_events(api, f"{run.S}/events", 2, last_id=mark)
    assert [int(e["id"]) for e in replayed] == [mark + 1, mark + 2]
    by_query = read_events(api, f"{run.S}/events?last_event_id={mark}", 2)
    assert [int(e["id"]) for e in by_query] == [mark + 1, mark + 2]
    bench = club.module(member)
    start = club.lay()["revision"]
    answer = bench.grow(straight(TILE_STRAIGHT))
    events = read_events(api, f"{club.L}/events", 1, last_id=start, route="b")
    assert events[0]["event"] == "piece.added" and int(events[0]["id"]) == answer["layout_revision"]
    assert events[0]["json"]["layout"]["working_hash"] == answer["working_hash"]
    layout_stream = f"gandyboard:layout:{club.layout_id}:events"
    assert stream_entry(valkey, layout_stream, answer["layout_revision"])["type"] == "piece.added"


def test_replay_ages_out(clubs, valkey):
    club = clubs()
    member = club.person("member")
    bench = club.module(member)
    piece = bench.grow(straight(TILE_STRAIGHT))["piece"]
    start = club.lay()["revision"]
    revision = bench.revision
    for index in range(AGE_OUT_EDITS):
        revision = ok(member.patch(f"{bench.path}/pieces/{piece['id']}", {"revision": revision, "note": f"Edit {index}"}), 200)["module_revision"]
    stream = f"gandyboard:layout:{club.layout_id}:events"
    poll(lambda: STREAM_KEEP <= int(valkey.command("XLEN", stream)) <= STREAM_CEILING, "stream length stayed in the published band")
    events = read_events(member, f"{club.L}/events?last_event_id={start + 1}", 1)
    assert events and events[0]["event"] == "resync" and events[0]["json"] == {"reason": "replay_aged_out"}


def test_browser_event_order(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    run.at_tick(3)
    ok(run.control("hold"), 200)
    snapshot = run.snap()
    revision = snapshot["revision"]
    stash, reads = [], []
    early_clock = clock_label(6)

    def hold_stream(route):
        if stash:
            route.fallback()
        else:
            stash.append(route)

    def frame(seq):
        session = {**snapshot, "revision": seq, "tick": 1, "fast_clock_label": early_clock, "fast_clock_seconds": 6}
        data = {"seq": seq, "type": "tick.committed", "session": session, "detail": {"tick": 1}}
        return f"id: {seq}\nevent: tick.committed\ndata: {json.dumps(data)}\n\n"

    with open_app(browser, app_url) as page:
        page.route(f"**{run.S}/events*", hold_stream)
        enter(page, app_url, operator.email, club.operate(run))
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(revision) and len(stash) == 1, "snapshot applied")
        stage_of(page).evaluate("""el => { window.__revisions = [];
            new MutationObserver(() => window.__revisions.push(Number(el.getAttribute('data-scene-revision'))))
            .observe(el, {attributes: true, attributeFilter: ['data-scene-revision']}); }""")
        page.on("request", lambda r: reads.append(r.url) if urlparse(r.url).path == run.S else None)
        body = frame(revision - 1) + frame(revision) + frame(revision + 3)
        stash[0].fulfill(status=200, content_type="text/event-stream", body=body)
        await_ui(page, lambda: len(reads) >= 1, "a gap fetched GET S")
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(run.snap()["revision"]), "scene carried on from the snapshot")
        assert fast_clock(page) == snapshot["fast_clock_label"]
        assert all(value >= revision for value in page.evaluate("() => window.__revisions")), "the scene rewound"


def test_wf_service_outages_valkey_recovers(clubs, browser):
    base = os.environ["APP_VALKEY_DOWN_URL"]
    relay = valkey_relay()
    store = Postgres("_valkeydown")
    relay.start()
    try:
        founder = Api(base, FOUNDER)
        service_state(founder, "valkey", "up", VALKEY_RETURN_S + SLACK_S)
        club = clubs(base)
        run = club.run()
        run.at_tick(2)
        layout_stream = f"gandyboard:layout:{club.layout_id}:events"
        with open_app(browser, base) as page:
            enter(page, base, FOUNDER, club.operate(run))
            mark_no_reload(page)
            relay.stop()
            stopped = run.until(lambda s: s["status"] == "Held", "session held on the outage", VALKEY_NOTICE_S + SLACK_S)
            assert stopped["hold_reason"] == "valkey"
            banner = page.get_by_role("alert").filter(has_text=VALKEY_COPY)
            await_ui(page, lambda: banner.count() >= 1 and banner.first.is_visible(), "outage banner showed the copy")
            await_ui(page, lambda: session_status(page) == "Held", "status read Held")
            assert ok(founder.get("/api/status"), 200)["valkey"] == "down"
            refused(run.highball("101", 4), 503, "valkey_unavailable", VALKEY_COPY)
            refused(run.control("resume"), 503, "valkey_unavailable", VALKEY_COPY)
            refused(founder.get(f"{run.S}/events"), 503, "valkey_unavailable", VALKEY_COPY)
            refused(founder.get(f"{club.L}/events"), 503, "valkey_unavailable", VALKEY_COPY)
            club.module(founder)
            revision = club.lay()["revision"]
            waiting = store.rows(f"select published_at from event_outbox where stream = '{layout_stream}' and seq = {revision}")
            assert waiting == [{"published_at": None}]
            tick = run.snap()["tick"]
            relay.start()
            run.until(lambda s: s["status"] == "Running" and s["tick"] > tick, "session returned to Running", VALKEY_RETURN_S + SLACK_S)
            announced(page, "Live updates are back.")
            await_ui(page, lambda: session_status(page) == "Running", "screen read Running")
            assert_no_reload(page)
        ticks = stored_ticks(run, store)
        assert ticks == list(range(1, len(ticks) + 1))
        poll(lambda: store.rows(f"select published_at from event_outbox where stream = '{layout_stream}' and seq = {revision}")[0]["published_at"],
             "outbox event delivered after the return", VALKEY_RETURN_S + SLACK_S)
        ok(run.control("end"), 200)
    finally:
        relay.stop()


def same_tick(api, path, tick):
    assert ok(api.get(path), 200)["tick"] == tick


def test_valkey_down_at_boot(browser):
    base = os.environ["APP_VALKEY_DOWN_URL"]
    assert ok(httpx.get(f"{base}/api/health"), 200) == {"status": "ok"}
    founder = Api(base, FOUNDER)
    service_state(founder, "valkey", "down", VALKEY_NOTICE_S + SLACK_S)
    path, session_id = seeded_session(founder)

    def holding():
        snapshot = ok(founder.get(path), 200)
        return snapshot if snapshot["status"] == "Held" else None
    snapshot = poll(holding, "seeded session read Held", VALKEY_NOTICE_S + SLACK_S)
    assert snapshot["hold_reason"] == "valkey"
    refused(founder.post(f"{path}/resume", {"revision": snapshot["control_revision"]}), 503, "valkey_unavailable", VALKEY_COPY)
    steady(lambda: same_tick(founder, path, snapshot["tick"]), VALKEY_NOTICE_S)
    workspace = path.split("/")[3]
    lay = ok(founder.get(f"/api/workspaces/{workspace}/layouts"), 200)["layouts"][0]
    with open_app(browser, base) as page:
        enter(page, base, FOUNDER, {"workspace": workspace, "layout": lay["id"], "session": session_id, "mode": "operate"})
        banner = page.get_by_role("alert").filter(has_text=VALKEY_COPY)
        await_ui(page, lambda: banner.count() >= 1 and banner.first.is_visible(), "banner showed the published copy")


def test_wf_service_outages_gotenberg_recovers(clubs, browser):
    base = os.environ["APP_GOTENBERG_DOWN_URL"]
    assert ok(httpx.get(f"{base}/api/health"), 200) == {"status": "ok"}
    club = clubs(base)
    operator = club.person("operator")
    run = club.run(api=operator)
    service_state(operator, "gotenberg", "down", TAKEOVER_S + SLACK_S)
    with open_app(browser, base) as page:
        enter(page, base, operator.email, club.operate(run))
        sheet = bar_sheet(page, "Crew packets")
        await_ui(page, lambda: GOTENBERG_NOTICE in sheet.inner_text(), "sheet showed the notice")
        click(sheet.get_by_role("button", name="Issue packet"))
        announced(page, GOTENBERG_FAILED)
        failed = ok(operator.get(f"{run.S}/packets"), 200)["packets"][0]
        assert (failed["state"], failed["failure"]) == ("Failed", "gotenberg_unreachable")
        await_ui(page, lambda: word_count(sheet, "Failed") >= 1, "row read Failed")
        assert sheet.get_by_role("link", name="Download PDF").count() == 0
        stub = StubPdfService()
        try:
            service_state(operator, "gotenberg", "up", TAKEOVER_S + SLACK_S)
            click(sheet.get_by_role("button", name="Issue packet"))
            announced(page, "Crew packet ready.")
            packets = ok(operator.get(f"{run.S}/packets"), 200)["packets"]
            fresh = next(p for p in packets if p["id"] != failed["id"])
            assert fresh["state"] == "Ready" and run.pdf(fresh["id"]) == TINY_PDF
        finally:
            stub.stop()
    assert ok(operator.get(f"{run.S}/packets/{failed['id']}"), 200)["state"] == "Failed"
    assert ok(operator.get("/api/health"), 200) == {"status": "ok"}


def test_error_order(clubs, app_url):
    club = clubs()
    member, operator = club.person("member"), club.person("operator")
    stranger = clubs().person("manager")
    anon = Api(app_url)
    bench = club.module(member)
    missing = f"{club.W}/sessions/{UNKNOWN_SESSION}"
    refused(anon.get("/api/me"), 401, "session_required", EXPIRED_COPY)
    refused(anon.post(f"{club.W}/layouts", {}, key=None), 401, "session_required", EXPIRED_COPY)
    refused(stranger.get(club.W), 403, "forbidden", FORBIDDEN_COPY)
    refused(stranger.get(f"/api/workspaces/{UNKNOWN_WORKSPACE}"), 403, "forbidden", FORBIDDEN_COPY)
    refused(member.post(f"{missing}/start", {}, key=None), 403, "forbidden", FORBIDDEN_COPY)
    refused(operator.post(f"{missing}/start", {}, key=None), 404, "not_found", NOT_FOUND_COPY)
    refused(member.post(f"{bench.path}/pieces", {"revision": 0}, key=None), 422, "idempotency_key_required", "This request needs a key.")
    stale = bench.append(curve(MIN_RADIUS - 1), revision=bench.revision + 5)
    refused(stale, 409, "stale_revision", STALE_COPY)
    key = idempotency_key()
    bench.append(curve(MIN_RADIUS - 1), key=key)
    refused(bench.append(curve(MIN_RADIUS - 2), key=key, revision=bench.revision + 5), 422, "idempotency_key_reused", REUSED_COPY)
    fields = club.founder.post(f"{club.W}/layouts", {"name": ""})
    assert fields.status_code == 422
    base = os.environ["APP_VALKEY_DOWN_URL"]
    founder = Api(base, FOUNDER)
    service_state(founder, "valkey", "down", VALKEY_NOTICE_S + SLACK_S)
    path, _session = seeded_session(founder)
    snapshot = ok(founder.get(path), 200)
    train = Run.train(snapshot, "101")
    road = f"{path}/trains/{train['id']}/authorities"
    behind = Run.block(snapshot, 2)["id"]
    refused(founder.post(road, {"revision": train["revision"] + 5, "destination_block_id": behind}), 409, "stale_revision", STALE_COPY)
    refused(founder.post(road, {"revision": train["revision"], "destination_block_id": behind}), 503, "valkey_unavailable", VALKEY_COPY)


def routed_down(app_url, name):
    resp = httpx.get(f"{app_url}/api/health", headers={ROUTE_HEADER: name})
    return resp if resp.status_code == 503 else None


def test_platform_boundary(clubs, app_url):
    club = clubs()
    founder = club.founder
    seen = []
    for _ in range(6):
        resp = httpx.get(f"{app_url}/api/health")
        assert ok(resp, 200) == {"status": "ok"}
        seen.append(resp.headers[INSTANCE_HEADER])
    assert {"a", "b"} <= set(seen)
    for name in ("a", "b"):
        assert httpx.get(f"{app_url}/api/health", headers={ROUTE_HEADER: name}).headers[INSTANCE_HEADER] == name
    assert ok(founder.get("/api/status", route="b"), 200)["instance"] == "b"

    def padded(size):
        return b'{"pad":"' + b"x" * (size - 10) + b'"}'

    json_type = {"Content-Type": "application/json"}
    assert len(padded(BODY_LIMIT)) == BODY_LIMIT
    ok(founder.http.post(f"{club.L}/check", content=padded(BODY_LIMIT), headers=json_type), 200)
    refused(founder.http.post(f"{club.L}/check", content=padded(BODY_LIMIT + 1), headers=json_type), 413, "body_too_large", "That request is too large.")
    refused(httpx.post(f"{app_url}/api/auth/sign-in", content=b"{not json", headers=json_type), 400, "bad_json", "That request could not be read.")
    refused(httpx.post(f"{app_url}{club.W}/layouts", content=b"name", headers={"Content-Type": "text/plain"}), 415, "bad_content_type", "Send JSON.")
    for path in SOURCE_PATHS:
        text = httpx.get(f"{app_url}{path}").text
        assert "run-manifest-v1" not in text and "DATABASE_URL" not in text
    target = "a"
    stop_path = f"/api/ops/instances/{target}/stop"
    too_long = founder.post(stop_path, {"restart_after_ms": TOO_LONG_RESTART_MS}, key=None, route="b")
    assert too_long.status_code == 422
    ok(founder.post(stop_path, {"restart_after_ms": SHORT_DOWN_MS}, key=None, route="b"), 202)
    gone = poll(lambda: routed_down(app_url, target), "routing to a stopped instance answered 503")
    refused(gone, 503, "instances_restarting", "Gandyboard is restarting. Try again in a moment.")
    assert httpx.get(f"{app_url}/api/health").headers[INSTANCE_HEADER] == "b"
    instances_up(founder)


def test_loading_screen(clubs, browser, app_url):
    club = clubs()
    with open_app(browser, app_url) as page:
        answer = page.context.request.post(f"{app_url}/api/auth/sign-in", data={"email": FOUNDER, "password": PASSWORD})
        assert answer.status == 200
        page.set_viewport_size(DESKTOP)
        with held(page, "**/api/workspaces/*/layouts/*") as release:
            page.goto(f"{app_url}/?{urlencode(club.build())}")
            wordmark = page.get_by_role("img", name="Gandyboard")
            pill = page.get_by_role("progressbar", name="Loading layout")
            await_ui(page, lambda: wordmark.is_visible() and pill.is_visible(), "loading screen showed")
            early = float(pill.get_attribute("aria-valuenow"))
            advance(page, QUIET_MS * 4)
            waiting = float(pill.get_attribute("aria-valuenow"))
            assert 0 <= early <= waiting < 100, "the pill reports real progress while the snapshot is held"
            mark, bar = box(wordmark), box(pill)
            assert near(mark["width"], WORDMARK_WIDTH) and near(bar["width"], PILL_WIDTH) and near(bar["height"], PILL_HEIGHT)
            assert near(bar["y"] - (mark["y"] + mark["height"]), PILL_GAP)
            assert abs(mark["x"] + mark["width"] / 2 - DESKTOP["width"] / 2) <= WORDMARK_WIDTH * SIZE_TOLERANCE
            release()
        wait_stage(page)
        assert stage_of(page).is_visible()
        await_ui(page, lambda: wordmark.count() == 0 or not wordmark.is_visible() or float(wordmark.evaluate("el => getComputedStyle(el).opacity")) == 0, "splash faded")


def test_wf_cross_cutting_first_run(clubs, browser, app_url):
    club = clubs()
    person = club.person("member", walked=False)
    assert ok(person.get("/api/me"), 200)["user"]["walkthrough_done"] is False
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        cdp_session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": False})
        posts = []
        page.on("request", lambda r: posts.append(r.url) if r.url.endswith("/api/me/walkthrough") else None)
        enter(page, app_url, person.email, club.build())
        card = page.get_by_role("dialog", name="First layout walkthrough")
        await_ui(page, card.is_visible, "walkthrough opened")
        rect = box(card)
        assert near(rect["width"], CARD_WIDTH) and near(rect["height"], CARD_HEIGHT)
        art = page.get_by_role("img", name="Mouse and keyboard illustration")
        assert art.count() == 1 and art.get_attribute("data-input") == "pointer"
        last_dots = None
        for index, (title, line) in enumerate(WALKTHROUGH_STEPS, start=1):
            await_ui(page, lambda t=title: card.get_by_role("heading", name=t).count() == 1, f"step {index} title")
            assert line in card.inner_text()
            dots = card.get_by_role("group", name=f"Step {index} of 5")
            assert dots.count() == 1
            assert dots.get_by_role("button").count() == 0, "walkthrough step dots are not clickable"
            picture = decode(capture(dots))
            if last_dots is not None:
                assert difference(last_dots, picture) > 0, "the active walkthrough step dot moved"
            last_dots = picture
            if index < 5:
                click(card.get_by_role("button", name="Next"))
                advance(page, SHEET_MS + UI_STEP_MS)
        assert posts == []
        page.keyboard.press("Tab")
        assert card.evaluate("el => el.contains(document.activeElement)"), "focus stays in the card"
        dimmed = decode(capture(stage_of(page)))
        click(card.get_by_role("button", name="Start building"))
        await_ui(page, lambda: card.count() == 0 or not card.is_visible(), "card closed")
        advance(page, SHEET_MS * 2)
        changed(dimmed, decode(capture(stage_of(page))))
        assert len(posts) == 1
        assert ok(person.get("/api/me"), 200)["user"]["walkthrough_done"] is True
        page.reload()
        wait_stage(page)
        advance(page, SHEET_MS)
        assert card.count() == 0


def test_walkthrough_touch_art_and_skip(clubs, browser, app_url):
    club = clubs()
    person = club.person("member", walked=False)
    with open_app(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        cdp_session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        posts = []
        page.on("request", lambda r: posts.append(r.url) if r.url.endswith("/api/me/walkthrough") else None)
        enter(page, app_url, person.email, club.build())
        card = page.get_by_role("dialog", name="First layout walkthrough")
        await_ui(page, card.is_visible, "walkthrough opened")
        art = page.get_by_role("img", name="Touch gestures illustration")
        assert art.count() == 1 and art.get_attribute("data-input") == "touch"
        rect = box(card)
        assert rect["x"] >= 10 and rect["x"] + rect["width"] <= PHONE["width"] - 10
        tap(card.get_by_role("button", name="Next"))
        advance(page, SHEET_MS)
        tap(card.get_by_role("button", name="Skip"))
        await_ui(page, lambda: len(posts) == 1, "Skip stored the finish")
    assert ok(person.get("/api/me"), 200)["user"]["walkthrough_done"] is True


def test_stage_keyboard(clubs, browser, app_url):
    club = clubs()
    manager = club.person("manager")
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        enter(page, app_url, manager.email, club.build())
        stage = stage_of(page)
        for key, name in (("ArrowRight", "data-scene-pan"), ("+", "data-scene-zoom"), ("-", "data-scene-zoom")):
            ready(stage).focus()
            before = attr(page, name)
            page.keyboard.press(key)
            await_ui(page, lambda n=name, b=before: attr(page, n) != b, f"{key} changed {name}")
        start = float(attr(page, "data-scene-heading"))
        ready(stage).focus()
        page.keyboard.press("e")
        await_ui(page, lambda: float(attr(page, "data-scene-heading")) % 360 == (start + 45) % 360, "E rotated 45 degrees")
        page.keyboard.press("q")
        await_ui(page, lambda: float(attr(page, "data-scene-heading")) % 360 == start % 360, "Q rotated back")
        ready(stage).focus()
        page.keyboard.press("Tab")
        items = page.get_by_role("listbox", name="Stage items")
        assert items.evaluate("el => el.contains(document.activeElement)")
        first = page.evaluate("() => document.activeElement.textContent")
        page.keyboard.press("ArrowDown")
        advance(page, UI_STEP_MS)
        assert page.evaluate("() => document.activeElement.textContent") != first
        piece = club.lay()["content"]["modules"][0]["pieces"][0]
        stage_item(page, f"Piece {piece['id']}")
        await_ui(page, page.get_by_role("dialog", name="Piece inspector").is_visible, "Enter opened the inspector")
        page.keyboard.press("Escape")
        advance(page, SHEET_MS)
        stage.focus()
        names = tab_order(page, 30)
        dial = names.index("Rotate heading")
        switch = names.index("Operate mode", dial)
        assert "Sheets" in names[switch:], names
        assert "Straight 12 in" in names[:dial], names
        sheets = page.get_by_role("button", name="Sheets")
        ready(sheets).focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="Sheets")
        await_ui(page, menu.is_visible, "menu opened from the keyboard")
        page.keyboard.press("Escape")
        await_ui(page, lambda: sheets.evaluate("el => document.activeElement === el"), "Escape returned focus")
        rest, focused = state_styles(sheets, "outline-width", "outline-style", "box-shadow", state="focus")
        assert rest != focused
        axe(page)


def test_stage_chrome_components(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        lipped = page.get_by_role("button", name="Sign in")
        await_ui(page, lipped.is_visible, "sign-in sheet showed")
        rest = box(lipped)
        page.mouse.move(rest["x"] + rest["width"] / 2, rest["y"] + rest["height"] / 2)
        page.mouse.down()
        poll(lambda: abs(box(lipped)["y"] - rest["y"] - PRESS_PX) <= 1, "lipped command button compressed by 4 pixels", VALKEY_NOTICE_S)
        page.mouse.move(0, 0)
        page.mouse.up()
        enter(page, app_url, FOUNDER, club.build())
        rail = page.get_by_role("toolbar", name="Track pieces")
        for name in TILE_NAMES:
            rect = box(rail.get_by_role("button", name=name, exact=True))
            assert rect["width"] >= TOUCH_TARGET and rect["height"] >= TOUCH_TARGET
        strip = box(rail)
        assert abs(strip["x"] + strip["width"] / 2 - DESKTOP["width"] / 2) <= DESKTOP["width"] * SIZE_TOLERANCE
        assert strip["y"] > DESKTOP["height"] / 2
        highball = page.get_by_role("button", name="Highball")
        assert highball.count() == 0 or not highball.is_visible()
        bar = page.get_by_role("navigation", name="Session bar")
        order = [box(bar.get_by_role("button", name=n))["x"] for n in ("Sheets", "Reset view", "Sessions", "Crew packets")]
        assert order == sorted(order) and box(bar)["y"] < DESKTOP["height"] / 4
        assert bar.evaluate("el => { const c = getComputedStyle(el).backgroundColor; return c === 'transparent' || /, 0\\)$/.test(c); }"), "the bar has no background"
        page.goto(f"{app_url}/?{urlencode(club.operate(run))}")
        wait_stage(page)
        for name in ("Highball", "Recall"):
            rect = box(page.get_by_role("button", name=name, exact=True))
            assert near(rect["width"], ROUND_BUTTON) and abs(rect["width"] - rect["height"]) <= 2
            assert rect["x"] < DESKTOP["width"] / 2 and rect["y"] > DESKTOP["height"] / 2
        rail = page.get_by_role("toolbar", name="Track pieces")
        assert rail.count() == 0 or not rail.is_visible()
        dial = page.get_by_role("button", name="Rotate heading")
        start = float(attr(page, "data-scene-heading"))
        click(dial)
        await_ui(page, lambda: float(attr(page, "data-scene-heading")) % 360 == (start + 45) % 360, "heading dial turned 45 degrees")
        click(page.get_by_role("button", name="Reset view"))
        await_ui(page, lambda: float(attr(page, "data-scene-heading")) % 360 == 0, "Reset view returned to heading 0")
        switch = page.get_by_role("switch", name="Operate mode")
        rect = box(switch)
        assert page.get_by_role("switch", name="Operate mode", checked=True).count() == 1 and near(rect["width"], SWITCH_WIDTH)
        assert rect["x"] > DESKTOP["width"] / 2 and rect["y"] > DESKTOP["height"] / 2
        click(switch)
        await_ui(page, lambda: attr(page, "data-scene-mode") == "build", "switch moved to Build")
        assert page.get_by_role("switch", name="Operate mode", checked=False).count() == 1


def touch_path(cdp, starts, ends, steps=6):
    def points(fraction):
        return [{"x": a[0] + (b[0] - a[0]) * fraction, "y": a[1] + (b[1] - a[1]) * fraction, "id": i}
                for i, (a, b) in enumerate(zip(starts, ends))]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": points(0)})
    for step in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": points(step / steps)})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_phone_touch_layout(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    with open_app(browser, app_url) as page:
        page.set_viewport_size(PHONE)
        cdp = cdp_session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        enter(page, app_url, operator.email, club.operate(run))
        pan = attr(page, "data-scene-pan")
        touch_path(cdp, [(180, 380)], [(240, 440)])
        await_ui(page, lambda: attr(page, "data-scene-pan") != pan, "one finger panned")
        zoom = attr(page, "data-scene-zoom")
        touch_path(cdp, [(170, 400), (205, 400)], [(110, 400), (265, 400)])
        await_ui(page, lambda: attr(page, "data-scene-zoom") != zoom, "pinch zoomed")
        heading = attr(page, "data-scene-heading")
        touch_path(cdp, [(130, 400), (250, 400)], [(190, 340), (190, 460)])
        await_ui(page, lambda: attr(page, "data-scene-heading") != heading, "two fingers rotated")
        buttons = page.get_by_role("button")
        for index in range(buttons.count()):
            button = buttons.nth(index)
            if button.is_visible():
                rect = box(button)
                assert rect["width"] >= TOUCH_TARGET and rect["height"] >= TOUCH_TARGET, button.inner_text()
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            advance(page, UI_STEP_MS)
            no_overflow(page)


def test_highball_ribbon_motion(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    route = [str(n) for n in ROAD_TO_NINE]
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        pick_train(page, "101")
        pick_destination(page, 9, "Single Line East")
        base = attr(page, "data-scene-revision")
        press_highball(page)
        poll(lambda: run.snap()["authorities"], "the grant committed")
        for _ in range(UI_WAIT_S * 20):
            if attr(page, "data-scene-revision") != base:
                break
            advance(page, 10)
        seen, in_step, interrupted = [], True, False
        for _ in range(len(route) * RIBBON_BLOCK_MS // 30 * 3):
            advance(page, 30)
            value = attr(page, "data-ribbon-blocks")
            if not seen or seen[-1] != value:
                seen.append(value)
                count = len([v for v in value.split(",") if v])
                in_step = in_step and figure(page, "Reserved") == count
            if not interrupted and len(value.split(",")) >= 3:
                ok(run.service(12, True), 200)
                interrupted = True
        grown = [v.split(",") for v in seen if v]
        assert all(g == route[:len(g)] for g in grown), seen
        assert [len(g) for g in grown] == sorted(len(g) for g in grown), f"the ribbon rewound: {seen}"
        assert len(grown) >= 3 and grown[-1] == route and interrupted, seen
        assert in_step, "reserved counter moved in the same step as the ribbon"
        await_ui(page, lambda: attr(page, "data-limit-flag-block") == "9", "limit flag at the last block")
        pick_train(page, "303")
        pick_destination(page, 4, "Single Line West")
        press_highball(page)
        sheet = sheet_of(page, "Conflict")
        await_ui(page, lambda: sheet.is_visible() and "101" in sheet.inner_text(), "Conflict sheet opened naming the other train")
        await_ui(page, lambda: attr(page, "data-ribbon-blocks") == ribbon(*ROAD_TO_NINE), "refused ribbon retracted, the granted one stays")


def test_reduced_motion(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    whole = ribbon(*ROAD_TO_NINE)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        enter(page, app_url, operator.email, club.operate(run))
        frames = scene_frames(stage_of(page), steps=4, step_ms=TICK_MS)
        assert frames[0]["draws"] > 0
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) < 0.01, "the idle scene holds still"
        start = float(attr(page, "data-scene-heading"))
        click(page.get_by_role("button", name="Rotate heading"))
        advance(page, 20)
        assert float(attr(page, "data-scene-heading")) % 360 == (start + 45) % 360
        assert attr(page, "data-scene-animating") == "false"
        pick_train(page, "101")
        pick_destination(page, 9, "Single Line East")
        base = attr(page, "data-scene-revision")
        press_highball(page)
        seen = set()
        for _ in range(UI_WAIT_S * 5):
            advance(page, 20)
            seen.add(attr(page, "data-ribbon-blocks"))
            if attr(page, "data-scene-revision") != base:
                break
        advance(page, 20)
        assert attr(page, "data-ribbon-blocks") == whole and figure(page, "Reserved") == len(ROAD_TO_NINE)
        assert attr(page, "data-limit-flag-block") == "9"
        assert seen <= {"", whole}, f"partial ribbon under reduced motion: {seen}"
        click(page.get_by_role("navigation", name="Session bar").get_by_role("button", name="Sessions"))
        advance(page, 20)
        sheet = sheet_of(page, "Sessions")
        assert sheet.is_visible() and animations(sheet) == []


def test_webgl_loss_and_fallback(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run))
        stage_of(page).evaluate("""el => { const view = el.getElementsByTagName('canvas')[0];
            const gl = view.getContext('webgl2') || view.getContext('webgl');
            window.__lost = gl.getExtension('WEBGL_lose_context'); window.__lost.loseContext(); }""")
        await_ui(page, lambda: attr(page, "data-scene-mode") == "paused" and on_screen(page, PAUSED_COPY) is not None, "paused copy showed")
        tick = tick_of(page)
        await_ui(page, lambda: tick_of(page) > tick, "ticks kept landing")
        assert session_status(page) == "Running"
        pick_train(page, "101")
        pick_destination(page, 4, "Single Line West")
        press_highball(page)
        announced(page, "Train 101 has the road to Single Line West, 2 blocks.")
        page.evaluate("() => window.__lost.restoreContext()")
        await_ui(page, lambda: attr(page, "data-scene-mode") == "operate", "view rebuilt")
        await_ui(page, lambda: abs(tick_of(page) - run.snap()["tick"]) <= 2, "rebuilt at the newest state")
    second = club.run(api=operator)
    ok(second.control("hold"), 200)
    with open_app(browser, app_url, no_webgl=True) as page:
        enter(page, app_url, operator.email, club.operate(second))
        stage = stage_of(page)
        assert stage.evaluate("el => el.getElementsByTagName('svg').length > 0 && el.getElementsByTagName('canvas').length === 0")
        assert attr(page, "data-scene-tick") == str(second.snap()["tick"])
        ready(stage).focus()
        page.keyboard.press("Tab")
        items = page.get_by_role("listbox", name="Stage items")
        assert items.evaluate("el => el.contains(document.activeElement)")
        for name in ("Block 4 Single Line West", "Train 101"):
            assert items.get_by_role("option", name=name).count() == 1
        stage_item(page, "Train 101")
        pick_destination(page, 4, "Single Line West")
        ready(page.get_by_role("button", name="Highball")).focus()
        page.keyboard.press("Enter")
        announced(page, "Train 101 has the road to Single Line West, 2 blocks.")
        await_ui(page, lambda: attr(page, "data-scene-revision") == str(second.snap()["revision"]), "attributes stay current")
    assert second.snap()["counters"]["reserved_blocks"] == 2


def test_wf_cross_cutting_view_url(clubs, browser, app_url):
    club = clubs()
    operator = club.person("operator")
    run = club.run(api=operator)
    ok(run.control("hold"), 200)
    with open_app(browser, app_url) as page:
        enter(page, app_url, operator.email, club.operate(run, version=club.version_id))
        pick_train(page, "101")
        click(page.get_by_role("button", name="Rotate heading"))
        await_ui(page, lambda: query_of(page).get("heading") == ["45"], "heading in the URL")
        open_sheet(page, "Versions")
        query = query_of(page)
        assert query["sheet"] == ["versions"] and query["train"] and query["session"] == [run.id]
        assert query["workspace"] == [club.id] and query["layout"] == [club.layout_id] and query["mode"] == ["operate"]
        assert query["version"] == [club.version_id]
        page.reload()
        wait_stage(page)
        await_ui(page, sheet_of(page, "Versions").is_visible, "sheet restored")
        assert float(attr(page, "data-scene-heading")) % 360 == 45
        assert attr(page, "data-scene-mode") == "operate"
        assert train_option(page, "101", selected=True).count() == 1
        assert query_of(page) == query


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[field], str) and manifest[field] for field in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == []
    assert "Fredoka" in notices and "Karla" in notices and "OFL-1.1" in notices


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert bad == []


def test_if_only_datastores():
    banned = "SQLite".lower()
    assert [p.name for p in shipped_packages() if banned in p.name.lower()] == []
    stray = [str(f) for f in Path(DEPLOYED_APP).rglob(f"*.{banned}*") if "node_modules" not in f.parts]
    assert stray == []
    tables = Postgres().tables()
    for table in ("session_ticks", "event_outbox", "crew_packets", "layout_versions"):
        assert any(t.split(".")[-1] == table for t in tables)


def test_if_same_origin_assets(clubs, browser, app_url):
    club = clubs()
    with open_app(browser, app_url) as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        enter(page, app_url, FOUNDER, club.build())
        foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
        assert urls and foreign == []


def test_if_no_secrets_exposed(clubs, app_url):
    secrets = [os.environ[n] for n in ("DATABASE_URL", "VALKEY_URL", "GOTENBERG_URL") if os.environ.get(n)]
    club = clubs()
    page = httpx.get(f"{app_url}/").text
    bodies = [page, club.founder.get("/api/status").text, club.founder.get(club.W).text]
    bodies += [httpx.get(urljoin(f"{app_url}/", src)).text for src in re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', page)]
    for secret in secrets:
        assert all(secret not in body for body in bodies)
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        for item in root.rglob("*"):
            if item.is_file() and "node_modules" not in item.parts and ".git" not in item.parts:
                text = item.read_text(errors="ignore")
                assert all(secret not in text for secret in secrets), str(item)


def test_if_original_artwork(clubs, browser, app_url):
    club = clubs()
    with open_app(browser, app_url) as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        page.goto(f"{app_url}/")
        await_ui(page, page.get_by_role("textbox", name="Email").is_visible, "app loaded")
        enter(page, app_url, FOUNDER, club.build())
        frames = scene_frames(stage_of(page), steps=2, step_ms=SHEET_MS)
        assert frames[-1]["draws"] > 0 and frames[-1]["uploaded"] > 0
        assert not frames[-1]["models"]
        assert [u for u in urls if re.search(r"\.(glb|gltf|fbx|obj)(\?|$)", u)] == []
