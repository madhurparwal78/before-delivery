from __future__ import annotations

import base64
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

import conftest as kit
from conftest import (
    advance,
    axe,
    capture,
    check as kit_check,
    click as kit_click,
    decode,
    difference,
    fill as kit_fill,
    held,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select as kit_select,
    session,
    shipped_packages,
    tab_order,
)


def _client(name: str) -> Any:
    for module_name in ("conftest", "mailpit", "minio", "postgres"):
        try:
            module = __import__(module_name)
        except ImportError:
            continue
        if hasattr(module, name):
            return getattr(module, name)
    raise AttributeError(name)


HOUSEHOLD_ZONE = ZoneInfo("America/Chicago")
HOUSEHOLD_MAIL = "household@alder-lane.test"
APP_DIR = Path("/app")

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
RAIL_PX = 240
INSPECTOR_PX = 320
TARGET_PX = 44
SHEET_MS = 320
SCRUB_STEP_MIN = 15
PAGE_STEP_MIN = 60
DRAG_SNAP_MIN = 5
DAY_MIN = 1440
FALL_BACK_MIN = 1500
SPRING_MIN = 1380
TABLET_FAST_MIN = 47
STATUS_PUSH_S = 1
STATUS_HEARTBEAT_S = 15
CHANGE_PUSH_S = 1
SCREEN_UPDATE_S = 2
GUEST_END_LAG_S = 1
NOTICE_SEND_S = 10
MAIL_RETRY_S = 5
STORAGE_CHECK_S = 5
JSON_LIMIT = 65536
CLIP_LIMIT = 20000000
GUEST_MAX_DAYS = 14
FROM_MAX_DAYS = 366
KEY_MAX = 100
SCENE_NAME_MAX = 40
DAY_SCENE_BRIGHTNESS = 40
DAY_SCENE_SETPOINT = 68
EVENING_BRIGHTNESS = 60
SETPOINT_MIN = 60
SETPOINT_MAX = 80
EFFECT_HOUR = 5

NETWORK_SLACK_S = 2
HTTP_TIMEOUT_S = 60
SETTLE_WAIT_S = 2
SETTLE_POLL_S = 0.02
SETTLE_CLOCK_MS = 2 * SHEET_MS
POLL_S = 0.2
UI_WAIT_S = 30
EXPECT_MS = 400
UI_STEP_MS = 100
SWEEP_STEP_MS = 10
SLOW_RATE = 0.1
FRAME_MS = 20
SETTLE_MS = 2000
MOVE_SETTLE_S = 2
COPY_BOOT_S = 180
MAIL_SETTLE_S = 3
EDGE_PX = 2
SCROLLBAR_PX = 20
TAB_LIMIT = 60
TRAP_PRESSES = 12
FOREIGN_ZONE = "Pacific/Auckland"
OUTAGE_STORE_DB = "_storedown"
OUTAGE_MAIL_DB = "_maildown"

LIVE_MONDAY = date(2028, 1, 3)
LIVE_WEEKS = 80
SATURDAYS = date(2029, 1, 6)
SATURDAY_WEEKS = 100
VERSION_MONDAY = date(2031, 1, 6)
VERSION_WEEKS = 90
NOTICE_MONDAY = date(2033, 1, 6)
NOTICE_WEEKS = 90

SEED_TUESDAY = date(2026, 11, 3)
SEED_OFFSET = "-06:00"
FALL_BACK = date(2026, 11, 1)
SPRING_FORWARD = date(2027, 3, 14)
EDIT_FROM = date(2026, 11, 9)
EDIT_FRIDAY = date(2026, 11, 6)
EDIT_THURSDAY = date(2026, 11, 5)
SEED_FROM = "2026-01-01"
SKIPPED_SLOT = "02:15"
CDT_OFFSET = "-05:00"
EARLY = "08:15"
DAWN = "06:00"
FIRST_PROBE_SLOT = "03:17"
SECOND_PROBE_SLOT = "03:23"
UNKNOWN_ID = "no-such-record"
UNKNOWN_CAMERA = "attic-camera"
CORS_PREFIX = "access-control-allow"
TABPANEL = "tabpanel"
MINIO_DOWN_ENV = "APP_MINIO_DOWN_URL"
MAILPIT_DOWN_ENV = "APP_MAILPIT_DOWN_URL"
LOOPBACK = "127.0.0.1"
HUB_TIME_RE = re.compile(r"Hub time \d\d:\d\d")
NOW_RE = re.compile(r"^Now \d\d:\d\d$")
SLOT_RE = re.compile(r"^Slot \d+$")

ROOMS = [
    ("hall", "Hall"),
    ("kitchen", "Kitchen"),
    ("living", "Living"),
    ("study", "Study"),
    ("main-bedroom", "Main bedroom"),
    ("nursery", "Nursery"),
    ("spare-room", "Spare room"),
    ("bath", "Bath"),
    ("porch", "Porch"),
]
ROOM_IDS = [room for room, _ in ROOMS]
ROOM_NAMES = [name for _, name in ROOMS]
ROOM_NAME = dict(ROOMS)
SCENES = [
    ("wake", "Wake"),
    ("day", "Day"),
    ("evening", "Evening"),
    ("bedtime", "Bedtime"),
    ("night-low", "Night low"),
    ("guest-welcome", "Guest welcome"),
]
SEED_SCENE_NAMES = [name for _, name in SCENES]
SCENE_NAME = dict(SCENES)
TINTS = ["amber", "honey", "ember", "rose", "dusk", "candle"]
WEEKDAY_SEED = [
    ("01:30", "night-low", ROOM_IDS),
    ("06:40", "wake", ["hall", "kitchen", "main-bedroom", "nursery", "bath"]),
    ("08:30", "day", ["kitchen", "living", "study"]),
    ("17:30", "evening", ["hall", "kitchen", "living", "porch"]),
    ("19:30", "bedtime", ["nursery"]),
    ("21:30", "bedtime", ["main-bedroom"]),
    ("22:15", "night-low", ["hall", "kitchen", "living", "study", "bath", "porch"]),
]
WEEKEND_SEED = [
    ("01:30", "night-low", ROOM_IDS),
    ("08:00", "wake", ["hall", "kitchen", "main-bedroom", "nursery", "bath"]),
    ("10:00", "day", ["kitchen", "living", "study"]),
    ("18:00", "evening", ["hall", "kitchen", "living", "porch"]),
    ("19:45", "bedtime", ["nursery"]),
    ("22:30", "bedtime", ["main-bedroom"]),
    ("23:30", "night-low", ["hall", "kitchen", "living", "study", "bath", "porch"]),
]
PAGES = ["/plan", "/schedules", "/scenes", "/guests", "/log", "/notices"]
RAIL_LINKS = ["Schedules", "Scenes", "Guests", "Day log", "Notices"]

MESSAGES = {
    "bad_json": "The request body is not valid JSON.",
    "forbidden_origin": "Requests must come from this hub's own pages.",
    "not_found": "Nothing here by that name.",
    "schedule_changed": "Someone else changed this schedule. Reload it to see their change.",
    "guest_scene_closed": "This guest scene has already ended.",
    "idempotency_conflict": "This request key was already used for a different guest scene.",
    "clip_closed": "This clip is already closed.",
    "clip_not_playable": "This clip is not stored yet.",
    "too_large": "The request body is too large.",
    "unsupported_media_type": "This content type is not accepted here.",
    "invalid": "Check the highlighted fields.",
    "storage_unavailable": "Clip storage is unreachable. Try again shortly.",
}
STORAGE_BANNER = "Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back."
MAIL_BANNER = "Mail is unreachable. Notices are queued and each will be sent once when it is back."
STORING_COPY = "Storing clip…"
MISMATCH_COPY = "Clip incomplete. Not saved."
SENDING_COPY = "Sending…"
SAVING_SCHEDULE = "Saving schedule…"
CREATING_SCENE = "Creating scene…"
SAVING_SCENE = "Saving scene…"
SCENE_CREATED = "Scene created. Add it to a schedule slot to give it rooms."
SCENE_SAVED = "Scene saved."
STARTING_GUEST = "Starting guest scene…"
CANCELLING = "Cancelling…"
FIELD_FROM_FORMAT = "Use a date like 2026-11-09."
FIELD_FROM_PAST = "Choose today or a later day."
FIELD_FROM_FAR = "Choose a day within the next 366 days."
FIELD_DAY = "Use a date like 2026-11-01."
FIELD_INSTANT = "Use a time like 2026-11-01T01:29:55-05:00."
FIELD_NO_SETTING = "This device has no such setting."
FIELD_DEVICE_BRIGHTNESS = "Brightness is a whole number from 1 to 100."
FIELD_SCENE_BRIGHTNESS = "Brightness is a whole number from 0 to 100."
FIELD_SETPOINT = "Setpoint is a whole number from 60 to 80."
FIELD_ON = "Use true or false."
FIELD_SCENE_NAME = "Give the scene a name of 1 to 40 characters."
FIELD_SCENE_TAKEN = "Another scene already uses this name."
FIELD_TINT = "Choose one of the six tints."
FIELD_SLOTS = "A schedule has 1 to 48 slots."
FIELD_SLOT_TIME = "Use a 24-hour time like 06:10."
FIELD_SLOT_SHARED = "Two slots at the same time cannot share a room."
FIELD_CHOOSE_SCENE = "Choose a scene."
FIELD_SLOT_ROOMS = "Choose at least one room."
FIELD_CHOOSE_ROOM = "Choose a room."
FIELD_REVISION = "Reload the schedule before saving."
FIELD_WALL = "Use a date and time like 2026-11-07T11:00."
FIELD_START_PAST = "Start now or later."
FIELD_END_ORDER = "End after the start."
FIELD_END_LONG = "A guest scene can last at most 14 days."
FIELD_SKIPPED = "That time is skipped when clocks spring forward. Choose another time."
FIELD_KEY = "Use 1 to 100 visible characters."
FIELD_DECLARED = "Declared size is a whole number of bytes from 1 to 20,000,000."
FIELD_REPORT = "Send online or state."


def must(condition: bool, message: str = "") -> None:
    if not condition:
        raise AssertionError(message)


def poll(probe: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    expired = False
    while not expired:
        expired = time.monotonic() > deadline
        result = probe()
        if result:
            return result
        threading.Event().wait(POLL_S)
    raise AssertionError(f"timed out after {seconds}s waiting for {what}")


def call(base: str, method: str, path: str, *, body: Any = None, content: bytes | None = None,
         headers: dict[str, str] | None = None) -> httpx.Response:
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        if body is not None:
            return client.request(method, base.rstrip("/") + path, json=body, headers=headers)
        return client.request(method, base.rstrip("/") + path, content=content, headers=headers)


def get_json(base: str, path: str) -> Any:
    response = call(base, "GET", path)
    assert response.status_code == 200, f"GET {path}: {response.status_code} {response.text[:300]}"
    return response.json()


def put_json(base: str, path: str, body: Any, **headers: str) -> httpx.Response:
    return call(base, "PUT", path, body=body, headers=headers or None)


def expect_error(response: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text[:400]}"
    payload = response.json()
    assert isinstance(payload, dict) and "error" in payload, payload
    error = payload["error"]
    assert error["code"] == code, error
    assert isinstance(error["message"], str) and error["message"], error
    expected = message if message is not None else MESSAGES.get(code)
    if expected is not None:
        assert error["message"] == expected, error
    return error


def expect_field(response: httpx.Response, field: str, message: str) -> dict:
    error = expect_error(response, 422, "invalid")
    assert isinstance(error.get("fields"), dict), error
    assert error["fields"].get(field) == message, error
    return error


def at(day: date, hour: int, minute: int, second: int = 0, fold: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=HOUSEHOLD_ZONE, fold=fold)


def iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


def offset_of(moment: datetime) -> str:
    return iso(moment)[-6:]


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def long_date(day: date) -> str:
    return f"{day:%A} {day.day} {day:%B} {day.year}"


def hhmm(moment: datetime) -> str:
    return f"{moment.astimezone(HOUSEHOLD_ZONE):%H:%M}"


def minutes(clock: str) -> int:
    hours, mins = clock.split(":")
    return int(hours) * 60 + int(mins)


def wall(moment: datetime) -> str:
    return f"{moment:%Y-%m-%dT%H:%M}"


def pick(first: date, weeks: int, shift: int = 0) -> date:
    return first + timedelta(days=7 * secrets.randbelow(weeks) + shift)


def set_clock(base: str, moment: datetime) -> datetime:
    response = put_json(base, "/api/sim/clock", {"now": iso(moment)})
    assert response.status_code == 200, response.text
    return parse(response.json()["now"])


def hub_now(base: str) -> datetime:
    return parse(get_json(base, "/api/sim/clock")["now"])


def wait_hub(base: str, moment: datetime) -> None:
    remaining = max(0.0, (moment - hub_now(base)).total_seconds())
    poll(lambda: hub_now(base) >= moment, remaining + NETWORK_SLACK_S * 3, f"hub clock to reach {iso(moment)}")


def park(base: str, moment: datetime) -> None:
    set_clock(base, moment)
    wait_hub(base, moment + timedelta(seconds=MOVE_SETTLE_S))


def park_after_notices(base: str) -> date:
    now = hub_now(base)
    created = [parse(n["created_at"]) for n in get_json(base, "/api/notices")["notices"]]
    latest = max(created + [now]).astimezone(HOUSEHOLD_ZONE).date()
    day = latest + timedelta(days=1)
    park(base, at(day, 12, 0))
    return day


def status_room(base: str, room: str) -> dict:
    return next(r for r in get_json(base, "/api/status")["rooms"] if r["room_id"] == room)


def device(base: str, device_id: str) -> dict:
    return next(d for d in get_json(base, "/api/devices")["devices"] if d["id"] == device_id)


def set_device(base: str, device_id: str, state: dict) -> dict:
    response = put_json(base, f"/api/devices/{device_id}/state", state)
    assert response.status_code == 200, response.text
    return response.json()["device"]


def report(base: str, device_id: str, body: dict) -> httpx.Response:
    return post_json(base, f"/api/sim/devices/{device_id}/report", body)


def owners_at(plan: dict, instant: datetime) -> dict[str, str | None]:
    owners = {o["room_id"]: o["scene_id"] for o in plan["start_owners"]}
    for change in plan["changes"]:
        if parse(change["at"]) <= instant:
            for room in change["room_ids"]:
                owners[room] = change["scene_id"]
    return owners


def seed_owners(table: list, clock: str) -> dict[str, tuple[str, str]]:
    owners: dict[str, tuple[str, str]] = {}
    for slot_time, scene, rooms in table:
        if minutes(slot_time) <= minutes(clock):
            for room in rooms:
                owners[ROOM_NAME[room]] = (SCENE_NAME[scene], slot_time)
    return owners


def names_of(owners: dict[str, tuple[str, str]]) -> dict[str, str]:
    return {room: scene for room, (scene, _) in owners.items()}


def at_list_of(owners: dict[str, tuple[str, str]]) -> list[str]:
    return [f"{room} · {owners[room][0]} · since {owners[room][1]}" for room in ROOM_NAMES]


def counts_of(names: dict[str, str]) -> dict[str, int]:
    tally = Counter(names.values())
    return {scene: tally.get(scene, 0) for scene in SEED_SCENE_NAMES}


def plan_time_copy(label: str, names: dict[str, str]) -> str:
    tally = Counter(names.values())
    parts = [f"{tally[s]} room{'s' if tally[s] != 1 else ''} in {s}" for s in SEED_SCENE_NAMES if tally.get(s)]
    return f"At {label}, " + ", ".join(parts)


def create_scene(base: str, brightness: int, setpoint: int | None) -> dict:
    name = f"Lamp {secrets.token_hex(4)}"
    response = post_json(base, "/api/scenes", {"name": name, "tint": "amber", "brightness": brightness, "setpoint_f": setpoint})
    assert response.status_code == 201, response.text
    return response.json()["scene"]


def create_guest(base: str, room: str, scene: str, starts: str | None, ends: str, key: str | None = None) -> httpx.Response:
    return post_json(base, "/api/guest-scenes", {"room_id": room, "scene_id": scene, "starts_at": starts, "ends_at": ends}, key)


def cancel_quietly(base: str, guest_ids: list[str]) -> None:
    for guest_id in guest_ids:
        post_json(base, f"/api/guest-scenes/{guest_id}/cancel", {})


def guest(base: str, guest_id: str) -> dict:
    return next(g for g in get_json(base, "/api/guest-scenes")["guest_scenes"] if g["id"] == guest_id)


def announce(base: str, camera: str, recorded: datetime, size: int) -> dict:
    response = post_json(base, f"/api/sim/cameras/{camera}/clips", {"recorded_at": iso(recorded), "declared_size": size})
    assert response.status_code == 201, response.text
    return response.json()["clip"]


def send_bytes(base: str, clip_id: str, data: bytes, content_type: str = "application/octet-stream") -> httpx.Response:
    return call(base, "PUT", f"/api/sim/clips/{clip_id}/bytes", content=data, headers={"Content-Type": content_type})


def clip(base: str, clip_id: str) -> dict:
    return get_json(base, f"/api/clips/{clip_id}")["clip"]


def random_clip_time(day: date, hour: int) -> datetime:
    return at(day, hour, secrets.randbelow(60), secrets.randbelow(60))


def clip_size() -> int:
    return 2048 + secrets.randbelow(4096)


def motion_body(camera: str, recorded: datetime, size: int) -> str:
    return f"{camera} recorded motion at {recorded:%H:%M:%S} on {long_date(recorded.date())}. The clip is stored on the hub ({size} bytes)."


def mail_matching(mail: Any, predicate: Callable[[dict], bool], settle: float | None = None) -> list[dict]:
    messages = mail.messages() if settle is None else mail.messages(settle=settle)
    return [m for m in messages if predicate(m)]


def wait_mail(mail: Any, predicate: Callable[[dict], bool], seconds: float) -> list[dict]:
    return poll(lambda: mail_matching(mail, predicate), seconds, "a matching Mailpit message")


def body_of(message: dict) -> str:
    return _client("text")(message).replace("\r\n", "\n").strip()


def assert_plain_notice(message: dict, subject: str) -> None:
    addresses = _client("addresses")
    assert message.get("Subject") == subject, message.get("Subject")
    assert [a.lower() for a in addresses(message.get("From"))] == [_client("mail_from_address")().lower()]
    assert [a.lower() for a in addresses(message.get("To"))] == [HOUSEHOLD_MAIL]
    assert "://" not in body_of(message)
    assert not str(message.get("HTML") or "").strip(), "notices are plain text (L579)"


class Listener:

    def __init__(self, base: str, origin: str | None = None) -> None:
        parsed = urlparse(base)
        self.messages: list[tuple[float, dict]] = []
        self.lock = threading.Lock()
        self.sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=HTTP_TIMEOUT_S)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET /api/socket HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin or f'{parsed.scheme}://{parsed.netloc}'}\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        head = b""
        while not head.endswith(b"\r\n\r\n"):
            chunk = self.sock.recv(1)
            if not chunk:
                break
            head += chunk
        self.status = int(head.split(b" ")[1]) if head.count(b" ") else 0
        if self.status == 101:
            self.sock.settimeout(None)
            threading.Thread(target=self._read, daemon=True).start()

    def _exact(self, count: int) -> bytes:
        buffer = b""
        while len(buffer) < count:
            chunk = self.sock.recv(count - len(buffer))
            if not chunk:
                raise ConnectionError("socket closed")
            buffer += chunk
        return buffer

    def _send(self, opcode: int, data: bytes) -> None:
        mask = os.urandom(4)
        size = len(data)
        header = bytes([0x80 | opcode])
        if size < 126:
            header += bytes([0x80 | size])
        else:
            header += bytes([0x80 | 126]) + size.to_bytes(2, "big")
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self) -> None:
        payload = b""
        try:
            while self.sock.fileno() != -1:
                first, second = self._exact(2)
                opcode = first & 0x0F
                size = second & 0x7F
                if size == 126:
                    size = int.from_bytes(self._exact(2), "big")
                elif size == 127:
                    size = int.from_bytes(self._exact(8), "big")
                mask = self._exact(4) if second & 0x80 else b""
                data = self._exact(size) if size else b""
                if mask:
                    data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
                if opcode == 8:
                    return
                if opcode == 9:
                    self._send(10, data)
                    continue
                if opcode in (0, 1, 2):
                    payload += data
                    if first & 0x80:
                        message = json.loads(payload.decode())
                        with self.lock:
                            self.messages.append((time.monotonic(), message))
                        payload = b""
        except (OSError, ConnectionError, ValueError):
            return

    def wait(self, predicate: Callable[[dict], bool], seconds: float, after: float = 0.0) -> tuple[float, dict]:
        def found() -> tuple[float, dict] | None:
            with self.lock:
                items = list(self.messages)
            return next(((t, m) for t, m in items if t >= after and predicate(m)), None)

        return poll(found, seconds, "a socket message")

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


