import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from datetime import time as clock
from decimal import ROUND_HALF_EVEN, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (DEPLOYED_APP, S3, Postgres, addresses, advance, held, layout, licence_allowed,
                      mail_from_address, open_app, post_json, same_origin, select, session, settle,
                      shipped_packages, style, tab_order, tap, text)

DANA = "dana@larchmere.example"
DANA_NAME = "Dana Whitcombe"
RAVI = "ravi@larchmere.example"
RAVI_NAME = "Ravi Okafor"
PAUL = "paul@ferrantepaint.example"
PRIYA = "priya.hale@example.com"
HALE = "Hale kitchen and bath"
ODUYA = "Oduya basement"
SEED_PASSWORD = "paper-plan-2026"
INITIAL_PASSWORD = "probe-initial-2026"
NEW_PASSWORD = "probe-changed-2026"
PROBE_PHONE = "555-0199"

CATALOGUE = {
    "too_large": (413, "That request is too large."),
    "cross_origin": (403, "Requests must come from Snaglight itself."),
    "unauthenticated": (401, "Sign in to continue."),
    "invalid_credentials": (401, "That email and password don't match."),
    "not_found": (404, "Not found."),
    "forbidden": (403, "You can't do that on this job."),
    "role_ended": (403, "Your access to this job has ended."),
    "outside_site_visit": (403, "Access codes show from 30 minutes before your next site visit."),
    "invalid_transition": (409, "That step isn't allowed from here."),
    "blocked": (409, "Finish the items this one is waiting on first."),
    "awaiting_trade": (409, "Waiting on the trade's completion photo."),
    "completion_photo_required": (409, "Add a completion photo before marking this done."),
    "bulk_failed": (409, "None of the items changed."),
    "items_not_verified": (409, "Every item must be verified before close-out."),
    "job_closed": (409, "This job is closed out."),
    "already_member": (409, "That person already has a role on this job."),
    "no_conflict": (409, "That field has no conflict to resolve."),
    "visit_overlap": (409, "That person already has a visit then."),
    "nothing_to_undo": (409, "You have no edit to undo on this note."),
    "nothing_to_redo": (409, "You have no undone edit to redo on this note."),
    "validation": (422, "Check the highlighted fields."),
    "photo_too_large": (413, "Images must be 10,000,000 bytes or smaller."),
    "unsupported_image": (415, "Use a JPEG, PNG or WebP image."),
    "storage_unavailable": (503, "Storage is unreachable; nothing was saved. Try again shortly."),
}
NOT_FOUND_BODY = {"error": "not_found", "message": CATALOGUE["not_found"][1]}
PIN_MSG = "Drop the pin inside a room on the plan."
PASSWORD_MSG = "New password must be at least 10 characters."
OVERLAP_MSG = "Rooms can't overlap."
CYCLE_MSG = "Items can't wait on each other in a circle."
COLLINEAR_MSG = "Pick three reference points that are not in a line."
OFFLINE_BANNER = "You're offline. Changes are saved on this phone and will sync when you reconnect."
PHOTOS_OFFLINE = "Photos need a connection."
EMPTY_ROOM = "No items in this room yet."
CONFLICT_HEADING = "Needs a decision"
NO_JOBS = "No jobs yet."
SIGNED_OUT = "You've been signed out."
NOT_FOUND_HEADING = "We can't find that page."
ROLE_ENDED_MSG = CATALOGUE["role_ended"][1]

SEED_ROOMS = {
    "Kitchen": [(0.04, 0.05), (0.52, 0.05), (0.52, 0.30), (0.40, 0.30), (0.40, 0.47), (0.04, 0.47)],
    "Primary bath": [(0.58, 0.05), (0.96, 0.05), (0.96, 0.45), (0.58, 0.45)],
    "Hall": [(0.04, 0.53), (0.44, 0.53), (0.44, 0.75), (0.50, 0.75), (0.50, 0.95), (0.04, 0.95)],
    "Laundry": [(0.50, 0.53), (0.96, 0.53), (0.96, 0.95), (0.50, 0.95)],
}
SEED_BOUNDS = {"Kitchen": (0.04, 0.05, 0.48, 0.42), "Primary bath": (0.58, 0.05, 0.38, 0.40),
               "Hall": (0.04, 0.53, 0.46, 0.42), "Laundry": (0.50, 0.53, 0.46, 0.42)}
SEED_ANCHORS = {"Kitchen": (0.28, 0.26), "Primary bath": (0.77, 0.25), "Hall": (0.24, 0.74), "Laundry": (0.73, 0.74)}
U_ROOM = [(0.10, 0.10), (0.20, 0.10), (0.20, 0.40), (0.40, 0.40), (0.40, 0.10), (0.50, 0.10), (0.50, 0.50), (0.10, 0.50)]
OUTSIDE = {"x": 0.55, "y": 0.50}
NOTCH = {"x": 0.46, "y": 0.40}
SHARED_EDGE = {"x": 0.50, "y": 0.85}
IN_LAUNDRY = {"x": 0.70, "y": 0.80}
IN_KITCHEN = {"x": 0.30, "y": 0.12}

ITEM_KEYS = {"id", "number", "title", "room_id", "trade", "status", "pin", "pin_status", "blocked_by", "cost_note", "quantity",
             "unit_cost", "line_total", "sent_back_reason", "conflicts", "created_by", "photos", "notes", "updated_at"}
TRADE_HIDDEN = {"cost_note", "quantity", "unit_cost", "line_total", "conflicts"}
NOTE_KEYS = {"id", "body", "audience", "author", "rev", "created_at"}
PHOTO_KEYS = {"id", "kind", "content_type", "bytes", "url", "uploaded_by", "created_at"}
JOB_KEYS = {"id", "name", "address", "time_zone", "status", "progress", "my_role", "my_trade", "plan_url", "plan_revision",
            "access_codes_available", "next_visit"}
MEMBER_FULL = {"id", "name", "role", "trade", "email", "phone"}
MEMBER_SHORT = {"id", "name", "role", "trade"}
TRADE_ORDER = ["electrical", "plumbing", "tile", "paint", "carpentry", "hvac", "flooring", None]
METADATA_MARKS = (b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"GPS")

NAME_MAX = 120
ADDRESS_MAX = 200
TITLE_MAX = 200
COST_NOTE_MAX = 1000
NOTE_MAX = 2000
CODE_MAX = 40
SEQ_MAX = 2147483647
SYNC_MAX = 200
BULK_MAX = 100
MAX_IMAGE = 10_000_000
JSON_LIMIT = 1_000_000
MULTIPART_LIMIT = 10_500_000
SERIES_MAX = 60
SPAN_DAYS = 180
SPAN_COUNT_OK = 46
CODE_LEAD_MIN = 30
WORK_FIRST_HOUR = 8
WORK_LAST_HOUR = 16

WIDE = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
SHEET_SHARE = 0.6
FRAME_SHARE = 0.6
PIN_PX = 2
TETHER_PX = 4
PAN_MS = 420
DRAW_MS = 320
PULSE_MS = 320
SHEET_MS = 320
DIALOG_MS = 180
HIGHLIGHT_MS = 180
MOTION_SLACK_MS = 60
TOL_MS = 60
REDUCED_MAX_MS = 60
PUBLISHED_MS = (HIGHLIGHT_MS, DIALOG_MS, DRAW_MS, PULSE_MS, SHEET_MS, PAN_MS)
LIVE_S = 2
SYNC_S = 5
REFRESH_S = 15

QUICK_MS = 250
ADVANCE_MS = 100
SAMPLE_MS = 20
UI_WAIT_S = 20
STREAM_WAIT_S = 10
MAIL_WAIT_S = 75
MAIL_GRACE_S = 6
SUMMARY_WAIT_S = 75
COPY_BOOT_S = 150
POLL_S = 0.25
HTTP_TIMEOUT = 30
TAB_PRESSES = 60
RETENTION_PROBE = 25
WORKING_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Brisbane", "Asia/Tokyo", "Asia/Shanghai",
                 "Asia/Bangkok", "Asia/Dhaka", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Africa/Johannesburg",
                 "Africa/Lagos", "Africa/Abidjan", "Atlantic/Cape_Verde", "America/Noronha", "America/Sao_Paulo",
                 "America/Caracas", "America/Bogota", "America/Guatemala", "America/Phoenix", "Pacific/Pitcairn",
                 "Pacific/Gambier", "Pacific/Honolulu", "Pacific/Pago_Pago"]

HTTPONLY = "HttpOnly"
SAMESITE = "SameSite"
SAMESITE_VALUE = "Lax"
COOKIE_PATH = "/"
TETHER_ATTR = "data-tether"
CROSSHAIR_ATTR = "data-crosshair"
BASE_TITLE = "Base title"
OWNER_TITLE = "Owner title"
PHONE_TITLE = "Phone title"
PHONE_NOTE = "Phone note"
OWNER_PIN = {"x": 0.20, "y": 0.40}
SYNC_TITLE_A = "Synced A"
SYNC_TITLE_B = "Synced B"
MARKER_ONE = "Marker one"
MARKER_TWO = "Marker two"
SECRET_COST = "Secret cost probe"
CREW_SECRET = "Crew secret probe"
EVERYONE_NOTE = "Everyone probe"
PRICE_NOTE = "Price probe"
OFFLINE_NOTE = "Offline note probe"
EMOJI_NOTE = "\U0001F527 tile"
EMOJI_INSERT = "new"
HALL_SCUFF = "Hall scuff"
DRAFT_TEXT = "Half typed"
MIRROR_TITLE = "Mirror renamed"
RELOADED_TITLE = "Reloaded title"
BASEMENT_TITLES = ("Basement one", "Basement two")
KEYBOARD_TITLES = ("Keyboard caulk", "Crew check")
COSTED_TITLE = "Costed item"
CO_DESC = "Skylight flashing"
CO_AMOUNT = "250.00"
CONTINGENCY = "10.00"
CODE_OFFBOARD = "L2020"
CODE_EXPIRE = "L8642"
CODE_SERIES = "L4444"
OCC_START = date(2030, 4, 1)
DST_SERIES_START = datetime(2030, 3, 4, 8, 0)
DST_DAYS = 10
PHOTO_GLOB = "**/photos"

_pause = threading.Event()


