from __future__ import annotations

import contextlib
import json
import math
import os
import queue
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, quote as url_quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    camera,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    scene_frames,
    scroll_samples,
    select,
    session,
    shipped_packages,
    tab_order,
    unique,
)

OWNER_EMAIL = "tamsin@oakgall.test"
OWNER_PASSWORD = "commonplace-1847"
OWNER_NAME = "Tamsin Okoro"
HOME_ZONE_SEED = "Europe/London"

HTTP_TIMEOUT = 30.0
UI_TIMEOUT_MS = 15000
UI_WAIT_S = 15
POLL_S = 0.25
LIVE_S = 2
LIVE_MS = 2000
SHARE_REFRESH_MS = 5000
CACHE_DELETE_S = 5
STORAGE_POLL_MS = 10000
STORAGE_FORGET_S = 10
STORAGE_RETURN_S = 15
STORAGE_CALL_S = 3
SEARCH_DEBOUNCE_MS = 200
SAVE_ADVANCE_MS = 1200
BOARD_SAVE_MS = 400
UNDO_PAUSE_MS = 1000
JSON_LIMIT = 1_000_000
FILE_LIMIT = 10_000_000
BLOCK_LIMIT = 20_000
TEXT_LIMIT = 2_000
REVISIONS_KEPT = 200
SEARCH_CAP = 200
QUERY_CAP = 500
RETURN_CAP = 2_000
LOCK_FAILURES = 5
IP_FAILURES = 50
SHORT_WINDOW_S = 20
SHORT_IDLE_S = 20
EDGE_SLACK_S = 5
EXPIRY_WAIT_S = 100
SEARCH_BUDGET_S = 1
SHARE_MAX_DAYS = 90
DEVICE_SKEW_H = 7

MORPH_MS = (240, 320)
TETHER_MS = (150, 210)
NUMERAL_MS = (130, 190)
TETHER_TOTAL_MS = 750
REVEAL_MS = 320
FADE_MS = 120
CARD_TURN_MS = 420
ROW_MS = 160
ROW_FIRST_MS = 210
ROW_STEP_MS = 60
TITLE_MS = 280
ROW_SLIDE_MS = 240
GAP_MS = 180
BOARD_SLIDE_MS = 240
FLY_MS = 600
IDLE_RESUME_MS = 5000
IDLE_DEG_PER_S = 6
DURATION_TOL = 0.06
ORDER_SLACK_MS = 25

COLUMN_STEP = 296
BOARD_GRID = 8
DRAWER_W_SPRING = 20.0
HOME_PHI_DEG = 20
HOME_D = 40
FLY_PHI_DEG = 15
D_MIN, D_MAX = 12, 90
PHI_LIMIT = 80
LABEL_OFFSET_PX = 12
LABEL_DETAIL_PX = 6
GRAPH_CANVAS_H = 560
SETTLE_TOL = 0.05

DEFAULT_UA = "quire-verifier"
FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0"
SAFARI_MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8f2e1190005a602cb44e2e9fa0000000049454e44ae426082")
JPEG = b"\xff\xd8\xff\xe0" + bytes(range(64))
GIF = b"GIF89a" + bytes(range(64))
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + bytes(range(64))
PDF = b"%PDF-1.4\n" + b"1 0 obj\n<<>>\nendobj\n" * 4

COPY_WRONG = "That email and password don't match."
COPY_LOCKED = "Too many sign-in attempts. Wait a while, then try again."
COPY_SIGNED_OUT = "You've been signed out on this device."
COPY_EMPTY_DAY = "Nothing written today. Start with a line from what you're reading."
COPY_CONFLICT = "This block changed on another device."
COPY_QUOTE_REFUSED = "That block couldn't be quoted."
COPY_STORAGE_BANNER = "Attachments are unavailable right now. Your writing is still saved."
COPY_ATTACH_OUTAGE = "This attachment can't be shown while storage is unavailable."
COPY_UPLOAD_OUTAGE = "Storage is unavailable, so this file was not attached."
COPY_NOT_SAVED = "Not saved. Check your connection and try again."
COPY_TOO_LARGE = "That file is too large to attach."
COPY_WRONG_TYPE = "Attach an image (PNG, JPEG, GIF, WebP) or a PDF."
COPY_LINK_INACTIVE = "This link is no longer active"
COPY_LINK_ASK = "Ask the person who shared it for a new link."
COPY_LINK_UNKNOWN = "This link is not recognised"
COPY_NOT_IN_SHARE = "This note is not part of this share."
COPY_QUOTE_OUTSIDE = "Quoted from a note outside this share."
COPY_SCOPE_GONE = "That share link is no longer active."
COPY_BOARD_REFUSED = "Those cards couldn't be moved."
COPY_ALREADY_OUT = "That device is already signed out."
COPY_PASSWORD_CHANGED = "Password changed. Your other devices are signed out."
COPY_SYNC_PAUSED = "Live updates paused. Reconnecting."
COPY_LINK_REVOKED = "Link revoked. Anyone using it now sees that it is no longer active."

COMMANDS = ["Go to Today", "Open graph", "Open timeline", "Open queries", "Open settings", "Switch to Lamplight", "New type"]
HALF_TURN_DEG = 180
STEP_TYPING = "typing"
STEP_RESTORE = "restore"
THEME_LAMPLIGHT = "Lamplight"
KIND_BOOK = "Book"
PICKER_TRIGGER = "(" * 2
WRONG_PASSWORD = "wrong-password-probe"
ZONE_AHEAD = "Pacific/Kiritimati"
ZONE_BEHIND = "Etc/GMT+12"
ZONE_TOKYO = "Asia/Tokyo"
YEAR_PROBE = 1999
SHELF_VALUE = "East"
ATTACH_NAME = "page.png"
KEPT_FILE = "kept.png"
REFUSED_FILE = "refused.png"
BACK_FILE = "back.png"
HOST_LINE = "host line"
MERGE_TEXT = "hello world"
CONFLICT_A = "alpha beta gamma delta"
CONFLICT_B = "one two three four"
CARET_TEXT = "the margin is where it starts"
CARET_PREFIX = "XYZ "
DIFF_V1 = "the quick brown fox"
DIFF_V2 = "the slow brown dog"
RESTORE_STEM, RESTORE_OLD, RESTORE_NEW = "alpha", "one", "two"
UNDO_BASE, UNDO_TAIL, UNDO_BANG, UNDO_REMOTE = "steady text", " more", "!", "R "
QUOTED_TEXT, QUOTED_TAIL = "shared passage", " edited"
SINGLE_TEXT, SINGLE_TAIL, SINGLE_HEAD = "one body", " here", "Just "
LATEST_TEXTS = ("ember first", "embrace second", "ash third")
LATEST_SUFFIX = " emb"
LIVE_BODY, LIVE_PREFIX = "replaced", "now "
GAP_TEXT, GAP_TAIL = "gap text", " arrives"
REBASE_TEXT, REBASE_TAIL, REBASE_REMOTE = "base line", " tail", "REMOTE "
OUTAGE_TEXT, OUTAGE_TAIL = "outage text", " still"
MISSPELT_FIELD = "Kidn"
BOLD_TEXT, IT_TEXT, KEPT_TEXT = "Bold", "it", "kept"
LINK_OK, LINK_BAD, LINK_MAIL = "ok", "bad", "mail"
SAFE_HREF = "https://ex.test/?a=1&b=2"
MAIL_HREF = "mailto:x@ex.test"
UNKNOWN_TOKEN = "unknown" + "0" * 8

_pause = threading.Event().wait


def tok() -> str:
    name = re.sub(r"[^a-z0-9]", "", unique("q")[0].lower())
    return "q" + name[-8:] + uuid.uuid4().hex[:8]


def poll(fn: Callable[[], Any], seconds: float, interval: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value or time.monotonic() > deadline:
            return value
        _pause(interval)


def within(page: Page, check: Callable[[], Any], seconds: float = UI_WAIT_S, step_ms: float = 16) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, step_ms)


def env_url(name: str) -> str:
    url = os.environ.get(name, "")
    assert url, f"{name} is not set"
    return url.rstrip("/")


def short_url() -> str:
    return env_url("APP_SHORT_URL")


def minio_down_url() -> str:
    return env_url("APP_MINIO_DOWN_URL")


def utc(stamp: str) -> datetime:
    assert stamp.endswith("Z"), stamp
    return datetime.fromisoformat(stamp[:-1] + "+00:00")


def heading_date(d: date) -> str:
    return f"{d:%A} {d.day} {d:%B} {d.year}"


def short_time(dt: datetime) -> str:
    return f"{dt.day} {dt:%b} {dt.year}, {dt:%H:%M}"


def expires_display(dt: datetime, zone: str) -> str:
    local = dt.astimezone(ZoneInfo(zone))
    return f"{short_time(local)} {zone}"


def p_body(text: str) -> str:
    return "<p>" + text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + "</p>"


def plural(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def el(name: str, inner: str, href: str | None = None) -> str:
    attr = "" if href is None else " href=" + '"' + href.replace("&", "&amp;").replace('"', "&quot;") + '"'
    return "<" + name + attr + ">" + inner + "</" + name + ">"


def block_name(n: int) -> str:
    return f"Block {n}"


def history_name(n: int) -> str:
    return f"History of block {n}"


def chip_name(title: str, n: int) -> str:
    return f"Quoted from {title}, {plural(n, 'backlink')}"


def quoted_copy(title: str, n: int) -> str:
    return f"Quoted from {title}. {plural(n, 'backlink')}."


def removed_copy(title: str, n: int) -> str:
    return f"Quote removed. {title} has {plural(n, 'backlink')}."


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def _assert_true(value: Any) -> None:
    assert value, value


def path_of(page: Page) -> str:
    return urlparse(page.url).path


def query_of(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


class Api:
    def __init__(self, base: str, ua: str = DEFAULT_UA) -> None:
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, headers={"User-Agent": ua})
        self.csrf = ""

    def sign_in(self, password: str = OWNER_PASSWORD) -> "Api":
        r = self.c.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": password})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf_token"]
        return self

    @property
    def cookie(self) -> str:
        value = self.c.cookies.get("quire_session")
        assert value
        return value

    def call(self, method: str, path: str, csrf: bool = True, **kw: Any) -> httpx.Response:
        headers = dict(kw.pop("headers", None) or {})
        if csrf and method.upper() not in ("GET", "HEAD"):
            headers.setdefault("X-CSRF-Token", self.csrf)
        return self.c.request(method, path, headers=headers, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("POST", path, **kw)

    def put(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, **kw)

    def patch(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("PATCH", path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)

    def ok(self, method: str, path: str, status: int, **kw: Any) -> Any:
        r = self.call(method, path, **kw)
        assert r.status_code == status, f"{method} {path}: {r.status_code} {r.text}"
        return r.json() if r.content else None

    @property
    def session_id(self) -> str:
        return self.ok("GET", "/api/session", 200)["session_id"]


def owner(base: str, ua: str = DEFAULT_UA) -> Api:
    return Api(base, ua).sign_in()


def server_now(api: Api) -> datetime:
    r = api.c.get("/api/health")
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def home_zone(api: Api) -> str:
    return api.ok("GET", "/api/settings", 200)["home_time_zone"]


@contextlib.contextmanager
def home_clock(api: Api, zone: str):
    old = home_zone(api)
    api.ok("PUT", "/api/settings", 200, json={"home_time_zone": zone})
    try:
        yield
    finally:
        api.put("/api/settings", json={"home_time_zone": old})


def types(api: Api) -> list[dict]:
    return api.ok("GET", "/api/types", 200)["types"]


def type_named(api: Api, name: str) -> dict:
    return next(t for t in types(api) if t["name"] == name)


def field(name: str, kind: str, required: bool = False, options: list[str] | None = None, target: str | None = None) -> dict:
    return {"name": name, "kind": kind, "required": required, "options": options, "target_type_id": target}


def new_type(api: Api, fields: list[dict] | None = None, name: str | None = None) -> dict:
    return api.ok("POST", "/api/types", 201, json={"name": name or f"T{tok()}", "fields": fields or []})


def add_field(api: Api, type_id: str, f: dict) -> dict:
    return api.ok("POST", f"/api/types/{type_id}/fields", 201, json=f)


def new_obj(api: Api, type_id: str, title: str | None = None, props: dict | None = None) -> dict:
    return api.ok("POST", "/api/objects", 201, json={"type_id": type_id, "title": title or f"Note {tok()}", "properties": props or {}})


def concept(api: Api, title: str | None = None) -> dict:
    return new_obj(api, type_named(api, "Concept")["id"], title)


def get_obj(api: Api, oid: str) -> dict:
    return api.ok("GET", f"/api/objects/{oid}", 200)


def add_block(api: Api, oid: str, text: str, after: str | None = None) -> dict:
    return api.ok("POST", f"/api/objects/{oid}/blocks", 201, json={"body": text, "after_block_id": after})


def quote(api: Api, host: str, origin_block: str, after: str | None = None) -> dict:
    return api.ok("POST", f"/api/objects/{host}/quotes", 201, json={"origin_block_id": origin_block, "after_block_id": after})


def patch_ops(api: Api, block_id: str, ops: list[dict], base: int, **extra: Any) -> httpx.Response:
    return api.patch(f"/api/blocks/{block_id}", json={"ops": ops, "base_version": base, **extra})


def backlinks(api: Api, oid: str) -> int:
    return get_obj(api, oid)["backlinks"]


def find_seed(api: Api, title: str) -> dict:
    for t in types(api):
        for o in api.ok("GET", f"/api/objects?type_id={t['id']}", 200)["objects"]:
            if o["title"] == title:
                return o
    raise AssertionError(f"seed object {title} missing")


def new_collection(api: Api, members: list[str] = ()) -> dict:
    col = api.ok("POST", "/api/collections", 201, json={"name": f"Collection {tok()}"})
    for oid in members:
        assert api.post(f"/api/collections/{col['id']}/objects", json={"object_id": oid}).status_code == 204
    return col


def local_minute(api: Api, delta: timedelta) -> str:
    local = server_now(api).astimezone(ZoneInfo(home_zone(api)))
    return (local + delta).strftime("%Y-%m-%dT%H:%M")


def new_link(api: Api, col_id: str, delta: timedelta = timedelta(days=2)) -> dict:
    return api.ok("POST", f"/api/collections/{col_id}/share-links", 201, json={"expires_at": local_minute(api, delta)})


def token_of(link: dict) -> str:
    assert link["url"].startswith("/s/")
    return link["url"][3:]


def upload(api: Api, oid: str, name: str, data: bytes, ctype: str) -> httpx.Response:
    return api.post(f"/api/objects/{oid}/attachments", files={"file": (name, data, ctype)})


def node_name(title: str, n: int, suffix: str = "") -> str:
    return f"{title}, {plural(n, 'backlink')}{suffix}"


class Events:
    def __init__(self, api: Api, last_id: str | int | None = None) -> None:
        self.q: queue.Queue = queue.Queue()
        self.lines: list[str] = []
        self.ready = threading.Event()
        self.closed = threading.Event()
        headers = {"Accept": "text/event-stream"}
        if last_id is not None:
            headers["Last-Event-ID"] = str(last_id)
        self.client = httpx.Client(base_url=api.base, cookies=api.c.cookies, timeout=httpx.Timeout(HTTP_TIMEOUT, read=None))
        self.thread = threading.Thread(target=self._run, args=(headers,), daemon=True)
        self.thread.start()
        assert self.ready.wait(HTTP_TIMEOUT), "live sync channel did not open"

    def _run(self, headers: dict) -> None:
        try:
            with self.client.stream("GET", "/api/events", headers=headers) as r:
                self.status = r.status_code
                ev: dict = {"id": None, "event": "message", "data": []}
                for line in r.iter_lines():
                    self.lines.append(line)
                    self.ready.set()
                    if line == "":
                        if ev["data"]:
                            self.q.put({"id": ev["id"], "event": ev["event"], "data": json.loads("\n".join(ev["data"]))})
                        ev = {"id": None, "event": "message", "data": []}
                        continue
                    if line.startswith(":"):
                        continue
                    key, _, val = line.partition(":")
                    val = val[1:] if val.startswith(" ") else val
                    if key == "data":
                        ev["data"].append(val)
                    elif key in ("id", "event"):
                        ev[key] = val
        except Exception:
            pass
        finally:
            self.ready.set()
            self.closed.set()

    def wait(self, pred: Callable[[dict], bool], seconds: float = LIVE_S) -> dict:
        deadline = time.monotonic() + seconds
        while True:
            left = deadline - time.monotonic()
            assert left > 0, "expected live sync event did not arrive in time"
            try:
                ev = self.q.get(timeout=left)
            except queue.Empty:
                continue
            if pred(ev):
                return ev

    def drain(self) -> list[dict]:
        out = []
        while not self.q.empty():
            out.append(self.q.get())
        return out

    def close(self) -> None:
        self.client.close()


@contextlib.contextmanager
def workspace(browser: Browser, base: str, path: str, size: tuple[int, int] = (1280, 800), **opts: Any):
    with open_app(browser, base + "/api/health", **opts) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        api = Api(base, page.evaluate("navigator.userAgent")).sign_in()
        page.context.add_cookies([{"name": "quire_session", "value": api.cookie, "url": base}])
        page.goto(base + path)
        yield page, api


def ui_sign_in(page: Page, password: str = OWNER_PASSWORD) -> None:
    fill(page.get_by_label("Email", exact=True), OWNER_EMAIL)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in", exact=True))


def announcements(page: Page):
    return page.get_by_role("status", name="Announcements")


def alert_with(page: Page, text: str):
    return page.get_by_role("alert").filter(has_text=text)


def block_box(page: Page, n: int):
    return page.get_by_role("textbox", name=f"Block {n}", exact=True)


def mark_no_reload(page: Page) -> None:
    page.evaluate("() => { window.__quireMark = 'kept' }")


def assert_no_reload(page: Page) -> None:
    assert page.evaluate("() => window.__quireMark") == "kept", "the page reloaded"


def focused_name(page: Page) -> str:
    names = page.evaluate(
        """() => { const e = document.activeElement; if (!e) return '';
        return e.getAttribute('aria-label') || (e.labels && e.labels[0] ? e.labels[0].textContent : '') || e.textContent || ''; }"""
    )
    return (names or "").strip()


def is_focused(loc) -> bool:
    return loc.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def combo_label(loc) -> str:
    return loc.evaluate(
        "e => (e.selectedOptions && e.selectedOptions.length ? e.selectedOptions[0].textContent : (e.value || e.textContent || '')).trim()"
    )


CARET_JS = r"""
(el, off) => {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const cs = getComputedStyle(el); const c = document.createElement('canvas').getContext('2d');
    c.font = cs.font; const r = el.getBoundingClientRect();
    return r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + c.measureText(el.value.slice(0, off)).width - el.scrollLeft;
  }
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, acc = 0, last = null;
  while ((n = w.nextNode())) { last = n; const len = n.data.length;
    if (off <= acc + len) { const rg = document.createRange(); const o = off - acc;
      if (o < len) { rg.setStart(n, o); rg.setEnd(n, o + 1); return rg.getBoundingClientRect().left; }
      rg.setStart(n, o - 1); rg.setEnd(n, o); return rg.getBoundingClientRect().right; }
    acc += len; }
  return null;
}
"""

SELECTION_JS = r"""
el => {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.selectionStart;
  const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0);
  const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
"""

TEXT_JS = "el => (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? el.value : el.innerText.replace(/\\n$/, '')"

RECORDER_JS = r"""
() => {
  if (window.__quireRec) { window.__quireRec.length = 0; window.__quireAnims.length = 0; return; }
  window.__quireRec = []; window.__quireAnims = []; window.__quireHold = null;
  const seen = new WeakSet();
  const marks = ['data-tether','data-backlink-count','data-board-card','data-card-inner','data-card-face','data-reading-progress'];
  const describe = (t) => {
    const el = t && t.nodeType === 1 ? t : null; const d = {tag: el ? el.tagName.toLowerCase() : ''};
    if (!el) return d;
    for (const m of marks) { const c = el.closest('[' + m + ']'); if (c) d[m] = c.getAttribute(m); }
    d.main = el.tagName === 'MAIN' || el.getAttribute('role') === 'main';
    d.h1 = el.tagName === 'H1' || (el.getAttribute('role') === 'heading' && el.getAttribute('aria-level') === '1');
    d.row = !!el.closest('tr,[role=row]');
    d.textbox = !!el.closest('[role=textbox],textarea,[contenteditable=true]') || !!el.querySelector('[role=textbox],textarea,[contenteditable=true]');
    return d;
  };
  const record = (a, kind) => {
    if (!a || seen.has(a)) return; seen.add(a);
    const eff = a.effect; const tm = eff && eff.getTiming ? eff.getTiming() : {};
    const target = eff && eff.target;
    window.__quireAnims.push(a);
    window.__quireRec.push({i: window.__quireAnims.length - 1, kind, duration: typeof tm.duration === 'number' ? tm.duration : 0,
      delay: tm.delay || 0, real: document.timeline.currentTime, page: performance.now(), target: describe(target)});
    if (window.__quireHold && target && target.nodeType === 1 && window.__quireHold(target)) a.pause();
  };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); record(a, 'waapi'); return a; };
  const scan = (e) => { const t = e.target; if (t && t.getAnimations) for (const a of t.getAnimations()) record(a, e.type); };
  document.addEventListener('transitionrun', scan, true);
  document.addEventListener('animationstart', scan, true);
}
"""


def record(page: Page) -> None:
    page.evaluate(RECORDER_JS)


def recorded(page: Page) -> list[dict]:
    return page.evaluate("() => window.__quireRec.slice()")


def starts(r: dict) -> tuple[float, float]:
    extra = 0 if r["kind"] == "animationstart" else r["delay"]
    return r["real"] + extra, r["page"] + extra


def near(value: float, target: float, tol: float = DURATION_TOL) -> bool:
    return abs(value - target) <= target * tol + 1


def seek(page: Page, index: int, ms: float) -> None:
    page.evaluate("([i, t]) => { const a = window.__quireAnims[i]; a.pause(); a.currentTime = t; }", [index, ms])


def slow_animations(page: Page, rate: float) -> None:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": rate})


def as16(m: Any) -> list[float] | None:
    if isinstance(m, dict):
        for k in ("value", "data", "matrix", "values"):
            if k in m:
                m = m[k]
                break
    if isinstance(m, dict):
        m = list(m.values())
    try:
        vals = [float(x) for x in m]
    except (TypeError, ValueError):
        return None
    return vals if len(vals) == 16 else None


def is_model(m: list[float]) -> bool:
    return all(abs(m[i]) < 1e-6 for i in (1, 2, 3, 4, 6, 7, 8, 9, 11)) and abs(m[15] - 1) < 1e-6 and abs(m[0] - m[5]) < 1e-6 and abs(m[5] - m[10]) < 1e-6


def is_view(m: list[float]) -> bool:
    rows = [[m[c * 4 + r] for c in range(3)] for r in range(3)]
    for i in range(3):
        for j in range(3):
            dot = sum(rows[i][k] * rows[j][k] for k in range(3))
            if abs(dot - (1 if i == j else 0)) > 1e-3:
                return False
    return math.hypot(m[12], m[13], m[14]) > 1e-3 and abs(m[15] - 1) < 1e-6


def graph_group(page: Page):
    return page.get_by_role("group", name="Link graph")


def graph_canvas(page: Page):
    return graph_group(page)


CANVAS_BOX_JS = "g => { const r = g.querySelector('canvas').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }"


def canvas_box(page: Page) -> dict:
    return graph_group(page).evaluate(CANVAS_BOX_JS)


def scene_matrices(page: Page) -> list[list[float]]:
    frames = scene_frames(graph_canvas(page), steps=1, step_ms=50)
    found = [v for v in (as16(m) for m in (frames[-1].get("matrices") or [])) if v]
    return found or [v for v in (as16(m) for m in camera(page)) if v]


def drawn_view_and_models(page: Page) -> tuple[list[float], list[list[float]]]:
    advance(page, 32)
    return view_and_models(page)


def view_and_models(page: Page) -> tuple[list[float], list[list[float]]]:
    mats = scene_matrices(page)
    views = [m for m in mats if is_view(m)]
    models = [m for m in mats if is_model(m) and 0.55 < m[0] < 2.45 and math.hypot(m[12], m[13], m[14]) > 1e-9]
    assert views, "no camera matrix uploaded"
    return views[-1], models


def eye_of(v: list[float]) -> list[float]:
    t = (v[12], v[13], v[14])
    return [-sum(v[c * 4 + r] * t[r] for r in range(3)) for c in range(3)]


def angles(v: list[float]) -> tuple[float, float]:
    z = (v[2], v[6], v[10])
    return math.degrees(math.atan2(z[0], z[2])), math.degrees(math.asin(max(-1, min(1, z[1]))))


def target_of(v: list[float], d: float) -> list[float]:
    e, z = eye_of(v), (v[2], v[6], v[10])
    return [e[i] - d * z[i] for i in range(3)]


def angle_diff(a: float, b: float) -> float:
    return (a - b + 180) % 360 - 180


def project(v: list[float], p: list[float], box: dict) -> tuple[float, float, float]:
    vec = [sum(v[c * 4 + r] * ([*p, 1.0][c]) for c in range(4)) for r in range(4)]
    depth = -vec[2]
    f = 1 / math.tan(math.radians(22.5))
    aspect = box["width"] / box["height"]
    x = box["x"] + ((f / aspect) * vec[0] / depth + 1) / 2 * box["width"]
    y = box["y"] + (1 - (f * vec[1] / depth)) / 2 * box["height"]
    return x, y, depth


def node_size(n: int) -> float:
    return min(2.4, 0.6 + 0.15 * n)


def draws_in(frame: dict) -> int:
    d = frame.get("draws")
    return int(d) if isinstance(d, (int, float)) else len(d or [])


def fnv1a(text: str) -> int:
    h = 2166136261
    for b in text.encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def jitter(seed: int) -> list[float]:
    a, out = seed & 0xFFFFFFFF, []
    for _ in range(3):
        a = (a + 1831565813) & 0xFFFFFFFF
        q = ((a ^ (a >> 15)) * (a | 1)) & 0xFFFFFFFF
        q = ((q + (((q ^ (q >> 7)) * (q | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ q
        out.append(((q ^ (q >> 14)) & 0xFFFFFFFF) / 4294967296)
    return out


def settle_layout(graph: dict, type_list: list[dict]) -> dict[str, list[float]]:
    order = {t["id"]: i for i, t in enumerate(type_list)}
    nodes = sorted(graph["nodes"], key=lambda n: (order[n["type_id"]], n["title"].lower(), n["id"].lower()))
    idx = {n["id"]: i for i, n in enumerate(nodes)}
    radius = [6 + 4 * order[n["type_id"]] for n in nodes]
    members: dict[str, list[dict]] = {}
    for n in nodes:
        members.setdefault(n["type_id"], []).append(n)
    pos: list[list[float]] = [[0.0, 0.0, 0.0] for _ in nodes]
    for tid, group in members.items():
        R = 6 + 4 * order[tid]
        for j, n in enumerate(group):
            y = 1 - 2 * (j + 0.5) / len(group)
            rho = math.sqrt(1 - y * y)
            th = j * 137.50776405 * math.pi / 180
            u = jitter(fnv1a(n["id"].lower()))
            pos[idx[n["id"]]] = [R * rho * math.cos(th) + u[0] - 0.5, R * y + u[1] - 0.5, R * rho * math.sin(th) + u[2] - 0.5]
    edges = [(idx[e["from"]], idx[e["to"]]) for e in sorted(graph["edges"], key=lambda e: e["id"].lower())]
    count = len(nodes)

    def accel(P: list[list[float]]) -> list[list[float]]:
        acc = [[0.0, 0.0, 0.0] for _ in range(count)]
        for i in range(count):
            pi, ai = P[i], acc[i]
            for j in range(i + 1, count):
                pj = P[j]
                dx, dy, dz = pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]
                L = math.sqrt(dx * dx + dy * dy + dz * dz)
                ux, uy, uz = (1.0, 0.0, 0.0) if L == 0 else (dx / L, dy / L, dz / L)
                m = max(L, 0.5)
                f = 40 / (m * m)
                ai[0] -= f * ux; ai[1] -= f * uy; ai[2] -= f * uz
                aj = acc[j]
                aj[0] += f * ux; aj[1] += f * uy; aj[2] += f * uz
        for a, b in edges:
            pa, pb = P[a], P[b]
            dx, dy, dz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
            L = math.sqrt(dx * dx + dy * dy + dz * dz)
            ux, uy, uz = (1.0, 0.0, 0.0) if L == 0 else (dx / L, dy / L, dz / L)
            f = 0.08 * (L - 6)
            acc[a][0] += f * ux; acc[a][1] += f * uy; acc[a][2] += f * uz
            acc[b][0] -= f * ux; acc[b][1] -= f * uy; acc[b][2] -= f * uz
        for i in range(count):
            p = P[i]
            L = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
            if L > 0:
                f = -0.2 * (L - radius[i])
                for k in range(3):
                    acc[i][k] += f * (p[k] / L)
        return acc

    vel = [[0.0, 0.0, 0.0] for _ in range(count)]
    acc = accel(pos)
    for _ in range(600):
        for i in range(count):
            for k in range(3):
                pos[i][k] += vel[i][k] * 0.05 + 0.5 * acc[i][k] * 0.05 * 0.05
        new = accel(pos)
        top = 0.0
        for i in range(count):
            for k in range(3):
                vel[i][k] = (vel[i][k] + 0.5 * (acc[i][k] + new[i][k]) * 0.05) * 0.92
            top = max(top, math.sqrt(sum(c * c for c in vel[i])))
        acc = new
        if top < 0.002:
            break
    return {n["id"]: pos[idx[n["id"]]] for n in nodes}


def graph_setup(api: Api, links: tuple[tuple[str, str], ...] = (("Alpha", "Beta"),)) -> tuple[dict, dict[str, dict]]:
    t = tok()
    ty = new_type(api, name=f"Orb{t}")
    ty = add_field(api, ty["id"], field("Link", "relation", target=ty["id"]))
    objs = {n: new_obj(api, ty["id"], f"{n} {t}") for n in ("Alpha", "Beta", "Gamma")}
    for a, b in links:
        api.ok("PATCH", f"/api/objects/{objs[a]['id']}", 200, json={"properties": {"Link": objs[b]["id"]}})
    return ty, {k: get_obj(api, v["id"]) for k, v in objs.items()}


def open_graph(page: Page, count: int) -> None:
    expect(graph_group(page).get_by_role("button")).to_have_count(count, timeout=UI_TIMEOUT_MS)


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices():
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for pkg in shipped_packages():
        assert pkg.name in text, f"{pkg.name} missing from notices"
    for font in ("Fraunces", "Source Serif 4", "IBM Plex Mono"):
        assert font in text


def test_if_licences_allowed():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, bad


def test_if_durable_state_only_postgres_minio():
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = set(pkg.get("dependencies", {}))
    assert not deps & {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "mongodb", "mongoose"}
    stray = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not stray, stray
    assert Postgres().tables()


def test_if_typescript_and_lockfile():
    assert Path("/app/package-lock.json").is_file()
    skip = {"node_modules", "dist", "build", ".git"}
    files = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)]
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    js_in_src = [p for p in files if "src" in p.parts and p.suffix in (".js", ".jsx", ".mjs", ".cjs")]
    assert not js_in_src, js_in_src


def test_if_dev_services_unchanged():
    path = Path("/logs/agent/trajectory.json")
    if not path.is_file():
        return
    data = json.loads(path.read_text())
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name", ""))
            inp = node.get("input") if isinstance(node.get("input"), dict) else None
            if name in ("Write", "Edit", "MultiEdit", "NotebookEdit") and inp:
                target = str(inp.get("file_path") or inp.get("path") or "")
                if re.search(r"((^|/)(docker-)?compose[^/]*\.ya?ml$|(^|/)\.devcontainer/)", target):
                    hits.append(target)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    assert not hits, hits


def test_if_no_third_party_requests(browser, app_url):
    with workspace(browser, app_url, "/today") as (page, _):
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/today", "/graph", "/settings", "/timeline"):
            page.goto(app_url + path)
            advance(page, 1000)
            page.wait_for_load_state("load")
        page.context.clear_cookies()
        page.goto(app_url + "/sign-in")
        page.wait_for_load_state("load")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert seen and not foreign, foreign


def test_sign_in_fresh_session(app_url):
    c1 = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    c2 = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r1 = c1.post("/api/auth/sign-in", json={"email": "  TAMSIN@Oakgall.TEST ", "password": OWNER_PASSWORD})
    r2 = c2.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r1.status_code == 200 and r2.status_code == 200
    b1, b2 = r1.json(), r2.json()
    assert b1["user"]["email"] == OWNER_EMAIL and b1["user"]["display_name"] == OWNER_NAME
    cookie_header = r1.headers["set-cookie"]
    m = re.search(r"quire_session=([^;]+)", cookie_header)
    assert m
    low = cookie_header.lower()
    assert "HttpOnly".lower() in low and "SameSite=Lax".lower() in low and "Path=/".lower() in low
    assert c1.cookies.get("quire_session") != c2.cookies.get("quire_session")
    assert b1["csrf_token"] and b1["csrf_token"] != b2["csrf_token"]
    s1 = c1.get("/api/session").json()
    assert s1["csrf_token"] == b1["csrf_token"] and s1["session_id"] != m.group(1)
    assert s1["user"]["email"] == OWNER_EMAIL
    assert s1["session_id"] != c2.get("/api/session").json()["session_id"]
    for body in ({"email": OWNER_EMAIL}, {"password": OWNER_PASSWORD}):
        r = httpx.post(app_url + "/api/auth/sign-in", json=body, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422 and r.json()["error"] == "validation"


def test_sign_in_lockout_email(app_url):
    base = short_url()
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)

    def attempt(email: str, password: str = "wrong-password-probe") -> httpx.Response:
        return c.post("/api/auth/sign-in", json={"email": email, "password": password})

    stranger = unique("lock")[1]
    first = [attempt(stranger) for _ in range(LOCK_FAILURES - 1)]
    known = [attempt(OWNER_EMAIL) for _ in range(LOCK_FAILURES - 1)]
    for r in first + known:
        assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    assert first[0].content == known[0].content
    u5, k5 = attempt(stranger), attempt(OWNER_EMAIL)
    locked_at = time.monotonic()
    for r in (u5, k5):
        assert r.status_code == 429 and r.json() == {"error": "locked"}
        assert 1 <= int(r.headers["Retry-After"]) <= SHORT_WINDOW_S
    assert u5.content == k5.content
    assert ("Retry-After" in u5.headers) == ("Retry-After" in k5.headers)
    assert attempt(OWNER_EMAIL, OWNER_PASSWORD).status_code == 429

    def lifted() -> bool:
        r = attempt(OWNER_EMAIL, OWNER_PASSWORD)
        assert r.status_code in (200, 429), r.text
        return r.status_code == 200

    assert poll(lifted, SHORT_WINDOW_S + EDGE_SLACK_S, interval=1.0), "lock never lifted"
    elapsed = time.monotonic() - locked_at
    assert SHORT_WINDOW_S - EDGE_SLACK_S <= elapsed <= SHORT_WINDOW_S + EDGE_SLACK_S


def test_sign_in_lockout_client_address():
    base = short_url()
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    start = time.monotonic()
    poll(lambda: time.monotonic() - start > SHORT_WINDOW_S + 1 and c.get("/api/health").status_code == 200, SHORT_WINDOW_S + EDGE_SLACK_S)
    for i in range(IP_FAILURES - 1):
        r = c.post("/api/auth/sign-in", json={"email": unique("ip")[1], "password": "wrong-password-probe"})
        assert r.status_code == 401, f"attempt {i + 1}: {r.status_code}"
    last = c.post("/api/auth/sign-in", json={"email": unique("ip")[1], "password": "wrong-password-probe"})
    assert last.status_code == 429 and last.json() == {"error": "locked"} and int(last.headers["Retry-After"]) >= 1
    assert c.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}).status_code == 429
    ok = poll(lambda: c.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}).status_code == 200,
              SHORT_WINDOW_S + EDGE_SLACK_S, interval=1.0)
    assert ok, "client address lock never lifted"


