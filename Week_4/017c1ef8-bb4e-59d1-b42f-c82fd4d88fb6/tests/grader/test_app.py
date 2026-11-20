from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib
import json
import os
import re
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest as _kit_conftest
from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    style,
    tap,
)

LIVE_S = 2
LOAD_S = 3
GRACE_S = 3
HTTP_TIMEOUT = 30
MAIL_WAIT_S = 30
MAIL_SETTLE_S = 3
MAIL_POLL_SETTLE_S = 0.5
STEP_MS = 100
SLACK_S = 5
BOUNDARY_S = 3
LOCATOR_TIMEOUT_MS = 5000
FEED_PAGES = 20
SEARCH_PAGES = 60
WEEK_S = 604800
DAY_S = 86400
MONTH_S = 2592000
JSON_LIMIT = 1000000
MULTIPART_SLACK = 65536
DEBOUNCE_MS = 300
ROLL_MS = 480
ACTIONS_AT_MS = 600
ACTION_FADE_MS = 180
PRESENCE_LEAVE_S = 5
MAX_QUESTIONS = 10
SHORT_ANSWER_MAX = 500
QUESTION_TEXT_MAX = 200
SEARCH_Q_MAX = 100
TOUCH_MIN = 44
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
PASSWORD = "verify-pass-2027"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
DEVICE_PAST = datetime(2001, 1, 1, 9, 0, tzinfo=timezone.utc)
DEVICE_FUTURE = datetime(2040, 6, 1, 9, 0, tzinfo=timezone.utc)
JPEG_APP1 = 0xE1
JPEG_APP15 = 0xEF
JPEG_COMMENT = 0xFE
PICKED = 2
ROLL_PROBE = """(glyph) => {
  window.__roll = null;
  const measure = () => {
    if (window.__roll) return;
    for (const a of document.getAnimations()) {
      const timing = a.effect && a.effect.getComputedTiming();
      const t = a.effect && a.effect.target;
      if (!timing || !t || !t.closest) continue;
      if (!(t.closest('[data-degree-roll]') || t.querySelector('[data-degree-roll]'))) continue;
      if (Math.abs(timing.duration - 480) > 40) continue;
      if ((t.textContent || '').trim() !== glyph) continue;
      const was = a.currentTime;
      a.pause();
      a.currentTime = 240;
      const mid = t.getBoundingClientRect().top;
      a.currentTime = 479;
      const rest = t.getBoundingClientRect();
      a.currentTime = was;
      a.play();
      window.__roll = {mid: mid, rest: rest.top, height: rest.height};
      return;
    }
  };
  new MutationObserver(measure).observe(document, {subtree: true, attributes: true, childList: true, characterData: true});
}"""
CONNECTION_BUTTONS = ("Connect", "Withdraw", "Accept", "Ignore", "Message", "Remove connection")
REACTION_NAMES = ("Like", "Celebrate", "Support", "Insightful", "Funny")
STAGE_LABELS = ("Applied", "Viewed", "Interviewing", "Offered", "Rejected", "Withdrawn")
SK_A, SK_B, SK_G, SK_D = "Blueprint reading", "Conduit bending", "Panel upgrades", "Line cooking"
FIRST = {
    "a": "Avery", "b": "Blake", "c": "Casey", "d": "Devon", "e": "Emery", "f": "Finley", "g": "Gray",
    "h": "Harper", "i": "Indy", "j": "Jules", "k": "Kai", "l": "Lane", "m": "Morgan", "n": "Noel",
    "o": "Oakley", "p": "Parker", "q": "Quinn", "r": "Reese", "s": "Sage", "t": "Tatum", "u": "Uma",
    "v": "Vale", "w": "Wren", "x": "Xen", "y": "Yael", "z": "Zion",
}
_CONFIG_KEYS = {
    "PLAINWORK_POST_MAX_CHARS": "post_max_chars",
    "PLAINWORK_SEE_MORE_CHARS": "see_more_chars",
    "PLAINWORK_TYPING_TIMEOUT_MS": "typing_timeout_ms",
    "PLAINWORK_MAX_SKILLS": "max_skills",
    "PLAINWORK_PHOTO_MAX_BYTES": "photo_max_bytes",
    "PLAINWORK_RESUME_MAX_BYTES": "resume_max_bytes",
    "PLAINWORK_FEED_PAGE_SIZE": "feed_page_size",
    "PLAINWORK_TIME_ZONE": "time_zone",
}


def _helper(name: str) -> Any:
    for module_name in ("conftest", "mailpit", "postgres", "minio", "clients.mailpit",
                        "clients.postgres", "clients.minio"):
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        if hasattr(module, name):
            return getattr(module, name)
    pytest.fail(f"provider helper {name} is not importable in the verifier")


def addresses(field: Any) -> list[str]:
    return _helper("addresses")(field)


def mail_text(message: dict[str, Any]) -> str:
    return _helper("text")(message)


def storage(suffix: str = "") -> Any:
    cls = _helper("S3")
    return cls(suffix) if suffix else cls()


def database(suffix: str = "") -> Any:
    cls = _helper("Postgres")
    return cls(suffix) if suffix else cls()


def setting(base: str, name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    if name in _CONFIG_KEYS:
        return str(httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT).json()[_CONFIG_KEYS[name]])
    pytest.fail(f"{name} is not set in the verifier environment")


def num(base: str, name: str) -> int:
    return int(setting(base, name))


def zone(base: str) -> ZoneInfo:
    return ZoneInfo(setting(base, "PLAINWORK_TIME_ZONE"))


def outage_url() -> str:
    url = os.environ.get("APP_STORAGE_DOWN_URL")
    if not url:
        pytest.fail("APP_STORAGE_DOWN_URL is not set; the storage-down instance is unreachable")
    return url.rstrip("/")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def at(t0: datetime, seconds: float) -> str:
    return iso(t0 + timedelta(seconds=seconds))


def fmt_date(moment: datetime, tz: ZoneInfo) -> str:
    local = moment.astimezone(tz)
    return f"{local.strftime('%b')} {local.day}, {local.year}"


def fmt_time(moment: datetime, tz: ZoneInfo) -> str:
    local = moment.astimezone(tz)
    hour = local.hour % 12 or 12
    return f"{hour}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"


def grading_headers() -> dict[str, str]:
    key = os.environ.get("GRADING_KEY")
    if not key:
        pytest.fail("GRADING_KEY is not set in the verifier environment")
    return {"X-Grading-Key": key}


def server_now(base: str) -> datetime:
    r = httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"GET /api/config answered {r.status_code}"
    return parse_ts(r.json()["now"])


def set_clock(base: str, moment: datetime) -> datetime:
    r = httpx.post(base + "/api/grading/clock", json={"now": iso(moment)}, headers=grading_headers(),
                   timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code} {r.text[:200]}"
    return parse_ts(r.json()["now"])


def clock_to(base: str, moment: datetime) -> datetime:
    current = server_now(base)
    if current > moment + timedelta(seconds=1):
        pytest.fail(f"business clock already passed {iso(moment)}; a boundary check would be invalid")
    return set_clock(base, max(moment, current))


def forward(base: str, seconds: float) -> datetime:
    return set_clock(base, server_now(base) + timedelta(seconds=seconds))


def origin_of(base: str) -> str:
    u = urlparse(base)
    return f"{u.scheme}://{u.netloc}"


def anon_post(base: str, path: str, body: Any) -> httpx.Response:
    return httpx.post(base + path, json=body, timeout=HTTP_TIMEOUT, headers={"Origin": origin_of(base)})


