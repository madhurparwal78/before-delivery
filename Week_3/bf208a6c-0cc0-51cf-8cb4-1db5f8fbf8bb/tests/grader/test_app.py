from __future__ import annotations

import csv
import io
import json
import os
import re
import struct
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    S3,
    Mailpit,
    Ntfy,
    addresses,
    advance,
    axe,
    center,
    click,
    fill,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    style,
    tab_order,
    tap,
    text,
    unique,
)

APP = Path("/app")
SESSION_COOKIE = "pinsheet_session"
PASS_COOKIE = "pinsheet_pass"
FIXTURE_PATH = "/api/grading/fixture"
GRADING_KEY = os.environ.get("GRADING_KEY", "pinsheet-grading-key")
UPLOAD_MAX_BYTES = int(os.environ.get("UPLOAD_MAX_BYTES", "200000"))
LIMIT_TEXT = f"{UPLOAD_MAX_BYTES:,}"
PASSWORD = "pass-amy-1"
SECTIONS = ["Ideas", "Booked", "Done"]
LIVE_BAND_S = 2
LIVE_WAIT_S = LIVE_BAND_S + 8
BANNER_S = 12
JSON_LIMIT = 64000
MULTIPART_EXTRA = 64000
TITLE_MAX = 80
BODY_MAX = 2000
COMMENT_MAX = 500
NAME_MAX = 40
BOARD_TITLE_MAX = 80
SECTION_TITLE_MAX = 40
SECTIONS_MAX = 12
BOARD_PASSWORD_MIN = 8
SETTLE_MIN_MS = 150
SETTLE_MAX_MS = 300
LOUPE_MIN_MS = 200
LOUPE_MAX_MS = 360
SHEET_MIN_MS = 200
SHEET_MAX_MS = 360
SLIDE_MIN_MS = 250
SLIDE_MAX_MS = 450
LONG_PRESS_MS = 500
DRAG_START_PX = 8
TAP_MIN_PX = 44
FULL_BOARD_FRAMES = 24
USABLE_S = 3
LOUPE_SCALE = 4
INSTANT_MS = 1
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
LAPTOP = {"width": 1280, "height": 800}
CSV_HEADER = "post_id,section,position,title,body,author,likes,score,comments,attachment,created_at"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}

FRAME_MS = 16
STEP_MS = 50
PUMP_MS = 900
SETTLE_QUIET_MS = 100
HTTP_TIMEOUT_S = 30
MAIL_WAIT_S = 30
PUSH_WAIT_S = 20
EXPIRY_WAIT_S = 150
REMOVAL_WAIT_S = 40
PX_SLACK = 2
TAP_MS = 100
SWIPE_PX = 200
SCROLL_PROBE_PX = 400
RACERS = 6
TAB_PRESSES = 40
PAD_BYTES = 64
FOREIGN_ORIGIN = "http://elsewhere.invalid"
PNG_W, PNG_H = 24, 16
PHOTO_NAME = "ridge.png"
LAKE_NAME = "lake.png"
NOTES_NAME = "notes.txt"

SECTION_SEL = "[data-section-id][data-count]"
TOUCH: dict[int, Any] = {}


