from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    check,
    click,
    fill,
    layout,
    motion,
    open_app,
    select,
    settle,
    tap,
    unique,
)


PASSWORD = "quillmere-demo-2026"
JSON_TYPE = "application/json; charset=utf-8"
LIVE_S = 1
HARNESS_SLACK_S = 1
FRAME_WAIT_S = 15
UI_WAIT_S = 20
HTTP_TIMEOUT_S = 30
NPM_TIMEOUT_S = 300
POLL_MS = 50
STEADY_GAP_S = 0.1
TAB_LIMIT = 40
SHORT_IDLE_S = 3
SAVE_FAIL_WAIT_S = 5
MAX_BODY_BYTES = 65536
COMMENT_MAX = 2000
TITLE_MAX = 120
CLIENT_MAX = 80
SHARE_MAX_DAYS = 365
ALIGN_TOL_PX = 2
STACK_GAP_PX = 8
FOCUS_SHIFT_PX = 24
MOTION_MAX_MS = 400
JUMP_MAX_MS = 1
FRAME_MS = 16
LAYOUT_FRAMES = 3
TOUCH_MIN_PX = 44
CARD_CHIP_NAME = re.compile(r"^Card \d+$")
ANNOUNCE_DELAY_MS = 1000 / 3
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
LAYOUT_IDS = ["phone", "tablet", "desktop"]
SAMPLE_WINDOW_MS = 2 * MOTION_MAX_MS
SHORT_END_S = 8
UI_END_S = 40
FAR_DEVICE_DAYS = 2
SHARE_END_DAYS = 30
SET_COOKIE = "set-cookie"
CONCURRENT_DECISIONS = 6
SEED_SEARCH_MATCHES = 3
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
EMBEDDED_STORES = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "level", "leveldown", "classic-level",
                   "pouchdb", "redis", "ioredis", "mongodb", "mongoose", "lmdb", "rocksdb", "@electric-sql/pglite"}
WS_KEY = "dGhlIHNhbXBsZSBub25jZQ=="
PERSON_KEYS = {"personId", "displayName", "colour", "role"}


@dataclass(frozen=True)
class Seat:
    name: str
    email: str


INES = Seat("Ines Calloway", "ines@quillmere.test")
TOMAS = Seat("Tomas Reyes", "tomas@riverbend-literacy.test")
DANA = Seat("Dana Whitfield", "dana@riverbend-literacy.test")
PRIYA = Seat("Priya Nandakumar", "priya@peer-review.test")
LENA = Seat("Lena Ostrowski", "lena@harborstreet-pantry.test")
SAM = Seat("Sam Adeyemi", "sam@peer-review.test")
JORDAN = Seat("Jordan Pike", "jordan@peer-review.test")
SEATS = [INES, TOMAS, DANA, PRIYA, LENA, SAM, JORDAN]

SEED_DOC = "riverbend-reading-nights"
SEED_HEADINGS = ["Family Reading Nights", "Statement of Need", "Program Design", "Evaluation Plan", "Budget Justification"]
SEED_SUGGESTION = "sg-seed-1"
SEED_COMMENT = "cm-seed-1"


class Api:
    def __init__(self, base: str, seat: Seat | None = None) -> None:
        self.base = base
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        self.person: dict[str, Any] = {}
        if seat:
            r = self.post("/api/session", {"email": seat.email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self.person = r.json()["person"]

    @property
    def pid(self) -> str:
        return self.person["personId"]

    def call(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None,
             params: dict[str, str] | None = None) -> httpx.Response:
        h = dict(headers or {})
        if body is not None:
            h.setdefault("content-type", JSON_TYPE)
            return self.c.request(method, path, content=json.dumps(body).encode(), headers=h, params=params)
        return self.c.request(method, path, headers=h, params=params)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, {} if body is None else body, **kw)

    def patch(self, path: str, body: Any, **kw: Any) -> httpx.Response:
        return self.call("PATCH", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)

    def snap(self, doc_id: str) -> dict:
        r = self.get(f"/api/documents/{doc_id}")
        assert r.status_code == 200, r.text
        return r.json()

    def docs(self, view: str | None = None, q: str | None = None) -> list[dict]:
        params = {k: v for k, v in (("view", view), ("q", q)) if v is not None}
        r = self.get("/api/documents", params=params)
        assert r.status_code == 200, r.text
        return r.json()["documents"]

    def doc_ids(self, view: str | None = None, q: str | None = None) -> list[str]:
        return [d["id"] for d in self.docs(view, q)]

    def notices(self) -> dict:
        r = self.get("/api/notices")
        assert r.status_code == 200, r.text
        return r.json()


def token(label: str = "qd") -> str:
    return re.sub(r"[^a-z0-9]", "", unique(label)[0].lower())[:20] + uuid.uuid4().hex[:6]


def make_doc(owner: Api, label: str = "proposal") -> dict:
    t = token(label)
    r = owner.post("/api/documents", {"title": f"Plan {t}", "client": f"Trust {t}"})
    assert r.status_code == 201, r.text
    doc = r.json()
    doc["token"] = t
    return doc


def server_time(doc: dict) -> datetime:
    return datetime.fromisoformat(doc["updatedAt"].replace("Z", "+00:00"))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def share(owner: Api, doc_id: str, seat: Seat, role: str, ends: str | None = None) -> dict:
    r = owner.post(f"/api/documents/{doc_id}/shares", {"email": seat.email, "role": role, "endsAt": ends})
    assert r.status_code == 201, r.text
    return r.json()


def shares(api: Api, doc_id: str) -> list[dict]:
    r = api.get(f"/api/documents/{doc_id}/shares")
    assert r.status_code == 200, r.text
    return r.json()["shares"]


def share_of(owner: Api, doc_id: str, seat: Seat) -> dict:
    found = [s for s in shares(owner, doc_id) if s.get("email") == seat.email]
    assert len(found) == 1, found
    return found[0]


def comment(api: Api, doc_id: str, at: int, length: int, body: str, mentions: list[str] | None = None,
            parent: str | None = None) -> httpx.Response:
    payload: dict[str, Any] = {"body": body, "mentions": mentions or []}
    if parent:
        payload["parentId"] = parent
    else:
        payload["anchor"] = {"at": at, "length": length}
    return api.post(f"/api/documents/{doc_id}/comments", payload)


def made_comment(api: Api, doc_id: str, at: int, length: int, body: str, mentions: list[str] | None = None) -> dict:
    r = comment(api, doc_id, at, length, body, mentions)
    assert r.status_code == 201, r.text
    return r.json()


def decide(api: Api, doc_id: str, sid: str, decision: str) -> httpx.Response:
    return api.post(f"/api/documents/{doc_id}/suggestions/{sid}/decision", {"decision": decision})


def sugs(snap: dict, pid: str | None = None, kind: str | None = None) -> list[dict]:
    return [s for s in snap["suggestions"]
            if (pid is None or s["author"]["personId"] == pid) and (kind is None or s["kind"] == kind)]


def span(text: str, rng: dict | None) -> str:
    assert rng is not None
    return text[rng["at"]:rng["at"] + rng["length"]]


def assert_person(p: dict, role: str | None = None) -> None:
    assert {"personId", "displayName", "colour"} <= set(p) <= PERSON_KEYS, p
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", p["colour"]), p
    if role:
        assert p["role"] == role, p


def no_emails(text: str, *seats: Seat) -> None:
    for seat in seats:
        assert seat.email not in text, f"{seat.email} leaked"


def not_found(r: httpx.Response) -> None:
    assert r.status_code == 404, r.text
    assert r.json() == {"error": "not_found"}


WS_OPEN = """() => new Promise(resolve => {
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/socket');
  window.__frames = []; window.__closed = false; window.__ws = ws;
  ws.onmessage = e => { try { window.__frames.push(JSON.parse(e.data)); } catch (_) { window.__frames.push({raw: String(e.data)}); } };
  ws.onclose = () => { window.__closed = true; };
  ws.onopen = () => resolve(true);
  ws.onerror = () => resolve(false);
})"""


class Sock:
    def __init__(self, browser: Browser, base: str, seat: Seat) -> None:
        self.base = base
        self.doc = ""
        self.ctx = browser.new_context()
        r = self.ctx.request.post(base + "/api/session", data=json.dumps({"email": seat.email, "password": PASSWORD}),
                                  headers={"content-type": JSON_TYPE})
        assert r.status == 200, r.text()
        self.person = r.json()["person"]
        self.page = self.ctx.new_page()
        self.page.goto(base + "/api/health")
        assert self.page.evaluate(WS_OPEN), "socket did not open"

    def __enter__(self) -> "Sock":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.ctx.close()

    @property
    def pid(self) -> str:
        return self.person["personId"]

    def frames(self) -> list[dict]:
        return self.page.evaluate("() => window.__frames")

    def mark(self) -> int:
        return len(self.frames())

    def emit(self, frame: dict) -> str:
        ref = uuid.uuid4().hex
        self.page.evaluate("f => window.__ws.send(JSON.stringify(f))", {**frame, "ref": ref})
        return ref

    def emit_raw(self, text: str) -> None:
        self.page.evaluate("t => window.__ws.send(t)", text)

    def wait(self, pred: Callable[[dict], bool], seconds: float = FRAME_WAIT_S, since: int = 0) -> dict:
        deadline = time.monotonic() + seconds
        while True:
            frames = self.frames()
            for f in frames[since:]:
                if pred(f):
                    return f
            left = deadline - time.monotonic()
            if left <= 0:
                raise AssertionError(f"no matching frame within {seconds}s; last frames: {frames[-6:]}")
            try:
                self.page.wait_for_function("n => window.__frames.length > n", arg=len(frames), timeout=left * 1000)
            except PlaywrightError:
                pass

    def reply(self, ref: str) -> dict:
        return self.wait(lambda f: f.get("ref") == ref and f.get("type") in ("ack", "error", "joined"))

    def send(self, frame: dict) -> dict:
        return self.reply(self.emit(frame))

    def wait_closed(self, seconds: float = FRAME_WAIT_S) -> None:
        self.page.wait_for_function("() => window.__closed", timeout=seconds * 1000)

    def join(self, doc_id: str) -> dict:
        self.doc = doc_id
        r = self.send({"type": "join", "documentId": doc_id, "revision": self.server_rev()})
        assert r["type"] == "joined", r
        return r

    def server_rev(self) -> int:
        r = self.ctx.request.get(f"{self.base}/api/documents/{self.doc}")
        assert r.status == 200, r.text()
        return r.json()["revision"]

    def op(self, mode: str, ops: list[dict], base: int | None = None) -> dict:
        rev = self.server_rev() if base is None else base
        return self.send({"type": "op", "baseRevision": rev, "mode": mode, "ops": ops})

    def ok_op(self, mode: str, ops: list[dict]) -> dict:
        r = self.op(mode, ops)
        assert r["type"] == "ack", r
        return r

    def mode(self, mode: str) -> dict:
        return self.send({"type": "mode", "mode": mode})

    def saved(self, revision: int, since: int = 0) -> dict:
        return self.wait(lambda f: f.get("type") == "saved" and f["revision"] >= revision, since=since)


def seeded(st: ExitStack, browser: Browser, base: str, owner: Api, text: str,
           grants: tuple[tuple[Seat, str], ...] = ()) -> tuple[dict, Sock]:
    doc = make_doc(owner)
    for seat, role in grants:
        share(owner, doc["id"], seat, role)
    s = st.enter_context(Sock(browser, base, INES))
    s.join(doc["id"])
    if text:
        s.ok_op("editing", [{"insert": text, "at": 0}])
    return doc, s


def joined(st: ExitStack, browser: Browser, base: str, seat: Seat, doc_id: str) -> Sock:
    s = st.enter_context(Sock(browser, base, seat))
    s.join(doc_id)
    return s


WS_LOG: dict[int, list[str]] = {}

RECORD_JS = """el => { el.__log = [];
  new MutationObserver(() => { const t = (el.textContent || '').trim(); if (t) el.__log.push(t); })
    .observe(el, {subtree: true, childList: true, characterData: true}); }"""

LABEL_VISIBLE_JS = """([pid, name]) => { const el = document.querySelector(`[data-caret-for="${pid}"]`); if (!el) return false;
  const shown = n => { for (let e = n; e; e = e.parentElement) { const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; }
    const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [el, ...el.querySelectorAll('*')].some(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.includes(name)) && shown(n)); }"""

COLOURS_JS = """el => { const out = []; for (const n of [el, ...el.querySelectorAll('*')]) { const s = getComputedStyle(n);
  for (const p of ['color', 'background-color', 'border-left-color', 'border-top-color', 'border-right-color',
                   'border-bottom-color', 'fill', 'stroke', 'outline-color', 'box-shadow', 'caret-color'])
    out.push(s.getPropertyValue(p)); } return out.join(' '); }"""

FOCUSED_CARD_JS = """() => { const c = document.activeElement && document.activeElement.closest('[data-card-id]');
  return c ? c.getAttribute('data-card-id') : null; }"""

SELECTION_JS = "() => String(window.getSelection())"
SHOWN_JS = "e => e.checkVisibility({opacityProperty: true, visibilityProperty: true})"

ANIMATING_JS = "e => e.getAnimations({subtree: true}).some(a => a.playState === 'running')"

FINISH_ALL_JS = "() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); })"

CARD_IDS_JS = "() => [...document.querySelectorAll('[data-card-id]')].map(e => e.getAttribute('data-card-id'))"

GEOM_JS = """id => { const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
    return {left: r.left, top: r.top, right: r.right, bottom: r.bottom}; };
  const card = document.querySelector(`[data-card-id="${id}"]`);
  const spans = [...document.querySelectorAll(`[data-anchor-for="${id}"]`)];
  const rects = spans.flatMap(s => [...s.getClientRects()]).filter(r => r.width > 0 && r.height > 0);
  const tether = document.querySelector(`[data-tether-for="${id}"]`);
  let first = null, lastRight = null;
  if (rects.length) { const top = Math.min(...rects.map(r => r.top)); const lastTop = Math.max(...rects.map(r => r.top));
    first = top; lastRight = Math.max(...rects.filter(r => Math.abs(r.top - lastTop) < 1).map(r => r.right)); }
  const ts = tether ? getComputedStyle(tether) : null;
  return {card: box(card), first, lastRight, tether: box(tether), stroke: ts ? ts.strokeWidth : null,
          strokeColour: ts ? ts.stroke : null, wash: spans.length ? getComputedStyle(spans[0]).backgroundColor : null}; }"""

ANIM_JS = """() => { window.__anims = [];
  const moving = new Set(['transform', 'translate', 'top', 'left', 'height', 'max-height', 'opacity']);
  const keep = t => t && t.closest && !t.closest('button,[role="button"]') && t.closest('[data-card-id],[data-tether-for],[data-anchor-for]');
  const kebab = k => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const props = a => a.transitionProperty ? [a.transitionProperty]
    : (a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().flatMap(k => Object.keys(k).map(kebab)) : []);
  const seen = new Set();
  const push = a => { const e = a.effect; if (!e || seen.has(a) || !keep(e.target) || !props(a).some(p => moving.has(p))) return;
    seen.add(a); window.__anims.push(e.getComputedTiming().activeDuration); };
  const grab = () => document.getAnimations().forEach(push);
  for (const ev of ['transitionrun', 'animationstart']) document.addEventListener(ev, grab, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); push(a); return a; }; }"""

WEIGHT_JS = """(el, word) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { if (n.textContent.includes(word)) return parseInt(getComputedStyle(n.parentElement).fontWeight, 10); }
  return null; }"""

INK_JS = """(el, word) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { if (n.textContent.includes(word)) return getComputedStyle(n.parentElement).color; }
  return null; }"""


def wait_ui(pages: Page | list[Page], cond: Callable[[], Any], seconds: float = UI_WAIT_S, what: str = "condition") -> None:
    group = pages if isinstance(pages, list) else [pages]
    deadline = time.monotonic() + seconds
    while True:
        try:
            if cond():
                return
        except PlaywrightError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        for p in group:
            advance(p, POLL_MS)


def login(page: Page, base: str, seat: Seat) -> None:
    r = page.request.post(base + "/api/session", data=json.dumps({"email": seat.email, "password": PASSWORD}),
                          headers={"content-type": JSON_TYPE})
    assert r.status == 200, r.text()


@contextmanager
def app_page(browser: Browser, base: str, seat: Seat | None, path: str, size: tuple[int, int] | None = None,
             reduced: bool = False, device_time: datetime | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", reduced_motion="reduce" if reduced else "no-preference") as page:
        sockets: list[str] = []
        WS_LOG[id(page)] = sockets
        page.on("websocket", lambda ws: sockets.append(ws.url))
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if device_time:
            page.clock.set_system_time(device_time)
        if seat:
            login(page, base, seat)
        sockets.clear()
        page.goto(base + path)
        try:
            yield page
        finally:
            WS_LOG.pop(id(page), None)


@contextmanager
def editor(browser: Browser, base: str, seat: Seat, doc_id: str, **kw: Any) -> Iterator[Page]:
    with app_page(browser, base, seat, f"/d/{doc_id}", **kw) as page:
        wait_ui(page, lambda: body(page).is_visible(), what="the editor page")
        yield page


@contextmanager
def home(browser: Browser, base: str, seat: Seat, **kw: Any) -> Iterator[Page]:
    with app_page(browser, base, seat, "/", **kw) as page:
        wait_ui(page, lambda: page.get_by_role("heading", name="Documents").is_visible(), what="documents home")
        yield page


def body(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Proposal body")


def norm(s: str) -> str:
    return " ".join(s.split())


APOSTROPHES = str.maketrans({"\u2019": "'", "\u02bc": "'"})


def plain(s: str) -> str:
    return s.translate(APOSTROPHES)


BODY_TEXT_JS = """el => { const copy = el.cloneNode(true);
  copy.querySelectorAll('[data-caret-for],[data-marker-for]').forEach(n => n.remove());
  const r = el.getBoundingClientRect();
  copy.style.position = 'absolute'; copy.style.left = '-100000px'; copy.style.top = '0'; copy.style.width = r.width + 'px';
  copy.setAttribute('aria-hidden', 'true'); copy.removeAttribute('id');
  document.body.appendChild(copy); const t = copy.innerText; copy.remove(); return t; }"""


def body_text(page: Page) -> str:
    return norm(body(page).evaluate(BODY_TEXT_JS))


STYLE_SHOWN_JS = """el => (el.tagName === 'SELECT' ? ((el.selectedOptions[0] || {}).textContent || '')
  : ('value' in el && el.value ? el.value : el.textContent || ''))"""


def style_shown(page: Page) -> str:
    box = page.get_by_role("toolbar", name="Formatting").get_by_role("combobox", name="Paragraph style")
    return norm(box.evaluate(STYLE_SHOWN_JS)).casefold()


def hit(loc: Locator) -> None:
    loc.evaluate("el => el.scrollIntoView({block: 'center'})")
    click(loc)


HITTABLE_JS = """el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const moving = document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target
    && a.effect.target.contains(el) && Number.isFinite(a.effect.getComputedTiming().endTime));
  if (moving) return null;
  const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y);
  return h && (h === el || el.contains(h)) ? [r.left, r.top, r.width, r.height].map(Math.round).join(',') : null; }"""


TAP_TARGET_JS = """el => { const boxes = [el, el.closest('label'), el.id ? document.querySelector(`label[for="${el.id}"]`) : null]
    .filter(Boolean).map(e => e.getBoundingClientRect());
  return {width: Math.max(...boxes.map(r => r.width)), height: Math.max(...boxes.map(r => r.height))}; }"""


def steady(page: Page, loc: Locator) -> None:
    seen: list[tuple[float, Any]] = []

    def still() -> bool:
        now, box = time.monotonic(), loc.evaluate(HITTABLE_JS)
        if box is None:
            seen.clear()
            return False
        if not seen or seen[-1][1] != box:
            seen[:] = [(now, box)]
            return False
        return now - seen[0][0] >= STEADY_GAP_S

    wait_ui(page, still, what="control at rest under the pointer")


def hit_at_rest(page: Page, loc: Locator) -> None:
    loc.evaluate("el => el.scrollIntoView({block: 'center'})")
    steady(page, loc)
    click(loc)


def caret_at(page: Page, key: str) -> None:
    body(page).focus()
    page.keyboard.press(key)
    wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) is None, what="no card holds focus")


def caret_end(page: Page) -> None:
    caret_at(page, "Control+End")


def caret_start(page: Page) -> None:
    caret_at(page, "Control+Home")


RADIO_HIT_JS = """el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); }"""
LABEL_POINT_JS = """el => { const l = (el.labels && el.labels[0]) || el.closest('label'); if (!l) return null;
  l.scrollIntoView({block: 'center'}); const r = l.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const h = document.elementFromPoint(x, y); return h && (h === l || l.contains(h)) ? [x, y] : null; }"""


def choose(page: Page, radio: Locator) -> None:
    if radio.evaluate(RADIO_HIT_JS):
        click(radio)
        return
    point = radio.evaluate(LABEL_POINT_JS)
    assert point, "the hidden radio has no hit-testable label"
    page.mouse.click(*point)


def select_range(page: Page, at: int, length: int) -> None:
    caret_start(page)
    for _ in range(at):
        page.keyboard.press("ArrowRight")
    for _ in range(length):
        page.keyboard.press("Shift+ArrowRight")


def card(page: Page, cid: str) -> Locator:
    return page.locator(f'[data-card-id="{cid}"]')


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def record(loc: Locator) -> Any:
    h = loc.element_handle()
    h.evaluate(RECORD_JS)
    return h


def log(h: Any) -> list[str]:
    return [plain(t) for t in h.evaluate("el => el.__log")]


def focus_within(loc: Locator) -> bool:
    return loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def shows_words(page: Page, n: int) -> bool:
    text = page.get_by_role("region", name="Document status").inner_text()
    noun = "word" if n == 1 else "words"
    return re.search(rf"(?<!\d){n} {noun}(?!\w)", text, re.I) is not None


def rgb(hex_colour: str) -> str:
    h = hex_colour.lstrip("#")
    return f"{int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}"


def gone(page: Page, loc: Locator) -> bool:
    if loc.count() == 0:
        return True
    box = loc.first.bounding_box()
    vp = page.viewport_size or {"width": 0, "height": 0}
    return box is None or box["y"] >= vp["height"] or box["y"] + box["height"] <= 0 or not loc.first.is_visible()


def visible_alerts(page: Page) -> list[str]:
    alerts = page.get_by_role("alert")
    return [plain(alerts.nth(i).inner_text()) for i in range(alerts.count()) if alerts.nth(i).is_visible() and alerts.nth(i).inner_text().strip()]


def coord(d: dict, *names: str) -> float:
    for n in names:
        if n in d:
            return float(d[n])
    raise AssertionError(f"motion sample lacks {names}: {d}")


def movement_ms(path: list[dict], axis: tuple[str, ...]) -> float:
    first, final = coord(path[0], *axis), coord(path[-1], *axis)
    times = [coord(p, "t", "time", "ms") for p in path]
    started = [t for p, t in zip(path, times) if abs(coord(p, *axis) - first) > 0.5]
    if not started:
        return 0.0
    moving = [t for p, t in zip(path, times) if abs(coord(p, *axis) - final) > 0.5]
    return max(moving, default=started[0]) - started[0]


def test_wf_home_search_sign_in(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, None, f"/d/{SEED_DOC}") as page:
        wait_ui(page, lambda: page.get_by_role("heading", name="Sign in to Quillmere Drafts").is_visible())
        assert urlparse(page.url).path == "/sign-in"
        fill(page.get_by_role("textbox", name="Email"), TOMAS.email)
        fill(page.get_by_label("Password", exact=True), "wrong-" + token())
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: any("That email and password don't match." in t for t in visible_alerts(page)))
        assert urlparse(page.url).path == "/sign-in"
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: urlparse(page.url).path == f"/d/{SEED_DOC}" and body(page).is_visible())
        me = page.request.get(app_url + "/api/session")
        assert me.status == 200 and me.json()["person"]["email"] == TOMAS.email
    for seat, region in ((DANA, "Shared with me"), (INES, "My proposals")):
        with app_page(browser, app_url, None, "/") as page:
            wait_ui(page, lambda: urlparse(page.url).path == "/sign-in")
            fill(page.get_by_role("textbox", name="Email"), seat.email)
            fill(page.get_by_label("Password", exact=True), PASSWORD)
            click(page.get_by_role("button", name="Sign in"))
            wait_ui(page, lambda: page.get_by_role("heading", name="Documents").is_visible())
            assert urlparse(page.url).path == "/"
            assert page.get_by_role("region", name=region).is_visible()
            assert page.request.get(app_url + "/api/session").json()["person"]["email"] == seat.email