class Member:
    def __init__(self, base: str, email: str, password: str):
        self.base, self.email, self.password = base, email, password
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, headers={"Origin": origin_of(base)})
        self.id = ""

    def signin(self) -> "Member":
        r = self.c.post("/api/auth/signin", json={"email": self.email, "password": self.password})
        assert r.status_code == 200, f"seeded member could not sign in: {r.status_code} {r.text[:200]}"
        self.id = r.json()["member"]["id"]
        return self

    @property
    def cookie(self) -> str:
        value = self.c.cookies.get("pw_session")
        assert value, "sign-in did not set the pw_session cookie"
        return value

    def call(self, method: str, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        if body is None:
            return self.c.request(method, path, headers=headers)
        return self.c.request(method, path, json=body, headers=headers)

    def get(self, path: str) -> httpx.Response:
        return self.call("GET", path)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.call("POST", path, body, key)

    def put(self, path: str, body: Any = None) -> httpx.Response:
        return self.call("PUT", path, body)

    def patch(self, path: str, body: Any = None) -> httpx.Response:
        return self.call("PATCH", path, body)

    def delete(self, path: str) -> httpx.Response:
        return self.call("DELETE", path)

    def ok(self, method: str, path: str, body: Any = None, status: int | tuple = 200, key: str | None = None) -> Any:
        r = self.call(method, path, body, key)
        allowed = status if isinstance(status, tuple) else (status,)
        assert r.status_code in allowed, f"{method} {path} answered {r.status_code} {r.text[:300]}"
        return r.json() if r.content else None


def new_tag() -> str:
    return uuid.uuid4().hex[:8]


def user_spec(tag: str, key: str, **overrides: Any) -> dict[str, Any]:
    spec = {
        "key": key, "email": f"{tag}-{key}@verify.plainwork.example", "password": PASSWORD,
        "name": f"{FIRST[key[0]]} {tag}{key}", "handle": f"{tag}-{key}", "headline": f"Verifier {key}",
        "location": "Testville", "visibility": "public", "about": f"About {tag} {key}",
        "experience": [], "education": [], "skills": [], "featured": [],
    }
    spec.update(overrides)
    return spec


def company_spec(tag: str, key: str, admins: list[str]) -> dict[str, Any]:
    return {"key": key, "name": f"Yard {tag}{key}", "handle": f"{tag}-{key}", "location": "Chicago, IL",
            "admins": admins}


def question(key: str, qtype: str, **overrides: Any) -> dict[str, Any]:
    spec = {"key": key, "type": qtype, "text": f"Question {key}?", "required": False, "knock_out": False,
            "ideal": None, "options": None, "accepted": None, "minimum": None, "maximum": None}
    spec.update(overrides)
    return spec


def job_spec(tag: str, key: str, t0: datetime, company: str = "co", poster: str = "p", **overrides: Any) -> dict:
    spec = {"key": key, "company": company, "poster": poster, "title": f"Rigger {tag}{key}",
            "location": "Chicago, IL", "workplace": "on-site", "posted_at": at(t0, -3600),
            "closes_at": at(t0, 30 * DAY_S), "description": f"Job {key}", "questions": []}
    spec.update(overrides)
    return spec


def conn(a: str, b: str, t0: datetime, state: str = "connected", seconds: float = -DAY_S) -> dict:
    return {"from": a, "to": b, "state": state, "at": at(t0, seconds)}


def post_spec(key: str, author: str, text: str, t0: datetime, seconds: float = -60) -> dict:
    return {"key": key, "author": author, "text": text, "at": at(t0, seconds), "photo": False}


def seed(base: str, body: dict) -> dict[str, str]:
    r = httpx.post(base + "/api/grading/seed", json=body, headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code} {r.text[:300]}"
    return r.json()["ids"]


class World:
    def __init__(self, base: str, users: str, profiles: dict | None = None, tag: str | None = None, **lists: Any):
        self.base = base
        self.tag = tag or new_tag()
        profiles = profiles or {}
        self.users = {k: user_spec(self.tag, k, **profiles.get(k, {})) for k in users.split()}
        body: dict[str, Any] = {"users": list(self.users.values())}
        body.update({k: v for k, v in lists.items() if v})
        self.body = body
        self.ids = seed(base, body)
        self._members: dict[str, Member] = {}

    def id(self, key: str) -> str:
        return self.ids[key]

    def name(self, key: str) -> str:
        return self.users[key]["name"]

    def first(self, key: str) -> str:
        return self.name(key).split(" ")[0]

    def handle(self, key: str) -> str:
        return self.users[key]["handle"]

    def email(self, key: str) -> str:
        return self.users[key]["email"]

    def company(self, key: str) -> dict:
        return next(c for c in self.body["companies"] if c["key"] == key)

    def job(self, key: str) -> dict:
        return next(j for j in self.body["jobs"] if j["key"] == key)

    def m(self, key: str) -> Member:
        if key not in self._members:
            self._members[key] = self.fresh(key)
        return self._members[key]

    def fresh(self, key: str) -> Member:
        u = self.users[key]
        return Member(self.base, u["email"], u["password"]).signin()


def profile(m: Member, handle: str) -> dict:
    return m.ok("GET", f"/api/profiles/{handle}")


def state_of(m: Member, handle: str) -> str:
    return profile(m, handle)["connection_state"]


def feed_all(m: Member) -> list[dict]:
    out: list[dict] = []
    cursor = None
    for _ in range(FEED_PAGES):
        data = m.ok("GET", "/api/feed" + (f"?cursor={quote(cursor)}" if cursor else ""))
        out += data["entries"]
        cursor = data.get("next_cursor")
        if not cursor:
            return out
    pytest.fail("GET /api/feed kept returning next_cursor; expected a fresh member's few entries to end")


def search_all(m: Member, **params: str) -> list[dict]:
    out: list[dict] = []
    cursor = None
    for _ in range(SEARCH_PAGES):
        query = dict(params, **({"cursor": cursor} if cursor else {}))
        data = m.ok("GET", "/api/search?" + urlencode(query))
        out += data["results"]
        cursor = data.get("next_cursor")
        if not cursor:
            return out
    pytest.fail("GET /api/search kept paging past the verifier bound")


def comments_of(m: Member, post_id: str) -> list[dict]:
    return m.ok("GET", f"/api/posts/{post_id}/comments")["comments"]


def conversation_with(m: Member, other_id: str) -> str:
    r = m.post("/api/conversations", {"member_id": other_id})
    assert r.status_code in (200, 201), f"POST /api/conversations answered {r.status_code} {r.text[:200]}"
    return r.json()["id"]


def messages_of(m: Member, conv: str) -> list[dict]:
    return m.ok("GET", f"/api/conversations/{conv}/messages")["messages"]


def notifications(m: Member) -> dict:
    return m.ok("GET", "/api/notifications")


def pdf_bytes(size: int = 2048) -> bytes:
    head, tail = b"%PDF-1.4\n%", b"\n%%EOF\n"
    return head + b"0" * (size - len(head) - len(tail)) + tail


def upload_resume(m: Member, data: bytes | None = None, name: str = "resume.pdf",
                  ctype: str = "application/pdf") -> httpx.Response:
    return m.c.post("/api/uploads/resume", files={"file": (name, pdf_bytes() if data is None else data, ctype)})


def resume_id(m: Member) -> str:
    r = upload_resume(m)
    assert r.status_code == 201, f"resume upload answered {r.status_code} {r.text[:200]}"
    return r.json()["resume_id"]


def apply(m: Member, job_id: str, answers: dict | None = None, key: str | None = None,
          rid: str | None = None) -> httpx.Response:
    return m.post(f"/api/jobs/{job_id}/applications", {"resume_id": rid or resume_id(m), "answers": answers or {}},
                  key=key)


def upload_photo(m: Member, data: bytes, name: str, ctype: str) -> httpx.Response:
    return m.c.post("/api/uploads/photo", files={"file": (name, data, ctype)})


def png_bytes(width: int = 8, height: int = 8, chunks: tuple = ()) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(
        b"\x00" + bytes(v for x in range(width) for v in ((x * 37) % 256, (y * 53) % 256, (x * y * 11) % 256))
        for y in range(height))
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    for kind, data in chunks:
        out += chunk(kind, data)
    return out + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def png_chunk_types(data: bytes) -> list[bytes]:
    kinds, pos = [], 8
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kinds.append(data[pos + 4:pos + 8])
        pos += 12 + length
    return kinds


def browser_png(page: Page, payload: bytes, mime: str) -> bytes:
    url = f"data:{mime};base64," + base64.b64encode(payload).decode()
    data_url = page.evaluate("""async (src) => {
        const i = new Image(); i.src = src; await i.decode();
        const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
        c.getContext('2d').drawImage(i, 0, 0);
        return c.toDataURL('image/png'); }""", url)
    return base64.b64decode(data_url.split(",", 1)[1])


def jpeg_bytes(page: Page) -> bytes:
    data_url = page.evaluate("""() => {
        const c = document.createElement('canvas'); c.width = 16; c.height = 16;
        const g = c.getContext('2d');
        for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
            g.fillStyle = `rgb(${x * 16}, ${y * 16}, ${(x * y) % 256})`; g.fillRect(x, y, 1, 1); }
        return c.toDataURL('image/jpeg', 0.92); }""")
    return base64.b64decode(data_url.split(",", 1)[1])


def jpeg_segment(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def with_jpeg_metadata(jpg: bytes, tag: bytes) -> bytes:
    segments = (jpeg_segment(0xE1, b"Exif\x00\x00" + tag) + jpeg_segment(0xED, b"Photoshop 3.0\x00" + tag)
                + jpeg_segment(0xFE, b"comment-" + tag))
    return jpg[:2] + segments + jpg[2:]


def jpeg_padded(jpg: bytes, total: int) -> bytes:
    extra, remaining = b"", total - len(jpg)
    while remaining > 0:
        size = min(65537, remaining)
        if 0 < remaining - size < 4:
            size -= 4
        extra += jpeg_segment(0xFE, b"0" * (size - 4))
        remaining -= size
    return jpg[:2] + extra + jpg[2:]


def jpeg_markers(data: bytes) -> list[int]:
    markers, pos = [], 2
    while pos + 4 <= len(data) and data[pos] == 0xFF:
        marker = data[pos + 1]
        markers.append(marker)
        if marker == 0xDA:
            break
        pos += 2 + struct.unpack(">H", data[pos + 2:pos + 4])[0]
    return markers


@contextlib.contextmanager
def browse(browser: Browser, member: Member, path: str, size: tuple = DESKTOP,
           device_time: datetime | None = None, before: Callable[[Page], None] | None = None,
           **options: Any) -> Iterator[Page]:
    with open_app(browser, member.base + "/api/health", **options) as page:
        page.set_default_timeout(LOCATOR_TIMEOUT_MS)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.context.add_cookies([{"name": "pw_session", "value": member.cookie, "url": member.base}])
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if before is not None:
            before(page)
        page.goto(member.base + path)
        yield page


@contextlib.contextmanager
def anonymous(browser: Browser, base: str, path: str, size: tuple = DESKTOP) -> Iterator[Page]:
    with open_app(browser, base + path) as page:
        page.set_default_timeout(LOCATOR_TIMEOUT_MS)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        yield page


def eventually(page: Page | None, check_fn: Callable[[], Any], what: str, seconds: float | None = None) -> None:
    limit = seconds if seconds is not None else LIVE_S + GRACE_S
    deadline = time.monotonic() + limit
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check_fn():
                return
        except Exception as exc:
            last = exc
        if page is not None:
            advance(page, STEP_MS)
    pytest.fail(f"expected {what} within {limit}s (last error: {last!r})")


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def text_of(loc: Locator) -> str:
    return (loc.first.inner_text() or "").strip() if loc.count() else ""


def shown(page: Page, loc: Locator, what: str, seconds: float | None = None) -> None:
    eventually(page, lambda: visible(loc), what, seconds)


def absent(page: Page, loc: Locator, what: str, seconds: float | None = None) -> None:
    eventually(page, lambda: not visible(loc), what, seconds)


REPAINT_S = 3


def _center_after_centering(locator: Locator) -> tuple[float, float]:
    expect(locator).to_be_visible()
    expect(locator).to_be_enabled()
    deadline = time.monotonic() + REPAINT_S
    while time.monotonic() <= deadline + REPAINT_S:
        locator.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
        box = locator.bounding_box()
        point = None if box is None else {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
        hit = point is not None and locator.evaluate(
            "(e,p) => {const hit=document.elementFromPoint(p.x,p.y);return hit===e||e.contains(hit)}", point)
        if hit:
            return point["x"], point["y"]
        assert time.monotonic() < deadline, "control is obscured at the actual pointer target"
    pytest.fail("control is obscured at the actual pointer target")


_kit_conftest.center = _center_after_centering


def loaded(page: Page, loc: Locator, what: str) -> None:
    shown(page, loc, what, LOAD_S + GRACE_S)


def btn(scope: Any, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def link(scope: Any, name: str) -> Locator:
    return scope.get_by_role("link", name=name, exact=True)


def control(scope: Any, name: str) -> Locator:
    return btn(scope, name).or_(link(scope, name))


def textbox(scope: Any, name: str) -> Locator:
    return scope.get_by_role("textbox", name=name, exact=True)


def has_focus(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e === document.activeElement")


def focus_within(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e.contains(document.activeElement)")


def press(loc: Locator, key: str = "Enter") -> None:
    loc.first.focus()
    loc.first.press(key)


def announced(page: Page, name: str, text: str, seconds: float | None = None) -> None:
    reg = page.get_by_role("status", name=name, exact=True)
    eventually(page, lambda: any(text in (reg.nth(i).text_content() or "") for i in range(reg.count())),
               f"status {name!r} to announce {text!r}", seconds)


def alerted(page: Page, text: str, seconds: float | None = None) -> None:
    alerts = page.get_by_role("alert")
    eventually(page, lambda: any(text in (alerts.nth(i).text_content() or "") for i in range(alerts.count())),
               f"an alert reading {text!r}", seconds)


def shows_text(page: Page, text: str, scope: Any = None, seconds: float | None = None) -> None:
    shown(page, (scope or page).get_by_text(text, exact=True), f"the text {text!r}", seconds)


def connection_buttons(page: Page) -> set[str]:
    return {n for n in CONNECTION_BUTTONS if visible(control(page, n))}


def expect_buttons(page: Page, expected: set[str], what: str) -> None:
    eventually(page, lambda: connection_buttons(page) == expected, f"{what}: connection buttons {sorted(expected)}",
               LOAD_S + GRACE_S)


def article(page: Page, post_id: str) -> Locator:
    return page.get_by_role("article").and_(page.locator(f"[data-post-id='{post_id}']")).first


def article_ids(page: Page) -> list[str]:
    return page.get_by_role("article").evaluate_all("els => els.map(e => e.getAttribute('data-post-id'))")


def member_item(page: Page, scope: Any, member_id: str) -> Locator:
    return scope.get_by_role("listitem").and_(page.locator(f"[data-member-id='{member_id}']"))


def degree_of(page: Page) -> tuple[str | None, str, str | None, str]:
    numeral = page.locator("[data-degree-roll]").first
    badge = page.locator("[data-degree-badge]").first
    return (numeral.get_attribute("data-degree"), numeral.inner_text().strip(),
            badge.get_attribute("data-degree"), badge.inner_text().strip())


def box_of(loc: Locator) -> dict[str, float]:
    deadline = time.monotonic() + REPAINT_S
    while (box := loc.first.bounding_box()) is None:
        assert time.monotonic() < deadline, "element has no layout box"
    return box


def field_note(page: Page, field: str) -> Locator:
    return page.locator(f"[data-field-note][data-field='{field}']")


def _sample(sample: dict, *names: str) -> float:
    for n in names:
        if n in sample:
            return float(sample[n])
    pytest.fail(f"motion sample lacks {names}: {sorted(sample)}")


def inbox(mail: Any, email: str, settle_s: float = MAIL_POLL_SETTLE_S) -> list[dict]:
    wanted = email.lower()
    return [m for m in mail.messages(settle=settle_s) if wanted in [a.lower() for a in addresses(m.get("To"))]]


def mail_with(mail: Any, email: str, subject: str, count: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while time.monotonic() < deadline:
        if len([m for m in inbox(mail, email) if m.get("Subject") == subject]) >= count:
            break
    else:
        pytest.fail(f"Mailpit never received {count} message(s) to {email} with subject {subject!r}")
    final = [m for m in inbox(mail, email, MAIL_SETTLE_S) if m.get("Subject") == subject]
    assert len(final) == count, f"expected exactly {count} message(s) {subject!r} to {email}, got {len(final)}"
    return final


def no_mail(mail: Any, email: str, subject: str) -> None:
    found = [m for m in inbox(mail, email, MAIL_SETTLE_S) if m.get("Subject") == subject]
    assert not found, f"unexpected mail {subject!r} to {email}"


def test_health_reports_storage(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"status": "ok"}
    down = httpx.get(outage_url() + "/api/health", timeout=HTTP_TIMEOUT)
    assert down.status_code == 200, "health must never answer 503 while storage is unreachable"
    assert down.json() == {"status": "unavailable"}


def test_config_shape_and_values(app_url):
    r = httpx.get(app_url + "/api/config", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"post_max_chars", "see_more_chars", "typing_timeout_ms", "max_skills", "photo_max_bytes",
                         "resume_max_bytes", "feed_page_size", "time_zone", "now"}
    for env_name, key in _CONFIG_KEYS.items():
        if env_name == "PLAINWORK_TIME_ZONE":
            assert body[key] == os.environ[env_name]
        else:
            assert body[key] == int(os.environ[env_name]), f"{key} differs from {env_name}"
    moved = forward(app_url, 3600)
    now = parse_ts(httpx.get(app_url + "/api/config", timeout=HTTP_TIMEOUT).json()["now"])
    assert timedelta(0) <= now - moved < timedelta(seconds=SLACK_S)


def test_business_clock_drives_times_and_open_pages(app_url, browser):
    w = World(app_url, "a")
    a = w.m("a")
    first = a.ok("POST", "/api/posts", {"text": f"Clock check {w.tag}"}, 201, key=idempotency_key())
    assert abs((parse_ts(first["created_at"]) - server_now(app_url)).total_seconds()) < SLACK_S
    with browse(browser, a, "/feed") as page:
        stamp = article(page, first["id"]).locator("time")
        eventually(page, lambda: text_of(stamp) == "now", "the new post to read now", LOAD_S + GRACE_S)
        moved = forward(app_url, 3 * 3600 + 30)
        wall0, now0 = time.monotonic(), server_now(app_url)
        eventually(page, lambda: text_of(stamp) == "3h", "the open feed to relabel the post 3h after a clock move")
        second = a.ok("POST", "/api/posts", {"text": f"Clock later {w.tag}"}, 201, key=idempotency_key())
        now1, wall = server_now(app_url), time.monotonic() - wall0
    created = parse_ts(second["created_at"])
    assert moved <= created <= now1 + timedelta(seconds=1), "stored time must come from the moved business clock"
    drift = (now1 - now0).total_seconds()
    assert wall - SLACK_S <= drift <= wall + SLACK_S, "the business clock must run in real time after a move"


def test_grading_seed_creates_records_and_key_guard(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    body = {
        "users": [user_spec(tag, "a"), user_spec(tag, "b")],
        "companies": [company_spec(tag, "co", ["b"])],
        "connections": [conn("a", "b", t0)],
        "posts": [post_spec("p1", "b", f"Seeded {tag}", t0)],
        "jobs": [job_spec(tag, "j1", t0, poster="b", questions=[question("q1", "short_answer")])],
        "applications": [{"key": "ap1", "job": "j1", "applicant": "a", "state": "applied", "at": at(t0, -30),
                          "answers": {"q1": "Because"}}],
    }
    for headers in ({}, {"X-Grading-Key": f"wrong-{tag}"}):
        r = httpx.post(app_url + "/api/grading/seed", json=body, headers=headers, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
        r = httpx.post(app_url + "/api/grading/clock", json={"now": iso(t0 + timedelta(days=1))}, headers=headers,
                       timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert anon_post(app_url, "/api/auth/signin", {"email": f"{tag}-a@verify.plainwork.example",
                                                   "password": PASSWORD}).status_code != 200
    ids = seed(app_url, body)
    assert {"a", "b", "co", "p1", "j1", "q1", "ap1"} <= set(ids)
    a = Member(app_url, f"{tag}-a@verify.plainwork.example", PASSWORD).signin()
    assert a.id == ids["a"]
    prof = profile(a, f"{tag}-b")
    assert prof["id"] == ids["b"] and prof["connection_state"] == "connected"
    post = a.ok("GET", f"/api/posts/{ids['p1']}")
    assert post["text"] == f"Seeded {tag}" and post["author"]["id"] == ids["b"]
    job = a.ok("GET", f"/api/jobs/{ids['j1']}")
    assert job["title"] == f"Rigger {tag}j1" and job["questions"][0]["id"] == ids["q1"]
    application = a.ok("GET", f"/api/applications/{ids['ap1']}")
    assert application["state"] == "applied" and application["job"]["id"] == ids["j1"]
    assert a.ok("GET", f"/api/companies/{tag}-co")["id"] == ids["co"]
    other = new_tag()
    dup = {"users": [user_spec(other, "c"), user_spec(other, "d", handle=f"{tag}-a")]}
    r = httpx.post(app_url + "/api/grading/seed", json=dup, headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 422 and r.json()["error"] == "validation" and r.json()["fields"]
    assert anon_post(app_url, "/api/auth/signin", {"email": f"{other}-c@verify.plainwork.example",
                                                   "password": PASSWORD}).status_code != 200


def _code_mails(mail: Any, email: str, count: int) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while time.monotonic() < deadline:
        got = [m for m in inbox(mail, email) if str(m.get("Subject", "")).startswith("Your Plainwork code: ")]
        if len(got) >= count:
            return got
    pytest.fail(f"Mailpit never received {count} code message(s) for {email}")


def _code(message: dict) -> str:
    code = message["Subject"][len("Your Plainwork code: "):]
    assert re.fullmatch(r"\d{6}", code), f"code {code!r} is not six digits"
    assert code in mail_text(message), "the code must also be in the body"
    return code


def test_signup_emails_code_and_confirm_gates_signin(app_url, mail):
    tag = new_tag()
    email, handle, name = f"{tag}-join@verify.plainwork.example", f"{tag}-join", f"Jo {tag}"
    body = {"email": email, "password": PASSWORD, "name": name, "handle": handle}
    r = anon_post(app_url, "/api/auth/signup", body)
    assert r.status_code == 201 and r.json() == {"status": "confirmation_sent"}
    code1 = _code(_code_mails(mail, email, 1)[0])
    r = anon_post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD})
    assert r.status_code == 409 and r.json() == {"error": "unconfirmed"}
    assert anon_post(app_url, "/api/auth/signup", body).status_code == 201
    codes = {_code(m) for m in _code_mails(mail, email, 2)}
    code2 = (codes - {code1}).pop() if len(codes) > 1 else code1
    wrong = code1 if code1 != code2 else f"{(int(code2) + 1) % 10 ** 6:06d}"
    r = anon_post(app_url, "/api/auth/confirm", {"email": email, "code": wrong})
    assert r.status_code == 422 and r.json()["error"] == "validation"
    assert r.json()["fields"]["code"] == "That code doesn't match."
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT, headers={"Origin": origin_of(app_url)})
    r = client.post("/api/auth/confirm", json={"email": email, "code": code2})
    assert r.status_code == 200 and r.json()["member"]["handle"] == handle and r.json()["member"]["name"] == name
    assert "pw_session" in r.headers.get("set-cookie", "") and "HttpOnly".lower() in r.headers["set-cookie"].lower()
    assert client.get("/api/me").json()["email"] == email
    assert anon_post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD}).status_code == 200
    cases = [
        ({"email": email, "handle": f"{tag}-other"}, "email", "This email is already registered."),
        ({"email": f"{tag}-x@verify.plainwork.example", "handle": handle}, "handle", "This handle is taken."),
        ({"email": f"{tag}-y@verify.plainwork.example", "handle": "AB"}, "handle",
         "Handles use 3 to 30 lowercase letters, digits and hyphens."),
        ({"email": f"{tag}-z@verify.plainwork.example", "handle": f"{tag}-z", "password": "short"}, "password",
         "Use at least 10 characters."),
        ({"email": f"{tag}-w@verify.plainwork.example", "handle": f"{tag}-w", "name": ""}, "name",
         "Enter a name of 1 to 80 characters."),
    ]
    for change, field, message in cases:
        r = anon_post(app_url, "/api/auth/signup", dict(body, **change))
        assert r.status_code == 422 and r.json()["error"] == "validation", f"{field}: {r.text[:200]}"
        assert r.json()["fields"][field] == message


def test_session_cookie_required_and_signout(app_url, browser):
    w = World(app_url, "a")
    for path in ("/api/me", "/api/feed", "/api/network"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}, path
    r = anon_post(app_url, "/api/auth/signin", {"email": w.email("a"), "password": PASSWORD + "x"})
    assert r.status_code == 422 and r.json() == {"error": "invalid_credentials"}
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT, headers={"Origin": origin_of(app_url)})
    r = client.post("/api/auth/signin", json={"email": w.email("a"), "password": PASSWORD})
    assert r.status_code == 200 and r.json()["member"]["id"] == w.id("a")
    assert "HttpOnly".lower() in r.headers.get("set-cookie", "").lower()
    assert client.get("/api/me").json()["id"] == w.id("a")
    with anonymous(browser, app_url, "/feed") as page:
        eventually(page, lambda: urlparse(page.url).path == "/signin", "signed-out /feed to redirect to /signin",
                   LOAD_S + GRACE_S)
        fill(textbox(page, "Email"), w.email("a"))
        fill(textbox(page, "Password"), PASSWORD + "x")
        click(btn(page, "Sign in"))
        alerted(page, "That email and password don't match.")
        fill(textbox(page, "Password"), PASSWORD)
        click(btn(page, "Sign in"))
        eventually(page, lambda: urlparse(page.url).path == "/feed", "sign-in to land on /feed", LOAD_S + GRACE_S)
        page.goto(app_url + f"/in/{w.handle('a')}")
        loaded(page, btn(page, "Sign out"), "Sign out on the own profile")
        click(btn(page, "Sign out"))
        eventually(page, lambda: page.request.get(app_url + "/api/me").status == 401,
                   "the browser session to end after Sign out")
    assert client.post("/api/auth/signout").status_code == 204
    assert client.get("/api/me").status_code == 401


PRECEDENCE = ["cross_origin_first", "too_large_first", "media_type_before_auth", "auth_before_missing",
              "missing_before_forbidden", "body_id_missing_before_validation", "forbidden_before_validation",
              "conflict_before_validation", "validation_before_limit", "unknown_path"]


@pytest.mark.parametrize("case", PRECEDENCE, ids=PRECEDENCE)
def test_error_shape_and_precedence(app_url, case):
    weekly, window = num(app_url, "PLAINWORK_WEEKLY_INVITES"), num(app_url, "PLAINWORK_EDIT_WINDOW_SECONDS")
    tag, t0 = new_tag(), server_now(app_url)
    targets = [f"t{i}" for i in range(weekly)]
    w = World(app_url, "a b c " + " ".join(targets), tag=tag,
              connections=[conn("a", t, t0, "pending", -60) for t in targets],
              blocks=[{"blocker": "c", "blocked": "a", "at": at(t0, -60)}],
              posts=[post_spec("pb", "b", f"Visible {tag}", t0), post_spec("pc", "c", f"Hidden {tag}", t0),
                     post_spec("pa", "a", f"Old {tag}", t0, -window - 120)])
    raw = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    a = w.m("a")
    if case == "cross_origin_first":
        r = raw.post("/api/posts", content=b"x", headers={"Origin": FOREIGN_ORIGIN, "Content-Type": "text/plain"})
        expected = (403, {"error": "cross_origin"})
    elif case == "too_large_first":
        r = raw.post("/api/posts", content=b"x" * (JSON_LIMIT + 1), headers={"Content-Type": "text/plain"})
        expected = (413, {"error": "payload_too_large"})
    elif case == "media_type_before_auth":
        r = raw.post("/api/posts", content=b"x", headers={"Content-Type": "text/plain"})
        expected = (415, {"error": "unsupported_media_type"})
    elif case == "auth_before_missing":
        r = raw.get(f"/api/posts/missing-{tag}")
        expected = (401, {"error": "unauthenticated"})
    elif case == "missing_before_forbidden":
        r = a.patch(f"/api/posts/{w.id('pc')}", {"text": ""})
        expected = (404, {"error": "not_found"})
    elif case == "body_id_missing_before_validation":
        r = a.post("/api/posts", {"text": "", "shared_post_id": w.id("pc")}, key=idempotency_key())
        expected = (404, {"error": "not_found"})
    elif case == "forbidden_before_validation":
        r = a.patch(f"/api/posts/{w.id('pb')}", {"text": ""})
        expected = (403, {"error": "not_author"})
    elif case == "conflict_before_validation":
        r = a.patch(f"/api/posts/{w.id('pa')}", {"text": ""})
        expected = (409, {"error": "edit_window_closed"})
    elif case == "validation_before_limit":
        r = a.post("/api/connections", {"member_id": a.id})
        assert r.status_code == 422 and r.json()["error"] == "validation"
        assert r.json()["fields"]["member_id"] == "You can't connect with yourself."
        return
    else:
        r = a.get(f"/api/unknown-{tag}")
        expected = (404, {"error": "not_found"})
    assert r.status_code == expected[0], f"{case}: {r.status_code} {r.text[:200]}"
    assert r.json() == expected[1]


IDEMPOTENT = ["post", "comment", "message", "application"]


@pytest.mark.parametrize("kind", IDEMPOTENT, ids=IDEMPOTENT)
def test_idempotency_key_replay_and_reuse(app_url, kind):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "a b p", tag=tag, companies=[company_spec(tag, "co", ["p"])], connections=[conn("a", "b", t0)],
              posts=[post_spec("pb", "b", f"Base {tag}", t0)], jobs=[job_spec(tag, "j1", t0)])
    a, key = w.m("a"), idempotency_key()
    body, other = {"text": f"Once {tag}"}, {"text": f"Other {tag}"}
    if kind == "post":
        path = "/api/posts"
        count = lambda: sum(1 for e in feed_all(a) if e["post"]["text"] == body["text"])
    elif kind == "comment":
        path = f"/api/posts/{w.id('pb')}/comments"
        count = lambda: sum(1 for c in comments_of(a, w.id("pb")) if c.get("text") == body["text"])
    elif kind == "message":
        conv = conversation_with(a, w.id("b"))
        path = f"/api/conversations/{conv}/messages"
        count = lambda: sum(1 for m in messages_of(a, conv) if m["text"] == body["text"])
    else:
        path = f"/api/jobs/{w.id('j1')}/applications"
        body, other = {"resume_id": resume_id(a), "answers": {}}, {"resume_id": resume_id(a), "answers": {}}
        count = lambda: sum(1 for j in a.ok("GET", "/api/me/jobs?tab=applied")["jobs"]
                            if j["id"] == w.id("j1"))
    first = a.post(path, body, key=key)
    assert first.status_code == 201, first.text[:200]
    again = a.post(path, body, key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert count() == 1
    clash = a.post(path, other, key=key)
    assert clash.status_code == 422 and clash.json()["error"] == "idempotency_key_reused"
    assert count() == 1
    if kind == "post":
        assert a.post(path, body).status_code == 201 and a.post(path, body).status_code == 201
        assert count() == 3, "without a key each repeat creates a post"


SOURCE_PATHS = ["/package.json", "/package-lock.json", "/run.json", "/tsconfig.json", "/.env"]


def test_server_boundary(app_url):
    w = World(app_url, "a")
    a = w.m("a")
    text = f"Foreign {w.tag}"
    r = a.c.post("/api/posts", json={"text": text},
                 headers={"Origin": FOREIGN_ORIGIN, "Idempotency-Key": idempotency_key()})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    assert not [e for e in feed_all(a) if e["post"]["text"] == text], "a refused foreign write created a post"
    r = a.c.get("/api/config", headers={"Origin": FOREIGN_ORIGIN})
    assert "access-control-allow-origin" not in r.headers
    filler = JSON_LIMIT - len('{"text":""}')
    exact = ('{"text":"' + "a" * filler + '"}').encode()
    assert len(exact) == JSON_LIMIT
    r = a.c.post("/api/posts", content=exact, headers={"Content-Type": "application/json; charset=utf-8"})
    limit = num(app_url, "PLAINWORK_POST_MAX_CHARS")
    assert r.status_code == 422, "a body of exactly the limit must be read, not refused as too large"
    assert r.json()["fields"]["text"] == f"Posts can be up to {limit:,} characters."
    r = a.c.post("/api/posts", content=exact[:-2] + b'a"}', headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    for path in SOURCE_PATHS:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    landing = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    assets = re.findall(r'<(?:script|link)[^>]+(?:src|href)="([^"]+\.(?:js|css|mjs)[^"]*)"', landing)
    bodies = [landing, httpx.get(app_url + "/api/config", timeout=HTTP_TIMEOUT).text]
    for asset in assets:
        url = urljoin(app_url + "/", asset)
        if not same_origin(url, origin_of(app_url)):
            continue
        bodies.append(httpx.get(url, timeout=HTTP_TIMEOUT).text)
        assert httpx.get(url.split("?")[0] + ".map", timeout=HTTP_TIMEOUT).status_code == 404, f"{asset}.map"
    secrets = [os.environ.get("GRADING_KEY", ""), os.environ.get("S3_SECRET_ACCESS_KEY", ""),
               urlparse(os.environ.get("DATABASE_URL", "")).password or ""]
    for secret in [s for s in secrets if len(s) >= 8]:
        assert not any(secret in b for b in bodies), "a credential value is served to the browser"


def test_connection_state_machine_and_buttons(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "a b c d e", tag=tag,
              connections=[conn("c", "d", t0), conn("e", "a", t0, "pending", -60)])
    a, b = w.m("a"), w.m("b")
    assert state_of(a, w.handle("b")) == "none"
    r = a.post("/api/connections", {"member_id": b.id})
    assert (r.status_code, r.json()) == (201, {"state": "pending_sent"})
    assert state_of(a, w.handle("b")) == "pending_sent" and state_of(b, w.handle("a")) == "pending_received"
    with browse(browser, a, f"/in/{w.handle('b')}") as pa, browse(browser, b, f"/in/{w.handle('a')}") as pb:
        expect_buttons(pa, {"Withdraw"}, "pending_sent profile")
        expect_buttons(pb, {"Accept", "Ignore"}, "pending_received profile")
    r = b.post(f"/api/connections/{a.id}/ignore")
    assert (r.status_code, r.json()) == (200, {"state": "ignored"})
    assert state_of(b, w.handle("a")) == "ignored" and state_of(a, w.handle("b")) == "pending_sent"
    with browse(browser, b, f"/in/{w.handle('a')}") as pb:
        expect_buttons(pb, {"Connect"}, "ignored profile")
    r = b.post("/api/connections", {"member_id": a.id})
    assert (r.status_code, r.json()) == (200, {"state": "connected"})
    assert state_of(a, w.handle("b")) == "connected" == state_of(b, w.handle("a"))
    with browse(browser, a, f"/in/{w.handle('b')}") as pa:
        expect_buttons(pa, {"Message", "Remove connection"}, "connected profile")
        click(btn(pa, "Remove connection"))
        dialog = pa.get_by_role("dialog", name="Remove connection?")
        shown(pa, dialog, "the Remove connection? dialog")
        click(btn(dialog, "Remove"))
        expect_buttons(pa, {"Connect"}, "after Remove connection")
    assert state_of(a, w.handle("b")) == "none" == state_of(b, w.handle("a"))
    for action in ("accept", "ignore", "withdraw"):
        r = a.post(f"/api/connections/{b.id}/{action}")
        assert r.status_code == 409 and r.json() == {"error": "no_pending_request"}, action
    r = a.delete(f"/api/connections/{b.id}")
    assert r.status_code == 409 and r.json() == {"error": "no_connection"}
    r = w.m("c").post("/api/connections", {"member_id": w.id("d")})
    assert r.status_code == 409 and r.json() == {"error": "already_connected"}
    with browse(browser, a, "/network") as page:
        item = member_item(page, page.get_by_role("list", name="Invitations"), w.id("e"))
        loaded(page, item, "the received invitation card")
        assert visible(btn(item, f"Accept {w.name('e')}")) and visible(btn(item, f"Ignore {w.name('e')}"))


def test_cross_and_repeated_connect(app_url, browser):
    weekly = num(app_url, "PLAINWORK_WEEKLY_INVITES")
    targets = [f"t{i}" for i in range(weekly + 1)]
    w = World(app_url, "a b c d g h " + " ".join(targets))
    gate = threading.Barrier(2)

    def toward(src: Member, dst: str, barrier: threading.Barrier) -> httpx.Response:
        barrier.wait()
        return src.post("/api/connections", {"member_id": dst})

    with ThreadPoolExecutor(2) as pool:
        fa = pool.submit(toward, w.fresh("a"), w.id("b"), gate)
        fb = pool.submit(toward, w.fresh("b"), w.id("a"), gate)
        outcomes = [(f.result().status_code, f.result().json().get("state")) for f in (fa, fb)]
    assert all(o in {(201, "pending_sent"), (200, "connected")} for o in outcomes), outcomes
    assert (200, "connected") in outcomes, "the second stored Connect must connect the pair"
    a, b = w.m("a"), w.m("b")
    assert state_of(a, w.handle("b")) == "connected" == state_of(b, w.handle("a"))
    for viewer, other in ((a, b.id), (b, a.id)):
        net = viewer.ok("GET", "/api/network")
        assert other not in [x["id"] for x in net["received"] + net["sent"]], "a pending request survived"
    c = w.m("c")
    gate5 = threading.Barrier(5)
    with ThreadPoolExecutor(5) as pool:
        results = [f.result() for f in [pool.submit(toward, w.fresh("c"), w.id("d"), gate5) for _ in range(5)]]
    assert [r.status_code for r in results].count(201) == 1
    assert all(r.json() == {"state": "pending_sent"} for r in results)
    assert [x["id"] for x in c.ok("GET", "/api/network")["sent"]].count(w.id("d")) == 1
    for t in targets[:weekly - 1]:
        assert c.post("/api/connections", {"member_id": w.id(t)}).status_code == 201, "repeat counted more than once"
    r = c.post("/api/connections", {"member_id": w.id(targets[weekly - 1])})
    assert r.status_code == 429 and r.json() == {"error": "weekly_invite_limit", "limit": weekly}
    with browse(browser, w.m("g"), f"/in/{w.handle('h')}") as page:
        connect = btn(page, "Connect")
        loaded(page, connect, "Connect on a fresh profile")
        connect.dblclick()
        expect_buttons(page, {"Withdraw"}, "after a double click on Connect")
    assert [x["id"] for x in w.m("g").ok("GET", "/api/network")["sent"]].count(w.id("h")) == 1


def test_connection_emails(app_url, mail):
    t0 = server_now(app_url)
    w = World(app_url, "a b c d e f g h", connections=[conn("g", "h", t0, "pending", -60)])
    a, b = w.m("a"), w.m("b")
    a.ok("POST", "/api/connections", {"member_id": b.id}, 201)
    got = mail_with(mail, w.email("b"), f"{w.name('a')} wants to connect on Plainwork")
    sender = _helper("mail_from_address")()
    assert sender.lower() in [x.lower() for x in addresses(got[0].get("From"))]
    b.ok("POST", f"/api/connections/{a.id}/accept")
    mail_with(mail, w.email("a"), f"{w.name('b')} accepted your invitation")
    w.m("c").ok("POST", "/api/connections", {"member_id": w.id("d")}, 201)
    mail_with(mail, w.email("d"), f"{w.name('c')} wants to connect on Plainwork")
    w.m("d").ok("POST", f"/api/connections/{w.id('c')}/ignore")
    no_mail(mail, w.email("c"), f"{w.name('d')} accepted your invitation")
    w.m("e").ok("POST", "/api/connections", {"member_id": w.id("f")}, 201)
    w.m("e").ok("POST", f"/api/connections/{w.id('f')}/withdraw")
    mail_with(mail, w.email("f"), f"{w.name('e')} wants to connect on Plainwork", 1)
    assert len(inbox(mail, w.email("e"), MAIL_SETTLE_S)) == 0, "withdraw must send nothing"
    w.m("h").ok("POST", "/api/connections", {"member_id": w.id("g")})
    mail_with(mail, w.email("g"), f"{w.name('h')} accepted your invitation")


def test_live_network_updates(app_url, browser):
    w = World(app_url, "a b")
    a, b = w.m("a"), w.m("b")
    with browse(browser, b, "/network") as pb, browse(browser, a, f"/in/{w.handle('b')}") as pa:
        nav = pb.get_by_role("navigation", name="Primary")
        loaded(pb, link(nav, "My network"), "the plain My network link")
        expect_buttons(pa, {"Connect"}, "before any request")
        a.ok("POST", "/api/connections", {"member_id": b.id}, 201)
        item = member_item(pb, pb.get_by_role("list", name="Invitations"), a.id)
        shown(pb, item, "the invitation to appear live on My network")
        shown(pb, link(nav, "My network, 1 invitation"), "the My network count to rise live")
        b.ok("POST", f"/api/connections/{a.id}/accept")
        expect_buttons(pa, {"Message", "Remove connection"}, "a's open profile of b after the live accept")
        announced(pa, "Network announcements", f"You are now connected with {w.name('b')}. 1st degree.")
        shown(pb, link(nav, "My network"), "the count to drop back to the plain word")


def test_degree_roll_sequence(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b m", connections=[conn("a", "m", t0), conn("m", "b", t0), conn("a", "b", t0, "pending", -60)])
    with browse(browser, w.m("a"), f"/in/{w.handle('b')}") as page:
        eventually(page, lambda: degree_of(page)[:2] == ("2", "2"), "the numeral 2", LOAD_S + GRACE_S)
        assert text_of(page.locator("[data-mutual-line]")) == "1 mutual connection"
        message = control(page, "Message")
        page.evaluate(ROLL_PROBE, "1")
        w.m("b").ok("POST", f"/api/connections/{w.id('a')}/accept")
        eventually(None, lambda: page.locator("[data-degree-badge]").first.get_attribute("data-degree") == "1",
                   "the degree label to take the new value when the roll starts")
        assert message.count() == 0, "Message must stay out of the accessibility tree before 600 ms"
        assert page.locator("[data-degree-badge]").first.inner_text().strip() == "1st"
        eventually(page, lambda: page.evaluate("() => window.__roll") is not None,
                   "the roll of the new numeral to be observed from its start", LOAD_S + GRACE_S)
        roll = page.evaluate("() => window.__roll")
        assert roll["mid"] - roll["rest"] >= roll["height"] / 4, "at 240 ms the new numeral sits a quarter below rest"
        advance(page, ACTIONS_AT_MS + ACTION_FADE_MS + STEP_MS)
        settle(page.locator("body"))
        shown(page, message, "Message after 600 ms")
        assert degree_of(page)[1] == "1"
        assert text_of(page.locator("[data-mutual-line]")) == "1 mutual connection"


def test_wf_invite_accept_live_happy(app_url, browser, mail):
    t0 = server_now(app_url)
    w = World(app_url, "a b m", connections=[conn("a", "m", t0), conn("m", "b", t0)])
    a, b = w.m("a"), w.m("b")
    with browse(browser, a, f"/in/{w.handle('b')}") as pa, browse(browser, b, "/network") as pb:
        eventually(pa, lambda: degree_of(pa)[:2] == ("2", "2"), "numeral 2", LOAD_S + GRACE_S)
        assert text_of(pa.locator("[data-mutual-line]")) == "1 mutual connection"
        press(btn(pa, "Connect"))
        expect_buttons(pa, {"Withdraw"}, "after keyboard Connect")
        announced(pa, "Network announcements", f"Invitation sent to {w.name('b')}.")
        item = member_item(pb, pb.get_by_role("list", name="Invitations"), a.id)
        shown(pb, item, "the invitation live on b's My network")
        press(btn(item, f"Accept {w.name('a')}"))
        announced(pb, "Network announcements", f"You are now connected with {w.name('a')}.")
        eventually(pa, lambda: degree_of(pa)[0] == "1", "a's numeral to roll to 1")
        shown(pa, control(pa, "Message"), "Message after the roll")
        announced(pa, "Network announcements", f"You are now connected with {w.name('b')}. 1st degree.")
    assert state_of(a, w.handle("b")) == "connected" == state_of(b, w.handle("a"))
    mail_with(mail, w.email("b"), f"{w.name('a')} wants to connect on Plainwork")
    mail_with(mail, w.email("a"), f"{w.name('b')} accepted your invitation")


def test_wf_invite_accept_live_ignore_then_connect(app_url, browser, mail):
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0, "pending", -60)])
    a, b = w.m("a"), w.m("b")
    with browse(browser, a, f"/in/{w.handle('b')}") as pa, browse(browser, b, "/network") as pb:
        item = member_item(pb, pb.get_by_role("list", name="Invitations"), a.id)
        loaded(pb, item, "the pending invitation")
        press(btn(item, f"Ignore {w.name('a')}"))
        announced(pb, "Network announcements", "Invitation ignored.")
        expect_buttons(pa, {"Withdraw"}, "sender still sees Withdraw")
        no_mail(mail, w.email("a"), f"{w.name('b')} accepted your invitation")
        pb.goto(app_url + f"/in/{w.handle('a')}")
        loaded(pb, btn(pb, "Connect"), "Connect on the ignored profile")
        press(btn(pb, "Connect"))
        eventually(pa, lambda: degree_of(pa)[0] == "1", "a's open profile to roll to 1 live")
    assert state_of(a, w.handle("b")) == "connected"
    mail_with(mail, w.email("a"), f"{w.name('b')} accepted your invitation")


def test_withdraw_cooldown_and_retry_instant(app_url, browser):
    cooldown, tz = num(app_url, "PLAINWORK_INVITE_COOLDOWN_SECONDS"), zone(app_url)
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0, "pending", -60)])
    a = w.m("a")
    before = server_now(app_url)
    r = a.post(f"/api/connections/{w.id('b')}/withdraw")
    after = server_now(app_url)
    assert r.status_code == 200 and r.json()["state"] == "withdrawn"
    retry = parse_ts(r.json()["retry_at"])
    gap = timedelta(seconds=cooldown)
    assert before + gap - timedelta(seconds=1) <= retry <= after + gap + timedelta(seconds=1)
    r = a.post("/api/connections", {"member_id": w.id("b")})
    assert r.status_code == 409 and r.json()["error"] == "invite_cooldown" and parse_ts(r.json()["retry_at"]) == retry
    clock_to(app_url, retry - timedelta(seconds=BOUNDARY_S))
    assert a.post("/api/connections", {"member_id": w.id("b")}).status_code == 409
    clock_to(app_url, retry)
    r = a.post("/api/connections", {"member_id": w.id("b")})
    assert (r.status_code, r.json()) == (201, {"state": "pending_sent"})
    withdrawn_at = server_now(app_url) - timedelta(seconds=30)
    w2 = World(app_url, "c d", connections=[{"from": "c", "to": "d", "state": "withdrawn", "at": iso(withdrawn_at)}])
    retry2 = withdrawn_at + gap
    with browse(browser, w2.m("c"), f"/in/{w2.handle('d')}", device_time=DEVICE_PAST) as page:
        loaded(page, btn(page, "Connect"), "Connect in the withdrawn state")
        click(btn(page, "Connect"))
        alerted(page, f"You withdrew an invitation to {w2.name('d')}. You can invite them again on "
                      f"{fmt_date(retry2, tz)} at {fmt_time(retry2, tz)}.")


def test_weekly_invite_limit_window(app_url):
    weekly = num(app_url, "PLAINWORK_WEEKLY_INVITES")
    t0 = server_now(app_url)
    old = t0 - timedelta(seconds=WEEK_S - 120)
    states = ["pending", "withdrawn", "ignored"]
    targets = [f"r{i}" for i in range(weekly - 1)]
    links = [{"from": "a", "to": t, "state": states[i % 3], "at": iso(old)} for i, t in enumerate(targets)]
    links += [conn("a", "w", t0, "withdrawn", -60), conn("y", "a", t0, "pending", -60)]
    w = World(app_url, "a x w y " + " ".join(targets), connections=links)
    a = w.m("a")
    r = a.post("/api/connections", {"member_id": w.id("x")})
    assert r.status_code == 429 and r.json() == {"error": "weekly_invite_limit", "limit": weekly}
    assert w.id("x") not in [c["id"] for c in a.ok("GET", "/api/network")["sent"]], "a 429 must create nothing"
    r = a.post("/api/connections", {"member_id": w.id("w")})
    assert r.status_code == 409 and r.json()["error"] == "invite_cooldown", "the cooldown 409 wins over the 429"
    assert a.ok("POST", f"/api/connections/{w.id('y')}/accept") == {"state": "connected"}
    clock_to(app_url, old + timedelta(seconds=WEEK_S - BOUNDARY_S))
    assert a.post("/api/connections", {"member_id": w.id("x")}).status_code == 429
    clock_to(app_url, old + timedelta(seconds=WEEK_S))
    r = a.post("/api/connections", {"member_id": w.id("x")})
    assert (r.status_code, r.json()) == (201, {"state": "pending_sent"})


def test_wf_withdraw_cooldown_limit_cooldown(app_url, browser):
    tz = zone(app_url)
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0, "pending", -60)])
    a = w.m("a")
    with browse(browser, a, f"/in/{w.handle('b')}", device_time=DEVICE_FUTURE) as page:
        loaded(page, btn(page, "Withdraw"), "Withdraw on the pending profile")
        press(btn(page, "Withdraw"))
        announced(page, "Network announcements", "Invitation withdrawn.")
        shown(page, btn(page, "Connect"), "Connect after withdrawing")
        retry = parse_ts(a.post("/api/connections", {"member_id": w.id("b")}).json()["retry_at"])
        press(btn(page, "Connect"))
        alerted(page, f"You withdrew an invitation to {w.name('b')}. You can invite them again on "
                      f"{fmt_date(retry, tz)} at {fmt_time(retry, tz)}.")
        clock_to(app_url, retry)
        press(btn(page, "Connect"))
        announced(page, "Network announcements", f"Invitation sent to {w.name('b')}.")
        expect_buttons(page, {"Withdraw"}, "after the retry instant")
    assert state_of(a, w.handle("b")) == "pending_sent"


def test_wf_withdraw_cooldown_limit_weekly(app_url, browser):
    weekly = num(app_url, "PLAINWORK_WEEKLY_INVITES")
    t0 = server_now(app_url)
    old = t0 - timedelta(seconds=WEEK_S - 120)
    targets = [f"r{i}" for i in range(weekly)]
    w = World(app_url, "a c " + " ".join(targets),
              connections=[{"from": "a", "to": t, "state": "pending", "at": iso(old)} for t in targets])
    a = w.m("a")
    with browse(browser, a, f"/in/{w.handle('c')}") as page:
        loaded(page, btn(page, "Connect"), "Connect")
        press(btn(page, "Connect"))
        alerted(page, f"You've reached the weekly invitation limit of {weekly:,}.")
        announced(page, "Network announcements", "Invitation not sent.")
        clock_to(app_url, old + timedelta(seconds=WEEK_S))
        press(btn(page, "Connect"))
        announced(page, "Network announcements", f"Invitation sent to {w.name('c')}.")
    assert state_of(a, w.handle("c")) == "pending_sent"


def test_sent_grid_keyboard_withdraw(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b c d e f", connections=[conn("a", "b", t0, "pending", -600), conn("a", "c", t0, "pending", -1200),
                                                   conn("a", "d", t0, "pending", -1800), conn("a", "e", t0, "pending", -2400),
                                                   conn("a", "f", t0, "pending", -3000)])
    a = w.m("a")
    with browse(browser, a, "/network") as page:
        grid = page.get_by_role("grid", name="Sent invitations")
        row = lambda k: grid.get_by_role("row").and_(page.locator(f"[data-member-id='{w.id(k)}']"))
        loaded(page, row("f"), "the sent invitations grid")
        cells = lambda k: row(k).get_by_role("gridcell").or_(row(k).get_by_role("rowheader"))
        assert btn(page, "Withdraw selected (0)").is_disabled()
        picked_label = f"Withdraw selected ({PICKED})"
        picked_dialog = f"Withdraw {PICKED} invitations?"
        cells("b").first.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Space")
        eventually(page, lambda: row("b").get_attribute("aria-selected") == "true"
                   and row("c").get_attribute("aria-selected") == "true", "rows b and c selected")
        press(btn(page, picked_label))
        dialog = page.get_by_role("dialog", name=picked_dialog)
        shown(page, dialog, "the batch confirm dialog")
        click(btn(dialog, "Withdraw"))
        announced(page, "Network announcements", f"Withdrew {PICKED} invitations.")
        absent(page, row("b"), "withdrawn rows to leave")
        eventually(page, lambda: focus_within(row("d")), "focus on the row now in the first withdrawn position")
        cells("d").first.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Space")
        a.ok("POST", f"/api/connections/{w.id('d')}/withdraw")
        live_deadline, removed_live = time.monotonic() + LIVE_S + GRACE_S, False
        while time.monotonic() < live_deadline:
            if row("d").count() == 0:
                removed_live = True
                break
            advance(page, STEP_MS)
        if not removed_live:
            press(btn(page, picked_label))
            click(btn(page.get_by_role("dialog", name=picked_dialog), "Withdraw"))
            alerted(page, f"{w.name('d')}'s invitation is no longer pending. Nothing was withdrawn.")
    sent = [c["id"] for c in a.ok("GET", "/api/network")["sent"]]
    assert w.id("e") in sent and w.id("f") in sent and w.id("b") not in sent and w.id("c") not in sent
    assert state_of(a, w.handle("b")) == "withdrawn"
    with browse(browser, a, "/network") as page:
        grid = page.get_by_role("grid", name="Sent invitations")
        r_f = grid.get_by_role("row").and_(page.locator(f"[data-member-id='{w.id('f')}']"))
        loaded(page, r_f, "row f")
        a.ok("POST", "/api/invitations/withdraw", {"member_ids": [w.id("e")]})
        page.reload()
        loaded(page, r_f, "row f after reload")
        r_f.get_by_role("gridcell").or_(r_f.get_by_role("rowheader")).first.focus()
        page.keyboard.press("Space")
        press(btn(page, "Withdraw selected (1)"))
        click(btn(page.get_by_role("dialog", name="Withdraw 1 invitation?"), "Withdraw"))
        shows_text(page, "No pending invitations.")
        eventually(page, lambda: has_focus(page.get_by_role("heading", name="Sent invitations")),
                   "focus on the Sent invitations heading when the grid empties")