@contextmanager
def listen(base: str) -> Iterator[Listener]:
    listener = Listener(base)
    assert listener.status == 101, f"socket handshake answered {listener.status}"
    try:
        yield listener
    finally:
        listener.close()


@contextmanager
def opened(browser: Browser, url: str, size: dict = DESKTOP, reduced_motion: str = "no-preference",
           zone: str | None = None, device_clock: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, url, reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size)
        cdp = session(page)
        if zone:
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        if device_clock:
            page.clock.set_system_time(device_clock)
        page.goto(url)
        yield page


def ui(page: Page, check_state: Callable[[], Any], seconds: float = UI_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    expired = False
    while not expired:
        expired = time.monotonic() > deadline
        try:
            return check_state()
        except (AssertionError, PlaywrightError) as error:
            if expired:
                raise AssertionError(f"screen never reached the expected state: {error}") from error
        advance(page, UI_STEP_MS)
    raise AssertionError("screen never reached the expected state")


def shows(locator: Locator, value: str | re.Pattern) -> None:
    expect(locator).to_have_text(value, timeout=EXPECT_MS)


def contains(locator: Locator, value: str | re.Pattern) -> None:
    expect(locator).to_contain_text(value, timeout=EXPECT_MS)


def visible(locator: Locator) -> None:
    expect(locator).to_be_visible(timeout=EXPECT_MS)


def hidden(locator: Locator) -> None:
    expect(locator).to_be_hidden(timeout=EXPECT_MS)


def holds_focus(container: Locator) -> bool:
    return bool(container.evaluate("el => el.contains(document.activeElement)"))


def has_focus(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el === document.activeElement"))


def choose(radio: Locator) -> None:
    if not radio.is_checked():
        radio.focus()
        radio.page.keyboard.press("Space")
    expect(radio).to_be_checked()


def set_value(locator: Locator, value: str) -> None:
    click(locator)
    locator.evaluate("(e, v) => { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", value)


def settle(locator: Locator) -> None:
    page = locator.page

    def where() -> tuple[float, float, bool] | None:
        box = locator.bounding_box()
        size = page.viewport_size
        if box is None or size is None:
            return None
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        return round(x, 1), round(y, 1), 0 <= x <= size["width"] and 0 <= y <= size["height"]

    last = where()
    if last is None or last[2]:
        return
    deadline, moved = time.monotonic() + SETTLE_WAIT_S, 0
    while time.monotonic() < deadline:
        if moved < SETTLE_CLOCK_MS:
            advance(page, FRAME_MS)
            moved += FRAME_MS
        threading.Event().wait(SETTLE_POLL_S)
        now = where()
        if now is not None and now[:2] == last[:2] and (now[2] or moved >= SETTLE_CLOCK_MS):
            return
        last = now or last


def click(locator: Locator) -> None:
    settle(locator)
    kit_click(locator)


def check(locator: Locator) -> None:
    settle(locator)
    kit_check(locator)


def fill(locator: Locator, value: str) -> None:
    settle(locator)
    kit_fill(locator, value)


def select(locator: Locator, choice: str) -> None:
    settle(locator)
    kit_select(locator, choice)


def flip(switch: Locator) -> None:
    expect(switch).to_be_visible()
    expect(switch).to_be_enabled()
    settle(switch)
    point = switch.evaluate("""e => {
      e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
      const owns = h => !!h && (h === e || e.contains(h) || [...(e.labels || [])].some(l => l === h || l.contains(h)));
      for (const t of [e, ...(e.labels || [])]) {
        const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (r.width && r.height && owns(document.elementFromPoint(x, y))) return {x, y};
      }
      return null;
    }""")
    assert point, "control is obscured at the actual pointer target"
    switch.page.mouse.click(point["x"], point["y"])


def press_on(page: Page, locator: Locator, key: str = "Enter") -> None:
    locator.focus()
    page.keyboard.press(key)


def focused_name(page: Page) -> str:
    focused = page.locator(":focus")
    if focused.count() == 0:
        return ""
    match = re.match(r'^- [\w-]+ "((?:[^"\\]|\\.)*)"', focused.last.aria_snapshot())
    return match.group(1) if match else ""


def tab_to(page: Page, name: str, limit: int = TAB_LIMIT) -> None:
    for _ in range(limit):
        if " ".join(tab_order(page, 1)[-1].split()) == name or focused_name(page) == name:
            return
    raise AssertionError(f"Tab never reached {name!r}")


def assert_trap(page: Page, sheet: Locator) -> None:
    for key in ["Tab"] * TRAP_PRESSES + ["Shift+Tab"] * TRAP_PRESSES:
        page.keyboard.press(key)
        must(holds_focus(sheet), f"{key} moved focus out of the open sheet")


def inside_viewport(page: Page, locator: Locator) -> None:
    box = locator.bounding_box()
    size = page.viewport_size
    must(box is not None, "no box")
    must(box["x"] >= -EDGE_PX and box["y"] >= -EDGE_PX, f"sheet not in view: {box}")
    must(box["x"] + box["width"] <= size["width"] + EDGE_PX, f"sheet not in view: {box}")
    must(box["y"] + box["height"] <= size["height"] + EDGE_PX, f"sheet not in view: {box}")


def box(locator: Locator) -> dict:
    value = locator.bounding_box()
    assert value is not None, "element has no box"
    return value


def value_of(locator: Locator) -> str:
    current = locator.get_attribute("aria-valuenow")
    return current if current is not None else locator.input_value()


def slow_motion(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    return cdp


def plan_url(base: str, day: date, clock: str) -> str:
    return f"{base}/plan?day={day.isoformat()}&at={clock}"


def query(page: Page) -> tuple[str, str]:
    parsed = urlparse(page.url)
    assert parsed.path == "/plan", page.url
    values = parse_qs(parsed.query)
    assert "day" in values and "at" in values, f"address not rewritten yet: {page.url}"
    return values["day"][0], values["at"][0]


def slider(page: Page) -> Locator:
    return page.get_by_role("slider", name="Time of day")


def slider_now(locator: Locator) -> int:
    value = locator.get_attribute("aria-valuenow")
    if value is None:
        value = locator.evaluate("e => e.value")
    return round(float(value))


def slider_bound(locator: Locator, aria: str, native: str) -> int:
    value = locator.get_attribute(aria)
    if value is None:
        value = locator.evaluate(f"e => e.{native}")
    return round(float(value))


IMG_NAME = re.compile(r'img "([^"]+?): ([^"]*)"')


def plan_names(page: Page) -> dict[str, str]:
    snapshot = page.get_by_role("region", name="Floor plan").aria_snapshot()
    return {m.group(1): m.group(2) for m in IMG_NAME.finditer(snapshot)}


def plan_order(page: Page) -> list[str]:
    snapshot = page.get_by_role("region", name="Floor plan").aria_snapshot()
    return [m.group(1) for m in IMG_NAME.finditer(snapshot)]


def legend_items(page: Page) -> list[tuple[str, int]]:
    items = []
    for raw in page.get_by_role("list", name="Scene legend").get_by_role("listitem").all_inner_texts():
        match = re.match(r"^(.*\S)\s+(\d+)$", " ".join(raw.split()))
        if match:
            items.append((match.group(1), int(match.group(2))))
    return items


def legend(page: Page) -> dict[str, int]:
    found = dict(legend_items(page))
    return {scene: found.get(scene, -1) for scene in SEED_SCENE_NAMES}


def at_list(page: Page) -> list[str]:
    texts = page.get_by_role("list", name="At this time").get_by_role("listitem").all_inner_texts()
    return [" ".join(t.split()) for t in texts]


def plan_state(page: Page) -> tuple[dict[str, str], dict[str, int]]:
    return plan_names(page), legend(page)


def sweep(page: Page, done: Callable[[tuple], bool]) -> list[tuple]:
    states: list[tuple] = []
    deadline = time.monotonic() + UI_WAIT_S
    expired, state = False, None
    while not expired:
        expired = time.monotonic() > deadline
        state = plan_state(page)
        if not states or states[-1] != state:
            states.append(state)
        if done(state):
            return states
        advance(page, SWEEP_STEP_MS)
    raise AssertionError(f"sweep never finished; last state {state}")


def rooms_button(page: Page, room: str) -> Locator:
    return page.get_by_role("list", name="Rooms").get_by_role("button", name=room)


def inspector(page: Page, desktop: bool) -> Locator:
    return page.get_by_role("complementary" if desktop else "dialog", name="Room inspector")


def plan_ready(page: Page) -> None:
    ui(page, lambda: must(len(plan_names(page)) == len(ROOMS), "the nine rooms are not drawn"))


def running_animations(page: Page) -> list:
    return page.evaluate(
        "() => document.getAnimations().filter(a => a.playState === 'running')"
        ".map(a => String(a.animationName || a.transitionProperty || a.id || 'animation'))"
    )


def sheet_animation_ends(sheet: Locator) -> list[float]:
    return sheet.evaluate(
        "el => document.getAnimations().filter(a => a.effect && a.effect.target && "
        "(el.contains(a.effect.target) || a.effect.target.contains(el)))"
        ".map(a => Number(a.effect.getComputedTiming().endTime))"
    )


def sheet_own_animation_ends(sheet: Locator) -> list[float]:
    return sheet.evaluate(
        "el => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.contains(el))"
        ".map(a => Number(a.effect.getComputedTiming().endTime))"
    )


def free_port() -> int:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


def log_tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-3000:]


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    serve = json.loads((APP_DIR / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    process = subprocess.Popen(serve, shell=True, cwd=kit.DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def healthy() -> bool:
        if process.poll() is not None:
            raise AssertionError(f"app copy exited with {process.returncode}:\n{log_tail(log.name)}")
        try:
            return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(healthy, COPY_BOOT_S, "the app copy to report healthy")
        except AssertionError as error:
            raise AssertionError(f"{error}\n{log_tail(log.name)}") from error
        yield base
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(process.pid, signal.SIGKILL)


class Relay:

    def __init__(self, port: int, upstream: tuple[str, int]) -> None:
        self.port = port
        self.upstream = upstream
        self.server: socket.socket | None = None

    def start(self) -> None:
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", self.port))
        self.server.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        assert self.server is not None
        while self.server.fileno() != -1:
            try:
                inbound, _ = self.server.accept()
            except OSError:
                return
            outbound = socket.create_connection(self.upstream)
            for source, target in ((inbound, outbound), (outbound, inbound)):
                threading.Thread(target=self._pump, args=(source, target), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, target: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                target.sendall(data)
        except OSError:
            pass
        finally:
            try:
                target.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def stop(self) -> None:
        if self.server is not None:
            try:
                self.server.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.server.close()


def weekend_in_force(base: str, day: date) -> tuple[dict, dict]:
    schedule = get_json(base, "/api/schedules/weekend")["schedule"]
    version = [v for v in schedule["versions"] if v["from"] <= day.isoformat()][-1]
    return schedule, version


def slots_body(version: dict) -> list[dict]:
    return [{"time": s["time"], "scene_id": s["scene_id"], "room_ids": list(s["room_ids"])} for s in version["slots"]]


def scene_names(base: str) -> dict[str, str]:
    return {s["id"]: s["name"] for s in get_json(base, "/api/scenes")["scenes"]}


def ensure_fall_back_run(base: str) -> None:
    def night_low_runs() -> list:
        runs = get_json(base, f"/api/runs?day={FALL_BACK.isoformat()}")["runs"]
        return [r for r in runs if r["slot_time"] == "01:30" and r["schedule_id"] == "weekend"]

    if night_low_runs():
        return
    set_clock(base, at(FALL_BACK, 1, 29, 56))
    poll(night_low_runs, STATUS_HEARTBEAT_S, "the first-pass Night low run")


def clock_of(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def hms(moment: datetime) -> str:
    return f"{moment:%H:%M:%S}"


def clip_label(camera: str, moment: datetime) -> str:
    return f"{camera} {hms(moment)}"


def clip_row(page: Page, label: str) -> Locator:
    return page.get_by_role("list", name="Clips").get_by_role("listitem").filter(has=page.get_by_role("button", name=label))


def clip_sheet_name(camera: str, moment: datetime) -> str:
    return f"Clip from {camera} at {hms(moment)}"


def details(device_name: str) -> str:
    return f"Details for {device_name}"


def edit_name(schedule: str) -> str:
    return f"Edit {schedule} schedule"


def at_line(room: str, scene: str, since: str) -> str:
    return f"{room} · {scene} · since {since}"


def run_line(clock: str, scene: str, count: int, schedule: str) -> str:
    return f"{clock} {scene} · {count} rooms · {schedule}"


def change_heading(schedule: str, day: date) -> str:
    return f"From {long_date(day)}, the {schedule} schedule runs these slots:"


def slot_line_prefix(clock: str, scene: str) -> str:
    return f"{clock} {scene} — "


def motion_subject(camera: str) -> str:
    return f"Motion on {camera}"


def object_key(camera: str, day: date, clip_id: str) -> str:
    return f"clips/{camera}/{day.isoformat()}/{clip_id}.mp4"


def camera_clips(camera: str) -> str:
    return f"/api/sim/cameras/{camera}/clips"


def device_path(device_id: str) -> str:
    return f"/api/devices/{device_id}/state"


def glob(path: str) -> str:
    return f"**{path}"


def early_slot(minute: int) -> str:
    return clock_of(minute)


def any_of(values: list[str] | tuple[str, ...], whole: bool = False) -> re.Pattern:
    body = "|".join(re.escape(v) for v in values)
    return re.compile(f"^(?:{body})$" if whole else body)


def hub_header(page: Page) -> Locator:
    return page.get_by_text(HUB_TIME_RE)


def now_marker(page: Page) -> Locator:
    return page.get_by_text(NOW_RE)


def slot_groups(editor: Locator) -> Locator:
    return editor.get_by_role("group", name=SLOT_RE)


def slot_group(editor: Locator, n: int) -> Locator:
    return editor.get_by_role("group", name=f"Slot {n}")


def room_shape(page: Page, room: str) -> Locator:
    return page.get_by_role("img", name=re.compile(f"^{re.escape(room)}: "))


def mark_page(page: Page) -> None:
    page.evaluate("() => { window.nightplanProbe = 1; }")


def still_marked(page: Page) -> bool:
    return page.evaluate("() => window.nightplanProbe") == 1


def history_length(page: Page) -> int:
    return int(page.evaluate("() => history.length"))


def scroll_top(page: Page) -> None:
    page.evaluate("() => window.scrollTo(0, 0)")


def redirect_path(response: httpx.Response) -> str:
    return urlparse(response.headers["location"]).path


def test_floor_plan_rooms_and_legend(browser: Browser, app_url: str) -> None:
    noon = seed_owners(WEEKDAY_SEED, "12:00")
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET)) as page:
        ui(page, lambda: must(plan_names(page) == names_of(noon), str(plan_names(page))))
        assert plan_order(page) == ROOM_NAMES
        assert [name for name, _ in legend_items(page)][: len(SCENES)] == SEED_SCENE_NAMES
        assert legend(page) == counts_of(names_of(noon))
        legend_top = box(page.get_by_role("list", name="Scene legend"))["y"]
        for room in ROOM_NAMES:
            room_box = box(page.get_by_role("img", name=f"{room}: {noon[room][0]}"))
            assert legend_top >= room_box["y"] + room_box["height"] - EDGE_PX, f"legend is not under {room}"
        late = seed_owners(WEEKDAY_SEED, "22:30")
        page.goto(plan_url(app_url, SEED_TUESDAY, "22:30" + SEED_OFFSET))
        ui(page, lambda: must(plan_names(page) == names_of(late), str(plan_names(page))))
        ui(page, lambda: must(legend(page) == counts_of(names_of(late)), str(legend(page))))


def test_scrubber_keys_drag_touch_and_day_controls(browser: Browser, app_url: str) -> None:
    noon = minutes("12:00")
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET)) as page:
        scrubber = slider(page)
        ui(page, lambda: must(slider_now(scrubber) == noon))
        assert slider_bound(scrubber, "aria-valuemin", "min") == 0
        assert slider_bound(scrubber, "aria-valuemax", "max") == DAY_MIN
        assert scrubber.get_attribute("aria-valuetext") == f"{clock_of(noon)} CST"
        steps = [
            ("ArrowRight", noon + SCRUB_STEP_MIN), ("ArrowLeft", noon), ("ArrowUp", noon + SCRUB_STEP_MIN),
            ("ArrowDown", noon), ("PageUp", noon + PAGE_STEP_MIN), ("PageDown", noon), ("Home", 0),
            ("ArrowLeft", 0), ("PageDown", 0), ("End", DAY_MIN), ("ArrowRight", DAY_MIN), ("PageUp", DAY_MIN),
        ]
        scrubber.focus()
        for key, expected in steps:
            page.keyboard.press(key)
            ui(page, lambda e=expected: must(slider_now(scrubber) == e, f"{key}: {slider_now(scrubber)} != {e}"))
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        ui(page, lambda: must(scrubber.get_attribute("aria-valuetext") == f"{clock_of(SCRUB_STEP_MIN)} CST"))

        page.goto(plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET))
        ui(page, lambda: must(slider_now(scrubber) == noon))
        click(page.get_by_role("button", name="Next day"))
        next_day = (SEED_TUESDAY + timedelta(days=1)).isoformat()
        ui(page, lambda: must(query(page) == (next_day, f"{clock_of(noon)}{SEED_OFFSET}"), page.url))
        expect(page.get_by_role("textbox", name="Plan day")).to_have_value(next_day, timeout=EXPECT_MS)
        click(page.get_by_role("button", name="Previous day"))
        ui(page, lambda: must(query(page) == (SEED_TUESDAY.isoformat(), f"{clock_of(noon)}{SEED_OFFSET}"), page.url))
        plan_day = page.get_by_role("textbox", name="Plan day")
        fill(plan_day, FALL_BACK.isoformat())
        plan_day.press("Enter")
        ui(page, lambda: must(query(page) == (FALL_BACK.isoformat(), f"{clock_of(noon)}{SEED_OFFSET}"), page.url))
        ui(page, lambda: must(slider_bound(scrubber, "aria-valuemax", "max") == FALL_BACK_MIN))

        page.goto(plan_url(app_url, FALL_BACK + timedelta(days=1), "01:30-06:00"))
        ui(page, lambda: must(slider_now(scrubber) == minutes("01:30")))
        click(page.get_by_role("button", name="Previous day"))
        ui(page, lambda: must(query(page) == (FALL_BACK.isoformat(), f"01:30{CDT_OFFSET}"), page.url))
        ui(page, lambda: must(slider_now(scrubber) == minutes("01:30")))
        page.goto(plan_url(app_url, SPRING_FORWARD - timedelta(days=1), "02:30-06:00"))
        ui(page, lambda: must(slider_now(scrubber) == minutes("02:30")))
        click(page.get_by_role("button", name="Next day"))
        ui(page, lambda: must(query(page) == (SPRING_FORWARD.isoformat(), f"03:00{CDT_OFFSET}"), page.url))
        ui(page, lambda: must(slider_now(scrubber) == minutes("02:00"), str(slider_now(scrubber))))

        day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
        hub = at(day, 12, 34, 5)
        set_clock(app_url, hub)
        near = (hhmm(hub), hhmm(hub + timedelta(minutes=1)))
        ui(page, lambda: contains(hub_header(page), any_of(near)))
        click(page.get_by_role("button", name="Jump to now"))
        ui(page, lambda: must(query(page)[0] == day.isoformat() and query(page)[1][:5] in near, page.url))

        page.goto(plan_url(app_url, SEED_TUESDAY, "00:00" + SEED_OFFSET))
        ui(page, lambda: must(slider_now(scrubber) == 0))
        track = box(scrubber)
        x, y = track["x"] + track["width"] / 2, track["y"] + track["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 9):
            page.mouse.move(x + step * 10, y)
            advance(page, FRAME_MS)
        page.mouse.up()
        ui(page, lambda: must(slider_now(scrubber) > 0 and slider_now(scrubber) % DRAG_SNAP_MIN == 0, str(slider_now(scrubber))))

    with opened(browser, plan_url(app_url, SEED_TUESDAY, "00:00" + SEED_OFFSET), size=PHONE, reduced_motion="reduce") as page:
        scrubber = slider(page)
        ui(page, lambda: must(slider_now(scrubber) == 0))
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        track = box(scrubber)
        x, y = track["x"] + min(track["width"] / 2, TARGET_PX), track["y"] + track["height"] / 2
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for step in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + step * 12, "y": y}]})
            advance(page, FRAME_MS)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        ui(page, lambda: must(slider_now(scrubber) > 0 and slider_now(scrubber) % DRAG_SNAP_MIN == 0, str(slider_now(scrubber))))
        ui(page, lambda: must(minutes(query(page)[1][:5]) == slider_now(scrubber), page.url))