class Api:
    def __init__(self, base: str, email: str | None = None, password: str = SEED_PASSWORD):
        self.base = base.rstrip("/")
        self.email = email
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        if email:
            r = self.client.post("/api/session", json={"email": email, "password": password})
            assert r.status_code == 200, (email, r.status_code, r.text)

    def cookie(self) -> str:
        return self.client.cookies.get("snaglight_session")

    def request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        return self.client.request(method, path, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("PUT", path, **kw)

    def patch(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("PATCH", path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("DELETE", path, **kw)

    def ok(self, method: str, path: str, status: int = 200, **kw: Any) -> Any:
        r = self.request(method, path, **kw)
        assert r.status_code == status, (method, path, r.status_code, r.text[:2000])
        return r.json() if r.content else None


@dataclass
class Person:
    name: str
    email: str
    id: str
    api: Api


@dataclass
class Site:
    base: str
    id: str
    name: str
    tz: str
    owner: Api
    rooms: dict
    lead: Person | None = None
    elec: Person | None = None
    tile: Person | None = None
    home: Person | None = None

    @property
    def url(self) -> str:
        return f"/jobs/{self.id}"

    def path(self, suffix: str = "") -> str:
        return f"/api/jobs/{self.id}{suffix}"


def token(prefix: str) -> tuple[str, str]:
    tag = uuid.uuid4().hex[:10]
    return f"{prefix}-{tag}@probe.example", tag


def outline(corners: list) -> list[dict]:
    return [{"x": x, "y": y} for x, y in corners]


def flat(corners: list) -> list[float]:
    return [v for pair in corners for v in pair]


def refused(r: httpx.Response, code: str, field_name: str | None = None, message: str | None = None) -> dict:
    status, text_ = CATALOGUE[code]
    assert r.status_code == status, (code, r.status_code, r.text[:2000])
    body = r.json()
    assert body["error"] == code and body["message"] == text_, body
    if field_name:
        assert field_name in body.get("fields", {}), body
        if message:
            assert body["fields"][field_name] == message, body
    return body


def need(condition: Any, detail: Any) -> Any:
    if not condition:
        raise AssertionError(detail)
    return condition


def poll(fn: Callable[[], Any], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return fn()
        except (AssertionError, StopIteration, LookupError) as exc:
            if time.monotonic() > deadline:
                raise AssertionError(f"not reached within {seconds}s: {exc!r}") from exc
            _pause.wait(POLL_S)


def parallel(calls: list[Callable[[], Any]]) -> list[Any]:
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(c) for c in calls]
        return [f.result() for f in futures]


def add_person(base: str, owner: Api, job_id: str, label: str, role: str, trade: str | None) -> Person:
    email, tag = token(label)
    name = f"{label.title()} {tag}"
    m = owner.ok("POST", f"/api/jobs/{job_id}/members", 201, json={
        "name": name, "email": email, "phone": PROBE_PHONE, "role": role, "trade": trade, "initial_password": INITIAL_PASSWORD})
    return Person(name, email, m["id"], Api(base, email, INITIAL_PASSWORD))


def make_site(base: str, plan: bool = True, rooms: dict | None = None, people: bool = True, tz: str = "America/Chicago") -> Site:
    rooms = SEED_ROOMS if rooms is None else rooms
    owner = Api(base, DANA)
    _, tag = token("job")
    job = owner.ok("POST", "/api/jobs", 201, json={"name": f"Job {tag}", "address": f"{tag} Probe Lane", "time_zone": tz})
    site = Site(base.rstrip("/"), job["id"], job["name"], tz, owner, {})
    if plan:
        owner.ok("PUT", site.path("/plan"), files={"file": ("plan.png", png(), "image/png")})
    for name, corners in rooms.items():
        site.rooms[name] = owner.ok("POST", site.path("/rooms"), 201, json={"name": name, "outline": outline(corners)})
    if people:
        site.lead = add_person(base, owner, site.id, "lead", "lead", None)
        site.elec = add_person(base, owner, site.id, "sparks", "trade", "electrical")
        site.tile = add_person(base, owner, site.id, "tiler", "trade", "tile")
        site.home = add_person(base, owner, site.id, "home", "homeowner", None)
    return site


def ipath(s: Site, it: dict, suffix: str = "") -> str:
    return s.path(f"/items/{it['id']}{suffix}")


def add_item(s: Site, api: Api, title: str, room: str = "Kitchen", **fields: Any) -> dict:
    return api.ok("POST", s.path("/items"), 201, json={"title": title, "room_id": s.rooms[room]["id"], **fields})


def get_item(s: Site, api: Api, it: dict) -> dict:
    return api.ok("GET", ipath(s, it))


def room_name(s: Site, room_id: str) -> str:
    return {r["id"]: n for n, r in s.rooms.items()}[room_id]


def member_ids(s: Site) -> dict:
    return {m["email"]: m["id"] for m in s.owner.ok("GET", s.path("/members"))["members"]}


def act(s: Site, api: Api, it: dict, action: str, reason: str | None = None) -> httpx.Response:
    body: dict = {"action": action}
    if reason is not None:
        body["reason"] = reason
    return api.post(ipath(s, it, "/actions"), json=body)


def op(kind: str, seq: int, **kw: Any) -> dict:
    return {"op_id": str(uuid.uuid4()), "seq": seq, "type": kind, **kw}


def sync(s: Site, api: Api, *ops: dict) -> httpx.Response:
    return api.post(s.path("/sync"), json={"ops": list(ops)})


def visit(s: Site, api: Api, person: Person, starts: str, ends: str, recurrence: dict | None = None) -> httpx.Response:
    return api.post(s.path("/visits"), json={"member_id": person.id, "starts_at": starts, "ends_at": ends, "recurrence": recurrence})


def upload(s: Site, api: Api, it: dict, kind: str, data: bytes, name: str = "photo.png", ctype: str = "image/png") -> httpx.Response:
    return api.post(ipath(s, it, "/photos"), files={"file": (name, data, ctype), "kind": (None, kind)})


def server_now(base: str) -> datetime:
    r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def working_zone(base: str) -> tuple[str, datetime]:
    now = server_now(base)
    for zone in WORKING_ZONES:
        local = now.astimezone(ZoneInfo(zone))
        if WORK_FIRST_HOUR <= local.hour < WORK_LAST_HOUR:
            return zone, local.replace(tzinfo=None)
    raise AssertionError("no zone in working hours")


def recount(o: Api, s: Site) -> tuple[dict, dict]:
    rooms = {r["id"]: {"verified": 0, "total": 0} for r in o.ok("GET", s.path("/rooms"))["rooms"]}
    verified = total = 0
    for it in o.ok("GET", s.path("/items"))["items"]:
        rooms[it["room_id"]]["total"] += 1
        total += 1
        if it["status"] == "verified":
            rooms[it["room_id"]]["verified"] += 1
            verified += 1
    return rooms, {"verified": verified, "total": total, "percent": verified * 100 // total if total else 0}


def money(value: Decimal) -> str:
    q = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
    return f"{q + 0:.2f}"


def line_total(q: str | None, u: str | None) -> str:
    return "0.00" if q is None or u is None else money(Decimal(q) * Decimal(u))


def dollars(amount: str) -> str:
    d = Decimal(amount)
    return f"{'-' if d < 0 else ''}${abs(d):,.2f}"


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(shade: int = 0, extra: bytes = b"") -> bytes:
    w, h = 60, 40
    raw = b"".join(b"\x00" + bytes([shade % 256, 120, 200]) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + extra
            + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b""))


def png_of_size(n: int) -> bytes:
    pad = n - len(png()) - 12
    data = png(extra=_chunk(b"paDd", b"\x00" * pad))
    assert len(data) == n
    return data


def gps_png() -> bytes:
    tiff = b"MM\x00\x2a\x00\x00\x00\x08\x00\x00\x00\x00\x00\x00GPS"
    return png(extra=_chunk(b"eXIf", tiff) + _chunk(b"tEXt", b"Comment\x00GPS 41.88N 87.63W"))


def inbox(mail: Any, email: str, expected: int, wait: float = MAIL_WAIT_S) -> list[dict]:
    mine = lambda: [m for m in mail.messages(0, 0.5) if email in addresses(m.get("To"))]
    deadline = time.monotonic() + wait
    found = mine()
    while len(found) < expected and time.monotonic() < deadline:
        _pause.wait(POLL_S * 4)
        found = mine()
    if len(found) >= expected:
        found = [m for m in mail.messages(0, 1.5) if email in addresses(m.get("To"))]
    return found


def body_lines(message: dict) -> list[str]:
    return text(message).replace("\r\n", "\n").rstrip("\n").split("\n")


@dataclass
class Event:
    id: int
    type: str
    data: Any


class Stream:
    def __init__(self, api: Api, job_id: str, after: int | None = None, last_event_id: int | None = None):
        self.events: list[Event] = []
        self.cursor = 0
        self.status: int | None = None
        self.body = ""
        self.done = threading.Event()
        self._ready = threading.Event()
        self._cond = threading.Condition()
        params = {"after": after} if after is not None else {}
        headers = {"Last-Event-ID": str(last_event_id)} if last_event_id is not None else {}
        self.client = httpx.Client(base_url=api.base, cookies=api.client.cookies, timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        threading.Thread(target=self._run, args=(job_id, params, headers), daemon=True).start()
        assert self._ready.wait(HTTP_TIMEOUT), "stream never answered"

    def _run(self, job_id: str, params: dict, headers: dict) -> None:
        try:
            with self.client.stream("GET", f"/api/jobs/{job_id}/events", params=params, headers=headers) as r:
                self.status = r.status_code
                if r.status_code != 200:
                    self.body = r.read().decode()
                    return
                self._ready.set()
                frame: dict[str, str] = {}
                for line in r.iter_lines():
                    if line == "":
                        if "data" in frame or "event" in frame:
                            with self._cond:
                                self.events.append(Event(int(frame.get("id", "0") or 0), frame.get("event", "message"),
                                                         json.loads(frame.get("data", "null"))))
                                self._cond.notify_all()
                        frame = {}
                        continue
                    if line.startswith(":"):
                        continue
                    key, _, value = line.partition(":")
                    value = value[1:] if value.startswith(" ") else value
                    frame[key] = frame[key] + "\n" + value if key == "data" and key in frame else value
        except Exception:
            pass
        finally:
            self._ready.set()
            self.done.set()
            with self._cond:
                self._cond.notify_all()

    def until(self, pred: Callable[[Event], bool], seconds: float = STREAM_WAIT_S) -> list[Event]:
        deadline = time.monotonic() + seconds
        with self._cond:
            while True:
                for i in range(self.cursor, len(self.events)):
                    if pred(self.events[i]):
                        out = self.events[self.cursor:i + 1]
                        self.cursor = i + 1
                        return out
                left = deadline - time.monotonic()
                if left <= 0 or (self.done.is_set() and self.cursor >= len(self.events)):
                    raise AssertionError(f"no matching event; saw {[(e.id, e.type) for e in self.events[self.cursor:]]}")
                self._cond.wait(min(left, POLL_S * 4))

    def close(self) -> None:
        self.client.close()


def item_event(title: str) -> Callable[[Event], bool]:
    return lambda e: e.type == "item" and e.data["item"]["title"] == title


def _enter(obj: Any) -> Any:
    return obj if hasattr(obj, "__enter__") else contextmanager(lambda: obj)()


@contextmanager
def ui(browser: Browser, base: str, api: Api | None, path: str, size: tuple[int, int] = WIDE, reduced: bool = False) -> Iterator[Page]:
    base = base.rstrip("/")
    with _enter(open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference")) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if api:
            page.context.add_cookies([{"name": "snaglight_session", "value": api.cookie(), "url": base}])
        page.goto(base + path)
        yield page


@contextmanager
def holding(page: Page, url_glob: str) -> Iterator[Any]:
    with _enter(held(page, url_glob)) as gate:
        yield gate


def eventually(page: Page, check: Callable[[], Any], seconds: float = UI_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check()
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, ADVANCE_MS)
            _pause.wait(POLL_S)


def paced(page: Page, check: Callable[[], Any], seconds: float) -> Any:
    deadline = last = time.monotonic()
    deadline += seconds
    while True:
        try:
            return check()
        except AssertionError:
            now = time.monotonic()
            if now > deadline:
                raise
            advance(page, max(ADVANCE_MS, (now - last) * 1000))
            last = now
            _pause.wait(POLL_S)


def visible(page: Page, loc: Locator, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=QUICK_MS), seconds)


def gone(page: Page, loc: Locator, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: expect(loc).to_have_count(0, timeout=QUICK_MS), seconds)


def shows(page: Page, loc: Locator, wanted: Any, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: expect(loc).to_have_text(wanted, timeout=QUICK_MS), seconds)


def activity(page: Page) -> Locator:
    return page.get_by_role("status", name="Activity")


def job_ready(page: Page, s: Site) -> None:
    visible(page, page.get_by_role("heading", level=1, name=s.name))


def zulu(text: str) -> str:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def go_offline(page: Page) -> None:
    page.context.set_offline(True)
    shows(page, page.get_by_role("status", name="Connection"), OFFLINE_BANNER)


def row(page: Page, it: dict, title: str | None = None) -> Locator:
    return page.get_by_role("listitem", name=f"Item {it['number']}: {title or it['title']}", exact=True)


ROW_POINT_JS = """e => {
  const own = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=checkbox],'
    + '[role=radio],[role=switch],[role=menuitem],[role=tab],[role=combobox],[contenteditable=""],[contenteditable=true]';
  const r = e.getBoundingClientRect();
  const free = (x, y) => { const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === e || e.contains(hit))) return false;
    const c = hit.closest(own); return !c || c === e || !e.contains(c); };
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  if (free(cx, cy)) return {x: cx, y: cy};
  for (let fy = 0.1; fy < 0.95; fy += 0.1) for (let fx = 0.05; fx < 0.98; fx += 0.05) {
    const x = r.x + fx * r.width, y = r.y + fy * r.height; if (free(x, y)) return {x, y}; }
  return null;
}"""


def row_point(locator: Locator) -> tuple[float, float]:
    expect(locator).to_be_visible()
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    point = locator.evaluate(ROW_POINT_JS)
    assert point is not None, "no part of the row outside its controls can be clicked"
    return point["x"], point["y"]


def click_row(locator: Locator) -> None:
    locator.page.mouse.click(*row_point(locator))


def tap_row(locator: Locator) -> None:
    locator.page.touchscreen.tap(*row_point(locator))


def room_row(page: Page, room: str, it: dict) -> Locator:
    return page.get_by_role("list", name=f"{room} items").get_by_role("listitem", name=f"Item {it['number']}: {it['title']}", exact=True)


def details(page: Page, it: dict) -> Locator:
    return page.get_by_role("region", name=f"Item {it['number']} details")


def pin_button(page: Page, it: dict) -> Locator:
    return page.get_by_role("button", name=f"Pin {it['number']}: {it['title']}", exact=True)


def plan_img(page: Page, s: Site) -> Locator:
    return page.get_by_role("img", name=f"Floor plan of {s.name}")


MARK_JS = """([attr, value]) => [...document.querySelectorAll('*')]
  .filter(e => e.hasAttribute(attr) && (value === null || e.getAttribute(attr) === value))
  .map(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return {x: r.x, y: r.y, width: r.width, height: r.height,
            shown: r.width + r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0}; })"""


def marks(page: Page, attr: str, value: str | None = None) -> list[dict]:
    return [m for m in page.evaluate(MARK_JS, [attr, value]) if m["shown"]]


def pin_text(p: dict) -> str:
    return f"{round(p['x'] * 100)}%, {round(p['y'] * 100)}%"


def at_point(box: dict, x: float, y: float) -> tuple[float, float]:
    return box["x"] + x * box["width"], box["y"] + y * box["height"]


def covers(box: dict, point: tuple[float, float]) -> bool:
    return (box["x"] - PIN_PX <= point[0] <= box["x"] + box["width"] + PIN_PX
            and box["y"] - PIN_PX <= point[1] <= box["y"] + box["height"] + PIN_PX)


def tap_at(page: Page, x: float, y: float) -> None:
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def framed(page: Page, s: Site, room: str, img: Locator) -> bool:
    ib = img.bounding_box()
    pane = page.get_by_role("region", name="Plan").bounding_box()
    b = s.rooms[room]["bounds"]
    rx, ry = ib["x"] + b["x"] * ib["width"], ib["y"] + b["y"] * ib["height"]
    rw, rh = b["w"] * ib["width"], b["h"] * ib["height"]
    inside = (rx >= pane["x"] - PIN_PX and ry >= pane["y"] - PIN_PX and rx + rw <= pane["x"] + pane["width"] + PIN_PX
              and ry + rh <= pane["y"] + pane["height"] + PIN_PX)
    return inside and (rw >= FRAME_SHARE * pane["width"] or rh >= FRAME_SHARE * pane["height"])


GROUP_JS = """h => {
  const isH = n => n.nodeType === 1 && (n.tagName === 'H2' || (n.getAttribute('role') === 'heading' && n.getAttribute('aria-level') === '2'));
  const count = n => [...n.querySelectorAll('*')].filter(isH).length;
  let e = h;
  while (e.parentElement && count(e.parentElement) === 1) e = e.parentElement;
  if (e !== h) return e.innerText;
  let out = h.innerText;
  for (let s = h.nextElementSibling; s && !isH(s) && !count(s); s = s.nextElementSibling) out += '\\n' + s.innerText;
  return out;
}"""


def group_text(page: Page, room: str) -> str:
    heading = page.get_by_role("region", name="Punch list").get_by_role("heading", level=2, name=re.compile(f"^{re.escape(room)}$", re.I))
    return heading.evaluate(GROUP_JS)


def group_has(page: Page, room: str, wanted: str) -> Callable[[], None]:
    return lambda: need(wanted in group_text(page, room), (room, wanted, group_text(page, room)))


def plan_label(page: Page, room: str) -> tuple[int, int]:
    region = page.get_by_role("region", name="Plan")
    txt = region.inner_text() + "\n" + (region.text_content() or "")
    m = re.search(rf"{re.escape(room)}\W*(\d+)\s*/\s*(\d+)", txt, re.I)
    assert m, (room, txt)
    return int(m.group(1)), int(m.group(2))


def text_input(scope: Locator, label: str) -> Locator:
    loc = scope.get_by_label(label, exact=True)
    for i in range(loc.count()):
        el = loc.nth(i)
        if el.evaluate("e => e.tagName === 'INPUT' && !['checkbox', 'radio'].includes(e.type)"):
            return el
    return loc.first


def fill_local(loc: Locator, when: datetime) -> None:
    kind = loc.get_attribute("type") or ""
    loc.fill(when.strftime("%Y-%m-%dT%H:%M") if kind == "datetime-local" else when.strftime("%Y-%m-%d %H:%M"))


MOTION_JS = """(targets) => {
  window.__mt = {pin: targets ? targets[0] : null, img: targets ? targets[1] : null};
  if (window.__motionWrapped) return;
  window.__motionWrapped = true;
  window.__motions = [];
  const seen = new WeakSet();
  const kindOf = (el) => {
    const t = window.__mt || {};
    if (!el || !el.closest) return 'other';
    if (el.closest('[data-tether]') || (el.querySelector && el.querySelector('[data-tether]'))) return 'tether';
    if (t.pin && (t.pin === el || t.pin.contains(el))) return 'pin';
    if (t.img && (t.img === el || el.contains(t.img))) return 'pan';
    return 'other';
  };
  const record = (anim, el) => {
    if (!anim || seen.has(anim)) return;
    seen.add(anim);
    const timing = anim.effect ? anim.effect.getComputedTiming() : {};
    window.__motions.push({kind: kindOf(el), ms: Number(timing.duration) || 0, delay: Number(timing.delay) || 0,
                           loops: timing.iterations === Infinity, t: document.timeline.currentTime});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); record(a, this); return a; };
  const scan = (e) => { const el = e.target; if (el && el.getAnimations) el.getAnimations().forEach(a => record(a, el)); };
  ['transitionrun', 'animationstart'].forEach(n => document.addEventListener(n, scan, true));
}"""


RING_AREA = 9
RING_JS = """(pin, maxArea) => {
  const p = pin.getBoundingClientRect();
  const cx = p.x + p.width / 2, cy = p.y + p.height / 2, area = Math.max(p.width * p.height, 1);
  const near = [...document.querySelectorAll('*')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width * r.height > 0 && r.width * r.height <= maxArea * area
      && r.left <= cx && cx <= r.right && r.top <= cy && cy <= r.bottom;
  });
  const sig = (s, tag) => {
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineStyle + s.outlineWidth + s.outlineColor : '';
    const border = ['Top', 'Right', 'Bottom', 'Left'].map(k => s['border' + k + 'Style'] !== 'none' && parseFloat(s['border' + k + 'Width']) > 0
      ? s['border' + k + 'Width'] + s['border' + k + 'Color'] : '').join('|');
    const stroke = s.stroke && s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0 ? s.stroke + s.strokeWidth : '';
    const shadow = s.boxShadow !== 'none' ? s.boxShadow : '';
    const body = [outline, border, stroke, shadow].join('#');
    return body.replace(/[#|]/g, '') === '' ? '' : tag + body;
  };
  const out = [];
  near.forEach((e, i) => {
    out.push(sig(getComputedStyle(e), i + ':'));
    ['::before', '::after'].forEach(p => {
      const s = getComputedStyle(e, p);
      if (s.content && s.content !== 'none' && s.display !== 'none') out.push(sig(s, i + p));
    });
  });
  return out.filter(x => x !== '').sort();
}"""


def record_motion(page: Page, pin: Locator, img: Locator) -> None:
    page.evaluate(MOTION_JS, [pin.element_handle(), img.element_handle()])


def motions(page: Page) -> list[dict]:
    return page.evaluate("() => window.__motions || []")


def step_samples(page: Page, img: Locator, pin: Locator, tether: Callable[[], list]) -> list[dict]:
    out, t = [], 0.0
    for _ in range(int((PAN_MS + DRAW_MS + PULSE_MS) * 1.5 / SAMPLE_MS)):
        advance(page, SAMPLE_MS)
        t += SAMPLE_MS
        ib = img.bounding_box()
        out.append({"t": t, "img": (round(ib["x"], 1), round(ib["y"], 1), round(ib["width"], 1), round(ib["height"], 1)),
                    "pin": pin.bounding_box(), "tether": bool(tether())})
    return out


def measured(log: list[dict], kind: str, expected: float, fallback: float | None) -> float | None:
    found = [m["ms"] for m in log if m["kind"] == kind and m["ms"] > REDUCED_MAX_MS]
    return min(found, key=lambda v: abs(v - expected)) if found else fallback


SEED_ITEMS = {
    1: ("Kitchen", "Touch-up paint by the window", "paint", "open", (0.30, 0.12), "Leftover wall paint in garage; no charge", RAVI_NAME),
    2: ("Kitchen", "Pendant over island flickers", "electrical", "in_progress", (0.24, 0.30), "Fixture under supplier warranty", RAVI_NAME),
    3: ("Primary bath", "Regrout shower corner", "tile", "in_progress", (0.86, 0.16), None, RAVI_NAME),
    4: ("Primary bath", "Caulk gap behind vanity", None, "open", (0.70, 0.32), None, RAVI_NAME),
    5: ("Hall", "Outlet cover missing by closet", "electrical", "open", None, None, DANA_NAME),
    6: ("Hall", "Door sticks at the head", None, "verified", (0.20, 0.72), None, RAVI_NAME),
}
SEED_COUNTS = {"Kitchen": (0, 2), "Primary bath": (0, 2), "Hall": (1, 2), "Laundry": (0, 0)}
SEED_MEMBERS = {DANA, RAVI, "marco@brightwire.example", "tess@lindqvisttile.example", PAUL, PRIYA}


def seed_snapshot(base: str) -> dict:
    o = Api(base, DANA)
    jobs = {j["name"]: j for j in o.ok("GET", "/api/jobs")["jobs"]}
    hale, oduya = jobs[HALE], jobs[ODUYA]
    hp = lambda suffix="": f"/api/jobs/{hale['id']}{suffix}"
    return {
        "hale": hale, "oduya": oduya,
        "rooms": o.ok("GET", hp("/rooms"))["rooms"],
        "items": o.ok("GET", hp("/items"))["items"],
        "visits": o.ok("GET", hp("/visits"))["visits"],
        "revisions": o.ok("GET", hp("/plan/revisions"))["revisions"],
        "change_orders": o.ok("GET", hp("/change-orders"))["change_orders"],
        "members": o.ok("GET", hp("/members"))["members"],
        "oduya_rooms": o.ok("GET", f"/api/jobs/{oduya['id']}/rooms")["rooms"],
        "oduya_items": o.ok("GET", f"/api/jobs/{oduya['id']}/items")["items"],
    }


def test_seed_data_exact(app_url):
    snap = seed_snapshot(app_url)
    hale, o = snap["hale"], Api(app_url, DANA)
    assert (hale["address"], hale["time_zone"], hale["status"], hale["plan_revision"]) == ("14 Orchard Lane, Maple Falls", "America/Chicago", "active", 1)
    assert hale["progress"] == {"verified": 1, "total": 6, "percent": 16}
    assert [r["name"] for r in snap["rooms"]] == list(SEED_ROOMS)
    for r in snap["rooms"]:
        name = r["name"]
        assert flat([(c["x"], c["y"]) for c in r["outline"]]) == pytest.approx(flat(SEED_ROOMS[name]))
        assert (r["bounds"]["x"], r["bounds"]["y"], r["bounds"]["w"], r["bounds"]["h"]) == pytest.approx(SEED_BOUNDS[name])
        assert (r["anchor"]["x"], r["anchor"]["y"]) == pytest.approx(SEED_ANCHORS[name])
        assert (r["counts"]["verified"], r["counts"]["total"]) == SEED_COUNTS[name]
    names = {r["id"]: r["name"] for r in snap["rooms"]}
    items = {i["number"]: i for i in snap["items"]}
    assert sorted(items) == sorted(SEED_ITEMS)
    for n, (room, title, trade, status, pin, cost_note, by) in SEED_ITEMS.items():
        it = items[n]
        assert (names[it["room_id"]], it["title"], it["trade"], it["status"], it["cost_note"], it["created_by"]["name"]) == (room, title, trade, status, cost_note, by)
        assert (it["pin"] is None) == (pin is None) and it["pin_status"] == ("unpinned" if pin is None else "placed")
        if pin:
            assert (it["pin"]["x"], it["pin"]["y"]) == pytest.approx(pin)
        assert (it["quantity"], it["unit_cost"], it["blocked_by"], it["photos"]) == (None, None, [], [])
    assert [(x["body"], x["audience"], x["author"]["name"], x["rev"]) for x in items[2]["notes"]] == [
        ("Marco thinks it's the dimmer; bring a spare.", "crew", RAVI_NAME, 0)]
    first = items[1]["notes"]
    assert [(x["body"], x["audience"], x["author"]["name"], x["rev"]) for x in first] == [
        ("There's also a scuff on the base cabinet.", "everyone", "Priya Hale", 0)]
    assert [(x["body"], x["audience"], x["author"]["name"]) for x in first[0]["replies"]] == [
        ("We'll cover it with the window touch-up.", "everyone", RAVI_NAME)]
    assert {m["email"] for m in snap["members"]} == SEED_MEMBERS
    card = o.ok("GET", f"/api/jobs/{hale['id']}/access")
    assert (card["lockbox_code"], card["alarm_code"], card["garage_code"], card["house_note"]) == (
        "4826", "7319", "5550", "Biscuit the dog stays in the laundry room; keep that door shut.")
    assert len(snap["visits"]) == 1
    v = snap["visits"][0]
    assert (v["member_name"], v["recurrence"], v["starts_at"], v["ends_at"]) == ("Marco Ruiz", None, "2030-03-04T08:00:00", "2030-03-04T12:00:00")
    assert len(v["occurrences"]) == 1
    assert snap["change_orders"] == []
    costs = o.ok("GET", f"/api/jobs/{hale['id']}/costs")
    assert (costs["total"], costs["contingency_percent"]) == ("0.00", "0.00")
    assert [(r["revision"], r["uploaded_by"]["name"], r["moved"], r["needs_review"]) for r in snap["revisions"]] == [(1, DANA_NAME, 0, 0)]
    assert len(S3().keys(f"jobs/{hale['id']}/plan/")) == 1
    oduya = snap["oduya"]
    assert (oduya["address"], oduya["time_zone"], oduya["status"]) == ("9 Quarry Road, Ridgeview", "America/Denver", "active")
    assert [r["name"] for r in snap["oduya_rooms"]] == ["Rec room", "Utility"]
    assert [(i["number"], i["title"]) for i in snap["oduya_items"]] == [(1, "Baseboard gap at stair"), (2, "Label the panel circuits")]
    with app_copy({}) as url:
        again = seed_snapshot(url)
        for key in ("rooms", "visits", "revisions", "change_orders", "oduya_rooms", "oduya_items"):
            assert again[key] == snap[key], key
        assert sorted(i["number"] for i in again["items"]) == sorted(SEED_ITEMS)
        assert {m["email"] for m in again["members"]} == SEED_MEMBERS
        assert len(S3().keys(f"jobs/{hale['id']}/plan/")) == 1


def test_sign_in(app_url):
    base = app_url.rstrip("/")
    r = httpx.post(base + "/api/session", json={"email": DANA, "password": SEED_PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"user": {"name": DANA_NAME, "email": DANA, "is_owner": True}}
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("snaglight_session=")
    attrs = {k.strip().lower(): v.strip() for k, _, v in (p.partition("=") for p in cookie.split(";")[1:])}
    assert HTTPONLY.lower() in attrs
    assert attrs[SAMESITE.lower()].lower() == SAMESITE_VALUE.lower() and attrs["path"] == COOKIE_PATH
    ravi = Api(app_url, RAVI)
    assert ravi.ok("GET", "/api/me") == {"user": {"name": RAVI_NAME, "email": RAVI, "is_owner": False}}
    refused(httpx.post(base + "/api/session", json={"email": DANA, "password": "not-the-password"}, timeout=HTTP_TIMEOUT), "invalid_credentials")
    refused(httpx.post(base + "/api/session", json={"email": token("nobody")[0], "password": SEED_PASSWORD}, timeout=HTTP_TIMEOUT), "invalid_credentials")
    refused(httpx.post(base + "/api/session", json={"email": DANA}, timeout=HTTP_TIMEOUT), "validation")
    refused(httpx.get(base + "/api/me", timeout=HTTP_TIMEOUT), "unauthenticated")
    me = Api(app_url, DANA)
    assert me.delete("/api/session").status_code == 204
    refused(me.get("/api/me"), "unauthenticated")


def test_jobs(app_url):
    o = Api(app_url, DANA)
    _, tag = token("job")
    job = o.ok("POST", "/api/jobs", 201, json={"name": f"Jobs {tag}", "address": f"{tag} Probe Lane", "time_zone": "America/Denver"})
    assert set(job) == JOB_KEYS
    assert (job["name"], job["address"], job["time_zone"], job["status"], job["my_role"]) == (
        f"Jobs {tag}", f"{tag} Probe Lane", "America/Denver", "active", "owner")
    assert job["progress"] == {"verified": 0, "total": 0, "percent": 0}
    assert job["plan_url"] is None and job["plan_revision"] is None
    assert o.ok("GET", f"/api/jobs/{job['id']}/rooms")["rooms"] == []
    assert o.ok("GET", f"/api/jobs/{job['id']}/items")["items"] == []
    listed = [j["name"] for j in o.ok("GET", "/api/jobs")["jobs"]]
    assert listed.index(f"Jobs {tag}") < listed.index(HALE) and ODUYA in listed
    hale = next(j for j in o.ok("GET", "/api/jobs")["jobs"] if j["name"] == HALE)
    assert hale["progress"] == {"verified": 1, "total": 6, "percent": 16}
    good = {"name": "Valid", "address": "1 Probe Lane", "time_zone": "America/Chicago"}
    for bad, key in (({"name": ""}, "name"), ({"name": "x" * (NAME_MAX + 1)}, "name"), ({"address": ""}, "address"),
                     ({"address": "x" * (ADDRESS_MAX + 1)}, "address"), ({"time_zone": "Mars/Olympus"}, "time_zone")):
        refused(o.post("/api/jobs", json={**good, **bad}), "validation", key)
    refused(Api(app_url, RAVI).post("/api/jobs", json=good), "forbidden")
    priya = Api(app_url, PRIYA)
    assert [j["name"] for j in priya.ok("GET", "/api/jobs")["jobs"]] == [HALE]
    oduya = next(j for j in o.ok("GET", "/api/jobs")["jobs"] if j["name"] == ODUYA)
    assert priya.get(f"/api/jobs/{oduya['id']}").json() == NOT_FOUND_BODY
    s = make_site(app_url, plan=False, rooms={})
    assert [j["id"] for j in s.home.api.ok("GET", "/api/jobs")["jobs"]] == [s.id]
    assert s.home.api.ok("GET", s.path())["my_role"] == "homeowner"


def test_floor_plan_and_rooms(app_url):
    s = make_site(app_url, plan=False, rooms={}, people=False)
    o = s.owner
    refused(o.get(s.path("/plan")), "not_found")
    job = o.ok("PUT", s.path("/plan"), files={"file": ("plan.png", png(shade=20), "image/png")})
    assert job["plan_revision"] == 1 and job["plan_url"] == f"/api/jobs/{s.id}/plan"
    keys = S3().keys(f"jobs/{s.id}/plan/")
    assert len(keys) == 1 and keys[0].endswith(".png")
    served = o.get(job["plan_url"])
    assert served.status_code == 200 and served.headers["content-type"].split(";")[0].endswith("png")
    assert served.content == S3().get(keys[0])
    kitchen = o.ok("POST", s.path("/rooms"), 201, json={"name": "Kitchen", "outline": outline(SEED_ROOMS["Kitchen"])})
    assert flat([(c["x"], c["y"]) for c in kitchen["outline"]]) == pytest.approx(flat(SEED_ROOMS["Kitchen"]))
    assert (kitchen["bounds"]["x"], kitchen["bounds"]["y"], kitchen["bounds"]["w"], kitchen["bounds"]["h"]) == pytest.approx(SEED_BOUNDS["Kitchen"])
    assert (kitchen["anchor"]["x"], kitchen["anchor"]["y"]) == pytest.approx(SEED_ANCHORS["Kitchen"])
    assert kitchen["counts"] == {"verified": 0, "total": 0}
    bath = o.ok("POST", s.path("/rooms"), 201, json={"name": "Primary bath", "outline": outline(SEED_ROOMS["Primary bath"])})
    assert (bath["anchor"]["x"], bath["anchor"]["y"]) == pytest.approx(SEED_ANCHORS["Primary bath"])
    notch = [(0.40, 0.30), (0.52, 0.30), (0.52, 0.47), (0.40, 0.47)]
    o.ok("POST", s.path("/rooms"), 201, json={"name": "Nook", "outline": outline(notch)})
    for name, corners in (("Twin", SEED_ROOMS["Kitchen"]),
                          ("Cross", [(0.70, 0.02), (0.80, 0.02), (0.80, 0.48), (0.70, 0.48)]),
                          ("Pantry", [(0.30, 0.10), (0.50, 0.10), (0.50, 0.20), (0.30, 0.20)])):
        refused(o.post(s.path("/rooms"), json={"name": name, "outline": outline(corners)}), "validation", "outline", OVERLAP_MSG)
    bad_outlines = [
        [(0.05, 0.6), (0.2, 0.6), (0.2, 0.7)],
        [(0.05 + 0.01 * i, 0.6) for i in range(13)],
        [(0.05, 0.6), (0.2, 0.6), (0.3, 0.7), (0.05, 0.7)],
        [(0.05, 0.6), (0.05, 0.6), (0.2, 0.6), (0.2, 0.7), (0.05, 0.7)],
        [(0.05, 0.6), (1.2, 0.6), (1.2, 0.7), (0.05, 0.7)],
        [(0.05, 0.6), (0.12345, 0.6), (0.12345, 0.7), (0.05, 0.7)],
    ]
    for i, corners in enumerate(bad_outlines):
        refused(o.post(s.path("/rooms"), json={"name": f"Bad {i}", "outline": outline(corners)}), "validation", "outline")
    strip = [(0.05, 0.96), (0.10, 0.96), (0.10, 0.99), (0.05, 0.99)]
    refused(o.post(s.path("/rooms"), json={"name": "Kitchen", "outline": outline(strip)}), "validation", "name")
    stairs = [(0.05, 0.55), (0.15, 0.55), (0.15, 0.60), (0.25, 0.60), (0.25, 0.65), (0.35, 0.65), (0.35, 0.70),
              (0.45, 0.70), (0.45, 0.75), (0.55, 0.75), (0.55, 0.95), (0.05, 0.95)]
    o.ok("POST", s.path("/rooms"), 201, json={"name": "Stairs", "outline": outline(stairs)})
    assert [r["name"] for r in o.ok("GET", s.path("/rooms"))["rooms"]] == ["Kitchen", "Primary bath", "Nook", "Stairs"]
    u = make_site(app_url, plan=False, rooms={}, people=False)
    room = u.owner.ok("POST", u.path("/rooms"), 201, json={"name": "U room", "outline": outline(U_ROOM)})
    assert (room["anchor"]["x"], room["anchor"]["y"]) == pytest.approx((0.15, 0.30))
    lead = add_person(app_url, o, s.id, "lead", "lead", None)
    refused(lead.api.post(s.path("/rooms"), json={"name": "Lead room", "outline": outline(U_ROOM)}), "forbidden")


def test_people_on_a_job(app_url):
    s = make_site(app_url, plan=False, rooms={})
    o = s.owner
    members = {m["email"]: m for m in o.ok("GET", s.path("/members"))["members"]}
    assert (members[s.elec.email]["role"], members[s.elec.email]["trade"]) == ("trade", "electrical")
    assert (members[s.home.email]["role"], members[s.home.email]["trade"]) == ("homeowner", None)
    assert members[s.lead.email]["role"] == "lead" and members[DANA]["role"] == "owner"
    email, _ = token("new")
    base = {"name": "Probe Person", "email": email, "phone": PROBE_PHONE, "initial_password": INITIAL_PASSWORD}
    refused(o.post(s.path("/members"), json={**base, "role": "trade", "trade": None}), "validation", "trade")
    refused(o.post(s.path("/members"), json={**base, "role": "homeowner", "trade": "tile"}), "validation", "trade")
    refused(o.post(s.path("/members"), json={**base, "role": "homeowner", "trade": None, "initial_password": None}), "validation", "initial_password")
    refused(o.post(s.path("/members"), json={**base, "role": "homeowner", "trade": None, "initial_password": "short-pw1"}), "validation", "initial_password")
    o.ok("POST", s.path("/members"), 201, json={"name": "No Phone", "email": email, "role": "homeowner", "trade": None, "initial_password": INITIAL_PASSWORD})
    Api(app_url, email, INITIAL_PASSWORD)
    paul = o.ok("POST", s.path("/members"), 201, json={"name": "Paul Ferrante", "email": PAUL, "role": "trade", "trade": "paint"})
    assert paul["trade"] == "paint"
    assert s.id in [j["id"] for j in Api(app_url, PAUL).ok("GET", "/api/jobs")["jobs"]]
    refused(o.post(s.path("/members"), json={"name": "Again", "email": s.lead.email, "role": "lead", "trade": None}), "already_member")
    refused(s.lead.api.post(s.path("/members"), json={**base, "email": token("x")[0], "role": "homeowner", "trade": None}), "forbidden")


def test_record_scoping_404(app_url):
    a, b = make_site(app_url), make_site(app_url)
    missing = refused(a.owner.get(f"/api/jobs/{uuid.uuid4()}"), "not_found")
    b_item = add_item(b, b.owner, "Other family item")
    b_note = b.owner.ok("POST", ipath(b, b_item, "/notes"), 201, json={"body": "Other note", "audience": "everyone"})
    for path in ("", "/items", "/rooms", "/members", f"/items/{b_item['id']}"):
        assert a.home.api.get(f"/api/jobs/{b.id}{path}").json() == missing
    events = Stream(a.home.api, b.id)
    assert events.status == 404 and json.loads(events.body) == NOT_FOUND_BODY
    tile_item = add_item(a, a.owner, "Tile only", trade="tile")
    photo = upload(a, a.owner, tile_item, "defect", png()).json()
    crew = a.owner.ok("POST", ipath(a, tile_item, "/notes"), 201, json={"body": "Crew only", "audience": "crew"})
    for r in (a.elec.api.get(ipath(a, tile_item)), a.elec.api.get(photo["url"]),
              a.elec.api.get(ipath(a, tile_item, f"/notes/{crew['id']}/history")),
              a.elec.api.post(ipath(a, tile_item, "/notes"), json={"body": "x", "audience": "crew"})):
        assert r.status_code == 404 and r.json() == missing
    home_item = add_item(a, a.owner, "Crew note host")
    hidden = a.owner.ok("POST", ipath(a, home_item, "/notes"), 201, json={"body": "Hidden crew", "audience": "crew"})
    assert a.home.api.get(ipath(a, home_item, f"/notes/{hidden['id']}/history")).json() == missing
    assert a.home.api.post(ipath(a, home_item, f"/notes/{hidden['id']}/edits"), json={"base_rev": 0, "pos": 0, "delete": 0, "insert": "x"}).json() == missing
    o = a.owner
    mine = add_item(a, o, "Mine")
    for r in (o.post(a.path("/items"), json={"title": "Cross", "room_id": b.rooms["Kitchen"]["id"]}),
              o.put(ipath(a, mine, "/blocked-by"), json={"item_ids": [b_item["id"]]}),
              o.post(a.path("/items/bulk"), json={"action": "verify", "item_ids": [mine["id"], b_item["id"]]}),
              o.post(a.path("/visits"), json={"member_id": b.elec.id, "starts_at": "2030-06-03T09:00", "ends_at": "2030-06-03T10:00"}),
              o.post(ipath(a, mine, "/notes"), json={"body": "Reply", "audience": "everyone", "parent_id": b_note["id"]}),
              o.post(a.path(f"/change-orders/{uuid.uuid4()}/approve")),
              o.get(a.path("/plan/revisions/99"))):
        assert r.status_code == 404 and r.json() == missing, r.text
    rooms = [{"room_id": r["id"], "outline": r["outline"]} for r in a.rooms.values()][:-1] + [
        {"room_id": b.rooms["Laundry"]["id"], "outline": outline(SEED_ROOMS["Laundry"])}]
    r = o.post(a.path("/plan/revisions"), files={"file": ("p.png", png(), "image/png"),
               "reference_points": (None, json.dumps([{"old": {"x": 0.1, "y": 0.1}, "new": {"x": 0.1, "y": 0.1}},
                                                      {"old": {"x": 0.9, "y": 0.1}, "new": {"x": 0.9, "y": 0.1}},
                                                      {"old": {"x": 0.1, "y": 0.9}, "new": {"x": 0.1, "y": 0.9}}])),
               "rooms": (None, json.dumps(rooms))})
    assert r.status_code == 404 and r.json() == missing
    res = sync(a, a.lead.api, op("item_action", 1, item_id=b_item["id"], action="start")).json()["results"][0]
    assert res["outcome"] == "rejected" and res["error"] == NOT_FOUND_BODY
    refused(a.elec.api.get(a.path("/plan/revisions/1")), "forbidden")
    assert a.elec.api.get(a.path("/plan/revisions/99")).json() == missing


def test_items_numbers_and_edits(app_url):
    s = make_site(app_url)
    o = s.owner
    nums = [add_item(s, o, "Owner item")["number"], add_item(s, s.lead.api, "Lead item")["number"],
            add_item(s, s.home.api, "Home item", room="Hall")["number"]]
    assert nums == [1, 2, 3]
    refused(s.elec.api.post(s.path("/items"), json={"title": "Trade", "room_id": s.rooms["Hall"]["id"]}), "forbidden")
    refused(s.home.api.post(s.path("/items"), json={"title": "Home trade", "room_id": s.rooms["Hall"]["id"], "trade": "tile"}), "forbidden")
    blank = add_item(s, s.home.api, "Home blank", room="Hall", trade="", cost_note=None)
    assert blank["number"] == 4 and blank["trade"] is None
    refused(o.post(s.path("/items"), json={"title": "", "room_id": s.rooms["Hall"]["id"]}), "validation", "title")
    made = parallel([lambda i=i: o.post(s.path("/items"), json={"title": f"Race {i}", "room_id": s.rooms["Hall"]["id"]}) for i in range(6)])
    assert all(r.status_code == 201 for r in made)
    assert sorted(r.json()["number"] for r in made) == [5, 6, 7, 8, 9, 10]
    last = next(r.json() for r in made if r.json()["number"] == 10)
    assert o.delete(ipath(s, last)).status_code == 204
    assert add_item(s, o, "After delete")["number"] == 11
    it = add_item(s, s.lead.api, "Editable")
    edited = s.lead.api.ok("PATCH", ipath(s, it), json={"title": "Edited", "trade": "plumbing", "cost_note": "Note",
                                                       "quantity": "2.5", "unit_cost": "10", "room_id": s.rooms["Hall"]["id"]})
    assert (edited["title"], edited["trade"], edited["cost_note"], edited["room_id"]) == ("Edited", "plumbing", "Note", s.rooms["Hall"]["id"])
    assert edited["quantity"] == f"{Decimal('2.5'):.3f}" and edited["unit_cost"] == f"{Decimal('10'):.2f}"
    for bad in ({"quantity": 2.5}, {"quantity": "-1"}, {"quantity": "1e2"}, {"quantity": "0.0001"}, {"quantity": "10000"},
                {"unit_cost": "100000.00"}, {"unit_cost": "1.001"}, {"unit_cost": 3}, {"title": ""},
                {"title": "x" * (TITLE_MAX + 1)}, {"cost_note": "x" * (COST_NOTE_MAX + 1)}):
        refused(o.patch(ipath(s, it), json=bad), "validation", next(iter(bad)))
    own = add_item(s, s.home.api, "Home own", room="Hall")
    refused(s.home.api.patch(ipath(s, own), json={"title": "Renamed"}), "forbidden")
    refused(s.elec.api.patch(ipath(s, add_item(s, o, "Elec", trade="electrical")), json={"title": "x"}), "forbidden")


def test_pins_decide_room(app_url):
    s = make_site(app_url)
    o = s.owner
    a = add_item(s, o, "By pin", pin=IN_LAUNDRY)
    assert room_name(s, a["room_id"]) == "Laundry" and a["pin_status"] == "placed"
    for spot in (OUTSIDE, NOTCH):
        refused(o.post(s.path("/items"), json={"title": "Nowhere", "room_id": s.rooms["Kitchen"]["id"], "pin": spot}), "validation", "pin", PIN_MSG)
    refused(o.post(s.path("/items"), json={"title": "Off", "room_id": s.rooms["Kitchen"]["id"], "pin": {"x": 1.2, "y": 0.5}}), "validation", "pin")
    assert add_item(s, o, "Next")["number"] == a["number"] + 1
    assert room_name(s, add_item(s, o, "Edge L", room="Laundry", pin=SHARED_EDGE)["room_id"]) == "Laundry"
    assert room_name(s, add_item(s, o, "Edge H", room="Hall", pin=SHARED_EDGE)["room_id"]) == "Hall"
    k = add_item(s, o, "From kitchen")
    assert room_name(s, o.ok("PATCH", ipath(s, k), json={"pin": SHARED_EDGE})["room_id"]) == "Hall"
    l = add_item(s, o, "From laundry", room="Laundry")
    assert room_name(s, o.ok("PATCH", ipath(s, l), json={"pin": SHARED_EDGE})["room_id"]) == "Laundry"
    t = add_item(s, o, "Tie break")
    assert room_name(s, o.ok("PATCH", ipath(s, t), json={"pin": SHARED_EDGE, "room_id": s.rooms["Laundry"]["id"]})["room_id"]) == "Laundry"
    r = o.ok("PATCH", ipath(s, add_item(s, o, "Rounded")), json={"pin": {"x": 0.30004, "y": 0.30006}})
    assert r["pin"] == {"x": pytest.approx(0.3), "y": pytest.approx(0.3001)}
    v = add_item(s, o, "Verified move", pin=IN_KITCHEN)
    o.ok("POST", ipath(s, v, "/actions"), json={"action": "verify"})
    before = {x["name"]: x["counts"] for x in o.ok("GET", s.path("/rooms"))["rooms"]}
    progress = o.ok("GET", s.path())["progress"]
    moved = o.ok("PATCH", ipath(s, v), json={"pin": IN_LAUNDRY})
    assert (moved["number"], moved["status"], room_name(s, moved["room_id"])) == (v["number"], "verified", "Laundry")
    after = {x["name"]: x["counts"] for x in o.ok("GET", s.path("/rooms"))["rooms"]}
    assert after["Kitchen"]["verified"] == before["Kitchen"]["verified"] - 1
    assert after["Laundry"]["verified"] == before["Laundry"]["verified"] + 1
    assert o.ok("GET", s.path())["progress"] == progress
    cleared = o.ok("PATCH", ipath(s, add_item(s, o, "Room only", pin=IN_KITCHEN)), json={"room_id": s.rooms["Primary bath"]["id"]})
    assert cleared["pin"] is None and cleared["pin_status"] == "unpinned"


def test_pin_spot_every_viewport(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Spot check", pin=IN_LAUNDRY)
    for api, size in ((s.owner, WIDE), (s.home.api, TABLET), (s.home.api, PHONE)):
        with ui(browser, app_url, api, s.url, size=size) as page:
            job_ready(page, s)
            for _ in range(2 if size == WIDE else 1):
                if size != WIDE:
                    page.get_by_role("button", name="Show plan").click()
                visible(page, pin_button(page, it))
                settle(page.locator("body"))
                point = at_point(plan_img(page, s).bounding_box(), IN_LAUNDRY["x"], IN_LAUNDRY["y"])
                assert covers(pin_button(page, it).bounding_box(), point)
                page.reload()
                job_ready(page, s)


def test_keyboard_pin_placement(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.lead.api, "Keyboard pin")
    n = it["number"]
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        readout = page.get_by_role("status", name="Pin placement")
        crosshair = lambda: marks(page, CROSSHAIR_ATTR)
        r = row(page, it)
        r.focus()
        page.keyboard.press("p")
        shows(page, readout, f"Placing pin for item {n}: 28% across, 26% down.")
        eventually(page, lambda: need(crosshair(), "no crosshair"))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Shift+ArrowDown")
        shows(page, readout, f"Placing pin for item {n}: 29% across, 31% down.")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(r).to_be_focused(timeout=QUICK_MS))
        eventually(page, lambda: need(not crosshair(), "crosshair still shown"))
        assert get_item(s, s.lead.api, it)["pin"] is None
        page.get_by_role("button", name=f"Check off item {n}", exact=True).focus()
        page.keyboard.press("p")
        shows(page, readout, f"Placing pin for item {n}: 28% across, 26% down.")
        for _ in range(8):
            page.keyboard.press("Shift+ArrowLeft")
        shows(page, readout, f"Placing pin for item {n}: 0% across, 26% down.")
        for _ in range(10):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        shows(page, activity(page), f"Pin dropped for item {n} in Kitchen.")
        assert get_item(s, s.lead.api, it)["pin"] == {"x": pytest.approx(0.1), "y": pytest.approx(0.26)}
        q = page.get_by_label("Quick add item")
        q.focus()
        q.press("p")
        expect(q).to_have_value("p")
        assert not crosshair()


def test_touch_pin_placement_phone(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.lead.api, "Touch pin", room="Laundry")
    with ui(browser, app_url, s.lead.api, s.url, size=PHONE) as page:
        job_ready(page, s)
        tap_row(row(page, it))
        sheet = page.get_by_role("dialog", name="Plan")
        if sheet.count():
            tap(page.get_by_role("button", name="Close plan"))
        tap(details(page, it).get_by_role("button", name="Place pin"))
        visible(page, sheet)
        settle(page.locator("body"))
        box = plan_img(page, s).bounding_box()
        tap_at(page, *at_point(box, IN_LAUNDRY["x"], IN_LAUNDRY["y"]))
        readout = page.get_by_role("status", name="Pin placement")
        shows(page, readout, re.compile(rf"^Placing pin for item {it['number']}: \d+% across, \d+% down\.$"))
        x, y = map(int, re.findall(r"(\d+)%", readout.inner_text()))
        assert abs(x - 70) <= 1 and abs(y - 80) <= 1
        tap(page.get_by_role("button", name="Drop pin"))
        shows(page, activity(page), f"Pin dropped for item {it['number']} in Laundry.")
    pin = get_item(s, s.lead.api, it)["pin"]
    assert abs(pin["x"] - IN_LAUNDRY["x"]) * box["width"] <= PIN_PX and abs(pin["y"] - IN_LAUNDRY["y"]) * box["height"] <= PIN_PX


def test_room_tether_sequence(browser, app_url):
    s = make_site(app_url)
    a = add_item(s, s.owner, "Tether target", pin=IN_KITCHEN)
    b = add_item(s, s.owner, "No pin item", room="Hall")
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        r, pin, img = row(page, a), pin_button(page, a), plan_img(page, s)
        visible(page, pin)
        record_motion(page, pin, img)
        tether = lambda: marks(page, TETHER_ATTR, str(a["number"]))
        click_row(r)
        assert not tether(), "the line is drawn only after the pan"
        samples = step_samples(page, img, pin, tether)
        log = motions(page)
        expect(r).to_have_attribute("aria-current", "true")
        changes = [x["t"] for p, x in zip(samples, samples[1:]) if x["img"] != p["img"]]
        drawn = [x["t"] for x in samples if x["tether"]]
        assert drawn, "the tether never appeared"
        widths = [x["t"] for p, x in zip(samples, samples[1:]) if x["t"] > drawn[0] and x["pin"]["width"] != p["pin"]["width"]]
        pan = measured(log, "pan", PAN_MS, changes[-1] if changes else None)
        draw = measured(log, "tether", DRAW_MS, (widths[0] - drawn[0]) if widths else None)
        pulse = measured(log, "pin", PULSE_MS, (widths[-1] - widths[0]) if widths else None)
        for got, want in ((pan, PAN_MS), (draw, DRAW_MS), (pulse, PULSE_MS)):
            assert got is not None and abs(got - want) <= MOTION_SLACK_MS, (got, want, log)
        settle(page.locator("body"))
        assert framed(page, s, "Kitchen", img)
        tb, rb, pb = tether()[0], r.bounding_box(), pin.bounding_box()
        pc = (pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2)
        assert abs(tb["x"] - (rb["x"] + rb["width"])) <= TETHER_PX
        assert abs(tb["x"] + tb["width"] - pc[0]) <= TETHER_PX
        assert min(abs(tb["y"] - pc[1]), abs(tb["y"] + tb["height"] - pc[1])) <= TETHER_PX
        assert rb["y"] - TETHER_PX <= tb["y"] <= rb["y"] + rb["height"] + TETHER_PX or \
            rb["y"] - TETHER_PX <= tb["y"] + tb["height"] <= rb["y"] + rb["height"] + TETHER_PX
        click_row(row(page, b))
        eventually(page, lambda: need(not tether(), "tether still drawn"), LIVE_S)


def test_reduced_motion_tether(browser, app_url):
    s = make_site(app_url)
    a = add_item(s, s.owner, "Calm target", pin=IN_KITCHEN)
    with ui(browser, app_url, s.owner, s.url, reduced=True) as page:
        job_ready(page, s)
        pin, img = pin_button(page, a), plan_img(page, s)
        visible(page, pin)
        unselected = pin.evaluate(RING_JS, RING_AREA)
        record_motion(page, pin, img)
        tether = lambda: marks(page, TETHER_ATTR, str(a["number"]))
        click_row(row(page, a))
        advance(page, SAMPLE_MS)
        assert framed(page, s, "Kitchen", img)
        samples = step_samples(page, img, pin, tether)
        assert not any(x["tether"] for x in samples)
        assert all(x["img"] == samples[0]["img"] for x in samples)
        assert not [m for m in motions(page) if m["kind"] in ("pan", "pin", "tether") and m["ms"] > REDUCED_MAX_MS]
        expect(row(page, a)).to_contain_text(f"Pinned in {room_name(s, a['room_id'])}")
        assert pin.evaluate(RING_JS, RING_AREA) != unselected, "no ring drawn at the selected pin"


def test_motion_inventory(browser, app_url):
    s = make_site(app_url)
    a = add_item(s, s.owner, "Motion item", pin=IN_KITCHEN)
    for reduced in (False, True):
        with ui(browser, app_url, s.owner, s.url, size=TABLET, reduced=reduced) as page:
            page.add_init_script(f"({MOTION_JS})([null, null])")
            page.reload()
            job_ready(page, s)
            show = page.get_by_role("button", name="Show plan")
            show.click()
            advance(page, SHEET_MS * 2)
            rail = motions(page)
            row(page, a).focus()
            page.keyboard.press("Enter")
            advance(page, PAN_MS * 3)
            show.click()
            advance(page, SHEET_MS * 2)
            before = len(motions(page))
            details(page, a).get_by_role("button", name=f"Delete item {a['number']}").click()
            visible(page, page.get_by_role("dialog", name=f"Delete item {a['number']}"))
            dialog_log = motions(page)[before:]
            page.keyboard.press("Escape")
            advance(page, PAN_MS * 3)
            log = motions(page)
            assert not any(m["loops"] for m in log)
            idle = page.evaluate("document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length")
            assert idle == 0
            if reduced:
                assert all(m["ms"] <= REDUCED_MAX_MS for m in log), log
            else:
                assert all(m["ms"] <= REDUCED_MAX_MS or any(abs(m["ms"] - d) <= TOL_MS for d in PUBLISHED_MS) for m in log), log
                assert any(abs(m["ms"] - SHEET_MS) <= TOL_MS for m in rail), rail
                assert any(abs(m["ms"] - DIALOG_MS) <= TOL_MS for m in dialog_log), dialog_log


def test_offline_banner_and_queue(browser, app_url):
    s = make_site(app_url)
    host = add_item(s, s.owner, "Note host")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        expect(page.get_by_role("status", name="Connection")).to_have_text("")
        go_offline(page)
        q = page.get_by_label("Quick add item")
        q.fill("Offline caulk")
        q.press("Enter")
        pending = page.get_by_role("listitem", name=re.compile(r"^Item .+: Offline caulk$"))
        visible(page, pending)
        expect(pending).to_contain_text("Waiting to sync")
        click_row(row(page, host))
        d = details(page, host)
        expect(d.get_by_label("Add defect photo")).to_be_disabled()
        expect(d).to_contain_text(PHOTOS_OFFLINE)
        d.get_by_label("Add a note").fill(OFFLINE_NOTE)
        d.get_by_role("button", name="Post note").click()
        expect(d).to_contain_text(OFFLINE_NOTE)
        with held(page, "**/sync"):
            page.context.set_offline(False)
            page.reload()
            visible(page, pending)
            expect(pending).to_contain_text("Waiting to sync")
        made = poll(lambda: next(i for i in s.owner.ok("GET", s.path("/items"))["items"] if i["title"] == "Offline caulk"), SYNC_S + LIVE_S)
        visible(page, row(page, made))
        eventually(page, lambda: expect(row(page, made)).not_to_contain_text("Waiting to sync", timeout=QUICK_MS))
    titles = [i["title"] for i in s.owner.ok("GET", s.path("/items"))["items"]]
    assert titles.count("Offline caulk") == 1
    assert [n["body"] for n in get_item(s, s.owner, host)["notes"]] == [OFFLINE_NOTE]


def test_sync_operation_log(app_url):
    s = make_site(app_url)
    lead, o = s.lead.api, s.owner
    kid = str(uuid.uuid4())
    create = op("create_item", 1, client_item_id=kid, fields={"title": SYNC_TITLE_A, "room_id": s.rooms["Kitchen"]["id"]})
    rename = op("update_item", 2, item_id=kid, changes={"title": {"from": SYNC_TITLE_A, "to": SYNC_TITLE_B}})
    body = sync(s, lead, rename, create).json()
    assert [x["seq"] for x in body["results"]] == [1, 2] and [x["outcome"] for x in body["results"]] == ["applied", "applied"]
    assert body["results"][1]["item"]["title"] == SYNC_TITLE_B and (body["synced"], body["conflicts"]) == (1, 0)
    made = body["results"][1]["item"]
    again = sync(s, lead, create, rename).json()
    assert [x["outcome"] for x in again["results"]] == ["duplicate", "duplicate"]
    assert all(x["error"] is None and x["item"]["id"] == made["id"] for x in again["results"]) and again["synced"] == 0
    assert sync(s, lead, {**create, "seq": 7}).json()["results"][0]["outcome"] == "duplicate"
    changed = sync(s, lead, {**create, "fields": {**create["fields"], "title": "Other"}}).json()["results"][0]
    assert changed["outcome"] == "rejected" and changed["error"]["error"] == "validation" and "op_id" in changed["error"]["fields"]
    reused = sync(s, lead, op("create_item", 1, client_item_id=kid, fields=create["fields"])).json()["results"][0]
    assert reused["outcome"] == "rejected" and "client_item_id" in reused["error"]["fields"]
    assert [i["title"] for i in o.ok("GET", s.path("/items"))["items"]].count(SYNC_TITLE_B) == 1
    kid2 = str(uuid.uuid4())
    bad = op("create_item", 1, client_item_id=kid2, fields={"title": "Off plan", "room_id": s.rooms["Kitchen"]["id"], "pin": OUTSIDE})
    res = sync(s, lead, bad, op("item_action", 2, item_id=kid2, action="start")).json()["results"]
    assert res[0]["outcome"] == "rejected" and res[0]["error"]["fields"]["pin"] == PIN_MSG
    assert res[1]["outcome"] == "rejected" and res[1]["error"] == NOT_FOUND_BODY
    victim = add_item(s, o, "Victim")
    assert o.delete(ipath(s, victim)).status_code == 204
    res = sync(s, lead, op("update_item", 1, item_id=victim["id"], changes={"title": {"from": "Victim", "to": "Ghost"}})).json()["results"][0]
    assert res["outcome"] == "rejected" and res["error"] == NOT_FOUND_BODY
    assert o.delete(ipath(s, made)).status_code == 204
    gone_replay = sync(s, lead, create).json()["results"][0]
    assert gone_replay["outcome"] == "duplicate" and gone_replay["item"] is None
    wait = add_item(s, o, "Trade wait", trade="electrical")
    verify = op("item_action", 1, item_id=wait["id"], action="verify")
    first = sync(s, lead, verify).json()["results"][0]
    assert first["outcome"] == "rejected" and first["error"]["error"] == "awaiting_trade"
    o.ok("PATCH", ipath(s, wait), json={"trade": None})
    assert sync(s, lead, verify).json()["results"][0]["outcome"] == "applied"
    assert get_item(s, o, wait)["status"] == "verified"
    no_seq = {k: v for k, v in op("item_action", 1, item_id=wait["id"], action="start").items() if k != "seq"}
    for ops in ([], [op("item_action", 0, item_id=wait["id"], action="start")],
                [op("item_action", SEQ_MAX + 1, item_id=wait["id"], action="start")],
                [op("item_action", 3, item_id=wait["id"], action="start"), op("item_action", 3, item_id=wait["id"], action="reopen")],
                [no_seq], [op("item_action", i + 1, item_id=wait["id"], action="start") for i in range(SYNC_MAX + 1)]):
        b = refused(lead.post(s.path("/sync"), json={"ops": ops}), "validation", "ops")
        assert "results" not in b
    odd = sync(s, lead, op("delete_item", 1, item_id=wait["id"])).json()["results"][0]
    assert odd["outcome"] == "rejected" and "type" in odd["error"]["fields"]
    future = sync(s, lead, op("update_item", 1, item_id=wait["id"], plan_revision=9,
                              changes={"title": {"from": "Trade wait", "to": "Later"}})).json()["results"][0]
    assert future["outcome"] == "rejected" and "plan_revision" in future["error"]["fields"]


def test_field_merge_policy(app_url):
    s = make_site(app_url)
    o, lead = s.owner, s.lead.api
    it = add_item(s, o, BASE_TITLE, pin=IN_KITCHEN)
    o.ok("PATCH", ipath(s, it), json={"title": OWNER_TITLE, "pin": OWNER_PIN})
    res = sync(s, lead, op("update_item", 1, item_id=it["id"], plan_revision=1, changes={
        "title": {"from": BASE_TITLE, "to": PHONE_TITLE}, "pin": {"from": IN_KITCHEN, "to": IN_LAUNDRY}})).json()
    assert res["results"][0]["outcome"] == "conflict" and res["conflicts"] == 1
    now = get_item(s, o, it)
    assert now["title"] == OWNER_TITLE and now["pin"] == IN_LAUNDRY and room_name(s, now["room_id"]) == "Laundry"
    conflicts = {c["field"]: c for c in now["conflicts"]}
    assert conflicts["title"] == {"field": "title", "server_value": OWNER_TITLE, "server_by": DANA_NAME,
                                  "phone_value": PHONE_TITLE, "phone_by": s.lead.name}
    assert conflicts["pin"]["server_value"] == OWNER_PIN and conflicts["pin"]["phone_value"] == IN_LAUNDRY
    same = sync(s, lead, op("update_item", 1, item_id=it["id"], changes={"title": {"from": BASE_TITLE, "to": OWNER_TITLE}})).json()["results"][0]
    assert same["outcome"] == "applied"
    applied = sync(s, lead, op("update_item", 1, item_id=it["id"], changes={"cost_note": {"from": None, "to": PHONE_NOTE}})).json()["results"][0]
    assert applied["outcome"] == "applied" and applied["item"]["cost_note"] == PHONE_NOTE
    o.ok("PATCH", ipath(s, it), json={"trade": "electrical", "quantity": "1"})
    t = sync(s, lead, op("update_item", 1, item_id=it["id"], changes={"trade": {"from": None, "to": "tile"},
                                                                       "quantity": {"from": None, "to": "2"}})).json()["results"][0]
    assert t["outcome"] == "conflict" and t["item"]["trade"] == "electrical" and t["item"]["quantity"] == f"{Decimal(1):.3f}"
    r2 = add_item(s, o, "Room fight", pin=IN_KITCHEN)
    o.ok("PATCH", ipath(s, r2), json={"room_id": s.rooms["Hall"]["id"]})
    rc = sync(s, lead, op("update_item", 1, item_id=r2["id"], changes={"room_id": {"from": s.rooms["Kitchen"]["id"], "to": s.rooms["Primary bath"]["id"]}})).json()["results"][0]
    assert rc["outcome"] == "conflict" and room_name(s, rc["item"]["room_id"]) == "Hall"
    pc = sync(s, lead, op("update_item", 2, item_id=r2["id"], changes={"pin": {"from": IN_KITCHEN, "to": {"x": 0.25, "y": 0.20}}})).json()["results"][0]
    assert pc["outcome"] == "conflict" and room_name(s, pc["item"]["room_id"]) == "Kitchen"
    assert next(c for c in pc["item"]["conflicts"] if c["field"] == "pin")["server_value"] is None
    tie = add_item(s, o, "Tie op")
    tb = sync(s, lead, op("update_item", 1, item_id=tie["id"], changes={"pin": {"from": None, "to": SHARED_EDGE},
              "room_id": {"from": s.rooms["Kitchen"]["id"], "to": s.rooms["Laundry"]["id"]}})).json()["results"][0]
    assert tb["outcome"] == "applied" and room_name(s, tb["item"]["room_id"]) == "Laundry"
    cleared = o.ok("PATCH", ipath(s, it), json={"title": "Owner final"})
    assert "title" not in {c["field"] for c in cleared["conflicts"]}
    refused(o.post(ipath(s, it, "/resolve"), json={"field": "pin", "value": {"x": 0.9, "y": 0.9}}), "validation", "value")
    resolved = o.ok("POST", ipath(s, it, "/resolve"), json={"field": "pin", "value": {"x": 0.2, "y": 0.4}})
    assert resolved["pin"] == {"x": 0.2, "y": 0.4} and room_name(s, resolved["room_id"]) == "Kitchen"
    assert "pin" not in {c["field"] for c in resolved["conflicts"]}
    refused(o.post(ipath(s, it, "/resolve"), json={"field": "title", "value": "Owner final"}), "no_conflict")
    race = add_item(s, o, "Race")
    left, right = parallel([lambda: sync(s, lead, op("update_item", 1, item_id=race["id"], changes={"title": {"from": "Race", "to": "Left"}})),
                            lambda: sync(s, o, op("update_item", 1, item_id=race["id"], changes={"title": {"from": "Race", "to": "Right"}}))])
    final = get_item(s, o, race)
    assert final["title"] in ("Left", "Right")
    titles = [c for c in final["conflicts"] if c["field"] == "title"]
    assert len(titles) == 1 and titles[0]["phone_value"] == ({"Left", "Right"} - {final["title"]}).pop()
    assert sorted(x.json()["results"][0]["outcome"] for x in (left, right)) == ["applied", "conflict"]


def test_sync_announcement(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Sync title")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        bodies: list[Any] = []
        page.on("response", lambda r: bodies.append(r) if r.request.method == "POST" and r.url.endswith("/sync") else None)
        go_offline(page)
        click_row(row(page, it))
        title = details(page, it).get_by_label("Title", exact=True)
        title.fill("Phone title")
        title.press("Enter")
        q = page.get_by_label("Quick add item")
        q.fill("Fresh offline")
        q.press("Enter")
        s.owner.ok("PATCH", ipath(s, it), json={"title": "Owner title"})
        page.context.set_offline(False)
        shows(page, activity(page), re.compile(r"^Sync complete: \d+ synced, \d+ to review\.$"), SYNC_S + UI_WAIT_S)
        results = [b.json() for b in bodies]
        assert (sum(b["synced"] for b in results), sum(b["conflicts"] for b in results)) == (1, 1)
        expect(activity(page)).to_have_text(f"Sync complete: {results[-1]['synced']} synced, {results[-1]['conflicts']} to review.")


def test_item_lifecycle_and_deletion(app_url):
    s = make_site(app_url)
    o, lead, elec = s.owner, s.lead.api, s.elec.api
    it = add_item(s, o, "Lifecycle", trade="electrical")
    refused(act(s, o, it, "verify"), "awaiting_trade")
    assert act(s, elec, it, "start").json()["status"] == "in_progress"
    refused(act(s, elec, it, "mark_done"), "completion_photo_required")
    assert upload(s, elec, it, "completion", png()).status_code == 201
    assert act(s, elec, it, "mark_done").json()["status"] == "ready_for_check"
    refused(act(s, elec, it, "verify"), "forbidden")
    refused(o.patch(ipath(s, it), json={"trade": "tile"}), "invalid_transition")
    refused(act(s, lead, it, "send_back"), "validation", "reason")
    back = act(s, lead, it, "send_back", reason="Cover plate crooked").json()
    assert (back["status"], back["sent_back_reason"]) == ("in_progress", "Cover plate crooked")
    refused(act(s, s.home.api, it, "start"), "forbidden")
    done = act(s, elec, it, "mark_done").json()
    assert done["status"] == "ready_for_check" and not done["sent_back_reason"]
    assert act(s, lead, it, "verify").json()["status"] == "verified"
    refused(act(s, lead, it, "mark_done"), "invalid_transition")
    refused(act(s, lead, it, "reopen"), "forbidden")
    refused(o.delete(ipath(s, it)), "invalid_transition")
    assert act(s, o, it, "reopen").json()["status"] == "open"
    crew = add_item(s, o, "Crew")
    assert act(s, lead, crew, "verify").json()["status"] == "verified"
    mine = add_item(s, lead, "Lead own")
    owners = add_item(s, o, "Owner made")
    refused(lead.delete(ipath(s, owners)), "forbidden")
    started = add_item(s, lead, "Lead started")
    act(s, lead, started, "start")
    refused(lead.delete(ipath(s, started)), "forbidden")
    refused(elec.delete(ipath(s, add_item(s, o, "Elec del", trade="electrical"))), "forbidden")
    refused(s.home.api.delete(ipath(s, owners)), "forbidden")
    assert lead.delete(ipath(s, mine)).status_code == 204
    refused(o.get(ipath(s, mine)), "not_found")
    race = add_item(s, o, "Race")
    out = parallel([lambda: act(s, o, race, "start") for _ in range(5)])
    assert sorted(r.status_code for r in out) == [200, 409, 409, 409, 409]
    for r in out:
        if r.status_code == 409:
            refused(r, "invalid_transition")


def test_honest_offline_checkoff(browser, app_url):
    s = make_site(app_url)
    trade = add_item(s, s.owner, "Needs elec photo", trade="electrical")
    doomed = add_item(s, s.owner, "Doomed item", room="Hall")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        go_offline(page)
        for it in (trade, doomed):
            page.get_by_role("button", name=f"Check off item {it['number']}", exact=True).click()
            expect(row(page, it)).to_contain_text("Verified")
            expect(row(page, it)).to_contain_text("Waiting to sync")
        assert s.owner.delete(ipath(s, doomed)).status_code == 204
        page.context.set_offline(False)
        shows(page, activity(page), f"Sync complete: 0 synced, 0 to review. Item {doomed['number']} removed. Not saved: Not found.", SYNC_S + UI_WAIT_S)
        expect(row(page, trade)).to_contain_text(f"Not saved: {CATALOGUE['awaiting_trade'][1]}")
        expect(row(page, trade)).to_contain_text("Open")
        expect(row(page, doomed)).to_have_count(0)
    assert get_item(s, s.owner, trade)["status"] == "open"


def test_photo_upload_rules(app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Photo rules")
    lead = s.lead.api
    disguised = upload(s, lead, it, "defect", png(), name="photo.svg", ctype="image/svg+xml")
    assert disguised.status_code == 201
    photo = disguised.json()
    assert set(photo) == PHOTO_KEYS and photo["content_type"].endswith("png") and photo["kind"] == "defect"
    assert lead.get(photo["url"]).headers["content-type"].startswith(photo["content_type"])
    assert photo["url"] == f"/api/jobs/{s.id}/photos/{photo['id']}"
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for data, name in ((svg, "photo.png"), (b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "photo.png"), (b"plain text", "photo.jpg")):
        refused(upload(s, lead, it, "defect", data, name=name), "unsupported_image")
    refused(s.owner.put(s.path("/plan"), files={"file": ("plan.png", svg, "image/png")}), "unsupported_image")
    assert upload(s, lead, it, "defect", png_of_size(MAX_IMAGE)).status_code == 201
    refused(upload(s, lead, it, "defect", png_of_size(MAX_IMAGE + 1)), "photo_too_large")
    refused(upload(s, s.home.api, it, "defect", png()), "forbidden")
    gps = upload(s, lead, it, "defect", gps_png())
    assert gps.status_code == 201
    gid = gps.json()["id"]
    key = next(k for k in S3().keys(f"jobs/{s.id}/items/{it['id']}/photos/") if gid in k)
    assert key.endswith(".png")
    for stored in (S3().get(key), lead.get(gps.json()["url"]).content):
        assert stored.startswith(b"\x89PNG") and not [m for m in METADATA_MARKS if m in stored]
    assert len(get_item(s, lead, it)["photos"]) == 3


def test_storage_confirmed_photos(app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"]
    s = make_site(app_url)
    it = add_item(s, s.lead.api, "Photo outage")
    ph = upload(s, s.lead.api, it, "defect", png()).json()
    prefix = f"jobs/{s.id}/items/{it['id']}/photos/"
    lead_down, owner_down = Api(down, s.lead.email, INITIAL_PASSWORD), Api(down, DANA)
    refused(upload(s, lead_down, it, "defect", png(shade=10)), "storage_unavailable")
    refused(lead_down.delete(ph["url"]), "storage_unavailable")
    refused(lead_down.get(ph["url"]), "storage_unavailable")
    refused(owner_down.delete(ipath(s, it)), "storage_unavailable")
    refused(owner_down.get(s.path("/plan")), "storage_unavailable")
    assert [p["id"] for p in get_item(s, s.owner, it)["photos"]] == [ph["id"]]
    assert len(S3().keys(prefix)) == 1 and s.lead.api.get(ph["url"]).status_code == 200
    assert s.lead.api.delete(ph["url"]).status_code == 204
    assert S3().keys(prefix) == []
    refused(s.lead.api.get(ph["url"]), "not_found")
    refused(lead_down.get(ph["url"]), "not_found")
    ph2 = upload(s, s.lead.api, it, "defect", png()).json()
    assert s.owner.delete(ipath(s, it)).status_code == 204
    assert S3().keys(prefix) == []
    refused(s.owner.get(ph2["url"]), "not_found")


def test_role_projection(app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Projected", trade="electrical", cost_note=SECRET_COST, quantity="2", unit_cost="3.00")
    s.lead.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": CREW_SECRET, "audience": "crew"})
    top = s.lead.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "For everyone", "audience": "everyone"})
    s.owner.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "Reply all", "audience": "everyone", "parent_id": top["id"]})
    for api in (s.owner, s.lead.api):
        assert set(get_item(s, api, it)) == ITEM_KEYS
    trade_view = get_item(s, s.elec.api, it)
    home_view = get_item(s, s.home.api, it)
    assert set(trade_view) == ITEM_KEYS - TRADE_HIDDEN
    assert set(home_view) == ITEM_KEYS - TRADE_HIDDEN - {"sent_back_reason"}
    assert {n["audience"] for n in home_view["notes"]} == {"everyone"}
    note = next(n for n in home_view["notes"] if n["body"] == "For everyone")
    assert set(note) == NOTE_KEYS | {"replies"} and set(note["replies"][0]) == NOTE_KEYS
    for api in (s.elec.api, s.home.api):
        dump = json.dumps([api.ok("GET", s.path("/items")), api.ok("GET", s.path()), get_item(s, api, it)])
        assert SECRET_COST not in dump
        assert set(api.ok("GET", s.path())) == JOB_KEYS
    assert CREW_SECRET not in json.dumps(get_item(s, s.home.api, it))
    full = {m["email"] for m in s.owner.ok("GET", s.path("/members"))["members"] if set(m) == MEMBER_FULL}
    assert {s.lead.email, s.elec.email, s.tile.email, s.home.email, DANA} <= full
    others = {s.elec.id: (s.tile, s.home), s.home.id: (s.elec, s.tile)}
    for viewer in (s.elec, s.home):
        rows = {m["id"]: m for m in viewer.api.ok("GET", s.path("/members"))["members"]}
        for p in (s.lead, viewer):
            assert set(rows[p.id]) == MEMBER_FULL
        for p in others[viewer.id]:
            assert set(rows[p.id]) == MEMBER_SHORT


def test_notes_threads(app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Thread host")
    crew = s.lead.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "Crew line", "audience": "crew"})
    assert crew["rev"] == 0 and crew["audience"] == "crew" and crew["author"]["name"] == s.lead.name
    refused(s.home.api.post(ipath(s, it, "/notes"), json={"body": "Home crew", "audience": "crew"}), "forbidden")
    open_note = s.home.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "Home line", "audience": "everyone"})
    refused(s.home.api.post(ipath(s, it, "/notes"), json={"body": "Peek", "audience": "everyone", "parent_id": crew["id"]}), "not_found")
    reply = s.lead.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "Answer", "audience": "everyone", "parent_id": open_note["id"]})
    refused(s.lead.api.post(ipath(s, it, "/notes"), json={"body": "Deep", "audience": "everyone", "parent_id": reply["id"]}), "validation")
    refused(s.lead.api.post(ipath(s, it, "/notes"), json={"body": "Wide", "audience": "everyone", "parent_id": crew["id"]}), "validation")
    refused(s.lead.api.post(ipath(s, it, "/notes"), json={"body": "x" * (NOTE_MAX + 1), "audience": "crew"}), "validation", "body")
    s.lead.api.ok("POST", ipath(s, it, "/notes"), 201, json={"body": "\U0001F527" * NOTE_MAX, "audience": "crew"})
    assert [n["body"] for n in get_item(s, s.home.api, it)["notes"]] == ["Home line"]
    refused(s.home.api.post(ipath(s, it, f"/notes/{reply['id']}/edits"), json={"base_rev": 0, "pos": 0, "delete": 0, "insert": "x"}), "forbidden")
    path = ipath(s, it, f"/notes/{crew['id']}")
    assert s.lead.api.ok("POST", path + "/edits", json={"base_rev": 0, "pos": 9, "delete": 0, "insert": "!"})["rev"] == 1
    assert s.lead.api.ok("POST", path + "/undo")["rev"] == 2
    assert s.lead.api.ok("POST", path + "/redo")["rev"] == 3