def test_batch_withdraw_api_all_or_nothing(app_url):
    t0 = server_now(app_url)
    w = World(app_url, "a b c x", connections=[conn("a", "b", t0, "pending", -60), conn("a", "c", t0, "pending", -60)])
    a = w.m("a")
    r = a.post("/api/invitations/withdraw", {"member_ids": [w.id("b"), w.id("x"), w.id("c")]})
    assert r.status_code == 409 and r.json() == {"error": "not_pending", "member_id": w.id("x")}
    assert state_of(a, w.handle("b")) == "pending_sent" == state_of(a, w.handle("c"))
    r = a.post("/api/invitations/withdraw", {"member_ids": []})
    assert r.status_code == 422 and r.json()["fields"]["member_ids"] == "Choose 1 to 50 invitations."
    body = a.ok("POST", "/api/invitations/withdraw", {"member_ids": [w.id("c"), w.id("b")]})
    assert body["withdrawn"] == [w.id("c"), w.id("b")] and parse_ts(body["retry_at"])
    assert state_of(a, w.handle("b")) == "withdrawn" == state_of(a, w.handle("c"))
    rb = parse_ts(a.post("/api/connections", {"member_id": w.id("b")}).json()["retry_at"])
    rc = parse_ts(a.post("/api/connections", {"member_id": w.id("c")}).json()["retry_at"])
    assert rb == rc == parse_ts(body["retry_at"]), "every request in the batch is withdrawn at one instant"


DEGREE_LABELS = {"1": ("1st", "1"), "2": ("2nd", "2"), "3": ("3rd+", "3"), "out": ("Out of network", "—")}


def test_degree_from_graph_with_blocks(app_url, browser):
    t0 = server_now(app_url)
    pairs = [("a", "b"), ("b", "c"), ("c", "d"), ("a", "p"), ("p", "q"), ("a", "r"), ("r", "s"), ("s", "q")]
    w = World(app_url, "a b c d e p q r s", connections=[conn(x, y, t0) for x, y in pairs])
    a = w.m("a")
    degree = lambda k: profile(a, w.handle(k))["degree"]
    expected = {"b": "1", "c": "2", "d": "3", "e": "out"}
    assert {k: degree(k) for k in expected} == expected and degree("q") == "2"
    with browse(browser, a, f"/in/{w.handle('b')}") as page:
        for k, d in expected.items():
            page.goto(app_url + f"/in/{w.handle(k)}")
            label, glyph = DEGREE_LABELS[d]
            eventually(page, lambda d=d, label=label, glyph=glyph: degree_of(page) == (d, glyph, d, label),
                       f"profile {k} to show degree {d}", LOAD_S + GRACE_S)
    a.ok("POST", "/api/blocks", {"member_id": w.id("b")}, 201)
    assert degree("c") == "out" and degree("d") == "out"
    a.ok("POST", "/api/blocks", {"member_id": w.id("p")}, 201)
    assert degree("q") == "3", "with the bridge blocked the longer path applies"


MUTUAL_CASES = ["one", "two", "three"]


@pytest.mark.parametrize("count_case", MUTUAL_CASES, ids=MUTUAL_CASES)
def test_mutual_line_and_list(app_url, browser, count_case):
    n = MUTUAL_CASES.index(count_case) + 1
    t0 = server_now(app_url)
    when = {"m1": -3 * DAY_S, "m2": -DAY_S, "m3": -DAY_S}
    mutuals = ["m1", "m2", "m3"][:n]
    links = [conn("v", m, t0, seconds=when[m]) for m in mutuals] + [conn("o", m, t0, seconds=-5 * DAY_S) for m in mutuals]
    w = World(app_url, "v o m1 m2 m3", connections=links)
    v = w.m("v")
    order = sorted(mutuals, key=lambda m: (-when[m], w.name(m).lower()))
    lead = w.name(order[0])
    text = {1: "1 mutual connection", 2: f"{lead} and 1 other mutual connection",
            3: f"{lead} and 2 other mutual connections"}[n]
    mutual = profile(v, w.handle("o"))["mutual"]
    assert mutual["count"] == n and mutual["named"]["id"] == w.id(order[0])
    listing = v.ok("GET", f"/api/profiles/{w.handle('o')}/mutual")
    assert listing["count"] == n and [c["id"] for c in listing["members"]] == [w.id(m) for m in order]
    with browse(browser, v, f"/in/{w.handle('o')}") as page:
        line = page.locator("[data-mutual-line]").first
        eventually(page, lambda: text_of(line) == text, f"the mutual line {text!r}", LOAD_S + GRACE_S)
        assert line.get_attribute("data-count") == str(n)
        assert (line.get_attribute("href") or "").endswith(f"/in/{w.handle('o')}/mutual")
        click(line)
        loaded(page, page.get_by_role("heading", name=f"Mutual connections with {w.name('o')}"), "the mutual heading")
        items = page.get_by_role("list", name="Mutual connections").get_by_role("listitem")
        eventually(page, lambda: items.evaluate_all("els => els.map(e => e.getAttribute('data-member-id'))")
                   == [w.id(m) for m in order], "the mutual list in the same order")


OWNER_KEYS = {"id", "handle", "name", "headline", "location", "photo_url", "visibility", "degree", "email",
              "versions", "about", "experience", "education", "skills"}
FULL_KEYS = {"id", "handle", "name", "headline", "location", "photo_url", "visibility", "degree",
             "connection_state", "following", "mutual", "about", "experience", "education", "skills"}
LIMITED_KEYS = {"id", "handle", "name", "headline", "location", "photo_url", "visibility", "degree",
                "connection_state", "following", "mutual"}
PRIVATE_KEYS = {"id", "handle", "name", "headline", "visibility", "degree", "connection_state"}
PROJECTION_CASES = {
    "owner": ("public", "self", OWNER_KEYS),
    "public": ("public", "stranger", FULL_KEYS),
    "connections_first": ("connections", "first", FULL_KEYS),
    "connections_other": ("connections", "stranger", LIMITED_KEYS),
    "private_first": ("private", "first", PRIVATE_KEYS),
    "private_other": ("private", "stranger", None),
    "blocked": ("public", "blocked", None),
}


PROJECTION_IDS = ["owner", "public", "connections_first", "connections_other", "private_first", "private_other", "blocked"]


@pytest.mark.parametrize("case", PROJECTION_IDS, ids=PROJECTION_IDS)
def test_profile_projection(app_url, case):
    visibility, viewer, keys = PROJECTION_CASES[case]
    t0 = server_now(app_url)
    w = World(app_url, "o f s k", profiles={"o": {"visibility": visibility, "skills": ["Rigging"]}},
              connections=[conn("o", "f", t0)], blocks=[{"blocker": "k", "blocked": "o", "at": at(t0, -60)}])
    who = {"self": "o", "first": "f", "stranger": "s", "blocked": "k"}[viewer]
    r = w.m(who).get(f"/api/profiles/{w.handle('o')}")
    if keys is None:
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
        return
    body = r.json()
    assert r.status_code == 200 and set(body) == keys, sorted(set(body) ^ keys)
    if viewer == "self":
        assert body["degree"] == "self" and set(body["versions"]) == {"intro", "about", "experience", "education", "skills"}
        assert set(w.m("o").ok("GET", "/api/me")) == OWNER_KEYS
    else:
        assert "email" not in body and body["degree"] in {"1", "2", "3", "out"}
    if "mutual" in body:
        assert body["mutual"]["count"] == 0 and "named" not in body["mutual"]
    if "skills" in body:
        assert set(body["skills"][0]) == {"name", "endorsements", "endorsed_by_me", "featured_position", "endorser_line"}


def test_visibility_setting_and_placeholders(app_url, browser):
    t0 = server_now(app_url)
    about = f"Secret about {new_tag()}"
    w = World(app_url, "o c s", profiles={"o": {"about": about}}, connections=[conn("o", "c", t0)])
    o, c, s = w.m("o"), w.m("c"), w.m("s")
    with browse(browser, o, "/settings") as page:
        group = page.get_by_role("radiogroup", name="Profile visibility")
        loaded(page, group, "the visibility radiogroup")
        check(group.get_by_role("radio", name="Connections only", exact=True))
        announced(page, "Profile announcements", "Visibility saved.")
        eventually(None, lambda: o.ok("GET", "/api/me")["visibility"] == "connections", "visibility stored")
        with browse(browser, s, f"/in/{w.handle('o')}") as ps:
            shows_text(ps, f"{w.first('o')} shares experience, education and skills with connections only.",
                       seconds=LOAD_S + GRACE_S)
            assert ps.get_by_text(about).count() == 0
        with browse(browser, c, f"/in/{w.handle('o')}") as pc:
            loaded(pc, pc.get_by_text(about), "the About text for a connection")
        check(group.get_by_role("radio", name="Private", exact=True))
        announced(page, "Profile announcements", "Visibility saved.")
    with browse(browser, c, f"/in/{w.handle('o')}") as pc:
        shows_text(pc, f"{w.first('o')} keeps this profile private.", seconds=LOAD_S + GRACE_S)
    with browse(browser, s, f"/in/{w.handle('o')}") as ps:
        loaded(ps, ps.get_by_role("heading", name="This profile isn't available"), "the not-available heading")
        assert visible(link(ps, "Go to Home"))


def test_people_search_matching_filters_order(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    profiles = {"c": {"experience": [{"title": "Rigger", "company": f"Crane{tag}", "start": "2020-01", "end": None}]},
                "e": {"location": f"Town{tag} North"}, "h": {"headline": f"Welder {tag}weld"},
                "x": {"visibility": "private"}, "y": {"visibility": "private"}}
    w = World(app_url, "v c y d e o x k h", profiles=profiles, tag=tag,
              connections=[conn("v", "c", t0), conn("v", "y", t0), conn("c", "d", t0), conn("d", "e", t0),
                           conn("v", "k", t0)], blocks=[{"blocker": "v", "blocked": "k", "at": at(t0, -60)}])
    v = w.m("v")
    ids = lambda **f: [r["id"] for r in search_all(v, type="people", **f) if r["id"] != w.id("v")]
    everyone = [w.id(k) for k in ("c", "y", "d", "e", "h", "o")]
    assert ids(q=tag) == everyone
    total = v.ok("GET", "/api/search?" + urlencode({"type": "people", "q": tag}))
    assert total["total"] - sum(1 for r in total["results"] if r["id"] == w.id("v")) == len(everyone)
    assert total["type"] == "people"
    assert "photo_url" not in next(r for r in total["results"] if r["id"] == w.id("y"))
    assert ids(q=f"cas {tag}") == [w.id("c")]
    assert ids(q=f"{tag}weld") == [w.id("h")]
    assert ids(q=tag, degree="1") == [w.id("c"), w.id("y")]
    assert ids(q=tag, degree="2,3") == [w.id("d"), w.id("e")]
    assert ids(q=tag, degree="1,2,3") == everyone
    assert ids(q=tag, company=f"crane{tag}") == [w.id("c")]
    assert ids(q=tag, location=f"town{tag}") == [w.id("e")]
    assert w.id("v") not in [r["id"] for r in search_all(w.m("k"), type="people", q=tag)]
    empty = v.ok("GET", "/api/search?type=people&q=")
    assert empty["total"] == 0 and empty["results"] == []


def test_post_and_job_search(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    word = f"alpha{tag}"
    w = World(app_url, "v c o x k p", profiles={"x": {"visibility": "private"}}, tag=tag,
              companies=[company_spec(tag, "co", ["p"])],
              blocks=[{"blocker": "v", "blocked": "k", "at": at(t0, -60)}],
              posts=[post_spec("p1", "c", f"{word} one", t0, -3 * 3600), post_spec("p2", "o", f"{word} two", t0, -3600),
                     post_spec("p3", "x", f"{word} three", t0, -60), post_spec("p4", "k", f"{word} four", t0, -60),
                     post_spec("p5", "c", f"{word} five", t0, -120), post_spec("p6", "o", f"beta {word}", t0, -7200)],
              jobs=[job_spec(tag, "j1", t0, workplace="remote", location=f"Austin {tag}", posted_at=at(t0, -7200)),
                    job_spec(tag, "j2", t0, workplace="hybrid", posted_at=at(t0, -3 * DAY_S)),
                    job_spec(tag, "j3", t0, posted_at=at(t0, -20 * DAY_S)),
                    job_spec(tag, "j4", t0, closes_at=at(t0, -3600))])
    v = w.m("v")
    w.m("c").ok("DELETE", f"/api/posts/{w.id('p5')}", status=204)
    posts = lambda q: [r["id"] for r in search_all(v, type="posts", q=q)]
    assert posts(word) == [w.id("p2"), w.id("p6"), w.id("p1")]
    assert posts(f"{word} two") == [w.id("p2")]
    jobs = lambda **f: [r["id"] for r in search_all(v, type="jobs", **f)]
    assert jobs(q=tag) == [w.id("j1"), w.id("j2"), w.id("j3")]
    assert jobs(q=f"yard {tag}") == [w.id("j1"), w.id("j2"), w.id("j3")], "company name matches"
    assert jobs(q=tag, workplace="remote") == [w.id("j1")]
    assert jobs(q=tag, location=f"austin {tag}".upper()) == [w.id("j1")]
    assert jobs(q=tag, posted="day") == [w.id("j1")]
    assert jobs(q=tag, posted="week") == [w.id("j1"), w.id("j2")]
    assert jobs(q=tag, posted="month") == [w.id("j1"), w.id("j2"), w.id("j3")]
    open_all = jobs(q="")
    assert w.id("j1") in open_all and w.id("j4") not in open_all
    r = v.get("/api/search?type=things&q=x")
    assert r.status_code == 422 and r.json()["fields"]["type"] == "Choose people, posts or jobs."
    r = v.get("/api/search?" + urlencode({"type": "posts", "q": "q" * (SEARCH_Q_MAX + 1)}))
    assert r.status_code == 422 and r.json()["fields"]["q"] == "Search text can be up to 100 characters."


def _search_q(route_url: str) -> str:
    return parse_qs(urlparse(route_url).query).get("q", [""])[0]


def test_search_in_place_count_and_latest_input(app_url, browser):
    w = World(app_url, "v c d e")
    first, second = w.tag, f"{w.tag} cas"
    with browse(browser, w.m("v"), "/search?type=people&q=") as page:
        page.evaluate("() => { window.__verifySamePage = true; }")
        box = page.get_by_role("searchbox", name="Search")
        status = page.get_by_role("status", name="Search results")
        cards = lambda: page.locator("[data-member-id]").evaluate_all(
            "els => els.map(e => e.getAttribute('data-member-id'))")
        stale: list = []

        def hold(route):
            if _search_q(route.request.url) == first and not stale:
                stale.append(route)
            else:
                route.fallback()

        page.route("**/api/search**", hold)
        box.click()
        page.keyboard.type(first)
        eventually(page, lambda: len(stale) == 1, "the first search request to go out after the pause")
        page.keyboard.type(" cas")
        eventually(page, lambda: (status.text_content() or "").strip() == "1 result", "1 result for the latest text")
        with contextlib.suppress(Exception):
            stale[0].fallback()
        for _ in range(10):
            advance(page, STEP_MS)
            assert (status.text_content() or "").strip() == "1 result", "a stale response replaced the results"
        assert cards() == [w.id("c")]
        page.unroute("**/api/search**")
        box.fill(first)
        eventually(page, lambda: (status.text_content() or "").strip() in ("3 results", "4 results"),
                   "the count of matches")
        box.fill(f"zz{w.tag}")
        eventually(page, lambda: (status.text_content() or "").strip() == f"No results for “zz{w.tag}”", "no results")
        shown(page, link(page, "Clear search"), "Clear search")
        assert page.evaluate("() => window.__verifySamePage === true"), "search must not reload the page"


def test_search_failure_and_try_again(app_url, browser):
    w = World(app_url, "v c")
    with browse(browser, w.m("v"), "/search?type=people&q=") as page:
        failing = {"on": True}
        page.route("**/api/search**", lambda r: r.abort() if failing["on"] else r.fallback())
        page.get_by_role("searchbox", name="Search").fill(w.name("c"))
        shows_text(page, "Search isn't working right now.")
        failing["on"] = False
        click(btn(page, "Try again"))
        eventually(page, lambda: (page.get_by_role("status", name="Search results").text_content() or "").strip()
                   == "1 result", "Try again to repeat the latest search")


def _chain_world(app_url: str) -> World:
    t0 = server_now(app_url)
    return World(app_url, "v b c d e f", profiles={"e": {"visibility": "connections"}, "f": {"visibility": "private"}},
                 connections=[conn("v", "b", t0), conn("b", "c", t0), conn("c", "d", t0), conn("b", "e", t0)])


def _walk_chain(page: Page, w: World, app_url: str) -> None:
    expect_map = {"b": ("1", ""), "c": ("2", "1 mutual connection"), "d": ("3", ""), "e": ("2", "1 mutual connection")}
    for k, (d, mutual) in expect_map.items():
        page.goto(app_url + f"/in/{w.handle(k)}")
        label, glyph = DEGREE_LABELS[d]
        eventually(page, lambda d=d, l=label, g=glyph: degree_of(page) == (d, g, d, l), f"{k} degree {d}",
                   LOAD_S + GRACE_S)
        if mutual:
            assert text_of(page.locator("[data-mutual-line]")) == mutual
    shows_text(page, f"{w.first('e')} shares experience, education and skills with connections only.")
    page.goto(app_url + f"/in/{w.handle('f')}")
    loaded(page, page.get_by_role("heading", name="This profile isn't available"), "private non-connection 404 page")
    page.goto(app_url + f"/search?type=people&q={w.tag}")
    for k, d in (("b", "1"), ("c", "2"), ("d", "3"), ("e", "2")):
        card = page.get_by_role("listitem").and_(page.locator(f"[data-member-id='{w.id(k)}']"))
        loaded(page, card, f"{k} in people search")
        assert card.get_attribute("data-degree") == d
    assert page.locator(f"[data-member-id='{w.id('f')}']").count() == 0


def test_wf_degree_visibility_desktop(app_url, browser):
    w = _chain_world(app_url)
    with browse(browser, w.m("v"), "/feed") as page:
        _walk_chain(page, w, app_url)
    assert profile(w.m("v"), w.handle("d"))["degree"] == "3"


def test_wf_degree_visibility_phone(app_url, browser):
    w = _chain_world(app_url)
    with browse(browser, w.m("v"), "/feed", size=PHONE) as page:
        loaded(page, page.get_by_role("navigation", name="Tabs"), "the phone tab bar")
        _walk_chain(page, w, app_url)
        layout(page)
    assert w.m("v").get(f"/api/profiles/{w.handle('f')}").status_code == 404


def test_block_effects_both_ways(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "a b c m x", tag=tag,
              connections=[conn("a", "b", t0), conn("a", "m", t0), conn("b", "m", t0), conn("c", "a", t0, "pending", -60),
                           conn("m", "x", t0), conn("b", "x", t0)],
              follows=[{"follower": "a", "target": "b", "at": at(t0, -60)}, {"follower": "b", "target": "a", "at": at(t0, -60)}],
              posts=[post_spec("pa", "a", f"alpha{tag} a", t0, -600), post_spec("pb", "b", f"alpha{tag} b", t0, -500)],
              reposts=[{"key": "rb", "author": "m", "of": "pb", "text": None, "at": at(t0, -400)}],
              reactions=[{"post": "pa", "user": "b", "type": "like", "at": at(t0, -300)},
                         {"post": "pa", "user": "m", "type": "like", "at": at(t0, -300)}],
              comments=[{"key": "cb", "post": "pa", "author": "b", "parent": None, "text": "from b", "at": at(t0, -200)},
                        {"key": "cm", "post": "pa", "author": "m", "parent": "cb", "text": "reply m", "at": at(t0, -100)}],
              messages=[{"from": "a", "to": "b", "text": f"hi {tag}", "at": at(t0, -50), "read_at": None}])
    a, b = w.m("a"), w.m("b")
    conv = a.ok("GET", "/api/conversations")["conversations"][0]["id"]
    assert profile(a, w.handle("x"))["mutual"]["count"] == 2
    assert a.ok("POST", "/api/blocks", {"member_id": b.id}, 201) == {"blocked": True}
    assert a.ok("POST", "/api/blocks", {"member_id": b.id}, 200) == {"blocked": True}
    for viewer, other in ((a, "b"), (b, "a")):
        assert viewer.get(f"/api/profiles/{w.handle(other)}").status_code == 404
        assert w.id(other) not in [r["id"] for r in search_all(viewer, type="people", q=tag)]
        assert viewer.get(f"/api/conversations/{conv}/messages").status_code == 404
    assert b.get(f"/api/posts/{w.id('pa')}").status_code == 404 and a.get(f"/api/posts/{w.id('pb')}").status_code == 404
    assert w.id("pb") not in [e["post"]["id"] for e in feed_all(a)], "blocked post or its repost in feed"
    assert comments_of(a, w.id("pa")) == [], "a blocked member's comment hides with its replies"
    summary = a.ok("GET", f"/api/posts/{w.id('pa')}")["reactions"]
    assert summary["count"] == 1
    assert [r["member"]["id"] for r in a.ok("GET", f"/api/posts/{w.id('pa')}/reactions")["reactors"]] == [w.id("m")]
    assert profile(a, w.handle("x"))["mutual"]["count"] == 1
    a.ok("POST", "/api/blocks", {"member_id": w.id("c")}, 201)
    assert [x["id"] for x in a.ok("GET", "/api/blocks")["blocked"]] == [w.id("c"), w.id("b")]
    r = a.post("/api/blocks", {"member_id": a.id})
    assert r.status_code == 422 and r.json()["fields"]["member_id"] == "You can't block yourself."
    assert a.ok("DELETE", f"/api/blocks/{b.id}") == {"blocked": False}
    a.ok("DELETE", f"/api/blocks/{w.id('c')}")
    pb = profile(a, w.handle("b"))
    assert pb["connection_state"] == "none" and pb["following"] is False
    assert profile(b, w.handle("a"))["following"] is False
    assert w.id("c") not in [x["id"] for x in a.ok("GET", "/api/network")["received"]]
    assert [m["text"] for m in messages_of(a, conv)] == [f"hi {tag}"], "history returns after unblock"


def test_block_controls_keyboard(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0)])
    a = w.m("a")
    with browse(browser, a, f"/in/{w.handle('b')}") as page:
        more = btn(page, "More actions")
        loaded(page, more, "More actions")
        press(more)
        item = page.get_by_role("menuitem", name=f"Block {w.name('b')}", exact=True)
        shown(page, item, "the Block menu item")
        page.keyboard.press("Escape")
        eventually(page, lambda: has_focus(more), "Escape to return focus to More actions")
        press(more)
        press(item)
        dialog = page.get_by_role("dialog", name=f"Block {w.name('b')}?")
        shown(page, dialog, "the Block confirm dialog")
        press(btn(dialog, "Cancel"))
        absent(page, dialog, "Cancel closes the dialog")
        assert state_of(a, w.handle("b")) == "connected"
        press(more)
        press(page.get_by_role("menuitem", name=f"Block {w.name('b')}", exact=True))
        press(btn(page.get_by_role("dialog", name=f"Block {w.name('b')}?"), "Block"))
        announced(page, "Network announcements", f"You blocked {w.name('b')}.")
        eventually(page, lambda: has_focus(link(page, "Manage blocked members")), "focus on Manage blocked members")
    assert a.get(f"/api/profiles/{w.handle('b')}").status_code == 404
    with browse(browser, a, "/settings") as page:
        blocked = page.get_by_role("list", name="Blocked members")
        loaded(page, btn(blocked, f"Unblock {w.name('b')}"), "Unblock in Settings")
        press(btn(blocked, f"Unblock {w.name('b')}"))
        announced(page, "Network announcements", f"Unblocked {w.name('b')}.")
    assert state_of(a, w.handle("b")) == "none"


def test_counts_leave_out_blocked(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o v p r1 r2 r3 r4 r5 r6", tag=tag, companies=[company_spec(tag, "co", ["p"])],
              posts=[post_spec("pp", "o", f"Count {tag}", t0)])
    pid = w.id("pp")
    reactors = ["r1", "r2", "r3", "r4", "r5", "r6"]
    gate = threading.Barrier(len(reactors))

    def react(k: str) -> int:
        m = w.fresh(k)
        gate.wait()
        return m.put(f"/api/posts/{pid}/reaction", {"type": "like"}).status_code

    with ThreadPoolExecutor(len(reactors)) as pool:
        assert all(s == 200 for s in pool.map(react, reactors))
    o, v = w.m("o"), w.m("v")
    assert o.ok("GET", f"/api/posts/{pid}")["reactions"]["count"] == 6
    assert len(o.ok("GET", f"/api/posts/{pid}/reactions")["reactors"]) == 6
    gate2 = threading.Barrier(5)
    types = ["like", "celebrate", "support", "insightful", "funny"]

    def flip(t: str) -> int:
        m = w.fresh("r3")
        gate2.wait()
        return m.put(f"/api/posts/{pid}/reaction", {"type": t}).status_code

    with ThreadPoolExecutor(5) as pool:
        list(pool.map(flip, types))
    assert len(o.ok("GET", f"/api/posts/{pid}/reactions")["reactors"]) == 6, "one reaction per member after a race"
    for k in ("r1", "r2"):
        w.m(k).ok("POST", f"/api/posts/{pid}/comments", {"text": f"c {k}"}, 201, key=idempotency_key())
        w.m(k).ok("POST", f"/api/follows", {"target_id": w.id("co")}, 201)
    w.m("r1").ok("POST", f"/api/posts/{pid}/reposts", status=201)
    w.m("r2").ok("POST", "/api/posts", {"text": f"thoughts {tag}", "shared_post_id": pid}, 201, key=idempotency_key())
    v.ok("POST", "/api/blocks", {"member_id": w.id("r1")}, 201)
    post = v.ok("GET", f"/api/posts/{pid}")
    assert post["reactions"]["count"] == 5 == len(v.ok("GET", f"/api/posts/{pid}/reactions")["reactors"])
    assert post["comment_count"] == 1 == len(comments_of(v, pid))
    assert post["repost_count"] == 1
    assert v.ok("GET", f"/api/companies/{w.company('co')['handle']}")["follower_count"] == 1
    w.m("r2").ok("DELETE", f"/api/posts/{pid}/reaction")
    assert v.ok("GET", f"/api/posts/{pid}")["reactions"]["count"] == 4
    assert o.ok("GET", f"/api/posts/{pid}")["comment_count"] == 2


def test_wf_block_vanish_keyboard(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b m x", connections=[conn("a", "b", t0), conn("a", "m", t0), conn("b", "x", t0), conn("m", "x", t0)],
              posts=[post_spec("pb", "b", f"From b {new_tag()}", t0)])
    a, b = w.m("a"), w.m("b")
    with browse(browser, a, f"/in/{w.handle('b')}") as page:
        loaded(page, btn(page, "More actions"), "More actions")
        press(btn(page, "More actions"))
        press(page.get_by_role("menuitem", name=f"Block {w.name('b')}", exact=True))
        press(btn(page.get_by_role("dialog", name=f"Block {w.name('b')}?"), "Block"))
        shows_text(page, f"You blocked {w.name('b')}.")
        page.goto(app_url + f"/search?type=people&q={w.tag}")
        loaded(page, page.get_by_role("listitem").and_(page.locator(f"[data-member-id='{w.id('m')}']")), "m in search")
        assert page.locator(f"[data-member-id='{b.id}']").count() == 0
        page.goto(app_url + "/feed")
        advance(page, STEP_MS)
        assert article(page, w.id("pb")).count() == 0
        page.goto(app_url + f"/in/{w.handle('x')}")
        eventually(page, lambda: text_of(page.locator("[data-mutual-line]")) == "1 mutual connection", "mutual without b",
                   LOAD_S + GRACE_S)
    with browse(browser, b, f"/in/{w.handle('a')}") as page:
        loaded(page, page.get_by_role("heading", name="This profile isn't available"), "a's profile unavailable to b")
    assert b.get(f"/api/profiles/{w.handle('a')}").status_code == 404