def test_wf_sign_in_lockout_screen(browser):
    base = short_url()
    probe = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    now = parsedate_to_datetime(probe.get("/api/health").headers["date"])
    with open_app(browser, base + "/sign-in") as page:
        page.clock.set_system_time(now + timedelta(hours=DEVICE_SKEW_H))
        page.reload()
        email = unique("guess")[1]
        fill(page.get_by_label("Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), "wrong-password-probe")
        button = page.get_by_role("button", name="Sign in", exact=True)
        for _ in range(LOCK_FAILURES - 1):
            with page.expect_response(lambda r: r.url.endswith("/api/auth/sign-in")) as resp:
                button.click()
            assert resp.value.status == 401
            expect(alert_with(page, COPY_WRONG)).to_be_visible()
        with page.expect_response(lambda r: r.url.endswith("/api/auth/sign-in")) as resp:
            button.click()
        assert resp.value.status == 429
        expect(alert_with(page, COPY_LOCKED)).to_be_visible()
        expect(alert_with(page, COPY_WRONG)).to_have_count(0)
        expect(button).to_be_enabled()
        page.clock.fast_forward(3_600_000)
        expect(alert_with(page, COPY_LOCKED)).to_be_visible()
        expect(button).to_be_enabled()
        still_locked = probe.post("/api/auth/sign-in", json={"email": email, "password": WRONG_PASSWORD})
        assert still_locked.status_code == 429
        fill(page.get_by_label("Email", exact=True), unique("other")[1])
        with page.expect_response(lambda r: r.url.endswith("/api/auth/sign-in")) as resp:
            button.click()
        assert resp.value.status == 401
        expect(alert_with(page, COPY_WRONG)).to_be_visible()
        expect(alert_with(page, COPY_LOCKED)).to_have_count(0)


def test_csrf_required(app_url):
    api = owner(app_url)
    obj = concept(api)
    blk = add_block(api, obj["id"], "csrf guard text")
    theme = api.ok("GET", "/api/settings", 200)["theme"]
    name = f"Csrf {tok()}"
    cases = [
        ("PUT", "/api/settings", {"theme": "lamplight" if theme == "paper" else "paper"}),
        ("POST", "/api/collections", {"name": name}),
        ("POST", f"/api/objects/{obj['id']}/blocks", {"body": "x", "after_block_id": None}),
        ("PATCH", f"/api/blocks/{blk['id']}", {"body": "<p>changed</p>", "base_version": 1}),
        ("DELETE", f"/api/objects/{obj['id']}", None),
        ("POST", "/api/auth/sign-out", None),
        ("POST", "/api/account/password", {"current_password": "wrong-probe", "new_password": "z" * 20}),
    ]
    for method, path, body in cases:
        for header in ({}, {"X-CSRF-Token": "wrong-token-probe"}):
            kw = {"json": body} if body is not None else {}
            r = api.call(method, path, csrf=False, headers=header, **kw)
            assert r.status_code == 403 and r.json() == {"error": "csrf_failed"}, (method, path, r.text)
    anon = httpx.post(app_url + "/api/collections", json={"name": name}, timeout=HTTP_TIMEOUT)
    assert anon.status_code == 401 and anon.json() == {"error": "unauthenticated"}
    assert api.ok("GET", "/api/settings", 200)["theme"] == theme
    assert name not in [c["name"] for c in api.ok("GET", "/api/collections", 200)["collections"]]
    after = get_obj(api, obj["id"])
    assert after["blocks"][0]["version"] == 1 and len(after["blocks"]) == 1
    assert api.get("/api/session").status_code == 200


def test_wf_sign_in_return_to_page(browser, app_url):
    api = owner(app_url)
    flor = find_seed(api, "Florilegium")
    with open_app(browser, f"{app_url}/o/{flor['id']}") as page:
        expect(page).to_have_url(re.compile(r"/sign-in\?"), timeout=UI_TIMEOUT_MS)
        assert path_of(page) == "/sign-in" and query_of(page)["return"] == [f"/o/{flor['id']}"]
        expect(page.get_by_role("heading", name="Sign in to Quire")).to_be_visible()
        expect(page.get_by_role("heading", name="Florilegium")).to_have_count(0)
        ui_sign_in(page)
        within(page, lambda: expect(page.get_by_role("heading", level=1, name="Florilegium")).to_be_visible(timeout=200))
        assert path_of(page) == f"/o/{flor['id']}"
        page.reload()
        expect(page.get_by_role("heading", level=1, name="Florilegium")).to_be_visible(timeout=UI_TIMEOUT_MS)
        for path in ("/", "/sign-in?return=%2Fgraph"):
            page.goto(app_url + path)
            expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_TIMEOUT_MS)
    ty = type_named(api, "Source")
    with open_app(browser, f"{app_url}/graph?type={ty['id']}") as page:
        expect(page).to_have_url(re.compile(r"/sign-in\?"), timeout=UI_TIMEOUT_MS)
        assert query_of(page)["return"] == [f"/graph?type={ty['id']}"]
        ui_sign_in(page)
        expect(page).to_have_url(re.compile(r"/graph\?"), timeout=UI_TIMEOUT_MS)
        assert query_of(page)["type"] == [ty["id"]]
    with open_app(browser, app_url + "/") as page:
        expect(page).to_have_url(re.compile(r"/sign-in"), timeout=UI_TIMEOUT_MS)


UNSAFE_RETURNS = ["//evil.example/x", "/\\evil.example", "https://evil.example/", "javascript:alert(1)", "/api/session",
                  "/api", "/s/abc", "/s", "/sign-in", "/o/a\\b", "/" + "a" * RETURN_CAP]


def test_wf_sign_in_unsafe_return(browser, app_url):
    for ret in UNSAFE_RETURNS:
        with open_app(browser, f"{app_url}/sign-in?return={url_quote(ret, safe='')}") as page:
            expect(page.get_by_role("heading", name="Sign in to Quire")).to_be_visible(timeout=UI_TIMEOUT_MS)
            ui_sign_in(page)
            expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_TIMEOUT_MS)
            assert urlparse(page.url).netloc == urlparse(app_url).netloc, ret


def test_device_session_revoke_api(app_url):
    a = owner(app_url)
    b = owner(app_url, FIREFOX_ANDROID_UA)
    a_id, b_id = a.session_id, b.session_id
    sessions = a.ok("GET", "/api/sessions", 200)["sessions"]
    ids = [s["id"] for s in sessions]
    assert a_id in ids and b_id in ids
    assert a.cookie not in ids and b.cookie not in ids
    assert [s for s in sessions if s["current"]] == [s for s in sessions if s["id"] == a_id]
    created = [s["created_at"] for s in sessions]
    assert created == sorted(created, reverse=True)
    assert a.delete(f"/api/sessions/{b_id}").status_code == 204
    r = b.get("/api/session")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    assert b_id not in [s["id"] for s in a.ok("GET", "/api/sessions", 200)["sessions"]]
    again = a.delete(f"/api/sessions/{b_id}")
    assert again.status_code == 404 and again.json() == {"error": "not_found"}
    assert a.delete(f"/api/sessions/{uuid.uuid4()}").status_code == 404
    c = owner(app_url, SAFARI_MAC_UA)
    c_stream = Events(c)
    try:
        assert a.delete(f"/api/sessions/{c.session_id}").status_code == 204
        ended = c_stream.wait(lambda e: e["event"] == "session.ended")
        assert ended["id"] is None and c_stream.closed.wait(LIVE_S)
    finally:
        c_stream.close()
    assert c.get("/api/session").status_code == 401
    own = a.delete(f"/api/sessions/{a_id}")
    assert own.status_code == 409 and own.json() == {"error": "current_session"}
    assert a.get("/api/session").status_code == 200


def prune_sessions(api: Api, keep: set[str]) -> None:
    for s in api.ok("GET", "/api/sessions", 200)["sessions"]:
        if s["id"] not in keep and not s["current"]:
            api.delete(f"/api/sessions/{s['id']}")


def session_button_name(api: Api, sid: str) -> tuple[str, str]:
    zone = home_zone(api)
    s = next(x for x in api.ok("GET", "/api/sessions", 200)["sessions"] if x["id"] == sid)
    when = short_time(utc(s["created_at"]).astimezone(ZoneInfo(zone)))
    return s["label"], f"Sign out {s['label']}, signed in {when}"


def test_wf_device_sessions_keyboard_signout(browser, app_url):
    target = owner(app_url, FIREFOX_ANDROID_UA)
    with workspace(browser, app_url, "/today") as (page, me):
        prune_sessions(me, {me.session_id, target.session_id})
        label, name = session_button_name(me, target.session_id)
        page.goto(app_url + "/settings")
        expect(page.get_by_role("list", name="Device sessions")).to_contain_text(label, timeout=UI_TIMEOUT_MS)
        button = page.get_by_role("button", name=name, exact=True)
        expect(button).to_have_count(1)
        for _ in range(120):
            tab_order(page, 1)
            if is_focused(button):
                break
        assert is_focused(button), "Tab never reached the device's sign-out button"
        page.keyboard.press("Enter")
        dialog = page.get_by_role("alertdialog", name="Sign out this device?")
        expect(dialog).to_be_visible()
        confirm = dialog.get_by_role("button", name="Sign out device", exact=True)
        for _ in range(10):
            if is_focused(confirm):
                break
            tab_order(page, 1)
        assert is_focused(confirm)
        page.keyboard.press("Enter")
        within(page, lambda: expect(button).to_have_count(0, timeout=200))
        expect(announcements(page)).to_contain_text(f"Signed out {label}.")
    assert target.get("/api/session").status_code == 401


def test_wf_device_sessions_live_list(browser, app_url):
    orchestrator = owner(app_url, SAFARI_MAC_UA)
    with workspace(browser, app_url, "/today") as (page, me):
        prune_sessions(orchestrator, {me.session_id, orchestrator.session_id})
        page.goto(app_url + "/settings")
        expect(page.get_by_role("heading", name="Device sessions")).to_be_visible(timeout=UI_TIMEOUT_MS)
        mark_no_reload(page)
        phone = owner(app_url, FIREFOX_ANDROID_UA)
        phone_sid = phone.session_id
        _, phone_name = session_button_name(orchestrator, phone_sid)
        phone_button = page.get_by_role("button", name=phone_name, exact=True)
        within(page, lambda: expect(phone_button).to_have_count(1, timeout=100), seconds=LIVE_S)
        phone_button.click()
        dialog = page.get_by_role("alertdialog", name="Sign out this device?")
        expect(dialog).to_be_visible()
        focused_before = focused_name(page)
        third = owner(app_url, DEFAULT_UA)
        third_sid = third.session_id
        _, third_name = session_button_name(orchestrator, third_sid)
        within(page, lambda: expect(page.get_by_role("button", name=third_name, exact=True, include_hidden=True)).to_have_count(1, timeout=100), seconds=LIVE_S)
        expect(dialog).to_be_visible()
        assert focused_name(page) == focused_before
        assert orchestrator.delete(f"/api/sessions/{phone_sid}").status_code == 204
        advance(page, LIVE_MS)
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name="Sign out device", exact=True))
        expect(alert_with(page, COPY_ALREADY_OUT)).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("alertdialog", name="Sign out this device?")).to_have_count(0)
        assert orchestrator.delete(f"/api/sessions/{third_sid}").status_code == 204
        within(page, lambda: expect(page.get_by_role("button", name=third_name, exact=True)).to_have_count(0, timeout=100), seconds=LIVE_S)
        assert_no_reload(page)
    live = [s["id"] for s in orchestrator.ok("GET", "/api/sessions", 200)["sessions"]]
    assert phone_sid not in live and third_sid not in live


def restore_password(base: str, candidates: list[str]) -> None:
    for pw in candidates:
        c = Api(base)
        r = c.c.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": pw})
        if r.status_code == 200:
            c.csrf = r.json()["csrf_token"]
            if pw != OWNER_PASSWORD:
                c.ok("POST", "/api/account/password", 200, json={"current_password": pw, "new_password": OWNER_PASSWORD})
            return


def test_wf_device_sessions_password_change(browser):
    base = short_url()
    new_ui = "Marginalia-x"
    new_max = "M" * 200
    try:
        other = owner(base, FIREFOX_ANDROID_UA)
        r = other.post("/api/account/password", json={"current_password": "not-it-probe", "new_password": "y" * 20})
        assert r.status_code == 422 and r.json()["errors"]["current_password"] == "That isn't your current password."
        r = other.post("/api/account/password", json={"current_password": OWNER_PASSWORD, "new_password": "y" * 11})
        assert r.json()["errors"]["new_password"] == "Use at least 12 characters."
        r = other.post("/api/account/password", json={"current_password": OWNER_PASSWORD, "new_password": "y" * 201})
        assert r.json()["errors"]["new_password"] == "Use at most 200 characters."
        stream = Events(other)
        with workspace(browser, base, "/today", size=(375, 812)) as (phone, _):
            expect(phone.get_by_role("main")).to_be_visible(timeout=UI_TIMEOUT_MS)
            with workspace(browser, base, "/settings") as (laptop, laptop_api):
                old_cookie = laptop_api.cookie
                fill(laptop.get_by_label("Current password", exact=True), OWNER_PASSWORD)
                fill(laptop.get_by_label("New password", exact=True), new_ui)
                click(laptop.get_by_role("button", name="Change password", exact=True))
                expect(announcements(laptop)).to_contain_text(COPY_PASSWORD_CHANGED, timeout=UI_TIMEOUT_MS)
                ev = stream.wait(lambda e: e["event"] == "session.ended")
                assert ev["id"] is None
                assert stream.closed.wait(LIVE_S)
                assert other.get("/api/session").status_code == 401
                stale = httpx.get(base + "/api/session", cookies={"quire_session": old_cookie}, timeout=HTTP_TIMEOUT)
                assert stale.status_code == 401
                within(phone, lambda: expect(phone).to_have_url(re.compile(r"/sign-in\?"), timeout=100), seconds=LIVE_S + EDGE_SLACK_S)
                assert query_of(phone)["return"] == ["/today"]
                expect(alert_with(phone, COPY_SIGNED_OUT)).to_be_visible()
                laptop.reload()
                expect(laptop.get_by_role("heading", name="Device sessions")).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert Api(base).c.post("/api/auth/sign-in", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}).status_code == 401
        fresh = Api(base, DEFAULT_UA).sign_in(new_ui)
        r = fresh.post("/api/account/password", json={"current_password": new_ui, "new_password": new_max})
        assert r.status_code == 200 and r.json()["csrf_token"]
    finally:
        restore_password(base, [OWNER_PASSWORD, new_ui, new_max])


def test_idle_session_end():
    base = short_url()
    restore_password(base, [OWNER_PASSWORD])
    idle, busy = owner(base), owner(base)
    assert idle.get("/api/session").status_code == 200
    start = time.monotonic()

    def keep_busy() -> bool:
        assert busy.get("/api/session").status_code == 200
        return time.monotonic() - start > SHORT_IDLE_S + 2

    assert poll(keep_busy, SHORT_IDLE_S + EDGE_SLACK_S, interval=2.0)
    r = idle.get("/api/session")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    assert busy.get("/api/session").status_code == 200


def test_wf_object_types_new_type_ui(browser, app_url):
    api = owner(app_url)
    name = f"Archive{tok()}"
    with workspace(browser, app_url, "/today") as (page, _):
        click(page.get_by_role("navigation", name="Library").get_by_role("button", name="New type", exact=True))
        dlg = page.get_by_role("dialog", name="New type")
        fill(dlg.get_by_role("textbox", name="Type name", exact=True), name)
        click(dlg.get_by_role("button", name="Add field", exact=True))
        fill(dlg.get_by_role("textbox", name="Field name", exact=True).nth(0), "Opened")
        select(dlg.get_by_role("combobox", name="Field kind", exact=True).nth(0), "Date")
        click(dlg.get_by_role("button", name="Add field", exact=True))
        fill(dlg.get_by_role("textbox", name="Field name", exact=True).nth(1), "Access")
        select(dlg.get_by_role("combobox", name="Field kind", exact=True).nth(1), "Select")
        fill(dlg.get_by_role("textbox", name="Options", exact=True), "Open\nBy appointment")
        click(dlg.get_by_role("button", name="Create type", exact=True))
        within(page, lambda: expect(page.get_by_role("navigation", name="Library").get_by_role("link", name=name, exact=True)).to_be_visible(timeout=200))
        ty = type_named(api, name)
        kinds = {f["name"]: f for f in ty["fields"]}
        assert kinds["Opened"]["kind"] == "date"
        assert kinds["Access"]["kind"] == "select" and kinds["Access"]["options"] == ["Open", "By appointment"]
        click(page.get_by_role("navigation", name="Library").get_by_role("link", name=name, exact=True))
        expect(page).to_have_url(re.compile(f"/types/{ty['id']}$"), timeout=UI_TIMEOUT_MS)
        title = f"Fenwick Reading Room {tok()}"
        click(page.get_by_role("button", name=f"New {name}", exact=True))
        create = page.get_by_role("dialog", name=f"New {name}")
        fill(create.get_by_role("textbox", name="Title", exact=True), title)
        click(create.get_by_role("button", name="Create", exact=True))
        obj = poll(lambda: next((o for o in api.ok("GET", f"/api/objects?type_id={ty['id']}", 200)["objects"] if o["title"] == title), None), LIVE_S + 3)
        assert obj
        page.goto(f"{app_url}/o/{obj['id']}")
        props = page.get_by_role("region", name="Properties")
        opened = props.get_by_role("textbox", name="Opened", exact=True)
        fill(opened, "2026-02-30")
        opened.press("Enter")
        within(page, lambda: expect(opened).to_have_accessible_description("Use a real date as YYYY-MM-DD.", timeout=200))
        fill(opened, "2027-01-05")
        opened.press("Enter")
        select(props.get_by_role("combobox", name="Access", exact=True), "By appointment")
        within(page, lambda: expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=200))
    assert poll(lambda: get_obj(api, obj["id"])["properties"] == {"Opened": "2027-01-05", "Access": "By appointment"}, LIVE_S + 3)


def test_property_validation(app_url):
    api = owner(app_url)
    person = type_named(api, "Person")
    ty = new_type(api, [field("Note", "text"), field("Count", "number"), field("Due", "date"), field("Web", "url"),
                        field("Stage", "select", options=["Draft", "Final"]), field("Ref", "relation", target=person["id"]),
                        field("Req", "text", required=True)])
    ty = add_field(api, ty["id"], field("Self", "relation", target=ty["id"]))
    r = api.post("/api/objects", json={"type_id": ty["id"], "title": "Missing req", "properties": {}})
    assert r.status_code == 422 and r.json()["errors"]["properties.Req"] == "This field is required."
    obj = new_obj(api, ty["id"], props={"Req": "here", "Note": "x" * TEXT_LIMIT})
    before = get_obj(api, obj["id"])["properties"]
    a_concept = concept(api)
    cases = [
        ("Note", "x" * (TEXT_LIMIT + 1), "Use at most 2,000 characters."),
        ("Count", "12", "Enter a number."),
        ("Due", "2026-02-30", "Use a real date as YYYY-MM-DD."),
        ("Due", "2026-2-3", "Use a real date as YYYY-MM-DD."),
        ("Web", "ftp://files.example", "Use a web address starting with http or https."),
        ("Stage", "Zine", "Choose one of the options."),
        ("Ref", a_concept["id"], "Choose a note of type Person."),
        ("Ref", str(uuid.uuid4()), "Choose a note of type Person."),
        ("Self", obj["id"], "A note can't link to itself."),
        ("Req", None, "This field is required."),
        ("Nope", "x", "That field is not on this type."),
    ]
    for name, value, message in cases:
        r = api.patch(f"/api/objects/{obj['id']}", json={"properties": {name: value}})
        assert r.status_code == 422, (name, r.text)
        body = r.json()
        assert body["error"] == "validation" and body["errors"][f"properties.{name}"] == message
    assert get_obj(api, obj["id"])["properties"] == before
    type_cases = [
        ({"name": "", "fields": []}, "name", "Give the type a name."),
        ({"name": "sOuRcE", "fields": []}, "name", "A type with this name already exists."),
        ({"name": f"T{tok()}", "fields": [field("", "text")]}, "fields.0.name", "Give the field a name."),
        ({"name": f"T{tok()}", "fields": [field("Aa", "text"), field("aA", "text")]}, "fields.1.name", "Field names must be different."),
        ({"name": f"T{tok()}", "fields": [field("A", "colour")]}, "fields.0.kind", "Choose text, number, date, url, select or relation."),
        ({"name": f"T{tok()}", "fields": [field("A", "select", options=[])]}, "fields.0.options", "Add at least one option."),
        ({"name": f"T{tok()}", "fields": [field("A", "relation")]}, "fields.0.target_type_id", "Choose the type this field links to."),
    ]
    for body, key, message in type_cases:
        r = api.post("/api/types", json=body)
        assert r.status_code == 422 and r.json()["errors"][key] == message, (key, r.text)
    r = api.post(f"/api/types/{ty['id']}/fields", json=field("note", "text"))
    assert r.status_code == 422 and r.json()["errors"]["name"] == "Field names must be different."
    daily = type_named(api, "Daily note")
    r = api.post(f"/api/types/{daily['id']}/fields", json=field("Mood", "text"))
    assert r.status_code == 409 and r.json() == {"error": "builtin_type"}
    assert api.delete(f"/api/types/{type_named(api, 'Source')['id']}").json() == {"error": "builtin_type"}
    r = api.delete(f"/api/types/{ty['id']}")
    assert r.status_code == 409 and r.json() == {"error": "type_in_use"}
    r = api.post("/api/objects", json={"type_id": ty["id"], "title": "", "properties": {"Req": "x"}})
    assert r.json()["errors"]["title"] == "Give the note a title."
    r = api.post("/api/objects", json={"type_id": daily["id"], "title": "x", "properties": {}})
    assert r.json()["errors"]["type_id"] == "Daily notes are created from Today."
    r = api.patch(f"/api/objects/{obj['id']}", json={"share_visibility": "sometimes"})
    assert r.json()["errors"]["share_visibility"] == "Choose follow or never."


def test_relation_backlinks(app_url):
    api = owner(app_url)
    person = new_obj(api, type_named(api, "Person")["id"], f"Person {tok()}")
    source = new_obj(api, type_named(api, "Source")["id"], f"Source {tok()}", {"Author": person["id"]})
    assert backlinks(api, person["id"]) == 1
    bl = api.ok("GET", f"/api/objects/{person['id']}/backlinks", 200)
    assert bl["count"] == 1
    assert bl["backlinks"][0]["from_object_id"] == source["id"] and bl["backlinks"][0]["kind"] == "relation"
    assert bl["backlinks"][0]["field_name"] == "Author"
    graph = api.ok("GET", "/api/graph", 200)
    assert any(e["from"] == source["id"] and e["to"] == person["id"] and e["kind"] == "relation" for e in graph["edges"])
    assert next(n for n in graph["nodes"] if n["id"] == person["id"])["backlinks"] == 1
    api.ok("PATCH", f"/api/objects/{source['id']}", 200, json={"properties": {"Author": None}})
    assert backlinks(api, person["id"]) == 0
    graph = api.ok("GET", "/api/graph", 200)
    assert not any(e["from"] == source["id"] and e["to"] == person["id"] for e in graph["edges"])


def card_angle(card) -> float:
    m = card.evaluate("c => { const e = c.querySelector('[data-card-inner]'); const t = getComputedStyle(e).transform; return t === 'none' ? null : t; }")
    if not m:
        return 0.0
    nums = [float(x) for x in re.findall(r"-?[\d.]+(?:e-?\d+)?", m.split("(", 1)[1])]
    return math.degrees(math.acos(max(-1.0, min(1.0, nums[0]))))


