from __future__ import annotations

import hashlib
import json
import math
import os
import re
import socket
import struct
import threading
import time
import urllib.parse
import uuid
import zlib
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, TimeoutError as PlaywrightTimeoutError, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    axe,
    capture,
    center,
    changed,
    check,
    decode,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    tap,
)
from conftest import text as mail_text


APP_ROOT = Path("/app")
GRADING_KEY = os.environ.get("GRADING_KEY", "grade-ml-7c3e")
STORAGE_DOWN_URL = os.environ.get("APP_STORAGE_DOWN_URL", "").rstrip("/")
PASSWORD = "lamp-and-moth-8"

HTTP_TIMEOUT_S = 60
SEED_TIMEOUT_S = 180
UI_WAIT_S = 20
LIVE_SLACK_S = 4
SHORT_MS = 400
STEP_MS = 200
MAIL_WAIT_S = 30
CLOCK_SLACK_S = 30
POLL_S = 0.25
TAB_PRESSES = 12
TAB_SEARCH_LIMIT = 80
FETCH_WATCH_S = 3
CLEANUP_SLACK_S = 30
DRAG_START_PX = 15
PX_TOL = 1
MISSING_ID = 2_000_000_000

LIVE_MAX_S = 2
JSON_LIMIT = 65536
MULTIPART_EXTRA = 65536
HOLD_MS = 500
SLOP_PX = 10
OPEN_MS = 520
CROSSFADE_MIN_MS = 420
REDUCED_FADE_MS = 120
GAP_PX = 16
GRID_MARGIN_PX = 32
TEXT_BLOCK_PX = 64
BREAKPOINTS = (600, 900, 1200)
MIN_TARGET_PX = 44
CONTRAST_MIN = 7
VARIANT_WIDTHS = (236, 474, 736)
FEED_MAX = 60
ALT_MAX = 500
TAG_RUN_MAX = 30
SUGGEST_MAX = 5
STORAGE_CLEANUP_S = 60
KILO = 1000
MEGA = 1_000_000
TOKEN_MIN = 32
MINUTE_S = 60
HOUR_S = 3600
DAY_S = 86400
WEEK_DAYS = 7
MONTH_CUT_DAYS = 28
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
WIDE_DESKTOP = (1440, 900)
TALL_DESKTOP = (1280, 1600)
FRAME_MS = 17
COLUMN_CASES = {375: 2, 599: 2, 600: 3, 768: 3, 899: 3, 900: 4, 1024: 4, 1199: 4, 1200: 5, 1280: 5, 1440: 5}
WORKED_PINS = [(800, 1200), (1000, 1000), (1200, 600), (600, 1200), (900, 1200), (1000, 800), (800, 800)]
WORKED_1280 = [(0, 0, 0, 418, 1), (1, 0, 0, 300, 1), (2, 0, 0, 308, 2), (4, 0, 0, 536, 1), (1, 1, 316, 379, 1), (2, 1, 324, 253, 1), (3, 1, 324, 300, 1)]
WORKED_1000 = [(0, 0, 0, 409, 1), (1, 0, 0, 294, 1), (2, 0, 0, 302, 2), (1, 1, 310, 524, 1), (2, 1, 318, 371, 1), (3, 1, 318, 248, 1), (0, 1, 425, 294, 1)]
WORKED_WIDTHS = (1280, 1000, 375)
NARROW_FIRST_HEIGHT = 309
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
DATASTORE_PACKAGES = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "lowdb", "nedb", "level", "leveldown", "lmdb", "memcached", "amqplib", "bullmq", "bull", "kafkajs", "@elastic/elasticsearch", "meilisearch", "typesense", "keyv"}