def test_wf_block_vanish_unblock(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b", blocks=[{"blocker": "a", "blocked": "b", "at": at(t0, -60)}])
    a = w.m("a")
    with browse(browser, a, "/settings") as page:
        loaded(page, btn(page, f"Unblock {w.name('b')}"), "Unblock")
        click(btn(page, f"Unblock {w.name('b')}"))
        announced(page, "Network announcements", f"Unblocked {w.name('b')}.")
        page.goto(app_url + f"/in/{w.handle('b')}")
        expect_buttons(page, {"Connect"}, "after unblock")
    assert state_of(a, w.handle("b")) == "none"


def _open_composer(page: Page) -> tuple[Locator, Locator]:
    opener = btn(page, "Start a post")
    loaded(page, opener, "Start a post")
    press(opener)
    dialog = page.get_by_role("dialog", name="Create a post")
    shown(page, dialog, "the composer")
    return dialog, textbox(dialog, "What do you want to talk about?")


def test_composer_counter_limit_and_see_more(app_url, browser):
    limit, cut = num(app_url, "PLAINWORK_POST_MAX_CHARS"), num(app_url, "PLAINWORK_SEE_MORE_CHARS")
    t0 = server_now(app_url)
    long_text = "😀a" * cut
    w = World(app_url, "a", posts=[post_spec("pl", "a", long_text, t0)])
    with browse(browser, w.m("a"), "/feed") as page:
        dialog, box = _open_composer(page)
        eventually(page, lambda: has_focus(box), "focus in the composer text box")
        post, counter = btn(dialog, "Post"), dialog.get_by_role("status", name="Character count")
        assert post.is_disabled()
        fill(box, "   ")
        eventually(page, lambda: post.is_disabled(), "Post disabled for blank text")
        fill(box, "😀" * limit)
        eventually(page, lambda: text_of(counter).replace(",", "") == f"{limit} / {limit}" and post.is_enabled(), "at the limit")
        fill(box, "😀" * (limit + 1))
        eventually(page, lambda: text_of(counter) == "1 over the limit" and post.is_disabled(), "over the limit")
        page.keyboard.press("Escape")
        art = article(page, w.id("pl"))
        loaded(page, art, "the long post")
        assert long_text[:cut] + "…" in art.inner_text() and long_text not in art.inner_text()
        click(btn(art, "see more"))
        eventually(page, lambda: long_text in art.inner_text(), "see more to expand in place")


def test_mention_suggestions_keyboard(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b c d", connections=[conn("a", "b", t0), conn("a", "c", t0)])
    with browse(browser, w.m("a"), "/feed") as page:
        dialog, box = _open_composer(page)
        box.focus()
        page.keyboard.type(f"hi @{w.tag}")
        listbox = page.get_by_role("listbox", name="Mention suggestions")
        shown(page, listbox, "mention suggestions")
        options = listbox.get_by_role("option")
        eventually(page, lambda: options.all_inner_texts() == [f"{w.name('b')} (@{w.handle('b')})",
                                                               f"{w.name('c')} (@{w.handle('c')})"],
                   "only connections, ordered by name")
        ids = options.evaluate_all("els => els.map(e => e.id)")
        active = lambda: box.get_attribute("aria-activedescendant")
        for _ in range(3):
            if active() == ids[1]:
                break
            page.keyboard.press("ArrowDown")
        assert active() == ids[1]
        page.keyboard.press("ArrowDown")
        assert active() == ids[0], "ArrowDown wraps to the first option"
        page.keyboard.press("ArrowUp")
        assert active() == ids[1], "ArrowUp wraps to the last option"
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        expected = f"hi @{w.handle('b')} "
        eventually(page, lambda: box.input_value() == expected, "the fragment replaced by @handle and one space")
        assert box.evaluate("e => e.selectionStart") == len(expected)
        absent(page, listbox, "the list closes after Enter")
        page.keyboard.type(f"@{w.tag}")
        shown(page, listbox, "suggestions again")
        page.keyboard.press("Escape")
        absent(page, listbox, "Escape closes the list")
        assert visible(dialog) and has_focus(box)
        page.keyboard.press("Escape")
        absent(page, dialog, "a second Escape closes the dialog")


def test_plain_text_rendering_mentions_hashtags(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "a b d", tag=tag, connections=[conn("a", "b", t0)])
    a = w.m("a")
    tail, tag_open, script_open = "second line", f"<u data-v{tag}", "<script>"
    mailto = "mailto:crew@example.test"
    text = (f"Hey @{w.handle('b')} and @{w.handle('d')} #Panel{tag} a#no{tag}\n{tail} "
            f"{tag_open}=\"1\">x</u> <img src=x onerror=window.__pw{tag}=1>"
            f"{script_open}window.__pw{tag}=2</script><style>a{{}}</style> "
            f"javascript:alert(1) https://example.test/{tag} {mailto}")
    assert len(text) < num(app_url, "PLAINWORK_POST_MAX_CHARS"), "verifier text must fit the post limit"
    post = a.ok("POST", "/api/posts", {"text": text}, 201, key=idempotency_key())
    assert [m["member_id"] for m in post["mentions"]] == [w.id("b")]
    assert post["hashtags"] == [f"Panel{tag}"]
    with browse(browser, a, "/feed") as page:
        art = article(page, post["id"])
        loaded(page, art, "the rendered post")
        click(btn(art, "see more"))
        mention = link(art, w.name("b"))
        assert (mention.get_attribute("href") or "").endswith(f"/in/{w.handle('b')}")
        assert mention.get_attribute("data-mention-id") == w.id("b")
        hrefs = art.evaluate("e => [...e.querySelectorAll('a')].map(a => [a.getAttribute('href') || '', a.rel || ''])")
        assert not any(h.endswith(f"/in/{w.handle('d')}") for h, _ in hrefs), "non-connection mention must stay text"
        assert (link(art, f"#Panel{tag}").get_attribute("href") or "").endswith(f"/hashtag/panel{tag}")
        assert not any(h.endswith(f"/hashtag/no{tag}") for h, _ in hrefs)
        assert not any(h.lower().startswith("javascript:") for h, _ in hrefs)
        web = [r for h, r in hrefs if h == f"https://example.test/{tag}"]
        assert web and "noreferrer" in web[0]
        assert any(h == mailto for h, _ in hrefs)
        body = art.inner_text()
        assert f"\n{tail}" in body and tag_open in body and script_open in body
        assert page.evaluate(f"() => document.querySelectorAll('[data-v{tag}], [onerror]').length") == 0
        assert page.evaluate(f"() => window.__pw{tag} === undefined")


def test_hashtag_page_counts_and_order(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "v i t r", tag=tag,
              posts=[post_spec("i1", "i", f"day #Tag{tag}", t0, -DAY_S), post_spec("i9", "i", f"old #TAG{tag}", t0, -9 * DAY_S),
                     post_spec("t2", "t", f"mid #tag{tag}", t0, -2 * DAY_S)],
              reposts=[{"key": "rr", "author": "r", "of": "i1", "text": None, "at": at(t0, -3600)}])
    v = w.m("v")
    assert [p["id"] for p in v.ok("GET", f"/api/hashtags/tag{tag}")["posts"]] == [w.id("i1"), w.id("t2"), w.id("i9")]
    with browse(browser, v, f"/hashtag/tag{tag}") as page:
        stats = page.locator("[data-hashtag-stats]")
        eventually(page, lambda: text_of(stats) == "3 posts · 2 members this week", "the stats line", LOAD_S + GRACE_S)
        assert article_ids(page) == [w.id("i1"), w.id("t2"), w.id("i9")]
        v.ok("POST", "/api/blocks", {"member_id": w.id("t")}, 201)
        page.reload()
        eventually(page, lambda: text_of(stats) == "2 posts · 1 member this week", "stats without the blocked author",
                   LOAD_S + GRACE_S)


def test_edit_window_server_decides(app_url, browser):
    window = num(app_url, "PLAINWORK_EDIT_WINDOW_SECONDS")
    t0 = server_now(app_url)
    w = World(app_url, "a", posts=[post_spec("pe", "a", f"Edit me {new_tag()}", t0, -window + 60)])
    a, pid = w.m("a"), w.id("pe")
    revised = f"Revised {w.tag}"
    edited = a.ok("PATCH", f"/api/posts/{pid}", {"text": revised})
    assert edited["edited_at"] and edited["editable"] is True and edited["text"] == revised
    with browse(browser, a, "/feed", device_time=DEVICE_PAST) as page:
        art = article(page, pid)
        loaded(page, art, "the post")
        eventually(page, lambda: " • Edited" in art.inner_text(), "the Edited label")
        press(btn(art, "Post actions"))
        shown(page, page.get_by_role("menuitem", name="Edit post"), "Edit post while editable")
        page.keyboard.press("Escape")
        forward(app_url, 120)

        def edit_gone() -> bool:
            delete_item = page.get_by_role("menuitem", name="Delete post")
            if not visible(delete_item):
                press(btn(art, "Post actions"))
            if not visible(delete_item):
                return False
            if page.get_by_role("menuitem", name="Edit post").count() == 0:
                return True
            page.keyboard.press("Escape")
            return False

        eventually(page, edit_gone, "Edit post to disappear from the menu once the window closed")
    r = a.patch(f"/api/posts/{pid}", {"text": "Too late"})
    assert r.status_code == 409 and r.json() == {"error": "edit_window_closed"}
    assert a.ok("GET", f"/api/posts/{pid}")["editable"] is False


def test_wf_compose_mentions_happy(app_url, browser):
    limit, window = num(app_url, "PLAINWORK_POST_MAX_CHARS"), num(app_url, "PLAINWORK_EDIT_WINDOW_SECONDS")
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0)])
    a = w.m("a")
    with browse(browser, a, "/feed") as page:
        dialog, box = _open_composer(page)
        page.keyboard.type(f"Shout @{w.tag}")
        shown(page, page.get_by_role("listbox", name="Mention suggestions"), "suggestions")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.keyboard.type(f"for #Crew{w.tag} ")
        page.keyboard.insert_text("x" * (limit - len(box.input_value())))
        page.keyboard.type("yz")
        counter, post = dialog.get_by_role("status", name="Character count"), btn(dialog, "Post")
        eventually(page, lambda: text_of(counter) == "2 over the limit" and post.is_disabled(), "the over-limit detour")
        page.keyboard.press("Backspace")
        page.keyboard.press("Backspace")
        eventually(page, lambda: text_of(counter).replace(",", "") == f"{limit} / {limit}" and post.is_enabled(), "back at the limit")
        press(post)
        announced(page, "Feed announcements", "Post published.")
        eventually(page, lambda: has_focus(btn(page, "Start a post")), "focus back on Start a post")
        mine = [e["post"] for e in feed_all(a) if e["post"]["author"]["id"] == a.id]
        assert len(mine) == 1 and [m["member_id"] for m in mine[0]["mentions"]] == [w.id("b")]
        assert mine[0]["hashtags"] == [f"Crew{w.tag}"] and len(mine[0]["text"]) == limit
        art = article(page, mine[0]["id"])
        shown(page, link(art, w.name("b")), "the mention link")
        click(btn(art, "see more"))
        click(link(art, f"#Crew{w.tag}"))
        eventually(page, lambda: urlparse(page.url).path == f"/hashtag/crew{w.tag}", "the hashtag page")
        eventually(page, lambda: text_of(page.locator("[data-hashtag-stats]")) == "1 post · 1 member this week", "stats")
        forward(app_url, window + 60)
        page.goto(app_url + "/feed")
        art = article(page, mine[0]["id"])
        loaded(page, btn(art, "Post actions"), "Post actions")
        press(btn(art, "Post actions"))
        shown(page, page.get_by_role("menuitem", name="Delete post"), "the post menu")
        assert page.get_by_role("menuitem", name="Edit post").count() == 0
    assert a.ok("GET", f"/api/posts/{mine[0]['id']}")["editable"] is False


def test_wf_compose_mentions_window_closes_while_editing(app_url, browser):
    window = num(app_url, "PLAINWORK_EDIT_WINDOW_SECONDS")
    t0 = server_now(app_url)
    original = f"Draft {new_tag()}"
    w = World(app_url, "a", posts=[post_spec("pe", "a", original, t0, -window + 60)])
    a = w.m("a")
    with browse(browser, a, "/feed") as page:
        art = article(page, w.id("pe"))
        loaded(page, btn(art, "Post actions"), "Post actions")
        press(btn(art, "Post actions"))
        press(page.get_by_role("menuitem", name="Edit post"))
        dialog = page.get_by_role("dialog", name="Edit post")
        shown(page, dialog, "the Edit post dialog")
        forward(app_url, 120)
        fill(dialog.get_by_role("textbox").first, "Changed too late")
        click(btn(dialog, "Save changes"))
        alerted(page, "The edit window for this post has closed.")
    assert a.ok("GET", f"/api/posts/{w.id('pe')}")["text"] == original


SUMMARY_CASES = {
    "none": ([], "", ""),
    "you": ([("v", "like", -300)], "You", "like"),
    "you_and_one": ([("v", "like", -300), ("s1", "like", -200)], "You and 1 other", "like"),
    "you_and_others": ([("v", "like", -300), ("s1", "celebrate", -200), ("s2", "celebrate", -100)], "You and 2 others",
                       "celebrate,like"),
    "connection": ([("c1", "support", -300)], "{c1}", "support"),
    "connection_and_one": ([("c1", "like", -300), ("s1", "like", -100)], "{c1} and 1 other", "like"),
    "latest_connection": ([("c1", "like", -300), ("c2", "funny", -200), ("s1", "insightful", -100)], "{c2} and 2 others",
                          "like,insightful,funny"),
    "one_reaction": ([("s1", "like", -300)], "1 reaction", "like"),
    "many_reactions": ([("s1", "like", -300), ("s2", "funny", -200), ("s3", "celebrate", -100), ("s4", "support", -90),
                        ("s5", "like", -80)], "5 reactions", "like,celebrate,support"),
}


@pytest.mark.parametrize("case", list(SUMMARY_CASES), ids=list(SUMMARY_CASES))
def test_reaction_summary_rules(app_url, browser, case):
    reactions, template, top = SUMMARY_CASES[case]
    t0 = server_now(app_url)
    w = World(app_url, "o v c1 c2 s1 s2 s3 s4 s5", connections=[conn("v", "c1", t0), conn("v", "c2", t0)],
              follows=[{"follower": "v", "target": "o", "at": at(t0, -600)}],
              posts=[post_spec("pp", "o", f"React {new_tag()}", t0, -900)],
              reactions=[{"post": "pp", "user": u, "type": t, "at": at(t0, s)} for u, t, s in reactions])
    v, pid = w.m("v"), w.id("pp")
    if case == "you":
        v.ok("PUT", f"/api/posts/{pid}/reaction", {"type": "celebrate"})
        again = v.ok("PUT", f"/api/posts/{pid}/reaction", {"type": "celebrate"})["reactions"]
        assert again["count"] == 1 and again["mine"] == "celebrate"
        v.ok("PUT", f"/api/posts/{pid}/reaction", {"type": "like"})
    expected = template.format(c1=w.name("c1"), c2=w.name("c2"))
    summary = v.ok("GET", f"/api/posts/{pid}")["reactions"]
    assert summary["text"] == expected and summary["count"] == len(reactions)
    assert summary["top_types"] == (top.split(",") if top else [])
    with browse(browser, v, "/feed") as page:
        el = article(page, pid).locator("[data-reaction-summary]")
        eventually(page, lambda: el.count() == 1 and el.get_attribute("data-count") == str(len(reactions))
                   and (el.inner_text() or "").strip() == expected and el.get_attribute("data-top-types") == top,
                   f"summary {expected!r}", LOAD_S + GRACE_S)


def _focused_reaction(page: Page) -> str | None:
    for n in REACTION_NAMES:
        if has_focus(btn(page.get_by_role("toolbar", name="Reactions"), n)):
            return n
    return None


def test_reaction_picker_keyboard(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o v", follows=[{"follower": "v", "target": "o", "at": at(t0, -60)}],
              posts=[post_spec("pp", "o", f"Pick {new_tag()}", t0)])
    v, pid = w.m("v"), w.id("pp")
    mine = lambda: v.ok("GET", f"/api/posts/{pid}")["reactions"]["mine"]
    with browse(browser, v, "/feed") as page:
        art = article(page, pid)
        chooser = btn(art, "Choose reaction")
        loaded(page, chooser, "Choose reaction")
        bar = page.get_by_role("toolbar", name="Reactions")
        press(chooser)
        shown(page, bar, "the reaction toolbar")
        eventually(page, lambda: _focused_reaction(page) == "Like", "focus on Like with no reaction")
        for key, want in (("ArrowLeft", "Funny"), ("ArrowRight", "Like"), ("End", "Funny"), ("Home", "Like"),
                          ("ArrowRight", "Celebrate")):
            page.keyboard.press(key)
            assert _focused_reaction(page) == want, f"{key} should focus {want}"
        page.keyboard.press("Enter")
        absent(page, bar, "Enter closes the toolbar")
        eventually(page, lambda: has_focus(chooser) and mine() == "celebrate", "Celebrate applied, focus returned")
        press(chooser)
        eventually(page, lambda: _focused_reaction(page) == "Celebrate", "focus on the current type")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Escape")
        eventually(page, lambda: has_focus(chooser) and not visible(bar), "Escape returns focus")
        assert mine() == "celebrate"
        press(chooser)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        eventually(page, lambda: mine() == "support", "Space applies Support")
        assert btn(art, "React").get_attribute("aria-pressed") == "true"
        press(chooser)
        eventually(page, lambda: _focused_reaction(page) == "Support", "focus on Support")
        page.keyboard.press("Enter")
        eventually(page, lambda: mine() is None, "choosing the current type removes it")


def test_live_reactions_and_announcement(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o r", connections=[conn("o", "r", t0)], posts=[post_spec("pp", "o", f"Live {new_tag()}", t0)])
    pid = w.id("pp")
    with browse(browser, w.m("o"), "/feed") as po, browse(browser, w.m("r"), "/feed") as pr:
        summary = article(po, pid).locator("[data-reaction-summary]")
        eventually(po, lambda: summary.count() == 1, "the author's summary", LOAD_S + GRACE_S)
        react = btn(article(pr, pid), "React")
        loaded(pr, react, "React")
        click(react)
        announced(pr, "Feed announcements", "Reaction: Like")
        eventually(po, lambda: summary.get_attribute("data-count") == "1" and text_of(summary) == w.name("r"),
                   "the author's summary to show the new reaction live")
        click(react)
        announced(pr, "Feed announcements", "Reaction removed")
        eventually(po, lambda: summary.get_attribute("data-count") == "0", "the removal to reach the author live")


def test_notifications_group_and_arrive_live(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o x y z q", tag=tag, profiles={"o": {"skills": ["Rigging"]}},
              connections=[conn("o", "x", t0), conn("o", "y", t0), conn("o", "q", t0, "pending", -60)],
              posts=[post_spec("p1", "o", f"First {tag}", t0, -600), post_spec("p2", "o", f"Second {tag}", t0, -500)])
    o, x, y = w.m("o"), w.m("x"), w.m("y")
    p1, p2 = w.id("p1"), w.id("p2")
    item = lambda kind: [i for i in notifications(o)["items"] if i["kind"] == kind]
    x.ok("PUT", f"/api/posts/{p1}/reaction", {"type": "like"})
    y.ok("PUT", f"/api/posts/{p1}/reaction", {"type": "funny"})
    eventually(None, lambda: len(item("reaction")) == 1 and item("reaction")[0]["count"] == 2, "one grouped reaction item")
    assert item("reaction")[0]["text"] == f"{w.name('y')} and 1 other reacted to your post"
    y.ok("DELETE", f"/api/posts/{p1}/reaction")
    eventually(None, lambda: item("reaction")[0]["text"] == f"{w.name('x')} reacted to your post", "count lowered")
    mine = o.ok("POST", f"/api/posts/{p1}/comments", {"text": "own"}, 201, key=idempotency_key())
    x.ok("POST", f"/api/posts/{p1}/comments", {"text": "x says"}, 201, key=idempotency_key())
    y.ok("POST", f"/api/posts/{p1}/comments", {"text": "y says"}, 201, key=idempotency_key())
    eventually(None, lambda: item("comment") and item("comment")[0]["count"] == 2, "own comment not counted")
    assert item("comment")[0]["text"] == f"{w.name('y')} and 1 other commented on your post"
    y.ok("POST", f"/api/posts/{p1}/comments", {"text": "reply", "parent_id": mine["id"]}, 201, key=idempotency_key())
    x.ok("POST", "/api/posts", {"text": f"hey @{w.handle('o')}"}, 201, key=idempotency_key())
    x.ok("POST", f"/api/posts/{p1}/reposts", status=201)
    x.ok("PUT", f"/api/members/{o.id}/skills/Rigging/endorsement")
    w.m("z").ok("POST", "/api/connections", {"member_id": o.id}, 201)
    w.m("q").ok("POST", f"/api/connections/{o.id}/accept")
    texts = {
        "reply": f"{w.name('y')} replied to your comment", "mention": f"{w.name('x')} mentioned you in a post",
        "repost": f"{w.name('x')} reposted your post", "endorsement": f"{w.name('x')} endorsed you for Rigging",
        "invitation_received": f"{w.name('z')} wants to connect",
        "invitation_accepted": f"{w.name('q')} accepted your invitation",
    }
    for kind, text in texts.items():
        eventually(None, lambda kind=kind, text=text: [i["text"] for i in item(kind)] == [text], f"{kind} notification")
    with browse(browser, o, "/feed") as page:
        nav = page.get_by_role("navigation", name="Primary")
        n = notifications(o)["unread_count"]
        loaded(page, link(nav, f"Notifications, {n} unread"), "the unread count in the link")
        y.ok("PUT", f"/api/posts/{p2}/reaction", {"type": "like"})
        shown(page, link(nav, f"Notifications, {n + 1} unread"), "the link count to rise live")
        page.goto(app_url + "/notifications")
        listing = page.get_by_role("list", name="Notifications")
        loaded(page, listing, "the notifications list")
        x.ok("POST", f"/api/posts/{p2}/comments", {"text": "live"}, 201, key=idempotency_key())
        eventually(page, lambda: listing.get_by_role("listitem").evaluate_all(
            "els => els.filter(e => e.getAttribute('data-kind') === 'comment').length") == 2,
            "a new item arriving live")
    assert notifications(o)["unread_count"] == 0 or o.ok("POST", "/api/notifications/seen") == {"unread_count": 0}


def test_wf_reaction_picker_live_keyboard(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o r", connections=[conn("o", "r", t0)], posts=[post_spec("pp", "o", f"Kb {new_tag()}", t0)])
    pid = w.id("pp")
    with browse(browser, w.m("o"), "/feed") as po, browse(browser, w.m("r"), "/feed") as pr:
        summary = article(po, pid).locator("[data-reaction-summary]")
        eventually(po, lambda: summary.count() == 1, "author summary", LOAD_S + GRACE_S)
        press(btn(article(pr, pid), "Choose reaction"))
        page_bar = pr.get_by_role("toolbar", name="Reactions")
        shown(pr, page_bar, "toolbar")
        eventually(pr, lambda: page_bar.evaluate("e => e.contains(document.activeElement)"), "focus in the toolbar")
        pr.keyboard.press("End")
        pr.keyboard.press("Enter")
        announced(pr, "Feed announcements", "Reaction: Funny")
        eventually(po, lambda: summary.get_attribute("data-top-types") == "funny", "author sees Funny live")
    assert w.m("o").ok("GET", f"/api/posts/{pid}")["reactions"]["top_types"] == ["funny"]


def test_wf_reaction_picker_live_shortcut(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o r", connections=[conn("o", "r", t0)], posts=[post_spec("pp", "o", f"Sc {new_tag()}", t0)])
    pid = w.id("pp")
    with browse(browser, w.m("o"), "/feed") as po, browse(browser, w.m("r"), "/feed") as pr:
        summary = article(po, pid).locator("[data-reaction-summary]")
        eventually(po, lambda: summary.count() == 1, "author summary", LOAD_S + GRACE_S)
        loaded(pr, article(pr, pid), "entry")
        btn(pr, "Start a post").focus()
        pr.keyboard.press("j")
        pr.keyboard.press("l")
        announced(pr, "Feed announcements", "Reaction: Like")
        eventually(po, lambda: summary.get_attribute("data-count") == "1", "L to like live")
        pr.keyboard.press("l")
        announced(pr, "Feed announcements", "Reaction removed")
        eventually(po, lambda: summary.get_attribute("data-count") == "0", "L again to remove live")
    assert w.m("o").ok("GET", f"/api/posts/{pid}")["reactions"]["count"] == 0


def test_comment_tree_one_level_and_keyboard(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o a b c v", tag=tag, posts=[post_spec("pp", "o", f"Thread {tag}", t0, -4 * 3600),
                                                     post_spec("px", "o", f"Other {tag}", t0, -3600)],
              comments=[{"key": "c1", "post": "pp", "author": "a", "parent": None, "text": "top", "at": at(t0, -3 * 3600)},
                        {"key": "c2", "post": "pp", "author": "b", "parent": None, "text": f"<i data-verify-{tag}>x</i>",
                         "at": at(t0, -9000)},
                        {"key": "r1", "post": "pp", "author": "b", "parent": "c1", "text": "r1", "at": at(t0, -7200)},
                        {"key": "r2", "post": "pp", "author": "c", "parent": "c1", "text": "r2", "at": at(t0, -3600)},
                        {"key": "r3", "post": "pp", "author": "a", "parent": "c1", "text": "r3", "at": at(t0, -1800)}])
    v, pid = w.m("v"), w.id("pp")
    reply = v.ok("POST", f"/api/posts/{pid}/comments", {"text": "deep", "parent_id": w.id("r1")}, 201, key=idempotency_key())
    assert reply["parent_id"] == w.id("c1")
    r = v.post(f"/api/posts/{w.id('px')}/comments", {"text": "x", "parent_id": w.id("c1")}, key=idempotency_key())
    assert r.status_code == 404
    listing = comments_of(v, pid)
    assert [c["id"] for c in listing] == [w.id("c1"), w.id("c2")]
    assert [c["id"] for c in listing[0]["replies"]] == [w.id("r1"), w.id("r2"), w.id("r3"), reply["id"]]
    with browse(browser, v, f"/posts/{pid}") as page:
        tree = page.get_by_role("tree", name="Comments")
        top = tree.get_by_role("treeitem", name=f"Comment by {w.name('a')}")
        rb = tree.get_by_role("treeitem", name=f"Reply by {w.name('b')}")
        loaded(page, top, "the top-level comment")
        assert top.get_attribute("aria-expanded") == "true"
        more = btn(tree, "Show 2 more replies")
        shown(page, more, "the hidden-replies button")
        top.focus()
        page.keyboard.press("ArrowDown")
        assert has_focus(rb)
        page.keyboard.press("ArrowLeft")
        assert has_focus(top)
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: top.get_attribute("aria-expanded") == "false", "ArrowLeft collapses")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: top.get_attribute("aria-expanded") == "true", "ArrowRight expands")
        page.keyboard.press("ArrowRight")
        assert has_focus(rb)
        page.keyboard.press("Enter")
        eventually(page, lambda: page.evaluate("() => document.activeElement && document.activeElement.value")
                   == f"@{w.handle('b')} ", "the reply box prefilled with the mention")
        page.keyboard.press("Escape")
        eventually(page, lambda: has_focus(rb), "Escape returns to the treeitem")
        press(more)
        eventually(page, lambda: has_focus(tree.get_by_role("treeitem", name=f"Reply by {w.name('a')}")),
                   "focus on the first newly shown reply")
        assert page.evaluate(f"() => document.querySelectorAll('[data-verify-{tag}]').length") == 0


def test_comment_deletion_placeholder(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o a b s", posts=[post_spec("pp", "o", f"Del {new_tag()}", t0, -3600)],
              comments=[{"key": "c1", "post": "pp", "author": "a", "parent": None, "text": "one", "at": at(t0, -3000)},
                        {"key": "r1", "post": "pp", "author": "b", "parent": "c1", "text": "kept", "at": at(t0, -2000)},
                        {"key": "c2", "post": "pp", "author": "b", "parent": None, "text": "two", "at": at(t0, -1000)}])
    pid = w.id("pp")
    r = w.m("s").delete(f"/api/comments/{w.id('c1')}")
    assert r.status_code == 403 and r.json() == {"error": "not_author"}
    w.m("a").ok("DELETE", f"/api/comments/{w.id('c1')}", status=204)
    w.m("o").ok("DELETE", f"/api/comments/{w.id('c2')}", status=204)
    listing = comments_of(w.m("s"), pid)
    assert len(listing) == 1 and listing[0]["deleted"] is True
    assert set(listing[0]) == {"id", "post_id", "parent_id", "deleted", "replies"}
    assert [x["id"] for x in listing[0]["replies"]] == [w.id("r1")]
    with browse(browser, w.m("s"), f"/posts/{pid}") as page:
        tree = page.get_by_role("tree", name="Comments")
        loaded(page, tree.get_by_role("treeitem", name="Deleted comment"), "the placeholder treeitem")
        shows_text(page, "This comment was deleted.")
        assert visible(tree.get_by_role("treeitem", name=f"Reply by {w.name('b')}"))
        assert page.locator(f"[data-comment-id='{w.id('c2')}']").count() == 0
        assert page.locator(f"[data-comment-id='{w.id('c1')}']").get_attribute("data-deleted") == "true"


def test_live_comments_and_counts(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o v c", connections=[conn("o", "c", t0), conn("o", "v", t0)],
              posts=[post_spec("pp", "o", f"Counts {new_tag()}", t0)])
    pid, c = w.id("pp"), w.m("c")
    with browse(browser, w.m("v"), f"/posts/{pid}") as page:
        loaded(page, article(page, pid).or_(page.get_by_role("tree", name="Comments")), "the post page")
        assert page.get_by_text("1 comment", exact=True).count() == 0
        first = c.ok("POST", f"/api/posts/{pid}/comments", {"text": "live one"}, 201, key=idempotency_key())
        shown(page, page.locator(f"[data-comment-id='{first['id']}']"), "the new comment live")
        shown(page, page.get_by_text("1 comment", exact=True), "1 comment")
        c.ok("POST", f"/api/posts/{pid}/comments", {"text": "live reply", "parent_id": first["id"]}, 201, key=idempotency_key())
        shown(page, page.get_by_text("2 comments", exact=True), "2 comments counting replies")
        c.ok("POST", f"/api/posts/{pid}/reposts", status=201)
        shown(page, page.get_by_text("1 repost", exact=True), "1 repost")
        listing = comments_of(c, pid)
        c.ok("DELETE", f"/api/comments/{listing[0]['replies'][0]['id']}", status=204)
        c.ok("DELETE", f"/api/comments/{first['id']}", status=204)
        absent(page, page.locator(f"[data-comment-id='{first['id']}']"), "the deleted comment to leave live")
        absent(page, page.get_by_text("1 comment", exact=True), "the comment count line at zero")
    assert w.m("v").ok("GET", f"/api/posts/{pid}")["comment_count"] == 0


