from __future__ import annotations

import contextlib
import hashlib
import json
import os
import random
import re
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, Route
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    S3,
    Postgres,
    accessible_name,
    advance,
    animations,
    camera,
    capture,
    center,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    shipped_packages,
    tab_order,
    tap,
    unique,
)

APP_DIR = Path("/app")
INDEX = os.environ.get("MEILISEARCH_INDEX", "units")
OFFICE_ZONE = ZoneInfo(os.environ.get("SALES_OFFICE_TZ", "Australia/Sydney"))

VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
TOTAL_UNITS = 288
TOP_FLOOR = 38
BOTTOM_FLOOR = 3
GRID_ROWS = 36
HOLD_SECONDS = 259200
COOLDOWN_SECONDS = 86400
SEARCH_WINDOW_S = 60
JSON_LIMIT = 16384
PHOTO_LIMIT = 5000000
Q_LIMIT = 80
FACET_LIMIT = 6
PAGE_SIZE = 24
MIN_PHOTO_W = 1024
MIN_PHOTO_H = 512
PRICE_FLOOR = 100000
PRICE_CEILING = 20000000
SAFE_INTEGER = 9007199254740991
SQFT_NUM = 107639
SQFT_DEN = 10000
PRICE_STEP = 6500
REREAD_MS = 5000
DEBOUNCE_MS = 250
OUTAGE_RETRY_MS = 10000
CONTEXT_LOSS_MS = 1000
HOLD_CHECK_MS = 2000
SEARCH_BOUND_S = 1
SYNC_SECONDS = 5
LANDING_SCROLL_PX = 4800
BAND_SCROLL_PX = 960
FLOOR_SPAN = 35
LENS_LAG_MS = (100, 150)
CROSSFADE_MS = (150, 250)
PIN_GROW_MS = (300, 400)
SHEET_MAX_MS = 333
OUTER_MARGIN_PX = 16
REDUCED_FLOORS = {38, 35, 29, 19, 9}
SEED_RAISE = 1636040
SEED_RAISE_PER_M2 = 14608
SEED_RAISE_PER_SQFT = 1357
SEED_27C_SQFT = 1206

SHORT_SEARCH_LIMIT = 5
SHORT_COOLDOWN_S = 40
SHORT_WINDOW_S = 30
SHORT_MEDIA_S = 15
SHORT_SESSION_S = 20

HTTP_TIMEOUT = 30
POLL_SECONDS = 30
SYNC_SLACK_S = 10
UI_SECONDS = 40
STEP_MS = 50
MOTION_STEP_MS = 25
MAX_PAGES = 20
TAB_BOUND = 80
CLOCK_SLACK_S = 2
LATE_SLACK_S = 15
SKEW_HOURS = 5
FOREIGN_ORIGIN = "https://elsewhere.example"
PASSWORD = "Lens-Probe-Pass-2026"
EMPTY_CEILING = PRICE_FLOOR - 1
UNKNOWN_BAND = "40-49"

MIRA_EMAIL, MIRA_PASSWORD, MIRA_NAME = "mira.castell@orrinvale.example", "Highwater-Console-26", "Mira Castell"
ANA_EMAIL, ANA_PASSWORD, ANA_NAME = "ana.ferreira@example.com", "Window-Seat-2026", "Ana Ferreira"

STACKS = {
    "A": (134, "SE", 2, 78),
    "B": (178, "S", 2, 74),
    "C": (214, "SW", 3, 112),
    "D": (268, "W", 2, 71),
    "E": (311, "NW", 1, 52),
    "F": (4, "N", 1, 49),
    "G": (41, "NE", 2, 76),
    "H": (93, "E", 3, 108),
}
FACINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
BANDS = ["03-09", "10-19", "20-29", "30-35", "36-38"]
BAND_FLOORS = {"03-09": (3, 9), "10-19": (10, 19), "20-29": (20, 29), "30-35": (30, 35), "36-38": (36, 38)}
BAND_LABEL = {"03-09": "Floors 3-9", "10-19": "Floors 10-19", "20-29": "Floors 20-29", "30-35": "Floors 30-35", "36-38": "Floors 36-38"}
VIEW_LABEL = {"harbour": "Harbour", "harbour-partial": "Harbour, partly blocked", "park": "Park", "city": "City", "ridge": "Ridge"}
FACET_VALUES = {
    "bedrooms": ["1", "2", "3"],
    "band": BANDS,
    "facing": FACINGS,
    "view": list(VIEW_LABEL),
    "status": ["available", "held", "reserved"],
}
STATUS_LABEL = {"available": "Available", "held": "Held", "reserved": "Reserved", "withdrawn": "Withdrawn", "unreleased": "Not released"}
LIVE = {"available", "held", "reserved"}
CHIP_LABELS = ["1 bedroom", "2 bedrooms", "3 bedrooms", *BAND_LABEL.values(), *FACINGS, *VIEW_LABEL.values(), "Available", "Held", "Reserved"]
FILTER_FIELDS = {"Search homes", "Lowest price", "Highest price", "Clear filters"}

PUBLIC_KEYS = {"code", "floor", "stack", "band", "bedrooms", "areaM2", "areaSqft", "bearing", "facing", "viewTag", "price", "pricePerM2", "pricePerSqft", "priceVersion", "status", "syncing", "viewPhotographed", "viewUrl"}
TOWER_KEYS = {"code", "floor", "stack", "status", "syncing"}
HOLD_KEYS = {"id", "unitCode", "status", "endedBy", "quotedPrice", "priceVersion", "createdAt", "endsAt", "endedAt", "shareUrl"}
ACCOUNT_KEYS = {"email", "name", "role"}
SHARED_KEYS = {"code", "floor", "stack", "band", "bedrooms", "areaM2", "areaSqft", "bearing", "facing", "viewTag", "viewPhotographed", "viewUrl"}
VERSION_KEYS = {"version", "price", "setBy", "setAt"}

MSG = {
    "unauthenticated": "Sign in to continue.",
    "sign_in_failed": "That email and password don't match an account.",
    "cross_origin": "This request must come from the Highwater site.",
    "forbidden": "Your account can't do that.",
    "not_found": "We couldn't find that.",
    "read_only": "Shared links are read-only.",
    "unit_unavailable": "Someone else holds this home now.",
    "unit_reserved": "This home is already reserved.",
    "price_changed": "The price of this home changed. Check the new price and confirm again.",
    "hold_limit": "You already hold a home. Release it before holding another.",
    "hold_ended": "This hold has already ended.",
    "idempotency_key_reused": "This request key was already used for a different request.",
    "already_released": "These floors are already released.",
    "not_released": "These floors aren't released yet.",
    "unit_withdrawn": "This home has been withdrawn.",
    "upload_in_progress": "Another photo for this home is still uploading.",
    "stale_price": "Someone changed this price first. Reload and try again.",
    "too_large": "That request is too large.",
    "unsupported_type": "Send JSON.",
    "unsupported_image": "Upload a PNG or JPEG image.",
    "invalid": "Check the highlighted fields.",
    "search_unavailable": "Search is down for a moment. The tower still shows live availability.",
    "storage_unavailable": "Photo storage is unavailable. The photo was not saved.",
    "media_unavailable": "This file can't be loaded right now.",
}
COOLDOWN_MSG = "You held this home recently. You can hold it again after {when}."
SEARCH_LIMIT_MSG = "Too many searches from this device. Try again in {s} seconds."
ATTEMPTS_MSG = "Too many hold attempts. Try again in {s} seconds."
ACCOUNT_MSG = "Your details are in. Sign in to continue."

F_NAME = "Use 1 to 80 characters."
F_EMAIL = "Enter a valid email address."
F_PASSWORD = "Use 10 to 200 characters."
F_Q = "Use 80 characters or fewer."
F_FACET_MANY = "Choose up to 6."
F_FACET_UNKNOWN = "Pick from the listed options."
F_PRICE_WHOLE = "Enter a whole number of dollars."
F_PRICE_ORDER = "The lowest price can't be above the highest."
F_LIMIT = "Use a page size from 1 to 24."
F_AFTER = "This page link is out of date. Start again."
F_PRICE_VERSION = "Reload this home's price."
F_KEY = "Use 1 to 100 visible characters."
F_PRICE = "Enter a whole number from 100000 to 20000000."
F_EXPECTED = "Enter the price version you're changing."
F_PHOTO_SMALL = "Use an image at least 1024 by 512 pixels."
F_PHOTO_BROKEN = "Upload a readable PNG or JPEG image."

C_CONFIRMED = "This home is held for you."
C_LOST_REPLY = "We couldn't reach Highwater. Your hold was not placed yet. Try again."
C_NO_PAYMENT = "No payment is taken. You can release the hold at any time."
C_EMPTY_HINT = "No homes match these filters. Clear a filter to see more."
C_EMPTY_HEADING = "NOTHING HERE"
C_WITHDRAWN_PANEL = "This home has been withdrawn."
C_ENDED = {
    "buyer": "You released this hold.",
    "withdrawal": "This home was withdrawn, so your hold ended.",
    "conversion": "This hold became a reservation.",
    "lapse": "Your hold has lapsed. This home is open to every buyer again.",
}
C_HOLD_NOT_FOUND = "We couldn't find that hold."
C_DEAD_LINK = "This shared link no longer works."
C_NO_PHOTO = "No view photograph yet."
C_PHOTO_DOWN = "View photograph unavailable right now."
C_MODEL_DOWN = "Tower model unavailable right now. Showing the floor grid."
C_CONTEXT_LOST = "Tower view paused. Showing the floor grid."
C_REFUSED = "Your account can't do that."

PNG_SIGNATURE = bytes.fromhex("89504E470D0A1A0A")
JPEG_SIGNATURE = bytes.fromhex("FFD8FF")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}

SCROLL_JS = """el => { let n = el.parentElement; while (n) { const s = getComputedStyle(n);
  if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return [n.scrollTop, window.scrollY];
  n = n.parentElement; } return [0, window.scrollY]; }"""
TOPMOST_JS = """els => els.filter(el => el.checkVisibility({opacityProperty: true, visibilityProperty: true})).map(el => {
  const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const t = document.elementFromPoint(x, y); return el === t || el.contains(t); }).filter(hit => hit !== null)"""
GL_CAPTURE_JS = """(() => { const orig = HTMLCanvasElement.prototype.getContext; window.__hwContexts = [];
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const ctx = orig.call(this, type, ...rest);
  if (ctx && String(type).startsWith('webgl')) window.__hwContexts.push(ctx); return ctx; }; })();"""
LOSE_JS = """() => { let n = 0; for (const ctx of window.__hwContexts || []) {
  const ext = ctx.getExtension('WEBGL_lose_context'); if (ext) { ext.loseContext(); n++; } } return n; }"""
FOCUS_EVENT_JS = "() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }"
FOCUSED_ROLE_JS = "() => document.activeElement ? document.activeElement.getAttribute('role') : null"


def outage(var: str) -> str:
    url = os.environ.get(var, "")
    if not url:
        pytest.fail(f"{var} is not set: the verifier provisions this outage instance")
    return url.rstrip("/")


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def probe_ip() -> str:
    return "10.{}.{}.{}".format(random.randrange(256), random.randrange(256), random.randrange(1, 255))


def client(base: str, ip: str | None = None) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT, headers={"X-Forwarded-For": ip or probe_ip()})


@dataclass
class Person:
    base: str
    email: str
    name: str
    password: str
    c: httpx.Client

    @property
    def cookie(self) -> str:
        value = self.c.cookies.get("hw_session")
        assert value, "POST /api/session sets the hw_session cookie (L720)"
        return value

    def fork(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT,
                            headers={"X-Forwarded-For": self.c.headers["X-Forwarded-For"]},
                            cookies={"hw_session": self.cookie})


def ident(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email, name = (a, b) if "@" in a else (b, a)
    if "@" not in email:
        email = re.sub(r"[^a-z0-9.]", "", email.lower()) + "@example.com"
    return name[:Q_LIMIT], email


def sign_in(base: str, email: str, password: str) -> Person:
    c = client(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session signed {email} in (L720): {r.status_code} {r.text[:300]}"
    return Person(base.rstrip("/"), email, r.json()["account"]["name"], password, c)


def buyer(base: str, prefix: str = "buyer") -> Person:
    name, email = ident(prefix)
    with client(base) as c:
        r = c.post("/api/accounts", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 202, f"POST /api/accounts answered 202 (L719): {r.status_code} {r.text[:300]}"
    return sign_in(base, email, PASSWORD)


def coordinator(base: str) -> Person:
    return sign_in(base, MIRA_EMAIL, MIRA_PASSWORD)


def call(p: Person, method: str, path: str, **kw: Any) -> Callable[[], httpx.Response]:
    def run() -> httpx.Response:
        with p.fork() as c:
            return c.request(method, path, **kw)
    return run


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls), timeout=HTTP_TIMEOUT)

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def expect_error(r: httpx.Response, status: int, code: str, *, message: str | None = None,
                 field: tuple[str, str] | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}; got {r.status_code} {r.text[:400]}"
    body = r.json()
    assert set(body) == {"error"}, f"error shape is {{'error': ...}} (L587): {body}"
    error = body["error"]
    assert error["code"] == code, f"expected code {code}: {error}"
    want = message if message is not None else MSG.get(code)
    if want is not None:
        assert error["message"] == want, f"published message for {code}: {error['message']!r}"
    if field is not None:
        assert error.get("fields", {}).get(field[0]) == field[1], f"field {field[0]} message {field[1]!r}: {error}"
    if status != 422:
        assert "fields" not in error, f"fields appears only on 422 (L590): {error}"
    return error


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], what: str, seconds: float = POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ok(last):
            return last
    pytest.fail(f"{what}; last observed: {str(last)[:400]}")


def wait_real_duration(seconds: float) -> None:
    if seconds > 0:
        threading.Event().wait(seconds)


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def server_now(r: httpx.Response) -> datetime:
    return parsedate_to_datetime(r.headers["date"])


def wait_until_server(c: httpx.Client, target: datetime) -> None:
    now = server_now(c.get("/api/health"))
    wait_real_duration((target - now).total_seconds() + CLOCK_SLACK_S)