def test_wf_object_types_card_flip(browser, app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Shelf", "text"), field("Copies", "number")])
    title = f"Card {tok()}"
    obj = new_obj(api, ty["id"], title, {"Shelf": SHELF_VALUE, "Copies": 3})
    with workspace(browser, app_url, f"/types/{ty['id']}") as (page, _):
        card = page.get_by_role("article", name=title)
        show = card.get_by_role("button", name=f"Show properties of {title}", exact=True)
        expect(show).to_be_visible(timeout=UI_TIMEOUT_MS)
        record(page)
        show.focus()
        page.keyboard.press("Enter")
        back = page.get_by_role("button", name=f"Show front of {title}", exact=True)
        expect(back).to_be_focused()
        expect(card.get_by_role("link", name=title, exact=True)).to_have_count(0)
        expect(card.get_by_role("heading", name=title)).to_be_visible()
        advance(page, CARD_TURN_MS + 300)
        recs = recorded(page)
        turns = [r for r in recs if "data-card-inner" in r["target"] and near(r["duration"], CARD_TURN_MS)]
        assert turns, recs
        rows = [r for r in recs if r["target"].get("data-card-face") == "back" and near(r["duration"], ROW_MS)]
        assert len(rows) >= 2, recs
        t_real, t_page = starts(turns[0])
        offsets = sorted(max(starts(r)[0] - t_real, starts(r)[1] - t_page) for r in rows)
        for k, off in enumerate(offsets[:2]):
            assert abs(off - (ROW_FIRST_MS + ROW_STEP_MS * k)) <= ORDER_SLACK_MS + 10, offsets
        names = tab_order(page, 2)
        assert title not in names and f"Show properties of {title}" not in names
        back.focus()
        page.keyboard.press("Enter")
        advance(page, CARD_TURN_MS + 300)
        expect(show).to_be_focused()
        slow_animations(page, 0.05)
        inner = card
        page.keyboard.press("Enter")
        assert poll(lambda: HALF_TURN_DEG / 6 < card_angle(inner) < HALF_TURN_DEG * 5 / 6, UI_WAIT_S * 2, interval=0.05)
        before = card_angle(inner)
        page.keyboard.press("Enter")
        after = card_angle(inner)
        assert abs(after - before) < HALF_TURN_DEG / 9, (before, after)
        assert poll(lambda: card_angle(inner) < 1, 60, interval=0.2)
        expect(show).to_be_focused()
    with workspace(browser, app_url, f"/types/{ty['id']}", reduced_motion="reduce") as (page, _):
        card = page.get_by_role("article", name=title)
        show = card.get_by_role("button", name=f"Show properties of {title}", exact=True)
        expect(show).to_be_visible(timeout=UI_TIMEOUT_MS)
        record(page)
        show.focus()
        page.keyboard.press("Enter")
        advance(page, 16)
        assert card_angle(card) > HALF_TURN_DEG - 1
        recs = recorded(page)
        assert any(near(r["duration"], FADE_MS) for r in recs), recs
        assert not any(near(r["duration"], CARD_TURN_MS) for r in recs)
    assert get_obj(api, obj["id"])["properties"]["Shelf"] == SHELF_VALUE


def test_wf_object_types_card_layout(browser, app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Shelf", "text")])
    titles = [f"Lay {i} {tok()}" for i in range(3)]
    for t in titles:
        new_obj(api, ty["id"], t)
    assert len(api.ok("GET", f"/api/objects?type_id={ty['id']}", 200)["objects"]) == 3
    with workspace(browser, app_url, f"/types/{ty['id']}") as (page, _):
        for size, expected in (((1280, 800), "narrow"), ((768, 1024), None), ((375, 812), "wide")):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            advance(page, 100)
            for t in titles:
                card = page.get_by_role("article", name=t)
                expect(card).to_be_visible(timeout=UI_TIMEOUT_MS)
                width = card.evaluate("e => { const s = getComputedStyle(e); return e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); }")
                head = card.get_by_role("link", name=t, exact=True).bounding_box()
                num = card.evaluate("c => { const r = c.querySelector('[data-backlink-count]').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }")
                same_line = num["y"] < head["y"] + head["height"] - 1 and head["y"] < num["y"] + num["height"] - 1
                layout_now = "wide" if same_line else "narrow"
                assert layout_now == ("wide" if width >= 320 else "narrow"), (size, t, width)
                if expected:
                    assert layout_now == expected, (size, width)
                if same_line:
                    assert num["x"] > head["x"]


def test_block_ops_merge(app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    b = add_block(api, oid, MERGE_TEXT)
    bid = b["id"]
    assert b["version"] == 1 and b["body"] == p_body(MERGE_TEXT)
    ins_a, ins_z, ins_x, ins_y = "A ", " Z", "X", "Y"
    r = patch_ops(api, bid, [{"insert": ins_a}, {"retain": len(MERGE_TEXT)}], 1)
    assert r.status_code == 200 and r.json()["version"] == 2
    s3 = ins_a + MERGE_TEXT + ins_z
    r = patch_ops(api, bid, [{"retain": len(MERGE_TEXT)}, {"insert": ins_z}], 1)
    assert r.status_code == 200 and r.json()["version"] == 3 and r.json()["body"] == p_body(s3)
    r = patch_ops(api, bid, [{"insert": ins_x}, {"retain": len(s3)}], 3)
    assert r.status_code == 200
    s5 = ins_x + ins_y + s3
    r = patch_ops(api, bid, [{"insert": ins_y}, {"retain": len(s3)}], 3)
    assert r.json()["body"] == p_body(s5) and r.json()["version"] == 5
    s6 = s5[:4] + s5[9:]
    r = patch_ops(api, bid, [{"retain": 4}, {"delete": 5}, {"retain": len(s5) - 9}], 5)
    assert r.status_code == 200 and r.json()["body"] == p_body(s6)
    overlapping = ([{"retain": 6}, {"delete": 5}, {"retain": len(s5) - 6 - 5}],
                   [{"retain": 6}, {"insert": ins_x}, {"retain": len(s5) - 6}])
    for ops in overlapping:
        r = patch_ops(api, bid, ops, 5)
        assert r.status_code == 409 and r.json()["error"] == "version_conflict"
        assert r.json()["current"]["version"] == 6 and r.json()["current"]["body"] == p_body(s6)
    s7 = s6[4:]
    r = patch_ops(api, bid, [{"delete": 4}, {"retain": len(s5) - 4}], 5)
    assert r.status_code == 200 and r.json()["body"] == p_body(s7) and r.json()["version"] == 7
    replaced = "replaced"
    r = api.patch(f"/api/blocks/{bid}", json={"body": replaced, "base_version": 7})
    v8 = r.json()["version"]
    assert r.status_code == 200 and v8 == 8
    r = patch_ops(api, bid, [{"retain": len(s7)}, {"insert": ins_z}], 7)
    assert r.status_code == 409 and r.json()["error"] == "version_conflict"
    r = api.patch(f"/api/blocks/{bid}", json={"body": s7, "base_version": 7})
    assert r.status_code == 409 and r.json()["current"]["body"] == p_body(replaced)
    for ops in ([{"retain": 3}], [], [{"retain": 0}, {"retain": len(replaced)}], [{"insert": ""}, {"retain": len(replaced)}]):
        r = patch_ops(api, bid, ops, v8)
        assert r.status_code == 422 and r.json()["errors"]["ops"] == f"Those changes don't fit version {v8}."
    r = patch_ops(api, bid, [{"retain": len(replaced)}], v8, edit_id="")
    assert r.json()["errors"]["edit_id"] == "Use 1 to 64 visible characters."
    r = api.patch(f"/api/blocks/{bid}", json={"ops": [{"retain": len(replaced)}]})
    assert r.json()["errors"]["base_version"] == "Send the version you started from."
    inserts = [f"[{i}]" for i in range(6)]
    barrier = threading.Barrier(len(inserts))

    def send(text: str) -> httpx.Response:
        barrier.wait()
        return patch_ops(api, bid, [{"retain": len(replaced)}, {"insert": text}], v8)

    with ThreadPoolExecutor(len(inserts)) as pool:
        results = list(pool.map(send, inserts))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    by_version = sorted(zip((r.json()["version"] for r in results), inserts))
    assert [v for v, _ in by_version] == list(range(v8 + 1, v8 + 1 + len(inserts)))
    final = get_obj(api, oid)["blocks"][0]
    assert final["body"] == p_body(replaced + "".join(t for _, t in by_version))
    big = add_block(api, oid, "x" * (BLOCK_LIMIT - 7))
    assert len(big["body"]) == BLOCK_LIMIT
    r = patch_ops(api, big["id"], [{"retain": BLOCK_LIMIT - 7}, {"insert": "y"}], 1)
    assert r.status_code == 422 and r.json()["errors"]["body"] == "A block can hold at most 20,000 characters."
    r = api.post(f"/api/objects/{oid}/blocks", json={"body": "x" * (BLOCK_LIMIT - 6), "after_block_id": None})
    assert r.status_code == 422 and r.json()["errors"]["body"] == "A block can hold at most 20,000 characters."


def place_caret(page: Page, n: int, offset: int) -> None:
    box = block_box(page, n)
    box.click()
    page.keyboard.press("Control+Home")
    for _ in range(offset):
        page.keyboard.press("ArrowRight")


def test_wf_block_editing_conflict(browser, app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    b1 = add_block(api, oid, CONFLICT_A)
    b2 = add_block(api, oid, CONFLICT_B, after=b1["id"])
    with workspace(browser, app_url, f"/o/{oid}") as (page, _):
        expect(block_box(page, 1)).to_have_text(CONFLICT_A, timeout=UI_TIMEOUT_MS)
        for n, blk, offset, remote, draft, theirs in (
            (1, b1, 10, [{"retain": 6}, {"delete": 10}, {"retain": 6}], "alpha betaX gamma delta", "alpha  delta"),
            (2, b2, 7, [{"retain": 4}, {"delete": 9}, {"retain": 5}], "one twoX three four", "one  four"),
        ):
            place_caret(page, n, offset)
            page.keyboard.type("X")
            with held(page, "**/api/blocks/*") as hold:
                advance(page, SAVE_ADVANCE_MS)
                assert patch_ops(api, blk["id"], remote, 1).status_code == 200
                advance(page, LIVE_MS)
                assert block_box(page, n).evaluate(TEXT_JS) == draft
                hold.release()
            region = page.get_by_role("region", name="Edit conflict")
            within(page, lambda: expect(region).to_be_visible(timeout=200))
            expect(region).to_contain_text(COPY_CONFLICT)
            expect(region).to_contain_text(theirs)
            assert block_box(page, n).evaluate(TEXT_JS) == draft
            if n == 1:
                click(region.get_by_role("button", name="Keep mine", exact=True))
                expect(region).to_have_count(0)
                expect(block_box(page, 1)).to_be_focused()
                assert poll(lambda: get_obj(api, oid)["blocks"][0]["body"] == p_body(draft), LIVE_S + 3)
            else:
                click(region.get_by_role("button", name="Keep theirs", exact=True))
                expect(region).to_have_count(0)
                assert block_box(page, 2).evaluate(TEXT_JS) == theirs
                expect(block_box(page, 2)).to_be_focused()
    assert get_obj(api, oid)["blocks"][1]["body"] == p_body(theirs)


DIRTY_HTML = (f'<b onclick="window.__xss=1">{BOLD_TEXT}</b> &amp; <i>{IT_TEXT}</i><script>window.__xss=1</script>'
              f'<img src="x" onerror="window.__xss=1"><a href="javascript:window.__xss=1">{LINK_BAD}</a> '
              f'<a href="{SAFE_HREF.replace("&", "&amp;")}" target="_blank" onclick="x">{LINK_OK}</a> '
              f'<a href="{MAIL_HREF}">{LINK_MAIL}</a><span style="color:red">{KEPT_TEXT}</span>'
              '<iframe src="https://ex.test">gone</iframe><style>p{color:red}</style>')
CLEAN_HTML = el("p", el("strong", BOLD_TEXT) + " &amp; " + el("em", IT_TEXT) + LINK_BAD + " " + el("a", LINK_OK, SAFE_HREF)
                + " " + el("a", LINK_MAIL, MAIL_HREF) + KEPT_TEXT)

MARKS_JS = r"""
([root, bold, it, kept]) => {
  const r = root || document.body;
  const parent = (w) => { const t = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n;
    while ((n = t.nextNode())) if (n.data === w) return n.parentElement; return null; };
  const b = parent(bold), i = parent(it), k = parent(kept);
  const bad = r.querySelectorAll('iframe,script:not([src]),[onclick],[onerror]').length;
  return [b ? b.tagName.toLowerCase() : null, i ? i.tagName.toLowerCase() : null, !!k && k.tagName !== 'SPAN', bad];
}
"""


def assert_allowlisted_dom(page: Page, scope=None) -> None:
    finder = scope or page
    link = finder.get_by_role("link", name=LINK_OK, exact=True)
    expect(link).to_have_attribute("href", SAFE_HREF, timeout=UI_TIMEOUT_MS)
    rel = (link.get_attribute("rel") or "").split()
    assert {"noopener", "noreferrer", "nofollow"} <= set(rel)
    expect(finder.get_by_role("link", name=LINK_BAD, exact=True)).to_have_count(0)
    expect(finder.get_by_role("link", name=LINK_MAIL, exact=True)).to_have_count(1)
    root = scope.element_handle() if scope else None
    bold, it, kept_ok, bad = page.evaluate(MARKS_JS, [root, BOLD_TEXT, IT_TEXT, KEPT_TEXT])
    assert bold == "strong" and it == "em" and kept_ok and bad == 0, (bold, it, kept_ok, bad)
    assert page.evaluate("() => window.__xss") is None


def test_wf_block_editing_allowlist(browser, app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    created = add_block(api, oid, DIRTY_HTML)
    assert created["body"] == CLEAN_HTML
    other = add_block(api, oid, "plain")
    r = api.patch(f"/api/blocks/{other['id']}", json={"body": DIRTY_HTML, "base_version": 1})
    assert r.status_code == 200 and r.json()["body"] == CLEAN_HTML
    assert "rel=" not in json.dumps(get_obj(api, oid))
    assert add_block(api, oid, "Read slowly & twice")["body"] == "<p>Read slowly &amp; twice</p>"
    with workspace(browser, app_url, f"/o/{oid}") as (page, _):
        assert_allowlisted_dom(page, block_box(page, 1))
    col = new_collection(api, [oid])
    tk = token_of(new_link(api, col["id"]))
    shared = share_client(app_url).get(f"/s/{tk}/api/objects/{oid}").json()
    assert shared["blocks"][0]["body"] == CLEAN_HTML and "rel=" not in json.dumps(shared["blocks"])


def test_wf_block_editing_remote_caret(browser, app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    blk = add_block(api, oid, CARET_TEXT)
    phone = owner(app_url, FIREFOX_ANDROID_UA)
    sid = phone.session_id
    label = next(s["label"] for s in api.ok("GET", "/api/sessions", 200)["sessions"] if s["id"] == sid)
    r = phone.post(f"/api/blocks/{blk['id']}/presence", json={"anchor": 999, "head": 999, "version": 1})
    assert r.status_code == 422 and r.json()["errors"].get("head", r.json()["errors"].get("anchor")) == "Use offsets inside the block."
    with workspace(browser, app_url, f"/o/{oid}") as (page, _):
        box = block_box(page, 1)
        expect(box).to_have_text(CARET_TEXT, timeout=UI_TIMEOUT_MS)
        reported = phone.post(f"/api/blocks/{blk['id']}/presence", json={"anchor": 4, "head": 4, "version": 1})
        assert reported.status_code == 204
        within(page, lambda: remote_caret(page, sid), seconds=LIVE_S)
        assert label in remote_caret(page, sid)["text"]
        assert abs(remote_caret(page, sid)["x"] - box.evaluate(CARET_JS, 4)) <= 2
        moved = patch_ops(api, blk["id"], [{"insert": CARET_PREFIX}, {"retain": len(CARET_TEXT)}], 1)
        assert moved.status_code == 200
        within(page, lambda: expect(box).to_have_text(CARET_PREFIX + CARET_TEXT, timeout=100), seconds=LIVE_S)
        shifted = 4 + len(CARET_PREFIX)
        within(page, lambda: _assert_close(remote_caret(page, sid)["x"], box.evaluate(CARET_JS, shifted), 2), seconds=LIVE_S)
        assert phone.delete(f"/api/blocks/{blk['id']}/presence").status_code == 204
        within(page, lambda: caret_gone(page, sid), seconds=LIVE_S)


def _assert_close(a: float, b: float, tol: float) -> None:
    assert abs(a - b) <= tol, (a, b)


REMOTE_CARET_JS = """s => { const e = document.querySelector(`[data-remote-caret='${s}']`); if (!e) return null;
  const r = e.getBoundingClientRect(); return {x: r.x, height: r.height, text: e.textContent}; }"""


def remote_caret(page: Page, sid: str) -> dict:
    info = page.evaluate(REMOTE_CARET_JS, sid)
    assert info and info["height"] > 0, info
    return info


def caret_gone(page: Page, sid: str) -> None:
    info = page.evaluate(REMOTE_CARET_JS, sid)
    assert info is None or info["height"] == 0, info


def test_revision_history_and_diff(app_url):
    api = owner(app_url, FIREFOX_ANDROID_UA)
    label = next(s["label"] for s in api.ok("GET", "/api/sessions", 200)["sessions"] if s["current"])
    oid = concept(api)["id"]
    blk = add_block(api, oid, "the quick brown fox")
    api.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": "the slow brown dog", "base_version": 1})
    api.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": "the  slow brown dog", "base_version": 2})
    revs = api.ok("GET", f"/api/blocks/{blk['id']}/revisions", 200)["revisions"]
    assert [r["version"] for r in revs] == [3, 2, 1]
    assert revs[2]["body"] == p_body(DIFF_V1) and revs[1]["plain"] == DIFF_V2
    assert all(r["label"] == label and r["created_at"].endswith("Z") for r in revs)
    d = api.ok("GET", f"/api/blocks/{blk['id']}/diff?from=1&to=2", 200)
    assert d["from"] == 1 and d["to"] == 2
    assert d["ops"] == [{"op": "equal", "text": "the "}, {"op": "delete", "text": "quick"}, {"op": "insert", "text": "slow"},
                        {"op": "equal", "text": " brown "}, {"op": "delete", "text": "fox"}, {"op": "insert", "text": "dog"}]
    d = api.ok("GET", f"/api/blocks/{blk['id']}/diff?from=2&to=3", 200)
    assert d["ops"] == [{"op": "equal", "text": "the"}, {"op": "delete", "text": " "}, {"op": "insert", "text": "  "},
                        {"op": "equal", "text": "slow brown dog"}]
    r = api.get(f"/api/blocks/{blk['id']}/diff?from=99&to=3")
    assert r.status_code == 422 and r.json()["errors"]["from"] == "That version is not kept."
    version = 3
    for i in range(REVISIONS_KEPT + 2):
        version = api.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": f"edit {i}", "base_version": version})["version"]
    revs = api.ok("GET", f"/api/blocks/{blk['id']}/revisions", 200)["revisions"]
    assert len(revs) == REVISIONS_KEPT
    assert [r["version"] for r in revs] == list(range(version, version - REVISIONS_KEPT, -1))
    r = patch_ops(api, blk["id"], [{"retain": 4}], 1)
    assert r.status_code == 409 and r.json()["error"] == "version_conflict"


def test_wf_revisions_undo_deleted_note(browser, app_url):
    api = owner(app_url)
    word = tok()
    title = f"Doomed {word}"
    obj = concept(api, title)
    blk = add_block(api, obj["id"], f"doomed passage {word}")
    col = new_collection(api, [obj["id"]])
    api.ok("PUT", f"/api/collections/{col['id']}/board", 200, json={"positions": [{"object_id": obj["id"], "x": 64, "y": 64}]})
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        click(page.get_by_role("button", name="Delete note", exact=True))
        dlg = page.get_by_role("alertdialog", name="Delete this note?")
        expect(dlg).to_contain_text(f"Deleting removes {plural(0, 'quote')} of its blocks from other notes.")
        click(dlg.get_by_role("button", name="Delete", exact=True))
        assert poll(lambda: api.get(f"/api/objects/{obj['id']}").status_code == 404, LIVE_S + 3)
        page.goto(app_url + "/today")
        expect(page.get_by_role("main")).to_be_visible(timeout=UI_TIMEOUT_MS)
        page.keyboard.press("Control+k")
        box = page.get_by_role("combobox", name="Search Quire")
        expect(box).to_be_focused()
        page.keyboard.type(word)
        advance(page, SEARCH_DEBOUNCE_MS + 100)
        shown = len(expected_commands(api.ok("GET", "/api/settings", 200)["theme"], word))
        status_text = f"{plural(shown, 'command')}, {plural(0, 'note')}"
        within(page, lambda: expect(page.get_by_role("status", name="Palette status")).to_have_text(status_text, timeout=200))
        expect(page.get_by_role("option", name=f"{title}, Concept", exact=True)).to_have_count(0)
    for path, params in ((f"/api/blocks/{blk['id']}/revisions", None), (f"/api/blocks/{blk['id']}/diff", {"from": 1, "to": 1})):
        r = api.get(path, params=params)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert api.post(f"/api/blocks/{blk['id']}/restore", json={"version": 1, "base_version": 1}).status_code == 404
    assert api.ok("GET", "/api/blocks/search", 200, params={"q": word})["results"] == []
    assert api.ok("GET", f"/api/search?q={word}", 200)["results"] == []
    assert api.ok("GET", f"/api/collections/{col['id']}/board", 200)["cards"] == []


def test_restore_api(app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    blk = add_block(api, oid, "Café & ‘quoted’ — first draft")
    api.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": "<p>second <em>draft</em></p>", "base_version": 1})
    v1 = api.ok("GET", f"/api/blocks/{blk['id']}/revisions", 200)["revisions"][-1]["body"]
    r = api.post(f"/api/blocks/{blk['id']}/restore", json={"version": 1, "base_version": 2})
    assert r.status_code == 200 and r.json()["version"] == 3 and r.json()["body"] == v1
    assert get_obj(api, oid)["blocks"][0]["body"].encode() == v1.encode()
    r = api.post(f"/api/blocks/{blk['id']}/restore", json={"version": 2, "base_version": 2})
    assert r.status_code == 409 and r.json()["error"] == "version_conflict" and r.json()["current"]["version"] == 3
    r = api.post(f"/api/blocks/{blk['id']}/restore", json={"version": 77, "base_version": 3})
    assert r.status_code == 422 and r.json()["errors"]["version"] == "That version is not kept."
    assert get_obj(api, oid)["blocks"][0]["version"] == 3


def test_wf_revisions_undo_restore(browser, app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    old_text, new_text = f"{RESTORE_STEM} {RESTORE_OLD}", f"{RESTORE_STEM} {RESTORE_NEW}"
    blk = add_block(api, oid, old_text)
    api.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": new_text, "base_version": 1})
    with workspace(browser, app_url, f"/o/{oid}") as (page, _):
        opener = page.get_by_role("button", name=history_name(1), exact=True)
        click(opener)
        dlg = page.get_by_role("dialog", name="Block history")
        expect(dlg.get_by_role("listbox", name="Revisions").get_by_role("option")).to_have_count(2, timeout=UI_TIMEOUT_MS)
        changes = dlg.get_by_role("region", name="Changes")
        within(page, lambda: expect(changes.get_by_role("deletion")).to_have_text(RESTORE_OLD, timeout=200))
        expect(changes.get_by_role("insertion")).to_have_text(RESTORE_NEW)
        click(dlg.get_by_role("button", name="Restore this version", exact=True))
        restored, saved_as = 1, 3
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Restored version {restored}. Saved as version {saved_as}.", timeout=200))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_role("option", name=re.compile("^" + re.escape(f"Version {saved_as}, ")))).to_have_count(1)
        assert get_obj(api, oid)["blocks"][0]["body"] == p_body(old_text)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        block_box(page, 1).click()
        page.keyboard.press("Control+z")
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Undid {STEP_RESTORE}.", timeout=200))
    final = poll(lambda: (b := get_obj(api, oid)["blocks"][0]) and b["version"] == 4 and b, LIVE_S + 3)
    assert final and final["body"] == p_body(new_text)


def test_wf_revisions_undo_typing(browser, app_url):
    api = owner(app_url)
    oid = concept(api)["id"]
    blk = add_block(api, oid, UNDO_BASE)
    longer = UNDO_BASE + UNDO_TAIL

    def has(text: str) -> bool:
        return get_obj(api, oid)["blocks"][0]["body"] == p_body(text)

    with workspace(browser, app_url, f"/o/{oid}") as (page, _):
        box = block_box(page, 1)
        expect(box).to_have_text(UNDO_BASE, timeout=UI_TIMEOUT_MS)
        box.click()
        page.keyboard.press("Control+End")
        page.keyboard.type(UNDO_TAIL)
        advance(page, SAVE_ADVANCE_MS)
        assert poll(lambda: has(longer), LIVE_S + 3)
        advance(page, UNDO_PAUSE_MS + 500)
        page.keyboard.type(UNDO_BANG)
        advance(page, SAVE_ADVANCE_MS)
        assert poll(lambda: has(longer + UNDO_BANG), LIVE_S + 3)
        page.keyboard.press("Control+z")
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Undid {STEP_TYPING}.", timeout=200))
        assert poll(lambda: has(longer), LIVE_S + 3)
        page.keyboard.press("Control+z")
        assert poll(lambda: has(UNDO_BASE), LIVE_S + 3)
        page.keyboard.press("Control+Shift+z")
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Redid {STEP_TYPING}.", timeout=200))
        assert poll(lambda: has(longer), LIVE_S + 3)
        version = get_obj(api, oid)["blocks"][0]["version"]
        remote = patch_ops(api, blk["id"], [{"insert": UNDO_REMOTE}, {"retain": len(longer)}], version)
        assert remote.status_code == 200
        within(page, lambda: expect(box).to_have_text(UNDO_REMOTE + longer, timeout=100), seconds=LIVE_S)
        box.click()
        page.keyboard.press("Control+z")
        assert poll(lambda: has(UNDO_REMOTE + UNDO_BASE), LIVE_S + 3)
        page.keyboard.press("Control+z")
        within(page, lambda: expect(announcements(page)).to_contain_text("Nothing to undo.", timeout=200))
        page.keyboard.press("Control+Shift+z")
        assert poll(lambda: has(UNDO_REMOTE + longer), LIVE_S + 3)
        version = get_obj(api, oid)["blocks"][0]["version"]
        removed = patch_ops(api, blk["id"], [{"retain": len(UNDO_REMOTE + UNDO_BASE)}, {"delete": len(UNDO_TAIL)}], version)
        assert removed.status_code == 200
        within(page, lambda: expect(box).to_have_text(UNDO_REMOTE + UNDO_BASE, timeout=100), seconds=LIVE_S)
        box.click()
        page.keyboard.press("Control+z")
        within(page, lambda: expect(alert_with(page, "Can't undo: that text changed on another device.")).to_be_visible(timeout=200))
    assert has(UNDO_REMOTE + UNDO_BASE)


def test_wf_revisions_undo_quote_edit_history(browser, app_url):
    api = owner(app_url)
    origin = concept(api, f"Origin {tok()}")
    oblk = add_block(api, origin["id"], QUOTED_TEXT)
    host = concept(api)
    add_block(api, host["id"], "host text")
    quote(api, host["id"], oblk["id"])
    with workspace(browser, app_url, f"/o/{host['id']}", size=(375, 812)) as (page, bapi):
        label = next(s["label"] for s in api.ok("GET", "/api/sessions", 200)["sessions"] if s["id"] == bapi.session_id)
        fig = page.get_by_role("figure", name=f"Quote from {origin['title']}")
        qbox = fig.get_by_role("textbox")
        expect(qbox).to_have_text(QUOTED_TEXT, timeout=UI_TIMEOUT_MS)
        qbox.click()
        page.keyboard.press("Control+End")
        page.keyboard.type(QUOTED_TAIL)
        advance(page, SAVE_ADVANCE_MS)
        assert poll(lambda: get_obj(api, origin["id"])["blocks"][0]["body"] == p_body(QUOTED_TEXT + QUOTED_TAIL), LIVE_S + 3)
    revs = api.ok("GET", f"/api/blocks/{oblk['id']}/revisions", 200)["revisions"]
    assert [r["version"] for r in revs] == [2, 1]
    assert revs[0]["label"] == label and revs[0]["plain"] == QUOTED_TEXT + QUOTED_TAIL


def quote_fixture(api: Api) -> dict:
    word = tok()
    origin = new_obj(api, type_named(api, "Source")["id"], f"Gathered {word}")
    oblk = add_block(api, origin["id"], f"Marginal {word} gloss of the reading")
    host = concept(api, f"Host {word}")
    add_block(api, host["id"], HOST_LINE)
    return {"word": word, "origin": origin, "oblk": oblk, "host": host, "option": f"{origin['title']}: Marginal {word} gloss of the reading"}


def open_picker(page: Page, block: int, query_text: str):
    box = block_box(page, block)
    expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
    box.click()
    page.keyboard.press("Control+End")
    page.keyboard.type("((")
    dlg = page.get_by_role("dialog", name="Quote a block")
    expect(dlg).to_be_visible()
    expect(dlg.get_by_role("combobox", name="Search blocks")).to_be_focused()
    page.keyboard.type(query_text)
    advance(page, SEARCH_DEBOUNCE_MS + 50)
    return dlg


def test_wf_quoting_keyboard_quote(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    with workspace(browser, app_url, f"/o/{fx['host']['id']}") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        opt = dlg.get_by_role("option", name=fx["option"], exact=True)
        within(page, lambda: expect(opt).to_be_visible(timeout=200))
        expect(page.get_by_role("status", name="Picker results")).to_have_text(plural(1, "matching block"))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        fig = page.get_by_role("figure", name=f"Quote from {fx['origin']['title']}")
        within(page, lambda: expect(fig).to_be_visible(timeout=200))
        chip = page.get_by_role("link", name=chip_name(fx["origin"]["title"], 1), exact=True)
        expect(chip).to_be_visible()
        within(page, lambda: expect(announcements(page)).to_contain_text(quoted_copy(fx["origin"]["title"], 1), timeout=200))
        expect(fig.get_by_role("textbox")).to_be_focused()
        expect(block_box(page, 1)).to_have_text(HOST_LINE)
        advance(page, SAVE_ADVANCE_MS)
        poll(lambda: get_obj(api, fx["host"]["id"])["blocks"][0]["body"] == p_body(HOST_LINE), UI_WAIT_S)
    blocks = get_obj(api, fx["host"]["id"])["blocks"]
    assert [b["kind"] for b in blocks] == ["text", "quote"]
    assert blocks[1]["origin"]["block_id"] == fx["oblk"]["id"] and blocks[0]["body"] == p_body(HOST_LINE)
    assert backlinks(api, fx["origin"]["id"]) == 1


def test_wf_quoting_announcements(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    other = concept(api)
    quote(api, other["id"], fx["oblk"]["id"])
    title = fx["origin"]["title"]
    with workspace(browser, app_url, f"/o/{fx['host']['id']}") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx["option"], exact=True)).to_be_visible(timeout=200))
        page.keyboard.press("Enter")
        within(page, lambda: expect(announcements(page)).to_contain_text(quoted_copy(title, 2), timeout=200))
        click(page.get_by_role("button", name="Remove quote", exact=True))
        within(page, lambda: expect(announcements(page)).to_contain_text(removed_copy(title, 1), timeout=200))
    assert backlinks(api, fx["origin"]["id"]) == 1


def test_wf_quoting_refused(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    fx2 = quote_fixture(api)
    add_block(api, fx["host"]["id"], "second host line", after=get_obj(api, fx["host"]["id"])["blocks"][0]["id"])
    with workspace(browser, app_url, f"/o/{fx['host']['id']}") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx["option"], exact=True)).to_be_visible(timeout=200))
        with held(page, f"**/api/objects/{fx['host']['id']}/quotes") as hold:
            page.keyboard.press("Enter")
            advance(page, MORPH_MS[1] + 100)
            expect(page.get_by_role("figure", name=f"Quote from {fx['origin']['title']}")).to_have_count(0)
            assert tether_count(page) == 0
            expect(page.get_by_role("link", name=re.compile(r"^Quoted from "))).to_have_count(0)
            assert backlinks(api, fx["origin"]["id"]) == 0
            hold.release()
        within(page, lambda: expect(page.get_by_role("figure", name=f"Quote from {fx['origin']['title']}")).to_be_visible(timeout=200))
        assert page.get_by_role("link", name=chip_name(fx["origin"]["title"], 1), exact=True).evaluate(NUMERAL_JS) == str(1)
        last = page.get_by_role("textbox", name=re.compile(r"^Block \d+$")).count()
        dlg = open_picker(page, last, fx2["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx2["option"], exact=True)).to_be_visible(timeout=200))
        assert api.delete(f"/api/objects/{fx2['origin']['id']}").status_code == 204
        page.keyboard.press("Enter")
        within(page, lambda: expect(alert_with(page, COPY_QUOTE_REFUSED)).to_be_visible(timeout=200))
        expect(page.get_by_role("figure", name=f"Quote from {fx2['origin']['title']}")).to_have_count(0)
        expect(block_box(page, last)).to_contain_text(PICKER_TRIGGER)
        expect(block_box(page, last)).to_be_focused()
        expect(announcements(page)).not_to_contain_text(f"Quoted from {fx2['origin']['title']}")
        assert tether_count(page) == 1
    kinds = [b["kind"] for b in get_obj(api, fx["host"]["id"])["blocks"]]
    assert kinds.count("quote") == 1


def test_wf_quoting_latest_search(browser, app_url):
    api = owner(app_url)
    word = tok()
    origin = concept(api, f"Ember {word}")
    for text in LATEST_TEXTS:
        add_block(api, origin["id"], f"{word} {text}")
    host = concept(api)
    add_block(api, host["id"], "host")
    pending: list = []

    def handler(route):
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0].strip()
        if q == word and not pending:
            pending.append(route)
            return
        route.fallback()

    with workspace(browser, app_url, f"/o/{host['id']}") as (page, _):
        page.route("**/api/blocks/search*", handler)
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.click()
        page.keyboard.press("Control+End")
        page.keyboard.type("((")
        dlg = page.get_by_role("dialog", name="Quote a block")
        search = dlg.get_by_role("combobox", name="Search blocks")
        fill(search, word)
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        assert poll(lambda: bool(pending), 5, interval=0.05)
        page.keyboard.type(LATEST_SUFFIX)
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        options = dlg.get_by_role("listbox", name="Matching blocks").get_by_role("option")
        within(page, lambda: expect(options).to_have_count(2, timeout=200))
        expect(page.get_by_role("status", name="Picker results")).to_have_text(plural(2, "matching block"))
        with page.expect_response(lambda r: "/api/blocks/search" in r.url and parse_qs(urlparse(r.url).query).get("q", [""])[0].strip() == word):
            pending[0].fallback()
        advance(page, 100)
        expect(options).to_have_count(2)
        expect(dlg.get_by_role("option", name=f"{origin['title']}: {word} {LATEST_TEXTS[2]}", exact=True)).to_have_count(0)
        expect(page.get_by_role("status", name="Picker results")).to_have_text(plural(2, "matching block"))
        assert search.input_value() == word + LATEST_SUFFIX


def tether_count(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('[data-tether]').length")


NUMERAL_JS = "c => (c.matches('[data-backlink-count]') ? c : c.querySelector('[data-backlink-count]')).getAttribute('data-backlink-count')"


def tether_offset(page: Page, qid: str) -> float | None:
    return page.evaluate(
        """id => { const el = document.querySelector(`[data-tether="${id}"]`); if (!el) return null;
        const g = el.getTotalLength ? el : el.querySelector('path,line,polyline'); return parseFloat(getComputedStyle(g).strokeDashoffset); }""",
        qid,
    )


def test_quote_motion(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    with workspace(browser, app_url, f"/o/{fx['host']['id']}") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx["option"], exact=True)).to_be_visible(timeout=200))
        record(page)
        page.keyboard.press("Enter")
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Quoted from {fx['origin']['title']}.", timeout=200))
        advance(page, TETHER_TOTAL_MS)
        recs = recorded(page)
        tether = [r for r in recs if "data-tether" in r["target"]]
        numeral = [r for r in recs if "data-backlink-count" in r["target"] and NUMERAL_MS[0] <= r["duration"] <= NUMERAL_MS[1]]
        morph = [r for r in recs if MORPH_MS[0] <= r["duration"] <= MORPH_MS[1] and "data-tether" not in r["target"]]
        assert tether and TETHER_MS[0] <= tether[0]["duration"] <= TETHER_MS[1], recs
        assert numeral and NUMERAL_MS[0] <= numeral[0]["duration"] <= NUMERAL_MS[1], recs
        assert morph, recs
        for clock in (0, 1):
            pass
        ok_order = any(
            starts(morph[0])[c] <= starts(tether[0])[c] + ORDER_SLACK_MS
            and starts(numeral[0])[c] >= starts(tether[0])[c] + tether[0]["duration"] - ORDER_SLACK_MS
            for c in (0, 1)
        )
        assert ok_order, recs
        total = max(starts(numeral[0])[c] + numeral[0]["duration"] - starts(morph[0])[c] for c in (0, 1))
        assert min(starts(numeral[0])[c] + numeral[0]["duration"] - starts(morph[0])[c] for c in (0, 1)) < TETHER_TOTAL_MS + 300, total
        record(page)
        click(page.get_by_role("button", name="Remove quote", exact=True))
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Quote removed. {fx['origin']['title']} has 0 backlinks.", timeout=200))
        advance(page, TETHER_TOTAL_MS)
        recs = recorded(page)
        tether = [r for r in recs if "data-tether" in r["target"]]
        numeral = [r for r in recs if "data-backlink-count" in r["target"]]
        collapse = [r for r in recs if MORPH_MS[0] <= r["duration"] <= MORPH_MS[1] and "data-tether" not in r["target"]]
        assert tether and numeral and collapse, recs
        assert any(starts(numeral[0])[c] <= starts(tether[0])[c] + ORDER_SLACK_MS
                   and starts(collapse[-1])[c] >= starts(tether[0])[c] - ORDER_SLACK_MS for c in (0, 1)), recs
    assert backlinks(api, fx["origin"]["id"]) == 0


def test_quote_reduced_motion(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    with workspace(browser, app_url, f"/o/{fx['host']['id']}", reduced_motion="reduce") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx["option"], exact=True)).to_be_visible(timeout=200))
        record(page)
        page.keyboard.press("Enter")
        fig = page.get_by_role("figure", name=f"Quote from {fx['origin']['title']}")
        within(page, lambda: expect(fig).to_be_visible(timeout=100))
        advance(page, 16)
        qid = get_obj(api, fx["host"]["id"])["blocks"][1]["id"]
        assert abs(tether_offset(page, qid) or 0) < 0.01
        assert page.get_by_role("link", name=chip_name(fx["origin"]["title"], 1), exact=True).evaluate(NUMERAL_JS) == str(1)
        assert not [r for r in recorded(page) if "data-tether" in r["target"] and r["duration"] > 0]
        expect(announcements(page)).to_contain_text(f"Quoted from {fx['origin']['title']}. 1 backlink.")


def test_wf_quoting_interrupted(browser, app_url):
    api = owner(app_url)
    fx = quote_fixture(api)
    with workspace(browser, app_url, f"/o/{fx['host']['id']}") as (page, _):
        dlg = open_picker(page, 1, fx["word"])
        within(page, lambda: expect(dlg.get_by_role("option", name=fx["option"], exact=True)).to_be_visible(timeout=200))
        slow_animations(page, 0.05)
        page.keyboard.press("Enter")
        qid = poll(lambda: next((b["id"] for b in get_obj(api, fx["host"]["id"])["blocks"] if b["kind"] == "quote"), None), 10)

        def mid_draw() -> bool:
            advance(page, 16)
            o = tether_offset(page, qid)
            return o is not None and 0.2 < o < 0.8

        assert poll(mid_draw, 30, interval=0.05)
        start = tether_offset(page, qid)
        page.get_by_role("button", name="Remove quote", exact=True).click()
        samples = []
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            o = tether_offset(page, qid)
            if o is None:
                break
            samples.append(o)
            advance(page, 16)
        assert samples and min(samples) >= start - 0.1, (start, samples[:10])
        assert all(b >= a - 0.01 for a, b in zip(samples, samples[1:])), samples
        within(page, lambda: expect(announcements(page)).to_contain_text(removed_copy(fx["origin"]["title"], 0), timeout=200), seconds=60)
    assert backlinks(api, fx["origin"]["id"]) == 0
    with workspace(browser, app_url, f"/o/{fx['host']['id']}", size=(768, 1024)) as (page, _):
        opener = page.get_by_role("button", name="Open library", exact=True)
        click(opener)
        advance(page, 150)
        page.keyboard.press("Escape")
        advance(page, 60)
        opener.click()
        advance(page, 1000)
        drawer = page.get_by_role("dialog", name="Library")
        expect(drawer).to_be_visible()
        assert abs(drawer.bounding_box()["x"]) <= 1
        advance(page, 2000)
        expect(drawer.get_by_role("navigation", name="Library")).to_be_visible()
        assert abs(drawer.bounding_box()["x"]) <= 1


def test_quote_single_body(app_url):
    api = owner(app_url)
    origin = concept(api)
    oblk = add_block(api, origin["id"], SINGLE_TEXT)
    h1, h2 = concept(api), concept(api)
    q1 = quote(api, h1["id"], oblk["id"])["block"]
    quote(api, h2["id"], oblk["id"])
    r = patch_ops(api, q1["id"], [{"retain": len(SINGLE_TEXT)}, {"insert": SINGLE_TAIL}], 1)
    assert r.status_code == 200 and r.json()["version"] == 2
    for oid in (origin["id"], h1["id"], h2["id"]):
        b = [x for x in get_obj(api, oid)["blocks"] if x["id"] == oblk["id"] or (x["origin"] or {}).get("block_id") == oblk["id"]][0]
        assert b["body"] == p_body(SINGLE_TEXT + SINGLE_TAIL) and b["version"] == 2
    assert api.ok("GET", f"/api/blocks/{q1['id']}/revisions", 200)["revisions"] == api.ok("GET", f"/api/blocks/{oblk['id']}/revisions", 200)["revisions"]
    assert len(api.ok("GET", f"/api/blocks/{oblk['id']}/revisions", 200)["revisions"]) == 2
    patch_ops(api, oblk["id"], [{"insert": SINGLE_HEAD}, {"retain": len(SINGLE_TEXT + SINGLE_TAIL)}], 2)
    hosted = [b for b in get_obj(api, h2["id"])["blocks"] if b["kind"] == "quote"][0]["body"]
    assert hosted == p_body(SINGLE_HEAD + SINGLE_TEXT + SINGLE_TAIL)


def surfaces(api: Api, oid: str, type_id: str, query_id: str) -> set[int]:
    vals = {backlinks(api, oid)}
    bl = api.ok("GET", f"/api/objects/{oid}/backlinks", 200)
    vals |= {bl["count"], len(bl["backlinks"])}
    vals.add(next(n for n in api.ok("GET", "/api/graph", 200)["nodes"] if n["id"] == oid)["backlinks"])
    vals.add(next(o for o in api.ok("GET", f"/api/objects?type_id={type_id}", 200)["objects"] if o["id"] == oid)["backlinks"])
    vals.add(next(r for r in api.ok("GET", f"/api/queries/{query_id}/results", 200)["results"] if r["id"] == oid)["backlinks"])
    return vals


def test_backlink_counts_consistent(app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Note", "text")])
    origin = new_obj(api, ty["id"], f"Counted {tok()}")
    oblk = add_block(api, origin["id"], "counted passage")
    other = new_obj(api, ty["id"], f"Second {tok()}")
    query_id = api.ok("POST", "/api/queries", 201, json={"name": f"Q {tok()}", "type_id": ty["id"], "text": "", "group_by": None,
                                                         "sort": [{"key": "@title", "dir": "asc"}]})["id"]
    hosts = [concept(api) for _ in range(6)]
    barrier = threading.Barrier(len(hosts))

    def go(h: dict) -> httpx.Response:
        barrier.wait()
        return api.post(f"/api/objects/{h['id']}/quotes", json={"origin_block_id": oblk["id"], "after_block_id": None})

    with ThreadPoolExecutor(len(hosts)) as pool:
        results = list(pool.map(go, hosts))
    assert all(r.status_code == 201 for r in results)
    assert sorted(r.json()["origin_backlinks"] for r in results) == list(range(1, 7))
    assert surfaces(api, origin["id"], ty["id"], query_id) == {6}
    r = api.delete(f"/api/blocks/{results[0].json()['block']['id']}")
    assert r.json()["origin_backlinks"] == 5
    assert surfaces(api, origin["id"], ty["id"], query_id) == {5}
    moved = results[1].json()["block"]["id"]
    api.ok("POST", f"/api/blocks/{moved}/move", 200, json={"object_id": hosts[0]["id"], "after_block_id": None})
    assert surfaces(api, origin["id"], ty["id"], query_id) == {5}
    api.ok("POST", f"/api/blocks/{oblk['id']}/move", 200, json={"object_id": other["id"], "after_block_id": None})
    assert surfaces(api, origin["id"], ty["id"], query_id) == {0}
    assert surfaces(api, other["id"], ty["id"], query_id) == {5}
    assert api.delete(f"/api/objects/{hosts[2]['id']}").status_code == 204
    assert surfaces(api, other["id"], ty["id"], query_id) == {4}


def test_unquote_and_delete(browser, app_url):
    api = owner(app_url)
    origin = concept(api, f"Origin {tok()}")
    oblk = add_block(api, origin["id"], "quoted text")
    h1, h2 = concept(api), concept(api)
    q1 = quote(api, h1["id"], oblk["id"])["block"]
    quote(api, h2["id"], oblk["id"])
    r = api.delete(f"/api/blocks/{oblk['id']}")
    assert r.status_code == 409 and r.json() == {"error": "block_quoted", "quoted_in": 2}
    r = api.delete(f"/api/blocks/{q1['id']}")
    assert r.status_code == 200 and r.json() == {"origin_object_id": origin["id"], "origin_backlinks": 1}
    assert not [b for b in get_obj(api, h1["id"])["blocks"] if b["kind"] == "quote"]
    rel = new_type(api, [field("Subject", "relation", required=True, target=type_named(api, "Concept")["id"])])
    holder = new_obj(api, rel["id"], props={"Subject": origin["id"]})
    api.ok("PATCH", f"/api/blocks/{oblk['id']}", 200, json={"body": "", "base_version": 1})
    with workspace(browser, app_url, f"/o/{origin['id']}") as (page, _):
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.click()
        page.keyboard.press("Backspace")
        quoted_alert = f"This block is quoted in {plural(1, 'place')}. Remove those quotes first."
        within(page, lambda: expect(alert_with(page, quoted_alert)).to_be_visible(timeout=200))
        click(page.get_by_role("button", name="Delete note", exact=True))
        expect(page.get_by_role("alertdialog", name="Delete this note?")).to_contain_text(
            f"Deleting removes {plural(1, 'quote')} of its blocks from other notes.")
    assert len(get_obj(api, origin["id"])["blocks"]) == 1
    assert api.delete(f"/api/objects/{origin['id']}").status_code == 204
    assert api.get(f"/api/objects/{origin['id']}").status_code == 404
    assert not [b for b in get_obj(api, h2["id"])["blocks"] if b["kind"] == "quote"]
    assert get_obj(api, holder["id"])["properties"]["Subject"] is None


def zone_date(now: datetime, zone: str) -> date:
    return now.astimezone(ZoneInfo(zone)).date()


def test_wf_daily_notes_home_clock(browser, app_url):
    api = owner(app_url)
    seen = {}
    for zone in (ZONE_AHEAD, ZONE_BEHIND):
        with home_clock(api, zone):
            before = server_now(api)
            r = api.post("/api/daily/today")
            after = server_now(api)
            assert r.status_code in (200, 201)
            body = r.json()
            expected = {zone_date(before, zone).isoformat(), zone_date(after, zone).isoformat()}
            assert body["date"] in expected
            assert body["object"]["daily_date"] == body["date"] and body["object"]["title"] == body["date"]
            cap = api.post("/api/daily/today/blocks", json={"body": f"capture {tok()}", "after_block_id": None})
            assert cap.status_code == 201 and cap.json()["date"] in expected
            seen[zone] = body["date"]
            if zone == ZONE_AHEAD:
                with workspace(browser, app_url, "/api/health") as (page, _):
                    page.clock.set_system_time(before - timedelta(hours=30))
                    page.goto(app_url + "/today")
                    heading = heading_date(date.fromisoformat(body["date"]))
                    expect(page.get_by_role("heading", level=1, name=heading)).to_be_visible(timeout=UI_TIMEOUT_MS)
    assert seen[ZONE_AHEAD] != seen[ZONE_BEHIND]


def test_wf_daily_notes_capture_replay(browser, app_url):
    api = owner(app_url)
    hdr = {"X-CSRF-Token": api.csrf, "Cookie": f"quire_session={api.cookie}"}
    word = tok()
    key = idempotency_key()
    cap_text = f"capture {word}"
    body = {"body": cap_text, "after_block_id": None}
    r1 = post_json(app_url, "/api/daily/today/blocks", body, key, **hdr)
    assert r1.status_code == 201
    r2 = post_json(app_url, "/api/daily/today/blocks", body, key, **hdr)
    assert r2.status_code == 201 and r2.content == r1.content and r2.headers.get("idempotent-replay") == "true"
    oid = r1.json()["object_id"]
    texts = [b["body"] for b in get_obj(api, oid)["blocks"]]
    assert texts.count(p_body(cap_text)) == 1
    other_text = f"other {word}"
    r3 = post_json(app_url, "/api/daily/today/blocks", {"body": other_text, "after_block_id": None}, key, **hdr)
    assert r3.status_code == 409 and r3.json() == {"error": "idempotency_conflict"}
    assert p_body(other_text) not in [b["body"] for b in get_obj(api, oid)["blocks"]]
    key2 = idempotency_key()
    body2 = {"body": f"burst {word}", "after_block_id": None}
    barrier = threading.Barrier(6)

    def go(_: int) -> httpx.Response:
        barrier.wait()
        return post_json(app_url, "/api/daily/today/blocks", body2, key2, **hdr)

    with ThreadPoolExecutor(6) as pool:
        rs = list(pool.map(go, range(6)))
    assert len({(r.status_code, r.content) for r in rs}) == 1 and rs[0].status_code == 201
    assert [b["body"] for b in get_obj(api, oid)["blocks"]].count(p_body(body2["body"])) == 1
    keys: list[str] = []

    def drop_first(route):
        keys.append(route.request.headers.get("idempotency-key", ""))
        if len(keys) == 1:
            route.fetch()
            route.abort()
        else:
            route.fallback()

    with workspace(browser, app_url, "/today") as (page, _):
        expect(page.get_by_role("button", name="Add block", exact=True)).to_be_visible(timeout=UI_TIMEOUT_MS)
        today_id = api.post("/api/daily/today").json()["object"]["id"]
        count_before = len(get_obj(api, today_id)["blocks"])
        page.route("**/api/daily/today/blocks", drop_first)
        click(page.get_by_role("button", name="Add block", exact=True))
        within(page, lambda: _assert_len(keys, 2))
        assert keys[0] and keys[0] == keys[1]
        advance(page, 2000)
        assert len(get_obj(api, today_id)["blocks"]) == count_before + 1


def _assert_len(items: list, n: int) -> None:
    assert len(items) >= n, items


def test_idempotent_replay_before_checks(app_url):
    api = owner(app_url)
    word = tok()
    key = idempotency_key()
    raw1 = json.dumps({"after_block_id": None, "body": f"replay {word}"})
    headers = {"Idempotency-Key": key, "Content-Type": "application/json"}
    r1 = api.post("/api/daily/today/blocks", content=raw1, headers=dict(headers))
    assert r1.status_code == 201
    raw2 = '{ "body" :  "replay ' + word + '" }'
    r2 = api.post("/api/daily/today/blocks", content=raw2, headers=dict(headers))
    assert r2.status_code == 201 and r2.content == r1.content and r2.headers.get("idempotent-replay") == "true"
    assert api.delete(f"/api/blocks/{r1.json()['block']['id']}").status_code == 204
    with home_clock(api, "Pacific/Kiritimati"):
        r3 = api.post("/api/daily/today/blocks", content=raw1, headers=dict(headers))
        assert r3.status_code == 201 and r3.content == r1.content
    host_a, host_b = concept(api), concept(api)
    origin = concept(api)
    oblk = add_block(api, origin["id"], "replayed origin")
    qkey = idempotency_key()
    qbody = {"origin_block_id": oblk["id"], "after_block_id": None}
    q1 = api.post(f"/api/objects/{host_a['id']}/quotes", json=qbody, headers={"Idempotency-Key": qkey})
    assert q1.status_code == 201
    r = api.post(f"/api/objects/{host_b['id']}/quotes", json=qbody, headers={"Idempotency-Key": qkey})
    assert r.status_code == 409 and r.json() == {"error": "idempotency_conflict"}
    r = api.post("/api/daily/today/blocks", json={"body": f"replay {word}", "after_block_id": None}, headers={"Idempotency-Key": qkey})
    assert r.status_code == 409 and r.json() == {"error": "idempotency_conflict"}
    assert api.delete(f"/api/objects/{origin['id']}").status_code == 204
    q2 = api.post(f"/api/objects/{host_a['id']}/quotes", json=qbody, headers={"Idempotency-Key": qkey})
    assert q2.status_code == 201 and q2.content == q1.content
    assert not [b for b in get_obj(api, host_a["id"])["blocks"] if b["kind"] == "quote"]
    for bad in ("x" * 101, "has space", "caf\u00e9"):
        r = api.post("/api/daily/today/blocks", json={"body": f"bad key {word}", "after_block_id": None}, headers={"Idempotency-Key": bad.encode("utf-8")})
        assert r.status_code == 422 and r.json()["errors"]["idempotency_key"] == "Use 1 to 100 visible characters."
    today = api.post("/api/daily/today").json()["object"]["id"]
    assert f"<p>bad key {word}</p>" not in [b["body"] for b in get_obj(api, today)["blocks"]]
    ok = api.post("/api/daily/today/blocks", json={"body": f"long key {word}", "after_block_id": None}, headers={"Idempotency-Key": "k" * 100})
    assert ok.status_code in (201, 409)


def test_home_clock_setting(browser, app_url):
    api = owner(app_url)
    old_date = api.post("/api/daily/today").json()
    col = new_collection(api, [concept(api)["id"]])
    link = new_link(api, col["id"])
    r = api.put("/api/settings", json={"home_time_zone": "Mars/Olympus"})
    assert r.status_code == 422 and r.json()["errors"]["home_time_zone"] == "Choose a time zone from the list."
    try:
        with workspace(browser, app_url, "/settings") as (page, _):
            select(page.get_by_role("combobox", name="Home clock"), ZONE_TOKYO)
            click(page.get_by_role("button", name="Save home clock", exact=True))
            within(page, lambda: expect(announcements(page)).to_contain_text(f"Home clock set to {ZONE_TOKYO}. Today's note now follows it.", timeout=200))
        assert home_zone(api) == ZONE_TOKYO
        now = server_now(api)
        assert api.post("/api/daily/today").json()["date"] in {zone_date(now, ZONE_TOKYO).isoformat(), zone_date(server_now(api), ZONE_TOKYO).isoformat()}
        kept = api.ok("GET", f"/api/daily?date={old_date['date']}", 200)
        assert kept["id"] == old_date["object"]["id"] and kept["daily_date"] == old_date["date"]
        shown = next(l for l in api.ok("GET", f"/api/collections/{col['id']}/share-links", 200)["share_links"] if l["id"] == link["id"])
        assert shown["time_zone"] == ZONE_TOKYO
        assert shown["expires_at_display"] == expires_display(utc(link["expires_at_utc"]), ZONE_TOKYO)
        assert shown["expires_at"] == utc(link["expires_at_utc"]).astimezone(ZoneInfo(ZONE_TOKYO)).strftime("%Y-%m-%dT%H:%M")
    finally:
        api.put("/api/settings", json={"home_time_zone": HOME_ZONE_SEED})


def other_day_zone(api: Api) -> str:
    now = server_now(api)
    home = zone_date(now, home_zone(api))
    return next(z for z in ("Etc/GMT+12", "Pacific/Kiritimati") if zone_date(now, z) != home)


def test_wf_daily_notes_empty_prompt(browser, app_url):
    api = owner(app_url)
    zone = other_day_zone(api)
    with home_clock(api, zone):
        note = api.post("/api/daily/today").json()["object"]
        for b in note["blocks"]:
            api.delete(f"/api/blocks/{b['id']}")
        assert get_obj(api, note["id"])["blocks"] == []
        with workspace(browser, app_url, f"/o/{note['id']}") as (page, _):
            main = page.get_by_role("main")
            expect(main).to_contain_text(COPY_EMPTY_DAY, timeout=UI_TIMEOUT_MS)
            expect(page.get_by_role("heading", level=1, name=heading_date(date.fromisoformat(note["daily_date"])))).to_be_visible()


def test_wf_daily_notes_phone_reduced_motion(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    with workspace(browser, app_url, f"/o/{obj['id']}", size=(375, 812), reduced_motion="reduce") as (page, _):
        click(page.get_by_role("button", name="Open library", exact=True))
        advance(page, 16)
        drawer = page.get_by_role("dialog", name="Library")
        expect(drawer).to_be_visible()
        assert abs(drawer.bounding_box()["x"]) <= 1
        record(page)
        page.evaluate("() => { window.__quireHold = el => el.tagName === 'MAIN' || el.getAttribute('role') === 'main'; }")
        click(drawer.get_by_role("button", name="Today", exact=True))
        advance(page, 16)
        expect(page.get_by_role("dialog", name="Library")).to_have_count(0)
        within(page, lambda: expect(page).to_have_url(re.compile(r"/today$"), timeout=200))
        fades = [r for r in recorded(page) if r["target"].get("main")]
        assert fades and near(fades[0]["duration"], FADE_MS), recorded(page)
        seek(page, fades[0]["i"], FADE_MS / 2)
        h1 = page.get_by_role("heading", level=1)
        box = h1.bounding_box()
        assert box and box["width"] > 0 and decode(capture(h1)).variance() > 0
        page.evaluate("i => window.__quireAnims[i].finish()", fades[0]["i"])
        expect(h1).to_be_focused()
    assert api.post("/api/daily/today").status_code == 200


def test_daily_reveal(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    add_block(api, obj["id"], "reveal source")
    api.post("/api/daily/today/blocks", json={"body": "reveal content line", "after_block_id": None})
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        main = page.get_by_role("main")
        expect(main).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert main.evaluate("m => m.getAnimations().length") == 0
        record(page)
        page.evaluate("() => { window.__quireHold = el => el.tagName === 'MAIN' || el.getAttribute('role') === 'main'; }")
        click(page.get_by_role("navigation", name="Library").get_by_role("button", name="Today", exact=True))
        within(page, lambda: expect(page).to_have_url(re.compile(r"/today$"), timeout=200))
        reveal = [r for r in recorded(page) if r["target"].get("main")]
        assert reveal and near(reveal[0]["duration"], REVEAL_MS), recorded(page)
        expect(page.get_by_role("heading", level=1)).to_be_focused()
        i = reveal[0]["i"]
        seek(page, i, 0)
        start = decode(capture(main))
        seek(page, i, REVEAL_MS / 2)
        mid = decode(capture(main))
        seek(page, i, REVEAL_MS - 0.01)
        end = decode(capture(main))
        assert start.variance() < end.variance()
        assert difference(start, end) > difference(mid, end)


def timeline_zone_setup(api: Api) -> None:
    with home_clock(api, "Etc/GMT+12"):
        api.post("/api/daily/today")


def test_timeline_coast_snap(browser, app_url):
    api = owner(app_url)
    timeline_zone_setup(api)
    with home_clock(api, "Pacific/Kiritimati"):
        api.post("/api/daily/today")
        for mode in ("no-preference", "reduce"):
            with workspace(browser, app_url, "/timeline", size=(375, 812), reduced_motion=mode) as (page, _):
                region = page.get_by_role("region", name="Daily timeline")
                expect(region).to_be_visible(timeout=UI_TIMEOUT_MS)
                advance(page, 100)
                left, width, client = region.evaluate("r => [r.scrollLeft, r.scrollWidth, r.clientWidth]")
                top = width - client
                assert top > 0 and abs(left - top) <= 1
                box = region.get_by_role("heading", level=2).last.bounding_box()
                x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(x, y)
                page.mouse.down()
                pull = 0
                for step in range(1, 5):
                    pull = 10 * step
                    page.mouse.move(x + pull, y)
                    advance(page, 16)
                dragged = region.evaluate("r => r.scrollLeft")
                assert abs(dragged - (top - pull)) <= 2, dragged
                page.mouse.up()
                advance(page, 16)
                after_release = region.evaluate("r => r.scrollLeft")
                snaps = {min(COLUMN_STEP * k, top) for k in range(int(top // COLUMN_STEP) + 2)}
                if mode == "reduce":
                    assert any(abs(after_release - s) <= 1 for s in snaps), (after_release, snaps)
                    advance(page, 500)
                    assert abs(region.evaluate("r => r.scrollLeft") - after_release) <= 1
                else:
                    advance(page, 48)
                    assert region.evaluate("r => r.scrollLeft") < dragged - 0.5
                    advance(page, 4000)
                    final = region.evaluate("r => r.scrollLeft")
                    assert any(abs(final - s) <= 1 for s in snaps), (final, snaps)


def heat_of(item) -> str | None:
    return item.evaluate("e => { const h = e.querySelector('[data-heat]'); return h ? h.getAttribute('data-heat') : null; }")


def day_item(page: Page, d: date):
    return page.get_by_role("list", name="Days").get_by_role("listitem").filter(
        has=page.get_by_role("heading", level=2, name=heading_date(d), exact=True))


def test_timeline_heat(browser, app_url):
    api = owner(app_url)
    api.post("/api/daily/today")
    tl = api.ok("GET", "/api/timeline", 200)
    today = date.fromisoformat(tl["today"])
    n = next(d for d in tl["days"] if d["date"] == tl["today"])["block_count"]
    with workspace(browser, app_url, "/timeline") as (page, _):
        item = day_item(page, today)
        expect(item).to_contain_text(plural(n, "block"), timeout=UI_TIMEOUT_MS)
        assert heat_of(item) == str(n)
        api.ok("POST", "/api/daily/today/blocks", 201, json={"body": f"heat {tok()}", "after_block_id": None})
        within(page, lambda: _assert_eq(heat_of(item), str(n + 1)), seconds=LIVE_S)
        expect(item).to_contain_text(plural(n + 1, "block"))
    assert next(d for d in api.ok("GET", "/api/timeline", 200)["days"] if d["date"] == tl["today"])["block_count"] == n + 1


def test_timeline_keyboard_move(browser, app_url):
    api = owner(app_url)
    timeline_zone_setup(api)
    with home_clock(api, "Pacific/Kiritimati"):
        api.post("/api/daily/today")
        text = f"tl {tok()}"[:24]
        cap = api.ok("POST", "/api/daily/today/blocks", 201, json={"body": text, "after_block_id": None})
        tl = api.ok("GET", "/api/timeline", 200)
        days = tl["days"]
        idx = next(i for i, d in enumerate(days) if d["date"] == cap["date"])
        target = next(d for d in reversed(days[:idx]) if d["object_id"])
        src_count = days[idx]["block_count"]
        dst_count = target["block_count"]
        with workspace(browser, app_url, "/timeline") as (page, _):
            handle = page.get_by_role("button", name=f'Move "{text}"', exact=True)
            expect(handle).to_be_visible(timeout=UI_TIMEOUT_MS)
            handle.focus()
            page.keyboard.press("Alt+ArrowLeft")
            heading = heading_date(date.fromisoformat(target["date"]))
            within(page, lambda: expect(announcements(page)).to_contain_text(f"Moved block to {heading}.", timeout=200))
            moved = day_item(page, date.fromisoformat(target["date"])).get_by_role("button", name=f'Move "{text}"', exact=True)
            expect(moved).to_be_focused()
            within(page, lambda: _assert_eq(heat_of(day_item(page, date.fromisoformat(target["date"]))), str(dst_count + 1)))
            within(page, lambda: _assert_eq(heat_of(day_item(page, date.fromisoformat(cap["date"]))), str(src_count - 1)))
        blocks = get_obj(api, target["object_id"])["blocks"]
        assert blocks[-1]["id"] == cap["block"]["id"]


def test_block_move_rules(app_url):
    api = owner(app_url)
    o1, o2 = concept(api), concept(api)
    a = add_block(api, o1["id"], "a")
    b = add_block(api, o1["id"], "b", after=a["id"])
    c = add_block(api, o1["id"], "c", after=b["id"])
    x = add_block(api, o2["id"], "x")
    r = api.ok("POST", f"/api/blocks/{b['id']}/move", 200, json={"object_id": o2["id"], "after_block_id": x["id"]})
    assert r["object_id"] == o2["id"] and r["position"] == 2
    assert [(blk["id"], blk["position"]) for blk in get_obj(api, o1["id"])["blocks"]] == [(a["id"], 1), (c["id"], 2)]
    api.ok("POST", f"/api/blocks/{a['id']}/move", 200, json={"object_id": o2["id"], "after_block_id": None})
    assert get_obj(api, o2["id"])["blocks"][-1]["id"] == a["id"]
    assert len(api.ok("GET", f"/api/blocks/{b['id']}/revisions", 200)["revisions"]) == 1
    att = upload(api, o1["id"], "scan.png", PNG, "image/png").json()
    r = api.post(f"/api/blocks/{att['id']}/move", json={"object_id": o2["id"], "after_block_id": None})
    assert r.status_code == 409 and r.json() == {"error": "not_movable"}
    q = quote(api, o2["id"], c["id"])["block"]
    r = api.post(f"/api/blocks/{q['id']}/move", json={"object_id": o1["id"], "after_block_id": None})
    assert r.status_code == 422 and r.json()["errors"]["object_id"] == "Quote a block from another note."
    r = api.post(f"/api/blocks/{c['id']}/move", json={"object_id": o2["id"], "after_block_id": None})
    assert r.status_code == 422 and r.json()["errors"]["object_id"] == "That note quotes this block."
    r = api.post(f"/api/blocks/{c['id']}/move", json={"object_id": concept(api)["id"], "after_block_id": x["id"]})
    assert r.status_code == 422 and r.json()["errors"]["after_block_id"] == "That block is not in this note."
    gone = concept(api)
    api.delete(f"/api/objects/{gone['id']}")
    r = api.post(f"/api/blocks/{c['id']}/move", json={"object_id": gone["id"], "after_block_id": None})
    assert r.status_code == 422 and r.json()["errors"]["object_id"] == "That note no longer exists."
    host3 = concept(api)
    api.ok("POST", f"/api/blocks/{q['id']}/move", 200, json={"object_id": host3["id"], "after_block_id": None})
    froms = [e["from_object_id"] for e in api.ok("GET", f"/api/objects/{o1['id']}/backlinks", 200)["backlinks"]]
    assert host3["id"] in froms and o2["id"] not in froms


def test_live_sync_events(browser, app_url):
    watcher = owner(app_url)
    actor = owner(app_url, FIREFOX_ANDROID_UA)
    label = next(s["label"] for s in actor.ok("GET", "/api/sessions", 200)["sessions"] if s["current"])
    obj = concept(actor)
    blk = add_block(actor, obj["id"], "live text")
    stream = Events(watcher)
    try:
        edit_id = f"e-{tok()}"
        ops = [{"retain": 9}, {"insert": " grows"}]
        assert patch_ops(actor, blk["id"], ops, 1, edit_id=edit_id).status_code == 200
        ev = stream.wait(lambda e: e["event"] == "block.saved" and e["data"]["block"]["id"] == blk["id"])
        assert ev["data"]["ops"] == ops and ev["data"]["base_version"] == 1 and ev["data"]["edit_id"] == edit_id
        assert ev["data"]["label"] == label and ev["data"]["object_id"] == obj["id"] and ev["id"]
        actor.ok("PATCH", f"/api/blocks/{blk['id']}", 200, json={"body": LIVE_BODY, "base_version": 2})
        ev = stream.wait(lambda e: e["event"] == "block.saved" and e["data"]["block"]["id"] == blk["id"])
        assert ev["data"]["ops"] is None and ev["data"]["edit_id"] is None
        host = concept(actor)
        quote(actor, host["id"], blk["id"])
        ev = stream.wait(lambda e: e["event"] == "backlinks.changed" and e["data"]["object_id"] == obj["id"])
        assert ev["data"]["backlinks"] == 1
        actor.ok("PATCH", f"/api/objects/{obj['id']}", 200, json={"title": f"Renamed {tok()}"})
        stream.wait(lambda e: e["event"] == "object.saved" and e["data"]["object_id"] == obj["id"])
        col = new_collection(actor, [host["id"]])
        actor.ok("PUT", f"/api/collections/{col['id']}/board", 200, json={"positions": [{"object_id": host["id"], "x": 8, "y": 16}]})
        ev = stream.wait(lambda e: e["event"] == "board.saved" and e["data"]["collection_id"] == col["id"])
        assert ev["data"]["positions"] == [{"object_id": host["id"], "x": 8, "y": 16}]
        link = new_link(actor, col["id"])
        stream.wait(lambda e: e["event"] == "share_link.changed" and e["data"]["share_link_id"] == link["id"])
        actor.delete(f"/api/objects/{host['id']}")
        stream.wait(lambda e: e["event"] == "object.removed" and e["data"]["object_id"] == host["id"])
    finally:
        stream.close()
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        expect(block_box(page, 1)).to_have_text(LIVE_BODY, timeout=UI_TIMEOUT_MS)
        mark_no_reload(page)
        patch_ops(actor, blk["id"], [{"insert": LIVE_PREFIX}, {"retain": len(LIVE_BODY)}], 3)
        within(page, lambda: expect(block_box(page, 1)).to_have_text(LIVE_PREFIX + LIVE_BODY, timeout=100), seconds=LIVE_S)
        assert_no_reload(page)


def test_live_sync_resume(app_url):
    api = owner(app_url)
    obj = concept(api)
    first = Events(api)
    assert "retry: 2000" in first.lines[:3]
    blk = add_block(api, obj["id"], "resume")
    ev = first.wait(lambda e: e["event"] == "block.saved" and e["data"]["block"]["id"] == blk["id"])
    last = int(ev["id"])
    first.close()
    patch_ops(api, blk["id"], [{"retain": 6}, {"insert": " one"}], 1)
    patch_ops(api, blk["id"], [{"retain": 10}, {"insert": " two"}], 2)
    again = Events(api, last)
    try:
        missed = []
        while len([m for m in missed if m["event"] == "block.saved" and m["data"]["block"]["id"] == blk["id"]]) < 2:
            missed.append(again.wait(lambda e: True, seconds=LIVE_S + 3))
        ids = [int(m["id"]) for m in missed]
        assert ids[0] == last + 1 and ids == list(range(ids[0], ids[0] + len(ids)))
        mine = [m for m in missed if m["event"] == "block.saved" and m["data"]["block"]["id"] == blk["id"]]
        assert [m["data"]["block"]["version"] for m in mine] == [2, 3]
        api.post(f"/api/blocks/{blk['id']}/presence", json={"anchor": 0, "head": 0, "version": 3})
        pres = again.wait(lambda e: e["event"] == "presence.changed")
        assert pres["id"] is None
    finally:
        again.close()
    for bad in ("abc", str(10 ** 12)):
        s = Events(api, bad)
        try:
            ev = s.wait(lambda e: True, seconds=LIVE_S + 3)
            assert ev["event"] == "sync.reset" and int(ev["id"]) >= last + 2
        finally:
            s.close()
    fresh = Events(api)
    try:
        patch_ops(api, blk["id"], [{"retain": 14}, {"insert": "!"}], 3)
        ev = fresh.wait(lambda e: e["event"] != "presence.changed", seconds=LIVE_S + 3)
        assert int(ev["id"]) > last + 2
    finally:
        fresh.close()


def test_wf_live_sync_reconnect(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    blk = add_block(api, obj["id"], GAP_TEXT)
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        expect(block_box(page, 1)).to_have_text(GAP_TEXT, timeout=UI_TIMEOUT_MS)
        within(page, lambda: expect(page.get_by_role("status", name="Sync status")).to_have_text("Live", timeout=200))
        mark_no_reload(page)
        page.context.set_offline(True)
        within(page, lambda: expect(page.get_by_role("status", name="Sync status")).to_have_text(COPY_SYNC_PAUSED, timeout=200), step_ms=250)
        patch_ops(api, blk["id"], [{"retain": len(GAP_TEXT)}, {"insert": GAP_TAIL}], 1)
        page.context.set_offline(False)
        within(page, lambda: expect(block_box(page, 1)).to_have_text(GAP_TEXT + GAP_TAIL, timeout=200), step_ms=250)
        within(page, lambda: expect(page.get_by_role("status", name="Sync status")).to_have_text("Live", timeout=200), step_ms=250)
        assert_no_reload(page)
    assert get_obj(api, obj["id"])["blocks"][0]["version"] == 2


def test_wf_live_sync_rebase(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    blk = add_block(api, obj["id"], REBASE_TEXT)
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        box = block_box(page, 1)
        expect(box).to_have_text(REBASE_TEXT, timeout=UI_TIMEOUT_MS)
        box.click()
        page.keyboard.press("Control+End")
        page.keyboard.type(REBASE_TAIL)
        merged = REBASE_REMOTE + REBASE_TEXT + REBASE_TAIL
        remote = patch_ops(api, blk["id"], [{"insert": REBASE_REMOTE}, {"retain": len(REBASE_TEXT)}], 1)
        assert remote.status_code == 200
        within(page, lambda: expect(box).to_have_text(merged, timeout=50), seconds=LIVE_S, step_ms=1)
        expect(box).to_be_focused()
        assert box.evaluate(SELECTION_JS) == len(merged)
        page.keyboard.type("!")
        advance(page, SAVE_ADVANCE_MS)
        assert poll(lambda: get_obj(api, obj["id"])["blocks"][0]["body"] == p_body(merged + "!"), LIVE_S + 3)
        click(page.get_by_role("button", name=history_name(1), exact=True))
        dlg = page.get_by_role("dialog", name="Block history")
        options = dlg.get_by_role("listbox", name="Revisions").get_by_role("option")
        expect(options).to_have_count(3, timeout=UI_TIMEOUT_MS)
        focus_before = focused_name(page)
        version = get_obj(api, obj["id"])["blocks"][0]["version"]
        patch_ops(api, blk["id"], [{"retain": len(merged) + 1}, {"insert": "?"}], version)
        within(page, lambda: expect(options).to_have_count(4, timeout=100), seconds=LIVE_S)
        expect(dlg).to_be_visible()
        assert focused_name(page) == focus_before
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        search = page.get_by_role("combobox", name="Search Quire")
        page.keyboard.type("op")
        patch_ops(api, blk["id"], [{"retain": len(merged) + 2}, {"insert": "."}], version + 1)
        advance(page, LIVE_MS)
        expect(page.get_by_role("dialog", name="Command palette")).to_be_visible()
        expect(search).to_be_focused()
        assert search.input_value() == "op"


def test_wf_live_sync_session_ended(app_url):
    a, b = owner(app_url), owner(app_url, FIREFOX_ANDROID_UA)
    sa, sb = Events(a), Events(b)
    try:
        assert a.delete(f"/api/sessions/{b.session_id}").status_code == 204
        ev = sb.wait(lambda e: e["event"] == "session.ended")
        assert ev["id"] is None and sb.closed.wait(LIVE_S)
        ch = sa.wait(lambda e: e["event"] == "sessions.changed")
        assert ch["id"] and int(ch["id"]) > 0
        assert b.get("/api/session").status_code == 401
    finally:
        sa.close()
        sb.close()


def test_wf_live_sync_capture_home_day(browser, app_url):
    api = owner(app_url)
    with home_clock(api, "Pacific/Kiritimati"):
        note = api.post("/api/daily/today").json()
        expected = zone_date(server_now(api), "Pacific/Kiritimati").isoformat()
        with workspace(browser, app_url, f"/o/{note['object']['id']}") as (page, _):
            expect(page.get_by_role("heading", level=1, name=heading_date(date.fromisoformat(note["date"])))).to_be_visible(timeout=UI_TIMEOUT_MS)
            mark_no_reload(page)
            phone = owner(app_url, FIREFOX_ANDROID_UA)
            text = f"phone thought {tok()}"
            cap = phone.ok("POST", "/api/daily/today/blocks", 201, json={"body": text, "after_block_id": None})
            assert cap["date"] in {expected, note["date"]} and cap["object_id"] == note["object"]["id"]
            within(page, lambda: expect(page.get_by_role("main")).to_contain_text(text, timeout=100), seconds=LIVE_S)
            assert_no_reload(page)


def test_live_graph_growth(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        beta_btn = graph_group(page).get_by_role("button", name=node_name(objs["Beta"]["title"], 1), exact=True)
        gamma_btn = graph_group(page).get_by_role("button", name=node_name(objs["Gamma"]["title"], 0), exact=True)
        page.get_by_role("combobox", name="Share scope").focus()
        view_before, models = view_and_models(page)
        assert any(abs(m[0] - node_size(1)) < 1e-4 for m in models)
        api.ok("PATCH", f"/api/objects/{objs['Gamma']['id']}", 200, json={"properties": {"Link": objs["Beta"]["id"]}})
        within(page, lambda: expect(graph_group(page).get_by_role("button", name=node_name(objs["Beta"]["title"], 2), exact=True)).to_be_visible(timeout=100), seconds=LIVE_S + 1, step_ms=100)
        advance(page, 50)
        view_after, models = view_and_models(page)
        assert any(abs(m[0] - node_size(2)) < 1e-4 for m in models)
        assert all(abs(x - y) < 1e-6 for x, y in zip(view_before, view_after))
        expect(page.get_by_role("combobox", name="Share scope")).to_be_focused()
        assert beta_btn.count() == 0 and gamma_btn.count() == 1


def test_backlink_rail(browser, app_url):
    api = owner(app_url)
    person = new_obj(api, type_named(api, "Person")["id"], f"Railed {tok()}")
    pblk = add_block(api, person["id"], "railed words")
    src = new_obj(api, type_named(api, "Source")["id"], f"Citing {tok()}", {"Author": person["id"]})
    host = concept(api, f"Quoting {tok()}")
    quote(api, host["id"], pblk["id"])
    with workspace(browser, app_url, f"/o/{person['id']}") as (page, _):
        rail = page.get_by_role("region", name="Backlinks")
        expect(rail.get_by_role("heading", name="Backlinks")).to_contain_text("2", timeout=UI_TIMEOUT_MS)
        lst = rail.get_by_role("list", name="Backlinks list")
        expect(lst.get_by_role("listitem").filter(has=page.get_by_role("link", name=host["title"], exact=True))).to_contain_text("quoted")
        expect(lst.get_by_role("listitem").filter(has=page.get_by_role("link", name=src["title"], exact=True))).to_contain_text("Author")
        links = lst.get_by_role("link")
        for opener in (block_box(page, 1), page.get_by_role("button", name=history_name(1), exact=True)):
            opener.focus()
            page.keyboard.press("Alt+b")
            expect(links.first).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(links.nth(1)).to_be_focused()
        target = links.nth(1).get_attribute("href") or ""
        page.keyboard.press("Enter")
        within(page, lambda: expect(page).to_have_url(re.compile(re.escape(target.split("?")[0]) + "$"), timeout=200))
    with workspace(browser, app_url, f"/o/{person['id']}", size=(375, 812)) as (page, _):
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.focus()
        page.keyboard.press("Alt+b")
        advance(page, 1000)
        sheet = page.get_by_role("dialog", name="Margin")
        expect(sheet.get_by_role("list", name="Backlinks list").get_by_role("link").first).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, 1000)
        expect(box).to_be_focused()
    assert api.ok("GET", f"/api/objects/{person['id']}/backlinks", 200)["count"] == 2


def test_wf_backlinks_graph_keyboard(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    names = [node_name(objs["Alpha"]["title"], 0), node_name(objs["Beta"]["title"], 1), node_name(objs["Gamma"]["title"], 0)]
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        btn = lambda i: graph_group(page).get_by_role("button", name=names[i], exact=True)
        page.get_by_role("combobox", name="Share scope").focus()
        page.keyboard.press("Tab")
        expect(btn(0)).to_be_focused()
        for key, i in (("ArrowRight", 1), ("End", 2), ("ArrowRight", 0), ("ArrowLeft", 2), ("ArrowUp", 1), ("Home", 0), ("ArrowDown", 1)):
            page.keyboard.press(key)
            expect(btn(i)).to_be_focused()
        expect(page.get_by_role("list", name="Backlinks list").get_by_role("link", name=objs["Alpha"]["title"], exact=True)).to_be_visible()
        page.keyboard.press("Enter")
        within(page, lambda: expect(page).to_have_url(re.compile(f"/o/{objs['Beta']['id']}$"), timeout=200))
    assert backlinks(api, objs["Beta"]["id"]) == 1


def test_wf_backlinks_graph_tablet_drawer(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    typed = "tablet text"
    add_block(api, obj["id"], typed)
    rail_names = {"Timeline", "Queries", "Graph", "Settings", "New type"}
    for size in ((768, 1024), (375, 812)):
        with workspace(browser, app_url, f"/o/{obj['id']}", size=size) as (page, _):
            expect(block_box(page, 1)).to_be_visible(timeout=UI_TIMEOUT_MS)
            expect(page.get_by_role("navigation", name="Library")).to_have_count(0)
            if size[0] == 375:
                expect(page.get_by_role("list", name="Backlinks list")).to_have_count(0)
            names = tab_order(page, 30)
            assert not rail_names & set(names), names
            layout(page)
            click(page.get_by_role("button", name="Open library", exact=True))
            advance(page, 1000)
            drawer = page.get_by_role("dialog", name="Library")
            expect(drawer.get_by_role("navigation", name="Library")).to_be_visible()
            expect(block_box(page, 1)).to_have_count(0)
            names = tab_order(page, 15)
            assert block_name(1) not in names
            page.keyboard.press("Escape")
            advance(page, 1000)
            expect(page.get_by_role("dialog", name="Library")).to_have_count(0)
    assert get_obj(api, obj["id"])["blocks"][0]["body"] == f"<p>{typed}</p>"


def test_wf_backlinks_graph_filters(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    col = new_collection(api, [objs["Alpha"]["id"]])
    with workspace(browser, app_url, "/graph", reduced_motion="reduce") as (page, _):
        expect(graph_group(page)).to_be_visible(timeout=UI_TIMEOUT_MS)
        select(page.get_by_role("combobox", name="Show type"), ty["name"])
        within(page, lambda: _assert_eq(query_of(page), {"type": [ty["id"]]}))
        open_graph(page, 3)
        select(page.get_by_role("combobox", name="Show collection"), col["name"])
        within(page, lambda: _assert_eq(query_of(page), {"type": [ty["id"]], "collection": [col["id"]]}))
        open_graph(page, 1)
        frames = scene_frames(graph_canvas(page), steps=1, step_ms=50)
        assert draws_in(frames[-1]) <= 1
        page.reload()
        open_graph(page, 1)
        expect(graph_group(page).get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True)).to_be_visible()
        assert combo_label(page.get_by_role("combobox", name="Show collection")) == col["name"]
        page.go_back()
        within(page, lambda: _assert_eq(query_of(page), {"type": [ty["id"]]}))
        open_graph(page, 3)
        assert path_of(page) == "/graph"


def _assert_eq(a: Any, b: Any) -> None:
    assert a == b, (a, b)


def test_graph_scene_draws(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}") as (page, _):
        open_graph(page, 3)
        canvas = graph_canvas(page)
        frames = scene_frames(canvas, steps=3, step_ms=100)
        for f in frames:
            n = draws_in(f)
            assert n > 0 and n % 4 == 0, n
        assert decode(frames[-1]["png"]).variance() > 0
        _, models = view_and_models(page)
        sizes = sorted(round(m[0], 4) for m in models[-3:])
        assert sizes == sorted([round(node_size(0), 4), round(node_size(0), 4), round(node_size(1), 4)])
        dims = canvas.evaluate("g => { const c = g.querySelector('canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight, devicePixelRatio]; }")
        assert abs(dims[3] - GRAPH_CANVAS_H) <= 1
        assert abs(dims[0] - dims[2] * dims[4]) <= 1 and abs(dims[1] - dims[3] * dims[4]) <= 1
        main_w = page.get_by_role("main").evaluate("m => m.clientWidth")
        assert abs(dims[2] - main_w) <= 2
    graph = api.ok("GET", "/api/graph", 200)
    assert sum(1 for n in graph["nodes"] if n["type_id"] == ty["id"]) == 3


def test_graph_layout_settled(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    graph = api.ok("GET", "/api/graph", 200)
    expected = settle_layout(graph, types(api))
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        _, models = view_and_models(page)
        for o in objs.values():
            p = expected[o["id"]]
            assert any(math.dist(p, (m[12], m[13], m[14])) <= SETTLE_TOL for m in models), (o["title"], p, [(m[12], m[13], m[14]) for m in models])


def corner_point(page: Page, view: list[float], models: list[list[float]]) -> tuple[float, float]:
    box = canvas_box(page)
    pts = [project(view, [m[12], m[13], m[14]], box)[:2] for m in models]
    corners = [(box["x"] + 8, box["y"] + 8), (box["x"] + box["width"] - 8, box["y"] + 8),
               (box["x"] + 8, box["y"] + box["height"] - 8), (box["x"] + box["width"] - 8, box["y"] + box["height"] - 8)]
    return max(corners, key=lambda c: min((math.dist(c, p) for p in pts), default=1e9))


def test_graph_camera_controls(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        view, models = view_and_models(page)
        psi, phi = angles(view)
        assert abs(angle_diff(psi, 0)) < 0.01 and abs(phi - HOME_PHI_DEG) < 0.01
        assert abs(math.hypot(*eye_of(view)) - HOME_D) < 0.01
        x, y = corner_point(page, view, models)
        scroll = page.evaluate("() => scrollY")
        page.mouse.move(x, y)
        page.mouse.wheel(0, 100)
        advance(page, 32)
        view, _ = view_and_models(page)
        assert abs(math.hypot(*eye_of(view)) - (HOME_D + 5)) < 0.01
        page.mouse.down()
        page.mouse.move(x - 25 if x > 100 else x + 25, y, steps=5)
        dx = -25 if x > 100 else 25
        cbox = canvas_box(page)
        dy = 10 if y < cbox["y"] + cbox["height"] / 2 else -10
        page.mouse.move(x + 2 * dx, y + dy, steps=5)
        page.mouse.up()
        advance(page, 32)
        view2, _ = view_and_models(page)
        psi2, phi2 = angles(view2)
        assert abs(angle_diff(psi2, 0.4 * 2 * dx)) < 0.05
        assert abs(phi2 - (HOME_PHI_DEG + 0.4 * dy)) < 0.05
        assert page.evaluate("() => scrollY") == scroll
        alpha = graph_group(page).get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True)
        alpha.focus()
        advance(page, 32)
        fly_d = 12 + 4 * node_size(0)
        view, _ = view_and_models(page)
        c = target_of(view, fly_d)
        psi0, _ = angles(view)
        page.keyboard.press("Shift+ArrowLeft")
        advance(page, 32)
        view, _ = view_and_models(page)
        assert abs(angle_diff(angles(view)[0], psi0 - 15)) < 0.05
        assert math.dist(target_of(view, fly_d), c) < 0.02
        page.keyboard.press("=")
        advance(page, 32)
        view, _ = view_and_models(page)
        assert abs(math.dist(eye_of(view), c) - D_MIN) < 0.02
        for _ in range(20):
            page.keyboard.press("-")
        advance(page, 32)
        view, _ = view_and_models(page)
        assert abs(math.dist(eye_of(view), c) - D_MAX) < 0.02
        for _ in range(12):
            page.keyboard.press("Shift+ArrowUp")
        advance(page, 32)
        view, _ = view_and_models(page)
        assert abs(angles(view)[1] - PHI_LIMIT) < 0.05
        expect(alpha).to_be_focused()


def label_pairs(page: Page, view: list[float], models: list[list[float]]) -> list[tuple[Any, tuple[float, float, float]]]:
    box = canvas_box(page)
    buttons = graph_group(page).get_by_role("button")
    out = []
    for i in range(buttons.count()):
        b = buttons.nth(i)
        bb = b.bounding_box()
        best = min((project(view, [m[12], m[13], m[14]], box) for m in models),
                   key=lambda p: abs(bb["x"] - (p[0] + LABEL_OFFSET_PX)) + abs(bb["y"] + bb["height"] / 2 - p[1]))
        out.append((b, best))
    return out


def test_graph_labels_and_picking(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        advance(page, 50)
        view, models = view_and_models(page)
        pairs = label_pairs(page, view, models)
        for b, p in pairs:
            bb = b.bounding_box()
            assert abs(bb["x"] - (p[0] + LABEL_OFFSET_PX)) <= 2 and abs(bb["y"] + bb["height"] / 2 - p[1]) <= 2, (bb, p)
        before = draws_in(scene_frames(graph_canvas(page), steps=1, step_ms=50)[-1])
        gamma = next((b, p) for b, p in pairs if (b.get_attribute("aria-label") or b.inner_text()).startswith(objs["Gamma"]["title"]))
        page.mouse.click(gamma[1][0], gamma[1][1])
        advance(page, 50)
        expect(gamma[0]).to_be_focused()
        after = draws_in(scene_frames(graph_canvas(page), steps=1, step_ms=50)[-1])
        assert before == after == 4 or (before > 0 and after % 4 == 0)


def test_graph_fly_to(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}") as (page, _):
        open_graph(page, 3)
        alpha = graph_group(page).get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True)
        start, _ = view_and_models(page)
        alpha.focus()
        advance(page, FLY_MS / 2)
        mid, _ = view_and_models(page)
        advance(page, FLY_MS / 2 + 100)
        end, models = view_and_models(page)
        d = 12 + 4 * node_size(0)
        c = target_of(end, d)
        assert any(math.dist(c, (m[12], m[13], m[14])) < 0.05 for m in models)
        psi, phi = angles(end)
        assert abs(phi - FLY_PHI_DEG) < 0.05
        assert abs(angle_diff(psi, math.degrees(math.atan2(c[0], c[2])))) < 0.05
        assert math.dist(eye_of(mid), eye_of(start)) > 0.01 and math.dist(eye_of(mid), eye_of(end)) > 0.01
        page.keyboard.press("Escape")
        advance(page, FLY_MS + 100)
        home, _ = view_and_models(page)
        psi, phi = angles(home)
        assert abs(angle_diff(psi, 0)) < 0.05 and abs(phi - HOME_PHI_DEG) < 0.05
        assert abs(math.hypot(*eye_of(home)) - HOME_D) < 0.05
        expect(alpha).to_be_focused()


def test_graph_idle_rotation(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}") as (page, _):
        open_graph(page, 3)
        v0, models = view_and_models(page)
        advance(page, 1000)
        v1, _ = view_and_models(page)
        assert abs(angle_diff(angles(v1)[0], angles(v0)[0]) - IDLE_DEG_PER_S) < 0.5
        x, y = corner_point(page, v1, models)
        page.mouse.move(x, y)
        page.mouse.wheel(0, 100)
        v2, _ = view_and_models(page)
        advance(page, IDLE_RESUME_MS - 1000)
        v3, _ = view_and_models(page)
        assert abs(angle_diff(angles(v3)[0], angles(v2)[0])) < 0.1
        advance(page, 2000)
        v4, _ = view_and_models(page)
        assert angle_diff(angles(v4)[0], angles(v3)[0]) > 1
        graph_group(page).get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True).focus()
        advance(page, FLY_MS / 2)
        vm, models = view_and_models(page)
        x, y = corner_point(page, vm, models)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 10 if x < 200 else x - 10, y, steps=4)
        page.mouse.up()
        moved, _ = drawn_view_and_models(page)
        expect_delta = 4 if x < 200 else -4
        assert abs(angle_diff(angles(moved)[0], angles(vm)[0] + expect_delta)) < 0.1
        advance(page, FLY_MS)
        later, _ = view_and_models(page)
        assert math.dist(eye_of(later), eye_of(moved)) < 0.01


def test_graph_list_fallback(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}", no_webgl=True) as (page, _):
        group = graph_group(page)
        lst = group.get_by_role("list", name="Graph nodes")
        expect(lst.get_by_role("listitem")).to_have_count(3, timeout=UI_TIMEOUT_MS)
        assert group.evaluate("g => g.querySelectorAll('canvas').length") == 0
        expect(lst.get_by_role("listitem").nth(0)).to_contain_text(f"links to {objs['Beta']['title']}")
        expect(lst.get_by_role("listitem").nth(1)).to_contain_text("links to nothing")
        first = lst.get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True)
        first.focus()
        page.keyboard.press("End")
        expect(lst.get_by_role("button", name=node_name(objs["Gamma"]["title"], 0), exact=True)).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(first).to_be_focused()
        col = new_collection(api, [objs["Beta"]["id"]])
        page.reload()
        select(page.get_by_role("combobox", name="Show collection"), col["name"])
        within(page, lambda: _assert_eq(query_of(page), {"type": [ty["id"]], "collection": [col["id"]]}))
        expect(lst.get_by_role("listitem")).to_have_count(1)


def test_graph_pinning(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    title = objs["Alpha"]["title"]
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        btn = graph_group(page).get_by_role("button", name=node_name(title, 0), exact=True)
        btn.focus()
        page.keyboard.press("p")
        expect(announcements(page)).to_contain_text(f"Pinned {title}.")
        expect(graph_group(page).get_by_role("button", name=node_name(title, 0, ", pinned"), exact=True)).to_be_focused()
        page.keyboard.press("p")
        expect(announcements(page)).to_contain_text(f"Unpinned {title}.")
        expect(btn).to_have_count(1)
        page.keyboard.press("Escape")
        advance(page, 50)
        view, models = view_and_models(page)
        pairs = label_pairs(page, view, models)
        gamma_title = objs["Gamma"]["title"]
        gamma = next(p for b, p in pairs if (b.get_attribute("aria-label") or b.inner_text()).startswith(gamma_title))
        page.mouse.move(gamma[0], gamma[1])
        page.mouse.down()
        page.mouse.move(gamma[0] + 40, gamma[1] + 20, steps=6)
        page.mouse.up()
        expect(announcements(page)).to_contain_text(f"Pinned {gamma_title}.")
        pinned = graph_group(page).get_by_role("button", name=node_name(gamma_title, 0, ", pinned"), exact=True)
        expect(pinned).to_be_focused()
        _, before = drawn_view_and_models(page)
        advance(page, 2000)
        _, after = view_and_models(page)
        assert any(all(abs(a - b) < 1e-6 for a, b in zip(m1[12:15], m2[12:15])) for m1 in before for m2 in after)
        view, models = view_and_models(page)
        pt = next(p for b, p in label_pairs(page, view, models) if (b.get_attribute("aria-label") or b.inner_text()).startswith(gamma_title))
        page.mouse.move(pt[0], pt[1])
        page.mouse.down()
        page.mouse.move(pt[0] + 10, pt[1], steps=3)
        page.keyboard.down("Alt")
        page.mouse.up()
        page.keyboard.up("Alt")
        expect(announcements(page)).to_contain_text(f"Unpinned {gamma_title}.")


TEXT_OPACITY_JS = r"""
b => { let best = 0; const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { if (!n.data.trim()) continue; let el = n.parentElement, o = 1;
    const m = getComputedStyle(el).color.match(/rgba?\(([^)]+)\)/); const parts = m ? m[1].split(/[ ,\/]+/).filter(Boolean) : [];
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    while (el) { o *= parseFloat(getComputedStyle(el).opacity); if (el === b) break; el = el.parentElement; }
    best = Math.max(best, o * alpha); }
  return best; }
"""


def test_graph_label_detail(browser, app_url):
    api = owner(app_url)
    ty, objs = graph_setup(api)
    with workspace(browser, app_url, f"/graph?type={ty['id']}", reduced_motion="reduce") as (page, _):
        open_graph(page, 3)
        alpha = graph_group(page).get_by_role("button", name=node_name(objs["Alpha"]["title"], 0), exact=True)
        alpha.focus()
        for _ in range(20):
            page.keyboard.press("-")
        advance(page, 50)
        view, models = view_and_models(page)
        box = canvas_box(page)
        for b, p in label_pairs(page, view, models):
            name = b.get_attribute("aria-label") or b.inner_text()
            s = next(m[0] for m in models if abs(project(view, [m[12], m[13], m[14]], box)[0] - p[0]) < 0.5)
            radius = s * (box["height"] / 2) / (math.tan(math.radians(22.5)) * p[2])
            visible = b.evaluate(TEXT_OPACITY_JS)
            if name.startswith(objs["Alpha"]["title"]) or radius >= LABEL_DETAIL_PX:
                assert visible > 0.99, (name, radius, visible)
            else:
                assert visible < 0.01, (name, radius, visible)
        page.keyboard.press("ArrowRight")
        expect(graph_group(page).get_by_role("button", name=node_name(objs["Beta"]["title"], 1), exact=True)).to_be_focused()


def test_saved_queries_api(app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Note", "text")])
    a = new_obj(api, ty["id"], f"Row A {tok()}")
    ablk = add_block(api, a["id"], "row passage")
    body = {"name": f"Query {tok()}", "type_id": ty["id"], "text": "", "group_by": None, "sort": [{"key": "@title", "dir": "asc"}]}
    q = api.ok("POST", "/api/queries", 201, json=body)
    assert {k: q[k] for k in body} == body
    assert q["id"] in [x["id"] for x in api.ok("GET", "/api/queries", 200)["queries"]]
    assert api.ok("GET", f"/api/queries/{q['id']}", 200)["text"] == ""
    rows = api.ok("GET", f"/api/queries/{q['id']}/results", 200)
    assert rows["groups"] is None and [r["id"] for r in rows["results"]] == [a["id"]]
    assert rows["results"][0]["backlinks"] == 0 and rows["results"][0]["type_name"] == ty["name"]
    quote(api, concept(api)["id"], ablk["id"])
    assert api.ok("GET", f"/api/queries/{q['id']}/results", 200)["results"][0]["backlinks"] == 1
    for bad, key, msg in (({"name": ""}, "name", "Give the query a name."), ({"type_id": str(uuid.uuid4())}, "type_id", "Choose a type.")):
        r = api.post("/api/queries", json={**body, **bad})
        assert r.status_code == 422 and r.json()["errors"][key] == msg
    assert api.delete(f"/api/queries/{q['id']}").status_code == 204
    assert api.get(f"/api/queries/{q['id']}").status_code == 404


def test_block_search_literal(app_url):
    api = owner(app_url)
    w = tok()
    obj = concept(api)
    b1 = add_block(api, obj["id"], f"Rate 100% sure_thing {w}")
    b2 = add_block(api, obj["id"], f"Rate 100X sureXthing {w}")
    b3 = add_block(api, obj["id"], f"<strong>bold</strong> {w} plain")
    b4 = add_block(api, obj["id"], f"back\\slash {w}")
    q = quote(api, concept(api)["id"], b1["id"])["block"]
    excl = concept(api)["id"]

    def ids(text: str) -> list[str]:
        start = time.monotonic()
        r = api.get("/api/blocks/search", params={"q": text, "exclude_object_id": excl})
        assert r.status_code == 200 and time.monotonic() - start < SEARCH_BUDGET_S
        return [x["block_id"] for x in r.json()["results"]]

    assert set(ids(w)) >= {b1["id"], b2["id"], b3["id"], b4["id"]}
    assert ids(w).count(b1["id"]) == 1 and q["id"] not in ids(w)
    assert set(ids(w.upper())) >= {b1["id"], b2["id"]}
    assert set(ids(f"  100% sure_thing {w} "))  == {b1["id"]}
    found = ids(f"e_thing {w}")
    assert b1["id"] in found and b2["id"] not in found
    assert b3["id"] not in ids("strong")
    assert b4["id"] in ids(f"\\slash {w}")
    r = api.get("/api/blocks/search", params={"q": "x", "exclude_object_id": obj["id"]})
    assert not {b1["id"], b2["id"]} & {x["block_id"] for x in r.json()["results"]}
    ids("%_" * (SEARCH_CAP // 2))
    r = api.get("/api/blocks/search", params={"q": "a" * (SEARCH_CAP + 1)})
    assert r.status_code == 422 and r.json()["errors"]["q"] == "Search with at most 200 characters."
    ty = new_type(api, [field("Note", "text")])
    hit = new_obj(api, ty["id"], props={"Note": "50% done"})
    new_obj(api, ty["id"], props={"Note": "50X done"})
    for text, expected in (('Note ~ "50%"', {hit["id"]}), ('Note ~ "0_ d"', set())):
        qid = api.ok("POST", "/api/queries", 201, json={"name": f"L {tok()}", "type_id": ty["id"], "text": text, "group_by": None,
                                                       "sort": [{"key": "@title", "dir": "asc"}]})["id"]
        start = time.monotonic()
        rows = api.ok("GET", f"/api/queries/{qid}/results", 200)["results"]
        assert time.monotonic() - start < SEARCH_BUDGET_S
        assert {r["id"] for r in rows} == expected, text


def test_wf_queries_search_saved_query_ui(browser, app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Kind", "select", options=["Book", "Article"])])
    a = new_obj(api, ty["id"], f"Book A {tok()}", {"Kind": "Book"})
    new_obj(api, ty["id"], f"Book B {tok()}", {"Kind": "Book"})
    ablk = add_block(api, a["id"], "booked words")
    name = f"Books {tok()}"
    with workspace(browser, app_url, "/queries") as (page, _):
        click(page.get_by_role("button", name="New query", exact=True))
        dlg = page.get_by_role("dialog", name="New query")
        fill(dlg.get_by_role("textbox", name="Query name", exact=True), name)
        select(dlg.get_by_role("combobox", name="Type", exact=True), ty["name"])
        box = dlg.get_by_role("textbox", name="Query", exact=True)
        fill(box, f'{MISSPELT_FIELD} = "Book" OR @backlinks >= 1')
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        column = 1
        within(page, lambda: expect(box).to_have_accessible_description(f"Unknown field {MISSPELT_FIELD} at column {column}.", timeout=200))
        fill(box, 'Kind = "Book" OR @backlinks >= 1')
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        within(page, lambda: expect(box).to_have_accessible_description("", timeout=200))
        select(dlg.get_by_role("combobox", name="Group by", exact=True), "Kind")
        first = 1
        select(dlg.get_by_role("combobox", name=f"Sort key {first}", exact=True), "Backlinks")
        select(dlg.get_by_role("combobox", name=f"Direction {first}", exact=True), "Descending")
        click(dlg.get_by_role("button", name="Save query", exact=True))
        link = page.get_by_role("list", name="Saved queries").get_by_role("link", name=name, exact=True)
        within(page, lambda: expect(link).to_be_visible(timeout=200))
        q = next(x for x in api.ok("GET", "/api/queries", 200)["queries"] if x["name"] == name)
        assert q["group_by"] == "Kind" and q["sort"][0] == {"key": "@backlinks", "dir": "desc"}
        mark_no_reload(page)
        click(link)
        within(page, lambda: expect(page).to_have_url(re.compile(f"/queries/{q['id']}$"), timeout=200))
        assert_no_reload(page)
        table = page.get_by_role("table", name="Query results")
        books = 2
        group_head = f"{KIND_BOOK} ({books})"
        expect(table).to_contain_text(group_head, timeout=UI_TIMEOUT_MS)
        page.reload()
        expect(page.get_by_role("table", name="Query results")).to_contain_text(group_head, timeout=UI_TIMEOUT_MS)
        mark_no_reload(page)
        quote(api, concept(api)["id"], ablk["id"])
        row = page.get_by_role("table", name="Query results").get_by_role("row").filter(has_text=a["title"])
        cells = row.get_by_role("cell").or_(row.get_by_role("rowheader"))
        within(page, lambda: expect(cells.nth(2)).to_have_text("1", timeout=100), seconds=LIVE_S)
        assert_no_reload(page)
        page.go_back()
        within(page, lambda: expect(page).to_have_url(re.compile(r"/queries$"), timeout=200))
    rows = api.ok("GET", f"/api/queries/{q['id']}/results", 200)
    assert rows["groups"][0]["label"] == "Book" and rows["groups"][0]["count"] == len(rows["groups"][0]["results"]) == 2


def test_query_results_reorder(browser, app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Note", "text")])
    a = new_obj(api, ty["id"], f"Ro a {tok()}")
    b = new_obj(api, ty["id"], f"Ro b {tok()}")
    bblk = add_block(api, b["id"], "reorder me")
    q = api.ok("POST", "/api/queries", 201, json={"name": f"R {tok()}", "type_id": ty["id"], "text": "", "group_by": None,
                                                 "sort": [{"key": "@backlinks", "dir": "desc"}]})
    with workspace(browser, app_url, f"/queries/{q['id']}") as (page, _):
        table = page.get_by_role("table", name="Query results")
        alink = table.get_by_role("link", name=a["title"], exact=True)
        expect(alink).to_be_visible(timeout=UI_TIMEOUT_MS)
        alink.focus()
        record(page)
        quote(api, concept(api)["id"], bblk["id"])
        within(page, lambda: expect(table.get_by_role("row").nth(1)).to_contain_text(b["title"], timeout=100), seconds=LIVE_S)
        advance(page, ROW_SLIDE_MS + 100)
        slides = [r for r in recorded(page) if r["target"].get("row") and near(r["duration"], ROW_SLIDE_MS)]
        assert slides, recorded(page)
        expect(alink).to_be_focused()
    obj = concept(api)
    b1 = add_block(api, obj["id"], "first")
    add_block(api, obj["id"], "second", after=b1["id"])
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        expect(block_box(page, 2)).to_be_visible(timeout=UI_TIMEOUT_MS)
        record(page)
        api.delete(f"/api/blocks/{b1['id']}")
        within(page, lambda: expect(block_box(page, 2)).to_have_count(0, timeout=100), seconds=LIVE_S)
        advance(page, GAP_MS + 100)
        assert [r for r in recorded(page) if near(r["duration"], GAP_MS)], recorded(page)


QUERY_ERRORS = [
    ("Kind = ", "Unexpected end of query at column 8."),
    ('Kindd = "Book"', "Unknown field Kindd at column 1."),
    ('Kind ~ "Book"', "~ does not fit Kind at column 6."),
    ('@title = "abc', "Unclosed string at column 10."),
    ('@title = "a\\"', "Unclosed string at column 10."),
    ("@updated > 2026-02-30", "Not a real date at column 12."),
    ('Kind = "Zine"', '"Zine" is not an option of Kind at column 8.'),
    ('Year = "1987"', 'Unexpected "1987" at column 8.'),
    ('Kind = = "Book"', "Unexpected = at column 8."),
    ("Year = 1 AND", "Unexpected end of query at column 13."),
    ("((((((((( Year = 1 )))))))))", "Too deeply nested at column 9."),
    ("NOT NOT NOT NOT NOT NOT NOT NOT NOT Year = 1", "Too deeply nested at column 33."),
    ("x" * (QUERY_CAP + 1), "Use at most 500 characters."),
]


def test_query_language(app_url):
    api = owner(app_url)
    source = type_named(api, "Source")
    for text, message in QUERY_ERRORS:
        r = api.post("/api/queries/check", json={"type_id": source["id"], "text": text})
        assert r.status_code == 422 and r.json()["errors"]["text"] == message, (text, r.text)
    for text in ('[Kind] = "Book" OR @backlinks >= 1', "  ", " " * QUERY_CAP, 'Author.Affiliation = "x"', "Author.@title != null"):
        assert api.ok("POST", "/api/queries/check", 200, json={"type_id": source["id"], "text": text}) == {"ok": True}, text
    ty = new_type(api, [field("Note", "text"), field("Count", "number"), field("Due", "date"), field("Stage", "select", options=["Draft", "Final"])])
    ty = add_field(api, ty["id"], field("Ref", "relation", target=ty["id"]))
    o1 = new_obj(api, ty["id"], "QL one", {"Note": "Alpha", "Count": 5, "Due": "2026-01-10", "Stage": "Draft"})
    o2 = new_obj(api, ty["id"], "QL two", {"Count": 1, "Stage": "Final", "Ref": o1["id"]})
    o3 = new_obj(api, ty["id"], "QL three", {"Note": "alpha beta", "Due": "2030-01-01", "Ref": o2["id"]})
    one, two, three = o1["id"], o2["id"], o3["id"]
    cases = {
        "Count > 2": {one}, "NOT Count > 2": {two, three}, "Count = null": {three}, "Count != null": {one, two},
        'Note = "ALPHA"': {one}, 'Note ~ "ALP"': {one, three}, 'Stage = "final"': {two}, 'Ref = "ql ONE"': {two},
        'Ref.@title = "QL two"': {three}, "Ref.Count >= 1": {two, three}, "Due < 2027-01-01": {one}, "Due > today": {three},
        "@updated = today": {one, two, three}, "@updated > today - 1d": {one, two, three},
        '(Count > 2 OR Stage = "Final") AND NOT Note = null': {one}, "@backlinks >= 1": {one, two}, "": {one, two, three},
        'count > 2 or stage = "Final"': {one, two},
    }
    for text, expected in cases.items():
        qid = api.ok("POST", "/api/queries", 201, json={"name": f"QL {tok()}", "type_id": ty["id"], "text": text, "group_by": None,
                                                       "sort": [{"key": "@title", "dir": "asc"}]})["id"]
        assert {r["id"] for r in api.ok("GET", f"/api/queries/{qid}/results", 200)["results"]} == expected, text


def test_query_group_sort(app_url):
    api = owner(app_url)
    ty = new_type(api, [field("Stage", "select", options=["Low", "High"]), field("Count", "number"), field("Note", "text")])
    g1 = new_obj(api, ty["id"], "Gs b", {"Stage": "High", "Count": 2})
    g2 = new_obj(api, ty["id"], "Gs a", {"Stage": "High", "Count": 2})
    g3 = new_obj(api, ty["id"], "Gs c", {"Stage": "Low", "Count": 9})
    g4 = new_obj(api, ty["id"], "Gs d")
    g5 = new_obj(api, ty["id"], "Gs e", {"Stage": "Low", "Count": 1})
    ids = lambda rows: [r["id"] for r in rows]

    def run(group: str | None, sort: list[dict]) -> dict:
        qid = api.ok("POST", "/api/queries", 201, json={"name": f"G {tok()}", "type_id": ty["id"], "text": "", "group_by": group, "sort": sort})["id"]
        return api.ok("GET", f"/api/queries/{qid}/results", 200)

    res = run("Stage", [{"key": "Count", "dir": "desc"}])
    assert ids(res["results"]) == [g3["id"], g2["id"], g1["id"], g5["id"], g4["id"]]
    assert [(g["label"], g["key"], g["count"], ids(g["results"])) for g in res["groups"]] == [
        ("High", "High", 2, [g2["id"], g1["id"]]), ("Low", "Low", 2, [g3["id"], g5["id"]]), ("No value", None, 1, [g4["id"]])]
    for g in res["groups"]:
        assert g["count"] == len(g["results"])
    res = run(None, [{"key": "Stage", "dir": "asc"}, {"key": "@title", "dir": "desc"}])
    assert ids(res["results"]) == [g5["id"], g3["id"], g1["id"], g2["id"], g4["id"]]
    res = run(None, [{"key": "Count", "dir": "asc"}])
    assert ids(res["results"]) == [g5["id"], g2["id"], g1["id"], g3["id"], g4["id"]]
    base = {"name": f"G {tok()}", "type_id": ty["id"], "text": "", "group_by": None, "sort": [{"key": "@title", "dir": "asc"}]}
    for patch, key, msg in (
        ({"group_by": "Count"}, "group_by", "Group by a select, relation, date or text field of this type."),
        ({"sort": []}, "sort", "Use one to three sort keys."),
        ({"sort": [{"key": "@title", "dir": "asc"}] * 4}, "sort", "Use one to three sort keys."),
        ({"sort": [{"key": "Nope", "dir": "asc"}]}, "sort.0.key", "That sort key is not on this type."),
        ({"sort": [{"key": "@title", "dir": "up"}]}, "sort.0.dir", "Use asc or desc."),
    ):
        r = api.post("/api/queries", json={**base, **patch})
        assert r.status_code == 422 and r.json()["errors"][key] == msg


def test_note_search_ranking(app_url):
    api = owner(app_url)

    def search(q: str) -> list[dict]:
        r = api.get("/api/search", params={"q": q})
        assert r.status_code == 200
        return r.json()["results"]

    word = "zr" + uuid.uuid4().hex[:8].replace("0", "k")
    x = concept(api, f"Ranker {word}")
    exact = next(r for r in search(word) if r["object_id"] == x["id"])
    typo = word[:3] + ("a" if word[3] != "a" else "b") + word[4:]
    fuzzy = next(r for r in search(typo) if r["object_id"] == x["id"])
    assert abs(fuzzy["score"] - exact["score"] / 2) <= 0.0002
    swapped = word[:2] + word[3] + word[2] + word[4:]
    if word[2] != word[3]:
        assert x["id"] not in [r["object_id"] for r in search(swapped)]
    v = "zv" + uuid.uuid4().hex[:8].replace("0", "m")
    titled = concept(api, f"Heading {v}")
    bodied = concept(api, f"Plain {uuid.uuid4().hex[:6]}")
    text = "a " * 30 + v + " " + "b " * 40
    add_block(api, bodied["id"], text)
    res = [r for r in search(v) if r["object_id"] in (titled["id"], bodied["id"])]
    assert [r["object_id"] for r in res] == [titled["id"], bodied["id"]]
    assert "".join(s["text"] for s in res[0]["snippet"]) == titled["title"]
    assert [s["text"] for s in res[0]["snippet"] if s["match"]] == [v]
    plain = text.strip()
    pos = plain.index(v)
    assert "".join(s["text"] for s in res[1]["snippet"]) == plain[pos - 20: pos + 60]
    assert [s["text"] for s in res[1]["snippet"] if s["match"]] == [v]
    u = "zt" + uuid.uuid4().hex[:8].replace("0", "n")
    beta = concept(api, f"Tie beta {u}")
    alpha = concept(api, f"Tie alpha {u}")
    order = [r["object_id"] for r in search(u) if r["object_id"] in (alpha["id"], beta["id"])]
    assert order == [alpha["id"], beta["id"]]
    assert search("") == []
    r = api.get("/api/search", params={"q": "a" * (SEARCH_CAP + 1)})
    assert r.status_code == 422 and r.json()["errors"]["q"] == "Search with at most 200 characters."


def command_score(cmd: str, query_text: str) -> int | None:
    chars = [c for c in query_text.lower() if c != " "]
    low, pos, prev, score = cmd.lower(), -1, -2, 0
    for ch in chars:
        i = low.find(ch, pos + 1)
        if i < 0:
            return None
        score += 1 + (2 if i == 0 or cmd[i - 1] == " " else 0) + (1 if i == prev + 1 else 0)
        prev = pos = i
    return score


def expected_commands(theme: str, query_text: str) -> list[str]:
    cmds = [("Switch to Paper" if theme == "lamplight" and c == "Switch to Lamplight" else c) for c in COMMANDS]
    scored = [(command_score(c, query_text), i, c) for i, c in enumerate(cmds)]
    return [c for s, i, c in sorted((x for x in scored if x[0] is not None), key=lambda x: (-x[0], x[1]))]


def test_wf_queries_search_palette(browser, app_url):
    api = owner(app_url)
    theme = api.ok("GET", "/api/settings", 200)["theme"]
    t = tok()
    heron, egret = t + "heron", t + "egret"
    n1 = concept(api, f"Palette {heron}")
    n2 = concept(api, f"Palette {egret}")
    add_block(api, n1["id"], "palette host")
    pending: list = []

    def handler(route):
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
        if q == heron and not pending:
            pending.append(route)
            return
        route.fallback()

    with workspace(browser, app_url, f"/o/{n1['id']}") as (page, _):
        page.route("**/api/search*", handler)
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.focus()
        page.keyboard.press("Control+k")
        dlg = page.get_by_role("dialog", name="Command palette")
        search = dlg.get_by_role("combobox", name="Search Quire")
        expect(search).to_be_focused()
        assert search.input_value() == ""
        status = page.get_by_role("status", name="Palette status")
        cmds = dlg.get_by_role("group", name="Commands").get_by_role("option")
        expect(cmds).to_have_count(7)
        expect(status).to_have_text(f"{plural(len(COMMANDS), 'command')}, {plural(0, 'note')}")
        page.keyboard.type("op")
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        want = expected_commands(theme, "op")
        within(page, lambda: expect(cmds).to_have_text(want, timeout=200))
        fill(search, heron)
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        assert poll(lambda: bool(pending), 5, interval=0.05)
        fill(search, egret)
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        notes = dlg.get_by_role("group", name="Notes").get_by_role("option")
        target = dlg.get_by_role("option", name=f"{n2['title']}, Concept", exact=True)
        within(page, lambda: expect(target).to_be_visible(timeout=200))
        c = len(expected_commands(theme, egret))
        expect(status).to_have_text(f"{plural(c, 'command')}, {plural(1, 'note')}")
        with page.expect_response(lambda r: "/api/search" in r.url and heron in r.url):
            pending[0].fallback()
        advance(page, 100)
        expect(notes).to_have_count(1)
        expect(dlg.get_by_role("option", name=f"{n1['title']}, Concept", exact=True)).to_have_count(0)
        for _ in range(c):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        within(page, lambda: expect(page).to_have_url(re.compile(f"/o/{n2['id']}$"), timeout=200))
        expect(page.get_by_role("dialog", name="Command palette")).to_have_count(0)
        page.goto(f"{app_url}/o/{n1['id']}")
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.focus()
        page.keyboard.press("Control+k")
        page.keyboard.press("Escape")
        expect(box).to_be_focused()
        page.keyboard.press("Control+k")
        page.keyboard.type("go to")
        advance(page, SEARCH_DEBOUNCE_MS + 50)
        page.keyboard.press("Enter")
        within(page, lambda: expect(page).to_have_url(re.compile(r"/today$"), timeout=200))
    assert api.ok("GET", "/api/search", 200, params={"q": egret})["results"][0]["object_id"] == n2["id"]


def board_setup(api: Api) -> tuple[dict, list[dict], str]:
    t = tok()
    ty = new_type(api, name=f"Card{t}")
    ty = add_field(api, ty["id"], field("Link", "relation", target=ty["id"]))
    objs = [new_obj(api, ty["id"], f"Card {c} {t}") for c in "ABC"]
    api.ok("PATCH", f"/api/objects/{objs[0]['id']}", 200, json={"properties": {"Link": objs[1]["id"]}})
    col = new_collection(api, [o["id"] for o in objs])
    return col, objs, t


def board_transform(page: Page) -> str | None:
    return page.evaluate("() => { const v = document.querySelector('[data-board-viewport]'); return v && v.getAttribute('data-board-transform'); }")


def lasso_count(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('[data-board-lasso]').length")


def card_rect(page: Page, oid: str) -> dict:
    return page.evaluate(
        "id => { const r = document.querySelector(`[data-board-card='${id}']`).getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }",
        oid)


def card_button(page: Page, title: str, x: int, y: int, selected: bool = False):
    return page.get_by_role("list", name="Board cards").get_by_role(
        "button", name=f"{title}, x {x}, y {y}{', selected' if selected else ''}", exact=True)


def board_pos(api: Api, col_id: str, oid: str) -> tuple[int, int, bool]:
    c = next(c for c in api.ok("GET", f"/api/collections/{col_id}/board", 200)["cards"] if c["object_id"] == oid)
    return c["x"], c["y"], c["stored"]


def fmt_transform(z: float, tx: float, ty: float) -> str:
    return ",".join(("0.0000" if abs(v) < 5e-5 else f"{v:.4f}") for v in (z, tx, ty))


def test_board_view_transform(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    assert [board_pos(api, col["id"], o["id"]) for o in objs] == [(16, 16, False), (272, 16, False), (528, 16, False)]
    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        within(page, lambda: _assert_eq(board_transform(page), fmt_transform(1, 0, 0)))
        g = page.get_by_role("group", name="Board").bounding_box()
        sx, sy = g["x"] + 700, g["y"] + 400
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx + 30, sy + 20, steps=5)
        page.mouse.up()
        advance(page, 32)
        z, tx, ty = 1.0, 30.0, 20.0
        within(page, lambda: _assert_eq(board_transform(page), fmt_transform(z, tx, ty)))
        scroll = page.evaluate("() => scrollY")
        px, py = 500.0, 300.0
        page.mouse.move(g["x"] + px, g["y"] + py)
        for delta in (-400, -1200, 3000):
            page.mouse.wheel(0, delta)
            advance(page, 32)
            z2 = max(0.25, min(4.0, z * 2 ** (-delta / 400)))
            tx, ty = px - (px - tx) * z2 / z, py - (py - ty) * z2 / z
            z = z2
            within(page, lambda: _assert_eq(board_transform(page), fmt_transform(z, tx, ty)))
        assert z == 0.25
        assert page.evaluate("() => scrollY") == scroll


def test_wf_board_keyboard_nudge(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    a = objs[0]["title"]
    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        btn = card_button(page, a, 16, 16)
        expect(btn).to_be_visible(timeout=UI_TIMEOUT_MS)
        btn.focus()
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("ArrowDown")
        moved = card_button(page, a, 56, 24)
        expect(moved).to_be_focused()
        advance(page, BOARD_SAVE_MS - 100)
        assert board_pos(api, col["id"], objs[0]["id"]) == (16, 16, False)
        advance(page, 200)
        nx, ny = 16 + 40, 16 + 8
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Moved {a} to x {nx}, y {ny}.", timeout=200))
        assert board_pos(api, col["id"], objs[0]["id"]) == (56, 24, True)
        page.keyboard.press("Control+a")
        expect(card_button(page, a, 56, 24, selected=True)).to_be_focused()
        page.keyboard.press("ArrowRight")
        advance(page, BOARD_SAVE_MS + 100)
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Moved {plural(len(objs), 'card')}.", timeout=200))
    assert [board_pos(api, col["id"], o["id"])[:2] for o in objs] == [(64, 24), (280, 16), (536, 16)]


def test_board_pointer_moves(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        expect(card_button(page, objs[0]["title"], 16, 16)).to_be_visible(timeout=UI_TIMEOUT_MS)
        g = page.get_by_role("group", name="Board").bounding_box()
        page.keyboard.down("Shift")
        page.mouse.move(g["x"] + 4, g["y"] + 300)
        page.mouse.down()
        page.mouse.move(g["x"] + 500, g["y"] + 100, steps=6)
        assert lasso_count(page) == 1
        page.mouse.up()
        page.keyboard.up("Shift")
        within(page, lambda: _assert_eq(lasso_count(page), 0))
        expect(card_button(page, objs[0]["title"], 16, 16, True)).to_be_visible()
        expect(card_button(page, objs[1]["title"], 272, 16, True)).to_be_visible()
        expect(card_button(page, objs[2]["title"], 528, 16)).to_be_visible()
        saves: list[str] = []
        page.on("request", lambda r: saves.append(r.method) if r.url.endswith(f"/collections/{col['id']}/board") and r.method == "PUT" else None)
        card = card_rect(page, objs[0]["id"])
        cx, cy = card["x"] + 120, card["y"] + 80
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 13, cy, steps=5)
        page.mouse.up()
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Moved {plural(2, 'card')}.", timeout=200))
        assert saves == ["PUT"]
    assert board_pos(api, col["id"], objs[0]["id"])[:2] == (32, 16)
    assert board_pos(api, col["id"], objs[1]["id"])[:2] == (288, 16)
    assert board_pos(api, col["id"], objs[2]["id"])[2] is False


def test_wf_board_refused(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)

    def refuse(route):
        if route.request.method == "PUT":
            route.abort()
        else:
            route.fallback()

    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        btn = card_button(page, objs[2]["title"], 528, 16)
        expect(btn).to_be_visible(timeout=UI_TIMEOUT_MS)
        page.route(f"**/api/collections/{col['id']}/board", refuse)
        btn.focus()
        page.keyboard.press("Shift+ArrowDown")
        expect(card_button(page, objs[2]["title"], 528, 56)).to_be_focused()
        advance(page, BOARD_SAVE_MS + 50)
        within(page, lambda: expect(alert_with(page, COPY_BOARD_REFUSED)).to_be_visible(timeout=200))
        advance(page, 400)
        expect(card_button(page, objs[2]["title"], 528, 16)).to_be_visible()
        expect(announcements(page)).not_to_contain_text("Moved")
    assert board_pos(api, col["id"], objs[2]["id"]) == (528, 16, False)


ARROW_COUNT_JS = "id => document.querySelectorAll(`[data-board-arrow='${id}']`).length"
ARROW_JS = r"""
id => { const el = document.querySelector(`[data-board-arrow='${id}']`); const g = (el.getTotalLength ? el : el.querySelector('line,path,polyline'));
  if (g.tagName.toLowerCase() === 'line') return [g.x1.baseVal.value, g.y1.baseVal.value, g.x2.baseVal.value, g.y2.baseVal.value];
  const L = g.getTotalLength(), a = g.getPointAtLength(0), b = g.getPointAtLength(L); return [a.x, a.y, b.x, b.y]; }
"""


def arrow_ends(a: tuple[int, int], b: tuple[int, int]) -> list[float]:
    def mids(x: int, y: int) -> list[tuple[int, int]]:
        return [(x + 120, y), (x + 240, y + 80), (x + 120, y + 160), (x, y + 80)]

    best = min(((math.dist(p, q), i, j, p, q) for i, p in enumerate(mids(*a)) for j, q in enumerate(mids(*b))), key=lambda t: (t[0], t[1], t[2]))
    return [*best[3], *best[4]]


def test_board_arrows(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    edge = api.ok("GET", f"/api/collections/{col['id']}/board", 200)["edges"][0]
    assert edge["from"] == objs[0]["id"] and edge["to"] == objs[1]["id"]
    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        within(page, lambda: _assert_eq(page.evaluate(ARROW_COUNT_JS, edge["id"]), 1))
        got = page.evaluate(ARROW_JS, edge["id"])
        assert all(abs(g - e) <= 0.5 for g, e in zip(got, arrow_ends((16, 16), (272, 16)))), got
        card = card_rect(page, objs[1]["id"])
        cx, cy = card["x"] + 120, card["y"] + 80
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx - 100, cy + 300, steps=8)
        advance(page, 16)
        x = BOARD_GRID * math.floor((272 - 100) / BOARD_GRID + 0.5)
        y = BOARD_GRID * math.floor((16 + 300) / BOARD_GRID + 0.5)
        got = page.evaluate(ARROW_JS, edge["id"])
        assert all(abs(g - e) <= 0.5 for g, e in zip(got, arrow_ends((16, 16), (x, y)))), (got, x, y)
        page.mouse.up()


def test_wf_board_live(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    with workspace(browser, app_url, f"/collections/{col['id']}/board") as (page, _):
        focus = card_button(page, objs[2]["title"], 528, 16)
        expect(focus).to_be_visible(timeout=UI_TIMEOUT_MS)
        focus.focus()
        record(page)
        api.ok("PUT", f"/api/collections/{col['id']}/board", 200, json={"positions": [{"object_id": objs[0]["id"], "x": 400, "y": 400}]})
        within(page, lambda: expect(card_button(page, objs[0]["title"], 400, 400)).to_have_count(1, timeout=100), seconds=LIVE_S)
        advance(page, BOARD_SLIDE_MS + 100)
        slides = [r for r in recorded(page) if r["target"].get("data-board-card") == objs[0]["id"] and near(r["duration"], BOARD_SLIDE_MS)]
        assert slides, recorded(page)
        expect(focus).to_be_focused()
    assert board_pos(api, col["id"], objs[0]["id"]) == (400, 400, True)


CARD_TITLE_JS = r"""
([id, title]) => { const c = document.querySelector(`[data-board-card='${id}']`); const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (n.data.trim() === title) { const r = n.parentElement.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }
  return null; }
"""


def test_wf_board_title_transition(browser, app_url):
    api = owner(app_url)
    col, objs, _ = board_setup(api)
    a = objs[0]
    for mode, duration in (("no-preference", TITLE_MS), ("reduce", FADE_MS)):
        with workspace(browser, app_url, f"/collections/{col['id']}/board", reduced_motion=mode) as (page, _):
            btn = card_button(page, a["title"], 16, 16)
            expect(btn).to_be_visible(timeout=UI_TIMEOUT_MS)
            title_box = page.evaluate(CARD_TITLE_JS, [a["id"], a["title"]])
            record(page)
            page.evaluate("() => { window.__quireHold = el => el.tagName === 'H1' || el.getAttribute('aria-level') === '1'; }")
            btn.focus()
            page.keyboard.press("Enter")
            within(page, lambda: expect(page).to_have_url(re.compile(f"/o/{a['id']}$"), timeout=200))
            anims = [r for r in recorded(page) if r["target"].get("h1")]
            assert anims and near(anims[0]["duration"], duration), recorded(page)
            if mode == "no-preference":
                seek(page, anims[0]["i"], 0)
                h1 = page.get_by_role("heading", level=1, name=a["title"]).bounding_box()
                assert abs(h1["x"] - title_box["x"]) <= 2 and abs(h1["y"] - title_box["y"]) <= 2
                assert abs(h1["width"] - title_box["width"]) <= 2
    assert get_obj(api, a["id"])["title"] == a["title"]


def share_setup(api: Api) -> dict:
    t = tok()
    person = new_obj(api, type_named(api, "Person")["id"], f"Outside Person {t}")
    a = new_obj(api, type_named(api, "Source")["id"], f"Inside Source {t}", {"Author": person["id"], "Year": YEAR_PROBE})
    a_block = add_block(api, a["id"], f"inside passage {t}")
    e = concept(api, f"Outside Concept {t}")
    e_block = add_block(api, e["id"], f"secret outside {t}x")
    d = concept(api, f"Inside Concept {t}")
    add_block(api, d["id"], f"own words {t}")
    quote(api, d["id"], e_block["id"])
    quote(api, d["id"], a_block["id"])
    never = concept(api, f"Never Concept {t}")
    add_block(api, never["id"], f"never shared {t}")
    api.ok("PATCH", f"/api/objects/{never['id']}", 200, json={"share_visibility": "never"})
    col = new_collection(api, [a["id"], d["id"], never["id"]])
    link = new_link(api, col["id"])
    return {"t": t, "person": person, "a": a, "a_block": a_block, "e": e, "d": d, "never": never, "col": col, "link": link, "token": token_of(link)}


def share_client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def test_share_scope(app_url):
    api = owner(app_url)
    s = share_setup(api)
    sc = share_client(app_url)
    tk = s["token"]
    col = sc.get(f"/s/{tk}/api/collection").json()
    assert col["status"] == "active" and col["collection"]["name"] == s["col"]["name"]
    assert {o["id"] for o in col["objects"]} == {s["a"]["id"], s["d"]["id"]}
    outsider = concept(api)
    quote(api, outsider["id"], s["a_block"]["id"])
    ra = sc.get(f"/s/{tk}/api/objects/{s['a']['id']}")
    a = ra.json()
    assert a["properties"].get("Year") == YEAR_PROBE and a["properties"].get("Author") is None
    assert s["person"]["id"] not in ra.text and s["person"]["title"] not in ra.text and outsider["title"] not in ra.text
    assert [b["from_object_id"] for b in a["backlinks"]] == [s["d"]["id"]]
    rd = sc.get(f"/s/{tk}/api/objects/{s['d']['id']}")
    quotes = [b for b in rd.json()["blocks"] if b.get("kind") == "quote"]
    assert {"kind": "quote", "hidden": True} in quotes
    assert any(f"inside passage {s['t']}" in (b.get("body") or "") for b in quotes)
    assert f"secret outside {s['t']}x" not in rd.text and s["e"]["title"] not in rd.text
    for oid in (s["never"]["id"], s["e"]["id"], str(uuid.uuid4())):
        r = sc.get(f"/s/{tk}/api/objects/{oid}")
        assert r.status_code == 404 and r.json() == {"error": "not_in_share"}
    out_att = upload(api, s["e"]["id"], "out.png", PNG, "image/png").json()["attachment"]
    in_att = upload(api, s["a"]["id"], "in.png", PNG, "image/png").json()["attachment"]
    assert sc.get(f"/s/{tk}/api/attachments/{out_att['id']}").status_code == 404
    assert sc.get(f"/s/{tk}/api/attachments/{in_att['id']}").content == PNG
    graph = api.ok("GET", "/api/graph", 200, params={"share_link_id": s["link"]["id"]})
    flags = {n["id"]: n["in_scope"] for n in graph["nodes"]}
    assert flags[s["a"]["id"]] and flags[s["d"]["id"]]
    assert not flags[s["never"]["id"]] and not flags[s["e"]["id"]] and not flags[s["person"]["id"]]
    r = api.get("/api/graph", params={"share_link_id": str(uuid.uuid4())})
    assert r.status_code == 422 and r.json()["errors"]["share_link_id"] == "Choose an active share link."
    api.ok("PATCH", f"/api/objects/{s['d']['id']}", 200, json={"share_visibility": "never"})
    assert {o["id"] for o in sc.get(f"/s/{tk}/api/collection").json()["objects"]} == {s["a"]["id"]}
    assert sc.get(f"/s/{tk}/api/objects/{s['a']['id']}").json()["backlinks"] == []
    assert api.delete(f"/api/collections/{s['col']['id']}/objects/{s['a']['id']}").status_code == 204
    assert sc.get(f"/s/{tk}/api/collection").json()["objects"] == []
    assert api.delete(f"/api/collections/{s['col']['id']}/objects/{s['a']['id']}").status_code == 404
    assert api.post(f"/api/collections/{s['col']['id']}/objects", json={"object_id": s["e"]["id"]}).status_code == 204
    assert api.post(f"/api/collections/{s['col']['id']}/objects", json={"object_id": s["e"]["id"]}).status_code == 204
    r = api.post(f"/api/collections/{s['col']['id']}/objects", json={"object_id": str(uuid.uuid4())})
    assert r.status_code == 422 and r.json()["errors"]["object_id"] == "That note no longer exists."
    for name, msg in (("", "Give the collection a name."), (s["col"]["name"], "A collection with this name already exists.")):
        r = api.post("/api/collections", json={"name": name})
        assert r.status_code == 422 and r.json()["errors"]["name"] == msg


def test_never_share_override(app_url):
    api = owner(app_url)
    obj = concept(api, f"Private {tok()}")
    keep = concept(api, f"Open {tok()}")
    c1 = new_collection(api, [obj["id"], keep["id"]])
    c2 = new_collection(api, [obj["id"]])
    tokens = [token_of(new_link(api, c1["id"])), token_of(new_link(api, c2["id"]))]
    sc = share_client(app_url)

    def shared(tk: str) -> set[str]:
        return {o["id"] for o in sc.get(f"/s/{tk}/api/collection").json()["objects"]}

    assert obj["id"] in shared(tokens[0]) and obj["id"] in shared(tokens[1])
    api.ok("PATCH", f"/api/objects/{obj['id']}", 200, json={"share_visibility": "never"})
    for tk in tokens:
        assert obj["id"] not in shared(tk)
        r = sc.get(f"/s/{tk}/api/objects/{obj['id']}")
        assert r.status_code == 404 and r.json() == {"error": "not_in_share"}
    assert keep["id"] in shared(tokens[0])
    after = get_obj(api, obj["id"])
    assert after["share_visibility"] == "never" and {c1["id"], c2["id"]} <= set(after["collection_ids"])
    api.ok("PATCH", f"/api/objects/{obj['id']}", 200, json={"share_visibility": "follow"})
    for tk in tokens:
        assert obj["id"] in shared(tk)
        assert sc.get(f"/s/{tk}/api/objects/{obj['id']}").status_code == 200


def find_gap(kind: str, start: datetime) -> tuple[str, str] | None:
    for zone in ("Europe/London", "America/New_York", "Pacific/Auckland", "America/Santiago", "Australia/Sydney", "Africa/Cairo",
                 "Asia/Beirut", "America/Asuncion", "America/Havana", "Antarctica/Troll"):
        z = ZoneInfo(zone)
        t = start + timedelta(hours=2)
        while t < start + timedelta(days=SHARE_MAX_DAYS - 1):
            before, after = t.astimezone(z).utcoffset(), (t + timedelta(hours=1)).astimezone(z).utcoffset()
            if before != after and ((after > before) == (kind == "gap")):
                lo = t
                while lo.astimezone(z).utcoffset() == before:
                    lo += timedelta(minutes=1)
                local = (lo - timedelta(minutes=1)).astimezone(z) + timedelta(minutes=1)
                if kind == "gap":
                    naive = (lo - timedelta(minutes=1)).astimezone(z).replace(tzinfo=None) + timedelta(minutes=1)
                    return zone, (naive + timedelta(minutes=30) if (after - before) >= timedelta(hours=1) else naive + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M")
                return zone, (lo.astimezone(z).replace(tzinfo=None) - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M")
            t += timedelta(hours=1)
    return None


def test_share_link_create(app_url):
    api = owner(app_url)
    col = new_collection(api, [concept(api)["id"]])
    zone = home_zone(api)
    exp = local_minute(api, timedelta(days=3))
    link = api.ok("POST", f"/api/collections/{col['id']}/share-links", 201, json={"expires_at": exp})
    expected_utc = datetime.strptime(exp, "%Y-%m-%dT%H:%M").replace(tzinfo=ZoneInfo(zone)).astimezone(timezone.utc)
    assert link["status"] == "active" and link["expires_at"] == exp and link["time_zone"] == zone
    assert utc(link["expires_at_utc"]) == expected_utc
    assert link["expires_at_display"] == expires_display(expected_utc, zone)
    assert re.fullmatch(r"/s/[A-Za-z0-9_-]{22,}", link["url"]) and link["revoked_at"] is None
    for value, msg in (("tomorrow", "Use a date and time."), (local_minute(api, timedelta(0)), "Choose a time after the current minute."),
                       (local_minute(api, timedelta(days=SHARE_MAX_DAYS, minutes=2)), "Links can last at most 90 days.")):
        r = api.post(f"/api/collections/{col['id']}/share-links", json={"expires_at": value})
        assert r.status_code == 422 and r.json()["errors"]["expires_at"] == msg, value
    assert api.post(f"/api/collections/{col['id']}/share-links", json={"expires_at": local_minute(api, timedelta(days=SHARE_MAX_DAYS))}).status_code == 201
    now = server_now(api)
    gap = find_gap("gap", now)
    if gap:
        with home_clock(api, gap[0]):
            r = api.post(f"/api/collections/{col['id']}/share-links", json={"expires_at": gap[1]})
            assert r.status_code == 422 and r.json()["errors"]["expires_at"] == "That time does not exist in your home clock."
    overlap = find_gap("overlap", now)
    if overlap:
        with home_clock(api, overlap[0]):
            made = api.ok("POST", f"/api/collections/{col['id']}/share-links", 201, json={"expires_at": overlap[1]})
            first = datetime.strptime(overlap[1], "%Y-%m-%dT%H:%M").replace(tzinfo=ZoneInfo(overlap[0]), fold=0)
            assert utc(made["expires_at_utc"]) == first.astimezone(timezone.utc)


def test_wf_collections_sharing_create_link(browser, app_url):
    api = owner(app_url)
    col = new_collection(api, [concept(api)["id"]])
    exp = local_minute(api, timedelta(days=4))
    zone = home_zone(api)
    display = expires_display(datetime.strptime(exp, "%Y-%m-%dT%H:%M").replace(tzinfo=ZoneInfo(zone)), zone)
    with workspace(browser, app_url, f"/collections/{col['id']}") as (page, _):
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        click(page.get_by_role("button", name="Share collection", exact=True))
        dlg = page.get_by_role("dialog", name="Share collection")
        fill(dlg.get_by_label("Link expires (home clock)", exact=True), exp)
        click(dlg.get_by_role("button", name="Create link", exact=True))
        within(page, lambda: expect(announcements(page)).to_contain_text(f"Link created. It stops working at {display}.", timeout=200))
        links = page.get_by_role("list", name="Share links")
        item = links.get_by_role("listitem").filter(has_text=f"Expires {display}")
        expect(item).to_contain_text("Active")
        link = api.ok("GET", f"/api/collections/{col['id']}/share-links", 200)["share_links"][0]
        assert link["expires_at"] == exp
        click(item.get_by_role("button", name="Copy link", exact=True))
        assert page.evaluate("() => navigator.clipboard.readText()") == app_url + link["url"]
        click(item.get_by_role("button", name="Revoke link", exact=True))
        click(page.get_by_role("alertdialog", name="Revoke this link?").get_by_role("button", name="Revoke", exact=True))
        within(page, lambda: expect(announcements(page)).to_contain_text(COPY_LINK_REVOKED, timeout=200))
        within(page, lambda: expect(links.get_by_role("listitem").filter(has_text=f"Expires {display}")).to_contain_text("Revoked", timeout=200))
    assert api.ok("GET", f"/api/collections/{col['id']}/share-links", 200)["share_links"][0]["status"] == "revoked"


def test_wf_collections_sharing_scope_graph(browser, app_url):
    api = owner(app_url)
    s = share_setup(api)
    label = f"{s['col']['name']}, until {s['link']['expires_at_display']}"
    never_name = node_name(s["never"]["title"], 0)
    with workspace(browser, app_url, "/graph", reduced_motion="reduce") as (page, _):
        expect(graph_group(page)).to_be_visible(timeout=UI_TIMEOUT_MS)
        scope = page.get_by_role("combobox", name="Share scope")
        select(scope, label)
        out_btn = graph_group(page).get_by_role("button", name=never_name + ", not shared", exact=True)
        within(page, lambda: expect(out_btn).to_be_visible(timeout=200))
        expect(out_btn).to_contain_text("· not shared")
        expect(graph_group(page).get_by_role("button", name=node_name(s["a"]["title"], backlinks(api, s["a"]["id"])), exact=True)).to_be_visible()
        api.ok("POST", f"/api/share-links/{s['link']['id']}/revoke", 200)
        within(page, lambda: expect(alert_with(page, COPY_SCOPE_GONE)).to_be_visible(timeout=200), step_ms=250)
        expect(graph_group(page).get_by_role("button", name=never_name, exact=True)).to_be_visible()
        assert combo_label(scope) == "None"
    assert api.get("/api/graph", params={"share_link_id": s["link"]["id"]}).status_code == 422


def test_wf_collections_sharing_allowlist(browser, app_url):
    api = owner(app_url)
    obj = concept(api, f"Shared markup {tok()}")
    add_block(api, obj["id"], DIRTY_HTML)
    hidden = concept(api, f"Hidden chapter {tok()}")
    api.ok("PATCH", f"/api/objects/{hidden['id']}", 200, json={"share_visibility": "never"})
    col = new_collection(api, [obj["id"], hidden["id"]])
    tk = token_of(new_link(api, col["id"]))
    sc = share_client(app_url)
    body = sc.get(f"/s/{tk}/api/objects/{obj['id']}").json()
    assert body["blocks"][0]["body"] == CLEAN_HTML
    assert {o["id"] for o in sc.get(f"/s/{tk}/api/collection").json()["objects"]} == {obj["id"]}
    with open_app(browser, f"{app_url}/s/{tk}/o/{obj['id']}") as page:
        expect(page.get_by_role("heading", level=1, name=obj["title"])).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert_allowlisted_dom(page)
        page.goto(f"{app_url}/s/{tk}")
        shared = page.get_by_role("list", name="Shared notes")
        expect(shared.get_by_role("link", name=obj["title"], exact=True)).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(shared.get_by_role("link", name=hidden["title"], exact=True)).to_have_count(0)
        assert hidden["title"] not in body_text(page)


def test_share_expiry_server(app_url):
    api = owner(app_url)
    col = new_collection(api, [concept(api)["id"]])
    zone = home_zone(api)
    local = server_now(api).astimezone(ZoneInfo(zone))
    nxt = (local + timedelta(minutes=1)).replace(second=0, microsecond=0)
    if (nxt - local).total_seconds() < 8:
        nxt += timedelta(minutes=1)
    link = api.ok("POST", f"/api/collections/{col['id']}/share-links", 201, json={"expires_at": nxt.strftime("%Y-%m-%dT%H:%M")})
    exp = utc(link["expires_at_utc"])
    assert exp == nxt.astimezone(timezone.utc)
    sc = share_client(app_url)
    tk = token_of(link)
    samples: list[tuple[datetime, str]] = []

    def step() -> bool:
        r = sc.get(f"/s/{tk}/api/status")
        d = parsedate_to_datetime(r.headers["date"])
        samples.append((d, r.json()["status"]))
        return d >= exp + timedelta(seconds=1) and r.json()["status"] == "expired"

    assert poll(step, EXPIRY_WAIT_S, interval=0.5)
    for d, st in samples:
        if d <= exp - timedelta(seconds=1):
            assert st == "active", (d, st)
        if d >= exp:
            assert st == "expired", (d, st)
    assert any(st == "active" for _, st in samples)
    r = sc.get(f"/s/{tk}/api/collection")
    assert r.status_code == 410 and r.json() == {"status": "expired"}
    for action in ("revoke", "regenerate"):
        r = api.post(f"/api/share-links/{link['id']}/{action}")
        assert r.status_code == 409 and r.json() == {"error": "link_not_active", "status": "expired"}


def test_share_revoke_regenerate(app_url):
    api = owner(app_url)
    col = new_collection(api, [concept(api)["id"]])
    sc = share_client(app_url)
    l1 = new_link(api, col["id"])
    r = api.ok("POST", f"/api/share-links/{l1['id']}/revoke", 200)
    assert r["status"] == "revoked" and r["revoked_at"]
    assert sc.get(f"/s/{token_of(l1)}/api/collection").json() == {"status": "revoked"}
    assert sc.get(f"/s/{token_of(l1)}/api/status").json()["status"] == "revoked"
    for action in ("revoke", "regenerate"):
        r = api.post(f"/api/share-links/{l1['id']}/{action}")
        assert r.status_code == 409 and r.json() == {"error": "link_not_active", "status": "revoked"}
    l2 = new_link(api, col["id"])
    r = api.post(f"/api/share-links/{l2['id']}/regenerate")
    assert r.status_code == 201
    l3 = r.json()
    assert l3["id"] != l2["id"] and l3["url"] != l2["url"] and l3["status"] == "active" and l3["expires_at_utc"] == l2["expires_at_utc"]
    assert sc.get(f"/s/{token_of(l2)}/api/collection").status_code == 410
    assert sc.get(f"/s/{token_of(l3)}/api/collection").status_code == 200
    listed = api.ok("GET", f"/api/collections/{col['id']}/share-links", 200)["share_links"]
    assert listed[0]["id"] == l3["id"]
    unknown = "unknown" + uuid.uuid4().hex
    for path in (f"/s/{unknown}/api/status", f"/s/{unknown}/api/collection"):
        r = sc.get(path)
        assert r.status_code == 404 and r.json() == {"status": "unknown"}
    col2 = new_collection(api, [concept(api)["id"]])
    l4 = new_link(api, col2["id"])
    assert api.delete(f"/api/collections/{col2['id']}").status_code == 204
    assert sc.get(f"/s/{token_of(l4)}/api/status").json()["status"] == "revoked"


def test_wf_share_lifecycle_open_page_revoked(browser, app_url):
    api = owner(app_url)
    s = share_setup(api)
    now = server_now(api)
    with open_app(browser, f"{app_url}/s/{s['token']}") as page:
        page.clock.set_system_time(now + timedelta(days=3))
        page.reload()
        expect(page.get_by_role("heading", level=1, name=s["col"]["name"])).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("list", name="Shared notes").get_by_role("link", name=s["a"]["title"], exact=True)).to_be_visible()
        advance(page, SHARE_REFRESH_MS)
        expect(page.get_by_role("heading", level=1, name=s["col"]["name"])).to_be_visible()
        api.ok("POST", f"/api/share-links/{s['link']['id']}/revoke", 200)
        advance(page, SHARE_REFRESH_MS)
        expect(page.get_by_role("heading", level=1, name=COPY_LINK_INACTIVE)).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("status", name="Link status")).to_contain_text(COPY_LINK_ASK)
        expect(page.get_by_role("list", name="Shared notes")).to_have_count(0)
        page.goto(f"{app_url}/s/unknown{uuid.uuid4().hex}")
        expect(page.get_by_role("heading", level=1, name=COPY_LINK_UNKNOWN)).to_be_visible(timeout=UI_TIMEOUT_MS)


TEXT_RECT_JS = r"""
text => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (n.data.includes(text)) { const r = n.parentElement.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }
  return null; }
"""

SHARE_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; "
             "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def test_wf_share_lifecycle_read_only_layouts(browser, app_url):
    api = owner(app_url)
    s = share_setup(api)
    tk = s["token"]
    sc = share_client(app_url)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in (f"/s/{tk}/api/collection", f"/s/{tk}", f"/s/{UNKNOWN_TOKEN}/api/status"):
            r = sc.request(method, path, json={})
            assert r.status_code == 405 and r.json() == {"error": "read_only"} and r.headers["allow"] == "GET, HEAD"
    for path in (f"/s/{tk}", f"/s/{tk}/o/{s['a']['id']}", f"/s/{tk}/api/status", f"/s/{tk}/api/collection",
                 f"/s/{tk}/api/objects/{s['never']['id']}", f"/s/{UNKNOWN_TOKEN}/api/status"):
        r = sc.get(path)
        assert r.headers["content-security-policy"] == SHARE_CSP, path
        assert r.headers["referrer-policy"] == "no-referrer" and r.headers["cache-control"] == "no-store"
        assert r.headers["x-content-type-options"] == "nosniff"
    owned = share_client(app_url)
    owned.cookies.set("quire_session", api.cookie)
    assert owned.get(f"/s/{tk}/api/objects/{s['never']['id']}").status_code == 404
    for creds in ({"cookies": {"quire_session": tk}}, {"headers": {"Authorization": f"Bearer {tk}"}}):
        assert httpx.get(app_url + "/api/session", timeout=HTTP_TIMEOUT, **creds).status_code == 401
    for size in ((1280, 800), (768, 1024), (375, 812)):
        with open_app(browser, f"{app_url}/s/{tk}/o/{s['a']['id']}") as page:
            page.set_viewport_size({"width": size[0], "height": size[1]})
            h1 = page.get_by_role("heading", level=1, name=s["a"]["title"])
            expect(h1).to_be_visible(timeout=UI_TIMEOUT_MS)
            region = page.get_by_role("region", name="Backlinks")
            expect(region.get_by_role("link", name=s["d"]["title"], exact=True)).to_be_visible()
            rb, hb = region.bounding_box(), h1.bounding_box()
            last = page.evaluate(TEXT_RECT_JS, f"inside passage {s['t']}")
            if size[0] == 1280:
                assert abs(rb["y"] - hb["y"]) <= 1 and rb["x"] >= last["x"] + last["width"] - 1
            else:
                assert rb["y"] >= last["y"] + last["height"] - 1
            layout(page)
    api.ok("POST", f"/api/share-links/{s['link']['id']}/revoke", 200)
    assert owned.get(f"/s/{tk}/api/collection").status_code == 410


def test_share_cache(app_url):
    api = owner(app_url)
    s = share_setup(api)
    sc, store = share_client(app_url), S3()
    link_id, tk = s["link"]["id"], s["token"]
    for oid in (s["a"]["id"], s["d"]["id"]):
        assert sc.get(f"/s/{tk}/api/objects/{oid}").status_code == 200
    key_a = f"share-cache/{link_id}/{s['a']['id']}.html"
    key_d = f"share-cache/{link_id}/{s['d']['id']}.html"
    assert poll(lambda: {key_a, key_d} <= set(store.keys(f"share-cache/{link_id}/")), CACHE_DELETE_S)
    html_a, html_d = store.get(key_a).decode(), store.get(key_d).decode()
    assert f"inside passage {s['t']}" in html_a
    for html in (html_a, html_d):
        assert "<script" not in html.lower() and not re.search(r"\son\w+\s*=", html, re.I)
        assert f"secret outside {s['t']}x" not in html and s["person"]["title"] not in html
    new = api.ok("POST", f"/api/share-links/{link_id}/regenerate", 201)
    assert poll(lambda: store.keys(f"share-cache/{link_id}/") == [], CACHE_DELETE_S)
    sc.get(f"/s/{token_of(new)}/api/objects/{s['a']['id']}")
    assert poll(lambda: store.keys(f"share-cache/{new['id']}/"), CACHE_DELETE_S)
    api.ok("POST", f"/api/share-links/{new['id']}/revoke", 200)
    assert poll(lambda: store.keys(f"share-cache/{new['id']}/") == [], CACHE_DELETE_S)


def test_wf_share_lifecycle_scope_change_open_page(browser, app_url):
    api = owner(app_url)
    s = share_setup(api)
    sc, store = share_client(app_url), S3()
    tk, link_id = s["token"], s["link"]["id"]
    sc.get(f"/s/{tk}/api/objects/{s['d']['id']}")
    key_a = f"share-cache/{link_id}/{s['a']['id']}.html"
    key_d = f"share-cache/{link_id}/{s['d']['id']}.html"
    with open_app(browser, f"{app_url}/s/{tk}/o/{s['a']['id']}") as page:
        expect(page.get_by_role("heading", level=1, name=s["a"]["title"])).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert poll(lambda: {key_a, key_d} <= set(store.keys(f"share-cache/{link_id}/")), CACHE_DELETE_S)
        api.ok("PATCH", f"/api/objects/{s['a']['id']}", 200, json={"share_visibility": "never"})
        changed_at = time.monotonic()
        advance(page, SHARE_REFRESH_MS)
        expect(page.get_by_role("heading", level=1, name=COPY_NOT_IN_SHARE)).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert poll(lambda: not {key_a, key_d} & set(store.keys(f"share-cache/{link_id}/")), CACHE_DELETE_S)
        assert time.monotonic() - changed_at <= CACHE_DELETE_S + EDGE_SLACK_S
        page.goto(f"{app_url}/s/{tk}/o/{s['d']['id']}")
        within(page, lambda: _assert_eq(body_text(page).count(COPY_QUOTE_OUTSIDE), 2))
        api.ok("PATCH", f"/api/objects/{s['a']['id']}", 200, json={"share_visibility": "follow"})
        advance(page, SHARE_REFRESH_MS)
        passage = f"inside passage {s['t']}"
        within(page, lambda: _assert_true(passage in body_text(page)), step_ms=250)
        assert body_text(page).count(COPY_QUOTE_OUTSIDE) == 1
    assert s["a"]["id"] in {o["id"] for o in sc.get(f"/s/{tk}/api/collection").json()["objects"]}


def test_share_one_winner(app_url):
    api = owner(app_url)
    for mix in (("revoke", "regenerate") * 4, ("regenerate",) * 8, ("revoke",) * 8):
        col = new_collection(api, [concept(api)["id"]])
        link = new_link(api, col["id"])
        barrier = threading.Barrier(len(mix))

        def go(action: str) -> httpx.Response:
            barrier.wait()
            return api.post(f"/api/share-links/{link['id']}/{action}")

        with ThreadPoolExecutor(len(mix)) as pool:
            rs = list(pool.map(go, mix))
        wins = [(a, r) for a, r in zip(mix, rs) if r.status_code in (200, 201)]
        assert len(wins) == 1, [r.status_code for r in rs]
        for r in rs:
            if r.status_code not in (200, 201):
                assert r.status_code == 409 and r.json() == {"error": "link_not_active", "status": "revoked"}
        links = api.ok("GET", f"/api/collections/{col['id']}/share-links", 200)["share_links"]
        assert len(links) == (2 if wins[0][0] == "regenerate" else 1)


def test_attachment_blocks(app_url):
    api = owner(app_url)
    store = S3()
    obj = concept(api)
    r = upload(api, obj["id"], ATTACH_NAME, PNG, "image/png")
    assert r.status_code == 201
    blk = r.json()
    assert blk["kind"] == "attachment"
    att = blk["attachment"]
    assert att["filename"] == ATTACH_NAME and att["content_type"] == "image/png" and att["size_bytes"] == len(PNG)
    key = f"attachments/{obj['id']}/{att['id']}"
    assert store.get(key) == PNG
    big = PNG + b"\x00" * (FILE_LIMIT - len(PNG))
    r = upload(api, obj["id"], "big.png", big, "image/png")
    assert r.status_code == 201 and r.json()["attachment"]["size_bytes"] == FILE_LIMIT
    r = upload(api, obj["id"], "huge.png", big + b"\x00", "image/png")
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    assert len(store.keys(f"attachments/{obj['id']}/")) == 2
    assert [b["kind"] for b in get_obj(api, obj["id"])["blocks"]] == ["attachment", "attachment"]
    assert api.delete(f"/api/objects/{obj['id']}").status_code == 204
    assert poll(lambda: store.keys(f"attachments/{obj['id']}/") == [], CACHE_DELETE_S)


def test_upload_content_checks(app_url):
    api = owner(app_url)
    store = S3()
    obj = concept(api)
    for name, data, ctype in (("a.png", JPEG, "image/png"), ("a.jpg", PNG, "image/jpeg"), ("a.png", b"hello", "image/png"),
                              ("a.svg", b"<svg onload='x()'></svg>", "image/svg+xml"), ("a.txt", b"%PDF-1.4", "text/plain")):
        r = upload(api, obj["id"], name, data, ctype)
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}, name
    assert store.keys(f"attachments/{obj['id']}/") == [] and get_obj(api, obj["id"])["blocks"] == []
    for raw, clean in (("C:\\scans\\..\\page 7.png", "page 7.png"), ("../../etc/passwd.png", "passwd.png"),
                       ("  spaced.png  ", "spaced.png"), ("uploads/..", "attachment")):
        r = upload(api, obj["id"], raw, PNG, "image/png")
        assert r.status_code == 201 and r.json()["attachment"]["filename"] == clean, raw
    for name, data, ctype, disposition in (("g.gif", GIF, "image/gif", "inline"), ("w.webp", WEBP, "image/webp", "inline"),
                                           ("j.jpg", JPEG, "image/jpeg", "inline"), ("d.pdf", PDF, "application/pdf", "attachment")):
        att = upload(api, obj["id"], name, data, ctype).json()["attachment"]
        r = api.get(f"/api/attachments/{att['id']}")
        assert r.status_code == 200 and r.content == data
        assert r.headers["content-type"].split(";")[0] == ctype and r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["content-disposition"].startswith(disposition)


def write_file(directory: str, name: str, data: bytes) -> str:
    path = os.path.join(directory, name)
    Path(path).write_bytes(data)
    return path


def test_wf_attachments_upload_ui(browser, app_url):
    api = owner(app_url)
    store = S3()
    obj = concept(api, f"Scans {tok()}")
    fname = f"scan {tok()}.png"
    with tempfile.TemporaryDirectory() as tmp, workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        status = page.get_by_role("status", name="Save status")
        attach = page.get_by_role("button", name="Attach file", exact=True)
        expect(attach).to_be_visible(timeout=UI_TIMEOUT_MS)
        with held(page, f"**/api/objects/{obj['id']}/attachments") as hold:
            with page.expect_file_chooser() as fc:
                attach.click()
            fc.value.set_files(write_file(tmp, fname, PNG))
            within(page, lambda: expect(status).to_have_text(f"Uploading {fname}", timeout=200))
            expect(page.get_by_role("figure", name=fname)).to_have_count(0)
            expect(page.get_by_role("img", name=fname)).to_have_count(0)
            assert store.keys(f"attachments/{obj['id']}/") == []
            hold.release()
        within(page, lambda: expect(page.get_by_role("figure", name=fname)).to_be_visible(timeout=200))
        expect(status).to_have_text(f"{fname} saved.")
        expect(announcements(page)).to_contain_text(f"{fname} attached to {obj['title']}.")
        for name, data, copy in ((f"huge {tok()}.png", PNG + b"\x00" * FILE_LIMIT, COPY_TOO_LARGE), (f"fake {tok()}.png", b"not an image", COPY_WRONG_TYPE)):
            with page.expect_file_chooser() as fc:
                attach.click()
            fc.value.set_files(write_file(tmp, name, data))
            within(page, lambda: expect(alert_with(page, copy)).to_be_visible(timeout=200))
            expect(status).to_have_text("")
            expect(page.get_by_role("figure", name=name)).to_have_count(0)
    keys = store.keys(f"attachments/{obj['id']}/")
    assert len(keys) == 1 and store.get(keys[0]) == PNG
    assert [b["attachment"]["filename"] for b in get_obj(api, obj["id"])["blocks"]] == [fname]


def test_wf_attachments_outage(browser, app_url):
    api = owner(app_url)
    store = S3()
    obj = concept(api, f"Outage {tok()}")
    blk = add_block(api, obj["id"], OUTAGE_TEXT)
    att = upload(api, obj["id"], KEPT_FILE, PNG, "image/png").json()["attachment"]
    down = minio_down_url()
    assert httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    dapi = owner(down)
    assert dapi.ok("GET", "/api/storage", 200) == {"storage": "unavailable"}
    r = dapi.get(f"/api/attachments/{att['id']}")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    start = time.monotonic()
    r = upload(dapi, obj["id"], "new.png", PNG, "image/png")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    assert time.monotonic() - start < STORAGE_CALL_S + EDGE_SLACK_S
    assert len(store.keys(f"attachments/{obj['id']}/")) == 1
    with tempfile.TemporaryDirectory() as tmp, workspace(browser, down, f"/o/{obj['id']}") as (page, _):
        expect(page.get_by_role("alert", name="Storage status")).to_have_text(COPY_STORAGE_BANNER, timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("figure", name=KEPT_FILE)).to_contain_text(COPY_ATTACH_OUTAGE)
        with page.expect_file_chooser() as fc:
            click(page.get_by_role("button", name="Attach file", exact=True))
        fc.value.set_files(write_file(tmp, REFUSED_FILE, PNG))
        within(page, lambda: expect(alert_with(page, COPY_UPLOAD_OUTAGE)).to_be_visible(timeout=200))
        expect(page.get_by_role("status", name="Save status")).to_have_text(COPY_NOT_SAVED)
        expect(page.get_by_role("figure", name=REFUSED_FILE)).to_have_count(0)
        box = block_box(page, 1)
        box.click()
        page.keyboard.press("Control+End")
        page.keyboard.type(OUTAGE_TAIL)
        advance(page, SAVE_ADVANCE_MS)
        within(page, lambda: expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=200))
    assert get_obj(api, obj["id"])["blocks"][0]["body"] == p_body(OUTAGE_TEXT + OUTAGE_TAIL)
    assert [b["kind"] for b in get_obj(api, obj["id"])["blocks"]] == ["text", "attachment"]
    assert len(store.keys(f"attachments/{obj['id']}/")) == 1
    assert blk["id"]


class Relay:

    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.target = target
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.target)
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_storage_recovery_without_restart(browser, app_url):
    api = owner(app_url)
    obj = concept(api, f"Recover {tok()}")
    att = upload(api, obj["id"], BACK_FILE, PNG, "image/png").json()["attachment"]
    real = urlparse(os.environ["S3_ENDPOINT"])
    relay_port, app_port = free_port(), free_port()
    env = dict(os.environ, S3_ENDPOINT=f"{real.scheme}://127.0.0.1:{relay_port}", APP_PUBLIC_PORT=str(app_port))
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{app_port}"
    relay = None
    try:
        def healthy() -> bool:
            assert proc.poll() is None, Path(log.name).read_text()[-2000:]
            with contextlib.suppress(httpx.HTTPError):
                return httpx.get(base + "/api/health", timeout=2).status_code == 200
            return False

        assert poll(healthy, 90, interval=0.5), Path(log.name).read_text()[-2000:]
        capi = owner(base)
        assert capi.ok("GET", "/api/storage", 200) == {"storage": "unavailable"}
        with workspace(browser, base, f"/o/{obj['id']}") as (page, _):
            banner = page.get_by_role("alert", name="Storage status")
            expect(banner).to_have_text(COPY_STORAGE_BANNER, timeout=UI_TIMEOUT_MS)
            relay = Relay(relay_port, (real.hostname or "127.0.0.1", real.port or 80))
            assert poll(lambda: capi.ok("GET", "/api/storage", 200)["storage"] == "available", STORAGE_FORGET_S + STORAGE_CALL_S + EDGE_SLACK_S)
            advance(page, STORAGE_POLL_MS)
            within(page, lambda: expect(banner).to_have_count(0, timeout=200), seconds=STORAGE_RETURN_S, step_ms=500)
            img = page.get_by_role("figure", name=BACK_FILE).get_by_role("img", name=BACK_FILE)
            within(page, lambda: expect(img).to_have_count(1, timeout=200), seconds=STORAGE_RETURN_S, step_ms=500)
        assert capi.get(f"/api/attachments/{att['id']}").content == PNG
        assert proc.poll() is None
    finally:
        if relay:
            relay.close()
        proc.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(10)


def test_wf_cross_cutting_layouts(browser, app_url):
    api = owner(app_url)
    host = concept(api, f"Layout {tok()}")
    paragraphs = 12
    for i in range(paragraphs):
        add_block(api, host["id"], f"layout paragraph {i} " * 8)
    origin = concept(api)
    quote(api, host["id"], add_block(api, origin["id"], "quoted layout")["id"])
    for size in ((1280, 800), (768, 1024), (375, 812)):
        with workspace(browser, app_url, f"/o/{host['id']}", size=size) as (page, _):
            main = page.get_by_role("main")
            expect(main).to_be_visible(timeout=UI_TIMEOUT_MS)
            layout(page)
            mb = main.bounding_box()
            if size[0] == 1280:
                nav = page.get_by_role("navigation", name="Library").bounding_box()
                margin = page.get_by_role("complementary", name="Margin").bounding_box()
                assert nav["x"] < mb["x"] < margin["x"]
                expect(page.get_by_role("button", name="Open library", exact=True)).to_have_count(0)
            elif size[0] == 768:
                expect(page.get_by_role("button", name="Open library", exact=True)).to_be_visible()
                expect(page.get_by_role("navigation", name="Library")).to_have_count(0)
                margin = page.get_by_role("complementary", name="Margin").bounding_box()
                assert margin["x"] >= mb["x"] + mb["width"] - 1
            else:
                lib = page.get_by_role("button", name="Open library", exact=True)
                mar = page.get_by_role("button", name="Open margin", exact=True)
                expect(page.get_by_role("complementary", name="Margin")).to_have_count(0)
                assert mb["width"] >= size[0] * 0.8
                page.evaluate("() => scrollTo(0, 600)")
                advance(page, 32)
                for b in (lib, mar):
                    bb = b.bounding_box()
                    assert bb["y"] >= 0 and bb["y"] + bb["height"] <= 56 + 1
                drawn = page.evaluate(
                    "() => [...document.querySelectorAll('[data-tether]')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length")
                assert drawn == 0
    assert len(get_obj(api, host["id"])["blocks"]) == paragraphs + 1


def assert_trap(page: Page, container, opener) -> None:
    count = container.evaluate(
        "c => [...c.querySelectorAll('a[href],button,input,select,textarea,[tabindex],[contenteditable=true]')].filter(e => e.tabIndex >= 0 && !e.disabled).length")
    for key in ("Tab", "Shift+Tab"):
        for _ in range(count + 2):
            page.keyboard.press(key)
            assert container.evaluate("c => c.contains(document.activeElement)"), key
    page.keyboard.press("Escape")
    advance(page, 1000)
    expect(opener).to_be_focused()


def test_dialog_focus_traps(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    add_block(api, obj["id"], "trap text")
    new_collection(api)
    with workspace(browser, app_url, f"/o/{obj['id']}") as (page, _):
        box = block_box(page, 1)
        expect(box).to_be_visible(timeout=UI_TIMEOUT_MS)
        box.focus()
        page.keyboard.press("Control+k")
        assert_trap(page, page.get_by_role("dialog", name="Command palette"), box)
        box.click()
        page.keyboard.press("Control+End")
        page.keyboard.type("((")
        assert_trap(page, page.get_by_role("dialog", name="Quote a block"), box)
        for opener_name, dialog_role, dialog_name in (("New type", "dialog", "New type"), ("Delete note", "alertdialog", "Delete this note?"),
                                                      ("History of block 1", "dialog", "Block history"), ("Add to collection", "dialog", "Add to collection")):
            opener = page.get_by_role("button", name=opener_name, exact=True)
            opener.click()
            assert_trap(page, page.get_by_role(dialog_role, name=dialog_name), opener)
    for size, opener_name, dialog_name in (((768, 1024), "Open library", "Library"), ((375, 812), "Open margin", "Margin")):
        with workspace(browser, app_url, f"/o/{obj['id']}", size=size) as (page, _):
            opener = page.get_by_role("button", name=opener_name, exact=True)
            expect(opener).to_be_visible(timeout=UI_TIMEOUT_MS)
            opener.click()
            advance(page, 1000)
            assert_trap(page, page.get_by_role("dialog", name=dialog_name), opener)


def test_health_and_serving(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(app_url + "/sign-in", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")


def test_server_boundary(app_url):
    api = owner(app_url)
    exact = b'{"name":"' + b"x" * (JSON_LIMIT - 11) + b'"}'
    assert len(exact) == JSON_LIMIT
    r = api.post("/api/collections", content=exact, headers={"Content-Type": "application/json"})
    assert r.status_code != 413
    r = api.post("/api/collections", content=exact + b" ", headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert anon.post("/api/collections", content=exact + b" ", headers={"Content-Type": "application/json"}).status_code == 413
    r = anon.post("/api/collections", content=b"name=x", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    assert anon.post("/api/auth/sign-in", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    for path in ("/api/objects?type_id=x", "/api/graph", "/api/settings", "/api/sessions"):
        r = anon.get(path)
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    for path in ("/package.json", "/.env", "/run.json", "/package-lock.json", "/src/server.ts", "/dist/server.js", "/dist/server.js.map", "/tsconfig.json"):
        assert anon.get(path).status_code == 404, path
    r = anon.get("/sign-in", headers={"Origin": "http://evil.example"})
    assert r.headers.get("access-control-allow-origin") not in ("*", "http://evil.example")
    csp = r.headers.get("content-security-policy", "")
    script_src = re.search(r"script-src([^;]*)", csp) or re.search(r"default-src([^;]*)", csp)
    assert script_src and "'unsafe-inline'" not in script_src.group(1)
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")]
    pw = urlparse(os.environ.get("DATABASE_URL", "")).password or ""
    secrets = [s for s in secrets + [pw] if len(s) >= 6]
    bodies = [r.text, api.get("/api/session").text, api.get("/api/settings").text]
    for src in re.findall(r'src="(/[^"]+\.js)"', r.text):
        bodies.append(anon.get(src).text)
    for s in secrets:
        assert all(s not in b for b in bodies)


def progress_scale(page: Page) -> float:
    matrix = page.evaluate("() => getComputedStyle(document.querySelector('[data-reading-progress]')).transform")
    return 1.0 if matrix == "none" else float(re.findall(r"-?[\d.]+(?:e-?\d+)?", matrix)[0])


def test_scroll_locked_margin(browser, app_url):
    api = owner(app_url)
    host = concept(api)
    prev = None
    for i in range(25):
        prev = add_block(api, host["id"], f"long reading paragraph {i} " * 6, after=prev)["id"]
    origin = concept(api, f"Level {tok()}")
    oblk = add_block(api, origin["id"], "levelled quote")
    mid = get_obj(api, host["id"])["blocks"][10]["id"]
    quote(api, host["id"], oblk["id"], after=mid)
    with workspace(browser, app_url, f"/o/{host['id']}") as (page, _):
        fig = page.get_by_role("figure", name=f"Quote from {origin['title']}")
        expect(fig).to_be_visible(timeout=UI_TIMEOUT_MS)
        chip = page.get_by_role("link", name=f"Quoted from {origin['title']}, 1 backlink", exact=True)
        qid = next(b["id"] for b in get_obj(api, host["id"])["blocks"] if b["kind"] == "quote")
        nav = page.get_by_role("navigation", name="Library")
        for y in (0, 400, 800, 1200, 1600):
            page.evaluate("y => scrollTo(0, y)", y)
            advance(page, 16)
            fb, cb = fig.bounding_box(), chip.bounding_box()
            assert abs(fb["y"] - cb["y"]) <= 1, (y, fb, cb)
            ends = page.evaluate(
                """id => { const el = document.querySelector(`[data-tether='${id}']`);
                const g = el.getTotalLength ? el : el.querySelector('line,path,polyline'); const L = g.getTotalLength();
                const m = g.getScreenCTM(); return [g.getPointAtLength(0), g.getPointAtLength(L)].map(p => { const q = new DOMPoint(p.x, p.y).matrixTransform(m); return [q.x, q.y]; }); }""", qid)
            near_block = min(ends, key=lambda e: abs(e[0] - fb["x"]))
            far = max(ends, key=lambda e: abs(e[0] - fb["x"]))
            assert abs(near_block[0] - fb["x"]) <= 1.5 and fb["y"] - 1.5 <= near_block[1] <= fb["y"] + fb["height"] + 1.5
            assert cb["x"] - 1.5 <= far[0] <= cb["x"] + cb["width"] + 1.5 and cb["y"] - 1.5 <= far[1] <= cb["y"] + cb["height"] + 1.5
            nb = nav.bounding_box()
            assert abs(nb["y"]) <= 1 and abs(nb["height"] - 800) <= 1
            scroll, height, inner = page.evaluate("() => [scrollY, document.documentElement.scrollHeight, innerHeight]")
            p = max(0, min(1, scroll / (height - inner))) if height > inner else 0
            scale = progress_scale(page)
            assert abs(scale - p) <= 0.01, (y, scale, p)
        values = []
        for y in (0, 300, 600, 900, 1200, 900, 600, 300, 0):
            page.evaluate("y => scrollTo(0, y)", y)
            advance(page, 16)
            values.append(progress_scale(page))
        assert values[:5] == sorted(values[:5]) and values[4:] == sorted(values[4:], reverse=True)


def test_wf_cross_cutting_theme(browser, app_url):
    api = owner(app_url)
    r = api.put("/api/settings", json={"theme": "sepia"})
    assert r.status_code == 422 and r.json()["errors"]["theme"] == "Choose Paper or Lamplight."
    api.ok("PUT", "/api/settings", 200, json={"theme": "paper"})
    try:
        with workspace(browser, app_url, "/today", size=(768, 1024)) as (tablet, _):
            expect(tablet.get_by_role("main")).to_be_visible(timeout=UI_TIMEOUT_MS)
            tablet.keyboard.press("Control+k")
            tablet.keyboard.type("gr")
            before = decode(capture(tablet.get_by_role("main", include_hidden=True)))
            with workspace(browser, app_url, "/settings") as (laptop, _):
                select(laptop.get_by_role("combobox", name="Theme"), "Lamplight")
                within(laptop, lambda: expect(announcements(laptop)).to_contain_text(f"Theme set to {THEME_LAMPLIGHT}.", timeout=200))
                assert laptop.evaluate("() => document.documentElement.dataset.theme") == "lamplight"
                deadline = time.monotonic() + LIVE_S
                while tablet.evaluate("() => document.documentElement.dataset.theme") != "lamplight":
                    assert time.monotonic() < deadline, "theme did not reach the other tab"
                    advance(tablet, 16)
                expect(tablet.get_by_role("dialog", name="Command palette")).to_be_visible()
                assert tablet.get_by_role("combobox", name="Search Quire").input_value() == "gr"
                tablet.keyboard.press("Escape")
                advance(tablet, 300)
                assert difference(before, decode(capture(tablet.get_by_role("main", include_hidden=True)))) > 0
        assert api.ok("GET", "/api/settings", 200)["theme"] == "lamplight"
    finally:
        api.put("/api/settings", json={"theme": "paper"})


def spring(x0: float, v0: float, target: float, t: float) -> float:
    w = DRAWER_W_SPRING
    return target + (x0 - target + (v0 + w * (x0 - target)) * t) * math.exp(-w * t)


def spring_v(x0: float, v0: float, target: float, t: float) -> float:
    w = DRAWER_W_SPRING
    return (v0 - w * (v0 + w * (x0 - target)) * t) * math.exp(-w * t)


def test_drawer_spring(browser, app_url):
    api = owner(app_url)
    obj = concept(api)
    with workspace(browser, app_url, f"/o/{obj['id']}", size=(768, 1024)) as (page, _):
        opener = page.get_by_role("button", name="Open library", exact=True)
        expect(opener).to_be_visible(timeout=UI_TIMEOUT_MS)
        opener.click()
        drawer = page.get_by_role("dialog", name="Library").element_handle()
        width = drawer.bounding_box()["width"]
        elapsed = 0
        for step in (48, 48):
            advance(page, step)
            elapsed += step
            x = drawer.bounding_box()["x"]
            lo, hi = spring(-width, 0, 0, (elapsed - 17) / 1000), spring(-width, 0, 0, elapsed / 1000)
            assert lo - 1 <= x <= hi + 1, (elapsed, x, lo, hi)
        t_r = elapsed / 1000
        origins = [(spring(-width, 0, 0, t), spring_v(-width, 0, 0, t)) for t in (t_r, t_r - 0.017)]
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="Library")).to_have_count(0)
        advance(page, 32)
        x = drawer.bounding_box()["x"]
        bands = [(spring(x0, v0, -width, 0.015), spring(x0, v0, -width, 0.032)) for x0, v0 in origins]
        assert any(min(b) - 1 <= x <= max(b) + 1 for b in bands), (x, bands)
        assert any(x > x0 - 1 for x0, v0 in origins) if all(v0 > 0 for _, v0 in origins) else True
        advance(page, 1000)
        assert not drawer.is_visible() or drawer.bounding_box() is None or drawer.bounding_box()["x"] <= -width + 0.5