def png(width: int = PNG_W, height: int = PNG_H, rgb: tuple[int, int, int] = (60, 110, 60)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PNG = png()
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * PAD_BYTES
GIF = b"GIF89a" + b"\x01\x00\x01\x00\x00\x00\x00" + b"\x00" * PAD_BYTES
WEBP = b"RIFF" + struct.pack("<I", PAD_BYTES + 4) + b"WEBPVP8 " + b"\x00" * PAD_BYTES
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
TEXT = "Packing notes, caf\u00e9 \U0001F642\n".encode()
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
EXE = b"MZ\x90\x00" + b"\x00" * PAD_BYTES
NUL_TEXT = b"plain\x00text"
LATIN1_TEXT = b"caf\xe9 au lait"


def padded(head: bytes, size: int) -> bytes:
    return head + b"\x00" * (size - len(head))


def tag() -> str:
    return uuid.uuid4().hex[:6]


def person(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email = a if "@" in a else b if "@" in b else f"{prefix}.{tag()}@example.test"
    return f"{prefix.capitalize()} {tag()}", email


def P(key: str, section: str, author: str, title: str, **extra: Any) -> dict[str, Any]:
    return {"key": key, "section": section, "author": author, "title": title,
            "body": extra.pop("body", f"Notes for {title}"), **extra}


def api(base: str, sess: str | None = None) -> httpx.Client:
    return httpx.Client(base_url=base, cookies={SESSION_COOKIE: sess} if sess else {}, timeout=HTTP_TIMEOUT_S)


class World:
    def __init__(self, base: str, users: dict[str, dict[str, Any]], board: dict[str, Any] | None, title: str, titles: dict[str, str]):
        self.base, self.users, self.board, self.title, self.titles = base, users, board or {}, title, titles
        self.id = self.board.get("id", "")
        self.path = self.board.get("path") or f"/b/{self.id}"

    def pid(self, key: str) -> str:
        return self.board["posts"][key]

    def pids(self, *keys: str) -> list[str]:
        return [self.pid(k) for k in keys]

    def sec(self, title: str) -> str:
        return self.board["sections"][title]

    def sess(self, who: str) -> str:
        return self.users[who]["session"]

    def uid(self, who: str) -> str:
        return self.users[who]["id"]

    def name(self, who: str) -> str:
        return self.users[who]["display_name"]

    def email(self, who: str) -> str:
        return self.users[who]["email"]

    def client(self, who: str | None = None) -> httpx.Client:
        return api(self.base, self.sess(who) if who else None)

    @property
    def token(self) -> str:
        return (self.board.get("share_path") or self.board.get("embed_path") or "").rsplit("/", 1)[-1]


DEFAULT_MEMBERS = {"con": "contributor", "mod": "moderator", "vie": "viewer", "co2": "contributor"}


def world(base: str, *, posts: tuple | list = (), sections: list[str] | None = None, members: dict[str, str] | None = None,
          extra: tuple[str, ...] = ("out",), names: dict[str, str] | None = None, board: bool = True,
          title: str | None = None, **opts: Any) -> World:
    members = dict(DEFAULT_MEMBERS if members is None else members)
    keys = ["own", *members, *[k for k in extra if k not in members]]
    users: dict[str, dict[str, Any]] = {}
    for k in keys:
        name, email = person(k)
        users[k] = {"key": k, "display_name": (names or {}).get(k, name), "email": email, "password": PASSWORD}
    board_title = title or f"Board {tag()}"
    body: dict[str, Any] = {"users": [dict(u) for u in users.values()]}
    if board:
        body["boards"] = [{"key": "b", "owner": "own", "title": board_title, "sections": list(sections or SECTIONS),
                           "members": members, "posts": [dict(p) for p in posts], **opts}]
    r = post_json(base, FIXTURE_PATH, body, **{"X-Grading-Key": GRADING_KEY})
    assert r.status_code == 201, f"POST /api/grading/fixture answered {r.status_code}: {r.text[:400]}"
    data = r.json()
    for k, u in users.items():
        u.update(data["users"][k])
    return World(base, users, data.get("boards", {}).get("b"), board_title, {p["key"]: p["title"] for p in posts})


def answers(r: httpx.Response, status: int, body: Any = None, what: str = "") -> None:
    assert r.status_code == status, f"{what}: expected {status}, got {r.status_code} {r.text[:400]}"
    if body is not None:
        assert r.json() == body, f"{what}: expected body {body}, got {r.text[:400]}"


def create_post(cl: httpx.Client, bid: str, section_id: str, title: str, body: str = "",
                file: tuple[str, bytes] | None = None, **headers: str) -> httpx.Response:
    parts: list[tuple[str, Any]] = [("section_id", (None, section_id)), ("title", (None, title)), ("body", (None, body))]
    if file:
        parts.append(("file", (file[0], file[1], "application/octet-stream")))
    return cl.post(f"/api/boards/{bid}/posts", files=parts, headers=headers)


def listing(cl: httpx.Client, bid: str) -> dict[str, Any]:
    r = cl.get(f"/api/boards/{bid}/posts")
    assert r.status_code == 200, f"GET /api/boards/{bid}/posts answered {r.status_code}: {r.text[:300]}"
    return r.json()


def api_order(cl: httpx.Client, bid: str) -> dict[str, list[str]]:
    return {s["id"]: [p["id"] for p in s["posts"]] for s in listing(cl, bid)["sections"]}


def all_ids(data: dict[str, Any]) -> set[str]:
    return {p["id"] for s in data["sections"] for p in s["posts"]} | {p["id"] for p in data.get("held", [])}


def assert_api_order(cl: httpx.Client, bid: str, expected: dict[str, list[str]], what: str) -> None:
    order = api_order(cl, bid)
    for sid, ids in expected.items():
        assert order.get(sid) == ids, f"{what}: GET posts shows {order.get(sid)} in {sid}, expected {ids}"


def move(cl: httpx.Client, pid: str, section_id: str, position: int, version: int | None = None) -> httpx.Response:
    if version is None:
        version = cl.get(f"/api/posts/{pid}").json()["version"]
    return cl.patch(f"/api/posts/{pid}/move", json={"section_id": section_id, "position": position, "version": version})


def within(check: Callable[[], bool], what: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (httpx.HTTPError, AssertionError, KeyError, ValueError) as exc:
            last = exc
    pytest.fail(f"expected within {seconds}s: {what} ({last})")


def outage(env: str) -> str:
    url = os.environ.get(env)
    if not url:
        pytest.fail(f"{env} names the outage instance from the task spec; it is not set")
    return url.rstrip("/")


def mail_to(mail: Mailpit, address: str, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(0, settle=1.0) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit received {len(found)} message(s) to {address}; expected {count}")


def mail_now(mail: Mailpit, address: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(0, settle=1.5) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]


def code_from(mail: Mailpit, address: str, count: int = 1) -> str:
    msgs = [m for m in mail_to(mail, address, count) if m.get("Subject") == "Your Pinsheet code"]
    assert msgs, f"no mail with subject 'Your Pinsheet code' to {address}"
    found = re.search(r"Your Pinsheet code is (\d{6})\.", " ".join(text(msgs[-1]).split()))
    assert found, f"code mail body lacks 'Your Pinsheet code is <code>.': {text(msgs[-1])[:300]}"
    return found.group(1)


RECORD_LINES = """() => {
  if (window.__lines) return;
  window.__lines = [];
  const grab = () => {
    for (const el of document.querySelectorAll('[role=status],[aria-live],output')) {
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && !window.__lines.includes(t)) window.__lines.push(t);
    }
  };
  new MutationObserver(grab).observe(document.documentElement, {subtree: true, childList: true, characterData: true});
  grab();
}"""

FOCUSED_POST = """() => { const a = document.activeElement; const f = a && a.closest ? a.closest('[data-post-id]') : null; return f ? f.getAttribute('data-post-id') : null; }"""

DOM_ORDER = """() => Object.fromEntries(Array.from(document.querySelectorAll('[data-section-id][data-count]')).map(s => [
  s.getAttribute('data-section-id'),
  Array.from(s.querySelectorAll('[data-post-id]')).filter(f => f.getAttribute('data-state') !== 'awaiting_approval').map(f => f.getAttribute('data-post-id'))]))"""

DOM_COUNTS = """() => Object.fromEntries(Array.from(document.querySelectorAll('[data-section-id][data-count]')).map(s => [s.getAttribute('data-section-id'), s.getAttribute('data-count')]))"""

ANIM_RECORDER = """() => {
  if (window.__anims) { window.__anims.length = 0; return; }
  const rec = []; window.__anims = rec; const seen = new WeakSet();
  const note = (a) => {
    if (!a || seen.has(a) || !a.effect || !a.effect.target) return;
    seen.add(a);
    const t = a.effect.target;
    const el = t instanceof Element ? t : (t.element || null);
    const post = el && el.closest('[data-post-id]');
    const dlg = document.querySelector('[role=dialog],dialog');
    const near = !!(el && dlg && el !== document.body && el !== document.documentElement && (dlg.contains(el) || el.contains(dlg)));
    const timing = a.effect.getComputedTiming();
    const end = timing.endTime === Infinity ? 1e9 : (Number(timing.endTime) || 0);
    rec.push({post: post ? post.getAttribute('data-post-id') : null, dialog: near, end});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); note(a); return a; };
  window.__scanAnims = () => document.getAnimations().forEach(note);
  for (const name of ['transitionrun', 'transitionstart', 'animationstart']) document.addEventListener(name, () => window.__scanAnims(), true);
}"""

EMPTY_POINT_JS = """(section) => {
  const box = section.getBoundingClientRect();
  const frames = Array.from(section.querySelectorAll('[data-post-id]'));
  const last = frames.length ? frames[frames.length - 1].getBoundingClientRect() : null;
  for (let y = Math.min(box.bottom, innerHeight) - 3; y > box.top; y -= 4) {
    for (let x = Math.min(box.right, innerWidth) - 3; x > box.left; x -= 4) {
      if (last && !(y > last.bottom || (y >= last.top && y <= last.bottom && x > last.right))) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && section.contains(hit) && !hit.closest('[data-post-id]') && !hit.closest('h1,h2,h3,h4,[role=heading]')) return [x, y];
    }
  }
  return null;
}"""

SHOWS_TEXT_JS = """(root, t) => Array.from(root.querySelectorAll('*')).some(e => {
  if (e.childElementCount !== 0 || (e.textContent || '').trim() !== t) return false;
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden';
})"""

LEFT_OF_JS = """(root, t) => { const e = Array.from(root.querySelectorAll('*')).find(n => n.childElementCount === 0 && (n.textContent || '').trim() === t); return e ? e.getBoundingClientRect().left : null; }"""

SLIDE_PROBE_JS = """(dlg, args) => {
  const find = t => { const e = Array.from(dlg.querySelectorAll('*')).find(n => n.childElementCount === 0 && (n.textContent || '').trim() === t); return e ? e.getBoundingClientRect().left : null; };
  const anims = document.getAnimations().filter(a => a.effect && a.effect.target instanceof Element && dlg.contains(a.effect.target));
  const ends = anims.map(a => a.effect.getComputedTiming().endTime);
  const maxEnd = ends.length ? Math.max(...ends.map(e => e === Infinity ? 1e9 : e)) : 0;
  anims.forEach(a => { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime / 2; });
  const mid = {old: find(args.old), next: find(args.next)};
  anims.forEach(a => { try { a.finish(); } catch (e) {} });
  return {count: anims.length, maxEnd, mid, final: find(args.next)};
}"""

IMAGE_SHOWN_JS = """(f, aid) => Array.from(f.querySelectorAll('img')).some(i => i.complete && i.naturalWidth > 0 && (i.currentSrc || i.src).includes('/api/attachments/' + aid))
  || [f, ...f.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundImage.includes('/api/attachments/' + aid))"""


def norm(s: str | None) -> str:
    return " ".join((s or "").split())


def eventually(page: Page, check: Callable[[], bool], what: str, seconds: float = LIVE_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (PlaywrightError, AssertionError, KeyError, TypeError) as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(f"expected within {seconds}s: {what} ({last})")


REDIRECT_TRIES = 5


def record_lines(page: Page) -> None:
    for _ in range(REDIRECT_TRIES):
        page.wait_for_load_state()
        try:
            page.evaluate(RECORD_LINES)
            return
        except PlaywrightError as error:
            if "Execution context was destroyed" not in str(error):
                raise
    pytest.fail(f"{page.url} kept navigating; the announcement recorder could not be installed")


@contextmanager
def screen(browser: Browser, base: str, path: str, sess: str | None = None, *, viewport: dict[str, int] | None = None,
           reduced: bool = False, touch: bool = False, live: bool = True) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(viewport or LAPTOP)
        if touch:
            cdp = session(page)
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
            TOUCH[id(page)] = cdp
        if sess:
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": sess, "url": base}])
        streams: list[str] = []
        page.on("response", lambda r: streams.append(r.url) if "/events" in r.url else None)
        page.on("websocket", lambda ws: streams.append(ws.url))
        page.goto(base + path)
        record_lines(page)
        if live:
            eventually(page, lambda: bool(streams), f"{path} opened its live event stream")
            eventually(page, lambda: page.locator(SECTION_SEL).count() > 0, f"{path} rendered its section regions")
        try:
            yield page
        finally:
            TOUCH.pop(id(page), None)


def visit(page: Page, url: str) -> int:
    resp = page.goto(url)
    record_lines(page)
    return resp.status if resp else 0


def frame(page: Page, title: str) -> Locator:
    return page.get_by_role("article", name=title, exact=True)


def region(page: Page | Locator, name: str) -> Locator:
    return page.get_by_role("region", name=name, exact=True)


def field(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("textbox", name=name, exact=True).or_(scope.get_by_label(name, exact=True)).first


def is_focused(loc: Locator) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate("e => e === document.activeElement"))


def focused_post(page: Page) -> str | None:
    return page.evaluate(FOCUSED_POST)


def dom_order(page: Page) -> dict[str, list[str]]:
    return page.evaluate(DOM_ORDER)


def dom_counts(page: Page) -> dict[str, str]:
    return page.evaluate(DOM_COUNTS)


def heard(page: Page) -> list[str]:
    return page.evaluate("() => window.__lines || []")


def announcements(page: Page) -> str:
    status = page.get_by_role("status", name="Board announcements")
    return norm(status.first.text_content()) if status.count() else ""


def hear(page: Page, line: str, seconds: float = LIVE_WAIT_S) -> None:
    eventually(page, lambda: announcements(page) == line, f'status "Board announcements" reads "{line}"', seconds)


def heard_line(page: Page, line: str, seconds: float = LIVE_WAIT_S) -> None:
    eventually(page, lambda: line in heard(page) or announcements(page) == line, f'"{line}" was announced', seconds)


def shows_order(page: Page, expected: dict[str, list[str]], what: str) -> None:
    def ok() -> bool:
        order, counts = dom_order(page), dom_counts(page)
        return all(order.get(s) == ids and counts.get(s) == str(len(ids)) for s, ids in expected.items())
    eventually(page, ok, f"{what}: sections show {expected} with matching data-count")


def shows_api_order(page: Page, cl: httpx.Client, bid: str, what: str) -> None:
    shows_order(page, api_order(cl, bid), what)


def gone(page: Page, title: str, what: str) -> None:
    eventually(page, lambda: frame(page, title).count() == 0, what)


def start_recording(page: Page) -> None:
    page.evaluate(ANIM_RECORDER)


def pump(page: Page, ms: float = PUMP_MS) -> None:
    for _ in range(int(ms // FRAME_MS)):
        advance(page, FRAME_MS)
        page.evaluate("() => window.__scanAnims && window.__scanAnims()")


def recorded(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__anims || []")


SCAN_JS = "() => window.__scanAnims && window.__scanAnims()"
DIALOG_BOX_JS = """() => { const d = document.querySelector('[role=dialog],dialog'); if (!d) return null; const r = d.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }"""


def dialog_box(page: Page) -> list[float] | None:
    return page.evaluate(DIALOG_BOX_JS)


def motion_ms(page: Page, read: Callable[[], Any], pick: Callable[[dict[str, Any]], bool], lowest: float,
              seconds: float = LIVE_WAIT_S) -> tuple[float, list[Any]]:
    deadline = time.monotonic() + seconds
    prev = read()
    trail = [prev]
    first: float | None = None
    last = 0.0
    t = 0.0
    quiet = 0
    while time.monotonic() < deadline:
        advance(page, FRAME_MS)
        t += FRAME_MS
        page.evaluate(SCAN_JS)
        ends = [r["end"] for r in recorded(page) if pick(r)]
        if ends and max(ends) >= lowest:
            return max(ends), trail
        cur = read()
        if cur != prev:
            trail.append(cur)
            prev = cur
            if first is None:
                first = t
            last = t
            quiet = 0
        elif first is not None:
            quiet += 1
            if quiet * FRAME_MS >= SETTLE_QUIET_MS:
                break
    return (0.0 if first is None else last - first + FRAME_MS), trail


def touch_point(page: Page, kind: str, x: float = 0.0, y: float = 0.0) -> None:
    points = [] if kind == "touchEnd" else [{"x": x, "y": y}]
    TOUCH[id(page)].send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def touch_glide(page: Page, start: tuple[float, float], end: Callable[[], tuple[float, float]], steps: int = 8) -> None:
    x0, y0 = start
    for i in range(1, steps + 1):
        x1, y1 = end()
        touch_point(page, "touchMove", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        advance(page, FRAME_MS)


def mouse_drag(page: Page, source: Locator, target: Callable[[], tuple[float, float]], steps: int = 8) -> None:
    x0, y0 = center(source)
    page.mouse.move(x0, y0)
    page.mouse.down()
    advance(page, FRAME_MS)
    for i in range(1, 4):
        page.mouse.move(x0, y0 + i * DRAG_START_PX / 2)
        advance(page, FRAME_MS)
    for i in range(1, steps + 1):
        x1, y1 = target()
        page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        advance(page, FRAME_MS)
    x1, y1 = target()
    page.mouse.move(x1, y1)
    advance(page, FRAME_MS)
    page.mouse.up()
    advance(page, FRAME_MS)


def empty_point(section: Locator) -> tuple[float, float]:
    point = section.evaluate(EMPTY_POINT_JS)
    assert point, "the section offers empty space after its last frame to drop on (L210)"
    return float(point[0]), float(point[1])


def open_dialog(page: Page, opener: str, name: str, role: str = "dialog") -> Locator:
    click(page.get_by_role("button", name=opener, exact=True))
    dlg = page.get_by_role(role, name=name, exact=True)
    eventually(page, lambda: dlg.count() > 0 and dlg.first.is_visible(), f'{role} "{name}" opens')
    return dlg


def open_loupe(page: Page, title: str) -> Locator:
    f = frame(page, title)
    f.focus()
    page.keyboard.press("Enter")
    eventually(page, lambda: f.get_attribute("data-loupe") == "open", f'Enter opens the loupe of "{title}"')
    return f


def shows_in(page: Page, root: Locator, title: str) -> bool:
    return bool(root.first.evaluate(SHOWS_TEXT_JS, title))


def board_posts(base: str, w: World, n: int, sections: list[str], author: str = "con") -> list[dict[str, Any]]:
    return [P(f"p{i}", sections[i % len(sections)], author, f"Frame {i} {tag()}") for i in range(n)]


def five_posts(t: str, author: str = "con") -> list[dict[str, Any]]:
    return [P("a", "Ideas", author, f"Alpha {t}"), P("b", "Ideas", author, f"Bravo {t}"), P("c", "Ideas", author, f"Charlie {t}"),
            P("x", "Booked", author, f"Xray {t}"), P("y", "Booked", author, f"Yankee {t}")]


def test_wf_keyboard_moves_drop(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a = w.titles["a"]
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        f = frame(own, a)
        f.focus()
        own.keyboard.press("Space")
        hear(own, f"Picked up {a}. Ideas, position 1 of 3.")
        assert f.get_attribute("data-moving") == "true", "a picked-up frame carries data-moving=true (L186)"
        assert focused_post(own) == w.pid("a"), "focus stays on the picked-up frame (L204)"
        own.keyboard.press("ArrowDown")
        hear(own, f"{a}: Ideas, position 2 of 3.")
        own.keyboard.press("ArrowRight")
        hear(own, f"{a}: Booked, position 2 of 3.")
        assert focused_post(own) == w.pid("a"), "focus stays on the frame through the steps (L204)"
        own.keyboard.press("Space")
        hear(own, f"Dropped {a}: Booked, position 2 of 3.")
        eventually(own, lambda: focused_post(own) == w.pid("a"), "focus is on the moved frame after the save (L204)")
        expected = {w.sec("Ideas"): w.pids("b", "c"), w.sec("Booked"): w.pids("x", "a", "y")}
        assert_api_order(w.client("vie"), w.id, expected, "keyboard drop saved worked example 2 (L583)")
        shows_order(own, expected, "owner screen")
        shows_order(watch, expected, "watcher screen shows the move without reload")


def test_wf_keyboard_moves_cancel(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    b = w.titles["b"]
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        f = frame(page, b)
        f.focus()
        page.keyboard.press("Space")
        hear(page, f"Picked up {b}. Ideas, position 2 of 3.")
        page.keyboard.press("ArrowUp")
        hear(page, f"{b}: Ideas, position 1 of 3.")
        page.keyboard.press("ArrowRight")
        hear(page, f"{b}: Booked, position 1 of 3.")
        page.keyboard.press("Escape")
        hear(page, f"Move cancelled. {b} is back in Ideas, position 2 of 3.")
        assert f.get_attribute("data-moving") != "true", "a cancelled move ends the pick-up"
        assert focused_post(page) == w.pid("b"), "focus stays on the frame after cancel"
        expected = {w.sec("Ideas"): w.pids("a", "b", "c"), w.sec("Booked"): w.pids("x", "y")}
        shows_order(page, expected, "the frame is back where it was picked up")
        assert_api_order(w.client("con"), w.id, expected, "cancel saved nothing")
        assert w.client("con").get(f"/api/posts/{w.pid('b')}").json()["version"] == 1, "no move was saved, version unchanged"


def test_wf_keyboard_moves_not_movable(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "co2", f"Other {t}"), P("c", "Ideas", "con", f"Mine {t}")])
    other, mine = w.titles["a"], w.titles["c"]
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        f = frame(page, other)
        f.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        frame(page, mine).focus()
        page.keyboard.press("Space")
        hear(page, f"Picked up {mine}. Ideas, position 2 of 2.")
        lines = heard(page)
        assert not any(other in line for line in lines), f"Space on a post the person may not move announces nothing (L201): {lines}"
        assert f.get_attribute("data-moving") != "true"
        page.keyboard.press("Escape")
        hear(page, f"Move cancelled. {mine} is back in Ideas, position 2 of 2.")
        assert_api_order(w.client("con"), w.id, {w.sec("Ideas"): w.pids("a", "c")}, "nothing moved")


LAYOUT_IDS = ["columns", "rows"]
STEP_KEYS = {"columns": ("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"),
             "rows": ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown")}


@pytest.mark.parametrize("layout_name", LAYOUT_IDS, ids=LAYOUT_IDS)
def test_arrow_targets_follow_layout(browser: Browser, app_url: str, layout_name: str) -> None:
    prev_pos, next_pos, prev_sec, next_sec = STEP_KEYS[layout_name]
    t = tag()
    w = world(app_url, layout=layout_name, posts=[P("a", "Ideas", "con", f"Anchor {t}"), P("b", "Ideas", "con", f"Buoy {t}"),
                                                  P("c", "Ideas", "con", f"Cove {t}"), P("x", "Booked", "con", f"Pier {t}")])
    a = w.titles["a"]
    with screen(browser, app_url, w.path, w.sess("own")) as page:
        frame(page, a).focus()
        page.keyboard.press("Space")
        hear(page, f"Picked up {a}. Ideas, position 1 of 3.")
        steps = [(prev_pos, "Ideas", 1, 3), (prev_sec, "Ideas", 1, 3), (next_pos, "Ideas", 2, 3), (next_pos, "Ideas", 3, 3),
                 (next_pos, "Ideas", 3, 3), (next_sec, "Booked", 2, 2), (next_sec, "Done", 1, 1), (next_sec, "Done", 1, 1),
                 (prev_sec, "Booked", 1, 2)]
        for key, section, p, n in steps:
            page.keyboard.press(key)
            hear(page, f"{a}: {section}, position {p} of {n}.")
            assert focused_post(page) == w.pid("a")
        page.keyboard.press("Space")
        hear(page, f"Dropped {a}: Booked, position 1 of 2.")
        expected = {w.sec("Ideas"): w.pids("b", "c"), w.sec("Booked"): w.pids("a", "x"), w.sec("Done"): []}
        assert_api_order(w.client("own"), w.id, expected, f"{layout_name} keyboard targets")
        shows_order(page, expected, "owner screen after the drop")


def test_moves_insert_and_close_gaps(browser: Browser, app_url: str) -> None:
    t = tag()
    w1 = world(app_url, posts=[P("a", "Ideas", "con", f"A {t}"), P("b", "Ideas", "con", f"B {t}"), P("c", "Ideas", "con", f"C {t}")])
    mod1 = w1.client("mod")
    r = move(mod1, w1.pid("c"), w1.sec("Ideas"), 1, 1)
    answers(r, 200, what="worked example 1 move")
    assert r.json()["position"] == 1 and r.json()["section_id"] == w1.sec("Ideas") and r.json()["version"] == 2
    data = listing(mod1, w1.id)
    ideas = next(s for s in data["sections"] if s["id"] == w1.sec("Ideas"))
    assert [p["id"] for p in ideas["posts"]] == w1.pids("c", "a", "b"), "worked example 1 gives C 1, A 2, B 3 (L582)"
    assert [p["position"] for p in ideas["posts"]] == [1, 2, 3]

    w2 = world(app_url, posts=five_posts(t))
    mod2 = w2.client("mod")
    answers(move(mod2, w2.pid("a"), w2.sec("Booked"), 2, 1), 200, what="worked example 2 move")
    expected = {w2.sec("Ideas"): w2.pids("b", "c"), w2.sec("Booked"): w2.pids("x", "a", "y")}
    assert_api_order(mod2, w2.id, expected, "worked example 2 (L583)")
    for bad in (0, 5):
        answers(move(mod2, w2.pid("b"), w2.sec("Booked"), bad), 422,
                {"errors": {"position": "Position must be between 1 and 4."}}, f"position {bad} into a 3-post section")
    assert_api_order(mod2, w2.id, expected, "refused moves change nothing")
    with screen(browser, app_url, w2.path, w2.sess("own")) as page:
        shows_order(page, expected, "after reload the saved order shows")
        positions = [frame(page, w2.titles[k]).get_attribute("data-position") for k in ("x", "a", "y")]
        assert positions == ["1", "2", "3"], f"data-position is 1-based within the section (L181): {positions}"


def test_moves_reach_every_screen(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    mod = w.client("mod")
    with ExitStack() as stack:
        pages = [stack.enter_context(screen(browser, app_url, w.path, w.sess(who))) for who in ("vie", "co2")]
        answers(move(mod, w.pid("y"), w.sec("Ideas"), 2), 200)
        for page in pages:
            shows_api_order(page, mod, w.id, "first live move")
        answers(move(mod, w.pid("a"), w.sec("Done"), 1), 200)
        for page in pages:
            shows_api_order(page, mod, w.id, "second live move")
        assert api_order(mod, w.id)[w.sec("Done")] == w.pids("a")


def test_wf_drag_reorder_mouse(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Apple {t}"), P("b", "Ideas", "con", f"Birch {t}"),
                              P("c", "Ideas", "con", f"Cedar {t}"), P("x", "Booked", "con", f"Xenon {t}")])
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        c = frame(own, w.titles["c"])
        x0, y0 = center(c)
        own.mouse.move(x0, y0)
        own.mouse.down()
        own.mouse.move(x0 + 3, y0)
        advance(own, FRAME_MS)
        own.mouse.up()
        advance(own, FRAME_MS)
        own.keyboard.press("Escape")
        assert c.get_attribute("data-moving") != "true", "a press moved under 8 px starts no drag (L209)"
        initial = {w.sec("Ideas"): w.pids("a", "b", "c"), w.sec("Booked"): w.pids("x")}
        assert_api_order(w.client("own"), w.id, initial, "no move under the drag threshold")

        mouse_drag(own, c, lambda: center(frame(own, w.titles["a"])))
        hear(own, f"Dropped {w.titles['c']}: Ideas, position 1 of 3.")
        first = {w.sec("Ideas"): w.pids("c", "a", "b"), w.sec("Booked"): w.pids("x")}
        assert_api_order(w.client("own"), w.id, first, "drop on a frame takes that frame's position (L210)")
        shows_order(watch, first, "watcher sees the dragged order")

        booked = region(own, "Booked")
        mouse_drag(own, frame(own, w.titles["a"]), lambda: empty_point(booked))
        hear(own, f"Dropped {w.titles['a']}: Booked, position 2 of 2.")
        second = {w.sec("Ideas"): w.pids("c", "b"), w.sec("Booked"): w.pids("x", "a")}
        assert_api_order(w.client("own"), w.id, second, "drop on empty space puts the post last (L210)")
        shows_order(own, second, "owner screen counts")
        shows_order(watch, second, "watcher counts")


def test_wf_drag_reorder_touch(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "co2", f"Aspen {t}"), P("b", "Ideas", "co2", f"Beech {t}"), P("c", "Ideas", "con", f"Cherry {t}")])
    a, b, c = (w.titles[k] for k in "abc")
    initial = {w.sec("Ideas"): w.pids("a", "b", "c")}
    with screen(browser, app_url, w.path, w.sess("con"), viewport=PHONE, touch=True) as page:
        bx, by = center(frame(page, b))
        touch_point(page, "touchStart", bx, by)
        advance(page, TAP_MS)
        touch_point(page, "touchEnd")
        eventually(page, lambda: frame(page, b).get_attribute("data-loupe") == "open", "a short tap opens the loupe (L211)")
        page.keyboard.press("Escape")
        eventually(page, lambda: frame(page, b).get_attribute("data-loupe") == "closed", "Escape closes the loupe")
        assert_api_order(w.client("con"), w.id, initial, "a tap moves nothing")

        ax, ay = center(frame(page, a))
        touch_point(page, "touchStart", ax, ay)
        advance(page, LONG_PRESS_MS)
        touch_glide(page, (ax, ay), lambda: center(frame(page, c)))
        touch_point(page, "touchEnd")
        advance(page, FRAME_MS)
        page.keyboard.press("Escape")
        assert_api_order(w.client("con"), w.id, initial, "a long press on a post the person may not move starts no drag (L212)")

        cx, cy = center(frame(page, c))
        touch_point(page, "touchStart", cx, cy)
        advance(page, LONG_PRESS_MS)
        touch_glide(page, (cx, cy), lambda: center(frame(page, a)))
        touch_point(page, "touchEnd")
        hear(page, f"Dropped {c}: Ideas, position 1 of 3.")
        assert not any(line.startswith(f"Dropped {a}") for line in heard(page))
        assert_api_order(w.client("con"), w.id, {w.sec("Ideas"): w.pids("c", "a", "b")}, "lifting the finger drops the post")


MOTION_IDS = ["motion", "reduced"]


@pytest.mark.parametrize("mode", MOTION_IDS, ids=MOTION_IDS)
def test_settle_motion(browser: Browser, app_url: str, mode: str) -> None:
    reduced = mode == "reduced"
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Oak {t}"), P("b", "Ideas", "con", f"Elm {t}"), P("c", "Ideas", "con", f"Ash {t}")])
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie"), reduced=reduced))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own"), reduced=reduced))
        start_recording(own)
        start_recording(watch)
        mouse_drag(own, frame(own, w.titles["c"]), lambda: center(frame(own, w.titles["a"])))
        moved_f, neigh_f = frame(watch, w.titles["c"]), frame(watch, w.titles["a"])
        expected = {w.sec("Ideas"): w.pids("c", "a", "b")}
        if reduced:
            shows_order(watch, expected, "watcher receives the drop")
            advance(watch, 2 * FRAME_MS)
            first = (moved_f.bounding_box(), neigh_f.bounding_box())
            pump(watch)
            final = (moved_f.bounding_box(), neigh_f.bounding_box())
            assert all(abs(x[k] - y[k]) <= PX_SLACK for x, y in zip(first, final) for k in x), \
                f"under reduced motion frames jump to their slots with no animation (L295): {first} then {final}"
            hear(own, f"Dropped {w.titles['c']}: Ideas, position 1 of 3.")
            return
        ms, _ = motion_ms(watch, lambda: (moved_f.bounding_box(), neigh_f.bounding_box()),
                          lambda r: r["post"] in w.pids("a", "b", "c"), SETTLE_MIN_MS)
        assert SETTLE_MIN_MS <= ms <= SETTLE_MAX_MS, f"the moved frame and its neighbours settle in 150-300 ms (L286): {ms}"
        hear(own, f"Dropped {w.titles['c']}: Ideas, position 1 of 3.")
        shows_order(watch, expected, "watcher receives the drop")


def test_section_counts_exact(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "con", f"Kite {t}"), P("b", "Ideas", "con", f"Kelp {t}"),
                                             P("x", "Booked", "con", f"Knot {t}"), P("h", "Ideas", "co2", f"Held {t}", state="awaiting_approval")])
    mod = w.client("mod")
    ideas, booked, done = (w.sec(s) for s in SECTIONS)

    def counts_are(page: Page, want: dict[str, int], what: str) -> None:
        def ok() -> bool:
            c = dom_counts(page)
            o = dom_order(page)
            return all(c.get(s) == str(n) and len(o.get(s, [])) == n for s, n in want.items())
        eventually(page, ok, what)
        api = {s["id"]: s["count"] for s in listing(mod, w.id)["sections"]}
        assert all(api[s] == n for s, n in want.items()), f"{what}: API section counts {api}, expected {want}"

    with screen(browser, app_url, w.path, w.sess("vie")) as page:
        counts_are(page, {ideas: 2, booked: 1, done: 0}, "initial counts ignore the held post")
        answers(move(mod, w.pid("a"), booked, 1), 200)
        counts_are(page, {ideas: 1, booked: 2, done: 0}, "after a move")
        answers(create_post(mod, w.id, done, f"New {t}"), 201)
        counts_are(page, {ideas: 1, booked: 2, done: 1}, "after a new post")
        answers(mod.post(f"/api/posts/{w.pid('h')}/approve"), 200)
        counts_are(page, {ideas: 2, booked: 2, done: 1}, "after an approval")
        answers(mod.delete(f"/api/posts/{w.pid('x')}"), 204)
        counts_are(page, {ideas: 2, booked: 1, done: 1}, "after a deletion")


def test_sort_locks_order(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, sort="newest", posts=[P("a", "Ideas", "con", f"First {t}"), P("b", "Ideas", "con", f"Second {t}"),
                                             P("x", "Booked", "con", f"Third {t}")])
    own = w.client("own")
    a = w.titles["a"]
    with screen(browser, app_url, w.path, w.sess("own")) as page:
        shows_order(page, {w.sec("Ideas"): w.pids("b", "a")}, "Newest first shows the later post first")
        frame(page, a).focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        hear(page, "Order is set by Newest first. Choose By hand to reorder.")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        hear(page, f"Dropped {a}: Booked, position 2 of 2.")
        moved = w.client("own").get(f"/api/posts/{w.pid('a')}").json()
        assert moved["section_id"] == w.sec("Booked"), "a section change is saved under a sort (L589)"
        answers(move(own, w.pid("b"), w.sec("Ideas"), 1), 422,
                {"errors": {"position": "Order is set by Newest first. Choose By hand to reorder."}}, "within-section move under a sort")
        answers(own.patch(f"/api/boards/{w.id}", json={"group": "author"}), 200)
        eventually(page, lambda: all(s.startswith("author-") for s in dom_order(page)), "the screen regroups by author")
        before = api_order(own, w.id)
        frame(page, w.titles["b"]).focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        hear(page, "Moving is off while posts are grouped by author.")
        page.keyboard.press("Escape")
        answers(move(own, w.pid("b"), w.sec("Booked"), 1), 422,
                {"errors": {"position": "Moving is off while posts are grouped by author."}}, "move while grouped by author")
        assert api_order(own, w.id) == before, "blocked moves leave posts in place"


def test_wf_simultaneous_posting_keyboard(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "co2", f"Earlier {t}")])
    title, body = f"Canoe rota {t}", f"Pairs swap at noon {t}"
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        page = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        page.get_by_role("button", name="Add post", exact=True).focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Add post", exact=True)
        title_box = dlg.get_by_role("textbox", name="Title", exact=True)
        eventually(page, lambda: is_focused(title_box), "opening Add post puts focus in Title (L229)")
        page.keyboard.type(title)
        dlg.get_by_role("textbox", name="Text", exact=True).focus()
        page.keyboard.type(body)
        page.keyboard.press("Control+Enter")
        hear(page, f"Posted {title}.")
        eventually(page, lambda: dlg.count() == 0, "the dialog closes after success")
        data = listing(w.client("con"), w.id)
        ideas = next(s for s in data["sections"] if s["id"] == w.sec("Ideas"))
        new = ideas["posts"][-1]
        assert new["title"] == title and new["body"] == body and new["author"]["display_name"] == w.name("con"), \
            "the new post lands last in the preset first section with its author (L229, L579)"
        eventually(page, lambda: focused_post(page) == new["id"], "focus goes to the new frame (L232)")
        heard_line(watch, f"{w.name('con')} added {title}.")
        shows_api_order(watch, w.client("co2"), w.id, "watcher shows the new frame")


def test_wf_simultaneous_posting_three(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, members={"con": "contributor", "co2": "contributor", "co3": "contributor", "vie": "viewer"})
    who = ["con", "co2", "co3"]
    titles = {k: f"{k} trip {t}" for k in who}
    with ExitStack() as stack:
        pages = {k: stack.enter_context(screen(browser, app_url, w.path, w.sess(k), viewport=PHONE if k == "co3" else LAPTOP,
                                               touch=k == "co3")) for k in who}
        dialogs = {}
        for k, page in pages.items():
            if k == "co3":
                tap(page.get_by_role("button", name="Add post", exact=True))
            else:
                click(page.get_by_role("button", name="Add post", exact=True))
            dlg = page.get_by_role("dialog", name="Add post", exact=True)
            eventually(page, lambda d=dlg: d.count() > 0, "Add post opens")
            pump(page)
            dialogs[k] = dlg
        for k in ("con", "co2"):
            dialogs[k].get_by_role("textbox", name="Title", exact=True).focus()
            pages[k].keyboard.type(titles[k])
        phone, sheet = pages["co3"], dialogs["co3"]
        tap(sheet.get_by_role("textbox", name="Title", exact=True))
        fill(sheet.get_by_role("textbox", name="Title", exact=True), titles["co3"])
        with phone.expect_file_chooser() as chooser:
            tap(sheet.get_by_role("button", name="Attach a file", exact=True))
        chooser.value.set_files(files=[{"name": LAKE_NAME, "mimeType": "image/png", "buffer": PNG}])
        pages["con"].keyboard.press("Control+Enter")
        click(dialogs["co2"].get_by_role("button", name="Post", exact=True))
        tap(sheet.get_by_role("button", name="Post", exact=True))
        cl = w.client("vie")

        def all_three() -> bool:
            ideas = next(s for s in listing(cl, w.id)["sections"] if s["id"] == w.sec("Ideas"))
            return {p["title"] for p in ideas["posts"]} == set(titles.values())
        within(all_three, "GET posts lists all three new posts", LIVE_WAIT_S)
        order = api_order(cl, w.id)
        for k, page in pages.items():
            shows_order(page, {w.sec("Ideas"): order[w.sec("Ideas")]}, f"{k}'s screen matches the server's commit order")
            others = [f"{w.name(o)} added {titles[o]}." for o in who if o != k]
            eventually(page, lambda p=page, ls=others: any(line in heard(p) or announcements(p) == line for line in ls),
                       f"{k} hears a new-post line from the others (posts landing together may leave only the later line, L314)")
        photo = next(p for s in listing(cl, w.id)["sections"] for p in s["posts"] if p["title"] == titles["co3"])
        assert photo["attachment"] and photo["attachment"]["file_name"] == LAKE_NAME
        aid = photo["attachment"]["id"]
        assert S3().keys(f"boards/{w.id}/posts/{photo['id']}/") == [f"boards/{w.id}/posts/{photo['id']}/{aid}"]
        eventually(pages["con"], lambda: bool(frame(pages["con"], titles["co3"]).evaluate(IMAGE_SHOWN_JS, aid)),
                   "another screen shows the photo frame with its image")


POST_LIMIT_IDS = ["title_at_limit", "title_emoji_at_limit", "title_trimmed", "title_over", "title_blank", "body_at_limit", "body_over"]


def post_limit_case(case: str) -> tuple[str, str, tuple[str, str] | None]:
    return {
        "title_at_limit": ("t" * TITLE_MAX, "", None),
        "title_emoji_at_limit": ("\U0001F642" * TITLE_MAX, "", None),
        "title_trimmed": ("  " + "t" * TITLE_MAX + "  ", "", None),
        "title_over": ("t" * (TITLE_MAX + 1), "", ("title", "Titles can be at most 80 characters.")),
        "title_blank": ("   ", "", ("title", "Give your post a title.")),
        "body_at_limit": ("Body", "b" * BODY_MAX, None),
        "body_over": ("Body", "b" * (BODY_MAX + 1), ("body", "Text can be at most 2,000 characters.")),
    }[case]


@pytest.mark.parametrize("case", POST_LIMIT_IDS, ids=POST_LIMIT_IDS)
def test_post_title_text_limits(browser: Browser, app_url: str, case: str) -> None:
    title, body, refusal = post_limit_case(case)
    w = world(app_url)
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        dlg = open_dialog(page, "Add post", "Add post")
        title_box, text_box = dlg.get_by_role("textbox", name="Title", exact=True), dlg.get_by_role("textbox", name="Text", exact=True)
        fill(title_box, title)
        if body:
            fill(text_box, body)
        if case == "title_at_limit":
            assert dlg.get_by_text(f"{TITLE_MAX}/{TITLE_MAX}").count() > 0, "the Title counter shows 80/80 (L146)"
        if refusal:
            box, raw = (title_box, title) if refusal[0] == "title" else (text_box, body)
            if len(box.input_value()) == len(raw):
                click(dlg.get_by_role("button", name="Post", exact=True))
                eventually(page, lambda: refusal[1] in norm(dlg.get_by_role("alert").first.text_content()),
                           f'the dialog alert shows "{refusal[1]}"')
                assert dlg.count() > 0 and box.input_value() == raw, "a refusal keeps the dialog open with everything typed (L233)"
            else:
                assert len(box.input_value()) <= (TITLE_MAX if refusal[0] == "title" else BODY_MAX)
    r = create_post(w.client("con"), w.id, w.sec("Ideas"), title, body)
    if refusal:
        answers(r, 422, {"errors": {refusal[0]: refusal[1]}}, case)
        assert all_ids(listing(w.client("own"), w.id)) == set(), "a refused post stores nothing"
    else:
        answers(r, 201, what=case)
        assert r.json()["title"] == title.strip() and r.json()["body"] == body


def test_wf_reactions_keyboard(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "con", f"Kayak {t}")])
    title, pid = w.titles["p"], w.pid("p")
    me, other = w.client("vie"), w.client("own")
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        page = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        f = open_loupe(page, title)
        like = f.get_by_role("button", name=f"Like {title}", exact=True)
        up = f.get_by_role("button", name=f"Vote up {title}", exact=True)
        down = f.get_by_role("button", name=f"Vote down {title}", exact=True)
        assert like.get_attribute("aria-pressed") == "false"

        def state(likes: str, score: str, lp: str, upp: str, dp: str) -> Callable[[], bool]:
            return lambda: (f.get_attribute("data-likes"), f.get_attribute("data-score"), like.get_attribute("aria-pressed"),
                            up.get_attribute("aria-pressed"), down.get_attribute("aria-pressed")) == (likes, score, lp, upp, dp)

        like.focus()
        page.keyboard.press("Enter")
        eventually(page, state("1", "0", "true", "false", "false"), "Enter on Like presses it")
        mine = me.get(f"/api/posts/{pid}").json()
        assert (mine["likes"], mine["liked"]) == (1, True)
        eventually(watch, lambda: frame(watch, title).get_attribute("data-likes") == "1", "another screen sees the like live")
        click(up)
        eventually(page, state("1", "1", "true", "true", "false"), "a click on Vote up votes +1")
        down.focus()
        page.keyboard.press("Space")
        eventually(page, state("1", "-1", "true", "false", "true"), "switching to Vote down changes the score by 2 (L599)")
        assert other.get(f"/api/posts/{pid}").json()["score"] == -1 and me.get(f"/api/posts/{pid}").json()["my_vote"] == -1
        click(down)
        eventually(page, state("1", "0", "true", "false", "false"), "pressing the pressed vote removes it (L599)")
        like.focus()
        page.keyboard.press("Space")
        eventually(page, state("0", "0", "false", "false", "false"), "Space on a pressed Like removes it")
        final = me.get(f"/api/posts/{pid}").json()
        assert (final["likes"], final["score"], final["liked"], final["my_vote"]) == (0, 0, False, 0)
        eventually(watch, lambda: (frame(watch, title).get_attribute("data-likes"), frame(watch, title).get_attribute("data-score")) == ("0", "0"),
                   "another screen ends at the stored counts")