def test_plan_address_round_trip(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    hub = at(day, 15, 20, 5)
    park(app_url, hub)
    with opened(browser, f"{app_url}/plan") as page:
        offset = offset_of(hub)
        opening = (f"{hhmm(hub)}{offset}", f"{hhmm(hub + timedelta(minutes=1))}{offset}")
        ui(page, lambda: must(query(page)[0] == day.isoformat() and query(page)[1] in opening, page.url))
        plan_ready(page)
        before = history_length(page)
        slider(page).focus()
        page.keyboard.press("PageUp")
        later = (hhmm(hub + timedelta(minutes=PAGE_STEP_MIN)), hhmm(hub + timedelta(minutes=PAGE_STEP_MIN + 1)))
        ui(page, lambda: must(query(page)[1][:5] in later, page.url))
        assert history_length(page) == before, "the address must be replaced, not pushed"
        copied = page.url
        ui(page, lambda: must(legend(page) == counts_of(plan_names(page))))
        names, legend_now, listed, value = plan_names(page), legend(page), at_list(page), slider_now(slider(page))
        fresh = page.context.new_page()
        fresh.goto(copied)
        ui(fresh, lambda: must(plan_names(fresh) == names and at_list(fresh) == listed and legend(fresh) == legend_now))
        assert slider_now(slider(fresh)) == value
        assert fresh.url == copied
        fresh.close()

        cases = [
            (plan_url(app_url, FALL_BACK, "01:30"), (FALL_BACK.isoformat(), f"01:30{CDT_OFFSET}")),
            (plan_url(app_url, SPRING_FORWARD, "02:30"), (SPRING_FORWARD.isoformat(), f"03:00{CDT_OFFSET}")),
        ]
        for address, expected in cases:
            page.goto(address)
            ui(page, lambda e=expected: must(query(page) == e, page.url))
        page.goto(f"{app_url}/plan?day=someday&at=late")
        ui(page, lambda: must(query(page)[0] == hub_now(app_url).astimezone(HOUSEHOLD_ZONE).date().isoformat(), page.url))
        page.goto(plan_url(app_url, FALL_BACK - timedelta(days=1), "12:00-05:00"))
        plan_ready(page)
        slider(page).focus()
        page.keyboard.press("End")
        ui(page, lambda: must(query(page) == ((FALL_BACK - timedelta(days=1)).isoformat(), f"24:00{CDT_OFFSET}"), page.url))
        page.reload()
        ui(page, lambda: must(slider_now(slider(page)) == DAY_MIN))


SWEPT = ("Kitchen", "Living", "Study")


def sweep_steps(start: dict[str, int], moves: list[tuple[str, str]]) -> list[dict[str, int]]:
    states = [dict(start)]
    for left, joined in moves:
        nxt = dict(states[-1])
        nxt[left] -= 1
        nxt[joined] += 1
        states.append(nxt)
    return states


def test_plan_sweep_staggers_fills_and_steps_legend(browser: Browser, app_url: str) -> None:
    early, later = seed_owners(WEEKDAY_SEED, "08:15"), seed_owners(WEEKDAY_SEED, "08:30")
    before, after = names_of(early), names_of(later)
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "08:15" + SEED_OFFSET)) as page:
        ui(page, lambda: must(plan_state(page) == (before, counts_of(before))))
        slow_motion(page)
        slider(page).focus()
        for start, end, moves in (
            (before, after, [("Wake", "Day"), ("Night low", "Day"), ("Night low", "Day")]),
            (after, before, [("Day", "Wake"), ("Day", "Night low"), ("Day", "Night low")]),
        ):
            page.keyboard.press("ArrowRight" if end is after else "ArrowLeft")
            states = sweep(page, lambda s, e=end: s == (e, counts_of(e)))
            names = [s[0] for s in states]
            first = {room: next(i for i, n in enumerate(names) if n.get(room) == end[room]) for room in SWEPT}
            assert first["Kitchen"] < first["Living"] < first["Study"], f"rooms did not switch one by one in plan order: {first}"
            for n in names:
                for room in ROOM_NAMES:
                    if room not in SWEPT:
                        assert n.get(room) == start[room], f"{room} changed although its scene did not"
            sequence: list[dict[str, int]] = []
            for _, counts in states:
                if not sequence or sequence[-1] != counts:
                    sequence.append(counts)
            assert sequence == sweep_steps(counts_of(start), moves), f"legend did not step one room at a time: {sequence}"
            first_step = next(i for i, s in enumerate(states) if s[1] != counts_of(start))
            assert first_step > first["Kitchen"], "the legend stepped before the first fill landed"
            advance(page, SETTLE_MS)
            assert plan_state(page) == (end, counts_of(end))


def test_reduced_motion_plan_switches_at_once(browser: Browser, app_url: str) -> None:
    later = seed_owners(WEEKDAY_SEED, "08:30")
    expected_list = at_list_of(later)
    expected_copy = plan_time_copy("08:30", names_of(later))
    for mode in ("reduce", "no-preference"):
        with opened(browser, plan_url(app_url, SEED_TUESDAY, "08:15" + SEED_OFFSET), reduced_motion=mode) as page:
            ui(page, lambda: must(plan_names(page) == names_of(seed_owners(WEEKDAY_SEED, "08:15"))))
            slow_motion(page)
            slider(page).focus()
            page.keyboard.press("ArrowRight")
            advance(page, 3 * FRAME_MS)
            assert at_list(page) == expected_list, at_list(page)
            if mode == "reduce":
                assert plan_state(page) == (names_of(later), counts_of(names_of(later))), plan_state(page)
            ui(page, lambda: shows(page.get_by_role("status", name="Plan time"), expected_copy))


def test_newest_scrub_wins(browser: Browser, app_url: str) -> None:
    early = seed_owners(WEEKDAY_SEED, "08:15")
    before, after = names_of(early), names_of(seed_owners(WEEKDAY_SEED, "08:30"))
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "08:15" + SEED_OFFSET)) as page:
        ui(page, lambda: must(plan_state(page) == (before, counts_of(before))))
        slow_motion(page)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        sweep(page, lambda s: s[0].get("Kitchen") == after["Kitchen"])
        assert plan_names(page)["Study"] == before["Study"], "the sweep was not staggered enough to interrupt"
        page.keyboard.press("ArrowLeft")
        states = sweep(page, lambda s: s == (before, counts_of(before)))
        assert all(s[0].get("Study") == before["Study"] for s in states), "a cancelled fill still ran"
        advance(page, SETTLE_MS)
        assert plan_state(page) == (before, counts_of(before))
        assert at_list(page) == at_list_of(early)
        assert query(page) == (SEED_TUESDAY.isoformat(), f"{EARLY}{SEED_OFFSET}")


def test_plan_layouts_at_published_sizes(browser: Browser, app_url: str) -> None:
    url = plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET)
    with opened(browser, url) as page:
        for size in (DESKTOP, TABLET, PHONE):
            page.set_viewport_size(size)
            page.goto(url)
            plan_ready(page)
            layout(page)
            floor = box(page.get_by_role("region", name="Floor plan"))
            scrub = box(page.get_by_role("region", name="Day and time"))
            now_list = box(page.get_by_role("list", name="At this time"))
            rooms = box(page.get_by_role("list", name="Rooms"))
            menu = page.get_by_role("button", name="Menu", exact=True)
            assert scrub["y"] >= floor["y"] + floor["height"] - EDGE_PX
            assert now_list["y"] >= scrub["y"] + scrub["height"] - EDGE_PX
            if size is DESKTOP:
                nav = box(page.get_by_role("navigation", name="Nightplan"))
                side = box(page.get_by_role("complementary", name="Room inspector"))
                assert nav["x"] < RAIL_PX and nav["x"] + nav["width"] <= RAIL_PX + EDGE_PX
                assert abs(side["width"] - INSPECTOR_PX) <= EDGE_PX, side
                assert side["x"] + side["width"] >= DESKTOP["width"] - SCROLLBAR_PX
                assert floor["x"] >= RAIL_PX - EDGE_PX and floor["x"] + floor["width"] <= side["x"] + EDGE_PX
                assert scrub["y"] + scrub["height"] <= DESKTOP["height"]
                assert abs(now_list["y"] - rooms["y"]) <= EDGE_PX and now_list["x"] < rooms["x"]
                hidden(menu)
                visible(page.get_by_role("complementary", name="Room inspector").get_by_role("heading", name="Hall", exact=True))
            else:
                visible(menu)
                hidden(page.get_by_role("navigation", name="Nightplan"))
                hidden(page.get_by_role("dialog", name="Room inspector"))
                focused = tab_order(page, TAB_LIMIT)
                assert not set(RAIL_LINKS) & set(focused), f"closed drawer took focus: {focused}"
                if size is TABLET:
                    assert abs(now_list["y"] - rooms["y"]) <= EDGE_PX and now_list["x"] < rooms["x"]
                else:
                    assert rooms["y"] >= now_list["y"] + now_list["height"] - EDGE_PX
                    assert floor["y"] + floor["height"] <= PHONE["height"]
                    slide = box(slider(page))
                    assert slide["y"] + slide["height"] <= PHONE["height"]
            for path in PAGES[1:]:
                page.goto(app_url + path)
                ui(page, lambda: visible(hub_header(page)))
                layout(page)
            page.goto(url)


def test_day_plan_api(app_url: str) -> None:
    plan = get_json(app_url, f"/api/plan?day={SEED_TUESDAY.isoformat()}")
    previous = SEED_TUESDAY - timedelta(days=1)
    assert plan["day"] == SEED_TUESDAY.isoformat() and plan["hours"] == 24 and plan["schedule_id"] == "weekday"
    assert plan["start"] == iso(at(SEED_TUESDAY, 0, 0)) and plan["end"] == iso(at(SEED_TUESDAY + timedelta(days=1), 0, 0))
    assert [m["label"] for m in plan["hour_marks"]] == [clock_of(h * 60)[:2] for h in range(24)]
    assert [r["room_id"] for r in plan["rooms"]] == ROOM_IDS
    start = {o["room_id"]: o for o in plan["start_owners"]}
    assert (start["hall"]["scene_id"], start["hall"]["since"]) == ("night-low", iso(at(previous, 22, 15)))
    assert (start["main-bedroom"]["scene_id"], start["main-bedroom"]["since"]) == ("bedtime", iso(at(previous, 21, 30)))
    assert (start["nursery"]["scene_id"], start["nursery"]["since"]) == ("bedtime", iso(at(previous, 19, 30)))
    assert (start["spare-room"]["scene_id"], start["spare-room"]["since"]) == ("night-low", iso(at(previous, 1, 30)))
    assert all(o["source"] == "schedule" for o in plan["start_owners"])
    changes = [c for c in plan["changes"] if c["source"] == "schedule"]
    assert [(c["slot_time"], c["scene_id"], sorted(c["room_ids"])) for c in changes] == [
        (t, s, sorted(r)) for t, s, r in WEEKDAY_SEED]
    for change in changes:
        hours, mins = map(int, change["slot_time"].split(":"))
        assert change["at"] == iso(at(SEED_TUESDAY, hours, mins))
        assert change["offset"] == SEED_OFFSET and change["slot_time"] in change["local"]
        assert change["version_from"] == SEED_FROM
    expect_field(call(app_url, "GET", "/api/plan?day=someday"), "day", FIELD_DAY)

    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    park(app_url, at(day, 12, 0, 30))
    response = create_guest(app_url, "kitchen", "guest-welcome", wall(at(day, 13, 0)), wall(at(day, 18, 0)))
    assert response.status_code == 201, response.text
    guest_id = response.json()["guest_scene"]["id"]
    try:
        plan = get_json(app_url, f"/api/plan?day={day.isoformat()}")
        starts = [c for c in plan["changes"] if c["source"] == "guest" and c["guest_scene_id"] == guest_id]
        ends = [c for c in plan["changes"] if c["source"] == "guest_end" and c["guest_scene_id"] == guest_id]
        assert [(c["at"], c["room_ids"], c["scene_id"]) for c in starts] == [(iso(at(day, 13, 0)), ["kitchen"], "guest-welcome")]
        assert [c["at"] for c in ends] == [iso(at(day, 18, 0))]
        evening = next(c for c in plan["changes"] if c["source"] == "schedule" and c["slot_time"] == "17:30")
        assert "kitchen" not in evening["room_ids"], "a schedule change must leave out a guest-held room"
        assert owners_at(plan, at(day, 14, 0))["kitchen"] == "guest-welcome"
    finally:
        cancel_quietly(app_url, [guest_id])


def test_status_and_socket_push(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 12, 0))
    status = get_json(app_url, "/api/status")
    assert status["zone"] == "America/Chicago" and status["day"] == day.isoformat()
    assert status["offset"] == offset_of(at(day, 12, 0))
    assert at(day, 12, 0) <= parse(status["now"]) <= at(day, 12, 0) + timedelta(seconds=UI_WAIT_S)
    assert [r["room_id"] for r in status["rooms"]] == ROOM_IDS
    for room in status["rooms"]:
        assert room["source"] in ("schedule", "guest", "none")
        assert (room["scene_id"] is None) == (room["source"] == "none")
    assert status["services"] == {"storage": "up", "mail": "up"}
    guest_ids: list[str] = []
    with listen(app_url) as socket_:
        socket_.wait(lambda m: m.get("type") == "status" and "rooms" in m and "services" in m, NETWORK_SLACK_S)
        moved = at(day, 14, 0)
        started = time.monotonic()
        set_clock(app_url, moved)
        arrived, _ = socket_.wait(lambda m: m.get("type") == "status" and parse(m["now"]) >= moved,
                                  STATUS_PUSH_S + NETWORK_SLACK_S, started)
        assert arrived - started <= STATUS_PUSH_S + NETWORK_SLACK_S
        started = time.monotonic()
        changed = set_device(app_url, "kettle-plug", {"on": not device(app_url, "kettle-plug")["state"]["on"]})
        socket_.wait(lambda m: m.get("type") == "device" and m["device"]["id"] == "kettle-plug"
                     and m["device"]["revision"] == changed["revision"], CHANGE_PUSH_S + NETWORK_SLACK_S, started)
        started = time.monotonic()
        response = create_guest(app_url, "porch", "guest-welcome", None, wall(at(day, 15, 0)))
        assert response.status_code == 201, response.text
        guest_ids.append(response.json()["guest_scene"]["id"])
        try:
            socket_.wait(lambda m: m.get("type") == "status" and any(
                r["room_id"] == "porch" and r["source"] == "guest" for r in m["rooms"]), STATUS_PUSH_S + NETWORK_SLACK_S, started)
            socket_.wait(lambda m: m.get("type") == "guest_scene", CHANGE_PUSH_S + NETWORK_SLACK_S, started)
        finally:
            cancel_quietly(app_url, guest_ids)
        quiet, _ = socket_.wait(lambda m: m.get("type") == "status", STATUS_HEARTBEAT_S, time.monotonic())
        nxt, _ = socket_.wait(lambda m: m.get("type") == "status", STATUS_HEARTBEAT_S + NETWORK_SLACK_S, quiet + POLL_S)
        assert nxt - quiet <= STATUS_HEARTBEAT_S + NETWORK_SLACK_S