PNG_SIG = b"\x89PNG\r\n\x1a\n"
GIF_BYTES = (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00"
             b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")
SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def tok() -> str:
    return uuid.uuid4().hex[:8]


@dataclass
class User:
    key: str
    email: str
    password: str
    name: str
    handle: str
    id: int = 0

    def seed(self) -> dict[str, str]:
        return {"key": self.key, "email": self.email, "password": self.password, "name": self.name, "handle": self.handle}


def person(label: str) -> User:
    t = tok()
    return User(key=f"u-{label}-{t}", email=f"{label}.{t}@example.test", password=PASSWORD,
                name=f"{label.capitalize()} {t}", handle=f"{label[:8]}_{t}")


class Keys:
    def __init__(self) -> None:
        self.t = tok()

    def __call__(self, name: str) -> str:
        return f"{name}-{self.t}"


@dataclass
class World:
    k: Keys
    ids: dict[str, int]

    def __getitem__(self, name: str) -> int:
        return self.ids[self.k(name)]


def color_for(key: str) -> str:
    return "#" + hashlib.md5(key.encode()).hexdigest()[:6]


def rgb_of(hex_colour: str) -> tuple[int, int, int]:
    return int(hex_colour[1:3], 16), int(hex_colour[3:5], 16), int(hex_colour[5:7], 16)


def random_rgb() -> tuple[int, int, int]:
    raw = os.urandom(3)
    return raw[0], raw[1], raw[2]


def board(key: str, owner: User, name: str, *, visibility: str = "public", members: tuple = (),
          sections: tuple = (), cover: str | None = None, at: str | None = None) -> dict:
    spec: dict[str, Any] = {"key": key, "owner": owner.key, "name": name, "visibility": visibility,
                            "members": [{"user": u.key, "role": role} for u, role in members],
                            "sections": [{"key": sk, "name": sn} for sk, sn in sections], "cover": cover}
    if at:
        spec["at"] = at
    return spec


def pin(key: str, owner: User, board_key: str, title: str, *, alt: str | None = None, w: int = 600, h: int = 600,
        fmt: str = "png", color: str | None = None, section: str | None = None, description: str = "",
        source: str | None = None, at: str | None = None) -> dict:
    spec: dict[str, Any] = {"key": key, "owner": owner.key, "board": board_key, "section": section, "title": title,
                            "description": description, "alt": alt or f"{title} print", "source": source,
                            "image": {"width": w, "height": h, "format": fmt, "color": color or color_for(key)}}
    if at:
        spec["at"] = at
    return spec


def save(key: str, of: str, by: User, board_key: str, *, section: str | None = None, at: str | None = None) -> dict:
    spec: dict[str, Any] = {"key": key, "of": of, "by": by.key, "board": board_key, "section": section}
    if at:
        spec["at"] = at
    return spec


def follow_user(follower: User, user: User) -> dict:
    return {"follower": follower.key, "user": user.key}


def follow_board(follower: User, board_key: str) -> dict:
    return {"follower": follower.key, "board": board_key}


def comment(key: str, pin_key: str, author: User, body: str, *, parent: str | None = None, at: str | None = None) -> dict:
    spec: dict[str, Any] = {"key": key, "pin": pin_key, "author": author.key, "parent": parent, "text": body}
    if at:
        spec["at"] = at
    return spec


def seed(base: str, **parts: Any) -> dict[str, int]:
    body: dict[str, Any] = {}
    for name, items in parts.items():
        if items:
            body[name] = [i.seed() if isinstance(i, User) else i for i in items]
    r = httpx.post(f"{base}/api/grading/seed", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=SEED_TIMEOUT_S)
    assert r.status_code == 201, f"POST /api/grading/seed answers 201; got {r.status_code} {r.text[:500]}"
    ids = r.json()["ids"]
    for u in parts.get("users", []) or []:
        u.id = ids[u.key]
    return ids


def seed_world(base: str, k: Keys, **parts: Any) -> World:
    return World(k, seed(base, **parts))


class Api:
    def __init__(self, base: str, user: User | None = None) -> None:
        self.base = base
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        self.user = user
        if user is not None:
            r = self.client.post("/api/session", json={"email": user.email, "password": user.password})
            assert r.status_code == 200, f"POST /api/session signs in {user.email}; got {r.status_code} {r.text[:300]}"

    @property
    def cookie(self) -> str:
        value = self.client.cookies.get("ml_session")
        assert value, "POST /api/session sets the ml_session cookie"
        return value

    def call(self, method: str, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        if body is None:
            return self.client.request(method, path, **kw)
        return self.client.request(method, path, json=body, **kw)

    def ok(self, method: str, path: str, body: Any = None, status: int = 200) -> Any:
        r = self.call(method, path, body)
        assert r.status_code == status, f"{method} {path} answers {status}; got {r.status_code} {r.text[:400]}"
        return r.json() if r.content else None


def assert_error(r: httpx.Response, status: int, code: str, field: str | None = None, what: str = "") -> dict:
    assert r.status_code == status, f"{what}: expected {status} {code}; got {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("error") == code, f"{what}: expected error {code!r}; got {body}"
    if field is not None:
        assert body.get("field") == field, f"{what}: expected field {field!r}; got {body}"
    return body


def upload(api: Api, image: bytes, *, title: str, alt: str, board_id: int, filename: str = "print.png",
           mime: str = "image/png", description: str | None = None, source: str | None = None,
           section: int | None = None) -> httpx.Response:
    data = {"title": title, "alt": alt, "board": str(board_id)}
    if description is not None:
        data["description"] = description
    if source is not None:
        data["source"] = source
    if section is not None:
        data["section"] = str(section)
    return api.client.post("/api/pins", data=data, files={"image": (filename, image, mime)})


def media(api: Api, pin_id: int, which: str | int) -> httpx.Response:
    return api.client.get(f"/media/{pin_id}/{which}", follow_redirects=True)


def config(base: str) -> dict:
    r = httpx.get(f"{base}/api/config", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, f"GET /api/config answers 200; got {r.status_code}"
    return r.json()


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def business_now(base: str) -> datetime:
    return parse_instant(config(base)["now"])


def ago(now: datetime, **delta: float) -> str:
    return iso(now - timedelta(**delta))


def set_clock(base: str, moment: datetime, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key is not None else {}
    return httpx.post(f"{base}/api/grading/clock", json={"now": iso(moment)}, headers=headers, timeout=HTTP_TIMEOUT_S)


def move_clock(base: str, seconds: float) -> datetime:
    target = business_now(base) + timedelta(seconds=seconds)
    r = set_clock(base, target)
    assert r.status_code == 200, f"POST /api/grading/clock moves the clock; got {r.status_code} {r.text[:200]}"
    return target


def poll(check_fn: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    last: Any = None
    while time.monotonic() < deadline:
        try:
            result = check_fn()
            if result:
                return result
            last = result
        except AssertionError as exc:
            last = exc
        pause.wait(POLL_S)
    pytest.fail(f"{what} (last: {last})")


def board_json(api: Api, board_id: int) -> dict:
    return api.ok("GET", f"/api/boards/{board_id}")


def order_of(b: dict) -> dict:
    return {"unsectioned": list(b["order"]["unsectioned"]),
            "sections": [(s["id"], list(s["pins"])) for s in b["order"]["sections"]]}


def flat(b: dict) -> list[int]:
    out = list(b["order"]["unsectioned"])
    for s in b["order"]["sections"]:
        out.extend(s["pins"])
    return out


def assert_gapless(b: dict) -> None:
    positions = {p["id"]: p["position"] for p in b["pins"]}
    containers = [b["order"]["unsectioned"]] + [s["pins"] for s in b["order"]["sections"]]
    for container in containers:
        assert [positions[i] for i in container] == list(range(1, len(container) + 1)), \
            f"pins hold positions 1..n in their container; got {[positions[i] for i in container]}"


def apply_move(order: dict, pin_id: int, section_id: int | None, position: int) -> dict:
    o = json.loads(json.dumps(order))
    containers = [o["unsectioned"]] + [s[1] for s in o["sections"]]
    for c in containers:
        if pin_id in c:
            c.remove(pin_id)
    target = o["unsectioned"] if section_id is None else next(s[1] for s in o["sections"] if s[0] == section_id)
    target.insert(position - 1, pin_id)
    return {"unsectioned": o["unsectioned"], "sections": [(s[0], s[1]) for s in o["sections"]]}


def move_body(pin_id: int, position: int, base_seq: int, section: int | None = None) -> dict:
    return {"kind": "pin", "id": pin_id, "section": section, "position": position, "base_seq": base_seq}


def png(width: int, height: int, rgb: tuple[int, int, int], chunks: tuple = ()) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    row = b"\x00" + bytes(rgb) * width
    return (PNG_SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + b"".join(chunk(k, d) for k, d in chunks)
            + chunk(b"IDAT", zlib.compress(row * height, 9)) + chunk(b"IEND", b""))


def padded_png(total: int, rgb: tuple[int, int, int], width: int = 40, height: int = 40) -> bytes:
    plain = png(width, height, rgb)
    pad = total - len(plain) - 12
    assert pad >= 8
    data = png(width, height, rgb, chunks=((b"tEXt", b"Comment\x00" + b"a" * (pad - 8)),))
    assert len(data) == total
    return data


def rgba_sha(width: int, height: int, rgb: tuple[int, int, int]) -> str:
    return hashlib.sha256(bytes((*rgb, 255)) * (width * height)).hexdigest()


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == PNG_SIG, "a PNG file"
    return struct.unpack(">II", data[16:24])


def png_chunks(data: bytes) -> list[str]:
    assert data[:8] == PNG_SIG, "a PNG file"
    i, out = 8, []
    while i + 8 <= len(data):
        n = struct.unpack(">I", data[i:i + 4])[0]
        out.append(data[i + 4:i + 8].decode("latin-1"))
        i += 12 + n
    return out


def jpeg_segments(data: bytes) -> list[tuple[int, bytes]]:
    assert data[:2] == b"\xff\xd8", "a JPEG file"
    i, out = 2, []
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        out.append((marker, data[i + 4:i + 2 + length]))
        if marker == 0xDA:
            break
        i += 2 + length
    return out


def jpeg_size(data: bytes) -> tuple[int, int]:
    for marker, seg in jpeg_segments(data):
        if marker in SOF_MARKERS:
            h, w = struct.unpack(">HH", seg[1:5])
            return w, h
    pytest.fail("the JPEG has a frame header")


def jpeg_metadata(data: bytes) -> list[int]:
    return [m for m, seg in jpeg_segments(data)
            if m == 0xE1 or (m == 0xE2 and seg.startswith(b"ICC_PROFILE")) or m == 0xFE]


def with_exif_orientation(jpeg: bytes, orientation: int) -> bytes:
    tiff = (b"MM\x00\x2a\x00\x00\x00\x08" + struct.pack(">H", 1)
            + struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack(">I", 0))
    payload = b"Exif\x00\x00" + tiff
    return jpeg[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + jpeg[2:]


def image_ids(s3: S3) -> set[str]:
    return {k.split("/")[1] for k in s3.keys("images/") if k.count("/") >= 2}


def seeded_jpeg(api: Api, pin_id: int) -> bytes:
    r = media(api, pin_id, "original")
    assert r.status_code == 200 and r.content[:2] == b"\xff\xd8", f"GET /media/{pin_id}/original returns the JPEG; got {r.status_code}"
    return r.content


def columns_for(width: int) -> int:
    if width < BREAKPOINTS[0]:
        return 2
    if width < BREAKPOINTS[1]:
        return 3
    if width < BREAKPOINTS[2]:
        return 4
    return 5


def column_width(width: int) -> int:
    n = columns_for(width)
    return (width - GRID_MARGIN_PX - GAP_PX * (n - 1)) // n


def half_up(x: Fraction) -> int:
    return math.floor(x + Fraction(1, 2))


def place(width: int, dims: list[tuple[int, int]]) -> list[tuple[int, int, int, int, int]]:
    n, c = columns_for(width), column_width(width)
    heights, counts, out = [0] * n, [0] * n, []
    for w, h in dims:
        if n >= 3 and Fraction(w, h) >= Fraction(3, 2):
            height = half_up(Fraction((2 * c + GAP_PX) * h, w)) + TEXT_BLOCK_PX
            left = min(range(n - 1), key=lambda i: (max(heights[i], heights[i + 1]), i))
            top = max(heights[left], heights[left + 1])
            out.append((left, counts[left], top, height, 2))
            heights[left] = heights[left + 1] = top + height + GAP_PX
            counts[left] += 1
            counts[left + 1] += 1
        else:
            height = half_up(Fraction(c * h, w)) + TEXT_BLOCK_PX
            col = min(range(n), key=lambda i: (heights[i], i))
            out.append((col, counts[col], heights[col], height, 1))
            heights[col] += height + GAP_PX
            counts[col] += 1
    return out


def arrow_target(placed: list[tuple[int, int, int, int, int]], i: int, down: bool) -> int:
    col, top = placed[i][0], placed[i][2]
    def occupies(p: tuple[int, int, int, int, int]) -> bool:
        return p[0] == col or (p[4] == 2 and p[0] + 1 == col)
    cands = [(p[2], j) for j, p in enumerate(placed) if j != i and occupies(p) and (p[2] > top if down else p[2] < top)]
    if not cands:
        return i
    return (min(cands) if down else max(cands))[1]


def relative(now: datetime, then: datetime, zone: ZoneInfo) -> str:
    s = (now - then).total_seconds()
    if s < MINUTE_S:
        return "just now"
    if s < HOUR_S:
        return f"{int(s // MINUTE_S)}m"
    if s < DAY_S:
        return f"{int(s // HOUR_S)}h"
    if s < WEEK_DAYS * DAY_S:
        return f"{int(s // DAY_S)}d"
    if s < MONTH_CUT_DAYS * DAY_S:
        return f"{int(s // (WEEK_DAYS * DAY_S))}w"
    local, local_now = then.astimezone(zone), now.astimezone(zone)
    shown = f"{MONTHS[local.month - 1]} {local.day}"
    return shown if local.year == local_now.year else f"{shown}, {local.year}"


@contextmanager
def browse(browser: Browser, base: str, user: User | None = None, path: str = "/", *,
           size: tuple[int, int] = DESKTOP, reduced: bool = False, device_time: datetime | None = None,
           api: Api | None = None, before: Callable[[Page], None] | None = None) -> Iterator[Page]:
    with open_app(browser, f"{base}/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if user is not None:
            client = api or Api(base, user)
            page.context.add_cookies([{"name": "ml_session", "value": client.cookie, "url": base}])
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if before is not None:
            before(page)
        page.goto(f"{base}{path}")
        yield page


def soon(page: Page, check_fn: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        try:
            return check_fn()
        except (AssertionError, AttributeError, PlaywrightError) as exc:
            last = (str(exc).splitlines() or [repr(exc)])[0]
        advance(page, STEP_MS)
    pytest.fail(f"{what} (last: {last})")


def live(page: Page, check_fn: Callable[[], Any], what: str) -> Any:
    return soon(page, check_fn, what, LIVE_MAX_S + LIVE_SLACK_S)


def visible(page: Page, loc: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    soon(page, lambda: expect(loc).to_be_visible(timeout=SHORT_MS), what, seconds)


def hidden(page: Page, loc: Locator, what: str, seconds: float = UI_WAIT_S) -> None:
    soon(page, lambda: expect(loc).to_be_hidden(timeout=SHORT_MS), what, seconds)


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices")


def says(page: Page, words: str | re.Pattern, seconds: float = UI_WAIT_S) -> None:
    soon(page, lambda: expect(announcements(page)).to_contain_text(words, timeout=SHORT_MS),
         f'status "Announcements" speaks {words!r}', seconds)


def toasts(page: Page, words: str | re.Pattern, seconds: float = UI_WAIT_S) -> None:
    soon(page, lambda: expect(notices(page)).to_contain_text(words, timeout=SHORT_MS),
         f'status "Notices" shows {words!r}', seconds)


def alerted(page: Page, words: str, seconds: float = UI_WAIT_S) -> None:
    soon(page, lambda: expect(page.get_by_role("alert").filter(has_text=words).first).to_be_visible(timeout=SHORT_MS),
         f"an alert reads {words!r}", seconds)


def shows_text(page: Page, words: str, what: str, seconds: float = UI_WAIT_S) -> None:
    visible(page, page.get_by_text(words, exact=True).first, what, seconds)


def grid(page: Page, name: str = "Pins") -> Locator:
    return page.get_by_role("feed", name=name, exact=True)


def card(page: Page, title: str, alt: str) -> Locator:
    return page.get_by_role("article", name=f"{title}: {alt}", exact=True)


CARD_JS = """els => els.map(e => ({id: Number(e.dataset.pinId), order: Number(e.dataset.order),
  col: Number(e.dataset.col), row: Number(e.dataset.row), top: Number(e.dataset.top),
  height: Number(e.dataset.height), span: Number(e.dataset.span), group: e.dataset.groupSize ?? null,
  selected: e.getAttribute('aria-selected'), dataSelected: e.dataset.selected ?? null}))"""


def read_cards(loc: Locator) -> list[dict]:
    return sorted(loc.get_by_role("article").evaluate_all(CARD_JS), key=lambda c: c["order"])


def tuples(cards: list[dict]) -> list[tuple[int, int, int, int, int]]:
    return [(c["col"], c["row"], c["top"], c["height"], c["span"]) for c in cards]


def grid_ids(loc: Locator) -> list[int]:
    return [c["id"] for c in read_cards(loc)]


def focused_pin(page: Page) -> int | None:
    return page.evaluate("""() => { const a = document.activeElement;
      const e = a && a.closest ? a.closest('[data-pin-id]') : null; return e ? Number(e.dataset.pinId) : null; }""")


def focus_inside(loc: Locator) -> bool:
    return loc.evaluate("d => d.contains(document.activeElement)")


ACTIVE_OPTION_JS = """l => { const a = document.activeElement; if (!a) return null; let o = null;
  if (a.getAttribute('role') === 'option' && l.contains(a)) o = a;
  else { const id = a.getAttribute('aria-activedescendant'); if (id) o = document.getElementById(id); }
  return o && l.contains(o) ? o.textContent.trim() : null; }"""


def active_option(listbox: Locator) -> str | None:
    return listbox.evaluate(ACTIVE_OPTION_JS)


def tab_into(page: Page, loc: Locator) -> None:
    for _ in range(TAB_SEARCH_LIMIT):
        page.keyboard.press("Tab")
        if focus_inside(loc):
            return
    pytest.fail("Tab reaches the grid's one card in the Tab order")


def wait_cards(page: Page, loc: Locator, count: int) -> None:
    soon(page, lambda: expect(loc.get_by_role("article")).to_have_count(count, timeout=SHORT_MS),
         f"the grid shows {count} cards")


def fill_composer(page: Page, *, image: bytes | None, title: str, alt: str, board_name: str | None,
                  filename: str = "print.png", mime: str = "image/png", description: str | None = None,
                  source: str | None = None) -> None:
    if image is not None:
        page.get_by_label("Image", exact=True).set_input_files({"name": filename, "mimeType": mime, "buffer": image})
    page.get_by_role("textbox", name="Title").fill(title)
    if description is not None:
        page.get_by_role("textbox", name="Description").fill(description)
    page.get_by_role("textbox", name="Alt text").fill(alt)
    if source is not None:
        page.get_by_role("textbox", name="Source link").fill(source)
    if board_name is not None:
        select(page.get_by_role("combobox", name="Board"), board_name)


def type_into(page: Page, loc: Locator, value: str) -> None:
    loc.focus()
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.press("Delete")
    if value:
        page.keyboard.type(value)


def rect(box: dict[str, float]) -> dict[str, float]:
    x = box.get("x", box.get("left", 0.0))
    y = box.get("y", box.get("top", 0.0))
    return {"left": x, "top": y, "right": x + box["width"], "bottom": y + box["height"]}


def path_rect(s: dict[str, float]) -> dict[str, float]:
    if "width" in s:
        return rect(s)
    return {"left": s["x"] - s["w"] / 2, "top": s["top"], "right": s["x"] + s["w"] / 2, "bottom": s["bottom"]}


def same_rect(a: dict[str, float], b: dict[str, float]) -> bool:
    return all(abs(a[e] - b[e]) <= PX_TOL for e in ("left", "top", "right", "bottom"))


def ws_recorder(frames: list[dict]) -> Callable[[Page], None]:
    def attach(page: Page) -> None:
        def on_ws(ws: Any) -> None:
            def on_frame(payload: Any) -> None:
                if isinstance(payload, str):
                    try:
                        frames.append(json.loads(payload))
                    except ValueError:
                        pass
            ws.on("framereceived", on_frame)
        page.on("websocket", on_ws)
    return attach


def mails_to(mail: Any, address: str, *, count: int = 1, subject: str | None = None,
             seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages()
                 if address.lower() in [a.lower() for a in addresses(m.get("To"))]
                 and (subject is None or m.get("Subject") == subject)]
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit holds {count} message(s) to {address} with subject {subject!r}; got {len(found)}")


def invite_token(message: dict) -> str:
    match = re.search(r"/invites/([A-Za-z0-9_-]+)", mail_text(message))
    assert match, "the invite email carries the /invites/<token> link"
    return match.group(1)


def from_ok(message: dict) -> bool:
    expected = mail_from_address().lower()
    return any(expected in a.lower() or a.lower() in expected for a in addresses(message.get("From")))


def test_health_and_serving(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, f"GET /api/health answers 200; got {r.status_code}"
    assert r.headers.get("content-type", "").startswith("application/json")
    assert r.json().get("status") == "ok", f"health reports ok; got {r.text}"
    home = httpx.get(f"{app_url}/", timeout=HTTP_TIMEOUT_S)
    assert home.status_code == 200


def test_public_configuration(app_url: str) -> None:
    cfg = config(app_url)
    for key in ("now", "time_zone", "undo_seconds", "invite_ttl_seconds", "limits"):
        assert key in cfg, f"GET /api/config carries {key}"
    limits = cfg["limits"]
    for key in ("image_max_bytes", "image_max_pixels", "title_max", "description_max", "comment_max", "board_name_max"):
        assert isinstance(limits.get(key), int) and limits[key] > 0, f"limits.{key} is a positive integer"
    ZoneInfo(cfg["time_zone"])
    k = Keys()
    owner = person("config")
    w = seed_world(app_url, k, users=[owner], boards=[board(k("b"), owner, f"Config {k.t}")],
                   pins=[pin(k("p"), owner, k("b"), f"Config {k.t}")])
    api = Api(app_url, owner)
    p = api.ok("GET", f"/api/pins/{w['p']}")
    assert abs((parse_instant(p["created_at"]) - parse_instant(cfg["now"])).total_seconds()) <= CLOCK_SLACK_S, \
        "config now is the business now that stamps new pins"
    version = p["version"]
    r = api.call("PATCH", f"/api/pins/{w['p']}", {"version": version, "title": "🦋" * limits["title_max"],
                                                    "description": "d" * limits["description_max"]})
    assert r.status_code == 200, f"a title and description at the configured limits are accepted; got {r.status_code} {r.text[:200]}"
    version = r.json()["version"]
    r = api.call("PATCH", f"/api/pins/{w['p']}", {"version": version, "title": "🦋" * (limits["title_max"] + 1)})
    assert_error(r, 422, "validation", "title", "a title one code point over title_max")
    r = api.call("POST", f"/api/pins/{w['p']}/comments", {"text": "c" * limits["comment_max"], "parent": None})
    assert r.status_code == 201, f"a comment at comment_max is accepted; got {r.status_code}"
    r = api.call("POST", f"/api/pins/{w['p']}/comments", {"text": "c" * (limits["comment_max"] + 1), "parent": None})
    assert_error(r, 422, "validation", "text", "a comment one over comment_max")
    r = api.call("POST", "/api/boards", {"name": "n" * limits["board_name_max"], "visibility": "public"})
    assert r.status_code == 201, f"a board name at board_name_max is accepted; got {r.status_code}"
    r = api.call("POST", "/api/boards", {"name": "m" * (limits["board_name_max"] + 1), "visibility": "public"})
    assert_error(r, 422, "validation", "name", "a board name one over board_name_max")
    invitee = f"invitee.{k.t}@example.test"
    api.ok("POST", f"/api/boards/{w['b']}/invites", {"email": invitee, "role": "viewer"}, status=202)
    now = business_now(app_url)
    invites = api.ok("GET", f"/api/boards/{w['b']}/members")["invites"]
    expires = parse_instant(next(i for i in invites if i["email"].lower() == invitee)["expires_at"])
    assert abs((expires - now).total_seconds() - cfg["invite_ttl_seconds"]) <= CLOCK_SLACK_S, \
        "invite expiry is invite_ttl_seconds after it was sent"
    op = api.ok("DELETE", f"/api/pins/{w['p']}")
    deadline = parse_instant(op["deadline"])
    assert abs((deadline - business_now(app_url)).total_seconds() - cfg["undo_seconds"]) <= CLOCK_SLACK_S, \
        "the undo deadline is undo_seconds after the operation"


def test_business_clock(app_url: str) -> None:
    assert_error(set_clock(app_url, business_now(app_url), key=None), 404, "not_found", what="clock without key")
    assert_error(set_clock(app_url, business_now(app_url), key="wrong-key"), 404, "not_found", what="clock with a wrong key")
    target = business_now(app_url) + timedelta(hours=26)
    r = set_clock(app_url, target)
    assert r.status_code == 200
    assert abs((parse_instant(r.json()["now"]) - target).total_seconds()) <= CLOCK_SLACK_S
    real0, now0 = time.monotonic(), business_now(app_url)
    assert -CLOCK_SLACK_S <= (now0 - target).total_seconds() <= CLOCK_SLACK_S, "config now follows the moved clock"
    k = Keys()
    u = person("clock")
    w = seed_world(app_url, k, users=[u], boards=[board(k("b"), u, f"Clock {k.t}")],
                   pins=[pin(k("p"), u, k("b"), f"Clock {k.t}")],
                   comments=[comment(k("c"), k("p"), u, "Ticking")])
    api = Api(app_url, u)
    created = parse_instant(api.ok("GET", f"/api/pins/{w['p']}")["created_at"])
    assert (created - target).total_seconds() >= -1 and (created - target).total_seconds() <= CLOCK_SLACK_S, \
        "a new pin's created_at reads the moved business clock"
    c = api.ok("GET", f"/api/pins/{w['p']}/comments")["comments"][0]
    assert abs((parse_instant(c["created_at"]) - created).total_seconds()) <= CLOCK_SLACK_S
    real1, now1 = time.monotonic(), business_now(app_url)
    assert now1 > now0, "the business clock keeps running in real time"
    assert abs((now1 - now0).total_seconds() - (real1 - real0)) <= CLOCK_SLACK_S


def test_grading_seed_route(app_url: str) -> None:
    k = Keys()
    a, b = person("seeder"), person("member")
    body = dict(
        users=[a, b],
        boards=[board(k("b"), a, f"Seeded {k.t}", members=((b, "viewer"),), sections=((k("s"), "Shelf"),), cover=k("p2")),
                board(k("bb"), b, f"Mine {k.t}")],
        pins=[pin(k("p1"), a, k("b"), f"First {k.t}"), pin(k("p2"), a, k("b"), f"Second {k.t}"),
              pin(k("p3"), a, k("b"), f"Shelved {k.t}", section=k("s"))],
        saves=[save(k("v"), k("p1"), b, k("bb"))],
        follows=[follow_user(b, a), follow_board(b, k("b"))],
        comments=[comment(k("c1"), k("p1"), b, "Lovely"), comment(k("c2"), k("p1"), a, "Thanks", parent=k("c1"))],
        reactions=[{"pin": k("p1"), "user": b.key, "type": "love"}],
    )
    w = seed_world(app_url, k, **body)
    for key in (a.key, b.key, k("b"), k("bb"), k("s"), k("p1"), k("p2"), k("p3"), k("v"), k("c1"), k("c2")):
        assert isinstance(w.ids.get(key), int) and w.ids[key] > 0, f"ids holds a positive id for {key}"
    assert a.id < b.id and w["p1"] < w["p2"] < w["p3"] < w["v"], "ids follow creation order"
    api = Api(app_url, a)
    bj = board_json(api, w["b"])
    assert bj["order"]["unsectioned"] == [w["p1"], w["p2"]], "first listed pin gets position 1"
    assert [(s["id"], s["pins"]) for s in bj["order"]["sections"]] == [(w["s"], [w["p3"]])]
    assert bj["cover"] == w["p2"] and bj["followers"] == 1 and bj["seq"] == 0
    members = api.ok("GET", f"/api/boards/{w['b']}/members")["members"]
    assert [(m["user"]["id"], m["role"]) for m in members] == [(b.id, "viewer")]
    p1 = api.ok("GET", f"/api/pins/{w['p1']}")
    assert (p1["saves"], p1["comments"], p1["reactions"]) == (1, 2, 1)
    v = api.ok("GET", f"/api/pins/{w['v']}")
    assert v["owner"]["id"] == b.id and v["saved_from"]["pin_id"] == w["p1"]
    comments = api.ok("GET", f"/api/pins/{w['p1']}/comments")["comments"]
    assert comments[0]["id"] == w["c1"] and [r_["id"] for r_ in comments[0]["replies"]] == [w["c2"]]
    assert api.ok("GET", f"/api/users/{a.handle}")["followers"] == 1
    Api(app_url, b)
    ghost = person("ghost")
    r = httpx.post(f"{app_url}/api/grading/seed", json={"users": [ghost.seed()]}, timeout=HTTP_TIMEOUT_S)
    assert_error(r, 404, "not_found", what="seed without the key")
    assert httpx.post(f"{app_url}/api/session", json={"email": ghost.email, "password": ghost.password}).status_code == 401
    bad = Keys()
    r = httpx.post(f"{app_url}/api/grading/seed", headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT_S,
                   json={"users": [ghost.seed()], "boards": [board(bad("b"), ghost, "Bad")],
                         "pins": [pin(bad("p"), ghost, bad("b"), "No alt", alt=" ")]})
    assert r.status_code == 422 and r.json().get("error") == "validation", "seed records follow API validation"


def test_sign_up_and_sign_in(browser: Browser, app_url: str, mail: Any) -> None:
    t = tok()
    email, handle = f"new.{t}@example.test", f"new_{t}"
    body = {"email": email, "password": PASSWORD, "name": f"New {t}", "handle": handle}
    r = httpx.post(f"{app_url}/api/accounts", json=body, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 202 and r.json() == {"status": "code_sent"}
    msg = mails_to(mail, email)[0]
    match = re.fullmatch(r"Your Mothlight code is (\d{6})", msg.get("Subject", ""))
    assert match and match.group(1) in mail_text(msg) and from_ok(msg)
    code = match.group(1)
    wrong = "000000" if code != "000000" else "111111"
    assert_error(httpx.post(f"{app_url}/api/accounts/confirm", json={"email": email, "code": wrong}), 422, "validation", "code")
    r = httpx.post(f"{app_url}/api/accounts/confirm", json={"email": email, "code": code})
    assert r.status_code == 200 and r.json()["user"]["handle"] == handle
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("ml_session="))
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert_error(httpx.post(f"{app_url}/api/accounts/confirm", json={"email": email, "code": code}), 422, "validation", "code")
    again = httpx.post(f"{app_url}/api/accounts", json={**body, "handle": f"oth_{t}"})
    assert again.status_code == 202 and again.json() == r_json_code_sent() if False else again.json() == {"status": "code_sent"}
    existing = mails_to(mail, email, subject="You already have a Mothlight account")[0]
    assert "/signin" in mail_text(existing)
    assert_error(httpx.post(f"{app_url}/api/accounts", json={**body, "email": f"x.{t}@example.test"}), 409, "handle_taken")
    for field, change in (("email", {"email": "not-an-email"}), ("password", {"password": "short7c"}),
                          ("handle", {"handle": "AB"}), ("name", {"name": ""})):
        fresh = {"email": f"v{field}.{t}@example.test", "password": PASSWORD, "name": "Val", "handle": f"v{field[:3]}_{t}"}
        assert_error(httpx.post(f"{app_url}/api/accounts", json={**fresh, **change}), 422, "validation", field)
    bad_pw = httpx.post(f"{app_url}/api/session", json={"email": email, "password": "wrong-pass-1"})
    unknown = httpx.post(f"{app_url}/api/session", json={"email": f"nobody.{t}@example.test", "password": PASSWORD})
    assert bad_pw.status_code == unknown.status_code == 401 and bad_pw.content == unknown.content
    assert bad_pw.json() == {"error": "invalid_credentials"}
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    r = client.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["user"]["email"] == email
    assert "HttpOnly".lower() in next(c for c in r.headers.get_list("set-cookie") if c.startswith("ml_session=")).lower()
    assert client.get("/api/me").status_code == 200
    assert client.delete("/api/session").status_code == 204
    assert_error(client.get("/api/me"), 401, "unauthorized")
    with open_app(browser, f"{app_url}/boards") as page:
        soon(page, lambda: (assert_true("/signin" in page.url and "/boards" in urllib.parse.unquote(page.url))),
             "a signed-out visit goes to /signin?next=<path>")
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        with held(page, "**/api/session") as hold:
            page.get_by_role("button", name="Sign in").click()
            pending = page.get_by_role("button", name="Signing in")
            visible(page, pending, 'the Sign in button reads "Signing in" while pending')
            expect(pending).to_be_disabled()
            hold.release()
        soon(page, lambda: assert_true(urllib.parse.urlparse(page.url).path == "/boards"), "sign-in returns to next")


def assert_true(value: bool) -> bool:
    assert value
    return True


def test_error_order(app_url: str) -> None:
    k = Keys()
    o, v, s = person("owner"), person("viewer"), person("stranger")
    w = seed_world(app_url, k, users=[o, v, s],
                   boards=[board(k("b"), o, f"Secret {k.t}", visibility="secret", members=((v, "viewer"),))],
                   pins=[pin(k("p"), o, k("b"), f"Plans {k.t}")])
    owner = Api(app_url, o)
    owner.ok("PATCH", f"/api/pins/{w['p']}", {"version": 1, "title": f"Plans two {k.t}"})
    stale = {"version": 1, "alt": ""}
    path = f"/api/pins/{w['p']}"
    assert_error(httpx.patch(f"{app_url}{path}", json=stale), 401, "unauthorized", what="signed out")
    assert_error(Api(app_url, s).call("PATCH", path, stale), 404, "not_found", what="stranger")
    assert_error(Api(app_url, v).call("PATCH", path, stale), 403, "forbidden", what="viewer member")
    body = assert_error(owner.call("PATCH", path, stale), 409, "version_conflict", what="owner with stale version")
    assert body["current"]["version"] == 2
    assert_error(owner.call("PATCH", path, {"version": 2, "alt": ""}), 422, "validation", "alt", "owner, current version")
    assert_error(owner.call("GET", f"/api/pins/{MISSING_ID}"), 404, "not_found")
    assert_error(owner.call("GET", f"/api/nothing-here-{k.t}"), 404, "not_found", what="unknown /api path")


def secret_values() -> list[str]:
    values = [GRADING_KEY]
    for name in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL"):
        value = os.environ.get(name, "")
        if len(value) >= 8:
            values.append(value)
    password = urllib.parse.urlparse(os.environ.get("DATABASE_URL", "")).password
    if password and len(password) >= 8:
        values.append(password)
    return values


def test_server_boundary(app_url: str) -> None:
    k = Keys()
    u = person("boundary")
    seed(app_url, users=[u])
    api = Api(app_url, u)
    evil = {"Origin": "http://evil.example"}
    assert_error(httpx.post(f"{app_url}/api/session", json={"email": u.email, "password": u.password}, headers=evil), 403, "forbidden")
    r = api.call("POST", "/api/boards", {"name": f"Evil {k.t}", "visibility": "public"}, headers=evil)
    assert_error(r, 403, "forbidden", what="state change from a foreign origin")
    assert all(b["name"] != f"Evil {k.t}" for b in api.ok("GET", "/api/boards/mine")["boards"])
    assert httpx.get(f"{app_url}/api/config", headers=evil).status_code == 200
    prefix = '{"name":"Exact ' + k.t + '","visibility":"public"'
    exact = (prefix + " " * (JSON_LIMIT - len(prefix) - 1) + "}").encode()
    assert len(exact) == JSON_LIMIT
    r = api.client.post("/api/boards", content=exact, headers={"content-type": "application/json"})
    assert r.status_code == 201, f"a JSON body of exactly 65,536 bytes is allowed; got {r.status_code}"
    over_prefix = prefix.replace("Exact", "Over")
    over = (over_prefix + " " * (JSON_LIMIT - len(over_prefix)) + "}").encode()
    assert len(over) == JSON_LIMIT + 1
    r = api.client.post("/api/boards", content=over, headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "too_large", "max_bytes": JSON_LIMIT}
    upgrade = {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
               "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
    try:
        assert httpx.get(f"{app_url}/api/live", headers=upgrade).status_code == 401
        assert api.client.get("/api/live", headers={**upgrade, **evil}).status_code == 403
    except httpx.HTTPError as exc:
        pytest.fail(f"the live channel refuses the upgrade before switching protocols: {exc}")
    secrets = secret_values()
    home = httpx.get(f"{app_url}/").text
    assets = {m for m in re.findall(r'(?:src|href)="(/[^"/][^"]*)"', home)}
    bodies = [home] + [httpx.get(f"{app_url}{a}").text for a in sorted(assets)]
    for path in ("/run.json", "/package.json", "/.env", "/src/server.ts", "/server.ts", "/tsconfig.json", "/package-lock.json"):
        bodies.append(httpx.get(f"{app_url}{path}").text)
    for body in bodies:
        assert "run-manifest-v1" not in body, "source files are never served"
        for secret in secrets:
            assert secret not in body, "no credential, key or connection value reaches the browser"


def test_health_during_storage_outage() -> None:
    assert STORAGE_DOWN_URL, "APP_STORAGE_DOWN_URL names the storage-outage instance"
    r = httpx.get(f"{STORAGE_DOWN_URL}/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json().get("status") == "unavailable"
    assert httpx.get(f"{STORAGE_DOWN_URL}/api/config", timeout=HTTP_TIMEOUT_S).status_code == 200
    assert httpx.get(f"{STORAGE_DOWN_URL}/", timeout=HTTP_TIMEOUT_S).status_code == 200


def simple_world(base: str, label: str, n: int = 3, *, dims: list[tuple[int, int]] | None = None,
                 visibility: str = "public") -> tuple[Keys, User, World, list[str], list[str]]:
    k = Keys()
    o = person(label)
    dims = dims or [(600, 600)] * n
    titles = [f"Print {i} {k.t}" for i in range(len(dims))]
    alts = [f"Moth study {i}" for i in range(len(dims))]
    pins = [pin(k(f"p{i}"), o, k("b"), titles[i], alt=alts[i], w=d[0], h=d[1]) for i, d in enumerate(dims)]
    w = seed_world(base, k, users=[o], boards=[board(k("b"), o, f"Board {k.t}", visibility=visibility)], pins=pins)
    return k, o, w, titles, alts


def test_navigation_landmarks(browser: Browser, app_url: str) -> None:
    k, o, w, titles, alts = simple_world(app_url, "landmark", 1)
    screens = ["/", "/search", "/create", "/boards", f"/u/{o.handle}", f"/b/{w['b']}", f"/pin/{w['p0']}"]
    links = ("Home", "Search", "Create", "Boards", "Profile")
    api = Api(app_url, o)
    with browse(browser, app_url, o, "/", api=api) as page:
        for path in screens:
            page.goto(f"{app_url}{path}")
            nav = page.get_by_role("navigation", name="Primary")
            visible(page, nav, f'{path} shows navigation "Primary"')
            for name in links:
                expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
            expect(page.get_by_role("searchbox", name="Search pins")).to_be_visible()
            expect(page.get_by_role("main")).to_have_count(1)
        page.get_by_role("searchbox", name="Search pins").fill("lamp")
        page.keyboard.press("Enter")
        soon(page, lambda: assert_true("/search?q=lamp" in page.url), "the search box submits to /search?q=")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        for path in screens:
            page.goto(f"{app_url}{path}")
            tabs = page.get_by_role("navigation", name="Tabs")
            visible(page, tabs, f'{path} shows navigation "Tabs" below 600 px')
            for name in links:
                expect(tabs.get_by_role("link", name=name, exact=True)).to_be_visible()
            expect(page.get_by_role("navigation", name="Primary")).to_be_hidden()
            expect(page.get_by_role("main")).to_have_count(1)


def test_announcements_and_alerts(browser: Browser, app_url: str) -> None:
    k, o, w, _, _ = simple_world(app_url, "announce", 1)
    with open_app(browser, f"{app_url}/signin") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        region = announcements(page)
        soon(page, lambda: expect(region).to_have_count(1, timeout=SHORT_MS), 'one status "Announcements"')
        assert region.get_attribute("aria-live") in (None, "polite")
        page.get_by_role("textbox", name="Email").fill(o.email)
        page.get_by_label("Password", exact=True).fill("wrong-pass-1")
        page.get_by_role("button", name="Sign in").click()
        alerted(page, "That email and password don't match.")
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        page.get_by_role("button", name="Edit board").click()
        dialog = page.get_by_role("dialog", name="Edit board")
        visible(page, dialog, 'dialog "Edit board" opens')
        dialog.get_by_role("button", name="Delete board").click()
        confirm = page.get_by_role("alertdialog", name=f"Delete Board {k.t}?")
        visible(page, confirm, "the delete confirmation opens")
        confirm.get_by_role("button", name="Delete board").click()
        soon(page, lambda: assert_true(urllib.parse.urlparse(page.url).path == "/boards"), "deleting goes to /boards")
        says(page, "Board deleted")
        expect(announcements(page)).to_have_count(1)
    assert_error(api.call("GET", f"/api/boards/{w['b']}"), 404, "not_found")


def check_trap(page: Page, opener: Locator, dialog: Locator, what: str) -> None:
    opener.focus()
    page.keyboard.press("Enter")
    visible(page, dialog, f"{what} opens")
    soon(page, lambda: assert_true(focus_inside(dialog)), f"focus moves into {what}")
    for key in ("Tab", "Shift+Tab"):
        for _ in range(TAB_PRESSES):
            page.keyboard.press(key)
            assert focus_inside(dialog), f"{key} keeps focus inside {what}"
    page.keyboard.press("Escape")
    hidden(page, dialog, f"Escape closes {what}")
    soon(page, lambda: expect(opener).to_be_focused(timeout=SHORT_MS), f"focus returns to the opener of {what}")


def test_dialogs_keep_and_return_focus(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, m = person("trapper"), person("member")
    w = seed_world(app_url, k, users=[o, m], boards=[board(k("b"), o, f"Traps {k.t}", members=((m, "editor"),))],
                   pins=[pin(k("p"), o, k("b"), f"Trap {k.t}")])
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        for opener, name in (("Add section", "Add section"), ("Edit board", "Edit board"),
                             ("Invite", "Invite collaborators"), ("Collaborators", "Collaborators")):
            btn = page.get_by_role("button", name=opener, exact=True)
            visible(page, btn, f"button {opener!r} shows")
            check_trap(page, btn, page.get_by_role("dialog", name=name, exact=True), f"dialog {name!r}")
        page.goto(f"{app_url}/boards")
        btn = page.get_by_role("button", name="Create board")
        visible(page, btn, 'button "Create board" shows')
        check_trap(page, btn, page.get_by_role("dialog", name="Create board"), 'dialog "Create board"')


def loaded(page: Page, loc: Locator) -> None:
    soon(page, lambda: assert_true(loc.locator("img").first.evaluate("i => i.complete && i.naturalWidth > 0")),
         "the card image has loaded")


def test_dimmed_grid_lit_focus(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("lamp")
    titles = [f"Lit {i} {k.t}" for i in range(2)]
    w = seed_world(app_url, k, users=[o], boards=[board(k("b"), o, f"Lit {k.t}")],
                   pins=[pin(k(f"p{i}"), o, k("b"), titles[i], alt=f"Pale card {i}", color="#e0e0d0") for i in range(2)])
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        a, b = card(page, titles[0], "Pale card 0"), card(page, titles[1], "Pale card 1")
        visible(page, b, "both cards show")
        loaded(page, a)
        loaded(page, b)
        page.mouse.move(1, 1)
        settle(a)
        settle(b)
        rest_a, rest_b = decode(capture(a)), decode(capture(b))
        a.hover()
        settle(a)
        changed(rest_a, decode(capture(a)))
        page.mouse.move(1, 1)
        settle(a)
        tab_into(page, grid(page))
        page.keyboard.press("ArrowRight")
        soon(page, lambda: assert_true(focused_pin(page) == w["p1"]), "ArrowRight focuses the second card")
        settle(b)
        changed(rest_b, decode(capture(b)))


CONTRAST_JS = """el => {
  const toRgb = c => { const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const x = cv.getContext('2d'); x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; return {r: d[0], g: d[1], b: d[2], a: d[3] / 255}; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fg = toRgb(getComputedStyle(el).color); let node = el, bg = null;
  while (node && node.nodeType === 1) { const c = toRgb(getComputedStyle(node).backgroundColor);
    if (c.a > 0) { bg = c; break; } node = node.parentElement; }
  bg = bg || {r: 255, g: 255, b: 255, a: 1}; const l1 = lum(fg), l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }"""

TARGET_JS = """els => els.map(e => { const r = e.getBoundingClientRect();
  return {w: r.width, h: r.height, name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)}; })
  .filter(b => b.w > 1 && b.h > 1)"""


def assert_targets(page: Page, where: str) -> None:
    for role in ("button", "link", "textbox", "searchbox", "combobox"):
        for box in page.get_by_role(role).evaluate_all(TARGET_JS):
            assert box["w"] >= MIN_TARGET_PX - PX_TOL and box["h"] >= MIN_TARGET_PX - PX_TOL, \
                f"{where}: {role} {box['name']!r} is at least 44x44; got {box['w']:.0f}x{box['h']:.0f}"


def test_contrast_and_tap_targets(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("contrast")
    desc = f"A quiet print of a fern {k.t}"
    words = f"Lovely fern {k.t}"
    w = seed_world(app_url, k, users=[o], boards=[board(k("b"), o, f"Ferns {k.t}")],
                   pins=[pin(k("p"), o, k("b"), f"Fern {k.t}", description=desc)],
                   comments=[comment(k("c"), k("p"), o, words)])
    with open_app(browser, f"{app_url}/") as page:
        for size in (DESKTOP, PHONE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(f"{app_url}/")
            visible(page, page.get_by_role("link", name="Sign up"), "the landing page shows")
            axe(page)
            assert_targets(page, f"landing at {size[0]}")
    with browse(browser, app_url, o, f"/pin/{w['p']}") as page:
        for size in (DESKTOP, PHONE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            for path in (f"/pin/{w['p']}", f"/b/{w['b']}"):
                page.goto(f"{app_url}{path}")
                visible(page, page.get_by_role("main"), f"{path} renders")
                if path.startswith("/pin"):
                    for words_ in (desc, words):
                        loc = page.get_by_text(words_, exact=True).first
                        visible(page, loc, f"{words_!r} shows")
                        assert loc.evaluate(CONTRAST_JS) >= CONTRAST_MIN, f"running text {words_!r} has 7:1 contrast"
                if path.startswith("/pin"):
                    axe(page)
                assert_targets(page, f"{path} at {size[0]}")


def test_column_count_from_window_width(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("columns")
    w = seed_world(app_url, k, users=[o], boards=[board(k("b"), o, f"Cols {k.t}", sections=((k("s"), f"Shelf {k.t}"),))],
                   pins=[pin(k("p0"), o, k("b"), f"Col 0 {k.t}"), pin(k("p1"), o, k("b"), f"Col 1 {k.t}", section=k("s"))])
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        for width, n in COLUMN_CASES.items():
            heights = (DESKTOP[1], TALL_DESKTOP[1]) if width == DESKTOP[0] else (DESKTOP[1],)
            for height in heights:
                page.set_viewport_size({"width": width, "height": height})
                page.reload()
                for g in (grid(page), grid(page, f"Shelf {k.t}")):
                    soon(page, lambda g=g: (expect(g).to_have_attribute("data-columns", str(n), timeout=SHORT_MS),
                                            expect(g).to_have_attribute("data-column-width", str(column_width(width)), timeout=SHORT_MS)),
                         f"at {width}x{height} the grid has {n} columns")


def test_masonry_placement(browser: Browser, app_url: str) -> None:
    dims = [(800, 1200), (1000, 1000), (600, 1200), (900, 1200), (1000, 800), (800, 800), (700, 1000), (1000, 700), (640, 480)]
    k, o, w, titles, alts = simple_world(app_url, "masonry", dims=dims)
    api = Api(app_url, o)
    order = board_json(api, w["b"])["order"]["unsectioned"]
    assert order == [w[f"p{i}"] for i in range(len(dims))]
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        for width, height in (PHONE, TABLET, (1024, 768), DESKTOP, WIDE_DESKTOP):
            page.set_viewport_size({"width": width, "height": height})
            page.reload()
            g = grid(page)
            soon(page, lambda: assert_true(tuples(read_cards(g)) == place(width, dims)), f"placement at {width}")
            assert grid_ids(g) == order, "data-order follows the board order"
            expect(card(page, titles[0], alts[0])).to_have_attribute("data-order", "0")


def resize_now(page: Page, width: int, height: int) -> None:
    page.evaluate("() => { window.__mlResized = 0; addEventListener('resize', () => { window.__mlResized += 1; }); }")
    page.set_viewport_size({"width": width, "height": height})
    deadline = time.monotonic() + UI_WAIT_S
    while time.monotonic() < deadline and not page.evaluate("() => window.__mlResized > 0"):
        page.evaluate("() => 0")
    advance(page, FRAME_MS)


def test_reflow_on_resize(browser: Browser, app_url: str) -> None:
    dims = [(800, 1200), (1200, 600), (1000, 1000), (600, 900), (900, 600), (1000, 1400), (800, 800), (1500, 800)]
    k, o, w, _, _ = simple_world(app_url, "reflow", dims=dims)
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        soon(page, lambda: assert_true(tuples(read_cards(g)) == place(DESKTOP[0], dims)), "placement at 1280")
        page.evaluate("() => { window.__mlProbe = 'kept'; }")
        for width, height in (TABLET, PHONE, DESKTOP):
            resize_now(page, width, height)
            deadline = time.monotonic() + LIVE_MAX_S
            while time.monotonic() < deadline and tuples(read_cards(g)) != place(width, dims):
                pass
            assert tuples(read_cards(g)) == place(width, dims), f"one frame after resizing to {width} the grid is placed anew"
            assert g.get_attribute("data-columns") == str(columns_for(width))
            assert page.evaluate("() => window.__mlProbe") == "kept", "resizing does not reload the page"


def test_grid_keyboard_navigation(browser: Browser, app_url: str) -> None:
    dims = [(600, 900), (600, 600), (600, 1200), (600, 700), (600, 800), (600, 600), (600, 1000), (600, 650)]
    k, o, w, titles, alts = simple_world(app_url, "keys", dims=dims)
    ids = [w[f"p{i}"] for i in range(len(dims))]
    placed = place(DESKTOP[0], dims)
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        wait_cards(page, g, len(dims))
        tab_into(page, g)
        assert focused_pin(page) == ids[0], "the first card by data-order takes the tab stop"
        page.keyboard.press("Tab")
        assert not focus_inside(g), "one Tab leaves the grid"
        page.keyboard.press("Shift+Tab")
        assert focused_pin(page) == ids[0]
        def at(i: int) -> None:
            page.keyboard.press("Home")
            for _ in range(i):
                page.keyboard.press("ArrowRight")
            soon(page, lambda: assert_true(focused_pin(page) == ids[i]), f"ArrowRight reaches order {i}")
        page.keyboard.press("End")
        assert focused_pin(page) == ids[-1], "End focuses the last card"
        page.keyboard.press("ArrowLeft")
        assert focused_pin(page) == ids[-2]
        for i in range(len(dims)):
            for key, down in (("ArrowDown", True), ("ArrowUp", False)):
                at(i)
                page.keyboard.press(key)
                expected = ids[arrow_target(placed, i, down)]
                soon(page, lambda: assert_true(focused_pin(page) == expected), f"{key} from order {i}")
        at(3)
        page.keyboard.press("Tab")
        page.keyboard.press("Shift+Tab")
        assert focused_pin(page) == ids[3], "the last focused card keeps the grid's tab stop"
        page.keyboard.press("Enter")
        soon(page, lambda: assert_true(page.url.endswith(f"/pin/{ids[3]}")), "Enter opens the pin")


def test_wide_pins_span_two_columns(browser: Browser, app_url: str) -> None:
    for width, expected in ((DESKTOP[0], WORKED_1280), (WORKED_WIDTHS[1], WORKED_1000)):
        assert place(width, WORKED_PINS) == expected
    k, o, w, _, _ = simple_world(app_url, "wide", dims=WORKED_PINS)
    ids = [w[f"p{i}"] for i in range(len(WORKED_PINS))]
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        for width, expected in ((DESKTOP[0], WORKED_1280), (WORKED_WIDTHS[1], WORKED_1000)):
            page.set_viewport_size({"width": width, "height": DESKTOP[1]})
            page.reload()
            soon(page, lambda: assert_true(tuples(read_cards(g)) == expected), f"worked example at {width}")
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        page.reload()
        soon(page, lambda: assert_true(tuples(read_cards(g)) == WORKED_1280), "worked example at 1280")
        tab_into(page, g)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowDown")
        soon(page, lambda: assert_true(focused_pin(page) == ids[5]), "from the wide card ArrowDown goes to the sixth")
        page.keyboard.press("End")
        page.keyboard.press("ArrowUp")
        soon(page, lambda: assert_true(focused_pin(page) == ids[2]), "from the seventh ArrowUp goes to the wide card")
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.reload()
        soon(page, lambda: assert_true([c["span"] for c in read_cards(g)] == [1] * len(ids)), "no pin spans at 375")
        assert read_cards(g)[0]["height"] == NARROW_FIRST_HEIGHT


def feed_world(base: str, n: int, *, wide_at: int | None = None) -> tuple[Keys, User, User, World, list[str], list[str]]:
    k = Keys()
    v, a = person("browser"), person("artist")
    now = business_now(base)
    titles = [f"Feed {i} {k.t}" for i in range(n)]
    alts = [f"Feed print {i}" for i in range(n)]
    pins = [pin(k(f"p{i}"), a, k("b"), titles[i], alt=alts[i], w=1200 if i == wide_at else 600,
                h=600 if i == wide_at else 600 + 70 * (i % 5), at=ago(now, minutes=i + 1)) for i in range(n)]
    w = seed_world(base, k, users=[v, a], boards=[board(k("b"), a, f"Feed {k.t}")], pins=pins, follows=[follow_user(v, a)])
    return k, v, a, w, titles, alts


def feed_dims(api: Api) -> tuple[list[int], list[tuple[int, int]]]:
    pins = api.ok("GET", "/api/feed")["pins"]
    return [p["id"] for p in pins], [(p["image"]["width"], p["image"]["height"]) for p in pins]


def open_and_close(page: Page, browser_close: str, titles: dict[int, str]) -> None:
    g = grid(page)
    tab_into(page, g)
    page.keyboard.press("End")
    page.keyboard.press("ArrowLeft")
    target = soon(page, lambda: focused_pin(page) or pytest.fail("a card has focus"), "a card has focus")
    scroll = page.evaluate("() => scrollY")
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name=titles[target])
    visible(page, dialog, "the pin opens as an exhibit dialog")
    assert page.url.endswith(f"/pin/{target}")
    if browser_close == "escape":
        page.keyboard.press("Escape")
    elif browser_close == "back":
        page.go_back()
    else:
        dialog.get_by_role("button", name="Close").click()
    hidden(page, dialog, "the exhibit closes")
    soon(page, lambda: assert_true(focused_pin(page) == target), "focus returns to the same card")
    assert abs(page.evaluate("() => scrollY") - scroll) <= PX_TOL, "scroll position is restored"
    assert urllib.parse.urlparse(page.url).path == "/"


def masonry_journey(browser: Browser, app_url: str, how: str) -> None:
    k, v, a, w, titles, alts = feed_world(app_url, 14, wide_at=2)
    api = Api(app_url, v)
    ids, dims = feed_dims(api)
    by_id = {w[f"p{i}"]: titles[i] for i in range(len(titles))}
    with browse(browser, app_url, v, "/", api=api) as page:
        g = grid(page)
        for width, height in (DESKTOP, TABLET):
            page.set_viewport_size({"width": width, "height": height})
            soon(page, lambda: assert_true(grid_ids(g) == ids and tuples(read_cards(g)) == place(width, dims)),
                 f"the feed is placed at {width}")
        open_and_close(page, how, by_id)
    assert feed_dims(api)[0] == ids


def test_wf_masonry_reflow_keys_happy(browser: Browser, app_url: str) -> None:
    masonry_journey(browser, app_url, "escape")


def test_wf_masonry_reflow_keys_back(browser: Browser, app_url: str) -> None:
    masonry_journey(browser, app_url, "back")


def test_wf_masonry_reflow_keys_close(browser: Browser, app_url: str) -> None:
    masonry_journey(browser, app_url, "close")


def test_home_feed_membership_and_order(app_url: str) -> None:
    k = Keys()
    now = business_now(app_url)
    v, a, c, d, e = (person(x) for x in ("viewer", "alpha", "gamma", "delta", "echo"))
    boards = [board(k("ap"), a, "Alpha public"), board(k("as"), a, "Alpha secret", visibility="secret"),
              board(k("cp"), c, "Gamma followed"), board(k("co"), c, "Gamma other"),
              board(k("ds"), d, "Delta shared", visibility="secret", members=((v, "viewer"),)),
              board(k("ep"), e, "Echo public"), board(k("vo"), v, "Viewer own")]
    spec = [("a1", "ap", a, 90), ("a2", "ap", a, 30), ("as1", "as", a, 20), ("c1", "cp", c, 50), ("co1", "co", c, 10),
            ("d1", "ds", d, 40), ("e1", "ep", e, 5), ("v1", "vo", v, 60), ("v2", "vo", v, 30)]
    pins = [pin(k(key), owner, k(bk), f"Feed {key} {k.t}", at=ago(now, minutes=m)) for key, bk, owner, m in spec]
    w = seed_world(app_url, k, users=[v, a, c, d, e], boards=boards, pins=pins,
                   follows=[follow_user(v, a), follow_board(v, k("cp")), follow_board(v, k("ap"))])
    feed = Api(app_url, v).ok("GET", "/api/feed")["pins"]
    assert [p["id"] for p in feed] == [w[x] for x in ("a2", "v2", "d1", "c1", "v1", "a1")]
    for p in feed:
        assert p["group"]["size"] == 1 and p["group"]["owners"] == [p["owner"]["name"]]
    k2 = Keys()
    cap = person("capped")
    many = [pin(k2(f"m{i}"), cap, k2("b"), f"Cap {i} {k2.t}", at=ago(now, minutes=i + 1)) for i in range(FEED_MAX + 3)]
    w2 = seed_world(app_url, k2, users=[cap], boards=[board(k2("b"), cap, f"Cap {k2.t}")], pins=many)
    ids = [p["id"] for p in Api(app_url, cap).ok("GET", "/api/feed")["pins"]]
    assert ids == [w2[f"m{i}"] for i in range(FEED_MAX)], "the feed holds the newest 60"


def test_new_pins_wait_for_the_browser(browser: Browser, app_url: str) -> None:
    k, v, a, w, _, _ = feed_world(app_url, 3)
    api = Api(app_url, v)
    with browse(browser, app_url, v, "/", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        before = grid_ids(g)
        ids1 = {k("n1"): upload(Api(app_url, a), png(300, 300, random_rgb()), title=f"New one {k.t}",
                                alt="New print one", board_id=w["b"]).json()["id"]}
        visible(page, page.get_by_role("button", name="Show 1 new pin"), 'button "Show 1 new pin" appears', LIVE_MAX_S + LIVE_SLACK_S)
        says(page, "1 new pin")
        assert grid_ids(g) == before, "the open feed does not shift"
        ids2 = {k("n2"): upload(Api(app_url, a), png(300, 300, random_rgb()), title=f"New two {k.t}",
                                alt="New print two", board_id=w["b"]).json()["id"]}
        waiting = len([ids1, ids2])
        button = page.get_by_role("button", name=f"Show {waiting} new pins")
        visible(page, button, "the plural new-pins button appears", LIVE_MAX_S + LIVE_SLACK_S)
        assert grid_ids(g) == before
        button.click()
        expected = [ids2[k("n2")], ids1[k("n1")]] + before
        soon(page, lambda: assert_true(grid_ids(g) == expected), "the new pins are inserted in feed order")
        soon(page, lambda: assert_true(focused_pin(page) == ids2[k("n2")]), "the first new card has focus")
    assert feed_dims(api)[0] == expected


def follow_button(page: Page) -> Locator:
    return page.get_by_role("button", name=re.compile(r"^Follow(ing)?$"))


def test_follows_and_follower_counts(browser: Browser, app_url: str) -> None:
    k = Keys()
    v, a = person("fan"), person("maker")
    w = seed_world(app_url, k, users=[v, a], boards=[board(k("b"), a, f"Followed {k.t}"), board(k("vb"), v, f"Own {k.t}")])
    api = Api(app_url, v)
    assert api.ok("PUT", f"/api/follows/users/{a.id}") == {"following": True, "followers": 1}
    assert api.ok("DELETE", f"/api/follows/users/{a.id}") == {"following": False, "followers": 0}
    assert_error(api.call("PUT", f"/api/follows/users/{v.id}"), 422, "validation", "user")
    assert_error(api.call("PUT", f"/api/follows/boards/{w['vb']}"), 422, "validation", "board")
    with ExitStack() as stack:
        mine = stack.enter_context(browse(browser, app_url, a, f"/u/{a.handle}"))
        theirs = stack.enter_context(browse(browser, app_url, v, f"/u/{a.handle}", api=api))
        shows_text(mine, "0 followers", "the profile shows 0 followers")
        btn = follow_button(theirs)
        visible(theirs, btn, "the Follow button shows")
        expect(btn).to_have_attribute("aria-pressed", "false")
        btn.click()
        soon(theirs, lambda: (expect(btn).to_have_attribute("aria-pressed", "true", timeout=SHORT_MS),
                              expect(btn).to_have_text("Following", timeout=SHORT_MS)), "the button is pressed and reads Following")
        live(mine, lambda: expect(mine.get_by_text("1 follower", exact=True).first).to_be_visible(timeout=SHORT_MS),
             "the other window shows 1 follower live")
        btn.click()
        live(mine, lambda: expect(mine.get_by_text("0 followers", exact=True).first).to_be_visible(timeout=SHORT_MS),
             "unfollowing shows 0 followers live")
        mine.goto(f"{app_url}/b/{w['b']}")
        theirs.goto(f"{app_url}/b/{w['b']}")
        shows_text(mine, "0 followers", "the board shows 0 followers")
        follow_button(theirs).click()
        live(mine, lambda: expect(mine.get_by_text("1 follower", exact=True).first).to_be_visible(timeout=SHORT_MS),
             "the board follower count updates live")
    assert board_json(api, w["b"])["followers"] == 1 and api.ok("GET", f"/api/users/{a.handle}")["followers"] == 0


def group_world(base: str) -> tuple[Keys, User, dict[str, User], World]:
    k = Keys()
    now = business_now(base)
    v, a, b, c, a2, b2 = (person(x) for x in ("viewer", "anna", "bea", "cleo", "ada", "bo"))
    boards = [board(k(f"{x}b"), u, f"Board {x} {k.t}") for x, u in (("a", a), ("b", b), ("c", c), ("a2", a2), ("b2", b2))]
    w = seed_world(base, k, users=[v, a, b, c, a2, b2], boards=boards,
                   pins=[pin(k("o1"), a, k("ab"), f"Group one {k.t}", alt="Group alt one", at=ago(now, hours=3)),
                         pin(k("o2"), a2, k("a2b"), f"Group two {k.t}", alt="Group alt two", at=ago(now, hours=3))],
                   saves=[save(k("s1b"), k("o1"), b, k("bb"), at=ago(now, hours=2)),
                          save(k("s1c"), k("o1"), c, k("cb"), at=ago(now, hours=1)),
                          save(k("s2b"), k("o2"), b2, k("b2b"), at=ago(now, hours=2))],
                   follows=[follow_user(v, u) for u in (a, b, c, a2, b2)])
    return k, v, {"a": a, "b": b, "c": c, "a2": a2, "b2": b2}, w


def test_grouped_saves_in_feed(browser: Browser, app_url: str) -> None:
    k, v, p, w = group_world(app_url)
    api = Api(app_url, v)
    feed = {e["id"]: e for e in api.ok("GET", "/api/feed")["pins"]}
    for hidden_id in (w["o1"], w["s1b"], w["o2"]):
        assert hidden_id not in feed, "grouped pins show once, as the newest"
    assert feed[w["s1c"]]["group"] == {"size": 3, "owners": [p["c"].name, p["b"].name, p["a"].name]}
    assert feed[w["s2b"]]["group"] == {"size": 2, "owners": [p["b2"].name, p["a2"].name]}
    with browse(browser, app_url, v, "/", api=api) as page:
        one = card(page, f"Group one {k.t}", "Group alt one")
        two = card(page, f"Group two {k.t}", "Group alt two")
        visible(page, two, "the second group card shows")
        expect(one).to_have_count(1)
        expect(one).to_have_attribute("data-group-size", "3")
        expect(one).to_contain_text(f"Saved by {p['c'].name} and 2 others")
        expect(two).to_have_attribute("data-group-size", "2")
        expect(two).to_contain_text(f"Saved by {p['b2'].name} and {p['a2'].name}")


def test_wf_feed_order_live_happy(browser: Browser, app_url: str) -> None:
    k, v, a, w, _, _ = feed_world(app_url, 3)
    api_v, api_a = Api(app_url, v), Api(app_url, a)
    ids, _ = feed_dims(api_v)
    with ExitStack() as stack:
        pv = stack.enter_context(browse(browser, app_url, v, "/", api=api_v))
        pa = stack.enter_context(browse(browser, app_url, a, "/create", api=api_a))
        soon(pv, lambda: assert_true(grid_ids(grid(pv)) == ids), "the feed is in the published order")
        fill_composer(pa, image=png(300, 300, random_rgb()), title=f"Fresh {k.t}", alt="Fresh print", board_name=f"Feed {k.t}")
        pa.get_by_role("button", name="Publish").click()
        new_id = int(soon(pa, lambda: re.search(r"/pin/(\d+)$", pa.url).group(1), "publishing opens the new pin"))
        btn = pv.get_by_role("button", name="Show 1 new pin")
        visible(pv, btn, "the new pin is offered live", LIVE_MAX_S + LIVE_SLACK_S)
        btn.click()
        soon(pv, lambda: assert_true(focused_pin(pv) == new_id and grid_ids(grid(pv))[0] == new_id), "the new pin is first and focused")
        pa.goto(f"{app_url}/u/{a.handle}")
        shows_text(pa, "1 follower", "the pinner sees 1 follower")
        pv.goto(f"{app_url}/u/{a.handle}")
        follow_button(pv).click()
        live(pa, lambda: expect(pa.get_by_text("0 followers", exact=True).first).to_be_visible(timeout=SHORT_MS),
             "the pinner's window shows the follower change")
    assert new_id not in feed_dims(api_v)[0], "after unfollowing, the pinner's pin leaves the viewer's feed"
    assert api_v.ok("GET", f"/api/users/{a.handle}")["followers"] == 0


def test_wf_feed_order_live_grouped(browser: Browser, app_url: str) -> None:
    k = Keys()
    v, a, b = person("viewer"), person("anna"), person("bea")
    w = seed_world(app_url, k, users=[v, a, b], boards=[board(k("ab"), a, f"A {k.t}"), board(k("bb"), b, f"B {k.t}")],
                   pins=[pin(k("o"), a, k("ab"), f"Root {k.t}", alt="Root alt")], follows=[follow_user(v, a), follow_user(v, b)])
    api = Api(app_url, v)
    with browse(browser, app_url, v, "/", api=api) as page:
        c = card(page, f"Root {k.t}", "Root alt")
        visible(page, c, "the original shows")
        saved = Api(app_url, b).ok("POST", f"/api/pins/{w['o']}/saves", {"board": w["bb"], "section": None}, status=201)
        btn = page.get_by_role("button", name="Show 1 new pin")
        visible(page, btn, "the save is offered", LIVE_MAX_S + LIVE_SLACK_S)
        btn.click()
        soon(page, lambda: (expect(c).to_have_count(1, timeout=SHORT_MS), expect(c).to_have_attribute("data-group-size", "2", timeout=SHORT_MS),
                            expect(c).to_contain_text(f"Saved by {b.name} and {a.name}", timeout=SHORT_MS)), "the group card is regrouped")
        assert c.get_attribute("data-pin-id") == str(saved["id"]) and focused_pin(page) == saved["id"]
    entry = next(e for e in api.ok("GET", "/api/feed")["pins"] if e["id"] == saved["id"])
    assert entry["group"]["size"] == 2


def composer_user(base: str, label: str) -> tuple[Keys, User, World, Api]:
    k = Keys()
    u = person(label)
    w = seed_world(base, k, users=[u], boards=[board(k("b"), u, f"Desk {k.t}")])
    return k, u, w, Api(base, u)


def test_composer_counters(browser: Browser, app_url: str) -> None:
    lim = config(app_url)["limits"]
    tmax, dmax, cmax = lim["title_max"], lim["description_max"], lim["comment_max"]
    k, u, w, api = composer_user(app_url, "counter")
    assert upload(api, png(64, 64, random_rgb()), title=f"Counted {k.t}", alt="Counted print",
                  board_id=w["b"]).status_code == 201
    r = upload(api, png(64, 64, random_rgb()), title="🦋" * (tmax + 1), alt="Too long", board_id=w["b"])
    assert_error(r, 422, "validation", "title", "the server counts code points")
    assert upload(api, png(64, 64, random_rgb()), title="🦋" * tmax, alt="Exact", board_id=w["b"]).status_code == 201
    with browse(browser, app_url, u, "/create", api=api) as page:
        title = page.get_by_role("textbox", name="Title")
        visible(page, title, "the composer shows")
        title.focus()
        page.keyboard.type("ab🦋")
        shows_text(page, f"3 / {tmax}", "the title counter counts code points")
        fill_composer(page, image=png(80, 80, random_rgb()), title="ok", alt="Counter print", board_name=f"Desk {k.t}", description="")
        publish = page.get_by_role("button", name="Publish")
        soon(page, lambda: expect(publish).to_be_enabled(timeout=SHORT_MS), "Publish is enabled within limits")
        title.fill("x" * (tmax + 2))
        shows_text(page, "2 over the limit", "the title is over the limit")
        expect(publish).to_be_disabled()
        title.fill("x" * tmax)
        shows_text(page, f"{tmax} / {tmax}", "the limit itself is allowed")
        page.get_by_role("textbox", name="Description").fill("d" * (dmax + 1))
        shows_text(page, "1 over the limit", "the description is over the limit")
        expect(publish).to_be_disabled()
        page.get_by_role("textbox", name="Description").fill("d")
        soon(page, lambda: expect(publish).to_be_enabled(timeout=SHORT_MS), "Publish is enabled again")
        page.goto(f"{app_url}/pin/{seed_pin_id(app_url, api, k)}")
        box = page.get_by_role("textbox", name="Add a comment")
        visible(page, box, "the comment box shows")
        box.focus()
        page.keyboard.type("hi🦋")
        shows_text(page, f"3 / {cmax}", "the comment counter counts code points")
        box.fill("c" * (cmax + 4))
        shows_text(page, "4 over the limit", "the comment is over the limit")


def seed_pin_id(base: str, api: Api, k: Keys) -> int:
    pins = api.ok("GET", f"/api/users/{api.user.handle}/pins")["pins"]
    return next(p["id"] for p in pins if p["title"] == f"Counted {k.t}")


def test_required_alt_text(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "alt")
    for alt in ("", "   "):
        assert_error(upload(api, png(64, 64, random_rgb()), title=f"Alt {k.t}", alt=alt, board_id=w["b"]), 422, "validation", "alt")
    assert_error(upload(api, png(64, 64, random_rgb()), title=f"Alt {k.t}", alt="a" * (ALT_MAX + 1), board_id=w["b"]), 422, "validation", "alt")
    assert upload(api, png(64, 64, random_rgb()), title=f"Alt ok {k.t}", alt="a" * ALT_MAX, board_id=w["b"]).status_code == 201
    with browse(browser, app_url, u, "/create", api=api) as page:
        visible(page, page.get_by_role("textbox", name="Title"), "the composer shows")
        fill_composer(page, image=png(90, 90, random_rgb()), title=f"No alt {k.t}", alt="", board_name=f"Desk {k.t}")
        page.get_by_role("button", name="Publish").click()
        alerted(page, "Add alt text so everyone knows what this pin shows.")
    titles = [p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]]
    assert f"No alt {k.t}" not in titles and titles.count(f"Alt ok {k.t}") == 1


def test_tags_from_text(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "tagger")
    t = k.t
    desc = f"#kitchen{t} #blue_door{t} x#nottag #{'a' * (TAG_RUN_MAX + 1)} #{'b' * TAG_RUN_MAX}"
    r = upload(api, png(64, 64, random_rgb()), title=f"Blue #Kitchen{t.upper()} door", alt="Tag print",
               board_id=w["b"], description=desc)
    assert r.status_code == 201
    p = r.json()
    assert p["tags"] == [f"kitchen{t}", f"blue_door{t}", "b" * TAG_RUN_MAX]
    with browse(browser, app_url, u, f"/pin/{p['id']}", api=api) as page:
        for tag in p["tags"]:
            visible(page, page.get_by_role("link", name=f"#{tag}", exact=True), f"tag #{tag} is a link")
        page.get_by_role("link", name=f"#kitchen{t}", exact=True).click()
        visible(page, card(page, p["title"], "Tag print"), "the tag link leads to results holding the pin")
    hits = api.ok("GET", f"/api/search?q=&tag=KITCHEN{t.upper()}")["pins"]
    assert [h["id"] for h in hits] == [p["id"]], "tag matching ignores case"


def test_source_link_rule(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "source")
    cases = {"https://WWW.Example.COM:443/a": "example.com", "http://shop.example.org:8080/x": "shop.example.org:8080"}
    created = {}
    for i, (src, host) in enumerate(cases.items()):
        r = upload(api, png(64, 64, random_rgb()), title=f"Src {i} {k.t}", alt="Source print", board_id=w["b"], source=src)
        assert r.status_code == 201 and r.json()["source"] == src and r.json()["source_host"] == host
        created[host] = (r.json()["id"], src)
    for bad in ("ftp://files.example/a", "example.com/a", "/relative/path", "javascript:alert(1)"):
        assert_error(upload(api, png(64, 64, random_rgb()), title=f"Bad {k.t}", alt="Bad", board_id=w["b"], source=bad),
                     422, "validation", "source", f"source {bad!r}")
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("0.0.0.0", 0))
    listener.listen(1)
    listener.settimeout(FETCH_WATCH_S)
    ip = socket.gethostbyname(socket.gethostname())
    port = listener.getsockname()[1]
    try:
        r = upload(api, png(64, 64, random_rgb()), title=f"Probe {k.t}", alt="Probe", board_id=w["b"],
                   source=f"http://{ip}:{port}/source-probe")
        assert r.status_code == 201 and r.json()["source_host"] == f"{ip}:{port}"
        try:
            conn, _ = listener.accept()
            conn.close()
            pytest.fail("the source link is never fetched")
        except socket.timeout:
            pass
    finally:
        listener.shutdown(socket.SHUT_RDWR) if False else None
        listener.close()
    pid, src = created["example.com"]
    with browse(browser, app_url, u, f"/pin/{pid}", api=api) as page:
        link = page.get_by_role("link", name="example.com", exact=True)
        visible(page, link, "the source shows as its host")
        assert link.get_attribute("href") == src


def test_metadata_free_stored_images(app_url: str) -> None:
    k = Keys()
    u, o = person("printer"), person("source")
    w = seed_world(app_url, k, users=[u, o], boards=[board(k("b"), u, f"Prints {k.t}"), board(k("ob"), o, f"Source {k.t}")],
                   pins=[pin(k("j"), o, k("ob"), f"Jpeg base {k.t}", w=800, h=500, fmt="jpeg")])
    api, s3 = Api(app_url, u), S3()
    rotated = with_exif_orientation(seeded_jpeg(api, w["j"]), 6)
    before = image_ids(s3)
    r = upload(api, rotated, filename="turned.jpg", mime="image/jpeg", title=f"Turned {k.t}", alt="Turned print", board_id=w["b"])
    assert r.status_code == 201
    p = r.json()
    assert (p["image"]["width"], p["image"]["height"]) == (500, 800), "orientation is applied before measuring"
    assert sorted(v["width"] for v in p["image"]["variants"]) == [w_ for w_ in VARIANT_WIDTHS if w_ <= 500]
    new = image_ids(s3) - before
    found = [i for i in new if f"images/{i}/original.jpg" in s3.keys(f"images/{i}/")
             and jpeg_size(s3.get(f"images/{i}/original.jpg")) == (500, 800)]
    assert found, "MinIO holds the upright original"
    keys = set(s3.keys(f"images/{found[0]}/"))
    assert jpeg_metadata(s3.get(f"images/{found[0]}/original.jpg")) == [], "no EXIF, XMP, ICC or comment blocks"
    assert {f"images/{found[0]}/w{x}.jpg" for x in VARIANT_WIDTHS if x <= 500} <= keys
    assert f"images/{found[0]}/w{VARIANT_WIDTHS[2]}.jpg" not in keys
    rgb = random_rgb()
    meta_png = png(800, 600, rgb, chunks=((b"tEXt", b"Comment\x00private notes"), (b"zTXt", b"Author\x00\x00" + zlib.compress(b"someone"))))
    before = image_ids(s3)
    r = upload(api, meta_png, title=f"Png meta {k.t}", alt="Png print", board_id=w["b"])
    assert r.status_code == 201
    p = r.json()
    assert p["image"]["sha256"] == rgba_sha(800, 600, rgb), "the hash covers decoded RGBA pixels"
    found = [i for i in image_ids(s3) - before if f"images/{i}/original.png" in s3.keys(f"images/{i}/")]
    assert found, "MinIO holds the PNG original"
    stored = s3.get(f"images/{found[0]}/original.png")
    assert png_size(stored) == (800, 600)
    assert not {"tEXt", "zTXt", "iTXt", "eXIf", "iCCP"} & set(png_chunks(stored)), "text and metadata chunks are removed"
    assert {f"images/{found[0]}/w{x}.png" for x in VARIANT_WIDTHS} <= set(s3.keys(f"images/{found[0]}/"))
    for variant in p["image"]["variants"]:
        assert variant["url"] == f"/media/{p['id']}/{variant['width']}"
        got = media(api, p["id"], variant["width"])
        assert got.status_code == 200 and png_size(got.content)[0] == variant["width"]


def test_tag_suggestions(browser: Browser, app_url: str) -> None:
    k = Keys()
    v, other, many = person("suggest"), person("other"), person("many")
    descs = ["#kitchen #kiln", "#kitchen", "#kids #kitchen", "#kiln"]
    w = seed_world(app_url, k, users=[v, other, many],
                   boards=[board(k("b"), v, f"Tags {k.t}"), board(k("ob"), other, f"Other {k.t}"), board(k("mb"), many, f"Many {k.t}")],
                   pins=[pin(k(f"p{i}"), v, k("b"), f"Tag {i} {k.t}", description=d) for i, d in enumerate(descs)]
                   + [pin(k("o"), other, k("ob"), f"Kiwi {k.t}", description="#kiwi"),
                      pin(k("m"), many, k("mb"), f"Many {k.t}", description="#ka1 #ka2 #ka3 #ka4 #ka5 #ka6 #ka7")])
    api = Api(app_url, v)
    assert api.ok("GET", "/api/tags/suggest?prefix=Ki")["tags"] == [{"tag": "kitchen", "count": 3}, {"tag": "kiln", "count": 2}, {"tag": "kids", "count": 1}]
    assert api.ok("GET", "/api/tags/suggest?prefix=kil")["tags"] == [{"tag": "kiln", "count": 2}]
    many_tags = Api(app_url, many).ok("GET", "/api/tags/suggest?prefix=ka")["tags"]
    assert [t["tag"] for t in many_tags] == ["ka1", "ka2", "ka3", "ka4", "ka5"] and len(many_tags) == SUGGEST_MAX
    for bad in ("%23ki", "k" * (TAG_RUN_MAX + 1), ""):
        assert_error(api.call("GET", f"/api/tags/suggest?prefix={bad}"), 422, "validation", "prefix")
    with browse(browser, app_url, v, "/create", api=api) as page:
        desc = page.get_by_role("textbox", name="Description")
        visible(page, desc, "the composer shows")
        desc.focus()
        lead = f"{k.t} "
        page.keyboard.type(f"{lead}#Ki")
        box = page.get_by_role("listbox", name="Tag suggestions")
        visible(page, box, "suggestions open")
        expect(box.get_by_role("option")).to_have_text(["#kitchen (3)", "#kiln (2)", "#kids (1)"])
        expect(desc).to_have_attribute("aria-expanded", "true")
        assert desc.get_attribute("aria-activedescendant") in (None, ""), "no option is active at first"
        def active() -> str | None:
            ref = desc.get_attribute("aria-activedescendant")
            return page.evaluate("id => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; }", ref) if ref else None
        page.keyboard.press("ArrowDown")
        soon(page, lambda: assert_true(active() == "#kitchen (3)"), "ArrowDown activates the first option")
        for _ in range(4):
            page.keyboard.press("ArrowDown")
        soon(page, lambda: assert_true(active() == "#kids (1)"), "ArrowDown stops at the last")
        page.keyboard.press("ArrowUp")
        soon(page, lambda: assert_true(active() == "#kiln (2)"), "ArrowUp moves back")
        expect(desc).to_be_focused()
        page.keyboard.press("Enter")
        soon(page, lambda: expect(desc).to_have_value(f"{lead}#kiln ", timeout=SHORT_MS), "Enter inserts the tag and a space")
        hidden(page, box, "the list closes")
        page.keyboard.type("#kit")
        visible(page, box, "suggestions reopen")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Tab")
        soon(page, lambda: expect(desc).to_have_value(f"{lead}#kiln #kitchen ", timeout=SHORT_MS), "Tab inserts the active tag")
        page.keyboard.type("#ki")
        visible(page, box, "suggestions reopen")
        page.keyboard.press("Escape")
        hidden(page, box, "Escape closes the list")
        expect(desc).to_have_value(f"{lead}#kiln #kitchen #ki")
        expect(desc).to_be_focused()
        assert page.url.endswith("/create")
        page.keyboard.type("z")
        hidden(page, box, "a fragment with no match closes the list")


def keyboard_compose(page: Page, *, image: bytes, title: str, alt: str, board_name: str, description: str = "",
                     source: str = "") -> None:
    chooser = page.get_by_role("button", name="Choose image")
    visible(page, chooser, 'button "Choose image" shows')
    for attempt in range(3):
        chooser.focus()
        try:
            with page.expect_file_chooser(timeout=10_000) as fc:
                page.keyboard.press("Enter")
            break
        except PlaywrightTimeoutError:
            assert attempt < 2, "Enter on the focused Choose image button never opened a file chooser"
    fc.value.set_files({"name": "keyboard.png", "mimeType": "image/png", "buffer": image})
    for name, value in (("Title", title), ("Description", description), ("Alt text", alt), ("Source link", source)):
        type_into(page, page.get_by_role("textbox", name=name), value)
        if name == "Description":
            page.keyboard.press("Escape")
    select(page.get_by_role("combobox", name="Board"), board_name)


def press_publish(page: Page) -> None:
    btn = page.get_by_role("button", name="Publish")
    btn.focus()
    page.keyboard.press("Enter")


def test_wf_upload_keyboard_text_happy(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "keyboard")
    s3 = S3()
    before = image_ids(s3)
    with browse(browser, app_url, u, "/create", api=api) as page:
        keyboard_compose(page, image=png(320, 240, random_rgb()), title=f"Lantern{k.t} #Glow{k.t}", alt="A lantern print",
                         board_name=f"Desk {k.t}", description=f"Warm #amber{k.t}", source="https://WWW.Example.COM:443/a")
        press_publish(page)
        pid = int(soon(page, lambda: re.search(r"/pin/(\d+)$", page.url).group(1), "publishing opens /pin/<id>"))
        says(page, "Pin published")
        for tag in (f"glow{k.t}", f"amber{k.t}"):
            visible(page, page.get_by_role("link", name=f"#{tag}"), f"tag #{tag} links")
        visible(page, page.get_by_role("link", name="example.com"), "the source host shows")
        search = page.get_by_role("searchbox", name="Search pins")
        search.focus()
        page.keyboard.type(f"lantern{k.t}")
        page.keyboard.press("Enter")
        visible(page, card(page, f"Lantern{k.t} #Glow{k.t}", "A lantern print"), "search finds the new pin")
    p = api.ok("GET", f"/api/pins/{pid}")
    assert p["tags"] == [f"glow{k.t}", f"amber{k.t}"] and p["source_host"] == "example.com"
    assert image_ids(s3) - before, "the image is stored in MinIO"


def test_wf_upload_keyboard_text_refusals(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "refusal")
    with browse(browser, app_url, u, "/create", api=api) as page:
        keyboard_compose(page, image=png(200, 200, random_rgb()), title="", alt="Alt", board_name=f"Desk {k.t}")
        press_publish(page)
        alerted(page, "Add a title.")
        type_into(page, page.get_by_role("textbox", name="Title"), f"Refused {k.t}")
        type_into(page, page.get_by_role("textbox", name="Alt text"), "")
        press_publish(page)
        alerted(page, "Add alt text so everyone knows what this pin shows.")
        type_into(page, page.get_by_role("textbox", name="Alt text"), "Refusal print")
        type_into(page, page.get_by_role("textbox", name="Source link"), "ftp://files.example/a")
        press_publish(page)
        alerted(page, "Use a link that starts with http:// or https://.")
        type_into(page, page.get_by_role("textbox", name="Source link"), "https://files.example/a")
        press_publish(page)
        soon(page, lambda: assert_true(re.search(r"/pin/\d+$", page.url) is not None), "the corrected pin publishes")
    titles = [p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]]
    assert titles == [f"Refused {k.t}"]


def test_wf_upload_keyboard_text_signup(browser: Browser, app_url: str, mail: Any) -> None:
    t = tok()
    email = f"start.{t}@example.test"
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        page.get_by_role("link", name="Sign up").click()
        for name, value in (("Name", f"Starter {t}"), ("Email", email), ("Handle", f"start_{t}")):
            page.get_by_role("textbox", name=name).fill(value)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        page.get_by_role("button", name="Create account").click()
        visible(page, page.get_by_role("heading", name="Check your email"), "the code step shows")
        shows_text(page, f"We sent a code to {email}.", "the code step names the email")
        code = re.search(r"\d{6}", mails_to(mail, email)[0]["Subject"]).group(0)
        page.get_by_role("textbox", name="Code").fill(code)
        page.get_by_role("button", name="Confirm").click()
        soon(page, lambda: assert_true(urllib.parse.urlparse(page.url).path == "/"), "confirming goes to /")
        page.goto(f"{app_url}/boards")
        page.get_by_role("button", name="Create board").click()
        dialog = page.get_by_role("dialog", name="Create board")
        dialog.get_by_role("textbox", name="Name").fill(f"Start {t}")
        check(dialog.get_by_role("radio", name="Public"))
        dialog.get_by_role("button", name="Create").click()
        hidden(page, dialog, "the board is created")
        page.goto(f"{app_url}/create")
        fill_composer(page, image=png(200, 300, random_rgb()), title=f"First{t}", alt="First print", board_name=f"Start {t}")
        page.get_by_role("button", name="Publish").click()
        soon(page, lambda: assert_true("/pin/" in page.url), "the pin publishes")
    hits = httpx.get(f"{app_url}/api/session")
    api = Api(app_url, User("", email, PASSWORD, "", f"start_{t}"))
    assert [p["title"] for p in api.ok("GET", f"/api/search?q=first{t}")["pins"]] == [f"First{t}"]


def test_image_type_by_content(app_url: str) -> None:
    k = Keys()
    u, src = person("typer"), person("source")
    w = seed_world(app_url, k, users=[u, src],
                   boards=[board(k("b"), u, f"Types {k.t}"), board(k("sb"), src, f"Source {k.t}")],
                   pins=[pin(k("j"), src, k("sb"), f"Jpeg {k.t}", w=300, h=200, fmt="jpeg")])
    api, s3 = Api(app_url, u), S3()
    limit = config(app_url)["limits"]["image_max_bytes"]
    assert upload(api, png(64, 64, random_rgb()), filename="photo.gif", mime="image/gif", title=f"Png {k.t}", alt="Png", board_id=w["b"]).status_code == 201
    jpeg = with_exif_orientation(seeded_jpeg(api, w["j"]), 1)
    before = image_ids(s3)
    assert upload(api, jpeg, filename="photo.png", mime="image/png", title=f"Jpg {k.t}", alt="Jpg", board_id=w["b"]).status_code == 201
    assert any(f"images/{i}/original.jpg" in s3.keys(f"images/{i}/") for i in image_ids(s3) - before), "JPEG content is stored as .jpg"
    for data, name, mime in ((GIF_BYTES, "moth.png", "image/png"), (b"hello mothlight", "notes.jpg", "image/jpeg"),
                             (GIF_BYTES + b"\x00" * limit, "big.png", "image/png")):
        assert_error(upload(api, data, filename=name, mime=mime, title=f"Bad {k.t}", alt="Bad", board_id=w["b"]), 415, "unsupported_type")
    titles = [p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]]
    assert f"Bad {k.t}" not in titles


def test_image_byte_limit(browser: Browser, app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "bytes")
    limit = config(app_url)["limits"]["image_max_bytes"]
    assert upload(api, padded_png(limit, random_rgb()), title=f"Exact {k.t}", alt="Exact", board_id=w["b"]).status_code == 201
    over = padded_png(limit + 1, random_rgb())
    r = upload(api, over, title=f"Over {k.t}", alt="Over", board_id=w["b"])
    assert r.status_code == 413 and r.json() == {"error": "too_large", "max_bytes": limit}
    r = upload(api, padded_png(limit + 1, random_rgb()), title=f"Over {k.t}", alt="", board_id=w["b"])
    assert_error(r, 413, "too_large", what="413 comes before 422")
    r = upload(api, padded_png(limit + MULTIPART_EXTRA + 1024, random_rgb()), title=f"Huge {k.t}", alt="Huge", board_id=w["b"])
    assert r.status_code == 413, "a multipart body over the limit plus 65,536 bytes is cut off with 413"
    titles = [p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]]
    assert titles == [f"Exact {k.t}"]
    with browse(browser, app_url, u, "/create", api=api) as page:
        visible(page, page.get_by_role("textbox", name="Title"), "the composer shows")
        fill_composer(page, image=over, title=f"Over ui {k.t}", alt="Over", board_name=f"Desk {k.t}")
        page.get_by_role("button", name="Publish").click()
        alerted(page, f"Images must be {limit // KILO} KB or smaller.")
        assert page.url.endswith("/create")


def test_pixel_and_shape_limits(app_url: str) -> None:
    k, u, w, api = composer_user(app_url, "shape")
    max_px = config(app_url)["limits"]["image_max_pixels"]
    side = math.isqrt(max_px)
    exact = (side, max_px // side)
    cases_ok = [exact, (200, 100), (100, 200)]
    cases_bad = [(exact[0] + 1, exact[1]), (201, 100), (100, 201)]
    for i, (wd, ht) in enumerate(cases_ok):
        r = upload(api, png(wd, ht, random_rgb()), title=f"Ok {i} {k.t}", alt="Ok", board_id=w["b"])
        assert r.status_code == 201, f"{wd}x{ht} is allowed; got {r.status_code}"
        assert (r.json()["image"]["width"], r.json()["image"]["height"]) == (wd, ht), "never cropped"
    for wd, ht in cases_bad:
        assert_error(upload(api, png(wd, ht, random_rgb()), title=f"Bad {k.t}", alt="Bad", board_id=w["b"]),
                     422, "validation", "image", f"{wd}x{ht}")
    titles = sorted(p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"])
    assert titles == sorted(f"Ok {i} {k.t}" for i in range(3))


def test_duplicate_images(app_url: str) -> None:
    k = Keys()
    u, other = person("dupe"), person("stranger")
    now = business_now(app_url)
    color = "#3a6b5c"
    w = seed_world(app_url, k, users=[u, other],
                   boards=[board(k("a"), u, f"Alpha {k.t}"), board(k("b"), u, f"Beta {k.t}"), board(k("g"), u, f"Gamma {k.t}"),
                           board(k("o"), other, f"Other {k.t}")],
                   pins=[pin(k("old"), u, k("a"), f"Old {k.t}", w=300, h=300, color=color, at=ago(now, hours=2)),
                         pin(k("new"), u, k("b"), f"New {k.t}", w=300, h=300, color=color, at=ago(now, hours=1))])
    api = Api(app_url, u)
    same = png(300, 300, rgb_of(color), chunks=((b"tEXt", b"Comment\x00different metadata"),))
    body = assert_error(upload(api, same, title=f"Again {k.t}", alt="Again", board_id=w["g"]), 409, "duplicate_image")
    assert body["pin_id"] == w["old"] and body["board"] == {"id": w["a"], "name": f"Alpha {k.t}"}
    assert upload(Api(app_url, other), same, title=f"Theirs {k.t}", alt="Theirs", board_id=w["o"]).status_code == 201
    api.ok("DELETE", f"/api/pins/{w['old']}")
    body = assert_error(upload(api, same, title=f"Again {k.t}", alt="Again", board_id=w["g"]), 409, "duplicate_image")
    assert body["pin_id"] == w["new"] and body["board"]["name"] == f"Beta {k.t}"
    api.ok("DELETE", f"/api/pins/{w['new']}")
    assert upload(api, same, title=f"Again {k.t}", alt="Again", board_id=w["g"]).status_code == 201


def test_storage_confirmed_publishing(app_url: str) -> None:
    assert STORAGE_DOWN_URL, "APP_STORAGE_DOWN_URL names the storage-outage instance"
    k, u, w, api = composer_user(app_url, "confirm")
    s3 = S3()
    before = image_ids(s3)
    r = upload(api, png(300, 300, random_rgb()), title=f"Stored {k.t}", alt="Stored", board_id=w["b"])
    assert r.status_code == 201
    new = image_ids(s3) - before
    assert any({f"images/{i}/original.png", f"images/{i}/w{VARIANT_WIDTHS[0]}.png"} <= set(s3.keys(f"images/{i}/")) for i in new)
    pins_before = board_json(api, w["b"])["pin_count"]
    down = Api(STORAGE_DOWN_URL, u)
    assert_error(upload(down, png(300, 300, random_rgb()), title=f"Lost{k.t}", alt="Lost", board_id=w["b"]), 503, "storage_unavailable")
    assert board_json(api, w["b"])["pin_count"] == pins_before
    assert api.ok("GET", f"/api/search?q=lost{k.t}")["pins"] == []
    assert f"Lost{k.t}" not in [p["title"] for p in api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]]


def test_draft_kept_during_storage_outage(browser: Browser, app_url: str) -> None:
    assert STORAGE_DOWN_URL, "APP_STORAGE_DOWN_URL names the storage-outage instance"
    k = Keys()
    u, a = person("drafter"), person("artist")
    w = seed_world(app_url, k, users=[u, a], boards=[board(k("b"), u, f"Drafts {k.t}"), board(k("ab"), a, f"Art {k.t}")],
                   pins=[pin(k("ap"), a, k("ab"), f"Fern {k.t}")])
    down = Api(STORAGE_DOWN_URL, u)
    assert down.call("POST", f"/api/pins/{w['ap']}/saves", {"board": w["b"], "section": None}).status_code == 201
    assert down.call("POST", f"/api/pins/{w['ap']}/comments", {"text": "Still here", "parent": None}).status_code == 201
    assert_error(down.call("GET", f"/media/{w['ap']}/original"), 503, "storage_unavailable")
    posts: list[Any] = []
    with browse(browser, STORAGE_DOWN_URL, u, "/create", api=down,
                before=lambda p: p.on("request", lambda req: posts.append(req) if req.method == "POST" and "/api/pins" in req.url else None)) as page:
        visible(page, page.get_by_role("textbox", name="Title"), "the composer shows")
        fields = {"Title": f"Draft {k.t}", "Description": "Kept words", "Alt text": "Kept alt", "Source link": "https://kept.example/a"}
        fill_composer(page, image=png(240, 240, random_rgb()), title=fields["Title"], alt=fields["Alt text"],
                      board_name=f"Drafts {k.t}", description=fields["Description"], source=fields["Source link"])
        for attempt in (1, 2):
            page.get_by_role("button", name="Publish").click()
            alerted(page, "Images can't be uploaded right now. Your draft is kept.")
            for name, value in fields.items():
                expect(page.get_by_role("textbox", name=name)).to_have_value(value)
            soon(page, lambda: assert_true(len(posts) >= attempt), f"publish attempt {attempt} reaches the server")
        assert page.url.endswith("/create")


def test_wf_image_refusals_duplicate_composer(browser: Browser, app_url: str) -> None:
    k = Keys()
    u = person("refuse")
    color = "#5a7d6e"
    w = seed_world(app_url, k, users=[u], boards=[board(k("a"), u, f"Alpha {k.t}"), board(k("d"), u, f"Desk {k.t}")],
                   pins=[pin(k("p"), u, k("a"), f"Seen {k.t}", w=300, h=300, color=color)])
    api = Api(app_url, u)
    lim = config(app_url)["limits"]
    side = math.isqrt(lim["image_max_pixels"])
    refusals = [(GIF_BYTES, "Use a PNG or JPEG image."),
                (padded_png(lim["image_max_bytes"] + 1, random_rgb()), f"Images must be {lim['image_max_bytes'] // KILO} KB or smaller."),
                (png(side + 1, lim["image_max_pixels"] // side, random_rgb()), f"Images must be {lim['image_max_pixels'] / MEGA:.1f} megapixels or smaller."),
                (png(201, 100, random_rgb()), "Images must be between 1:2 and 2:1."),
                (png(300, 300, rgb_of(color)), f"You already saved this pin to Alpha {k.t}")]
    with browse(browser, app_url, u, "/create", api=api) as page:
        keyboard_compose(page, image=png(10, 10, random_rgb()), title=f"Refused {k.t}", alt="Refused", board_name=f"Desk {k.t}")
        for data, message in refusals:
            page.get_by_label("Image", exact=True).set_input_files({"name": "pick.png", "mimeType": "image/png", "buffer": data})
            press_publish(page)
            alerted(page, message)
            expect(page.get_by_role("textbox", name="Title")).to_have_value(f"Refused {k.t}")
        page.get_by_label("Image", exact=True).set_input_files({"name": "pick.png", "mimeType": "image/png", "buffer": png(320, 240, random_rgb())})
        press_publish(page)
        pid = int(soon(page, lambda: re.search(r"/pin/(\d+)$", page.url).group(1), "the valid image publishes"))
        says(page, "Pin published")
    assert api.ok("GET", f"/api/pins/{pid}")["title"] == f"Refused {k.t}"
    assert len(api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]) == 2


def test_wf_image_refusals_duplicate_outage(browser: Browser, app_url: str) -> None:
    assert STORAGE_DOWN_URL, "APP_STORAGE_DOWN_URL names the storage-outage instance"
    k, u, w, api = composer_user(app_url, "outage")
    down = Api(STORAGE_DOWN_URL, u)
    with browse(browser, STORAGE_DOWN_URL, u, "/create", api=down) as page:
        keyboard_compose(page, image=png(200, 200, random_rgb()), title=f"Dark{k.t}", alt=f"Alt {k.t}", board_name=f"Desk {k.t}")
        press_publish(page)
        alerted(page, "Images can't be uploaded right now. Your draft is kept.")
        expect(page.get_by_role("textbox", name="Alt text")).to_have_value(f"Alt {k.t}")
    assert api.ok("GET", f"/api/users/{u.handle}/pins")["pins"] == []
    assert api.ok("GET", f"/api/search?q=dark{k.t}")["pins"] == []

PLAIN_TOAST_MS = 6000
DEVICE_SKEW = timedelta(days=1)


def counted(n: int, one: str, many: str) -> str:
    return f"1 {one}" if n == 1 else f"{n} {many}"


def credit(api: Api, pin_id: int) -> tuple[int | None, bool]:
    sf = api.ok("GET", f"/api/pins/{pin_id}")["saved_from"]
    assert sf is not None, f"GET /api/pins/{pin_id} carries saved_from for a save"
    return sf["pin_id"], sf["removed"]


def save_dialog(page: Page) -> Locator:
    dlg = page.get_by_role("dialog", name="Save to board")
    visible(page, dlg, 'dialog "Save to board" opens')
    soon(page, lambda: expect(dlg.get_by_role("searchbox", name="Find a board")).to_be_focused(timeout=SHORT_MS),
         'focus starts on searchbox "Find a board"')
    return dlg


def save_by_keys(page: Page, word: str) -> None:
    dlg = save_dialog(page)
    page.keyboard.type(word)
    lb = dlg.get_by_role("listbox", name="Boards")
    soon(page, lambda: expect(lb.get_by_role("option")).to_have_count(1, timeout=SHORT_MS),
         f"typing {word!r} filters the boards to one")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")


def wait_saves(page: Page, n: int) -> None:
    words = counted(n, "save", "saves")
    live(page, lambda: expect(page.get_by_text(words, exact=True).first).to_be_visible(timeout=SHORT_MS),
         f"the pin page shows {words!r} without a reload")


def saves_of(api: Api, board_id: int, root: int) -> list[dict]:
    return [p for p in board_json(api, board_id)["pins"] if (p["saved_from"] or {}).get("pin_id") == root]


def test_save_dialog(browser: Browser, app_url: str) -> None:
    k = Keys()
    s, a = person("saver"), person("pinner")
    names = {"kit": f"Kitchen ideas {k.t}", "gar": f"Garden {k.t}", "mot": f"Moths {k.t}", "sha": f"Shared {k.t}",
             "hid": f"Hidden {k.t}", "por": f"Porch {k.t}"}
    w = seed_world(app_url, k, users=[s, a],
                   boards=[board(k("ab"), a, f"Ferns {k.t}"), board(k("kit"), s, names["kit"]), board(k("gar"), s, names["gar"]),
                           board(k("mot"), s, names["mot"], visibility="secret"),
                           board(k("sha"), a, names["sha"], members=((s, "editor"),)),
                           board(k("hid"), a, names["hid"], visibility="secret")],
                   pins=[pin(k("p"), a, k("ab"), f"Fern {k.t}", alt="Fern frond")])
    api = Api(app_url, s)
    with browse(browser, app_url, s, f"/b/{w['ab']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 1)
        the_card = card(page, f"Fern {k.t}", "Fern frond")
        tab_into(page, g)
        page.keyboard.press("s")
        dlg = save_dialog(page)
        lb = dlg.get_by_role("listbox", name="Boards")
        find = dlg.get_by_role("searchbox", name="Find a board")

        def opt(key: str) -> Locator:
            return lb.get_by_role("option", name=names[key], exact=True)
        for key in ("kit", "gar", "mot", "sha"):
            visible(page, opt(key), f"{names[key]} is offered")
        expect(opt("hid")).to_have_count(0)
        for typed, shown, gone in (("gar", "gar", "kit"), ("IDEAS", "kit", "gar"), ("deas", None, "kit")):
            type_into(page, find, typed)
            soon(page, lambda gone=gone: expect(opt(gone)).to_have_count(0, timeout=SHORT_MS), f"{typed!r} filters out {gone}")
            if shown:
                expect(opt(shown)).to_be_visible()
        page.keyboard.press("Escape")
        hidden(page, dlg, "Escape closes the save dialog")
        soon(page, lambda: assert_true(focused_pin(page) == w["p"]), "focus returns to the card")
        page.keyboard.press("s")
        save_dialog(page)
        page.keyboard.type("kitchen")
        soon(page, lambda: expect(lb.get_by_role("option")).to_have_count(1, timeout=SHORT_MS), "one board matches")
        page.keyboard.press("ArrowDown")
        soon(page, lambda: assert_true(names["kit"] in (active_option(lb) or "")), "ArrowDown moves into the list")
        page.keyboard.press("Enter")
        toasts(page, f"Saved to {names['kit']}")
        says(page, f"Saved to {names['kit']}")
        the_card.focus()
        page.keyboard.press("s")
        dlg = save_dialog(page)
        dlg.get_by_role("button", name="Create board").click()
        create = page.get_by_role("dialog", name="Create board")
        visible(page, create, 'dialog "Create board" opens')
        create.get_by_role("textbox", name="Name").fill(names["por"])
        check(create.get_by_role("radio", name="Public"))
        create.get_by_role("button", name="Create", exact=True).click()
        visible(page, dlg, "the save dialog comes back")
        soon(page, lambda: assert_true(names["por"] in (active_option(lb) or "")), "the new board's option is focused")
        page.keyboard.press("Enter")
        toasts(page, f"Saved to {names['por']}")
    assert len(saves_of(api, w["kit"], w["p"])) == 1, "Enter saved to the focused board"
    porch = next(b for b in api.ok("GET", "/api/boards/mine")["boards"] if b["name"] == names["por"])
    assert porch["pin_count"] == 1 and len(saves_of(api, porch["id"], w["p"])) == 1
    assert board_json(api, w["gar"])["pin_count"] == 0


def test_saves_keep_credit(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s, c, d = person("pinner"), person("saver"), person("second"), person("host")
    w = seed_world(app_url, k, users=[a, s, c, d],
                   boards=[board(k("ab"), a, f"Origin {k.t}"), board(k("sb"), s, f"Saver {k.t}"),
                           board(k("cb"), c, f"Second {k.t}"), board(k("db"), d, f"Host {k.t}", members=((c, "viewer"),))],
                   pins=[pin(k("q"), s, k("sb"), f"Already {k.t}")])
    api_a, api_s, api_c = Api(app_url, a), Api(app_url, s), Api(app_url, c)
    r = upload(api_a, png(300, 200, random_rgb()), title=f"Moth #wing{k.t}", alt="Moth alt", board_id=w["ab"],
               description=f"Pale #night{k.t}", source="https://moths.example/a")
    assert r.status_code == 201
    orig = r.json()
    s3 = S3()
    before = image_ids(s3)
    sv = api_s.ok("POST", f"/api/pins/{orig['id']}/saves", {"board": w["sb"], "section": None}, status=201)
    assert not image_ids(s3) - before, "a save shares the original's stored image"
    assert sv["id"] != orig["id"] and sv["owner"]["id"] == s.id and sv["board"]["id"] == w["sb"] and sv["position"] == 1
    for field in ("title", "description", "alt", "tags", "source", "source_host"):
        assert sv[field] == orig[field], f"a save copies {field}"
    assert sv["image"]["sha256"] == orig["image"]["sha256"]
    assert sv["saved_from"] == {"pin_id": orig["id"], "user_name": a.name, "removed": False}
    sb = board_json(api_s, w["sb"])
    assert sb["order"]["unsectioned"] == [sv["id"], w["q"]]
    assert_gapless(sb)
    again = api_c.ok("POST", f"/api/pins/{sv['id']}/saves", {"board": w["cb"], "section": None}, status=201)
    assert again["saved_from"]["pin_id"] == orig["id"] and again["saved_from"]["user_name"] == a.name, \
        "saving a save credits the root original"
    assert_error(api_c.call("POST", f"/api/pins/{orig['id']}/saves", {"board": w["db"], "section": None}),
                 403, "forbidden", what="a viewer saving onto the board")
    assert_error(api_c.call("POST", f"/api/pins/{orig['id']}/saves", {"board": MISSING_ID, "section": None}), 404, "not_found")
    assert board_json(api_c, w["db"])["pin_count"] == 0
    with browse(browser, app_url, c, f"/pin/{again['id']}", api=api_c) as page:
        link = page.get_by_role("link", name=f"Saved from {a.name}")
        visible(page, link, "the credit links to the original")
        link.click()
        soon(page, lambda: assert_true(urllib.parse.urlparse(page.url).path == f"/pin/{orig['id']}"), "the credit opens the original")


def test_live_saves_count(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, v, s = person("pinner"), person("looker"), person("saver")
    w = seed_world(app_url, k, users=[a, v, s],
                   boards=[board(k("ab"), a, f"Open {k.t}"), board(k("sb"), s, f"Saves {k.t}"),
                           board(k("sx"), s, f"Quiet {k.t}", visibility="secret")],
                   pins=[pin(k("p"), a, k("ab"), f"Count {k.t}")])
    api_s = Api(app_url, s)
    with ExitStack() as stack:
        pages = [stack.enter_context(browse(browser, app_url, u, f"/pin/{w['p']}")) for u in (a, v)]
        for page in pages:
            shows_text(page, "0 saves", "the pin shows 0 saves")
        sv = api_s.ok("POST", f"/api/pins/{w['p']}/saves", {"board": w["sb"], "section": None}, status=201)
        for page in pages:
            wait_saves(page, 1)
        api_s.ok("POST", f"/api/pins/{w['p']}/saves", {"board": w["sx"], "section": None}, status=201)
        poll(lambda: len(saves_of(api_s, w["sx"], w["p"])) == 1, "the secret save exists")
        assert api_s.ok("GET", f"/api/pins/{w['p']}")["saves"] == 1, "saves on secret boards are never counted"
        api_s.ok("DELETE", f"/api/pins/{sv['id']}")
        wait_saves(pages[0], 0)
    assert Api(app_url, v).ok("GET", f"/api/pins/{w['p']}")["saves"] == 0


def test_one_save_per_board(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s, c = person("pinner"), person("saver"), person("second")
    w = seed_world(app_url, k, users=[a, s, c],
                   boards=[board(k("ab"), a, f"Origin {k.t}"), board(k("sb"), s, f"Wishlist {k.t}"), board(k("cb"), c, f"Second {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Once {k.t}")],
                   saves=[save(k("sv"), k("p"), s, k("sb")), save(k("cv"), k("p"), c, k("cb"))])
    api_s, api_a = Api(app_url, s), Api(app_url, a)
    target = {"id": w["sb"], "name": f"Wishlist {k.t}"}
    body = assert_error(api_s.call("POST", f"/api/pins/{w['p']}/saves", {"board": w["sb"], "section": None}), 409, "already_on_board")
    assert body["board"] == target
    body = assert_error(api_s.call("POST", f"/api/pins/{w['cv']}/saves", {"board": w["sb"], "section": None}), 409, "already_on_board")
    assert body["board"] == target, "a save of a save meets the same root"
    assert_error(api_a.call("POST", f"/api/pins/{w['p']}/saves", {"board": w["ab"], "section": None}), 409, "already_on_board")
    assert board_json(api_s, w["sb"])["pin_count"] == 1 and api_a.ok("GET", f"/api/pins/{w['p']}")["saves"] == 2
    with browse(browser, app_url, s, f"/pin/{w['p']}", api=api_s) as page:
        btn = page.get_by_role("button", name="Save", exact=True)
        visible(page, btn, 'button "Save" shows')
        btn.click()
        save_by_keys(page, "Wishlist")
        alerted(page, f"This pin is already on Wishlist {k.t}.")
    assert board_json(api_s, w["sb"])["pin_count"] == 1
    api_s.ok("DELETE", f"/api/pins/{w['sv']}")
    api_s.ok("POST", f"/api/pins/{w['p']}/saves", {"board": w["sb"], "section": None}, status=201)


def test_original_removed(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s, m, x = person("pinner"), person("saver"), person("member"), person("stranger")
    w = seed_world(app_url, k, users=[a, s, m, x],
                   boards=[board(k("ab"), a, f"Open {k.t}"), board(k("ax"), a, f"Plans {k.t}", visibility="secret", members=((m, "viewer"),)),
                           board(k("sb"), s, f"Saver {k.t}"), board(k("mb"), m, f"Member {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Lamp {k.t}"), pin(k("q"), a, k("ax"), f"Party {k.t}")],
                   saves=[save(k("sv"), k("p"), s, k("sb")), save(k("mv"), k("q"), m, k("mb"))])
    api_a, api_s, api_m, api_x = (Api(app_url, u) for u in (a, s, m, x))
    assert credit(api_x, w["mv"]) == (None, False) and credit(api_m, w["mv"]) == (w["q"], False)
    assert credit(api_x, w["sv"]) == (w["p"], False)
    op = api_a.ok("DELETE", f"/api/pins/{w['p']}")
    assert credit(api_s, w["sv"]) == (None, True) and credit(api_x, w["sv"]) == (None, True)
    assert api_s.ok("GET", f"/api/pins/{w['sv']}")["saved_from"]["user_name"] == a.name
    api_a.ok("DELETE", f"/api/pins/{w['q']}")
    assert credit(api_x, w["mv"]) == (None, False), "a non-member never learns the secret original went"
    assert credit(api_m, w["mv"]) == (None, True)
    with browse(browser, app_url, s, f"/pin/{w['sv']}", api=api_s) as page:
        soon(page, lambda: expect(page.get_by_role("main")).to_contain_text(f"Saved from {a.name} · Original removed", timeout=SHORT_MS),
             "the credit reads Original removed")
        expect(page.get_by_role("link", name=f"Saved from {a.name}")).to_have_count(0)
    with browse(browser, app_url, x, f"/pin/{w['mv']}", api=api_x) as page:
        soon(page, lambda: expect(page.get_by_role("main")).to_contain_text(f"Saved from {a.name}", timeout=SHORT_MS), "plain credit")
        expect(page.get_by_role("main")).not_to_contain_text("Original removed")
        expect(page.get_by_role("link", name=f"Saved from {a.name}")).to_have_count(0)
    api_a.ok("POST", f"/api/operations/{op['id']}/undo")
    assert credit(api_s, w["sv"]) == (w["p"], False), "undo returns the link credit"
    api_a.ok("PATCH", f"/api/boards/{w['ab']}", {"visibility": "secret"})
    assert credit(api_x, w["sv"]) == (None, False) and credit(api_s, w["sv"]) == (None, False)


def test_deleted_means_gone(app_url: str) -> None:
    k = Keys()
    a, s, v = person("pinner"), person("saver"), person("follower")
    w = seed_world(app_url, k, users=[a, s, v], boards=[board(k("ab"), a, f"Gone {k.t}"), board(k("sb"), s, f"Saves {k.t}")],
                   pins=[pin(k("p2"), a, k("ab"), f"Stays {k.t}")], follows=[follow_user(v, a)])
    api_a, api_s, api_v, s3 = Api(app_url, a), Api(app_url, s), Api(app_url, v), S3()
    before = image_ids(s3)
    r = upload(api_a, png(320, 240, random_rgb()), title=f"Gone{k.t} moth", alt="Gone alt", board_id=w["ab"])
    assert r.status_code == 201
    pid = r.json()["id"]
    new = image_ids(s3) - before
    assert len(new) == 1
    img = next(iter(new))
    sv = api_s.ok("POST", f"/api/pins/{pid}/saves", {"board": w["sb"], "section": None}, status=201)
    assert api_a.ok("GET", f"/api/pins/{pid}")["saves"] == 1
    api_s.ok("DELETE", f"/api/pins/{sv['id']}")
    assert api_a.ok("GET", f"/api/pins/{pid}")["saves"] == 0, "a deleted save leaves the saves count"
    assert_error(api_s.call("GET", f"/api/pins/{sv['id']}"), 404, "not_found")
    totals = api_v.ok("GET", f"/api/users/{a.handle}")["pin_total"]
    assert pid in [p["id"] for p in api_v.ok("GET", f"/api/search?q=gone{k.t}")["pins"]]
    assert pid in [p["id"] for p in api_v.ok("GET", "/api/feed")["pins"]]
    op = api_a.ok("DELETE", f"/api/pins/{pid}")
    assert op["kind"] == "delete" and op["count"] == 1 and op["status"] == "open"

    def gone() -> None:
        for api in (api_a, api_v):
            assert_error(api.call("GET", f"/api/pins/{pid}"), 404, "not_found", what="direct URL")
            assert_error(media(api, pid, "original"), 404, "not_found", what="image link")
        b = board_json(api_a, w["ab"])
        assert pid not in flat(b) and b["pin_count"] == 1
        assert_gapless(b)
        assert api_v.ok("GET", f"/api/search?q=gone{k.t}")["pins"] == []
        assert pid not in [p["id"] for p in api_v.ok("GET", "/api/feed")["pins"]]
        assert pid not in [p["id"] for p in api_v.ok("GET", f"/api/users/{a.handle}/pins")["pins"]]
        assert api_v.ok("GET", f"/api/users/{a.handle}")["pin_total"] == totals - 1
    gone()
    api_a.ok("POST", f"/api/operations/{op['id']}/undo")
    assert board_json(api_a, w["ab"])["order"]["unsectioned"][0] == pid, "undo inside the window brings it back"
    op2 = api_a.ok("DELETE", f"/api/pins/{pid}")
    move_clock(app_url, config(app_url)["undo_seconds"] + 1)
    assert_error(api_a.call("POST", f"/api/operations/{op2['id']}/undo"), 410, "undo_expired")
    gone()
    poll(lambda: not s3.keys(f"images/{img}/"), "the gone pin's storage objects are removed within 60 seconds",
         STORAGE_CLEANUP_S + CLEANUP_SLACK_S)


@pytest.mark.timeout(900)
def test_wf_save_credit_live_keyboard(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s = person("pinner"), person("saver")
    w = seed_world(app_url, k, users=[a, s], boards=[board(k("ab"), a, f"Moths {k.t}"), board(k("sb"), s, f"Wishlist {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Luna {k.t}", alt="Luna moth")])
    api_a, api_s = Api(app_url, a), Api(app_url, s)
    with ExitStack() as stack:
        pa = stack.enter_context(browse(browser, app_url, a, f"/pin/{w['p']}", api=api_a))
        ps = stack.enter_context(browse(browser, app_url, s, f"/b/{w['ab']}", api=api_s))
        shows_text(pa, "0 saves", "the pinner's page shows 0 saves")
        g = grid(ps)
        wait_cards(ps, g, 1)
        tab_into(ps, g)
        ps.keyboard.press("s")
        save_by_keys(ps, "Wishlist")
        toasts(ps, f"Saved to Wishlist {k.t}")
        wait_saves(pa, 1)
        sv = poll(lambda: next(iter(saves_of(api_s, w["sb"], w["p"])), None), "the save is on the saver's board")
        ps.goto(f"{app_url}/pin/{sv['id']}")
        visible(ps, ps.get_by_role("link", name=f"Saved from {a.name}"), "the save credits the pinner")
        pa.get_by_role("button", name="Edit pin").click()
        dlg = pa.get_by_role("dialog", name="Edit pin")
        visible(pa, dlg, 'dialog "Edit pin" opens')
        dlg.get_by_role("button", name="Delete pin").click()
        poll(lambda: api_a.call("GET", f"/api/pins/{w['p']}").status_code == 404, "the original answers 404 at once")
        ps.reload()
        soon(ps, lambda: expect(ps.get_by_role("main")).to_contain_text(f"Saved from {a.name} · Original removed", timeout=SHORT_MS),
             "the save's credit says the original was removed")
        expect(ps.get_by_role("link", name=f"Saved from {a.name}")).to_have_count(0)
        pa.goto(f"{app_url}/pin/{w['p']}")
        visible(pa, pa.get_by_role("heading", name="Pin not found"), "the original's URL shows not found")
    assert api_s.ok("GET", f"/api/pins/{sv['id']}")["owner"]["id"] == s.id
    assert credit(api_s, sv["id"]) == (None, True)


def test_wf_save_credit_live_duplicate(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s = person("pinner"), person("saver")
    w = seed_world(app_url, k, users=[a, s], boards=[board(k("ab"), a, f"Moths {k.t}"), board(k("sb"), s, f"Wishlist {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Atlas {k.t}")], saves=[save(k("sv"), k("p"), s, k("sb"))])
    api_a, api_s = Api(app_url, a), Api(app_url, s)
    with ExitStack() as stack:
        pa = stack.enter_context(browse(browser, app_url, a, f"/pin/{w['p']}", api=api_a))
        ps = stack.enter_context(browse(browser, app_url, s, f"/pin/{w['p']}", api=api_s))
        shows_text(pa, "1 save", "the pinner's page shows 1 save")
        ps.get_by_role("button", name="Save", exact=True).click()
        save_by_keys(ps, "Wishlist")
        alerted(ps, f"This pin is already on Wishlist {k.t}.")
        ps.reload()
        ps.get_by_role("button", name="Save", exact=True).click()
        dlg = save_dialog(ps)
        dlg.get_by_role("button", name="Create board").click()
        create = ps.get_by_role("dialog", name="Create board")
        visible(ps, create, 'dialog "Create board" opens')
        create.get_by_role("textbox", name="Name").fill(f"Porch {k.t}")
        check(create.get_by_role("radio", name="Public"))
        create.get_by_role("button", name="Create", exact=True).click()
        lb = dlg.get_by_role("listbox", name="Boards")
        soon(ps, lambda: assert_true(f"Porch {k.t}" in (active_option(lb) or "")), "the new board's option is focused")
        ps.keyboard.press("Enter")
        toasts(ps, f"Saved to Porch {k.t}")
        wait_saves(pa, 2)
    assert board_json(api_s, w["sb"])["pin_count"] == 1
    assert api_a.ok("GET", f"/api/pins/{w['p']}")["saves"] == 2


def curate_world(base: str, k: Keys, o: User, n: int = 4, *, shelf: int = 0, members: tuple = (), users: tuple | list = (),
                 boards: tuple | list = (), pins: tuple | list = (), saves: tuple | list = ()) -> tuple[World, list[str], list[str]]:
    titles = [f"Pin {i} {k.t}" for i in range(n + shelf)]
    alts = [f"Curated print {i}" for i in range(n + shelf)]
    own = [pin(k(f"p{i}"), o, k("b"), titles[i], alt=alts[i], section=k("s") if i >= n else None) for i in range(n + shelf)]
    main = [board(k("b"), o, f"Main {k.t}", members=members, sections=((k("s"), f"Shelf {k.t}"), (k("e"), f"Empty {k.t}"))),
            board(k("t"), o, f"Target {k.t}")]
    w = seed_world(base, k, users=[o, *[m for m, _ in members], *users], boards=main + list(boards),
                   pins=own + list(pins), saves=list(saves))
    return w, titles, alts


def pin_ids(w: World, count: int) -> list[int]:
    return [w[f"p{i}"] for i in range(count)]


def selected(loc: Locator) -> list[int]:
    cards = read_cards(loc)
    for c in cards:
        assert c["selected"] == c["dataSelected"], "aria-selected and data-selected agree"
    return [c["id"] for c in cards if c["selected"] == "true"]


def toolbar(page: Page) -> Locator:
    return page.get_by_role("toolbar", name="Selection")


def pins_word(n: int) -> str:
    return counted(n, "pin", "pins")


def is_operation_post(r: Any) -> bool:
    return urllib.parse.urlparse(r.url).path == "/api/operations" and r.request.method == "POST"


def bulk(page: Page, verb: str, n: int, target: str | None = None) -> dict:
    tb = toolbar(page)
    visible(page, tb, 'toolbar "Selection" shows')
    with page.expect_response(is_operation_post) as info:
        tb.get_by_role("button", name=verb, exact=True).click()
        if target is not None:
            dlg = page.get_by_role("dialog", name=f"{verb} {pins_word(n)}", exact=True)
            visible(page, dlg, f"dialog {verb} {pins_word(n)} opens")
            dlg.get_by_role("listbox", name="Boards").get_by_role("option", name=target, exact=True).click()
            dlg.get_by_role("button", name=f"{verb} here", exact=True).click()
    return info.value.json()


def undo_button(page: Page) -> Locator:
    return notices(page).get_by_role("button", name="Undo")


def toast_deadline(page: Page) -> str | None:
    return undo_button(page).first.evaluate(
        "b => { const e = b.closest('[data-deadline]'); return e ? e.getAttribute('data-deadline') : null; }")


def test_selecting_pins(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, v = person("curator"), person("looker")
    w, titles, alts = curate_world(app_url, k, o, 5, members=((v, "viewer"),))
    ids = pin_ids(w, 5)
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        wait_cards(page, g, 5)
        assert selected(g) == [] and all(c["selected"] == "false" for c in read_cards(g))
        tab_into(page, g)
        page.keyboard.press("Space")
        soon(page, lambda: assert_true(selected(g) == ids[:1]), "Space selects the focused card")
        says(page, "1 pin selected")
        visible(page, toolbar(page), "the toolbar appears")
        expect(toolbar(page)).to_contain_text("1 pin selected")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        soon(page, lambda: assert_true(selected(g) == ids[:3] and focused_pin(page) == ids[2]), "Shift+ArrowRight extends from the anchor")
        says(page, "3 pins selected")
        card(page, titles[4], alts[4]).click(modifiers=["Shift"])
        soon(page, lambda: assert_true(selected(g) == ids), "Shift-click selects anchor to clicked card")
        says(page, "5 pins selected")
        assert urllib.parse.urlparse(page.url).path == f"/b/{w['b']}", "Shift-click does not open the pin"
        page.keyboard.press("Escape")
        soon(page, lambda: assert_true(selected(g) == []), "Escape clears the selection")
        says(page, "Selection cleared")
        hidden(page, toolbar(page), "the toolbar leaves with the selection")
        card(page, titles[1], alts[1]).click()
        soon(page, lambda: assert_true(page.url.endswith(f"/pin/{ids[1]}")), "a plain click opens the pin")
    with browse(browser, app_url, v, f"/b/{w['b']}") as page:
        g = grid(page)
        wait_cards(page, g, 5)
        tab_into(page, g)
        page.keyboard.press("Space")
        advance(page, STEP_MS)
        expect(toolbar(page)).to_have_count(0)
        assert all(c["selected"] != "true" for c in read_cards(g)), "a viewer cannot select"


def test_selection_toolbar(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, q = person("toolbar"), person("partner")
    w, _, _ = curate_world(app_url, k, o, 3, users=[q],
                           boards=[board(k("sh"), q, f"Shared {k.t}", members=((o, "editor"),)), board(k("qp"), q, f"Theirs {k.t}"),
                                   board(k("ql"), q, f"Looks {k.t}", members=((o, "viewer"),))])
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        wait_cards(page, g, 3)
        tab_into(page, g)
        page.keyboard.press("Space")
        page.keyboard.press("Shift+ArrowRight")
        tb = toolbar(page)
        visible(page, tb, "the toolbar appears")
        expect(tb).to_contain_text("2 pins selected")
        expect(tb.get_by_role("button", name="Delete", exact=True)).to_be_visible()
        for verb in ("Move", "Copy"):
            btn = tb.get_by_role("button", name=verb, exact=True)
            btn.focus()
            page.keyboard.press("Enter")
            dlg = page.get_by_role("dialog", name=f"{verb} 2 pins", exact=True)
            visible(page, dlg, f"dialog {verb} 2 pins opens")
            lb = dlg.get_by_role("listbox", name="Boards")
            for name in (f"Target {k.t}", f"Shared {k.t}"):
                visible(page, lb.get_by_role("option", name=name, exact=True), f"{name} is offered")
            for name in (f"Main {k.t}", f"Theirs {k.t}", f"Looks {k.t}"):
                expect(lb.get_by_role("option", name=name, exact=True)).to_have_count(0)
            first = lb.get_by_role("option").first
            soon(page, lambda: assert_true(active_option(lb) == (first.text_content() or "").strip()), "the first option has focus")
            expect(dlg.get_by_role("button", name=f"{verb} here", exact=True)).to_be_visible()
            for key in ("Tab", "Shift+Tab"):
                for _ in range(TAB_PRESSES):
                    page.keyboard.press(key)
                    assert focus_inside(dlg), f"{key} stays inside the {verb} dialog"
            page.keyboard.press("Escape")
            hidden(page, dlg, f"Escape closes the {verb} dialog")
            soon(page, lambda btn=btn: expect(btn).to_be_focused(timeout=SHORT_MS), f"focus returns to {verb}")
        page.reload()
        wait_cards(page, g, 3)
        tab_into(page, g)
        page.keyboard.press("Space")
        visible(page, tb, "the toolbar appears")
        tb.get_by_role("button", name="Move", exact=True).click()
        visible(page, page.get_by_role("dialog", name="Move 1 pin", exact=True), 'dialog "Move 1 pin" opens')


def snap(api: Api, *board_ids: int) -> list[tuple[dict, int, int]]:
    out = []
    for bid in board_ids:
        b = board_json(api, bid)
        out.append((order_of(b), b["seq"], b["pin_count"]))
    return out


def operate(api: Api, kind: str, pins: list[int], board_id: int | None, section: int | None = None) -> httpx.Response:
    return api.call("POST", "/api/operations", {"kind": kind, "pins": pins, "board": board_id, "section": section})


def test_all_or_nothing_bulk_operations(app_url: str) -> None:
    k = Keys()
    o, e, v, x = person("owner"), person("editor"), person("viewer"), person("other")
    w, _, _ = curate_world(app_url, k, o, 4, shelf=1, members=((e, "editor"), (v, "viewer")), users=[x],
                           boards=[board(k("u"), o, f"Third {k.t}"), board(k("eb"), e, f"Editor {k.t}"),
                                   board(k("sb"), o, f"Vault {k.t}", visibility="secret"), board(k("xb"), x, f"Other {k.t}")],
                           pins=[pin(k("r"), x, k("xb"), f"Root {k.t}"), pin(k("ps"), o, k("sb"), f"Vaulted {k.t}")],
                           saves=[save(k("sm"), k("r"), o, k("b")), save(k("st"), k("r"), o, k("t"))])
    ids = pin_ids(w, 5)
    api, ed = Api(app_url, o), Api(app_url, e)
    watched = (w["b"], w["t"], w["u"], w["eb"])
    before = snap(api, *watched)
    body = assert_error(operate(api, "move", [ids[0], w["sm"]], w["t"]), 409, "already_on_board", what="target holds the root")
    assert body["board"] == {"id": w["t"], "name": f"Target {k.t}"}
    assert_error(operate(api, "copy", [ids[0]], w["b"]), 409, "already_on_board", what="copy onto its own board")
    assert_error(operate(api, "move", [w["sm"], w["st"]], w["u"]), 409, "already_on_board", what="two chosen pins share a root")
    assert_error(operate(api, "move", [], w["t"]), 422, "validation", "pins")
    assert_error(operate(api, "move", [ids[0], ids[0]], w["t"]), 422, "validation", "pins")
    assert_error(operate(Api(app_url, v), "move", [ids[0]], w["t"]), 403, "forbidden", what="viewer")
    api_x = Api(app_url, x)
    assert_error(operate(api_x, "move", [ids[0]], w["xb"]), 403, "forbidden", what="stranger on a public board")
    assert_error(operate(api_x, "move", [w["ps"]], w["xb"]), 404, "not_found", what="stranger on a secret board")
    assert snap(api, *watched) == before, "a refused operation changes nothing"
    op = api.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[4], ids[1]], "board": w["t"], "section": None}, status=201)
    assert op["kind"] == "move" and op["count"] == 2
    t = board_json(api, w["t"])
    assert t["order"]["unsectioned"][:2] == [ids[1], ids[4]], "moved pins keep their previous board order"
    assert t["seq"] == before[1][1] + 1 and board_json(api, w["b"])["seq"] == before[0][1] + 1
    assert_gapless(t)
    assert_gapless(board_json(api, w["b"]))
    main_order = order_of(board_json(api, w["b"]))
    op = ed.ok("POST", "/api/operations", {"kind": "copy", "pins": [ids[2], ids[0]], "board": w["eb"], "section": None}, status=201)
    assert op["kind"] == "copy" and op["count"] == 2
    eb = board_json(ed, w["eb"])
    copies = {p["id"]: p for p in eb["pins"]}
    first_two = [copies[i] for i in eb["order"]["unsectioned"][:2]]
    assert sorted(c["saved_from"]["pin_id"] for c in first_two) == sorted([ids[0], ids[2]])
    assert all(c["owner"]["id"] == e.id for c in first_two), "copies are owned by the actor"
    assert order_of(board_json(api, w["b"])) == main_order and eb["seq"] == before[3][1] + 1
    count = board_json(api, w["b"])["pin_count"]
    api.ok("POST", "/api/operations", {"kind": "delete", "pins": [ids[0], ids[3]], "board": None, "section": None}, status=201)
    for pid in (ids[0], ids[3]):
        assert_error(api.call("GET", f"/api/pins/{pid}"), 404, "not_found")
    b = board_json(api, w["b"])
    assert b["pin_count"] == count - 2
    assert_gapless(b)


def test_bulk_toast(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("toaster")
    w, _, _ = curate_world(app_url, k, o, 3)
    ids = pin_ids(w, 3)
    target = f"Target {k.t}"
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        tab_into(page, g)
        page.keyboard.press("Space")
        page.keyboard.press("Shift+ArrowRight")
        toolbar(page).get_by_role("button", name="Move", exact=True).click()
        count = len(ids[:2])
        dlg = page.get_by_role("dialog", name=f"Move {count} pins", exact=True)
        visible(page, dlg, f'dialog "Move {count} pins" opens')
        dlg.get_by_role("listbox", name="Boards").get_by_role("option", name=target, exact=True).click()
        with held(page, "**/api/operations") as hold:
            dlg.get_by_role("button", name="Move here", exact=True).click()
            pending = page.get_by_role("button", name="Moving")
            visible(page, pending, 'the button reads "Moving" while pending')
            expect(pending).to_be_disabled()
            with page.expect_response(is_operation_post) as info:
                hold.release()
        op = info.value.json()
        toasts(page, f"2 pins moved to {target} · Undo")
        says(page, f"2 pins moved to {target}")
        visible(page, undo_button(page).first, 'the toast carries button "Undo"')
        shown = toast_deadline(page)
        assert shown and parse_instant(shown) == parse_instant(op["deadline"]), "data-deadline holds the server deadline"
        wait_cards(page, g, 1)
        tab_into(page, g)
        page.keyboard.press("Space")
        bulk(page, "Copy", 1, target)
        toasts(page, f"1 pin copied to {target} · Undo")
        page.reload()
        wait_cards(page, g, 1)
        tab_into(page, g)
        page.keyboard.press("Space")
        bulk(page, "Delete", 1)
        toasts(page, "1 pin deleted · Undo")
        says(page, "1 pin deleted")
    t = board_json(api, w["t"])
    assert ids[0] in t["order"]["unsectioned"] and ids[1] in t["order"]["unsectioned"] and t["pin_count"] == 3
    assert board_json(api, w["b"])["pin_count"] == 0


def test_server_decided_undo(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, x = person("undoer"), person("other")
    w, _, _ = curate_world(app_url, k, o, 3, shelf=2, users=[x],
                           boards=[board(k("u"), o, f"Scratch {k.t}")], pins=[pin(k("u0"), o, k("u"), f"Scratch {k.t}")])
    ids = pin_ids(w, 5)
    api = Api(app_url, o)
    undo_s = config(app_url)["undo_seconds"]
    main0, target0 = board_json(api, w["b"]), board_json(api, w["t"])
    op = api.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[4], ids[0], ids[3]], "board": w["t"], "section": None}, status=201)
    assert op["status"] == "open" and op["board"]["id"] == w["t"]
    t1 = board_json(api, w["t"])
    assert t1["order"]["unsectioned"][:3] == [ids[0], ids[3], ids[4]] and t1["last_saved_at"] is not None
    assert_error(Api(app_url, x).call("POST", f"/api/operations/{op['id']}/undo"), 404, "not_found", what="another person's operation")
    assert api.ok("POST", f"/api/operations/{op['id']}/undo")["status"] == "undone"
    main1, target1 = board_json(api, w["b"]), board_json(api, w["t"])
    assert order_of(main1) == order_of(main0) and order_of(target1) == order_of(target0), "undo restores the exact prior places"
    assert {p["id"]: (p["position"], p["section"]) for p in main1["pins"]} == {p["id"]: (p["position"], p["section"]) for p in main0["pins"]}
    assert target1["last_saved_at"] == target0["last_saved_at"]
    assert_error(api.call("POST", f"/api/operations/{op['id']}/undo"), 409, "already_undone")
    op2 = api.ok("POST", "/api/operations", {"kind": "move", "pins": [w["u0"]], "board": w["t"], "section": None}, status=201)
    api.ok("DELETE", f"/api/boards/{w['u']}", status=204)
    held_order = order_of(board_json(api, w["t"]))
    assert_error(api.call("POST", f"/api/operations/{op2['id']}/undo"), 409, "undo_conflict")
    assert order_of(board_json(api, w["t"])) == held_order, "a refused undo changes nothing"
    op3 = api.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[2]], "board": w["t"], "section": None}, status=201)
    move_clock(app_url, undo_s + 1)
    assert_error(api.call("POST", f"/api/operations/{op3['id']}/undo"), 410, "undo_expired")
    assert ids[2] in board_json(api, w["t"])["order"]["unsectioned"]
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, device_time=business_now(app_url) + DEVICE_SKEW) as page:
        g = grid(page)
        wait_cards(page, g, 2)
        tab_into(page, g)
        page.keyboard.press("Space")
        ui_op = bulk(page, "Move", 1, f"Target {k.t}")
        visible(page, undo_button(page).first, "the undo toast shows")
        advance(page, 2 * PLAIN_TOAST_MS)
        expect(undo_button(page)).to_have_count(1)
        move_clock(app_url, undo_s + 1)
        live(page, lambda: expect(undo_button(page)).to_have_count(0, timeout=SHORT_MS), "the toast leaves when the server says so")
    assert_error(api.call("POST", f"/api/operations/{ui_op['id']}/undo"), 410, "undo_expired")


def select_three(page: Page, g: Locator, third: Locator) -> None:
    tab_into(page, g)
    page.keyboard.press("Space")
    page.keyboard.press("Shift+ArrowRight")
    third.click(modifiers=["Shift"])


@pytest.mark.timeout(900)
def test_wf_multiselect_undo_happy(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("mover")
    w, titles, alts = curate_world(app_url, k, o, 4)
    ids = pin_ids(w, 4)
    api = Api(app_url, o)
    before = order_of(board_json(api, w["b"]))
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        select_three(page, g, card(page, titles[2], alts[2]))
        soon(page, lambda: assert_true(selected(g) == ids[:3]), "three pins are selected")
        expect(toolbar(page)).to_contain_text("3 pins selected")
        bulk(page, "Move", 3, f"Target {k.t}")
        toasts(page, f"3 pins moved to Target {k.t} · Undo")
        assert board_json(api, w["t"])["order"]["unsectioned"] == ids[:3]
        undo_button(page).first.click()
        toasts(page, "Undone")
        says(page, "Undone")
        poll(lambda: order_of(board_json(api, w["b"])) == before, "undo restores every pin to its place")
        wait_cards(page, g, 4)
        select_three(page, g, card(page, titles[2], alts[2]))
        op = bulk(page, "Move", 3, f"Target {k.t}")
        visible(page, undo_button(page).first, "the second toast shows")
        move_clock(app_url, config(app_url)["undo_seconds"] + 1)
        live(page, lambda: expect(undo_button(page)).to_have_count(0, timeout=SHORT_MS), "the toast leaves on expiry")
    assert_error(api.call("POST", f"/api/operations/{op['id']}/undo"), 410, "undo_expired")
    assert board_json(api, w["t"])["order"]["unsectioned"] == ids[:3]


def test_wf_multiselect_undo_conflict(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("conflict")
    w, _, _ = curate_world(app_url, k, o, 3)
    ids = pin_ids(w, 3)
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        tab_into(page, g)
        page.keyboard.press("Space")
        page.keyboard.press("Shift+ArrowRight")
        bulk(page, "Move", 2, f"Target {k.t}")
        visible(page, undo_button(page).first, "the undo toast shows")
        Api(app_url, o).ok("DELETE", f"/api/pins/{ids[0]}")
        undo_button(page).first.click()
        alerted(page, "This can't be undone because some pins have changed.")
    assert board_json(api, w["t"])["order"]["unsectioned"][0] == ids[1]
    assert board_json(api, w["b"])["order"]["unsectioned"] == [ids[2]]


def test_wf_multiselect_undo_delete(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("deleter")
    w, titles, alts = curate_world(app_url, k, o, 4)
    ids = pin_ids(w, 4)
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        tab_into(page, g)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        page.keyboard.press("Shift+ArrowRight")
        bulk(page, "Delete", 2)
        toasts(page, "2 pins deleted · Undo")
        wait_cards(page, g, 2)
        assert_error(api.call("GET", f"/api/pins/{ids[1]}"), 404, "not_found")
        undo_button(page).first.click()
        toasts(page, "Undone")
        soon(page, lambda: assert_true(grid_ids(g) == ids), "the pins return to their slots")
    assert board_json(api, w["b"])["order"]["unsectioned"] == ids


def section_body(section_id: int, position: int, base_seq: int) -> dict:
    return {"kind": "section", "id": section_id, "section": None, "position": position, "base_seq": base_seq}


def test_gapless_positions(app_url: str) -> None:
    k = Keys()
    o = person("gapless")
    w, _, _ = curate_world(app_url, k, o, 3, shelf=2)
    ids = pin_ids(w, 5)
    api = Api(app_url, o)
    path = f"/api/boards/{w['b']}/moves"
    b = board_json(api, w["b"])
    assert b["order"]["unsectioned"] == ids[:3] and b["order"]["sections"][0]["pins"] == ids[3:]
    assert_gapless(b)
    third = api.ok("POST", f"/api/boards/{w['b']}/sections", {"name": f"Third {k.t}"}, status=201)
    assert third["position"] == 3, "a new section goes last"
    r = upload(api, png(64, 64, random_rgb()), title=f"Newest {k.t}", alt="Newest", board_id=w["b"])
    assert r.status_code == 201
    b = board_json(api, w["b"])
    assert b["order"]["unsectioned"][0] == r.json()["id"]
    assert_gapless(b)
    r = upload(api, png(64, 64, random_rgb()), title=f"Shelved {k.t}", alt="Shelved", board_id=w["b"], section=w["s"])
    assert r.status_code == 201
    b = board_json(api, w["b"])
    assert b["order"]["sections"][0]["pins"][0] == r.json()["id"]
    expected = apply_move(order_of(b), ids[0], w["e"], 1)
    api.ok("POST", path, move_body(ids[0], 1, b["seq"], section=w["e"]))
    b = board_json(api, w["b"])
    assert order_of(b) == expected
    assert_gapless(b)
    for bad in (0, len(b["order"]["unsectioned"]) + 2):
        assert_error(api.call("POST", path, move_body(ids[2], bad, b["seq"])), 422, "validation", "position", f"position {bad}")
    api.ok("DELETE", f"/api/pins/{ids[1]}")
    b = board_json(api, w["b"])
    assert ids[1] not in flat(b)
    assert_gapless(b)
    api.ok("POST", path, section_body(w["s"], 2, b["seq"]))
    b = board_json(api, w["b"])
    assert [s["id"] for s in b["order"]["sections"]] == [w["e"], w["s"], third["id"]]
    assert api.ok("PATCH", f"/api/sections/{w['s']}", {"name": f"Shelf two {k.t}"})["position"] == 2
    assert api.ok("PATCH", f"/api/sections/{w['e']}", {"name": f"Empty two {k.t}"})["position"] == 1
    assert api.ok("PATCH", f"/api/sections/{third['id']}", {"name": f"Third two {k.t}"})["position"] == 3


def test_keyboard_reordering(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("altmover")
    w, titles, _ = curate_world(app_url, k, o, 4, shelf=1)
    ids = pin_ids(w, 4)
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, size=TALL_DESKTOP) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        tab_into(page, g)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved {titles[1]} to position 3 of 4")
        soon(page, lambda: assert_true(grid_ids(g) == [ids[0], ids[2], ids[1], ids[3]]), "the card moved one place")
        assert focused_pin(page) == ids[1], "focus stays on the moved card"
        page.keyboard.press("Alt+ArrowUp")
        says(page, f"Moved {titles[1]} to position 2 of 4")
        page.keyboard.press("Alt+ArrowUp")
        says(page, f"Moved {titles[1]} to position 1 of 4")
        soon(page, lambda: assert_true(focused_pin(page) == ids[1] and grid_ids(g)[0] == ids[1]), "the card is first and focused")
        poll(lambda: board_json(api, w["b"])["order"]["unsectioned"] == [ids[1], ids[0], ids[2], ids[3]], "the server holds the order")
        header = page.get_by_role("region", name=f"Shelf {k.t}").get_by_role("heading", level=2)
        header.focus()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved section Shelf {k.t} to position 2 of 2")
        soon(page, lambda: expect(page.get_by_role("region", name=f"Shelf {k.t}").get_by_role("heading", level=2)).to_be_focused(timeout=SHORT_MS),
             "focus stays on the section header")
    poll(lambda: [s["id"] for s in board_json(api, w["b"])["order"]["sections"]] == [w["e"], w["s"]], "the section moved")


def drag(page: Page, src: Locator, dst: Locator) -> None:
    x, y = center(src)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + DRAG_START_PX, y + DRAG_START_PX, steps=5)
    advance(page, STEP_MS)
    tx, ty = center(dst)
    page.mouse.move(tx, ty, steps=10)
    advance(page, STEP_MS)
    page.mouse.up()
    advance(page, STEP_MS)


def test_pointer_drag_reordering(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("dragger")
    w, titles, alts = curate_world(app_url, k, o, 4, shelf=2)
    ids = pin_ids(w, 6)
    api = Api(app_url, o)
    expected = order_of(board_json(api, w["b"]))
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, size=TALL_DESKTOP) as page:
        g, shelf = grid(page), grid(page, f"Shelf {k.t}")
        wait_cards(page, g, 4)
        steps = [(0, card(page, titles[2], alts[2]), None, 3), (3, card(page, titles[4], alts[4]), w["s"], 1),
                 (1, page.get_by_role("region", name=f"Empty {k.t}"), w["e"], 1)]
        for i, target, section, position in steps:
            drag(page, card(page, titles[i], alts[i]), target)
            expected = apply_move(expected, ids[i], section, position)
            soon(page, lambda: assert_true(grid_ids(g) == expected["unsectioned"]
                                           and grid_ids(shelf) == dict(expected["sections"])[w["s"]]),
                 f"dropping pin {i} updates the grids in place")
        page.reload()
        soon(page, lambda: assert_true(grid_ids(g) == expected["unsectioned"] and grid_ids(grid(page, f"Empty {k.t}")) == [ids[1]]),
             "the order survives a reload")
    assert order_of(board_json(api, w["b"])) == expected


def test_board_cover(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("cover")
    w, _, _ = curate_world(app_url, k, o, 2, shelf=1, boards=[board(k("x"), o, f"Bare {k.t}")])
    ids = pin_ids(w, 3)
    api = Api(app_url, o)
    assert board_json(api, w["b"])["cover"] == ids[0]
    assert api.ok("PATCH", f"/api/boards/{w['b']}", {"cover": ids[1]})["cover"] == ids[1]
    op = api.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[1]], "board": w["t"], "section": None}, status=201)
    assert board_json(api, w["b"])["cover"] == ids[0], "a chosen pin off the board yields to the first pin"
    api.ok("POST", f"/api/boards/{w['b']}/moves", section_body(w["e"], 1, board_json(api, w["b"])["seq"]))
    api.ok("DELETE", f"/api/pins/{ids[0]}")
    assert board_json(api, w["b"])["cover"] == ids[2], "the first section that has pins gives the cover"
    api.ok("DELETE", f"/api/pins/{ids[2]}")
    assert board_json(api, w["b"])["cover"] is None
    api.ok("POST", f"/api/operations/{op['id']}/undo")
    assert board_json(api, w["b"])["cover"] == ids[1], "the chosen pin is the cover again once back"
    boards = {b["id"]: b for b in api.ok("GET", f"/api/users/{o.handle}")["boards"]}
    assert boards[w["b"]]["cover"]["pin_id"] == ids[1] and boards[w["x"]]["cover"] is None
    with browse(browser, app_url, o, "/boards", api=api) as page:
        shows_text(page, "No pins yet", "an empty board's cover is the empty text")


def media_srcs(page: Page) -> list[str]:
    return page.locator("img").evaluate_all("els => els.map(e => e.getAttribute('src') || '')")


def test_wf_reorder_keyboard_persist_happy(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("reorder")
    w, titles, alts = curate_world(app_url, k, o, 4, shelf=1)
    ids = pin_ids(w, 4)
    api = Api(app_url, o)
    expected = [ids[3], ids[1], ids[0], ids[2]]
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, size=TALL_DESKTOP) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        tab_into(page, g)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Alt+ArrowUp")
        says(page, f"Moved {titles[1]} to position 1 of 4")
        page.get_by_role("region", name=f"Shelf {k.t}").get_by_role("heading", level=2).focus()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved section Shelf {k.t} to position 2 of 2")
        soon(page, lambda: assert_true(grid_ids(g)[0] == ids[1]), "the keyboard move shows")
        drag(page, card(page, titles[3], alts[3]), card(page, titles[1], alts[1]))
        soon(page, lambda: assert_true(grid_ids(g) == expected), "the drag puts the pin at position 1")
        page.reload()
        soon(page, lambda: assert_true(grid_ids(g) == expected), "the order survives a reload")
        page.goto(f"{app_url}/boards")
        soon(page, lambda: assert_true(any(f"/media/{ids[3]}/" in s for s in media_srcs(page))), "the board card shows the new cover")
    b = board_json(api, w["b"])
    assert b["order"]["unsectioned"] == expected and b["cover"] == ids[3]
    assert [s["id"] for s in b["order"]["sections"]] == [w["e"], w["s"]]


def test_wf_reorder_keyboard_persist_edges(browser: Browser, app_url: str) -> None:
    k = Keys()
    o = person("edges")
    w, titles, _ = curate_world(app_url, k, o, 3)
    ids = pin_ids(w, 3)
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        tab_into(page, g)
        page.keyboard.press("Alt+ArrowUp")
        page.keyboard.press("End")
        page.keyboard.press("Alt+ArrowDown")
        advance(page, STEP_MS)
        assert board_json(api, w["b"])["seq"] == 0 and grid_ids(g) == ids, "moves past the ends change nothing"
        page.get_by_role("button", name="Edit board").click()
        dlg = page.get_by_role("dialog", name="Edit board")
        visible(page, dlg, 'dialog "Edit board" opens')
        select(dlg.get_by_role("combobox", name="Cover"), titles[2])
        dlg.get_by_role("button", name="Save changes").click()
        poll(lambda: board_json(api, w["b"])["cover"] == ids[2], "the chosen cover is saved")
        hidden(page, dlg, "the dialog closes")
        tab_into(page, g)
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Alt+ArrowUp")
        says(page, f"Moved {titles[1]} to position 1 of 3")
        poll(lambda: board_json(api, w["b"])["order"]["unsectioned"][0] == ids[1], "the move is stored")
        assert board_json(api, w["b"])["cover"] == ids[2], "a chosen cover holds through a reorder"
        page.get_by_role("button", name="Edit board").click()
        visible(page, dlg, 'dialog "Edit board" opens')
        select(dlg.get_by_role("combobox", name="Cover"), "Automatic")
        dlg.get_by_role("button", name="Save changes").click()
    poll(lambda: board_json(api, w["b"])["cover"] == ids[1], "Automatic follows position 1")


def test_board_sequence_and_rebased_moves(app_url: str) -> None:
    k = Keys()
    o, e, x = person("owner"), person("editor"), person("other")
    w, _, _ = curate_world(app_url, k, o, 4, members=((e, "editor"),), users=[x],
                           boards=[board(k("xb"), x, f"Other {k.t}")], pins=[pin(k("r"), x, k("xb"), f"Root {k.t}")])
    ids = pin_ids(w, 4)
    api, ed, api_x = Api(app_url, o), Api(app_url, e), Api(app_url, x)
    path = f"/api/boards/{w['b']}/moves"

    def seq(bid: int = w["b"]) -> int:
        return board_json(api, bid)["seq"]
    b = board_json(api, w["b"])
    assert b["seq"] == 0
    exp1 = apply_move(order_of(b), ids[0], None, 2)
    r1 = ed.ok("POST", path, move_body(ids[0], 2, 0))
    assert r1["seq"] == 1 and r1["rebased"] is False and r1["order"]["unsectioned"] == exp1["unsectioned"]
    exp2 = apply_move(exp1, ids[3], None, 1)
    r2 = api.ok("POST", path, move_body(ids[3], 1, 0))
    assert r2["seq"] == 2 and r2["rebased"] is True, "a stale move is applied and marked rebased"
    assert r2["order"]["unsectioned"] == exp2["unsectioned"] == board_json(api, w["b"])["order"]["unsectioned"]
    ed.ok("POST", f"/api/pins/{w['r']}/saves", {"board": w["b"], "section": None}, status=201)
    assert seq() == 3
    t0 = seq(w["t"])
    op = api.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[1], ids[2]], "board": w["t"], "section": None}, status=201)
    assert (seq(), seq(w["t"])) == (4, t0 + 1), "a bulk move is one change per board"
    api.ok("POST", f"/api/operations/{op['id']}/undo")
    assert (seq(), seq(w["t"])) == (5, t0 + 2)
    version = api.ok("GET", f"/api/pins/{ids[0]}")["version"]
    api.ok("PATCH", f"/api/pins/{ids[0]}", {"version": version, "title": f"Edited {k.t}"})
    assert seq() == 6
    api.ok("PATCH", f"/api/sections/{w['s']}", {"name": f"Renamed {k.t}"})
    assert seq() == 7
    api.ok("PATCH", f"/api/boards/{w['b']}", {"name": f"Main two {k.t}"})
    assert seq() == 8
    api_x.ok("POST", f"/api/pins/{ids[0]}/comments", {"text": "Lovely", "parent": None}, status=201)
    api_x.ok("PUT", f"/api/pins/{ids[0]}/reaction", {"type": "love"})
    api_x.ok("PUT", f"/api/follows/boards/{w['b']}")
    api.ok("POST", f"/api/boards/{w['b']}/invites", {"email": f"seq.{k.t}@example.test", "role": "viewer"}, status=202)
    assert seq() == 8, "follows, comments, reactions and invites leave seq unchanged"


def test_live_board_updates(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e, x = person("owner"), person("editor"), person("other")
    w, titles, _ = curate_world(app_url, k, o, 4, members=((e, "editor"),), users=[x],
                                boards=[board(k("xb"), x, f"Other {k.t}"), board(k("eb"), e, f"Editor {k.t}")],
                                pins=[pin(k("r"), x, k("xb"), f"Root {k.t}")])
    ids = pin_ids(w, 4)
    api, ed = Api(app_url, o), Api(app_url, e)
    frames: list[dict] = []
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, before=ws_recorder(frames)) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        tab_into(page, g)
        assert focused_pin(page) == ids[0]
        ed.ok("POST", f"/api/boards/{w['b']}/moves", move_body(ids[3], 1, 0))
        live(page, lambda: assert_true(grid_ids(g) == [ids[3], ids[0], ids[1], ids[2]]), "the move shows without a reload")
        says(page, f"{e.name} moved {titles[3]}", LIVE_MAX_S + LIVE_SLACK_S)
        toasts(page, f"{e.name} moved {titles[3]}")
        assert focused_pin(page) == ids[0], "focus stays on its card"
        added = ed.ok("POST", f"/api/pins/{w['r']}/saves", {"board": w["b"], "section": None}, status=201)
        live(page, lambda: assert_true(grid_ids(g)[0] == added["id"]), "the added pin shows")
        says(page, f"{e.name} added Root {k.t}", LIVE_MAX_S + LIVE_SLACK_S)
        ed.ok("DELETE", f"/api/pins/{ids[2]}")
        live(page, lambda: assert_true(ids[2] not in grid_ids(g)), "the removed pin leaves")
        says(page, f"{e.name} removed {titles[2]}", LIVE_MAX_S + LIVE_SLACK_S)
        ed.ok("POST", f"/api/boards/{w['b']}/moves", section_body(w["s"], 2, board_json(api, w["b"])["seq"]))
        says(page, f"{e.name} moved section Shelf {k.t}", LIVE_MAX_S + LIVE_SLACK_S)
        assert focused_pin(page) == ids[0]
        ed.ok("POST", "/api/operations", {"kind": "move", "pins": [ids[0], ids[1]], "board": w["eb"], "section": None}, status=201)
        final = board_json(api, w["b"])["order"]["unsectioned"]
        live(page, lambda: assert_true(grid_ids(g) == final), "the bulk move shows")

        def board_frames() -> list[dict]:
            return [f for f in frames if f.get("type") == "board" and f.get("board_id") == w["b"]]
        poll(lambda: len(board_frames()) >= 5, "five board messages arrive", LIVE_MAX_S + LIVE_SLACK_S)
    got = board_frames()
    assert [f["seq"] for f in got] == [1, 2, 3, 4, 5], "one board message per change, in server order"
    assert [f["change"] for f in got] == ["moved", "added", "removed", "section_moved", "removed"]
    assert all(f["actor"]["id"] == e.id for f in got) and got[-1]["order"]["unsectioned"] == final


def test_wf_concurrent_editors_live_happy(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    w, titles, _ = curate_world(app_url, k, o, 4, members=((e, "editor"),))
    ids = pin_ids(w, 4)
    api = Api(app_url, o)
    expected = [ids[1], ids[0], ids[3], ids[2]]
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api))
        pe = stack.enter_context(browse(browser, app_url, e, f"/b/{w['b']}"))
        go, ge = grid(po), grid(pe)
        wait_cards(po, go, 4)
        wait_cards(pe, ge, 4)
        tab_into(po, go)
        tab_into(pe, ge)
        pe.keyboard.press("End")
        po.keyboard.press("Alt+ArrowDown")
        pe.keyboard.press("Alt+ArrowUp")
        poll(lambda: board_json(api, w["b"])["seq"] == 2, "both moves apply")
        assert board_json(api, w["b"])["order"]["unsectioned"] == expected
        for page in (po, pe):
            live(page, lambda page=page: assert_true(grid_ids(grid(page)) == expected), "the window settles on the server order")
        says(po, f"{e.name} moved {titles[3]}", LIVE_MAX_S + LIVE_SLACK_S)
        assert focused_pin(po) == ids[0] and focused_pin(pe) == ids[3], "each editor keeps focus on their card"


def test_wf_concurrent_editors_live_race(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    w, _, _ = curate_world(app_url, k, o, 4, members=((e, "editor"),))
    ids = pin_ids(w, 4)
    api, ed = Api(app_url, o), Api(app_url, e)
    path = f"/api/boards/{w['b']}/moves"
    with ExitStack() as stack:
        pages = [stack.enter_context(browse(browser, app_url, u, f"/b/{w['b']}")) for u in (o, e)]
        for page in pages:
            wait_cards(page, grid(page), 4)
        gate = threading.Barrier(2)
        results: dict[str, httpx.Response] = {}

        def fire(label: str, client: Api, body: dict) -> None:
            gate.wait()
            results[label] = client.call("POST", path, body)
        threads = [threading.Thread(target=fire, args=("o", api, move_body(ids[0], 3, 0))),
                   threading.Thread(target=fire, args=("e", ed, move_body(ids[3], 1, 0)))]
        for t in threads:
            t.start()
        for t in threads:
            t.join(HTTP_TIMEOUT_S)
        assert {r.status_code for r in results.values()} == {200}, "both moves apply, none is refused"
        bodies = sorted((r.json() for r in results.values()), key=lambda b: b["seq"])
        assert [b["seq"] for b in bodies] == [1, 2] and [b["rebased"] for b in bodies] == [False, True]
        final = board_json(api, w["b"])["order"]["unsectioned"]
        assert final == bodies[-1]["order"]["unsectioned"]
        for page in pages:
            live(page, lambda page=page: assert_true(grid_ids(grid(page)) == final), "every window ends on the same order")
from conftest import difference


APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")


def invite_subject(owner: User, board_name: str) -> str:
    return f"{owner.name} invited you to {board_name}"


def invite(api: Api, board_id: int, email: str, role: str) -> httpx.Response:
    return api.call("POST", f"/api/boards/{board_id}/invites", {"email": email, "role": role})


def accept(base: str, user: User, token: str) -> httpx.Response:
    return Api(base, user).call("POST", f"/api/invites/{token}/accept")


def latest_token(mail: Any, address: str, subject: str, known: frozenset | set = frozenset()) -> str:
    deadline = time.monotonic() + MAIL_WAIT_S
    while time.monotonic() < deadline:
        for message in mails_to(mail, address, subject=subject):
            token = invite_token(message)
            if token not in known:
                return token
    pytest.fail(f"Mailpit holds a new invite email to {address} with subject {subject!r}")


def invite_ui(page: Page, email: str, role: str) -> None:
    page.get_by_role("button", name="Invite", exact=True).click()
    dlg = page.get_by_role("dialog", name="Invite collaborators")
    visible(page, dlg, 'dialog "Invite collaborators" opens')
    dlg.get_by_role("textbox", name="Email").fill(email)
    check(dlg.get_by_role("radio", name=role))
    dlg.get_by_role("button", name="Send invite").click()
    toasts(page, f"Invite sent to {email}")
    if dlg.is_visible():
        page.keyboard.press("Escape")
    hidden(page, dlg, "the invite dialog closes")


def invite_copy(page: Page, words: str) -> None:
    target = page.get_by_text(words, exact=True).first
    join = page.get_by_role("button", name="Join board")

    def check_copy() -> None:
        if not target.is_visible() and join.is_visible() and join.is_enabled():
            join.click()
        expect(target).to_be_visible(timeout=SHORT_MS)
    soon(page, check_copy, f"the invite page shows {words!r}")


def roles_of(api: Api, board_id: int) -> dict[int, str]:
    return {m["user"]["id"]: m["role"] for m in api.ok("GET", f"/api/boards/{board_id}/members")["members"]}


def test_board_roles(app_url: str) -> None:
    k = Keys()
    o, e, v, x = person("owner"), person("editor"), person("viewer"), person("stranger")
    team = ((e, "editor"), (v, "viewer"))
    w = seed_world(app_url, k, users=[o, e, v, x],
                   boards=[board(k("b"), o, f"Shared {k.t}", members=team), board(k("sx"), o, f"Hush {k.t}", visibility="secret", members=team),
                           board(k("xb"), x, f"Other {k.t}")],
                   pins=[pin(k("p"), o, k("b"), f"Role {k.t}"), pin(k("q"), o, k("b"), f"Role two {k.t}"),
                         pin(k("h"), o, k("sx"), f"Hush {k.t}"), pin(k("r"), x, k("xb"), f"Other {k.t}")])
    O, E, V, X = (Api(app_url, u) for u in (o, e, v, x))
    moves = f"/api/boards/{w['b']}/moves"

    def seq() -> int:
        return board_json(O, w["b"])["seq"]
    for c in (O, E, V, X):
        c.ok("GET", f"/api/boards/{w['b']}")
        c.ok("POST", f"/api/pins/{w['p']}/comments", {"text": "Noted", "parent": None}, status=201)
        c.ok("PUT", f"/api/pins/{w['p']}/reaction", {"type": "idea"})
    for c, role in ((O, "owner"), (E, "editor"), (V, "viewer")):
        assert board_json(c, w["sx"])["role"] == role
        c.ok("POST", f"/api/pins/{w['h']}/comments", {"text": "Noted", "parent": None}, status=201)
    assert_error(X.call("GET", f"/api/boards/{w['sx']}"), 404, "not_found", what="stranger sees a secret board")
    assert_error(X.call("POST", f"/api/pins/{w['h']}/comments", {"text": "Peek", "parent": None}), 404, "not_found")
    E.ok("POST", moves, move_body(w["p"], 2, seq()))
    E.ok("POST", f"/api/pins/{w['r']}/saves", {"board": w["b"], "section": None}, status=201)
    sec = E.ok("POST", f"/api/boards/{w['b']}/sections", {"name": f"Editor {k.t}"}, status=201)
    E.ok("PATCH", f"/api/sections/{sec['id']}", {"name": f"Edited {k.t}"})
    before = order_of(board_json(O, w["b"]))
    for c, what in ((V, "viewer"), (X, "stranger on a public board")):
        assert_error(c.call("POST", moves, move_body(w["q"], 1, seq())), 403, "forbidden", what=what)
        assert_error(c.call("POST", f"/api/boards/{w['b']}/sections", {"name": f"No {k.t}"}), 403, "forbidden", what=what)
        assert_error(c.call("POST", "/api/operations", {"kind": "delete", "pins": [w["q"]], "board": None, "section": None}),
                     403, "forbidden", what=what)
        assert_error(c.call("POST", f"/api/pins/{w['r']}/saves", {"board": w["b"], "section": None}), 403, "forbidden", what=what)
    assert_error(X.call("POST", f"/api/boards/{w['sx']}/moves", move_body(w["h"], 1, 0)), 404, "not_found", what="stranger, secret board")
    assert order_of(board_json(O, w["b"])) == before, "refused actions change nothing"
    for c in (E, V):
        assert_error(c.call("PATCH", f"/api/boards/{w['b']}", {"name": f"Mine {k.t}"}), 403, "forbidden")
        assert_error(invite(c, w["b"], f"r.{k.t}@example.test", "viewer"), 403, "forbidden")
        assert_error(c.call("PATCH", f"/api/boards/{w['b']}/members/{v.id}", {"role": "editor"}), 403, "forbidden")
        assert_error(c.call("DELETE", f"/api/boards/{w['b']}"), 403, "forbidden")
    r = X.call("PATCH", f"/api/boards/{w['b']}", {"name": f"Taken {k.t}"})
    assert (r.status_code, r.json().get("error")) in ((403, "forbidden"), (404, "not_found"))
    assert_error(X.call("PATCH", f"/api/boards/{w['sx']}", {"name": f"Taken {k.t}"}), 404, "not_found")
    assert_error(E.call("DELETE", f"/api/boards/{w['b']}/members/{v.id}"), 403, "forbidden", what="a member removes another")
    assert board_json(O, w["b"])["name"] == f"Shared {k.t}" and roles_of(O, w["b"]) == {e.id: "editor", v.id: "viewer"}
    V.ok("DELETE", f"/api/boards/{w['sx']}/members/{v.id}", status=204)
    assert_error(V.call("GET", f"/api/boards/{w['sx']}"), 404, "not_found", what="after leaving a secret board")
    O.ok("PATCH", f"/api/boards/{w['b']}/members/{e.id}", {"role": "viewer"})
    assert_error(E.call("POST", moves, move_body(w["q"], 1, seq())), 403, "forbidden", what="the same session after a downgrade")
    assert board_json(E, w["b"])["role"] == "viewer"
    assert_error(O.call("PATCH", f"/api/boards/{w['b']}/members/{o.id}", {"role": "viewer"}), 404, "not_found", what="owner is no member row")
    assert_error(O.call("PATCH", f"/api/boards/{w['b']}/members/{e.id}", {"role": "admin"}), 422, "validation", "role")


def test_invites_reveal_no_accounts(browser: Browser, app_url: str, mail: Any) -> None:
    k = Keys()
    o, known, member, known2 = person("owner"), person("known"), person("member"), person("knowntwo")
    name = f"Garden {k.t}"
    w = seed_world(app_url, k, users=[o, known, member, known2], boards=[board(k("b"), o, name, members=((member, "viewer"),))])
    api = Api(app_url, o)
    unknown, unknown2 = f"nobody.{k.t}@example.test", f"nobody2.{k.t}@example.test"
    r1, r2 = invite(api, w["b"], known.email, "editor"), invite(api, w["b"], unknown, "editor")
    assert r1.status_code == r2.status_code == 202
    assert r1.json() == {"status": "sent", "email": known.email} and r2.json() == {"status": "sent", "email": unknown}
    assert r1.content.replace(known.email.encode(), b"@") == r2.content.replace(unknown.encode(), b"@")
    assert r1.headers.get("content-type") == r2.headers.get("content-type")
    for addr in (known.email, unknown):
        assert len(mails_to(mail, addr, subject=invite_subject(o, name))) == 1
    pending = api.ok("GET", f"/api/boards/{w['b']}/members")["invites"]
    assert_error(invite(api, w["b"], "not-an-email", "editor"), 422, "validation", "email")
    assert_error(invite(api, w["b"], f"r.{k.t}@example.test", "owner"), 422, "validation", "role")
    assert_error(invite(api, w["b"], member.email, "editor"), 409, "already_member")
    assert api.ok("GET", f"/api/boards/{w['b']}/members")["invites"] == pending, "refused invites leave nothing pending"
    replies = []
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        for addr in (known2.email, unknown2):
            with page.expect_response(lambda r: urllib.parse.urlparse(r.url).path == f"/api/boards/{w['b']}/invites") as info:
                invite_ui(page, addr, "Viewer")
            says(page, f"Invite sent to {addr}")
            replies.append((addr, info.value.status, info.value.body()))
    (a1, s1, b1), (a2, s2, b2) = replies
    assert s1 == s2 == 202 and b1.replace(a1.encode(), b"@") == b2.replace(a2.encode(), b"@")
    for addr in (known.email, known2.email, member.email):
        leaks = [m for m in mail.messages() if addr in addresses(m.get("To")) and m.get("Subject") == "You already have a Mothlight account"]
        assert not leaks, "an invite never sends the existing-account email"
    assert not [m for m in mail.messages() if member.email in addresses(m.get("To")) and m.get("Subject") == invite_subject(o, name)]


def test_invite_email(app_url: str, mail: Any) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    name = f"Attic {k.t}"
    w = seed_world(app_url, k, users=[o, e], boards=[board(k("b"), o, name)])
    api = Api(app_url, o)
    viewer_addr = f"viewer.{k.t}@example.test"
    tokens: dict[str, str] = {}
    for addr, role in ((e.email, "editor"), (viewer_addr, "viewer")):
        assert invite(api, w["b"], addr, role).status_code == 202
    for addr, line in ((e.email, "Role: Editor"), (viewer_addr, "Role: Viewer")):
        msgs = mails_to(mail, addr, subject=invite_subject(o, name))
        assert len(msgs) == 1 and from_ok(msgs[0]), "one invite email from MAIL_FROM"
        body = mail_text(msgs[0])
        assert line in body
        token = invite_token(msgs[0])
        assert len(token) >= TOKEN_MIN and re.fullmatch(r"[A-Za-z0-9_-]+", token)
        if APP_PUBLIC_URL:
            assert f"{APP_PUBLIC_URL}/invites/{token}" in body
        tokens[addr] = token
    info = httpx.get(f"{app_url}/api/invites/{tokens[e.email]}", timeout=HTTP_TIMEOUT_S)
    assert info.status_code == 200
    j = info.json()
    assert j["board"] == {"id": w["b"], "name": name} and j["inviter"]["name"] == o.name
    assert j["role"] == "editor" and j["status"] == "pending"
    E = Api(app_url, e)
    assert E.ok("POST", f"/api/invites/{tokens[e.email]}/accept") == {"board_id": w["b"], "role": "editor"}
    assert_error(E.call("POST", f"/api/invites/{tokens[e.email]}/accept"), 410, "invite_used")
    assert httpx.get(f"{app_url}/api/invites/{tokens[e.email]}").json()["status"] == "accepted"
    assert roles_of(api, w["b"]) == {e.id: "editor"}
    assert len(mails_to(mail, o.email, subject=f"{e.name} joined {name}")) == 1


def test_invite_lifetime(browser: Browser, app_url: str, mail: Any) -> None:
    k = Keys()
    o, a, b, c, d, f, h, wrong = (person(x) for x in ("owner", "alba", "bram", "cora", "dina", "finn", "hana", "wrong"))
    name = f"Loft {k.t}"
    w = seed_world(app_url, k, users=[o, a, b, c, d, f, h, wrong], boards=[board(k("b"), o, name)])
    api = Api(app_url, o)
    subject = invite_subject(o, name)
    ttl = config(app_url)["invite_ttl_seconds"]
    for u in (a, b, h):
        assert invite(api, w["b"], u.email, "viewer").status_code == 202
    tokens = {u.key: latest_token(mail, u.email, subject) for u in (a, b, h)}
    assert accept(app_url, a, tokens[a.key]).status_code == 200
    assert_error(accept(app_url, a, tokens[a.key]), 410, "invite_used")
    move_clock(app_url, ttl - 2 * MINUTE_S)
    assert accept(app_url, h, tokens[h.key]).status_code == 200, "an invite works before its lifetime ends"
    move_clock(app_url, 3 * MINUTE_S)
    assert_error(accept(app_url, b, tokens[b.key]), 410, "invite_expired")
    invite(api, w["b"], c.email, "viewer")
    t1 = latest_token(mail, c.email, subject)
    invite(api, w["b"], c.email, "viewer")
    t2 = latest_token(mail, c.email, subject, {t1})
    assert_error(accept(app_url, c, t1), 410, "invite_revoked", what="a re-invite revokes the old link")
    assert accept(app_url, c, t2).status_code == 200
    invite(api, w["b"], d.email, "viewer")
    td = latest_token(mail, d.email, subject)
    inv = next(i for i in api.ok("GET", f"/api/boards/{w['b']}/members")["invites"] if i["email"].lower() == d.email)
    api.ok("DELETE", f"/api/invites/{inv['id']}", status=204)
    assert_error(accept(app_url, d, td), 410, "invite_revoked")
    assert_error(api.call("DELETE", f"/api/invites/{inv['id']}"), 409, "invite_not_pending")
    invite(api, w["b"], f.email, "viewer")
    tf = latest_token(mail, f.email, subject)
    assert_error(accept(app_url, wrong, tf), 403, "forbidden", what="signed in with another email")
    junk = "x" * TOKEN_MIN
    assert_error(httpx.get(f"{app_url}/api/invites/{junk}"), 404, "not_found")
    assert roles_of(api, w["b"]) == {a.id: "viewer", h.id: "viewer", c.id: "viewer"}
    for user, token, words in ((a, tokens[a.key], "This invite has already been used."), (b, tokens[b.key], "This invite has expired."),
                               (d, td, "This invite was withdrawn."), (wrong, tf, "This invite is for another email address."),
                               (wrong, junk, "This invite link isn't valid.")):
        with browse(browser, app_url, user, f"/invites/{token}") as page:
            invite_copy(page, words)
    assert wrong.id not in roles_of(api, w["b"])


@pytest.mark.timeout(900)
def test_wf_invite_editor_live_happy(browser: Browser, app_url: str, mail: Any) -> None:
    k = Keys()
    o, ed, vw, late = person("owner"), person("editor"), person("viewer"), person("late")
    name = f"Reno {k.t}"
    w = seed_world(app_url, k, users=[o, ed, vw, late], boards=[board(k("b"), o, name)], pins=[pin(k("p"), o, k("b"), f"Tile {k.t}")])
    api = Api(app_url, o)
    subject = invite_subject(o, name)
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api))
        for u, role in ((ed, "Editor"), (vw, "Viewer"), (late, "Viewer")):
            invite_ui(po, u.email, role)
        tokens = {u.key: latest_token(mail, u.email, subject) for u in (ed, vw, late)}
        assert "Role: Editor" in mail_text(mails_to(mail, ed.email, subject=subject)[0])
        pe = stack.enter_context(browse(browser, app_url, ed, f"/invites/{tokens[ed.key]}"))
        visible(pe, pe.get_by_role("heading", name=f"Join {name}"), "the invite page names the board")
        pe.get_by_role("button", name="Join board").click()
        says(pe, f"You joined {name}")
        soon(pe, lambda: assert_true(urllib.parse.urlparse(pe.url).path == f"/b/{w['b']}"), "joining leads to the board")
        pe.goto(f"{app_url}/create")
        fill_composer(pe, image=png(240, 300, random_rgb()), title=f"Editor {k.t}", alt="Editor print", board_name=name)
        pe.get_by_role("button", name="Publish").click()
        soon(pe, lambda: assert_true("/pin/" in pe.url), "the editor's pin publishes")
        live(po, lambda: expect(card(po, f"Editor {k.t}", "Editor print")).to_be_visible(timeout=SHORT_MS), "the owner sees it live")
        says(po, f"{ed.name} added Editor {k.t}", LIVE_MAX_S + LIVE_SLACK_S)
        pv = stack.enter_context(browse(browser, app_url, vw, f"/invites/{tokens[vw.key]}"))
        pv.get_by_role("button", name="Join board").click()
        soon(pv, lambda: assert_true(urllib.parse.urlparse(pv.url).path == f"/b/{w['b']}"), "the viewer reaches the board")
        visible(pv, pv.get_by_role("heading", name=name, level=1), "the viewer sees the board")
        expect(pv.get_by_role("button", name="Add pin")).to_have_count(0)
        expect(pv.get_by_role("button", name="Add section")).to_have_count(0)
    V = Api(app_url, vw)
    assert_error(V.call("POST", f"/api/boards/{w['b']}/moves", move_body(w["p"], 2, board_json(V, w["b"])["seq"])), 403, "forbidden")
    move_clock(app_url, config(app_url)["invite_ttl_seconds"] + 1)
    with browse(browser, app_url, late, f"/invites/{tokens[late.key]}") as page:
        invite_copy(page, "This invite has expired.")
    assert roles_of(api, w["b"]) == {ed.id: "editor", vw.id: "viewer"}
    assert any(p["title"] == f"Editor {k.t}" and p["owner"]["id"] == ed.id for p in board_json(api, w["b"])["pins"])
    mails_to(mail, o.email, subject=f"{ed.name} joined {name}")


def test_wf_invite_editor_live_enumeration(browser: Browser, app_url: str, mail: Any) -> None:
    k = Keys()
    o, known = person("owner"), person("known")
    name = f"Party {k.t}"
    w = seed_world(app_url, k, users=[o, known], boards=[board(k("b"), o, name)])
    unknown = f"stranger.{k.t}@example.test"
    replies = []
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        for addr in (known.email, unknown):
            with page.expect_response(lambda r: urllib.parse.urlparse(r.url).path == f"/api/boards/{w['b']}/invites") as info:
                invite_ui(page, addr, "Editor")
            replies.append((addr, info.value.status, info.value.body()))
    (a1, s1, b1), (a2, s2, b2) = replies
    assert s1 == s2 == 202 and b1.replace(a1.encode(), b"@") == b2.replace(a2.encode(), b"@")
    for addr in (known.email, unknown):
        msgs = mails_to(mail, addr, subject=invite_subject(o, name))
        assert len(msgs) == 1 and "Role: Editor" in mail_text(msgs[0])
    assert not [m for m in mail.messages() if known.email in addresses(m.get("To"))
                and m.get("Subject") == "You already have a Mothlight account"]
    invites = Api(app_url, o).ok("GET", f"/api/boards/{w['b']}/members")["invites"]
    assert sorted((i["email"].lower(), i["role"]) for i in invites) == sorted([(known.email, "editor"), (unknown, "editor")])


def test_wf_invite_editor_live_device_clock(browser: Browser, app_url: str, mail: Any) -> None:
    k = Keys()
    o, e1, e2 = person("owner"), person("early"), person("tardy")
    name = f"Cabin {k.t}"
    w = seed_world(app_url, k, users=[o, e1, e2], boards=[board(k("b"), o, name)])
    api = Api(app_url, o)
    ttl = config(app_url)["invite_ttl_seconds"]
    invite(api, w["b"], e1.email, "editor")
    t1 = latest_token(mail, e1.email, invite_subject(o, name))
    with browse(browser, app_url, e1, f"/invites/{t1}", device_time=business_now(app_url) + timedelta(seconds=2 * ttl)) as page:
        btn = page.get_by_role("button", name="Join board")
        visible(page, btn, "a pending invite offers Join board whatever the device clock says")
        btn.click()
        says(page, f"You joined {name}")
    poll(lambda: roles_of(api, w["b"]).get(e1.id) == "editor", "the early joiner is an editor")
    invite(api, w["b"], e2.email, "viewer")
    t2 = latest_token(mail, e2.email, invite_subject(o, name))
    move_clock(app_url, ttl + 1)
    with browse(browser, app_url, e2, f"/invites/{t2}", device_time=business_now(app_url) - timedelta(seconds=2 * ttl)) as page:
        invite_copy(page, "This invite has expired.")
    assert e2.id not in roles_of(api, w["b"])
    assert_error(accept(app_url, e2, t2), 410, "invite_expired")


def open_collaborators(page: Page) -> Locator:
    page.get_by_role("button", name="Collaborators").click()
    dlg = page.get_by_role("dialog", name="Collaborators")
    visible(page, dlg, 'dialog "Collaborators" opens')
    return dlg


def viewing(page: Page, names: list[str]) -> None:
    items = page.get_by_role("list", name="Viewing now").get_by_role("listitem")
    expect(items).to_have_count(len(names), timeout=SHORT_MS)
    for i, n in enumerate(names):
        expect(items.nth(i)).to_contain_text(n, timeout=SHORT_MS)
    words = "1 person viewing" if len(names) == 1 else f"{len(names)} people viewing"
    expect(page.get_by_text(words, exact=True).first).to_be_visible(timeout=SHORT_MS)


def secret_team(base: str, label: str, role: str = "editor") -> tuple[Keys, User, User, World, Api, Api]:
    k = Keys()
    o, m = person("owner"), person(label)
    w = seed_world(base, k, users=[o, m],
                   boards=[board(k("b"), o, f"Surprise {k.t}", visibility="secret", members=((m, role),),
                                 sections=((k("s"), f"Shelf {k.t}"),)), board(k("mb"), m, f"Own {k.t}")],
                   pins=[pin(k("p"), o, k("b"), f"Gift {k.t}", alt="Gift print"), pin(k("q"), o, k("b"), f"Cake {k.t}", alt="Cake print"),
                         pin(k("mp"), m, k("mb"), f"Mine {k.t}")])
    return k, o, m, w, Api(base, o), Api(base, m)


def test_collaborators_dialog(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, a, b = person("owner"), person("alba"), person("bram")
    name = f"Studio {k.t}"
    w = seed_world(app_url, k, users=[o, a, b], boards=[board(k("b"), o, name, members=((a, "editor"), (b, "viewer")))])
    api = Api(app_url, o)
    pending = f"pending.{k.t}@example.test"
    api.ok("POST", f"/api/boards/{w['b']}/invites", {"email": pending, "role": "viewer"}, status=202)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        dlg = open_collaborators(page)
        role_a = dlg.get_by_role("combobox", name=f"Role for {a.name}")
        select(role_a, "Viewer")
        says(page, f"{a.name} is now a viewer")
        poll(lambda: roles_of(api, w["b"]).get(a.id) == "viewer", "the role change is stored")
        select(role_a, "Editor")
        says(page, f"{a.name} is now an editor")
        poll(lambda: roles_of(api, w["b"]).get(a.id) == "editor", "the role change back is stored")
        dlg.get_by_role("button", name=f"Withdraw invite to {pending}").click()
        poll(lambda: all(i["email"].lower() != pending for i in api.ok("GET", f"/api/boards/{w['b']}/members")["invites"]),
             "the invite is withdrawn")
        dlg.get_by_role("button", name=f"Remove {b.name}").click()
        says(page, f"{b.name} was removed")
        poll(lambda: b.id not in roles_of(api, w["b"]), "the member is removed")
    with browse(browser, app_url, a, f"/b/{w['b']}") as page:
        open_collaborators(page).get_by_role("button", name="Leave board").click()
        soon(page, lambda: assert_true(urllib.parse.urlparse(page.url).path == "/"), "leaving goes to /")
        says(page, f"You left {name}")
    assert roles_of(api, w["b"]) == {}
    assert board_json(Api(app_url, a), w["b"])["role"] is None


def test_role_changes_apply_at_once(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    w, titles, alts = curate_world(app_url, k, o, 3, members=((e, "editor"),))
    ids = pin_ids(w, 3)
    api, E = Api(app_url, o), Api(app_url, e)
    frames: list[dict] = []
    with browse(browser, app_url, e, f"/b/{w['b']}", api=E, before=ws_recorder(frames)) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        for control in ("Add pin", "Add section"):
            visible(page, page.get_by_role("button", name=control), f"an editor sees {control}")
        tab_into(page, g)
        page.keyboard.press("Space")
        visible(page, toolbar(page), "an editor can select")
        page.keyboard.press("Escape")
        api.ok("PATCH", f"/api/boards/{w['b']}/members/{e.id}", {"role": "viewer"})
        seq0 = board_json(api, w["b"])["seq"]
        assert_error(E.call("POST", f"/api/boards/{w['b']}/moves", move_body(ids[0], 2, seq0)), 403, "forbidden")
        assert_error(E.call("POST", f"/api/boards/{w['b']}/sections", {"name": f"Late {k.t}"}), 403, "forbidden")
        live(page, lambda: (expect(page.get_by_role("button", name="Add pin")).to_have_count(0, timeout=SHORT_MS),
                            expect(page.get_by_role("button", name="Add section")).to_have_count(0, timeout=SHORT_MS)),
             "editing controls disappear live")
        toasts(page, "You can now only view this board")
        says(page, "You can now only view this board")
        card(page, titles[0], alts[0]).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Alt+ArrowDown")
        advance(page, STEP_MS)
        expect(toolbar(page)).to_have_count(0)
        assert all(c["selected"] != "true" for c in read_cards(g))
    b = board_json(api, w["b"])
    assert b["seq"] == seq0 and b["order"]["unsectioned"] == ids
    assert any(f.get("type") == "membership" and f.get("board_id") == w["b"] and f.get("role") == "viewer" for f in frames)


def same_as_missing(client: Api, method: str, real: str, fake: str, body: Any = None) -> None:
    r1, r2 = client.call(method, real, body), client.call(method, fake, body)
    assert r1.status_code == r2.status_code == 404, f"{method} {real} answers 404 like a missing id; got {r1.status_code}/{r2.status_code}"
    assert r1.json() == {"error": "not_found"} and r1.content == r2.content, f"{method} {real} matches a never-existing id byte for byte"
    assert r1.headers.get("content-type") == r2.headers.get("content-type")


def test_removal_hides_board(browser: Browser, app_url: str) -> None:
    k, o, m, w, api, M = secret_team(app_url, "member", "viewer")
    assert media(M, w["p"], "original").status_code == 200
    frames: list[dict] = []
    with browse(browser, app_url, m, f"/b/{w['b']}", api=M, before=ws_recorder(frames)) as page:
        visible(page, card(page, f"Gift {k.t}", "Gift print"), "the member sees the board")
        page.evaluate("() => { window.__mlProbe = 'kept'; }")
        api.ok("DELETE", f"/api/boards/{w['b']}/members/{m.id}", status=204)
        live(page, lambda: expect(page.get_by_role("heading", name="Board not found")).to_be_visible(timeout=SHORT_MS),
             "the open page shows Board not found")
        assert page.evaluate("() => window.__mlProbe") == "kept", "no reload"
        expect(card(page, f"Gift {k.t}", "Gift print")).to_have_count(0)
    assert any(f.get("type") == "membership" and f.get("board_id") == w["b"] and "role" in f and f["role"] is None for f in frames)
    for real, fake in ((f"/api/boards/{w['b']}", f"/api/boards/{MISSING_ID}"), (f"/api/pins/{w['p']}", f"/api/pins/{MISSING_ID}"),
                       (f"/api/pins/{w['p']}/comments", f"/api/pins/{MISSING_ID}/comments"),
                       (f"/media/{w['p']}/original", f"/media/{MISSING_ID}/original")):
        same_as_missing(M, "GET", real, fake)
    assert media(api, w["p"], "original").status_code == 200, "the owner still sees the image"
    assert invite(api, w["b"], m.email, "viewer").status_code == 202, "a removed person can be invited again"


def test_who_is_viewing(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, a, b = person("owner"), person("alba"), person("bram")
    w = seed_world(app_url, k, users=[o, a, b], boards=[board(k("b"), o, f"Atelier {k.t}", members=((a, "editor"), (b, "viewer")))],
                   pins=[pin(k("p"), o, k("b"), f"Easel {k.t}")])
    api = Api(app_url, o)
    path = f"/b/{w['b']}"

    def viewer_ids() -> list[int]:
        return [v["id"] for v in api.ok("GET", f"/api/boards/{w['b']}/viewers")["viewers"]]
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, path, api=api))
        live(po, lambda: viewing(po, [o.name]), "the owner counts themselves")
        cm_a1 = browse(browser, app_url, a, path)
        pa1 = cm_a1.__enter__()
        live(po, lambda: viewing(po, [o.name, a.name]), "an arrival joins the list")
        says(po, f"{a.name} opened this board", LIVE_MAX_S + LIVE_SLACK_S)
        live(pa1, lambda: viewing(pa1, [o.name, a.name]), "the member sees the same list")
        stack.enter_context(browse(browser, app_url, a, path))
        cm_b = browse(browser, app_url, b, path)
        pb = cm_b.__enter__()
        live(po, lambda: viewing(po, [o.name, a.name, b.name]), "one entry per person, earliest first")
        live(pb, lambda: viewing(pb, [o.name, a.name, b.name]), "the newest viewer sees the list")
        poll(lambda: viewer_ids() == [o.id, a.id, b.id], "GET viewers lists them in order")
        cm_a1.__exit__(None, None, None)
        cm_b.__exit__(None, None, None)
        live(po, lambda: viewing(po, [o.name, a.name]), "a closed last window leaves; a second window keeps its person")
        says(po, f"{b.name} left this board", LIVE_MAX_S + LIVE_SLACK_S)
        assert viewer_ids() == [o.id, a.id]
        expect(announcements(po)).not_to_contain_text(f"{o.name} opened this board")
        api.ok("DELETE", f"/api/boards/{w['b']}/members/{a.id}", status=204)
        live(po, lambda: viewing(po, [o.name]), "a removed person leaves the list")
    assert a.id not in viewer_ids()


def test_wf_remove_member_404_happy(browser: Browser, app_url: str) -> None:
    k, o, m, w, api, M = secret_team(app_url, "member")
    with ExitStack() as stack:
        pm = stack.enter_context(browse(browser, app_url, m, f"/b/{w['b']}", api=M))
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api))
        visible(pm, pm.get_by_role("button", name="Add pin"), "the editor sees Add pin")
        dlg = open_collaborators(po)
        select(dlg.get_by_role("combobox", name=f"Role for {m.name}"), "Viewer")
        says(po, f"{m.name} is now a viewer")
        live(pm, lambda: expect(pm.get_by_role("button", name="Add pin")).to_have_count(0, timeout=SHORT_MS), "Add pin goes live")
        toasts(pm, "You can now only view this board")
        assert_error(M.call("POST", f"/api/boards/{w['b']}/moves", move_body(w["p"], 2, board_json(api, w["b"])["seq"])), 403, "forbidden")
        dlg.get_by_role("button", name=f"Remove {m.name}").click()
        says(po, f"{m.name} was removed")
        live(pm, lambda: expect(pm.get_by_role("heading", name="Board not found")).to_be_visible(timeout=SHORT_MS),
             "the member's window shows Board not found")
    assert_error(M.call("GET", f"/api/boards/{w['b']}"), 404, "not_found")
    assert_error(M.call("GET", f"/api/pins/{w['p']}"), 404, "not_found")
    assert roles_of(api, w["b"]) == {}


def test_wf_remove_member_404_probe(browser: Browser, app_url: str) -> None:
    k, o, m, w, api, M = secret_team(app_url, "member")
    api.ok("DELETE", f"/api/boards/{w['b']}/members/{m.id}", status=204)
    probes = [("GET", "/api/boards/{}", w["b"], lambda i: None), ("GET", "/api/boards/{}/members", w["b"], lambda i: None),
              ("POST", "/api/boards/{}/moves", w["b"], lambda i: move_body(w["p"], 1, 0)),
              ("GET", "/api/pins/{}", w["p"], lambda i: None), ("GET", "/media/{}/original", w["p"], lambda i: None),
              ("PUT", "/api/pins/{}/reaction", w["p"], lambda i: {"type": "love"}),
              ("POST", "/api/pins/{}/saves", w["p"], lambda i: {"board": w["mb"], "section": None})]
    for method, tpl, real, body in probes:
        same_as_missing(M, method, tpl.format(real), tpl.format(MISSING_ID), body(real))
    r1 = M.call("POST", f"/api/pins/{w['mp']}/saves", {"board": w["b"], "section": None})
    r2 = M.call("POST", f"/api/pins/{w['mp']}/saves", {"board": MISSING_ID, "section": None})
    assert r1.status_code == r2.status_code == 404 and r1.content == r2.content, "a hidden board in a body answers 404, never 422"
    r1 = M.call("POST", "/api/operations", {"kind": "move", "pins": [w["p"]], "board": w["mb"], "section": None})
    r2 = M.call("POST", "/api/operations", {"kind": "move", "pins": [MISSING_ID], "board": w["mb"], "section": None})
    assert r1.status_code == r2.status_code == 404 and r1.content == r2.content
    with browse(browser, app_url, m, f"/pin/{w['p']}", api=M) as page:
        visible(page, page.get_by_role("heading", name="Pin not found"), "the pin URL shows not found")
        page.goto(f"{app_url}/b/{w['b']}")
        visible(page, page.get_by_role("heading", name="Board not found"), "the board URL shows not found")
    assert board_json(api, w["b"])["pin_count"] == 2 and board_json(M, w["mb"])["pin_count"] == 1


def test_wf_remove_member_404_leave(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, m, n = person("owner"), person("leaver"), person("stayer")
    name = f"Vault {k.t}"
    w = seed_world(app_url, k, users=[o, m, n], boards=[board(k("b"), o, name, visibility="secret", members=((m, "viewer"), (n, "viewer")))],
                   pins=[pin(k("p"), o, k("b"), f"Plan {k.t}")])
    api, M = Api(app_url, o), Api(app_url, m)
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api))
        live(po, lambda: viewing(po, [o.name]), "the owner sees themselves")
        pm = stack.enter_context(browse(browser, app_url, m, f"/b/{w['b']}", api=M))
        live(po, lambda: viewing(po, [o.name, m.name]), "the member arrives")
        open_collaborators(pm).get_by_role("button", name="Leave board").click()
        soon(pm, lambda: assert_true(urllib.parse.urlparse(pm.url).path == "/"), "leaving goes to /")
        says(pm, f"You left {name}")
        live(po, lambda: viewing(po, [o.name]), "the leaver leaves the list")
        says(po, f"{m.name} left this board", LIVE_MAX_S + LIVE_SLACK_S)
    assert roles_of(api, w["b"]) == {n.id: "viewer"}
    assert_error(M.call("GET", f"/api/boards/{w['b']}"), 404, "not_found")


def secret_world(base: str) -> tuple[Keys, User, User, User, World, str, str]:
    k = Keys()
    o, f, m = person("owner"), person("follower"), person("member")
    word, pub = f"reno{k.t}", f"porch{k.t}"
    now = business_now(base)
    w = seed_world(base, k, users=[o, f, m],
                   boards=[board(k("sx"), o, f"Renovate {k.t}", visibility="secret", members=((m, "viewer"),)),
                           board(k("pb"), o, f"Porch {k.t}"), board(k("fb"), f, f"Mine {k.t}")],
                   pins=[pin(k("h1"), o, k("sx"), f"Budget {word}", alt="Budget sheet", description=f"#{word}tag costs", at=ago(now, minutes=5)),
                         pin(k("h2"), o, k("sx"), f"Tiles {word}", alt="Tile sample", at=ago(now, minutes=4)),
                         pin(k("p1"), o, k("pb"), f"Swing {pub}", alt="Porch swing", description=f"#{pub}tag", at=ago(now, minutes=10))],
                   follows=[follow_user(f, o), follow_board(f, k("pb"))])
    return k, o, f, m, w, word, pub


def ids_of(pins: list[dict]) -> set[int]:
    return {p["id"] for p in pins}


def test_secret_boards_stay_secret(app_url: str) -> None:
    k, o, f, m, w, word, pub = secret_world(app_url)
    F, M, O = Api(app_url, f), Api(app_url, m), Api(app_url, o)
    secret = {w["h1"], w["h2"]}
    for query in (f"q={word}", f"q=&tag={word}tag", "q="):
        s = F.ok("GET", f"/api/search?{query}")
        assert not secret & ids_of(s["pins"]), f"search {query} hides secret pins"
        assert all(t["tag"] != f"{word}tag" for t in s["tags"]) and all(b["id"] != w["sx"] for b in s["boards"])
    assert not secret & ids_of(F.ok("GET", "/api/feed")["pins"])
    prof = F.ok("GET", f"/api/users/{o.handle}")
    assert [b["id"] for b in prof["boards"]] == [w["pb"]] and prof["board_total"] == 1 and prof["pin_total"] == 1
    assert not secret & ids_of(F.ok("GET", f"/api/users/{o.handle}/pins")["pins"])
    assert_error(F.call("PUT", f"/api/follows/boards/{w['sx']}"), 404, "not_found", what="following a hidden board")
    s = M.ok("GET", f"/api/search?q={word}")
    assert secret <= ids_of(s["pins"])
    assert {"tag": f"{word}tag", "count": 1} in s["tags"]
    assert any(b["id"] == w["sx"] and b["count"] == 2 for b in s["boards"])
    assert secret <= ids_of(M.ok("GET", "/api/feed")["pins"])
    mprof = M.ok("GET", f"/api/users/{o.handle}")
    assert mprof["board_total"] == 2 and mprof["pin_total"] == 3
    assert w["sx"] in [b["id"] for b in O.ok("GET", "/api/boards/mine")["boards"]]
    O.ok("PATCH", f"/api/boards/{w['pb']}", {"visibility": "secret"})
    assert w["p1"] not in ids_of(F.ok("GET", "/api/feed")["pins"]), "a followed board turned secret leaves the feed"
    prof = F.ok("GET", f"/api/users/{o.handle}")
    assert prof["boards"] == [] and prof["board_total"] == 0 and prof["pin_total"] == 0
    assert_error(F.call("GET", f"/api/boards/{w['pb']}"), 404, "not_found")
    assert F.ok("GET", f"/api/search?q={pub}")["pins"] == []


def test_hidden_is_not_found(browser: Browser, app_url: str) -> None:
    k, o, f, m, w, word, pub = secret_world(app_url)
    F = Api(app_url, f)
    assert media(Api(app_url, o), w["h1"], "original").status_code == 200, "the image exists for the owner"
    probes = [("GET", t, w["sx"], None) for t in ("/api/boards/{}", "/api/boards/{}/members", "/api/boards/{}/viewers")]
    probes += [("GET", t, w["h1"], None) for t in ("/api/pins/{}", "/api/pins/{}/comments", "/media/{}/original",
                                                   "/media/{}/" + str(VARIANT_WIDTHS[0]))]
    probes += [("PATCH", "/api/pins/{}", w["h1"], {"version": 1, "title": "Peek"}),
               ("POST", "/api/pins/{}/comments", w["h1"], {"text": "Peek", "parent": None}),
               ("PUT", "/api/pins/{}/reaction", w["h1"], {"type": "love"}),
               ("POST", "/api/pins/{}/saves", w["h1"], {"board": w["fb"], "section": None}),
               ("POST", "/api/boards/{}/moves", w["sx"], move_body(w["h1"], 1, 0))]
    for method, tpl, real, body in probes:
        same_as_missing(F, method, tpl.format(real), tpl.format(MISSING_ID), body)
    with browse(browser, app_url, f, f"/b/{w['sx']}", api=F) as page:
        for path, heading in ((f"/b/{w['sx']}", "Board not found"), (f"/b/{MISSING_ID}", "Board not found"),
                              (f"/pin/{w['h1']}", "Pin not found"), (f"/nowhere-{k.t}", "Page not found")):
            page.goto(f"{app_url}{path}")
            visible(page, page.get_by_role("heading", name=heading), f"{path} shows {heading}")
            expect(page.get_by_role("main")).not_to_contain_text(word)


def test_board_names(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, other = person("namer"), person("other")
    name, tiles = f"Kitchen {k.t}", f"Tiles {k.t}"
    w = seed_world(app_url, k, users=[o, other], boards=[board(k("b"), o, name, sections=((k("s"), tiles),)), board(k("c"), o, f"Cellar {k.t}")])
    api = Api(app_url, o)
    lim = config(app_url)["limits"]["board_name_max"]
    for dup in (name.upper(), f"  {name.lower()}  "):
        assert_error(api.call("POST", "/api/boards", {"name": dup, "visibility": "public"}), 409, "board_name_taken")
    assert Api(app_url, other).call("POST", "/api/boards", {"name": name, "visibility": "public"}).status_code == 201
    assert_error(api.call("PATCH", f"/api/boards/{w['c']}", {"name": name.lower()}), 409, "board_name_taken")
    for bad in ("   ", "n" * (lim + 1)):
        assert_error(api.call("POST", "/api/boards", {"name": bad, "visibility": "public"}), 422, "validation", "name")
    r = api.call("POST", "/api/boards", {"name": "  " + "p" * lim + "  ", "visibility": "public"})
    assert r.status_code == 201 and r.json()["name"] == "p" * lim, "the limit applies after trimming"
    assert_error(api.call("POST", "/api/boards", {"name": f"Vis {k.t}", "visibility": "hidden"}), 422, "validation", "visibility")
    assert_error(api.call("POST", f"/api/boards/{w['b']}/sections", {"name": tiles.upper()}), 409, "section_name_taken")
    assert api.call("POST", f"/api/boards/{w['c']}/sections", {"name": tiles}).status_code == 201
    assert_error(api.call("POST", f"/api/boards/{w['b']}/sections", {"name": "s" * (lim + 1)}), 422, "validation", "name")
    grout = api.ok("POST", f"/api/boards/{w['b']}/sections", {"name": f"Grout {k.t}"}, status=201)
    assert_error(api.call("PATCH", f"/api/sections/{grout['id']}", {"name": tiles.lower()}), 409, "section_name_taken")
    assert sorted(b["name"] for b in api.ok("GET", "/api/boards/mine")["boards"]) == sorted([name, f"Cellar {k.t}", "p" * lim])
    with browse(browser, app_url, o, "/boards", api=api) as page:
        page.get_by_role("button", name="Create board").click()
        dlg = page.get_by_role("dialog", name="Create board")
        visible(page, dlg, 'dialog "Create board" opens')
        check(dlg.get_by_role("radio", name="Public"))
        for typed, words in ((name, f"You already have a board called {name}."), ("   ", f"Board names are 1 to {lim} characters.")):
            dlg.get_by_role("textbox", name="Name").fill(typed)
            dlg.get_by_role("button", name="Create", exact=True).click()
            alerted(page, words)
        page.goto(f"{app_url}/b/{w['b']}")
        page.get_by_role("button", name="Add section").click()
        dlg = page.get_by_role("dialog", name="Add section")
        visible(page, dlg, 'dialog "Add section" opens')
        for typed, words in ((tiles, f"This board already has a section called {tiles}."), ("   ", f"Section names are 1 to {lim} characters.")):
            dlg.get_by_role("textbox", name="Name").fill(typed)
            dlg.get_by_role("button", name="Create", exact=True).click()
            alerted(page, words)
    assert len(board_json(api, w["b"])["order"]["sections"]) == 2


def in_dom_order(scope: Locator, names: list[str]) -> bool:
    handles = [scope.get_by_text(n, exact=True).first.element_handle(timeout=SHORT_MS) for n in names]
    return all(scope.page.evaluate("([a, b]) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)",
                                   [handles[i], handles[i + 1]]) for i in range(len(handles) - 1))


def test_profile_boards_and_sort(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, f = person("owner"), person("visitor")
    now = business_now(app_url)
    n = {"birch": f"Birch {k.t}", "alder": f"alder {k.t}", "cedar": f"Cedar {k.t}", "elm": f"Elm {k.t}", "dog": f"Dogwood {k.t}"}
    day = ago(now, days=1)
    w = seed_world(app_url, k, users=[o, f],
                   boards=[board(k("birch"), o, n["birch"], at=ago(now, days=5)), board(k("alder"), o, n["alder"], at=ago(now, days=3)),
                           board(k("cedar"), o, n["cedar"], at=day), board(k("elm"), o, n["elm"], at=day),
                           board(k("dog"), o, n["dog"], visibility="secret", at=ago(now, hours=12))],
                   pins=[pin(k("b1"), o, k("birch"), f"Bark {k.t}", at=ago(now, hours=2)), pin(k("b2"), o, k("birch"), f"Leaf {k.t}", at=ago(now, hours=1)),
                         pin(k("a1"), o, k("alder"), f"Cone {k.t}", at=ago(now, hours=3)), pin(k("d1"), o, k("dog"), f"Den {k.t}", at=ago(now, minutes=10))])
    F, O = Api(app_url, f), Api(app_url, o)
    orders = {"last_saved": ["birch", "alder", "cedar", "elm"], "az": ["alder", "birch", "cedar", "elm"], "newest": ["cedar", "elm", "alder", "birch"]}
    for sort, keys in orders.items():
        got = F.ok("GET", f"/api/users/{o.handle}?sort={sort}")
        assert [b["id"] for b in got["boards"]] == [w[x] for x in keys], f"sort={sort}"
    prof = F.ok("GET", f"/api/users/{o.handle}?sort=last_saved")
    assert {b["id"]: b["pin_count"] for b in prof["boards"]} == {w["birch"]: 2, w["alder"]: 1, w["cedar"]: 0, w["elm"]: 0}
    assert prof["board_total"] == 4 and prof["pin_total"] == 3
    own = O.ok("GET", f"/api/users/{o.handle}?sort=last_saved")
    assert [b["id"] for b in own["boards"]][:2] == [w["dog"], w["birch"]] and own["board_total"] == 5
    assert [b["id"] for b in O.ok("GET", "/api/boards/mine")["boards"]][:3] == [w["dog"], w["birch"], w["alder"]]
    with browse(browser, app_url, f, f"/u/{o.handle}", api=F) as page:
        visible(page, page.get_by_role("tab", name="Boards"), 'tab "Boards" shows')
        main = page.get_by_role("main")
        for label, key in (("Last saved to", "last_saved"), ("A to Z", "az"), ("Newest", "newest")):
            select(page.get_by_role("combobox", name="Sort boards"), label)
            soon(page, lambda key=key: assert_true(in_dom_order(main, [n[x] for x in orders[key]])), f"{label} orders the boards")
        for words in ("2 pins", "1 pin", "0 pins"):
            shows_text(page, words, f"a board card shows {words}")
        expect(main.get_by_text(n["dog"], exact=True)).to_have_count(0)
        page.get_by_role("tab", name="Pins").click()
        visible(page, card(page, f"Leaf {k.t}", f"Leaf {k.t} print"), 'tab "Pins" lists the pins')


def test_word_prefix_search(app_url: str) -> None:
    k = Keys()
    o, f = person("owner"), person("seeker")
    W = f"q{k.t}"
    now = business_now(app_url)
    t3 = ago(now, hours=3)
    w = seed_world(app_url, k, users=[o, f],
                   boards=[board(k("pa"), o, f"Alpha {k.t}"), board(k("pb"), o, f"beta {k.t}"), board(k("sx"), o, f"Vault {k.t}", visibility="secret")],
                   pins=[pin(k("a"), o, k("pa"), f"{W}lantern brass", at=t3),
                         pin(k("b"), o, k("pa"), f"Old {W}lamp", description=f"{W}lantern shade", at=ago(now, hours=2)),
                         pin(k("c"), o, k("pb"), "Moth", description=f"#{W}lanterns", at=ago(now, hours=1)),
                         pin(k("g"), o, k("pb"), f"{W}lantern", at=t3),
                         pin(k("d"), o, k("pa"), f"x{W}lantern", at=ago(now, minutes=30)),
                         pin(k("e"), o, k("sx"), f"{W}lantern secret", at=ago(now, minutes=5))])
    F, O = Api(app_url, f), Api(app_url, o)

    def ids(api: Api, query: str) -> list[int]:
        return [p["id"] for p in api.ok("GET", f"/api/search?{query}")["pins"]]
    assert ids(F, f"q={W}lan") == [w["c"], w["b"], w["a"], w["g"]], "visible prefix matches, newest first, ties by id"
    assert ids(O, f"q={W}lan") == [w["e"], w["c"], w["b"], w["a"], w["g"]]
    assert ids(F, f"q={W.upper()}LAN+brass") == [w["a"]]
    assert ids(F, f"q=bra+{W}lan") == [w["a"]]
    assert ids(F, f"q={W}lan+zz{k.t}") == []
    assert ids(F, f"q={W}lan&tag={W.upper()}LANTERNS") == [w["c"]]
    assert ids(F, f"q={W}lan&board={w['pb']}") == [w["c"], w["g"]]
    s = F.ok("GET", f"/api/search?q={W}lan")
    assert s["tags"] == [{"tag": f"{W}lanterns", "count": 1}]
    assert s["boards"] == [{"id": w["pa"], "name": f"Alpha {k.t}", "count": 2}, {"id": w["pb"], "name": f"beta {k.t}", "count": 2}]
    s = F.ok("GET", f"/api/search?q={W}lan&tag={W}lanterns")
    assert s["boards"] == [{"id": w["pb"], "name": f"beta {k.t}", "count": 1}] and s["tags"] == [{"tag": f"{W}lanterns", "count": 1}]
    s = F.ok("GET", f"/api/search?q={W}lan&board={w['pb']}")
    assert s["tags"] == [{"tag": f"{W}lanterns", "count": 1}] and len(s["boards"]) == 2
    assert F.ok("GET", "/api/search?q=")["pins"] == [], "an empty query with no tag returns no pins"


def test_empty_search_copy(browser: Browser, app_url: str) -> None:
    k, o, f, m, w, word, pub = secret_world(app_url)
    with browse(browser, app_url, f, "/search") as page:
        box = page.get_by_role("searchbox", name="Search pins")
        visible(page, box, "the search box shows")
        for typed, shown in ((f"  NoMatch{k.t}  ", f"NoMatch{k.t}"), (word, word)):
            box.fill(typed)
            box.press("Enter")
            shows_text(page, f'No pins match "{shown}".', "the published empty-search sentence shows")
        box.fill(pub)
        box.press("Enter")
        visible(page, card(page, f"Swing {pub}", "Porch swing"), "a visible match shows")
        expect(page.get_by_text("No pins match")).to_have_count(0)
        page.goto(f"{app_url}/search?q=")
        visible(page, page.get_by_role("main"), "the search page renders")
        advance(page, STEP_MS)
        expect(page.get_by_text("No pins match")).to_have_count(0)


@pytest.mark.timeout(900)
def test_wf_secret_board_search_probe(browser: Browser, app_url: str) -> None:
    k, o, f, m, w, word, pub = secret_world(app_url)
    F = Api(app_url, f)
    with browse(browser, app_url, f, f"/b/{w['sx']}", api=F) as page:
        visible(page, page.get_by_role("heading", name="Board not found"), "the secret board is not found")
        page.goto(f"{app_url}/pin/{w['h1']}")
        visible(page, page.get_by_role("heading", name="Pin not found"), "the secret pin is not found")
        r = page.request.get(f"{app_url}/media/{w['h1']}/original")
        assert r.status == 404 and r.json() == {"error": "not_found"}
        page.goto(f"{app_url}/")
        visible(page, card(page, f"Swing {pub}", "Porch swing"), "the feed shows the public pin")
        expect(card(page, f"Budget {word}", "Budget sheet")).to_have_count(0)
        page.goto(f"{app_url}/u/{o.handle}")
        main = page.get_by_role("main")
        visible(page, main.get_by_text(f"Porch {k.t}", exact=True).first, "the profile lists the public board")
        expect(main.get_by_text(f"Renovate {k.t}", exact=True)).to_have_count(0)
        select(page.get_by_role("combobox", name="Sort boards"), "A to Z")
        visible(page, main.get_by_text(f"Porch {k.t}", exact=True).first, "sorting keeps the public board")
        box = page.get_by_role("searchbox", name="Search pins")
        box.fill(word)
        box.press("Enter")
        shows_text(page, f'No pins match "{word}".', "searching the secret word finds nothing")
        box = page.get_by_role("searchbox", name="Search pins")
        box.fill(pub)
        box.press("Enter")
        visible(page, card(page, f"Swing {pub}", "Porch swing"), "searching a public word finds the pin")
        tag = page.get_by_role("combobox", name="Tag")
        tag.click()
        expect(page.get_by_role("option", name=re.compile(re.escape(f"#{word}tag")))).to_have_count(0)
        page.keyboard.press("Escape")
        select(tag, f"#{pub}tag (1)")
        select(page.get_by_role("combobox", name="Board"), f"Porch {k.t} (1)")
        visible(page, card(page, f"Swing {pub}", "Porch swing"), "the filtered results hold the public pin")
    assert ids_of(F.ok("GET", f"/api/search?q={pub}&tag={pub}tag&board={w['pb']}")["pins"]) == {w["p1"]}
    assert F.ok("GET", f"/api/search?q={word}")["pins"] == []


def test_wf_secret_board_search_member(browser: Browser, app_url: str) -> None:
    k, o, f, m, w, word, pub = secret_world(app_url)
    with browse(browser, app_url, m, "/search") as page:
        box = page.get_by_role("searchbox", name="Search pins")
        box.fill(word)
        box.press("Enter")
        visible(page, card(page, f"Budget {word}", "Budget sheet"), "the member finds the secret pin")
        select(page.get_by_role("combobox", name="Tag"), f"#{word}tag (1)")
        wait_cards(page, grid(page), 1)
    Api(app_url, o).ok("PATCH", f"/api/boards/{w['pb']}", {"visibility": "secret"})
    F = Api(app_url, f)
    with browse(browser, app_url, f, "/", api=F) as page:
        shows_text(page, "Follow people or boards to fill your feed.", "the follower's feed is empty")
        page.goto(f"{app_url}/u/{o.handle}")
        visible(page, page.get_by_role("tab", name="Boards"), "the profile renders")
        expect(page.get_by_role("main").get_by_text(f"Porch {k.t}", exact=True)).to_have_count(0)
    assert w["p1"] not in ids_of(F.ok("GET", "/api/feed")["pins"]) and F.ok("GET", f"/api/search?q={pub}")["pins"] == []


TIMES_JS = """() => Array.from(document.getElementsByTagName('time'))
  .map(t => [t.getAttribute('datetime') || '', t.textContent.trim()])"""


def times_follow_clock(page: Page, base: str, instants: list[datetime], zone: ZoneInfo) -> bool:
    shown: dict[int, str] = {}
    for stamp, words in page.evaluate(TIMES_JS):
        try:
            shown[int(parse_instant(stamp).timestamp())] = words
        except ValueError:
            continue
    now = business_now(base)
    for moment in instants:
        expected, got = relative(now, moment, zone), shown.get(int(moment.timestamp()))
        assert got == expected, f"the time element for {iso(moment)} reads {expected!r}; got {got!r}"
    return True


def comment_times(api: Api, pin_id: int) -> list[datetime]:
    out = []
    for c in api.ok("GET", f"/api/pins/{pin_id}/comments")["comments"]:
        out.append(parse_instant(c["created_at"]))
        out.extend(parse_instant(r["created_at"]) for r in c["replies"])
    return out


def edit_dialog(page: Page) -> Locator:
    page.get_by_role("button", name="Edit pin").click()
    dlg = page.get_by_role("dialog", name="Edit pin")
    visible(page, dlg, 'dialog "Edit pin" opens')
    return dlg


def resolve_conflict(page: Page, dlg: Locator, latest_title: str) -> None:
    alerted(page, "This pin was changed somewhere else.")
    page.get_by_role("alert").filter(has_text="This pin was changed somewhere else.").get_by_role("button", name="Load latest").click()
    soon(page, lambda: expect(dlg.get_by_role("textbox", name="Title")).to_have_value(latest_title, timeout=SHORT_MS),
         "Load latest fills the current pin")


def react_love(page: Page) -> None:
    btn = page.get_by_role("button", name="React")
    btn.focus()
    page.keyboard.press("Enter")
    menu = page.get_by_role("menu", name="Reactions")
    visible(page, menu, 'menu "Reactions" opens')
    soon(page, lambda: expect(menu.get_by_role("menuitemradio", name="Love")).to_be_focused(timeout=SHORT_MS), "Love has focus")
    page.keyboard.press("Enter")
    hidden(page, menu, "choosing closes the menu")


def test_pin_edit_versions(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, x = person("editor"), person("other")
    w = seed_world(app_url, k, users=[o, x], boards=[board(k("b"), o, f"Edits {k.t}")], pins=[pin(k("p"), o, k("b"), f"Draft {k.t}", alt="Edit print")])
    api = Api(app_url, o)
    path = f"/api/pins/{w['p']}"
    assert api.ok("GET", path)["version"] == 1
    p2 = api.ok("PATCH", path, {"version": 1, "title": f"Second {k.t}"})
    assert p2["version"] == 2 and p2["title"] == f"Second {k.t}"
    body = assert_error(api.call("PATCH", path, {"version": 1, "title": f"Stale {k.t}"}), 409, "version_conflict")
    assert body["current"]["version"] == 2 and body["current"]["title"] == f"Second {k.t}"
    assert_error(Api(app_url, x).call("PATCH", path, {"version": 2, "title": "Nope"}), 403, "forbidden")
    assert_error(api.call("PATCH", path, {"version": 2, "source": "ftp://x.example/a"}), 422, "validation", "source")
    now = api.ok("GET", path)
    assert now["version"] == 2 and now["title"] == f"Second {k.t}" and now["source"] is None
    with ExitStack() as stack:
        pa = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=api))
        pb = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=api))
        da, db = edit_dialog(pa), edit_dialog(pb)
        da.get_by_role("textbox", name="Title").fill(f"Window A {k.t}")
        with held(pa, "**/api/pins/*") as hold:
            da.get_by_role("button", name="Save changes").click()
            pending = pa.get_by_role("button", name="Saving")
            visible(pa, pending, 'Save changes reads "Saving" while pending')
            expect(pending).to_be_disabled()
            hold.release()
        says(pa, "Pin updated")
        db.get_by_role("textbox", name="Title").fill(f"Window B {k.t}")
        db.get_by_role("button", name="Save changes").click()
        resolve_conflict(pb, db, f"Window A {k.t}")
        db.get_by_role("textbox", name="Description").fill("Fresh words")
        db.get_by_role("button", name="Save changes").click()
        says(pb, "Pin updated")
    final = api.ok("GET", path)
    assert (final["version"], final["title"], final["description"]) == (4, f"Window A {k.t}", "Fresh words")


def test_comments_and_replies(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, a, b, x = person("owner"), person("alba"), person("bram"), person("stranger")
    w = seed_world(app_url, k, users=[o, a, b, x], boards=[board(k("b"), o, f"Talk {k.t}")], pins=[pin(k("p"), o, k("b"), f"Talk {k.t}", alt="Talk print")])
    A, B, X, O = (Api(app_url, u) for u in (a, b, x, o))
    path = f"/api/pins/{w['p']}/comments"
    c1 = A.ok("POST", path, {"text": "First note", "parent": None}, status=201)
    r1 = B.ok("POST", path, {"text": "A reply", "parent": c1["id"]}, status=201)
    r2 = B.ok("POST", path, {"text": "Deeper", "parent": r1["id"]}, status=201)
    listing = A.ok("GET", path)
    top = next(c for c in listing["comments"] if c["id"] == c1["id"])
    assert [r["id"] for r in top["replies"]] == [r1["id"], r2["id"]] and listing["count"] == 3, "a reply to a reply joins the top level"
    assert_error(A.call("POST", path, {"text": "", "parent": None}), 422, "validation", "text")
    assert_error(X.call("DELETE", f"/api/comments/{c1['id']}"), 403, "forbidden")
    O.ok("DELETE", f"/api/comments/{r2['id']}", status=204)
    A.ok("DELETE", f"/api/comments/{c1['id']}", status=204)
    listing = A.ok("GET", path)
    top = next(c for c in listing["comments"] if c["id"] == c1["id"])
    assert top["deleted"] is True and top["text"] is None and [r["id"] for r in top["replies"]] == [r1["id"]] and listing["count"] == 1
    c2 = A.ok("POST", path, {"text": "Short lived", "parent": None}, status=201)
    A.ok("DELETE", f"/api/comments/{c2['id']}", status=204)
    assert all(c["id"] != c2["id"] for c in A.ok("GET", path)["comments"]), "a deleted comment without replies disappears"
    c3 = A.ok("POST", path, {"text": "Second note", "parent": None}, status=201)
    assert [c["id"] for c in A.ok("GET", path)["comments"]] == [c1["id"], c3["id"]], "oldest first"
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=O))
        pb = stack.enter_context(browse(browser, app_url, b, f"/pin/{w['p']}", api=B))
        shows_text(po, "2 comments", "the count excludes the deleted comment")
        shows_text(po, "This comment was deleted.", "the placeholder shows")
        pb.get_by_role("button", name=f"Reply to {a.name}").last.click()
        reply = pb.get_by_role("textbox", name=f"Reply to {a.name}")
        visible(pb, reply, "the reply box opens")
        reply.fill(f"Reply {k.t}")
        pb.get_by_role("button", name="Post reply").click()
        live(po, lambda: expect(po.get_by_text("3 comments", exact=True).first).to_be_visible(timeout=SHORT_MS), "the count rises live")
        pb.get_by_role("textbox", name="Add a comment").fill("Top level")
        with held(pb, "**/comments") as hold:
            pb.get_by_role("button", name="Post").click()
            visible(pb, pb.get_by_role("button", name="Posting"), 'Post reads "Posting" while pending')
            hold.release()
        shows_text(pb, "Top level", "the comment appears")
        live(po, lambda: expect(po.get_by_text("4 comments", exact=True).first).to_be_visible(timeout=SHORT_MS), "the count rises live")
    final = A.ok("GET", path)
    assert final["count"] == 4
    assert f"Reply {k.t}" in [r["text"] for r in next(c for c in final["comments"] if c["id"] == c3["id"])["replies"]]


def test_reactions(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, a, b, c = person("owner"), person("alba"), person("bram"), person("cora")
    w = seed_world(app_url, k, users=[o, a, b, c], boards=[board(k("b"), o, f"React {k.t}")], pins=[pin(k("p"), o, k("b"), f"React {k.t}")])
    A, B, C = Api(app_url, a), Api(app_url, b), Api(app_url, c)
    rx = f"/api/pins/{w['p']}/reaction"
    assert A.ok("PUT", rx, {"type": "love"}) == {"mine": "love", "reactions": 1}
    assert A.ok("PUT", rx, {"type": "love"}) == {"mine": None, "reactions": 0}
    A.ok("PUT", rx, {"type": "idea"})
    assert A.ok("PUT", rx, {"type": "wow"}) == {"mine": "wow", "reactions": 1}
    assert B.ok("PUT", rx, {"type": "thanks"}) == {"mine": "thanks", "reactions": 2}
    assert_error(A.call("PUT", rx, {"type": "meh"}), 422, "validation", "type")
    mine = A.ok("GET", f"/api/pins/{w['p']}")
    assert mine["my_reaction"] == "wow" and mine["reactions"] == 2
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}"))
        pc = stack.enter_context(browse(browser, app_url, c, f"/pin/{w['p']}", api=C))
        shows_text(po, "2 reactions", "the count shows")
        react = pc.get_by_role("button", name="React")
        react.focus()
        pc.keyboard.press("Enter")
        menu = pc.get_by_role("menu", name="Reactions")
        visible(pc, menu, 'menu "Reactions" opens')

        def focused(name: str) -> None:
            soon(pc, lambda: expect(menu.get_by_role("menuitemradio", name=name)).to_be_focused(timeout=SHORT_MS), f"{name} has focus")
        focused("Love")
        for key, name in (("ArrowUp", "Thanks"), ("ArrowDown", "Love"), ("ArrowDown", "Idea")):
            pc.keyboard.press(key)
            focused(name)
        pc.keyboard.press("Enter")
        hidden(pc, menu, "Enter chooses and closes")
        live(po, lambda: expect(po.get_by_text("3 reactions", exact=True).first).to_be_visible(timeout=SHORT_MS), "the count rises live")
        react.focus()
        pc.keyboard.press("Enter")
        focused("Idea")
        expect(menu.get_by_role("menuitemradio", name="Idea")).to_have_attribute("aria-checked", "true")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                pc.keyboard.press(key)
                assert focus_inside(menu), f"{key} stays in the menu"
        pc.keyboard.press("Escape")
        hidden(pc, menu, "Escape closes the menu")
        expect(react).to_be_focused()
    got = C.ok("GET", f"/api/pins/{w['p']}")
    assert got["my_reaction"] == "idea" and got["reactions"] == 3


def test_relative_times(browser: Browser, app_url: str) -> None:
    zone = ZoneInfo(config(app_url)["time_zone"])
    k = Keys()
    o = person("timer")
    now = business_now(app_url)
    ages = [timedelta(seconds=5), timedelta(minutes=30), timedelta(hours=5, minutes=30), timedelta(days=3, hours=12),
            timedelta(days=13), timedelta(days=40), timedelta(days=400)]
    w = seed_world(app_url, k, users=[o], boards=[board(k("b"), o, f"Times {k.t}")], pins=[pin(k("p"), o, k("b"), f"Times {k.t}")],
                   comments=[comment(k(f"c{i}"), k("p"), o, f"Note {i}", at=iso(now - age)) for i, age in enumerate(ages)])
    api = Api(app_url, o)
    instants = comment_times(api, w["p"])
    assert len(instants) == len(ages)
    with browse(browser, app_url, o, f"/pin/{w['p']}", api=api, device_time=now - DEVICE_SKEW * 3) as page:
        soon(page, lambda: times_follow_clock(page, app_url, instants, zone), "shown times follow the business clock")
        move_clock(app_url, 2 * DAY_S)
        live(page, lambda: times_follow_clock(page, app_url, instants, zone), "shown times re-render after a clock move")


@pytest.mark.timeout(900)
def test_wf_pin_detail_conflict_time_happy(browser: Browser, app_url: str) -> None:
    zone = ZoneInfo(config(app_url)["time_zone"])
    k = Keys()
    o = person("owner")
    w = seed_world(app_url, k, users=[o], boards=[board(k("b"), o, f"Detail {k.t}")], pins=[pin(k("p"), o, k("b"), f"Detail {k.t}")])
    api = Api(app_url, o)
    with ExitStack() as stack:
        pa = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=api))
        pb = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=api))
        da, db = edit_dialog(pa), edit_dialog(pb)
        da.get_by_role("textbox", name="Title").fill(f"From A {k.t}")
        da.get_by_role("button", name="Save changes").click()
        says(pa, "Pin updated")
        db.get_by_role("textbox", name="Title").fill(f"From B {k.t}")
        db.get_by_role("button", name="Save changes").click()
        resolve_conflict(pb, db, f"From A {k.t}")
        db.get_by_role("button", name="Save changes").click()
        says(pb, "Pin updated")
        for page, dlg in ((pa, da), (pb, db)):
            if dlg.is_visible():
                page.keyboard.press("Escape")
            hidden(page, dlg, "the edit dialog closes")
        pb.get_by_role("textbox", name="Add a comment").fill("From window B")
        pb.get_by_role("button", name="Post").click()
        live(pa, lambda: expect(pa.get_by_text("1 comment", exact=True).first).to_be_visible(timeout=SHORT_MS), "A sees the comment count")
        pa.reload()
        pa.get_by_role("button", name=f"Reply to {o.name}").first.click()
        pa.get_by_role("textbox", name=f"Reply to {o.name}").fill("From window A")
        pa.get_by_role("button", name="Post reply").click()
        live(pb, lambda: expect(pb.get_by_text("2 comments", exact=True).first).to_be_visible(timeout=SHORT_MS), "B sees the reply count")
        react_love(pa)
        live(pb, lambda: expect(pb.get_by_text("1 reaction", exact=True).first).to_be_visible(timeout=SHORT_MS), "B sees the reaction")
        instants = comment_times(api, w["p"])
        move_clock(app_url, DAY_S + HOUR_S)
        for page in (pa, pb):
            live(page, lambda page=page: times_follow_clock(page, app_url, instants, zone), "times re-render after the clock move")
    final = api.ok("GET", f"/api/pins/{w['p']}")
    assert (final["version"], final["title"], final["comments"], final["reactions"], final["my_reaction"]) == (3, f"From A {k.t}", 2, 1, "love")
    assert len(api.ok("GET", f"/api/pins/{w['p']}/comments")["comments"][0]["replies"]) == 1


def test_wf_pin_detail_conflict_time_moderation(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, a = person("owner"), person("alba")
    w = seed_world(app_url, k, users=[o, a], boards=[board(k("b"), o, f"Mod {k.t}")], pins=[pin(k("p"), o, k("b"), f"Mod {k.t}")],
                   comments=[comment(k("c"), k("p"), a, f"Note {k.t}"), comment(k("r"), k("p"), o, "Quiet reply", parent=k("c"))])
    api = Api(app_url, o)
    with ExitStack() as stack:
        pa = stack.enter_context(browse(browser, app_url, a, f"/pin/{w['p']}"))
        po = stack.enter_context(browse(browser, app_url, o, f"/pin/{w['p']}", api=api))
        shows_text(pa, "2 comments", "the count shows")
        visible(po, po.get_by_text(f"Note {k.t}", exact=True).first, "the comment shows")
        po.get_by_role("button", name="Delete comment").first.click()
        shows_text(po, "This comment was deleted.", "the placeholder replaces the text")
        live(pa, lambda: expect(pa.get_by_text("1 comment", exact=True).first).to_be_visible(timeout=SHORT_MS), "the count drops live")
    listing = api.ok("GET", f"/api/pins/{w['p']}/comments")
    assert listing["count"] == 1 and listing["comments"][0]["deleted"] is True and listing["comments"][0]["replies"][0]["id"] == w["r"]


EFFECTIVE_OPACITY_JS = """e => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement)
  o *= Number(getComputedStyle(n).opacity); return o; }"""
EDGES = ("left", "top", "right", "bottom")


def touch_session(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def long_press(page: Page, cdp: Any, loc: Locator, ms: float, drift: float = 0) -> None:
    x, y = center(loc)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    if drift:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + drift, "y": y}]})
    advance(page, ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, STEP_MS)


def assert_sheet(dlg: Locator, size: tuple[int, int]) -> None:
    settle(dlg)
    box = rect(dlg.bounding_box())
    assert abs(box["left"]) <= PX_TOL and abs(box["right"] - size[0]) <= PX_TOL, f"the sheet is full width; got {box}"
    assert abs(box["bottom"] - size[1]) <= PX_TOL, f"the sheet rises from the bottom edge; got {box}"


def carry(page: Page, chosen: Locator, title: str, alt: str, opener: Callable[[], None]) -> tuple[Locator, dict, dict]:
    start = rect(chosen.locator("img").first.bounding_box())
    opener()
    dlg = page.get_by_role("dialog", name=title)
    img = dlg.get_by_role("img", name=alt).first
    path = motion(img, OPEN_MS)
    settle(dlg)
    end = rect(img.bounding_box())
    assert len(path) >= 3, "the open motion is sampled"
    mid = path_rect(path[len(path) // 2])
    for edge in EDGES:
        lo, hi = sorted((start[edge], end[edge]))
        assert lo - PX_TOL <= mid[edge] <= hi + PX_TOL, f"halfway the {edge} edge lies between grid and exhibit"
    assert not same_rect(mid, start) and not same_rect(mid, end), "the image travels"
    assert same_rect(path_rect(path[-1]), end), "after 520 ms the image rests in the exhibit rectangle"
    return dlg, start, end


def test_phone_layout(browser: Browser, app_url: str) -> None:
    k, o, w, titles, alts = simple_world(app_url, "phone", dims=[(600, 900)] * 8)
    with browse(browser, app_url, o, f"/b/{w['b']}", size=PHONE) as page:
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            for path in ("/", f"/b/{w['b']}", f"/pin/{w['p0']}", "/search", "/create", f"/u/{o.handle}"):
                page.goto(f"{app_url}{path}")
                visible(page, page.get_by_role("main"), f"{path} renders at {size[0]}")
                layout(page)
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.goto(f"{app_url}/b/{w['b']}")
        soon(page, lambda: expect(grid(page)).to_have_attribute("data-columns", "2", timeout=SHORT_MS), "two columns below 600")
        tabs = page.get_by_role("navigation", name="Tabs")
        for y in (0, PHONE[1]):
            page.evaluate("y => scrollTo(0, y)", y)
            advance(page, STEP_MS)
            assert abs(rect(tabs.bounding_box())["bottom"] - PHONE[1]) <= PX_TOL, "the tab bar is fixed to the bottom"
        assert_targets(page, "board at 375")
        page.goto(f"{app_url}/create")
        visible(page, page.get_by_role("button", name="Publish"), "the composer renders")
        assert_targets(page, "composer at 375")
        for size in (PHONE, TABLET):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(f"{app_url}/b/{w['b']}")
            page.get_by_role("button", name="Add section").click()
            dlg = page.get_by_role("dialog", name="Add section")
            visible(page, dlg, 'dialog "Add section" opens')
            if size == PHONE:
                assert_sheet(dlg, PHONE)
            else:
                settle(dlg)
                box = rect(dlg.bounding_box())
                assert box["right"] - box["left"] < size[0] - PX_TOL, "a dialog is a panel at 600 px and wider"
                assert abs(box["left"] - (size[0] - box["right"])) <= 2 * PX_TOL, "the panel is centred"
            page.keyboard.press("Escape")


def test_long_press_to_save(browser: Browser, app_url: str) -> None:
    k = Keys()
    v, a = person("phone"), person("artist")
    w = seed_world(app_url, k, users=[v, a], boards=[board(k("ab"), a, f"Moths {k.t}"), board(k("vb"), v, f"Phone {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Hold {k.t}", alt="Held moth")])
    V = Api(app_url, v)
    with browse(browser, app_url, v, f"/b/{w['ab']}", api=V, size=PHONE) as page:
        c = card(page, f"Hold {k.t}", "Held moth")
        visible(page, c, "the card shows")
        cdp = touch_session(page)
        sheet = page.get_by_role("dialog", name="Save to board")
        for ms, drift in ((HOLD_MS // 2, 0), (HOLD_MS + STEP_MS, DRAG_START_PX)):
            long_press(page, cdp, c, ms, drift)
            expect(sheet).to_have_count(0)
            page.goto(f"{app_url}/b/{w['ab']}")
            visible(page, c, "the card shows again")
        long_press(page, cdp, c, HOLD_MS + STEP_MS)
        visible(page, sheet, "a 500 ms hold opens the save sheet")
        assert urllib.parse.urlparse(page.url).path == f"/b/{w['ab']}", "the long press does not open the pin"
        assert_sheet(sheet, PHONE)
        save_by_keys(page, "Phone")
        toasts(page, f"Saved to Phone {k.t}")
    assert len(saves_of(V, w["vb"], w["p"])) == 1


def test_lamp_carry(browser: Browser, app_url: str) -> None:
    k, o, w, titles, alts = simple_world(app_url, "carry", 6)
    with browse(browser, app_url, o, f"/b/{w['b']}") as page:
        g = grid(page)
        wait_cards(page, g, 6)
        chosen, other = card(page, titles[4], alts[4]), card(page, titles[0], alts[0])
        loaded(page, chosen)
        loaded(page, other)
        page.mouse.move(1, 1)
        settle(other)
        rest = decode(capture(other))
        chosen.focus()
        scroll = page.evaluate("() => scrollY")
        dlg, start, _ = carry(page, chosen, titles[4], alts[4], lambda: page.keyboard.press("Enter"))
        assert page.url.endswith(f"/pin/{w['p4']}")
        settle(other)
        dimmed = decode(capture(other))
        changed(rest, dimmed)
        page.keyboard.press("Escape")
        hidden(page, dlg, "Escape closes the exhibit")
        settle(chosen)
        settle(other)
        assert same_rect(rect(chosen.locator("img").first.bounding_box()), start), "the image returns to its slot"
        changed(dimmed, decode(capture(other)))
        soon(page, lambda: assert_true(focused_pin(page) == w["p4"]), "focus returns to the card")
        assert abs(page.evaluate("() => scrollY") - scroll) <= PX_TOL


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    dims = [(600, 600 + 60 * (i % 4)) for i in range(10)]
    k, o, w, titles, alts = simple_world(app_url, "still", dims=dims)
    api = Api(app_url, o)
    api.ok("POST", "/api/boards", {"name": f"Spare {k.t}", "visibility": "public"}, status=201)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        soon(page, lambda: assert_true(page.evaluate("() => document.documentElement.dataset.motion") == "full"), 'data-motion is "full"')
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api, reduced=True) as page:
        soon(page, lambda: assert_true(page.evaluate("() => document.documentElement.dataset.motion") == "reduced"), 'data-motion is "reduced"')
        g = grid(page)
        wait_cards(page, g, len(dims))
        tab_into(page, g)
        page.keyboard.press("End")
        target = w[f"p{len(dims) - 1}"]
        soon(page, lambda: assert_true(focused_pin(page) == target), "End focuses the last card")
        scroll = page.evaluate("() => scrollY")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=titles[-1])
        img = dlg.get_by_role("img", name=alts[-1]).first
        path = motion(img, CROSSFADE_MIN_MS)
        end = rect(img.bounding_box())
        assert path and all(same_rect(path_rect(s), end) for s in path), "no travel under reduced motion"
        assert page.url.endswith(f"/pin/{target}")
        page.keyboard.press("Escape")
        hidden(page, dlg, "Escape closes the exhibit")
        soon(page, lambda: assert_true(focused_pin(page) == target), "focus returns to the same card")
        assert abs(page.evaluate("() => scrollY") - scroll) <= PX_TOL
        last = card(page, titles[-1], alts[-1])
        resize_now(page, TABLET[0], TABLET[1])
        top = int(last.get_attribute("data-top"))
        assert abs(rect(last.bounding_box())["top"] - rect(g.bounding_box())["top"] - top) <= PX_TOL, "reflowed cards jump to their places"
        last.focus()
        page.keyboard.press("s")
        save_by_keys(page, "Spare")
        toast = notices(page).get_by_text(f"Saved to Spare {k.t}").first
        soon(page, lambda: expect(toast).to_be_attached(timeout=SHORT_MS), "the toast appears")
        assert toast.evaluate(EFFECTIVE_OPACITY_JS) == 1, "toasts appear at once"


def test_wf_phone_motion_long_press(browser: Browser, app_url: str) -> None:
    k = Keys()
    v, a = person("phone"), person("artist")
    w = seed_world(app_url, k, users=[v, a], boards=[board(k("ab"), a, f"Ferns {k.t}"), board(k("vb"), v, f"Pocket {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Frond {k.t}", alt="Fern frond")])
    V = Api(app_url, v)
    with browse(browser, app_url, v, f"/b/{w['ab']}", api=V, size=PHONE) as page:
        c = card(page, f"Frond {k.t}", "Fern frond")
        visible(page, c, "the card shows")
        cdp = touch_session(page)
        long_press(page, cdp, c, HOLD_MS + STEP_MS)
        sheet = save_dialog(page)
        assert_sheet(sheet, PHONE)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                page.keyboard.press(key)
                assert focus_inside(sheet), f"{key} stays inside the save sheet"
        page.keyboard.press("Escape")
        hidden(page, sheet, "Escape closes the sheet")
        soon(page, lambda: assert_true(focused_pin(page) == w["p"]), "focus returns to the card")
        long_press(page, cdp, c, HOLD_MS + STEP_MS)
        save_by_keys(page, "Pocket")
        toasts(page, f"Saved to Pocket {k.t}")
    saved = saves_of(V, w["vb"], w["p"])
    assert len(saved) == 1 and saved[0]["saved_from"]["user_name"] == a.name


def test_wf_phone_motion_reduced(browser: Browser, app_url: str) -> None:
    k, o, w, titles, alts = simple_world(app_url, "calm", 4)
    v = person("calm")
    seed(app_url, users=[v])
    V = Api(app_url, v)
    with browse(browser, app_url, v, f"/b/{w['b']}", api=V, size=PHONE, reduced=True) as page:
        g = grid(page)
        wait_cards(page, g, 4)
        chosen = card(page, titles[2], alts[2])
        chosen.scroll_into_view_if_needed()
        scroll = page.evaluate("() => scrollY")
        tap(chosen)
        dlg = page.get_by_role("dialog", name=titles[2])
        img = dlg.get_by_role("img", name=alts[2]).first
        path = motion(img, CROSSFADE_MIN_MS)
        end = rect(img.bounding_box())
        assert path and all(same_rect(path_rect(s), end) for s in path), "no morph under reduced motion"
        assert page.url.endswith(f"/pin/{w['p2']}")
        react_love(page)
        page.go_back()
        hidden(page, dlg, "Back closes the exhibit")
        soon(page, lambda: assert_true(focused_pin(page) == w["p2"]), "focus returns to the card")
        assert abs(page.evaluate("() => scrollY") - scroll) <= PX_TOL
    assert V.ok("GET", f"/api/pins/{w['p2']}")["my_reaction"] == "love"


def test_wf_phone_motion_full(browser: Browser, app_url: str) -> None:
    k, o, w, titles, alts = simple_world(app_url, "lamp", 5)
    api = Api(app_url, o)
    with browse(browser, app_url, o, f"/b/{w['b']}", api=api) as page:
        g = grid(page)
        wait_cards(page, g, 5)
        chosen = card(page, titles[3], alts[3])
        loaded(page, chosen)
        page.mouse.move(1, 1)
        dlg, start, _ = carry(page, chosen, titles[3], alts[3], lambda: chosen.click())
        dlg.get_by_role("textbox", name="Add a comment").fill("Midway note")
        dlg.get_by_role("button", name="Post").click()
        shows_text(page, "Midway note", "the comment appears")
        dlg.get_by_role("button", name="Close").click()
        hidden(page, dlg, "Close shuts the exhibit")
        settle(chosen)
        assert same_rect(rect(chosen.locator("img").first.bounding_box()), start), "the image returns to its slot"
        soon(page, lambda: assert_true(focused_pin(page) == w["p3"]), "focus returns to the card")
    assert api.ok("GET", f"/api/pins/{w['p3']}")["comments"] == 1


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), f"run.json has a {key} command"


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages, "the production tree is installed"
    missing = [p.name for p in packages if p.name not in notices or (getattr(p, "version", "") and p.version not in notices)]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert "TikTok Sans" in notices


def test_if_licences() -> None:
    lgpl = LICENCE_ALLOWLIST | {"LGPL-3.0-or-later"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)
           and not (p.name.startswith("@img/sharp-") and licence_allowed(p.licence, lgpl))]
    assert not bad, f"disallowed licences: {bad}"


def test_if_datastores() -> None:
    found = sorted({p.name for p in shipped_packages()} & DATASTORE_PACKAGES)
    assert not found, f"extra datastore packages shipped: {found}"


def test_if_sharp_pinned() -> None:
    deps = json.loads((APP_ROOT / "package.json").read_text()).get("dependencies", {})
    assert re.fullmatch(r"\d+\.\d+\.\d+", deps.get("sharp", "")), f"sharp is pinned exactly; got {deps.get('sharp')!r}"
    assert "sharp" in {p.name for p in shipped_packages()}


def test_if_typescript_and_same_origin(browser: Browser, app_url: str) -> None:
    ts_files = []
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        ts_files += [f for f in files if f.endswith((".ts", ".tsx"))]
    assert ts_files, "application source is TypeScript"
    k, o, w, titles, alts = simple_world(app_url, "origin", 2)
    foreign: list[str] = []

    def allowed(url: str) -> bool:
        return url.startswith(("data:", "blob:", "about:")) or same_origin(url, app_url) or "X-Amz-Signature" in url

    def watch(page: Page) -> None:
        page.on("request", lambda req: foreign.append(req.url) if not allowed(req.url) else None)
    with browse(browser, app_url, None, "/", before=watch) as page:
        visible(page, page.get_by_role("link", name="Sign up"), "the landing page renders")
    with browse(browser, app_url, o, f"/b/{w['b']}", before=watch) as page:
        loaded(page, card(page, titles[0], alts[0]))
    assert not foreign, f"cross-origin loads: {foreign[:10]}"


def test_if_no_committed_credentials() -> None:
    secrets = [s for s in secret_values() if s != GRADING_KEY]
    hits = []
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        for name in files:
            path = Path(root) / name
            if path.stat().st_size > 2_000_000:
                continue
            body = path.read_text(errors="ignore")
            hits += [str(path) for s in secrets if s in body]
    assert not hits, f"credential values committed in: {hits[:10]}"


def test_wf_image_refusals_duplicate_edges(browser: Browser, app_url: str) -> None:
    k = Keys()
    u = person("edges")
    seed_world(app_url, k, users=[u], boards=[board(k("d"), u, f"Desk {k.t}"), board(k("l"), u, f"Later {k.t}")])
    api = Api(app_url, u)
    lim = config(app_url)["limits"]
    side = math.isqrt(lim["image_max_pixels"])
    wide = next(x for x in range(side, 2 * side + 1) if lim["image_max_pixels"] % x == 0)
    tall = lim["image_max_pixels"] // wide
    assert Fraction(1, 2) <= Fraction(wide, tall) <= 2, "a picture of exactly the pixel limit within the shape range"
    rgb = random_rgb()
    accepted = [(padded_png(lim["image_max_bytes"], rgb), "Bytes", f"Desk {k.t}"),
                (png(wide, tall, random_rgb()), "Pixels", f"Desk {k.t}"),
                (png(150, 300, random_rgb()), "Tall", f"Desk {k.t}")]
    published: list[int] = []
    with browse(browser, app_url, u, "/create", api=api) as page:
        for data, label, board_name in accepted:
            if published:
                page.goto(f"{app_url}/create")
            keyboard_compose(page, image=data, title=f"{label} {k.t}", alt=f"{label} edge print", board_name=board_name)
            press_publish(page)
            pid = int(soon(page, lambda: re.search(r"/pin/(\d+)$", page.url).group(1),
                           f"the image exactly at the {label.lower()} limit publishes"))
            says(page, "Pin published")
            published.append(pid)
        page.goto(f"{app_url}/create")
        again = png(40, 40, rgb, chunks=((b"tEXt", b"Comment\x00new metadata " + k.t.encode()),))
        keyboard_compose(page, image=again, title=f"Again {k.t}", alt="Same pixels", board_name=f"Later {k.t}")
        press_publish(page)
        alerted(page, f"You already saved this pin to Desk {k.t}")
        expect(page.get_by_role("textbox", name="Title")).to_have_value(f"Again {k.t}")
        assert page.url.endswith("/create"), "a refused upload stays in the composer"
    pins = api.ok("GET", f"/api/users/{u.handle}/pins")["pins"]
    assert sorted(p["id"] for p in pins) == sorted(published), "only the three edge images were published"
    by_id = {p["id"]: p for p in pins}
    assert (by_id[published[1]]["image"]["width"], by_id[published[1]]["image"]["height"]) == (wide, tall)
    assert (by_id[published[2]]["image"]["width"], by_id[published[2]]["image"]["height"]) == (150, 300)


def test_wf_concurrent_editors_live_reflow(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    dims = [(800, 1200), (1000, 1000), (1200, 600), (600, 1200), (900, 1200)]
    titles = [f"Reflow {i} {k.t}" for i in range(len(dims))]
    w = seed_world(app_url, k, users=[o, e], boards=[board(k("b"), o, f"Reflow {k.t}", members=((e, "editor"),))],
                   pins=[pin(k(f"p{i}"), o, k("b"), titles[i], alt=f"Reflow print {i}", w=dw, h=dh)
                         for i, (dw, dh) in enumerate(dims)])
    ids = [w[f"p{i}"] for i in range(len(dims))]
    api = Api(app_url, o)
    width = TALL_DESKTOP[0]
    moved = [0, 1, 2, 4, 3]
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api, size=TALL_DESKTOP))
        pe = stack.enter_context(browse(browser, app_url, e, f"/b/{w['b']}", size=TALL_DESKTOP))
        go, ge = grid(po), grid(pe)
        wait_cards(po, go, len(dims))
        wait_cards(pe, ge, len(dims))
        soon(po, lambda: assert_true(tuples(read_cards(go)) == place(width, dims)), "the owner's board grid follows the masonry rule")
        tab_into(pe, ge)
        pe.keyboard.press("End")
        assert focused_pin(pe) == ids[4], "End focuses the last card"
        pe.keyboard.press("Alt+ArrowUp")
        says(pe, f"Moved {titles[4]} to position 4 of 5")
        live(po, lambda: assert_true(grid_ids(go) == [ids[i] for i in moved]), "the owner's grid shows the move without a reload")
        live(po, lambda: assert_true(tuples(read_cards(go)) == place(width, [dims[i] for i in moved])),
             "the owner's grid re-places every card by the masonry rule")
        says(po, f"{e.name} moved {titles[4]}", LIVE_MAX_S + LIVE_SLACK_S)
        assert focused_pin(pe) == ids[4], "the editor keeps focus on the moved card"
    assert board_json(api, w["b"])["order"]["unsectioned"] == [ids[i] for i in moved]


