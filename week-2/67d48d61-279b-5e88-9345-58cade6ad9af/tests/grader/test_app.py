from __future__ import annotations

import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from conftest import (
    AXE,
    advance,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    post_json,
    same_origin,
    select,
    settle,
    style,
    tap,
    unique,
)

try:
    from conftest import PocketBase, Postgres, S3
except ImportError:
    from minio_client import S3
    from pocketbase_client import PocketBase
    from postgres_client import Postgres


PULL_MAX_S = 5
LIVE_MAX_MS = 2000
CASCADE_MAX_MS = 600
DEPTH_STEP_MS = 60
DEPTH_GAP_MIN_MS = DEPTH_STEP_MS / 2
LINE_MAX_PX = 4
LINE_REGION = 0.5
DEFAULT_OPENING_DAYS = 38
JSON_LIMIT = 65536
UPLOAD_LIMIT = 10_000_000
LINK_TTL_S = 60
ROLLOVER_MAX_S = 5
BANNER_MAX_S = 10
PANE_PX = 420
RAIL_PX = 240
TAP_MIN_PX = 44
WIDE = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
HOVER_MIN_MS = 100
HOVER_MAX_MS = 160
PANE_IN_MS = 240
PANE_OUT_MS = 160
BULK_MAX = 100
TITLE_MAX = 140
DETAILS_MAX = 4000
KEY_MAX = 100
WEEK_DAYS = 7
SHORT_MIN_S = 10
SHORT_MAX_S = 604_800
NOTES_ROWS = 20
FOCUS_ROWS = 12
UNDO_ROWS = 15

HTTP_TIMEOUT_S = 30
UI_DEADLINE_S = 20
QUICK_MS = 250
STEP_MS = 100
FRAME_MS = 16
SKEW_S = 5
PX_SLACK = 1
TRAP_PRESSES = 12
NPM_TIMEOUT_S = 120
BOOT_DEADLINE_S = 180
LOG_TAIL = 4000
TZ_SLACK_DAYS = 1
OPENING_PROBE_DAYS = 9
ROLL_CYCLE_S = 60

UNKNOWN_ID = "STG-999999"
UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
PDF = b"%PDF-1.4\n%verifier\n"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00"
GIF = b"GIF89a"

STATUS_NAMES = {"backlog": "Backlog", "todo": "Todo", "in_progress": "In progress", "done": "Done",
                "cancelled": "Cancelled", "triage": "Triage", "duplicate": "Duplicate"}
CREW = {"maya": "Maya Okonjo", "devi": "Devi Rangan", "sasha": "Sasha Bell", "ines": "Ines Hart",
        "kofi": "Kofi Mensah", "ruth": "Ruth Alder", "oren": "Oren Vale", "leon": "Leon Park"}
DEPARTMENTS = {"carpentry": "Carpentry", "paint": "Paint", "lighting": "Lighting", "sound": "Sound",
               "wardrobe": "Wardrobe", "props": "Props"}
CYCLES = {"rehearsal-1": "Rehearsal 1", "rehearsal-2": "Rehearsal 2", "rehearsal-3": "Rehearsal 3",
          "tech": "Tech", "previews": "Previews"}
OPEN = {"backlog", "todo", "in_progress"}
VIEW_PARAMS = {"view", "dept", "blocked", "group", "cycle", "row", "task"}
ID_RE = re.compile(r"^STG-\d+")
JSON_TYPE = "application/json; charset=utf-8"
INTAKE_DOWN = ("Request intake is unreachable. New requests reach triage when it is back, "
               "and decisions are paused.")
STORAGE_DOWN = ("Plot storage is unreachable. Attachments can't be uploaded or opened right now; "
                "everything else still works.")
RESERVED_EMPTY = {"dept": "wardrobe", "cycle": "previews", "blocked": "1"}


def h(who: str = "maya") -> dict[str, str]:
    return {"X-Crew-Member": who}


def api_get(base: str, path: str, **params: str) -> httpx.Response:
    return httpx.get(f"{base}{path}", params=params or None, timeout=HTTP_TIMEOUT_S)


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, f"{r.status_code} {r.text[:600]}"
    return r.json()


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text[:600]}"
    body = r.json()
    assert set(body) == {"error"}, body
    assert body["error"]["code"] == code, body
    assert isinstance(body["error"]["message"], str)
    return body["error"]


def snapshot(base: str) -> dict:
    return ok(api_get(base, "/api/snapshot"))


def production(base: str) -> dict:
    return ok(api_get(base, "/api/production"))


def current_cycle(base: str) -> dict:
    return next(c for c in snapshot(base)["cycles"] if c["current"])


def get_task(base: str, tid: str) -> dict:
    return ok(api_get(base, f"/api/tasks/{tid}"))["task"]


def activity(base: str, tid: str) -> list[dict]:
    return ok(api_get(base, f"/api/tasks/{tid}/activity"))["activity"]


def attachments(base: str, tid: str) -> list[dict]:
    return ok(api_get(base, f"/api/tasks/{tid}/attachments"))["attachments"]


def create(base: str, dept: str = "props", who: str = "maya", **fields: Any) -> dict:
    title = fields.pop("title", None) or unique("note")[0]
    result = ok(post_json(base, "/api/tasks", {"title": title, "department": dept, **fields}, **h(who)), 201)
    return next(t for t in result["tasks"] if t["title"] == title)


def patch(base: str, tid: str, body: dict, version: int | None = None, who: str = "maya") -> httpx.Response:
    if version is None:
        version = get_task(base, tid)["version"]
    return httpx.patch(f"{base}/api/tasks/{tid}", json=body,
                       headers={"If-Match": str(version), **h(who)}, timeout=HTTP_TIMEOUT_S)


def edit(base: str, tid: str, who: str = "maya", **body: Any) -> dict:
    return ok(patch(base, tid, body, who=who))


def bulk(base: str, ids: list[str], change: dict, who: str = "maya", key: str | None = None) -> httpx.Response:
    entries = [{"id": i, "version": get_task(base, i)["version"]} for i in ids]
    return post_json(base, "/api/tasks/bulk", {"tasks": entries, "set": change}, key, **h(who))


def link(base: str, blocker: str, blocked: str, who: str = "maya") -> httpx.Response:
    return post_json(base, f"/api/tasks/{blocker}/relations", {"blocks": blocked}, **h(who))


def undo(base: str, who: str = "maya", key: str | None = None) -> httpx.Response:
    return post_json(base, "/api/undo", {}, key, **h(who))


def decide(base: str, tid: str, body: dict, who: str = "maya", key: str | None = None) -> httpx.Response:
    return post_json(base, f"/api/triage/{tid}/decision", body, key, **h(who))


def upload(base: str, tid: str, name: str, content: bytes, ctype: str, kind: str = "plot",
           who: str = "maya") -> httpx.Response:
    return httpx.post(f"{base}/api/tasks/{tid}/attachments", files={"file": (name, content, ctype)},
                      data={"kind": kind}, headers=h(who), timeout=HTTP_TIMEOUT_S)


def poll(fn: Callable[[], Any], seconds: float, message: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < deadline, message


def file_request(base: str, department: str = "sound", details: str = "",
                 requester: str = "Leon Park") -> tuple[str, dict]:
    title = unique("request")[0]
    body = {"title": title, "requester": requester, "details": details, "department": department}
    return title, ok(post_json(base, "/api/requests", body), 201)["request"]


def triage_tasks(base: str, title: str) -> list[dict]:
    return [t for t in ok(api_get(base, "/api/tasks", status="triage"))["tasks"] if t["title"] == title]


def pulled(base: str, title: str) -> dict:
    found = poll(lambda: triage_tasks(base, title), UI_DEADLINE_S, f"{title} never reached triage")
    return found[0]


def pb_requests(title: str) -> list[dict]:
    return [r for r in PocketBase().records("requests", where=f'title="{title}"') if r["title"] == title]


def requests_by_title(base: str) -> dict[str, tuple[int, dict]]:
    listing = ok(api_get(base, "/api/requests"))["requests"]
    return {r["title"]: (i, r) for i, r in enumerate(listing)}


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, c) for c in calls]
        return [f.result() for f in futures]


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def cascade_tasks(base: str, dept: str = "props", freed_dept: str | None = None) -> tuple[str, str, str, str]:
    common = {"priority": 1, "status": "todo", "cycle": "previews"}
    parent = create(base, dept, **common)["id"]
    sub = create(base, dept, parent=parent, **common)["id"]
    direct = create(base, freed_dept or dept, **common)["id"]
    rolled = create(base, freed_dept or dept, **common)["id"]
    ok(link(base, sub, direct), 201)
    ok(link(base, parent, rolled), 201)
    return parent, sub, direct, rolled


def costume(base: str) -> tuple[str, str, str]:
    parent = create(base, "wardrobe", status="todo", cycle="previews", priority=1)["id"]
    edit(base, parent, status="in_progress")
    subs = [create(base, "wardrobe", status="todo", cycle="previews", priority=1, parent=parent)["id"]
            for _ in range(3)]
    sound = create(base, "sound", status="todo", cycle="previews", priority=1)["id"]
    ok(link(base, parent, sound), 201)
    edit(base, subs[0], who="ruth", status="done")
    edit(base, subs[1], who="ruth", status="done")
    edit(base, subs[2], who="ruth", status="in_progress")
    return parent, subs[2], sound


class Events:

    def __init__(self, base: str) -> None:
        self.items: list[dict] = []
        self.connected = False
        self.cond = threading.Condition()
        self.client = httpx.Client(base_url=base, timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=None))
        threading.Thread(target=self._run, daemon=True).start()
        with self.cond:
            assert self.cond.wait_for(lambda: self.connected, HTTP_TIMEOUT_S), "event stream never opened"

    def _run(self) -> None:
        try:
            with self.client.stream("GET", "/api/events") as response:
                with self.cond:
                    self.connected = response.status_code == 200
                    self.cond.notify_all()
                event, data = "message", []
                for line in response.iter_lines():
                    if line == "":
                        if data:
                            with self.cond:
                                self.items.append({"event": event, "data": json.loads("\n".join(data))})
                                self.cond.notify_all()
                        event, data = "message", []
                    elif line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].lstrip())
        except Exception:
            return

    def wait(self, pred: Callable[[dict], bool], seconds: float) -> dict:
        with self.cond:
            assert self.cond.wait_for(lambda: any(pred(e) for e in self.items), seconds), "event never arrived"
            return next(e for e in self.items if pred(e))

    def close(self) -> None:
        self.client.close()


@contextmanager
def entered(it: Any) -> Iterator[Any]:
    if hasattr(it, "__enter__"):
        with it as value:
            yield value
    else:
        value = next(it)
        try:
            yield value
        finally:
            it.close()


