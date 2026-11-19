from __future__ import annotations

import concurrent.futures
import copy
import csv
import importlib
import io
import json
import math
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import weakref
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest
from conftest import (
    DEPLOYED_APP,
    advance,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    shipped_packages,
    tab_order,
    tap,
    until,
)
from conftest import fill as kit_fill


HTTP_TIMEOUT = 30
SEED_TIMEOUT = 120
UI_TIMEOUT_MS = 10_000
MAIL_WAIT_S = 20
BOOT_WAIT_S = 120
POLL_INTERVAL_S = 0.2
STREAM_WAIT_S = 15

LIVE_MS = 2000
LIVE_SLACK_MS = 500
TIME_BUDGET_S = 3
DEBOUNCE_MS = 300
STAGGER_MS = 40
BAR_MS = 320
FRAME_MS = 17
FIRST_FRAME_MS = 34
SETTLE_MS = 2000
BAR_TOLERANCE_PX = 1
LAYOUT_TOLERANCE_PX = 1
MIN_TARGET_PX = 44
RAIL_TOLERANCE_PX = 8
QUERY_DEPTH_LIMIT = 32
JSON_BODY_LIMIT = 1_000_000
GRADING_BODY_LIMIT = 10_000_000
FILE_BODY_LIMIT = 5_000_000
LINE_ERROR_CAP = 20
RAIL_DESKTOP_SHARE = 0.16
RAIL_TABLET_RANGE = (0.20, 0.30)
LANDING_START_SHARE = 0.30
SEPARATOR_STEP = 5
QUERY_PANE_START = 30
PIPELINE_PANE_START = 50
PANE_MIN = 20
PANE_MAX = 80
SAMPLE_INPUT = 1240
SAMPLE_COUNTS = [413, 620, 5, 5]
RACE_N = 6

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}

GRADING_KEY = os.environ.get("GRADING_KEY", "grade-7f3c")


def _limit(name: str, spec_value: int) -> int:
    return int(os.environ.get(name, spec_value))


MAX_DOC_BYTES = _limit("JARFUL_MAX_DOC_BYTES", 2048)
MAX_DEPTH = _limit("JARFUL_MAX_DEPTH", 5)
SCAN_LIMIT = _limit("JARFUL_SCAN_LIMIT", 300)
PAGE_SIZE = _limit("JARFUL_PAGE_SIZE", 10)
IMPORT_MAX_LINES = _limit("JARFUL_IMPORT_MAX_LINES", 40)
SCHEMA_SAMPLE = _limit("JARFUL_SCHEMA_SAMPLE", 50)
PREVIEW_DOCS = _limit("JARFUL_PREVIEW_DOCS", 3)
MAX_STAGES = _limit("JARFUL_MAX_STAGES", 8)

LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}

expect.set_options(timeout=UI_TIMEOUT_MS)

# Pages whose clock browse(live=False) left paused. Only there does a wait need the page clock moved; on a live page
# eventually()/ready() are exactly the bare expect/action they wrap.
_PAUSED: "weakref.WeakSet[Page]" = weakref.WeakSet()
STEP_MS = 50  # page time moved between retries on a paused page
TRY_MS = 100  # one retry's own real-time wait


def eventually(target: Page | Locator, check: Callable[..., Any], timeout_ms: float = UI_TIMEOUT_MS) -> Any:
    """Run check() once exactly as written (its own default or explicit timeout). On a live page that is the whole
    wait. On a paused page, if that first try fails, keep retrying check(TRY_MS) with the page clock moved STEP_MS
    between tries for up to timeout_ms more page time, then re-raise the last AssertionError."""
    page = target if isinstance(target, Page) else target.page
    if page not in _PAUSED:
        return check()
    try:
        return check()
    except AssertionError:
        pass
    tries = max(1, math.ceil(timeout_ms / STEP_MS))
    for attempt in range(tries):
        page.clock.run_for(STEP_MS)
        try:
            return check(TRY_MS)
        except AssertionError:
            if attempt == tries - 1:
                raise
    raise AssertionError("unreachable")


def ready(locator: Locator, state: str = "visible") -> Locator:
    """The locator, for the unchanged action chained on it: `ready(x).click()`. On a live page it returns at once (the
    action waits exactly as before). On a paused page it first waits, moving the page clock, until the locator is
    visible and enabled (state="attached": attached, the precondition of focus()); it never fails itself, the action
    that follows reports as it always did."""
    if locator.page not in _PAUSED:
        return locator

    def actionable(_t: float | None = None) -> None:
        if state == "attached":
            expect(locator).to_be_attached(timeout=_t)
        else:
            expect(locator).to_be_visible(timeout=_t)
            expect(locator).to_be_enabled(timeout=_t)

    try:
        eventually(locator, actionable)
    except Exception:
        pass
    return locator


_KIT_DIR = Path(conftest.__file__).resolve().parent


def kit(name: str) -> Any:
    if hasattr(conftest, name):
        return getattr(conftest, name)
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if f and Path(f).resolve().parent == _KIT_DIR and hasattr(mod, name):
            return getattr(mod, name)
    for p in sorted(_KIT_DIR.glob("*.py")):
        if p.stem.startswith("test_"):
            continue
        try:
            mod = importlib.import_module(p.stem)
        except Exception:
            continue
        if hasattr(mod, name):
            return getattr(mod, name)
    pytest.fail(f"verifier helper {name} is not available")


BASE = ""


@pytest.fixture(autouse=True)
def _base_url(app_url: str) -> Iterator[None]:
    global BASE
    BASE = app_url.rstrip("/")
    yield


def down_url() -> str:
    url = os.environ.get("APP_STORAGE_DOWN_URL")
    assert url, "APP_STORAGE_DOWN_URL names the storage-down instance (task outages)"
    return url.rstrip("/")


E1, E2, E3, E4 = (f"e{n:023d}" for n in range(1, 5))
E_IDS = [E1, E2, E3, E4]
DATE_MADE = {"$date": "2026-03-01T00:00:00Z"}
E_DOCS = [
    {"_id": E1, "sku": "POT-1", "price": 12, "tags": ["red", "blue"], "items": [{"sku": "S1", "qty": 2}, {"sku": "S2", "qty": 5}], "note": None},
    {"_id": E2, "sku": "POT-2", "price": 7.5, "tags": ["green"], "items": [{"sku": "S2", "qty": 1}]},
    {"_id": E3, "sku": "POT-3", "price": "12", "tags": [], "items": [], "note": "chipped"},
    {"_id": E4, "sku": "POT-4", "price": 20, "tags": ["red"], "items": [{"sku": "S3", "qty": 5}, {"sku": "S1", "qty": 9}], "made": DATE_MADE},
]

S_IDS = [f"b{n:023d}" for n in range(1, 10)]
_MISSING = object()
S_VALUES: list[Any] = [_MISSING, None, 3, "3", [5, 1], True, {"$date": "2026-01-01T00:00:00Z"}, {"a": 1}, []]


def s_docs(extra: dict | None = None) -> list[dict]:
    out = []
    for _id, v in zip(S_IDS, S_VALUES):
        d: dict[str, Any] = {"_id": _id}
        if v is not _MISSING:
            d["v"] = copy.deepcopy(v)
        d.update(extra or {})
        out.append(d)
    return out


def S(n: int) -> str:
    return S_IDS[n - 1]


def hexid(prefix: str, n: int) -> str:
    return f"{prefix}{n:0{24 - len(prefix)}x}"


def compact(doc: Any) -> str:
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False)


def nest(levels: int, inner: Any = None) -> dict:
    v: dict = {} if inner is None else dict(inner)
    for _ in range(levels - 1):
        v = {"k": v}
    return v


def doc_of_size(_id: str, size: int) -> dict:
    base_len = len(compact({"_id": _id, "pad": ""}).encode())
    n, rem = divmod(size - base_len, 2)
    doc = {"_id": _id, "pad": "é" * n + "a" * rem}
    assert len(compact(doc).encode()) == size
    return doc


def matched_text(m: int, s: int) -> str:
    if m == 0:
        return "No documents matched"
    return f"{m} {'document' if m == 1 else 'documents'} matched, {s} shown"


def docs_word(n: int) -> str:
    return "document" if n == 1 else "documents"


def stage_status(n: int, total: int, count: int) -> str:
    return f"Stage {n} of {total}: {count} {docs_word(count)} out"


NOBODY = object()


class Api:
    def __init__(self, base: str | None = None):
        self.base = (base or BASE).rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)

    def req(self, method: str, path: str, body: Any = NOBODY, **kw: Any) -> httpx.Response:
        if body is not NOBODY:
            kw["json"] = body
        return self.http.request(method, path, **kw)

    def j(self, method: str, path: str, body: Any = NOBODY, status: int = 200, **kw: Any) -> Any:
        r = self.req(method, path, body, **kw)
        assert r.status_code == status, f"{method} {path} answered {r.status_code}, expected {status}: {r.text[:500]}"
        return r.json() if r.content else None

    def signin(self, person: dict) -> "Api":
        self.j("POST", "/api/auth/signin", {"email": person["email"], "password": person["password"]}, 200)
        return self


def refused(r: httpx.Response, status: int, code: str, **extras: Any) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code}, got {body}"
    for k, v in extras.items():
        assert body.get(k) == v, f"error {code}: expected {k}={v!r}, got {body.get(k)!r} in {body}"
    return body


def seed(body: dict, base: str | None = None) -> dict:
    r = httpx.post(f"{(base or BASE).rstrip('/')}/api/grading/seed", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=SEED_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text[:500]}"
    return r.json()


def collection_spec(name: str, spec: Any) -> dict:
    spec = {"documents": spec} if isinstance(spec, list) else dict(spec)
    return {
        "name": name,
        "documents": spec.get("documents", []),
        "indexes": spec.get("indexes", []),
        "validator": spec.get("validator"),
        "saved_queries": spec.get("saved_queries", []),
    }


class World:

    def __init__(self, collections: dict[str, Any] | None = None, *, base: str | None = None, extra: tuple[str, ...] = ()):
        self.base = (base or BASE).rstrip("/")
        self.tag = uuid.uuid4().hex[:10]
        roles = ("owner", "editor", "reader", "outsider") + tuple(extra)
        self.people = {
            r: {"email": f"{r}-{self.tag}@jarful-tests.example", "password": f"Pw-{self.tag}-long", "name": f"{r.title()} {self.tag}"}
            for r in roles
        }
        self.owner, self.editor, self.reader, self.outsider = (self.people[r] for r in ("owner", "editor", "reader", "outsider"))
        cols = [collection_spec(n, s) for n, s in (collections or {"pots": []}).items()]
        self.project = f"Jar {self.tag}"
        self.other_project = f"Elsewhere {self.tag}"
        body = {
            "users": list(self.people.values()),
            "projects": [
                {"name": self.project, "owner": self.owner["email"],
                 "members": [{"email": self.editor["email"], "role": "editor"}, {"email": self.reader["email"], "role": "reader"}],
                 "collections": cols},
                {"name": self.other_project, "owner": self.outsider["email"], "members": [],
                 "collections": [collection_spec("elsewhere", [{"k": 1}])]},
            ],
        }
        out = seed(body, self.base)
        self.user_ids: dict[str, str] = out["users"]
        mine = out["projects"][self.project]
        self.pid = mine["id"]
        self.cols = mine["collections"]
        other = out["projects"][self.other_project]
        self.other_pid = other["id"]
        self.other = other["collections"]["elsewhere"]
        self._apis: dict[str, Api] = {}

    def __getitem__(self, role: str) -> dict:
        return self.people[role]

    def uid(self, role: str) -> str:
        return self.user_ids[self.people[role]["email"]]

    def cid(self, name: str) -> str:
        return self.cols[name]["id"]

    def C(self, name: str) -> str:
        return f"/api/projects/{self.pid}/collections/{self.cid(name)}"

    @property
    def P(self) -> str:
        return f"/api/projects/{self.pid}"

    def ui(self, name: str, suffix: str = "") -> str:
        return f"/p/{self.pid}/c/{self.cid(name)}{suffix}"

    def api(self, role: str, base: str | None = None) -> Api:
        key = f"{role}@{base or self.base}"
        if key not in self._apis:
            self._apis[key] = Api(base or self.base).signin(self.people[role])
        return self._apis[key]


def query(api: Api, C: str, **body: Any) -> dict:
    return api.j("POST", f"{C}/query", body, 200)


def agg(api: Api, C: str, pipeline: list, disabled: list | None = None, **extra: Any) -> dict:
    body = {"pipeline": pipeline, "disabled": disabled or []}
    body.update(extra)
    return api.j("POST", f"{C}/aggregate", body, 200)


def preview(api: Api, C: str, pipeline: list, disabled: list | None = None, pin: str | None = None) -> dict:
    body: dict[str, Any] = {"pipeline": pipeline, "disabled": disabled or [], "preview": True}
    if pin is not None:
        body["pin"] = pin
    return api.j("POST", f"{C}/aggregate", body, 200)


def put_draft(api: Api, C: str, stages: list, disabled: list | None = None) -> dict:
    return api.j("PUT", f"{C}/pipeline", {"stages": [compact(s) for s in stages], "disabled": disabled or []}, 200)


def draft_parsed(api: Api, C: str) -> tuple[list, list]:
    d = api.j("GET", f"{C}/pipeline")
    out = []
    for s in d["stages"]:
        try:
            out.append(json.loads(s))
        except ValueError:
            out.append(s)
    return out, d["disabled"]


def load_file(api: Api, C: str, data: bytes, fmt: str = "jsonl", name: str = "plants.jsonl") -> httpx.Response:
    return api.http.post(f"{C}/imports", params={"format": fmt}, content=data,
                         headers={"X-File-Name": name, "Content-Type": "application/octet-stream"})


def count_of(api: Api, C: str) -> int:
    return api.j("GET", C)["count"]


def imports_of(api: Api, C: str) -> list:
    body = api.j("GET", f"{C}/imports")
    if isinstance(body, dict):
        lists = [v for v in body.values() if isinstance(v, list)]
        assert len(lists) == 1, f"GET {C}/imports: expected one list in {body}"
        return lists[0]
    return body


def poll(check: Callable[[], Any], what: str, seconds: float = 10.0) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
        threading.Event().wait(POLL_INTERVAL_S)
    pytest.fail(f"{what} (gave up after {seconds}s; last {last!r})")


def fire_together(api: Api, requests: list[tuple[str, str, Any]]) -> list[httpx.Response]:
    clients = [httpx.Client(base_url=api.base, cookies=api.http.cookies, timeout=HTTP_TIMEOUT) for _ in requests]
    barrier = threading.Barrier(len(requests))

    def go(i: int) -> httpx.Response:
        method, path, body = requests[i]
        barrier.wait()
        return clients[i].request(method, path, json=body)

    with concurrent.futures.ThreadPoolExecutor(len(requests)) as ex:
        out = list(ex.map(go, range(len(requests))))
    for c in clients:
        c.close()
    return out


class EventStream:

    def __init__(self, api: Api, path: str, headers: dict | None = None, params: dict | None = None):
        self.events: list[dict[str, str]] = []
        self.cond = threading.Condition()
        self.status: int | None = None
        self.ctype = ""
        self.error: Exception | None = None
        self.closed = False
        self.opened = threading.Event()
        self.client = httpx.Client(base_url=api.base, cookies=api.http.cookies, timeout=httpx.Timeout(HTTP_TIMEOUT, read=120))
        self.thread = threading.Thread(target=self._run, args=(path, headers or {}, params), daemon=True)
        self.thread.start()

    def _run(self, path: str, headers: dict, params: dict | None) -> None:
        try:
            with self.client.stream("GET", path, headers=headers, params=params) as r:
                self.status = r.status_code
                self.ctype = r.headers.get("content-type", "")
                self.opened.set()
                if r.status_code != 200:
                    return
                ev: dict[str, str] = {}
                for line in r.iter_lines():
                    if self.closed:
                        break
                    if line == "":
                        if ev:
                            with self.cond:
                                self.events.append(ev)
                                self.cond.notify_all()
                        ev = {}
                    elif line.startswith(":"):
                        continue
                    else:
                        field, _, val = line.partition(":")
                        val = val[1:] if val.startswith(" ") else val
                        ev[field] = ev[field] + "\n" + val if field in ev else val
        except Exception as e:
            self.error = e
            self.opened.set()

    def changes(self) -> list[dict]:
        return [json.loads(e["data"]) | {"_event_id": e.get("id")} for e in self.events if e.get("event") == "change"]

    def roles(self) -> list[dict]:
        return [json.loads(e["data"]) for e in self.events if e.get("event") == "role"]

    def wait_for(self, pred: Callable[["EventStream"], bool], what: str, seconds: float = STREAM_WAIT_S) -> None:
        with self.cond:
            ok = self.cond.wait_for(lambda: pred(self), timeout=seconds)
        if not ok:
            pytest.fail(f"event stream: {what}; got {self.events!r} (error {self.error!r})")

    def close(self) -> None:
        self.closed = True
        self.client.close()


def sign_in_page(page: Page, person: dict, root: str) -> None:
    r = page.request.post(f"{root}/api/auth/signin", data={"email": person["email"], "password": person["password"]})
    assert r.status == 200, f"sign-in for {person['email']} answered {r.status}"


@contextmanager
def browse(browser: Browser, person: dict | None = None, path: str = "/", *, viewport: dict | None = None,
           reduced: str = "no-preference", live: bool = True, base: str | None = None) -> Iterator[Page]:
    root = (base or BASE).rstrip("/")
    with open_app(browser, root + "/", reduced_motion=reduced) as page:
        page.set_viewport_size(viewport or DESKTOP)
        if live:
            page.clock.resume()
        else:
            _PAUSED.add(page)
        if person is not None:
            sign_in_page(page, person, root)
        if path != "/":
            page.goto(root + path)
        yield page


def R(scope: Page | Locator, role: str, name: str | None = None) -> Locator:
    if name is None:
        return scope.get_by_role(role)
    return scope.get_by_role(role, name=name, exact=True)


CONTENT_JS = "e => (typeof e.value === 'string') ? e.value : e.innerText"


def content(loc: Locator) -> str:
    return loc.evaluate(CONTENT_JS)


def parsed(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def query_bar(page: Page) -> Locator:
    return R(page, "search", "Query bar")


def set_query(page: Page, filter: str = "{}", projection: str = "", sort: str = "") -> None:
    bar = query_bar(page)
    kit_fill(R(bar, "textbox", "Filter"), filter)
    kit_fill(R(bar, "textbox", "Projection"), projection)
    kit_fill(R(bar, "textbox", "Sort"), sort)


def run_query(page: Page, filter: str = "{}", projection: str = "", sort: str = "") -> None:
    set_query(page, filter, projection, sort)
    ready(R(query_bar(page), "button", "Run")).click()


def qstatus(page: Page) -> Locator:
    return R(page, "status", "Query status")


IDS_JS = "els => els.map(e => e.getAttribute('data-doc-id'))"


def list_ids(page: Page) -> list[str]:
    return R(page, "list", "Documents").locator("[data-doc-id]").evaluate_all(IDS_JS)


ROW_IDS_JS = "g => [...g.querySelectorAll('[data-doc-id]')].filter(e => !e.hasAttribute('data-field-path')).map(e => e.getAttribute('data-doc-id'))"
HEADER_PATHS_JS = "g => [...g.querySelectorAll('[data-field-path]')].filter(e => !e.hasAttribute('data-doc-id')).map(e => e.getAttribute('data-field-path'))"


def grid_row_ids(page: Page) -> list[str]:
    return R(page, "grid", "Documents").evaluate(ROW_IDS_JS)


def grid_headers(page: Page) -> list[str]:
    return R(page, "grid", "Documents").evaluate(HEADER_PATHS_JS)


def expect_ids(page: Page, getter: Callable[[Page], list[str]], want: list[str], what: str) -> None:
    poll(lambda: getter(page) == want, f"{what}: expected rows {want}, saw {getter(page)}")


ACTIVE_JS = """() => { const e = document.activeElement; if (!e) return {};
  const c = e.closest('[data-doc-id]');
  return {doc: e.getAttribute('data-doc-id'), field: e.getAttribute('data-field-path'), within: c ? c.getAttribute('data-doc-id') : null}; }"""


def active(page: Page) -> dict:
    return page.evaluate(ACTIVE_JS)


def tab_to_grid_cell(page: Page, presses: int = 40) -> dict:
    for _ in range(presses):
        page.keyboard.press("Tab")
        a = active(page)
        if a.get("doc") and a.get("field"):
            return a
    pytest.fail("Tab never reached a grid cell carrying data-doc-id and data-field-path (L246)")


def lines_of(loc: Locator) -> list[str]:
    return [ln.strip() for ln in loc.inner_text().splitlines() if ln.strip()]


def expect_lines(loc: Locator, want: list[str], what: str, seconds: float = 10.0) -> None:
    deadline = time.monotonic() + seconds
    got: list[str] = []
    while time.monotonic() < deadline:
        got = lines_of(loc)
        if got == want:
            return
        threading.Event().wait(POLL_INTERVAL_S)
    pytest.fail(f"{what}: expected lines {want}, saw {got}")


def editor_box(page: Page) -> Locator:
    return R(page, "textbox", "Document JSON")


def expect_editor_doc(page: Page, check: Callable[[Any], bool], what: str) -> Any:
    return poll(lambda: (lambda d: d if d is not None and check(d) else None)(parsed(content(editor_box(page)))), what)


def save_status(page: Page) -> Locator:
    return R(page, "status", "Save status")


def replace_text(page: Page, box: Locator, text: str) -> None:
    ready(box, "attached").focus()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text(text)


def focus_inside(loc: Locator) -> bool:
    return loc.evaluate("b => b === document.activeElement || b.contains(document.activeElement)")


SIEVE_JS = """(scope) => [...scope.querySelectorAll('[data-stage-index]')].map(card => {
  const track = card.querySelector('[data-sieve-track]');
  const bar = card.querySelector('[data-sieve-bar]');
  return {index: Number(card.getAttribute('data-stage-index')), count: card.getAttribute('data-stage-count'),
    capped: card.getAttribute('data-capped'), disabled: card.getAttribute('data-disabled'),
    track: track ? track.getBoundingClientRect().width : null,
    bar: bar ? bar.getBoundingClientRect().width : null,
    overflow: bar ? bar.getAttribute('data-overflow') : null, text: card.innerText};
})"""

COUNTS_JS = """(want) => { const c = [...document.querySelectorAll('[data-stage-index]')];
  return c.length === want.length && c.every((e, i) => e.getAttribute('data-stage-count') === String(want[i])); }"""

SAMPLER_JS = """() => {
  const seen = new Map();
  window.__sieveFrames = [];
  const frame = () => {
    const now = performance.now();
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) { seen.set(a, now); try { a.pause(); } catch (e) {} }
      try { a.currentTime = now - seen.get(a); } catch (e) {}
    }
    const cards = [...document.querySelectorAll('[data-stage-index]')];
    window.__sieveFrames.push({t: now, bands: cards.map(c => {
      const bar = c.querySelector('[data-sieve-bar]');
      return {w: bar ? bar.getBoundingClientRect().width : null, text: c.innerText};
    })});
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}"""


def sieve(scope: Locator) -> list[dict]:
    return scope.evaluate(SIEVE_JS)


def bar_width(track: float, out: int, inp: int) -> float:
    if inp == 0:
        return 0.0
    return track * min(1.0, math.log(1 + out) / math.log(1 + inp))


def assert_bars(bands: list[dict], counts: list[int], inp: int, disabled: set[int], what: str) -> None:
    assert len(bands) == len(counts), f"{what}: expected {len(counts)} bands, saw {bands}"
    for b, out in zip(bands, counts):
        i = b["index"]
        assert b["count"] == str(out), f"{what}: band {i} data-stage-count {b['count']}, expected {out}"
        assert b["track"] is not None, f"{what}: band {i} has no data-sieve-track"
        if i in disabled:
            assert b["disabled"] == "true" and b["bar"] is None, f"{what}: disabled band {i} must draw no data-sieve-bar ({b})"
            continue
        assert b["disabled"] == "false", f"{what}: band {i} data-disabled {b['disabled']}"
        assert b["bar"] is not None, f"{what}: band {i} has no data-sieve-bar"
        want = bar_width(b["track"], out, inp)
        assert abs(b["bar"] - want) <= BAR_TOLERANCE_PX, f"{what}: band {i} bar {b['bar']:.1f}px, expected {want:.1f}px"
        assert b["overflow"] == ("true" if out > inp else "false"), f"{what}: band {i} data-overflow {b['overflow']}"


def series(frames: list[dict], j: int) -> list[tuple[float, float]]:
    return [(f["t"], f["bands"][j]["w"]) for f in frames if len(f["bands"]) > j and f["bands"][j]["w"] is not None]


def first_move(ser: list[tuple[float, float]], old: float) -> float | None:
    return next((t for t, w in ser if abs(w - old) > 0.5), None)


def width_at(ser: list[tuple[float, float]], t: float) -> float:
    for tt, w in ser:
        if tt >= t:
            return w
    return ser[-1][1]


def wait_settled(page: Page, counts: list[int]) -> None:
    until(page, COUNTS_JS, counts)
    advance(page, SETTLE_MS)


def stage_response(r: Any) -> bool:
    return r.url.endswith("/aggregate") and r.request.method == "POST"


def check_trap(page: Page, opener: Locator, role: str, name: str, presses: int = 8) -> None:
    ready(opener, "attached").focus()
    page.keyboard.press("Enter")
    box = R(page, role, name)
    eventually(box, lambda _t=None: expect(box).to_be_visible(timeout=_t))
    poll(lambda: focus_inside(box), f"opening {role} {name!r} moves focus inside it")
    for key in ["Tab"] * presses + ["Shift+Tab"] * presses:
        page.keyboard.press(key)
        assert focus_inside(box), f"{key} escaped the open {role} {name!r} (L271)"
    page.keyboard.press("Escape")
    eventually(box, lambda _t=None: expect(box).to_have_count(0, timeout=_t))
    eventually(opener, lambda _t=None: expect(opener).to_be_focused(timeout=_t))


def last_run_line(iso: str, count: int) -> str:
    return f"Last run {iso[:10]} {iso[11:16]} UTC, {count} {docs_word(count)} matched"


def inbox(mail: Any, email: str, at_least: int = 1) -> list[dict]:
    addresses = kit("addresses")
    deadline = time.monotonic() + MAIL_WAIT_S
    got: list[dict] = []
    while time.monotonic() < deadline:
        got = [m for m in mail.messages(0, 0.5) if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(got) >= at_least:
            return got
    pytest.fail(f"Mailpit: expected {at_least} message(s) to {email}, saw {len(got)}")


def mail_text(m: dict) -> str:
    return kit("text")(m)


def code_in(m: dict) -> str:
    found = re.search(r"Your code is (\d{6})", mail_text(m))
    assert found, f"sign-up mail has no 'Your code is <six digits>' line: {mail_text(m)[:300]}"
    return found.group(1)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["PORT"] = str(port)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    url = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-3000:].decode("utf-8", "replace")

    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        up = False
        while time.monotonic() < deadline and not up:
            try:
                httpx.get(url + "/api/health", timeout=3)
                up = True
                continue
            except httpx.HTTPError:
                pass
            try:
                proc.wait(timeout=0.5)
                pytest.fail(f"app copy exited with {proc.returncode} before listening:\n{tail()}")
            except subprocess.TimeoutExpired:
                pass
        if not up:
            pytest.fail(f"app copy never listened on {url}:\n{tail()}")
        yield url
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=15)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                pass
        log.close()


DP01_CASES = [
    ({"price": 12}, [1]), ({"price": {"$eq": 12}}, [1]), ({"price": 12.0}, [1]),
    ({"price": {"$ne": 12}}, [2, 3, 4]), ({"price": {"$gt": 10}}, [1, 4]), ({"price": {"$gte": 12}}, [1, 4]),
    ({"price": {"$lt": 12}}, [2]), ({"price": {"$lte": 7.5}}, [2]),
    ({"sku": {"$in": ["POT-1", "POT-3"]}}, [1, 3]), ({"tags": {"$nin": ["red"]}}, [2, 3]),
    ({"made": {"$gte": {"$date": "2026-01-01T00:00:00Z"}}}, [4]),
]
DP02_CASES = [
    ({"$and": [{"price": {"$gt": 5}}, {"tags": "red"}]}, [1, 4]),
    ({"$or": [{"price": 7.5}, {"note": "chipped"}]}, [2, 3]),
    ({"$nor": [{"tags": "red"}, {"price": 7.5}]}, [3]),
    ({"price": {"$not": {"$gt": 10}}}, [2, 3]),
]
DP03_CASES = [
    ({"tags": {"$size": 1}}, [2, 4]), ({"tags": {"$size": 0}}, [3]), ({"tags": "red"}, [1, 4]),
    ({"tags": ["red", "blue"]}, [1]), ({"tags": ["blue", "red"]}, []), ({"items.0.sku": "S2"}, [2]),
    ({"items.sku": "S1", "items.qty": 5}, [1, 4]), ({"items": {"$elemMatch": {"sku": "S1", "qty": 5}}}, []),
    ({"items": {"$elemMatch": {"sku": "S1", "qty": {"$gt": 5}}}}, [4]),
    ({"items.qty": {"$gt": 3, "$lt": 4}}, [1]), ({"items": {"$elemMatch": {"qty": {"$gt": 3, "$lt": 4}}}}, []),
]
DP04_CASES = [
    ({"note": {"$exists": True}}, [1, 3]), ({"note": {"$exists": False}}, [2, 4]),
    ({"note": None}, [1, 2, 4]), ({"note": {"$ne": None}}, [3]), ({"note": {"$in": [None]}}, [1, 2, 4]),
]


def check_filter_cases(cases: list) -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")
    wrong = []
    for flt, ns in cases:
        r = api.req("POST", f"{C}/query", {"filter": flt})
        want = [E_IDS[n - 1] for n in ns]
        if r.status_code != 200:
            wrong.append((flt, want, f"HTTP {r.status_code} {r.text[:150]}"))
            continue
        body = r.json()
        if body.get("ids") != want or body.get("matched") != len(want):
            wrong.append((flt, want, body.get("ids"), body.get("matched")))
    assert not wrong, "filters over example collection E gave wrong matches (filter, expected, got): " + repr(wrong)


def test_filter_comparison_operators() -> None:
    check_filter_cases(DP01_CASES)


def test_filter_logical_operators_and_refusals() -> None:
    check_filter_cases(DP02_CASES)
    w = World({"pots": E_DOCS})
    api, C = w.api("owner"), w.C("pots")
    for flt, op in [({"price": {"$regex": "1"}}, "$regex"), ({"$where": "1"}, "$where"), ({"$expr": {}}, "$expr"),
                    ({"$function": {}}, "$function"), ({"items": {"$elemMatch": {"qty": {"$mod": [2, 0]}}}}, "$mod")]:
        refused(api.req("POST", f"{C}/query", {"filter": flt}), 422, "unknown_operator", operator=op)
    for flt in [{"$and": []}, {"$or": {"a": 1}}, {"price": {"$in": 5}}, {"tags": {"$size": -1}},
                {"note": {"$exists": "yes"}}, {"price": {"$not": 5}}]:
        refused(api.req("POST", f"{C}/query", {"filter": flt}), 422, "invalid_query", field="filter")