def test_access_card_and_reveals(app_url):
    s = make_site(app_url)
    card = {"lockbox_code": "L7741", "alarm_code": "A3302", "garage_code": "G9915", "house_note": "Cat stays upstairs."}
    saved = s.owner.ok("PUT", s.path("/access"), json=card)
    assert saved == {**card, "visible_until": None}
    assert s.owner.ok("GET", s.path("/access/reveals"))["reveals"] == []
    refused(s.owner.put(s.path("/access"), json={**card, "lockbox_code": "9" * (CODE_MAX + 1)}), "validation", "lockbox_code")
    assert s.owner.ok("GET", s.path("/access")) == {**card, "visible_until": None}
    assert s.lead.api.ok("GET", s.path("/access"))["alarm_code"] == card["alarm_code"]
    refused(s.home.api.get(s.path("/access")), "forbidden")
    refused(s.elec.api.get(s.path("/access")), "outside_site_visit")
    refused(s.lead.api.put(s.path("/access"), json=card), "forbidden")
    reveals = s.owner.ok("GET", s.path("/access/reveals"))["reveals"]
    assert [(r["name"], r["role"]) for r in reveals] == [(s.lead.name, "lead"), (DANA_NAME, "owner")]
    refused(s.lead.api.get(s.path("/access/reveals")), "forbidden")


