from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import string
import struct
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    camera,
    capture,
    changed,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    scene_frames,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    until,
)


APP_DIR = Path("/app")
TOKEN = os.environ.get("GRADING_TOKEN") or "qy-grading-local"
OUTAGE_URL = os.environ.get("APP_MINIO_DOWN_URL", "")
JOIN_RATE_LIMIT = int(os.environ.get("QY_JOIN_RATE_LIMIT") or 5)
CHICAGO = "America/Chicago"
ZONE = ZoneInfo(CHICAGO)
LOCAL_FMT = "%Y-%m-%dT%H:%M"
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_RE = re.compile(f"[{ALPHABET}]{{6}}")
COUNTDOWN_RE = re.compile(r"Hand-in in \d+d \d+h \d+m")
MINUS = "\u2212"

HTTP_TIMEOUT = 30.0
UI_MS = 15000
UI_S = 15
MAIL_WAIT_S = 30
STREAM_READ_S = 20.0
STREAM_WATCH_S = 60
STREAM_REOPENS = 20
CLOSE_WAIT_S = 10
JOIN_CLEAR_S = 62
DST_SEARCH_DAYS = 400
PX_TOL = 1.5
OPAQUE = 0.99
MATRIX_TOL = 0.01
FLOAT32_REL = 1e-5

LIVE_MS = 2000
JOIN_DAYS = 14
HANDIN_DAYS = 70
RATE_WINDOW_S = 60
RESEND_WINDOW_S = 60
ROOM_MAX = 40
NICK_MIN = 2
NICK_MAX = 24
NAME_MAX = 60
JSON_MAX = 1_000_000
PROJECT_MAX = 2_000_000
SHAPE_MM = 20.0
OBJECT_MAX = 200
PLUG_H = 10.0
REST_Z = 10.0
GEAR_MM = 40.0
GEAR_HOLE_MM = 16.0
GEAR_VOLUME = 27979
EXAMPLE_GROUP_VOLUME = 6429
INCH_MM = 25.4
ROT_STEP = 15
CAMERA_AZIMUTH = 45
CAMERA_DISTANCE = 200.0
ZOOM_MIN = 20.0
ZOOM_MAX = 2000.0
VOLTS = 9
LED_DROP = 2.0
LED_OHMS = 25
LED_MAX_MA = 20.0
NIGHT_OHMS = 330
DEFAULT_OHMS = 1000
STEP_LIMIT = 500
REPEAT_MAX = 50
GLANCET_W = 360
GLANCET_H = 203
GLANCET_EDGE = 24
GLANCET_PHONE_H = 216
EXPANDED_SHARE = 0.8
EXPANDED_TOP = 109
TURN_MS = 12000
MIN_TARGET = 44
NARROW = {"width": 375, "height": 812}
MEDIUM = {"width": 768, "height": 1024}
WIDE = {"width": 1280, "height": 800}
VIEWPORT_IDS = ["narrow", "medium", "wide"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib", "BlueOak-1.0.0", "CC0-1.0"}

BAD_CODE = "Q0Q0Q0"
FOREIGN_ORIGIN = "http://evil.example"
ORBIT_PX = 60
WHEEL_PX = 240
PINCH_PX = 60
AWAY_MM = 50
GLANCET_ROSTER = 16
TETRA_FILE = "tetra-part.stl"
CORS_HEADER = "access-control-allow-origin"
GEAR_OBJ = "gear-box.stl".replace(".stl", ".obj")
WRONG_CLOCK_DAYS = 9
TETRA_MM = 10.0
COLOR = "#2f6fed"

expect.set_options(timeout=UI_MS)

STATE_JS = """id => {
  const el = document.getElementById(id);
  if (!el) return null;
  const data = n => Object.fromEntries(n.getAttributeNames().filter(a => a.startsWith('data-')).map(a => [a.slice(5), n.getAttribute(a)]));
  return Object.assign(data(el), {items: Array.from(el.children).map(data)});
}"""
CONTAINS_FOCUS = "el => el.contains(document.activeElement)"
OPACITY_JS = "el => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }"
PLAYING_JS = "el => [el, ...el.querySelectorAll('[data-playing]')].filter(n => n.hasAttribute('data-playing')).map(n => n.getAttribute('data-playing'))"
LOOPS_JS = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length"


def pick_radio(radio: Locator) -> None:
    radio.focus()
    radio.page.keyboard.press("Space")
    expect(radio).to_be_checked()


def shape(oid: str, kind: str = "box", x: float = 0.0, y: float = 0.0, z: float = REST_Z, w: float = SHAPE_MM,
          d: float = SHAPE_MM, h: float = SHAPE_MM, mode: str = "solid", children: list | None = None) -> dict:
    return {"id": oid, "kind": kind, "mode": mode, "x": x, "y": y, "z": z, "w": w, "d": d, "h": h,
            "rotationZ": 0, "color": COLOR, "children": children or []}


def design(objects: list, origin: tuple = (0, 0, 0), normal: tuple = (0, 0, 1)) -> dict:
    return {"kind": "3d", "objects": objects, "workplane": {"origin": list(origin), "normal": list(normal)}}


EMPTY = design([])
ONE = design([shape("a")])
TWO = design([shape("a"), shape("b", x=SHAPE_MM * 2)])
GEAR = design([shape("gear", "group", w=GEAR_MM, d=GEAR_MM, children=[
    shape("gear-box", w=GEAR_MM, d=GEAR_MM),
    shape("gear-hole", "cylinder", w=GEAR_HOLE_MM, d=GEAR_HOLE_MM, mode="hole")])])

BATTERY = {"label": "BAT-1", "type": "battery", "volts": VOLTS}
LED = {"label": "LED-1", "type": "led", "broken": False}
SWITCH_OPEN = {"label": "SW-1", "type": "switch", "closed": False}


def resistor(ohms: float) -> dict:
    return {"label": "R-1", "type": "resistor", "ohms": ohms}


def circuit(components: list, wires: list) -> dict:
    return {"kind": "circuit", "components": components, "wires": [{"from": a, "to": b} for a, b in wires]}


NIGHT = circuit([BATTERY, resistor(NIGHT_OHMS), LED], [("BAT-1+", "R-1+"), ("R-1-", "LED-1+"), ("LED-1-", "BAT-1-")])


def tower_snapshot() -> dict:
    step = 10
    return {"kind": "blocks",
            "program": [{"block": "repeat", "count": 3, "body": [{"block": "addSphere"}, {"block": "moveZ", "mm": step}]}],
            "objects": [shape(f"s{i}", "sphere", z=float(i * step)) for i in range(3)]}


def led_ma(ohms: float) -> float:
    return (VOLTS - LED_DROP) / (ohms + LED_OHMS) * 1000


def brightness(ohms: float) -> str:
    return f"{min(1.0, led_ma(ohms) / LED_MAX_MA):.2f}"


def tag() -> str:
    return uuid.uuid4().hex[:8]


def api(base: str, cookies: httpx.Cookies | None = None) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies=cookies)


def grading_headers() -> dict[str, str]:
    return {"X-Grading-Token": TOKEN}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def local(dt: datetime) -> str:
    return dt.astimezone(ZONE).strftime(LOCAL_FMT)


def minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


def set_clock(base: str, instant: datetime | None) -> datetime:
    r = httpx.post(f"{base}/api/grading/clock", json={"now": iso(instant) if instant else None},
                   headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/clock: {r.status_code} {r.text}"
    return parse_instant(r.json()["now"])


def server_now(base: str) -> datetime:
    return set_clock(base, None)


@contextmanager
def grading_clock(base: str) -> Iterator[None]:
    try:
        yield
    finally:
        set_clock(base, None)


def assert_error(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path}: expected {status} {code}, got {r.status_code} {r.text[:300]}")
    body = r.json()
    assert body.get("error") == code, body
    if message is not None:
        assert body.get("message") == message, body
    return body


def field_copy(r: httpx.Response) -> list[str]:
    assert r.status_code == 422, f"expected 422 validation, got {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("error") == "validation", body
    return list((body.get("fields") or {}).values())


_CONFIG: dict[str, dict] = {}


def config(base: str) -> dict:
    if base not in _CONFIG:
        r = httpx.get(f"{base}/api/config", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        _CONFIG[base] = r.json()
    return _CONFIG[base]


@dataclass
class Person:
    client: httpx.Client
    account: dict
    email: str
    password: str
    name: str

    @property
    def id(self) -> str:
        return self.account["id"]


def sign_up(base: str, kind: str = "educator") -> Person:
    t = tag()
    email = f"{kind}-{t}@hollowbrook.test"
    password = f"maple-kiln-{t}"
    name = f"Maker {t}"
    c = api(base)
    r = c.post("/api/auth/signup", json={"email": email, "password": password, "displayName": name, "accountType": kind})
    assert r.status_code == 201, f"POST /api/auth/signup: {r.status_code} {r.text}"
    return Person(c, r.json()["account"], email, password, name)


def mails_for(mail: Mailpit, email: str, count: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit holds {len(found)} verification emails for {email}; expected {count} (one per sign-up and resend)")


TOKEN_RE = re.compile(r"/verify\?token=(\S+)")
EXPIRY_RE = re.compile(r"This link expires at (\d{4}-\d\d-\d\dT[\d:.]+Z)")


def token_of(message: dict) -> str:
    match = TOKEN_RE.search(text(message) or "")
    assert match, f"verification email has no /verify?token= link: {text(message)!r}"
    return match.group(1)


def verified(base: str, mail: Mailpit, kind: str = "educator") -> Person:
    person = sign_up(base, kind)
    token = token_of(mails_for(mail, person.email)[0])
    r = person.client.post("/api/auth/verify", json={"token": token})
    assert r.status_code == 200, f"POST /api/auth/verify: {r.status_code} {r.text}"
    person.account = r.json()["account"]
    return person


def create_classroom(owner: Person, name: str | None = None, **fields: Any) -> dict:
    body = {"name": name or f"Space Camp {tag()}", "timeZone": fields.pop("timeZone", CHICAGO), **fields}
    r = owner.client.post("/api/classrooms", json=body)
    assert r.status_code == 201, f"POST /api/classrooms: {r.status_code} {r.text}"
    return r.json()


def join(base: str, code: str, nickname: str) -> Person:
    c = api(base)
    r = c.post("/api/join/code", json={"code": code})
    assert r.status_code == 200, f"POST /api/join/code: {r.status_code} {r.text}"
    r = c.post("/api/join/nickname", json={"nickname": nickname})
    assert r.status_code == 201, f"POST /api/join/nickname: {r.status_code} {r.text}"
    return Person(c, r.json()["account"], "", "", nickname)


@dataclass
class Room:
    owner: Person
    data: dict
    kids: list[Person]

    @property
    def id(self) -> str:
        return self.data["id"]

    @property
    def name(self) -> str:
        return self.data["name"]

    def get(self) -> dict:
        r = self.owner.client.get(f"/api/classrooms/{self.id}")
        assert r.status_code == 200, r.text
        return r.json()


def make_room(base: str, mail: Mailpit, kids: int = 1, owner: Person | None = None, **fields: Any) -> Room:
    owner = owner or verified(base, mail)
    data = create_classroom(owner, **fields)
    t = tag()[:6]
    letters = string.ascii_uppercase
    people = [join(base, data["joinCode"], f"Kid {letters[i]} {t}") for i in range(kids)]
    return Room(owner, data, people)


def add_assistant(room: Room, assistant: Person) -> None:
    r = room.owner.client.post(f"/api/classrooms/{room.id}/educators", json={"email": assistant.email})
    assert r.status_code == 201, f"POST educators: {r.status_code} {r.text}"


def make_project(person: Person, kind: str, name: str, snapshot: dict) -> dict:
    r = person.client.post("/api/projects", json={"kind": kind, "name": name, "snapshot": snapshot})
    assert r.status_code == 201, f"POST /api/projects: {r.status_code} {r.text}"
    return r.json()["project"]


def save(person: Person, project_id: str, base_revision: int, snapshot: dict) -> httpx.Response:
    return person.client.put(f"/api/projects/{project_id}", json={"baseRevision": base_revision, "snapshot": snapshot})


def project_of(person: Person, kind: str) -> dict:
    projects = person.client.get("/api/projects").json()["projects"]
    found = [p for p in projects if p["kind"] == kind]
    assert found, f"GET /api/projects has no {kind} project for {person.name}"
    return found[0]


def snapshot_at(project_id: str, revision: int) -> dict:
    return json.loads(S3().get(f"projects/{project_id}/rev-{revision}.json"))


def revision_keys(project_id: str, store: S3 | None = None) -> list[str]:
    return sorted((store or S3()).keys(f"projects/{project_id}/"))


def expected_revisions(project_id: str, top: int) -> list[str]:
    return sorted(f"projects/{project_id}/rev-{n}.json" for n in range(1, top + 1))


def upload(person: Person, data: bytes, fmt: str, unit: str, name: str, project_id: str | None = None) -> httpx.Response:
    params = {"format": fmt, "unit": unit, "name": name}
    if project_id:
        params["projectId"] = project_id
    return person.client.post("/api/exports", params=params, content=data, headers={"Content-Type": "application/octet-stream"})


def login_url(base: str, user_id: str) -> str:
    return f"{base}/api/grading/session?user={quote(user_id)}&token={quote(TOKEN)}"


def db_hits(pg: Postgres, needle: str) -> list[str]:
    hits = []
    for table in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        rows = pg.rows(f"SELECT count(*) AS n FROM {ident} t WHERE row_to_json(t)::text LIKE '%{needle}%'")
        if rows and int(rows[0]["n"]) > 0:
            hits.append(table)
    return hits


def wait_real(client: httpx.Client, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    for _ in range(STREAM_REOPENS):
        if time.monotonic() >= deadline:
            return
        try:
            with client.stream("GET", "/api/stream", timeout=httpx.Timeout(HTTP_TIMEOUT, read=STREAM_READ_S)) as r:
                assert r.status_code == 200, f"GET /api/stream answered {r.status_code}; expected 200 text/event-stream"
                for _line in r.iter_lines():
                    if time.monotonic() >= deadline:
                        return
        except (httpx.ReadTimeout, httpx.RemoteProtocolError):
            continue
    if time.monotonic() < deadline:
        pytest.fail("GET /api/stream kept ending; expected a comment line every 15 seconds on an open stream")


@contextmanager
def counted_failures(client: httpx.Client) -> Iterator[None]:
    start = time.monotonic()
    try:
        yield
    finally:
        wait_real(client, max(0.0, start + JOIN_CLEAR_S - time.monotonic()))


class StreamWatch:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self.events: list[str] = []
        self.closed = False
        self.status: int | None = None
        self.ready = threading.Event()
        self.done = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        if not self.ready.wait(HTTP_TIMEOUT):
            pytest.fail("GET /api/stream did not answer; expected 200 text/event-stream")

    def _run(self) -> None:
        deadline = time.monotonic() + STREAM_WATCH_S
        try:
            with self.client.stream("GET", "/api/stream", timeout=httpx.Timeout(HTTP_TIMEOUT, read=STREAM_READ_S)) as r:
                self.status = r.status_code
                self.ready.set()
                if r.status_code != 200:
                    self.closed = True
                    return
                for line in r.iter_lines():
                    if line.startswith("event:"):
                        self.events.append(line[len("event:"):].strip())
                    if time.monotonic() > deadline:
                        return
                self.closed = True
        except httpx.RemoteProtocolError:
            self.closed = True
        except httpx.HTTPError:
            pass
        finally:
            self.ready.set()
            self.done.set()

    def wait_closed(self) -> bool:
        self.done.wait(CLOSE_WAIT_S)
        return self.closed


@contextmanager
def opened(browser: Browser, base: str, user_id: str | None, path: str, viewport: dict | None = None,
           **options: Any) -> Iterator[Page]:
    start = login_url(base, user_id) if user_id else f"{base}{path}"
    with open_app(browser, start, **options) as page:
        page.set_viewport_size(viewport or WIDE)
        page.goto(f"{base}{path}")
        page.evaluate("window.__qyLoadedOnce = true")
        yield page


def not_reloaded(page: Page) -> bool:
    return page.evaluate("window.__qyLoadedOnce === true")


def stored_revision(person: "Person", kind: str) -> int:
    projects = person.client.get("/api/projects").json()["projects"]
    return max((p["revision"] for p in projects if p["kind"] == kind), default=0)


def wait_saved(page: Page, person: "Person", kind: str, before: int) -> dict:
    for _ in range(SAVE_ATTEMPTS):
        current = project_of(person, kind) if stored_revision(person, kind) else {"revision": 0}
        if current["revision"] > before:
            expect(status(page)).to_contain_text(f"Saved revision {current['revision']}", timeout=SAVE_WAIT_MS)
            if project_of(person, kind)["revision"] == current["revision"]:
                return current
        else:
            expect(status(page)).to_contain_text("Saved revision", timeout=SAVE_WAIT_MS)
    pytest.fail(f"Ctrl+S stored no revision after {before}")


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Status")


def notice(page: Page) -> Locator:
    return page.get_by_role("region", name="Notice")


def roster(page: Page) -> Locator:
    return page.get_by_role("list", name="Classroom roster")


def tile(page: Page, nick: str) -> Locator:
    return roster(page).get_by_role("listitem", name=nick, exact=True)


def watch_button(page: Page, nick: str) -> Locator:
    return page.get_by_role("button", name=f"Watch {nick} live", exact=True)


def glancet(page: Page, nick: str) -> Locator:
    return page.get_by_role("dialog", name=f"Glancet: {nick}", exact=True)


def workplane(page: Page) -> Locator:
    wp = page.get_by_role("application", name="3D workplane")
    expect(wp).to_be_visible()
    return wp


def button(page: Page | Locator, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def state(page: Page, element_id: str) -> dict | None:
    return page.evaluate(STATE_JS, element_id)


def wait_for_state(page: Page, element_id: str, pred: Callable[[dict], bool], what: str, seconds: float = UI_S,
                   frame_ms: float = 0) -> dict:
    deadline = time.monotonic() + seconds
    last: dict | None = None
    while time.monotonic() < deadline:
        last = state(page, element_id)
        if last is not None and pred(last):
            return last
        if frame_ms:
            advance(page, frame_ms)
    pytest.fail(f"{what}; last #{element_id}: {last}")


def wait_scene(page: Page, pred: Callable[[dict], bool], what: str, frames: bool = False) -> dict:
    return wait_for_state(page, "qy-scene", pred, what, frame_ms=FRAME_MS if frames else 0)


def selected(s: dict) -> list[str]:
    return [v for v in (s.get("selected") or "").split(",") if v]


def item(s: dict, oid: str) -> dict:
    return next(o for o in s["items"] if o.get("object-id") == oid)


def xyz(o: dict) -> tuple[float, float, float]:
    return float(o["x"]), float(o["y"]), float(o["z"])


def whd(o: dict) -> tuple[float, float, float]:
    return float(o["w"]), float(o["d"]), float(o["h"])


def count_is(n: int) -> Callable[[dict], bool]:
    return lambda s: s.get("mesh-count") == str(n)


def clear_status(page: Page, base: str, rounds: int = 3) -> None:
    for _ in range(rounds):
        advance(page, config(base)["toastMs"])
        if not status(page).inner_text().strip():
            return


def opacity(locator: Locator) -> float:
    return float(locator.evaluate(OPACITY_JS))


def gone(locator: Locator) -> bool:
    return locator.count() == 0 or not locator.is_visible() or opacity(locator) <= 1 - OPAQUE


def same_matrices(a: list, b: list) -> bool:
    flat_a = [v for m in a for v in m]
    flat_b = [v for m in b for v in m]
    return len(flat_a) == len(flat_b) and all(abs(x - y) <= MATRIX_TOL for x, y in zip(flat_a, flat_b))


def code_pattern(code: str) -> re.Pattern:
    return re.compile(r"\s*".join(map(re.escape, code)))


def size_line(dims: tuple[float, float, float], unit: str) -> str:
    if unit == "in":
        return "Size: " + " × ".join(f"{d / INCH_MM:.2f}" for d in dims) + " in"
    return "Size: " + " × ".join(f"{d:.1f}" for d in dims) + " mm"


def component(page: Page, label: str) -> dict | None:
    s = state(page, "qy-circuit")
    return next((c for c in (s or {}).get("items", []) if c.get("component") == label), None)


def wait_component(page: Page, label: str, pred: Callable[[dict], bool], what: str) -> dict:
    deadline = time.monotonic() + UI_S
    last = None
    while time.monotonic() < deadline:
        last = component(page, label)
        if last and pred(last):
            return last
    pytest.fail(f"{what}; last {label}: {last}")


def part_group(page: Page, label: str) -> Locator:
    return page.get_by_role("list", name="Components").get_by_role("group", name=re.compile(rf"^{re.escape(label)}, "))


def terminal(page: Page, label: str, sign: str) -> Locator:
    return button(page, f"{label} {sign} terminal")


def wire_items(page: Page) -> Locator:
    return page.get_by_role("list", name="Wires").get_by_role("listitem")


def wire(page: Page, start: tuple[str, str], end: tuple[str, str]) -> None:
    a = terminal(page, *start)
    a.focus()
    page.keyboard.press("Enter")
    expect(a).to_have_attribute("aria-pressed", "true")
    b = terminal(page, *end)
    b.focus()
    page.keyboard.press("Enter")
    expect(wire_items(page).filter(has_text=f"{start[0]} {start[1]} to {end[0]} {end[1]}").first).to_be_visible()


def tick(page: Page, base: str, n: int = 2) -> None:
    advance(page, config(base)["simTickMs"] * n)


def export_via_ui(page: Page, fmt: str, unit: str) -> bytes:
    button(page, "Export").click()
    dialog = page.get_by_role("dialog", name="Export")
    pick_radio(dialog.get_by_role("radio", name=fmt, exact=True))
    pick_radio(dialog.get_by_role("radio", name=unit, exact=True))
    with page.expect_download() as download:
        button(dialog, "Download").click()
    return Path(download.value.path()).read_bytes()


def stl_triangles(data: bytes) -> list[tuple]:
    assert data[:9] == b"Quarkyard", f"STL header starts {data[:9]!r}; expected Quarkyard"
    n = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * n, f"STL length {len(data)} != 84 + 50 × {n}"
    tris = []
    for i in range(n):
        v = struct.unpack_from("<9f", data, 84 + 50 * i + 12)
        tris.append((v[0:3], v[3:6], v[6:9]))
    return tris


def stl_volume(tris: list[tuple]) -> float:
    total = 0.0
    for a, b, c in tris:
        total += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                  + a[2] * (b[0] * c[1] - b[1] * c[0]))
    return total / 6.0


def closed(polygons: list[tuple]) -> bool:
    edges: Counter = Counter()
    for poly in polygons:
        for i in range(len(poly)):
            edges[frozenset((poly[i], poly[(i + 1) % len(poly)]))] += 1
    return bool(edges) and all(n == 2 for n in edges.values())


def obj_mesh(data: bytes) -> tuple[int, int, list[tuple]]:
    lines = data.decode().splitlines()
    objects = sum(1 for line in lines if line.startswith("o "))
    coords: list[tuple] = []
    faces = []
    for line in lines:
        if line.startswith("v "):
            coords.append(tuple(float(p) for p in line.split()[1:4]))
        elif line.startswith("f "):
            idx = [int(p.split("/")[0]) for p in line.split()[1:]]
            faces.append(tuple(coords[i - 1] if i > 0 else coords[i] for i in idx))
    return objects, len(coords), faces


def tetra_stl(faces: int = 4, extra: bytes = b"") -> bytes:
    s = TETRA_MM
    v = [(0.0, 0.0, 0.0), (s, 0.0, 0.0), (0.0, s, 0.0), (0.0, 0.0, s)]
    tris = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)][:faces]
    out = bytearray(b"Quarkyard verifier".ljust(80, b" "))
    out += struct.pack("<I", len(tris))
    for a, b, c in tris:
        out += struct.pack("<3f", 0.0, 0.0, 0.0)
        for i in (a, b, c):
            out += struct.pack("<3f", *v[i])
        out += struct.pack("<H", 0)
    return bytes(out) + extra


def extents(tris: list[tuple]) -> tuple[float, float, float]:
    pts = [p for t in tris for p in t]
    return tuple(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))


def keyboard_create(page: Page, name: str) -> str:
    opener = page.get_by_role("button", name="Create classroom").first
    opener.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name="Create classroom")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role("textbox", name="Classroom name")).to_be_focused()
    for label, hint in (("Join opens", "Now"), ("Join closes", "14 days after Join opens"),
                        ("Hand-in time", "70 days after Join opens")):
        box = dialog.get_by_role("textbox", name=label)
        expect(box).to_have_value("")
        expect(box).to_have_attribute("placeholder", hint)
    page.keyboard.type(name)
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", level=1, name=name, exact=True)).to_be_focused()
    expect(page).to_have_url(re.compile(r"/classrooms/[^/?#]+$"))
    expect(status(page)).to_contain_text(f"Created {name}")
    return page.url.rstrip("/").rsplit("/", 1)[-1]