def test_wf_reactions_two_tabs(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "con", f"Tent {t}", likes=["mod", "co2"], votes={"mod": 1, "co2": 1, "own": -1},
                                comments=[{"author": "mod", "text": "Bring pegs"}, {"author": "co2", "text": "Got it"}])])
    title, pid = w.titles["p"], w.pid("p")
    tabs = [w.client("vie"), w.client("vie")]

    def race(method: str, path: str, body: Any = None) -> list[httpx.Response]:
        barrier = threading.Barrier(4)

        def go(i: int) -> httpx.Response:
            barrier.wait()
            return tabs[i % 2].request(method, path, json=body)
        with ThreadPoolExecutor(4) as pool:
            return list(pool.map(go, range(4)))

    with screen(browser, app_url, w.path, w.sess("own")) as page:
        f = frame(page, title)
        eventually(page, lambda: (f.get_attribute("data-likes"), f.get_attribute("data-score"), f.get_attribute("data-comments")) == ("2", "1", "2"),
                   "frame counts equal the fixture's stored rows")
        for r in race("PUT", f"/api/posts/{pid}/like"):
            answers(r, 200)
        assert w.client("own").get(f"/api/posts/{pid}").json()["likes"] == 3, "four simultaneous likes by one person store one like"
        eventually(page, lambda: f.get_attribute("data-likes") == "3", "the like reaches the other screen")
        for r in race("DELETE", f"/api/posts/{pid}/like"):
            answers(r, 200)
        assert w.client("own").get(f"/api/posts/{pid}").json()["likes"] == 2
        for r in race("PUT", f"/api/posts/{pid}/vote", {"value": -1}):
            answers(r, 200)
        assert w.client("own").get(f"/api/posts/{pid}").json()["score"] == 0, "one down vote per person (1 + 1 - 1 - 1)"
        r = tabs[0].put(f"/api/posts/{pid}/vote", json={"value": 1})
        answers(r, 200)
        assert r.json() == {"likes": 2, "score": 2, "liked": False, "my_vote": 1}, "switching down to up changes the score by 2"
        answers(w.client("con").post(f"/api/posts/{pid}/comments", json={"text": "Count me in"}), 201)
        eventually(page, lambda: (f.get_attribute("data-likes"), f.get_attribute("data-score"), f.get_attribute("data-comments")) == ("2", "2", "3"),
                   "likes, score and comments change live to the stored values")
        api_post = w.client("own").get(f"/api/posts/{pid}").json()
        assert (api_post["likes"], api_post["score"], api_post["comments"]) == (2, 2, 3)


def test_signed_out_cannot_react(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", posts=[P("p", "Ideas", "con", f"Picnic {t}", likes=["vie"], comments=[{"author": "vie", "text": "Yum"}])])
    title, pid = w.titles["p"], w.pid("p")
    with screen(browser, app_url, w.path) as page:
        f = frame(page, title)
        assert f.get_attribute("data-likes") == "1" and f.get_attribute("data-comments") == "1", "a stranger sees the counts"
        open_loupe(page, title)
        for name in (f"Like {title}", f"Vote up {title}", f"Vote down {title}", "Send comment", "Add post"):
            assert page.get_by_role("button", name=name, exact=True).count() == 0, f'stranger sees no "{name}" (L174)'
        assert page.get_by_role("textbox", name="Add a comment", exact=True).count() == 0
        assert f.get_by_role("list", name="Comments").count() == 1, "a stranger can read comments"
        assert page.get_by_role("link", name="Sign in", exact=True).count() > 0, "a stranger sees Sign in in the header"
    stranger = w.client()
    for method, path, body in (("PUT", f"/api/posts/{pid}/like", None), ("DELETE", f"/api/posts/{pid}/like", None),
                               ("PUT", f"/api/posts/{pid}/vote", {"value": 1}), ("POST", f"/api/posts/{pid}/comments", {"text": "Hi"})):
        answers(stranger.request(method, path, json=body), 401, {"error": "sign_in_required"}, f"stranger {method} {path}")
    answers(w.client("vie").post(f"/api/posts/{pid}/comments", json={"text": "Viewer try"}), 403, {"error": "forbidden"}, "viewer comment")
    after = w.client("own").get(f"/api/posts/{pid}").json()
    assert (after["likes"], after["score"], after["comments"]) == (1, 0, 1), "refused reactions change nothing"


def test_most_liked_resorts_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, sort="most_liked", posts=[P("a", "Ideas", "con", f"A {t}", likes=["vie", "mod"]), P("b", "Ideas", "con", f"B {t}", likes=["vie"]),
                                                 P("c", "Ideas", "con", f"C {t}")])
    ideas = w.sec("Ideas")
    with ExitStack() as stack:
        pages = [stack.enter_context(screen(browser, app_url, w.path, w.sess(k))) for k in ("vie", "co2")]
        for page in pages:
            shows_order(page, {ideas: w.pids("a", "b", "c")}, "initial most liked order")
        for who in ("own", "co2"):
            answers(w.client(who).put(f"/api/posts/{w.pid('c')}/like"), 200)
        for page in pages:
            shows_order(page, {ideas: w.pids("a", "c", "b")}, "tie on two likes keeps the older post first (L588)")
        answers(w.client("con").put(f"/api/posts/{w.pid('c')}/like"), 200)
        for page in pages:
            shows_order(page, {ideas: w.pids("c", "a", "b")}, "a third like moves the post to the top")
        assert api_order(w.client("vie"), w.id)[ideas] == w.pids("c", "a", "b")


def test_wf_loupe_comments_keyboard(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Lake {t}", body=f"Swim at noon {t}", comments=[{"author": "mod", "text": "Yes!"}]),
                              P("b", "Ideas", "con", f"Hill {t}")])
    a, b = w.titles["a"], w.titles["b"]
    with screen(browser, app_url, w.path, w.sess("vie")) as page:
        fa, fb = frame(page, a), frame(page, b)
        fa.evaluate("e => { e.__pinsheetMark = true; }")
        fa.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: fa.get_attribute("data-loupe") == "open", "Enter opens the loupe")
        assert fa.evaluate("e => e.__pinsheetMark === true"), "the loupe is the frame element itself (L118)"
        heading = fa.get_by_role("heading", name=a, level=2)
        eventually(page, lambda: is_focused(heading), "focus moves to the loupe's level-2 heading (L219)")
        content = norm(fa.text_content())
        assert w.name("con") in content and f"Swim at noon {t}" in content, "the loupe shows the author's name and the full text"
        comments = fa.get_by_role("list", name="Comments")
        eventually(page, lambda: comments.get_by_role("listitem").count() == 1 and w.name("mod") in norm(comments.text_content()),
                   "the loupe lists the seeded comment")
        assert fa.get_by_role("button", name="Close", exact=True).count() == 1
        page.keyboard.press("Tab")
        assert focused_post(page) == w.pid("a") and not is_focused(heading), "Tab moves through the loupe's controls"
        page.keyboard.press("Escape")
        eventually(page, lambda: fa.get_attribute("data-loupe") == "closed" and is_focused(fa), "Escape closes and returns focus to the frame")
        click(fb)
        eventually(page, lambda: fb.get_attribute("data-loupe") == "open", "a click opens the loupe")
        click(fa)
        eventually(page, lambda: fa.get_attribute("data-loupe") == "open" and fb.get_attribute("data-loupe") == "closed",
                   "opening another loupe closes the first (L222)")
        click(fa.get_by_role("button", name="Close", exact=True))
        eventually(page, lambda: fa.get_attribute("data-loupe") == "closed" and is_focused(fa), "Close returns focus to the frame")


def test_wf_loupe_comments_touch(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Dune {t}")])
    a = w.titles["a"]
    with screen(browser, app_url, w.path, w.sess("vie"), viewport=PHONE, touch=True) as page:
        fa = frame(page, a)
        tap(fa)
        eventually(page, lambda: fa.get_attribute("data-loupe") == "open", "a tap opens the loupe")
        tap(fa.get_by_role("heading", name=a, level=2))
        eventually(page, lambda: fa.get_attribute("data-loupe") == "closed", "a second tap outside its controls closes it (L221)")
        eventually(page, lambda: is_focused(fa), "focus returns to the frame")


@pytest.mark.parametrize("mode", MOTION_IDS, ids=MOTION_IDS)
def test_loupe_motion(browser: Browser, app_url: str, mode: str) -> None:
    reduced = mode == "reduced"
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Reed {t}"), P("b", "Ideas", "con", f"Rush {t}"), P("c", "Ideas", "con", f"Sedge {t}")])
    with screen(browser, app_url, w.path, w.sess("vie"), reduced=reduced) as page:
        fb, fa = frame(page, w.titles["b"]), frame(page, w.titles["a"])
        closed_h = fb.bounding_box()["height"]
        start_recording(page)
        fb.focus()
        page.keyboard.press("Enter")
        if reduced:
            advance(page, FRAME_MS)
            assert fb.bounding_box()["height"] >= LOUPE_SCALE * closed_h - PX_SLACK, "under reduced motion the loupe opens at full size at once"
        else:
            grow, _ = motion_ms(page, lambda: (fb.bounding_box(), fa.bounding_box()), lambda r: r["post"] == w.pid("b"), LOUPE_MIN_MS)
            assert LOUPE_MIN_MS <= grow <= LOUPE_MAX_MS, f"the loupe grows in 200-360 ms (L288): {grow}"
        pump(page)
        assert fb.get_attribute("data-loupe") == "open"
        assert fb.bounding_box()["height"] >= LOUPE_SCALE * closed_h - PX_SLACK, "the open loupe is four times the frame's height (L118)"
        if not reduced:
            dim = style(fa, "opacity", "filter")
            assert float(dim["opacity"]) < 1 or "brightness" in dim["filter"], f"neighbours dim while the loupe is open: {dim}"
        start_recording(page)
        page.keyboard.press("Escape")
        if reduced:
            advance(page, FRAME_MS)
            assert abs(fb.bounding_box()["height"] - closed_h) <= PX_SLACK, "under reduced motion the loupe closes at once"
        else:
            shrink, _ = motion_ms(page, lambda: fb.bounding_box(), lambda r: r["post"] == w.pid("b"), LOUPE_MIN_MS)
            assert LOUPE_MIN_MS <= shrink <= LOUPE_MAX_MS, f"closing reverses over the same range (L290): {shrink}"
        pump(page)
        assert fb.get_attribute("data-loupe") == "closed" and abs(fb.bounding_box()["height"] - closed_h) <= PX_SLACK


def test_loupe_follows_live_move(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a = w.titles["a"]
    with screen(browser, app_url, w.path, w.sess("vie")) as page:
        fa = open_loupe(page, a)
        answers(move(w.client("mod"), w.pid("a"), w.sec("Booked"), 1), 200)
        hear(page, f"{a} moved to Booked, position 1 of 3.")
        eventually(page, lambda: fa.get_attribute("data-section-id") == w.sec("Booked") and fa.get_attribute("data-position") == "1",
                   "the frame now sits in Booked at position 1")
        assert fa.get_attribute("data-loupe") == "open", "the loupe stays open on the moved post (L289)"
        assert region(page, "Booked").get_by_role("article", name=a, exact=True).count() == 1
        shows_order(page, {w.sec("Booked"): w.pids("a", "x", "y")}, "the screen matches the move")


def test_live_comments(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "co2", f"Bonfire {t}")])
    title = w.titles["p"]
    with ExitStack() as stack:
        third = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        viewer = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        page = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        vf = open_loupe(viewer, title)
        f = open_loupe(page, title)
        box = f.get_by_role("textbox", name="Add a comment", exact=True)
        box.focus()
        page.keyboard.type(f"Bring marshmallows {t}")
        page.keyboard.press("Shift+Enter")
        page.keyboard.type("and sticks")
        assert f.get_by_text(f"{len(box.input_value())}/{COMMENT_MAX}").count() > 0, "the comment counter shows <used>/500 (L152)"
        page.keyboard.press("Enter")
        eventually(page, lambda: box.input_value() == "" and is_focused(box), "after sending the box empties and keeps focus (L225)")
        comments = w.client("vie").get(f"/api/posts/{w.pid('p')}/comments").json()["comments"]
        assert len(comments) == 1 and comments[0]["text"] == f"Bring marshmallows {t}\nand sticks", "Shift+Enter starts a new line, Enter sends"
        assert comments[0]["author"]["display_name"] == w.name("con")
        eventually(viewer, lambda: f"Bring marshmallows {t}" in norm(vf.get_by_role("list", name="Comments").text_content()),
                   "the viewer's open loupe shows the new comment")
        assert w.name("con") in norm(vf.get_by_role("list", name="Comments").text_content())
        for p in (viewer, third, page):
            eventually(p, lambda p=p: frame(p, title).get_attribute("data-comments") == "1", "data-comments rises on every screen")


COMMENT_IDS = ["single", "at_limit", "emoji_at_limit", "blank", "over_limit"]


def comment_case(case: str) -> tuple[str, str | None]:
    return {"single": ("A", None), "at_limit": ("c" * COMMENT_MAX, None), "emoji_at_limit": ("\U0001F642" * COMMENT_MAX, None),
            "blank": ("   ", "Write a comment first."), "over_limit": ("c" * (COMMENT_MAX + 1), "Comments can be at most 500 characters.")}[case]


@pytest.mark.parametrize("case", COMMENT_IDS, ids=COMMENT_IDS)
def test_comment_limits(browser: Browser, app_url: str, case: str) -> None:
    value, refusal = comment_case(case)
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "co2", f"Quarry {t}")])
    pid, title = w.pid("p"), w.titles["p"]
    r = w.client("con").post(f"/api/posts/{pid}/comments", json={"text": value})
    if refusal:
        answers(r, 422, {"errors": {"text": refusal}}, case)
    else:
        answers(r, 201, what=case)
        assert r.json()["text"] == value.strip() and r.json()["author"]["display_name"] == w.name("con")
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        f = open_loupe(page, title)
        box = f.get_by_role("textbox", name="Add a comment", exact=True)
        box.fill(value)
        if case == "at_limit":
            assert f.get_by_text(f"{COMMENT_MAX}/{COMMENT_MAX}").count() > 0, "the counter shows 500/500 (L152)"
        typed = box.input_value()
        if refusal and len(typed) != len(value):
            assert len(typed) <= COMMENT_MAX
        else:
            box.focus()
            page.keyboard.press("Enter")
            if refusal:
                eventually(page, lambda: f.get_by_text(refusal, exact=True).count() > 0, f'the loupe shows "{refusal}" under the box')
            else:
                eventually(page, lambda: f.get_by_role("list", name="Comments").get_by_role("listitem").count() == 2,
                           "the UI comment joins the list")
    stored = w.client("vie").get(f"/api/posts/{pid}/comments").json()["comments"]
    assert len(stored) == (0 if refusal else 2), f"{case}: stored comments {len(stored)}"


def test_names_without_emails(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", approval=True,
              posts=[P("p", "Ideas", "con", f"Cabin {t}", comments=[{"author": "mod", "text": "Booked"}, {"author": "vie", "text": "Nice"}]),
                     P("h", "Ideas", "co2", f"Held {t}", state="awaiting_approval")])
    emails = [u["email"].lower() for u in w.users.values()]

    def clean(body: str, what: str, allow: str | None = None) -> None:
        low = body.lower()
        leaked = [e for e in emails if e in low and e != (allow or "").lower()]
        assert not leaked, f"{what} leaks emails {leaked}"

    for who in ("vie", "con", "mod", "co2", "out", None):
        cl = w.client(who)
        paths = [f"/api/boards/{w.id}", f"/api/boards/{w.id}/posts", f"/api/posts/{w.pid('p')}",
                 f"/api/posts/{w.pid('p')}/comments", f"/api/links/{w.token}"]
        if who:
            paths += ["/api/boards", "/api/me"]
        for path in paths:
            r = cl.get(path)
            assert r.status_code == 200, f"{who} GET {path}: {r.status_code}"
            clean(r.text, f"{who} GET {path}", w.email(who) if who and path == "/api/me" else None)
    comments = w.client("vie").get(f"/api/posts/{w.pid('p')}/comments").json()["comments"]
    assert [c["author"]["display_name"] for c in comments] == [w.name("mod"), w.name("vie")]
    assert all(set(c["author"]) <= {"id", "display_name"} for c in comments), "comment authors carry id and display_name only (L644)"
    members = w.client("own").get(f"/api/boards/{w.id}/members").json()["members"]
    assert {m["email"].lower() for m in members} >= {w.email("con").lower(), w.email("vie").lower()}, "owner's member list shows emails"
    assert all(set(m) <= {"user_id", "display_name", "email", "role"} for m in members)
    answers(w.client("mod").get(f"/api/boards/{w.id}/members"), 403, {"error": "forbidden"}, "moderator reading members")
    with screen(browser, app_url, w.path, w.sess("vie")) as page:
        open_loupe(page, w.titles["p"])
        clean(page.content(), "viewer board page")
    with screen(browser, app_url, f"/s/{w.token}") as page:
        clean(page.content(), "share page")


def test_wf_approval_journey(browser: Browser, app_url: str, ntfy: Ntfy) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "mod", f"Agenda {t}")])
    title, body = f"Lantern walk {t}", f"Meet at the gate {t}"
    topic = f"pinsheet-approvals-{w.id}"
    with ExitStack() as stack:
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        dlg = open_dialog(con, "Add post", "Add post")
        fill(dlg.get_by_role("textbox", name="Title", exact=True), title)
        fill(dlg.get_by_role("textbox", name="Text", exact=True), body)
        click(dlg.get_by_role("button", name="Post", exact=True))
        hear(con, f"Sent {title} for approval.")
        waiting = region(con, "Waiting for approval")
        note = "Only you and the people who moderate this board can see these posts until they're approved."
        eventually(con, lambda: note in norm(waiting.text_content()), "the held-post note heads Waiting for approval (L341)")
        held_frame = waiting.get_by_role("article", name=title, exact=True)
        assert held_frame.get_attribute("data-state") == "awaiting_approval" and held_frame.get_attribute("data-position") is None
        assert "Awaiting approval" in norm(held_frame.text_content())
        pid = next(p["id"] for p in listing(w.client("con"), w.id)["held"] if p["title"] == title)
        mine = w.client("con").get(f"/api/posts/{pid}").json()
        assert (mine["state"], mine["position"], mine["push"]) == ("awaiting_approval", None, None)
        approvals = region(mod, "Approvals")
        eventually(mod, lambda: approvals.get_by_role("article", name=title, exact=True).count() == 1, "the moderator sees it in Approvals")
        assert mod.get_by_role("heading", name="Approvals (1)").count() == 1
        within(lambda: w.client("mod").get(f"/api/posts/{pid}").json()["push"] == "sent", "push state becomes sent once ntfy accepts", PUSH_WAIT_S)
        msgs = ntfy.messages(topic, expected=1, timeout=PUSH_WAIT_S)
        assert len(msgs) == 1, f"holding a post publishes exactly one push: {msgs}"
        assert msgs[0].get("title") == f"Post waiting on {w.title}" and msgs[0].get("message") == title
        dump = json.dumps(msgs[0]).lower()
        assert all(x.lower() not in dump for x in (w.name("con"), w.email("con"), body)), "the push names only board and title"
        answers(w.client("vie").get(f"/api/posts/{pid}"), 404, {"error": "not_found"}, "viewer reading the held post")
        assert frame(vie, title).count() == 0, "the viewer sees nothing of the held post"
        answers(create_post(w.client("mod"), w.id, w.sec("Ideas"), f"Mod note {t}"), 201)
        approve = approvals.get_by_role("button", name=f"Approve {title}", exact=True)
        approve.focus()
        mod.keyboard.press("Enter")
        eventually(mod, lambda: is_focused(mod.get_by_role("heading", name="Approvals (0)")), "focus moves to the Approvals heading")
        hear(con, f"Your post {title} was approved.")
        eventually(vie, lambda: dom_order(vie).get(w.sec("Ideas"), [])[-1:] == [pid], "the approved post appears last in its section")
        post = w.client("vie").get(f"/api/posts/{pid}").json()
        assert (post["state"], post["position"]) == ("published", 3), "approving puts the post last at that moment (L574)"
        assert len(ntfy.messages(topic, expected=1, timeout=PUSH_WAIT_S)) == 1, "approval and unheld posts send no push"


def test_held_posts_stay_private(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", approval=True,
              posts=[P("p", "Ideas", "con", f"Public {t}"), P("h", "Ideas", "co2", f"Secret {t}", state="awaiting_approval")])
    hid, held = w.pid("h"), w.titles["h"]
    for who in ("vie", "con", "out", None):
        cl = w.client(who)
        answers(cl.get(f"/api/posts/{hid}"), 404, {"error": "not_found"}, f"{who} GET held post")
        answers(cl.get(f"/api/posts/{hid}/comments"), 404, {"error": "not_found"}, f"{who} GET held comments")
        assert hid not in all_ids(listing(cl, w.id)), f"{who} listing omits the held post"
    assert hid not in all_ids(w.client().get(f"/api/links/{w.token}").json()["posts"])
    answers(w.client("co2").get(f"/api/posts/{hid}"), 200, what="author reads own held post")
    answers(w.client("mod").get(f"/api/posts/{hid}"), 200, what="moderator reads held post")
    assert held not in w.client("mod").get(f"/api/boards/{w.id}/export.csv").text
    with screen(browser, app_url, f"/embed/{w.token}") as embed, screen(browser, app_url, f"/s/{w.token}") as share, \
            screen(browser, app_url, w.path, w.sess("vie")) as vie:
        for page in (embed, share, vie):
            assert frame(page, held).count() == 0 and held not in page.content()
        click(vie.get_by_role("button", name="Present", exact=True))
        status = vie.get_by_role("dialog", name="Slideshow").get_by_role("status", name="Slide position")
        eventually(vie, lambda: norm(status.text_content()) == "Post 1 of 1", "the slideshow counts only published posts")
    answers(w.client("mod").post(f"/api/posts/{hid}/reject"), 204)
    for who in ("co2", "mod", "own"):
        answers(w.client(who).get(f"/api/posts/{hid}"), 404, {"error": "not_found"}, f"{who} GET rejected post")


def test_wf_approval_queue(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "con", f"Kept {t}"), P("h1", "Ideas", "con", f"First {t}", state="awaiting_approval"),
                                             P("h2", "Booked", "co2", f"Second {t}", state="awaiting_approval")])
    h1, h2 = w.titles["h1"], w.titles["h2"]
    with ExitStack() as stack:
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        co2 = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        queue = region(mod, "Approvals")
        queue.get_by_role("button", name=f"Approve {h1}", exact=True).focus()
        names = tab_order(mod, 3)
        assert f"Reject {h1}" in names and f"Approve {h2}" in names and names.index(f"Reject {h1}") < names.index(f"Approve {h2}"), \
            f"Tab reaches Approve and Reject in creation order: {names}"
        queue.get_by_role("button", name=f"Reject {h1}", exact=True).focus()
        mod.keyboard.press("Enter")
        approve2 = queue.get_by_role("button", name=f"Approve {h2}", exact=True)
        eventually(mod, lambda: is_focused(approve2), "focus moves to the next held post's Approve")
        hear(con, f"Your post {h1} was not approved.")
        answers(w.client("con").get(f"/api/posts/{w.pid('h1')}"), 404, {"error": "not_found"}, "rejected post for its author")
        mod.keyboard.press("Space")
        eventually(mod, lambda: is_focused(mod.get_by_role("heading", name="Approvals (0)")), "focus moves to the heading when none is left")
        assert "Nothing is waiting for approval." in norm(queue.text_content())
        hear(co2, f"Your post {h2} was approved.")
        shows_order(vie, {w.sec("Booked"): w.pids("h2"), w.sec("Ideas"): w.pids("a")}, "viewer sees the approval live")
        answers(w.client("mod").post(f"/api/posts/{w.pid('h2')}/approve"), 409, {"error": "not_held"}, "approving twice")


def test_wf_approval_push_down(browser: Browser, app_url: str) -> None:
    base = outage("PUSH_DOWN_URL")
    t = tag()
    w = world(base, approval=True)
    title = f"Pending {t}"
    r = create_post(w.client("con"), w.id, w.sec("Ideas"), title)
    answers(r, 201)
    assert r.json()["state"] == "awaiting_approval"
    assert w.client("mod").get(f"/api/posts/{r.json()['id']}").json()["push"] == "pending"
    with screen(browser, base, w.path, w.sess("mod")) as page:
        queue = region(page, "Approvals")
        eventually(page, lambda: "Push pending" in norm(queue.text_content()), "Approvals shows Push pending")
        banner = "Moderator alerts can't be sent right now. Held posts still wait in Approvals."
        eventually(page, lambda: banner in norm(region(page, "Service notice").text_content()), "push banner shows", BANNER_S + LIVE_WAIT_S)
    within(lambda: api(base).get("/api/health").json() == {"status": "unavailable"}, "health reports unavailable", BANNER_S)


FORBIDDEN_IDS = ["approve_own", "approve_by_contributor", "role_by_moderator", "remove_by_moderator", "settings_by_moderator",
                 "rotate_by_moderator", "invite_by_moderator", "delete_board_by_moderator", "export_by_contributor",
                 "comment_by_viewer", "post_by_viewer", "move_others", "delete_others", "edit_by_moderator"]