def test_reposts_plain_and_with_thoughts(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o r v k", tag=tag, connections=[conn("v", "r", t0)],
              blocks=[{"blocker": "k", "blocked": "r", "at": at(t0, -60)}],
              posts=[post_spec("pp", "o", f"Original {tag}", t0, -3600), post_spec("pk", "k", f"Hidden {tag}", t0)])
    r, pid = w.m("r"), w.id("pp")
    first = r.ok("POST", f"/api/posts/{pid}/reposts", status=201)
    assert first["repost_count"] == 1 and first["repost_id"]
    again = r.post(f"/api/posts/{pid}/reposts")
    assert again.status_code == 409 and again.json() == {"error": "already_reposted"}
    thoughts = r.ok("POST", "/api/posts", {"text": f"My take {tag}", "shared_post_id": pid}, 201, key=idempotency_key())
    assert thoughts["shared"]["id"] == pid
    assert r.ok("GET", f"/api/posts/{pid}")["repost_count"] == 2
    assert r.post("/api/posts", {"text": "x", "shared_post_id": w.id("pk")}, key=idempotency_key()).status_code == 404
    with browse(browser, w.m("v"), "/feed") as page:
        plain = page.get_by_role("article").filter(has_text=f"{w.name('r')} reposted this").first
        loaded(page, plain, "the plain repost entry")
        assert plain.get_attribute("data-post-id") == pid == plain.get_attribute("data-repost-of")
        assert plain.get_attribute("data-author-id") == w.id("o")
        assert plain.get_attribute("data-reposter-id") == r.id
        assert f"{w.name('r')} reposted this" in plain.inner_text()
        own = article(page, thoughts["id"])
        assert own.get_attribute("data-repost-of") == pid


def test_deleted_post_gone_everywhere(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o r t x v", tag=tag,
              connections=[conn("v", "r", t0), conn("v", "t", t0), conn("v", "o", t0), conn("o", "x", t0)],
              posts=[post_spec("pp", "o", f"gone{tag} #Gone{tag}", t0, -3600)],
              reposts=[{"key": "rp", "author": "r", "of": "pp", "text": None, "at": at(t0, -1800)},
                       {"key": "rt", "author": "t", "of": "pp", "text": f"Thoughts {tag}", "at": at(t0, -900)}])
    o, v, pid = w.m("o"), w.m("v"), w.id("pp")
    w.m("x").ok("PUT", f"/api/posts/{pid}/reaction", {"type": "like"})
    eventually(None, lambda: [i for i in notifications(o)["items"] if i["kind"] == "reaction"], "the reaction notification")
    assert v.delete(f"/api/posts/{pid}").json() == {"error": "not_author"}
    o.ok("DELETE", f"/api/posts/{pid}", status=204)
    assert v.get(f"/api/posts/{pid}").status_code == 404
    entries = feed_all(v)
    assert all(e["post"]["id"] != pid for e in entries), "the post or its plain repost stayed in the feed"
    thoughts = next(e for e in entries if e["post"]["id"] == w.id("rt"))
    assert thoughts["post"]["shared"] == {"unavailable": True} and thoughts["post"]["text"] == f"Thoughts {tag}"
    assert search_all(v, type="posts", q=f"gone{tag}") == []
    assert v.ok("GET", f"/api/hashtags/gone{tag}")["posts"] == []
    assert not [i for i in notifications(o)["items"] if i["kind"] == "reaction"]
    with browse(browser, v, f"/posts/{w.id('rt')}") as page:
        shows_text(page, "This post is no longer available.", seconds=LOAD_S + GRACE_S)
        shows_text(page, f"Thoughts {tag}")
        page.goto(app_url + f"/posts/{pid}")
        shows_text(page, "This post is no longer available.", seconds=LOAD_S + GRACE_S)
        assert visible(link(page, "Go to Home"))


