from __future__ import annotations

import ast
import contextlib
import datetime as dt
import email.utils
import hashlib
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
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qsl, quote, urljoin, urlsplit

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Browser, expect

from conftest import (Mailpit, Postgres, addresses, advance, animations, axe, capture, decode, difference, held, layout,
                      mail_from_address, open_app, scroll_samples, select, shipped_packages, state_styles, tab_order,
                      until)
from conftest import text as mail_text

try:
    from conftest import DEPLOYED_APP
except ImportError:
    DEPLOYED_APP = "/app"

APP_DIR = Path("/app")
SEED_PW = "deku-demo-pw-2026"
PASSWORD = "correct-horse-battery-9"
NEW_PASSWORD = "brand-new-pass-2026"
ADULT_DOB = "2000-01-01"
CARD_OK = "4242 4242 4242 4242"
CARD_DECLINE = "4000 0000 0000 0002"

HTTP_TIMEOUT = 30
POLL_S = 0.2
LOGIN_WAIT_MS = 15000
CLOSE_WAIT_S = 3
WORKSPACE_READY_MS = 15000
VISIBLE_WAIT_S = 10
MAIL_SETTLE_S = 2
INSTANCE_BOOT_S = 120

LIVE_MS = 3000
ROLLBACK_MS = 1000
REDUCED_MOTION_MS = 1000
MAIL_WAIT_S = 60
MAIL_DOWN_RESPONSE_S = 2
TEN_MINUTES_MS = 600000
CONSENT_MIN_DAYS = 180

DESKTOP_W, DESKTOP_H = 1280, 800
TABLET_W, TABLET_H = 768, 1024
PHONE_W, PHONE_H = 375, 812
REFLOW_PX = 320
EDGE_PHONE = 767
EDGE_TABLET_LOW = 768
EDGE_TABLET_HIGH = 1279
EDGE_DESKTOP = 1280
RAIL_MAX_PX = 96
SIDEBAR_MIN_PX = 180
SIDEBAR_MAX_PX = 340
STREAM_MIN_PX = 480

HERO_MIN_W = 640
HERO_MIN_H = 360
HERO_MIN_S = 4
TRACK_MIN_S = 20
TRACK_MAX_S = 60
SEEK_STEP_S = 5
VOLUME_STEP = 5
HOVER_MIN_S = 0.1
HOVER_MAX_S = 0.3
ENTRANCE_MIN_MS = 100
ENTRANCE_MAX_MS = 400

NOTIF_LIMIT_MAX = 50
NOTIF_PAGE = 20
MESSAGE_PAGE = 50
SEED_WEEKS = ("2026-10-19", "2026-10-12", "2026-10-05")
NO_LIST_WEEK = "2026-09-28"
GAMES = ("nova-drift", "ronin-tactics", "echo-gardens", "tidal-rally", "lumen-siege")
ARTICLE_Q_MAX = 256
DEFAULT_SUPPORT_WINDOW_S = 3600
DEFAULT_LOCKOUT_S = 900
SUPPORT_LIMIT = 3
LOCKOUT_FAILURES = 5
BASIC_PRICE = 299
MAX_PRICE = 999
UPGRADE_DIFF = 700
MAX_BODY = 2000
MAX_BODY_LONG = 4000
FREE_UPLOAD = 10485760
MAX_TIMEOUT_S = 2419200
TIMEOUT_PROBE_S = 5
NAME_MAX = 32
QUOTE_CUT = 100
PER_PAGE_DEFAULT = 12
PER_PAGE_MAX = 50
PAGE_MAX = 1000
DIRECTORY_Q_MAX = 100
SEARCH_Q_MAX = 200
FILENAME_MAX = 255
SLOWMODE_S = 30
SESSION_CAP = 20
RELEASE_S = 5
RESPONSE_S = 2
ABANDONS = 10
HELD_STREAMS = 30
JSON_BODY_MAX = 1000000
JSON_DEPTH_MAX = 32
PASSWORD_MAX = 128
DISPLAY_NAME_MAX = 32
USERNAME_MAX = 32
EMAIL_MAX = 254
INVITE_MAX_USES = 100
INVITE_MAX_AGE = 604800
INVITE_DEFAULT_AGE = 86400
INVITE_PROBE_AGE = 6
COMMUNITY_NAME_MAX = 100
SLUG_MAX = 40
DESCRIPTION_MAX = 300
TOKEN_MIN = 32
INT_MAX = 2147483647

MESSAGES = {
    "unauthorized": "Sign in to continue.",
    "invalid_credentials": "That email and password do not match.",
    "payment_declined": "Your card was declined.",
    "forbidden": "You do not have permission to do that.",
    "entitlement_required": "Your membership tier does not include this.",
    "not_found": "Not found.",
    "method_not_allowed": "Method not allowed.",
    "conflict": "That conflicts with the current state.",
    "payload_too_large": "That is too large.",
    "unsupported_media_type": "That content type is not supported.",
    "range_not_satisfiable": "That range is not satisfiable.",
    "validation_failed": "Check the named field.",
    "rate_limited": "Too many requests. Try again later.",
}
PUBLIC_USER_KEYS = {"id", "username", "display_name", "avatar_url"}
SELF_USER_KEYS = PUBLIC_USER_KEYS | {"email", "email_verified", "status", "tier", "entitlements", "app_icon", "created_at"}
MESSAGE_KEYS = {"id", "channel_id", "author", "body", "created_at", "edited_at", "reply_to_id", "referenced_message",
                "reply_count", "mentions", "reactions", "attachments"}
COMMUNITY_KEYS = {"id", "slug", "name", "description", "icon_url", "splash_url", "banner_url", "category", "keywords",
                  "verified", "partnered", "presence_count", "member_count", "owner_id", "verification_level"}
INVITE_KEYS = {"code", "community_id", "channel_id", "inviter", "uses", "max_uses", "max_age_seconds", "expires_at", "created_at"}
ATTACHMENT_KEYS = {"id", "filename", "size_bytes", "content_type", "sha256", "url", "width", "height", "duration_ms"}
NOTIFICATION_KEYS = {"id", "kind", "read", "created_at", "message_id", "channel_id", "community_id", "actor"}
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PRIMARY_LINKS = ["Download", "Membership", "Discover", "Trending", "Safety", "Support", "Log in"]
STATIC_SITEMAP = ["/", "/download", "/membership", "/servers", "/trending-games", "/listening-room", "/support", "/support/new",
                  "/safety", "/safety-family-center", "/safety-library", "/safety-news", "/safety-teen-charter",
                  "/safety-players-guide", "/safety-parents"]
PUBLIC_ROUTES = STATIC_SITEMAP + ["/servers/aurora-collective", "/game/nova-drift", "/safety-library/reporting-and-blocking",
                                  "/login", "/register", "/verify-email"]