@pytest.mark.parametrize("case", FORBIDDEN_IDS, ids=FORBIDDEN_IDS)
def test_role_restricted_refused(app_url: str, mail: Mailpit, case: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("h", "Ideas", "con", f"Held {t}", state="awaiting_approval"),
                                             P("m", "Ideas", "mod", f"Mod {t}"), P("c", "Ideas", "con", f"Con {t}")])
    b, invitee = f"/api/boards/{w.id}", person("inv")[1]
    calls: dict[str, tuple[str, str, str, Any]] = {
        "approve_own": ("con", "POST", f"/api/posts/{w.pid('h')}/approve", None),
        "approve_by_contributor": ("con", "POST", f"/api/posts/{w.pid('c')}/approve", None),
        "role_by_moderator": ("mod", "PATCH", f"{b}/members/{w.uid('con')}", {"role": "viewer"}),
        "remove_by_moderator": ("mod", "DELETE", f"{b}/members/{w.uid('vie')}", None),
        "settings_by_moderator": ("mod", "PATCH", b, {"approval": False}),
        "rotate_by_moderator": ("mod", "POST", f"{b}/rotate-link", None),
        "invite_by_moderator": ("mod", "POST", f"{b}/invites", {"email": invitee, "role": "viewer"}),
        "delete_board_by_moderator": ("mod", "DELETE", b, None),
        "export_by_contributor": ("con", "GET", f"{b}/export.csv", None),
        "comment_by_viewer": ("vie", "POST", f"/api/posts/{w.pid('c')}/comments", {"text": "hi"}),
        "post_by_viewer": ("vie", "POST", "", None),
        "move_others": ("con", "PATCH", f"/api/posts/{w.pid('m')}/move", {"section_id": w.sec("Booked"), "position": 1, "version": 1}),
        "delete_others": ("con", "DELETE", f"/api/posts/{w.pid('m')}", None),
        "edit_by_moderator": ("mod", "PATCH", f"/api/posts/{w.pid('c')}", {"title": "x", "version": 1}),
    }
    who, method, path, body = calls[case]
    before = (listing(w.client("own"), w.id), w.client("own").get(b).json(), w.client("own").get(f"{b}/members").json())
    if case == "post_by_viewer":
        r = create_post(w.client("vie"), w.id, w.sec("Ideas"), f"Nope {t}")
    else:
        r = w.client(who).request(method, path, json=body)
    answers(r, 403, {"error": "forbidden"}, case)
    after = (listing(w.client("own"), w.id), w.client("own").get(b).json(), w.client("own").get(f"{b}/members").json())
    assert after == before, f"{case}: a refused request changed state"
    if case == "invite_by_moderator":
        assert mail_now(mail, invitee) == [], "a refused invite sends no mail"


ROLE_IDS = ["viewer", "contributor", "moderator", "owner", "stranger", "nonmember"]
ROLE_RANK = {"stranger": 0, "nonmember": 0, "viewer": 1, "contributor": 2, "moderator": 3, "owner": 4}
ROLE_USER = {"viewer": "vie", "contributor": "con", "moderator": "mod", "owner": "own", "stranger": None, "nonmember": "out"}


@pytest.mark.parametrize("role", ROLE_IDS, ids=ROLE_IDS)
def test_controls_follow_role(browser: Browser, app_url: str, role: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", approval=True, posts=[P("q", "Ideas", "co2", f"Theirs {t}"), P("r", "Ideas", "con", f"Mine {t}"),
                                                               P("h", "Booked", "co2", f"Wait {t}", state="awaiting_approval")])
    rank, who = ROLE_RANK[role], ROLE_USER[role]
    q, r = w.titles["q"], w.titles["r"]

    def expect(scope: Page | Locator, kind: str, name: str, shown: bool) -> None:
        loc = scope.get_by_role(kind, name=name, exact=True)
        if shown:
            assert loc.count() > 0 and loc.first.is_enabled(), f'{role} should see enabled {kind} "{name}"'
        else:
            assert loc.count() == 0, f'{role} must not have {kind} "{name}" on the page (L129)'

    with screen(browser, app_url, w.path, w.sess(who) if who else None) as page:
        expect(page, "button", "Present", True)
        expect(page, "button", "Add post", rank >= 2)
        expect(page, "button", "Export CSV", rank >= 3)
        expect(page, "button", "Board settings", rank == 4)
        expect(page, "button", "Members", rank == 4)
        expect(page, "toolbar", "Board view", rank == 4)
        expect(page, "region", "Approvals", rank >= 3)
        expect(page, "link", "Sign in", role == "stranger")
        expect(page, "button", "Sign out", role != "stranger")
        fq = open_loupe(page, q)
        for name in (f"Like {q}", f"Vote up {q}", f"Vote down {q}"):
            expect(fq, "button", name, rank >= 1)
        expect(fq, "textbox", "Add a comment", rank >= 2)
        expect(fq, "button", f"Edit {q}", rank == 4)
        expect(fq, "button", f"Delete {q}", rank >= 3)
        expect(fq, "list", "Comments", True)
        page.keyboard.press("Escape")
        fr = open_loupe(page, r)
        expect(fr, "button", f"Edit {r}", role in ("contributor", "owner"))
        expect(fr, "button", f"Delete {r}", role in ("contributor", "moderator", "owner"))


def test_wf_roles_invite_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    t = tag()
    w = world(app_url, title=f"Spring trip {t}", extra=("out", "inv"))
    email = w.email("inv")
    with screen(browser, app_url, w.path, w.sess("own")) as page:
        dlg = open_dialog(page, "Members", "Members")
        fill(dlg.get_by_role("textbox", name="Invite by email", exact=True), email)
        select(dlg.get_by_role("combobox", name="Invite role", exact=True), "Contributor")
        dlg.get_by_role("textbox", name="Invite by email", exact=True).focus()
        page.keyboard.press("Enter")
        status = dlg.get_by_role("status", name="Invite status")
        eventually(page, lambda: norm(status.text_content()) == f"Invite sent to {email}.", "the invite status line")
    msg = mail_to(mail, email)[-1]
    assert msg.get("Subject") == f"{w.name('own')} invited you to {w.title} on Pinsheet"
    body = norm(text(msg))
    found = re.search(rf"{re.escape(w.name('own'))} invited you to {re.escape(w.title)} as a contributor\. Open (\S+)/invite/(\S+) to join\.", body)
    assert found, f"invite body follows the published sentence: {body[:300]}"
    token = found.group(2)
    for k in ("con", "mod", "vie", "co2"):
        assert w.name(k) not in body and w.email(k) not in body, "the invite names no other member"
    info = w.client().get(f"/api/invites/{token}").json()
    assert info == {**info, "board_title": w.title, "inviter_name": w.name("own"), "role": "contributor", "expired": False}
    assert set(info) <= {"board_title", "inviter_name", "role", "expired"}
    with screen(browser, app_url, f"/invite/{token}", w.sess("inv"), live=False) as page:
        eventually(page, lambda: w.title in norm(page.content()) and w.name("own") in norm(page.content()), "the invite page names board and inviter")
        click(page.get_by_role("button", name="Join board", exact=True))
        eventually(page, lambda: page.url.split("?")[0].endswith(w.path), "the invitee lands on the board")
        eventually(page, lambda: page.get_by_role("button", name="Add post", exact=True).count() > 0, "the contributor sees Add post")
    assert w.client("inv").get(f"/api/boards/{w.id}").json()["role"] == "contributor"
    answers(w.client("inv").post(f"/api/invites/{token}/accept"), 410, {"error": "invite_expired"}, "reusing the invite")
    assert w.client().get(f"/api/invites/{token}").json()["expired"] is True
    answers(w.client("own").post(f"/api/boards/{w.id}/invites", json={"email": w.email("con"), "role": "viewer"}), 422,
            {"errors": {"email": f"{w.email('con')} is already on this board."}}, "inviting a member")


def test_signup_with_code(browser: Browser, app_url: str, mail: Mailpit) -> None:
    name, email = person("new")
    pending_name, pending = person("pend")
    answers(api(app_url).post("/api/auth/signup", json={"display_name": pending_name, "email": pending, "password": PASSWORD}), 202,
            {"status": "code_sent"})
    answers(api(app_url).post("/api/auth/signin", json={"email": pending, "password": PASSWORD}), 403, {"error": "unconfirmed"})
    with screen(browser, app_url, "/signin", live=False) as other:
        fill(field(other, "Email"), pending)
        fill(field(other, "Password"), PASSWORD)
        click(other.get_by_role("button", name="Sign in", exact=True))
        eventually(other, lambda: other.get_by_text("Confirm your email first.").count() > 0, "unconfirmed message")
    with screen(browser, app_url, "/signup", live=False) as page:
        fill(field(page, "Display name"), name)
        fill(field(page, "Email"), email)
        fill(field(page, "Password"), PASSWORD)
        click(page.get_by_role("button", name="Create account", exact=True))
        eventually(page, lambda: page.get_by_text(f"We sent a 6-digit code to {email}.").count() > 0, "code step")
        code = code_from(mail, email)
        fill(field(page, "Code"), str((int(code) + 1) % 10 ** 6).zfill(6))
        click(page.get_by_role("button", name="Confirm email", exact=True))
        eventually(page, lambda: page.get_by_text("That code is wrong or has expired.").count() > 0, "wrong code message")
        fill(field(page, "Code"), code)
        click(page.get_by_role("button", name="Confirm email", exact=True))
        eventually(page, lambda: page.get_by_role("heading", name="Your boards").count() > 0, "lands on the dashboard")
    r = api(app_url).post("/api/auth/signin", json={"email": email, "password": PASSWORD})
    answers(r, 200)
    assert r.json()["user"]["email"] == email and r.json()["user"]["display_name"] == name
    answers(api(app_url).post("/api/auth/signin", json={"email": email, "password": PASSWORD + "x"}), 401, {"error": "wrong_credentials"})
    with screen(browser, app_url, "/signin", live=False) as page:
        fill(field(page, "Email"), email)
        fill(field(page, "Password"), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in", exact=True))
        eventually(page, lambda: page.get_by_text("That email and password don't match.").count() > 0, "wrong credentials message")
    cl = api(app_url)
    answers(cl.post("/api/auth/signup", json={"display_name": name, "email": email, "password": PASSWORD}), 422,
            {"errors": {"email": "That email already has an account."}})
    answers(cl.post("/api/auth/signup", json={"display_name": "n" * (NAME_MAX + 1), "email": person("x")[1], "password": PASSWORD}), 422,
            {"errors": {"display_name": "Display names are 1 to 40 characters."}})
    answers(cl.post("/api/auth/signup", json={"display_name": name, "email": person("y")[1], "password": "short12"}), 422,
            {"errors": {"password": "Passwords are 8 to 72 characters."}})


@pytest.mark.timeout(600)
def test_signup_code_expires(browser: Browser, app_url: str, mail: Mailpit) -> None:
    name, email = person("late")
    answers(api(app_url).post("/api/auth/signup", json={"display_name": name, "email": email, "password": PASSWORD}), 202, {"status": "code_sent"})
    code = code_from(mail, email)
    w = world(app_url)
    inv = person("inv")[1]
    answers(w.client("own").post(f"/api/boards/{w.id}/invites", json={"email": inv, "role": "viewer"}), 201)
    token = re.search(r"/invite/(\S+) to join\.", norm(text(mail_to(mail, inv)[-1]))).group(1)
    within(lambda: w.client().get(f"/api/invites/{token}").json()["expired"] is True, "the invite expires", EXPIRY_WAIT_S)
    answers(api(app_url).post("/api/auth/verify", json={"email": email, "code": code}), 422,
            {"errors": {"code": "That code is wrong or has expired."}}, "expired code")
    answers(w.client("out").post(f"/api/invites/{token}/accept"), 410, {"error": "invite_expired"})
    with screen(browser, app_url, f"/invite/{token}", live=False) as page:
        eventually(page, lambda: page.get_by_role("heading", name="This invite has expired.").count() > 0, "expired invite heading")


def test_wf_roles_invite_demote(browser: Browser, app_url: str) -> None:
    w = world(app_url, posts=[P("p", "Ideas", "co2", f"Sun {tag()}")])
    with screen(browser, app_url, w.path, w.sess("con")) as con, screen(browser, app_url, w.path, w.sess("own")) as own:
        assert con.get_by_role("button", name="Add post", exact=True).count() > 0
        dlg = open_dialog(own, "Members", "Members")
        select(dlg.get_by_role("combobox", name=f"Role for {w.name('con')}", exact=True), "Viewer")
        within(lambda: next(m for m in w.client("own").get(f"/api/boards/{w.id}/members").json()["members"]
                            if m["user_id"] == w.uid("con"))["role"] == "viewer", "the role change is saved", LIVE_WAIT_S)
        eventually(con, lambda: con.get_by_role("button", name="Add post", exact=True).count() == 0, "Add post disappears live")
        hear(con, f"Your role on {w.title} is now Viewer.")
        answers(create_post(w.client("con"), w.id, w.sec("Ideas"), "Late"), 403, {"error": "forbidden"}, "next post after demotion")
        answers(w.client("con").put(f"/api/posts/{w.pid('p')}/like"), 200, what="a viewer may still like")
        click(dlg.get_by_role("button", name=f"Remove {w.name('con')}", exact=True))
        eventually(con, lambda: con.get_by_role("heading", name="Board not found").count() > 0, "removed member sees not-found")
        answers(w.client("con").get(f"/api/boards/{w.id}"), 404, {"error": "not_found"})


def test_wf_roles_invite_mail_down(browser: Browser, mail: Mailpit) -> None:
    base = outage("MAIL_DOWN_URL")
    name, email = person("nomail")
    with screen(browser, base, "/signup", live=False) as page:
        fill(field(page, "Display name"), name)
        fill(field(page, "Email"), email)
        fill(field(page, "Password"), PASSWORD)
        click(page.get_by_role("button", name="Create account", exact=True))
        eventually(page, lambda: page.get_by_text("We can't send your code right now. Try again in a few minutes.").count() > 0, "sign-up mail alert")
    other = person("nomail2")[1]
    answers(api(base).post("/api/auth/signup", json={"display_name": name, "email": other, "password": PASSWORD}), 503, {"error": "mail_unavailable"})
    for e in (email, other):
        answers(api(base).post("/api/auth/signin", json={"email": e, "password": PASSWORD}), 401, {"error": "wrong_credentials"}, "no account stored")
    w = world(base)
    invitee = person("inv")[1]
    with screen(browser, base, w.path, w.sess("own")) as page:
        dlg = open_dialog(page, "Members", "Members")
        fill(dlg.get_by_role("textbox", name="Invite by email", exact=True), invitee)
        click(dlg.get_by_role("button", name="Send invite", exact=True))
        eventually(page, lambda: "Invites can't be sent right now. Try again in a few minutes." in norm(dlg.get_by_role("alert").first.text_content()),
                   "invite mail alert")
    answers(w.client("own").post(f"/api/boards/{w.id}/invites", json={"email": invitee, "role": "viewer"}), 503, {"error": "mail_unavailable"})
    assert invitee not in json.dumps(w.client("own").get(f"/api/boards/{w.id}/members").json())
    assert mail_now(mail, invitee) == [] and mail_now(mail, email) == []


def test_wf_privacy_share_private(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "con", f"Hidden {t}")])
    other = world(app_url)
    att = create_post(w.client("con"), w.id, w.sec("Ideas"), f"Pic {t}", file=("pic.png", PNG)).json()["attachment"]
    unknown = str(uuid.uuid4())
    nf = {"error": "not_found"}
    for cl in (w.client("out"), w.client()):
        for path in (f"/api/boards/{w.id}", f"/api/boards/{w.id}/posts", f"/api/posts/{w.pid('p')}", f"/api/posts/{w.pid('p')}/comments",
                     f"/api/boards/{w.id}/events", att["url"], f"/api/boards/{unknown}", f"/api/posts/{unknown}", f"/api/attachments/{unknown}"):
            answers(cl.get(path), 404, nf, path)
        answers(cl.put(f"/api/posts/{w.pid('p')}/like"), 404, nf, "like on a private board")
    answers(create_post(other.client("con"), other.id, w.sec("Ideas"), "Sneak"), 404, nf, "a section id from another board")
    pw = world(app_url, privacy="password", password=f"secret-{t}")
    answers(pw.client("out").get(f"/api/boards/{pw.id}"), 403, {"error": "password_required"})
    for path in (w.path, f"/b/{unknown}"):
        with screen(browser, app_url, path, w.sess("out"), live=False) as page:
            assert visit(page, app_url + path) == 404
            eventually(page, lambda: page.get_by_role("heading", name="Board not found").count() == 1, "the not-found heading shows")
            eventually(page, lambda: page.get_by_text("This board doesn't exist, or you don't have access to it.").count() > 0,
                       "the not-found line shows")
    with screen(browser, app_url, pw.path, live=False) as page:
        assert visit(page, app_url + pw.path) == 200
        eventually(page, lambda: page.get_by_role("heading", name="This board is password protected").count() == 1,
                   "the password screen heading shows")


def test_password_boards(browser: Browser, app_url: str) -> None:
    t = tag()
    pw1, pw2 = f"first-pass-{t}", f"second-pass-{t}"
    w = world(app_url, privacy="password", password=pw1, posts=[P("p", "Ideas", "con", f"Inside {t}")])
    cl = w.client()
    answers(cl.get(f"/api/boards/{w.id}"), 403, {"error": "password_required"})
    answers(cl.post(f"/api/boards/{w.id}/unlock", json={"password": "wrong-pass"}), 404, {"error": "not_found"})
    r = cl.post(f"/api/boards/{w.id}/unlock", json={"password": pw1})
    answers(r, 204)
    assert PASS_COOKIE in r.headers.get("set-cookie", "") and "HttpOnly".lower() in r.headers.get("set-cookie", "").lower()
    answers(cl.get(f"/api/boards/{w.id}/posts"), 200)
    answers(w.client("vie").get(f"/api/boards/{w.id}"), 200, what="members read without the password")
    pub = world(app_url, privacy="public")
    answers(pub.client().post(f"/api/boards/{pub.id}/unlock", json={"password": pw1}), 404, {"error": "not_found"})
    answers(w.client("own").patch(f"/api/boards/{w.id}", json={"password": "short"}), 422, {"errors": {"password": "Passwords are 8 to 64 characters."}})
    with screen(browser, app_url, w.path, live=False) as page:
        fill(field(page, "Board password"), "wrong-pass")
        click(page.get_by_role("button", name="Open board", exact=True))
        eventually(page, lambda: "That password didn't open this board." in norm(page.get_by_role("alert").first.text_content()), "wrong password alert")
        fill(field(page, "Board password"), pw1)
        click(page.get_by_role("button", name="Open board", exact=True))
        eventually(page, lambda: frame(page, w.titles["p"]).count() == 1, "the right password opens the board")
        cookie = next(c for c in page.context.cookies() if c["name"] == PASS_COOKIE)
        assert cookie["httpOnly"] and cookie["expires"] == -1, "the unlock is a browser-session cookie (L408)"
        answers(w.client("own").patch(f"/api/boards/{w.id}", json={"password": pw2}), 200)
        eventually(page, lambda: page.get_by_role("heading", name="This board is password protected").count() > 0, "the open screen turns into the password screen")
        answers(cl.get(f"/api/boards/{w.id}"), 403, {"error": "password_required"}, "old unlock after a password change")
        assert visit(page, app_url + w.path) == 200 and page.get_by_role("heading", name="This board is password protected").count() == 1


def test_share_links(browser: Browser, app_url: str) -> None:
    t = tag()
    v = world(app_url, privacy="public", link_access="view", posts=[P("p", "Ideas", "con", f"Look {t}")])
    data = v.client().get(f"/api/links/{v.token}")
    answers(data, 200)
    assert data.json()["board"]["id"] == v.id and data.json()["board"]["role"] is None
    answers(create_post(v.client(), v.id, v.sec("Ideas"), "x"), 401, {"error": "sign_in_required"}, "a read-only link writes nothing")
    with screen(browser, app_url, f"/s/{v.token}") as page:
        assert frame(page, v.titles["p"]).count() == 1 and page.get_by_role("button", name="Add post").count() == 0
    with screen(browser, app_url, f"/s/{v.token}", v.sess("out"), live=False) as page:
        eventually(page, lambda: page.url.split("?")[0].endswith(v.path), "a signed-in holder is taken to the board")
    assert v.client("out").get(f"/api/boards/{v.id}").json()["role"] == "viewer"
    c = world(app_url, privacy="password", password=f"pw-share-{t}", link_access="contribute")
    answers(c.client("out").post(f"/api/links/{c.token}/join"), 403, {"error": "password_required"})
    answers(c.client("out").get(f"/api/links/{c.token}"), 403, {"error": "password_required"})
    answers(c.client("out").post(f"/api/links/{c.token}/unlock", json={"password": "nope-nope"}), 404, {"error": "not_found"})
    outsider = c.client("out")
    answers(outsider.post(f"/api/links/{c.token}/unlock", json={"password": f"pw-share-{t}"}), 204)
    answers(outsider.post(f"/api/links/{c.token}/join"), 200, {"board_id": c.id, "role": "contributor"})
    answers(create_post(outsider, c.id, c.sec("Ideas"), f"Joined {t}"), 201)
    answers(c.client("mod").post(f"/api/links/{c.token}/join"), 200, {"board_id": c.id, "role": "moderator"}, "join never lowers")


def test_wf_privacy_share_rotate(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="password", password=f"pw-rot-{t}", link_access="view", posts=[P("p", "Ideas", "con", f"Map {t}")])
    old = w.token
    with screen(browser, app_url, f"/s/{old}", live=False) as page:
        assert visit(page, app_url + f"/s/{old}") == 200
        fill(field(page, "Board password"), "wrong-word")
        click(page.get_by_role("button", name="Open board", exact=True))
        eventually(page, lambda: "That password didn't open this board." in norm(page.get_by_role("alert").first.text_content()), "refused")
        fill(field(page, "Board password"), f"pw-rot-{t}")
        click(page.get_by_role("button", name="Open board", exact=True))
        eventually(page, lambda: frame(page, w.titles["p"]).count() == 1, "the stranger reads the board")
        with screen(browser, app_url, w.path, w.sess("own")) as own:
            dlg = open_dialog(own, "Board settings", "Board settings")
            click(dlg.get_by_role("button", name="Rotate link", exact=True))
            owner = w.client("own")

            def rotated() -> bool:
                sp = owner.get(f"/api/boards/{w.id}").json()["share_path"]
                if sp and sp.endswith(old) and dlg.get_by_role("button", name="Save settings").count():
                    click(dlg.get_by_role("button", name="Save settings", exact=True))
                return bool(sp) and not sp.endswith(old)
            eventually(own, rotated, "Rotate link replaces the token")
        eventually(page, lambda: page.get_by_role("heading", name="Board not found").count() > 0, "the stranger's screen turns not-found")
    answers(w.client().get(f"/api/links/{old}"), 404, {"error": "not_found"})
    new = w.client("own").get(f"/api/boards/{w.id}").json()["share_path"].rsplit("/", 1)[-1]
    answers(w.client("own").patch(f"/api/boards/{w.id}", json={"privacy": "private"}), 200)
    answers(w.client().get(f"/api/links/{new}"), 404, {"error": "not_found"}, "making the board private kills the link")


@pytest.mark.parametrize("mode", MOTION_IDS, ids=MOTION_IDS)
def test_wf_phone_upload_sheet(browser: Browser, app_url: str, mode: str) -> None:
    reduced = mode == "reduced"
    t = tag()
    w = world(app_url)
    title = f"Ridge photo {t}"
    with screen(browser, app_url, w.path, w.sess("con"), viewport=PHONE, touch=True, reduced=reduced) as page:
        start_recording(page)
        tap(page.get_by_role("button", name="Add post", exact=True))
        dlg = page.get_by_role("dialog", name="Add post", exact=True)
        if reduced:
            eventually(page, lambda: dialog_box(page) is not None, "the sheet appears")
            advance(page, 2 * FRAME_MS)
            first = dialog_box(page)
            pump(page)
            final = dialog_box(page)
            assert first and final and all(abs(x - y) <= PX_SLACK for x, y in zip(first, final)), \
                f"the sheet appears in place under reduced motion (L295): {first} then {final}"
        else:
            slide, _ = motion_ms(page, lambda: dialog_box(page), lambda r: r["dialog"], SHEET_MIN_MS)
            assert SHEET_MIN_MS <= slide <= SHEET_MAX_MS, f"the sheet slides up in 200-360 ms (L291): {slide}"
            pump(page)
        box = dlg.bounding_box()
        assert box and abs(box["y"] + box["height"] - PHONE["height"]) <= PX_SLACK, "the sheet sits on the bottom edge"
        tap(dlg.get_by_role("textbox", name="Title", exact=True))
        fill(dlg.get_by_role("textbox", name="Title", exact=True), title)
        with page.expect_file_chooser() as chooser:
            tap(dlg.get_by_role("button", name="Attach a file", exact=True))
        chooser.value.set_files(files=[{"name": PHOTO_NAME, "mimeType": "image/png", "buffer": PNG}])
        tap(dlg.get_by_role("button", name="Post", exact=True))
        heard_line(page, f"Posted {title}.")
        lines = heard(page)
        upload_line = f"Uploading {PHOTO_NAME}\u2026"
        assert upload_line in lines and lines.index(upload_line) < lines.index(f"Posted {title}."), lines
        post = next(p for s in listing(w.client("con"), w.id)["sections"] for p in s["posts"] if p["title"] == title)
        aid = post["attachment"]["id"]
        assert S3().get(f"boards/{w.id}/posts/{post['id']}/{aid}") == PNG
        eventually(page, lambda: bool(frame(page, title).evaluate(IMAGE_SHOWN_JS, aid)), "the frame shows the image")