def test_server_places_now_whatever_device_clock(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    hub = at(day, 14, 5, 5)
    park(app_url, hub)
    fast = hub + timedelta(minutes=TABLET_FAST_MIN)
    with opened(browser, f"{app_url}/plan", size=TABLET, zone=FOREIGN_ZONE, device_clock=fast) as page:
        plan_ready(page)
        header = hub_header(page)
        next_minute = hub + timedelta(minutes=1)
        ui(page, lambda: shows(header, any_of([f"Hub time {hhmm(m)} {hub.tzname()}" for m in (hub, next_minute)], whole=True)))
        ui(page, lambda: shows(now_marker(page), any_of([f"Now {hhmm(m)}" for m in (hub, next_minute)], whole=True)))
        assert slider_now(slider(page)) in (minutes(hhmm(hub)), minutes(hhmm(next_minute)))
        assert query(page)[0] == day.isoformat()
        for room in get_json(app_url, "/api/status")["rooms"]:
            ui(page, lambda r=room: contains(rooms_button(page, r["name"]), f"Now: {r['scene_name']}"))
        page.clock.set_system_time(fast + timedelta(minutes=10))
        advance(page, UI_STEP_MS)
        hub_then = hub_now(app_url)
        ui(page, lambda: shows(header, any_of([f"Hub time {hhmm(hub_then + timedelta(minutes=d))} {hub.tzname()}" for d in (-1, 0, 1)], whole=True)))
        set_clock(app_url, at(day, 16, 40, 5))
        ui(page, lambda: shows(header, re.compile(r"^Hub time 16:4[01] ")))
        ui(page, lambda: shows(now_marker(page), re.compile(r"^Now 16:4[01]$")))


def test_simulation_api(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    target = at(day, 10, 0)
    assert parse(set_clock(app_url, target).isoformat()) >= target
    assert parse(get_json(app_url, "/api/sim/clock")["now"]) >= target
    wait_hub(app_url, target + timedelta(seconds=1))
    expect_field(put_json(app_url, "/api/sim/clock", {"now": "soon"}), "now", FIELD_INSTANT)
    try:
        with listen(app_url) as socket_:
            before = device(app_url, "living-thermostat")
            started = time.monotonic()
            reported = report(app_url, "living-thermostat", {"state": {"current_f": 71}})
            assert reported.status_code == 200, reported.text
            dev = reported.json()["device"]
            assert dev["state"]["current_f"] == 71 and dev["revision"] == before["revision"] + 1
            assert device(app_url, "living-thermostat")["state"]["current_f"] == 71
            socket_.wait(lambda m: m.get("type") == "device" and m["device"]["id"] == "living-thermostat"
                         and m["device"]["state"]["current_f"] == 71, CHANGE_PUSH_S + NETWORK_SLACK_S, started)
            started = time.monotonic()
            offline = report(app_url, "living-thermostat", {"online": False})
            assert offline.status_code == 200 and offline.json()["device"]["online"] is False
            assert device(app_url, "living-thermostat")["online"] is False
            socket_.wait(lambda m: m.get("type") == "device" and m["device"]["id"] == "living-thermostat"
                         and m["device"]["online"] is False, CHANGE_PUSH_S + NETWORK_SLACK_S, started)
    finally:
        report(app_url, "living-thermostat", {"online": True})
    assert device(app_url, "living-thermostat")["online"] is True
    expect_field(report(app_url, "living-thermostat", {}), "body", FIELD_REPORT)
    error = expect_error(report(app_url, "hall-camera", {"state": {"on": True}}), 422, "invalid")
    assert FIELD_NO_SETTING in error["fields"].values()
    expect_error(report(app_url, "attic-light", {"online": True}), 404, "not_found")


def test_live_regions_and_in_place_updates(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 12, 0, 30))
    guest_ids: list[str] = []
    try:
        with opened(browser, f"{app_url}/plan") as page:
            plan_ready(page)
            mark_page(page)
            updates = page.get_by_role("status", name="Device updates")
            scenes = page.get_by_role("status", name="Scene changes")
            set_device(app_url, "kitchen-lights", {"brightness": 55})
            ui(page, lambda: shows(updates, "Kitchen lights: on at 55%"))
            set_device(app_url, "kettle-plug", {"on": False})
            ui(page, lambda: shows(updates, "Kettle plug: off"))
            set_device(app_url, "living-thermostat", {"setpoint_f": 70})
            assert report(app_url, "living-thermostat", {"state": {"current_f": 73}}).status_code == 200
            ui(page, lambda: shows(updates, "Living thermostat: set to 70°F, reading 73°F"))
            click(rooms_button(page, "Living"))
            ui(page, lambda: contains(inspector(page, True), "Set to 70°F, reading 73°F"))
            report(app_url, "living-thermostat", {"online": False})
            ui(page, lambda: shows(updates, "Living thermostat: offline"))
            report(app_url, "living-thermostat", {"online": True})
            ui(page, lambda: shows(updates, "Living thermostat: back online"))
            response = create_guest(app_url, "porch", "guest-welcome", None, wall(at(day, 15, 0)))
            assert response.status_code == 201, response.text
            guest_ids.append(response.json()["guest_scene"]["id"])
            ui(page, lambda: shows(scenes, "Porch is now in Guest welcome"))
            ui(page, lambda: contains(rooms_button(page, "Porch"), "Now: Guest welcome"))
            assert f"Guest until {hhmm(at(day, 15, 0))}" in " ".join(page.get_by_role("list", name="Rooms").inner_text().split())
            cancel_quietly(app_url, guest_ids)
            scheduled = poll(lambda: status_room(app_url, "porch")["source"] == "schedule" and status_room(app_url, "porch"),
                             STATUS_PUSH_S + NETWORK_SLACK_S, "porch back on its schedule")
            ui(page, lambda: shows(scenes, f"Porch is now in {scheduled['scene_name']}"))
            assert still_marked(page), "the page reloaded"
    finally:
        report(app_url, "living-thermostat", {"online": True})
        cancel_quietly(app_url, guest_ids)


def test_room_inspector_column_and_sheets(browser: Browser, app_url: str) -> None:
    park(app_url, at(SEED_TUESDAY, 12, 0))
    with opened(browser, f"{app_url}/plan") as page:
        plan_ready(page)
        side = inspector(page, True)
        ui(page, lambda: visible(side.get_by_role("heading", name="Hall", exact=True)))
        contains(side, "Now: Wake since 06:40")
        kitchen = rooms_button(page, "Kitchen")
        click(kitchen)
        ui(page, lambda: visible(side.get_by_role("heading", name="Kitchen", exact=True)))
        assert has_focus(kitchen)
        contains(side, "Now: Day since 08:30")
        devices = side.get_by_role("list", name="Devices")
        for name in ("Kitchen lights", "Kettle plug"):
            visible(devices.get_by_role("switch", name=name))
            visible(devices.get_by_role("button", name=f"Details for {name}"))
        plan_items = [" ".join(t.split()) for t in side.get_by_role("list", name=f"Plan for {ROOM_NAME['kitchen']}").get_by_role("listitem").all_inner_texts()]
        assert plan_items == [f"{t} {SCENE_NAME[s]}" for t, s, r in WEEKDAY_SEED if "kitchen" in r]
        click(rooms_button(page, "Living"))
        thermostat = device(app_url, "living-thermostat")["state"]
        ui(page, lambda: contains(side, f"Set to {thermostat['setpoint_f']}°F, reading {thermostat['current_f']}°F"))
        click(rooms_button(page, "Hall"))
        ui(page, lambda: contains(side.get_by_role("list", name="Devices"), "Camera"))
        for size in (TABLET, PHONE):
            page.set_viewport_size(size)
            page.goto(f"{app_url}/plan")
            plan_ready(page)
            click(rooms_button(page, "Kitchen"))
            sheet = inspector(page, False)
            ui(page, lambda: (visible(sheet.get_by_role("heading", name="Kitchen", exact=True)), inside_viewport(page, sheet)))
            advance(page, SHEET_MS + FRAME_MS)
            frame = box(sheet)
            if size is TABLET:
                assert abs(frame["width"] - INSPECTOR_PX) <= EDGE_PX and frame["x"] + frame["width"] >= TABLET["width"] - EDGE_PX
            else:
                assert frame["y"] + frame["height"] >= PHONE["height"] - EDGE_PX
            page.keyboard.press("Escape")
            ui(page, lambda: (hidden(sheet), must(has_focus(rooms_button(page, "Kitchen")), "focus not back on Kitchen")))
        room_shape(page, "Living").click()
        sheet = inspector(page, False)
        ui(page, lambda: visible(sheet.get_by_role("heading", name="Living", exact=True)))
        page.keyboard.press("Escape")
        ui(page, lambda: (hidden(sheet), must(has_focus(rooms_button(page, "Living")), "focus not back on Living")))


def test_device_state_api(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    park(app_url, at(day, 12, 0))
    with listen(app_url) as socket_:
        start = set_device(app_url, "kitchen-lights", {"on": False})
        lit = set_device(app_url, "kitchen-lights", {"brightness": 55})
        assert lit["state"] == {"on": True, "brightness": 55} and lit["revision"] == start["revision"] + 1
        dark = set_device(app_url, "kitchen-lights", {"on": False})
        assert dark["state"] == {"on": False, "brightness": 55} and dark["revision"] == lit["revision"] + 1
        socket_.wait(lambda m: m.get("type") == "device" and m["device"]["id"] == "kitchen-lights"
                     and m["device"]["revision"] == dark["revision"], CHANGE_PUSH_S + NETWORK_SLACK_S)
        plug = set_device(app_url, "kettle-plug", {"on": True})
        assert plug["state"] == {"on": True}
        thermostat = device(app_url, "living-thermostat")
        changed = set_device(app_url, "living-thermostat", {"setpoint_f": SETPOINT_MAX})
        assert changed["state"]["setpoint_f"] == SETPOINT_MAX and changed["state"]["current_f"] == thermostat["state"]["current_f"]
    bad = [
        ("kitchen-lights", {"brightness": 0}, "brightness", FIELD_DEVICE_BRIGHTNESS),
        ("kitchen-lights", {"brightness": 101}, "brightness", FIELD_DEVICE_BRIGHTNESS),
        ("kitchen-lights", {"on": "yes"}, "on", FIELD_ON),
        ("kettle-plug", {"brightness": 5}, "brightness", FIELD_NO_SETTING),
        ("living-thermostat", {"setpoint_f": SETPOINT_MIN - 1}, "setpoint_f", FIELD_SETPOINT),
        ("living-thermostat", {"setpoint_f": SETPOINT_MAX + 1}, "setpoint_f", FIELD_SETPOINT),
    ]
    for device_id, body, field, message in bad:
        before = device(app_url, device_id)
        expect_field(put_json(app_url, f"/api/devices/{device_id}/state", body), field, message)
        assert device(app_url, device_id)["revision"] == before["revision"]
    camera = expect_error(put_json(app_url, "/api/devices/hall-camera/state", {"on": True}), 422, "invalid")
    assert FIELD_NO_SETTING in camera["fields"].values()
    expect_error(put_json(app_url, "/api/devices/attic-light/state", {"on": True}), 404, "not_found")
    try:
        report(app_url, "kitchen-lights", {"online": False})
        before = device(app_url, "kitchen-lights")
        expect_error(put_json(app_url, "/api/devices/kitchen-lights/state", {"on": True}), 409, "device_offline",
                     "Kitchen lights is offline. Nothing was changed.")
        after = device(app_url, "kitchen-lights")
        assert (after["state"], after["revision"]) == (before["state"], before["revision"])
    finally:
        report(app_url, "kitchen-lights", {"online": True})


def test_device_sheet_controls(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    park(app_url, at(day, 12, 0))
    set_device(app_url, "living-thermostat", {"setpoint_f": 70})
    try:
        with opened(browser, f"{app_url}/plan") as page:
            plan_ready(page)
            click(rooms_button(page, "Living"))
            opener = inspector(page, True).get_by_role("button", name=details("Living thermostat"))
            ui(page, lambda: visible(opener))
            press_on(page, opener)
            sheet = page.get_by_role("dialog", name="Living thermostat")
            ui(page, lambda: (visible(sheet), must(holds_focus(sheet), "focus not inside")))
            setpoint = sheet.get_by_role("spinbutton", name="Setpoint")
            ui(page, lambda: must(value_of(setpoint) == "70"))
            contains(sheet, "Online")
            contains(sheet, re.compile(r"Last report \d\d:\d\d:\d\d"))
            set_device(app_url, "living-thermostat", {"setpoint_f": 72})
            ui(page, lambda: must(value_of(setpoint) == str(72), value_of(setpoint)))
            report(app_url, "living-thermostat", {"online": False})
            ui(page, lambda: contains(sheet, "Offline"))
            report(app_url, "living-thermostat", {"online": True})
            ui(page, lambda: contains(sheet, "Online"))
            setpoint.focus()
            page.keyboard.press("ArrowUp")
            poll(lambda: device(app_url, "living-thermostat")["state"]["setpoint_f"] == 73, UI_WAIT_S, "setpoint 73 on the server")
            page.keyboard.press("Escape")
            ui(page, lambda: (hidden(sheet), must(has_focus(opener), "focus not back on the opener")))
            click(rooms_button(page, "Kitchen"))
            for name, power, brightness in (("Kitchen lights", 1, 1), ("Kettle plug", 1, 0)):
                opener = inspector(page, True).get_by_role("button", name=f"Details for {name}")
                press_on(page, opener)
                sheet = page.get_by_role("dialog", name=name)
                ui(page, lambda s=sheet: visible(s))
                expect(sheet.get_by_role("switch", name="Power")).to_have_count(power)
                expect(sheet.get_by_role("slider", name="Brightness")).to_have_count(brightness)
                page.keyboard.press("Escape")
                ui(page, lambda s=sheet: hidden(s))
            click(rooms_button(page, "Hall"))
            press_on(page, inspector(page, True).get_by_role("button", name=details("Hall camera")))
            sheet = page.get_by_role("dialog", name="Hall camera")
            ui(page, lambda: visible(sheet))
            expect(sheet.get_by_role("switch", name="Power")).to_have_count(0)
    finally:
        report(app_url, "living-thermostat", {"online": True})


def test_refused_toggle_rolls_back(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 12, 0))

    def forward(route: Any) -> None:
        server = route.connect_to_server()

        def relay(message: Any) -> None:
            try:
                payload = json.loads(message)
            except (TypeError, ValueError):
                payload = {}
            if not (payload.get("type") == "device" and payload.get("device", {}).get("id") == "porch-light"):
                route.send(message)

        server.on_message(relay)
        route.on_message(lambda message: server.send(message))

    try:
        with opened(browser, f"{app_url}/plan") as page:
            page.route_web_socket(re.compile(r".*/api/socket$"), forward)
            page.reload()
            plan_ready(page)
            click(rooms_button(page, "Porch"))
            switch = inspector(page, True).get_by_role("switch", name="Porch light")
            ui(page, lambda: visible(switch))
            report(app_url, "porch-light", {"online": False})
            before = device(app_url, "porch-light")
            was = switch.is_checked()
            flip(switch)
            ui(page, lambda: contains(inspector(page, True).get_by_role("alert"), "Porch light is offline. Nothing was changed."))
            ui(page, lambda: must(switch.is_checked() == was, "the switch did not roll back"))
            after = device(app_url, "porch-light")
            assert (after["state"], after["revision"]) == (before["state"], before["revision"])
    finally:
        report(app_url, "porch-light", {"online": True})


def test_newest_device_action_wins(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    park(app_url, at(day, 12, 0))
    set_device(app_url, "kitchen-lights", {"on": True})
    with opened(browser, f"{app_url}/plan") as page:
        plan_ready(page)
        click(rooms_button(page, "Kitchen"))
        side = inspector(page, True)
        switch = side.get_by_role("switch", name="Kitchen lights")
        ui(page, lambda: must(switch.is_checked(), "starts on"))
        with held(page, glob(device_path("kitchen-lights"))) as gate:
            flip(switch)
            ui(page, lambda: (must(not switch.is_checked(), "flips at once"), visible(side.get_by_text(SENDING_COPY))))
            flip(switch)
            flip(switch)
            gate.release()
        poll(lambda: device(app_url, "kitchen-lights")["state"]["on"] is False, UI_WAIT_S, "server ends off")
        advance(page, SETTLE_MS)
        ui(page, lambda: must(not switch.is_checked(), "screen ends off"))
        assert device(app_url, "kitchen-lights")["state"]["on"] is False

        rev = device(app_url, "kitchen-lights")["revision"]
        press_on(page, side.get_by_role("button", name=details("Kitchen lights")))
        sheet = page.get_by_role("dialog", name="Kitchen lights")
        ui(page, lambda: visible(sheet))
        flip(sheet.get_by_role("switch", name="Power"))
        poll(lambda: device(app_url, "kitchen-lights")["state"]["on"] is True, UI_WAIT_S, "sheet turned it on")
        page.keyboard.press("Escape")
        advance(page, FRAME_MS)
        flip(switch)
        advance(page, SETTLE_MS)
        poll(lambda: device(app_url, "kitchen-lights")["revision"] >= rev + 2, UI_WAIT_S, "both changes applied")
        assert device(app_url, "kitchen-lights")["state"]["on"] is False
        ui(page, lambda: must(not switch.is_checked(), "screen ends on the last choice"))


def test_scenes_drive_devices(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    set_clock(app_url, at(day, 8, 29, 35))
    wait_hub(app_url, at(day, 8, 29, 38))
    guest_ids: list[str] = []
    try:
        set_device(app_url, "kitchen-lights", {"on": False})
        set_device(app_url, "living-thermostat", {"setpoint_f": 75})
        plug = set_device(app_url, "kettle-plug", {"on": True})
        camera = device(app_url, "hall-camera")
        assert report(app_url, "study-lamp", {"online": False}).status_code == 200
        lamp = device(app_url, "study-lamp")
        poll(lambda: device(app_url, "kitchen-lights")["state"] == {"on": True, "brightness": DAY_SCENE_BRIGHTNESS},
             UI_WAIT_S, "the 08:30 Day scene on Kitchen lights")
        assert device(app_url, "living-lamp")["state"] == {"on": True, "brightness": DAY_SCENE_BRIGHTNESS}
        assert device(app_url, "living-thermostat")["state"]["setpoint_f"] == DAY_SCENE_SETPOINT
        after_plug = device(app_url, "kettle-plug")
        assert (after_plug["state"], after_plug["revision"]) == (plug["state"], plug["revision"])
        assert device(app_url, "hall-camera")["revision"] == camera["revision"]
        after_lamp = device(app_url, "study-lamp")
        assert (after_lamp["state"], after_lamp["revision"]) == (lamp["state"], lamp["revision"])

        dark = create_scene(app_url, 0, None)
        set_device(app_url, "bath-light", {"brightness": 66})
        set_device(app_url, "nursery-thermostat", {"setpoint_f": 72})
        nursery_thermostat = device(app_url, "nursery-thermostat")
        for room in ("bath", "nursery"):
            response = create_guest(app_url, room, dark["id"], None, wall(at(day, 11, 0)))
            assert response.status_code == 201, response.text
            guest_ids.append(response.json()["guest_scene"]["id"])
        poll(lambda: device(app_url, "bath-light")["state"] == {"on": False, "brightness": 66}, UI_WAIT_S, "bath light off at its level")
        poll(lambda: device(app_url, "nursery-light")["state"]["on"] is False, UI_WAIT_S, "nursery light off")
        after = device(app_url, "nursery-thermostat")
        assert (after["state"]["setpoint_f"], after["revision"]) == (72, nursery_thermostat["revision"])
    finally:
        report(app_url, "study-lamp", {"online": True})
        cancel_quietly(app_url, guest_ids)


def test_fall_back_and_spring_forward_timelines(browser: Browser, app_url: str) -> None:
    plan = get_json(app_url, f"/api/plan?day={FALL_BACK.isoformat()}")
    assert plan["hours"] == 25 and plan["start"] == iso(at(FALL_BACK, 0, 0))
    assert plan["end"] == iso(at(FALL_BACK + timedelta(days=1), 0, 0))
    ones = [m["abbr"] for m in plan["hour_marks"] if m["label"] == "01"]
    assert ones == ["CDT", "CST"] and len(plan["hour_marks"]) == 25
    spring = get_json(app_url, f"/api/plan?day={SPRING_FORWARD.isoformat()}")
    assert spring["hours"] == 23 and "02" not in [m["label"] for m in spring["hour_marks"]]
    with opened(browser, plan_url(app_url, FALL_BACK, "00:00-05:00")) as page:
        plan_ready(page)
        region = page.get_by_role("region", name="Day and time")
        ui(page, lambda: contains(region, "Sunday 1 November 2026 · 25 hours"))
        assert slider_bound(slider(page), "aria-valuemax", "max") == FALL_BACK_MIN
        visible(region.get_by_text("01 CDT", exact=True))
        visible(region.get_by_text("01 CST", exact=True))
        page.goto(plan_url(app_url, SPRING_FORWARD, "00:00-06:00"))
        ui(page, lambda: contains(region, "Sunday 14 March 2027 · 23 hours"))
        assert slider_bound(slider(page), "aria-valuemax", "max") == SPRING_MIN
        expect(region.get_by_text("02", exact=True)).to_have_count(0)
        page.goto(plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET))
        ui(page, lambda: must(slider_bound(slider(page), "aria-valuemax", "max") == DAY_MIN))
        assert not re.search(r"· \d+ hours", region.inner_text()), region.inner_text()


def test_repeated_hour_runs_once(browser: Browser, app_url: str) -> None:
    plan = get_json(app_url, f"/api/plan?day={FALL_BACK.isoformat()}")
    night = [c for c in plan["changes"] if c["source"] == "schedule" and c["slot_time"] == "01:30"]
    assert [(c["at"], sorted(c["room_ids"])) for c in night] == [("2026-11-01T01:30:00-05:00", sorted(ROOM_IDS))]
    assert set(owners_at(plan, at(FALL_BACK, 1, 45, fold=1)).values()) == {"night-low"}
    with opened(browser, plan_url(app_url, FALL_BACK, "01:45-06:00")) as page:
        ui(page, lambda: must(plan_names(page) == {r: "Night low" for r in ROOM_NAMES}, str(plan_names(page))))
        assert at_line("Hall", "Night low", "01:30 CDT") in at_list(page)

    def runs() -> list:
        return [r for r in get_json(app_url, f"/api/runs?day={FALL_BACK.isoformat()}")["runs"]
                if r["slot_time"] == "01:30" and r["schedule_id"] == "weekend"]

    set_clock(app_url, at(FALL_BACK, 1, 29, 56))
    poll(runs, STATUS_HEARTBEAT_S, "the first-pass run")
    set_clock(app_url, at(FALL_BACK, 1, 29, 56, fold=1))
    wait_hub(app_url, at(FALL_BACK, 1, 30, 4, fold=1))
    recorded = runs()
    assert len(recorded) == 1 and parse(recorded[0]["ran_at"]).utcoffset() == timedelta(hours=-5)


def test_skipped_hour_runs_at_three(browser: Browser, app_url: str) -> None:
    schedule = get_json(app_url, "/api/schedules/weekend")["schedule"]
    existing = [v for v in schedule["versions"] if v["from"] == SPRING_FORWARD.isoformat()]
    if not (existing and any(s["time"] == SKIPPED_SLOT for s in existing[0]["slots"])):
        park(app_url, at(SPRING_FORWARD - timedelta(days=4), 12, 0))
        slots = [{"time": t, "scene_id": s, "room_ids": list(r)} for t, s, r in WEEKEND_SEED]
        slots.append({"time": SKIPPED_SLOT, "scene_id": "day", "room_ids": ["study"]})
        saved = put_json(app_url, "/api/schedules/weekend",
                         {"revision": schedule["revision"], "from": SPRING_FORWARD.isoformat(), "slots": slots})
        assert saved.status_code == 200, saved.text
    plan = get_json(app_url, f"/api/plan?day={SPRING_FORWARD.isoformat()}")
    moved = [c for c in plan["changes"] if c["slot_time"] == SKIPPED_SLOT]
    assert [(c["at"], c["room_ids"]) for c in moved] == [(iso(at(SPRING_FORWARD, 3, 0)), ["study"])]
    assert "03:00" in moved[0]["local"]
    with opened(browser, plan_url(app_url, SPRING_FORWARD, "03:00-05:00")) as page:
        ui(page, lambda: must(plan_names(page).get("Study") == "Day", str(plan_names(page))))
        page.goto(plan_url(app_url, SPRING_FORWARD, "01:45-06:00"))
        ui(page, lambda: must(plan_names(page).get("Study") == "Night low", str(plan_names(page))))

    def runs() -> list:
        return [r for r in get_json(app_url, f"/api/runs?day={SPRING_FORWARD.isoformat()}")["runs"] if r["slot_time"] == SKIPPED_SLOT]

    set_clock(app_url, at(SPRING_FORWARD, 1, 59, 56))
    found = poll(runs, STATUS_HEARTBEAT_S, "the 02:15 run")
    assert len(found) == 1
    ran = parse(found[0]["ran_at"])
    assert at(SPRING_FORWARD, 3, 0) <= ran <= at(SPRING_FORWARD, 3, 0) + timedelta(seconds=NETWORK_SLACK_S)


def test_run_ledger(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    set_clock(app_url, at(day, 8, 0))
    set_clock(app_url, at(day, 9, 0))
    wait_hub(app_url, at(day, 9, 0, 3))

    def runs(slot: str) -> list:
        return [r for r in get_json(app_url, f"/api/runs?day={day.isoformat()}")["runs"]
                if r["slot_time"] == slot and r["schedule_id"] == "weekday"]

    assert runs("08:30") == [], "a clock move recorded a skipped occurrence"
    set_clock(app_url, at(day, 17, 29, 55))
    found = poll(lambda: runs("17:30"), STATUS_HEARTBEAT_S, "the 17:30 run")
    run = found[0]
    assert run["scene_id"] == "evening" and sorted(run["room_ids"]) == sorted(["hall", "kitchen", "living", "porch"])
    assert at(day, 17, 30) <= parse(run["ran_at"]) <= at(day, 17, 30) + timedelta(seconds=NETWORK_SLACK_S)
    set_clock(app_url, at(day, 17, 29, 55))
    wait_hub(app_url, at(day, 17, 30, 4))
    assert len(runs("17:30")) == 1
    listed = get_json(app_url, f"/api/runs?day={day.isoformat()}")
    assert listed["day"] == day.isoformat()
    assert [r["ran_at"] for r in listed["runs"]] == sorted((r["ran_at"] for r in listed["runs"]), key=parse)
    expect_field(call(app_url, "GET", "/api/runs?day=someday"), "day", FIELD_DAY)


def test_household_day_boundaries(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    set_clock(app_url, at(day, 22, 14, 56))
    poll(lambda: any(r["slot_time"] == "22:15" for r in get_json(app_url, f"/api/runs?day={day.isoformat()}")["runs"]),
         STATUS_HEARTBEAT_S, "the 22:15 run")
    nxt = day + timedelta(days=1)
    assert not any(r["slot_time"] == "22:15" and parse(r["ran_at"]).date() == day
                   for r in get_json(app_url, f"/api/runs?day={nxt.isoformat()}")["runs"])
    late = announce(app_url, "porch-camera", random_clip_time(day, 23), clip_size())
    early = announce(app_url, "porch-camera", random_clip_time(nxt, 0), clip_size())
    assert late["day"] == day.isoformat() and early["day"] == nxt.isoformat()
    ids_today = [c["id"] for c in get_json(app_url, f"/api/clips?day={day.isoformat()}")["clips"]]
    ids_next = [c["id"] for c in get_json(app_url, f"/api/clips?day={nxt.isoformat()}")["clips"]]
    assert late["id"] in ids_today and early["id"] not in ids_today and early["id"] in ids_next
    assert get_json(app_url, "/api/runs")["day"] == day.isoformat()
    assert get_json(app_url, "/api/clips")["day"] == day.isoformat()
    assert get_json(app_url, "/api/status")["day"] == day.isoformat()


def test_day_log_page(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    set_clock(app_url, at(day, 8, 29, 56))
    poll(lambda: any(r["slot_time"] == "08:30" for r in get_json(app_url, f"/api/runs?day={day.isoformat()}")["runs"]),
         STATUS_HEARTBEAT_S, "the 08:30 run")
    park(app_url, at(day, 12, 0))
    recorded = random_clip_time(day, 9)
    size = clip_size()
    new = announce(app_url, "porch-camera", recorded, size)
    with opened(browser, f"{app_url}/log") as page:
        ui(page, lambda: visible(page.get_by_role("heading", name="Today", exact=True)))
        ui(page, lambda: (expect(page.get_by_role("textbox", name="Log day")).to_have_value(day.isoformat(), timeout=EXPECT_MS),
                          contains(page.get_by_role("list", name="Runs"), "08:30 Day · 3 rooms · Weekday")))
        button = page.get_by_role("list", name="Clips").get_by_role("button", name=clip_label("Porch camera", recorded))
        row = clip_row(page, clip_label("Porch camera", recorded))
        ui(page, lambda: contains(row, STORING_COPY))
        mark_page(page)
        assert send_bytes(app_url, new["id"], os.urandom(size)).status_code == 200
        ui(page, lambda: contains(row, f"{size} bytes"), seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
        assert still_marked(page)
        click(page.get_by_role("button", name="Previous day"))
        ui(page, lambda: visible(page.get_by_role("heading", name=long_date(day - timedelta(days=1)))))
        ui(page, lambda: expect(button).to_have_count(0, timeout=EXPECT_MS))
        click(page.get_by_role("button", name="Next day"))
        ui(page, lambda: visible(page.get_by_role("heading", name="Today", exact=True)))


def test_effective_dated_versions(app_url: str) -> None:
    monday = pick(VERSION_MONDAY, VERSION_WEEKS)
    park(app_url, at(monday - timedelta(days=5), 12, 0))
    schedule = get_json(app_url, "/api/schedules/weekday")["schedule"]
    first = [{"time": FIRST_PROBE_SLOT, "scene_id": "wake", "room_ids": ["hall"]}]
    second = [{"time": SECOND_PROBE_SLOT, "scene_id": "day", "room_ids": ["study", "hall"]}]
    saved = put_json(app_url, "/api/schedules/weekday", {"revision": schedule["revision"], "from": monday.isoformat(), "slots": first})
    assert saved.status_code == 200, saved.text
    assert saved.json()["schedule"]["revision"] == schedule["revision"] + 1
    again = put_json(app_url, "/api/schedules/weekday", {"revision": schedule["revision"] + 1, "from": monday.isoformat(), "slots": second})
    assert again.status_code == 200, again.text
    result = again.json()["schedule"]
    assert result["revision"] == schedule["revision"] + 2
    mine = [v for v in result["versions"] if v["from"] == monday.isoformat()]
    assert len(mine) == 1 and [(s["time"], s["scene_id"], sorted(s["room_ids"])) for s in mine[0]["slots"]] == [(SECOND_PROBE_SLOT, "day", ["hall", "study"])]
    assert all(s["id"] for s in mine[0]["slots"])
    assert [v["from"] for v in result["versions"]] == sorted(v["from"] for v in result["versions"])
    on_day = get_json(app_url, f"/api/plan?day={monday.isoformat()}")
    assert {c["version_from"] for c in on_day["changes"] if c["source"] == "schedule"} == {monday.isoformat()}
    assert [c["slot_time"] for c in on_day["changes"] if c["source"] == "schedule"] == [SECOND_PROBE_SLOT]
    friday = get_json(app_url, f"/api/plan?day={(monday - timedelta(days=3)).isoformat()}")
    assert all(c["version_from"] != monday.isoformat() for c in friday["changes"] if c["source"] == "schedule")


def test_from_date_rules(app_url: str) -> None:
    today = pick(VERSION_MONDAY, VERSION_WEEKS, 2)
    park(app_url, at(today, 23, 30))
    slots = [{"time": t, "scene_id": s, "room_ids": list(r)} for t, s, r in WEEKDAY_SEED]

    def save(frm: str) -> httpx.Response:
        revision = get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"]
        return put_json(app_url, "/api/schedules/weekday", {"revision": revision, "from": frm, "slots": slots})

    revision = get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"]
    expect_field(save("09/11/2026"), "from", FIELD_FROM_FORMAT)
    expect_field(save((today - timedelta(days=1)).isoformat()), "from", FIELD_FROM_PAST)
    expect_field(save((today + timedelta(days=FROM_MAX_DAYS + 1)).isoformat()), "from", FIELD_FROM_FAR)
    assert get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"] == revision
    assert save(today.isoformat()).status_code == 200
    assert save((today + timedelta(days=FROM_MAX_DAYS)).isoformat()).status_code == 200


def test_schedule_api_validation(app_url: str) -> None:
    today = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(today, 12, 0))
    schedule = get_json(app_url, "/api/schedules/weekend")["schedule"]
    base = {"revision": schedule["revision"], "from": today.isoformat()}
    cases = [
        ({"slots": []}, "slots", FIELD_SLOTS),
        ({"slots": [{"time": "25:00", "scene_id": "wake", "room_ids": ["hall"]}]}, "slots.0.time", FIELD_SLOT_TIME),
        ({"slots": [{"time": "06:00", "scene_id": "nope", "room_ids": ["hall"]}]}, "slots.0.scene_id", FIELD_CHOOSE_SCENE),
        ({"slots": [{"time": "06:00", "scene_id": "wake", "room_ids": []}]}, "slots.0.room_ids", FIELD_SLOT_ROOMS),
    ]
    for extra, field, message in cases:
        expect_field(put_json(app_url, "/api/schedules/weekend", {**base, **extra}), field, message)
    answer = put_json(app_url, "/api/schedules/weekend", {**base, "revision": "latest",
                                                          "slots": [{"time": "06:00", "scene_id": "wake", "room_ids": ["hall"]}]})
    if answer.status_code == 409:
        expect_error(answer, 409, "schedule_changed")
    else:
        expect_field(answer, "revision", FIELD_REVISION)
    shared = expect_error(put_json(app_url, "/api/schedules/weekend", {**base, "slots": [
        {"time": "06:00", "scene_id": "wake", "room_ids": ["hall"]},
        {"time": "06:00", "scene_id": "day", "room_ids": ["hall"]}]}), 422, "invalid")
    assert any(re.fullmatch(r"slots\.\d\.time", k) and v == FIELD_SLOT_SHARED for k, v in shared["fields"].items()), shared
    assert get_json(app_url, "/api/schedules/weekend")["schedule"]["revision"] == schedule["revision"]


def test_schedule_editor_sheet(browser: Browser, app_url: str) -> None:
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    schedule, version = weekend_in_force(app_url, saturday)
    new_time = early_slot(1 + secrets.randbelow(29))
    with opened(browser, f"{app_url}/schedules") as page:
        ui(page, lambda: visible(page.get_by_role("tab", name="Weekend")))
        click(page.get_by_role("tab", name="Weekend"))
        ui(page, lambda: visible(page.get_by_role("button", name=edit_name("Weekend"))))
        click(page.get_by_role("button", name=edit_name("Weekend")))
        editor = page.get_by_role("dialog", name=edit_name("Weekend"))
        ui(page, lambda: visible(editor))
        start = editor.get_by_role("textbox", name="From")
        count = len(version["slots"])
        ui(page, lambda: (expect(start).to_have_value(saturday.isoformat(), timeout=EXPECT_MS),
                          expect(slot_groups(editor)).to_have_count(count, timeout=EXPECT_MS)))
        click(editor.get_by_role("button", name="Add slot"))
        ui(page, lambda: visible(editor.get_by_role("group", name=f"Slot {count + 1}")))
        click(editor.get_by_role("button", name=f"Remove slot {count + 1}"))
        ui(page, lambda: expect(slot_groups(editor)).to_have_count(count, timeout=EXPECT_MS))
        fill(start, (saturday - timedelta(days=1)).isoformat())
        click(editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"), MESSAGES["invalid"]))
        visible(editor.get_by_text(FIELD_FROM_PAST))
        fill(start, saturday.isoformat())
        fill(slot_group(editor, 1).get_by_role("textbox", name="Time"), new_time)
        with held(page, glob("/api/schedules/weekend")) as gate:
            click(editor.get_by_role("button", name="Save schedule"))
            ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"), SAVING_SCHEDULE))
            gate.release()
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"),
                               f"Saved. Weekend slots change from {long_date(saturday)}."))
        saved = get_json(app_url, "/api/schedules/weekend")["schedule"]
        assert saved["revision"] == schedule["revision"] + 1
        mine = [v for v in saved["versions"] if v["from"] == saturday.isoformat()][0]
        assert new_time in [s["time"] for s in mine["slots"]]
        page.keyboard.press("Escape")
        ui(page, lambda: contains(page.get_by_role(TABPANEL), f"From {long_date(saturday)}"))
        contains(page.get_by_role(TABPANEL), new_time)


def test_schedule_saves_one_winner(app_url: str) -> None:
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    revision = get_json(app_url, "/api/schedules/weekend")["schedule"]["revision"]
    seed = [{"time": t, "scene_id": s, "room_ids": list(r)} for t, s, r in WEEKEND_SEED]
    bodies = [{"revision": revision, "from": saturday.isoformat(),
               "slots": seed + [{"time": early_slot(i + 1), "scene_id": "day", "room_ids": ["study"]}]} for i in range(5)]
    barrier = threading.Barrier(len(bodies))

    def save(body: dict) -> httpx.Response:
        barrier.wait()
        return put_json(app_url, "/api/schedules/weekend", body)

    with ThreadPoolExecutor(len(bodies)) as pool:
        responses = list(pool.map(save, bodies))
    winners = [i for i, r in enumerate(responses) if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in responses]
    for i, response in enumerate(responses):
        if i not in winners:
            expect_error(response, 409, "schedule_changed")
    stored = get_json(app_url, "/api/schedules/weekend")["schedule"]
    assert stored["revision"] == revision + 1
    mine = [v for v in stored["versions"] if v["from"] == saturday.isoformat()][0]
    winner_time = bodies[winners[0]]["slots"][-1]["time"]
    assert winner_time in [s["time"] for s in mine["slots"]]
    assert not {b["slots"][-1]["time"] for b in bodies} - {winner_time} & {s["time"] for s in mine["slots"]}
    expect_error(put_json(app_url, "/api/schedules/weekend", bodies[0]), 409, "schedule_changed")
    assert get_json(app_url, "/api/schedules/weekend")["schedule"]["revision"] == revision + 1


def test_scene_catalogue_api(app_url: str) -> None:
    scenes = get_json(app_url, "/api/scenes")["scenes"]
    assert [(s["id"], s["name"]) for s in scenes[: len(SCENES)]] == SCENES
    assert scenes[0] == {"id": "wake", "name": "Wake", "tint": "amber", "brightness": 70, "setpoint_f": 70}
    name = f"Reading {secrets.token_hex(4)}"
    created = post_json(app_url, "/api/scenes", {"name": name, "tint": "rose", "brightness": 0, "setpoint_f": None})
    assert created.status_code == 201, created.text
    scene = created.json()["scene"]
    assert (scene["name"], scene["tint"], scene["brightness"], scene["setpoint_f"]) == (name, "rose", 0, None)
    listed = [s["id"] for s in get_json(app_url, "/api/scenes")["scenes"]]
    assert listed.index(scene["id"]) >= len(SCENES)
    changed = put_json(app_url, f"/api/scenes/{scene['id']}", {"name": name, "tint": "candle", "brightness": 100, "setpoint_f": SETPOINT_MAX})
    assert changed.status_code == 200 and changed.json()["scene"]["tint"] == "candle"
    good = {"name": f"Other {secrets.token_hex(4)}", "tint": "dusk", "brightness": 10, "setpoint_f": SETPOINT_MIN}
    cases = [
        ({"name": ""}, "name", FIELD_SCENE_NAME),
        ({"name": "x" * (SCENE_NAME_MAX + 1)}, "name", FIELD_SCENE_NAME),
        ({"name": "Wake"}, "name", FIELD_SCENE_TAKEN),
        ({"tint": "teal"}, "tint", FIELD_TINT),
        ({"brightness": 101}, "brightness", FIELD_SCENE_BRIGHTNESS),
        ({"brightness": -1}, "brightness", FIELD_SCENE_BRIGHTNESS),
        ({"setpoint_f": SETPOINT_MAX + 1}, "setpoint_f", FIELD_SETPOINT),
    ]
    for extra, field, message in cases:
        expect_field(post_json(app_url, "/api/scenes", {**good, **extra}), field, message)
    assert good["name"] not in [s["name"] for s in get_json(app_url, "/api/scenes")["scenes"]]
    expect_field(put_json(app_url, f"/api/scenes/{scene['id']}", {**good, "name": "Day"}), "name", FIELD_SCENE_TAKEN)
    expect_error(put_json(app_url, "/api/scenes/no-such-scene", good), 404, "not_found")


def test_scene_sheet(browser: Browser, app_url: str) -> None:
    name = f"Hearth {secrets.token_hex(4)}"
    with opened(browser, f"{app_url}/scenes") as page:
        click(page.get_by_role("button", name="New scene"))
        sheet = page.get_by_role("dialog", name="New scene")
        ui(page, lambda: visible(sheet))
        fill(sheet.get_by_role("textbox", name="Scene name"), "Wake")
        choose(sheet.get_by_role("radio", name="Honey"))
        fill(sheet.get_by_role("spinbutton", name="Brightness"), "33")
        fill(sheet.get_by_role("spinbutton", name="Setpoint"), "")
        click(sheet.get_by_role("button", name="Create scene"))
        ui(page, lambda: shows(sheet.get_by_role("status", name="Scene save"), MESSAGES["invalid"]))
        visible(sheet.get_by_text(FIELD_SCENE_TAKEN))
        fill(sheet.get_by_role("textbox", name="Scene name"), name)
        with held(page, glob("/api/scenes")) as gate:
            click(sheet.get_by_role("button", name="Create scene"))
            ui(page, lambda: shows(sheet.get_by_role("status", name="Scene save"), CREATING_SCENE))
            gate.release()
        ui(page, lambda: shows(sheet.get_by_role("status", name="Scene save"), SCENE_CREATED))
        record = next(s for s in get_json(app_url, "/api/scenes")["scenes"] if s["name"] == name)
        assert (record["tint"], record["brightness"], record["setpoint_f"]) == ("honey", 33, None)
        page.keyboard.press("Escape")
        ui(page, lambda: contains(page.get_by_role("list", name="Scenes"), name))
        click(page.get_by_role("button", name=f"Edit {name}"))
        edit = page.get_by_role("dialog", name=f"Edit {name}")
        ui(page, lambda: visible(edit))
        fill(edit.get_by_role("spinbutton", name="Brightness"), "55")
        with held(page, glob("/api/scenes/*")) as gate:
            click(edit.get_by_role("button", name="Save scene"))
            ui(page, lambda: shows(edit.get_by_role("status", name="Scene save"), SAVING_SCENE))
            gate.release()
        ui(page, lambda: shows(edit.get_by_role("status", name="Scene save"), SCENE_SAVED))
        assert next(s for s in get_json(app_url, "/api/scenes")["scenes"] if s["id"] == record["id"])["brightness"] == 55


def test_guest_scene_states(app_url: str) -> None:
    day = next(d for d in (pick(LIVE_MONDAY, LIVE_WEEKS, 1) for _ in range(200))
               if offset_of(at(d, 12, 0)) == offset_of(at(d + timedelta(days=GUEST_MAX_DAYS + 1), 12, 0)))
    park(app_url, at(day, 12, 0, 30))
    made: list[str] = []
    try:
        now_one = create_guest(app_url, "spare-room", "guest-welcome", None, wall(at(day, 13, 0)))
        assert now_one.status_code == 201, now_one.text
        active = now_one.json()["guest_scene"]
        made.append(active["id"])
        assert active["state"] == "active" and active["ends_at"] == iso(at(day, 13, 0))
        assert status_room(app_url, "spare-room")["source"] == "guest"
        expect_error(create_guest(app_url, "spare-room", "guest-welcome", None, wall(at(day, 12, 30))), 409, "guest_overlap",
                     "Spare room already has a guest scene at that time.")
        later = create_guest(app_url, "bath", "guest-welcome", wall(at(day, 12, 3)), wall(at(day, 16, 0)))
        assert later.status_code == 201 and later.json()["guest_scene"]["state"] == "scheduled"
        made.append(later.json()["guest_scene"]["id"])
        set_clock(app_url, at(day, 12, 2, 57))
        poll(lambda: guest(app_url, made[1])["state"] == "active", NETWORK_SLACK_S * 3, "scheduled guest to activate")
        cancelled = post_json(app_url, f"/api/guest-scenes/{made[1]}/cancel", {})
        assert cancelled.status_code == 200 and cancelled.json()["guest_scene"]["state"] == "cancelled"
        assert cancelled.json()["guest_scene"]["cancelled_at"]
        expect_error(post_json(app_url, f"/api/guest-scenes/{made[1]}/cancel", {}), 409, "guest_scene_closed")
        future = create_guest(app_url, "study", "guest-welcome", wall(at(day, 18, 0)), wall(at(day, 19, 0)))
        made.append(future.json()["guest_scene"]["id"])
        assert post_json(app_url, f"/api/guest-scenes/{made[2]}/cancel", {}).json()["guest_scene"]["state"] == "cancelled"
        longest = create_guest(app_url, "porch", "guest-welcome", wall(at(day, 20, 0)), wall(at(day + timedelta(days=GUEST_MAX_DAYS), 20, 0)))
        assert longest.status_code == 201, longest.text
        made.append(longest.json()["guest_scene"]["id"])
        cases = [
            (("hall", "guest-welcome", wall(at(day, 11, 0)), wall(at(day, 14, 0))), "starts_at", FIELD_START_PAST),
            (("hall", "guest-welcome", wall(at(day, 15, 0)), wall(at(day, 15, 0))), "ends_at", FIELD_END_ORDER),
            (("hall", "guest-welcome", wall(at(day, 15, 0)), wall(at(day + timedelta(days=GUEST_MAX_DAYS), 15, 1))), "ends_at", FIELD_END_LONG),
            (("hall", "guest-welcome", "tomorrow", wall(at(day, 15, 0))), "starts_at", FIELD_WALL),
            (("cellar", "guest-welcome", None, wall(at(day, 15, 0))), "room_id", FIELD_CHOOSE_ROOM),
            (("hall", "no-scene", None, wall(at(day, 15, 0))), "scene_id", FIELD_CHOOSE_SCENE),
        ]
        for args, field, message in cases:
            expect_field(create_guest(app_url, *args), field, message)
        park(app_url, at(SPRING_FORWARD, 0, 30))
        expect_field(create_guest(app_url, "hall", "guest-welcome", None, f"{SPRING_FORWARD.isoformat()}T02:30"), "ends_at", FIELD_SKIPPED)
    finally:
        cancel_quietly(app_url, made)


def test_guest_scene_ends_on_server(app_url: str, mail: Any) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    park(app_url, at(day, 12, 0, 30))
    end = at(day, 12, 2)
    response = create_guest(app_url, "spare-room", "guest-welcome", None, wall(end))
    assert response.status_code == 201, response.text
    guest_id = response.json()["guest_scene"]["id"]
    try:
        with listen(app_url) as socket_:
            set_clock(app_url, end - timedelta(seconds=4))
            samples: list[tuple[datetime, str]] = []

            def sampled() -> bool:
                status = get_json(app_url, "/api/status")
                room = next(r for r in status["rooms"] if r["room_id"] == "spare-room")
                samples.append((parse(status["now"]), room["source"]))
                return samples[-1][0] >= end + timedelta(seconds=GUEST_END_LAG_S + 1)

            poll(sampled, UI_WAIT_S, "the hub to pass the guest end")
            before = [s for n, s in samples if n < end]
            after = [s for n, s in samples if n >= end]
            assert before and all(s == "guest" for s in before), samples
            assert after and all(s != "guest" for s in after), samples
            ended = guest(app_url, guest_id)
            assert ended["state"] == "ended"
            assert end <= parse(ended["ended_at"]) <= end + timedelta(seconds=GUEST_END_LAG_S)
            socket_.wait(lambda m: m.get("type") == "guest_scene" and m["guest_scene"]["id"] == guest_id
                         and m["guest_scene"]["state"] == "ended", NETWORK_SLACK_S)
            socket_.wait(lambda m: m.get("type") == "status" and any(
                r["room_id"] == "spare-room" and r["source"] == "schedule" for r in m["rooms"]), NETWORK_SLACK_S)
        scheduled = status_room(app_url, "spare-room")["scene_name"]
        expected = f"The guest scene Guest welcome in Spare room ended at 12:02 on {long_date(day)}. Spare room is back on {scheduled}."
        found = wait_mail(mail, lambda m: body_of(m) == expected, NOTICE_SEND_S + NETWORK_SLACK_S)
        assert_plain_notice(found[0], "Guest scene ended: Spare room")
        assert len(mail_matching(mail, lambda m: body_of(m) == expected, MAIL_SETTLE_S)) == 1
    finally:
        cancel_quietly(app_url, [guest_id])


def test_guest_request_replay(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    park(app_url, at(day, 12, 0))
    key = kit.idempotency_key()
    body = ("hall", "guest-welcome", wall(at(day, 14, 0)), wall(at(day, 15, 0)))
    first = create_guest(app_url, *body, key=key)
    assert first.status_code == 201, first.text
    guest_id = first.json()["guest_scene"]["id"]
    try:
        again = create_guest(app_url, *body, key=key)
        assert again.status_code == 201 and again.json() == first.json()
        mine = [g for g in get_json(app_url, "/api/guest-scenes")["guest_scenes"]
                if g["room_id"] == "hall" and g["starts_at"] == iso(at(day, 14, 0))]
        assert len(mine) == 1
        expect_error(create_guest(app_url, "hall", "guest-welcome", wall(at(day, 16, 0)), wall(at(day, 17, 0)), key=key),
                     409, "idempotency_conflict")
        assert len([g for g in get_json(app_url, "/api/guest-scenes")["guest_scenes"] if g["starts_at"] == iso(at(day, 16, 0)) and g["room_id"] == "hall"]) == 0
        expect_field(create_guest(app_url, "kitchen", "guest-welcome", None, wall(at(day, 13, 0)), key="k" * (KEY_MAX + 1)),
                     "Idempotency-Key", FIELD_KEY)
    finally:
        cancel_quietly(app_url, [guest_id])


def test_camera_clip_intake(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    recorded = random_clip_time(day, 23)
    size = clip_size()
    new = announce(app_url, "porch-camera", recorded, size)
    assert (new["state"], new["playable"], new["stored_size"], new["declared_size"]) == ("announced", False, None, size)
    assert (new["camera_id"], new["camera_name"], new["day"]) == ("porch-camera", "Porch camera", day.isoformat())
    assert parse(new["recorded_at"]) == recorded
    assert new["object_key"] == object_key("porch-camera", day, new["id"])
    expect_error(call(app_url, "GET", f"/api/clips/{new['id']}/media"), 409, "clip_not_playable")
    data = os.urandom(size)
    stored = send_bytes(app_url, new["id"], data)
    assert stored.status_code == 200, stored.text
    record = stored.json()["clip"]
    assert (record["state"], record["stored_size"], record["playable"]) == ("stored", size, True)
    assert _client("S3")().get(new["object_key"]) == data
    media = call(app_url, "GET", f"/api/clips/{new['id']}/media")
    assert media.status_code == 200 and media.headers["content-type"].startswith("video/mp4")
    assert int(media.headers["content-length"]) == size and media.content == data
    expect_error(send_bytes(app_url, new["id"], data), 409, "clip_closed")
    expect_error(post_json(app_url, camera_clips("kitchen-lights"), {"recorded_at": iso(recorded), "declared_size": size}), 404, "not_found")
    expect_error(post_json(app_url, camera_clips(UNKNOWN_CAMERA), {"recorded_at": iso(recorded), "declared_size": size}), 404, "not_found")
    for declared in (0, CLIP_LIMIT + 1):
        expect_field(post_json(app_url, camera_clips("porch-camera"), {"recorded_at": iso(recorded), "declared_size": declared}),
                     "declared_size", FIELD_DECLARED)
    expect_field(post_json(app_url, camera_clips("porch-camera"), {"recorded_at": "dusk", "declared_size": size}),
                 "recorded_at", FIELD_INSTANT)
    for declared in (1, CLIP_LIMIT):
        assert announce(app_url, "hall-camera", recorded, declared)["declared_size"] == declared


def test_storage_confirmed_clips(app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    s3 = _client("S3")()
    for delta in (-1, 1):
        size = clip_size()
        new = announce(app_url, "porch-camera", random_clip_time(day, 10), size)
        sent = size + delta
        expect_error(send_bytes(app_url, new["id"], os.urandom(sent)), 422, "size_mismatch",
                     f"The stored clip is {sent} bytes, not the {size} bytes the camera declared.")
        record = clip(app_url, new["id"])
        assert (record["state"], record["playable"]) == ("size_mismatch", False)
        assert s3.keys(new["object_key"]) == []
        expect_error(send_bytes(app_url, new["id"], os.urandom(size)), 409, "clip_closed")
        expect_error(call(app_url, "GET", f"/api/clips/{new['id']}/media"), 409, "clip_not_playable")
        assert clip(app_url, new["id"])["state"] == "size_mismatch"


def test_clip_rows_and_play_state(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    park(app_url, at(day, 12, 0))
    storing_time, stored_time, broken_time = (random_clip_time(day, h) for h in (7, 8, 9))
    size = clip_size()
    announce(app_url, "porch-camera", storing_time, size)
    good = announce(app_url, "porch-camera", stored_time, size)
    assert send_bytes(app_url, good["id"], os.urandom(size)).status_code == 200
    bad = announce(app_url, "porch-camera", broken_time, size)
    send_bytes(app_url, bad["id"], os.urandom(size - 1))
    with opened(browser, f"{app_url}/log") as page:
        clips = page.get_by_role("list", name="Clips")
        for moment, copy, enabled in ((storing_time, STORING_COPY, False), (stored_time, f"{size} bytes", True),
                                      (broken_time, MISMATCH_COPY, False)):
            button = clips.get_by_role("button", name=clip_label("Porch camera", moment))
            ui(page, lambda m=moment, c=copy: contains(clip_row(page, clip_label("Porch camera", m)), c))
            click(button)
            sheet = page.get_by_role("dialog", name=clip_sheet_name("Porch camera", moment))
            ui(page, lambda s=sheet: visible(s))
            play = sheet.get_by_role("button", name="Play")
            if enabled:
                ui(page, lambda p=play: expect(p).to_be_enabled(timeout=EXPECT_MS))
            else:
                expect(play).to_be_disabled()
            page.keyboard.press("Escape")
            ui(page, lambda s=sheet: hidden(s))


def test_clip_storage_outage(browser: Browser, app_url: str) -> None:
    outage = os.environ[MINIO_DOWN_ENV]
    poll(lambda: get_json(outage, "/api/status")["services"]["storage"] == "down", STORAGE_CHECK_S + NETWORK_SLACK_S, "storage down")
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    size = clip_size()
    new = announce(outage, "porch-camera", random_clip_time(day, 11), size)
    data = os.urandom(size)
    for _ in range(2):
        expect_error(send_bytes(outage, new["id"], data), 503, "storage_unavailable")
        record = clip(outage, new["id"])
        assert (record["state"], record["playable"], record["stored_size"]) == ("storing", False, None)
    assert _client("S3")().keys(new["object_key"]) == []
    with opened(browser, f"{outage}/plan") as page:
        for path in PAGES:
            page.goto(outage + path)
            ui(page, lambda: contains(page.get_by_role("alert").filter(has_text="Clip storage is unreachable"), STORAGE_BANNER))
    with opened(browser, f"{app_url}/plan") as page:
        plan_ready(page)
        expect(page.get_by_text(STORAGE_BANNER)).to_have_count(0)


def test_motion_notice_outbox(app_url: str, mail: Any) -> None:
    day = park_after_notices(app_url)
    recorded = random_clip_time(day, 6)
    size = clip_size()
    new = announce(app_url, "hall-camera", recorded, size)
    stored_at = hub_now(app_url)
    started = time.monotonic()
    assert send_bytes(app_url, new["id"], os.urandom(size)).status_code == 200
    expected = motion_body("Hall camera", recorded, size)
    found = wait_mail(mail, lambda m: body_of(m) == expected, NOTICE_SEND_S + NETWORK_SLACK_S)
    assert time.monotonic() - started <= NOTICE_SEND_S + NETWORK_SLACK_S * 2
    assert_plain_notice(found[0], "Motion on Hall camera")
    stored_until = hub_now(app_url)

    def motion_notices() -> list[dict] | None:
        found = [n for n in get_json(app_url, "/api/notices")["notices"]
                 if n["kind"] == "motion" and n["subject"] == motion_subject("Hall camera")
                 and stored_at - timedelta(seconds=1) <= parse(n["created_at"]) <= stored_until]
        return found if found and all(n["state"] == "sent" for n in found) else None

    notices = poll(motion_notices, NETWORK_SLACK_S, "the motion notice marked sent")
    assert len(notices) == 1, notices
    notice = notices[0]
    assert (notice["subject"], notice["to"], notice["state"]) == (motion_subject("Hall camera"), HOUSEHOLD_MAIL, "sent")
    assert parse(notice["sent_at"]) >= parse(notice["created_at"])
    assert len(mail_matching(mail, lambda m: body_of(m) == expected, MAIL_SETTLE_S)) == 1


def test_health_and_served_copy(app_url: str) -> None:
    response = call(app_url, "GET", "/api/health")
    assert response.status_code == 200 and response.json() == {"status": "ok"}
    with app_copy({"DATABASE_URL": os.environ["DATABASE_URL"] + OUTAGE_STORE_DB}) as base:
        health = call(base, "GET", "/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        assert call(base, "GET", "/plan").status_code == 200


def test_same_origin_boundary(app_url: str) -> None:
    parsed = urlparse(app_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    foreign = "http://elsewhere.example"
    name = f"Origin {secrets.token_hex(4)}"
    refused = post_json(app_url, "/api/scenes", {"name": name, "tint": "amber", "brightness": 10, "setpoint_f": None}, Origin=foreign)
    expect_error(refused, 403, "forbidden_origin")
    assert not any(k.lower().startswith(CORS_PREFIX) for k in refused.headers)
    assert name not in [s["name"] for s in get_json(app_url, "/api/scenes")["scenes"]]
    own = post_json(app_url, "/api/scenes", {"name": name, "tint": "amber", "brightness": 10, "setpoint_f": None}, Origin=origin)
    assert own.status_code == 201, own.text
    foreign_socket = Listener(app_url, origin=foreign)
    assert foreign_socket.status == 403
    foreign_socket.close()
    with listen(app_url) as own_socket:
        own_socket.wait(lambda m: m.get("type") == "status", NETWORK_SLACK_S)

    def padded(total: int) -> bytes:
        head = b'{"name":"","pad":"'
        return head + b"a" * (total - len(head) - 2) + b'"}'

    expect_error(call(app_url, "POST", "/api/scenes", content=padded(JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "too_large")
    at_limit = call(app_url, "POST", "/api/scenes", content=padded(JSON_LIMIT), headers={"Content-Type": "application/json"})
    assert at_limit.status_code == 422, at_limit.text
    expect_error(call(app_url, "POST", "/api/scenes", content=b"{}", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    big = announce(app_url, "porch-camera", random_clip_time(day, 5), CLIP_LIMIT)
    expect_error(send_bytes(app_url, big["id"], b"{}", "application/json"), 415, "unsupported_media_type")
    expect_error(send_bytes(app_url, big["id"], b"0" * (CLIP_LIMIT + 1)), 413, "too_large")
    assert send_bytes(app_url, big["id"], b"0" * CLIP_LIMIT).status_code == 200
    for path in ("/run.json", "/package.json", "/.env", "/src/", "/api/nothing-here"):
        expect_error(call(app_url, "GET", path), 404, "not_found")
    assert call(app_url, "GET", "/nothing-here").status_code == 404
    root = call(app_url, "GET", "/")
    assert root.is_redirect and redirect_path(root) == "/plan"
    for path in PAGES:
        assert call(app_url, "GET", path).status_code == 200


def test_error_shape_and_precedence(app_url: str) -> None:
    oversized = b'{"pad":"' + b"a" * JSON_LIMIT + b'"}'
    foreign = "http://elsewhere.example"
    expect_error(call(app_url, "POST", "/api/scenes", content=oversized, headers={"Content-Type": "text/plain", "Origin": foreign}), 403, "forbidden_origin")
    expect_error(call(app_url, "POST", "/api/scenes", content=oversized, headers={"Content-Type": "text/plain"}), 413, "too_large")
    expect_error(call(app_url, "POST", "/api/scenes", content=b"{", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    expect_error(call(app_url, "PUT", "/api/scenes/no-such-scene", content=b"{", headers={"Content-Type": "application/json"}), 400, "bad_json")
    expect_error(post_json(app_url, f"/api/guest-scenes/{UNKNOWN_ID}/cancel", {}), 404, "not_found")
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    revision = get_json(app_url, "/api/schedules/weekend")["schedule"]["revision"]
    expect_error(put_json(app_url, "/api/schedules/weekend", {"revision": revision - 1, "from": "bad", "slots": []}), 409, "schedule_changed")
    error = expect_field(put_json(app_url, "/api/schedules/weekend", {"revision": revision, "from": "bad", "slots": []}), "slots", FIELD_SLOTS)
    assert set(error) == {"code", "message", "fields"}
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 12, 0))
    held_guest = create_guest(app_url, "living", "guest-welcome", None, wall(at(day, 14, 0)))
    guest_id = held_guest.json()["guest_scene"]["id"]
    try:
        expect_field(create_guest(app_url, "living", "guest-welcome", None, wall(at(day, 11, 0))), "ends_at", FIELD_END_ORDER)
        expect_error(create_guest(app_url, "living", "guest-welcome", None, wall(at(day, 13, 0))), 409, "guest_overlap")
    finally:
        cancel_quietly(app_url, [guest_id])


def test_keyboard_sheets_trap_and_return(browser: Browser, app_url: str) -> None:
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET), size=TABLET) as page:
        cases = [
            ("/plan", lambda: page.get_by_role("button", name="Menu", exact=True), "Menu", None),
            ("/scenes", lambda: page.get_by_role("button", name="New scene"), "New scene", None),
            ("/guests", lambda: page.get_by_role("button", name="New guest scene"), "New guest scene", None),
            ("/schedules", lambda: page.get_by_role("button", name=edit_name("Weekday")), edit_name("Weekday"),
             lambda: click(page.get_by_role("tab", name="Weekday"))),
            ("/plan", lambda: rooms_button(page, "Kitchen"), "Room inspector", None),
        ]
        for path, opener_of, dialog_name, prepare in cases:
            page.goto(app_url + path)
            if prepare:
                prepare()
            opener = opener_of()
            ui(page, lambda o=opener: visible(o))
            sheet = page.get_by_role("dialog", name=dialog_name)
            press_on(page, opener)
            ui(page, lambda s=sheet: (visible(s), must(holds_focus(s), f"focus not in {dialog_name}")))
            advance(page, SHEET_MS + FRAME_MS)
            assert_trap(page, sheet)
            page.keyboard.press("Escape")
            advance(page, SHEET_MS + FRAME_MS)
            ui(page, lambda s=sheet, o=opener: (hidden(s), must(has_focus(o), f"focus not returned from {dialog_name}")))
        page.goto(app_url + "/scenes")
        opener = page.get_by_role("button", name="New scene")
        sheet = page.get_by_role("dialog", name="New scene")
        press_on(page, opener)
        ui(page, lambda: visible(sheet))
        advance(page, SHEET_MS + FRAME_MS)
        page.keyboard.press("Escape")
        advance(page, FRAME_MS * 3)
        click(opener)
        advance(page, SETTLE_MS)
        ui(page, lambda: (visible(sheet), inside_viewport(page, sheet)))


CONTROL_ROLES = ["button", "link", "switch", "checkbox", "radio", "tab"]
TARGET_SCRIPT = """
(elements, half) => elements.filter(el => el.checkVisibility && el.checkVisibility()).map(el => {
  el.scrollIntoView({block: 'center', inline: 'center'});
  const own = el.getBoundingClientRect();
  const label = (own.width < 2 || own.height < 2) && el.labels && el.labels[0];  // a visually hidden native input: its label is the hit area
  const r = label ? label.getBoundingClientRect() : own;
  const owns = hit => !!hit && (hit === el || el.contains(hit)
    || [...(el.labels || [])].some(l => l === hit || l.contains(hit))
    || (hit.closest && hit.closest('label') && hit.closest('label').control === el));
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const points = [[cx - half, cy - half], [cx + half, cy - half], [cx - half, cy + half], [cx + half, cy + half]];
  return points.every(([x, y]) => owns(document.elementFromPoint(x, y))) ? null
    : `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60)} ${Math.round(r.width)}x${Math.round(r.height)}`;
}).filter(Boolean)
"""


def test_readable_tappable_controls(browser: Browser, app_url: str) -> None:
    with opened(browser, f"{app_url}/plan") as page:
        for size in (DESKTOP, PHONE):
            page.set_viewport_size(size)
            for path in PAGES:
                page.goto(app_url + path)
                ui(page, lambda: visible(hub_header(page)))
                small = []
                for role in CONTROL_ROLES:
                    small += page.get_by_role(role).evaluate_all(TARGET_SCRIPT, TARGET_PX / 2 - 0.5)
                assert not small, f"{path} at {size}: controls under {TARGET_PX}px: {small[:10]}"
                scroll_top(page)
                axe(page)


def test_no_idle_motion_and_sheet_timing(browser: Browser, app_url: str) -> None:
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET)) as page:
        for path in PAGES:
            page.goto(app_url + path if path != "/plan" else plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET))
            ui(page, lambda: must(running_animations(page) == [], f"{path}: {running_animations(page)}"))
        page.goto(plan_url(app_url, SEED_TUESDAY, "12:00" + SEED_OFFSET))
        noon = names_of(seed_owners(WEEKDAY_SEED, "12:00"))
        ui(page, lambda: must(plan_names(page) == noon, str(plan_names(page))))
        advance(page, SETTLE_MS)
        ui(page, lambda: must(running_animations(page) == [], str(running_animations(page))))
        floor = page.get_by_role("region", name="Floor plan")
        first = decode(capture(floor))
        advance(page, SETTLE_MS)
        assert difference(first, decode(capture(floor))) == 0, "the idle floor plan moved"
        page.goto(app_url + "/scenes")
        opener = page.get_by_role("button", name="New scene")
        ui(page, lambda: visible(opener))
        click(opener)
        sheet = page.get_by_role("dialog", name="New scene")
        assert all(end <= SHEET_MS + 0.5 for end in sheet_animation_ends(sheet)), sheet_animation_ends(sheet)
        ui(page, lambda: inside_viewport(page, sheet))
        page.keyboard.press("Escape")
        assert all(end <= SHEET_MS + 0.5 for end in sheet_animation_ends(sheet))
        ui(page, lambda: hidden(sheet))
    with opened(browser, f"{app_url}/scenes", reduced_motion="reduce") as page:
        opener = page.get_by_role("button", name="New scene")
        ui(page, lambda: visible(opener))
        click(opener)
        advance(page, 3 * FRAME_MS)
        sheet = page.get_by_role("dialog", name="New scene")
        inside_viewport(page, sheet)
        assert [e for e in sheet_own_animation_ends(sheet) if e > FRAME_MS] == []


def test_wf_plan_sweep_scrub_and_share(browser: Browser, app_url: str) -> None:
    bedtime, evening = seed_owners(WEEKDAY_SEED, "22:30"), seed_owners(WEEKDAY_SEED, "19:30")
    with opened(browser, plan_url(app_url, SEED_TUESDAY, DAWN + SEED_OFFSET)) as page:
        scrubber = slider(page)
        ui(page, lambda: must(slider_now(scrubber) == minutes(DAWN)))
        scrubber.focus()
        for _ in range(16):
            page.keyboard.press("PageUp")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        ui(page, lambda: must(plan_names(page) == names_of(bedtime), str(plan_names(page))))
        track = box(scrubber)
        x, y = track["x"] + track["width"] / 2, track["y"] + track["height"] / 2
        before = slider_now(scrubber)
        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 9):
            page.mouse.move(x - step * 15, y)
            advance(page, FRAME_MS)
        page.mouse.up()
        ui(page, lambda: must(slider_now(scrubber) < before, "the drag did not move back"))
        scrubber.focus()
        page.keyboard.press("Home")
        for _ in range(19):
            page.keyboard.press("PageUp")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        ui(page, lambda: must(plan_names(page) == names_of(evening) and at_list(page) == at_list_of(evening)
                              and legend(page) == counts_of(names_of(evening))))
        assert query(page) == (SEED_TUESDAY.isoformat(), "19:30" + SEED_OFFSET)
        copied, legend_now = page.url, legend(page)
        tab = page.context.new_page()
        tab.goto(copied)
        ui(tab, lambda: must(plan_names(tab) == names_of(evening) and at_list(tab) == at_list_of(evening) and legend(tab) == legend_now))
        assert slider_now(slider(tab)) == minutes("19:30")
        expect(tab.get_by_role("textbox", name="Plan day")).to_have_value(SEED_TUESDAY.isoformat())
    owners = owners_at(get_json(app_url, f"/api/plan?day={SEED_TUESDAY.isoformat()}"), at(SEED_TUESDAY, 19, 30))
    assert {ROOM_NAME[r]: SCENE_NAME[s] for r, s in owners.items()} == names_of(evening)


def test_wf_plan_sweep_phone_reduced(browser: Browser, app_url: str) -> None:
    with opened(browser, plan_url(app_url, SEED_TUESDAY, "08:00" + SEED_OFFSET), size=PHONE, reduced_motion="reduce") as page:
        scrubber = slider(page)
        ui(page, lambda: must(slider_now(scrubber) == minutes("08:00")))
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        track = box(scrubber)
        x, y = track["x"] + track["width"] / 2, track["y"] + track["height"] / 2
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for step in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + step * 15, "y": y}]})
            advance(page, FRAME_MS)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        ui(page, lambda: must(minutes(query(page)[1][:5]) == slider_now(scrubber) and slider_now(scrubber) % DRAG_SNAP_MIN == 0))
        clock = query(page)[1][:5]
        moment = at(SEED_TUESDAY, *map(int, clock.split(":")))
        owners = owners_at(get_json(app_url, f"/api/plan?day={SEED_TUESDAY.isoformat()}"), moment)
        expected = {ROOM_NAME[r]: SCENE_NAME[s] for r, s in owners.items()}
        assert plan_names(page) == expected
        page.reload()
        ui(page, lambda: must(plan_names(page) == expected and slider_now(slider(page)) == minutes(clock)))


def test_wf_live_house_fast_tablet(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 4)
    park(app_url, at(day, 12, 0, 5))
    set_device(app_url, "kitchen-lights", {"on": True})
    rev = device(app_url, "kitchen-lights")["revision"]
    fast = hub_now(app_url) + timedelta(minutes=TABLET_FAST_MIN)
    with opened(browser, f"{app_url}/plan", size=TABLET, zone=FOREIGN_ZONE, device_clock=fast) as page:
        plan_ready(page)
        ui(page, lambda: contains(hub_header(page), re.compile(r"Hub time 12:0[01] ")))
        for room in get_json(app_url, "/api/status")["rooms"]:
            ui(page, lambda r=room: contains(rooms_button(page, r["name"]), f"Now: {r['scene_name']}"))
        press_on(page, rooms_button(page, "Kitchen"))
        sheet = inspector(page, False)
        ui(page, lambda: visible(sheet.get_by_role("heading", name="Kitchen", exact=True)))
        press_on(page, sheet.get_by_role("button", name=details("Kitchen lights")))
        device_dialog = page.get_by_role("dialog", name="Kitchen lights")
        ui(page, lambda: visible(device_dialog))
        flip(device_dialog.get_by_role("switch", name="Power"))
        poll(lambda: device(app_url, "kitchen-lights")["state"]["on"] is False, UI_WAIT_S, "lights off")
        page.keyboard.press("Escape")
        advance(page, FRAME_MS)
        flip(sheet.get_by_role("switch", name="Kitchen lights"))
        poll(lambda: device(app_url, "kitchen-lights")["state"]["on"] is True, UI_WAIT_S, "lights on again")
        assert device(app_url, "kitchen-lights")["revision"] >= rev + 2
        advance(page, SETTLE_MS)
        ui(page, lambda: (must(sheet.get_by_role("switch", name="Kitchen lights").is_checked(), "switch ends on"),
                          shows(page.get_by_role("status", name="Device updates", include_hidden=True),
                                f"Kitchen lights: on at {device(app_url, 'kitchen-lights')['state']['brightness']}%")))
        setpoint = device(app_url, "living-thermostat")["state"]["setpoint_f"]
        report(app_url, "living-thermostat", {"state": {"current_f": 71}})
        ui(page, lambda: shows(page.get_by_role("status", name="Device updates", include_hidden=True),
                               f"Living thermostat: set to {setpoint}°F, reading 71°F"))


def test_wf_live_house_scene_handover(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 17, 29, 30))
    with opened(browser, f"{app_url}/plan") as page:
        plan_ready(page)
        click(rooms_button(page, "Kitchen"))
        wait_hub(app_url, at(day, 17, 30, 2))
        ui(page, lambda: contains(rooms_button(page, "Kitchen"), "Now: Evening"))
        ui(page, lambda: contains(inspector(page, True), "Now: Evening since 17:30"))
        ui(page, lambda: shows(page.get_by_role("status", name="Scene changes"),
                               re.compile(r"^(Hall|Kitchen|Living|Porch) is now in Evening$")))
    assert status_room(app_url, "kitchen")["scene_id"] == "evening"
    assert device(app_url, "kitchen-lights")["state"] == {"on": True, "brightness": EVENING_BRIGHTNESS}


def test_wf_fall_back_night_scrub(browser: Browser, app_url: str) -> None:
    first_hour = {room: "Night low" for room in ROOM_NAMES} | {"Main bedroom": "Bedtime", "Nursery": "Bedtime"}
    all_low = {room: "Night low" for room in ROOM_NAMES}
    with opened(browser, plan_url(app_url, FALL_BACK, "01:00-05:00")) as page:
        scrubber = slider(page)
        ui(page, lambda: must(plan_names(page) == first_hour, str(plan_names(page))))
        scrubber.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        ui(page, lambda: must(plan_names(page) == all_low and scrubber.get_attribute("aria-valuetext") == "01:30 CDT"))
        ui(page, lambda: shows(page.get_by_role("status", name="Plan time"), "At 01:30 CDT, 9 rooms in Night low"))
        page.keyboard.press("PageUp")
        ui(page, lambda: must(scrubber.get_attribute("aria-valuetext") == "01:30 CST" and plan_names(page) == all_low))
        assert query(page) == (FALL_BACK.isoformat(), f"01:30{SEED_OFFSET}")
        assert at_line("Hall", "Night low", "01:30 CDT") in at_list(page)
        ui(page, lambda: shows(page.get_by_role("status", name="Plan time"), "At 01:30 CST, 9 rooms in Night low"))
    plan = get_json(app_url, f"/api/plan?day={FALL_BACK.isoformat()}")
    assert len([c for c in plan["changes"] if c["slot_time"] == "01:30"]) == 1


def test_wf_fall_back_night_day_log(browser: Browser, app_url: str) -> None:
    ensure_fall_back_run(app_url)
    set_clock(app_url, at(FALL_BACK, 1, 29, 57, fold=1))
    wait_hub(app_url, at(FALL_BACK, 1, 30, 4, fold=1))
    park(app_url, at(FALL_BACK, 18, 0))
    with opened(browser, f"{app_url}/log", zone=FOREIGN_ZONE) as page:
        ui(page, lambda: visible(page.get_by_role("heading", name="Today", exact=True)))
        runs = page.get_by_role("list", name="Runs")
        line = run_line("01:30", "Night low", len(ROOMS), "Weekend")
        ui(page, lambda: must(sum(line in " ".join(t.split()) for t in runs.get_by_role("listitem").all_inner_texts()) == 1,
                              str(runs.get_by_role("listitem").all_inner_texts())))
    runs = [r for r in get_json(app_url, f"/api/runs?day={FALL_BACK.isoformat()}")["runs"] if r["slot_time"] == "01:30"]
    assert len(runs) == 1 and parse(runs[0]["ran_at"]).utcoffset() == timedelta(hours=-5)


def test_wf_day_log_other_zone(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    set_clock(app_url, at(day, 22, 14, 56))
    poll(lambda: any(r["slot_time"] == "22:15" for r in get_json(app_url, f"/api/runs?day={day.isoformat()}")["runs"]),
         STATUS_HEARTBEAT_S, "the 22:15 run")
    mine, theirs = random_clip_time(day, 21), random_clip_time(day + timedelta(days=1), 0)
    announce(app_url, "porch-camera", mine, clip_size())
    announce(app_url, "porch-camera", theirs, clip_size())
    park(app_url, at(day, 23, 20))
    with opened(browser, f"{app_url}/log", zone=FOREIGN_ZONE, device_clock=at(day, 23, 20) + timedelta(hours=9)) as page:
        ui(page, lambda: visible(page.get_by_role("heading", name="Today", exact=True)))
        clips = page.get_by_role("list", name="Clips")
        ui(page, lambda: (expect(page.get_by_role("textbox", name="Log day")).to_have_value(day.isoformat(), timeout=EXPECT_MS),
                          contains(page.get_by_role("list", name="Runs"), "22:15 Night low · 6 rooms · Weekday"),
                          visible(clips.get_by_role("button", name=clip_label("Porch camera", mine)))))
        expect(clips.get_by_role("button", name=clip_label("Porch camera", theirs))).to_have_count(0)
    assert get_json(app_url, "/api/clips")["day"] == day.isoformat()


def test_wf_day_log_clip_row(browser: Browser, app_url: str) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 4)
    park(app_url, at(day, 12, 0))
    recorded = random_clip_time(day, 10)
    size = clip_size()
    with opened(browser, f"{app_url}/log") as page:
        ui(page, lambda: visible(page.get_by_role("heading", name="Today", exact=True)))
        new = announce(app_url, "hall-camera", recorded, size)
        row = clip_row(page, clip_label("Hall camera", recorded))
        ui(page, lambda: contains(row, STORING_COPY), seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
        data = os.urandom(size)
        assert send_bytes(app_url, new["id"], data).status_code == 200
        ui(page, lambda: contains(row, f"{size} bytes"), seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
    assert _client("S3")().get(new["object_key"]) == data


def edit_slot_by_time(editor: Locator, old: str, new: str) -> None:
    groups = editor.get_by_role("group", name=re.compile(r"^Slot \d+$"))
    for index in range(groups.count()):
        field = groups.nth(index).get_by_role("textbox", name="Time")
        if field.input_value() == old:
            fill(field, new)
            return
    raise AssertionError(f"no slot at {old}")


def test_wf_effective_edit_wake_move(browser: Browser, app_url: str, mail: Any) -> None:
    park(app_url, at(EDIT_THURSDAY, 12, 0))
    with opened(browser, f"{app_url}/schedules", size=PHONE, zone=FOREIGN_ZONE) as page:
        ui(page, lambda: visible(page.get_by_role("tab", name="Weekday")))
        click(page.get_by_role("tab", name="Weekday"))
        ui(page, lambda: visible(page.get_by_role("button", name=edit_name("Weekday"))))
        press_on(page, page.get_by_role("button", name=edit_name("Weekday")))
        editor = page.get_by_role("dialog", name=edit_name("Weekday"))
        ui(page, lambda: (visible(editor), visible(slot_group(editor, 1)),
                          expect(editor.get_by_role("textbox", name="From")).to_have_value(EDIT_THURSDAY.isoformat(), timeout=EXPECT_MS)))
        edit_slot_by_time(editor, "06:40", "06:10")
        fill(editor.get_by_role("textbox", name="From"), EDIT_FROM.isoformat())
        press_on(page, editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"),
                               "Saved. Weekday slots change from Monday 9 November 2026."))
    friday = get_json(app_url, f"/api/plan?day={EDIT_FRIDAY.isoformat()}")
    monday = get_json(app_url, f"/api/plan?day={EDIT_FROM.isoformat()}")
    assert [c["slot_time"] for c in friday["changes"] if c["scene_id"] == "wake"] == ["06:40"]
    assert [c["slot_time"] for c in monday["changes"] if c["scene_id"] == "wake"] == ["06:10"]
    with opened(browser, plan_url(app_url, EDIT_FRIDAY, "06:15" + SEED_OFFSET)) as page:
        ui(page, lambda: must(plan_names(page).get("Hall") == "Night low"))
        page.goto(plan_url(app_url, EDIT_FROM, "06:10" + SEED_OFFSET))
        ui(page, lambda: must(Counter(plan_names(page).values()) == {"Wake": 5, "Night low": 4}, str(plan_names(page))))
        press_on(page, slider(page), "ArrowRight")
        press_on(page, slider(page), "ArrowLeft")
        ui(page, lambda: shows(page.get_by_role("status", name="Plan time"), "At 06:10, 5 rooms in Wake, 4 rooms in Night low"))
    set_clock(app_url, at(EDIT_FROM, EFFECT_HOUR, 0) - timedelta(seconds=3))
    heading = change_heading("Weekday", EDIT_FROM)
    found = wait_mail(mail, lambda m: body_of(m).startswith(heading), NOTICE_SEND_S + NETWORK_SLACK_S * 3)
    assert_plain_notice(found[0], "Schedule change takes effect: Weekday")
    wake = [line for line in body_of(found[0]).splitlines() if line.startswith(slot_line_prefix("06:10", "Wake"))]
    assert len(wake) == 1
    assert {r.strip() for r in wake[0].split(" — ", 1)[1].split(",")} == {"Hall", "Kitchen", "Main bedroom", "Nursery", "Bath"}
    assert len(mail_matching(mail, lambda m: body_of(m).startswith(heading), MAIL_SETTLE_S)) == 1


def test_wf_effective_edit_bad_from(browser: Browser, app_url: str) -> None:
    park(app_url, at(EDIT_THURSDAY, 12, 0))
    far_edge = EDIT_THURSDAY + timedelta(days=FROM_MAX_DAYS)
    revision = get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"]
    with opened(browser, f"{app_url}/schedules") as page:
        ui(page, lambda: visible(page.get_by_role("tab", name="Weekday")))
        click(page.get_by_role("tab", name="Weekday"))
        ui(page, lambda: visible(page.get_by_role("button", name=edit_name("Weekday"))))
        click(page.get_by_role("button", name=edit_name("Weekday")))
        editor = page.get_by_role("dialog", name=edit_name("Weekday"))
        ui(page, lambda: (visible(editor), visible(slot_group(editor, 1))))
        start = editor.get_by_role("textbox", name="From")
        for value, message in (((EDIT_THURSDAY - timedelta(days=1)).isoformat(), FIELD_FROM_PAST),
                               ((far_edge + timedelta(days=1)).isoformat(), FIELD_FROM_FAR)):
            fill(start, value)
            click(editor.get_by_role("button", name="Save schedule"))
            ui(page, lambda m=message: (visible(editor.get_by_text(m)),
                                        shows(editor.get_by_role("status", name="Schedule save"), MESSAGES["invalid"])))
        assert get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"] == revision
        fill(start, far_edge.isoformat())
        click(editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"),
                               f"Saved. Weekday slots change from {long_date(far_edge)}."))
    assert far_edge.isoformat() in [v["from"] for v in get_json(app_url, "/api/schedules/weekday")["schedule"]["versions"]]


def open_weekend_editor(page: Page) -> Locator:
    ui(page, lambda: visible(page.get_by_role("tab", name="Weekend")))
    click(page.get_by_role("tab", name="Weekend"))
    ui(page, lambda: visible(page.get_by_role("button", name=edit_name("Weekend"))))
    press_on(page, page.get_by_role("button", name=edit_name("Weekend")))
    editor = page.get_by_role("dialog", name=edit_name("Weekend"))
    ui(page, lambda: (visible(editor), visible(slot_group(editor, 1))))
    return editor


def test_wf_weekend_conflict_two_editors(browser: Browser, app_url: str) -> None:
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    _, version = weekend_in_force(app_url, saturday)
    slot = version["slots"][0]
    minute_a = 1 + secrets.randbelow(14)
    a_time, b_time = early_slot(minute_a), early_slot(minute_a + SCRUB_STEP_MIN)
    room, scene = ROOM_NAME[slot["room_ids"][0]], scene_names(app_url)[slot["scene_id"]]
    with opened(browser, f"{app_url}/schedules") as first, opened(browser, f"{app_url}/schedules") as second, \
            opened(browser, plan_url(app_url, saturday, a_time)) as plan:
        plan_ready(plan)
        ui(plan, lambda: must(re.search(r"[+-]\d\d:\d\d$", query(plan)[1]) is not None, plan.url))
        address = plan.url
        editors = [open_weekend_editor(first), open_weekend_editor(second)]
        fill(slot_group(editors[0], 1).get_by_role("textbox", name="Time"), a_time)
        fill(slot_group(editors[1], 1).get_by_role("textbox", name="Time"), b_time)
        press_on(first, editors[0].get_by_role("button", name="Save schedule"))
        ui(first, lambda: shows(editors[0].get_by_role("status", name="Schedule save"),
                                f"Saved. Weekend slots change from {long_date(saturday)}."))
        press_on(second, editors[1].get_by_role("button", name="Save schedule"))
        ui(second, lambda: contains(editors[1].get_by_role("alert"), MESSAGES["schedule_changed"]))
        click(editors[1].get_by_role("button", name="Reload schedule"))
        times = lambda: [slot_groups(editors[1]).nth(i).get_by_role("textbox", name="Time").input_value()
                         for i in range(slot_groups(editors[1]).count())]
        ui(second, lambda: must(a_time in times() and b_time not in times(), str(times())))
        expect(editors[1].get_by_text(MESSAGES["schedule_changed"])).to_have_count(0)
        ui(plan, lambda: must(f"{room} · {scene} · since {a_time}" in at_list(plan), str(at_list(plan))),
           seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S * 3)
        assert plan.url == address
    previous = get_json(app_url, f"/api/plan?day={(saturday - timedelta(days=7)).isoformat()}")
    assert all(c.get("version_from") != saturday.isoformat() for c in previous["changes"] if c["source"] == "schedule")


def test_wf_weekend_conflict_reload_then_save(browser: Browser, app_url: str) -> None:
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    new_time = early_slot(1 + secrets.randbelow(29))
    with opened(browser, f"{app_url}/schedules") as page:
        editor = open_weekend_editor(page)
        schedule, version = weekend_in_force(app_url, saturday)
        bumped = put_json(app_url, "/api/schedules/weekend", {"revision": schedule["revision"], "from": saturday.isoformat(), "slots": slots_body(version)})
        assert bumped.status_code == 200
        fill(slot_group(editor, 1).get_by_role("textbox", name="Time"), new_time)
        click(editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: contains(editor.get_by_role("alert"), MESSAGES["schedule_changed"]))
        assert get_json(app_url, "/api/schedules/weekend")["schedule"]["revision"] == schedule["revision"] + 1
        click(editor.get_by_role("button", name="Reload schedule"))
        ui(page, lambda: expect(editor.get_by_role("button", name="Reload schedule")).to_have_count(0, timeout=EXPECT_MS))
        fill(slot_group(editor, 1).get_by_role("textbox", name="Time"), new_time)
        click(editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"),
                               f"Saved. Weekend slots change from {long_date(saturday)}."))
    stored = get_json(app_url, "/api/schedules/weekend")["schedule"]
    assert stored["revision"] == schedule["revision"] + 2
    assert new_time in [s["time"] for s in [v for v in stored["versions"] if v["from"] == saturday.isoformat()][0]["slots"]]


def test_wf_scene_authoring_keyboard(browser: Browser, app_url: str) -> None:
    saturday = pick(SATURDAYS, SATURDAY_WEEKS)
    park(app_url, at(saturday, 12, 0))
    name = f"Nook {secrets.token_hex(4)}"
    slot_time = f"13:{15 * (1 + secrets.randbelow(3))}"
    with opened(browser, f"{app_url}/scenes", size=PHONE, reduced_motion="reduce") as page:
        ui(page, lambda: visible(page.get_by_role("button", name="New scene")))
        tab_to(page, "New scene")
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="New scene")
        ui(page, lambda: (visible(sheet), must(holds_focus(sheet), "focus not in New scene")))
        assert_trap(page, sheet)
        tab_to(page, "Scene name")
        page.keyboard.type(name)
        sheet.get_by_role("radio", name="Dusk").focus()
        page.keyboard.press("Space")
        tab_to(page, "Brightness")
        page.keyboard.press("Control+A")
        page.keyboard.type("45")
        tab_to(page, "Create scene")
        page.keyboard.press("Enter")
        ui(page, lambda: shows(sheet.get_by_role("status", name="Scene save"), SCENE_CREATED))
        page.keyboard.press("Escape")
        ui(page, lambda: (hidden(sheet), must(has_focus(page.get_by_role("button", name="New scene")), "focus not returned")))
        scene = next(s for s in get_json(app_url, "/api/scenes")["scenes"] if s["name"] == name)

        page.goto(f"{app_url}/schedules")
        ui(page, lambda: visible(page.get_by_role("tab", name="Weekend")))
        page.get_by_role("tab", name="Weekend").focus()
        page.keyboard.press("Enter")
        opener = page.get_by_role("button", name=edit_name("Weekend"))
        ui(page, lambda: visible(opener))
        tab_to(page, edit_name("Weekend"))
        page.keyboard.press("Enter")
        editor = page.get_by_role("dialog", name=edit_name("Weekend"))
        ui(page, lambda: (visible(editor), visible(slot_group(editor, 1)), must(holds_focus(editor), "focus not in editor")))
        assert_trap(page, editor)
        press_on(page, editor.get_by_role("button", name="Add slot"))
        groups = slot_groups(editor)
        ui(page, lambda: must(groups.count() > 0))
        last = slot_group(editor, groups.count())
        fill(last.get_by_role("textbox", name="Time"), slot_time)
        select(last.get_by_role("combobox", name="Scene"), name)
        for room in ("Study", "Porch"):
            press_on(page, last.get_by_role("checkbox", name=room), "Space")
        press_on(page, editor.get_by_role("button", name="Save schedule"))
        ui(page, lambda: shows(editor.get_by_role("status", name="Schedule save"),
                               f"Saved. Weekend slots change from {long_date(saturday)}."))
        page.keyboard.press("Escape")
        ui(page, lambda: (hidden(editor), must(has_focus(opener), "focus not back on the editor opener")))

        page.goto(f"{app_url}/plan")
        plan_ready(page)
        tab_to(page, "Time of day")
        page.keyboard.press("PageUp")
        for _ in range((minutes(slot_time) - minutes("13:00")) // SCRUB_STEP_MIN):
            page.keyboard.press("ArrowRight")
        ui(page, lambda: must(plan_names(page).get("Study") == name and plan_names(page).get("Porch") == name, str(plan_names(page))))
        assert at_line("Study", name, slot_time) in at_list(page)

        recorded = random_clip_time(saturday, 9)
        size = clip_size()
        new = announce(app_url, "porch-camera", recorded, size)
        assert send_bytes(app_url, new["id"], os.urandom(size)).status_code == 200
        page.goto(f"{app_url}/log")
        label = clip_label("Porch camera", recorded)
        ui(page, lambda: visible(page.get_by_role("button", name=label)))
        tab_to(page, label)
        page.keyboard.press("Enter")
        clip_sheet = page.get_by_role("dialog", name=clip_sheet_name("Porch camera", recorded))
        ui(page, lambda: (visible(clip_sheet), must(holds_focus(clip_sheet), "focus not in clip sheet")))
        assert_trap(page, clip_sheet)
        page.keyboard.press("Escape")
        ui(page, lambda: (hidden(clip_sheet), must(has_focus(page.get_by_role("button", name=label)), "focus not back on the clip row")))
    plan = get_json(app_url, f"/api/plan?day={saturday.isoformat()}")
    assert any(c["slot_time"] == slot_time and c["scene_id"] == scene["id"] for c in plan["changes"])
    earlier = get_json(app_url, f"/api/plan?day={(saturday - timedelta(days=7)).isoformat()}")
    assert all(c["scene_id"] != scene["id"] for c in earlier["changes"])


def test_wf_scene_authoring_field_errors(browser: Browser, app_url: str) -> None:
    name = f"Glow {secrets.token_hex(4)}"
    with opened(browser, f"{app_url}/scenes") as page:
        click(page.get_by_role("button", name="New scene"))
        sheet = page.get_by_role("dialog", name="New scene")
        ui(page, lambda: visible(sheet))
        set_value(sheet.get_by_role("textbox", name="Scene name"), "x" * (SCENE_NAME_MAX + 1))
        choose(sheet.get_by_role("radio", name="Ember"))
        fill(sheet.get_by_role("spinbutton", name="Brightness"), "20")
        click(sheet.get_by_role("button", name="Create scene"))
        ui(page, lambda: visible(sheet.get_by_text(FIELD_SCENE_NAME)))
        assert all(len(s["name"]) <= SCENE_NAME_MAX for s in get_json(app_url, "/api/scenes")["scenes"])
        fill(sheet.get_by_role("textbox", name="Scene name"), name)
        click(sheet.get_by_role("button", name="Create scene"))
        ui(page, lambda: shows(sheet.get_by_role("status", name="Scene save"), SCENE_CREATED))
    record = next(s for s in get_json(app_url, "/api/scenes")["scenes"] if s["name"] == name)
    assert (record["tint"], record["brightness"]) == ("ember", 20)


def test_wf_guest_scene_spare_room(browser: Browser, app_url: str, mail: Any) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 1)
    park(app_url, at(day, 10, 59, 30))
    end = at(day + timedelta(days=1), 11, 0)
    with opened(browser, f"{app_url}/guests", size=PHONE, zone=FOREIGN_ZONE) as page:
        click(page.get_by_role("button", name="New guest scene"))
        sheet = page.get_by_role("dialog", name="New guest scene")
        ui(page, lambda: visible(sheet))
        select(sheet.get_by_role("combobox", name="Room"), "Spare room")
        select(sheet.get_by_role("combobox", name="Scene"), "Guest welcome")
        fill(sheet.get_by_role("textbox", name="Ends"), wall(end))
        click(sheet.get_by_role("button", name="Start guest scene"))
        ui(page, lambda: shows(sheet.get_by_role("status", name="Guest scene"),
                               f"Guest scene set for Spare room until 11:00 on {long_date(end.date())}."))
        page.keyboard.press("Escape")
        ui(page, lambda: contains(page.get_by_role("list", name="Guest scenes"),
                                  f"Spare room · Guest welcome · Active · until 11:00 {long_date(end.date())}"))
    mine = [g for g in get_json(app_url, "/api/guest-scenes")["guest_scenes"]
            if g["room_id"] == "spare-room" and g["ends_at"] == iso(end) and g["state"] == "active"]
    assert len(mine) == 1
    guest_id = mine[0]["id"]
    try:
        with listen(app_url) as socket_:
            set_clock(app_url, end - timedelta(seconds=5))
            poll(lambda: guest(app_url, guest_id)["state"] == "ended", UI_WAIT_S, "the guest scene to end")
            ended = guest(app_url, guest_id)
            assert end <= parse(ended["ended_at"]) <= end + timedelta(seconds=GUEST_END_LAG_S)
            socket_.wait(lambda m: m.get("type") == "status" and any(
                r["room_id"] == "spare-room" and r["source"] == "schedule" for r in m["rooms"]), NETWORK_SLACK_S)
        room = status_room(app_url, "spare-room")
        assert room["source"] == "schedule"
        body = (f"The guest scene Guest welcome in Spare room ended at 11:00 on {long_date(end.date())}. "
                f"Spare room is back on {room['scene_name']}.")
        assert_plain_notice(wait_mail(mail, lambda m: body_of(m) == body, NOTICE_SEND_S + NETWORK_SLACK_S)[0], "Guest scene ended: Spare room")
    finally:
        cancel_quietly(app_url, [guest_id])


def test_wf_guest_scene_cancel(browser: Browser, app_url: str, mail: Any) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    park(app_url, at(day, 12, 0, 30))
    response = create_guest(app_url, "study", "guest-welcome", None, wall(at(day, 15, 0)))
    assert response.status_code == 201
    guest_id = response.json()["guest_scene"]["id"]
    with opened(browser, f"{app_url}/guests") as page:
        button = page.get_by_role("button", name=f"Cancel guest scene for {ROOM_NAME['study']}")
        ui(page, lambda: visible(button.first))
        with held(page, f"**/api/guest-scenes/{guest_id}/cancel") as gate:
            click(button.first)
            ui(page, lambda: shows(page.get_by_role("status", name="Guest scene"), CANCELLING))
            gate.release()
        ui(page, lambda: shows(page.get_by_role("status", name="Guest scene"), "Guest scene cancelled for Study."))
    assert guest(app_url, guest_id)["state"] == "cancelled"
    assert status_room(app_url, "study")["source"] == "schedule"
    marker = f"in Study ended at 15:00 on {long_date(day)}"
    assert mail_matching(mail, lambda m: marker in body_of(m), MAIL_SETTLE_S) == []


def test_wf_motion_clips_porch_review(browser: Browser, app_url: str, mail: Any) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 3)
    park(app_url, at(day, 23, 45))
    recorded = random_clip_time(day, 23)
    size = clip_size()
    new = announce(app_url, "porch-camera", recorded, size)
    assert new["day"] == day.isoformat()
    data = os.urandom(size)
    media: list[int] = []
    with opened(browser, f"{app_url}/log", zone=FOREIGN_ZONE) as page:
        page.on("response", lambda r: media.append(r.status) if r.url.endswith(f"/api/clips/{new['id']}/media") else None)
        label = clip_label("Porch camera", recorded)
        button = page.get_by_role("list", name="Clips").get_by_role("button", name=label)
        ui(page, lambda: contains(clip_row(page, label), STORING_COPY))
        press_on(page, button)
        sheet = page.get_by_role("dialog", name=clip_sheet_name("Porch camera", recorded))
        ui(page, lambda: visible(sheet))
        play = sheet.get_by_role("button", name="Play")
        expect(play).to_be_disabled()
        contains(sheet, STORING_COPY)
        assert send_bytes(app_url, new["id"], data).status_code == 200
        ui(page, lambda: expect(play).to_be_enabled(timeout=EXPECT_MS), seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
        contains(sheet, f"{size} bytes")
        press_on(page, play)
        ui(page, lambda: must(any(s in (200, 206) for s in media), f"media responses {media}"))
    assert _client("S3")().get(new["object_key"]) == data
    body = motion_body("Porch camera", recorded, size)
    wait_mail(mail, lambda m: body_of(m) == body, NOTICE_SEND_S + NETWORK_SLACK_S)
    assert len(mail_matching(mail, lambda m: body_of(m) == body, MAIL_SETTLE_S)) == 1


def test_wf_motion_clips_size_mismatch(browser: Browser, app_url: str, mail: Any) -> None:
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 4)
    park(app_url, at(day, 12, 0))
    recorded = random_clip_time(day, 7)
    size = clip_size()
    new = announce(app_url, "hall-camera", recorded, size)
    with opened(browser, f"{app_url}/log") as page:
        button = page.get_by_role("list", name="Clips").get_by_role("button", name=clip_label("Hall camera", recorded))
        ui(page, lambda: visible(button))
        click(button)
        sheet = page.get_by_role("dialog", name=clip_sheet_name("Hall camera", recorded))
        ui(page, lambda: visible(sheet))
        send_bytes(app_url, new["id"], os.urandom(size - 1))
        ui(page, lambda: contains(sheet, MISMATCH_COPY), seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
        expect(sheet.get_by_role("button", name="Play")).to_be_disabled()
    assert _client("S3")().keys(new["object_key"]) == []
    assert mail_matching(mail, lambda m: f"recorded motion at {hms(recorded)} on {long_date(day)}" in body_of(m), MAIL_SETTLE_S) == []


def test_wf_notices_page_live(browser: Browser, app_url: str, mail: Any) -> None:
    day = park_after_notices(app_url)
    with opened(browser, f"{app_url}/notices") as page:
        notices = page.get_by_role("list", name="Notices")
        ui(page, lambda: visible(notices))
        stored = []
        for camera, camera_name in (("porch-camera", "Porch camera"), ("hall-camera", "Hall camera")):
            recorded, size = random_clip_time(day, 5), clip_size()
            new = announce(app_url, camera, recorded, size)
            assert send_bytes(app_url, new["id"], os.urandom(size)).status_code == 200
            stored.append(motion_body(camera_name, recorded, size))
            wait_mail(mail, lambda m, b=stored[-1]: body_of(m) == b, NOTICE_SEND_S + NETWORK_SLACK_S)
            latest = poll(lambda c=camera_name: next((n for n in get_json(app_url, "/api/notices")["notices"][:1]
                                                      if n["subject"] == f"Motion on {c}" and n["state"] == "sent"), None),
                          NOTICE_SEND_S, "the sent notice")
            items = notices.get_by_role("listitem")
            ui(page, lambda c=camera_name, n=latest: contains(items.first,
               f"Motion on {c} · to {HOUSEHOLD_MAIL} · Sent {hhmm(parse(n['sent_at']))}"),
               seconds=SCREEN_UPDATE_S + NETWORK_SLACK_S)
        assert motion_subject("Porch camera") in items.nth(1).inner_text()


def test_wf_notices_mail_outage(browser: Browser, app_url: str, mail: Any) -> None:
    outage = os.environ[MAILPIT_DOWN_ENV]
    poll(lambda: get_json(outage, "/api/status")["services"]["mail"] == "down", MAIL_RETRY_S + NETWORK_SLACK_S, "mail down")
    assert call(outage, "GET", "/api/health").status_code == 200
    day = pick(LIVE_MONDAY, LIVE_WEEKS, 2)
    recorded, size = random_clip_time(day, 4), clip_size()
    stored_from = hub_now(outage) - timedelta(seconds=1)
    new = announce(outage, "hall-camera", recorded, size)
    assert send_bytes(outage, new["id"], os.urandom(size)).status_code == 200
    body = motion_body("Hall camera", recorded, size)

    def ours() -> dict | None:
        return next((n for n in get_json(outage, "/api/notices")["notices"]
                     if n["kind"] == "motion" and parse(n["created_at"]) >= stored_from), None)

    notice = poll(lambda: (n := ours()) and n["attempts"] >= 2 and n, MAIL_RETRY_S * 3 + NETWORK_SLACK_S, "two failed attempts")
    assert notice["state"] == "queued" and notice["sent_at"] is None
    assert mail_matching(mail, lambda m: body_of(m) == body) == []
    with opened(browser, f"{outage}/notices") as page:
        ui(page, lambda: shows(page.get_by_role("status", name="Mail"), MAIL_BANNER))
        contains(page.get_by_role("list", name="Notices"), f"Motion on Hall camera · to {HOUSEHOLD_MAIL} · Queued")
    relay = Relay(free_port(), (os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])))
    with app_copy({"DATABASE_URL": os.environ["DATABASE_URL"] + OUTAGE_MAIL_DB, "SMTP_HOST": LOOPBACK, "SMTP_PORT": str(relay.port)}) as copy:
        poll(lambda: get_json(copy, "/api/status")["services"]["mail"] == "down", MAIL_RETRY_S + NETWORK_SLACK_S, "copy reports mail down")
        assert mail_matching(mail, lambda m: body_of(m) == body) == []
        relay.start()
        try:
            wait_mail(mail, lambda m: body_of(m) == body, NOTICE_SEND_S + MAIL_RETRY_S + NETWORK_SLACK_S)
            poll(lambda: (n := ours()) and n["state"] == "sent" and n["sent_at"], NOTICE_SEND_S, "the notice marked sent")
            assert len(mail_matching(mail, lambda m: body_of(m) == body, MAIL_RETRY_S + NETWORK_SLACK_S)) == 1
        finally:
            relay.stop()