@contextmanager
def ui(browser: Browser, base: str, path: str = "/tasks", size: tuple[int, int] = WIDE,
       reduced: bool = False, **params: str | None) -> Iterator[Page]:
    query = urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{base}{path}" + (f"?{query}" if query else "")
    with entered(open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference")) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if size != WIDE:
            page.reload()
        yield page


def eventually(page: Page, probe: Callable[[], None], seconds: float = UI_DEADLINE_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            probe()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def live(page: Page, probe: Callable[[], None], until: float) -> None:
    while True:
        try:
            probe()
            return
        except AssertionError:
            if time.monotonic() > until:
                raise
            advance(page, FRAME_MS)


def visible(page: Page, loc: Locator, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=QUICK_MS), seconds)


def contains(page: Page, loc: Locator, text: str) -> None:
    eventually(page, lambda: expect(loc).to_contain_text(text, timeout=QUICK_MS))


def lacks(page: Page, loc: Locator, text: str) -> None:
    eventually(page, lambda: expect(loc).not_to_contain_text(text, timeout=QUICK_MS))


def attr(page: Page, loc: Locator, name: str, value: str) -> None:
    eventually(page, lambda: expect(loc).to_have_attribute(name, value, timeout=QUICK_MS))


def no_attr(page: Page, loc: Locator, name: str) -> None:
    eventually(page, lambda: expect(loc).not_to_have_attribute(name, re.compile(".*"), timeout=QUICK_MS))


def at_rest(page: Page, loc: Locator, seconds: float = UI_DEADLINE_S) -> None:
    visible(page, loc)
    deadline, last = time.monotonic() + seconds, None
    while True:
        settle(loc)
        box = loc.bounding_box()
        if box is not None and box == last:
            return
        if time.monotonic() > deadline:
            raise AssertionError(f"still moving after {seconds} s: {box}")
        last = box
        advance(page, FRAME_MS)


def gone(page: Page, loc: Locator) -> None:
    def probe() -> None:
        if loc.count() and loc.first.is_visible():
            settle(loc.first)
            box = loc.first.bounding_box()
            vp = page.viewport_size
            inside = bool(box) and box["width"] > 0 and box["x"] < vp["width"] and box["x"] + box["width"] > 0 \
                and box["y"] < vp["height"] and box["y"] + box["height"] > 0
            opacity = float(loc.first.evaluate("e => getComputedStyle(e).opacity"))
            assert not inside or opacity == 0, "still shown"
    eventually(page, probe)


def row_re(tid: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(tid)}\b")


def tasks_grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Tasks")


def row(page: Page, tid: str, grid: str = "Tasks") -> Locator:
    return page.get_by_role("grid", name=grid).get_by_role("row", name=row_re(tid))


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices")


def details(page: Page) -> Locator:
    return page.get_by_role("complementary", name="Task details")


def sheet(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Task details")


def toolbar(page: Page) -> Locator:
    return page.get_by_role("toolbar", name="Task tools")


def rail(page: Page) -> Locator:
    return page.get_by_role("navigation", name="Departments")


def triage_link(page: Page, n: int) -> Locator:
    return rail(page).get_by_role("link", name=f"Triage {n}", exact=True)


def same_type(header: str) -> bool:
    return header.replace(" ", "").lower() == JSON_TYPE.replace(" ", "")


def blocked_link(page: Page, n: int) -> Locator:
    return page.get_by_role("banner").get_by_role("link", name=f"{n} blocked", exact=True)


def service_alerts(page: Page) -> Locator:
    return page.get_by_role("region", name="Service status").get_by_role("alert")


def notice(page: Page, text: str) -> None:
    eventually(page, lambda: expect(notices(page)).to_have_text(text, timeout=QUICK_MS))


def ready(page: Page) -> None:
    visible(page, tasks_grid(page))


def current(page: Page, tid: str, grid: str = "Tasks") -> None:
    attr(page, row(page, tid, grid), "aria-current", "true")


def work_as(page: Page, name: str) -> None:
    select(page.get_by_role("combobox", name="Working as"), name)


def query(page: Page) -> dict[str, str]:
    return {k: v[-1] for k, v in parse_qs(urlparse(page.url).query).items()}


def history_length(page: Page) -> int:
    return page.evaluate("() => history.length")


def mark(page: Page) -> None:
    page.evaluate("() => { window.__verifierMark = 'kept'; }")


def kept(page: Page) -> None:
    assert page.evaluate("() => window.__verifierMark") == "kept", "the tab reloaded"


def tag_opener(page: Page, ids: list[str] = ()) -> str | None:
    page.evaluate("() => document.activeElement?.setAttribute('data-verifier-opener', '1')")
    for tid in ids:
        loc = row(page, tid)
        if loc.count() and loc.first.evaluate("r => r.contains(document.activeElement)"):
            return tid
    return None


def back_at_opener(page: Page, opener_row: str | None = None) -> None:
    if opener_row:
        eventually(page, lambda: _assert_eq(row(page, opener_row).first.evaluate(
            "r => r.contains(document.activeElement)"), True))
    else:
        eventually(page, lambda: _assert_eq(page.evaluate(
            "() => document.activeElement?.getAttribute('data-verifier-opener') ?? null"), "1"))


def body_not_focused(page: Page) -> None:
    assert page.evaluate("() => document.activeElement !== document.body && document.activeElement !== null")


def choice_text(loc: Locator) -> str:
    return loc.evaluate("e => (e.selectedOptions && e.selectedOptions.length ? e.selectedOptions[0].textContent"
                        " : e.textContent || e.value || '')")


def pick(page: Page, combo: Locator, typed: str) -> None:
    exact = re.compile(rf"^\s*{re.escape(typed)}\s*$", re.I)
    loose = re.compile(rf"\b{re.escape(typed)}\b", re.I)
    if combo.evaluate("e => e.tagName") == "SELECT":
        labels = combo.evaluate("e => Array.from(e.options).map(o => o.textContent.trim())")
        choices = [label for label in labels if exact.search(label)] or [label for label in labels if loose.search(label)]
        assert choices, f"no option for {typed}: {labels}"
        select(combo, choices[0])
        return
    combo.click()
    if combo.is_editable():
        fill(combo, typed)

    def options() -> Locator:
        exact_options = page.get_by_role("option", name=exact)
        return exact_options if exact_options.count() else page.get_by_role("option", name=loose)

    eventually(page, lambda: expect(options().first).to_be_visible(timeout=QUICK_MS))
    options().first.click()


def progress_value(bar: Locator) -> tuple[float, float]:
    return tuple(bar.evaluate("e => [Number(e.getAttribute('aria-valuenow') ?? e.value),"
                              " Number(e.getAttribute('aria-valuemax') ?? e.max)]"))


def select_rows(page: Page, ids: list[str]) -> None:
    row(page, ids[0]).focus()
    page.keyboard.press("x")
    for _ in ids[1:]:
        page.keyboard.press("Shift+ArrowDown")
    contains(page, toolbar(page), f"{len(ids)} selected")


def walk_to(page: Page, grid: str, tid: str) -> None:
    rows = page.get_by_role("grid", name=grid).get_by_role("row", name=ID_RE)
    visible(page, rows.first)
    rows.first.focus()
    page.keyboard.press("Home")
    for _ in range(rows.count() + 1):
        if row(page, tid, grid).get_attribute("aria-current") == "true":
            return
        page.keyboard.press("j")
    raise AssertionError(f"{tid} never became current by keyboard")


def patch_response(page: Page) -> Any:
    return page.expect_response(lambda r: r.request.method == "PATCH" and "/api/tasks/" in r.url,
                                timeout=UI_DEADLINE_S * 1000)


def choose(page: Page, container: Locator, field: str, choice: str) -> dict:
    with patch_response(page) as info:
        select(container.get_by_role("combobox", name=field), choice)
    return info.value.json()


NOTICES_JS = """el => { window.__notices = []; new MutationObserver(() => {
  const t = el.textContent.trim(); const l = window.__notices;
  if (t && l[l.length - 1] !== t) l.push(t); }).observe(el, {childList: true, subtree: true, characterData: true}); }"""


def count_notices(page: Page) -> None:
    notices(page).evaluate(NOTICES_JS)


def announced(page: Page) -> list[str]:
    return page.evaluate("() => window.__notices")


WATCH_JS = """([rows, removing]) => { window.__rowTimes = {};
  const badgeOf = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes('Freed by')) return n.parentElement;
    return null; };
  const chain = (el, b) => { const out = []; for (let e = b; e; e = e === el ? null : e.parentElement) out.push(e); return out; };
  const anims = (el, b) => chain(el, b).flatMap(e => e.getAnimations());
  const at = (a, now) => (a.startTime ?? now) + a.effect.getComputedTiming().delay;
  const shown = (el, b) => chain(el, b).every(e => { const s = getComputedStyle(e);
    return parseFloat(s.opacity) > 0 && s.visibility !== 'hidden'; });
  for (const [id, el] of rows) {
    const b0 = badgeOf(el); const old = new Set(b0 ? anims(el, b0) : []);
    const check = () => { if (id in window.__rowTimes) return;
      const now = document.timeline.currentTime; const b = badgeOf(el); let t = null;
      if (!removing && b) { const running = anims(el, b);
        if (running.length) t = Math.max(now, ...running.map(a => at(a, now)));
        else if (shown(el, b)) t = now; }
      if (removing && !b) t = now;
      if (removing && b) { const fresh = anims(el, b).filter(a => !old.has(a));
        if (fresh.length) t = Math.min(...fresh.map(a => Math.max(now, at(a, now)))); }
      if (t !== null) window.__rowTimes[id] = [Date.now(), t]; };
    new MutationObserver(check).observe(el, {attributes: true, childList: true, subtree: true, characterData: true}); } }"""
LINE_JS = """([grid, max, region]) => {
  const st = window.__lineProbe = {count: 0, fresh: new Map()};
  const near = el => { const g = grid.getBoundingClientRect(), r = el.getBoundingClientRect();
    return r.left >= g.left - max && r.left <= g.left + g.width * region && r.bottom >= g.top && r.top <= g.bottom; };
  const thin = (el, pseudo) => {
    if (pseudo) { const w = parseFloat(getComputedStyle(el, pseudo).width); return w > 0 && w <= max; }
    if (el instanceof SVGGeometryElement) { const s = getComputedStyle(el); const sw = parseFloat(s.strokeWidth);
      if (s.stroke !== 'none' && sw > 0 && sw <= max) return true; }
    const w = el.getBoundingClientRect().width; return w > 0 && w <= max; };
  const GEOM = /^(height|block-size|max-height|transform|scale|translate|clip-path|stroke-dash(offset|array)|top|bottom|inset|background-size|d)$/;
  const kebab = p => p.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const moving = props => props.some(p => GEOM.test(kebab(p)));
  const keys = a => a ? a.effect.getKeyframes().flatMap(k => Object.keys(k)) : [];
  const note = (el, pseudo, props) => {
    if (el instanceof Element && near(el) && thin(el, pseudo) && moving(props)) st.count += 1; };
  document.addEventListener('transitionrun', ev => note(ev.target, ev.pseudoElement, [ev.propertyName]), true);
  document.addEventListener('animationstart', ev => {
    const a = document.getAnimations().find(x => x.animationName === ev.animationName && x.effect.target === ev.target
      && (x.effect.pseudoElement || '') === (ev.pseudoElement || ''));
    note(ev.target, ev.pseudoElement, keys(a)); }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) { const a = animate.call(this, frames, options);
    note(this, options && typeof options === 'object' ? options.pseudoElement : '', keys(a)); return a; };
  const track = e => { if (!st.fresh.has(e) && near(e) && thin(e, '')) {
    const h = e.getBoundingClientRect().height; st.fresh.set(e, {first: h, top: h, moved: false}); } };
  new MutationObserver(ms => { for (const m of ms) {
    if (m.type === 'attributes' && m.target instanceof Element) track(m.target);
    for (const n of m.addedNodes) if (n instanceof Element) { track(n); for (const e of n.getElementsByTagName('*')) track(e); } } })
    .observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['style']});
  const stroke = CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.stroke = function (...args) {
    if (near(this.canvas)) st.count += 1; return stroke.apply(this, args); }; }"""
LINE_SEEN_JS = """(max) => { const st = window.__lineProbe; let n = st.count;
  for (const [e, rec] of st.fresh) { const h = e.isConnected ? e.getBoundingClientRect().height : rec.first;
    rec.top = Math.max(rec.top, h); rec.moved = rec.moved || Math.abs(h - rec.first) > max;
    if (rec.moved && rec.top > 2 * max) n += 1; }
  return n; }"""
ANIM_JS = "() => document.getAnimations().map(a => a.effect.getComputedTiming().endTime)"
DEAD_INTAKE = "http://127.0.0.1:9"
AXE_RULES = ["color-contrast", "button-name", "link-name", "label", "select-name", "aria-input-field-name",
             "aria-toggle-field-name", "aria-progressbar-name"]
PREFIXES = {"a": "Assign to ", "s": "Move to ", "p": "Set priority: "}
HIDDEN_PX = 2
PAUSED_PROBE_S = 2
KEY_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")
VISIBLE_RIGHT_JS = """e => { let r = e.getBoundingClientRect().right;
  for (let a = e.parentElement; a; a = a.parentElement)
    if (getComputedStyle(a).overflowX !== 'visible') r = Math.min(r, a.getBoundingClientRect().right);
  return r; }"""
RUNNING_JS = ("() => document.getAnimations().filter(a => a.playState === 'running')"
              ".map(a => a.effect.getComputedTiming().endTime)")
MOVING_JS = """() => document.getAnimations().filter(a => a.playState === 'running').filter(a => {
  const props = new Set(a.transitionProperty ? [a.transitionProperty] : []);
  for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k))
    if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) props.add(p);
  return [...props].some(p => !/colou?r$|^background$|^fill$|^stroke$/i.test(p)); })
  .map(a => a.effect.getComputedTiming().endTime)"""
LOOP_JS = "() => document.getAnimations().filter(a => a.effect.getComputedTiming().iterations === Infinity).length"


def watch_rows(page: Page, ids: list[str], removing: bool = False) -> None:
    page.evaluate(WATCH_JS, [[[i, row(page, i).element_handle()] for i in ids], removing])


def watch_line(page: Page) -> None:
    page.evaluate(LINE_JS, [tasks_grid(page).element_handle(), LINE_MAX_PX, LINE_REGION])


def line_seen(page: Page) -> int:
    return page.evaluate(LINE_SEEN_JS, LINE_MAX_PX)


def reach_gap(page: Page, first: str, second: str) -> float:
    times = page.evaluate("() => window.__rowTimes")
    assert first in times and second in times, f"rows never reached: {times}"
    a, b = times[first], times[second]
    return max(b[0] - a[0], b[1] - a[1])


def focus_inside(page: Page, dialog: Locator) -> None:
    eventually(page, lambda: _assert_eq(dialog.evaluate("d => d.contains(document.activeElement)"), True))


def contrast_and_names(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate("""rules => { window.__namesAxe = {done: false, error: null, found: []};
      axe.run(document, {runOnly: {type: "rule", values: rules}}).then(
        r => { window.__namesAxe = {done: true, error: null,
               found: r.violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)}))}; },
        e => { window.__namesAxe = {done: true, error: String(e), found: []}; }); }""", AXE_RULES)
    deadline = time.monotonic() + UI_DEADLINE_S
    while not page.evaluate("() => window.__namesAxe.done"):
        assert time.monotonic() < deadline, "axe did not finish"
        advance(page, FRAME_MS)
    status = page.evaluate("() => window.__namesAxe")
    assert status["error"] is None and not status["found"], status


def assert_trapped(page: Page, dialog: Locator) -> None:
    focus_inside(page, dialog)
    for key in ["Tab"] * TRAP_PRESSES + ["Shift+Tab"] * TRAP_PRESSES:
        page.keyboard.press(key)
        assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"


def box(loc: Locator) -> dict[str, float]:
    settle(loc)
    b = loc.bounding_box()
    assert b, "no layout box"
    return b


def offscreen(page: Page, loc: Locator) -> None:
    if loc.count() == 0 or not loc.first.is_visible():
        return
    b = loc.first.bounding_box()
    assert b is None or b["x"] + b["width"] <= 0 or b["x"] >= page.viewport_size["width"], b


def tap_targets(page: Page, scope: Locator | Page) -> None:
    vp = page.viewport_size
    for role in ("button", "link", "combobox", "row"):
        for el in scope.get_by_role(role).all():
            if not el.is_visible():
                continue
            b = el.bounding_box()
            if not b or b["y"] >= vp["height"] or b["y"] + b["height"] <= 0:
                continue
            if b["width"] <= HIDDEN_PX or b["height"] <= HIDDEN_PX:
                continue
            assert b["height"] >= TAP_MIN_PX - PX_SLACK and b["width"] >= TAP_MIN_PX - PX_SLACK, \
                f"{role} {el.get_attribute('aria-label') or el.text_content()} is {b}"


def one_current(page: Page, grid: str = "Tasks") -> None:
    rows = page.get_by_role("grid", name=grid).get_by_role("row")
    eventually(page, lambda: _assert_eq(rows.evaluate_all(
        "rs => rs.filter(r => r.getAttribute('aria-current') === 'true').length"), 1))


def undo_text(n: int, k: int = 0) -> str:
    text = f"Undo restored {n} task{'' if n == 1 else 's'}."
    return text + (f" {k} task{'' if k == 1 else 's'} blocked again." if k else "")


def link_in_details(page: Page, blocker: str, blocked: str) -> None:
    pane = details(page)
    pane.get_by_role("button", name="Add blocked task").click()
    linker = page.get_by_role("dialog", name="Add blocked task")
    visible(page, linker)
    pick(page, linker.get_by_role("combobox", name="Task"), blocked)
    linker.get_by_role("button", name="Add link").click()
    notice(page, f"{blocker} now blocks {blocked}.")
    contains(page, pane.get_by_role("list", name="Blocks"), blocked)


def palette_run(page: Page, command: str, done: str, key: str | None = None) -> None:
    page.keyboard.press(key or "Control+k")
    palette = page.get_by_role("dialog", name="Command palette")
    visible(page, palette)
    focus_inside(page, palette)
    typed = command[len(PREFIXES[key]):] if key else command
    if key:
        assert command.startswith(PREFIXES[key]), command
    page.keyboard.type(typed)
    visible(page, palette.get_by_role("option", name=command))
    page.keyboard.press("Enter")
    notice(page, done)
    gone(page, palette)


def undo_by_key(page: Page) -> dict:
    with page.expect_response(lambda r: r.url.endswith("/api/undo"), timeout=UI_DEADLINE_S * 1000) as info:
        page.keyboard.press("Control+z")
    return info.value.json()


def run_bulk(page: Page, ids: list[str], command: str, done: str, key: str | None = None,
             digit: str | None = None) -> None:
    select_rows(page, ids)
    if digit:
        page.keyboard.press(digit)
        notice(page, done)
    else:
        palette_run(page, command, done, key)


def bulk_undo(page: Page, base: str, ids: list[str], command: str, done: str, restored: int,
              reblocked: int = 0, key: str | None = None, digit: str | None = None) -> dict:
    before = {i: get_task(base, i) for i in ids}
    run_bulk(page, ids, command, done, key, digit)
    result = undo_by_key(page)
    notice(page, undo_text(restored, reblocked))
    for tid in ids:
        after = get_task(base, tid)
        assert [after[f] for f in ("status", "priority", "owner")] == \
            [before[tid][f] for f in ("status", "priority", "owner")], tid
    return result


def undo_journey(browser: Browser, base: str, dept: str, crew: str, ids: list[str], command: str, done: str,
                 restored: int, reblocked: int = 0, key: str | None = None, digit: str | None = None,
                 cycle: str | None = "previews") -> dict:
    with ui(browser, base, dept=dept, cycle=cycle, row=ids[0]) as page:
        current(page, ids[0])
        work_as(page, crew)
        result = bulk_undo(page, base, ids, command, done, restored, reblocked, key, digit)
        body_not_focused(page)
    return result


def stale_undo_journey(browser: Browser, base: str, dept: str, crew: str, ids: list[str], command: str,
                       done: str, key: str | None = None, digit: str | None = None) -> None:
    with ui(browser, base, dept=dept, cycle="previews", row=ids[0]) as page:
        current(page, ids[0])
        work_as(page, crew)
        run_bulk(page, ids, command, done, key, digit)
        changed = {i: get_task(base, i) for i in ids}
        edit(base, ids[0], who="sasha", details=unique("teammate note")[0])
        page.keyboard.press("Control+z")
        notice(page, "Undo stopped: a task changed after that edit.")
    for tid in ids:
        assert [get_task(base, tid)[f] for f in ("status", "priority", "owner")] == \
            [changed[tid][f] for f in ("status", "priority", "owner")], tid


def phone_targets(page: Page) -> None:
    layout(page)
    tap_targets(page, page)
    page.get_by_role("button", name="Departments").click()
    drawer = page.get_by_role("dialog", name="Departments")
    at_rest(page, drawer)
    tap_targets(page, drawer)
    page.keyboard.press("Escape")
    gone(page, drawer)
    body_not_focused(page)


def countdown(days: int) -> str:
    if days >= 2:
        return f"{days} days to opening"
    if days == 1:
        return "1 day to opening"
    if days == 0:
        return "Opening tonight"
    return "Now running"


def interrupted_upload(base: str, tid: str, name: str, content: bytes) -> None:
    boundary = "verifierboundary"
    payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nplot\r\n'
               f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
               f"Content-Type: application/pdf\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    u = urlparse(base)
    head = (f"POST /api/tasks/{tid}/attachments HTTP/1.1\r\nHost: {u.netloc}\r\n"
            f"Content-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len(payload)}\r\n"
            f"Connection: close\r\n\r\n").encode()
    with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT_S) as s:
        s.sendall(head + payload[: len(payload) // 2])
        s.shutdown(socket.SHUT_RDWR)


def outage_url(outage: str) -> str:
    return os.environ["APP_MINIO_DOWN_URL" if outage == "minio-down" else "APP_POCKETBASE_DOWN_URL"]


@contextmanager
def scratch_app(**env: str) -> Iterator[str]:
    from conftest import DEPLOYED_APP
    serve = json.loads(Path(DEPLOYED_APP, "run.json").read_text())["serve"]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = Path(tempfile.mkstemp(suffix=".log")[1])
    base = f"http://127.0.0.1:{port}"
    with log.open("w") as out:
        proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=out, stderr=subprocess.STDOUT,
                                env={**os.environ, **env, "APP_PUBLIC_PORT": str(port)}, start_new_session=True)
    try:
        deadline = time.monotonic() + BOOT_DEADLINE_S
        while True:
            assert proc.poll() is None, f"scratch copy exited:\n{log.read_text()[-LOG_TAIL:]}"
            try:
                if httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, f"scratch copy never healthy:\n{log.read_text()[-LOG_TAIL:]}"
            try:
                proc.wait(timeout=QUICK_MS / 1000)
            except subprocess.TimeoutExpired:
                pass
        yield base
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


@contextmanager
def fresh_short_app(**env: str) -> Iterator[str]:
    admin = os.environ["DATABASE_URL"]
    name = f"promptside_roll_{uuid.uuid4().hex[:12]}"
    made = subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                          capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)
    assert made.returncode == 0, made.stderr
    url = urlparse(admin)._replace(path=f"/{name}").geturl()
    try:
        with scratch_app(PROMPTSIDE_CYCLE_SECONDS=str(ROLL_CYCLE_S), DATABASE_URL=url, **env) as base:
            yield base
    finally:
        subprocess.run(["psql", admin, "-c", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'],
                       capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)


def rollover_task(base: str) -> tuple[dict, float]:
    task = create(base, status="todo")
    cycle = next(c for c in snapshot(base)["cycles"] if c["key"] == task["cycle"])
    assert cycle["ends_at"] is not None, "a fresh short-mode copy started in Previews"
    return task, (parse_ts(cycle["ends_at"]) - parse_ts(cycle["starts_at"])).total_seconds()


def test_cycle_rollover_moves_open_tasks(app_url: str) -> None:
    with fresh_short_app() as base:
        moving, span = rollover_task(base)
        cur = moving["cycle"]
        staying = create(base, status="todo")
        edit(base, staying["id"], status="done")
        poll(lambda: current_cycle(base)["key"] != cur, span + UI_DEADLINE_S, "the short cycle never ended")
        seen = time.monotonic()
        new_key = current_cycle(base)["key"]
        moved = poll(lambda: get_task(base, moving["id"])["cycle"] == new_key and get_task(base, moving["id"]),
                     ROLLOVER_MAX_S + SKEW_S, "open task not rolled over")
        assert time.monotonic() - seen <= ROLLOVER_MAX_S + SKEW_S
        assert moved["version"] == moving["version"] + 1
        rolled = [e for e in activity(base, moving["id"]) if e["kind"] == "rolled"]
        assert len(rolled) == 1 and rolled[0]["actor"] is None
        assert get_task(base, staying["id"])["cycle"] == staying["cycle"]


def test_wf_cycles_watch_rollover(browser: Browser, app_url: str) -> None:
    with fresh_short_app(POCKETBASE_URL=DEAD_INTAKE) as base:
        task, span = rollover_task(base)
        tid, cur = task["id"], task["cycle"]
        with ui(browser, base, size=PHONE, group="cycle", row=tid) as page:
            eventually(page, lambda: expect(service_alerts(page)).to_have_text([INTAKE_DOWN], timeout=QUICK_MS),
                       BANNER_MAX_S)
            current(page, tid)
            offscreen(page, rail(page))
            mark(page)
            moved = poll(lambda: get_task(base, tid)["cycle"] != cur and get_task(base, tid),
                         span + ROLLOVER_MAX_S + UI_DEADLINE_S, "no rollover")
            name = CYCLES[moved["cycle"]]
            visible(page, tasks_grid(page).get_by_role("rowgroup", name=re.compile(rf"^{name}"))
                    .get_by_role("row", name=row_re(tid)))
            fresh = next(c for c in snapshot(base)["cycles"] if c["key"] == moved["cycle"])
            layout(page)
            tap_targets(page, page)
            page.get_by_role("button", name="Departments").click()
            drawer = page.get_by_role("dialog", name="Departments")
            at_rest(page, drawer)
            contains(page, drawer, f"{fresh['done']} of {fresh['total']} done")
            tap_targets(page, drawer)
            kept(page)


def test_intake_pull_creates_exactly_one_triage_task(app_url: str) -> None:
    filed: dict[str, float] = {}
    details = {}
    for dept in ("sound", "props"):
        details_text = unique("detail")[0]
        title, _ = file_request(app_url, department=dept, details=details_text)
        filed[title] = time.monotonic()
        details[title] = details_text
    seen: dict[str, tuple[float, dict]] = {}
    while len(seen) < len(filed):
        now = time.monotonic()
        tri = {t["title"]: t for t in ok(api_get(app_url, "/api/tasks", status="triage"))["tasks"]}
        for title, at in filed.items():
            if title in tri and title not in seen:
                seen[title] = (now - at, tri[title])
        assert now <= max(filed.values()) + PULL_MAX_S, f"not pulled in time: {set(filed) - set(seen)}"
    first, second = (seen[t][1] for t in filed)
    for title, (elapsed, task) in seen.items():
        assert elapsed <= PULL_MAX_S
        record = pb_requests(title)
        assert len(record) == 1 and record[0]["status"] == "pending"
        assert task["request"] == record[0]["id"]
        assert task["status"] == "triage" and task["cycle"] is None
        assert task["details"] == details[title]
    assert second["number"] > first["number"]
    later, _ = file_request(app_url)
    pulled(app_url, later)
    for title in filed:
        assert len(triage_tasks(app_url, title)) == 1, f"{title} pulled twice"


DECISIONS = ["accept", "decline", "merge"]


@pytest.mark.parametrize("decision", DECISIONS, ids=DECISIONS)
def test_decision_snapshot_is_one_committed_state(app_url: str, decision: str) -> None:
    title, _ = file_request(app_url, department="props")
    tid = pulled(app_url, title)["id"]
    body = {"accept": {"decision": "accept", "department": "props"},
            "decline": {"decision": "decline", "reason": unique("reason")[0]},
            "merge": {"decision": "merge", "duplicate_of": create(app_url)["id"]}}[decision]
    events = Events(app_url)
    try:
        before = snapshot(app_url)
        result = ok(decide(app_url, tid, body))
        after = result["snapshot"]
        sent = events.wait(lambda e: e["event"] == "change" and e["data"].get("change") == result["change"],
                           LIVE_MAX_MS / 1000)
    finally:
        events.close()
    assert sent["data"]["kind"] == "decision"
    assert sent["data"]["snapshot"] == after
    assert after["seq"] == result["change"]
    assert after["triage"] == before["triage"] - 1
    columns = dict(before["columns"])
    cycles = {c["key"]: (c["done"], c["total"]) for c in before["cycles"]}
    current = next(c["key"] for c in before["cycles"] if c["current"])
    if decision == "accept":
        columns["backlog"] += 1
        cycles[current] = (cycles[current][0], cycles[current][1] + 1)
    if decision == "decline":
        columns["cancelled"] += 1
    assert after["columns"] == columns
    assert after["blocked"] == before["blocked"]
    assert {c["key"]: (c["done"], c["total"]) for c in after["cycles"]} == cycles
    listing = ok(api_get(app_url, "/api/tasks"))
    snap = listing["snapshot"]
    for status in ("backlog", "todo", "in_progress", "done", "cancelled"):
        assert snap["columns"][status] == sum(t["status"] == status for t in listing["tasks"])
    assert snap["blocked"] == sum(t["blocked"] for t in listing["tasks"])
    for c in snap["cycles"]:
        mine = [t for t in listing["tasks"] if t["cycle"] == c["key"]]
        assert c["total"] == sum(t["status"] != "cancelled" for t in mine)
        assert c["done"] == sum(t["status"] == "done" for t in mine)
    triage = ok(api_get(app_url, "/api/tasks", status="triage"))
    assert triage["snapshot"]["triage"] == len(triage["tasks"])


def test_decision_written_back_before_it_is_final(app_url: str) -> None:
    title, _ = file_request(app_url, department="sound")
    task = pulled(app_url, title)
    tid = task["id"]
    record = pb_requests(title)[0]
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    err(decide(down, tid, {"decision": "accept", "department": "sound"}), 503, "intake_unavailable")
    unchanged = get_task(app_url, tid)
    assert unchanged["status"] == "triage" and unchanged["version"] == task["version"]
    assert pb_requests(title)[0]["status"] == "pending"
    reason = unique("reason")[0]
    path = f"/api/triage/{tid}/decision"
    accept, decline = together(
        lambda: post_json(app_url, path, {"decision": "accept", "department": "sound", "priority": 2, "owner": "kofi"}),
        lambda: post_json(app_url, path, {"decision": "decline", "reason": reason}))
    assert sorted([accept.status_code, decline.status_code]) == [200, 409]
    winner, loser = (accept, decline) if accept.status_code == 200 else (decline, accept)
    err(loser, 409, "already_decided")
    outcome = "accepted" if winner is accept else "declined"
    assert winner.json()["request"] == {"id": record["id"], "status": outcome, "task": tid}
    stored = pb_requests(title)[0]
    assert stored["status"] == outcome and stored["task"] == tid and stored["decided_at"]
    final = get_task(app_url, tid)
    if outcome == "accepted":
        assert (final["status"], final["owner"], final["priority"]) == ("backlog", "kofi", 2)
        assert final["cycle"] == current_cycle(app_url)["key"]
    else:
        assert stored["decision_note"] == reason
        assert final["status"] == "cancelled" and final["cycle"] is None
    err(decide(app_url, tid, {"decision": "decline", "reason": reason}), 409, "already_decided")


def test_keyboard_grid_moves_selects_and_sets_priority(browser: Browser, app_url: str) -> None:
    ids = [create(app_url, priority=4, status="todo", cycle="previews")["id"] for _ in range(4)]
    with ui(browser, app_url, dept="props", cycle="previews", row=ids[0]) as page:
        current(page, ids[0])
        row(page, ids[0]).focus()
        for key, index in (("j", 1), ("ArrowDown", 2), ("k", 1), ("ArrowUp", 0)):
            page.keyboard.press(key)
            current(page, ids[index])
        rows = tasks_grid(page).get_by_role("row")
        assert rows.evaluate_all("els => els.filter(e => e.getAttribute('aria-current') === 'true').length") == 1
        toolbar(page).get_by_role("button", name="List view").focus()
        page.keyboard.press("j")
        current(page, ids[1])
        page.keyboard.press("x")
        attr(page, row(page, ids[1]), "aria-selected", "true")
        page.keyboard.press("Shift+ArrowDown")
        current(page, ids[2])
        attr(page, row(page, ids[2]), "aria-selected", "true")
        contains(page, toolbar(page), "2 selected")
        page.keyboard.press("3")
        poll(lambda: all(get_task(app_url, i)["priority"] == 3 for i in ids[1:3]), UI_DEADLINE_S, "priority 3 not saved")
        assert [get_task(app_url, i)["priority"] for i in (ids[0], ids[3])] == [4, 4]
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(row(page, ids[1])).not_to_have_attribute("aria-selected", "true",
                                                                               timeout=QUICK_MS))
        page.keyboard.press("1")
        poll(lambda: get_task(app_url, ids[2])["priority"] == 1, UI_DEADLINE_S, "current row priority not saved")
        assert get_task(app_url, ids[1])["priority"] == 3


def test_command_palette_filters_runs_and_closes(browser: Browser, app_url: str) -> None:
    tid = create(app_url, status="todo", cycle="previews")["id"]
    with ui(browser, app_url, dept="props", cycle="previews", row=tid, task=tid) as page:
        pane = details(page)
        visible(page, pane)
        title_box = pane.get_by_role("textbox", name="Title")
        title_box.focus()
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        visible(page, palette)
        focus_inside(page, palette)
        page.keyboard.type("assign to oren")
        options = palette.get_by_role("listbox", name="Commands").get_by_role("option")
        eventually(page, lambda: expect(options).to_have_text(["Assign to Oren Vale"], timeout=QUICK_MS))
        page.keyboard.press("Enter")
        poll(lambda: get_task(app_url, tid)["owner"] == "oren", UI_DEADLINE_S, "palette command not run")
        notice(page, f"{tid} assigned to Oren Vale.")
        gone(page, palette)
        title_box.focus()
        page.keyboard.press("Control+k")
        visible(page, palette)
        page.keyboard.press("Escape")
        gone(page, palette)
        eventually(page, lambda: expect(title_box).to_be_focused(timeout=QUICK_MS))
        row(page, tid).focus()
        page.keyboard.press("s")
        visible(page, palette)
        names = palette.get_by_role("listbox", name="Commands").get_by_role("option")
        eventually(page, lambda: expect(names).to_have_count(5, timeout=QUICK_MS))
        assert all(n.startswith("Move to ") for n in names.all_text_contents())
        page.keyboard.press("Escape")
        gone(page, palette)


def test_focus_trapped_in_dialogs_and_returned(browser: Browser, app_url: str) -> None:
    tid = create(app_url, status="todo", cycle="previews")["id"]
    with ui(browser, app_url, dept="props", cycle="previews", row=tid) as page:
        ready(page)
        for opener_name, dialog_name in (("New task", "New task"), ("Commands", "Command palette")):
            opener = toolbar(page).get_by_role("button", name=opener_name, exact=True)
            opener.focus()
            page.keyboard.press("Space")
            dialog = page.get_by_role("dialog", name=dialog_name)
            visible(page, dialog)
            assert_trapped(page, dialog)
            page.keyboard.press("Escape")
            gone(page, dialog)
            eventually(page, lambda o=opener: expect(o).to_be_focused(timeout=QUICK_MS))
            body_not_focused(page)
        row(page, tid).focus()
        page.keyboard.press("Enter")
        visible(page, details(page))
        eventually(page, lambda: expect(details(page).get_by_role("heading", level=2)).to_be_focused(timeout=QUICK_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(row(page, tid)).to_be_focused(timeout=QUICK_MS))
        body_not_focused(page)
    with ui(browser, app_url, size=PHONE, dept="props", cycle="previews", row=tid) as page:
        ready(page)
        tap(row(page, tid))
        visible(page, sheet(page))
        assert_trapped(page, sheet(page))
        page.keyboard.press("Escape")
        gone(page, sheet(page))
        eventually(page, lambda: expect(row(page, tid)).to_be_focused(timeout=QUICK_MS))
        body_not_focused(page)


def test_bulk_change_is_all_or_nothing(app_url: str) -> None:
    a, b, c = (create(app_url, status="todo")["id"] for _ in range(3))
    result = ok(bulk(app_url, [a, b, c], {"owner": "kofi"}))
    assert {t["id"]: (t["owner"], t["version"]) for t in result["tasks"]} == {a: ("kofi", 2), b: ("kofi", 2), c: ("kofi", 2)}
    for tid in (a, b, c):
        assert activity(app_url, tid)[-1]["change"] == result["change"]
    stale = [{"id": a, "version": 2}, {"id": b, "version": 2}, {"id": c, "version": 2}]
    edit(app_url, c, priority=1)
    error = err(post_json(app_url, "/api/tasks/bulk", {"tasks": stale, "set": {"owner": "ines"}}), 412, "version_conflict")
    assert [t["id"] for t in error["current"]] == [c] and error["current"][0]["version"] == 3
    assert "tasks" not in error and "blocked_by" not in error
    blocker = create(app_url, status="todo")["id"]
    dependent = create(app_url, status="todo")["id"]
    ok(link(app_url, blocker, dependent), 201)
    error = err(bulk(app_url, [a, dependent], {"status": "done"}), 409, "blocked_by_open")
    assert error["tasks"] == [dependent] and error["blocked_by"] == [blocker]
    done = create(app_url)["id"]
    edit(app_url, done, status="done")
    error = err(bulk(app_url, [a, done], {"status": "backlog"}), 409, "illegal_transition")
    assert error["tasks"] == [done]
    error = err(post_json(app_url, "/api/tasks/bulk", {"tasks": [{"id": a, "version": 2}, {"id": UNKNOWN_ID, "version": 1}],
                                                       "set": {"priority": 1}}), 404, "not_found")
    assert error["tasks"] == [UNKNOWN_ID]
    error = err(post_json(app_url, "/api/tasks/bulk", {"tasks": [{"id": a, "version": 2}] * (BULK_MAX + 1),
                                                       "set": {"priority": 1}}), 422, "validation_failed")
    assert error["fields"]["tasks"] == "Choose 1 to 100 tasks."
    error = err(post_json(app_url, "/api/tasks/bulk", {"tasks": [{"id": a, "version": 2}], "set": {}}), 422, "validation_failed")
    assert error["fields"]["set"] == "Choose a change to make."
    after = {t: get_task(app_url, t) for t in (a, b, dependent, done)}
    assert [(after[a]["owner"], after[a]["status"], after[a]["version"]), (after[b]["owner"], after[b]["version"])] == \
        [("kofi", "todo", 2), ("kofi", 2)]
    assert after[dependent]["status"] == "todo" and after[done]["status"] == "done"


def test_blocked_is_derived_from_open_blockers(app_url: str) -> None:
    blocker = create(app_url, status="todo")["id"]
    task = create(app_url, status="todo")["id"]
    ok(link(app_url, blocker, task), 201)
    assert get_task(app_url, task)["blocked"] is True
    error = err(patch(app_url, task, {"status": "done"}), 409, "blocked_by_open")
    assert error["blocked_by"] == [blocker] and "tasks" not in error
    assert get_task(app_url, task)["status"] == "todo"
    edit(app_url, blocker, status="done")
    freed = get_task(app_url, task)
    assert freed["blocked"] is False and freed["blocked_by"] == [blocker]
    reopened = edit(app_url, blocker, status="todo")
    assert [r["id"] for r in reopened["reblocked"]] == [task]
    assert get_task(app_url, task)["blocked"] is True
    edit(app_url, task, status="cancelled")
    assert get_task(app_url, task)["blocked"] is False
    pair_blocker = create(app_url, status="todo")["id"]
    pair_task = create(app_url, status="todo")["id"]
    ok(link(app_url, pair_blocker, pair_task), 201)
    ok(bulk(app_url, [pair_blocker, pair_task], {"status": "done"}))
    assert get_task(app_url, pair_task)["status"] == "done"


def test_cascade_reports_depth_order_and_freeing_task(app_url: str) -> None:
    parent = create(app_url, status="todo")["id"]
    done_sub = create(app_url, status="todo", parent=parent)["id"]
    open_sub = create(app_url, status="todo", parent=parent)["id"]
    other = create(app_url, status="todo")["id"]
    x = create(app_url, status="todo")["id"]
    y = create(app_url, status="todo")["id"]
    z = create(app_url, status="todo")["id"]
    for blocker, blocked in ((open_sub, x), (parent, y), (other, z), (open_sub, z)):
        ok(link(app_url, blocker, blocked), 201)
    edit(app_url, done_sub, status="done")
    before = {t: get_task(app_url, t)["version"] for t in (x, y, z)}
    result = ok(bulk(app_url, [open_sub, other], {"status": "done"}))
    assert result["cascade"] == [
        {"id": x, "depth": 1, "order": 1, "freed_by": open_sub},
        {"id": z, "depth": 1, "order": 2, "freed_by": other},
        {"id": y, "depth": 2, "order": 3, "freed_by": parent},
    ]
    assert {t["id"] for t in result["tasks"]} == {open_sub, other, parent}
    for tid, version in before.items():
        task = get_task(app_url, tid)
        assert task["version"] == version and task["blocked"] is False
        assert all(e["change"] != result["change"] for e in activity(app_url, tid))


def test_cue_line_cascade_finishes_in_time(browser: Browser, app_url: str) -> None:
    parent, sub, direct, rolled = cascade_tasks(app_url)
    with ui(browser, app_url, dept="props", cycle="previews", row=sub, task=sub) as page:
        visible(page, details(page))
        visible(page, row(page, rolled))
        watch_rows(page, [direct, rolled])
        watch_line(page)
        result = choose(page, details(page), "Status", "Done")
        replied = page.evaluate("() => Date.now()")
        line = 0
        for _ in range(CASCADE_MAX_MS // FRAME_MS):
            advance(page, FRAME_MS)
            line = max(line, line_seen(page))
            ends = page.evaluate(ANIM_JS)
            assert all(e <= CASCADE_MAX_MS for e in ends), ends
        assert line > 0, "no cue-line drew along the margin rule"
        for c in result["cascade"]:
            r = row(page, c["id"])
            expect(r).to_have_attribute("data-freed-order", str(c["order"]), timeout=QUICK_MS)
            expect(r).to_have_attribute("data-freed-depth", str(c["depth"]), timeout=QUICK_MS)
            expect(r).to_contain_text(f"Freed by {c['freed_by']}", timeout=QUICK_MS)
            expect(r).not_to_contain_text("Blocked", timeout=QUICK_MS)
        assert [c["id"] for c in result["cascade"]] == [direct, rolled]
        expect(row(page, parent)).to_contain_text("Done", timeout=QUICK_MS)
        expect(blocked_link(page, result["snapshot"]["blocked"])).to_be_visible(timeout=QUICK_MS)
        assert reach_gap(page, direct, rolled) >= DEPTH_GAP_MIN_MS, "depth 2 was not reached after depth 1"
        assert page.evaluate("() => window.__rowTimes")[rolled][0] - replied <= CASCADE_MAX_MS


def test_cascade_under_reduced_motion_swaps_in_one_frame(browser: Browser, app_url: str) -> None:
    parent, sub, direct, rolled = cascade_tasks(app_url)
    with ui(browser, app_url, reduced=True, dept="props", cycle="previews", row=sub, task=sub) as page:
        visible(page, details(page))
        visible(page, row(page, rolled))
        watch_rows(page, [direct, rolled])
        watch_line(page)
        result = choose(page, details(page), "Status", "Done")
        advance(page, FRAME_MS)
        for c in result["cascade"]:
            r = row(page, c["id"])
            expect(r).to_have_attribute("data-freed-order", str(c["order"]), timeout=QUICK_MS)
            expect(r).to_have_attribute("data-freed-depth", str(c["depth"]), timeout=QUICK_MS)
            expect(r).to_contain_text(f"Freed by {c['freed_by']}", timeout=QUICK_MS)
        ends = tasks_grid(page).evaluate(
            "g => g.getAnimations({subtree: true}).map(a => a.effect.getComputedTiming().endTime)")
        assert all(e <= FRAME_MS for e in ends), ends
        assert -FRAME_MS <= reach_gap(page, direct, rolled) <= FRAME_MS, "freed rows were staggered"
        line = line_seen(page)
        for _ in range(CASCADE_MAX_MS // FRAME_MS):
            advance(page, FRAME_MS)
            line = max(line, line_seen(page))
        assert line == 0, "a cue-line drew under reduced motion"


def test_exact_undo_restores_and_reblocks(app_url: str) -> None:
    actor = "sasha"
    task = create(app_url, "lighting", actor, label="focus", priority=3, owner="ines", status="todo",
                  details=unique("details")[0])
    dependent = create(app_url, "lighting", actor, status="todo")["id"]
    ok(link(app_url, task["id"], dependent), 201)
    original = get_task(app_url, task["id"])
    changed = edit(app_url, task["id"], actor, title=unique("renamed")[0], details=unique("other")[0],
                   status="done", priority=1, owner="kofi", label="programming", cycle="previews")
    assert [c["id"] for c in changed["cascade"]] == [dependent]
    left_at = next(t for t in changed["tasks"] if t["id"] == task["id"])["version"]
    dependent_version = get_task(app_url, dependent)["version"]
    result = ok(undo(app_url, actor))
    assert result["undoable"] is False
    assert result["reblocked"] == [{"id": dependent, "order": 1}]
    restored = get_task(app_url, task["id"])
    for field in ("status", "priority", "owner", "title", "details", "label", "cycle"):
        assert restored[field] == original[field], field
    assert restored["version"] == left_at + 1
    blocked = get_task(app_url, dependent)
    assert blocked["blocked"] is True and blocked["version"] == dependent_version
    entry = activity(app_url, task["id"])[-1]
    assert entry["kind"] == "undo" and entry["change"] == result["change"]
    parent = create(app_url, who=actor, status="todo")["id"]
    first = create(app_url, who=actor, status="todo", parent=parent)["id"]
    last = create(app_url, who=actor, status="todo", parent=parent)["id"]
    edit(app_url, first, actor, status="done")
    edit(app_url, last, actor, status="done")
    assert get_task(app_url, parent)["status"] == "done"
    rolled_back = ok(undo(app_url, actor))
    assert {t["id"] for t in rolled_back["tasks"]} == {last, parent}
    assert (get_task(app_url, last)["status"], get_task(app_url, parent)["status"]) == ("todo", "todo")
    edit(app_url, task["id"], actor, priority=2)
    edit(app_url, task["id"], "maya", owner="oren")
    err(undo(app_url, actor), 409, "undo_stale")
    stale = get_task(app_url, task["id"])
    assert (stale["priority"], stale["owner"]) == (2, "oren")
    err(undo(os.environ["APP_SHORT_CYCLES_URL"], "leon"), 409, "nothing_to_undo")


def test_reverse_cascade_on_undo(browser: Browser, app_url: str) -> None:
    parent, sub, direct, rolled = cascade_tasks(app_url)
    with ui(browser, app_url, dept="props", cycle="previews", row=sub, task=sub) as page:
        visible(page, details(page))
        work_as(page, "Maya Okonjo")
        visible(page, row(page, rolled))
        choose(page, details(page), "Status", "Done")
        advance(page, CASCADE_MAX_MS)
        attr(page, row(page, rolled), "data-freed-order", "2")
        watch_rows(page, [direct, rolled], removing=True)
        watch_line(page)
        with page.expect_response(lambda r: r.url.endswith("/api/undo"), timeout=UI_DEADLINE_S * 1000) as info:
            toolbar(page).get_by_role("button", name="Undo", exact=True).click()
        result = info.value.json()
        assert result["reblocked"] == [{"id": rolled, "order": 1}, {"id": direct, "order": 2}]
        line = 0
        for _ in range(CASCADE_MAX_MS // FRAME_MS):
            advance(page, FRAME_MS)
            line = max(line, line_seen(page))
            assert all(e <= CASCADE_MAX_MS for e in page.evaluate(ANIM_JS))
        assert line > 0, "no cue-line drew back towards the restored row"
        for tid in (direct, rolled):
            r = row(page, tid)
            expect(r).not_to_have_attribute("data-freed-order", re.compile(".*"), timeout=QUICK_MS)
            expect(r).not_to_have_attribute("data-freed-depth", re.compile(".*"), timeout=QUICK_MS)
            expect(r).not_to_contain_text("Freed by", timeout=QUICK_MS)
            expect(r).to_contain_text("Blocked", timeout=QUICK_MS)
        expect(blocked_link(page, result["snapshot"]["blocked"])).to_be_visible(timeout=QUICK_MS)
        assert reach_gap(page, rolled, direct) > 0, "rows not reached in the undo's reblocked order"
    assert get_task(app_url, direct)["blocked"] and get_task(app_url, rolled)["blocked"]


def test_bulk_priority_announced_once_after_confirmation(browser: Browser, app_url: str) -> None:
    ids = [create(app_url, "lighting", label="focus", priority=4, status="todo", cycle="previews")["id"]
           for _ in range(FOCUS_ROWS)]
    with ui(browser, app_url, dept="lighting", cycle="previews", row=ids[0]) as page:
        current(page, ids[0])
        select_rows(page, ids)
        count_notices(page)
        with entered(held(page, "**/api/tasks/bulk")) as gate:
            page.keyboard.press("2")
            attr(page, row(page, ids[0]), "aria-busy", "true")
            attr(page, row(page, ids[-1]), "aria-busy", "true")
            contains(page, toolbar(page), "Saving")
            assert announced(page) == []
            gate.release()
            notice(page, f"Priority set to High on {FOCUS_ROWS} tasks.")
        assert announced(page) == [f"Priority set to High on {FOCUS_ROWS} tasks."]
    assert all(get_task(app_url, i)["priority"] == 2 for i in ids)


def test_simultaneous_edits_exactly_one_wins(app_url: str) -> None:
    tid = create(app_url, status="todo")["id"]
    handles = ["devi", "sasha", "ines", "kofi", "ruth", "oren"]
    responses = together(*[lambda who=who: patch(app_url, tid, {"owner": who}, version=1) for who in handles])
    winners = [r for r in responses if r.status_code == 200]
    assert len(winners) == 1
    saved = get_task(app_url, tid)
    assert saved["version"] == 2
    for r in responses:
        if r.status_code != 200:
            error = err(r, 412, "version_conflict")
            assert error["current"]["id"] == tid and error["current"]["version"] == 2
            assert error["current"]["owner"] == saved["owner"]
    quoted = httpx.patch(f"{app_url}/api/tasks/{tid}", json={"priority": 1},
                         headers={"If-Match": '"2"'}, timeout=HTTP_TIMEOUT_S)
    bumped = ok(quoted)["tasks"][0]["version"]
    assert bumped == 3
    fetched = api_get(app_url, f"/api/tasks/{tid}")
    assert fetched.headers["etag"] == f'"{bumped}"'
    err(httpx.patch(f"{app_url}/api/tasks/{tid}", json={"priority": 2}, timeout=HTTP_TIMEOUT_S),
        428, "precondition_required")
    ok(patch(app_url, tid, {"priority": 1}, version=3))
    assert get_task(app_url, tid)["version"] == 3 and get_task(app_url, tid)["priority"] == 1


def test_rejected_edit_rolls_back_on_screen(browser: Browser, app_url: str) -> None:
    tid = create(app_url, status="todo", cycle="previews")["id"]
    with ui(browser, app_url, dept="props", cycle="previews", row=tid, task=tid) as page:
        pane = details(page)
        visible(page, pane)
        with entered(held(page, f"**/api/tasks/{tid}")) as gate:
            select(pane.get_by_role("combobox", name="Owner"), "Ines Hart")
            advance(page, STEP_MS)
            edit(app_url, tid, who="oren", owner="oren")
            gate.release()
        notice(page, f"{tid} was changed by someone else. Showing the saved version.")
        contains(page, row(page, tid), "Oren Vale")
        lacks(page, row(page, tid), "Ines Hart")
        assert "Oren Vale" in choice_text(pane.get_by_role("combobox", name="Owner"))
    assert get_task(app_url, tid)["owner"] == "oren"
    blocker = create(app_url, status="todo", cycle="previews")["id"]
    blocked = create(app_url, status="todo", cycle="previews")["id"]
    ok(link(app_url, blocker, blocked), 201)
    with ui(browser, app_url, dept="props", cycle="previews", row=blocked, task=blocked) as page:
        visible(page, details(page))
        status = details(page).get_by_role("combobox", name="Status")
        done = status.get_by_role("option", name="Done")
        if done.count() and done.first.is_enabled():
            try:
                choose(page, details(page), "Status", "Done")
            except (AssertionError, PlaywrightTimeout):
                pass
            else:
                notice(page, f"{blocked} is still blocked by {blocker}.")
        contains(page, row(page, blocked), "Blocked")
        contains(page, row(page, blocked), "Todo")
    assert get_task(app_url, blocked)["status"] == "todo"


def test_live_updates_reach_every_tab(browser: Browser, app_url: str) -> None:
    blocker = create(app_url, status="todo", cycle="previews")["id"]
    tid = create(app_url, status="todo", cycle="previews")["id"]
    with ui(browser, app_url, dept="props", cycle="previews", row=tid) as a, \
            ui(browser, app_url, dept="props", cycle="previews", row=tid) as b:
        for page in (a, b):
            current(page, tid)
            mark(page)
        edit(app_url, tid, who="ruth", owner="ruth")
        until = time.monotonic() + LIVE_MAX_MS / 1000
        for page in (a, b):
            live(page, lambda page=page: expect(row(page, tid)).to_contain_text("Ruth Alder", timeout=FRAME_MS), until)
        result = ok(link(app_url, blocker, tid), 201)
        until = time.monotonic() + LIVE_MAX_MS / 1000
        for page in (a, b):
            live(page, lambda page=page: expect(row(page, tid)).to_contain_text("Blocked", timeout=FRAME_MS), until)
            live(page, lambda page=page: expect(blocked_link(page, result["snapshot"]["blocked"])).to_be_visible(
                timeout=FRAME_MS), until)
            kept(page)


def test_subtask_rollup_closes_and_reopens_parent(app_url: str) -> None:
    parent = create(app_url, status="todo")["id"]
    s1, s2, s3 = (create(app_url, status="todo", parent=parent)["id"] for _ in range(3))
    edit(app_url, s1, status="done")
    assert get_task(app_url, parent)["status"] == "todo"
    edit(app_url, s3, status="cancelled")
    assert get_task(app_url, parent)["subtasks"] == {"done": 1, "total": 2}
    closed = edit(app_url, s2, status="done")
    closed_parent = next(t for t in closed["tasks"] if t["id"] == parent)
    assert closed_parent["status"] == "done"
    entry = activity(app_url, parent)[-1]
    assert entry["kind"] == "auto_closed" and entry["change"] == closed["change"]
    assert entry["actor"] is None or entry["actor"]["handle"] == "maya", entry["actor"]
    reopened = edit(app_url, s2, status="todo")
    assert next(t for t in reopened["tasks"] if t["id"] == parent)["status"] == "in_progress"
    assert activity(app_url, parent)[-1]["kind"] == "auto_reopened"
    edit(app_url, s2, status="done")
    edit(app_url, parent, status="todo")
    edit(app_url, parent, priority=1)
    assert get_task(app_url, parent)["status"] == "todo"
    edit(app_url, parent, status="done")
    create(app_url, status="todo", parent=parent)
    assert get_task(app_url, parent)["status"] == "in_progress"
    lone_parent = create(app_url, status="todo")["id"]
    lone = create(app_url, status="todo", parent=lone_parent)["id"]
    edit(app_url, lone, status="cancelled")
    assert get_task(app_url, lone_parent)["status"] == "todo"


def test_parent_guards(app_url: str) -> None:
    parent = create(app_url, status="todo")["id"]
    sub = create(app_url, status="todo", parent=parent)["id"]
    err(patch(app_url, parent, {"status": "done"}), 409, "open_subtasks")
    assert get_task(app_url, parent)["status"] == "todo"
    other = create(app_url, status="todo")["id"]
    err(link(app_url, other, parent), 409, "blocks_parent")
    assert get_task(app_url, parent)["blocked_by"] == []
    blocked = create(app_url, status="todo")["id"]
    ok(link(app_url, other, blocked), 201)
    title = unique("sub")[0]
    err(post_json(app_url, "/api/tasks", {"title": title, "department": "props", "parent": blocked}), 409, "blocks_parent")
    error = err(post_json(app_url, "/api/tasks", {"title": title, "department": "props", "parent": sub}),
                422, "validation_failed")
    assert error["fields"]["parent"] == "Choose an existing task that is not a sub-task."
    assert not [t for t in ok(api_get(app_url, "/api/tasks", dept="props"))["tasks"] if t["title"] == title]


def test_attachment_exists_only_after_storage_confirms(app_url: str) -> None:
    tid = create(app_url, "lighting", label="focus")["id"]
    name = "revised plot (v2).pdf"
    content = PDF + unique("plot")[0].encode() + b"0" * 200_000
    interrupted_upload(app_url, tid, name, content)
    att = ok(upload(app_url, tid, name, content, "application/pdf", "plot"), 201)["attachment"]
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", att["id"])
    assert (att["file_name"], att["kind"], att["size"], att["content_type"], att["current"]) == \
        (name, "plot", len(content), "application/pdf", True)
    assert [a["id"] for a in attachments(app_url, tid)] == [att["id"]]
    key = f"tasks/{tid}/{att['id']}/revised_plot__v2_.pdf"
    store = S3()
    assert store.keys(f"tasks/{tid}/") == [key]
    assert store.get(key) == content
    newer = ok(upload(app_url, tid, "plot-b.pdf", PDF + b"b", "application/pdf", "plot"), 201)["attachment"]
    sketch = ok(upload(app_url, tid, "sketch.png", PNG + b"s", "image/png", "sketch"), 201)["attachment"]
    listing = attachments(app_url, tid)
    assert [(a["id"], a["current"]) for a in listing] == [(sketch["id"], True), (newer["id"], True), (att["id"], False)]


UPLOADS = {
    "pdf-plot": ("plot.pdf", "application/pdf", "plot", 201, None),
    "png-sketch": ("sketch.png", "image/png", "sketch", 201, None),
    "jpeg-rendering": ("render.jpg", "image/jpeg", "rendering", 201, None),
    "gif-refused": ("anim.gif", "image/gif", "plot", 422, "file"),
    "png-type-wrong-bytes": ("fake.png", "image/png", "sketch", 422, "file"),
    "unknown-kind": ("plot.pdf", "application/pdf", "costume", 422, "kind"),
    "at-limit": ("big.pdf", "application/pdf", "plot", 201, None),
    "over-limit": ("huge.pdf", "application/pdf", "plot", 413, None),
}
UPLOAD_MESSAGES = {"file": "Attach a PDF, PNG or JPEG file.", "kind": "Choose sketch, plot or rendering."}
HEADS = {"application/pdf": PDF, "image/png": PNG, "image/jpeg": JPEG, "image/gif": GIF}


UPLOAD_IDS = ["pdf-plot", "png-sketch", "jpeg-rendering", "gif-refused", "png-type-wrong-bytes", "unknown-kind",
              "at-limit", "over-limit"]


@pytest.mark.parametrize("case", UPLOAD_IDS, ids=UPLOAD_IDS)
def test_upload_types_and_size_limit(app_url: str, case: str) -> None:
    name, ctype, kind, status, field = UPLOADS[case]
    if case == "png-type-wrong-bytes":
        content = b"plain text, not an image"
    elif case == "at-limit":
        content = PDF + b"0" * (UPLOAD_LIMIT - len(PDF))
    elif case == "over-limit":
        content = PDF + b"0" * (UPLOAD_LIMIT + 1 - len(PDF))
    else:
        content = HEADS[ctype] + unique("blob")[0].encode()
    tid = create(app_url)["id"]
    r = upload(app_url, tid, name, content, ctype, kind)
    if status == 201:
        att = ok(r, 201)["attachment"]
        assert att["size"] == len(content) and att["kind"] == kind
        assert S3().get(f"tasks/{tid}/{att['id']}/{name}") == content
        return
    if status == 413:
        err(r, 413, "payload_too_large")
    else:
        assert err(r, 422, "validation_failed")["fields"][field] == UPLOAD_MESSAGES[field]
    assert attachments(app_url, tid) == []
    assert S3().keys(f"tasks/{tid}/") == []


def test_download_redirects_to_expiring_signed_link(app_url: str) -> None:
    tid = create(app_url)["id"]
    content = PNG + unique("blob")[0].encode()
    att = ok(upload(app_url, tid, "sketch.png", content, "image/png", "sketch"), 201)["attachment"]
    r = httpx.get(f"{app_url}/api/attachments/{att['id']}/download", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 302
    location = r.headers["location"]
    issued = time.monotonic()
    assert not same_origin(location, app_url)
    first = httpx.get(location, timeout=HTTP_TIMEOUT_S)
    assert first.status_code == 200 and first.content == content
    last_ok = issued
    while True:
        probe = httpx.get(location, timeout=HTTP_TIMEOUT_S)
        now = time.monotonic()
        if probe.status_code != 200:
            break
        last_ok = now
        assert now - issued <= LINK_TTL_S + SKEW_S, "signed link outlived its 60 s"
    assert last_ok - issued >= LINK_TTL_S - SKEW_S, "signed link expired early"
    err(httpx.get(f"{app_url}/api/attachments/{UNKNOWN_UUID}/download", timeout=HTTP_TIMEOUT_S), 404, "not_found")


def test_upload_shows_uploading_then_announces(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "lighting", label="focus", status="todo", cycle="previews")["id"]
    name = f"{unique('plot')[0]}.pdf"
    with ui(browser, app_url, dept="lighting", cycle="previews", row=tid, task=tid) as page:
        pane = details(page)
        visible(page, pane)
        contains(page, pane, "No attachments yet.")
        pick(page, pane.get_by_role("combobox", name="Attachment kind"), "plot")
        count_notices(page)
        with entered(held(page, f"**/api/tasks/{tid}/attachments")) as gate:
            pane.get_by_label("Attach file").set_input_files(
                {"name": name, "mimeType": "application/pdf", "buffer": PDF + name.encode()})
            contains(page, pane, f"Uploading {name}")
            visible(page, pane.get_by_role("progressbar", name="Upload progress"))
            expect(pane.get_by_role("link", name=name)).to_have_count(0)
            assert announced(page) == []
            gate.release()
            notice(page, f"{name} attached to {tid}.")
        visible(page, pane.get_by_role("list", name="Attachments").get_by_role("link", name=name))
        eventually(page, lambda: expect(pane.get_by_role("progressbar", name="Upload progress")).to_have_count(
            0, timeout=QUICK_MS))
        assert announced(page) == [f"{name} attached to {tid}."]
    assert [a["file_name"] for a in attachments(app_url, tid)] == [name]


def test_view_state_lives_in_the_address(browser: Browser, app_url: str) -> None:
    blocker = create(app_url, "wardrobe", cycle="previews")["id"]
    first = create(app_url, status="todo", priority=4, cycle="previews")["id"]
    second = create(app_url, status="todo", priority=4, cycle="previews")["id"]
    for tid in (first, second):
        ok(link(app_url, blocker, tid), 201)
    params = {"dept": "props", "blocked": "1", "group": "cycle", "row": first}
    previews = re.compile(r"^Previews")
    no_owner = re.compile(r"^No owner")
    with ui(browser, app_url, **params) as page:
        current(page, first)
        expect(toolbar(page).get_by_role("checkbox", name="Blocked only")).to_be_checked()
        visible(page, tasks_grid(page).get_by_role("rowgroup", name=previews).get_by_role("row", name=row_re(first)))
        assert query(page) == params
        length = history_length(page)
        select(toolbar(page).get_by_role("combobox", name="Group by"), "Owner")
        eventually(page, lambda: _expect_query(page, "group", "owner"))
        assert history_length(page) == length + 1
        visible(page, tasks_grid(page).get_by_role("rowgroup", name=no_owner).get_by_role("row", name=row_re(first)))
        row(page, first).focus()
        page.keyboard.press("j")
        current(page, second)
        eventually(page, lambda: _expect_query(page, "row", second))
        assert history_length(page) == length + 1
        page.keyboard.press("x")
        assert set(query(page)) <= VIEW_PARAMS
        page.go_back()
        eventually(page, lambda: _expect_query(page, "group", "cycle"))
        visible(page, tasks_grid(page).get_by_role("rowgroup", name=previews))
        page.go_forward()
        eventually(page, lambda: _expect_query(page, "group", "owner"))
        page.reload()
        current(page, second)
        assert query(page)["group"] == "owner"
        row(page, second).focus()
        page.keyboard.press("Enter")
        visible(page, details(page))
        eventually(page, lambda: _expect_query(page, "task", second))
        page.go_back()
        eventually(page, lambda: _expect_query(page, "task", None))
        gone(page, details(page))
    with ui(browser, app_url, dept="props", blocked="1", group="owner", row=second) as other:
        current(other, second)
        expect(toolbar(other).get_by_role("checkbox", name="Blocked only")).to_be_checked()
        visible(other, tasks_grid(other).get_by_role("rowgroup", name=no_owner).get_by_role("row", name=row_re(second)))
    with ui(browser, app_url, dept="props", group="sideways", row=UNKNOWN_ID) as junk:
        ready(junk)
        eventually(junk, lambda: _expect_query(junk, "group", None))
        assert query(junk).get("row") != UNKNOWN_ID and query(junk).get("dept") == "props"
        if "row" in query(junk):
            current(junk, query(junk)["row"])


def _expect_query(page: Page, key: str, value: str | None) -> None:
    assert query(page).get(key) == value, page.url


def test_filing_a_request_waits_for_the_intake(browser: Browser, app_url: str) -> None:
    title, rec = file_request(app_url, department="sound", details=unique("d")[0])
    stored = pb_requests(title)
    assert len(stored) == 1 and stored[0]["id"] == rec["id"]
    assert (stored[0]["status"], stored[0]["requester"], stored[0]["task"]) == ("pending", "Leon Park", "")
    assert rec["status"] == "pending"
    long_title = "r" * (TITLE_MAX + 1)
    for body, field, message in (({"title": "", "requester": "Hana Ito"}, "title", "Say what you need."),
                                 ({"title": long_title, "requester": "Hana Ito"}, "title", "Keep it to 140 characters."),
                                 ({"title": unique("r")[0], "requester": ""}, "requester", "Add your name.")):
        error = err(post_json(app_url, "/api/requests", body), 422, "validation_failed")
        assert error["fields"][field] == message
    assert pb_requests(long_title) == []
    down_title = unique("request")[0]
    err(post_json(os.environ["APP_POCKETBASE_DOWN_URL"], "/api/requests",
                  {"title": down_title, "requester": "Hana Ito"}), 503, "intake_unavailable")
    assert pb_requests(down_title) == []
    ui_title = unique("request")[0]
    with ui(browser, app_url, path="/requests") as page:
        visible(page, page.get_by_role("table", name="Requests"))
        page.get_by_role("button", name="File a request").click()
        dialog = page.get_by_role("dialog", name="File a request")
        visible(page, dialog)
        fill(dialog.get_by_role("textbox", name="Request"), ui_title)
        fill(dialog.get_by_role("textbox", name="Your name"), "Hana Ito")
        count_notices(page)
        with entered(held(page, "**/api/requests")) as gate:
            dialog.get_by_role("button", name="File request").click()
            filing = dialog.get_by_role("button", name="Filing")
            visible(page, filing)
            expect(filing).to_be_disabled()
            assert announced(page) == []
            gate.release()
            notice(page, "Request filed. It reaches triage within a few seconds.")
    assert len(pb_requests(ui_title)) == 1


def test_request_outcomes_follow_the_intake(browser: Browser, app_url: str) -> None:
    titles = {outcome: file_request(app_url, department="props")[0] for outcome in ("accept", "decline", "merge", "pending")}
    tasks = {k: pulled(app_url, v)["id"] for k, v in titles.items()}
    listing = requests_by_title(app_url)
    order = [listing[titles[k]][0] for k in ("pending", "merge", "decline", "accept")]
    assert order == sorted(order)
    assert (listing[titles["pending"]][1]["status"], listing[titles["pending"]][1]["task"]) == ("pending", None)
    target = create(app_url)["id"]
    reason = unique("reason")[0]
    ok(decide(app_url, tasks["accept"], {"decision": "accept", "department": "props"}))
    ok(decide(app_url, tasks["decline"], {"decision": "decline", "reason": reason}))
    ok(decide(app_url, tasks["merge"], {"decision": "merge", "duplicate_of": target}))
    expected = {"accept": ("accepted", tasks["accept"]), "decline": ("declined", tasks["decline"]),
                "merge": ("merged", target), "pending": ("pending", None)}
    listing = requests_by_title(app_url)
    for key, (status, task) in expected.items():
        entry = listing[titles[key]][1]
        assert (entry["status"], entry["task"]) == (status, task)
        record = pb_requests(titles[key])[0]
        assert (record["status"], record["task"] or None) == (status, task)
    assert pb_requests(titles["decline"])[0]["decision_note"] == reason
    assert get_task(app_url, tasks["merge"])["duplicate_of"] == target
    shown = {"accept": ("Accepted", tasks["accept"]), "decline": ("Declined", tasks["decline"]),
             "merge": ("Merged", target), "pending": ("Pending", "Awaiting triage")}
    with ui(browser, app_url, path="/requests") as page:
        table = page.get_by_role("table", name="Requests")
        visible(page, table)
        for key, (outcome, cell) in shown.items():
            line = table.get_by_role("row").filter(has_text=titles[key])
            contains(page, line, outcome)
            contains(page, line, cell)


def test_rehearsal_week_cycles(app_url: str) -> None:
    prod = production(app_url)
    snap = snapshot(app_url)
    tz = ZoneInfo(prod["time_zone"])
    cycles = snap["cycles"]
    assert [(c["key"], c["name"]) for c in cycles] == list(CYCLES.items())
    starts = [parse_ts(c["starts_at"]).astimezone(tz) for c in cycles]
    for start in starts:
        assert start.weekday() == 0 and (start.hour, start.minute, start.second) == (0, 0, 0), start
    for i in range(len(cycles) - 1):
        assert parse_ts(cycles[i]["ends_at"]) == parse_ts(cycles[i + 1]["starts_at"])
        assert (starts[i + 1].date() - starts[i].date()).days == WEEK_DAYS
    assert cycles[-1]["ends_at"] is None
    marked = [c for c in cycles if c["current"]]
    assert len(marked) == 1 and marked[0]["key"] == prod["current_cycle"]
    today = date.fromisoformat(prod["today"])
    index = cycles.index(marked[0])
    if not (index == 0 and today < starts[0].date()):
        assert starts[index].date() <= today
        if marked[0]["ends_at"]:
            assert today < parse_ts(marked[0]["ends_at"]).astimezone(tz).date()
    short = snapshot(os.environ["APP_SHORT_CYCLES_URL"])["cycles"]
    spans = {(parse_ts(c["ends_at"]) - parse_ts(c["starts_at"])).total_seconds() for c in short[:-1]}
    assert len(spans) == 1 and SHORT_MIN_S <= spans.pop() <= SHORT_MAX_S
    assert short[-1]["ends_at"] is None


def test_opening_night_countdown(browser: Browser, app_url: str) -> None:
    prod = production(app_url)
    tz = ZoneInfo(prod["time_zone"])
    verifier_today = datetime.now(tz).date()
    assert abs((date.fromisoformat(prod["today"]) - verifier_today).days) <= TZ_SLACK_DAYS
    if "PROMPTSIDE_OPENING_NIGHT" not in os.environ:
        monday = parse_ts(snapshot(app_url)["cycles"][0]["starts_at"]).astimezone(tz).date()
        assert date.fromisoformat(prod["opening_night"]) == monday + timedelta(days=DEFAULT_OPENING_DAYS)
    opening = verifier_today + timedelta(days=OPENING_PROBE_DAYS)
    with scratch_app(PROMPTSIDE_OPENING_NIGHT=opening.isoformat()) as base:
        scratch = production(base)
        assert scratch["opening_night"] == opening.isoformat()
        today = date.fromisoformat(scratch["today"])
        assert abs((today - verifier_today).days) <= TZ_SLACK_DAYS
        assert scratch["days_to_opening"] == (opening - today).days
        with ui(browser, base) as page:
            contains(page, page.get_by_role("banner"), countdown(scratch["days_to_opening"]))


def test_phone_layout(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "sound", label="cues", status="todo")["id"]
    with ui(browser, app_url, size=PHONE, dept="sound", row=tid) as page:
        ready(page)
        layout(page)
        offscreen(page, rail(page))
        tap_targets(page, page)
        page.get_by_role("button", name="Departments").click()
        drawer = page.get_by_role("dialog", name="Departments")
        visible(page, drawer)
        tap_targets(page, drawer)
        drawer.get_by_role("link", name=re.compile(r"^Sound \d+$")).click()
        gone(page, drawer)
        tap(row(page, tid))
        at_rest(page, sheet(page))
        b = box(sheet(page))
        assert abs(b["x"]) <= PX_SLACK and abs(b["width"] - PHONE[0]) <= PX_SLACK
        assert abs(b["y"]) <= PX_SLACK and abs(b["height"] - PHONE[1]) <= PX_SLACK
        layout(page)
        tap_targets(page, sheet(page))


VIEWPORTS = {"1280x800": WIDE, "768x1024": TABLET, "375x812": PHONE}
VIEWPORT_IDS = ["1280x800", "768x1024", "375x812"]


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_published_breakpoints(browser: Browser, app_url: str, size: str) -> None:
    width, height = VIEWPORTS[size]
    done = create(app_url, status="todo")["id"]
    edit(app_url, done, status="done")
    tid = create(app_url, status="todo")["id"]
    columns = [re.compile(r"^Backlog"), re.compile(r"^Todo"), re.compile(r"^In progress"), re.compile(r"^Done")]
    with ui(browser, app_url, size=(width, height), view="board", dept="props", row=tid, task=tid) as page:
        layout(page)
        if width < TABLET[0]:
            visible(page, page.get_by_role("button", name="Departments"))
            offscreen(page, rail(page))
            visible(page, sheet(page))
            b = box(sheet(page))
            assert abs(b["width"] - width) <= PX_SLACK and abs(b["height"] - height) <= PX_SLACK
            return
        ready(page)
        assert abs(box(rail(page))["width"] - RAIL_PX) <= PX_SLACK
        groups = [tasks_grid(page).get_by_role("rowgroup", name=name).first for name in columns]
        for g in groups:
            visible(page, g)
        boxes = [g.bounding_box() for g in groups]
        pane = box(details(page))
        assert abs(pane["width"] - PANE_PX) <= PX_SLACK
        grid_box = box(tasks_grid(page))
        if width >= WIDE[0]:
            assert all(abs(b["y"] - boxes[0]["y"]) <= PX_SLACK for b in boxes)
            assert [b["x"] for b in boxes] == sorted(b["x"] for b in boxes) and boxes[0]["x"] < boxes[1]["x"]
            shown_right = tasks_grid(page).evaluate(VISIBLE_RIGHT_JS)
            assert shown_right <= pane["x"] + PX_SLACK, (shown_right, pane)
        else:
            assert [b["y"] for b in boxes] == sorted(b["y"] for b in boxes) and boxes[0]["y"] < boxes[1]["y"]
            assert pane["x"] < grid_box["x"] + grid_box["width"] - PX_SLACK


def test_blocking_links_and_loops(app_url: str) -> None:
    a, b, c = (create(app_url, status="todo")["id"] for _ in range(3))
    result = ok(link(app_url, a, b), 201)
    assert result["undoable"] is False
    assert get_task(app_url, b)["blocked_by"] == [a] and get_task(app_url, a)["blocks"] == [b]
    assert get_task(app_url, a)["version"] == 2 and get_task(app_url, b)["version"] == 2
    err(link(app_url, b, a), 409, "relation_cycle")
    ok(link(app_url, b, c), 201)
    err(link(app_url, c, a), 409, "relation_cycle")
    assert err(link(app_url, a, a), 422, "validation_failed")["fields"]["blocks"] == "A task can't block itself."
    assert err(link(app_url, a, UNKNOWN_ID), 422, "validation_failed")["fields"]["blocks"] == "Choose an existing task."
    err(link(app_url, a, b), 409, "relation_exists")
    title, _ = file_request(app_url, department="props")
    err(link(app_url, a, pulled(app_url, title)["id"]), 409, "illegal_relation")
    ok(httpx.delete(f"{app_url}/api/tasks/{b}/relations/{c}", timeout=HTTP_TIMEOUT_S))
    assert get_task(app_url, c)["blocked_by"] == []
    err(httpx.delete(f"{app_url}/api/tasks/{b}/relations/{c}", timeout=HTTP_TIMEOUT_S), 404, "not_found")
    d, e = (create(app_url, status="todo")["id"] for _ in range(2))
    r1, r2 = together(lambda: link(app_url, d, e), lambda: link(app_url, d, e))
    assert sorted([r1.status_code, r2.status_code]) == [201, 409]
    err(r1 if r1.status_code == 409 else r2, 409, "relation_exists")
    assert get_task(app_url, e)["blocked_by"] == [d]


EDGES = {
    "backlog-to-todo": ("backlog", "todo", 200), "todo-to-in_progress": ("todo", "in_progress", 200),
    "in_progress-to-backlog": ("in_progress", "backlog", 200), "backlog-to-done": ("backlog", "done", 200),
    "todo-to-cancelled": ("todo", "cancelled", 200), "done-to-todo": ("done", "todo", 200),
    "done-to-in_progress": ("done", "in_progress", 200), "cancelled-to-backlog": ("cancelled", "backlog", 200),
    "done-to-backlog": ("done", "backlog", 409), "done-to-cancelled": ("done", "cancelled", 409),
    "cancelled-to-todo": ("cancelled", "todo", 409), "cancelled-to-done": ("cancelled", "done", 409),
    "backlog-to-triage": ("backlog", "triage", 409), "todo-to-duplicate": ("todo", "duplicate", 409),
    "triage-edit": ("triage", "backlog", 409), "duplicate-edit": ("duplicate", "todo", 409),
}


def reach(base: str, status: str) -> str:
    if status in ("triage", "duplicate"):
        title, _ = file_request(base, department="props")
        tid = pulled(base, title)["id"]
        if status == "duplicate":
            ok(decide(base, tid, {"decision": "merge", "duplicate_of": create(base)["id"]}))
        return tid
    tid = create(base, status="todo" if status == "todo" else "backlog")["id"]
    if status in ("in_progress", "done", "cancelled"):
        edit(base, tid, status=status)
    return tid


EDGE_IDS = ["backlog-to-todo", "todo-to-in_progress", "in_progress-to-backlog", "backlog-to-done",
            "todo-to-cancelled", "done-to-todo", "done-to-in_progress", "cancelled-to-backlog", "done-to-backlog",
            "done-to-cancelled", "cancelled-to-todo", "cancelled-to-done", "backlog-to-triage", "todo-to-duplicate",
            "triage-edit", "duplicate-edit"]


@pytest.mark.parametrize("edge", EDGE_IDS, ids=EDGE_IDS)
def test_task_state_machine(app_url: str, edge: str) -> None:
    origin, target, status = EDGES[edge]
    tid = reach(app_url, origin)
    before = get_task(app_url, tid)
    r = patch(app_url, tid, {"status": target}, version=before["version"])
    after = get_task(app_url, tid)
    if status == 200:
        ok(r)
        assert after["status"] == target and after["version"] == before["version"] + 1
        return
    err(r, 409, "not_editable" if origin in ("triage", "duplicate") else "illegal_transition")
    assert (after["status"], after["version"]) == (before["status"], before["version"])


def test_create_task_numbering_cycle_and_field_errors(app_url: str) -> None:
    cur = current_cycle(app_url)
    first = create(app_url)
    second = create(app_url, status="todo", cycle="previews")
    assert second["number"] == first["number"] + 1 and second["id"] == f"STG-{second['number']}"
    assert (first["cycle"], first["status"], first["version"]) == (cur["key"], "backlog", 1)
    assert (second["cycle"], second["status"]) == ("previews", "todo")
    good = unique("note")[0]
    cases = [
        ({"title": "   ", "department": "props"}, {}, "title", "Give the task a title."),
        ({"title": "t" * (TITLE_MAX + 1), "department": "props"}, {}, "title", "Keep it to 140 characters."),
        ({"title": good, "department": "props", "details": "d" * (DETAILS_MAX + 1)}, {}, "details",
         "Keep details to 4,000 characters."),
        ({"title": good, "department": "scenery"}, {}, "department", "Choose a department."),
        ({"title": good, "department": "props", "priority": 5}, {}, "priority", "Choose a priority from 0 to 4."),
        ({"title": good, "department": "props", "owner": "nobody"}, {}, "owner", "Choose someone on the crew list."),
        ({"title": good, "department": "sound", "label": "focus"}, {}, "label", "Choose a label this department uses."),
        ({"title": good, "department": "props", "status": "done"}, {}, "status", "Choose a status."),
        ({"title": good, "department": "props"}, {"X-Crew-Member": "nobody"}, "X-Crew-Member",
         "Choose someone on the crew list."),
    ]
    for body, headers, field, message in cases:
        error = err(post_json(app_url, "/api/tasks", body, **headers), 422, "validation_failed")
        assert error["fields"][field] == message, (field, error)
    both = err(post_json(app_url, "/api/tasks", {"title": "", "department": "props"}, **{"X-Crew-Member": "nobody"}),
               422, "validation_failed")["fields"]
    assert both["title"] == "Give the task a title." and both["X-Crew-Member"] == "Choose someone on the crew list."
    index = list(CYCLES).index(cur["key"])
    if index > 0:
        error = err(post_json(app_url, "/api/tasks", {"title": good, "department": "props",
                                                      "cycle": list(CYCLES)[index - 1]}), 422, "validation_failed")
        assert error["fields"]["cycle"] == "Choose the current cycle or a later one."
    third = create(app_url)
    assert third["number"] == second["number"] + 1


IDEMPOTENT = ["create", "bulk", "undo", "decision", "request"]


@pytest.mark.parametrize("endpoint", IDEMPOTENT, ids=IDEMPOTENT)
def test_idempotent_retries(app_url: str, endpoint: str) -> None:
    who = "oren"
    tid = create(app_url, status="todo")["id"] if endpoint in ("bulk", "undo") else None
    if endpoint == "create":
        title = unique("note")[0]
        path, body = "/api/tasks", {"title": title, "department": "props"}
    elif endpoint == "bulk":
        path, body = "/api/tasks/bulk", {"tasks": [{"id": tid, "version": 1}], "set": {"priority": 1}}
    elif endpoint == "undo":
        edit(app_url, tid, who, priority=2)
        edit(app_url, tid, who, priority=3)
        path, body = "/api/undo", {}
    elif endpoint == "decision":
        title, _ = file_request(app_url, department="props")
        tid = pulled(app_url, title)["id"]
        path, body = f"/api/triage/{tid}/decision", {"decision": "decline", "reason": unique("reason")[0]}
    else:
        title = unique("request")[0]
        path, body = "/api/requests", {"title": title, "requester": "Hana Ito"}
    key = idempotency_key()
    first = post_json(app_url, path, body, key, **h(who))
    assert first.status_code < 500, first.text
    state = get_task(app_url, tid) if tid else None
    replay = post_json(app_url, path, body, key, **h(who))
    assert (replay.status_code, replay.json()) == (first.status_code, first.json())
    assert replay.headers["idempotent-replay"] == "true"
    if tid:
        assert get_task(app_url, tid) == state
    if endpoint == "undo":
        assert state["priority"] == 2
    if endpoint == "create":
        assert len([t for t in ok(api_get(app_url, "/api/tasks", dept="props"))["tasks"] if t["title"] == title]) == 1
    if endpoint == "request":
        assert len(pb_requests(title)) == 1
    err(post_json(app_url, path, {**body, "note": "different"}, key, **h(who)), 409, "idempotency_key_reused")
    fresh = {"title": unique("note")[0], "department": "props"}
    error = err(post_json(app_url, "/api/tasks", fresh, "k" * (KEY_MAX + 1)), 422, "validation_failed")
    assert error["fields"]["Idempotency-Key"] == "Use 1 to 100 visible characters."


BIG_BODY = json.dumps({"title": "x" * (JSON_LIMIT + 1), "department": "props"})
PRECEDENCE = {
    "cross-origin-over-size": ("POST", "/api/tasks", {"Origin": FOREIGN_ORIGIN, "Content-Type": "application/json"},
                               BIG_BODY, 403, "cross_origin"),
    "size-over-media-type": ("POST", "/api/tasks", {"Content-Type": "text/plain"}, BIG_BODY, 413, "payload_too_large"),
    "media-type-over-json": ("POST", "/api/tasks", {"Content-Type": "text/plain"}, "{", 415, "unsupported_media_type"),
    "json-over-not-found": ("PATCH", f"/api/tasks/{UNKNOWN_ID}", {"Content-Type": "application/json", "If-Match": "1"},
                            "{", 400, "malformed_json"),
    "not-found-over-precondition": ("PATCH", f"/api/tasks/{UNKNOWN_ID}", {"Content-Type": "application/json"},
                                    '{"priority": 1}', 404, "not_found"),
    "precondition-over-version": ("PATCH", "/api/tasks/{done}", {"Content-Type": "application/json"},
                                  '{"status": "backlog"}', 428, "precondition_required"),
    "version-over-state": ("PATCH", "/api/tasks/{done}", {"Content-Type": "application/json", "If-Match": "99"},
                           '{"status": "backlog"}', 412, "version_conflict"),
    "state-over-validation": ("PATCH", "/api/tasks/{done}", {"Content-Type": "application/json", "If-Match": "{version}"},
                              '{"status": "backlog", "title": ""}', 409, "illegal_transition"),
    "unknown-api-path": ("GET", "/api/no-such-thing", {}, None, 404, "not_found"),
    "unknown-filter": ("GET", "/api/tasks?dept=scenery", {}, None, 422, "validation_failed"),
}


PRECEDENCE_IDS = ["cross-origin-over-size", "size-over-media-type", "media-type-over-json", "json-over-not-found",
                  "not-found-over-precondition", "precondition-over-version", "version-over-state",
                  "state-over-validation", "unknown-api-path", "unknown-filter"]


@pytest.mark.parametrize("case", PRECEDENCE_IDS, ids=PRECEDENCE_IDS)
def test_error_shape_and_precedence(app_url: str, case: str) -> None:
    method, path, headers, body, status, code = PRECEDENCE[case]
    done = create(app_url, status="todo")["id"]
    edit(app_url, done, status="done")
    before = get_task(app_url, done)
    headers = {k: v.replace("{version}", str(before["version"])) for k, v in headers.items()}
    r = httpx.request(method, f"{app_url}{path.replace('{done}', done)}", headers=headers,
                      content=body.encode() if body is not None else None, timeout=HTTP_TIMEOUT_S)
    assert same_type(r.headers["content-type"]), r.headers["content-type"]
    error = err(r, status, code)
    if status == 412:
        assert error["current"]["id"] == done and error["current"]["version"] == before["version"]
    if status == 422:
        assert error["fields"] == {"dept": "That filter value isn't recognised."}
    after = get_task(app_url, done)
    assert (after["status"], after["version"]) == ("done", before["version"])


OUTAGES = ["minio-down", "pocketbase-down"]


@pytest.mark.parametrize("outage", OUTAGES, ids=OUTAGES)
def test_service_outage_keeps_tracker_working(browser: Browser, app_url: str, outage: str) -> None:
    down = outage_url(outage)
    service, other = ("plot_storage", "intake") if outage == "minio-down" else ("intake", "plot_storage")
    status = ok(api_get(down, "/api/status"))
    assert (status[service], status[other]) == ("down", "up")
    assert ok(api_get(app_url, "/api/status")) == {"intake": "up", "plot_storage": "up"}
    tid = create(down)["id"]
    assert edit(down, tid, priority=1)["tasks"][0]["priority"] == 1
    if outage == "minio-down":
        att = ok(upload(app_url, tid, "sketch.png", PNG + b"x", "image/png", "sketch"), 201)["attachment"]
        err(upload(down, tid, "plot.pdf", PDF, "application/pdf", "plot"), 503, "storage_unavailable")
        assert [a["id"] for a in attachments(down, tid)] == [att["id"]]
        err(httpx.get(f"{down}/api/attachments/{att['id']}/download", timeout=HTTP_TIMEOUT_S), 503, "storage_unavailable")
        banner = STORAGE_DOWN
    else:
        title = unique("request")[0]
        err(api_get(down, "/api/requests"), 503, "intake_unavailable")
        err(post_json(down, "/api/requests", {"title": title, "requester": "Hana Ito"}), 503, "intake_unavailable")
        assert pb_requests(title) == []
        banner = INTAKE_DOWN
    with ui(browser, down) as page:
        ready(page)
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([banner], timeout=QUICK_MS), BANNER_MAX_S)
        if outage == "pocketbase-down":
            page.goto(f"{down}/requests")
            contains(page, page.locator("body"), "Request outcomes can't be shown until the intake is back.")


def test_published_copy_verbatim(browser: Browser, app_url: str) -> None:
    parent = create(app_url, status="todo", cycle="previews")["id"]
    sub = create(app_url, status="todo", cycle="previews", parent=parent)["id"]
    create(app_url, status="todo", cycle="previews", parent=parent)
    edit(app_url, sub, status="done")
    with ui(browser, app_url, path="/no-such-screen") as page:
        visible(page, page.get_by_role("heading", level=1, name="This page isn't in the prompt book", exact=True))
        visible(page, page.get_by_role("link", name="Back to tasks"))
        page.goto(f"{app_url}/tasks?{urlencode(RESERVED_EMPTY)}")
        visible(page, page.get_by_role("heading", level=2, name="No tasks match this view", exact=True))
        page.goto(f"{app_url}/tasks?{urlencode({'dept': 'props', 'cycle': 'previews', 'row': parent, 'task': parent})}")
        pane = details(page)
        visible(page, pane)
        contains(page, pane, "1 of 2 sub-tasks done")
        contains(page, pane, "No attachments yet.")
    r = httpx.get(f"{app_url}/no-such-screen", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 404


def test_server_boundary(app_url: str) -> None:
    title = unique("note")[0]
    err(post_json(app_url, "/api/tasks", {"title": title, "department": "props"}, Origin=FOREIGN_ORIGIN), 403, "cross_origin")
    assert not [t for t in ok(api_get(app_url, "/api/tasks", dept="props"))["tasks"] if t["title"] == title]
    own = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    ok(post_json(app_url, "/api/tasks", {"title": title, "department": "props"}, Origin=own), 201)
    for r in (httpx.get(f"{app_url}/api/tasks", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S),
              httpx.options(f"{app_url}/api/tasks", headers={"Origin": FOREIGN_ORIGIN,
                                                              "Access-Control-Request-Method": "POST"},
                            timeout=HTTP_TIMEOUT_S)):
        assert not any(k.lower().startswith("access-control-allow") for k in r.headers)
    shell = '{"title": "limit", "department": "props", "details": ""}'
    exact = shell.replace('"details": ""', '"details": "' + "d" * (JSON_LIMIT - len(shell)) + '"')
    assert len(exact.encode()) == JSON_LIMIT
    at_limit = httpx.post(f"{app_url}/api/tasks", content=exact, headers={"Content-Type": "application/json"},
                          timeout=HTTP_TIMEOUT_S)
    assert err(at_limit, 422, "validation_failed")["fields"]["details"] == "Keep details to 4,000 characters."
    over = exact.replace('"details": "', '"details": "d', 1)
    err(httpx.post(f"{app_url}/api/tasks", content=over, headers={"Content-Type": "application/json"},
                   timeout=HTTP_TIMEOUT_S), 413, "payload_too_large")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/main.ts",
                 "/server/index.ts"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S).status_code == 404, path
    shell_html = httpx.get(f"{app_url}/tasks", timeout=HTTP_TIMEOUT_S).text
    assets = re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell_html)
    bodies = [shell_html, httpx.get(f"{app_url}/api/production", timeout=HTTP_TIMEOUT_S).text]
    for asset in assets:
        bodies.append(httpx.get(f"{app_url}{asset}", timeout=HTTP_TIMEOUT_S).text)
        assert httpx.get(f"{app_url}{asset}.map", timeout=HTTP_TIMEOUT_S).status_code == 404
    secrets = [os.environ.get(k, "") for k in ("POCKETBASE_ADMIN_PASSWORD", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    secrets.append(urlparse(os.environ.get("DATABASE_URL", "")).password or "")
    for secret in (s for s in secrets if len(s) >= 6):
        assert all(secret not in b for b in bodies)


def test_health_and_start(browser: Browser, app_url: str) -> None:
    r = api_get(app_url, "/api/health")
    assert ok(r) == {"status": "ok"}
    assert same_type(r.headers["content-type"]), r.headers["content-type"]
    with ui(browser, app_url, path="/") as page:
        ready(page)
        assert urlparse(page.url).path == "/tasks"


def _ms(value: str) -> float:
    return float(value[:-2]) if value.endswith("ms") else float(value[:-1]) * 1000


def test_motion_timings_and_reduced_motion(browser: Browser, app_url: str) -> None:
    tid = create(app_url, status="todo", cycle="previews")["id"]
    with ui(browser, app_url, dept="props", cycle="previews", row=tid) as page:
        current(page, tid)
        props = style(toolbar(page).get_by_role("button", name="New task"), "transition-property", "transition-duration")
        names = [p.strip() for p in props["transition-property"].split(",")]
        times = [_ms(d.strip()) for d in props["transition-duration"].split(",")]
        picked = [times[i % len(times)] for i, n in enumerate(names) if n in ("all", "background", "background-color")]
        assert picked and all(HOVER_MIN_MS <= t <= HOVER_MAX_MS for t in picked), props
        row(page, tid).focus()
        page.keyboard.press("Enter")
        advance(page, FRAME_MS)
        assert all(e <= PANE_IN_MS for e in page.evaluate(ANIM_JS))
        visible(page, details(page))
        advance(page, PANE_IN_MS)
        page.keyboard.press("Escape")
        advance(page, FRAME_MS)
        assert all(e <= PANE_OUT_MS for e in page.evaluate(RUNNING_JS))
        assert page.evaluate(LOOP_JS) == 0
    with ui(browser, app_url, reduced=True, dept="props", cycle="previews", row=tid) as page:
        current(page, tid)
        row(page, tid).focus()
        page.keyboard.press("Enter")
        advance(page, FRAME_MS)
        assert all(e <= FRAME_MS for e in page.evaluate(MOVING_JS))
        visible(page, details(page))
        assert page.evaluate(LOOP_JS) == 0


def test_public_roles_and_contrast(browser: Browser, app_url: str) -> None:
    snap = snapshot(app_url)
    listing = ok(api_get(app_url, "/api/tasks"))["tasks"]
    with ui(browser, app_url) as page:
        ready(page)
        visible(page, page.get_by_role("banner").get_by_role("heading", level=1, name="The Lantern Keepers"))
        nav = rail(page)
        for name in ("All tasks", "Requests", f"Triage {snap['triage']}"):
            visible(page, nav.get_by_role("link", name=name, exact=True))
        for key, name in DEPARTMENTS.items():
            n = sum(t["department"] == key and t["status"] in OPEN for t in listing)
            visible(page, nav.get_by_role("link", name=f"{name} {n}", exact=True))
        for c in snap["cycles"]:
            bar = nav.get_by_role("progressbar", name=f"{c['name']} progress")
            visible(page, bar)
            if c["total"]:
                assert progress_value(bar) == (c["done"], c["total"])
            else:
                assert progress_value(bar)[0] == 0
            contains(page, nav, f"{c['done']} of {c['total']} done")
        visible(page, blocked_link(page, snap["blocked"]))
        select(page.get_by_role("combobox", name="Working as"), "Leon Park")
        tools = toolbar(page)
        for name in ("Board view", "New task", "Undo", "Commands"):
            visible(page, tools.get_by_role("button", name=name, exact=True))
        visible(page, tools.get_by_role("button", name="List view", pressed=True))
        for role, name in (("combobox", "Group by"), ("checkbox", "Blocked only"), ("combobox", "Cycle")):
            visible(page, tools.get_by_role(role, name=name))
        expect(notices(page)).to_have_count(1)
        contrast_and_names(page)
        page.goto(f"{app_url}/triage")
        visible(page, page.get_by_role("banner"))
        contrast_and_names(page)
        page.goto(f"{app_url}/requests")
        visible(page, page.get_by_role("button", name="File a request"))
        visible(page, page.get_by_role("table", name="Requests"))
        contrast_and_names(page)


def test_wf_triage_intake_clear_inbox(browser: Browser, app_url: str) -> None:
    for t in ok(api_get(app_url, "/api/tasks", status="triage"))["tasks"]:
        decide(app_url, t["id"], {"decision": "decline", "reason": "Cleared before the triage journey"})
    thunder, _ = file_request(app_url, department="sound")
    door, _ = file_request(app_url, department="carpentry")
    chair, _ = file_request(app_url, department="props", requester="Hana Ito")
    ids = {k: pulled(app_url, v)["id"] for k, v in (("thunder", thunder), ("door", door), ("chair", chair))}
    target = create(app_url, "carpentry")["id"]
    cycle = current_cycle(app_url)
    reason = unique("reason")[0]
    pending = len(ids)
    with ui(browser, app_url, path="/triage") as page:
        visible(page, triage_link(page, pending))
        work_as(page, "Maya Okonjo")
        bar = rail(page).get_by_role("progressbar", name=f"{cycle['name']} progress")
        walk_to(page, "Triage", ids["thunder"])
        page.keyboard.press("a")
        dialog = page.get_by_role("dialog", name="Accept request")
        visible(page, dialog)
        assert_trapped(page, dialog)
        select(dialog.get_by_role("combobox", name="Priority"), "High")
        select(dialog.get_by_role("combobox", name="Owner"), "Kofi Mensah")
        dialog.get_by_role("button", name="Accept").focus()
        page.keyboard.press("Enter")
        notice(page, f"{ids['thunder']} accepted into {cycle['name']}.")
        body_not_focused(page)
        one_current(page, "Triage")
        visible(page, triage_link(page, pending - 1))
        eventually(page, lambda: _assert_eq(progress_value(bar)[1], cycle["total"] + 1))
        walk_to(page, "Triage", ids["door"])
        page.keyboard.press("m")
        dialog = page.get_by_role("dialog", name="Merge request")
        visible(page, dialog)
        pick(page, dialog.get_by_role("combobox", name="Duplicate of"), target)
        dialog.get_by_role("button", name="Merge").focus()
        page.keyboard.press("Enter")
        notice(page, f"{ids['door']} merged into {target}.")
        body_not_focused(page)
        one_current(page, "Triage")
        walk_to(page, "Triage", ids["chair"])
        page.keyboard.press("d")
        dialog = page.get_by_role("dialog", name="Decline request")
        visible(page, dialog)
        assert_trapped(page, dialog)
        fill(dialog.get_by_role("textbox", name="Reason"), reason)
        page.keyboard.press("Enter")
        notice(page, f"{ids['chair']} declined. Triage is clear.")
        empty = page.get_by_role("heading", level=2, name="Triage is clear", exact=True)
        visible(page, empty)
        contains(page, page.locator("body"), "Every request from the rehearsal room has an answer.")
        eventually(page, lambda: expect(empty).to_be_focused(timeout=QUICK_MS))
        visible(page, triage_link(page, pending - len(ids)))
        page.goto(f"{app_url}/tasks?{urlencode({'dept': 'carpentry', 'row': target, 'task': target})}")
        visible(page, details(page))
        link_in_details(page, target, ids["thunder"])
    with ui(browser, app_url, size=PHONE, path="/triage") as phone:
        visible(phone, phone.get_by_role("heading", level=2, name="Triage is clear", exact=True))
        offscreen(phone, rail(phone))
        phone_targets(phone)
    accepted = get_task(app_url, ids["thunder"])
    assert (accepted["status"], accepted["priority"], accepted["owner"], accepted["department"]) == \
        ("backlog", 2, "kofi", "sound")
    assert (pb_requests(thunder)[0]["status"], pb_requests(thunder)[0]["task"]) == ("accepted", ids["thunder"])
    assert (pb_requests(door)[0]["status"], pb_requests(door)[0]["task"]) == ("merged", target)
    record = pb_requests(chair)[0]
    assert (record["status"], record["decision_note"], record["task"]) == ("declined", reason, ids["chair"])
    notes = [create(app_url, "sound", priority=4, status="todo", cycle="previews")["id"] for _ in range(3)]
    undo_journey(browser, app_url, "sound", "Maya Okonjo", notes, "Assign to Kofi Mensah",
                 "3 tasks assigned to Kofi Mensah.", 3, key="a")


def _assert_eq(a: Any, b: Any) -> None:
    assert a == b, (a, b)


def test_wf_triage_intake_outage(browser: Browser, app_url: str) -> None:
    title, _ = file_request(app_url, department="sound")
    tid = pulled(app_url, title)["id"]
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    with ui(browser, down, path="/triage") as page:
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([INTAKE_DOWN], timeout=QUICK_MS), BANNER_MAX_S)
        walk_to(page, "Triage", tid)
        page.keyboard.press("a")
        dialog = page.get_by_role("dialog", name="Accept request")
        accept = dialog.get_by_role("button", name="Accept")
        try:
            eventually(page, lambda: expect(dialog).to_be_visible(timeout=QUICK_MS), PAUSED_PROBE_S)
            opened = True
        except AssertionError:
            opened = False
        if opened and accept.count() and accept.is_enabled() \
                and accept.get_attribute("aria-disabled") != "true":
            accept.focus()
            page.keyboard.press("Enter")
            notice(page, f"Request intake is unreachable, so {tid} stays in triage.")
        visible(page, row(page, tid, "Triage"))
    assert get_task(app_url, tid)["status"] == "triage"
    assert pb_requests(title)[0]["status"] == "pending"


def test_wf_notes_session_reassign_twenty(browser: Browser, app_url: str) -> None:
    ids = [create(app_url, priority=4, status="todo", cycle="previews")["id"] for _ in range(NOTES_ROWS)]
    with ui(browser, app_url, dept="props", cycle="previews", row=ids[0]) as page:
        current(page, ids[0])
        work_as(page, "Maya Okonjo")
        select_rows(page, ids)
        for tid in ids:
            attr(page, row(page, tid), "aria-selected", "true")
        count_notices(page)
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        visible(page, palette)
        focus_inside(page, palette)
        page.keyboard.type("Assign to Oren Vale")
        visible(page, palette.get_by_role("option", name="Assign to Oren Vale"))
        page.keyboard.press("Enter")
        notice(page, f"{NOTES_ROWS} tasks assigned to Oren Vale.")
        for tid in ids:
            contains(page, row(page, tid), "Oren Vale")
        assert announced(page) == [f"{NOTES_ROWS} tasks assigned to Oren Vale."]
        current(page, ids[-1])
        eventually(page, lambda: expect(row(page, ids[-1])).to_be_focused(timeout=QUICK_MS))
        assert set(query(page)) <= VIEW_PARAMS
        page.keyboard.press("Control+z")
        notice(page, undo_text(NOTES_ROWS))
        for tid in ids:
            lacks(page, row(page, tid), "Oren Vale")
    assert not any(get_task(app_url, i)["owner"] == "oren" for i in ids)


def test_wf_notes_session_bulk_conflict(browser: Browser, app_url: str) -> None:
    ids = [create(app_url, priority=4, status="todo", cycle="previews")["id"] for _ in range(3)]
    with ui(browser, app_url, dept="props", cycle="previews", row=ids[0]) as page:
        current(page, ids[0])
        select_rows(page, ids)
        page.keyboard.press("Control+k")
        focus_inside(page, page.get_by_role("dialog", name="Command palette"))
        page.keyboard.type(f"Assign to {CREW['ines']}")
        visible(page, page.get_by_role("option", name=f"Assign to {CREW['ines']}"))
        with entered(held(page, "**/api/tasks/bulk")) as gate:
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            edit(app_url, ids[1], who="ruth", owner="ruth")
            gate.release()
        notice(page, "No tasks changed: some were edited by someone else. Showing the saved versions.")
        contains(page, row(page, ids[1]), "Ruth Alder")
        for tid in (ids[0], ids[2]):
            lacks(page, row(page, tid), CREW["ines"])
    assert [get_task(app_url, i)["owner"] for i in ids] == [None, "ruth", None]


def test_wf_cue_line_cascade_build_queue(browser: Browser, app_url: str) -> None:
    parent, sub, first, second = cascade_tasks(app_url, "carpentry", "paint")
    before = snapshot(app_url)
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    with ui(browser, down, cycle="previews", group="department", row=sub) as page:
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([INTAKE_DOWN], timeout=QUICK_MS), BANNER_MAX_S)
        current(page, sub)
        row(page, sub).focus()
        page.keyboard.press("Enter")
        visible(page, details(page))
        work_as(page, "Devi Rangan")
        result = choose(page, details(page), "Status", "Done")
        notice(page, f"{sub} moved to Done. {parent} closed. 2 tasks freed.")
        advance(page, CASCADE_MAX_MS)
        for tid, order, by in ((first, "1", sub), (second, "2", parent)):
            attr(page, row(page, tid), "data-freed-order", order)
            contains(page, row(page, tid), f"Freed by {by}")
            contains(page, row(page, tid), "Todo")
        assert result["snapshot"]["blocked"] == before["blocked"] - 2
        visible(page, blocked_link(page, before["blocked"] - 2))
        previews = next(c for c in result["snapshot"]["cycles"] if c["key"] == "previews")
        old = next(c for c in before["cycles"] if c["key"] == "previews")
        assert previews["done"] == old["done"] + 2
        eventually(page, lambda: _assert_eq(progress_value(rail(page).get_by_role(
            "progressbar", name=f"{CYCLES['previews']} progress"))[0], previews["done"]))
        details(page).get_by_role("heading", level=2).focus()
        page.keyboard.press("Escape")
        gone(page, details(page))
        eventually(page, lambda: _assert_eq(row(page, sub).evaluate("r => r.contains(document.activeElement)"), True))
        eventually(page, lambda: _expect_query(page, "task", None))
        page.keyboard.press("Control+z")
        notice(page, undo_text(2, 2))
        advance(page, CASCADE_MAX_MS)
        for tid in (first, second):
            contains(page, row(page, tid), "Blocked")
    assert get_task(app_url, first)["blocked"] and get_task(app_url, second)["blocked"]
    assert activity(app_url, sub)[-1]["actor"]["handle"] == "devi"
    blockers = [create(app_url, "carpentry", priority=4, status="todo", cycle="previews")["id"] for _ in range(2)]
    paints = [create(app_url, "paint", status="todo", cycle="previews")["id"] for _ in range(2)]
    for blocker, paint in zip(blockers, paints):
        ok(link(app_url, blocker, paint), 201)
    result = undo_journey(browser, app_url, "carpentry", "Devi Rangan", blockers, "Move to Done",
                          "2 tasks moved to Done. 2 tasks freed.", 2, 2, key="s")
    assert sorted(r["id"] for r in result["reblocked"]) == sorted(paints)
    assert sorted(r["order"] for r in result["reblocked"]) == [1, 2]
    assert all(get_task(app_url, paint)["blocked"] for paint in paints)


def test_wf_cue_line_cascade_reduced_motion(browser: Browser, app_url: str) -> None:
    parent, sub, first, second = cascade_tasks(app_url, "carpentry", "paint")
    with ui(browser, app_url, size=PHONE, reduced=True, cycle="previews", group="department", row=sub,
            task=sub) as page:
        at_rest(page, sheet(page))
        result = choose(page, sheet(page), "Status", "Done")
        advance(page, FRAME_MS)
        sheet(page).get_by_role("button", name="Close details").click()
        advance(page, FRAME_MS)
        gone(page, sheet(page))
        expect(row(page, first)).to_contain_text(f"Freed by {sub}", timeout=QUICK_MS)
        expect(row(page, second)).to_contain_text(f"Freed by {parent}", timeout=QUICK_MS)
        expect(blocked_link(page, result["snapshot"]["blocked"])).to_have_count(1, timeout=QUICK_MS)
        for tid in (first, second):
            target = row(page, tid)
            target.scroll_into_view_if_needed()
            visible(page, target)
            tap_targets(page, target)
        phone_targets(page)
    assert get_task(app_url, parent)["status"] == "done"


def test_wf_bulk_undo_recover_mistake(browser: Browser, app_url: str) -> None:
    statuses, owners = ["todo", "in_progress", "backlog"], ["devi", None, "oren"]
    ids = []
    for i in range(UNDO_ROWS):
        tid = create(app_url, "carpentry", priority=4, cycle="previews", owner=owners[i % 3],
                     status="backlog" if statuses[i % 3] == "backlog" else "todo")["id"]
        if statuses[i % 3] == "in_progress":
            edit(app_url, tid, status="in_progress")
        ids.append(tid)
    dependents = [create(app_url, "paint", status="todo")["id"] for _ in range(2)]
    ok(link(app_url, ids[2], dependents[0]), 201)
    ok(link(app_url, ids[5], dependents[1]), 201)
    before = {i: get_task(app_url, i) for i in ids}
    with ui(browser, app_url, dept="carpentry", cycle="previews", group="cycle", row=ids[0]) as page:
        current(page, ids[0])
        work_as(page, "Maya Okonjo")
        select_rows(page, ids)
        for tid in ids:
            attr(page, row(page, tid), "aria-selected", "true")
        one_current(page)
        current(page, ids[-1])
        opener = tag_opener(page, ids)
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        visible(page, palette)
        focus_inside(page, palette)
        page.keyboard.type("Move to Done")
        visible(page, page.get_by_role("option", name="Move to Done"))
        page.keyboard.press("Enter")
        notice(page, f"{UNDO_ROWS} tasks moved to Done. 2 tasks freed.")
        gone(page, palette)
        back_at_opener(page, opener)
        assert not any(get_task(app_url, d)["blocked"] for d in dependents)
        page.keyboard.press("Control+k")
        visible(page, palette)
        assert_trapped(page, palette)
        page.keyboard.press("Escape")
        gone(page, palette)
        back_at_opener(page, opener)
        page.keyboard.press("Control+z")
        notice(page, f"Undo restored {UNDO_ROWS} tasks. 2 tasks blocked again.")
    for tid in ids:
        after = get_task(app_url, tid)
        for field in ("status", "priority", "owner"):
            assert after[field] == before[tid][field], (tid, field)
        assert activity(app_url, tid)[-1]["kind"] == "undo"
    assert all(get_task(app_url, d)["blocked"] for d in dependents)


def test_wf_bulk_undo_stale(browser: Browser, app_url: str) -> None:
    ids = [create(app_url, priority=4, status="todo", cycle="previews")["id"] for _ in range(3)]
    with ui(browser, app_url, size=PHONE, dept="props", cycle="previews", row=ids[0]) as page:
        ready(page)
        page.get_by_role("button", name="Departments").click()
        drawer = page.get_by_role("dialog", name="Departments")
        at_rest(page, drawer)
        select(drawer.get_by_role("combobox", name="Working as"), "Maya Okonjo")
        page.keyboard.press("Escape")
        gone(page, drawer)
        ok(bulk(app_url, ids, {"status": "in_progress"}))
        for tid in ids:
            contains(page, row(page, tid), "In progress")
        edit(app_url, ids[0], who="kofi", priority=1)
        row(page, ids[0]).focus()
        page.keyboard.press("Control+z")
        notice(page, "Undo stopped: a task changed after that edit.")
        for tid in ids:
            contains(page, row(page, tid), "In progress")
            lacks(page, row(page, tid), "Todo")
        body_not_focused(page)
        phone_targets(page)
    assert [get_task(app_url, i)["status"] for i in ids] == ["in_progress"] * 3
    assert get_task(app_url, ids[0])["priority"] == 1


def test_wf_concurrent_edits_two_leads(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "sound", label="cues", status="todo")["id"]
    with ui(browser, app_url, size=PHONE, dept="sound", row=tid) as phone, \
            ui(browser, app_url, dept="sound", row=tid, task=tid) as laptop:
        ready(phone)
        tap(row(phone, tid))
        at_rest(phone, sheet(phone))
        at_rest(laptop, details(laptop))
        with entered(held(phone, f"**/api/tasks/{tid}")) as pg, entered(held(laptop, f"**/api/tasks/{tid}")) as lg:
            select(sheet(phone).get_by_role("combobox", name="Owner"), "Kofi Mensah")
            select(details(laptop).get_by_role("combobox", name="Owner"), "Oren Vale")
            advance(phone, STEP_MS)
            advance(laptop, STEP_MS)
            pg.release()
            lg.release()
        saved = poll(lambda: get_task(app_url, tid)["version"] == 2 and get_task(app_url, tid), UI_DEADLINE_S, "no winner")
        name = CREW[saved["owner"]]
        loser = laptop if saved["owner"] == "kofi" else phone
        winner = phone if loser is laptop else laptop
        notice(loser, f"{tid} was changed by someone else. Showing the saved version.")
        notice(winner, f"{tid} assigned to {name}.")
        contains(laptop, row(laptop, tid), name)
        eventually(phone, lambda: _assert_eq(name in choice_text(sheet(phone).get_by_role("combobox", name="Owner")), True))
        sheet(phone).get_by_role("button", name="Close details").click()
        gone(phone, sheet(phone))
        eventually(phone, lambda: expect(row(phone, tid)).to_be_in_viewport(timeout=QUICK_MS))
        follow = create(app_url, "sound", label="cues", status="todo")["id"]
        link_in_details(laptop, tid, follow)
        contains(phone, row(phone, follow), "Blocked")
    cues = [create(app_url, "sound", label="cues", priority=4, status="todo", cycle="previews")["id"] for _ in range(3)]
    with ui(browser, app_url, dept="sound", cycle="previews", row=cues[0]) as laptop, \
            ui(browser, app_url, size=PHONE, dept="sound", cycle="previews", row=cues[0]) as phone:
        visible(phone, row(phone, cues[0]))
        mark(phone)
        tap(row(phone, cues[0]))
        at_rest(phone, sheet(phone))
        owner = sheet(phone).get_by_role("combobox", name="Owner")
        current(laptop, cues[0])
        work_as(laptop, "Sasha Bell")
        run_bulk(laptop, cues, "Assign to Ines Hart", "3 tasks assigned to Ines Hart.")
        eventually(phone, lambda: _assert_eq("Ines Hart" in choice_text(owner), True))
        undo_by_key(laptop)
        notice(laptop, undo_text(3))
        eventually(phone, lambda: _assert_eq("Ines Hart" in choice_text(owner), False))
        kept(phone)
    assert not any(get_task(app_url, cue)["owner"] == "ines" for cue in cues)


def test_wf_concurrent_edits_live_status(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "sound", label="cues", status="todo")["id"]
    with ui(browser, app_url, size=PHONE, dept="sound", row=tid) as phone, \
            ui(browser, app_url, dept="sound", row=tid, task=tid) as laptop:
        visible(phone, row(phone, tid))
        offscreen(phone, rail(phone))
        layout(phone)
        mark(phone)
        visible(laptop, details(laptop))
        work_as(laptop, "Sasha Bell")
        choose(laptop, details(laptop), "Status", "In progress")
        live(phone, lambda: expect(row(phone, tid)).to_contain_text("In progress", timeout=FRAME_MS),
             time.monotonic() + LIVE_MAX_MS / 1000)
        kept(phone)
    assert get_task(app_url, tid)["status"] == "in_progress"


def test_wf_subtask_rollup_last_fitting(browser: Browser, app_url: str) -> None:
    parent, last, sound = costume(app_url)
    with ui(browser, app_url, cycle="previews", group="department", row=last) as ruth, \
            ui(browser, app_url, cycle="previews", group="department", row=parent) as maya:
        current(ruth, last)
        row(ruth, last).focus()
        ruth.keyboard.press("Enter")
        visible(ruth, details(ruth))
        work_as(ruth, "Ruth Alder")
        visible(maya, row(maya, parent))
        mark(maya)
        row(maya, parent).focus()
        maya.keyboard.press("Enter")
        visible(maya, details(maya))
        contains(maya, details(maya), "2 of 3 sub-tasks done")
        result = choose(ruth, details(ruth), "Status", "Done")
        notice(ruth, f"{last} moved to Done. {parent} closed. 1 task freed.")
        previews = next(c for c in result["snapshot"]["cycles"] if c["key"] == "previews")
        for page in (ruth, maya):
            advance(page, CASCADE_MAX_MS)
            contains(page, row(page, parent), "Done")
            contains(page, row(page, sound), f"Freed by {parent}")
            visible(page, blocked_link(page, result["snapshot"]["blocked"]))
            contains(page, rail(page), f"{previews['done']} of {previews['total']} done")
        contains(maya, details(maya), "3 of 3 sub-tasks done")
        kept(maya)
        details(ruth).get_by_role("heading", level=2).focus()
        ruth.keyboard.press("Escape")
        gone(ruth, details(ruth))
        eventually(ruth, lambda: _assert_eq(row(ruth, last).evaluate("r => r.contains(document.activeElement)"), True))
        follow = create(app_url, "sound", status="todo", cycle="previews", priority=1)["id"]
        row(maya, parent).focus()
        maya.keyboard.press("Enter")
        visible(maya, details(maya))
        link_in_details(maya, parent, follow)
        lacks(maya, row(maya, follow), "Blocked")
        details(maya).get_by_role("heading", level=2).focus()
        maya.keyboard.press("Escape")
        gone(maya, details(maya))
        eventually(maya, lambda: _expect_query(maya, "task", None))
        view = query(maya)
        assert {k: view.get(k) for k in ("cycle", "group", "row")} == \
            {"cycle": "previews", "group": "department", "row": parent}, view
        maya.reload()
        current(maya, parent)
        contains(maya, row(maya, parent), "Done")
        assert query(maya) == view
        with ui(browser, app_url, size=PHONE, **view) as again:
            current(again, parent)
            contains(again, row(again, parent), "Done")
            lacks(again, row(again, sound), "Blocked")
            assert query(again) == view
            phone_targets(again)
    assert get_task(app_url, parent)["status"] == "done" and not get_task(app_url, sound)["blocked"]
    assert any(e["kind"] == "auto_closed" for e in activity(app_url, parent))


def test_wf_subtask_rollup_undo(browser: Browser, app_url: str) -> None:
    parent, last, sound = costume(app_url)
    with ui(browser, app_url, cycle="previews", group="department", row=last, task=last) as ruth, \
            ui(browser, app_url, cycle="previews", group="department", row=sound) as maya:
        visible(ruth, details(ruth))
        work_as(ruth, "Ruth Alder")
        choose(ruth, details(ruth), "Status", "Done")
        contains(maya, row(maya, sound), f"Freed by {parent}")
        row(ruth, last).focus()
        ruth.keyboard.press("Control+z")
        notice(ruth, "Undo restored 2 tasks. 1 task blocked again.")
        advance(maya, CASCADE_MAX_MS)
        contains(maya, row(maya, sound), "Blocked")
        contains(maya, row(maya, parent), "In progress")
        blocked = snapshot(app_url)["blocked"]
        with entered(held(ruth, f"**/api/tasks/{last}")) as gate:
            select(details(ruth).get_by_role("combobox", name="Status"), "Done")
            edit(app_url, last, who="maya", details=unique("fitting note")[0])
            advance(ruth, STEP_MS)
            gate.release()
        notice(ruth, f"{last} was changed by someone else. Showing the saved version.")
        advance(ruth, CASCADE_MAX_MS)
        contains(ruth, row(ruth, last), "In progress")
        contains(ruth, row(ruth, parent), "In progress")
        contains(ruth, row(ruth, sound), "Blocked")
        visible(ruth, blocked_link(ruth, blocked))
    assert get_task(app_url, parent)["status"] == "in_progress" and get_task(app_url, sound)["blocked"]
    assert get_task(app_url, last)["status"] == "in_progress"
    gown = create(app_url, "wardrobe", status="todo", cycle="previews", priority=1)["id"]
    edit(app_url, gown, status="in_progress")
    fittings = [create(app_url, "wardrobe", status="todo", cycle="previews", priority=4, parent=gown)["id"]
                for _ in range(2)]
    undo_journey(browser, app_url, "wardrobe", "Ruth Alder", fittings, "Move to Done", "2 tasks moved to Done.", 3,
                 key="s")
    assert get_task(app_url, gown)["status"] == "in_progress"


def test_wf_attachments_current_plot(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "lighting", label="focus", status="todo", cycle="previews")["id"]
    old_name = f"{unique('plot')[0]}.pdf"
    older = ok(upload(app_url, tid, old_name, PDF + b"old", "application/pdf", "plot"), 201)["attachment"]
    name = f"{unique('plot')[0]}.pdf"
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    with ui(browser, down, size=PHONE, dept="lighting", cycle="previews", row=tid) as page:
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([INTAKE_DOWN], timeout=QUICK_MS), BANNER_MAX_S)
        ready(page)
        layout(page)
        tap_targets(page, page)
        page.get_by_role("button", name="Departments").click()
        drawer = page.get_by_role("dialog", name="Departments")
        at_rest(page, drawer)
        tap_targets(page, drawer)
        select(drawer.get_by_role("combobox", name="Working as"), "Ines Hart")
        page.keyboard.press("Escape")
        gone(page, drawer)
        tap(row(page, tid))
        pane = sheet(page)
        at_rest(page, pane)
        pick(page, pane.get_by_role("combobox", name="Attachment kind"), "plot")
        with entered(held(page, f"**/api/tasks/{tid}/attachments")) as gate:
            pane.get_by_label("Attach file").set_input_files(
                {"name": name, "mimeType": "application/pdf", "buffer": PDF + name.encode()})
            contains(page, pane, f"Uploading {name}")
            expect(pane.get_by_role("link", name=name)).to_have_count(0)
            gate.release()
        notice(page, f"{name} attached to {tid}.")
        items = pane.get_by_role("list", name="Attachments").get_by_role("listitem")
        contains(page, items.filter(has=page.get_by_role("link", name=name)), "Current")
        lacks(page, items.filter(has=page.get_by_role("link", name=old_name)), "Current")
        layout(page)
        tap_targets(page, pane)
    listing = attachments(app_url, tid)
    assert [(a["file_name"], a["current"]) for a in listing] == [(name, True), (old_name, False)]
    assert S3().get(f"tasks/{tid}/{listing[0]['id']}/{KEY_UNSAFE.sub('_', name)}") == PDF + name.encode()
    assert older["id"] == listing[1]["id"]
    assert activity(app_url, tid)[-1]["actor"]["handle"] == "ines"
    focus = [create(app_url, "lighting", label="focus", priority=4, status="todo", cycle="previews")["id"]
             for _ in range(2)]
    stale_undo_journey(browser, app_url, "lighting", "Ines Hart", focus, "", "Priority set to Urgent on 2 tasks.",
                       digit="1")


def test_wf_attachments_storage_outage(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    tid = create(app_url, "lighting", label="focus", status="todo", cycle="previews")["id"]
    name = f"{unique('plot')[0]}.pdf"
    with ui(browser, down, dept="lighting", cycle="previews", row=tid) as page:
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([STORAGE_DOWN], timeout=QUICK_MS), BANNER_MAX_S)
        current(page, tid)
        row(page, tid).focus()
        page.keyboard.press("Enter")
        pane = details(page)
        visible(page, pane)
        pick(page, pane.get_by_role("combobox", name="Attachment kind"), "plot")
        pane.get_by_label("Attach file").set_input_files({"name": name, "mimeType": "application/pdf", "buffer": PDF})
        notice(page, f"Plot storage is unreachable. {name} was not attached.")
        expect(pane.get_by_role("link", name=name)).to_have_count(0)
        body_not_focused(page)
        follow = create(app_url, "lighting", label="programming", status="todo", cycle="previews")["id"]
        link_in_details(page, tid, follow)
        pane.get_by_role("heading", level=2).focus()
        page.keyboard.press("Escape")
        gone(page, pane)
        eventually(page, lambda: _assert_eq(row(page, tid).evaluate("r => r.contains(document.activeElement)"), True))
    assert attachments(app_url, tid) == [] and S3().keys(f"tasks/{tid}/") == []


def test_wf_shared_views_carpentry_link(browser: Browser, app_url: str) -> None:
    blocker = create(app_url, "wardrobe", cycle="previews")["id"]
    tid = create(app_url, "carpentry", status="todo", cycle="previews")["id"]
    ok(link(app_url, blocker, tid), 201)
    with ui(browser, app_url) as page:
        ready(page)
        rail(page).get_by_role("link", name=re.compile(r"^Carpentry \d+$")).click()
        eventually(page, lambda: _expect_query(page, "dept", "carpentry"))
        blocked_only = toolbar(page).get_by_role("checkbox", name="Blocked only")
        blocked_only.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: expect(blocked_only).to_be_checked(timeout=QUICK_MS))
        eventually(page, lambda: _expect_query(page, "blocked", "1"))
        select(toolbar(page).get_by_role("combobox", name="Group by"), "Cycle")
        eventually(page, lambda: _expect_query(page, "group", "cycle"))
        walk_to(page, "Tasks", tid)
        eventually(page, lambda: _expect_query(page, "row", tid))
        shared = page.url
        assert query(page) == {"dept": "carpentry", "blocked": "1", "group": "cycle", "row": tid}
        with entered(open_app(browser, shared)) as other:
            other.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
            current(other, tid)
            expect(toolbar(other).get_by_role("checkbox", name="Blocked only")).to_be_checked()
            visible(other, tasks_grid(other).get_by_role("rowgroup", name=re.compile(r"^Previews"))
                    .get_by_role("row", name=row_re(tid)))
        page.go_back()
        eventually(page, lambda: _expect_query(page, "group", None))
        assert query(page)["blocked"] == "1"
        page.go_forward()
        page.reload()
        current(page, tid)
        assert query(page) == {"dept": "carpentry", "blocked": "1", "group": "cycle", "row": tid}
        follow = create(app_url, "paint", status="todo", cycle="previews")["id"]
        row(page, tid).focus()
        page.keyboard.press("Enter")
        visible(page, details(page))
        link_in_details(page, tid, follow)
    pair = [create(app_url, "carpentry", priority=4, status="todo", cycle="previews")["id"] for _ in range(2)]
    with ui(browser, app_url, dept="carpentry", cycle="previews", row=pair[0]) as page:
        current(page, pair[0])
        work_as(page, "Maya Okonjo")
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        visible(page, palette)
        focus_inside(page, palette)
        page.keyboard.type("Group by Cycle")
        visible(page, palette.get_by_role("option", name="Group by Cycle"))
        page.keyboard.press("Enter")
        gone(page, palette)
        eventually(page, lambda: _expect_query(page, "group", "cycle"))
        page.reload()
        current(page, pair[0])
        assert query(page)["group"] == "cycle"
        bulk_undo(page, app_url, pair, "Assign to Devi Rangan", "2 tasks assigned to Devi Rangan.", 2)


def test_wf_shared_views_tablet(browser: Browser, app_url: str) -> None:
    blocker = create(app_url, "wardrobe", cycle="previews")["id"]
    tid = create(app_url, "carpentry", status="todo", cycle="previews")["id"]
    ok(link(app_url, blocker, tid), 201)
    with ui(browser, app_url, size=TABLET, dept="carpentry", blocked="1", group="cycle", row=tid, task=tid) as page:
        current(page, tid)
        visible(page, details(page))
        assert abs(box(details(page))["width"] - PANE_PX) <= PX_SLACK
        layout(page)
        page.reload()
        visible(page, details(page))
        assert query(page)["task"] == tid


def test_wf_director_requests_file_and_check(browser: Browser, app_url: str) -> None:
    title = unique("request")[0]
    with ui(browser, app_url, size=PHONE, path="/requests") as page:
        visible(page, page.get_by_role("table", name="Requests"))
        offscreen(page, rail(page))
        layout(page)
        tap_targets(page, page)
        opener = page.get_by_role("button", name="File a request")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="File a request")
        at_rest(page, dialog)
        assert_trapped(page, dialog)
        fill(dialog.get_by_role("textbox", name="Request"), title)
        fill(dialog.get_by_role("textbox", name="Details"), "It currently lands before the line.")
        fill(dialog.get_by_role("textbox", name="Your name"), "Leon Park")
        select(dialog.get_by_role("combobox", name="Department"), "Sound")
        with entered(held(page, "**/api/requests")) as gate:
            dialog.get_by_role("button", name="File request").click()
            visible(page, dialog.get_by_role("button", name="Filing"))
            assert pb_requests(title) == []
            gate.release()
        notice(page, "Request filed. It reaches triage within a few seconds.")
        if dialog.count() and dialog.first.is_visible():
            dialog.get_by_role("textbox", name="Request").focus()
            page.keyboard.press("Escape")
        gone(page, dialog)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        line = page.get_by_role("table", name="Requests").get_by_role("row").filter(has_text=title)
        contains(page, line, "Pending")
        contains(page, line, "Awaiting triage")
        tid = pulled(app_url, title)["id"]
        ok(decide(app_url, tid, {"decision": "accept", "department": "sound"}))
        page.reload()
        contains(page, line, "Accepted")
        contains(page, line, tid)
        layout(page)
        tap_targets(page, page)
    record = pb_requests(title)[0]
    assert (record["status"], record["task"], record["requester"], record["department"]) == \
        ("accepted", tid, "Leon Park", "sound")


def test_wf_director_requests_outage(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_POCKETBASE_DOWN_URL"]
    title = unique("request")[0]
    with ui(browser, down, path="/requests") as page:
        eventually(page, lambda: expect(service_alerts(page)).to_have_text([INTAKE_DOWN], timeout=QUICK_MS), BANNER_MAX_S)
        work_as(page, "Leon Park")
        contains(page, page.locator("body"), "Request outcomes can't be shown until the intake is back.")
        page.get_by_role("button", name="File a request").click()
        dialog = page.get_by_role("dialog", name="File a request")
        fill(dialog.get_by_role("textbox", name="Request"), title)
        fill(dialog.get_by_role("textbox", name="Your name"), "Leon Park")
        with page.expect_response(lambda r: r.url.endswith("/api/requests") and r.request.method == "POST") as info:
            dialog.get_by_role("button", name="File request").click()
        assert info.value.status == 503
        lacks(page, notices(page), "Request filed.")
    assert pb_requests(title) == []


def test_wf_cycles_filter_in_address(browser: Browser, app_url: str) -> None:
    cycle = current_cycle(app_url)
    tid = create(app_url, status="todo")["id"]
    with ui(browser, app_url, cycle=cycle["key"], group="cycle", row=tid) as page:
        current(page, tid)
        work_as(page, "Maya Okonjo")
        assert cycle["name"] in choice_text(toolbar(page).get_by_role("combobox", name="Cycle"))
        select(toolbar(page).get_by_role("combobox", name="Cycle"), "All cycles")
        eventually(page, lambda: _expect_query(page, "cycle", None))
        page.go_back()
        eventually(page, lambda: _expect_query(page, "cycle", cycle["key"]))
        view = query(page)
        assert {k: view.get(k) for k in ("cycle", "group", "row")} == \
            {"cycle": cycle["key"], "group": "cycle", "row": tid}, view
        page.reload()
        current(page, tid)
        with ui(browser, app_url, **view) as again:
            for tab in (page, again):
                current(tab, tid)
                assert cycle["name"] in choice_text(toolbar(tab).get_by_role("combobox", name="Cycle"))
                assert "Cycle" in choice_text(toolbar(tab).get_by_role("combobox", name="Group by"))
                assert query(tab) == view
            row(again, tid).focus()
            again.keyboard.press("Enter")
            visible(again, details(again))
            eventually(again, lambda: _expect_query(again, "task", tid))
            details(again).get_by_role("heading", level=2).focus()
            again.keyboard.press("Escape")
            gone(again, details(again))
            eventually(again, lambda: _assert_eq(row(again, tid).evaluate("r => r.contains(document.activeElement)"), True))
            eventually(again, lambda: _expect_query(again, "task", None))
            follow = create(app_url, status="todo")["id"]
            row(again, tid).focus()
            again.keyboard.press("Enter")
            visible(again, details(again))
            link_in_details(again, tid, follow)
    week = [create(app_url, priority=4, status="todo", cycle=cycle["key"])["id"] for _ in range(3)]
    undo_journey(browser, app_url, "props", "Maya Okonjo", week, "", "Priority set to High on 3 tasks.", 3,
                 digit="2", cycle=cycle["key"])


def test_wf_phone_tech_table_sound_note(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "sound", label="cues", status="todo")["id"]
    note = unique("cue")[0]
    with ui(browser, app_url, size=PHONE) as page:
        ready(page)
        page.get_by_role("button", name="Departments").click()
        drawer = page.get_by_role("dialog", name="Departments")
        at_rest(page, drawer)
        select(drawer.get_by_role("combobox", name="Working as"), "Kofi Mensah")
        drawer.get_by_role("link", name=re.compile(r"^Sound \d+$")).click()
        gone(page, drawer)
        target = row(page, tid)
        visible(page, target)
        target.scroll_into_view_if_needed()
        y0 = target.bounding_box()["y"]
        tap(target)
        visible(page, sheet(page))
        fill(sheet(page).get_by_role("textbox", name="Details"), note)
        with patch_response(page):
            page.keyboard.press("Tab")
        notice(page, f"{tid} updated.")
        sheet(page).get_by_role("button", name="Close details").click()
        gone(page, sheet(page))
        eventually(page, lambda: expect(target).to_be_focused(timeout=QUICK_MS))
        assert abs(target.bounding_box()["y"] - y0) <= PX_SLACK
        layout(page)
        page.keyboard.press("Control+z")
        notice(page, undo_text(1))
    entries = activity(app_url, tid)
    assert get_task(app_url, tid)["details"] != note
    assert entries[-1]["kind"] == "undo" and entries[-1]["actor"]["handle"] == "kofi"
    assert any(e["kind"] == "edited" and e["actor"]["handle"] == "kofi" for e in entries)
    later = unique("cue")[0]
    with ui(browser, app_url, size=PHONE, dept="sound", row=tid) as page:
        ready(page)
        page.get_by_role("button", name="Departments").click()
        drawer = page.get_by_role("dialog", name="Departments")
        at_rest(page, drawer)
        select(drawer.get_by_role("combobox", name="Working as"), "Kofi Mensah")
        page.keyboard.press("Escape")
        gone(page, drawer)
        edit(app_url, tid, who="kofi", details=later)
        edit(app_url, tid, who="maya", priority=1)
        row(page, tid).focus()
        page.keyboard.press("Control+z")
        notice(page, "Undo stopped: a task changed after that edit.")
        layout(page)
    assert get_task(app_url, tid)["details"] == later


def test_wf_phone_tech_table_reduced_motion(browser: Browser, app_url: str) -> None:
    tid = create(app_url, "sound", label="cues", status="todo")["id"]
    with ui(browser, app_url, size=PHONE, reduced=True, dept="sound", row=tid) as page:
        ready(page)
        page.get_by_role("button", name="Departments").click()
        advance(page, FRAME_MS)
        assert all(e <= FRAME_MS for e in page.evaluate(MOVING_JS))
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Departments"))
        tap(row(page, tid))
        advance(page, FRAME_MS)
        assert all(e <= FRAME_MS for e in page.evaluate(MOVING_JS))
        visible(page, sheet(page))


def test_wf_dependencies_link_paint_to_carpentry(browser: Browser, app_url: str) -> None:
    carp = create(app_url, "carpentry", status="todo")["id"]
    title = unique("paint")[0]
    with ui(browser, app_url, dept="paint") as page:
        ready(page)
        work_as(page, "Maya Okonjo")
        toolbar(page).get_by_role("button", name="New task").click()
        dialog = page.get_by_role("dialog", name="New task")
        visible(page, dialog)
        fill(dialog.get_by_role("textbox", name="Title"), title)
        select(dialog.get_by_role("combobox", name="Department"), "Paint")
        with page.expect_response(lambda r: r.url.endswith("/api/tasks") and r.request.method == "POST") as info:
            dialog.get_by_role("button", name="Create task").click()
        paint = info.value.json()["tasks"][0]["id"]
        notice(page, f"{paint} created.")
        before = snapshot(app_url)["blocked"]
        page.goto(f"{app_url}/tasks?{urlencode({'dept': 'carpentry', 'row': carp, 'task': carp})}")
        visible(page, details(page))
        details(page).get_by_role("button", name="Add blocked task").click()
        linker = page.get_by_role("dialog", name="Add blocked task")
        visible(page, linker)
        pick(page, linker.get_by_role("combobox", name="Task"), paint)
        linker.get_by_role("button", name="Add link").click()
        notice(page, f"{carp} now blocks {paint}.")
        contains(page, details(page).get_by_role("list", name="Blocks"), paint)
        visible(page, blocked_link(page, before + 1))
        page.goto(f"{app_url}/tasks?{urlencode({'dept': 'paint', 'row': paint})}")
        contains(page, row(page, paint), "Blocked")
    task = get_task(app_url, paint)
    assert (task["blocked"], task["blocked_by"], task["department"], task["title"]) == (True, [carp], "paint", title)
    carp2 = create(app_url, "carpentry", status="todo")["id"]
    paint2 = create(app_url, "paint", status="todo")["id"]
    ok(link(app_url, carp2, paint2), 201)
    result = undo_journey(browser, app_url, "carpentry", "Maya Okonjo", [carp, carp2], "Move to Done",
                          "2 tasks moved to Done. 2 tasks freed.", 2, 2, key="s", cycle=None)
    assert sorted(r["id"] for r in result["reblocked"]) == sorted([paint, paint2])
    assert get_task(app_url, paint)["blocked"] and get_task(app_url, paint2)["blocked"]


def test_wf_dependencies_loop_refused(browser: Browser, app_url: str) -> None:
    a = create(app_url, "carpentry", status="todo")["id"]
    b = create(app_url, "paint", status="todo")["id"]
    ok(link(app_url, a, b), 201)
    with ui(browser, app_url, dept="paint", row=b, task=b) as page:
        visible(page, details(page))
        details(page).get_by_role("button", name="Add blocked task").click()
        linker = page.get_by_role("dialog", name="Add blocked task")
        try:
            pick(page, linker.get_by_role("combobox", name="Task"), a)
        except AssertionError:
            pass
        else:
            linker.get_by_role("button", name="Add link").click()
            notice(page, "That link would make a loop, so it was not added.")
    assert get_task(app_url, a)["blocked_by"] == []


def test_wf_dependencies_new_task_errors(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, dept="paint") as page:
        ready(page)
        toolbar(page).get_by_role("button", name="New task").click()
        dialog = page.get_by_role("dialog", name="New task")
        visible(page, dialog)
        created: list[int] = []
        page.on("response", lambda r: created.append(r.status) if r.request.method == "POST"
                and urlparse(r.url).path == "/api/tasks" and r.ok else None)
        dialog.get_by_role("button", name="Create task").click()
        summary = page.get_by_role("alert").filter(has_text="There is a problem")
        visible(page, summary)
        eventually(page, lambda: _assert_eq(summary.evaluate("s => s.contains(document.activeElement)"), True))
        summary.get_by_role("link", name="Give the task a title.").click()
        eventually(page, lambda: expect(dialog.get_by_role("textbox", name="Title")).to_be_focused(timeout=QUICK_MS))
        assert created == [], "an untitled task was created"


def shipped_packages() -> dict[tuple[str, str], Any]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app",
                         capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    found: dict[tuple[str, str], Any] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            if info.get("version"):
                found[(name, info["version"])] = info.get("license")
            walk(info.get("dependencies"))

    walk(json.loads(out.stdout).get("dependencies"))
    return found


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ["Fraunces", "IBM Plex Sans", "IBM Plex Mono"]
NAMES_OFL = re.compile(r"\bOFL\b|Open Font Licen[cs]e", re.I)
NAMES_LICENCE = re.compile(r"\b(MIT|ISC|BSD|Apache|0BSD|OFL)\b|Open Font Licen[cs]e", re.I)


def names_font(text: str, font: str) -> bool:
    low = text.lower()
    return font.lower() in low or font.lower().replace(" ", "-") in low


def font_entry(lines: list[str], i: int) -> list[str]:
    if NAMES_LICENCE.search(lines[i]):
        return [lines[i]]
    entry = [lines[i]]
    for line in lines[i + 1:]:
        if line.lstrip().startswith("#") or any(names_font(line, font) for font in FONTS):
            break
        entry.append(line)
    return entry


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name, version in shipped_packages():
        assert name in text and version in text, f"{name}@{version} missing"
    for font in FONTS:
        assert names_font(text, font), font


def test_if_licences_allowed() -> None:
    for (name, version), licence in shipped_packages().items():
        value = licence.get("type") if isinstance(licence, dict) else licence
        options = [o.strip("() ") for o in str(value).split(" OR ")]
        assert any(all(p.strip("() ") in ALLOWED or p.strip("() ") == "SIL OFL-1.1" for p in o.split(" AND "))
                   for o in options), f"{name}@{version}: {value}"
    lines = Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in FONTS:
        assert any(names_font(line, font) and any(NAMES_OFL.search(near) for near in font_entry(lines, i))
                   for i, line in enumerate(lines)), font


def test_if_no_extra_datastore() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    declared = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "lokijs", "node-persist"}
    assert not declared & banned
    for path in Path("/app").rglob("*"):
        if "node_modules" in path.parts:
            continue
        assert path.suffix not in (".sqlite", ".sqlite3", ".db"), path


def test_if_service_config_unchanged() -> None:
    assert Postgres().rows("select 1 as one") == [{"one": 1}]
    assert "requests" in PocketBase().collections()
    assert isinstance(S3().keys("tasks/"), list)


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "public", "coverage"}
    tooling = {"scripts", "tools", "bin"}
    ts = 0
    for path in Path("/app").rglob("*"):
        if skip & set(path.parts) or not path.is_file():
            continue
        if path.suffix in (".ts", ".tsx"):
            ts += 1
        if path.suffix in (".js", ".jsx", ".mjs", ".cjs"):
            rel = path.relative_to("/app")
            assert (len(rel.parts) == 1 or rel.parts[0] in tooling or "config" in path.name
                    or path.name.startswith(".")), path
    assert ts > 0


def test_if_no_third_party_requests(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url) as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        ready(page)
        for path in ("/triage", "/requests"):
            page.goto(f"{app_url}{path}")
            visible(page, page.get_by_role("banner"))
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert foreign == []
