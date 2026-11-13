from __future__ import annotations

import hashlib
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.parse
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import session as cdp_session
from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    camera,
    capture,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    style,
    text,
    unique,
)


HTTP_TIMEOUT_S = 30
PROBE_TIMEOUT_S = 2
UI_WAIT_S = 20
API_WAIT_S = 20
BOOT_WAIT_S = 180
MAIL_WAIT_S = 30
QUICK_MS = 150
STEP_MS = 100
LIVE_S = 1
LIVE_UI_SLACK_S = 1
RECOVERY_S = 10
RECOVERY_SLACK_S = 5
DEBRIEF_MAIL_S = 10
MAIL_SLACK_S = 5
JSON_LIMIT = 100_000
MULTIPART_LIMIT = 5_100_000
PROP_FILE_LIMIT = 5_000_000
THUMBNAIL_LIMIT = 500_000
DEFAULT_DURATION_S = 3600
DEFAULT_COOLDOWN_S = 120
DEFAULT_LOCK_TTL_S = 30
PRESENCE_TTL_S = 30
CLOCK_TOLERANCE_S = 2
TIMER_SLACK_S = 15
LAPSE_SLACK_S = 5
DOLLY_MIN_MS = 500
DOLLY_MAX_MS = 700
DOLLY_STEP_MS = 50
REDUCED_HIDE_MS = 80
BREAKPOINT_PX = 768
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
PICKER_WIDTH_PX = 600
SHEET_MARGIN_PX = 12
HIT_PX = 44
PACK_COLUMN_MAX_PX = 960
ROSTER_MAX = 6
TOKEN_MIN = 32
NAME_MAX = 60
HINT_MAX = 280
DISPLAY_NAME_MAX = 40
ROOM_MIN_MM = 1000
ROOM_MAX_MM = 30_000
HEIGHT_MIN_MM = 2000
HEIGHT_MAX_MM = 6000
PROP_SIZE_MAX_MM = 30_000
SIZE_MIN_MM = 10
NUDGE_MM = 10
NUDGE_SHIFT_MM = 100
ROTATE_STEP = 15
ROTATE_TOP = 345
TOUR_STEPS = 7
SCHEDULE_AHEAD_DAYS = 30
SCHEDULE_PAST_MIN = 5
TAB_PRESSES = 40
VALKEY_DEFAULT_PORT = 6379
HTTP_DEFAULT_PORT = 80
HTTPS_DEFAULT_PORT = 443
WRONG_DEVICE_TIME = datetime(2030, 1, 1, tzinfo=timezone.utc)
FOREIGN_ORIGIN = "http://elsewhere.invalid"
JUNK_TOKEN = "zz" + "Q" * 40
UNKNOWN_ID = "00000000-0000-0000-0000-000000000000"

MARA = ("mara@lanternlane.test", "keyway-owner-1", "Mara Quint")
TOBI = ("tobi@lanternlane.test", "keyway-codesign-1", "Tobi Ferreira")
INES = ("ines@brasskey.test", "keyway-other-1", "Ines Albright")

EDITOR_PATH = "/app"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
SOURCE_PATHS = ("/run.json", "/.env", "/package.json", "/package-lock.json")
MANIFEST_SCHEMA = "run-manifest-v1"
HINT_TEXT = "Look under the desk"
RENAMED_JOINER = "Pat B"
JOINER_NAME = "Ana"
TESTER_NAME = "Robin"
RENAMED_CLUE = "Clue 2"
CUE_TITLE = "Lights"
MID_MM = 3000
VAULT_WIDTH_MM = 3000
NEAR_EDGE_MM = VAULT_WIDTH_MM - NUDGE_SHIFT_MM
CO_EDIT_X_MM = ROOM_MIN_MM + NUDGE_SHIFT_MM * 2
START_X_MM = ROOM_MIN_MM + NUDGE_SHIFT_MM * 5
PROP_WIDTH_MM = NUDGE_SHIFT_MM * 9
RENAMED_NODE = "Morse key two"
MORSE_KEY = "Morse key"
SEA_CHEST = "Coffre à secrets"
COLOUR_SETTLE_MS = 500
RESYNC_MS = 15_000
TAB_BAR_PX = 60
RAISED_PX = 56
EDGE_SLACK_PX = 1
RETRY_MS = 5000
START_YAW = 30
START_PITCH = 35
PITCH_MAX = 80
PITCH_MIN = 5
CAM_STEP = 15
DRAG_PX = 120
DRAG_YAW = 90
DRAG_UP_PX = 40
TOUCH_STEPS = 8
TOUCH_STEP_MS = 16
DROP_FROM_MM = 1200
DROP_LAND_STEPS = 59
FALL_NUM = 109
FALL_DEN = 320
FALL_SAMPLE_MS = 40
FALL_WAIT_MS = 1000
PALETTE_COMMANDS = ["Start playtest", "Freeze version...", "Restore version...", "Open Versions",
                    "Open Prop library", "Open Trigger graph", "Keyboard shortcuts"]
LIVE_BANNER = "Live editing is paused. Solo editing still works."
SAVE_GLOB = "**/api/rooms/*/placements/*"
SCENE_MOVE_GLOB = "**/api/rooms/*/placements/*/scene-move"
CHEST = "Chest"
CRATE = "Crate"
HANGING = "Hanging crate"
CORNER = "Corner peg"
SCENE_LABELS = ["Alpha crate", "Bravo crate", "Charlie crate", "Delta crate"]
HOLDER_ROTATION = 30
TAKER_ROTATION = 45
BEFORE_LABEL = "Before move"
AFTER_LABEL = "After move"
PHONE_LABEL = "Phone pass"
BAD_OP_ID = "bad id!"

STARTERS = {
    "Apothecary": (0, 6, 3, 4),
    "Observatory": (0, 4, 2, 2),
    "Ship's Hold": (0, 5, 5, 4),
    "Signal Cabin": (0, 4, 2, 2),
    "Vault": (0, 6, 6, 3),
}
VAULT_CHAIN = ["Ledger cipher", "Drawer sensor", "Maglock 3", "Blacklight cue", "Safe dial", "Vault door"]
APOTHECARY_CHAIN = ["Herb cabinet code", "Scale balance", "Cabinet maglock", "Blacklight label", "Antidote recipe", "Exit door"]
SERVICES = ("postgres", "valkey", "minio", "mail")

VIEWPORTS = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}

UPLOAD_CASES = [
    "glb",
    "gltf_json",
    "exact_limit",
    "over_limit",
    "glb_version_1",
    "json_version_1",
    "png",
    "missing_name",
    "missing_dims",
    "size_too_small",
    "size_too_large",
]


def require(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def outage_url(var: str) -> str:
    value = os.environ.get(var)
    if not value:
        pytest.fail(f"{var} is not set; the verifier provides every outage instance URL")
    return value.rstrip("/")


def tag_for(seed: str) -> str:
    return hashlib.sha1(seed.encode()).hexdigest()[:8]


def fresh(prefix: str = "visitor") -> tuple[str, str]:
    first, second = unique(prefix)
    email = first if "@" in first else second
    return email, tag_for(first + second)


def client(base: str, cookies: Any = None) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT_S, cookies=cookies)


def ok(response: httpx.Response, status: int = 200) -> Any:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url.path}: expected {status}, "
        f"got {response.status_code} {response.text[:400]}"
    )
    return response.json() if response.content else None


def err(response: httpx.Response, status: int, code: str) -> dict:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url.path}: expected {status} {code}, "
        f"got {response.status_code} {response.text[:400]}"
    )
    body = response.json()
    assert body.get("error") == code, f"error body {body}; expected error {code}"
    return body


def invalid(response: httpx.Response, field: str, message: str | None = None) -> dict:
    body = err(response, 422, "validation")
    assert field in body.get("errors", {}), f"validation errors {body}; expected one on {field}"
    if message is not None:
        assert body["errors"][field] == message, f"errors.{field} = {body['errors'][field]!r}; expected {message!r}"
    return body


@dataclass
class Member:
    base: str
    c: httpx.Client
    user: dict
    workspace: dict
    email: str
    password: str
    tag: str


def signup(base: str, prefix: str = "owner") -> Member:
    email, tag = fresh(prefix)
    password = f"bench-{tag}-pass"
    c = client(base)
    body = ok(
        c.post(
            "/api/auth/signup",
            json={"email": email, "password": password, "displayName": f"Owner {tag}", "venueName": f"Venue {tag}"},
        ),
        201,
    )
    return Member(base.rstrip("/"), c, body["user"], body["workspace"], email, password, tag)


def login_as(base: str, email: str, password: str) -> Member:
    c = client(base)
    ok(c.post("/api/auth/login", json={"email": email, "password": password}))
    me = ok(c.get("/api/me"))
    _, tag = fresh("tag")
    return Member(base.rstrip("/"), c, me["user"], me["workspace"], email, password, tag)


def login(base: str, who: tuple[str, str, str]) -> Member:
    return login_as(base, who[0], who[1])


def health(base: str) -> dict:
    return ok(httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S))


def server_now(base: str) -> datetime:
    response = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
    return parsedate_to_datetime(response.headers["date"]).astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def rooms_by_name(m: Member) -> dict[str, dict]:
    return {room["name"]: room for room in ok(m.c.get("/api/rooms"))["rooms"]}


def room_detail(m: Member, room_id: str) -> dict:
    return ok(m.c.get(f"/api/rooms/{room_id}"))


def room_stats(m: Member, room_id: str) -> dict:
    return room_detail(m, room_id)["room"]["stats"]


def make_room(m: Member, name: str, width: int = 4000, depth: int = 3500, height: int = 2700) -> dict:
    return ok(m.c.post("/api/rooms", json={"name": name, "widthMm": width, "depthMm": depth, "heightMm": height}), 201)["room"]


def placement_body(label: str, kind: str = "box", **fields: Any) -> dict:
    body = {"kind": kind, "label": label, "xMm": 1000, "yMm": 0, "zMm": 1000, "rotationDeg": 0,
            "widthMm": 500, "depthMm": 500, "heightMm": 500}
    body.update(fields)
    return body


def add_placement(m: Member, room_id: str, label: str, kind: str = "box", **fields: Any) -> dict:
    return ok(m.c.post(f"/api/rooms/{room_id}/placements", json=placement_body(label, kind, **fields)), 201)["placement"]


def add_node(m: Member, room_id: str, title: str, kind: str = "puzzle", prerequisites: list[str] | None = None,
             answer: str | None = None, placement_id: str | None = None) -> dict:
    body = {"title": title, "kind": kind, "prerequisites": prerequisites or [], "answer": answer, "placementId": placement_id}
    return ok(m.c.post(f"/api/rooms/{room_id}/nodes", json=body), 201)["node"]


def nodes_by_title(detail: dict) -> dict[str, dict]:
    return {node["title"]: node for node in detail["nodes"]}


def placements_by_label(detail: dict) -> dict[str, dict]:
    return {p["label"]: p for p in detail["placements"]}


def placement_now(m: Member, room_id: str, placement_id: str) -> dict | None:
    for placement in room_detail(m, room_id)["placements"]:
        if placement["id"] == placement_id:
            return placement
    return None


def schedule(m: Member, room_id: str, starts: datetime) -> dict:
    return ok(m.c.post("/api/playtests", json={"roomId": room_id, "startsAt": iso(starts)}), 201)["session"]


def walk_in(m: Member, room_id: str) -> dict:
    return ok(m.c.post(f"/api/rooms/{room_id}/walk-in"), 201)["session"]


def session_get(m: Member, session_id: str) -> dict:
    return ok(m.c.get(f"/api/playtests/{session_id}"))["session"]


def move(m: Member, session_id: str, action: str) -> dict:
    return ok(m.c.post(f"/api/playtests/{session_id}/{action}"))["session"]


def invite(m: Member, session_id: str, email: str) -> dict:
    return ok(m.c.post(f"/api/playtests/{session_id}/invites", json={"email": email}), 201)["invite"]


def token_of(url: str) -> str:
    return urllib.parse.urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]


def host_solve(m: Member, session_id: str, node_id: str, answer: str | None = None) -> dict:
    return ok(m.c.post(f"/api/playtests/{session_id}/solves", json={"nodeId": node_id, "answer": answer}))