def test_session_api(app_url: str) -> None:
    anon = Api(app_url)
    r = anon.post("/api/session", {"email": INES.email, "password": "wrong-" + token()})
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    assert not r.cookies
    r = anon.post("/api/session", {"password": PASSWORD})
    assert r.status_code == 422 and r.json()["error"] == "invalid" and r.json()["fields"]["email"] == "Enter your email."
    r = anon.post("/api/session", {"email": INES.email})
    assert r.status_code == 422 and r.json()["fields"]["password"] == "Enter your password."
    for seat in SEATS:
        api = Api(app_url, seat)
        p = api.person
        assert p["displayName"] == seat.name and p["email"] == seat.email
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", p["colour"]) and p["personId"]
        assert p["isConsultant"] is (seat == INES)
        r = api.get("/api/session")
        assert r.status_code == 200 and r.json()["person"] == p
    fresh = Api(app_url)
    r = fresh.post("/api/session", {"email": INES.email, "password": PASSWORD})
    cookies = " ".join(r.headers.get_list(SET_COOKIE))
    assert re.search("HttpOnly", cookies, re.I) and re.search("SameSite=Lax", cookies, re.I)
    r = fresh.delete("/api/session")
    assert r.status_code == 204
    r = fresh.get("/api/session")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    missing = "missing" + uuid.uuid4().hex
    routes = [("GET", "/api/session", None), ("GET", "/api/documents", None), ("GET", "/api/documents?view=bogus", None),
              ("POST", "/api/documents", {"title": ""}), ("GET", f"/api/documents/{SEED_DOC}", None),
              ("GET", f"/api/documents/{missing}", None), ("PATCH", f"/api/documents/{SEED_DOC}", {"title": ""}),
              ("DELETE", f"/api/documents/{SEED_DOC}", None), ("GET", f"/api/documents/{SEED_DOC}/shares", None),
              ("POST", f"/api/documents/{SEED_DOC}/shares", {}), ("GET", f"/api/documents/{SEED_DOC}/people", None),
              ("POST", f"/api/documents/{SEED_DOC}/suggestions/{SEED_SUGGESTION}/decision", {"decision": "accept"}),
              ("POST", f"/api/documents/{SEED_DOC}/decisions", {"decision": "accept"}),
              ("POST", f"/api/documents/{SEED_DOC}/comments", {}),
              ("POST", f"/api/documents/{SEED_DOC}/comments/{SEED_COMMENT}/resolve", {}),
              ("GET", "/api/notices", None), ("POST", f"/api/notices/{missing}/read", {})]
    for method, path, payload in routes:
        r = anon.call(method, path, payload)
        assert r.status_code == 401, (method, path, r.status_code, r.text)
        assert r.json() == {"error": "unauthenticated"}
    assert Api(app_url, INES).snap(SEED_DOC)["id"] == SEED_DOC


def test_documents_lists(browser: Browser, app_url: str) -> None:
    ines, tomas, jordan = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, JORDAN)
    doc = make_doc(ines)
    mine = {d["id"]: d for d in ines.docs("mine")}
    assert doc["id"] in mine and mine[doc["id"]]["role"] == "owner"
    assert doc["id"] not in tomas.doc_ids() and doc["id"] not in tomas.doc_ids("shared")
    share(ines, doc["id"], TOMAS, "editor")
    shared = {d["id"]: d for d in tomas.docs("shared")}
    assert shared[doc["id"]]["role"] == "editor" and shared[doc["id"]]["title"] == doc["title"]
    assert tomas.docs("mine") == []
    assert doc["id"] not in tomas.doc_ids("recent")
    with Sock(browser, app_url, TOMAS) as s:
        s.join(doc["id"])
        assert doc["id"] in tomas.doc_ids("recent")
    for view in (None, "recent", "mine", "shared"):
        assert doc["id"] not in jordan.doc_ids(view)
    r = tomas.get("/api/documents", params={"view": "bogus-" + token()})
    assert r.status_code == 422 and r.json()["error"] == "invalid"
    listing = tomas.get("/api/documents")
    owner = [d for d in listing.json()["documents"] if d["id"] == doc["id"]][0]["owner"]
    assert_person(owner)
    assert owner["personId"] == ines.pid
    no_emails(listing.text, INES)
    old = make_doc(ines, "removed")
    old_share = share(ines, old["id"], TOMAS, "viewer")
    with Sock(browser, app_url, TOMAS) as s:
        s.join(old["id"])
    assert old["id"] in tomas.doc_ids("recent") and old["id"] in tomas.doc_ids("shared")
    assert ines.delete(f"/api/documents/{old['id']}/shares/{old_share['shareId']}").status_code == 204
    for view in (None, "recent", "shared"):
        assert old["id"] not in tomas.doc_ids(view)
    assert old["id"] not in tomas.doc_ids(q=old["token"])
    with home(browser, app_url, INES) as page:
        assert page.get_by_role("region", name="Recent").is_visible()
        assert page.get_by_role("region", name="My proposals").is_visible()
        assert page.get_by_role("region", name="Shared with me").count() == 0
        assert page.get_by_role("button", name="New proposal").is_visible()
        wait_ui(page, lambda: page.get_by_role("region", name="My proposals").get_by_role("link", name=doc["title"]).count() == 1)
    with home(browser, app_url, TOMAS) as page:
        assert page.get_by_role("region", name="Recent").is_visible()
        assert page.get_by_role("region", name="My proposals").count() == 0
        assert page.get_by_role("button", name="New proposal").count() == 0
        region = page.get_by_role("region", name="Shared with me")
        wait_ui(page, lambda: region.get_by_role("link", name=doc["title"]).count() == 1)
        assert page.get_by_role("link", name=old["title"]).count() == 0
        fresh = make_doc(ines, "live")
        fresh_share = share(ines, fresh["id"], TOMAS, "commenter")
        fresh_row = region.get_by_role("link", name=fresh["title"], exact=True)
        wait_ui(page, lambda: fresh_row.count() == 1, what="a new share joins the open Shared with me list")
        assert ines.delete(f"/api/documents/{fresh['id']}/shares/{fresh_share['shareId']}").status_code == 204
        wait_ui(page, lambda: fresh_row.count() == 0, what="a removed share leaves the open list")
    with home(browser, app_url, JORDAN) as page:
        wait_ui(page, lambda: page.get_by_role("region", name="Shared with me").is_visible())
        assert page.get_by_role("link", name=doc["title"]).count() == 0


def test_wf_home_search_scoped_search(browser: Browser, app_url: str) -> None:
    ines, tomas, jordan = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, JORDAN)
    tok = token("search")
    a = ines.post("/api/documents", {"title": f"Shared {tok}", "client": f"Alpha {tok}"}).json()
    b = ines.post("/api/documents", {"title": f"Private {tok}", "client": f"Beta {tok}"}).json()
    share(ines, a["id"], TOMAS, "commenter")
    assert set(ines.doc_ids(q=tok)) >= {a["id"], b["id"]}
    assert ines.doc_ids(q=f"beta {tok}".upper()) == [b["id"]]
    assert tomas.doc_ids(q=tok) == [a["id"]]
    assert tomas.doc_ids(q=tok.upper()) == [a["id"]]
    assert tomas.doc_ids(q=f"alpha {tok}") == [a["id"]]
    assert tomas.doc_ids(q=f"beta {tok}") == []
    assert tomas.doc_ids("shared", tok) == [a["id"]]
    assert jordan.doc_ids(q=tok) == []
    with home(browser, app_url, TOMAS, size=VIEWPORTS["phone"]) as page:
        layout(page)
        ann = record(announcements(page))
        box = page.get_by_role("searchbox", name="Search proposals")
        hit(box)
        page.keyboard.type(tok)
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link", name=a["title"]).count() == 1)
        assert results.get_by_role("link", name=b["title"]).count() == 0
        assert page.get_by_role("region", name="Shared with me").count() == 0
        layout(page)
        advance(page, ANNOUNCE_DELAY_MS)
        wait_ui(page, lambda: "1 proposal" in log(ann))
        advance(page, ANNOUNCE_DELAY_MS * 3)
        assert log(ann).count("1 proposal") == 1
        for _ in range(4):
            page.keyboard.press("Backspace")
        page.keyboard.type("zzzz")
        advance(page, ANNOUNCE_DELAY_MS)
        wait_ui(page, lambda: "No proposals match" in log(ann))
        assert results.get_by_role("link", name=a["title"]).count() == 0