def office(value: str | datetime) -> str:
    moment = ts(value) if isinstance(value, str) else value
    local = moment.astimezone(OFFICE_ZONE)
    offset = local.utcoffset() or timedelta()
    if offset == timedelta(hours=11):
        abbr = "AEDT"
    elif offset == timedelta(hours=10):
        abbr = "AEST"
    else:
        total = int(offset.total_seconds() // 60)
        abbr = f"UTC+{total // 60:02d}:{total % 60:02d}"
    return f"{local.strftime('%a')} {local.day} {local.strftime('%b')} {local.strftime('%H:%M')} {abbr}"


def money(price: int) -> str:
    return f"${price:,}"


def half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def facing_of(bearing: int) -> str:
    return FACINGS[int(((bearing + 22.5) % 360) // 45)]


def unit(c: httpx.Client, code: str) -> dict:
    r = c.get(f"/api/units/{code}")
    assert r.status_code == 200, f"GET /api/units/{code} answered 200: {r.status_code} {r.text[:300]}"
    return r.json()["unit"]


def tower(c: httpx.Client) -> dict[str, dict]:
    r = c.get("/api/tower")
    assert r.status_code == 200, f"GET /api/tower answered 200: {r.status_code}"
    return {cell["code"]: cell for cell in r.json()["units"]}


def console_unit(m: Person, code: str) -> dict:
    r = m.c.get("/api/console/units")
    assert r.status_code == 200, r.text[:300]
    return next(u for u in r.json()["units"] if u["code"] == code)


def floor_pool(floor: int, stacks: str = "ABDEFGH") -> list[str]:
    return [f"{floor}{s}" for s in stacks]


def face_pool(floor: int) -> list[str]:
    return [f"{floor}{s}" for s in "CBD"]


def claim(c: httpx.Client, codes: list[str], n: int = 1) -> list[str]:
    cells = tower(c)
    free = [code for code in codes if cells[code]["status"] == "available"]
    if len(free) < n:
        pytest.fail(f"expected {n} available homes among {codes} (seed L1041); tower shows "
                    f"{[(code, cells[code]['status']) for code in codes]}")
    return free[:n]


def hold(p: Person, code: str, *, key: str | None = None, version: Any = None) -> httpx.Response:
    v = version if version is not None else unit(p.c, code)["priceVersion"]
    headers = {"Idempotency-Key": key} if key is not None else {}
    return p.c.post("/api/holds", json={"unitCode": code, "priceVersion": v}, headers=headers)


def place(p: Person, code: str, key: str | None = None) -> dict:
    r = hold(p, code, key=key)
    assert r.status_code == 201, f"POST /api/holds for {code} answered 201 (L724): {r.status_code} {r.text[:300]}"
    return r.json()["hold"]


def release(p: Person, hold_id: str) -> httpx.Response:
    return p.c.post(f"/api/holds/{hold_id}/release", json={})


def get_hold(p: Person, hold_id: str) -> dict:
    r = p.c.get(f"/api/holds/{hold_id}")
    assert r.status_code == 200, f"GET /api/holds/{hold_id}: {r.status_code} {r.text[:300]}"
    return r.json()["hold"]


def share(p: Person, hold_id: str) -> str:
    r = p.c.post(f"/api/holds/{hold_id}/share", json={})
    assert r.status_code == 201, f"POST share answered 201 (L727): {r.status_code} {r.text[:300]}"
    return r.json()["shareUrl"].rsplit("/", 1)[1]


def search_raw(c: httpx.Client, **params: Any) -> httpx.Response:
    items: list[tuple[str, str]] = []
    for name, value in params.items():
        for item in value if isinstance(value, list) else [value]:
            items.append((name, str(item)))
    return c.get("/api/search", params=items)


def search(c: httpx.Client, **params: Any) -> dict:
    r = search_raw(c, **params)
    assert r.status_code == 200, f"GET /api/search {params} answered 200: {r.status_code} {r.text[:300]}"
    return r.json()


def walk(c: httpx.Client, **params: Any) -> list[dict]:
    hits: list[dict] = []
    after = params.pop("after", None)
    for _ in range(MAX_PAGES):
        page = search(c, **params, **({"after": after} if after else {}))
        hits += page["hits"]
        after = page["nextCursor"]
        if not after:
            return hits
    pytest.fail("paging reached a null nextCursor on the last page (L716)")


def synced(c: httpx.Client, code: str) -> dict:
    return poll(lambda: unit(c, code), lambda u: not u["syncing"],
                f"GET /api/units/{code} cleared syncing once Meilisearch confirmed (L914)", SYNC_SECONDS + SYNC_SLACK_S)


def count_text(n: int) -> str:
    return "1 home matches" if n == 1 else f"{n} homes match"


def set_price(m: Person, code: str, price: int) -> dict:
    v = console_unit(m, code)["priceVersion"]
    r = m.c.put(f"/api/console/units/{code}/price", json={"price": price, "expectedVersion": v})
    assert r.status_code == 200, f"PUT price for {code}: {r.status_code} {r.text[:300]}"
    return r.json()


def png(width: int, height: int, *, noisy: bool = False) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    if noisy:
        raw = b"".join(b"\x00" + os.urandom(width * 3) for _ in range(height))
        level = 0
    else:
        raw = (b"\x00" + os.urandom(3) * width) * height
        level = 9
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    marker = b"Comment\x00" + uuid.uuid4().hex.encode()
    return (PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"tEXt", marker)
            + chunk(b"IDAT", zlib.compress(raw, level)) + chunk(b"IEND", b""))


def png_size(data: bytes) -> tuple[int, int]:
    return struct.unpack(">II", data[16:24])


def glb_json(data: bytes) -> dict:
    assert data[:4] == b"glTF", "model is binary glTF"
    length = struct.unpack("<I", data[12:16])[0]
    assert data[16:20] == b"JSON"
    return json.loads(data[20:20 + length])


def upload(m: Person, code: str, data: bytes, content_type: str = "image/png", c: httpx.Client | None = None) -> httpx.Response:
    target = c or m.c
    return target.put(f"/api/console/units/{code}/view-photo", content=data, headers={"Content-Type": content_type})


@contextlib.contextmanager
def _app(browser: Browser, url: str, **kw: Any) -> Iterator[Page]:
    made = open_app(browser, url, **kw)
    if hasattr(made, "__enter__"):
        with made as page:
            yield page
    else:
        page = next(made)
        try:
            yield page
        finally:
            with contextlib.suppress(StopIteration):
                next(made)


@contextlib.contextmanager
def opened(browser: Browser, base: str, path: str = "/finder", *, size: str = "desktop", cookie: str | None = None,
           reduced: bool = False, no_webgl: bool = False, init_script: str | None = None, clipboard: bool = False,
           clock_at: datetime | None = None, before: Callable[[Page], None] | None = None) -> Iterator[Page]:
    base = base.rstrip("/")
    with _app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as page:
        width, height = VIEWPORTS[size]
        page.set_viewport_size({"width": width, "height": height})
        page.context.set_extra_http_headers({"X-Forwarded-For": probe_ip()})
        if cookie:
            page.context.add_cookies([{"name": "hw_session", "value": cookie, "url": base}])
        if init_script:
            page.context.add_init_script(init_script)
        if clipboard:
            page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(base))
        if clock_at is not None:
            page.clock.set_system_time(clock_at)
        if before is not None:
            before(page)
        page.goto(base + path)
        yield page


INVALID_DESCRIBED_JS = """(group, message) => [group, ...group.querySelectorAll('input, [role=checkbox]')].some(node =>
  node.getAttribute('aria-invalid') === 'true' &&
  (node.getAttribute('aria-describedby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '')
    .join(' ').includes(message))"""


def wait_ui(page: Page, check_fn: Callable[[], bool], what: str, *, seconds: float = UI_SECONDS,
            step_ms: float = STEP_MS, max_page_ms: float | None = None) -> None:
    deadline = time.monotonic() + seconds
    spent = 0.0
    while time.monotonic() < deadline:
        try:
            if check_fn():
                return
        except PlaywrightError:
            pass
        if max_page_ms is None or spent + step_ms <= max_page_ms:
            advance(page, step_ms)
            spent += step_ms
    pytest.fail(what)


class Gate:

    def __init__(self, predicate: Callable[[Any], bool], fetch: bool = False, once: bool = False) -> None:
        self.predicate, self.fetch, self.once = predicate, fetch, once
        self.active = True
        self.held: list[tuple[Route, Any]] = []
        self.urls: list[str] = []

    def __call__(self, route: Route) -> None:
        if self.active and self.predicate(route.request) and not (self.once and self.urls):
            self.urls.append(route.request.url)
            self.held.append((route, route.fetch() if self.fetch else None))
            return
        route.fallback()

    def open(self) -> None:
        self.active = False
        for route, response in self.held:
            with contextlib.suppress(PlaywrightError):
                if response is not None:
                    route.fulfill(response=response)
                else:
                    route.continue_()
        self.held = []


def shown(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def gone(loc: Locator) -> bool:
    if loc.count() == 0 or not loc.first.is_visible():
        return True
    return loc.first.evaluate("el => getComputedStyle(el).opacity") == "0"


PLAIN_TEXT_JS = """el => { const s = document.createElement('style');
  s.textContent = '*, *::before, *::after { text-transform: none !important; }';
  document.head.append(s); try { return el.innerText; } finally { s.remove(); } }"""


def text_of(loc: Locator) -> str:
    return loc.first.evaluate(PLAIN_TEXT_JS) if loc.count() else ""


def disabled(loc: Locator) -> bool:
    return loc.first.is_disabled() or loc.first.get_attribute("aria-disabled") == "true"


def page_text(page: Page) -> str:
    return page.evaluate(f"() => ({PLAIN_TEXT_JS})(document.body)")


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices")


def results(page: Page) -> Locator:
    return page.get_by_role("region", name="Results")


def result_count(page: Page) -> Locator:
    return results(page).get_by_role("status", name="Result count")


def grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Tower")


def cell(page: Page, code: str) -> Locator:
    return grid(page).get_by_role("gridcell", name=re.compile(rf"^{re.escape(code)} · "))


def lens(page: Page) -> Locator:
    return page.get_by_role("figure", name="Window Lens")


def lens_img(page: Page, code: str) -> Locator:
    return lens(page).get_by_role("img", name=f"View from {code}", exact=True)


def homes(page: Page) -> Locator:
    return page.get_by_role("list", name="Homes")


def row_button(page: Page, code: str) -> Locator:
    return homes(page).get_by_role("button", name=re.compile(rf"^{re.escape(code)}(?![0-9A-Za-z])"))


def row_item(page: Page, code: str) -> Locator:
    button = page.get_by_role("button", name=re.compile(rf"^{re.escape(code)}(?![0-9A-Za-z])"))
    return homes(page).get_by_role("listitem").filter(has=button)


def detail(page: Page, code: str) -> Locator:
    return page.get_by_role("dialog", name=f"Home {code}", exact=True)


def confirm(page: Page) -> Locator:
    return page.get_by_role("alertdialog", name="Confirm hold", exact=True)


def chip_box(page: Page, group: str, label: str) -> Locator:
    return page.get_by_role("group", name=group, exact=True).get_by_role(
        "checkbox", name=re.compile(rf"^\W*{re.escape(label)} \(\d+\)"))


def chip_any(page: Page, group: str, label: str) -> Locator:
    return page.get_by_role("group", name=group, exact=True).get_by_role(
        "checkbox", name=re.compile(rf"^\W*{re.escape(label)}(?: \(\d+\))?\W*$"))


def chip_with_count(page: Page, group: str, label: str, count: int) -> Locator:
    return page.get_by_role("group", name=group, exact=True).get_by_role(
        "checkbox", name=re.compile(rf"^\W*{re.escape(label)} \({count}\)\W*$"))


def button(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def grid_names(page: Page) -> list[str]:
    return re.findall(r'gridcell "([^"]*)"', grid(page).aria_snapshot())


BG_NAMES_JS = """els => els.filter(el => el.checkVisibility({visibilityProperty: true}))
  .map(el => (el.getAttribute('aria-label') || el.textContent || '').trim())"""


def bg_grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Tower", include_hidden=True)


def bg_cell(page: Page, code: str) -> Locator:
    return bg_grid(page).get_by_role("gridcell", name=re.compile(rf"^{re.escape(code)} · "), include_hidden=True)


def bg_row_item(page: Page, code: str) -> Locator:
    button_ = page.get_by_role("button", name=re.compile(rf"^{re.escape(code)}(?![0-9A-Za-z])"), include_hidden=True)
    return page.get_by_role("list", name="Homes", include_hidden=True).get_by_role(
        "listitem", include_hidden=True).filter(has=button_)


def bg_detail(page: Page, code: str) -> Locator:
    return page.get_by_role("dialog", name=f"Home {code}", exact=True, include_hidden=True)


def bg_grid_names(page: Page) -> list[str]:
    return bg_grid(page).get_by_role("gridcell", include_hidden=True).evaluate_all(BG_NAMES_JS)


def bg_name(loc: Locator) -> str:
    return loc.first.evaluate("el => (el.getAttribute('aria-label') || el.textContent || '').trim()") if loc.count() else ""


def listed_codes(page: Page) -> list[str]:
    if homes(page).count() == 0:
        return []
    return re.findall(r'button "(\d{1,2}[A-H])(?![0-9A-Za-z])', homes(page).aria_snapshot())


def point(page: Page, loc: Locator) -> tuple[float, float]:
    assert loc.count() and loc.first.is_visible(), "the cell is visible"
    box_ = loc.first.bounding_box()
    assert box_ is not None, "the cell has a box"
    x, y = box_["x"] + box_["width"] / 2, box_["y"] + box_["height"] / 2
    page.mouse.move(x, y)
    return x, y


def expected_chip(cell_: dict, *, mine: bool = False, dimmed: bool = False) -> str:
    code, status = cell_["code"], cell_["status"]
    if status in ("withdrawn", "unreleased"):
        return f"{code} · {STATUS_LABEL[status]}"
    bearing, facing = STACKS[cell_["stack"]][:2]
    label = "Held by you" if mine and status == "held" else STATUS_LABEL[status]
    text = f"{code} · {bearing}° {facing} · {label}"
    if cell_["syncing"]:
        text += " · Syncing"
    if dimmed:
        text += " · Outside your filters"
    return text


def same_chip(name: str, expected: str) -> bool:
    got, want = name.split(" · "), expected.split(" · ")
    head = 3 if len(want) >= 3 else len(want)
    return got[:head] == want[:head] and set(got[head:]) == set(want[head:])


def cells_mismatch(page: Page, c: httpx.Client, matching: set[str] | None, mine: set[str] = frozenset()) -> str | None:
    cells = tower(c)
    names = bg_grid_names(page)
    if not names:
        return "no gridcells drawn"
    for name in names:
        code = name.split(" · ")[0]
        cell_ = cells.get(code)
        if cell_ is None:
            return f"unknown cell {name!r}"
        dimmed = matching is not None and cell_["status"] in LIVE and code not in matching
        want = expected_chip(cell_, mine=code in mine, dimmed=dimmed)
        if not same_chip(name, want):
            return f"cell {name!r} expected {want!r}"
    return None


def cells_match(page: Page, c: httpx.Client, matching: set[str] | None, mine: set[str] = frozenset()) -> None:
    last: list[str | None] = [None]

    def ok() -> bool:
        last[0] = cells_mismatch(page, c, matching, mine)
        return last[0] is None

    wait_ui(page, ok, "every drawn cell matches the newest tower read (L315)", max_page_ms=REREAD_MS * 6)


def wait_count(page: Page) -> str:
    wait_ui(page, lambda: re.fullmatch(r"\d+ homes match|1 home matches", text_of(result_count(page)).strip()) is not None,
            "Result count announced '<n> homes match' (L544)")
    return text_of(result_count(page)).strip()


def wait_results(page: Page, total: int, *, behind: bool = False) -> None:
    want = count_text(total)
    pane = page.get_by_role("region", name="Results", include_hidden=True) if behind else results(page)
    count = pane.get_by_role("status", name="Result count", include_hidden=True) if behind else result_count(page)
    wait_ui(page, lambda: text_of(count).strip() == want and pane.get_attribute("aria-busy") != "true",
            f"Result count reads {want!r} with aria-busy cleared (L251, L544)")


def ui_sign_in(page: Page, dialog_name: str, email: str, password: str) -> None:
    dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
    wait_ui(page, lambda: shown(dialog), f"dialog {dialog_name!r} opened (L198)")
    fill(dialog.get_by_role("textbox", name="Email", exact=True), email)
    fill(dialog.get_by_role("textbox", name="Password", exact=True), password)
    click(button(dialog, "Sign in"))


SAMPLE_AT_JS = """(e, t) => {
  // Pause every CSS/WAAPI animation in the subtree (including ones started since the last sample) at time t from its
  // start; JS/rAF motion advances separately on the page clock, so both kinds are measured in one path.
  for (const a of e.getAnimations({subtree: true})) {
    if (a.playState !== 'finished') a.pause();
    const end = a.effect.getComputedTiming().endTime;
    a.currentTime = Math.min(t, Number.isFinite(end) ? end : t);
  }
  const r = e.getBoundingClientRect();
  return {x: r.left, y: r.top, width: r.width, height: r.height, opacity: Number(getComputedStyle(e).opacity)};
}"""
RESUME_JS = "e => e.getAnimations({subtree: true}).forEach(a => { if (a.playState === 'paused') a.play(); })"


def motion_full(loc: Locator, duration_ms: float, samples: int = 12, settle_ms: float = 100) -> list[dict[str, float]]:
    el, step, path = loc.first, duration_ms / max(1, samples - 1), []
    try:
        for i in range(samples):
            if i:
                loc.page.clock.run_for(round(step))
            path.append({"t": step * i, **el.evaluate(SAMPLE_AT_JS, step * i)})
        loc.page.clock.run_for(round(settle_ms))
        path.append({"t": duration_ms + settle_ms, **el.evaluate(SAMPLE_AT_JS, duration_ms + settle_ms)})
    finally:
        el.evaluate(RESUME_JS)
    return path


CROSSFADE_AT_JS = """(lens, args) => {
  for (const a of lens.getAnimations({subtree: true})) {
    if (a.playState !== 'finished') a.pause();
    const end = a.effect.getComputedTiming().endTime;
    a.currentTime = Math.min(args.t, Number.isFinite(end) ? end : args.t);
  }
  const effective = name => {
    const img = [...lens.querySelectorAll('img, [role=img]')].find(n => (n.getAttribute('alt') || n.getAttribute('aria-label')) === name);
    if (!img) return 0;
    let o = 1;
    for (let n = img; n && n !== lens.parentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === 'hidden' || s.display === 'none') return 0;
      o *= Number(s.opacity);
    }
    return o;
  };
  return {mix: effective(args.fresh) - effective(args.old)};
}"""


def crossfade_path(page: Page, old: str, new: str, duration_ms: float, samples: int = 16) -> list[dict[str, float]]:
    lens_img(page, new).first.wait_for(state="attached")
    lens_el, step, path = lens(page).first, duration_ms / max(1, samples - 1), []
    args = {"old": f"View from {old}", "fresh": f"View from {new}"}
    try:
        for i in range(samples):
            if i:
                page.clock.run_for(round(step))
            path.append({"t": step * i, **lens_el.evaluate(CROSSFADE_AT_JS, {**args, "t": step * i})})
        page.clock.run_for(100)
        path.append({"t": duration_ms + 100, **lens_el.evaluate(CROSSFADE_AT_JS, {**args, "t": duration_ms + 100})})
    finally:
        lens_el.evaluate(RESUME_JS)
    return path


GROW_AT_JS = """(args) => {
  for (const a of document.getAnimations()) {
    if (a.playState !== 'finished') a.pause();
    const end = a.effect.getComputedTiming().endTime;
    a.currentTime = Math.min(args.t, Number.isFinite(end) ? end : args.t);
  }
  const shownWidth = el => {
    if (!el) return 0;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return 0;
    }
    return el.getBoundingClientRect().width;
  };
  const lens = document.querySelector('figure[aria-label="Window Lens"]') ||
    [...document.querySelectorAll('figure')].find(f => (f.getAttribute('aria-label') || f.querySelector('figcaption')?.textContent || '').includes('Window Lens'));
  const dialog = [...document.querySelectorAll('[role=dialog], dialog')].find(d => (d.getAttribute('aria-label') || '') === args.dialog ||
    (d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim() === args.dialog));
  const panel = dialog && [...dialog.querySelectorAll('img, [role=img]')].find(n => (n.getAttribute('alt') || n.getAttribute('aria-label')) === args.view);
  return Math.max(shownWidth(lens), shownWidth(panel));
}"""


def grow_path(page: Page, code: str, duration_ms: float, samples: int = 24) -> tuple[float, bool]:
    step, widths = duration_ms / max(1, samples - 1), []
    args = {"dialog": f"Home {code}", "view": f"View from {code}"}
    try:
        for i in range(samples):
            if i:
                page.clock.run_for(round(step))
            widths.append((step * i, float(page.evaluate(GROW_AT_JS, {**args, "t": step * i}))))
    finally:
        page.evaluate("() => document.getAnimations().forEach(a => { if (a.playState === 'paused') a.play(); })")
    peak_at = max(range(len(widths)), key=lambda i: widths[i][1])
    peak = widths[peak_at][1]
    last_moving = max((i for i in range(peak_at + 1) if peak - widths[i][1] > 0.01), default=0)
    reached = widths[min(last_moving + 1, peak_at)][0]
    return reached - widths[0][0], peak - widths[0][1] > 1


def motion_key(sample: dict, *names: str) -> float:
    for name in names:
        if name in sample:
            return float(sample[name])
    pytest.fail(f"motion sample lacks any of {names}: {sorted(sample)}")


def settle_time(path: list[dict], metric: Callable[[dict], float], tolerance: float) -> tuple[float, bool]:
    final = metric(path[-1])
    moved = abs(metric(path[0]) - final) > tolerance
    settled_at = motion_key(path[-1], "t", "time")
    for sample in reversed(path):
        if abs(metric(sample) - final) > tolerance:
            break
        settled_at = motion_key(sample, "t", "time")
    return settled_at - motion_key(path[0], "t", "time"), moved


def centre_x(s: dict) -> float:
    return motion_key(s, "x", "left") + motion_key(s, "width") / 2


def centre_y(s: dict) -> float:
    return motion_key(s, "y", "top") + motion_key(s, "height") / 2


def tab_until(page: Page, predicate: Callable[[], bool], what: str, inside: Locator | None = None) -> None:
    for _ in range(TAB_BOUND):
        page.keyboard.press("Tab")
        if inside is not None:
            assert inside.evaluate("el => el.contains(document.activeElement)"), f"Tab stayed inside the open dialog (L352) while seeking {what}"
        if predicate():
            return
    pytest.fail(f"Tab reached {what}")


def focused_code(page: Page) -> tuple[int, str]:
    name = accessible_name(page) or ""
    m = re.match(r"^(\d{1,2})([A-H]) · ", name)
    assert m, f"focus is on a tower gridcell named '<code> · ...' (L192): {name!r}"
    return int(m.group(1)), m.group(2)


def test_run_manifest_health(app_url):
    with client(app_url) as c:
        r = c.get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}, f"GET /api/health (L714): {r.status_code} {r.text}"
        assert "date" in r.headers, "every response carries Date (L582)"
        units = c.get("/api/tower").json()["units"]
        assert len(units) == TOTAL_UNITS, "GET /api/tower lists 288 cells (L715)"


def test_server_boundary(app_url):
    own = origin_of(app_url)
    with client(app_url) as c:
        for method, path in [("POST", "/api/session"), ("POST", "/api/accounts"), ("DELETE", "/api/session"),
                             ("PUT", "/api/console/units/27C/price")]:
            r = c.request(method, path, json={}, headers={"Origin": FOREIGN_ORIGIN})
            expect_error(r, 403, "cross_origin")
            assert not any(h.lower().startswith("access-control-") for h in r.headers), "no CORS headers (L1101)"
        bad = {"email": "nobody@example.com", "password": "Wrong-Password-1"}
        expect_error(c.post("/api/session", json=bad, headers={"Origin": own}), 401, "sign_in_failed")
        expect_error(c.post("/api/session", json=bad), 401, "sign_in_failed")
        head = '{"email":"nobody@example.com","password":"Wrong-Password-1","pad":"'
        exact = (head + "x" * (JSON_LIMIT - len(head) - 2) + '"}').encode()
        assert len(exact) == JSON_LIMIT
        r = c.post("/api/session", content=exact, headers={"Content-Type": "application/json"})
        assert r.status_code != 413, "a 16,384-byte JSON body is allowed (L1103)"
        r = c.post("/api/session", content=exact[:-2] + b'x"}', headers={"Content-Type": "application/json"})
        expect_error(r, 413, "too_large")
        r = c.post("/api/session", content=json.dumps(bad), headers={"Content-Type": "text/plain"})
        expect_error(r, 415, "unsupported_type")
        for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/.git/config",
                     "/node_modules/.package-lock.json"]:
            assert c.get(path).status_code == 404, f"{path} answers 404 (L1106)"
        html = c.get("/").text
        for script in re.findall(r'src="(/[^"]+\.js)"', html):
            assert c.get(script + ".map").status_code == 404, f"source map {script}.map answers 404 (L1106)"
    for var in ("APP_MEILISEARCH_DOWN_URL", "APP_STORAGE_DOWN_URL"):
        with client(outage(var)) as c:
            assert c.get("/api/health").status_code == 200, f"{var} serves with a dependency down (L1113)"
            assert c.get("/api/tower").status_code == 200


def test_wf_cross_cutting_error_order(app_url):
    anon = client(app_url)
    head = '{"unitCode":"27C","priceVersion":1,"pad":"'
    body = (head + "x" * (JSON_LIMIT + 1 - len(head) - 2) + '"}').encode()
    assert len(body) == JSON_LIMIT + 1
    expect_error(anon.post("/api/holds", content=body, headers={"Content-Type": "application/json"}), 413, "too_large")
    expect_error(anon.post("/api/holds", json={"unitCode": "27C", "priceVersion": 1}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    big = PNG_SIGNATURE + b"\x00" * (PHOTO_LIMIT + 1 - len(PNG_SIGNATURE))
    expect_error(anon.put("/api/console/units/32H/view-photo", content=big, headers={"Content-Type": "image/png"}), 413, "too_large")
    expect_error(anon.get(f"/api/holds/{uuid.uuid4()}"), 401, "unauthenticated")

    short = outage("APP_SHORT_URL")
    mira = coordinator(short)
    some = claim(client(short), floor_pool(13, "ABDEFGH"))[0]
    expect_error(mira.c.post("/api/holds", json={"unitCode": some, "priceVersion": 1}), 403, "forbidden")
    for _ in range(2):
        mira.c.post("/api/holds", json={"unitCode": some, "priceVersion": 1})
    r = mira.c.post("/api/holds", json={"unitCode": some, "priceVersion": 1})
    expect_error(r, 429, "hold_attempts", message=ATTEMPTS_MSG.format(s=r.headers.get("retry-after")))

    ana = sign_in(app_url, ANA_EMAIL, ANA_PASSWORD)
    expect_error(ana.c.get("/api/console/units/ZZ9/prices"), 403, "forbidden")
    b1 = buyer(app_url, "order-validation")
    expect_error(b1.c.post("/api/holds", json={"unitCode": "5D"}), 404, "not_found")
    expect_error(b1.c.post("/api/holds", json={"unitCode": "27C", "priceVersion": "1"}), 422, "invalid", field=("priceVersion", F_PRICE_VERSION))
    r = b1.c.post("/api/holds", content=b'{"unitCode":"27C","priceVersion":1.0}', headers={"Content-Type": "application/json"})
    expect_error(r, 422, "invalid", field=("priceVersion", F_PRICE_VERSION))

    probe = client(app_url)
    mine, other, cool, keyed = claim(probe, floor_pool(33, "DEFGH"), 4)
    b2, b3, b4 = buyer(app_url, "order-limit"), buyer(app_url, "order-cooldown"), buyer(app_url, "order-replay")
    h2 = place(b2, mine)
    h4: dict | None = None
    try:
        stale = unit(probe, other)["priceVersion"] + 1
        expect_error(hold(b2, other, version=stale), 409, "hold_limit")
        h3 = place(b3, cool)
        release(b3, h3["id"])
        stale = unit(probe, cool)["priceVersion"] + 1
        assert hold(b3, cool, version=stale).json()["error"]["code"] == "hold_cooldown", "hold_cooldown precedes price_changed (L753)"
        expect_error(coordinator(app_url).c.put("/api/console/units/5D/price", json={"price": 1100000, "expectedVersion": 7}), 409, "unit_withdrawn")
        key = idempotency_key()
        first = hold(b4, keyed, key=key)
        assert first.status_code == 201, first.text
        h4 = first.json()["hold"]
        for _ in range(2):
            b4.c.post("/api/holds", json={"unitCode": "5D"})
        full = b4.c.post("/api/holds", json={"unitCode": "5D"})
        expect_error(full, 429, "hold_attempts", message=ATTEMPTS_MSG.format(s=full.headers.get("retry-after")))
        replay = hold(b4, keyed, key=key, version=h4["priceVersion"])
        assert replay.status_code == 201 and replay.json() == first.json(), "stored 201 replayed after the window filled (L622)"
        expect_error(hold(b4, keyed, key=key, version=h4["priceVersion"] + 1), 409, "idempotency_key_reused")
    finally:
        release(b2, h2["id"])
        if h4:
            release(b4, h4["id"])
    down = client(outage("APP_MEILISEARCH_DOWN_URL"))
    expect_error(search_raw(down, q="a" * (Q_LIMIT + 1)), 422, "invalid", field=("q", F_Q))


def test_search_facets(app_url):
    s = buyer(app_url, "facets")

    def visible() -> set[str]:
        return {code for code, cell_ in tower(s.c).items() if cell_["status"] in LIVE}

    first, live = poll(lambda: (search(s.c), visible()), lambda pair: set(pair[0]["matchingCodes"]) == pair[1],
                       "unfiltered matchingCodes lists every released, non-withdrawn home (L28, L874)")
    assert first["total"] == len(first["matchingCodes"])
    assert "5D" not in first["matchingCodes"], "withdrawn homes are left out (L875)"
    for facet, values in FACET_VALUES.items():
        assert set(first["facets"][facet]) == set(values), f"facets.{facet} lists every published value (L716)"
    for facet in ("bedrooms", "band", "status"):
        assert sum(first["facets"][facet].values()) == first["total"]
    prices = [h["price"] for h in walk(s.c)]
    assert first["priceStats"] == {"min": min(prices), "max": max(prices)}, "priceStats spans the result set (L873)"

    wanted = {f"{f}{st}" for f in range(20, 30) for st in "CH"} & live
    page = poll(lambda: search(s.c, bedrooms=["3"], band=["20-29"]), lambda p: set(p["matchingCodes"]) == wanted,
                "bedrooms=3&band=20-29 matches stacks C and H on floors 20-29 (L872, L1024)")
    assert page["facets"]["bedrooms"] == {"1": 0, "2": 0, "3": page["total"]}, "counts apply every filter (L873)"
    assert all(h["bedrooms"] == 3 and h["band"] == "20-29" for h in page["hits"])
    text = search(s.c, q="SW harbour")
    assert set(text["matchingCodes"]) == {c for c in live if c.endswith("C")}, "every word prefixes a word of the home (L871)"
    assert "27C" in search(s.c, q="27C")["matchingCodes"]
    typo = search(s.c, q="harbur")
    assert typo["total"] == 0 and typo["priceStats"] is None and typo["nextCursor"] is None, "no typo tolerance (L871, L716)"


def test_search_input_bounds(app_url):
    c = buyer(app_url, "bounds").c
    down = client(outage("APP_MEILISEARCH_DOWN_URL"))
    cases = [
        (dict(q="a" * (Q_LIMIT + 1)), ("q", F_Q)),
        (dict(bedrooms=["3"] * (FACET_LIMIT + 1)), ("bedrooms", F_FACET_MANY)),
        (dict(facing=["XX"]), ("facing", F_FACET_UNKNOWN)),
        (dict(priceMin=2000000, priceMax=1000000), ("priceMin", F_PRICE_ORDER)),
        (dict(priceMin="1.5"), ("priceMin", F_PRICE_WHOLE)),
        (dict(limit=PAGE_SIZE + 1), ("limit", F_LIMIT)),
    ]
    for params, field in cases:
        expect_error(search_raw(c, **params), 422, "invalid", field=field)
        expect_error(search_raw(down, **params), 422, "invalid", field=field)
    expect_error(search_raw(c, after="not-a-cursor"), 422, "invalid", field=("after", F_AFTER))
    for params in (dict(q="a" * Q_LIMIT), dict(bedrooms=["3"] * FACET_LIMIT), dict(priceMin=1000000, priceMax=1000000)):
        assert search_raw(c, **params).status_code == 200, f"{params} is within the bounds (L864-L866)"
    started = time.monotonic()
    r = search_raw(down)
    expect_error(r, 503, "search_unavailable")
    assert time.monotonic() - started < SEARCH_BOUND_S + CLOCK_SLACK_S, "the 503 comes at once (L868)"


def test_wf_filter_homes_field_messages(browser, app_url):
    with opened(browser, app_url) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/api/search" in r.url else None)
        wait_count(page)
        for label in FACINGS[:FACET_LIMIT]:
            check(chip_box(page, "Facing", label))
            advance(page, DEBOUNCE_MS)
        expected = search(client(app_url), facing=FACINGS[:FACET_LIMIT])["total"]
        wait_results(page, expected)
        seventh = chip_box(page, "Facing", FACINGS[FACET_LIMIT])
        click(seventh)
        advance(page, DEBOUNCE_MS * 4)
        assert not seventh.is_checked(), "the chip over the limit does not toggle (L255)"
        assert F_FACET_MANY in text_of(page.get_by_role("group", name="Facing", exact=True)), "group shows 'Choose up to 6.' (L671)"
        assert page.get_by_role("group", name="Facing", exact=True).evaluate(INVALID_DESCRIBED_JS, F_FACET_MANY), \
            "the Facing group or its chip is aria-invalid and described by 'Choose up to 6.' (L255, L540)"
        box = page.get_by_role("searchbox", name="Search homes", exact=True)
        fill(box, "a" * (Q_LIMIT + 1))
        advance(page, DEBOUNCE_MS * 4)
        assert box.get_attribute("aria-invalid") == "true", "aria-invalid marks the field (L540)"
        assert F_Q in (box.evaluate("el => (el.getAttribute('aria-describedby')||'').split(/\\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ')") or "")
        fill(box, "")
        advance(page, DEBOUNCE_MS * 4)
        wait_results(page, expected)
        low = page.get_by_role("spinbutton", name="Lowest price", exact=True)
        high = page.get_by_role("spinbutton", name="Highest price", exact=True)
        fill(high, "1000000")
        advance(page, DEBOUNCE_MS * 4)
        wait_results(page, search(client(app_url), facing=FACINGS[:FACET_LIMIT], priceMax=1000000)["total"])
        before, count = len(sent), text_of(result_count(page))
        fill(low, "2000000")
        advance(page, DEBOUNCE_MS * 4)
        assert low.get_attribute("aria-invalid") == "true" and F_PRICE_ORDER in page_text(page), "min above max message (L674)"
        assert len(sent) == before and text_of(result_count(page)) == count, "no search is sent and results stay (L254)"


def test_wf_filter_homes_newest_wins(browser, app_url):
    api = client(app_url)
    gate = Gate(lambda req: (q := parse_qs(urlsplit(req.url).query)).get("bedrooms") == ["3"] and "band" not in q, once=True)
    finished: list[str] = []
    with opened(browser, app_url, before=lambda p: p.route("**/api/search**", gate)) as page:
        page.on("requestfinished", lambda r: finished.append(r.url))
        page.on("requestfailed", lambda r: finished.append(r.url))
        wait_count(page)
        page.evaluate("() => { window.__hwSameDocument = true; }")
        check(chip_box(page, "Bedrooms", "3 bedrooms"))
        wait_ui(page, lambda: bool(gate.urls), "the first chip sent a search")
        check(chip_box(page, "Floors", "Floors 20-29"))
        reply = search(api, bedrooms=["3"], band=["20-29"])
        wait_results(page, reply["total"])

        def settled() -> None:
            assert shown(chip_with_count(page, "Bedrooms", "3 bedrooms", reply['facets']['bedrooms']['3'])), "chip counts follow the newest reply (L247)"
            assert shown(chip_with_count(page, "Floors", "Floors 20-29", reply['facets']['band']['20-29']))
            assert listed_codes(page)[: len(reply["hits"])] == [h["code"] for h in reply["hits"]], "rows follow the newest reply (L248)"
            cells_match(page, api, set(reply["matchingCodes"]))

        settled()
        held_url = gate.urls[0]
        with contextlib.suppress(PlaywrightError):
            gate.open()
        wait_ui(page, lambda: held_url in finished, "the older request ended (reply landed or request aborted)")
        advance(page, DEBOUNCE_MS * 2)
        settled()
        assert results(page).get_attribute("aria-busy") != "true"
        assert page.evaluate("() => window.__hwSameDocument === true"), "no page load (L246)"


def test_search_rate_limit(app_url):
    base = outage("APP_SHORT_URL")
    ip = probe_ip()
    c = client(base, ip)
    for _ in range(SHORT_SEARCH_LIMIT):
        assert search_raw(c).status_code == 200
    r = search_raw(c)
    retry = int(r.headers["retry-after"])
    assert 1 <= retry <= SEARCH_WINDOW_S, "Retry-After is whole seconds, at least 1 (L661)"
    expect_error(r, 429, "search_rate_limited", message=SEARCH_LIMIT_MSG.format(s=retry))
    assert search_raw(client(base)).status_code == 200, "the limit is per client address (L886)"
    signed = buyer(base, "limit")
    signed.c.headers["X-Forwarded-For"] = ip
    assert search_raw(signed.c).status_code == 200, "searches with a session are not limited (L746)"
    retry = int(search_raw(c).headers["retry-after"])
    wait_real_duration(retry)
    assert search_raw(c).status_code == 200, "a client quiet for Retry-After is served (L889)"


def test_empty_result_state(browser, app_url):
    assert search(client(app_url), priceMax=EMPTY_CEILING)["total"] == 0
    with opened(browser, app_url) as page:
        assert wait_count(page) != count_text(0)
        fill(page.get_by_role("spinbutton", name="Highest price", exact=True), str(EMPTY_CEILING))
        advance(page, DEBOUNCE_MS * 2)
        wait_results(page, 0)
        text = text_of(results(page))
        assert C_EMPTY_HEADING.lower() in text.lower() and C_EMPTY_HINT in text, "empty state copy (L546; the heading may be uppercase by CSS)"


def test_wf_filter_homes_wait_uses_newest(browser):
    base = outage("APP_SHORT_URL")
    sent: list[str] = []
    done: list[str] = []

    def listen(p_: Page) -> None:
        p_.on("request", lambda r: sent.append(r.url) if "/api/search" in r.url else None)
        p_.on("requestfinished", lambda r: done.append(r.url) if "/api/search" in r.url else None)
        p_.on("requestfailed", lambda r: done.append(r.url) if "/api/search" in r.url else None)

    with opened(browser, base, before=listen) as page:
        banner = page.get_by_role("alert").filter(has_text="Too many searches from this device.")
        wait_ui(page, lambda: len(sent) > 0 and len(done) >= len(sent), "the first search landed")
        one = chip_box(page, "Bedrooms", "1 bedroom")
        for _ in range(SHORT_SEARCH_LIMIT + 3):
            if shown(banner):
                break
            click(one)
            wait_ui(page, lambda: len(done) >= len(sent), "search replies landed")
        assert shown(banner), "the 429 shows the rate-limit banner (L279)"
        seconds = int(re.search(r"Try again in (\d+) seconds\.", text_of(banner)).group(1))
        assert SEARCH_LIMIT_MSG.format(s=seconds) in text_of(banner)
        sent_before = len(sent)
        floors = chip_box(page, "Floors", "Floors 20-29")
        assert floors.get_attribute("aria-disabled") != "true", "filters stay enabled (L280)"
        check(floors)
        click(one)
        bedrooms = ["1"] if one.is_checked() else []
        advance(page, 1000)
        if seconds > 1:
            later = int(re.search(r"Try again in (\d+) seconds\.", text_of(banner)).group(1))
            assert later == seconds - 1, "the banner counts down once a second (L279)"
        assert len(sent) == sent_before, "no searches during the countdown (L281)"
        for _ in range(seconds + 2):
            if not shown(banner):
                break
            advance(page, 1000)
        wait_ui(page, lambda: len(sent) > sent_before, "one search was sent at zero (L282)", max_page_ms=1000)
        assert len(sent) == sent_before + 1
        query = parse_qs(urlsplit(sent[sent_before]).query)
        assert query.get("band") == ["20-29"] and query.get("bedrooms", []) == bedrooms, f"built from the filters at that moment: {query}"


def test_wf_filter_homes_url_state(browser, app_url):
    api = client(app_url)
    with opened(browser, app_url) as page:
        wait_count(page)
        length = page.evaluate("history.length")
        check(chip_box(page, "Bedrooms", "3 bedrooms"))
        wait_ui(page, lambda: urlsplit(page.url).query == "bedrooms=3", "address reads bedrooms=3 (L262)")
        check(chip_box(page, "Floors", "Floors 20-29"))
        wait_ui(page, lambda: urlsplit(page.url).query == "bedrooms=3&band=20-29", "address reads bedrooms=3&band=20-29 (L264)")
        assert page.evaluate("history.length") == length + 2, "each settled change pushes one entry (L267)"
        page.go_back()
        wait_results(page, search(api, bedrooms=["3"])["total"])
        assert urlsplit(page.url).query == "bedrooms=3" and not chip_box(page, "Floors", "Floors 20-29").is_checked()
        page.go_forward()
        wait_results(page, search(api, bedrooms=["3"], band=["20-29"])["total"])
        assert chip_box(page, "Floors", "Floors 20-29").is_checked()
        page.reload()
        wait_results(page, search(api, bedrooms=["3"], band=["20-29"])["total"])
        assert chip_box(page, "Bedrooms", "3 bedrooms").is_checked()
        for path, want in [("/finder?bedrooms=9&band=20-29", "band=20-29"),
                           ("/finder?" + "&".join(["facing=N"] * (FACET_LIMIT + 1)) + "&band=20-29", "band=20-29"),
                           ("/finder?priceMin=1.5&band=20-29", "band=20-29"),
                           ("/finder?priceMin=2000000&priceMax=1000000&band=20-29", "band=20-29"),
                           ("/finder?q=" + "a" * (Q_LIMIT + 1) + "&band=20-29", "band=20-29")]:
            length = page.evaluate("history.length")
            page.goto(app_url + path)
            wait_ui(page, lambda: urlsplit(page.url).query == want, f"{path} rewritten to ?{want} (L270-L277)")
            assert page.evaluate("history.length") == length + 1, "rewriting adds no entry (L270)"
            assert chip_box(page, "Floors", "Floors 20-29").is_checked()


def test_search_paging_order(app_url):
    c = buyer(app_url, "paging").c
    first = search(c)
    assert len(first["hits"]) == min(PAGE_SIZE, first["total"]) and first["nextCursor"], "default page of 24 with a cursor (L879)"
    hits = walk(c)
    codes = [h["code"] for h in hits]
    assert len(codes) == len(set(codes)), "no home repeats"
    keys = [(h["price"], h["floor"], h["stack"]) for h in hits]
    assert keys == sorted(keys), "sorted by price then unit code (L880)"
    assert set(codes) == set(first["matchingCodes"])
    assert len(search(c, limit=5)["hits"]) == 5, "limit lowers the page size (L879)"


def test_paging_price_change_between_pages(app_url):
    s, m, other = buyer(app_url, "pager"), coordinator(app_url), buyer(app_url, "pager-holder")
    params = dict(bedrooms=["1"], band=["10-19"], limit=5)
    page1 = search(s.c, **params)
    cursor, last = page1["nextCursor"], page1["hits"][-1]
    later = walk(s.c, **params, after=cursor)
    moved_back, moved_on = later[-1], page1["hits"][0]
    set_price(m, moved_back["code"], last["price"] - 1)
    set_price(m, moved_on["code"], max(h["price"] for h in later) + PRICE_STEP)
    synced(s.c, moved_back["code"])
    synced(s.c, moved_on["code"])
    after = [h["code"] for h in walk(s.c, **params, after=cursor)]
    assert moved_back["code"] not in after, "a home moved before the cursor does not appear again (L883)"
    assert after.count(moved_on["code"]) == 1, "a home moved after the cursor appears once (L883)"
    for h in later[:-1]:
        assert after.count(h["code"]) == 1, f"{h['code']} appears exactly once (L882)"
    status = dict(params, status=["available"])
    page1 = search(s.c, **status)
    rest = walk(s.c, **status, after=page1["nextCursor"])
    target = rest[0]["code"]
    h = place(other, target)
    try:
        synced(s.c, target)
        again = [x["code"] for x in walk(s.c, **status, after=page1["nextCursor"])]
        assert target not in again, "a home that no longer matches is left out"
        for x in rest[1:]:
            if x["code"] in again:
                assert again.count(x["code"]) == 1
        assert not set(again) & {x["code"] for x in page1["hits"]}, "no page-1 home repeats (L34)"
    finally:
        release(other, h["id"])


def test_wf_page_results_rows(browser, app_url):
    api = buyer(app_url, "rows").c
    reply = search(api, bedrooms=["1"], band=["10-19"])
    with opened(browser, app_url, "/finder?bedrooms=1&band=10-19") as page:
        wait_results(page, reply["total"])
        hits = {h["code"]: h for h in search(api, bedrooms=["1"], band=["10-19"])["hits"]}
        for code in listed_codes(page)[:8]:
            h = hits[code]
            text = text_of(row_item(page, code))
            for part in (STATUS_LABEL[h["status"]], money(h["price"]), f"{h['bearing']}° {h['facing']}",
                         f"{h['bedrooms']} bed", VIEW_LABEL[h["viewTag"]], BAND_LABEL[h["band"]]):
                assert part in text, f"row {code} shows {part!r} (L232-L240): {text!r}"
            assert re.search(rf"{h['areaM2']} m² · {h['areaSqft'] // 1000},?{h['areaSqft'] % 1000:03d} sq ft|{h['areaM2']} m² · {h['areaSqft']} sq ft", text), text
            assert ("Syncing" in text) == h["syncing"] or h["syncing"] is False


def test_wf_page_results_announced(browser, app_url):
    gate = Gate(lambda req: "after=" in req.url)
    replies: list[Any] = []
    with opened(browser, app_url, "/finder?band=10-19", before=lambda p: p.route("**/api/search**", gate)) as page:
        page.on("response", lambda r: replies.append(r) if "/api/search" in r.url and "after=" in r.url else None)
        wait_count(page)
        more = button(results(page), "Show more homes")
        for _ in range(MAX_PAGES):
            if not shown(more):
                break
            before = listed_codes(page)
            click(more)
            wait_ui(page, lambda: bool(gate.held), "the page request is in flight")
            assert disabled(more) and results(page).get_attribute("aria-busy") == "true", "pending state (L547)"
            count = len(replies)
            gate.open()
            gate.active = True
            wait_ui(page, lambda: len(replies) > count and len(listed_codes(page)) > len(before), "the page appended")
            body = replies[-1].json()
            now = listed_codes(page)
            assert len(now) == len(set(now)), "no code is listed twice (L301)"
            added = len(now) - len(before)
            copy = (f"1 more home. {len(now)} of {body['total']} shown." if added == 1
                    else f"{added} more homes. {len(now)} of {body['total']} shown.")
            wait_ui(page, lambda: copy in text_of(notices(page)), f"Notices announced {copy!r} (L547)")
            assert (accessible_name(page) or "").startswith(now[len(before)]), "focus lands on the first new row (L304)"
            assert text_of(result_count(page)).strip() == count_text(body["total"]), "total follows the newest reply (L305)"
        assert more.count() == 0, "the button is removed on the last page (L306)"


def test_wf_page_results_reread_keeps_pages(browser, app_url):
    other = buyer(app_url, "reread")
    gate = Gate(lambda req: "after=" in req.url)
    hold_id = None
    with opened(browser, app_url, "/finder?band=10-19") as page:
        wait_count(page)
        click(button(results(page), "Show more homes"))
        wait_ui(page, lambda: len(listed_codes(page)) >= 2 * PAGE_SIZE, "two pages listed")
        codes = listed_codes(page)
        focus = row_button(page, codes[PAGE_SIZE + 5])
        focus.focus()
        name = accessible_name(page)
        scroll = focus.evaluate(SCROLL_JS)
        target = claim(client(app_url), codes[:PAGE_SIZE])[0]
        hold_id = place(other, target)["id"]
        try:
            wait_ui(page, lambda: "Held" in text_of(row_item(page, target)), "the row status re-read to Held (L404)")
            assert listed_codes(page) == codes, "rows are neither dropped nor reordered (L410)"
            assert accessible_name(page) == name and focus.evaluate(SCROLL_JS) == scroll, "focus and scroll stay (L410)"
            page.route("**/api/search**", gate)
            click(button(results(page), "Show more homes"))
            wait_ui(page, lambda: bool(gate.held), "page request in flight")
            gate.active = False
            check(chip_box(page, "Floors", "Floors 20-29"))
            wait_results(page, search(client(app_url), band=["10-19", "20-29"])["total"])
            said = text_of(notices(page))
            gate.open()
            advance(page, 500)
            assert len(listed_codes(page)) <= PAGE_SIZE, "the stale page appended nothing (L307)"
            assert text_of(notices(page)) == said and results(page).get_attribute("aria-busy") != "true", "unannounced (L307)"
        finally:
            release(other, hold_id)


def test_public_projection(app_url, meilisearch):
    probe = client(app_url)
    code = claim(probe, floor_pool(35, "EFG"))[0]
    s = buyer(app_url, "projection")
    h = place(s, code)
    try:
        token = share(s, h["id"])
        secrets = [s.email, s.name, h["id"], h["createdAt"], "quotedPrice"]
        u = unit(probe, code)
        assert set(u) == PUBLIC_KEYS and u["status"] == "held"
        t = probe.get("/api/tower")
        assert all(set(x) == TOWER_KEYS for x in t.json()["units"])
        found = search(s.c, q=code)
        assert found["hits"] and all(set(x) == PUBLIC_KEYS for x in found["hits"])
        shared = probe.get(f"/api/shared/{token}")
        body = shared.json()
        assert set(body) == {"unit", "endsAt"} and set(body["unit"]) == SHARED_KEYS and body["endsAt"] == h["endsAt"]
        for text in (json.dumps(u), t.text, json.dumps(found), shared.text):
            for secret in secrets:
                assert secret not in text, f"no holder identity, hold id, start time or quoted price (L37): {secret}"
        synced(probe, code)
        doc = meilisearch.document(INDEX, code)
        assert doc is not None and set(doc) == PUBLIC_KEYS - {"syncing", "viewUrl"}, f"search document keys (L987): {doc}"
        assert not any(secret in json.dumps(doc) for secret in secrets)
    finally:
        release(s, h["id"])


def test_tower_cells(app_url):
    c = client(app_url)
    body = c.get("/api/tower").json()
    assert set(body) == {"units", "assets"}
    units = body["units"]
    assert len(units) == TOTAL_UNITS
    assert [(u["floor"], u["stack"]) for u in units] == sorted((u["floor"], u["stack"]) for u in units), "ordered by floor then stack (L715)"
    assert {u["code"] for u in units} == {f"{f}{s}" for f in range(BOTTOM_FLOOR, TOP_FLOOR + 1) for s in STACKS}
    cells = {u["code"]: u for u in units}
    assert cells["5D"]["status"] == "withdrawn" and cells["12C"]["status"] == "reserved", "seeded states (L1038-L1039)"
    assets = body["assets"]
    assert set(assets) == {"shell", "plates", "facade", "ramp"} and set(assets["plates"]) == set(BANDS)
    shell = c.get(assets["shell"])
    assert shell.status_code == 200 and shell.headers["content-type"].startswith("model/gltf-binary") and shell.content[:4] == b"glTF"
    ramp = c.get(assets["ramp"])
    assert ramp.headers["content-type"].startswith("image/png") and ramp.content[:8] == PNG_SIGNATURE
    code = claim(c, floor_pool(35, "ABD"))[0]
    s = buyer(app_url, "tower")
    h = place(s, code)
    assert tower(c)[code]["status"] == "held", "tower reads live Postgres status (L38)"
    release(s, h["id"])
    assert tower(c)[code]["status"] == "available"


def test_lens_shows_unit(browser, app_url):
    c = client(app_url)
    photo = c.get(unit(c, "25C")["viewUrl"]).content
    bodies: list[bytes] = []
    with opened(browser, app_url, "/finder?bedrooms=3&band=20-29") as page:
        page.on("response", lambda r: bodies.append(r.body()) if "/media/" in r.url and r.status == 200 else None)
        wait_count(page)
        point(page, cell(page, "25C"))
        wait_ui(page, lambda: shown(lens_img(page, "25C")), "lens shows img 'View from 25C' (L194)")
        chip = expected_chip(tower(c)["25C"])
        assert chip.split(" · ")[0] in text_of(lens(page)) and "214° SW" in text_of(lens(page)), "chip names code and bearing (L320)"
        wait_ui(page, lambda: photo in bodies, "the lens fetched 25C's own photograph (L319)")
        current = row_item(page, "25C")
        wait_ui(page, lambda: current.get_attribute("aria-current") == "true" or row_button(page, "25C").get_attribute("aria-current") == "true",
                "the matching row becomes current (L321)")
        point(page, cell(page, "26C"))
        wait_ui(page, lambda: shown(lens_img(page, "26C")) and lens_img(page, "25C").count() == 0, "lens moved to 26C")
        page.mouse.move(2, 2)
        wait_ui(page, lambda: gone(lens(page)), "leaving the cells hides the lens (L323)")


def test_wf_sweep_lens_cell_states(browser, app_url):
    c = client(app_url)
    held_code = claim(c, ["22C"])[0]
    s = buyer(app_url, "cells")
    h = place(s, held_code)
    try:
        with opened(browser, app_url, "/finder?bedrooms=3") as page:
            wait_count(page)
            matching = set(search(c, bedrooms=["3"])["matchingCodes"])
            last: list[str | None] = [None]

            def ok() -> bool:
                last[0] = cells_mismatch(page, c, matching)
                return last[0] is None
            wait_ui(page, ok, f"every drawn cell matches the tower and filters (L315): {last[0]}")
            assert cell(page, "22D").get_attribute("aria-disabled") == "true", "dimmed cells are disabled (L192)"
            assert cell(page, "5D").get_attribute("aria-disabled") == "true"
            assert cell(page, held_code).get_attribute("aria-disabled") == "false"
            assert cell(page, "12C").get_attribute("aria-disabled") == "false", "reserved inside the filters is pinnable (L338)"
            point(page, cell(page, "22D"))
            wait_ui(page, lambda: "Outside your filters" in text_of(lens(page)), "lens says Outside your filters (L326)")
            assert lens(page).get_by_role("img").count() == 0
            point(page, cell(page, "5D"))
            wait_ui(page, lambda: "Withdrawn" in text_of(lens(page)) and lens(page).get_by_role("img").count() == 0, "withdrawn: chip only (L328)")
            point(page, cell(page, held_code))
            wait_ui(page, lambda: shown(lens_img(page, held_code)) and "Held" in text_of(lens(page)), "held cell keeps its view (L327)")
            point(page, cell(page, "12C"))
            wait_ui(page, lambda: shown(lens_img(page, "12C")) and "Reserved" in text_of(lens(page)), "reserved cell keeps its view")
            if tower(c)["37C"]["status"] == "unreleased":
                assert cell(page, "37C").get_attribute("aria-disabled") == "true"
            x, y = point(page, cell(page, "22D"))
            page.mouse.click(x, y)
            advance(page, 500)
            assert detail(page, "22D").count() == 0, "a dimmed cell cannot be pinned (L339)"
        assert tower(c)[held_code]["status"] == "held"
    finally:
        release(s, h["id"])


def test_bearing_consistent(browser, app_url, meilisearch):
    c = buyer(app_url, "bearing").c
    for stack, (bearing, facing, _, _) in STACKS.items():
        u = unit(c, f"25{stack}")
        assert (u["bearing"], u["facing"]) == (bearing, facing) == (bearing, facing_of(bearing)), f"stack {stack} (L1020, L860)"
        hit = next(h for h in search(c, q=f"25{stack}")["hits"] if h["code"] == f"25{stack}")
        assert (hit["bearing"], hit["facing"]) == (bearing, facing)
        doc = meilisearch.document(INDEX, f"25{stack}")
        assert doc and (doc["bearing"], doc["facing"]) == (bearing, facing)
    with opened(browser, app_url) as page:
        wait_count(page)
        point(page, cell(page, "25C"))
        wait_ui(page, lambda: "25C · 214° SW" in text_of(lens(page)), "lens chip reads the same bearing (L227)")


def test_pin_unit_address(browser, app_url):
    with opened(browser, app_url, "/finder?bedrooms=3&band=20-29") as page:
        wait_count(page)
        length = page.evaluate("history.length")
        x, y = center(cell(page, "27C"))
        page.mouse.click(x, y)
        wait_ui(page, lambda: shown(detail(page, "27C")), "dialog 'Home 27C' opened (L340)")
        assert parse_qs(urlsplit(page.url).query).get("unit") == ["27C"] and page.evaluate("history.length") == length
        assert bg_cell(page, "27C").get_attribute("aria-selected") == "true"
        wait_ui(page, lambda: shown(button(detail(page, "27C"), "Hold this home")), "the dialog content appears after the grow")
        click(button(detail(page, "27C"), "Close"))
        wait_ui(page, lambda: detail(page, "27C").count() == 0 and "unit" not in parse_qs(urlsplit(page.url).query), "Close removes unit= (L341)")
        assert (accessible_name(page) or "").startswith("27C · "), "focus returns to the cell (L341)"
        page.keyboard.press("Enter")
        wait_ui(page, lambda: shown(detail(page, "27C")), "Enter pins the focused cell")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: detail(page, "27C").count() == 0, "Escape closes the dialog")
        click(row_button(page, "26C"))
        wait_ui(page, lambda: shown(detail(page, "26C")), "a row click pins the home")
        click(button(detail(page, "26C"), "Close"))
        wait_ui(page, lambda: (accessible_name(page) or "").startswith("26C"), "focus returns to the row (L341)")
        page.goto(app_url + "/finder?unit=27C")
        wait_ui(page, lambda: shown(detail(page, "27C")), "opening the address opens the dialog (L342)")
        page.goto(app_url + "/finder?unit=5D")
        wait_ui(page, lambda: MSG["not_found"] in text_of(notices(page)), "unknown homes announce the 404 message (L342)")
        assert detail(page, "5D").count() == 0


def test_lens_motion_ranges(browser, app_url):
    step = MOTION_STEP_MS
    with opened(browser, app_url) as page:
        wait_count(page)
        for code in ("24C", "6C"):
            point(page, cell(page, code))
            wait_ui(page, lambda: shown(lens_img(page, code)), f"lens shows {code}")
        point(page, cell(page, "23C"))
        path = motion_full(lens(page), 300, samples=12)
        def lens_pos(s_: dict) -> float:
            return centre_x(s_) + centre_y(s_)

        lag, moved = settle_time(path, lens_pos, 1.0)
        span = abs(lens_pos(path[0]) - lens_pos(path[-1]))
        near, _ = settle_time(path, lens_pos, span * 0.1)
        assert moved and near <= LENS_LAG_MS[1] + step, f"lens reaches 90% of a long move within the lag band: {near} ms (L512)"
        assert lag >= LENS_LAG_MS[0] - step, f"lens does not arrive before the lag band: {lag} ms (L512)"
        wait_ui(page, lambda: shown(lens_img(page, "23C")), "lens on 23C")
        point(page, cell(page, "24C"))
        fade = crossfade_path(page, "23C", "24C", 400, samples=16)
        took, moved = settle_time(fade, lambda s_: motion_key(s_, "mix"), 0.0001)
        assert moved and CROSSFADE_MS[0] - step <= took <= CROSSFADE_MS[1] + step, f"crossfade {took} ms (L513)"
        x, y = center(cell(page, "24C"))
        page.mouse.click(x, y)
        took, moved = grow_path(page, "24C", 600, samples=24)
        assert moved and PIN_GROW_MS[0] - step <= took <= PIN_GROW_MS[1] + step, f"pin grow {took} ms (L514)"


def accessible_name_of(loc: Locator) -> str:
    snap = loc.first.aria_snapshot() if loc.count() else ""
    m = re.search(r'"([^"]*)"', snap)
    return m.group(1) if m else ""


def test_wf_sweep_lens_matches_server(browser, app_url):
    c = client(app_url)
    code = claim(c, ["21C"])[0]
    first, second = buyer(app_url, "reread-a"), buyer(app_url, "reread-b")
    with opened(browser, app_url, f"/finder?q={code}") as page:
        wait_count(page)
        h = place(first, code)
        wait_ui(page, lambda: "· Held" in accessible_name_of(cell(page, code)) and "Held" in text_of(row_item(page, code)),
                "the interval re-read shows Held (L404)", max_page_ms=REREAD_MS * 2)
        release(first, h["id"])
        page.evaluate(FOCUS_EVENT_JS)
        wait_ui(page, lambda: "· Available" in accessible_name_of(cell(page, code)), "a focus re-read shows Available (L404)", max_page_ms=1000)
        x, y = center(cell(page, code))
        page.mouse.click(x, y)
        wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
        h2 = place(second, code)
        try:
            wait_ui(page, lambda: "Held" in text_of(detail(page, code)) and disabled(button(detail(page, code), "Hold this home")),
                    "the open detail reads Held with Hold this home disabled (L343, L411)", max_page_ms=REREAD_MS * 2)
            cells_match(page, c, set(search(c, q=code)["matchingCodes"]))
        finally:
            release(second, h2["id"])


def test_wf_sweep_lens_context_loss(browser, app_url):
    c = client(app_url)
    code = claim(c, ["18C"])[0]
    with opened(browser, app_url, init_script=GL_CAPTURE_JS) as page:
        wait_count(page)
        cell(page, code).focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
        assert page.evaluate(LOSE_JS) >= 1, "the tower drew with WebGL"
        wait_ui(page, lambda: C_CONTEXT_LOST in text_of(notices(page)), "context-loss notice within 1 s (L419)", max_page_ms=CONTEXT_LOSS_MS)
        assert shown(detail(page, code)), "the open detail stays (L421)"
        assert gone(button(page, "Turn left")) and gone(button(page, "Turn right")), "turn buttons hidden (L422)"
        page.keyboard.press("Escape")
        wait_ui(page, lambda: (accessible_name(page) or "").startswith(f"{code} · "), "focus is back on the same unit (L420)")
        names = grid_names(page)
        assert all(any(n.startswith(f"18{s} · ") for n in names) for s in STACKS), "the floor grid shows every stack (L175)"
        cells_match(page, c, set(search(c)["matchingCodes"]) or None)


def test_wf_sweep_lens_newest_view(browser, app_url):
    c, m = client(app_url), coordinator(app_url)
    first, second = "16C", "17C"
    first_photo = c.get(unit(c, first)["viewUrl"]).content
    media_gate = Gate(lambda req: "/media/" in req.url, fetch=True, once=True)
    media_gate.active = False
    with opened(browser, app_url, before=lambda p: p.route("**/media/**", media_gate)) as page:
        wait_count(page)
        wait_ui(page, lambda: len(grid_names(page)) > 0, "tower cells drawn before the lens moves")
        page.wait_for_load_state("networkidle")
        media_gate.active = True
        point(page, cell(page, first))
        wait_ui(page, lambda: bool(media_gate.held), "the first unit's photograph is in flight")
        assert media_gate.held[0][1].body() == first_photo, "the held request is the first unit's view photograph, not a tower asset"
        point(page, cell(page, second))
        wait_ui(page, lambda: shown(lens_img(page, second)), "lens shows the second unit")
        media_gate.open()
        for _ in range(10):
            advance(page, STEP_MS)
            assert lens_img(page, first).count() == 0, "the late photograph is never shown (L334)"
            assert f"{second} · " in text_of(lens(page)) and f"{first} · " not in text_of(lens(page))
        x, y = center(cell(page, second))
        page.mouse.click(x, y)
        wait_ui(page, lambda: shown(detail(page, second)), "detail opened")
        unit_gate = Gate(lambda req: urlsplit(req.url).path == f"/api/units/{second}", fetch=True, once=True)
        page.route(lambda url: urlsplit(url).path == f"/api/units/{second}", unit_gate)
        wait_ui(page, lambda: bool(unit_gate.held), "a re-read of the open unit was captured", max_page_ms=REREAD_MS * 3)
        unit_gate.active = False
        old = unit(c, second)["price"]
        new = set_price(m, second, old + PRICE_STEP)["price"]
        wait_ui(page, lambda: money(new) in text_of(detail(page, second)), "the newer read shows the new price", max_page_ms=REREAD_MS * 3)
        unit_gate.open()
        advance(page, 500)
        assert money(new) in text_of(detail(page, second)) and money(old) not in text_of(detail(page, second)), "price version never goes back (L335)"


def test_accounts_no_enumeration(app_url):
    name, email = ident("enum")
    with client(app_url) as c:
        first = c.post("/api/accounts", json={"name": name, "email": email, "password": PASSWORD})
        again = c.post("/api/accounts", json={"name": "Someone Else", "email": email, "password": PASSWORD + "-other"})
        ana = c.post("/api/accounts", json={"name": "Not Ana", "email": ANA_EMAIL, "password": PASSWORD})
        for r in (first, again, ana):
            assert r.status_code == 202 and r.json() == {"message": ACCOUNT_MSG}, f"identical 202 (L719): {r.text}"
        assert c.post("/api/session", json={"email": email, "password": PASSWORD + "-other"}).status_code == 401, "account unchanged"
        account = sign_in(app_url, ANA_EMAIL, ANA_PASSWORD).c.get("/api/session").json()["account"]
        assert account["name"] == ANA_NAME, "existing account unchanged (L44)"
        expect_error(c.post("/api/accounts", json={"name": " ", "email": email, "password": PASSWORD}), 422, "invalid", field=("name", F_NAME))
        expect_error(c.post("/api/accounts", json={"name": name, "email": "nope", "password": PASSWORD}), 422, "invalid", field=("email", F_EMAIL))
        expect_error(c.post("/api/accounts", json={"name": name, "email": email, "password": "short"}), 422, "invalid", field=("password", F_PASSWORD))


@pytest.mark.timeout(300)
def test_sign_in(app_url):
    base = outage("APP_SHORT_SESSION_URL")
    p = buyer(base, "session")
    with client(base) as c:
        r = c.post("/api/session", json={"email": p.email, "password": PASSWORD})
        started = time.monotonic()
        assert r.status_code == 200 and set(r.json()["account"]) == ACCOUNT_KEYS and r.json()["account"]["role"] == "buyer"
        raw = r.headers.get("set-cookie", "")
        low = raw.lower()
        assert "hw_session" in raw and all(flag.lower() in low for flag in ("HttpOnly", "SameSite=Lax", "Path=/")), raw
        assert c.get("/api/session").status_code == 200
        wrong = c.post("/api/session", json={"email": p.email, "password": "Wrong-Password-9"})
        unknown = c.post("/api/session", json={"email": ident("ghost")[1], "password": "Wrong-Password-9"})
        assert (wrong.status_code, wrong.json()) == (unknown.status_code, unknown.json())
        expect_error(wrong, 401, "sign_in_failed")
        expect_error(c.post("/api/session", json={"email": p.email}), 422, "invalid")
        assert coordinator(base).c.get("/api/session").json()["account"]["role"] == "coordinator"
        poll(lambda: c.get("/api/session").status_code, lambda s_: s_ == 401, "the session expires (L812)", SHORT_SESSION_S + LATE_SLACK_S)
        assert time.monotonic() - started >= SHORT_SESSION_S - CLOCK_SLACK_S, "not before SESSION_SECONDS (L812)"


def test_sign_in_to_hold(browser, app_url):
    name, email = ident("to-hold")
    with opened(browser, app_url, "/finder?bedrooms=3&unit=27C") as page:
        wait_ui(page, lambda: shown(detail(page, "27C")), "detail opened")
        price = unit(client(app_url), "27C")["price"]
        click(button(detail(page, "27C"), "Hold this home"))
        dialog = page.get_by_role("dialog", name="Sign in to hold", exact=True)
        wait_ui(page, lambda: shown(dialog), "dialog 'Sign in to hold' (L371)")
        click(button(dialog, "Create an account"))
        create = page.get_by_role("dialog", name="Create an account", exact=True)
        wait_ui(page, lambda: shown(create), "create mode (L372)")
        fill(create.get_by_role("textbox", name="Name", exact=True), name)
        fill(create.get_by_role("textbox", name="Email", exact=True), email)
        fill(create.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(button(create, "Create account"))
        wait_ui(page, lambda: shown(page.get_by_role("dialog", name=re.compile("^Sign in")))
                and page.get_by_role("textbox", name="Email", exact=True).input_value() == email, "back in sign-in with email filled (L372)")
        signin = page.get_by_role("dialog", name=re.compile("^Sign in"))
        fill(signin.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(button(signin, "Sign in"))
        wait_ui(page, lambda: shown(confirm(page)), "Confirm hold opens for the same home (L375)")
        assert f"Hold 27C at {money(price)}?" in text_of(confirm(page))
        assert parse_qs(urlsplit(page.url).query) == {"bedrooms": ["3"], "unit": ["27C"]}
        click(button(confirm(page), "Cancel"))
    holds = sign_in(app_url, email, PASSWORD).c.get("/api/holds").json()["holds"]
    assert holds == [], "no hold until the buyer confirms"


def test_place_hold_api(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(3))[0]
    p = buyer(app_url, "place")
    u = unit(c, code)
    r = hold(p, code)
    assert r.status_code == 201, r.text
    h = r.json()["hold"]
    try:
        assert set(h) == HOLD_KEYS and h["status"] == "active" and h["endedBy"] is None and h["endedAt"] is None and h["shareUrl"] is None
        assert (h["quotedPrice"], h["priceVersion"]) == (u["price"], u["priceVersion"])
        assert (ts(h["endsAt"]) - ts(h["createdAt"])).total_seconds() == HOLD_SECONDS, "endsAt = createdAt + HOLD_SECONDS (L791)"
        assert abs((ts(h["createdAt"]) - server_now(r)).total_seconds()) <= CLOCK_SLACK_S, "set by the app clock"
        assert unit(c, code)["status"] == "held" and tower(c)[code]["status"] == "held"
        assert p.c.get("/api/holds").json()["holds"][0]["id"] == h["id"]
        assert get_hold(p, h["id"]) == h
        console = coordinator(app_url).c.get("/api/console/holds").json()["holds"]
        assert any(x["id"] == h["id"] and x["buyerEmail"] == p.email for x in console)
        expect_error(hold(buyer(app_url, "reserved"), "12C"), 409, "unit_reserved")
    finally:
        release(p, h["id"])


def test_wf_place_hold_confirmation(browser, app_url):
    c = client(app_url)
    code = claim(c, face_pool(5))[0]
    p = buyer(app_url, "confirm")
    try:
        with opened(browser, app_url, f"/finder?q={code}&unit={code}", cookie=p.cookie) as page:
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: shown(confirm(page)), "Confirm hold opened")
            text = text_of(confirm(page))
            assert f"Hold {code} at {money(unit(c, code)['price'])}?" in text and C_NO_PAYMENT in text, "confirm copy (L200)"
            click(button(confirm(page), "Confirm hold"))
            heading = detail(page, code).get_by_role("heading", name=C_CONFIRMED, level=2)
            wait_ui(page, lambda: shown(heading), "confirmation heading (L551)")
            h = p.c.get("/api/holds").json()["holds"][0]
            assert f"Held until {office(h['endsAt'])}." in text_of(detail(page, code)), "end time in sales-office time (L551)"
            wait_ui(page, lambda: "Held by you" in bg_name(bg_cell(page, code)) and "Held by you" in text_of(bg_row_item(page, code)),
                    "cell and row read Held by you (L386)")
            assert shown(page.get_by_role("link", name="My hold", exact=True, include_hidden=True)) and button(detail(page, code), "Hold this home").count() == 0
            click(page.get_by_role("link", name="Open your hold", exact=True))
            wait_ui(page, lambda: urlsplit(page.url).path == f"/holds/{h['id']}", "Open your hold opens the hold page")
        assert tower(c)[code]["status"] == "held"
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            release(p, x["id"])


def test_wf_place_hold_keyboard(browser, app_url):
    c = client(app_url)
    code = claim(c, ["15C"])[0]
    p = buyer(app_url, "keyboard")
    try:
        with opened(browser, app_url, cookie=p.cookie) as page:
            wait_count(page)
            tab_until(page, lambda: re.match(r"^\d{1,2}[A-H] · ", accessible_name(page) or "") is not None, "the tower grid")
            for _ in range(TOP_FLOOR - BOTTOM_FLOOR + 2):
                page.keyboard.press("ArrowUp")
            floor, stack = focused_code(page)
            assert floor == TOP_FLOOR, "Up stops at floor 38 (L348)"
            for expected in range(TOP_FLOOR - 1, 14, -1):
                page.keyboard.press("ArrowDown")
                assert focused_code(page)[0] == expected, "Down moves one floor"
            letters = list(STACKS)

            def right() -> None:
                before = focused_code(page)
                page.keyboard.press("ArrowRight")
                def moved() -> bool:
                    m = re.match(r"^(\d{1,2})([A-H]) · ", accessible_name(page) or "")
                    return m is not None and (int(m.group(1)), m.group(2)) != before

                wait_ui(page, moved, "ArrowRight moved focus (L349, L350)")

            right()
            step = (letters.index(focused_code(page)[1]) - letters.index(stack)) % 8
            assert step in (1, 7), "Right moves one stack"
            for _ in range(7):
                right()
            assert focused_code(page)[1] == stack, "stacks wrap between H and A (L349)"
            while focused_code(page)[1] != "C":
                right()
            assert focused_code(page) == (15, "C")
            wait_ui(page, lambda: "15C · " in text_of(lens(page)), "the lens follows focus (L351)")
            page.keyboard.press("Enter")
            dialog = detail(page, code)
            wait_ui(page, lambda: shown(dialog), "Enter pins the cell")
            wait_ui(page, lambda: shown(button(dialog, "Hold this home")), "the dialog content appears after the grow")
            tab_until(page, lambda: accessible_name(page) == "Hold this home", "Hold this home", inside=dialog)
            page.keyboard.press("Enter")
            wait_ui(page, lambda: shown(confirm(page)), "Confirm hold opened")
            for _ in range(6):
                page.keyboard.press("Tab")
                assert confirm(page).evaluate("el => el.contains(document.activeElement)"), "Tab wraps in the confirm dialog (L352)"
            tab_until(page, lambda: accessible_name(page) == "Confirm hold", "Confirm hold", inside=confirm(page))
            page.keyboard.press("Enter")
            wait_ui(page, lambda: accessible_name(page) == C_CONFIRMED, "focus on the confirmation heading (L358)")
            page.keyboard.press("Escape")
            wait_ui(page, lambda: (accessible_name(page) or "").startswith(f"{code} · "), "Escape returns to the cell (L359)")
        assert any(h["unitCode"] == code and h["status"] == "active" for h in p.c.get("/api/holds").json()["holds"])
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            release(p, x["id"])


@pytest.mark.timeout(300)
def test_wf_place_hold_session_resume(browser):
    base = outage("APP_SHORT_SESSION_URL")
    code = claim(client(base), ["20C", "20B", "20D"])[0]
    p = buyer(base, "resume")
    token = p.cookie

    def server_session() -> int:
        return httpx.get(f"{base}/api/session", headers={"Cookie": f"hw_session={token}"}, timeout=10).status_code

    with opened(browser, base, f"/finder?unit={code}", cookie=token) as page:
        wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
        click(button(detail(page, code), "Hold this home"))
        wait_ui(page, lambda: shown(confirm(page)), "Confirm hold opened")
        poll(server_session, lambda s_: s_ == 401, "the session expired (L812)", SHORT_SESSION_S + LATE_SLACK_S)
        posted: list[int] = []
        page.on("response", lambda r: posted.append(r.status) if r.request.method == "POST" and "/api/holds" in r.url else None)
        click(button(confirm(page), "Confirm hold"))
        dialog = page.get_by_role("dialog", name="Sign in to hold", exact=True)
        try:
            wait_ui(page, lambda: shown(dialog), "401 opens 'Sign in to hold' (L398)")
        except pytest.fail.Exception:
            pytest.fail(f"401 opens 'Sign in to hold' (L398); POST /api/holds answered {posted}; the server now answers "
                        f"GET /api/session with {server_session()}; the confirm dialog reads {text_of(confirm(page))!r}")
        assert dialog.get_by_role("textbox", name="Email", exact=True).input_value() == p.email
        assert accessible_name(page) == "Password", "focus on Password (L398)"
        assert bg_detail(page, code).count() > 0 and parse_qs(urlsplit(page.url).query).get("unit") == [code]
        fill(dialog.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(button(dialog, "Sign in"))
        wait_ui(page, lambda: shown(confirm(page)) and accessible_name(page) == "Confirm hold", "the same confirmation reopens (L400)")
        fresh = sign_in(base, p.email, PASSWORD)
        assert not [h for h in fresh.c.get("/api/holds").json()["holds"] if h["status"] == "active"], "no hold until confirmed (L400)"
        click(button(confirm(page), "Confirm hold"))
        wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_CONFIRMED)), "the hold was confirmed")
    holds = sign_in(base, p.email, PASSWORD)
    active = [h for h in holds.c.get("/api/holds").json()["holds"] if h["status"] == "active"]
    assert [h["unitCode"] for h in active] == [code]
    release(holds, active[0]["id"])


def test_wf_place_hold_landing_routes(browser, app_url):
    code = claim(client(app_url), floor_pool(27))[0]
    p = buyer(app_url, "routes")
    h = place(p, code)
    try:
        with opened(browser, app_url, "/finder?bedrooms=3") as page:
            wait_count(page)
            page.evaluate("() => { window.__hwSameDocument = true; }")
            click(button(page, "Sign in"))
            dialog = page.get_by_role("dialog", name="Sign in", exact=True)
            for email, password in ((p.email, "Wrong-Password-9"), (ident("ghost")[1], "Wrong-Password-9")):
                ui_sign_in(page, "Sign in", email, password)
                wait_ui(page, lambda: MSG["sign_in_failed"] in text_of(dialog), "identical failure message (L549)")
            ui_sign_in(page, "Sign in", p.email, PASSWORD)
            wait_ui(page, lambda: dialog.count() == 0 and "Signed in." in text_of(notices(page)), "Signed in. (L549)")
            assert urlsplit(page.url).query == "bedrooms=3" and page.evaluate("() => window.__hwSameDocument === true")
            click(page.get_by_role("link", name="My hold", exact=True))
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=f"Your hold on {code}", level=1)), "hold page")
            click(button(page, "Sign out"))
            wait_ui(page, lambda: urlsplit(page.url).path == "/finder" and "Signed out." in text_of(notices(page)), "sign-out lands on /finder (L379)")
            page.goto(app_url + f"/holds/{h['id']}")
            ui_sign_in(page, "Sign in", p.email, PASSWORD)
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=f"Your hold on {code}", level=1)), "hold loads in place (L377)")
            assert urlsplit(page.url).path == f"/holds/{h['id']}"
            click(button(page, "Sign out"))
            wait_ui(page, lambda: urlsplit(page.url).path == "/finder", "sign-out lands on /finder")
            click(button(page, "Sign in"))
            ui_sign_in(page, "Sign in", MIRA_EMAIL, MIRA_PASSWORD)
            wait_ui(page, lambda: urlsplit(page.url).path == "/console", "a coordinator lands on /console (L376)")
            click(button(page, "Sign out"))
            wait_ui(page, lambda: urlsplit(page.url).path == "/finder", "console sign-out lands on /finder")
            page.goto(app_url + "/console")
            wait_ui(page, lambda: shown(page.get_by_role("dialog", name="Sign in", exact=True)), "protected page asks for sign-in (L377)")
            page.keyboard.press("Escape")
            wait_ui(page, lambda: page.get_by_role("dialog", name="Sign in", exact=True).count() == 0 and shown(button(page, "Sign in")), "Escape leaves the header Sign in")
        with opened(browser, app_url, "/console", cookie=p.cookie) as page:
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_REFUSED, level=1)) and shown(page.get_by_role("link", name="Open the finder")), "buyer refusal (L209)")
    finally:
        release(p, h["id"])