def test_accepted_files(app_url: str) -> None:
    w = world(app_url)
    cl, store = w.client("con"), S3()
    cases: list[tuple[str, bytes, int, Any]] = [
        ("pic.png", PNG, 201, None), ("pic.jpg", JPEG, 201, None), ("pic.gif", GIF, 201, None), ("pic.webp", WEBP, 201, None),
        ("doc.pdf", PDF, 201, None), ("notes.txt", TEXT, 201, None), ("renamed.txt", PNG, 201, None),
        ("exact.png", padded(PNG, UPLOAD_MAX_BYTES), 201, None),
        ("big.png", padded(PNG, UPLOAD_MAX_BYTES + 1), 413, {"error": "file_too_large"}),
        ("fake.png", EXE, 415, {"error": "unsupported_type"}), ("logo.svg", SVG, 415, {"error": "unsupported_type"}),
        ("nul.txt", NUL_TEXT, 415, {"error": "unsupported_type"}), ("latin.txt", LATIN1_TEXT, 415, {"error": "unsupported_type"}),
    ]
    for name, data, status, body in cases:
        before_keys, before_ids = store.keys(f"boards/{w.id}/"), all_ids(listing(cl, w.id))
        r = create_post(cl, w.id, w.sec("Ideas"), f"File {name}", file=(name, data))
        answers(r, status, body, name)
        if status == 201:
            att = r.json()["attachment"]
            assert att["file_name"] == name and att["size"] == len(data)
            if name == "renamed.txt":
                assert att["content_type"] == "image/png", "type is judged by leading bytes, not name"
        else:
            assert store.keys(f"boards/{w.id}/") == before_keys and all_ids(listing(cl, w.id)) == before_ids, f"{name}: nothing stored"
    for given, stored in (("a/b/c.png", "c.png"), ("n" * 130 + ".png", "n" * 120), ("dir/", "file")):
        r = create_post(cl, w.id, w.sec("Ideas"), "Named", file=(given, PNG))
        answers(r, 201)
        assert r.json()["attachment"]["file_name"] == stored, f"{given!r} is stored as {stored!r} (L613)"


def test_wf_phone_upload_refused(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    title = f"Refused {tag()}"
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        dlg = open_dialog(page, "Add post", "Add post")
        fill(dlg.get_by_role("textbox", name="Title", exact=True), title)
        for name, data, msg in (("big.png", padded(PNG, UPLOAD_MAX_BYTES + 1), f"big.png is over the {LIMIT_TEXT} byte limit."),
                                ("logo.svg", SVG, "logo.svg isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.")):
            with page.expect_file_chooser() as chooser:
                click(dlg.get_by_role("button", name="Attach a file", exact=True))
            chooser.value.set_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])
            click(dlg.get_by_role("button", name="Post", exact=True))
            eventually(page, lambda m=msg: m in norm(dlg.get_by_role("alert").first.text_content()), f'alert "{msg}"')
            assert dlg.get_by_role("textbox", name="Title", exact=True).input_value() == title
    assert all_ids(listing(w.client("con"), w.id)) == set() and S3().keys(f"boards/{w.id}/") == []


def test_attached_after_storage_confirms(app_url: str) -> None:
    w = world(app_url)
    r = create_post(w.client("con"), w.id, w.sec("Ideas"), "Stored", file=("pic.png", PNG))
    answers(r, 201)
    post = r.json()
    aid = post["attachment"]["id"]
    assert post["attachment"]["url"] == f"/api/attachments/{aid}"
    key = f"boards/{w.id}/posts/{post['id']}/{aid}"
    assert S3().keys(f"boards/{w.id}/posts/{post['id']}/") == [key] and S3().get(key) == PNG
    assert w.client("vie").get(post["attachment"]["url"]).content == PNG


def test_guarded_attachment_urls(app_url: str) -> None:
    w = world(app_url)
    con, vie = w.client("con"), w.client("vie")
    png_post = create_post(con, w.id, w.sec("Ideas"), "Png", file=("pic.png", PNG)).json()
    pdf_post = create_post(con, w.id, w.sec("Ideas"), "Pdf", file=("doc.pdf", PDF)).json()
    r = vie.get(png_post["attachment"]["url"])
    answers(r, 200)
    assert r.content == PNG and r.headers["content-type"].startswith("image/png")
    assert r.headers["content-disposition"] == 'inline; filename="' + "pic.png" + '"' and r.headers["x-content-type-options"] == "nosniff"
    r = vie.get(pdf_post["attachment"]["url"])
    assert r.headers["content-disposition"] == 'attachment; filename="' + "doc.pdf" + '"' and r.content == PDF
    nf = {"error": "not_found"}
    for cl in (w.client("out"), w.client()):
        answers(cl.get(png_post["attachment"]["url"]), 404, nf)
    answers(w.client("own").patch(f"/api/boards/{w.id}", json={"approval": True}), 200)
    held = create_post(con, w.id, w.sec("Ideas"), "Held pic", file=("held.png", PNG)).json()
    answers(vie.get(held["attachment"]["url"]), 404, nf, "attachment of a held post")
    answers(con.get(held["attachment"]["url"]), 200, what="author reads own held attachment")
    answers(con.delete(f"/api/posts/{png_post['id']}"), 204)
    answers(vie.get(png_post["attachment"]["url"]), 404, nf, "attachment of a deleted post")


def test_wf_phone_upload_storage_down(browser: Browser) -> None:
    base = outage("STORAGE_DOWN_URL")
    w = world(base)
    title, body = f"Photo {tag()}", "Typed text stays"
    answers(create_post(w.client("con"), w.id, w.sec("Ideas"), "With file", file=("p.png", PNG)), 503, {"error": "storage_unavailable"})
    answers(create_post(w.client("con"), w.id, w.sec("Ideas"), "Plain"), 201, what="posts without files still work")
    with screen(browser, base, w.path, w.sess("con")) as page:
        banner = "File uploads are unavailable right now. Posts without files still work."
        eventually(page, lambda: banner in norm(region(page, "Service notice").text_content()), "storage banner", BANNER_S + LIVE_WAIT_S)
        dlg = open_dialog(page, "Add post", "Add post")
        fill(dlg.get_by_role("textbox", name="Title", exact=True), title)
        fill(dlg.get_by_role("textbox", name="Text", exact=True), body)
        with page.expect_file_chooser() as chooser:
            click(dlg.get_by_role("button", name="Attach a file", exact=True))
        chooser.value.set_files(files=[{"name": "p.png", "mimeType": "image/png", "buffer": PNG}])
        click(dlg.get_by_role("button", name="Post", exact=True))
        eventually(page, lambda: "Uploads are unavailable right now. Your post was not saved." in norm(dlg.get_by_role("alert").first.text_content()), "alert")
        assert dlg.get_by_role("textbox", name="Title", exact=True).input_value() == title
        assert dlg.get_by_role("textbox", name="Text", exact=True).input_value() == body
    assert title not in json.dumps(listing(w.client("con"), w.id))


def test_wf_embed_readonly_phone(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view",
              posts=[P(f"p{i}", s, "con", f"Embed {i} {t}") for i, s in enumerate(["Ideas", "Ideas", "Booked", "Done"])])
    with screen(browser, app_url, w.board["embed_path"], viewport=PHONE, touch=True) as page:
        layout(page)
        for name in ("Add post", "Present", "Export CSV", "Board settings", "Members"):
            assert page.get_by_role("button", name=name, exact=True).count() == 0
        assert page.get_by_role("toolbar").count() == 0 and page.get_by_role("region", name="Approvals").count() == 0
        boxes = [region(page, s).bounding_box() for s in SECTIONS]
        assert all(boxes[i + 1]["y"] >= boxes[i]["y"] + boxes[i]["height"] - PX_SLACK for i in range(2)), "sections are stacked"
        reached: list[str] = []
        for _ in range(len(w.titles) + TAB_PRESSES // 4):
            page.keyboard.press("Tab")
            pid = focused_post(page)
            if pid and pid not in reached:
                reached.append(pid)
        assert reached == w.pids("p0", "p1", "p2", "p3"), f"Tab reaches every frame in sheet order: {reached}"
        f = open_loupe(page, w.titles["p0"])
        for name in ("Like", "Vote up", "Vote down", "Edit", "Delete"):
            assert f.get_by_role("button", name=f"{name} {w.titles['p0']}", exact=True).count() == 0
        assert f.get_by_role("textbox", name="Add a comment").count() == 0


def test_wf_embed_readonly_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", approval=True, posts=[P("a", "Ideas", "own", f"Old {t}")])
    with screen(browser, app_url, f"/embed/{w.token}") as page:
        held = create_post(w.client("con"), w.id, w.sec("Ideas"), f"Held {t}").json()
        assert held["state"] == "awaiting_approval"
        answers(create_post(w.client("own"), w.id, w.sec("Ideas"), f"New {t}"), 201)
        eventually(page, lambda: frame(page, f"New {t}").count() == 1, "a published post appears in the embed")
        assert frame(page, f"Held {t}").count() == 0
        answers(w.client("own").delete(f"/api/posts/{w.pid('a')}"), 204)
        gone(page, f"Old {t}", "a deleted post leaves the embed")
        assert held["id"] not in all_ids(w.client().get(f"/api/links/{w.token}").json()["posts"])
        answers(w.client("own").post(f"/api/boards/{w.id}/rotate-link"), 200)
        eventually(page, lambda: page.get_by_role("heading", name="Board not found").count() > 0, "the open embed turns not-found")
    for setting in ({"privacy": "private"}, {"link_access": "off"}):
        b = world(app_url, privacy="public", link_access="view")
        answers(b.client("own").patch(f"/api/boards/{b.id}", json=setting), 200)
        answers(b.client().get(f"/api/links/{b.token}"), 404, {"error": "not_found"}, f"embed after {setting}")
        with screen(browser, app_url, "/", live=False) as page:
            assert visit(page, app_url + f"/embed/{b.token}") == 404


def test_deleted_means_gone(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", posts=[P("a", "Ideas", "con", f"Keep {t}"), P("b", "Ideas", "con", f"Also {t}")])
    post = create_post(w.client("con"), w.id, w.sec("Ideas"), f"Doomed {t}", file=("d.png", PNG)).json()
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        emb = stack.enter_context(screen(browser, app_url, f"/embed/{w.token}"))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        click(own.get_by_role("button", name="Present", exact=True))
        status = own.get_by_role("dialog", name="Slideshow").get_by_role("status", name="Slide position")
        eventually(own, lambda: norm(status.text_content()) == "Post 1 of 3", "slideshow counts three")
        answers(w.client("mod").delete(f"/api/posts/{post['id']}"), 204)
        for page in (vie, emb):
            gone(page, f"Doomed {t}", "deleted post vanishes")
        eventually(own, lambda: norm(status.text_content()) == "Post 1 of 2", "slideshow count drops")
        assert f"Doomed {t}" not in w.client("own").get(f"/api/boards/{w.id}/export.csv").text
        for path in (f"/api/posts/{post['id']}", post["attachment"]["url"]):
            answers(w.client("vie").get(path), 404, {"error": "not_found"}, path)
        within(lambda: S3().keys(f"boards/{w.id}/posts/{post['id']}/") == [], "the post's objects are removed", REMOVAL_WAIT_S)
        create_post(w.client("con"), w.id, w.sec("Ideas"), "File", file=("f.png", PNG))
        answers(w.client("own").delete(f"/api/boards/{w.id}"), 204)
        eventually(vie, lambda: vie.get_by_role("heading", name="Board not found").count() > 0, "deleted board turns screens not-found")
    for path in (f"/api/boards/{w.id}", f"/api/boards/{w.id}/posts", f"/api/posts/{w.pid('a')}"):
        answers(w.client("own").get(path), 404, {"error": "not_found"}, path)
    within(lambda: S3().keys(f"boards/{w.id}/") == [], "everything under the board prefix is removed", REMOVAL_WAIT_S)


def test_wf_sort_group_export_make_board(browser: Browser, app_url: str) -> None:
    w = world(app_url, board=False, members={}, extra=())
    title = f"Field trip {tag()}"
    with screen(browser, app_url, "/", w.sess("own"), live=False) as page:
        eventually(page, lambda: page.get_by_role("heading", name="Your boards").count() > 0, "dashboard")
        dlg = open_dialog(page, "Make a board", "Make a board")
        click(dlg.get_by_role("button", name="Create board", exact=True))
        eventually(page, lambda: dlg.get_by_text("Give your board a title.").count() > 0, "blank title message")
        fill(field(dlg, "Board title"), title)
        fill(field(dlg, "Sections"), "Ideas, Booked, Done")
        click(dlg.get_by_role("button", name="Create board", exact=True))
        within(lambda: any(b["title"] == title for b in w.client("own").get("/api/boards").json()["boards"]), "board stored", LIVE_WAIT_S)
        board = next(b for b in w.client("own").get("/api/boards").json()["boards"] if b["title"] == title)
        assert board["role"] == "owner"
        assert [s["title"] for s in w.client("own").get(f"/api/boards/{board['id']}").json()["sections"]] == SECTIONS
        visit(page, app_url + "/")
        boards = page.get_by_role("list", name="Your boards")
        eventually(page, lambda: boards.get_by_role("link", name=title, exact=True).count() == 1, "listed under Your boards")
        assert page.get_by_text("1 board", exact=True).count() > 0
        click(boards.get_by_role("link", name=title, exact=True))
        eventually(page, lambda: page.get_by_text("Nothing on this board yet.").count() > 0, "empty-board line")
    cl = w.client("own")
    for body, err in (({"title": "", "sections": SECTIONS}, {"title": "Give your board a title."}),
                      ({"title": "t" * (BOARD_TITLE_MAX + 1), "sections": SECTIONS}, {"title": "Board titles can be at most 80 characters."}),
                      ({"title": "x", "sections": []}, {"sections": "Add between 1 and 12 sections."}),
                      ({"title": "x", "sections": ["s"] * (SECTIONS_MAX + 1)}, {"sections": "Add between 1 and 12 sections."}),
                      ({"title": "x", "sections": ["s" * (SECTION_TITLE_MAX + 1)]}, {"sections": "Section titles can be at most 40 characters."})):
        answers(cl.post("/api/boards", json=body), 422, {"errors": err})
    assert len(cl.get("/api/boards").json()["boards"]) == 1


def test_board_view_toolbar(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"A {t}"), P("b", "Ideas", "mod", f"B {t}", likes=["vie", "co2"]),
                              P("c", "Ideas", "co2", f"C {t}", likes=["vie"])])
    with screen(browser, app_url, w.path, w.sess("vie")) as vie, screen(browser, app_url, w.path, w.sess("own")) as own:
        bar = own.get_by_role("toolbar", name="Board view")
        bar.get_by_role("radio", name="Columns", exact=True).focus()
        own.keyboard.press("ArrowRight")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["layout"] == "rows", "layout saved", LIVE_WAIT_S)
        select(bar.get_by_role("combobox", name="Sort posts"), "Most liked")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["sort"] == "most_liked", "sort saved", LIVE_WAIT_S)
        shows_order(vie, {w.sec("Ideas"): w.pids("b", "c", "a")}, "viewer re-sorts by likes")
        eventually(vie, lambda: all(region(vie, s).bounding_box()["width"] > LAPTOP["width"] / 2 for s in SECTIONS), "rows are full width")
        select(bar.get_by_role("combobox", name="Group posts"), "By author")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["group"] == "author", "group saved", LIVE_WAIT_S)
        authors = sorted(["con", "mod", "co2"], key=lambda k: w.name(k).lower())
        ids = [f"author-{w.uid(k)}" for k in authors]
        assert [s["id"] for s in listing(w.client("vie"), w.id)["sections"]] == ids
        eventually(vie, lambda: list(dom_order(vie)) == ids, "viewer groups by author A to Z")
        assert all(region(vie, w.name(k)).count() == 1 for k in authors)


def test_wf_sort_group_export_csv(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, title=f"Spring trip: {t.upper()}!", posts=[
        P("a", "Ideas", "con", f"Alpha {t}", likes=["vie"]), P("b", "Ideas", "mod", f"Beta {t}", likes=["vie", "co2"], comments=[{"author": "vie", "text": "ok"}]),
        P("x", "Booked", "con", f"Gamma {t}"), P("h", "Booked", "co2", f"Held {t}", state="awaiting_approval"),
        P("r", "Booked", "co2", f"Rejected {t}", state="awaiting_approval")])
    answers(w.client("mod").post(f"/api/posts/{w.pid('r')}/reject"), 204)
    f = create_post(w.client("con"), w.id, w.sec("Booked"), f"Delta {t}", file=(NOTES_NAME, TEXT)).json()
    answers(w.client("own").patch(f"/api/boards/{w.id}", json={"sort": "most_liked"}), 200)
    with screen(browser, app_url, w.path, w.sess("own")) as page:
        with page.expect_download() as dl:
            click(page.get_by_role("button", name="Export CSV", exact=True))
        assert dl.value.suggested_filename == f"spring-trip-{t}.csv"
        raw = Path(dl.value.path()).read_bytes().decode("utf-8")
    lines = raw.split("\r\n")
    assert lines[0] == CSV_HEADER and "\n" not in raw.replace("\r\n", "")
    rows = list(csv.reader(io.StringIO(raw, newline="")))[1:]
    rows = [r for r in rows if r]
    assert [r[0] for r in rows] == [w.pid("b"), w.pid("a"), w.pid("x"), f["id"]], "rows follow the displayed order"
    assert [(r[1], r[2]) for r in rows] == [("Ideas", "1"), ("Ideas", "2"), ("Booked", "1"), ("Booked", "2")]
    assert rows[0][5] == w.name("mod") and rows[0][6] == "2" and rows[0][8] == "1" and rows[3][9] == NOTES_NAME and rows[0][9] == ""
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", r[10]) for r in rows)
    assert f"Held {t}" not in raw and f"Rejected {t}" not in raw and not any(u["email"] in raw for u in w.users.values())
    r = w.client("mod").get(f"/api/boards/{w.id}/export.csv")
    answers(r, 200)
    assert r.headers["content-type"].startswith("text/csv") and f'attachment; filename="spring-trip-{t}.csv"' in r.headers["content-disposition"]
    assert r.text == raw


CSV_IDS = ["equals", "plus", "minus", "at"]
CSV_CHARS = {"equals": "=", "plus": "+", "minus": "-", "at": "@"}


@pytest.mark.parametrize("case", CSV_IDS, ids=CSV_IDS)
def test_csv_formula_neutralisation(app_url: str, case: str) -> None:
    ch, t = CSV_CHARS[case], tag()
    section = f"{ch}Ideas"
    w = world(app_url, sections=[section], names={"con": f"{ch}Con {t}"},
              posts=[P("p", section, "con", f"{ch}SUM(1+1) {t}", body=f"{ch}cmd {t}", votes={"vie": -1})])
    rows = [r for r in csv.reader(io.StringIO(w.client("own").get(f"/api/boards/{w.id}/export.csv").text, newline=""))][1:]
    row = next(r for r in rows if r and r[0] == w.pid("p"))
    assert row[1] == "'" + section and row[3] == f"'{ch}SUM(1+1) {t}" and row[4] == f"'{ch}cmd {t}" and row[5] == f"'{ch}Con {t}"
    assert row[7] == "'" + "-1" and row[6] == "0", "a field starting with - gets the apostrophe; others stay"


def slideshow_posts(t: str) -> list[dict[str, Any]]:
    return [P("p0", "Ideas", "con", f"Zero {t}"), P("p1", "Ideas", "con", f"One {t}", likes=["vie"]),
            P("p2", "Ideas", "con", f"Two {t}", likes=["vie", "co2"]), P("p3", "Ideas", "con", f"Three {t}", likes=["vie", "co2", "mod"])]


def test_wf_slideshow_keys(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, sort="most_liked", posts=slideshow_posts(t))
    order = [w.titles[k] for k in ("p3", "p2", "p1", "p0")]
    with screen(browser, app_url, w.path, w.sess("own"), reduced=True) as page:
        present = page.get_by_role("button", name="Present", exact=True)
        present.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Slideshow")
        status = dlg.get_by_role("status", name="Slide position")

        def at(k: int) -> None:
            eventually(page, lambda: norm(status.text_content()) == f"Post {k} of 4" and shows_in(page, dlg, order[k - 1]),
                       f"slide {k} shows {order[k - 1]}")
        at(1)
        for key, k in (("ArrowRight", 2), ("Space", 3), ("PageDown", 4), ("ArrowRight", 4), ("Home", 1), ("End", 4), ("PageUp", 3), ("ArrowLeft", 2)):
            page.keyboard.press(key)
            at(k)
        assert not shows_in(page, dlg, order[2])
        dlg.get_by_role("button", name="Next post", exact=True).focus()
        page.keyboard.press("ArrowRight")
        at(3)
        click(dlg.get_by_role("button", name="Previous post", exact=True))
        at(2)
        page.keyboard.press("Escape")
        eventually(page, lambda: dlg.count() == 0 and is_focused(present), "Escape returns focus to Present")
    empty = world(app_url)
    with screen(browser, app_url, empty.path, empty.sess("own")) as page:
        click(page.get_by_role("button", name="Present", exact=True))
        status = page.get_by_role("dialog", name="Slideshow").get_by_role("status", name="Slide position")
        eventually(page, lambda: norm(status.text_content()) == "No posts to show yet.", "empty slideshow line")


@pytest.mark.parametrize("mode", MOTION_IDS, ids=MOTION_IDS)
def test_slideshow_transition(browser: Browser, app_url: str, mode: str) -> None:
    reduced = mode == "reduced"
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"First {t}"), P("b", "Ideas", "con", f"Second {t}"), P("c", "Ideas", "con", f"Third {t}")])
    a, b = w.titles["a"], w.titles["b"]
    with screen(browser, app_url, w.path, w.sess("own"), reduced=reduced, touch=True) as page:
        click(page.get_by_role("button", name="Present", exact=True))
        dlg = page.get_by_role("dialog", name="Slideshow")
        status = dlg.get_by_role("status", name="Slide position")
        eventually(page, lambda: norm(status.text_content()) == "Post 1 of 3", "slideshow open")
        for key, old, new, forward in (("ArrowRight", a, b, True), ("ArrowLeft", b, a, False)):
            pump(page, SLIDE_MAX_MS * 2)
            start_recording(page)
            start_old = dlg.evaluate(LEFT_OF_JS, old)
            page.keyboard.press(key)
            advance(page, 1)
            if reduced:
                advance(page, 2 * FRAME_MS)
                assert shows_in(page, dlg, new) and not shows_in(page, dlg, old), "slides swap instantly under reduced motion (L295)"
            else:
                probe = dlg.evaluate(SLIDE_PROBE_JS, {"old": old, "next": new})
                if probe["count"]:
                    assert SLIDE_MIN_MS <= probe["maxEnd"] <= SLIDE_MAX_MS, f"slide motion lasts 250-450 ms (L292): {probe}"
                    mid = probe["mid"]
                    assert None not in (start_old, mid["old"], mid["next"], probe["final"])
                    if forward:
                        assert mid["old"] < start_old and mid["next"] > probe["final"], f"forward moves left, next comes from the right: {probe}"
                    else:
                        assert mid["old"] > start_old and mid["next"] < probe["final"], f"going back reverses: {probe}"
                else:
                    ms, trail = motion_ms(page, lambda: (dlg.evaluate(LEFT_OF_JS, old), dlg.evaluate(LEFT_OF_JS, new)),
                                          lambda r: False, SLIDE_MIN_MS)
                    assert SLIDE_MIN_MS <= ms <= SLIDE_MAX_MS, f"slide motion lasts 250-450 ms (L292): {ms}"
                    olds = [v[0] for v in trail if v[0] is not None]
                    news = [v[1] for v in trail if v[1] is not None]
                    assert len(news) > 1 and olds, f"the slides travel: {trail}"
                    if forward:
                        assert news[0] > news[-1] and min(olds) < start_old, f"forward moves left, next comes from the right: {trail}"
                    else:
                        assert news[0] < news[-1] and max(olds) > start_old, f"going back reverses: {trail}"
            pump(page, SLIDE_MAX_MS * 2)
        box = dlg.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        for dx, want in ((-SWIPE_PX, "Post 2 of 3"), (SWIPE_PX, "Post 1 of 3")):
            touch_point(page, "touchStart", cx, cy)
            touch_glide(page, (cx, cy), lambda dx=dx: (cx + dx, cy))
            touch_point(page, "touchEnd")
            eventually(page, lambda w_=want: norm(status.text_content()) == w_, f"swipe gives {want}")