def freeze(m: Member, room_id: str, label: str, key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return m.c.post(f"/api/rooms/{room_id}/versions", json={"label": label}, headers=headers)


def versions(m: Member, room_id: str) -> list[dict]:
    return ok(m.c.get(f"/api/rooms/{room_id}/versions"))["versions"]


def mmss(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def mss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def figures(solved: int, total: int, run: int, props: int) -> tuple[str, str, str]:
    return (f"{solved} of {total} solved", f"Longest run {run}", "1 prop" if props == 1 else f"{props} props")


def card_line(solved: int, total: int, run: int, props: int) -> str:
    return " · ".join(figures(solved, total, run, props))


def stats_figures(stats: dict) -> tuple[str, str, str]:
    return figures(stats["solved"], stats["total"], stats["longestRun"], stats["props"])


def metres(mm: int) -> str:
    return f"{mm // 1000}.{mm % 1000:03d}"


def feet(mm: int) -> str:
    sixteenths = (mm * 160 + 127) // 254
    whole_feet, rest = divmod(sixteenths, 192)
    inches, fraction = divmod(rest, 16)
    if fraction == 0:
        return f"{whole_feet}' {inches}\""
    divisor = math.gcd(fraction, 16)
    return f"{whole_feet}' {inches} {fraction // divisor}/{16 // divisor}\""


TOKEN_SAFE = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&+-.^_`|~")


def disposition(name: str, ext: str) -> str:
    ascii_name = "".join(ch if (" " <= ch <= "~" and ch not in '"\\') else "_" for ch in name)
    encoded = "".join(chr(b) if chr(b) in TOKEN_SAFE else f"%{b:02X}" for b in name.encode("utf-8"))
    return f"attachment; filename=\"{ascii_name}.{ext}\"; filename*=UTF-8''{encoded}.{ext}"


def glb(total: int | None = None, version: int = 2) -> bytes:
    js = json.dumps({"asset": {"version": "2.0"}}).encode()
    js += b" " * (-len(js) % 4)
    payload = os.urandom(256 if total is None else total - 12 - 8 - len(js) - 8)
    length = 12 + 8 + len(js) + 8 + len(payload)
    return (b"glTF" + struct.pack("<II", version, length) + struct.pack("<I", len(js)) + b"JSON" + js
            + struct.pack("<I", len(payload)) + b"BIN\x00" + payload)


def gltf_json(asset_version: str = "2.0") -> bytes:
    return json.dumps({"asset": {"version": asset_version}, "scenes": [{"nodes": []}],
                       "extras": {"nonce": os.urandom(8).hex()}}).encode()


def png(size: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
    iend = chunk(b"IEND", b"")
    if size is None:
        return signature + ihdr + idat + iend
    pad = size - len(signature + ihdr + idat + iend) - 12
    return signature + ihdr + chunk(b"tEXt", b"k\x00" + b"x" * (pad - 2)) + idat + iend


def upload(c: httpx.Client, name: str | None, data: bytes, *, filename: str = "sea-chest.glb",
           content_type: str = "model/gltf-binary", dims: tuple[int, int, int] | None = (900, 500, 600)) -> httpx.Response:
    form: dict[str, str] = {}
    if name is not None:
        form["name"] = name
    if dims is not None:
        form.update({"widthMm": str(dims[0]), "depthMm": str(dims[1]), "heightMm": str(dims[2])})
    return c.post("/api/props", data=form, files={"file": (filename, data, content_type)})


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def clone(m: Member) -> httpx.Client:
    return client(m.base, cookies=m.c.cookies)


def poll(fetch: Callable[[], Any], pred: Callable[[Any], bool], what: str, seconds: float = API_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if pred(last):
            return last
    pytest.fail(f"{what}; last seen {str(last)[:400]}")


def mails(mail: Any, *, to: str | None = None, subject: str | None = None) -> list[dict]:
    found = []
    for message in mail.messages(0, settle=0):
        if to and to.lower() not in [a.lower() for a in addresses(message.get("To"))]:
            continue
        if subject and message.get("Subject") != subject:
            continue
        found.append(message)
    return found


def wait_mail(mail: Any, what: str, *, count: int = 1, seconds: float = MAIL_WAIT_S, **match: str) -> list[dict]:
    return poll(lambda: mails(mail, **match), lambda found: len(found) >= count, what, seconds)


class Stream:

    def __init__(self, base: str, path: str, cookies: Any = None) -> None:
        self.items: list[tuple[str, Any, float]] = []
        self.cond = threading.Condition()
        self.status: int | None = None
        self.response: httpx.Response | None = None
        self.opened = threading.Event()
        self.client = httpx.Client(base_url=base.rstrip("/"), cookies=cookies,
                                   timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=None))
        threading.Thread(target=self._run, args=(path,), daemon=True).start()
        if not self.opened.wait(HTTP_TIMEOUT_S) or self.status != 200:
            pytest.fail(f"GET {path} did not open a text/event-stream (status {self.status})")

    def _run(self, path: str) -> None:
        try:
            with self.client.stream("GET", path, headers={"Accept": "text/event-stream"}) as response:
                self.status = response.status_code
                self.response = response
                self.opened.set()
                name, data = "message", []
                for line in response.iter_lines():
                    if line == "":
                        if data:
                            raw = "\n".join(data)
                            try:
                                payload: Any = json.loads(raw)
                            except ValueError:
                                payload = raw
                            with self.cond:
                                self.items.append((name, payload, time.monotonic()))
                                self.cond.notify_all()
                        name, data = "message", []
                    elif line.startswith(":"):
                        continue
                    elif line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        value = line[5:]
                        data.append(value[1:] if value.startswith(" ") else value)
        except Exception:
            pass
        finally:
            self.opened.set()

    def mark(self) -> int:
        with self.cond:
            return len(self.items)

    def wait(self, pred: Callable[[str, Any], bool], what: str, since: int = 0,
             seconds: float = API_WAIT_S) -> tuple[str, Any, float]:
        deadline = time.monotonic() + seconds
        with self.cond:
            while time.monotonic() < deadline:
                for item in self.items[since:]:
                    if pred(item[0], item[1]):
                        return item
                self.cond.wait(max(0.0, deadline - time.monotonic()))
            for item in self.items[since:]:
                if pred(item[0], item[1]):
                    return item
        pytest.fail(f"{what}; events seen {[i[0] for i in self.items[since:]]}")

    def __enter__(self) -> "Stream":
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            if self.response is not None:
                self.response.close()
        finally:
            self.client.close()


@contextmanager
def opened(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    manager = open_app(browser, url, **options)
    if hasattr(manager, "__enter__"):
        with manager as page:
            yield page
    else:
        page = next(manager)
        try:
            yield page
        finally:
            manager.close()


@contextmanager
def holding(page: Page, url_glob: str) -> Iterator[Any]:
    manager = held(page, url_glob)
    if hasattr(manager, "__enter__"):
        with manager as hold:
            yield hold
    else:
        hold = next(manager)
        try:
            yield hold
        finally:
            manager.close()


@contextmanager
def member_page(browser: Browser, m: Member, path: str = "/app", **options: Any) -> Iterator[Page]:
    with opened(browser, m.base + "/signin", **options) as page:
        cookie = m.c.cookies.get("kb_session")
        require(cookie, "sign-in set the kb_session cookie")
        page.context.add_cookies([{"name": "kb_session", "value": cookie, "url": m.base}])
        page.goto(m.base + path)
        yield page


def eventually(page: Page | None, probe: Callable[[], None], what: str, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: AssertionError | None = None
    while time.monotonic() < deadline:
        try:
            probe()
            return
        except AssertionError as error:
            last = error
        if page is not None:
            advance(page, STEP_MS)
    pytest.fail(f"{what} (last: {str(last)[:300]})")


def shows(page: Page, locator: Locator, what: str, *, exact: str | re.Pattern | None = None,
          contains: str | re.Pattern | None = None, seconds: float = UI_WAIT_S) -> None:
    def probe() -> None:
        expect(locator).to_be_visible(timeout=QUICK_MS)
        if exact is not None:
            expect(locator).to_have_text(exact, timeout=QUICK_MS)
        if contains is not None:
            expect(locator).to_contain_text(contains, timeout=QUICK_MS)

    eventually(page, probe, what, seconds)


def api_until(page: Page | None, fetch: Callable[[], Any], pred: Callable[[Any], bool], what: str,
              seconds: float = API_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if pred(last):
            return last
        if page is not None:
            advance(page, STEP_MS)
    pytest.fail(f"{what}; last seen {str(last)[:400]}")


def gone(locator: Locator) -> bool:
    if locator.count() == 0:
        return True
    first = locator.first
    if not first.is_visible():
        return True
    opacity = style(first, "opacity").get("opacity") or ""
    if not opacity:
        return locator.count() == 0 or not locator.first.is_visible()
    return float(opacity) == 0.0


def wait_gone(page: Page, locator: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: require(gone(locator), what), what, seconds)


def picker(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Open a room")


def camera_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Camera")


def editor_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Editor status")


def chain_figures(page: Page) -> Locator:
    return page.get_by_role("group", name="Chain figures")


def stage(page: Page) -> Locator:
    return page.get_by_role("region", name="Room stage")


def open_room(page: Page, name: str, *, walk_in: bool = False) -> None:
    dialog = picker(page)
    shows(page, dialog, "the editor opens on the Open a room dialog")
    box = dialog.get_by_role("checkbox", name="Walk in when I pick a room")
    if box.is_checked() != walk_in:
        click(box)
    eventually(page, lambda: expect(box).to_be_checked(checked=walk_in, timeout=QUICK_MS), "walk-in checkbox set")
    click(dialog.get_by_role("option", name=name))
    wait_gone(page, dialog, f"picking {name} closes the Open a room dialog")
    if not walk_in:
        shows(page, camera_status(page), f"{name} opens at the overview camera", exact="Overview")


def clock_seconds(locator: Locator) -> int:
    match = re.search(r"(\d+):(\d{2})", locator.inner_text())
    require(match, f"Playtest clock reads mm:ss, got {locator.inner_text()!r}")
    return int(match[1]) * 60 + int(match[2])


def page_clock_seconds(page: Page) -> int:
    body = page.evaluate("() => document.body.innerText")
    match = re.search(r"\b(\d{2}):(\d{2})\b", body)
    require(match, "the tester page shows the playtest clock as mm:ss")
    return int(match[1]) * 60 + int(match[2])


def scale_of(locator: Locator) -> float:
    value = style(locator, "transform").get("transform", "none")
    if value == "none":
        return 1.0
    numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", value)]
    return numbers[0] if numbers else 1.0


def focus_inside(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el.contains(document.activeElement)"))


def matrices_equal(a: list[list[float]], b: list[list[float]]) -> bool:
    return len(a) == len(b) and all(
        len(x) == len(y) and all(math.isclose(p, q) for p, q in zip(x, y)) for x, y in zip(a, b)
    )


def scroll_to_fraction(page: Page, fraction: float) -> None:
    page.evaluate(
        "f => window.scrollTo(0, f * (document.documentElement.scrollHeight - window.innerHeight))", fraction
    )
    advance(page, STEP_MS)


def colours(page: Page, locator: Locator) -> list:
    advance(page, COLOUR_SETTLE_MS)
    settle(locator)
    return locator.evaluate("e => [e, ...e.querySelectorAll('*')].map(n => { const s = getComputedStyle(n);"
                            " return [s.color, s.backgroundColor, s.borderTopColor, s.fill, s.stroke]; })")


def names_are(locator: Locator, names: list[str]) -> None:
    expect(locator).to_have_count(len(names))
    for index, name in enumerate(names):
        expect(locator.nth(index)).to_have_accessible_name(name)


def op_id() -> str:
    return "op-" + hashlib.sha1(os.urandom(16)).hexdigest()[:20]


def revision(m: Member, room_id: str) -> int:
    return room_detail(m, room_id)["room"]["revision"]


def changes(m: Member, room_id: str, since: int) -> list[dict]:
    return ok(m.c.get(f"/api/rooms/{room_id}/changes", params={"since": since}))["changes"]


def patch_now(m: Member, room_id: str, placement_id: str, **fields: Any) -> dict:
    current = placement_now(m, room_id, placement_id)
    require(current, f"placement {placement_id} exists")
    body = {"version": current["version"], **fields}
    return ok(m.c.patch(f"/api/rooms/{room_id}/placements/{placement_id}", json=body))["placement"]


def scene_item(page: Page, label: str) -> Locator:
    return page.get_by_role("tree", name="Scene").get_by_role("treeitem", name=label, exact=True)


def connection(page: Page) -> Locator:
    return page.get_by_role("status", name="Connection")


def inspector(page: Page) -> Locator:
    return page.get_by_role("region", name="Inspector")


def has_attr(page: Page, locator: Locator, name: str, value: Any, what: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: expect(locator).to_have_attribute(name, str(value), timeout=QUICK_MS), what, seconds)


def focused(page: Page, locator: Locator, what: str) -> None:
    eventually(page, lambda: expect(locator).to_be_focused(timeout=QUICK_MS), what)


def tab_bar(page: Page) -> dict:
    box = page.get_by_role("toolbar", name="Transport").bounding_box()
    require(box, "the phone tab bar keeps toolbar Transport")
    assert abs(box["height"] - TAB_BAR_PX) <= EDGE_SLACK_PX, f"the tab bar is {box['height']} px tall, not 60"
    assert abs(box["y"] + box["height"] - PHONE[1]) <= EDGE_SLACK_PX, f"the tab bar ends at {box['y'] + box['height']}"
    assert box["x"] <= EDGE_SLACK_PX and box["x"] + box["width"] >= PHONE[0] - EDGE_SLACK_PX, "the tab bar spans the width"
    return box


def raised_on_bar(button: Locator, bar: dict, what: str) -> None:
    box = button.bounding_box()
    require(box, f"{what} is shown")
    assert abs(box["width"] - RAISED_PX) <= EDGE_SLACK_PX and abs(box["height"] - RAISED_PX) <= EDGE_SLACK_PX, \
        f"{what} is a 56 px circle, got {box['width']}x{box['height']}"
    centre = box["y"] + box["height"] / 2
    assert abs(centre - bar["y"]) <= EDGE_SLACK_PX, f"{what} centre {centre} is not on the tab bar's top edge {bar['y']}"


def above_bar(locator: Locator, bar: dict, what: str) -> None:
    box = locator.bounding_box()
    require(box, f"{what} is shown")
    assert box["y"] + box["height"] <= bar["y"] + EDGE_SLACK_PX, \
        f"{what} ends at {box['y'] + box['height']}, under the tab bar's top edge {bar['y']}"


def phone_sheet(sheet: Locator, bar: dict, what: str) -> None:
    box = sheet.bounding_box()
    require(box, f"{what} is shown")
    assert abs(box["x"] - SHEET_MARGIN_PX) <= EDGE_SLACK_PX, f"{what} left margin {box['x']}"
    assert abs(PHONE[0] - box["x"] - box["width"] - SHEET_MARGIN_PX) <= EDGE_SLACK_PX, f"{what} right margin"
    above_bar(sheet, bar, what)


def touch_drag(page: Page, x: float, y: float, dx: float, dy: float) -> None:
    cdp = cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
    for i in range(1, TOUCH_STEPS + 1):
        point = {"x": x + dx * i / TOUCH_STEPS, "y": y + dy * i / TOUCH_STEPS, "id": 1}
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})
        advance(page, TOUCH_STEP_MS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, STEP_MS)


def fall_height(y0: int, steps: int) -> Fraction:
    return Fraction(y0) - Fraction(FALL_NUM * steps * (steps + 1), FALL_DEN)


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = False
        self.closed = False
        self.conns: list[socket.socket] = []
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.closed:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                conn.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
                upstream.settimeout(None)
            except OSError:
                conn.close()
                continue
            self.conns += [conn, upstream]
            for src, dst in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        self.closed = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()
        for conn in self.conns:
            try:
                conn.close()
            except OSError:
                pass


def env_required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.fail(f"{name} must be set in the verifier environment to start an app copy")
    return value


def relay_for_url(url: str, default_port: int) -> tuple[Relay, str]:
    parts = urllib.parse.urlsplit(url)
    relay = Relay(parts.hostname or "127.0.0.1", parts.port or default_port)
    auth = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    return relay, urllib.parse.urlunsplit((parts.scheme, f"{auth}127.0.0.1:{relay.port}", parts.path, parts.query, parts.fragment))


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        ready = False
        while time.monotonic() < deadline and not ready:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
            try:
                ready = httpx.get(base + "/api/health", timeout=PROBE_TIMEOUT_S).status_code == 200
            except httpx.HTTPError:
                ready = False
        if not ready:
            pytest.fail(f"app copy never answered GET /api/health 200 with its dependencies down:\n{tail()}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_health_reports_services(app_url: str) -> None:
    response = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["instance"], str) and body["instance"]
    assert body["services"] == {name: "up" for name in SERVICES}
    peer = health(outage_url("APP_PEER_URL"))
    assert peer["status"] == "ok"
    assert peer["services"] == {name: "up" for name in SERVICES}
    assert peer["instance"] != body["instance"], "each instance reports its own INSTANCE_NAME"


def test_signup_signin_and_signed_out_refusals(app_url: str) -> None:
    email, tag = fresh("signup")
    password = f"bench-{tag}-pass"
    c = client(app_url)
    response = c.post("/api/auth/signup", json={"email": email, "password": password,
                                               "displayName": f"Owner {tag}", "venueName": f"Venue {tag}"})
    body = ok(response, 201)
    assert body["user"]["email"].lower() == email.lower()
    assert body["user"]["role"] == "owner"
    assert body["user"]["displayName"] == f"Owner {tag}"
    assert body["workspace"]["name"] == f"Venue {tag}"
    cookie = [h for h in response.headers.get_list("set-cookie") if h.startswith("kb_session=")]
    assert cookie, "sign-up sets the kb_session cookie"
    assert all(flag.lower() in cookie[0].lower() for flag in COOKIE_FLAGS)

    rooms = ok(c.get("/api/rooms"))["rooms"]
    assert [r["name"] for r in rooms] == list(STARTERS), "five starter rooms sorted by name"
    for room in rooms:
        assert room["starter"] is True
        solved, total, run, props = STARTERS[room["name"]]
        assert room["stats"] == {"solved": solved, "total": total, "longestRun": run, "props": props}
    me = ok(c.get("/api/me"))
    assert me["user"]["id"] == body["user"]["id"] and me["workspace"]["id"] == body["workspace"]["id"]

    other = client(app_url)
    assert ok(other.post("/api/auth/login", json={"email": email, "password": password}))["user"]["id"] == body["user"]["id"]
    assert other.cookies.get("kb_session")
    err(client(app_url).post("/api/auth/login", json={"email": email, "password": password + "x"}), 401, "invalid_credentials")
    err(client(app_url).post("/api/auth/signup", json={"email": email.upper(), "password": password,
                                                      "displayName": "Dup", "venueName": "Dup"}), 409, "email_taken")
    second, _ = fresh("signup")
    invalid(client(app_url).post("/api/auth/signup", json={"email": second, "password": "x" * 9,
                                                          "displayName": "A", "venueName": "B"}), "password")
    invalid(client(app_url).post("/api/auth/signup", json={"email": second, "password": password,
                                                          "displayName": "", "venueName": "B"}), "displayName")
    invalid(client(app_url).post("/api/auth/signup", json={"email": second, "password": password,
                                                          "displayName": "A", "venueName": "v" * (NAME_MAX + 1)}), "venueName")
    assert client(app_url).post("/api/auth/login", json={"email": second, "password": password}).status_code == 401, \
        "a refused sign-up created no account"

    room_id = rooms[0]["id"]
    assert other.post("/api/auth/logout").status_code == 204
    err(other.get("/api/me"), 401, "unauthenticated")
    anon = client(app_url)
    for method, path, payload in [
        ("GET", "/api/me", None),
        ("GET", "/api/rooms", None),
        ("POST", "/api/rooms", {"name": "x", "widthMm": 3000, "depthMm": 3000, "heightMm": 2400}),
        ("GET", f"/api/rooms/{room_id}", None),
        ("GET", f"/api/rooms/{room_id}/versions", None),
        ("GET", "/api/props", None),
        ("POST", "/api/playtests", {"roomId": room_id, "startsAt": iso(server_now(app_url))}),
    ]:
        body = err(anon.request(method, path, json=payload), 401, "unauthenticated")
        assert set(body) == {"error"}, f"{method} {path}: error body carries only error, got {body}"


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + EDITOR_PATH) as page:
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/signin$"), timeout=QUICK_MS),
                   "signed-out visitors at /app go to /signin")
        form = page.get_by_role("form", name="Sign in")
        fill(form.get_by_role("textbox", name="Email"), MARA[0])
        fill(form.get_by_label("Password", exact=True), "not-the-password")
        click(form.get_by_role("button", name="Sign in"))
        shows(page, page.get_by_text("That email and password don't match.", exact=True),
              "sign-in failure shows the published copy")
        fill(form.get_by_label("Password", exact=True), MARA[1])
        click(form.get_by_role("button", name="Sign in"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/app(/rooms/[^/]+)?$"), timeout=QUICK_MS),
                   "signing in lands on the editor")
        shows(page, picker(page), "the editor opens on the Open a room dialog")
        page.goto(app_url + "/")
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/app(/rooms/[^/]+)?$"), timeout=QUICK_MS),
                   "signed-in visitors at / go to /app")


def test_workspace_isolation_and_roles(app_url: str) -> None:
    mara, tobi, ines = login(app_url, MARA), login(app_url, TOBI), login(app_url, INES)
    room = make_room(mara, f"Isolation {mara.tag}")
    rid = room["id"]
    placement = add_placement(mara, rid, "Crate")
    prop = ok(upload(mara.c, f"Iso prop {mara.tag}", glb()), 201)["prop"]
    assert rid not in [r["id"] for r in ok(ines.c.get("/api/rooms"))["rooms"]]
    assert prop["id"] not in [p["id"] for p in ok(ines.c.get("/api/props"))["props"]]
    for method, path, payload in [
        ("GET", f"/api/rooms/{rid}", None),
        ("PATCH", f"/api/rooms/{rid}", {"version": room["version"], "name": "Taken over"}),
        ("GET", f"/api/rooms/{rid}/versions", None),
        ("POST", f"/api/rooms/{rid}/placements", placement_body("Intruder")),
        ("DELETE", f"/api/rooms/{rid}/placements/{placement['id']}", None),
        ("POST", f"/api/rooms/{rid}/locks", {"targetType": "placement", "targetId": placement["id"]}),
        ("POST", "/api/playtests", {"roomId": rid, "startsAt": iso(server_now(app_url) + timedelta(minutes=10))}),
        ("GET", f"/api/props/{prop['id']}/file", None),
    ]:
        body = err(ines.c.request(method, path, json=payload), 404, "not_found")
        assert set(body) == {"error"}
    detail = room_detail(mara, rid)
    assert detail["room"]["name"] == room["name"] and len(detail["placements"]) == 1
    assert ok(mara.c.get(f"/api/rooms/{rid}/playtests"))["sessions"] == []

    own = make_room(tobi, f"Codesign {mara.tag}")
    assert ok(tobi.c.patch(f"/api/rooms/{rid}/placements/{placement['id']}",
                           json={"version": placement["version"], "xMm": CO_EDIT_X_MM}))["placement"]["xMm"] == CO_EDIT_X_MM
    err(tobi.c.post("/api/playtests", json={"roomId": own["id"], "startsAt": iso(server_now(app_url) + timedelta(minutes=10))}),
        403, "forbidden")
    assert ok(tobi.c.get(f"/api/rooms/{own['id']}/playtests"))["sessions"] == []
    err(freeze(tobi, rid, "Not mine"), 403, "forbidden")
    assert versions(mara, rid) == []
    version = ok(freeze(mara, rid, "Owner pass"), 201)["version"]
    err(tobi.c.post(f"/api/versions/{version['id']}/link"), 403, "forbidden")
    err(tobi.c.delete(f"/api/versions/{version['id']}/link"), 403, "forbidden")
    listed = versions(tobi, rid)
    assert [v["id"] for v in listed] == [version["id"]] and listed[0]["packUrl"] == version["packUrl"]


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = client(app_url)
    big = json.dumps({"name": "x" * JSON_LIMIT, "widthMm": 3000, "depthMm": 3000, "heightMm": 2400}).encode()
    body = err(anon.post("/api/rooms", content=big, headers={"content-type": "application/json"}), 413, "too_large")
    assert set(body) == {"error"}
    assert set(err(anon.get(f"/api/rooms/{UNKNOWN_ID}"), 401, "unauthenticated")) == {"error"}
    assert set(err(anon.get(f"/api/pack/{JUNK_TOKEN}"), 404, "not_found")) == {"error"}
    err(anon.get(f"/api/play/{JUNK_TOKEN}"), 404, "not_found")

    mara, tobi, ines = login(app_url, MARA), login(app_url, TOBI), login(app_url, INES)
    clocktower = rooms_by_name(ines)["Clocktower Draft"]
    err(tobi.c.post(f"/api/rooms/{clocktower['id']}/versions", json={"label": ""}), 404, "not_found")
    own = make_room(mara, f"Precedence {mara.tag}")
    assert set(err(tobi.c.post(f"/api/rooms/{own['id']}/versions", json={"label": ""}), 403, "forbidden")) == {"error"}
    validation = invalid(freeze(mara, own["id"], ""), "label")
    assert set(validation) == {"error", "errors"}
    session = schedule(mara, own["id"], server_now(app_url) + timedelta(minutes=10))
    err(mara.c.post(f"/api/playtests/{session['id']}/hints", json={"text": ""}), 409, "session_not_running")
    err(mara.c.post(f"/api/playtests/{session['id']}/start"), 409, "invalid_transition")

    vd = login(outage_url("APP_VALKEY_DOWN_URL"), MARA)
    node = add_node(mara, own["id"], "Clue")
    invalid(vd.c.post(f"/api/rooms/{own['id']}/locks", json={"targetType": "chair", "targetId": node["id"]}), "targetType")
    assert set(err(vd.c.post(f"/api/rooms/{own['id']}/locks", json={"targetType": "node", "targetId": node["id"]}),
                   503, "live_unavailable")) == {"error"}


def test_body_limits_origin_and_served_files(app_url: str) -> None:
    owner = signup(app_url)
    base_body = {"widthMm": 3000, "depthMm": 3000, "heightMm": 2400, "name": ""}
    overhead = len(json.dumps(base_body).encode())

    def sized(n: int) -> bytes:
        return json.dumps(dict(base_body, name="x" * (n - overhead))).encode()

    assert len(sized(JSON_LIMIT)) == JSON_LIMIT
    invalid(owner.c.post("/api/rooms", content=sized(JSON_LIMIT), headers={"content-type": "application/json"}), "name")
    err(owner.c.post("/api/rooms", content=sized(JSON_LIMIT + 1), headers={"content-type": "application/json"}), 413, "too_large")
    over = os.urandom(MULTIPART_LIMIT + 1)
    err(upload(owner.c, "Too big", over), 413, "too_large")
    room = rooms_by_name(owner)["Vault"]
    at_limit = png(THUMBNAIL_LIMIT)
    assert len(at_limit) == THUMBNAIL_LIMIT
    assert owner.c.put(f"/api/rooms/{room['id']}/thumbnail", content=at_limit,
                       headers={"content-type": "image/png"}).status_code == 204
    err(owner.c.put(f"/api/rooms/{room['id']}/thumbnail", content=png(THUMBNAIL_LIMIT + 1),
                    headers={"content-type": "image/png"}), 413, "too_large")
    invalid(owner.c.put(f"/api/rooms/{room['id']}/thumbnail", content=b"not an image",
                        headers={"content-type": "image/png"}), "file")

    name = f"Foreign {owner.tag}"
    response = owner.c.post("/api/rooms", json={"name": name, "widthMm": 3000, "depthMm": 3000, "heightMm": 2400},
                            headers={"Origin": FOREIGN_ORIGIN})
    err(response, 403, "cross_origin")
    assert name not in rooms_by_name(owner)

    anon = client(app_url)
    for path in SOURCE_PATHS:
        served = anon.get(path)
        assert MANIFEST_SCHEMA not in served.text, f"{path} must not be served"
    secrets = []
    for key in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "VALKEY_URL"):
        value = os.environ.get(key)
        if value and len(value) >= 6:
            secrets.append(value)
    db_password = urllib.parse.urlsplit(os.environ.get("DATABASE_URL", "")).password
    if db_password and len(db_password) >= 6:
        secrets.append(db_password)
    pages = [anon.get(path, follow_redirects=True) for path in ("/", "/signin", EDITOR_PATH) + SOURCE_PATHS]
    assets: set[str] = set()
    for page_response in pages:
        assets.update(re.findall(r'(?:src|href)="(/[^"]+)"', page_response.text))
    texts = [p.text for p in pages] + [anon.get(path).text for path in sorted(assets)]
    for secret in secrets:
        for content in texts:
            assert secret not in content, "a service credential is sent to the browser"


def test_wf_cross_cutting_public_tour(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/") as page:
        shows(page, page.get_by_role("heading", name="Walk the room before you build it.", level=1),
              "first tour panel heading")
        chain = page.get_by_role("list", name="Vault chain")
        expect(chain.get_by_role("listitem")).to_have_text(VAULT_CHAIN)
        progress = page.get_by_role("status", name="Tour progress")
        expect(page.get_by_role("link", name="Sign in")).to_be_visible()
        first_item = chain.get_by_role("listitem").first
        dark = colours(page, first_item)
        cameras = []
        for k in range(TOUR_STEPS):
            scroll_to_fraction(page, (k + 0.5) / TOUR_STEPS)
            lit = min(k, len(VAULT_CHAIN))
            shows(page, progress, f"{lit} cues lit at scroll {(k + 0.5) / TOUR_STEPS:.2f}", exact=f"{lit} of 6 cues lit")
            cameras.append(camera(page))
        assert colours(page, first_item) != dark, "a lit node turns from muted to blue"
        assert not matrices_equal(cameras[0], cameras[-1]), "scrolling moves the camera through the Vault"
        for k in reversed(range(TOUR_STEPS)):
            scroll_to_fraction(page, (k + 0.5) / TOUR_STEPS)
            lit = min(k, len(VAULT_CHAIN))
            shows(page, progress, f"scrolling back darkens cues to {lit}", exact=f"{lit} of 6 cues lit")
        assert colours(page, first_item) == dark, "scrolling back darkens node 1 again"
        assert not matrices_equal(camera(page), cameras[-1]), "scrolling back reverses the camera"

        scroll_to_fraction(page, 1.0)
        form = page.get_by_role("form", name="Create your venue")
        shows(page, form, "the page ends at the sign-up form")
        expect(page.get_by_text("Open your bench", exact=True)).to_be_visible()
        email, tag = fresh("tour")
        fill(form.get_by_role("textbox", name="Email"), MARA[0])
        fill(form.get_by_label("Password", exact=True), f"bench-{tag}-pass")
        fill(form.get_by_role("textbox", name="Your name"), f"Tour {tag}")
        fill(form.get_by_role("textbox", name="Venue name"), f"Tour venue {tag}")
        click(form.get_by_role("button", name="Create venue"))
        shows(page, page.get_by_text("That email already has a bench.", exact=True), "taken email shows the published copy")
        fill(form.get_by_role("textbox", name="Email"), email)
        click(form.get_by_role("button", name="Create venue"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/app(/rooms/[^/]+)?$"), timeout=QUICK_MS),
                   "a created venue lands on the editor")
    member = login_as(app_url, email, f"bench-{tag}-pass")
    assert member.user["role"] == "owner" and member.workspace["name"] == f"Tour venue {tag}"
    assert list(rooms_by_name(member)) == list(STARTERS)


def test_reduced_motion_walk_in(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner, reduced_motion="reduce") as page:
        dialog = picker(page)
        shows(page, dialog, "picker opens")
        assert scale_of(dialog) == 1.0, "no dialog scale under reduced motion"
        option = dialog.get_by_role("option", name="Vault")
        option.hover()
        click(option)
        advance(page, REDUCED_HIDE_MS)
        require(gone(dialog), "the dialog and scrim disappear within 80 ms")
        shows(page, camera_status(page), "the camera cuts to player height", exact="Player height")
        advance(page, STEP_MS)
        still = camera(page)
        advance(page, DOLLY_MAX_MS)
        assert matrices_equal(still, camera(page)), "no dolly runs under reduced motion"
        shows(page, page.get_by_role("button", name="Stop playtest"), "the stop glyph appears")
        shows(page, chain_figures(page), "figures read 0 of 6 solved", contains="0 of 6 solved")
        clock = page.get_by_role("timer", name="Playtest clock")
        shows(page, clock, "the clock appears")
        assert DEFAULT_DURATION_S - CLOCK_TOLERANCE_S <= clock_seconds(clock) <= DEFAULT_DURATION_S
        session = room_detail(owner, vault["id"])["activeSession"]
        assert session and session["state"] == "running" and session["kind"] == "walk_in"
        stage(page).focus()
        page.keyboard.press("p")
        shows(page, camera_status(page), "Stop cuts straight back", exact="Overview")
        debrief = page.get_by_role("dialog", name="Debrief")
        shows(page, debrief, "Debrief opens")
        assert scale_of(debrief) == 1.0
        assert session_get(owner, session["id"])["state"] == "ended"


def test_reduced_motion_public_tour(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", reduced_motion="reduce") as page:
        progress = page.get_by_role("status", name="Tour progress")
        shows(page, progress, "tour progress starts dark", exact="0 of 6 cues lit")
        advance(page, STEP_MS)
        top = camera(page)
        for k in (1, 3, 6):
            scroll_to_fraction(page, (k + 0.5) / TOUR_STEPS)
            shows(page, progress, f"{k} cues light instantly", exact=f"{k} of 6 cues lit")
        assert matrices_equal(top, camera(page)), "the camera stays at the overview under reduced motion"
        scroll_to_fraction(page, 0.5 / TOUR_STEPS)
        shows(page, progress, "cues go dark on scroll back", exact="0 of 6 cues lit")


def test_floor_plan_without_webgl(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    apothecary = rooms_by_name(owner)["Apothecary"]
    with member_page(browser, owner, no_webgl=True) as page:
        open_room(page, "Apothecary")
        shows(page, page.get_by_text("3D view unavailable on this device. Showing the floor plan.", exact=True),
              "the no-WebGL notice shows")
        region = stage(page)
        assert decode(capture(region)).variance() > 0, "the floor plan is drawn"
        page.get_by_role("button", name="Trigger graph").click()
        graph = page.get_by_role("dialog", name="Trigger graph")
        shows(page, graph, "Trigger graph opens without WebGL")
        names_are(graph.get_by_role("list", name="Trigger nodes").get_by_role("button"), APOTHECARY_CHAIN)
        page.keyboard.press("Escape")
        wait_gone(page, graph, "Escape closes the Trigger graph")
        page.get_by_role("button", name="Start playtest").click()
        shows(page, page.get_by_role("button", name="Stop playtest"), "walk-in switches the glyph")
        shows(page, page.get_by_role("timer", name="Playtest clock"), "walk-in shows the clock")
        shows(page, chain_figures(page), "walk-in shows 0 of 6 solved", contains="0 of 6 solved")
        session = room_detail(owner, apothecary["id"])["activeSession"]
        assert session and session["state"] == "running"


@pytest.mark.parametrize("size_id", ["375x812", "768x1024", "1280x800"], ids=["375x812", "768x1024", "1280x800"])
def test_published_viewport_layouts(browser: Browser, app_url: str, size_id: str) -> None:
    width, height = VIEWPORTS[size_id]
    owner = signup(app_url)
    apothecary = rooms_by_name(owner)["Apothecary"]
    with member_page(browser, owner) as page:
        page.set_viewport_size({"width": width, "height": height})
        page.reload()
        dialog = picker(page)
        shows(page, dialog, "picker opens")
        advance(page, DOLLY_MAX_MS)
        layout(page)
        box = dialog.bounding_box()
        options = dialog.get_by_role("option")
        expect(options).to_have_count(len(STARTERS))
        tops = [options.nth(i).bounding_box()["y"] for i in range(len(STARTERS))]
        first_row = sum(1 for top in tops if abs(top - tops[0]) < 1)
        if width < BREAKPOINT_PX:
            assert abs(box["x"] - SHEET_MARGIN_PX) <= 1 and abs(width - box["x"] - box["width"] - SHEET_MARGIN_PX) <= 1
            assert first_row == 2, "the phone picker grid has two columns"
        else:
            assert abs(box["width"] - PICKER_WIDTH_PX) <= 1
            assert abs(box["x"] + box["width"] / 2 - width / 2) <= 1, "the picker is centred"
            assert first_row == 4, "the desktop picker grid has four columns"
        open_room(page, "Apothecary")
        advance(page, DOLLY_MAX_MS)
        layout(page)
        code = apothecary["id"][:6].upper()
        expect(page.get_by_role("toolbar", name="Live session")).to_contain_text(code)
        presence = page.get_by_role("button", name="Presence").bounding_box()
        assert presence["y"] < height / 2
        if width < BREAKPOINT_PX:
            names = ["Tools", "Graph", "Start playtest", "Props", "Rooms"]
            bar = page.get_by_role("toolbar", name="Transport")
            boxes = [bar.get_by_role("button", name=n, exact=True).bounding_box() for n in names]
            assert all(b is not None for b in boxes), "every phone tab bar slot shows"
            xs = [b["x"] for b in boxes]
            assert xs == sorted(xs), "tab bar slots run Tools, Graph, Play, Props, Rooms"
            assert all(b["y"] > height / 2 for b in boxes)
            assert boxes[2]["y"] < boxes[0]["y"], "the Play button is raised above the bar"
            assert abs(boxes[2]["x"] + boxes[2]["width"] / 2 - width / 2) <= 1, "the Play button sits in the centre"
        else:
            tools = page.get_by_role("button", name="Tools", exact=True)
            assert tools.count() == 0 or not tools.first.is_visible(), "no phone tab bar at corner-cluster sizes"
            rooms = page.get_by_role("button", name="Rooms", exact=True).bounding_box()
            assert rooms["x"] < width / 2 and rooms["y"] < height / 2, "logo button top-left"
            assert presence["x"] > width / 2, "corner tool clusters top-right"
            assert page.get_by_role("button", name="Account").bounding_box()["x"] > width / 2
            assert chain_figures(page).bounding_box()["x"] > width / 2
            pill = page.get_by_role("toolbar", name="Live session").bounding_box()
            assert abs(pill["x"] + pill["width"] / 2 - width / 2) <= 2 and pill["y"] < height / 2, "live session pill top-centre"
            transport = page.get_by_role("toolbar", name="Transport")
            tb = transport.bounding_box()
            assert abs(tb["x"] + tb["width"] / 2 - width / 2) <= 2 and tb["y"] > height / 2, "transport bar bottom-centre"
            order = ["Move", "Rotate", "Scale", "Start playtest", "Trigger graph", "Prop library", "Next node"]
            xs = [transport.get_by_role("button", name=n, exact=True).bounding_box()["x"] for n in order]
            assert xs == sorted(xs), "transport order Move, Rotate, Scale, Play, Trigger graph, Prop library, Next node"
            for name, left in (("Add primitive", True), ("Upload prop", True), ("Cue timeline", False), ("Units", False)):
                b = page.get_by_role("button", name=name, exact=True).bounding_box()
                assert b["y"] > height / 2 and ((b["x"] < width / 2) == left), f"{name} sits in its bottom corner"


def test_room_picker_dialog(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    extra = f"bell tower {owner.tag}"
    make_room(owner, extra, 3000, 3000, 2400)
    with member_page(browser, owner) as page:
        dialog = picker(page)
        shows(page, dialog, "the editor opens on the Open a room dialog")
        expect(dialog.get_by_role("heading", name="Pick a room", level=2)).to_be_visible()
        expect(dialog).to_contain_text("Choose a draft or a starter room. Enter walks you in.")
        expect(dialog).to_contain_text("Keyway")
        expect(dialog).to_contain_text(re.compile(r"bench \d+\.\d+\.\d+"))
        expect(dialog.get_by_role("button", name="Close")).to_be_visible()
        listbox = dialog.get_by_role("listbox", name="Rooms")
        options = listbox.get_by_role("option")
        order = ["Apothecary", extra, "Observatory", "Ship's Hold", "Signal Cabin", "Vault"]
        expect(options).to_have_count(len(order))
        for index, name in enumerate(order):
            expect(options.nth(index)).to_contain_text(name)
        for name, figs in STARTERS.items():
            expect(listbox.get_by_role("option", name=name)).to_contain_text(card_line(*figs))
        expect(listbox.get_by_role("option", name=extra)).to_contain_text(card_line(0, 0, 0, 0))
        expect(options.first).to_have_attribute("aria-selected", "true")
        advance(page, DOLLY_MAX_MS)
        assert decode(capture(options.first)).variance() > 0, "the room draft card carries a thumbnail"
        link = dialog.get_by_role("link", name="New room")
        lb, gb = link.bounding_box(), listbox.bounding_box()
        assert abs(lb["x"] + lb["width"] / 2 - (gb["x"] + gb["width"] / 2)) <= 2, "New room link centred under the grid"
        assert lb["y"] > gb["y"]
        walk = dialog.get_by_role("checkbox", name="Walk in when I pick a room")
        expect(walk).to_be_checked()
        footer = [dialog.get_by_role("link", name=n, exact=True).bounding_box()
                  for n in ("Prop library", "Versions", "Keyboard shortcuts")]
        xs = [b["x"] for b in footer]
        assert xs == sorted(xs) and all(b["y"] > lb["y"] for b in footer)
        assert walk.bounding_box()["x"] < xs[0], "the checkbox sits left of the footer links"
        click(walk)
        expect(walk).not_to_be_checked()
        page.reload()
        shows(page, picker(page), "picker reopens on reload")
        expect(picker(page).get_by_role("checkbox", name="Walk in when I pick a room")).not_to_be_checked()

        click(picker(page).get_by_role("link", name="New room"))
        sheet = page.get_by_role("dialog", name="New room")
        shows(page, sheet, "New room opens the New room sheet")
        name = f"Annex {owner.tag}"
        fill(sheet.get_by_role("textbox", name="Room name"), name)
        fill(sheet.get_by_role("textbox", name="Width (m)"), "3.500")
        fill(sheet.get_by_role("textbox", name="Depth (m)"), "2.750")
        fill(sheet.get_by_role("textbox", name="Height (m)"), "2.400")
        click(sheet.get_by_role("button", name="Create room"))
        created = api_until(page, lambda: rooms_by_name(owner).get(name), lambda r: r is not None, "Create room makes the room")
        assert (created["widthMm"], created["depthMm"], created["heightMm"]) == (3500, 2750, 2400)
        shows(page, page.get_by_role("toolbar", name="Live session"), "the new room opens for editing",
              contains=created["id"][:6].upper())


def test_room_picker_keyboard(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    observatory = rooms_by_name(owner)["Observatory"]
    with member_page(browser, owner) as page:
        dialog = picker(page)
        shows(page, dialog, "picker opens")
        options = dialog.get_by_role("option")
        count = len(STARTERS)

        def selected() -> list[int]:
            return [i for i in range(count) if options.nth(i).get_attribute("aria-selected") == "true"]

        eventually(page, lambda: expect(options.first).to_be_focused(timeout=QUICK_MS), "focus goes to the highlighted card")
        for key, index in (("ArrowRight", 1), ("ArrowLeft", 0), ("End", count - 1), ("Home", 0),
                           ("ArrowDown", 4), ("ArrowUp", 0)):
            page.keyboard.press(key)
            eventually(page, lambda index=index: require(selected() == [index], f"{key} highlights card {index}"),
                       f"{key} moves the highlight to card {index}")
        options.nth(2).hover()
        eventually(page, lambda: require(selected() == [2], "hover highlights"), "hovering a card highlights it")

        for key in ("Tab", "Shift+Tab"):
            options.nth(2).focus()
            start = page.evaluate_handle("() => document.activeElement")
            wrapped = False
            for _ in range(TAB_PRESSES):
                page.keyboard.press(key)
                require(focus_inside(dialog), f"{key} never leaves the Open a room dialog")
                if page.evaluate("s => document.activeElement === s", start):
                    wrapped = True
                    break
            require(wrapped, f"{key} wraps around inside the dialog")

        page.keyboard.press("Escape")
        wait_gone(page, dialog, "Escape closes the picker")
        eventually(page, lambda: expect(stage(page)).to_be_focused(timeout=QUICK_MS),
                   "closing the load-time picker focuses the Room stage")
        rooms_button = page.get_by_role("button", name="Rooms", exact=True)
        click(rooms_button)
        shows(page, dialog, "Rooms reopens the picker")
        page.keyboard.press("Escape")
        wait_gone(page, dialog, "Escape closes the picker")
        eventually(page, lambda: expect(rooms_button).to_be_focused(timeout=QUICK_MS), "focus returns to Rooms")

        click(rooms_button)
        shows(page, dialog, "picker reopens")
        walk = dialog.get_by_role("checkbox", name="Walk in when I pick a room")
        if walk.is_checked():
            click(walk)
        options.first.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: require(selected() == [1], "Observatory highlighted"), "Observatory highlighted")
        page.keyboard.press("Enter")
        wait_gone(page, dialog, "Enter opens the highlighted room")
        shows(page, camera_status(page), "unchecked walk-in opens at the overview", exact="Overview")
        shows(page, page.get_by_role("toolbar", name="Live session"), "Observatory is open",
              contains=observatory["id"][:6].upper())
        assert room_detail(owner, observatory["id"])["activeSession"] is None


def test_wf_walk_in_keyboard_walk_in(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    apothecary = rooms_by_name(owner)["Apothecary"]
    with member_page(browser, owner) as page:
        dialog = picker(page)
        shows(page, dialog, "picker opens")
        first = dialog.get_by_role("option").first
        expect(first).to_contain_text("Apothecary")
        expect(first).to_have_attribute("aria-selected", "true")
        eventually(page, lambda: expect(first).to_be_focused(timeout=QUICK_MS), "first card focused")
        advance(page, STEP_MS)
        overview = camera(page)
        page.keyboard.press("Enter")
        cam = camera_status(page)
        walking_at: float | None = None
        arrived_at: float | None = None
        fake_ms = 0.0
        deadline = time.monotonic() + UI_WAIT_S
        while time.monotonic() < deadline and arrived_at is None:
            advance(page, DOLLY_STEP_MS)
            fake_ms += DOLLY_STEP_MS
            reading = cam.text_content() or ""
            if reading.strip() == "Walking in" and walking_at is None:
                walking_at = fake_ms
            if reading.strip() == "Player height" and walking_at is not None:
                arrived_at = fake_ms
        require(walking_at is not None and arrived_at is not None, "Camera reads Walking in, then Player height")
        dolly = arrived_at - walking_at
        assert DOLLY_MIN_MS - DOLLY_STEP_MS <= dolly <= DOLLY_MAX_MS + DOLLY_STEP_MS, f"dolly took {dolly} ms"
        inside = camera(page)
        assert not matrices_equal(overview, inside), "the camera moved to player height"
        shows(page, page.get_by_role("button", name="Stop playtest"), "Play turns into a stop square")
        clock = page.get_by_role("timer", name="Playtest clock")
        shows(page, clock, "the playtest clock shows")
        first_read = clock_seconds(clock)
        assert DEFAULT_DURATION_S - CLOCK_TOLERANCE_S <= first_read <= DEFAULT_DURATION_S
        shows(page, chain_figures(page), "figures read 0 of 6 solved", contains="0 of 6 solved")
        shows(page, editor_status(page), "start is announced", exact="Playtest running.")
        advance(page, 3000)
        assert clock_seconds(clock) < first_read, "the clock counts down"
        session = room_detail(owner, apothecary["id"])["activeSession"]
        assert session["state"] == "running" and session["kind"] == "walk_in" and session["hostUserId"] == owner.user["id"]

        page.get_by_role("button", name="Stop playtest").focus()
        page.keyboard.press("p")
        shows(page, cam, "Stop returns the camera", exact="Overview", seconds=UI_WAIT_S)
        advance(page, DOLLY_MAX_MS)
        assert not matrices_equal(inside, camera(page)), "the camera left player height"
        debrief = page.get_by_role("dialog", name="Debrief")
        shows(page, debrief.get_by_role("heading", name="Playtest ended"), "Debrief opens with the ended heading")
        ended = session_get(owner, session["id"])
        assert ended["state"] == "ended" and ended["outcome"] == "stopped"
        shows(page, page.get_by_role("button", name="Start playtest"), "the Play glyph returns")


def test_wf_walk_in_wrong_device_clock(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    observatory = rooms_by_name(owner)["Observatory"]
    with member_page(browser, owner) as page:
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        page.reload()
        started = time.monotonic()
        open_room(page, "Observatory", walk_in=True)
        clock = page.get_by_role("timer", name="Playtest clock")
        shows(page, clock, "the walk-in clock shows")
        session = room_detail(owner, observatory["id"])["activeSession"]
        require(session and session["state"] == "running", "the walk-in created a running session")
        shown = clock_seconds(clock)
        served = session_get(owner, session["id"])["remainingSeconds"]
        slack = CLOCK_TOLERANCE_S + math.ceil(time.monotonic() - started)
        assert abs(shown - served) <= slack, f"page shows {shown}s, server says {served}s"
        page.reload()
        reloaded = time.monotonic()
        open_room(page, "Observatory")
        shows(page, clock, "a reloaded editor shows the running session's clock")
        shown = clock_seconds(clock)
        served = session_get(owner, session["id"])["remainingSeconds"]
        assert abs(shown - served) <= CLOCK_TOLERANCE_S + math.ceil(time.monotonic() - reloaded)


def test_wf_walk_in_busy_room(browser: Browser, app_url: str) -> None:
    mara, tobi = login(app_url, MARA), login(app_url, TOBI)
    room = make_room(mara, f"Busy {mara.tag}")
    add_node(mara, room["id"], "Lone clue")
    running = walk_in(tobi, room["id"])
    with member_page(browser, mara) as page:
        open_room(page, room["name"], walk_in=True)
        shows(page, editor_status(page), "the refusal copy appears", exact="Another playtest is running in this room.")
        shows(page, camera_status(page), "the room opens at the overview", exact="Overview")
    sessions = ok(mara.c.get(f"/api/rooms/{room['id']}/playtests"))["sessions"]
    assert [s["id"] for s in sessions] == [running["id"]] and sessions[0]["hostUserId"] == tobi.user["id"]


def test_wf_walk_in_phone_tab_bar(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        dialog = picker(page)
        shows(page, dialog, "the phone picker sheet opens")
        advance(page, DOLLY_MAX_MS)
        bar = tab_bar(page)
        above_bar(dialog, bar, "the room picker sheet")
        raised_on_bar(page.get_by_role("button", name="Start playtest"), bar, "the raised Play button")
        focused(page, dialog.get_by_role("option").first, "the picker focuses the highlighted card")
        page.keyboard.press("End")
        has_attr(page, dialog.get_by_role("option", name="Vault"), "aria-selected", "true", "End highlights the last card")
        page.keyboard.press("Enter")
        wait_gone(page, dialog, "Enter walks into the Vault")
        shows(page, camera_status(page), "the walk-in reaches player height", exact="Player height")
        stop = page.get_by_role("button", name="Stop playtest")
        shows(page, stop, "Play turns into Stop playtest")
        raised_on_bar(stop, tab_bar(page), "the raised Stop playtest button")
        session = api_until(page, lambda: room_detail(owner, vault["id"])["activeSession"], lambda x: x is not None,
                            "the walk-in started a session")
        click(stop)
        debrief = page.get_by_role("dialog", name="Debrief")
        shows(page, debrief.get_by_role("heading", name="Playtest ended"), "Stop opens the Debrief dialog")
        advance(page, DOLLY_MAX_MS)
        eventually(page, lambda: require(focus_inside(debrief), "focus is inside the Debrief"),
                   "opening the Debrief dialog moves focus into it")
        above_bar(debrief, bar, "the Debrief sheet")
        page.keyboard.press("Escape")
        wait_gone(page, debrief, "Escape closes the Debrief dialog")
        focused(page, page.get_by_role("button", name="Start playtest"),
                "closing the Debrief puts focus on the round Play button, now Start playtest")
    ended = session_get(owner, session["id"])
    assert ended["state"] == "ended" and ended["outcome"] == "stopped"


def test_placements_in_millimetres(app_url: str) -> None:
    owner = signup(app_url)
    for width, depth, height, field in ((ROOM_MIN_MM - 1, MID_MM, 2400, "widthMm"), (MID_MM, ROOM_MAX_MM + 1, 2400, "depthMm"),
                                        (MID_MM, MID_MM, HEIGHT_MIN_MM - 1, "heightMm"), (MID_MM, MID_MM, HEIGHT_MAX_MM + 1, "heightMm")):
        invalid(owner.c.post("/api/rooms", json={"name": f"Bad {field} {owner.tag}", "widthMm": width,
                                                 "depthMm": depth, "heightMm": height}), field)
    room = make_room(owner, f"Bench {owner.tag}", ROOM_MIN_MM, ROOM_MAX_MM, HEIGHT_MAX_MM)
    err(owner.c.post("/api/rooms", json={"name": room["name"].upper(), "widthMm": MID_MM, "depthMm": MID_MM,
                                         "heightMm": 2400}), 409, "name_taken")
    rid = room["id"]
    edge = add_placement(owner, rid, "Edge", xMm=ROOM_MIN_MM, zMm=ROOM_MAX_MM, yMm=HEIGHT_MAX_MM,
                         widthMm=SIZE_MIN_MM, depthMm=SIZE_MIN_MM, heightMm=HEIGHT_MAX_MM, rotationDeg=359)
    assert edge["version"] == 1 and edge["xMm"] == ROOM_MIN_MM
    for field, value in (("xMm", ROOM_MIN_MM + 1), ("zMm", ROOM_MAX_MM + 1), ("yMm", HEIGHT_MAX_MM + 1),
                         ("xMm", -1), ("widthMm", SIZE_MIN_MM - 1), ("widthMm", ROOM_MIN_MM + 1),
                         ("heightMm", HEIGHT_MAX_MM + 1), ("rotationDeg", 360), ("xMm", 10.5), ("label", "")):
        invalid(owner.c.post(f"/api/rooms/{rid}/placements", json={**placement_body("Bad"), field: value}), field)
    invalid(owner.c.post(f"/api/rooms/{rid}/placements", json=placement_body("Ghost", "prop", propId=UNKNOWN_ID)),
            "propId", "unknown prop")
    invalid(owner.c.post(f"/api/rooms/{rid}/placements", json=placement_body("Crate", entry=True)), "entry")
    assert [p["label"] for p in room_detail(owner, rid)["placements"]] == ["Edge"], "refused placements left nothing"

    moved = ok(owner.c.patch(f"/api/rooms/{rid}/placements/{edge['id']}", json={"version": 1, "xMm": 500}))["placement"]
    assert moved["version"] == 2 and moved["xMm"] == 500
    stale = err(owner.c.patch(f"/api/rooms/{rid}/placements/{edge['id']}", json={"version": 1, "xMm": 900}), 412, "stale_version")
    assert stale["current"] == placement_now(owner, rid, edge["id"]) and stale["current"]["xMm"] == 500
    node = add_node(owner, rid, "Clue")
    ok(owner.c.patch(f"/api/rooms/{rid}/nodes/{node['id']}", json={"version": node["version"], "title": RENAMED_CLUE}))
    stale_node = err(owner.c.patch(f"/api/rooms/{rid}/nodes/{node['id']}",
                                   json={"version": node["version"], "title": "Clue 3"}), 412, "stale_version")
    assert stale_node["current"]["title"] == RENAMED_CLUE
    stale_room = err(owner.c.patch(f"/api/rooms/{rid}", json={"version": room["version"] - 1, "name": "Old"}), 412, "stale_version")
    assert stale_room["current"]["name"] == room["name"]

    vault = rooms_by_name(owner)["Vault"]
    far = add_placement(owner, vault["id"], "Far crate", xMm=NEAR_EDGE_MM)
    invalid(owner.c.patch(f"/api/rooms/{vault['id']}", json={"version": vault["version"], "widthMm": 2500}), "widthMm")
    assert room_detail(owner, vault["id"])["room"]["widthMm"] == VAULT_WIDTH_MM
    assert placement_now(owner, vault["id"], far["id"])["xMm"] == NEAR_EDGE_MM


def test_wf_live_layout_stale_save(browser: Browser, app_url: str) -> None:
    vd_url = outage_url("APP_VALKEY_DOWN_URL")
    mara = login(app_url, MARA)
    tobi_vd = login(vd_url, TOBI)
    room = make_room(mara, f"Stale {mara.tag}")
    placement = add_placement(mara, room["id"], "Workbench", xMm=1500)
    with member_page(browser, tobi_vd) as page:
        open_room(page, room["name"])
        stage(page).focus()
        page.keyboard.press("g")
        page.keyboard.press("]")
        shows(page, page.get_by_role("region", name="Inspector"), "the Workbench is selected", contains="Workbench")
        newer = ok(mara.c.patch(f"/api/rooms/{room['id']}/placements/{placement['id']}",
                                json={"version": placement["version"], "xMm": 2000}))["placement"]
        page.keyboard.press("ArrowRight")
        shows(page, editor_status(page), "the stale save announces the refresh",
              exact="Someone saved a newer change. Your view has been refreshed.")
    current = placement_now(mara, room["id"], placement["id"])
    assert current["xMm"] == newer["xMm"] and current["version"] == newer["version"], "the newer save was not overwritten"


def test_lock_single_winner(app_url: str, valkey: Any) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Locks {mara.tag}")
    rid = room["id"]
    targets = [("placement", add_placement(mara, rid, f"Crate {i}")["id"]) for i in range(3)]
    targets += [("node", add_node(mara, rid, f"Clue {i}")["id"]) for i in range(2)]
    for target_type, target_id in targets:
        members = [mara, tobi] * 3
        clients = [clone(m) for m in members]
        payload = {"targetType": target_type, "targetId": target_id}
        responses = race([lambda c=c: c.post(f"/api/rooms/{rid}/locks", json=payload) for c in clients])
        winners = {members[i].user["id"] for i, r in enumerate(responses) if r.status_code == 200}
        assert len(winners) == 1, f"exactly one member holds {target_type} lock, got {winners}"
        winner_id = winners.pop()
        winner = mara if winner_id == mara.user["id"] else tobi
        loser = tobi if winner is mara else mara
        for member, response in zip(members, responses):
            if member is winner:
                lock = ok(response)["lock"]
                assert lock["holder"]["userId"] == winner_id and 0 < lock["expiresInSeconds"] <= DEFAULT_LOCK_TTL_S
            else:
                body = err(response, 409, "locked")
                assert body["holder"]["userId"] == winner_id
                assert body["holder"]["displayName"] == winner.user["displayName"]
                assert isinstance(body["expiresInSeconds"], int)
        key = f"lock:{rid}:{target_type}:{target_id}"
        assert winner_id in str(valkey.command("GET", key))
        assert 0 < valkey.ttl(key) <= DEFAULT_LOCK_TTL_S
        path = f"/api/rooms/{rid}/{'placements' if target_type == 'placement' else 'nodes'}/{target_id}"
        change = {"xMm": 1234} if target_type == "placement" else {"title": "Hijacked"}
        current = next(x for x in room_detail(mara, rid)["placements" if target_type == "placement" else "nodes"]
                       if x["id"] == target_id)
        assert err(loser.c.patch(path, json={"version": current["version"], **change}), 409, "locked")["holder"]["userId"] == winner_id
        err(loser.c.delete(f"/api/rooms/{rid}/locks/{target_type}/{target_id}"), 409, "locked")
        ok(winner.c.patch(path, json={"version": current["version"], **change}))
        for client_ in clients:
            client_.close()
        assert winner.c.delete(f"/api/rooms/{rid}/locks/{target_type}/{target_id}").status_code == 204
        assert ok(loser.c.post(f"/api/rooms/{rid}/locks", json=payload))["lock"]["holder"]["userId"] == loser.user["id"]

    short = outage_url("APP_SHORT_URL")
    s_mara, s_tobi = login(short, MARA), login(short, TOBI)
    s_room = make_room(s_mara, f"Lapse {s_mara.tag}")
    s_placement = add_placement(s_mara, s_room["id"], "Workbench")
    payload = {"targetType": "placement", "targetId": s_placement["id"]}
    taken = time.monotonic()
    ttl = ok(s_mara.c.post(f"/api/rooms/{s_room['id']}/locks", json=payload))["lock"]["expiresInSeconds"]
    assert 0 < ttl < DEFAULT_LOCK_TTL_S, "the lock TTL comes from LOCK_TTL_SECONDS"
    err(s_tobi.c.post(f"/api/rooms/{s_room['id']}/locks", json=payload), 409, "locked")
    lapsed = poll(lambda: s_tobi.c.post(f"/api/rooms/{s_room['id']}/locks", json=payload),
                  lambda r: r.status_code == 200, "an idle lock lapses after the lock TTL", ttl + LAPSE_SLACK_S)
    assert lapsed.json()["lock"]["holder"]["userId"] == s_tobi.user["id"]
    assert time.monotonic() - taken >= ttl - 1, "the lock held until its TTL"


def test_wf_live_layout_lock_refusal(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Workshop {mara.tag}", 3000, 4000, 2600)
    bench = add_placement(mara, room["id"], "Workbench", xMm=START_X_MM, zMm=2000)
    ok(mara.c.post(f"/api/rooms/{room['id']}/locks", json={"targetType": "placement", "targetId": bench["id"]}))
    with member_page(browser, tobi) as page:
        open_room(page, room["name"])
        stage(page).focus()
        page.keyboard.press("g")
        page.keyboard.press("]")
        page.keyboard.press("ArrowRight")
        shows(page, editor_status(page), "the holder's name shows", exact="Mara Quint is holding this prop.")
        advance(page, 2000)
        unchanged = placement_now(mara, room["id"], bench["id"])
        assert unchanged["xMm"] == START_X_MM and unchanged["version"] == bench["version"], "the refused move saved nothing"
        assert mara.c.delete(f"/api/rooms/{room['id']}/locks/placement/{bench['id']}").status_code == 204
        page.keyboard.press("Escape")
        stage(page).focus()
        page.keyboard.press("]")
        page.keyboard.press("ArrowRight")
        api_until(page, lambda: placement_now(mara, room["id"], bench["id"]), lambda p: p["xMm"] == START_X_MM + NUDGE_MM,
                  "after the lock lapses the co-designer's nudge saves")


def test_live_events_across_instances(browser: Browser, app_url: str, valkey: Any) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Live {mara.tag}")
    rid = room["id"]
    placement = add_placement(mara, rid, "Crate", xMm=1000)
    node = add_node(mara, rid, "Clue")
    with Stream(peer, f"/api/rooms/{rid}/events", tobi.c.cookies) as stream:
        def timed(action: Callable[[], httpx.Response], pred: Callable[[str, Any], bool], what: str) -> None:
            since = stream.mark()
            ok(action())
            done = time.monotonic()
            _, _, at = stream.wait(pred, what, since)
            assert at - done <= LIVE_S, f"{what} took {at - done:.2f}s"

        since = stream.mark()
        r = mara.c.patch(f"/api/rooms/{rid}/placements/{placement['id']}", json={"version": 1, "xMm": 1100})
        ok(r)
        done = time.monotonic()
        _, _, at = stream.wait(lambda e, d: e == "placement" and isinstance(d, dict) and d.get("placement", {}).get("xMm") == 1100,
                               "placement event", since)
        assert at - done <= LIVE_S
        for action, pred, what in [
            (lambda: mara.c.patch(f"/api/rooms/{rid}/nodes/{node['id']}", json={"version": node["version"], "title": "Clue moved"}),
             lambda e, d: e == "node" and isinstance(d, dict) and d.get("node", {}).get("title") == "Clue moved", "node event"),
            (lambda: mara.c.patch(f"/api/rooms/{rid}", json={"version": room["version"], "name": f"Live renamed {mara.tag}"}),
             lambda e, d: e == "room" and isinstance(d, dict) and d.get("room", {}).get("name") == f"Live renamed {mara.tag}", "room event"),
            (lambda: mara.c.post(f"/api/rooms/{rid}/locks", json={"targetType": "placement", "targetId": placement["id"]}),
             lambda e, d: e == "lock" and isinstance(d, dict) and d.get("lock", {}).get("holder", {}).get("userId") == mara.user["id"], "lock event"),
        ]:
            timed(action, pred, what)
        since = stream.mark()
        assert mara.c.delete(f"/api/rooms/{rid}/locks/placement/{placement['id']}").status_code == 204
        done = time.monotonic()
        _, _, at = stream.wait(lambda e, d: e == "lock" and isinstance(d, dict) and d.get("released", {}).get("targetId") == placement["id"],
                               "lock released event", since)
        assert at - done <= LIVE_S
        since = stream.mark()
        assert mara.c.delete(f"/api/rooms/{rid}/placements/{placement['id']}").status_code == 204
        done = time.monotonic()
        _, _, at = stream.wait(lambda e, d: e == "placement" and isinstance(d, dict) and d.get("deletedId") == placement["id"],
                               "placement deleted event", since)
        assert at - done <= LIVE_S

    renamed = f"Live renamed {mara.tag}"
    with member_page(browser, mara) as mara_page, member_page(browser, tobi) as tobi_page:
        open_room(mara_page, renamed)
        open_room(tobi_page, renamed)
        for page in (mara_page, tobi_page):
            shows(page, page.get_by_role("button", name="Presence"), "each member sees the other", contains="2 here")
        for member in (mara, tobi):
            key = f"presence:{rid}:{member.user['id']}"
            assert 0 < valkey.ttl(key) <= PRESENCE_TTL_S, f"{key} holds presence with its expiry"


def test_wf_live_layout_counters(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Counter {mara.tag}")
    add_placement(mara, room["id"], "Entry door", "door", widthMm=900, depthMm=100, heightMm=2000)
    add_placement(mara, room["id"], "Crate")
    with member_page(browser, mara) as owner_page, member_page(browser, tobi) as co_page:
        open_room(owner_page, room["name"])
        open_room(co_page, room["name"])
        shows(co_page, chain_figures(co_page), "one prop counted (doors excluded)", contains="1 prop")
        click(owner_page.get_by_role("button", name="Add primitive"))
        click(owner_page.get_by_role("menuitem", name="Box"))
        api_until(owner_page, lambda: room_stats(mara, room["id"]), lambda s: s["props"] == 2, "Box added a placement")
        shows(co_page, chain_figures(co_page), "the co-designer's figures update", contains="2 props",
              seconds=LIVE_S + LIVE_UI_SLACK_S)
        shows(owner_page, chain_figures(owner_page), "the owner's figures update", contains="2 props")
        added = [p for p in room_detail(mara, room["id"])["placements"] if p["kind"] == "box" and p["label"] != "Crate"]
        assert len(added) == 1
        assert mara.c.delete(f"/api/rooms/{room['id']}/placements/{added[0]['id']}").status_code == 204
        shows(co_page, chain_figures(co_page), "deleting drops the count", contains="1 prop", seconds=LIVE_S + LIVE_UI_SLACK_S)
    assert room_stats(mara, room["id"])["props"] == 1


def test_trigger_graph_rules(app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Graph {owner.tag}")
    rid = room["id"]
    a = add_node(owner, rid, "Clue A")
    b = add_node(owner, rid, "Clue B", prerequisites=[a["id"]])
    invalid(owner.c.post(f"/api/rooms/{rid}/nodes", json={"title": "Riddle", "kind": "riddle", "prerequisites": []}), "kind")
    invalid(owner.c.patch(f"/api/rooms/{rid}/nodes/{a['id']}", json={"version": a["version"], "prerequisites": [b["id"]]}),
            "prerequisites", "would create a loop")
    invalid(owner.c.patch(f"/api/rooms/{rid}/nodes/{a['id']}", json={"version": a["version"], "prerequisites": [a["id"]]}),
            "prerequisites")
    vault_nodes = nodes_by_title(room_detail(owner, rooms_by_name(owner)["Vault"]["id"]))
    invalid(owner.c.post(f"/api/rooms/{rid}/nodes", json={"title": "Cross", "kind": "puzzle",
                                                         "prerequisites": [vault_nodes["Ledger cipher"]["id"]]}), "prerequisites")
    invalid(owner.c.post(f"/api/rooms/{rid}/nodes", json={"title": "Latch", "kind": "lock", "prerequisites": [],
                                                         "answer": "1234"}), "answer")
    invalid(owner.c.post(f"/api/rooms/{rid}/nodes", json={"title": "t" * (NAME_MAX + 1), "kind": "cue", "prerequisites": []}), "title")
    exit_node = add_node(owner, rid, "Way out", "exit", [b["id"]], answer="open")
    invalid(owner.c.post(f"/api/rooms/{rid}/nodes", json={"title": "Second exit", "kind": "exit", "prerequisites": []}),
            "kind", "room already has an exit")
    lock = add_node(owner, rid, "Latch", "lock", [a["id"]])
    cue = add_node(owner, rid, CUE_TITLE, "cue", [lock["id"]])
    assert {n["kind"] for n in room_detail(owner, rid)["nodes"]} == {"puzzle", "lock", "cue", "exit"}
    assert len(room_detail(owner, rid)["nodes"]) == 5, "refused nodes left nothing behind"
    assert owner.c.delete(f"/api/rooms/{rid}/nodes/{a['id']}").status_code == 204
    after = nodes_by_title(room_detail(owner, rid))
    assert after["Clue B"]["prerequisites"] == [] and after["Latch"]["prerequisites"] == []

    placement = add_placement(owner, rid, "Crate")
    session = walk_in(owner, rid)
    current = room_detail(owner, rid)
    node_now = nodes_by_title(current)[CUE_TITLE]
    for method, path, payload in [
        ("PATCH", f"/api/rooms/{rid}/nodes/{cue['id']}", {"version": node_now["version"], "title": "Dimmed"}),
        ("POST", f"/api/rooms/{rid}/nodes", {"title": "Late", "kind": "puzzle", "prerequisites": []}),
        ("DELETE", f"/api/rooms/{rid}/nodes/{exit_node['id']}", None),
        ("POST", f"/api/rooms/{rid}/placements", placement_body("Late crate")),
        ("PATCH", f"/api/rooms/{rid}/placements/{placement['id']}", {"version": placement["version"], "xMm": 1500}),
        ("PATCH", f"/api/rooms/{rid}", {"version": current["room"]["version"], "name": f"Graph renamed {owner.tag}"}),
    ]:
        err(owner.c.request(method, path, json=payload), 409, "playtest_running")
    unchanged = room_detail(owner, rid)
    assert nodes_by_title(unchanged)[CUE_TITLE]["title"] == CUE_TITLE and len(unchanged["placements"]) == 1
    move(owner, session["id"], "end")
    ok(owner.c.patch(f"/api/rooms/{rid}/nodes/{cue['id']}", json={"version": node_now["version"], "title": "Dimmed"}))

    vault = rooms_by_name(owner)["Vault"]
    safe = nodes_by_title(room_detail(owner, vault["id"]))["Safe dial"]
    ok(owner.c.patch(f"/api/rooms/{vault['id']}/nodes/{safe['id']}", json={"version": safe["version"], "prerequisites": []}))
    assert [n["title"] for n in room_detail(owner, vault["id"])["nodes"]] == VAULT_CHAIN, "chain order follows the published rule"


def test_chain_figures_follow_rules(app_url: str) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    vault, signal_cabin, observatory, apothecary = (rooms[n] for n in ("Vault", "Signal Cabin", "Observatory", "Apothecary"))
    safe = nodes_by_title(room_detail(owner, vault["id"]))["Safe dial"]
    ok(owner.c.patch(f"/api/rooms/{vault['id']}/nodes/{safe['id']}", json={"version": safe["version"], "prerequisites": []}))
    assert room_stats(owner, vault["id"]) == {"solved": 0, "total": 6, "longestRun": 4, "props": 3}
    add_placement(owner, signal_cabin["id"], "Spare door", "door", widthMm=900, depthMm=100, heightMm=2000)
    assert room_stats(owner, signal_cabin["id"])["props"] == 2, "doors are not props"
    add_placement(owner, signal_cabin["id"], "Spare crate")
    assert room_stats(owner, signal_cabin["id"])["props"] == 3
    focus = nodes_by_title(room_detail(owner, observatory["id"]))["Telescope focus"]
    assert owner.c.delete(f"/api/rooms/{observatory['id']}/nodes/{focus['id']}").status_code == 204
    assert room_stats(owner, observatory["id"]) == {"solved": 0, "total": 3, "longestRun": 3, "props": 2}
    empty = make_room(owner, f"Empty {owner.tag}")
    assert room_stats(owner, empty["id"]) == {"solved": 0, "total": 0, "longestRun": 0, "props": 0}
    add_node(owner, empty["id"], "Only clue")
    assert room_stats(owner, empty["id"])["longestRun"] == 1

    session = walk_in(owner, apothecary["id"])
    herb = nodes_by_title(room_detail(owner, apothecary["id"]))["Herb cabinet code"]
    solved = host_solve(owner, session["id"], herb["id"], "4172")
    assert solved["session"]["stats"]["solved"] == 3, "the maglock and the blacklight fired with the code"
    assert room_stats(owner, apothecary["id"]) == {"solved": 3, "total": 6, "longestRun": 3, "props": 4}
    move(owner, session["id"], "end")
    debrief = ok(owner.c.get(f"/api/playtests/{session['id']}/debrief"))
    assert debrief["stats"] == room_stats(owner, apothecary["id"])
    second = walk_in(owner, apothecary["id"])
    assert room_stats(owner, apothecary["id"])["solved"] == 0, "solved follows the latest session that reached running"
    move(owner, second["id"], "end")


def test_wf_trigger_graph_keyboard(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Keys {owner.tag}", 4000, 3500, 2700)
    rid = room["id"]
    first = add_placement(owner, rid, "First crate", xMm=2000, zMm=1500, rotationDeg=ROTATE_TOP, widthMm=500, heightMm=800)
    second = add_placement(owner, rid, "Edge crate", xMm=4000, zMm=1000)
    add_node(owner, rid, "Opening clue")
    add_node(owner, rid, "Closing clue")
    with member_page(browser, owner, reduced_motion="reduce") as page:
        open_room(page, room["name"])
        play = page.get_by_role("button", name="Start playtest")
        play.focus()
        for key, mode in (("r", "Rotate"), ("s", "Scale"), ("g", "Move")):
            page.keyboard.press(key)
            shows(page, page.get_by_role("button", name=mode, exact=True), f"{key} selects {mode}")
            expect(page.get_by_role("button", name=mode, exact=True)).to_have_attribute("aria-pressed", "true")

        def at(pred: Callable[[dict], bool], what: str) -> dict:
            return api_until(page, lambda: placement_now(owner, rid, first["id"]), pred, what)

        page.keyboard.press("]")
        shows(page, page.get_by_role("region", name="Inspector"), "] selects the first placement", contains="First crate")
        page.keyboard.press("ArrowRight")
        at(lambda p: p["xMm"] == 2000 + NUDGE_MM, "Right adds 10 mm to xMm")
        page.keyboard.press("Shift+ArrowRight")
        at(lambda p: p["xMm"] == 2000 + NUDGE_MM + NUDGE_SHIFT_MM, "Shift+Right adds 100 mm")
        page.keyboard.press("ArrowUp")
        at(lambda p: p["zMm"] == 1500 + NUDGE_MM, "Up adds to zMm")
        page.keyboard.press("r")
        page.keyboard.press("ArrowRight")
        at(lambda p: p["rotationDeg"] == 0, "345 plus 15 wraps to 0")
        page.keyboard.press("ArrowLeft")
        at(lambda p: p["rotationDeg"] == ROTATE_TOP, "0 minus 15 wraps to 345")
        page.keyboard.press("s")
        page.keyboard.press("ArrowRight")
        at(lambda p: p["widthMm"] == 500 + NUDGE_MM, "Scale Right adds to widthMm")
        page.keyboard.press("ArrowUp")
        at(lambda p: p["heightMm"] == 800 + NUDGE_MM, "Scale Up adds to heightMm")

        page.keyboard.press("g")
        page.keyboard.press("]")
        shows(page, page.get_by_role("region", name="Inspector"), "] selects the next placement", contains="Edge crate")
        before = placement_now(owner, rid, second["id"])
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        after = api_until(page, lambda: placement_now(owner, rid, second["id"]),
                          lambda p: p["xMm"] == 4000 - NUDGE_MM, "Left moves the edge crate off the bound")
        assert after["version"] == before["version"] + 1, "a press at the bound saved nothing"
        page.keyboard.press("Delete")
        api_until(page, lambda: placement_now(owner, rid, second["id"]), lambda p: p is None, "Delete removes the placement")
        page.keyboard.press("Escape")
        eventually(page, lambda: require(gone(page.get_by_role("region", name="Inspector")), "Inspector hidden"),
                   "Escape clears the selection")

        play.focus()
        page.keyboard.press("n")
        graph = page.get_by_role("dialog", name="Trigger graph")
        shows(page, graph, "N opens the Trigger graph sheet")
        nodes = graph.get_by_role("list", name="Trigger nodes").get_by_role("button")
        shows(page, nodes.nth(0), "N selects the first node")
        expect(nodes.nth(0)).to_have_attribute("aria-pressed", "true")
        nodes.nth(0).focus()
        page.keyboard.press("n")
        eventually(page, lambda: expect(nodes.nth(1)).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS),
                   "N inside the sheet steps to the next node")
        page.keyboard.press("Shift+N")
        eventually(page, lambda: expect(nodes.nth(0)).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS),
                   "Shift+N steps back")
        nodes.nth(0).focus()
        page.keyboard.press("t")
        wait_gone(page, graph, "T inside the sheet closes it")
        openers = (play, page.get_by_role("button", name="Trigger graph", exact=True))
        eventually(page, lambda: require(any(o.evaluate_all("els => els.includes(document.activeElement)")
                                             for o in openers), "focus is on Play or the Trigger graph button"),
                   "focus returns to the opener")
        for key, name in (("l", "Prop library"), ("?", "Keyboard shortcuts")):
            play.focus()
            page.keyboard.press(key)
            sheet = page.get_by_role("dialog", name=name)
            shows(page, sheet, f"{key} opens {name}")
            page.keyboard.press("Escape")
            wait_gone(page, sheet, f"Escape closes {name}")
            eventually(page, lambda: expect(play).to_be_focused(timeout=QUICK_MS), "focus returns to Play")
        field = page.get_by_role("textbox", name="Invite tester email")
        field.focus()
        page.keyboard.press("r")
        expect(page.get_by_role("button", name="Move", exact=True)).to_have_attribute("aria-pressed", "true")
        fill(field, "")
        page.get_by_role("button", name="Move", exact=True).focus()
        page.keyboard.press("p")
        stop = page.get_by_role("button", name="Stop playtest")
        shows(page, stop, "P starts a walk-in")
        session = room_detail(owner, rid)["activeSession"]
        require(session and session["state"] == "running", "P created a running playtest")
        stop.focus()
        page.keyboard.press("p")
        shows(page, page.get_by_role("dialog", name="Debrief"), "P stops the playtest")
        assert session_get(owner, session["id"])["state"] == "ended"


def test_wf_trigger_graph_bottleneck(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner) as page:
        open_room(page, "Vault")
        shows(page, chain_figures(page), "linear chain run", contains="Longest run 6")
        stage(page).focus()
        page.keyboard.press("t")
        graph = page.get_by_role("dialog", name="Trigger graph")
        shows(page, graph, "T opens the sheet")
        nodes = graph.get_by_role("list", name="Trigger nodes").get_by_role("button")
        names_are(nodes, VAULT_CHAIN)
        click(graph.get_by_role("button", name="Safe dial", exact=True))
        expect(graph.get_by_role("textbox", name="Node title")).to_have_value("Safe dial")
        prereq = graph.get_by_role("group", name="Prerequisites").get_by_role("checkbox", name="Blacklight cue")
        expect(prereq).to_be_checked()
        click(prereq)
        click(graph.get_by_role("button", name="Save node"))
        done = time.monotonic()
        api_until(page, lambda: room_stats(owner, vault["id"]), lambda s: s["longestRun"] == 4, "the API run drops to 4")
        shows(page, chain_figures(page), "stage run drops", contains="Longest run 4",
              seconds=LIVE_S + LIVE_UI_SLACK_S + (time.monotonic() - done))
        names_are(nodes, VAULT_CHAIN)
        page.keyboard.press("Escape")
        wait_gone(page, graph, "Escape closes the sheet")
        click(page.get_by_role("button", name="Rooms", exact=True))
        shows(page, picker(page).get_by_role("option", name="Vault"), "the Vault card updates",
              contains=card_line(0, 6, 4, 3))


def test_wf_trigger_graph_sheet_edit(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    cabin = rooms_by_name(owner)["Signal Cabin"]
    with member_page(browser, owner) as page:
        open_room(page, "Signal Cabin")
        click(page.get_by_role("button", name="Trigger graph"))
        graph = page.get_by_role("dialog", name="Trigger graph")
        nodes = graph.get_by_role("list", name="Trigger nodes").get_by_role("button")
        shows(page, graph, "sheet opens")
        names_are(nodes, ["Morse key", "Lever order", "Lamp cue", "Cabin door"])
        click(graph.get_by_role("button", name="Morse key", exact=True))
        expect(graph.get_by_role("button", name="Morse key", exact=True)).to_have_attribute("aria-pressed", "true")
        title = graph.get_by_role("textbox", name="Node title")
        expect(title).to_have_value("Morse key")
        fill(title, RENAMED_NODE)
        click(graph.get_by_role("button", name="Save node"))
        api_until(page, lambda: nodes_by_title(room_detail(owner, cabin["id"])), lambda n: RENAMED_NODE in n,
                  "Save node renames the node")
        shows(page, graph.get_by_role("button", name=RENAMED_NODE, exact=True), "card renamed")
        click(graph.get_by_role("button", name="Add node"))
        added = api_until(page, lambda: nodes_by_title(room_detail(owner, cabin["id"])), lambda n: "New puzzle" in n,
                          "Add node creates New puzzle")
        assert added["New puzzle"]["kind"] == "puzzle"
        click(graph.get_by_role("button", name="New puzzle", exact=True))
        select(graph.get_by_role("combobox", name="Node kind"), "cue")
        click(graph.get_by_role("group", name="Prerequisites").get_by_role("checkbox", name="Lever order"))
        click(graph.get_by_role("button", name="Save node"))
        lever = added["Lever order"]["id"]
        api_until(page, lambda: nodes_by_title(room_detail(owner, cabin["id"]))["New puzzle"],
                  lambda n: n["kind"] == "cue" and n["prerequisites"] == [lever], "kind and prerequisite saved")
        click(graph.get_by_role("button", name="Delete node"))
        api_until(page, lambda: nodes_by_title(room_detail(owner, cabin["id"])), lambda n: "New puzzle" not in n,
                  "Delete node removes it")
        shows(page, chain_figures(page), "total back to 4", contains="0 of 4 solved")


def test_wf_trigger_graph_held_node(browser: Browser, app_url: str) -> None:
    mara, tobi = login(app_url, MARA), login(app_url, TOBI)
    room = make_room(mara, f"Held {mara.tag}")
    node = add_node(mara, room["id"], "Gear train")
    ok(tobi.c.post(f"/api/rooms/{room['id']}/locks", json={"targetType": "node", "targetId": node["id"]}))
    with member_page(browser, mara) as page:
        open_room(page, room["name"])
        click(page.get_by_role("button", name="Trigger graph"))
        graph = page.get_by_role("dialog", name="Trigger graph")
        click(graph.get_by_role("button", name="Gear train", exact=True))
        shows(page, editor_status(page), "holder copy", exact="Tobi Ferreira is holding this node.")
        expect(graph.get_by_role("textbox", name="Node title")).not_to_be_editable()
        assert tobi.c.delete(f"/api/rooms/{room['id']}/locks/node/{node['id']}").status_code == 204
        click(graph.get_by_role("button", name="Gear train", exact=True))
        eventually(page, lambda: expect(graph.get_by_role("textbox", name="Node title")).to_be_editable(timeout=QUICK_MS),
                   "a released node is editable")
    assert nodes_by_title(room_detail(mara, room["id"]))["Gear train"]["version"] == node["version"]


@pytest.mark.parametrize("case", UPLOAD_CASES, ids=UPLOAD_CASES)
def test_prop_upload_checks(app_url: str, case: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    name = f"Prop {case} {owner.tag}"
    spec: dict[str, Any] = {"data": glb(), "filename": "sea-chest.glb", "ctype": "model/gltf-binary",
                            "name": name, "dims": (900, 500, 600)}
    expected: tuple[int, str | None] = (201, None)
    if case == "gltf_json":
        spec.update(data=gltf_json(), filename="sea-chest.gltf", ctype="model/gltf+json")
    elif case == "exact_limit":
        spec["data"] = glb(PROP_FILE_LIMIT)
    elif case == "over_limit":
        spec["data"] = glb(PROP_FILE_LIMIT) + b"\x00"
        expected = (413, None)
    elif case == "glb_version_1":
        spec["data"] = glb(version=1)
        expected = (422, "file")
    elif case == "json_version_1":
        spec.update(data=gltf_json("1.0"), filename="sea-chest.gltf", ctype="model/gltf+json")
        expected = (422, "file")
    elif case == "png":
        spec.update(data=png(), filename="sea-chest.png", ctype="image/png")
        expected = (422, "file")
    elif case == "missing_name":
        spec["name"] = None
        expected = (422, "name")
    elif case == "missing_dims":
        spec["dims"] = None
        expected = (422, "widthMm")
    elif case == "size_too_small":
        spec["dims"] = (SIZE_MIN_MM - 1, 500, 600)
        expected = (422, "widthMm")
    elif case == "size_too_large":
        spec["dims"] = (900, PROP_SIZE_MAX_MM + 1, 600)
        expected = (422, "depthMm")
    keys_before = set(s3.keys("props/"))
    response = upload(owner.c, spec["name"], spec["data"], filename=spec["filename"],
                      content_type=spec["ctype"], dims=spec["dims"])
    if expected[0] == 201:
        prop = ok(response, 201)["prop"]
        assert prop["contentType"] == spec["ctype"] and prop["bytes"] == len(spec["data"])
        assert prop["sha256"] == hashlib.sha256(spec["data"]).hexdigest()
        assert (prop["widthMm"], prop["depthMm"], prop["heightMm"]) == (900, 500, 600)
        ext = "glb" if spec["ctype"] == "model/gltf-binary" else "gltf"
        assert s3.get(f"props/{prop['id']}.{ext}") == spec["data"]
        assert prop["id"] in [p["id"] for p in ok(owner.c.get("/api/props"))["props"]]
        return
    if expected[0] == 413:
        err(response, 413, "too_large")
    elif expected[1] == "file":
        invalid(response, "file", "not a glTF 2.0 file")
    else:
        invalid(response, expected[1])
    assert ok(owner.c.get("/api/props"))["props"] == [], "a refused upload leaves no prop"
    for key in set(s3.keys("props/")) - keys_before:
        assert s3.get(key) != spec["data"], "a refused upload leaves no object"


def test_prop_placeable_only_once_stored(app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    ghost = glb()
    keys_before = set(s3.keys("props/"))
    err(upload(md.c, f"Ghost chest {owner.tag}", ghost), 503, "storage_unavailable")
    assert ok(owner.c.get("/api/props"))["props"] == []
    for key in set(s3.keys("props/")) - keys_before:
        assert s3.get(key) != ghost
    data = glb()
    prop = ok(upload(owner.c, f"Sea chest {owner.tag}", data), 201)["prop"]
    for listed in ok(owner.c.get("/api/props"))["props"]:
        assert f"props/{listed['id']}.glb" in s3.keys("props/"), "every listed prop has its stored object"
    assert s3.get(f"props/{prop['id']}.glb") == data
    ship = rooms_by_name(owner)["Ship's Hold"]
    placed = ok(owner.c.post(f"/api/rooms/{ship['id']}/placements",
                             json={"kind": "prop", "label": "Chest", "propId": prop["id"], "xMm": 2500, "yMm": 0,
                                   "zMm": 2000, "rotationDeg": 0}), 201)["placement"]
    assert (placed["widthMm"], placed["depthMm"], placed["heightMm"]) == (900, 500, 600)
    err(owner.c.delete(f"/api/props/{prop['id']}"), 409, "prop_in_use")
    assert owner.c.delete(f"/api/rooms/{ship['id']}/placements/{placed['id']}").status_code == 204
    assert owner.c.delete(f"/api/props/{prop['id']}").status_code == 204
    assert f"props/{prop['id']}.glb" not in s3.keys("props/")
    assert owner.c.get(f"/api/props/{prop['id']}/file").status_code == 404
    invalid(owner.c.post(f"/api/rooms/{ship['id']}/placements", json=placement_body("Chest", "prop", propId=prop["id"])),
            "propId", "unknown prop")


def test_wf_prop_upload_storage_down(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    name = f"Lost chest {owner.tag}"
    data = glb()
    keys_before = set(s3.keys("props/"))
    with member_page(browser, md) as page:
        open_room(page, "Ship's Hold")
        click(page.get_by_role("button", name="Upload prop"))
        library = page.get_by_role("dialog", name="Prop library")
        shows(page, library, "Upload prop opens the library")
        library.get_by_label("glTF file").set_input_files({"name": "sea-chest.glb", "mimeType": "model/gltf-binary", "buffer": data})
        fill(library.get_by_role("textbox", name="Prop name"), name)
        fill(library.get_by_role("textbox", name="Width (m)"), "0.900")
        fill(library.get_by_role("textbox", name="Depth (m)"), "0.500")
        fill(library.get_by_role("textbox", name="Height (m)"), "0.600")
        click(library.get_by_role("button", name="Upload"))
        shows(page, editor_status(page), "failure copy", exact="Upload failed. Nothing was added.")
        expect(library.get_by_role("button", name=f"Place {name}")).to_have_count(0)
    assert ok(owner.c.get("/api/props"))["props"] == []
    for key in set(s3.keys("props/")) - keys_before:
        assert s3.get(key) != data


def test_wf_prop_upload_library(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    ship = rooms_by_name(owner)["Ship's Hold"]
    name = "Coffre à secrets"
    data = glb()
    with member_page(browser, owner) as page:
        open_room(page, "Ship's Hold")
        shows(page, chain_figures(page), "four props", contains="4 props")
        stage(page).focus()
        page.keyboard.press("l")
        library = page.get_by_role("dialog", name="Prop library")
        shows(page, library, "L opens the library", contains="No props yet. Upload a glTF file to start the library.")
        library.get_by_label("glTF file").set_input_files({"name": "sea-chest.glb", "mimeType": "model/gltf-binary", "buffer": data})
        fill(library.get_by_role("textbox", name="Prop name"), name)
        fill(library.get_by_role("textbox", name="Width (m)"), "0.900")
        fill(library.get_by_role("textbox", name="Depth (m)"), "0.500")
        fill(library.get_by_role("textbox", name="Height (m)"), "0.600")
        with holding(page, "**/api/props") as hold:
            click(library.get_by_role("button", name="Upload"))
            shows(page, editor_status(page), "pending copy", exact="Uploading sea-chest.glb...")
            expect(library.get_by_role("button", name=f"Place {name}")).to_have_count(0)
            hold.release()
            shows(page, editor_status(page), "success copy", exact=f"{name} is in the library.")
        place = library.get_by_role("button", name=f"Place {name}")
        shows(page, place, "stored card")
        prop = ok(owner.c.get("/api/props"))["props"][0]
        assert prop["name"] == name and prop["widthMm"] == PROP_WIDTH_MM
        assert s3.get(f"props/{prop['id']}.glb") == data, "the card follows the stored object"
        click(place)
        wait_gone(page, library, "Place closes the sheet")
        shows(page, chain_figures(page), "prop count rises", contains="5 props")
    detail = room_detail(owner, ship["id"])
    placed = [p for p in detail["placements"] if p["propId"] == prop["id"]]
    assert len(placed) == 1 and placed[0]["kind"] == "prop"
    assert placed[0]["xMm"] == detail["room"]["widthMm"] // 2 and placed[0]["zMm"] == detail["room"]["depthMm"] // 2


def test_wf_prop_upload_invalid_file(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    with member_page(browser, owner) as page:
        open_room(page, "Vault")
        click(page.get_by_role("button", name="Upload prop"))
        library = page.get_by_role("dialog", name="Prop library")
        shows(page, library, "library opens")
        library.get_by_label("glTF file").set_input_files({"name": "photo.png", "mimeType": "image/png", "buffer": png()})
        fill(library.get_by_role("textbox", name="Prop name"), f"Photo {owner.tag}")
        fill(library.get_by_role("textbox", name="Width (m)"), "0.900")
        fill(library.get_by_role("textbox", name="Depth (m)"), "0.500")
        fill(library.get_by_role("textbox", name="Height (m)"), "0.600")
        click(library.get_by_role("button", name="Upload"))
        shows(page, editor_status(page), "failure copy", exact="Upload failed. Nothing was added.")
        shows(page, library, "empty copy stays", contains="No props yet. Upload a glTF file to start the library.")
    assert ok(owner.c.get("/api/props"))["props"] == []


def test_wf_prop_upload_phone_sheet(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    ship = rooms_by_name(owner)["Ship's Hold"]
    name = f"Phone chest {owner.tag}"
    data = glb()
    with member_page(browser, owner) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        open_room(page, "Ship's Hold")
        bar = tab_bar(page)
        click(page.get_by_role("button", name="Props", exact=True))
        library = page.get_by_role("dialog", name="Prop library")
        shows(page, library, "the Props tab opens the empty library",
              contains="No props yet. Upload a glTF file to start the library.")
        advance(page, DOLLY_MAX_MS)
        phone_sheet(library, bar, "the Prop library sheet")
        library.get_by_label("glTF file").set_input_files({"name": "sea-chest.glb", "mimeType": "model/gltf-binary",
                                                         "buffer": data})
        fill(library.get_by_role("textbox", name="Prop name"), name)
        fill(library.get_by_role("textbox", name="Width (m)"), "0.900")
        fill(library.get_by_role("textbox", name="Depth (m)"), "0.500")
        fill(library.get_by_role("textbox", name="Height (m)"), "0.600")
        upload_button = library.get_by_role("button", name="Upload", exact=True)
        upload_button.evaluate("e => e.scrollIntoView({block: 'nearest', behavior: 'instant'})")
        above_bar(upload_button, bar, "the Upload button")
        click(upload_button)
        place = library.get_by_role("button", name=f"Place {name}")
        shows(page, place, "the stored prop card appears")
        focused(page, place, "a stored upload moves focus to its Place button")
        page.keyboard.press("Enter")
        wait_gone(page, library, "Place closes the sheet")
        prop = api_until(page, lambda: {p["name"]: p for p in ok(owner.c.get("/api/props"))["props"]},
                         lambda props: name in props, "the prop is stored")[name]
        api_until(page, lambda: room_detail(owner, ship["id"])["placements"],
                  lambda ps: any(p["propId"] == prop["id"] for p in ps), "Enter on Place adds the prop to the room")
    assert s3.get(f"props/{prop['id']}.glb") == data


@pytest.mark.timeout(900)
def test_boot_without_dependencies(app_url: str, mail: Any) -> None:
    for var, service in (("APP_VALKEY_DOWN_URL", "valkey"), ("APP_MINIO_DOWN_URL", "minio"), ("APP_MAIL_DOWN_URL", "mail")):
        body = health(outage_url(var))
        assert body["status"] == "ok" and body["services"][service] == "down" and body["services"]["postgres"] == "up"
    valkey_relay, valkey_url = relay_for_url(env_required("VALKEY_URL"), VALKEY_DEFAULT_PORT)
    s3_endpoint = env_required("S3_ENDPOINT")
    s3_relay, s3_url = relay_for_url(s3_endpoint, HTTPS_DEFAULT_PORT if s3_endpoint.startswith("https") else HTTP_DEFAULT_PORT)
    smtp_relay = Relay(env_required("SMTP_HOST"), int(env_required("SMTP_PORT")))
    relays = [valkey_relay, s3_relay, smtp_relay]
    try:
        with app_copy({"VALKEY_URL": valkey_url, "S3_ENDPOINT": s3_url, "SMTP_HOST": "127.0.0.1",
                       "SMTP_PORT": str(smtp_relay.port), "INSTANCE_NAME": "recovery"}) as base:
            body = health(base)
            assert body["status"] == "ok"
            assert body["services"] == {"postgres": "up", "valkey": "down", "minio": "down", "mail": "down"}
            owner = signup(base)
            room = rooms_by_name(owner)["Apothecary"]
            node = add_node(owner, room["id"], "Recovery clue")
            lock = {"targetType": "node", "targetId": node["id"]}
            err(owner.c.post(f"/api/rooms/{room['id']}/locks", json=lock), 503, "live_unavailable")
            err(upload(owner.c, f"Down {owner.tag}", glb()), 503, "storage_unavailable")
            session = schedule(owner, room["id"], server_now(base) + timedelta(minutes=10))
            tester, _ = fresh("recover")
            assert invite(owner, session["id"], tester)["emailStatus"] == "queued"
            for relay in relays:
                relay.up = True
            back = time.monotonic()
            poll(lambda: health(base), lambda h: all(h["services"][s] == "up" for s in SERVICES),
                 "health reports every service up again", RECOVERY_S + RECOVERY_SLACK_S)
            assert time.monotonic() - back <= RECOVERY_S + RECOVERY_SLACK_S
            ok(owner.c.post(f"/api/rooms/{room['id']}/locks", json=lock))
            ok(upload(owner.c, f"Back {owner.tag}", glb()), 201)
            wait_mail(mail, "the queued invite is sent after mail returns", to=tester,
                      subject="Playtest invite: Apothecary", seconds=RECOVERY_S + MAIL_SLACK_S)
            poll(lambda: session_get(owner, session["id"])["testers"], lambda t: t and t[0]["emailStatus"] == "sent",
                 "the roster shows sent", RECOVERY_S + MAIL_SLACK_S)
    finally:
        for relay in relays:
            relay.stop()


@pytest.mark.timeout(900)
def test_wf_outages_valkey_recovery(browser: Browser, app_url: str) -> None:
    relay, valkey_url = relay_for_url(env_required("VALKEY_URL"), VALKEY_DEFAULT_PORT)
    try:
        with app_copy({"VALKEY_URL": valkey_url, "INSTANCE_NAME": "valkey-recovery"}) as base:
            mara_copy = login(base, MARA)
            tobi = login(app_url, TOBI)
            room = make_room(tobi, f"Recover {mara_copy.tag}")
            with member_page(browser, mara_copy) as page, member_page(browser, tobi) as other:
                open_room(page, room["name"])
                open_room(other, room["name"])
                shows(page, page.get_by_role("status", name="Service status"), "live banner",
                      exact="Live editing is paused. Solo editing still works.")
                shows(page, page.get_by_role("toolbar", name="Live session"), "Paused word", contains="Paused")
                relay.up = True
                limit = RECOVERY_S + RECOVERY_SLACK_S
                eventually(page, lambda: require("Live editing is paused" not in (page.get_by_role("status", name="Service status").text_content() or ""),
                                                 "banner cleared"), "the banner clears", limit)
                shows(page, page.get_by_role("toolbar", name="Live session"), "Live word", contains="Live", seconds=limit)
                shows(page, page.get_by_role("button", name="Presence"), "presence returns", contains="2 here", seconds=limit)
    finally:
        relay.stop()


def test_live_outage_api(app_url: str) -> None:
    owner = signup(app_url)
    vd = login_as(outage_url("APP_VALKEY_DOWN_URL"), owner.email, owner.password)
    assert health(vd.base)["services"]["valkey"] == "down"
    rooms = rooms_by_name(owner)
    room = rooms["Observatory"]
    detail = room_detail(owner, room["id"])
    placement = detail["placements"][1]
    node = detail["nodes"][0]
    err(vd.c.post(f"/api/rooms/{room['id']}/locks", json={"targetType": "placement", "targetId": placement["id"]}),
        503, "live_unavailable")
    moved = ok(vd.c.patch(f"/api/rooms/{room['id']}/placements/{placement['id']}",
                          json={"version": placement["version"], "xMm": placement["xMm"] + NUDGE_MM}))["placement"]
    assert moved["version"] == placement["version"] + 1
    ok(vd.c.patch(f"/api/rooms/{room['id']}/nodes/{node['id']}", json={"version": node["version"], "title": "Star chart two"}))
    err(vd.c.post(f"/api/rooms/{room['id']}/walk-in"), 503, "live_unavailable")
    session = schedule(vd, room["id"], server_now(app_url) + timedelta(minutes=10))
    err(vd.c.post(f"/api/playtests/{session['id']}/open"), 503, "live_unavailable")
    assert session_get(owner, session["id"])["state"] == "scheduled"
    tester, _ = fresh("vd")
    invite(vd, session["id"], tester)
    assert move(vd, session["id"], "cancel")["state"] == "cancelled"
    cabin = rooms["Signal Cabin"]
    running = walk_in(owner, cabin["id"])
    morse = nodes_by_title(room_detail(owner, cabin["id"]))["Morse key"]
    err(vd.c.post(f"/api/playtests/{running['id']}/hints", json={"text": "Look up"}), 503, "live_unavailable")
    err(vd.c.post(f"/api/playtests/{running['id']}/solves", json={"nodeId": morse["id"], "answer": None}), 503, "live_unavailable")
    assert session_get(owner, running["id"])["hintsUsed"] == 0 and session_get(owner, running["id"])["solves"] == []
    ended = move(vd, running["id"], "end")
    assert ended["state"] == "ended" and ended["outcome"] == "stopped"


def test_wf_outages_live_banner(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vd = login_as(outage_url("APP_VALKEY_DOWN_URL"), owner.email, owner.password)
    room = make_room(owner, f"Solo {owner.tag}")
    crate = add_placement(owner, room["id"], "Crate", xMm=1500)
    with member_page(browser, vd) as page:
        open_room(page, room["name"])
        shows(page, page.get_by_role("status", name="Service status"), "live banner",
              exact="Live editing is paused. Solo editing still works.")
        shows(page, page.get_by_role("toolbar", name="Live session"), "Paused", contains="Paused")
        shows(page, page.get_by_role("button", name="Presence"), "only yourself", contains="1 here")
        stage(page).focus()
        page.keyboard.press("g")
        page.keyboard.press("]")
        page.keyboard.press("ArrowRight")
        api_until(page, lambda: placement_now(owner, room["id"], crate["id"]), lambda p: p["xMm"] == 1500 + NUDGE_MM,
                  "a nudge saves during the live outage")


def test_wf_outages_storage_down(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    assert health(md.base)["services"]["minio"] == "down"
    vault = rooms_by_name(owner)["Vault"]
    prop = ok(upload(owner.c, f"Stored {owner.tag}", glb()), 201)["prop"]
    err(upload(md.c, f"Blocked {owner.tag}", glb()), 503, "storage_unavailable")
    err(md.c.put(f"/api/rooms/{vault['id']}/thumbnail", content=png(), headers={"content-type": "image/png"}), 503, "storage_unavailable")
    err(freeze(md, vault["id"], "Blocked"), 503, "storage_unavailable")
    err(md.c.get(f"/api/props/{prop['id']}/file"), 503, "storage_unavailable")
    assert versions(owner, vault["id"]) == []
    crate = room_detail(owner, vault["id"])["placements"][1]
    ok(md.c.patch(f"/api/rooms/{vault['id']}/placements/{crate['id']}", json={"version": crate["version"], "xMm": 1200}))
    with member_page(browser, md) as page:
        open_room(page, "Vault")
        shows(page, page.get_by_role("status", name="Service status"), "storage banner",
              exact="Prop storage is unavailable. Uploads and freezing resume when it's back.")
        stage(page).focus()
        page.keyboard.press("g")
        page.keyboard.press("]")
        before = room_detail(owner, vault["id"])["placements"][0]
        page.keyboard.press("ArrowRight")
        api_until(page, lambda: placement_now(owner, vault["id"], before["id"]),
                  lambda p: p["version"] == before["version"] + 1, "editing continues during the storage outage")


def test_playtest_lifecycle(app_url: str) -> None:
    owner = signup(app_url)
    peer = login_as(outage_url("APP_PEER_URL"), owner.email, owner.password)
    rooms = rooms_by_name(owner)
    obs = rooms["Observatory"]["id"]
    now = server_now(app_url)
    invalid(owner.c.post("/api/playtests", json={"roomId": obs, "startsAt": "soon"}), "startsAt", "not a valid time")
    for bad in (now + timedelta(days=SCHEDULE_AHEAD_DAYS, minutes=10), now - timedelta(minutes=SCHEDULE_PAST_MIN + 1)):
        invalid(owner.c.post("/api/playtests", json={"roomId": obs, "startsAt": iso(bad)}),
                "startsAt", "must be between 5 minutes ago and 30 days ahead")
    s = schedule(owner, obs, now + timedelta(minutes=10))
    assert s["state"] == "scheduled" and s["kind"] == "remote"
    for action in ("start", "end"):
        assert err(owner.c.post(f"/api/playtests/{s['id']}/{action}"), 409, "invalid_transition")["state"] == "scheduled"
    assert move(owner, s["id"], "open")["state"] == "lobby"
    other = schedule(owner, obs, now + timedelta(minutes=20))
    err(owner.c.post(f"/api/playtests/{other['id']}/open"), 409, "room_busy")
    err(owner.c.post(f"/api/rooms/{obs}/walk-in"), 409, "room_busy")
    assert move(owner, s["id"], "start")["state"] == "running"
    assert err(owner.c.post(f"/api/playtests/{s['id']}/cancel"), 409, "invalid_transition")["state"] == "running"
    ended = move(owner, s["id"], "end")
    assert ended["state"] == "ended" and ended["outcome"] == "stopped"
    assert err(owner.c.post(f"/api/playtests/{s['id']}/open"), 409, "invalid_transition")["state"] == "ended"
    assert move(owner, other["id"], "cancel")["state"] == "cancelled"
    lobby = schedule(owner, obs, now + timedelta(minutes=30))
    move(owner, lobby["id"], "open")
    assert move(owner, lobby["id"], "cancel")["state"] == "cancelled"

    cabin = rooms["Signal Cabin"]["id"]
    sessions = [schedule(owner, cabin, now + timedelta(minutes=10 + i)) for i in range(4)]
    responses = race([lambda c=c, sid=x["id"]: c.post(f"/api/playtests/{sid}/open")
                      for c, x in zip([clone(owner), peer.c, clone(owner), peer.c], sessions)])
    assert sum(r.status_code == 200 for r in responses) == 1
    for r in responses:
        if r.status_code != 200:
            err(r, 409, "room_busy")
    vault = rooms["Vault"]["id"]
    walkers = race([lambda c=c: c.post(f"/api/rooms/{vault}/walk-in") for c in [clone(owner), peer.c, clone(owner), peer.c]])
    assert sum(r.status_code == 201 for r in walkers) == 1
    for r in walkers:
        if r.status_code != 201:
            err(r, 409, "room_busy")
    active = [x for x in ok(owner.c.get(f"/api/rooms/{vault}/playtests"))["sessions"] if x["state"] == "running"]
    assert len(active) == 1


@pytest.mark.timeout(300)
def test_server_owned_clock(app_url: str) -> None:
    short = outage_url("APP_SHORT_URL")
    owner = signup(short)
    rooms = rooms_by_name(owner)
    scheduled = schedule(owner, rooms["Observatory"]["id"], server_now(short) + timedelta(minutes=10))
    duration = scheduled["durationSeconds"]
    assert 0 < duration < DEFAULT_DURATION_S, "durationSeconds follows PLAYTEST_DURATION_SECONDS"
    assert scheduled["remainingSeconds"] == duration
    session = walk_in(owner, rooms["Vault"]["id"])
    assert session["remainingSeconds"] == duration
    deadline = time.monotonic() + duration + TIMER_SLACK_S
    final = None
    while time.monotonic() < deadline and final is None:
        current = session_get(owner, session["id"])
        elapsed = (parse_time(current["serverTime"]) - parse_time(current["startedAt"])).total_seconds()
        if elapsed >= duration:
            assert current["state"] == "ended" and current["outcome"] == "timed_out", "a read past the deadline shows ended"
            assert current["remainingSeconds"] == 0
            final = current
        elif current["state"] == "running":
            assert abs(current["remainingSeconds"] - (duration - math.floor(elapsed))) <= 1
        else:
            assert current["state"] == "ended" and elapsed >= duration - 1
            final = current
    require(final is not None, "the server ended the playtest at its deadline")
    assert final["endedAt"] and final["outcome"] == "timed_out"
    again = session_get(owner, session["id"])
    assert again["remainingSeconds"] == 0 and again["state"] == "ended"
    assert err(owner.c.post(f"/api/playtests/{session['id']}/end"), 409, "invalid_transition")["state"] == "ended"


def test_wf_playtest_run_wrong_clock(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    apoth = rooms_by_name(owner)["Apothecary"]
    session = schedule(owner, apoth["id"], server_now(app_url) + timedelta(minutes=10))
    move(owner, session["id"], "open")
    move(owner, session["id"], "start")
    with member_page(browser, owner) as page:
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        page.reload()
        loaded = time.monotonic()
        open_room(page, "Apothecary")
        clock = page.get_by_role("timer", name="Playtest clock")
        shows(page, clock, "the transport shows the running clock")
        served = session_get(owner, session["id"])["remainingSeconds"]
        assert abs(clock_seconds(clock) - served) <= CLOCK_TOLERANCE_S + math.ceil(time.monotonic() - loaded)
        click(page.get_by_role("button", name="Playtests"))
        sheet = page.get_by_role("dialog", name="Playtests")
        fill(sheet.get_by_role("textbox", name="Hint"), "Check the shelf")
        click(sheet.get_by_role("button", name="Send hint"))
        sent = api_until(page, lambda: session_get(owner, session["id"]), lambda s: s["hintsUsed"] == 1, "hint sent")
        cooldown = sent["hintCooldownSeconds"]
        shows(page, sheet, "cooldown copy from the server",
              contains=re.compile("Next hint in (" + "|".join(mss(cooldown - d) for d in range(CLOCK_TOLERANCE_S + 1)) + ")"))
        fill(sheet.get_by_role("textbox", name="Hint"), "Second hint")
        click(sheet.get_by_role("button", name="Send hint"))
        shows(page, editor_status(page), "refused hint announces the cooldown", contains="Next hint in ")
    assert session_get(owner, session["id"])["hintsUsed"] == 1


def test_wf_playtest_run_schedule(browser: Browser, app_url: str, mail: Any) -> None:
    owner = signup(app_url)
    apoth = rooms_by_name(owner)["Apothecary"]
    start = (server_now(app_url) + timedelta(minutes=10)).replace(second=0, microsecond=0)
    testers = [fresh("sched")[0] for _ in range(3)]
    with member_page(browser, owner) as page:
        open_room(page, "Apothecary")
        opener = page.get_by_role("button", name="Playtests")
        opener.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Playtests")
        shows(page, sheet, "Playtests sheet opens")
        local = page.evaluate("ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0');"
                              " return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }",
                              start.timestamp() * 1000)
        sheet.get_by_label("Start time").fill(local)
        sheet.get_by_role("button", name="Schedule playtest").focus()
        page.keyboard.press("Enter")
        shows(page, sheet, "start time in UTC", contains=f"{start:%Y-%m-%d %H:%M} UTC")
        session = api_until(page, lambda: ok(owner.c.get(f"/api/rooms/{apoth['id']}/playtests"))["sessions"],
                            lambda s: len(s) == 1, "a session is scheduled")[0]
        assert session["state"] == "scheduled" and parse_time(session["startsAt"]) == start
        roster = sheet.get_by_role("table", name="Roster")
        for email in testers:
            field = sheet.get_by_role("textbox", name="Tester email")
            field.fill("")
            field.focus()
            page.keyboard.type(email)
            sheet.get_by_role("button", name="Send invite").focus()
            page.keyboard.press("Enter")
            api_until(page, lambda e=email: [t["email"] for t in session_get(owner, session["id"])["testers"]],
                      lambda emails, e=email: e in emails, f"invite to {email} created")
            shows(page, roster.get_by_role("row").filter(has_text=email), f"{email} row appears in the roster")
        for email in testers:
            shows(page, roster.get_by_role("row").filter(has_text=email), f"{email} row shows Sent", contains="Sent")
        sheet.get_by_role("button", name="Open lobby").focus()
        page.keyboard.press("Enter")
        api_until(page, lambda: session_get(owner, session["id"]), lambda s: s["state"] == "lobby", "lobby opened")
        start_button = sheet.get_by_role("button", name="Start", exact=True)
        shows(page, start_button, "Start shown in the lobby")
        start_button.focus()
        page.keyboard.press("Enter")
        api_until(page, lambda: session_get(owner, session["id"]), lambda s: s["state"] == "running", "session started")
        shows(page, page.get_by_role("timer", name="Playtest clock"), "the clock runs")
        eventually(page, lambda: require(focus_inside(sheet), "focus stays in the sheet"), "focus stays in the Playtests sheet")
        page.keyboard.press("Escape")
        wait_gone(page, sheet, "Escape closes the sheet")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS), "focus returns to Playtests")
    for email in testers:
        message = wait_mail(mail, f"invite mailed to {email}", to=email, subject="Playtest invite: Apothecary")[0]
        assert f"Starts {start:%Y-%m-%d %H:%M} UTC" in text(message)


@pytest.mark.timeout(300)
def test_hint_cooldown(app_url: str) -> None:
    short = outage_url("APP_SHORT_URL")
    mara, tobi = login(short, MARA), login(short, TOBI)
    room = make_room(mara, f"Hints {mara.tag}")
    add_node(mara, room["id"], "Clue")
    session = walk_in(mara, room["id"])
    sid = session["id"]
    email, _ = fresh("hint")
    token = token_of(invite(mara, sid, email)["joinUrl"])
    ok(client(short).post(f"/api/play/{token}/join", json={"displayName": "Tester"}))
    err(tobi.c.post(f"/api/playtests/{sid}/hints", json={"text": "Not my session"}), 403, "forbidden")
    invalid(mara.c.post(f"/api/playtests/{sid}/hints", json={"text": "x" * (HINT_MAX + 1)}), "text")
    invalid(mara.c.post(f"/api/playtests/{sid}/hints", json={"text": ""}), "text")
    with Stream(short, f"/api/play/{token}/events") as stream:
        since = stream.mark()
        body = ok(mara.c.post(f"/api/playtests/{sid}/hints", json={"text": HINT_TEXT}), 201)
        done = time.monotonic()
        cooldown = body["hintCooldownSeconds"]
        assert body["hint"]["text"] == HINT_TEXT
        assert 0 < cooldown < DEFAULT_COOLDOWN_S, "the cooldown follows HINT_COOLDOWN_SECONDS"
        _, data, at = stream.wait(lambda e, d: e == "hint" and isinstance(d, dict) and d.get("text") == HINT_TEXT,
                                  "the tester stream receives the hint", since)
        assert at - done <= LIVE_S and data["hintsUsed"] == 1
    refused = err(mara.c.post(f"/api/playtests/{sid}/hints", json={"text": "Again"}), 429, "hint_cooldown")
    assert 1 <= refused["retryAfterSeconds"] <= cooldown
    assert session_get(mara, sid)["hintsUsed"] == 1
    poll(lambda: session_get(mara, sid), lambda s: s["hintCooldownSeconds"] == 0, "the cooldown reaches zero", cooldown + LAPSE_SLACK_S)
    ok(mara.c.post(f"/api/playtests/{sid}/hints", json={"text": "Again"}), 201)
    assert session_get(mara, sid)["hintsUsed"] == 2


@pytest.mark.timeout(300)
def test_email_invitations(app_url: str, mail: Any) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    start = (server_now(app_url) + timedelta(minutes=10)).replace(second=0, microsecond=0)
    session = schedule(owner, rooms["Apothecary"]["id"], start)
    sid = session["id"]
    emails = [fresh("invite")[0] for _ in range(ROSTER_MAX + 1)]
    first = invite(owner, sid, emails[0])
    token = token_of(first["joinUrl"])
    assert len(token) >= TOKEN_MIN and re.fullmatch(r"[A-Za-z0-9_-]+", token)
    assert urllib.parse.urlsplit(first["joinUrl"]).path == f"/play/{token}"
    message = wait_mail(mail, "invite mailed", to=emails[0], subject="Playtest invite: Apothecary")[0]
    assert f"Starts {start:%Y-%m-%d %H:%M} UTC" in text(message) and first["joinUrl"] in text(message)
    assert addresses(message.get("From")) == ["playtests@keyway.test"]
    poll(lambda: session_get(owner, sid)["testers"], lambda t: t[0]["emailStatus"] == "sent", "roster shows sent")
    invalid(owner.c.post(f"/api/playtests/{sid}/invites", json={"email": emails[0]}), "email", "already invited")
    tokens = {token}
    for email in emails[1:ROSTER_MAX]:
        tokens.add(token_of(invite(owner, sid, email)["joinUrl"]))
    assert len(tokens) == ROSTER_MAX, "every invite has its own token"
    err(owner.c.post(f"/api/playtests/{sid}/invites", json={"email": emails[ROSTER_MAX]}), 409, "roster_full")
    wait_mail(mail, "six invites mailed", count=1, to=emails[ROSTER_MAX - 1])
    assert mails(mail, to=emails[ROSTER_MAX]) == [], "a refused invite mails nothing"
    assert owner.c.delete(f"/api/playtests/{sid}/invites/{first['id']}").status_code == 204
    invite(owner, sid, emails[ROSTER_MAX])
    resend_target = session_get(owner, sid)["testers"][-1]
    assert ok(owner.c.post(f"/api/playtests/{sid}/invites/{resend_target['inviteId']}/resend"), 202)["invite"]
    wait_mail(mail, "resend mails a second copy", count=2, to=resend_target["email"])
    move(owner, sid, "cancel")
    err(owner.c.post(f"/api/playtests/{sid}/invites", json={"email": fresh("closed")[0]}), 409, "session_closed")
    md = login_as(outage_url("APP_MAIL_DOWN_URL"), owner.email, owner.password)
    queued = schedule(owner, rooms["Observatory"]["id"], start)
    assert invite(md, queued["id"], fresh("queued")[0])["emailStatus"] == "queued"


def test_wf_invites_roster_resend(browser: Browser, app_url: str, mail: Any) -> None:
    owner = signup(app_url)
    session = schedule(owner, rooms_by_name(owner)["Vault"]["id"], server_now(app_url) + timedelta(minutes=10))
    email, _ = fresh("roster")
    with member_page(browser, owner) as page:
        open_room(page, "Vault")
        click(page.get_by_role("button", name="Playtests"))
        sheet = page.get_by_role("dialog", name="Playtests")
        fill(sheet.get_by_role("textbox", name="Tester email"), email)
        click(sheet.get_by_role("button", name="Send invite"))
        shows(page, editor_status(page), "invite announced",
              exact=re.compile("^(" + re.escape(f"Invite sent to {email}.") + "|" + re.escape(f"Invite to {email} is queued.") + ")$"))
        row = sheet.get_by_role("table", name="Roster").get_by_role("row").filter(has_text=email)
        shows(page, row, "roster row Sent", contains="Sent")
        wait_mail(mail, "invite mailed", to=email, subject="Playtest invite: Vault")
        click(sheet.get_by_role("button", name=f"Resend {email}"))
        wait_mail(mail, "resend mailed", count=2, to=email, subject="Playtest invite: Vault")
    assert session_get(owner, session["id"])["testers"][0]["emailStatus"] == "sent"


def test_invite_links(app_url: str) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    now = server_now(app_url)
    s = schedule(owner, rooms["Apothecary"]["id"], now + timedelta(minutes=10))
    a, b = fresh("linka")[0], fresh("linkb")[0]
    inv_a, inv_b = invite(owner, s["id"], a), invite(owner, s["id"], b)
    ta, tb = token_of(inv_a["joinUrl"]), token_of(inv_b["joinUrl"])
    anon = client(app_url)
    response = anon.get(f"/api/play/{ta}")
    play = ok(response)
    for secret in (a, b, owner.email):
        assert secret not in response.text

    def values(node: Any) -> list[Any]:
        if isinstance(node, dict):
            return [v for x in node.values() for v in values(x)]
        if isinstance(node, list):
            return [v for x in node for v in values(x)]
        return [node]

    assert not [v for v in values(play) if str(v) == "4172"], "the Herb cabinet answer is not sent to a tester"
    assert play["room"]["name"] == "Apothecary"
    assert [n["title"] for n in play["nodes"]] == APOTHECARY_CHAIN
    by_title = {n["title"]: n for n in play["nodes"]}
    assert by_title["Herb cabinet code"]["needsAnswer"] is True and by_title["Scale balance"]["needsAnswer"] is False
    assert all("answer" not in n for n in play["nodes"])
    err(anon.get(f"/api/playtests/{s['id']}", headers={"Authorization": f"Bearer {ta}"}), 401, "unauthenticated")
    err(anon.get(f"/api/rooms/{rooms['Apothecary']['id']}", params={"token": ta}), 401, "unauthenticated")
    invalid(anon.post(f"/api/play/{ta}/join", json={"displayName": "   "}), "displayName")
    invalid(anon.post(f"/api/play/{ta}/join", json={"displayName": "n" * (DISPLAY_NAME_MAX + 1)}), "displayName")
    joined = ok(anon.post(f"/api/play/{ta}/join", json={"displayName": "  Pat  "}))
    assert joined["me"] == {"displayName": "Pat", "joined": True}
    assert ok(anon.post(f"/api/play/{ta}/join", json={"displayName": RENAMED_JOINER}))["me"]["displayName"] == RENAMED_JOINER
    assert owner.c.delete(f"/api/playtests/{s['id']}/invites/{inv_b['id']}").status_code == 204
    err(anon.get(f"/api/play/{tb}"), 404, "not_found")
    err(anon.post(f"/api/play/{tb}/join", json={"displayName": "B"}), 404, "not_found")
    move(owner, s["id"], "cancel")
    err(anon.get(f"/api/play/{ta}"), 410, "invite_expired")
    err(anon.post(f"/api/play/{ta}/join", json={"displayName": "Pat"}), 410, "invite_expired")
    other = schedule(owner, rooms["Observatory"]["id"], now + timedelta(minutes=10))
    tc = token_of(invite(owner, other["id"], fresh("linkc")[0])["joinUrl"])
    assert ok(anon.get(f"/api/play/{tc}"))["room"]["name"] == "Observatory"
    move(owner, other["id"], "open")
    move(owner, other["id"], "start")
    move(owner, other["id"], "end")
    err(anon.get(f"/api/play/{tc}"), 410, "invite_expired")
    err(anon.get(f"/api/play/{JUNK_TOKEN}"), 404, "not_found")


def test_wf_invites_links(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    start = (server_now(app_url) + timedelta(minutes=10)).replace(second=0, microsecond=0)
    s = schedule(owner, rooms["Signal Cabin"]["id"], start)
    email = fresh("revoke")[0]
    token = token_of(invite(owner, s["id"], email)["joinUrl"])
    ended = schedule(owner, rooms["Observatory"]["id"], start)
    expired_token = token_of(invite(owner, ended["id"], fresh("expired")[0])["joinUrl"])
    move(owner, ended["id"], "cancel")
    with opened(browser, f"{app_url}/play/{token}") as tester:
        shows(tester, tester.get_by_text(f"This playtest starts {start:%Y-%m-%d %H:%M} UTC.", exact=True), "scheduled copy")
        expect(tester.get_by_role("textbox", name="Display name")).to_be_visible()
        with member_page(browser, owner) as page:
            open_room(page, "Signal Cabin")
            click(page.get_by_role("button", name="Playtests"))
            sheet = page.get_by_role("dialog", name="Playtests")
            click(sheet.get_by_role("button", name=f"Revoke {email}"))
            api_until(page, lambda: client(app_url).get(f"/api/play/{token}").status_code, lambda c: c == 404,
                      "Revoke kills the link at once")
        tester.reload()
        shows(tester, tester.get_by_text("This link isn't valid.", exact=True), "revoked copy")
        tester.goto(f"{app_url}/play/{expired_token}")
        shows(tester, tester.get_by_text("This playtest invite has expired.", exact=True), "expired copy")
        expect(tester.get_by_role("button", name="Join")).to_have_count(0)
        tester.goto(f"{app_url}/nowhere-{owner.tag}")
        shows(tester, tester.get_by_text("This link isn't valid.", exact=True), "unknown route copy")


def test_solving_chain(app_url: str) -> None:
    owner = signup(app_url)
    apoth = rooms_by_name(owner)["Apothecary"]
    nodes = nodes_by_title(room_detail(owner, apoth["id"]))
    s = schedule(owner, apoth["id"], server_now(app_url) + timedelta(minutes=10))
    t1 = token_of(invite(owner, s["id"], fresh("solve1")[0])["joinUrl"])
    t2 = token_of(invite(owner, s["id"], fresh("solve2")[0])["joinUrl"])
    t3 = token_of(invite(owner, s["id"], fresh("solve3")[0])["joinUrl"])
    anon = client(app_url)
    ok(anon.post(f"/api/play/{t1}/join", json={"displayName": JOINER_NAME}))
    move(owner, s["id"], "open")
    ok(anon.post(f"/api/play/{t2}/join", json={"displayName": "Ben"}))

    def solve(token: str, title: str, answer: str | None = None) -> httpx.Response:
        return anon.post(f"/api/play/{token}/solves", json={"nodeId": nodes[title]["id"], "answer": answer})

    err(solve(t1, "Scale balance"), 409, "session_not_running")
    move(owner, s["id"], "start")
    assert session_get(owner, s["id"])["solves"] == []
    err(solve(t3, "Scale balance"), 409, "not_joined")
    err(solve(t1, "Cabinet maglock"), 409, "prerequisites_unsolved")
    err(solve(t1, "Antidote recipe"), 409, "prerequisites_unsolved")
    invalid(solve(t1, "Herb cabinet code", "1234"), "answer", "incorrect")
    body = ok(solve(t1, "Herb cabinet code", " 4172 "))
    assert body["alreadySolved"] is False
    solved = {n["title"]: n["solved"] for n in body["nodes"]}
    assert solved["Cabinet maglock"] and solved["Blacklight label"], "the maglock and cue fired on their own"
    log = {x["title"]: x for x in session_get(owner, s["id"])["solves"]}
    assert log["Herb cabinet code"]["solvedBy"] == JOINER_NAME
    assert log["Cabinet maglock"]["solvedBy"] is None and log["Blacklight label"]["solvedBy"] is None
    responses = race([lambda t=t: solve(t, "Scale balance") for t in (t1, t2, t1, t2, t1, t2)])
    assert all(r.status_code == 200 for r in responses)
    assert sum(r.json()["alreadySolved"] is False for r in responses) == 1
    assert [x["title"] for x in session_get(owner, s["id"])["solves"]].count("Scale balance") == 1
    ok(solve(t2, "Antidote recipe"))
    ok(solve(t2, "Exit door"))
    final = session_get(owner, s["id"])
    assert final["state"] == "ended" and final["outcome"] == "escaped"


def test_wf_phone_playtest_tester_journey(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    apoth = rooms_by_name(owner)["Apothecary"]
    s = schedule(owner, apoth["id"], server_now(app_url) + timedelta(minutes=10))
    token = token_of(invite(owner, s["id"], fresh("phone")[0])["joinUrl"])
    move(owner, s["id"], "open")
    with opened(browser, f"{app_url}/play/{token}") as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        shows(page, page.get_by_text("Waiting for the game master to start.", exact=True), "lobby copy")
        layout(page)
        slots = [page.get_by_role("button", name=n, exact=True).bounding_box() for n in ("Puzzles", "Hints", "Join", "Units", "Help")]
        assert [b["x"] for b in slots] == sorted(b["x"] for b in slots)
        assert slots[2]["y"] < slots[0]["y"], "Join is raised above the tab bar"
        fill(page.get_by_role("textbox", name="Display name"), TESTER_NAME)
        click(page.get_by_role("button", name="Join", exact=True))
        joined = page.get_by_role("button", name=re.compile("^Join"))
        shows(page, joined, "Join becomes Joined", contains="Joined")
        expect(joined).to_be_disabled()
        assert ok(client(app_url).get(f"/api/play/{token}"))["me"]["joined"] is True
        move(owner, s["id"], "start")
        status = page.get_by_role("status", name="Playtest status")
        eventually(page, lambda: require(re.search(r"\b\d{2}:\d{2}\b", page.evaluate("() => document.body.innerText")), "clock"),
                   "the clock shows once running")
        before = camera(page)
        page.keyboard.down("w")
        advance(page, 1000)
        page.keyboard.up("w")
        assert not matrices_equal(before, camera(page)), "W walks the tester"

        def solve_ui(title: str, answer: str | None = None) -> None:
            dialog = page.get_by_role("dialog", name="Puzzles")
            if gone(dialog):
                click(page.get_by_role("button", name="Puzzles", exact=True))
            shows(page, dialog.get_by_role("button", name=f"Solve {title}"), f"{title} is available")
            if answer is not None:
                fill(dialog.get_by_role("textbox", name=f"Answer for {title}"), answer)
            click(dialog.get_by_role("button", name=f"Solve {title}"))

        solve_ui("Herb cabinet code", "1234")
        shows(page, status, "wrong answer copy", exact="That's not it.")
        solve_ui("Herb cabinet code", "4172")
        api_until(page, lambda: {n["title"]: n["solved"] for n in ok(client(app_url).get(f"/api/play/{token}"))["nodes"]},
                  lambda n: n["Cabinet maglock"] and n["Blacklight label"], "the maglock and cue fired")
        solve_ui("Scale balance")
        shows(page, status, "solve copy", exact="Scale balance solved.")
        ok(owner.c.post(f"/api/playtests/{s['id']}/hints", json={"text": "Mix it"}), 201)
        shows(page, status, "hint copy", exact="Hint: Mix it")
        solve_ui("Antidote recipe")
        solve_ui("Exit door")
        shows(page, page.get_by_role("heading", name="Playtest ended"), "ended heading")
        page.reload()
        shows(page, page.get_by_text("This playtest invite has expired.", exact=True), "reopened link is expired")
    final = session_get(owner, s["id"])
    assert final["outcome"] == "escaped" and final["solves"][0]["solvedBy"] == TESTER_NAME


def test_wf_phone_playtest_late_join(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    cabin = rooms_by_name(owner)["Signal Cabin"]
    s = schedule(owner, cabin["id"], server_now(app_url) + timedelta(minutes=10))
    token = token_of(invite(owner, s["id"], fresh("late")[0])["joinUrl"])
    move(owner, s["id"], "open")
    move(owner, s["id"], "start")
    with opened(browser, f"{app_url}/play/{token}") as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.clock.set_system_time(WRONG_DEVICE_TIME)
        page.reload()
        fill(page.get_by_role("textbox", name="Display name"), "Late Lee")
        click(page.get_by_role("button", name="Join", exact=True))
        shows(page, page.get_by_role("button", name=re.compile("^Join")), "joined", contains="Joined")
        for _ in range(2):
            loaded = time.monotonic()
            served = ok(client(app_url).get(f"/api/play/{token}"))["session"]["remainingSeconds"]
            eventually(page, lambda: require(re.search(r"\b\d{2}:\d{2}\b", page.evaluate("() => document.body.innerText")), "clock"),
                       "clock shows")
            assert abs(page_clock_seconds(page) - served) <= CLOCK_TOLERANCE_S + math.ceil(time.monotonic() - loaded)
            page.reload()
        click(page.get_by_role("button", name="Puzzles", exact=True))
        click(page.get_by_role("dialog", name="Puzzles").get_by_role("button", name=f"Solve {MORSE_KEY}"))
        shows(page, page.get_by_role("status", name="Playtest status"), "late joiner solves", exact="Morse key solved.")


def expected_debrief(session: dict, chain: list[dict]) -> tuple[list[dict], dict | None]:
    at = {x["nodeId"]: x["elapsedSeconds"] for x in session["solves"]}
    puzzles, choke = [], None
    for node in chain:
        if node["kind"] not in ("puzzle", "exit"):
            continue
        solved = at.get(node["id"])
        wait = None if solved is None else solved - max([at[p] for p in node["prerequisites"]], default=0)
        puzzles.append({"title": node["title"], "solvedAtSeconds": solved, "waitSeconds": wait})
        if wait is not None and (choke is None or wait > choke["waitSeconds"]):
            choke = {"title": node["title"], "waitSeconds": wait}
    return puzzles, choke


def test_debrief_figures(app_url: str) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    apoth = rooms["Apothecary"]
    chain = room_detail(owner, apoth["id"])["nodes"]
    nodes = nodes_by_title({"nodes": chain})
    s = walk_in(owner, apoth["id"])
    err(owner.c.get(f"/api/playtests/{s['id']}/debrief"), 409, "session_not_ended")
    poll(lambda: session_get(owner, s["id"]), lambda x: x["remainingSeconds"] <= x["durationSeconds"] - 2, "two server seconds pass")
    host_solve(owner, s["id"], nodes["Scale balance"]["id"])
    host_solve(owner, s["id"], nodes["Herb cabinet code"]["id"], "4172")
    ok(owner.c.post(f"/api/playtests/{s['id']}/hints", json={"text": "Mix"}), 201)
    mark = session_get(owner, s["id"])["remainingSeconds"]
    poll(lambda: session_get(owner, s["id"]), lambda x: x["remainingSeconds"] <= mark - 1, "a server second passes")
    host_solve(owner, s["id"], nodes["Antidote recipe"]["id"])
    host_solve(owner, s["id"], nodes["Exit door"]["id"])
    final = session_get(owner, s["id"])
    debrief = ok(owner.c.get(f"/api/playtests/{s['id']}/debrief"))
    puzzles, choke = expected_debrief(final, chain)
    assert debrief["outcome"] == "escaped" and debrief["hintsUsed"] == 1
    span = (parse_time(final["endedAt"]) - parse_time(final["startedAt"])).total_seconds()
    assert abs(debrief["elapsedSeconds"] - span) <= 1
    assert debrief["puzzles"] == puzzles and debrief["chokePoint"] == choke
    assert {p["title"] for p in debrief["puzzles"]} == {"Herb cabinet code", "Scale balance", "Antidote recipe", "Exit door"}
    assert debrief["chokePoint"]["waitSeconds"] >= 2
    assert debrief["stats"] == room_stats(owner, apoth["id"]) == {"solved": 6, "total": 6, "longestRun": 3, "props": 4}
    empty = walk_in(owner, rooms["Observatory"]["id"])
    move(owner, empty["id"], "end")
    none = ok(owner.c.get(f"/api/playtests/{empty['id']}/debrief"))
    assert none["outcome"] == "stopped" and none["chokePoint"] is None
    assert all(p["solvedAtSeconds"] is None and p["waitSeconds"] is None for p in none["puzzles"])


def test_wf_debrief_figures_match(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    apoth = rooms_by_name(owner)["Apothecary"]
    herb = nodes_by_title(room_detail(owner, apoth["id"]))["Herb cabinet code"]
    with member_page(browser, owner) as page:
        open_room(page, "Apothecary", walk_in=True)
        session = api_until(page, lambda: room_detail(owner, apoth["id"])["activeSession"], lambda x: x is not None, "walk-in")
        host_solve(owner, session["id"], herb["id"], "4172")
        stats = room_stats(owner, apoth["id"])
        line = stats_figures(stats)
        assert line[0] == "3 of 6 solved"
        shows(page, chain_figures(page), "stage figures", contains=line[0], seconds=LIVE_S + LIVE_UI_SLACK_S)
        click(page.get_by_role("button", name="Stop playtest"))
        debrief = page.get_by_role("dialog", name="Debrief")
        shows(page, debrief, "Debrief opens")
        for figure in line:
            expect(debrief).to_contain_text(figure)
        expect(debrief.get_by_role("table", name="Puzzle times")).to_contain_text("Herb cabinet code")
        page.keyboard.press("Escape")
        click(page.get_by_role("button", name="Rooms", exact=True))
        shows(page, picker(page).get_by_role("option", name="Apothecary"), "room card", contains=" · ".join(line))
    assert ok(owner.c.get(f"/api/playtests/{session['id']}/debrief"))["stats"] == stats


@pytest.mark.timeout(300)
def test_debrief_email(app_url: str, mail: Any) -> None:
    mara, tobi = login(app_url, MARA), login(app_url, TOBI)
    room = make_room(mara, f"Debrief {mara.tag}")
    clue = add_node(mara, room["id"], "Clue one")
    add_node(mara, room["id"], "Clue two")
    add_node(mara, room["id"], "Door", "exit", [clue["id"]])
    s = walk_in(tobi, room["id"])
    testers = [fresh("debrief")[0] for _ in range(2)]
    for email in testers:
        invite(tobi, s["id"], email)
    host_solve(tobi, s["id"], clue["id"])
    ok(tobi.c.post(f"/api/playtests/{s['id']}/hints", json={"text": "Door"}), 201)
    move(tobi, s["id"], "end")
    ended = time.monotonic()
    subject = f"Playtest debrief: {room['name']}"
    recipients = testers + [TOBI[0], MARA[0]]
    for email in recipients:
        wait_mail(mail, f"debrief to {email}", to=email, subject=subject, seconds=DEBRIEF_MAIL_S + MAIL_SLACK_S)
    assert time.monotonic() - ended <= DEBRIEF_MAIL_S + MAIL_SLACK_S
    debrief = ok(tobi.c.get(f"/api/playtests/{s['id']}/debrief"))
    for email in recipients:
        found = mails(mail, to=email, subject=subject)
        assert len(found) == 1, f"exactly one debrief to {email}"
        body = text(found[0])
        assert f"Stopped at {mmss(debrief['elapsedSeconds'])}" in body
        for figure in stats_figures(debrief["stats"]):
            assert figure in body
        for puzzle in debrief["puzzles"]:
            tail = mmss(puzzle["solvedAtSeconds"]) if puzzle["solvedAtSeconds"] is not None else "not solved"
            assert f"{puzzle['title']} — {tail}" in body
        assert "Hints used: 1" in body
        choke = debrief["chokePoint"]
        assert f"Choke point: {choke['title']} ({mss(choke['waitSeconds'])} waiting)" in body
    poll(lambda: ok(tobi.c.get(f"/api/playtests/{s['id']}/debrief"))["emailStatus"], lambda st: st == "sent", "status sent")


def test_wf_debrief_ended_screens(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner) as host:
        open_room(host, "Vault", walk_in=True)
        session = api_until(host, lambda: room_detail(owner, vault["id"])["activeSession"], lambda x: x is not None, "walk-in")
        token = token_of(invite(owner, session["id"], fresh("ended")[0])["joinUrl"])
        with opened(browser, f"{app_url}/play/{token}") as tester:
            fill(tester.get_by_role("textbox", name="Display name"), "Kim")
            click(tester.get_by_role("button", name="Join", exact=True))
            shows(tester, tester.get_by_role("button", name=re.compile("^Join")), "joined", contains="Joined")
            click(host.get_by_role("button", name="Stop playtest"))
            debrief = host.get_by_role("dialog", name="Debrief")
            shows(host, debrief.get_by_role("heading", name="Playtest ended"), "host Debrief heading")
            shows(host, editor_status(host), "ended announced", exact="Playtest ended")
            expect(debrief).to_contain_text(re.compile(r"Stopped at \d{2}:\d{2}"))
            shows(host, debrief, "debrief email status", contains=re.compile(r"Debrief email: (Sent|Queued|Failed)"))
            shows(tester, tester.get_by_role("heading", name="Playtest ended"), "tester ended screen")
    assert session_get(owner, session["id"])["outcome"] == "stopped"


@pytest.mark.timeout(300)
def test_wf_debrief_timed_out(browser: Browser, app_url: str) -> None:
    short = outage_url("APP_SHORT_URL")
    owner = signup(short)
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner) as host:
        open_room(host, "Vault")
        session = walk_in(owner, vault["id"])
        token = token_of(invite(owner, session["id"], fresh("timeout")[0])["joinUrl"])
        with opened(browser, f"{short}/play/{token}") as tester:
            fill(tester.get_by_role("textbox", name="Display name"), TESTER_NAME)
            click(tester.get_by_role("button", name="Join", exact=True))
            shows(tester, tester.get_by_role("button", name=re.compile("^Join")), "the tester joined", contains="Joined")
            shows(host, host.get_by_role("button", name="Stop playtest"), "the host controls the running walk-in")
            api_until(None, lambda: session_get(owner, session["id"]), lambda x: x["state"] == "ended",
                      "the server ends the playtest at its deadline", session["durationSeconds"] + TIMER_SLACK_S)
            for page in (host, tester):
                advance(page, RESYNC_MS)
            debrief = host.get_by_role("dialog", name="Debrief")
            shows(host, debrief.get_by_role("heading", name="Playtest ended"), "the deadline opens the host's Debrief")
            shows(host, debrief, "the timed-out outcome line", contains="Out of time")
            eventually(host, lambda: require(focus_inside(debrief), "focus is inside the Debrief"),
                       "the Debrief dialog takes focus when it opens")
            shows(tester, tester.get_by_role("heading", name="Playtest ended"), "the tester sees the ended screen")
            tester.reload()
            shows(tester, tester.get_by_text("This playtest invite has expired.", exact=True), "the reopened invite has expired")
            expect(tester.get_by_role("button", name="Join")).to_have_count(0)
            expect(tester.get_by_role("textbox", name="Display name")).to_have_count(0)
    final = session_get(owner, session["id"])
    assert final["outcome"] == "timed_out"


def placed_ship(owner: Member, name: str = "Coffre à secrets") -> tuple[dict, dict, bytes]:
    ship = rooms_by_name(owner)["Ship's Hold"]
    data = glb()
    prop = ok(upload(owner.c, name, data), 201)["prop"]
    ok(owner.c.post(f"/api/rooms/{ship['id']}/placements",
                    json={"kind": "prop", "label": name, "propId": prop["id"], "xMm": 2500, "yMm": 0, "zMm": 2000,
                          "rotationDeg": 0}), 201)
    return ship, prop, data


def test_freeze_all_or_nothing(app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    ship, prop, data = placed_ship(owner)
    v1 = ok(freeze(owner, ship["id"], "Carpenter pass 1"), 201)["version"]
    assert v1["number"] == 1 and v1["state"] == "frozen" and v1["supersededBy"] is None
    assert v1["stats"] == room_stats(owner, ship["id"]) and v1["label"] == "Carpenter pass 1"
    token = token_of(v1["packUrl"])
    assert urllib.parse.urlsplit(v1["packUrl"]).path == f"/pack/{token}"
    keys = s3.keys(f"versions/{v1['id']}/")
    assert f"versions/{v1['id']}/snapshot.json" in keys
    assert s3.get(f"versions/{v1['id']}/props/{prop['id']}.glb") == data
    snapshot = s3.get(f"versions/{v1['id']}/snapshot.json")
    assert client(app_url).get(f"/api/pack/{token}/snapshot").content == snapshot
    assert "Ship's Hold" in json.dumps(json.loads(snapshot), ensure_ascii=False)
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    err(freeze(md, ship["id"], "Carpenter pass 2"), 503, "storage_unavailable")
    listed = versions(owner, ship["id"])
    assert [v["id"] for v in listed] == [v1["id"]] and listed[0]["state"] == "frozen" and listed[0]["packUrl"] == v1["packUrl"]
    v2 = ok(freeze(owner, ship["id"], "Carpenter pass 2"), 201)["version"]
    assert v2["number"] == 2
    assert next(v for v in versions(owner, ship["id"]) if v["id"] == v1["id"])["supersededBy"] == 2


def test_wf_freeze_version_owner_ui(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    ship, prop, data = placed_ship(owner)
    with member_page(browser, owner) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        open_room(page, "Ship's Hold")
        click(page.get_by_role("button", name="Session menu"))
        click(page.get_by_role("menuitem", name="Versions"))
        sheet = page.get_by_role("dialog", name="Versions")
        fill(sheet.get_by_role("textbox", name="Version label"), "Carpenter pass 1")
        with holding(page, "**/api/rooms/*/versions") as hold:
            click(sheet.get_by_role("button", name="Freeze version"))
            shows(page, editor_status(page), "pending copy", exact="Freezing version...")
            hold.release()
            shows(page, editor_status(page), "success copy", exact="Version 1 frozen.")
        card = sheet.get_by_role("list", name="Version cards").get_by_role("listitem").first
        shows(page, card, "new card", contains="Frozen")
        expect(card).to_contain_text(re.compile(r"^\s*Version 1"))
        click(card.get_by_role("button", name="Copy build pack link"))
        shows(page, editor_status(page), "link copied", exact="Link copied.")
        version = versions(owner, ship["id"])[0]
        assert page.evaluate("() => navigator.clipboard.readText()") == version["packUrl"]
    assert s3.get(f"versions/{version['id']}/props/{prop['id']}.glb") == data
    assert f"versions/{version['id']}/snapshot.json" in s3.keys(f"versions/{version['id']}/")


def test_wf_freeze_version_storage_down(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    v1 = ok(freeze(owner, vault["id"], "First"), 201)["version"]
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    with member_page(browser, md) as page:
        open_room(page, "Vault")
        click(page.get_by_role("button", name="Session menu"))
        click(page.get_by_role("menuitem", name="Versions"))
        sheet = page.get_by_role("dialog", name="Versions")
        fill(sheet.get_by_role("textbox", name="Version label"), "Second")
        click(sheet.get_by_role("button", name="Freeze version"))
        shows(page, editor_status(page), "retry copy", exact="Freeze failed. Nothing was saved. Try again.")
        cards = sheet.get_by_role("list", name="Version cards").get_by_role("listitem")
        expect(cards).to_have_count(1)
        expect(cards.first).to_contain_text("Frozen")
    listed = versions(owner, vault["id"])
    assert [v["id"] for v in listed] == [v1["id"]] and listed[0]["state"] == "frozen"
    assert ok(freeze(owner, vault["id"], "Second"), 201)["version"]["number"] == 2


def test_freeze_idempotency(app_url: str) -> None:
    owner = signup(app_url)
    rooms = rooms_by_name(owner)
    obs, vault = rooms["Observatory"]["id"], rooms["Vault"]["id"]
    key = idempotency_key()
    first = freeze(owner, obs, "Pass A", key)
    ok(first, 201)
    again = freeze(owner, obs, "Pass A", key)
    assert again.status_code == 201 and again.json() == first.json()
    key2 = idempotency_key()
    clients = [clone(owner) for _ in range(5)]
    responses = race([lambda c=c: c.post(f"/api/rooms/{obs}/versions", json={"label": "Pass B"},
                                         headers={"Idempotency-Key": key2}) for c in clients])
    assert all(r.status_code == 201 for r in responses)
    assert len({json.dumps(r.json(), sort_keys=True) for r in responses}) == 1
    assert len(versions(owner, obs)) == 2
    err(freeze(owner, obs, "Pass C", key2), 409, "idempotency_key_reused")
    err(freeze(owner, vault, "Pass B", key2), 409, "idempotency_key_reused")
    assert len(versions(owner, obs)) == 2 and versions(owner, vault) == []
    key3 = idempotency_key()
    md = login_as(outage_url("APP_MINIO_DOWN_URL"), owner.email, owner.password)
    err(freeze(md, obs, "Pass D", key3), 503, "storage_unavailable")
    assert ok(freeze(owner, obs, "Pass D", key3), 201)["version"]["number"] == 3


def test_version_numbering(app_url: str) -> None:
    owner = signup(app_url)
    peer = login_as(outage_url("APP_PEER_URL"), owner.email, owner.password)
    vd = login_as(outage_url("APP_VALKEY_DOWN_URL"), owner.email, owner.password)
    rid = rooms_by_name(owner)["Observatory"]["id"]
    callers = [clone(owner), peer.c] * 3
    responses = race([lambda c=c, i=i: c.post(f"/api/rooms/{rid}/versions", json={"label": f"Race {i}"})
                      for i, c in enumerate(callers)])
    assert all(r.status_code == 201 for r in responses), [r.status_code for r in responses]
    assert sorted(r.json()["version"]["number"] for r in responses) == [1, 2, 3, 4, 5, 6]
    first = next(r.json()["version"] for r in responses if r.json()["version"]["number"] == 1)
    pack_before = ok(client(app_url).get(f"/api/pack/{token_of(first['packUrl'])}"))
    seventh = ok(freeze(vd, rid, "Offline"), 201)["version"]
    assert seventh["number"] == 7
    listed = versions(owner, rid)
    assert [v["number"] for v in listed] == [7, 6, 5, 4, 3, 2, 1]
    assert [v["state"] for v in listed] == ["frozen"] + ["superseded"] * 6
    assert listed[0]["supersededBy"] is None
    for v in listed[1:]:
        assert v["supersededBy"] == v["number"] + 1
    latest = ok(client(app_url).get(f"/api/pack/{token_of(seventh['packUrl'])}"))
    add_placement(owner, rid, "Late crate")
    assert ok(client(app_url).get(f"/api/pack/{token_of(seventh['packUrl'])}")) == latest, "frozen contents never change"
    old = ok(client(app_url).get(f"/api/pack/{token_of(first['packUrl'])}"))
    assert old["version"]["state"] == "superseded" and old["version"]["supersededBy"] == 2
    assert old["placements"] == pack_before["placements"] and old["nodes"] == pack_before["nodes"]


def test_version_events_reach_both_instances(app_url: str) -> None:
    owner = signup(app_url)
    peer = login_as(outage_url("APP_PEER_URL"), owner.email, owner.password)
    rid = rooms_by_name(owner)["Vault"]["id"]
    v1 = ok(freeze(owner, rid, "One"), 201)["version"]
    with Stream(app_url, f"/api/rooms/{rid}/events", owner.c.cookies) as here, \
            Stream(peer.base, f"/api/rooms/{rid}/events", peer.c.cookies) as there:
        def expect_versions(action: Callable[[], Any], preds: list[Callable[[dict], bool]], what: str) -> None:
            marks = (here.mark(), there.mark())
            action()
            done = time.monotonic()
            for stream, since in zip((here, there), marks):
                for pred in preds:
                    _, _, at = stream.wait(lambda e, d, p=pred: e == "version" and isinstance(d, dict) and p(d.get("version", {})),
                                           what, since)
                    assert at - done <= LIVE_S, f"{what} took {at - done:.2f}s"

        holder: dict = {}
        expect_versions(lambda: holder.update(ok(freeze(owner, rid, "Two"), 201)["version"]),
                        [lambda v: v.get("number") == 2 and v.get("state") == "frozen",
                         lambda v: v.get("id") == v1["id"] and v.get("state") == "superseded" and v.get("supersededBy") == 2],
                        "freeze events")
        old = holder["packUrl"]
        expect_versions(lambda: ok(owner.c.post(f"/api/versions/{holder['id']}/link"), 201),
                        [lambda v: v.get("id") == holder["id"] and v.get("packUrl") not in (None, old)], "regenerate event")
        expect_versions(lambda: owner.c.delete(f"/api/versions/{holder['id']}/link"),
                        [lambda v: v.get("id") == holder["id"] and v.get("packUrl") is None], "revoke event")


def test_wf_freeze_version_live_sheet(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Hold {mara.tag}")
    v1 = ok(freeze(mara, room["id"], "Draft"), 201)["version"]
    with member_page(browser, tobi) as page:
        open_room(page, room["name"])
        click(page.get_by_role("button", name="Session menu"))
        click(page.get_by_role("menuitem", name="Versions"))
        sheet = page.get_by_role("dialog", name="Versions")
        cards = sheet.get_by_role("list", name="Version cards").get_by_role("listitem")
        shows(page, cards.first, "v1 card", contains="Frozen")
        expect(sheet.get_by_role("button", name="Regenerate link")).to_have_count(0)
        old_card = cards.first.element_handle()
        copy = cards.first.get_by_role("button", name="Copy build pack link")
        copy.focus()
        focused = page.evaluate_handle("() => document.activeElement")
        page.evaluate("() => { window.__kbMarker = 1; }")
        v2 = ok(freeze(mara, room["id"], "Carpenter pass 1"), 201)["version"]
        limit = LIVE_S + LIVE_UI_SLACK_S
        shows(page, cards.first, "new card on top", contains=re.compile(r"^\s*Version 2"), seconds=limit)
        eventually(page, lambda: require("Superseded" in old_card.inner_text(), "old card flips"), "old card Superseded", limit)
        assert old_card.evaluate("el => el.isConnected"), "the sheet updated in place"
        assert page.evaluate("f => document.activeElement === f", focused), "focus stayed put"
        assert page.evaluate("() => window.__kbMarker") == 1, "no reload"
        assert "Version 2 frozen." not in (editor_status(page).text_content() or "")
        assert mara.c.delete(f"/api/versions/{v2['id']}/link").status_code == 204
        eventually(page, lambda: expect(cards.first.get_by_role("button", name="Copy build pack link")).to_be_disabled(timeout=QUICK_MS),
                   "revoke disables Copy", limit)
        ok(mara.c.post(f"/api/versions/{v2['id']}/link"), 201)
        eventually(page, lambda: expect(cards.first.get_by_role("button", name="Copy build pack link")).to_be_enabled(timeout=QUICK_MS),
                   "regenerate enables Copy", limit)
    assert v1["number"] == 1


def test_wf_freeze_version_phone_sheet(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    vault = rooms_by_name(owner)["Vault"]
    with member_page(browser, owner) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        open_room(page, "Vault")
        bar = tab_bar(page)
        click(page.get_by_role("button", name="Session menu"))
        click(page.get_by_role("menuitem", name="Versions"))
        sheet = page.get_by_role("dialog", name="Versions")
        shows(page, sheet, "the Versions sheet opens")
        advance(page, DOLLY_MAX_MS)
        phone_sheet(sheet, bar, "the Versions sheet")
        fill(sheet.get_by_role("textbox", name="Version label"), PHONE_LABEL)
        button = sheet.get_by_role("button", name="Freeze version")
        button.evaluate("e => e.scrollIntoView({block: 'nearest', behavior: 'instant'})")
        above_bar(button, bar, "the Freeze version button")
        click(button)
        shows(page, editor_status(page), "the freeze is announced", exact="Version 1 frozen.")
        card = sheet.get_by_role("list", name="Version cards").get_by_role("listitem").first
        shows(page, card, "the new card is on top", contains="Frozen")
        focused(page, card.get_by_role("button", name="Copy build pack link"),
                "a freeze from the sheet puts focus on the new card's Copy build pack link")
    version = versions(owner, vault["id"])[0]
    assert version["number"] == 1 and version["label"] == PHONE_LABEL
    assert f"versions/{version['id']}/snapshot.json" in s3.keys(f"versions/{version['id']}/")


def test_build_pack_links(app_url: str) -> None:
    owner = signup(app_url)
    tobi = login(app_url, TOBI)
    ship, prop, data = placed_ship(owner)
    v1 = ok(freeze(owner, ship["id"], "One"), 201)["version"]
    v2 = ok(freeze(owner, ship["id"], "Two"), 201)["version"]
    anon = client(app_url)
    t1, t2 = token_of(v1["packUrl"]), token_of(v2["packUrl"])
    assert ok(anon.get(f"/api/pack/{t1}"))["version"]["number"] == 1
    assert ok(anon.get(f"/api/pack/{t2}"))["version"]["number"] == 2
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        err(anon.request(method, f"/api/pack/{t2}", json={}), 405, "read_only")
        err(anon.request(method, f"/api/pack/{t2}/props/{prop['id']}", json={}), 405, "read_only")
    other = ok(upload(owner.c, f"Elsewhere {owner.tag}", glb()), 201)["prop"]
    err(anon.get(f"/api/pack/{t2}/props/{other['id']}"), 404, "not_found")
    err(anon.get(f"/api/rooms/{ship['id']}", params={"token": t2}), 401, "unauthenticated")
    mara = login(app_url, MARA)
    lantern = make_room(mara, f"Links {mara.tag}")
    lv = ok(freeze(mara, lantern["id"], "One"), 201)["version"]
    err(tobi.c.post(f"/api/versions/{lv['id']}/link"), 403, "forbidden")
    new = ok(owner.c.post(f"/api/versions/{v2['id']}/link"), 201)["packUrl"]
    etag = anon.get(f"/api/pack/{token_of(new)}/props/{prop['id']}").headers["etag"]
    err(anon.get(f"/api/pack/{t2}"), 404, "not_found")
    err(anon.get(f"/api/pack/{t2}/props/{prop['id']}", headers={"If-None-Match": etag}), 404, "not_found")
    assert anon.get(f"/api/pack/{token_of(new)}/props/{prop['id']}").content == data
    assert owner.c.delete(f"/api/versions/{v1['id']}/link").status_code == 204
    err(anon.get(f"/api/pack/{t1}"), 404, "not_found")
    assert next(v for v in versions(owner, ship["id"]) if v["id"] == v1["id"])["packUrl"] is None


def test_wf_build_pack_superseded_and_revoked(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vault = rooms_by_name(owner)["Vault"]
    v1 = ok(freeze(owner, vault["id"], "One"), 201)["version"]
    v2 = ok(freeze(owner, vault["id"], "Two"), 201)["version"]
    with opened(browser, f"{app_url}/pack/{token_of(v1['packUrl'])}") as fab:
        shows(fab, fab.get_by_text("This version has been superseded by version 2.", exact=True), "superseded notice")
        expect(fab.get_by_text("Superseded", exact=True).first).to_be_visible()
        with member_page(browser, owner) as page:
            open_room(page, "Vault")
            click(page.get_by_role("button", name="Session menu"))
            click(page.get_by_role("menuitem", name="Versions"))
            cards = page.get_by_role("dialog", name="Versions").get_by_role("list", name="Version cards").get_by_role("listitem")
            click(cards.nth(0).get_by_role("button", name="Regenerate link"))
            shows(page, editor_status(page), "regenerate copy", exact="New link made. The old link no longer works.")
            click(cards.nth(1).get_by_role("button", name="Revoke link"))
            shows(page, editor_status(page), "revoke copy", exact="Link revoked.")
            eventually(page, lambda: expect(cards.nth(1).get_by_role("button", name="Copy build pack link")).to_be_disabled(timeout=QUICK_MS),
                       "Copy disabled after revoke")
        fab.reload()
        shows(fab, fab.get_by_text("This link isn't valid.", exact=True), "revoked pack copy")
        fab.goto(v2["packUrl"].replace(urllib.parse.urlsplit(v2["packUrl"]).netloc, urllib.parse.urlsplit(app_url).netloc))
        shows(fab, fab.get_by_text("This link isn't valid.", exact=True), "regenerated-away copy")
    current = versions(owner, vault["id"])
    assert current[0]["packUrl"] not in (None, v2["packUrl"])
    ok(client(app_url).get(f"/api/pack/{token_of(current[0]['packUrl'])}"))


def test_prop_files_byte_for_byte(app_url: str) -> None:
    owner = signup(app_url)
    s3 = S3()
    ship, prop, data = placed_ship(owner)
    anon = client(app_url)

    def check_headers(response: httpx.Response, body: bytes, name: str, ext: str, ctype: str) -> None:
        assert response.status_code == 200 and response.content == body
        assert response.headers["etag"] == f"\"{hashlib.sha256(body).hexdigest()}\""
        assert response.headers["content-type"].startswith(ctype)
        assert int(response.headers["content-length"]) == len(body)
        assert response.headers["content-disposition"] == disposition(name, ext)

    lib = owner.c.get(f"/api/props/{prop['id']}/file")
    check_headers(lib, data, "Coffre à secrets", "glb", "model/gltf-binary")
    assert lib.headers["content-disposition"] == \
        "attachment; filename=\"Coffre _ secrets.glb\"; filename*=UTF-8''Coffre%20%C3%A0%20secrets.glb"
    not_modified = owner.c.get(f"/api/props/{prop['id']}/file", headers={"If-None-Match": lib.headers["etag"]})
    assert not_modified.status_code == 304 and not_modified.content == b"" and not_modified.headers["etag"] == lib.headers["etag"]
    odd = "Crate \"7\" \\ ✓"
    gltf = gltf_json()
    odd_prop = ok(upload(owner.c, odd, gltf, filename="crate.gltf", content_type="model/gltf+json"), 201)["prop"]
    check_headers(owner.c.get(f"/api/props/{odd_prop['id']}/file"), gltf, odd, "gltf", "model/gltf+json")
    version = ok(freeze(owner, ship["id"], "Carpenter pass 1"), 201)["version"]
    token = token_of(version["packUrl"])
    pack = ok(anon.get(f"/api/pack/{token}"))
    entry = next(p for p in pack["props"] if p["id"] == prop["id"])
    assert entry["bytes"] == len(data) and entry["sha256"] == hashlib.sha256(data).hexdigest()
    assert entry["downloadPath"] == f"/api/pack/{token}/props/{prop['id']}"
    placement = next(p for p in room_detail(owner, ship["id"])["placements"] if p["propId"] == prop["id"])
    assert owner.c.delete(f"/api/rooms/{ship['id']}/placements/{placement['id']}").status_code == 204
    assert owner.c.delete(f"/api/props/{prop['id']}").status_code == 204
    copy = anon.get(entry["downloadPath"])
    check_headers(copy, data, "Coffre à secrets", "glb", "model/gltf-binary")
    assert anon.get(entry["downloadPath"], headers={"If-None-Match": copy.headers["etag"]}).status_code == 304
    assert s3.get(f"versions/{version['id']}/props/{prop['id']}.glb") == data


def test_length_conversion(app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Lengths {owner.tag}", 5000, 4000, 3658)
    examples = {10: "0' 0 3/8\"", 304: "0' 11 15/16\"", 305: "1' 0\"", 2400: "7' 10 1/2\"", 3000: "9' 10 1/8\"",
                3658: "12' 0\"", 4000: "13' 1 1/2\"", 5000: "16' 4 7/8\""}
    probes = [11, 127, 159, 1588, 2539, 3175, 4763, 4999]
    for mm in list(examples) + probes:
        add_placement(owner, room["id"], f"W{mm}", xMm=0, zMm=0, widthMm=mm, depthMm=SIZE_MIN_MM, heightMm=SIZE_MIN_MM)
    version = ok(freeze(owner, room["id"], "Sizes"), 201)["version"]
    pack = ok(client(app_url).get(f"/api/pack/{token_of(version['packUrl'])}"))
    assert pack["room"]["width"] == {"mm": 5000, "m": "5.000", "ft": "16' 4 7/8\""}
    assert pack["room"]["height"] == {"mm": 3658, "m": "3.658", "ft": "12' 0\""}
    for placement in pack["placements"]:
        mm = int(placement["label"][1:])
        assert placement["width"] == {"mm": mm, "m": metres(mm), "ft": examples.get(mm, feet(mm))}
        assert placement["x"] == {"mm": 0, "m": "0.000", "ft": "0' 0\""}
        assert isinstance(placement["rotationDeg"], int)
    for mm, ft in examples.items():
        assert feet(mm) == ft


def test_inspector_matches_pack(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Inspect {owner.tag}", 5000, 4000, 3000)
    add_placement(owner, room["id"], "Plank", xMm=2400, zMm=304, widthMm=3000, depthMm=305, heightMm=10)
    version = ok(freeze(owner, room["id"], "Inspect"), 201)["version"]
    plank = ok(client(app_url).get(f"/api/pack/{token_of(version['packUrl'])}"))["placements"][0]
    with member_page(browser, owner) as page:
        open_room(page, room["name"])
        stage(page).focus()
        page.keyboard.press("]")
        inspector = page.get_by_role("region", name="Inspector")
        shows(page, inspector, "Inspector shows", contains="Plank")
        for field in ("x", "z", "width", "depth", "height"):
            expect(inspector).to_contain_text(plank[field]["m"])
        units = page.get_by_role("button", name="Units", exact=True)
        click(units)
        eventually(page, lambda: expect(units).to_have_attribute("aria-pressed", "true", timeout=QUICK_MS), "feet shown")
        for field in ("x", "z", "width", "depth", "height"):
            shows(page, inspector, f"{field} in feet", contains=plank[field]["ft"])


def test_wf_build_pack_fabricator_phone(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    ship, prop, data = placed_ship(owner)
    version = ok(freeze(owner, ship["id"], "Carpenter pass 1"), 201)["version"]
    token = token_of(version["packUrl"])
    with opened(browser, f"{app_url}/pack/{token}?units=ft") as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        heading = page.get_by_role("heading", name="Build pack — Ship's Hold v1", level=1)
        shows(page, heading, "pack heading")
        room_table = page.get_by_role("region", name="Room table").get_by_role("table", name="Room")
        expect(room_table.get_by_role("cell", name="16' 4 7/8\"", exact=True).first).to_be_visible()
        expect(room_table.get_by_role("columnheader").first).to_contain_text("(ft)")
        units = page.get_by_role("button", name="Units", exact=True)
        expect(units).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_text("Frozen", exact=True).first).to_be_visible()
        layout(page)
        placements = page.get_by_role("region", name="Placements table")
        assert placements.evaluate("el => el.scrollWidth > el.clientWidth"), "Placements scrolls inside its region"
        placements.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: require(placements.evaluate("el => el.scrollLeft") > 0, "scrolled"), "arrow keys scroll the region")
        layout(page)
        reached = set()
        region_handles = {n: page.get_by_role("region", name=n).element_handle()
                          for n in ("Room table", "Placements table", "Trigger wiring table", "Files table")}
        page.get_by_role("button", name="Units", exact=True).focus()
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            for region_name, handle in region_handles.items():
                if page.evaluate("r => document.activeElement === r", handle):
                    reached.add(region_name)
        assert set(region_handles) <= reached, f"Tab reached only {reached}"
        link = page.get_by_role("link", name=f"Download {SEA_CHEST}")
        box = link.bounding_box()
        assert box["width"] >= HIT_PX and box["height"] >= HIT_PX
        top = units.bounding_box()["y"]
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, STEP_MS)
        assert abs(units.bounding_box()["y"] - top) <= 1, "the top bar stays pinned"
        with page.expect_download() as download:
            click(link)
        saved = download.value
        assert Path(saved.path()).read_bytes() == data
        assert saved.suggested_filename in ("Coffre à secrets.glb", "Coffre _ secrets.glb")
    with opened(browser, f"{app_url}/pack/{token}?units=m") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        page.reload()
        shows(page, page.get_by_role("heading", name="Build pack — Ship's Hold v1", level=1), "desktop pack")
        for name in ("Room table", "Placements table", "Trigger wiring table", "Files table"):
            region = page.get_by_role("region", name=name)
            b = region.bounding_box()
            assert b["x"] >= (DESKTOP[0] - PACK_COLUMN_MAX_PX) / 2 - 1 and b["x"] + b["width"] <= (DESKTOP[0] + PACK_COLUMN_MAX_PX) / 2 + 1
            assert region.evaluate("el => el.scrollWidth <= el.clientWidth"), f"{name} needs no sideways scroll"


def test_wf_build_pack_units_in_address(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    ship = rooms_by_name(owner)["Ship's Hold"]
    token = token_of(ok(freeze(owner, ship["id"], "Units"), 201)["version"]["packUrl"])
    pack = f"{app_url}/pack/{token}"

    def units_in(page: Page) -> list[str] | None:
        return urllib.parse.parse_qs(urllib.parse.urlsplit(page.url).query).get("units")

    with opened(browser, app_url + "/signin") as page:
        page.goto(pack + "?units=yards")
        eventually(page, lambda: require(units_in(page) == ["m"], "units=m"), "unknown units rewrite to m")
        table = page.get_by_role("table", name="Room")
        expect(table.get_by_role("cell", name="5.000", exact=True).first).to_be_visible()
        expect(table.get_by_role("columnheader").first).to_contain_text("(m)")
        length = page.evaluate("() => history.length")
        click(page.get_by_role("button", name="Units", exact=True))
        eventually(page, lambda: require(units_in(page) == ["ft"], "units=ft"), "Units rewrites the address")
        expect(table.get_by_role("cell", name="16' 4 7/8\"", exact=True).first).to_be_visible()
        expect(page.get_by_role("button", name="Units", exact=True)).to_have_attribute("aria-pressed", "true")
        assert page.evaluate("() => history.length") == length, "no history entry added"
        page.reload()
        expect(page.get_by_role("table", name="Room").get_by_role("cell", name="16' 4 7/8\"", exact=True).first).to_be_visible()
        page.go_back()
        eventually(page, lambda: require(urllib.parse.urlsplit(page.url).path == "/signin", "back"), "Back leaves the pack in one step")
        page.goto(pack)
        eventually(page, lambda: require(units_in(page) == ["m"], "units=m"), "missing units normalise to m")
    with opened(browser, pack + "?units=ft") as forwarded:
        expect(forwarded.get_by_role("table", name="Room").get_by_role("cell", name="16' 4 7/8\"", exact=True).first).to_be_visible()
    anon = client(app_url)
    assert ok(anon.get(f"/api/pack/{token}", params={"units": "ft"})) == ok(anon.get(f"/api/pack/{token}"))


def offline(page: Page, attempts: list[dict]) -> Callable[[Any], None]:
    def drop(route: Any) -> None:
        request = route.request
        attempts.append({"method": request.method, "url": request.url, "op": request.headers.get("op-id"),
                         "body": request.post_data})
        route.abort("internetdisconnected")

    page.route(SAVE_GLOB, drop)
    return drop


def test_wf_offline_replay_reload_and_replay(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Offline {mara.tag}")
    rid = room["id"]
    chest = add_placement(mara, rid, CHEST, xMm=START_X_MM, zMm=1000)
    crate = add_placement(mara, rid, CRATE, xMm=2000, zMm=2000)
    start = revision(mara, rid)
    attempts: list[dict] = []
    with member_page(browser, mara) as page:
        open_room(page, room["name"])
        drop = offline(page, attempts)
        stage(page).focus()
        page.keyboard.press("r")
        page.keyboard.press("]")
        page.keyboard.press("]")
        shows(page, inspector(page), "] twice selects the Crate", contains=CRATE)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("g")
        page.keyboard.press("[")
        shows(page, inspector(page), "[ selects the Chest again", contains=CHEST)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        shows(page, connection(page), "three changes wait", exact="Offline. 3 changes waiting to save.")
        page.reload()
        open_room(page, room["name"])
        shows(page, connection(page), "the queue survives the reload", exact="Offline. 3 changes waiting to save.")
        has_attr(page, scene_item(page, CHEST), "data-x-mm", START_X_MM + 2 * NUDGE_MM, "both nudges stay drawn after the reload")
        has_attr(page, scene_item(page, CRATE), "data-rotation-deg", ROTATE_STEP, "the rotation stays drawn after the reload")
        mara.c.delete(f"/api/rooms/{rid}/locks/placement/{crate['id']}")
        assert tobi.c.delete(f"/api/rooms/{rid}/placements/{crate['id']}").status_code == 204
        page.unroute(SAVE_GLOB, drop)
        advance(page, RETRY_MS)
        shows(page, connection(page), "the queue empties after reconnecting", exact="All changes saved.")
        shows(page, editor_status(page), "the dropped rotation is announced",
              exact=f"{CRATE} was deleted by {TOBI[2]}. Your change was not saved.")
        has_attr(page, scene_item(page, CHEST), "data-x-mm", START_X_MM + 2 * NUDGE_MM, "the saved nudges stay drawn")
    assert placement_now(mara, rid, chest["id"])["xMm"] == START_X_MM + 2 * NUDGE_MM
    assert revision(mara, rid) == start + 3, "the delete and the two nudges each add one revision"
    mine = [c for c in changes(mara, rid, start) if c["userId"] == mara.user["id"]]
    assert [c["placementId"] for c in mine] == [chest["id"], chest["id"]], "only the two nudges were accepted"
    assert [c["revision"] for c in mine] == [start + 2, start + 3]
    assert all(c["opId"] for c in mine) and mine[0]["opId"] != mine[1]["opId"]
    crate_ops = {a["op"] for a in attempts if crate["id"] in a["url"]}
    assert len(crate_ops) == 1 and None not in crate_ops, f"every send of the rotation reused one Op-Id: {crate_ops}"


def test_wf_offline_replay_two_nudges(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Nudges {owner.tag}")
    rid = room["id"]
    chest = add_placement(owner, rid, CHEST, xMm=START_X_MM, zMm=1000)
    start = revision(owner, rid)
    attempts: list[dict] = []
    with member_page(browser, owner) as page:
        open_room(page, room["name"])
        drop = offline(page, attempts)
        stage(page).focus()
        page.keyboard.press("g")
        page.keyboard.press("]")
        shows(page, inspector(page), "] selects the Chest", contains=CHEST)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        shows(page, connection(page), "two changes wait", exact="Offline. 2 changes waiting to save.")
        has_attr(page, scene_item(page, CHEST), "data-x-mm", START_X_MM + 2 * NUDGE_MM, "queued nudges are drawn")
        advance(page, RETRY_MS)
        eventually(page, lambda: require(len(attempts) >= 2, "a retry"), "the front change is retried while offline")
        page.unroute(SAVE_GLOB, drop)
        advance(page, RETRY_MS)
        shows(page, connection(page), "both nudges saved", exact="All changes saved.")
        assert (editor_status(page).text_content() or "").strip() != \
            "Someone saved a newer change. Your view has been refreshed.", "the second nudge is not a false conflict"
    saved = placement_now(owner, rid, chest["id"])
    assert saved["xMm"] == START_X_MM + 2 * NUDGE_MM and saved["version"] == chest["version"] + 2
    log = changes(owner, rid, start)
    assert [c["revision"] for c in log] == [start + 1, start + 2] and revision(owner, rid) == start + 2
    first_ops = {a["op"] for a in attempts}
    assert len(first_ops) == 1 and log[0]["opId"] in first_ops, f"retries reuse the first Op-Id: {first_ops}"
    assert len({a["body"] for a in attempts}) == 1, "retries resend the same body"
    assert log[1]["opId"] and log[1]["opId"] != log[0]["opId"]


def test_room_revisions_and_change_log(app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Revisions {mara.tag}")
    rid = room["id"]
    assert room["revision"] == 0
    crate = add_placement(mara, rid, CRATE)
    chest = add_placement(mara, rid, CHEST)
    add_node(mara, rid, "Clue")
    assert revision(mara, rid) == 3
    path = f"/api/rooms/{rid}/placements/{crate['id']}"
    invalid(mara.c.patch(path, json={"version": crate["version"], "xMm": -1}), "xMm")
    invalid(mara.c.patch(path, json={"version": crate["version"], "xMm": 1100}, headers={"Op-Id": BAD_OP_ID}), "opId")
    ok(mara.c.post(f"/api/rooms/{rid}/locks", json={"targetType": "placement", "targetId": chest["id"]}))
    assert mara.c.delete(f"/api/rooms/{rid}/locks/placement/{chest['id']}").status_code == 204
    assert revision(mara, rid) == 3, "refused requests and locks change no revision"
    op = op_id()
    first = mara.c.patch(path, json={"version": crate["version"], "xMm": 1100}, headers={"Op-Id": op})
    body = ok(first)
    again = mara.c.patch(path, json={"version": crate["version"], "xMm": 1100}, headers={"Op-Id": op})
    assert again.status_code == 200 and again.json() == body, "a replay answers the stored response"
    err(mara.c.patch(f"/api/rooms/{rid}/placements/{chest['id']}", json={"version": chest["version"], "xMm": 1200},
                     headers={"Op-Id": op}), 409, "op_id_reused")
    assert revision(mara, rid) == 4 and placement_now(mara, rid, chest["id"])["xMm"] == chest["xMm"]
    log = changes(tobi, rid, 0)
    assert [c["revision"] for c in log] == [1, 2, 3, 4]
    assert [c["kind"] for c in log] == ["create", "create", "create", "update"]
    assert [c["placementId"] for c in log] == [crate["id"], chest["id"], None, crate["id"]]
    assert log[3]["opId"] == op and log[0]["opId"] is None and log[3]["userId"] == mara.user["id"]
    assert ok(mara.c.get(f"/api/rooms/{rid}/changes", params={"since": 3}))["changes"] == log[3:]
    assert tobi.c.delete(path).status_code == 204
    for response in (mara.c.patch(path, json={"version": body["placement"]["version"], "xMm": 900}), mara.c.delete(path)):
        gone_body = err(response, 410, "placement_deleted")
        assert gone_body["label"] == CRATE
        assert gone_body["deletedBy"] == {"userId": tobi.user["id"], "displayName": TOBI[2]}
    err(mara.c.patch(f"/api/rooms/{rid}/placements/{UNKNOWN_ID}", json={"version": 1, "xMm": 900}), 404, "not_found")
    assert revision(mara, rid) == 5 and changes(mara, rid, 4)[0]["kind"] == "delete"


def test_wf_lock_takeover_undo_takeover(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Takeover {mara.tag}")
    rid = room["id"]
    chest = add_placement(mara, rid, CHEST, xMm=START_X_MM, zMm=1000)
    with member_page(browser, tobi) as holder, member_page(browser, mara) as taker:
        open_room(holder, room["name"])
        open_room(taker, room["name"])
        stage(holder).focus()
        holder.keyboard.press("]")
        shows(holder, inspector(holder), "the holder selects the Chest", contains=CHEST)
        holder_field = inspector(holder).get_by_role("spinbutton", name="Rotation")
        fill(holder_field, str(HOLDER_ROTATION))
        holder_field.press("Enter")
        api_until(holder, lambda: placement_now(mara, rid, chest["id"]), lambda x: x["rotationDeg"] == HOLDER_ROTATION,
                  "the holder's rotation saves")
        item = scene_item(taker, CHEST)
        eventually(taker, lambda: expect(item).to_have_accessible_description(f"Locked by {TOBI[2]}", timeout=QUICK_MS),
                   "the Scene item names the holder")
        click(item)
        shows(taker, editor_status(taker), "selecting a held placement shows the holder copy",
              exact=f"{TOBI[2]} is holding this prop.")
        field = inspector(taker).get_by_role("spinbutton", name="Rotation")
        fill(field, str(TAKER_ROTATION))
        field.press("Enter")
        dialog = taker.get_by_role("dialog", name="Prop locked")
        shows(taker, dialog, "committing opens Prop locked", contains=f"{TOBI[2]} is editing {CHEST}.")
        focused(taker, dialog.get_by_role("button", name="Cancel"), "Prop locked opens with focus on Cancel")
        taker.keyboard.press("Escape")
        wait_gone(taker, dialog, "Escape closes Prop locked")
        eventually(taker, lambda: expect(field).to_have_value(str(HOLDER_ROTATION), timeout=QUICK_MS),
                   "Escape puts the saved value back")
        focused(taker, field, "Escape returns focus to the Rotation field")
        assert placement_now(mara, rid, chest["id"])["rotationDeg"] == HOLDER_ROTATION, "the cancelled value saved nothing"
        fill(field, str(TAKER_ROTATION))
        field.press("Enter")
        shows(taker, dialog, "Prop locked opens again")
        taker.keyboard.press("Tab")
        focused(taker, dialog.get_by_role("button", name="Take over"), "Tab moves from Cancel to Take over")
        taker.keyboard.press("Enter")
        shows(taker, editor_status(taker), "the taker copy", exact=f"You now hold {CHEST}.")
        shows(holder, editor_status(holder), "the former holder is told", exact=f"{MARA[2]} took over {CHEST}.")
        api_until(taker, lambda: placement_now(mara, rid, chest["id"]), lambda x: x["rotationDeg"] == TAKER_ROTATION,
                  "Take over saves the committed value")
        has_attr(holder, scene_item(holder, CHEST), "data-rotation-deg", TAKER_ROTATION, "the former holder draws the new value")
        held_by = err(tobi.c.post(f"/api/rooms/{rid}/locks", json={"targetType": "placement", "targetId": chest["id"]}),
                      409, "locked")
        assert held_by["holder"]["userId"] == mara.user["id"], "the lock moved to the taker"


def test_wf_lock_takeover_undo_per_author(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Undo {mara.tag}")
    rid = room["id"]
    chest = add_placement(mara, rid, CHEST, xMm=START_X_MM, zMm=1000)
    crate = add_placement(mara, rid, CRATE, xMm=2000, zMm=2000)
    with member_page(browser, mara) as page:
        open_room(page, room["name"])
        stage(page).focus()
        page.keyboard.press("r")
        page.keyboard.press("]")
        shows(page, inspector(page), "] selects the Chest", contains=CHEST)
        page.keyboard.press("ArrowRight")
        api_until(page, lambda: placement_now(mara, rid, chest["id"]), lambda x: x["rotationDeg"] == ROTATE_STEP, "Chest turns")
        page.keyboard.press("]")
        shows(page, inspector(page), "] selects the Crate", contains=CRATE)
        page.keyboard.press("ArrowRight")
        api_until(page, lambda: placement_now(mara, rid, crate["id"]), lambda x: x["rotationDeg"] == ROTATE_STEP, "Crate turns")
        page.keyboard.press("Escape")
        for target in (chest, crate):
            mara.c.delete(f"/api/rooms/{rid}/locks/placement/{target['id']}")
        patch_now(tobi, rid, chest["id"], xMm=START_X_MM + NUDGE_SHIFT_MM)
        assert tobi.c.delete(f"/api/rooms/{rid}/placements/{crate['id']}").status_code == 204
        stage(page).focus()
        page.keyboard.press("Control+z")
        shows(page, editor_status(page), "undo of a deleted placement's change is refused",
              exact=f"Can't undo: {CRATE} was deleted by {TOBI[2]}.")
        page.keyboard.press("Control+z")
        shows(page, editor_status(page), "the next undo reverts the member's own Chest rotation",
              exact=f"Undid your rotation change on {CHEST}.")
        has_attr(page, scene_item(page, CHEST), "data-rotation-deg", 0, "the Scene item draws the undone rotation")
        page.keyboard.press("Control+z")
        shows(page, editor_status(page), "nothing left to undo", exact="Nothing to undo.")
    now = placement_now(mara, rid, chest["id"])
    assert now["rotationDeg"] == 0 and now["xMm"] == START_X_MM + NUDGE_SHIFT_MM, "the co-designer's move is kept"
    assert err(mara.c.post(f"/api/rooms/{rid}/undo"), 409, "nothing_to_undo")


def test_undo_and_takeover_api(app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi, tobi_peer = login(app_url, MARA), login(app_url, TOBI), login(peer, TOBI)
    room = make_room(mara, f"Undo api {mara.tag}")
    rid = room["id"]
    chest = add_placement(mara, rid, CHEST, xMm=1000)
    crate = add_placement(mara, rid, CRATE, xMm=2000)
    patch_now(mara, rid, chest["id"], rotationDeg=ROTATE_STEP)
    patch_now(mara, rid, chest["id"], xMm=1100)
    patch_now(tobi, rid, chest["id"], label=RENAMED_CLUE)
    start = revision(mara, rid)
    first = ok(mara.c.post(f"/api/rooms/{rid}/undo"))
    assert first["undone"]["placementId"] == chest["id"] and first["undone"]["field"] == "position"
    assert (first["placement"]["xMm"], first["placement"]["rotationDeg"], first["placement"]["label"]) == (1000, ROTATE_STEP, RENAMED_CLUE)
    assert first["revision"] == start + 1
    second = ok(mara.c.post(f"/api/rooms/{rid}/undo"))
    assert second["undone"]["field"] == "rotation" and second["placement"]["rotationDeg"] == 0
    assert second["placement"]["label"] == RENAMED_CLUE, "another member's change is never undone"
    err(mara.c.post(f"/api/rooms/{rid}/undo"), 409, "nothing_to_undo")
    assert ok(tobi.c.post(f"/api/rooms/{rid}/undo"))["undone"]["field"] == "label"
    assert [c["kind"] for c in changes(mara, rid, start)] == ["undo", "undo", "undo"]
    patch_now(mara, rid, chest["id"], widthMm=600)
    patch_now(mara, rid, crate["id"], heightMm=600)
    assert tobi.c.delete(f"/api/rooms/{rid}/placements/{crate['id']}").status_code == 204
    conflict = err(mara.c.post(f"/api/rooms/{rid}/undo"), 409, "undo_conflict")
    assert conflict["label"] == CRATE and conflict["deletedBy"] == {"userId": tobi.user["id"], "displayName": TOBI[2]}
    payload = {"targetType": "placement", "targetId": chest["id"]}
    ok(tobi.c.post(f"/api/rooms/{rid}/locks", json=payload))
    err(mara.c.post(f"/api/rooms/{rid}/undo"), 409, "locked")
    with Stream(peer, f"/api/rooms/{rid}/events", tobi_peer.c.cookies) as stream:
        since = stream.mark()
        taken = ok(mara.c.post(f"/api/rooms/{rid}/locks", json={**payload, "takeOver": True}))["lock"]
        done = time.monotonic()
        assert taken["holder"]["userId"] == mara.user["id"]
        _, data, at = stream.wait(lambda e, d: e == "lock" and isinstance(d, dict)
                                  and (d.get("takenFrom") or {}).get("userId") == tobi.user["id"], "take-over event", since)
        assert data["lock"]["holder"]["userId"] == mara.user["id"] and at - done <= LIVE_S
    assert err(tobi.c.post(f"/api/rooms/{rid}/locks", json=payload), 409, "locked")["holder"]["userId"] == mara.user["id"]
    current = placement_now(mara, rid, chest["id"])
    err(tobi.c.patch(f"/api/rooms/{rid}/placements/{chest['id']}", json={"version": current["version"], "xMm": 900}), 409, "locked")
    assert ok(mara.c.post(f"/api/rooms/{rid}/undo"))["undone"]["field"] == "size", "the locked refusal kept the entry"


def test_wf_hierarchy_camera_physics_camera(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Orbit {owner.tag}")
    add_placement(owner, room["id"], CORNER, xMm=0, zMm=0, widthMm=SIZE_MIN_MM, depthMm=SIZE_MIN_MM, heightMm=SIZE_MIN_MM)

    def cam(page: Page, yaw: int, pitch: int, what: str) -> None:
        region = stage(page)
        eventually(page, lambda: (expect(region).to_have_attribute("data-cam-yaw", str(yaw), timeout=QUICK_MS),
                                  expect(region).to_have_attribute("data-cam-pitch", str(pitch), timeout=QUICK_MS)), what)

    with member_page(browser, owner) as page:
        open_room(page, room["name"])
        region = stage(page)
        cam(page, START_YAW, START_PITCH, "a room opens at yaw 30 and pitch 35")
        region.focus()
        page.keyboard.press("Tab")
        require(not focus_inside(region), "one Tab press leaves the Room stage")
        page.keyboard.press("Shift+Tab")
        focused(page, region, "Shift+Tab lands on the Room stage itself: one Tab stop")
        advance(page, STEP_MS)
        before = camera(page)
        yaw, pitch = START_YAW, START_PITCH
        for key in ("ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowRight"):
            page.keyboard.press(key)
            yaw = (yaw + (CAM_STEP if key == "ArrowRight" else -CAM_STEP)) % 360
            cam(page, yaw, pitch, f"{key} turns yaw to {yaw}")
        for key, count in (("ArrowUp", 4), ("ArrowDown", 7)):
            for _ in range(count):
                page.keyboard.press(key)
                pitch = min(PITCH_MAX, pitch + CAM_STEP) if key == "ArrowUp" else max(PITCH_MIN, pitch - CAM_STEP)
                cam(page, yaw, pitch, f"{key} sets pitch {pitch}")
        advance(page, STEP_MS)
        assert not matrices_equal(before, camera(page)), "the drawn camera follows yaw and pitch"
    with member_page(browser, owner) as phone:
        phone.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        phone.reload()
        open_room(phone, room["name"])
        cam(phone, START_YAW, START_PITCH, "the phone editor starts at the overview pose")
        box = stage(phone).bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        touch_drag(phone, x - DRAG_PX / 2, y, DRAG_PX, 0)
        cam(phone, DRAG_YAW, START_PITCH, "a 120 px drag to the right turns yaw from 30 to 90")
        touch_drag(phone, x, y + DRAG_UP_PX / 2, 0, -DRAG_UP_PX)
        cam(phone, DRAG_YAW, START_PITCH + DRAG_UP_PX // 2, "dragging up raises pitch by 0.5 degree per px")
        assert phone.evaluate("() => [window.scrollX, window.scrollY]") == [0, 0], "a touch drag never scrolls the page"


def test_wf_hierarchy_camera_physics_scene_reorder(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Scene {owner.tag}")
    rid = room["id"]
    ids = [add_placement(owner, rid, label, xMm=1000 + NUDGE_SHIFT_MM * 5 * i)["id"] for i, label in enumerate(SCENE_LABELS)]
    start = revision(owner, rid)
    sent: list[Any] = []
    with member_page(browser, owner) as page:
        open_room(page, room["name"])
        tree = page.get_by_role("tree", name="Scene")
        shows(page, tree, "the Scene tree shows")
        expect(tree.get_by_role("treeitem", name=room["name"], exact=True)).to_have_attribute("aria-level", "1")
        for index, label in enumerate(SCENE_LABELS):
            item = scene_item(page, label)
            expect(item).to_have_attribute("aria-level", "2")
            expect(item).to_have_attribute("aria-posinset", str(index + 1))
            expect(item).to_have_attribute("aria-setsize", str(len(SCENE_LABELS)))
        last = scene_item(page, SCENE_LABELS[-1])
        click(last)
        focused(page, last, "a click on a placement item keeps focus on it")
        shows(page, inspector(page), "the click selects the placement", contains=SCENE_LABELS[-1])
        page.on("request", lambda r: sent.append(r) if r.method == "POST" and r.url.endswith("/scene-move") else None)
        with holding(page, SCENE_MOVE_GLOB) as hold:
            for _ in range(len(SCENE_LABELS) - 1):
                page.keyboard.press("Alt+ArrowUp")
            has_attr(page, last, "aria-posinset", 1, "three presses move the item to the top before any answer")
            expect(scene_item(page, SCENE_LABELS[0])).to_have_attribute("aria-posinset", "2")
            expect(last).to_be_focused()
            shows(page, editor_status(page), "the last move is announced",
                  exact=f"Moved {SCENE_LABELS[-1]} above {SCENE_LABELS[0]}.")
            assert room_detail(owner, rid)["sceneOrder"] == ids, "held moves have not reached the server"
            hold.release()
        expected = [ids[-1]] + ids[:-1]
        api_until(page, lambda: room_detail(owner, rid)["sceneOrder"], lambda order: order == expected,
                  "the three moves reach the server in order")
        eventually(page, lambda: require(len(sent) == len(SCENE_LABELS) - 1, f"{len(sent)} scene moves"), "three scene moves sent")
        page.keyboard.press("Alt+ArrowUp")
        advance(page, RETRY_MS)
        assert len(sent) == len(SCENE_LABELS) - 1, "Alt+ArrowUp on the first item sends nothing"
        assert all(json.loads(r.post_data or "{}").get("direction") == "up" for r in sent)
        expect(last).to_be_focused()
    assert revision(owner, rid) == start + len(SCENE_LABELS) - 1


def test_scene_order_api(app_url: str) -> None:
    owner = signup(app_url)
    ines = login(app_url, INES)
    room = make_room(owner, f"Order {owner.tag}")
    rid = room["id"]
    assert room_detail(owner, rid)["sceneOrder"] == []
    a, b, c = (add_placement(owner, rid, label)["id"] for label in SCENE_LABELS[:3])
    assert room_detail(owner, rid)["sceneOrder"] == [a, b, c]
    start = revision(owner, rid)

    def move_scene(pid: str, direction: str, **headers: str) -> httpx.Response:
        return owner.c.post(f"/api/rooms/{rid}/placements/{pid}/scene-move", json={"direction": direction}, headers=headers)

    op = op_id()
    moved = ok(move_scene(c, "up", **{"Op-Id": op}))
    assert moved["sceneOrder"] == [a, c, b] and moved["revision"] == start + 1
    again = move_scene(c, "up", **{"Op-Id": op})
    assert again.status_code == 200 and again.json() == moved and revision(owner, rid) == start + 1
    invalid(move_scene(a, "up"), "direction", "already first")
    invalid(move_scene(b, "down"), "direction", "already last")
    assert ok(move_scene(a, "down"))["sceneOrder"] == [c, a, b]
    assert [x["kind"] for x in changes(owner, rid, start)] == ["move", "move"]
    assert owner.c.delete(f"/api/rooms/{rid}/placements/{a}").status_code == 204
    assert room_detail(owner, rid)["sceneOrder"] == [c, b]
    err(move_scene(a, "up"), 410, "placement_deleted")
    err(ines.c.post(f"/api/rooms/{rid}/placements/{b}/scene-move", json={"direction": "up"}), 404, "not_found")


def test_wf_hierarchy_camera_physics_drop(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    room = make_room(owner, f"Drop {owner.tag}")
    rid = room["id"]
    box = add_placement(owner, rid, HANGING, yMm=DROP_FROM_MM)
    start = revision(owner, rid)
    with member_page(browser, owner) as page:
        open_room(page, room["name"])
        item = scene_item(page, HANGING)
        has_attr(page, item, "data-y-mm", DROP_FROM_MM, "the Scene item shows the starting height")
        click(item)
        shows(page, inspector(page), "the Scene item selects the box", contains=HANGING)
        stage(page).focus()
        page.keyboard.press("d")
        samples: dict[int, float] = {}
        for _ in range(FALL_WAIT_MS // FALL_SAMPLE_MS):
            advance(page, FALL_SAMPLE_MS)
            steps, height = item.get_attribute("data-sim-steps"), item.get_attribute("data-y-mm")
            if steps is not None and height is not None:
                samples[int(steps)] = float(height)
        falling = {k: y for k, y in samples.items() if 0 < k < DROP_LAND_STEPS}
        require(len(falling) >= 3, f"data-sim-steps and data-y-mm show the fall as it runs, sampled {samples}")
        for k, shown in falling.items():
            exact = fall_height(DROP_FROM_MM, k)
            assert abs(Fraction(shown) - exact) <= Fraction(1, 2), \
                f"after {k} steps data-y-mm is {shown}; the published fall gives {float(exact)}"
        eventually(page, lambda: (expect(item).to_have_attribute("data-sim-steps", str(DROP_LAND_STEPS), timeout=QUICK_MS),
                                  expect(item).to_have_attribute("data-y-mm", "0", timeout=QUICK_MS)),
                   "the box lands at step 59 at height 0")
        landed = api_until(page, lambda: placement_now(owner, rid, box["id"]), lambda x: x["yMm"] == 0, "the landing saves yMm 0")
        advance(page, RETRY_MS)
    assert landed["version"] == box["version"] + 1
    assert [(c["kind"], c["placementId"]) for c in changes(owner, rid, start)] == [("update", box["id"])], \
        "the fall saved exactly once"


def restore_by_palette(page: Page, version_name: str, presses_down: int) -> None:
    stage(page).focus()
    page.keyboard.press("Control+k")
    palette = page.get_by_role("dialog", name="Command palette")
    shows(page, palette, "Ctrl+K opens the Command palette")
    focused(page, palette.get_by_role("combobox", name="Command"), "the palette opens with focus in the Command field")
    options = palette.get_by_role("listbox", name="Commands").get_by_role("option")
    page.keyboard.type("restore")
    eventually(page, lambda: expect(options).to_have_text(["Restore version..."], timeout=QUICK_MS),
               "typing filters the commands, ignoring case")
    expect(options.first).to_have_attribute("aria-selected", "true")
    page.keyboard.press("Enter")
    eventually(page, lambda: expect(palette.get_by_role("combobox", name="Command")).to_have_value("", timeout=QUICK_MS),
               "Restore version... empties the field")
    for _ in range(presses_down):
        page.keyboard.press("ArrowDown")
    target = palette.get_by_role("option", name=version_name, exact=True)
    has_attr(page, target, "aria-selected", "true", f"{version_name} is the active option")
    page.keyboard.press("Enter")
    wait_gone(page, palette, "restoring closes the palette")


def test_wf_outage_restore_palette_restore_live(browser: Browser, app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi = login(app_url, MARA), login(peer, TOBI)
    room = make_room(mara, f"Restore {mara.tag}")
    rid = room["id"]
    crate = add_placement(mara, rid, CRATE, xMm=1000, zMm=1000)
    ok(freeze(mara, rid, BEFORE_LABEL), 201)
    patch_now(mara, rid, crate["id"], xMm=2500)
    ok(freeze(mara, rid, AFTER_LABEL), 201)
    start = revision(mara, rid)
    with member_page(browser, tobi) as watcher, member_page(browser, mara) as page:
        open_room(watcher, room["name"])
        open_room(page, room["name"])
        watched = scene_item(watcher, CRATE)
        has_attr(watcher, watched, "data-x-mm", 2500, "the co-designer sees the moved crate")
        watcher.evaluate("() => { window.__kbMarker = 1; }")
        stage(page).focus()
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        options = palette.get_by_role("listbox", name="Commands").get_by_role("option")
        eventually(page, lambda: expect(options).to_have_text(PALETTE_COMMANDS, timeout=QUICK_MS), "every command is listed")
        expect(options.first).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Escape")
        wait_gone(page, palette, "Escape closes the palette")
        focused(page, stage(page), "Escape returns focus to the Room stage")
        restore_by_palette(page, f"Version 1 — {BEFORE_LABEL}", 1)
        shows(page, editor_status(page), "the restore is announced", exact=f"Restored v1 as change {start + 1}.")
        focused(page, stage(page), "after the restore focus returns to the Room stage")
        has_attr(page, scene_item(page, CRATE), "data-x-mm", 1000, "the owner's editor draws the restored crate")
        has_attr(watcher, watched, "data-x-mm", 1000, "the other instance redraws the restored crate",
                 seconds=LIVE_S + LIVE_UI_SLACK_S)
        assert watcher.evaluate("() => window.__kbMarker") == 1, "the co-designer's page did not reload"
    assert placement_now(mara, rid, crate["id"])["xMm"] == 1000 and revision(mara, rid) == start + 1
    assert [x["kind"] for x in changes(mara, rid, start)] == ["restore"]
    assert len(versions(mara, rid)) == 2, "a restore makes no new version"


def test_wf_outage_restore_palette_valkey_down(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    vd = login_as(outage_url("APP_VALKEY_DOWN_URL"), owner.email, owner.password)
    room = make_room(owner, f"Solo restore {owner.tag}")
    rid = room["id"]
    crate = add_placement(owner, rid, CRATE, xMm=1000, zMm=1000)
    add_node(owner, rid, "Clue")
    ok(freeze(owner, rid, BEFORE_LABEL), 201)
    patch_now(owner, rid, crate["id"], xMm=2000)
    start = revision(owner, rid)
    with member_page(browser, vd) as page:
        open_room(page, room["name"])
        shows(page, page.get_by_role("status", name="Service status"), "the live banner", exact=LIVE_BANNER)
        stage(page).focus()
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        shows(page, palette, "Ctrl+K opens the palette during the outage")
        page.keyboard.type("start")
        start_option = palette.get_by_role("option", name="Start playtest", exact=True)
        has_attr(page, start_option, "aria-disabled", "true", "Start playtest is unavailable while live is down")
        expect(start_option).to_have_accessible_description("Needs the live service.")
        page.keyboard.press("Enter")
        advance(page, DOLLY_MAX_MS)
        expect(palette).to_be_visible()
        assert room_detail(owner, rid)["activeSession"] is None, "Enter on an unavailable command starts nothing"
        page.keyboard.press("Escape")
        wait_gone(page, palette, "Escape closes the palette")
        restore_by_palette(page, f"Version 1 — {BEFORE_LABEL}", 0)
        shows(page, editor_status(page), "the restore is announced", exact=f"Restored v1 as change {start + 1}.")
        has_attr(page, scene_item(page, CRATE), "data-x-mm", 1000, "the editor draws the restored crate")
    assert placement_now(owner, rid, crate["id"])["xMm"] == 1000 and revision(owner, rid) == start + 1
    assert ok(owner.c.get(f"/api/rooms/{rid}/playtests"))["sessions"] == []


def test_version_restore_rules(app_url: str) -> None:
    peer = outage_url("APP_PEER_URL")
    mara, tobi, mara_peer = login(app_url, MARA), login(app_url, TOBI), login(peer, MARA)
    room = make_room(mara, f"Rules {mara.tag}", 4000, 3500, 2700)
    rid = room["id"]
    crate = add_placement(mara, rid, CRATE, xMm=1000)
    chest = add_placement(mara, rid, CHEST, xMm=2000)
    clue = add_node(mara, rid, "Clue")
    ok(mara.c.post(f"/api/rooms/{rid}/placements/{chest['id']}/scene-move", json={"direction": "up"}))
    v1 = ok(freeze(mara, rid, BEFORE_LABEL), 201)["version"]
    patch_now(mara, rid, crate["id"], xMm=1500)
    assert mara.c.delete(f"/api/rooms/{rid}/placements/{chest['id']}").status_code == 204
    add_placement(mara, rid, "Late crate")
    ok(mara.c.patch(f"/api/rooms/{rid}", json={"version": room_detail(mara, rid)["room"]["version"], "widthMm": 5000}))
    other = make_room(mara, f"Other {mara.tag}")
    foreign = ok(freeze(mara, other["id"], AFTER_LABEL), 201)["version"]
    err(tobi.c.post(f"/api/rooms/{rid}/restore", json={"versionId": v1["id"]}), 403, "forbidden")
    invalid(mara.c.post(f"/api/rooms/{rid}/restore", json={"versionId": foreign["id"]}), "versionId", "unknown version")
    start = revision(mara, rid)
    with Stream(peer, f"/api/rooms/{rid}/events", mara_peer.c.cookies) as stream:
        since = stream.mark()
        body = ok(mara.c.post(f"/api/rooms/{rid}/restore", json={"versionId": v1["id"]}))
        done = time.monotonic()
        _, _, at = stream.wait(lambda e, d: e == "restore" and isinstance(d, dict) and d.get("revision") == start + 1,
                               "the restore event reaches the other instance", since)
        assert at - done <= LIVE_S
    assert body["revision"] == start + 1
    now = room_detail(mara, rid)
    assert (now["room"]["name"], now["room"]["widthMm"]) == (room["name"], 4000)
    assert sorted(p["id"] for p in now["placements"]) == sorted([crate["id"], chest["id"]])
    assert (placements_by_label(now)[CRATE]["xMm"], placements_by_label(now)[CHEST]["xMm"]) == (1000, 2000)
    assert now["sceneOrder"] == [chest["id"], crate["id"]]
    assert [n["id"] for n in now["nodes"]] == [clue["id"]]
    assert [x["kind"] for x in changes(mara, rid, start)] == ["restore"] and revision(mara, rid) == start + 1
    assert len(versions(mara, rid)) == 1, "a restore makes no new version"
    err(mara.c.post(f"/api/rooms/{rid}/undo"), 409, "nothing_to_undo")
    session = walk_in(mara, rid)
    err(mara.c.post(f"/api/rooms/{rid}/restore", json={"versionId": v1["id"]}), 409, "playtest_running")
    move(mara, session["id"], "end")


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, f"{package.name} missing from THIRD_PARTY_NOTICES.md"
    for asset in ("Inter", "JetBrains Mono", "Lucide"):
        assert asset in notices


def test_if_licences_allowed() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert bad == []


def test_if_datastores_only() -> None:
    assert Postgres().tables(), "app tables live in Postgres"
    for folder in (Path("/app"), Path(DEPLOYED_APP)):
        found = [p for p in folder.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
                 and "node_modules" not in p.parts]
        assert found == [], f"local database files: {found}"


def test_if_self_hosted_assets(browser: Browser, app_url: str) -> None:
    owner = signup(app_url)
    with member_page(browser, owner) as page:
        requested: list[str] = []
        page.on("request", lambda request: requested.append(request.url))
        for path in ("/app", "/signin"):
            page.goto(app_url + path)
            advance(page, DOLLY_MAX_MS)
    with opened(browser, app_url + "/") as public:
        requested_public: list[str] = []
        public.on("request", lambda request: requested_public.append(request.url))
        public.reload()
        advance(public, DOLLY_MAX_MS)
    for url in requested + requested_public:
        if url.startswith(("http://", "https://")):
            assert same_origin(url, app_url), f"third-party request {url}"


def test_if_service_config_unchanged(app_url: str, valkey: Any, mail: Any) -> None:
    assert Postgres().tables()
    S3().keys("")
    valkey.keys("lock:*")
    mail.messages(0, settle=0)
    assert health(app_url)["services"] == {name: "up" for name in SERVICES}


def test_if_lockfile_used() -> None:
    assert Path("/app/package-lock.json").is_file()
    assert "npm ci" in json.loads(Path("/app/run.json").read_text())["install"]