def test_one_hold_per_buyer(app_url):
    c = client(app_url)
    x1, x2, x3, x4 = claim(c, floor_pool(4), 4)
    b, d = buyer(app_url, "limit-a"), buyer(app_url, "limit-b")
    h = place(b, x1)
    try:
        expect_error(hold(b, x2), 409, "hold_limit")
        assert unit(c, x2)["status"] == "available"
        rs = together([call(d, "POST", "/api/holds", json={"unitCode": x, "priceVersion": unit(c, x)["priceVersion"]}) for x in (x3, x4)])
        assert sorted(r.status_code for r in rs) == [201, 409], [r.text for r in rs]
        expect_error(next(r for r in rs if r.status_code == 409), 409, "hold_limit")
        assert len([x for x in d.c.get("/api/holds").json()["holds"] if x["status"] == "active"]) == 1
    finally:
        release(b, h["id"])
        for x in d.c.get("/api/holds").json()["holds"]:
            release(d, x["id"])


@pytest.mark.timeout(300)
def test_hold_attempt_limit(browser):
    base = outage("APP_SHORT_URL")
    code = claim(client(base), face_pool(5))[0]
    p = buyer(base, "attempts")
    for _ in range(3):
        expect_error(p.c.post("/api/holds", json={"unitCode": "5D"}), 404, "not_found")
    r = p.c.post("/api/holds", json={"unitCode": "5D"})
    retry = int(r.headers["retry-after"])
    assert 1 <= retry <= SHORT_WINDOW_S
    expect_error(r, 429, "hold_attempts", message=ATTEMPTS_MSG.format(s=retry))
    with opened(browser, base, f"/finder?unit={code}", cookie=p.cookie) as page:
        wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
        click(button(detail(page, code), "Hold this home"))
        wait_ui(page, lambda: shown(confirm(page)), "confirm opened")
        click(button(confirm(page), "Confirm hold"))
        wait_ui(page, lambda: "Too many hold attempts." in text_of(confirm(page)), "429 message in the confirm dialog (L394)")
        shown_s = int(re.search(r"Try again in (\d+) seconds\.", text_of(confirm(page))).group(1))
        assert disabled(button(confirm(page), "Confirm hold"))
        if shown_s > 1:
            advance(page, 1000)
            assert f"Try again in {shown_s - 1} seconds." in text_of(confirm(page)), "counts down once a second (L394)"
        advance(page, (shown_s + 1) * 1000)
        assert not disabled(button(confirm(page), "Confirm hold")), "enabled again at zero (L394)"
    assert tower(client(base))[code]["status"] == "available"
    wait_real_duration(int(p.c.post("/api/holds", json={"unitCode": "5D"}).headers.get("retry-after", "1")))
    assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 404, "an attempt after Retry-After is counted again (L829)"