def test_create_proposal(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    tok = token("create")
    r = tomas.post("/api/documents", {"title": f"Rogue {tok}", "client": f"Rogue {tok}"})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    r = tomas.post("/api/documents", {"title": "", "client": ""})
    assert r.status_code == 403
    assert ines.doc_ids(q=f"Rogue {tok}") == []
    r = ines.post("/api/documents", {"title": "", "client": ""})
    assert r.status_code == 422
    assert r.json()["fields"] == {"title": "Enter a title of 1 to 120 characters.", "client": "Enter a client name of 1 to 80 characters."}
    r = ines.post("/api/documents", {"title": "t" * (TITLE_MAX + 1), "client": "ok"})
    assert r.status_code == 422 and r.json()["fields"]["title"] == "Enter a title of 1 to 120 characters."
    r = ines.post("/api/documents", {"title": "ok", "client": "c" * (CLIENT_MAX + 1)})
    assert r.status_code == 422 and r.json()["fields"]["client"] == "Enter a client name of 1 to 80 characters."
    r = ines.post("/api/documents", {"title": f"API {tok}", "client": f"Client {tok}"})
    assert r.status_code == 201
    doc = r.json()
    assert re.fullmatch(r"[A-Za-z0-9_-]{16,}", doc["id"]) and doc["role"] == "owner"
    assert doc["title"] == f"API {tok}" and doc["client"] == f"Client {tok}"
    assert doc["owner"]["personId"] == ines.pid
    own = shares(ines, doc["id"])
    assert len(own) == 1 and own[0]["person"]["personId"] == ines.pid and own[0]["person"]["role"] == "owner"
    with home(browser, app_url, INES) as page:
        hit(page.get_by_role("button", name="New proposal"))
        dialog = page.get_by_role("dialog", name="New proposal")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Title"), f"Dialog {tok}")
        fill(dialog.get_by_role("textbox", name="Client"), f"Dialog client {tok}")
        click(dialog.get_by_role("button", name="Create"))
        wait_ui(page, lambda: urlparse(page.url).path.startswith("/d/") and body(page).is_visible())
        new_id = urlparse(page.url).path.split("/")[2]
        wait_ui(page, lambda: page.get_by_role("textbox", name="Proposal title").input_value() == f"Dialog {tok}")
    snap = ines.snap(new_id)
    assert snap["title"] == f"Dialog {tok}" and snap["client"] == f"Dialog client {tok}"
    assert snap["myAccess"]["role"] == "owner"
    assert new_id in ines.doc_ids("mine")


def test_wf_create_share_happy(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    doc = make_doc(ines)
    ends = (server_time(doc) + timedelta(days=SHARE_END_DAYS)).replace(second=0, microsecond=0)
    with ExitStack() as st:
        th = st.enter_context(home(browser, app_url, TOMAS))
        page = st.enter_context(editor(browser, app_url, INES, doc["id"]))
        hit(page.get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name="Share proposal")
        wait_ui(page, dialog.is_visible)
        ann = record(announcements(page))

        def add(seat: Seat, role: str, end_local: str | None = None) -> None:
            fill(dialog.get_by_role("textbox", name="Email"), seat.email)
            select(dialog.get_by_role("combobox", name="Access", exact=True), role)
            if end_local:
                check(dialog.get_by_role("checkbox", name="Set an end time"))
                fill(dialog.get_by_label("Access ends"), end_local)
            click(dialog.get_by_role("button", name="Add person"))
            wait_ui(page, lambda: f"Shared with {seat.name} as {role}" in log(ann))

        add(TOMAS, "Editor")
        shared_tomas = th.get_by_role("region", name="Shared with me").get_by_role("link", name=doc["title"], exact=True)
        wait_ui([page, th], lambda: shared_tomas.count() == 1, what="Shared with me updates without a reload")
        add(DANA, "Viewer")
        local = page.evaluate("""iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }""", iso(ends))
        add(PRIYA, "Commenter", local)
        people = dialog.get_by_role("list", name="People with access")
        for seat, role in ((TOMAS, "Editor"), (DANA, "Viewer"), (PRIYA, "Commenter")):
            item = people.get_by_role("listitem").filter(has_text=seat.name)
            wait_ui(page, lambda: item.count() == 1)
            text = item.inner_text().casefold()
            assert role.casefold() in text and seat.email.casefold() in text
        assert "until" in people.get_by_role("listitem").filter(has_text=PRIYA.name).inner_text().casefold()
        advance(page, ANNOUNCE_DELAY_MS * 3)
        said = log(ann)
        for seat, role in ((TOMAS, "Editor"), (DANA, "Viewer"), (PRIYA, "Commenter")):
            assert said.count(f"Shared with {seat.name} as {role}") == 1, said
    by_email = {s["email"]: s for s in shares(ines, doc["id"]) if "email" in s}
    assert by_email[TOMAS.email]["role"] == "editor" and by_email[TOMAS.email]["endsAt"] is None
    assert by_email[DANA.email]["role"] == "viewer"
    assert by_email[PRIYA.email]["role"] == "commenter" and by_email[PRIYA.email]["endsAt"] == iso(ends)
    assert all(s["status"] == "active" for s in by_email.values())
    for seat in (TOMAS, DANA, PRIYA):
        api = Api(app_url, seat)
        assert doc["id"] in api.doc_ids("shared")
        assert any(n["documentId"] == doc["id"] and n["kind"] == "shared" for n in api.notices()["notices"])


def test_wf_create_share_invalid(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    doc = make_doc(ines)
    with editor(browser, app_url, INES, doc["id"]) as page:
        hit(page.get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name="Share proposal")
        wait_ui(page, dialog.is_visible)
        email = dialog.get_by_role("textbox", name="Email")

        def attempt(address: str, expected: str) -> None:
            fill(email, address)
            select(dialog.get_by_role("combobox", name="Access", exact=True), "Editor")
            click(dialog.get_by_role("button", name="Add person"))
            wait_ui(page, lambda: expected in dialog.inner_text(), what=expected)

        attempt(f"nobody-{token()}@quillmere.test", "No Quillmere account uses this email.")
        assert focus_within(email)
        attempt(INES.email, "You already own this proposal.")
        ann = record(announcements(page))
        fill(email, TOMAS.email)
        click(dialog.get_by_role("button", name="Add person"))
        wait_ui(page, lambda: f"Shared with {TOMAS.name} as Editor" in log(ann))
        attempt(TOMAS.email, "This person already has access.")
    entries = shares(ines, doc["id"])
    assert len(entries) == 2 and [s["email"] for s in entries if "email" in s] == [TOMAS.email]


def test_share_rules(app_url: str) -> None:
    ines, tomas, jordan = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, JORDAN)
    doc = make_doc(ines)
    did = doc["id"]
    ref = server_time(doc)
    path = f"/api/documents/{did}/shares"
    cases = [({"email": f"nobody-{token()}@quillmere.test", "role": "editor", "endsAt": None}, "email", "No Quillmere account uses this email."),
             ({"email": INES.email, "role": "editor", "endsAt": None}, "email", "You already own this proposal."),
             ({"email": DANA.email, "role": "owner", "endsAt": None}, "role", "Choose Editor, Commenter or Viewer."),
             ({"email": DANA.email, "role": "viewer", "endsAt": iso(ref)}, "endsAt", "Pick an end time in the future."),
             ({"email": DANA.email, "role": "viewer", "endsAt": iso(ref + timedelta(days=SHARE_MAX_DAYS + 1))}, "endsAt", "Pick an end time within a year.")]
    for payload, field, message in cases:
        r = ines.post(path, payload)
        assert r.status_code == 422, (payload, r.text)
        assert r.json()["error"] == "invalid" and r.json()["fields"][field] == message
    assert len(shares(ines, did)) == 1
    r = ines.post(path, {"email": DANA.email, "role": "viewer", "endsAt": iso(ref + timedelta(days=SHARE_MAX_DAYS))})
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["email"] == DANA.email and created["role"] == "viewer" and created["status"] == "active"
    assert len(created["shareId"]) >= 16
    tshare = share(ines, did, TOMAS, "editor")
    r = ines.post(path, {"email": TOMAS.email, "role": "viewer", "endsAt": None})
    assert r.status_code == 409 and r.json() == {"error": "already_shared"}
    r = tomas.post(path, {"email": PRIYA.email, "role": "owner", "endsAt": None})
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    r = tomas.patch(f"{path}/{created['shareId']}", {"role": "editor"})
    assert r.status_code == 403
    r = tomas.delete(f"{path}/{created['shareId']}")
    assert r.status_code == 403
    not_found(jordan.post(path, {"email": PRIYA.email, "role": "viewer", "endsAt": None}))
    assert share_of(ines, did, DANA)["role"] == "viewer"
    assert PRIYA.email not in json.dumps(shares(ines, did))
    r = ines.patch(f"{path}/{tshare['shareId']}", {"role": "commenter"})
    assert r.status_code == 200 and r.json()["role"] == "commenter"
    new_end = iso(ref + timedelta(days=SHARE_END_DAYS))
    r = ines.patch(f"{path}/{tshare['shareId']}", {"endsAt": new_end})
    assert r.status_code == 200 and r.json()["endsAt"] == new_end and r.json()["role"] == "commenter"
    r = ines.patch(f"{path}/{tshare['shareId']}", {"role": "owner"})
    assert r.status_code == 422 and r.json()["fields"]["role"] == "Choose Editor, Commenter or Viewer."
    assert ines.delete(f"{path}/{tshare['shareId']}").status_code == 204
    assert all(s.get("email") != TOMAS.email for s in shares(ines, did))
    not_found(ines.patch(f"{path}/{tshare['shareId']}", {"role": "viewer"}))
    not_found(ines.delete(f"{path}/{tshare['shareId']}"))
    not_found(tomas.get(f"/api/documents/{did}"))


def test_people_projection(browser: Browser, app_url: str) -> None:
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Projection text for review.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        made_comment(priya, did, 0, 10, "A note", [ines.pid])
        owner_view = shares(ines, did)
        assert owner_view[0]["person"]["personId"] == ines.pid and owner_view[0]["person"]["role"] == "owner"
        emails = {s["email"] for s in owner_view[1:]}
        assert emails == {TOMAS.email, PRIYA.email}
        for s in owner_view[1:]:
            assert_person(s["person"])
        others = [(tomas, [INES, PRIYA]), (priya, [INES, TOMAS])]
        for api, foreign in others:
            r = api.get(f"/api/documents/{did}/shares")
            assert r.status_code == 200
            for entry in r.json()["shares"]:
                assert set(entry) == {"person"}
                assert_person(entry["person"])
            roles = {e["person"]["displayName"]: e["person"]["role"] for e in r.json()["shares"]}
            assert roles == {INES.name: "owner", TOMAS.name: "editor", PRIYA.name: "commenter"}
            texts = [r.text]
            snap = api.get(f"/api/documents/{did}")
            texts.append(snap.text)
            for p in snap.json()["people"]:
                assert_person(p)
            for c in snap.json()["comments"]:
                assert_person(c["author"])
                for m in c["mentions"]:
                    assert_person(m)
            people = api.get(f"/api/documents/{did}/people")
            texts.append(people.text)
            for p in people.json()["people"]:
                assert_person(p)
            listing = api.get("/api/documents")
            texts.append(listing.text)
            for d in listing.json()["documents"]:
                assert_person(d["owner"])
            notes = api.get("/api/notices")
            texts.append(notes.text)
            for n in notes.json()["notices"]:
                assert set(n["actor"]) <= PERSON_KEYS
            for t in texts:
                no_emails(t, *foreign)
        s_tomas = joined(st, browser, app_url, TOMAS, did)
        mark = s_tomas.mark()
        s_priya = st.enter_context(Sock(browser, app_url, PRIYA))
        j = s_priya.join(did)
        for entry in j["people"]:
            assert_person(entry["person"])
        no_emails(json.dumps(j), INES, TOMAS)
        pres = s_tomas.wait(lambda f: f.get("type") == "presence" and f["person"]["personId"] == priya.pid, since=mark)
        assert_person(pres["person"], "commenter")
        assert s_priya.send({"type": "caret", "at": 3, "length": 0})["type"] == "ack"
        caret = s_tomas.wait(lambda f: f.get("type") == "caret" and f["person"]["personId"] == priya.pid, since=mark)
        assert_person(caret["person"], "commenter")
        no_emails(json.dumps(s_tomas.frames()), INES, PRIYA)


def test_unshared_looks_absent(browser: Browser, app_url: str) -> None:
    ines, tomas, jordan = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, JORDAN)
    missing = "missing" + uuid.uuid4().hex
    with ExitStack() as st:
        secret = token("secret")
        doc, s_ines = seeded(st, browser, app_url, ines, f"{secret} narrative text.", ((TOMAS, "editor"),))
        did = doc["id"]
        cm = made_comment(ines, did, 0, 6, "Owner note")
        other, _ = seeded(st, browser, app_url, ines, "Other client text.")
        cm_other = made_comment(ines, other["id"], 0, 5, "Elsewhere")
        s_ines.op("suggesting", [{"insert": "X", "at": 1}])
        sid = ines.snap(did)["suggestions"][0]["id"]
        calls = [("GET", "", None), ("GET", "/shares", None), ("GET", "/people", None),
                 ("PATCH", "", {"title": "Taken"}), ("DELETE", "", None),
                 ("POST", "/shares", {"email": PRIYA.email, "role": "viewer", "endsAt": None}),
                 ("POST", "/comments", {"anchor": {"at": 0, "length": 3}, "body": "hi", "mentions": []}),
                 ("POST", f"/comments/{cm['id']}/resolve", {}), ("POST", f"/suggestions/{sid}/decision", {"decision": "accept"}),
                 ("POST", "/decisions", {"decision": "accept"})]
        for method, suffix, payload in calls:
            real = jordan.call(method, f"/api/documents/{did}{suffix}", payload)
            fake = jordan.call(method, f"/api/documents/{missing}{suffix}", payload)
            not_found(real)
            assert (real.status_code, real.json()) == (fake.status_code, fake.json())
            assert secret not in real.text and doc["title"] not in real.text
        not_found(tomas.post(f"/api/documents/{did}/comments/{cm_other['id']}/resolve"))
        not_found(comment(tomas, did, 0, 0, "reply", parent=cm_other["id"]))
        assert cm_other["status"] == ines.snap(other["id"])["comments"][0]["status"] == "open"
        s_tomas = joined(st, browser, app_url, TOMAS, did)
        j1 = st.enter_context(Sock(browser, app_url, JORDAN))
        j2 = st.enter_context(Sock(browser, app_url, JORDAN))
        e1 = j1.send({"type": "join", "documentId": did, "revision": 0})
        e2 = j2.send({"type": "join", "documentId": missing, "revision": 0})
        assert e1["type"] == e2["type"] == "error" and e1["code"] == e2["code"] == "not_found"
        mark = s_tomas.mark()
        s_ines.ok_op("editing", [{"insert": "More ", "at": 0}])
        s_tomas.wait(lambda f: f.get("type") == "op", since=mark)
        assert [f["type"] for f in j1.frames()] == ["error"]
        assert secret not in json.dumps(j1.frames())
    with app_page(browser, app_url, JORDAN, f"/d/{did}") as page:
        wait_ui(page, lambda: page.get_by_role("heading", name="Proposal not found").is_visible())
        real_text = plain(norm(page.locator("body").inner_text()))
        assert "This proposal doesn't exist or isn't shared with you." in real_text
        assert page.get_by_role("link", name="Back to documents").is_visible()
        assert doc["title"] not in real_text and secret not in real_text
        page.goto(app_url + f"/d/{missing}")
        wait_ui(page, lambda: page.get_by_role("heading", name="Proposal not found").is_visible())
        assert plain(norm(page.locator("body").inner_text())) == real_text


def test_wf_live_co_editing_two_browsers(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        base_text, head, tail = "Opening line here", "Draft ", " plus more words"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        a = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["desktop"]))
        b = st.enter_context(editor(browser, app_url, TOMAS, did, size=VIEWPORTS["tablet"]))
        both = [a, b]
        wait_ui(both, lambda: shows_words(a, 3) and shows_words(b, 3))
        for p in both:
            layout(p)
        pa = body(a).bounding_box()
        outline_a = a.get_by_role("navigation", name="Outline").bounding_box()
        assert outline_a["x"] + outline_a["width"] <= pa["x"] + ALIGN_TOL_PX
        assert a.get_by_role("complementary", name="Margin").bounding_box()["x"] >= pa["x"] + pa["width"] - ALIGN_TOL_PX
        pb = body(b).bounding_box()
        assert b.get_by_role("button", name="Outline").get_attribute("aria-expanded") == "false"
        assert b.get_by_role("complementary", name="Margin").bounding_box()["x"] >= pb["x"] + pb["width"] - ALIGN_TOL_PX
        caret_end(b)
        b.keyboard.type(tail)
        wait_ui(both, lambda: tail.strip() in body_text(a), what="remote text on the Owner's screen")
        wait_ui(both, lambda: shows_words(a, 6))
        wait_ui(both, lambda: a.evaluate(LABEL_VISIBLE_JS, [tomas.pid, TOMAS.name]), what="Tomas's caret label")
        caret_start(a)
        a.keyboard.type(head)
        wait_ui(both, lambda: body_text(b).startswith(norm(head + base_text)))
        wait_ui(both, lambda: shows_words(b, 7))
        wait_ui(both, lambda: b.evaluate(LABEL_VISIBLE_JS, [ines.pid, INES.name]), what="Ines's caret label")
        final = ines.snap(did)["text"]
        assert final == head + base_text + tail
        wait_ui(both, lambda: body_text(a) == body_text(b) == norm(final))
        for p in both:
            assert [urlparse(u).path for u in WS_LOG[id(p)]] == ["/api/socket"]


def test_wf_live_co_editing_same_spot(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "start here", ((TOMAS, "editor"),))
        a = st.enter_context(editor(browser, app_url, INES, doc["id"]))
        b = st.enter_context(editor(browser, app_url, TOMAS, doc["id"]))
        caret_end(a)
        caret_end(b)
        for _ in range(3):
            a.keyboard.type("A")
            b.keyboard.type("B")
        wait_ui([a, b], lambda: body_text(a).count("A") == 3 and body_text(a).count("B") == 3
                and body_text(a) == body_text(b), what="convergence")
        text = ines.snap(doc["id"])["text"]
        assert text.startswith("start here") and text.count("A") == 3 and text.count("B") == 3
        assert body_text(a) == body_text(b) == norm(text)