def test_wf_comments_reposts_thread_delete(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o a", connections=[conn("o", "a", t0)], posts=[post_spec("pp", "o", f"Talk {new_tag()}", t0)])
    o, a, pid = w.m("o"), w.m("a"), w.id("pp")
    with browse(browser, o, f"/posts/{pid}") as po, browse(browser, a, f"/posts/{pid}") as pa:
        box = textbox(pa, "Add a comment")
        loaded(pa, box.or_(btn(pa, "Comment")), "the comment box or its opener")
        advance(pa, STEP_MS)
        if not visible(box):
            click(btn(pa, "Comment"))
        loaded(pa, box, "the comment box")
        fill(box, "Top comment")
        click(btn(pa, "Post comment"))
        announced(pa, "Feed announcements", "Comment posted.")
        tree_o = po.get_by_role("tree", name="Comments")
        top_o = tree_o.get_by_role("treeitem", name=f"Comment by {w.name('a')}")
        shown(po, top_o, "the comment live on the author's page")
        top_id = comments_of(o, pid)[0]["id"]
        o.ok("POST", f"/api/posts/{pid}/comments", {"text": "reply one", "parent_id": top_id}, 201, key=idempotency_key())
        o.ok("POST", f"/api/posts/{pid}/comments", {"text": "reply two", "parent_id": top_id}, 201, key=idempotency_key())
        replies_a = pa.get_by_role("tree", name="Comments").get_by_role("treeitem", name=f"Reply by {w.name('o')}")
        eventually(pa, lambda: replies_a.count() == 2, "both replies live on the commenter's page")
        a.ok("DELETE", f"/api/comments/{top_id}", status=204)
        for page in (po, pa):
            shown(page, page.get_by_role("tree", name="Comments").get_by_role("treeitem", name="Deleted comment"),
                  "the placeholder live")
        eventually(po, lambda: tree_o.get_by_role("treeitem", name=f"Reply by {w.name('o')}").count() == 2, "replies kept")
    assert comments_of(o, pid)[0]["deleted"] is True and len(comments_of(o, pid)[0]["replies"]) == 2


def test_wf_comments_reposts_repost_delete(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "o r t v", tag=tag, connections=[conn("v", "o", t0), conn("v", "r", t0), conn("v", "t", t0),
                                                        conn("o", "r", t0), conn("o", "t", t0)],
              posts=[post_spec("pp", "o", f"Share {tag}", t0, -3600)])
    pid = w.id("pp")
    with browse(browser, w.m("r"), "/feed") as page:
        art = article(page, pid)
        loaded(page, btn(art, "Repost"), "Repost")
        press(btn(art, "Repost"))
        press(page.get_by_role("menuitem", name="Repost", exact=True))
        announced(page, "Feed announcements", "Reposted.")
    with browse(browser, w.m("t"), "/feed") as page:
        art = article(page, pid)
        loaded(page, btn(art, "Repost"), "Repost")
        press(btn(art, "Repost"))
        press(page.get_by_role("menuitem", name="Repost with your thoughts"))
        shown(page, page.get_by_role("region", name="Shared post"), "the embedded original")
        page.keyboard.type(f"Thoughts {tag}")
        press(btn(page.get_by_role("dialog").first, "Post"))
        announced(page, "Feed announcements", "Post published.")
    v = w.m("v")
    assert v.ok("GET", f"/api/posts/{pid}")["repost_count"] == 2
    with browse(browser, v, "/feed") as page:
        loaded(page, page.get_by_role("article").first, "the feed")
        assert [e["post"]["id"] for e in feed_all(v)].count(pid) == 1
        shown(page, page.get_by_text("2 reposts", exact=True), "the count line 2 reposts")
    w.m("o").ok("DELETE", f"/api/posts/{pid}", status=204)
    with browse(browser, v, "/feed") as page:
        shows_text(page, "This post is no longer available.", seconds=LOAD_S + GRACE_S)
        assert page.get_by_role("article").filter(has_text="reposted this").count() == 0
    assert all(e["post"]["id"] != pid for e in feed_all(v))


def test_follows_feed_the_home_feed(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "v f p g", tag=tag, companies=[company_spec(tag, "co", ["p"])], jobs=[job_spec(tag, "j1", t0)],
              posts=[post_spec("pf", "f", f"Followed {tag}", t0), post_spec("pc", "p", f"Company {tag}", t0)])
    v = w.m("v")
    ids = lambda: {e["post"]["id"] for e in feed_all(v)}
    assert not {w.id("pf"), w.id("pc")} & ids()
    assert v.ok("POST", "/api/follows", {"target_id": w.id("f")}, 201) == {"following": True}
    assert v.ok("POST", "/api/follows", {"target_id": w.id("f")}, 200) == {"following": True}
    v.ok("POST", "/api/follows", {"target_id": w.id("co")}, 201)
    assert {w.id("pf"), w.id("pc")} <= ids()
    assert v.ok("DELETE", f"/api/follows/{w.id('f')}") == {"following": False}
    assert w.id("pf") not in ids()
    r = v.post("/api/follows", {"target_id": v.id})
    assert r.status_code == 422 and r.json()["fields"]["target_id"] == "You can't follow yourself."
    with browse(browser, v, f"/in/{w.handle('g')}") as page:
        follow = btn(page, "Follow")
        loaded(page, follow, "Follow")
        assert follow.get_attribute("aria-pressed") == "false"
        click(follow)
        following = btn(page, "Following")
        shown(page, following, "Following")
        assert following.get_attribute("aria-pressed") == "true"
    eventually(None, lambda: profile(v, w.handle("g"))["following"] is True, "the follow to be stored")


def test_feed_contents_and_order(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "v c f p s b", tag=tag, companies=[company_spec(tag, "co", ["p"])], jobs=[job_spec(tag, "j1", t0)],
              connections=[conn("v", "c", t0), conn("v", "b", t0)],
              follows=[{"follower": "v", "target": "f", "at": at(t0, -DAY_S)}, {"follower": "v", "target": "co", "at": at(t0, -DAY_S)}],
              blocks=[{"blocker": "v", "blocked": "b", "at": at(t0, -60)}],
              posts=[post_spec("pv", "v", "mine", t0, -300), post_spec("pc", "c", "conn", t0, -600),
                     post_spec("pf", "f", "followed", t0, -1200), post_spec("pp", "p", "company", t0, -1800),
                     post_spec("ps", "s", "stranger", t0, -60), post_spec("pb", "b", "blocked", t0, -120)],
              reposts=[{"key": "rs", "author": "c", "of": "ps", "text": None, "at": at(t0, -180)},
                       {"key": "rf", "author": "c", "of": "pf", "text": None, "at": at(t0, -240)}])
    v = w.m("v")
    entries = feed_all(v)
    got = [(e["kind"], e["post"]["id"]) for e in entries]
    assert got == [("repost", w.id("ps")), ("repost", w.id("pf")), ("post", w.id("pv")), ("post", w.id("pc")),
                   ("post", w.id("pp"))]
    assert entries[0]["reposter"]["id"] == w.id("c") and entries[2]["reposter"] is None
    with browse(browser, v, "/feed") as page:
        eventually(page, lambda: article_ids(page)[:5] == [w.id(k) for k in ("ps", "pf", "pv", "pc", "pp")],
                   "the feed order on the page", LOAD_S + GRACE_S)


def test_feed_stable_pages(app_url):
    size = num(app_url, "PLAINWORK_FEED_PAGE_SIZE")
    t0 = server_now(app_url)
    n = 2 * size + 2
    w = World(app_url, "v f", follows=[{"follower": "v", "target": "f", "at": at(t0, -DAY_S)}],
              posts=[post_spec(f"p{i}", "f", f"post {i}", t0, -60 * (i + 1)) for i in range(n)])
    v, f = w.m("v"), w.m("f")
    order = [w.id(f"p{i}") for i in range(n)]
    page1 = v.ok("GET", "/api/feed")
    assert [e["post"]["id"] for e in page1["entries"]] == order[:size]
    assert len(v.ok("GET", "/api/feed?limit=50")["entries"]) == size, "no parameter changes the page size"
    fresh = f.ok("POST", "/api/posts", {"text": "arrived"}, 201, key=idempotency_key())
    f.ok("DELETE", f"/api/posts/{order[size + 1]}", status=204)
    seen = [e["post"]["id"] for e in page1["entries"]]
    cursor = page1["next_cursor"]
    for _ in range(FEED_PAGES):
        if not cursor:
            break
        data = v.ok("GET", f"/api/feed?cursor={quote(cursor)}")
        seen += [e["post"]["id"] for e in data["entries"]]
        cursor = data["next_cursor"]
    assert seen == [i for i in order if i != order[size + 1]], "paging repeated or skipped an entry"
    newer = v.ok("GET", f"/api/feed?newer_than={quote(page1['top_cursor'])}")
    assert [e["post"]["id"] for e in newer["entries"]] == [fresh["id"]]
    r = v.get("/api/feed?cursor=not-a-cursor")
    assert r.status_code == 422 and r.json()["fields"]["cursor"] == "This cursor is not valid."


def test_new_posts_pill(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v c", connections=[conn("v", "c", t0)], posts=[post_spec("px", "c", "older", t0, -600)])
    v, c = w.m("v"), w.m("c")
    with browse(browser, v, "/feed") as page:
        eventually(page, lambda: article_ids(page)[:1] == [w.id("px")], "the initial feed", LOAD_S + GRACE_S)
        one = c.ok("POST", "/api/posts", {"text": "new one"}, 201, key=idempotency_key())
        shown(page, btn(page, "Show 1 new post"), "the pill for one post")
        announced(page, "Feed announcements", "1 new post available")
        two = c.ok("POST", "/api/posts", {"text": "new two"}, 201, key=idempotency_key())
        shown(page, btn(page, "Show 2 new posts"), "the pill for two posts")
        announced(page, "Feed announcements", "2 new posts available")
        assert article_ids(page)[0] == w.id("px"), "arrivals must not shift the list"
        press(btn(page, "Show 2 new posts"))
        eventually(page, lambda: article_ids(page)[:3] == [two["id"], one["id"], w.id("px")], "inserted at the top")
        eventually(page, lambda: has_focus(article(page, two["id"])), "focus on the first inserted entry")
        mine = v.ok("POST", "/api/posts", {"text": "my own"}, 201, key=idempotency_key())
        eventually(page, lambda: article_ids(page)[0] == mine["id"], "own post inserted at once")
        assert not visible(btn(page, "Show 1 new post"))


RELATIVE_CASES = {
    "now": (20, "now"),
    "minutes": (150, "2m"),
    "hours": (8400, "2h"),
    "days": (277200, "3d"),
    "weeks": (1296000, "2w"),
    "date": (2592000, None),
}


@pytest.mark.parametrize("case", list(RELATIVE_CASES), ids=list(RELATIVE_CASES))
def test_relative_time_ladder(app_url, browser, case):
    seconds, label = RELATIVE_CASES[case]
    t0 = server_now(app_url)
    w = World(app_url, "a", posts=[post_spec("pp", "a", f"Time {case}", t0, -seconds)])
    expected = label or fmt_date(t0 - timedelta(seconds=seconds), zone(app_url))
    with browse(browser, w.m("a"), "/feed", device_time=DEVICE_FUTURE) as page:
        stamp = article(page, w.id("pp")).locator("time")
        eventually(page, lambda: text_of(stamp) == expected, f"the label {expected!r}", LOAD_S + GRACE_S)
        assert stamp.first.get_attribute("datetime")


def test_feed_shortcuts(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v o", follows=[{"follower": "v", "target": "o", "at": at(t0, -DAY_S)}],
              posts=[post_spec("p1", "o", "one", t0, -60), post_spec("p2", "o", "two", t0, -120)])
    v = w.m("v")
    with browse(browser, v, "/feed") as page:
        a1, a2 = article(page, w.id("p1")), article(page, w.id("p2"))
        loaded(page, a2, "two entries")
        btn(page, "Start a post").focus()
        page.keyboard.press("j")
        assert has_focus(a1)
        page.keyboard.press("j")
        assert has_focus(a2)
        page.keyboard.press("k")
        assert has_focus(a1)
        page.keyboard.press("l")
        eventually(page, lambda: btn(a1, "React").get_attribute("aria-pressed") == "true", "L to react")
        page.keyboard.press("c")
        box = textbox(a1, "Add a comment")
        eventually(page, lambda: has_focus(box), "C to open the comment box with focus")
        page.keyboard.type("jk")
        assert has_focus(box) and box.input_value().endswith("jk"), "shortcuts must not fire in a text field"
        btn(a1, "Comment").focus()
        page.keyboard.type("?")
        shown(page, page.get_by_role("dialog", name="Keyboard shortcuts"), "the shortcuts dialog")
    assert v.ok("GET", f"/api/posts/{w.id('p1')}")["reactions"]["mine"] == "like"


def test_wf_feed_pill_time_keyboard_clock(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v c", connections=[conn("v", "c", t0)], posts=[post_spec("px", "c", "older", t0, -600)])
    c = w.m("c")
    with browse(browser, w.m("v"), "/feed") as page:
        loaded(page, article(page, w.id("px")), "feed")
        one = c.ok("POST", "/api/posts", {"text": "a"}, 201, key=idempotency_key())
        two = c.ok("POST", "/api/posts", {"text": "b"}, 201, key=idempotency_key())
        shown(page, btn(page, "Show 2 new posts"), "pill")
        press(btn(page, "Show 2 new posts"))
        eventually(page, lambda: has_focus(article(page, two["id"])), "focus on the first new entry")
        page.keyboard.press("j")
        assert has_focus(article(page, one["id"]))
        page.keyboard.press("k")
        assert has_focus(article(page, two["id"]))
        forward(app_url, 2 * 3600 + 30)
        eventually(page, lambda: text_of(article(page, two["id"]).locator("time")) == "2h", "labels follow the clock")
    assert [e["post"]["id"] for e in feed_all(w.m("v"))][:2] == [two["id"], one["id"]]


def test_wf_feed_pill_time_phone_reduced(app_url, browser):
    size = num(app_url, "PLAINWORK_FEED_PAGE_SIZE")
    t0 = server_now(app_url)
    w = World(app_url, "v c", connections=[conn("v", "c", t0)],
              posts=[post_spec(f"p{i}", "c", f"p{i}", t0, -60 * (i + 2)) for i in range(size + 2)])
    with browse(browser, w.m("v"), "/feed", size=PHONE, reduced_motion="reduce") as page:
        loaded(page, article(page, w.id("p0")), "feed")
        fresh = w.m("c").ok("POST", "/api/posts", {"text": "new"}, 201, key=idempotency_key())
        shown(page, btn(page, "Show 1 new post"), "pill")
        tap(btn(page, "Show 1 new post"))
        eventually(page, lambda: article_ids(page)[0] == fresh["id"], "inserted by tap")
        tap(btn(page, "Show more posts"))
        eventually(page, lambda: w.id(f"p{size + 1}") in article_ids(page), "the next page")
        ids = article_ids(page)
        assert len(ids) == len(set(ids)), "an entry repeated"
        absent(page, btn(page, "Show more posts"), "no Show more posts at the end")


def test_who_can_message(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b c d e", connections=[conn("a", "b", t0), conn("d", "e", t0)],
              messages=[{"from": "d", "to": "e", "text": "hi", "at": at(t0, -60), "read_at": None}])
    a, b, c = w.m("a"), w.m("b"), w.m("c")
    r = a.post("/api/conversations", {"member_id": b.id})
    assert r.status_code == 201
    conv = r.json()["id"]
    assert a.ok("POST", "/api/conversations", {"member_id": b.id}, 200)["id"] == conv
    r = c.post("/api/conversations", {"member_id": a.id})
    assert r.status_code == 403 and r.json() == {"error": "not_connected"}
    a.ok("POST", f"/api/conversations/{conv}/messages", {"text": "hello"}, 201, key=idempotency_key())
    assert c.get(f"/api/conversations/{conv}/messages").status_code == 404
    assert c.post(f"/api/conversations/{conv}/messages", {"text": "x"}, key=idempotency_key()).status_code == 404
    b.ok("DELETE", f"/api/connections/{a.id}")
    assert [m["text"] for m in messages_of(a, conv)] == ["hello"]
    r = a.post(f"/api/conversations/{conv}/messages", {"text": "after"}, key=idempotency_key())
    assert r.status_code == 403 and r.json() == {"error": "not_connected"}
    d, e = w.m("d"), w.m("e")
    dconv = d.ok("GET", "/api/conversations")["conversations"][0]["id"]
    d.ok("POST", "/api/blocks", {"member_id": e.id}, 201)
    assert d.get(f"/api/conversations/{dconv}/messages").status_code == 404
    assert e.get(f"/api/conversations/{dconv}/messages").status_code == 404
    with browse(browser, c, f"/messaging/with/{w.handle('a')}") as page:
        shows_text(page, f"You can message {w.name('a')} once you're connected.", seconds=LOAD_S + GRACE_S)
        assert textbox(page, "Write a message").count() == 0


def _thread_world(app_url: str, keys: str = "a b") -> tuple[World, str]:
    t0 = server_now(app_url)
    w = World(app_url, keys, connections=[conn("a", "b", t0)],
              messages=[{"from": "b", "to": "a", "text": "seed", "at": at(t0, -3600), "read_at": at(t0, -3500)}])
    return w, w.m("a").ok("GET", "/api/conversations")["conversations"][0]["id"]


def test_message_composer_live_delivery(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("b"), f"/messaging/{conv}") as pb, browse(browser, w.m("a"), f"/messaging/{conv}") as pa:
        box = textbox(pa, "Write a message")
        loaded(pa, box, "the message box")
        loaded(pb, pb.get_by_role("log", name="Messages"), "b's thread")
        box.focus()
        pa.keyboard.type("line one")
        pa.keyboard.press("Shift+Enter")
        pa.keyboard.type("line two")
        pa.keyboard.press("Enter")
        announced(pa, "Messaging announcements", "Message sent.")
        assert box.input_value() == ""
        log_b = pb.get_by_role("log", name="Messages")
        eventually(pb, lambda: "line one\nline two" in log_b.inner_text(), "the message live in b's thread")
        announced(pb, "Messaging announcements", f"New message from {w.name('a')}")
        pa.keyboard.type("   ")
        pa.keyboard.press("Enter")
        box.fill("")
        pa.keyboard.type("after")
        pa.keyboard.press("Enter")
        eventually(None, lambda: [m["text"] for m in messages_of(w.m("a"), conv)][-2:] == ["line one\nline two", "after"],
                   "blank text never stored")
    assert len(messages_of(w.m("a"), conv)) == 3


def test_typing_indicator(app_url, browser):
    timeout = num(app_url, "PLAINWORK_TYPING_TIMEOUT_MS")
    w, conv = _thread_world(app_url)
    status_text = f"{w.first('a')} is typing…"
    with browse(browser, w.m("b"), f"/messaging/{conv}") as pb, browse(browser, w.m("a"), f"/messaging/{conv}") as pa:
        box = textbox(pa, "Write a message")
        loaded(pa, box, "box")
        thread = pb.get_by_role("region", name=f"Conversation with {w.name('a')}")
        loaded(pb, thread, "b's thread")
        typing = thread.get_by_role("status").filter(has_text=status_text)
        box.focus()
        pa.keyboard.type("hel")
        eventually(None, lambda: visible(typing), "the typing status on b's thread")
        advance(pb, timeout + 2 * STEP_MS)
        eventually(None, lambda: not visible(typing), "the status to end after the typing timeout")
        advance(pa, 1000 + STEP_MS)
        pa.keyboard.type("lo")
        eventually(None, lambda: visible(typing), "typing again")
        pa.keyboard.press("Enter")
        eventually(None, lambda: not visible(typing), "the arriving message to clear the status")


def test_read_receipts_and_unread_counts(app_url, browser):
    tz = zone(app_url)
    w, conv = _thread_world(app_url)
    a, b = w.m("a"), w.m("b")
    with browse(browser, a, f"/messaging/{conv}") as pa:
        sent = a.ok("POST", f"/api/conversations/{conv}/messages", {"text": "unread?"}, 201, key=idempotency_key())
        mine = pa.locator(f"[data-message-id='{sent['id']}']")
        loaded(pa, mine, "a's own message")
        with browse(browser, b, "/messaging") as pb:
            nav = pb.get_by_role("navigation", name="Primary")
            loaded(pb, link(nav, "Messaging, 1 unread"), "the Messaging link count")
            row = pb.get_by_role("list", name="Conversations").get_by_role("link").filter(has_text="1 unread")
            shown(pb, row, "the conversation with data-unread 1")
            assert "1 unread" in row.inner_text()
            assert messages_of(b, conv)[-1]["read_at"] is None, "the list alone must not mark messages read"
            click(row)
            eventually(None, lambda: messages_of(b, conv)[-1]["read_at"] is not None, "read once the thread is open")
            shown(pb, link(nav, "Messaging"), "the plain Messaging link")
        read_at = parse_ts(messages_of(a, conv)[-1]["read_at"])
        eventually(pa, lambda: mine.get_attribute("data-read") == "true", "data-read true live")
        shows_text(pa, f"Seen {fmt_time(read_at, tz)}")
    assert next(x for x in b.ok("GET", "/api/conversations")["conversations"] if x["id"] == conv)["unread_count"] == 0


def test_first_message_email(app_url, mail):
    t0 = server_now(app_url)
    w = World(app_url, "a b c d", connections=[conn("a", "b", t0), conn("c", "d", t0)],
              messages=[{"from": "c", "to": "d", "text": "seeded", "at": at(t0, -60), "read_at": None}])
    a = w.m("a")
    conv = conversation_with(a, w.id("b"))
    a.ok("POST", f"/api/conversations/{conv}/messages", {"text": "first"}, 201, key=idempotency_key())
    a.ok("POST", f"/api/conversations/{conv}/messages", {"text": "second"}, 201, key=idempotency_key())
    mail_with(mail, w.email("b"), f"{w.name('a')} sent you a message", 1)
    no_mail(mail, w.email("d"), f"{w.name('c')} sent you a message")


def test_offline_message_outbox(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("a"), f"/messaging/{conv}") as page:
        box = textbox(page, "Write a message")
        loaded(page, box, "box")
        page.context.set_offline(True)
        box.focus()
        first, second = f"first {w.tag}", f"second {w.tag}"
        for text in (first, second):
            page.keyboard.type(text)
            page.keyboard.press("Enter")
        waiting = page.locator("[data-pending='true']")
        eventually(None, lambda: waiting.count() == 2, "two waiting messages")
        assert first in waiting.nth(0).inner_text() and "Waiting to send" in waiting.nth(1).inner_text()
        status = page.get_by_role("status", name="Connection")
        assert (status.text_content() or "").strip() == "You're offline. Messages will send when you reconnect."
        assert has_focus(box) and box.input_value() == ""
        page.context.set_offline(False)
        eventually(page, lambda: waiting.count() == 0, "the outbox to drain once online", LOAD_S + 2 * GRACE_S)
        eventually(page, lambda: (status.text_content() or "").strip() == "", "the status empty online")
    msgs = messages_of(w.m("a"), conv)
    assert [m["text"] for m in msgs][-2:] == [first, second]
    assert [m["text"] for m in msgs].count(first) == 1
    assert msgs[-2]["sent_at"] <= msgs[-1]["sent_at"]


def test_message_retry_same_key_and_unsent(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("a"), f"/messaging/{conv}") as page:
        box = textbox(page, "Write a message")
        loaded(page, box, "box")
        keys: list = []

        def flaky(route):
            if route.request.method != "POST":
                return route.fallback()
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                route.fetch()
                return route.abort("internetdisconnected")
            if len(keys) == 2:
                return route.abort("internetdisconnected")
            return route.fallback()

        page.route(f"**/api/conversations/{conv}/messages", flaky)
        box.focus()
        page.keyboard.type("retried")
        page.keyboard.press("Enter")
        eventually(page, lambda: len(keys) >= 3, "retries on the published schedule", 4 * GRACE_S)
        eventually(page, lambda: page.locator("[data-pending='true']").count() == 0, "the retried message sent")
        assert len(set(keys)) == 1 and keys[0], "every retry must carry the same Idempotency-Key"
        page.unroute(f"**/api/conversations/{conv}/messages")
        page.context.set_offline(True)
        page.keyboard.type("refused")
        page.keyboard.press("Enter")
        w.m("b").ok("DELETE", f"/api/connections/{w.id('a')}")
        page.context.set_offline(False)
        failed = page.locator("[data-failed='true']")
        eventually(page, lambda: failed.count() == 1, "the refused message to stay unsent", LOAD_S + 2 * GRACE_S)
        assert failed.get_attribute("data-pending") == "false"
        assert "Not sent. You're no longer connected." in failed.inner_text()
        assert visible(btn(failed, "Retry sending"))
        click(btn(failed, "Delete unsent message"))
        absent(page, failed, "Delete unsent message removes it")
    texts = [m["text"] for m in messages_of(w.m("a"), conv)]
    assert texts.count("retried") == 1 and "refused" not in texts


def test_wf_live_conversation_exchange(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("a"), f"/messaging/{conv}") as pa, browse(browser, w.m("b"), "/messaging") as pb:
        box = textbox(pa, "Write a message")
        loaded(pa, box, "a's box")
        box.focus()
        pa.keyboard.type("hello")
        pa.keyboard.press("Shift+Enter")
        pa.keyboard.type("there")
        pa.keyboard.press("Enter")
        nav = pb.get_by_role("navigation", name="Primary")
        shown(pb, link(nav, "Messaging, 1 unread"), "b's unread count live")
        click(pb.get_by_role("list", name="Conversations").get_by_role("link").first)
        reply = textbox(pb, "Write a message")
        loaded(pb, reply, "b's thread")
        shown(pb, link(nav, "Messaging"), "count back to zero")
        eventually(pa, lambda: pa.get_by_text(re.compile(r"^Seen ")).count() > 0, "Seen on a's thread live")
        reply.focus()
        pb.keyboard.type("hi back")
        typing = pa.get_by_role("status").filter(has_text=f"{w.first('b')} is typing…")
        eventually(None, lambda: visible(typing), "a sees b typing")
        pb.keyboard.press("Enter")
        eventually(pa, lambda: "hi back" in pa.get_by_role("log", name="Messages").inner_text(), "b's reply live")
    assert [m["text"] for m in messages_of(w.m("a"), conv)][-2:] == ["hello\nthere", "hi back"]


def test_wf_live_conversation_refusal(app_url, browser):
    w = World(app_url, "a c")
    with browse(browser, w.m("c"), f"/messaging/with/{w.handle('a')}") as page:
        shows_text(page, f"You can message {w.name('a')} once you're connected.", seconds=LOAD_S + GRACE_S)
        assert textbox(page, "Write a message").count() == 0
    r = w.m("c").post("/api/conversations", {"member_id": w.id("a")})
    assert r.status_code == 403 and r.json() == {"error": "not_connected"}


def _skill(m: Member, handle: str, name: str) -> dict:
    return next(s for s in profile(m, handle)["skills"] if s["name"] == name)


def test_endorsements_rules_and_toggle(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o c s z", profiles={"o": {"skills": ["Panel work", "Conduit"]},
                                            "z": {"visibility": "connections", "skills": ["Hidden"]}},
              connections=[conn("o", "c", t0)])
    o, c, s = w.m("o"), w.m("c"), w.m("s")
    base = f"/api/members/{o.id}/skills"
    body = c.ok("PUT", f"{base}/{quote('panel WORK')}/endorsement")
    assert body["endorsements"] == 1 and body["endorsed_by_me"] is True
    assert c.ok("PUT", f"{base}/{quote('Panel work')}/endorsement")["endorsements"] == 1
    assert s.put(f"{base}/Conduit/endorsement").json() == {"error": "not_connected"}
    assert o.put(f"{base}/Conduit/endorsement").json() == {"error": "own_profile"}
    assert c.put(f"{base}/Welding/endorsement").status_code == 404
    assert c.ok("DELETE", f"{base}/{quote('Panel work')}/endorsement")["endorsements"] == 0
    assert "skills" not in profile(s, w.handle("z")), "a non-connection gets no skills for a connections-only profile"
    with browse(browser, c, f"/in/{w.handle('o')}") as page:
        endorse = btn(page, "Endorse Conduit")
        loaded(page, endorse, "Endorse Conduit")
        assert endorse.get_attribute("aria-pressed") == "false"
        click(endorse)
        announced(page, "Profile announcements", "Endorsed Conduit.")
        eventually(page, lambda: endorse.get_attribute("aria-pressed") == "true", "pressed after endorsing")
        click(endorse)
        announced(page, "Profile announcements", "Endorsement removed.")
    with browse(browser, s, f"/in/{w.handle('o')}") as page:
        loaded(page, page.get_by_role("region", name="Skills"), "skills region")
        assert page.get_by_role("button", name=re.compile(r"^Endorse ")).count() == 0
    c.ok("PUT", f"{base}/Conduit/endorsement")
    ver = o.ok("GET", "/api/me")["versions"]["skills"]
    ver = o.ok("PATCH", "/api/me/sections/skills", {"version": ver, "skills": ["Panel work"]})["version"]
    o.ok("PATCH", "/api/me/sections/skills", {"version": ver, "skills": ["Panel work", "Conduit"]})
    assert _skill(o, w.handle("o"), "Conduit")["endorsements"] == 0


def test_skill_order_live_reorder(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o c1 c2", profiles={"o": {"skills": [SK_B, SK_A, SK_G]}},
              connections=[conn("o", "c1", t0), conn("o", "c2", t0)])
    o = w.m("o")
    with browse(browser, o, f"/in/{w.handle('o')}") as page:
        rows = page.get_by_role("region", name="Skills").locator("[data-skill]")
        order = lambda: rows.evaluate_all("els => els.map(e => [e.getAttribute('data-skill'), e.getAttribute('data-endorsements')])")
        eventually(page, lambda: order() == [[SK_A, "0"], [SK_B, "0"], [SK_G, "0"]], "initial order",
                   LOAD_S + GRACE_S)
        assert f"{SK_A} · No endorsements yet" in rows.first.inner_text()
        w.m("c1").ok("PUT", f"/api/members/{o.id}/skills/{quote(SK_G)}/endorsement")
        eventually(page, lambda: order()[0] == [SK_G, "1"], "live reorder after one endorsement")
        assert f"{SK_G} · 1 endorsement" in rows.first.inner_text()
        w.m("c2").ok("PUT", f"/api/members/{o.id}/skills/{quote(SK_G)}/endorsement")
        eventually(page, lambda: f"{SK_G} · 2 endorsements" in rows.first.inner_text(), "2 endorsements")
    assert [s["name"] for s in profile(o, w.handle("o"))["skills"]] == [SK_G, SK_A, SK_B]


def test_skill_limit(app_url, browser):
    limit = num(app_url, "PLAINWORK_MAX_SKILLS")
    w = World(app_url, "o")
    o = w.m("o")
    names = [f"Skill {i}" for i in range(limit + 1)]
    ver = o.ok("GET", "/api/me")["versions"]["skills"]
    r = o.patch("/api/me/sections/skills", {"version": ver, "skills": names})
    assert r.status_code == 422 and r.json() == {"error": "skill_limit", "limit": limit}
    o.ok("PATCH", "/api/me/sections/skills", {"version": ver, "skills": names[:limit]})
    with browse(browser, o, f"/in/{w.handle('o')}") as page:
        add = textbox(page, "Add a skill")
        loaded(page, add, "Add a skill")
        fill(add, "One too many")
        click(btn(page, "Add skill"))
        alerted(page, f"You can list up to {limit:,} skills.")
    assert len(o.ok("GET", "/api/me")["skills"]) == limit


def test_featured_skills_order_and_endorser_line(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o v c s", profiles={"o": {"skills": [SK_A, SK_B, SK_G, SK_D]}},
              connections=[conn("o", "v", t0), conn("o", "c", t0), conn("o", "s", t0), conn("v", "c", t0)],
              endorsements=[{"endorser": "c", "owner": "o", "skill": SK_B, "at": at(t0, -7200)},
                            {"endorser": "s", "owner": "o", "skill": SK_B, "at": at(t0, -3600)},
                            {"endorser": "s", "owner": "o", "skill": SK_G, "at": at(t0, -3600)}])
    o, v = w.m("o"), w.m("v")
    ver = o.ok("GET", "/api/me")["versions"]["skills"]
    r = o.patch("/api/me/sections/skills", {"version": ver, "skills": [SK_A, SK_B, SK_G, SK_D],
                                            "featured": [SK_A, SK_B, SK_G, SK_D]})
    assert r.status_code == 422 and r.json() == {"error": "featured_limit", "limit": 3}
    o.ok("PATCH", "/api/me/sections/skills", {"version": ver, "skills": [SK_A, SK_B, SK_G, SK_D],
                                              "featured": [SK_D, SK_A]})
    skills = profile(o, w.handle("o"))["skills"]
    assert [(s["name"], s["featured_position"]) for s in skills][:2] == [(SK_D, 1), (SK_A, 2)]
    assert [s["name"] for s in skills][2:] == [SK_B, SK_G]
    v.ok("PUT", f"/api/members/{o.id}/skills/{quote(SK_A)}/endorsement")
    line = lambda page, skill: text_of(page.locator(f"[data-skill='{skill}'][data-endorsements]").locator("[data-endorser-line]"))
    with browse(browser, v, f"/in/{w.handle('o')}") as page:
        eventually(page, lambda: line(page, SK_B) == f"Endorsed by {w.name('c')} and 1 other", "connection endorser line",
                   LOAD_S + GRACE_S)
        assert line(page, SK_A) == "Endorsed by you"
        assert line(page, SK_G) == ""
    with browse(browser, o, f"/in/{w.handle('o')}") as page:
        eventually(page, lambda: line(page, SK_B) == f"Endorsed by {w.name('s')} and 1 other", "owner counts everyone",
                   LOAD_S + GRACE_S)
        featured = page.get_by_role("listbox", name="Featured skills")
        alpha = featured.get_by_role("option", name=SK_A, exact=True)
        loaded(page, alpha, "the featured listbox")
        assert page.locator(f"[data-skill='{skills[0]['name']}'][data-endorsements]").get_attribute("data-featured") == "true"
        alpha.focus()
        page.keyboard.press("Alt+ArrowUp")
        eventually(page, lambda: featured.get_by_role("option").all_inner_texts()[:2] == [SK_A, SK_D], "moved up")
        assert has_focus(alpha)
        eventually(page, lambda: any(f"{SK_A} moved to position 1 of 2." in (s.text_content() or "")
                                     for s in page.get_by_role("status").all()), "the move announcement")
        click(btn(page, f"Feature {SK_B}"))
        eventually(page, lambda: featured.get_by_role("option").all_inner_texts() == [SK_A, SK_D, SK_B], "Conduit featured")
    eventually(None, lambda: [s["name"] for s in profile(o, w.handle("o"))["skills"]][:3] == [SK_A, SK_D, SK_B],
               "the featured order to be stored")


def test_wf_endorse_reorder_live(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o c", profiles={"o": {"skills": [SK_A, SK_B, SK_G]}}, connections=[conn("o", "c", t0)])
    o = w.m("o")
    with browse(browser, o, f"/in/{w.handle('o')}") as po, browse(browser, w.m("c"), f"/in/{w.handle('o')}") as pc:
        rows = po.get_by_role("region", name="Skills").locator("[data-skill]")
        loaded(po, rows.first, "owner skills")
        for skill in (SK_G, SK_B):
            press(btn(pc, f"Endorse {skill}"))
            announced(pc, "Profile announcements", f"Endorsed {skill}.")
        eventually(po, lambda: rows.evaluate_all("els => els.map(e => e.getAttribute('data-skill'))") == [SK_B, SK_G, SK_A],
                   "the owner's profile to reorder live")
    assert [s["endorsements"] for s in profile(o, w.handle("o"))["skills"]] == [1, 1, 0]


def test_wf_endorse_reorder_stranger_and_limit(app_url, browser):
    limit = num(app_url, "PLAINWORK_MAX_SKILLS")
    w = World(app_url, "o s", profiles={"o": {"skills": [f"S{i}" for i in range(limit)]}})
    with browse(browser, w.m("s"), f"/in/{w.handle('o')}") as page:
        loaded(page, page.get_by_role("region", name="Skills"), "skills")
        assert page.get_by_role("button", name=re.compile(r"^Endorse ")).count() == 0
    with browse(browser, w.m("o"), f"/in/{w.handle('o')}") as page:
        add = textbox(page, "Add a skill")
        loaded(page, add, "Add a skill")
        add.focus()
        page.keyboard.type("Extra")
        press(btn(page, "Add skill"))
        alerted(page, f"You can list up to {limit:,} skills.")
    assert len(w.m("o").ok("GET", "/api/me")["skills"]) == limit


def _job_world(app_url: str, users: str = "p n a", **lists: Any) -> World:
    tag, t0 = new_tag(), server_now(app_url)
    jobs = lists.pop("jobs", None) or [job_spec(tag, "j1", t0)]
    return World(app_url, users, tag=tag, companies=[company_spec(tag, "co", ["p"])], jobs=jobs, **lists)


def test_company_page_and_job_posting(app_url, browser):
    tz = zone(app_url)
    w = _job_world(app_url, "p n f1 f2")
    handle = w.company("co")["handle"]
    p, n = w.m("p"), w.m("n")
    comp = n.ok("GET", f"/api/companies/{handle}")
    assert comp["is_admin"] is False and w.id("j1") in [j["id"] for j in comp["open_jobs"]]
    assert n.patch(f"/api/companies/{handle}", {"name": "x"}).json() == {"error": "not_admin"}
    assert n.get(f"/api/companies/{handle}/followers").json() == {"error": "not_admin"}
    job = {"company_id": w.id("co"), "title": f"Lineman {w.tag}", "location": "Chicago, IL", "workplace": "remote",
           "description": "d"}
    assert n.post("/api/jobs", dict(job, closes_at=at(server_now(app_url), DAY_S))).json() == {"error": "not_admin"}
    r = p.post("/api/jobs", dict(job, closes_at=at(server_now(app_url), -60)))
    assert r.status_code == 422 and r.json()["fields"]["closes_at"] == "Pick a closing time in the future."
    p.ok("POST", "/api/jobs", dict(job, closes_at=at(server_now(app_url), DAY_S)), 201)
    for k in ("f1", "f2"):
        w.m(k).ok("POST", "/api/follows", {"target_id": w.id("co")}, 201)
    local = (server_now(app_url) + timedelta(days=10)).astimezone(tz).replace(second=0, microsecond=0)
    with browse(browser, n, f"/company/{handle}") as page:
        shows_text(page, "2 followers", seconds=LOAD_S + GRACE_S)
        assert btn(page, "Post a job").count() == 0 and btn(page, "Edit page").count() == 0
    with browse(browser, p, f"/company/{handle}") as page:
        loaded(page, btn(page, "Post a job"), "Post a job")
        assert visible(page.get_by_role("list", name="Followers"))
        click(btn(page, "Post a job"))
        dialog = page.get_by_role("dialog", name="Post a job")
        fill(textbox(dialog, "Job title"), f"Splicer {w.tag}")
        fill(textbox(dialog, "Location"), "Chicago, IL")
        fill(textbox(dialog, "Description"), "Climb.")
        fill(textbox(dialog, "Closes"), "next week")
        click(btn(dialog, "Publish job"))
        shows_text(page, "Use YYYY-MM-DD HH:MM.", scope=dialog)
        fill(textbox(dialog, "Closes"), local.strftime("%Y-%m-%d %H:%M"))
        click(btn(dialog, "Publish job"))
        absent(page, dialog, "the dialog to close after publishing")
    posted = next(j for j in p.ok("GET", f"/api/companies/{handle}")["open_jobs"] if j["title"] == f"Splicer {w.tag}")
    assert parse_ts(posted["closes_at"]) == local.astimezone(timezone.utc) and posted["workplace"] == "on-site"


def test_job_search_filters_and_saved(app_url, browser):
    tag, t0 = new_tag(), server_now(app_url)
    w = _job_world(app_url, "p a", jobs=[job_spec(tag, "j1", t0, workplace="remote", location=f"Austin {tag}",
                                                  posted_at=at(t0, -7200)),
                                         job_spec(tag, "j2", t0, workplace="hybrid", posted_at=at(t0, -3 * DAY_S))])
    w.tag = tag
    a = w.m("a")
    assert [j["id"] for j in search_all(a, type="jobs", q=tag, workplace="hybrid")] == [w.id("j2")]
    assert a.ok("PUT", f"/api/jobs/{w.id('j2')}/save") == {"saved": True}
    assert a.ok("PUT", f"/api/jobs/{w.id('j1')}/save") == {"saved": True}
    assert [j["id"] for j in a.ok("GET", "/api/me/jobs?tab=saved")["jobs"]] == [w.id("j1"), w.id("j2")]
    assert a.ok("DELETE", f"/api/jobs/{w.id('j2')}/save") == {"saved": False}
    with browse(browser, a, "/jobs") as page:
        loc = textbox(page, "Location")
        loaded(page, loc, "jobs filters")
        fill(loc, f"austin {tag}")
        select(page.get_by_role("combobox", name="Workplace"), "Remote")
        select(page.get_by_role("combobox", name="Date posted"), "Past 24 hours")
        cards = page.get_by_role("listitem").and_(page.locator("[data-job-id]"))
        eventually(page, lambda: cards.evaluate_all("els => els.map(e => e.getAttribute('data-job-id'))") == [w.id("j1")],
                   "only the matching job")
        page.goto(app_url + f"/jobs/{w.id('j2')}")
        save = btn(page, "Save job")
        loaded(page, save, "Save job")
        click(save)
        announced(page, "Jobs announcements", "Job saved.")
        saved = btn(page, "Saved")
        shown(page, saved, "Saved")
        assert saved.get_attribute("aria-pressed") == "true"
        click(saved)
        announced(page, "Jobs announcements", "Job removed from saved.")
        page.goto(app_url + "/my-jobs")
        click(page.get_by_role("tab", name="Saved"))
        shown(page, page.locator(f"[data-job-id='{w.id('j1')}']"), "j1 under Saved")
    assert [j["id"] for j in a.ok("GET", "/api/me/jobs?tab=saved")["jobs"]] == [w.id("j1")]


def test_job_closing_instant(app_url, browser):
    t0 = server_now(app_url)
    w = _job_world(app_url, "p a", jobs=[job_spec(new_tag(), "j1", t0, closes_at=at(t0, 120))])
    a, jid = w.m("a"), w.id("j1")
    a.ok("PUT", f"/api/jobs/{jid}/save")
    with browse(browser, a, f"/jobs/{jid}", device_time=DEVICE_FUTURE) as page:
        loaded(page, btn(page, "Apply"), "Apply while open, whatever the device clock")
        clock_to(app_url, parse_ts(w.job("j1")["closes_at"]))
        shows_text(page, "No longer accepting applications")
        assert btn(page, "Apply").count() == 0
    assert a.ok("GET", f"/api/jobs/{jid}")["open"] is False
    r = apply(a, jid)
    assert r.status_code == 409 and r.json() == {"error": "job_closed"}
    assert jid not in [j["id"] for j in search_all(a, type="jobs", q=w.job("j1")["title"])]
    assert jid not in [j["id"] for j in a.ok("GET", f"/api/companies/{w.company('co')['handle']}")["open_jobs"]]
    assert jid in [j["id"] for j in a.ok("GET", "/api/me/jobs?tab=saved")["jobs"]]


def test_resume_upload_confirmed_bytes(app_url, browser):
    limit = num(app_url, "PLAINWORK_RESUME_MAX_BYTES")
    w = _job_world(app_url, "p a")
    a = w.m("a")
    r = upload_resume(a, b"plain text", "resume.pdf")
    assert r.status_code == 422 and r.json() == {"error": "resume_type"}
    r = upload_resume(a, pdf_bytes(limit + 1))
    assert r.status_code == 422 and r.json() == {"error": "resume_too_large", "limit": limit}
    data = pdf_bytes(limit)
    r = upload_resume(a, data, ctype="application/octet-stream")
    assert r.status_code == 201
    body = r.json()
    assert body["bytes"] == limit and body["sha256"] == hashlib.sha256(data).hexdigest()
    assert storage().get(f"resumes/{a.id}/{body['resume_id']}.pdf") == data
    r = upload_resume(a, pdf_bytes(limit + MULTIPART_SLACK + 1024))
    assert r.status_code == 413
    with browse(browser, a, f"/jobs/{w.id('j1')}") as page:
        loaded(page, btn(page, "Apply"), "Apply")
        click(btn(page, "Apply"))
        dialog = page.get_by_role("dialog", name=f"Apply to {w.job('j1')['title']}")
        submit = btn(dialog, "Submit application")
        assert submit.is_disabled()
        with held(page, "**/api/uploads/resume") as hold:
            dialog.get_by_label("Resume (PDF)").set_input_files(
                {"name": "cv.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()})
            shows_text(page, "Uploading…", scope=dialog)
            assert submit.is_disabled(), "Submit must wait for the storage confirmation"
            hold.release()
        announced(page, "Jobs announcements", "Resume attached.")
        eventually(page, lambda: submit.is_enabled(), "Submit enabled after confirmation")


def test_one_application_per_job(app_url, browser):
    t0 = server_now(app_url)
    tag = new_tag()
    w = _job_world(app_url, "p a b", jobs=[job_spec(tag, "j1", t0), job_spec(tag, "jc", t0, closes_at=at(t0, -60))],
                   applications=[{"key": "old", "job": "jc", "applicant": "a", "state": "applied", "at": at(t0, -3600)}])
    a, b = w.m("a"), w.m("b")
    rids = [resume_id(a), resume_id(a)]
    gate = threading.Barrier(2)

    def go(rid: str) -> httpx.Response:
        m = w.fresh("a")
        gate.wait()
        return m.post(f"/api/jobs/{w.id('j1')}/applications", {"resume_id": rid, "answers": {}})

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(go, rids))
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409]
    won = next(r for r in results if r.status_code == 201).json()["id"]
    lost = next(r for r in results if r.status_code == 409).json()
    assert lost == {"error": "already_applied", "application_id": won}
    r = apply(a, w.id("jc"))
    assert r.status_code == 409 and r.json()["error"] == "already_applied"
    with browse(browser, b, f"/jobs/{w.id('j1')}") as page:
        loaded(page, btn(page, "Apply"), "Apply")
        click(btn(page, "Apply"))
        dialog = page.get_by_role("dialog", name=f"Apply to {w.job('j1')['title']}")
        dialog.get_by_label("Resume (PDF)").set_input_files({"name": "cv.pdf", "mimeType": "application/pdf",
                                                             "buffer": pdf_bytes()})
        submit = btn(dialog, "Submit application")
        eventually(page, lambda: submit.is_enabled(), "resume attached")
        apply(b, w.id("j1"))
        click(submit)
        alerted(page, "You already applied to this job.")
    assert sum(1 for j in b.ok("GET", "/api/me/jobs?tab=applied")["jobs"] if j["id"] == w.id("j1")) == 1


PUBLISHED_STAGES = [
    {"state": "applied", "label": "Applied", "status_text": "Application submitted", "moved_by": "applicant"},
    {"state": "viewed", "label": "Viewed", "status_text": "Viewed by the hiring team", "moved_by": "system"},
    {"state": "interviewing", "label": "Interviewing", "status_text": "Interviewing", "moved_by": "poster"},
    {"state": "offered", "label": "Offered", "status_text": "Offer extended", "moved_by": "poster"},
    {"state": "rejected", "label": "Rejected", "status_text": "Not selected", "moved_by": "poster"},
    {"state": "withdrawn", "label": "Withdrawn", "status_text": "Withdrawn", "moved_by": "applicant"},
]
MOVED_BY_TEXT = {"applicant": "the applicant", "poster": "the hiring team",
                 "system": "automatically when the hiring team first opens it"}


def test_application_state_machine_and_history(app_url, browser, mail):
    tz = zone(app_url)
    w = _job_world(app_url, "p a")
    p, a, jid = w.m("p"), w.m("a"), w.id("j1")
    title = w.job("j1")["title"]
    job = a.ok("GET", f"/api/jobs/{jid}")
    assert job["stages"] == PUBLISHED_STAGES and job["my_application"] is None
    app = apply(a, jid).json()
    assert app["state"] == "applied" and app["status_text"] == "Application submitted"
    assert [(h["state"], h["by"]) for h in app["history"]] == [("applied", "you")]
    move = lambda m, to: m.post(f"/api/applications/{app['id']}/transition", {"to": to})
    assert move(a, "interviewing").json() == {"error": "not_poster"}
    assert move(p, "withdrawn").json() == {"error": "not_applicant"}
    viewed = p.ok("GET", f"/api/applications/{app['id']}")
    assert viewed["state"] == "viewed" and viewed["history"][-1]["by"] == "hiring_team"
    assert move(p, "interviewing").status_code == 200
    r = move(p, "applied")
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition", "from": "interviewing", "to": "applied"}
    assert move(p, "offered").json()["status_text"] == "Offer extended"
    assert move(a, "withdrawn").json()["error"] == "invalid_transition"
    final = move(p, "rejected").json()
    assert final["status_text"] == "Not selected"
    assert [h["state"] for h in final["history"]] == ["applied", "viewed", "interviewing", "offered", "rejected"]
    assert move(p, "offered").json()["error"] == "invalid_transition"
    mail_with(mail, w.email("a"), f"Update on your application for {title}")
    with browse(browser, a, "/my-jobs") as page:
        click(page.get_by_role("tab", name="Applied"))
        item = page.locator(f"[data-application-id='{app['id']}']")
        loaded(page, item, "the applied item")
        assert item.get_attribute("data-state") == "rejected" and "Not selected" in item.inner_text()
        lines = page.get_by_role("list", name=f"History for {title}").get_by_role("listitem").all_inner_texts()
        expected = [f"{h['status_text']} · {fmt_date(parse_ts(h['at']), tz)} at {fmt_time(parse_ts(h['at']), tz)} · "
                    f"{'You' if h['by'] == 'you' else 'Hiring team'}" for h in final["history"]]
        assert [x.strip() for x in lines] == expected
        page.goto(app_url + f"/jobs/{jid}")
        stages = page.get_by_role("list", name="Hiring stages").get_by_role("listitem")
        eventually(page, lambda: [s.strip() for s in stages.all_inner_texts()] ==
                   [f"{s['label']} · {s['status_text']} · Moved by {MOVED_BY_TEXT[s['moved_by']]}" for s in PUBLISHED_STAGES],
                   "the hiring stages list", LOAD_S + GRACE_S)


def test_application_access(app_url):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "p q s a", tag=tag, companies=[company_spec(tag, "co", ["p", "q"])],
              jobs=[job_spec(tag, "j1", t0, questions=[question("k1", "yes_no", knock_out=True, ideal="yes")])])
    p, q, s, a = (w.m(k) for k in "pqsa")
    data = pdf_bytes(4096)
    rid = upload_resume(a, data).json()["resume_id"]
    app = apply(a, w.id("j1"), {w.id("k1"): "yes"}, rid=rid).json()
    assert "applicant" not in app and "resume_url" not in app
    for outsider in (q, s):
        assert outsider.get(f"/api/applications/{app['id']}").status_code == 404
        assert outsider.get(f"/api/applications/{app['id']}/resume").status_code == 404
    assert q.get(f"/api/jobs/{w.id('j1')}/applications").json() == {"error": "not_poster"}
    seen = p.ok("GET", f"/api/applications/{app['id']}")
    assert seen["applicant"]["id"] == a.id and seen["resume_url"]
    for m in (p, a):
        r = m.get(f"/api/applications/{app['id']}/resume")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == data
    public_q = s.ok("GET", f"/api/jobs/{w.id('j1')}")["questions"][0]
    assert set(public_q) == {"id", "type", "text", "required", "options"}


def test_applicants_board_moves(app_url, browser):
    t0 = server_now(app_url)
    apps = [{"key": f"ap{i}", "job": "j1", "applicant": k, "state": s, "at": at(t0, -3600)}
            for i, (k, s) in enumerate((("a", "applied"), ("b", "interviewing"), ("c", "applied")))]
    w = _job_world(app_url, "p a b c", applications=apps)
    p = w.m("p")
    state = lambda key: p.ok("GET", f"/api/jobs/{w.id('j1')}/applications")
    with browse(browser, p, f"/jobs/{w.id('j1')}/applicants") as page:
        col = lambda label: page.get_by_role("list", name=label, exact=True)
        card = lambda k: page.get_by_role("listitem").and_(page.locator(f"[data-application-id='{w.id(k)}']"))
        loaded(page, card("ap0"), "the board")
        press(btn(page, f"Move {w.name('a')}"))
        items = page.get_by_role("menuitem").all_inner_texts()
        assert sorted(x.strip() for x in items) == sorted(f"Move to {STAGE_LABELS[i]}" for i in (1, 4))
        press(page.get_by_role("menuitem", name=f"Move to {STAGE_LABELS[1]}"))
        announced(page, "Jobs announcements", f"Moved {w.name('a')} to Viewed")
        shown(page, col("Viewed").locator(f"[data-application-id='{w.id('ap0')}']"), "the card in Viewed")
        card("ap1").first.focus()
        page.keyboard.press("Space")
        announced(page, "Jobs announcements", f"Picked up {w.name('b')}")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        announced(page, "Jobs announcements", f"Moved {w.name('b')} to Offered")
        card("ap0").first.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Escape")
        announced(page, "Jobs announcements", "Move cancelled.")
        card("ap2").first.drag_to(col("Rejected"))
        eventually(page, lambda: card("ap2").get_attribute("data-state") == "rejected", "the drag to Rejected")
    columns = state("x")["columns"]
    assert [c["id"] for c in columns["offered"]] == [w.id("ap1")]
    assert [c["id"] for c in columns["viewed"]] == [w.id("ap0")]
    assert [c["id"] for c in columns["rejected"]] == [w.id("ap2")]


def test_live_application_status(app_url, browser):
    w = _job_world(app_url, "p a")
    a, p = w.m("a"), w.m("p")
    app = apply(a, w.id("j1")).json()
    title = w.job("j1")["title"]
    with browse(browser, a, "/my-jobs") as page:
        click(page.get_by_role("tab", name="Applied"))
        item = page.locator(f"[data-application-id='{app['id']}']")
        loaded(page, item, "the application")
        p.ok("GET", f"/api/applications/{app['id']}")
        eventually(page, lambda: item.get_attribute("data-state") == "viewed", "viewed live")
        announced(page, "Jobs announcements", f"Your application for {title} is now: Viewed by the hiring team.")
        p.ok("POST", f"/api/applications/{app['id']}/transition", {"to": "interviewing"})
        eventually(page, lambda: item.get_attribute("data-state") == "interviewing", "interviewing live")
        announced(page, "Jobs announcements", f"Your application for {title} is now: Interviewing.")


def test_screening_answers_and_knockouts(app_url, mail):
    tag, t0 = new_tag(), server_now(app_url)
    qs = [question("q1", "short_answer", required=True, text=f"Why {tag}?"),
          question("q2", "yes_no", knock_out=True, ideal="yes", text=f"Licensed {tag}?"),
          question("q3", "single_choice", knock_out=True, options=["Day", "Night"], accepted=["Day"], text=f"Shift {tag}?"),
          question("q4", "number", required=True, knock_out=True, minimum=1, maximum=10, text=f"Years {tag}?")]
    w = _job_world(app_url, "p a b c", jobs=[job_spec(tag, "j1", t0, questions=qs)])
    a, jid = w.m("a"), w.id("j1")
    q = {k: w.id(k) for k in ("q1", "q2", "q3", "q4")}
    r = apply(a, jid, {q["q1"]: "", q["q2"]: "maybe", q["q3"]: "Evening", q["q4"]: 2.5})
    assert r.status_code == 422 and r.json()["error"] == "validation"
    assert r.json()["fields"] == {f"answers.{q['q1']}": "Answer this question.", f"answers.{q['q2']}": "Choose Yes or No.",
                                  f"answers.{q['q3']}": "Choose one of the options.", f"answers.{q['q4']}": "Enter a whole number."}
    r = apply(a, jid, {q["q1"]: "x" * (SHORT_ANSWER_MAX + 1), q["q2"]: "yes", q["q3"]: "Day", q["q4"]: 3})
    assert r.json()["fields"] == {f"answers.{q['q1']}": "Keep this under 500 characters."}
    r = apply(a, jid, {q["q1"]: "ok", q["q2"]: "yes", q["q3"]: "Day", q["q4"]: 3, w.id("p"): "x"})
    assert r.json()["fields"]["answers"] == "Answer only this job's questions."
    good = apply(a, jid, {q["q1"]: "ok", q["q2"]: "yes", q["q3"]: "Day", q["q4"]: 3})
    assert good.status_code == 201 and good.json()["state"] == "applied"
    assert apply(a, jid, {q["q1"]: ""}).json()["error"] == "already_applied"
    miss = apply(w.m("b"), jid, {q["q1"]: "ok", q["q2"]: "no", q["q3"]: "Night", q["q4"]: 3}).json()
    assert miss["state"] == "rejected" and miss["status_text"] == "Not selected"
    assert [(h["state"], h["by"], h["reason"]) for h in miss["history"]] == [
        ("applied", "you", None), ("rejected", "automatic", f"Licensed {tag}?")]
    low = apply(w.m("c"), jid, {q["q1"]: "ok", q["q2"]: "yes", q["q3"]: "Day", q["q4"]: 0}).json()
    assert low["history"][-1]["reason"] == f"Years {tag}?"
    mail_with(mail, w.email("b"), f"Update on your application for {w.job('j1')['title']}")


def _history(state_path: list[tuple[str, int, str]], t0: datetime) -> list[dict]:
    return [{"state": s, "at": at(t0, -DAY_S + minutes * 60), "by": by, "reason": None} for s, minutes, by in state_path]


def test_live_hiring_funnel(app_url, browser):
    t0 = server_now(app_url)
    H = "hiring_team"
    paths = {
        "a": [("applied", 0, "you"), ("viewed", 30, H), ("interviewing", 60, H), ("offered", 90, H)],
        "b": [("applied", 0, "you"), ("viewed", 130, H), ("interviewing", 200, H)],
        "c": [("applied", 0, "you"), ("viewed", 45, H), ("rejected", 60, H)],
        "d": [("applied", 0, "you"), ("rejected", 0, "automatic")],
        "e": [("applied", 0, "you"), ("withdrawn", 10, "you")],
    }
    apps = [{"key": f"ap{k}", "job": "j1", "applicant": k, "state": h[-1][0], "at": at(t0, -DAY_S), "answers": {},
             "history": _history(h, t0)} for k, h in paths.items()]
    w = _job_world(app_url, "p a b c d e f", applications=apps)
    p = w.m("p")
    funnel = p.ok("GET", f"/api/jobs/{w.id('j1')}/funnel")
    rows = [(r["stage"], r["count"]) for r in funnel["rows"]]
    assert rows == [("applied", 5), ("viewed", 3), ("interviewing", 2), ("offered", 1), ("rejected", 2), ("withdrawn", 1)]
    assert [r["rate"] for r in funnel["rows"][:4]] == [100, 60, 67, 50] and funnel["median_first_view_minutes"] == 45
    assert w.m("a").get(f"/api/jobs/{w.id('j1')}/funnel").json() == {"error": "not_poster"}
    with browse(browser, p, f"/jobs/{w.id('j1')}/applicants") as page:
        region = page.get_by_role("region", name="Hiring funnel")
        loaded(page, region, "the funnel")
        text = region.inner_text()
        for line in ("Applied · 5 · 100%", "Viewed · 3 · 60%", "Interviewing · 2 · 67%", "Offered · 1 · 50%",
                     "Not selected · 2 (1 automatic)", "Withdrawn · 1", "Median time to first view: 45m"):
            assert line in text, line
        row = lambda s: region.locator(f"[data-stage='{s}']")
        assert row("viewed").get_attribute("data-rate") == "60" and row("withdrawn").get_attribute("data-rate") == ""
        assert region.locator("[data-median-first-view]").get_attribute("data-median-first-view") == "45"
        apply(w.m("f"), w.id("j1"))
        eventually(page, lambda: row("applied").get_attribute("data-count") == "6"
                   and row("viewed").get_attribute("data-rate") == "50", "the funnel to update live")


def test_wf_application_board_happy(app_url, browser):
    resume_limit = num(app_url, "PLAINWORK_RESUME_MAX_BYTES")
    t0 = server_now(app_url)
    w = _job_world(app_url, "p a", jobs=[job_spec(new_tag(), "j1", t0, closes_at=at(t0, 3600))])
    a, p, jid = w.m("a"), w.m("p"), w.id("j1")
    title = w.job("j1")["title"]
    with browse(browser, a, f"/jobs/{jid}") as pa:
        loaded(pa, btn(pa, "Apply"), "Apply")
        click(btn(pa, "Apply"))
        dialog = pa.get_by_role("dialog", name=f"Apply to {title}")
        files = dialog.get_by_label("Resume (PDF)")
        files.set_input_files({"name": "cv.txt", "mimeType": "text/plain", "buffer": b"not a pdf"})
        alerted(pa, "Upload a PDF file.")
        files.set_input_files({"name": "big.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes(resume_limit + 1)})
        alerted(pa, f"Resumes can be up to {resume_limit:,} bytes.")
        files.set_input_files({"name": "cv.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()})
        announced(pa, "Jobs announcements", "Resume attached.")
        click(btn(dialog, "Submit application"))
        announced(pa, "Jobs announcements", "Application submitted.")
        app_id = a.ok("GET", f"/api/jobs/{jid}")["my_application"]["id"]
        pa.goto(app_url + "/my-jobs")
        click(pa.get_by_role("tab", name="Applied"))
        item = pa.locator(f"[data-application-id='{app_id}']")
        loaded(pa, item, "the application")
        with browse(browser, p, f"/jobs/{jid}/applicants") as pp:
            name = w.name("a")
            loaded(pp, link(pp, name), "the board card")
            click(link(pp, name))
            shown(pp, pp.get_by_role("dialog", name=f"Application from {name}"), "the application dialog")
            pp.keyboard.press("Escape")
            for target in ("Interviewing", "Offered"):
                press(btn(pp, f"Move {name}"))
                press(pp.get_by_role("menuitem", name=f"Move to {target}"))
                announced(pp, "Jobs announcements", f"Moved {name} to {target}")
                eventually(pa, lambda t=target: item.get_attribute("data-state") == t.lower(), f"{target} live")
        announced(pa, "Jobs announcements", f"Your application for {title} is now: Offer extended.")
        clock_to(app_url, parse_ts(w.job("j1")["closes_at"]))
        pa.goto(app_url + f"/jobs/{jid}")
        shows_text(pa, "No longer accepting applications", seconds=LOAD_S + GRACE_S)
    assert a.ok("GET", f"/api/applications/{app_id}")["state"] == "offered"
    assert storage().keys(f"resumes/{a.id}/")


def test_wf_application_board_knockout(app_url, browser, mail):
    tag, t0 = new_tag(), server_now(app_url)
    w = _job_world(app_url, "p a", jobs=[job_spec(tag, "j1", t0, questions=[
        question("k1", "yes_no", knock_out=True, ideal="yes", text=f"Licensed {tag}?")])])
    a, jid = w.m("a"), w.id("j1")
    with browse(browser, a, f"/jobs/{jid}") as page:
        loaded(page, btn(page, "Apply"), "Apply")
        click(btn(page, "Apply"))
        dialog = page.get_by_role("dialog", name=f"Apply to {w.job('j1')['title']}")
        dialog.get_by_label("Resume (PDF)").set_input_files({"name": "cv.pdf", "mimeType": "application/pdf",
                                                             "buffer": pdf_bytes()})
        check(dialog.get_by_role("radiogroup", name=f"Licensed {tag}?").get_by_role("radio", name="No"))
        submit = btn(dialog, "Submit application")
        eventually(page, lambda: submit.is_enabled(), "resume confirmed")
        click(submit)
        announced(page, "Jobs announcements", "Application submitted.")
        page.goto(app_url + "/my-jobs")
        click(page.get_by_role("tab", name="Applied"))
        shows_text(page, "Not selected", seconds=LOAD_S + GRACE_S)
    funnel = w.m("p").ok("GET", f"/api/jobs/{jid}/funnel")
    assert [(r["stage"], r["count"]) for r in funnel["rows"]][4] == ("rejected", 1)
    mail_with(mail, w.email("a"), f"Update on your application for {w.job('j1')['title']}")


def _coedit_world(app_url: str) -> World:
    tag, t0 = new_tag(), server_now(app_url)
    return World(app_url, "p q r n a", tag=tag, companies=[company_spec(tag, "co", ["p", "q", "r"])],
                 jobs=[job_spec(tag, "j1", t0)])


def test_job_editor_presence_and_typing(app_url, browser):
    w = _coedit_world(app_url)
    path = f"/jobs/{w.id('j1')}/edit"
    with browse(browser, w.m("p"), path) as pp:
        status = pp.get_by_role("status", name="Editing now")
        eventually(pp, lambda: text_of(status) == "Only you are editing", "only you", LOAD_S + GRACE_S)
        with browse(browser, w.m("q"), path) as pq:
            eventually(pp, lambda: text_of(status) == f"{w.name('q')} is also editing", "q also editing")
            with browse(browser, w.m("r"), path) as pr:
                eventually(pp, lambda: text_of(status) == f"{w.name('q')} and {w.name('r')} are also editing", "two others")
                title = textbox(pq, "Title")
                loaded(pq, title, "q's title field")
                title.focus()
                pq.keyboard.type("x")
                note = field_note(pp, "title")
                eventually(pp, lambda: text_of(note) == f"{w.first('q')} is typing here", "the typing note")
                assert [e["id"] for e in w.m("p").ok("GET", f"/api/jobs/{w.id('j1')}/editor")["editing"]] == [w.id("q"), w.id("r")]
        eventually(pp, lambda: text_of(status) == "Only you are editing", "both to leave", PRESENCE_LEAVE_S + GRACE_S)
    assert w.m("n").get(f"/api/jobs/{w.id('j1')}/editor").status_code == 404


def test_field_level_job_saves(app_url, browser):
    w = _coedit_world(app_url)
    p, q, jid = w.m("p"), w.m("q"), w.id("j1")
    fields = p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]
    v = fields["title"]["version"]
    saved = p.ok("PATCH", f"/api/jobs/{jid}/fields/title", {"value": f"New {w.tag}", "version": v})
    assert saved == {"field": "title", "value": f"New {w.tag}", "version": v + 1}
    r = q.patch(f"/api/jobs/{jid}/fields/title", {"value": "Stale", "version": v})
    assert r.status_code == 409 and r.json() == {"error": "field_conflict", "field": "title", "current_version": v + 1,
                                                 "current": f"New {w.tag}", "by": {"id": p.id, "name": w.name("p")}}
    loc_v = fields["location"]["version"]
    assert q.ok("PATCH", f"/api/jobs/{jid}/fields/location", {"value": "Joliet, IL", "version": loc_v})["version"] == loc_v + 1
    r = q.patch(f"/api/jobs/{jid}/fields/closes_at", {"value": at(server_now(app_url), -60),
                                                      "version": fields["closes_at"]["version"]})
    assert r.status_code == 422 and r.json()["fields"]["closes_at"] == "Pick a closing time in the future."
    assert w.m("n").patch(f"/api/jobs/{jid}/fields/title", {"value": "x", "version": v + 1}).status_code == 404
    path = f"/jobs/{jid}/edit"
    with browse(browser, p, path) as pp, browse(browser, q, path) as pq:
        tp, tq = textbox(pp, "Title"), textbox(pq, "Title")
        loaded(pp, tp, "p title")
        loaded(pq, tq, "q title")
        fill(tp, f"Live {w.tag}")
        tp.press("Enter")
        announced(pp, "Jobs announcements", "Title saved.")
        eventually(pq, lambda: tq.input_value() == f"Live {w.tag}", "the saved value to replace q's field live")
        dq = textbox(pq, "Description")
        mine = "Mine wins"
        fill(dq, mine)
        cur = p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]["description"]
        p.ok("PATCH", f"/api/jobs/{jid}/fields/description", {"value": "Theirs", "version": cur["version"]})
        note = field_note(pq, "description")
        eventually(pq, lambda: text_of(note) == f"{w.first('p')} saved a new version", "the new-version note")
        assert dq.input_value() == mine
        pq.keyboard.press("Tab")
        alerted(pq, f"{w.name('p')} changed this field while you were editing.")
        click(btn(pq, "Keep mine"))
        eventually(None, lambda: p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]["description"]["value"] == mine,
                   "Keep mine to save over the current version")


def test_screening_builder_rules_and_reorder(app_url, browser):
    w = _coedit_world(app_url)
    p, jid = w.m("p"), w.id("j1")
    ver = p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]["questions"]["version"]
    q = lambda t, **kw: {k: v for k, v in question("x", t, **kw).items() if k != "key"}
    r = p.patch(f"/api/jobs/{jid}/fields/questions", {"version": ver, "value": [q("short_answer")] * (MAX_QUESTIONS + 1)})
    assert r.status_code == 422 and r.json() == {"error": "too_many_questions", "limit": MAX_QUESTIONS}
    bad = [q("short_answer", text=""), q("single_choice", options=["A"]), q("single_choice", options=["A", "a"]),
           q("yes_no", knock_out=True), q("single_choice", knock_out=True, options=["A", "B"], accepted=[]),
           q("number", knock_out=True), q("number", minimum=5, maximum=2)]
    r = p.patch(f"/api/jobs/{jid}/fields/questions", {"version": ver, "value": bad})
    assert r.status_code == 422 and r.json()["error"] == "validation"
    got = {(k.split(".")[1], m) for k, m in r.json()["fields"].items() if k.startswith("questions.")}
    for pos, message in (("1", "Write the question in 1 to 200 characters."), ("2", "Add at least two options."),
                         ("3", "Options must differ."), ("4", "Pick the ideal answer."), ("5", "Accept at least one option."),
                         ("6", "Set a minimum or a maximum."), ("7", "Minimum must not exceed maximum.")):
        assert (pos, message) in got, (pos, message)
    with browse(browser, p, f"/jobs/{jid}/edit") as page:
        region = page.get_by_role("region", name="Screening questions")
        loaded(page, btn(region, "Add question"), "Add question")
        for kind in ("Short answer", "Yes or no", "Number"):
            press(btn(region, "Add question"))
            press(page.get_by_role("menuitem", name=kind, exact=True))
            box = textbox(region, "Question text").last
            eventually(page, lambda b=box: has_focus(b), "focus in the new card's Question text")
            page.keyboard.type(f"{kind} {w.tag}")
            page.keyboard.press("Tab")
        cards = region.get_by_role("list", name="Questions").get_by_role("listitem")
        eventually(page, lambda: cards.count() == 3, "three cards")
        cards.nth(2).focus()
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Jobs announcements", "Question moved to position 2 of 3.")
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Jobs announcements", "Question moved to position 1 of 3.")
        eventually(page, lambda: cards.first.get_attribute("data-question-type") == "number", "number card first")
    eventually(None, lambda: [x["type"] for x in p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]["questions"]["value"]]
               == ["number", "short_answer", "yes_no"], "the reordered questions to be stored")
    saved = p.ok("GET", f"/api/jobs/{jid}/editor")["fields"]["questions"]
    apply(w.m("a"), jid, {x["id"]: (3 if x["type"] == "number" else "yes" if x["type"] == "yes_no" else "ok")
                          for x in saved["value"]})
    r = p.patch(f"/api/jobs/{jid}/fields/questions", {"version": saved["version"], "value": []})
    assert r.status_code == 409 and r.json() == {"error": "questions_locked"}


def test_wf_job_coedit_screening_conflict(app_url, browser):
    w = _coedit_world(app_url)
    jid, path = w.id("j1"), f"/jobs/{w.id('j1')}/edit"
    with browse(browser, w.m("p"), path) as pp, browse(browser, w.m("q"), path) as pq:
        eventually(pp, lambda: text_of(pp.get_by_role("status", name="Editing now")) == f"{w.name('q')} is also editing",
                   "presence", LOAD_S + GRACE_S)
        tp, tq = textbox(pp, "Title"), textbox(pq, "Title")
        fill(tq, f"Q {w.tag}")
        fill(tp, f"P {w.tag}")
        tp.press("Enter")
        announced(pp, "Jobs announcements", "Title saved.")
        tq.press("Enter")
        alerted(pq, f"{w.name('p')} changed this field while you were editing.")
        click(btn(pq, "Use theirs"))
        eventually(pq, lambda: tq.input_value() == f"P {w.tag}", "Use theirs replaces the text")
    assert w.m("p").ok("GET", f"/api/jobs/{jid}")["title"] == f"P {w.tag}"


def test_wf_job_coedit_screening_builder(app_url, browser):
    w = _coedit_world(app_url)
    jid = w.id("j1")
    with browse(browser, w.m("q"), f"/jobs/{jid}/edit") as page:
        region = page.get_by_role("region", name="Screening questions")
        loaded(page, btn(region, "Add question"), "Add question")
        for kind in ("Short answer", "Number", "Yes or no"):
            press(btn(region, "Add question"))
            press(page.get_by_role("menuitem", name=kind, exact=True))
            page.keyboard.type(f"{kind}?")
        cards = region.get_by_role("list", name="Questions").get_by_role("listitem")
        last = cards.nth(2)
        check(last.get_by_role("checkbox", name="Knock-out"))
        check(last.get_by_role("radiogroup", name="Ideal answer").get_by_role("radio", name="Yes"))
        last.focus()
        page.keyboard.press("Alt+ArrowUp")
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Jobs announcements", "Question moved to position 1 of 3.")
        eventually(page, lambda: cards.first.get_attribute("data-question-type") == "yes_no", "knock-out first")
    first = w.m("p").ok("GET", f"/api/jobs/{jid}/editor")["fields"]["questions"]["value"][0]
    assert first["type"] == "yes_no" and first["knock_out"] is True and first["ideal"] == "yes"
    with browse(browser, w.m("n"), f"/jobs/{jid}/edit") as page:
        loaded(page, page.get_by_role("heading", name="This profile isn't available").or_(
            page.get_by_role("heading", name="We couldn't find that page.")).or_(page.get_by_text("This post is no longer available.")),
            "the not-available page for a non-admin")
        assert textbox(page, "Title").count() == 0


def test_section_versions_and_conflict(app_url, browser):
    w = World(app_url, "o")
    o = w.m("o")
    versions = o.ok("GET", "/api/me")["versions"]
    v = versions["about"]
    saved = o.ok("PATCH", "/api/me/sections/about", {"version": v, "about": "First"})
    assert saved["section"] == "about" and saved["version"] == v + 1
    r = o.patch("/api/me/sections/about", {"version": v, "about": "Stale"})
    assert r.status_code == 409 and r.json()["error"] == "version_conflict" and r.json()["current_version"] == v + 1
    assert r.json()["current"]["about"] == "First"
    assert o.ok("GET", "/api/me")["versions"]["intro"] == versions["intro"]
    with browse(browser, o, f"/in/{w.handle('o')}") as page:
        for resolve in ("Load latest", "Save mine anyway"):
            loaded(page, btn(page, "Edit about"), "Edit about")
            click(btn(page, "Edit about"))
            dialog = page.get_by_role("dialog", name="Edit about")
            box = textbox(dialog, "About")
            shown(page, box, "the About box")
            cur = o.ok("GET", "/api/me")["versions"]["about"]
            o.ok("PATCH", "/api/me/sections/about", {"version": cur, "about": f"Elsewhere {resolve}"})
            fill(box, f"Mine {resolve}")
            click(btn(dialog, "Save"))
            alerted(page, "Someone changed this section since you opened it.")
            click(btn(dialog, resolve))
            if resolve == "Load latest":
                eventually(page, lambda: box.input_value() == "Elsewhere Load latest", "Load latest fills the form")
                click(btn(dialog, "Save"))
                announced(page, "Profile announcements", "Section saved.")
            else:
                announced(page, "Profile announcements", "Section saved.")
                eventually(None, lambda: o.ok("GET", "/api/me")["about"] == "Mine Save mine anyway", "mine saved on top")
            absent(page, dialog, "the dialog closes after saving")


def test_photo_uploads_strip_metadata(app_url, browser, page):
    limit = num(app_url, "PLAINWORK_PHOTO_MAX_BYTES")
    w = World(app_url, "a b")
    a, b = w.m("a"), w.m("b")
    marker = f"verify-{w.tag}".encode()
    jpg = jpeg_bytes(page)
    tagged = with_jpeg_metadata(jpg, marker)
    r = upload_photo(a, tagged, "photo.png", "image/png")
    assert r.status_code == 201 and r.json()["content_type"] == "image/jpeg"
    pid = r.json()["photo_id"]
    stored = storage().get(f"photos/{pid}.jpg")
    assert marker not in stored and not [m for m in jpeg_markers(stored)
                                         if JPEG_APP1 <= m <= JPEG_APP15 or m == JPEG_COMMENT]
    assert difference(decode(browser_png(page, jpg, "image/jpeg")), decode(browser_png(page, stored, "image/jpeg"))) == 0
    served = a.get(f"/media/photos/{pid}")
    assert served.status_code == 200 and served.headers["content-type"].startswith("image/jpeg") and served.content == stored
    assert b.get(f"/media/photos/{pid}").status_code == 404, "an unattached photo is visible only to its uploader"
    png = png_bytes(chunks=((b"tEXt", b"Comment\x00" + marker), (b"tIME", bytes(7)), (b"iTXt", b"k\x00\x00\x00\x00\x00" + marker),
                            (b"zTXt", b"k\x00\x00" + zlib.compress(marker)), (b"eXIf", b"MM\x00*" + marker)))
    r = upload_photo(a, png, "photo.jpg", "image/jpeg")
    assert r.status_code == 201 and r.json()["content_type"] == "image/png"
    stored_png = storage().get(f"photos/{r.json()['photo_id']}.png")
    assert not {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"} & set(png_chunk_types(stored_png))
    assert difference(decode(png_bytes()), decode(stored_png)) == 0
    assert upload_photo(a, b"GIF89a" + bytes(32), "x.gif", "image/gif").json() == {"error": "photo_type"}
    assert upload_photo(a, jpeg_padded(jpg, limit + 1), "x.jpg", "image/jpeg").json() == {"error": "photo_too_large",
                                                                                          "limit": limit}
    exact = upload_photo(a, jpeg_padded(jpg, limit), "x.jpg", "image/jpeg")
    assert exact.status_code == 201
    assert upload_photo(a, jpeg_padded(jpg, limit + MULTIPART_SLACK + 1024), "x.jpg", "image/jpeg").status_code == 413
    assert a.ok("PUT", "/api/me/photo", {"photo_id": pid}) == {"photo_url": f"/media/photos/{pid}"}
    assert b.get(f"/media/photos/{pid}").status_code == 200
    with browse(browser, a, "/feed") as pg:
        dialog, box = _open_composer(pg)
        fill(box, f"With photo {w.tag}")
        post = btn(dialog, "Post")
        with held(pg, "**/api/uploads/photo") as hold:
            dialog.get_by_label("Photo").set_input_files({"name": "p.png", "mimeType": "image/png", "buffer": png_bytes()})
            shows_text(pg, "Uploading…", scope=dialog)
            assert post.is_disabled(), "Post waits for the storage confirmation"
            hold.release()
        announced(pg, "Feed announcements", "Photo attached.")
        eventually(pg, lambda: post.is_enabled(), "Post enabled after confirmation")


def test_storage_outage_refuses_uploads_only(browser):
    base = outage_url()
    t0 = server_now(base)
    w = World(base, "a b c", connections=[conn("a", "b", t0)])
    a = w.m("a")
    r = upload_photo(a, png_bytes(), "p.png", "image/png")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    r = upload_resume(a)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    a.ok("POST", "/api/posts", {"text": f"Text works {w.tag}"}, 201, key=idempotency_key())
    conv = conversation_with(a, w.id("b"))
    a.ok("POST", f"/api/conversations/{conv}/messages", {"text": "still here"}, 201, key=idempotency_key())
    a.ok("POST", "/api/connections", {"member_id": w.id("c")}, 201)
    a.ok("PATCH", "/api/me/sections/about", {"version": a.ok("GET", "/api/me")["versions"]["about"], "about": "ok"})
    with browse(browser, a, "/feed") as page:
        dialog, _ = _open_composer(page)
        dialog.get_by_label("Photo").set_input_files({"name": "p.png", "mimeType": "image/png", "buffer": png_bytes()})
        alerted(page, "Uploads are unavailable right now. Try again later.")


def test_phone_layout_and_touch(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("a"), "/feed", size=PHONE) as page:
        tabs = page.get_by_role("navigation", name="Tabs")
        loaded(page, tabs, "the tab bar")
        assert [x.strip() for x in tabs.get_by_role("link").all_inner_texts()] == ["Home", "Network", "Post", "Messaging", "Jobs"]
        assert page.get_by_role("navigation", name="Primary").count() == 0
        assert visible(link(page, "Notifications")) and visible(link(page, "Me"))
        for target in tabs.get_by_role("link").all():
            box = target.bounding_box()
            assert box and box["width"] >= TOUCH_MIN and box["height"] >= TOUCH_MIN
        tap(link(tabs, "Post"))
        dialog = page.get_by_role("dialog", name="Create a post")
        shown(page, dialog, "the composer from the Post tab")
        box = box_of(dialog)
        assert box["width"] >= PHONE[0] - 1 and box["height"] >= PHONE[1] - 1, "dialogs fill the phone screen"
        page.keyboard.press("Escape")
        tap(link(tabs, "Messaging"))
        listing = page.get_by_role("list", name="Conversations")
        loaded(page, listing, "the conversation list")
        assert textbox(page, "Write a message").count() == 0
        tap(listing.get_by_role("link").first)
        back = btn(page, "Back to conversations")
        loaded(page, back, "the thread with its back button")
        assert not visible(listing)
        for control_el in page.get_by_role("button").all():
            if control_el.is_visible():
                b = control_el.bounding_box()
                assert b and b["width"] >= TOUCH_MIN and b["height"] >= TOUCH_MIN, "a button under 44 px"
        tap(back)
        shown(page, listing, "the list again")


def test_wf_profile_conflict_phone_about(app_url, browser):
    w = World(app_url, "o")
    o = w.m("o")
    with browse(browser, o, f"/in/{w.handle('o')}", size=PHONE) as phone, \
            browse(browser, w.fresh("o"), f"/in/{w.handle('o')}") as laptop:
        for page in (phone, laptop):
            loaded(page, btn(page, "Edit about"), "Edit about")
            if page is phone:
                tap(btn(page, "Edit about"))
            else:
                click(btn(page, "Edit about"))
        fill(textbox(laptop.get_by_role("dialog", name="Edit about"), "About"), "Laptop")
        click(btn(laptop.get_by_role("dialog", name="Edit about"), "Save"))
        announced(laptop, "Profile announcements", "Section saved.")
        pd = phone.get_by_role("dialog", name="Edit about")
        fill(textbox(pd, "About"), "Phone")
        tap(btn(pd, "Save"))
        alerted(phone, "Someone changed this section since you opened it.")
        tap(btn(pd, "Save mine anyway"))
        announced(phone, "Profile announcements", "Section saved.")
    assert o.ok("GET", "/api/me")["about"] == "Phone"


def test_wf_profile_conflict_phone_message(app_url, browser):
    w, conv = _thread_world(app_url)
    with browse(browser, w.m("a"), "/feed", size=PHONE) as page:
        tap(link(page.get_by_role("navigation", name="Tabs"), "Messaging"))
        tap(page.get_by_role("list", name="Conversations").get_by_role("link").first)
        box = textbox(page, "Write a message")
        loaded(page, box, "box")
        tap(box)
        page.keyboard.type("by touch")
        tap(btn(page, "Send"))
        announced(page, "Messaging announcements", "Message sent.")
    assert messages_of(w.m("a"), conv)[-1]["text"] == "by touch"


def test_wf_profile_conflict_phone_outage(browser):
    base = outage_url()
    w = World(base, "a")
    a = w.m("a")
    with browse(browser, a, "/feed") as page:
        dialog, box = _open_composer(page)
        dialog.get_by_label("Photo").set_input_files({"name": "p.png", "mimeType": "image/png", "buffer": png_bytes()})
        alerted(page, "Uploads are unavailable right now. Try again later.")
        if visible(btn(dialog, "Remove photo")):
            click(btn(dialog, "Remove photo"))
        fill(box, f"Text only {w.tag}")
        click(btn(dialog, "Post"))
        announced(page, "Feed announcements", "Post published.")
    assert any(e["post"]["text"] == f"Text only {w.tag}" for e in feed_all(a))


VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}


VIEWPORT_IDS = ["phone", "tablet", "desktop"]


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_published_breakpoints(app_url, browser, viewport):
    size = VIEWPORTS[viewport]
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "p a o", tag=tag, companies=[company_spec(tag, "co", ["p"])], jobs=[job_spec(tag, "j1", t0)],
              profiles={"o": {"skills": ["Rigging"], "experience": [{"title": f"Rigger {tag}", "company": "Yard",
                                                                     "start": "2020-01", "end": None}]}},
              connections=[conn("p", "a", t0), conn("p", "o", t0)],
              messages=[{"from": "a", "to": "p", "text": "hi", "at": at(t0, -60), "read_at": None}])
    p = w.m("p")
    conv = p.ok("GET", "/api/conversations")["conversations"][0]["id"]
    with browse(browser, p, "/feed", size=size) as page:
        loaded(page, btn(page, "Start a post"), "the feed")
        assert visible(page.get_by_role("complementary", name="Your network")) == (viewport == "desktop")
        layout(page)
        page.goto(app_url + f"/in/{w.handle('o')}")
        skills = page.get_by_role("region", name="Skills")
        loaded(page, skills, "skills")
        about, exp = box_of(page.get_by_text(f"About {tag} o")), box_of(page.get_by_text(f"Rigger {tag}"))
        sk = box_of(skills)
        if viewport == "desktop":
            assert sk["x"] > about["x"] and sk["y"] < exp["y"], "Skills sits in the right column level with About"
        else:
            assert sk["y"] >= exp["y"] + exp["height"] - 1, "one column: Skills after Experience"
        layout(page)
        page.goto(app_url + f"/messaging/{conv}")
        log = page.get_by_role("log", name="Messages")
        loaded(page, log, "the thread")
        listing = page.get_by_role("list", name="Conversations")
        if viewport == "phone":
            assert not visible(listing) and visible(btn(page, "Back to conversations"))
        else:
            eventually(page, lambda: visible(listing) and box_of(listing)["x"] < box_of(log)["x"], "list beside thread")
        layout(page)
        page.goto(app_url + f"/jobs/{w.id('j1')}/applicants")
        cols = [page.get_by_role("list", name=label, exact=True) for label in STAGE_LABELS]
        loaded(page, cols[0], "the board")
        boxes = [box_of(c) for c in cols]
        if viewport == "desktop":
            assert all(b["y"] < min(x["y"] + x["height"] for x in boxes) for b in boxes)
            assert [b["x"] for b in boxes] == sorted(b["x"] for b in boxes)
        elif viewport == "tablet":
            top, bottom = boxes[:3], boxes[3:]
            assert max(b["y"] for b in top) < min(b["y"] for b in bottom)
            assert [b["x"] for b in top] == sorted(b["x"] for b in top)
        else:
            assert all(boxes[i + 1]["y"] >= boxes[i]["y"] + boxes[i]["height"] - 1 for i in range(5))
        layout(page)