def test_idempotent_replay(app_url):
    c = client(app_url)
    x, y = claim(c, floor_pool(6), 2)
    p, q = buyer(app_url, "replay-a"), buyer(app_url, "replay-b")
    key = idempotency_key()
    first = hold(p, x, key=key)
    assert first.status_code == 201, first.text
    h = first.json()["hold"]
    other = None
    try:
        for _ in range(4):
            r = hold(p, x, key=key, version=h["priceVersion"])
            assert r.status_code == 201 and r.json() == first.json(), "stored response replayed (L834)"
        assert len(p.c.get("/api/holds").json()["holds"]) == 1
        for _ in range(2):
            assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 404, "replays did not count as attempts (L828)"
        expect_error(hold(p, y, key=key), 409, "idempotency_key_reused")
        assert unit(c, y)["status"] == "available"
        r = hold(q, y, key=key)
        assert r.status_code == 201 and r.json()["hold"]["unitCode"] == y, "keys belong to one buyer (L832)"
        other = r.json()["hold"]
    finally:
        release(p, h["id"])
        if other:
            release(q, other["id"])


def test_one_winner_per_home(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(7))[0]
    buyers = [buyer(app_url, f"race-{i}") for i in range(6)]
    v = unit(c, code)["priceVersion"]
    rs = together([call(b, "POST", "/api/holds", json={"unitCode": code, "priceVersion": v}) for b in buyers])
    winners = [i for i, r in enumerate(rs) if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in rs]
    for r in rs:
        if r.status_code != 201:
            expect_error(r, 409, "unit_unavailable")
    holds = [h for h in coordinator(app_url).c.get("/api/console/holds").json()["holds"] if h["unitCode"] == code]
    assert len(holds) == 1
    release(buyers[winners[0]], rs[winners[0]].json()["hold"]["id"])