def test_wf_concurrent_editors_live_sections(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    w, _, _ = curate_world(app_url, k, o, 3, shelf=1, members=((e, "editor"),))
    ids = pin_ids(w, 3)
    api = Api(app_url, o)
    with ExitStack() as stack:
        po = stack.enter_context(browse(browser, app_url, o, f"/b/{w['b']}", api=api, size=TALL_DESKTOP))
        pe = stack.enter_context(browse(browser, app_url, e, f"/b/{w['b']}", size=TALL_DESKTOP))
        wait_cards(po, grid(po), 3)
        ge = grid(pe)
        wait_cards(pe, ge, 3)
        tab_into(pe, ge)
        pe.keyboard.press("ArrowRight")
        assert focused_pin(pe) == ids[1], "Arrow Right moves to the next card by order"
        header = po.get_by_role("region", name=f"Shelf {k.t}").get_by_role("heading", level=2)
        header.focus()
        po.keyboard.press("Alt+ArrowDown")
        says(po, f"Moved section Shelf {k.t} to position 2 of 2")
        poll(lambda: [s["id"] for s in board_json(api, w["b"])["order"]["sections"]] == [w["e"], w["s"]],
             "the section moved on the server")
        shelf = pe.get_by_role("region", name=f"Shelf {k.t}")
        empty = pe.get_by_role("region", name=f"Empty {k.t}")
        live(pe, lambda: assert_true(empty.evaluate(
            "(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)", shelf.element_handle())),
            "the editor's window shows the new section order without a reload")
        says(pe, f"{o.name} moved section Shelf {k.t}", LIVE_MAX_S + LIVE_SLACK_S)
        assert focused_pin(pe) == ids[1], "the editor keeps focus on their card"


def test_demo_content(app_url: str) -> None:
    wren = User(key="demo-wren", email="wren@demo.mothlight.example", password="mothlight-demo-2027",
                name="Wren Hollis", handle="wren_hollis")
    odile = User(key="demo-odile", email="odile@demo.mothlight.example", password="mothlight-demo-2027",
                 name="Odile Marsh", handle="odile_marsh")
    api = Api(app_url, wren)
    fern = [f"Fern study {n}" for n in range(1, 5)]
    night = [f"Night study {n}" for n in range(1, 9)]
    sizes = {**dict(zip(night, [(600, 900), (800, 800), (1200, 600), (600, 1200), (900, 600), (700, 1000), (1000, 1000),
                                (640, 960)])),
             **dict(zip(fern, [(800, 1200), (1000, 800), (1200, 700), (900, 900)]))}
    feed = api.ok("GET", "/api/feed")["pins"]
    assert [p["title"] for p in feed] == fern + night, "Wren's feed shows the four fern studies first, then the night studies"
    for p in feed:
        assert (p["image"]["width"], p["image"]["height"]) == sizes[p["title"]], f"{p['title']} has its published size"
        assert p["alt"] == f"{p['title']}, a generated print"
        assert p["tags"] == [] and p["source"] is None and p["saved_from"] is None
        assert p["owner"]["handle"] == ("odile_marsh" if p["title"].startswith("Fern") else "wren_hollis")
        assert p["board"]["visibility"] == "public"
    at = {p["title"]: parse_instant(p["created_at"]) for p in feed}
    assert at["Fern study 1"] - at["Night study 1"] == timedelta(hours=4)
    assert all(at[f"Fern study {n}"] - at[f"Fern study {n + 1}"] == timedelta(hours=1) for n in range(1, 4))
    assert all(at[f"Night study {n}"] - at[f"Night study {n + 1}"] == timedelta(hours=1) for n in range(1, 8))
    profile = api.ok("GET", "/api/users/wren_hollis")
    assert profile["following"] == 1, "Wren follows Odile"
    assert [(b["name"], b["pin_count"]) for b in profile["boards"]] == [("Night studies", 8)]
    b = api.ok("GET", f"/api/boards/{profile['boards'][0]['id']}")
    titles = {p["id"]: p["title"] for p in b["pins"]}
    assert [titles[i] for i in b["order"]["unsectioned"]] == night, "the night studies sit at positions 1 to 8 in title order"
    other = api.ok("GET", "/api/users/odile_marsh")
    assert [(x["name"], x["pin_count"]) for x in other["boards"]] == [("Fern room", 4)]
    assert Api(app_url, odile).ok("GET", "/api/me")["user"]["name"] == "Odile Marsh"


def test_wf_save_credit_live_board_changes(browser: Browser, app_url: str) -> None:
    k = Keys()
    a, s = person("pinner"), person("saver")
    w = seed_world(app_url, k, users=[a, s],
                   boards=[board(k("ab"), a, f"Open {k.t}"), board(k("s1"), s, f"First {k.t}"), board(k("s2"), s, f"Second {k.t}")],
                   pins=[pin(k("p"), a, k("ab"), f"Count {k.t}", alt="Counted print")])
    api_s = Api(app_url, s)
    for key in ("s1", "s2"):
        api_s.ok("POST", f"/api/pins/{w['p']}/saves", {"board": w[key], "section": None}, status=201)
    with browse(browser, app_url, a, f"/pin/{w['p']}") as page:
        wait_saves(page, 2)
        api_s.ok("PATCH", f"/api/boards/{w['s1']}", {"visibility": "secret"})
        wait_saves(page, 1)
        api_s.ok("DELETE", f"/api/boards/{w['s2']}", status=204)
        wait_saves(page, 0)
    assert Api(app_url, a).ok("GET", f"/api/pins/{w['p']}")["saves"] == 0


def test_wf_secret_board_search_removed(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, m = person("owner"), person("member")
    hidden_title, kept_title = f"Tiles {k.t}", f"Kept {k.t}"
    w = seed_world(app_url, k, users=[o, m],
                   boards=[board(k("b"), o, f"Renovation {k.t}", visibility="secret", members=((m, "editor"),)),
                           board(k("own"), m, f"Own {k.t}")],
                   pins=[pin(k("kept"), m, k("own"), kept_title, alt="Kept print"),
                         pin(k("gone"), m, k("b"), hidden_title, alt="Tile sample")])
    M, O = Api(app_url, m), Api(app_url, o)
    assert set(feed_dims(M)[0]) == {w["kept"], w["gone"]}, "a member's feed holds their pin on the board"
    with browse(browser, app_url, m, "/", api=M) as page:
        wait_cards(page, grid(page), 2)
        O.ok("DELETE", f"/api/boards/{w['b']}/members/{m.id}", status=204)
        page.goto(f"{app_url}/")
        g = grid(page)
        visible(page, card(page, kept_title, "Kept print"), "the member's other pin stays on the feed")
        expect(card(page, hidden_title, "Tile sample")).to_have_count(0)
        assert grid_ids(g) == [w["kept"]], "the removed member's feed shows nothing from the secret board"
    assert feed_dims(M)[0] == [w["kept"]]
    assert M.ok("GET", f"/api/search?q=tiles{k.t}")["pins"] == []
    assert [p["id"] for p in M.ok("GET", f"/api/users/{m.handle}/pins")["pins"]] == [w["kept"]]


def test_wf_masonry_reflow_keys_tab_stop(browser: Browser, app_url: str) -> None:
    k = Keys()
    o, e = person("owner"), person("editor")
    w = seed_world(app_url, k, users=[o, e], boards=[board(k("b"), o, f"Stops {k.t}", members=((e, "editor"),))],
                   pins=[pin(k(f"p{i}"), o, k("b"), f"Stop {i} {k.t}", alt=f"Stop print {i}") for i in range(3)])
    ed = Api(app_url, e)
    with browse(browser, app_url, o, f"/b/{w['b']}", size=TALL_DESKTOP) as page:
        g = grid(page)
        wait_cards(page, g, 3)
        first = upload(ed, png(300, 300, random_rgb()), title=f"First {k.t}", alt="First print", board_id=w["b"]).json()["id"]
        live(page, lambda: assert_true(grid_ids(g)[0] == first), "the added pin takes the first place without a reload")
        tab_into(page, g)
        assert focused_pin(page) == first, "with no card focused yet, Tab lands on the first card by data-order"
        page.keyboard.press("ArrowRight")
        chosen = grid_ids(g)[1]
        assert focused_pin(page) == chosen, "Arrow Right moves to the next card by data-order"
        later = upload(ed, png(320, 320, random_rgb()), title=f"Later {k.t}", alt="Later print", board_id=w["b"]).json()["id"]
        live(page, lambda: assert_true(grid_ids(g)[0] == later), "the second added pin takes the first place without a reload")
        page.keyboard.press("Shift+Tab")
        assert not focus_inside(g), "Shift+Tab leaves the grid"
        tab_into(page, g)
        assert focused_pin(page) == chosen, "once a card has been focused, it keeps the grid's Tab stop"