def test_site_visit_rules(app_url):
    s = make_site(app_url)
    o = s.owner
    a = visit(s, o, s.elec, "2030-03-10T07:00", "2030-03-10T08:00").json()
    assert zulu(a["starts_at_utc"]) == "2030-03-10T12:00:00Z" and a["starts_at"] == datetime(2030, 3, 10, 7).isoformat()
    assert zulu(visit(s, o, s.elec, "2030-03-09T07:00", "2030-03-09T08:00").json()["starts_at_utc"]) == "2030-03-09T13:00:00Z"
    assert visit(s, o, s.tile, "2030-04-08T07:00", "2030-04-08T19:00").status_code == 201
    refused(visit(s, o, s.elec, "2030-04-09T06:59", "2030-04-09T08:00"), "validation", "starts_at")
    refused(visit(s, o, s.elec, "2030-04-09T09:00", "2030-04-09T19:01"), "validation", "ends_at")
    refused(visit(s, o, s.elec, "2030-04-09T09:00", "2030-04-10T10:00"), "validation", "ends_at")
    refused(visit(s, o, s.elec, "2030-04-09T10:00", "2030-04-09T09:00"), "validation")
    refused(visit(s, o, s.elec, "2020-04-09T09:00", "2020-04-09T10:00"), "validation", "ends_at")
    refused(o.post(s.path("/visits"), json={"member_id": s.home.id, "starts_at": "2030-04-09T09:00", "ends_at": "2030-04-09T10:00"}), "validation", "member_id")
    b = refused(visit(s, o, s.elec, "2030-03-10T07:30", "2030-03-10T08:30"), "visit_overlap")
    assert b["occurrence_date"] == "2030-03-10"
    refused(visit(s, o, s.elec, "2030-03-10T07:30", "2030-03-10T19:30"), "visit_overlap")
    assert visit(s, s.lead.api, s.elec, "2030-03-10T08:00", "2030-03-10T09:00").status_code == 201
    refused(visit(s, s.elec.api, s.elec, "2030-04-11T09:00", "2030-04-11T10:00"), "forbidden")
    refused(s.home.api.get(s.path("/visits")), "forbidden")
    race = parallel([lambda: visit(s, o, s.tile, "2030-04-15T09:00", "2030-04-15T11:00") for _ in range(4)])
    assert sorted(r.status_code for r in race) == [201, 409, 409, 409]
    zone, local = working_zone(app_url)
    w = make_site(app_url, tz=zone)
    start = local.replace(second=0, microsecond=0) + timedelta(minutes=20)
    v = w.owner.ok("POST", w.path("/visits"), 201, json={"member_id": w.elec.id, "starts_at": start.strftime("%Y-%m-%dT%H:%M"),
                   "ends_at": (start + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")})
    assert v["active"] is True
    card = w.elec.api.ok("GET", w.path("/access"))
    assert card["visible_until"] == v["ends_at_utc"]
    job = w.elec.api.ok("GET", w.path())
    assert job["access_codes_available"] is True and job["next_visit"]["starts_at"].startswith(start.strftime("%Y-%m-%dT%H:%M"))
    later = local.replace(second=0, microsecond=0) + timedelta(minutes=CODE_LEAD_MIN + 15)
    w.owner.ok("POST", w.path("/visits"), 201, json={"member_id": w.tile.id, "starts_at": later.strftime("%Y-%m-%dT%H:%M"),
               "ends_at": (later + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")})
    refused(w.tile.api.get(w.path("/access")), "outside_site_visit")
    assert w.tile.api.ok("GET", w.path())["access_codes_available"] is False


def test_recurring_series(app_url):
    s = make_site(app_url)
    o = s.owner
    daily = o.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": "2030-03-04T08:00", "ends_at": "2030-03-04T09:00",
                 "recurrence": {"freq": "daily", "until": None, "count": 10}})
    occ = daily["occurrences"]
    assert len(occ) == 10 and all(x["starts_at"].endswith("T08:00:00") for x in occ)
    assert all(zulu(x["starts_at_utc"]) == f"{x['date']}T{'14' if x['date'] < '2030-03-10' else '13'}:00:00Z" for x in occ)
    weekly = o.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": "2030-03-04T10:00", "ends_at": "2030-03-04T11:00",
                  "recurrence": {"freq": "weekly", "weekdays": ["FR", "MO", "WE"], "until": "2030-03-15", "count": None}})
    assert weekly["recurrence"]["weekdays"] == ["MO", "WE", "FR"]
    assert [x["date"] for x in weekly["occurrences"]] == ["2030-03-04", "2030-03-06", "2030-03-08", "2030-03-11", "2030-03-13", "2030-03-15"]
    span = o.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": "2030-03-04T12:00", "ends_at": "2030-03-04T13:00",
                "recurrence": {"freq": "every_n_days", "interval": 4, "until": None, "count": SPAN_COUNT_OK}})
    assert len(span["occurrences"]) == SPAN_COUNT_OK
    assert span["occurrences"][-1]["date"] == (date(2030, 3, 4) + timedelta(days=SPAN_DAYS)).isoformat()
    assert len(o.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": "2030-03-04T14:00", "ends_at": "2030-03-04T15:00",
               "recurrence": {"freq": "daily", "until": None, "count": SERIES_MAX}})["occurrences"]) == SERIES_MAX
    before = len(o.ok("GET", s.path("/visits"))["visits"])
    base = {"member_id": s.tile.id, "starts_at": "2030-03-05T16:00", "ends_at": "2030-03-05T17:00"}
    for rule in ({"freq": "every_n_days", "interval": 4, "until": None, "count": SPAN_COUNT_OK + 1},
                 {"freq": "daily", "until": None, "count": SERIES_MAX + 1},
                 {"freq": "every_n_days", "interval": 30, "until": (date(2030, 3, 5) + timedelta(days=210)).isoformat(), "count": None},
                 {"freq": "daily", "until": "9999-12-31", "count": None},
                 {"freq": "daily", "until": "2030-03-08", "count": 3}, {"freq": "daily", "until": None, "count": None},
                 {"freq": "daily", "weekdays": ["TU"], "until": None, "count": 3}, {"freq": "daily", "interval": 2, "until": None, "count": 3},
                 {"freq": "every_n_days", "interval": 1, "until": None, "count": 3}, {"freq": "every_n_days", "interval": 31, "until": None, "count": 3},
                 {"freq": "weekly", "weekdays": ["MO"], "until": None, "count": 3}, {"freq": "weekly", "weekdays": ["TU", "TU"], "until": None, "count": 3},
                 {"freq": "weekly", "weekdays": [], "until": None, "count": 3}, {"freq": "daily", "until": "2030-03-01", "count": None},
                 {"freq": "daily", "until": None, "count": 0}):
        refused(o.post(s.path("/visits"), json={**base, "recurrence": rule}), "validation", "recurrence")
    ok = o.ok("POST", s.path("/visits"), 201, json={**base, "recurrence": {"freq": "every_n_days", "interval": 30,
              "until": (date(2030, 3, 5) + timedelta(days=SPAN_DAYS)).isoformat(), "count": None}})
    assert len(ok["occurrences"]) == 7
    assert len(o.ok("GET", s.path("/visits"))["visits"]) == before + 1


def test_occurrence_exceptions(app_url):
    s = make_site(app_url)
    o = s.owner
    day = lambda k: (OCC_START + timedelta(days=k)).isoformat()
    at = lambda k, h, mins=0: datetime.combine(OCC_START + timedelta(days=k), clock(h, mins))
    hm = lambda when: when.strftime("%Y-%m-%dT%H:%M")
    book = lambda k, h, mins=0, rule=None: visit(s, o, s.elec, hm(at(k, h, mins)), hm(at(k, h + 1, mins)), rule)
    first = book(0, 9, rule={"freq": "daily", "until": None, "count": 5})
    assert first.status_code == 201, first.text
    v = first.json()
    occ = lambda k: s.path(f"/visits/{v['id']}/occurrences/{day(k)}")
    moved = o.ok("PUT", occ(1), json={"starts_at": hm(at(1, 13)), "ends_at": hm(at(1, 14))})
    m = next(x for x in moved["occurrences"] if x["date"] == day(1))
    assert m["status"] == "moved" and m["starts_at"] == at(1, 13).isoformat()
    cancelled = s.lead.api.ok("DELETE", occ(2))
    assert next(x for x in cancelled["occurrences"] if x["date"] == day(2))["status"] == "cancelled"
    assert len(cancelled["occurrences"]) == 5
    refused(o.delete(occ(2)), "not_found")
    refused(o.delete(occ(19)), "not_found")
    assert book(2, 9).status_code == 201
    assert book(1, 9).status_code == 201
    assert refused(book(1, 13, 30), "visit_overlap")["occurrence_date"] == day(1)
    series = refused(book(-1, 13, rule={"freq": "daily", "until": day(4), "count": None}), "visit_overlap")
    assert series["occurrence_date"] == day(1)
    refused(o.put(occ(3), json={"starts_at": hm(at(1, 13)), "ends_at": hm(at(1, 14))}), "visit_overlap")
    assert s.elec.api.ok("GET", s.path())["next_visit"]["starts_at"].startswith(hm(at(0, 9)))
    o.ok("DELETE", occ(0))
    assert s.elec.api.ok("GET", s.path())["next_visit"]["starts_at"].startswith(hm(at(1, 9)))
    assert o.delete(s.path(f"/visits/{v['id']}")).status_code == 204
    assert v["id"] not in [x["id"] for x in o.ok("GET", s.path("/visits"))["visits"]]
    race = parallel([lambda: visit(s, o, s.tile, "2030-05-06T09:00", "2030-05-06T10:00", {"freq": "daily", "until": None, "count": 3}) for _ in range(3)])
    assert sorted(r.status_code for r in race) == [201, 409, 409]
    for r in race:
        if r.status_code == 409:
            refused(r, "visit_overlap")


def test_ending_role(app_url, mail):
    s = make_site(app_url)
    o = s.owner
    tile2 = add_person(app_url, o, s.id, "tiletwo", "trade", "tile")
    visit(s, o, s.tile, "2030-05-06T09:00", "2030-05-06T10:00")
    stream = Stream(s.tile.api, s.id)
    assert o.delete(s.path(f"/members/{s.tile.id}")).status_code == 204
    stream.until(lambda e: e.type == "role_ended")
    assert stream.done.wait(LIVE_S)
    refused(s.tile.api.get(s.path()), "role_ended")
    refused(s.tile.api.get(s.path(f"/items/{uuid.uuid4()}")), "role_ended")
    assert s.id not in [j["id"] for j in s.tile.api.ok("GET", "/api/jobs")["jobs"]]
    assert s.tile.id not in [v["member_id"] for v in o.ok("GET", s.path("/visits"))["visits"]]
    add_item(s, o, "After offboarding", trade="tile")
    assert len(inbox(mail, tile2.email, 1)) == 1
    assert inbox(mail, s.tile.email, 1, MAIL_GRACE_S) == []
    owner_member = next(m for m in o.ok("GET", s.path("/members"))["members"] if m["role"] == "owner")
    refused(o.delete(s.path(f"/members/{owner_member['id']}")), "invalid_transition")
    o.ok("POST", s.path("/members"), 201, json={"name": s.tile.name, "email": s.tile.email, "role": "trade", "trade": "tile"})
    assert s.tile.api.get(s.path()).status_code == 200


def test_password_change_sessions(app_url):
    s = make_site(app_url)
    a = s.lead.api
    b = Api(app_url, s.lead.email, INITIAL_PASSWORD)
    stream = Stream(b, s.id)
    refused(a.post("/api/me/password", json={"current_password": "not-the-password", "new_password": NEW_PASSWORD}), "validation", "current_password")
    refused(a.post("/api/me/password", json={"current_password": INITIAL_PASSWORD, "new_password": "short"}), "validation", "new_password", PASSWORD_MSG)
    assert a.ok("POST", "/api/me/password", json={"current_password": INITIAL_PASSWORD, "new_password": NEW_PASSWORD}) == {"ok": True}
    refused(b.get("/api/me"), "unauthenticated")
    assert stream.done.wait(LIVE_S)
    assert a.ok("GET", "/api/me")["user"]["email"] == s.lead.email
    refused(httpx.post(app_url.rstrip("/") + "/api/session", json={"email": s.lead.email, "password": INITIAL_PASSWORD}, timeout=HTTP_TIMEOUT), "invalid_credentials")
    Api(app_url, s.lead.email, NEW_PASSWORD)