def test_wf_hold_race_lost_cell_held(browser, app_url):
    c = client(app_url)
    code = claim(c, face_pool(8))[0]
    a, b = buyer(app_url, "lose-a"), buyer(app_url, "lose-b")
    hb = None
    try:
        with opened(browser, app_url, f"/finder?q={code}&unit={code}", cookie=a.cookie) as page:
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: shown(confirm(page)), "confirm opened")
            hb = place(b, code)
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: MSG["unit_unavailable"] in text_of(confirm(page)), "conflict message (L388)", max_page_ms=CONTEXT_LOSS_MS)
            wait_ui(page, lambda: re.search(r" · Held(?! by you)", bg_name(bg_cell(page, code))) is not None
                    and "Held" in text_of(bg_row_item(page, code)) and "Held by you" not in page_text(page),
                    "cell and row read Held at once (L389)", max_page_ms=REREAD_MS // 2)
            assert disabled(bg_detail(page, code).get_by_role("button", name="Hold this home", exact=True, include_hidden=True))
            advance(page, REREAD_MS + 1000)
            assert "Available" not in bg_name(bg_cell(page, code)), "the re-read never flips it back (L391)"
        assert get_hold(b, hb["id"])["status"] == "active" and a.c.get("/api/holds").json()["holds"] == []
    finally:
        if hb:
            release(b, hb["id"])


def test_wf_hold_race_no_early_mine(browser, app_url):
    c = client(app_url)
    code = claim(c, face_pool(9))[0]
    p = buyer(app_url, "early")
    gate = Gate(lambda req: req.method == "POST" and urlsplit(req.url).path == "/api/holds")
    try:
        with opened(browser, app_url, f"/finder?band=03-09&unit={code}", cookie=p.cookie, before=lambda pg: pg.route("**/api/holds", gate)) as page:
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: shown(confirm(page)), "confirm opened")
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: bool(gate.held), "hold request in flight")
            assert disabled(button(confirm(page), "Holding...")), "Holding... and disabled (L551)"
            for _ in range(3):
                assert "Held by you" not in page_text(page) and page.get_by_role("link", name="My hold").count() == 0, "nothing claims the home early (L385)"
                advance(page, REREAD_MS // 2)
            gate.open()
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_CONFIRMED)) and "Held by you" in bg_name(bg_cell(page, code)), "Held by you after the 201")
        assert tower(c)[code]["status"] == "held"
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            release(p, x["id"])


def test_wf_hold_race_lost_reply_replays(browser, app_url):
    c = client(app_url)
    code = claim(c, face_pool(10))[0]
    p = buyer(app_url, "lost-reply")
    seen: list[tuple[str, str]] = []
    first: list[Any] = []

    def handler(route: Route) -> None:
        req = route.request
        if req.method != "POST":
            route.fallback()
            return
        seen.append((req.headers.get("idempotency-key", ""), req.post_data or ""))
        if not first:
            first.append(route.fetch())
            route.abort("failed")
        else:
            route.continue_()
    try:
        with opened(browser, app_url, f"/finder?unit={code}", cookie=p.cookie, before=lambda pg: pg.route("**/api/holds", handler)) as page:
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: shown(confirm(page)), "confirm opened")
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: C_LOST_REPLY in text_of(confirm(page)), "lost-reply copy (L551)")
            assert first[0].status == 201 and not disabled(button(confirm(page), "Confirm hold"))
            assert "Held by you" not in page_text(page)
            click(button(confirm(page), "Confirm hold"))
            original = json.loads(first[0].text())["hold"]
            wait_ui(page, lambda: f"Held until {office(original['endsAt'])}." in text_of(detail(page, code)), "the original hold is shown (L395)")
        assert len(seen) == 2 and seen[0] == seen[1] and seen[0][0], "same Idempotency-Key and body resent (L395)"
        assert [h["id"] for h in p.c.get("/api/holds").json()["holds"]] == [original["id"]], "one hold"
        for _ in range(2):
            assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 404
        assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 429, "the retry used one attempt (L18)"
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            release(p, x["id"])


def test_idempotency_concurrent_same_key(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(11))[0]
    p = buyer(app_url, "same-key")
    key = idempotency_key()
    v = unit(c, code)["priceVersion"]
    rs = together([call(p, "POST", "/api/holds", json={"unitCode": code, "priceVersion": v}, headers={"Idempotency-Key": key}) for _ in range(5)])
    statuses = {r.status_code for r in rs}
    bodies = {json.dumps(r.json(), sort_keys=True) for r in rs}
    assert statuses == {201} and len(bodies) == 1, f"identical stored response (L835): {statuses}"
    h = rs[0].json()["hold"]
    assert len(p.c.get("/api/holds").json()["holds"]) == 1
    release(p, h["id"])
    replay = hold(p, code, key=key, version=v)
    assert replay.status_code == 201 and replay.json() == rs[0].json() and replay.json()["hold"]["status"] == "active", "replayed after the hold ended (L834)"
    for _ in range(2):
        assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 404
    assert p.c.post("/api/holds", json={"unitCode": "5D"}).status_code == 429, "the burst counted as one attempt (L835)"
    q = buyer(app_url, "bad-key")
    for bad in ("", "k" * 101, "has space"):
        expect_error(hold(q, code, key=bad, version=v), 422, "invalid", field=("idempotencyKey", F_KEY))
    r = q.c.post("/api/holds", json={"unitCode": "5D"})
    expect_error(r, 429, "hold_attempts", message=ATTEMPTS_MSG.format(s=r.headers.get("retry-after")))
    b = buyer(app_url, "bad-key-order")
    expect_error(b.c.post("/api/holds", json={"unitCode": "5D", "priceVersion": 1}, headers={"Idempotency-Key": "has space"}),
                 404, "not_found")


@pytest.mark.timeout(600)
def test_hold_cooldown(app_url):
    base = outage("APP_SHORT_URL")
    probe = client(base)
    x, y = claim(probe, floor_pool(7), 2)
    a, b, d = buyer(base, "cool-a"), buyer(base, "cool-b"), buyer(base, "cool-c")
    first = place(a, x)
    ended_at = ts(release(a, first["id"]).json()["hold"]["endedAt"])
    expect_error(hold(a, x), 409, "hold_cooldown", message=COOLDOWN_MSG.format(when=office(ended_at + timedelta(seconds=SHORT_COOLDOWN_S))))
    other = place(b, x)
    release(b, other["id"])
    lapsing = place(d, y)
    wait_until_server(probe, ended_at + timedelta(seconds=SHORT_COOLDOWN_S))
    again = place(a, x)
    release(a, again["id"])
    lapsed = get_hold(d, lapsing["id"])
    assert lapsed["status"] == "lapsed"
    expect_error(hold(d, y), 409, "hold_cooldown",
                 message=COOLDOWN_MSG.format(when=office(ts(lapsed["endedAt"]) + timedelta(seconds=SHORT_COOLDOWN_S))))
    late = outage("APP_DST_LATE_URL")
    z = claim(client(late), floor_pool(20))[0]
    e = buyer(late, "cool-dst")
    h = place(e, z)
    ended = ts(release(e, h["id"]).json()["hold"]["endedAt"])
    when = office(ended + timedelta(seconds=COOLDOWN_SECONDS))
    assert when.endswith("AEST")
    expect_error(hold(e, z), 409, "hold_cooldown", message=COOLDOWN_MSG.format(when=when))


SEARCH_LIMIT_MAIN = 240


def test_cross_instance_state(app_url):
    other_base = outage("APP_STORAGE_DOWN_URL")
    p = buyer(app_url, "instances")
    there = httpx.Client(base_url=other_base, timeout=HTTP_TIMEOUT, cookies={"hw_session": p.cookie}, headers={"X-Forwarded-For": probe_ip()})
    assert there.get("/api/session").status_code == 200, "a session works on another instance (L899)"
    p.c.post("/api/holds", json={"unitCode": "5D"})
    there.post("/api/holds", json={"unitCode": "5D"})
    p.c.post("/api/holds", json={"unitCode": "5D"})
    assert there.post("/api/holds", json={"unitCode": "5D"}).status_code == 429, "attempts add up across instances"
    code = claim(client(app_url), floor_pool(13))[0]
    q = buyer(app_url, "instances-key")
    key = idempotency_key()
    first = hold(q, code, key=key)
    assert first.status_code == 201
    try:
        q_there = httpx.Client(base_url=other_base, timeout=HTTP_TIMEOUT, cookies={"hw_session": q.cookie})
        replay = q_there.post("/api/holds", json={"unitCode": code, "priceVersion": first.json()["hold"]["priceVersion"]}, headers={"Idempotency-Key": key})
        assert replay.status_code == 201 and replay.json() == first.json(), "replays cross instances"
    finally:
        release(q, first.json()["hold"]["id"])
    ip = probe_ip()
    clients = [client(app_url, ip), client(other_base, ip)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda i: clients[i % 2].get("/api/search").status_code, range(SEARCH_LIMIT_MAIN)))
    assert all(s == 200 for s in codes), "the first SEARCH_RATE_LIMIT searches are served"
    over = clients[1].get("/api/search")
    expect_error(over, 429, "search_rate_limited", message=SEARCH_LIMIT_MSG.format(s=over.headers.get("retry-after")))
    assert clients[0].get("/api/search").status_code == 429, "search counts add up across instances"


def test_hold_page_contents(browser, app_url):
    code = claim(client(app_url), floor_pool(14, "ABDEF"))[0]
    p = buyer(app_url, "hold-page")
    h = place(p, code)
    with opened(browser, app_url, f"/holds/{h['id']}", cookie=p.cookie) as page:
        heading = page.get_by_role("heading", name=f"Your hold on {code}", level=1)
        wait_ui(page, lambda: shown(heading), "hold heading (L202)")
        text = page_text(page)
        for part in (f"Quoted price {money(h['quotedPrice'])}", f"Price version {h['priceVersion']}", f"Held until {office(h['endsAt'])}."):
            assert part in text, f"{part!r} on the hold page (L202)"
        timer = page.get_by_role("timer")
        m = re.fullmatch(r"(\d{2,}):(\d{2}):(\d{2})", text_of(timer).strip())
        assert m, f"timer reads hh:mm:ss (L215): {text_of(timer)!r}"
        left = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        assert HOLD_SECONDS - POLL_SECONDS * 4 <= left <= HOLD_SECONDS
        assert shown(button(page, "Create share link"))
        click(button(page, "Release hold"))
        dialog = page.get_by_role("alertdialog", name="Release this hold?", exact=True)
        wait_ui(page, lambda: shown(dialog), "release confirmation (L434)")
        click(button(dialog, "Release"))
        wait_ui(page, lambda: "Hold released." in text_of(notices(page)), "Hold released. (L553)")
    released = get_hold(p, h["id"])
    assert (released["status"], released["endedBy"]) == ("released", "buyer")


def test_private_holds(browser, app_url):
    code = claim(client(app_url), floor_pool(15, "ABDEF"))[0]
    owner, other = buyer(app_url, "owner"), buyer(app_url, "intruder")
    h = place(owner, code)
    try:
        ghost = uuid.uuid4()
        for method, suffix in (("GET", ""), ("POST", "/release"), ("POST", "/share"), ("DELETE", "/share")):
            kw = {"json": {}} if method == "POST" else {}
            mine = other.c.request(method, f"/api/holds/{h['id']}{suffix}", **kw)
            none = other.c.request(method, f"/api/holds/{ghost}{suffix}", **kw)
            assert (mine.status_code, mine.json()) == (none.status_code, none.json()), f"{method} {suffix} identical (L743)"
            expect_error(mine, 404, "not_found")
        assert get_hold(owner, h["id"]) == h, "nothing changed"
        for hold_id in (h["id"], ghost):
            with opened(browser, app_url, f"/holds/{hold_id}", cookie=other.cookie) as page:
                wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_HOLD_NOT_FOUND)), "not-found heading (L555)")
                assert code not in page_text(page)
    finally:
        release(owner, h["id"])