def test_wf_notices_schedule_change(app_url: str, mail: Any) -> None:
    monday = pick(NOTICE_MONDAY, NOTICE_WEEKS)
    second = monday + timedelta(days=7)
    park(app_url, at(monday - timedelta(days=3), 12, 0))
    slots = [{"time": "06:10", "scene_id": "wake", "room_ids": ["hall", "kitchen"]},
             {"time": "22:15", "scene_id": "night-low", "room_ids": ROOM_IDS}]
    for frm in (monday, second):
        revision = get_json(app_url, "/api/schedules/weekday")["schedule"]["revision"]
        saved = put_json(app_url, "/api/schedules/weekday", {"revision": revision, "from": frm.isoformat(), "slots": slots})
        assert saved.status_code == 200, saved.text
    effect = at(monday, EFFECT_HOUR, 0)

    def notices_since(moment: datetime) -> list:
        return [n for n in get_json(app_url, "/api/notices")["notices"]
                if n["kind"] == "schedule_change" and parse(n["created_at"]) >= moment]

    set_clock(app_url, effect - timedelta(seconds=4))
    poll(lambda: hub_now(app_url) >= effect - timedelta(seconds=1), NETWORK_SLACK_S * 3, "hub at 04:59:59")
    assert notices_since(effect - timedelta(seconds=4)) == [], "queued before the effect instant"
    found = poll(lambda: notices_since(effect), NETWORK_SLACK_S * 3, "the schedule-change notice")
    assert len(found) == 1 and parse(found[0]["created_at"]) <= effect + timedelta(seconds=GUEST_END_LAG_S)
    heading = change_heading("Weekday", monday)
    message = wait_mail(mail, lambda m: body_of(m).startswith(heading), NOTICE_SEND_S + NETWORK_SLACK_S)[0]
    assert_plain_notice(message, "Schedule change takes effect: Weekday")
    lines = body_of(message).splitlines()
    wake = [line for line in lines if line.startswith(slot_line_prefix("06:10", "Wake"))]
    assert len(wake) == 1 and {r.strip() for r in wake[0].split(" — ", 1)[1].split(",")} == {"Hall", "Kitchen"}
    assert any(line.startswith(slot_line_prefix("22:15", "Night low")) for line in lines)
    set_clock(app_url, effect - timedelta(seconds=3))
    wait_hub(app_url, effect + timedelta(seconds=3))
    assert len(notices_since(effect - timedelta(seconds=3))) == 1
    jump = at(second + timedelta(days=2), 12, 0)
    set_clock(app_url, jump)
    second_heading = change_heading("Weekday", second)
    poll(lambda: notices_since(jump), NETWORK_SLACK_S * 3, "the jumped-over notice")
    wait_mail(mail, lambda m: body_of(m).startswith(second_heading), NOTICE_SEND_S + NETWORK_SLACK_S)
    assert len(mail_matching(mail, lambda m: body_of(m).startswith(heading), MAIL_SETTLE_S)) == 1
    assert len(mail_matching(mail, lambda m: body_of(m).startswith(second_heading))) == 1


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages, "no installed packages found under /app/node_modules: nothing to check"
    missing = [p.name for p in packages if p.name not in notices]
    assert not missing, missing
    for asset in ("Space Grotesk", "IBM Plex Sans", "JetBrains Mono", "Lucide"):
        assert asset in notices, asset


def test_if_allowed_licences() -> None:
    packages = shipped_packages()
    assert packages, "no installed packages found under /app/node_modules: nothing to check"
    refused = [(p.name, p.licence) for p in packages if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not refused, refused


def test_if_only_postgres_and_minio() -> None:
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names if "SQLite".lower() in n or "Redis".lower() in n], names
    assert _client("Postgres")().tables(), "no tables in PostgreSQL"


def test_if_provided_services_unchanged(app_url: str) -> None:
    assert get_json(app_url, "/api/status")["services"] == {"storage": "up", "mail": "up"}
    assert call(app_url, "GET", "/api/health").json() == {"status": "ok"}


def test_if_lockfile_and_npm_ci() -> None:
    assert (APP_DIR / "package-lock.json").is_file()
    assert json.loads((APP_DIR / "run.json").read_text())["install"].strip().startswith("npm ci")


def test_if_same_origin_resources(browser: Browser, app_url: str) -> None:
    parsed = urlparse(app_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    with opened(browser, f"{app_url}/plan") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in PAGES:
            page.goto(app_url + path)
            ui(page, lambda: visible(hub_header(page)))
        foreign = [u for u in seen if u.startswith("http") and not same_origin(u, origin)]
        assert not foreign, foreign