def test_filter_array_matching() -> None:
    check_filter_cases(DP03_CASES)


def test_filter_missing_and_null_fields() -> None:
    check_filter_cases(DP04_CASES)


def test_document_rules_on_insert_edit_and_load() -> None:
    keep = hexid("a", 1)
    w = World({"docs": [{"_id": keep, "keep": 1}]})
    api, C = w.api("owner"), w.C("docs")
    big = doc_of_size(hexid("a", 3), MAX_DOC_BYTES + 1)
    refusals = [
        ({"_id": "ABC", "x": 1}, "invalid_id", {}),
        ({"_id": "E0000000000000000000000A", "x": 1}, "invalid_id", {}),
        ({"_id": "e" * 23, "x": 1}, "invalid_id", {}),
        ({"_id": "XYZ", "$bad": 1}, "invalid_id", {}),
        ({"meta": {"$bad": 1}}, "invalid_field_name", {"path": "meta.$bad"}),
        ({"ok": 1, "$set": 2}, "invalid_field_name", {"path": "$set"}),
        ({"x": {"a.b": 1}}, "invalid_field_name", {"path": "x.a.b"}),
        (dict(big, **{"$bad": 1}), "invalid_field_name", {"path": "$bad"}),
        (big, "document_too_large", {"limit": MAX_DOC_BYTES}),
        (dict(doc_of_size(hexid("a", 4), MAX_DOC_BYTES + 1), deep=nest(MAX_DEPTH)), "document_too_large", {"limit": MAX_DOC_BYTES}),
        ({"a": nest(MAX_DEPTH)}, "document_too_deep", {"limit": MAX_DEPTH}),
    ]
    for doc, code, extras in refusals:
        refused(api.req("POST", f"{C}/documents", {"document": doc}), 422, code, **extras)
    assert count_of(api, C) == 1, "a refused insert added a document"
    accepted = [
        doc_of_size(hexid("a", 5), MAX_DOC_BYTES),
        {"_id": hexid("a", 6), "a": nest(MAX_DEPTH - 1)},
        {"_id": hexid("a", 7), "a": nest(MAX_DEPTH - 1, {"when": {"$date": "2026-03-01T00:00:00.123Z"}})},
    ]
    for doc in accepted:
        got = api.j("POST", f"{C}/documents", {"document": doc}, 201)
        assert got["version"] == 1 and got["document"]["_id"] == doc["_id"]
    fresh = api.j("POST", f"{C}/documents", {"document": {"x": True}}, 201)["document"]
    assert re.fullmatch(r"[0-9a-f]{24}", fresh["_id"]), f"assigned _id {fresh['_id']!r} is not 24 lowercase hex"
    for doc, code, extras in [({"_id": keep, "$x": 1}, "invalid_field_name", {"path": "$x"}),
                              (doc_of_size(keep, MAX_DOC_BYTES + 1), "document_too_large", {"limit": MAX_DOC_BYTES}),
                              ({"_id": keep, "a": nest(MAX_DEPTH)}, "document_too_deep", {"limit": MAX_DEPTH})]:
        refused(api.req("PUT", f"{C}/documents/{keep}", {"document": doc, "version": 1}), 422, code, **extras)
    stored = api.j("GET", f"{C}/documents/{keep}")
    assert stored["version"] == 1 and stored["document"] == {"_id": keep, "keep": 1}, "a refused edit changed the document"
    lines = [compact({"_id": hexid("a", 20), "ok": 1}), compact({"_id": "BAD", "x": 1}), compact({"$x": 1}),
             compact(doc_of_size(hexid("a", 21), MAX_DOC_BYTES + 1)), compact({"a": nest(MAX_DEPTH)})]
    before = count_of(api, C)
    body = refused(load_file(api, C, ("\n".join(lines) + "\n").encode()), 422, "import_failed")
    assert body["errors"] == [
        {"line": 2, "message": "invalid _id"},
        {"line": 3, "message": "invalid field name at $x"},
        {"line": 4, "message": f"document is larger than {MAX_DOC_BYTES} bytes"},
        {"line": 5, "message": f"document is nested deeper than {MAX_DEPTH} levels"},
    ], body
    assert count_of(api, C) == before


def test_query_status_announces_match_text(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        run_query(page, '{"sku":"POT-2"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(1, 1), timeout=_t))
        run_query(page, '{"price":{"$gt":10}}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("2 documents matched, 2 shown", timeout=_t))
        set_query(page, '{"sku":"nope"}')
        with held(page, "**/query") as gate:
            ready(R(query_bar(page), "button", "Run")).click()
            eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("Running query", timeout=_t))
            gate.release()
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("No documents matched", timeout=_t))
    assert query(w.api("owner"), w.C("pots"), filter={"price": {"$gt": 10}})["matched"] == 2


def test_wf_array_filters_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        set_query(page, '{"items.sku":"S1","items.qty":5}')
        ready(R(query_bar(page), "button", "Run"), "attached").focus()
        page.keyboard.press("Control+Enter")
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
        expect_ids(page, list_ids, [E1, E4], "list after array filter")
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, [E1, E4], "grid after array filter")
        tab_to_grid_cell(page)
        assert active(page)["doc"] == E1
        page.keyboard.press("ArrowDown")
        assert active(page)["doc"] == E4
        page.keyboard.press("Enter")
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", f"/d/{E4}")) + "$"), timeout=_t))
        expect_editor_doc(page, lambda d: d.get("sku") == "POT-4", "editor shows matched document E4")
    assert query(w.api("owner"), w.C("pots"), filter={"items.sku": "S1", "items.qty": 5})["ids"] == [E1, E4]


def test_wf_array_filters_recovery(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        run_query(page, '{"tags":{"$all":["red"]}}')
        eventually(R(page, "alert", "Query error"), lambda _t=None: expect(R(page, "alert", "Query error")).to_have_text(f"Unknown operator {UNKNOWN_OP}", timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("Query not run", timeout=_t))
        set_query(page, '{"tags":"red"}')
        ready(R(query_bar(page), "textbox", "Filter"), "attached").focus()
        page.keyboard.press("Control+Enter")
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
        eventually(page.get_by_text(f"Unknown operator {UNKNOWN_OP}", exact=True), lambda _t=None: expect(page.get_by_text(f"Unknown operator {UNKNOWN_OP}", exact=True)).to_have_count(0, timeout=_t))
        expect_ids(page, list_ids, [E1, E4], "list after the fixed filter")
    refused(w.api("owner").req("POST", f"{w.C('pots')}/query", {"filter": {"tags": {"$all": ["red"]}}}), 422, "unknown_operator", operator="$all")


def test_wf_array_filters_grid_return(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        run_query(page, '{"tags":"red"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, [E1, E4], "red-tagged rows")
        a = tab_to_grid_cell(page)
        assert (a["doc"], a["field"]) == (E1, "_id"), f"first tab stop in grid is {a}"
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        assert (active(page)["doc"], active(page)["field"]) == (E4, "items")
        page.keyboard.press("Enter")
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", f"/d/{E4}")) + "$"), timeout=_t))
        expect_editor_doc(page, lambda d: d.get("_id") == E4, "Enter opens E4")
        ready(R(page, "button", "Close")).click()
        poll(lambda: (active(page).get("doc"), active(page).get("field")) == (E4, "items"),
             "Close returns focus to the grid cell that opened the editor (L252)")
        page.keyboard.press("ArrowLeft")
        assert (active(page)["doc"], active(page)["field"]) == (E4, "_id"), "grid keys keep working from the returned cell"


X1, X2, X3 = (f"b{n:023d}" for n in (10, 11, 12))
MIXED_DOCS = s_docs({"w": 0}) + [{"_id": X1, "v": 3, "w": 1}, {"_id": X2, "v": 3, "w": 2}, {"_id": X3, "v": None, "w": 5}]
MIXED_ORDER = [X3, S(1), S(2), S(9), S(5), X2, X1, S(3), S(4), S(8), S(6), S(7)]


def test_comparison_order_in_sort() -> None:
    w = World({"mixed": s_docs()})
    api, C = w.api("reader"), w.C("mixed")
    asc = [S(n) for n in (1, 2, 9, 5, 3, 4, 8, 6, 7)]
    desc = [S(n) for n in (7, 6, 8, 4, 5, 3, 1, 2, 9)]
    assert query(api, C, sort={"v": 1})["ids"] == asc
    assert query(api, C, sort={"v": -1})["ids"] == desc
    got = [d["_id"] for d in agg(api, C, [{"$sort": {"v": 1}}], page=1)["documents"]]
    assert got == asc, f"$sort ascending gave {got}"


def test_multi_key_sort_and_ties() -> None:
    T = [f"c{n:023d}" for n in range(1, 6)]
    docs = [{"_id": T[0], "a": 1, "b": 2}, {"_id": T[1], "a": 1, "b": 1}, {"_id": T[2], "a": 0, "b": 5},
            {"_id": T[3], "a": 1, "b": 1}, {"_id": T[4], "a": [0, 9], "b": 0}]
    w = World({"multi": docs})
    api, C = w.api("reader"), w.C("multi")
    assert query(api, C, sort={"a": 1, "b": -1})["ids"] == [T[2], T[4], T[0], T[1], T[3]]
    assert query(api, C, sort={"a": -1, "b": 1})["ids"] == [T[4], T[1], T[3], T[0], T[2]]
    assert query(api, C, sort={"b": -1})["ids"] == [T[2], T[0], T[1], T[3], T[4]]
    assert query(api, C)["ids"] == T
    refused(api.req("POST", f"{C}/query", {"sort": {"a": 2}}), 422, "invalid_query", field="sort")


def test_result_pages_and_keyboard_pager(browser: Browser) -> None:
    n = 2 * PAGE_SIZE + 3
    docs = [{"_id": hexid("d", i), "i": i} for i in range(1, n + 1)]
    w = World({"paged": docs})
    api, C = w.api("owner"), w.C("paged")
    p1 = query(api, C, page=1)
    assert p1["matched"] == n and p1["page_size"] == PAGE_SIZE and p1["page"] == 1
    assert p1["ids"] == [d["_id"] for d in docs[:PAGE_SIZE]]
    p3 = query(api, C, page=3)
    assert p3["ids"] == [d["_id"] for d in docs[2 * PAGE_SIZE:]]
    assert query(api, C, page=4)["ids"] == []
    capped = query(api, C, limit=PAGE_SIZE + 5, page=2)
    assert capped["matched"] == PAGE_SIZE + 5 and len(capped["ids"]) == 5
    assert query(api, C, limit=0)["matched"] == n
    for body, field in [({"page": 0}, "page"), ({"page": 1.5}, "page"), ({"limit": -1}, "limit"), ({"limit": 2.5}, "limit")]:
        refused(api.req("POST", f"{C}/query", body), 422, "invalid_query", field=field)
    with browse(browser, w.owner, w.ui("paged")) as page:
        eventually(page.get_by_text("Page 1 of 3", exact=True), lambda _t=None: expect(page.get_by_text("Page 1 of 3", exact=True)).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Previous page"), lambda _t=None: expect(R(page, "button", "Previous page")).to_be_disabled(timeout=_t))
        nxt = R(page, "button", "Next page")
        ready(nxt, "attached").focus()
        page.keyboard.press("Enter")
        eventually(page.get_by_text("Page 2 of 3", exact=True), lambda _t=None: expect(page.get_by_text("Page 2 of 3", exact=True)).to_be_visible(timeout=_t))
        eventually(nxt, lambda _t=None: expect(nxt).to_be_focused(timeout=_t))
        expect_ids(page, list_ids, query(api, C, page=2)["ids"], "page 2 rows")
        page.keyboard.press("Enter")
        eventually(page.get_by_text("Page 3 of 3", exact=True), lambda _t=None: expect(page.get_by_text("Page 3 of 3", exact=True)).to_be_visible(timeout=_t))
        eventually(nxt, lambda _t=None: expect(nxt).to_be_disabled(timeout=_t))
        prev = R(page, "button", "Previous page")
        ready(prev, "attached").focus()
        page.keyboard.press("Enter")
        eventually(page.get_by_text("Page 2 of 3", exact=True), lambda _t=None: expect(page.get_by_text("Page 2 of 3", exact=True)).to_be_visible(timeout=_t))
        eventually(prev, lambda _t=None: expect(prev).to_be_focused(timeout=_t))


def test_phone_workspace_tabs(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots"), viewport=PHONE) as page:
        q, res, pipe = R(page, "tab", "Query"), R(page, "tab", "Results"), R(page, "tab", "Pipeline")
        eventually(q, lambda _t=None: expect(q).to_have_attribute("aria-selected", "true", timeout=_t))
        eventually(R(query_bar(page), "textbox", "Filter"), lambda _t=None: expect(R(query_bar(page), "textbox", "Filter")).to_be_visible(timeout=_t))
        url = page.url
        ready(q, "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(res, lambda _t=None: expect(res).to_have_attribute("aria-selected", "true", timeout=_t))
        eventually(res, lambda _t=None: expect(res).to_be_focused(timeout=_t))
        eventually(R(page, "list", "Documents"), lambda _t=None: expect(R(page, "list", "Documents")).to_be_visible(timeout=_t))
        page.keyboard.press("ArrowRight")
        eventually(pipe, lambda _t=None: expect(pipe).to_have_attribute("aria-selected", "true", timeout=_t))
        eventually(R(page, "button", "Add stage"), lambda _t=None: expect(R(page, "button", "Add stage")).to_be_visible(timeout=_t))
        page.keyboard.press("ArrowLeft")
        eventually(res, lambda _t=None: expect(res).to_have_attribute("aria-selected", "true", timeout=_t))
        assert page.url == url, "switching tabs must not change the address"
        page.goto(BASE + w.ui("pots", "/pipeline"))
        eventually(R(page, "tab", "Pipeline"), lambda _t=None: expect(R(page, "tab", "Pipeline")).to_have_attribute("aria-selected", "true", timeout=_t))
        page.set_viewport_size(TABLET)
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_have_count(0, timeout=_t))


def test_wf_mixed_sort_happy(browser: Browser) -> None:
    w = World({"mixed": MIXED_DOCS})
    with browse(browser, w.owner, w.ui("mixed")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(12, min(12, PAGE_SIZE)), timeout=_t))
        run_query(page, sort='{"v":1,"w":-1}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(12, min(12, PAGE_SIZE)), timeout=_t))
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, MIXED_ORDER[:PAGE_SIZE], "sorted page 1")
        nxt = R(page, "button", "Next page")
        ready(nxt, "attached").focus()
        page.keyboard.press("Enter")
        eventually(page.get_by_text("Page 2 of 2", exact=True), lambda _t=None: expect(page.get_by_text("Page 2 of 2", exact=True)).to_be_visible(timeout=_t))
        expect_ids(page, grid_row_ids, MIXED_ORDER[PAGE_SIZE:2 * PAGE_SIZE], "sorted page 2")
        eventually(nxt, lambda _t=None: expect(nxt).to_be_disabled(timeout=_t))
        eventually(R(page, "button", "Previous page"), lambda _t=None: expect(R(page, "button", "Previous page")).to_be_enabled(timeout=_t))
    assert query(w.api("owner"), w.C("mixed"), sort={"v": 1, "w": -1}, page=2)["ids"] == MIXED_ORDER[PAGE_SIZE:2 * PAGE_SIZE]


def test_wf_mixed_sort_phone(browser: Browser) -> None:
    w = World({"mixed": MIXED_DOCS})
    with browse(browser, w.owner, w.ui("mixed"), viewport=PHONE) as page:
        eventually(R(page, "tab", "Query"), lambda _t=None: expect(R(page, "tab", "Query")).to_have_attribute("aria-selected", "true", timeout=_t))
        layout(page)
        set_query(page, sort='{"v":1,"w":-1}')
        tap(R(query_bar(page), "button", "Run"))
        res = R(page, "tab", "Results")
        eventually(res, lambda _t=None: expect(res).to_have_attribute("aria-selected", "true", timeout=_t))
        eventually(res, lambda _t=None: expect(res).to_be_focused(timeout=_t))
        expect_ids(page, list_ids, MIXED_ORDER[:PAGE_SIZE], "phone Results tab order")
        page.set_viewport_size(TABLET)
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_have_count(0, timeout=_t))
        layout(page)
        page.set_viewport_size(DESKTOP)
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_have_count(0, timeout=_t))
    assert query(w.api("owner"), w.C("mixed"), sort={"v": 1, "w": -1})["ids"] == MIXED_ORDER[:PAGE_SIZE]


def test_results_grid_keyboard(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ready(R(page, "radio", "Table")).click()
        grid = R(page, "grid", "Documents")
        cells = grid.locator("[data-doc-id][data-field-path]")
        eventually(cells.first, lambda _t=None: expect(cells.first).to_be_visible(timeout=_t))
        headers = grid_headers(page)
        assert headers == ["_id", "items", "made", "note", "price", "sku", "tags"], f"grid columns {headers}"
        tabbable = "els => els.filter(e => e.tabIndex >= 0).length"
        assert cells.evaluate_all(tabbable) == 1, "exactly one grid cell must be in the tab order"
        ready(R(page, "radio", "Table"), "attached").focus()
        a = tab_to_grid_cell(page)
        assert (a["doc"], a["field"]) == (E1, "_id"), f"first tab stop in grid is {a}"
        page.keyboard.press("ArrowRight")
        assert (active(page)["doc"], active(page)["field"]) == (E1, "items")
        page.keyboard.press("End")
        assert active(page)["field"] == "tags"
        page.keyboard.press("Home")
        assert active(page)["field"] == "_id"
        page.keyboard.press("ArrowDown")
        assert (active(page)["doc"], active(page)["field"]) == (E2, "_id")
        assert cells.evaluate_all(tabbable) == 1, "roving tab stop must stay single after moving"
        page.keyboard.press("Enter")
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", f"/d/{E2}")) + "$"), timeout=_t))
        expect_editor_doc(page, lambda d: d.get("_id") == E2 and d.get("sku") == "POT-2", "Enter opens E2 in the editor")


def test_projection_rules() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")
    one = {"_id": E1}

    def first(proj: dict) -> dict:
        return query(api, C, filter=one, projection=proj)["documents"][0]

    d = first({"sku": 1, "items.sku": 1})
    assert d == {"_id": E1, "sku": "POT-1", "items": [{"sku": "S1"}, {"sku": "S2"}]} and list(d) == ["_id", "sku", "items"]
    d = first({"sku": 1, "_id": 0})
    assert d == {"sku": "POT-1"}
    assert query(api, C, filter=one, projection={"sku": 1, "_id": 0})["ids"] == [E1], "ids must list _id whatever the projection"
    d = first({"items": 0, "tags": 0, "note": 0})
    assert d == {"_id": E1, "sku": "POT-1", "price": 12} and list(d) == ["_id", "sku", "price"]
    assert first({"made": 1}) == {"_id": E1}, "missing included paths are left out"
    for proj in [{"sku": 1, "price": 0}, {"sku": "x"}, {"sku": 2}]:
        refused(api.req("POST", f"{C}/query", {"projection": proj}), 422, "invalid_projection")


NUM_ID = hexid("f", 1)
NUM_DOC = {"_id": NUM_ID, "a": 1234567, "b": 3.14159265, "c": 0.000123456789, "d": 2.5, "e": 13.1666666667,
           "f": 1234567.891, "g": -0.5, "h": 2.0, "t": DATE_MADE, "s": "plain", "o": {"x": 3.14159265, "y": [0.000123456789]}}
NUM_LINES = ["a: 1234567", "b: 3.14159", "c: 0.000123457", "d: 2.5", "e: 13.1667", "f: 1234570", "g: -0.5", "h: 2",
             "t: 2026-03-01T00:00:00Z", "s: plain", 'o: {"x":3.14159,"y":[0.000123457]}']


def test_number_and_date_display(browser: Browser) -> None:
    w = World({"nums": [NUM_DOC]})
    put_draft(w.api("owner"), w.C("nums"), [{"$match": {}}])
    with browse(browser, w.owner, w.ui("nums")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(1, 1), timeout=_t))
        item = R(page, "list", "Documents").locator(f'[data-doc-id="{NUM_ID}"]')
        eventually(item, lambda _t=None: expect(item).to_be_visible(timeout=_t))
        lines = [ln.strip() for ln in item.inner_text().splitlines()]
        missing = [ln for ln in NUM_LINES if ln not in lines]
        assert not missing, f"list item lacks display lines {missing}; saw {lines}"
        ready(R(page, "radio", "Table")).click()
        for field, want in [("b", "3.14159"), ("c", "0.000123457"), ("f", "1234570"), ("h", "2"), ("t", "2026-03-01T00:00:00Z"), ("s", "plain")]:
            eventually(R(page, "grid", "Documents").locator(f'[data-doc-id="{NUM_ID}"][data-field-path="{field}"]'), lambda _t=None: expect(R(page, "grid", "Documents").locator(f'[data-doc-id="{NUM_ID}"][data-field-path="{field}"]')).to_have_text(want, timeout=_t))
        ready(R(page, "radio", "JSON")).click()
        block = R(page, "region", "JSON results").locator(f'[data-doc-id="{NUM_ID}"]')
        eventually(block, lambda _t=None: expect(block).to_be_visible(timeout=_t))
        txt = block.inner_text()
        assert "3.14159" in txt and "3.14159265" not in txt and "1234570" in txt and '"$date"' in txt and "2026-03-01T00:00:00Z" in txt, txt
        item_click = R(page, "radio", "List")
        ready(item_click).click()
        ready(R(page, "list", "Documents").locator(f'[data-doc-id="{NUM_ID}"]')).click()
        expect_editor_doc(page, lambda d: d.get("b") == 3.14159265, "editor keeps full precision")
        page.goto(BASE + w.ui("nums", "/pipeline"))
        ready(R(page, "group", "Stage 1: $match"), "attached").focus()
        prev = R(page, "region", "Stage preview")
        eventually(prev, lambda _t=None: expect(prev).to_contain_text("3.14159", timeout=_t))
        assert "3.14159265" not in prev.inner_text()


def test_view_switch_without_rerun(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if r.url.endswith("/query") else None)
        eventually(R(page, "radio", "List"), lambda _t=None: expect(R(page, "radio", "List")).to_be_checked(timeout=_t))
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, E_IDS, "Table rows")
        eventually(R(page, "list", "Documents"), lambda _t=None: expect(R(page, "list", "Documents")).to_have_count(0, timeout=_t))
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "JSON"), lambda _t=None: expect(R(page, "radio", "JSON")).to_be_checked(timeout=_t))
        eventually(R(page, "region", "JSON results").locator("[data-doc-id]"), lambda _t=None: expect(R(page, "region", "JSON results").locator("[data-doc-id]")).to_have_count(4, timeout=_t))
        page.keyboard.press("ArrowLeft")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, E_IDS, "Table rows again")
        assert sent == [], f"switching views re-ran the query: {sent}"


DP17_CASES = [
    ("{bad", "", "", "Filter is not valid JSON"),
    ("{}", "{bad", "", "Projection is not valid JSON"),
    ("{}", "", "{bad", "Sort is not valid JSON"),
    ('{"price":{"$regex":"1"}}', "", "", "Unknown operator $regex"),
    ("{}", '{"sku":1,"price":0}', "", "Projection cannot mix inclusion and exclusion"),
    (compact({"a": nest(QUERY_DEPTH_LIMIT)}), "", "", f"Query is nested deeper than {QUERY_DEPTH_LIMIT} levels"),
    ('{"$or":[]}', "", "", "Filter is not valid"),
    ("[1]", "", "", "Filter is not valid"),
    ("{}", "[1]", "", "Projection is not valid"),
    ("{}", "", '{"price":2}', "Sort is not valid"),
]


def test_query_error_alerts(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        for flt, proj, srt, want in DP17_CASES:
            run_query(page, flt, proj, srt)
            eventually(R(page, "alert", "Query error"), lambda _t=None: expect(R(page, "alert", "Query error")).to_have_text(want, timeout=_t))
            eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("Query not run", timeout=_t))
            run_query(page)
            eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))