def test_quoted_price_snapshot(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(16, "ABDEF"))[0]
    p, m = buyer(app_url, "snapshot"), coordinator(app_url)
    h = place(p, code)
    try:
        saved = set_price(m, code, h["quotedPrice"] + PRICE_STEP)
        assert saved["priceVersion"] == h["priceVersion"] + 1
        again = get_hold(p, h["id"])
        assert (again["quotedPrice"], again["priceVersion"]) == (h["quotedPrice"], h["priceVersion"])
        assert unit(c, code)["price"] == h["quotedPrice"] + PRICE_STEP
        listed = next(x for x in m.c.get("/api/console/holds").json()["holds"] if x["id"] == h["id"])
        assert listed["quotedPrice"] == h["quotedPrice"]
    finally:
        release(p, h["id"])


def test_release_hold(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(17, "ABDEF"))[0]
    p, q = buyer(app_url, "release"), buyer(app_url, "release-next")
    h = place(p, code)
    token = share(p, h["id"])
    r = release(p, h["id"])
    assert r.status_code == 200
    ended = r.json()["hold"]
    assert (ended["status"], ended["endedBy"]) == ("released", "buyer") and ended["endedAt"]
    assert unit(c, code)["status"] == "available" and tower(c)[code]["status"] == "available"
    expect_error(c.get(f"/api/shared/{token}"), 404, "not_found")
    expect_error(release(p, h["id"]), 409, "hold_ended")
    nxt = place(q, code)
    release(q, nxt["id"])


@pytest.mark.timeout(300)
def test_wf_manage_hold_countdown_server_clock(browser):
    base = outage("APP_SHORT_URL")
    code = claim(client(base), ["10C", "10B", "10D"])[0]
    p = buyer(base, "countdown")
    r = hold(p, code)
    h = r.json()["hold"]
    length = (ts(h["endsAt"]) - ts(h["createdAt"])).total_seconds()
    with opened(browser, base, f"/holds/{h['id']}", cookie=p.cookie, clock_at=server_now(r) + timedelta(hours=SKEW_HOURS)) as page:
        timer = page.get_by_role("timer")
        wait_ui(page, lambda: re.fullmatch(r"\d{2,}:\d{2}:\d{2}", text_of(timer).strip()) is not None, "countdown visible", max_page_ms=0)
        hh, mm, ss = map(int, text_of(timer).strip().split(":"))
        left = hh * 3600 + mm * 60 + ss
        assert 0 < left <= length, f"countdown follows the server clock (L804): {left}"
        lead = {"page_ms": 0.0, "t0": time.monotonic()}

        def shifted_date(route: Route) -> None:
            response = route.fetch()
            headers = dict(response.headers)
            ahead = lead["page_ms"] / 1000 - (time.monotonic() - lead["t0"])
            if "date" in headers and ahead > 0:
                headers["date"] = format_datetime(parsedate_to_datetime(headers["date"]) + timedelta(seconds=ahead), usegmt=True)
            route.fulfill(response=response, headers=headers)

        page.route("**/api/**", shifted_date)
        remaining = (left + 1) * 1000
        while remaining > 0:
            step = min(16, remaining)
            page.clock.run_for(step)
            lead["page_ms"] += step
            remaining -= step
        wait_ui(page, lambda: "Checking..." in page_text(page), "zero shows Checking... (L426)", max_page_ms=HOLD_CHECK_MS)
        if get_hold(p, h["id"])["status"] == "active":
            assert C_ENDED["lapse"] not in page_text(page), "no lapse before the server says so (L33)"
        wait_ui(page, lambda: C_ENDED["lapse"] in page_text(page), "lapsed notice once the server reports it (L426)", seconds=length + POLL_SECONDS)
        assert accessible_name(page) == f"Your hold on {code}", "focus on the heading (L433)"
    after = get_hold(p, h["id"])
    assert (after["status"], after["endedBy"], ts(after["endedAt"])) == ("lapsed", "lapse", ts(h["endsAt"]))


def test_wf_manage_hold_dialog_survives(browser, app_url):
    code = claim(client(app_url), floor_pool(31, "ABDE"))[0]
    p = buyer(app_url, "survive")
    h = place(p, code)
    with opened(browser, app_url, f"/holds/{h['id']}", cookie=p.cookie) as page:
        wait_ui(page, lambda: shown(button(page, "Create share link")), "hold page loaded")
        click(button(page, "Create share link"))
        box = page.get_by_role("textbox", name="Share link", exact=True)
        wait_ui(page, lambda: shown(box) and "/shared/" in box.input_value(), "share link shown (L436)")
        value = box.input_value()
        box.focus()
        box.evaluate("el => el.select()")
        advance(page, REREAD_MS * 2 + 1000)
        page.evaluate(FOCUS_EVENT_JS)
        advance(page, 100)
        assert accessible_name(page) == "Share link" and box.input_value() == value
        assert box.evaluate("el => [el.selectionStart, el.selectionEnd]") == [0, len(value)], "selection kept (L428)"
        click(button(page, "Release hold"))
        dialog = page.get_by_role("alertdialog", name="Release this hold?", exact=True)
        wait_ui(page, lambda: shown(dialog), "release dialog open")
        focus = accessible_name(page)
        advance(page, REREAD_MS * 2 + 1000)
        behind = page.get_by_role("textbox", name="Share link", exact=True, include_hidden=True)
        assert shown(dialog) and accessible_name(page) == focus and behind.input_value() == value, "ticks never close or move focus (L428)"
        click(button(dialog, "Keep hold"))
        assert get_hold(p, h["id"])["status"] == "active"
        release(p, h["id"])
        wait_ui(page, lambda: C_ENDED["buyer"] in page_text(page), "ended copy (L556)", max_page_ms=REREAD_MS * 3)
        assert button(page, "Release hold").count() == 0 and accessible_name(page) == f"Your hold on {code}"
        wait_ui(page, lambda: C_ENDED["buyer"] in text_of(notices(page)), "ended copy announced in Notices (L432)", max_page_ms=1000)


@pytest.mark.timeout(300)
def test_wf_manage_hold_lapse_during_dialog(browser):
    base = outage("APP_SHORT_URL")
    code = claim(client(base), floor_pool(11, "CBD"))[0]
    p = buyer(base, "lapse-dialog")
    h = place(p, code)
    with opened(browser, base, f"/holds/{h['id']}", cookie=p.cookie) as page:
        wait_ui(page, lambda: shown(button(page, "Release hold")), "hold page loaded", max_page_ms=0)
        click(button(page, "Release hold"))
        dialog = page.get_by_role("alertdialog", name="Release this hold?", exact=True)
        wait_ui(page, lambda: shown(dialog), "dialog open", max_page_ms=0)
        advance(page, POLL_SECONDS * 1000)
        if get_hold(p, h["id"])["status"] == "active":
            assert shown(dialog), "the countdown never closes the dialog (L20)"
        wait_ui(page, lambda: dialog.count() == 0 and C_ENDED["lapse"] in page_text(page), "closes onto the lapsed notice (L430)", seconds=POLL_SECONDS * 2)
        assert accessible_name(page) == f"Your hold on {code}"
    expect_error(release(p, h["id"]), 409, "hold_ended")
    assert get_hold(p, h["id"])["endedBy"] == "lapse" and tower(client(base))[code]["status"] == "available"


@pytest.mark.timeout(300)
def test_hold_end_edges(app_url):
    base = outage("APP_SHORT_URL")
    probe = client(base)
    codes = claim(probe, floor_pool(8) + floor_pool(9), 6)
    people = [buyer(base, f"edge-{i}") for i in range(6)]
    holds = [place(p, code) for p, code in zip(people, codes)]
    token = share(people[5], holds[5]["id"])
    m = coordinator(base)
    wait_until_server(probe, max(ts(h["endsAt"]) for h in holds))
    expect_error(release(people[0], holds[0]["id"]), 409, "hold_ended")
    late = place(buyer(base, "edge-next"), codes[1])
    assert late["unitCode"] == codes[1], "another buyer holds at once (L803)"
    expect_error(people[2].c.post(f"/api/holds/{holds[2]['id']}/share", json={}), 409, "hold_ended")
    expect_error(m.c.post(f"/api/console/holds/{holds[3]['id']}/convert", json={}), 409, "hold_ended")
    assert m.c.post(f"/api/console/units/{codes[4]}/withdraw", json={}).status_code == 200
    expect_error(probe.get(f"/api/shared/{token}"), 404, "not_found")
    for i in (0, 1, 2, 3, 4):
        after = get_hold(people[i], holds[i]["id"])
        assert (after["status"], after["endedBy"], ts(after["endedAt"])) == ("lapsed", "lapse", ts(holds[i]["endsAt"])), f"lapse at endsAt (L799): {after}"
    assert tower(probe)[codes[3]]["status"] == "available"


def test_share_link_api(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(18, "ABDEF"))[0]
    p = buyer(app_url, "share")
    h = place(p, code)
    t1 = share(p, h["id"])
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", t1), "at least 32 URL-safe characters (L940)"
    assert get_hold(p, h["id"])["shareUrl"] == f"/shared/{t1}"
    r = c.get(f"/api/shared/{t1}")
    assert r.status_code == 200 and "no-store" in r.headers.get("cache-control", "")
    t2 = share(p, h["id"])
    assert t2 != t1 and c.get(f"/api/shared/{t1}").status_code == 404 and c.get(f"/api/shared/{t2}").status_code == 200
    assert p.c.delete(f"/api/holds/{h['id']}/share").status_code == 204
    assert c.get(f"/api/shared/{t2}").status_code == 404 and get_hold(p, h["id"])["shareUrl"] is None
    assert p.c.delete(f"/api/holds/{h['id']}/share").status_code == 204
    share(p, h["id"])
    release(p, h["id"])
    assert p.c.delete(f"/api/holds/{h['id']}/share").status_code == 204
    expect_error(p.c.post(f"/api/holds/{h['id']}/share", json={}), 409, "hold_ended")


def test_partner_view(browser, app_url):
    c = client(app_url)
    code = claim(c, floor_pool(19, "ABDEF"))[0]
    p = buyer(app_url, "partner")
    h = place(p, code)
    photo = c.get(unit(c, code)["viewUrl"]).content
    bodies: list[bytes] = []
    try:
        token = share(p, h["id"])
        with opened(browser, app_url, f"/shared/{token}") as page:
            page.on("response", lambda r: bodies.append(r.body()) if "/media/" in r.url and r.status == 200 else None)
            page.reload()
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=f"Home {code}", level=1)), "shared heading (L204)")
            wait_ui(page, lambda: shown(page.get_by_role("img", name=f"View from {code}")) and photo in bodies, "its own view (L35)")
            text = page_text(page)
            assert f"Held until {office(h['endsAt'])}." in text and "View photographed" in text
            assert "$" not in text, "no price figure (L707)"
            for name in ("Highwater", "My hold"):
                assert page.get_by_role("link", name=name, exact=True).count() == 0
            assert button(page, "Sign in").count() == 0
    finally:
        release(p, h["id"])


def test_wf_share_hold_regenerate_kills_old(browser, app_url):
    c = client(app_url)
    a, b, d = claim(c, floor_pool(20), 3)
    p = buyer(app_url, "regen")
    h = place(p, a)
    with opened(browser, app_url, f"/holds/{h['id']}", cookie=p.cookie, clipboard=True) as page:
        wait_ui(page, lambda: shown(button(page, "Create share link")), "hold page loaded")
        click(button(page, "Create share link"))
        box = page.get_by_role("textbox", name="Share link", exact=True)
        wait_ui(page, lambda: shown(box) and "/shared/" in box.input_value() and "Share link ready." in text_of(notices(page)), "link ready")
        first = box.input_value()
        assert first.startswith(origin_of(app_url)), "full URL (L203)"
        click(button(page, "Copy link"))
        wait_ui(page, lambda: "Link copied." in text_of(notices(page)), "Link copied.")
        assert page.evaluate("() => navigator.clipboard.readText()") == first
        click(button(page, "Make a new link"))
        wait_ui(page, lambda: box.input_value() not in ("", first), "a new link replaced it")
        second = box.input_value()
        for url, heading in ((first, C_DEAD_LINK), (second, f"Home {a}")):
            dead = page.context.new_page()
            dead.goto(url)
            wait_ui(dead, lambda: shown(dead.get_by_role("heading", name=heading)), f"{url} shows {heading!r}")
            dead.close()
        click(button(page, "Revoke link"))
        wait_ui(page, lambda: shown(button(page, "Create share link")) and "Share link revoked." in text_of(notices(page)), "revoked")
    assert c.get(f"/api/shared/{second.rsplit('/', 1)[1]}").status_code == 404
    t3 = share(p, h["id"])
    release(p, h["id"])
    assert c.get(f"/api/shared/{t3}").status_code == 404, "release kills the link"
    m = coordinator(app_url)
    q, r_ = buyer(app_url, "regen-conv"), buyer(app_url, "regen-wd")
    hb, hd = place(q, b), place(r_, d)
    tb, td = share(q, hb["id"]), share(r_, hd["id"])
    assert m.c.post(f"/api/console/holds/{hb['id']}/convert", json={}).status_code == 200
    assert m.c.post(f"/api/console/units/{d}/withdraw", json={}).status_code == 200
    assert c.get(f"/api/shared/{tb}").status_code == 404 and c.get(f"/api/shared/{td}").status_code == 404


def test_shared_read_only(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(21, "ABDEF"))[0]
    p = buyer(app_url, "readonly")
    h = place(p, code)
    try:
        live = share(p, h["id"])
        dead = "x" * 40
        for token in (live, dead):
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                expect_error(c.request(method, f"/api/shared/{token}", json={}), 405, "read_only")
        assert c.get(f"/api/shared/{live}").status_code == 200
        after = get_hold(p, h["id"])
        assert after["status"] == "active" and after["shareUrl"] == f"/shared/{live}"
    finally:
        release(p, h["id"])


def test_wf_share_hold_photo_unavailable(browser, app_url):
    c = client(app_url)
    code = claim(c, floor_pool(32, "ACEFG"))[0]
    p = buyer(app_url, "partner-photo")
    h = place(p, code)
    try:
        token = share(p, h["id"])
        failing = lambda pg: pg.route("**/media/**", lambda route: route.fulfill(status=503, body=""))
        with opened(browser, app_url, f"/shared/{token}", before=failing) as page:
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=f"Home {code}", level=1)), "shared heading (L204)")
            wait_ui(page, lambda: C_PHOTO_DOWN in page_text(page), "image request failed: the unavailable caption (L167, L558)")
            assert f"Held until {office(h['endsAt'])}." in page_text(page), "the rest of the page still shows (L165-L169)"
    finally:
        release(p, h["id"])


def test_wf_share_hold_office_time(browser):
    base = outage("APP_DST_URL")
    c = client(base)
    code = claim(c, ["20C", "20B", "20D"])[0]
    p = buyer(base, "dst")
    r = hold(p, code)
    h = r.json()["hold"]
    try:
        assert (ts(h["endsAt"]) - ts(h["createdAt"])).total_seconds() == HOLD_SECONDS
        assert office(h["createdAt"]).endswith("AEDT") and office(h["endsAt"]).endswith("AEST"), "elapsed time, not wall hours (L791)"
        assert abs((server_now(r) - ts(h["createdAt"])).total_seconds()) <= CLOCK_SLACK_S, "Date comes from the app clock (L582)"
        for resp in (c.get("/finder"), c.get(f"/api/holds/{uuid.uuid4()}"), c.get(unit(c, code)["viewUrl"])):
            assert abs((server_now(resp) - ts(h["createdAt"])).total_seconds()) <= POLL_SECONDS, "every response carries the app Date (L582)"
        token = share(p, h["id"])
        line = f"Held until {office(h['endsAt'])}."
        with opened(browser, base, f"/holds/{h['id']}", cookie=p.cookie) as page:
            wait_ui(page, lambda: line in page_text(page), f"hold page reads {line!r}")
            hh = int(text_of(page.get_by_role("timer")).split(":")[0])
            assert HOLD_SECONDS // 3600 - 1 <= hh <= HOLD_SECONDS // 3600, "countdown follows the server clock (L804)"
            page.goto(base + f"/shared/{token}")
            wait_ui(page, lambda: line in page_text(page), "shared page reads the same end time")
    finally:
        release(p, h["id"])


def test_wf_share_hold_no_private_copy(browser, app_url):
    c = client(app_url)
    code = claim(c, floor_pool(22, "ABDEF"))[0]
    p = buyer(app_url, "private-copy")
    h = place(p, code)
    try:
        token = share(p, h["id"])
        secrets = [p.email, p.name, h["id"], h["createdAt"], str(h["quotedPrice"]), money(h["quotedPrice"])]
        raw = c.get(f"/shared/{token}")
        assert f"<title>Home {code} · Highwater</title>" in raw.text, "server-sent title (L1108)"
        assert re.search(r'<meta[^>]+name="robots"[^>]+content="noindex"', raw.text), "noindex meta (L1109)"
        assert "no-store" in raw.headers.get("cache-control", "") and raw.headers.get("referrer-policy") == "no-referrer"
        texts: list[str] = [raw.text]
        paths: list[str] = []
        with opened(browser, app_url, f"/shared/{token}") as page:
            page.on("request", lambda r: paths.append(urlsplit(r.url).path))
            page.on("response", lambda r: texts.append(r.text()) if re.search(r"json|html|javascript|css", r.headers.get("content-type", "")) else None)
            page.reload()
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=f"Home {code}")), "shared page loaded")
            texts.append(page.content())
        for text in texts:
            for secret in secrets:
                assert secret not in text, f"shared copy leaks {secret!r} (L1110)"
        assert not any(path.startswith(("/api/session", "/api/holds")) for path in paths), f"never calls session or hold endpoints (L1111): {paths}"
        release(p, h["id"])
        assert "<title>" + "Shared link · Highwater" + "</title>" in c.get(f"/shared/{token}").text
    finally:
        release(p, h["id"])


def test_console_access(browser, app_url):
    anon, b = client(app_url), buyer(app_url, "console-buyer")
    endpoints = [("GET", "/api/console/units", None), ("GET", "/api/console/units/27C/prices", None), ("GET", "/api/console/holds", None),
                 ("POST", "/api/console/bands/36-38/release", {}), ("PUT", "/api/console/units/27C/price", {"price": 1700000, "expectedVersion": 1}),
                 ("POST", "/api/console/units/27C/withdraw", {}), ("POST", f"/api/console/holds/{uuid.uuid4()}/convert", {})]
    version = unit(anon, "27C")["priceVersion"]
    for method, path, body in endpoints:
        kw = {"json": body} if body is not None else {}
        expect_error(anon.request(method, path, **kw), 401, "unauthenticated")
        expect_error(b.c.request(method, path, **kw), 403, "forbidden")
    assert unit(anon, "27C")["priceVersion"] == version, "refusals change nothing"
    code = claim(anon, floor_pool(14, "GH"))[0]
    h = place(b, code)
    m = coordinator(app_url)
    try:
        units = m.c.get("/api/console/units").json()["units"]
        assert len(units) == TOTAL_UNITS
        listed = next(x for x in m.c.get("/api/console/holds").json()["holds"] if x["id"] == h["id"])
        assert (listed["buyerEmail"], listed["buyerName"]) == (b.email, b.name)
        versions = m.c.get(f"/api/console/units/{code}/prices").json()["versions"]
        assert all(set(v) == VERSION_KEYS for v in versions) and [v["version"] for v in versions] == sorted((v["version"] for v in versions), reverse=True)
        with opened(browser, app_url, "/console", cookie=m.cookie) as page:
            wait_ui(page, lambda: shown(page.get_by_role("region", name="Floor bands")), "console loaded (L205)")
            fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
            region = page.get_by_role("region", name=f"Unit {code}", exact=True)
            wait_ui(page, lambda: shown(region.get_by_role("table", name="Price versions")), "unit editor (L442)")
            table = region.get_by_role("table", name="Price versions")
            heads = [text_of(x).strip() for x in table.get_by_role("columnheader").all()]
            assert heads[:4] == ["Version", "Price", "Set by", "Set at"], heads
            top = text_of(table.get_by_role("row").nth(1))
            assert versions[0]["setBy"] in top and office(versions[0]["setAt"]) in top
            holds_table = page.get_by_role("table", name="Active holds")
            row = holds_table.get_by_role("row").filter(has=button(page, f"Convert {code}"))
            assert b.email in text_of(row) and office(h["endsAt"]) in text_of(row)
    finally:
        release(b, h["id"])


def test_wf_withdraw_ends_hold_truthfully(browser, app_url, meilisearch):
    c = client(app_url)
    code = claim(c, floor_pool(23))[0]
    p = buyer(app_url, "withdrawn")
    h = place(p, code)
    token = share(p, h["id"])
    view = unit(c, code)["viewUrl"]
    assert c.get(view).status_code == 200
    m = coordinator(app_url)
    with opened(browser, app_url, "/console", cookie=m.cookie) as page:
        fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
        region = page.get_by_role("region", name=f"Unit {code}", exact=True)
        wait_ui(page, lambda: shown(button(region, "Withdraw unit")), "unit editor")
        click(button(region, "Withdraw unit"))
        dialog = page.get_by_role("alertdialog", name=f"Withdraw {code}?", exact=True)
        wait_ui(page, lambda: shown(dialog), "withdraw confirmation (L449)")
        click(button(dialog, "Withdraw"))
        wait_ui(page, lambda: f"{code} withdrawn." in text_of(notices(page)), "withdrawn notice (L562)")
    expect_error(c.get(f"/api/units/{code}"), 404, "not_found")
    assert code not in search(p.c)["matchingCodes"] and tower(c)[code]["status"] == "withdrawn"
    expect_error(c.get(view), 404, "not_found")
    expect_error(c.get(f"/api/shared/{token}"), 404, "not_found")
    ended = get_hold(p, h["id"])
    assert (ended["status"], ended["endedBy"]) == ("released", "withdrawal")
    assert not any(x["unitCode"] == code for x in m.c.get("/api/console/holds").json()["holds"])
    expect_error(m.c.post(f"/api/console/units/{code}/withdraw", json={}), 409, "unit_withdrawn")
    meilisearch.settled()
    assert meilisearch.document(INDEX, code) is None, "document deleted from the index (L950)"
    with opened(browser, app_url, f"/holds/{h['id']}", cookie=p.cookie) as page:
        wait_ui(page, lambda: C_ENDED["withdrawal"] in page_text(page), "withdrawal copy on the hold page (L556)")