def test_dialogs_and_menus_keep_focus(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a", posts=[post_spec("pp", "a", "mine", t0)])
    with browse(browser, w.m("a"), "/feed") as page:
        dialog, box = _open_composer(page)
        eventually(page, lambda: has_focus(box), "focus on the first field")
        page.keyboard.press("Shift+Tab")
        assert focus_within(dialog), "Shift+Tab from the first control stays inside"
        for _ in range(8):
            page.keyboard.press("Tab")
            assert focus_within(dialog), "Tab left the open dialog"
        page.keyboard.press("Escape")
        absent(page, dialog, "Escape closes the composer")
        eventually(page, lambda: has_focus(btn(page, "Start a post")), "focus back on Start a post")
        actions = btn(article(page, w.id("pp")), "Post actions")
        press(actions)
        menu = page.get_by_role("menu")
        shown(page, menu, "the post menu")
        page.keyboard.press("ArrowDown")
        assert focus_within(menu)
        page.keyboard.press("Escape")
        absent(page, menu, "Escape closes the menu")
        assert has_focus(actions)
        actions.focus()
        page.keyboard.type("?")
        shortcuts = page.get_by_role("dialog", name="Keyboard shortcuts")
        shown(page, shortcuts, "shortcuts dialog")
        for _ in range(4):
            page.keyboard.press("Tab")
            assert focus_within(shortcuts)
        page.keyboard.press("Escape")
        eventually(page, lambda: has_focus(actions), "focus back on the opener")


ANNOUNCE_CASES = ["post_published", "post_failed", "post_updated", "post_deleted", "comment_posted",
                  "comment_failed", "comment_deleted", "reposted"]


@pytest.mark.parametrize("case", ANNOUNCE_CASES, ids=ANNOUNCE_CASES)
def test_live_region_announcements(app_url, browser, case):
    tag, t0 = new_tag(), server_now(app_url)
    w = World(app_url, "a b", tag=tag, connections=[conn("a", "b", t0)],
              posts=[post_spec("pa", "a", f"Mine {tag}", t0, -60), post_spec("pb", "b", f"Theirs {tag}", t0, -120)],
              comments=[{"key": "ca", "post": "pb", "author": "a", "parent": None, "text": "mine", "at": at(t0, -30)}])
    a = w.m("a")
    pub, pubfail, upd, dele, cpost, cfail, cdel, rep = ANNOUNCE_CASES
    path = f"/posts/{w.id('pb')}" if case == cdel else "/feed"
    with browse(browser, a, path) as page:
        if case in (pub, pubfail):
            if case == pubfail:
                page.route("**/api/posts", lambda r: r.abort() if r.request.method == "POST" else r.fallback())
            dialog, box = _open_composer(page)
            fill(box, f"Hello {tag}")
            click(btn(dialog, "Post"))
            announced(page, "Feed announcements", "Post published." if case == pub else "Post not published.")
            assert any(e["post"]["text"] == f"Hello {tag}" for e in feed_all(a)) == (case == pub)
        elif case in (upd, dele):
            art = article(page, w.id("pa"))
            loaded(page, btn(art, "Post actions"), "Post actions")
            press(btn(art, "Post actions"))
            press(page.get_by_role("menuitem", name="Edit post" if case == upd else "Delete post"))
            if case == upd:
                dialog = page.get_by_role("dialog", name="Edit post")
                fill(dialog.get_by_role("textbox").first, "Changed")
                click(btn(dialog, "Save changes"))
                announced(page, "Feed announcements", "Post updated.")
                assert a.ok("GET", f"/api/posts/{w.id('pa')}")["text"] == "Changed"
            else:
                click(btn(page.get_by_role("dialog", name="Delete post?"), "Delete"))
                announced(page, "Feed announcements", "Post deleted.")
                assert a.get(f"/api/posts/{w.id('pa')}").status_code == 404
        elif case in (cpost, cfail):
            if case == cfail:
                page.route("**/api/posts/*/comments", lambda r: r.abort() if r.request.method == "POST" else r.fallback())
            art = article(page, w.id("pb"))
            loaded(page, btn(art, "Comment"), "Comment")
            click(btn(art, "Comment"))
            fill(textbox(art, "Add a comment"), f"Said {tag}")
            click(btn(art, "Post comment"))
            announced(page, "Feed announcements", "Comment posted." if case == cpost else "Comment not posted.")
            assert any(c.get("text") == f"Said {tag}" for c in comments_of(a, w.id("pb"))) == (case == cpost)
        elif case == cdel:
            loaded(page, btn(page, "Delete comment"), "Delete comment")
            click(btn(page, "Delete comment"))
            announced(page, "Feed announcements", "Comment deleted.")
            assert comments_of(a, w.id("pb")) == []
        else:
            art = article(page, w.id("pb"))
            loaded(page, btn(art, "Repost"), "Repost")
            press(btn(art, "Repost"))
            press(page.get_by_role("menuitem", name="Repost", exact=True))
            announced(page, "Feed announcements", "Reposted.")
            assert a.ok("GET", f"/api/posts/{w.id('pb')}")["repost_count"] == 1


EMPTY_CASES = {
    "empty_feed": ("/feed", None, "Your feed is empty.", "Find people"),
    "empty_inbox": ("/messaging", None, "No conversations yet.", "Go to My network"),
    "no_notifications": ("/notifications", None, "No notifications yet.", "Go to Home"),
    "no_invitations": ("/network", None, "No pending invitations.", "Search for people"),
    "no_saved_jobs": ("/my-jobs", "Saved", "No saved jobs yet.", "Search jobs"),
    "no_applications": ("/my-jobs", "Applied", "No applications yet.", "Search jobs"),
    "no_blocked": ("/settings", None, "You haven't blocked anyone.", None),
    "no_search_results": ("/search?type=people&q=zz{tag}", None, "No results for “zz{tag}”", "Clear search"),
    "unknown_address": ("/no-such-page-{tag}", None, "We couldn't find that page.", "Go to Home"),
    "unavailable_profile": ("/in/{private}", None, "This profile isn't available", "Go to Home"),
    "unavailable_post": ("/posts/{deleted}", None, "This post is no longer available.", "Go to Home"),
}


@pytest.mark.parametrize("case", list(EMPTY_CASES), ids=list(EMPTY_CASES))
def test_empty_and_not_found_states(app_url, browser, case):
    path, tab, sentence, action = EMPTY_CASES[case]
    t0 = server_now(app_url)
    w = World(app_url, "a x", profiles={"x": {"visibility": "private"}}, posts=[post_spec("px", "x", "gone", t0)])
    w.m("x").ok("DELETE", f"/api/posts/{w.id('px')}", status=204)
    fmt = {"tag": w.tag, "private": w.handle("x"), "deleted": w.id("px")}
    with browse(browser, w.m("a"), path.format(**fmt)) as page:
        if tab:
            loaded(page, page.get_by_role("tab", name=tab), "the tab")
            click(page.get_by_role("tab", name=tab))
        target = sentence.format(**fmt)
        loc = page.get_by_role("heading", name=target, exact=True).or_(page.get_by_text(target, exact=True))
        loaded(page, loc, f"the sentence {target!r}")
        if action:
            act = link(page, action)
            shown(page, act, f"the action {action!r}")
            assert "underline" in style(act.first, "text-decoration-line")["text-decoration-line"]


def test_reduced_motion_end_states(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0, "pending", -60)])
    with browse(browser, w.m("a"), f"/in/{w.handle('b')}", reduced_motion="reduce") as page:
        eventually(page, lambda: degree_of(page)[0] == "out" or degree_of(page)[0] in {"2", "3"}, "initial degree",
                   LOAD_S + GRACE_S)
        w.m("b").ok("POST", f"/api/connections/{w.id('a')}/accept")
        eventually(None, lambda: degree_of(page)[:2] == ("1", "1"), "the numeral to swap to 1")
        eventually(None, lambda: visible(control(page, "Message")), "Message without waiting for a roll")
        assert animations(page.locator("[data-degree-roll]").first) == []
        announced(page, "Network announcements", f"You are now connected with {w.name('b')}. 1st degree.")
        page.goto(app_url + "/feed")
        dialog, _ = _open_composer(page)
        assert animations(dialog) == [], "dialogs open without a fade under reduced motion"