def test_wf_slideshow_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Uno {t}"), P("b", "Ideas", "con", f"Dos {t}"), P("c", "Ideas", "con", f"Tres {t}")])
    with screen(browser, app_url, w.path, w.sess("own"), reduced=True) as page:
        click(page.get_by_role("button", name="Present", exact=True))
        dlg = page.get_by_role("dialog", name="Slideshow")
        status = dlg.get_by_role("status", name="Slide position")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: norm(status.text_content()) == "Post 2 of 3" and shows_in(page, dlg, w.titles["b"]), "on slide 2")
        answers(w.client("mod").delete(f"/api/posts/{w.pid('b')}"), 204)
        eventually(page, lambda: norm(status.text_content()) == "Post 2 of 2" and shows_in(page, dlg, w.titles["c"]), "next post takes its place")
        answers(create_post(w.client("con"), w.id, w.sec("Ideas"), f"Cuatro {t}"), 201)
        eventually(page, lambda: norm(status.text_content()) == "Post 2 of 3", "a new post raises the count")
        assert w.client("own").get(f"/api/posts/{w.pid('b')}").status_code == 404


def test_wf_move_conflict_lost(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a = w.titles["a"]
    with screen(browser, app_url, w.path, w.sess("con")) as page:
        frame(page, a).focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        hear(page, f"{a}: Ideas, position 2 of 3.")
        answers(move(w.client("mod"), w.pid("a"), w.sec("Booked"), 1, 1), 200)
        page.keyboard.press("Space")
        hear(page, f"{w.name('mod')} moved {a} first. It is now in Booked, position 1 of 3.")
        expected = {w.sec("Ideas"): w.pids("b", "c"), w.sec("Booked"): w.pids("a", "x", "y")}
        shows_order(page, expected, "the loser's frame goes to the winner's place")
        assert_api_order(w.client("con"), w.id, expected, "the winner's order stands")


def test_one_winner_per_version(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    pid = w.pid("a")
    targets = [(w.sec("Ideas"), 3), (w.sec("Booked"), 1), (w.sec("Ideas"), 2), (w.sec("Booked"), 2), (w.sec("Done"), 1), (w.sec("Booked"), 3)]
    movers = ["mod" if i % 2 == 0 else "own" for i in range(RACERS)]
    clients = [w.client(m) for m in movers]
    with screen(browser, app_url, w.path, w.sess("vie")) as page:
        barrier = threading.Barrier(RACERS)

        def go(i: int) -> httpx.Response:
            barrier.wait()
            return clients[i].patch(f"/api/posts/{pid}/move", json={"section_id": targets[i][0], "position": targets[i][1], "version": 1})
        with ThreadPoolExecutor(RACERS) as pool:
            rs = list(pool.map(go, range(RACERS)))
        wins = [i for i, r in enumerate(rs) if r.status_code == 200]
        assert len(wins) == 1, f"exactly one move wins: {[r.status_code for r in rs]}"
        win = wins[0]
        for i, r in enumerate(rs):
            if i != win:
                answers(r, 409, {"error": "conflict", "post": {"section_id": targets[win][0], "position": targets[win][1], "version": 2},
                                 "moved_by": w.name(movers[win])}, f"loser {i}")
        post = w.client("vie").get(f"/api/posts/{pid}").json()
        assert (post["section_id"], post["position"]) == targets[win]
        shows_api_order(page, w.client("vie"), w.id, "the viewer ends in the winner's order")
    editors = [w.client("own"), w.client("con")] * 2
    barrier = threading.Barrier(len(editors))

    def edit(i: int) -> httpx.Response:
        barrier.wait()
        return editors[i].patch(f"/api/posts/{pid}", json={"title": f"Edit {i} {t}", "version": 2})
    with ThreadPoolExecutor(len(editors)) as pool:
        rs = list(pool.map(edit, range(len(editors))))
    assert [r.status_code for r in rs].count(200) == 1 and [r.status_code for r in rs].count(409) == len(editors) - 1
    assert all(r.json()["error"] == "conflict" for r in rs if r.status_code == 409)


def test_wf_move_conflict_deleted_while_held(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a, b = w.titles["a"], w.titles["b"]
    with screen(browser, app_url, w.path, w.sess("vie")) as vie, screen(browser, app_url, w.path, w.sess("con")) as con:
        open_loupe(vie, b)
        frame(con, a).focus()
        con.keyboard.press("Space")
        con.keyboard.press("ArrowDown")
        hear(con, f"{a}: Ideas, position 2 of 3.")
        answers(w.client("mod").delete(f"/api/posts/{w.pid('a')}"), 204)
        heard_line(con, f"{a} was deleted.")
        gone(con, a, "the held frame disappears")
        answers(w.client("mod").delete(f"/api/posts/{w.pid('b')}"), 204)
        heard_line(vie, f"{b} was deleted.")
        gone(vie, b, "the loupe's post disappears")
        answers(w.client("con").get(f"/api/posts/{w.pid('a')}"), 404, {"error": "not_found"})


def test_health(app_url: str) -> None:
    r = api(app_url).get("/api/health")
    answers(r, 200, {"status": "ok"})
    assert r.headers["content-type"].startswith("application/json")
    base = outage("STORAGE_DOWN_URL")

    def unavailable() -> bool:
        resp = api(base).get("/api/health")
        assert resp.status_code == 200, "health never answers 503"
        return resp.json() == {"status": "unavailable"}
    within(unavailable, "outage health reports unavailable", BANNER_S)


def test_grading_fixture(app_url: str) -> None:
    t = tag()
    users = [{"key": k, "display_name": f"{k} {t}", "email": person(k)[1], "password": PASSWORD} for k in ("amy", "ben", "cy", "di")]
    users.append({"key": "eve", "display_name": f"eve {t}", "email": person("eve")[1], "password": PASSWORD, "verified": False})
    body = {"users": users, "boards": [{"key": "trip", "owner": "amy", "title": f"Spring trip {t}", "sections": SECTIONS, "privacy": "public",
            "link_access": "view", "members": {"ben": "contributor", "cy": "moderator", "di": "viewer"},
            "posts": [{"key": "p1", "section": "Ideas", "author": "ben", "title": "Lake day", "body": "Swim at noon", "likes": ["cy"],
                       "votes": {"cy": 1, "di": -1}, "comments": [{"author": "di", "text": "Yes!"}]},
                      {"key": "p2", "section": "Ideas", "author": "ben", "title": f"Second {t}"},
                      {"key": "h1", "section": "Ideas", "author": "ben", "title": f"Held {t}", "state": "awaiting_approval"},
                      {"key": "p3", "section": "Booked", "author": "cy", "title": f"Third {t}"}]}]}
    answers(post_json(app_url, FIXTURE_PATH, body), 404, {"error": "not_found"}, "no key")
    answers(post_json(app_url, FIXTURE_PATH, body, **{"X-Grading-Key": GRADING_KEY + "x"}), 404, {"error": "not_found"}, "wrong key")
    r = post_json(app_url, FIXTURE_PATH, body, **{"X-Grading-Key": GRADING_KEY})
    answers(r, 201)
    data = r.json()
    trip, amy = data["boards"]["trip"], api(app_url, data["users"]["amy"]["session"])
    me = amy.get("/api/me").json()["user"]
    assert me["display_name"] == f"amy {t}" and me["email"] == users[0]["email"]
    answers(api(app_url).post("/api/auth/signin", json={"email": users[4]["email"], "password": PASSWORD}), 403, {"error": "unconfirmed"})
    lst = listing(amy, trip["id"])
    ideas = next(s for s in lst["sections"] if s["id"] == trip["sections"]["Ideas"])
    assert [(p["id"], p["position"]) for p in ideas["posts"]] == [(trip["posts"]["p1"], 1), (trip["posts"]["p2"], 2)]
    held = lst["held"][0]
    assert held["id"] == trip["posts"]["h1"] and held["position"] is None and held["push"] == "sent"
    p1 = ideas["posts"][0]
    assert (p1["likes"], p1["score"], p1["comments"]) == (1, 0, 1)
    board = amy.get(f"/api/boards/{trip['id']}").json()
    assert board["role"] == "owner" and trip["embed_path"].startswith("/embed/") and trip["share_path"].startswith("/s/")
    assert api(app_url, data["users"]["ben"]["session"]).get(f"/api/boards/{trip['id']}").json()["role"] == "contributor"
    bad = post_json(app_url, FIXTURE_PATH, {"users": users[:1], "boards": [{"key": "x", "owner": "nobody", "title": "x", "sections": ["a"]}]},
                    **{"X-Grading-Key": GRADING_KEY})
    assert bad.status_code == 422 and isinstance(bad.json().get("errors"), dict) and bad.json()["errors"]


ERROR_IDS = ["cross_origin_write", "body_too_large", "private_hides_board", "unknown_api_path", "foreign_section_id", "password_before_sign_in",
             "sign_in_before_role", "role_before_conflict", "role_before_validation", "conflict_before_validation", "not_held", "validation"]


@pytest.mark.parametrize("case", ERROR_IDS, ids=ERROR_IDS)
def test_error_order(app_url: str, case: str) -> None:
    t = tag()
    priv = world(app_url, approval=True, posts=[P("p", "Ideas", "con", f"P {t}"), P("h", "Ideas", "con", f"H {t}", state="awaiting_approval")])
    if case == "cross_origin_write":
        answers(priv.client().post(f"/api/boards/{priv.id}/unlock", json={"password": "x"}, headers={"Origin": FOREIGN_ORIGIN}), 403, {"error": "cross_origin"})
        answers(priv.client("own").patch(f"/api/boards/{priv.id}", json={"title": "Moved"}, headers={"Origin": FOREIGN_ORIGIN}), 403, {"error": "cross_origin"})
        assert priv.client("own").get(f"/api/boards/{priv.id}").json()["title"] == priv.title
    elif case == "body_too_large":
        answers(priv.client().post(f"/api/boards/{uuid.uuid4()}/unlock", content=json.dumps({"password": "x" * (JSON_LIMIT + 1)}),
                                   headers={"Content-Type": "application/json"}), 413, {"error": "body_too_large"})
    elif case == "private_hides_board":
        for who in ("out", None):
            answers(priv.client(who).put(f"/api/posts/{priv.pid('p')}/like"), 404, {"error": "not_found"})
    elif case == "unknown_api_path":
        answers(api(app_url).get(f"/api/{t}"), 404, {"error": "not_found"})
    elif case == "foreign_section_id":
        other = world(app_url)
        answers(create_post(priv.client("con"), priv.id, other.sec("Ideas"), "x"), 404, {"error": "not_found"})
    elif case == "password_before_sign_in":
        pw = world(app_url, privacy="password", password=f"pw-order-{t}", posts=[P("p", "Ideas", "con", "x")])
        answers(pw.client().put(f"/api/posts/{pw.pid('p')}/like"), 403, {"error": "password_required"})
    elif case == "sign_in_before_role":
        pub = world(app_url, privacy="public", posts=[P("p", "Ideas", "con", "x")])
        answers(pub.client().put(f"/api/posts/{pub.pid('p')}/like"), 401, {"error": "sign_in_required"})
        answers(pub.client().post(f"/api/posts/{pub.pid('p')}/comments", json={"text": ""}), 401, {"error": "sign_in_required"})
    elif case == "role_before_conflict":
        answers(priv.client("co2").post(f"/api/posts/{priv.pid('p')}/approve"), 403, {"error": "forbidden"})
    elif case == "role_before_validation":
        answers(priv.client("vie").post(f"/api/posts/{priv.pid('p')}/comments", json={"text": ""}), 403, {"error": "forbidden"})
    elif case == "conflict_before_validation":
        answers(move(priv.client("mod"), priv.pid("h"), priv.sec("Ideas"), 999, 1), 409, {"error": "not_published"})
        answers(priv.client("mod").put(f"/api/posts/{priv.pid('h')}/like"), 409, {"error": "not_published"})
        answers(move(priv.client("mod"), priv.pid("p"), priv.sec("Booked"), 1, 1), 200)
        r = move(priv.client("mod"), priv.pid("p"), priv.sec("Ideas"), 999, 1)
        assert r.status_code == 409 and r.json()["error"] == "conflict"
    elif case == "not_held":
        answers(priv.client("mod").post(f"/api/posts/{priv.pid('p')}/approve"), 409, {"error": "not_held"})
    else:
        answers(priv.client("con").post(f"/api/posts/{priv.pid('p')}/comments", json={"text": ""}), 422, {"errors": {"text": "Write a comment first."}})


def test_server_boundary(app_url: str) -> None:
    cl = api(app_url)
    origin = re.match(r"^(https?://[^/]+)", app_url).group(1)
    plain = set(cl.get("/api/health").headers)
    cross = set(cl.get("/api/health", headers={"Origin": FOREIGN_ORIGIN}).headers)
    assert cross <= plain, f"a request naming another origin gets extra (CORS) headers: {cross - plain} (L735)"
    w = world(app_url)
    answers(cl.post("/api/auth/signin", json={"email": w.email("own"), "password": PASSWORD}, headers={"Origin": FOREIGN_ORIGIN}), 403, {"error": "cross_origin"})
    answers(cl.post("/api/auth/signin", json={"email": w.email("own"), "password": PASSWORD}, headers={"Origin": origin}), 200)
    base = {"email": w.email("own"), "password": PASSWORD, "pad": ""}
    over = len(json.dumps(base))
    exact = json.dumps({**base, "pad": "x" * (JSON_LIMIT - over)})
    assert cl.post("/api/auth/signin", content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    answers(cl.post("/api/auth/signin", content=json.dumps({**base, "pad": "x" * (JSON_LIMIT - over + 1)}),
                    headers={"Content-Type": "application/json"}), 413, {"error": "body_too_large"})
    answers(create_post(w.client("con"), w.id, w.sec("Ideas"), "Huge", file=("h.png", padded(PNG, UPLOAD_MAX_BYTES + MULTIPART_EXTRA + 1))),
            413, {"error": "body_too_large"})
    for path in ("/.env", "/.git/config", "/package.json", "/package-lock.json", "/%2e%2e/%2e%2e/etc/passwd", "/..%2fpackage.json",
                 "/assets/..%5c..%5cpackage.json", "/assets/%2e%2e%2f%2e%2e%2fpackage.json"):
        assert cl.get(path).status_code == 404, f"{path} must answer 404"
    pages = [cl.get("/").text, w.client("own").get(w.path).text]
    assets = {m for html in pages for m in re.findall(r'(?:src|href)="(/[^"#?]+)', html)}
    bodies = pages + [cl.get(a).text for a in assets]
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "NTFY_PASSWORD", "GRADING_KEY", "DATABASE_URL")
               if len(os.environ.get(k, "")) >= 6]
    for s in secrets:
        assert not any(s in b for b in bodies), "a configured credential reached the browser"


VIEWPORT_IDS = ["phone", "tablet", "laptop"]
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "laptop": LAPTOP}
PER_ROW = {"phone": 1, "tablet": 2, "laptop": 4}
FIVE_SECTIONS = ["Ideas", "Booked", "Done", "Later", "Maybe"]


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_sheet(browser: Browser, app_url: str, size: str) -> None:
    vp = VIEWPORTS[size]
    w = world(app_url, sections=FIVE_SECTIONS, privacy="public", link_access="view",
              posts=[P(f"p{i}", FIVE_SECTIONS[i % 5], "con", f"F{i} {tag()}") for i in range(60)])
    with screen(browser, app_url, "/", w.sess("own"), viewport=vp, live=False) as page:
        layout(page)
        started = time.monotonic()
        visit(page, app_url + w.path)
        eventually(page, lambda: page.get_by_role("article").count() == 60, "60 frames render", USABLE_S + LIVE_WAIT_S)
        assert time.monotonic() - started <= USABLE_S, "a 60-post board is usable within 3 seconds (L746)"
        layout(page)
        tops = sorted(region(page, s).bounding_box()["y"] for s in FIVE_SECTIONS)
        rows: list[list[float]] = []
        for y in tops:
            if rows and abs(rows[-1][0] - y) <= PX_SLACK:
                rows[-1].append(y)
            else:
                rows.append([y])
        assert len(rows[0]) == PER_ROW[size] and all(len(r) <= PER_ROW[size] for r in rows), f"sections per row: {[len(r) for r in rows]}"
        if size == "laptop":
            visible = page.evaluate("() => Array.from(document.querySelectorAll('[data-post-id]')).filter(f => { const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }).length")
            assert visible >= FULL_BOARD_FRAMES
        if size == "phone":
            add = page.get_by_role("button", name="Add post", exact=True)
            b1 = add.bounding_box()
            page.mouse.wheel(0, SCROLL_PROBE_PX)
            advance(page, FRAME_MS)
            b2 = add.bounding_box()
            assert b1["y"] + b1["height"] <= vp["height"] + PX_SLACK and b1["y"] >= vp["height"] - 2 * b1["height"] and abs(b1["y"] - b2["y"]) <= PX_SLACK
        click(page.get_by_role("button", name="Present", exact=True))
        layout(page)
    with screen(browser, app_url, w.board["embed_path"], viewport=vp) as page:
        layout(page)


SCREEN_IDS = ["dashboard", "board", "slideshow", "embed"]


@pytest.mark.parametrize("screen_name", SCREEN_IDS, ids=SCREEN_IDS)
def test_accessible_aa(browser: Browser, app_url: str, screen_name: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", posts=[P("a", "Ideas", "con", f"A {t}"), P("b", "Ideas", "con", f"B {t}"),
                                                                     P("x", "Booked", "con", f"X {t}"), P("y", "Booked", "con", f"Y {t}")])
    path = {"dashboard": "/", "board": w.path, "slideshow": w.path, "embed": w.board["embed_path"]}[screen_name]
    with screen(browser, app_url, path, None if screen_name == "embed" else w.sess("own"), live=screen_name != "dashboard") as page:
        if screen_name == "slideshow":
            click(page.get_by_role("button", name="Present", exact=True))
        if screen_name == "board":
            names = tab_order(page, TAB_PRESSES)
            idx = [names.index(w.titles[k]) for k in ("a", "b", "x", "y")]
            assert idx == sorted(idx) and names.index("Present") < idx[0] and names.index("Add post") > idx[-1], names
        axe(page)
        for role in ("button", "link", "combobox", "textbox", "article"):
            for loc in page.get_by_role(role).all():
                box = loc.bounding_box()
                if box and box["width"] > 1 and box["height"] > 1 and loc.is_visible():
                    assert box["width"] >= TAP_MIN_PX - PX_SLACK / 2 and box["height"] >= TAP_MIN_PX - PX_SLACK / 2, f"{role} {box} below 44 px"


def test_if_run_manifest(app_url: str) -> None:
    data = json.loads((APP / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    assert all(isinstance(data.get(k), str) and data[k].strip() for k in ("install", "build", "serve"))
    assert api(app_url).get("/api/health").status_code == 200


def test_if_third_party_notices() -> None:
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notes and p.licence in notes, f"{p.name} ({p.licence}) missing from notices"
    assert "Work Sans" in notes and "Lucide" in notes


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"packages under disallowed licences: {bad}"


DATASTORE_CLIENTS = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "mysql", "mysql2", "kafkajs", "amqplib",
                     "bullmq", "bull", "memcached", "nats", "pusher", "ably"}
DATASTORE_PROCS = {"redis-server", "mongod", "mysqld", "memcached", "rabbitmq-server", "nats-server"}


def test_if_only_published_services() -> None:
    assert not [p.name for p in shipped_packages() if p.name in DATASTORE_CLIENTS]
    comms = {c.read_text().strip() for c in Path("/proc").glob("[0-9]*/comm") if c.exists()}
    assert not comms & DATASTORE_PROCS


def test_if_no_cross_origin_assets(browser: Browser, app_url: str) -> None:
    w = world(app_url, privacy="public", link_access="view", posts=[P("a", "Ideas", "con", f"A {tag()}")])
    for path, sess in (("/", None), (w.path, w.sess("own")), (w.board["embed_path"], None)):
        with screen(browser, app_url, "/", sess, live=False) as page:
            seen: list[str] = []
            page.on("request", lambda r: seen.append(r.url))
            visit(page, app_url + path)
            advance(page, PUMP_MS)
            foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, f"{path} loaded {foreign}"


def test_if_seeded_config_unchanged(mail: Mailpit) -> None:
    assert isinstance(S3().keys("boards/"), list)
    assert isinstance(mail.messages(0, settle=0), list)


def test_if_lockfile_used() -> None:
    lock = json.loads((APP / "package-lock.json").read_text())
    assert isinstance(lock, dict) and lock, "package-lock.json parses and is not empty"
    install = json.loads((APP / "run.json").read_text())["install"]
    assert re.search(r"\bnpm\s+(ci|install|i)\b", install), install


WRONG_BOARD_PW = "not-the-pass-1"


def test_wf_simultaneous_posting_phone_tap(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "co2", f"Earlier {t}"), P("x", "Booked", "co2", f"Booked one {t}")])
    title, body = f"Ferry times {t}", f"Leaves at nine {t}"
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        phone = stack.enter_context(screen(browser, app_url, w.path, w.sess("con"), viewport=PHONE, touch=True))
        tap(phone.get_by_role("button", name="Add post", exact=True))
        sheet = phone.get_by_role("dialog", name="Add post", exact=True)
        eventually(phone, lambda: sheet.count() > 0, "a tap on Add post opens the bottom sheet (L124)")
        pump(phone)
        title_box = sheet.get_by_role("textbox", name="Title", exact=True)
        eventually(phone, lambda: is_focused(title_box), "opening Add post puts focus in Title (L229)")
        tap(title_box)
        phone.keyboard.type(title)
        tap(sheet.get_by_role("textbox", name="Text", exact=True))
        phone.keyboard.type(body)
        tap(sheet.get_by_role("button", name="Post", exact=True))
        heard_line(phone, f"Posted {title}.")
        eventually(phone, lambda: sheet.count() == 0, "the sheet closes after success (L232)")
        ideas = next(s for s in listing(w.client("con"), w.id)["sections"] if s["id"] == w.sec("Ideas"))
        new = ideas["posts"][-1]
        assert [p["id"] for p in ideas["posts"]] == [w.pid("a"), new["id"]] and new["title"] == title and new["body"] == body, \
            f"the tapped post lands last in the preset first section (L229, L579): {ideas['posts']}"
        eventually(phone, lambda: focused_post(phone) == new["id"], "focus goes to the new frame (L232)")
        heard_line(watch, f"{w.name('con')} added {title}.")
        shows_order(watch, {w.sec("Ideas"): [w.pid("a"), new["id"]], w.sec("Booked"): w.pids("x")},
                    "the laptop watcher shows the phone's post live")