def test_wf_w01_classroom_live_join_keyboard_setup(browser: Browser, app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    first = f"Space Camp {tag()}"
    with opened(browser, app_url, owner.id, "/dashboard") as page:
        room_id = keyboard_create(page, first)
        expect(page.get_by_text("Open for joining", exact=True).first).to_be_visible()
        show = page.get_by_role("button", name="Show join code").first
        show.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Join code")
        stored = owner.client.get(f"/api/classrooms/{room_id}").json()
        expect(dialog).to_contain_text(code_pattern(stored["joinCode"]))
        page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(show).to_be_focused()
    assert stored["name"] == first and stored["timeZone"] == CHICAGO and stored["state"] == "open"
    assert stored["role"] == "owner" and stored["students"] == []
    opens = datetime.strptime(stored["joinOpensLocal"], LOCAL_FMT)
    assert stored["joinClosesLocal"] == (opens + timedelta(days=JOIN_DAYS)).strftime(LOCAL_FMT)
    assert stored["handInLocal"] == (opens + timedelta(days=HANDIN_DAYS)).strftime(LOCAL_FMT)
    other_zone = "America/Denver"
    create_classroom(owner, timeZone=other_zone)
    second = f"Space Camp {tag()}"
    with opened(browser, app_url, owner.id, "/dashboard") as page:
        second_id = keyboard_create(page, second)
    assert owner.client.get(f"/api/classrooms/{second_id}").json()["timeZone"] == other_zone


def test_classroom_times_validation(app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    now = minute(server_now(app_url))
    t = tag()
    cases = [
        ({"name": "  "}, "Use 1 to 60 characters."),
        ({"name": "x" * (NAME_MAX + 1)}, "Use 1 to 60 characters."),
        ({"timeZone": f"Nowhere/{t}"}, "Choose a time zone from the list."),
        ({"joinOpensLocal": "2026/11/20 9am"}, "Use the form YYYY-MM-DD HH:mm."),
    ]
    for override, copy in cases:
        body = {"name": f"Space Camp {t}", "timeZone": CHICAGO, **override}
        r = owner.client.post("/api/classrooms", json=body)
        assert copy in field_copy(r), f"{override}: expected {copy!r} in fields, got {r.text}"
    r = owner.client.post("/api/classrooms", json={"name": f"Space Camp {t}", "timeZone": CHICAGO,
                                                    "joinOpensLocal": local(now + timedelta(hours=2)),
                                                    "joinClosesLocal": local(now + timedelta(hours=1))})
    field_copy(r)
    assert r.json()["fields"]["joinClosesLocal"] == "Join closes must be after Join opens."
    r = owner.client.post("/api/classrooms", json={"name": f"Space Camp {t}", "timeZone": CHICAGO,
                                                    "handInLocal": local(now - timedelta(hours=1))})
    field_copy(r)
    assert r.json()["fields"]["handInLocal"] == "Hand-in time must be later than now."
    r = owner.client.post("/api/classrooms", json={"name": f"Space Camp {t}", "timeZone": CHICAGO,
                                                    "joinOpensLocal": local(now - timedelta(hours=1)),
                                                    "joinClosesLocal": local(now + timedelta(hours=3)),
                                                    "handInLocal": local(now + timedelta(hours=2))})
    field_copy(r)
    assert r.json()["fields"]["handInLocal"] == "Hand-in time must be at or after Join closes."
    names = [c["name"] for c in owner.client.get("/api/classrooms").json()["classrooms"]]
    assert f"Space Camp {t}" not in names
    assert db_hits(Postgres(), t) == [], "a refused classroom left rows behind"


def test_wf_w01_classroom_live_join_student_join(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    nick = f"Tiny Turtle {tag()[:4]}"
    code = room.data["joinCode"]
    typed = f"{code[:3].lower()} -{code[3:].lower()}"
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed:
        expect(ed.get_by_role("heading", level=1, name=room.name, exact=True)).to_be_visible()
        with opened(browser, app_url, None, "/join", viewport=NARROW, reduced_motion="reduce") as kid:
            tap(kid.get_by_role("textbox", name="Class code"))
            kid.keyboard.type(typed)
            tap(kid.get_by_role("textbox", name="Nickname"))
            kid.keyboard.type(nick)
            kid.keyboard.press("Enter")
            expect(kid).to_have_url(re.compile(r"/class$"))
            expect(status(kid)).to_contain_text(f"Joined {room.name} as {nick}")
            expect(kid.get_by_text(COUNTDOWN_RE).first).to_be_visible()
            layout(kid)
            account = kid.request.get(f"{app_url}/api/session").json()["account"]
            expect(tile(ed, nick)).to_be_visible()
            expect(status(ed)).to_contain_text(f"{nick} joined")
        with opened(browser, app_url, None, "/join", viewport=NARROW) as twin:
            fill(twin.get_by_role("textbox", name="Class code"), code)
            nick_box = twin.get_by_role("textbox", name="Nickname")
            fill(nick_box, nick.lower())
            button(twin, "Join class").click()
            expect(nick_box).to_have_accessible_description(re.compile(re.escape("That nickname is taken in this classroom.")))
    assert account["kind"] == "student" and account["classroomId"] == room.id
    assert account["email"] is None and account["nickname"] == nick
    assert [s["nickname"] for s in room.get()["students"]] == [nick]


def test_classroom_capacity(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    pending = api(app_url)
    assert pending.post("/api/join/code", json={"code": room.data["joinCode"]}).status_code == 200
    t = tag()[:6]
    for i in range(ROOM_MAX):
        join(app_url, room.data["joinCode"], f"Kid {i} {t}")
    assert_error(pending.post("/api/join/nickname", json={"nickname": f"Late {t}"}), 409, "classroom_full",
                 "This classroom is full. Ask your instructor.")
    assert len(room.get()["students"]) == ROOM_MAX


def test_wf_w01_classroom_live_join_invalid_join(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    taken = room.kids[0].name
    good = f"Red Owl {tag()[:4]}"
    with counted_failures(room.owner.client):
        with opened(browser, app_url, None, "/join") as kid:
            code_box = kid.get_by_role("textbox", name="Class code")
            nick_box = kid.get_by_role("textbox", name="Nickname")
            fill(code_box, BAD_CODE)
            fill(nick_box, good)
            nick_box.press("Enter")
            copy = "This class code is not open for joining."
            expect(code_box).to_have_accessible_description(re.compile(re.escape(copy)))
            expect(status(kid)).to_contain_text(copy)
            fill(code_box, room.data["joinCode"])
            fill(nick_box, "R")
            nick_box.press("Enter")
            expect(nick_box).to_have_accessible_description(
                re.compile(re.escape("Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes.")))
            fill(nick_box, taken.upper())
            nick_box.press("Enter")
            expect(nick_box).to_have_accessible_description(re.compile(re.escape("That nickname is taken in this classroom.")))
            join_btn = button(kid, "Join class")
            with held(kid, "**/api/join/**") as gate:
                fill(nick_box, good)
                join_btn.click()
                expect(join_btn).to_be_disabled()
                gate.release()
            expect(kid).to_have_url(re.compile(r"/class$"))
    nicknames = sorted(s["nickname"] for s in room.get()["students"])
    assert nicknames == sorted([taken, good])


def test_nickname_rules(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    code = room.data["joinCode"]
    invalid_copy = "Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes."
    taken_copy = "That nickname is taken in this classroom."
    t = tag()[:6]
    pending = api(app_url)
    assert pending.post("/api/join/code", json={"code": code}).status_code == 200
    for bad in ("A", "A" * (NICK_MAX + 1), "Bad!Name", "Blue_Fox"):
        r = pending.post("/api/join/nickname", json={"nickname": bad})
        assert r.json().get("fields", {}).get("nickname") == invalid_copy, f"{bad!r}: {r.text}"
    r = pending.post("/api/join/nickname", json={"nickname": f"  Red   Owl {t}  "})
    assert r.status_code == 201, r.text
    assert r.json()["account"]["nickname"] == f"Red Owl {t}"
    edge_short = join(app_url, code, "A" * NICK_MIN)
    join(app_url, code, "O'Neil-" + "x" * (NICK_MAX - len("O'Neil-")))
    clash = api(app_url)
    assert clash.post("/api/join/code", json={"code": code}).status_code == 200
    assert_error(clash.post("/api/join/nickname", json={"nickname": f"red owl {t.upper()}"}), 409, "nickname_taken", taken_copy)
    path = f"/api/classrooms/{room.id}/students/{edge_short.id}"
    assert_error(room.owner.client.patch(path, json={"nickname": f"RED OWL {t}"}), 409, "nickname_taken", taken_copy)
    r = room.owner.client.patch(path, json={"nickname": "x"})
    assert r.json().get("fields", {}).get("nickname") == invalid_copy, r.text
    r = room.owner.client.patch(path, json={"nickname": f"  New   Name {t} "})
    assert r.status_code == 200 and r.json()["nickname"] == f"New Name {t}", r.text
    assert f"New Name {t}" in [s["nickname"] for s in room.get()["students"]]


def test_live_roster_joins(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    assistant = verified(app_url, mail)
    add_assistant(room, assistant)
    t = tag()[:4]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as a, \
            opened(browser, app_url, assistant.id, f"/classrooms/{room.id}") as b:
        warm = f"Warm Up {t}"
        join(app_url, room.data["joinCode"], warm)
        for page in (a, b):
            expect(tile(page, warm)).to_be_visible()
        nick = f"Blue Fox {t}"
        join(app_url, room.data["joinCode"], nick)
        for page in (a, b):
            expect(tile(page, nick)).to_be_visible(timeout=LIVE_MS)
            expect(status(page)).to_contain_text(f"{nick} joined", timeout=LIVE_MS)
            assert not_reloaded(page), "the page reloaded"


def test_join_code_rotation(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    old = room.data["joinCode"]
    assert CODE_RE.fullmatch(old), old
    r = room.owner.client.post(f"/api/classrooms/{room.id}/join-code")
    assert r.status_code == 200, r.text
    new = r.json()["joinCode"]
    assert CODE_RE.fullmatch(new) and new != old
    assert room.get()["joinCode"] == new
    with counted_failures(room.owner.client):
        assert_error(api(app_url).post("/api/join/code", json={"code": old}), 404, "unknown_code",
                     "This class code is not open for joining.")
        r = api(app_url).post("/api/join/code", json={"code": f" {new[:2].lower()}-{new[2:4]} {new[4:].lower()} "})
        assert r.status_code == 200, r.text
        assert r.json()["classroom"]["name"] == room.name


def test_join_code_dialog(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    old = room.data["joinCode"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        opener = page.get_by_role("button", name="Show join code").first
        opener.click()
        dialog = page.get_by_role("dialog", name="Join code")
        expect(dialog).to_contain_text(code_pattern(old))
        button(dialog, "New code").click()
        expect(status(page)).to_contain_text("New join code ready")
        expect(dialog).not_to_contain_text(code_pattern(old))
        new = room.get()["joinCode"]
        assert new != old
        expect(dialog).to_contain_text(code_pattern(new))
        page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(opener).to_be_focused()


def test_join_rate_limit(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    client = api(app_url)
    with counted_failures(room.owner.client):
        for _ in range(JOIN_RATE_LIMIT):
            assert_error(client.post("/api/join/code", json={"code": BAD_CODE}), 404, "unknown_code")
        body = assert_error(client.post("/api/join/code", json={"code": BAD_CODE}), 429, "too_many_attempts",
                            "Too many attempts. Try again in 60 seconds.")
        assert 1 <= body["retryAfterSeconds"] <= RATE_WINDOW_S
        r = client.post("/api/join/code", json={"code": room.data["joinCode"]})
        assert_error(r, 429, "too_many_attempts")
        assert r.headers.get("Retry-After")
        assert client.get("/api/session").json()["pendingJoin"] is None
    assert client.post("/api/join/code", json={"code": room.data["joinCode"]}).status_code == 200


def test_classroom_states_and_transitions(app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    now = server_now(app_url)
    opens = minute(now) + timedelta(hours=1)
    closes, hand = opens + timedelta(hours=1), opens + timedelta(hours=2)
    room = create_classroom(owner, joinOpensLocal=local(opens), joinClosesLocal=local(closes), handInLocal=local(hand))
    rid = room["id"]
    c = owner.client

    def state_now() -> dict:
        return c.get(f"/api/classrooms/{rid}").json()

    assert room["state"] == "draft"
    with grading_clock(app_url):
        assert_error(c.post(f"/api/classrooms/{rid}/archive"), 409, "not_handed_in", "Hand in the classroom before archiving it.")
        assert_error(c.post(f"/api/classrooms/{rid}/hand-in"), 409, "classroom_not_started", "This classroom hasn't opened yet.")
        set_clock(app_url, opens - timedelta(seconds=30))
        assert state_now()["state"] == "draft"
        set_clock(app_url, opens)
        assert state_now()["state"] == "open"
        kid = join(app_url, room["joinCode"], f"Kid {tag()[:6]}")
        assert_error(c.post(f"/api/classrooms/{rid}/archive"), 409, "not_handed_in")
        set_clock(app_url, closes)
        assert state_now()["state"] == "in_session"
        assert_error(c.post(f"/api/classrooms/{rid}/archive"), 409, "not_handed_in")
        set_clock(app_url, hand - timedelta(seconds=30))
        assert 0 < state_now()["secondsToHandIn"] <= 30
        set_clock(app_url, hand)
        current = state_now()
        assert current["state"] == "handed_in" and current["secondsToHandIn"] == 0
        later = {"handInLocal": local(hand + timedelta(days=1))}
        assert_error(c.patch(f"/api/classrooms/{rid}", json=later), 409, "classroom_handed_in")
        assert_error(c.post(f"/api/classrooms/{rid}/hand-in"), 409, "classroom_handed_in")
        r = c.post(f"/api/classrooms/{rid}/archive")
        assert r.status_code == 200 and r.json()["state"] == "archived", r.text
        assert_error(c.post(f"/api/classrooms/{rid}/archive"), 409, "classroom_archived")
        assert_error(c.patch(f"/api/classrooms/{rid}", json=later), 409, "classroom_archived")
        assert_error(c.post(f"/api/classrooms/{rid}/hand-in"), 409, "classroom_archived")
        assert_error(c.post(f"/api/classrooms/{rid}/join-code"), 409, "classroom_archived")
        assert_error(kid.client.get("/api/class"), 401, "signed_out")
    moving = create_classroom(owner)
    mid = moving["id"]
    now = minute(server_now(app_url))
    r = c.patch(f"/api/classrooms/{mid}", json={"joinOpensLocal": local(now + timedelta(hours=1))})
    assert r.status_code == 200 and r.json()["state"] == "draft", r.text
    r = c.patch(f"/api/classrooms/{mid}", json={"joinOpensLocal": local(now - timedelta(hours=1))})
    assert r.status_code == 200 and r.json()["state"] == "open", r.text
    r = c.patch(f"/api/classrooms/{mid}", json={"joinClosesLocal": local(now - timedelta(minutes=30))})
    assert r.status_code == 200 and r.json()["state"] == "in_session", r.text
    r = c.post(f"/api/classrooms/{mid}/hand-in")
    assert r.status_code == 200 and r.json()["state"] == "handed_in", r.text
    assert abs(parse_instant(r.json()["handInAt"]) - parse_instant(r.json()["serverNow"])) <= timedelta(minutes=1)
    open_room = create_classroom(owner)
    r = c.post(f"/api/classrooms/{open_room['id']}/hand-in")
    assert r.status_code == 200 and r.json()["state"] == "handed_in", r.text


def next_local(now: datetime, hour: int, minute_: int, pred: Callable[[datetime], bool]) -> datetime:
    day = now.astimezone(ZONE).date()
    for offset in range(1, DST_SEARCH_DAYS):
        d = day + timedelta(days=offset)
        naive = datetime(d.year, d.month, d.day, hour, minute_)
        if pred(naive):
            return naive
    pytest.fail("no daylight-saving change found for America/Chicago")


def in_gap(naive: datetime) -> bool:
    aware = naive.replace(tzinfo=ZONE)
    return aware.astimezone(timezone.utc).astimezone(ZONE).replace(tzinfo=None) != naive


def ambiguous(naive: datetime) -> bool:
    return naive.replace(tzinfo=ZONE, fold=0).utcoffset() != naive.replace(tzinfo=ZONE, fold=1).utcoffset()


def test_join_window_server_time(app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    now = server_now(app_url)
    opens = minute(now) + timedelta(hours=1)
    closes, hand = opens + timedelta(hours=1), opens + timedelta(hours=2)
    draft = create_classroom(owner, joinOpensLocal=local(opens), joinClosesLocal=local(closes), handInLocal=local(hand))
    assert parse_instant(draft["joinOpensAt"]) == opens and parse_instant(draft["handInAt"]) == hand
    base = minute(now)
    past = create_classroom(owner, joinOpensLocal=local(base - timedelta(hours=2)),
                            joinClosesLocal=local(base - timedelta(hours=1)), handInLocal=local(base + timedelta(hours=1)))
    assert past["state"] == "in_session"
    copy = "This class code is not open for joining."
    with counted_failures(owner.client):
        assert_error(api(app_url).post("/api/join/code", json={"code": draft["joinCode"]}), 409, "join_closed", copy)
        assert_error(api(app_url).post("/api/join/code", json={"code": past["joinCode"]}), 409, "join_closed", copy)
        with grading_clock(app_url):
            set_clock(app_url, opens)
            pending = api(app_url)
            assert pending.post("/api/join/code", json={"code": draft["joinCode"]}).status_code == 200
            set_clock(app_url, closes)
            assert_error(pending.post("/api/join/nickname", json={"nickname": f"Kid {tag()[:6]}"}), 409, "join_closed")
    gap = next_local(now, 2, 30, in_gap)
    r = owner.client.post("/api/classrooms", json={"name": f"Space Camp {tag()}", "timeZone": CHICAGO,
                                                    "joinOpensLocal": gap.strftime(LOCAL_FMT)})
    field_copy(r)
    assert r.json()["fields"]["joinOpensLocal"] == f"That time does not exist in {CHICAGO}."
    fold = next_local(now, 1, 30, ambiguous)
    room = create_classroom(owner, joinOpensLocal=fold.strftime(LOCAL_FMT))
    assert parse_instant(room["joinOpensAt"]) == fold.replace(tzinfo=ZONE, fold=0).astimezone(timezone.utc)


def test_wf_w02_server_time_hand_in_classroom_freeze(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    other = make_project(kid, "circuit", "Night Light", NIGHT)
    proj = make_project(kid, "3d", "Gear Box", GEAR)
    copy = "This classroom was handed in. Changes are no longer saved."
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, kid.id, f"/editor/{proj['id']}") as kp:
        expect(tile(ed, kid.name)).to_be_visible()
        wp = workplane(kp)
        wp.focus()
        kp.keyboard.press("b")
        wait_scene(kp, count_is(2), "B adds a box beside Gear Box")
        with grading_clock(app_url):
            set_clock(app_url, parse_instant(room.data["handInAt"]))
            wp.focus()
            kp.keyboard.press("Control+s")
            expect(notice(kp)).to_contain_text(copy)
            expect(tile(ed, kid.name)).to_contain_text("Handed in", timeout=LIVE_MS)
            for p in (proj, other):
                assert_error(save(kid, p["id"], 1, ONE), 409, "classroom_handed_in", copy)
                assert revision_keys(p["id"]) == expected_revisions(p["id"], 1)
            assert kid.client.get(f"/api/projects/{proj['id']}").json()["project"]["state"] == "handed_in"


def test_wf_w02_server_time_hand_in_student_hand_in(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    other = make_project(kid, "circuit", "Night Light", NIGHT)
    proj = make_project(kid, "3d", "Gear Box", GEAR)
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, kid.id, f"/editor/{proj['id']}") as kp:
        expect(tile(ed, kid.name)).to_be_visible()
        workplane(kp)
        button(kp, "Hand in").click()
        dialog = kp.get_by_role("alertdialog", name="Hand in Gear Box?")
        button(dialog, "Hand in now").click()
        expect(status(kp)).to_contain_text("Handed in Gear Box")
        expect(status(ed)).to_contain_text(f"{kid.name} handed in", timeout=LIVE_MS)
        expect(tile(ed, kid.name)).to_contain_text("Handed in", timeout=LIVE_MS)
    assert kid.client.get(f"/api/projects/{proj['id']}").json()["project"]["state"] == "handed_in"
    assert_error(save(kid, proj["id"], 1, ONE), 409, "project_handed_in",
                 "You handed in this project. Changes are no longer saved.")
    assert revision_keys(proj["id"]) == expected_revisions(proj["id"], 1)
    student = next(s for s in room.get()["students"] if s["id"] == kid.id)
    assert student["handedIn"] is True
    r = save(kid, other["id"], 1, NIGHT)
    assert r.status_code == 200 and r.json()["project"]["state"] == "editing", r.text


def countdown_text(seconds: int) -> str:
    m = seconds // 60
    return f"Hand-in in {m // 1440}d {(m % 1440) // 60}h {m % 60}m"


def test_server_countdown(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    wrong = server_now(app_url) - timedelta(days=WRONG_CLOCK_DAYS)
    first = kid.client.get("/api/class").json()["secondsToHandIn"]
    with opened(browser, app_url, kid.id, "/class") as kp, \
            opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed:
        for page in (kp, ed):
            page.clock.set_system_time(wrong)
            page.reload()
        shown_loc = kp.get_by_text(COUNTDOWN_RE).first
        expect(shown_loc).to_be_visible()
        shown = COUNTDOWN_RE.search(shown_loc.inner_text()).group(0)
        last = kid.client.get("/api/class").json()["secondsToHandIn"]
        assert shown in {countdown_text(s) for s in range(last, first + 1)}, shown
        data = room.get()
        expect(ed.get_by_text("Open for joining", exact=True).first).to_be_visible()
        expect(ed.get_by_text(f"Hand-in: {data['handInLocal'].replace('T', ' ')} ({CHICAGO})")).to_be_visible()
        expect(ed.get_by_text(f"Join window: {data['joinOpensLocal'].replace('T', ' ')} to "
                              f"{data['joinClosesLocal'].replace('T', ' ')} ({CHICAGO})")).to_be_visible()
        with grading_clock(app_url):
            set_clock(app_url, parse_instant(data["handInAt"]) + timedelta(minutes=1))
            expect(kp.get_by_text(countdown_text(0)).first).to_be_visible(timeout=LIVE_MS)
            expect(ed.get_by_text("Handed in", exact=True).first).to_be_visible(timeout=LIVE_MS)
            after = kid.client.get("/api/class").json()
            assert after["state"] == "handed_in" and after["secondsToHandIn"] == 0


def test_wf_w03_csg_group_keyboard_build(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        s = wait_scene(page, count_is(1), "B adds one box")
        box = s["items"][0]
        assert box["kind"] == "box" and box["mode"] == "solid"
        assert xyz(box) == (0, 0, REST_Z) and whd(box) == (SHAPE_MM,) * 3
        assert box["volume"] == str(int(SHAPE_MM ** 3)) and selected(s) == [box["object-id"]]
        page.keyboard.press("c")
        s = wait_scene(page, count_is(2), "C adds a cylinder")
        cyl_id = s["items"][1]["object-id"]
        assert s["items"][1]["kind"] == "cylinder" and selected(s) == [cyl_id]
        width = page.get_by_role("textbox", name="Width (mm)")
        fill(width, "10")
        width.press("Enter")
        wait_scene(page, lambda s: whd(item(s, cyl_id))[:2] == (10, 10), "cylinder width and depth follow the diameter")
        wp.focus()
        page.keyboard.press("h")
        s = wait_scene(page, lambda s: item(s, cyl_id)["mode"] == "hole", "H turns the cylinder into a hole")
        assert s["total-volume"] == str(int(SHAPE_MM ** 3))
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: len(selected(s)) == 2, "Ctrl+A selects both")
        page.keyboard.press("Control+g")
        s = wait_scene(page, lambda s: s["mesh-count"] == "1" and s["items"][0]["kind"] == "group", "Ctrl+G groups")
        assert s["items"][0]["volume"] == str(EXAMPLE_GROUP_VOLUME) and s["total-volume"] == str(EXAMPLE_GROUP_VOLUME)
        expect(status(page)).to_contain_text("Grouped 2 shapes")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 1")
    project = project_of(kid, "3d")
    assert project["revision"] == 1 and project["name"] == "Untitled 3D design"
    snap = snapshot_at(project["id"], 1)
    assert len(snap["objects"]) == 1 and snap["objects"][0]["kind"] == "group"
    assert sorted(c["mode"] for c in snap["objects"][0]["children"]) == ["hole", "solid"]


def test_wf_w03_csg_group_shape_buttons(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d") as page:
        shapes = page.get_by_role("toolbar", name="Shapes")
        button(shapes, "Box").click()
        button(shapes, "Cylinder").click()
        s = wait_scene(page, count_is(2), "Box and Cylinder buttons add shapes")
        cyl_id = s["items"][1]["object-id"]
        depth = page.get_by_role("textbox", name="Depth (mm)")
        fill(depth, "12")
        depth.press("Enter")
        wait_scene(page, lambda s: whd(item(s, cyl_id)) == (12, 12, SHAPE_MM), "cylinder depth sets the diameter")
        button(shapes, "Sphere").click()
        s = wait_scene(page, count_is(3), "Sphere button adds a sphere")
        sph_id = s["items"][2]["object-id"]
        big = 30
        width = page.get_by_role("textbox", name="Width (mm)")
        fill(width, str(big))
        width.press("Enter")
        s = wait_scene(page, lambda s: whd(item(s, sph_id)) == (big,) * 3, "sphere keeps all three sizes equal")
        assert xyz(item(s, sph_id))[2] == big / 2
        expected = round(SHAPE_MM ** 3 + 3.141592653589793 * 6 ** 2 * SHAPE_MM + 4 / 3 * 3.141592653589793 * (big / 2) ** 3)
        assert s["total-volume"] == str(expected)
        height = page.get_by_role("textbox", name="Height (mm)")
        fill(height, "0")
        height.press("Enter")
        expect(height).to_have_accessible_description(re.compile(re.escape("Enter a size from 0.1 to 1000 mm.")))
        assert whd(item(state(page, "qy-scene"), sph_id)) == (big,) * 3
        workplane(page).focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
    project = project_of(kid, "3d")
    kinds = sorted(o["kind"] for o in snapshot_at(project["id"], project["revision"])["objects"])
    assert kinds == ["box", "cylinder", "sphere"]


def test_wf_w03_csg_group_group_rules(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d") as page:
        workers: list[str] = []
        page.on("worker", lambda w: workers.append(w.url))
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        page.keyboard.press("c")
        wait_scene(page, count_is(2), "box and cylinder")
        width = page.get_by_role("textbox", name="Width (mm)")
        fill(width, "10")
        width.press("Enter")
        wp.focus()
        page.keyboard.press("h")
        page.keyboard.press("Control+a")
        button(page, "Group").click()
        s = wait_scene(page, lambda s: s["mesh-count"] == "1", "Group makes one object")
        tri, size = s["triangle-count"], whd(s["items"][0])
        assert s["items"][0]["volume"] == str(EXAMPLE_GROUP_VOLUME) and size == (SHAPE_MM,) * 3
        expect(status(page)).to_contain_text("Grouped 2 shapes")
        assert workers or page.workers, "grouping ran without any Web Worker"
        wp.focus()
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+Shift+G")
        s = wait_scene(page, count_is(2), "Ungroup restores both members")
        assert sorted((o["kind"], o["mode"]) for o in s["items"]) == [("box", "solid"), ("cylinder", "hole")]
        expect(status(page)).to_contain_text("Ungrouped 2 shapes")
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+g")
        s = wait_scene(page, count_is(1), "regroup")
        assert s["triangle-count"] == tri and whd(s["items"][0]) == size, "equal inputs gave a different group"
        page.keyboard.press("Control+a")
        page.keyboard.press("h")
        s = wait_scene(page, lambda s: s["items"][0]["mode"] == "hole", "H makes the group a hole")
        assert s["total-volume"] == "0"
        page.keyboard.press("Control+z")
        wait_scene(page, lambda s: s["items"][0]["mode"] == "solid", "undo restores solid")
        page.keyboard.press("Control+a")
        page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: xyz(s["items"][0])[0] == 1, "group moves 1 mm")
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+Shift+G")
        s = wait_scene(page, count_is(2), "ungroup after a move")
        assert all(xyz(o)[0] == 1 for o in s["items"]), s
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        wait_scene(page, count_is(0), "Delete clears")
        page.keyboard.press("b")
        box_tri = wait_scene(page, count_is(1), "lone box")["triangle-count"]
        page.keyboard.press("c")
        page.keyboard.press("h")
        for _ in range(AWAY_MM // 10):
            page.keyboard.press("Shift+ArrowRight")
        wait_scene(page, lambda s: s["mesh-count"] == "2" and xyz(s["items"][1])[0] == AWAY_MM, "hole moved clear")
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+g")
        s = wait_scene(page, count_is(1), "group with a far hole")
        assert s["triangle-count"] == box_tri and whd(s["items"][0]) == (SHAPE_MM,) * 3
        assert s["items"][0]["volume"] == str(int(SHAPE_MM ** 3))
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        for key in ("b", "h", "c", "h"):
            page.keyboard.press(key)
        wait_scene(page, count_is(2), "two holes")
        clear_status(page, app_url)
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+g")
        expect(status(page)).to_contain_text("A group needs at least one solid.")
        assert state(page, "qy-scene")["mesh-count"] == "2"
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        page.keyboard.press("b")
        wait_scene(page, count_is(1), "one box")
        clear_status(page, app_url)
        page.keyboard.press("Control+g")
        expect(status(page)).to_contain_text("Select two or more shapes first.")
        assert state(page, "qy-scene")["mesh-count"] == "1"
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
    project = project_of(kid, "3d")
    objs = snapshot_at(project["id"], project["revision"])["objects"]
    assert [o["kind"] for o in objs] == ["box"]


def test_revisions_and_saving(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Rev {tag()}", EMPTY)["id"]
    assert revision_keys(pid) == expected_revisions(pid, 1)
    r = save(kid, pid, 1, ONE)
    assert r.status_code == 200 and r.json()["project"]["revision"] == 2, r.text
    key = idempotency_key()
    body = json.dumps({"baseRevision": 2, "snapshot": TWO})
    headers = {"Content-Type": "application/json", "Idempotency-Key": key}
    first = kid.client.put(f"/api/projects/{pid}", content=body, headers=headers)
    assert first.status_code == 200 and first.json()["project"]["revision"] == 3, first.text
    replay = kid.client.put(f"/api/projects/{pid}", content=body, headers=headers)
    assert replay.status_code == 200 and replay.json()["project"] == first.json()["project"], replay.text
    other = json.dumps({"baseRevision": 3, "snapshot": ONE})
    assert_error(kid.client.put(f"/api/projects/{pid}", content=other, headers=headers), 409, "idempotency_conflict",
                 "That save was already sent with different content.")
    assert revision_keys(pid) == expected_revisions(pid, 3)
    assert len(snapshot_at(pid, 3)["objects"]) == 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(2), "editor loads revision 3")
        wp.focus()
        page.keyboard.press("b")
        expect(page.get_by_text("Unsaved changes").first).to_be_visible()
        with held(page, f"**/api/projects/{pid}") as gate:
            page.keyboard.press("Control+s")
            expect(page.get_by_text("Saving…").first).to_be_visible()
            assert revision_keys(pid) == expected_revisions(pid, 3)
            gate.release()
        expect(page.get_by_text("Saved · revision 4").first).to_be_visible()
        expect(status(page)).to_contain_text("Saved revision 4")
        wp.focus()
        page.keyboard.press("b")
        advance(page, config(app_url)["autosaveMs"])
        expect(page.get_by_text("Saved · revision 5").first).to_be_visible()
    assert revision_keys(pid) == expected_revisions(pid, 5)
    assert len(snapshot_at(pid, 5)["objects"]) == 4


def test_live_roster_saves(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", ONE)["id"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed:
        card = tile(ed, kid.name)
        expect(card).to_contain_text("Rev 1")
        assert save(kid, pid, 1, TWO).status_code == 200
        expect(card).to_contain_text("Rev 2")
        r = save(kid, pid, 2, ONE)
        assert r.status_code == 200, r.text
        saved_at = local(parse_instant(r.json()["project"]["savedAt"])).replace("T", " ")
        expect(card).to_contain_text("Rev 3", timeout=LIVE_MS)
        expect(card).to_contain_text(f"Saved {saved_at}", timeout=LIVE_MS)
        expect(status(ed)).to_contain_text(f"{kid.name} saved revision 3", timeout=LIVE_MS)
        assert not_reloaded(ed), "the page reloaded"


def test_keyboard_transforms(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Moves {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        oid = wait_scene(page, count_is(1), "box")["items"][0]["object-id"]
        steps = [("ArrowRight", (1, 0, REST_Z)), ("Shift+ArrowRight", (11, 0, REST_Z)), ("ArrowUp", (11, 1, REST_Z)),
                 ("ArrowDown", (11, 0, REST_Z)), ("Shift+ArrowUp", (11, 10, REST_Z)), ("PageUp", (11, 10, 11)),
                 ("Shift+PageDown", (11, 10, 1)), ("ArrowLeft", (10, 10, 1))]
        for key, where in steps:
            page.keyboard.press(key)
            wait_scene(page, lambda s, w=where: xyz(item(s, oid)) == w, f"{key} moves the box to {where}")
        page.keyboard.press("r")
        for key, angle in (("ArrowRight", ROT_STEP), ("Shift+ArrowLeft", ROT_STEP - 1), ("ArrowLeft", 359), ("Shift+ArrowRight", 0),
                           ("ArrowRight", ROT_STEP)):
            page.keyboard.press(key)
            wait_scene(page, lambda s, a=angle: item(s, oid)["rotation-z"] == str(a), f"rotate {key} gives {angle}")
        assert whd(item(state(page, "qy-scene"), oid)) == (SHAPE_MM,) * 3
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: xyz(item(s, oid))[0] == 11 and item(s, oid)["rotation-z"] == str(ROT_STEP),
                   "after Enter, arrows move instead of rotating")
        button(page, "Save").focus()
        page.keyboard.press("b")
        wait_scene(page, count_is(2), "B works while focus is on the Save button")
    right = design([shape("r", x=SHAPE_MM)], origin=(SHAPE_MM / 2, 0, REST_Z), normal=(1, 0, 0))
    pid2 = make_project(kid, "3d", f"Right face {tag()}", right)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid2}") as page:
        wp = workplane(page)
        wait_scene(page, lambda s: s.get("workplane-normal") == "1,0,0", "right-face workplane loads")
        wp.focus()
        page.keyboard.press("Tab")
        wait_scene(page, lambda s: selected(s) == ["r"], "Tab selects the object")
        for key, where in (("ArrowRight", (SHAPE_MM, 1, REST_Z)), ("ArrowUp", (SHAPE_MM, 1, 11)), ("PageUp", (21, 1, 11))):
            page.keyboard.press(key)
            wait_scene(page, lambda s, w=where: xyz(item(s, "r")) == w, f"{key} on the right face gives {where}")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    moved = snapshot_at(pid2, 2)["objects"][0]
    assert (moved["x"], moved["y"], moved["z"]) == (21, 1, 11)


def test_wf_w04_keyboard_transforms_undo_redo(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Undo {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        for key in ("b", "ArrowRight", "Shift+ArrowRight", "h"):
            page.keyboard.press(key)
        s = wait_scene(page, lambda s: s["mesh-count"] == "1" and s["items"][0]["mode"] == "hole", "four edits")
        oid = s["items"][0]["object-id"]
        checks: list[tuple[str, Callable[[dict], bool]]] = [
            ("Control+z", lambda s: item(s, oid)["mode"] == "solid" and xyz(item(s, oid))[0] == 11),
            ("Control+z", lambda s: xyz(item(s, oid))[0] == 1),
            ("Control+z", lambda s: xyz(item(s, oid))[0] == 0),
            ("Control+z", count_is(0)),
            ("Control+Shift+Z", lambda s: s["mesh-count"] == "1" and xyz(s["items"][0])[0] == 0),
            ("Control+y", lambda s: xyz(s["items"][0])[0] == 1),
        ]
        for key, pred in checks:
            page.keyboard.press(key)
            wait_scene(page, pred, f"{key} steps one edit")
        button(page, "Redo").click()
        wait_scene(page, lambda s: xyz(s["items"][0])[0] == 11, "Redo button")
        button(page, "Undo").click()
        wait_scene(page, lambda s: xyz(s["items"][0])[0] == 1, "Undo button")
        wp.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    obj = snapshot_at(pid, 2)["objects"][0]
    assert obj["x"] == 1 and obj["mode"] == "solid"


def test_wf_w04_keyboard_transforms_persistence(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Keep {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        wait_scene(page, count_is(1), "box")
        width = page.get_by_role("textbox", name="Width (mm)")
        fill(width, "30")
        width.press("Enter")
        wp.focus()
        for key in ("Shift+ArrowRight", "r", "ArrowRight", "Enter", "c", "h", "Shift+ArrowUp"):
            page.keyboard.press(key)
        wait_scene(page, lambda s: s["mesh-count"] == "2" and xyz(s["items"][1])[1] == 10, "cylinder moved")
        height = page.get_by_role("textbox", name="Height (mm)")
        fill(height, "35")
        height.press("Enter")
        before = wait_scene(page, lambda s: xyz(s["items"][1])[2] == 17.5, "height change keeps the bottom fixed")
        wp.focus()
        page.keyboard.press("Control+s")
        expect(page.get_by_text("Saved · revision 2").first).to_be_visible()
        expect(status(page)).to_contain_text("Saved revision 2")
        page.reload()
        workplane(page)
        after = wait_scene(page, count_is(2), "reloaded design")
        assert after["items"] == before["items"], f"properties changed across reload: {before['items']} -> {after['items']}"
    objs = {o["kind"]: o for o in snapshot_at(pid, 2)["objects"]}
    assert (objs["box"]["x"], objs["box"]["w"], objs["box"]["rotationZ"]) == (10, 30, ROT_STEP)
    assert (objs["cylinder"]["mode"], objs["cylinder"]["y"], objs["cylinder"]["h"]) == ("hole", 10, 35)


def test_selection(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d") as page:
        wp = workplane(page)
        wp.focus()
        for key in ("b", "c", "s"):
            page.keyboard.press(key)
        s = wait_scene(page, count_is(3), "three shapes")
        ids = [o["object-id"] for o in s["items"]]
        assert selected(s) == [ids[2]]
        for key, want in (("Shift+Tab", ids[1]), ("Shift+Tab", ids[0]), ("Tab", ids[1]), ("Tab", ids[2])):
            page.keyboard.press(key)
            wait_scene(page, lambda s, w=want: selected(s) == [w], f"{key} selects {want}")
        page.keyboard.press("Tab")
        assert not wp.evaluate("el => el === document.activeElement"), "Tab from the last object stayed on the workplane"
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == sorted(ids), "Ctrl+A selects all")
        page.keyboard.press("Delete")
        wait_scene(page, count_is(0), "Delete removes the selection")
        page.keyboard.press("b")
        box_id = wait_scene(page, count_is(1), "box at origin")["items"][0]["object-id"]
        page.keyboard.press("c")
        for _ in range(AWAY_MM // 10):
            page.keyboard.press("Shift+ArrowRight")
        cyl_id = wait_scene(page, lambda s: s["mesh-count"] == "2" and xyz(s["items"][1])[0] == AWAY_MM, "cylinder away")["items"][1]["object-id"]
        wp.click(modifiers=["Shift"])
        wait_scene(page, lambda s: sorted(selected(s)) == sorted([box_id, cyl_id]), "Shift+click adds the box")
        wp.click(modifiers=["Shift"])
        wait_scene(page, lambda s: selected(s) == [cyl_id], "Shift+click removes the box again")
        button(page, "Delete").click()
        s = wait_scene(page, count_is(1), "Delete button removes the selection")
        assert s["items"][0]["object-id"] == box_id


def test_wf_w05_align_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Align {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        page.keyboard.press("c")
        for _ in range(3):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowUp")
        wait_scene(page, lambda s: s["mesh-count"] == "2" and xyz(s["items"][1])[:2] == (30, 10), "cylinder at 30,10")
        page.keyboard.press("Control+a")
        page.keyboard.press("l")
        dialog = page.get_by_role("dialog", name="Align")
        expect(dialog).to_be_visible()
        assert dialog.evaluate(CONTAINS_FOCUS)
        for key in ("Tab", "Tab", "Tab", "Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate(CONTAINS_FOCUS), f"{key} left the Align dialog"
        button(dialog, "Align centers on X").focus()
        page.keyboard.press("Enter")
        s = wait_scene(page, lambda s: all(xyz(o)[0] == 15 for o in s["items"]), "both centres at the bbox centre 15")
        assert [xyz(o)[1] for o in s["items"]] == [0, 10]
        expect(status(page)).to_contain_text("Aligned 2 shapes on X")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(wp).to_be_focused()
        page.keyboard.press("Control+z")
        wait_scene(page, lambda s: [xyz(o)[0] for o in s["items"]] == [0, 30], "one undo restores both")
        page.keyboard.press("Control+Shift+Z")
        wait_scene(page, lambda s: all(xyz(o)[0] == 15 for o in s["items"]), "redo aligns again")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    assert [o["x"] for o in snapshot_at(pid, 2)["objects"]] == [15, 15]


def test_wf_w05_align_needs_two(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Align one {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(s["items"][0])[0] == 1, "box at x 1")
        button(page, "Align").click()
        expect(status(page)).to_contain_text("Select two or more shapes first.")
        if page.get_by_role("dialog", name="Align").is_visible():
            page.keyboard.press("Escape")
        assert xyz(state(page, "qy-scene")["items"][0])[0] == 1
        wp.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    assert snapshot_at(pid, 2)["objects"][0]["x"] == 1


def test_wf_w06_workplane_touch_phone_editor(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d", viewport=NARROW) as page:
        wp = workplane(page)
        assert wp.bounding_box()["width"] >= NARROW["width"] - PX_TOL
        layout(page)
        sheet = page.get_by_role("dialog", name="Shapes")
        for name, n in (("Box", 1), ("Cylinder", 2)):
            tap(button(page, "Shapes"))
            expect(sheet).to_be_visible()
            tap(button(sheet.get_by_role("toolbar", name="Shapes"), name))
            wait_scene(page, count_is(n), f"{name} from the Shapes sheet")
            if sheet.is_visible():
                page.keyboard.press("Escape")
            advance(page, DIALOG_SETTLE_MS)
        wp.focus()
        for _ in range(AWAY_MM // 10):
            page.keyboard.press("Shift+ArrowRight")
        s = wait_scene(page, lambda s: xyz(s["items"][1])[0] == AWAY_MM, "cylinder moved away")
        box_id = s["items"][0]["object-id"]
        tap(wp)
        wait_scene(page, lambda s: selected(s) == [box_id], "tap selects the box")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
    project = project_of(kid, "3d")
    assert len(snapshot_at(project["id"], project["revision"])["objects"]) == 2


def test_camera_touch_pointer(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d", reduced_motion="reduce") as page:
        wp = workplane(page)
        s = state(page, "qy-scene")
        assert s["camera-azimuth"] == str(CAMERA_AZIMUTH) and float(s["camera-distance"]) == CAMERA_DISTANCE
        box = wp.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        turn = ORBIT_PX // 2

        def orbited(start: int) -> Callable[[dict], bool]:
            return lambda s: int(s["camera-azimuth"]) in {(start + turn) % 360, (start - turn) % 360}

        advance(page, FRAME_MS)
        before = camera(page)
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + ORBIT_PX, cy, steps=6)
        page.mouse.up()
        az = int(wait_scene(page, orbited(CAMERA_AZIMUTH), "mouse drag orbits 30°")["camera-azimuth"])
        advance(page, FRAME_MS)
        assert not same_matrices(before, camera(page)), "orbit did not change the rendered camera"
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, WHEEL_PX)
        s = wait_scene(page, lambda s: float(s["camera-distance"]) != CAMERA_DISTANCE, "wheel zooms")
        dist = float(s["camera-distance"])
        assert ZOOM_MIN <= dist <= ZOOM_MAX
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})

        def touch(kind: str, points: list[tuple[float, float]]) -> None:
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})

        touch("touchStart", [(cx, cy)])
        for i in range(1, 7):
            touch("touchMove", [(cx + ORBIT_PX * i / 6, cy)])
        touch("touchEnd", [])
        wait_scene(page, orbited(az), "one-finger drag orbits 30°")
        touch("touchStart", [(cx - 20, cy), (cx + 20, cy)])
        for i in range(1, 7):
            touch("touchMove", [(cx - 20 - PINCH_PX * i / 6, cy), (cx + 20 + PINCH_PX * i / 6, cy)])
        touch("touchEnd", [])
        s = wait_scene(page, lambda s: float(s["camera-distance"]) != dist, "pinch zooms")
        assert ZOOM_MIN <= float(s["camera-distance"]) <= ZOOM_MAX


def test_wf_w06_workplane_touch_workplane_faces(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        wait_scene(page, count_is(1), "box")
        page.keyboard.press("w")
        expect(status(page)).to_contain_text("Pick a face for the workplane")
        page.keyboard.press("Enter")
        wait_scene(page, lambda s: s["workplane-normal"] == "0,0,1" and s["workplane-origin"] == "0,0,20", "top face")
        expect(status(page)).to_contain_text("Workplane set to top face")
        page.keyboard.press("b")
        s = wait_scene(page, count_is(2), "second box")
        assert xyz(s["items"][1]) == (0, 0, 30)
        button(page, "Reset workplane").click()
        expect(status(page)).to_contain_text("Workplane reset")
        wait_scene(page, lambda s: s["workplane-origin"] == "0,0,0" and s["workplane-normal"] == "0,0,1", "reset to ground")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
    right = design([shape("base")], origin=(SHAPE_MM / 2, 0, REST_Z), normal=(1, 0, 0))
    pid = make_project(kid, "3d", f"Faces {tag()}", right)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, lambda s: s.get("workplane-normal") == "1,0,0", "right-face workplane")
        wp.focus()
        page.keyboard.press("b")
        s = wait_scene(page, count_is(2), "box on the right face")
        assert xyz(s["items"][1]) == (SHAPE_MM, 0, REST_Z)
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    placed = snapshot_at(pid, 2)["objects"][1]
    assert (placed["x"], placed["y"], placed["z"]) == (SHAPE_MM, 0, REST_Z)


NIGHT_WIRES = [(w["from"], w["to"]) for w in NIGHT["wires"]]
VERIFY_TTL_S = int(os.environ.get("QY_VERIFY_TTL_SECONDS") or 86400)
RACERS = 5
SCROLL_PX = 600
POSTER_STEP_MS = 1000
EXPIRY_SLACK = timedelta(seconds=1)
FAR_HAND_IN = "2030-01-01T09:00"
OUTAGE_PROJECT = "Outage Part"


def night(ohms: float) -> dict:
    return circuit([BATTERY, resistor(ohms), LED], NIGHT_WIRES)


def wire_set(snap: dict) -> set:
    return {frozenset((w["from"], w["to"])) for w in snap["wires"]}


def add_part(page: Page, kind: str, label: str) -> Locator:
    button(page.get_by_role("toolbar", name="Parts"), kind).focus()
    page.keyboard.press("Enter")
    group = part_group(page, label)
    expect(group).to_be_visible()
    return group


def start_sim(page: Page, base: str) -> None:
    button(page, "Start Simulation").click()
    expect(status(page)).to_contain_text("Simulation started")
    wait_for_state(page, "qy-circuit", lambda s: s.get("sim") == "running", "simulation runs")
    tick(page, base)


def stop_sim(page: Page) -> None:
    button(page, "Stop Simulation").click()
    expect(status(page)).to_contain_text("Simulation stopped")
    wait_for_state(page, "qy-circuit", lambda s: s.get("sim") == "stopped", "simulation stops")


def wait_gone(locator: Locator, what: str) -> None:
    deadline = time.monotonic() + UI_S
    while time.monotonic() < deadline:
        if gone(locator):
            return
    pytest.fail(what)


def test_wf_w07_circuit_overcurrent_keyboard_burnout(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=circuit") as page:
        bat = add_part(page, "Battery", "BAT-1")
        assert bat.evaluate(CONTAINS_FOCUS), "adding a part did not move focus to its group"
        add_part(page, "LED", "LED-1")
        start = terminal(page, "BAT-1", "+")
        start.focus()
        page.keyboard.press("Enter")
        expect(start).to_have_attribute("aria-pressed", "true")
        expect(status(page)).to_contain_text("Wiring from BAT-1 +")
        terminal(page, "LED-1", "+").focus()
        page.keyboard.press("Enter")
        wired_from, wired_to = "BAT-1 +", "LED-1 +"
        expect(status(page)).to_contain_text(f"Wired {wired_from} to {wired_to}")
        wire(page, ("LED-1", MINUS), ("BAT-1", MINUS))
        start_sim(page, app_url)
        wait_component(page, "LED-1", lambda c: c["status"] == "broken", "LED straight off 9 V burns out")
        expect(status(page)).to_contain_text(f"LED-1 burnt out at {led_ma(0):.1f} mA")
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, burnt out")
        stop_sim(page)
        assert component(page, "LED-1")["status"] == "broken"
        button(part_group(page, "LED-1"), "Reset LED").click()
        expect(status(page)).to_contain_text("LED-1 reset")
        wait_component(page, "LED-1", lambda c: c["status"] == "off", "Reset LED makes it off")
        button(page, "Delete wire BAT-1 + to LED-1 +").click()
        expect(wire_items(page)).to_have_count(1)
        add_part(page, "Resistor", "R-1")
        part_group(page, "R-1").get_by_role("textbox", name="Resistance (Ω)").fill(str(NIGHT_OHMS))
        wire(page, ("BAT-1", "+"), ("R-1", "+"))
        wire(page, ("R-1", MINUS), ("LED-1", "+"))
        start_sim(page, app_url)
        lit = f"{led_ma(NIGHT_OHMS):.1f}"
        c = wait_component(page, "LED-1", lambda c: c["status"] == "lit", "LED lights through 330 Ω")
        assert c["current-ma"] == lit and c["brightness"] == brightness(NIGHT_OHMS), c
        expect(status(page)).to_contain_text(f"LED-1 lit at {lit} mA")
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 1")
    project = project_of(kid, "circuit")
    snap = snapshot_at(project["id"], project["revision"])
    parts = {c["label"]: c for c in snap["components"]}
    assert set(parts) == {"BAT-1", "LED-1", "R-1"} and parts["R-1"]["ohms"] == NIGHT_OHMS
    assert wire_set(snap) == wire_set(NIGHT)


def test_wf_w07_circuit_overcurrent_duplicate_wire(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=circuit") as page:
        add_part(page, "Battery", "BAT-1")
        sw_group = add_part(page, "Switch", "SW-1")
        start = terminal(page, "BAT-1", "+")
        start.focus()
        page.keyboard.press("Enter")
        expect(start).to_have_attribute("aria-pressed", "true")
        page.keyboard.press("Escape")
        expect(start).not_to_have_attribute("aria-pressed", "true")
        expect(wire_items(page)).to_have_count(0)
        wire(page, ("BAT-1", "+"), ("SW-1", "+"))
        clear_status(page, app_url)
        terminal(page, "SW-1", "+").focus()
        page.keyboard.press("Enter")
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Enter")
        expect(status(page)).to_contain_text("Those terminals are already wired.")
        expect(wire_items(page)).to_have_count(1)
        expect(sw_group).to_have_accessible_name("SW-1, open")
        switch = sw_group.get_by_role("switch", name="SW-1")
        switch.focus()
        page.keyboard.press("Space")
        expect(switch).to_be_checked()
        expect(sw_group).to_have_accessible_name("SW-1, closed")
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
    project = project_of(kid, "circuit")
    snap = snapshot_at(project["id"], project["revision"])
    assert len(snap["wires"]) == 1
    assert next(c for c in snap["components"] if c["label"] == "SW-1")["closed"] is True


def test_circuit_solver(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    closed_sw = {"label": "SW-1", "type": "switch", "closed": True}
    cases = [
        ("night", night(NIGHT_OHMS), {"LED-1": ("lit", led_ma(NIGHT_OHMS), brightness(NIGHT_OHMS)), "R-1": ("ok", led_ma(NIGHT_OHMS), None)}),
        ("thousand", night(DEFAULT_OHMS), {"LED-1": ("lit", led_ma(DEFAULT_OHMS), brightness(DEFAULT_OHMS))}),
        ("reversed", circuit([BATTERY, resistor(NIGHT_OHMS), LED], [("BAT-1+", "R-1+"), ("R-1-", "LED-1-"), ("LED-1+", "BAT-1-")]),
         {"LED-1": ("off", 0.0, "0.00"), "R-1": ("ok", 0.0, None)}),
        ("open switch", circuit([BATTERY, SWITCH_OPEN, resistor(NIGHT_OHMS), LED],
                                [("BAT-1+", "SW-1+"), ("SW-1-", "R-1+"), ("R-1-", "LED-1+"), ("LED-1-", "BAT-1-")]),
         {"LED-1": ("off", 0.0, "0.00"), "R-1": ("ok", 0.0, None), "SW-1": ("open", 0.0, None)}),
        ("short", circuit([BATTERY, closed_sw], [("BAT-1+", "SW-1+"), ("SW-1-", "BAT-1-")]), {"BAT-1": ("shorted", 0.0, None)}),
    ]
    with opened(browser, app_url, kid.id, "/class") as page:
        for name, snap, want in cases:
            pid = make_project(kid, "circuit", f"Solver {name}", snap)["id"]
            page.goto(f"{app_url}/editor/{pid}")
            s = wait_for_state(page, "qy-circuit", lambda s, n=len(snap["components"]): s.get("sim") == "stopped" and len(s["items"]) == n,
                               f"{name}: circuit loads stopped")
            assert all(c["current-ma"] == "0.0" for c in s["items"]), f"{name}: stopped circuit carries current {s}"
            start_sim(page, app_url)
            for label, (st, ma, br) in want.items():
                c = wait_component(page, label, lambda c, st=st: c["status"] == st, f"{name}: {label} should be {st}")
                assert c["current-ma"] == f"{ma:.1f}", (name, c)
                if br is not None:
                    assert float(c["brightness"]) == float(br), (name, c)
            if name == "night":
                lit = f"{led_ma(NIGHT_OHMS):.1f}"
                expect(status(page)).to_contain_text(f"LED-1 lit at {lit} mA")
                expect(part_group(page, "LED-1")).to_have_accessible_name(f"LED-1, lit {lit} mA")
            if name == "short":
                expect(status(page)).to_contain_text("BAT-1 is short-circuited")
                expect(part_group(page, "BAT-1")).to_have_accessible_name("BAT-1, short-circuited")
            stop_sim(page)
            s = state(page, "qy-circuit")
            assert all(c["current-ma"] == "0.0" for c in s["items"]) and component(page, "LED-1") in (None,) + tuple(
                c for c in s["items"] if c.get("component") == "LED-1" and c["status"] == "off"), f"{name}: stopped readouts {s}"
        burn = circuit([BATTERY, LED], [("BAT-1+", "LED-1+"), ("LED-1-", "BAT-1-")])
        pid = make_project(kid, "circuit", "Solver burn", burn)["id"]
        page.goto(f"{app_url}/editor/{pid}")
        start_sim(page, app_url)
        wait_component(page, "LED-1", lambda c: c["status"] == "broken", "280 mA burns the LED out")
        stop_sim(page)
        assert component(page, "LED-1")["status"] == "broken"
        start_sim(page, app_url)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "broken", "a broken LED stays broken")
        assert c["current-ma"] == "0.0" and component(page, "BAT-1")["current-ma"] == "0.0"


def test_wf_w08_live_readout_two_tabs_live_resistance(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "circuit", "Night Light", night(DEFAULT_OHMS))["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        start_sim(page, app_url)
        slow = f"{led_ma(DEFAULT_OHMS):.1f}"
        wait_component(page, "LED-1", lambda c: c["status"] == "lit" and c["current-ma"] == slow, "lit at 6.8 mA")
        ohms = part_group(page, "R-1").get_by_role("textbox", name="Resistance (Ω)")
        ohms.fill("0")
        expect(ohms).to_have_accessible_description(re.compile(re.escape("Enter a resistance from 1 to 10000000 Ω.")))
        tick(page, app_url, 1)
        assert component(page, "LED-1")["current-ma"] == slow
        volts = part_group(page, "BAT-1").get_by_role("textbox", name="Voltage (V)")
        volts.fill("13")
        expect(volts).to_have_accessible_description(re.compile(re.escape("Enter a voltage from 1 to 12 V.")))
        volts.fill(str(VOLTS))
        clear_status(page, app_url)
        ohms.fill(str(NIGHT_OHMS))
        tick(page, app_url, 1)
        lit = f"{led_ma(NIGHT_OHMS):.1f}"
        c = wait_component(page, "LED-1", lambda c: c["current-ma"] == lit, "readout follows the typed 330 Ω within one tick")
        assert c["status"] == "lit" and c["brightness"] == brightness(NIGHT_OHMS)
        expect(status(page)).to_contain_text(f"LED-1 lit at {lit} mA")
        assert not_reloaded(page), "the page reloaded"
        terminal(page, "BAT-1", "+").focus()
        before = stored_revision(kid, "circuit")
        page.keyboard.press("Control+s")
        saved = wait_saved(page, kid, "circuit", before)
    assert next(c for c in snapshot_at(pid, saved["revision"])["components"] if c["label"] == "R-1")["ohms"] == NIGHT_OHMS


def test_wf_w08_live_readout_two_tabs_two_tabs(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Tabs {tag()}", ONE)["id"]
    stale = "This project changed in another tab. Reload to see the latest version."
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as a, opened(browser, app_url, kid.id, f"/editor/{pid}") as b:
        wp_a, wp_b = workplane(a), workplane(b)
        wait_scene(b, count_is(1), "tab B loads revision 1")
        wp_a.focus()
        a.keyboard.press("b")
        a.keyboard.press("Control+s")
        expect(status(a)).to_contain_text("Saved revision 2")
        wait_for_state(b, "qy-scene", count_is(2), "tab B loads revision 2 in place", seconds=LIVE_MS / 1000)
        wp_b.focus()
        b.keyboard.press("s")
        wait_scene(b, count_is(3), "tab B has an unsaved edit")
        wp_a.focus()
        a.keyboard.press("c")
        a.keyboard.press("Control+s")
        expect(status(a)).to_contain_text("Saved revision 3")
        wp_b.focus()
        b.keyboard.press("Control+s")
        expect(notice(b)).to_contain_text(stale)
        expect(status(b)).to_contain_text(stale)
        assert revision_keys(pid) == expected_revisions(pid, 3)
        assert sorted(o["kind"] for o in snapshot_at(pid, 3)["objects"]) == ["box", "box", "cylinder"]
        button(notice(b), "Reload").click()
        s = wait_scene(b, count_is(3), "Reload shows revision 3")
        assert sorted(o["kind"] for o in s["items"]) == ["box", "box", "cylinder"]


def test_stale_and_concurrent_saves(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Race {tag()}", EMPTY)["id"]
    assert save(kid, pid, 1, ONE).status_code == 200
    body = assert_error(save(kid, pid, 1, TWO), 409, "stale_revision",
                        "This project changed in another tab. Reload to see the latest version.")
    assert body["currentRevision"] == 2
    assert revision_keys(pid) == expected_revisions(pid, 2) and len(snapshot_at(pid, 2)["objects"]) == 1
    barrier = threading.Barrier(RACERS)

    def race(i: int) -> httpx.Response:
        client = api(app_url, kid.client.cookies)
        barrier.wait()
        return client.put(f"/api/projects/{pid}", json={"baseRevision": 2, "snapshot": design([shape(f"r{i}")])})

    with concurrent.futures.ThreadPoolExecutor(RACERS) as pool:
        results = list(pool.map(race, range(RACERS)))
    winners = [i for i, r in enumerate(results) if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in results]
    for i, r in enumerate(results):
        if i not in winners:
            assert_error(r, 409, "stale_revision")
    assert results[winners[0]].json()["project"]["revision"] == 3
    assert revision_keys(pid) == expected_revisions(pid, 3)
    assert snapshot_at(pid, 3)["objects"][0]["id"] == f"r{winners[0]}"


def blocks_state(page: Page, pred: Callable[[dict], bool], what: str) -> dict:
    return wait_for_state(page, "qy-blocks-scene", pred, what)


FOCUS_BLOCK_JS = """el => {
  const own = n => !n.parentElement.closest('ul, ol, [role="list"]') || n.parentElement.closest('ul, ol, [role="list"]') === el.parentElement.closest('ul, ol, [role="list"]') || el.contains(n) && !n.closest('ul, ol, [role="list"]') .parentElement.closest('li') || true;
  const nested = n => { const l = n.closest('ul, ol, [role="list"]'); return l && el.contains(l); };
  let target = el.hasAttribute('tabindex') ? el : null;
  if (!target) {
    const pools = ['[tabindex]', 'button', 'input, textarea, select, a[href]'];
    for (const q of pools) {
      target = Array.from(el.querySelectorAll(q)).find(n => !nested(n) && !n.disabled) || null;
      if (target) break;
    }
  }
  if (!target) return false;
  target.focus();
  return el.contains(document.activeElement);
}"""


def focus_block(block: Locator) -> None:
    assert block.evaluate(FOCUS_BLOCK_JS), "no focusable element inside the Program block; ArrowUp/ArrowDown need focus on blocks"


def test_wf_w09_block_lab_loop_keyboard_tower(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=blocks") as page:
        palette = page.get_by_role("toolbar", name="Blocks palette")
        program = page.get_by_role("list", name="Program")
        button(palette, "Repeat").focus()
        page.keyboard.press("Enter")
        expect(program.get_by_role("listitem")).to_have_count(1)
        focus_block(program.get_by_role("listitem").first)
        page.keyboard.press("ArrowRight")
        for name in ("Add Sphere", "Move Z by"):
            button(palette, name).focus()
            page.keyboard.press("Enter")
        body = program.get_by_role("list", name="Repeat body")
        expect(body.get_by_role("listitem")).to_have_count(2)
        expect(page.get_by_role("textbox", name="Repeat count")).to_have_value("3")
        expect(page.get_by_role("textbox", name="Move Z by (mm)")).to_have_value("10")
        play = button(page, "Play")
        play.focus()
        page.keyboard.press("Enter")
        advance(page, config(app_url)["blocksStepMs"] * (6 + 1))
        s = blocks_state(page, lambda s: s.get("state") == "done", "program finishes")
        assert s["sphere-count"] == "3" and s["mesh-count"] == "3"
        expect(status(page)).to_contain_text("Program finished: 3 objects")
        play.focus()
        before = stored_revision(kid, "blocks")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
        wait_saved(page, kid, "blocks", before)
    project = project_of(kid, "blocks")
    snap = snapshot_at(project["id"], project["revision"])
    repeat = snap["program"][0]
    assert repeat["block"] == "repeat" and repeat["count"] == 3
    assert [b["block"] for b in repeat["body"]] == ["addSphere", "moveZ"]
    assert sorted(o["z"] for o in snap["objects"]) == [0, 10, 20]


def test_wf_w09_block_lab_loop_step_limit(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    moves = [{"block": "moveX", "mm": 10}] * 11
    snap = {"kind": "blocks", "program": [{"block": "addBox"}, {"block": "repeat", "count": REPEAT_MAX, "body": moves}], "objects": []}
    pid = make_project(kid, "blocks", f"Long {tag()}", snap)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}", reduced_motion="reduce") as page:
        play = button(page, "Play")
        play.click()
        s = blocks_state(page, lambda s: s.get("state") == "done", "long program ends")
        assert s["step"] == str(STEP_LIMIT) and s["mesh-count"] == "1"
        expect(status(page)).to_contain_text("Program stopped after 500 steps.")
        play.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    assert len(snapshot_at(pid, 2)["objects"]) == 1


def test_block_lab_run(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "blocks", "Sphere Tower", {**tower_snapshot(), "objects": []})["id"]
    step = config(app_url)["blocksStepMs"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        play = button(page, "Play")
        play.click()
        advance(page, step / 2)
        s = blocks_state(page, lambda s: s.get("state") == "running", "Play starts a run")
        assert s["step"] == "0"
        expect(button(page.get_by_role("toolbar", name="Blocks palette"), "Add Box")).to_be_disabled()
        for n, meshes in ((1, 1), (2, 1), (3, 2)):
            advance(page, step if n > 1 else step / 2)
            blocks_state(page, lambda s, n=n, m=meshes: s["step"] == str(n) and s["mesh-count"] == str(m), f"step {n} gives {meshes} objects")
        advance(page, step * 4)
        s = blocks_state(page, lambda s: s.get("state") == "done", "run finishes after 6 steps")
        assert s["step"] == "6" and s["sphere-count"] == "3"
        assert sorted(xyz(o)[2] for o in s["items"]) == [0, 10, 20]
        expect(status(page)).to_contain_text("Program finished: 3 objects")
        play.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
        play.click()
        advance(page, step)
        blocks_state(page, lambda s: s["step"] == "1", "second run takes one step")
        button(page, "Stop").click()
        blocks_state(page, lambda s: s.get("state") == "done", "Stop ends the run")
        expect(status(page)).to_contain_text("Program stopped")
        advance(page, step * 3)
        assert state(page, "qy-blocks-scene")["step"] == "1"
    objs = snapshot_at(pid, 2)["objects"]
    assert sorted(o["z"] for o in objs) == [0, 10, 20] and {o["kind"] for o in objs} == {"sphere"}


def own_exports(person: Person) -> list[dict]:
    r = person.client.get("/api/exports")
    assert r.status_code == 200, r.text
    return r.json()["exports"]


def test_wf_w10_export_worker_stl_inches(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    dims = (GEAR_MM, GEAR_MM, SHAPE_MM)
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        workplane(page)
        opener = button(page, "Export")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Export")
        expect(dialog.get_by_role("radio", name="STL", exact=True)).to_be_checked()
        expect(dialog.get_by_role("radio", name="Millimetres", exact=True)).to_be_checked()
        expect(dialog).to_contain_text(size_line(dims, "mm"))
        pick_radio(dialog.get_by_role("radio", name="Inches", exact=True))
        expect(dialog).to_contain_text(size_line(dims, "in"))
        with page.expect_download() as download:
            button(dialog, "Download").click()
        data = Path(download.value.path()).read_bytes()
        expect(status(page)).to_contain_text("Exported gear-box.stl (inches)")
        expect(status(page)).to_contain_text("Saved to your library")
        advance(page, DIALOG_SETTLE_MS)
        expect(opener).to_be_focused()
    tris = stl_triangles(data)
    assert closed(tris), "exported STL is not a closed mesh"
    for got, mm in zip(extents(tris), dims):
        assert abs(got - mm / INCH_MM) <= mm / INCH_MM * FLOAT32_REL * 4, (got, mm)
    exp = next(e for e in own_exports(kid) if e["fileName"] == "gear-box.stl")
    assert (exp["format"], exp["unit"], exp["triangleCount"], exp["bytes"]) == ("stl", "in", len(tris), len(data))
    assert S3().get(f"exports/{kid.id}/{exp['id']}/gear-box.stl") == data


def test_wf_w10_export_worker_circuit_svg(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "circuit", "Night Light", NIGHT)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        expect(part_group(page, "BAT-1")).to_be_visible()
        button(page, "Export").click()
        dialog = page.get_by_role("dialog", name="Export")
        expect(dialog.get_by_role("radio", name="SVG", exact=True)).to_be_checked()
        expect(dialog.get_by_role("radio", name="Millimetres", exact=True)).to_be_checked()
        for name in ("STL", "OBJ", "Inches"):
            expect(dialog.get_by_role("radio", name=name, exact=True)).to_be_disabled()
        expect(dialog).to_contain_text("Size: wiring diagram, 297 × 210 mm page")
        with page.expect_download() as download:
            button(dialog, "Download").click()
        data = Path(download.value.path()).read_bytes()
        svg_file = "Night Light".lower().replace(" ", "-") + ".svg"
        expect(status(page)).to_contain_text(f"Exported {svg_file} (millimetres)")
    root = ET.fromstring(data)
    assert (root.get("width"), root.get("height")) == ("297mm", "210mm")
    exp = next(e for e in own_exports(kid) if e["fileName"] == "night-light.svg")
    assert exp["format"] == "svg" and exp["unit"] == "mm" and exp["bbox"] is None and exp["triangleCount"] is None
    assert S3().get(f"exports/{kid.id}/{exp['id']}/night-light.svg") == data


def test_wf_w10_export_worker_nothing_to_export(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    cases = [("3d", EMPTY, "Add a solid shape before exporting."),
             ("3d", design([shape("h", mode="hole")]), "Add a solid shape before exporting."),
             ("circuit", circuit([], []), "Add a component before exporting.")]
    with opened(browser, app_url, kid.id, "/class") as page:
        for i, (kind, snap, copy) in enumerate(cases):
            pid = make_project(kid, kind, f"Empty {i}", snap)["id"]
            page.goto(f"{app_url}/editor/{pid}")
            opener = button(page, "Export")
            opener.click()
            dialog = page.get_by_role("dialog", name="Export")
            expect(dialog).to_contain_text(copy)
            expect(button(dialog, "Download")).to_be_disabled()
            page.keyboard.press("Escape")
            advance(page, DIALOG_SETTLE_MS)
            expect(opener).to_be_focused()
    assert own_exports(kid) == []
    assert S3().keys(f"exports/{kid.id}/") == []


def test_export_files(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        workers: list[str] = []
        page.on("worker", lambda w: workers.append(w.url))
        workplane(page)
        button(page, "Export").click()
        dialog = page.get_by_role("dialog", name="Export")
        pick_radio(dialog.get_by_role("radio", name="OBJ", exact=True))
        with held(page, "**/api/exports**") as gate:
            button(dialog, "Download").click()
            expect(status(page)).to_contain_text(f"Preparing {GEAR_OBJ}…")
            wait_for_state(page, "qy-export", lambda s: s.get("state") == "working", "export is working while storage is pending")
            assert S3().keys(f"exports/{kid.id}/") == [], "file stored before the upload was let through"
            assert own_exports(kid) == []
            with page.expect_download() as download:
                gate.release()
        data = Path(download.value.path()).read_bytes()
        assert workers or page.workers, "the export was built without a Web Worker"
    objects, _vertices, faces = obj_mesh(data)
    assert objects == 1 and faces and closed(faces), "OBJ is not one closed object"
    verts = [tuple(map(float, line.split()[1:4])) for line in data.decode().splitlines() if line.startswith("v ")]
    for i, mm in enumerate((GEAR_MM, GEAR_MM, SHAPE_MM)):
        assert abs(max(v[i] for v in verts) - min(v[i] for v in verts) - mm) <= mm * FLOAT32_REL * 4
    exp = next(e for e in own_exports(kid) if e["fileName"] == "gear-box.obj")
    assert exp["bytes"] == len(data) and S3().get(f"exports/{kid.id}/{exp['id']}/gear-box.obj") == data
    part = make_project(kid, "3d", "Tetra Part", ONE)["id"]
    tetra = tetra_stl()
    r = upload(kid, tetra, "stl", "mm", "tetra-part.stl", part)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["triangleCount"] == 4 and body["bytes"] == len(tetra) and body["downloadUrl"] == f"/api/exports/{body['id']}/download"
    assert S3().get(f"exports/{kid.id}/{body['id']}/tetra-part.stl") == tetra
    dl = kid.client.get(body["downloadUrl"])
    assert dl.status_code == 200 and dl.content == tetra
    assert dl.headers["content-type"].startswith("model/stl")
    assert f'filename="{TETRA_FILE}"' in dl.headers.get("content-disposition", "")
    assert_error(upload(kid, tetra_stl(faces=3), "stl", "mm", "tetra-part.stl", part), 422, "mesh_not_closed",
                 "Export failed: the mesh is not closed.")
    assert_error(upload(kid, tetra_stl(extra=b"xx"), "stl", "mm", "tetra-part.stl", part), 422, "validation")
    assert_error(upload(kid, tetra, "stl", "mm", "tetra-part.obj", part), 422, "validation")
    assert [e["fileName"] for e in own_exports(kid)].count("tetra-part.stl") == 1


def test_hand_in_files(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Tetra Part", ONE)["id"]
    tetra = tetra_stl()
    r = upload(kid, tetra, "stl", "mm", "tetra-part.stl", pid)
    assert r.status_code == 201, r.text
    exp = r.json()
    listed = room.owner.client.get(f"/api/classrooms/{room.id}/exports").json()["exports"]
    assert [(e["id"], e["nickname"]) for e in listed] == [(exp["id"], kid.name)]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        files = page.get_by_role("region", name="Hand-in files").get_by_role("list", name="Hand-in files")
        with page.expect_download() as download:
            files.get_by_role("link", name=f"Download {TETRA_FILE}").click()
        assert Path(download.value.path()).read_bytes() == tetra
    outsider = verified(app_url, mail)
    assert_error(outsider.client.get(f"/api/classrooms/{room.id}/exports"), 404, "not_found")
    assert_error(outsider.client.get(exp["downloadUrl"]), 404, "not_found")


def test_wf_w10_export_worker_group_hole_stays_in_group(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    peg_mm = 10.0
    snap = design(GEAR["objects"] + [shape("peg", "cylinder", w=peg_mm, d=peg_mm, h=peg_mm)])
    pid = make_project(kid, "3d", "Pegged Gear", snap)["id"]
    stl_name = "pegged-gear.stl"
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        workplane(page)
        data = export_via_ui(page, "STL", "Millimetres")
        expect(status(page)).to_contain_text(f"Exported {stl_name} (millimetres)")
    tris = stl_triangles(data)
    box = GEAR_MM * GEAR_MM * SHAPE_MM
    bore = math.pi * (GEAR_HOLE_MM / 2) ** 2 * SHAPE_MM
    peg = math.pi * (peg_mm / 2) ** 2 * peg_mm
    want = box - bore + peg
    got = abs(stl_volume(tris))
    assert abs(got - want) <= 2.0, f"STL volume {got:.1f} mm³, expected {want:.1f} (Gear Box {box - bore:.1f} + peg {peg:.1f})"


def test_wf_w10_export_worker_hole_group_keeps_its_core(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    slab_mm, slab_h = 60.0, 10.0
    cutter = dict(GEAR["objects"][0], id="cutter", mode="hole")
    snap = design([shape("slab", w=slab_mm, d=slab_mm, h=slab_h), cutter])
    pid = make_project(kid, "3d", "Frame Plate", snap)["id"]
    stl_name = "frame-plate.stl"
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        workplane(page)
        data = export_via_ui(page, "STL", "Millimetres")
        expect(status(page)).to_contain_text(f"Exported {stl_name} (millimetres)")
    tris = stl_triangles(data)
    post = math.pi * (GEAR_HOLE_MM / 2) ** 2 * slab_h
    want = slab_mm * slab_mm * slab_h - GEAR_MM * GEAR_MM * slab_h + post
    got = abs(stl_volume(tris))
    assert abs(got - want) <= 2.0, f"STL volume {got:.1f} mm³, expected {want:.1f} (frame + {post:.1f} mm³ post)"


def assert_box(box: dict, x: float, y: float, w: float, h: float, what: str) -> None:
    got = (box["x"], box["y"], box["width"], box["height"])
    assert all(abs(a - b) <= PX_TOL * 2 for a, b in zip(got, (x, y, w, h))), f"{what}: box {got}, expected {(x, y, w, h)}"


def docked(viewport: dict) -> tuple[float, float, float, float]:
    return (viewport["width"] - GLANCET_EDGE - GLANCET_W, viewport["height"] - GLANCET_EDGE - GLANCET_H, GLANCET_W, GLANCET_H)


def test_wf_w11_glancet_watch_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=GLANCET_ROSTER)
    target, other = room.kids[0], room.kids[1]
    make_project(target, "3d", "Gear Box", GEAR)
    make_project(other, "blocks", "Sphere Tower", tower_snapshot())
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        watch = watch_button(page, target.name)
        watch.focus()
        page.keyboard.press("Enter")
        viewer = glancet(page, target.name)
        expect(viewer).to_be_visible()
        assert viewer.evaluate(CONTAINS_FOCUS), "Glancet did not take focus"
        st = wait_for_state(page, "qy-glancet-state", lambda s: s.get("student") == target.id, "Glancet shows the Student")
        assert st["revision"] == "1" and st["mesh-count"] == "1"
        expect(viewer).to_contain_text("Rev 1")
        page.keyboard.press("F6")
        assert tile(page, target.name).evaluate(CONTAINS_FOCUS), "F6 did not move focus to the opener tile"
        page.keyboard.press("F6")
        assert viewer.evaluate(CONTAINS_FOCUS), "F6 did not move focus back into the viewer"
        watch_button(page, other.name).focus()
        page.keyboard.press("Enter")
        viewer = glancet(page, other.name)
        expect(viewer).to_be_visible()
        expect(page.get_by_role("dialog", name=re.compile(r"^Glancet: "))).to_have_count(1)
        st = wait_for_state(page, "qy-glancet-state", lambda s: s.get("student") == other.id, "Glancet replaced its Student")
        assert st["mesh-count"] == "3"
        settle(viewer)
        assert_box(viewer.bounding_box(), *docked(WIDE), "docked Glancet")
        page.evaluate(f"window.scrollBy(0, {SCROLL_PX})")
        assert_box(viewer.bounding_box(), *docked(WIDE), "Glancet after scrolling the roster")
        scroll = page.evaluate("window.scrollY")
        viewer.focus()
        page.keyboard.press("Escape")
        advance(page, config(app_url)["glancetFadeMs"] + FRAME_MS)
        wait_gone(viewer, "Escape did not close Glancet")
        expect(watch_button(page, other.name)).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll


def test_wf_w11_glancet_live_expand(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        watch = watch_button(page, kid.name)
        watch.click()
        viewer = glancet(page, kid.name)
        wait_for_state(page, "qy-glancet-state", lambda s: s.get("revision") == "1", "Glancet at revision 1")
        assert save(kid, pid, 1, TWO).status_code == 200
        wait_for_state(page, "qy-glancet-state", lambda s: s.get("revision") == "2" and s.get("mesh-count") == "2",
                       "Glancet shows revision 2 live", seconds=LIVE_MS / 1000)
        expect(viewer).to_contain_text("Rev 2")
        expect(tile(page, kid.name)).to_contain_text("Rev 2")
        assert not_reloaded(page), "the page reloaded"
        expand = button(viewer, "Expand viewer")
        expect(expand).to_have_attribute("aria-expanded", "false")
        expand.click()
        expect(expand).to_have_attribute("aria-expanded", "true")
        settle(viewer)
        width = WIDE["width"] * EXPANDED_SHARE
        assert_box(viewer.bounding_box(), (WIDE["width"] - width) / 2, EXPANDED_TOP, width, width * 9 / 16, "expanded Glancet")
        expand.click()
        expect(expand).to_have_attribute("aria-expanded", "false")
        settle(viewer)
        assert_box(viewer.bounding_box(), *docked(WIDE), "shrunk Glancet")
        button(viewer, "Close viewer").click()
        advance(page, config(app_url)["glancetFadeMs"] + FRAME_MS)
        wait_gone(viewer, "Close viewer did not close Glancet")
        expect(watch).to_be_focused()
        page.set_viewport_size(NARROW)
        watch.click()
        expect(button(glancet(page, kid.name), "Expand viewer")).to_be_hidden()


def test_glancet_motion(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    make_project(kid, "3d", "Gear Box", GEAR)
    fade = config(app_url)["glancetFadeMs"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        watch_button(page, kid.name).click()
        viewer = glancet(page, kid.name)
        expect(viewer).to_be_attached()
        assert opacity(viewer) < OPAQUE or animations(viewer), "Glancet appeared at once; expected a fade"
        advance(page, fade + FRAME_MS)
        settle(viewer)
        assert opacity(viewer) >= OPAQUE
        assert "true" in viewer.evaluate(PLAYING_JS)
        start = camera(page)
        advance(page, TURN_MS / 2)
        half = camera(page)
        advance(page, TURN_MS / 2)
        full = camera(page)
        assert not same_matrices(start, half), "the turntable did not turn"
        assert same_matrices(start, full), "the turntable did not complete one turn in 12 seconds"
        button(viewer, "Close viewer").click()
        assert opacity(viewer) > 1 - OPAQUE or animations(viewer), "Glancet vanished at once; expected a fade out"
        advance(page, fade + FRAME_MS)
        wait_gone(viewer, "Glancet did not fade out")
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}", reduced_motion="reduce") as page:
        watch_button(page, kid.name).click()
        viewer = glancet(page, kid.name)
        expect(viewer).to_be_visible()
        assert opacity(viewer) >= OPAQUE, "reduced motion: Glancet faded in"
        expect(button(viewer, "Pause turntable")).to_have_attribute("aria-pressed", "true")
        assert "true" not in viewer.evaluate(PLAYING_JS)
        advance(page, FRAME_MS)
        still = camera(page)
        advance(page, TURN_MS / 4)
        assert same_matrices(still, camera(page)), "reduced motion: the turntable turned"
        button(viewer, "Close viewer").click()
        assert gone(viewer), "reduced motion: Glancet faded out"
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}", viewport=NARROW) as page:
        watch_button(page, kid.name).click()
        viewer = glancet(page, kid.name)
        advance(page, fade)
        settle(viewer)
        assert_box(viewer.bounding_box(), 0, NARROW["height"] - GLANCET_PHONE_H, NARROW["width"], GLANCET_PHONE_H, "phone Glancet")


def test_wf_w12_removal_and_access_student_removed(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=2)
    kid, mate = room.kids
    assistant = verified(app_url, mail)
    add_assistant(room, assistant)
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    mate_pid = make_project(mate, "3d", "Gear Box", ONE)["id"]
    stream = StreamWatch(kid.client)
    copy = f"You were removed from {room.name}."
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, assistant.id, f"/classrooms/{room.id}") as ap, \
            opened(browser, app_url, kid.id, f"/editor/{mate_pid}") as kp:
        expect(kp.get_by_role("heading", name="Project not found")).to_be_visible()
        kp.goto(f"{app_url}/editor/{pid}")
        workplane(kp)
        watch_button(ap, kid.name).click()
        viewer = glancet(ap, kid.name)
        expect(viewer).to_be_visible()
        remove = button(ed, f"Remove {kid.name}")
        remove.focus()
        ed.keyboard.press("Enter")
        dialog = ed.get_by_role("alertdialog", name=f"Remove {kid.name}?")
        button(dialog, "Remove from classroom").focus()
        ed.keyboard.press("Enter")
        advance(ed, DIALOG_SETTLE_MS)
        expect(status(ed)).to_contain_text(f"Removed {kid.name}")
        expect(tile(ed, kid.name)).to_have_count(0)
        expect(watch_button(ed, mate.name)).to_be_focused()
        expect(notice(kp)).to_contain_text(copy, timeout=LIVE_MS)
        expect(status(ap)).to_contain_text(f"{kid.name} was removed from {room.name}.", timeout=LIVE_MS)
        advance(ap, config(app_url)["glancetFadeMs"] + FRAME_MS)
        wait_gone(viewer, "Glancet stayed open on a removed Student")
    assert stream.wait_closed(), "the removed Student's live stream stayed open"
    assert_error(save(kid, pid, 1, ONE), 401, "removed", copy)
    assert revision_keys(pid) == []
    assert [s["nickname"] for s in room.get()["students"]] == [mate.name]
    assert revision_keys(mate_pid) == expected_revisions(mate_pid, 1)
    join(app_url, room.data["joinCode"], kid.name)


def test_wf_w12_removal_and_access_assistant_removed(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    assistant = verified(app_url, mail)
    add_assistant(room, assistant)
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    stream = StreamWatch(assistant.client)
    copy = f"You were removed from {room.name}."
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, assistant.id, f"/classrooms/{room.id}") as ap:
        watch_button(ap, kid.name).click()
        viewer = glancet(ap, kid.name)
        expect(viewer).to_be_visible()
        remove = button(ed, f"Remove {assistant.name}")
        remove.focus()
        ed.keyboard.press("Enter")
        dialog = ed.get_by_role("alertdialog", name=f"Remove {assistant.name}?")
        button(dialog, "Remove from classroom").focus()
        ed.keyboard.press("Enter")
        advance(ed, DIALOG_SETTLE_MS)
        expect(ed.get_by_role("textbox", name="Assistant's email")).to_be_focused()
        expect(status(ap)).to_contain_text(copy, timeout=LIVE_MS)
        advance(ap, config(app_url)["glancetFadeMs"] + FRAME_MS)
        wait_gone(viewer, "the removed Assistant's Glancet stayed open")
    assert stream.wait_closed(), "the removed Assistant's live stream stayed open"
    assert_error(assistant.client.get(f"/api/classrooms/{room.id}"), 404, "not_found")
    assert_error(assistant.client.get(f"/api/projects/{pid}"), 404, "not_found", "Project not found")
    assert assistant.id not in [e["id"] for e in room.get()["educators"]]


def test_project_visibility(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=2)
    owner_kid, classmate = room.kids
    pid = make_project(owner_kid, "3d", "Gear Box", GEAR)["id"]
    r = upload(owner_kid, tetra_stl(), "stl", "mm", "gear-box.stl", pid)
    assert r.status_code == 201, r.text
    exp = r.json()
    other = make_room(app_url, mail, kids=1)
    copy = "Project not found"
    for who in (classmate, other.kids[0], other.owner, sign_up(app_url, "personal")):
        assert_error(who.client.get(f"/api/projects/{pid}"), 404, "not_found", copy)
        assert_error(save(who, pid, 1, ONE), 404, "not_found", copy)
        assert_error(who.client.post(f"/api/projects/{pid}/hand-in"), 404, "not_found", copy)
        assert_error(who.client.get(exp["downloadUrl"]), 404, "not_found", copy)
        assert_error(upload(who, tetra_stl(), "stl", "mm", "gear-box.stl", pid), 404, "not_found")
    assert room.owner.client.get(f"/api/projects/{pid}").json()["snapshot"]["objects"][0]["kind"] == "group"
    assert_error(save(room.owner, pid, 1, ONE), 403, "forbidden")
    assert revision_keys(pid) == expected_revisions(pid, 1)
    assert [e["id"] for e in own_exports(owner_kid)] == [exp["id"]]
    with opened(browser, app_url, classmate.id, "/class") as page:
        answers: list[int] = []
        page.on("response", lambda resp: answers.append(resp.status) if f"/api/projects/{pid}" in resp.url else None)
        page.goto(f"{app_url}/editor/{pid}")
        expect(page.get_by_role("heading", name="Project not found")).to_be_visible()
        assert answers and all(code == 404 for code in answers), answers
        assert (state(page, "qy-scene") or {}).get("mesh-count") in (None, "0")


def test_instructor_only_actions(app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=2)
    kid, mate = room.kids
    other = make_room(app_url, mail, kids=1)
    rid = room.id
    before = room.get()
    t = tag()[:6]
    calls = [("GET", f"/api/classrooms/{rid}", None), ("POST", f"/api/classrooms/{rid}/join-code", None),
             ("PATCH", f"/api/classrooms/{rid}/students/{mate.id}", {"nickname": f"Hacked {t}"}),
             ("DELETE", f"/api/classrooms/{rid}/students/{mate.id}", None), ("POST", f"/api/classrooms/{rid}/hand-in", None),
             ("GET", f"/api/classrooms/{rid}/exports", None), ("PATCH", f"/api/classrooms/{rid}", {"handInLocal": FAR_HAND_IN}),
             ("POST", f"/api/classrooms/{rid}/educators", {"email": other.owner.email})]
    outsiders = (other.kids[0], other.owner, sign_up(app_url, "personal"))
    for method, path, body in calls:
        assert_error(kid.client.request(method, path, json=body), 403, "forbidden", "Only this classroom's instructors can do that.")
        for who in outsiders:
            assert_error(who.client.request(method, path, json=body), 404, "not_found")
    after = room.get()
    assert after["joinCode"] == before["joinCode"] and after["state"] == before["state"] == "open"
    assert after["handInAt"] == before["handInAt"]
    assert sorted(s["nickname"] for s in after["students"]) == sorted([kid.name, mate.name])
    assert [e["id"] for e in after["educators"]] == [e["id"] for e in before["educators"]]


def test_assistant_instructors(browser: Browser, app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    room = make_room(app_url, mail, kids=0, owner=owner)
    second = create_classroom(owner)
    assistant = verified(app_url, mail)
    unverified = sign_up(app_url, "educator")
    with opened(browser, app_url, owner.id, f"/classrooms/{room.id}") as page:
        instructors = page.get_by_role("region", name="Instructors")
        box = instructors.get_by_role("textbox", name="Assistant's email")
        box.fill(assistant.email)
        button(instructors, "Add assistant").click()
        expect(status(page)).to_contain_text(f"Added {assistant.name}")
        expect(instructors.get_by_role("list", name="Instructors")).to_contain_text(assistant.name)
        box.fill(assistant.email)
        button(instructors, "Add assistant").click()
        expect(box).to_have_accessible_description(re.compile(re.escape("That instructor is already in this classroom.")))
    path = f"/api/classrooms/{room.id}/educators"
    assert_error(owner.client.post(path, json={"email": assistant.email}), 409, "already_added")
    for email in (unverified.email, f"nobody-{tag()}@hollowbrook.test"):
        assert_error(owner.client.post(path, json={"email": email}), 422, "no_such_educator",
                     "No verified Educator account uses that email.")
    mine = assistant.client.get("/api/classrooms").json()["classrooms"]
    assert [(c["id"], c["role"]) for c in mine] == [(room.id, "assistant")]
    assert_error(assistant.client.get(f"/api/classrooms/{second['id']}"), 404, "not_found")
    assert assistant.client.post(f"/api/classrooms/{room.id}/join-code").status_code == 200
    assert_error(assistant.client.patch(f"/api/classrooms/{room.id}", json={"handInLocal": FAR_HAND_IN}), 403, "forbidden")
    assert_error(assistant.client.post(f"/api/classrooms/{room.id}/archive"), 403, "forbidden")
    assert_error(assistant.client.post(path, json={"email": owner.email}), 403, "forbidden")
    assert_error(assistant.client.delete(f"{path}/{owner.id}"), 403, "forbidden")
    assert_error(owner.client.delete(f"{path}/{owner.id}"), 409, "owner_cannot_leave", "The classroom owner can't be removed.")
    assert owner.client.delete(f"{path}/{assistant.id}").status_code == 204
    assert_error(assistant.client.get(f"/api/classrooms/{room.id}"), 404, "not_found")
    assert assistant.client.get("/api/classrooms").json()["classrooms"] == []


def tokens_for(mail: Mailpit, email: str, count: int) -> list[str]:
    return [token_of(m) for m in mails_for(mail, email, count)]


def test_wf_w13_personal_signup_verification_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    t = tag()
    email = f"priya-{t}@makers.test"
    with opened(browser, app_url, None, "/signup") as page:
        page.get_by_role("textbox", name="Name").fill(f"Priya {t}")
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill(f"orbit-glue-{t}")
        pick_radio(page.get_by_role("radiogroup", name="Account type").get_by_role("radio", name="Personal maker"))
        button(page, "Create account").click()
        expect(notice(page)).to_contain_text(f"Check your inbox at {email} to verify your account.")
        expect(button(notice(page), "Resend verification email")).to_be_visible()
        message = mails_for(mail, email)[0]
        assert message.get("Subject") == "Verify your Quarkyard email"
        assert addresses(message.get("From")) == [mail_from_address()]
        body = text(message)
        token = token_of(message)
        assert re.search(rf"^\S*/verify\?token={re.escape(token)}\s*$", body, re.M), body
        expiry = EXPIRY_RE.search(body)
        assert expiry, body
        assert abs(parse_instant(expiry.group(1)) - (server_now(app_url) + timedelta(seconds=VERIFY_TTL_S))) <= timedelta(minutes=5)
        page.goto(f"{app_url}/editor/new?kind=3d")
        workplane(page).focus()
        page.keyboard.press("b")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Verify your email to save projects.")
        assert page.request.get(f"{app_url}/api/projects").json()["projects"] == []
        page.goto(f"{app_url}/verify?token={token}")
        expect(page.get_by_role("heading", name="Email verified. You can save projects now.")).to_be_visible()
        page.goto(f"{app_url}/editor/new?kind=3d")
        workplane(page).focus()
        page.keyboard.press("b")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 1")
        projects = page.request.get(f"{app_url}/api/projects").json()["projects"]
    assert len(projects) == 1 and projects[0]["revision"] == 1
    assert revision_keys(projects[0]["id"]) == expected_revisions(projects[0]["id"], 1)


def test_wf_w13_personal_signup_verification_expiry_resend(app_url: str, mail: Mailpit) -> None:
    person = sign_up(app_url, "personal")
    first = tokens_for(mail, person.email, 1)[0]
    expired = "This verification link has expired or was replaced. Send a new one from your account."
    with grading_clock(app_url):
        start = server_now(app_url)
        r = person.client.post("/api/auth/resend-verification")
        body = assert_error(r, 429, "rate_limited", "Wait a minute before sending another email.")
        assert 1 <= body["retryAfterSeconds"] <= RESEND_WINDOW_S and r.headers.get("Retry-After")
        assert len(mails_for(mail, person.email, 1)) == 1
        set_clock(app_url, start + timedelta(seconds=RESEND_WINDOW_S + 1))
        r = person.client.post("/api/auth/resend-verification")
        assert r.status_code == 202 and r.json()["sentTo"] == person.email, r.text
        second = next(tk for tk in tokens_for(mail, person.email, 2) if tk != first)
        assert_error(person.client.post("/api/auth/verify", json={"token": first}), 410, "link_expired", expired)
        sent = set_clock(app_url, start + timedelta(seconds=RESEND_WINDOW_S * 3))
        assert person.client.post("/api/auth/resend-verification").status_code == 202
        third = next(tk for tk in tokens_for(mail, person.email, 3) if tk not in (first, second))
        set_clock(app_url, sent + timedelta(seconds=VERIFY_TTL_S) + EXPIRY_SLACK)
        assert_error(person.client.post("/api/auth/verify", json={"token": third}), 410, "link_expired", expired)
        assert_error(person.client.post("/api/auth/verify", json={"token": second}), 410, "link_expired")
        assert person.client.post("/api/auth/resend-verification").status_code == 202
        fourth = next(tk for tk in tokens_for(mail, person.email, 4) if tk not in (first, second, third))
        r = person.client.post("/api/auth/verify", json={"token": fourth})
        assert r.status_code == 200 and r.json()["account"]["emailVerified"] is True, r.text
        set_clock(app_url, sent + timedelta(seconds=VERIFY_TTL_S) + EXPIRY_SLACK + timedelta(seconds=RESEND_WINDOW_S + 1))
        assert_error(person.client.post("/api/auth/resend-verification"), 409, "already_verified", "Your email is already verified.")


def session_cookie(page: Page) -> str | None:
    return next((c["value"] for c in page.context.cookies() if c["name"] == "qy_session"), None)


def test_unverified_and_pending_sessions(browser: Browser, app_url: str, mail: Mailpit) -> None:
    ed = sign_up(app_url, "educator")
    t = tag()
    assert_error(ed.client.post("/api/classrooms", json={"name": f"Space Camp {t}", "timeZone": CHICAGO}), 403,
                 "email_unverified", "Verify your email to create classrooms.")
    assert_error(ed.client.post("/api/projects", json={"kind": "3d", "name": f"Part {t}", "snapshot": ONE}), 403, "email_unverified")
    assert_error(upload(ed, tetra_stl(), "stl", "mm", f"part-{t}.stl"), 403, "email_unverified", "Verify your email to export files.")
    assert db_hits(Postgres(), t) == []
    assert S3().keys(f"exports/{ed.id}/") == []
    room = make_room(app_url, mail, kids=1)
    make_project(room.kids[0], "3d", "Gear Box", ONE)
    with opened(browser, app_url, None, "/join") as page:
        r = page.request.post(f"{app_url}/api/join/code", data={"code": room.data["joinCode"]})
        assert r.status == 200, r.text()
        pending = session_cookie(page)
        assert pending
        for path in ("/api/projects", "/api/class", "/api/exports", "/api/classrooms", f"/api/classrooms/{room.id}"):
            resp = page.request.get(f"{app_url}{path}")
            assert resp.status == 401 and resp.json()["error"] == "signed_out", (path, resp.status)
        view = page.request.get(f"{app_url}/api/session").json()
        assert view["account"] is None and view["pendingJoin"]["classroomName"] == room.name
        for path in ("/editor/new?kind=3d", "/class"):
            page.goto(f"{app_url}{path}")
            expect(page).to_have_url(re.compile(r"/join$"))
            assert state(page, "qy-scene") is None
        r = page.request.post(f"{app_url}/api/join/nickname", data={"nickname": f"Kid {t[:6]}"})
        assert r.status == 201, r.text()
        assert session_cookie(page) not in (None, pending), "nickname confirmation kept the pending cookie"
        page.goto(f"{app_url}/class")
        expect(page).to_have_url(re.compile(r"/class$"))


def test_storage_outage(browser: Browser, mail: Mailpit) -> None:
    assert OUTAGE_URL, "APP_MINIO_DOWN_URL is not set"
    assert httpx.get(f"{OUTAGE_URL}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "unavailable"}
    r = httpx.post(f"{OUTAGE_URL}/api/grading/seed", headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json()["storageSeeded"] is False, r.text
    seed = r.json()
    dana = seed["educator"]
    gear = next(p for p in seed["projects"] if p["ownerId"] == dana["id"] and p["name"] == "Gear Box")
    c = api(OUTAGE_URL)
    assert c.post("/api/auth/signin", json={"email": dana["email"], "password": dana["password"]}).status_code == 200
    assert_error(c.get(f"/api/projects/{gear['id']}"), 503, "storage_unavailable")
    assert_error(c.put(f"/api/projects/{gear['id']}", json={"baseRevision": 3, "snapshot": ONE}), 503, "storage_unavailable",
                 "Save failed: storage is unavailable. Your design is safe; try again.")
    assert_error(c.post("/api/projects", json={"kind": "3d", "name": OUTAGE_PROJECT, "snapshot": ONE}), 503, "storage_unavailable")
    r = c.post("/api/exports", params={"format": "stl", "unit": "mm", "name": "gear-box.stl", "projectId": gear["id"]},
               content=tetra_stl(), headers={"Content-Type": "application/octet-stream"})
    assert_error(r, 503, "storage_unavailable", "Export failed: storage is unavailable. Your design is safe; try again.")
    listed = {p["name"]: p for p in c.get("/api/projects").json()["projects"]}
    assert listed["Gear Box"]["revision"] == 3 and OUTAGE_PROJECT not in listed
    assert c.get("/api/exports").json()["exports"] == []
    pg = Postgres("_minio_down")
    assert db_hits(pg, OUTAGE_PROJECT) == [] and db_hits(pg, "gear-box.stl") == []
    with opened(browser, OUTAGE_URL, dana["id"], f"/editor/{gear['id']}") as page:
        expect(notice(page)).to_contain_text("Storage is unavailable. Try again in a minute.")
        page.goto(f"{OUTAGE_URL}/editor/new?kind=3d")
        workplane(page).focus()
        page.keyboard.press("b")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Save failed: storage is unavailable. Your design is safe; try again.")
        expect(page.get_by_text("Unsaved changes").first).to_be_visible()
        assert state(page, "qy-scene")["mesh-count"] == "1"


SAVE_ATTEMPTS = 5
SAVE_WAIT_MS = 3000
FRAME_MS = 100
DIALOG_SETTLE_MS = 250
STATE_RECHECK_MS = 5000
UNDO_DEPTH = 100
WHEEL_TURNS = 240
WHEEL_BIG_PX = 2000
DRAG_PX = 40
BLOCK_ACTIONS = 7
RETYPED_OHMS = "220"
KEPT_OHMS = "470"
LOW_VOLTS = 5
HIGH_VOLTS = 12


def test_wf_w02_server_time_hand_in_hand_in_all_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    copy = "This classroom was handed in. Changes are no longer saved."
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, kid.id, "/class") as kp:
        expect(tile(ed, kid.name)).to_be_visible()
        expect(ed.get_by_text("Open for joining", exact=True).first).to_be_visible()
        expect(kp.get_by_text(COUNTDOWN_RE).first).to_be_visible()
        opener = button(ed, "Hand in all projects")
        opener.focus()
        ed.keyboard.press("Enter")
        confirm = ed.get_by_role("alertdialog", name="Hand in all projects?")
        expect(confirm).to_be_visible()
        ed.keyboard.press("Escape")
        advance(ed, DIALOG_SETTLE_MS)
        expect(confirm).to_be_hidden()
        expect(opener).to_be_focused()
        assert room.get()["state"] == "open", "Escape on the hand-in confirmation still handed the classroom in"
        ed.keyboard.press("Enter")
        expect(confirm).to_be_visible()
        button(confirm, "Hand in now").focus()
        ed.keyboard.press("Enter")
        advance(ed, DIALOG_SETTLE_MS)
        expect(ed.get_by_text("Handed in", exact=True).first).to_be_visible()
        expect(tile(ed, kid.name)).to_contain_text("Handed in")
        expect(kp.get_by_text(countdown_text(0)).first).to_be_visible(timeout=STATE_RECHECK_MS + LIVE_MS)
        assert_error(save(kid, pid, 1, ONE), 409, "classroom_handed_in", copy)
        archive = button(ed, "Archive classroom")
        archive.focus()
        ed.keyboard.press("Enter")
        expect(ed.get_by_text("Archived", exact=True).first).to_be_visible()
    data = room.get()
    assert data["state"] == "archived" and data["secondsToHandIn"] == 0, data
    assert [s["handedIn"] for s in data["students"]] == [True]
    assert revision_keys(pid) == expected_revisions(pid, 1)
    assert_error(kid.client.get("/api/class"), 401, "signed_out")


def test_wf_w02_server_time_hand_in_join_window_tablet(browser: Browser, app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    now = server_now(app_url)
    opens = minute(now) + timedelta(hours=1)
    closes, hand = opens + timedelta(hours=1), opens + timedelta(hours=2)
    room = create_classroom(owner, joinOpensLocal=local(opens), joinClosesLocal=local(closes), handInLocal=local(hand))
    assert room["state"] == "draft", room
    nick = f"Red Owl {tag()[:4]}"
    copy = "This class code is not open for joining."
    with counted_failures(owner.client), grading_clock(app_url):
        with opened(browser, app_url, None, "/join", viewport=MEDIUM) as kid:
            kid.clock.set_system_time(opens + timedelta(minutes=30))
            code_box = kid.get_by_role("textbox", name="Class code")
            nick_box = kid.get_by_role("textbox", name="Nickname")
            tap(code_box)
            kid.keyboard.type(room["joinCode"])
            tap(nick_box)
            kid.keyboard.type(nick)
            kid.keyboard.press("Enter")
            expect(code_box).to_have_accessible_description(re.compile(re.escape(copy)))
            expect(status(kid)).to_contain_text(copy)
            expect(kid).to_have_url(re.compile(r"/join$"))
            set_clock(app_url, opens)
            kid.clock.set_system_time(opens - timedelta(days=WRONG_CLOCK_DAYS))
            tap(nick_box)
            kid.keyboard.press("Enter")
            expect(kid).to_have_url(re.compile(r"/class$"))
            expect(status(kid)).to_contain_text(f"Joined {room['name']} as {nick}")
            account = kid.request.get(f"{app_url}/api/session").json()["account"]
    assert account["kind"] == "student" and account["classroomId"] == room["id"], account
    students = owner.client.get(f"/api/classrooms/{room['id']}").json()["students"]
    assert [s["nickname"] for s in students] == [nick]


def test_wf_w04_keyboard_transforms_front_face_rotate(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    front = design([shape("f")], origin=(0, -SHAPE_MM / 2, REST_Z), normal=(0, -1, 0))
    pid = make_project(kid, "3d", f"Front face {tag()}", front)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, lambda s: s.get("workplane-normal") == "0,-1,0", "front-face workplane loads")
        wp.focus()
        page.keyboard.press("Tab")
        wait_scene(page, lambda s: selected(s) == ["f"], "Tab selects the object")
        moves = [("ArrowRight", (1, 0, REST_Z)), ("ArrowUp", (1, 0, 11)), ("Shift+ArrowDown", (1, 0, 1)),
                 ("PageUp", (1, -1, 1)), ("Shift+PageDown", (1, 9, 1))]
        for key, where in moves:
            page.keyboard.press(key)
            wait_scene(page, lambda s, w=where: xyz(item(s, "f")) == w, f"{key} on the front face gives {where}")
        page.keyboard.press("r")
        for key, angle in (("ArrowRight", ROT_STEP), ("Shift+ArrowRight", ROT_STEP + 1)):
            page.keyboard.press(key)
            wait_scene(page, lambda s, a=angle: item(s, "f")["rotation-z"] == str(a), f"rotate {key} gives {angle}")
        s = state(page, "qy-scene")
        assert xyz(item(s, "f")) == (1, 9, 1) and whd(item(s, "f")) == (SHAPE_MM,) * 3, s
        page.keyboard.press("Escape")
        page.keyboard.press("ArrowLeft")
        wait_scene(page, lambda s: xyz(item(s, "f")) == (0, 9, 1) and item(s, "f")["rotation-z"] == str(ROT_STEP + 1),
                   "after Escape the arrows move instead of rotating")
        steps: list[tuple[str, Callable[[dict], bool]]] = [
            ("Control+z", lambda s: xyz(item(s, "f")) == (1, 9, 1) and item(s, "f")["rotation-z"] == str(ROT_STEP + 1)),
            ("Control+z", lambda s: item(s, "f")["rotation-z"] == str(ROT_STEP)),
            ("Control+z", lambda s: item(s, "f")["rotation-z"] == "0" and xyz(item(s, "f")) == (1, 9, 1)),
            ("Control+Shift+Z", lambda s: item(s, "f")["rotation-z"] == str(ROT_STEP)),
            ("Control+y", lambda s: item(s, "f")["rotation-z"] == str(ROT_STEP + 1)),
            ("Control+Shift+Z", lambda s: xyz(item(s, "f")) == (0, 9, 1)),
        ]
        for key, pred in steps:
            page.keyboard.press(key)
            wait_scene(page, pred, f"{key} steps one edit")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    obj = snapshot_at(pid, 2)["objects"][0]
    assert (obj["x"], obj["y"], obj["z"], obj["rotationZ"]) == (0, 9, 1, ROT_STEP + 1), obj
    assert (obj["w"], obj["d"], obj["h"]) == (SHAPE_MM,) * 3


def test_wf_w04_keyboard_transforms_undo_depth(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Depth {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        oid = wait_scene(page, count_is(1), "B adds a box")["items"][0]["object-id"]
        for _ in range(UNDO_DEPTH + 1):
            page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: xyz(item(s, oid))[0] == UNDO_DEPTH + 1, "101 nudges move the box 101 mm")
        for _ in range(UNDO_DEPTH + 5):
            page.keyboard.press("Control+z")
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(item(s, oid)) == (1, 0, REST_Z),
                   "undo stops after 100 steps, one nudge in, with the box kept")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
        page.reload()
        wp = workplane(page)
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(s["items"][0]) == (1, 0, REST_Z), "reload shows the saved box")
        wp.focus()
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+a")
        page.keyboard.press("ArrowUp")
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(s["items"][0]) == (1, 1, REST_Z),
                   "Ctrl+Z after a reload undid nothing; the next nudge starts from the saved box")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 3")
    assert snapshot_at(pid, 2)["objects"][0]["x"] == 1
    obj = snapshot_at(pid, 3)["objects"][0]
    assert (obj["x"], obj["y"], obj["z"]) == (1, 1, REST_Z), obj


def test_wf_w04_keyboard_transforms_group_rotate(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Turn group {tag()}", GEAR)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(1), "the gear group loads")
        wp.focus()
        page.keyboard.press("Tab")
        wait_scene(page, lambda s: selected(s) == ["gear"], "Tab selects the group")
        page.keyboard.press("r")
        page.keyboard.press("ArrowRight")
        s = wait_scene(page, lambda s: item(s, "gear")["rotation-z"] == str(ROT_STEP),
                       "rotate mode turns the selected group by 15 degrees")
        g = item(s, "gear")
        assert (float(g["w"]), float(g["d"]), float(g["h"])) == (GEAR_MM, GEAR_MM, SHAPE_MM), g
        page.keyboard.press("Enter")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    obj = snapshot_at(pid, 2)["objects"][0]
    assert (obj["kind"], obj["rotationZ"]) == ("group", ROT_STEP), obj


def test_wf_w04_keyboard_transforms_noop_not_undo_step(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"No-op {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        oid = wait_scene(page, count_is(1), "B adds a box")["items"][0]["object-id"]
        page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: xyz(item(s, oid)) == (1, 0, REST_Z), "nudge to x 1")
        s = state(page, "qy-scene")
        assert (s["workplane-origin"], s["workplane-normal"]) == ("0,0,0", "0,0,1"), s
        button(page, "Reset workplane").click()
        expect(status(page)).to_contain_text("Workplane reset")
        wp.focus()
        page.keyboard.press("Control+z")
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(item(s, oid)) == (0, 0, REST_Z),
                   "the first Ctrl+Z undoes the nudge, because the no-op reset was no undo step")


def test_wf_w04_keyboard_transforms_undo_not_in_textbox(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Typing {tag()}", EMPTY)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        oid = wait_scene(page, count_is(1), "B adds a box")["items"][0]["object-id"]
        page.keyboard.press("ArrowRight")
        wait_scene(page, lambda s: xyz(item(s, oid)) == (1, 0, REST_Z), "nudge to x 1")
        name = page.get_by_role("textbox", name="Project name", exact=True)
        name.focus()
        page.keyboard.press("End")
        page.keyboard.type(" v2")
        page.keyboard.press("Control+z")
        wp.focus()
        page.keyboard.press("ArrowUp")
        wait_scene(page, lambda s: s["mesh-count"] == "1" and xyz(item(s, oid)) == (1, 1, REST_Z),
                   "Ctrl+Z in the text box left the nudge in place; ArrowUp then moved the box to 1,1")


def test_wf_w05_align_three_on_z(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    tall = 40.0
    stack = design([shape("a"), shape("b", x=30, z=40), shape("c", x=60, z=70, h=tall)])
    pid = make_project(kid, "3d", f"Align Z {tag()}", stack)["id"]
    middle = (0 + (70 + tall / 2)) / 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(3), "three shapes load")
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == ["a", "b", "c"], "Ctrl+A selects all three")
        opener = button(page, "Align")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Align")
        expect(dialog).to_be_visible()
        assert dialog.evaluate(CONTAINS_FOCUS), "opening Align did not move focus into it"
        button(dialog, "Align centers on Z").focus()
        page.keyboard.press("Enter")
        s = wait_scene(page, lambda s: all(xyz(o)[2] == middle for o in s["items"]), "all centres at the bounding-box centre on Z")
        assert [xyz(item(s, i))[:2] for i in ("a", "b", "c")] == [(0, 0), (30, 0), (60, 0)]
        expect(status(page)).to_contain_text("Aligned 3 shapes on Z")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(opener).to_be_focused()
        page.keyboard.press("Control+z")
        wait_scene(page, lambda s: [xyz(item(s, i))[2] for i in ("a", "b", "c")] == [REST_Z, 40, 70], "one undo restores all three")
        button(page, "Redo").click()
        wait_scene(page, lambda s: all(xyz(o)[2] == middle for o in s["items"]), "Redo aligns again")
        wp.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    objs = {o["id"]: o for o in snapshot_at(pid, 2)["objects"]}
    assert [objs[i]["z"] for i in ("a", "b", "c")] == [middle] * 3
    assert [objs[i]["x"] for i in ("a", "b", "c")] == [0, 30, 60]


def test_wf_w05_align_phone_shift_tap(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    side = -30.0
    pair = design([shape("a"), shape("b", x=AWAY_MM, y=side)])
    pid = make_project(kid, "3d", f"Align Y {tag()}", pair)["id"]
    middle = (SHAPE_MM / 2 + (side - SHAPE_MM / 2)) / 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}", viewport=NARROW) as page:
        wp = workplane(page)
        wait_scene(page, count_is(2), "two shapes load")
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == ["a", "b"], "Ctrl+A selects both")
        page.keyboard.down("Shift")
        tap(wp)
        page.keyboard.up("Shift")
        wait_scene(page, lambda s: selected(s) == ["b"], "Shift+tap removes the box under the finger")
        page.keyboard.down("Shift")
        tap(wp)
        page.keyboard.up("Shift")
        wait_scene(page, lambda s: sorted(selected(s)) == ["a", "b"], "Shift+tap adds it back")
        wp.focus()
        page.keyboard.press("l")
        dialog = page.get_by_role("dialog", name="Align")
        expect(dialog).to_be_visible()
        tap(button(dialog, "Align centers on Y"))
        s = wait_scene(page, lambda s: all(xyz(o)[1] == middle for o in s["items"]), "both centres at the bounding-box centre on Y")
        assert [xyz(item(s, i))[0] for i in ("a", "b")] == [0, AWAY_MM]
        expect(status(page)).to_contain_text("Aligned 2 shapes on Y")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        wp.focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    assert [o["y"] for o in snapshot_at(pid, 2)["objects"]] == [middle, middle]


def test_wf_w05_align_toolbar_shortcuts(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    ys = (0.0, SHAPE_MM * 2, SHAPE_MM * 5)
    trio = design([shape(f"a{i}", x=SHAPE_MM * 2 * i, y=y) for i, y in enumerate(ys)])
    ids = [o["id"] for o in trio["objects"]]
    pid = make_project(kid, "3d", f"Align bar {tag()}", trio)["id"]
    middle = ((min(ys) - SHAPE_MM / 2) + (max(ys) + SHAPE_MM / 2)) / 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        workplane(page)
        wait_scene(page, count_is(3), "three shapes load")
        opener = button(page, "Export")
        opener.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == sorted(ids), "Ctrl+A from the Export button selects all three")
        page.keyboard.press("l")
        dialog = page.get_by_role("dialog", name="Align")
        expect(dialog).to_be_visible()
        assert dialog.evaluate(CONTAINS_FOCUS), "opening Align did not move focus into it"
        button(dialog, "Align centers on Y").focus()
        page.keyboard.press("Enter")
        s = wait_scene(page, lambda s: all(xyz(o)[1] == middle for o in s["items"]), "all centres at the bounding-box centre on Y")
        assert [xyz(item(s, i))[0] for i in ids] == [SHAPE_MM * 2 * i for i in range(len(ids))]
        expect(status(page)).to_contain_text("Aligned 3 shapes on Y")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(opener).to_be_focused()


def test_wf_w05_align_noop_not_undo_step(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Align twice {tag()}", TWO)["id"]
    middle = (-SHAPE_MM / 2 + (SHAPE_MM * 2 + SHAPE_MM / 2)) / 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(2), "two shapes load")
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == ["a", "b"], "Ctrl+A selects both")
        dialog = page.get_by_role("dialog", name="Align")
        for round_ in ("first", "second"):
            page.keyboard.press("l")
            expect(dialog).to_be_visible()
            button(dialog, "Align centers on X").focus()
            page.keyboard.press("Enter")
            wait_scene(page, lambda s: [xyz(item(s, i))[0] for i in ("a", "b")] == [middle, middle],
                       f"{round_} align leaves both centres at x {middle}")
            expect(status(page)).to_contain_text("Aligned 2 shapes on X")
            if dialog.is_visible():
                page.keyboard.press("Escape")
            advance(page, DIALOG_SETTLE_MS)
            expect(wp).to_be_focused()
        page.keyboard.press("Control+z")
        wait_scene(page, lambda s: [xyz(item(s, i))[0] for i in ("a", "b")] == [0, SHAPE_MM * 2],
                   "one Ctrl+Z restores x 0 and 40: the second, no-op align was no undo step")


def test_wf_w05_align_undo_not_in_textbox(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Align typing {tag()}", TWO)["id"]
    middle = (-SHAPE_MM / 2 + (SHAPE_MM * 2 + SHAPE_MM / 2)) / 2
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(2), "two shapes load")
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: sorted(selected(s)) == ["a", "b"], "Ctrl+A selects both")
        page.keyboard.press("l")
        dialog = page.get_by_role("dialog", name="Align")
        expect(dialog).to_be_visible()
        button(dialog, "Align centers on X").focus()
        page.keyboard.press("Enter")
        wait_scene(page, lambda s: [xyz(item(s, i))[0] for i in ("a", "b")] == [middle, middle], "aligned on X")
        if dialog.is_visible():
            page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        name = page.get_by_role("textbox", name="Project name", exact=True)
        name.focus()
        page.keyboard.press("End")
        page.keyboard.type(" v2")
        page.keyboard.press("Control+z")
        wp.focus()
        page.keyboard.press("Control+a")
        page.keyboard.press("ArrowUp")
        wait_scene(page, lambda s: [xyz(item(s, i))[:2] for i in ("a", "b")] == [(middle, 1), (middle, 1)],
                   "the alignment survived Ctrl+Z in the text box; ArrowUp then moved both shapes to y 1")


def test_wf_w06_workplane_touch_tablet_workplane(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d", viewport=MEDIUM) as page:
        wp = workplane(page)
        shapes = page.get_by_role("toolbar", name="Shapes")
        tap(button(shapes, "Box"))
        box_id = wait_scene(page, count_is(1), "tapping Box adds a box")["items"][0]["object-id"]
        tap(wp)
        wait_scene(page, lambda s: selected(s) == [box_id], "a tap selects the box")
        wp.focus()
        page.keyboard.press("w")
        expect(status(page)).to_contain_text("Pick a face for the workplane")
        page.keyboard.press("Enter")
        top = wait_scene(page, lambda s: s["workplane-normal"] == "0,0,1" and s["workplane-origin"] == "0,0,20", "top face of the box")
        expect(status(page)).to_contain_text("Workplane set to top face")
        page.keyboard.press("c")
        s = wait_scene(page, count_is(2), "C adds a cylinder")
        assert s["items"][1]["kind"] == "cylinder" and xyz(s["items"][1]) == (0, 0, 30), s["items"][1]
        clear_status(page, app_url)
        tap(button(page, "Workplane"))
        expect(status(page)).to_contain_text("Pick a face for the workplane")
        page.keyboard.press("Escape")
        wp.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("s")
        s = wait_scene(page, count_is(3), "S adds a sphere")
        assert xyz(s["items"][2]) == (0, 0, 30), f"Escape did not cancel the Workplane tool: {s['items'][2]}"
        assert s["workplane-origin"] == top["workplane-origin"] and s["workplane-normal"] == "0,0,1", s
        tap(button(page, "Reset workplane"))
        expect(status(page)).to_contain_text("Workplane reset")
        wait_scene(page, lambda s: s["workplane-origin"] == "0,0,0" and s["workplane-normal"] == "0,0,1", "reset to the ground")
        wp.focus()
        before = stored_revision(kid, "3d")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
        wait_saved(page, kid, "3d", before)
    project = project_of(kid, "3d")
    snap = snapshot_at(project["id"], project["revision"])
    assert [(o["kind"], o["z"]) for o in snap["objects"]] == [("box", REST_Z), ("cylinder", 30), ("sphere", 30)]
    assert snap["workplane"] == {"origin": [0, 0, 0], "normal": [0, 0, 1]}


def test_wf_w06_workplane_touch_phone_drag_zoom(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=3d", viewport=NARROW, reduced_motion="reduce") as page:
        wp = workplane(page)
        tap(button(page, "Shapes"))
        sheet = page.get_by_role("dialog", name="Shapes")
        expect(sheet).to_be_visible()
        assert opacity(sheet) >= OPAQUE, "reduced motion: the Shapes sheet faded in"
        tap(button(sheet.get_by_role("toolbar", name="Shapes"), "Box"))
        box_id = wait_scene(page, count_is(1), "Box from the Shapes sheet")["items"][0]["object-id"]
        if sheet.is_visible():
            page.keyboard.press("Escape")
        tap(wp)
        wait_scene(page, lambda s: selected(s) == [box_id], "a tap selects the box")
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})

        def drag(x0: float, y0: float, dx: float) -> None:
            def send(kind: str, points: list[tuple[float, float]]) -> None:
                cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": 0} for x, y in points]})
            send("touchStart", [(x0, y0)])
            for i in range(1, 7):
                send("touchMove", [(x0 + dx * i / 6, y0)])
            send("touchEnd", [])

        box = wp.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        drag(cx, cy, DRAG_PX)
        s = wait_scene(page, lambda s: xyz(item(s, box_id))[:2] != (0, 0), "a one-finger drag moves the selected box", frames=True)
        assert xyz(item(s, box_id))[2] == REST_Z, "the dragged box left the workplane"
        assert s["camera-azimuth"] == str(CAMERA_AZIMUTH), "dragging the selected box orbited the camera"
        moved = xyz(item(s, box_id))
        corners = [(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)
                   for fx, fy in ((0.12, 0.2), (0.88, 0.2), (0.12, 0.8), (0.88, 0.8))]
        hits = wp.evaluate("(el, pts) => pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); "
                           "return !!h && (h === el || el.contains(h)); })", corners)
        assert any(hits), "no empty canvas point near the canvas corners"
        ex, ey = next(p for p, ok in zip(corners, hits) if ok)
        drag(ex, ey, ORBIT_PX if ex < cx else -ORBIT_PX)
        turn = ORBIT_PX // 2
        s = wait_scene(page, lambda s: int(s["camera-azimuth"]) in {CAMERA_AZIMUTH + turn, CAMERA_AZIMUTH - turn},
                       "a one-finger drag on empty canvas orbits 30° under reduced motion", frames=True)
        assert xyz(item(s, box_id)) == moved, "orbiting moved the box"
        page.mouse.move(cx, cy)
        for _ in range(WHEEL_TURNS):
            page.mouse.wheel(0, WHEEL_BIG_PX)
        first = float(wait_scene(page, lambda s: float(s["camera-distance"]) in (ZOOM_MIN, ZOOM_MAX),
                                 "the wheel reaches a zoom limit", frames=True)["camera-distance"])
        other = ZOOM_MAX if first == ZOOM_MIN else ZOOM_MIN
        for _ in range(WHEEL_TURNS):
            page.mouse.wheel(0, -WHEEL_BIG_PX)
        wait_scene(page, lambda s: float(s["camera-distance"]) == other, "the wheel the other way reaches the other limit", frames=True)


def test_wf_w07_circuit_overcurrent_pointer_wiring(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, kid.id, "/editor/new?kind=circuit") as page:
        parts = page.get_by_role("toolbar", name="Parts")
        for kind, label in (("Battery", "BAT-1"), ("Resistor", "R-1"), ("LED", "LED-1")):
            button(parts, kind).click()
            expect(part_group(page, label)).to_be_visible()
        expect(part_group(page, "BAT-1")).to_have_accessible_name("BAT-1, ok")
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, off")
        for (a, sa), (b, sb) in ((("BAT-1", "+"), ("R-1", "+")), (("R-1", MINUS), ("LED-1", "+")),
                                 (("LED-1", MINUS), ("BAT-1", MINUS))):
            terminal(page, a, sa).drag_to(terminal(page, b, sb))
            expect(status(page)).to_contain_text(f"Wired {a} {sa} to {b} {sb}")
            expect(wire_items(page).filter(has_text=f"{a} {sa} to {b} {sb}")).to_have_count(1)
        expect(wire_items(page)).to_have_count(3)
        start_sim(page, app_url)
        lit = f"{led_ma(DEFAULT_OHMS):.1f}"
        c = wait_component(page, "LED-1", lambda c: c["status"] == "lit", "LED lights through the default 1000 Ω")
        assert c["current-ma"] == lit and c["brightness"] == brightness(DEFAULT_OHMS), c
        expect(part_group(page, "LED-1")).to_have_accessible_name(f"LED-1, lit {lit} mA")
        expect(status(page)).to_contain_text(f"LED-1 lit at {lit} mA")
        button(page, f"Delete wire R-1 {MINUS} to LED-1 +").click()
        expect(wire_items(page)).to_have_count(2)
        tick(page, app_url, 1)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "off" and c["current-ma"] == "0.0", "a missing wire gives zero current")
        assert component(page, "R-1")["current-ma"] == "0.0"
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, off")
        stop_sim(page)
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 1")
    project = project_of(kid, "circuit")
    snap = snapshot_at(project["id"], project["revision"])
    assert {(c["label"], c["type"]) for c in snap["components"]} == {("BAT-1", "battery"), ("R-1", "resistor"), ("LED-1", "led")}
    assert wire_set(snap) == {frozenset(("BAT-1+", "R-1+")), frozenset(("LED-1-", "BAT-1-"))}


def test_wf_w07_circuit_overcurrent_switch_burnout(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    snap = circuit([BATTERY, SWITCH_OPEN, LED], [("BAT-1+", "SW-1+"), ("SW-1-", "LED-1+"), ("LED-1-", "BAT-1-")])
    pid = make_project(kid, "circuit", f"Switch {tag()}", snap)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        sw_group = part_group(page, "SW-1")
        expect(sw_group).to_have_accessible_name("SW-1, open")
        start_sim(page, app_url)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "off", "an open switch leaves the LED off")
        assert c["current-ma"] == "0.0", c
        switch = sw_group.get_by_role("switch", name="SW-1")
        switch.focus()
        page.keyboard.press("Space")
        expect(switch).to_be_checked()
        expect(sw_group).to_have_accessible_name("SW-1, closed")
        tick(page, app_url, 1)
        wait_component(page, "LED-1", lambda c: c["status"] == "broken", "closing the switch burns the LED out")
        expect(status(page)).to_contain_text(f"LED-1 burnt out at {led_ma(0):.1f} mA")
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, burnt out")
        switch.focus()
        page.keyboard.press("Space")
        expect(switch).not_to_be_checked()
        expect(sw_group).to_have_accessible_name("SW-1, open")
        tick(page, app_url, 2)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "broken", "the LED stays burnt out until reset")
        assert c["current-ma"] == "0.0", c
        reset = button(part_group(page, "LED-1"), "Reset LED")
        reset.focus()
        page.keyboard.press("Enter")
        expect(status(page)).to_contain_text("LED-1 reset")
        tick(page, app_url, 1)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "off", "Reset LED makes it off")
        assert c["current-ma"] == "0.0" and float(c["brightness"]) == 0, c
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, off")
        stop_sim(page)
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    parts = {c["label"]: c for c in snapshot_at(pid, 2)["components"]}
    assert parts["SW-1"]["closed"] is False and not parts["LED-1"].get("broken"), parts


def test_wf_w07_circuit_overcurrent_reversed_led_blocks(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    led2 = {"label": "LED-2", "type": "led", "broken": False}
    snap = circuit([BATTERY, resistor(NIGHT_OHMS), LED, led2],
                   [("BAT-1+", "R-1+"), ("R-1-", "LED-1+"), ("LED-1-", "LED-2-"), ("LED-2+", "BAT-1-")])
    pid = make_project(kid, "circuit", f"Backwards {tag()}", snap)["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wait_for_state(page, "qy-circuit", lambda s: s.get("sim") == "stopped" and len(s["items"]) == 4, "circuit loads stopped")
        start_sim(page, app_url)
        tick(page, app_url, 3)
        c = wait_component(page, "LED-1", lambda c: c["status"] == "off" and c["current-ma"] == "0.0",
                           "a reversed LED in series blocks all current; LED-1 must stay off, not burn out")
        assert float(c["brightness"]) == 0, c
        assert component(page, "LED-2")["status"] == "off" and component(page, "R-1")["current-ma"] == "0.0"
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, off")
        expect(status(page)).not_to_contain_text("burnt out")


def test_wf_w08_live_readout_two_tabs_live_voltage(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "circuit", "Night Light", NIGHT)["id"]

    def ma(volts: float) -> float:
        return (volts - LED_DROP) / (NIGHT_OHMS + LED_OHMS) * 1000

    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        start_sim(page, app_url)
        wait_component(page, "LED-1", lambda c: c["status"] == "lit" and c["current-ma"] == f"{ma(VOLTS):.1f}", "lit at 19.7 mA")
        volts = part_group(page, "BAT-1").get_by_role("textbox", name="Voltage (V)")
        clear_status(page, app_url)
        volts.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(str(LOW_VOLTS))
        tick(page, app_url, 1)
        low = f"{ma(LOW_VOLTS):.1f}"
        c = wait_component(page, "LED-1", lambda c: c["current-ma"] == low, f"readout follows the typed {LOW_VOLTS} V within one tick")
        assert c["status"] == "lit" and c["brightness"] == f"{min(1.0, ma(LOW_VOLTS) / LED_MAX_MA):.2f}", c
        expect(part_group(page, "LED-1")).to_have_accessible_name(f"LED-1, lit {low} mA")
        expect(status(page)).to_contain_text(f"LED-1 lit at {low} mA")
        volts.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(str(HIGH_VOLTS))
        tick(page, app_url, 1)
        wait_component(page, "LED-1", lambda c: c["status"] == "broken", f"{HIGH_VOLTS} V burns the LED out within one tick")
        expect(status(page)).to_contain_text(f"LED-1 burnt out at {ma(HIGH_VOLTS):.1f} mA")
        expect(part_group(page, "LED-1")).to_have_accessible_name("LED-1, burnt out")
        assert not_reloaded(page), "the page reloaded"
        stop_sim(page)
        terminal(page, "BAT-1", "+").focus()
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision 2")
    battery = next(c for c in snapshot_at(pid, 2)["components"] if c["label"] == "BAT-1")
    assert battery["volts"] == HIGH_VOLTS, battery


def test_wf_w08_live_readout_two_tabs_circuit_tabs(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "circuit", "Night Light", NIGHT)["id"]
    stale = "This project changed in another tab. Reload to see the latest version."

    def ohms(p: Page) -> Locator:
        return part_group(p, "R-1").get_by_role("textbox", name="Resistance (Ω)")

    def retype(p: Page, value: str) -> None:
        ohms(p).focus()
        p.keyboard.press("Control+a")
        p.keyboard.type(value)

    def save_key(p: Page) -> None:
        terminal(p, "BAT-1", "+").focus()
        p.keyboard.press("Control+s")

    with opened(browser, app_url, kid.id, f"/editor/{pid}") as a, opened(browser, app_url, kid.id, f"/editor/{pid}") as b:
        expect(ohms(a)).to_have_value(str(NIGHT_OHMS))
        expect(ohms(b)).to_have_value(str(NIGHT_OHMS))
        retype(a, str(DEFAULT_OHMS))
        save_key(a)
        expect(status(a)).to_contain_text("Saved revision 2")
        expect(ohms(b)).to_have_value(str(DEFAULT_OHMS), timeout=LIVE_MS)
        assert not_reloaded(b), "the page reloaded"
        retype(b, KEPT_OHMS)
        retype(a, RETYPED_OHMS)
        save_key(a)
        expect(status(a)).to_contain_text("Saved revision 3")
        save_key(b)
        expect(notice(b)).to_contain_text(stale)
        expect(status(b)).to_contain_text(stale)
        expect(ohms(b)).to_have_value(KEPT_OHMS)
        assert revision_keys(pid) == expected_revisions(pid, 3)
        stored = next(c for c in snapshot_at(pid, 3)["components"] if c["label"] == "R-1")
        assert stored["ohms"] == int(RETYPED_OHMS), stored
        reload = button(notice(b), "Reload")
        reload.focus()
        b.keyboard.press("Enter")
        expect(ohms(b)).to_have_value(RETYPED_OHMS)


def test_wf_w08_live_readout_two_tabs_simultaneous_saves(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", f"Race {tag()}", ONE)["id"]
    stale = "This project changed in another tab. Reload to see the latest version."
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as a, opened(browser, app_url, kid.id, f"/editor/{pid}") as b:
        tabs = {"a": a, "b": b}
        for p, key in ((a, "b"), (b, "c")):
            wp = workplane(p)
            wait_scene(p, count_is(1), "tab loads revision 1")
            wp.focus()
            p.keyboard.press(key)
            wait_scene(p, count_is(2), "tab has an unsaved edit")
            expect(p.get_by_text("Unsaved changes").first).to_be_visible()
        with held(a, f"**/api/projects/{pid}") as gate_a, held(b, f"**/api/projects/{pid}") as gate_b:
            for p in tabs.values():
                p.keyboard.press("Control+s")
                expect(p.get_by_text("Saving…").first).to_be_visible()
            gate_a.release()
            gate_b.release()
        outcomes: dict[str, str] = {}
        deadline = time.monotonic() + UI_S
        while len(outcomes) < len(tabs) and time.monotonic() < deadline:
            for name, p in tabs.items():
                if name in outcomes:
                    continue
                if "Saved revision 2" in status(p).inner_text():
                    outcomes[name] = "won"
                elif notice(p).count() and stale in notice(p).inner_text():
                    outcomes[name] = "stale"
        assert sorted(outcomes.values()) == ["stale", "won"], f"expected one winner and one stale tab, got {outcomes}"
        loser = next(p for name, p in tabs.items() if outcomes[name] == "stale")
        expect(status(loser)).to_contain_text(stale)
        expect(button(notice(loser), "Reload")).to_be_visible()
    assert revision_keys(pid) == expected_revisions(pid, 2)
    assert sorted(o["kind"] for o in snapshot_at(pid, 2)["objects"]) in (["box", "box"], ["box", "cylinder"])


def test_wf_w09_block_lab_loop_keyboard_edit(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    step = config(app_url)["blocksStepMs"]
    with opened(browser, app_url, kid.id, "/editor/new?kind=blocks") as page:
        palette = page.get_by_role("toolbar", name="Blocks palette")
        program = page.get_by_role("list", name="Program")
        blocks = program.get_by_role("listitem")

        def insert(name: str) -> None:
            button(palette, name).focus()
            page.keyboard.press("Enter")

        insert("Repeat")
        expect(blocks).to_have_count(1)
        focus_block(blocks.first)
        page.keyboard.press("ArrowRight")
        insert("Add Box")
        insert("Move X by")
        body = program.get_by_role("list", name="Repeat body")
        expect(body.get_by_role("listitem")).to_have_count(2)
        focus_block(body.get_by_role("listitem").nth(1))
        page.keyboard.press("ArrowLeft")
        insert("Add Sphere")
        insert("Add Cylinder")
        expect(blocks).to_have_count(5)
        expect(body.get_by_role("listitem")).to_have_count(2)
        focus_block(blocks.last)
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Delete")
        expect(blocks).to_have_count(4)
        expect(body.get_by_role("listitem")).to_have_count(2)
        play = button(page, "Play")
        play.focus()
        page.keyboard.press("Enter")
        advance(page, step * (BLOCK_ACTIONS + 1))
        s = blocks_state(page, lambda s: s.get("state") == "done", "program finishes")
        assert s["step"] == str(BLOCK_ACTIONS) and s["mesh-count"] == "4" and s["sphere-count"] == "0", s
        assert sorted((o["kind"], float(o["x"])) for o in s["items"]) == [("box", 0), ("box", 10), ("box", 20), ("cylinder", 30)]
        expect(status(page)).to_contain_text("Program finished: 4 objects")
        play.focus()
        before = stored_revision(kid, "blocks")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text("Saved revision")
        wait_saved(page, kid, "blocks", before)
    project = project_of(kid, "blocks")
    prog = snapshot_at(project["id"], project["revision"])["program"]
    assert [b["block"] for b in prog] == ["repeat", "addCylinder"], prog
    assert prog[0]["count"] == 3 and [b["block"] for b in prog[0]["body"]] == ["addBox", "moveX"]
    assert prog[0]["body"][1]["mm"] == 10


def test_wf_w09_block_lab_loop_glancet_after_run(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "blocks", "Sphere Tower", {**tower_snapshot(), "objects": []})["id"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, kid.id, f"/editor/{pid}", reduced_motion="reduce") as kp:
        watch_button(ed, kid.name).click()
        viewer = glancet(ed, kid.name)
        wait_for_state(ed, "qy-glancet-state", lambda s: s.get("student") == kid.id and s.get("revision") == "1"
                       and s.get("mesh-count") == "0", "Glancet shows the empty first revision")
        play = button(kp, "Play")
        play.focus()
        kp.keyboard.press("Enter")
        s = blocks_state(kp, lambda s: s.get("state") == "done", "reduced motion: Play shows the end state at once")
        assert s["sphere-count"] == "3" and s["mesh-count"] == "3", s
        assert sorted(xyz(o)[2] for o in s["items"]) == [0, 10, 20]
        expect(status(kp)).to_contain_text("Program finished: 3 objects")
        play.focus()
        kp.keyboard.press("Control+s")
        expect(status(kp)).to_contain_text("Saved revision 2")
        wait_for_state(ed, "qy-glancet-state", lambda s: s.get("revision") == "2" and s.get("mesh-count") == "3",
                       "Glancet shows the saved tower live", seconds=LIVE_MS / 1000)
        expect(viewer).to_contain_text("Rev 2")
        expect(tile(ed, kid.name)).to_contain_text("Rev 2")
    objs = snapshot_at(pid, 2)["objects"]
    assert sorted(o["z"] for o in objs) == [0, 10, 20] and {o["kind"] for o in objs} == {"sphere"}


def test_wf_w09_block_lab_loop_fields_locked_while_running(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "blocks", "Sphere Tower", {**tower_snapshot(), "objects": []})["id"]
    step = config(app_url)["blocksStepMs"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        count = page.get_by_role("textbox", name="Repeat count")
        move = page.get_by_role("textbox", name="Move Z by (mm)")
        expect(count).to_be_editable()
        button(page, "Play").click()
        advance(page, step / 2)
        blocks_state(page, lambda s: s.get("state") == "running", "Play starts a run")
        expect(count).not_to_be_editable()
        expect(move).not_to_be_editable()
        advance(page, step * (6 + 1))
        blocks_state(page, lambda s: s.get("state") == "done", "run finishes")
        expect(count).to_be_editable()


def test_wf_w09_block_lab_loop_undo_locked_while_running(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "blocks", "Sphere Tower", {**tower_snapshot(), "objects": []})["id"]
    step = config(app_url)["blocksStepMs"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        palette = page.get_by_role("toolbar", name="Blocks palette")
        blocks = page.get_by_role("list", name="Program").get_by_role("listitem")
        expect(blocks).to_have_count(3)
        button(palette, "Add Box").click()
        expect(blocks).to_have_count(4)
        button(page, "Play").click()
        advance(page, step / 2)
        blocks_state(page, lambda s: s.get("state") == "running", "Play starts a run")
        undo = button(page, "Undo")
        if undo.is_enabled():
            undo.click()
        advance(page, step)
        expect(blocks).to_have_count(4)
        advance(page, step * (7 + 1))
        s = blocks_state(page, lambda s: s.get("state") == "done", "run finishes")
        assert s["mesh-count"] == "4", s
        expect(blocks).to_have_count(4)


def test_wf_w11_glancet_expanded_modal(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    make_project(kid, "3d", "Gear Box", GEAR)
    fade = config(app_url)["glancetFadeMs"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        watch = watch_button(page, kid.name)
        watch.focus()
        page.keyboard.press("Enter")
        viewer = glancet(page, kid.name)
        expect(viewer).to_be_visible()
        advance(page, fade)
        assert viewer.evaluate(CONTAINS_FOCUS), "Glancet did not take focus"
        expand = button(viewer, "Expand viewer")
        expand.focus()
        page.keyboard.press("Enter")
        expect(expand).to_have_attribute("aria-expanded", "true")
        for key in ("Tab",) * 5 + ("Shift+Tab",) * 3:
            page.keyboard.press(key)
            assert viewer.evaluate(CONTAINS_FOCUS), f"{key} left the expanded (modal) Glancet"
        scroll = page.evaluate("window.scrollY")
        page.keyboard.press("Escape")
        advance(page, fade + FRAME_MS)
        wait_gone(viewer, "Escape did not close the expanded Glancet")
        expect(watch).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll
        page.keyboard.press("Enter")
        viewer = glancet(page, kid.name)
        expect(viewer).to_be_visible()
        advance(page, fade)
        expect(button(viewer, "Expand viewer")).to_have_attribute("aria-expanded", "false")
        left = False
        for _ in range(6):
            page.keyboard.press("Tab")
            if not viewer.evaluate(CONTAINS_FOCUS):
                left = True
                break
        assert left, "Tab never left the docked (non-modal) Glancet"
        close = button(viewer, "Close viewer")
        close.focus()
        page.keyboard.press("Enter")
        advance(page, fade + FRAME_MS)
        wait_gone(viewer, "Close viewer did not close Glancet")
        expect(watch).to_be_focused()


def test_wf_w11_glancet_reduced_motion_escape(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}", reduced_motion="reduce") as page:
        watch = watch_button(page, kid.name)
        watch.focus()
        page.keyboard.press("Enter")
        viewer = glancet(page, kid.name)
        expect(viewer).to_be_visible()
        assert opacity(viewer) >= OPAQUE, "reduced motion: Glancet faded in"
        toggle = button(viewer, "Pause turntable")
        expect(toggle).to_have_attribute("aria-pressed", "true")
        wait_for_state(page, "qy-glancet-state", lambda s: s.get("revision") == "1", "Glancet at revision 1")
        assert save(kid, pid, 1, TWO).status_code == 200
        wait_for_state(page, "qy-glancet-state", lambda s: s.get("revision") == "2" and s.get("mesh-count") == "2",
                       "Glancet swaps to revision 2 live", seconds=LIVE_MS / 1000)
        expect(viewer).to_contain_text("Rev 2")
        assert opacity(viewer) >= OPAQUE, "reduced motion: the live swap faded the viewer"
        advance(page, FRAME_MS)
        still = camera(page)
        advance(page, TURN_MS / 4)
        assert same_matrices(still, camera(page)), "reduced motion: the paused turntable turned"
        toggle.focus()
        page.keyboard.press("Space")
        expect(toggle).to_have_attribute("aria-pressed", "false")
        assert "true" in viewer.evaluate(PLAYING_JS)
        advance(page, FRAME_MS)
        before = camera(page)
        advance(page, TURN_MS / 4)
        assert not same_matrices(before, camera(page)), "the resumed turntable did not turn"
        scroll = page.evaluate("window.scrollY")
        page.get_by_role("combobox", name="Sort roster").focus()
        page.keyboard.press("Escape")
        wait_gone(viewer, "Escape on the classroom page did not close Glancet at once")
        expect(watch).to_be_focused()
        assert page.evaluate("window.scrollY") == scroll


def test_wf_w12_removal_and_access_remove_last_tile(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=2)
    first, last = sorted(room.kids, key=lambda k: k.name.lower())
    assistant = verified(app_url, mail)
    add_assistant(room, assistant)
    copy = f"You were removed from {room.name}."
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, assistant.id, f"/classrooms/{room.id}") as ap, \
            opened(browser, app_url, last.id, "/class") as kp:
        expect(kp.get_by_text(COUNTDOWN_RE).first).to_be_visible()
        expect(tile(ap, last.name)).to_be_visible()
        select(ed.get_by_role("combobox", name="Sort roster"), "Nickname (A–Z)")
        remove = button(ed, f"Remove {last.name}")
        remove.focus()
        ed.keyboard.press("Enter")
        dialog = ed.get_by_role("alertdialog", name=f"Remove {last.name}?")
        expect(dialog).to_be_visible()
        ed.keyboard.press("Escape")
        advance(ed, DIALOG_SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(remove).to_be_focused()
        expect(tile(ed, last.name)).to_be_visible()
        ed.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        button(dialog, "Remove from classroom").focus()
        ed.keyboard.press("Enter")
        advance(ed, DIALOG_SETTLE_MS)
        expect(status(ed)).to_contain_text(f"Removed {last.name}")
        expect(tile(ed, last.name)).to_have_count(0)
        expect(watch_button(ed, first.name)).to_be_focused()
        expect(tile(ap, last.name)).to_have_count(0, timeout=LIVE_MS)
        expect(notice(kp)).to_contain_text(copy, timeout=LIVE_MS)
    assert_error(last.client.get("/api/class"), 401, "removed", copy)
    assert [s["nickname"] for s in room.get()["students"]] == [first.name]


def test_wf_w13_personal_signup_verification_educator_resend(browser: Browser, app_url: str, mail: Mailpit) -> None:
    t = tag()
    email = f"educator-{t}@hollowbrook.test"
    room_name = f"Space Camp {t}"
    with grading_clock(app_url):
        with opened(browser, app_url, None, "/signup?type=educator") as page:
            expect(page.get_by_role("radiogroup", name="Account type").get_by_role("radio", name="Educator")).to_be_checked()
            for label, value in (("Name", f"Dana {t}"), ("Email", email), ("Password", f"kiln-maple-{t}")):
                page.get_by_role("textbox", name=label).focus()
                page.keyboard.type(value)
            button(page, "Create account").focus()
            page.keyboard.press("Enter")
            expect(notice(page)).to_contain_text(f"Check your inbox at {email} to verify your account.")
            first = tokens_for(mail, email, 1)[0]
            page.goto(f"{app_url}/dashboard")
            opener = page.get_by_role("button", name="Create classroom").first
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Create classroom")
            expect(dialog.get_by_role("textbox", name="Classroom name")).to_be_focused()
            page.keyboard.type(room_name)
            page.keyboard.press("Enter")
            expect(status(page)).to_contain_text("Verify your email to create classrooms.")
            if dialog.is_visible():
                page.keyboard.press("Escape")
                advance(page, DIALOG_SETTLE_MS)
            resend = button(notice(page), "Resend verification email")
            resend.focus()
            page.keyboard.press("Enter")
            expect(status(page)).to_contain_text("Wait a minute before sending another email.")
            set_clock(app_url, server_now(app_url) + timedelta(seconds=RESEND_WINDOW_S + 1))
            resend.focus()
            page.keyboard.press("Enter")
            expect(status(page)).to_contain_text(f"Verification email sent to {email}")
            second = next(tk for tk in tokens_for(mail, email, 2) if tk != first)
            page.goto(f"{app_url}/verify?token={first}")
            expect(page.get_by_role("heading", name="This verification link has expired or was replaced. "
                                    "Send a new one from your account.")).to_be_visible()
            page.goto(f"{app_url}/verify?token={second}")
            expect(page.get_by_role("heading", name="Email verified. You can save projects now.")).to_be_visible()
            page.goto(f"{app_url}/dashboard")
            room_id = keyboard_create(page, room_name)
            stored = page.request.get(f"{app_url}/api/classrooms/{room_id}").json()
            account = page.request.get(f"{app_url}/api/session").json()["account"]
    assert stored["name"] == room_name and stored["role"] == "owner", stored
    assert account["kind"] == "educator" and account["emailVerified"] is True, account
    assert len(mails_for(mail, email, 2)) == 2


def test_wf_w13_personal_signup_verification_outage_export(browser: Browser, mail: Mailpit) -> None:
    assert OUTAGE_URL, "APP_MINIO_DOWN_URL is not set"
    r = httpx.post(f"{OUTAGE_URL}/api/grading/seed", headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json()["storageSeeded"] is False, r.text
    dana = r.json()["educator"]
    copy = "Export failed: storage is unavailable. Your design is safe; try again."
    with opened(browser, OUTAGE_URL, dana["id"], "/editor/new?kind=3d") as page:
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        wait_scene(page, count_is(1), "B adds a box")
        opener = button(page, "Export")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Export")
        expect(dialog.get_by_role("radio", name="STL", exact=True)).to_be_checked()
        expect(dialog).to_contain_text(size_line((SHAPE_MM,) * 3, "mm"))
        button(dialog, "Download").focus()
        page.keyboard.press("Enter")
        expect(status(page)).to_contain_text(copy)
        expect(notice(page)).to_contain_text(copy)
        assert state(page, "qy-scene")["mesh-count"] == "1"
        expect(page.get_by_text("Unsaved changes").first).to_be_visible()
    assert httpx.get(f"{OUTAGE_URL}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "unavailable"}
    c = api(OUTAGE_URL)
    assert c.post("/api/auth/signin", json={"email": dana["email"], "password": dana["password"]}).status_code == 200
    assert c.get("/api/exports").json()["exports"] == []
    assert db_hits(Postgres("_minio_down"), "untitled-3d-design") == []


def test_wf_w01_classroom_live_join_created_roster_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    owner = verified(app_url, mail)
    name = f"Space Camp {tag()}"
    nick = f"Tiny Turtle {tag()[:4]}"
    with opened(browser, app_url, owner.id, "/dashboard") as page:
        room_id = keyboard_create(page, name)
        expect(page.get_by_text("Open for joining", exact=True).first).to_be_visible()
        code = owner.client.get(f"/api/classrooms/{room_id}").json()["joinCode"]
        join(app_url, code, nick)
        expect(tile(page, nick)).to_be_visible(timeout=LIVE_MS)
        expect(status(page)).to_contain_text(f"{nick} joined", timeout=LIVE_MS)
        expect(button(tile(page, nick), f"Watch {nick} live")).to_be_visible()
        assert not_reloaded(page), "the page reloaded"
    assert [s["nickname"] for s in owner.client.get(f"/api/classrooms/{room_id}").json()["students"]] == [nick]


def test_wf_w01_classroom_live_join_empty_roster_pill_focus(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        expect(page.get_by_role("heading", level=1, name=room.name, exact=True)).to_be_visible()
        pill = page.get_by_role("button", name="Show join code", exact=True).last
        pill.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Join code")
        expect(dialog).to_contain_text(code_pattern(room.data["joinCode"]))
        advance(page, DIALOG_SETTLE_MS)
        page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(dialog).to_have_count(0)
        expect(pill).to_be_focused()


def test_wf_w01_classroom_live_join_zone_preselect_owned_only(browser: Browser, app_url: str, mail: Mailpit) -> None:
    founder = verified(app_url, mail)
    own_zone, other_zone = "America/Denver", "Asia/Tokyo"
    create_classroom(founder, timeZone=own_zone)
    other = make_room(app_url, mail, kids=0, timeZone=other_zone)
    add_assistant(other, founder)
    listed = founder.client.get("/api/classrooms").json()["classrooms"]
    assert {c["timeZone"]: c["role"] for c in listed} == {own_zone: "owner", other_zone: "assistant"}
    name = f"Space Camp {tag()}"
    with opened(browser, app_url, founder.id, "/dashboard") as page:
        room_id = keyboard_create(page, name)
    assert founder.client.get(f"/api/classrooms/{room_id}").json()["timeZone"] == own_zone


def test_wf_w02_server_time_hand_in_dashboard_state_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    with opened(browser, app_url, room.owner.id, "/dashboard") as page:
        rooms = page.get_by_role("list", name="Classrooms")
        link = rooms.get_by_role("link", name=room.name, exact=True)
        card = rooms.get_by_role("listitem").filter(has=page.get_by_role("link", name=room.name, exact=True)).first
        expect(card).to_contain_text("Open for joining")
        with grading_clock(app_url):
            set_clock(app_url, parse_instant(room.data["joinClosesAt"]) + timedelta(minutes=1))
            expect(card).to_contain_text("In session", timeout=LIVE_MS)
            expect(card).not_to_contain_text("Open for joining")
            assert not_reloaded(page), "the page reloaded"
            link.focus()
            page.keyboard.press("Enter")
            expect(page).to_have_url(re.compile(rf"/classrooms/{re.escape(room.id)}$"))
            expect(page.get_by_role("heading", level=1, name=room.name, exact=True)).to_be_visible()
            expect(page.get_by_text("In session", exact=True).first).to_be_visible()
            assert room.get()["state"] == "in_session"


def test_wf_w03_csg_group_toolbar_ctrl_s(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as ed, \
            opened(browser, app_url, kid.id, "/editor/new?kind=3d") as kp:
        expect(tile(ed, kid.name)).to_be_visible()
        wp = workplane(kp)
        wp.focus()
        kp.keyboard.press("b")
        kp.keyboard.press("c")
        wait_scene(kp, count_is(2), "B and C add a box and a cylinder")
        assert stored_revision(kid, "3d") == 0, "a save ran before Ctrl+S"
        opener = button(kp, "Export")
        opener.focus()
        kp.keyboard.press("Control+s")
        expect(status(kp)).to_contain_text("Saved revision 1")
        expect(kp.get_by_text("Saved · revision 1").first).to_be_visible()
        expect(opener).to_be_focused()
        expect(kp.get_by_role("dialog", name="Export")).to_have_count(0)
        expect(tile(ed, kid.name)).to_contain_text("Rev 1", timeout=LIVE_MS)
        expect(status(ed)).to_contain_text(f"{kid.name} saved revision 1", timeout=LIVE_MS)
    proj = project_of(kid, "3d")
    assert proj["revision"] == 1
    assert revision_keys(proj["id"]) == expected_revisions(proj["id"], 1)
    assert len(snapshot_at(proj["id"], 1)["objects"]) == 2


def test_wf_w03_csg_group_nested_group_is_one_solid(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    plug = shape("plug", "cylinder", w=SHAPE_MM, d=SHAPE_MM, h=PLUG_H)
    pid = make_project(kid, "3d", f"Plugged {tag()}", design(GEAR["objects"] + [plug]))["id"]
    expected = round(GEAR_MM * GEAR_MM * SHAPE_MM - 3.141592653589793 * (GEAR_HOLE_MM / 2) ** 2 * (SHAPE_MM - PLUG_H))
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(2), "Gear Box group and plug load")
        wp.focus()
        page.keyboard.press("Control+a")
        wait_scene(page, lambda s: len(selected(s)) == 2, "Ctrl+A selects the group and the plug")
        page.keyboard.press("Control+g")
        s = wait_scene(page, lambda s: s["mesh-count"] == "1" and s["items"][0]["kind"] == "group",
                       "Ctrl+G groups the Gear Box with the plug")
        expect(status(page)).to_contain_text("Grouped 2 shapes")
    volume = int(s["items"][0]["volume"])
    assert abs(volume - expected) <= 1, (
        f"nested group volume {volume}; expected {expected} (the inner hole must not carve the plug; {GEAR_VOLUME} means it did)")
    assert whd(s["items"][0]) == (GEAR_MM, GEAR_MM, SHAPE_MM)


def test_wf_w03_csg_group_ungroup_object_limit(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    spacing = SHAPE_MM + 5
    boxes = [shape(f"b{i}", x=(i % 20) * spacing, y=GEAR_MM + (i // 20) * spacing) for i in range(OBJECT_MAX - 1)]
    pid = make_project(kid, "3d", f"Full {tag()}", design(GEAR["objects"] + boxes))["id"]
    with opened(browser, app_url, kid.id, f"/editor/{pid}") as page:
        wp = workplane(page)
        wait_scene(page, count_is(OBJECT_MAX), "a design at the 200-object limit loads")
        wp.focus()
        page.keyboard.press("Tab")
        wait_scene(page, lambda s: selected(s) == ["gear"], "Tab selects the first object, the group")
        page.keyboard.press("Control+Shift+G")
        expect(status(page)).to_contain_text("This design has the most shapes it can hold (200).")
        s = state(page, "qy-scene")
        assert s["mesh-count"] == str(OBJECT_MAX), f"ungroup went past the limit: {s['mesh-count']} objects"
        assert item(s, "gear")["kind"] == "group"


def test_wf_w13_personal_signup_verification_unverified_save_notice(browser: Browser, app_url: str, mail: Mailpit) -> None:
    t = tag()
    email = f"priya-{t}@makers.test"
    copy = "Verify your email to save projects."
    with opened(browser, app_url, None, "/signup") as page:
        for label, value in (("Name", f"Priya {t}"), ("Email", email), ("Password", f"orbit-glue-{t}")):
            page.get_by_role("textbox", name=label).focus()
            page.keyboard.type(value)
        radio = page.get_by_role("radiogroup", name="Account type").get_by_role("radio", name="Personal maker")
        radio.focus()
        page.keyboard.press("Space")
        expect(radio).to_be_checked()
        button(page, "Create account").focus()
        page.keyboard.press("Enter")
        expect(notice(page)).to_contain_text(f"Check your inbox at {email} to verify your account.")
        page.goto(f"{app_url}/editor/new?kind=3d")
        wp = workplane(page)
        wp.focus()
        page.keyboard.press("b")
        wait_scene(page, count_is(1), "B adds a box")
        page.keyboard.press("Control+s")
        expect(status(page)).to_contain_text(copy)
        expect(notice(page)).to_contain_text(copy)
        expect(button(notice(page), "Resend verification email")).to_be_visible()
        expect(page.get_by_text("Unsaved changes").first).to_be_visible()
        assert state(page, "qy-scene")["mesh-count"] == "1"
        assert page.request.get(f"{app_url}/api/projects").json()["projects"] == []


def test_grading_hooks(app_url: str) -> None:
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert_error(httpx.post(f"{app_url}/api/grading/seed", timeout=HTTP_TIMEOUT), 403, "forbidden")
    assert_error(httpx.post(f"{app_url}/api/grading/seed", headers={"X-Grading-Token": BAD_CODE}, timeout=HTTP_TIMEOUT), 403, "forbidden")
    r = httpx.post(f"{app_url}/api/grading/seed", headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    s = r.json()
    assert (s["educator"]["email"], s["educator"]["password"], s["educator"]["displayName"]) == ("dana@hollowbrook.test", "kiln-maple-2026", "Dana Whitlock")
    assert (s["assistant"]["email"], s["assistant"]["password"]) == ("sam@hollowbrook.test", "brass-tack-2026")
    assert (s["personal"]["email"], s["personal"]["password"]) == ("priya@makers.test", "orbit-glue-2026")
    room = s["classroom"]
    assert (room["name"], room["joinCode"], room["timeZone"]) == ("Robotics Lab", "ROBO42", CHICAGO)
    opens = parse_instant(room["joinOpensAt"])
    assert parse_instant(room["joinClosesAt"]) - opens == timedelta(days=8)
    assert parse_instant(room["handInAt"]) - opens == timedelta(days=15)
    assert sorted(st["nickname"] for st in s["students"]) == ["Blue Fox", "Tiny Turtle"]
    assert len(s["projects"]) == 9 and s["storageSeeded"] is True
    for p in s["projects"]:
        assert p["revision"] == 3 and revision_keys(p["id"]) == expected_revisions(p["id"], 3)
    gear = next(p for p in s["projects"] if p["name"] == "Gear Box" and p["ownerId"] == s["students"][0]["id"])
    group = snapshot_at(gear["id"], 3)["objects"][0]
    assert group["kind"] == "group" and sorted(ch["mode"] for ch in group["children"]) == ["hole", "solid"]
    dana = api(app_url)
    assert dana.post("/api/auth/signin", json={"email": "dana@hollowbrook.test", "password": "kiln-maple-2026"}).status_code == 200
    seeded = dana.get(f"/api/classrooms/{room['id']}").json()
    assert seeded["state"] == "open" and all(st["handedIn"] is False for st in seeded["students"])
    for user, home in ((s["educator"]["id"], "/dashboard"), (s["personal"]["id"], "/projects"), (s["students"][0]["id"], "/class")):
        r = httpx.get(login_url(app_url, user), timeout=HTTP_TIMEOUT)
        assert r.status_code == 302 and r.headers["location"].endswith(home), (home, r.status_code, r.headers.get("location"))
        assert r.cookies.get("qy_session")
        assert api(app_url, r.cookies).get("/api/session").json()["account"]["id"] == user
    bad = f"{app_url}/api/grading/session?user={quote(s['educator']['id'])}&token={BAD_CODE}"
    assert_error(httpx.get(bad, timeout=HTTP_TIMEOUT), 403, "forbidden")
    assert_error(httpx.get(login_url(app_url, uuid.uuid4().hex), timeout=HTTP_TIMEOUT), 404, "not_found")
    clock = f"{app_url}/api/grading/clock"
    assert_error(httpx.post(clock, json={"now": None}, timeout=HTTP_TIMEOUT), 403, "forbidden")
    assert httpx.post(clock, json={"now": BAD_CODE}, headers=grading_headers(), timeout=HTTP_TIMEOUT).status_code == 422
    with grading_clock(app_url):
        target = minute(server_now(app_url)) + timedelta(days=WRONG_CLOCK_DAYS)
        assert abs(set_clock(app_url, target) - target) <= timedelta(minutes=1)
    assert abs(server_now(app_url) - datetime.now(timezone.utc)) <= timedelta(minutes=5)


def test_server_boundary(app_url: str) -> None:
    c = api(app_url)
    login = {"email": "dana@hollowbrook.test", "password": BAD_CODE}
    assert_error(c.post("/api/auth/signin", json=login, headers={"Origin": FOREIGN_ORIGIN}), 403, "forbidden")
    assert_error(c.post("/api/auth/signin", content="email=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media",
                 "Check the highlighted fields.")
    big = json.dumps({"email": "x" * JSON_MAX})
    assert_error(c.post("/api/auth/signin", content=big, headers={"Content-Type": "application/json"}), 413, "too_large")
    huge = json.dumps({"baseRevision": 1, "snapshot": {"kind": "3d", "pad": "x" * PROJECT_MAX}})
    assert_error(c.put(f"/api/projects/{uuid.uuid4().hex}", content=huge, headers={"Content-Type": "application/json"}), 413, "too_large")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts"):
        assert c.get(path).status_code == 404, path
    r = c.get("/api/health", headers={"Origin": FOREIGN_ORIGIN})
    assert CORS_HEADER not in r.headers
    secrets = [os.environ.get(n) for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")]
    html = c.get("/").text
    bodies = [html] + [c.get(src).text for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', html)]
    for value in filter(None, secrets):
        assert all(value not in body for body in bodies), "a service credential is served to the browser"


PAGE_PATHS = ["/", "/signin", "/signup", "/join"]


@pytest.mark.parametrize("viewport", [NARROW, MEDIUM, WIDE], ids=VIEWPORT_IDS)
def test_responsive_layouts(browser: Browser, app_url: str, mail: Mailpit, viewport: dict) -> None:
    room = make_room(app_url, mail, kids=1)
    kid = room.kids[0]
    pid = make_project(kid, "3d", "Gear Box", GEAR)["id"]

    def check_page(page: Page) -> None:
        layout(page)
        for b in page.get_by_role("button").all():
            box = b.bounding_box() if b.is_visible() else None
            if box and box["width"] > 0:
                assert box["width"] >= MIN_TARGET - 0.5 and box["height"] >= MIN_TARGET - 0.5, (page.url, b.get_attribute("aria-label"), box)

    with opened(browser, app_url, None, "/", viewport=viewport) as page:
        for path in PAGE_PATHS:
            page.goto(f"{app_url}{path}")
            check_page(page)
    with opened(browser, app_url, room.owner.id, "/dashboard", viewport=viewport) as page:
        for name in ("New 3D design", "New circuit", "New block program"):
            expect(page.get_by_role("link", name=name).first).to_be_visible()
        check_page(page)
        page.goto(f"{app_url}/classrooms/{room.id}")
        expect(tile(page, kid.name)).to_be_visible()
        check_page(page)
    with opened(browser, app_url, kid.id, "/class", viewport=viewport) as page:
        check_page(page)
        for path in (f"/editor/{pid}", "/editor/new?kind=circuit", "/editor/new?kind=blocks"):
            page.goto(f"{app_url}{path}")
            expect(button(page, "Export")).to_be_visible()
            check_page(page)


VISIBLE_PROPS = ["color", "background-color", "border-color", "box-shadow", "outline-color", "outline-style"]
CHAIN_JS = """(e, ps) => { const out = []; for (let n = e, i = 0; n && i < 4; n = n.parentElement, i++) {
  const c = getComputedStyle(n); out.push(ps.map(p => c.getPropertyValue(p)).join('|')); } return out; }"""


def visible_chain(loc: Locator, which: str) -> tuple[list[str], list[str]]:
    loc.page.mouse.move(0, 0)
    loc.blur()
    settle(loc)
    rest = loc.evaluate(CHAIN_JS, VISIBLE_PROPS)
    loc.hover() if which == "hover" else loc.focus()
    settle(loc)
    return rest, loc.evaluate(CHAIN_JS, VISIBLE_PROPS)


def test_hover_focus_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, None, "/") as page:
        targets = [page.get_by_role("link", name="Start a classroom").first, page.get_by_role("link", name="Sign up").first,
                   page.get_by_role("region", name="Starter projects").get_by_role("link", name="Desk Name Tag")]
        for loc in targets:
            for which in ("hover", "focus"):
                rest, active = state_styles(loc, "transform", "width", "height", "color", "background-color", "border-color",
                                            "box-shadow", "outline-color", "outline-style", state=which)
                for prop in ("transform", "width", "height"):
                    assert rest[prop] == active[prop], f"{which} changed {prop}: {rest[prop]} -> {active[prop]}"
                assert any(a != b for a, b in zip(*visible_chain(loc, which))), f"{which} changed nothing visible"
    with opened(browser, app_url, None, "/", viewport=NARROW, reduced_motion="reduce") as page:
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        advance(page, POSTER_STEP_MS)
        assert page.evaluate(LOOPS_JS) == 0, "an endless animation runs under reduced motion"
        flags = page.evaluate("() => Array.from(document.querySelectorAll('[data-playing]')).map(n => n.getAttribute('data-playing'))")
        assert flags and all(f == "false" for f in flags), flags
        button(page, "Menu").click()
        menu = page.get_by_role("dialog", name="Menu")
        expect(menu).to_be_visible()
        advance(page, FRAME_MS)
        assert opacity(menu) >= OPAQUE, "reduced motion: the Menu dialog faded in"


def test_landing_scenes_previews(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, None, "/") as page:
        expect(page.get_by_role("banner").get_by_role("link", name="Quarkyard home")).to_be_visible()
        expect(page.get_by_role("link", name="Sign in").first).to_be_visible()
        expect(page.get_by_role("link", name="Sign up").first).to_be_visible()
        expect(page.get_by_role("heading", level=1, name="Make a thing you can hold by Friday.")).to_be_visible()
        editors = page.get_by_role("region", name="Editors")
        for name in ("3D Workshop", "Circuit Bench", "Block Lab"):
            expect(editors.get_by_role("heading", name=name)).to_be_visible()
            expect(editors.get_by_role("link", name=f"Explore {name}")).to_be_visible()
            expect(page.get_by_role("link", name=f"Open {name}")).to_be_visible()
        expect(page.get_by_role("region", name="Classroom stats")).to_be_visible()
        expect(page.get_by_role("link", name="Set up your first class")).to_be_visible()
        footer = page.get_by_role("contentinfo")
        for name in ("Privacy", "Terms", "Student data"):
            expect(footer.get_by_role("link", name=name)).to_be_visible()
        poster = page.get_by_role("region", name="Build preview")
        pause = button(poster, "Pause build preview")
        expect(pause).to_have_attribute("aria-pressed", "false")
        assert "true" in poster.evaluate(PLAYING_JS)
        before = decode(capture(poster))
        advance(page, POSTER_STEP_MS)
        changed(before, decode(capture(poster)))
        pause.click()
        expect(pause).to_have_attribute("aria-pressed", "true")
        assert "true" not in poster.evaluate(PLAYING_JS)
        play = button(poster, "Play build preview")
        expect(play).to_be_visible()
        play.click()
        expect(pause).to_have_attribute("aria-pressed", "false")
        for name in ("Pause 3D Workshop preview", "Pause Circuit Bench preview", "Pause Block Lab preview", "Pause starter previews"):
            toggle = page.get_by_role("button", name=name)
            expect(toggle).to_have_attribute("aria-pressed", "false")
            toggle.click()
            expect(toggle).to_have_attribute("aria-pressed", "true")
        starters = page.get_by_role("region", name="Starter projects")
        for name in ("Desk Name Tag", "Pencil Cup", "Rainbow Lamp", "Spiral Tower", "Start a blank 3D design"):
            expect(starters.get_by_role("link", name=name)).to_be_visible()
        starters.get_by_role("link", name="Desk Name Tag").click()
        expect(page).to_have_url(re.compile(r"/signup"))
    with opened(browser, app_url, None, "/", reduced_motion="reduce") as page:
        for name in ("Pause build preview", "Pause 3D Workshop preview", "Pause Circuit Bench preview", "Pause Block Lab preview",
                     "Pause starter previews"):
            expect(page.get_by_role("button", name=name)).to_have_attribute("aria-pressed", "true")
    with opened(browser, app_url, None, "/", no_webgl=True) as page:
        expect(page.get_by_role("heading", level=1, name="Make a thing you can hold by Friday.")).to_be_visible()
        expect(page.get_by_role("region", name="Build preview")).to_be_visible()
        expect(page.get_by_role("button", name="Play build preview")).to_be_hidden()


def test_dialogs_and_status(browser: Browser, app_url: str, mail: Mailpit) -> None:
    room = make_room(app_url, mail, kids=0)
    with opened(browser, app_url, room.owner.id, f"/classrooms/{room.id}") as page:
        expect(page.get_by_role("status", name="Status")).to_have_count(1)
        opener = page.get_by_role("button", name="Show join code").first
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Join code")
        expect(dialog.locator(":focus")).to_have_count(1)
        first = "New code" if button(dialog, "New code").evaluate("e => e === document.activeElement") else "Close"
        assert first in ("New code", "Close"), f"focus opened on {first!r}"
        expect(button(dialog, first)).to_be_focused()
        other = "Close" if first == "New code" else "New code"
        assert tab_order(page, 4) == [other, first, other, first]
        page.keyboard.press("Shift+Tab")
        expect(button(dialog, other)).to_be_focused()
        for _ in range(4):
            button(dialog, "New code").click()
        expect(status(page)).to_contain_text("New join code ready")
        assert 1 <= status(page).inner_text().count("New join code ready") <= 3
        clear_status(page, app_url)
        expect(status(page)).not_to_contain_text("New join code ready")
        page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    with opened(browser, app_url, None, "/join", viewport=NARROW) as page:
        expect(page.get_by_role("status", name="Status")).to_have_count(1)
        menu_button = button(page, "Menu")
        menu_button.click()
        menu = page.get_by_role("dialog", name="Menu")
        expect(menu.get_by_role("link", name="Join a class")).to_be_visible()
        assert menu.evaluate(CONTAINS_FOCUS)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert menu.evaluate(CONTAINS_FOCUS), "Tab left the Menu dialog"
        page.keyboard.press("Escape")
        advance(page, DIALOG_SETTLE_MS)
        expect(menu_button).to_be_focused()


def notices_text() -> str:
    path = APP_DIR / "THIRD_PARTY_NOTICES.md"
    assert path.is_file(), "THIRD_PARTY_NOTICES.md is missing from /app"
    return path.read_text()


def run_manifest() -> dict:
    return json.loads((APP_DIR / "run.json").read_text())


def test_if_run_manifest() -> None:
    data = run_manifest()
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = notices_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing}"


def test_if_licences() -> None:
    bad = []
    for p in shipped_packages():
        allowed = ALLOWED_LICENCES | ({"OFL-1.1"} if "font" in p.name.lower() or "fira" in p.name.lower() else set())
        if not licence_allowed(p.licence, allowed):
            bad.append((p.name, p.licence))
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_extra_datastore() -> None:
    names = {p.name for p in shipped_packages()}
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "sqlite", "lowdb", "nedb", "level", "mongodb", "mongoose", "mysql", "mysql2"}
    assert not names & banned, names & banned


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, None, "/") as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        for path in ("/", "/join", "/signup"):
            page.goto(f"{app_url}{path}")
            page.evaluate("document.fonts.ready.then(() => true)")
        loaded = page.evaluate("() => Array.from(document.fonts).some(f => f.family.replace(/[\"']/g, '') === 'Fira Sans' && f.status === 'loaded')")
    foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign
    assert loaded, "Fira Sans was not loaded from the app"


def test_if_service_config(app_url: str, mail: Mailpit) -> None:
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    person = sign_up(app_url, "personal")
    assert addresses(mails_for(mail, person.email)[0].get("From")) == [mail_from_address()]
    serve = run_manifest()["serve"]
    for name in ("DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "GRADING_TOKEN"):
        assert f"{name}=" not in serve, f"run.json serve overrides {name}"


def test_if_lockfile() -> None:
    assert (APP_DIR / "package-lock.json").is_file(), "package-lock.json is missing from /app"
    assert "npm ci" in run_manifest()["install"]


def test_if_original_assets() -> None:
    notices = notices_text().lower()
    assets = [p.name for p in shipped_packages() if "lucide" in p.name.lower() or "fira" in p.name.lower()]
    missing = [n for n in assets if n.lower() not in notices]
    assert not missing, f"asset packages missing from THIRD_PARTY_NOTICES.md: {missing}"