def test_convert_to_reservation(app_url):
    c = client(app_url)
    code = claim(c, floor_pool(24))[0]
    p, m = buyer(app_url, "convert"), coordinator(app_url)
    h = place(p, code)
    token = share(p, h["id"])
    r = m.c.post(f"/api/console/holds/{h['id']}/convert", json={})
    assert r.status_code == 200 and (r.json()["hold"]["status"], r.json()["hold"]["endedBy"]) == ("converted", "conversion")
    assert unit(c, code)["status"] == "reserved" and tower(c)[code]["status"] == "reserved"
    expect_error(c.get(f"/api/shared/{token}"), 404, "not_found")
    expect_error(m.c.post(f"/api/console/holds/{h['id']}/convert", json={}), 409, "hold_ended")
    expect_error(hold(buyer(app_url, "convert-next"), code), 409, "unit_reserved")


def test_wf_withdraw_counters_agree(browser, app_url):
    s, m = buyer(app_url, "counts"), coordinator(app_url)

    def counts() -> tuple[int, int, int]:
        t = sum(1 for x in tower(s.c).values() if x["status"] == "available")
        f = search(s.c)["facets"]["status"]["available"]
        k = sum(1 for u in m.c.get("/api/console/units").json()["units"] if u["status"] == "available")
        return t, f, k

    agree = lambda v: v[0] == v[1] == v[2]
    before = poll(counts, agree, "available counts agree (L903)")
    v, u = claim(s.c, floor_pool(25), 2)
    assert m.c.post(f"/api/console/units/{v}/withdraw", json={}).status_code == 200
    after = poll(counts, lambda x: agree(x) and x[0] == before[0] - 1, "counts agree after a withdrawal (L908)", SYNC_SECONDS + SYNC_SLACK_S)
    b = buyer(app_url, "counts-hold")
    h = place(b, u)
    poll(counts, lambda x: agree(x) and x[0] == after[0] - 1, "counts agree after a hold", SYNC_SECONDS + SYNC_SLACK_S)
    release(b, h["id"])
    final = poll(counts, lambda x: agree(x) and x[0] == after[0], "counts agree after a release", SYNC_SECONDS + SYNC_SLACK_S)
    with opened(browser, app_url, "/") as page:
        wait_ui(page, lambda: f"{final[0]} homes available now" in text_of(page.get_by_role("region", name="Available now")), "landing tally agrees (L131)")


def test_wf_withdraw_open_detail_updates(browser, app_url):
    c = client(app_url)
    code = claim(c, floor_pool(26, "BDAEFGH"))[0]
    m = coordinator(app_url)
    with opened(browser, app_url, f"/finder?unit={code}") as page:
        dialog = detail(page, code)
        wait_ui(page, lambda: shown(dialog), "detail opened")
        assert m.c.post(f"/api/console/units/{code}/withdraw", json={}).status_code == 200
        wait_ui(page, lambda: C_WITHDRAWN_PANEL in text_of(dialog) and f"{code} has been withdrawn." in text_of(notices(page)),
                "withdrawn in place (L413)", max_page_ms=REREAD_MS * 3)
        assert shown(dialog) and "Withdrawn" in text_of(dialog) and disabled(button(dialog, "Hold this home"))
        assert dialog.get_by_role("img", name=f"View from {code}").count() == 0
    assert code not in search(buyer(app_url, "after-wd").c)["matchingCodes"]


def test_withdraw_races(app_url):
    c = client(app_url)
    r1, r2, r3, r4 = claim(c, floor_pool(28) + floor_pool(29), 4)
    m = coordinator(app_url)
    rs = together([call(m, "POST", f"/api/console/units/{r1}/withdraw", json={}) for _ in range(5)])
    assert sorted(r.status_code for r in rs) == [200, 409, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            expect_error(r, 409, "unit_withdrawn")
    racers = [buyer(app_url, f"wd-race-{i}") for i in range(4)]
    v = unit(c, r2)["priceVersion"]
    rs = together([call(b, "POST", "/api/holds", json={"unitCode": r2, "priceVersion": v}) for b in racers]
                  + [call(m, "POST", f"/api/console/units/{r2}/withdraw", json={})])
    assert rs[-1].status_code == 200 and all(r.status_code in (201, 404, 409) for r in rs[:-1])
    for b, r in zip(racers, rs):
        if r.status_code == 201:
            assert get_hold(b, r.json()["hold"]["id"])["endedBy"] == "withdrawal", "no active hold survives (L822)"
    assert not any(h["unitCode"] == r2 for h in m.c.get("/api/console/holds").json()["holds"])
    v3 = console_unit(m, r3)["priceVersion"]
    rs = together([call(m, "PUT", f"/api/console/units/{r3}/price", json={"price": console_unit(m, r3)["price"] + PRICE_STEP, "expectedVersion": v3}),
                   call(m, "POST", f"/api/console/units/{r3}/withdraw", json={})])
    assert rs[1].status_code == 200 and rs[0].status_code in (200, 409)
    versions = [x["version"] for x in m.c.get(f"/api/console/units/{r3}/prices").json()["versions"]]
    assert versions.count(v3 + 1) == (1 if rs[0].status_code == 200 else 0)
    b4 = buyer(app_url, "wd-convert")
    h4 = place(b4, r4)
    rs = together([call(m, "POST", f"/api/console/holds/{h4['id']}/convert", json={}), call(m, "POST", f"/api/console/units/{r4}/withdraw", json={})])
    assert rs[1].status_code == 200 and tower(c)[r4]["status"] == "withdrawn"
    ended = get_hold(b4, h4["id"])
    assert ended["status"] == ("converted" if rs[0].status_code == 200 else "released") and ended["status"] != "active"


def test_derived_figures(browser, app_url):
    m, s = coordinator(app_url), buyer(app_url, "derived")
    set_price(m, "27C", SEED_RAISE)
    u = synced(s.c, "27C")
    assert (u["areaSqft"], u["pricePerM2"], u["pricePerSqft"]) == (SEED_27C_SQFT, SEED_RAISE_PER_M2, SEED_RAISE_PER_SQFT), "L856 example"
    for stack, (_, _, _, area) in STACKS.items():
        x = unit(s.c, f"22{stack}")
        assert x["areaSqft"] == half_up(area * SQFT_NUM, SQFT_DEN)
        assert x["pricePerM2"] == half_up(x["price"], area) and x["pricePerSqft"] == half_up(x["price"], x["areaSqft"])
    hit = next(h for h in search(s.c, q="27C")["hits"] if h["code"] == "27C")
    assert (hit["areaSqft"], hit["pricePerM2"], hit["pricePerSqft"]) == (u["areaSqft"], u["pricePerM2"], u["pricePerSqft"])
    with opened(browser, app_url, "/finder?unit=27C") as page:
        wait_ui(page, lambda: shown(detail(page, "27C")), "detail opened")
        text = text_of(detail(page, "27C"))
        for pattern in (r"1,636,040", r"14,?608", r"1,?357", r"112", r"1,?206"):
            assert re.search(pattern, text), f"detail shows {pattern} (L157-L158)"


def test_concurrent_band_release(app_url):
    candidates = [os.environ.get(v, "") for v in ("APP_DST_LATE_URL", "APP_SHORT_SESSION_URL", "APP_DST_URL", "APP_SHORT_URL")] + [app_url]
    top = [f"{f}{s}" for f in range(36, TOP_FLOOR + 1) for s in STACKS]
    base = next((b.rstrip("/") for b in candidates if b and all(tower(client(b))[x]["status"] == "unreleased" for x in top)), None)
    if base is None:
        pytest.fail("no instance still has floors 36-38 unreleased (seed L1037); rerun against fresh stores")
    m = coordinator(base)
    expect_error(m.c.post(f"/api/console/units/{top[0]}/withdraw", json={}), 409, "not_released")
    rs = together([call(m, "POST", "/api/console/bands/36-38/release", json={}) for _ in range(5)])
    winners = [r for r in rs if r.status_code == 200]
    assert len(winners) == 1 and winners[0].json() == {"band": "36-38", "releasedUnits": len(top)}, [r.text for r in rs]
    for r in rs:
        if r.status_code != 200:
            expect_error(r, 409, "already_released")
    cells = tower(client(base))
    assert all(cells[x]["status"] == "available" for x in top)
    assert unit(client(base), "37C")["status"] == "available"
    assert search(m.c, band=["36-38"])["total"] == len(top)
    expect_error(m.c.post("/api/console/bands/03-09/release", json={}), 409, "already_released")
    expect_error(m.c.post(f"/api/console/bands/{UNKNOWN_BAND}/release", json={}), 404, "not_found")


def test_concurrent_price_saves(app_url):
    m, s = coordinator(app_url), buyer(app_url, "prices")
    code = "32B"
    start = console_unit(m, code)
    v = start["priceVersion"]
    prices = [start["price"] + PRICE_STEP * (i + 1) for i in range(5)]
    rs = together([call(m, "PUT", f"/api/console/units/{code}/price", json={"price": p_, "expectedVersion": v}) for p_ in prices])
    wins = [(p_, r) for p_, r in zip(prices, rs) if r.status_code == 200]
    assert len(wins) == 1, [r.status_code for r in rs]
    price, win = wins[0]
    assert win.json() == {"code": code, "price": price, "priceVersion": v + 1}
    for r in rs:
        if r.status_code != 200:
            expect_error(r, 412, "stale_price")
    versions = m.c.get(f"/api/console/units/{code}/prices").json()["versions"]
    assert versions[0]["version"] == v + 1 and versions[0]["setBy"] == MIRA_NAME and versions[0]["price"] == price
    assert [x["version"] for x in versions].count(v + 1) == 1
    expect_error(m.c.put(f"/api/console/units/{code}/price", json={"price": price + 1, "expectedVersion": v}), 412, "stale_price")
    assert synced(s.c, code)["price"] == price
    assert next(h for h in search(s.c, q=code)["hits"] if h["code"] == code)["price"] == price
    expect_error(m.c.get("/api/console/units/ZZ9/prices"), 404, "not_found")


def test_price_integer_literals(app_url):
    m = coordinator(app_url)
    code = "32D"
    start = console_unit(m, code)
    v = start["priceVersion"]
    count = len(m.c.get(f"/api/console/units/{code}/prices").json()["versions"])
    path = f"/api/console/units/{code}/price"
    for raw, field in [(f'{{"price":1700000.0,"expectedVersion":{v}}}', ("price", F_PRICE)),
                       (f'{{"price":1.7e6,"expectedVersion":{v}}}', ("price", F_PRICE)),
                       (f'{{"price":"1700000","expectedVersion":{v}}}', ("price", F_PRICE)),
                       (f'{{"price":9007199254740993,"expectedVersion":{v}}}', ("price", F_PRICE)),
                       (f'{{"price":{PRICE_FLOOR - 1},"expectedVersion":{v}}}', ("price", F_PRICE)),
                       (f'{{"price":{PRICE_CEILING + 1},"expectedVersion":{v}}}', ("price", F_PRICE)),
                       ('{"price":1700000,"expectedVersion":"1"}', ("expectedVersion", F_EXPECTED)),
                       (f'{{"price":1700000,"expectedVersion":{v}.0}}', ("expectedVersion", F_EXPECTED)),
                       ('{"price":1700000,"expectedVersion":0}', ("expectedVersion", F_EXPECTED))]:
        expect_error(m.c.put(path, content=raw.encode(), headers={"Content-Type": "application/json"}), 422, "invalid", field=field)
    assert console_unit(m, code)["priceVersion"] == v and len(m.c.get(f"/api/console/units/{code}/prices").json()["versions"]) == count
    p = buyer(app_url, "literals")
    for raw in ('{"unitCode":"32D","priceVersion":1e0}', '{"unitCode":"32D","priceVersion":0}', '{"unitCode":"32D","priceVersion":9007199254740993}'):
        expect_error(p.c.post("/api/holds", content=raw.encode(), headers={"Content-Type": "application/json"}), 422, "invalid", field=("priceVersion", F_PRICE_VERSION))
    assert set_price(m, code, PRICE_FLOOR)["price"] == PRICE_FLOOR
    assert set_price(m, code, PRICE_CEILING)["price"] == PRICE_CEILING
    set_price(m, code, start["price"])
    assert SAFE_INTEGER > PRICE_CEILING


def test_wf_price_and_release_shown_price(browser, app_url):
    c = client(app_url)
    code = claim(c, face_pool(30))[0]
    p, m = buyer(app_url, "shown-price"), coordinator(app_url)
    old = unit(c, code)
    try:
        with opened(browser, app_url, f"/finder?unit={code}", cookie=p.cookie) as page:
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: f"Hold {code} at {money(old['price'])}?" in text_of(confirm(page)), "confirm question")
            new = set_price(m, code, old["price"] + PRICE_STEP)
            wait_ui(page, lambda: f"Price for {code} is now {money(new['price'])}." in text_of(notices(page)), "price change announced (L552)", max_page_ms=REREAD_MS * 3)
            assert f"Hold {code} at {money(old['price'])}?" in text_of(confirm(page)), "re-reads never change the confirm price (L384)"
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: MSG["price_changed"] in text_of(confirm(page)) and f"Hold {code} at {money(new['price'])}?" in text_of(confirm(page)),
                    "price_changed rewrites the question (L392)")
            assert accessible_name(page) == "Confirm hold"
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_CONFIRMED)), "held at the new price")
        h = p.c.get("/api/holds").json()["holds"][0]
        assert (h["quotedPrice"], h["priceVersion"]) == (new["price"], new["priceVersion"])
        with opened(browser, app_url, "/console", cookie=m.cookie) as page:
            fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
            table = page.get_by_role("region", name=f"Unit {code}", exact=True).get_by_role("table", name="Price versions")
            wait_ui(page, lambda: shown(table), "price versions table")
            rows = table.get_by_role("row")
            assert str(new["priceVersion"]) in text_of(rows.nth(1)) and MIRA_NAME in text_of(rows.nth(1)), "newest version first (L207)"
            assert str(old["priceVersion"]) in text_of(rows.nth(2))
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            release(p, x["id"])


def test_stored_tower_assets():
    s3 = S3()
    keys = set(s3.keys())
    models = ["models/tower-shell.glb"] + [f"models/plates/{b}.glb" for b in BANDS]
    for key in models:
        assert key in keys, f"{key} stored (L970-L971)"
        doc = glb_json(s3.get(key))
        assert "KHR_draco_mesh_compression" in doc.get("extensionsUsed", []) and "KHR_draco_mesh_compression" in doc.get("extensionsRequired", [])
    for band in BANDS:
        names = {n.get("name") for n in glb_json(s3.get(f"models/plates/{band}.glb")).get("nodes", [])}
        assert {f"window-{s}" for s in STACKS} <= names, f"plate {band} has window nodes (L971)"
    for key in ("textures/facade.png", "textures/duotone-ramp.png"):
        assert s3.get(key)[:8] == PNG_SIGNATURE
    for band in BANDS[:4]:
        for stack in STACKS:
            key = f"views/bands/{band}/{stack}.png"
            if (band, stack) == ("30-35", "H"):
                assert key not in keys, "30-35 stack H has no seeded photo (L1044)"
                continue
            data = s3.get(key)
            assert data[:8] == PNG_SIGNATURE and png_size(data)[0] >= MIN_PHOTO_W and png_size(data)[1] >= MIN_PHOTO_H


@pytest.mark.timeout(300)
def test_signed_media_links(app_url):
    base = outage("APP_SHORT_URL")
    c = client(base)
    view = unit(c, "20A")["viewUrl"]
    issued = time.monotonic()
    assert c.get(view).status_code == 200
    at = len(view) - 10
    expect_error(c.get(view[:at] + ("A" if view[at] != "A" else "B") + view[at + 1:]), 404, "not_found")
    shell = c.get("/api/tower").json()["assets"]["shell"]
    assert c.get(shell).status_code == 200

    def status() -> int:
        with c.stream("GET", view) as r:
            return r.status_code
    poll(status, lambda s_: s_ == 404, "the token expired (L977)", SHORT_MEDIA_S + LATE_SLACK_S)
    assert time.monotonic() - issued >= SHORT_MEDIA_S - CLOCK_SLACK_S, "not before MEDIA_URL_SECONDS"
    code = claim(c, floor_pool(12))[0]
    link = unit(c, code)["viewUrl"]
    assert c.get(link).status_code == 200
    assert coordinator(base).c.post(f"/api/console/units/{code}/withdraw", json={}).status_code == 200
    expect_error(c.get(link), 404, "not_found")


def test_storage_outage(browser, app_url):
    base = outage("APP_STORAGE_DOWN_URL")
    m = coordinator(base)
    before = console_unit(coordinator(app_url), "34E")["viewPhoto"]
    expect_error(upload(m, "34E", png(MIN_PHOTO_W, MIN_PHOTO_H)), 503, "storage_unavailable")
    assert console_unit(m, "34E")["viewPhoto"] == before, "nothing changed (L981)"
    c = client(base)
    expect_error(c.get(c.get("/api/tower").json()["assets"]["shell"]), 503, "media_unavailable")
    code = claim(c, floor_pool(34, "GH"))[0]
    p = buyer(base, "storage-down")
    h = place(p, code)
    release(p, h["id"])
    with opened(browser, base) as page:
        wait_ui(page, lambda: C_MODEL_DOWN in text_of(notices(page)), "floor grid notice (L559)")
        assert gone(button(page, "Turn left"))
        point(page, cell(page, "20E"))
        wait_ui(page, lambda: C_PHOTO_DOWN in text_of(lens(page)), "unavailable caption (L558)")


def test_wf_view_photos_no_early_mark(browser, app_url):
    m = coordinator(app_url)
    code = "32H"
    data = png(MIN_PHOTO_W, MIN_PHOTO_H)
    md5 = hashlib.md5(data).hexdigest()
    previous = console_unit(m, code)["viewPhoto"]
    gate = Gate(lambda req: req.method == "PUT" and "/view-photo" in req.url)
    with opened(browser, app_url, "/console", cookie=m.cookie, before=lambda p: p.route("**/view-photo", gate)) as page:
        fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
        region = page.get_by_role("region", name=f"Unit {code}", exact=True)
        wait_ui(page, lambda: shown(button(region, "Upload photo")), "unit editor")
        had_mark = "View photographed" in text_of(region)
        page.get_by_label("View photograph").set_input_files({"name": "view.png", "mimeType": "image/png", "buffer": data})
        click(button(region, "Upload photo"))
        wait_ui(page, lambda: bool(gate.held), "upload in flight")
        assert disabled(button(region, "Upload photo")) and "Uploading..." in page_text(page), "pending state (L561)"
        assert ("View photographed" in text_of(region)) == had_mark and console_unit(m, code)["viewPhoto"] == previous, "no early mark (L447)"
        gate.open()
        wait_ui(page, lambda: f"Photo confirmed for {code}." in text_of(notices(page)) and "View photographed" in text_of(region), "confirmed after the 200")
    stored = console_unit(m, code)
    assert stored["viewPhotographed"] and stored["viewPhoto"]["checksum"] == md5 and S3().get(stored["viewPhoto"]["key"]) == data
    down = outage("APP_STORAGE_DOWN_URL")
    with opened(browser, down, "/console", cookie=coordinator(down).cookie) as page:
        fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
        region = page.get_by_role("region", name=f"Unit {code}", exact=True)
        wait_ui(page, lambda: shown(button(region, "Upload photo")), "unit editor")
        page.get_by_label("View photograph").set_input_files({"name": "view.png", "mimeType": "image/png", "buffer": png(MIN_PHOTO_W, MIN_PHOTO_H)})
        click(button(region, "Upload photo"))
        wait_ui(page, lambda: MSG["storage_unavailable"] in text_of(region), "storage outage message in the unit region (L448)")
    assert console_unit(m, code)["viewPhoto"] == stored["viewPhoto"]