def test_wf_simultaneous_posting_newest_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, sort="newest", posts=[P("a", "Ideas", "own", f"Older {t}")])
    who = ("con", "co2")
    titles = {k: f"{k} swap {t}" for k in who}
    ideas = w.sec("Ideas")
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie"), viewport=PHONE))
        pages = {k: stack.enter_context(screen(browser, app_url, w.path, w.sess(k))) for k in who}
        for k, page in pages.items():
            page.get_by_role("button", name="Add post", exact=True).focus()
            page.keyboard.press("Enter")
            box = page.get_by_role("dialog", name="Add post", exact=True).get_by_role("textbox", name="Title", exact=True)
            eventually(page, lambda b=box: is_focused(b), "Add post opens with focus in Title (L229)")
            page.keyboard.type(titles[k])
        for page in pages.values():
            page.keyboard.press("Control+Enter")
        cl = w.client("vie")

        def both() -> bool:
            listed = {p["title"] for s in listing(cl, w.id)["sections"] if s["id"] == ideas for p in s["posts"]}
            return set(titles.values()) <= listed
        within(both, "GET posts lists both simultaneous posts", LIVE_WAIT_S)
        order = api_order(cl, w.id)[ideas]
        assert len(order) == 3 and order[-1] == w.pid("a"), f"Newest first puts both new posts above the older one (L588): {order}"
        for k, page in (("vie", vie), *pages.items()):
            shows_order(page, {ideas: order}, f"{k}'s screen matches the API order under Newest first")
        lines = [f"{w.name(k)} added {titles[k]}." for k in who]
        eventually(vie, lambda: any(line in heard(vie) or announcements(vie) == line for line in lines),
                   "the viewer hears a new-post line (two posts landing together may leave only the later line, L314)")
        heard_line(pages["con"], lines[1])
        heard_line(pages["co2"], lines[0])


def test_wf_reactions_votes_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "con", f"Canoe {t}", votes={"mod": 1, "co2": 1})])
    title, pid = w.titles["p"], w.pid("p")
    with ExitStack() as stack:
        watch = stack.enter_context(screen(browser, app_url, w.path, w.sess("co2")))
        phone = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie"), viewport=PHONE, touch=True))
        wf, f = frame(watch, title), frame(phone, title)
        eventually(watch, lambda: wf.get_attribute("data-score") == "2", "the frame shows the stored score of two up votes")
        tap(f)
        eventually(phone, lambda: f.get_attribute("data-loupe") == "open", "a tap opens the loupe (L211)")
        pump(phone)
        up = f.get_by_role("button", name=f"Vote up {title}", exact=True)
        down = f.get_by_role("button", name=f"Vote down {title}", exact=True)
        for button, score, pressed, vote in ((up, "3", ("true", "false"), 1), (down, "1", ("false", "true"), -1),
                                             (down, "2", ("false", "false"), 0)):
            tap(button)
            eventually(phone, lambda s=score, pr=pressed: (up.get_attribute("aria-pressed"), down.get_attribute("aria-pressed"),
                                                           f.get_attribute("data-score")) == (*pr, s),
                       f"the tapped vote leaves aria-pressed {pressed} and score {score} (L599)")
            eventually(watch, lambda s=score: wf.get_attribute("data-score") == s, f"another screen shows score {score} live")
            mine = w.client("vie").get(f"/api/posts/{pid}").json()
            assert (mine["score"], mine["my_vote"]) == (int(score), vote), f"stored score and vote after the tap: {mine}"


def test_wf_approval_reject_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "con", f"Kept {t}"),
                                             P("h", "Ideas", "con", f"Waiting {t}", state="awaiting_approval")])
    held, hid = w.titles["h"], w.pid("h")
    with ExitStack() as stack:
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own"), viewport=PHONE))
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        waiting = region(con, "Waiting for approval")
        eventually(con, lambda: waiting.get_by_role("article", name=held, exact=True).count() == 1,
                   "the author sees the held frame in Waiting for approval")
        own_queue = region(own, "Approvals")
        eventually(own, lambda: own_queue.get_by_role("article", name=held, exact=True).count() == 1
                   and own.get_by_role("heading", name="Approvals (1)").count() == 1, "the owner's phone lists the held post")
        reject = region(mod, "Approvals").get_by_role("button", name=f"Reject {held}", exact=True)
        reject.focus()
        mod.keyboard.press("Space")
        eventually(mod, lambda: is_focused(mod.get_by_role("heading", name="Approvals (0)")),
                   "with no held post left focus moves to the Approvals (0) heading (L242)")
        heard_line(con, f"Your post {held} was not approved.")
        gone(con, held, "the author's open screen drops the rejected post live")
        eventually(own, lambda: own_queue.get_by_role("article", name=held, exact=True).count() == 0
                   and own.get_by_role("heading", name="Approvals (0)").count() == 1
                   and "Nothing is waiting for approval." in norm(own_queue.text_content()),
                   "the owner's open Approvals empties live (L343)")
    answers(w.client("own").get(f"/api/posts/{hid}"), 404, {"error": "not_found"}, "a rejected post for the owner")
    assert hid not in all_ids(listing(w.client("con"), w.id)), "the rejected post is gone from its author's listing"
    assert api_order(w.client("vie"), w.id)[w.sec("Ideas")] == w.pids("a"), "rejecting publishes nothing"


def test_wf_privacy_share_phone_unlock(browser: Browser, app_url: str) -> None:
    t = tag()
    secret = f"phone-pass-{t}"
    w = world(app_url, privacy="password", password=secret, posts=[P("p", "Ideas", "con", f"Inside {t}")])
    title, fresh = w.titles["p"], f"Fresh {t}"
    posts_url = f"{app_url}/api/boards/{w.id}/posts"
    with ExitStack() as stack:
        page = stack.enter_context(screen(browser, app_url, w.path, viewport=PHONE, live=False))
        assert visit(page, app_url + w.path) == 200
        locked = page.get_by_role("heading", name="This board is password protected")
        assert locked.count() == 1, "a stranger on a password board sees the password screen"
        box, open_board = field(page, "Board password"), page.get_by_role("button", name="Open board", exact=True)
        box.focus()
        page.keyboard.type(WRONG_BOARD_PW)
        open_board.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: "That password didn't open this board." in norm(page.get_by_role("alert").first.text_content()),
                   "a wrong password shows the published alert (L394)")
        assert locked.count() == 1 and frame(page, title).count() == 0, "a wrong password opens nothing"
        r = page.request.get(posts_url)
        assert r.status == 403 and r.json() == {"error": "password_required"}, f"the browser is still locked: {r.status} {r.text()[:200]}"
        answers(w.client().post(f"/api/boards/{w.id}/unlock", json={"password": WRONG_BOARD_PW}), 404, {"error": "not_found"},
                "a wrong password unlock")
        box.fill("")
        box.focus()
        page.keyboard.type(secret)
        open_board.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: frame(page, title).count() == 1, "the right password opens the board")
        assert page.get_by_role("button", name="Add post", exact=True).count() == 0, "an unlocked stranger has no Add post (L174)"
        streams: list[str] = []
        page.on("response", lambda resp: streams.append(resp.url) if "/events" in resp.url else None)
        page.on("websocket", lambda ws: streams.append(ws.url))
        assert visit(page, app_url + w.path) == 200
        eventually(page, lambda: frame(page, title).count() == 1 and locked.count() == 0 and bool(streams),
                   "a reload in the same browser session stays unlocked and live (L408)")
        assert page.request.get(posts_url).status == 200
        other = stack.enter_context(screen(browser, app_url, w.path, live=False))
        assert visit(other, app_url + w.path) == 200
        assert other.get_by_role("heading", name="This board is password protected").count() == 1 and frame(other, title).count() == 0, \
            "another browser without the unlock still sees the password screen"
        answers(create_post(w.client("own"), w.id, w.sec("Ideas"), fresh), 201)
        eventually(page, lambda: frame(page, fresh).count() == 1, "the unlocked phone screen shows the owner's new post live")


DOC_NAME = "plan.pdf"


def sheet_open(page: Page) -> Locator:
    tap(page.get_by_role("button", name="Add post", exact=True))
    sheet = page.get_by_role("dialog", name="Add post", exact=True)
    eventually(page, lambda: sheet.count() > 0 and sheet.first.is_visible(), 'tapping Add post opens dialog "Add post" as a sheet')
    pump(page)
    return sheet


def flat_order(page: Page, ids: list[str]) -> list[str]:
    return [p for sec in dom_order(page).values() for p in sec if p in ids]


def test_wf_phone_upload_file_card(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url)
    title = f"Route plan {t}"
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie"), viewport=PHONE, touch=True))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con"), viewport=PHONE, touch=True))
        sheet = sheet_open(con)
        title_box = sheet.get_by_role("textbox", name="Title", exact=True)
        tap(title_box)
        fill(title_box, title)
        with con.expect_file_chooser() as chooser:
            tap(sheet.get_by_role("button", name="Attach a file", exact=True))
        chooser.value.set_files(files=[{"name": DOC_NAME, "mimeType": "application/pdf", "buffer": PDF}])
        tap(sheet.get_by_role("button", name="Post", exact=True))
        heard_line(con, f"Posted {title}.")
        lines = heard(con)
        upload_line = f"Uploading {DOC_NAME}…"
        assert upload_line in lines and lines.index(upload_line) < lines.index(f"Posted {title}."), \
            f"the upload line is announced before the posted line (L332, L361): {lines}"
        post = next(p for s in listing(w.client("vie"), w.id)["sections"] for p in s["posts"] if p["title"] == title)
        att = post["attachment"]
        assert att and att["file_name"] == DOC_NAME and att["url"] == f"/api/attachments/{att['id']}"
        heard_line(vie, f"{w.name('con')} added {title}.")
        fv = frame(vie, title)
        eventually(vie, lambda: fv.count() == 1 and DOC_NAME in norm(fv.text_content()),
                   "the viewer's phone shows the new frame live as a file card with the file name (L274)")
        assert not fv.evaluate(IMAGE_SHOWN_JS, att["id"]), "a PDF is not drawn inline as an image (L274)"
        tap(fv)
        eventually(vie, lambda: fv.get_attribute("data-loupe") == "open", "a tap opens the loupe (L211)")
        link = fv.get_by_role("link", name=DOC_NAME, exact=True)
        eventually(vie, lambda: link.count() == 1, f'the loupe shows link "{DOC_NAME}" for a non-image file (L118)')
        href = link.evaluate("e => e.href")
        assert href.split("?")[0].split("#")[0].endswith(att["url"]), f"the file link goes through the app's attachment URL (L672): {href}"
        r = vie.context.request.get(href)
        assert r.status == 200 and r.body() == PDF, f"the viewer's browser reads the stored file: {r.status}"
        assert r.headers.get("content-disposition") == 'attachment; filename="' + DOC_NAME + '"', \
            f"a PDF is served as a download (L528): {r.headers.get('content-disposition')}"


def test_wf_phone_upload_outage_live(browser: Browser) -> None:
    base = outage("STORAGE_DOWN_URL")
    t = tag()
    w = world(base)
    photo, plain, body = f"Summit photo {t}", f"Meet at the gate {t}", f"Typed on the phone {t}"
    with ExitStack() as stack:
        lap = stack.enter_context(screen(browser, base, w.path, w.sess("co2")))
        phone = stack.enter_context(screen(browser, base, w.path, w.sess("con"), viewport=PHONE, touch=True))
        banner = "File uploads are unavailable right now. Posts without files still work."
        eventually(phone, lambda: banner in norm(region(phone, "Service notice").text_content()),
                   "the phone shows the storage banner", BANNER_S + LIVE_WAIT_S)
        layout(phone)
        sheet = sheet_open(phone)
        title_box, text_box = sheet.get_by_role("textbox", name="Title", exact=True), sheet.get_by_role("textbox", name="Text", exact=True)
        fill(title_box, photo)
        fill(text_box, body)
        with phone.expect_file_chooser() as chooser:
            tap(sheet.get_by_role("button", name="Attach a file", exact=True))
        chooser.value.set_files(files=[{"name": PHOTO_NAME, "mimeType": "image/png", "buffer": PNG}])
        tap(sheet.get_by_role("button", name="Post", exact=True))
        eventually(phone, lambda: "Uploads are unavailable right now. Your post was not saved." in norm(sheet.get_by_role("alert").first.text_content()),
                   "the sheet shows the storage-down alert (L358)")
        assert sheet.count() > 0 and title_box.input_value() == photo and text_box.input_value() == body, \
            "a refusal keeps the sheet open with everything typed (L233)"
        lap.get_by_role("button", name="Add post", exact=True).focus()
        lap.keyboard.press("Enter")
        lap_title = lap.get_by_role("dialog", name="Add post", exact=True).get_by_role("textbox", name="Title", exact=True)
        eventually(lap, lambda: is_focused(lap_title), "Add post opens with focus in Title (L229)")
        lap.keyboard.type(plain)
        lap.keyboard.press("Control+Enter")
        hear(lap, f"Posted {plain}.")
        heard_line(phone, f"{w.name('co2')} added {plain}.")
        cl = w.client("con")
        titles = {p["title"] for s in listing(cl, w.id)["sections"] for p in s["posts"]}
        assert plain in titles and photo not in titles, f"the file-less post is stored and the refused one is not: {titles}"
        shows_api_order(phone, cl, w.id, "the phone shows the file-less post live and no refused frame")


def test_wf_embed_readonly_loupe_live(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view",
              posts=[P("a", "Ideas", "con", f"Lake {t}", comments=[{"author": "mod", "text": f"Bring towels {t}"}]),
                     P("x", "Booked", "con", f"Bus {t}")])
    a, pid = w.titles["a"], w.pid("a")
    with screen(browser, app_url, w.board["embed_path"]) as emb:
        for _ in range(TAB_PRESSES):
            emb.keyboard.press("Tab")
            if focused_post(emb) == pid:
                break
        else:
            pytest.fail("Tab never reached the embed's first frame (L71, L194)")
        fa = frame(emb, a)
        emb.keyboard.press("Enter")
        eventually(emb, lambda: fa.get_attribute("data-loupe") == "open", "Enter opens the loupe in the embed")
        eventually(emb, lambda: is_focused(fa.get_by_role("heading", name=a, level=2)), "focus moves to the loupe heading (L219)")
        comments = fa.get_by_role("list", name="Comments")
        eventually(emb, lambda: comments.get_by_role("listitem").count() == 1 and w.name("mod") in norm(comments.text_content())
                   and f"Bring towels {t}" in norm(comments.text_content()), "the embed loupe lists the seeded comment")
        listed = norm(comments.text_content())
        assert w.email("mod") not in listed, "comments name people by display name only"
        assert emb.get_by_role("textbox", name="Add a comment").count() == 0 and emb.get_by_role("button", name="Send comment").count() == 0, \
            "the embed loupe has no comment box (L626)"
        answers(w.client("co2").post(f"/api/posts/{pid}/comments", json={"text": f"On my way {t}"}), 201)
        eventually(emb, lambda: comments.get_by_role("listitem").count() == 2 and f"On my way {t}" in norm(comments.text_content()),
                   "a new comment appears in the embed's open loupe live")
        eventually(emb, lambda: fa.get_attribute("data-comments") == "2", "data-comments rises live in the embed")
        emb.keyboard.press("Escape")
        eventually(emb, lambda: fa.get_attribute("data-loupe") == "closed" and is_focused(fa), "Escape closes the loupe and returns focus to the frame")
        emb.keyboard.press("Enter")
        eventually(emb, lambda: fa.get_attribute("data-loupe") == "open", "Enter reopens the loupe")
        answers(move(w.client("own"), pid, w.sec("Booked"), 1), 200)
        hear(emb, f"{a} moved to Booked, position 1 of 2.")
        eventually(emb, lambda: fa.get_attribute("data-loupe") == "open" and fa.get_attribute("data-section-id") == w.sec("Booked"),
                   "the embed's loupe stays open on the post at its new place (L289)")


def test_wf_embed_readonly_made_private(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, privacy="public", link_access="view", posts=[P("p", "Ideas", "con", f"Kite {t}")])
    title = w.titles["p"]
    with ExitStack() as stack:
        emb = stack.enter_context(screen(browser, app_url, w.board["embed_path"], viewport=PHONE, touch=True))
        share = stack.enter_context(screen(browser, app_url, w.board["share_path"]))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        assert frame(emb, title).count() == 1 and frame(share, title).count() == 1
        own.get_by_role("button", name="Board settings", exact=True).focus()
        own.keyboard.press("Enter")
        dlg = own.get_by_role("dialog", name="Board settings", exact=True)
        eventually(own, lambda: dlg.count() > 0 and dlg.first.is_visible(), 'Enter opens dialog "Board settings"')
        private = dlg.get_by_role("radio", name="Private", exact=True)
        private.focus()
        own.keyboard.press("Space")
        eventually(own, lambda: private.is_checked(), "Space chooses Private")
        dlg.get_by_role("button", name="Save settings", exact=True).focus()
        own.keyboard.press("Enter")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["privacy"] == "private", "privacy saved as private", LIVE_WAIT_S)
        for page, what in ((emb, "phone embed"), (share, "share page")):
            eventually(page, lambda p=page: p.get_by_role("heading", name="Board not found").count() > 0,
                       f"the open {what} turns into the not-found screen live (L629)")
            assert frame(page, title).count() == 0, f"the {what} no longer shows the post"
        assert visit(emb, app_url + w.board["embed_path"]) == 404, "the embed of a private board answers 404 (L621)"
        assert emb.get_by_role("heading", name="Board not found").count() == 1
    answers(w.client().get(f"/api/links/{w.token}"), 404, {"error": "not_found"})


def test_wf_sort_group_export_author_live(browser: Browser, app_url: str) -> None:
    t = tag()
    names = {"co2": f"al {t}", "con": f"Bo {t}", "mod": f"cy {t}"}
    w = world(app_url, names=names, posts=[P("a", "Ideas", "con", f"Tent {t}"), P("b", "Booked", "co2", f"Stove {t}"),
                                           P("c", "Ideas", "mod", f"Map {t}"), P("d", "Done", "con", f"Rope {t}")])
    order = ["co2", "con", "mod"]
    ids = [f"author-{w.uid(k)}" for k in order]
    members = {ids[0]: w.pids("b"), ids[1]: w.pids("a", "d"), ids[2]: w.pids("c")}

    def grouped(page: Page) -> bool:
        dom = dom_order(page)
        return [s for s in dom if s in ids] == ids and all(sorted(dom[s]) == sorted(p) for s, p in members.items()) \
            and all(region(page, names[k]).get_attribute("data-count") == str(len(members[s])) for k, s in zip(order, ids))

    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie"), viewport=PHONE, touch=True))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        select(own.get_by_role("toolbar", name="Board view").get_by_role("combobox", name="Group posts"), "By author")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["group"] == "author", "grouping saved", LIVE_WAIT_S)
        for page, who in ((vie, "viewer's phone"), (con, "contributor's screen")):
            eventually(page, lambda p=page: grouped(p), f"the {who} regroups live into author sections A to Z ignoring case (L591)")
        tops = [region(vie, names[k]).bounding_box()["y"] for k in order]
        assert tops == sorted(tops), f"the phone stacks the author sections top to bottom A to Z (L124): {tops}"
        frame(con, w.titles["a"]).focus()
        con.keyboard.press("Space")
        con.keyboard.press("ArrowDown")
        heard_line(con, "Moving is off while posts are grouped by author.")
        con.keyboard.press("Escape")
        moved = w.client("con").get(f"/api/posts/{w.pid('a')}").json()
        assert moved["section_id"] == w.sec("Ideas") and moved["version"] == 1, "the refused move saved nothing"
        visit(vie, app_url + w.path)
        eventually(vie, lambda: grouped(vie), "the grouping is still applied after reload")


def test_wf_sort_group_export_grouped_csv(browser: Browser, app_url: str) -> None:
    t = tag()
    names = {"co2": f"Al {t}", "con": f"bo {t}"}
    w = world(app_url, sort="oldest", group="author", names=names,
              posts=[P("a", "Ideas", "con", f"Tent {t}"), P("b", "Booked", "co2", f"Stove {t}"), P("c", "Done", "con", f"Rope {t}"),
                     P("h", "Ideas", "co2", f"Held {t}", state="awaiting_approval")])
    late = f"Late {t}"
    with screen(browser, app_url, w.path, w.sess("mod")) as page:
        r = create_post(w.client("con"), w.id, w.sec("Booked"), late)
        answers(r, 201)
        nid = r.json()["id"]
        heard_line(page, f"{names['con']} added {late}.")
        expected = [w.pid("b"), w.pid("a"), w.pid("c"), nid]
        eventually(page, lambda: flat_order(page, expected) == expected, "the moderator sees author groups A to Z, each oldest first")
        page.get_by_role("button", name="Export CSV", exact=True).focus()
        with page.expect_download() as dl:
            page.keyboard.press("Enter")
        raw = Path(dl.value.path()).read_bytes().decode("utf-8")
    assert raw.split("\r\n")[0] == CSV_HEADER
    rows = [row for row in csv.reader(io.StringIO(raw, newline=""))][1:]
    rows = [row for row in rows if row]
    assert [row[0] for row in rows] == expected, "CSV rows follow the displayed order (L658)"
    shown = [(names["co2"], "1"), (names["con"], "1"), (names["con"], "2"), (names["con"], "3")]
    assert [(row[1], row[2]) for row in rows] == shown, "section and position are as displayed: the author group and its place (L304, L658)"
    assert [row[5] for row in rows] == [names["co2"], names["con"], names["con"], names["con"]]
    assert f"Held {t}" not in raw and not any(u["email"] in raw for u in w.users.values())


def tap_if_usable(button: Locator) -> None:
    if button.count() and button.first.is_visible() and button.first.is_enabled():
        tap(button.first)


def test_wf_slideshow_phone_buttons(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "con", f"Fir {t}"), P("h", "Ideas", "con", f"Hidden {t}", state="awaiting_approval"),
                                             P("b", "Ideas", "co2", f"Gorse {t}"), P("c", "Booked", "con", f"Heath {t}")])
    order = [w.titles[k] for k in ("a", "b", "c")]
    held = w.titles["h"]
    with screen(browser, app_url, w.path, w.sess("own"), viewport=PHONE, touch=True) as page:
        present = page.get_by_role("button", name="Present", exact=True)
        tap(present)
        dlg = page.get_by_role("dialog", name="Slideshow", exact=True)
        status = dlg.get_by_role("status", name="Slide position")
        back = dlg.get_by_role("button", name="Previous post", exact=True)
        ahead = dlg.get_by_role("button", name="Next post", exact=True)

        def at(k: int) -> None:
            eventually(page, lambda: norm(status.text_content()) == f"Post {k} of 3" and shows_in(page, dlg, order[k - 1]),
                       f"slide {k} of the 3 published posts shows {order[k - 1]}")
            assert held not in norm(dlg.text_content()), "a held post never appears in the slideshow, even for the owner (L53)"
        at(1)
        tap_if_usable(back)
        pump(page, SLIDE_MAX_MS * 2)
        at(1)
        tap(ahead)
        at(2)
        tap(ahead)
        at(3)
        tap_if_usable(ahead)
        pump(page, SLIDE_MAX_MS * 2)
        at(3)
        page.keyboard.press("Escape")
        eventually(page, lambda: dlg.count() == 0 and is_focused(present), "Escape closes the slideshow and focus is on Present (L257)")
    assert [p["title"] for s in listing(w.client("own"), w.id)["sections"] for p in s["posts"]] == order, \
        "the slideshow followed the displayed order of GET /api/boards/<id>/posts"


def test_wf_slideshow_live_approval(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, approval=True, posts=[P("a", "Ideas", "con", f"Oak {t}"), P("b", "Ideas", "con", f"Pine {t}"),
                                             P("h", "Ideas", "co2", f"Rowan {t}", state="awaiting_approval")])
    a, b, h = (w.titles[k] for k in ("a", "b", "h"))
    with ExitStack() as stack:
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own"), viewport=PHONE, touch=True))
        tap(own.get_by_role("button", name="Present", exact=True))
        dlg = own.get_by_role("dialog", name="Slideshow", exact=True)
        status = dlg.get_by_role("status", name="Slide position")
        eventually(own, lambda: norm(status.text_content()) == "Post 1 of 2" and shows_in(own, dlg, a), "the slideshow opens on 2 published posts")

        region(mod, "Approvals").get_by_role("button", name=f"Approve {h}", exact=True).focus()
        mod.keyboard.press("Enter")
        eventually(own, lambda: norm(status.text_content()) == "Post 1 of 3", "an approval during the slideshow raises its count live",
                   LIVE_WAIT_S)

        fb = open_loupe(mod, b)
        fb.get_by_role("button", name=f"Delete {b}", exact=True).focus()
        mod.keyboard.press("Enter")
        heard_line(mod, f"Deleted {b}.")
        eventually(own, lambda: norm(status.text_content()) == "Post 1 of 2" and shows_in(own, dlg, a),
                   "a deletion during the slideshow lowers its count live", LIVE_WAIT_S)

        tap(dlg.get_by_role("button", name="Next post", exact=True))
        eventually(own, lambda: norm(status.text_content()) == "Post 2 of 2" and shows_in(own, dlg, h),
                   "the approved post was published last in its section and is the last slide")
    assert_api_order(w.client("own"), w.id, {w.sec("Ideas"): w.pids("a", "h")}, "approved last, deleted gone")
    answers(w.client("own").get(f"/api/posts/{w.pid('b')}"), 404, {"error": "not_found"}, "the deleted post")