LEAK_MARKERS = ("Traceback", "psycopg", "asyncpg", "sqlalchemy", "SELECT ", "INSERT INTO", 'File "', "site-packages", "/app/")
EMAIL_ERR = "Enter a valid email address."
EMAIL_TAKEN_ERR = "That email is already registered."
DISPLAY_ERR = "Display name must be 1 to 32 characters, with no line breaks or control characters."
USERNAME_ERR = "Username must be 2 to 32 lowercase letters, digits, underscores or periods."
PASSWORD_ERR = "Password must be 8 to 128 characters."
DOB_ERR = "You must be at least 13 years old."
SESSION_ENDED = "Your session has ended. Log in again."
WS_HEADERS = {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
_UNSET = object()
GENERAL = "general"
CLIP_NAME = "clip.webm"
AURORA_NAME = "Aurora Collective"
RONIN_NAME = "Ronin Guild"
PIXEL_SLUG = "pixel-parlor"
ARTICLE_SLUG = "reporting-and-blocking"
FREE_TIER = "Free"
BASIC_TIER = "Basic"
CENTS_PER_DOLLAR = 100
VOLUME_MAX = 100
EVIL_HOST = "evil.example"
UNSAFE_NEXT = ("/" + "/" + EVIL_HOST, "/\\" + EVIL_HOST, "https://" + EVIL_HOST + "/x")
SCRIPT_NEXT = "javascript:" + "void(0)"
SPACED_NAME = "  Nova  Pike  "
TRIMMED_NAME = SPACED_NAME.strip()
RENAMED = "Renamed Crew"
HELLO_TEXT = "hello there"
SHADOW_TEXT = "live from the shadows"
QUOTED_EDIT = "quoted edited"
REJECTED_TEXT = "rejected text"
REACT_TARGET = "react here"
THREAD_TEXT = "thread answer"
THREAD_EDIT = THREAD_TEXT + " edited"
UNSAVED_TEXT = "never saved"
PANEL_TARGET = "panel target"
BREAKPOINT_TARGET = "breakpoint target"
BEFORE_CHANGE = "before the change"
AFTER_CHANGE = "after the change"
OWNER_WORDS = "owner words"
MY_ANSWER = "my answer"
REMOVE_ME = "please remove me"
LINE_ONE = "line one"
LINE_TWO = "line two"
FLAKY_TEXT = "flaky send"
OLDER = "older"
LIVE_HELLO = "live hello"
LIVE_CHANGED = "live changed"
FRESH_TEXT = "fresh arrival"
BEFORE_DROP = "before drop"
BEFORE_DROP_EDITED = BEFORE_DROP + " edited"
VANISH_TEXT = "will vanish"
MISSED = "missed"
PIC_NAME = "pic.png"
EXTRA_NAME = "extra.png"
HUGE_NAME = "huge.bin"
ORBIT = "orbit"
PARENT_TEXT = "hello parent"
HELLO_CHANGED = "hello changed"
FOX_TERM = "fox"
REQUEST_SUBJECT = "Keyboard help"
DESC_FIRST = "Line one"
KEYBOARD_SUBJECT = "Keyboard only"


def composer_name(channel: str = GENERAL) -> str:
    return f"Message #{channel}"


def amount_line(cents: int) -> str:
    return f"Amount: ${cents // CENTS_PER_DOLLAR}.{cents % CENTS_PER_DOLLAR:02d}"


def consent_value(analytics: int, marketing: int) -> str:
    return f"analytics:{analytics}|marketing:{marketing}"


def results_heading(n: int) -> str:
    return f"{n} result" if n == 1 else f"{n} results"


def fix_summary(n: int) -> str:
    return "Fix 1 field to continue." if n == 1 else f"Fix {n} fields to continue."


def tier_line(tier: str) -> str:
    return f"Current tier: {tier}"


def pause() -> None:
    threading.Event().wait(POLL_S)


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        value = fn()
        if value:
            return value
        pause()
    value = fn()
    if not value:
        pytest.fail(f"timed out waiting for {what}")
    return value


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as ex:
        futures = [ex.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


def req(base: str, method: str, path: str, token: str | None = None, body: Any = None, params: dict | None = None,
        headers: dict | None = None, content: bytes | None = None) -> httpx.Response:
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    kwargs: dict[str, Any] = {}
    if body is not None:
        kwargs["json"] = body
    if content is not None:
        kwargs["content"] = content
    return httpx.request(method, base + path, params=params, headers=h, timeout=HTTP_TIMEOUT, **kwargs)


def refused(r: httpx.Response, status: int, code: str, field: Any = _UNSET) -> None:
    assert r.status_code == status, (r.status_code, r.text[:500])
    body = r.json()
    assert set(body) == {"error"}, body
    err = body["error"]
    assert set(err) == {"code", "message", "field"}, err
    assert err["code"] == code and err["message"] == MESSAGES[code], err
    if field is not _UNSET:
        assert err["field"] == field, err


def encode_uri_component(value: str) -> str:
    return quote(value, safe="-_.!~*'()")


def origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def public_url(app_url: str) -> str:
    return os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")


def qs(url: str) -> dict[str, str]:
    return dict(parse_qsl(urlsplit(url).query))


def sq(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def iso(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def date_header(r: httpx.Response) -> dt.datetime:
    return email.utils.parsedate_to_datetime(r.headers["date"])


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def week_label(value: str) -> str:
    d = dt.date.fromisoformat(value)
    return f"Week of {MONTHS[d.month - 1]} {d.day}, {d.year}"


def fresh(prefix: str) -> tuple[str, str]:
    username = f"{prefix}_{uuid.uuid4().hex[:12]}"
    return username, f"{username}@example.com"


def signup(base: str, address: str, username: str, display_name: str = "Test Person", password: str = PASSWORD,
           dob: str = ADULT_DOB) -> httpx.Response:
    return req(base, "POST", "/api/auth/signup", body={"email": address, "display_name": display_name, "username": username,
                                                       "password": password, "date_of_birth": dob})


def new_member(base: str, prefix: str, display_name: str | None = None) -> dict:
    username, address = fresh(prefix)
    r = signup(base, address, username, display_name or f"Member {username[-6:]}")
    assert r.status_code == 201, r.text
    body = r.json()
    return {"token": body["access_token"], "id": body["user"]["id"], "email": address, "username": username,
            "display_name": body["user"]["display_name"]}


def login(base: str, address: str, password: str) -> str:
    r = req(base, "POST", "/api/auth/login", body={"email": address, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


_LAST_TAG = [0]


def ordered_tag() -> str:
    _LAST_TAG[0] = max(time.time_ns(), _LAST_TAG[0] + 1)
    return f"{_LAST_TAG[0]:016x}"


def new_community(base: str, token: str, category: str = "gaming", name: str | None = None, description: str | None = None) -> dict:
    tag = ordered_tag()
    body: dict[str, Any] = {"name": name or f"Crew {tag}", "slug": f"c-{tag}", "category": category}
    if description is not None:
        body["description"] = description
    r = req(base, "POST", "/api/servers", token, body=body)
    assert r.status_code == 201, r.text
    return r.json()


def join(base: str, token: str, slug: str) -> httpx.Response:
    return req(base, "POST", f"/api/servers/{slug}/join", token)


def space(base: str, n: int) -> tuple[dict, tuple, dict, int]:
    owner = new_member(base, "own")
    com = new_community(base, owner["token"])
    members = tuple(new_member(base, "mem") for _ in range(n))
    for m in members:
        assert join(base, m["token"], com["slug"]).status_code == 201
    return owner, members, com, com["channels"][0]["id"]


def detail(base: str, slug: str, token: str | None = None) -> httpx.Response:
    return req(base, "GET", f"/api/servers/{slug}", token)


def aurora(base: str) -> dict:
    r = detail(base, "aurora-collective")
    assert r.status_code == 200
    return r.json()


def channel_named(com: dict, name: str) -> int:
    return next(c["id"] for c in com["channels"] if c["name"] == name)


def post_msg(base: str, token: str, ch: int, body: str, reply_to_id: int | None = None, nonce: str | None = None,
             attachment_ids: list[int] | None = None) -> httpx.Response:
    payload: dict[str, Any] = {"body": body}
    if reply_to_id is not None:
        payload["reply_to_id"] = reply_to_id
    if nonce is not None:
        payload["nonce"] = nonce
    if attachment_ids is not None:
        payload["attachment_ids"] = attachment_ids
    return req(base, "POST", f"/api/channels/{ch}/messages", token, body=payload)


def history(base: str, token: str, ch: int, limit: int | None = None, before: int | None = None) -> dict:
    params = {k: v for k, v in (("limit", limit), ("before", before)) if v is not None}
    r = req(base, "GET", f"/api/channels/{ch}/messages", token, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def inbox(base: str, token: str, **params: Any) -> dict:
    r = req(base, "GET", "/api/notifications", token, params={k: v for k, v in params.items() if v is not None})
    assert r.status_code == 200, r.text
    return r.json()


def kinds(base: str, token: str, message_id: int) -> list[str]:
    return [n["kind"] for n in inbox(base, token, limit=NOTIF_LIMIT_MAX)["data"] if n["message_id"] == message_id]


def read_state(base: str, token: str, slug: str, ch: int) -> dict:
    r = req(base, "GET", f"/api/servers/{slug}/read-states", token)
    assert r.status_code == 200, r.text
    return next(s for s in r.json()["data"] if s["channel_id"] == ch)


def set_overwrite(base: str, token: str, ch: int, target_type: str, target_id: int, allow: list[str] | None = None,
                  deny: list[str] | None = None) -> httpx.Response:
    return req(base, "PUT", f"/api/channels/{ch}/overwrites/{target_type}/{target_id}", token,
               body={"allow": allow or [], "deny": deny or []})


def roles(base: str, token: str, slug: str) -> list[dict]:
    r = req(base, "GET", f"/api/servers/{slug}/roles", token)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def checkout(base: str, token: str, tier: str, card: str = CARD_OK, key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key is not None else None
    return req(base, "POST", "/api/membership/checkout", token, body={"tier": tier, "card_number": card}, headers=headers)


def multipart(filename: bytes, data: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex.encode()
    body = (b"--" + boundary + b"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename +
            b"\"\r\nContent-Type: application/octet-stream\r\n\r\n" + data + b"\r\n--" + boundary + b"--\r\n")
    return body, f"multipart/form-data; boundary={boundary.decode()}"


def upload(base: str, token: str, filename: str | bytes, data: bytes) -> httpx.Response:
    raw = filename.encode() if isinstance(filename, str) else filename
    body, ctype = multipart(raw, data)
    return req(base, "POST", "/api/attachments", token, content=body, headers={"Content-Type": ctype})


def disposition(kind: str, filename: str) -> str:
    return f"{kind}; filename*=UTF-8''{quote(filename.encode('utf-8'), safe='!#$&+^`|')}"


def mail_for(mail: Mailpit, address: str, expected: int, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(settle=0.5) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= expected:
            return found
        pause()
    return found


TOKEN_LINK_RE = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


def confirm_tokens(mail: Mailpit, address: str, expected: int = 1) -> list[str]:
    msgs = [m for m in mail_for(mail, address, expected) if m["Subject"] == "Confirm your Community Hub account"]
    return [TOKEN_LINK_RE.search(mail_text(m)).group(1) for m in msgs]


def sitemap_locs(base: str) -> list[str]:
    r = req(base, "GET", "/sitemap.xml")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(w: int, h: int, meta: bytes | None = None) -> bytes:
    raw = b"".join(b"\x00" + b"\x00\x00\x00" * w for _ in range(h))
    out = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    if meta:
        out += png_chunk(b"tEXt", b"Comment\x00" + meta)
    return out + png_chunk(b"IDAT", zlib.compress(raw)) + png_chunk(b"IEND", b"")


def gif_bytes(w: int, h: int) -> bytes:
    return (b"GIF89a" + struct.pack("<HHBBB", w, h, 0, 0, 0) + b"\x2c" + struct.pack("<HHHHB", 0, 0, w, h, 0) +
            b"\x02\x02\x44\x01\x00\x3b")


def webp_bytes(w: int, h: int) -> bytes:
    payload = b"\x00\x00\x00\x00" + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little")
    body = b"WEBP" + b"VP8X" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", len(body)) + body


def jpeg_bytes(w: int, h: int, orientation: int, order: str = "II") -> bytes:
    e = "<" if order == "II" else ">"
    tiff = (order.encode() + struct.pack(e + "HI", 42, 8) + struct.pack(e + "H", 1) + struct.pack(e + "HHI", 274, 3, 1) +
            struct.pack(e + "HH", orientation, 0) + struct.pack(e + "I", 0))

    def seg(marker: int, payload: bytes) -> bytes:
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload

    sof = struct.pack(">BHHB", 8, h, w, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    return (b"\xff\xd8" + seg(0xE1, b"Exif\x00\x00" + tiff) + seg(0xDB, bytes(65)) + seg(0xC4, bytes(17)) + seg(0xC0, sof) +
            seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00") + bytes(8) + b"\xff\xd9")


def ebml(id_hex: str, payload: bytes) -> bytes:
    return bytes.fromhex(id_hex) + b"\x01" + len(payload).to_bytes(7, "big") + payload


def uint(n: int) -> bytes:
    return n.to_bytes(max(1, (n.bit_length() + 7) // 8), "big")


def webm_bytes(w: int, h: int, duration: float, scale: int | None = 1000000, pad: int = 0) -> bytes:
    header = ebml("1A45DFA3", ebml("4286", uint(1)) + ebml("42F7", uint(1)) + ebml("42F2", uint(4)) + ebml("42F3", uint(8)) +
                  ebml("4282", b"webm") + ebml("4287", uint(4)) + ebml("4285", uint(2)))
    info = (ebml("2AD7B1", uint(scale)) if scale else b"") + ebml("4489", struct.pack(">d", duration)) + \
        ebml("4D80", b"hub-test") + ebml("5741", b"hub-test")
    audio = ebml("AE", ebml("D7", uint(1)) + ebml("73C5", uint(1)) + ebml("83", uint(2)) + ebml("86", b"A_OPUS"))
    video = ebml("AE", ebml("D7", uint(2)) + ebml("73C5", uint(2)) + ebml("83", uint(1)) + ebml("86", b"V_VP9") +
                 ebml("E0", ebml("B0", uint(w)) + ebml("BA", uint(h))))
    segment = ebml("1549A966", info) + ebml("1654AE6B", audio + video)
    if pad:
        segment += ebml("EC", bytes(pad))
    return header + ebml("18538067", segment)


@contextlib.contextmanager
def browse(browser: Browser, width: int = DESKTOP_W, height: int = DESKTOP_H, **options: Any) -> Iterator[Any]:
    context = browser.new_context(viewport={"width": width, "height": height}, **options)
    page = context.new_page()
    try:
        yield page
    finally:
        context.close()


def btn(page: Any, name: str) -> Any:
    return page.get_by_role("button", name=name, exact=True)


def box(locator: Any) -> dict:
    b = locator.bounding_box()
    assert b is not None, "element has no box"
    return b


def field_value(locator: Any) -> str:
    return locator.evaluate("e => ('value' in e) ? e.value : e.innerText")


def ui_submit_login(page: Any, address: str, password: str) -> str:
    page.get_by_label("Email", exact=True).fill(address)
    page.get_by_label("Password", exact=True).fill(password)
    answer: dict[str, Any] = {}

    def grab(route: Any) -> None:
        if route.request.method != "POST":
            route.fallback()
            return
        try:
            r = route.fetch(timeout=LOGIN_WAIT_MS)
        except PlaywrightError:
            route.abort()
            return
        answer.update(status=r.status, text=r.text())
        route.fulfill(response=r)

    page.route(re.compile(r"/api/auth/login$"), grab)
    with page.expect_response(lambda r: urlsplit(r.url).path == "/api/auth/login" and r.request.method == "POST",
                              timeout=LOGIN_WAIT_MS):
        btn(page, "Log in").click()
    assert answer, "the login request finished without an answer"
    assert answer["status"] == 200, answer["text"]
    return json.loads(answer["text"])["access_token"]


def ui_login(page: Any, base: str, address: str, password: str, next_path: str) -> str:
    page.goto(f"{base}/login?next={encode_uri_component(next_path)}")
    token = ui_submit_login(page, address, password)
    expect(page).to_have_url(base + next_path)
    return token


def open_channel(page: Any, base: str, member: dict, community_id: int, ch: int) -> str:
    seen = {"history": False, "live": False}

    def on_response(r: Any) -> None:
        path = urlsplit(r.url).path
        if path == f"/api/channels/{ch}/messages" and r.request.method == "GET":
            seen["history"] = True
        elif path == "/api/live" and r.status in (101, 200):
            seen["live"] = True

    def on_socket(ws: Any) -> None:
        if urlsplit(ws.url).path == "/api/live":
            seen["live"] = True

    page.on("response", on_response)
    page.on("websocket", on_socket)
    try:
        token = ui_login(page, base, member["email"], PASSWORD, f"/channels/{community_id}/{ch}")
        expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=WORKSPACE_READY_MS)
        deadline = time.monotonic() + WORKSPACE_READY_MS / 1000
        while not (seen["history"] and seen["live"]) and time.monotonic() < deadline:
            page.evaluate("0")
            pause()
        if seen["history"]:
            page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))")
    finally:
        page.remove_listener("response", on_response)
        page.remove_listener("websocket", on_socket)
    return token


def fill_register(page: Any, address: str, display: str, username: str, password: str, dob: str) -> None:
    page.get_by_label("Email", exact=True).fill(address)
    page.get_by_label("Display name", exact=True).fill(display)
    page.get_by_label("Username", exact=True).fill(username)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_label("Date of birth", exact=True).fill(dob)


UNAVAILABLE_JS = """e => { if (!e.isConnected) return true;
  for (let n = e; n; n = n.parentElement) { if (n.hidden || n.inert) return true;
    if (getComputedStyle(n).display === 'none') return true; }
  return getComputedStyle(e).visibility === 'hidden'; }"""


def assert_unavailable(locator: Any, seconds: float = CLOSE_WAIT_S) -> None:
    poll(lambda: all(h.evaluate(UNAVAILABLE_JS) for h in locator.element_handles()), seconds,
         "a closed region to become unavailable")


def release(route: Any) -> None:
    try:
        route.continue_()
    except PlaywrightError:
        return
    try:
        route.request.response()
    except PlaywrightError:
        pass


def first_visible(locator: Any) -> Any:
    return poll(lambda: next((m for m in locator.all() if m.is_visible()), None), VISIBLE_WAIT_S, "a visible match")


def slider_level(locator: Any) -> float:
    return float(locator.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))


def never_focused(page: Any, targets: Any, presses: int = 20) -> None:
    targets = targets if isinstance(targets, (list, tuple)) else [targets]
    handles = [h for t in targets for h in t.element_handles()]
    page.evaluate("() => { if (document.activeElement) document.activeElement.blur(); }")
    for _ in range(presses):
        page.keyboard.press("Tab")
        assert not page.evaluate("hs => hs.some(h => h.contains(document.activeElement))", handles), "Tab reached a closed region"


LIVE_RECORDER = """(() => { window.__live = [];
  const OE = window.EventSource;
  if (OE) { const W = function (u, o) { const es = new OE(u, o); const add = es.addEventListener.bind(es);
      add('message', e => window.__live.push(String(e.data)));
      es.addEventListener = (t, f, x) => { if (t !== 'message') add(t, e => window.__live.push(String(e.data)), x); return add(t, f, x); };
      return es; };
    W.prototype = OE.prototype; W.CONNECTING = 0; W.OPEN = 1; W.CLOSED = 2; window.EventSource = W; }
  const of = window.fetch.bind(window);
  window.fetch = async (...args) => { const r = await of(...args); const u = String((args[0] && args[0].url) || args[0]);
    if (u.includes('/api/live') && r.body) { const dec = new TextDecoder();
      const ts = new TransformStream({ transform(c, ctl) { window.__live.push(dec.decode(c, {stream: true})); ctl.enqueue(c); } });
      return new Response(r.body.pipeThrough(ts), {status: r.status, statusText: r.statusText, headers: r.headers}); }
    return r; }; })()"""


def record_live(page: Any) -> list[str]:
    frames: list[str] = []
    page.add_init_script(LIVE_RECORDER)
    page.on("websocket", lambda ws: ws.on("framereceived", lambda p: frames.append(p if isinstance(p, str) else p.decode("utf-8", "replace"))))
    return frames


def live_text(page: Any, frames: list[str]) -> str:
    return "\n".join(frames + page.evaluate("() => window.__live || []"))


@pytest.fixture
def app2_url(app_url: str) -> Iterator[str]:
    root = Path(DEPLOYED_APP)
    manifest = json.loads((root / "run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=root, env={**os.environ, "PORT": str(port)},
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    def ready() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"second instance exited:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(ready, INSTANCE_BOOT_S, "second instance health")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def test_health_and_envelope(app_url: str) -> None:
    for base in (app_url, os.environ["APP_MAIL_DOWN_URL"]):
        r = req(base, "GET", "/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert date_header(r)
    r = req(app_url, "GET", "/api/users/@me")
    refused(r, 401, "unauthorized", None)
    assert date_header(r)
    refused(req(app_url, "POST", "/api/auth/login", body={"email": f"nobody-{uuid.uuid4().hex}@example.com", "password": "wrong-pass-0000"}),
            401, "invalid_credentials", None)
    _, address = fresh("env")
    refused(req(app_url, "POST", "/api/auth/signup", body={"email": address}), 422, "validation_failed", "display_name")
    owner, (m,), com, ch = space(app_url, 1)
    refused(req(app_url, "PATCH", f"/api/servers/{com['slug']}", m["token"], body={"name": "Taken Over"}), 403, "forbidden", None)


def test_unpublished_unknown_slugs(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    slug = com["slug"]
    outsider = new_member(app_url, "unp")
    for tok in (None, outsider["token"], m["token"]):
        refused(detail(app_url, "draft-hall", tok), 404, "not_found", None)
    refused(detail(app_url, f"unknown-{uuid.uuid4().hex[:8]}"), 404, "not_found")
    assert req(app_url, "PATCH", f"/api/servers/{slug}", owner["token"], body={"published": False}).status_code == 200
    for tok in (None, outsider["token"]):
        refused(detail(app_url, slug, tok), 404, "not_found")
    refused(req(app_url, "GET", f"/api/servers/{slug}/members", outsider["token"]), 404, "not_found")
    refused(join(app_url, outsider["token"], slug), 404, "not_found")
    assert detail(app_url, slug, m["token"]).status_code == 200
    assert detail(app_url, slug, owner["token"]).json()["name"] == com["name"]
    assert req(app_url, "GET", f"/api/servers/{slug}/members", m["token"]).status_code == 200
    assert history(app_url, m["token"], ch)["data"] == []
    assert Postgres().rows(f"SELECT count(*) AS n FROM memberships WHERE member_id = {int(outsider['id'])}")[0]["n"] == 0


def test_publishing_sitemap(app_url: str) -> None:
    owner = new_member(app_url, "pub")
    member = new_member(app_url, "pubm")
    tag = uuid.uuid4().hex[:12]
    com = new_community(app_url, owner["token"], category="education", description=f"study {tag} hall")
    slug = com["slug"]
    assert join(app_url, member["token"], slug).status_code == 201
    origins = {origin(public_url(app_url)), origin(app_url)}

    def listed() -> bool:
        return slug in [c["slug"] for c in req(app_url, "GET", "/api/servers", params={"q": tag}).json()["data"]]

    def cat_total() -> int:
        return req(app_url, "GET", "/api/servers", params={"category": "education"}).json()["total"]

    def mapped() -> bool:
        return f"/servers/{slug}" in [urlsplit(loc).path for loc in sitemap_locs(app_url)]

    assert listed() and mapped()
    before = cat_total()
    assert req(app_url, "PATCH", f"/api/servers/{slug}", owner["token"], body={"published": False}).status_code == 200
    assert not listed() and cat_total() == before - 1 and not mapped()
    refused(detail(app_url, slug), 404, "not_found")
    assert detail(app_url, slug, member["token"]).status_code == 200
    assert req(app_url, "GET", f"/api/servers/{slug}/members", member["token"]).status_code == 200
    assert req(app_url, "PATCH", f"/api/servers/{slug}", owner["token"], body={"published": True}).status_code == 200
    assert listed() and cat_total() == before and mapped()
    assert detail(app_url, slug).status_code == 200
    locs = sitemap_locs(app_url)
    assert len(locs) == len(set(locs))
    paths = set()
    for loc in locs:
        assert origin(loc) in origins, loc
        path = urlsplit(loc).path
        assert path in STATIC_SITEMAP or re.fullmatch(r"/(servers|game|safety-library)/[^/]+", path), path
        paths.add(path)
    assert set(STATIC_SITEMAP) <= paths
    assert {f"/game/{g}" for g in GAMES} <= paths
    assert f"/safety-library/{ARTICLE_SLUG}" in paths and f"/servers/{PIXEL_SLUG}" in paths
    assert "/servers/draft-hall" not in paths
    robots = req(app_url, "GET", "/robots.txt")
    assert robots.status_code == 200 and robots.headers["content-type"].startswith("text/plain")
    lines = [line.strip() for line in robots.text.splitlines()]
    assert "Disallow: /channels/" in lines and "Disallow: /settings" in lines
    sitemaps = [line for line in lines if line.lower().startswith("sitemap:")]
    assert len(sitemaps) == 1 and sitemaps[0].split(":", 1)[1].strip() in {o + "/sitemap.xml" for o in origins}


def test_unlisted_surface(app_url: str) -> None:
    for path in ("/api/docs", "/api/redoc", "/api/openapi.json", "/api/health/", "/api/servers/", "/api/nothing-here",
                 "/api/roles/abc", "/api/messages/1x", "/api/messages/0", f"/api/messages/{INT_MAX + 1}", "/api/channels/-5/messages"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT, follow_redirects=False)
        refused(r, 404, "not_found", None)
    assert httpx.get(app_url + "/media/abc", timeout=HTTP_TIMEOUT).status_code == 404
    for path in ("/docs", "/redoc", "/openapi.json", "/admin", f"/no-such-page-{uuid.uuid4().hex[:6]}"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT, follow_redirects=False)
        assert r.status_code == 404 and "PAGE NOT FOUND" in r.text, path
    for method, path, allow in (("DELETE", "/api/health", "GET"), ("HEAD", "/api/health", "GET"), ("OPTIONS", "/api/health", "GET"),
                                ("PUT", "/api/servers", "GET, POST"), ("DELETE", "/api/servers/aurora-collective", "GET, PATCH"),
                                ("GET", "/api/messages/1", "PATCH, DELETE"), ("POST", "/api/servers/aurora-collective/bans/1", "PUT, DELETE"),
                                ("PATCH", "/api/invites/abcdefgh", "GET, DELETE"), ("GET", "/api/auth/login", "POST"),
                                ("POST", "/api/users/@me", "GET, PATCH")):
        r = httpx.request(method, app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 405 and r.headers["allow"] == allow, (method, path, r.status_code, r.headers.get("allow"))
        if method != "HEAD":
            refused(r, 405, "method_not_allowed", None)
    probe = f"probe-{uuid.uuid4().hex}@example.com"
    json_ct = {"Content-Type": "application/json"}
    for raw in (b"{not json", b"[1, 2]", b'"text"'):
        refused(req(app_url, "POST", "/api/auth/login", content=raw, headers=json_ct), 422, "validation_failed", None)
    refused(req(app_url, "POST", "/api/auth/login", content=b'{"email": "a"}', headers={"Content-Type": "text/plain"}),
            415, "unsupported_media_type", None)
    base_body = json.dumps({"email": probe, "password": "wrong-pass-0000", "pad": ""}).encode()
    exact = json.dumps({"email": probe, "password": "wrong-pass-0000", "pad": "x" * (JSON_BODY_MAX - len(base_body))}).encode()
    assert len(exact) == JSON_BODY_MAX
    refused(req(app_url, "POST", "/api/auth/login", content=exact, headers=json_ct), 401, "invalid_credentials")
    refused(req(app_url, "POST", "/api/auth/login", content=exact[:-1] + b' }', headers=json_ct), 413, "payload_too_large", None)
    m = new_member(app_url, "srf")
    refused(req(app_url, "POST", "/api/attachments", m["token"], body={"file": "x"}), 415, "unsupported_media_type", None)


def test_refusal_copy(app_url: str) -> None:
    refused(httpx.get(app_url + "/api/missing-route", timeout=HTTP_TIMEOUT), 404, "not_found", None)
    refused(httpx.delete(app_url + "/api/health", timeout=HTTP_TIMEOUT), 405, "method_not_allowed", None)
    refused(req(app_url, "POST", "/api/auth/login", content=b"{", headers={"Content-Type": "application/json"}), 422, "validation_failed", None)
    refused(req(app_url, "POST", "/api/auth/login", content=b"email=a", headers={"Content-Type": "application/x-www-form-urlencoded"}),
            415, "unsupported_media_type", None)
    refused(req(app_url, "GET", "/api/users/@me", headers={"Authorization": "Bearer not-a-real-token"}), 401, "unauthorized", None)
    for path in (f"/nope-{uuid.uuid4().hex[:6]}", "/servers/draft-hall", "/servers/unknown-x9", "/game/unknown-x9", "/safety-library/unknown-x9"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, path
        html = r.text
        assert re.search(r"<title>\s*Page not found - Community Hub\s*</title>", html), path
        assert "PAGE NOT FOUND" in html and "This page could not be found." in html and "Back to home" in html, path


def test_hostile_input(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    slug = com["slug"]
    msg = post_msg(app_url, owner["token"], ch, "hostile target").json()["id"]
    seen: list[httpx.Response] = []

    def got(r: httpx.Response) -> httpx.Response:
        seen.append(r)
        return r

    for path, field, tok in (("/api/servers?q=%00", "q", None), ("/api/servers?q=%FF", "q", None), ("/api/servers?q=ab%E2%82", "q", None),
                             ("/api/servers?category=%00", "category", None), ("/api/safety/articles?q=%00", "q", None),
                             ("/api/trending-games?week=%00", "week", None),
                             (f"/api/servers/{slug}/messages/search?q=%00", "q", m["token"]),
                             ("/api/notifications?before=%FF", "before", m["token"]),
                             ("/api/servers?page=99999999999999999999", "page", None)):
        refused(got(req(app_url, "GET", path, tok)), 422, "validation_failed", field)
    assert got(req(app_url, "GET", "/api/servers?unused=%00")).status_code == 200
    assert got(req(app_url, "GET", "/api/health?x=%FF")).status_code == 200
    username, address = fresh("hos")
    _, ticket = fresh("host")
    for method, path, tok, body, field in (
            ("POST", "/api/auth/signup", None, {"email": address, "display_name": "Nova\u0000Pike", "username": username,
                                                "password": PASSWORD, "date_of_birth": ADULT_DOB}, "display_name"),
            ("POST", "/api/auth/signup", None, {"email": 123, "display_name": "Nova", "username": username,
                                                "password": PASSWORD, "date_of_birth": ADULT_DOB}, "email"),
            ("POST", f"/api/channels/{ch}/messages", m["token"], {"body": "hi\u0000there"}, "body"),
            ("POST", f"/api/channels/{ch}/messages", m["token"], {"body": 5}, "body"),
            ("POST", "/api/support/tickets", None, {"email": ticket, "category": "other", "subject": "Sub\u0000ject",
                                                   "body": "A valid description."}, "subject"),
            ("POST", "/api/servers", owner["token"], {"name": "Na\u0000me", "slug": f"h-{uuid.uuid4().hex[:10]}", "category": "music"}, "name"),
            ("POST", f"/api/servers/{slug}/roles", owner["token"], {"name": "Ro\u0000le", "permissions": []}, "name"),
            ("PATCH", "/api/users/@me", m["token"], {"display_name": "x\u0000"}, "display_name")):
        refused(got(req(app_url, method, path, tok, body=body)), 422, "validation_failed", field)

    def nested(k: int) -> Any:
        v: Any = 0
        for _ in range(k):
            v = [v]
        return v

    probe = f"deep-{uuid.uuid4().hex}@example.com"
    ct = {"Content-Type": "application/json"}
    ok_depth = json.dumps({"email": probe, "password": "wrong-pass-0000", "pad": nested(JSON_DEPTH_MAX - 1)}).encode()
    refused(got(req(app_url, "POST", "/api/auth/login", content=ok_depth, headers=ct)), 401, "invalid_credentials")
    too_deep = json.dumps({"email": probe, "password": "wrong-pass-0000", "pad": nested(JSON_DEPTH_MAX)}).encode()
    refused(got(req(app_url, "POST", "/api/auth/login", content=too_deep, headers=ct)), 422, "validation_failed", None)
    for raw in (b'{"email": "\\ud800x@example.com", "password": "x"}', b'{"zzz": "\\udc00", "email": "a@b.co", "password": "x"}'):
        refused(got(req(app_url, "POST", "/api/auth/login", content=raw, headers=ct)), 422, "validation_failed", None)
    for method, path, tok in (("GET", "/api/servers/%00", None), ("GET", "/api/servers/%FF", None), ("GET", "/api/servers/%00/members", None),
                              ("GET", "/api/invites/%00", None), ("PUT", f"/api/messages/{msg}/reactions/%FF", m["token"]),
                              ("DELETE", "/api/roles/%00", owner["token"]), ("GET", "/api/games/%FF", None)):
        refused(got(req(app_url, method, path, tok)), 404, "not_found")
    assert got(req(app_url, "GET", "/media/%00")).status_code == 404
    for r in seen:
        assert str(r.status_code)[0] != "5", (r.request.url, r.status_code)
        blob = r.text + " ".join(f"{k}: {v}" for k, v in r.headers.items())
        for marker in LEAK_MARKERS:
            assert marker not in blob, (r.request.url, marker)


def test_wf_not_found_stale_link(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        page.goto(app_url + "/servers")
        resp = page.goto(app_url + "/servers/draft-hall")
        assert resp.status == 404
        html = resp.text()
        assert re.search(r"<title>\s*Page not found - Community Hub\s*</title>", html)
        assert "PAGE NOT FOUND" in html and "This page could not be found." in html and "Menu" in html
        expect(page).to_have_title("Page not found - Community Hub")
        expect(page.get_by_role("heading", level=1)).to_have_text("PAGE NOT FOUND")
        expect(page.get_by_text("This page could not be found.")).to_be_visible()
        page.get_by_role("link", name="Back to home").click()
        expect(page).to_have_url(app_url + "/")
    refused(detail(app_url, "draft-hall"), 404, "not_found")


def test_wf_not_found_phone_menu(browser: Browser, app_url: str) -> None:
    with browse(browser, PHONE_W, PHONE_H) as page:
        page.goto(app_url + "/")
        dialog = page.get_by_role("dialog", name="Cookie preferences")
        expect(dialog).to_be_visible()
        btn(page, "Reject optional").click()
        closed_dialog = page.get_by_role("dialog", name="Cookie preferences", include_hidden=True)
        assert_unavailable(closed_dialog)
        never_focused(page, closed_dialog, presses=12)
        for path in PUBLIC_ROUTES + ["/servers/draft-hall"]:
            page.goto(app_url + path)
            menu = btn(page, "Menu")
            expect(menu).to_have_attribute("aria-expanded", "false")
            nav = page.get_by_role("navigation", name="Primary")
            links = [nav.get_by_role("link", name=n, exact=True, include_hidden=True) for n in PRIMARY_LINKS]
            for link in links:
                assert_unavailable(link)
            never_focused(page, links, presses=8)
            menu.click()
            expect(menu).to_have_attribute("aria-expanded", "true")
            visible = [nav.get_by_role("link", name=n, exact=True) for n in PRIMARY_LINKS]
            for link in visible:
                expect(link).to_be_visible()
            ys = [box(link)["y"] for link in visible]
            assert ys == sorted(ys), path
            visible[2].focus()
            page.keyboard.press("Escape")
            expect(menu).to_be_focused()
            expect(menu).to_have_attribute("aria-expanded", "false")
            for link in links:
                assert_unavailable(link)
        page.goto(app_url + "/")
        btn(page, "Menu").click()
        page.set_viewport_size({"width": TABLET_W, "height": TABLET_H})
        expect(btn(page, "Menu")).to_have_count(0)
        expect(page.get_by_role("navigation", name="Primary").get_by_role("link", name="Discover", exact=True)).to_be_visible()
        page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
        expect(btn(page, "Menu")).to_have_attribute("aria-expanded", "false")


def test_signup_session(app_url: str) -> None:
    username, address = fresh("ses")
    r = signup(app_url, address.upper(), username, SPACED_NAME)
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"access_token", "token_type", "user"} and body["token_type"] == "bearer"
    user = body["user"]
    assert set(user) == SELF_USER_KEYS
    assert user["email"] == address and user["display_name"] == TRIMMED_NAME and user["username"] == username
    assert (user["status"], user["tier"], user["app_icon"], user["email_verified"], user["entitlements"]) == ("online", "free", "classic", False, [])
    assert TIMESTAMP_RE.match(user["created_at"])
    row = Postgres().rows(f"SELECT email, display_name FROM members WHERE id = {int(user['id'])}")
    assert row == [{"email": address, "display_name": TRIMMED_NAME}]
    lr = req(app_url, "POST", "/api/auth/login", body={"email": address.upper(), "password": PASSWORD})
    assert lr.status_code == 200 and lr.json()["user"] == user and lr.json()["token_type"] == "bearer"
    tok = lr.json()["access_token"]
    assert req(app_url, "GET", "/api/users/@me", tok).json() == user
    patched = req(app_url, "PATCH", "/api/users/@me", tok, body={"display_name": "  Fern  ", "status": "dnd"})
    assert patched.status_code == 200 and patched.json()["display_name"] == "Fern" and patched.json()["status"] == "dnd"
    refused(req(app_url, "PATCH", "/api/users/@me", tok, body={"status": "away"}), 422, "validation_failed", "status")
    refused(req(app_url, "PATCH", "/api/users/@me", tok, body={"display_name": "   "}), 422, "validation_failed", "display_name")
    refused(req(app_url, "PATCH", "/api/users/@me", tok, body={"app_icon": "midnight"}), 403, "entitlement_required", None)
    me = req(app_url, "GET", "/api/users/@me", tok).json()
    assert (me["display_name"], me["status"], me["app_icon"]) == ("Fern", "dnd", "classic")


def test_confirmation_email(app_url: str, mail: Mailpit) -> None:
    username, address = fresh("cm")
    name = 'Pike, Nova "Z" 🎮 <crew>'
    assert signup(app_url, address, username, name).status_code == 201
    mail_for(mail, address, 1)
    msgs = mail_for(mail, address, 2, seconds=MAIL_SETTLE_S * 3)
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["Subject"] == "Confirm your Community Hub account"
    assert len(msg["To"]) == 1 and msg["To"][0]["Name"] == name and msg["To"][0]["Address"].lower() == address
    assert not msg.get("Cc") and not msg.get("Bcc")
    assert msg["From"]["Address"].lower() == mail_from_address().lower()
    lines = [line.strip() for line in mail_text(msg).splitlines() if line.strip()]
    assert lines[0] == f"Hi {name}, confirm your email for @{username}."
    hit = re.fullmatch(rf"Confirm your address: {re.escape(public_url(app_url))}/verify-email\?token=([A-Za-z0-9_-]+)", lines[1])
    assert hit and len(hit.group(1)) >= TOKEN_MIN


def test_email_confirmation(app_url: str, mail: Mailpit) -> None:
    m = new_member(app_url, "conf")
    first = confirm_tokens(mail, m["email"], 1)
    assert len(first) == 1
    assert req(app_url, "POST", "/api/auth/resend-confirmation", m["token"]).status_code == 204
    both = poll(lambda: (lambda t: t if len(t) == 2 else None)(confirm_tokens(mail, m["email"], 2)), MAIL_WAIT_S, "second token")
    newer = [t for t in both if t != first[0]]
    assert len(newer) == 1
    refused(req(app_url, "POST", "/api/auth/verify-email", body={"token": first[0]}), 422, "validation_failed", "token")
    r = req(app_url, "POST", "/api/auth/verify-email", body={"token": newer[0]})
    assert r.status_code == 200 and r.json() == {"email_verified": True}
    refused(req(app_url, "POST", "/api/auth/verify-email", body={"token": newer[0]}), 422, "validation_failed", "token")
    refused(req(app_url, "POST", "/api/auth/verify-email", body={"token": "x" * TOKEN_MIN}), 422, "validation_failed", "token")
    assert req(app_url, "GET", "/api/users/@me", m["token"]).json()["email_verified"] is True
    refused(req(app_url, "POST", "/api/auth/resend-confirmation", m["token"]), 409, "conflict", None)
    assert len(mail_for(mail, m["email"], 3, seconds=MAIL_SETTLE_S * 3)) == 2
    u = new_member(app_url, "lvl")
    star = detail(app_url, "starlight-studio").json()
    assert star["verification_level"] == "email"
    general = channel_named(star, "general")
    assert join(app_url, u["token"], "starlight-studio").status_code == 201
    try:
        assert history(app_url, u["token"], general)["has_more"] in (True, False)
        refused(post_msg(app_url, u["token"], general, "unconfirmed hello"), 403, "forbidden")
        token = confirm_tokens(mail, u["email"], 1)[0]
        assert req(app_url, "POST", "/api/auth/verify-email", body={"token": token}).status_code == 200
        assert post_msg(app_url, u["token"], general, "confirmed hello").status_code == 201
    finally:
        req(app_url, "DELETE", "/api/servers/starlight-studio/membership", u["token"])


def test_duplicate_signups(app_url: str, mail: Mailpit) -> None:
    username, address = fresh("dup")
    out = together([lambda i=i: signup(app_url, address if i % 2 else address.upper(), f"{username}{i}") for i in range(6)])
    assert sorted(r.status_code for r in out) == [201] + [409] * 5
    for r in out:
        if r.status_code == 409:
            refused(r, 409, "conflict", "email")
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM members WHERE lower(email) = {sq(address)}")[0]["n"] == 1
    mail_for(mail, address, 1)
    assert len(mail_for(mail, address, 2, seconds=MAIL_SETTLE_S * 3)) == 1
    shared, _ = fresh("dun")
    emails = [fresh("dum")[1] for _ in range(6)]
    out = together([lambda e=e: signup(app_url, e, shared) for e in emails])
    assert sorted(r.status_code for r in out) == [201] + [409] * 5
    for r in out:
        if r.status_code == 409:
            refused(r, 409, "conflict", "username")
    assert pg.rows(f"SELECT count(*) AS n FROM members WHERE lower(username) = {sq(shared)}")[0]["n"] == 1
    winner = emails[[r.status_code for r in out].index(201)]
    mail_for(mail, winner, 1)
    sent = [m for m in mail.messages(settle=MAIL_SETTLE_S) if set(a.lower() for a in addresses(m.get("To"))) & set(emails)]
    assert len(sent) == 1
    refused(signup(app_url, address, shared), 409, "conflict", "email")


def test_confirmation_capability(app_url: str, mail: Mailpit) -> None:
    m = new_member(app_url, "cap")
    token = confirm_tokens(mail, m["email"], 1)[0]
    digest = hashlib.sha256(token.encode()).hexdigest()
    pg = Postgres()
    cols = pg.rows("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' "
                   "AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb') AND table_name <> 'outbox'")
    digest_hits = 0
    for col in cols:
        t, c = col["t"], col["c"]
        assert pg.rows(f'SELECT count(*) AS n FROM "{t}" WHERE strpos("{c}"::text, {sq(token)}) > 0')[0]["n"] == 0, (t, c)
        digest_hits += pg.rows(f'SELECT count(*) AS n FROM "{t}" WHERE strpos(lower("{c}"::text), {sq(digest)}) > 0')[0]["n"]
    assert digest_hits >= 1
    r = httpx.get(f"{app_url}/verify-email", params={"token": token}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.headers["referrer-policy"] == "no-referrer"
    assert req(app_url, "GET", "/api/users/@me", m["token"]).json()["email_verified"] is False
    assert req(app_url, "GET", "/verify-email").headers["referrer-policy"] == "no-referrer"


def test_wf_signup_join_register(browser: Browser, app_url: str, mail: Mailpit) -> None:
    owner, _, com, ch = space(app_url, 0)
    slug = com["slug"]
    username, address = fresh("jr")
    signups: list[str] = []
    with browse(browser) as page:
        page.on("request", lambda rq: signups.append(rq.url) if urlsplit(rq.url).path == "/api/auth/signup" else None)
        page.goto(f"{app_url}/servers/{slug}")
        btn(page, "Join community").click()
        nxt = encode_uri_component(f"/servers/{slug}?join=1")
        expect(page).to_have_url(f"{app_url}/register?next={nxt}")
        expect(page.get_by_role("main").get_by_role("link", name="Log in")).to_have_attribute("href", re.compile(re.escape(f"next={nxt}") + "$"))
        fill_register(page, address, "Joining Person", username, PASSWORD, ADULT_DOB)
        btn(page, "Create an account").dblclick()
        expect(page).to_have_url(f"{app_url}/channels/{com['id']}/{ch}")
        expect(page.get_by_role("status", name="Workspace status")).to_have_text(f"You joined {com['name']}.")
        page.reload()
        expect(page).to_have_url(f"{app_url}/channels/{com['id']}/{ch}")
        expect(page.get_by_role("heading", level=1)).to_have_text("general")
        page.go_back()
        expect(page).to_have_url(f"{app_url}/servers/{slug}")
        expect(page.get_by_role("link", name="Open community", exact=True)).to_be_visible()
        expect(btn(page, "Join community")).to_have_count(0)
    assert len(signups) == 1
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM members WHERE lower(email) = {sq(address)}")[0]["n"] == 1
    assert detail(app_url, slug).json()["member_count"] == 2
    mail_for(mail, address, 1)
    assert len(mail_for(mail, address, 2, seconds=MAIL_SETTLE_S * 3)) == 1


def test_wf_signup_landing_history(browser: Browser, app_url: str) -> None:
    m = new_member(app_url, "lh")
    with browse(browser) as page:
        page.goto(app_url + "/servers")
        page.goto(f"{app_url}/login?next=%2Ftrending-games")
        ui_submit_login(page, m["email"], PASSWORD)
        expect(page).to_have_url(app_url + "/trending-games")
        page.go_back()
        expect(page).to_have_url(app_url + "/servers")
        page.go_forward()
        expect(page).to_have_url(app_url + "/trending-games")
        page.goto(app_url + "/login")
        expect(page).to_have_url(app_url + "/servers")
        page.go_back()
        expect(page).to_have_url(app_url + "/trending-games")
        page.goto(f"{app_url}/register?next=%2Fmembership")
        expect(page).to_have_url(app_url + "/membership")
        page.goto(app_url + "/settings")
        btn(page, "Log out").click()
        expect(page).to_have_url(app_url + "/login")
        page.go_back()
        expect(page).to_have_url(app_url + "/membership")
        page.goto(app_url + "/settings")
        expect(page).to_have_url(f"{app_url}/login?next=%2Fsettings")
        for bad in UNSAFE_NEXT:
            page.goto(f"{app_url}/login?next={encode_uri_component(bad)}")
            ui_submit_login(page, m["email"], PASSWORD)
            expect(page).to_have_url(app_url + "/servers")
            page.goto(app_url + "/settings")
            btn(page, "Log out").click()
            expect(page).to_have_url(app_url + "/login")
    assert req(app_url, "GET", "/api/users/@me", m["token"]).status_code == 200


def test_wf_signup_confirm_link(browser: Browser, app_url: str, mail: Mailpit) -> None:
    m = new_member(app_url, "cl")
    token = confirm_tokens(mail, m["email"], 1)[0]
    with browse(browser) as page:
        referers: list[str] = []
        page.on("request", lambda rq: referers.append(rq.headers.get("referer", "")))
        status = page.get_by_role("status", name="Confirmation status")
        with held(page, "**/api/auth/verify-email") as hold:
            page.goto(f"{app_url}/verify-email?token={token}")
            expect(page.get_by_role("heading", level=1)).to_have_text("CONFIRM YOUR EMAIL")
            expect(status).to_have_text("Confirming your email…")
            expect(page).to_have_url(app_url + "/verify-email")
            hold.release()
        expect(status).to_have_text("Your email is confirmed.")
        expect(page).to_have_url(app_url + "/verify-email")
        assert all(token not in ref for ref in referers)
        assert token not in page.evaluate("() => location.href")
        page.reload()
        expect(page.get_by_role("status", name="Confirmation status")).to_have_text("This confirmation link is no longer valid.")
    assert req(app_url, "GET", "/api/users/@me", m["token"]).json()["email_verified"] is True


def test_wf_signup_mail_outage(browser: Browser, app_url: str, mail: Mailpit) -> None:
    down = os.environ["APP_MAIL_DOWN_URL"]
    assert req(down, "GET", "/api/health").json() == {"status": "ok"}
    username, address = fresh("out")
    with browse(browser) as page:
        page.goto(down + "/register")
        fill_register(page, address, "Outage Person", username, PASSWORD, ADULT_DOB)
        start = time.monotonic()
        with page.expect_response(lambda r: urlsplit(r.url).path == "/api/auth/signup") as info:
            btn(page, "Create an account").click()
        assert info.value.status == 201 and time.monotonic() - start < MAIL_DOWN_RESPONSE_S
        expect(page).to_have_url(down + "/servers")
    _, ticket = fresh("outt")
    start = time.monotonic()
    r = req(down, "POST", "/api/support/tickets", body={"email": ticket, "category": "other", "subject": "Outage", "body": "During an outage."})
    assert r.status_code == 201 and time.monotonic() - start < MAIL_DOWN_RESPONSE_S
    pw = new_member(app_url, "outp")
    start = time.monotonic()
    r = req(down, "POST", "/api/users/@me/password", pw["token"], body={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert r.status_code == 204 and time.monotonic() - start < MAIL_DOWN_RESPONSE_S
    for addr, subject in ((address, "Confirm your Community Hub account"), (ticket, "We received your request HUB-")):
        found = mail_for(mail, addr, 1)
        assert len(found) == 1 and found[0]["Subject"].startswith(subject), addr
    assert any(x["Subject"] == "Your Community Hub password was changed" for x in mail_for(mail, pw["email"], 2))
    for addr in (address, ticket):
        assert len(mail_for(mail, addr, 2, seconds=MAIL_SETTLE_S * 3)) == 1, addr
    pg = Postgres()
    poll(lambda: pg.rows(f"SELECT count(*) FILTER (WHERE sent_at IS NULL) AS pending, count(*) AS n FROM outbox "
                         f"WHERE lower(recipient) IN ({sq(address)}, {sq(ticket)})")[0]["pending"] == 0, MAIL_WAIT_S, "outbox sent")


def test_signup_validation(app_url: str, mail: Mailpit) -> None:
    today = date_header(req(app_url, "GET", "/api/health")).date()

    def years_ago(n: int, extra_days: int = 0) -> str:
        try:
            d = today.replace(year=today.year - n)
        except ValueError:
            d = today.replace(year=today.year - n, day=28)
        return (d + dt.timedelta(days=extra_days)).isoformat()

    tag = uuid.uuid4().hex[:10]
    cases = [
        ("email", f"no-at-{tag}.example.com"), ("email", f"two{tag}@@example.com"), ("email", f"user{tag}@localhost"),
        ("email", f"user{tag}@example..com"), ("email", f"user {tag}@example.com"), ("email", f"user{tag}@example.com\n"),
        ("email", f"a\nb{tag}@example.com"), ("email", "u" * (EMAIL_MAX - 11) + "@example.com"),
        ("display_name", "   "), ("display_name", "two\nlines"), ("display_name", "bell\u0007"),
        ("display_name", "x" * (DISPLAY_NAME_MAX + 1)), ("display_name", "e\u0301" * (DISPLAY_NAME_MAX + 1)),
        ("username", "a"), ("username", "UpperCase"), ("username", "x" * (USERNAME_MAX + 1)), ("username", "bad-name"),
        ("username", "has space"),
        ("password", "p" * 7), ("password", "p" * (PASSWORD_MAX + 1)),
        ("date_of_birth", "2001-02-30"), ("date_of_birth", "01/02/2000"), ("date_of_birth", years_ago(-1)),
        ("date_of_birth", years_ago(13, 1)),
    ]
    used_emails, used_usernames = [], []
    for i, (field, value) in enumerate(cases):
        username, address = fresh(f"sv{i}")
        body = {"email": address, "display_name": "Valid Name", "username": username, "password": PASSWORD, "date_of_birth": ADULT_DOB}
        body[field] = value
        used_emails.append(address if field != "email" else value.strip().lower())
        if field != "username":
            used_usernames.append(username)
        refused(req(app_url, "POST", "/api/auth/signup", body=body), 422, "validation_failed", field)
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM members WHERE lower(email) IN ({', '.join(sq(e) for e in used_emails)}) "
                   f"OR username IN ({', '.join(sq(u) for u in used_usernames)})")[0]["n"] == 0
    username, address = fresh("svok")
    r = signup(app_url, address, username, "e\u0301" * DISPLAY_NAME_MAX, "🎮" * PASSWORD_MAX, years_ago(13))
    assert r.status_code == 201, r.text
    assert r.json()["user"]["display_name"] == "\u00e9" * DISPLAY_NAME_MAX
    assert req(app_url, "POST", "/api/auth/login", body={"email": address, "password": "🎮" * PASSWORD_MAX}).status_code == 200
    refused(req(app_url, "POST", "/api/auth/login", body={"email": address, "password": "🎮" * (PASSWORD_MAX - 1) + "🎲"}), 401, "invalid_credentials")
    for name in ("Pike, Nova", 'Zoë "Z" 🎮'):
        u, a = fresh("svn")
        assert signup(app_url, a, u, name).json()["user"]["display_name"] == name
    taken_user, taken_mail = username, address
    new_u, new_a = fresh("svt")
    refused(signup(app_url, taken_mail.upper(), new_u), 409, "conflict", "email")
    refused(signup(app_url, new_a, taken_user), 409, "conflict", "username")
    refused(signup(app_url, taken_mail, taken_user), 409, "conflict", "email")
    assert pg.rows(f"SELECT count(*) AS n FROM members WHERE lower(email) = {sq(new_a)} OR username = {sq(new_u)}")[0]["n"] == 0
    refused_addresses = set(used_emails) | {new_a}
    sent = [m for m in mail.messages(settle=MAIL_SETTLE_S) if set(a.lower() for a in addresses(m.get("To"))) & refused_addresses]
    assert sent == []


def test_wf_signup_validation_summary(browser: Browser, app_url: str) -> None:
    username, address = fresh("sum")
    with browse(browser, timezone_id="Pacific/Kiritimati") as page:
        page.clock.install(time=dt.datetime(2026, 11, 1, 11, 0, tzinfo=dt.timezone.utc))
        signups: list[str] = []
        page.on("request", lambda rq: signups.append(rq.url) if urlsplit(rq.url).path == "/api/auth/signup" else None)
        page.goto(app_url + "/register")
        fill_register(page, "not-an-email", "🎮" * DISPLAY_NAME_MAX, "AB", "🎮" * 7, "2013-11-02")
        btn(page, "Create an account").click()
        summary = page.get_by_role("alert").filter(has_text="to continue.")
        expect(summary).to_contain_text(fix_summary(4))
        links = summary.get_by_role("link")
        expect(links).to_have_text([EMAIL_ERR, USERNAME_ERR, PASSWORD_ERR, DOB_ERR])
        for label in ("Email", "Username", "Password", "Date of birth"):
            expect(page.get_by_label(label, exact=True)).to_have_attribute("aria-invalid", "true")
        expect(page.get_by_label("Display name", exact=True)).not_to_have_attribute("aria-invalid", "true")
        expect(page.get_by_label("Email", exact=True)).to_be_focused()
        links.nth(2).click()
        expect(page.get_by_label("Password", exact=True)).to_be_focused()
        links.nth(3).focus()
        page.keyboard.press("Enter")
        expect(page.get_by_label("Date of birth", exact=True)).to_be_focused()
        page.get_by_label("Email", exact=True).fill(address)
        page.get_by_label("Username", exact=True).fill(username)
        btn(page, "Create an account").click()
        expect(summary).to_contain_text(fix_summary(2))
        expect(links).to_have_text([PASSWORD_ERR, DOB_ERR])
        expect(page.get_by_label("Email", exact=True)).not_to_have_attribute("aria-invalid", "true")
        page.get_by_label("Password", exact=True).fill("🎮" * 8)
        btn(page, "Create an account").click()
        expect(summary).to_contain_text("Fix 1 field to continue.")
        expect(links).to_have_text([DOB_ERR])
        assert signups == []
        page.get_by_label("Date of birth", exact=True).fill("2013-11-01")
        btn(page, "Create an account").click()
        expect(page).to_have_url(app_url + "/servers")
        assert len(signups) == 1
    rows = Postgres().rows(f"SELECT display_name FROM members WHERE lower(email) = {sq(address)}")
    assert rows == [{"display_name": "🎮" * DISPLAY_NAME_MAX}]


def test_wf_signup_validation_account_pages(browser: Browser, app_url: str) -> None:
    m = new_member(app_url, "ap")
    username, address = fresh("apn")
    with browse(browser) as page:
        page.goto(app_url + "/settings")
        expect(page).to_have_url(f"{app_url}/login?next=%2Fsettings")
        expect(page.get_by_role("main").get_by_role("link", name="Create an account")).to_have_attribute("href", re.compile(r"next=%2Fsettings$"))
        page.get_by_label("Email", exact=True).fill(m["email"])
        page.get_by_label("Password", exact=True).fill("wrong-pass-0000")
        btn(page, "Log in").click()
        expect(page.get_by_role("alert").filter(has_text="That email and password do not match.")).to_be_visible()
        expect(page.get_by_label("Email", exact=True)).to_have_value(m["email"])
        expect(page.get_by_label("Password", exact=True)).to_have_value("")
        for label in ("Email", "Password"):
            expect(page.get_by_label(label, exact=True)).not_to_have_attribute("aria-invalid", "true")
        with held(page, "**/api/auth/login") as hold:
            page.get_by_label("Password", exact=True).fill(PASSWORD)
            page.get_by_role("button", name=re.compile(r"^Log")).click()
            expect(page.get_by_role("button", name="Logging in…")).to_be_disabled()
            hold.release()
        expect(page).to_have_url(app_url + "/settings")
        expect(page.get_by_text(f"Signed in as {m['email']}")).to_be_visible()
        expect(page.get_by_text(tier_line(FREE_TIER))).to_be_visible()
        select(page.get_by_role("combobox", name="Status"), "Idle")
        poll(lambda: req(app_url, "GET", "/api/users/@me", m["token"]).json()["status"] == "idle", 5, "status saved")
        btn(page, "Log out").click()
        expect(page).to_have_url(app_url + "/login")
        page.goto(f"{app_url}/register?next={encode_uri_component(UNSAFE_NEXT[0])}")
        fill_register(page, m["email"], "Taken Person", username, PASSWORD, ADULT_DOB)
        btn(page, "Create an account").click()
        summary = page.get_by_role("alert").filter(has_text="to continue.")
        expect(summary).to_contain_text("Fix 1 field to continue.")
        expect(summary.get_by_role("link")).to_have_text([EMAIL_TAKEN_ERR])
        email_box = page.get_by_label("Email", exact=True)
        expect(email_box).to_have_attribute("aria-invalid", "true")
        expect(email_box).to_be_focused()
        expect(page.get_by_label("Username", exact=True)).to_have_value(username)
        expect(page.get_by_label("Password", exact=True)).to_have_value("")
        email_box.fill(address)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        btn(page, "Create an account").click()
        expect(page).to_have_url(app_url + "/servers")
        for bad in (SCRIPT_NEXT, UNSAFE_NEXT[1], "/", UNSAFE_NEXT[2]):
            page.goto(app_url + "/settings")
            btn(page, "Log out").click()
            expect(page).to_have_url(app_url + "/login")
            page.goto(f"{app_url}/login?next={encode_uri_component(bad)}")
            ui_submit_login(page, address, PASSWORD)
            expect(page).to_have_url(app_url + "/servers")
    assert Postgres().rows(f"SELECT count(*) AS n FROM members WHERE lower(email) = {sq(address)}")[0]["n"] == 1


def test_tokens(app_url: str) -> None:
    m = new_member(app_url, "tok")
    for headers in ({}, {"Authorization": "Bearer forged-token-123"}, {"Authorization": "Basic abc"}):
        refused(req(app_url, "GET", "/api/users/@me", headers=headers), 401, "unauthorized", None)
    r = req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": PASSWORD})
    assert r.status_code == 200 and set(r.json()) == {"access_token", "token_type", "user"}
    second = r.json()["access_token"]
    assert req(app_url, "POST", "/api/auth/logout", second).status_code == 204
    refused(req(app_url, "GET", "/api/users/@me", second), 401, "unauthorized", None)
    refused(req(app_url, "POST", "/api/auth/logout", second), 401, "unauthorized", None)
    assert req(app_url, "GET", "/api/users/@me", m["token"]).status_code == 200
    refused(req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": "wrong-pass-0000"}), 401, "invalid_credentials", None)
    refused(req(app_url, "POST", "/api/auth/login", body={"email": f"ghost-{uuid.uuid4().hex}@example.com", "password": PASSWORD}),
            401, "invalid_credentials", None)


def test_lockout(app_url: str) -> None:
    lockout = int(os.environ.get("LOGIN_LOCKOUT_SECONDS", DEFAULT_LOCKOUT_S))
    m = new_member(app_url, "lock")
    other = new_member(app_url, "lko")
    out = together([lambda i=i: req(app_url, "POST", "/api/auth/login",
                                    body={"email": m["email"] if i % 2 else m["email"].upper(), "password": "wrong-pass-0000"}) for i in range(9)])
    assert [r.status_code for r in out].count(401) == LOCKOUT_FAILURES and [r.status_code for r in out].count(429) == 4
    for r in out:
        if r.status_code == 401:
            refused(r, 401, "invalid_credentials", None)
        else:
            refused(r, 429, "rate_limited", None)
            assert 1 <= int(r.headers["retry-after"]) <= lockout
    right = req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": PASSWORD})
    refused(right, 429, "rate_limited", None)
    assert 1 <= int(right.headers["retry-after"]) <= lockout
    refused(req(app_url, "POST", "/api/auth/login", body={"email": m["email"].upper(), "password": PASSWORD}), 429, "rate_limited")
    assert login(app_url, other["email"], PASSWORD)


def test_password_change(app_url: str, mail: Mailpit) -> None:
    m = new_member(app_url, "pw")
    t1, t2 = m["token"], login(app_url, m["email"], PASSWORD)
    path = "/api/users/@me/password"
    refused(req(app_url, "POST", path, t1, body={"current_password": "wrong-pass-0000", "new_password": NEW_PASSWORD}), 422, "validation_failed", "current_password")
    for bad in ("short", PASSWORD, "p" * (PASSWORD_MAX + 1)):
        refused(req(app_url, "POST", path, t1, body={"current_password": PASSWORD, "new_password": bad}), 422, "validation_failed", "new_password")
    assert req(app_url, "GET", "/api/users/@me", t2).status_code == 200
    t3 = login(app_url, m["email"], PASSWORD)
    assert req(app_url, "POST", path, t1, body={"current_password": PASSWORD, "new_password": "🎮" * PASSWORD_MAX}).status_code == 204
    for tok in (t2, t3):
        refused(req(app_url, "GET", "/api/users/@me", tok), 401, "unauthorized")
    assert req(app_url, "GET", "/api/users/@me", t1).status_code == 200
    refused(req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": PASSWORD}), 401, "invalid_credentials")
    assert login(app_url, m["email"], "🎮" * PASSWORD_MAX)
    notices = [x for x in mail_for(mail, m["email"], 2) if x["Subject"] == "Your Community Hub password was changed"]
    assert len(notices) == 1
    assert len(notices[0]["To"]) == 1 and notices[0]["To"][0]["Name"] == m["display_name"] and notices[0]["To"][0]["Address"].lower() == m["email"]
    n = new_member(app_url, "pwr")
    ta, tb = login(app_url, n["email"], PASSWORD), login(app_url, n["email"], PASSWORD)
    new_a, new_b = NEW_PASSWORD + "-a", NEW_PASSWORD + "-b"
    out = together([lambda: req(app_url, "POST", path, ta, body={"current_password": PASSWORD, "new_password": new_a}),
                    lambda: req(app_url, "POST", path, tb, body={"current_password": PASSWORD, "new_password": new_b})])
    assert sorted(r.status_code for r in out)[0] == 204 and [r.status_code for r in out].count(204) == 1
    loser = next(r for r in out if r.status_code != 204)
    if loser.status_code == 401:
        refused(loser, 401, "unauthorized")
    else:
        refused(loser, 422, "validation_failed", "current_password")
    winner_pw, loser_pw = (new_a, new_b) if out[0].status_code == 204 else (new_b, new_a)
    assert login(app_url, n["email"], winner_pw)
    refused(req(app_url, "POST", "/api/auth/login", body={"email": n["email"], "password": loser_pw}), 401, "invalid_credentials")
    mail_for(mail, n["email"], 2)
    assert len([x for x in mail_for(mail, n["email"], 3, seconds=MAIL_SETTLE_S * 3) if x["Subject"] == "Your Community Hub password was changed"]) == 1


def test_owner_only_changes(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    outsider = new_member(app_url, "ooc")
    for tok in (m["token"], outsider["token"]):
        for body in ({"name": "Hijacked"}, {"published": False}, {"published": True}, {"description": "mine now"}):
            refused(req(app_url, "PATCH", f"/api/servers/{com['slug']}", tok, body=body), 403, "forbidden", None)
    now = detail(app_url, com["slug"])
    assert now.status_code == 200 and now.json()["name"] == com["name"]


def test_role_rank(app_url: str) -> None:
    owner, (r_, q, p), com, ch = space(app_url, 3)
    slug, ot, rt = com["slug"], owner["token"], r_["token"]
    mods = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Mods", "permissions": ["ban_members", "manage_roles"]}).json()
    senior = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Senior", "permissions": []}).json()
    assert (mods["position"], senior["position"]) == (1, 2)
    assert req(app_url, "PUT", f"/api/servers/{slug}/members/{r_['id']}/roles/{mods['id']}", ot).status_code == 204
    assert req(app_url, "PUT", f"/api/servers/{slug}/members/{q['id']}/roles/{senior['id']}", ot).status_code == 204
    for res in (req(app_url, "PUT", f"/api/servers/{slug}/bans/{q['id']}", rt),
                req(app_url, "PUT", f"/api/servers/{slug}/members/{q['id']}/timeout", rt, body={"seconds": 60}),
                req(app_url, "PATCH", f"/api/roles/{senior['id']}", rt, body={"name": "Sr"}),
                req(app_url, "DELETE", f"/api/roles/{senior['id']}", rt),
                req(app_url, "PUT", f"/api/servers/{slug}/members/{r_['id']}/roles/{senior['id']}", rt),
                set_overwrite(app_url, rt, ch, "member", q["id"], deny=["send_messages"]),
                set_overwrite(app_url, rt, ch, "role", senior["id"], deny=["send_messages"]),
                req(app_url, "PUT", f"/api/servers/{slug}/bans/{owner['id']}", rt)):
        refused(res, 403, "forbidden", None)
    assert req(app_url, "PUT", f"/api/servers/{slug}/members/{p['id']}/timeout", rt, body={"seconds": 60}).status_code == 200
    assert set_overwrite(app_url, rt, ch, "member", p["id"], deny=["send_messages"]).status_code == 200
    helpers = req(app_url, "POST", f"/api/servers/{slug}/roles", rt, body={"name": "Helpers", "permissions": []})
    assert helpers.status_code == 201 and helpers.json()["position"] == 1
    positions = {x["name"]: x["position"] for x in roles(app_url, ot, slug)}
    assert positions == {"@everyone": 0, "Helpers": 1, "Mods": 2, "Senior": 3}
    refused(req(app_url, "POST", f"/api/servers/{slug}/roles", rt, body={"name": "Loud", "permissions": ["mention_everyone"]}), 403, "forbidden")
    assert req(app_url, "PUT", f"/api/servers/{slug}/members/{p['id']}/roles/{helpers.json()['id']}", rt).status_code == 204
    assert Postgres().rows(f"SELECT count(*) AS n FROM bans WHERE member_id = {int(q['id'])}")[0]["n"] == 0
    assert req(app_url, "DELETE", f"/api/servers/{slug}/members/{q['id']}/roles/{senior['id']}", ot).status_code == 204
    assert req(app_url, "PUT", f"/api/servers/{slug}/bans/{q['id']}", rt).status_code == 204


def test_cross_site(app_url: str) -> None:
    m = new_member(app_url, "xs")
    slug = f"xs-{uuid.uuid4().hex[:10]}"
    _, ticket = fresh("xst")
    for bad in ("https://evil.example", "null"):
        h = {"Origin": bad}
        refused(req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": PASSWORD}, headers=h), 403, "forbidden", None)
        refused(req(app_url, "PATCH", "/api/users/@me", m["token"], body={"status": "dnd"}, headers=h), 403, "forbidden", None)
        refused(req(app_url, "PATCH", "/api/users/@me", body={"status": "dnd"}, headers=h), 403, "forbidden", None)
        refused(req(app_url, "POST", "/api/servers", m["token"], body={"name": "Evil Crew", "slug": slug, "category": "music"}, headers=h), 403, "forbidden")
        refused(req(app_url, "POST", "/api/support/tickets", body={"email": ticket, "category": "other", "subject": "Evil",
                                                                   "body": "Cross-site body."}, headers=h), 403, "forbidden")
        refused(req(app_url, "DELETE", "/api/membership", m["token"], headers=h), 403, "forbidden")
        live = req(app_url, "GET", "/api/live", m["token"], headers={**h, **WS_HEADERS})
        assert live.status_code == 403
    for _ in range(LOCKOUT_FAILURES + 1):
        refused(req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": "wrong-pass-0000"},
                    headers={"Origin": "https://evil.example"}), 403, "forbidden")
    assert login(app_url, m["email"], PASSWORD)
    for good in {origin(public_url(app_url)), origin(app_url)}:
        assert req(app_url, "POST", "/api/auth/login", body={"email": m["email"], "password": PASSWORD}, headers={"Origin": good}).status_code == 200
    assert req(app_url, "GET", "/api/users/@me", m["token"]).json()["status"] == "online"
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM communities WHERE slug = {sq(slug)}")[0]["n"] == 0
    assert pg.rows(f"SELECT count(*) AS n FROM support_tickets WHERE lower(email) = {sq(ticket)}")[0]["n"] == 0
    r = req(app_url, "GET", "/api/servers", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200


def test_wf_access_ended_session(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    path = f"/channels/{com['id']}/{ch}"
    with browse(browser) as a_page, browse(browser) as b_page:
        urls: dict[str, list[str]] = {"a": [], "b": []}
        for key, pg in (("a", a_page), ("b", b_page)):
            pg.on("request", lambda rq, k=key: urls[k].append(rq.url))
            pg.on("websocket", lambda ws, k=key: urls[k].append(ws.url))
        ta = open_channel(a_page, app_url, m, com["id"], ch)
        tb = open_channel(b_page, app_url, m, com["id"], ch)
        post_msg(app_url, owner["token"], ch, BEFORE_CHANGE)
        expect(a_page.get_by_text(BEFORE_CHANGE)).to_be_visible(timeout=LIVE_MS)
        r = req(app_url, "POST", "/api/users/@me/password", tb, body={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
        assert r.status_code == 204
        expect(a_page).to_have_url(f"{app_url}/login?next={encode_uri_component(path)}", timeout=LIVE_MS)
        expect(a_page.get_by_role("alert").filter(has_text=SESSION_ENDED)).to_have_text(SESSION_ENDED)
        refused(req(app_url, "GET", "/api/users/@me", ta), 401, "unauthorized")
        post_msg(app_url, owner["token"], ch, AFTER_CHANGE)
        expect(b_page.get_by_text(AFTER_CHANGE)).to_be_visible(timeout=LIVE_MS)
        assert any("/api/live" in u for u in urls["b"])
        for tok, key in ((ta, "a"), (tb, "b")):
            assert all(tok not in u for u in urls[key])


def test_wf_access_drafts(browser: Browser, app_url: str) -> None:
    owner, (m, n), com, ch = space(app_url, 2)
    path = f"/channels/{com['id']}/{ch}"
    draft = "half a thought\n🎮"

    def storage(page: Any) -> str:
        return page.evaluate("() => JSON.stringify(Object.assign({}, sessionStorage))")

    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        composer = page.get_by_role("textbox", name=composer_name())
        composer.press_sequentially("half a thought")
        composer.press("Shift+Enter")
        composer.press_sequentially("🎮")
        poll(lambda: "half a thought" in storage(page), 5, "draft kept")
        other = login(app_url, m["email"], PASSWORD)
        assert req(app_url, "POST", "/api/users/@me/password", other, body={"current_password": PASSWORD, "new_password": NEW_PASSWORD}).status_code == 204
        expect(page).to_have_url(f"{app_url}/login?next={encode_uri_component(path)}", timeout=LIVE_MS)
        ui_submit_login(page, m["email"], NEW_PASSWORD)
        expect(page).to_have_url(app_url + path)
        composer = page.get_by_role("textbox", name=composer_name())
        poll(lambda: field_value(composer) == draft, 5, "draft restored")
        assert composer.evaluate("e => ('selectionStart' in e) ? e.selectionStart === e.value.length : true")
        assert all("half a thought" not in x["body"] for x in history(app_url, owner["token"], ch)["data"])
        other = login(app_url, m["email"], NEW_PASSWORD)
        assert req(app_url, "POST", "/api/users/@me/password", other, body={"current_password": NEW_PASSWORD, "new_password": NEW_PASSWORD + "x"}).status_code == 204
        expect(page).to_have_url(f"{app_url}/login?next={encode_uri_component(path)}", timeout=LIVE_MS)
        ui_submit_login(page, n["email"], PASSWORD)
        expect(page).to_have_url(app_url + path)
        composer = page.get_by_role("textbox", name=composer_name())
        expect(composer).to_be_visible()
        assert field_value(composer).strip() == ""
        assert "half a thought" not in storage(page)
    assert all("half a thought" not in x["body"] for x in history(app_url, owner["token"], ch)["data"])


def test_community_detail(app_url: str) -> None:
    au = aurora(app_url)
    assert set(au) == COMMUNITY_KEYS | {"channels", "me"}
    assert au["me"] is None and au["name"] == "Aurora Collective" and au["category"] == "gaming"
    assert au["verified"] is True and au["verification_level"] == "none"
    for c in au["channels"]:
        assert set(c) == {"id", "name", "category", "position", "topic", "type", "slowmode_seconds"}
    assert [(c["name"], c["type"], c["position"], c["slowmode_seconds"]) for c in au["channels"]] == [
        ("general", "text", 0, 0), ("announcements", "text", 1, 0), ("slow-lane", "text", 2, SLOWMODE_S), ("lounge", "voice", 3, 0)]
    for key in ("icon_url", "splash_url", "banner_url"):
        r = httpx.get(urljoin(app_url + "/", au[key]), timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/"), key
    listed = next(c for c in req(app_url, "GET", "/api/servers", params={"q": "Aurora Collective"}).json()["data"] if c["slug"] == "aurora-collective")
    assert (listed["member_count"], listed["presence_count"]) == (au["member_count"], au["presence_count"])
    owner, (m,), com, ch = space(app_url, 1)
    me = detail(app_url, com["slug"], m["token"]).json()["me"]
    assert me == {"role": "member", "muted": False, "communication_disabled_until": None}
    assert detail(app_url, com["slug"], owner["token"]).json()["me"]["role"] == "owner"
    assert detail(app_url, com["slug"]).json()["member_count"] == 2
    set_overwrite(app_url, owner["token"], ch, "member", m["id"], deny=["view_channel"])
    assert detail(app_url, com["slug"], m["token"]).json()["channels"] == []
    assert [c["id"] for c in detail(app_url, com["slug"]).json()["channels"]] == [ch]


def test_community_creation(app_url: str) -> None:
    owner = new_member(app_url, "cc")
    slug = f"crew-{uuid.uuid4().hex[:10]}"
    refused(req(app_url, "POST", "/api/servers", body={"name": "No Auth", "slug": slug, "category": "music"}), 401, "unauthorized")
    r = req(app_url, "POST", "/api/servers", owner["token"], body={"name": "My Crew", "slug": slug, "category": "music", "description": "hi"})
    assert r.status_code == 201
    c = r.json()
    assert COMMUNITY_KEYS <= set(c) and c["owner_id"] == owner["id"] and c["member_count"] == 1 and c["verification_level"] == "none"
    assert [(x["name"], x["type"], x["position"]) for x in c["channels"]] == [("general", "text", 0)]
    assert detail(app_url, slug).status_code == 200
    probes = []
    for body, field in (({"name": "x"}, "name"), ({"name": "x" * (COMMUNITY_NAME_MAX + 1)}, "name"), ({"slug": "ab"}, "slug"),
                        ({"slug": "Bad-Slug"}, "slug"), ({"slug": "bad--slug"}, "slug"), ({"slug": "-bad"}, "slug"),
                        ({"slug": "x" * (SLUG_MAX + 1)}, "slug"), ({"category": "all"}, "category"), ({"category": "sports"}, "category"),
                        ({"description": "d" * (DESCRIPTION_MAX + 1)}, "description")):
        full = {"name": "Valid Crew", "slug": f"p-{uuid.uuid4().hex[:10]}", "category": "music"}
        full.update(body)
        probes.append(full["slug"])
        refused(req(app_url, "POST", "/api/servers", owner["token"], body=full), 422, "validation_failed", field)
    refused(req(app_url, "POST", "/api/servers", owner["token"], body={"name": "Copy", "slug": slug, "category": "music"}), 409, "conflict", "slug")
    assert Postgres().rows(f"SELECT count(*) AS n FROM communities WHERE slug IN ({', '.join(sq(s) for s in probes)})")[0]["n"] == 0
    other = f"other-{uuid.uuid4().hex[:8]}"
    renamed = req(app_url, "PATCH", f"/api/servers/{slug}", owner["token"], body={"name": RENAMED, "slug": other})
    assert renamed.status_code == 200 and renamed.json()["slug"] == slug and renamed.json()["name"] == RENAMED
    refused(detail(app_url, other), 404, "not_found")


def test_join_leave_members(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    slug = com["slug"]
    again = join(app_url, m["token"], slug)
    assert again.status_code == 200
    assert again.json() == {"joined": True, "community_id": com["id"], "default_channel_id": ch, "role": "member"}
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM memberships WHERE member_id = {int(m['id'])} AND community_id = {int(com['id'])}")[0]["n"] == 1
    assert detail(app_url, slug).json()["member_count"] == 2
    crowd = [new_member(app_url, "crowd") for _ in range(10)]
    assert {r.status_code for r in together([lambda c=c: join(app_url, c["token"], slug) for c in crowd])} == {201}
    assert detail(app_url, slug).json()["member_count"] == 12
    one = new_member(app_url, "once")
    out = together([lambda: join(app_url, one["token"], slug) for _ in range(5)])
    assert sorted(r.status_code for r in out) == [200] * 4 + [201]
    assert pg.rows(f"SELECT count(*) AS n FROM memberships WHERE member_id = {int(one['id'])}")[0]["n"] == 1
    assert detail(app_url, slug).json()["member_count"] == 13
    assert req(app_url, "DELETE", f"/api/servers/{slug}/membership", m["token"]).status_code == 204
    assert detail(app_url, slug).json()["member_count"] == 12
    refused(req(app_url, "DELETE", f"/api/servers/{slug}/membership", m["token"]), 404, "not_found")
    refused(req(app_url, "DELETE", f"/api/servers/{slug}/membership", owner["token"]), 409, "conflict", None)
    req(app_url, "PATCH", "/api/users/@me", crowd[0]["token"], body={"status": "invisible"})
    data = req(app_url, "GET", f"/api/servers/{slug}/members", owner["token"]).json()["data"]
    assert data[0]["user"]["id"] == owner["id"] and data[0]["role"] == "owner"
    names = [e["user"]["username"] for e in data[1:]]
    assert names == sorted(names) and len(data) == 12
    status = {e["user"]["id"]: e["status"] for e in data}
    assert status[crowd[0]["id"]] == "offline" and status[crowd[1]["id"]] == "online"


def test_invites(app_url: str) -> None:
    owner, (m, m2), com, ch = space(app_url, 2)
    slug, ot = com["slug"], owner["token"]
    r = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={"max_uses": 3, "max_age_seconds": 3600})
    assert r.status_code == 201
    inv = r.json()
    assert set(inv) == INVITE_KEYS and re.fullmatch(r"[A-Za-z0-9]{8}", inv["code"])
    assert (inv["community_id"], inv["channel_id"], inv["uses"], inv["max_uses"], inv["max_age_seconds"]) == (com["id"], ch, 0, 3, 3600)
    assert set(inv["inviter"]) == PUBLIC_USER_KEYS and inv["inviter"]["id"] == owner["id"]
    assert iso(inv["expires_at"]) - iso(inv["created_at"]) == dt.timedelta(seconds=3600)
    default = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={}).json()
    assert default["max_uses"] == 0 and default["max_age_seconds"] == INVITE_DEFAULT_AGE
    assert iso(default["expires_at"]) - iso(default["created_at"]) == dt.timedelta(seconds=INVITE_DEFAULT_AGE)
    never = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={"max_age_seconds": 0}).json()
    assert never["expires_at"] is None
    for body, field in (({"max_uses": INVITE_MAX_USES + 1}, "max_uses"), ({"max_uses": -1}, "max_uses"),
                        ({"max_age_seconds": INVITE_MAX_AGE + 1}, "max_age_seconds"), ({"max_age_seconds": "soon"}, "max_age_seconds")):
        refused(req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body=body), 422, "validation_failed", field)
    preview = req(app_url, "GET", f"/api/invites/{inv['code']}").json()
    assert set(preview) == {"code", "community", "inviter", "expires_at"} and set(preview["inviter"]) == PUBLIC_USER_KEYS
    assert set(preview["community"]) == {"id", "slug", "name", "icon_url", "member_count", "presence_count"}
    before = detail(app_url, slug).json()["member_count"]
    assert preview["community"]["member_count"] == before
    newcomers = [new_member(app_url, "inv") for _ in range(8)]
    out = together([lambda p=p: req(app_url, "POST", f"/api/invites/{inv['code']}/accept", p["token"]) for p in newcomers])
    assert sorted(r.status_code for r in out) == [201] * 3 + [404] * 5
    for r in out:
        if r.status_code == 404:
            refused(r, 404, "not_found")
    pg = Postgres()
    assert pg.rows(f"SELECT uses FROM invites WHERE code = {sq(inv['code'])}") == [{"uses": 3}]
    assert detail(app_url, slug).json()["member_count"] == before + 3
    assert req(app_url, "POST", f"/api/invites/{default['code']}/accept", m["token"]).status_code == 200
    assert pg.rows(f"SELECT uses FROM invites WHERE code = {sq(default['code'])}") == [{"uses": 0}]
    banned = new_member(app_url, "invb")
    assert req(app_url, "PUT", f"/api/servers/{slug}/bans/{banned['id']}", ot).status_code == 204
    refused(req(app_url, "POST", f"/api/invites/{default['code']}/accept", banned["token"]), 403, "forbidden")
    mine = req(app_url, "POST", f"/api/servers/{slug}/invites", m["token"], body={})
    assert mine.status_code == 201
    mine = mine.json()
    listing = req(app_url, "GET", f"/api/servers/{slug}/invites", ot).json()["data"]
    assert [x["code"] for x in listing] == [default["code"], never["code"], mine["code"]]
    refused(req(app_url, "GET", f"/api/servers/{slug}/invites", m["token"]), 403, "forbidden")
    refused(req(app_url, "DELETE", f"/api/invites/{mine['code']}", m2["token"]), 403, "forbidden")
    assert req(app_url, "DELETE", f"/api/invites/{mine['code']}", m["token"]).status_code == 204
    refused(req(app_url, "GET", f"/api/invites/{mine['code']}"), 404, "not_found")
    refused(req(app_url, "POST", f"/api/invites/{mine['code']}/accept", new_member(app_url, "invr")["token"]), 404, "not_found")
    refused(req(app_url, "DELETE", f"/api/invites/{mine['code']}", m["token"]), 404, "not_found")
    everyone = next(x for x in roles(app_url, ot, slug) if x["is_default"])
    assert req(app_url, "PATCH", f"/api/roles/{everyone['id']}", ot,
               body={"permissions": ["add_reactions", "attach_files", "send_messages", "view_channel"]}).status_code == 200
    refused(req(app_url, "POST", f"/api/servers/{slug}/invites", m["token"], body={}), 403, "forbidden")
    assert req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={}).status_code == 201
    assert req(app_url, "PATCH", f"/api/servers/{slug}", ot, body={"published": False}).status_code == 200
    late = new_member(app_url, "invu")
    assert req(app_url, "GET", f"/api/invites/{never['code']}").status_code == 200
    assert req(app_url, "POST", f"/api/invites/{never['code']}/accept", late["token"]).status_code == 201
    assert detail(app_url, slug, late["token"]).status_code == 200


def test_invite_expiry(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    slug, ot = com["slug"], owner["token"]
    r = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={"max_age_seconds": INVITE_PROBE_AGE})
    inv = r.json()
    assert TIMESTAMP_RE.match(inv["created_at"]) and abs((iso(inv["created_at"]) - date_header(r)).total_seconds()) <= 1
    expires = iso(inv["expires_at"])
    assert expires - iso(inv["created_at"]) == dt.timedelta(seconds=INVITE_PROBE_AGE)
    first = req(app_url, "POST", f"/api/invites/{inv['code']}/accept", new_member(app_url, "ie")["token"])
    assert first.status_code == 201 and date_header(first) <= expires
    assert req(app_url, "POST", f"/api/invites/{inv['code']}/accept", m["token"]).status_code == 200
    seen: list[tuple[int, dt.datetime]] = []

    def expired() -> bool:
        res = req(app_url, "GET", f"/api/invites/{inv['code']}")
        seen.append((res.status_code, date_header(res)))
        return res.status_code == 404

    poll(expired, INVITE_PROBE_AGE + 5, "invite expiry")
    for status, when in seen:
        if status == 200:
            assert when <= expires
        else:
            assert status == 404 and when >= expires - dt.timedelta(seconds=1)
    refused(req(app_url, "POST", f"/api/invites/{inv['code']}/accept", m["token"]), 404, "not_found")
    refused(req(app_url, "POST", f"/api/invites/{inv['code']}/accept", new_member(app_url, "ie2")["token"]), 404, "not_found")
    pg = Postgres()
    assert pg.rows(f"SELECT uses FROM invites WHERE code = {sq(inv['code'])}") == [{"uses": 1}]
    single = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={"max_uses": 1}).json()
    taker = new_member(app_url, "ie3")
    assert req(app_url, "POST", f"/api/invites/{single['code']}/accept", taker["token"]).status_code == 201
    refused(req(app_url, "GET", f"/api/invites/{single['code']}", taker["token"]), 404, "not_found")
    refused(req(app_url, "POST", f"/api/invites/{single['code']}/accept", taker["token"]), 404, "not_found")
    race = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={}).json()
    people = [new_member(app_url, "ier") for _ in range(8)]
    revoked_at: list[float] = []

    def revoke() -> httpx.Response:
        res = req(app_url, "DELETE", f"/api/invites/{race['code']}", ot)
        revoked_at.append(time.monotonic())
        return res

    def accept(p: dict) -> tuple[httpx.Response, float]:
        started = time.monotonic()
        return req(app_url, "POST", f"/api/invites/{race['code']}/accept", p["token"]), started

    out = together([revoke] + [lambda p=p: accept(p) for p in people])
    assert out[0].status_code == 204
    for (res, started), p in zip(out[1:], people):
        assert res.status_code in (201, 404)
        if started > revoked_at[0]:
            assert res.status_code == 404
        joined = pg.rows(f"SELECT count(*) AS n FROM memberships WHERE member_id = {int(p['id'])} AND community_id = {int(com['id'])}")[0]["n"]
        assert joined == (1 if res.status_code == 201 else 0)
    refused(req(app_url, "POST", f"/api/invites/{race['code']}/accept", new_member(app_url, "ier2")["token"]), 404, "not_found")


def test_read_markers(app_url: str) -> None:
    owner, _, com, ch = space(app_url, 0)
    slug, ot = com["slug"], owner["token"]
    m = new_member(app_url, "rm")
    assert join(app_url, m["token"], slug).status_code == 201
    state = read_state(app_url, m["token"], slug, ch)
    assert set(state) == {"channel_id", "last_read_message_id", "unread_count", "mention_count"}
    assert state["last_read_message_id"] is None and state["unread_count"] == 0
    p1 = post_msg(app_url, ot, ch, "one").json()["id"]
    assert read_state(app_url, m["token"], slug, ch)["unread_count"] == 1
    post_msg(app_url, ot, ch, f"two @{m['username']}")
    s = read_state(app_url, m["token"], slug, ch)
    assert (s["unread_count"], s["mention_count"]) == (2, 1)
    own = post_msg(app_url, m["token"], ch, "mine").json()["id"]
    s = read_state(app_url, m["token"], slug, ch)
    assert (s["last_read_message_id"], s["unread_count"], s["mention_count"]) == (own, 0, 0)
    back = req(app_url, "POST", f"/api/channels/{ch}/ack", m["token"], body={"message_id": p1})
    assert back.status_code == 200 and back.json()["last_read_message_id"] == own
    p3 = post_msg(app_url, ot, ch, "three").json()["id"]
    p4 = post_msg(app_url, ot, ch, f"four @{m['username']}").json()["id"]
    s = read_state(app_url, m["token"], slug, ch)
    assert (s["unread_count"], s["mention_count"]) == (2, 1)
    acked = req(app_url, "POST", f"/api/channels/{ch}/ack", m["token"], body={"message_id": p3}).json()
    assert (acked["last_read_message_id"], acked["unread_count"], acked["mention_count"]) == (p3, 1, 1)
    req(app_url, "DELETE", f"/api/messages/{p4}", ot)
    s = read_state(app_url, m["token"], slug, ch)
    assert (s["unread_count"], s["mention_count"]) == (0, 0)
    for bad in (INT_MAX - 7, "abc"):
        refused(req(app_url, "POST", f"/api/channels/{ch}/ack", m["token"], body={"message_id": bad}), 422, "validation_failed", "message_id")
    late = new_member(app_url, "rml")
    join(app_url, late["token"], slug)
    newest = history(app_url, ot, ch)["data"][-1]["id"]
    s = read_state(app_url, late["token"], slug, ch)
    assert (s["last_read_message_id"], s["unread_count"]) == (newest, 0)


def test_online_counts(app_url: str) -> None:
    owner, (a, b), com, ch = space(app_url, 2)
    com2 = new_community(app_url, owner["token"])
    join(app_url, a["token"], com2["slug"])

    def pc(slug: str) -> int:
        return detail(app_url, slug).json()["presence_count"]

    def status(tok: str, value: str) -> None:
        assert req(app_url, "PATCH", "/api/users/@me", tok, body={"status": value}).status_code == 200

    assert (pc(com["slug"]), pc(com2["slug"])) == (3, 2)
    for value in ("idle", "dnd"):
        status(a["token"], value)
        assert pc(com["slug"]) == 3
    status(a["token"], "invisible")
    assert (pc(com["slug"]), pc(com2["slug"])) == (2, 1)
    status(a["token"], "online")
    assert (pc(com["slug"]), pc(com2["slug"])) == (3, 2)
    req(app_url, "DELETE", f"/api/servers/{com['slug']}/membership", b["token"])
    assert pc(com["slug"]) == 2
    join(app_url, b["token"], com["slug"])
    assert pc(com["slug"]) == 3
    req(app_url, "PUT", f"/api/servers/{com['slug']}/bans/{b['id']}", owner["token"])
    assert pc(com["slug"]) == 2
    crowd = [new_member(app_url, "oc") for _ in range(6)]
    together([lambda c=c: join(app_url, c["token"], com["slug"]) for c in crowd])
    assert pc(com["slug"]) == 8 and detail(app_url, com["slug"]).json()["member_count"] == 8
    together([lambda c=c: req(app_url, "PATCH", "/api/users/@me", c["token"], body={"status": "invisible"}) for c in crowd])
    assert pc(com["slug"]) == 2
    together([lambda c=c: req(app_url, "PATCH", "/api/users/@me", c["token"], body={"status": "online"}) for c in crowd])
    assert pc(com["slug"]) == 8


def test_public_users(browser: Browser, app_url: str) -> None:
    owner, (a, q), com, ch = space(app_url, 2)
    slug, ot = com["slug"], owner["token"]
    assert req(app_url, "PATCH", "/api/users/@me", q["token"], body={"status": "invisible"}).status_code == 200
    data = req(app_url, "GET", f"/api/servers/{slug}/members", a["token"]).json()["data"]
    for e in data:
        assert set(e["user"]) == PUBLIC_USER_KEYS
    status = {e["user"]["id"]: e["status"] for e in data}
    assert status[q["id"]] == "offline" and status[a["id"]] == "online"
    parent = post_msg(app_url, q["token"], ch, "from the shadows").json()["id"]
    post_msg(app_url, a["token"], ch, "seen it", reply_to_id=parent)
    for msg in history(app_url, ot, ch)["data"]:
        assert set(msg["author"]) == PUBLIC_USER_KEYS
        if msg["referenced_message"]:
            assert set(msg["referenced_message"]) == {"id", "author", "body", "edited_at"}
            assert set(msg["referenced_message"]["author"]) == PUBLIC_USER_KEYS
    inv = req(app_url, "POST", f"/api/servers/{slug}/invites", ot, body={}).json()
    assert set(inv["inviter"]) == PUBLIC_USER_KEYS
    assert set(req(app_url, "GET", f"/api/invites/{inv['code']}", a["token"]).json()["inviter"]) == PUBLIC_USER_KEYS
    entries = inbox(app_url, ot)["data"]
    assert entries and all(set(n) == NOTIFICATION_KEYS and set(n["actor"]) == PUBLIC_USER_KEYS for n in entries)
    with browse(browser) as page:
        frames = record_live(page)
        open_channel(page, app_url, owner, com["id"], ch)
        members = page.get_by_role("complementary", name="Members")
        expect(members.get_by_role("list", name=re.compile(r"^Offline")).get_by_text(q["display_name"])).to_be_visible()
        post_msg(app_url, q["token"], ch, SHADOW_TEXT)
        expect(page.get_by_text(SHADOW_TEXT)).to_be_visible(timeout=LIVE_MS)
        req(app_url, "PATCH", "/api/users/@me", q["token"], body={"status": "online"})
        expect(members.get_by_role("list", name=re.compile(r"^Online")).get_by_text(q["display_name"])).to_be_visible(timeout=LIVE_MS)
        req(app_url, "PATCH", "/api/users/@me", q["token"], body={"status": "invisible"})
        expect(members.get_by_role("list", name=re.compile(r"^Offline")).get_by_text(q["display_name"])).to_be_visible(timeout=LIVE_MS)
        payload = live_text(page, frames)
        assert SHADOW_TEXT in payload
        for secret in (q["email"], a["email"], '"invisible"', '"tier"'):
            assert secret not in payload, secret
    req(app_url, "PUT", f"/api/servers/{slug}/bans/{a['id']}", ot)
    for e in req(app_url, "GET", f"/api/servers/{slug}/bans", ot).json()["data"]:
        assert set(e["user"]) == PUBLIC_USER_KEYS


def test_wf_communities_join_open(browser: Browser, app_url: str) -> None:
    owner, _, com, ch = space(app_url, 0)
    m = new_member(app_url, "wjo")
    with browse(browser) as page:
        ui_login(page, app_url, m["email"], PASSWORD, "/servers")
        page.goto(f"{app_url}/servers/{com['slug']}")
        expect(page.get_by_role("heading", level=1)).to_have_text(com["name"])
        expect(page.get_by_role("main")).to_contain_text("general")
        expect(page.get_by_role("main")).to_contain_text(f"{1:,} Members")
        btn(page, "Join community").click()
        expect(page).to_have_url(f"{app_url}/channels/{com['id']}/{ch}")
        expect(page.get_by_role("status", name="Workspace status")).to_have_text(f"You joined {com['name']}.")
        page.goto(f"{app_url}/servers/{com['slug']}")
        expect(page.get_by_role("main")).to_contain_text(f"{2:,} Members")
        expect(btn(page, "Join community")).to_have_count(0)
        page.get_by_role("link", name="Open community", exact=True).click()
        expect(page).to_have_url(re.compile(rf"/channels/{com['id']}/\d+$"))
    users = [e["user"]["id"] for e in req(app_url, "GET", f"/api/servers/{com['slug']}/members", owner["token"]).json()["data"]]
    assert m["id"] in users and detail(app_url, com["slug"]).json()["member_count"] == 2


def test_wf_communities_presence(browser: Browser, app_url: str) -> None:
    owner, (a, q), com, ch = space(app_url, 2)
    with browse(browser) as page:
        open_channel(page, app_url, owner, com["id"], ch)
        members = page.get_by_role("complementary", name="Members")
        expect(members.get_by_role("list", name=f"Online ({3})")).to_be_visible()
        req(app_url, "PATCH", "/api/users/@me", q["token"], body={"status": "invisible"})
        expect(members.get_by_role("list", name=f"Online ({2})")).to_be_visible(timeout=LIVE_MS)
        expect(members.get_by_role("list", name=f"Offline ({1})")).to_contain_text(q["display_name"])
        req(app_url, "PATCH", "/api/users/@me", a["token"], body={"status": "idle"})
        expect(members.get_by_role("list", name=f"Online ({2})")).to_contain_text(a["display_name"])
    assert detail(app_url, com["slug"]).json()["presence_count"] == 2


def test_notifications_on_post(app_url: str) -> None:
    owner, (a, b, c), com, ch = space(app_url, 3)
    slug, ot = com["slug"], owner["token"]
    muted = req(app_url, "PATCH", f"/api/servers/{slug}/membership", b["token"], body={"muted": True})
    assert muted.status_code == 200 and muted.json() == {"muted": True}
    set_overwrite(app_url, ot, ch, "member", c["id"], deny=["view_channel"])
    plain = post_msg(app_url, ot, ch, "plain hello").json()["id"]
    assert kinds(app_url, a["token"], plain) == ["message"]
    assert kinds(app_url, b["token"], plain) == [] and kinds(app_url, c["token"], plain) == [] and kinds(app_url, ot, plain) == []
    mention = post_msg(app_url, ot, ch, f"hi @{b['username']}").json()["id"]
    assert kinds(app_url, b["token"], mention) == ["mention"] and kinds(app_url, a["token"], mention) == ["message"]
    question = post_msg(app_url, a["token"], ch, "question").json()["id"]
    answer = post_msg(app_url, ot, ch, "answer", reply_to_id=question).json()["id"]
    assert kinds(app_url, a["token"], answer) == ["reply"] and kinds(app_url, b["token"], answer) == []
    both = post_msg(app_url, ot, ch, f"@{a['username']} see this", reply_to_id=question).json()["id"]
    assert kinds(app_url, a["token"], both) == ["mention"]
    b_msg = post_msg(app_url, b["token"], ch, "muted words").json()["id"]
    to_b = post_msg(app_url, ot, ch, "reply to muted", reply_to_id=b_msg).json()["id"]
    assert kinds(app_url, b["token"], to_b) == ["reply"]
    entry = next(n for n in inbox(app_url, a["token"])["data"] if n["message_id"] == plain)
    assert (entry["channel_id"], entry["community_id"], entry["actor"]["id"]) == (ch, com["id"], owner["id"])
    assert Postgres().rows(f"SELECT count(*) AS n FROM notifications WHERE message_id = {int(plain)}")[0]["n"] == 1


def test_inbox_visibility(app_url: str) -> None:
    owner, (b,), com, ch = space(app_url, 1)
    owner_y = new_member(app_url, "vy")
    com_y = new_community(app_url, owner_y["token"])
    ch_y = com_y["channels"][0]["id"]
    join(app_url, b["token"], com_y["slug"])
    x1 = post_msg(app_url, owner["token"], ch, "x one").json()["id"]
    post_msg(app_url, owner["token"], ch, "x two")
    y1 = post_msg(app_url, owner_y["token"], ch_y, "y one").json()["id"]
    box_ = inbox(app_url, b["token"])
    ids = [n["id"] for n in box_["data"]]
    assert ids == sorted(ids, reverse=True) and box_["unread_count"] == 3 and set(box_) == {"data", "unread_count", "has_more"}
    nid = {n["message_id"]: n["id"] for n in box_["data"]}
    r = req(app_url, "POST", f"/api/notifications/{nid[x1]}/read", b["token"])
    assert r.status_code == 200 and r.json() == {"id": nid[x1], "read": True}
    unread = inbox(app_url, b["token"], unread="true")
    assert nid[x1] not in [n["id"] for n in unread["data"]] and unread["unread_count"] == 2
    post_msg(app_url, b["token"], ch, "from b")
    owners_entry = inbox(app_url, owner["token"])["data"][0]["id"]
    refused(req(app_url, "POST", f"/api/notifications/{owners_entry}/read", b["token"]), 404, "not_found")
    set_overwrite(app_url, owner_y["token"], ch_y, "member", b["id"], deny=["view_channel"])
    hidden = inbox(app_url, b["token"])
    assert nid[y1] not in [n["id"] for n in hidden["data"]] and hidden["unread_count"] == 1
    refused(req(app_url, "POST", f"/api/notifications/{nid[y1]}/read", b["token"]), 404, "not_found")
    assert req(app_url, "POST", "/api/notifications/read-all", b["token"]).json() == {"updated": 1}
    assert inbox(app_url, b["token"])["unread_count"] == 0
    req(app_url, "DELETE", f"/api/channels/{ch_y}/overwrites/member/{b['id']}", owner_y["token"])
    back = next(n for n in inbox(app_url, b["token"])["data"] if n["id"] == nid[y1])
    assert back["read"] is False and back == next(n for n in box_["data"] if n["id"] == nid[y1])
    req(app_url, "DELETE", f"/api/servers/{com_y['slug']}/membership", b["token"])
    assert nid[y1] not in [n["id"] for n in inbox(app_url, b["token"])["data"]]
    join(app_url, b["token"], com_y["slug"])
    assert inbox(app_url, b["token"])["unread_count"] == 1


def test_mention_rules(app_url: str) -> None:
    owner, (a, b), com, ch = space(app_url, 2)
    ot = owner["token"]
    code = post_msg(app_url, ot, ch, f"look `@{a['username']}` here\n```\n@{b['username']}\n```").json()
    assert code["mentions"] == [] and kinds(app_url, a["token"], code["id"]) == ["message"]
    plain_everyone = post_msg(app_url, a["token"], ch, "@everyone hi").json()
    assert plain_everyone["mentions"] == [] and kinds(app_url, b["token"], plain_everyone["id"]) == ["message"]
    loud = post_msg(app_url, ot, ch, "@everyone go").json()
    assert loud["mentions"] == sorted([a["id"], b["id"]]) and kinds(app_url, b["token"], loud["id"]) == ["mention"]
    req(app_url, "PATCH", "/api/users/@me", b["token"], body={"status": "idle"})
    here = post_msg(app_url, ot, ch, "@here now").json()
    assert here["mentions"] == [a["id"]] and kinds(app_url, b["token"], here["id"]) == ["message"]
    assert post_msg(app_url, ot, ch, f"me @{owner['username']}").json()["mentions"] == []
    parent = post_msg(app_url, a["token"], ch, "parent").json()["id"]
    reply = post_msg(app_url, b["token"], ch, "child", reply_to_id=parent).json()["id"]
    assert kinds(app_url, a["token"], reply) == ["reply"]
    msg = post_msg(app_url, ot, ch, f"hey @{a['username']}").json()["id"]
    assert kinds(app_url, a["token"], msg) == ["mention"]
    edited = req(app_url, "PATCH", f"/api/messages/{msg}", ot, body={"body": f"hey @{b['username']}"}).json()
    assert edited["mentions"] == [b["id"]]
    assert sorted(kinds(app_url, b["token"], msg)) == ["mention", "message"]
    assert kinds(app_url, a["token"], msg) == ["mention"]
    again = req(app_url, "PATCH", f"/api/messages/{msg}", ot, body={"body": f"hey @{a['username']} @{b['username']}"}).json()
    assert again["mentions"] == sorted([a["id"], b["id"]])
    assert kinds(app_url, a["token"], msg) == ["mention"]
    assert sorted(kinds(app_url, b["token"], msg)) == ["mention", "message"]


def test_hidden_channels_never_notify(app_url: str) -> None:
    owner, (a, c), com, ch = space(app_url, 2)
    slug, ot = com["slug"], owner["token"]
    set_overwrite(app_url, ot, ch, "member", c["id"], deny=["view_channel"])
    blind = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Blind", "permissions": []}).json()
    req(app_url, "PUT", f"/api/servers/{slug}/members/{a['id']}/roles/{blind['id']}", ot)
    set_overwrite(app_url, ot, ch, "role", blind["id"], deny=["view_channel"])
    msgs = [post_msg(app_url, ot, ch, body).json() for body in (f"@{c['username']} @{a['username']} hello", "@everyone all", "@here now", "plain")]
    edited = req(app_url, "PATCH", f"/api/messages/{msgs[3]['id']}", ot, body={"body": f"plain @{c['username']}"}).json()
    for msg in msgs[:3] + [edited]:
        assert c["id"] not in msg["mentions"] and a["id"] not in msg["mentions"]
    req(app_url, "DELETE", f"/api/channels/{ch}/overwrites/member/{c['id']}", ot)
    req(app_url, "DELETE", f"/api/channels/{ch}/overwrites/role/{blind['id']}", ot)
    for who in (a, c):
        assert all(kinds(app_url, who["token"], m["id"]) == [] for m in msgs)


def test_deleted_leave_inbox(app_url: str) -> None:
    owner, (b, c), com, ch = space(app_url, 2)
    m1 = post_msg(app_url, owner["token"], ch, f"@{b['username']} one").json()["id"]
    post_msg(app_url, owner["token"], ch, "two")
    before = inbox(app_url, b["token"])["unread_count"]
    nid = next(n["id"] for n in inbox(app_url, b["token"])["data"] if n["message_id"] == m1)
    assert kinds(app_url, c["token"], m1) == ["message"]
    assert req(app_url, "DELETE", f"/api/messages/{m1}", owner["token"]).status_code == 204
    after = inbox(app_url, b["token"])
    assert m1 not in [n["message_id"] for n in after["data"]] and after["unread_count"] == before - 1
    assert kinds(app_url, c["token"], m1) == []
    refused(req(app_url, "POST", f"/api/notifications/{nid}/read", b["token"]), 404, "not_found")
    assert req(app_url, "POST", "/api/notifications/read-all", b["token"]).json() == {"updated": before - 1}


def test_notification_paging(app_url: str) -> None:
    owner_x, (b,), com_x, ch_x = space(app_url, 1)
    owner_y = new_member(app_url, "py")
    com_y = new_community(app_url, owner_y["token"])
    ch_y = com_y["channels"][0]["id"]
    assert join(app_url, b["token"], com_y["slug"]).status_code == 201
    for i in range(8):
        post_msg(app_url, owner_x["token"], ch_x, f"page x {i}")
        if i % 2:
            post_msg(app_url, owner_y["token"], ch_y, f"page y {i}")
    everything = [n["id"] for n in inbox(app_url, b["token"], limit=NOTIF_LIMIT_MAX)["data"]]
    assert len(everything) == 12 and everything == sorted(everything, reverse=True)
    first = inbox(app_url, b["token"], limit=5)
    assert [n["id"] for n in first["data"]] == everything[:5] and first["has_more"] is True
    for i in range(2):
        post_msg(app_url, owner_x["token"], ch_x, f"arriving {i}")
    second = inbox(app_url, b["token"], limit=5, before=first["data"][-1]["id"])
    assert [n["id"] for n in second["data"]] == everything[5:10] and second["has_more"] is True
    third = inbox(app_url, b["token"], limit=5, before=second["data"][-1]["id"])
    assert [n["id"] for n in third["data"]] == everything[10:] and third["has_more"] is False
    walked = [n["id"] for page in (first, second, third) for n in page["data"]]
    assert len(walked) == len(set(walked)) == 12
    now = [n["id"] for n in inbox(app_url, b["token"], limit=NOTIF_LIMIT_MAX)["data"]]
    unread = inbox(app_url, b["token"], unread="true", limit=5)
    assert [n["id"] for n in unread["data"]] == now[:5] and unread["unread_count"] == 14
    req(app_url, "POST", f"/api/notifications/{now[0]}/read", b["token"])
    unread = inbox(app_url, b["token"], unread="true", limit=5)
    assert [n["id"] for n in unread["data"]] == now[1:6] and unread["unread_count"] == 13
    assert set_overwrite(app_url, owner_y["token"], ch_y, "member", b["id"], deny=["view_channel"]).status_code == 200
    all_visible = [n["id"] for n in inbox(app_url, b["token"], limit=NOTIF_LIMIT_MAX)["data"]]
    assert len(all_visible) == 10
    p1 = inbox(app_url, b["token"], limit=5)
    p2 = inbox(app_url, b["token"], limit=5, before=p1["data"][-1]["id"])
    assert [n["id"] for n in p1["data"]] == all_visible[:5] and p1["has_more"] is True
    assert [n["id"] for n in p2["data"]] == all_visible[5:] and p2["has_more"] is False
    assert inbox(app_url, b["token"])["unread_count"] == 9
    hidden_id = Postgres().rows(f"SELECT id AS i FROM notifications WHERE recipient_id = {int(b['id'])} "
                                f"AND community_id = {int(com_y['id'])} ORDER BY id DESC")[0]["i"]
    cursor_page = inbox(app_url, b["token"], limit=5, before=hidden_id)
    expected = [i for i in all_visible if i < hidden_id][:5]
    assert [n["id"] for n in cursor_page["data"]] == expected
    for params, field in (({"limit": NOTIF_LIMIT_MAX + 1}, "limit"), ({"limit": 0}, "limit"),
                          ({"before": 0}, "before"), ({"before": "abc"}, "before")):
        refused(req(app_url, "GET", "/api/notifications", b["token"], params=params), 422, "validation_failed", field)


def test_wf_notifications_inbox_in_place(browser: Browser, app_url: str) -> None:
    owner_x, (b,), com_x, ch_x = space(app_url, 1)
    owner_y = new_member(app_url, "iy")
    com_y = new_community(app_url, owner_y["token"])
    ch_y = com_y["channels"][0]["id"]
    assert join(app_url, b["token"], com_y["slug"]).status_code == 201
    xs = [post_msg(app_url, owner_x["token"], ch_x, f"in place {i}").json()["id"] for i in range(22)]
    for i in range(2):
        post_msg(app_url, owner_y["token"], ch_y, f"y side {i}")
    total = inbox(app_url, b["token"])["unread_count"]
    with browse(browser) as page:
        open_channel(page, app_url, b, com_x["id"], ch_x)
        page.get_by_role("button", name=re.compile(r"^Notifications")).click()
        region = page.get_by_role("region", name="Notifications")
        items = region.get_by_role("listitem")
        expect(items).to_have_count(NOTIF_PAGE)
        older = btn(page, "Show older notifications")
        older.click()
        expect(items).to_have_count(total)
        expect(older).to_have_count(0)
        focused = page.evaluate_handle("() => document.activeElement")
        post_msg(app_url, owner_x["token"], ch_x, f"look @{b['username']}")
        expect(items).to_have_count(total + 1, timeout=LIVE_MS)
        expect(items.first).to_contain_text(owner_x["display_name"])
        expect(page.get_by_role("button", name=f"Notifications, {total + 1} unread")).to_be_visible(timeout=LIVE_MS)
        assert req(app_url, "DELETE", f"/api/messages/{xs[0]}", owner_x["token"]).status_code == 204
        expect(items).to_have_count(total, timeout=LIVE_MS)
        assert set_overwrite(app_url, owner_y["token"], ch_y, "member", b["id"], deny=["view_channel"]).status_code == 200
        expect(items).to_have_count(total - 2, timeout=LIVE_MS)
        expect(page.get_by_role("button", name=f"Notifications, {total - 2} unread")).to_be_visible(timeout=LIVE_MS)
        assert page.evaluate("h => document.activeElement === h", focused)
    assert inbox(app_url, b["token"])["unread_count"] == total - 2


def test_wf_notifications_mark_read(browser: Browser, app_url: str) -> None:
    owner, (b,), com, ch = space(app_url, 1)
    for i in range(2):
        post_msg(app_url, owner["token"], ch, f"read me {i}")
    with browse(browser) as page:
        ui_login(page, app_url, b["email"], PASSWORD, "/servers")
        page.goto(f"{app_url}/channels/{com['id']}/{ch}")
        page.get_by_role("button", name=re.compile(r"^Notifications, \d+ unread$")).click()
        region = page.get_by_role("region", name="Notifications")
        newest = inbox(app_url, b["token"])["data"][0]
        region.get_by_role("listitem").first.click()
        expect(page).to_have_url(f"{app_url}/channels/{newest['community_id']}/{newest['channel_id']}")
        poll(lambda: next(n for n in inbox(app_url, b["token"])["data"] if n["id"] == newest["id"])["read"], 5, "entry read")
        if not btn(page, "Mark all as read").is_visible():
            page.get_by_role("button", name=re.compile(r"^Notifications")).click()
        btn(page, "Mark all as read").click()
        expect(page.get_by_role("button", name="Notifications", exact=True)).to_be_visible(timeout=LIVE_MS)
    assert inbox(app_url, b["token"])["unread_count"] == 0


@contextlib.contextmanager
def ronin_unpublished(base: str) -> Iterator[str]:
    tok = login(base, "member.ronin@example.com", SEED_PW)
    assert req(base, "PATCH", "/api/servers/ronin-guild", tok, body={"published": False}).status_code == 200
    try:
        yield tok
    finally:
        req(base, "PATCH", "/api/servers/ronin-guild", tok, body={"published": True})


def test_trending_weeks(app_url: str) -> None:
    r = req(app_url, "GET", "/api/trending-games").json()
    assert (r["week_date"], r["prev_week_date"], r["next_week_date"]) == (SEED_WEEKS[0], SEED_WEEKS[1], None)
    assert [g["slug"] for g in r["games"]] == ["nova-drift", "ronin-tactics", "echo-gardens", "tidal-rally", "lumen-siege"]
    assert [g["rank"] for g in r["games"]] == [1, 2, 3, 4, 5]
    nova = r["games"][0]
    assert nova["plays_change_pct"] == 42 and nova["streams_change_pct"] == 18 and nova["name"] == "Nova Drift Arena"
    assert set(nova["categories"]) == {"shooter", "adventure"}
    assert {g["week_streak"] for g in r["games"]} == {3}
    mid = req(app_url, "GET", "/api/trending-games", params={"week": SEED_WEEKS[1]}).json()
    assert mid["prev_week_date"] == SEED_WEEKS[2] and mid["next_week_date"] == SEED_WEEKS[0]
    assert [g["slug"] for g in mid["games"]][:3] == ["ronin-tactics", "nova-drift", "tidal-rally"] and {g["week_streak"] for g in mid["games"]} == {2}
    old = req(app_url, "GET", "/api/trending-games", params={"week": SEED_WEEKS[2]}).json()
    assert old["prev_week_date"] is None and old["games"][0]["slug"] == "echo-gardens" and {g["week_streak"] for g in old["games"]} == {1}
    rpg = req(app_url, "GET", "/api/trending-games", params={"category": "rpg"}).json()["games"]
    assert [(g["slug"], g["rank"]) for g in rpg] == [("ronin-tactics", 2), ("lumen-siege", 5)]
    for week in ("2026-13-01", "2026-10-1", "2026-02-30", "soon"):
        refused(req(app_url, "GET", "/api/trending-games", params={"week": week}), 422, "validation_failed", "week")
    refused(req(app_url, "GET", "/api/trending-games", params={"category": "racing"}), 422, "validation_failed", "category")
    refused(req(app_url, "GET", "/api/trending-games", params={"week": NO_LIST_WEEK}), 404, "not_found")
    game = req(app_url, "GET", "/api/games/nova-drift").json()
    assert game["rank"] == 1 and game["week_streak"] == 3
    assert [(h["week_date"], h["rank"]) for h in game["history"]] == [(SEED_WEEKS[0], 1), (SEED_WEEKS[1], 2), (SEED_WEEKS[2], 3)]
    refused(req(app_url, "GET", "/api/games/unknown-game"), 404, "not_found")


def test_trending_live_counts(app_url: str) -> None:
    def ronin_count(token: str | None = None) -> int:
        games = req(app_url, "GET", "/api/trending-games", token).json()["games"]
        return next(g for g in games if g["slug"] == "ronin-tactics")["community"]["member_count"]

    start = ronin_count()
    assert start == detail(app_url, "ronin-guild").json()["member_count"]
    m = new_member(app_url, "rgj")
    assert join(app_url, m["token"], "ronin-guild").status_code == 201
    assert ronin_count() == start + 1
    assert req(app_url, "GET", "/api/games/lumen-siege").json()["community"]["member_count"] == start + 1
    outsider = new_member(app_url, "rgo")
    with ronin_unpublished(app_url):
        for tok in (None, outsider["token"]):
            games = req(app_url, "GET", "/api/trending-games", tok).json()["games"]
            assert next(g for g in games if g["slug"] == "ronin-tactics")["community"] is None
            assert req(app_url, "GET", "/api/games/ronin-tactics", tok).json()["community"] is None
        assert ronin_count(m["token"]) == start + 1
        assert req(app_url, "GET", "/api/games/ronin-tactics", m["token"]).json()["community"]["slug"] == "ronin-guild"
    assert req(app_url, "DELETE", "/api/servers/ronin-guild/membership", m["token"]).status_code == 204
    assert ronin_count() == start


def test_per_caller_answers(app_url: str) -> None:
    m = new_member(app_url, "pca")
    outsider = new_member(app_url, "pco")
    assert join(app_url, m["token"], "ronin-guild").status_code == 201
    for r in (req(app_url, "GET", "/api/trending-games"), req(app_url, "GET", "/api/servers/nope-x"),
              req(app_url, "GET", "/api/users/@me"), req(app_url, "GET", "/api/users/@me", m["token"])):
        assert "no-store" in r.headers.get("cache-control", "")
        assert "Authorization".lower() in r.headers.get("vary", "").lower()
    with ronin_unpublished(app_url):
        calls, kinds_ = [], []
        for i in range(24):
            tok = m["token"] if i % 2 == 0 else (None if i % 4 == 1 else outsider["token"])
            path = ("/api/trending-games", "/api/games/ronin-tactics", "/api/servers/ronin-guild")[i % 3]
            calls.append(lambda p=path, t=tok: (p, t, req(app_url, "GET", p, t)))
            kinds_.append(tok == m["token"])
        for (path, tok, r), is_member in zip(together(calls), kinds_):
            if path == "/api/servers/ronin-guild":
                assert r.status_code == (200 if is_member else 404)
            else:
                body = r.json()
                game = next(g for g in body["games"] if g["slug"] == "ronin-tactics") if "games" in body else body
                assert (game["community"] is not None) == is_member
    req(app_url, "DELETE", "/api/servers/ronin-guild/membership", m["token"])


def test_wf_trending_address_history(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        page.goto(app_url + "/trending-games")
        expect(page.get_by_role("heading", level=1)).to_have_text("TRENDING GAMES")
        week = page.get_by_role("group", name="Week")
        expect(week).to_contain_text(week_label(SEED_WEEKS[0]))
        expect(btn(page, "Next week")).to_be_disabled()
        featured = page.get_by_role("article", name="Featured game")
        expect(featured.get_by_role("link", name="Nova Drift Arena")).to_have_attribute("href", re.compile(re.escape(f"/game/{GAMES[0]}") + "$"))
        expect(featured).to_contain_text("+42%")
        expect(page.get_by_role("list", name="Ranked games").get_by_role("listitem")).to_have_count(4)
        btn(page, "Previous week").click()
        expect(week).to_contain_text(week_label(SEED_WEEKS[1]))
        assert qs(page.url) == {"week": SEED_WEEKS[1]}
        btn(page, "RPG").click()
        expect(btn(page, "RPG")).to_have_attribute("aria-pressed", "true")
        poll(lambda: qs(page.url).get("category") == "rpg", 5, "category in address")
        assert qs(page.url) == {"week": SEED_WEEKS[1], "category": "rpg"}
        expect(featured.get_by_role("link", name="Ronin Tactics")).to_be_visible()
        page.reload()
        expect(week).to_contain_text(week_label(SEED_WEEKS[1]))
        expect(btn(page, "RPG")).to_have_attribute("aria-pressed", "true")
        page.go_back()
        expect(btn(page, "All")).to_have_attribute("aria-pressed", "true")
        expect(week).to_contain_text(week_label(SEED_WEEKS[1]))
        page.go_back()
        expect(week).to_contain_text(week_label(SEED_WEEKS[0]))
        assert urlsplit(page.url).query == ""
        page.go_forward()
        expect(week).to_contain_text(week_label(SEED_WEEKS[1]))
        page.goto(app_url + "/trending-games?week=2026-13-45")
        expect(page).to_have_url(app_url + "/trending-games")
        expect(week).to_contain_text(week_label(SEED_WEEKS[0]))
        page.goto(app_url + "/game/nova-drift")
        expect(page.get_by_role("heading", level=1)).to_have_text("Nova Drift Arena")
        rows = page.get_by_role("table", name="Weekly history").get_by_role("row")
        expect(rows).to_have_count(4)
        expect(rows.nth(1)).to_contain_text(week_label(SEED_WEEKS[0]))
        expect(page.get_by_role("link", name=f"Join {AURORA_NAME}")).to_have_attribute("href", re.compile(re.escape("/servers/aurora-collective") + "$"))
    assert req(app_url, "GET", "/api/games/nova-drift").json()["history"][0]["week_date"] == SEED_WEEKS[0]


def test_wf_trending_latest_wins(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        stash: list[Any] = []

        def handler(route: Any) -> None:
            q = qs(route.request.url)
            if q.get("week") == SEED_WEEKS[1] and q.get("category", "all") == "all" and not stash:
                stash.append(route)
                return
            route.continue_()

        page.route(re.compile(r"/api/trending-games"), handler)
        page.goto(app_url + "/trending-games")
        expect(page.get_by_role("group", name="Week")).to_contain_text(week_label(SEED_WEEKS[0]))
        btn(page, "Previous week").click()
        poll(lambda: stash, 5, "held week request")
        btn(page, "Shooter").click()
        expect(btn(page, "Shooter")).to_have_attribute("aria-pressed", "true")
        poll(lambda: qs(page.url).get("category") == "shooter", 5, "category in address")
        release(stash[0])
        expect(btn(page, "Shooter")).to_have_attribute("aria-pressed", "true")
        assert qs(page.url) == {"week": SEED_WEEKS[1], "category": "shooter"}
        expect(page.get_by_role("group", name="Week")).to_contain_text(week_label(SEED_WEEKS[1]))
        expect(page.get_by_role("article", name="Featured game").get_by_role("link", name="Nova Drift Arena")).to_be_visible()
        expect(page.get_by_role("list", name="Ranked games").get_by_role("listitem")).to_have_count(0)
    api = req(app_url, "GET", "/api/trending-games", params={"week": SEED_WEEKS[1], "category": "shooter"}).json()
    assert [g["slug"] for g in api["games"]] == ["nova-drift"]


def test_wf_trending_time_zones(browser: Browser, app_url: str) -> None:
    api = req(app_url, "GET", "/api/games/nova-drift").json()
    for zone in ("Pacific/Honolulu", "Pacific/Kiritimati"):
        with browse(browser, timezone_id=zone) as page:
            page.goto(f"{app_url}/trending-games?week={SEED_WEEKS[1]}")
            expect(page.get_by_role("group", name="Week")).to_contain_text("Week of October 12, 2026")
            page.goto(app_url + "/game/nova-drift")
            rows = page.get_by_role("table", name="Weekly history").get_by_role("row")
            for i, h in enumerate(api["history"], start=1):
                expect(rows.nth(i)).to_contain_text(week_label(h["week_date"]))


def test_wf_trending_switch_member(browser: Browser, app_url: str) -> None:
    m = new_member(app_url, "swm")
    n = new_member(app_url, "swn")
    assert join(app_url, m["token"], "ronin-guild").status_code == 201
    try:
        with ronin_unpublished(app_url), browse(browser) as page:
            ui_login(page, app_url, m["email"], PASSWORD, "/game/ronin-tactics")
            expect(page.get_by_role("link", name=f"Join {RONIN_NAME}")).to_be_visible()
            page.goto(app_url + "/settings")
            btn(page, "Log out").click()
            expect(page).to_have_url(f"{app_url}/login")
            ui_submit_login(page, n["email"], PASSWORD)
            expect(page).to_have_url(f"{app_url}/servers")
            page.get_by_role("navigation", name="Primary").get_by_role("link", name="Trending", exact=True).click()
            page.get_by_role("list", name="Ranked games").get_by_role("link", name="Ronin Tactics").click()
            expect(page.get_by_role("heading", level=1)).to_have_text("Ronin Tactics")
            expect(page.get_by_text("Community not available.")).to_be_visible()
            expect(page.get_by_role("link", name=f"Join {RONIN_NAME}")).to_have_count(0)
            assert req(app_url, "GET", "/api/games/ronin-tactics", n["token"]).json()["community"] is None
    finally:
        req(app_url, "DELETE", "/api/servers/ronin-guild/membership", m["token"])


def test_safety_support_pageview(app_url: str, mail: Mailpit) -> None:
    data = req(app_url, "GET", "/api/safety/articles", params={"q": "BLOCKING"}).json()["data"]
    assert [a["slug"] for a in data] == ["reporting-and-blocking"] and data[0]["title"] == "Reporting and blocking"
    assert set(data[0]) == {"slug", "title", "category", "topic", "summary"}
    tools = req(app_url, "GET", "/api/safety/articles", params={"category": "tools", "topic": "moderation"}).json()["data"]
    assert "reporting-and-blocking" in [a["slug"] for a in tools] and all(a["category"].lower() == "tools" for a in tools)
    assert req(app_url, "GET", "/api/safety/articles", params={"q": "b" * ARTICLE_Q_MAX}).status_code == 200
    refused(req(app_url, "GET", "/api/safety/articles", params={"q": "b" * (ARTICLE_Q_MAX + 1)}), 422, "validation_failed", "q")
    _, address = fresh("ticket")
    r = req(app_url, "POST", "/api/support/tickets", body={"email": address, "category": "billing", "subject": "Card help", "body": "My card needs help please."})
    assert r.status_code == 201
    t = r.json()
    assert t["status"] == "open" and t["reference"] == f"HUB-{t['id']:06d}"
    found = mail_for(mail, address, 1)
    assert len(found) == 1 and found[0]["Subject"] == f"We received your request {t['reference']}"
    _, bad_mail = fresh("badticket")
    for body, field in (({"category": "gold"}, "category"), ({"category": ""}, "category"), ({"subject": "ab"}, "subject"),
                        ({"body": "too short"}, "body"), ({"email": "not-an-email"}, "email")):
        full = {"email": bad_mail, "category": "other", "subject": "Valid subject", "body": "A valid description."}
        full.update(body)
        refused(req(app_url, "POST", "/api/support/tickets", body=full), 422, "validation_failed", field)
    assert Postgres().rows(f"SELECT count(*) AS n FROM support_tickets WHERE lower(email) = {sq(bad_mail)}")[0]["n"] == 0
    assert mail_for(mail, bad_mail, 0, seconds=0) == []
    visitor = f"visitor-{uuid.uuid4().hex}"
    assert req(app_url, "POST", "/api/analytics/pageview", body={"path": "/safety", "visitor_id": visitor}).status_code == 204
    assert Postgres().rows(f"SELECT path FROM page_views WHERE visitor_id = {sq(visitor)}") == [{"path": "/safety"}]


def test_support_limit(app_url: str, mail: Mailpit) -> None:
    window = int(os.environ.get("SUPPORT_WINDOW_SECONDS", DEFAULT_SUPPORT_WINDOW_S))
    _, address = fresh("limit")
    bodies = [{"email": address if i % 2 else address.upper(), "category": "other", "subject": f"Burst {i}", "body": "Burst request body."} for i in range(8)]
    out = together([lambda b=b: req(app_url, "POST", "/api/support/tickets", body=b) for b in bodies])
    ok = [r for r in out if r.status_code == 201]
    assert len(ok) == SUPPORT_LIMIT and len({r.json()["reference"] for r in ok}) == SUPPORT_LIMIT
    for r in out:
        if r.status_code != 201:
            refused(r, 429, "rate_limited", None)
            assert 1 <= int(r.headers["retry-after"]) <= window
    late = req(app_url, "POST", "/api/support/tickets", body={**bodies[0], "subject": "x"})
    refused(late, 429, "rate_limited")
    assert Postgres().rows(f"SELECT count(*) AS n FROM support_tickets WHERE lower(email) = {sq(address)}")[0]["n"] == SUPPORT_LIMIT
    assert len(mail_for(mail, address, SUPPORT_LIMIT + 1, seconds=MAIL_WAIT_S / 3)) == SUPPORT_LIMIT


def test_wf_consent_support_request(browser: Browser, app_url: str) -> None:
    _, address = fresh("form")
    with browse(browser) as page:
        page.clock.install()
        page.goto(app_url + "/")
        footer = page.get_by_role("contentinfo")
        expect(footer.get_by_role("link", name="Help Center")).to_have_attribute("href", re.compile(r"/support$"))
        for name in ("Send feedback", "Submit a request"):
            expect(footer.get_by_role("link", name=name)).to_have_attribute("href", re.compile(r"/support/new$"))
        expect(footer.get_by_role("button", name="Cookie preferences")).to_be_visible()
        btn(page, "Reject optional").click()
        expect(page.get_by_role("dialog", name="Cookie preferences")).to_be_hidden()
        footer.get_by_role("link", name="Submit a request").click()
        expect(page).to_have_url(f"{app_url}/support/new")
        status = page.get_by_role("status", name="Request status")
        expect(status).to_have_text("")
        handle = status.element_handle()
        page.get_by_role("textbox", name="Email").focus()
        assert tab_order(page, 4) == ["Category", "Subject", "Description", "Submit request"]
        page.get_by_role("textbox", name="Email").fill(address)
        page.get_by_role("textbox", name="Subject").fill(REQUEST_SUBJECT)
        page.get_by_role("textbox", name="Description").fill(DESC_FIRST)
        page.get_by_role("textbox", name="Description").press("Enter")
        page.get_by_role("textbox", name="Description").press_sequentially(LINE_TWO)
        page.get_by_role("textbox", name="Subject").press("Enter")
        category = page.get_by_role("combobox", name="Category")
        expect(category).to_have_attribute("aria-invalid", "true")
        expect(category).to_be_focused()
        expect(page.get_by_text("Choose a category.")).to_be_visible()
        expect(page.get_by_role("textbox", name="Description")).to_have_value(DESC_FIRST + "\n" + LINE_TWO)
        category.press("ArrowDown")
        page.get_by_role("textbox", name="Subject").press("Enter")
        expect(status).to_have_text(re.compile(r"^Request received\. Your reference is HUB-\d{6}\.$"))
        reference = re.search(r"HUB-\d{6}", status.inner_text()).group(0)
        page.clock.run_for(TEN_MINUTES_MS)
        assert handle.evaluate("e => e.isConnected && e.textContent.trim()") == f"Request received. Your reference is {reference}."
        rows = Postgres().rows(f"SELECT reference FROM support_tickets WHERE lower(email) = {sq(address)}")
        assert {"reference": reference} in rows
        for _ in range(SUPPORT_LIMIT - 1):
            btn(page, "Submit request").press("Space")
            expect(status).to_have_text(re.compile(r"Request received"))
        btn(page, "Submit request").press("Enter")
        expect(status).to_have_text("Too many requests from this email. Try again later.")
        expect(page.get_by_role("textbox", name="Subject")).to_have_value(REQUEST_SUBJECT)
        assert handle.evaluate("e => e.isConnected")
    assert Postgres().rows(f"SELECT count(*) AS n FROM support_tickets WHERE lower(email) = {sq(address)}")[0]["n"] == SUPPORT_LIMIT


def test_wf_consent_support_cookies(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        page.clock.install()
        views: list[str] = []
        page.on("request", lambda rq: views.append(rq.url) if "/api/analytics/pageview" in rq.url else None)
        page.goto(app_url + "/")
        dialog = page.get_by_role("dialog", name="Cookie preferences")
        expect(dialog).to_be_visible()
        assert not dialog.evaluate("d => d.contains(document.activeElement)")
        expect(dialog.get_by_role("checkbox", name="Necessary")).to_be_checked()
        expect(dialog.get_by_role("checkbox", name="Necessary")).to_be_disabled()
        status = page.get_by_role("status", name="Cookie status")
        expect(status).to_have_text("")
        handle = status.element_handle()
        btn(page, "Reject optional").click()
        expect(status).to_have_text("Cookie preferences saved.")
        expect(page.get_by_role("link", name="Skip to main content")).to_be_focused()

        def cookie(name: str) -> dict | None:
            return next((c for c in page.context.cookies() if c["name"] == name), None)

        consent = cookie("hub_consent")
        assert consent and consent["value"] == consent_value(0, 0) and consent["path"] == "/"
        page_now = page.evaluate("() => Date.now() / 1000")
        assert consent["expires"] - page_now >= CONSENT_MIN_DAYS * 86400
        assert cookie("hub_aid") is None and cookie("hub_mkt") is None and views == []
        opener = btn(page, "Cookie preferences")
        opener.focus()
        page.keyboard.press("Enter")
        analytics = page.get_by_role("checkbox", name="Analytics")
        expect(analytics).to_be_focused()
        page.keyboard.press("Space")
        expect(analytics).to_be_checked()
        page.keyboard.press("Escape")
        assert_unavailable(page.get_by_role("checkbox", name="Analytics", include_hidden=True))
        expect(opener).to_be_focused()
        assert cookie("hub_consent")["value"] == consent_value(0, 0)
        assert handle.evaluate("e => e.isConnected && e.textContent.trim()") == "Cookie preferences saved."
        opener.press("Enter")
        expect(analytics).not_to_be_checked()
        page.keyboard.press("Space")
        btn(page, "Save choices").click()
        expect(opener).to_be_focused()
        assert cookie("hub_consent")["value"] == consent_value(1, 0)
        page.goto(app_url + "/servers")
        aid = poll(lambda: cookie("hub_aid"), 5, "analytics id")["value"]
        assert cookie("hub_mkt") is None
        poll(lambda: Postgres().rows(f"SELECT count(*) AS n FROM page_views WHERE visitor_id = {sq(aid)}")[0]["n"] > 0, 10, "page view stored")
        select(page.get_by_role("combobox", name="Language"), "Deutsch")
        poll(lambda: page.evaluate("() => document.documentElement.lang") == "de-DE", 5, "lang")
        page.goto(app_url + "/trending-games")
        assert page.evaluate("() => document.documentElement.lang") == "de-DE"
        status = page.get_by_role("status", name="Cookie status")
        opener = btn(page, "Cookie preferences")
        opener.click()
        btn(page, "Accept all").click()
        expect(status).to_have_text("Cookie preferences saved.")
        handle = status.element_handle()
        page.clock.run_for(TEN_MINUTES_MS)
        assert handle.evaluate("e => e.isConnected && e.textContent.trim()") == "Cookie preferences saved."
        assert cookie("hub_consent")["value"] == consent_value(1, 1)
        poll(lambda: cookie("hub_mkt"), 5, "marketing id")


def test_wf_consent_support_safety_library(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        page.goto(app_url + "/safety-library")
        expect(page.get_by_role("heading", level=1)).to_have_text("SAFETY LIBRARY")
        status = page.get_by_role("status", name="Article results")
        expect(status).to_have_text("")
        handle = status.element_handle()
        box_ = page.get_by_role("searchbox", name="Search articles")
        expect(box_).to_have_attribute("maxlength", str(ARTICLE_Q_MAX))
        box_.press_sequentially("blocking")
        expect(status).to_have_text("1 article")
        expect(box_).to_be_focused()
        box_.press_sequentially("zzqx")
        expect(status).to_contain_text("0 articles")
        expect(page.get_by_text("No articles match your search.")).to_be_visible()
        box_.fill("")
        select(page.get_by_role("combobox", name="Filter by category"), "Tools")
        expect(status).to_have_text(re.compile(r"^\d+ articles?$"))
        assert handle.evaluate("e => e.isConnected")
        n = len(req(app_url, "GET", "/api/safety/articles", params={"category": "Tools"}).json()["data"])
        expect(status).to_have_text("1 article" if n == 1 else f"{n} articles")
        page.get_by_role("link", name="Reporting and blocking").click()
        expect(page).to_have_url(f"{app_url}/safety-library/reporting-and-blocking")
        expect(page.get_by_role("heading", level=1)).to_have_text("Reporting and blocking")
        page.goto(app_url + "/safety-teen-charter")
        cards = page.get_by_role("main").get_by_role("button", pressed=False)
        assert cards.count() >= 4
        first, second, third = cards.nth(0).element_handle(), cards.nth(1).element_handle(), cards.nth(2).element_handle()
        first.click()
        assert first.get_attribute("aria-pressed") == "true"
        second.focus()
        page.keyboard.press("Enter")
        assert second.get_attribute("aria-pressed") == "true"
        third.focus()
        page.keyboard.press("Space")
        assert third.get_attribute("aria-pressed") == "true"


def test_wf_consent_support_keyboard(browser: Browser, app_url: str) -> None:
    _, address = fresh("kbd")
    with browse(browser) as page:
        page.goto(app_url + "/")
        dialog = page.get_by_role("dialog", name="Cookie preferences")
        expect(dialog).to_be_visible()
        assert not dialog.evaluate("d => d.contains(document.activeElement)")
        assert tab_order(page, 1) == ["Skip to main content"]
        btn(page, "Accept all").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("link", name="Skip to main content")).to_be_focused()

        def consent() -> str:
            return next(c for c in page.context.cookies() if c["name"] == "hub_consent")["value"]

        assert consent() == consent_value(1, 1)
        opener = btn(page, "Cookie preferences")
        opener.focus()
        page.keyboard.press("Enter")
        analytics = page.get_by_role("checkbox", name="Analytics")
        expect(analytics).to_be_focused()
        expect(analytics).to_be_checked()
        page.keyboard.press("Space")
        expect(analytics).not_to_be_checked()
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        assert_unavailable(page.get_by_role("checkbox", name="Analytics", include_hidden=True))
        assert consent() == consent_value(1, 1)
        page.goto(app_url + "/support/new")
        email_box = page.get_by_role("textbox", name="Email")
        email_box.focus()
        assert tab_order(page, 4) == ["Category", "Subject", "Description", "Submit request"]
        email_box.focus()
        page.keyboard.type(address)
        page.keyboard.press("Tab")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Tab")
        page.keyboard.type(KEYBOARD_SUBJECT)
        page.keyboard.press("Tab")
        page.keyboard.type("Typed entirely from the keyboard.")
        page.keyboard.press("Tab")
        expect(btn(page, "Submit request")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("status", name="Request status")).to_have_text(re.compile(r"^Request received\. Your reference is HUB-\d{6}\.$"))
    rows = Postgres().rows(f"SELECT subject FROM support_tickets WHERE lower(email) = {sq(address)}")
    assert rows == [{"subject": KEYBOARD_SUBJECT}]


def test_status_lines_stay(browser: Browser, app_url: str) -> None:
    _, address = fresh("stay")
    with browse(browser) as page:
        page.clock.install()
        page.goto(app_url + "/support/new")
        status = page.get_by_role("status", name="Request status")
        expect(status).to_have_text("")
        handle = status.element_handle()
        page.get_by_role("textbox", name="Email").fill(address)
        select(page.get_by_role("combobox", name="Category"), "Billing")
        page.get_by_role("textbox", name="Subject").fill("Stays put")
        page.get_by_role("textbox", name="Description").fill("This line must stay on screen.")
        btn(page, "Submit request").click()
        expect(status).to_have_text(re.compile(r"^Request received\. Your reference is HUB-\d{6}\.$"))
        line = status.inner_text().strip()
        cookie_status = page.get_by_role("status", name="Cookie status")
        cookie_handle = cookie_status.element_handle()
        btn(page, "Reject optional").click()
        expect(cookie_status).to_have_text("Cookie preferences saved.")
        page.clock.run_for(TEN_MINUTES_MS)
        assert handle.evaluate("e => e.isConnected && e.textContent.trim()") == line
        assert cookie_handle.evaluate("e => e.isConnected && e.textContent.trim()") == "Cookie preferences saved."
        page.get_by_role("textbox", name="Subject").fill("Second one")
        btn(page, "Submit request").click()
        expect(status).not_to_have_text(line)
        expect(status).to_have_text(re.compile(r"^Request received\. Your reference is HUB-\d{6}\.$"))
        assert handle.evaluate("e => e.isConnected")
    rows = Postgres().rows(f"SELECT reference FROM support_tickets WHERE lower(email) = {sq(address)}")
    assert len(rows) == 2 and {"reference": re.search(r"HUB-\d{6}", line).group(0)} in rows


def same_origin_url(url: str, base: str) -> bool:
    return urlsplit(url).netloc == urlsplit(base).netloc


def opacity_transform(locator: Any) -> dict:
    return locator.evaluate("e => ({opacity: getComputedStyle(e).opacity, transform: getComputedStyle(e).transform})")


def test_home_hero_and_download(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        page.goto(app_url + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("GROUP CHAT FOR EVERY CREW")
        expect(page.get_by_text("Rooms for your crew to play, talk and plan, open whenever you are, with the people and conversations you care about.")).to_be_visible()
        expect(page.get_by_role("link", name="Get the app")).to_have_attribute("href", re.compile(r"/download$"))
        expect(page.get_by_role("link", name="Open in your browser")).to_have_attribute("href", re.compile(r"/servers$"))
        handle = page.locator("video").first.element_handle()
        assert handle.evaluate("v => v.getAttribute('aria-hidden') === 'true' && v.muted && v.loop && v.playsInline && !!v.poster")
        page.wait_for_function("v => v.readyState >= 1", arg=handle)
        page.wait_for_function("v => !v.paused", arg=handle)
        meta = handle.evaluate("v => ({w: v.videoWidth, h: v.videoHeight, d: v.duration, src: v.currentSrc})")
        assert meta["w"] >= HERO_MIN_W and meta["h"] >= HERO_MIN_H and meta["d"] >= HERO_MIN_S
        clip = httpx.get(meta["src"], timeout=HTTP_TIMEOUT)
        assert same_origin_url(meta["src"], app_url) and clip.content[:4] == bytes.fromhex("1A45DFA3") and b"webm" in clip.content[:64]
        pause = btn(page, "Pause background video")
        pause.focus()
        page.keyboard.press("Space")
        expect(btn(page, "Play background video")).to_be_visible()
        assert handle.evaluate("v => v.paused")
        assert animations(page.get_by_role("region", name="Community highlights")), "word strip does not move"
        feats = page.get_by_role("region", name="Features").get_by_role("article")
        expect(feats).to_have_count(3)
        expect(feats.get_by_role("heading", level=2)).to_have_text(["PLAY TOGETHER", "TALK LIVE", "KEEP IT SAFE"])
        for sentence in ("Spin up a room for your crew and drop in whenever the game starts.",
                         "Messages, reactions and threads arrive the moment they are sent.",
                         "Roles and channel permissions decide exactly who sees and says what."):
            expect(page.get_by_role("region", name="Features")).to_contain_text(sentence)
        top = feats.first.evaluate("e => e.getBoundingClientRect().top + window.scrollY")
        start = max(0, int(top - DESKTOP_H))
        span = DESKTOP_H / 3
        positions = [int(start + span * k / 4) for k in range(5)]
        forward = [float(s["opacity"]) for s in scroll_samples(page, feats.first, positions, "opacity")]
        back = [float(s["opacity"]) for s in scroll_samples(page, feats.first, positions[::-1], "opacity")]
        assert forward[0] < forward[-1] and forward[-1] == 1.0
        assert all(a <= b + 1e-3 for a, b in zip(forward, forward[1:]))
        assert all(a >= b - 1e-3 for a, b in zip(back, back[1:]))
    for ua, label, others in (("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "Download for Windows", "macOS"),
                              ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36", "Download for macOS", "Windows")):
        with browse(browser, user_agent=ua) as page:
            page.goto(app_url + "/download")
            expect(page.get_by_role("link", name=label)).to_be_visible()
            expect(page.get_by_role("list", name="Other platforms")).to_contain_text(others)


def test_wf_home_media_listening_room(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/listening-room") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text("LISTENING ROOM")
        audio = page.locator("audio")
        expect(audio).to_have_count(1)
        a = audio.element_handle()
        assert a.evaluate("a => a.paused")
        tracks = page.get_by_role("list", name="Lounge mix tracks")
        titles = ["Night Shift Lo-fi", "Aurora Drift", "Ronin Rain"]
        status = page.get_by_role("status", name="Now playing")
        for title in titles:
            tracks.get_by_role("button", name=title).click()
            expect(status).to_have_text(f"Now playing: {title}")
            until(page, "a => a.readyState >= 1 && !a.paused", a, seconds=10)
            dur = a.evaluate("a => a.duration")
            assert TRACK_MIN_S <= dur <= TRACK_MAX_S
            expect(tracks).to_contain_text(f"{int(dur) // 60}:{int(dur) % 60:02d}")
        assert same_origin_url(a.evaluate("a => a.currentSrc"), app_url)
        tracks.get_by_role("button", name=titles[0]).click()
        until(page, "a => !a.paused", a, seconds=10)
        eq = page.get_by_role("img", name="Equalizer")
        moved = False
        before = decode(capture(eq))
        for _ in range(10):
            advance(page, 200)
            if difference(before, decode(capture(eq))) > 0:
                moved = True
                break
        assert moved, "equalizer still while playing"
        page.get_by_role("button", name="Pause", exact=True).focus()
        page.keyboard.press("Space")
        expect(btn(page, "Play")).to_be_focused()
        assert a.evaluate("a => a.paused")
        frozen = decode(capture(eq))
        advance(page, 1000)
        assert difference(frozen, decode(capture(eq))) == 0
        seek = page.get_by_role("slider", name="Seek")
        seek.focus()
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        until(page, "a => Math.abs(a.currentTime - 5) < 0.5", a, seconds=5)
        dur = a.evaluate("a => a.duration")
        expect(seek).to_have_attribute("aria-valuetext", f"0:{SEEK_STEP_S:02d} of {int(dur) // 60}:{int(dur) % 60:02d}")
        page.keyboard.press("ArrowLeft")
        until(page, "a => a.currentTime < 0.5", a, seconds=5)
        volume = page.get_by_role("slider", name="Volume")
        poll(lambda: slider_level(volume) == VOLUME_MAX, 5, "volume at its maximum")
        volume.focus()
        page.keyboard.press("ArrowDown")
        poll(lambda: slider_level(volume) == VOLUME_MAX - VOLUME_STEP, 5, "volume one step down")
        assert abs(a.evaluate("a => a.volume") - (VOLUME_MAX - VOLUME_STEP) / VOLUME_MAX) < 1e-6
        page.keyboard.press("ArrowRight")
        poll(lambda: slider_level(volume) == VOLUME_MAX, 5, "volume back at its maximum")
        btn(page, "Play").focus()
        page.keyboard.press("Enter")
        until(page, "a => !a.paused", a, seconds=5)
        seek.focus()
        page.keyboard.press("End")
        expect(status).to_have_text(f"Now playing: {titles[1]}", timeout=LIVE_MS)


def test_hover_easing(browser: Browser, app_url: str) -> None:
    def durations(value: str) -> list[float]:
        out = []
        for part in value.split(","):
            part = part.strip()
            out.append(float(part[:-2]) / 1000 if part.endswith("ms") else float(part.rstrip("s") or 0))
        return out

    with browse(browser) as page:
        page.goto(app_url + "/")
        link = page.get_by_role("navigation", name="Primary").get_by_role("link", name="Membership", exact=True)
        rest, hover = state_styles(link, "color", "transition-duration")
        assert rest["color"] != hover["color"]
        accent = page.get_by_role("link", name="Open in your browser").evaluate("e => getComputedStyle(e).backgroundColor")
        assert hover["color"] == accent
        nonzero = [d for d in durations(rest["transition-duration"]) if d > 0]
        assert nonzero and all(HOVER_MIN_S <= d <= HOVER_MAX_S for d in nonzero)
        pill = page.get_by_role("link", name="Get the app")
        rest, hover = state_styles(pill, "background-color", "color", "transform", "box-shadow", "transition-duration")
        assert any(rest[k] != hover[k] for k in ("background-color", "color", "transform", "box-shadow"))
        nonzero = [d for d in durations(rest["transition-duration"]) if d > 0]
        assert nonzero and all(HOVER_MIN_S <= d <= HOVER_MAX_S for d in nonzero)


def test_phone_feature_blocks_still(browser: Browser, app_url: str) -> None:
    with browse(browser, PHONE_W, PHONE_H) as page:
        page.goto(app_url + "/")
        feats = page.get_by_role("region", name="Features").get_by_role("article")
        for i in range(3):
            top = int(feats.nth(i).evaluate("e => e.getBoundingClientRect().top + window.scrollY"))
            positions = [max(0, top - PHONE_H + k * PHONE_H // 6) for k in range(6)]
            for s in scroll_samples(page, feats.nth(i), positions, "opacity", "transform"):
                assert float(s["opacity"]) == 1.0
                assert s["transform"] in ("none", "matrix(1, 0, 0, 1, 0, 0)")


def test_wf_home_media_reduced_motion_live(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        v = page.locator("video").first.element_handle()
        until(page, "v => !v.paused", v, seconds=10)
        page.emulate_media(reduced_motion="reduce")
        until(page, "v => v.paused", v, seconds=REDUCED_MOTION_MS / 1000)
        expect(btn(page, "Play background video")).to_be_visible(timeout=REDUCED_MOTION_MS)
        assert not [x for x in animations(page.get_by_role("region", name="Community highlights")) if x["playState"] == "running"]
        for art in page.get_by_role("region", name="Features").get_by_role("article").all():
            assert float(opacity_transform(art)["opacity"]) == 1.0
        page.emulate_media(reduced_motion="no-preference")
        advance(page, 2000)
        assert v.evaluate("v => v.paused")
    with open_app(browser, app_url + "/listening-room") as page:
        a = page.locator("audio").element_handle()
        page.get_by_role("list", name="Lounge mix tracks").get_by_role("button", name="Aurora Drift").click()
        until(page, "a => !a.paused && a.currentTime > 0", a, seconds=10)
        page.emulate_media(reduced_motion="reduce")
        eq = page.get_by_role("img", name="Equalizer")
        advance(page, REDUCED_MOTION_MS)
        frozen = decode(capture(eq))
        advance(page, 1000)
        assert difference(frozen, decode(capture(eq))) == 0
        t = a.evaluate("a => a.currentTime")
        until(page, "([a, t]) => !a.paused && a.currentTime > t", [a, t], seconds=5)


def test_home_breakpoints(browser: Browser, app_url: str) -> None:
    for width in (EDGE_PHONE, EDGE_TABLET_LOW, EDGE_TABLET_HIGH, EDGE_DESKTOP):
        with browse(browser, width, DESKTOP_H) as page:
            page.goto(app_url + "/")
            layout(page)
            expect(btn(page, "Menu")).to_have_count(1 if width == EDGE_PHONE else 0)
            if width != EDGE_PHONE:
                expect(page.get_by_role("navigation", name="Primary").get_by_role("link", name="Discover", exact=True)).to_be_visible()
            feats = [box(f) for f in page.get_by_role("region", name="Features").get_by_role("article").all()]
            h1, video = box(page.get_by_role("heading", level=1)), box(page.locator("video").first)
            if width == EDGE_DESKTOP:
                assert len({round(f["y"]) for f in feats}) == 1
                assert video["x"] > h1["x"] and video["y"] < h1["y"] + h1["height"]
            else:
                assert feats[0]["y"] < feats[1]["y"] < feats[2]["y"]
                assert video["y"] >= h1["y"] + h1["height"] - 1
            page.goto(app_url + "/servers")
            expect(btn(page, "Menu")).to_have_count(1 if width == EDGE_PHONE else 0)


def test_checkout_entitlements(app_url: str, mail: Mailpit) -> None:
    tiers = req(app_url, "GET", "/api/membership/tiers").json()["data"]
    assert [(t["id"], t["name"], t["price_cents"], t["currency"]) for t in tiers] == [("basic", "Basic", BASIC_PRICE, "usd"), ("max", "Max", MAX_PRICE, "usd")]
    assert set(tiers[0]["entitlements"]) == {"custom_emoji", "larger_uploads"}
    assert set(tiers[1]["entitlements"]) == {"custom_emoji", "larger_uploads", "custom_app_icons", "longer_messages"}
    owner, (m,), com, ch = space(app_url, 1)
    msg = post_msg(app_url, owner["token"], ch, "gate").json()["id"]
    refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/:party_time:", m["token"]), 403, "entitlement_required")
    refused(post_msg(app_url, m["token"], ch, "x" * (MAX_BODY + 1)), 422, "validation_failed", "body")
    refused(upload(app_url, m["token"], "big.bin", bytes(FREE_UPLOAD + 1)), 413, "payload_too_large", "file")
    pg = Postgres()
    t = m["token"]
    refused(checkout(app_url, t, "basic", "1234"), 422, "validation_failed", "card_number")
    refused(checkout(app_url, t, "gold"), 422, "validation_failed", "tier")
    refused(checkout(app_url, t, "basic", key="has space"), 422, "validation_failed", "Idempotency-Key")
    refused(checkout(app_url, t, "basic", key="k" * 65), 422, "validation_failed", "Idempotency-Key")
    refused(checkout(app_url, t, "basic", CARD_DECLINE), 402, "payment_declined", None)
    assert req(app_url, "GET", "/api/users/@me", t).json()["tier"] == "free"
    key = f"key-{uuid.uuid4().hex}"
    r = checkout(app_url, t, "basic", key=key)
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] == "basic" and set(body["entitlements"]) == {"custom_emoji", "larger_uploads"}
    assert body["receipt"]["amount_cents"] == BASIC_PRICE and body["receipt"]["currency"] == "usd"
    replay = checkout(app_url, t, "basic", key=key)
    assert replay.status_code == 200 and replay.json() == body
    refused(checkout(app_url, t, "max", key=key), 409, "conflict", None)
    refused(checkout(app_url, t, "basic", key=f"other-{key}"), 409, "conflict", None)
    rows = pg.rows(f"SELECT status, amount_cents FROM subscriptions WHERE member_id = {int(m['id'])} ORDER BY id")
    assert rows == [{"status": "declined", "amount_cents": BASIC_PRICE}, {"status": "active", "amount_cents": BASIC_PRICE}]
    assert req(app_url, "PUT", f"/api/messages/{msg}/reactions/:party_time:", t).status_code == 204
    receipts = [x for x in mail_for(mail, m["email"], 2) if x["Subject"] == f"Your Community Hub receipt {body['receipt']['id']}"]
    assert len(receipts) == 1 and amount_line(BASIC_PRICE) in mail_text(receipts[0])
    assert len([x for x in mail_for(mail, m["email"], 3, seconds=MAIL_SETTLE_S * 3) if x["Subject"].startswith("Your Community Hub receipt")]) == 1
    assert req(app_url, "DELETE", "/api/membership", t).status_code == 204
    assert req(app_url, "GET", "/api/users/@me", t).json()["tier"] == "free"
    refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/:other_one:", t), 403, "entitlement_required")
    refused(req(app_url, "DELETE", "/api/membership", t), 409, "conflict", None)
    racer = new_member(app_url, "race")
    out = together([lambda i=i: checkout(app_url, racer["token"], "basic", key=f"r{i}-{uuid.uuid4().hex}") for i in range(5)])
    assert sorted(r.status_code for r in out) == [200] + [409] * 4
    same = f"same-{uuid.uuid4().hex}"
    other = new_member(app_url, "same")
    outs = together([lambda: checkout(app_url, other["token"], "basic", key=same) for _ in range(4)])
    assert {r.status_code for r in outs} == {200} and len({r.json()["receipt"]["id"] for r in outs}) == 1
    for who in (racer, other):
        assert pg.rows(f"SELECT count(*) AS n FROM subscriptions WHERE member_id = {int(who['id'])}")[0]["n"] == 1
        assert len([x for x in mail_for(mail, who["email"], 2) if x["Subject"].startswith("Your Community Hub receipt")]) == 1


def test_upgrade_downgrade(app_url: str, mail: Mailpit) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    t = m["token"]
    assert checkout(app_url, t, "basic").json()["receipt"]["amount_cents"] == BASIC_PRICE
    assert upload(app_url, t, "bigger.bin", bytes(FREE_UPLOAD + 1)).status_code == 201
    up = checkout(app_url, t, "max").json()
    assert up["tier"] == "max" and up["receipt"]["amount_cents"] == UPGRADE_DIFF
    assert req(app_url, "PATCH", "/api/users/@me", t, body={"app_icon": "aurora"}).json()["app_icon"] == "aurora"
    assert post_msg(app_url, t, ch, "y" * MAX_BODY_LONG).status_code == 201
    down = checkout(app_url, t, "basic").json()
    assert down["receipt"]["amount_cents"] == 0
    me = req(app_url, "GET", "/api/users/@me", t).json()
    assert me["app_icon"] == "classic" and me["tier"] == "basic"
    refused(post_msg(app_url, t, ch, "y" * (MAX_BODY + 1)), 422, "validation_failed", "body")
    rows = Postgres().rows(f"SELECT status, amount_cents FROM subscriptions WHERE member_id = {int(m['id'])} ORDER BY id")
    assert rows == [{"status": "cancelled", "amount_cents": BASIC_PRICE}, {"status": "cancelled", "amount_cents": UPGRADE_DIFF}, {"status": "active", "amount_cents": 0}]
    texts = {x["Subject"]: mail_text(x) for x in mail_for(mail, m["email"], 4) if x["Subject"].startswith("Your Community Hub receipt")}
    assert amount_line(UPGRADE_DIFF) in texts[f"Your Community Hub receipt {up['receipt']['id']}"]
    assert amount_line(0) in texts[f"Your Community Hub receipt {down['receipt']['id']}"]


def test_wf_membership_checkout_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    m = new_member(app_url, "ck")
    with browse(browser) as page:
        page.clock.install()
        ui_login(page, app_url, m["email"], PASSWORD, "/membership")
        opener = btn(page, "Subscribe to Basic")
        opener.click()
        dialog = page.get_by_role("dialog", name="Checkout")
        card = dialog.get_by_role("textbox", name="Card number")
        expect(card).to_be_focused()
        expect(dialog).to_contain_text("Basic")
        expect(dialog).to_contain_text("$2.99")
        inert_js = """el => { for (let n = el; n; n = n.parentElement) { if (n.inert) return true; }
            const d = [...document.querySelectorAll('dialog[open]')].find(x => x.matches(':modal'));
            return !!d && !d.contains(el); }"""
        assert btn(page, "Subscribe to Max").evaluate(inert_js)
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        card.fill(CARD_DECLINE)
        keys: list[str] = []
        page.on("request", lambda rq: keys.append(rq.headers.get("idempotency-key", "")) if "/api/membership/checkout" in rq.url else None)
        status = dialog.get_by_role("status", name="Payment status")
        with held(page, "**/api/membership/checkout") as hold:
            card.press("Enter")
            expect(status).to_contain_text("Processing payment")
            page.keyboard.press("Escape")
            expect(dialog).to_be_visible()
            hold.release()
        expect(status).to_have_text(f"Your card was declined. You are still on {FREE_TIER}.")
        dialog.get_by_role("textbox", name="Card number").fill(CARD_OK)
        dialog.get_by_role("button", name="Try again").click()
        success = f"You are now on {BASIC_TIER}."
        pay = dialog.get_by_role("button", name="Pay")

        def settled() -> str | None:
            line = status.inner_text().strip()
            if line == success:
                return "paid"
            if pay.count() and pay.is_enabled() and "Processing payment" not in line:
                return "pay"
            return None

        if poll(settled, 10, "checkout settled after Try again") == "pay":
            card_box = dialog.get_by_role("textbox", name="Card number")
            if field_value(card_box).replace(" ", "") != CARD_OK.replace(" ", ""):
                card_box.fill(CARD_OK)
            pay.dblclick()
        expect(status).to_have_text(success)
        handle = status.element_handle()
        page.clock.run_for(TEN_MINUTES_MS)
        assert handle.evaluate("e => e.isConnected && e.textContent.trim()") == f"You are now on {BASIC_TIER}."
        assert len(set(k for k in keys if k)) >= 2
        page.keyboard.press("Escape")
        assert_unavailable(page.get_by_role("dialog", name="Checkout", include_hidden=True))
        expect(opener).to_be_focused()
    assert req(app_url, "GET", "/api/users/@me", m["token"]).json()["tier"] == "basic"
    rows = Postgres().rows(f"SELECT status FROM subscriptions WHERE member_id = {int(m['id'])} ORDER BY id")
    assert [r["status"] for r in rows] == ["declined", "active"]
    receipts = [x for x in mail_for(mail, m["email"], 2) if x["Subject"].startswith("Your Community Hub receipt")]
    assert len(receipts) == 1 and amount_line(BASIC_PRICE) in mail_text(receipts[0])


def test_wf_membership_signed_out_subscribe(browser: Browser, app_url: str) -> None:
    m = new_member(app_url, "mso")
    with browse(browser) as page:
        page.goto(app_url + "/membership")
        table = page.get_by_role("table", name="Compare membership tiers")
        expect(table.get_by_role("columnheader")).to_have_text(["Perk", "Free", "Basic", "Max"])
        for perk in ("Custom emoji anywhere", "Larger uploads", "Custom app icons", "Longer messages"):
            expect(table.get_by_role("row", name=re.compile(perk))).to_have_count(1)
        expect(table.get_by_role("row", name=re.compile("Custom app icons"))).to_contain_text("Not included")
        expect(first_visible(page.get_by_text("$2.99 / MONTH"))).to_be_visible()
        expect(first_visible(page.get_by_text("$9.99 / MONTH"))).to_be_visible()
        btn(page, "Subscribe to Max").click()
        expect(page).to_have_url(f"{app_url}/login?next=%2Fmembership")
        ui_submit_login(page, m["email"], PASSWORD)
        expect(page).to_have_url(f"{app_url}/membership")
        btn(page, "Subscribe to Max").click()
        expect(page.get_by_role("dialog", name="Checkout")).to_contain_text("$9.99")
    assert req(app_url, "GET", "/api/membership/tiers").json()["data"][1]["price_cents"] == MAX_PRICE


def test_bans(app_url: str) -> None:
    owner, (b, c), com, ch = space(app_url, 2)
    slug, ot = com["slug"], owner["token"]
    kept = post_msg(app_url, b["token"], ch, "before the ban").json()["id"]
    role = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Tagged", "permissions": []}).json()
    req(app_url, "PUT", f"/api/servers/{slug}/members/{b['id']}/roles/{role['id']}", ot)
    set_overwrite(app_url, ot, ch, "member", b["id"], deny=["add_reactions"])
    refused(req(app_url, "PUT", f"/api/servers/{slug}/bans/{b['id']}", c["token"]), 403, "forbidden")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/bans/{owner['id']}", ot), 403, "forbidden")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/bans/2147483000", ot), 404, "not_found")
    assert req(app_url, "PUT", f"/api/servers/{slug}/bans/{b['id']}", ot).status_code == 204
    assert req(app_url, "PUT", f"/api/servers/{slug}/bans/{b['id']}", ot).status_code == 204
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM bans WHERE community_id = {int(com['id'])} AND member_id = {int(b['id'])}")[0]["n"] == 1
    assert pg.rows(f"SELECT count(*) AS n FROM memberships WHERE community_id = {int(com['id'])} AND member_id = {int(b['id'])}")[0]["n"] == 0
    assert pg.rows(f"SELECT count(*) AS n FROM member_roles WHERE member_id = {int(b['id'])} AND role_id = {int(role['id'])}")[0]["n"] == 0
    assert all(o["target_id"] != b["id"] for o in req(app_url, "GET", f"/api/channels/{ch}/overwrites", ot).json()["data"])
    refused(req(app_url, "GET", f"/api/channels/{ch}/messages", b["token"]), 403, "forbidden")
    refused(join(app_url, b["token"], slug), 403, "forbidden")
    assert kept in [x["id"] for x in history(app_url, ot, ch)["data"]]
    bans = req(app_url, "GET", f"/api/servers/{slug}/bans", ot).json()["data"]
    assert [x["user"]["id"] for x in bans] == [b["id"]] and TIMESTAMP_RE.match(bans[0]["created_at"])
    refused(req(app_url, "GET", f"/api/servers/{slug}/bans", c["token"]), 403, "forbidden")
    outsider = new_member(app_url, "pre")
    assert req(app_url, "PUT", f"/api/servers/{slug}/bans/{outsider['id']}", ot).status_code == 204
    refused(join(app_url, outsider["token"], slug), 403, "forbidden")
    assert req(app_url, "DELETE", f"/api/servers/{slug}/bans/{b['id']}", ot).status_code == 204
    refused(req(app_url, "DELETE", f"/api/servers/{slug}/bans/{b['id']}", ot), 404, "not_found")
    assert join(app_url, b["token"], slug).status_code == 201


def test_timeouts(app_url: str) -> None:
    owner, (b,), com, ch = space(app_url, 1)
    slug, ot = com["slug"], owner["token"]
    for bad in (-1, MAX_TIMEOUT_S + 1, 1.5, "10"):
        refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{b['id']}/timeout", ot, body={"seconds": bad}), 422, "validation_failed", "seconds")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{owner['id']}/timeout", ot, body={"seconds": 5}), 403, "forbidden")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{new_member(app_url, 'nm')['id']}/timeout", ot, body={"seconds": 5}), 404, "not_found")
    msg = post_msg(app_url, ot, ch, "react to me").json()["id"]
    r = req(app_url, "PUT", f"/api/servers/{slug}/members/{b['id']}/timeout", ot, body={"seconds": TIMEOUT_PROBE_S})
    assert r.status_code == 200
    until_at = iso(r.json()["communication_disabled_until"])
    assert r.json()["user_id"] == b["id"]
    assert abs((until_at - date_header(r)).total_seconds() - TIMEOUT_PROBE_S) <= 1
    assert detail(app_url, slug, b["token"]).json()["me"]["communication_disabled_until"] == r.json()["communication_disabled_until"]
    assert req(app_url, "GET", f"/api/channels/{ch}/permissions", b["token"]).json()["permissions"] == ["view_channel"]
    assert req(app_url, "GET", f"/api/channels/{ch}/messages", b["token"]).status_code == 200
    refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/%F0%9F%94%A5", b["token"]), 403, "forbidden")
    attempts: list[httpx.Response] = []

    def posted() -> bool:
        res = post_msg(app_url, b["token"], ch, "after time-out")
        attempts.append(res)
        return res.status_code == 201

    poll(posted, TIMEOUT_PROBE_S + 5, "time-out end")
    for res in attempts[:-1]:
        refused(res, 403, "forbidden")
        assert date_header(res) <= until_at
    assert date_header(attempts[-1]) >= until_at - dt.timedelta(seconds=1)
    req(app_url, "PUT", f"/api/servers/{slug}/members/{b['id']}/timeout", ot, body={"seconds": 600})
    refused(post_msg(app_url, b["token"], ch, "silenced"), 403, "forbidden")
    lift = req(app_url, "PUT", f"/api/servers/{slug}/members/{b['id']}/timeout", ot, body={"seconds": 0})
    assert lift.json()["communication_disabled_until"] is None
    assert post_msg(app_url, b["token"], ch, "free again").status_code == 201
    nova = login(app_url, "member@example.com", SEED_PW)
    slow = channel_named(aurora(app_url), "slow-lane")
    fast = new_member(app_url, "fast")
    assert join(app_url, fast["token"], "aurora-collective").status_code == 201
    try:
        assert set_overwrite(app_url, nova, slow, "member", fast["id"], allow=["manage_messages"]).status_code == 200
        assert post_msg(app_url, fast["token"], slow, "first fast").status_code == 201
        assert post_msg(app_url, fast["token"], slow, "second fast").status_code == 201
    finally:
        req(app_url, "DELETE", f"/api/channels/{slow}/overwrites/member/{fast['id']}", nova)


def test_roles_overwrites(app_url: str) -> None:
    owner, (m, n), com, ch = space(app_url, 2)
    slug, ot = com["slug"], owner["token"]
    for body, field in (({"name": "@everyone", "permissions": []}, "name"), ({"name": "x" * (NAME_MAX + 1), "permissions": []}, "name"),
                        ({"name": "   ", "permissions": []}, "name"), ({"name": "Weird", "permissions": ["fly"]}, "permissions")):
        refused(req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body=body), 422, "validation_failed", field)
    role = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Speakers", "permissions": ["send_messages", "view_channel"]})
    assert role.status_code == 201
    role = role.json()
    assert set(role) == {"id", "name", "position", "permissions", "is_default"} and role["permissions"] == ["send_messages", "view_channel"]
    refused(req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "speakers", "permissions": []}), 409, "conflict", "name")
    default = next(r for r in roles(app_url, ot, slug) if r["is_default"])
    assert default["name"] == "@everyone" and default["position"] == 0
    assert default["permissions"] == ["add_reactions", "attach_files", "create_invite", "send_messages", "view_channel"]
    refused(req(app_url, "PATCH", f"/api/roles/{default['id']}", ot, body={"name": "All"}), 422, "validation_failed", "name")
    refused(req(app_url, "DELETE", f"/api/roles/{default['id']}", ot), 409, "conflict", "role_id")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{m['id']}/roles/{default['id']}", ot), 422, "validation_failed", "role_id")
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{owner['id']}/roles/{role['id']}", ot), 403, "forbidden")
    foreign = new_community(app_url, ot)
    foreign_role = req(app_url, "POST", f"/api/servers/{foreign['slug']}/roles", ot, body={"name": "Other", "permissions": []}).json()
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{m['id']}/roles/{foreign_role['id']}", ot), 404, "not_found")
    refused(set_overwrite(app_url, ot, ch, "role", foreign_role["id"], deny=["send_messages"]), 404, "not_found")
    refused(set_overwrite(app_url, ot, ch, "member", owner["id"], deny=["send_messages"]), 403, "forbidden")
    refused(set_overwrite(app_url, ot, ch, "member", m["id"], allow=["send_messages"], deny=["send_messages"]), 422, "validation_failed", "deny")
    refused(req(app_url, "DELETE", f"/api/channels/{ch}/overwrites/member/{m['id']}", ot), 404, "not_found")
    for _ in range(2):
        assert req(app_url, "PUT", f"/api/servers/{slug}/members/{m['id']}/roles/{role['id']}", ot).status_code == 204
    refused(req(app_url, "POST", f"/api/servers/{slug}/roles", m["token"], body={"name": "Nope", "permissions": []}), 403, "forbidden")

    def perms(tok: str) -> list[str]:
        return req(app_url, "GET", f"/api/channels/{ch}/permissions", tok).json()["permissions"]

    assert set_overwrite(app_url, ot, ch, "role", default["id"], deny=["send_messages"]).json()["deny"] == ["send_messages"]
    assert perms(n["token"]) == ["add_reactions", "create_invite", "view_channel"]
    refused(post_msg(app_url, n["token"], ch, "muted"), 403, "forbidden")
    ow = set_overwrite(app_url, ot, ch, "role", role["id"], allow=["send_messages"])
    assert set(ow.json()) == {"channel_id", "target_type", "target_id", "allow", "deny"}
    assert "attach_files" in perms(m["token"]) and post_msg(app_url, m["token"], ch, "voice").status_code == 201
    set_overwrite(app_url, ot, ch, "member", m["id"], deny=["send_messages"])
    refused(post_msg(app_url, m["token"], ch, "blocked"), 403, "forbidden")
    listing = req(app_url, "GET", f"/api/channels/{ch}/overwrites", ot).json()["data"]
    assert [(o["target_type"], o["target_id"]) for o in listing] == [("role", default["id"]), ("role", role["id"]), ("member", m["id"])]
    assert req(app_url, "DELETE", f"/api/channels/{ch}/overwrites/member/{m['id']}", ot).status_code == 204
    assert post_msg(app_url, m["token"], ch, "back").status_code == 201
    set_overwrite(app_url, ot, ch, "role", default["id"], deny=["view_channel"])
    assert perms(n["token"]) == []
    refused(req(app_url, "GET", f"/api/channels/{ch}/messages", n["token"]), 403, "forbidden")
    assert ch not in [c["id"] for c in detail(app_url, slug, n["token"]).json()["channels"]]
    assert req(app_url, "DELETE", f"/api/roles/{role['id']}", ot).status_code == 204
    remaining = req(app_url, "GET", f"/api/channels/{ch}/overwrites", ot).json()["data"]
    assert len(remaining) == 1 and remaining[0]["target_id"] == default["id"]


def test_moderation_races(app_url: str) -> None:
    owner, (target, mod1, mod2), com, ch = space(app_url, 3)
    slug, ot = com["slug"], owner["token"]
    banned_at: list[float] = []

    def ban() -> httpx.Response:
        res = req(app_url, "PUT", f"/api/servers/{slug}/bans/{target['id']}", ot)
        banned_at.append(time.monotonic())
        return res

    def spam(i: int) -> tuple[httpx.Response, float]:
        started = time.monotonic()
        return post_msg(app_url, target["token"], ch, f"spam {i}"), started

    out = together([ban] + [lambda i=i: spam(i) for i in range(12)])
    assert out[0].status_code == 204
    accepted = 0
    for res, started in out[1:]:
        assert res.status_code in (201, 403)
        if started > banned_at[0]:
            assert res.status_code == 403
        accepted += res.status_code == 201
    refused(post_msg(app_url, target["token"], ch, "too late"), 403, "forbidden")
    stored = Postgres().rows(f"SELECT count(*) AS n FROM messages WHERE author_id = {int(target['id'])} AND channel_id = {int(ch)}")[0]["n"]
    assert stored == accepted
    mods = req(app_url, "POST", f"/api/servers/{slug}/roles", ot, body={"name": "Mods", "permissions": ["ban_members"]}).json()
    for mo in (mod1, mod2):
        req(app_url, "PUT", f"/api/servers/{slug}/members/{mo['id']}/roles/{mods['id']}", ot)
    leaver = new_member(app_url, "lv")
    assert join(app_url, leaver["token"], slug).status_code == 201
    before = detail(app_url, slug).json()
    res = together([lambda: req(app_url, "PUT", f"/api/servers/{slug}/bans/{leaver['id']}", mod1["token"]),
                    lambda: req(app_url, "PUT", f"/api/servers/{slug}/bans/{leaver['id']}", mod2["token"]),
                    lambda: req(app_url, "DELETE", f"/api/servers/{slug}/membership", leaver["token"])])
    assert res[0].status_code == 204 and res[1].status_code == 204 and res[2].status_code in (204, 404)
    after = detail(app_url, slug).json()
    assert after["member_count"] == before["member_count"] - 1 and after["presence_count"] == before["presence_count"] - 1
    assert Postgres().rows(f"SELECT count(*) AS n FROM bans WHERE community_id = {int(com['id'])} AND member_id = {int(leaver['id'])}")[0]["n"] == 1
    victim = new_member(app_url, "tv")
    assert join(app_url, victim["token"], slug).status_code == 201
    res = together([lambda: req(app_url, "PUT", f"/api/servers/{slug}/members/{victim['id']}/timeout", mod1["token"], body={"seconds": 600}),
                    lambda: req(app_url, "PUT", f"/api/servers/{slug}/members/{victim['id']}/timeout", mod2["token"], body={"seconds": 1200})])
    assert [r.status_code for r in res] == [200, 200]
    stored_until = {detail(app_url, slug, victim["token"]).json()["me"]["communication_disabled_until"] for _ in range(3)}
    assert len(stored_until) == 1 and stored_until <= {r.json()["communication_disabled_until"] for r in res}
    victim2 = new_member(app_url, "tv2")
    assert join(app_url, victim2["token"], slug).status_code == 201
    res = together([lambda: req(app_url, "DELETE", f"/api/servers/{slug}/members/{mod1['id']}/roles/{mods['id']}", ot),
                    lambda: req(app_url, "PUT", f"/api/servers/{slug}/bans/{victim2['id']}", mod1["token"])])
    assert res[0].status_code == 204 and res[1].status_code in (204, 403)
    stored_ban = Postgres().rows(f"SELECT count(*) AS n FROM bans WHERE community_id = {int(com['id'])} AND member_id = {int(victim2['id'])}")[0]["n"]
    assert stored_ban == (1 if res[1].status_code == 204 else 0)
    refused(req(app_url, "PUT", f"/api/servers/{slug}/members/{victim['id']}/timeout", mod1["token"], body={"seconds": 60}), 403, "forbidden")


def test_wf_message_authority_permissions_ui(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    ot = owner["token"]
    post_msg(app_url, ot, ch, OWNER_WORDS)
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        page.get_by_text(OWNER_WORDS).hover()
        expect(btn(page, "Add reaction")).to_have_count(1)
        expect(btn(page, "Delete message")).to_have_count(0)
        set_overwrite(app_url, ot, ch, "member", m["id"], deny=["send_messages", "add_reactions"], allow=["manage_messages"])
        page.reload()
        composer = page.get_by_role("textbox", name=composer_name())
        expect(composer).to_be_disabled()
        expect(composer).to_have_attribute("placeholder", "You do not have permission to send messages in this channel.")
        expect(btn(page, "Attach files")).to_be_disabled()
        page.get_by_text(OWNER_WORDS).hover()
        expect(btn(page, "Add reaction")).to_have_count(0)
        expect(btn(page, "Delete message")).to_have_count(1)
        refused(post_msg(app_url, m["token"], ch, "sneaky"), 403, "forbidden")
        channels = page.get_by_role("navigation", name="Channels")
        expect(channels.get_by_role("link", name="general")).to_be_visible()
        set_overwrite(app_url, ot, ch, "member", m["id"], deny=["view_channel"])
        expect(channels.get_by_role("link", name="general")).to_have_count(0, timeout=LIVE_MS)
        req(app_url, "DELETE", f"/api/channels/{ch}/overwrites/member/{m['id']}", ot)
        expect(channels.get_by_role("link", name="general")).to_be_visible(timeout=LIVE_MS)
    assert "send_messages" in req(app_url, "GET", f"/api/channels/{ch}/permissions", m["token"]).json()["permissions"]


def test_wf_message_authority_timeout_clock(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    timeout_s = 20
    with browse(browser) as page:
        page.clock.install(time=dt.datetime(2031, 1, 1, tzinfo=dt.timezone.utc))
        open_channel(page, app_url, m, com["id"], ch)
        composer = page.get_by_role("textbox", name=composer_name())
        expect(composer).to_be_enabled()
        r = req(app_url, "PUT", f"/api/servers/{com['slug']}/members/{m['id']}/timeout", owner["token"], body={"seconds": timeout_s})
        end_mono = time.monotonic() + (iso(r.json()["communication_disabled_until"]) - date_header(r)).total_seconds()
        expect(composer).to_be_disabled(timeout=LIVE_MS)
        expect(btn(page, "Attach files")).to_be_disabled()
        placeholder = composer.get_attribute("placeholder") or ""
        hit = re.fullmatch(r"You are timed out for (\d+):(\d{2}) more\.", placeholder)
        assert hit, placeholder
        shown = int(hit.group(1)) * 60 + int(hit.group(2))
        assert abs(shown - (end_mono - time.monotonic())) <= 3
        poll(lambda: composer.is_enabled(), timeout_s + 5, "composer re-enabled")
        assert end_mono - 1 <= time.monotonic() <= end_mono + 3 + 1
        expect(composer).to_have_attribute("placeholder", composer_name())
    assert post_msg(app_url, m["token"], ch, "after clock").status_code == 201


def test_posting_history(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    r = post_msg(app_url, m["token"], ch, f"   {HELLO_TEXT}  \n")
    assert r.status_code == 201
    msg = r.json()
    assert set(msg) == MESSAGE_KEYS and msg["body"] == HELLO_TEXT and msg["channel_id"] == ch
    assert msg["edited_at"] is None and msg["reply_to_id"] is None and msg["referenced_message"] is None
    assert msg["reply_count"] == 0 and msg["reactions"] == [] and msg["attachments"] == [] and msg["mentions"] == []
    assert TIMESTAMP_RE.match(msg["created_at"]) and set(msg["author"]) == PUBLIC_USER_KEYS
    assert post_msg(app_url, m["token"], ch, "é" * MAX_BODY).status_code == 201
    refused(post_msg(app_url, m["token"], ch, "é" * (MAX_BODY + 1)), 422, "validation_failed", "body")
    refused(post_msg(app_url, m["token"], ch, "   "), 422, "validation_failed", "body")
    other = new_community(app_url, owner["token"])["channels"][0]["id"]
    foreign = post_msg(app_url, owner["token"], other, "elsewhere").json()["id"]
    refused(post_msg(app_url, m["token"], ch, "bad parent", reply_to_id=foreign), 422, "validation_failed", "reply_to_id")
    refused(post_msg(app_url, m["token"], ch, "bad nonce", nonce="n" * 65), 422, "validation_failed", "nonce")
    ids = [post_msg(app_url, owner["token"], ch, f"page {i}").json()["id"] for i in range(5)]
    last = history(app_url, m["token"], ch, limit=2)
    assert [x["id"] for x in last["data"]] == ids[-2:] and last["has_more"] is True
    prev = history(app_url, m["token"], ch, limit=2, before=ids[-2])
    assert [x["id"] for x in prev["data"]] == ids[1:3]
    assert Postgres().rows(f"SELECT body FROM messages WHERE id = {int(msg['id'])}") == [{"body": HELLO_TEXT}]


def test_non_members_refused(app_url: str) -> None:
    owner, _, com, ch = space(app_url, 0)
    outsider = new_member(app_url, "nmr")
    refused(req(app_url, "GET", f"/api/channels/{ch}/messages", outsider["token"]), 403, "forbidden")
    refused(post_msg(app_url, outsider["token"], ch, "intruder"), 403, "forbidden")
    refused(req(app_url, "POST", f"/api/channels/{ch}/ack", outsider["token"], body={"message_id": 1}), 403, "forbidden")
    assert Postgres().rows(f"SELECT count(*) AS n FROM messages WHERE author_id = {int(outsider['id'])}")[0]["n"] == 0


def test_edit_delete_rules(app_url: str) -> None:
    owner, (a, b), com, ch = space(app_url, 2)
    att = upload(app_url, a["token"], "pic.png", png_bytes(2, 2)).json()
    msg = post_msg(app_url, a["token"], ch, "original", attachment_ids=[att["id"]]).json()
    reply = post_msg(app_url, b["token"], ch, "reply", reply_to_id=msg["id"]).json()
    req(app_url, "PUT", f"/api/messages/{msg['id']}/reactions/%F0%9F%91%8D", b["token"])
    refused(req(app_url, "PATCH", f"/api/messages/{msg['id']}", b["token"], body={"body": "hijack"}), 403, "forbidden")
    refused(req(app_url, "PATCH", f"/api/messages/{msg['id']}", owner["token"], body={"body": "hijack"}), 403, "forbidden")
    r = req(app_url, "PATCH", f"/api/messages/{msg['id']}", a["token"], body={"body": "  edited  "})
    assert r.status_code == 200 and r.json()["body"] == "edited" and TIMESTAMP_RE.match(r.json()["edited_at"])
    refused(req(app_url, "DELETE", f"/api/messages/{msg['id']}", b["token"]), 403, "forbidden")
    assert req(app_url, "DELETE", f"/api/messages/{msg['id']}", owner["token"]).status_code == 204
    data = history(app_url, b["token"], ch)["data"]
    assert msg["id"] not in [x["id"] for x in data]
    kept = next(x for x in data if x["id"] == reply["id"])
    assert kept["reply_to_id"] is None and kept["referenced_message"] is None
    assert Postgres().rows(f"SELECT count(*) AS n FROM reactions WHERE message_id = {int(msg['id'])}")[0]["n"] == 0
    assert req(app_url, "GET", att["url"]).status_code == 404
    own = post_msg(app_url, b["token"], ch, "mine").json()["id"]
    assert req(app_url, "DELETE", f"/api/messages/{own}", b["token"]).status_code == 204


def test_reactions_threads(app_url: str) -> None:
    owner, (a, b), com, ch = space(app_url, 2)
    msg = post_msg(app_url, owner["token"], ch, "react").json()["id"]
    fire, eyes = quote("🔥"), quote("👀")
    out = together([lambda: req(app_url, "PUT", f"/api/messages/{msg}/reactions/{fire}", a["token"]) for _ in range(8)])
    assert {r.status_code for r in out} == {204}
    req(app_url, "PUT", f"/api/messages/{msg}/reactions/{eyes}", b["token"])
    req(app_url, "PUT", f"/api/messages/{msg}/reactions/{fire}", b["token"])
    view = next(x for x in history(app_url, a["token"], ch)["data"] if x["id"] == msg)["reactions"]
    assert view == [{"emoji": "🔥", "count": 2, "me": True}, {"emoji": "👀", "count": 1, "me": False}]
    refused(req(app_url, "DELETE", f"/api/messages/{msg}/reactions/{eyes}", a["token"]), 404, "not_found")
    refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/abc", a["token"]), 422, "validation_failed", "emoji")
    refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/:party_time:", a["token"]), 403, "entitlement_required")
    assert req(app_url, "DELETE", f"/api/messages/{msg}/reactions/{fire}", a["token"]).status_code == 204
    r1 = post_msg(app_url, a["token"], ch, "first reply", reply_to_id=msg).json()
    r2 = post_msg(app_url, b["token"], ch, "second reply", reply_to_id=msg).json()
    replies = req(app_url, "GET", f"/api/messages/{msg}/replies", a["token"]).json()["data"]
    assert [x["id"] for x in replies] == [r1["id"], r2["id"]]
    assert next(x for x in history(app_url, a["token"], ch)["data"] if x["id"] == msg)["reply_count"] == 2
    assert {r1["id"], r2["id"]} <= {x["id"] for x in history(app_url, a["token"], ch)["data"]}
    req(app_url, "DELETE", f"/api/messages/{r1['id']}", a["token"])
    assert next(x for x in history(app_url, a["token"], ch)["data"] if x["id"] == msg)["reply_count"] == 1


def test_slowmode_tier_limits(app_url: str) -> None:
    slow = channel_named(aurora(app_url), "slow-lane")
    m = new_member(app_url, "slow")
    assert join(app_url, m["token"], "aurora-collective").status_code == 201
    assert post_msg(app_url, m["token"], slow, "one").status_code == 201
    r = post_msg(app_url, m["token"], slow, "two")
    refused(r, 429, "rate_limited", None)
    assert 1 <= int(r.headers["retry-after"]) <= SLOWMODE_S
    assert Postgres().rows(f"SELECT count(*) AS n FROM messages WHERE author_id = {int(m['id'])}")[0]["n"] == 1
    assert upload(app_url, m["token"], "exact.bin", bytes(FREE_UPLOAD)).status_code == 201
    refused(upload(app_url, m["token"], "over.bin", bytes(FREE_UPLOAD + 1)), 413, "payload_too_large", "file")


def test_nonce_replay(app_url: str) -> None:
    owner, (a, b), com, ch = space(app_url, 2)
    nonce = uuid.uuid4().hex
    first = post_msg(app_url, a["token"], ch, "once", nonce=nonce)
    assert first.status_code == 201
    pg = Postgres()
    notes = pg.rows(f"SELECT count(*) AS n FROM notifications WHERE message_id = {int(first.json()['id'])}")[0]["n"]
    again = post_msg(app_url, a["token"], ch, "different body", nonce=nonce)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"] and again.json()["body"] == "once"
    assert pg.rows(f"SELECT count(*) AS n FROM notifications WHERE message_id = {int(first.json()['id'])}")[0]["n"] == notes
    assert pg.rows(f"SELECT count(*) AS n FROM messages WHERE author_id = {int(a['id'])}")[0]["n"] == 1
    assert post_msg(app_url, b["token"], ch, "theirs", nonce=nonce).status_code == 201
    burst_nonce = uuid.uuid4().hex
    out = together([lambda: post_msg(app_url, a["token"], ch, "burst", nonce=burst_nonce) for _ in range(6)])
    assert sorted(r.status_code for r in out) == [200] * 5 + [201]
    assert len({r.json()["id"] for r in out}) == 1
    req(app_url, "DELETE", f"/api/messages/{first.json()['id']}", a["token"])
    assert post_msg(app_url, a["token"], ch, "reborn", nonce=nonce).status_code == 201
    slow = channel_named(aurora(app_url), "slow-lane")
    s = new_member(app_url, "sn")
    join(app_url, s["token"], "aurora-collective")
    sn = uuid.uuid4().hex
    assert post_msg(app_url, s["token"], slow, "slow once", nonce=sn).status_code == 201
    assert post_msg(app_url, s["token"], slow, "slow once", nonce=sn).status_code == 200


def test_hidden_messages_404(app_url: str) -> None:
    owner, (hid, ban), com, ch = space(app_url, 2)
    msg = post_msg(app_url, owner["token"], ch, "secret").json()["id"]
    outsider = new_member(app_url, "h404")
    set_overwrite(app_url, owner["token"], ch, "member", hid["id"], deny=["view_channel"])
    req(app_url, "PUT", f"/api/servers/{com['slug']}/bans/{ban['id']}", owner["token"])
    for who in (outsider, hid, ban):
        t = who["token"]
        refused(req(app_url, "PATCH", f"/api/messages/{msg}", t, body={"body": "x"}), 404, "not_found")
        refused(req(app_url, "DELETE", f"/api/messages/{msg}", t), 404, "not_found")
        refused(req(app_url, "GET", f"/api/messages/{msg}/replies", t), 404, "not_found")
        refused(req(app_url, "PUT", f"/api/messages/{msg}/reactions/{quote('🔥')}", t), 404, "not_found")
        refused(req(app_url, "DELETE", f"/api/messages/{msg}/reactions/{quote('🔥')}", t), 404, "not_found")
    assert history(app_url, owner["token"], ch)["data"][-1]["body"] == "secret"


def test_quoted_parents(app_url: str) -> None:
    owner, (a,), com, ch = space(app_url, 1)
    parent = post_msg(app_url, owner["token"], ch, "quoted original").json()
    nonce = uuid.uuid4().hex
    reply = post_msg(app_url, a["token"], ch, "zebra answer", reply_to_id=parent["id"], nonce=nonce).json()
    assert reply["referenced_message"] == {"id": parent["id"], "author": parent["author"], "body": "quoted original", "edited_at": None}
    req(app_url, "PATCH", f"/api/messages/{parent['id']}", owner["token"], body={"body": QUOTED_EDIT})
    refs = [next(x for x in history(app_url, a["token"], ch)["data"] if x["id"] == reply["id"])["referenced_message"],
            req(app_url, "GET", f"/api/messages/{parent['id']}/replies", a["token"]).json()["data"][0]["referenced_message"],
            req(app_url, "GET", f"/api/servers/{com['slug']}/messages/search", a["token"], params={"q": "zebra"}).json()["data"][0]["referenced_message"],
            post_msg(app_url, a["token"], ch, "zebra again", reply_to_id=parent["id"], nonce=nonce).json()["referenced_message"]]
    for ref in refs:
        assert ref["body"] == QUOTED_EDIT and TIMESTAMP_RE.match(ref["edited_at"])
    assert post_msg(app_url, a["token"], ch, "new reply", reply_to_id=parent["id"]).json()["referenced_message"]["body"] == QUOTED_EDIT
    req(app_url, "DELETE", f"/api/messages/{parent['id']}", owner["token"])
    after = next(x for x in history(app_url, a["token"], ch)["data"] if x["id"] == reply["id"])
    assert after["reply_to_id"] is None and after["referenced_message"] is None
    assert post_msg(app_url, a["token"], ch, "zebra", nonce=nonce).json()["referenced_message"] is None


def test_exact_counters(app_url: str) -> None:
    owner, people, com, ch = space(app_url, 10)
    parent = post_msg(app_url, owner["token"], ch, "count me").json()["id"]
    replies = together([lambda p=p: post_msg(app_url, p["token"], ch, "r", reply_to_id=parent) for p in people])
    assert {r.status_code for r in replies} == {201}

    def parent_view() -> dict:
        return next(x for x in history(app_url, owner["token"], ch, limit=100)["data"] if x["id"] == parent)

    assert parent_view()["reply_count"] == 10
    together([lambda p=p, r=r: req(app_url, "DELETE", f"/api/messages/{r.json()['id']}", p["token"]) for p, r in list(zip(people, replies))[:5]])
    assert parent_view()["reply_count"] == 5
    nonce = uuid.uuid4().hex
    post_msg(app_url, people[0]["token"], ch, "nonce reply", reply_to_id=parent, nonce=nonce)
    post_msg(app_url, people[0]["token"], ch, "nonce reply", reply_to_id=parent, nonce=nonce)
    assert parent_view()["reply_count"] == 6
    together([lambda p=p: req(app_url, "PUT", f"/api/messages/{parent}/reactions/{quote('🎉')}", p["token"]) for p in people])
    assert parent_view()["reactions"] == [{"emoji": "🎉", "count": 10, "me": False}]
    target = people[1]
    msg = post_msg(app_url, owner["token"], ch, f"ping @{target['username']}").json()["id"]
    assert read_state(app_url, target["token"], com["slug"], ch)["mention_count"] == 1
    req(app_url, "PATCH", f"/api/messages/{msg}", owner["token"], body={"body": "ping nobody"})
    assert read_state(app_url, target["token"], com["slug"], ch)["mention_count"] == 0
    req(app_url, "PATCH", f"/api/messages/{msg}", owner["token"], body={"body": f"ping @{target['username']} again"})
    assert read_state(app_url, target["token"], com["slug"], ch)["mention_count"] == 1


def test_wf_messaging_thread_quote(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    parent = post_msg(app_url, owner["token"], ch, "hello").json()
    post_msg(app_url, m["token"], ch, MY_ANSWER, reply_to_id=parent["id"])
    dn = owner["display_name"]
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        expect(page.get_by_text(f"Replying to {dn}: hello", exact=True)).to_be_visible()
        req(app_url, "PATCH", f"/api/messages/{parent['id']}", owner["token"], body={"body": "a" * (QUOTE_CUT + 20)})
        expect(page.get_by_text(f"Replying to {dn}: " + "a" * QUOTE_CUT + "… (edited)", exact=True)).to_be_visible(timeout=LIVE_MS)
        req(app_url, "DELETE", f"/api/messages/{parent['id']}", owner["token"])
        expect(page.get_by_text(re.compile(r"^Replying to "))).to_have_count(0, timeout=LIVE_MS)
        expect(page.get_by_text(MY_ANSWER)).to_be_visible()
    assert history(app_url, m["token"], ch)["data"][-1]["reply_to_id"] is None


def test_wf_messaging_owner_deletes(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    target = post_msg(app_url, m["token"], ch, REMOVE_ME).json()["id"]
    with browse(browser) as page:
        open_channel(page, app_url, owner, com["id"], ch)
        page.get_by_text(REMOVE_ME).hover()
        btn(page, "Delete message").click()
        expect(page.get_by_text(REMOVE_ME)).to_have_count(0, timeout=LIVE_MS)
    assert target not in [x["id"] for x in history(app_url, m["token"], ch)["data"]]


def test_workspace_layout(browser: Browser, app_url: str) -> None:
    m = new_member(app_url, "lay")
    join(app_url, m["token"], "aurora-collective")
    au = aurora(app_url)
    with browse(browser) as page:
        open_channel(page, app_url, m, au["id"], channel_named(au, "general"))
        rail, channels = page.get_by_role("navigation", name="Communities"), page.get_by_role("navigation", name="Channels")
        assert box(rail)["width"] <= RAIL_MAX_PX
        assert SIDEBAR_MIN_PX <= box(channels)["width"] <= SIDEBAR_MAX_PX
        expect(channels.get_by_role("heading", name="Text Channels")).to_be_visible()
        expect(channels.get_by_role("heading", name="Voice Channels")).to_be_visible()
        expect(channels.get_by_role("link", name="general", exact=True)).to_have_attribute("aria-current", "page")
        expect(page.get_by_role("heading", level=1)).to_have_text("general")
        members = page.get_by_role("complementary", name="Members")
        expect(members.get_by_role("list", name=re.compile(r"^Online \(\d+\)$"))).to_be_visible()
        expect(members.get_by_role("list", name=re.compile(r"^Offline \(\d+\)$"))).to_have_count(1)
        page.get_by_role("textbox", name=composer_name()).focus()
        page.keyboard.press("Alt+ArrowDown")
        expect(page).to_have_url(f"{app_url}/channels/{au['id']}/{channel_named(au, 'announcements')}")
        page.keyboard.press("Alt+ArrowDown")
        expect(page.get_by_text(f"Slowmode is on: one message every {SLOWMODE_S} seconds.")).to_be_visible()
        page.keyboard.press("Alt+ArrowUp")
        expect(page.get_by_role("heading", level=1)).to_have_text("announcements")
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text("announcements")
        assert tab_order(page, 1) == ["Skip to main content"]
        axe(page)


def test_wf_live_workspace_composer(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        composer = page.get_by_role("textbox", name=composer_name())
        composer.press_sequentially(LINE_ONE)
        composer.press("Shift+Enter")
        composer.press_sequentially(LINE_TWO)
        composer.press("Enter")
        expect(page.get_by_text(LINE_ONE)).to_be_visible()
        expect(page.get_by_text(m["display_name"]).first).to_be_visible()
        stored = poll(lambda: [x for x in history(app_url, m["token"], ch)["data"] if x["body"] == LINE_ONE + "\n" + LINE_TWO], 5, "message stored")
        page.wait_for_function("t => [...document.querySelectorAll('time')].some(e => Date.parse(e.getAttribute('datetime')) === Date.parse(t))", arg=stored[0]["created_at"])
        state = {"n": 0}

        def lose_answer(route: Any) -> None:
            if route.request.method == "POST" and state["n"] == 0:
                state["n"] += 1
                route.fetch()
                route.abort()
                return
            route.continue_()

        page.route(re.compile(r"/api/channels/\d+/messages$"), lose_answer)
        composer.press_sequentially(FLAKY_TEXT)
        composer.press("Enter")
        expect(page.get_by_text("Message failed to send. Tap to retry.")).to_be_visible()
        btn(page, "Retry").click()
        expect(btn(page, "Retry")).to_have_count(0)
    assert len([x for x in history(app_url, m["token"], ch)["data"] if x["body"] == FLAKY_TEXT]) == 1


def test_wf_live_workspace_live_stream(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    for i in range(MESSAGE_PAGE + 5):
        post_msg(app_url, owner["token"], ch, f"{OLDER} {i:02d}")
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        expect(page.get_by_text(f"{OLDER} {MESSAGE_PAGE + 4:02d}")).to_be_visible()
        expect(page.get_by_text(f"{OLDER} {0:02d}", exact=True)).to_have_count(0)
        live = post_msg(app_url, owner["token"], ch, LIVE_HELLO).json()["id"]
        expect(page.get_by_text(LIVE_HELLO)).to_be_visible(timeout=LIVE_MS)
        req(app_url, "PATCH", f"/api/messages/{live}", owner["token"], body={"body": LIVE_CHANGED})
        expect(page.get_by_text(LIVE_CHANGED)).to_be_visible(timeout=LIVE_MS)
        expect(page.get_by_text("(edited)")).to_be_visible(timeout=LIVE_MS)
        req(app_url, "PUT", f"/api/messages/{live}/reactions/{quote('👍')}", owner["token"])
        expect(btn(page, "thumbs up: 1")).to_be_visible(timeout=LIVE_MS)
        req(app_url, "DELETE", f"/api/messages/{live}", owner["token"])
        expect(page.get_by_text(LIVE_CHANGED)).to_have_count(0, timeout=LIVE_MS)

        def scrolled_to_top() -> bool:
            page.get_by_text(re.compile("^" + re.escape(OLDER) + r" \d\d$")).first.hover()
            page.mouse.wheel(0, -4000)
            return page.get_by_text(f"{OLDER} {0:02d}", exact=True).count() > 0

        poll(scrolled_to_top, 15, "older history")
        post_msg(app_url, owner["token"], ch, FRESH_TEXT)
        jump = btn(page, "Jump to new messages")
        expect(jump).to_be_visible(timeout=LIVE_MS)
        jump.click()
        expect(page.get_by_text(FRESH_TEXT)).to_be_in_viewport()
    assert history(app_url, m["token"], ch)["data"][-1]["body"] == FRESH_TEXT


def test_message_actions(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    target = post_msg(app_url, owner["token"], ch, REACT_TARGET).json()["id"]
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        first_visible(page.get_by_text(REACT_TARGET)).hover()
        btn(page, "Add reaction").click()
        dialog = page.get_by_role("dialog", name="Choose a reaction")
        expect(dialog.get_by_role("button", name="thumbs up")).to_be_focused()
        dialog.get_by_role("button", name="fire").click()
        chip = btn(page, "fire: 1")
        expect(chip).to_have_attribute("aria-pressed", "true")
        poll(lambda: next(x for x in history(app_url, m["token"], ch)["data"] if x["id"] == target)["reactions"] == [{"emoji": "🔥", "count": 1, "me": True}], 5, "reaction stored")
        chip.click()
        expect(btn(page, "fire: 1")).to_have_count(0)
        poll(lambda: next(x for x in history(app_url, m["token"], ch)["data"] if x["id"] == target)["reactions"] == [], 5, "reaction removed")
        first_visible(page.get_by_text(REACT_TARGET)).hover()
        btn(page, "Reply in thread").click()
        thread = page.get_by_role("complementary", name="Thread")
        reply_box = thread.get_by_role("textbox", name="Thread reply")
        reply_box.fill(THREAD_TEXT)
        reply_box.press("Enter")
        poll(lambda: [x["body"] for x in req(app_url, "GET", f"/api/messages/{target}/replies", m["token"]).json()["data"]] == [THREAD_TEXT], 5, "reply stored")
        expect(first_visible(page.get_by_text("1 reply"))).to_be_visible()
        thread.get_by_role("button", name="Close thread").click()
        assert_unavailable(page.get_by_role("complementary", name="Thread", include_hidden=True))
        first_visible(page.get_by_text(THREAD_TEXT)).hover()
        btn(page, "Edit message").click()
        editor = page.get_by_role("textbox", name="Edit message text")
        editor.fill(THREAD_EDIT)
        editor.press("Enter")
        expect(first_visible(page.get_by_text("(edited)"))).to_be_visible()
        first_visible(page.get_by_text(THREAD_EDIT)).hover()
        btn(page, "Edit message").click()
        page.get_by_role("textbox", name="Edit message text").fill(UNSAVED_TEXT)
        page.keyboard.press("Escape")
        expect(page.get_by_text(UNSAVED_TEXT)).to_have_count(0)
        composer = page.get_by_role("textbox", name=composer_name())
        composer.press_sequentially("@" + owner["username"][:7])
        options = page.get_by_role("listbox", name="Mention a member").get_by_role("option")
        expect(options.first).to_have_accessible_name(owner["username"])
        composer.press("ArrowUp")
        composer.press("ArrowDown")
        composer.press("Enter")
        poll(lambda: field_value(composer) == f"@{owner['username']} ", 5, "mention inserted")
        composer.press("Enter")
    poll(lambda: owner["id"] in history(app_url, m["token"], ch)["data"][-1]["mentions"], 5, "mention stored")
    replies = req(app_url, "GET", f"/api/messages/{target}/replies", m["token"]).json()["data"]
    assert replies[0]["body"] == THREAD_EDIT


ENTRANCE_JS = """body => { window.__entrance = []; const seen = new Set();
  const record = el => { for (const a of el.getAnimations({subtree: true})) { if (seen.has(a)) continue; seen.add(a);
      const t = a.effect.getComputedTiming(); const kf = a.effect.getKeyframes ? a.effect.getKeyframes() : [];
      window.__entrance.push({total: (t.delay || 0) + (t.duration || 0), duration: t.duration || 0,
        start: kf.length ? JSON.stringify(kf[0]) : ''}); } };
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes)
      if (n.nodeType === 1 && n.textContent.includes(body)) { record(n); requestAnimationFrame(() => record(n)); } })
    .observe(document.body, {childList: true, subtree: true});
  document.addEventListener('transitionrun', e => { if (e.target.textContent.includes(body)) record(e.target); }, true);
  document.addEventListener('animationstart', e => { if (e.target.textContent.includes(body)) record(e.target); }, true); }"""


def test_message_entrance(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    for motion_pref in ("no-preference", "reduce"):
        body = f"entrance {motion_pref}"
        with browse(browser, reduced_motion=motion_pref) as page:
            open_channel(page, app_url, m, com["id"], ch)
            page.evaluate(ENTRANCE_JS, body)
            post_msg(app_url, owner["token"], ch, body)
            expect(page.get_by_text(body)).to_be_visible(timeout=LIVE_MS)
            moving = [a for a in page.evaluate("() => window.__entrance") if a["duration"] > 0]
            if motion_pref == "reduce":
                assert moving == []
            else:
                assert moving and all(ENTRANCE_MIN_MS <= a["total"] <= ENTRANCE_MAX_MS for a in moving)


def test_refused_changes_roll_back(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    post_msg(app_url, m["token"], ch, "stored body")
    refusal = json.dumps({"error": {"code": "forbidden", "message": MESSAGES["forbidden"], "field": None}})
    edit_refusal = json.dumps({"error": {"code": "validation_failed", "message": MESSAGES["validation_failed"], "field": "body"}})
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        page.route(re.compile(r"/api/messages/\d+/reactions/"), lambda r: r.fulfill(status=403, content_type="application/json", body=refusal))
        page.get_by_text("stored body").hover()
        btn(page, "Add reaction").click()
        page.get_by_role("dialog", name="Choose a reaction").get_by_role("button", name="heart").click()
        expect(btn(page, "heart: 1")).to_have_count(0, timeout=ROLLBACK_MS)
        status = page.get_by_role("status", name="Workspace status")
        expect(status).to_have_text("Your reaction could not be saved.")
        page.route(re.compile(r"/api/messages/\d+$"), lambda r: r.fulfill(status=422, content_type="application/json", body=edit_refusal)
                   if r.request.method == "PATCH" else r.continue_())
        page.get_by_text("stored body").hover()
        btn(page, "Edit message").click()
        editor = page.get_by_role("textbox", name="Edit message text")
        editor.fill(REJECTED_TEXT)
        editor.press("Enter")
        expect(status).to_have_text("Your edit could not be saved.")
        expect(editor).to_have_value(REJECTED_TEXT)
    msg = history(app_url, m["token"], ch)["data"][-1]
    assert msg["body"] == "stored body" and msg["reactions"] == [] and msg["edited_at"] is None


def test_wf_live_workspace_reconnect(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    owner_y = new_member(app_url, "ry")
    com_y = new_community(app_url, owner_y["token"])
    join(app_url, m["token"], com_y["slug"])
    early = post_msg(app_url, owner["token"], ch, BEFORE_DROP).json()["id"]
    gone = post_msg(app_url, owner["token"], ch, VANISH_TEXT).json()["id"]
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        rail = page.get_by_role("navigation", name="Communities")
        expect(rail.get_by_role("link", name=com_y["name"])).to_be_visible()
        status = page.get_by_role("status", name="Workspace status")
        page.context.set_offline(True)
        expect(status).to_have_text("Reconnecting…", timeout=LIVE_MS)
        for i in range(3):
            post_msg(app_url, owner["token"], ch, f"{MISSED} {i}")
        req(app_url, "PATCH", f"/api/messages/{early}", owner["token"], body={"body": BEFORE_DROP_EDITED})
        req(app_url, "DELETE", f"/api/messages/{gone}", owner["token"])
        req(app_url, "PUT", f"/api/messages/{early}/reactions/{quote('👀')}", owner["token"])
        req(app_url, "PUT", f"/api/servers/{com_y['slug']}/bans/{m['id']}", owner_y["token"])
        page.context.set_offline(False)
        expect(status).to_have_text("Connected.", timeout=LIVE_MS)
        for i in range(3):
            expect(page.get_by_text(f"{MISSED} {i}", exact=True)).to_have_count(1)
        expect(page.get_by_text(BEFORE_DROP_EDITED)).to_be_visible()
        expect(page.get_by_text(VANISH_TEXT)).to_have_count(0)
        expect(btn(page, "eyes: 1")).to_be_visible()
        expect(rail.get_by_role("link", name=com_y["name"])).to_have_count(0)
        ys = [page.get_by_text(f"{MISSED} {i}", exact=True).bounding_box()["y"] for i in range(3)]
        assert ys == sorted(ys)
    assert [x["body"] for x in history(app_url, m["token"], ch)["data"]][-3:] == [f"{MISSED} {i}" for i in range(3)]


def test_multi_instance(browser: Browser, app_url: str, app2_url: str, mail: Mailpit) -> None:
    lock_user = new_member(app_url, "mi")
    for base in (app_url, app_url, app_url, app2_url, app2_url):
        refused(req(base, "POST", "/api/auth/login", body={"email": lock_user["email"], "password": "wrong-pass-0000"}), 401, "invalid_credentials")
    for base in (app_url, app2_url):
        refused(req(base, "POST", "/api/auth/login", body={"email": lock_user["email"], "password": PASSWORD}), 429, "rate_limited")
    _, ticket = fresh("mit")
    body = {"email": ticket, "category": "other", "subject": "Split", "body": "Split across instances."}
    for base in (app_url, app_url, app2_url):
        assert req(base, "POST", "/api/support/tickets", body=body).status_code == 201
    for base in (app_url, app2_url):
        refused(req(base, "POST", "/api/support/tickets", body=body), 429, "rate_limited")
    refused(req(app2_url, "PATCH", "/api/users/@me", lock_user["token"], body={"status": "idle"}, headers={"Origin": "https://evil.example"}), 403, "forbidden")
    slow = channel_named(aurora(app_url), "slow-lane")
    s = new_member(app2_url, "mis")
    join(app_url, s["token"], "aurora-collective")
    nonce = uuid.uuid4().hex
    assert post_msg(app_url, s["token"], slow, "split slow", nonce=nonce).status_code == 201
    assert post_msg(app2_url, s["token"], slow, "split slow", nonce=nonce).status_code == 200
    refused(post_msg(app2_url, s["token"], slow, "too soon"), 429, "rate_limited")
    mail_for(mail, s["email"], 1)
    assert len(mail_for(mail, s["email"], 2, seconds=MAIL_SETTLE_S * 3)) == 1
    owner, (reader,), com, ch = space(app_url, 1)
    joiner = new_member(app_url, "mij")
    join(app2_url, joiner["token"], com["slug"])
    assert detail(app_url, com["slug"]).json()["member_count"] == 3
    inv = req(app_url, "POST", f"/api/servers/{com['slug']}/invites", owner["token"], body={"max_uses": 1}).json()
    assert req(app2_url, "POST", f"/api/invites/{inv['code']}/accept", new_member(app_url, "mi1")["token"]).status_code == 201
    refused(req(app_url, "POST", f"/api/invites/{inv['code']}/accept", new_member(app_url, "mi2")["token"]), 404, "not_found")
    data = jpeg_bytes(40, 20, 6)
    att = upload(app_url, owner["token"], "split.jpg", data).json()
    served = req(app2_url, "GET", att["url"])
    assert served.content == data and served.headers["etag"] == f'"{att["sha256"]}"'
    assert checkout(app_url, owner["token"], "max").status_code == 200
    long_body = "🎮" * MAX_BODY_LONG
    cid = com["id"]
    with browse(browser) as page:
        token = open_channel(page, app2_url, reader, cid, ch)
        posted = post_msg(app_url, owner["token"], ch, long_body)
        assert posted.status_code == 201
        expect(page.get_by_text(long_body, exact=True)).to_be_visible(timeout=LIVE_MS)
        assert history(app2_url, reader["token"], ch)["data"][-1]["body"] == long_body
        assert req(app_url, "POST", "/api/auth/logout", token).status_code == 204
        expect(page).to_have_url(f"{app2_url}/login?next={encode_uri_component(f'/channels/{cid}/{ch}')}", timeout=LIVE_MS)


def test_closed_workspace_panels(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    post_msg(app_url, owner["token"], ch, PANEL_TARGET)
    with browse(browser, EDGE_TABLET_LOW, TABLET_H) as page:
        open_channel(page, app_url, m, com["id"], ch)
        for role, name in (("complementary", "Members"), ("complementary", "Thread"), ("complementary", "Search results"),
                           ("region", "Notifications"), ("dialog", "Choose a reaction")):
            assert_unavailable(page.get_by_role(role, name=name, include_hidden=True))
            never_focused(page, page.get_by_role(role, name=name, include_hidden=True), presses=15)
        show = btn(page, "Show members")
        expect(show).to_have_attribute("aria-expanded", "false")
        show.click()
        members = page.get_by_role("complementary", name="Members")
        expect(members).to_be_visible()
        members.evaluate("p => { p.tabIndex = -1; p.focus(); }")
        assert members.evaluate("p => p.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(show).to_have_attribute("aria-expanded", "false")
        expect(show).to_be_focused()
        first_visible(page.get_by_text(PANEL_TARGET)).hover()
        btn(page, "Reply in thread").click()
        page.get_by_role("textbox", name="Thread reply").click()
        page.keyboard.press("Escape")
        assert_unavailable(page.get_by_role("complementary", name="Thread", include_hidden=True))
        expect(btn(page, "Reply in thread")).to_be_focused()
        search = page.get_by_role("searchbox", name="Search messages")
        search.fill("panel")
        search.press("Enter")
        btn(page, "Close search").focus()
        page.keyboard.press("Escape")
        expect(search).to_be_focused()
        bell = page.get_by_role("button", name=re.compile(r"^Notifications"))
        bell.click()
        btn(page, "Mark all as read").focus()
        page.keyboard.press("Escape")
        expect(bell).to_be_focused()
        first_visible(page.get_by_text(PANEL_TARGET)).hover()
        btn(page, "Add reaction").click()
        page.keyboard.press("Escape")
        assert_unavailable(page.get_by_role("dialog", name="Choose a reaction", include_hidden=True))
        expect(btn(page, "Add reaction")).to_be_focused()
    with browse(browser, PHONE_W, PHONE_H) as page:
        open_channel(page, app_url, m, com["id"], ch)
        opener = btn(page, "Open channels")
        assert_unavailable(page.get_by_role("navigation", name="Channels", include_hidden=True))
        opener.click()
        expect(opener).to_have_attribute("aria-expanded", "true")
        page.get_by_role("navigation", name="Channels").get_by_role("link", name="general").focus()
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        assert_unavailable(page.get_by_role("navigation", name="Channels", include_hidden=True))


def test_workspace_breakpoints(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    post_msg(app_url, owner["token"], ch, BREAKPOINT_TARGET)
    for width in (EDGE_PHONE, EDGE_TABLET_LOW, EDGE_TABLET_HIGH, EDGE_DESKTOP):
        with browse(browser, width, DESKTOP_H) as page:
            open_channel(page, app_url, m, com["id"], ch)
            if width == EDGE_PHONE:
                expect(btn(page, "Open channels")).to_be_visible()
                assert_unavailable(page.get_by_role("navigation", name="Communities", include_hidden=True))
                continue
            expect(btn(page, "Open channels")).to_have_count(0)
            channels = page.get_by_role("navigation", name="Channels")
            expect(page.get_by_role("navigation", name="Communities")).to_be_visible()
            if width < EDGE_DESKTOP:
                expect(btn(page, "Show members")).to_be_visible()
                assert_unavailable(page.get_by_role("complementary", name="Members", include_hidden=True))
                page.get_by_text(BREAKPOINT_TARGET).hover()
                btn(page, "Reply in thread").click()
                panel = page.get_by_role("complementary", name="Thread")
                expect(panel).to_be_visible()
                assert box(panel)["x"] >= box(channels)["x"] + box(channels)["width"] - 1
            else:
                expect(btn(page, "Show members")).to_have_count(0)
                expect(page.get_by_role("complementary", name="Members")).to_be_visible()
                search = page.get_by_role("searchbox", name="Search messages")
                search.fill("breakpoint")
                search.press("Enter")
                panel = page.get_by_role("complementary", name="Search results")
                expect(panel).to_be_visible()
                assert box(panel)["x"] - (box(channels)["x"] + box(channels)["width"]) >= STREAM_MIN_PX


def test_directory_api(app_url: str) -> None:
    r = req(app_url, "GET", "/api/servers").json()
    assert set(r) == {"data", "page", "per_page", "total"} and r["page"] == 1 and r["per_page"] == PER_PAGE_DEFAULT
    assert len(r["data"]) == PER_PAGE_DEFAULT
    keys = [(-c["member_count"], c["slug"]) for c in r["data"]]
    assert keys == sorted(keys)
    for c in r["data"]:
        assert set(c) == COMMUNITY_KEYS
    big = req(app_url, "GET", "/api/servers", params={"per_page": PER_PAGE_MAX}).json()
    assert "draft-hall" not in [c["slug"] for c in big["data"]] and len(big["data"]) <= PER_PAGE_MAX
    for params, field in (({"page": 0}, "page"), ({"page": PAGE_MAX + 1}, "page"), ({"page": "x"}, "page"), ({"page": "1.5"}, "page"),
                          ({"per_page": 0}, "per_page"), ({"per_page": PER_PAGE_MAX + 1}, "per_page"), ({"category": "sports"}, "category")):
        refused(req(app_url, "GET", "/api/servers", params=params), 422, "validation_failed", field)


def test_directory_search_category(app_url: str) -> None:
    owner = new_member(app_url, "dsc")
    tag = uuid.uuid4().hex[:10]
    named = new_community(app_url, owner["token"], category="science-and-tech", name=f"Quasar{tag}", description="plain words")
    described = new_community(app_url, owner["token"], category="music", description=f"about nebula{tag} things")
    assert [c["slug"] for c in req(app_url, "GET", "/api/servers", params={"q": f"QUASAR{tag}"}).json()["data"]] == [named["slug"]]
    assert [c["slug"] for c in req(app_url, "GET", "/api/servers", params={"q": f"Nebula{tag}"}).json()["data"]] == [described["slug"]]
    assert "starlight-studio" in [c["slug"] for c in req(app_url, "GET", "/api/servers", params={"q": "LO_FI"}).json()["data"]]
    assert req(app_url, "GET", "/api/servers", params={"q": f"quasar{tag}", "category": "music"}).json()["total"] == 0
    assert req(app_url, "GET", "/api/servers", params={"q": f"quasar{tag}", "category": "all"}).json()["total"] == 1
    music = req(app_url, "GET", "/api/servers", params={"category": "music", "per_page": PER_PAGE_MAX}).json()["data"]
    assert music and all(c["category"] == "music" for c in music)


def test_literal_directory_search(app_url: str) -> None:
    def slugs(q: str) -> list[str]:
        r = req(app_url, "GET", "/api/servers", params={"q": q})
        assert r.status_code == 200
        return [c["slug"] for c in r.json()["data"]]

    assert slugs("%") == ["pixel-parlor"] and slugs("  %  ") == ["pixel-parlor"]
    assert slugs("_") == ["starlight-studio"]
    r = req(app_url, "GET", "/api/servers", params={"q": "\\"})
    assert r.status_code == 200 and r.json()["total"] == 0
    assert req(app_url, "GET", "/api/servers", params={"q": "🎮" * DIRECTORY_Q_MAX}).status_code == 200
    refused(req(app_url, "GET", "/api/servers", params={"q": "🎮" * (DIRECTORY_Q_MAX + 1)}), 422, "validation_failed", "q")
    refused(req(app_url, "GET", "/api/servers", params={"page": PAGE_MAX + 1}), 422, "validation_failed", "page")
    past = req(app_url, "GET", "/api/servers", params={"q": "%", "page": 2}).json()
    assert past["data"] == [] and past["total"] == 1


def test_wf_directory_cards(browser: Browser, app_url: str) -> None:
    page1 = req(app_url, "GET", "/api/servers").json()["data"]
    page2 = req(app_url, "GET", "/api/servers", params={"page": 2}).json()["data"]
    with browse(browser) as page:
        page.goto(app_url + "/servers")
        expect(page.get_by_role("heading", level=1)).to_have_text("FIND YOUR NEXT COMMUNITY")
        cards = page.get_by_role("main").get_by_role("article")
        expect(cards).to_have_count(len(page1))
        for i, c in enumerate(page1):
            card = cards.nth(i)
            expect(card.get_by_role("heading").get_by_role("link")).to_have_attribute("href", re.compile(rf"/servers/{c['slug']}$"))
            expect(card.get_by_role("img", name=f"{c['name']} icon")).to_have_count(1)
            expect(card).to_contain_text(f"{c['presence_count']:,} Online")
            expect(card).to_contain_text(f"{c['member_count']:,} Members")
            if c["verified"]:
                expect(card).to_contain_text("Verified")
            elif c["partnered"]:
                expect(card).to_contain_text("Partnered")
            imgs = card.evaluate("a => [...a.getElementsByTagName('img')].map(i => ({alt: i.getAttribute('alt'), lazy: i.loading, w: i.hasAttribute('width'), h: i.hasAttribute('height')}))")
            assert all(x["w"] and x["h"] for x in imgs) and any(x["alt"] == "" and x["lazy"] == "lazy" for x in imgs)
        page.get_by_role("link", name="Next page").click()
        poll(lambda: urlsplit(page.url).path == "/servers" and qs(page.url) == {"page": "2"}, 5, "page in address")
        expect(cards.first.get_by_role("heading")).to_have_text(page2[0]["name"])
        first = page1[0]
        page.goto(f"{app_url}/servers/{first['slug']}")
        expect(page.get_by_role("heading", level=1)).to_have_text(first["name"])
        expect(page.get_by_role("main")).to_contain_text(f"{first['member_count']:,} Members")
        expect(btn(page, "Join community")).to_be_visible()


def test_wf_directory_filters(browser: Browser, app_url: str) -> None:
    music = req(app_url, "GET", "/api/servers", params={"category": "music"}).json()
    term = "zz" + uuid.uuid4().hex[:8]
    with browse(browser) as page:
        page.goto(app_url + "/servers")
        chips = page.get_by_role("group", name="Categories")
        chip = chips.get_by_role("button", name=re.compile(r"^Music \("))
        expect(chip).to_have_text(f"Music ({music['total']:,})")
        chip.click()
        expect(chip).to_have_attribute("aria-pressed", "true")
        expect(page).to_have_url(f"{app_url}/servers?category=music")
        status = page.get_by_role("status", name="Directory results")
        expect(status).to_have_text("1 community" if music["total"] == 1 else f"{music['total']} communities")
        names = page.get_by_role("main").get_by_role("article").get_by_role("heading")
        expect(names).to_have_text([c["name"] for c in music["data"]])
        page.get_by_role("searchbox", name="Search popular communities").fill(term)
        expect(page).to_have_url(f"{app_url}/servers?q={term}&category=music")
        expect(status).to_contain_text("0 communities")
        expect(page.get_by_text("No communities match your search.")).to_be_visible()
        page.reload()
        expect(page.get_by_role("searchbox", name="Search popular communities")).to_have_value(term)
        expect(chips.get_by_role("button", name=re.compile(r"^Music \("))).to_have_attribute("aria-pressed", "true")
        btn(page, "Reset filters").click()
        expect(page).to_have_url(f"{app_url}/servers")
        expect(chips.get_by_role("button", name=re.compile(r"^All \("))).to_have_attribute("aria-pressed", "true")
        page.go_back()
        expect(page).to_have_url(f"{app_url}/servers?q={term}&category=music")
        expect(page.get_by_role("searchbox", name="Search popular communities")).to_have_value(term)
        page.go_forward()
        expect(page).to_have_url(f"{app_url}/servers")
        page.get_by_role("searchbox", name="Search popular communities").fill("%")
        expect(page).to_have_url(f"{app_url}/servers?q={quote('%')}")
        expect(names).to_have_text(["Pixel Parlor"])


def test_wf_directory_latest_wins(browser: Browser, app_url: str) -> None:
    edu = req(app_url, "GET", "/api/servers", params={"category": "education"}).json()
    with browse(browser) as page:
        stash: list[Any] = []

        armed: list[bool] = []

        def handler(route: Any) -> None:
            if armed and qs(route.request.url).get("category") == "music" and not stash:
                stash.append(route)
                return
            route.continue_()

        page.route(re.compile(r"/api/servers(\?|$)"), handler)
        page.goto(app_url + "/servers")
        chips = page.get_by_role("group", name="Categories")
        expect(chips.get_by_role("button", name=re.compile(r"^Music \("))).to_be_visible()
        armed.append(True)
        chips.get_by_role("button", name=re.compile(r"^Music \(")).click()
        poll(lambda: stash, 5, "held music request")
        chips.get_by_role("button", name=re.compile(r"^Education \(")).click()
        status = page.get_by_role("status", name="Directory results")
        expect(status).to_have_text(f"{edu['total']} communities" if edu["total"] != 1 else "1 community")
        release(stash[0])
        expect(page).to_have_url(app_url + "/servers?category=" + "education")
        expect(chips.get_by_role("button", name=re.compile(r"^Education \("))).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("main").get_by_role("article").get_by_role("heading")).to_have_text([c["name"] for c in edu["data"]])


def test_wf_directory_breakpoints(browser: Browser, app_url: str) -> None:
    for width, cols in ((EDGE_PHONE, 1), (EDGE_TABLET_LOW, 2), (EDGE_TABLET_HIGH, 2), (EDGE_DESKTOP, 4)):
        with browse(browser, width, DESKTOP_H) as page:
            page.goto(app_url + "/servers")
            cards = [box(c) for c in page.get_by_role("main").get_by_role("article").all()]
            first_row = [c for c in cards if abs(c["y"] - cards[0]["y"]) < 1]
            assert len({round(c["x"]) for c in first_row}) == cols
            layout(page)
            page.goto(app_url + "/servers/aurora-collective")
            h1, join_btn = box(page.get_by_role("heading", level=1)), box(btn(page, "Join community"))
            if width == EDGE_PHONE:
                assert join_btn["x"] < h1["x"] + h1["width"] and join_btn["y"] > h1["y"]
            else:
                assert join_btn["x"] >= h1["x"] + h1["width"] - 1
    with browse(browser, REFLOW_PX, PHONE_H) as page:
        page.goto(app_url + "/servers")
        layout(page)
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        chips = [box(c) for c in page.get_by_role("group", name="Categories").get_by_role("button").all()]
        assert all(c["x"] + c["width"] <= REFLOW_PX + 1 for c in chips)
        assert len({round(c["y"]) for c in chips}) > 1


def test_media_uploads(app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    t = m["token"]
    cases = [("a.png", png_bytes(3, 2, b"meta"), "image/png", 3, 2, None),
             ("b.gif", gif_bytes(7, 5), "image/gif", 7, 5, None),
             ("c.webp", webp_bytes(9, 4), "image/webp", 9, 4, None),
             ("d.jpg", jpeg_bytes(40, 20, 6, "II"), "image/jpeg", 20, 40, None),
             ("e.jpg", jpeg_bytes(40, 20, 8, "MM"), "image/jpeg", 20, 40, None),
             ("f.jpg", jpeg_bytes(40, 20, 3, "II"), "image/jpeg", 40, 20, None),
             ("g.webm", webm_bytes(320, 180, 4321.6), "video/webm", 320, 180, 4322),
             ("h.webm", webm_bytes(64, 48, 2.7, scale=None), "video/webm", 64, 48, 3),
             ("i.png", b"<html><script>alert(1)</script></html>", "application/octet-stream", None, None, None)]
    ids = []
    for name, data, ctype, w, h, dur in cases:
        r = upload(app_url, t, name, data)
        assert r.status_code == 201, (name, r.text)
        a = r.json()
        assert set(a) == ATTACHMENT_KEYS and a["filename"] == name and a["size_bytes"] == len(data)
        assert a["content_type"] == ctype and (a["width"], a["height"], a["duration_ms"]) == (w, h, dur), name
        assert a["sha256"] == hashlib.sha256(data).hexdigest() and a["url"] == f"/media/{a['id']}"
        ids.append(a)
    png, raw = ids[0], cases[0][1]
    size = len(raw)
    r = req(app_url, "GET", png["url"], headers={"Range": "bytes=0-3"})
    assert r.status_code == 206 and r.content == raw[:4] and r.headers["content-range"] == f"bytes 0-3/{size}"
    r = req(app_url, "GET", png["url"], headers={"Range": "bytes=-4"})
    assert r.status_code == 206 and r.content == raw[-4:]
    r = req(app_url, "GET", png["url"], headers={"Range": f"bytes=2-{size * 10}"})
    assert r.content == raw[2:] and r.headers["content-range"] == f"bytes 2-{size - 1}/{size}"
    r = req(app_url, "GET", png["url"], headers={"Range": f"bytes={size}-"})
    refused(r, 416, "range_not_satisfiable")
    assert r.headers["content-range"] == f"bytes */{size}"
    msg = post_msg(app_url, t, ch, "", attachment_ids=[ids[6]["id"], ids[0]["id"]])
    assert msg.status_code == 201 and [a["id"] for a in msg.json()["attachments"]] == [ids[6]["id"], ids[0]["id"]]
    refused(post_msg(app_url, t, ch, "reuse", attachment_ids=[ids[0]["id"]]), 422, "validation_failed", "attachment_ids")
    theirs = upload(app_url, owner["token"], "theirs.png", png_bytes(1, 1)).json()
    refused(post_msg(app_url, t, ch, "steal", attachment_ids=[theirs["id"]]), 422, "validation_failed", "attachment_ids")
    set_overwrite(app_url, owner["token"], ch, "member", m["id"], deny=["attach_files"])
    refused(post_msg(app_url, t, ch, "no files", attachment_ids=[ids[1]["id"]]), 403, "forbidden")
    req(app_url, "DELETE", f"/api/messages/{msg.json()['id']}", t)
    refused(req(app_url, "GET", png["url"]), 404, "not_found")
    refused(upload(app_url, t, "empty.png", b""), 422, "validation_failed", "file")
    body, ctype = multipart(b"x.png", b"data")
    refused(req(app_url, "POST", "/api/attachments", t, content=body.replace(b'name="file"', b'name="other"'), headers={"Content-Type": ctype}),
            422, "validation_failed", "file")


def test_safe_media_serving(app_url: str) -> None:
    m = new_member(app_url, "safe")
    t = m["token"]
    for raw, expected in ((b"C:\\photos\\cat.png", "cat.png"), (b"a/b/cat.png", "cat.png"), ("café ü.png".encode(), "café ü.png"),
                          (("n" * (FILENAME_MAX - 4) + ".png").encode(), "n" * (FILENAME_MAX - 4) + ".png")):
        r = upload(app_url, t, raw, png_bytes(1, 1))
        assert r.status_code == 201 and r.json()["filename"] == expected
    for raw in (b"bad\x01name.png", b"dir/", ("n" * FILENAME_MAX + ".png").encode()):
        refused(upload(app_url, t, raw, png_bytes(1, 1)), 422, "validation_failed", "file")
    img = upload(app_url, t, "café ü.png", png_bytes(2, 2)).json()
    html = upload(app_url, t, "page.html", b"<html><body>hi</body></html>").json()
    for att, kind in ((img, "inline"), (html, "attachment")):
        for headers, status in (({}, 200), ({"Range": "bytes=0-1"}, 206), ({"If-None-Match": f'"{att["sha256"]}"'}, 304)):
            r = req(app_url, "GET", att["url"], headers=headers)
            assert r.status_code == status
            assert r.headers["x-content-type-options"] == "nosniff"
            assert r.headers["content-security-policy"] == "sandbox; default-src 'none'"
            assert r.headers["content-disposition"] == disposition(kind, att["filename"])
    r = req(app_url, "GET", html["url"])
    assert r.headers["content-type"].startswith("application/octet-stream") and r.headers["accept-ranges"] == "bytes"


def test_media_stored_as_submitted(app_url: str) -> None:
    m = new_member(app_url, "stor")
    pg = Postgres()
    col = pg.rows("SELECT column_name FROM information_schema.columns WHERE table_name = 'attachments' AND data_type = 'bytea'")[0]["column_name"]
    for name, data in (("rotated.jpg", jpeg_bytes(40, 20, 6, "MM")), ("meta.png", png_bytes(4, 4, b"keep this chunk"))):
        att = upload(app_url, m["token"], name, data).json()
        digest = hashlib.sha256(data).hexdigest()
        assert att["sha256"] == digest
        r = req(app_url, "GET", att["url"])
        assert r.status_code == 200 and r.content == data and r.headers["etag"] == f'"{digest}"'
        assert int(r.headers["content-length"]) == len(data)
        row = pg.rows(f'SELECT encode(sha256("{col}"), \'hex\') AS h, size_bytes FROM attachments WHERE id = {int(att["id"])}')[0]
        assert row == {"h": digest, "size_bytes": len(data)}
        r = req(app_url, "GET", att["url"], headers={"If-None-Match": f'"{digest}"'})
        assert r.status_code == 304 and r.content == b"" and r.headers["etag"] == f'"{digest}"'
        assert r.headers["x-content-type-options"] == "nosniff" and r.headers["content-security-policy"] == "sandbox; default-src 'none'"
        assert r.headers["content-disposition"] == disposition("inline", name)


def test_wf_media_attach_stream(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    tmp = Path(tempfile.mkdtemp())
    (tmp / PIC_NAME).write_bytes(png_bytes(3, 2))
    (tmp / CLIP_NAME).write_bytes(webm_bytes(320, 180, 4321.6))
    (tmp / EXTRA_NAME).write_bytes(png_bytes(1, 1))
    (tmp / HUGE_NAME).write_bytes(bytes(FREE_UPLOAD + 1))
    with browse(browser) as sender, browse(browser) as reader:
        open_channel(reader, app_url, owner, com["id"], ch)
        open_channel(sender, app_url, m, com["id"], ch)
        uploads: list[int] = []
        sender.on("request", lambda rq: uploads.append(1) if "/api/attachments" in rq.url else None)
        with sender.expect_file_chooser() as fc:
            btn(sender, "Attach files").click()
        fc.value.set_files([str(tmp / n) for n in (PIC_NAME, CLIP_NAME, EXTRA_NAME, HUGE_NAME)])
        expect(sender.get_by_role("status", name="Workspace status")).to_have_text(f"{HUGE_NAME} is larger than your upload limit.")
        pending = sender.get_by_role("list", name="Pending attachments")
        expect(pending.get_by_role("listitem")).to_have_count(3)
        pending.get_by_role("button", name=f"Remove {EXTRA_NAME}").click()
        expect(pending.get_by_role("listitem")).to_have_count(2)
        sender.get_by_role("textbox", name=composer_name()).press("Enter")
        for page in (sender, reader):
            img = page.get_by_role("img", name=PIC_NAME)
            expect(img).to_have_attribute("width", "3", timeout=LIVE_MS)
            expect(img).to_have_attribute("height", "2")
            expect(page.get_by_text("clip.webm · 0:04")).to_be_visible(timeout=LIVE_MS)
            vid = page.locator("video").last
            assert vid.evaluate("v => v.controls && v.getAttribute('preload') === 'metadata' && v.getAttribute('width') === '320' && v.getAttribute('height') === '180'")
        assert len(uploads) == 2
    msg = history(app_url, owner["token"], ch)["data"][-1]
    assert [a["filename"] for a in msg["attachments"]] == [PIC_NAME, CLIP_NAME]


def test_wf_media_video_abandon(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    data = webm_bytes(640, 360, 60000.0, pad=FREE_UPLOAD - 1000)
    att = upload(app_url, m["token"], "big.webm", data).json()
    post_msg(app_url, m["token"], ch, "big video", attachment_ids=[att["id"]])
    pg = Postgres()
    activity = ("SELECT count(*) FILTER (WHERE state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')) AS busy, "
                "count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND backend_type = 'client backend'")
    for i in range(ABANDONS):
        headers = {"Range": f"bytes={i * 1000}-"} if i % 2 else {}
        start = time.monotonic()
        with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) as c, c.stream("GET", att["url"], headers=headers) as r:
            assert r.status_code in (200, 206)
            next(r.iter_bytes())
            assert time.monotonic() - start < RESPONSE_S
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        page.evaluate("u => { fetch(u).then(r => r.body.getReader().read()); }", att["url"])
    baseline = pg.rows(activity)[0]["total"]
    release = threading.Event()
    opened = threading.Barrier(HELD_STREAMS + 1)

    def hold() -> None:
        with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) as c, c.stream("GET", att["url"]) as r:
            next(r.iter_bytes())
            opened.wait()
            release.wait(HTTP_TIMEOUT)

    with ThreadPoolExecutor(HELD_STREAMS) as ex:
        futures = [ex.submit(hold) for _ in range(HELD_STREAMS)]
        opened.wait()
        assert pg.rows(activity)[0]["total"] - baseline <= SESSION_CAP
        release.set()
        for f in futures:
            f.result()
    poll(lambda: pg.rows(activity)[0]["busy"] == 0, RELEASE_S + 2, "abandoned work released")
    for path in ("/api/health", f"/api/channels/{ch}/messages"):
        start = time.monotonic()
        assert req(app_url, "GET", path, m["token"]).status_code == 200
        assert time.monotonic() - start < RESPONSE_S


def test_message_search(app_url: str) -> None:
    owner, (a,), com, ch = space(app_url, 1)
    slug = com["slug"]
    s1 = post_msg(app_url, owner["token"], ch, "art party tonight").json()
    post_msg(app_url, owner["token"], ch, "artistic only")
    s3 = post_msg(app_url, a["token"], ch, f"Art show http://example.com/x @{owner['username']}").json()
    s4 = post_msg(app_url, a["token"], ch, "the red fox jumps").json()
    img = upload(app_url, a["token"], "s.png", png_bytes(1, 1)).json()
    vid = upload(app_url, a["token"], "s.webm", webm_bytes(8, 8, 1000.0)).json()
    s5 = post_msg(app_url, a["token"], ch, "art pics", attachment_ids=[img["id"]]).json()
    s6 = post_msg(app_url, a["token"], ch, "moving art", attachment_ids=[vid["id"]]).json()

    def ids(q: str, **params: Any) -> list[int]:
        r = req(app_url, "GET", f"/api/servers/{slug}/messages/search", a["token"], params={"q": q, **params})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"total_results", "data"}
        return [x["id"] for x in body["data"]]

    assert ids("ART") == [s6["id"], s5["id"], s3["id"], s1["id"]]
    assert ids('"red fox"') == [s4["id"]] and ids('"fox red"') == []
    assert ids(f"art from:{a['username'].upper()}") == [s6["id"], s5["id"], s3["id"]]
    assert ids(f"mentions:{owner['username']}") == [s3["id"]]
    assert ids("art in:general") == [s6["id"], s5["id"], s3["id"], s1["id"]] and ids("art in:nowhere") == []
    assert ids("has:link") == [s3["id"]] and ids("has:image") == [s5["id"]] and ids("has:video") == [s6["id"]]
    assert ids("art has:attachment") == [s6["id"], s5["id"]]
    day = s1["created_at"][:10]
    nxt = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
    prev = (dt.date.fromisoformat(day) - dt.timedelta(days=1)).isoformat()
    assert s1["id"] in ids(f"art during:{day}") and ids(f"art before:{day}") == [] and s1["id"] in ids(f"art after:{prev}")
    assert s1["id"] not in ids(f"art after:{day}")
    assert s1["id"] in ids(f"art before:{nxt}")
    page_ = req(app_url, "GET", f"/api/servers/{slug}/messages/search", a["token"], params={"q": "art", "limit": 2, "offset": 1}).json()
    assert page_["total_results"] == 4 and [x["id"] for x in page_["data"]] == [s5["id"], s3["id"]]
    req(app_url, "DELETE", f"/api/messages/{s1['id']}", owner["token"])
    assert s1["id"] not in ids("art")
    set_overwrite(app_url, owner["token"], ch, "member", a["id"], deny=["view_channel"])
    assert ids("art") == []
    for bad in ("   ", "art has:pdf", "art during:2026-02-30", f"before:{day} before:{day}", "q" * (SEARCH_Q_MAX + 1)):
        refused(req(app_url, "GET", f"/api/servers/{slug}/messages/search", owner["token"], params={"q": bad}), 422, "validation_failed", "q")


def test_wf_search_panel(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    msg = post_msg(app_url, owner["token"], ch, "art party").json()
    post_msg(app_url, owner["token"], ch, "artistic nothing")
    with browse(browser, timezone_id="Asia/Tokyo") as page:
        open_channel(page, app_url, m, com["id"], ch)
        search = page.get_by_role("searchbox", name="Search messages")
        search.fill("art")
        search.press("Enter")
        panel = page.get_by_role("complementary", name="Search results")
        expect(panel.get_by_role("heading", name="1 result")).to_be_visible()
        item = panel.get_by_role("listitem")
        expect(item).to_have_count(1)
        expect(item).to_contain_text("#" + GENERAL)
        expect(item).to_contain_text(owner["display_name"])
        assert item.evaluate("e => [...e.getElementsByTagName('mark')].map(x => x.textContent)") == ["art"]
        stamp = item.evaluate("e => { const t = e.getElementsByTagName('time')[0]; return [t.getAttribute('datetime'), t.textContent]; }")
        assert page.evaluate("([a, b]) => Date.parse(a) === Date.parse(b)", [stamp[0], msg["created_at"]])
        local = (iso(msg["created_at"]) + dt.timedelta(hours=9)).hour
        assert str(local) in stamp[1] or str(local % 12 or 12) in stamp[1]
        page.keyboard.press("Escape")
        expect(search).to_be_focused()
        search.fill("art has:pdf")
        search.press("Enter")
        expect(page.get_by_role("complementary", name="Search results")).to_contain_text("That search could not be run.")
    assert req(app_url, "GET", f"/api/servers/{com['slug']}/messages/search", m["token"], params={"q": "art"}).json()["total_results"] == 1


def test_wf_search_latest_wins(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    for body in ("art one", "art two", "quick fox"):
        post_msg(app_url, owner["token"], ch, body)
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        stash: list[Any] = []
        page.route(re.compile(r"/api/servers/[^/]+/messages/search"), lambda r: stash.append(r))
        search = page.get_by_role("searchbox", name="Search messages")
        search.fill("art")
        search.press("Enter")
        search.fill(FOX_TERM)
        search.press("Enter")
        poll(lambda: len(stash) == 2, 5, "two held searches")
        panel = page.get_by_role("complementary", name="Search results")
        expect(panel).to_contain_text("Searching…")
        release(stash[1])
        expect(panel.get_by_role("heading", name="1 result")).to_be_visible()
        release(stash[0])
        expect(panel.get_by_role("heading", name="1 result")).to_be_visible()
        expect(panel.get_by_role("listitem")).to_have_count(1)
        assert panel.get_by_role("listitem").evaluate("e => [...e.getElementsByTagName('mark')].map(x => x.textContent)") == [FOX_TERM]
    assert req(app_url, "GET", f"/api/servers/{com['slug']}/messages/search", m["token"], params={"q": FOX_TERM}).json()["total_results"] == 1


def test_wf_search_follows_changes(browser: Browser, app_url: str) -> None:
    owner, (m,), com, ch = space(app_url, 1)
    renamed_body = f"{ORBIT} renamed now"
    newcomer = f"{ORBIT} newcomer"
    parent = post_msg(app_url, owner["token"], ch, PARENT_TEXT).json()
    one = post_msg(app_url, owner["token"], ch, f"{ORBIT} one").json()
    two = post_msg(app_url, owner["token"], ch, f"{ORBIT} two").json()
    post_msg(app_url, owner["token"], ch, f"{ORBIT} reply", reply_to_id=parent["id"])
    with browse(browser) as page:
        open_channel(page, app_url, m, com["id"], ch)
        search = page.get_by_role("searchbox", name="Search messages")
        search.fill(ORBIT)
        search.press("Enter")
        panel = page.get_by_role("complementary", name="Search results")
        expect(panel.get_by_role("heading", name=results_heading(3))).to_be_visible()
        focused = page.evaluate_handle("() => document.activeElement")
        req(app_url, "DELETE", f"/api/messages/{one['id']}", owner["token"])
        expect(panel.get_by_role("heading", name=results_heading(2))).to_be_visible(timeout=LIVE_MS)
        req(app_url, "PATCH", f"/api/messages/{two['id']}", owner["token"], body={"body": renamed_body})
        edited = panel.get_by_role("listitem").filter(has_text=renamed_body)
        expect(edited).to_contain_text("(edited)", timeout=LIVE_MS)
        assert edited.evaluate("e => [...e.getElementsByTagName('mark')].map(x => x.textContent)") == [ORBIT]
        req(app_url, "PATCH", f"/api/messages/{parent['id']}", owner["token"], body={"body": HELLO_CHANGED})
        expect(panel.get_by_text(f"Replying to {owner['display_name']}: {HELLO_CHANGED} (edited)", exact=True)).to_be_visible(timeout=LIVE_MS)
        post_msg(app_url, owner["token"], ch, newcomer)
        expect(page.get_by_text(newcomer).first).to_be_visible(timeout=LIVE_MS)
        expect(panel.get_by_role("listitem")).to_have_count(2)
        assert page.evaluate("h => document.activeElement === h", focused)
        set_overwrite(app_url, owner["token"], ch, "member", m["id"], deny=["view_channel"])
        expect(panel.get_by_role("heading", name=results_heading(0))).to_be_visible(timeout=LIVE_MS)
        expect(panel.get_by_role("listitem")).to_have_count(0)


def test_wf_cross_cutting_conventions(browser: Browser, app_url: str) -> None:
    with browse(browser) as page:
        errors: list[str] = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 and same_origin_url(r.url, app_url) and "/api/" not in r.url else None)
        for path in PUBLIC_ROUTES:
            page.goto(app_url + path)
            expect(page.get_by_role("heading", level=1)).to_have_count(1)
            assert page.title().endswith(" - Community Hub"), path
            assert page.evaluate("() => [...document.images].every(i => i.hasAttribute('alt') && i.hasAttribute('width') && i.hasAttribute('height'))"), path
            assert tab_order(page, 1) == ["Skip to main content"], path
            rest, focus = state_styles(page.get_by_role("link", name="Skip to main content"), "outline-width", "outline-style", "box-shadow", state="focus")
            ring = float(focus["outline-width"].rstrip("px") or 0) >= 2 and focus["outline-style"] != "none"
            assert ring or focus["box-shadow"] != "none", path
            axe(page)
        assert errors == [], errors


def test_wf_cross_cutting_responsive(browser: Browser, app_url: str) -> None:
    for width, height in ((EDGE_TABLET_LOW, TABLET_H), (PHONE_W, PHONE_H), (REFLOW_PX, PHONE_H)):
        with browse(browser, width, height) as page:
            for path in PUBLIC_ROUTES:
                page.goto(app_url + path)
                layout(page)
                if width != REFLOW_PX:
                    axe(page)
                expect(btn(page, "Menu")).to_have_count(0 if width == EDGE_TABLET_LOW else 1)
    with browse(browser, reduced_motion="reduce") as page:
        for path in ("/", "/listening-room", "/servers", "/membership"):
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
            assert page.evaluate("() => document.getAnimations().filter(a => a.playState === 'running').length") == 0, path
            assert page.evaluate("() => [...document.querySelectorAll('*')].every(e => getComputedStyle(e).transitionDuration.split(',').every(d => parseFloat(d) === 0))"), path
        page.goto(app_url + "/")
        assert page.locator("video").first.evaluate("v => v.paused")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_user_readme() -> None:
    text_ = (APP_DIR / "USER_README.md").read_text()
    assert "member@example.com" in text_ and SEED_PW in text_


def test_if_no_other_datastores() -> None:
    banned = {"sqlite3", "redis", "pymongo", "stripe", "boto3", "celery", "kafka", "sendgrid", "twilio"}
    for path in APP_DIR.rglob("*.py"):
        if ".venv" in path.parts or "node_modules" in path.parts:
            continue
        tree = ast.parse(path.read_text(errors="replace"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                names = []
            for n in names:
                assert n.split(".")[0] not in banned, f"{path} imports {n}"


def test_if_venv_tools() -> None:
    assert (Path(DEPLOYED_APP) / ".venv").is_dir()
    manifest = json.loads((APP_DIR / "run.json").read_text())
    bare = {"pip", "pip3", "uvicorn", "gunicorn", "hypercorn", "daphne", "alembic", "flask", "granian"}
    for key in ("install", "build", "serve"):
        for segment in re.split(r"&&|\|\||;|\|", manifest[key]):
            words = segment.split()
            assert not words or words[0] not in bare, f"{key}: {segment}"
    serve = manifest["serve"].split()
    assert serve[0].startswith(".venv/bin/") or (serve[0] in ("python", "python3") and serve[1] == "-m")


def shipped() -> dict[str, tuple[str, str]]:
    found = {}
    for sp in (Path(DEPLOYED_APP) / ".venv").glob("lib/python*/site-packages"):
        for d in sp.glob("*.dist-info"):
            meta = (d / "METADATA").read_text(errors="replace")
            name = re.search(r"^Name:\s*(.+)$", meta, re.M).group(1).strip()
            version = re.search(r"^Version:\s*(.+)$", meta, re.M).group(1).strip()
            found[name] = (version, meta)
    return found


def norm(s: str) -> str:
    return re.sub(r"[-_.]+", "-", s.lower())


def test_if_third_party_notices() -> None:
    notices = norm((APP_DIR / "THIRD_PARTY_NOTICES.md").read_text())
    pkgs = shipped_packages()
    assert pkgs, "the app ships no installed packages to check"
    for pkg in pkgs:
        assert norm(pkg.name) in notices, f"{pkg.name} missing from notices"
        assert norm(pkg.version) in notices, f"{pkg.name} {pkg.version} version missing"


def test_if_licences() -> None:
    def one_ok(text_: str) -> bool:
        t = text_.upper()
        if "GPL" in t:
            return False
        return any(k in t for k in ("MIT", "BSD", "APACHE", "ISC", "PSF", "PYTHON SOFTWARE FOUNDATION", "MPL-2.0",
                                    "MOZILLA PUBLIC LICENSE 2.0", "0BSD", "UNLICENSE", "PERMISSION IS HEREBY GRANTED"))

    def expr_ok(expr: str) -> bool:
        return any(all(one_ok(p) for p in alt.split(" AND ")) for alt in re.split(r"\s+OR\s+", expr.strip("() ")))

    bad = []
    for name, (_, meta) in shipped().items():
        expr = re.search(r"^License-Expression:\s*(.+)$", meta, re.M)
        lic = re.search(r"^License:\s*(.+)$", meta, re.M)
        classifiers = re.findall(r"^Classifier:\s*License :: (.+)$", meta, re.M)
        if expr:
            ok = expr_ok(expr.group(1))
        elif lic and len(lic.group(1)) < 120 and lic.group(1).strip().upper() not in ("UNKNOWN", ""):
            ok = expr_ok(lic.group(1))
        else:
            ok = any(one_ok(c) for c in classifiers) or bool(lic and one_ok(lic.group(1)))
        if not ok:
            bad.append(name)
    assert bad == [], f"disallowed or unknown licences: {bad}"


def test_if_own_origin_assets(browser: Browser, app_url: str) -> None:
    for d in (".browser_screenshots", ".downloads"):
        path = Path(DEPLOYED_APP) / d
        assert path.is_dir() and not any(path.iterdir()), d
    with browse(browser) as page:
        urls: list[str] = []
        page.on("request", lambda rq: urls.append(rq.url))
        for path in ("/", "/listening-room", "/servers", "/membership"):
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin_url(u, app_url)]
        assert foreign == [], foreign