def test_assignment_notice(app_url, mail):
    s = make_site(app_url)
    o = s.owner
    elec2 = add_person(app_url, o, s.id, "sparkytwo", "trade", "electrical")
    card = {"lockbox_code": "L5521", "alarm_code": "A8810", "garage_code": "G4402", "house_note": "Ring twice probe."}
    o.ok("PUT", s.path("/access"), json=card)
    it = add_item(s, o, "Swap breaker", room="Hall", trade="electrical", cost_note="Cost probe 77", quantity="1", unit_cost="12.34")
    link = f"{app_url.rstrip('/')}/signin"
    for p in (s.elec, elec2):
        msgs = inbox(mail, p.email, 1)
        assert len(msgs) == 1 and msgs[0]["Subject"] == f"Snaglight: new item on {s.name}"
        assert addresses(msgs[0]["From"]) == [mail_from_address()]
        assert body_lines(msgs[0]) == [f"Item {it['number']}: Swap breaker", "Room: Hall", f"Sign in to see the details: {link}"]
        raw = text(msgs[0])
        for secret in (*card.values(), f"{s.name.split()[-1]} Probe Lane", "Cost probe 77", "12.34", PROBE_PHONE):
            assert secret not in raw
    o.ok("PATCH", ipath(s, it), json={"trade": "electrical", "title": "Swap breaker now"})
    o.ok("PATCH", ipath(s, it), json={"trade": "tile"})
    assert body_lines(inbox(mail, s.tile.email, 1)[0])[0] == f"Item {it['number']}: Swap breaker now"
    o.ok("PATCH", ipath(s, it), json={"trade": "electrical"})
    to_tile = op("update_item", 1, item_id=it["id"], changes={"trade": {"from": "electrical", "to": "tile"}})
    assert sync(s, s.lead.api, to_tile).json()["results"][0]["outcome"] == "applied"
    assert sync(s, s.lead.api, to_tile).json()["results"][0]["outcome"] == "duplicate"
    o.ok("PATCH", ipath(s, it), json={"trade": "electrical"})
    clash = sync(s, s.lead.api, op("update_item", 1, item_id=it["id"], changes={"trade": {"from": "paint", "to": "tile"}})).json()
    assert clash["results"][0]["outcome"] == "conflict"
    assert sync(s, s.lead.api, op("update_item", 1, item_id=it["id"], changes={"trade": {"from": "tile", "to": "electrical"}})).json()["results"][0]["outcome"] == "applied"
    kid = str(uuid.uuid4())
    sync(s, s.lead.api, op("create_item", 1, client_item_id=kid, fields={"title": "Sync made", "room_id": s.rooms["Hall"]["id"], "trade": "tile"}),
         op("update_item", 2, item_id=kid, changes={"trade": {"from": "tile", "to": "electrical"}}))
    final = {p.email: len(inbox(mail, p.email, n)) for p, n in ((s.elec, 4), (elec2, 4), (s.tile, 3))}
    assert final == {s.elec.email: 4, elec2.email: 4, s.tile.email: 3}


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": url}
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(prefix="snaglight-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    tail = lambda: Path(log.name).read_text(errors="replace")[-2000:]
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while True:
            assert proc.poll() is None, f"app copy exited:\n{tail()}"
            try:
                if httpx.get(url + "/api/health", timeout=POLL_S * 4).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, f"app copy never answered health:\n{tail()}"
            _pause.wait(POLL_S)
        yield url
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def test_mail_outbox(app_url, mail):
    s = make_site(app_url)
    add_item(s, s.owner, "Outbox item", trade="electrical")
    inbox(mail, s.elec.email, 1)
    entries = poll(lambda: need([e for e in s.owner.ok("GET", s.path("/outbox"))["entries"]
                                 if e["to"] == s.elec.email and e["status"] == "sent"], "not sent yet"), MAIL_WAIT_S)
    e = entries[0]
    assert (e["kind"], e["to"], e["subject"]) == ("assignment", s.elec.email, f"Snaglight: new item on {s.name}") and e["sent_at"]
    refused(s.lead.api.get(s.path("/outbox")), "forbidden")
    down_url = os.environ["APP_MAIL_DOWN_URL"].rstrip("/")
    d = make_site(down_url)
    add_item(d, d.owner, "Down item", trade="electrical")
    queued = d.owner.ok("GET", d.path("/outbox"))["entries"]
    assert [(x["status"], x["sent_at"]) for x in queued if x["to"] == d.elec.email] == [("queued", None)]
    assert inbox(mail, d.elec.email, 1, MAIL_GRACE_S) == []
    assert [x["status"] for x in d.owner.ok("GET", d.path("/outbox"))["entries"] if x["to"] == d.elec.email] == ["queued"]
    shared = {"DATABASE_URL": os.environ["DATABASE_URL"] + "_maildown", "S3_BUCKET": os.environ["S3_BUCKET"] + "-maildown"}
    with app_copy(shared), app_copy(shared):
        msgs = inbox(mail, d.elec.email, 1)
        assert len(msgs) == 1 and body_lines(msgs[0])[-1] == f"Sign in to see the details: {down_url}/signin"
        poll(lambda: need([x["status"] for x in d.owner.ok("GET", d.path("/outbox"))["entries"] if x["to"] == d.elec.email] == ["sent"],
                          "entry not marked sent"), MAIL_WAIT_S)
        assert len(inbox(mail, d.elec.email, 2, MAIL_GRACE_S)) == 1


def test_daily_summary(app_url, mail):
    base = os.environ["APP_SUMMARY_URL"].rstrip("/")
    zone, local = working_zone(base)
    s = make_site(base, tz=zone)
    o = s.owner
    plumber = add_person(base, o, s.id, "plumb", "trade", "plumbing")
    today = local.date()
    tomorrow, after = today + timedelta(days=1), today + timedelta(days=2)
    at = lambda d, hm: f"{d.isoformat()}T{hm}"
    o.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": at(tomorrow, "09:00"), "ends_at": at(tomorrow, "10:00")})
    tile = o.ok("POST", s.path("/visits"), 201, json={"member_id": s.tile.id, "starts_at": at(tomorrow, "07:30"), "ends_at": at(tomorrow, "08:30"),
                "recurrence": {"freq": "daily", "until": None, "count": 3}})
    o.ok("DELETE", s.path(f"/visits/{tile['id']}/occurrences/{after.isoformat()}"))
    pv = o.ok("POST", s.path("/visits"), 201, json={"member_id": plumber.id, "starts_at": at(tomorrow, "13:00"), "ends_at": at(tomorrow, "14:00")})
    o.ok("DELETE", s.path(f"/visits/{pv['id']}/occurrences/{tomorrow.isoformat()}"))
    card = {"lockbox_code": "L6060", "alarm_code": "A6161", "garage_code": "G6262", "house_note": "Summary probe note."}
    o.ok("PUT", s.path("/access"), json=card)
    i1 = add_item(s, o, "Crew fix", pin=IN_KITCHEN, cost_note="Cost probe 41", quantity="2", unit_cost="9.99")
    i2 = add_item(s, o, "Elec fix", room="Hall", trade="electrical", pin={"x": 0.20, "y": 0.72})
    i3 = add_item(s, o, "Temp item", room="Hall")
    act(s, o, i1, "start")
    act(s, o, i1, "verify")
    o.ok("PATCH", ipath(s, i2), json={"pin": IN_LAUNDRY})
    assert o.delete(ipath(s, i3)).status_code == 204
    i4 = add_item(s, s.home.api, "Homeowner spot", room="Hall")
    expected = ["33% verified (1 of 3 items)", "Kitchen: 1 of 1 verified", "Primary bath: 0 of 0 verified", "Hall: 0 of 1 verified",
                "Laundry: 0 of 1 verified", f"Visit {tomorrow} 07:30 to 08:30: Tile", f"Visit {tomorrow} 09:00 to 10:00: Electrical",
                f"Item {i1['number']}: Crew fix — Verified", f"Item {i2['number']}: Elec fix — Open",
                f"Item {i4['number']}: Homeowner spot — Open", f"Sign in to see the details: {base}/signin"]
    summaries = lambda: [e for e in o.ok("GET", s.path("/outbox"))["entries"] if e["kind"] == "summary"]
    poll(lambda: need(summaries(), "no summary"), SUMMARY_WAIT_S)
    assert [e["to"] for e in summaries()] == [s.home.email]
    msgs = inbox(mail, s.home.email, 1)
    assert len(msgs) == 1
    assert msgs[0]["Subject"] == f"Snaglight: walkthrough summary for {s.name}, {today.isoformat()}"
    assert body_lines(msgs[0]) == expected
    assert not [v for v in (*card.values(), "Cost probe 41", "9.99", "$", PROBE_PHONE) if v in text(msgs[0])]
    add_item(s, o, "Late item")
    deadline = time.monotonic() + SUMMARY_WAIT_S
    while time.monotonic() < deadline:
        assert len(summaries()) == 1
        _pause.wait(POLL_S * 4)
    assert len(inbox(mail, s.home.email, 2, MAIL_GRACE_S)) == 1


def test_one_set_of_counts(browser, app_url):
    s = make_site(app_url)
    o = s.owner
    stream = Stream(o, s.id)
    a = add_item(s, o, "Count A", pin=IN_KITCHEN)
    b = add_item(s, o, "Count B", trade="electrical")
    c = add_item(s, o, "Count C", room="Hall")
    e = add_item(s, o, "Count E", room="Hall")
    o.ok("PUT", ipath(s, e, "/blocked-by"), json={"item_ids": [a["id"]]})

    def agree() -> None:
        rooms, progress = recount(o, s)
        api_rooms = {r["id"]: r["counts"] for r in o.ok("GET", s.path("/rooms"))["rooms"]}
        assert api_rooms == rooms and o.ok("GET", s.path())["progress"] == progress

        def latest_counts() -> None:
            ev = next((x for x in reversed(list(stream.events)) if x.type == "counts"), None)
            need(ev is not None and ev.data["progress"] == progress and {r["id"]: r["counts"] for r in ev.data["rooms"]} == rooms, ev)

        poll(latest_counts, STREAM_WAIT_S)

    for step in (lambda: act(s, o, a, "verify"), lambda: act(s, o, e, "verify"),
                 lambda: o.patch(ipath(s, a), json={"pin": IN_LAUNDRY}), lambda: o.delete(ipath(s, c)),
                 lambda: o.post(s.path("/items/bulk"), json={"action": "start", "item_ids": [b["id"]]}),
                 lambda: sync(s, s.lead.api, op("create_item", 1, client_item_id=str(uuid.uuid4()), fields={"title": "Count S", "room_id": s.rooms["Hall"]["id"]})),
                 lambda: act(s, o, a, "reopen")):
        assert step().status_code in (200, 201, 204)
        agree()
    assert get_item(s, o, e)["status"] == "open"
    trade_rooms = {r["id"]: r["counts"] for r in s.elec.api.ok("GET", s.path("/rooms"))["rooms"]}
    assert sum(x["total"] for x in trade_rooms.values()) == 1 and s.elec.api.ok("GET", s.path())["progress"]["total"] == 1
    rooms, progress = recount(o, s)
    with ui(browser, app_url, o, s.url) as page:
        job_ready(page, s)
        visible(page, page.get_by_text(f"{progress['percent']}% verified").first)
        for name, room in s.rooms.items():
            v, t = rooms[room["id"]]["verified"], rooms[room["id"]]["total"]
            eventually(page, group_has(page, name, f"{v} of {t} verified"))
            assert plan_label(page, name) == (v, t)


def test_health_and_manifest_port(app_url):
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["content-type"].startswith("application/json")
    shell = httpx.get(app_url.rstrip("/") + f"/jobs/{uuid.uuid4()}", timeout=HTTP_TIMEOUT)
    assert shell.status_code == 200 and shell.text == httpx.get(app_url.rstrip("/") + "/", timeout=HTTP_TIMEOUT).text


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    refused(post_json(base, "/api/jobs", {"name": "x"}, None, Origin="http://elsewhere.example"), "cross_origin")
    stub = {"email": DANA, "password": "wrong-pw-123"}
    pad = lambda size: json.dumps({**stub, "pad": "x" * (size - len(json.dumps({**stub, "pad": ""})))}).encode()
    at_limit, over = pad(JSON_LIMIT), pad(JSON_LIMIT + 1)
    assert len(at_limit) == JSON_LIMIT and len(over) == JSON_LIMIT + 1
    headers = {"content-type": "application/json"}
    refused(httpx.post(base + "/api/session", content=at_limit, headers=headers, timeout=HTTP_TIMEOUT), "invalid_credentials")
    refused(httpx.post(base + "/api/session", content=over, headers=headers, timeout=HTTP_TIMEOUT), "too_large")
    refused(httpx.post(base + "/api/session", content=over, headers={**headers, "Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT), "too_large")
    s = make_site(base, people=False)
    refused(s.owner.put(s.path("/plan"), files={"file": ("big.png", b"\x89PNG" + b"0" * MULTIPART_LIMIT, "image/png")}), "too_large")
    r = s.owner.get(s.path())
    assert not [h for h in r.headers if h.lower().startswith("access-control-")]
    secrets = [os.environ[k] for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID") if os.environ.get(k)]
    shell = httpx.get(base + "/", timeout=HTTP_TIMEOUT).text
    assets = [httpx.get(base + src, timeout=HTTP_TIMEOUT).text for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell)]
    for leak in (shell, *assets, *(httpx.get(base + p, timeout=HTTP_TIMEOUT).text for p in ("/run.json", "/.env", "/package.json", "/package-lock.json"))):
        assert "run-manifest-v1" not in leak and not [x for x in secrets if x in leak]
    for env in ("APP_STORAGE_DOWN_URL", "APP_MAIL_DOWN_URL"):
        assert httpx.get(os.environ[env].rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_published_copy(browser, app_url):
    s = make_site(app_url)
    with ui(browser, app_url, None, "/signin") as page:
        visible(page, page.get_by_role("heading", name="Sign in", exact=True))
        page.get_by_label("Email", exact=True).fill(DANA)
        page.get_by_label("Password", exact=True).fill("not-the-password-1")
        page.get_by_role("button", name="Sign in").click()
        visible(page, page.get_by_text(CATALOGUE["invalid_credentials"][1], exact=True).first)
    with ui(browser, app_url, s.owner, f"/jobs/{uuid.uuid4()}") as page:
        visible(page, page.get_by_role("heading", name=NOT_FOUND_HEADING, exact=True))
        expect(page.get_by_role("link", name="Back to your jobs")).to_be_visible()
        page.goto(app_url.rstrip("/") + s.url)
        job_ready(page, s)
        expect(page.get_by_text(EMPTY_ROOM, exact=True)).to_have_count(4)
        expect(page.get_by_text("0% verified", exact=True).first).to_be_visible()
        q = page.get_by_label("Quick add item")
        q.fill("Copy check")
        q.press("Enter")
        made = poll(lambda: next(i for i in s.owner.ok("GET", s.path("/items"))["items"] if i["title"] == "Copy check"), LIVE_S)
        shows(page, activity(page), f"Item {made['number']} saved.")
    s.owner.delete(s.path(f"/members/{s.home.id}"))
    with ui(browser, app_url, s.home.api, "/jobs") as page:
        visible(page, page.get_by_role("heading", name="Your jobs"))
        visible(page, page.get_by_text(NO_JOBS, exact=True))


def test_breakpoint_layouts(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Layout pin", pin=IN_KITCHEN)
    no_plan = lambda names: not [n for n in names if n.startswith("Pin ") or n == "Fit plan"]
    with ui(browser, app_url, s.owner, s.url, size=WIDE) as page:
        job_ready(page, s)
        lb, pb = page.get_by_role("region", name="Punch list").bounding_box(), page.get_by_role("region", name="Plan").bounding_box()
        assert round(lb["x"] + lb["width"]) <= round(pb["x"]) and pb["width"] > lb["width"]
        layout(page)
    with ui(browser, app_url, s.owner, s.url, size=TABLET) as page:
        job_ready(page, s)
        show = page.get_by_role("button", name="Show plan")
        expect(show).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("region", name="Plan")).to_have_count(0)
        expect(page.get_by_role("button", name="Fit plan")).to_have_count(0)
        names = tab_order(page, TAB_PRESSES)
        assert no_plan(names) and "Show plan" in names
        layout(page)
        show.click()
        settle(page.locator("body"))
        expect(show).to_have_attribute("aria-expanded", "true")
        visible(page, pin_button(page, it))
        box = pin_button(page, it).bounding_box()
        assert 0 <= box["x"] and box["x"] + box["width"] <= TABLET[0]
    with ui(browser, app_url, s.owner, s.url, size=PHONE) as page:
        job_ready(page, s)
        show = page.get_by_role("button", name="Show plan")
        box = show.bounding_box()
        assert PHONE[1] / 2 < box["y"] and box["y"] + box["height"] <= PHONE[1]
        expect(page.get_by_role("region", name="Plan")).to_have_count(0)
        assert no_plan(tab_order(page, TAB_PRESSES))
        layout(page)
        show.click()
        sheet = page.get_by_role("dialog", name="Plan")
        visible(page, sheet)
        settle(page.locator("body"))
        assert sheet.bounding_box()["height"] >= SHEET_SHARE * PHONE[1]
        page.get_by_role("button", name="Close plan").click()
        settle(page.locator("body"))
        gone(page, page.get_by_role("dialog", name="Plan"))
        expect(page.get_by_role("region", name="Plan")).to_have_count(0)
        assert no_plan(tab_order(page, TAB_PRESSES))
        layout(page)


def test_dialogs_and_keyboard(browser, app_url):
    s = make_site(app_url)
    inside = lambda d: d.evaluate("d => d.contains(document.activeElement)")
    with ui(browser, app_url, s.owner, "/jobs") as page:
        opener = page.get_by_role("button", name="New job")
        visible(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New job")
        visible(page, dialog)
        for key in ["Tab"] * 12 + ["Shift+Tab"] * 12:
            page.keyboard.press(key)
            assert inside(dialog), key
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="New job"))
        expect(opener).to_be_focused()
    with ui(browser, app_url, s.owner, s.url, size=PHONE) as page:
        job_ready(page, s)
        opener = page.get_by_role("button", name="Show plan")
        opener.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Plan")
        visible(page, sheet)
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert inside(sheet), key
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Plan"))
        expect(opener).to_be_focused()


def note_setup(app_url: str) -> tuple[Site, dict, bool]:
    s = make_site(app_url)
    ids = member_ids(s)
    return s, add_item(s, s.owner, "Note item"), ids[DANA].lower() < ids[s.lead.email].lower()


def new_note(s: Site, it: dict, body: str) -> str:
    return ipath(s, it, f"/notes/{s.lead.api.ok('POST', ipath(s, it, '/notes'), 201, json={'body': body, 'audience': 'crew'})['id']}")


def edit(api: Api, path: str, base: int, pos: int, delete: int, insert: str) -> httpx.Response:
    return api.post(path + "/edits", json={"base_rev": base, "pos": pos, "delete": delete, "insert": insert})


def test_note_edits_converge(app_url):
    s, it, owner_first = note_setup(app_url)
    merged = "Fix tile today grout" if owner_first else "Fix tile grout today"
    orders = (((s.owner, " today"), (s.lead.api, " grout")), ((s.lead.api, " grout"), (s.owner, " today")))
    for order in orders:
        path = new_note(s, it, "Fix tile")
        for api, words in order:
            last = edit(api, path, 0, 8, 0, words)
            assert last.status_code == 200
        assert last.json()["body"] == merged and last.json()["rev"] == 2
    path = new_note(s, it, "Fix tile")
    parallel([lambda: edit(s.owner, path, 0, 8, 0, " today"), lambda: edit(s.lead.api, path, 0, 8, 0, " grout")])
    assert s.owner.ok("GET", path + "/history")["revisions"][-1]["body"] == merged
    path = new_note(s, it, "Fix tile")
    edit(s.owner, path, 0, 4, 4, "")
    assert edit(s.lead.api, path, 0, 8, 0, " grout").json()["body"] == "Fix  grout"
    emoji = new_note(s, it, EMOJI_NOTE)
    assert edit(s.lead.api, emoji, 0, 2, 0, EMOJI_INSERT).json()["body"] == EMOJI_NOTE[:2] + EMOJI_INSERT + EMOJI_NOTE[2:]
    refused(edit(s.lead.api, emoji, 5, 0, 0, "x"), "validation", "base_rev")
    refused(edit(s.lead.api, emoji, 0, -1, 0, "x"), "validation", "pos")
    refused(edit(s.lead.api, emoji, 0, 5, 3, ""), "validation")
    refused(edit(s.lead.api, emoji, 0, 1, 0, ""), "validation")
    refused(edit(s.lead.api, emoji, 1, 0, 0, "x" * NOTE_MAX), "validation")


def test_personal_undo_redo(app_url):
    s, it, owner_first = note_setup(app_url)
    path = new_note(s, it, "Fix tile")
    note_id = path.rsplit("/", 1)[1]
    edit(s.owner, path, 0, 8, 0, " today")
    sync(s, s.lead.api, op("edit_note", 1, item_id=it["id"], note_id=note_id, base_rev=0, pos=8, delete=0, insert=" grout"))
    undone = s.lead.api.ok("POST", path + "/undo")
    assert (undone["body"], undone["rev"]) == ("Fix tile today", 3)
    assert s.owner.ok("POST", path + "/undo")["body"] == "Fix tile"
    refused(s.owner.post(path + "/undo"), "nothing_to_undo")
    assert s.lead.api.ok("POST", path + "/redo")["body"] == "Fix tile grout"
    assert s.owner.ok("POST", path + "/redo")["body"] == ("Fix tile today grout" if owner_first else "Fix tile grout today")
    s.lead.api.ok("POST", path + "/undo")
    edit(s.lead.api, path, 6, 0, 0, "Now ")
    refused(s.lead.api.post(path + "/redo"), "nothing_to_redo")
    history = s.lead.api.ok("GET", path + "/history")["revisions"]
    assert [h["rev"] for h in history] == list(range(len(history)))
    assert [h["kind"] for h in history] == ["create", "edit", "edit", "undo", "undo", "redo", "redo", "undo", "edit"]
    assert history[0]["body"] == "Fix tile" and history[3]["body"] == "Fix tile today"
    assert history[-1]["body"] == get_item(s, s.owner, it)["notes"][0]["body"]
    second = new_note(s, it, "Fix tile")
    edit(s.owner, second, 0, 4, 4, "")
    edit(s.lead.api, second, 0, 8, 0, " grout")
    assert s.owner.ok("POST", second + "/undo")["body"] == "Fix tile grout"


POINTS_SHIFT = [{"old": {"x": 0.1, "y": 0.1}, "new": {"x": 0.12, "y": 0.1}}, {"old": {"x": 0.9, "y": 0.1}, "new": {"x": 0.92, "y": 0.1}},
                {"old": {"x": 0.1, "y": 0.9}, "new": {"x": 0.12, "y": 0.9}}]
POINTS_SCALE = [{"old": {"x": 0.1, "y": 0.1}, "new": {"x": 0.14, "y": 0.14}}, {"old": {"x": 0.9, "y": 0.1}, "new": {"x": 0.86, "y": 0.14}},
                {"old": {"x": 0.1, "y": 0.9}, "new": {"x": 0.14, "y": 0.86}}]
REV2_ROOMS = {
    "Kitchen": [(0.086, 0.095), (0.518, 0.095), (0.518, 0.32), (0.30, 0.32), (0.30, 0.473), (0.086, 0.473)],
    "Primary bath": [(0.572, 0.095), (0.914, 0.095), (0.914, 0.455), (0.572, 0.455)],
    "Hall": [(0.086, 0.527), (0.446, 0.527), (0.446, 0.725), (0.60, 0.725), (0.60, 0.905), (0.086, 0.905)],
    "Laundry": [(0.60, 0.527), (0.914, 0.527), (0.914, 0.905), (0.60, 0.905)],
}


def shifted(rooms: dict, dx: float) -> dict:
    return {n: [(round(x + dx, 4), y) for x, y in c] for n, c in rooms.items()}


def revise(s: Site, api: Api, points: list, rooms: dict, image: bytes | None = None) -> httpx.Response:
    return api.post(s.path("/plan/revisions"), files={
        "file": ("rev.png", image or png(shade=70), "image/png"), "reference_points": (None, json.dumps(points)),
        "rooms": (None, json.dumps([{"room_id": s.rooms[n]["id"], "outline": outline(c)} for n, c in rooms.items()]))})


def test_plan_revisions(app_url):
    bare = make_site(app_url, plan=False, people=False)
    refused(revise(bare, bare.owner, POINTS_SHIFT, SEED_ROOMS), "invalid_transition")
    s = make_site(app_url)
    o = s.owner
    it = add_item(s, o, "Rev pin", pin=IN_KITCHEN)
    first_key = S3().keys(f"jobs/{s.id}/plan/")[0]
    collinear = [{"old": {"x": v, "y": v}, "new": {"x": v, "y": v}} for v in (0.1, 0.5, 0.9)]
    refused(revise(s, o, collinear, SEED_ROOMS), "validation", "reference_points", COLLINEAR_MSG)
    refused(revise(s, o, POINTS_SHIFT, {k: v for k, v in SEED_ROOMS.items() if k != "Hall"}), "validation", "rooms")
    refused(revise(s, o, POINTS_SHIFT, {**SEED_ROOMS, "Primary bath": SEED_ROOMS["Kitchen"]}), "validation", "rooms", OVERLAP_MSG)
    refused(revise(s, s.lead.api, POINTS_SHIFT, SEED_ROOMS), "forbidden")
    r = revise(s, o, POINTS_SHIFT, shifted(SEED_ROOMS, 0.02))
    assert r.status_code == 201 and r.json()["revision"] == 2 and r.json()["job"]["plan_revision"] == 2
    assert get_item(s, o, it)["pin"] == {"x": pytest.approx(0.32), "y": pytest.approx(0.12)}
    revs = s.lead.api.ok("GET", s.path("/plan/revisions"))["revisions"]
    assert [(x["revision"], x["uploaded_by"]["name"]) for x in revs] == [(1, DANA_NAME), (2, DANA_NAME)]
    assert o.get(s.path("/plan/revisions/1")).content == S3().get(first_key)
    assert len(S3().keys(f"jobs/{s.id}/plan/")) == 2
    for api in (s.elec.api, s.home.api):
        refused(api.get(s.path("/plan/revisions")), "forbidden")
        refused(api.get(s.path("/plan/revisions/1")), "forbidden")
        refused(api.get(s.path("/plan/revisions/9")), "not_found")
    refused(o.get(s.path("/plan/revisions/9")), "not_found")
    down = Api(os.environ["APP_STORAGE_DOWN_URL"], DANA)
    refused(revise(s, down, POINTS_SCALE, REV2_ROOMS), "storage_unavailable")
    assert o.ok("GET", s.path())["plan_revision"] == 2 and len(o.ok("GET", s.path("/plan/revisions"))["revisions"]) == 2
    assert get_item(s, o, it)["pin"] == {"x": pytest.approx(0.32), "y": pytest.approx(0.12)}
    ident = o.ok("PUT", s.path("/plan"), files={"file": ("p3.png", png(shade=40), "image/png")})
    assert ident["plan_revision"] == 3 and get_item(s, o, it)["pin"] == {"x": pytest.approx(0.32), "y": pytest.approx(0.12)}


def test_pin_transform(app_url):
    s = make_site(app_url)
    o = s.owner
    k1 = add_item(s, o, "K1", pin=IN_KITCHEN)
    add_item(s, o, "K2", pin={"x": 0.1237, "y": 0.1001})
    add_item(s, o, "N1", pin={"x": 0.36, "y": 0.40})
    l1 = add_item(s, o, "L1", pin={"x": 0.55, "y": 0.85})
    l2 = add_item(s, o, "L2", pin=IN_LAUNDRY)
    act(s, o, l1, "verify")
    r = revise(s, o, POINTS_SCALE, REV2_ROOMS).json()
    assert r["needs_review"] == 1 and r["moved"] in (4, 5)
    pins = {x["title"]: x for x in o.ok("GET", s.path("/items"))["items"]}
    assert pins["K1"]["pin"] == {"x": pytest.approx(0.32), "y": pytest.approx(0.158)}
    assert pins["K2"]["pin"] == {"x": pytest.approx(0.1613), "y": pytest.approx(0.1401)}
    assert (pins["N1"]["pin"], pins["N1"]["pin_status"], room_name(s, pins["N1"]["room_id"])) == (None, "needs_review", "Kitchen")
    assert room_name(s, pins["L1"]["room_id"]) == "Hall" and pins["L1"]["status"] == "verified"
    assert room_name(s, pins["L2"]["room_id"]) == "Laundry"
    rooms = {x["name"]: x for x in o.ok("GET", s.path("/rooms"))["rooms"]}
    assert (rooms["Kitchen"]["anchor"]["x"], rooms["Kitchen"]["anchor"]["y"]) == pytest.approx((0.302, 0.284))
    assert rooms["Hall"]["counts"] == {"verified": 1, "total": 1} and rooms["Laundry"]["counts"] == {"verified": 0, "total": 1}
    ok = sync(s, s.lead.api, op("update_item", 1, item_id=l2["id"], plan_revision=1,
                                changes={"pin": {"from": IN_LAUNDRY, "to": {"x": 0.75, "y": 0.85}}})).json()["results"][0]
    assert ok["outcome"] == "applied" and ok["item"]["pin"] == {"x": pytest.approx(0.725), "y": pytest.approx(0.815)} and ok["item"]["conflicts"] == []
    bad = sync(s, s.lead.api, op("update_item", 1, item_id=k1["id"], plan_revision=1,
                                 changes={"pin": {"from": IN_KITCHEN, "to": {"x": 0.36, "y": 0.40}}})).json()["results"][0]
    assert bad["outcome"] == "rejected" and bad["error"]["fields"]["pin"] == PIN_MSG
    assert revise(s, o, [{"old": {"x": 0.1, "y": 0.1}, "new": {"x": 0.11, "y": 0.1}}, {"old": {"x": 0.9, "y": 0.1}, "new": {"x": 0.91, "y": 0.1}},
                         {"old": {"x": 0.1, "y": 0.9}, "new": {"x": 0.11, "y": 0.9}}], shifted(REV2_ROOMS, 0.01)).status_code == 201
    made = sync(s, s.lead.api, op("create_item", 1, client_item_id=str(uuid.uuid4()), plan_revision=1,
                                  fields={"title": "Old stamp", "room_id": s.rooms["Kitchen"]["id"], "pin": {"x": 0.20, "y": 0.20}})).json()["results"][0]
    assert made["outcome"] == "applied" and made["item"]["pin"] == {"x": pytest.approx(0.24), "y": pytest.approx(0.23)}


def test_item_costs(app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Costed")
    for q, u in (("2.5", "0.05"), ("1.5", "0.05"), ("3", "1.00"), ("9999.999", "99999.99"), (None, "5.00")):
        got = s.lead.api.ok("PATCH", ipath(s, it), json={"quantity": q, "unit_cost": u})
        assert got["line_total"] == line_total(q, u)
        assert got["quantity"] == (None if q is None else f"{Decimal(q):.3f}") and got["unit_cost"] == f"{Decimal(u):.2f}"
    assert s.owner.ok("PATCH", ipath(s, it), json={"quantity": "2.5", "unit_cost": "0.05"})["line_total"] == "0.12"
    assert s.owner.ok("PATCH", ipath(s, it), json={"quantity": "1.5"})["line_total"] == "0.08"
    refused(s.owner.patch(ipath(s, it), json={"quantity": 2}), "validation", "quantity")
    refused(s.home.api.patch(ipath(s, add_item(s, s.home.api, "Mine", room="Hall")), json={"quantity": "1"}), "forbidden")
    priced = add_item(s, s.owner, "Priced", trade="electrical", cost_note=PRICE_NOTE, quantity="2", unit_cost="4.00")
    assert s.lead.api.ok("GET", ipath(s, priced))["line_total"] == line_total("2", "4.00")
    for api in (s.elec.api, s.home.api):
        view = get_item(s, api, priced)
        assert not {"cost_note", "quantity", "unit_cost", "line_total"} & set(view)
        assert PRICE_NOTE not in json.dumps(api.ok("GET", s.path("/items")))


def test_cost_rollups(app_url):
    s = make_site(app_url)
    o = s.owner
    lines = [("Kitchen", None, "2", "10.00"), ("Hall", "electrical", "1.5", "0.05"), ("Hall", "tile", "3", "1.00")]
    for room, trade, q, u in lines:
        add_item(s, o, f"Cost {room} {trade}", room=room, trade=trade, quantity=q, unit_cost=u)
    subtotal = sum(Decimal(line_total(q, u)) for *_, q, u in lines)
    costs = lambda as_of=None: o.ok("GET", s.path("/costs"), params={"as_of": as_of} if as_of else {})
    now = costs()
    assert [r["name"] for r in now["by_room"]] == list(SEED_ROOMS) and now["by_room"][1]["subtotal"] == "0.00"
    assert [r["trade"] for r in now["by_trade"]] == TRADE_ORDER and now["items_subtotal"] == money(subtotal)
    co = o.ok("POST", s.path("/change-orders"), 201, json={"description": "Extra outlet", "amount": "100.00"})
    assert co["status"] == "pending" and costs()["change_orders_total"] == "0.00"
    e0 = o.ok("PUT", s.path("/contingency"), json={"percent": "0.50"})["effective_at"]
    a1 = o.ok("POST", s.path(f"/change-orders/{co['id']}/approve"))["approved_at"]
    refused(o.post(s.path(f"/change-orders/{co['id']}/approve")), "invalid_transition")
    o.ok("PUT", s.path("/contingency"), json={"percent": "5.00"})
    for as_of, co_total, pct in ((co["created_at"], "0", "0.00"), (e0, "0", "0.50"), (a1, "100.00", "0.50"), (None, "100.00", "5.00")):
        got = costs(as_of)
        cont = money((subtotal + Decimal(co_total)) * Decimal(pct) / 100)
        assert (got["change_orders_total"], got["contingency_percent"], got["contingency"], got["total"]) == (
            money(Decimal(co_total)), pct, cont, money(subtotal + Decimal(co_total) + Decimal(cont)))
    s2 = make_site(app_url, people=False)
    tiny = add_item(s2, s2.owner, "Tiny", quantity="1", unit_cost="1.00")
    s2.owner.ok("PUT", s2.path("/contingency"), json={"percent": "0.50"})
    assert s2.owner.ok("GET", s2.path("/costs"))["contingency"] == "0.00"
    s2.owner.ok("PATCH", ipath(s2, tiny), json={"unit_cost": "3.00"})
    assert s2.owner.ok("GET", s2.path("/costs"))["contingency"] == "0.02"
    neg = s2.owner.ok("POST", s2.path("/change-orders"), 201, json={"description": "Credit", "amount": "-5.00"})
    s2.owner.ok("POST", s2.path(f"/change-orders/{neg['id']}/approve"))
    final = s2.owner.ok("GET", s2.path("/costs"))
    assert (final["contingency"], final["total"]) == ("0.00", "-2.00")
    race = s.lead.api.ok("POST", s.path("/change-orders"), 201, json={"description": "Race", "amount": "1.00"})
    assert sorted(r.status_code for r in parallel([lambda: o.post(s.path(f"/change-orders/{race['id']}/approve")) for _ in range(3)])) == [200, 409, 409]
    for bad in ("25.01", "5.001", "-1"):
        refused(o.put(s.path("/contingency"), json={"percent": bad}), "validation", "percent")
    for bad in ({"amount": "0"}, {"amount": "100000.00"}, {"description": ""}):
        refused(o.post(s.path("/change-orders"), json={"description": "X", "amount": "1.00", **bad}), "validation", next(iter(bad)))
    refused(s.lead.api.post(s.path(f"/change-orders/{race['id']}/approve")), "forbidden")
    refused(s.lead.api.put(s.path("/contingency"), json={"percent": "1.00"}), "forbidden")
    refused(s.elec.api.get(s.path("/costs")), "forbidden")
    refused(s.home.api.get(s.path("/change-orders")), "forbidden")
    refused(o.get(s.path("/costs"), params={"as_of": "yesterday"}), "validation", "as_of")


def test_blocked_by_links(app_url):
    s = make_site(app_url)
    o = s.owner
    a, b, c, d = (add_item(s, o, f"Link {x}") for x in "ABCD")
    set_links = lambda it, ids, api=o: api.put(ipath(s, it, "/blocked-by"), json={"item_ids": ids})
    assert set_links(a, [b["id"], b["id"]]).json()["blocked_by"] == [b["number"]]
    refused(set_links(b, [a["id"]]), "validation", "item_ids", CYCLE_MSG)
    refused(set_links(a, [a["id"]]), "validation", "item_ids", CYCLE_MSG)
    many = [add_item(s, o, f"Many {i}")["id"] for i in range(11)]
    refused(set_links(d, many), "validation", "item_ids")
    refused(set_links(d, [a["id"]], s.elec.api), "not_found")
    refused(set_links(add_item(s, o, "Link E", trade="electrical"), [], s.elec.api), "forbidden")
    assert refused(act(s, o, a, "verify"), "blocked")["waiting_on"] == [b["number"]]
    act(s, o, b, "verify")
    act(s, o, a, "verify")
    set_links(c, [a["id"]])
    act(s, o, c, "verify")
    ready = add_item(s, s.lead.api, "Ready")
    act(s, o, ready, "start")
    act(s, o, ready, "mark_done")
    refused(set_links(ready, [d["id"]]), "blocked")
    reopened = act(s, o, b, "reopen").json()
    assert reopened["reopened_dependents"] == sorted([a["number"], c["number"]])
    assert get_item(s, o, a)["status"] == "open" and get_item(s, o, c)["status"] == "open"
    rooms, progress = recount(o, s)
    assert {r["id"]: r["counts"] for r in o.ok("GET", s.path("/rooms"))["rooms"]} == rooms
    assert o.ok("GET", s.path())["progress"] == progress
    x, y = add_item(s, o, "Cycle X"), add_item(s, o, "Cycle Y")
    out = parallel([lambda: set_links(x, [y["id"]]), lambda: set_links(y, [x["id"]])])
    assert sorted(r.status_code for r in out) == [200, 422]
    assert sorted(set_links(c, [a["id"], d["id"]]).json()["blocked_by"]) == sorted([a["number"], d["number"]])
    assert o.delete(ipath(s, d)).status_code == 204
    assert get_item(s, o, c)["blocked_by"] == [a["number"]]


def test_bulk_actions(app_url, mail):
    s = make_site(app_url)
    o = s.owner
    i3, i4, i5 = (add_item(s, o, f"Bulk {n}") for n in (3, 4, 5))
    o.ok("PUT", ipath(s, i5, "/blocked-by"), json={"item_ids": [i3["id"]]})
    done = o.ok("POST", s.path("/items/bulk"), json={"action": "verify", "item_ids": [i5["id"], i3["id"]]})["items"]
    assert [i["number"] for i in done] == [i3["number"], i5["number"]] and {i["status"] for i in done} == {"verified"}
    p, q = add_item(s, o, "Waits"), add_item(s, o, "Blocker")
    o.ok("PUT", ipath(s, p, "/blocked-by"), json={"item_ids": [q["id"]]})
    stream = Stream(o, s.id)
    o.ok("PATCH", ipath(s, i4), json={"title": MARKER_ONE})
    last = stream.until(item_event(MARKER_ONE))[-1].id
    fail = refused(o.post(s.path("/items/bulk"), json={"action": "verify", "item_ids": [q["id"], p["id"]]}), "bulk_failed")
    assert fail["failures"] == [{"number": p["number"], "error": "blocked", "message": CATALOGUE["blocked"][1]}]
    assert get_item(s, o, q)["status"] == "open"
    multi = refused(o.post(s.path("/items/bulk"), json={"action": "mark_done", "item_ids": [q["id"], i4["id"]]}), "bulk_failed")
    assert [f["number"] for f in multi["failures"]] == sorted([q["number"], i4["number"]])
    verified_one = refused(o.post(s.path("/items/bulk"), json={"action": "set_trade", "trade": "tile", "item_ids": [i4["id"], i3["id"]]}), "bulk_failed")
    assert [f["error"] for f in verified_one["failures"]] == ["invalid_transition"]
    assert inbox(mail, s.tile.email, 1, MAIL_GRACE_S) == []
    o.ok("PATCH", ipath(s, i4), json={"title": MARKER_TWO})
    nxt = stream.until(lambda e: e.id > last)[0]
    assert nxt.id == last + 1 and nxt.type == "item" and nxt.data["item"]["title"] == MARKER_TWO
    ok = o.ok("POST", s.path("/items/bulk"), json={"action": "set_trade", "trade": "tile", "item_ids": [i4["id"], q["id"]]})
    assert [i["trade"] for i in ok["items"]] == ["tile", "tile"]
    assert len(inbox(mail, s.tile.email, 2)) == 2
    refused(o.post(s.path("/items/bulk"), json={"action": "set_trade", "item_ids": [i4["id"]]}), "validation", "trade")
    refused(o.post(s.path("/items/bulk"), json={"action": "start", "item_ids": [i4["id"], i4["id"]]}), "validation", "item_ids")
    refused(o.post(s.path("/items/bulk"), json={"action": "start", "item_ids": []}), "validation", "item_ids")
    refused(o.post(s.path("/items/bulk"), json={"action": "start", "item_ids": [i4["id"]] * (BULK_MAX + 1)}), "validation", "item_ids")
    refused(s.tile.api.post(s.path("/items/bulk"), json={"action": "verify", "item_ids": [i4["id"]]}), "forbidden")
    refused(s.tile.api.post(s.path("/items/bulk"), json={"action": "set_trade", "trade": None, "item_ids": [i4["id"]]}), "forbidden")
    refused(s.home.api.post(s.path("/items/bulk"), json={"action": "start", "item_ids": [i4["id"]]}), "forbidden")
    other = make_site(app_url, people=False)
    refused(s.tile.api.post(s.path("/items/bulk"), json={"action": "verify", "item_ids": [add_item(other, other.owner, "Elsewhere")["id"]]}), "not_found")
    assert s.tile.api.ok("POST", s.path("/items/bulk"), json={"action": "start", "item_ids": [i4["id"], q["id"]]})["items"][0]["status"] == "in_progress"


def test_event_stream_projection(app_url):
    s = make_site(app_url)
    o = s.owner
    e_item = add_item(s, o, "Stream elec", trade="electrical", cost_note="Hidden cost probe")
    owner_s, elec_s, home_s = Stream(o, s.id, after=0), Stream(s.elec.api, s.id), Stream(s.home.api, s.id)
    o.ok("PATCH", ipath(s, e_item), json={"title": "Stream elec 2"})
    got = owner_s.until(item_event("Stream elec 2"), STREAM_WAIT_S * 3)
    assert [e.id for e in got] == list(range(1, len(got) + 1))
    assert set(elec_s.until(item_event("Stream elec 2"))[-1].data["item"]) == ITEM_KEYS - TRADE_HIDDEN
    assert set(home_s.until(item_event("Stream elec 2"))[-1].data["item"]) == ITEM_KEYS - TRADE_HIDDEN - {"sent_back_reason"}
    s.lead.api.ok("POST", ipath(s, e_item, "/notes"), 201, json={"body": "Crew stream", "audience": "crew"})
    s.lead.api.ok("POST", ipath(s, e_item, "/notes"), 201, json={"body": "All stream", "audience": "everyone"})
    notes = [e for e in home_s.until(lambda e: e.type == "note" and e.data["note"]["body"] == "All stream") if e.type == "note"]
    assert [e.data["note"]["body"] for e in notes] == ["All stream"]
    tile_item = add_item(s, o, "Tile only stream", trade="tile")
    kid = str(uuid.uuid4())
    create = op("create_item", 1, client_item_id=kid, fields={"title": "Replayed", "room_id": s.rooms["Hall"]["id"]})
    sync(s, s.lead.api, create)
    last = owner_s.until(item_event("Replayed"))[-1].id
    sync(s, s.lead.api, create)
    sync(s, s.lead.api, op("create_item", 1, client_item_id=str(uuid.uuid4()), fields={"title": "Rejected", "room_id": s.rooms["Hall"]["id"], "pin": OUTSIDE}))
    o.patch(ipath(s, e_item), json={"quantity": 3})
    o.ok("PATCH", ipath(s, e_item), json={"title": "Stream marker"})
    rest = owner_s.until(item_event("Stream marker"))
    assert [e.id for e in rest] == list(range(last + 1, last + 1 + len(rest)))
    assert [e.data["item"]["title"] for e in rest if e.type == "item"] == ["Stream marker"]
    seen = elec_s.until(item_event("Stream marker"))
    assert tile_item["id"] not in [e.data["item"]["id"] for e in seen if e.type == "item"]
    o.ok("PATCH", ipath(s, e_item), json={"trade": "tile"})
    assert elec_s.until(lambda e: e.type == "item_deleted")[-1].data == {"id": e_item["id"], "number": e_item["number"]}
    outsider = make_site(app_url, plan=False, rooms={})
    peek = Stream(outsider.home.api, s.id)
    assert peek.status == 404 and json.loads(peek.body) == NOT_FOUND_BODY
    assert o.delete(s.path(f"/members/{s.elec.id}")).status_code == 204
    elec_s.until(lambda e: e.type == "role_ended")
    assert elec_s.done.wait(LIVE_S)
    refused(s.elec.api.get(s.path("/items")), "role_ended")


def test_event_resume_and_processes(app_url):
    s = make_site(app_url)
    o = s.owner
    a = add_item(s, o, "Resume A", trade="electrical")
    t = add_item(s, o, "Resume tile", trade="tile")
    live = Stream(o, s.id, after=0)
    mark = live.until(lambda e: e.type == "item" and e.data["item"]["id"] == t["id"], STREAM_WAIT_S * 3)[-1].id
    live.close()
    o.ok("PATCH", ipath(s, a), json={"title": "Resume B"})
    o.ok("PATCH", ipath(s, t), json={"title": "Resume tile 2"})
    o.ok("PATCH", ipath(s, a), json={"title": "Resume C"})
    resumed = Stream(o, s.id, last_event_id=mark, after=1).until(item_event("Resume C"))
    assert [e.id for e in resumed] == list(range(mark + 1, mark + 1 + len(resumed)))
    latest = resumed[-1].id
    elec = Stream(s.elec.api, s.id, after=mark).until(item_event("Resume C"))
    assert t["id"] not in [e.data["item"]["id"] for e in elec if e.type == "item"] and all(e.id > mark for e in elec)
    reset = Stream(o, s.id, after=latest + 1000).until(lambda e: True)[0]
    assert (reset.type, reset.id) == ("reset", latest)
    mirror = Stream(Api(os.environ["APP_MIRROR_URL"], DANA), s.id)
    o.ok("PATCH", ipath(s, a), json={"title": "Mirror seen"})
    mirror.until(item_event("Mirror seen"), LIVE_S)
    base = os.environ["APP_SUMMARY_URL"]
    r = make_site(base, people=False)
    watch = Stream(r.owner, r.id)
    for i in range(RETENTION_PROBE):
        add_item(r, r.owner, f"Retained {i}")
    top = watch.until(item_event(f"Retained {RETENTION_PROBE - 1}"), STREAM_WAIT_S * 5)[-1].id
    old = Stream(r.owner, r.id, after=1).until(lambda e: True)[0]
    assert old.type == "reset" and old.id >= top


def sign_in_ui(page: Page, base: str, email: str, password: str = SEED_PASSWORD) -> None:
    page.goto(base.rstrip("/") + "/signin")
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()
    visible(page, page.get_by_role("heading", name="Your jobs"))


def add_room_ui(page: Page, name: str, corners: str) -> Locator:
    page.get_by_role("button", name="Add room").click()
    d = page.get_by_role("dialog", name="Add room")
    d.get_by_label("Room name").fill(name)
    d.get_by_label("Corners").fill(corners)
    d.get_by_role("button", name="Save room").click()
    return d


def test_wf_job_setup_happy(browser, app_url):
    _, tag = token("setup")
    name = f"Setup {tag}"
    with ui(browser, app_url, None, "/signin") as page:
        sign_in_ui(page, app_url, DANA)
        for seeded in (HALE, ODUYA):
            expect(page.get_by_role("link", name=seeded, exact=True)).to_be_visible()
        page.get_by_role("button", name="New job").click()
        d = page.get_by_role("dialog", name="New job")
        d.get_by_label("Job name").fill(name)
        d.get_by_label("Address").fill(f"{tag} Setup Road")
        select(d.get_by_label("Time zone"), "America/Chicago")
        d.get_by_role("button", name="Create job").click()
        shows(page, activity(page), "Job created.")
        job = next(j for j in Api(app_url, DANA).ok("GET", "/api/jobs")["jobs"] if j["name"] == name)
        s = Site(app_url.rstrip("/"), job["id"], name, "America/Chicago", Api(app_url, DANA), {})
        page.goto(s.base + s.url)
        job_ready(page, s)
        expect(page.get_by_text("0% verified", exact=True).first).to_be_visible()
        expect(plan_img(page, s)).to_have_count(0)
        page.get_by_role("tab", name="Setup").click()
        page.get_by_label("Upload plan", exact=True).set_input_files(files=[{"name": "plan.png", "mimeType": "image/png", "buffer": png()}])
        shows(page, activity(page), "Plan uploaded.")
        add_room_ui(page, "Kitchen", "4,5; 52,5; 52,30; 40,30; 40,47; 4,47")
        shows(page, activity(page), "Room saved.")
        add_room_ui(page, "Primary bath", "58,5; 96,5; 96,45; 58,45")
        shows(page, activity(page), "Room saved.")
        d = add_room_ui(page, "Pantry", "30,10; 50,10; 50,20; 30,20")
        visible(page, page.get_by_role("alert", name="There is a problem"))
        expect(d).to_contain_text(OVERLAP_MSG)
        page.keyboard.press("Escape")
        page.get_by_role("tab", name="People & visits").click()
        people = []
        for label, role, trade in (("lead", "Lead carpenter", None), ("sparks", "Trade", "Electrical"), ("tiler", "Trade", "Tile"), ("home", "Homeowner", None)):
            email, t = token(label)
            people.append(email)
            page.get_by_role("button", name="Add person").click()
            d = page.get_by_role("dialog", name="Add person")
            d.get_by_label("Name", exact=True).fill(f"{label} {t}")
            d.get_by_label("Email", exact=True).fill(email)
            select(d.get_by_label("Role", exact=True), role)
            if trade:
                select(d.get_by_label("Trade", exact=True), trade)
            d.get_by_label("Initial password").fill(INITIAL_PASSWORD)
            d.get_by_role("button", name="Add", exact=True).click()
            shows(page, activity(page), "Person added.")
    rooms = s.owner.ok("GET", s.path("/rooms"))["rooms"]
    assert [r["name"] for r in rooms] == ["Kitchen", "Primary bath"]
    assert (rooms[0]["anchor"]["x"], rooms[0]["anchor"]["y"]) == pytest.approx(SEED_ANCHORS["Kitchen"])
    assert s.owner.ok("GET", s.path())["plan_revision"] == 1
    roles = {m["email"]: (m["role"], m["trade"]) for m in s.owner.ok("GET", s.path("/members"))["members"]}
    assert [roles[e] for e in people] == [("lead", None), ("trade", "electrical"), ("trade", "tile"), ("homeowner", None)]
    hale = next(j for j in Api(app_url, DANA).ok("GET", "/api/jobs")["jobs"] if j["name"] == HALE)
    with ui(browser, app_url, None, "/signin") as page:
        sign_in_ui(page, app_url, people[3], INITIAL_PASSWORD)
        expect(page.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(page.get_by_role("link", name=HALE, exact=True)).to_have_count(0)
        page.goto(app_url.rstrip("/") + f"/jobs/{hale['id']}")
        visible(page, page.get_by_role("heading", name=NOT_FOUND_HEADING))


def test_wf_job_setup_invalid_corners(browser, app_url):
    s = make_site(app_url, rooms={}, people=False)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Setup").click()
        d = add_room_ui(page, "Den", "4,5; 52,5; 52,30")
        alert = page.get_by_role("alert", name="There is a problem")
        visible(page, alert)
        alert.get_by_role("link").first.click()
        expect(d.get_by_label("Corners")).to_be_focused()
        d.get_by_label("Corners").fill("4,5; 52,5; 52,30; 4,30")
        d.get_by_role("button", name="Save room").click()
        shows(page, activity(page), "Room saved.")
    assert [r["name"] for r in s.owner.ok("GET", s.path("/rooms"))["rooms"]] == ["Den"]


def test_wf_walkthrough_capture_keyboard(browser, app_url):
    s = make_site(app_url)
    with ui(browser, app_url, s.lead.api, s.url) as page, ui(browser, app_url, s.owner, s.url) as watch:
        job_ready(page, s)
        job_ready(watch, s)
        q = page.get_by_label("Quick add item")
        made = []
        for title in KEYBOARD_TITLES:
            q.focus()
            page.keyboard.type(title)
            page.keyboard.press("Enter")
            shows(page, activity(page), re.compile(r"^Item \d+ saved\.$"))
            expect(q).to_be_focused()
            expect(q).to_have_value("")
            made.append(poll(lambda t=title: next(i for i in s.lead.api.ok("GET", s.path("/items"))["items"] if i["title"] == t), LIVE_S))
        first, crew = made
        room_row(page, "Kitchen", first).focus()
        page.keyboard.press("p")
        page.keyboard.press("Enter")
        shows(page, activity(page), f"Pin dropped for item {first['number']} in Kitchen.")
        room_row(page, "Kitchen", first).focus()
        page.keyboard.press("Enter")
        select(details(page, first).get_by_role("combobox", name="Trade", exact=True), "Tile")
        shows(page, activity(page), f"Item {first['number']} saved.")
        page.get_by_role("button", name=f"Check off item {crew['number']}", exact=True).focus()
        page.keyboard.press("Enter")
        shows(page, activity(page), f"Item {crew['number']}: Verified.")
        room_row(page, "Kitchen", crew).focus()
        page.keyboard.press("p")
        for _ in range(7):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        shows(page, activity(page), f"Pin dropped for item {crew['number']} in Primary bath.")
        assert get_item(s, s.owner, crew)["status"] == "verified"
        for p in (page, watch):
            eventually(p, lambda p=p: expect(room_row(p, "Primary bath", crew)).to_be_visible(timeout=QUICK_MS), LIVE_S)
            eventually(p, group_has(p, "Primary bath", "1 of 1 verified"), LIVE_S)
            eventually(p, group_has(p, "Kitchen", "0 of 1 verified"), LIVE_S)
            assert plan_label(p, "Primary bath") == (1, 1) and plan_label(p, "Kitchen") == (0, 1)
    pinned, checked = get_item(s, s.owner, first), get_item(s, s.owner, crew)
    assert pinned["trade"] == "tile" and pinned["pin"] == {"x": pytest.approx(0.28), "y": pytest.approx(0.26)}
    assert (room_name(s, checked["room_id"]), checked["number"]) == ("Primary bath", crew["number"])


def test_wf_walkthrough_capture_refused_pin(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.lead.api, "Between rooms")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        row(page, it).focus()
        page.keyboard.press("p")
        for _ in range(5):
            page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Enter")
        visible(page, page.get_by_text(PIN_MSG).first)
        assert marks(page, CROSSHAIR_ATTR)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(row(page, it)).to_be_focused(timeout=QUICK_MS))
    assert get_item(s, s.lead.api, it)["pin"] is None


def test_wf_room_tether_homeowner_finds_pins(browser, app_url):
    s = make_site(app_url)
    a = add_item(s, s.owner, "Find me", pin=IN_KITCHEN)
    b = add_item(s, s.owner, "Verified spot", pin=IN_LAUNDRY)
    act(s, s.owner, b, "verify")
    for i in range(12):
        add_item(s, s.owner, f"Filler {i}", room="Hall")
    with ui(browser, app_url, s.home.api, s.url) as page:
        job_ready(page, s)
        pb = pin_button(page, b)
        visible(page, pb)
        assert pb.inner_text().strip() != str(b["number"])
        assert str(a["number"]) in pin_button(page, a).inner_text()
        pb.click()
        eventually(page, lambda: expect(row(page, b)).to_have_attribute("aria-current", "true", timeout=QUICK_MS))
        expect(row(page, b)).to_be_in_viewport()
        row(page, a).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(row(page, a)).to_have_attribute("aria-current", "true", timeout=QUICK_MS))
        settle(page.locator("body"))
        assert framed(page, s, "Kitchen", plan_img(page, s))
        assert covers(pin_button(page, a).bounding_box(), at_point(plan_img(page, s).bounding_box(), IN_KITCHEN["x"], IN_KITCHEN["y"]))
    assert get_item(s, s.home.api, b)["status"] == "verified"


def test_wf_room_tether_trade_phone(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Phone elec", trade="electrical", pin=IN_KITCHEN)
    with ui(browser, app_url, s.elec.api, s.url, size=WIDE) as page:
        job_ready(page, s)
        lb, pb = page.get_by_role("region", name="Punch list").bounding_box(), page.get_by_role("region", name="Plan").bounding_box()
        assert round(lb["x"] + lb["width"]) <= round(pb["x"])
        click_row(row(page, it))
        visible(page, pin_button(page, it))
        settle(page.locator("body"))
        assert covers(pin_button(page, it).bounding_box(), at_point(plan_img(page, s).bounding_box(), IN_KITCHEN["x"], IN_KITCHEN["y"]))
    with ui(browser, app_url, s.elec.api, s.url, size=TABLET) as page:
        job_ready(page, s)
        show = page.get_by_role("button", name="Show plan")
        expect(show).to_have_attribute("aria-expanded", "false")
        expect(pin_button(page, it)).to_have_count(0)
        assert not [n for n in tab_order(page, TAB_PRESSES) if n.startswith("Pin ") or n == "Fit plan"]
        show.click()
        settle(page.locator("body"))
        expect(show).to_have_attribute("aria-expanded", "true")
        visible(page, pin_button(page, it))
    with ui(browser, app_url, s.elec.api, s.url, size=PHONE) as page:
        job_ready(page, s)
        tap_row(row(page, it))
        sheet = page.get_by_role("dialog", name="Plan")
        visible(page, sheet)
        settle(page.locator("body"))
        assert framed(page, s, "Kitchen", plan_img(page, s))
        assert not marks(page, TETHER_ATTR)
        visible(page, pin_button(page, it))
        page.get_by_role("button", name="Close plan").click()
        gone(page, page.get_by_role("dialog", name="Plan"))
        assert not [n for n in tab_order(page, TAB_PRESSES) if n.startswith("Pin ")]
    assert get_item(s, s.elec.api, it)["pin"] == IN_KITCHEN


def test_wf_offline_merge_title_and_pin_conflict(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, BASE_TITLE, pin=IN_KITCHEN)
    n = it["number"]
    with ui(browser, app_url, s.lead.api, s.url) as page, ui(browser, app_url, s.owner, s.url) as watch:
        job_ready(page, s)
        go_offline(page)
        click_row(row(page, it))
        title = details(page, it).get_by_label("Title", exact=True)
        title.fill(PHONE_TITLE)
        title.press("Enter")
        row(page, it, PHONE_TITLE).focus()
        page.keyboard.press("p")
        for _ in range(8):
            page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        s.owner.ok("PATCH", ipath(s, it), json={"title": OWNER_TITLE, "pin": OWNER_PIN})
        page.context.set_offline(False)
        shows(page, activity(page), re.compile(r"^Sync complete: \d+ synced, 1 to review\.$"), SYNC_S + UI_WAIT_S)
        region = page.get_by_role("region", name=CONFLICT_HEADING)
        visible(page, region)
        expect(region.get_by_role("heading", level=2, name=CONFLICT_HEADING)).to_be_visible()
        for wanted in (f"Item {n}: Title", f"Item {n}: Pin", f"{DANA_NAME} set {OWNER_TITLE}", f"{s.lead.name} set {PHONE_TITLE}",
                       f"{DANA_NAME} set {pin_text(OWNER_PIN)}"):
            expect(region).to_contain_text(wanted)
        server = get_item(s, s.owner, it)
        assert server["pin"] == {"x": pytest.approx(0.68), "y": pytest.approx(0.26)} and server["title"] == OWNER_TITLE
        region.get_by_role("button", name=f"Keep {OWNER_TITLE}").click()
        shows(page, activity(page), "Conflict resolved.")
        eventually(watch, lambda: expect(watch.get_by_role("region", name=CONFLICT_HEADING)).not_to_contain_text(f"Item {n}: Title", timeout=QUICK_MS), REFRESH_S)
    assert "title" not in {c["field"] for c in get_item(s, s.owner, it)["conflicts"]}


def test_wf_offline_merge_choose_alternative_pin(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Pin pick", pin=IN_KITCHEN)
    s.owner.ok("PATCH", ipath(s, it), json={"pin": OWNER_PIN})
    sync(s, s.lead.api, op("update_item", 1, item_id=it["id"], changes={"pin": {"from": IN_KITCHEN, "to": IN_LAUNDRY}}))
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        region = page.get_by_role("region", name=CONFLICT_HEADING)
        visible(page, region)
        region.get_by_role("button", name=f"Keep {pin_text(OWNER_PIN)}").click()
        shows(page, activity(page), "Conflict resolved.")
        gone(page, page.get_by_role("region", name=CONFLICT_HEADING))
    final = get_item(s, s.owner, it)
    assert final["pin"] == OWNER_PIN and room_name(s, final["room_id"]) == "Kitchen" and final["conflicts"] == []


def test_wf_offline_checkoff_basement(browser, app_url):
    s = make_site(app_url)
    crew = add_item(s, s.owner, "Crew offline")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        bodies: list[str] = []
        page.on("request", lambda r: bodies.append(r.post_data) if r.method == "POST" and r.url.endswith("/sync") else None)
        go_offline(page)
        q = page.get_by_label("Quick add item")
        for title in BASEMENT_TITLES:
            q.fill(title)
            q.press("Enter")
        page.get_by_role("button", name=f"Check off item {crew['number']}", exact=True).click()
        expect(row(page, crew)).to_contain_text("Waiting to sync")
        page.context.set_offline(False)
        synced, review = len(BASEMENT_TITLES) + 1, 0
        shows(page, activity(page), f"Sync complete: {synced} synced, {review} to review.", SYNC_S + UI_WAIT_S)
        go_offline(page)
        page.context.set_offline(False)
        eventually(page, lambda: expect(row(page, crew)).not_to_contain_text("Waiting to sync", timeout=QUICK_MS))
        rooms, progress = recount(s.owner, s)
        assert {r["id"]: r["counts"] for r in s.owner.ok("GET", s.path("/rooms"))["rooms"]} == rooms
        assert s.owner.ok("GET", s.path())["progress"] == progress
        for name, room in s.rooms.items():
            eventually(page, group_has(page, name, f"{rooms[room['id']]['verified']} of {rooms[room['id']]['total']} verified"))
    items = s.owner.ok("GET", s.path("/items"))["items"]
    titles = [i["title"] for i in items]
    assert [titles.count(t) for t in BASEMENT_TITLES] == [1, 1]
    assert get_item(s, s.owner, crew)["status"] == "verified"
    replay = s.lead.api.post(s.path("/sync"), content=bodies[0], headers={"content-type": "application/json"}).json()
    assert {r["outcome"] for r in replay["results"]} == {"duplicate"} and replay["synced"] == 0
    assert len(s.owner.ok("GET", s.path("/items"))["items"]) == len(items)


def test_wf_offline_checkoff_edit_then_reload(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Reload me")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        go_offline(page)
        click_row(row(page, it))
        title = details(page, it).get_by_label("Title", exact=True)
        title.fill(RELOADED_TITLE)
        title.press("Enter")
        page.get_by_role("button", name=f"Check off item {it['number']}", exact=True).click()
        with held(page, "**/sync"):
            page.context.set_offline(False)
            page.reload()
            visible(page, row(page, it, RELOADED_TITLE))
            expect(row(page, it, RELOADED_TITLE)).to_contain_text("Waiting to sync")
        poll(lambda: need((lambda x: (x["title"], x["status"]) == (RELOADED_TITLE, "verified"))(get_item(s, s.owner, it)), "not settled"),
             SYNC_S + LIVE_S)


def test_wf_defect_photos_lead_attaches(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Cracked tile")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        click_row(row(page, it))
        d = details(page, it)
        with holding(page, PHOTO_GLOB) as gate:
            d.get_by_label("Add defect photo").set_input_files(files=[{"name": "defect.png", "mimeType": "image/png", "buffer": gps_png()}])
            visible(page, row(page, it).get_by_text("Photo uploading"))
            expect(d.get_by_role("list", name="Photos").get_by_role("img")).to_have_count(0)
            gate.release()
        shows(page, activity(page), "Photo saved.")
        visible(page, d.get_by_role("list", name="Photos").get_by_role("img").first)
    photos = get_item(s, s.lead.api, it)["photos"]
    assert len(photos) == 1
    stored = S3().get(next(k for k in S3().keys(f"jobs/{s.id}/items/{it['id']}/photos/") if photos[0]["id"] in k))
    assert not [m for m in METADATA_MARKS if m in stored]
    with ui(browser, app_url, s.home.api, s.url) as page:
        job_ready(page, s)
        click_row(row(page, it))
        visible(page, details(page, it).get_by_role("list", name="Photos").get_by_role("img").first)
    assert [p["id"] for p in get_item(s, s.home.api, it)["photos"]] == [photos[0]["id"]]


def test_wf_defect_photos_storage_outage(browser, app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"].rstrip("/")
    s = make_site(app_url)
    it = add_item(s, s.owner, "Outage photo")
    lead_down = Api(down, s.lead.email, INITIAL_PASSWORD)
    with ui(browser, down, lead_down, s.url) as page:
        job_ready(page, s)
        click_row(row(page, it))
        details(page, it).get_by_label("Add defect photo").set_input_files(files=[{"name": "d.png", "mimeType": "image/png", "buffer": png()}])
        shows(page, activity(page), CATALOGUE["storage_unavailable"][1])
        expect(details(page, it).get_by_role("list", name="Photos").get_by_role("img")).to_have_count(0)
    assert get_item(s, s.owner, it)["photos"] == [] and S3().keys(f"jobs/{s.id}/items/{it['id']}/") == []


def test_wf_trade_flow_done_and_verified(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Replace switch", trade="electrical")
    act(s, s.owner, it, "start")
    tile = add_item(s, s.owner, "Tile hidden", trade="tile")
    n = it["number"]
    refused(s.elec.api.post(s.path("/items/bulk"), json={"action": "verify", "item_ids": [it["id"]]}), "forbidden")
    assert get_item(s, s.owner, it)["status"] == "in_progress"
    assert s.elec.api.get(ipath(s, tile)).json() == NOT_FOUND_BODY
    with ui(browser, app_url, s.elec.api, s.url) as trade, ui(browser, app_url, s.lead.api, s.url) as lead:
        trade.goto(s.base + s.url + f"/items/{tile['id']}")
        visible(trade, trade.get_by_role("heading", name=NOT_FOUND_HEADING, exact=True))
        trade.goto(s.base + s.url)
        job_ready(trade, s)
        expect(row(trade, tile)).to_have_count(0)
        click_row(row(trade, it))
        details(trade, it).get_by_label("Add completion photo").set_input_files(files=[{"name": "c.png", "mimeType": "image/png", "buffer": png()}])
        shows(trade, activity(trade), "Photo saved.")
        trade.get_by_role("button", name=f"Mark item {n} done").click()
        shows(trade, activity(trade), f"Item {n}: Ready for check.")
        job_ready(lead, s)
        click_row(row(lead, it))
        eventually(lead, lambda: expect(details(lead, it).get_by_role("button", name="Send back")).to_be_visible(timeout=QUICK_MS), LIVE_S + REFRESH_S)
        details(lead, it).get_by_role("button", name="Send back").click()
        d = lead.get_by_role("dialog", name=f"Send back item {n}")
        d.get_by_label("Reason").fill("Plate is crooked")
        d.get_by_role("button", name="Send back item").click()
        shows(lead, activity(lead), f"Item {n}: In progress.")
        eventually(trade, lambda: expect(row(trade, it)).to_contain_text("In progress", timeout=QUICK_MS), LIVE_S)
        trade.get_by_role("button", name=f"Mark item {n} done").click()
        shows(trade, activity(trade), f"Item {n}: Ready for check.")
        eventually(lead, lambda: expect(lead.get_by_role("button", name=f"Check off item {n}", exact=True)).to_be_enabled(timeout=QUICK_MS))
        lead.get_by_role("button", name=f"Check off item {n}", exact=True).click()
        shows(lead, activity(lead), f"Item {n}: Verified.")
        eventually(trade, lambda: expect(row(trade, it)).to_contain_text("Verified", timeout=QUICK_MS), LIVE_S)
    assert get_item(s, s.owner, it)["status"] == "verified"


def test_wf_trade_flow_photo_required(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Needs photo", trade="electrical")
    act(s, s.owner, it, "start")
    with ui(browser, app_url, s.elec.api, s.url) as page:
        job_ready(page, s)
        page.get_by_role("button", name=f"Mark item {it['number']} done").click()
        shows(page, activity(page), f"Not saved: {CATALOGUE['completion_photo_required'][1]}")
    assert get_item(s, s.owner, it)["status"] == "in_progress"


def schedule_ui(page: Page, person: str, starts: datetime, ends: datetime, repeats: str | None = None, count: int | None = None) -> None:
    page.get_by_role("button", name="Schedule visit").click()
    d = page.get_by_role("dialog", name="Schedule visit")
    select(d.get_by_role("combobox", name="Person"), person)
    fill_local(text_input(d, "Starts"), starts)
    fill_local(text_input(d, "Ends"), ends)
    if repeats:
        select(d.get_by_role("combobox", name="Repeats"), repeats)
        select(d.get_by_role("combobox", name="Ends"), "After count")
        d.get_by_label("Occurrences").fill(str(count))
    d.get_by_role("button", name="Save visit").click()


def test_wf_site_visit_access_visit_day(browser, app_url):
    zone, local = working_zone(app_url)
    s = make_site(app_url, tz=zone)
    card = {"lockbox_code": "L1357", "alarm_code": "A2468", "garage_code": "G9753", "house_note": "Dog in yard probe."}
    s.owner.ok("PUT", s.path("/access"), json=card)
    start = local.replace(second=0, microsecond=0) + timedelta(minutes=20)
    end = start + timedelta(hours=1)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="People & visits").click()
        schedule_ui(page, s.elec.name, start, end)
        shows(page, activity(page), "Visit scheduled.")
        page.keyboard.press("Escape")
        schedule_ui(page, s.elec.name, start + timedelta(minutes=30), end + timedelta(minutes=30))
        shows(page, activity(page), CATALOGUE["visit_overlap"][1])
        page.keyboard.press("Escape")
        evening = start.replace(hour=18, minute=0)
        schedule_ui(page, s.tile.name, evening, evening + timedelta(hours=1, minutes=30))
        visible(page, page.get_by_role("alert", name="There is a problem"))
    assert len(s.owner.ok("GET", s.path("/visits"))["visits"]) == 1
    with ui(browser, app_url, s.elec.api, s.url) as page:
        job_ready(page, s)
        house = page.get_by_role("region", name="House access")
        house.get_by_role("button", name="Show access codes").click()
        for value in card.values():
            eventually(page, lambda v=value: expect(house).to_contain_text(v, timeout=QUICK_MS))
        expect(house).to_contain_text(f"Codes visible until {end.strftime('%H:%M')}")
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Access").click()
        visible(page, page.get_by_role("table", name="Code reveals").get_by_text(s.elec.name))
    assert s.elec.name in [r["name"] for r in s.owner.ok("GET", s.path("/access/reveals"))["reveals"]]


def test_wf_site_visit_access_codes_expire(browser, app_url):
    zone, local = working_zone(app_url)
    s = make_site(app_url, tz=zone)
    s.owner.ok("PUT", s.path("/access"), json={"lockbox_code": CODE_EXPIRE, "alarm_code": "A1", "garage_code": "G1", "house_note": ""})
    end = (local + timedelta(seconds=90)).replace(second=0, microsecond=0)
    v = s.owner.ok("POST", s.path("/visits"), 201, json={"member_id": s.elec.id, "starts_at": (local - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M"),
                   "ends_at": end.strftime("%Y-%m-%dT%H:%M")})
    with ui(browser, app_url, s.elec.api, s.url) as page:
        job_ready(page, s)
        house = page.get_by_role("region", name="House access")
        house.get_by_role("button", name="Show access codes").click()
        eventually(page, lambda: expect(house).to_contain_text(CODE_EXPIRE, timeout=QUICK_MS))
        wait = (datetime.fromisoformat(v["ends_at_utc"].replace("Z", "+00:00")) - server_now(app_url)).total_seconds()
        paced(page, lambda: expect(house).not_to_contain_text(CODE_EXPIRE, timeout=QUICK_MS), max(wait, 0) + REFRESH_S + 5)
    refused(s.elec.api.get(s.path("/access")), "outside_site_visit")


def test_wf_offboarding_lost_phone(browser, app_url):
    zone, local = working_zone(app_url)
    s = make_site(app_url, tz=zone)
    s.owner.ok("PUT", s.path("/access"), json={"lockbox_code": CODE_OFFBOARD, "alarm_code": "A2", "garage_code": "G2", "house_note": ""})
    start = local.replace(second=0, microsecond=0)
    s.owner.ok("POST", s.path("/visits"), 201, json={"member_id": s.tile.id, "starts_at": start.strftime("%Y-%m-%dT%H:%M"),
               "ends_at": (start + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")})
    phone_session = Api(app_url, DANA)
    try:
        with ui(browser, app_url, s.tile.api, s.url) as tiler, ui(browser, app_url, s.owner, s.url) as laptop, \
                ui(browser, app_url, phone_session, s.url, size=PHONE) as phone:
            job_ready(tiler, s)
            house = tiler.get_by_role("region", name="House access")
            house.get_by_role("button", name="Show access codes").click()
            eventually(tiler, lambda: expect(house).to_contain_text(CODE_OFFBOARD, timeout=QUICK_MS))
            job_ready(laptop, s)
            laptop.get_by_role("tab", name="People & visits").click()
            laptop.get_by_role("button", name=f"End role for {s.tile.name}").click()
            laptop.get_by_role("dialog", name="End role").get_by_role("button", name="End role").click()
            shows(laptop, activity(laptop), f"Role ended for {s.tile.name}.")
            eventually(tiler, lambda: expect(tiler.get_by_text(ROLE_ENDED_MSG, exact=True)).to_be_visible(timeout=QUICK_MS), REFRESH_S)
            expect(tiler.get_by_text(CODE_OFFBOARD)).to_have_count(0)
            refused(s.tile.api.get(s.path("/items")), "role_ended")
            job_ready(phone, s)
            laptop.goto(app_url.rstrip("/") + "/account")
            laptop.get_by_label("Current password").fill(SEED_PASSWORD)
            laptop.get_by_label("New password").fill(NEW_PASSWORD)
            laptop.get_by_role("button", name="Change password").click()
            shows(laptop, activity(laptop), "Password changed. Every other session is signed out.")
            refused(phone_session.get("/api/me"), "unauthenticated")
            paced(phone, lambda: expect(phone.get_by_text(SIGNED_OUT, exact=True)).to_be_visible(timeout=QUICK_MS), REFRESH_S + 5)
            assert s.owner.ok("GET", "/api/me")["user"]["email"] == DANA
    finally:
        seeded = httpx.post(app_url.rstrip("/") + "/api/session", json={"email": DANA, "password": SEED_PASSWORD}, timeout=HTTP_TIMEOUT)
        if seeded.status_code != 200:
            Api(app_url, DANA, NEW_PASSWORD).ok("POST", "/api/me/password", json={"current_password": NEW_PASSWORD, "new_password": SEED_PASSWORD})


def test_wf_offboarding_role_ended_screen(browser, app_url):
    s = make_site(app_url)
    s.owner.ok("DELETE", s.path(f"/members/{s.tile.id}"), 204)
    with ui(browser, app_url, s.tile.api, s.url) as page:
        visible(page, page.get_by_text(ROLE_ENDED_MSG, exact=True))
        page.get_by_role("link", name="Back to your jobs").click()
        visible(page, page.get_by_role("heading", name="Your jobs"))
        expect(page.get_by_role("link", name=s.name, exact=True)).to_have_count(0)
    refused(s.tile.api.get(s.path()), "role_ended")


def test_wf_assignment_notices_offline_replay(browser, app_url, mail):
    s = make_site(app_url)
    a = add_item(s, s.owner, "Assign A")
    b = add_item(s, s.owner, "Assign B")
    batch = [op("update_item", 1, item_id=b["id"], changes={"trade": {"from": None, "to": "tile"}})]
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        click_row(row(page, a))
        select(details(page, a).get_by_role("combobox", name="Trade", exact=True), "Electrical")
        shows(page, activity(page), f"Item {a['number']} saved.")
        sync(s, s.lead.api, *batch)
        sync(s, s.lead.api, *batch)
        select(details(page, a).get_by_role("combobox", name="Trade", exact=True), "Tile")
        shows(page, activity(page), f"Item {a['number']} saved.")
        assert len(inbox(mail, s.elec.email, 1)) == 1 and len(inbox(mail, s.tile.email, 2)) == 2
        page.get_by_role("tab", name="Outbox").click()
        table = page.get_by_role("table", name="Outbox")
        eventually(page, lambda: expect(table.get_by_role("cell", name="Sent", exact=True)).to_have_count(3, timeout=QUICK_MS), MAIL_WAIT_S)
    entries = s.owner.ok("GET", s.path("/outbox"))["entries"]
    assert sorted(e["to"] for e in entries) == sorted([s.elec.email, s.tile.email, s.tile.email])
    assert len(inbox(mail, s.tile.email, 3, MAIL_GRACE_S)) == 2


def test_wf_assignment_notices_mail_down(browser, mail):
    down = os.environ["APP_MAIL_DOWN_URL"].rstrip("/")
    s = make_site(down)
    add_item(s, s.owner, "Down assign", trade="electrical")
    with ui(browser, down, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Outbox").click()
        visible(page, page.get_by_role("table", name="Outbox").get_by_text("Not sent yet"))
    assert inbox(mail, s.elec.email, 1, MAIL_GRACE_S) == []


def test_wf_homeowner_summary_follows(browser, app_url):
    s = make_site(app_url)
    host = add_item(s, s.owner, "Notes host", cost_note=SECRET_COST, quantity="2", unit_cost="5.00")
    s.lead.api.ok("POST", ipath(s, host, "/notes"), 201, json={"body": CREW_SECRET, "audience": "crew"})
    s.lead.api.ok("POST", ipath(s, host, "/notes"), 201, json={"body": EVERYONE_NOTE, "audience": "everyone"})
    mover = add_item(s, s.owner, "Mover", pin=IN_KITCHEN)
    with ui(browser, app_url, s.home.api, s.url, size=PHONE) as page:
        job_ready(page, s)
        eventually(page, group_has(page, "Laundry", EMPTY_ROOM))
        q = page.get_by_label("Quick add item")
        q.fill(HALL_SCUFF)
        select(page.get_by_role("combobox", name="Quick add room"), "Hall")
        q.press("Enter")
        shows(page, activity(page), re.compile(r"^Item \d+ saved\.$"))
        eventually(page, group_has(page, "Hall", "0 of 1 verified"))
        tap_row(row(page, host))
        if page.get_by_role("dialog", name="Plan").count():
            tap(page.get_by_role("button", name="Close plan"))
        d = details(page, host)
        expect(d).to_contain_text(EVERYONE_NOTE)
        for hidden in (CREW_SECRET, SECRET_COST, "Line total"):
            expect(d).not_to_contain_text(hidden)
        s.owner.ok("PATCH", ipath(s, mover), json={"pin": IN_LAUNDRY})
        eventually(page, group_has(page, "Laundry", "0 of 1 verified"), LIVE_S)
        assert EMPTY_ROOM not in group_text(page, "Laundry")
        s.owner.ok("DELETE", ipath(s, mover), 204)
        eventually(page, group_has(page, "Laundry", EMPTY_ROOM), LIVE_S)
    made = next(i for i in s.home.api.ok("GET", s.path("/items"))["items"] if i["title"] == HALL_SCUFF)
    assert room_name(s, made["room_id"]) == "Hall" and made["created_by"]["role"] == "homeowner"


def test_wf_homeowner_summary_phone_pin_hidden(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Phone pin", pin=IN_LAUNDRY)
    with ui(browser, app_url, s.home.api, s.url, size=PHONE) as page:
        job_ready(page, s)
        expect(pin_button(page, it)).to_have_count(0)
        assert not [n for n in tab_order(page, TAB_PRESSES) if n.startswith("Pin ")]
        tap_row(row(page, it))
        visible(page, page.get_by_role("dialog", name="Plan"))
        visible(page, pin_button(page, it))
    assert get_item(s, s.home.api, it)["pin"] == IN_LAUNDRY


def test_wf_close_out_owner(browser, app_url):
    s = make_site(app_url)
    keep = add_item(s, s.owner, "Keeper")
    dup = add_item(s, s.owner, "Duplicate")
    photo = upload(s, s.lead.api, dup, "defect", png()).json()
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        click_row(row(page, dup))
        details(page, dup).get_by_role("button", name=f"Delete item {dup['number']}").click()
        page.get_by_role("dialog", name=f"Delete item {dup['number']}").get_by_role("button", name="Delete item").click()
        shows(page, activity(page), f"Item {dup['number']} deleted.")
        assert S3().keys(f"jobs/{s.id}/items/{dup['id']}/") == []
        refused(s.owner.get(photo["url"]), "not_found")
        assert add_item(s, s.owner, "After dup")["number"] == dup["number"] + 1
        page.get_by_role("button", name="Start walkthrough").click()
        shows(page, activity(page), "Walkthrough started.")
        for it in s.owner.ok("GET", s.path("/items"))["items"]:
            act(s, s.lead.api, it, "verify")
        page.reload()
        job_ready(page, s)
        page.get_by_role("button", name="Close out job").click()
        page.get_by_role("dialog", name="Close out job").get_by_role("button", name="Close out").click()
        shows(page, activity(page), "Job closed out.")
        visible(page, page.get_by_text("Closed out", exact=True).first)
    assert S3().keys(f"jobs/{s.id}/") == []
    job = s.owner.ok("GET", s.path())
    assert (job["status"], job["plan_url"], job["plan_revision"]) == ("closed_out", None, None)
    refused(s.owner.get(s.path("/plan")), "not_found")
    refused(s.owner.get(s.path("/plan/revisions/1")), "not_found")
    refused(s.owner.patch(ipath(s, keep), json={"title": "Late"}), "job_closed")
    refused(s.lead.api.post(s.path("/sync"), json={"ops": [op("item_action", 1, item_id=keep["id"], action="reopen")]}), "job_closed")


def test_wf_close_out_blocked_until_verified(browser, app_url):
    s = make_site(app_url)
    add_item(s, s.owner, "Still open")
    s.owner.ok("POST", s.path("/actions"), json={"action": "start_walkthrough"})
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("button", name="Close out job").click()
        page.get_by_role("dialog", name="Close out job").get_by_role("button", name="Close out").click()
        shows(page, activity(page), CATALOGUE["items_not_verified"][1])
    assert s.owner.ok("GET", s.path())["status"] == "walkthrough"
    assert refused(s.owner.post(s.path("/actions"), json={"action": "close_out"}), "items_not_verified")["unverified"] == 1


def test_job_stages_close_out(app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Stage item")
    upload(s, s.lead.api, it, "defect", png())
    refused(s.owner.post(s.path("/actions"), json={"action": "close_out"}), "invalid_transition")
    refused(s.lead.api.post(s.path("/actions"), json={"action": "start_walkthrough"}), "forbidden")
    assert s.owner.ok("POST", s.path("/actions"), json={"action": "start_walkthrough"})["status"] == "walkthrough"
    refused(s.owner.post(s.path("/actions"), json={"action": "start_walkthrough"}), "invalid_transition")
    act(s, s.lead.api, it, "verify")
    refused(Api(os.environ["APP_STORAGE_DOWN_URL"], DANA).post(s.path("/actions"), json={"action": "close_out"}), "storage_unavailable")
    assert s.owner.ok("GET", s.path())["status"] == "walkthrough" and S3().keys(f"jobs/{s.id}/")
    assert s.owner.ok("POST", s.path("/actions"), json={"action": "close_out"})["status"] == "closed_out"
    assert S3().keys(f"jobs/{s.id}/") == [] and get_item(s, s.owner, it)["photos"] == []
    refused(s.owner.post(s.path("/items"), json={"title": "x", "room_id": s.rooms["Hall"]["id"]}), "job_closed")


def test_wf_note_collab_offline_merge(browser, app_url):
    s, it, owner_first = note_setup(app_url)
    path = new_note(s, it, "Fix tile")
    merged = "Fix tile today grout" if owner_first else "Fix tile grout today"
    with ui(browser, app_url, s.lead.api, s.url) as lead, ui(browser, app_url, s.owner, s.url) as owner:
        bodies: list[str] = []
        lead.on("request", lambda r: bodies.append(r.post_data) if r.method == "POST" and r.url.endswith("/sync") else None)
        for p in (lead, owner):
            job_ready(p, s)
            click_row(row(p, it))
        go_offline(lead)
        for p, words in ((lead, "Fix tile grout"), (owner, "Fix tile today")):
            d = details(p, it)
            d.get_by_role("button", name="Edit note").click()
            d.get_by_label("Edit note").fill(words)
            d.get_by_role("button", name="Save note").click()
        shows(owner, activity(owner), "Note updated.")
        lead.context.set_offline(False)
        for p in (lead, owner):
            eventually(p, lambda p=p: expect(details(p, it)).to_contain_text(merged, timeout=QUICK_MS), SYNC_S + LIVE_S)
        details(lead, it).get_by_role("button", name="Undo my edit").click()
        shows(lead, activity(lead), "Edit undone.")
        assert s.owner.ok("GET", path + "/history")["revisions"][-1]["body"] == "Fix tile today"
        details(owner, it).get_by_role("button", name="Undo my edit").click()
        shows(owner, activity(owner), "Edit undone.")
    history = s.owner.ok("GET", path + "/history")["revisions"]
    assert [h["kind"] for h in history] == ["create", "edit", "edit", "undo", "undo"] and history[-1]["body"] == "Fix tile"
    replay = s.lead.api.post(s.path("/sync"), content=bodies[0], headers={"content-type": "application/json"}).json()
    assert {r["outcome"] for r in replay["results"]} == {"duplicate"}
    assert s.owner.ok("GET", path + "/history")["revisions"][-1]["rev"] == history[-1]["rev"]


def test_wf_note_collab_draft_survives(browser, app_url):
    s, it, owner_first = note_setup(app_url)
    path = new_note(s, it, "Fix tile")
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        click_row(row(page, it))
        d = details(page, it)
        d.get_by_role("button", name="Edit note").click()
        d.get_by_label("Edit note").fill("Fix tile grout")
        edit(s.owner, path, 0, 8, 0, " today")
        add_item(s, s.owner, "Noise")
        advance(page, REFRESH_S * 1000 * 2)
        expect(d.get_by_label("Edit note")).to_have_value("Fix tile grout")
        d.get_by_role("button", name="Save note").click()
        shows(page, activity(page), "Note updated.")
    assert s.owner.ok("GET", path + "/history")["revisions"][-1]["body"] == ("Fix tile today grout" if owner_first else "Fix tile grout today")


def test_wf_recurring_visits_book_series(browser, app_url):
    zone, local = working_zone(app_url)
    s = make_site(app_url, tz=zone)
    s.owner.ok("PUT", s.path("/access"), json={"lockbox_code": CODE_SERIES, "alarm_code": "A4", "garage_code": "G4", "house_note": ""})
    start = local.replace(second=0, microsecond=0) - timedelta(minutes=10)
    end = start + timedelta(hours=1)
    tomorrow = (start + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="People & visits").click()
        schedule_ui(page, s.elec.name, start, end, "Daily", 3)
        shows(page, activity(page), "Visit scheduled.")
        table = page.get_by_role("table", name="Site visits")
        expect(table.get_by_role("row").filter(has_text=start.strftime("%H:%M"))).to_have_count(3)
        page.get_by_role("button", name=f"Cancel visit on {tomorrow}").click()
        shows(page, activity(page), "Visit cancelled.")
        visible(page, table.get_by_role("row").filter(has_text="Cancelled"))
    with ui(browser, app_url, s.elec.api, "/signin") as page:
        page.clock.set_system_time(server_now(app_url) + timedelta(hours=5))
        page.goto(app_url.rstrip("/") + s.url)
        job_ready(page, s)
        house = page.get_by_role("region", name="House access")
        house.get_by_role("button", name="Show access codes").click()
        eventually(page, lambda: expect(house).to_contain_text(CODE_SERIES, timeout=QUICK_MS))
        expect(house).to_contain_text(f"Codes visible until {end.strftime('%H:%M')}")
    occ = s.owner.ok("GET", s.path("/visits"))["visits"][0]["occurrences"]
    assert [o["status"] for o in occ] == ["scheduled", "cancelled", "scheduled"]


def test_wf_recurring_visits_dst_table(browser, app_url):
    s = make_site(app_url)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="People & visits").click()
        start = DST_SERIES_START
        schedule_ui(page, s.elec.name, start, start + timedelta(hours=1), "Daily", DST_DAYS)
        shows(page, activity(page), "Visit scheduled.")
        rows = page.get_by_role("table", name="Site visits").get_by_role("row").filter(has_text=start.strftime("%H:%M"))
        expect(rows).to_have_count(DST_DAYS)
    occ = s.owner.ok("GET", s.path("/visits"))["visits"][0]["occurrences"]
    assert len(occ) == DST_DAYS
    zone = ZoneInfo(s.tz)
    for o in occ:
        local = datetime.combine(date.fromisoformat(o["date"]), start.time())
        assert o["starts_at"] == local.isoformat()
        assert zulu(o["starts_at_utc"]) == local.replace(tzinfo=zone).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert len({o["starts_at_utc"][11:16] for o in occ}) == 2


def test_wf_plan_revision_owner_revises(browser, app_url):
    s = make_site(app_url)
    l1 = add_item(s, s.owner, "Hall bound", pin={"x": 0.55, "y": 0.85}, quantity="1", unit_cost="10.00")
    n1 = add_item(s, s.owner, "Notch bound", pin={"x": 0.36, "y": 0.40})
    l2 = add_item(s, s.owner, "Stays laundry", pin=IN_LAUNDRY)
    queued = op("update_item", 1, item_id=l2["id"], plan_revision=1, changes={"pin": {"from": IN_LAUNDRY, "to": {"x": 0.75, "y": 0.85}}})
    pct = lambda pts: "; ".join(f"{p['old']['x']*100:g},{p['old']['y']*100:g} > {p['new']['x']*100:g},{p['new']['y']*100:g}" for p in pts)
    corners = lambda c: "; ".join(f"{round(x*100, 2):g},{round(y*100, 2):g}" for x, y in c)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Setup").click()
        page.get_by_role("button", name="Upload revision").click()
        d = page.get_by_role("dialog", name="Upload plan revision")
        d.get_by_label("Revision image").set_input_files(files=[{"name": "r2.png", "mimeType": "image/png", "buffer": png(shade=30)}])
        d.get_by_label("Reference points").fill(pct(POINTS_SCALE))
        for name, c in REV2_ROOMS.items():
            d.get_by_label(f"{name} corners").fill(corners(c))
        d.get_by_role("button", name="Upload revision").click()
        shows(page, activity(page), re.compile(r"^Plan revision 2 uploaded: \d+ pins moved, 1 need review\.$"))
        page.get_by_role("tab", name="Punch list").click()
        expect(row(page, n1)).to_contain_text("Pin needs review")
        needs = len([n1])
        visible(page, page.get_by_text(f"{needs} pins need review", exact=True))
        res = sync(s, s.lead.api, queued).json()["results"][0]
        assert res["outcome"] == "applied" and res["item"]["conflicts"] == []
        eventually(page, group_has(page, "Hall", "0 of 1 verified"), LIVE_S)
        assert plan_label(page, "Hall") == (0, 1)
    assert room_name(s, get_item(s, s.owner, l1)["room_id"]) == "Hall"
    by_room = {r["name"]: r["subtotal"] for r in s.owner.ok("GET", s.path("/costs"))["by_room"]}
    assert by_room["Hall"] == line_total("1", "10.00") and by_room["Laundry"] == "0.00"


def test_wf_plan_revision_collinear_points(browser, app_url):
    s = make_site(app_url)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Setup").click()
        page.get_by_role("button", name="Upload revision").click()
        d = page.get_by_role("dialog", name="Upload plan revision")
        d.get_by_label("Revision image").set_input_files(files=[{"name": "r.png", "mimeType": "image/png", "buffer": png()}])
        d.get_by_label("Reference points").fill("10,10 > 10,10; 50,50 > 50,50; 90,90 > 90,90")
        d.get_by_role("button", name="Upload revision").click()
        visible(page, d.get_by_text(COLLINEAR_MSG).first)
    assert s.owner.ok("GET", s.path())["plan_revision"] == 1


def test_wf_costing_owner_reviews(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, COSTED_TITLE)
    line = line_total("2.5", "0.05")
    with ui(browser, app_url, s.owner, s.url) as page, ui(browser, app_url, s.lead.api, s.url) as lead:
        job_ready(page, s)
        click_row(row(page, it))
        d = details(page, it)
        d.get_by_label("Quantity", exact=True).fill("2.5")
        d.get_by_label("Quantity", exact=True).press("Enter")
        d.get_by_label("Unit cost", exact=True).fill("0.05")
        d.get_by_label("Unit cost", exact=True).press("Enter")
        visible(page, d.get_by_text(f"Line total {dollars(line)}"))
        job_ready(lead, s)
        lead.get_by_role("tab", name="Costs").click()
        page.get_by_role("tab", name="Costs").click()
        page.get_by_label("Change order description").fill(CO_DESC)
        page.get_by_label("Change order amount").fill(CO_AMOUNT)
        page.get_by_role("button", name="Add change order").click()
        shows(page, activity(page), "Change order added.")
        page.get_by_role("button", name=f"Approve {CO_DESC}").click()
        shows(page, activity(page), "Change order approved.")
        page.get_by_label("Contingency percent").fill(CONTINGENCY)
        page.get_by_role("button", name="Save contingency").click()
        shows(page, activity(page), "Contingency saved.")
        base_total = Decimal(line) + Decimal(CO_AMOUNT)
        total = money(base_total + Decimal(money(base_total * Decimal(CONTINGENCY) / 100)))
        eventually(lead, lambda: expect(lead.get_by_text(f"Total {dollars(total)}", exact=True)).to_be_visible(timeout=QUICK_MS), LIVE_S)
        expect(lead.get_by_text(f"Change orders {dollars(CO_AMOUNT)}", exact=True)).to_be_visible()
    assert sync(s, s.lead.api, op("update_item", 1, item_id=it["id"], changes={"unit_cost": {"from": None, "to": "0.07"}})).json()["results"][0]["outcome"] == "conflict"
    with ui(browser, app_url, s.owner, s.url) as page:
        visible(page, page.get_by_role("region", name=CONFLICT_HEADING).get_by_text(f"Item {it['number']}: Unit cost"))
    co = s.owner.ok("GET", s.path("/change-orders"))["change_orders"][0]
    assert s.owner.ok("GET", s.path("/costs"), params={"as_of": co["created_at"]})["total"] == line
    assert s.owner.ok("GET", s.path("/costs"))["total"] == total


def test_wf_costing_invalid_contingency(browser, app_url):
    s = make_site(app_url, people=False)
    with ui(browser, app_url, s.owner, s.url) as page:
        job_ready(page, s)
        page.get_by_role("tab", name="Costs").click()
        page.get_by_label("Contingency percent").fill("30.00")
        page.get_by_role("button", name="Save contingency").click()
        visible(page, page.get_by_role("alert", name="There is a problem"))
    assert s.owner.ok("GET", s.path("/costs"))["contingency_percent"] == "0.00"


def test_wf_dependencies_bulk_room(browser, app_url, mail):
    s = make_site(app_url)
    k1, k2 = add_item(s, s.owner, "Tile edge"), add_item(s, s.owner, "Tile corner")
    add_item(s, s.owner, "Bath only", room="Primary bath")
    h2, h3 = add_item(s, s.owner, "Hall waiting", room="Hall"), add_item(s, s.owner, "Hall blocker", room="Hall")
    s.owner.ok("PUT", ipath(s, h2, "/blocked-by"), json={"item_ids": [h3["id"]]})
    with ui(browser, app_url, s.lead.api, s.url) as page:
        job_ready(page, s)
        select(page.get_by_role("combobox", name="Show room"), "Kitchen")
        select(page.get_by_role("combobox", name="Show status"), "Open")
        select(page.get_by_role("combobox", name="Assign shown to"), "Tile")
        kitchen_open, hall_open = len((k1, k2)), len((h2, h3))
        page.get_by_role("button", name=f"Assign {kitchen_open} shown").click()
        shows(page, activity(page), f"{kitchen_open} items assigned to Tile.")
        select(page.get_by_role("combobox", name="Show room"), "Hall")
        page.get_by_role("button", name=f"Check off {hall_open} shown").click()
        alert = page.get_by_role("alert", name="Nothing changed")
        visible(page, alert)
        expect(alert).to_contain_text(f"Item {h2['number']}: {CATALOGUE['blocked'][1]}")
        shows(page, activity(page), f"Not saved: {CATALOGUE['bulk_failed'][1]}")
    assert [get_item(s, s.owner, x)["trade"] for x in (k1, k2)] == ["tile", "tile"]
    assert [get_item(s, s.owner, x)["status"] for x in (h2, h3)] == ["open", "open"]
    assert len(inbox(mail, s.tile.email, 3, MAIL_GRACE_S)) == 2


def test_wf_dependencies_bulk_reopen_cascade(browser, app_url):
    s = make_site(app_url)
    x, y = add_item(s, s.owner, "Blocker X"), add_item(s, s.owner, "Dependent Y")
    s.owner.ok("PUT", ipath(s, y, "/blocked-by"), json={"item_ids": [x["id"]]})
    act(s, s.owner, x, "verify")
    act(s, s.owner, y, "verify")
    with ui(browser, app_url, s.owner, s.url) as page, ui(browser, app_url, s.lead.api, s.url) as lead:
        job_ready(page, s)
        job_ready(lead, s)
        click_row(row(page, x))
        details(page, x).get_by_role("button", name=f"Reopen item {x['number']}").click()
        shows(page, activity(page), f"Item {x['number']}: Open.")
        eventually(lead, lambda: expect(row(lead, y)).to_contain_text("Open", timeout=QUICK_MS), LIVE_S)
    assert get_item(s, s.owner, y)["status"] == "open"


def test_wf_live_updates_two_devices(browser, app_url):
    s = make_site(app_url)
    mover = add_item(s, s.owner, "Moving pin", pin=IN_KITCHEN)
    doomed = add_item(s, s.owner, "Will go", room="Hall")
    host = add_item(s, s.owner, "Draft host")
    note = new_note(s, host, "Owner note")
    names = lambda p: p.get_by_role("region", name="Punch list").get_by_role("listitem").evaluate_all(
        "els => els.map(e => e.getAttribute('aria-label') || e.textContent)")
    with ui(browser, app_url, s.home.api, s.url) as home, ui(browser, app_url, s.lead.api, s.url) as lead:
        job_ready(home, s)
        job_ready(lead, s)
        click_row(row(lead, host))
        ld = details(lead, host)
        ld.get_by_label("Add a note").fill(DRAFT_TEXT)
        s.owner.ok("PATCH", ipath(s, mover), json={"pin": IN_LAUNDRY})
        eventually(home, lambda: expect(room_row(home, "Laundry", mover)).to_be_visible(timeout=QUICK_MS), LIVE_S)
        eventually(home, group_has(home, "Laundry", "0 of 1 verified"), LIVE_S)
        eventually(home, group_has(home, "Kitchen", "0 of 1 verified"), LIVE_S)
        home.context.set_offline(True)
        s.owner.ok("DELETE", ipath(s, doomed), 204)
        edit(s.owner, note, 0, 10, 0, " edited")
        home.context.set_offline(False)
        gone(home, row(home, doomed), SYNC_S + REFRESH_S)
        with ui(browser, app_url, s.home.api, s.url) as fresh:
            job_ready(fresh, s)
            visible(fresh, row(fresh, mover))
            eventually(home, lambda: need(names(home) == names(fresh), (names(home), names(fresh))))
        advance(lead, REFRESH_S * 1000)
        expect(ld.get_by_label("Add a note")).to_have_value(DRAFT_TEXT)


def test_wf_live_updates_mirror_process(browser, app_url):
    mirror = os.environ["APP_MIRROR_URL"].rstrip("/")
    s = make_site(app_url)
    it = add_item(s, s.owner, "Mirror item")
    with ui(browser, mirror, Api(mirror, DANA), s.url) as page:
        job_ready(page, s)
        visible(page, row(page, it))
        s.lead.api.ok("PATCH", ipath(s, it), json={"title": MIRROR_TITLE})
        eventually(page, lambda: expect(row(page, it, MIRROR_TITLE)).to_be_visible(timeout=QUICK_MS), LIVE_S)
    assert get_item(s, s.owner, it)["title"] == MIRROR_TITLE


APP = Path("/app")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".vite", "coverage"}
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lowdb", "nedb",
                      "@electric-sql/pglite", "lokijs", "pouchdb", "node-persist", "lmdb"}


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert not [p.name for p in shipped_packages() if p.name not in notices]
    assert "Archivo" in notices and "IBM Plex Sans" in notices


def test_if_licences():
    assert not [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert "OFL" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    assert not [p.name for p in shipped_packages() if p.name in DATASTORE_PACKAGES]
    assert Postgres().tables()


def test_if_config_untouched(app_url):
    names = ("DATABASE_URL", "S3_", "SMTP_", "MAIL_FROM", "APP_PUBLIC_")
    for f in APP.glob(".env*"):
        if f.name.endswith((".example", ".sample", ".template", ".dist")):
            continue
        assert not [l for l in f.read_text(errors="replace").splitlines() if l.strip().startswith(names)], f
    assert httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_if_typescript_source():
    stray = []
    for path in APP.rglob("*"):
        if path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and not SKIP_DIRS & set(path.relative_to(APP).parts):
            tooling = path.relative_to(APP).parts[0] in {"scripts", "tools"} or path.name.startswith("build.")
            if not tooling and not re.search(r"(^|\.)config\.(c|m)?js$|rc\.(c|m)?js$", path.name):
                stray.append(str(path))
    assert not stray, stray


def test_if_same_origin_only(browser, app_url):
    s = make_site(app_url)
    it = add_item(s, s.owner, "Origin probe", pin=IN_KITCHEN)
    with ui(browser, app_url, s.owner, s.url) as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        job_ready(page, s)
        click_row(row(page, it))
        page.get_by_role("tab", name="Costs").click()
        advance(page, REFRESH_S * 1000)
    assert not [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(app_url))]