def test_wf_move_conflict_mouse_race(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a = w.titles["a"]
    expected = {w.sec("Ideas"): w.pids("b", "c"), w.sec("Booked"): w.pids("a", "x", "y"), w.sec("Done"): []}
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        x0, y0 = center(frame(mod, a))
        tx, ty = center(frame(mod, w.titles["y"]))
        mod.mouse.move(x0, y0)
        mod.mouse.down()
        advance(mod, FRAME_MS)
        for i in range(1, 4):
            mod.mouse.move(x0, y0 + i * DRAG_START_PX / 2)
            advance(mod, FRAME_MS)

        onto = center(frame(own, w.titles["x"]))
        mouse_drag(own, frame(own, a), lambda: onto)
        hear(own, f"Dropped {a}: Booked, position 1 of 3.")
        assert_api_order(w.client("vie"), w.id, expected, "the owner's drop is the winner")

        sx, sy = x0, y0 + 3 * DRAG_START_PX / 2
        for i in range(1, 9):
            mod.mouse.move(sx + (tx - sx) * i / 8, sy + (ty - sy) * i / 8)
            advance(mod, FRAME_MS)
        mod.mouse.up()
        advance(mod, FRAME_MS)
        heard_line(mod, f"{w.name('own')} moved {a} first. It is now in Booked, position 1 of 3.")
        for page, who in ((mod, "the losing moderator"), (own, "the winning owner"), (vie, "the watching viewer")):
            shows_order(page, expected, f"{who} ends in the winner's order")
    post = w.client("vie").get(f"/api/posts/{w.pid('a')}").json()
    assert (post["section_id"], post["position"], post["version"]) == (w.sec("Booked"), 1, 2), \
        f"exactly one of the two drags carrying version 1 was saved: {post}"
    assert_api_order(w.client("vie"), w.id, expected, "the stale drop changed nothing")


def test_wf_move_conflict_touch_loses(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a, c = w.titles["a"], w.titles["c"]
    expected = {w.sec("Ideas"): w.pids("a", "b"), w.sec("Booked"): w.pids("x", "y", "c")}
    with ExitStack() as stack:
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con"), viewport=PHONE, touch=True))
        cx, cy = center(frame(con, c))
        ax, ay = center(frame(con, a))
        touch_point(con, "touchStart", cx, cy)
        advance(con, LONG_PRESS_MS)
        lift = (cx, cy - 2 * DRAG_START_PX)
        touch_glide(con, (cx, cy), lambda: lift, steps=2)

        frame(own, c).focus()
        own.keyboard.press("Space")
        hear(own, f"Picked up {c}. Ideas, position 3 of 3.")
        own.keyboard.press("ArrowRight")
        hear(own, f"{c}: Booked, position 3 of 3.")
        own.keyboard.press("Space")
        hear(own, f"Dropped {c}: Booked, position 3 of 3.")
        assert_api_order(w.client("con"), w.id, expected, "the owner's keyboard move is saved first")

        touch_glide(con, lift, lambda: (ax, ay))
        touch_point(con, "touchEnd")
        heard_line(con, f"{w.name('own')} moved {c} first. It is now in Booked, position 3 of 3.")
        shows_order(con, expected, "the phone's frame goes to the winner's place")
        shows_order(own, expected, "the owner's screen keeps its move")
    post = w.client("con").get(f"/api/posts/{w.pid('c')}").json()
    assert post["version"] == 2, f"the phone's stale drop saved nothing: {post}"
    assert_api_order(w.client("con"), w.id, expected, "the winner's order stands")


def stays(page: Page, check: Callable[[], bool], what: str, seconds: float = LIVE_BAND_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert check(), f"{what} stopped holding within {seconds}s"
        advance(page, STEP_MS)


def drag_hold(page: Page, source: Locator) -> tuple[float, float]:
    x0, y0 = center(source)
    page.mouse.move(x0, y0)
    page.mouse.down()
    advance(page, FRAME_MS)
    for i in range(1, 4):
        page.mouse.move(x0, y0 + i * DRAG_START_PX / 2)
        advance(page, FRAME_MS)
    return x0, y0 + 3 * DRAG_START_PX / 2


def drag_release(page: Page, start: tuple[float, float], target: tuple[float, float], steps: int = 8) -> None:
    sx, sy = start
    tx, ty = target
    for i in range(1, steps + 1):
        page.mouse.move(sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps)
        advance(page, FRAME_MS)
    page.mouse.up()
    advance(page, FRAME_MS)


def test_wf_keyboard_moves_live_while_held(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a, y = w.titles["a"], w.titles["y"]
    ideas, booked, done = (w.sec(s) for s in SECTIONS)
    with ExitStack() as stack:
        mod = stack.enter_context(screen(browser, app_url, w.path, w.sess("mod")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        fa = frame(own, a)
        fa.focus()
        own.keyboard.press("Space")
        hear(own, f"Picked up {a}. Ideas, position 1 of 3.")
        assert fa.get_attribute("data-moving") == "true", "a picked-up frame carries data-moving=true (L186)"

        frame(mod, y).focus()
        mod.keyboard.press("Space")
        hear(mod, f"Picked up {y}. Booked, position 2 of 2.")
        mod.keyboard.press("ArrowRight")
        hear(mod, f"{y}: Done, position 1 of 1.")
        mod.keyboard.press("Space")
        hear(mod, f"Dropped {y}: Done, position 1 of 1.")
        moved = {ideas: w.pids("a", "b", "c"), booked: w.pids("x"), done: w.pids("y")}
        assert_api_order(w.client("vie"), w.id, moved, "the moderator's keyboard move of another post is saved")

        shows_order(own, {booked: w.pids("x"), done: w.pids("y")},
                    "the holder's screen shows the other post's move within the live band (L215 exempts only the held post, L662)")
        assert fa.get_attribute("data-moving") == "true", "the owner still holds Alpha after another post's live move (L215)"
        assert focused_post(own) == w.pid("a"), "focus stays on the held frame while a live move arrives (L204)"

        own.keyboard.press("ArrowDown")
        hear(own, f"{a}: Ideas, position 2 of 3.")
        own.keyboard.press("Space")
        hear(own, f"Dropped {a}: Ideas, position 2 of 3.")
        eventually(own, lambda: focused_post(own) == w.pid("a"), "focus is on the moved frame after the save (L204)")
        final = {ideas: w.pids("b", "a", "c"), booked: w.pids("x"), done: w.pids("y")}
        assert_api_order(w.client("vie"), w.id, final, "the owner's drop saved Alpha at Ideas position 2")
        shows_order(own, final, "the owner's screen after the drop")
        shows_order(mod, final, "the moderator's screen shows the owner's move live")


def test_wf_drag_reorder_counts_while_dragging(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Maple {t}"), P("b", "Ideas", "con", f"Larch {t}"),
                              P("c", "Ideas", "con", f"Spruce {t}"), P("x", "Booked", "co2", f"Quartz {t}")])
    c = w.titles["c"]
    title = f"Late arrival {t}"
    ideas, booked, done = (w.sec(s) for s in SECTIONS)
    with ExitStack() as stack:
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        onto = center(frame(con, w.titles["a"]))
        start = drag_hold(con, frame(con, c))

        answers(create_post(w.client("own"), w.id, done, title), 201, what="the owner's post in Done")
        cl = w.client("vie")

        def posted() -> bool:
            sec = next(s for s in listing(cl, w.id)["sections"] if s["id"] == done)
            return [p["title"] for p in sec["posts"]] == [title] and sec["count"] == 1
        within(posted, "GET posts lists the owner's new post alone in Done", LIVE_WAIT_S)
        new_id = api_order(cl, w.id)[done][0]

        shows_order(con, {booked: w.pids("x"), done: [new_id]},
                    "mid-drag, the dragger's screen shows the new frame and Done's data-count within the live band (L37, L662)")
        heard_line(con, f"{w.name('own')} added {title}.")

        drag_release(con, start, onto)
        hear(con, f"Dropped {c}: Ideas, position 1 of 3.")
        final = {ideas: w.pids("c", "a", "b"), booked: w.pids("x"), done: [new_id]}
        assert_api_order(cl, w.id, final, "releasing on Maple drops Spruce at its position (L210)")
        shows_order(con, final, "the dragger's screen after the drop")
        shows_order(own, final, "the owner's screen shows the drop live")


def test_wf_reactions_live_while_holding(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a, x = w.titles["a"], w.titles["x"]
    initial = {w.sec("Ideas"): w.pids("a", "b", "c"), w.sec("Booked"): w.pids("x", "y")}
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        fa, fx = frame(own, a), frame(own, x)
        eventually(own, lambda: (fx.get_attribute("data-likes"), fx.get_attribute("data-score")) == ("0", "0"),
                   "Xray starts with no likes or votes")
        fa.focus()
        own.keyboard.press("Space")
        hear(own, f"Picked up {a}. Ideas, position 1 of 3.")
        own.keyboard.press("ArrowDown")
        hear(own, f"{a}: Ideas, position 2 of 3.")

        vx = open_loupe(vie, x)
        like = vx.get_by_role("button", name=f"Like {x}", exact=True)
        down = vx.get_by_role("button", name=f"Vote down {x}", exact=True)
        like.focus()
        vie.keyboard.press("Enter")
        eventually(vie, lambda: like.get_attribute("aria-pressed") == "true", "Enter on Like presses it (L148)")
        down.focus()
        vie.keyboard.press("Space")
        eventually(vie, lambda: down.get_attribute("aria-pressed") == "true", "Space on Vote down presses it (L148)")
        cl = w.client("own")

        def stored() -> bool:
            p = cl.get(f"/api/posts/{w.pid('x')}").json()
            return (p["likes"], p["score"]) == (1, -1)
        within(stored, "the viewer's like and down vote are stored", LIVE_WAIT_S)

        eventually(own, lambda: (fx.get_attribute("data-likes"), fx.get_attribute("data-score")) == ("1", "-1"),
                   "the holder's Xray frame shows the stored like and score within the live band (L43, L601, L662)")
        assert fa.get_attribute("data-moving") == "true", "the owner still holds Alpha after the live reactions (L215)"
        assert focused_post(own) == w.pid("a"), "focus stays on the held frame (L204)"

        own.keyboard.press("Escape")
        hear(own, f"Move cancelled. {a} is back in Ideas, position 1 of 3.")
        assert fa.get_attribute("data-moving") != "true", "Escape ends the hold"
        assert focused_post(own) == w.pid("a"), "focus stays on the frame after cancel (L204)"
        shows_order(own, initial, "Alpha is back where it was picked up")
        assert_api_order(cl, w.id, initial, "the cancelled move saved nothing")
        assert cl.get(f"/api/posts/{w.pid('a')}").json()["version"] == 1, "no move was saved, version unchanged"
        assert (fx.get_attribute("data-likes"), fx.get_attribute("data-score")) == ("1", "-1"), \
            "Xray keeps the stored counts after the cancel"


def test_wf_move_conflict_others_live_while_held(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=five_posts(t))
    a = w.titles["a"]
    late = f"Late {t}"
    ideas, booked, done = (w.sec(s) for s in SECTIONS)
    mod, co2 = w.client("mod"), w.client("co2")
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        fa = frame(con, a)
        fa.focus()
        con.keyboard.press("Space")
        hear(con, f"Picked up {a}. Ideas, position 1 of 3.")
        con.keyboard.press("ArrowDown")
        hear(con, f"{a}: Ideas, position 2 of 3.")

        answers(move(mod, w.pid("x"), done, 1), 200, what="the moderator moves Xray to Done")
        r = create_post(co2, w.id, done, late)
        answers(r, 201, what="co2 adds Late in Done")
        late_id = r.json()["id"]
        others = {booked: w.pids("y"), done: [w.pid("x"), late_id]}
        assert_api_order(mod, w.id, others, "the other people's changes are saved")

        shows_order(con, others, "the holder's screen shows Xray's move and the new post within the live band (L215, L662)")
        heard_line(con, f"{w.name('co2')} added {late}.")
        assert fa.get_attribute("data-moving") == "true", "Alpha is still held after other posts' live changes (L215)"
        assert focused_post(con) == w.pid("a"), "focus stays on the held frame (L204)"

        answers(move(mod, w.pid("a"), booked, 1, 1), 200, what="the moderator moves Alpha itself at version 1")
        assert_api_order(mod, w.id, {ideas: w.pids("b", "c"), booked: w.pids("a", "y"), done: [w.pid("x"), late_id]},
                         "the moderator's move of Alpha is saved")
        shows_api_order(vie, mod, w.id, "a watching viewer shows the moderator's move of Alpha")

        def still_held() -> bool:
            return (fa.get_attribute("data-moving") == "true" and focused_post(con) == w.pid("a")
                    and region(con, "Booked").get_by_role("article", name=a, exact=True).count() == 0
                    and dom_order(con).get(done) == [w.pid("x"), late_id])
        stays(con, still_held, "the live move of the held post is not applied on the holder's screen (L215); Alpha stays held, not in Booked")

        con.keyboard.press("Space")
        heard_line(con, f"{w.name('mod')} moved {a} first. It is now in Booked, position 1 of 2.")
        shows_api_order(con, mod, w.id, "the loser's screen ends in the winner's order (L594)")
        shows_api_order(vie, mod, w.id, "the viewer's screen keeps the winner's order")
    post = w.client("con").get(f"/api/posts/{w.pid('a')}").json()
    assert (post["section_id"], post["position"], post["version"]) == (booked, 1, 2), \
        f"the holder's stale drop saved nothing: {post}"


FINAL_QUIET_S = LIVE_BAND_S
LOUPE_PX_SLACK = LOUPE_SCALE * PX_SLACK
WIDE_SECTION_PX = LAPTOP["width"] / 2


def final_state(page: Page, check: Callable[[], bool], what: str, seconds: float = LIVE_WAIT_S) -> None:
    deadline = time.monotonic() + seconds + FINAL_QUIET_S
    since: float | None = None
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            ok = bool(check())
        except (PlaywrightError, AssertionError, KeyError, TypeError) as exc:
            ok, last = False, exc
        now = time.monotonic()
        if not ok:
            since = None
        elif since is None:
            since = now
        elif now - since >= FINAL_QUIET_S:
            return
        advance(page, STEP_MS)
    pytest.fail(f"expected within {seconds}s, and then held for {FINAL_QUIET_S}s: {what} ({last})")


def focus_inside(loc: Locator) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"))


def sections_wide(page: Page, wide: bool) -> bool:
    widths = [region(page, s).bounding_box()["width"] for s in SECTIONS]
    return all((x > WIDE_SECTION_PX) if wide else (x < WIDE_SECTION_PX) for x in widths)


def test_wf_roles_invite_demote_open_loupe(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("p", "Ideas", "co2", f"Sun {t}")])
    title, pid = w.titles["p"], w.pid("p")
    reply = f"Back in {t}"
    with ExitStack() as stack:
        con = stack.enter_context(screen(browser, app_url, w.path, w.sess("con")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        f = open_loupe(con, title)
        box = con.get_by_role("textbox", name="Add a comment", exact=True)
        send = con.get_by_role("button", name="Send comment", exact=True)
        reactions = [f"Like {title}", f"Vote up {title}", f"Vote down {title}"]
        assert f.get_by_role("textbox", name="Add a comment", exact=True).count() == 1 and send.count() == 1, \
            "a contributor's loupe has the comment box (L152)"
        assert con.get_by_role("button", name="Add post", exact=True).count() > 0

        own.get_by_role("button", name="Members", exact=True).focus()
        own.keyboard.press("Enter")
        dlg = own.get_by_role("dialog", name="Members", exact=True)
        eventually(own, lambda: dlg.count() > 0 and dlg.first.is_visible(), 'Enter opens dialog "Members"')
        select(dlg.get_by_role("combobox", name=f"Role for {w.name('con')}", exact=True), "Viewer")
        within(lambda: next(m for m in w.client("own").get(f"/api/boards/{w.id}/members").json()["members"]
                            if m["user_id"] == w.uid("con"))["role"] == "viewer", "the demotion is saved", LIVE_WAIT_S)

        eventually(con, lambda: box.count() == 0 and send.count() == 0
                   and con.get_by_role("button", name="Add post", exact=True).count() == 0,
                   'the demoted tab loses textbox "Add a comment", button "Send comment" and Add post live, also inside the open loupe (L60, L152, L634)')
        heard_line(con, f"Your role on {w.title} is now Viewer.")
        if f.get_attribute("data-loupe") != "open":
            open_loupe(con, title)
        for name in reactions:
            loc = f.get_by_role("button", name=name, exact=True)
            assert loc.count() == 1 and loc.is_enabled(), f'a viewer keeps button "{name}" in the loupe (L148, L170)'
        assert f.get_by_role("textbox", name="Add a comment", exact=True).count() == 0, "a viewer's loupe has no comment box (L129, L152)"
        answers(w.client("con").post(f"/api/posts/{pid}/comments", json={"text": reply}), 403, {"error": "forbidden"},
                "the demoted member's next comment (L540, L557)")

        answers(w.client("own").patch(f"/api/boards/{w.id}/members/{w.uid('con')}", json={"role": "contributor"}), 200,
                what="promote back to contributor")
        eventually(con, lambda: con.get_by_role("button", name="Add post", exact=True).count() > 0
                   and (f.get_attribute("data-loupe") != "open" or f.get_by_role("textbox", name="Add a comment", exact=True).count() == 1),
                   "the promoted tab regains Add post and, in an open loupe, the comment box live (L634)")
        heard_line(con, f"Your role on {w.title} is now Contributor.")
        if f.get_attribute("data-loupe") != "open":
            open_loupe(con, title)
        restored = f.get_by_role("textbox", name="Add a comment", exact=True)
        assert restored.count() == 1 and f.get_by_role("button", name="Send comment", exact=True).count() == 1
        restored.focus()
        con.keyboard.type(reply)
        con.keyboard.press("Enter")
        within(lambda: reply in [c["text"] for c in w.client("vie").get(f"/api/posts/{pid}/comments").json()["comments"]],
               "Enter in the restored comment box sends the comment (L225)", LIVE_WAIT_S)


def test_wf_sort_group_export_layout_arrows_both_ways(browser: Browser, app_url: str) -> None:
    t = tag()
    w = world(app_url, posts=[P("a", "Ideas", "con", f"Tarp {t}"), P("b", "Booked", "co2", f"Rope {t}"), P("c", "Done", "con", f"Pegs {t}")])
    owner = w.client("own")
    with ExitStack() as stack:
        vie = stack.enter_context(screen(browser, app_url, w.path, w.sess("vie")))
        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        bar = own.get_by_role("toolbar", name="Board view")
        group = bar.get_by_role("radiogroup", name="Layout")
        columns, rows = group.get_by_role("radio", name="Columns", exact=True), group.get_by_role("radio", name="Rows", exact=True)
        assert columns.is_checked() and sections_wide(vie, False) and sections_wide(own, False), "the board starts in columns layout"

        columns.focus()
        own.keyboard.press("ArrowRight")
        within(lambda: owner.get(f"/api/boards/{w.id}").json()["layout"] == "rows", "ArrowRight saves rows layout (L250)", LIVE_WAIT_S)
        for page, who in ((vie, "viewer"), (own, "owner")):
            eventually(page, lambda p=page: sections_wide(p, True), f"the {who}'s sections become full-width rows live (L592)")
        final_state(own, lambda: rows.is_checked() and focus_inside(group),
                    'after the save settles, Rows is checked and focus is still inside radiogroup "Layout" (L250)')

        own.keyboard.press("ArrowLeft")
        within(lambda: owner.get(f"/api/boards/{w.id}").json()["layout"] == "columns", "ArrowLeft saves columns layout again (L250)",
               LIVE_WAIT_S)
        for page, who in ((vie, "viewer"), (own, "owner")):
            eventually(page, lambda p=page: sections_wide(p, False), f"the {who}'s sections go back side by side live (L592)")
        final_state(own, lambda: columns.is_checked() and not rows.is_checked() and focus_inside(group),
                    'after the second save, Columns is checked and focus is still inside radiogroup "Layout"')


def test_wf_privacy_share_private_keyboard_focus(browser: Browser, app_url: str) -> None:
    t = tag()
    secret = f"pw-priv-{t}"
    w = world(app_url, privacy="password", password=secret, link_access="view", posts=[P("p", "Ideas", "con", f"Cairn {t}")])
    token, title = w.token, w.titles["p"]
    with ExitStack() as stack:
        page = stack.enter_context(screen(browser, app_url, f"/s/{token}", live=False))
        streams: list[str] = []
        page.on("response", lambda r: streams.append(r.url) if "/events" in r.url else None)
        page.on("websocket", lambda ws: streams.append(ws.url))
        eventually(page, lambda: page.get_by_role("heading", name="This board is password protected").count() == 1,
                   "the share page of a password board asks a stranger for the password (L624)")
        field(page, "Board password").focus()
        page.keyboard.type(secret)
        page.get_by_role("button", name="Open board", exact=True).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: frame(page, title).count() == 1 and bool(streams), "the unlocked share page shows the board, live")

        own = stack.enter_context(screen(browser, app_url, w.path, w.sess("own")))
        opener = own.get_by_role("button", name="Board settings", exact=True)
        opener.focus()
        own.keyboard.press("Enter")
        dlg = own.get_by_role("dialog", name="Board settings", exact=True)
        eventually(own, lambda: dlg.count() > 0 and dlg.first.is_visible(), 'Enter opens dialog "Board settings"')
        private = dlg.get_by_role("radiogroup", name="Privacy").get_by_role("radio", name="Private", exact=True)
        private.focus()
        own.keyboard.press("Space")
        eventually(own, lambda: private.is_checked(), "Space chooses Private")
        dlg.get_by_role("button", name="Save settings", exact=True).focus()
        own.keyboard.press("Enter")
        within(lambda: w.client("own").get(f"/api/boards/{w.id}").json()["privacy"] == "private", "privacy saved as private", LIVE_WAIT_S)

        eventually(page, lambda: page.get_by_role("heading", name="Board not found").count() > 0,
                   "the stranger's unlocked share page turns into the not-found screen live (L629)")
        assert frame(page, title).count() == 0, "the not-found screen shows no post"
        pump(own)
        if dlg.count() > 0 and dlg.first.is_visible():
            own.keyboard.press("Escape")
        final_state(own, lambda: (dlg.count() == 0 or not dlg.first.is_visible()) and is_focused(opener),
                    'once the owner\'s screen settles, the dialog is closed and focus is on button "Board settings" (L196)')

        for path in (f"/api/links/{token}", f"/api/boards/{w.id}"):
            r = page.request.get(app_url + path)
            assert r.status == 404 and r.json() == {"error": "not_found"}, \
                f"the stranger's old unlock opens nothing once the board is private: {path} {r.status} {r.text()[:200]}"
    answers(w.client().get(f"/api/links/{token}"), 404, {"error": "not_found"}, "the old share link after Private")


def test_wf_embed_readonly_rows_loupe_size(browser: Browser, app_url: str) -> None:
    t = tag()
    words = ["Map", "Tide tables", "Packing list for the long walk", "Fern", "Lunch spot by the old stone bridge"]
    sections = ["Ideas", "Ideas", "Booked", "Booked", "Done"]
    w = world(app_url, privacy="public", link_access="view", layout="rows",
              posts=[P(f"p{i}", s, "con", f"{word} {t}") for i, (word, s) in enumerate(zip(words, sections))])
    with screen(browser, app_url, w.board["embed_path"], viewport=LAPTOP, reduced=True) as emb:
        pump(emb)
        sheet_w = emb.evaluate("() => document.documentElement.clientWidth")
        for key in sorted(w.titles):
            title = w.titles[key]
            f = frame(emb, title)
            assert f.get_attribute("data-loupe") == "closed"
            shut = f.bounding_box()
            open_loupe(emb, title)
            pump(emb)
            grown = f.bounding_box()
            assert abs(grown["height"] - LOUPE_SCALE * shut["height"]) <= LOUPE_PX_SLACK, \
                f'the open loupe of "{title}" is four times the frame height (L118): {shut["height"]} -> {grown["height"]}'
            cap = min(LOUPE_SCALE * shut["width"], sheet_w)
            assert grown["width"] <= cap + LOUPE_PX_SLACK, \
                f'the open loupe of "{title}" is at most four times the frame width, capped at the sheet (L118): ' \
                f'{shut["width"]} -> {grown["width"]}, cap {cap}'
            emb.keyboard.press("Escape")
            eventually(emb, lambda: f.get_attribute("data-loupe") == "closed" and is_focused(f),
                       f'Escape closes the loupe of "{title}" and focus returns to the frame (L221)')
            pump(emb)