def test_wf_view_photos_bytes_checked(browser, app_url):
    m = coordinator(app_url)
    code = "34A"
    previous = console_unit(m, code)["viewPhoto"]
    good = png(MIN_PHOTO_W, MIN_PHOTO_H)
    with opened(browser, app_url, "/console", cookie=m.cookie) as page:
        fill(page.get_by_role("searchbox", name="Unit code", exact=True), code)
        region = page.get_by_role("region", name=f"Unit {code}", exact=True)
        wait_ui(page, lambda: shown(button(region, "Upload photo")), "unit editor")
        files = page.get_by_label("View photograph")
        for payload, message in ((png(MIN_PHOTO_W // 2, MIN_PHOTO_H // 2), F_PHOTO_SMALL), (b"not an image at all", MSG["unsupported_image"])):
            files.set_input_files({"name": "view.png", "mimeType": "image/png", "buffer": payload})
            click(button(region, "Upload photo"))
            wait_ui(page, lambda: message in text_of(region), f"{message!r} in the unit region (L448)")
        assert console_unit(m, code)["viewPhoto"] == previous
        files.set_input_files({"name": "view.png", "mimeType": "image/png", "buffer": good})
        click(button(region, "Upload photo"))
        wait_ui(page, lambda: f"Photo confirmed for {code}." in text_of(notices(page)), "photo confirmed (L561)")
    md5 = hashlib.md5(good).hexdigest()
    assert console_unit(m, code)["viewPhoto"] == {"key": f"views/units/{code}/{md5}.png", "size": len(good), "checksum": md5}
    assert S3().get(f"views/units/{code}/{md5}.png") == good
    expect_error(upload(m, code, good[:200]), 422, "invalid", field=("photo", F_PHOTO_BROKEN))
    expect_error(upload(m, code, JPEG_SIGNATURE + b"\x00" * 64, "image/jpeg"), 422, "invalid", field=("photo", F_PHOTO_BROKEN))
    expect_error(upload(m, code, good, "image/gif"), 415, "unsupported_image")
    big = [png(MIN_PHOTO_W, 1550, noisy=True), png(MIN_PHOTO_W, 1550, noisy=True)]
    rs = together([call(m, "PUT", "/api/console/units/34B/view-photo", content=b, headers={"Content-Type": "image/png"}) for b in big])
    assert {r.status_code for r in rs} <= {200, 409} and any(r.status_code == 200 for r in rs)
    for r in rs:
        if r.status_code == 409:
            expect_error(r, 409, "upload_in_progress")
    winners = {hashlib.md5(b).hexdigest() for b, r in zip(big, rs) if r.status_code == 200}
    assert console_unit(m, "34B")["viewPhoto"]["checksum"] in winners


def test_view_photos_byte_identical(app_url):
    m, c = coordinator(app_url), client(app_url)
    code = "34C"
    first = png(MIN_PHOTO_W, MIN_PHOTO_H)
    md5 = hashlib.md5(first).hexdigest()
    r = upload(m, code, first)
    assert r.status_code == 200 and r.json() == {"code": code, "viewPhotographed": True, "viewPhoto": {"key": f"views/units/{code}/{md5}.png", "size": len(first), "checksum": md5}}
    old_link = unit(c, code)["viewUrl"]
    media = c.get(old_link)
    assert media.content == first and media.headers["content-type"].startswith("image/png")
    assert int(media.headers["content-length"]) == len(first) and media.headers["etag"] == f'"{md5}"'
    assert "chunked" not in media.headers.get("transfer-encoding", "")
    again = upload(m, code, first)
    assert again.status_code == 200 and again.json() == r.json()
    assert [k for k in S3().keys(f"views/units/{code}/") if md5 in k] == [f"views/units/{code}/{md5}.png"]
    second = png(MIN_PHOTO_W, MIN_PHOTO_H)
    assert upload(coordinator(outage("APP_STORAGE_DOWN_URL")), code, second).status_code == 503
    assert c.get(unit(c, code)["viewUrl"]).content == first, "previous photo serves until a replacement is confirmed (L929)"
    assert upload(m, code, second).status_code == 200
    assert c.get(unit(c, code)["viewUrl"]).content == second and c.get(old_link).content == first


def test_pending_index_updates(app_url, meilisearch):
    c = client(app_url)
    code = claim(c, floor_pool(33, "AB"))[0]
    p = buyer(app_url, "pending")
    h = place(p, code)
    try:
        synced(c, code)
        doc = meilisearch.document(INDEX, code)
        assert doc and doc["status"] == "held", "the document says held once syncing clears (L993)"
    finally:
        release(p, h["id"])
    synced(c, code)
    assert meilisearch.document(INDEX, code)["status"] == "available"
    settings = meilisearch.settings(INDEX)
    assert set(settings["searchableAttributes"]) == {"code", "facing", "viewTag", "band"}
    assert set(settings["filterableAttributes"]) >= {"bedrooms", "band", "facing", "viewTag", "status", "price", "floor", "stack"}
    assert set(settings["sortableAttributes"]) >= {"price", "floor", "stack"} and settings["typoTolerance"]["enabled"] is False
    assert meilisearch.indexes()[INDEX]["primaryKey"] == "code"
    down = outage("APP_MEILISEARCH_DOWN_URL")
    dc = client(down)
    code = claim(dc, floor_pool(21, "AB"))[0]
    q = buyer(down, "pending-down")
    hd = place(q, code)
    deadline = time.monotonic() + SYNC_SECONDS + CLOCK_SLACK_S
    while time.monotonic() < deadline:
        assert unit(dc, code)["syncing"] is True, "syncing stays while the update is unconfirmed (L997)"
    release(q, hd["id"])


def test_wf_search_outage_syncing(browser):
    base = outage("APP_MEILISEARCH_DOWN_URL")
    c = client(base)
    code = claim(c, ["20C", "20B", "20D"])[0]
    p, m = buyer(base, "outage-hold"), coordinator(base)
    try:
        with opened(browser, base, cookie=p.cookie) as page:
            wait_ui(page, lambda: MSG["search_unavailable"] in text_of(page.get_by_role("alert")), "outage banner (L544)")
            assert page.get_by_role("group", name="Bedrooms", exact=True).get_by_role("checkbox").first.get_attribute("aria-disabled") == "true"
            for name in grid_names(page):
                if "Withdrawn" not in name and "Not released" not in name:
                    assert "Outside your filters" not in name
            assert cell(page, code).get_attribute("aria-disabled") == "false", "pinnable during the outage (L75)"
            x, y = center(cell(page, code))
            page.mouse.click(x, y)
            wait_ui(page, lambda: shown(detail(page, code)), "detail opened")
            click(button(detail(page, code), "Hold this home"))
            wait_ui(page, lambda: shown(confirm(page)), "confirm")
            click(button(confirm(page), "Confirm hold"))
            wait_ui(page, lambda: shown(page.get_by_role("heading", name=C_CONFIRMED)), "hold succeeded while search is down (L998)")
            wait_ui(page, lambda: "Held by you" in bg_name(bg_cell(page, code)) and "Syncing" in bg_name(bg_cell(page, code)),
                    "the cell carries Held by you and Syncing (L228, L568)")
        assert unit(c, code)["syncing"] and tower(c)[code]["syncing"] and tower(c)[code]["status"] == "held"
        assert set_price(m, "21C", unit(c, "21C")["price"] + PRICE_STEP)["priceVersion"] and unit(c, "21C")["syncing"]
    finally:
        for x in p.c.get("/api/holds").json()["holds"]:
            assert release(p, x["id"]).status_code in (200, 409)


def outage_route(page: Page) -> None:
    body = json.dumps({"error": {"code": "search_unavailable", "message": MSG["search_unavailable"]}})
    page.route("**/api/search**", lambda route: route.fulfill(status=503, content_type="application/json", body=body))


def test_wf_search_outage_recovers(browser, app_url):
    with opened(browser, app_url, "/finder?bedrooms=3", before=outage_route) as page:
        alert = page.get_by_role("alert").filter(has_text=MSG["search_unavailable"])
        wait_ui(page, lambda: shown(alert), "outage banner (L286)")
        chip = chip_any(page, "Bedrooms", "3 bedrooms")
        assert chip.is_checked() and chip.get_attribute("aria-disabled") == "true", "filters disabled, state kept (L288)"
        lowest = page.get_by_role("spinbutton", name="Lowest price", exact=True)
        kept = lowest.input_value()
        lowest.focus()
        page.keyboard.type("650000")
        advance(page, 400)
        assert lowest.get_attribute("aria-disabled") == "true" and lowest.input_value() == kept and accessible_name(page) == "Lowest price", \
            "a price bound ignores typing during the outage and keeps focus (L288)"
        assert not any("Outside your filters" in n for n in grid_names(page)), "no cell is dimmed (L291)"
        x, y = center(cell(page, "27D"))
        page.mouse.click(x, y)
        wait_ui(page, lambda: shown(detail(page, "27D")), "a 2-bedroom cell is pinnable during the outage (L75)")
        click(button(detail(page, "27D"), "Close"))
        page.unroute("**/api/search**")
        wait_ui(page, lambda: alert.count() == 0, "banner clears by itself (L293)", max_page_ms=OUTAGE_RETRY_MS * 2)
        assert chip.is_checked() and chip.get_attribute("aria-disabled") != "true"
        wait_results(page, search(client(app_url), bedrooms=["3"])["total"])


def test_wf_search_outage_announced_recovery(browser, app_url):
    totals: list[int] = []
    with opened(browser, app_url, "/finder?bedrooms=3", before=outage_route) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/api/search" in r.url else None)
        alert = page.get_by_role("alert").filter(has_text=MSG["search_unavailable"])
        wait_ui(page, lambda: shown(alert), "outage banner")
        assert MSG["search_unavailable"] not in text_of(notices(page)), "Notices stays silent (L286)"
        handle = alert.element_handle()
        chip_any(page, "Bedrooms", "3 bedrooms").focus()
        page.evaluate("() => { window.__hwFocused = document.activeElement; }")
        count = len(sent)
        advance(page, OUTAGE_RETRY_MS * 2 + 500)
        assert 2 <= len(sent) - count <= 3, "retries every 10 seconds (L289)"
        assert handle.evaluate("el => el.isConnected") and page.get_by_role("alert").count() == 1, "banner not re-rendered (L290)"
        page.on("response", lambda r: totals.append(r.json()["total"]) if "/api/search" in r.url and r.status == 200 else None)
        page.unroute("**/api/search**")
        wait_ui(page, lambda: bool(totals), "a retry succeeded", max_page_ms=OUTAGE_RETRY_MS * 2)
        n = totals[-1]
        copy = "Search is back. 1 home matches." if n == 1 else f"Search is back. {n} homes match."
        wait_ui(page, lambda: copy in text_of(notices(page)), f"Notices announced {copy!r} (L545)")
        assert page.evaluate("() => document.activeElement === window.__hwFocused"), "focus does not move (L297)"
        assert chip_any(page, "Bedrooms", "3 bedrooms").is_checked()


def test_desktop_layout(browser, app_url):
    with opened(browser, app_url) as page:
        wait_count(page)
        layout(page)
        boxes = [page.get_by_role("region", name=n, exact=True).bounding_box() for n in ("Filters", "Tower", "Results")]
        assert all(boxes), "three panes present (L136)"
        f, t, r = boxes
        assert f["x"] < t["x"] < r["x"] and f["x"] + f["width"] <= t["x"] + 1 and t["x"] + t["width"] <= r["x"] + 1
        assert max(b["y"] for b in boxes) - min(b["y"] for b in boxes) <= CLOCK_SLACK_S, "tops aligned (L136)"
        assert all(b["y"] < VIEWPORTS["desktop"][1] for b in boxes) and r["x"] + r["width"] <= VIEWPORTS["desktop"][0] + 1
        assert 0.1 < f["width"] / VIEWPORTS["desktop"][0] < 0.3, "filters about a fifth of the width (L137)"
        assert button(page, "Filters").count() == 0 and page.get_by_role("dialog", name="Filters").count() == 0
        page.evaluate("() => window.scrollTo(0, 400)")
        assert page.get_by_role("region", name="Tower", exact=True).bounding_box()["y"] == t["y"] or t["y"] >= 0


def test_tablet_layout(browser, app_url):
    with opened(browser, app_url, size="tablet") as page:
        wait_count(page)
        layout(page)
        t = page.get_by_role("region", name="Tower", exact=True).bounding_box()
        r = results(page).bounding_box()
        assert t["x"] + t["width"] <= r["x"] + 1 and t["y"] < r["y"] + r["height"] and r["y"] < t["y"] + t["height"], "side by side (L142)"
        assert page.get_by_role("region", name="Filters", exact=True).count() == 0
        click(button(page, "Filters"))
        sheet = page.get_by_role("dialog", name="Filters", exact=True)
        wait_ui(page, lambda: shown(sheet), "the sheet opened (L142)")
        settle_ms = motion_full(sheet, SHEET_MAX_MS * 2, samples=16)
        box = settle_ms[-1]
        assert motion_key(box, "x", "left") < VIEWPORTS["tablet"][0] / 2, "slides in over the left side"


def test_wf_finder_layouts_phone(browser, app_url):
    with opened(browser, app_url, size="phone") as page:
        wait_count(page)
        layout(page)
        t = page.get_by_role("region", name="Tower", exact=True).bounding_box()
        r = results(page).bounding_box()
        assert t["width"] >= VIEWPORTS["phone"][0] - 2 * OUTER_MARGIN_PX and t["y"] + t["height"] <= VIEWPORTS["phone"][1] + 1
        assert r["y"] >= t["y"] + t["height"] - 1, "results follow the tower (L143)"
        tap(cell(page, "27C"))
        wait_ui(page, lambda: "27C · " in text_of(lens(page)), "tap moves the inset lens (L366)")
        fig = lens(page).bounding_box()
        t = page.get_by_role("region", name="Tower", exact=True).bounding_box()
        cx, cy = fig["x"] + fig["width"] / 2, fig["y"] + fig["height"] / 2
        assert cx >= t["x"] + t["width"] / 2 and cy <= t["y"] + t["height"] / 2, "inset in the top-right (L144)"
        hits = grid(page).get_by_role("gridcell").evaluate_all(TOPMOST_JS)
        assert hits and all(hits), "the inset never covers a cell (L145)"
        tap(cell(page, "27C"))
        dialog = detail(page, "27C")
        wait_ui(page, lambda: shown(dialog), "second tap pins (L366)")
        box = dialog.bounding_box()
        assert box["width"] >= VIEWPORTS["phone"][0] - 1 and box["height"] >= VIEWPORTS["phone"][1] - 1, "full-screen detail (L155)"
    assert unit(client(app_url), "27C")["code"] == "27C"


def test_wf_finder_layouts_filter_sheet(browser, app_url):
    with opened(browser, app_url, size="tablet") as page:
        wait_count(page)
        click(button(page, "Filters"))
        sheet = page.get_by_role("dialog", name="Filters", exact=True)
        path = motion_full(sheet, SHEET_MAX_MS * 2, samples=16)
        took, _ = settle_time(path, lambda s_: motion_key(s_, "x", "left"), 1.0)
        assert took <= SHEET_MAX_MS + MOTION_STEP_MS, f"sheet slides in {took} ms (L516)"
        for _ in range(12):
            page.keyboard.press("Tab")
            assert sheet.evaluate("el => el.contains(document.activeElement)"), "Tab stays in the sheet (L352)"
        check(chip_box(page, "Bedrooms", "3 bedrooms"))
        wait_results(page, search(client(app_url), bedrooms=["3"])["total"], behind=True)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: sheet.count() == 0 and accessible_name(page) == "Filters", "Escape closes and refocuses Filters (L363)")


def test_wf_finder_layouts_resize_keeps_state(browser, app_url):
    with opened(browser, app_url, "/finder?bedrooms=3&unit=19C") as page:
        dialog = detail(page, "19C")
        wait_ui(page, lambda: shown(dialog), "detail opened")
        button(dialog, "Close").focus()
        url = page.url
        for size in ("tablet", "phone", "desktop"):
            page.set_viewport_size({"width": VIEWPORTS[size][0], "height": VIEWPORTS[size][1]})
            advance(page, 500)
            assert shown(dialog) and page.url == url and accessible_name(page) == "Close", f"state kept at {size} (L146-L151)"
            if size == "phone":
                assert dialog.bounding_box()["width"] >= VIEWPORTS["phone"][0] - 1
        click(button(dialog, "Close"))
        wait_ui(page, lambda: dialog.count() == 0, "closed")
        assert chip_box(page, "Bedrooms", "3 bedrooms").is_checked() and urlsplit(page.url).query == "bedrooms=3"
        page.set_viewport_size({"width": VIEWPORTS["phone"][0], "height": VIEWPORTS["phone"][1]})
        advance(page, 500)
        x, y = point(page, cell(page, "19B"))
        page.touchscreen.tap(x, y)
        hits = grid(page).get_by_role("gridcell").evaluate_all(TOPMOST_JS)
        assert hits and all(hits), "inset never covers a cell (L98)"


def test_wf_finder_layouts_closed_sheet_inert(browser, app_url):
    for size in ("tablet", "phone"):
        with opened(browser, app_url, "/finder?band=10-19", size=size) as page:
            wait_count(page)
            layout(page)
            assert page.get_by_role("checkbox").count() == 0 and page.get_by_role("searchbox", name="Search homes").count() == 0
            names = tab_order(page, 30)
            assert not any(n and (n in FILTER_FIELDS or any(n.lstrip("✓ ").startswith(f"{label} (") for label in CHIP_LABELS)) for n in names), names
            code = listed_codes(page)[0]
            click(row_button(page, code))
            dialog = detail(page, code)
            wait_ui(page, lambda: shown(dialog), "detail opened")
            for _ in range(10):
                page.keyboard.press("Tab")
                assert dialog.evaluate("el => el.contains(document.activeElement)"), "everything behind is inert (L353)"
            x, y = point(page, page.get_by_role("link", name="Highwater", exact=True, include_hidden=True))
            page.mouse.click(x, y)
            advance(page, 500)
            assert urlsplit(page.url).path == "/finder", "the page behind cannot be clicked (L353)"


def landing_floor(page: Page) -> int:
    snap = page.get_by_role("img", name=re.compile(r"^Highwater tower at floor \d+$")).aria_snapshot()
    m = re.search(r"floor (\d+)", snap)
    assert m, f"landing tower image named 'Highwater tower at floor <n>' (L185): {snap}"
    return int(m.group(1))


def test_landing_descent(browser, app_url):
    available = sum(1 for x in tower(client(app_url)).values() if x["status"] == "available")
    with opened(browser, app_url, "/") as page:
        assert shown(page.get_by_role("heading", name="HIGHWATER", level=1))
        assert page.get_by_role("link", name="Find your floor").get_attribute("href").endswith("/finder")
        positions = [i * BAND_SCROLL_PX for i in range(6)]
        floors, mats, views = [], [], {}
        for i, y in enumerate(positions + positions[-2::-1]):
            page.evaluate(f"() => window.scrollTo(0, {y})")
            advance(page, 300)
            floor = landing_floor(page)
            want = TOP_FLOOR - round(FLOOR_SPAN * min(y / LANDING_SCROLL_PX, 1))
            assert floor == want and f"Floor {floor}" in page_text(page), f"at {y}px floor {floor} expected {want} (L521)"
            floors.append(floor)
            mats.append(camera(page))
            if i in (0, 4):
                views[i] = decode(capture(page.get_by_role("img", name=re.compile(r"^Highwater tower at floor"))))
        assert mats[0] != mats[5] or difference(views[0], views[4]) > 0.15, "the camera moves (L521)"
        img = page.get_by_role("img", name=re.compile(r"^Highwater tower at floor"))
        shots = []
        for y in (BAND_SCROLL_PX // 2, BAND_SCROLL_PX * 3 // 2):
            page.evaluate(f"() => window.scrollTo(0, {y})")
            advance(page, 300)
            shots.append(decode(capture(img)))
        changed(shots[0], shots[1])
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        advance(page, 300)
        assert f"{available} homes available now" in text_of(page.get_by_role("region", name="Available now")), "tally (L131)"


def test_wf_cross_cutting_reduced_motion_landing(browser, app_url):
    with opened(browser, app_url, "/", reduced=True) as page:
        seen = []
        wait_ui(page, lambda: bool(camera(page)), "the landing tower has drawn")
        for y in range(0, LANDING_SCROLL_PX + 1, BAND_SCROLL_PX // 2):
            page.evaluate(f"() => window.scrollTo(0, {y})")
            advance(page, 300)
            seen.append((landing_floor(page), camera(page)))
        floors = [f for f, _ in seen]
        assert set(floors) <= REDUCED_FLOORS and floors == sorted(floors, reverse=True) and floors[0] == TOP_FLOOR and floors[-1] == min(REDUCED_FLOORS)
        for (fa, ma), (fb, mb) in zip(seen, seen[1:]):
            if fa == fb:
                assert ma == mb, "no movement tied to scrolling within a band (L532)"
    with opened(browser, app_url, reduced=True) as page:
        wait_count(page)
        point(page, cell(page, "23C"))
        wait_ui(page, lambda: shown(lens_img(page, "23C")), "lens on 23C")
        point(page, cell(page, "24C"))
        path = motion_full(lens(page), 300, samples=12)
        took, _ = settle_time(path, lambda s_: centre_x(s_) + centre_y(s_), 1.0)
        assert took <= MOTION_STEP_MS * 2, f"the lens snaps (L528): {took}"
        assert not animations(lens(page)), "no crossfade (L529)"
        x, y = center(cell(page, "24C"))
        page.mouse.click(x, y)
        wait_ui(page, lambda: shown(detail(page, "24C")), "detail opens at once (L530)", max_page_ms=MOTION_STEP_MS * 2)


def test_no_webgl_fallback(browser, app_url):
    with opened(browser, app_url, "/", no_webgl=True) as page:
        img = page.get_by_role("img", name=re.compile(r"^Highwater tower at floor \d+$"))
        wait_ui(page, lambda: shown(img), "still tower image (L535)")
        before = decode(capture(img))
        advance(page, 2000)
        assert difference(before, decode(capture(img))) < 0.01, "the still image does not move (L525)"
    with opened(browser, app_url, no_webgl=True) as page:
        wait_count(page)
        assert grid(page).get_by_role("row").count() == GRID_ROWS and gone(button(page, "Turn left"))
        names = grid_names(page)
        assert all(any(n.startswith(f"20{s} · ") for n in names) for s in STACKS), "every stack visible (L175)"
        point(page, cell(page, "20E"))
        wait_ui(page, lambda: shown(lens_img(page, "20E")), "lens in the floor grid (L536)")
        cell(page, "20E").focus()
        page.keyboard.press("ArrowUp")
        assert focused_code(page) == (21, "E")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: shown(detail(page, "21E")), "Enter pins in the floor grid")


def test_if_run_manifest():
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"} and all(isinstance(v, str) for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices():
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for name in ("Red Hat Display", "Red Hat Text", "Lucide"):
        assert name in text
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from notices: {missing}"


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad


def test_if_datastores():
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names if any(f.lower() in n for f in ("SQLite", "Redis"))]


def test_if_no_third_party_origins(browser, app_url):
    for path in ("/", "/finder"):
        with opened(browser, app_url, path) as page:
            urls: list[str] = []
            page.on("request", lambda r: urls.append(r.url))
            page.reload()
            advance(page, 2000)
            foreign = [u for u in urls if u.startswith("http") and not same_origin(u, origin_of(app_url))]
            assert not foreign, foreign


def test_if_compose_untouched(meilisearch):
    assert Postgres().tables()
    assert S3().keys("models/")
    assert INDEX in meilisearch.indexes()


def test_if_lockfile():
    assert (APP_DIR / "package-lock.json").is_file()
    assert "npm ci" in json.loads((APP_DIR / "run.json").read_text())["install"]


def test_if_typescript():
    sources = [p for p in APP_DIR.rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx")]
    assert sources and json.loads((APP_DIR / "run.json").read_text())["build"].strip()