def test_server_ordered_merge(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        doc, s1 = seeded(st, browser, app_url, ines, "abcdef", ((TOMAS, "editor"),))
        did = doc["id"]
        s2 = joined(st, browser, app_url, TOMAS, did)
        base = ines.snap(did)["revision"]
        m1, m2 = s1.mark(), s2.mark()
        r1 = s1.emit({"type": "op", "baseRevision": base, "mode": "editing", "ops": [{"insert": "XX", "at": 3}]})
        r2 = s2.emit({"type": "op", "baseRevision": base, "mode": "editing", "ops": [{"insert": "YY", "at": 3}]})
        a1, a2 = s1.reply(r1), s2.reply(r2)
        assert a1["type"] == a2["type"] == "ack"
        assert {a1["revision"], a2["revision"]} == {base + 1, base + 2}
        first, second = ("XX", "YY") if a1["revision"] < a2["revision"] else ("YY", "XX")
        snap = ines.snap(did)
        assert snap["text"] == "abc" + first + second + "def" and snap["revision"] == base + 2
        s1.wait(lambda f: f.get("type") == "op" and f["authorId"] == s2.pid, since=m1)
        s2.wait(lambda f: f.get("type") == "op" and f["authorId"] == s1.pid, since=m2)
        base = snap["revision"]
        r1 = s1.emit({"type": "op", "baseRevision": base, "mode": "editing", "ops": [{"delete": 2, "at": 0}]})
        r2 = s2.emit({"type": "op", "baseRevision": base, "mode": "editing", "ops": [{"delete": 2, "at": 1}]})
        assert s1.reply(r1)["type"] == s2.reply(r2)["type"] == "ack"
        assert ines.snap(did)["text"] == first + second + "def"


def test_live_carets(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Caret moves along this single line", ((TOMAS, "editor"),))
        s_tomas = joined(st, browser, app_url, TOMAS, doc["id"])
        mark = s_ines.mark()
        t0 = time.monotonic()
        assert s_tomas.send({"type": "caret", "at": 2, "length": 0})["type"] == "ack"
        f = s_ines.wait(lambda f: f.get("type") == "caret" and f["person"]["personId"] == tomas.pid,
                        seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        assert f["at"] == 2 and time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        page = st.enter_context(editor(browser, app_url, INES, doc["id"]))
        s_tomas.send({"type": "caret", "at": 1, "length": 0})
        wait_ui(page, lambda: page.evaluate(LABEL_VISIBLE_JS, [tomas.pid, TOMAS.name]))
        caret = page.locator(f'[data-caret-for="{tomas.pid}"]')
        assert rgb(tomas.person["colour"]) in caret.evaluate(COLOURS_JS)
        x1 = caret.bounding_box()["x"]
        s_tomas.send({"type": "caret", "at": 20, "length": 0})
        wait_ui(page, lambda: caret.bounding_box()["x"] > x1 + 1, what="caret to follow the move")


def test_idle_caret_labels(browser: Browser) -> None:
    base = os.environ["APP_SHORT_IDLE_URL"]
    ines, tomas = Api(base, INES), Api(base, TOMAS)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, base, ines, "Idle labels on this line", ((TOMAS, "editor"), (DANA, "viewer")))
        did = doc["id"]
        s_dana = joined(st, browser, base, DANA, did)
        page = st.enter_context(editor(browser, base, INES, did))
        s_tomas = joined(st, browser, base, TOMAS, did)
        mark = s_dana.mark()
        s_tomas.send({"type": "caret", "at": 3, "length": 0})
        t_input = time.monotonic()
        wait_ui(page, lambda: page.evaluate(LABEL_VISIBLE_JS, [tomas.pid, TOMAS.name]))
        assert s_tomas.send({"type": "heartbeat"})["type"] == "ack"
        idle = s_dana.wait(lambda f: f.get("type") == "presence" and f["person"]["personId"] == tomas.pid and f["state"] == "idle",
                           seconds=SHORT_IDLE_S + LIVE_S + HARNESS_SLACK_S * 2, since=mark)
        elapsed = time.monotonic() - t_input
        assert idle and elapsed >= SHORT_IDLE_S - HARNESS_SLACK_S, elapsed
        wait_ui(page, lambda: not page.evaluate(LABEL_VISIBLE_JS, [tomas.pid, TOMAS.name]), what="label hidden")
        mark = s_dana.mark()
        t0 = time.monotonic()
        s_tomas.send({"type": "caret", "at": 5, "length": 0})
        s_dana.wait(lambda f: f.get("type") == "presence" and f["person"]["personId"] == tomas.pid and f["state"] == "active",
                    seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        assert time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        wait_ui(page, lambda: page.evaluate(LABEL_VISIBLE_JS, [tomas.pid, TOMAS.name]), what="label back")


def test_live_word_count(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "solo", ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        page = st.enter_context(editor(browser, app_url, INES, did))
        wait_ui(page, lambda: shows_words(page, 1))
        s_t.ok_op("editing", [{"insert": " two three", "at": 4}])
        wait_ui(page, lambda: shows_words(page, 3))
        s_t.mode("suggesting")
        s_t.ok_op("suggesting", [{"insert": " four", "at": 14}])
        s1 = sugs(ines.snap(did), tomas.pid)[0]["id"]
        wait_ui(page, lambda: card(page, s1).count() == 1)
        assert shows_words(page, 3)
        s_t.ok_op("suggesting", [{"delete": 4, "at": 0}])
        ids = {s["id"] for s in sugs(ines.snap(did), tomas.pid)}
        assert len(ids) == 2
        wait_ui(page, lambda: all(card(page, i).count() == 1 for i in ids))
        assert shows_words(page, 3)
        s_t.mode("editing")
        end = len(ines.snap(did)["text"])
        s_t.ok_op("editing", [{"insert": " five", "at": end}])
        wait_ui(page, lambda: shows_words(page, 4))
        caret_end(page)
        page.keyboard.type(" six")
        wait_ui(page, lambda: shows_words(page, 5))
        wait_ui(page, lambda: ines.snap(did)["text"].endswith(" five six"), what="the last typed word stored")


def test_formatting_styles(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        first_line, second_line = "Alpha", "Beta gamma"
        doc, s_ines = seeded(st, browser, app_url, ines, f"{first_line}\n{second_line}", ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        mark = s_t.mark()
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        page = st.enter_context(editor(browser, app_url, INES, did))
        both = [page, b]
        toolbar = page.get_by_role("toolbar", name="Formatting")

        def pressed(name: str) -> bool:
            return toolbar.get_by_role("button", name=name, exact=True).get_attribute("aria-pressed") == "true"

        def covered(kind: str, marks: list[dict] | None = None) -> set[int]:
            return {i for m in (ines.snap(did)["marks"] if marks is None else marks) if m["type"] == kind
                    for i in range(m["at"], m["at"] + m["length"])}

        def block_style(at: int) -> str | None:
            return next((bl["style"] for bl in ines.snap(did)["blocks"] if bl["at"] == at), None)

        alpha, beta_at = set(range(0, 5)), 6
        caret_start(page)
        page.keyboard.press("Shift+End")
        page.keyboard.press("Control+b")
        wait_ui(both, lambda: covered("bold") == alpha and pressed("Bold"), what="Ctrl+B bold, reported pressed")
        page.keyboard.press("Control+u")
        wait_ui(both, lambda: covered("underline") == alpha and pressed("Underline"), what="Ctrl+U underline")
        page.keyboard.press("Control+u")
        wait_ui(both, lambda: covered("underline") == set() and not pressed("Underline"), what="Ctrl+U toggles off")
        page.keyboard.press("Control+i")
        wait_ui(both, lambda: covered("italic") == alpha and pressed("Italic") and pressed("Bold"), what="Ctrl+I italic")
        wait_ui(both, lambda: (body(b).evaluate(WEIGHT_JS, first_line) or 0) >= 600, what="bold on the other screen")
        caret_end(page)
        wait_ui(both, lambda: not pressed("Bold"), what="toolbar follows the caret")
        page.keyboard.press("Control+Alt+3")
        wait_ui(both, lambda: block_style(beta_at) == "heading3" and style_shown(page) == "heading 3", what="Ctrl+Alt+3")
        page.keyboard.press("Control+Alt+1")
        wait_ui(both, lambda: block_style(beta_at) == "heading1" and style_shown(page) == "heading 1", what="Ctrl+Alt+1")
        outline_b = b.get_by_role("listbox", name="Headings")
        wait_ui(both, lambda: outline_b.get_by_role("option", name=second_line, exact=True).count() == 1,
                what="heading in the other screen's outline")
        frames = s_t.frames()[mark:]
        assert any(f.get("type") == "op" and any(o.get("mark") == "bold" and o.get("value") is True for o in f["ops"]) for f in frames)
        s_t.wait(lambda f: f.get("type") == "op" and any(o.get("style") == "heading3" for o in f["ops"]), since=mark)
        rev = ines.snap(did)["revision"]
        s_ines.saved(rev)
        stored = json.loads(S3().get(f"documents/{did}.json"))
        assert stored["revision"] >= rev
        assert covered("bold", stored["marks"]) == alpha and covered("italic", stored["marks"]) == alpha
        assert covered("underline", stored["marks"]) == set()
        assert any(bl["style"] == "heading1" and bl["at"] == beta_at for bl in stored["blocks"])
        b.reload()
        wait_ui(b, lambda: body(b).is_visible() and (body(b).evaluate(WEIGHT_JS, first_line) or 0) >= 600, what="bold after reload")
        wait_ui(b, lambda: outline_b.get_by_role("option", name=second_line, exact=True).count() == 1, what="heading after reload")


def test_wf_suggesting_ui(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        first_word, old, new, tail = "The", "books", "novels", " More"
        doc, _ = seeded(st, browser, app_url, ines, f"{first_word} budget covers {old} for the year.", ((TOMAS, "editor"),))
        did = doc["id"]
        a = st.enter_context(editor(browser, app_url, INES, did))
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        both = [a, b]
        choose(b, b.get_by_role("radio", name="Suggesting"))
        wait_ui(both, lambda: b.get_by_role("radio", name="Suggesting").is_checked())
        caret_end(b)
        b.keyboard.type(tail)
        articles = a.get_by_role("article", name=f"Suggestion by {TOMAS.name}")
        wait_ui(both, lambda: articles.count() == 1, what="insert card on the Owner's screen")
        select_range(b, 0, 3)
        b.keyboard.press("Delete")
        wait_ui(both, lambda: articles.count() == 2)
        select_range(b, 18, 5)
        b.keyboard.type(new)
        wait_ui(both, lambda: articles.count() == 3)
        margin = a.get_by_role("complementary", name="Margin")
        wait_ui(both, lambda: f"Replace “{old}” with “{new}”" in margin.inner_text() and f"Delete “{first_word}”" in margin.inner_text())
        assert "Insert" in margin.inner_text()
        for i in range(3):
            text = articles.nth(i).inner_text().casefold()
            assert TOMAS.name.casefold() in text and "editor" in text
        assert b.get_by_role("article", name=f"Suggestion by {TOMAS.name}").count() == 3
        snap = ines.snap(did)
        mine = sugs(snap, tomas.pid)
        assert {s["kind"] for s in mine} == {"insert", "delete", "replace"} and len(mine) == 3
        rep = sugs(snap, tomas.pid, "replace")[0]
        assert span(snap["text"], rep["deleted"]) == old and span(snap["text"], rep["inserted"]) == new
        assert span(snap["text"], sugs(snap, tomas.pid, "delete")[0]["deleted"]) == first_word
        assert span(snap["text"], sugs(snap, tomas.pid, "insert")[0]["inserted"]) == tail
        assert snap["text"].startswith(f"{first_word} budget covers {old}")


def test_wf_suggesting_word_keys(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        old, new = "9,600 now.", "12,000 later."
        doc, _ = seeded(st, browser, app_url, ines, f"Fund 240 families. Costs ${old}", ((TOMAS, "editor"),))
        did = doc["id"]
        a = st.enter_context(editor(browser, app_url, INES, did))
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        both = [a, b]
        choose(b, b.get_by_role("radio", name="Suggesting"))
        wait_ui(both, lambda: b.get_by_role("radio", name="Suggesting").is_checked())

        def walk(steps: list[tuple[str, str]]) -> None:
            for key, expected in steps:
                b.keyboard.press(key)
                wait_ui(b, lambda: b.evaluate(SELECTION_JS) == expected, what=f"{key} selects {expected!r}")

        caret_start(b)
        walk([("Control+Shift+ArrowRight", "Fund"), ("Control+Shift+ArrowRight", "Fund 240"),
              ("Control+Shift+ArrowRight", "Fund 240 families"), ("Shift+ArrowRight", "Fund 240 families."),
              ("Shift+ArrowLeft", "Fund 240 families"), ("Shift+ArrowLeft", "Fund 240 familie"),
              ("Control+Shift+ArrowLeft", "Fund 240 ")])
        caret_end(b)
        walk([("Control+Shift+ArrowLeft", "now."), ("Control+Shift+ArrowLeft", "600 now."),
              ("Control+Shift+ArrowLeft", old)])
        b.keyboard.type(new)

        def replaced() -> bool:
            snap = ines.snap(did)
            mine = sugs(snap, tomas.pid)
            return (len(mine) == 1 and mine[0]["kind"] == "replace" and span(snap["text"], mine[0]["deleted"]) == old
                    and span(snap["text"], mine[0]["inserted"]) == new)

        wait_ui(both, replaced, what="one credited replacement")
        cards = a.get_by_role("article", name=f"Suggestion by {TOMAS.name}")
        wait_ui(both, lambda: cards.count() == 1 and f"Replace “{old}” with “{new}”".casefold() in cards.inner_text().casefold(),
                what="replacement card on the Owner's screen")
        assert ines.snap(did)["text"].startswith("Fund 240 families. Costs $")


def test_credited_spans(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        base_text = "We plan for the year ahead."
        replaced = base_text[:20] + "term" + base_text[20:]
        doc, s_ines = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.mode("suggesting")
        s_t.ok_op("suggesting", [{"delete": 4, "at": 16}, {"insert": "term", "at": 20}])
        snap = ines.snap(did)
        assert snap["text"] == replaced
        (rep,) = sugs(snap, tomas.pid)
        assert rep["kind"] == "replace" and rep["deleted"] == {"at": 16, "length": 4} and rep["inserted"] == {"at": 20, "length": 4}
        s_t.ok_op("suggesting", [{"insert": " soon", "at": 31}])
        (ins,) = sugs(ines.snap(did), tomas.pid, "insert")
        assert ins["inserted"] == {"at": 31, "length": 5}
        mark = s_ines.mark()
        s_t.ok_op("suggesting", [{"insert": "er", "at": 36}])
        snap = ines.snap(did)
        assert [s["inserted"] for s in sugs(snap, tomas.pid, "insert")] == [{"at": 31, "length": 7}]
        assert sugs(snap, tomas.pid, "insert")[0]["id"] == ins["id"] and len(sugs(snap, tomas.pid)) == 2
        s_t.ok_op("suggesting", [{"delete": 2, "at": 36}])
        assert [s["inserted"] for s in sugs(ines.snap(did), tomas.pid, "insert")] == [{"at": 31, "length": 5}]
        assert not any(f.get("type") == "card_added" and f["card"]["id"] != ins["id"] for f in s_ines.frames()[mark:])
        s_t.ok_op("suggesting", [{"delete": 5, "at": 31}])
        closed = s_ines.wait(lambda f: f.get("type") == "card_closed" and f["cardId"] == ins["id"], since=mark)
        assert closed["status"] == "rejected" and closed["decidedBy"]["personId"] == tomas.pid
        snap = ines.snap(did)
        assert snap["text"] == replaced and ins["id"] not in {s["id"] for s in snap["suggestions"]}
        s_t.ok_op("suggesting", [{"delete": 2, "at": 0}])
        (dele,) = sugs(ines.snap(did), tomas.pid, "delete")
        assert dele["deleted"] == {"at": 0, "length": 2} and ines.snap(did)["text"].startswith("We plan")
        s_t.ok_op("suggesting", [{"delete": 1, "at": 2}])
        snap = ines.snap(did)
        assert [s["deleted"] for s in sugs(snap, tomas.pid, "delete")] == [{"at": 0, "length": 3}]
        s_t.mode("editing")
        s_t.ok_op("editing", [{"insert": "Z", "at": 24}])
        snap = ines.snap(did)
        rep_now = [s for s in snap["suggestions"] if s["id"] == rep["id"]][0]
        assert rep_now["inserted"]["length"] == 4 and span(snap["text"], rep_now["inserted"]) == "term"


def test_edits_inside_other_suggestion(browser: Browser, app_url: str) -> None:
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    with ExitStack() as st:
        base_text, added, mark_x = "Books for families.", " and kids", "X"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_p = joined(st, browser, app_url, PRIYA, did)
        s_t.mode("suggesting")
        s_t.ok_op("suggesting", [{"insert": added, "at": 18}])
        (s1,) = sugs(ines.snap(did), tomas.pid)
        s_p.ok_op("suggesting", [{"insert": mark_x, "at": 22}])
        snap = ines.snap(did)
        (pins,) = sugs(snap, priya.pid, "insert")
        assert span(snap["text"], pins["inserted"]) == mark_x and pins["id"] != s1["id"]
        assert all(s["author"]["personId"] == tomas.pid for s in snap["suggestions"] if s["id"] == s1["id"])
        s_p.ok_op("suggesting", [{"delete": 4, "at": 18}])
        snap = ines.snap(did)
        (pdel,) = sugs(snap, priya.pid, "delete")
        assert span(snap["text"], pdel["deleted"]) == " and"
        assert s1["id"] in {s["id"] for s in sugs(snap, tomas.pid)}
        assert snap["text"] == base_text[:18] + added[:4] + mark_x + added[4:] + base_text[18:]


def test_commenter_refused(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Plain grant text.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": " more", "at": 16}])
        before = ines.snap(did)
        sid = before["suggestions"][0]["id"]
        tshare = share_of(ines, did, TOMAS)
        shares_before = shares(ines, did)
        s_p = joined(st, browser, app_url, PRIYA, did)
        rev = before["revision"]
        frames = [{"type": "op", "baseRevision": rev, "mode": "editing", "ops": [{"insert": "Z", "at": 0}]},
                  {"type": "op", "baseRevision": rev, "mode": "editing", "ops": [{"mark": "bold", "value": True, "at": 0, "length": 5}]},
                  {"type": "op", "baseRevision": rev, "mode": "editing", "ops": [{"style": "heading1", "at": 0}]},
                  {"type": "mode", "mode": "editing"},
                  {"type": "replace_all", "baseRevision": rev, "mode": "editing", "find": "grant", "replace": "award", "matchCase": False},
                  {"type": "decide", "suggestionId": sid, "decision": "accept"},
                  {"type": "decide_all", "decision": "reject"},
                  {"type": "share", "shareId": tshare["shareId"], "role": "viewer"}]
        for frame in frames:
            r = s_p.send(frame)
            assert r["type"] == "error" and r["code"] == "forbidden", (frame, r)
        base = f"/api/documents/{did}"
        for method, path, payload in [("POST", f"{base}/suggestions/{sid}/decision", {"decision": "accept"}),
                                      ("POST", f"{base}/decisions", {"decision": "accept"}),
                                      ("POST", f"{base}/shares", {"email": DANA.email, "role": "viewer", "endsAt": None}),
                                      ("PATCH", f"{base}/shares/{tshare['shareId']}", {"role": "viewer"}),
                                      ("DELETE", f"{base}/shares/{tshare['shareId']}", None),
                                      ("PATCH", base, {"title": "Hijacked"}), ("DELETE", base, None)]:
            r = priya.call(method, path, payload)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}, (method, path, r.text)
        after = ines.snap(did)
        assert (after["text"], after["revision"], after["marks"], after["blocks"], after["title"]) == \
               (before["text"], before["revision"], before["marks"], before["blocks"], before["title"])
        assert [s["id"] for s in after["suggestions"]] == [s["id"] for s in before["suggestions"]]
        assert shares(ines, did) == shares_before
        assert priya.snap(did)["myAccess"]["mode"] == "suggesting"
        assert s_p.send({"type": "heartbeat"})["type"] == "ack"
        assert s_p.op("suggesting", [{"insert": "Q", "at": 0}])["type"] == "ack"
        tomas = Api(app_url, TOMAS)
        r = ines.patch(f"/api/documents/{did}/shares/{tshare['shareId']}", {"role": "commenter"})
        assert r.status_code == 200 and r.json()["role"] == "commenter"
        held_snap = ines.snap(did)
        r = s_t.op("editing", [{"insert": "W", "at": 0}])
        assert r["type"] == "error" and r["code"] == "forbidden", r
        r = decide(tomas, did, sid, "accept")
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
        after = ines.snap(did)
        assert (after["text"], after["revision"]) == (held_snap["text"], held_snap["revision"])
        assert sid in {s["id"] for s in after["suggestions"]}


def test_replace_all_suggesting(browser: Browser, app_url: str) -> None:
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    word, repl, cased, gift_word = "grant", "award", "Fund", "Gift"
    variants = [word, word.capitalize(), word.upper()]
    lower_rest = f"{cased.lower()} b"
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines,
                        f"{variants[1]} one. {variants[0]} two. {variants[2]} three. {cased} a, {lower_rest}.",
                        ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": f" {word}", "at": 0}])
        s_p = joined(st, browser, app_url, PRIYA, did)
        before = ines.snap(did)
        r = s_p.send({"type": "replace_all", "baseRevision": before["revision"], "mode": "suggesting",
                      "find": word, "replace": repl, "matchCase": False})
        assert r["type"] == "ack" and r["count"] == 3 and r["revision"] == before["revision"] + 1
        snap = ines.snap(did)
        reps = sugs(snap, priya.pid, "replace")
        assert len(reps) == 3 and not sugs(snap, priya.pid, "insert")
        assert sorted(span(snap["text"], s["deleted"]) for s in reps) == sorted(variants)
        assert all(span(snap["text"], s["inserted"]) == repl for s in reps)
        assert all(v in snap["text"] for v in variants)
        assert len(sugs(snap, tomas.pid)) == 1
        r = s_p.send({"type": "replace_all", "baseRevision": snap["revision"], "mode": "suggesting",
                      "find": cased, "replace": gift_word, "matchCase": True})
        assert r["type"] == "ack" and r["count"] == 1
        snap = ines.snap(did)
        gift = [s for s in sugs(snap, priya.pid, "replace") if span(snap["text"], s["inserted"]) == gift_word]
        assert len(gift) == 1 and span(snap["text"], gift[0]["deleted"]) == cased and lower_rest in snap["text"]


def test_wf_suggesting_replace_all_ui(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        find_word, repl_word, n = "alpha", "omega", 2
        doc, _ = seeded(st, browser, app_url, ines, f"{find_word} beta {find_word} gamma", ((PRIYA, "commenter"),))
        did = doc["id"]
        page = st.enter_context(editor(browser, app_url, PRIYA, did))
        ann = record(announcements(page))
        click(page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Find and replace"))
        dialog = page.get_by_role("dialog", name="Find and replace")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Find"), find_word)
        fill(dialog.get_by_role("textbox", name="Replace with"), repl_word)
        click(dialog.get_by_role("button", name="Replace all"))
        wait_ui(page, lambda: f"Suggested {n} replacements" in log(ann))
        click(dialog.get_by_role("button", name="Close"))
        cards = page.get_by_role("article", name=f"Suggestion by {PRIYA.name}")
        wait_ui(page, lambda: cards.count() == n)
        assert all(f"Replace “{find_word}” with “{repl_word}”" in cards.nth(i).inner_text() for i in range(n))
    snap = ines.snap(did)
    reps = sugs(snap, priya.pid, "replace")
    assert len(reps) == n and snap["text"].count(find_word) == n and snap["text"].count(repl_word) == n


def test_wf_settle_cards_ui(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        base_text, added = "Books cost money.", " a lot of"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": added, "at": 10}])
        s_t.ok_op("suggesting", [{"delete": 6, "at": 0}])
        snap = ines.snap(did)
        ins = sugs(snap, tomas.pid, "insert")[0]["id"]
        dele = sugs(snap, tomas.pid, "delete")[0]["id"]
        a = st.enter_context(editor(browser, app_url, INES, did))
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        both = [a, b]
        wait_ui(both, lambda: card(a, ins).count() == 1 and card(b, ins).count() == 1)
        ann = record(announcements(a))
        caret_end(a)
        a.keyboard.press("Enter")
        wait_ui(both, lambda: ines.snap(did)["text"].endswith("\n"), what="Enter in the page starts a paragraph")
        assert len(ines.snap(did)["suggestions"]) == 2
        caret_start(a)
        a.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(both, lambda: a.evaluate(FOCUSED_CARD_JS) == dele, what="first card from the caret")
        a.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(both, lambda: a.evaluate(FOCUSED_CARD_JS) == ins, what="next card in page order")
        a.keyboard.press("Enter")
        wait_ui(both, lambda: card(a, ins).count() == 0 and card(b, ins).count() == 0, what="card accepted by Enter gone")
        hit(card(a, dele).get_by_role("button", name="Reject"))
        wait_ui(both, lambda: card(a, dele).count() == 0 and card(b, dele).count() == 0, what="rejected card gone")
        assert not visible_alerts(b)
        snap = ines.snap(did)
        assert snap["suggestions"] == [] and snap["text"] == base_text[:10] + added + base_text[10:] + "\n"
        wait_ui(both, lambda: body_text(a) == body_text(b) == norm(snap["text"]))
        advance(a, ANNOUNCE_DELAY_MS * 3)
        said = log(ann)
        assert said.count("Suggestion accepted") == 1 and said.count("Suggestion rejected") == 1, said


def test_wf_settle_cards_simultaneous(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Shared decision text.", ((TOMAS, "editor"), (LENA, "editor")))
        did = doc["id"]
        s_l = joined(st, browser, app_url, LENA, did)
        race = token("race")
        s_l.ok_op("suggesting", [{"insert": f" {race}", "at": 15}])
        sid = ines.snap(did)["suggestions"][0]["id"]
        a = st.enter_context(editor(browser, app_url, INES, did))
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        both = [a, b]
        wait_ui(both, lambda: card(a, sid).count() == 1 and card(b, sid).count() == 1)
        logs = [record(announcements(a)), record(announcements(b))]
        rev = ines.snap(did)["revision"]
        card(a, sid).get_by_role("button", name="Accept").dispatch_event("click")
        card(b, sid).get_by_role("button", name="Reject").dispatch_event("click")
        wait_ui(both, lambda: card(a, sid).count() == 0 and card(b, sid).count() == 0)
        advance(a, ANNOUNCE_DELAY_MS)
        advance(b, ANNOUNCE_DELAY_MS)
        assert not visible_alerts(a) and not visible_alerts(b)
        said = [t for h in logs for t in log(h) if t in ("Suggestion accepted", "Suggestion rejected")]
        assert len(said) == 1, said
        snap = ines.snap(did)
        assert snap["suggestions"] == [] and snap["revision"] == rev + 1
        late = decide(ines, did, sid, "accept").json()
        assert late["applied"] is False
        assert (race in snap["text"]) == (late["status"] == "accepted")


def test_first_decision_wins(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        base_text, added = "Concurrency check.", " WINNER"
        doc, s_ines = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": added, "at": len(base_text)}])
        sid = ines.snap(did)["suggestions"][0]["id"]
        rev = ines.snap(did)["revision"]
        mark = s_ines.mark()
        clients = [Api(app_url, INES if i % 2 == 0 else TOMAS) for i in range(CONCURRENT_DECISIONS)]
        choices = ["accept" if i % 2 == 0 else "reject" for i in range(CONCURRENT_DECISIONS)]
        barrier = threading.Barrier(CONCURRENT_DECISIONS)

        def fire(i: int) -> httpx.Response:
            barrier.wait()
            return decide(clients[i], did, sid, choices[i])

        with ThreadPoolExecutor(CONCURRENT_DECISIONS) as ex:
            results = list(ex.map(fire, range(CONCURRENT_DECISIONS)))
        assert all(r.status_code == 200 for r in results), [r.text for r in results]
        bodies = [r.json() for r in results]
        assert sum(b["applied"] for b in bodies) == 1
        status = bodies[0]["status"]
        assert status in ("accepted", "rejected") and all(b["status"] == status for b in bodies)
        assert all(b["suggestionId"] == sid for b in bodies)
        winner = [b for b in bodies if b["applied"]][0]
        assert_person(winner["decidedBy"])
        late = s_t.send({"type": "decide", "suggestionId": sid, "decision": "accept" if status == "rejected" else "reject"})
        assert late["type"] == "ack" and late["applied"] is False and late["status"] == status
        snap = ines.snap(did)
        assert snap["revision"] == rev + 1 and snap["suggestions"] == []
        expected = base_text + added if status == "accepted" else base_text
        assert snap["text"] == expected
        s_ines.ok_op("editing", [{"insert": "!", "at": 0}])
        closes = [f for f in s_ines.frames()[mark:] if f.get("type") == "card_closed" and f["cardId"] == sid]
        assert len(closes) == 1 and closes[0]["status"] == status


def test_accept_all_only_open(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        base_text = "Alpha beta gamma delta epsilon."
        new1, new3, late_word = "NEW1 ", "NEW3 ", "LATE "
        doc, s_ines = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)

        def at(word: str) -> int:
            return ines.snap(did)["text"].index(word)

        s_t.ok_op("suggesting", [{"insert": new1, "at": at("beta")}])
        s_t.ok_op("suggesting", [{"delete": 6, "at": at("gamma")}])
        s_t.ok_op("suggesting", [{"insert": new3, "at": at("delta")}])
        s_t.ok_op("suggesting", [{"insert": "GONE", "at": at("epsilon")}])
        s_ines.ok_op("editing", [{"delete": 4, "at": at("GONE")}])
        snap = ines.snap(did)
        cd = [s for s in snap["suggestions"] if s["contentDeleted"]]
        assert len(cd) == 1
        dele = sugs(snap, tomas.pid, "delete")[0]["id"]
        r = decide(ines, did, dele, "reject")
        assert r.status_code == 200 and r.json()["applied"] is True
        page = st.enter_context(editor(browser, app_url, INES, did))
        toolbar_btn = page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Accept all")
        click(toolbar_btn)
        dialog = page.get_by_role("alertdialog", name="Accept all suggestions")
        wait_ui(page, dialog.is_visible)
        assert re.search(r"(?<!\d)3(?!\d)", dialog.inner_text())
        assert focus_within(dialog.get_by_role("button", name="Cancel"))
        rev = ines.snap(did)["revision"]
        click(dialog.get_by_role("button", name="Cancel"))
        wait_ui(page, lambda: dialog.count() == 0 or not dialog.is_visible())
        assert ines.snap(did)["revision"] == rev and len(ines.snap(did)["suggestions"]) == 3
        click(toolbar_btn)
        wait_ui(page, dialog.is_visible)
        open_ids = [s["id"] for s in ines.snap(did)["suggestions"]]
        s_t.ok_op("suggesting", [{"insert": late_word, "at": 0}])
        late = [s["id"] for s in ines.snap(did)["suggestions"] if s["id"] not in open_ids][0]
        click(dialog.get_by_role("button", name="Accept all"))
        wait_ui(page, lambda: all(card(page, i).count() == 0 for i in open_ids + [late]))
        snap = ines.snap(did)
        assert snap["suggestions"] == []
        expected = late_word + base_text.replace("beta", new1 + "beta").replace("delta", new3 + "delta")
        assert snap["text"] == expected
        r = ines.post(f"/api/documents/{did}/decisions", {"decision": "accept"})
        assert r.status_code == 200 and r.json()["count"] == 0 and r.json()["suggestionIds"] == []
        s_t.ok_op("suggesting", [{"insert": "TEMP ", "at": 0}])
        temp = ines.snap(did)["suggestions"][0]["id"]
        r = ines.post(f"/api/documents/{did}/decisions", {"decision": "reject"})
        assert r.status_code == 200 and r.json()["decision"] == "reject"
        assert r.json()["count"] == 1 and r.json()["suggestionIds"] == [temp]
        assert ines.snap(did)["text"] == snap["text"]


def test_decision_announcements(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "One two three four five six.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        for word, before in (("A1 ", "two"), ("A2 ", "three"), ("A3 ", "five"), ("A4 ", "six")):
            s_t.ok_op("suggesting", [{"insert": word, "at": ines.snap(did)["text"].index(before)}])
        ids = [s["id"] for s in sorted(ines.snap(did)["suggestions"], key=lambda s: s["inserted"]["at"])]
        page = st.enter_context(editor(browser, app_url, INES, did))
        wait_ui(page, lambda: all(card(page, i).count() == 1 for i in ids))
        ann = record(announcements(page))
        toolbar = page.get_by_role("toolbar", name="Formatting")

        def rerender() -> None:
            c = made_comment(priya, did, len(ines.snap(did)["text"]) - 5, 4, "Re-render " + token())
            wait_ui(page, lambda: card(page, c["id"]).count() == 1)

        hit_at_rest(page, card(page, ids[0]).get_by_role("button", name="Accept"))
        wait_ui(page, lambda: "Suggestion accepted" in log(ann))
        rerender()
        hit_at_rest(page, card(page, ids[1]).get_by_role("button", name="Reject"))
        wait_ui(page, lambda: "Suggestion rejected" in log(ann))
        rerender()
        click(toolbar.get_by_role("button", name="Accept all"))
        dialog = page.get_by_role("alertdialog", name="Accept all suggestions")
        wait_ui(page, dialog.is_visible)
        hit_at_rest(page, dialog.get_by_role("button", name="Accept all"))
        wait_ui(page, lambda: "2 suggestions accepted" in log(ann))
        rerender()
        s_t.ok_op("suggesting", [{"insert": "R1 ", "at": 0}])
        r1 = ines.snap(did)["suggestions"][0]["id"]
        wait_ui(page, lambda: card(page, r1).count() == 1)
        click(toolbar.get_by_role("button", name="Reject all"))
        dialog = page.get_by_role("alertdialog", name="Reject all suggestions")
        wait_ui(page, dialog.is_visible)
        hit_at_rest(page, dialog.get_by_role("button", name="Reject all"))
        wait_ui(page, lambda: "1 suggestion rejected" in log(ann))
        rerender()
        advance(page, ANNOUNCE_DELAY_MS * 3)
        said = log(ann)
        expected = ["Suggestion accepted", "Suggestion rejected", "2 suggestions accepted", "1 suggestion rejected"]
        for message in expected:
            assert said.count(message) == 1, said
        assert [t for t in said if t in expected] == expected


def test_wf_comments_mentions_ui(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Survey families in October and May.", ((PRIYA, "commenter"),))
        did = doc["id"]
        a = st.enter_context(editor(browser, app_url, PRIYA, did))
        b = st.enter_context(editor(browser, app_url, INES, did))
        both = [a, b]
        ann = record(announcements(a))
        select_range(a, 0, 6)
        a.keyboard.press("Control+Alt+m")
        box = a.get_by_role("textbox", name="Comment")
        wait_ui(both, lambda: focus_within(box), what="Ctrl+Alt+M opens the draft with focus in Comment")
        note, answer = token("note"), token("answer")
        a.keyboard.type(f"{note} @Ine")
        picker = a.get_by_role("listbox", name="Mention people")
        option = picker.get_by_role("option", name=f"{INES.name} · Owner")
        wait_ui(both, lambda: option.is_visible() and picker.get_by_role("option").count() == 1)
        a.keyboard.press("ArrowDown")
        a.keyboard.press("Enter")
        wait_ui(both, lambda: f"@{INES.name}" in box.input_value() if box.evaluate("e => 'value' in e") else f"@{INES.name}" in box.inner_text())
        click(a.get_by_role("button", name="Post"))
        wait_ui(both, lambda: "Comment posted" in log(ann))
        advance(a, ANNOUNCE_DELAY_MS * 3)
        assert log(ann).count("Comment posted") == 1, log(ann)
        cards_b = b.get_by_role("article", name=f"Comment by {PRIYA.name}")
        wait_ui(both, lambda: cards_b.count() == 1, what="comment card on the Owner's screen")
        assert note in cards_b.inner_text()
        fill(cards_b.get_by_role("textbox", name="Reply"), answer)
        click(cards_b.get_by_role("button", name="Reply"))
        wait_ui(both, lambda: answer in a.get_by_role("article", name=f"Comment by {PRIYA.name}").inner_text())
    (c,) = ines.snap(did)["comments"]
    assert c["author"]["personId"] == priya.pid and c["anchor"] == {"at": 0, "length": 6}
    assert [m["personId"] for m in c["mentions"]] == [ines.pid] and c["status"] == "open"
    assert c["replies"][-1]["body"] == answer and c["replies"][-1]["author"]["personId"] == ines.pid


def test_anchors_follow_edits(browser: Browser, app_url: str) -> None:
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    with ExitStack() as st:
        added = " today"
        doc, s_ines = seeded(st, browser, app_url, ines, "Intro text. survey families now.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        c = made_comment(priya, did, 12, 15, "Anchor note")
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": added, "at": 31}])
        sid = ines.snap(did)["suggestions"][0]["id"]
        s_ines.ok_op("editing", [{"insert": "New ", "at": 0}])
        snap = ines.snap(did)
        cm = snap["comments"][0]
        sg = snap["suggestions"][0]
        assert cm["anchor"] == {"at": 16, "length": 15} and span(snap["text"], cm["anchor"]) == "survey families"
        assert sg["inserted"] == {"at": 35, "length": 6} and span(snap["text"], sg["inserted"]) == added
        s_ines.ok_op("editing", [{"delete": 15, "at": 16}])
        snap = ines.snap(did)
        cm = snap["comments"][0]
        assert cm["anchor"] is None and cm["contentDeleted"] is True
        sg = snap["suggestions"][0]
        s_ines.ok_op("editing", [{"delete": 6, "at": sg["inserted"]["at"]}])
        snap = ines.snap(did)
        assert snap["suggestions"][0]["contentDeleted"] is True
        page = st.enter_context(editor(browser, app_url, INES, did))
        for cid in (c["id"], sid):
            wait_ui(page, lambda: card(page, cid).count() == 1 and "Original content deleted" in card(page, cid).inner_text())
        assert page.locator(f'[data-tether-for="{c["id"]}"]').count() == 0
        reply = token("reply")
        r = comment(priya, did, 0, 0, reply, parent=c["id"])
        assert r.status_code == 201 and r.json()["replies"][-1]["body"] == reply
        r = priya.post(f"/api/documents/{did}/comments/{c['id']}/resolve")
        assert r.status_code == 200 and r.json()["status"] == "resolved" and r.json()["contentDeleted"] is True
        text_before = ines.snap(did)["text"]
        r = decide(ines, did, sid, "accept")
        assert r.status_code == 200 and r.json()["applied"] is True and r.json()["status"] == "accepted"
        assert ines.snap(did)["text"] == text_before and ines.snap(did)["suggestions"] == []
        assert tomas.snap(did)["comments"][0]["contentDeleted"] is True


def test_resolve_reopen(browser: Browser, app_url: str) -> None:
    ines, tomas, priya, dana = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA), Api(app_url, DANA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Resolve this passage please.",
                        ((TOMAS, "editor"), (PRIYA, "commenter"), (DANA, "viewer")))
        did = doc["id"]
        c = made_comment(priya, did, 0, 7, "Resolve me")
        s_t = joined(st, browser, app_url, TOMAS, did)
        url = f"/api/documents/{did}/comments/{c['id']}"
        r = dana.post(url + "/resolve")
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
        r = priya.post(url + "/reopen")
        assert r.status_code == 409 and r.json() == {"error": "not_resolved"}
        mark = s_t.mark()
        t0 = time.monotonic()
        r = priya.post(url + "/resolve")
        assert r.status_code == 200 and r.json()["status"] == "resolved"
        f = s_t.wait(lambda f: f.get("type") == "card_changed" and f["card"]["id"] == c["id"] and f["card"]["status"] == "resolved",
                     seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        assert f and time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        r = priya.post(url + "/resolve")
        assert r.status_code == 409 and r.json() == {"error": "not_open"}
        r = ines.post(url + "/reopen")
        assert r.status_code == 200 and r.json()["status"] == "reopened"
        s_t.wait(lambda f: f.get("type") == "card_changed" and f["card"]["id"] == c["id"] and f["card"]["status"] == "reopened", since=mark)
        r = ines.post(url + "/reopen")
        assert r.status_code == 409 and r.json() == {"error": "not_resolved"}
        clients = [Api(app_url, INES), Api(app_url, TOMAS)]
        barrier = threading.Barrier(2)

        def fire(i: int) -> httpx.Response:
            barrier.wait()
            return clients[i].post(url + "/resolve")

        with ThreadPoolExecutor(2) as ex:
            results = list(ex.map(fire, range(2)))
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409] and [r.json() for r in results if r.status_code == 409] == [{"error": "not_open"}]
        assert tomas.snap(did)["comments"][0]["status"] == "resolved"
        r = tomas.post(url + "/reopen")
        assert r.status_code == 200 and r.json()["status"] == "reopened"


def test_mention_scope(browser: Browser, app_url: str) -> None:
    ines, priya, jordan, dana = Api(app_url, INES), Api(app_url, PRIYA), Api(app_url, JORDAN), Api(app_url, DANA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Mention scoping text.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        r = priya.get(f"/api/documents/{did}/people")
        names = {p["displayName"]: p["role"] for p in r.json()["people"]}
        assert names == {INES.name: "owner", TOMAS.name: "editor", PRIYA.name: "commenter"}
        for p in r.json()["people"]:
            assert_person(p)
        no_emails(r.text, INES, TOMAS)
        r = priya.get(f"/api/documents/{did}/people", params={"q": "CALL"})
        assert [p["displayName"] for p in r.json()["people"]] == [INES.name]
        before = len(ines.snap(did)["comments"])
        for outsider in (jordan.pid, dana.pid):
            r = comment(priya, did, 0, 7, "Hello", [outsider])
            assert r.status_code == 422
            assert r.json()["fields"]["mentions"] == "Only people with access to this proposal can be mentioned."
        assert len(ines.snap(did)["comments"]) == before
        assert all(n["documentId"] != did for n in jordan.notices()["notices"])
        page = st.enter_context(editor(browser, app_url, PRIYA, did))
        select_range(page, 0, 7)
        click(page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Comment"))
        box = page.get_by_role("textbox", name="Comment")
        wait_ui(page, lambda: focus_within(box))
        page.keyboard.type("@")
        picker = page.get_by_role("listbox", name="Mention people")
        wait_ui(page, lambda: picker.get_by_role("option").count() >= 2)
        options = set(picker.get_by_role("option").all_inner_texts())
        options = {norm(o).casefold() for o in options}
        allowed = {f"{INES.name} · Owner".casefold(), f"{TOMAS.name} · Editor".casefold(), f"{PRIYA.name} · Commenter".casefold()}
        assert {f"{INES.name} · Owner".casefold(), f"{TOMAS.name} · Editor".casefold()} <= options <= allowed, options
        page.keyboard.press("Escape")
        wait_ui(page, lambda: picker.count() == 0 or not picker.is_visible())


def test_notices(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    doc = make_doc(ines)
    did, title = doc["id"], doc["title"]
    with ExitStack() as st:
        s_t = st.enter_context(Sock(browser, app_url, TOMAS))
        t0 = time.monotonic()
        sh = share(ines, did, TOMAS, "editor")
        f = s_t.wait(lambda f: f.get("type") == "notice" and f["notice"]["documentId"] == did, seconds=LIVE_S + HARNESS_SLACK_S)
        assert time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        n = f["notice"]
        assert n["kind"] == "shared" and n["text"] == f"{INES.name} shared {title} with you as Editor"
        assert n["documentTitle"] == title and n["read"] is False and n["actor"]["personId"] == ines.pid
        s_t.wait(lambda f: f.get("type") == "lists_changed")
        mark = s_t.mark()
        ines.patch(f"/api/documents/{did}/shares/{sh['shareId']}", {"role": "commenter"})
        f = s_t.wait(lambda f: f.get("type") == "notice" and f["notice"]["kind"] == "role_changed", seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        assert f["notice"]["text"] == f"Your access to {title} changed to Commenter"
        ines.patch(f"/api/documents/{did}/shares/{sh['shareId']}", {"endsAt": iso(server_time(doc) + timedelta(days=SHARE_END_DAYS))})
        s_ines = joined(st, browser, app_url, INES, did)
        s_ines.ok_op("editing", [{"insert": "Mention target text.", "at": 0}])
        made_comment(ines, did, 0, 7, "@Tomas and me", [tomas.pid, ines.pid])
        f = s_t.wait(lambda f: f.get("type") == "notice" and f["notice"]["kind"] == "mention", since=mark)
        assert f["notice"]["text"] == f"{INES.name} mentioned you in {title}" and f["notice"]["commentId"]
    listed = [n for n in tomas.notices()["notices"] if n["documentId"] == did]
    assert [n["kind"] for n in listed] == ["mention", "role_changed", "shared"]
    assert not any(n["documentId"] == did and n["kind"] == "mention" for n in ines.notices()["notices"])
    unread = tomas.notices()["unread"]
    r = tomas.post(f"/api/notices/{listed[0]['id']}/read")
    assert r.status_code == 200 and r.json()["read"] is True
    assert tomas.notices()["unread"] == unread - 1


def test_wf_comments_mentions_notice_opens(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Notice target paragraph.", ((PRIYA, "commenter"),))
        did = doc["id"]
        c = made_comment(priya, did, 0, 6, "Look here", [ines.pid])
        text = f"{PRIYA.name} mentioned you in {doc['title']}"
        page = st.enter_context(home(browser, app_url, INES))
        click(page.get_by_role("button", name="Notices", exact=True))
        dialog = page.get_by_role("dialog", name="Notices")
        wait_ui(page, dialog.is_visible)
        link = dialog.get_by_role("list", name="Notices").get_by_role("link", name=text)
        wait_ui(page, lambda: link.count() == 1)
        hit(link)
        wait_ui(page, lambda: urlparse(page.url).path == f"/d/{did}" and page.evaluate(FOCUSED_CARD_JS) == c["id"])
    n = [n for n in ines.notices()["notices"] if n.get("commentId") == c["id"]][0]
    assert n["read"] is True and n["text"] == text


def test_comment_validation(browser: Browser, app_url: str) -> None:
    ines, priya, jordan = Api(app_url, INES), Api(app_url, PRIYA), Api(app_url, JORDAN)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Validation text here.", ((PRIYA, "commenter"),))
        did = doc["id"]
        size = len(ines.snap(did)["text"])
        body_msg = "Write a comment of 1 to 2,000 characters."
        anchor_msg = "Select the text this comment is about."
        for args, field, msg in [((0, 4, "   "), "body", body_msg), ((0, 4, "x" * (COMMENT_MAX + 1)), "body", body_msg),
                                 ((0, 0, "ok"), "anchor", anchor_msg), ((size, 1, "ok"), "anchor", anchor_msg)]:
            r = comment(priya, did, *args)
            assert r.status_code == 422 and r.json()["error"] == "invalid" and r.json()["fields"][field] == msg, r.text
        r = comment(priya, did, 0, 4, "ok", [jordan.pid])
        assert r.status_code == 422 and r.json()["fields"]["mentions"] == "Only people with access to this proposal can be mentioned."
        assert ines.snap(did)["comments"] == []
        top = made_comment(priya, did, 0, 4, "x" * COMMENT_MAX)
        reply = token("reply")
        r = comment(priya, did, 0, 0, reply, parent=top["id"])
        assert r.status_code == 201 and r.json()["id"] == top["id"] and r.json()["replies"][-1]["body"] == reply
        not_found(comment(priya, did, 0, 0, "Reply", parent="missing" + uuid.uuid4().hex))
        not_found(comment(priya, did, 0, 0, "Reply", parent=r.json()["replies"][-1]["id"]))
        assert len(ines.snap(did)["comments"]) == 1
        page = st.enter_context(editor(browser, app_url, PRIYA, did))
        select_range(page, 0, 4)
        click(page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Comment"))
        box = page.get_by_role("textbox", name="Comment")
        wait_ui(page, box.is_visible)
        fill(box, "y" * (COMMENT_MAX + 1))
        typed = box.evaluate("e => ('value' in e ? e.value : e.textContent).length")
        if typed > COMMENT_MAX:
            click(page.get_by_role("button", name="Post"))
            wait_ui(page, lambda: body_msg in page.get_by_role("complementary", name="Margin").inner_text())
            assert focus_within(box)
        else:
            assert typed == COMMENT_MAX
    assert len(ines.snap(did)["comments"]) == 1


def test_wf_role_change_downgrade(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        base_text, typed = "Downgrade text.", " typed"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        a = st.enter_context(editor(browser, app_url, INES, did))
        both = [a, b]
        assert b.get_by_role("radio", name="Editing").is_checked()
        b.evaluate("() => { window.__sameDocument = true; }")
        ann_b = record(announcements(b))
        ann_a = record(announcements(a))
        caret_end(b)
        b.keyboard.type(typed)
        wait_ui(both, lambda: ines.snap(did)["text"] == base_text + typed)
        click(a.get_by_role("button", name="Share"))
        dialog = a.get_by_role("dialog", name="Share proposal")
        wait_ui(both, dialog.is_visible)
        select(dialog.get_by_role("combobox", name=f"Access for {TOMAS.name}"), "Commenter")
        wait_ui(both, lambda: f"{TOMAS.name} is now Commenter" in log(ann_a))
        wait_ui(both, lambda: b.get_by_role("radio", name="Suggesting").is_checked(), what="mode switch to Suggesting")
        assert b.get_by_role("radio", name="Editing").is_disabled()
        assert b.evaluate("() => window.__sameDocument === true")
        wait_ui(both, lambda: "Your access changed to Commenter. You're now suggesting." in log(ann_b))
        caret_end(b)
        b.keyboard.type("Z")
        wait_ui(both, lambda: len(sugs(ines.snap(did), tomas.pid, "insert")) == 1)
    snap = ines.snap(did)
    s = sugs(snap, tomas.pid, "insert")[0]
    assert span(snap["text"], s["inserted"]) == "Z" and snap["text"].startswith(base_text + typed)
    me = tomas.snap(did)["myAccess"]
    assert me["role"] == "commenter" and me["mode"] == "suggesting"


def test_wf_role_change_viewer_ui(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Viewer reads this line twice line.", ((DANA, "viewer"),))
        did = doc["id"]
        rev = ines.snap(did)["revision"]
        page = st.enter_context(editor(browser, app_url, DANA, did))
        assert page.get_by_role("radio", name="Viewing").is_checked()
        assert page.get_by_role("radio", name="Editing").is_disabled() and page.get_by_role("radio", name="Suggesting").is_disabled()
        caret_end(page)
        intruder, matches = token("intruder"), 2
        page.keyboard.type(intruder)
        advance(page, MOTION_MAX_MS)
        click(page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Find and replace"))
        dialog = page.get_by_role("dialog", name="Find and replace")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Find"), "line")
        wait_ui(page, lambda: f"{matches} matches" in dialog.inner_text().casefold())
        assert dialog.get_by_role("button", name="Replace", exact=True).is_disabled()
        assert dialog.get_by_role("button", name="Replace all").is_disabled()
    snap = ines.snap(did)
    assert snap["revision"] == rev and intruder not in snap["text"] and snap["suggestions"] == []


def test_viewer_refused(browser: Browser, app_url: str) -> None:
    ines, dana = Api(app_url, INES), Api(app_url, DANA)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Viewer guard text.", ((DANA, "viewer"), (TOMAS, "editor")))
        did = doc["id"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        s_t.ok_op("suggesting", [{"insert": " x", "at": 17}])
        c = made_comment(ines, did, 0, 6, "Owner")
        before = ines.snap(did)
        sid = before["suggestions"][0]["id"]
        mark = s_ines.mark()
        s_d = joined(st, browser, app_url, DANA, did)
        s_ines.wait(lambda f: f.get("type") == "presence" and f["person"]["personId"] == dana.pid and f["state"] == "active", since=mark)
        rev = before["revision"]
        for frame in [{"type": "op", "baseRevision": rev, "mode": "suggesting", "ops": [{"insert": "Z", "at": 0}]},
                      {"type": "op", "baseRevision": rev, "mode": "editing", "ops": [{"insert": "Z", "at": 0}]},
                      {"type": "mode", "mode": "suggesting"},
                      {"type": "replace_all", "baseRevision": rev, "mode": "suggesting", "find": "text", "replace": "copy", "matchCase": False},
                      {"type": "decide", "suggestionId": sid, "decision": "reject"}, {"type": "decide_all", "decision": "reject"}]:
            r = s_d.send(frame)
            assert r["type"] == "error" and r["code"] == "forbidden", (frame, r)
        base = f"/api/documents/{did}"
        for path, payload in [(f"{base}/comments", {"anchor": {"at": 0, "length": 3}, "body": "hi", "mentions": []}),
                              (f"{base}/comments/{c['id']}/resolve", {}), (f"{base}/suggestions/{sid}/decision", {"decision": "accept"}),
                              (f"{base}/decisions", {"decision": "accept"})]:
            r = dana.post(path, payload)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}, path
        after = ines.snap(did)
        assert (after["text"], after["revision"], len(after["comments"]), after["comments"][0]["status"]) == \
               (before["text"], before["revision"], 1, "open")
        assert dana.snap(did)["text"] == before["text"]
        assert dana.get(f"{base}/people").status_code == 200
        assert s_d.send({"type": "heartbeat"})["type"] == "ack"
        mark = s_ines.mark()
        assert s_d.send({"type": "caret", "at": 4, "length": 2})["type"] == "ack"
        f = s_ines.wait(lambda f: f.get("type") == "caret" and f["person"]["personId"] == dana.pid, since=mark)
        assert f["at"] == 4 and f["length"] == 2


def test_last_mode_remembered(browser: Browser, app_url: str) -> None:
    ines, tomas, priya, dana = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA), Api(app_url, DANA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Mode memory.", ((TOMAS, "editor"), (PRIYA, "commenter"), (DANA, "viewer")))
        did = doc["id"]
        assert [a.snap(did)["myAccess"]["mode"] for a in (ines, tomas, priya, dana)] == ["editing", "editing", "suggesting", "viewing"]
        s_t = joined(st, browser, app_url, TOMAS, did)
        assert s_t.mode("suggesting")["type"] == "ack"
        assert tomas.snap(did)["myAccess"]["mode"] == "suggesting"
        with Sock(browser, app_url, TOMAS) as second:
            assert second.join(did)["mode"] == "suggesting"
        s_p = joined(st, browser, app_url, PRIYA, did)
        assert s_p.mode("editing")["code"] == "forbidden"
        assert priya.snap(did)["myAccess"]["mode"] == "suggesting"
        s_t.mode("editing")
        sh = share_of(ines, did, TOMAS)["shareId"]
        ines.patch(f"/api/documents/{did}/shares/{sh}", {"role": "commenter"})
        assert tomas.snap(did)["myAccess"]["mode"] == "suggesting"
        ines.patch(f"/api/documents/{did}/shares/{sh}", {"role": "viewer"})
        assert tomas.snap(did)["myAccess"]["mode"] == "viewing"
        ines.patch(f"/api/documents/{did}/shares/{sh}", {"role": "editor"})
        me = tomas.snap(did)["myAccess"]
        assert me["role"] == "editor" and me["mode"] == "viewing"


def test_wf_timed_access_expiry(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Timed review text.")
        did = doc["id"]
        ends = server_time(doc) + timedelta(seconds=UI_END_S)
        share(ines, did, PRIYA, "commenter", iso(ends))
        started = time.monotonic()
        page = st.enter_context(editor(browser, app_url, PRIYA, did, device_time=ends + timedelta(days=FAR_DEVICE_DAYS)))
        assert "access until" in page.get_by_role("region", name="Document status").inner_text().casefold()
        caret_end(page)
        page.keyboard.type(" note")
        wait_ui(page, lambda: len(sugs(ines.snap(did), priya.pid)) == 1, what="suggestion before the end time")
        assert page.get_by_role("heading", name="This proposal is no longer available").count() == 0
        wait_ui(page, lambda: page.get_by_role("heading", name="This proposal is no longer available").is_visible(),
                seconds=UI_END_S + LIVE_S + HARNESS_SLACK_S + UI_WAIT_S)
        assert time.monotonic() - started >= UI_END_S - HARNESS_SLACK_S * 2
        advance(page, ANNOUNCE_DELAY_MS * 3)
        reason = [t for t in visible_alerts(page) if "Your access ended at the time the owner set." in t]
        assert len(reason) == 1 and reason[0].count("Your access ended at the time the owner set.") == 1, visible_alerts(page)
        assert page.get_by_role("link", name="Back to documents").is_visible()
        page.reload()
        wait_ui(page, lambda: page.get_by_role("heading", name="Proposal not found").is_visible(), what="not found after reload")
    not_found(priya.get(f"/api/documents/{did}"))


def test_server_decides_access_end(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    missing = "missing" + uuid.uuid4().hex
    with ExitStack() as st:
        t_before = time.monotonic()
        doc, _ = seeded(st, browser, app_url, ines, "Expiring text.")
        did = doc["id"]
        share(ines, did, PRIYA, "commenter", iso(server_time(doc) + timedelta(seconds=SHORT_END_S)))
        t_after = time.monotonic()
        s = joined(st, browser, app_url, PRIYA, did)
        assert priya.get(f"/api/documents/{did}").status_code == 200
        f = s.wait(lambda f: f.get("type") == "access_ended", seconds=SHORT_END_S + LIVE_S + HARNESS_SLACK_S * 2)
        arrived = time.monotonic()
        assert f["reason"] == "expired"
        assert arrived - t_before >= SHORT_END_S - HARNESS_SLACK_S
        assert arrived - t_after <= SHORT_END_S + LIVE_S + HARNESS_SLACK_S
        s.wait_closed()
        real, fake = priya.get(f"/api/documents/{did}"), priya.get(f"/api/documents/{missing}")
        not_found(real)
        assert real.json() == fake.json()
        not_found(comment(priya, did, 0, 3, "late"))
        assert did not in priya.doc_ids()
        with Sock(browser, app_url, PRIYA) as again:
            r = again.send({"type": "join", "documentId": did, "revision": 0})
            assert r["type"] == "error" and r["code"] == "not_found"


def test_wf_timed_access_owner_ended(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Ended share text.")
        did = doc["id"]
        old = share(ines, did, PRIYA, "commenter", iso(server_time(doc) + timedelta(seconds=SHORT_END_S)))
        s_p = joined(st, browser, app_url, PRIYA, did)
        s_p.wait(lambda f: f.get("type") == "access_ended", seconds=SHORT_END_S + LIVE_S + HARNESS_SLACK_S * 2)
        entry = share_of(ines, did, PRIYA)
        assert entry["status"] == "expired" and entry["shareId"] == old["shareId"] and entry["email"] == PRIYA.email
        r = ines.patch(f"/api/documents/{did}/shares/{old['shareId']}", {"role": "viewer"})
        assert r.status_code == 409 and r.json() == {"error": "share_ended"}
        r = s_ines.send({"type": "share", "shareId": old["shareId"], "role": "viewer"})
        assert r["type"] == "error" and r["code"] == "conflict"
        page = st.enter_context(editor(browser, app_url, INES, did))
        click(page.get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name="Share proposal")
        wait_ui(page, dialog.is_visible)
        item = dialog.get_by_role("list", name="People with access").get_by_role("listitem").filter(has_text=PRIYA.name)
        wait_ui(page, lambda: "ended" in item.inner_text().casefold())
        ann = record(announcements(page))
        fill(dialog.get_by_role("textbox", name="Email"), PRIYA.email)
        select(dialog.get_by_role("combobox", name="Access", exact=True), "Viewer")
        click(dialog.get_by_role("button", name="Add person"))
        wait_ui(page, lambda: f"Shared with {PRIYA.name} as Viewer" in log(ann))
        entry = share_of(ines, did, PRIYA)
        assert entry["status"] == "active" and entry["role"] == "viewer"
        assert priya.get(f"/api/documents/{did}").status_code == 200
        assert ines.delete(f"/api/documents/{did}/shares/{entry['shareId']}").status_code == 204
        assert all(s.get("email") != PRIYA.email for s in shares(ines, did))


def test_wf_revoke_delete_remove_reviewer(browser: Browser, app_url: str) -> None:
    ines, sam = Api(app_url, INES), Api(app_url, SAM)
    missing = "missing" + uuid.uuid4().hex
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Reviewer removal text.", ((SAM, "commenter"),))
        did = doc["id"]
        b = st.enter_context(editor(browser, app_url, SAM, did))
        a = st.enter_context(editor(browser, app_url, INES, did))
        ann = record(announcements(a))
        click(a.get_by_role("button", name="Share"))
        dialog = a.get_by_role("dialog", name="Share proposal")
        wait_ui([a, b], dialog.is_visible)
        click(dialog.get_by_role("button", name=f"Remove {SAM.name}"))
        wait_ui([a, b], lambda: f"Removed {SAM.name}" in log(ann))
        wait_ui([a, b], lambda: b.get_by_role("heading", name="This proposal is no longer available").is_visible())
        assert any("The owner removed your access." in t for t in visible_alerts(b))
        advance(a, ANNOUNCE_DELAY_MS * 3)
        assert log(ann).count(f"Removed {SAM.name}") == 1, log(ann)
        b.reload()
        wait_ui(b, lambda: b.get_by_role("heading", name="Proposal not found").is_visible(), what="not found after reload")
    real = sam.get(f"/api/documents/{did}")
    not_found(real)
    assert real.json() == sam.get(f"/api/documents/{missing}").json()
    for view in (None, "recent", "shared"):
        assert did not in sam.doc_ids(view)
    assert all(s.get("email") != SAM.email for s in shares(ines, did))


def test_wf_revoke_delete_delete_proposal(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Doomed proposal text.", ((TOMAS, "editor"),))
        did, title, tok = doc["id"], doc["title"], doc["token"]
        made_comment(ines, did, 0, 6, "For Tomas", [tomas.pid])
        s_ines.saved(ines.snap(did)["revision"])
        key = f"documents/{did}.json"
        assert key in S3().keys("documents/")
        assert any(n["documentId"] == did for n in tomas.notices()["notices"])
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        a = st.enter_context(home(browser, app_url, INES))
        ann = record(announcements(a))
        hit(a.get_by_role("region", name="My proposals").get_by_role("button", name=f"Delete {title}"))
        dialog = a.get_by_role("alertdialog", name="Delete proposal")
        wait_ui([a, b], dialog.is_visible)
        assert f"Delete “{title}”? Everyone with access loses it at once." in norm(dialog.inner_text())
        click(dialog.get_by_role("button", name="Delete"))
        wait_ui([a, b], lambda: f"Deleted {title}" in log(ann))
        wait_ui([a, b], lambda: b.get_by_role("heading", name="This proposal is no longer available").is_visible())
        assert any("The owner deleted this proposal." in t for t in visible_alerts(b))
        a.goto(app_url + f"/d/{did}")
        wait_ui(a, lambda: a.get_by_role("heading", name="Proposal not found").is_visible())
    assert key not in S3().keys("documents/")
    for api in (ines, tomas):
        not_found(api.get(f"/api/documents/{did}"))
        for view in (None, "recent", "mine", "shared"):
            assert did not in api.doc_ids(view)
        assert did not in api.doc_ids(q=tok)
        assert all(n["documentId"] != did for n in api.notices()["notices"])


def test_lists_follow_access_live(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    doc = make_doc(ines)
    did, title, tok = doc["id"], doc["title"], doc["token"]
    with ExitStack() as st:
        s_t = st.enter_context(Sock(browser, app_url, TOMAS))
        page = st.enter_context(home(browser, app_url, TOMAS))
        region = page.get_by_role("region", name="Shared with me")
        t0 = time.monotonic()
        sh = share(ines, did, TOMAS, "viewer")
        s_t.wait(lambda f: f.get("type") == "lists_changed", seconds=LIVE_S + HARNESS_SLACK_S)
        assert time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        wait_ui(page, lambda: region.get_by_role("link", name=title).count() == 1, what="new share in Shared with me")
        hit(page.get_by_role("searchbox", name="Search proposals"))
        page.keyboard.type(tok)
        results = page.get_by_role("list", name="Search results")
        wait_ui(page, lambda: results.get_by_role("link", name=title).count() == 1)
        mark = s_t.mark()
        t0 = time.monotonic()
        assert ines.delete(f"/api/documents/{did}/shares/{sh['shareId']}").status_code == 204
        s_t.wait(lambda f: f.get("type") == "lists_changed", seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        assert time.monotonic() - t0 <= LIVE_S + HARNESS_SLACK_S
        wait_ui(page, lambda: results.get_by_role("link", name=title).count() == 0, what="search result dropped")
    assert did not in tomas.doc_ids() and did not in tomas.doc_ids(q=tok)
    assert all(n["documentId"] != did for n in tomas.notices()["notices"])


def test_wf_saving_status(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        base_text, typed = "Saved base.", " More saved words"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"),))
        did = doc["id"]
        other = st.enter_context(editor(browser, app_url, TOMAS, did))
        page = st.enter_context(editor(browser, app_url, INES, did))
        both = [page, other]
        status = page.get_by_role("status", name="Save status")
        other_status = other.get_by_role("status", name="Save status")
        wait_ui(both, lambda: status.inner_text().strip() == other_status.inner_text().strip() == "All changes saved")
        h = record(status)
        caret_end(page)
        page.keyboard.type(typed)
        wait_ui(both, lambda: "Saving" in log(h) and log(h)[-1] == "All changes saved", what="save cycle")
        snap = ines.snap(did)
        assert snap["text"] == base_text + typed and snap["saveState"] == "saved"
        stored = json.loads(S3().get(f"documents/{did}.json"))
        assert stored["revision"] == snap["revision"] and stored["text"] == snap["text"]
        wait_ui(both, lambda: body_text(other) == norm(snap["text"]) and other_status.inner_text().strip() == "All changes saved",
                what="the other screen shows the stored text as All changes saved")
        page.reload()
        wait_ui(page, lambda: body(page).is_visible() and body_text(page) == norm(snap["text"]))
        assert page.get_by_role("status", name="Save status").inner_text().strip() == "All changes saved"


def test_saved_after_storage_confirms(browser: Browser, app_url: str) -> None:
    ines, tomas = Api(app_url, INES), Api(app_url, TOMAS)
    with ExitStack() as st:
        doc, s_ines = seeded(st, browser, app_url, ines, "Storage confirm text.", ((TOMAS, "editor"),))
        did = doc["id"]
        key = f"documents/{did}.json"
        s_t = joined(st, browser, app_url, TOMAS, did)
        for i in range(3):
            mark = s_ines.mark()
            rev = s_ines.ok_op("editing", [{"insert": f" e{i}", "at": 0}])["revision"]
            f = s_ines.saved(rev, since=mark)
            stored = json.loads(S3().get(key))
            assert stored["revision"] >= f["revision"] >= rev
        mark = s_ines.mark()
        rev = s_t.ok_op("suggesting", [{"insert": " sug", "at": 0}])["revision"]
        s_ines.saved(rev, since=mark)
        stored = json.loads(S3().get(key))
        snap = ines.snap(did)
        assert set(stored) >= {"documentId", "revision", "text", "blocks", "marks", "suggestions"}
        assert stored["documentId"] == did and stored["text"] == snap["text"]
        (sg,) = stored["suggestions"]
        assert sg["authorId"] == tomas.pid and "author" not in sg and sg["inserted"] == snap["suggestions"][0]["inserted"]
        assert snap["savedRevision"] == snap["revision"] and snap["saveState"] == "saved"


def test_storage_outage(browser: Browser) -> None:
    base = os.environ["APP_MINIO_DOWN_URL"]
    health = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    ines = Api(base, INES)
    r = ines.get(f"/api/documents/{SEED_DOC}")
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    with ExitStack() as st:
        doc = make_doc(ines)
        did = doc["id"]
        share(ines, did, TOMAS, "editor")
        first = ines.snap(did)
        assert first["saveState"] == "saved" and first["savedRevision"] == 0
        s_ines = joined(st, browser, base, INES, did)
        s_t = joined(st, browser, base, TOMAS, did)
        mark = s_t.mark()
        words = token("outage")
        rev = s_ines.ok_op("editing", [{"insert": words, "at": 0}])["revision"]
        s_t.wait(lambda f: f.get("type") == "op" and f["revision"] == rev, seconds=LIVE_S + HARNESS_SLACK_S, since=mark)
        s_ines.wait(lambda f: f.get("type") == "save_failed", seconds=SAVE_FAIL_WAIT_S + FRAME_WAIT_S)
        snap = ines.snap(did)
        assert snap["saveState"] == "failed" and snap["savedRevision"] == 0 and snap["text"] == words
        assert not any(f.get("type") == "saved" and f["revision"] >= rev for f in s_ines.frames())
        r = ines.delete(f"/api/documents/{did}")
        assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
        assert ines.snap(did)["text"] == words


def test_wf_saving_outage(browser: Browser) -> None:
    base = os.environ["APP_MINIO_DOWN_URL"]
    ines = Api(base, INES)
    doc = make_doc(ines)
    did = doc["id"]
    share(ines, did, TOMAS, "editor")
    with ExitStack() as st:
        p = st.enter_context(app_page(browser, base, INES, f"/d/{SEED_DOC}"))
        wait_ui(p, lambda: p.get_by_role("heading", name=re.compile(r"^This proposal can['\u2019]t be opened right now$")).is_visible())
        assert "Storage is unreachable. Try again in a minute." in p.locator("body").inner_text()
        a = st.enter_context(editor(browser, base, INES, did))
        b = st.enter_context(editor(browser, base, TOMAS, did))
        status = a.get_by_role("status", name="Save status")
        h = record(status)
        unsaved = token("unsaved")
        caret_end(a)
        a.keyboard.type(unsaved)
        wait_ui([a, b], lambda: unsaved in body_text(b), what="live edit during outage")
        wait_ui([a, b], lambda: status.inner_text().strip() == "Not saved", seconds=SAVE_FAIL_WAIT_S + UI_WAIT_S)
        assert any("Your latest edits are not saved. Quillmere can't reach storage and is retrying." in t for t in visible_alerts(a))
        assert "All changes saved" not in log(h)
        hm = st.enter_context(home(browser, base, INES))
        hit(hm.get_by_role("region", name="My proposals").get_by_role("button", name=f"Delete {doc['title']}"))
        dialog = hm.get_by_role("alertdialog", name="Delete proposal")
        wait_ui(hm, dialog.is_visible)
        click(dialog.get_by_role("button", name="Delete"))
        wait_ui(hm, lambda: any("Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute." in t
                                for t in visible_alerts(hm)))
    assert ines.snap(did)["text"] == unsaved


def test_rebuild_second_tab(browser: Browser, app_url: str) -> None:
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Base text.", ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        a = st.enter_context(editor(browser, app_url, TOMAS, did))
        caret_end(a)
        a.keyboard.type(" Rebuilt")
        for _ in range(len("Rebuilt")):
            a.keyboard.press("Shift+ArrowLeft")
        a.keyboard.press("Control+b")
        wait_ui(a, lambda: any(m["type"] == "bold" and m["length"] == len("Rebuilt") for m in ines.snap(did)["marks"]))
        choose(a, a.get_by_role("radio", name="Suggesting"))
        caret_end(a)
        a.keyboard.type(" Pending")
        wait_ui(a, lambda: len(sugs(ines.snap(did), tomas.pid)) == 1 and ines.snap(did)["text"].endswith(" Pending"),
                what="every typed letter stored before the snapshot")
        text = ines.snap(did)["text"]
        made_comment(priya, did, text.index("Rebuilt"), len("Rebuilt"), "Nice")
        snap = ines.snap(did)
        ids = {s["id"] for s in snap["suggestions"]} | {c["id"] for c in snap["comments"]}
        wait_ui(a, lambda: set(a.evaluate(CARD_IDS_JS)) == ids)

        def same(p: Page) -> None:
            wait_ui(p, lambda: body(p).is_visible() and set(p.evaluate(CARD_IDS_JS)) == ids and body_text(p) == norm(snap["text"]))
            assert p.get_by_role("radio", name="Suggesting").is_checked()
            assert body(p).evaluate(WEIGHT_JS, "Rebuilt") >= 600

        b = a.context.new_page()
        b.goto(app_url + f"/d/{did}")
        same(b)
        a.reload()
        same(a)
        click(a.get_by_role("link", name="Documents"))
        wait_ui(a, lambda: a.get_by_role("heading", name="Documents").is_visible())
        a.go_back()
        same(a)
    assert tomas.snap(did)["myAccess"]["mode"] == "suggesting"


def test_save_announcement_once(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Announce once text.", ((PRIYA, "commenter"),))
        did = doc["id"]
        page = st.enter_context(editor(browser, app_url, INES, did))
        status = page.get_by_role("status", name="Save status")
        wait_ui(page, lambda: status.inner_text().strip() == "All changes saved")
        h = record(status)
        caret_end(page)
        page.keyboard.type(" burst")
        wait_ui(page, lambda: log(h) and log(h)[-1] == "All changes saved" and ines.snap(did)["saveState"] == "saved")
        settled_log = log(h)
        c = made_comment(priya, did, 0, 8, "Re-render the margin")
        wait_ui(page, lambda: card(page, c["id"]).count() == 1)
        advance(page, MOTION_MAX_MS)
        final = log(h)
        assert final == settled_log, final
        assert set(final) == {"Saving", "All changes saved"} and final[0] == "Saving"
        assert all(x != y for x, y in zip(final, final[1:])), final


def tab_until(page: Page, target: Locator) -> None:
    for _ in range(TAB_LIMIT):
        if focus_within(target):
            return
        page.keyboard.press("Tab")
    assert focus_within(target), "control not reachable by Tab"


def test_wf_keyboard_review_viewer(browser: Browser, app_url: str) -> None:
    dana = Api(app_url, DANA)
    rev = dana.snap(SEED_DOC)["revision"]
    with editor(browser, app_url, DANA, SEED_DOC) as page:
        listbox = page.get_by_role("listbox", name="Headings")
        tab_until(page, listbox)
        page.keyboard.press("Home")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: focus_within(body(page)))
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == SEED_SUGGESTION)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: focus_within(body(page)))
        viewing = page.get_by_role("radio", name="Viewing")
        tab_until(page, page.get_by_role("radiogroup", name="Mode"))
        assert focus_within(viewing) and viewing.is_checked()
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) is not None)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: focus_within(body(page)))
        page.keyboard.press("Control+f")
        dialog = page.get_by_role("dialog", name="Find and replace")
        wait_ui(page, lambda: dialog.is_visible() and focus_within(dialog.get_by_role("textbox", name="Find")))
        page.keyboard.type("families")
        wait_ui(page, lambda: f"{SEED_SEARCH_MATCHES} matches" in dialog.inner_text().casefold())
        page.keyboard.press("Escape")
        wait_ui(page, lambda: (dialog.count() == 0 or not dialog.is_visible()) and focus_within(body(page)))
    r = decide(dana, SEED_DOC, SEED_SUGGESTION, "accept")
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    me = dana.snap(SEED_DOC)
    assert me["myAccess"]["mode"] == "viewing" and me["revision"] == rev
    assert SEED_SUGGESTION in {s["id"] for s in me["suggestions"]}
    ines, tomas, priya = Api(app_url, INES), Api(app_url, TOMAS), Api(app_url, PRIYA)
    with ExitStack() as st:
        base_text, added, nested = "Books for families.", " and kids", "X"
        doc, _ = seeded(st, browser, app_url, ines, base_text, ((TOMAS, "editor"), (PRIYA, "commenter")))
        did = doc["id"]
        joined(st, browser, app_url, TOMAS, did).ok_op("suggesting", [{"insert": added, "at": 18}])
        joined(st, browser, app_url, PRIYA, did).ok_op("suggesting", [{"insert": nested, "at": 22}])
        snap = ines.snap(did)
        outer, inner = sugs(snap, tomas.pid)[0]["id"], sugs(snap, priya.pid)[0]["id"]
        b = st.enter_context(editor(browser, app_url, TOMAS, did))
        a = st.enter_context(editor(browser, app_url, INES, did))
        both = [a, b]
        wait_ui(both, lambda: card(a, inner).count() == 1 and card(b, inner).count() == 1)
        said = record(announcements(a))
        caret_start(a)
        a.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(both, lambda: a.evaluate(FOCUSED_CARD_JS) == outer, what="the outer suggestion's card first")
        a.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(both, lambda: a.evaluate(FOCUSED_CARD_JS) == inner, what="the nested suggestion's card next")
        a.keyboard.press("Enter")
        wait_ui(both, lambda: card(a, inner).count() == 0 and card(b, inner).count() == 0, what="nested card accepted by Enter")
        snap = ines.snap(did)
        assert snap["text"] == base_text[:18] + added[:4] + nested + added[4:] + base_text[18:]
        left = sorted(snap["suggestions"], key=lambda s: s["inserted"]["at"])
        assert all(s["author"]["personId"] == tomas.pid for s in left) and outer in {s["id"] for s in left}, left
        spans = [(s["inserted"]["at"], s["inserted"]["at"] + s["inserted"]["length"]) for s in left]
        assert "".join(snap["text"][x:y] for x, y in spans) == added, spans
        assert not any(x <= 22 < y for x, y in spans), spans
        wait_ui(both, lambda: all(card(p, s["id"]).count() == 1 for p in both for s in left), what="Tomas's cards on both screens")
        advance(a, ANNOUNCE_DELAY_MS * 3)
        assert log(said).count("Suggestion accepted") == 1, log(said)


def test_wf_keyboard_review_outline(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        title, head1, para1 = "Budget Justification FY2027", "Personnel", "Coordinator hours match the program calendar."
        head2, para2 = "Notes for the finance office", "Book costs match the vendor quote."
        at1 = len(title) + 1
        at2 = at1 + len(head1) + 1 + len(para1) + 1
        doc, s_ines = seeded(st, browser, app_url, ines, "\n".join([title, head1, para1, head2, para2]))
        did = doc["id"]
        s_ines.ok_op("editing", [{"style": "title", "at": 0}, {"style": "heading1", "at": at1}, {"style": "heading2", "at": at2}])
        page = st.enter_context(editor(browser, app_url, INES, did))
        listbox = page.get_by_role("listbox", name="Headings")
        wait_ui(page, lambda: [norm(t) for t in listbox.get_by_role("option").all_inner_texts()] == [title, head1, head2])
        tab_until(page, listbox)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: focus_within(body(page)))
        page.keyboard.type("Z")
        wait_ui(page, lambda: ines.snap(did)["text"][at2] == "Z")
        page.reload()
        wait_ui(page, lambda: body(page).is_visible() and listbox.get_by_role("option").count() == 3)
        tab_until(page, listbox)
        page.keyboard.press("End")
        page.keyboard.press("Home")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: focus_within(body(page)))
        page.keyboard.type("Y")
        wait_ui(page, lambda: ines.snap(did)["text"] == f"{title}\nY{head1}\n{para1}\nZ{head2}\n{para2}")


def test_wf_keyboard_review_cards(browser: Browser, app_url: str) -> None:
    with editor(browser, app_url, DANA, SEED_DOC) as page:
        order = [SEED_SUGGESTION, SEED_COMMENT]
        caret_start(page)
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == order[0])
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == order[1])
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == order[0])
        page.keyboard.press("Alt+Shift+ArrowUp")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == order[1])
        for control in (page.get_by_role("radio", name="Viewing"), page.get_by_role("listbox", name="Headings"),
                        page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Find and replace")):
            control.focus()
            page.keyboard.press("Alt+Shift+ArrowDown")
            wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) in order, what="card focus from a control")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: focus_within(body(page)))


def test_wf_keyboard_review_mode(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        doc, _ = seeded(st, browser, app_url, ines, "Mode keys.", ((PRIYA, "commenter"),))
        did = doc["id"]
        page = st.enter_context(editor(browser, app_url, PRIYA, did))
        group = page.get_by_role("radiogroup", name="Mode")
        radio = {n: page.get_by_role("radio", name=n) for n in ("Editing", "Suggesting", "Viewing")}
        assert radio["Editing"].is_disabled() and radio["Suggesting"].is_checked()
        radio["Suggesting"].focus()
        for key, expect_name in (("ArrowRight", "Viewing"), ("ArrowRight", "Suggesting"), ("ArrowLeft", "Viewing"),
                                 ("ArrowUp", "Suggesting"), ("ArrowDown", "Viewing")):
            page.keyboard.press(key)
            wait_ui(page, lambda: radio[expect_name].is_checked() and focus_within(radio[expect_name]), what=f"{key}→{expect_name}")
        wait_ui(page, lambda: priya.snap(did)["myAccess"]["mode"] == "viewing")
        page.keyboard.press("Tab")
        assert not focus_within(group)
        page.keyboard.press("Shift+Tab")
        wait_ui(page, lambda: focus_within(radio["Viewing"]))
        a = st.enter_context(editor(browser, app_url, INES, did))
        ed = a.get_by_role("radio", name="Editing")
        ed.focus()
        a.keyboard.press("ArrowLeft")
        wait_ui(a, lambda: a.get_by_role("radio", name="Viewing").is_checked())
        a.keyboard.press("ArrowRight")
        wait_ui(a, lambda: ed.is_checked())


def test_wf_keyboard_review_find(browser: Browser, app_url: str) -> None:
    with editor(browser, app_url, DANA, SEED_DOC) as page:
        opener = page.get_by_role("toolbar", name="Formatting").get_by_role("button", name="Find and replace")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Find and replace")
        find = dialog.get_by_role("textbox", name="Find")
        wait_ui(page, lambda: dialog.is_visible() and focus_within(find))
        ann = record(announcements(page))
        page.keyboard.type("families")
        count = f"{SEED_SEARCH_MATCHES} matches"
        wait_ui(page, lambda: count in dialog.inner_text().casefold())
        advance(page, ANNOUNCE_DELAY_MS)
        wait_ui(page, lambda: count in log(ann))
        advance(page, ANNOUNCE_DELAY_MS * 3)
        assert log(ann).count(count) == 1
        page.keyboard.press("Enter")
        wait_ui(page, lambda: re.search(rf"Match \d of {SEED_SEARCH_MATCHES}", dialog.inner_text(), re.I))
        find.focus()
        page.keyboard.press("Shift+Tab")
        assert focus_within(dialog) and not focus_within(find)
        page.keyboard.press("Tab")
        assert focus_within(find)
        for _ in range(TAB_LIMIT // 4):
            page.keyboard.press("Tab")
            assert focus_within(dialog)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: (dialog.count() == 0 or not dialog.is_visible()) and focus_within(opener))
        caret_start(page)
        page.keyboard.press("Control+f")
        wait_ui(page, lambda: dialog.is_visible() and focus_within(find))
        page.keyboard.press("Escape")
        wait_ui(page, lambda: focus_within(body(page)))


def phone_doc(st: ExitStack, browser: Browser, base: str, ines: Api) -> tuple[str, str, str]:
    doc, _ = seeded(st, browser, base, ines, "Phone review paragraph with enough words to wrap.",
                    ((TOMAS, "editor"), (PRIYA, "commenter")))
    did = doc["id"]
    s_t = joined(st, browser, base, TOMAS, did)
    s_t.ok_op("suggesting", [{"insert": " NEW", "at": 5}])
    sid = ines.snap(did)["suggestions"][0]["id"]
    c = made_comment(ines, did, 20, 9, "Phone note")
    return did, sid, c["id"]


def test_wf_mobile_review_phone(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        did, sid, cid = phone_doc(st, browser, app_url, ines)
        page = st.enter_context(editor(browser, app_url, PRIYA, did, size=VIEWPORTS["phone"]))
        layout(page)
        chip = page.get_by_role("button", name=CARD_CHIP_NAME).and_(page.locator(f'[data-marker-for="{sid}"]'))
        wait_ui(page, chip.is_visible)
        first = sid
        tap(chip)
        sheet = page.get_by_role("dialog", name="Comments and suggestions")
        wait_ui(page, lambda: sheet.is_visible() and page.evaluate(FOCUSED_CARD_JS) == first)
        steady(page, sheet.get_by_role("button", name="Close"))
        click(sheet.get_by_role("button", name="Close"))
        wait_ui(page, lambda: gone(page, sheet))
        caret_end(page)
        page.keyboard.type(" phone")
        wait_ui(page, lambda: len(sugs(ines.snap(did), priya.pid)) == 1)
        select_range(page, 0, 5)
        click(page.get_by_role("button", name="Toolbar"))
        menu = page.get_by_role("menu", name="Toolbar")
        wait_ui(page, menu.is_visible)
        click(menu.get_by_role("menuitem", name="Comment"))
        box = page.get_by_role("textbox", name="Comment")
        wait_ui(page, box.is_visible)
        steady(page, box)
        note = token("phone")
        fill(box, note)
        steady(page, page.get_by_role("button", name="Post"))
        click(page.get_by_role("button", name="Post"))
        wait_ui(page, lambda: any(c["author"]["personId"] == priya.pid for c in ines.snap(did)["comments"]))
        layout(page)
        snap = ines.snap(did)
        (made,) = sugs(snap, priya.pid)
        assert span(snap["text"], made["inserted"]) == " phone"
        owner = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["phone"]))
        phones = [page, owner]
        said = record(announcements(owner))
        owner_chip = owner.get_by_role("button", name=CARD_CHIP_NAME).and_(owner.locator(f'[data-marker-for="{made["id"]}"]'))
        wait_ui(phones, owner_chip.is_visible, what="the Commenter's suggestion reaches the Owner's phone")
        tap(owner_chip)
        owner_sheet = owner.get_by_role("dialog", name="Comments and suggestions")
        wait_ui(phones, lambda: owner_sheet.is_visible() and owner.evaluate(FOCUSED_CARD_JS) == made["id"])
        credit = card(owner, made["id"]).inner_text().casefold()
        assert PRIYA.name.casefold() in credit and "commenter" in credit
        accept = card(owner, made["id"]).get_by_role("button", name="Accept")
        steady(owner, accept)
        tap(accept)
        wait_ui(phones, lambda: card(owner, made["id"]).count() == 0 and page.locator(f'[data-marker-for="{made["id"]}"]').count() == 0,
                what="the settled card leaves both phones")
        advance(owner, ANNOUNCE_DELAY_MS * 3)
        assert log(said).count("Suggestion accepted") == 1, log(said)
        layout(owner)
    snap = ines.snap(did)
    assert made["id"] not in {s["id"] for s in snap["suggestions"]} and " phone" in snap["text"]
    mine = [c for c in snap["comments"] if c["author"]["personId"] == priya.pid][0]
    assert mine["body"] == note and mine["anchor"] == {"at": 0, "length": 5}


def test_wf_mobile_review_sheet(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        did, sid, cid = phone_doc(st, browser, app_url, ines)
        page = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["phone"]))
        assert page.get_by_role("button", name="Toolbar").is_visible()
        assert gone(page, page.get_by_role("toolbar", name="Formatting"))
        for n in ("Editing", "Suggesting", "Viewing"):
            box = page.get_by_role("radio", name=n).evaluate(TAP_TARGET_JS)
            assert box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX, (n, box)
        assert page.locator(f'[data-marker-for="{sid}"]').count() == 1 and page.locator(f'[data-marker-for="{cid}"]').count() == 1
        chip = page.get_by_role("button", name=CARD_CHIP_NAME).and_(page.locator(f'[data-marker-for="{sid}"]'))
        wait_ui(page, chip.is_visible)
        chip.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Comments and suggestions")
        wait_ui(page, lambda: sheet.is_visible() and page.evaluate(FOCUSED_CARD_JS) == sid)
        settle(sheet)
        target = card(page, sid)
        for name in ("Accept", "Reject"):
            box = target.get_by_role("button", name=name).bounding_box()
            assert box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX, (name, box)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: gone(page, sheet) and (focus_within(chip) or focus_within(body(page))),
                what="sheet closed with focus on its chip or, by the card rule, on the page")
        tb = page.get_by_role("button", name="Toolbar")
        tb.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="Toolbar")
        wait_ui(page, menu.is_visible)
        items = {norm(t).casefold() for t in menu.get_by_role("menuitem").all_inner_texts()}
        assert {"bold", "italic", "comment", "find and replace", "accept all", "reject all", "outline", "share"} <= items
        page.keyboard.press("Escape")
        wait_ui(page, lambda: gone(page, menu) and focus_within(tb))
        layout(page)


@pytest.mark.parametrize("viewport", LAYOUT_IDS, ids=LAYOUT_IDS)
def test_published_layouts(browser: Browser, app_url: str, viewport: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        did, _, _ = phone_doc(st, browser, app_url, ines)
        page = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS[viewport]))
        layout(page)
        page_box = body(page).bounding_box()
        top = page.get_by_role("link", name="Documents").bounding_box()["y"]
        bar = (page.get_by_role("button", name="Toolbar") if viewport == "phone" else page.get_by_role("toolbar", name="Formatting")).bounding_box()["y"]
        status = page.get_by_role("region", name="Document status").bounding_box()["y"]
        assert top < bar < status < page_box["y"]
        margin = page.get_by_role("complementary", name="Margin")
        if viewport == "desktop":
            outline = page.get_by_role("navigation", name="Outline").bounding_box()
            assert outline["x"] + outline["width"] <= page_box["x"] + ALIGN_TOL_PX
            assert margin.bounding_box()["x"] >= page_box["x"] + page_box["width"] - ALIGN_TOL_PX
            assert page.get_by_role("button", name="Outline").count() == 0 or not page.get_by_role("button", name="Outline").is_visible()
        elif viewport == "tablet":
            btn = page.get_by_role("button", name="Outline")
            assert btn.get_attribute("aria-expanded") == "false"
            assert gone(page, page.get_by_role("listbox", name="Headings"))
            assert margin.bounding_box()["x"] >= page_box["x"] + page_box["width"] - ALIGN_TOL_PX
            click(btn)
            wait_ui(page, lambda: btn.get_attribute("aria-expanded") == "true" and page.get_by_role("listbox", name="Headings").evaluate(SHOWN_JS))
            page.keyboard.press("Escape")
            wait_ui(page, lambda: btn.get_attribute("aria-expanded") == "false" and focus_within(btn))
        else:
            assert gone(page, page.get_by_role("toolbar", name="Formatting"))
            assert gone(page, margin) or margin.bounding_box()["y"] >= page_box["y"] + page_box["height"]
            assert page.get_by_role("button", name="Comments and suggestions").is_visible()
            assert page.get_by_role("radiogroup", name="Mode").is_visible()
        layout(page)


def crowded_doc(st: ExitStack, browser: Browser, base: str, ines: Api) -> tuple[str, str, str, str]:
    filler = "\n".join(f"Filler paragraph number {i} for spacing." for i in range(TAB_LIMIT // 4))
    doc, s_ines = seeded(st, browser, base, ines, "First line words here.\n" + filler + "\nLast paragraph anchor.",
                         ((TOMAS, "editor"), (PRIYA, "commenter")))
    did = doc["id"]
    priya = Api(base, PRIYA)
    s_t = joined(st, browser, base, TOMAS, did)
    s_t.ok_op("suggesting", [{"insert": "ADD ", "at": 6}])
    text = ines.snap(did)["text"]
    sid = ines.snap(did)["suggestions"][0]["id"]
    c2 = made_comment(priya, did, text.index("here"), 4, "Same line")["id"]
    c3 = made_comment(priya, did, text.index("anchor"), 6, "Far below")["id"]
    return did, sid, c2, c3


def test_margin_tether_alignment(browser: Browser, app_url: str) -> None:
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    with ExitStack() as st:
        did, sid, c2, c3 = crowded_doc(st, browser, app_url, ines)
        page = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["desktop"]))
        wait_ui(page, lambda: all(card(page, i).count() == 1 for i in (sid, c2, c3)))
        for i in (sid, c2, c3):
            settle(card(page, i))
        g = {i: page.evaluate(GEOM_JS, i) for i in (sid, c2)}
        assert abs(g[sid]["card"]["top"] - g[sid]["first"]) <= ALIGN_TOL_PX
        gap = g[c2]["card"]["top"] - g[sid]["card"]["bottom"]
        assert abs(gap - STACK_GAP_PX) <= ALIGN_TOL_PX, gap
        card(page, c3).evaluate("el => el.scrollIntoView({block: 'center'})")
        settle(card(page, c3))
        g[c3] = page.evaluate(GEOM_JS, c3)
        assert abs(g[c3]["card"]["top"] - g[c3]["first"]) <= ALIGN_TOL_PX
        for i in (sid, c3):
            gi = page.evaluate(GEOM_JS, i)
            assert gi["tether"] is not None and float(gi["stroke"].rstrip("px")) == 1
            assert abs(gi["tether"]["right"] - gi["card"]["left"]) <= ALIGN_TOL_PX
            assert abs(gi["tether"]["left"] - gi["lastRight"]) <= ALIGN_TOL_PX
        assert rgb(priya.person["colour"]) in page.evaluate(GEOM_JS, c3)["strokeColour"]


def test_card_focus_settle_motion(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        did, sid, c2, _ = crowded_doc(st, browser, app_url, ines)
        page = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["desktop"]))
        wait_ui(page, lambda: card(page, sid).count() == 1 and card(page, c2).count() == 1)
        settle(card(page, sid))
        settle(card(page, c2))
        page.evaluate(ANIM_JS)
        before = page.evaluate(GEOM_JS, sid)
        caret_start(page)
        page.keyboard.press("Alt+Shift+ArrowDown")
        path = motion(card(page, sid), MOTION_MAX_MS)
        page.evaluate(FINISH_ALL_JS)

        def focused_look() -> bool:
            g = page.evaluate(GEOM_JS, sid)
            return g["stroke"] is not None and float(g["stroke"].rstrip("px")) == 2 and g["wash"] != before["wash"]

        wait_ui(page, focused_look, what="2 px tether and deeper wash on the focused card")
        after = page.evaluate(GEOM_JS, sid)
        assert abs((before["card"]["left"] - after["card"]["left"]) - FOCUS_SHIFT_PX) <= ALIGN_TOL_PX
        assert movement_ms(path, ("x", "left")) <= MOTION_MAX_MS
        pre = page.evaluate(GEOM_JS, c2)
        hit(card(page, sid).get_by_role("button", name="Accept"))
        below = card(page, c2)
        wait_ui(page, lambda: below.evaluate(ANIMATING_JS) or page.evaluate(GEOM_JS, c2)["card"]["top"] < pre["card"]["top"] - 1,
                seconds=SAMPLE_WINDOW_MS / 1000 + UI_WAIT_S, what="the card below starts its glide after the decision")
        path = motion(below, MOTION_MAX_MS)
        wait_ui(page, lambda: card(page, sid).count() == 0)
        page.evaluate(FINISH_ALL_JS)

        def settled_below() -> bool:
            g = page.evaluate(GEOM_JS, c2)
            return (g["card"]["top"] < pre["card"]["top"] - 1 and abs(g["card"]["top"] - g["first"]) <= ALIGN_TOL_PX
                    and g["tether"] is not None and abs(g["tether"]["right"] - g["card"]["left"]) <= ALIGN_TOL_PX)

        wait_ui(page, settled_below, what="card below aligned with its tether attached")
        ys = [coord(p, "y", "top") for p in path]
        assert any(min(ys[0], ys[-1]) + 1 < y < max(ys[0], ys[-1]) - 1 for y in ys), "card jumped instead of gliding"
        assert movement_ms(path, ("y", "top")) <= MOTION_MAX_MS
        assert all(isinstance(t, (int, float)) and t <= MOTION_MAX_MS for t in page.evaluate("() => window.__anims"))


def test_reduced_motion_tethers(browser: Browser, app_url: str) -> None:
    ines = Api(app_url, INES)
    with ExitStack() as st:
        did, sid, c2, _ = crowded_doc(st, browser, app_url, ines)
        s_ines = joined(st, browser, app_url, INES, did)
        page = st.enter_context(editor(browser, app_url, INES, did, size=VIEWPORTS["desktop"], reduced=True))
        wait_ui(page, lambda: card(page, sid).count() == 1 and page.evaluate(GEOM_JS, sid)["tether"] is not None)
        page.evaluate(ANIM_JS)
        before = page.evaluate(GEOM_JS, sid)
        caret_start(page)
        page.keyboard.press("Alt+Shift+ArrowDown")
        wait_ui(page, lambda: page.evaluate(FOCUSED_CARD_JS) == sid)
        for _ in range(LAYOUT_FRAMES):
            if abs((before["card"]["left"] - page.evaluate(GEOM_JS, sid)["card"]["left"]) - FOCUS_SHIFT_PX) <= ALIGN_TOL_PX:
                break
            advance(page, FRAME_MS)
        after = page.evaluate(GEOM_JS, sid)
        assert abs((before["card"]["left"] - after["card"]["left"]) - FOCUS_SHIFT_PX) <= ALIGN_TOL_PX
        pre = page.evaluate(GEOM_JS, c2)
        s_ines.ok_op("editing", [{"insert": "Inserted top line\n", "at": 0}])
        wait_ui(page, lambda: page.evaluate(GEOM_JS, c2)["card"]["top"] > pre["card"]["top"] + 1)
        moved = page.evaluate(GEOM_JS, c2)
        assert moved["tether"] is not None and abs(moved["tether"]["right"] - moved["card"]["left"]) <= ALIGN_TOL_PX
        hit(card(page, sid).get_by_role("button", name="Accept"))
        wait_ui(page, lambda: card(page, sid).count() == 0)
        assert body(page).evaluate(INK_JS, "ADD") == body(page).evaluate(INK_JS, "First")
        assert all(isinstance(t, (int, float)) and t <= JUMP_MAX_MS for t in page.evaluate("() => window.__anims"))
        assert page.evaluate(GEOM_JS, c2)["tether"] is not None


def test_health_and_serve(browser: Browser, app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    r = httpx.get(app_url + "/sign-in", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    with app_page(browser, app_url, None, "/sign-in") as page:
        wait_ui(page, lambda: page.get_by_role("heading", name="Sign in to Quillmere Drafts").is_visible())
        assert page.get_by_role("button", name="Sign in").is_visible()


def test_server_boundary(browser: Browser, app_url: str) -> None:
    anon = Api(app_url)
    parsed = urlparse(app_url)
    own = f"{parsed.scheme}://{parsed.netloc}"
    evil = "http://evil.example"
    r = anon.post("/api/session", {"email": INES.email, "password": PASSWORD}, headers={"origin": evil})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"} and not r.cookies
    assert not any(k.lower().startswith("access-control-") for k in r.headers)
    r = anon.c.post("/api/session", content=b"x" * (MAX_BODY_BYTES + 1), headers={"origin": evil, "content-type": "text/plain"})
    assert r.status_code == 403
    r = anon.post("/api/session", {"email": INES.email, "password": PASSWORD}, headers={"origin": own})
    assert r.status_code == 200
    r = Api(app_url).c.post("/api/documents", content=b"{}", headers={"content-type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}

    def padded(total: int) -> bytes:
        payload = {"email": "nobody@quillmere.test", "password": ""}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        payload["password"] = "p" * (total - len(raw))
        raw = json.dumps(payload, separators=(",", ":")).encode()
        assert len(raw) == total
        return raw

    r = Api(app_url).c.post("/api/session", content=padded(MAX_BODY_BYTES), headers={"content-type": JSON_TYPE})
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    r = Api(app_url).c.post("/api/session", content=padded(MAX_BODY_BYTES + 1), headers={"content-type": JSON_TYPE})
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    upgrade = {"connection": "Upgrade", "upgrade": "websocket", "sec-websocket-version": "13", "sec-websocket-key": WS_KEY}
    assert httpx.get(app_url + "/api/socket", headers=upgrade, timeout=HTTP_TIMEOUT_S).status_code == 403
    assert httpx.get(app_url + "/api/socket", headers={**upgrade, "origin": evil}, timeout=HTTP_TIMEOUT_S).status_code == 403
    assert httpx.get(app_url + "/api/socket", headers={**upgrade, "origin": own}, timeout=HTTP_TIMEOUT_S).status_code == 401
    with Sock(browser, app_url, INES) as s:
        s.emit_raw(json.dumps({"type": "heartbeat", "ref": "big", "pad": "x" * MAX_BODY_BYTES}))
        f = s.wait(lambda f: f.get("type") == "error" and f.get("code") == "too_large")
        assert f
        r = s.send({"type": "heartbeat"})
        assert r["type"] == "ack" or (r["type"] == "error" and r.get("code") == "not_joined"), r
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    html = httpx.get(app_url + "/sign-in", timeout=HTTP_TIMEOUT_S).text
    assets = set(re.findall(r'(?:src|href)="(/[^"]+)"', html))
    served = [html] + [httpx.get(app_url + a, timeout=HTTP_TIMEOUT_S).text for a in assets]
    for name in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL"):
        value = os.environ.get(name, "")
        if len(value) >= 6:
            assert all(value not in body_ for body_ in served), name


def npm_tree() -> dict[tuple[str, str], Any]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=str(DEPLOYED_APP),
                         capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    data = json.loads(out.stdout)
    pkgs: dict[tuple[str, str], Any] = {}

    def walk(node: dict) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            if not dep.get("version") or (name, dep["version"]) in pkgs:
                continue
            pkgs[(name, dep["version"])] = dep.get("license")
            walk(dep)

    walk(data)
    return pkgs


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in npm_tree() if name not in notices})
    assert not missing, missing
    assert "Newsreader" in notices and "Source Serif 4" in notices and re.search(r"icon", notices, re.I)


def test_if_licences() -> None:
    def ok(lic: Any) -> bool:
        if isinstance(lic, dict):
            lic = lic.get("type")
        return isinstance(lic, str) and any(p.strip("() ") in ALLOWED_LICENCES for p in re.split(r"\s+OR\s+", lic))

    bad = sorted(f"{n}@{v}: {lic}" for (n, v), lic in npm_tree().items() if not ok(lic))
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores() -> None:
    assert not {n for n, _ in npm_tree()} & EMBEDDED_STORES
    files = [p for p in Path("/app").rglob("*") if "node_modules" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not files, files


def test_if_typescript() -> None:
    root = Path("/app")
    assert (root / "package-lock.json").is_file()
    skip = {"node_modules", "dist", "build", ".git", "coverage"}
    files = [p for p in root.rglob("*") if p.is_file() and not skip & set(p.relative_to(root).parts)]
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    source_tops = {p.relative_to(root).parts[0] for p in files if p.suffix in (".ts", ".tsx") and p.parent != root}
    js = [p for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and p.parent != root
          and p.relative_to(root).parts[0] in source_tops]
    assert not js, js


def test_if_service_config() -> None:
    assert f"documents/{SEED_DOC}.json" in S3().keys("documents/")
    assert Postgres().tables()