def test_bundled_assets_same_origin(app_url, browser):
    w = World(app_url, "a")
    seen: list[tuple[str, str]] = []
    record = lambda p: p.on("request", lambda r: seen.append((r.url, r.resource_type)))
    with browse(browser, w.m("a"), "/feed", before=record) as page:
        loaded(page, btn(page, "Start a post"), "feed")
        page.goto(app_url + f"/in/{w.handle('a')}")
        loaded(page, btn(page, "Sign out"), "profile")
        families = page.evaluate("async () => { await document.fonts.ready; return [...document.fonts]"
                                 ".filter(f => f.status === 'loaded').map(f => f.family.replace(/[\"']/g, '')); }")
    with anonymous(browser, app_url, "/") as landing:
        landing.on("request", lambda r: seen.append((r.url, r.resource_type)))
        landing.reload()
        loaded(landing, landing.get_by_role("heading", name="Plainwork", level=1).or_(
            landing.get_by_role("heading", level=1)), "landing")
    offsite = [u for u, _ in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(app_url))]
    assert offsite == [], f"requests to other origins: {offsite[:5]}"
    assert any(t == "font" for _, t in seen), "fonts must be served by the app"
    assert "Funnel Display" in families and "Funnel Sans" in families


APP = Path("/app")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "mongodb", "mongoose", "level", "lowdb",
                      "nedb", "lmdb", "@libsql/client", "sql.js"}


def test_if_run_manifest():
    data = json.loads((APP / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"} and all(isinstance(v, str) for v in data.values())
    assert data["_schema"] == "run-manifest-v1" and "npm ci" in data["install"]
    assert (APP / "package-lock.json").is_file()


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or str(p.version) not in notices]
    assert not missing, f"packages missing from notices: {missing[:10]}"
    assert "Funnel Display" in notices and "Funnel Sans" in notices
    assert re.search(r"Open Font Licen[cs]e|OFL", notices)


def test_if_licences_allowed():
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:10]}"
    assert re.search(r"OFL-1\.1|Open Font Licen[cs]e", (APP / "THIRD_PARTY_NOTICES.md").read_text())


def test_if_state_only_in_provided_stores():
    names = {p.name for p in shipped_packages()}
    assert not names & DATASTORE_PACKAGES, sorted(names & DATASTORE_PACKAGES)
    files = [f for f in DEPLOYED_APP.rglob("*") if "node_modules" not in f.parts and f.suffix in {".sqlite", ".db", ".sqlite3"}]
    assert not files, files[:5]
    assert database().tables(), "the app keeps no tables in the provided PostgreSQL"


def test_if_service_config_untouched():
    assert isinstance(storage().keys(), list) and database().tables()
    trajectory = Path("/logs/agent/trajectory.json")
    if trajectory.is_file():
        found: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                for key in ("file_path", "path"):
                    value = node.get(key)
                    if isinstance(value, str) and re.search(r"(docker-)?compose[^/]*\.ya?ml$", value):
                        found.append(value)
                for child in node.values():
                    walk(child)
            elif isinstance(node, list):
                for child in node:
                    walk(child)

        walk(json.loads(trajectory.read_text()))
        assert not found, f"the agent touched service compose files: {found[:3]}"


CONFIG_JS = re.compile(r"(^\.|\.config\.(c|m)?js$|rc\.(c|m)?js$)")


def _plain_js(root: Path) -> list[str]:
    """Hand-written JavaScript under root: not tool configuration, build tooling or build output (IF rule on TypeScript).

    Build tooling: a file run by package.json scripts or run.json, or kept under a top-level scripts/ or tools/.
    Build output: under a tsconfig outDir, compiled from a .ts/.tsx of the same name, or beside such a file (bundler chunks).
    """
    cmds = ""
    for name in ("package.json", "run.json"):
        if (root / name).is_file():
            data = json.loads((root / name).read_text())
            cmds += " " + " ".join(map(str, (data.get("scripts") or {}).values() if name == "package.json" else data.values()))
    outs = []
    for tc in [*root.glob("tsconfig*.json"), *root.glob("*/tsconfig*.json")]:
        out = re.search(r'"outDir"\s*:\s*"([^"]+)"', tc.read_text())
        if out:
            outs.append((tc.parent / out.group(1)).resolve())
    files = [p for p in root.rglob("*") if p.is_file() and not {"node_modules", ".git", "coverage"} & set(p.relative_to(root).parts)]
    stems = {p.stem for p in files if p.suffix in (".ts", ".tsx")}
    js = [p for p in files if p.suffix in (".js", ".mjs", ".cjs", ".jsx") and not re.search(r"(^\.|\.config\.(c|m)?js$|rc\.(c|m)?js$)", p.name)]
    built_dirs = {p.parent for p in js if p.stem in stems}

    def exempt(p: Path) -> bool:
        rel = p.relative_to(root)
        return (rel.as_posix() in cmds or p.name in cmds or rel.parts[0] in ("scripts", "tools")
                or any(o == p.resolve() or o in p.resolve().parents for o in outs)
                or p.stem in stems or p.parent in built_dirs)
    return [p.relative_to(root).as_posix() for p in js if not exempt(p)]


def test_if_typescript_sources():
    sources = [f for f in APP.rglob("*") if f.is_file() and not {"node_modules", ".git"} & set(f.parts)]
    js = _plain_js(APP)
    assert not js, f"plain JavaScript application files: {js[:5]}"
    assert any(f.suffix in {".ts", ".tsx"} for f in sources)


def test_if_fonts_bundled():
    fonts = [f.name.lower() for ext in ("*.woff2", "*.woff", "*.ttf", "*.otf") for f in DEPLOYED_APP.rglob(ext)]
    squashed = [re.sub(r"[^a-z]", "", n) for n in fonts]
    assert any("Funnel Display".lower().replace(" ", "") in n for n in squashed), "no bundled Funnel Display file"
    assert any("Funnel Sans".lower().replace(" ", "") in n for n in squashed), "no bundled Funnel Sans file"


def test_wf_withdraw_cooldown_live_receiver(app_url, browser):
    tz = zone(app_url)
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0, "pending", -60)])
    a, b = w.m("a"), w.m("b")
    with browse(browser, b, "/network") as pb, \
            browse(browser, a, f"/search?type=people&q={quote(w.name('b'))}") as pa:
        invite = member_item(pb, pb.get_by_role("list", name="Invitations"), a.id)
        loaded(pb, invite, "a's invitation in b's open My network")
        card = member_item(pa, pa, b.id)
        withdraw = btn(card, f"Withdraw request to {w.name('b')}")
        loaded(pa, withdraw, "Withdraw request on b's search card")
        press(withdraw)
        announced(pa, "Network announcements", "Invitation withdrawn.")
        absent(pb, invite, "the withdrawn invitation to leave b's open My network")
        connect = btn(card, f"Connect with {w.name('b')}")
        shown(pa, connect, "Connect with b on the card after withdrawing")
        refused = a.post("/api/connections", {"member_id": b.id})
        assert refused.status_code == 409 and refused.json()["error"] == "invite_cooldown", refused.text[:200]
        retry = parse_ts(refused.json()["retry_at"])
        press(connect)
        alerted(pa, f"You withdrew an invitation to {w.name('b')}. You can invite them again on "
                    f"{fmt_date(retry, tz)} at {fmt_time(retry, tz)}.")
    assert state_of(a, w.handle("b")) == "withdrawn"


def test_wf_block_vanish_search_and_settings(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0)])
    a, b = w.m("a"), w.m("b")
    query_b, query_a = w.name("b"), w.name("a")
    with browse(browser, a, f"/search?type=people&q={quote(query_b)}") as page:
        loaded(page, member_item(page, page, b.id), "b in a's people search before the block")
        page.goto(app_url + f"/in/{w.handle('b')}")
        loaded(page, btn(page, "More actions"), "More actions on b's profile")
        press(btn(page, "More actions"))
        press(page.get_by_role("menuitem", name=f"Block {w.name('b')}", exact=True))
        press(btn(page.get_by_role("dialog", name=f"Block {w.name('b')}?"), "Block"))
        announced(page, "Network announcements", f"You blocked {w.name('b')}.")
        eventually(page, lambda: has_focus(link(page, "Manage blocked members")), "focus on Manage blocked members")
        page.goto(app_url + f"/search?type=people&q={quote(query_b)}")
        announced(page, "Search results", f"No results for “{query_b}”", LOAD_S + GRACE_S)
        assert page.locator(f"[data-member-id='{b.id}']").count() == 0
        page.goto(app_url + "/settings")
        loaded(page, btn(page, f"Unblock {w.name('b')}"), "b listed with Unblock in Settings")
    with browse(browser, b, f"/search?type=people&q={quote(query_a)}") as page:
        announced(page, "Search results", f"No results for “{query_a}”", LOAD_S + GRACE_S)
        assert page.locator(f"[data-member-id='{a.id}']").count() == 0


def test_block_drops_degree_through_bridge_live(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "b c d", connections=[conn("c", "b", t0), conn("b", "d", t0)])
    b, c = w.m("b"), w.m("c")
    with browse(browser, c, f"/in/{w.handle('d')}") as page:
        eventually(page, lambda: degree_of(page) == ("2", "2", "2", "2nd"), "d at 2nd for c", LOAD_S + GRACE_S)
        b.ok("POST", "/api/blocks", {"member_id": c.id}, status=201)
        eventually(page, lambda: degree_of(page) == ("out", "—", "out", "Out of network"),
                   "c's open profile of d to drop to Out of network live")
    assert profile(c, w.handle("d"))["degree"] == "out"


def test_invitation_focus_and_double_accept(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v a b c d", connections=[conn("a", "v", t0, "pending", -600), conn("b", "v", t0, "pending", -1200),
                                                 conn("c", "v", t0, "pending", -1800), conn("d", "v", t0, "pending", -2400)])
    v = w.m("v")
    key_of = {w.id(k): k for k in "abcd"}
    with browse(browser, v, "/network") as page:
        invitations = page.get_by_role("list", name="Invitations")
        loaded(page, member_item(page, invitations, w.id("a")), "the invitations")
        order = [key_of[i] for i in invitations.get_by_role("listitem").evaluate_all(
            "els => els.map(e => e.getAttribute('data-member-id'))")]
        first, second, third, last = order
        press(btn(invitations, f"Accept {w.name(first)}"))
        eventually(page, lambda: has_focus(btn(invitations, f"Accept {w.name(second)}")), "focus on the next Accept")
        btn(invitations, f"Ignore {w.name(last)}").focus()
        w.m(third).ok("POST", f"/api/connections/{v.id}/withdraw")
        absent(page, member_item(page, invitations, w.id(third)), "the withdrawn invitation to leave live")
        assert has_focus(btn(invitations, f"Ignore {w.name(last)}")), "a live change must not move focus"
        press(btn(invitations, f"Ignore {w.name(last)}"))
        eventually(page, lambda: has_focus(btn(invitations, f"Ignore {w.name(second)}")), "focus back on the one before")
        press(btn(invitations, f"Ignore {w.name(second)}"))
        eventually(page, lambda: has_focus(page.get_by_role("heading", name="Invitations", exact=True)), "focus on the heading")
    x = World(app_url, "s r", tag=w.tag + "x", connections=[conn("s", "r", t0, "pending", -60)])
    sessions = [x.fresh("r"), x.fresh("r")]
    gate = threading.Barrier(2)

    def accept(m: Member) -> int:
        gate.wait()
        return m.post(f"/api/connections/{x.id('s')}/accept").status_code

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(accept, sessions)) == [200, 409]
    assert [c["id"] for c in x.m("r").ok("GET", "/api/network")["connections"]] == [x.id("s")]


def _path_items(page: Page) -> list[str]:
    region = page.get_by_role("region", name="How you're connected")
    return [t.strip() for t in region.get_by_role("list", name="Connection path").get_by_role("listitem").all_inner_texts()]


def test_connection_path_reroutes_live(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v a b x", connections=[conn("v", "a", t0), conn("v", "b", t0), conn("a", "x", t0), conn("b", "x", t0)])
    near, far = sorted("ab", key=lambda k: w.name(k).lower())
    v = w.m("v")
    assert [p["id"] for p in v.ok("GET", f"/api/profiles/{w.handle('x')}/path")["path"]] == [w.id(near)]
    with browse(browser, v, f"/in/{w.handle('x')}") as page:
        eventually(page, lambda: _path_items(page) == [w.name(near)], "the path through the first name", LOAD_S + GRACE_S)
        href = page.get_by_role("list", name="Connection path").get_by_role("link", name=w.name(near))
        assert (href.get_attribute("href") or "").endswith(f"/in/{w.handle(near)}")
        w.m(near).ok("DELETE", f"/api/connections/{w.id('x')}")
        eventually(page, lambda: _path_items(page) == [w.name(far)], "the path to re-route live")
        announced(page, "Network announcements", "Connection path changed.")
        w.m("x").ok("DELETE", f"/api/connections/{w.id(far)}")
        absent(page, page.get_by_role("region", name="How you're connected"), "the path to leave at degree out")
    assert v.ok("GET", f"/api/profiles/{w.handle('x')}/path")["path"] == []


def test_connection_path_private_and_blocks(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v a p b x", profiles={"p": {"visibility": "private"}},
              connections=[conn("v", "a", t0), conn("a", "p", t0), conn("p", "x", t0), conn("v", "b", t0), conn("b", "a", t0)])
    v = w.m("v")
    path = v.ok("GET", f"/api/profiles/{w.handle('x')}/path")["path"]
    assert path[0]["id"] == w.id("a") and path[1] == {"private": True}
    with browse(browser, v, f"/in/{w.handle('x')}") as page:
        eventually(page, lambda: _path_items(page) == [w.name("a"), "Private member"], "the private hop", LOAD_S + GRACE_S)
        assert page.get_by_role("list", name="Connection path").get_by_role("link").count() == 1
        v.ok("POST", "/api/blocks", {"member_id": w.id("a")}, 201)
        absent(page, page.get_by_role("region", name="How you're connected"), "no path once the only route is blocked")


def test_feed_more_focus_and_back_restores_place(app_url, browser):
    size = num(app_url, "PLAINWORK_FEED_PAGE_SIZE")
    t0 = server_now(app_url)
    w = World(app_url, "v c", connections=[conn("v", "c", t0)],
              posts=[post_spec(f"p{i}", "c", f"p{i}", t0, -60 * (i + 2)) for i in range(size * 3)])
    with browse(browser, w.m("v"), "/feed") as page:
        loaded(page, article(page, w.id("p0")), "feed")
        press(btn(page, "Show more posts"))
        eventually(page, lambda: len(article_ids(page)) == size * 2, "the second page")
        eventually(page, lambda: has_focus(article(page, w.id(f"p{size}"))), "focus on the first loaded entry")
        ids = article_ids(page)
        target = w.id(f"p{size + 1}")
        anchor = article(page, target).locator("time")
        anchor.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
        y = page.evaluate("() => window.scrollY")
        click(anchor)
        eventually(page, lambda: page.url.endswith(f"/posts/{target}"), "the post page")
        page.go_back()
        eventually(page, lambda: article_ids(page) == ids, "the same loaded entries", LOAD_S + GRACE_S)
        eventually(page, lambda: abs(page.evaluate("() => window.scrollY") - y) <= 2, "the same scroll position")
        eventually(page, lambda: has_focus(article(page, target)), "focus on the entry that was left")


def test_feed_focused_entry_deleted_live(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "v c", connections=[conn("v", "c", t0)],
              posts=[post_spec(f"p{i}", "c", f"p{i}", t0, -60 * (i + 2)) for i in range(3)])
    c = w.m("c")
    with browse(browser, w.m("v"), "/feed") as page:
        loaded(page, article(page, w.id("p2")), "feed")
        article(page, w.id("p1")).focus()
        c.ok("DELETE", f"/api/posts/{w.id('p1')}", status=204)
        absent(page, article(page, w.id("p1")), "the deleted entry")
        eventually(page, lambda: has_focus(article(page, w.id("p2"))), "focus on the entry that followed")
        announced(page, "Feed announcements", "Post removed.")
        c.ok("DELETE", f"/api/posts/{w.id('p2')}", status=204)
        absent(page, article(page, w.id("p2")), "the last entry")
        eventually(page, lambda: has_focus(article(page, w.id("p0"))), "focus on the one before")


def test_featured_stale_reorder_and_drag(app_url, browser):
    w = World(app_url, "o", profiles={"o": {"skills": [SK_A, SK_B, SK_G], "featured": [SK_A, SK_B, SK_G]}})
    o, other = w.m("o"), w.fresh("o")
    stored = lambda: [s["name"] for s in profile(other, w.handle("o"))["skills"]]
    fired: list[int] = []

    def newer_save_first(route: Any) -> None:
        if route.request.method == "PATCH" and fired:
            fired.clear()
            version = other.ok("GET", "/api/me")["versions"]["skills"]
            other.ok("PATCH", "/api/me/sections/skills", {"version": version, "skills": [SK_A, SK_B, SK_G],
                                                          "featured": [SK_A, SK_B, SK_G]})
        route.continue_()

    with browse(browser, o, f"/in/{w.handle('o')}") as page:
        page.route("**/api/me/sections/skills", newer_save_first)
        featured = page.get_by_role("listbox", name="Featured skills")
        option = lambda name: featured.get_by_role("option", name=name, exact=True)
        loaded(page, option(SK_A), "the featured listbox")
        target = option(SK_G)
        box = box_of(target)
        option(SK_A).drag_to(target, target_position={"x": box["width"] / 2, "y": box["height"] - 2})
        eventually(page, lambda: stored() == [SK_B, SK_G, SK_A], "the dragged order to be stored")
        fired.append(1)
        option(SK_G).focus()
        page.keyboard.press("Alt+ArrowUp")
        alerted(page, "Your skills changed somewhere else. This order wasn't saved.")
        eventually(page, lambda: [t.strip() for t in featured.get_by_role("option").all_inner_texts()] == [SK_A, SK_B, SK_G],
                   "the stored order back on screen")
        eventually(page, lambda: has_focus(option(SK_G)), "focus on the moved skill")


def test_mention_inside_text_keeps_the_rest(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "a b", connections=[conn("a", "b", t0)])
    with browse(browser, w.m("a"), "/feed") as page:
        dialog, box = _open_composer(page)
        box.focus()
        page.keyboard.type("\U0001F600 hello  world")
        for _ in range(6):
            page.keyboard.press("ArrowLeft")
        page.keyboard.type(f"@{w.tag}")
        options = page.get_by_role("listbox", name="Mention suggestions").get_by_role("option")
        shown(page, options.first, "the suggestions")
        page.keyboard.press("Enter")
        expected = f"\U0001F600 hello @{w.handle('b')}  world"
        eventually(page, lambda: box.input_value() == expected, "only the fragment replaced")
        page.keyboard.type("z")
        eventually(page, lambda: box.input_value() == f"\U0001F600 hello @{w.handle('b')} z world", "the caret after the space")
        click(btn(dialog, "Post"))
        absent(page, dialog, "the composer closing")
    entries = w.m("a").ok("GET", "/api/feed")["entries"]
    assert [m["member_id"] for m in entries[0]["post"]["mentions"]] == [w.id("b")]


def test_comment_send_failure_keeps_text_then_one_comment(app_url, browser):
    t0 = server_now(app_url)
    w = World(app_url, "o v", connections=[conn("o", "v", t0)], posts=[post_spec("pp", "o", f"Fail {new_tag()}", t0)])
    v, pid = w.m("v"), w.id("pp")
    armed = [1]

    def fail_once(route: Any) -> None:
        if route.request.method == "POST" and armed:
            armed.clear()
            route.abort()
        else:
            route.continue_()

    with browse(browser, v, "/feed") as page:
        page.route("**/api/posts/*/comments", fail_once)
        entry = article(page, pid)
        loaded(page, btn(entry, "Comment"), "Comment")
        press(btn(entry, "Comment"))
        box = textbox(entry, "Add a comment")
        loaded(page, box, "the comment box")
        fill(box, "kept text")
        click(btn(entry, "Post comment"))
        alerted(page, "Something went wrong. Try again.")
        eventually(page, lambda: box.input_value() == "kept text" and has_focus(box), "the text and focus kept")
        click(btn(entry, "Post comment"))
        eventually(page, lambda: len(comments_of(v, pid)) == 1, "one stored comment")
    assert [c["text"] for c in comments_of(v, pid)] == ["kept text"]


def test_board_move_meets_newer_move(app_url, browser):
    t0 = server_now(app_url)
    w = _job_world(app_url, "p a", applications=[{"key": "ap0", "job": "j1", "applicant": "a", "state": "applied", "at": at(t0, -3600)}])
    other = w.fresh("p")
    aid = w.id("ap0")

    def newer_move_first(route: Any) -> None:
        if route.request.method == "POST" and not moved:
            moved.append(1)
            other.ok("POST", f"/api/applications/{aid}/transition", {"to": "rejected"})
        route.continue_()

    moved: list[int] = []
    with browse(browser, w.m("p"), f"/jobs/{w.id('j1')}/applicants") as page:
        page.route("**/api/applications/*/transition", newer_move_first)
        column = lambda label: page.get_by_role("list", name=label, exact=True)
        card = page.get_by_role("listitem").and_(page.locator(f"[data-application-id='{aid}']"))
        loaded(page, card, "the board")
        card.first.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        alerted(page, f"This application already moved to {STAGE_LABELS[4]}.")
        shown(page, column(STAGE_LABELS[4]).locator(f"[data-application-id='{aid}']"), "the card in its stored column")
        eventually(page, lambda: has_focus(card.first), "focus on the card")


def test_phone_back_restores_conversation_list(app_url, browser):
    t0 = server_now(app_url)
    keys = [f"c{i}" for i in range(14)]
    w = World(app_url, "v " + " ".join(keys), connections=[conn("v", k, t0) for k in keys],
              messages=[{"from": k, "to": "v", "text": f"m{i}", "at": at(t0, -60 * (i + 1)), "read_at": at(t0, -30)}
                        for i, k in enumerate(keys)])
    with browse(browser, w.m("v"), "/messaging", size=PHONE) as page:
        listing = page.get_by_role("list", name="Conversations")
        loaded(page, listing.get_by_role("link").first, "the conversations")
        target = listing.get_by_role("link").nth(10)
        target.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
        y = box_of(target)["y"]
        tap(target)
        back = btn(page, "Back to conversations")
        shown(page, back, "the thread screen")
        tap(back)
        shown(page, listing, "the list screen")
        eventually(page, lambda: abs(box_of(target)["y"] - y) <= 2, "the same scroll position")
        eventually(page, lambda: has_focus(target), "focus on the conversation left")