def test_wf_projection_views_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        run_query(page, '{"sku":"POT-2"}', '{"sku":1,"price":1}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(1, 1), timeout=_t))
        item = R(page, "list", "Documents").locator(f'[data-doc-id="{E2}"]')
        poll(lambda: [ln.strip() for ln in item.inner_text().splitlines() if ln.strip()] == [f"_id: {E2}", "sku: POT-2", "price: 7.5"], "inclusion list lines")
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "grid", "Documents").locator(f'[data-doc-id="{E2}"][data-field-path="price"]'), lambda _t=None: expect(R(page, "grid", "Documents").locator(f'[data-doc-id="{E2}"][data-field-path="price"]')).to_have_text("7.5", timeout=_t))
        page.keyboard.press("ArrowRight")
        eventually(R(page, "region", "JSON results").locator(f'[data-doc-id="{E2}"]'), lambda _t=None: expect(R(page, "region", "JSON results").locator(f'[data-doc-id="{E2}"]')).to_contain_text("7.5", timeout=_t))
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        run_query(page, '{"_id":"%s"}' % E1, '{"items":0,"tags":0,"note":0}')
        item1 = R(page, "list", "Documents").locator(f'[data-doc-id="{E1}"]')
        poll(lambda: [ln.strip() for ln in item1.inner_text().splitlines() if ln.strip()] == [f"_id: {E1}", "sku: POT-1", "price: 12"], "exclusion list lines")
        run_query(page, "{}", '{"sku":1,"price":1,"_id":0}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ready(R(page, "radio", "Table")).click()
        grid = R(page, "grid", "Documents")
        expect_ids(page, grid_row_ids, E_IDS, "_id-free rows keep data-doc-id")
        headers = grid_headers(page)
        assert headers == ["price", "sku"], f"_id-free projection columns {headers}"
        ready(grid.locator(f'[data-doc-id="{E2}"][data-field-path="price"]')).click()
        expect_editor_doc(page, lambda d: d.get("_id") == E2 and d.get("tags") == ["green"], "row opens the full stored document")
    got = query(w.api("owner"), w.C("pots"), projection={"sku": 1, "price": 1, "_id": 0})
    assert got["documents"][1] == {"sku": "POT-2", "price": 7.5} and got["ids"] == E_IDS


def test_wf_projection_views_mixed(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        run_query(page, "{}", '{"sku":1,"price":0}')
        eventually(R(page, "alert", "Query error"), lambda _t=None: expect(R(page, "alert", "Query error")).to_have_text("Projection cannot mix inclusion and exclusion", timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("Query not run", timeout=_t))
        run_query(page, "{}", '{"sku":0}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ready(R(page, "radio", "Table")).click()
        headers = grid_headers(page)
        assert "sku" not in headers and "_id" in headers
    refused(w.api("owner").req("POST", f"{w.C('pots')}/query", {"projection": {"sku": 1, "price": 0}}), 422, "invalid_projection")


M_GT5 = {"$match": {"price": {"$gt": 5}}}
U_TAGS = {"$unwind": "$tags"}


def test_stage_preview_counts() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")
    pipe = [M_GT5, U_TAGS, {"$sort": {"price": -1}}, {"$limit": 2}]
    p = preview(api, C, pipe, [1])
    assert p["input"] == 4 and p["pin"] is None
    got = [(s["index"], s["count"], s["disabled"]) for s in p["stages"]]
    assert got == [(0, 3, False), (1, 3, True), (2, 3, False), (3, 2, False)], got
    assert [d["_id"] for d in p["stages"][2]["documents"]] == [E4, E1, E2][:PREVIEW_DOCS]
    assert [d["_id"] for d in p["stages"][3]["documents"]] == [E4, E1]
    assert [d["_id"] for d in p["stages"][1]["documents"]] == [E1, E2, E4][:PREVIEW_DOCS]
    p = preview(api, C, pipe)
    assert [s["count"] for s in p["stages"]] == [3, 4, 4, 2]
    assert all(len(s["documents"]) == min(s["count"], PREVIEW_DOCS) for s in p["stages"])
    assert len(preview(api, C, [{"$match": {}}] * MAX_STAGES)["stages"]) == MAX_STAGES
    r = api.req("POST", f"{C}/aggregate", {"pipeline": [{"$match": {}}] * (MAX_STAGES + 1), "disabled": list(range(MAX_STAGES + 1)), "preview": True})
    refused(r, 422, "too_many_stages", limit=MAX_STAGES)


def test_shaping_stages() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")

    def docs(pipe: list) -> list:
        return agg(api, C, pipe, page=1)["documents"]

    d = docs([{"$match": {"_id": E1}}, {"$project": {"sku": 1, "first_item": "$items.0.sku"}}])
    assert d == [{"_id": E1, "sku": "POT-1", "first_item": "S1"}] and list(d[0]) == ["_id", "sku", "first_item"]
    assert docs([{"$match": {"_id": E2}}, {"$project": {"sku": 1, "gone": "$nope"}}]) == [{"_id": E2, "sku": "POT-2"}]
    assert [x["_id"] for x in docs([{"$sort": {"price": -1}}])] == [E3, E4, E1, E2]
    assert [x["_id"] for x in docs([{"$sort": {"price": -1}}, {"$limit": 2}])] == [E3, E4]
    assert [x["_id"] for x in docs([{"$sort": {"price": -1}}, {"$skip": 1}])] == [E4, E1, E2]
    assert [x["_id"] for x in docs([M_GT5])] == [E1, E2, E4]
    full = agg(api, C, [{"$count": "n"}], page=1)
    assert full["documents"] == [{"n": 4}] and full["count"] == 1 and full["page"] == 1 and full["page_size"] == PAGE_SIZE
    assert docs([{"$match": {"sku": "none"}}, {"$count": "n"}]) == []
    bad = [
        ([{"$match": {}}, {"$lookup": {}}], "unknown_stage", {"stage": "$lookup", "index": 1}),
        ([{"$limit": 0}, {"$bogus": 1}], "invalid_stage", {"index": 0}),
        ([{"$skip": -1}], "invalid_stage", {"index": 0}),
        ([{"$match": {}, "$limit": 1}], "invalid_stage", {"index": 0}),
        ([{"$match": {}}, {"$match": {"price": {"$regex": "1"}}}], "invalid_stage", {"index": 1}),
        ([{"$sort": {"price": 2}}], "invalid_stage", {"index": 0}),
        ([{"$project": {"sku": 1, "price": 0}}], "invalid_stage", {"index": 0}),
        ([{"$count": ""}], "invalid_stage", {"index": 0}),
        ([{"$count": "$n"}], "invalid_stage", {"index": 0}),
        ([{"$count": "a.b"}], "invalid_stage", {"index": 0}),
    ]
    for pipe, code, extras in bad:
        refused(api.req("POST", f"{C}/aggregate", {"pipeline": pipe, "disabled": [], "page": 1}), 422, code, **extras)


def test_unwind_stage() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")
    out = agg(api, C, [U_TAGS], page=1)["documents"]
    assert [(d["_id"], d["tags"]) for d in out] == [(E1, "red"), (E1, "blue"), (E2, "green"), (E4, "red")]
    made = agg(api, C, [{"$unwind": "$made"}], page=1)["documents"]
    assert made == [E_DOCS[3]], f"non-array passes through unchanged: {made}"
    note = agg(api, C, [{"$unwind": "$note"}], page=1)["documents"]
    assert [d["_id"] for d in note] == [E3] and note[0]["note"] == "chipped"
    items = agg(api, C, [{"$unwind": "$items"}], page=1)
    assert items["count"] == 5 and [d["_id"] for d in items["documents"]] == [E1, E1, E2, E4, E4]


def test_pipeline_draft(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, rdr, C = w.api("owner"), w.api("reader"), w.C("pots")
    assert own.j("GET", f"{C}/pipeline") == {"stages": [], "disabled": []}
    put_draft(own, C, [{"$limit": 9}], [0])
    put_draft(own, C, [M_GT5, {"$limit": 2}], [1])
    assert draft_parsed(own, C) == ([M_GT5, {"$limit": 2}], [1])
    put_draft(rdr, C, [U_TAGS])
    assert draft_parsed(rdr, C) == ([U_TAGS], [])
    assert draft_parsed(own, C) == ([M_GT5, {"$limit": 2}], [1]), "a reader's draft leaked into the owner's"
    refused(own.req("PUT", f"{C}/pipeline", {"stages": ['{"$match":{}}'] * (MAX_STAGES + 1), "disabled": []}), 422, "too_many_stages", limit=MAX_STAGES)
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        eventually(R(page, "group", "Stage 1: $match"), lambda _t=None: expect(R(page, "group", "Stage 1: $match")).to_be_visible(timeout=_t))
        sw = R(page, "switch", "Enable stage 2")
        eventually(sw, lambda _t=None: expect(sw).not_to_be_checked(timeout=_t))
        ready(sw, "attached").focus()
        page.keyboard.press("Space")
        eventually(sw, lambda _t=None: expect(sw).to_be_checked(timeout=_t))
        poll(lambda: draft_parsed(own, C)[1] == [], "toggling the switch saves the draft")
        page.reload()
        eventually(R(page, "group", "Stage 2: $limit"), lambda _t=None: expect(R(page, "group", "Stage 2: $limit")).to_be_visible(timeout=_t))
        eventually(R(page, "switch", "Enable stage 2"), lambda _t=None: expect(R(page, "switch", "Enable stage 2")).to_be_checked(timeout=_t))
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as other:
        eventually(R(other, "switch", "Enable stage 2"), lambda _t=None: expect(R(other, "switch", "Enable stage 2")).to_be_checked(timeout=_t))
        eventually(R(other, "group", "Stage 1: $match"), lambda _t=None: expect(R(other, "group", "Stage 1: $match")).to_be_visible(timeout=_t))


def test_keyboard_stage_editing(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    limit2 = {"$limit": 2}
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        add = R(page, "button", "Add stage")
        for n, stage in enumerate([M_GT5, U_TAGS, limit2], 1):
            ready(add, "attached").focus()
            page.keyboard.press("Enter")
            box = R(page, "textbox", f"Stage {n} JSON")
            eventually(box, lambda _t=None: expect(box).to_be_focused(timeout=_t))
            assert parsed(content(box)) == {"$match": {}}, content(box)
            replace_text(page, box, compact(stage))
        card = R(page, "group", "Stage 3: $limit")
        ready(card, "attached").focus()
        page.keyboard.press("Alt+ArrowUp")
        eventually(R(page, "group", "Stage 2: $limit"), lambda _t=None: expect(R(page, "group", "Stage 2: $limit")).to_be_focused(timeout=_t))
        page.keyboard.press("Alt+ArrowUp")
        eventually(R(page, "group", "Stage 1: $limit"), lambda _t=None: expect(R(page, "group", "Stage 1: $limit")).to_be_focused(timeout=_t))
        page.keyboard.press("Alt+ArrowUp")
        eventually(R(page, "group", "Stage 1: $limit"), lambda _t=None: expect(R(page, "group", "Stage 1: $limit")).to_be_focused(timeout=_t))
        poll(lambda: draft_parsed(own, C)[0] == [limit2, M_GT5, U_TAGS], "moves are saved in order")
        ready(R(page, "switch", "Enable stage 1"), "attached").focus()
        page.keyboard.press("Alt+ArrowDown")
        moved = R(page, "group", "Stage 2: $limit")
        poll(lambda: focus_inside(moved), "focus stays on the moved card")
        ready(R(page, "group", "Stage 3: $unwind"), "attached").focus()
        page.keyboard.press("Alt+ArrowDown")
        eventually(R(page, "group", "Stage 3: $unwind"), lambda _t=None: expect(R(page, "group", "Stage 3: $unwind")).to_be_focused(timeout=_t))
        poll(lambda: draft_parsed(own, C)[0] == [M_GT5, limit2, U_TAGS], "end move does nothing")
        sw = R(page, "switch", "Enable stage 2")
        ready(sw, "attached").focus()
        page.keyboard.press("Space")
        eventually(sw, lambda _t=None: expect(sw).not_to_be_checked(timeout=_t))
        eventually(sw, lambda _t=None: expect(sw).to_be_focused(timeout=_t))
        poll(lambda: draft_parsed(own, C)[1] == [1], "disabled position is saved")
        card2 = R(page, "group", "Stage 2: $limit")
        ready(card2, "attached").focus()
        page.keyboard.press("Delete")
        dlg = R(page, "dialog", "Delete stage 2 ($limit)?")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        ready(R(dlg, "button", "Cancel"), "attached").focus()
        page.keyboard.press("Enter")
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
        eventually(card2, lambda _t=None: expect(card2).to_be_focused(timeout=_t))
        page.keyboard.press("Delete")
        ready(R(R(page, "dialog", "Delete stage 2 ($limit)?"), "button", "Delete"), "attached").focus()
        page.keyboard.press("Enter")
        eventually(R(page, "group", "Stage 2: $unwind"), lambda _t=None: expect(R(page, "group", "Stage 2: $unwind")).to_be_focused(timeout=_t))
        for op in ("$match", "$unwind"):
            ready(R(page, "button", "Delete stage 1"), "attached").focus()
            page.keyboard.press("Enter")
            ready(R(R(page, "dialog", f"Delete stage 1 ({op})?"), "button", "Delete"), "attached").focus()
            page.keyboard.press("Enter")
        eventually(R(page, "group", "Stage 1: $unwind"), lambda _t=None: expect(R(page, "group", "Stage 1: $unwind")).to_have_count(0, timeout=_t))
        eventually(add, lambda _t=None: expect(add).to_be_focused(timeout=_t))
        poll(lambda: draft_parsed(own, C)[0] == [], "all deletions saved")


def drag_card(page: Page, handle: Locator, target: Locator) -> None:
    target.scroll_into_view_if_needed()
    handle.scroll_into_view_if_needed()
    hb, tb = handle.bounding_box(), target.bounding_box()
    assert hb and tb
    x, y = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y - 6, steps=4)
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + 4, steps=20)
    page.mouse.up()


def test_drag_reorder(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    put_draft(own, C, [M_GT5, U_TAGS, {"$limit": 2}], [2])
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        eventually(R(page, "group", "Stage 3: $limit"), lambda _t=None: expect(R(page, "group", "Stage 3: $limit")).to_be_visible(timeout=_t))
        drag_card(page, R(page, "button", "Move stage 3"), R(page, "group", "Stage 1: $match"))
        eventually(R(page, "group", "Stage 1: $limit"), lambda _t=None: expect(R(page, "group", "Stage 1: $limit")).to_be_visible(timeout=_t))
        eventually(R(page, "group", "Stage 2: $match"), lambda _t=None: expect(R(page, "group", "Stage 2: $match")).to_be_visible(timeout=_t))
        eventually(R(page, "group", "Stage 3: $unwind"), lambda _t=None: expect(R(page, "group", "Stage 3: $unwind")).to_be_visible(timeout=_t))
        eventually(R(page, "status", "Pipeline status"), lambda _t=None: expect(R(page, "status", "Pipeline status")).to_have_text("Stage moved to position 1 of 3", timeout=_t))
        poll(lambda: draft_parsed(own, C) == ([{"$limit": 2}, M_GT5, U_TAGS], [0]), "drag saves the reordered draft with the disabled stage")
        page.reload()
        eventually(R(page, "group", "Stage 1: $limit"), lambda _t=None: expect(R(page, "group", "Stage 1: $limit")).to_be_visible(timeout=_t))


def test_pipeline_announcements(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    put_draft(own, C, [M_GT5, {"$match": {"sku": "POT-1"}}, {"$limit": 1}], [2])
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        def card_status(n: int, op: str) -> Locator:
            return R(page, "group", f"Stage {n}: {op}").get_by_role("status")
        ps = R(page, "status", "Pipeline status")
        eventually(card_status(1, "$match"), lambda _t=None: expect(card_status(1, "$match")).to_have_text(stage_status(1, 3, 3), timeout=_t))
        eventually(card_status(2, "$match"), lambda _t=None: expect(card_status(2, "$match")).to_have_text(stage_status(2, 3, 1), timeout=_t))
        eventually(card_status(3, "$limit"), lambda _t=None: expect(card_status(3, "$limit")).to_have_text("pass through", timeout=_t))
        box = R(page, "textbox", "Stage 2 JSON")
        replace_text(page, box, '{"$match":{"sku":{"$in":["POT-1","POT-2"]}}}')
        eventually(ps, lambda _t=None: expect(ps).to_have_text(stage_status(2, 3, 2), timeout=_t))
        replace_text(page, box, '{"$match":')
        eventually(page, lambda _t=None: expect(R(page, "group", "Stage 2: $match").get_by_role("status")).to_have_text("not valid JSON", timeout=_t)) if R(page, "group", "Stage 2: $match").count() else eventually(page, lambda _t=None: expect(page.get_by_text("not valid JSON", exact=True)).to_be_visible(timeout=_t))
        replace_text(page, box, '{"$match":{"sku":{"$in":["POT-1","POT-2"]}}}')
        eventually(card_status(2, "$match"), lambda _t=None: expect(card_status(2, "$match")).to_have_text(stage_status(2, 3, 2), timeout=_t))
        ready(R(page, "group", "Stage 3: $limit"), "attached").focus()
        page.keyboard.press("Alt+ArrowUp")
        eventually(ps, lambda _t=None: expect(ps).to_have_text("Stage moved to position 2 of 3", timeout=_t))
        sw = R(page, "switch", "Enable stage 2")
        ready(sw, "attached").focus()
        page.keyboard.press("Space")
        eventually(ps, lambda _t=None: expect(ps).to_have_text(stage_status(2, 3, 1), timeout=_t))
        eventually(card_status(2, "$limit"), lambda _t=None: expect(card_status(2, "$limit")).to_have_text(stage_status(2, 3, 1), timeout=_t))
        ready(R(page, "button", "Delete stage 1")).click()
        ready(R(R(page, "dialog", "Delete stage 1 ($match)?"), "button", "Delete")).click()
        eventually(ps, lambda _t=None: expect(ps).to_have_text("Stage 1 deleted", timeout=_t))


def test_wf_pipeline_keyboard_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    group = {"$group": {"_id": "$tags", "n": {"$count": {}}}}
    sort = {"$sort": {"n": -1, "_id": 1}}
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        add = R(page, "button", "Add stage")
        for n, stage in enumerate([M_GT5, U_TAGS, group, sort], 1):
            ready(add, "attached").focus()
            page.keyboard.press("Enter")
            box = R(page, "textbox", f"Stage {n} JSON")
            eventually(box, lambda _t=None: expect(box).to_be_focused(timeout=_t))
            replace_text(page, box, compact(stage))
        ops = ["$match", "$unwind", "$group", "$sort"]
        for n, (op, cnt) in enumerate(zip(ops, [3, 4, 3, 3]), 1):
            card = R(page, "group", f"Stage {n}: {op}")
            eventually(card.get_by_role("status"), lambda _t=None: expect(card.get_by_role("status")).to_have_text(stage_status(n, 4, cnt), timeout=_t))
            eventually(card, lambda _t=None: expect(card).to_have_attribute("data-stage-count", str(cnt), timeout=_t))
        ready(R(page, "group", "Stage 4: $sort"), "attached").focus()
        page.keyboard.press("Alt+ArrowUp")
        eventually(R(page, "group", "Stage 3: $sort"), lambda _t=None: expect(R(page, "group", "Stage 3: $sort")).to_be_focused(timeout=_t))
        eventually(R(page, "status", "Pipeline status"), lambda _t=None: expect(R(page, "status", "Pipeline status")).to_have_text("Stage moved to position 3 of 4", timeout=_t))
        eventually(R(page, "group", "Stage 3: $sort").get_by_role("status"), lambda _t=None: expect(R(page, "group", "Stage 3: $sort").get_by_role("status")).to_have_text(stage_status(3, 4, 4), timeout=_t))
        page.keyboard.press("Delete")
        dlg = R(page, "dialog", "Delete stage 3 ($sort)?")
        ready(R(dlg, "button", "Delete"), "attached").focus()
        page.keyboard.press("Enter")
        eventually(R(page, "status", "Pipeline status"), lambda _t=None: expect(R(page, "status", "Pipeline status")).to_have_text("Stage 3 deleted", timeout=_t))
        eventually(R(page, "group", "Stage 3: $group"), lambda _t=None: expect(R(page, "group", "Stage 3: $group")).to_be_focused(timeout=_t))
    want = [M_GT5, U_TAGS, group]
    poll(lambda: draft_parsed(own, C) == (want, []), "the keyboard pipeline is saved as the draft")
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as again:
        eventually(R(again, "group", "Stage 3: $group"), lambda _t=None: expect(R(again, "group", "Stage 3: $group")).to_be_visible(timeout=_t))
        eventually(R(again, "group", "Stage 4: $sort"), lambda _t=None: expect(R(again, "group", "Stage 4: $sort")).to_have_count(0, timeout=_t))


def test_wf_pipeline_keyboard_recovery(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        ready(R(page, "button", "Add stage"), "attached").focus()
        page.keyboard.press("Enter")
        box = R(page, "textbox", "Stage 1 JSON")
        replace_text(page, box, '{"$lookup":{}}')
        eventually(R(page, "alert", "Pipeline error"), lambda _t=None: expect(R(page, "alert", "Pipeline error")).to_have_text(f"Unknown stage {UNKNOWN_STAGE}", timeout=_t))
        replace_text(page, box, '{"$match":')
        eventually(page.get_by_text("not valid JSON", exact=True), lambda _t=None: expect(page.get_by_text("not valid JSON", exact=True)).to_be_visible(timeout=_t))
        replace_text(page, box, '{"$limit":0}')
        eventually(R(page, "alert", "Pipeline error"), lambda _t=None: expect(R(page, "alert", "Pipeline error")).to_have_text("Stage 1 is not valid", timeout=_t))
        replace_text(page, box, '{"$limit":2}')
        eventually(R(page, "group", "Stage 1: $limit").get_by_role("status"), lambda _t=None: expect(R(page, "group", "Stage 1: $limit").get_by_role("status")).to_have_text(stage_status(1, 1, 2), timeout=_t))
        eventually(page.get_by_text("Stage 1 is not valid", exact=True), lambda _t=None: expect(page.get_by_text("Stage 1 is not valid", exact=True)).to_have_count(0, timeout=_t))
    poll(lambda: draft_parsed(own, C) == ([{"$limit": 2}], []), "fixed stage saved as the draft")
    refused(own.req("POST", f"{C}/aggregate", {"pipeline": [{"$lookup": {}}], "disabled": [], "preview": True}), 422, "unknown_stage", stage="$lookup", index=0)


G_IDS = [f"d{n:023d}" for n in range(1, 8)]
G_DOCS = [{"_id": i, "k": k, "v": v} for i, (k, v) in zip(G_IDS, [("b", 2), ("a", 1), ("b", 2), ("a", 1), ("a", 2), ("b", 1), (5, 10)])]
ALL_ACC = {"$group": {"_id": "$k", "total": {"$sum": "$v"}, "avg": {"$avg": "$v"}, "lo": {"$min": "$v"}, "hi": {"$max": "$v"},
                      "all": {"$push": "$v"}, "first": {"$first": "$v"}, "last": {"$last": "$v"}, "n": {"$count": {}}}}
G_EXPECTED = [
    {"_id": 5, "total": 10, "avg": 10, "lo": 10, "hi": 10, "all": [10], "first": 10, "last": 10, "n": 1},
    {"_id": "a", "total": 4, "avg": 1.3333333333, "lo": 1, "hi": 2, "all": [1, 1, 2], "first": 1, "last": 2, "n": 3},
    {"_id": "b", "total": 5, "avg": 1.6666666667, "lo": 1, "hi": 2, "all": [2, 2, 1], "first": 2, "last": 1, "n": 3},
]


def test_group_keys_and_order() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("reader"), w.C("pots")

    def keys(pipe: list) -> list:
        return [(d["_id"], d["n"]) for d in agg(api, C, pipe, page=1)["documents"]]

    cnt = {"n": {"$count": {}}}
    assert keys([{"$group": {"_id": None, **cnt}}]) == [(None, 4)]
    assert keys([{"$group": {"_id": "$price", **cnt}}]) == [(7.5, 1), (12, 1), (20, 1), ("12", 1)]
    assert keys([{"$group": {"_id": "$note", **cnt}}]) == [(None, 3), ("chipped", 1)]
    assert keys([{"$group": {"_id": {"p": "$price"}, **cnt}}]) == [({"p": "12"}, 1), ({"p": 12}, 1), ({"p": 20}, 1), ({"p": 7.5}, 1)]
    assert keys([{"$group": {"_id": {"n": "$note"}, **cnt}}]) == [({"n": "chipped"}, 1), ({"n": None}, 3)]
    assert keys([U_TAGS, {"$group": {"_id": "$tags", **cnt}}]) == [("blue", 1), ("green", 1), ("red", 2)]


def test_accumulators() -> None:
    w = World({"pots": E_DOCS, "grp": G_DOCS})
    api = w.api("reader")
    worked = {"$group": {"_id": None, "total": {"$sum": "$price"}, "avg": {"$avg": "$price"}, "lo": {"$min": "$price"}, "hi": {"$max": "$price"},
                         "skus": {"$push": "$sku"}, "first": {"$first": "$sku"}, "last": {"$last": "$sku"}, "n": {"$count": {}}}}
    assert agg(api, w.C("pots"), [worked], page=1)["documents"] == [
        {"_id": None, "total": 39.5, "avg": 13.1666666667, "lo": 7.5, "hi": "12", "skus": ["POT-1", "POT-2", "POT-3", "POT-4"], "first": "POT-1", "last": "POT-4", "n": 4}]
    odd = {"$group": {"_id": None, "s": {"$sum": "$nope"}, "a": {"$avg": "$nope"}, "notes": {"$push": "$note"},
                      "fm": {"$first": "$made"}, "lm": {"$last": "$made"}}}
    assert agg(api, w.C("pots"), [odd], page=1)["documents"] == [{"_id": None, "s": 0, "a": None, "notes": [None, "chipped"], "fm": None, "lm": DATE_MADE}]
    assert agg(api, w.C("grp"), [ALL_ACC], page=1)["documents"] == G_EXPECTED
    neg = [{"_id": hexid("d", 50 + i), "v": v} for i, v in enumerate([-1, -1, -2])]
    w2 = World({"neg": neg})
    assert agg(w2.api("reader"), w2.C("neg"), [{"$group": {"_id": None, "a": {"$avg": "$v"}}}], page=1)["documents"] == [{"_id": None, "a": -1.3333333333}]


FORTY = [{"_id": hexid("f", i), "n": i} for i in range(1, 41)]


def test_stage_sieve_bars(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5, {"$unwind": "$items"}, {"$limit": 1}, {"$sort": {"price": 1}}], [3])
    with browse(browser, w.owner, w.ui("pots", "/pipeline"), live=False) as page:
        wait_settled(page, [3, 5, 1, 1])
        bands = sieve(R(page, "list", "Pipeline stages"))
        assert_bars(bands, [3, 5, 1, 1], 4, {3}, "pipeline Stage Sieve")
        assert bands[1]["bar"] >= bands[1]["track"] - BAR_TOLERANCE_PX
        assert all(b["capped"] == "false" for b in bands)
        eventually(R(page, "group", "Stage 4: $sort").get_by_role("status"), lambda _t=None: expect(R(page, "group", "Stage 4: $sort").get_by_role("status")).to_have_text("pass through", timeout=_t))


def test_stage_sieve_motion(browser: Browser) -> None:
    w = World({"forty": FORTY})
    put_draft(w.api("owner"), w.C("forty"), [{"$match": {}}, {"$limit": 30}, {"$skip": 0}])
    with browse(browser, w.owner, w.ui("forty", "/pipeline"), live=False) as page:
        wait_settled(page, [40, 30, 30])
        old = sieve(R(page, "list", "Pipeline stages"))
        page.evaluate(SAMPLER_JS)
        kit_fill(R(page, "textbox", "Stage 2 JSON"), '{"$limit":2}')
        with page.expect_response(stage_response):
            advance(page, DEBOUNCE_MS + FRAME_MS)
        advance(page, SETTLE_MS)
        frames = page.evaluate("() => window.__sieveFrames")
        track = old[1]["track"]
        new_w = {1: bar_width(track, 2, 40), 2: bar_width(track, 2, 40)}
        s0 = series(frames, 0)
        assert s0 and all(abs(wv - old[0]["bar"]) <= 0.5 for _, wv in s0), "band 1 moved though only stage 2 changed"
        assert len({f["bands"][0]["text"] for f in frames}) == 1, "band 1 numeral changed"
        starts = {}
        for j in (1, 2):
            ser = series(frames, j)
            st = first_move(ser, old[j]["bar"])
            assert st is not None, f"band {j + 1} never moved"
            starts[j] = st
            mid = width_at(ser, st + BAR_MS / 4)
            assert abs(mid - new_w[j]) > BAR_TOLERANCE_PX and abs(mid - old[j]["bar"]) > 0.5, f"band {j + 1} jumped instead of moving over {BAR_MS} ms"
            end = width_at(ser, st + BAR_MS + FRAME_MS)
            assert abs(end - new_w[j]) <= BAR_TOLERANCE_PX, f"band {j + 1} not settled {BAR_MS} ms after it started ({end} vs {new_w[j]})"
            assert abs(ser[-1][1] - new_w[j]) <= BAR_TOLERANCE_PX
        gap = starts[2] - starts[1]
        assert abs(gap - STAGGER_MS) <= FRAME_MS, f"band 3 started {gap:.0f} ms after band 2, expected {STAGGER_MS}"
        final_nums = set(re.findall(r"\d+", frames[-1]["bands"][1]["text"]))
        between = {str(n) for n in range(3, 30)} - final_nums
        assert any(set(re.findall(r"\d+", f["bands"][1]["text"])) & between for f in frames), "band 2 numeral did not count through whole numbers"
        assert "2" in final_nums


def test_stage_sieve_reduced_motion(browser: Browser) -> None:
    w = World({"forty": FORTY})
    put_draft(w.api("owner"), w.C("forty"), [{"$match": {}}, {"$limit": 30}, {"$skip": 0}])
    with browse(browser, w.owner, w.ui("forty", "/pipeline"), live=False, reduced="reduce") as page:
        wait_settled(page, [40, 30, 30])
        kit_fill(R(page, "textbox", "Pin document"), hexid("f", 11))
        with page.expect_response(stage_response):
            ready(R(page, "button", "Pin")).click()
        advance(page, SETTLE_MS)
        expect(page.locator("[data-pin-marker]")).to_have_attribute("data-stop-index", "end")
        kit_fill(R(page, "textbox", "Stage 2 JSON"), '{"$limit":2}')
        with page.expect_response(stage_response):
            advance(page, DEBOUNCE_MS + FRAME_MS)
        advance(page, FIRST_FRAME_MS)
        bands = sieve(R(page, "list", "Pipeline stages"))
        assert_bars(bands, [40, 2, 2], 40, set(), "first frame under reduced motion")
        assert "2" in re.findall(r"\d+", bands[1]["text"]) and "30" not in re.findall(r"\d+", bands[1]["text"])
        assert page.locator("[data-pin-marker]").get_attribute("data-stop-index") == "1"
        expect(R(page, "status", "Pipeline status")).to_have_text(stage_status(2, 3, 2))


def test_pinned_document(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("owner"), w.C("pots")
    pipe = [M_GT5, U_TAGS, {"$match": {"tags": "red"}}]
    assert preview(api, C, pipe, pin=E2)["pin"] == {"_id": E2, "stopped_at": 2}
    assert preview(api, C, pipe, pin=E1)["pin"] == {"_id": E1, "stopped_at": None}
    assert preview(api, C, pipe, pin=E3)["pin"]["stopped_at"] == 0
    assert preview(api, C, pipe, [0], pin=E3)["pin"]["stopped_at"] == 1
    assert preview(api, C, [M_GT5, {"$group": {"_id": None, "n": {"$count": {}}}}], pin=E2)["pin"]["stopped_at"] is None
    refused(api.req("POST", f"{C}/aggregate", {"pipeline": pipe, "disabled": [], "preview": True, "pin": hexid("e", 999)}), 404, "not_found")
    put_draft(api, C, pipe)
    with browse(browser, w.owner, w.ui("pots", "/pipeline")) as page:
        eventually(R(page, "group", "Stage 3: $match"), lambda _t=None: expect(R(page, "group", "Stage 3: $match")).to_be_visible(timeout=_t))
        kit_fill(R(page, "textbox", "Pin document"), E2)
        ready(R(page, "button", "Pin")).click()
        eventually(page.locator("[data-pin-marker]"), lambda _t=None: expect(page.locator("[data-pin-marker]")).to_have_attribute("data-stop-index", "2", timeout=_t))
        eventually(R(page, "group", "Stage 3: $match"), lambda _t=None: expect(R(page, "group", "Stage 3: $match")).to_contain_text("Pinned document stops here", timeout=_t))
        kit_fill(R(page, "textbox", "Pin document"), E1)
        ready(R(page, "button", "Pin")).click()
        eventually(page.locator("[data-pin-marker]"), lambda _t=None: expect(page.locator("[data-pin-marker]")).to_have_attribute("data-stop-index", "end", timeout=_t))
        eventually(R(page, "group", "Stage 3: $match"), lambda _t=None: expect(R(page, "group", "Stage 3: $match")).to_contain_text("Pinned document reaches the end", timeout=_t))
        ready(R(page, "button", "Unpin")).click()
        eventually(page.locator("[data-pin-marker]"), lambda _t=None: expect(page.locator("[data-pin-marker]")).to_have_count(0, timeout=_t))


def grouping_journey(browser: Browser, reduced: bool) -> None:
    w = World({"grp": G_DOCS})
    own, C = w.api("owner"), w.C("grp")
    put_draft(own, C, [{"$match": {}}, {"$limit": 1}])
    with browse(browser, w.owner, w.ui("grp", "/pipeline"), live=False, reduced="reduce" if reduced else "no-preference") as page:
        wait_settled(page, [7, 1])
        old = sieve(R(page, "list", "Pipeline stages"))
        page.evaluate(SAMPLER_JS)
        kit_fill(R(page, "textbox", "Stage 2 JSON"), compact(ALL_ACC))
        with page.expect_response(stage_response):
            advance(page, DEBOUNCE_MS + FRAME_MS)
        track = old[1]["track"]
        new_w = bar_width(track, 3, 7)
        if reduced:
            advance(page, FIRST_FRAME_MS)
            now = sieve(R(page, "list", "Pipeline stages"))
            assert abs(now[1]["bar"] - new_w) <= BAR_TOLERANCE_PX, "reduced motion: bar not final in the first frame"
        else:
            advance(page, SETTLE_MS)
            frames = page.evaluate("() => window.__sieveFrames")
            ser = series(frames, 1)
            st = first_move(ser, old[1]["bar"])
            assert st is not None, "the changed band never moved"
            mid = width_at(ser, st + BAR_MS / 4)
            assert abs(mid - new_w) > BAR_TOLERANCE_PX and abs(mid - old[1]["bar"]) > 0.5, "band settled without moving mid-way"
            assert all(abs(wv - old[0]["bar"]) <= 0.5 for _, wv in series(frames, 0)), "band 1 moved"
        advance(page, SETTLE_MS)
        assert_bars(sieve(R(page, "list", "Pipeline stages")), [7, 3], 7, set(), "settled grouping sieve")
        expect(R(page, "status", "Pipeline status")).to_have_text(stage_status(2, 2, 3))
        expect(R(page, "group", "Stage 2: $group").get_by_role("status")).to_have_text(stage_status(2, 2, 3))
        R(page, "group", "Stage 2: $group").focus()
        advance(page, FRAME_MS)
        prev = R(page, "region", "Stage preview")
        poll(lambda: "1.33333" in prev.inner_text() and "1.66667" in prev.inner_text(), "preview shows rounded averages")
        txt = prev.inner_text()
        assert "1.3333333333" not in txt and txt.index("1.33333") < txt.index("1.66667"), "groups out of key order in the preview"
    assert agg(own, C, [{"$match": {}}, ALL_ACC], page=1)["documents"] == G_EXPECTED


def test_wf_grouping_clock(browser: Browser) -> None:
    grouping_journey(browser, reduced=False)


def test_wf_grouping_reduced(browser: Browser) -> None:
    grouping_journey(browser, reduced=True)


def test_wf_grouping_overflow_motion(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own, C = w.api("owner"), w.C("pots")
    put_draft(own, C, [{"$match": {}}, {"$limit": 1}])
    with browse(browser, w.owner, w.ui("pots", "/pipeline"), live=False) as page:
        wait_settled(page, [4, 1])
        old = sieve(R(page, "list", "Pipeline stages"))
        page.evaluate(SAMPLER_JS)
        kit_fill(R(page, "textbox", "Stage 2 JSON"), '{"$unwind":"$items"}')
        with page.expect_response(stage_response):
            advance(page, DEBOUNCE_MS + FRAME_MS)
        advance(page, SETTLE_MS)
        frames = page.evaluate("() => window.__sieveFrames")
        track = old[1]["track"]
        ser = series(frames, 1)
        st = first_move(ser, old[1]["bar"])
        assert st is not None, "the overflowing band never moved"
        mid = width_at(ser, st + BAR_MS / 4)
        assert old[1]["bar"] + 0.5 < mid < track - BAR_TOLERANCE_PX, \
            f"overflowing band jumped to the full track ({mid:.1f}px of {track:.1f}px a quarter of the way in) instead of moving over {BAR_MS} ms (L299, L305)"
        end = width_at(ser, st + BAR_MS + FRAME_MS)
        assert abs(end - track) <= BAR_TOLERANCE_PX, f"overflowing band not full {BAR_MS} ms after it started ({end} vs {track})"
        assert all(abs(wv - old[0]["bar"]) <= 0.5 for _, wv in series(frames, 0)), "band 1 moved"
        assert_bars(sieve(R(page, "list", "Pipeline stages")), [4, 5], 4, set(), "settled overflow sieve")
        expect(R(page, "status", "Pipeline status")).to_have_text(stage_status(2, 2, 5))
    assert [s["count"] for s in preview(own, C, [{"$match": {}}, {"$unwind": "$items"}])["stages"]] == [4, 5]


def test_index_management() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("owner"), w.C("pots")
    assert api.j("GET", f"{C}/indexes")["indexes"] == [{"name": "_id_", "keys": {"_id": 1}, "unique": True}]
    assert api.j("POST", f"{C}/indexes", {"keys": {"sku": 1}, "unique": False}, 201)["index"] == {"name": "sku_1", "keys": {"sku": 1}, "unique": False}
    assert api.j("POST", f"{C}/indexes", {"keys": {"a": 1, "b": -1}, "unique": False}, 201)["index"]["name"] == "a_1_b_-1"
    assert api.j("POST", f"{C}/indexes", {"keys": {"price": -1}, "unique": False, "name": BY_PRICE}, 201)["index"]["name"] == BY_PRICE
    names = [i["name"] for i in api.j("GET", f"{C}/indexes")["indexes"]]
    assert names == ["_id_", "a_1_b_-1", BY_PRICE, "sku_1"], names
    refused(api.req("POST", f"{C}/indexes", {"keys": {"note": 1}, "unique": False, "name": "sku_1"}), 409, "name_taken")
    for keys in [{}, {"a": 2}, {"a": "1"}]:
        refused(api.req("POST", f"{C}/indexes", {"keys": keys, "unique": False}), 422, "invalid_index")
    assert api.req("DELETE", f"{C}/indexes/{BY_PRICE}").status_code == 204
    refused(api.req("DELETE", f"{C}/indexes/_id_"), 422, "cannot_drop_id_index")
    assert [i["name"] for i in api.j("GET", f"{C}/indexes")["indexes"]] == ["_id_", "a_1_b_-1", "sku_1"]


def test_unique_index_enforcement() -> None:
    w = World({"pots": {"documents": E_DOCS, "indexes": [{"name": "sku_u", "keys": {"sku": 1}, "unique": True}]},
               "tagged": {"documents": [{"_id": hexid("a", 1), "tags": ["red"], "code": "A", "a": 10, "b": 10}, {"_id": hexid("a", 2), "tags": ["blue"], "a": 11, "b": 11}],
                          "indexes": [{"name": "tags_u", "keys": {"tags": 1}, "unique": True}, {"name": "code_u", "keys": {"code": 1}, "unique": True},
                                      {"name": "ab", "keys": {"a": 1, "b": 1}, "unique": True}]}})
    api, C, T = w.api("editor"), w.C("pots"), w.C("tagged")
    refused(api.req("POST", f"{C}/documents", {"document": {"sku": "POT-1"}}), 409, "duplicate_key", index="sku_u", value="POT-1")
    refused(api.req("PUT", f"{C}/documents/{E2}", {"document": {"_id": E2, "sku": "POT-1"}, "version": 1}), 409, "duplicate_key", index="sku_u", value="POT-1")
    assert api.j("GET", f"{C}/documents/{E2}")["document"]["sku"] == "POT-2"
    refused(api.req("POST", f"{T}/documents", {"document": {"tags": ["green", "blue", "red"], "code": "B"}}), 409, "duplicate_key", index="tags_u", value="blue")
    refused(api.req("POST", f"{T}/documents", {"document": {"tags": ["pink"]}}), 409, "duplicate_key", index="code_u", value=None)
    api.j("POST", f"{T}/documents", {"document": {"tags": ["x1"], "code": "C", "a": 1, "b": 2}}, 201)
    refused(api.req("POST", f"{T}/documents", {"document": {"tags": ["x2"], "code": "D", "a": 1, "b": 2}}), 409, "duplicate_key", index="ab", value={"a": 1, "b": 2})
    before = count_of(api, C)
    body = refused(load_file(api, C, b'{"sku":"NEW-1"}\n{"sku":"POT-1"}\n{"sku":"NEW-1"}\n'), 422, "import_failed")
    assert body["errors"] == [{"line": 2, "message": 'Duplicate value "POT-1" for unique index sku_u'},
                              {"line": 3, "message": 'Duplicate value "NEW-1" for unique index sku_u'}], body
    assert count_of(api, C) == before
    res = fire_together(api, [("POST", f"{C}/documents", {"document": {"sku": "RACE-1"}})] * RACE_N)
    codes = sorted(r.status_code for r in res)
    assert codes == [201] + [409] * (RACE_N - 1), f"simultaneous equal inserts answered {codes}"
    assert all(r.json().get("error") == "duplicate_key" for r in res if r.status_code == 409)
    assert query(api, C, filter={"sku": "RACE-1"})["matched"] == 1


def test_unique_index_over_existing_data() -> None:
    docs = [{"_id": hexid("a", i), "v": v} for i, v in enumerate([5, 7, 7, 5], 1)]
    w = World({"dups": docs})
    api, C = w.api("owner"), w.C("dups")
    refused(api.req("POST", f"{C}/indexes", {"keys": {"v": 1}, "unique": True}), 409, "duplicate_key", index="v_1", value=7)
    assert [i["name"] for i in api.j("GET", f"{C}/indexes")["indexes"]] == ["_id_"]
    api.j("POST", f"{C}/documents", {"document": {"v": 7}}, 201)


def test_index_choice_and_examined_counts() -> None:
    w = World({"pots": {"documents": E_DOCS, "indexes": [
        {"name": "sku_1", "keys": {"sku": 1}, "unique": False}, {"name": "tags_1", "keys": {"tags": 1}, "unique": False},
        {"name": "note_1", "keys": {"note": 1}, "unique": False}]}})
    api, C = w.api("reader"), w.C("pots")

    def plan(flt: dict) -> tuple:
        p = query(api, C, filter=flt)["plan"]
        return p["kind"], p["index"], p["docs_examined"], p["returned"]

    assert plan({"sku": "POT-1", "price": 12}) == ("index", "sku_1", 1, 1)
    assert plan({"price": 12}) == ("full_scan", None, 4, 1)
    assert plan({"$or": [{"sku": "POT-1"}]}) == ("full_scan", None, 4, 1)
    assert plan({"$and": [{"sku": {"$in": ["POT-1", "POT-2"]}}]}) == ("index", "sku_1", 2, 2)
    assert plan({"sku": {"$gte": "POT-2"}}) == ("index", "sku_1", 3, 3)
    assert plan({"sku": {"$ne": "x"}}) == ("full_scan", None, 4, 4)
    assert plan({"sku": {"$eq": "POT-1", "$exists": True}}) == ("index", "sku_1", 1, 1)
    assert plan({"_id": E2}) == ("index", "_id_", 1, 1)
    assert plan({"tags": "red"}) == ("index", "tags_1", 2, 2)
    assert plan({"note": None}) == ("index", "note_1", 3, 3)
    assert query(api, C, filter={"price": 12}, limit=1)["plan"]["returned"] == query(api, C, filter={"price": 12}, limit=1)["matched"]
    own = w.api("owner")
    own.j("POST", f"{C}/indexes", {"keys": {"sku": 1, "price": 1}, "unique": False}, 201)
    assert plan({"sku": "POT-1", "price": 12})[:2] == ("index", "sku_1_price_1")
    own.j("POST", f"{C}/indexes", {"keys": {"tags": 1}, "unique": False, "name": "a_tags"}, 201)
    assert plan({"tags": "red"})[:2] == ("index", "a_tags")


def test_explain_readout(browser: Browser) -> None:
    w = World({"pots": {"documents": E_DOCS, "indexes": [{"name": "sku_1", "keys": {"sku": 1}, "unique": False}]}})
    with browse(browser, w.owner, w.ui("pots")) as page:
        plan = R(page, "status", "Query plan")
        run_query(page, '{"price":12}')
        expect_lines(plan, ["Full scan", "Examined 4 documents, returned 1"], "full scan readout")
        eventually(plan, lambda _t=None: expect(plan).to_have_attribute("data-plan-kind", "full_scan", timeout=_t))
        eventually(plan, lambda _t=None: expect(plan).to_have_attribute("data-plan-index", "", timeout=_t))
        run_query(page, '{"sku":"POT-1","price":12}')
        expect_lines(plan, ["Used index sku_1", "Examined 1 document, returned 1"], "index readout")
        eventually(plan, lambda _t=None: expect(plan).to_have_attribute("data-plan-kind", "index", timeout=_t))
        eventually(plan, lambda _t=None: expect(plan).to_have_attribute("data-plan-index", "sku_1", timeout=_t))
        run_query(page, '{"sku":{"$in":["POT-1","POT-2"]}}')
        expect_lines(plan, ["Used index sku_1", "Examined 2 documents, returned 2"], "index readout for $in")


def test_duplicate_notice_in_editor(browser: Browser) -> None:
    w = World({"pots": {"documents": E_DOCS, "indexes": [{"name": "sku_1", "keys": {"sku": 1}, "unique": True}]}})
    with browse(browser, w.editor, w.ui("pots", f"/d/{E2}")) as page:
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open")
        kit_fill(editor_box(page), compact({**E_DOCS[1], "sku": "POT-1"}))
        ready(editor_box(page), "attached").focus()
        page.keyboard.press("Control+s")
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text('Duplicate value "POT-1" for unique index sku_1', timeout=_t))
    assert w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")["document"]["sku"] == "POT-2"


def test_wf_unique_index_explain_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        run_query(page, '{"sku":"POT-1"}')
        expect_lines(R(page, "status", "Query plan"), ["Full scan", "Examined 4 documents, returned 1"], "before the index")
        ready(R(R(page, "navigation", "Sections"), "link", "Indexes")).click()
        keys = R(page, "textbox", "Index keys")
        kit_fill(keys, '{"sku":1}')
        ready(R(page, "checkbox", "Unique"), "attached").focus()
        page.keyboard.press("Space")
        eventually(R(page, "checkbox", "Unique"), lambda _t=None: expect(R(page, "checkbox", "Unique")).to_be_checked(timeout=_t))
        ready(R(page, "button", "Create index"), "attached").focus()
        page.keyboard.press("Enter")
        eventually(R(page, "status", "Index status"), lambda _t=None: expect(R(page, "status", "Index status")).to_have_text("Index sku_1 created", timeout=_t))
        eventually(R(page, "list", "Indexes"), lambda _t=None: expect(R(page, "list", "Indexes")).to_contain_text("sku_1", timeout=_t))
        eventually(R(page, "button", "Drop sku_1"), lambda _t=None: expect(R(page, "button", "Drop sku_1")).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Drop _id_"), lambda _t=None: expect(R(page, "button", "Drop _id_")).to_have_count(0, timeout=_t))
        ready(R(R(page, "navigation", "Sections"), "link", "Documents")).click()
        run_query(page, '{"sku":"POT-1"}')
        expect_lines(R(page, "status", "Query plan"), ["Used index sku_1", "Examined 1 document, returned 1"], "after the index")
        with browse(browser, w.editor, w.ui("pots", f"/d/{E2}")) as other:
            expect_editor_doc(other, lambda d: d.get("_id") == E2, "editor has E2 open")
            kit_fill(editor_box(other), compact({**E_DOCS[1], "sku": "POT-1"}))
            ready(editor_box(other), "attached").focus()
            other.keyboard.press("Control+s")
            eventually(save_status(other), lambda _t=None: expect(save_status(other)).to_have_text('Duplicate value "POT-1" for unique index sku_1', timeout=_t))
    api = w.api("owner")
    assert {"name": "sku_1", "keys": {"sku": 1}, "unique": True} in api.j("GET", f"{w.C('pots')}/indexes")["indexes"]
    assert api.j("GET", f"{w.C('pots')}/documents/{E2}")["document"]["sku"] == "POT-2"


def test_wf_unique_index_explain_race(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots", "/indexes")) as page:
        kit_fill(R(page, "textbox", "Index keys"), "[1]")
        ready(R(page, "button", "Create index")).click()
        eventually(R(page, "status", "Index status"), lambda _t=None: expect(R(page, "status", "Index status")).to_have_text("Index keys are not valid", timeout=_t))
        kit_fill(R(page, "textbox", "Index keys"), '{"sku":1}')
        ready(R(page, "checkbox", "Unique")).check()
        kit_fill(R(page, "textbox", "Index name"), "sku_once")
        ready(R(page, "button", "Create index")).click()
        eventually(R(page, "status", "Index status"), lambda _t=None: expect(R(page, "status", "Index status")).to_have_text(f"Index {SKU_ONCE} created", timeout=_t))
        res = fire_together(w.api("editor"), [("POST", f"{w.C('pots')}/documents", {"document": {"sku": "RACE-1"}})] * RACE_N)
        assert sorted(r.status_code for r in res) == [201] + [409] * (RACE_N - 1)
        page.goto(BASE + w.ui("pots"))
        run_query(page, '{"sku":"RACE-1"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(1, 1), timeout=_t))
        expect_lines(R(page, "status", "Query plan"), ["Used index sku_once", "Examined 1 document, returned 1"], "race readout")
    assert query(w.api("owner"), w.C("pots"), filter={"sku": "RACE-1"})["matched"] == 1


def test_wf_unique_index_explain_touch(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots", "/indexes"), viewport=PHONE) as page:
        kit_fill(R(page, "textbox", "Index keys"), '{"sku":1}')
        unique, create = R(page, "checkbox", "Unique"), R(page, "button", "Create index")
        for name, loc in (("Unique", unique), ("Create index", create)):
            b = loc.bounding_box()
            assert b and b["width"] >= MIN_TARGET_PX - 0.5 and b["height"] >= MIN_TARGET_PX - 0.5, \
                f"{name} control is {b}, under {MIN_TARGET_PX}px on a touch screen (L274, L294)"
        tap(unique)
        eventually(unique, lambda _t=None: expect(unique).to_be_checked(timeout=_t))
        tap(create)
        eventually(R(page, "status", "Index status"), lambda _t=None: expect(R(page, "status", "Index status")).to_have_text("Index sku_1 created", timeout=_t))
        eventually(R(page, "list", "Indexes"), lambda _t=None: expect(R(page, "list", "Indexes")).to_contain_text("sku_1", timeout=_t))
    api = w.api("owner")
    assert {"name": "sku_1", "keys": {"sku": 1}, "unique": True} in api.j("GET", f"{w.C('pots')}/indexes")["indexes"]
    refused(api.req("POST", f"{w.C('pots')}/documents", {"document": {"sku": "POT-1"}}), 409, "duplicate_key")


RULE = {"required": ["name", "price"], "properties": {
    "price": {"bsonType": "number", "minimum": 1, "maximum": 100},
    "code": {"enum": ["A", "B"]}, "a.b": {"bsonType": "int"}, "m": {"minimum": 5}}}


def test_validator_rules() -> None:
    stale = {"_id": hexid("a", 1), "price": "free"}
    w = World({"ruled": {"documents": [stale], "validator": RULE}})
    own, ed, C = w.api("owner"), w.api("editor"), w.C("ruled")
    assert own.j("GET", f"{C}/validator")["validator"] == RULE
    assert own.j("GET", C)["validator"] == RULE
    refused(ed.req("POST", f"{C}/documents", {"document": {"name": "x"}}), 422, "validation_failed", path="price", rule="required")
    ok = ed.j("POST", f"{C}/documents", {"document": {"name": "x", "price": 5}}, 201)
    did = ok["document"]["_id"]
    refused(ed.req("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "name": "x", "price": 500}, "version": 1}), 422, "validation_failed", path="price", rule="maximum")
    assert query(ed, C, filter={"_id": stale["_id"]})["matched"] == 1, "stored invalid documents stay"
    refused(ed.req("PUT", f"{C}/validator", {"validator": None}), 403, "read_only")
    for bad in [{"required": "name"}, {"properties": {"a": {"bsonType": "decimal"}}}, {"other": 1}, {"properties": {"a": {"minimum": "1"}}}]:
        refused(own.req("PUT", f"{C}/validator", {"validator": bad}), 422, "invalid_validator")
    assert own.j("GET", f"{C}/validator")["validator"] == RULE
    assert own.j("PUT", f"{C}/validator", {"validator": None})["validator"] is None
    ed.j("POST", f"{C}/documents", {"document": {"anything": True}}, 201)


VALIDATION_CASES = [
    ({}, "name", "required"), ({"name": "x"}, "price", "required"),
    ({"name": "x", "price": "1", "code": "Z"}, "code", "enum"), ({"name": "x", "price": "1"}, "price", "bsonType"),
    ({"name": "x", "price": 0}, "price", "minimum"), ({"name": "x", "price": 101}, "price", "maximum"),
    ({"name": "x", "price": 5, "a": {"b": 1.5}}, "a.b", "bsonType"),
]


def test_validation_check_order() -> None:
    w = World({"ruled": {"documents": [], "validator": RULE}})
    api, C = w.api("editor"), w.C("ruled")
    for doc, path, rule in VALIDATION_CASES:
        refused(api.req("POST", f"{C}/documents", {"document": doc}), 422, "validation_failed", path=path, rule=rule)
    for doc in [{"name": None, "price": 5}, {"name": "x", "price": 100}, {"name": "x", "price": 1, "a": {"b": 2.0}},
                {"name": "x", "price": 5, "m": "abc"}, {"name": "x", "price": 5, "code": "B"}]:
        api.j("POST", f"{C}/documents", {"document": doc}, 201)
    w2 = World({"arr": {"documents": [], "validator": {"required": ["t.x"]}}})
    refused(w2.api("editor").req("POST", f"{w2.C('arr')}/documents", {"document": {"t": [{"x": 1}]}}), 422, "validation_failed", path="t.x", rule="required")


def test_validation_notice(browser: Browser) -> None:
    w = World({"ruled": {"documents": [], "validator": RULE}})
    with browse(browser, w.editor, w.ui("ruled")) as page:
        for doc, text in [({"name": "x", "price": 0}, "Document failed validation at price: must be at least 1"),
                          ({"name": "x", "price": 5, "code": "Z"}, 'Document failed validation at code: must be one of ["A","B"]'),
                          ({"price": 5}, "Document failed validation at name: required field is missing"),
                          ({"name": "x", "price": "5"}, "Document failed validation at price: expected number")]:
            ready(R(page, "button", "Insert document").first).click()
            box = editor_box(page)
            poll(lambda: parsed(content(box)) == {}, "Insert document opens {}")
            kit_fill(box, compact(doc))
            ready(box, "attached").focus()
            page.keyboard.press("Control+s")
            eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text(text, timeout=_t))
            ready(R(page, "button", "Close")).click()
    assert count_of(w.api("owner"), w.C("ruled")) == 0


def test_rules_screen_by_role(browser: Browser) -> None:
    w = World({"ruled": {"documents": [], "validator": {"required": ["name"]}}})
    with browse(browser, w.owner, w.ui("ruled", "/rules")) as page:
        box = R(page, "textbox", "Validator JSON")
        eventually(box, lambda _t=None: expect(box).to_be_editable(timeout=_t))
        kit_fill(box, '{"required":"name"}')
        ready(R(page, "button", "Save rules")).click()
        eventually(R(page, "status", "Rules status"), lambda _t=None: expect(R(page, "status", "Rules status")).to_have_text("Rules are not valid", timeout=_t))
        kit_fill(box, compact({"required": ["name", "price"]}))
        ready(R(page, "button", "Save rules")).click()
        eventually(R(page, "status", "Rules status"), lambda _t=None: expect(R(page, "status", "Rules status")).to_have_text("Rules saved", timeout=_t))
    assert w.api("owner").j("GET", f"{w.C('ruled')}/validator")["validator"] == {"required": ["name", "price"]}
    for role in ("editor", "reader"):
        with browse(browser, w[role], w.ui("ruled", "/rules")) as page:
            box = R(page, "textbox", "Validator JSON")
            eventually(box, lambda _t=None: expect(box).to_be_visible(timeout=_t))
            poll(lambda: parsed(content(box)) == {"required": ["name", "price"]}, f"{role} sees the stored rules")
            eventually(box, lambda _t=None: expect(box).not_to_be_editable(timeout=_t))
            eventually(R(page, "button", "Save rules"), lambda _t=None: expect(R(page, "button", "Save rules")).to_have_count(0, timeout=_t))


def test_wf_validation_rules_happy(browser: Browser) -> None:
    w = World({"ruled": [{"_id": hexid("a", 1), "price": "old"}]})
    with browse(browser, w.owner, w.ui("ruled", "/rules")) as owner_page:
        kit_fill(R(owner_page, "textbox", "Validator JSON"), compact(RULE))
        ready(R(owner_page, "button", "Save rules")).click()
        eventually(R(owner_page, "status", "Rules status"), lambda _t=None: expect(R(owner_page, "status", "Rules status")).to_have_text("Rules saved", timeout=_t))
    with browse(browser, w.editor, w.ui("ruled")) as page:
        ready(R(page, "button", "Insert document")).click()
        box = editor_box(page)
        for doc, text in [({"price": "cheap"}, "Document failed validation at name: required field is missing"),
                          ({"name": "pot", "price": "cheap"}, "Document failed validation at price: expected number")]:
            kit_fill(box, compact(doc))
            ready(box, "attached").focus()
            page.keyboard.press("Control+s")
            eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text(text, timeout=_t))
        kit_fill(box, compact({"name": "pot", "price": 9}))
        ready(box, "attached").focus()
        page.keyboard.press("Control+s")
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("ruled", "/d/")) + "[0-9a-f]{24}$"), timeout=_t))
    api = w.api("owner")
    assert query(api, w.C("ruled"), filter={"name": "pot"})["matched"] == 1
    assert count_of(api, w.C("ruled")) == 2


def test_wf_validation_rules_roles(browser: Browser) -> None:
    w = World({"ruled": {"documents": [], "validator": {"required": ["name"]}}})
    with browse(browser, w.editor, w.ui("ruled", "/rules")) as page:
        eventually(R(page, "textbox", "Validator JSON"), lambda _t=None: expect(R(page, "textbox", "Validator JSON")).not_to_be_editable(timeout=_t))
        eventually(R(page, "button", "Save rules"), lambda _t=None: expect(R(page, "button", "Save rules")).to_have_count(0, timeout=_t))
    with browse(browser, w.outsider, w.ui("ruled", "/rules")) as page:
        eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
    C = w.C("ruled")
    refused(w.api("editor").req("PUT", f"{C}/validator", {"validator": None}), 403, "read_only")
    refused(w.api("outsider").req("PUT", f"{C}/validator", {"validator": None}), 404, "not_found")
    refused(w.api("outsider").req("GET", f"{C}/validator"), 404, "not_found")
    assert w.api("owner").j("GET", f"{C}/validator")["validator"] == {"required": ["name"]}


def test_wf_validation_rules_open_editor(browser: Browser) -> None:
    w = World({"ruled": [{"_id": hexid("a", 1), "price": "old"}]})
    with browse(browser, w.editor, w.ui("ruled")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(1, 1), timeout=_t))
        with browse(browser, w.owner, w.ui("ruled", "/rules")) as owner_page:
            kit_fill(R(owner_page, "textbox", "Validator JSON"), compact(RULE))
            ready(R(owner_page, "button", "Save rules")).click()
            eventually(R(owner_page, "status", "Rules status"), lambda _t=None: expect(R(owner_page, "status", "Rules status")).to_have_text("Rules saved", timeout=_t))
        ready(R(page, "button", "Insert document").first).click()
        box = editor_box(page)
        poll(lambda: parsed(content(box)) == {}, "Insert document opens {}")
        for doc, text in [({"name": "pot", "price": "cheap"}, "Document failed validation at price: expected number"),
                          ({"name": "pot", "price": 0}, "Document failed validation at price: must be at least 1"),
                          ({"name": "pot", "price": 101}, "Document failed validation at price: must be at most 100"),
                          ({"name": "pot", "price": 5, "code": "Z"}, 'Document failed validation at code: must be one of ["A","B"]')]:
            kit_fill(box, compact(doc))
            ready(box, "attached").focus()
            page.keyboard.press("Control+s")
            eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text(text, timeout=_t))
        kit_fill(box, compact({"name": "pot", "price": 9, "code": "A"}))
        ready(box, "attached").focus()
        page.keyboard.press("Control+s")
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
    assert query(w.api("owner"), w.C("ruled"), filter={"name": "pot"})["matched"] == 1


E_SCHEMA = [
    {"path": "_id", "present": 100, "types": [{"type": "string", "share": 100}]},
    {"path": "items", "present": 100, "types": [{"type": "array", "share": 100}]},
    {"path": "made", "present": 25, "types": [{"type": "date", "share": 100}]},
    {"path": "note", "present": 50, "types": [{"type": "null", "share": 50}, {"type": "string", "share": 50}]},
    {"path": "price", "present": 100, "types": [{"type": "number", "share": 75}, {"type": "string", "share": 25}]},
    {"path": "sku", "present": 100, "types": [{"type": "string", "share": 100}]},
    {"path": "tags", "present": 100, "types": [{"type": "array", "share": 100}]},
]


def test_schema_summary_values() -> None:
    rounding = [{"_id": hexid("c", i), "x": 1, "o": {"p": True}} for i in range(1, 8)] + [{"_id": hexid("c", 8), "x": "s", "arr": [{"q": 1}]}]
    capped = [{"_id": hexid("9", i), "y": 1} for i in range(1, SCHEMA_SAMPLE + 1)] + [{"_id": hexid("9", SCHEMA_SAMPLE + i), "z": 1} for i in (1, 2)]
    w = World({"pots": E_DOCS, "round": rounding, "capped": capped})
    api = w.api("reader")
    s = api.j("GET", f"{w.C('pots')}/schema")
    assert s["sampled"] == 4 and s["fields"] == E_SCHEMA, s
    s = api.j("GET", f"{w.C('round')}/schema")
    assert s["sampled"] == 8 and s["fields"] == [
        {"path": "_id", "present": 100, "types": [{"type": "string", "share": 100}]},
        {"path": "arr", "present": 13, "types": [{"type": "array", "share": 100}]},
        {"path": "o", "present": 88, "types": [{"type": "object", "share": 100}]},
        {"path": "o.p", "present": 88, "types": [{"type": "boolean", "share": 100}]},
        {"path": "x", "present": 100, "types": [{"type": "number", "share": 88}, {"type": "string", "share": 13}]},
    ], s
    s = api.j("GET", f"{w.C('capped')}/schema")
    assert s["sampled"] == SCHEMA_SAMPLE and [f["path"] for f in s["fields"]] == ["_id", "y"], s


def schema_row(page: Page, path: str) -> Locator:
    return R(page, "list", "Schema fields").locator(f'[data-field-path="{path}"]')


def expect_schema_row(page: Page, row: dict) -> None:
    loc = schema_row(page, row["path"])
    eventually(loc, lambda _t=None: expect(loc).to_have_attribute("data-present", str(row["present"]), timeout=_t))
    eventually(loc, lambda _t=None: expect(loc).to_contain_text(f"Present in {row['present']}% of documents", timeout=_t))
    for t in row["types"]:
        chip = loc.locator(f'[data-type="{t["type"]}"]')
        eventually(chip, lambda _t=None: expect(chip).to_have_attribute("data-share", str(t["share"]), timeout=_t))
        eventually(loc, lambda _t=None: expect(loc).to_contain_text(f"{t['type']} {t['share']}%", timeout=_t))


def test_schema_screen(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.reader, w.ui("pots", "/schema")) as page:
        eventually(R(page, "list", "Schema fields").locator("[data-field-path]"), lambda _t=None: expect(R(page, "list", "Schema fields").locator("[data-field-path]")).to_have_count(len(E_SCHEMA), timeout=_t))
        for row in E_SCHEMA:
            expect_schema_row(page, row)
        price = schema_row(page, "price")
        nb, sb = (price.locator(f'[data-type="{kind}"]').bounding_box() for kind in ("number", "string"))
        assert nb and sb and nb["width"] > sb["width"], "75% segment must be wider than the 25% segment"


SCHEMA_AFTER = {"price": {"path": "price", "present": 100, "types": [{"type": "number", "share": 60}, {"type": "string", "share": 40}]},
                "note": {"path": "note", "present": 60, "types": [{"type": "string", "share": 67}, {"type": "null", "share": 33}]}}


def test_wf_schema_summary_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots", "/schema")) as page:
        expect_schema_row(page, E_SCHEMA[4])
        expect_schema_row(page, E_SCHEMA[3])
        with browse(browser, w.editor, w.ui("pots")) as ed:
            ready(R(ed, "button", "Insert document")).click()
            kit_fill(editor_box(ed), compact({"sku": "POT-5", "price": "9", "note": "new"}))
            ready(editor_box(ed), "attached").focus()
            ed.keyboard.press("Control+s")
            eventually(save_status(ed), lambda _t=None: expect(save_status(ed)).to_have_text("Saved", timeout=_t))
        ready(R(R(page, "navigation", "Sections"), "link", "Documents")).click()
        ready(R(R(page, "navigation", "Sections"), "link", "Schema")).click()
        expect_schema_row(page, SCHEMA_AFTER["price"])
        expect_schema_row(page, SCHEMA_AFTER["note"])
    fields = {f["path"]: f for f in w.api("owner").j("GET", f"{w.C('pots')}/schema")["fields"]}
    assert fields["price"] == SCHEMA_AFTER["price"] and fields["note"] == SCHEMA_AFTER["note"]


def test_wf_schema_summary_phone(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    w.api("editor").j("POST", f"{w.C('pots')}/documents", {"document": {"sku": "POT-5", "price": "9", "note": "new"}}, 201)
    with browse(browser, w.owner, w.ui("pots"), viewport=PHONE) as page:
        tap(R(R(page, "navigation", "Sections"), "link", "Schema"))
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", "/schema")) + "$"), timeout=_t))
        expect_schema_row(page, SCHEMA_AFTER["price"])
        expect_schema_row(page, SCHEMA_AFTER["note"])
        layout(page)
        boxes = [schema_row(page, p).bounding_box() for p in ("note", "price")]
        assert boxes[0] and boxes[1] and boxes[1]["y"] >= boxes[0]["y"] + boxes[0]["height"] - 1, "schema rows must stack in one column"
        page.set_viewport_size(TABLET)
        expect_schema_row(page, SCHEMA_AFTER["price"])


def test_document_versions() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("editor"), w.C("pots")
    doc = api.j("POST", f"{C}/documents", {"document": {"x": 1}}, 201)
    assert doc["version"] == 1
    did = doc["document"]["_id"]
    assert api.j("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 2}, "version": 1})["version"] == 2
    assert api.j("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 2}, "version": 2})["version"] == 3
    body = refused(api.req("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 9}, "version": 1}), 409, "version_conflict", current_version=3)
    assert body["current"] == {"_id": did, "x": 2}
    refused(api.req("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 9}}), 422, "invalid_field", field="version")
    refused(api.req("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 9}, "version": "3"}), 422, "invalid_field", field="version")
    refused(api.req("PUT", f"{C}/documents/{did}", {"document": {"_id": E1, "x": 9}, "version": 3}), 422, "id_mismatch")
    res = fire_together(api, [("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "x": 100 + i}, "version": 3}) for i in range(RACE_N)])
    codes = sorted(r.status_code for r in res)
    assert codes == [200] + [409] * (RACE_N - 1), f"simultaneous saves of version 3 answered {codes}"
    winner = next(r.json() for r in res if r.status_code == 200)
    stored = api.j("GET", f"{C}/documents/{did}")
    assert stored["version"] == 4 and stored["document"] == winner["document"]


def test_edit_clash_notice(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    ed, C = w.api("editor"), w.C("pots")
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}")) as page:
        expect_editor_doc(page, lambda d: d.get("price") == 7.5, "E2 open")
        ed.j("PUT", f"{C}/documents/{E2}", {"document": {**E_DOCS[1], "price": 8}, "version": 1})
        kit_fill(editor_box(page), compact({**E_DOCS[1], "price": 9}))
        ready(R(page, "button", "Save")).click()
        clash = page.get_by_role("alert").filter(has_text="This document was changed by someone else.")
        eventually(clash, lambda _t=None: expect(clash).to_be_visible(timeout=_t))
        ready(R(clash, "button", "Reload")).click()
        expect_editor_doc(page, lambda d: d.get("price") == 8, "Reload shows the server copy")
        ed.j("PUT", f"{C}/documents/{E2}", {"document": {**E_DOCS[1], "price": 10}, "version": 2})
        kit_fill(editor_box(page), compact({**E_DOCS[1], "price": 11}))
        ready(R(page, "button", "Save")).click()
        eventually(clash, lambda _t=None: expect(clash).to_be_visible(timeout=_t))
        ready(R(clash, "button", "Overwrite")).click()
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
    stored = ed.j("GET", f"{C}/documents/{E2}")
    assert stored["version"] == 4 and stored["document"]["price"] == 11


def test_editor_keyboard(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ready(R(page, "list", "Documents").locator(f'[data-doc-id="{E2}"]')).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", f"/d/{E2}")) + "$"), timeout=_t))
        box = editor_box(page)
        d = expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open")
        assert list(d) == list(E_DOCS[1]), f"editor field order {list(d)}"
        assert "\n  " in content(box), "editor pretty-prints with two-space indents"
        ready(box, "attached").focus()
        page.keyboard.press("Control+End")
        before = content(box)
        page.keyboard.press("Tab")
        after = content(box)
        assert len(after) - len(before) == 2 and after.count(" ") - before.count(" ") == 2, "Tab must insert two spaces"
        assert focus_inside(box), "Tab left the editor"
        page.keyboard.press("Control+s")
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        page.keyboard.press("Escape")
        page.keyboard.press("Tab")
        assert not focus_inside(box), "Escape then Tab must move focus out of the editor"
        ready(R(page, "button", "Close")).click()
        poll(lambda: active(page).get("within") == E2, "Close returns focus to the item that opened the editor")
        page.goto(BASE + w.ui("pots", f"/d/{E3}"))
        expect_editor_doc(page, lambda d: d.get("_id") == E3, "direct address opens the document")
    assert w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")["version"] == 2


def test_document_deletion(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    C = w.C("pots")
    with browse(browser, w.editor, w.ui("pots", f"/d/{E3}")) as other:
        expect_editor_doc(other, lambda d: d.get("_id") == E3, "editor has E3 open")
        with browse(browser, w.owner, w.ui("pots", f"/d/{E3}")) as page:
            expect_editor_doc(page, lambda d: d.get("_id") == E3, "owner has E3 open")
            opener = R(page, "button", "Delete document")
            ready(opener).click()
            dlg = R(page, "dialog", "Delete this document?")
            ready(R(dlg, "button", "Cancel")).click()
            eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
            eventually(opener, lambda _t=None: expect(opener).to_be_focused(timeout=_t))
            ready(opener).click()
            ready(R(R(page, "dialog", "Delete this document?"), "button", "Delete")).click()
            eventually(editor_box(page), lambda _t=None: expect(editor_box(page)).to_have_count(0, timeout=_t))
            poll(lambda: active(page).get("within") == E1, "focus moves to the first result after deletion")
        refused(w.api("owner").req("GET", f"{C}/documents/{E3}"), 404, "not_found")
        kit_fill(editor_box(other), compact({**E_DOCS[2], "note": "glued"}))
        ready(editor_box(other), "attached").focus()
        other.keyboard.press("Control+s")
        eventually(save_status(other), lambda _t=None: expect(save_status(other)).to_have_text("This document no longer exists", timeout=_t))
    refused(w.api("reader").req("DELETE", f"{C}/documents/{E4}"), 403, "read_only")
    assert w.api("editor").req("DELETE", f"{C}/documents/{E4}").status_code == 204
    assert count_of(w.api("owner"), C) == 2


def save_in(page: Page, doc: dict) -> None:
    kit_fill(editor_box(page), compact(doc))
    ready(editor_box(page), "attached").focus()
    page.keyboard.press("Control+s")


def test_wf_edit_clash_happy(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}")) as a, browse(browser, w.editor, w.ui("pots", f"/d/{E2}")) as b:
        for p in (a, b):
            expect_editor_doc(p, lambda d: d.get("_id") == E2, "E2 open")
        save_in(a, {**E_DOCS[1], "price": 8})
        eventually(save_status(a), lambda _t=None: expect(save_status(a)).to_have_text("Saved", timeout=_t))
        save_in(b, {**E_DOCS[1], "price": 9})
        clash = b.get_by_role("alert").filter(has_text="This document was changed by someone else.")
        eventually(clash, lambda _t=None: expect(clash).to_be_visible(timeout=_t))
        ready(R(clash, "button", "Reload")).click()
        expect_editor_doc(b, lambda d: d.get("price") == 8, "Reload shows the first person's text")
        save_in(a, {**E_DOCS[1], "price": 10})
        eventually(save_status(a), lambda _t=None: expect(save_status(a)).to_have_text("Saved", timeout=_t))
        save_in(b, {**E_DOCS[1], "price": 12})
        eventually(clash, lambda _t=None: expect(clash).to_be_visible(timeout=_t))
        ready(R(clash, "button", "Overwrite")).click()
        eventually(save_status(b), lambda _t=None: expect(save_status(b)).to_have_text("Saved", timeout=_t))
    stored = w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")
    assert stored["version"] == 4 and stored["document"]["price"] == 12


def test_wf_edit_clash_race(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}")) as a, browse(browser, w.editor, w.ui("pots", f"/d/{E2}")) as b:
        for p in (a, b):
            expect_editor_doc(p, lambda d: d.get("_id") == E2, "E2 open")
        kit_fill(editor_box(a), compact({**E_DOCS[1], "price": 31}))
        kit_fill(editor_box(b), compact({**E_DOCS[1], "price": 32}))
        ready(editor_box(a), "attached").focus()
        ready(editor_box(b), "attached").focus()
        a.keyboard.press("Control+s")
        b.keyboard.press("Control+s")

        def outcome() -> tuple | None:
            s = [save_status(p).inner_text().strip() == "Saved" if save_status(p).count() else False for p in (a, b)]
            c = [p.get_by_role("alert").filter(has_text="This document was changed by someone else.").count() > 0 for p in (a, b)]
            return (s, c) if sorted(s) == [False, True] and sorted(c) == [False, True] and s != c else None

        s, c = poll(outcome, "exactly one save wins and the other sees the clash alert")
    stored = w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")
    assert stored["version"] == 2 and stored["document"]["price"] == (31 if s[0] else 32)


def test_wf_edit_clash_grid_focus(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    C = w.C("pots")
    with browse(browser, w.editor, w.ui("pots")) as page:
        ready(R(page, "radio", "Table")).click()
        expect_ids(page, grid_row_ids, E_IDS, "all rows")
        ready(R(page, "radio", "Table"), "attached").focus()
        tab_to_grid_cell(page)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        assert (active(page)["doc"], active(page)["field"]) == (E3, "_id")
        page.keyboard.press("Enter")
        expect_editor_doc(page, lambda d: d.get("_id") == E3, "Enter opens E3")
        w.api("owner").j("PUT", f"{C}/documents/{E3}", {"document": {**E_DOCS[2], "note": "owner"}, "version": 1})
        box = editor_box(page)
        kit_fill(box, compact({**E_DOCS[2], "note": "mine"}))
        ready(box, "attached").focus()
        page.keyboard.press("Control+s")
        clash = page.get_by_role("alert").filter(has_text="This document was changed by someone else.")
        eventually(clash, lambda _t=None: expect(clash).to_be_visible(timeout=_t))
        ready(R(clash, "button", "Overwrite")).click()
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        ready(R(page, "button", "Close")).click()
        poll(lambda: (active(page).get("doc"), active(page).get("field")) == (E3, "_id"),
             "Close returns focus to the grid cell that opened the editor (L252)")
        page.goto(BASE + w.ui("pots", f"/d/{E2}"))
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "direct address opens E2")
        ready(R(page, "button", "Close")).click()
        poll(lambda: active(page).get("within") == E1, "with no opener, Close moves focus to the first result (L252)")
        page.goto(BASE + w.ui("pots", f"/d/{E4}"))
        expect_editor_doc(page, lambda d: d.get("_id") == E4, "direct address opens E4")
        ready(R(page, "button", "Delete document")).click()
        ready(R(R(page, "dialog", "Delete this document?"), "button", "Delete")).click()
        eventually(R(page, "dialog", "Delete this document?"), lambda _t=None: expect(R(page, "dialog", "Delete this document?")).to_have_count(0, timeout=_t))
        poll(lambda: active(page).get("within") == E1, "Delete moves focus to the first result (L254)")
    api = w.api("owner")
    stored = api.j("GET", f"{C}/documents/{E3}")
    assert stored["version"] == 3 and stored["document"]["note"] == "mine"
    refused(api.req("GET", f"{C}/documents/{E4}"), 404, "not_found")


def test_change_feed() -> None:
    w = World({"feed": [], "side": []})
    api, C = w.api("editor"), w.C("feed")
    s = api.j("GET", C)["sequence"]
    stream = EventStream(w.api("reader"), f"{C}/events", params={"after": str(s)})
    try:
        d = api.j("POST", f"{C}/documents", {"document": {"x": 1}}, 201)["document"]
        api.j("PUT", f"{C}/documents/{d['_id']}", {"document": {**d, "x": 2}, "version": 1})
        assert api.req("DELETE", f"{C}/documents/{d['_id']}").status_code == 204
        ids = [hexid("a", i) for i in (1, 2, 3)]
        load_file(api, C, "".join(compact({"_id": i}) + "\n" for i in ids).encode())
        side = api.j("POST", f"{w.C('side')}/documents", {"document": {"y": 1}}, 201)["document"]["_id"]
        api.j("POST", f"{C}/documents", {"document": {"marker": True}}, 201)
        stream.wait_for(lambda st: len(st.changes()) >= 7, "seven changes after the current sequence")  # static: EventStream.wait_for blocks on the server event stream over httpx; no page or page clock is involved
        assert stream.status == 200 and stream.ctype.startswith("text/event-stream"), (stream.status, stream.ctype)
        ch = stream.changes()[:7]
        assert [c["seq"] for c in ch] == list(range(s + 1, s + 8))
        assert [c["_event_id"] for c in ch] == [str(n) for n in range(s + 1, s + 8)]
        assert [c["op"] for c in ch] == ["insert", "update", "delete", "insert", "insert", "insert", "insert"]
        assert ch[0]["document"] == {"_id": d["_id"], "x": 1} and ch[0]["version"] == 1
        assert ch[1]["document"]["x"] == 2 and ch[1]["version"] == 2
        assert ch[2]["document"] is None and ch[2]["version"] is None and ch[2]["_id"] == d["_id"]
        assert [c["_id"] for c in ch[3:6]] == ids
        assert all(c["_id"] != side for c in stream.changes())
    finally:
        stream.close()
    assert api.j("GET", C)["sequence"] == s + 7


def test_feed_catch_up() -> None:
    w = World({"feed": []})
    api, C = w.api("editor"), w.C("feed")
    s = api.j("GET", C)["sequence"]
    for i in range(5):
        api.j("POST", f"{C}/documents", {"document": {"i": i}}, 201)
    a = EventStream(w.api("reader"), f"{C}/events", headers={"Last-Event-ID": str(s + 2)})
    try:
        api.j("POST", f"{C}/documents", {"document": {"i": 5}}, 201)
        a.wait_for(lambda st: any(c["seq"] == s + 6 for c in st.changes()), "live change after catch-up")  # static: EventStream.wait_for blocks on the server event stream over httpx; no page or page clock is involved
        assert [c["seq"] for c in a.changes()] == [s + 3, s + 4, s + 5, s + 6]
    finally:
        a.close()
    b = EventStream(w.api("reader"), f"{C}/events", params={"after": str(s)})
    try:
        b.wait_for(lambda st: any(c["seq"] == s + 6 for c in st.changes()), "catch-up from after=")  # static: EventStream.wait_for blocks on the server event stream over httpx; no page or page clock is involved
        api.j("POST", f"{C}/documents", {"document": {"i": 6}}, 201)
        b.wait_for(lambda st: any(c["seq"] == s + 7 for c in st.changes()), "next live change")  # static: EventStream.wait_for blocks on the server event stream over httpx; no page or page clock is involved
        seqs = [c["seq"] for c in b.changes()]
        assert seqs == list(range(s + 1, s + 8)), f"catch-up gave {seqs}"
        assert [c["document"]["i"] for c in b.changes()] == list(range(7))
    finally:
        b.close()


LIVE_DOCS = [{"_id": hexid("1", i), "kind": "keep", "label": f"l{i}"} for i in (1, 2, 3)] + [{"_id": hexid("1", 4), "kind": "other"}]
L1, L2, L3 = (LIVE_DOCS[i]["_id"] for i in range(3))


def test_live_results(browser: Browser) -> None:
    w = World({"live": LIVE_DOCS})
    ed, C = w.api("editor"), w.C("live")
    wait = LIVE_MS + LIVE_SLACK_MS
    with browse(browser, w.owner, w.ui("live", f"/d/{L1}")) as page:
        run_query(page, '{"kind":"keep"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(3, 3), timeout=_t))
        box = editor_box(page)
        expect_editor_doc(page, lambda d: d.get("_id") == L1, "L1 open")
        kit_fill(box, compact({"_id": L1, "kind": "keep", "label": "draft-only"}))
        ready(box, "attached").focus()
        draft = content(box)
        new = ed.j("POST", f"{C}/documents", {"document": {"kind": "keep", "label": "fresh"}}, 201)["document"]["_id"]
        eventually(R(page, "list", "Documents").locator(f'[data-doc-id="{new}"]'), lambda _t=wait: expect(R(page, "list", "Documents").locator(f'[data-doc-id="{new}"]')).to_be_visible(timeout=_t))
        eventually(qstatus(page), lambda _t=wait: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ed.j("POST", f"{C}/documents", {"document": {"kind": "other"}}, 201)
        ed.j("PUT", f"{C}/documents/{L2}", {"document": {**LIVE_DOCS[1], "kind": "drop"}, "version": 1})
        eventually(R(page, "list", "Documents").locator(f'[data-doc-id="{L2}"]'), lambda _t=wait: expect(R(page, "list", "Documents").locator(f'[data-doc-id="{L2}"]')).to_have_count(0, timeout=_t))
        eventually(qstatus(page), lambda _t=wait: expect(qstatus(page)).to_have_text(matched_text(3, 3), timeout=_t))
        assert ed.req("DELETE", f"{C}/documents/{L3}").status_code == 204
        eventually(R(page, "list", "Documents").locator(f'[data-doc-id="{L3}"]'), lambda _t=wait: expect(R(page, "list", "Documents").locator(f'[data-doc-id="{L3}"]')).to_have_count(0, timeout=_t))
        eventually(qstatus(page), lambda _t=wait: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
        assert content(box) == draft, "a live update touched the editor draft"
        assert focus_inside(box), "a live update moved focus"
    assert query(ed, C, filter={"kind": "keep"})["matched"] == 2


def test_reader_workspace(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.reader, w.ui("pots", f"/d/{E2}")) as page:
        eventually(page.get_by_text("You have read access", exact=True), lambda _t=None: expect(page.get_by_text("You have read access", exact=True)).to_be_visible(timeout=_t))
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "reader can open E2")
        eventually(editor_box(page), lambda _t=None: expect(editor_box(page)).not_to_be_editable(timeout=_t))
        for name in ("Insert document", "Load file", "Save query", "Save", "Delete document"):
            eventually(R(page, "button", name), lambda _t=None: expect(R(page, "button", name)).to_have_count(0, timeout=_t))
        eventually(R(page, "button", "Download"), lambda _t=None: expect(R(page, "button", "Download")).to_be_visible(timeout=_t))
        page.goto(BASE + w.ui("pots", "/rules"))
        eventually(page.get_by_text("You have read access", exact=True), lambda _t=None: expect(page.get_by_text("You have read access", exact=True)).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Save rules"), lambda _t=None: expect(R(page, "button", "Save rules")).to_have_count(0, timeout=_t))


def test_wf_live_collection_happy(browser: Browser) -> None:
    w = World({"live": LIVE_DOCS})
    wait = LIVE_MS + LIVE_SLACK_MS
    with browse(browser, w.reader, w.ui("live")) as rd:
        run_query(rd, '{"kind":"keep"}')
        eventually(qstatus(rd), lambda _t=None: expect(qstatus(rd)).to_have_text(matched_text(3, 3), timeout=_t))
        rd.evaluate("() => { window.__noReload = 1; }")
        docs = R(rd, "list", "Documents")
        with browse(browser, w.editor, w.ui("live")) as ed:
            ready(R(ed, "button", "Insert document")).click()
            save_in(ed, {"kind": "keep", "label": "fresh"})
            eventually(save_status(ed), lambda _t=None: expect(save_status(ed)).to_have_text("Saved", timeout=_t))
            eventually(qstatus(rd), lambda _t=wait: expect(qstatus(rd)).to_have_text(matched_text(4, 4), timeout=_t))
            new = re.search(r"/d/([0-9a-f]{24})$", ed.url).group(1)
            eventually(docs.locator(f'[data-doc-id="{new}"]'), lambda _t=wait: expect(docs.locator(f'[data-doc-id="{new}"]')).to_be_visible(timeout=_t))
            ed.goto(BASE + w.ui("live", f"/d/{L2}"))
            expect_editor_doc(ed, lambda d: d.get("_id") == L2, "editor opens L2")
            save_in(ed, {**LIVE_DOCS[1], "label": "changed"})
            eventually(save_status(ed), lambda _t=None: expect(save_status(ed)).to_have_text("Saved", timeout=_t))
            eventually(docs.locator(f'[data-doc-id="{L2}"]'), lambda _t=wait: expect(docs.locator(f'[data-doc-id="{L2}"]')).to_contain_text("label: changed", timeout=_t))
            ed.goto(BASE + w.ui("live", f"/d/{new}"))
            expect_editor_doc(ed, lambda d: d.get("_id") == new, "editor opens the new document")
            save_in(ed, {"_id": new, "kind": "drop", "label": "fresh"})
            eventually(save_status(ed), lambda _t=None: expect(save_status(ed)).to_have_text("Saved", timeout=_t))
            eventually(docs.locator(f'[data-doc-id="{new}"]'), lambda _t=wait: expect(docs.locator(f'[data-doc-id="{new}"]')).to_have_count(0, timeout=_t))
            ed.goto(BASE + w.ui("live", f"/d/{L1}"))
            ready(R(ed, "button", "Delete document")).click()
            ready(R(R(ed, "dialog", "Delete this document?"), "button", "Delete")).click()
            eventually(docs.locator(f'[data-doc-id="{L1}"]'), lambda _t=wait: expect(docs.locator(f'[data-doc-id="{L1}"]')).to_have_count(0, timeout=_t))
            eventually(qstatus(rd), lambda _t=wait: expect(qstatus(rd)).to_have_text(matched_text(2, 2), timeout=_t))
        assert rd.evaluate("() => window.__noReload") == 1, "the reader's page reloaded"
    assert query(w.api("reader"), w.C("live"), filter={"kind": "keep"})["ids"] == [L2, L3]


def test_wf_live_collection_role_change(browser: Browser) -> None:
    w = World({"live": LIVE_DOCS})
    wait = LIVE_MS + LIVE_SLACK_MS
    with browse(browser, w.reader, w.ui("live", f"/d/{L1}")) as page:
        eventually(page.get_by_text("You have read access", exact=True), lambda _t=None: expect(page.get_by_text("You have read access", exact=True)).to_be_visible(timeout=_t))
        eventually(editor_box(page), lambda _t=None: expect(editor_box(page)).not_to_be_editable(timeout=_t))
        w.api("owner").j("PATCH", f"{w.P}/members/{w.uid('reader')}", {"role": "editor"})
        eventually(page.get_by_text("You have read access", exact=True), lambda _t=wait: expect(page.get_by_text("You have read access", exact=True)).to_have_count(0, timeout=_t))
        eventually(editor_box(page), lambda _t=wait: expect(editor_box(page)).to_be_editable(timeout=_t))
        save_in(page, {**LIVE_DOCS[0], "label": BY_NEW_EDITOR})
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
    stored = w.api("owner").j("GET", f"{w.C('live')}/documents/{L1}")
    assert stored["version"] == 2 and stored["document"]["label"] == BY_NEW_EDITOR


def test_wf_live_collection_boundary(browser: Browser) -> None:
    w = World({"live": LIVE_DOCS})
    C = w.C("live")
    with browse(browser, w.reader, w.ui("live")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        eventually(R(page, "button", "Insert document"), lambda _t=None: expect(R(page, "button", "Insert document")).to_have_count(0, timeout=_t))
        r = page.request.post(BASE + f"{C}/documents", data={"document": {"kind": "keep"}})
        assert r.status == 403 and r.json()["error"] == "read_only"
    with browse(browser, w.outsider, w.ui("live")) as page:
        eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
    s = EventStream(w.api("outsider"), f"{C}/events")
    assert s.opened.wait(HTTP_TIMEOUT), "the outsider's stream request never answered"
    s.close()
    assert s.status == 404
    assert count_of(w.api("owner"), C) == 4


def test_wf_live_collection_grid_keys(browser: Browser) -> None:
    w = World({"live": LIVE_DOCS})
    ed, C = w.api("editor"), w.C("live")
    wait = LIVE_MS + LIVE_SLACK_MS
    with browse(browser, w.reader, w.ui("live")) as page:
        run_query(page, '{"kind":"keep"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(3, 3), timeout=_t))
        ready(R(page, "radio", "List"), "attached").focus()
        page.keyboard.press("ArrowRight")
        eventually(R(page, "radio", "Table"), lambda _t=None: expect(R(page, "radio", "Table")).to_be_checked(timeout=_t))
        expect_ids(page, grid_row_ids, [L1, L2, L3], "kept rows")
        tab_to_grid_cell(page)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        assert (active(page)["doc"], active(page)["field"]) == (L3, "_id")
        new = ed.j("POST", f"{C}/documents", {"document": {"kind": "keep", "label": "fresh"}}, 201)["document"]["_id"]
        eventually(R(page, "grid", "Documents").locator(f'[data-doc-id="{new}"]').first, lambda _t=wait: expect(R(page, "grid", "Documents").locator(f'[data-doc-id="{new}"]').first).to_be_visible(timeout=_t))
        eventually(qstatus(page), lambda _t=wait: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        assert (active(page)["doc"], active(page)["field"]) == (L3, "_id"), "a live insert moved focus (L266)"
        cells = R(page, "grid", "Documents").locator("[data-doc-id][data-field-path]")
        assert cells.evaluate_all("els => els.filter(e => e.tabIndex >= 0).length") == 1, "exactly one grid cell stays in the tab order (L246)"
        page.keyboard.press("ArrowRight")
        assert (active(page)["doc"], active(page)["field"]) == (L3, "kind"), \
            f"ArrowRight after a live update must move one cell from the focused cell (L246, L266), went to {active(page)}"
        page.keyboard.press("End")
        assert (active(page)["doc"], active(page)["field"]) == (L3, "label")
    assert query(ed, C, filter={"kind": "keep"})["matched"] == 4


def test_signup_with_emailed_code(mail: Any) -> None:
    tag = uuid.uuid4().hex[:10]
    email = f"new-{tag}@jarful-tests.example"
    api = Api()
    for body, field in [({"email": "not-an-email", "password": "Pw345678", "name": "N"}, "email"),
                        ({"email": email, "password": "short77", "name": "N"}, "password"),
                        ({"email": email, "password": "Pw345678", "name": ""}, "name"),
                        ({"email": email, "password": "Pw345678", "name": "n" * 81}, "name")]:
        refused(api.req("POST", "/api/auth/signup", body), 422, "invalid_field", field=field)
    assert api.j("POST", "/api/auth/signup", {"email": email.upper(), "password": "Pw345678", "name": NOVA}, 201) == {"status": "code_sent"}
    first = inbox(mail, email, 1)
    assert first[0].get("Subject") == "Your Jarful code"
    code1 = code_in(first[0])
    refused(api.req("POST", "/api/auth/signin", {"email": email, "password": "Pw345678"}), 409, "not_confirmed")
    refused(api.req("POST", "/api/auth/confirm", {"email": email, "code": f"{(int(code1) + 1) % 1000000:06d}"}), 422, "invalid_code")
    api.j("POST", "/api/auth/signup", {"email": email, "password": "Pw345678", "name": NOVA}, 201)
    code2 = next(c for c in (code_in(m) for m in inbox(mail, email, 2)) if c != code1) if len({code_in(m) for m in inbox(mail, email, 2)}) > 1 else code1
    if code2 != code1:
        refused(api.req("POST", "/api/auth/confirm", {"email": email, "code": code1}), 422, "invalid_code")
    assert api.j("POST", "/api/auth/resend", {"email": email}, 202) == {"status": "code_sent"}
    msgs = inbox(mail, email, 3)
    codes = [code_in(m) for m in msgs]
    code3 = next((c for c in codes if c not in (code1, code2)), None)
    assert code3, f"resend must mail a new code; saw {codes}"
    user = api.j("POST", "/api/auth/confirm", {"email": email, "code": code3})["user"]
    assert user["email"] == email and user["name"] == NOVA and user["id"]
    assert api.j("GET", "/api/me")["user"]["email"] == email
    refused(Api().req("POST", "/api/auth/confirm", {"email": email, "code": code3}), 422, "invalid_code")
    refused(api.req("POST", "/api/auth/signup", {"email": email, "password": "Pw345678", "name": NOVA}), 409, "email_taken")
    api.j("POST", "/api/auth/resend", {"email": email}, 202)
    assert len(inbox(mail, email, 3)) == 3, "resend for a confirmed address must send nothing"


def test_signin_and_sessions(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    api = Api()
    refused(api.req("POST", "/api/auth/signin", {"email": w.owner["email"], "password": "wrong-password"}), 401, "invalid_credentials")
    refused(api.req("GET", "/api/me"), 401, "unauthenticated")
    r = api.req("POST", "/api/auth/signin", {"email": w.owner["email"], "password": w.owner["password"]})
    assert r.status_code == 200 and r.json()["user"]["email"] == w.owner["email"]
    cookie = " ".join(r.headers.get_list("set-cookie")).lower()
    assert all(flag in cookie for flag in COOKIE_FLAGS), cookie
    assert api.j("GET", "/api/me")["user"]["name"] == w.owner["name"]
    assert api.req("POST", "/api/auth/signout").status_code == 204
    refused(api.req("GET", "/api/me"), 401, "unauthenticated")
    with browse(browser, None, "/signin") as page:
        kit_fill(R(page, "textbox", "Email"), w.owner["email"])
        kit_fill(R(page, "textbox", "Password"), w.owner["password"])
        ready(R(page, "button", "Sign in")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(r"/projects$"), timeout=_t))
        ready(R(page, "button", "Account")).click()
        ready(R(R(page, "menu", "Account"), "menuitem", "Sign out")).click()
        poll(lambda: page.request.get(BASE + "/api/me").status == 401, "Sign out ends the session")
    with browse(browser, None, f"/p/{w.pid}") as page:
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(r"/signin"), timeout=_t))
        kit_fill(R(page, "textbox", "Email"), w.owner["email"])
        kit_fill(R(page, "textbox", "Password"), w.owner["password"])
        ready(R(page, "button", "Sign in")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(f"/p/{w.pid}") + "$"), timeout=_t))


def test_invitation_states(mail: Any) -> None:
    w = World(extra=("invitee", "second"))
    own, P = w.api("owner"), w.P
    inv = own.j("POST", f"{P}/invitations", {"email": w["invitee"]["email"].upper(), "role": "editor"}, 201)["invitation"]
    assert inv["state"] == "pending" and inv["role"] == "editor" and inv["email"].lower() == w["invitee"]["email"]
    refused(own.req("POST", f"{P}/invitations", {"email": w["invitee"]["email"], "role": "reader"}), 409, "already_invited")
    refused(own.req("POST", f"{P}/invitations", {"email": w.reader["email"], "role": "reader"}), 409, "already_member")
    refused(own.req("POST", f"{P}/invitations", {"email": f"x-{w.tag}@jarful-tests.example", "role": "owner"}), 422, "invalid_field", field="role")
    refused(w.api("editor").req("POST", f"{P}/invitations", {"email": f"y-{w.tag}@jarful-tests.example", "role": "reader"}), 403, "read_only")
    mine = w.api("invitee").j("GET", "/api/invitations")["invitations"]
    assert [(i["id"], i["project"], i["role"], i["inviter"]["name"]) for i in mine] == [(inv["id"], {"id": w.pid, "name": w.project}, "editor", w.owner["name"])]
    refused(w.api("second").req("POST", f"/api/invitations/{inv['id']}/accept"), 404, "not_found")
    assert w.api("invitee").j("POST", f"/api/invitations/{inv['id']}/accept") == {"project_id": w.pid}
    members = own.j("GET", f"{P}/members")["members"]
    assert {"email": w["invitee"]["email"], "role": "editor"}.items() <= next(m for m in members if m["email"] == w["invitee"]["email"]).items()
    refused(w.api("invitee").req("POST", f"/api/invitations/{inv['id']}/accept"), 409, "invitation_closed")
    refused(own.req("DELETE", f"{P}/invitations/{inv['id']}"), 409, "invitation_closed")
    inv2 = own.j("POST", f"{P}/invitations", {"email": w["second"]["email"], "role": "reader"}, 201)["invitation"]
    assert own.j("DELETE", f"{P}/invitations/{inv2['id']}")["invitation"]["state"] == "revoked"
    refused(own.req("DELETE", f"{P}/invitations/{inv2['id']}"), 409, "invitation_closed")
    refused(w.api("second").req("POST", f"/api/invitations/{inv2['id']}/accept"), 409, "invitation_closed")
    third = f"third-{w.tag}@jarful-tests.example"
    inv3 = own.j("POST", f"{P}/invitations", {"email": third, "role": "reader"}, 201)["invitation"]
    assert [i["id"] for i in own.j("GET", f"{P}/members")["invitations"]] == [inv3["id"]]
    assert w.api("editor").j("GET", f"{P}/members")["invitations"] == []
    assert w.api("second").j("GET", "/api/invitations")["invitations"] == []


def test_invitation_email(mail: Any) -> None:
    w = World()
    to = f"guest-{w.tag}@jarful-tests.example"
    w.api("owner").j("POST", f"{w.P}/invitations", {"email": to, "role": "reader"}, 201)
    refused(w.api("owner").req("POST", f"{w.P}/invitations", {"email": to, "role": "editor"}), 409, "already_invited")
    msgs = inbox(mail, to, 1)
    settled = [m for m in mail.messages(1, 2.0) if to in [a.lower() for a in kit("addresses")(m.get("To"))]]
    assert len(settled) == 1, f"expected exactly one invitation mail, saw {len(settled)}"
    m = msgs[0]
    assert m.get("Subject") == f"You're invited to {w.project} on Jarful"
    body = mail_text(m)
    assert f"{w.owner['name']} invited you to {w.project} as reader." in body, body
    public = os.environ.get("APP_PUBLIC_URL")
    assert (f"{public.rstrip('/')}/invites" in body) if public else re.search(r"https?://\S+/invites", body), body
    assert "hello@jarful.test" in [a.lower() for a in kit("addresses")(m.get("From"))]


def test_role_checks_per_request() -> None:
    w = World({"pots": {"documents": E_DOCS, "saved_queries": [{"name": "all", "filter": {}, "projection": None, "sort": None, "limit": 0}]}})
    C, P = w.C("pots"), w.P
    rd, ed, own = w.api("reader"), w.api("editor"), w.api("owner")
    sq = w.cols["pots"]["saved_queries"]["all"]
    for method, path, body in [("POST", f"{C}/documents", {"document": {"x": 1}}), ("PUT", f"{C}/documents/{E1}", {"document": E_DOCS[0], "version": 1}),
                               ("DELETE", f"{C}/documents/{E1}", NOBODY), ("POST", f"{C}/saved-queries", {"name": "q", "filter": {}, "projection": None, "sort": None, "limit": 0}),
                               ("DELETE", f"{C}/saved-queries/{sq}", NOBODY)]:
        refused(rd.req(method, path, body), 403, "read_only")
    refused(load_file(rd, C, b'{"x":1}\n'), 403, "read_only")
    for method, path, body in [("POST", f"{P}/collections", {"name": "nope"}), ("DELETE", C, NOBODY), ("POST", f"{C}/indexes", {"keys": {"x": 1}, "unique": False}),
                               ("DELETE", f"{C}/indexes/_id_", NOBODY), ("PUT", f"{C}/validator", {"validator": None}),
                               ("POST", f"{P}/invitations", {"email": f"z-{w.tag}@jarful-tests.example", "role": "reader"}),
                               ("PATCH", f"{P}/members/{w.uid('reader')}", {"role": "editor"}), ("DELETE", f"{P}/members/{w.uid('reader')}", NOBODY),
                               ("DELETE", P, NOBODY)]:
        refused(ed.req(method, path, body), 403, "read_only")
    assert [c["name"] for c in own.j("GET", f"{P}/collections")["collections"]] == ["pots"]
    assert count_of(own, C) == 4 and [i["name"] for i in own.j("GET", f"{C}/indexes")["indexes"]] == ["_id_"]
    assert query(rd, C)["matched"] == 4
    agg(rd, C, [{"$match": {}}], page=1)
    rd.j("POST", f"{C}/saved-queries/{sq}/run", {"page": 1})
    rd.j("POST", f"{C}/exports", {"format": "jsonl", "filter": {}, "sort": None}, 201)
    rd.j("GET", f"{P}/members")
    ed.j("POST", f"{C}/documents", {"document": {"by": "editor"}}, 201)
    own.j("PATCH", f"{P}/members/{w.uid('editor')}", {"role": "reader"})
    refused(ed.req("POST", f"{C}/documents", {"document": {"x": 2}}), 403, "read_only")
    own.j("PATCH", f"{P}/members/{w.uid('editor')}", {"role": "editor"})
    ed.j("POST", f"{C}/documents", {"document": {"x": 3}}, 201)
    refused(own.req("PATCH", f"{P}/members/{w.uid('owner')}", {"role": "reader"}), 422, "owner_role_fixed")
    refused(own.req("DELETE", f"{P}/members/{w.uid('owner')}"), 422, "owner_role_fixed")
    refused(own.req("PATCH", f"{P}/members/{w.uid('editor')}", {"role": "admin"}), 422, "invalid_field", field="role")


def test_not_found_for_outsiders(browser: Browser) -> None:
    w = World({"pots": {"documents": E_DOCS, "saved_queries": [{"name": "all", "filter": {}, "projection": None, "sort": None, "limit": 0}]}}, extra=("invitee",))
    own, out = w.api("owner"), w.api("outsider")
    C = w.C("pots")
    iid = load_file(own, C, b'{"x":1}\n').json()["import_id"]
    exp = own.j("POST", f"{C}/exports", {"format": "jsonl", "filter": {}, "sort": None}, 201)
    inv = own.j("POST", f"{w.P}/invitations", {"email": w["invitee"]["email"], "role": "reader"}, 201)["invitation"]
    ghost = str(uuid.uuid4())
    pairs = [
        (("GET", w.P), ("GET", f"/api/projects/{ghost}")),
        (("GET", C), ("GET", f"{w.P}/collections/{ghost}")),
        (("GET", f"{C}/documents/{E1}"), ("GET", f"{C}/documents/{hexid('e', 999)}")),
        (("POST", f"{C}/saved-queries/{w.cols['pots']['saved_queries']['all']}/run"), ("POST", f"{C}/saved-queries/{ghost}/run")),
        (("GET", f"{C}/imports/{iid}"), ("GET", f"{C}/imports/{ghost}")),
        (("GET", f"{C}/imports/{iid}/original"), ("GET", f"{C}/imports/{ghost}/original")),
        (("GET", exp["download_url"]), ("GET", f"{w.P}/exports/{ghost}")),
        (("POST", f"/api/invitations/{inv['id']}/accept"), ("POST", f"/api/invitations/{ghost}/accept")),
    ]
    for (m1, p1), (m2, p2) in pairs:
        body = {"page": 1} if p1.endswith("/run") else NOBODY
        a, b = out.req(m1, p1, body), out.req(m2, p2, {"page": 1} if p2.endswith("/run") else NOBODY)
        assert (a.status_code, a.json()) == (b.status_code, b.json()) == (404, {"error": "not_found"}), f"{p1}: {a.status_code} {a.text} vs {b.status_code} {b.text}"
    refused(out.req("PUT", f"{C}/documents/{E1}", {"document": "not an object"}), 404, "not_found")
    refused(w.api("reader").req("DELETE", f"/api/projects/{w.other_pid}/collections/{w.other['id']}/documents/{w.other['documents'][0]}"), 404, "not_found")
    with browse(browser, w.outsider, f"/p/{w.pid}") as page:
        eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
        page.goto(BASE + w.ui("pots", f"/d/{E1}"))
        eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
        page.goto(BASE + f"/p/{ghost}")
        eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
    rd = w.api("reader")
    assert query(rd, C)["matched"] == 5
    assert own.req("DELETE", f"{w.P}/members/{w.uid('reader')}").status_code == 204
    refused(rd.req("POST", f"{C}/query", {}), 404, "not_found")


def test_downgrade_in_open_editor(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    C = w.C("pots")
    stream = EventStream(w.api("editor"), f"{C}/events")
    try:
        with browse(browser, w.editor, w.ui("pots", f"/d/{E2}")) as page:
            expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open")
            eventually(editor_box(page), lambda _t=None: expect(editor_box(page)).to_be_editable(timeout=_t))
            w.api("owner").j("PATCH", f"{w.P}/members/{w.uid('editor')}", {"role": "reader"})
            wait = LIVE_MS + LIVE_SLACK_MS
            eventually(editor_box(page), lambda _t=wait: expect(editor_box(page)).not_to_be_editable(timeout=_t))
            eventually(page.get_by_text("You have read access", exact=True), lambda _t=wait: expect(page.get_by_text("You have read access", exact=True)).to_be_visible(timeout=_t))
            r = page.request.put(BASE + f"{C}/documents/{E2}", data={"document": {**E_DOCS[1], "price": 1}, "version": 1})
            assert r.status == 403 and r.json() == {"error": "read_only"}
        stream.wait_for(lambda st: {"role": "reader"} in st.roles(), "role event for the downgraded member")  # static: EventStream.wait_for blocks on the server event stream over httpx; no page or page clock is involved
    finally:
        stream.close()
    assert w.api("owner").j("GET", f"{C}/documents/{E2}")["version"] == 1


def test_landing_routes(browser: Browser) -> None:
    w = World({"pots": E_DOCS}, extra=("invitee",))
    name = f"Fresh {w.tag}"
    with browse(browser, w.owner, "/projects") as page:
        eventually(R(page, "heading", "YOUR JARS"), lambda _t=None: expect(R(page, "heading", "YOUR JARS")).to_be_visible(timeout=_t))
        eventually(R(page, "heading", "PUT IT IN THE JAR"), lambda _t=None: expect(R(page, "heading", "PUT IT IN THE JAR")).to_be_visible(timeout=_t))
        kit_fill(R(page, "textbox", "Project name"), name)
        kit_fill(R(page, "textbox", "First collection name"), "first-jar")
        ready(R(page, "button", "Create project")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(r"/p/[^/]+/c/[^/?#]+$"), timeout=_t))
        pid, cid = re.search(r"/p/([^/]+)/c/([^/?#]+)$", page.url).groups()
        page.reload()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(f"/p/{pid}/c/{cid}") + "$"), timeout=_t))
        eventually(R(query_bar(page), "textbox", "Filter"), lambda _t=None: expect(R(query_bar(page), "textbox", "Filter")).to_be_visible(timeout=_t))
        eventually(R(R(page, "navigation", "Project"), "link", "first-jar"), lambda _t=None: expect(R(R(page, "navigation", "Project"), "link", "first-jar")).to_be_visible(timeout=_t))
    projects = w.api("owner").j("GET", "/api/projects")["projects"]
    assert {"id": pid, "name": name, "role": "owner"} in projects
    assert [c["id"] for c in w.api("owner").j("GET", f"/api/projects/{pid}/collections")["collections"]] == [cid]
    w.api("owner").j("POST", f"{w.P}/invitations", {"email": w["invitee"]["email"], "role": "reader"}, 201)
    with browse(browser, w["invitee"], "/invites") as page:
        item = R(page, "list", "Invitations").get_by_role("listitem").filter(has_text=f"{w.project} as reader from {w.owner['name']}")
        ready(R(item, "button", "Accept")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(f"/p/{w.pid}") + "$"), timeout=_t))
        page.reload()
        eventually(R(page, "list", "Collections"), lambda _t=None: expect(R(page, "list", "Collections")).to_contain_text("pots", timeout=_t))
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(f"/p/{w.pid}") + "$"), timeout=_t))


def test_members_screen(browser: Browser) -> None:
    w = World()
    own = w.api("owner")
    guest = f"guest-{w.tag}@jarful-tests.example"
    with browse(browser, w.owner, f"/p/{w.pid}/members") as page:
        eventually(R(page, "list", "Members"), lambda _t=None: expect(R(page, "list", "Members")).to_contain_text(w.reader["email"], timeout=_t))
        kit = R(page, "combobox", f"Role for {w.reader['email']}")
        kit_select = conftest.select
        kit_select(kit, "editor")
        poll(lambda: next(m for m in own.j("GET", f"{w.P}/members")["members"] if m["email"] == w.reader["email"])["role"] == "editor", "role change saved")
        ready(R(page, "button", f"Remove {w.editor['email']}")).click()
        poll(lambda: all(m["email"] != w.editor["email"] for m in own.j("GET", f"{w.P}/members")["members"]), "member removed")
        kit_fill(R(page, "textbox", "Invite email"), guest)
        kit_select(R(page, "combobox", "Invite role"), "reader")
        ready(R(page, "button", "Send invitation")).click()
        eventually(R(page, "status", "Members status"), lambda _t=None: expect(R(page, "status", "Members status")).to_have_text(f"Invitation created for {guest}", timeout=_t))
        eventually(R(page, "list", "Pending invitations"), lambda _t=None: expect(R(page, "list", "Pending invitations")).to_contain_text(guest, timeout=_t))
        kit_fill(R(page, "textbox", "Invite email"), w.reader["email"])
        ready(R(page, "button", "Send invitation")).click()
        eventually(R(page, "status", "Members status"), lambda _t=None: expect(R(page, "status", "Members status")).to_have_text("Already a member", timeout=_t))
        ready(R(page, "button", f"Revoke {guest}")).click()
        poll(lambda: own.j("GET", f"{w.P}/members")["invitations"] == [], "invitation revoked")
    with browse(browser, w.reader, f"/p/{w.pid}/members") as page:
        eventually(R(page, "list", "Members"), lambda _t=None: expect(R(page, "list", "Members")).to_contain_text(w.owner["email"], timeout=_t))
        eventually(R(page, "button", "Send invitation"), lambda _t=None: expect(R(page, "button", "Send invitation")).to_have_count(0, timeout=_t))
        eventually(R(page, "combobox", f"Role for {w.reader['email']}"), lambda _t=None: expect(R(page, "combobox", f"Role for {w.reader['email']}")).to_have_count(0, timeout=_t))


def signup_ui(page: Page, email: str, password: str, name: str) -> None:
    page.goto(BASE + "/signup")
    kit_fill(R(page, "textbox", "Name"), name)
    kit_fill(R(page, "textbox", "Email"), email)
    kit_fill(R(page, "textbox", "Password"), password)
    ready(R(page, "button", "Create account")).click()
    eventually(R(page, "status", "Account status"), lambda _t=None: expect(R(page, "status", "Account status")).to_have_text(f"Check {email} for your code", timeout=_t))


def test_wf_invite_roles_happy(browser: Browser, mail: Any) -> None:
    w = World({"pots": E_DOCS})
    to = f"invitee-{w.tag}@jarful-tests.example"
    with browse(browser, w.owner, f"/p/{w.pid}/members") as owner_page:
        kit_fill(R(owner_page, "textbox", "Invite email"), to)
        conftest.select(R(owner_page, "combobox", "Invite role"), "reader")
        ready(R(owner_page, "button", "Send invitation")).click()
        eventually(R(owner_page, "status", "Members status"), lambda _t=None: expect(R(owner_page, "status", "Members status")).to_have_text(f"Invitation created for {to}", timeout=_t))
        invite = inbox(mail, to, 1)[0]
        assert f"{w.owner['name']} invited you to {w.project} as reader." in mail_text(invite)
        with browse(browser, None, "/") as page:
            signup_ui(page, to, "Pw-invitee-1", "Ivy")
            code = code_in(next(m for m in inbox(mail, to, 2) if m.get("Subject") == "Your Jarful code"))
            kit_fill(R(page, "textbox", "Code"), code)
            ready(R(page, "button", "Confirm")).click()
            ready(R(page, "link", "Invitations")).click()
            item = R(page, "list", "Invitations").get_by_role("listitem").filter(has_text=f"{w.project} as reader from {w.owner['name']}")
            ready(R(item, "button", "Accept")).click()
            eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(f"/p/{w.pid}") + "$"), timeout=_t))
            ready(R(R(page, "navigation", "Project"), "link", "pots")).click()
            eventually(page.get_by_text("You have read access", exact=True), lambda _t=None: expect(page.get_by_text("You have read access", exact=True)).to_be_visible(timeout=_t))
            page.goto(BASE + f"/p/{w.other_pid}")
            eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))
            page.goto(BASE + w.ui("pots", f"/d/{E2}"))
            eventually(editor_box(page), lambda _t=None: expect(editor_box(page)).not_to_be_editable(timeout=_t))
            owner_page.reload()
            conftest.select(R(owner_page, "combobox", f"Role for {to}"), "editor")
            eventually(editor_box(page), lambda _t=LIVE_MS + LIVE_SLACK_MS: expect(editor_box(page)).to_be_editable(timeout=_t))
            save_in(page, {**E_DOCS[1], "price": 9})
            eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
    stored = w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")
    assert stored["version"] == 2 and stored["document"]["price"] == 9
    member = next(m for m in w.api("owner").j("GET", f"{w.P}/members")["members"] if m["email"] == to)
    assert member["role"] == "editor"


def test_wf_invite_roles_wrong_code(browser: Browser, mail: Any) -> None:
    tag = uuid.uuid4().hex[:10]
    to = f"retry-{tag}@jarful-tests.example"
    with browse(browser, None, "/") as page:
        signup_ui(page, to, "Pw-retry-12", "Rae")
        real = code_in(inbox(mail, to, 1)[0])
        kit_fill(R(page, "textbox", "Code"), f"{(int(real) + 1) % 1000000:06d}")
        ready(R(page, "button", "Confirm")).click()
        eventually(R(page, "status", "Account status"), lambda _t=None: expect(R(page, "status", "Account status")).to_have_text("That code is not right", timeout=_t))
        ready(R(page, "button", "Send a new code")).click()
        fresh = next((c for c in (code_in(m) for m in inbox(mail, to, 2)) if c != real), real)
        kit_fill(R(page, "textbox", "Code"), fresh)
        ready(R(page, "button", "Confirm")).click()
        poll(lambda: page.request.get(BASE + "/api/me").status == 200, "confirmed account is signed in")
    Api().signin({"email": to, "password": "Pw-retry-12"})


def test_file_stored_before_parsing() -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("editor"), w.C("pots")
    s3 = kit("S3")()
    good = b'{"a":1.0}\r\n{"a":2}\n'
    r = api.j("POST", f"{C}/imports", status=201, params={"format": "jsonl"}, content=good, headers={"X-File-Name": GOOD_NAME, "Content-Type": "application/octet-stream"})
    assert s3.get(f"imports/{r['import_id']}") == good
    rec = api.j("GET", f"{C}/imports/{r['import_id']}")
    assert rec["state"] == "finished" and rec["inserted"] == 2 and rec["bytes"] == len(good) and rec["file_name"] == GOOD_NAME
    bad = b'{"a":1}\n{oops\n'
    failed = refused(load_file(api, C, bad, name="bad.jsonl"), 422, "import_failed")
    assert s3.get(f"imports/{failed['import_id']}") == bad
    assert api.j("GET", f"{C}/imports/{failed['import_id']}")["state"] == "finished"
    exp = api.j("POST", f"{C}/exports", {"format": "jsonl", "filter": {}, "sort": None}, 201)
    stored = s3.get(f"exports/{exp['export_id']}.jsonl")
    assert exp["download_url"] == f"/api/projects/{w.pid}/exports/{exp['export_id']}"
    assert api.req("GET", exp["download_url"]).content == stored and stored.count(b"\n") == 6


def test_json_lines_loading() -> None:
    keep = hexid("c", 1)
    w = World({"plain": [], "ruled": {"documents": [], "validator": {"required": ["name"]}}})
    api = w.api("editor")
    data = ('{"name":"A","n":1}\r\n\r\n{"name":"B","nested":{"x":[1,2]}}\n' + compact({"_id": keep, "name": "C"}) + "\n").encode()
    assert api.j("POST", f"{w.C('plain')}/imports", status=201, params={"format": "jsonl"}, content=data, headers={"X-File-Name": "a.jsonl", "Content-Type": "application/octet-stream"})["inserted"] == 3
    got = query(api, w.C("plain"), filter={"name": {"$in": ["A", "B", "C"]}}, sort={"name": 1})["documents"]
    assert [{k: v for k, v in d.items() if k != "_id"} for d in got] == [{"name": "A", "n": 1}, {"name": "B", "nested": {"x": [1, 2]}}, {"name": "C"}]
    assert got[2]["_id"] == keep
    body = refused(load_file(api, w.C("plain"), b'{"a":1}\n[1,2]\n{bad\n"str"\n'), 422, "import_failed")
    assert body["errors"] == [{"line": 2, "message": "not an object"}, {"line": 3, "message": "not valid JSON"}, {"line": 4, "message": "not an object"}]
    body = refused(load_file(api, w.C("ruled"), b'{"name":"ok"}\n{"x":1}\n'), 422, "import_failed")
    assert body["errors"] == [{"line": 2, "message": "Document failed validation at name: required field is missing"}]
    assert count_of(api, w.C("ruled")) == 0 and count_of(api, w.C("plain")) == 3


CSV_GOOD = ('\ufeffname,price,dims.w,dims.h,flag,nil,when,code,note,qnum\r\n'
            'Ann,12,1.5,2,true,null,2026-03-01T00:00:00Z,007,"hello, world","42"\r\n'
            '"Bo ""B""",-3.5,,4,false,,2026-03-01,1e3,"two\nlines","true"\r\n\r\n').encode()


def test_csv_loading() -> None:
    w = World({"csv": []})
    api, C = w.api("editor"), w.C("csv")
    r = load_file(api, C, CSV_GOOD, "csv", "rows.csv")
    assert r.status_code == 201 and r.json()["inserted"] == 2, r.text
    docs = {d["name"]: {k: v for k, v in d.items() if k != "_id"} for d in query(api, C)["documents"]}
    assert docs == {
        "Ann": {"name": "Ann", "price": 12, "dims": {"w": 1.5, "h": 2}, "flag": True, "nil": None, "when": DATE_MADE, "code": 7, "note": "hello, world", "qnum": 42},
        'Bo "B"': {"name": 'Bo "B"', "price": -3.5, "dims": {"h": 4}, "flag": False, "when": "2026-03-01", "code": "1e3", "note": "two\nlines", "qnum": True},
    }, docs
    numbered = b'name,qty,note\nA,1,"multi\nline"\n\nB,2\nC,3,x\nE,5,y,z\n'
    assert refused(load_file(api, C, numbered, "csv"), 422, "import_failed")["errors"] == [
        {"line": 5, "message": "row has 2 cells, header has 3"}, {"line": 7, "message": "row has 4 cells, header has 3"}]
    assert refused(load_file(api, C, b"a,b,a\n1,2,3\n", "csv"), 422, "import_failed")["errors"] == [{"line": 1, "message": "duplicate header a"}]
    assert refused(load_file(api, C, b"a,a.b\n1,2\n", "csv"), 422, "import_failed")["errors"] == [{"line": 1, "message": "conflicting header a"}]
    assert [e["message"] for e in refused(load_file(api, C, b"", "csv"), 422, "import_failed")["errors"]] == ["missing header row"]
    refused(api.http.post(f"{C}/imports", content=b"a\n1\n", headers={"X-File-Name": "x.csv"}), 422, "invalid_field")
    refused(api.http.post(f"{C}/imports", params={"format": "xml"}, content=b"a\n1\n", headers={"X-File-Name": "x.csv"}), 422, "invalid_field")
    assert count_of(api, C) == 2


def test_all_or_nothing_load_report() -> None:
    w = World({"bulk": []})
    api, C = w.api("editor"), w.C("bulk")
    data = b'{"ok":1}\n' + b"{bad\n" * 25 + b'{"_id":"BAD","$x":1}\n'
    body = refused(load_file(api, C, data), 422, "import_failed")
    assert body["errors"] == [{"line": n, "message": "not valid JSON"} for n in range(2, 2 + LINE_ERROR_CAP)]
    rec = api.j("GET", f"{C}/imports/{body['import_id']}")
    assert rec["inserted"] == 0 and rec["errors"] == body["errors"]
    first_only = refused(load_file(api, C, b'{"_id":"BAD","$x":1}\n'), 422, "import_failed")
    assert first_only["errors"] == [{"line": 1, "message": "invalid _id"}]
    over = "".join(compact({"i": i}) + "\n" + ("\n" if i % 7 == 0 else "") for i in range(IMPORT_MAX_LINES + 1)).encode()
    refused(load_file(api, C, over), 422, "too_many_lines", limit=IMPORT_MAX_LINES)
    refused(load_file(api, C, over.replace(b'{"i":3}', b"{bad")), 422, "too_many_lines", limit=IMPORT_MAX_LINES)
    assert count_of(api, C) == 0
    exact = "".join(compact({"i": i}) + "\n" + ("\n" if i % 7 == 0 else "") for i in range(IMPORT_MAX_LINES)).encode()
    ok = api.j("POST", f"{C}/imports", status=201, params={"format": "jsonl"}, content=exact, headers={"X-File-Name": "max.jsonl", "Content-Type": "application/octet-stream"})
    assert ok["inserted"] == IMPORT_MAX_LINES and count_of(api, C) == IMPORT_MAX_LINES
    assert api.j("GET", f"{C}/imports/{ok['import_id']}")["inserted"] == IMPORT_MAX_LINES
    csv_max = ("h\n" + "".join(f"{i}\n" for i in range(IMPORT_MAX_LINES))).encode()
    assert load_file(api, C, csv_max, "csv").status_code == 201


def test_original_file_download() -> None:
    w = World({"pots": []})
    api, C = w.api("editor"), w.C("pots")
    raw = "\ufeffn,m\r\n1.0,2.50\r\n".encode()
    iid = load_file(api, C, raw, "csv", f"{NUMBERS_NAME}.csv").json()["import_id"]
    r = api.req("GET", f"{C}/imports/{iid}/original")
    assert r.status_code == 200 and r.content == raw
    assert r.headers["content-type"].startswith("application/octet-stream")
    assert r.headers["content-disposition"] == disposition(NUMBERS_NAME, "csv")
    bad = b'{"x":1}\n{nope\n'
    fid = load_file(api, C, bad, name="broken.jsonl").json()["import_id"]
    assert api.req("GET", f"{C}/imports/{fid}/original").content == bad
    listed = imports_of(api, C)
    assert [i["id"] for i in listed if i["id"] in (iid, fid)] == [fid, iid]


def test_collection_downloads() -> None:
    rows = [{"_id": hexid("a", i), "i": i, "grp": "a" if i % 2 == 0 else "b", "f": 1.0, "k": 1000.0} for i in range(25)]
    d1, d2, d3 = hexid("d", 1), hexid("d", 2), hexid("d", 3)
    shaped = [{"_id": d1, "name": "Ann", "price": 2.5, "dims": {"w": 1, "h": 2}, "tags": ["a", "b"], "ok": True, "none": None, "made": DATE_MADE},
              {"_id": d2, "name": "Bo, Jr", "price": 10, "dims": {"w": 3}, "empty": {}}, {"_id": d3, "name": "Cy", "price": 1}]
    w = World({"rows": rows, "shaped": shaped})
    api = w.api("reader")
    exp = api.j("POST", f"{w.C('rows')}/exports", {"format": "jsonl", "filter": {"grp": "a"}, "sort": {"i": -1}}, 201)
    r = api.req("GET", exp["download_url"])
    assert r.headers["content-disposition"] == disposition("rows", "jsonl")
    text = r.content.decode()
    assert text.endswith("\n") and "\r" not in text
    lines = text[:-1].split("\n")
    got = [json.loads(ln) for ln in lines]
    assert [d["i"] for d in got] == list(range(24, -1, -2)), "every match, not one page, in sort order"
    assert all(ln == compact(json.loads(ln)) for ln in lines)
    assert all(isinstance(d["f"], int) and d["f"] == 1 and isinstance(d["k"], int) and d["k"] == 1000 for d in got)
    exp = api.j("POST", f"{w.C('shaped')}/exports", {"format": "csv", "filter": {"name": {"$ne": "Cy"}}, "sort": {"price": -1}}, 201)
    r = api.req("GET", exp["download_url"])
    assert r.headers["content-disposition"] == disposition("shaped", "csv")
    raw = r.content.decode()
    assert raw.count("\r\n") == 3 and "\n" not in raw.replace("\r\n", "")
    table = list(csv.reader(io.StringIO(raw, newline="")))
    assert table == [
        ["_id", "dims.h", "dims.w", "empty", "made", "name", "none", "ok", "price", "tags"],
        [d2, "", "3", "{}", "", "Bo, Jr", "", "", "10", ""],
        [d1, "2", "1", "", "2026-03-01T00:00:00Z", "Ann", "null", "true", "2.5", '["a","b"]'],
    ], table


def test_spreadsheet_safe_csv() -> None:
    ids = [hexid("a", i) for i in range(1, 8)]
    docs = [{"_id": ids[0], "t": "=SUM(1)", "n": -5, "s": "-5"}, {"_id": ids[1], "t": "+1"}, {"_id": ids[2], "t": "@me"},
            {"_id": ids[3], "t": "\tx"}, {"_id": ids[4], "t": "\rx"}, {"_id": ids[5], "t": "safe"}, {"_id": ids[6], "=f": "v"}]
    w = World({"risky": docs})
    api = w.api("reader")
    exp = api.j("POST", f"{w.C('risky')}/exports", {"format": "csv", "filter": {}, "sort": None}, 201)
    table = list(csv.reader(io.StringIO(api.req("GET", exp["download_url"]).content.decode(), newline="")))
    assert table[0] == ["'=f", "_id", "n", "s", "t"], table[0]
    rows = {r[1]: r for r in table[1:]}
    assert rows[ids[0]][2:] == ["-5", "'-5", "'=SUM(1)"]
    assert [rows[i][4] for i in ids[1:6]] == ["'+1", "'@me", "'\tx", "'\rx", "safe"]
    assert rows[ids[6]][0] == "v"


def test_file_storage_outage(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    primary = w.api("editor")
    C = w.C("pots")
    iid = load_file(primary, C, b'{"x":1}\n').json()["import_id"]
    exp = primary.j("POST", f"{C}/exports", {"format": "jsonl", "filter": {}, "sort": None}, 201)
    down = w.api("editor", base=down_url())
    before = count_of(down, C)
    refused(load_file(down, C, b'{"y":1}\n', name=f"down-{w.tag}.jsonl"), 503, "storage_unavailable")
    assert count_of(down, C) == before
    assert any(i["file_name"] == f"down-{w.tag}.jsonl" and i["state"] == "refused" for i in imports_of(down, C))
    refused(down.req("GET", f"{C}/imports/{iid}/original"), 503, "storage_unavailable")
    refused(down.req("POST", f"{C}/exports", {"format": "csv", "filter": {}, "sort": None}), 503, "storage_unavailable")
    refused(down.req("GET", exp["download_url"]), 503, "storage_unavailable")
    refused(w.api("outsider", base=down_url()).req("POST", f"{C}/imports", params={"format": "jsonl"}, content=b"{}\n"), 404, "not_found")
    refused(w.api("reader", base=down_url()).http.post(f"{C}/imports", params={"format": "jsonl"}, content=b"{}\n"), 403, "read_only")
    refused(down.http.post(f"{C}/imports", content=b"{}\n"), 422, "invalid_field")
    assert query(down, C, filter={"tags": "red"})["matched"] == 2
    did = down.j("POST", f"{C}/documents", {"document": {"z": 1}}, 201)["document"]["_id"]
    down.j("PUT", f"{C}/documents/{did}", {"document": {"_id": did, "z": 2}, "version": 1})
    agg(down, C, [{"$match": {}}], page=1)
    for path in (f"{C}/indexes", f"{C}/schema", f"{w.P}/members"):
        down.j("GET", path)
    with browse(browser, w.editor, w.ui("pots"), base=down_url()) as page:
        eventually(page.get_by_role("alert").filter(has_text="File storage is unavailable. Try again later."), lambda _t=None: expect(page.get_by_role("alert").filter(has_text="File storage is unavailable. Try again later.")).to_be_visible(timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(6, 6), timeout=_t))
    with browse(browser, w.editor, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(6, 6), timeout=_t))
        eventually(page.get_by_text("File storage is unavailable. Try again later.", exact=True), lambda _t=None: expect(page.get_by_text("File storage is unavailable. Try again later.", exact=True)).to_have_count(0, timeout=_t))


FILE_BAD = b'{"name":"a"}\n{oops\n{"name":"b"}\n[1]\n'
FILE_FIXED = b'{"name":"a"}\n{"name":"c"}\n{"name":"b"}\n'
FILE_CSV = b"name,formula\nd,=SUM(1)\ne,+2\n"
FILE_DOWN_NAME = "outage.jsonl"


def choose_and_load(page: Page, dlg: Locator, data: bytes, name: str, fmt_label: str) -> None:
    with page.expect_file_chooser() as fc:
        ready(R(dlg, "button", "Choose file")).click()
    fc.value.set_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])
    radio = R(R(dlg, "radiogroup", "Format"), "radio", fmt_label)
    ready(radio).click()
    eventually(radio, lambda _t=None: expect(radio).to_be_checked(timeout=_t))
    ready(R(dlg, "button", "Load")).click()


def test_wf_file_load_download_happy(browser: Browser) -> None:
    w = World({"files": []})
    api, C = w.api("owner"), w.C("files")
    s3 = kit("S3")()
    with browse(browser, w.owner, w.ui("files")) as page:
        eventually(page.get_by_text("NOTHING IN THIS JAR YET", exact=True), lambda _t=None: expect(page.get_by_text("NOTHING IN THIS JAR YET", exact=True)).to_be_visible(timeout=_t))
        ready(R(page, "button", "Load file").first).click()
        dlg = R(page, "dialog", "Load file")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        choose_and_load(page, dlg, FILE_BAD, "bad.jsonl", "JSON lines")
        eventually(R(dlg, "status", "Import status"), lambda _t=None: expect(R(dlg, "status", "Import status")).to_have_text("Import failed", timeout=_t))
        eventually(R(dlg, "list", "Line errors").get_by_role("listitem"), lambda _t=None: expect(R(dlg, "list", "Line errors").get_by_role("listitem")).to_have_text(["Line 2: not valid JSON", "Line 4: not an object"], timeout=_t))
        assert count_of(api, C) == 0, "a failed load added documents"
        choose_and_load(page, dlg, FILE_FIXED, "fixed.jsonl", "JSON lines")
        eventually(R(dlg, "status", "Import status"), lambda _t=None: expect(R(dlg, "status", "Import status")).to_have_text("Imported 3 documents", timeout=_t))
        choose_and_load(page, dlg, FILE_CSV, UPLOAD_CSV, "CSV")
        eventually(R(dlg, "status", "Import status"), lambda _t=None: expect(R(dlg, "status", "Import status")).to_have_text("Imported 2 documents", timeout=_t))
        with page.expect_download() as dl:
            ready(R(dlg, "link", "Download original file")).click()
        original = Path(dl.value.path()).read_bytes()
        assert original == FILE_CSV, "Download original file must return the upload byte for byte"
        newest = imports_of(api, C)[0]
        assert newest["file_name"] == UPLOAD_CSV and newest["inserted"] == 2
        assert s3.get(f"imports/{newest['id']}") == FILE_CSV, "MinIO must hold the exact uploaded bytes"
        page.keyboard.press("Escape")
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
        run_query(page, '{"name":{"$in":["d","e"]}}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
        ready(R(page, "button", "Download")).click()
        ddlg = R(page, "dialog", "Download")
        ready(R(R(ddlg, "radiogroup", "Format"), "radio", "CSV")).click()
        with page.expect_download() as dl2:
            ready(R(ddlg, "button", "Download file")).click()
        got = Path(dl2.value.path()).read_bytes()
    table = list(csv.reader(io.StringIO(got.decode(), newline="")))
    assert table[0] == ["_id", "formula", "name"], table
    assert sorted((r[2], r[1]) for r in table[1:]) == [("d", "'=SUM(1)"), ("e", "'+2")], table
    stored = [k for k in s3.keys("exports/") if k.endswith(".csv") and s3.get(k) == got]
    assert stored, "the downloaded CSV is not stored in MinIO under exports/"
    assert count_of(api, C) == 5


def test_wf_file_load_download_outage(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    C = w.C("pots")
    with browse(browser, w.editor, w.ui("pots"), base=down_url()) as page:
        banner = page.get_by_role("alert").filter(has_text="File storage is unavailable. Try again later.")
        eventually(banner, lambda _t=None: expect(banner).to_be_visible(timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        ready(R(page, "button", "Load file").first).click()
        dlg = R(page, "dialog", "Load file")
        choose_and_load(page, dlg, b'{"z":1}\n', FILE_DOWN_NAME, "JSON lines")
        eventually(banner, lambda _t=None: expect(banner).to_be_visible(timeout=_t))
        eventually(R(dlg, "status", "Import status"), lambda _t=None: expect(R(dlg, "status", "Import status")).not_to_have_text(re.compile("^Imported"), timeout=_t))
        page.keyboard.press("Escape")
        run_query(page, '{"tags":"red"}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(2, 2), timeout=_t))
    down = w.api("editor", base=down_url())
    assert count_of(down, C) == 4
    assert any(i["file_name"] == FILE_DOWN_NAME and i["state"] == "refused" for i in imports_of(down, C))


KEYS_FILE_NAME = "keys.jsonl"


def test_wf_file_load_download_keyboard(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    api, C = w.api("owner"), w.C("pots")
    with browse(browser, w.owner, w.ui("pots")) as page:
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        opener = R(page, "button", "Load file").first
        ready(opener, "attached").focus()
        page.keyboard.press("Enter")
        dlg = R(page, "dialog", "Load file")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        poll(lambda: focus_inside(dlg), "opening Load file moves focus inside it")
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert focus_inside(dlg), f"{key} escaped the open Load file dialog (L271)"
        choose_and_load(page, dlg, FILE_FIXED, KEYS_FILE_NAME, "JSON lines")
        eventually(R(dlg, "status", "Import status"), lambda _t=None: expect(R(dlg, "status", "Import status")).to_have_text("Imported 3 documents", timeout=_t))
        for key in ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert focus_inside(dlg), f"{key} escaped the Load file dialog after a load (L271)"
        page.keyboard.press("Escape")
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
        eventually(opener, lambda _t=None: expect(opener).to_be_focused(timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(7, 7), timeout=_t))
    newest = imports_of(api, C)[0]
    assert newest["file_name"] == KEYS_FILE_NAME and newest["inserted"] == 3
    assert api.http.get(f"{C}/imports/{newest['id']}/original").content == FILE_FIXED


BIG_N = SCAN_LIMIT + 1
BIG_DOCS = [{"_id": hexid("5", i), "n": i, "bucket": i % 10} for i in range(1, BIG_N + 1)]
EDGE_DOCS = [{"_id": hexid("6", i), "n": i} for i in range(1, SCAN_LIMIT + 1)]
GUARD_TEXT = f"Query stopped: more than {SCAN_LIMIT} documents would be scanned. Add an index or narrow the filter."
EVERYTHING = {"name": "everything", "filter": {}, "projection": None, "sort": None, "limit": 0}
SQ_NAME = "first five"
PHONE_LABEL = "by touch"
ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
SPARE = "spare"
UNKNOWN_OP = "$all"
UNKNOWN_STAGE = "$lookup"
BY_PRICE = "by_price"
INDEX_N = "n_1"
SKU_ONCE = "sku_once"
GOOD_NAME = "good.jsonl"
UPLOAD_CSV = "rows.csv"
NUMBERS_NAME = "numbers"
BY_NEW_EDITOR = "by-new-editor"
CORS_HEADER = "access-control-allow-origin"
COOKIE_FLAGS = ("httponly", "samesite=lax")
NOVA = "Nova"


def disposition(name: str, ext: str) -> str:
    return f'attachment; filename="{name}.{ext}"'


def capped_status(n: int, total: int) -> str:
    return f"Stage {n} of {total}: ≤{SCAN_LIMIT} documents out"


def within_budget(label: str, fn: Callable[[], Any]) -> Any:
    t = time.monotonic()
    out = fn()
    took = time.monotonic() - t
    assert took < TIME_BUDGET_S, f"{label} took {took:.2f}s, over the published {TIME_BUDGET_S}s (L568)"
    return out


def plan_of(q: dict) -> tuple:
    p = q["plan"]
    return p["kind"], p["index"], p["docs_examined"], p["returned"]


def test_scan_guard(browser: Browser) -> None:
    w = World({"big": {"documents": BIG_DOCS, "saved_queries": [EVERYTHING]}, "edge": EDGE_DOCS})
    rd, own, C = w.api("reader"), w.api("owner"), w.C("big")
    for body in [{}, {"filter": {"bucket": 3}}, {"filter": {}, "limit": 5}, {"filter": {"$or": [{"n": 1}]}}]:
        refused(rd.req("POST", f"{C}/query", body), 422, "scan_limit", limit=SCAN_LIMIT)
    edge = query(rd, w.C("edge"))
    assert edge["matched"] == SCAN_LIMIT and edge["plan"]["docs_examined"] == SCAN_LIMIT, "the limit itself is allowed"
    refused(rd.req("POST", f"{C}/aggregate", {"pipeline": [{"$match": {}}], "disabled": [], "preview": True}), 422, "scan_limit", limit=SCAN_LIMIT)
    refused(rd.req("POST", f"{C}/aggregate", {"pipeline": [{"$limit": 1}], "disabled": [], "page": 1}), 422, "scan_limit", limit=SCAN_LIMIT)
    refused(rd.req("POST", f"{C}/exports", {"format": "csv", "filter": {}, "sort": None}), 422, "scan_limit", limit=SCAN_LIMIT)
    sq = w.cols["big"]["saved_queries"]["everything"]
    refused(rd.req("POST", f"{C}/saved-queries/{sq}/run", {"page": 1}), 422, "scan_limit", limit=SCAN_LIMIT)
    assert count_of(rd, C) == BIG_N
    own.j("POST", f"{C}/indexes", {"keys": {"n": 1}, "unique": False}, 201)
    assert plan_of(query(rd, C, filter={"n": {"$lte": 5}})) == ("index", "n_1", 5, 5)
    narrowed = [{"$match": {"n": {"$lte": 5}}}, {"$limit": 2}]
    assert [s["count"] for s in preview(rd, C, narrowed)["stages"]] == [5, 2]
    refused(rd.req("POST", f"{C}/aggregate", {"pipeline": narrowed, "disabled": [0], "preview": True}), 422, "scan_limit", limit=SCAN_LIMIT)
    exp = rd.j("POST", f"{C}/exports", {"format": "jsonl", "filter": {"n": {"$lte": 5}}, "sort": {"n": -1}}, 201)
    assert [json.loads(ln)["n"] for ln in rd.req("GET", exp["download_url"]).content.decode().splitlines()] == [5, 4, 3, 2, 1]
    put_draft(own, C, [{"$match": {}}, {"$limit": 2}, {"$skip": 0}], [2])
    with browse(browser, w.owner, w.ui("big", "/pipeline"), live=False) as page:
        wait_settled(page, [SCAN_LIMIT] * 3)
        eventually(R(page, "alert", "Pipeline error"), lambda _t=None: expect(R(page, "alert", "Pipeline error")).to_have_text(GUARD_TEXT, timeout=_t))
        bands = sieve(R(page, "list", "Pipeline stages"))
        assert [b["capped"] for b in bands] == ["true"] * 3, f"capped run bands {bands}"
        assert_bars(bands, [SCAN_LIMIT] * 3, BIG_N, {2}, "capped Stage Sieve")
        for n, op in ((1, "$match"), (2, "$limit")):
            eventually(R(page, "group", f"Stage {n}: {op}").get_by_role("status"), lambda _t=None: expect(R(page, "group", f"Stage {n}: {op}").get_by_role("status")).to_have_text(capped_status(n, 3), timeout=_t))
        eventually(R(page, "group", "Stage 3: $skip").get_by_role("status"), lambda _t=None: expect(R(page, "group", "Stage 3: $skip").get_by_role("status")).to_have_text("pass through", timeout=_t))


def deep_and(wraps: int) -> dict:
    d: dict = {"x": 1}
    for _ in range(wraps):
        d = {"$and": [d]}
    return d


def test_bounded_requests() -> None:
    rows = [{"_id": hexid("7", i), "x": 1, "n": i, "g": i % 7, "tags": [i % 3, i % 5], "txt": "t" * 100} for i in range(1, SCAN_LIMIT + 1)]
    w = World({"edge": rows})
    api, C = w.api("reader"), w.C("edge")
    half = QUERY_DEPTH_LIMIT // 2
    for flt in [{"a": nest(QUERY_DEPTH_LIMIT)}, deep_and(half)]:
        r = within_budget("over-deep filter", lambda: api.req("POST", f"{C}/query", {"filter": flt}))
        refused(r, 422, "query_too_deep", limit=QUERY_DEPTH_LIMIT)
    assert within_budget("deep filter at the limit", lambda: query(api, C, filter=deep_and(half - 1)))["matched"] == SCAN_LIMIT
    assert query(api, C, filter={"a": nest(QUERY_DEPTH_LIMIT - 1)})["matched"] == 0
    r = api.req("POST", f"{C}/aggregate", {"pipeline": [{"$match": {"a": nest(QUERY_DEPTH_LIMIT - 1)}}], "disabled": [], "preview": True})
    refused(r, 422, "query_too_deep", limit=QUERY_DEPTH_LIMIT)
    preview(api, C, [{"$match": {"a": nest(QUERY_DEPTH_LIMIT - 2)}}])
    big_in = list(range(0, 40000, 3))
    q = within_budget("long $in with a three-key sort", lambda: query(api, C, filter={"n": {"$in": big_in}}, sort={"g": -1, "tags": 1, "n": 1}))
    assert q["matched"] == SCAN_LIMIT // 3
    heavy = [{"$unwind": "$tags"}, {"$group": {"_id": {"g": "$g", "t": "$tags"}, "s": {"$sum": "$n"}, "a": {"$avg": "$n"}, "p": {"$push": "$n"}}}, {"$sort": {"s": -1}}]
    within_budget("grouping preview", lambda: preview(api, C, heavy))
    exp = within_budget("CSV export", lambda: api.j("POST", f"{C}/exports", {"format": "csv", "filter": {}, "sort": {"g": 1}}, 201))
    body = within_budget("export download", lambda: api.req("GET", exp["download_url"]))
    assert len(list(csv.reader(io.StringIO(body.content.decode(), newline="")))) == SCAN_LIMIT + 1


def saved_item(page: Page, name: str) -> Locator:
    return R(page, "list", "Saved queries").get_by_role("listitem").filter(has=page.get_by_role("button", name=f"Run {name}", exact=True))


def test_saved_queries(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    ed, rd, C = w.api("editor"), w.api("reader"), w.C("pots")
    reds = {"name": "reds", "filter": {"tags": "red"}, "projection": None, "sort": {"price": -1}, "limit": 0}
    alpha = {"name": "alpha", "filter": {}, "projection": None, "sort": None, "limit": 0}
    made = ed.j("POST", f"{C}/saved-queries", reds, 201)["saved_query"]
    assert made["name"] == reds["name"] and made["filter"] == {"tags": "red"} and made["last_run_at"] is None and made["last_count"] is None
    refused(ed.req("POST", f"{C}/saved-queries", reds), 409, "name_taken")
    refused(ed.req("POST", f"{C}/saved-queries", {**reds, "name": "bad", "filter": "x"}), 422, "invalid_query", field="filter")
    refused(ed.req("POST", f"{C}/saved-queries", {**reds, "name": "bad", "limit": -1}), 422, "invalid_query", field="limit")
    refused(rd.req("POST", f"{C}/saved-queries", {**reds, "name": "mine"}), 403, "read_only")
    a_id = ed.j("POST", f"{C}/saved-queries", alpha, 201)["saved_query"]["id"]
    assert [q["name"] for q in ed.j("GET", f"{C}/saved-queries")["saved_queries"]] == [alpha["name"], reds["name"]]
    run = rd.j("POST", f"{C}/saved-queries/{made['id']}/run", {"page": 1})
    assert run["matched"] == 2 and run["ids"] == [E4, E1]
    assert run["saved_query"]["last_count"] == 2 and ISO_RE.fullmatch(run["saved_query"]["last_run_at"])
    ed.j("PUT", f"{C}/saved-queries/{made['id']}", {**reds, "filter": {"tags": "green"}})
    assert rd.j("POST", f"{C}/saved-queries/{made['id']}/run", {"page": 1})["saved_query"]["last_count"] == 1
    with browse(browser, w.owner, w.ui("pots", "/queries")) as page:
        eventually(saved_item(page, "alpha"), lambda _t=None: expect(saved_item(page, "alpha")).to_contain_text("Never run", timeout=_t))
        ready(R(page, "button", "Run alpha")).click()
        got = poll(lambda: next((q for q in ed.j("GET", f"{C}/saved-queries")["saved_queries"] if q["id"] == a_id and q["last_count"] == 4), None), "Run alpha records its last run")
        page.goto(BASE + w.ui("pots", "/queries"))
        eventually(saved_item(page, "alpha"), lambda _t=None: expect(saved_item(page, "alpha")).to_contain_text(last_run_line(got["last_run_at"], 4), timeout=_t))
        page.reload()
        eventually(saved_item(page, "alpha"), lambda _t=None: expect(saved_item(page, "alpha")).to_contain_text(last_run_line(got["last_run_at"], 4), timeout=_t))
        eventually(R(page, "button", "Delete alpha"), lambda _t=None: expect(R(page, "button", "Delete alpha")).to_be_visible(timeout=_t))
    with browse(browser, w.reader, w.ui("pots", "/queries")) as page:
        eventually(R(page, "button", "Run alpha"), lambda _t=None: expect(R(page, "button", "Run alpha")).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Delete alpha"), lambda _t=None: expect(R(page, "button", "Delete alpha")).to_have_count(0, timeout=_t))
    assert ed.req("DELETE", f"{C}/saved-queries/{a_id}").status_code == 204
    assert [q["name"] for q in ed.j("GET", f"{C}/saved-queries")["saved_queries"]] == [reds["name"]]


def small_targets(page: Page) -> list[str]:
    small = []
    for role in ("button", "tab"):
        for loc in page.get_by_role(role).all():
            if not loc.is_visible():
                continue
            b = loc.bounding_box()
            if b and (b["width"] < MIN_TARGET_PX - 0.5 or b["height"] < MIN_TARGET_PX - 0.5):
                small.append(f"{role} {loc.get_attribute('aria-label') or loc.inner_text()[:30]!r} {b['width']:.0f}x{b['height']:.0f}")
    return small


def test_phone_editor_by_touch(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.editor, w.ui("pots"), viewport=PHONE) as page:
        eventually(R(page, "tab", "Query"), lambda _t=None: expect(R(page, "tab", "Query")).to_be_visible(timeout=_t))
        bad: list[str] = []
        for tab in ("Query", "Results", "Pipeline"):
            tap(R(page, "tab", tab))
            eventually(R(page, "tab", tab), lambda _t=None: expect(R(page, "tab", tab)).to_have_attribute("aria-selected", "true", timeout=_t))
            bad += small_targets(page)
        assert not bad, f"touch targets under {MIN_TARGET_PX}px: {bad}"
        tap(R(page, "tab", "Results"))
        item = R(page, "list", "Documents").locator(f'[data-doc-id="{E2}"]')
        tap(item)
        dlg = R(page, "dialog", "Document")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        b = dlg.bounding_box()
        assert b and b["x"] <= 1 and b["y"] <= 1 and b["width"] >= PHONE["width"] - 1 and b["height"] >= PHONE["height"] - 1, f"editor dialog is not full screen: {b}"
        for name in ("Save", "Close"):
            bb = R(dlg, "button", name).bounding_box()
            assert bb and bb["width"] >= MIN_TARGET_PX - 0.5 and bb["height"] >= MIN_TARGET_PX - 0.5, f"{name} is {bb}"
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open in the phone dialog")
        kit_fill(editor_box(page), compact({**E_DOCS[1], "price": 9}))
        tap(R(dlg, "button", "Save"))
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        tap(R(dlg, "button", "Close"))
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
        tap(item)
        eventually(R(page, "dialog", "Document"), lambda _t=None: expect(R(page, "dialog", "Document")).to_be_visible(timeout=_t))
        page.keyboard.press("Escape")
        eventually(R(page, "dialog", "Document"), lambda _t=None: expect(R(page, "dialog", "Document")).to_have_count(0, timeout=_t))
        poll(lambda: active(page).get("within") == E2, "Escape returns focus to the tapped item")
    stored = w.api("owner").j("GET", f"{w.C('pots')}/documents/{E2}")
    assert stored["version"] == 2 and stored["document"]["price"] == 9


POINT_LINK_JS = "([x, y]) => { const e = document.elementFromPoint(x, y); const a = e && e.closest('a'); return a ? a.textContent.trim() : null; }"


def test_closed_panels_inert(browser: Browser) -> None:
    w = World({"pots": E_DOCS, SPARE: []})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5])
    closed = [("menu", "Account"), ("menuitem", "Sign out"), ("dialog", "Save query"), ("dialog", "Load file"),
              ("dialog", "Download"), ("dialog", "Collections"), ("dialog", "Delete this document?")]
    for vp in (DESKTOP, TABLET, PHONE):
        with browse(browser, w.owner, w.ui("pots"), viewport=vp) as page:
            eventually(R(query_bar(page), "textbox", "Filter"), lambda _t=None: expect(R(query_bar(page), "textbox", "Filter")).to_be_visible(timeout=_t))
            for role, name in closed:
                eventually(R(page, role, name), lambda _t=None: expect(R(page, role, name)).to_have_count(0, timeout=_t))
            names = tab_order(page, 40)
            for name in ("Sign out", "Keep query", "Close collections", "Download file"):
                assert name not in names, f"{vp}: closed-panel control {name!r} is in the tab order {names}"
            ready(R(page, "button", "Account")).click()
            eventually(R(page, "menuitem", "Sign out"), lambda _t=None: expect(R(page, "menuitem", "Sign out")).to_be_visible(timeout=_t))
            page.keyboard.press("Escape")
            eventually(R(page, "menuitem", "Sign out"), lambda _t=None: expect(R(page, "menuitem", "Sign out")).to_have_count(0, timeout=_t))
            if vp is PHONE:
                eventually(R(page, "tab", "Query"), lambda _t=None: expect(R(page, "tab", "Query")).to_have_attribute("aria-selected", "true", timeout=_t))
                eventually(R(page, "button", "Add stage"), lambda _t=None: expect(R(page, "button", "Add stage")).to_have_count(0, timeout=_t))
                eventually(R(page, "list", "Documents"), lambda _t=None: expect(R(page, "list", "Documents")).to_have_count(0, timeout=_t))
                assert "Add stage" not in names and SPARE not in names, names
                tap(R(page, "button", "Collections"))
                drawer = R(page, "dialog", "Collections")
                link = R(drawer, "link", SPARE)
                eventually(link, lambda _t=None: expect(link).to_be_visible(timeout=_t))
                x, y = conftest.center(link)
                tap(R(drawer, "button", "Close collections"))
                eventually(drawer, lambda _t=None: expect(drawer).to_have_count(0, timeout=_t))
                poll(lambda: page.evaluate(POINT_LINK_JS, [x, y]) != SPARE, "a closed drawer's link still takes the pointer")
                assert SPARE not in tab_order(page, 40), "a closed drawer's link is still focusable"


def test_wf_guard_phone_guard(browser: Browser) -> None:
    w = World({"big": BIG_DOCS})
    api, C = w.api("owner"), w.C("big")
    with browse(browser, w.owner, w.ui("big")) as page:
        eventually(R(page, "alert", "Query error"), lambda _t=None: expect(R(page, "alert", "Query error")).to_have_text(GUARD_TEXT, timeout=_t))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text("Query not run", timeout=_t))
        page.goto(BASE + f"/p/{w.pid}")
        eventually(R(page, "list", "Collections").get_by_role("listitem").filter(has_text="big"), lambda _t=None: expect(R(page, "list", "Collections").get_by_role("listitem").filter(has_text="big")).to_contain_text(str(BIG_N), timeout=_t))
        page.goto(BASE + w.ui("big", "/indexes"))
        kit_fill(R(page, "textbox", "Index keys"), '{"n":1}')
        ready(R(page, "button", "Create index")).click()
        eventually(R(page, "status", "Index status"), lambda _t=None: expect(R(page, "status", "Index status")).to_have_text(f"Index {INDEX_N} created", timeout=_t))
        page.goto(BASE + w.ui("big"))
        run_query(page, '{"n":{"$lte":5}}')
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(5, 5), timeout=_t))
        expect_lines(R(page, "status", "Query plan"), ["Used index n_1", "Examined 5 documents, returned 5"], "indexed run readout")
        ready(R(page, "button", "Save query")).click()
        dlg = R(page, "dialog", "Save query")
        kit_fill(R(dlg, "textbox", "Query name"), SQ_NAME)
        ready(R(dlg, "button", "Keep query")).click()
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
        saved = poll(lambda: next((q for q in api.j("GET", f"{C}/saved-queries")["saved_queries"] if q["name"] == SQ_NAME), None), "Keep query stores the query")
        assert saved["filter"] == {"n": {"$lte": 5}}
        ready(R(R(page, "navigation", "Sections"), "link", "Query")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("big", "/queries")) + "$"), timeout=_t))
        ready(R(page, "button", f"Run {SQ_NAME}")).click()
        ran = poll(lambda: next((q for q in api.j("GET", f"{C}/saved-queries")["saved_queries"] if q["name"] == SQ_NAME and q["last_count"] == 5), None), "the saved run is recorded")
        page.goto(BASE + w.ui("big", "/queries"))
        page.reload()
        eventually(saved_item(page, SQ_NAME), lambda _t=None: expect(saved_item(page, SQ_NAME)).to_contain_text(last_run_line(ran["last_run_at"], 5), timeout=_t))
    r = within_budget("refused full scan", lambda: api.req("POST", f"{C}/query", {"filter": {"bucket": 1}}))
    refused(r, 422, "scan_limit", limit=SCAN_LIMIT)


def test_wf_guard_phone_touch(browser: Browser) -> None:
    w = World({"pots": E_DOCS, SPARE: []})
    with browse(browser, w.editor, w.ui("pots"), viewport=PHONE, reduced="reduce") as page:
        eventually(R(page, "tab", "Query"), lambda _t=None: expect(R(page, "tab", "Query")).to_have_attribute("aria-selected", "true", timeout=_t))
        layout(page)
        eventually(R(page, "dialog", "Collections"), lambda _t=None: expect(R(page, "dialog", "Collections")).to_have_count(0, timeout=_t))
        assert SPARE not in tab_order(page, 30)
        tap(R(page, "button", "Collections"))
        drawer = R(page, "dialog", "Collections")
        eventually(R(drawer, "link", SPARE), lambda _t=None: expect(R(drawer, "link", SPARE)).to_be_visible(timeout=_t))
        tap(R(drawer, "button", "Close collections"))
        eventually(drawer, lambda _t=None: expect(drawer).to_have_count(0, timeout=_t))
        assert SPARE not in tab_order(page, 30), "closed drawer link is focusable"
        tap(R(page, "tab", "Results"))
        tap(R(page, "list", "Documents").locator(f'[data-doc-id="{E3}"]'))
        dlg = R(page, "dialog", "Document")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        expect_editor_doc(page, lambda d: d.get("_id") == E3, "E3 open by touch")
        kit_fill(editor_box(page), compact({**E_DOCS[2], "note": PHONE_LABEL}))
        tap(R(dlg, "button", "Save"))
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        tap(R(dlg, "button", "Close"))
        eventually(dlg, lambda _t=None: expect(dlg).to_have_count(0, timeout=_t))
    stored = w.api("owner").j("GET", f"{w.C('pots')}/documents/{E3}")
    assert stored["version"] == 2 and stored["document"]["note"] == PHONE_LABEL


def test_wf_guard_phone_deeplink(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    with browse(browser, w.owner, w.ui("pots"), viewport=PHONE) as page:
        insert = R(page, "button", "Insert document")
        for tab in ("Query", "Results"):
            tap(R(page, "tab", tab))
            if insert.count() and insert.is_visible():
                break
        else:
            pytest.fail("Insert document is not reachable by touch in the Query or Results tab (L81, L164)")
        tap(insert)
        dlg = R(page, "dialog", "Document")
        eventually(dlg, lambda _t=None: expect(dlg).to_be_visible(timeout=_t))
        poll(lambda: parsed(content(editor_box(page))) == {}, "Insert document opens {}")
        kit_fill(editor_box(page), compact({"label": PHONE_LABEL}))
        tap(R(dlg, "button", "Save"))
        eventually(save_status(page), lambda _t=None: expect(save_status(page)).to_have_text("Saved", timeout=_t))
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", "/d/")) + "[0-9a-f]{24}$"), timeout=_t))
        page.reload()
        eventually(R(page, "dialog", "Document"), lambda _t=None: expect(R(page, "dialog", "Document")).to_be_visible(timeout=_t))
        expect_editor_doc(page, lambda d: d.get("label") == PHONE_LABEL, "reloaded route reopens the new document")
        tap(R(R(page, "dialog", "Document"), "button", "Close"))
        tap(R(page, "tab", "Results"))
        tap(R(page, "list", "Documents").locator(f'[data-doc-id="{E3}"]'))
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(re.escape(w.ui("pots", f"/d/{E3}")) + "$"), timeout=_t))
        page.reload()
        eventually(R(page, "dialog", "Document"), lambda _t=None: expect(R(page, "dialog", "Document")).to_be_visible(timeout=_t))
        expect_editor_doc(page, lambda d: d.get("_id") == E3, "reloaded E3 route shows E3")
    assert query(w.api("owner"), w.C("pots"), filter={"label": PHONE_LABEL})["matched"] == 1


HEALTH_LIMIT_S = 2
HEALTH_SLACK_S = 1
DEAD_DB = "postgresql://jarful:jarful@127.0.0.1:9/jarful"


def test_run_manifest_and_health() -> None:
    r = httpx.get(BASE + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    assert r.headers.get("content-type", "").startswith("application/json")
    t = time.monotonic()
    r = httpx.get(down_url() + "/api/health", timeout=HTTP_TIMEOUT)
    took = time.monotonic() - t
    assert r.status_code == 200 and r.json() == {"status": "unavailable"}, r.text
    assert took < HEALTH_LIMIT_S + HEALTH_SLACK_S, f"storage-down health took {took:.2f}s"
    with app_copy({"DATABASE_URL": DEAD_DB}) as url:
        r = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and r.json() == {"status": "starting"}, r.text


def seed_raw(body: Any, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key is not None else {}
    return httpx.post(BASE + "/api/grading/seed", json=body, headers=headers, timeout=SEED_TIMEOUT)


def test_grading_seed_route() -> None:
    tag = uuid.uuid4().hex[:10]
    mk = lambda r: {"email": f"{r}-{tag}@jarful-tests.example", "password": f"Pw-{tag}-seed", "name": f"{r} {tag}"}
    u1, u2, u3, u4 = mk("own"), mk("rd"), mk("gone"), mk("dup")
    id1, id3 = hexid("9", 1), hexid("9", 3)
    proj = f"Seeded {tag}"
    body = {"users": [u1, u2], "projects": [{"name": proj, "owner": u1["email"], "members": [{"email": u2["email"], "role": "reader"}],
            "collections": [{"name": "c1", "documents": [{"_id": id1, "v": 1}, {"v": "x"}, {"_id": id3, "v": 3}],
                             "indexes": [{"name": "v_u", "keys": {"v": 1}, "unique": True}], "validator": {"required": ["missing"]},
                             "saved_queries": [{"name": "ones", "filter": {"v": 1}, "projection": None, "sort": None, "limit": 0}]}]}]}
    refused(seed_raw(body, None), 404, "not_found")
    refused(seed_raw(body, "wrong-key"), 404, "not_found")
    refused(Api().req("POST", "/api/auth/signin", {"email": u1["email"], "password": u1["password"]}), 401, "invalid_credentials")
    r = seed_raw(body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert set(out["users"]) == {u1["email"], u2["email"]}
    p = out["projects"][proj]
    c1 = p["collections"]["c1"]
    assert c1["documents"][0] == id1 and c1["documents"][2] == id3 and re.fullmatch(r"[0-9a-f]{24}", c1["documents"][1])
    own, rd = Api().signin(u1), Api().signin(u2)
    C = f"/api/projects/{p['id']}/collections/{c1['id']}"
    assert own.j("GET", f"/api/projects/{p['id']}")["role"] == "owner"
    assert rd.j("GET", f"/api/projects/{p['id']}")["role"] == "reader"
    assert sorted(query(rd, C)["ids"]) == sorted(c1["documents"]), "documents kept despite the validator"
    assert {"name": "v_u", "keys": {"v": 1}, "unique": True} in own.j("GET", f"{C}/indexes")["indexes"]
    assert own.j("GET", f"{C}/validator")["validator"] == {"required": ["missing"]}
    assert rd.j("POST", f"{C}/saved-queries/{c1['saved_queries']['ones']}/run", {"page": 1})["ids"] == [id1]
    bad_proj = f"Refused {tag}"
    bad = {"users": [u3], "projects": [{"name": bad_proj, "owner": u1["email"], "members": [], "collections": [{"name": "c", "documents": [{"_id": "BAD"}], "indexes": [], "validator": None, "saved_queries": []}]}]}
    refused(seed_raw(bad), 422, "invalid_id")
    dup = {"users": [u4], "projects": [{"name": bad_proj, "owner": u4["email"], "members": [], "collections": [{"name": "c", "documents": [{"v": 1}, {"v": 1}], "indexes": [{"name": "v_u", "keys": {"v": 1}, "unique": True}], "validator": None, "saved_queries": []}]}]}
    refused(seed_raw(dup), 409, "duplicate_key")
    for u in (u3, u4):
        refused(Api().req("POST", "/api/auth/signin", {"email": u["email"], "password": u["password"]}), 401, "invalid_credentials")
    assert bad_proj not in [x["name"] for x in own.j("GET", "/api/projects")["projects"]]


def test_projects_and_collections(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    own = w.api("owner")
    fresh = f"Fresh {w.tag}"
    made = own.j("POST", "/api/projects", {"name": fresh, "collection": "first"}, 201)
    assert made["project"]["name"] == fresh and made["collection"]["name"] == "first" and made["collection"]["count"] == 0
    refused(own.req("POST", "/api/projects", {"name": fresh, "collection": "other"}), 409, "name_taken")
    npid = made["project"]["id"]
    P = f"/api/projects/{npid}"
    assert {"id": npid, "name": fresh, "role": "owner"} in own.j("GET", "/api/projects")["projects"]
    zeta = own.j("POST", f"{P}/collections", {"name": "zeta"}, 201)["collection"]
    own.j("POST", f"{P}/collections", {"name": "a" * 64}, 201)
    for name in ["", "a" * 65, "bad name!", "dot.ted"]:
        refused(own.req("POST", f"{P}/collections", {"name": name}), 422, "invalid_field", field="name")
    refused(own.req("POST", f"{P}/collections", {"name": "zeta"}), 409, "name_taken")
    assert [c["name"] for c in own.j("GET", f"{P}/collections")["collections"]] == ["a" * 64, "first", "zeta"]
    own.j("POST", f"{P}/collections/{zeta['id']}/documents", {"document": {"x": 1}}, 201)
    assert own.req("DELETE", f"{P}/collections/{zeta['id']}").status_code == 204
    refused(own.req("GET", f"{P}/collections/{zeta['id']}"), 404, "not_found")
    w.api("editor").j("POST", f"{w.C('pots')}/documents", {"document": {"sku": "POT-5"}}, 201)
    with browse(browser, w.owner, f"/p/{w.pid}") as page:
        item = R(page, "list", "Collections").get_by_role("listitem").filter(has_text="pots")
        eventually(item, lambda _t=None: expect(item).to_contain_text("5", timeout=_t))
        page.reload()
        eventually(item, lambda _t=None: expect(item).to_contain_text("5", timeout=_t))
        page.goto(BASE + w.ui("pots"))
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(5, 5), timeout=_t))
        eventually(R(R(page, "navigation", "Project"), "link", "pots"), lambda _t=None: expect(R(R(page, "navigation", "Project"), "link", "pots")).to_be_visible(timeout=_t))
        page.goto(BASE + f"/p/{npid}")
        ready(R(page, "button", "Delete project")).click()
        ready(R(R(page, "dialog", f"Delete project {fresh}?"), "button", "Delete")).click()
        poll(lambda: own.req("GET", P).status_code == 404, "Delete project removes the project")
    refused(own.req("GET", f"{P}/collections/{made['collection']['id']}"), 404, "not_found")
    assert count_of(own, w.C("pots")) == 5


def test_error_shape_and_order() -> None:
    w = World({"pots": {"documents": E_DOCS, "indexes": [{"name": "sku_u", "keys": {"sku": 1}, "unique": True}]}})
    anon, rd, ed, own, C = Api(), w.api("reader"), w.api("editor"), w.api("owner"), w.C("pots")
    ghost_doc = hexid("e", 999)
    r = anon.http.post(f"{C}/documents", content=b'{"document":{}}', headers={"Content-Type": "text/plain"})
    refused(r, 415, "unsupported_media_type")
    refused(anon.req("GET", f"/api/projects/{uuid.uuid4()}"), 401, "unauthenticated")
    refused(anon.req("POST", f"{C}/documents", {"document": {"$x": 1}}), 401, "unauthenticated")
    refused(rd.req("DELETE", f"{C}/documents/{ghost_doc}"), 404, "not_found")
    refused(rd.req("PUT", f"{C}/documents/{ghost_doc}", {"document": {"$x": 1}, "version": "x"}), 404, "not_found")
    refused(rd.req("POST", f"{C}/documents", {"document": {"$x": 1}}), 403, "read_only")
    refused(ed.req("POST", f"{C}/indexes", {"keys": {}, "unique": False}), 403, "read_only")
    body = refused(ed.req("PUT", f"{C}/documents/{E1}", {"document": {**E_DOCS[0], "$x": 1}, "version": 7}), 409, "version_conflict", current_version=1)
    assert body["current"] == E_DOCS[0]
    refused(own.req("POST", f"{w.P}/invitations", {"email": w.reader["email"], "role": "boss"}), 409, "already_member")
    refused(ed.req("POST", f"{C}/documents", {"document": {"sku": "POT-1", "deep": nest(MAX_DEPTH)}}), 422, "document_too_deep", limit=MAX_DEPTH)
    refused(own.req("POST", f"{C}/indexes", {"keys": {}, "unique": False, "name": "sku_u"}), 422, "invalid_index")
    sq = {"name": "dupe", "filter": {}, "projection": None, "sort": None, "limit": 0}
    ed.j("POST", f"{C}/saved-queries", sq, 201)
    refused(ed.req("POST", f"{C}/saved-queries", {**sq, "filter": "x"}), 422, "invalid_query", field="filter")
    refused(anon.req("POST", "/api/auth/signup", {"email": w.owner["email"], "password": "short", "name": "N"}), 422, "invalid_field", field="password")
    refused(ed.req("POST", f"{C}/documents", {"document": {"sku": "POT-1"}}), 409, "duplicate_key", index="sku_u", value="POT-1")
    assert count_of(own, C) == 4


SENSITIVE_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/pg/package.json"]
ASSET_RE = re.compile(r'(?:src|href)="([^"]+\.(?:js|mjs|css))"')


def json_body_of(size: int) -> bytes:
    base = len(compact({"email": "nobody@jarful-tests.example", "password": "x", "pad": ""}).encode())
    out = compact({"email": "nobody@jarful-tests.example", "password": "x", "pad": "a" * (size - base)}).encode()
    assert len(out) == size
    return out


def test_server_boundary() -> None:
    w = World({"pots": E_DOCS})
    anon, C = Api(), w.C("pots")
    js = {"Content-Type": "application/json"}
    refused(anon.http.post("/api/auth/signin", content=json_body_of(100), headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert anon.http.post("/api/auth/signin", content=json_body_of(JSON_BODY_LIMIT), headers=js).status_code != 413
    refused(anon.http.post("/api/auth/signin", content=json_body_of(JSON_BODY_LIMIT + 1), headers=js), 413, "too_large", limit=JSON_BODY_LIMIT)
    r = anon.http.post("/api/grading/seed", content=json_body_of(GRADING_BODY_LIMIT + 1), headers={**js, "X-Grading-Key": GRADING_KEY})
    refused(r, 413, "too_large", limit=GRADING_BODY_LIMIT)
    over = b'{"p":"' + b"a" * (FILE_BODY_LIMIT + 1 - 8) + b'"}'
    refused(anon.http.post(f"{C}/imports", params={"format": "jsonl"}, content=over, headers={"X-File-Name": "big.jsonl"}), 413, "too_large", limit=FILE_BODY_LIMIT)
    exact = b'{"p":"' + b"a" * (FILE_BODY_LIMIT - 8) + b'"}'
    assert load_file(w.api("editor"), C, exact).status_code != 413
    assert count_of(w.api("owner"), C) == 4
    foreign = "http://elsewhere.example"
    for r in (httpx.get(BASE + "/api/health", headers={"Origin": foreign}, timeout=HTTP_TIMEOUT),
              httpx.options(BASE + "/api/projects", headers={"Origin": foreign, "Access-Control-Request-Method": "POST"}, timeout=HTTP_TIMEOUT)):
        assert CORS_HEADER not in {k.lower() for k in r.headers}, dict(r.headers)
    for path in SENSITIVE_PATHS:
        assert httpx.get(BASE + path, timeout=HTTP_TIMEOUT).status_code == 404, f"{path} must answer 404"
    from urllib.parse import urlparse
    secrets = [os.environ.get(n, "") for n in ("GRADING_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    secrets.append(urlparse(os.environ.get("DATABASE_URL", "")).password or "")
    secrets = [s for s in secrets if len(s) >= 6]
    served = []
    for page_path in ("/", "/signin"):
        html = httpx.get(BASE + page_path, timeout=HTTP_TIMEOUT).text
        served.append(html)
        for ref in ASSET_RE.findall(html):
            url = ref if ref.startswith("http") else BASE + ("" if ref.startswith("/") else "/") + ref
            if same_origin(url, BASE):
                served.append(httpx.get(url, timeout=HTTP_TIMEOUT).text)
    leaked = [s[:3] + "…" for s in secrets if any(s in t for t in served)]
    assert not leaked, f"served assets contain configured secrets: {leaked}"
    with app_copy({"S3_ENDPOINT": "http://127.0.0.1:9", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}) as url:
        r = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}, r.text
        copy_api = Api(url).signin(w.owner)
        to = f"nomail-{w.tag}@jarful-tests.example"
        copy_api.j("POST", f"{w.P}/invitations", {"email": to, "role": "reader"}, 201)
        assert to in [i["email"].lower() for i in copy_api.j("GET", f"{w.P}/members")["invitations"]]


def bbox(loc: Locator) -> dict:
    b = loc.bounding_box()
    assert b, f"{loc} has no layout box"
    return b


VISIBLE_BOX_JS = """e => { const r = e.getBoundingClientRect(); let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
  for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = n.getBoundingClientRect(); l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom); }
  return {x: l + scrollX, y: t + scrollY, width: Math.max(0, rt - l), height: Math.max(0, b - t)}; }"""


def visible_box(loc: Locator) -> dict:
    """The part of an element's box its scrolling panes leave visible (a pane may scroll inside its own box)."""
    bbox(loc)
    return loc.evaluate(VISIBLE_BOX_JS)


def test_published_breakpoints(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5])
    tol = LAYOUT_TOLERANCE_PX
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}"), viewport=DESKTOP) as page:
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open at 1280")
        layout(page)
        page.evaluate("() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); }")
        rail, lst, ed = bbox(R(page, "navigation", "Project")), bbox(R(page, "list", "Documents")), bbox(R(page, "region", "Document editor"))
        assert rail["x"] <= tol and abs(rail["width"] - RAIL_DESKTOP_SHARE * DESKTOP["width"]) <= RAIL_TOLERANCE_PX, rail
        assert rail["x"] + rail["width"] <= lst["x"] + tol and lst["x"] + lst["width"] <= ed["x"] + tol, (rail, lst, ed)
        assert ed["y"] < lst["y"] + lst["height"] and lst["y"] < ed["y"] + ed["height"], "editor column must sit beside the list"
        qb = bbox(query_bar(page))
        assert qb["y"] + qb["height"] <= lst["y"] + tol, "query bar sits above the results"
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_have_count(0, timeout=_t))
        page.goto(BASE + w.ui("pots"))
        eventually(page.get_by_text("Open a document to see it here", exact=True), lambda _t=None: expect(page.get_by_text("Open a document to see it here", exact=True)).to_be_visible(timeout=_t))
        page.goto(BASE + w.ui("pots", "/pipeline"))
        ready(R(page, "group", "Stage 1: $match"), "attached").focus()
        st, pv = bbox(R(page, "list", "Pipeline stages")), bbox(R(page, "region", "Stage preview"))
        assert st["x"] + st["width"] <= pv["x"] + tol, "stage list left of the preview at 1280"
        page.goto(BASE + "/projects")
        assert bbox(R(page, "heading", "YOUR JARS"))["x"] >= LANDING_START_SHARE * DESKTOP["width"] - tol
    with browse(browser, None, "/", viewport=DESKTOP) as page:
        assert bbox(page.get_by_role("heading", name="JARFUL", exact=True, level=1))["x"] >= LANDING_START_SHARE * DESKTOP["width"] - tol
        layout(page)
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}"), viewport=TABLET) as page:
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open at 768")
        layout(page)
        page.evaluate("() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); }")
        rail = bbox(R(page, "navigation", "Project"))
        assert RAIL_TABLET_RANGE[0] * TABLET["width"] <= rail["width"] <= RAIL_TABLET_RANGE[1] * TABLET["width"], rail
        qb, lst, ed = bbox(query_bar(page)), visible_box(R(page, "list", "Documents")), bbox(R(page, "region", "Document editor"))
        assert qb["y"] + qb["height"] <= lst["y"] + tol and ed["y"] >= lst["y"] + lst["height"] - tol, (qb, lst, ed)
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_have_count(0, timeout=_t))
        page.goto(BASE + w.ui("pots", "/pipeline"))
        ready(R(page, "group", "Stage 1: $match"), "attached").focus()
        st, pv = bbox(R(page, "list", "Pipeline stages")), bbox(R(page, "region", "Stage preview"))
        assert pv["y"] >= st["y"] + st["height"] - tol, "preview sits under the stage list at 768"
    with browse(browser, w.owner, w.ui("pots"), viewport=PHONE) as page:
        eventually(R(page, "button", "Collections"), lambda _t=None: expect(R(page, "button", "Collections")).to_be_visible(timeout=_t))
        eventually(R(page, "navigation", "Project"), lambda _t=None: expect(R(page, "navigation", "Project")).to_have_count(0, timeout=_t))
        eventually(page.get_by_role("tablist"), lambda _t=None: expect(page.get_by_role("tablist")).to_be_visible(timeout=_t))
        layout(page)
    with browse(browser, None, "/", viewport=PHONE) as page:
        head, card = bbox(page.get_by_role("heading", name="JARFUL", exact=True, level=1)), bbox(R(page, "region", "Stage Sieve sample"))
        assert head["y"] < card["y"], "hero text comes before the sample card on a phone"
        layout(page)


def sep_value(sep: Locator) -> float:
    v = sep.get_attribute("aria-valuenow")
    return float(v) if v is not None else float("nan")


def expect_sep(sep: Locator, v: float, what: str) -> None:
    poll(lambda: sep_value(sep) == v, f"{what}: expected aria-valuenow {v}, saw {sep_value(sep)}")


def drag_pointer(page: Page, loc: Locator, x: float, y: float) -> None:
    cx, cy = conftest.center(loc)
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(x, y, steps=12)
    page.mouse.up()


def test_resizable_panes(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5])
    with browse(browser, w.owner, w.ui("pots"), viewport=DESKTOP) as page:
        sep = R(page, "separator", "Resize query pane")
        expect_sep(sep, QUERY_PANE_START, "query pane start")
        ready(sep, "attached").focus()
        for key, want in [("ArrowDown", 35), ("ArrowRight", 40), ("ArrowUp", 35), ("ArrowLeft", 30), ("Home", PANE_MIN),
                          ("ArrowUp", PANE_MIN), ("End", PANE_MAX), ("ArrowDown", PANE_MAX)]:
            page.keyboard.press(key)
            expect_sep(sep, want, f"query pane after {key}")
            if key == "Home":
                y_min = bbox(sep)["y"]
            if key == "End":
                y_max = bbox(sep)["y"]
        assert y_max > y_min, "the query pane separator does not move with its value"
        drag_pointer(page, sep, conftest.center(sep)[0], 2)
        expect_sep(sep, PANE_MIN, "query pane dragged to the top")
        drag_pointer(page, sep, conftest.center(sep)[0], DESKTOP["height"] - 2)
        poll(lambda: PANE_MIN < sep_value(sep) <= PANE_MAX, "dragging down raises the query pane within 20..80")
        page.goto(BASE + w.ui("pots", "/pipeline"))
        psep = R(page, "separator", "Resize pipeline pane")
        expect_sep(psep, PIPELINE_PANE_START, "pipeline pane start")
        ready(psep, "attached").focus()
        page.keyboard.press("ArrowLeft")
        expect_sep(psep, PIPELINE_PANE_START - SEPARATOR_STEP, "pipeline pane after ArrowLeft")
        page.keyboard.press("End")
        expect_sep(psep, PANE_MAX, "pipeline pane End")
        drag_pointer(page, psep, 2, conftest.center(psep)[1])
        expect_sep(psep, PANE_MIN, "pipeline pane dragged to the left")
    with browse(browser, w.owner, w.ui("pots"), viewport=TABLET) as page:
        expect_sep(R(page, "separator", "Resize query pane"), QUERY_PANE_START, "query pane at 768")


def test_dialog_keyboard_handling(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5])
    with browse(browser, w.owner, w.ui("pots", f"/d/{E2}")) as page:
        expect_editor_doc(page, lambda d: d.get("_id") == E2, "E2 open")
        for opener, role, name in [("Save query", "dialog", "Save query"), ("Load file", "dialog", "Load file"),
                                   ("Download", "dialog", "Download"), ("Account", "menu", "Account"),
                                   ("Delete document", "dialog", "Delete this document?")]:
            check_trap(page, R(page, "button", opener).first, role, name)
        page.goto(BASE + w.ui("pots", "/pipeline"))
        check_trap(page, R(page, "button", "Delete stage 1"), "dialog", "Delete stage 1 ($match)?")
        page.goto(BASE + f"/p/{w.pid}")
        check_trap(page, R(page, "button", "Delete project"), "dialog", f"Delete project {w.project}?")
    with browse(browser, w.owner, w.ui("pots"), viewport=PHONE) as page:
        check_trap(page, R(page, "button", "Collections"), "dialog", "Collections")
    assert w.api("owner").j("GET", w.P)["name"] == w.project and count_of(w.api("owner"), w.C("pots")) == 4


FAMILIES = ["Araceae", "Cactaceae", "Marantaceae", "Moraceae", "Asparagaceae"]
LIGHTS = ["low", "medium", "bright"]
POT_SIZES = [12, 15, 18]
WATER_BASE = 3
WATER_CYCLE = 12
SAMPLE_PIPELINE = [{"$match": {"light": "bright"}}, {"$unwind": "$pots"}, {"$group": {"_id": "$family", "pots": {"$count": {}}}}, {"$sort": {"pots": -1, "_id": 1}}]


def plant(i: int) -> dict:
    return {"_id": f"{i:024x}", "name": f"Plant {i}", "family": FAMILIES[i % 5], "light": LIGHTS[i % 3],
            "water_days": WATER_BASE + (i % WATER_CYCLE), "pots": POT_SIZES[: i % 4]}


def sample_stage_outputs() -> list[list[dict]]:
    plants = [plant(i) for i in range(1, SAMPLE_INPUT + 1)]
    s1 = [p for p in plants if p["light"] == "bright"]
    s2 = [dict(p, pots=v) for p in s1 for v in p["pots"]]
    counts: dict[str, int] = {}
    for d in s2:
        counts[d["family"]] = counts.get(d["family"], 0) + 1
    s3 = [{"_id": k, "pots": counts[k]} for k in sorted(counts)]
    s4 = sorted(s3, key=lambda d: (-d["pots"], d["_id"]))
    return [s1, s2, s3, s4]


NO_LOOPS_JS = "() => document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming(); return t && t.iterations === Infinity; }).length"


def test_landing_hero_sample(browser: Browser) -> None:
    outs = sample_stage_outputs()
    assert [len(o) for o in outs] == SAMPLE_COUNTS, "verifier houseplant model disagrees with L686"
    r = httpx.get(BASE + "/api/sample/sieve", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["input"] == SAMPLE_INPUT and s["pin"] is None
    assert [(st["index"], st["count"], st["disabled"]) for st in s["stages"]] == [(i, c, False) for i, c in enumerate(SAMPLE_COUNTS)]
    for st, want in zip(s["stages"], outs):
        assert st["documents"] == want[:PREVIEW_DOCS], f"stage {st['index']} documents {st['documents']}"
    with browse(browser, None, "/", live=False) as page:
        eventually(page.get_by_role("heading", name="JARFUL", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="JARFUL", exact=True, level=1)).to_be_visible(timeout=_t))
        eventually(page.get_by_text("Keep, shape and share your JSON documents in one bright jar.", exact=True), lambda _t=None: expect(page.get_by_text("Keep, shape and share your JSON documents in one bright jar.", exact=True)).to_be_visible(timeout=_t))
        hero = R(page, "link", "Start a project").locator("xpath=ancestor::*[.//a[normalize-space()='Sign in']][1]")
        eventually(R(hero, "link", "Sign in"), lambda _t=None: expect(R(hero, "link", "Sign in")).to_be_visible(timeout=_t))
        wait_settled(page, SAMPLE_COUNTS)
        bands = sieve(R(page, "region", "Stage Sieve sample"))
        assert_bars(bands, SAMPLE_COUNTS, SAMPLE_INPUT, set(), "landing hero Stage Sieve")
        assert page.evaluate(NO_LOOPS_JS) == 0, "the landing page runs a looping animation"
        page.clock.resume()
        _PAUSED.discard(page)
        ready(R(page, "link", "Start a project")).click()
        eventually(page, lambda _t=None: expect(page).to_have_url(re.compile(r"/signup$"), timeout=_t))


def test_empty_loading_not_found(browser: Browser) -> None:
    w = World({"empty": [], "pots": E_DOCS})
    with browse(browser, w.owner, w.ui("empty")) as page:
        eventually(page.get_by_text("NOTHING IN THIS JAR YET", exact=True), lambda _t=None: expect(page.get_by_text("NOTHING IN THIS JAR YET", exact=True)).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Load file").first, lambda _t=None: expect(R(page, "button", "Load file").first).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Insert document").first, lambda _t=None: expect(R(page, "button", "Insert document").first).to_be_visible(timeout=_t))
    with browse(browser, w.reader, w.ui("empty")) as page:
        eventually(page.get_by_text("NOTHING IN THIS JAR YET", exact=True), lambda _t=None: expect(page.get_by_text("NOTHING IN THIS JAR YET", exact=True)).to_be_visible(timeout=_t))
        eventually(R(page, "button", "Insert document"), lambda _t=None: expect(R(page, "button", "Insert document")).to_have_count(0, timeout=_t))
        eventually(R(page, "button", "Load file"), lambda _t=None: expect(R(page, "button", "Load file")).to_have_count(0, timeout=_t))
    with browse(browser, w.owner, "/projects") as page:
        with held(page, "**/query") as gate:
            page.goto(BASE + w.ui("pots"))
            eventually(R(page, "navigation", "Project"), lambda _t=None: expect(R(page, "navigation", "Project")).not_to_have_attribute("aria-busy", "true", timeout=_t))
            busy = page.locator('[aria-busy="true"]').first
            eventually(busy, lambda _t=None: expect(busy).to_be_visible(timeout=_t))
            handle = busy.element_handle()
            before, qb_before = bbox(busy), bbox(query_bar(page))
            gate.release()
        eventually(qstatus(page), lambda _t=None: expect(qstatus(page)).to_have_text(matched_text(4, 4), timeout=_t))
        poll(lambda: page.locator('[aria-busy="true"]').count() == 0, "aria-busy is removed when the data lands")
        qb_after = bbox(query_bar(page))
        assert all(abs(qb_after[k] - qb_before[k]) <= LAYOUT_TOLERANCE_PX for k in ("x", "y", "width")), (qb_before, qb_after)
        if handle.evaluate("e => e.isConnected"):
            after = handle.bounding_box()
            assert after and all(abs(after[k] - before[k]) <= LAYOUT_TOLERANCE_PX for k in ("x", "y", "width")), (before, after)
        for path in (f"/p/{uuid.uuid4()}", f"/p/{w.pid}/c/{uuid.uuid4()}", w.ui("pots", f"/d/{hexid('e', 999)}")):
            page.goto(BASE + path)
            eventually(page.get_by_role("heading", name="Not found", exact=True, level=1), lambda _t=None: expect(page.get_by_role("heading", name="Not found", exact=True, level=1)).to_be_visible(timeout=_t))


APP_ROOT = Path("/app")
FONTS = ("TikTok Sans", "Martian Mono")
BUILD_DIRS = {"node_modules", "dist", "build", ".next", "out", "coverage", ".git"}
EXTRA_STORES = {"sqlite3", "better-sqlite3", "sql.js", "@libsql/client", "redis", "ioredis", "memcached", "lowdb", "nedb", "lokijs",
                "level", "pouchdb", "bullmq", "bull", "amqplib", "kafkajs"}


def pkg_name(p: Any) -> str:
    return str(getattr(p, "name", ""))


def notices_text() -> str:
    path = APP_ROOT / "THIRD_PARTY_NOTICES.md"
    assert path.is_file(), "THIRD_PARTY_NOTICES.md is missing from /app"
    return path.read_text(errors="replace")


def app_files(suffixes: tuple[str, ...]) -> list[Path]:
    out = []
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in BUILD_DIRS]
        out += [Path(root) / f for f in files if f.endswith(suffixes)]
    return out


def test_if_run_manifest() -> None:
    m = json.loads((APP_ROOT / "run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1", m
    for k in ("install", "build", "serve"):
        assert isinstance(m.get(k), str) and m[k].strip(), f"run.json {k} must be a non-empty string"


def test_if_third_party_notices() -> None:
    text, pkgs = notices_text(), shipped_packages()
    assert pkgs, "no shipped packages found"
    missing = sorted({pkg_name(p) for p in pkgs if pkg_name(p) not in text})
    assert not missing, f"THIRD_PARTY_NOTICES.md lacks packages: {missing[:40]}"
    assert all(f in text for f in FONTS), f"notices must list fonts {FONTS}"


def test_if_licences_allowed() -> None:
    pkgs = shipped_packages()
    assert pkgs, "no shipped packages found"
    bad = [(pkg_name(p), getattr(p, "licence", None)) for p in pkgs if not licence_allowed(str(getattr(p, "licence", "") or ""), LICENCE_ALLOWLIST)]
    assert not bad, f"packages under disallowed licences: {bad[:40]}"
    text = notices_text()
    for font in FONTS:
        at = text.find(font)
        assert at >= 0 and any(l in text[at:at + 400] for l in LICENCE_ALLOWLIST), f"{font} has no allowed licence next to it"


def test_if_storage_only_postgres_minio() -> None:
    w = World({"pots": [{"marker": f"marker-{w_tag}"} for w_tag in [uuid.uuid4().hex[:12]]]})
    marker = query(w.api("owner"), w.C("pots"))["documents"][0]["marker"]
    pg = kit("Postgres")()
    found = 0
    for t in pg.tables():
        qt = ".".join('"' + part.replace('"', '""') + '"' for part in str(t).split("."))
        try:
            found += int(pg.rows(f"SELECT count(*) AS n FROM {qt} AS x WHERE x::text LIKE '%{marker}%'")[0]["n"])
        except Exception:
            continue
    assert found >= 1, "the seeded document is not stored in PostgreSQL"
    files = [str(p) for p in app_files((".sqlite", ".sqlite3", ".db"))]
    assert not files, f"file-based databases under /app: {files}"
    extra = sorted({pkg_name(p) for p in shipped_packages()} & EXTRA_STORES)
    assert not extra, f"extra datastore or queue packages shipped: {extra}"


def test_if_service_config_unchanged(mail: Any) -> None:
    assert httpx.get(BASE + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert kit("Postgres")().tables(), "the provided PostgreSQL holds no app tables"
    kit("S3")().keys("imports/")
    to = f"cfg-{uuid.uuid4().hex[:10]}@jarful-tests.example"
    Api().j("POST", "/api/auth/signup", {"email": to, "password": "Pw-config-1", "name": "Cfg"}, 201)
    m = inbox(mail, to, 1)[0]
    assert "hello@jarful.test" in [a.lower() for a in kit("addresses")(m.get("From"))]


def test_if_same_origin_assets(browser: Browser) -> None:
    w = World({"pots": E_DOCS})
    put_draft(w.api("owner"), w.C("pots"), [M_GT5])
    urls: list[str] = []
    with browse(browser, w.owner, "/") as page:
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/signin", "/projects", w.ui("pots"), w.ui("pots", "/pipeline")):
            page.goto(BASE + path, wait_until="load")
            urls.extend(page.evaluate("() => performance.getEntriesByType('resource').map(e => e.name)"))
    foreign = sorted({u for u in urls if u.startswith("http") and not same_origin(u, BASE)})
    assert not foreign, f"cross-origin requests: {foreign}"


def test_if_typescript_and_lockfile() -> None:
    lock = APP_ROOT / "package-lock.json"
    assert lock.is_file() and json.loads(lock.read_text()).get("lockfileVersion"), "package-lock.json missing or not an npm lockfile"
    assert [p for p in app_files((".ts", ".tsx")) if not p.name.endswith(".d.ts")], "no TypeScript source under /app"
    js_in_src = [str(p) for p in app_files((".js", ".jsx", ".mjs", ".cjs")) if "src" in p.relative_to(APP_ROOT).parts]
    assert not js_in_src, f"JavaScript files in source folders: {js_in_src[:20]}"
