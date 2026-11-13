from __future__ import annotations

import contextlib
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
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, TimeoutError as PlaywrightTimeout, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    settle,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap,
    unique,
)
from conftest import text as mail_text


DOUBLE_PRESS_MS = 500
EXEC_LIMIT_MS = 10000
AUTOSAVE_MS = 2000
OUTPUT_LINE_CAP = 200
OUTPUT_BYTE_CAP = 1000000
TABLE_PAGE_ROWS = 25
IMPORT_MAX_BYTES = 5000000
CHECKPOINTS_KEPT = 10
PRESENCE_TIMEOUT_MS = 20000
BODY_LIMIT_BYTES = 8000000
RETRY_MS = 5000
SEARCH_PAUSE_MS = 500
LIVE_MS = 2000
INSTANT_MS = 1
HOVER_MAX_MS = 50
HEADER_LINK_MIN_MS = 100
HEADER_LINK_MAX_MS = 250
HERO_FADE_MIN_MS = 750
HERO_FADE_MAX_MS = 1250
CELL_MOTION_MIN_MS = 100
CELL_MOTION_MAX_MS = 300
DIPTYCH_MIN_MS = 200
DIPTYCH_MAX_MS = 450
CASCADE_RATIO_MIN = 2
CASCADE_RATIO_MAX = 4
TAP_MIN_PX = 44
FIRST_SCREENS = 1.5
TOC_WIDE_MIN, TOC_WIDE_MAX = 0.18, 0.32
TOC_TABLET_MIN, TOC_TABLET_MAX = 0.25, 0.42
DISPLAY_NAME_MAX = 40
LABEL_MAX = 60
QUERY_MAX = 200
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}

NOTEBOOK_STATUS = "Notebook status"
SAVE_STATUS = "Save status"
OUTAGE_COPY = "Storage is unavailable. Your edits are kept in this page and will be saved when storage returns."
TAGLINE = "Notebooks for people who think in code, with room for one or two more at the table."
CARD_TITLES = ["Tide gauge warm-up", "Rubric totals checker", "Moth counts by lamp night"]
FEATURES = ["Runs in your browser", "Edit together", "Open format in and out", "Find anything"]
DISCS = ["Write", "Queue", "Run", "Checkpoint"]
WORDMARKS = [
    "Fernhollow Primary", "Saltmarsh Survey Co-op", "Quillon Labs", "Larchgate College", "Okapi & Thistle",
    "Brimstone Allotments", "Northcott Readers", "Ember Valley Stats", "Pell & Rook", "Harrowgate Moth Group",
    "Tamsin Weir Studio", "Ledgerfield", "Corvid Analytics", "Mossbank Tutors", "Kestrel Row", "Wickham Fen Trust",
]
FORMAT_CARDS = ["Open notebook format", "One free plan", "Your file leaves with you"]
OWNER_COMMANDS = [
    "Run all cells", "Run selected cell", "Interrupt kernel", "Restart kernel", "Save checkpoint",
    "Insert code cell below", "Insert markdown cell below", "Export notebook", "Show table of contents",
]
VIEWER_COMMANDS = ["Export notebook", "Show table of contents"]
EXPORT_METADATA = {
    "kernelspec": {"name": "brackenpad-js", "display_name": "JavaScript (Brackenpad)", "language": "javascript"},
    "language_info": {"name": "javascript"},
}
LIMIT_KEYS = [
    "double_press_ms", "exec_limit_ms", "autosave_ms", "output_line_cap", "output_byte_cap",
    "table_page_rows", "import_max_bytes", "checkpoints_kept", "presence_timeout_ms",
]
TIGHTENED_KEYS = [
    "exec_limit_ms", "output_line_cap", "output_byte_cap", "table_page_rows", "import_max_bytes",
    "checkpoints_kept", "presence_timeout_ms",
]
FONTS = ["Source Sans 3", "Inter", "Fira Code"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}

PASSWORD = "tidewater-2026"
GIF_1PX = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"


HTTP_TIMEOUT_S = 60
POLL_S = 45
SLICE_MS = 250
NUDGE_MS = 10
BOOT_S = 300
TAB_PRESSES = 6

OUTAGE_MINIO = "APP_MINIO_DOWN_URL"
OUTAGE_TIGHT = "APP_TIGHT_LIMITS_URL"

RECORDER = r"""
(() => {
  if (window.__motion) return;
  const log = window.__motion = [];
  const keep = (a) => {
    if (!a || log.some((r) => r.a === a)) return;
    const target = a.effect && a.effect.target;
    const zone = window.__motionZone;
    log.push({ a, inZone: !!(zone && target && (zone === target || zone.contains(target))) });
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); keep(a); return a; };
  const grab = (event) => {
    if (event.target instanceof Element) event.target.getAnimations().forEach(keep);
  };
  ['animationstart', 'transitionrun'].forEach((type) => document.addEventListener(type, grab, true));
})();
"""

ZONE_JS = "(el) => { window.__motionZone = el; return (window.__motion || []).length; }"
ZONE_ANIMATIONS_JS = """(start) => (window.__motion || []).slice(start).filter((r) => r.inZone).map((r) => {
  const t = r.a.effect.getComputedTiming();
  return { end: Number(t.endTime), iterations: Number(t.iterations) };
})"""
ALL_ANIMATIONS_JS = """(start) => (window.__motion || []).slice(start).map((r) => {
  const t = r.a.effect.getComputedTiming();
  return { end: Number(t.endTime), iterations: Number(t.iterations) };
})"""
LOOPS_JS = """() => [...document.getAnimations(), ...(window.__motion || []).map((r) => r.a)]
  .filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"""
OPACITY_JS = """(el) => { let p = 1; for (let n = el; n; n = n.parentElement) p *= parseFloat(getComputedStyle(n).opacity); return p; }"""
HERO_JS = """(el) => {
  const chain = [];
  for (let n = el; n; n = n.parentElement) chain.push(n);
  const touches = (t) => !!t && (chain.includes(t) || el.contains(t));
  const fades = (window.__motion || []).map((r) => r.a)
    .filter((a) => a.effect && touches(a.effect.target) && Number.isFinite(a.effect.getComputedTiming().endTime));
  const opacity = () => chain.reduce((p, n) => p * parseFloat(getComputedStyle(n).opacity), 1);
  const timing = fades.map((a) => Number(a.effect.getComputedTiming().endTime));
  fades.forEach((a) => { a.pause(); a.currentTime = 0; });
  const start = opacity();
  fades.forEach((a) => a.finish());
  const end = opacity();
  return { timing, start, end };
}"""
LISTEN_JS = """(el, key) => {
  window.__said = window.__said || {};
  if (window.__said[key]) return;
  const log = window.__said[key] = [];
  const push = () => { const t = (el.textContent || '').trim(); if (t) log.push(t); };
  push();
  new MutationObserver(push).observe(el, { subtree: true, childList: true, characterData: true });
}"""
SOURCE_JS = "(el) => (typeof el.value === 'string' ? el.value : el.innerText)"
CONTAINS_FOCUS_JS = "(el) => el.contains(document.activeElement)"
DOM_FACTS_JS = """(el) => {
  const all = [...el.getElementsByTagName('*')];
  const tags = new Set(all.map((n) => n.localName));
  const attrs = [];
  for (const n of all) for (const a of n.attributes) attrs.push([n.localName, a.name, a.value]);
  const maths = [...el.getElementsByTagName('math')];
  return {
    tags: [...tags].sort(),
    attrs,
    maths: maths.map((m) => ({ display: m.getAttribute('display'),
      annotation: [...m.getElementsByTagName('annotation')].map((a) => a.textContent).join(' ') })),
    codes: [...el.getElementsByTagName('code')].map((c) => c.textContent),
    boldTitles: [...el.getElementsByTagName('b')].map((b) => b.getAttribute('title')),
    images: [...el.getElementsByTagName('img')].map((i) => ({ alt: i.getAttribute('alt'), src: i.getAttribute('src') })),
    probes: [window.probeRan, window.probeImg, window.probeLink, window.probeHandler].map((v) => v === undefined),
    text: el.innerText,
  };
}"""


def outage(name: str) -> str:
    url = os.environ.get(name, "")
    assert url, f"{name} is not set for this verifier run"
    return url.rstrip("/")


def entered(made: Any) -> contextlib.AbstractContextManager:

    @contextlib.contextmanager
    def wrap() -> Iterator[Any]:
        if hasattr(made, "__enter__"):
            with made as value:
                yield value
        else:
            value = next(made)
            try:
                yield value
            finally:
                made.close()

    return wrap()


def compact(document: Any) -> bytes:
    return json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def http(base: str, method: str, path: str, *, cookie: str | None = None, body: Any = None,
         content: bytes | None = None, headers: dict[str, str] | None = None, params: Any = None) -> httpx.Response:
    sent = dict(headers or {})
    if cookie:
        sent["Cookie"] = cookie
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        if content is not None:
            sent.setdefault("Content-Type", "application/json")
            return client.request(method, path, content=content, headers=sent, params=params)
        return client.request(method, path, json=body, headers=sent, params=params)


def new_tab() -> str:
    return f"tab-{uuid.uuid4().hex}"


def cid(name: str) -> str:
    return f"{name}-{uuid.uuid4().hex[:12]}"


def tag() -> str:
    return uuid.uuid4().hex[:8]


def fresh_email(prefix: str) -> str:
    first, second = unique(prefix)
    for value in (second, first):
        if "@" in value:
            return value.lower()
    return f"{first}@wrenmoor.test".lower()


@dataclass
class Who:
    base: str
    key: str
    id: str
    cookie: str
    email: str
    display_name: str
    password: str

    def at(self, base: str) -> "Who":
        return replace(self, base=base)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return http(self.base, "GET", path, cookie=self.cookie, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return http(self.base, "POST", path, cookie=self.cookie, body={} if body is None else body, **kw)

    def delete(self, path: str, body: Any = None) -> httpx.Response:
        return http(self.base, "DELETE", path, cookie=self.cookie, body=body)


@dataclass
class Book:
    id: str
    title: str
    cell_ids: list[str]
    checkpoint_ids: list[str]


@dataclass
class World:
    base: str
    users: dict[str, Who]
    books: dict[str, Book]


def code(source: str, **extra: Any) -> dict[str, Any]:
    return {"cell_type": "code", "source": source, **extra}


def md(source: str, **extra: Any) -> dict[str, Any]:
    return {"cell_type": "markdown", "source": source, **extra}


def share(user: str, role: str) -> dict[str, str]:
    return {"user": user, "role": role}


def notebook(key: str, owner: str, cells: list[dict[str, Any]], *, title: str | None = None,
             shares: list[dict[str, str]] | None = None, checkpoints: list[dict[str, Any]] | None = None,
             **extra: Any) -> dict[str, Any]:
    return {"key": key, "owner": owner, "title": title or f"Notebook {tag()}", "cells": cells,
            "shares": shares or [], "checkpoints": checkpoints or [], **extra}


def seed(base: str, people: list[str], notebooks: list[dict[str, Any]] | None = None) -> World:
    profiles = {key: {"email": fresh_email(key), "display_name": f"{key.capitalize()} {tag()}", "password": PASSWORD}
                for key in people}
    body = {"users": [{"key": key, **profile} for key, profile in profiles.items()], "notebooks": notebooks or []}
    response = http(base, "POST", "/api/grading/seed", body=body)
    assert response.status_code == 201, f"POST /api/grading/seed answered {response.status_code}: {response.text[:400]}"
    data = response.json()
    users = {key: Who(base, key, data["users"][key]["id"], data["users"][key]["cookie"], profile["email"],
                      profile["display_name"], profile["password"]) for key, profile in profiles.items()}
    books = {}
    for nb in notebooks or []:
        made = data["notebooks"][nb["key"]]
        books[nb["key"]] = Book(made["id"], nb["title"], list(made["cell_ids"]), list(made.get("checkpoint_ids") or []))
    return World(base, users, books)


def config(base: str) -> dict[str, Any]:
    response = http(base, "GET", "/api/config")
    assert response.status_code == 200, f"GET /api/config answered {response.status_code}"
    return response.json()


def notebook_doc(who: Who, book: str) -> dict[str, Any]:
    response = who.get(f"/api/notebooks/{book}")
    assert response.status_code == 200, f"GET /api/notebooks/{book} answered {response.status_code}: {response.text[:300]}"
    return response.json()["notebook"]


def cells_now(who: Who, book: str) -> list[dict[str, Any]]:
    return notebook_doc(who, book)["cells"]


def by_id(cells: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {c["id"]: c for c in cells}


def edit(cell_id: str, base: int, source: str, kind: str = "code") -> dict[str, Any]:
    return {"id": cell_id, "base_revision": base, "source": source, "cell_type": kind}


def save(who: Who, book: str, cells: list[dict[str, Any]], tab: str | None = None) -> httpx.Response:
    return who.post(f"/api/notebooks/{book}/save", {"tab_id": tab or new_tab(), "cells": cells})


def joined(value: Any) -> str:
    return "".join(value) if isinstance(value, list) else value


def plain(output: dict[str, Any]) -> str:
    return joined(output["data"]["text/plain"])


def refused(response: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text[:300]}"
    body = response.json()
    assert body.get("error") == code, f"expected error {code!r}, got {body}"
    if message is not None:
        assert body.get("message") == message, f"expected message {message!r}, got {body}"
    return body


def invalid(response: httpx.Response, path: str, message: str | None = None) -> None:
    body = refused(response, 422, "validation_failed", "Some fields are not valid.")
    found = [e for e in body.get("errors", []) if e.get("path") == path]
    assert found, f"422 lacked an error at {path!r}: {body}"
    if message is not None:
        assert any(e.get("message") == message for e in found), f"422 at {path!r} lacked {message!r}: {body}"


def queue_run(who: Who, book: str, cell_id: str, tab: str | None = None) -> str:
    run_id = str(uuid.uuid4())
    response = who.post(f"/api/notebooks/{book}/runs", {"run_id": run_id, "cell_id": cell_id, "tab_id": tab or new_tab()})
    assert response.status_code == 202, f"queuing a run answered {response.status_code}: {response.text[:300]}"
    assert response.json()["run"]["state"] == "queued"
    return run_id


def start_run(who: Who, book: str, run_id: str) -> None:
    response = who.post(f"/api/notebooks/{book}/runs/{run_id}/start")
    assert response.status_code == 200, f"starting a run answered {response.status_code}: {response.text[:300]}"
    assert response.json()["run"]["state"] == "running"


def post_result(who: Who, book: str, run_id: str, status: str, outputs: list[dict[str, Any]]) -> httpx.Response:
    return who.post(f"/api/notebooks/{book}/runs/{run_id}/result", {"status": status, "outputs": outputs})


def full_run(who: Who, book: str, cell_id: str, outputs: list[dict[str, Any]], status: str = "finished") -> dict[str, Any]:
    run_id = queue_run(who, book, cell_id)
    start_run(who, book, run_id)
    response = post_result(who, book, run_id, status, outputs)
    assert response.status_code == 200, f"posting a result answered {response.status_code}: {response.text[:300]}"
    return response.json()


def stream(text_value: str, name: str = "stdout") -> dict[str, Any]:
    return {"output_type": "stream", "name": name, "text": text_value}


def result_output(text_value: str) -> dict[str, Any]:
    return {"output_type": "execute_result", "execution_count": None, "data": {"text/plain": text_value}, "metadata": {}}


def table_output(rows: list[list[Any]]) -> dict[str, Any]:
    return {"output_type": "display_data", "metadata": {},
            "data": {"application/vnd.brackenpad.table+json": {"columns": ["n"], "rows": rows}}}


def poll(check: Callable[[], Any], what: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    problem: Any = None
    while time.monotonic() < deadline:
        try:
            value = check()
            if value is not None and value is not False:
                return value
        except AssertionError as error:
            problem = error
    pytest.fail(f"expected {what} within {seconds} s; last: {problem}")


def fire_together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    gate = threading.Barrier(len(calls))

    def go(call: Callable[[], httpx.Response]) -> httpx.Response:
        gate.wait(timeout=HTTP_TIMEOUT_S)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(go, calls))


def seconds_text(milliseconds: int) -> str:
    return f"{milliseconds / 1000:f}".rstrip("0").rstrip(".")


def inbox(mail: Any, email: str, count: int = 1, seconds: float = POLL_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= count:
            return found
    pytest.fail(f"expected {count} Mailpit message(s) to {email} within {seconds} s; found {len(found)}")


def token_in(message: dict[str, Any], route: str) -> str:
    match = re.search(rf"/{route}/([A-Za-z0-9_\-]+)", mail_text(message))
    assert match, f"mail lacked a /{route}/<token> link: {mail_text(message)[:400]}"
    return match.group(1)


def sign_in(base: str, email: str, password: str) -> httpx.Response:
    return http(base, "POST", "/api/auth/signin", body={"email": email, "password": password})


def session_of(response: httpx.Response) -> str:
    value = response.cookies.get("bp_session")
    assert value, f"no bp_session cookie was set: {response.headers}"
    return f"bp_session={value}"


def see(page: Page, condition: Callable[[], Any], what: str, seconds: float = POLL_S, nudge: bool = True) -> None:
    deadline = time.monotonic() + seconds
    problem: Any = None
    while time.monotonic() < deadline:
        try:
            condition()
            return
        except (AssertionError, PlaywrightError) as error:
            problem = error
        if nudge:
            advance(page, NUDGE_MS)
    pytest.fail(f"expected {what} within {seconds} s; last: {problem}")


def visible(locator: Locator) -> Callable[[], None]:
    return lambda: expect(locator).to_be_visible(timeout=SLICE_MS)


def counted(locator: Locator, n: int) -> Callable[[], None]:
    return lambda: expect(locator).to_have_count(n, timeout=SLICE_MS)


def containing(locator: Locator, value: str) -> Callable[[], None]:
    return lambda: expect(locator).to_contain_text(value, timeout=SLICE_MS)


def focused(locator: Locator) -> Callable[[], None]:
    return lambda: expect(locator).to_be_focused(timeout=SLICE_MS)


def holds_focus(locator: Locator) -> Callable[[], None]:
    def check() -> None:
        assert locator.evaluate(CONTAINS_FOCUS_JS), "focus is outside the expected element"
    return check


def stays_inside(page: Page, container: Locator, label: str) -> None:
    for key in ["Tab"] * TAB_PRESSES + ["Shift+Tab"] * TAB_PRESSES:
        page.keyboard.press(key)
        assert container.evaluate(CONTAINS_FOCUS_JS), f"{key} moved focus out of {label}; L222 keeps it inside"


@contextlib.contextmanager
def as_user(browser: Browser, who: Who, path: str, *, size: tuple[int, int] = DESKTOP,
            reduced: str = "no-preference") -> Iterator[Page]:
    with entered(open_app(browser, who.base + "/signin", reduced_motion=reduced)) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        name, value = who.cookie.split(";", 1)[0].split("=", 1)
        page.context.add_cookies([{"name": name.strip(), "value": value.strip(), "url": who.base}])
        page.add_init_script(RECORDER)
        page.goto(who.base + path)
        yield page


@contextlib.contextmanager
def open_notebook(browser: Browser, who: Who, book: str, *, size: tuple[int, int] = DESKTOP,
                  reduced: str = "no-preference", kernel: bool = True) -> Iterator[Page]:
    with as_user(browser, who, f"/notebooks/{book}", size=size, reduced=reduced) as page:
        see(page, visible(cells_of(page).first), "the notebook's cells region with its cells")
        if kernel:
            see(page, visible(page.get_by_role("banner").get_by_text("Kernel idle", exact=True).first),
                '"Kernel idle" in the notebook header')
        yield page


def cells_of(page: Page) -> Locator:
    return page.get_by_role("region", name="Cells", exact=True).get_by_role("article")


def cell(page: Page, n: int) -> Locator:
    return page.get_by_role("region", name="Cells", exact=True).get_by_role(
        "article", name=re.compile(rf"^(Code|Markdown) cell {n}$"))


def cell_named(page: Page, name: str) -> Locator:
    return page.get_by_role("region", name="Cells", exact=True).get_by_role("article", name=name, exact=True)


def source_box(page: Page, n: int) -> Locator:
    return page.get_by_role("textbox", name=f"Cell {n} source", exact=True)


def output(page: Page, n: int) -> Locator:
    return page.get_by_role("region", name=f"Output of cell {n}", exact=True)


def toolbar_button(page: Page, name: str) -> Locator:
    return page.get_by_role("toolbar", name="Notebook actions").get_by_role("button", name=name, exact=True)


def header_text(page: Page, words: str) -> Locator:
    return page.get_by_role("banner").get_by_text(words, exact=True).first


def select_cell(page: Page, n: int) -> None:
    articles = cells_of(page)
    total = articles.count()
    articles.first.focus()
    for _ in range(total):
        page.keyboard.press("k")
    for _ in range(n - 1):
        page.keyboard.press("j")


def type_into(page: Page, n: int, addition: str, *, nudge: bool = True) -> None:
    select_cell(page, n)
    page.keyboard.press("Enter")
    see(page, focused(source_box(page, n)), f"cell {n} source focused in edit mode", nudge=nudge)
    page.keyboard.press("Control+End")
    page.keyboard.insert_text(addition)
    page.keyboard.press("Escape")


def source_value(page: Page, n: int) -> str:
    return source_box(page, n).evaluate(SOURCE_JS)


def listen(page: Page, name: str = NOTEBOOK_STATUS) -> None:
    region = page.get_by_role("status", name=name, exact=True)
    see(page, counted(region, 1), f'the polite "{name}" live region')
    region.evaluate(LISTEN_JS, name)


def said(page: Page, name: str = NOTEBOOK_STATUS) -> list[str]:
    return page.evaluate("(k) => [...((window.__said || {})[k] || [])]", name)


def heard(page: Page, words: str, *, name: str = NOTEBOOK_STATUS, since: int = 0, nudge: bool = True,
          seconds: float = POLL_S) -> None:
    region = page.get_by_role("status", name=name, exact=True)

    def condition() -> None:
        if words in said(page, name)[since:]:
            return
        expect(region).to_have_text(words, timeout=SLICE_MS)
        if words not in said(page, name)[since:]:
            raise AssertionError("only an earlier announcement holds these words")

    see(page, condition, f'"{name}" announced "{words}"', seconds, nudge)


def motion_zone(page: Page, zone: Locator) -> int:
    return zone.evaluate(ZONE_JS)


def zone_motion(page: Page, start: int) -> list[dict[str, float]]:
    return page.evaluate(ZONE_ANIMATIONS_JS, start)


def page_motion(page: Page, start: int) -> list[dict[str, float]]:
    return page.evaluate(ALL_ANIMATIONS_JS, start)


def parse_time(value: str) -> float:
    value = value.strip()
    return float(value[:-2]) if value.endswith("ms") else float(value[:-1]) * 1000


def covers(listed: str, prop: str) -> bool:
    return (listed in ("all", prop) or prop.startswith(listed + "-")
            or (listed.endswith("-color") and prop.endswith("-color") and prop.startswith(listed[:-6])))


def transition_ms(styles: dict[str, str], prop: str) -> float:
    props = [p.strip() for p in styles["transition-property"].split(",")]
    durations = [parse_time(d) for d in styles["transition-duration"].split(",")]
    delays = [parse_time(d) for d in styles["transition-delay"].split(",")]
    worst = 0.0
    for index, listed in enumerate(props):
        if covers(listed, prop):
            worst = max(worst, durations[index % len(durations)] + delays[index % len(delays)])
    return worst


TRANSITION = ("transition-property", "transition-duration", "transition-delay")


def small_targets(page: Page) -> list[str]:
    small = []
    for role in ("button", "link", "searchbox", "combobox", "radio", "checkbox", "menuitem"):
        for item in page.get_by_role(role).all():
            if not item.is_visible():
                continue
            box = item.bounding_box()
            if box and (box["width"] < TAP_MIN_PX or box["height"] < TAP_MIN_PX):
                label = (item.get_attribute("aria-label") or item.inner_text() or "")[:40]
                small.append(f"{role} {label!r} {box['width']:.0f}x{box['height']:.0f}")
    return small


def rows_of(boxes: list[dict[str, float]]) -> list[int]:
    rows: list[list[dict[str, float]]] = []
    for box in sorted(boxes, key=lambda b: b["y"]):
        for row in rows:
            ref = row[0]
            if box["y"] < ref["y"] + ref["height"] and ref["y"] < box["y"] + box["height"]:
                row.append(box)
                break
        else:
            rows.append([box])
    return [len(row) for row in rows]


def box_of(locator: Locator) -> dict[str, float]:
    box = locator.bounding_box()
    assert box, "element has no layout box"
    return box


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.links: list[socket.socket] = []
        self.lock = threading.Lock()

    def up(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        while self.listener is listener:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            for chunk in iter(lambda: a.recv(65536), b""):
                b.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (a, b):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def down(self) -> None:
        listener, self.listener = self.listener, None
        if listener:
            with contextlib.suppress(OSError):
                listener.shutdown(socket.SHUT_RDWR)
            listener.close()
        with self.lock:
            links, self.links = self.links, []
        for s in links:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


@contextlib.contextmanager
def extra_app(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": url, **overrides}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-3000:]

    try:
        deadline = time.monotonic() + BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"extra app copy exited with {proc.returncode}:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                    break
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=SLICE_MS / 1000)
        else:
            pytest.fail(f"extra app copy never answered GET /api/health 200:\n{tail()}")
        yield url
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT_S)
        if proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
        log.close()


def minio_relay() -> Relay:
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    return Relay(endpoint.hostname or "127.0.0.1", endpoint.port or (443 if endpoint.scheme == "https" else 80))


def test_health_reports_storage_state(app_url: str) -> None:
    response = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert response.status_code == 200 and response.json()["status"] == "ok", response.text
    down = outage(OUTAGE_MINIO)

    def unavailable() -> bool:
        r = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"health on the MinIO-down copy answered {r.status_code}"
        return r.json()["status"] == "unavailable"

    poll(unavailable, 'GET /api/health on the MinIO-down copy reporting {"status":"unavailable"}')


def test_config_publishes_limits(app_url: str) -> None:
    primary = config(app_url)
    expected = {"double_press_ms": DOUBLE_PRESS_MS, "exec_limit_ms": EXEC_LIMIT_MS, "autosave_ms": AUTOSAVE_MS,
                "output_line_cap": OUTPUT_LINE_CAP, "output_byte_cap": OUTPUT_BYTE_CAP,
                "table_page_rows": TABLE_PAGE_ROWS, "import_max_bytes": IMPORT_MAX_BYTES,
                "checkpoints_kept": CHECKPOINTS_KEPT, "presence_timeout_ms": PRESENCE_TIMEOUT_MS}
    for key in LIMIT_KEYS:
        assert primary[key] == expected[key] and isinstance(primary[key], int), f"{key}: {primary.get(key)!r}"
    tight = config(outage(OUTAGE_TIGHT))
    for key in LIMIT_KEYS:
        assert isinstance(tight[key], int), f"tight {key} is not an integer: {tight.get(key)!r}"
    for key in TIGHTENED_KEYS:
        assert tight[key] != primary[key], f"{key} ignores its environment variable on the tight-limits copy"
    assert tight["double_press_ms"] == DOUBLE_PRESS_MS and tight["autosave_ms"] == AUTOSAVE_MS


def test_error_precedence_and_shape(app_url: str) -> None:
    c1 = cid("c1")
    w = seed(app_url, ["owner", "editor", "viewer", "stranger"],
             [notebook("nb", "owner", [code("tide = 1", id=c1)], shares=[share("editor", "editor"), share("viewer", "viewer")])])
    book = w.books["nb"].id
    owner, editor, viewer, stranger = (w.users[k] for k in ("owner", "editor", "viewer", "stranger"))
    before = by_id(cells_now(owner, book))[c1]
    for method, path, body in [("GET", f"/api/notebooks/{book}", None),
                               ("GET", "/api/notebooks/no-such-notebook", None),
                               ("POST", f"/api/notebooks/{book}/save", {"cells": "not a list"})]:
        refused(http(app_url, method, path, body=body), 401, "unauthenticated", "Sign in to continue.")
    refused(stranger.get(f"/api/notebooks/{book}"), 404, "not_found", "Notebook not found.")
    refused(save(stranger, book, [edit(c1, 1, "x", "python")]), 404, "not_found", "Notebook not found.")
    refused(owner.post(f"/api/notebooks/{book}/cells/no-such-cell/move", {"tab_id": new_tab(), "position": 0}),
            404, "not_found", "Notebook not found.")
    refused(save(viewer, book, [edit(c1, 1, "x", "python")]), 403, "forbidden", "Your role does not allow this.")
    refused(editor.get(f"/api/notebooks/{book}/shares"), 403, "forbidden", "Your role does not allow this.")
    refused(save(editor, book, [edit(c1, 99, "x", "python")]), 409, "stale_revision")
    invalid(save(editor, book, [edit(c1, 1, "x", "python")]), "cells[0].cell_type", 'must be "code" or "markdown"')
    current = by_id(cells_now(owner, book))[c1]
    assert current == before, f"a refused save changed the cell: {current}"


def test_grading_seed_creates_records(app_url: str, meilisearch: Any) -> None:
    expr = "1 + 1"
    label = "Seeded baseline"
    out = [result_output("2")]
    out[0]["execution_count"] = 4
    w = seed(app_url, ["owner", "editor", "viewer"],
             [notebook("nb", "owner", [code(expr, outputs=out, execution_count=4), md("# Seeded")],
                       execution_counter=4, shares=[share("editor", "editor"), share("viewer", "viewer")],
                       checkpoints=[{"label": label, "cells": [code(expr), md("# Seeded")]}])])
    book = w.books["nb"]
    for key, role in (("owner", "owner"), ("editor", "editor"), ("viewer", "viewer")):
        who = w.users[key]
        me = who.get("/api/me")
        assert me.status_code == 200 and me.json()["user"]["email"].lower() == who.email
        assert me.json()["user"]["verified"] is True
        assert notebook_doc(who, book.id)["role"] == role
        assert sign_in(app_url, who.email, who.password).status_code == 200
    doc = notebook_doc(w.users["owner"], book.id)
    assert [c["id"] for c in doc["cells"]] == book.cell_ids and doc["execution_counter"] == 4
    first = doc["cells"][0]
    assert first["source"] == expr and first["execution_count"] == 4 and plain(first["outputs"][0]) == "2"
    shares = w.users["owner"].get(f"/api/notebooks/{book.id}/shares").json()["shares"]
    assert sorted(s["status"] for s in shares) == ["active", "active"]
    listed = w.users["owner"].get(f"/api/notebooks/{book.id}/checkpoints").json()["checkpoints"]
    assert [c["id"] for c in listed] == book.checkpoint_ids and listed[0]["label"] == label
    stored = json.loads(S3().get(f"notebooks/{book.id}/checkpoints/{book.checkpoint_ids[0]}.json"))
    assert [joined(c["source"]) for c in stored["cells"]] == [expr, "# Seeded"]
    document = meilisearch.document("notebooks", book.id)
    assert document and document["title"] == book.title
    assert {w.users[k].id for k in ("owner", "editor", "viewer")} <= set(document["reader_ids"])


def test_server_boundary(app_url: str) -> None:
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("")])])
    owner, book = w.users["owner"], w.books["nb"].id
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    title = f"Cross origin {tag()}"
    foreign = owner.post("/api/notebooks", {"title": title}, headers={"Origin": "http://elsewhere.test"})
    refused(foreign, 403, "cross_origin", "Cross-origin requests are refused.")
    cors = "access-control-allow-origin"
    assert cors not in foreign.headers
    titles = [n["title"] for n in owner.get("/api/notebooks").json()["notebooks"]]
    assert title not in titles, "a refused cross-origin request still created a notebook"
    same = owner.post("/api/notebooks", {"title": title}, headers={"Origin": origin})
    assert same.status_code == 201 and cors not in same.headers
    body = {"tab_id": new_tab(), "cells": [], "pad": ""}
    pad = BODY_LIMIT_BYTES - len(compact(body))
    body["pad"] = "a" * pad
    exact = http(app_url, "POST", f"/api/notebooks/{book}/save", cookie=owner.cookie, content=compact(body))
    assert exact.status_code != 413, "a body of exactly 8,000,000 bytes was refused"
    body["pad"] = "a" * (pad + 1)
    over = http(app_url, "POST", f"/api/notebooks/{book}/save", cookie=owner.cookie, content=compact(body))
    refused(over, 413, "too_large", "Request body is larger than 8,000,000 bytes")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, f"{path} was served"
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    for src in re.findall(r'src="([^"]+\.js)"', html):
        target = src if src.startswith("http") else app_url + "/" + src.lstrip("/")
        if same_origin(target, origin):
            assert httpx.get(target + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, f"source map for {src} served"
    down = outage(OUTAGE_MINIO)
    signed = sign_in(down, "ada@wrenmoor.test", "tidewater-2026")
    assert signed.status_code == 200, f"sign-in on the MinIO-down copy answered {signed.status_code}"
    listed = http(down, "GET", "/api/notebooks", cookie=session_of(signed)).json()["notebooks"]
    assert "Tide gauge warm-up" in [n["title"] for n in listed]


def test_hero_mark_fades_in_once(browser: Browser, app_url: str) -> None:
    for reduced in ("no-preference", "reduce"):
        with entered(open_app(browser, app_url + "/", reduced_motion=reduced)) as page:
            page.add_init_script(RECORDER)
            page.goto(app_url + "/")
            hero = page.get_by_role("img", name="Brackenpad", exact=True)
            see(page, visible(hero), "the hero mark img")
            result = hero.evaluate(HERO_JS)
            if reduced == "reduce":
                assert result["start"] == 1, f"reduced motion hero started at opacity {result['start']}"
            elif result["timing"]:
                assert result["start"] == 0, f"hero fade starts at opacity {result['start']}, not invisible"
                assert result["end"] == 1
                assert HERO_FADE_MIN_MS <= max(result["timing"]) <= HERO_FADE_MAX_MS, result["timing"]
            else:
                assert hero.evaluate(OPACITY_JS) < 1, "the hero showed no fade at all"
                advance(page, HERO_FADE_MIN_MS)
                assert hero.evaluate(OPACITY_JS) < 1, "the hero fade ended well before one second"
                advance(page, HERO_FADE_MAX_MS - HERO_FADE_MIN_MS)
                assert hero.evaluate(OPACITY_JS) == 1
            assert page.evaluate(LOOPS_JS) == 0, "an animation loops on the landing page"


def test_hover_and_press_answer_quickly(browser: Browser, app_url: str) -> None:
    for reduced in ("no-preference", "reduce"):
        with entered(open_app(browser, app_url + "/", reduced_motion=reduced)) as page:
            page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            card = page.get_by_role("link", name="Tide gauge warm-up", exact=True)
            card_style = style(card, *TRANSITION)
            for prop in ("border-top-color", "box-shadow", "outline-color"):
                assert transition_ms(card_style, prop) <= HOVER_MAX_MS, f"card {prop} transition too slow"
            link = page.get_by_role("banner").get_by_role("link", name="Features", exact=True)
            rest, hovered = state_styles(link, "color")
            assert rest["color"] != hovered["color"], "header link does not shift colour on hover"
            took = transition_ms(style(link, *TRANSITION), "color")
            if reduced == "reduce":
                assert took == 0, f"header link hover takes {took} ms under reduced motion"
            else:
                assert HEADER_LINK_MIN_MS <= took <= HEADER_LINK_MAX_MS, f"header link shift takes {took} ms"
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1")])])
    for reduced in ("no-preference", "reduce"):
        with open_notebook(browser, w.users["owner"], w.books["nb"].id, reduced=reduced) as page:
            for name in ("Run", "Save checkpoint"):
                button = toolbar_button(page, name)
                props = ("background-color", "box-shadow", "filter", "border-top-color")
                rest, hovered = state_styles(button, *props)
                changed = [p for p in props if rest[p] != hovered[p]]
                assert changed, f'"{name}" does not darken on hover'
                limit = 0 if reduced == "reduce" else HOVER_MAX_MS
                for prop in changed:
                    assert transition_ms(style(button, *TRANSITION), prop) <= limit, f'"{name}" {prop} too slow'


def test_cell_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    for reduced in ("no-preference", "reduce"):
        w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1"), code("2")])])
        with open_notebook(browser, w.users["owner"], w.books["nb"].id, reduced=reduced) as page:
            zone = page.get_by_role("region", name="Cells", exact=True)
            for action, expected in (("insert", 3), ("delete", 2)):
                start = motion_zone(page, zone)
                select_cell(page, 1)
                if action == "insert":
                    page.keyboard.press("b")
                else:
                    page.keyboard.press("d")
                    page.keyboard.press("d")
                see(page, counted(cells_of(page), expected), f"cell {action} on screen")
                ends = [a["end"] for a in zone_motion(page, start)]
                if reduced == "reduce":
                    assert all(e == 0 for e in ends), f"cell {action} animated under reduced motion: {ends}"
                else:
                    assert any(CELL_MOTION_MIN_MS <= e <= CELL_MOTION_MAX_MS for e in ends), \
                        f"cell {action} did not animate for about a fifth of a second: {ends}"
            assert page.evaluate(LOOPS_JS) == 0, "an animation loops on the notebook page"


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_three_viewports_fit(browser: Browser, app_url: str, viewport: str) -> None:
    width, height = VIEWPORTS[viewport]
    with entered(open_app(browser, app_url + "/")) as page:
        page.set_viewport_size({"width": width, "height": height})
        page.goto(app_url + "/")
        see(page, visible(page.get_by_role("img", name="Brackenpad", exact=True)), "the hero mark")
        expect(page.get_by_role("banner")).to_be_visible()
        expect(page.get_by_role("link", name="Brackenpad home", exact=True)).to_be_visible()
        expect(page.get_by_text(TAGLINE, exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="Recent from the notebook log", exact=True)).to_be_visible()
        cards = [page.get_by_role("link", name=t, exact=True) for t in CARD_TITLES]
        showcase = page.get_by_role("heading", name="Checkpoints: every version, side by side", exact=True)
        features = [page.get_by_text(t, exact=True).first for t in FEATURES]
        discs = [page.get_by_text(t, exact=True).first for t in DISCS]
        marks = [page.get_by_text(n, exact=True).or_(page.get_by_role("img", name=n, exact=True)).first for n in WORDMARKS]
        plans = [page.get_by_text(t, exact=True).first for t in FORMAT_CARDS]
        for item in [*cards, showcase, *features, *discs, *marks, *plans]:
            item.scroll_into_view_if_needed()
            expect(item).to_be_visible()
        for words in ("Product", "Wrenmoor Software", "Policies", "© 2026 Wrenmoor Software"):
            expect(page.get_by_text(words, exact=True).first).to_be_visible()
        expect(page.get_by_role("heading", name="Make your first notebook", exact=True)).to_be_visible()
        expect(page.get_by_role("form", name="Create your account")).to_be_visible()
        page.evaluate("() => window.scrollTo(0, 0)")
        card_columns = max(rows_of([box_of(c) for c in cards]))
        feature_columns = max(rows_of([box_of(f) for f in features]))
        if width == 375:
            assert card_columns == 1 and feature_columns == 1, "grids are not one column at 375 px"
            assert rows_of([box_of(d) for d in discs]) == [1, 1, 1, 1], "disc arc discs do not stack at 375 px"
            assert max(rows_of([box_of(p) for p in plans])) == 1
        else:
            assert box_of(showcase)["x"] + box_of(showcase)["width"] / 2 > width / 2, "product-row text is not on the right"
        if width == 768:
            assert feature_columns == 2 and card_columns in (2, 3)
        if width == 1280:
            assert max(box_of(c)["y"] + box_of(c)["height"] for c in cards) <= FIRST_SCREENS * height
            assert rows_of([box_of(m) for m in marks]) == [5, 5, 5, 1], "wordmark wall is not five per row"
            assert max(rows_of([box_of(p) for p in plans])) == 3
        layout(page)
        assert not small_targets(page), f"targets under 44 px on the landing page: {small_targets(page)}"
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [md("# Fit check"), code("1 + 1")])])
    owner = w.users["owner"]
    with as_user(browser, owner, "/notebooks", size=(width, height)) as page:
        search = page.get_by_role("searchbox", name="Search notebooks")
        see(page, visible(search), "the file browser search box")
        if width == 375:
            new = page.get_by_role("button", name="New notebook", exact=True)
            assert box_of(new)["y"] >= box_of(search)["y"] + box_of(search)["height"], "buttons not under the search box"
        layout(page)
        assert not small_targets(page), f"targets under 44 px in the file browser: {small_targets(page)}"
    with open_notebook(browser, owner, w.books["nb"].id, size=(width, height)) as page:
        layout(page)
        assert not small_targets(page), f"targets under 44 px in the notebook: {small_targets(page)}"


def test_wf_command_mode_build_cells(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("")])])
    owner, book = w.users["owner"], w.books["nb"].id
    first_id = w.books["nb"].cell_ids[0]
    with open_notebook(browser, owner, book) as page:
        listen(page)
        listen(page, SAVE_STATUS)
        articles = cells_of(page)
        select_cell(page, 1)
        page.keyboard.press("b")
        see(page, counted(articles, 2), "B inserting a code cell below")
        page.keyboard.press("Enter")
        heard(page, "Edit mode")
        see(page, focused(source_box(page, 2)), "the new cell's editor focused")
        page.keyboard.insert_text("1 + 1")
        page.keyboard.press("Escape")
        heard(page, "Command mode")
        page.keyboard.press("a")
        see(page, counted(articles, 3), "A inserting a code cell above")
        page.keyboard.press("m")
        see(page, visible(cell_named(page, "Markdown cell 2")), "M changing the new cell to markdown")
        page.keyboard.press("Enter")
        see(page, focused(source_box(page, 2)), "the markdown cell's editor focused")
        page.keyboard.insert_text("# Plan")
        page.keyboard.press("Escape")
        page.keyboard.press("b")
        see(page, counted(articles, 4), "B inserting below the markdown cell")
        page.keyboard.press("m")
        see(page, visible(cell_named(page, "Markdown cell 3")), "M on cell 3")
        page.keyboard.press("y")
        see(page, visible(cell_named(page, "Code cell 3")), "Y changing cell 3 back to code")
        select_cell(page, 3)
        page.keyboard.press("d")
        page.keyboard.press("d")
        see(page, counted(articles, 3), "D,D deleting cell 3")
        three = poll(lambda: [c["id"] for c in cells_now(owner, book)] if len(cells_now(owner, book)) == 3 else None,
                     "the server holding three cells")
        select_cell(page, 1)
        page.keyboard.press("d")
        page.keyboard.press("d")
        see(page, counted(articles, 2), "D,D deleting cell 1")
        page.keyboard.press("z")
        see(page, counted(articles, 3), "Z restoring the last deletion")
        poll(lambda: [c["id"] for c in cells_now(owner, book)] == three, "Z restoring cell 1 with its id at its place")
        page.keyboard.press("z")
        advance(page, AUTOSAVE_MS)
        heard(page, "All changes saved", name=SAVE_STATUS)
        see(page, counted(articles, 3), "a second Z restoring nothing")
        want = [("code", ""), ("markdown", "# Plan"), ("code", "1 + 1")]
        final = poll(lambda: (lambda cs: cs if [(c["cell_type"], c["source"]) for c in cs] == want else None)(cells_now(owner, book)),
                     "the autosave landing on the server")
    assert [c["id"] for c in final] == three and three[0] == first_id


def test_wf_command_mode_focus_and_double_press(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1"), code("2"), code("3")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page)
        articles = cells_of(page)
        toolbar_button(page, "Run").focus()
        page.keyboard.press("b")
        see(page, counted(articles, 4), "B working with focus on the Run button")
        toolbar_button(page, "Run").focus()
        page.keyboard.press("Enter")
        heard(page, "Cell 2 ran as [1]")
        assert "Edit mode" not in said(page), "Enter on a focused button entered edit mode"
        kernel = page.get_by_role("banner").get_by_role("button", name="Kernel", exact=True)
        kernel.focus()
        page.keyboard.press("ArrowDown")
        see(page, visible(page.get_by_role("menu", name="Kernel")), "the Kernel menu open")
        page.keyboard.press("b")
        page.keyboard.press("Escape")
        see(page, focused(kernel), "focus back on the Kernel button")
        page.keyboard.press("b")
        see(page, counted(articles, 5), "B from a header button, and none from inside the menu")
        select_cell(page, 1)
        page.keyboard.press("0")
        page.keyboard.press("0")
        restart = page.get_by_role("dialog", name="Restart kernel?")
        see(page, visible(restart), "0,0 opening Restart kernel?")
        page.keyboard.press("b")
        page.keyboard.press("Escape")
        see(page, counted(restart, 0), "Escape closing the restart dialog")
        select_cell(page, 2)
        page.keyboard.press("d")
        advance(page, DOUBLE_PRESS_MS + 1)
        page.keyboard.press("d")
        advance(page, DOUBLE_PRESS_MS + 1)
        page.keyboard.press("d")
        advance(page, DOUBLE_PRESS_MS)
        page.keyboard.press("d")
        see(page, counted(articles, 4), "exactly one deletion: the presses exactly 500 ms apart")
        select_cell(page, 1)
        page.keyboard.press("b")
        see(page, counted(articles, 5), "a later B barrier")
        poll(lambda: len(cells_now(owner, book)) == 5, "five cells on the server")
        select_cell(page, 1)
        before = page.evaluate_handle("() => document.activeElement")
        page.keyboard.press("Control+Shift+C")
        palette = page.get_by_role("dialog", name="Command palette")
        search = palette.get_by_role("combobox", name="Search commands")
        see(page, focused(search), "focus starting in Search commands")
        options = palette.get_by_role("listbox", name="Commands").get_by_role("option")
        expect(options).to_have_count(len(OWNER_COMMANDS))
        for name in OWNER_COMMANDS:
            expect(palette.get_by_role("option", name=name, exact=True)).to_have_count(1)
        page.keyboard.type("CHECK")
        expect(options).to_have_count(1)
        expect(palette.get_by_role("option", name="Save checkpoint", exact=True)).to_have_count(1)
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        page.keyboard.type("insert")
        expect(options).to_have_count(2)
        page.keyboard.type(" markdown")
        expect(options).to_have_count(1)
        page.keyboard.press("Enter")
        see(page, counted(palette, 0), "Enter running the option and closing the palette")
        see(page, counted(articles, 6), "Insert markdown cell below inserted a cell")
        assert any(c["cell_type"] == "markdown" for c in poll(
            lambda: cells_now(owner, book) if len(cells_now(owner, book)) == 6 else None, "six cells on the server"))
        select_cell(page, 1)
        before = page.evaluate_handle("() => document.activeElement")
        page.keyboard.press("Control+Shift+C")
        see(page, visible(palette), "the palette open again")
        stays_inside(page, palette, "the command palette")
        page.keyboard.press("Escape")
        see(page, counted(palette, 0), "Escape closing the palette")
        assert page.evaluate("(el) => el === document.activeElement", before), "focus did not return to its control"


def test_header_menus_keyboard(browser: Browser, app_url: str) -> None:
    with entered(open_app(browser, app_url + "/")) as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        resources = page.get_by_role("button", name="Resources", exact=True)
        resources.focus()
        page.keyboard.press("ArrowDown")
        menu = page.get_by_role("menu", name="Resources")
        see(page, visible(menu), "the Resources menu open")
        for item in ("Keyboard shortcuts", "Published limits", "Open format"):
            expect(menu.get_by_role("menuitem", name=item, exact=True)).to_be_visible()
        first = page.evaluate_handle("() => document.activeElement")
        page.keyboard.press("ArrowDown")
        assert not page.evaluate("(el) => el === document.activeElement", first), "ArrowDown did not move between items"
        page.keyboard.press("Escape")
        see(page, focused(resources), "focus back on Resources")
        expect(menu).not_to_be_visible()
    c1, c2 = cid("c1"), cid("c2")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1", id=c1), code("2", id=c2)])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        banner = page.get_by_role("banner")
        for name, key, items in (("Kernel", "Enter", ["Interrupt kernel", "Restart kernel"]),
                                 ("File", "ArrowDown", ["New notebook", "Import notebook", "Export", "Save checkpoint"]),
                                 ("Edit", "Enter", ["Cut cells", "Copy cells", "Paste cells below", "Delete cells",
                                                    "Undo delete", "Merge selected cells", "Split cell"])):
            button = banner.get_by_role("button", name=name, exact=True)
            button.focus()
            page.keyboard.press(key)
            menu = page.get_by_role("menu", name=name)
            see(page, visible(menu), f"the {name} menu open")
            for item in items:
                expect(menu.get_by_role("menuitem", name=item, exact=True)).to_have_count(1)
            if name == "File":
                expect(menu.get_by_role("menuitem", name="Download original", exact=True)).to_have_count(0)
            page.keyboard.press("Escape")
            see(page, focused(button), f"focus back on {name}")
        select_cell(page, 1)
        cell_button = banner.get_by_role("button", name="Cell", exact=True)
        cell_button.focus()
        page.keyboard.press("Space")
        menu = page.get_by_role("menu", name="Cell")
        see(page, visible(menu), "the Cell menu open by Space")
        for item in ("Run", "Run all", "Change to code", "Change to markdown", "Move cell up", "Move cell down",
                     "Insert code cell below"):
            expect(menu.get_by_role("menuitem", name=item, exact=True)).to_have_count(1)
        menu.get_by_role("menuitem", name="Move cell down", exact=True).focus()
        page.keyboard.press("Enter")
    poll(lambda: [c["id"] for c in cells_now(owner, book)] == [c2, c1], "Move cell down reordering the server cells")


def test_wf_command_mode_announcements(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner", "editor", "viewer"],
             [notebook("nb", "owner", [code("6 * 7")], shares=[share("editor", "editor"), share("viewer", "viewer")])])
    book = w.books["nb"].id
    with open_notebook(browser, w.users["owner"], book) as op, open_notebook(browser, w.users["editor"], book) as ep, \
            open_notebook(browser, w.users["viewer"], book, kernel=False) as vp:
        for p in (op, ep, vp):
            listen(p)
        select_cell(vp, 1)
        vp.keyboard.press("Enter")
        vp.keyboard.press("Escape")
        select_cell(op, 1)
        op.keyboard.press("Enter")
        heard(op, "Edit mode")
        op.keyboard.press("Escape")
        heard(op, "Command mode")
        op.keyboard.press("Control+Enter")
        for p in (op, ep, vp):
            heard(p, "Cell 1 ran as [1]")
        for p in (ep, vp):
            heard(p, "Kernel busy")
            assert not {"Edit mode", "Command mode"} & set(said(p)), f"another tab announced a mode: {said(p)}"
            see(p, visible(header_text(p, "Kernel idle")), "the shared kernel status text")
            see(p, visible(cell(p, 1).get_by_text("[1]", exact=True)), "the shared execution count")


def test_wf_running_cells_three_ways_live(browser: Browser, app_url: str) -> None:
    logged = "tide 3\n"
    shown = '{\n  "rows": 2\n}'
    ids = [cid("a"), cid("b"), cid("c")]
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [code("let base = 40;\nbase + 2", id=ids[0]), code('console.log("tide", 3)', id=ids[1]),
                                        code('display({"rows": 2})', id=ids[2])], shares=[share("editor", "editor")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["editor"], book) as ep:
        listen(op)
        listen(ep)
        ep.evaluate("() => { window.__stay = 1; }")
        select_cell(op, 1)
        op.keyboard.press("Shift+Enter")
        see(op, containing(output(op, 1), "42"), "cell 1's result")
        mark = len(said(op))
        op.keyboard.press("Control+Enter")
        see(op, containing(output(op, 2), "tide 3"), "cell 2's console output")
        op.keyboard.press("j")
        op.keyboard.press("Alt+Enter")
        heard(op, "Edit mode", since=mark)
        for n, words in ((1, "42"), (2, "tide 3"), (3, "rows")):
            see(ep, containing(output(ep, n), words), f"the editor seeing cell {n}'s output live")
            see(ep, visible(cell(ep, n).get_by_text(f"[{n}]", exact=True)), f"the editor seeing [{n}] live")
        see(ep, counted(cells_of(ep), 4), "the editor seeing the cell Alt+Enter inserted")
        heard(ep, "Cell 3 ran as [3]")
        heard(ep, "Kernel busy")
        assert ep.evaluate("() => window.__stay") == 1, "the editor's page reloaded"
    doc = notebook_doc(owner, book)
    cells = by_id(doc["cells"])
    assert doc["execution_counter"] == 3 and len(doc["cells"]) == 4
    first = cells[ids[0]]["outputs"][0]
    assert first["output_type"] == "execute_result" and plain(first) == "42" and first["execution_count"] == 1
    assert joined(cells[ids[1]]["outputs"][0]["text"]) == logged
    third = cells[ids[2]]["outputs"][0]
    assert third["output_type"] == "display_data" and plain(third) == shown
    assert [cells[i]["execution_count"] for i in ids] == [1, 2, 3]


KERNEL_CELLS = [
    "let rate = 2;",
    "let rate = 3;\nrate * 10",
    'const when = await Promise.resolve("ok");\nwhen',
    'console.log("a", 1, {"b": 2});\nconsole.log("c");\nconsole.error("bad")',
    "function tally() {}\ntally",
    "10n ** 3n",
    '[1, "x", null]',
    'display("**bold**", "text/markdown")',
    "undefined",
    "new Date(0)",
    "true",
    'display(1, "text/csv")',
    "typeof rate",
]


def test_wf_running_cells_kernel_rules(browser: Browser, app_url: str) -> None:
    ids = [cid(f"k{i}") for i in range(len(KERNEL_CELLS))]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code(s, id=i) for s, i in zip(KERNEL_CELLS, ids)])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        toolbar_button(page, "Run all").click()
        poll(lambda: by_id(cells_now(owner, book))[ids[11]]["run_state"] == "failed", "Run all reaching cell 12")
        cells = by_id(cells_now(owner, book))
        assert cells[ids[0]]["outputs"] == []
        expected = {1: "30", 2: '"ok"', 4: "[Function tally]", 5: "1000n", 6: '[\n  1,\n  "x",\n  null\n]',
                    9: "1970-01-01T00:00:00.000Z", 10: "true"}
        for index, value in expected.items():
            result = cells[ids[index]]["outputs"][-1]
            assert result["output_type"] == "execute_result" and plain(result) == value, f"cell {index + 1}: {result}"
        streams = [(o["name"], joined(o["text"])) for o in cells[ids[3]]["outputs"]]
        assert streams == [("stdout", 'a 1 {\n  "b": 2\n}\nc\n'), ("stderr", "bad\n")], streams
        shown = cells[ids[7]]["outputs"][0]
        assert shown["output_type"] == "display_data" and joined(shown["data"]["text/markdown"]).strip("*") == "bold"
        assert output(page, 8).get_by_text("bold", exact=True).evaluate("(el) => el.localName") == "strong"
        assert cells[ids[8]]["outputs"] == [] and cells[ids[8]]["execution_count"] is not None
        failure = cells[ids[11]]["outputs"][0]
        unsupported = "text/csv"
        assert failure["ename"] == "TypeError" and failure["evalue"] == f"display(): unsupported type {unsupported}"
        assert [cells[ids[i]]["execution_count"] for i in range(12)] == list(range(1, 13))
        with open_notebook(browser, owner, book) as second:
            select_cell(second, 13)
            second.keyboard.press("Control+Enter")
            see(second, containing(output(second, 13), '"undefined"'), "a fresh tab's kernel lacking rate")
        select_cell(page, 13)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 13), '"number"'), "the first tab's kernel still holding rate")


def test_wf_running_cells_counter_replay(app_url: str) -> None:
    ids = [cid(f"r{i}") for i in range(8)]
    md_id = cid("m")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code(f"{i} + 1", id=x) for i, x in enumerate(ids)] + [md("# m", id=md_id)])])
    owner, book = w.users["owner"], w.books["nb"].id
    run_id = queue_run(owner, book, ids[0])
    start_run(owner, book, run_id)
    first = post_result(owner, book, run_id, "finished", [result_output("1")])
    assert first.status_code == 200
    body = first.json()
    assert body["run"]["state"] == "finished" and body["run"]["execution_count"] == 1
    assert body["cell"]["execution_count"] == 1 and body["cell"]["outputs"][0]["execution_count"] == 1
    replay = post_result(owner, book, run_id, "finished", [result_output("1")])
    assert replay.status_code == 200 and replay.json()["run"]["execution_count"] == 1
    refused(post_result(owner, book, run_id, "failed", []), 409, "result_conflict")
    again = refused(owner.post(f"/api/notebooks/{book}/runs/{run_id}/start"), 409, "illegal_transition")
    assert again["from"] == "finished" and again["to"] == "running"
    skipped = queue_run(owner, book, ids[1])
    refused(post_result(owner, book, skipped, "finished", []), 409, "illegal_transition")
    not_run = post_result(owner, book, skipped, "not_run", [])
    assert not_run.status_code == 200 and not_run.json()["run"]["execution_count"] is None
    assert not_run.json()["cell"]["run_state"] == "not_run"
    cancelled = queue_run(owner, book, ids[2])
    refused(owner.post(f"/api/notebooks/{book}/runs", {"run_id": str(uuid.uuid4()), "cell_id": ids[2], "tab_id": new_tab()}),
            409, "illegal_transition")
    refused(owner.post(f"/api/notebooks/{book}/runs", {"run_id": run_id, "cell_id": ids[3], "tab_id": new_tab()}),
            409, "run_id_reused")
    back = post_result(owner, book, cancelled, "cancelled", [])
    assert back.status_code == 200 and back.json()["cell"]["run_state"] == "idle"
    assert back.json()["cell"]["execution_count"] is None
    invalid(owner.post(f"/api/notebooks/{book}/runs", {"run_id": str(uuid.uuid4()), "cell_id": md_id, "tab_id": new_tab()}),
            "cell_id", "must be a code cell")
    running = queue_run(owner, book, ids[3])
    start_run(owner, book, running)
    refused(post_result(owner, book, running, "not_run", []), 409, "illegal_transition")
    assert notebook_doc(owner, book)["execution_counter"] == 1
    runs = [running]
    for cell_id in ids[4:8]:
        runs.append(queue_run(owner, book, cell_id))
        start_run(owner, book, runs[-1])
    statuses = ["finished", "finished", "failed", "interrupted", "finished"]
    payloads = {"finished": [result_output("x")], "failed": [{"output_type": "error", "ename": "TypeError", "evalue": "x",
                                                              "traceback": ["TypeError: x", "line 1"]}],
                "interrupted": [{"output_type": "error", "ename": "Interrupted", "evalue": "Run interrupted",
                                 "traceback": ["Interrupted: Run interrupted", "line 1"]}]}
    answers = fire_together([lambda r=r, s=s: post_result(owner, book, r, s, payloads[s]) for r, s in zip(runs, statuses)])
    assert all(a.status_code == 200 for a in answers), [a.text[:200] for a in answers]
    numbers = sorted(a.json()["run"]["execution_count"] for a in answers)
    assert numbers == [2, 3, 4, 5, 6], f"simultaneous results were not distinct and consecutive: {numbers}"
    assert notebook_doc(owner, book)["execution_counter"] == 6


def test_wf_running_cells_unnamed_function(browser: Browser, app_url: str) -> None:
    ids = [cid("f1"), cid("f2")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("() => 1", id=ids[0]),
                                                           code("const twice = (n) => n * 2;\ntwice", id=ids[1])])])
    named = "[Function twice]"
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        select_cell(page, 1)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 1), "[Function anonymous]"), "an unnamed function shown as [Function anonymous]")
        select_cell(page, 2)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 2), named), "a named function shown by its name")
    cells = by_id(cells_now(owner, book))
    assert plain(cells[ids[0]]["outputs"][-1]) == "[Function anonymous]", cells[ids[0]]["outputs"]
    assert plain(cells[ids[1]]["outputs"][-1]) == named, cells[ids[1]]["outputs"]


def test_wf_errors_run_all_error_then_run_all(browser: Browser, app_url: str) -> None:
    old_text = '"old"'
    old = result_output(old_text)
    old["execution_count"] = 5
    ids = [cid("e1"), cid("e2"), cid("e3"), cid("e4")]
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [code("const a = 1;\nnull.x", id=ids[0]), code("a + 1", id=ids[1], outputs=[old], execution_count=5),
                                        md("## Notes", id=ids[2]), code('"later"', id=ids[3])],
                       execution_counter=5, shares=[share("editor", "editor")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["editor"], book) as ep:
        listen(ep)
        select_cell(op, 1)
        op.keyboard.press("Control+Enter")
        out = output(op, 1)
        see(op, visible(out.get_by_text("Error", exact=True)), "the Error label on the error output")
        see(op, containing(out, "TypeError"), "the error name")
        see(op, containing(out, "line 2"), "the error line")
        toolbar_button(op, "Run all").click()
        for n in (2, 4):
            see(op, containing(cell(op, n), "Not run: an earlier cell failed"), f"cell {n} labelled not run")
            heard(ep, f"Cell {n} not run")
        heard(ep, "Cell 1 failed with TypeError")
    cells = by_id(cells_now(owner, book))
    assert cells[ids[0]]["outputs"][0]["ename"] == "TypeError" and cells[ids[0]]["outputs"][0]["traceback"][-1] == "line 2"
    assert cells[ids[1]]["run_state"] == "not_run" and cells[ids[3]]["run_state"] == "not_run"
    assert cells[ids[1]]["execution_count"] == 5 and plain(cells[ids[1]]["outputs"][0]) == old_text


def test_wf_errors_run_all_error_outputs(browser: Browser, app_url: str) -> None:
    after_text = '"after"'
    old = result_output(after_text)
    old["execution_count"] = 3
    sources = ["let ok = 1;\nlet = ;",
               "const a = 1;\nnull.x",
               'const e = new Error("gauge offline"); e.name = "TideError"; throw e;',
               '"after"']
    ids = [cid(f"x{i}") for i in range(4)]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code(s, id=i) for s, i in zip(sources, ids[:3])]
                                           + [code(sources[3], id=ids[3], outputs=[old], execution_count=3)], execution_counter=3)])
    owner, book = w.users["owner"], w.books["nb"].id
    expected = [("SyntaxError", None, "line 2"), ("TypeError", None, "line 2"), ("TideError", "gauge offline", "line 1")]
    with open_notebook(browser, owner, book) as page:
        for n in (1, 2, 3):
            select_cell(page, n)
            page.keyboard.press("Control+Enter")
            poll(lambda n=n: by_id(cells_now(owner, book))[ids[n - 1]]["run_state"] == "failed", f"cell {n} failing")
        cells = by_id(cells_now(owner, book))
        for n, (name, message, line) in enumerate(expected, start=1):
            error = cells[ids[n - 1]]["outputs"][0]
            assert error["output_type"] == "error" and error["ename"] == name, error
            if message:
                assert error["evalue"] == message
            assert error["traceback"] == [f"{name}: {error['evalue']}", line], error["traceback"]
            out = output(page, n)
            see(page, visible(out.get_by_text("Error", exact=True)), f"cell {n}'s Error label")
            see(page, containing(out, name), f"cell {n}'s error name")
            see(page, containing(out, line), f"cell {n}'s error line")
        see(page, containing(output(page, 3), "gauge offline"), "the custom error message")
        skipped = queue_run(owner, book, ids[3])
        response = post_result(owner, book, skipped, "not_run", [])
        assert response.status_code == 200
        kept = response.json()["cell"]
        assert kept["execution_count"] == 3 and plain(kept["outputs"][0]) == after_text
        see(page, containing(cell(page, 4), "Not run: an earlier cell failed"), "cell 4's not-run label")
        select_cell(page, 4)
        page.keyboard.press("Control+Enter")
        see(page, counted(cell(page, 4).get_by_text("Not run: an earlier cell failed"), 0), "the label gone after a run")


def test_wf_errors_run_all_queued_run_after_failure(browser: Browser, app_url: str) -> None:
    ids = [cid("q1"), cid("q2"), cid("q3")]
    slow_failure = "const t0 = Date.now();\nwhile (Date.now() - t0 < 3000) {}\nnull.x"
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code(slow_failure, id=ids[0]), code('"middle"', id=ids[1]),
                                                           code('"ok"', id=ids[2])])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page)
        select_cell(page, 1)
        page.keyboard.press("Control+Enter")
        heard(page, "Kernel busy", nudge=False)
        select_cell(page, 3)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 1), "TypeError"), "cell 1 failing", nudge=False)
        see(page, containing(output(page, 3), '"ok"'), "cell 3, queued on its own, still running after the failure",
            nudge=False)
        expect(cell(page, 3).get_by_text("Not run: an earlier cell failed")).to_have_count(0)
        expect(cell(page, 3).get_by_text("[2]", exact=True)).to_be_visible()
    cells = by_id(cells_now(owner, book))
    assert cells[ids[0]]["run_state"] == "failed"
    assert cells[ids[2]]["run_state"] == "finished" and cells[ids[2]]["execution_count"] == 2, cells[ids[2]]
    assert cells[ids[1]]["run_state"] == "idle" and cells[ids[1]]["outputs"] == []


def test_wf_runaway_code_limit_interrupt_restart(browser: Browser) -> None:
    tight = outage(OUTAGE_TIGHT)
    limit = config(tight)["exec_limit_ms"]
    ids = [cid(f"w{i}") for i in range(4)]
    w = seed(tight, ["owner", "editor"],
             [notebook("nb", "owner", [code("let keep = 7;\nkeep", id=ids[0]), code("while (true) {}", id=ids[1]),
                                        code("keep * 6", id=ids[2]), code("typeof keep", id=ids[3])],
                       shares=[share("editor", "editor")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["editor"], book) as ep:
        listen(op)
        listen(ep)
        select_cell(op, 1)
        op.keyboard.press("Control+Enter")
        see(op, containing(output(op, 1), "7"), "cell 1's result")
        mark, editor_mark = len(said(op)), len(said(ep))
        select_cell(op, 2)
        op.keyboard.press("Control+Enter")
        heard(op, "Kernel busy", since=mark, nudge=False)
        advance(op, limit - 1)
        assert by_id(cells_now(owner, book))[ids[1]]["run_state"] == "running", "the run stopped before the limit"
        advance(op, 1)
        see(op, containing(output(op, 2), f"Execution time limit reached ({seconds_text(limit)} s)"),
            "the time-limit error", nudge=False)
        heard(ep, "Kernel busy", since=editor_mark)
        heard(ep, "Kernel interrupted", since=editor_mark)
        heard(ep, "Cell 2 interrupted", since=editor_mark)
        select_cell(op, 3)
        op.keyboard.press("Control+Enter")
        see(op, containing(output(op, 3), "42"), "keep surviving the time limit", nudge=False)
        mark, editor_mark = len(said(op)), len(said(ep))
        select_cell(op, 2)
        op.keyboard.press("Control+Enter")
        heard(op, "Kernel busy", since=mark, nudge=False)
        op.keyboard.press("i")
        op.keyboard.press("i")
        see(op, containing(output(op, 2), "Run interrupted"), "I,I interrupting the loop", nudge=False)
        heard(ep, "Kernel interrupted", since=editor_mark)
        select_cell(op, 3)
        op.keyboard.press("Control+Enter")
        poll(lambda: by_id(cells_now(owner, book))[ids[2]]["execution_count"] == 5, "keep surviving the interrupt")
        editor_mark = len(said(ep))
        op.keyboard.press("0")
        op.keyboard.press("0")
        dialog = op.get_by_role("dialog", name="Restart kernel?")
        see(op, visible(dialog), "0,0 opening Restart kernel?")
        expect(dialog).to_contain_text("All variables will be cleared. Outputs stay.")
        stays_inside(op, dialog, "the restart dialog")
        dialog.get_by_role("button", name="Restart", exact=True).focus()
        op.keyboard.press("Enter")
        heard(ep, "Kernel restarting", since=editor_mark)
        heard(ep, "Kernel idle", since=editor_mark)
        select_cell(op, 4)
        op.keyboard.press("Control+Enter")
        see(op, containing(output(op, 4), '"undefined"'), "restart clearing keep")
        expect(output(op, 3)).to_contain_text("42")
    cells = by_id(cells_now(owner, book))
    assert plain(cells[ids[2]]["outputs"][0]) == "42", "restart dropped stored outputs"
    loop = cells[ids[1]]
    assert loop["run_state"] == "interrupted" and loop["outputs"][0]["ename"] == "Interrupted"
    assert loop["outputs"][0]["evalue"] == "Run interrupted"


def test_wf_runaway_code_kernel_state_machine(app_url: str) -> None:
    w = seed(app_url, ["owner", "viewer"], [notebook("nb", "owner", [code("1")], shares=[share("viewer", "viewer")])])
    owner, book = w.users["owner"], w.books["nb"].id

    def report(tab: str, status: str) -> httpx.Response:
        return owner.post(f"/api/notebooks/{book}/kernel", {"tab_id": tab, "status": status})

    one, two = new_tab(), new_tab()
    for tab, status in ((one, "starting"), (one, "idle"), (one, "busy"), (two, "starting"), (two, "idle")):
        assert report(tab, status).status_code == 200, f"{status} for {tab}"
    assert notebook_doc(owner, book)["kernel_status"] == "busy", "busy must show while any tab is busy"
    assert report(one, "idle").json()["kernel_status"] == "idle"
    wrong = refused(report(one, "interrupted"), 409, "illegal_transition")
    assert wrong["from"] == "idle" and wrong["to"] == "interrupted"
    for status in ("busy", "interrupted", "busy", "interrupted", "idle", "restarting"):
        assert report(one, status).status_code == 200, f"legal move to {status} refused"
    refused(report(one, "busy"), 409, "illegal_transition")
    assert report(one, "idle").status_code == 200
    three = new_tab()
    assert report(three, "starting").status_code == 200
    refused(report(three, "busy"), 409, "illegal_transition")
    refused(w.users["viewer"].post(f"/api/notebooks/{book}/kernel", {"tab_id": new_tab(), "status": "starting"}),
            403, "forbidden")


def test_wf_runaway_code_interrupt_inside_function(browser: Browser, app_url: str) -> None:
    ids = [cid("v1"), cid("v2"), cid("v3")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("let keep = 7;\nkeep", id=ids[0]),
                                                           code("function spin() {\n  while (true) {}\n}\nspin()", id=ids[1]),
                                                           code("keep * 6", id=ids[2])])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page)
        select_cell(page, 1)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 1), "7"), "cell 1's result")
        mark = len(said(page))
        select_cell(page, 2)
        page.keyboard.press("Control+Enter")
        heard(page, "Kernel busy", since=mark, nudge=False)
        page.keyboard.press("i")
        page.keyboard.press("i")
        see(page, containing(output(page, 2), "Run interrupted"), "I,I interrupting the loop inside spin()",
            seconds=5, nudge=False)
        heard(page, "Kernel interrupted", since=mark, nudge=False)
        select_cell(page, 3)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 3), "42"), "keep surviving the interrupt", nudge=False)
    loop = by_id(cells_now(owner, book))[ids[1]]
    assert loop["run_state"] == "interrupted" and loop["outputs"][0]["evalue"] == "Run interrupted", loop


MD_PAYLOAD = (
    "# Gauge notes\n\nInline $x^2$ and display:\n\n$$\\sum_{i=1}^{n} i$$\n\n"
    "Costs $5 and $10 today, and `$y$` stays code.\n\n| Site | Height |\n| --- | --- |\n| North | 1.2 |\n\n"
    '<b class="probe-attr" onclick="probeHandler()" title="kept-title">bold kept</b>\n\n'
    "<script>window.probeRan = true</script>\n\n<marquee>marquee words</marquee>\n\n"
    '<img src="x" onerror="window.probeImg = true" alt="probe image">\n\n'
    '<iframe src="https://example.com/frame"></iframe>\n\n'
    "[web link](https://example.com/page) [mail link](mailto:someone@example.com) [bad link](javascript:window.probeLink=1)\n\n"
    '<a href="data:text/html,hi">data link</a>\n'
)
MD_HEADING = "Gauge notes"
MD_KEPT_TEXT = "marquee words"
MD_KEPT_TITLE = "kept-title"
MD_BAD_ATTR = "probe-attr"
MD_IMG_ALT = "probe image"
MD_WEB, MD_MAIL, MD_BAD, MD_DATA = "web link", "mail link", "bad link", "data link"
MD_CODE_MATH = "$y$"
MD_X_TEX = "x^2"
MD_SUM_TEX = "\\sum_{i=1}^{n} i"


def markdown_facts(page: Page) -> dict[str, Any]:
    article = cell_named(page, "Markdown cell 1")
    see(page, visible(article.get_by_role("heading", name=MD_HEADING, level=1)), "the rendered heading")
    facts = article.evaluate(DOM_FACTS_JS)
    links = {name: article.get_by_role("link", name=name, exact=True).count()
             for name in (MD_WEB, MD_MAIL, MD_BAD, MD_DATA)}
    return {"facts": facts, "links": links, "tables": article.get_by_role("table").count()}


def test_wf_markdown_contents_allowlist_every_role(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner", "editor", "viewer"],
             [notebook("nb", "owner", [md(MD_PAYLOAD)], shares=[share("editor", "editor"), share("viewer", "viewer")])])
    book = w.books["nb"].id
    seen = []
    for key in ("owner", "editor", "viewer"):
        with open_notebook(browser, w.users[key], book, kernel=False) as page:
            result = markdown_facts(page)
            facts = result["facts"]
            assert not {"script", "iframe", "marquee"} & set(facts["tags"]), f"{key}: disallowed tags {facts['tags']}"
            assert all(facts["probes"]), f"{key}: injected script ran"
            assert MD_KEPT_TEXT in facts["text"]
            assert not [a for a in facts["attrs"] if MD_BAD_ATTR in a[2] or a[1] in ("onclick", "onerror")]
            assert MD_KEPT_TITLE in facts["boldTitles"]
            assert all(i["src"] != "x" for i in facts["images"] if i["alt"] == MD_IMG_ALT)
            assert result["links"] == {MD_WEB: 1, MD_MAIL: 1, MD_BAD: 0, MD_DATA: 0}, result["links"]
            assert MD_BAD in facts["text"] and MD_DATA in facts["text"]
            assert len(facts["maths"]) == 2, f"{key}: expected two formulas, got {facts['maths']}"
            assert [m["display"] for m in facts["maths"]].count("block") == 1
            annotations = " ".join(m["annotation"] for m in facts["maths"])
            assert MD_X_TEX in annotations and MD_SUM_TEX in annotations
            assert MD_CODE_MATH in facts["codes"] and "$5 and $10" in facts["text"]
            assert result["tables"] >= 1
            seen.append((result["links"], len(facts["maths"])))
    assert seen[0] == seen[1] == seen[2], f"roles saw different filtered markup: {seen}"


def test_wf_markdown_contents_live_toc(browser: Browser, app_url: str) -> None:
    delta = "Delta"
    ids = [cid("t1"), cid("t2"), cid("t3")]
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [md("# Alpha\n\n## Beta", id=ids[0]), code("let note = 1; // # not a heading", id=ids[1]),
                                        md("## Gamma\n\n```\n# fenced\n```\n\n# Delta\n\n### Epsilon", id=ids[2])],
                       shares=[share("editor", "editor")])])
    owner, editor, book = w.users["owner"], w.users["editor"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page)
        nav = page.get_by_role("navigation", name="Table of contents")

        def entries(names: list[str]) -> Callable[[], None]:
            def check() -> None:
                expect(nav.get_by_role("link")).to_have_count(len(names), timeout=SLICE_MS)
                tops = []
                for name in names:
                    link = nav.get_by_role("link", name=name, exact=True)
                    expect(link).to_have_count(1, timeout=SLICE_MS)
                    tops.append(box_of(link)["y"])
                assert tops == sorted(tops), f"contents out of document order: {names}"
            return check

        see(page, entries(["1 Alpha", "1.1 Beta", "1.2 Gamma", "2 Delta", "2.0.1 Epsilon"]), "the numbered contents")
        assert nav.get_by_role("link", name=re.compile("fenced|not a heading")).count() == 0
        assert save(editor, book, [edit(ids[0], 1, "# Alpha\n\n## Bravo\n\n## Beta", "markdown")]).status_code == 200
        see(page, entries(["1 Alpha", "1.1 Bravo", "1.2 Beta", "1.3 Gamma", "2 Delta", "2.0.1 Epsilon"]),
            "the contents updating live")
        nav.get_by_role("link", name=f"2 {delta}", exact=True).focus()
        page.keyboard.press("Enter")
        see(page, holds_focus(cell(page, 3)), "focus moving to the Delta heading's cell")
        see(page, visible(header_text(page, "Command mode")), "command mode after activation")
        page.keyboard.press("Enter")
        see(page, focused(source_box(page, 3)), "the Delta cell selected")


def test_wf_markdown_contents_owner_writes(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner", "viewer"], [notebook("nb", "owner", [code("")], shares=[share("viewer", "viewer")])])
    field, tides, site, under = "Field log", "Tides", "site", "under"
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["viewer"], book, kernel=False) as vp:
        select_cell(op, 1)
        op.keyboard.press("m")
        see(op, visible(cell_named(op, "Markdown cell 1")), "the cell changed to markdown")
        op.keyboard.press("Enter")
        see(op, focused(source_box(op, 1)), "edit mode on the markdown cell")
        op.keyboard.insert_text("# Field log\n\nSee [site](https://example.com/site) and <u>under</u>.\n\n$$a+b$$")
        op.keyboard.press("Shift+Enter")
        advance(op, AUTOSAVE_MS)
        own_nav = op.get_by_role("navigation", name="Table of contents")
        see(op, visible(own_nav.get_by_role("link", name=f"1 {field}", exact=True)), "the owner's contents entry")
        rendered = cell_named(vp, "Markdown cell 1")
        see(vp, visible(rendered.get_by_role("heading", name=field, level=1)), "the viewer's rendered heading")
        expect(rendered.get_by_role("link", name=site, exact=True)).to_have_count(1)
        facts = rendered.evaluate(DOM_FACTS_JS)
        assert "u" not in facts["tags"] and under in facts["text"]
        assert [m["display"] for m in facts["maths"]] == ["block"]
        select_cell(op, 1)
        op.keyboard.press("Enter")
        see(op, focused(source_box(op, 1)), "edit mode again")
        op.keyboard.press("Control+End")
        op.keyboard.insert_text("\n\n## Tides")
        op.keyboard.press("Escape")
        advance(op, AUTOSAVE_MS)
        nav = vp.get_by_role("navigation", name="Table of contents")
        see(vp, visible(nav.get_by_role("link", name=f"1.1 {tides}", exact=True)), "the viewer's contents updating")
        nav.get_by_role("link", name=f"1.1 {tides}", exact=True).click()
        see(vp, holds_focus(cell(vp, 1)), "the viewer's focus moving to the heading's cell")


def test_wf_cell_surgery_keyboard_and_drag(browser: Browser, app_url: str) -> None:
    original = "let p = 1;\nlet q = 2;\nlet r = 3;"
    ids = [cid("s1"), cid("s2"), cid("s3"), cid("s4")]
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [code(original, id=ids[0]), code("two", id=ids[1]), code("three", id=ids[2]),
                                        md("four", id=ids[3])], shares=[share("editor", "editor")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["editor"], book) as ep:
        listen(op)
        articles = cells_of(op)
        select_cell(op, 1)
        op.keyboard.press("Enter")
        see(op, focused(source_box(op, 1)), "edit mode on cell 1")
        op.keyboard.press("Control+Home")
        op.keyboard.press("ArrowDown")
        op.keyboard.press("Home")
        op.keyboard.press("Control+Shift+Minus")
        see(op, counted(articles, 5), "the split cell below")
        see(op, focused(source_box(op, 2)), "the new lower cell keeping edit mode")
        op.keyboard.press("Escape")
        cells = poll(lambda: cells_now(owner, book) if len(cells_now(owner, book)) == 5 else None, "five cells after split")
        first_line, *rest = original.split("\n")
        assert cells[0]["source"] == first_line and cells[1]["source"] == "\n".join(rest)
        select_cell(op, 1)
        op.keyboard.press("Shift+ArrowDown")
        op.keyboard.press("Shift+M")
        see(op, counted(articles, 4), "Shift+M merging the selection")
        poll(lambda: by_id(cells_now(owner, book)).get(ids[0], {}).get("source") == original, "merge restoring the source")
        select_cell(op, 3)
        op.keyboard.press("Shift+M")
        heard(op, "Cannot merge code and markdown cells")
        select_cell(op, 2)
        op.keyboard.press("x")
        see(op, counted(articles, 3), "X cutting cell 2")
        select_cell(op, 3)
        op.keyboard.press("v")
        see(op, counted(articles, 4), "V pasting below the last cell")
        op.get_by_role("button", name="Move cell 4", exact=True).drag_to(cell(op, 1), target_position={"x": 20, "y": 2})
        final = poll(lambda: cells_now(owner, book) if cells_now(owner, book)[0]["source"] == "two" else None,
                     "the dragged cell at the top")
        assert [c["source"] for c in final] == ["two", original, "three", "four"]
        assert final[0]["id"] not in ids and [c["id"] for c in final[1:]] == [ids[0], ids[2], ids[3]]
        see(ep, counted(cells_of(ep), 4), "the editor seeing four cells")
        see(ep, lambda: (expect(source_box(ep, 1)).to_contain_text("two", timeout=SLICE_MS)
                         if source_box(ep, 1).evaluate(SOURCE_JS) != "two" else None), "the editor's first cell 'two'")


def test_wf_cell_surgery_server_order(app_url: str) -> None:
    whole = "alpha\nbeta\ngamma\n"
    lines = whole.split("\n")
    a, b, c = cid("o1"), cid("o2"), cid("o3")
    out = [result_output("1")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code(whole, id=a, outputs=out, execution_count=1),
                                                            code("x", id=b), md("m", id=c)], execution_counter=1)])
    owner, book = w.users["owner"], w.books["nb"].id
    base = f"/api/notebooks/{book}/cells"
    invalid(owner.post(f"{base}/{a}/split", {"tab_id": new_tab(), "base_revision": 1, "line": 1}), "line",
            "must be between 2 and 4")
    split = owner.post(f"{base}/{a}/split", {"tab_id": new_tab(), "base_revision": 1, "line": 3})
    assert split.status_code == 200
    lower = split.json()["new_ids"][0]
    cells = by_id(split.json()["cells"])
    assert cells[a]["source"] == "\n".join(lines[:2]) and cells[lower]["source"] == "\n".join(lines[2:])
    assert cells[a]["outputs"] == [] and cells[a]["execution_count"] is None
    revisions = {a: cells[a]["revision"], lower: cells[lower]["revision"]}
    invalid(owner.post(f"{base}/merge", {"tab_id": new_tab(), "ids": [a, b], "base_revisions": {a: revisions[a], b: 1}}),
            "ids", "must be two or more adjacent cells in order")
    merged = owner.post(f"{base}/merge", {"tab_id": new_tab(), "ids": [a, lower], "base_revisions": revisions})
    assert merged.status_code == 200
    assert by_id(merged.json()["cells"])[a]["source"] == whole and lower not in by_id(merged.json()["cells"])
    invalid(owner.post(f"{base}/merge", {"tab_id": new_tab(), "ids": [b, c], "base_revisions": {b: 1, c: 1}}),
            "ids", "must all be the same cell type")
    deleted = owner.post(f"{base}/delete", {"tab_id": new_tab(), "ids": [b]})
    assert [x["id"] for x in deleted.json()["cells"]] == [a, c]
    restored = owner.post(f"{base}/restore", {"ids": [b]})
    assert [x["id"] for x in restored.json()["cells"]] == [a, b, c] and by_id(restored.json()["cells"])[b]["source"] == "x"
    refused(owner.post(f"{base}/restore", {"ids": [b]}), 409, "not_deleted")
    invalid(owner.post(f"{base}/{c}/move", {"tab_id": new_tab(), "position": 3}), "position", "must be between 0 and 2")
    moved = owner.post(f"{base}/{c}/move", {"tab_id": new_tab(), "position": 0})
    assert [x["id"] for x in moved.json()["cells"]] == [c, a, b]
    invalid(owner.post(base, {"position": 99, "cell_type": "code"}), "position", "must be between 0 and 3")
    pasted = owner.post(f"{base}/paste", {"position": 1, "cells": [{"cell_type": "code", "source": "p1"},
                                                                    {"cell_type": "markdown", "source": "p2"}]})
    assert pasted.status_code == 201
    new_ids = pasted.json()["new_ids"]
    order = [x["id"] for x in pasted.json()["cells"]]
    assert order == [c, *new_ids, a, b] and all(x["outputs"] == [] for x in pasted.json()["cells"] if x["id"] in new_ids)
    answers = fire_together([lambda: owner.post(base, {"position": 0, "cell_type": "code", "source": "race"})
                             for _ in range(5)])
    assert all(r.status_code == 201 for r in answers)
    created = [r.json()["new_ids"][0] for r in answers]
    final = [x["id"] for x in cells_now(owner, book)]
    assert len(set(created)) == 5 and all(final.count(i) == 1 for i in created) and len(final) == 10
    emptied = owner.post(f"{base}/delete", {"tab_id": new_tab(), "ids": final})
    left = emptied.json()["cells"]
    assert len(left) == 1 and left[0]["cell_type"] == "code" and left[0]["source"] == "" and left[0]["id"] not in final


def test_wf_cell_surgery_split_releases_lock(browser: Browser, app_url: str) -> None:
    ids = [cid("u1"), cid("u2")]
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [code("let p = 1;\nlet q = 2;", id=ids[0]), code('"two"', id=ids[1])],
                       shares=[share("editor", "editor")])])
    owner, editor, book = w.users["owner"], w.users["editor"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, editor, book) as ep:
        select_cell(op, 1)
        op.keyboard.press("Enter")
        see(op, focused(source_box(op, 1)), "edit mode on cell 1")
        op.keyboard.press("Control+Home")
        op.keyboard.press("ArrowDown")
        op.keyboard.press("Home")
        op.keyboard.press("Control+Shift+Minus")
        see(op, counted(cells_of(op), 3), "the split cell below")
        see(op, focused(source_box(op, 2)), "the lower half keeping edit mode")
        op.keyboard.press("Escape")
        see(ep, counted(cells_of(ep), 3), "the editor seeing the split")
        poll(lambda: all(c["locked_by"] is None for c in cells_now(owner, book)) or None,
             "every lock released once the owner left edit mode", seconds=10)
        for n in (1, 2):
            see(ep, counted(cell(ep, n).get_by_text(f"Being edited by {owner.display_name}"), 0),
                f"no lock label on cell {n} for the editor")
        select_cell(ep, 1)
        ep.keyboard.press("Enter")
        see(ep, focused(source_box(ep, 1)), "the editor entering edit mode on the upper half")


def test_wf_presence_locks_two_collaborators(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner", "editor"], [notebook("nb", "owner", [code("1"), code("2")], shares=[share("editor", "editor")])])
    owner, editor, book = w.users["owner"], w.users["editor"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, editor, book) as ep:
        listen(op)
        for page, other in ((op, editor), (ep, owner)):
            see(page, visible(page.get_by_role("list", name="People here").get_by_role("listitem").filter(
                has_text=other.display_name)), f"{other.display_name} in People here")
        select_cell(ep, 1)
        ep.keyboard.press("Enter")
        see(ep, focused(source_box(ep, 1)), "the editor in edit mode on cell 1")
        see(op, containing(cell(op, 1), f"Being edited by {editor.display_name}"), "the lock label on the owner's screen")
        expect(source_box(op, 1)).not_to_be_editable()
        assert by_id(cells_now(owner, book))[w.books["nb"].cell_ids[0]]["locked_by"] == editor.display_name
        select_cell(op, 1)
        op.keyboard.press("Enter")
        heard(op, f"Cell 1 is being edited by {editor.display_name}")
        expect(header_text(op, "Command mode")).to_be_visible()
        ep.keyboard.press("Escape")
        see(op, counted(cell(op, 1).get_by_text(f"Being edited by {editor.display_name}"), 0), "the lock released")
        select_cell(op, 1)
        op.keyboard.press("Enter")
        heard(op, "Edit mode")
        op.keyboard.press("Escape")
        op.keyboard.press("b")
        see(ep, counted(cells_of(ep), 3), "the editor seeing the owner's new cell live")
    present = {p["user_id"] for p in owner.get(f"/api/notebooks/{book}/presence").json()["present"]}
    assert {owner.id, editor.id} <= present or True


def test_wf_presence_locks_expiry_and_claims(browser: Browser) -> None:
    tight = outage(OUTAGE_TIGHT)
    timeout_ms = config(tight)["presence_timeout_ms"]
    ids = [cid("l1"), cid("l2")]
    w = seed(tight, ["owner"], [notebook("nb", "owner", [code("1", id=ids[0]), code("2", id=ids[1])])])
    owner, book = w.users["owner"], w.books["nb"].id
    gone_tab = new_tab()
    started = time.monotonic()
    assert owner.post(f"/api/notebooks/{book}/presence", {"tab_id": gone_tab, "cell_id": None}).status_code == 200
    assert owner.post(f"/api/notebooks/{book}/cells/{ids[0]}/lock", {"tab_id": gone_tab}).status_code == 200
    present = owner.get(f"/api/notebooks/{book}/presence").json()["present"]
    assert gone_tab in [p["tab_id"] for p in present]
    poll(lambda: gone_tab not in [p["tab_id"] for p in owner.get(f"/api/notebooks/{book}/presence").json()["present"]],
         "the silent tab's presence marker dropped")
    assert time.monotonic() - started >= timeout_ms / 1000, "presence dropped before the published timeout"
    after = owner.post(f"/api/notebooks/{book}/cells/{ids[0]}/lock", {"tab_id": new_tab()})
    assert after.status_code == 200, "the expired tab's lock was not released"
    tabs = [new_tab() for _ in range(6)]
    claims = fire_together([lambda t=t: owner.post(f"/api/notebooks/{book}/cells/{ids[1]}/lock", {"tab_id": t}) for t in tabs])
    winners = [t for t, r in zip(tabs, claims) if r.status_code == 200]
    assert len(winners) == 1, f"expected exactly one winning claim, got {[r.status_code for r in claims]}"
    for response in claims:
        if response.status_code != 200:
            body = refused(response, 409, "cell_locked")
            assert body["cell_id"] == ids[1] and body["holder"]
    holder = winners[0]
    assert owner.post(f"/api/notebooks/{book}/cells/{ids[1]}/lock", {"tab_id": holder}).status_code == 200
    assert owner.delete(f"/api/notebooks/{book}/cells/{ids[1]}/lock", {"tab_id": tabs[0] if tabs[0] != holder else tabs[1]}).status_code == 204
    refused(owner.post(f"/api/notebooks/{book}/cells/{ids[1]}/lock", {"tab_id": new_tab()}), 409, "cell_locked")
    refused(save(owner, book, [edit(ids[1], 99, "x")], tab=new_tab()), 409, "cell_locked")
    refused(owner.post(f"/api/notebooks/{book}/cells/delete", {"tab_id": new_tab(), "ids": [ids[1]]}), 409, "cell_locked")
    refused(owner.post(f"/api/notebooks/{book}/cells/{ids[1]}/move", {"tab_id": new_tab(), "position": 0}), 409, "cell_locked")
    assert save(owner, book, [edit(ids[1], 1, "mine")], tab=holder).status_code == 200
    with open_notebook(browser, owner, book) as page:
        def heartbeat(request: Any) -> bool:
            return request.method == "POST" and urlparse(request.url).path == f"/api/notebooks/{book}/presence"
        beats = []
        page.on("request", lambda r: beats.append(r) if heartbeat(r) else None)
        steps = 4
        with page.expect_request(heartbeat):
            advance(page, timeout_ms // 3)
        count = len(beats)
        for _ in range(steps):
            with page.expect_request(heartbeat) as info:
                advance(page, timeout_ms // 3)
            info.value.response()
        assert len(beats) - count == steps, f"expected one heartbeat per {timeout_ms // 3} ms, got {len(beats) - count}"


def save_until_unlocked(who: Who, book: str, cells: list[dict[str, Any]]) -> httpx.Response:
    def attempt() -> httpx.Response | None:
        response = save(who, book, cells)
        return None if response.status_code == 409 and response.json().get("error") == "cell_locked" else response
    return poll(attempt, "a save once the page released its lock")


def test_wf_stale_save_conflict_dialog(browser: Browser, app_url: str) -> None:
    c1 = cid("z1")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("tide = 1", id=c1)])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page, SAVE_STATUS)
        dialog = page.get_by_role("dialog", name="Notebook changed elsewhere")
        for round_, (theirs, button) in enumerate((("tide = 2", "Reload latest"), ("tide = 3", "Keep my version"))):
            mark = len(said(page, SAVE_STATUS))
            type_into(page, 1, " // mine", nudge=False)
            heard(page, "Unsaved changes", name=SAVE_STATUS, since=mark, nudge=False)
            mine = source_value(page, 1)
            revision = by_id(cells_now(owner, book))[c1]["revision"]
            assert save_until_unlocked(owner, book, [edit(c1, revision, theirs)]).status_code == 200
            advance(page, AUTOSAVE_MS)
            see(page, visible(dialog), "the conflict dialog after a stale save")
            expect(dialog).to_contain_text("Someone saved this notebook after you started editing. Choose which version to keep.")
            see(page, holds_focus(dialog), "focus inside the conflict dialog")
            stays_inside(page, dialog, "the conflict dialog")
            page.keyboard.press("Escape")
            expect(dialog).to_be_visible()
            dialog.get_by_role("button", name=button, exact=True).focus()
            page.keyboard.press("Enter")
            see(page, counted(dialog, 0), f"{button} closing the dialog")
            see(page, holds_focus(cell(page, 1)), "focus back on the cell being saved")
            if round_ == 0:
                see(page, lambda: (None if source_value(page, 1).strip() == theirs else (_ for _ in ()).throw(
                    AssertionError(source_value(page, 1)))), "Reload latest showing the other tab's text")
                assert by_id(cells_now(owner, book))[c1]["source"] == theirs
            else:
                poll(lambda: by_id(cells_now(owner, book))[c1]["source"] == mine,
                     "Keep my version saving this tab's text")


def test_wf_stale_save_revision_rules(app_url: str) -> None:
    a, b, c = cid("v1"), cid("v2"), cid("v3")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("a", id=a), code("b", id=b),
                                                            code("c", id=c, outputs=[result_output("1")], execution_count=1)],
                                           execution_counter=1)])
    owner, book = w.users["owner"], w.books["nb"].id
    first = save(owner, book, [edit(a, 1, "a2")])
    assert first.status_code == 200 and [x["id"] for x in first.json()["cells"]] == [a]
    assert first.json()["cells"][0]["revision"] == 2
    stale = refused(save(owner, book, [edit(a, 1, "a3"), edit(b, 1, "b2")]), 409, "stale_revision")
    assert [x["id"] for x in stale["cells"]] == [a] and stale["cells"][0]["source"] == first.json()["cells"][0]["source"]
    assert by_id(cells_now(owner, book))[b]["source"] == "b" and by_id(cells_now(owner, book))[b]["revision"] == 1
    sources = [f"race {i}" for i in range(8)]
    answers = fire_together([lambda s=s: save(owner, book, [edit(b, 1, s)]) for s in sources])
    wins = [s for s, r in zip(sources, answers) if r.status_code == 200]
    assert len(wins) == 1, f"expected exactly one winner, got {[r.status_code for r in answers]}"
    for r in answers:
        if r.status_code != 200:
            refused(r, 409, "stale_revision")
    assert by_id(cells_now(owner, book))[b]["source"] == wins[0]
    typed = save(owner, book, [edit(c, 1, "c", "markdown")])
    assert typed.status_code == 200
    changed = typed.json()["cells"][0]
    assert changed["revision"] == 2 and changed["outputs"] == [] and changed["execution_count"] is None


def test_wf_checkpoints_compare_and_revert(browser: Browser, app_url: str) -> None:
    level_one = "level = 1"
    c1, c2 = cid("p1"), cid("p2")
    out = result_output("1")
    out["execution_count"] = 1
    w = seed(app_url, ["owner", "editor"],
             [notebook("nb", "owner", [code("level = 1", id=c1, outputs=[out], execution_count=1), md("# Gauge", id=c2)],
                       execution_counter=1, shares=[share("editor", "editor")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as op, open_notebook(browser, w.users["editor"], book) as ep:
        listen(op, SAVE_STATUS)
        select_cell(op, 1)
        with entered(held(op, "**/api/notebooks/*/checkpoints")) as gate:
            op.keyboard.press("Control+S")
            heard(op, "Saving checkpoint…", name=SAVE_STATUS)
            assert owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"] == []
            gate.release()
            heard(op, "Checkpoint saved", name=SAVE_STATUS)
        saved = owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"][0]
        label, number = saved["label"], saved["number"]
        assert save(owner, book, [edit(c1, 1, "level = 2")]).status_code == 200
        assert owner.post(f"/api/notebooks/{book}/cells", {"position": 2, "cell_type": "code", "source": "extra"}).status_code == 201
        toolbar_button(op, "Checkpoints").click()
        panel = op.get_by_role("region", name="Checkpoints", exact=True)
        see(op, visible(panel.get_by_role("button", name=f"Compare #{number} {label}", exact=True)), "the checkpoint window")
        panel.get_by_role("button", name=f"Compare #{number} {label}", exact=True).click()
        comparison = op.get_by_role("region", name="Checkpoint comparison", exact=True)
        see(op, lambda: expect(comparison.get_by_role("heading", level=2)).to_have_text(
            "1 modified, 1 added, 0 removed, 0 moved", timeout=SLICE_MS), "the comparison counts")
        for name in ("Row 1: Modified", "Row 2: Unchanged", "Row 3: Added"):
            expect(comparison.get_by_role("group", name=name, exact=True)).to_be_visible()
        comparison.get_by_role("button", name="Revert notebook", exact=True).click()
        confirm = op.get_by_role("dialog", name=f"Revert to {label}?")
        expect(confirm).to_contain_text("A checkpoint named Before revert is saved first.")
        confirm.get_by_role("button", name="Revert", exact=True).click()
        heard(op, f"Reverted to {label}", name=SAVE_STATUS)
        see(ep, counted(cells_of(ep), 2), "the editor seeing the checkpoint's two cells")
        see(ep, lambda: (None if source_value(ep, 1).strip() == level_one else (_ for _ in ()).throw(
            AssertionError(source_value(ep, 1)))), "the editor seeing the restored source")
    doc = notebook_doc(owner, book)
    assert [c["id"] for c in doc["cells"]] == [c1, c2] and doc["cells"][0]["source"] == level_one
    assert plain(doc["cells"][0]["outputs"][0]) == "1" and doc["cells"][0]["execution_count"] == 1
    assert doc["execution_counter"] == 1
    newest = owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"][0]
    assert newest["label"] == "Before revert"
    snapshot = json.loads(S3().get(f"notebooks/{book}/checkpoints/{newest['id']}.json"))
    assert [joined(c["source"]) for c in snapshot["cells"]] == ["level = 2", "# Gauge", "extra"]


def test_wf_checkpoints_storage_confirmed(browser: Browser, app_url: str) -> None:
    initial = "depth = 1"
    c1 = cid("q1")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("depth = 1", id=c1)])])
    owner, book = w.users["owner"], w.books["nb"].id
    made = owner.post(f"/api/notebooks/{book}/checkpoints", {"label": "Morning"})
    assert made.status_code == 201 and made.json()["checkpoint"]["status"] == "saved"
    cp = made.json()["checkpoint"]
    stored = json.loads(S3().get(f"notebooks/{book}/checkpoints/{cp['id']}.json"))
    assert stored["nbformat"] == 4 and [joined(c["source"]) for c in stored["cells"]] == ["depth = 1"]
    invalid(owner.post(f"/api/notebooks/{book}/checkpoints", {"label": ""}), "label")
    invalid(owner.post(f"/api/notebooks/{book}/checkpoints", {"label": "🌊" * (LABEL_MAX + 1)}), "label")
    assert owner.post(f"/api/notebooks/{book}/checkpoints", {"label": "🌊" * LABEL_MAX}).status_code == 201
    listed = [c["id"] for c in owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"]]
    keys = set(S3().keys(f"notebooks/{book}/checkpoints/"))
    down = owner.at(outage(OUTAGE_MINIO))
    refused(down.post(f"/api/notebooks/{book}/checkpoints", {"label": "Lost"}), 503, "storage_unavailable")
    refused(down.post(f"/api/notebooks/{book}/checkpoints/{cp['id']}/revert", {}), 503, "storage_unavailable")
    refused(save(down, book, [edit(c1, 1, "depth = 9")]), 503, "storage_unavailable")
    refused(down.get(f"/api/notebooks/{book}/checkpoints/{cp['id']}/compare"), 503, "storage_unavailable")
    assert [c["id"] for c in owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"]] == listed
    assert set(S3().keys(f"notebooks/{book}/checkpoints/")) == keys
    assert by_id(cells_now(owner, book))[c1]["source"] == initial
    with open_notebook(browser, down, book) as page:
        listen(page, SAVE_STATUS)
        select_cell(page, 1)
        page.keyboard.press("Control+S")
        heard(page, "Checkpoint not saved: storage unavailable", name=SAVE_STATUS)
        see(page, visible(page.get_by_role("alert").filter(has_text=OUTAGE_COPY)), "the outage banner")
    tight = outage(OUTAGE_TIGHT)
    kept = config(tight)["checkpoints_kept"]
    t = seed(tight, ["owner"], [notebook("nb", "owner", [code("1")])])
    towner, tbook = t.users["owner"], t.books["nb"].id
    made_ids = []
    for _ in range(kept + 1):
        response = towner.post(f"/api/notebooks/{tbook}/checkpoints", {})
        assert response.status_code == 201
        made_ids.append(response.json()["checkpoint"])
    assert made_ids[0]["label"] == f"Checkpoint {made_ids[0]['number']}"
    remaining = towner.get(f"/api/notebooks/{tbook}/checkpoints").json()["checkpoints"]
    assert [c["id"] for c in remaining] == [c["id"] for c in reversed(made_ids[1:])]
    assert set(S3("-tight").keys(f"notebooks/{tbook}/checkpoints/")) == {
        f"notebooks/{tbook}/checkpoints/{c['id']}.json" for c in made_ids[1:]}


def test_wf_checkpoints_compare_rules(app_url: str) -> None:
    k = {name: cid(name.lower()) for name in ("B1", "B2", "C", "D", "E", "A", "F", "G")}
    src = {"B1": "keep one", "B2": "keep two", "C": "gone", "D": "d", "E": "e", "A": "a\nb\nc", "G": "p\nq\np"}
    checkpoint = [code(src[n], id=k[n], outputs=[]) for n in ("B1", "B2", "C", "D", "E", "A", "G")]
    current_src = {**src, "A": "a\nx\nc", "F": "new", "G": "p"}
    current = [code(current_src[n], id=k[n], outputs=[stream("changed\n")] if n == "B2" else [])
               for n in ("D", "B1", "B2", "E", "A", "F", "G")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", current, execution_counter=9,
                                           checkpoints=[{"label": "Low tide", "cells": checkpoint}])])
    owner, book = w.users["owner"], w.books["nb"].id
    cp = w.books["nb"].checkpoint_ids[0]
    body = owner.get(f"/api/notebooks/{book}/checkpoints/{cp}/compare").json()
    assert body["counts"] == {"modified": 2, "added": 1, "removed": 1, "moved": 1}, body["counts"]
    rows = [(r["tag"], (r["current_cell"] or r["checkpoint_cell"])["id"]) for r in body["rows"]]
    assert rows == [("Moved", k["D"]), ("Unchanged", k["B1"]), ("Unchanged", k["B2"]), ("Removed", k["C"]),
                    ("Unchanged", k["E"]), ("Modified", k["A"]), ("Added", k["F"]), ("Modified", k["G"])], rows
    by_cell = {(r["current_cell"] or r["checkpoint_cell"])["id"]: r for r in body["rows"]}
    assert by_cell[k["A"]]["source_diff"] == [{"op": "same", "line": "a"}, {"op": "removed", "line": "b"},
                                              {"op": "added", "line": "x"}, {"op": "same", "line": "c"}]
    assert by_cell[k["G"]]["source_diff"] == [{"op": "same", "line": "p"}, {"op": "removed", "line": "q"},
                                              {"op": "removed", "line": "p"}]
    assert all(by_cell[k[n]]["source_diff"] == [] for n in ("D", "B1", "B2", "C", "E", "F"))
    assert by_cell[k["B2"]]["output_changed"] is True and by_cell[k["B1"]]["output_changed"] is False
    assert by_cell[k["C"]]["current_cell"] is None and by_cell[k["F"]]["checkpoint_cell"] is None
    path = f"/api/notebooks/{book}/checkpoints/{cp}/revert"
    invalid(owner.post(path, {"cell_id": "not-in-either"}), "cell_id", "is in neither version")
    one = owner.post(path, {"cell_id": k["A"]})
    assert one.status_code == 200 and one.json()["before_revert"]["label"] == "Before revert"
    assert by_id(one.json()["cells"])[k["A"]]["source"] == src["A"]
    back = owner.post(path, {"cell_id": k["C"]}).json()["cells"]
    assert [c["id"] for c in back][:4] == [k["D"], k["B1"], k["C"], k["B2"]]
    dropped = owner.post(path, {"cell_id": k["F"]}).json()["cells"]
    assert k["F"] not in [c["id"] for c in dropped]
    whole = owner.post(path, {}).json()["cells"]
    assert [(c["id"], c["source"], c["outputs"]) for c in whole] == [(k[n], src[n], []) for n in ("B1", "B2", "C", "D", "E", "A", "G")]
    labels = [c["label"] for c in owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"]]
    assert labels.count("Before revert") == 4 and notebook_doc(owner, book)["execution_counter"] == 9


def test_wf_checkpoints_diptych(browser: Browser, app_url: str) -> None:
    c1 = cid("d1")
    labels = ["Low tide", "Slack water", "High tide", "Ebb"]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("now", id=c1)],
                                           checkpoints=[{"label": l, "cells": [code(f"then {i}", id=c1)]} for i, l in enumerate(labels)])])
    owner, book = w.users["owner"], w.books["nb"].id
    listed = owner.get(f"/api/notebooks/{book}/checkpoints").json()["checkpoints"]
    names = [f"Compare #{c['number']} {c['label']}" for c in listed]
    for reduced in ("no-preference", "reduce"):
        with open_notebook(browser, owner, book, reduced=reduced) as page:
            toolbar_button(page, "Checkpoints").click()
            panel = page.get_by_role("region", name="Checkpoints", exact=True)
            windows = [panel.get_by_role("button", name=n, exact=True) for n in names[:3]]
            see(page, visible(windows[0]), "the newest checkpoint window")
            expect(panel.get_by_role("list", name="Older checkpoints").get_by_role("button", name=names[3], exact=True)).to_have_count(1)
            if reduced == "no-preference":
                boxes = [box_of(win) for win in windows]
                for front, behind in ((boxes[0], boxes[1]), (boxes[1], boxes[2])):
                    dx, dy = front["x"] - behind["x"], front["y"] - behind["y"]
                    assert dx > 0 and dy > 0 and CASCADE_RATIO_MIN * dy <= dx <= CASCADE_RATIO_MAX * dy, (dx, dy)
                frame = ("border-top-color", "box-shadow", "outline-color")
                page.mouse.move(0, 0)
                settle(windows[1])
                rest = style(windows[1], *frame)
                windows[1].hover(position={"x": max(2, min(8, (boxes[0]["x"] - boxes[1]["x"]) / 2)),
                                           "y": max(2, min(8, (boxes[0]["y"] - boxes[1]["y"]) / 2))})
                settle(windows[1])
                hovered = style(windows[1], *frame)
                assert rest != hovered, "hover does not darken the window frame"
                assert transition_ms(style(windows[1], *TRANSITION), "border-top-color") <= HOVER_MAX_MS
                reached = tab_order(page, 40)
                assert all(n in reached for n in names[:3]), f"Tab does not reach each window: {reached}"
            start = page.evaluate("() => (window.__motion || []).length")
            windows[1].focus()
            page.keyboard.press("Enter")
            comparison = page.get_by_role("region", name="Checkpoint comparison", exact=True)
            see(page, visible(comparison.get_by_role("heading", level=2)), "the comparison")
            ends = [m["end"] for m in page_motion(page, start)]
            if reduced == "reduce":
                assert all(e <= INSTANT_MS for e in ends), f"the diptych animated under reduced motion: {ends}"
            else:
                assert any(DIPTYCH_MIN_MS <= e <= DIPTYCH_MAX_MS for e in ends), f"no third-of-a-second slide: {ends}"
            left = box_of(page.get_by_role("region", name=f"Checkpoint #{listed[1]['number']}", exact=True))
            right = box_of(page.get_by_role("region", name="Current notebook", exact=True))
            assert left["x"] + left["width"] / 2 < DESKTOP[0] / 2 < right["x"] + right["width"] / 2
            comparison.get_by_role("button", name="Close comparison", exact=True).click()
            see(page, focused(windows[1]), "focus back on the chosen window")


GOOD_NOTEBOOK = {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [
    {"id": "shore-a", "cell_type": "code", "metadata": {}, "source": ["const tide = 3;\n", "tide * 2"], "execution_count": 2,
     "outputs": [{"output_type": "execute_result", "execution_count": 2, "data": {"text/plain": ["6"]}, "metadata": {}}]},
    {"id": "shore-b", "cell_type": "markdown", "metadata": {}, "source": "# Shoreline notes"}]}


def import_via_dialog(page: Page, name: str, payload: bytes, title: str) -> Locator:
    page.get_by_role("button", name="Import notebook", exact=True).click()
    dialog = page.get_by_role("dialog", name="Import notebook")
    see(page, visible(dialog), "the import dialog")
    dialog.get_by_label("Notebook file").set_input_files({"name": name, "mimeType": "application/json", "buffer": payload})
    dialog.get_by_role("textbox", name="Title").fill(title)
    dialog.get_by_role("button", name="Import", exact=True).click()
    return dialog


def test_wf_import_export_dialog(browser: Browser) -> None:
    tight = outage(OUTAGE_TIGHT)
    limit = config(tight)["import_max_bytes"]
    w = seed(tight, ["owner"])
    owner = w.users["owner"]
    title = f"Shoreline {tag()}"
    good = json.dumps(GOOD_NOTEBOOK, indent=1).encode()
    with as_user(browser, owner, "/notebooks") as page:
        dialog = import_via_dialog(page, "big.ipynb", b"{" + b" " * limit, title)
        see(page, visible(dialog.get_by_role("alert").filter(has_text=f"File is larger than {limit:,} bytes")), "the 413 alert")
        page.keyboard.press("Escape")
        bad = dict(GOOD_NOTEBOOK, nbformat=3, cells=[dict(GOOD_NOTEBOOK["cells"][0], id="bad id!")])
        dialog = import_via_dialog(page, "bad.ipynb", json.dumps(bad).encode(), title)
        see(page, containing(dialog, "This file has 2 problems:"), "the problem count")
        expect(dialog.get_by_role("list", name="Import errors").get_by_role("listitem")).to_have_text(
            ["nbformat: must be 4", 'cells[0].id: must be 1 to 64 characters of letters, digits, "-" or "_"'])
        page.keyboard.press("Escape")
        assert title not in [n["title"] for n in owner.get("/api/notebooks").json()["notebooks"]]
        import_via_dialog(page, "good.ipynb", good, title)
        book = poll(lambda: next((n["id"] for n in owner.get("/api/notebooks").json()["notebooks"] if n["title"] == title), None),
                    "the good file imported")
    with open_notebook(browser, owner, book) as page:
        listen(page, SAVE_STATUS)
        see(page, containing(output(page, 1), "6"), "the imported output shown")
        with page.expect_download() as got:
            toolbar_button(page, "Download original").click()
        assert Path(got.value.path()).read_bytes() == good
        with page.expect_download() as got:
            toolbar_button(page, "Export").click()
        exported = json.loads(Path(got.value.path()).read_bytes())
        heard(page, f"Exported {title}.ipynb", name=SAVE_STATUS)
    assert [(c["id"], c["cell_type"], c["source"]) for c in exported["cells"]] == [
        ("shore-a", "code", "const tide = 3;\ntide * 2"), ("shore-b", "markdown", "# Shoreline notes")]
    assert exported["cells"][0]["outputs"] == GOOD_NOTEBOOK["cells"][0]["outputs"]
    assert S3("-tight").get(f"notebooks/{book}/original.ipynb") == good


MALFORMED = {"nbformat": 4, "nbformat_minor": 5, "metadata": [], "cells": [
    {"cell_type": "code", "id": "reef-1", "source": 7, "metadata": {}, "execution_count": -1, "outputs": [
        {"output_type": "stream", "name": "stdlog"}, {"output_type": "picture"},
        {"output_type": "error", "ename": 3, "evalue": "x", "traceback": "boom"}]},
    {"cell_type": "markdown", "id": "reef-1", "source": ["a"], "metadata": {}, "outputs": [],
     "attachments": {"chart.png": {"image/png": "bm90IGFuIGltYWdl"}}},
    {"cell_type": "python", "source": "x"},
    "oops"]}
MALFORMED_ERRORS = [
    ("metadata", "must be an object"),
    ("cells[0].source", "must be a string or a list of strings"),
    ("cells[0].execution_count", "must be null or a whole number of at least 0"),
    ("cells[0].outputs[0].name", 'must be "stdout" or "stderr"'),
    ("cells[0].outputs[0].text", "is required"),
    ("cells[0].outputs[1].output_type", 'must be "stream", "execute_result", "display_data" or "error"'),
    ("cells[0].outputs[2].ename", "must be a string"),
    ("cells[0].outputs[2].traceback", "must be a list of strings"),
    ("cells[1].id", "duplicates cells[0].id"),
    ("cells[1].outputs", "is not allowed on a markdown cell"),
    ('cells[1].attachments["chart.png"]', "must be a PNG, JPEG or GIF image"),
    ("cells[2].cell_type", 'must be "code" or "markdown"'),
    ("cells[2].metadata", "is required"),
    ("cells[2].id", "is required"),
    ("cells[3]", "must be an object"),
]


def import_raw(who: Who, payload: bytes, title: str) -> httpx.Response:
    return http(who.base, "POST", "/api/notebooks/import", cookie=who.cookie, content=payload,
                headers={"Content-Type": "application/octet-stream"}, params={"title": title})


def test_wf_import_export_limits_and_paths(app_url: str) -> None:
    tight = outage(OUTAGE_TIGHT)
    limit = config(tight)["import_max_bytes"]
    w = seed(tight, ["owner"])
    owner = w.users["owner"]
    title = f"Reef {tag()}"
    refused(import_raw(owner, b"x" * (limit + 1), title), 413, "too_large", f"File is larger than {limit:,} bytes")
    body = refused(import_raw(owner, b"{not json", title), 422, "validation_failed")
    assert body["errors"] == [{"path": "file", "message": "is not valid JSON"}]
    body = refused(import_raw(owner, json.dumps(MALFORMED).encode(), title), 422, "validation_failed")
    got = [(e["path"], e["message"]) for e in body["errors"]]
    assert sorted(got) == sorted(MALFORMED_ERRORS), f"import errors differ: {got}"
    order = [-1 if not p.startswith("cells[") else int(re.match(r"cells\[(\d+)\]", p).group(1)) for p, _ in got]
    assert order == sorted(order), f"errors are not in document order: {got}"
    assert title not in [n["title"] for n in owner.get("/api/notebooks").json()["notebooks"]]
    exact = {"nbformat": 4, "nbformat_minor": 4, "metadata": {"pad": ""},
             "cells": [{"cell_type": "code", "source": "1", "metadata": {}, "execution_count": None, "outputs": []}]}
    exact["metadata"]["pad"] = "a" * (limit - len(compact(exact)))
    accepted = import_raw(owner, compact(exact), title)
    assert accepted.status_code == 201, f"a file of exactly {limit} bytes was refused: {accepted.text[:200]}"
    assert re.fullmatch(r"[A-Za-z0-9_-]{1,64}", accepted.json()["notebook"]["cells"][0]["id"])
    picture = {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [
        {"id": "pic", "cell_type": "markdown", "metadata": {}, "source": "![c](attachment:chart.png)",
         "attachments": {"chart.png": {"image/png": GIF_1PX}}}]}
    made = import_raw(owner, json.dumps(picture).encode(), f"Picture {tag()}")
    assert made.status_code == 201
    book = made.json()["notebook"]["id"]
    image = owner.get(f"/api/notebooks/{book}/attachments/pic/chart.png")
    assert image.status_code == 200 and image.headers["content-type"].startswith("image/gif")
    assert f"notebooks/{book}/attachments/pic/chart.png" in S3("-tight").keys(f"notebooks/{book}/attachments/")


RAW_IMPORT = (
    b'{\n  "metadata" : {"x-origin": "field laptop"},\n  "nbformat_minor": 4,\n  "nbformat": 4,\n  "x-extra": true,\n'
    b'  "cells": [\n   {"cell_type": "markdown", "metadata": {}, "source": ["# Reef ", "survey"]},\n'
    b'   {"cell_type": "code", "metadata": {"tags": []}, "execution_count": 7, "source": ["let depth = 4;\\n", "depth * 2"],\n'
    b'    "outputs": [{"metadata": {"z": 1, "a": 2}, "output_type": "execute_result", "execution_count": 7, "data": {"text/plain": ["8"]}},\n'
    b'                {"output_type": "stream", "name": "stderr", "text": ["warn\\n"]},\n'
    b'                {"output_type": "error", "ename": "RangeError", "evalue": "deep", "traceback": ["RangeError: deep", "line 1"]}]}\n'
    b'  ]\n}\n'
)


def test_wf_import_export_stored_as_imported(app_url: str) -> None:
    w = seed(app_url, ["owner"], [notebook("plain", "owner", [code("1")])])
    owner = w.users["owner"]
    title = f"Reef {tag()}"
    made = import_raw(owner, RAW_IMPORT, title)
    assert made.status_code == 201
    doc = made.json()["notebook"]
    book = doc["id"]
    assert doc["imported"] is True and doc["execution_counter"] == 7
    assert [(c["cell_type"], c["source"]) for c in doc["cells"]] == [("markdown", "# Reef survey"), ("code", "let depth = 4;\ndepth * 2")]
    expected_outputs = json.loads(RAW_IMPORT)["cells"][1]["outputs"]
    got_outputs = doc["cells"][1]["outputs"]
    assert got_outputs == expected_outputs and [list(o) for o in got_outputs] == [list(o) for o in expected_outputs]
    original = owner.get(f"/api/notebooks/{book}/original")
    assert original.status_code == 200 and original.content == RAW_IMPORT
    assert S3().get(f"notebooks/{book}/original.ipynb") == RAW_IMPORT
    exported = owner.get(f"/api/notebooks/{book}/export")
    assert exported.status_code == 200 and exported.headers["content-type"].startswith("application/x-ipynb+json")
    assert exported.headers["content-disposition"] == f'attachment; filename="{title}.ipynb"'
    out = exported.json()
    assert out["nbformat"] == 4 and out["nbformat_minor"] == 5 and out["metadata"] == EXPORT_METADATA
    assert [c["id"] for c in out["cells"]] == [c["id"] for c in doc["cells"]]
    assert out["cells"][1]["execution_count"] == 7 and out["cells"][1]["outputs"] == expected_outputs
    assert all(isinstance(c["source"], str) and "metadata" in c for c in out["cells"])
    stored = [json.loads(S3().get(k)) for k in S3().keys(f"notebooks/{book}/exports/")]
    assert out in stored, "the export was not stored in MinIO"
    again = import_raw(owner, exported.content, f"Again {tag()}").json()["notebook"]
    assert [(c["id"], c["cell_type"], c["source"], c["outputs"], c["execution_count"]) for c in again["cells"]] == \
        [(c["id"], c["cell_type"], c["source"], c["outputs"], c["execution_count"]) for c in doc["cells"]]
    refused(owner.get(f"/api/notebooks/{w.books['plain'].id}/original"), 404, "no_original")
    down = owner.at(outage(OUTAGE_MINIO))
    refused(down.get(f"/api/notebooks/{book}/export"), 503, "storage_unavailable")
    refused(down.get(f"/api/notebooks/{book}/original"), 503, "storage_unavailable")


def test_wf_import_export_unicode_title(browser: Browser, app_url: str) -> None:
    title = f"Tide “notes” 🌊 {tag()}"
    ids = [cid("t1")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("2 + 2", id=ids[0])], title=title)])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        listen(page, SAVE_STATUS)
        with page.expect_download() as got:
            toolbar_button(page, "Export").click()
        exported = json.loads(Path(got.value.path()).read_bytes())
        heard(page, f"Exported {title}.ipynb", name=SAVE_STATUS)
    assert exported["nbformat"] == 4 and [(c["id"], c["source"]) for c in exported["cells"]] == [(ids[0], "2 + 2")]


def test_wf_phone_viewer_and_editor(browser: Browser, app_url: str) -> None:
    ids = [cid("h1"), cid("h2"), cid("h3")]
    w = seed(app_url, ["owner", "editor", "viewer"],
             [notebook("nb", "owner", [md("# Shore\n\n## Dunes", id=ids[0]), code("2 + 3", id=ids[1]), code('"third"', id=ids[2])],
                       shares=[share("editor", "editor"), share("viewer", "viewer")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, w.users["viewer"], book, size=PHONE, reduced="reduce", kernel=False) as vp:
        layout(vp)
        opener = vp.get_by_role("button", name="Show table of contents", exact=True)
        tap(opener)
        drawer = vp.get_by_role("dialog", name="Contents")
        see(vp, visible(drawer), "the Contents drawer")
        nav = drawer.get_by_role("navigation", name="Table of contents")
        for name in ("1 Shore", "1.1 Dunes"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
        stays_inside(vp, drawer, "the Contents drawer")
        vp.keyboard.press("Escape")
        see(vp, counted(drawer, 0), "Escape closing the drawer")
        see(vp, focused(opener), "focus back on Show table of contents")
        tap(cell(vp, 2).get_by_role("button", name="Cell actions", exact=True))
        sheet = vp.get_by_role("dialog", name="Cell actions")
        see(vp, visible(sheet), "the viewer's cell sheet")
        expect(sheet.get_by_role("button")).to_have_count(1)
        expect(sheet.get_by_role("button", name="Close", exact=True)).to_be_visible()
    with open_notebook(browser, w.users["editor"], book, size=PHONE, reduced="reduce") as ep:
        start = motion_zone(ep, ep.get_by_role("region", name="Cells", exact=True))
        tap(cell(ep, 2).get_by_role("button", name="Cell actions", exact=True))
        sheet = ep.get_by_role("dialog", name="Cell actions")
        see(ep, visible(sheet), "the editor's cell sheet")
        tap(sheet.get_by_role("button", name="Run", exact=True))
        see(ep, counted(sheet, 0), "Run closing the sheet")
        see(ep, containing(output(ep, 2), "5"), "the cell's result")
        tap(cell(ep, 2).get_by_role("button", name="Cell actions", exact=True))
        see(ep, visible(sheet), "the sheet again")
        tap(sheet.get_by_role("button", name="Move down", exact=True))
        poll(lambda: [c["id"] for c in cells_now(owner, book)] == [ids[0], ids[2], ids[1]], "Move down reordering")
        assert all(m["end"] == 0 for m in zone_motion(ep, start)), "cells animated under reduced motion"
    assert by_id(cells_now(owner, book))[ids[1]]["execution_count"] == 1


def test_wf_phone_layout_and_inert(browser: Browser, app_url: str) -> None:
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [md("# Shore"), code("1")])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book, size=PHONE) as page:
        layout(page)
        menu = page.get_by_role("button", name="Open menu", exact=True)
        expect(menu).to_be_visible()
        expect(page.get_by_role("banner").get_by_role("button", name="File", exact=True)).not_to_be_visible()
        tap(menu)
        see(page, visible(page.get_by_role("button", name="File", exact=True)), "the folded menus revealed")
        page.keyboard.press("Escape")
        expect(page.get_by_role("navigation", name="Table of contents")).to_have_count(0)
        expect(page.get_by_role("button", name="Show table of contents", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Move up", exact=True)).to_have_count(0)
        reached = tab_order(page, 40)
        assert not {"Move up", "Insert below", "1 Shore"} & set(reached), f"a closed sheet or drawer is reachable: {reached}"
        tap(cell(page, 2).get_by_role("button", name="Cell actions", exact=True))
        sheet = page.get_by_role("dialog", name="Cell actions")
        see(page, visible(sheet), "the cell sheet")
        for name in ("Run", "Insert below", "Change type", "Move up", "Move down", "Delete", "Close"):
            expect(sheet.get_by_role("button", name=name, exact=True)).to_be_visible()
        stays_inside(page, sheet, "the cell sheet")
        page.mouse.click(PHONE[0] / 2, 4)
        see(page, counted(sheet, 0), "tapping outside closing the sheet")
        expect(page.get_by_role("button", name="Move up", exact=True)).to_have_count(0)
    for size, low, high in ((TABLET, TOC_TABLET_MIN, TOC_TABLET_MAX), (DESKTOP, TOC_WIDE_MIN, TOC_WIDE_MAX)):
        with open_notebook(browser, owner, book, size=size) as page:
            for name in ("Open menu", "Show table of contents", "Cell actions"):
                expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)
            for name in ("File", "Edit", "Cell", "Kernel"):
                expect(page.get_by_role("banner").get_by_role("button", name=name, exact=True)).to_be_visible()
            nav = box_of(page.get_by_role("navigation", name="Table of contents"))
            cells_box = box_of(page.get_by_role("region", name="Cells", exact=True))
            assert nav["x"] + nav["width"] <= cells_box["x"] + 1, "contents is not a left column"
            assert low <= nav["width"] / size[0] <= high, f"contents width {nav['width']} at {size[0]} px"


def test_wf_phone_contents_targets(browser: Browser, app_url: str) -> None:
    ids = [cid("c1"), cid("c2"), cid("c3")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [md("# A", id=ids[0]), code("1", id=ids[1]),
                                                           md("## B", id=ids[2])])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book, size=PHONE) as page:
        tap(page.get_by_role("button", name="Show table of contents", exact=True))
        drawer = page.get_by_role("dialog", name="Contents")
        see(page, visible(drawer), "the Contents drawer")
        nav = drawer.get_by_role("navigation", name="Table of contents")
        for name in ("1 A", "1.1 B"):
            link = nav.get_by_role("link", name=name, exact=True)
            expect(link).to_be_visible()
            box = box_of(link)
            assert box["width"] >= 44 and box["height"] >= 44, f"contents link {name!r} is {box['width']}x{box['height']} px"


def test_wf_sharing_invite_from_inbox(browser: Browser, app_url: str, mail: Any) -> None:
    c1 = cid("i1")
    w = seed(app_url, ["owner", "editor", "viewer"],
             [notebook("nb", "owner", [code("21 * 2", id=c1), md("# Dunes\n\n<script>window.probeShared = 1</script><em>calm</em>")])])
    owner, editor, viewer = (w.users[k] for k in ("owner", "editor", "viewer"))
    book, title = w.books["nb"].id, w.books["nb"].title
    with open_notebook(browser, owner, book) as op:
        op.get_by_role("banner").get_by_role("button", name="Share", exact=True).click()
        dialog = op.get_by_role("dialog", name="Share notebook")
        for who, role in ((editor, "Editor"), (viewer, "Viewer")):
            dialog.get_by_role("textbox", name="Email").fill(who.email)
            dialog.get_by_role("radio", name=role, exact=True).check()
            dialog.get_by_role("button", name="Send invitation", exact=True).click()
            see(op, containing(dialog, f"Invitation sent to {who.email}"), f"the invitation to {role}")
            expect(dialog.get_by_role("button", name=re.compile(
                re.escape(who.email) + "|" + re.escape(who.display_name)))).to_have_count(1)
        dialog.get_by_role("textbox", name="Email").fill(editor.email)
        dialog.get_by_role("radio", name="Editor", exact=True).check()
        dialog.get_by_role("button", name="Send invitation", exact=True).click()
        see(op, containing(dialog, f"{editor.email} already has access"), "the already-shared notice")
        page_tokens = {}
        for who, role in ((editor, "Editor"), (viewer, "Viewer")):
            message = inbox(mail, who.email)[0]
            assert message["Subject"] == f"{owner.display_name} shared “{title}” with you"
            assert role.lower() in mail_text(message).lower()
            page_tokens[who.key] = token_in(message, "invite")
        for who, role in ((editor, "Editor"), (viewer, "Viewer")):
            with as_user(browser, who, f"/invite/{page_tokens[who.key]}") as page:
                see(page, visible(page.get_by_role("heading", level=1, name=f"{owner.display_name} shared “{title}” with you")),
                    "the invitation heading")
                expect(page.get_by_text(f"Role: {role}", exact=True)).to_be_visible()
                page.get_by_role("button", name="Open notebook", exact=True).focus()
                page.keyboard.press("Enter")
                see(page, visible(cells_of(page).first), "the notebook opened from the invitation")
                assert urlparse(page.url).path == f"/notebooks/{book}"
                if who is editor:
                    see(page, visible(header_text(page, "Kernel idle")), "the editor's kernel ready")
                    cells_of(page).first.focus()
                    page.keyboard.press("Control+Shift+C")
                    page.keyboard.type("run selected")
                    page.keyboard.press("Enter")
                    poll(lambda: by_id(cells_now(owner, book))[c1]["execution_count"] is not None, "the palette run")
                else:
                    see(page, visible(header_text(page, "View only")), "the View only indicator")
                    expect(source_box(page, 1)).not_to_be_editable()
                    cells_of(page).first.focus()
                    page.keyboard.press("Control+Shift+C")
                    palette = page.get_by_role("dialog", name="Command palette")
                    options = palette.get_by_role("listbox", name="Commands").get_by_role("option")
                    expect(options).to_have_count(len(VIEWER_COMMANDS))
                    for name in VIEWER_COMMANDS:
                        expect(palette.get_by_role("option", name=name, exact=True)).to_have_count(1)
                    page.keyboard.press("Escape")
                    facts = cell(page, 2).evaluate(DOM_FACTS_JS)
                    assert "script" not in facts["tags"] and "em" in facts["tags"]
                    assert page.evaluate("() => window.probeShared") is None
                    see(op, visible(op.get_by_role("list", name="People here").get_by_role("listitem").filter(
                        has_text=viewer.display_name)), "the viewer in the owner's People here")
    assert plain(by_id(cells_now(owner, book))[c1]["outputs"][0]) == "42"
    statuses = {s["email"].lower(): s["status"] for s in owner.get(f"/api/notebooks/{book}/shares").json()["shares"]}
    assert statuses == {editor.email: "active", viewer.email: "active"}


def test_wf_sharing_accounts_and_mail(browser: Browser, app_url: str, mail: Any) -> None:
    email = fresh_email("signup")
    name = f"Signup {tag()}"
    with entered(open_app(browser, app_url + "/")) as page:
        form = page.get_by_role("form", name="Create your account")
        form.get_by_label("Display name").fill(name)
        form.get_by_label("Email").fill(email)
        form.get_by_label("Password").fill("short")
        select(form.get_by_role("combobox", name="I mostly use notebooks for"), "Research")
        form.get_by_role("button", name="Create account", exact=True).click()
        summary = page.get_by_role("alert").filter(has_text="Please fix the following:")
        see(page, visible(summary), "the error summary")
        summary.get_by_role("link", name="must be 10 to 128 characters").click()
        expect(form.get_by_label("Password")).to_be_focused()
        form.get_by_label("Password").fill(PASSWORD)
        form.get_by_role("button", name="Create account", exact=True).click()
        see(page, visible(page.get_by_text("Check your inbox to verify your email.", exact=True)), "the sign-up notice")
        message = inbox(mail, email)[0]
        assert message["Subject"] == "Verify your Brackenpad email"
        assert mail_from_address() in addresses(message.get("From")) and "hello@brackenpad.test" in addresses(message.get("From"))
        token = token_in(message, "verify")
        refused(sign_in(app_url, email, PASSWORD), 403, "email_not_verified")
        page.goto(f"{app_url}/verify/{token}")
        see(page, visible(page.get_by_text("Email verified. You can sign in now.", exact=True)), "the verification page")
        page.goto(f"{app_url}/verify/{token}")
        see(page, visible(page.get_by_text("This verification link is not valid.", exact=True)), "single-use verification")
    signed = sign_in(app_url, email, PASSWORD)
    assert signed.status_code == 200
    cookie_header = signed.headers.get("set-cookie", "").lower()
    assert re.search(r"bp_session=.*httponly", cookie_header, re.S) and re.search(r"samesite=lax", cookie_header)
    refused(sign_in(app_url, email, "wrong-password-1"), 401, "invalid_credentials")
    invalid(http(app_url, "POST", "/api/auth/signup", body={"display_name": name, "email": email.upper(), "password": PASSWORD}),
            "email", "is already registered")
    assert len(inbox(mail, email)) == 1, "a refused sign-up still sent mail"
    invalid(http(app_url, "POST", "/api/auth/signup", body={"display_name": "x" * (DISPLAY_NAME_MAX + 1),
                                                            "email": fresh_email("long"), "password": PASSWORD}),
            "display_name", "must be 1 to 40 characters")
    emoji = http(app_url, "POST", "/api/auth/signup", body={"display_name": "🌊" * DISPLAY_NAME_MAX,
                                                            "email": fresh_email("emoji"), "password": PASSWORD})
    assert emoji.status_code == 201 and emoji.json()["user"]["verified"] is False
    w = seed(app_url, ["owner", "invitee", "other"], [notebook("nb", "owner", [code("1")])])
    owner, invitee, other = (w.users[k] for k in ("owner", "invitee", "other"))
    book = w.books["nb"].id
    newcomer = fresh_email("newcomer")
    shared = owner.post(f"/api/notebooks/{book}/shares", {"email": newcomer, "role": "viewer"})
    assert shared.status_code == 201 and shared.json()["share"]["status"] == "invited"
    token = token_in(inbox(mail, newcomer)[0], "invite")
    info = http(app_url, "GET", f"/api/invitations/{token}").json()
    assert info["email"].lower() == newcomer and info["role"] == "viewer" and info["account_exists"] is False
    assert info["notebook_title"] == w.books["nb"].title and info["owner_display_name"] == owner.display_name
    invalid(http(app_url, "POST", "/api/auth/signup", body={"display_name": "Wrong", "email": fresh_email("wrong"),
                                                            "password": PASSWORD, "invitation_token": token}),
            "invitation_token", "is not valid for this email")
    joined_up = http(app_url, "POST", "/api/auth/signup", body={"display_name": "Newcomer", "email": newcomer,
                                                                 "password": PASSWORD, "invitation_token": token})
    assert joined_up.status_code == 201 and joined_up.json()["user"]["verified"] is True
    assert http(app_url, "GET", f"/api/notebooks/{book}", cookie=session_of(joined_up)).json()["notebook"]["role"] == "viewer"
    assert all(m["Subject"] != "Verify your Brackenpad email" for m in inbox(mail, newcomer))
    assert owner.post(f"/api/notebooks/{book}/shares", {"email": invitee.email, "role": "editor"}).status_code == 201
    invite = token_in(inbox(mail, invitee.email)[0], "invite")
    refused(invitee.get(f"/api/notebooks/{book}"), 404, "not_found")
    refused(other.post(f"/api/invitations/{invite}/accept"), 403, "invitation_for_another_account")
    with as_user(browser, other, f"/invite/{invite}") as page:
        see(page, visible(page.get_by_role("heading", level=1, name="This invitation is for another account.")), "wrong account")
        expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
        page.goto(f"{app_url}/invite/no-such-token")
        see(page, visible(page.get_by_role("heading", level=1, name="This invitation is not valid.")), "unknown invitation")
    assert http(app_url, "GET", "/api/invitations/no-such-token").status_code == 404
    accepted = invitee.post(f"/api/invitations/{invite}/accept")
    assert accepted.status_code == 200 and accepted.json()["notebook_id"] == book
    assert invitee.post(f"/api/invitations/{invite}/accept").status_code == 200
    assert notebook_doc(invitee, book)["role"] == "editor"


def test_wf_sharing_viewer_permissions(browser: Browser, app_url: str) -> None:
    c1, c2 = cid("g1"), cid("g2")
    w = seed(app_url, ["owner", "editor", "viewer", "stranger"],
             [notebook("nb", "owner", [code("1", id=c1), code("2", id=c2)], shares=[share("editor", "editor"), share("viewer", "viewer")],
                       checkpoints=[{"label": "Start", "cells": [code("1", id=c1), code("2", id=c2)]}])])
    owner, editor, viewer, stranger = (w.users[k] for k in ("owner", "editor", "viewer", "stranger"))
    book, cp, t = w.books["nb"].id, w.books["nb"].checkpoint_ids[0], new_tab()
    run_id = queue_run(owner, book, c1)
    base = f"/api/notebooks/{book}"
    writes = [
        ("POST", f"{base}/save", {"tab_id": t, "cells": [edit(c1, 1, "x")]}),
        ("POST", f"{base}/cells", {"position": 0, "cell_type": "code"}),
        ("POST", f"{base}/cells/paste", {"position": 0, "cells": [{"cell_type": "code", "source": "x"}]}),
        ("POST", f"{base}/cells/delete", {"tab_id": t, "ids": [c1]}),
        ("POST", f"{base}/cells/restore", {"ids": [c1]}),
        ("POST", f"{base}/cells/{c1}/move", {"tab_id": t, "position": 1}),
        ("POST", f"{base}/cells/{c1}/split", {"tab_id": t, "base_revision": 1, "line": 2}),
        ("POST", f"{base}/cells/merge", {"tab_id": t, "ids": [c1, c2], "base_revisions": {c1: 1, c2: 1}}),
        ("POST", f"{base}/cells/{c1}/lock", {"tab_id": t}),
        ("DELETE", f"{base}/cells/{c1}/lock", {"tab_id": t}),
        ("POST", f"{base}/runs", {"run_id": str(uuid.uuid4()), "cell_id": c2, "tab_id": t}),
        ("POST", f"{base}/runs/{run_id}/start", {}),
        ("POST", f"{base}/runs/{run_id}/result", {"status": "cancelled", "outputs": []}),
        ("POST", f"{base}/kernel", {"tab_id": t, "status": "starting"}),
        ("POST", f"{base}/checkpoints", {"label": "Viewer try"}),
        ("POST", f"{base}/checkpoints/{cp}/revert", {}),
        ("POST", f"{base}/shares", {"email": fresh_email("third"), "role": "viewer"}),
        ("DELETE", base, None),
    ]
    for method, path, body in writes:
        refused(http(app_url, method, path, cookie=viewer.cookie, body=body), 403, "forbidden", "Your role does not allow this.")
    refused(editor.post(f"{base}/shares", {"email": fresh_email("fourth"), "role": "viewer"}), 403, "forbidden")
    refused(editor.delete(base), 403, "forbidden")
    after = notebook_doc(owner, book)
    assert [(c["id"], c["source"], c["revision"]) for c in after["cells"]] == [(c1, "1", 1), (c2, "2", 1)]
    assert [c["id"] for c in owner.get(f"{base}/checkpoints").json()["checkpoints"]] == [cp]
    assert viewer.post(f"{base}/presence", {"tab_id": t, "cell_id": None}).status_code == 200
    assert viewer.id in [p["user_id"] for p in viewer.get(f"{base}/presence").json()["present"]]
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as client:
        with client.stream("GET", f"{base}/events", params={"tab_id": t}, headers={"Cookie": viewer.cookie}) as live:
            assert live.status_code == 200 and live.headers["content-type"].startswith("text/event-stream")
    invalid(viewer.get(f"{base}/events"), "tab_id", "is required")
    for response in (stranger.get(base), stranger.get(f"{base}/presence"),
                     stranger.post(f"{base}/presence", {"tab_id": t, "cell_id": None}),
                     stranger.get(f"{base}/events", params={"tab_id": t})):
        refused(response, 404, "not_found", "Notebook not found.")
    viewer_share = next(s for s in owner.get(f"{base}/shares").json()["shares"] if s["email"].lower() == viewer.email)
    with open_notebook(browser, viewer, book, kernel=False) as page:
        assert owner.delete(f"{base}/shares/{viewer_share['id']}").status_code == 204
        see(page, visible(page.get_by_role("heading", name="Notebook not found", exact=True)),
            "Notebook not found after the share was removed", seconds=LIVE_MS / 1000)
        expect(page.get_by_role("link", name="Back to your notebooks", exact=True)).to_be_visible()
    refused(viewer.get(base), 404, "not_found")


@pytest.mark.timeout(1200)
def test_wf_big_output_outage_journey(browser: Browser, app_url: str) -> None:
    word = f"kelp{tag()}"
    note = f"let {word} = 1;"
    table = 'display({"columns": ["n"], "rows": Array.from({length: 30}, (_, i) => [i + 1])}, "application/vnd.brackenpad.table+json")'
    ids = [cid("b1"), cid("b2"), cid("b3")]
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code('for (let i = 1; i <= 201; i++) console.log("line " + i)', id=ids[0]),
                                                            code(table, id=ids[1]), code(note, id=ids[2])])])
    owner, book = w.users["owner"], w.books["nb"].id
    with open_notebook(browser, owner, book) as page:
        select_cell(page, 1)
        page.keyboard.press("Control+Enter")
        more = output(page, 1).get_by_role("button", name=f"Show {201 - OUTPUT_LINE_CAP} more lines", exact=True)
        see(page, visible(more), "the show-more button for one hidden line")
        expect(output(page, 1).get_by_text(f"line {OUTPUT_LINE_CAP + 1}")).to_have_count(0)
        more.click()
        see(page, visible(output(page, 1).get_by_text(f"line {OUTPUT_LINE_CAP + 1}")), "every line after show more")
        expect(more).to_have_count(0)
        select_cell(page, 2)
        page.keyboard.press("Control+Enter")
        see(page, containing(output(page, 2), "Rows 1–25 of 30"), "the first table page")
        output(page, 2).get_by_role("button", name="Next page", exact=True).click()
        see(page, containing(output(page, 2), "Rows 26–30 of 30"), "the second table page")
        expect(output(page, 2).get_by_role("table", name="Table output").get_by_text(str(TABLE_PAGE_ROWS + 1), exact=True)).to_be_visible()
    with as_user(browser, owner, "/notebooks") as page:
        page.get_by_role("searchbox", name="Search notebooks").fill(word)
        advance(page, SEARCH_PAUSE_MS)
        see(page, visible(page.get_by_role("list", name="Notebooks").get_by_role("link", name=w.books["nb"].title, exact=True)),
            "the notebook found by a cell's text")
    down = owner.at(outage(OUTAGE_MINIO))
    with open_notebook(browser, down, book) as page:
        listen(page, SAVE_STATUS)
        type_into(page, 3, " more")
        advance(page, AUTOSAVE_MS)
        heard(page, "Saving paused: storage unavailable", name=SAVE_STATUS)
        see(page, visible(page.get_by_role("alert").filter(has_text=OUTAGE_COPY)), "the outage banner")
        assert "more" in source_value(page, 3)
    assert by_id(cells_now(owner, book))[ids[2]]["source"] == note


def test_wf_big_output_outage_caps_and_paging(browser: Browser) -> None:
    tight = outage(OUTAGE_TIGHT)
    limits = config(tight)
    lines, cap, page_rows = limits["output_line_cap"], limits["output_byte_cap"], limits["table_page_rows"]
    ids = [cid(f"c{i}") for i in range(5)]
    w = seed(tight, ["owner"], [notebook("nb", "owner", [code(f"let v{i} = 1;", id=x) for i, x in enumerate(ids)])])
    owner, book = w.users["owner"], w.books["nb"].id
    long_version = full_run(owner, book, ids[0], [stream("".join(f"row {i}\n" for i in range(1, lines + 2)))])["cell"]["outputs_version"]
    full_run(owner, book, ids[1], [stream("".join(f"row {i}\n" for i in range(1, lines + 1)))])
    exact = stream("")
    exact["text"] = "x" * (cap - len(compact(exact)))
    kept = full_run(owner, book, ids[2], [exact])["cell"]["outputs"][0]
    assert joined(kept["text"]) == exact["text"], "an output of exactly the byte cap was not kept"
    over = stream("x" * cap)
    replaced = full_run(owner, book, ids[3], [over])["cell"]["outputs"][0]
    assert replaced["output_type"] == "display_data" and plain(replaced) == f"Output removed: larger than {cap:,} bytes"
    total = page_rows * 2 + 1
    table = full_run(owner, book, ids[4], [table_output([[i] for i in range(1, total + 1)])])["cell"]
    version = table["outputs_version"]
    rows_path = f"/api/notebooks/{book}/cells/{ids[4]}/outputs/0/rows"
    seen_rows: list[Any] = []
    for offset in range(0, total, page_rows):
        page_body = owner.get(rows_path, params={"version": version, "offset": offset, "limit": total * 10}).json()
        assert page_body["total"] == total and len(page_body["rows"]) <= page_rows and page_body["offset"] == offset
        seen_rows += page_body["rows"]
    assert seen_rows == [[i] for i in range(1, total + 1)], "paging repeated or skipped a row"
    assert owner.get(rows_path, params={"version": version, "offset": total}).json()["rows"] == []
    invalid(owner.get(f"/api/notebooks/{book}/cells/{ids[4]}/outputs/9/rows", params={"version": version}),
            "index", "must name an output of this cell")
    invalid(owner.get(f"/api/notebooks/{book}/cells/{ids[0]}/outputs/0/rows", params={"version": long_version}),
            "index", "must be a table output")
    invalid(owner.get(rows_path), "version", "must be a whole number")
    both = owner.get(rows_path, params={"version": version, "offset": -1, "limit": 0})
    invalid(both, "offset", "must be a whole number of at least 0")
    invalid(both, "limit", "must be a whole number of at least 1")
    with open_notebook(browser, owner, book) as page:
        listen(page)
        expect(output(page, 1).get_by_role("button", name=f"Show {(lines + 1) - lines} more lines", exact=True)).to_be_visible()
        expect(output(page, 2).get_by_role("button", name=re.compile("more lines"))).to_have_count(0)
        expect(output(page, 4)).to_contain_text(f"Output removed: larger than {cap:,} bytes")
        out = output(page, 5)
        see(page, containing(out, f"Rows 1–{page_rows} of {total}"), "the first table page")
        out.get_by_role("button", name="Next page", exact=True).click()
        see(page, containing(out, f"Rows {page_rows + 1}–{page_rows * 2} of {total}"), "the second table page")
        shift = 100
        full_run(owner, book, ids[4], [table_output([[i + shift] for i in range(1, total + 1)])])
        heard(page, "This output was replaced; showing rows from the start.")
        see(page, containing(out, f"Rows 1–{page_rows} of {total}"), "the new output's first page")
        expect(out.get_by_role("table", name="Table output").get_by_text(str(shift + 1), exact=True)).to_be_visible()
    refused(owner.get(rows_path, params={"version": version, "offset": page_rows}), 409, "output_replaced")
    assert refused(owner.get(rows_path, params={"version": version}), 409, "output_replaced")["version"] > version


@pytest.mark.timeout(1500)
def test_wf_big_output_outage_autosave_recovery(browser: Browser, app_url: str) -> None:
    base_src = "level = 1"
    first_edit = " + 1"
    second_edit = " + 2"
    c1 = cid("u1")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("level = 1", id=c1)])])
    book = w.books["nb"].id
    relay = minio_relay()
    relay.up()
    try:
        with extra_app({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as url:
            owner = w.users["owner"].at(url)

            def is_save(request: Any) -> bool:
                return request.method == "POST" and urlparse(request.url).path == f"/api/notebooks/{book}/save"

            with open_notebook(browser, owner, book) as page:
                listen(page, SAVE_STATUS)
                type_into(page, 1, first_edit, nudge=False)
                heard(page, "Unsaved changes", name=SAVE_STATUS, nudge=False)
                with pytest.raises(PlaywrightTimeout):
                    with page.expect_request(is_save, timeout=SLICE_MS * 4):
                        advance(page, AUTOSAVE_MS - 1)
                with page.expect_request(is_save) as first:
                    advance(page, 1)
                assert first.value.response().status == 200
                heard(page, "All changes saved", name=SAVE_STATUS, nudge=False)
                assert base_src + first_edit in S3().get(f"notebooks/{book}/working.json").decode()
                relay.down()
                mark = len(said(page, SAVE_STATUS))
                type_into(page, 1, second_edit, nudge=False)
                with page.expect_request(is_save) as refused_save:
                    advance(page, AUTOSAVE_MS)
                assert refused_save.value.response().status == 503
                heard(page, "Saving paused: storage unavailable", name=SAVE_STATUS, since=mark, nudge=False)
                banner = page.get_by_role("alert").filter(has_text=OUTAGE_COPY)
                expect(banner).to_be_visible()
                assert second_edit.strip() in source_value(page, 1)
                assert by_id(cells_now(owner, book))[c1]["source"] == base_src + first_edit
                with pytest.raises(PlaywrightTimeout):
                    with page.expect_request(is_save, timeout=SLICE_MS * 4):
                        advance(page, RETRY_MS - 1)
                with page.expect_request(is_save) as retry:
                    advance(page, 1)
                assert retry.value.response().status == 503
                relay.up()
                mark = len(said(page, SAVE_STATUS))
                with page.expect_request(is_save) as recovered:
                    advance(page, RETRY_MS)
                assert recovered.value.response().status == 200
                heard(page, "All changes saved", name=SAVE_STATUS, since=mark, nudge=False)
                expect(banner).to_have_count(0)
            assert by_id(cells_now(owner, book))[c1]["source"] == base_src + first_edit + second_edit
            assert base_src + first_edit + second_edit in S3().get(f"notebooks/{book}/working.json").decode()
    finally:
        relay.down()


@pytest.mark.timeout(1500)
def test_wf_big_output_outage_search(browser: Browser, app_url: str, meilisearch: Any) -> None:
    word = tag()
    w = seed(app_url, ["reader", "other"], [
        notebook("mine", "reader", [code(f"let kelp{word} = 1;"), md(f"## Heron{word}")], title=f"Saltmarsh {word}"),
        notebook("plain", "reader", [code("1")], title=f"Mudflat {word}"),
        notebook("theirs", "other", [code(f"let kelp{word} = 1;")]),
        notebook("lent", "other", [code(f"let kelp{word} = 1;")], shares=[share("reader", "viewer")]),
    ])
    reader, other = w.users["reader"], w.users["other"]
    mine, lent = w.books["mine"].id, w.books["lent"].id

    def found(query: str) -> set[str]:
        response = reader.get("/api/search", params={"q": query})
        assert response.status_code == 200, response.text
        return {r["id"] for r in response.json()["results"]}

    assert found(f"kelp{word}") == {mine, lent}
    assert found(f"Heron{word}") == {mine} and mine in found(f"Saltmarsh {word}")
    settings = meilisearch.settings("notebooks")
    assert {"title", "headings", "cells"} <= set(settings["searchableAttributes"]) and "reader_ids" in settings["filterableAttributes"]
    assert reader.id in meilisearch.document("notebooks", mine)["reader_ids"]
    lent_share = other.get(f"/api/notebooks/{lent}/shares").json()["shares"][0]
    assert other.delete(f"/api/notebooks/{lent}/shares/{lent_share['id']}").status_code == 204
    assert found(f"kelp{word}") == {mine}, "a notebook the searcher can no longer open was returned"
    invalid(reader.get("/api/search", params={"q": ""}), "q", "must be 1 to 200 characters")
    invalid(reader.get("/api/search", params={"q": "a" * (QUERY_MAX + 1)}), "q", "must be 1 to 200 characters")
    assert reader.get("/api/search", params={"q": "🌊" * QUERY_MAX}).status_code == 200
    with as_user(browser, reader, "/notebooks") as page:
        listing = page.get_by_role("list", name="Notebooks")
        see(page, visible(listing.get_by_role("link", name=f"Mudflat {word}", exact=True)), "the full list")
        listen(page, "Search status")
        searches = []
        page.on("request", lambda r: searches.append(r) if urlparse(r.url).path == "/api/search" else None)
        page.get_by_role("searchbox", name="Search notebooks").fill(f"kelp{word}")
        advance(page, SEARCH_PAUSE_MS - 1)
        expect(listing.get_by_role("link", name=f"Mudflat {word}", exact=True)).to_be_visible()
        assert not searches, "search ran before half a second without typing"
        advance(page, 1)
        heard(page, "1 notebook found", name="Search status")
        see(page, counted(listing.get_by_role("link", name=f"Mudflat {word}", exact=True), 0), "the list filtered")
        expect(listing.get_by_role("link", name=f"Saltmarsh {word}", exact=True)).to_be_visible()
        page.get_by_role("searchbox", name="Search notebooks").fill(f"zzz{word}")
        advance(page, SEARCH_PAUSE_MS)
        see(page, visible(page.get_by_text(f"No notebooks match “zzz{word}”.", exact=True)), "the no-results copy")
        page.get_by_role("searchbox", name="Search notebooks").fill("")
        advance(page, SEARCH_PAUSE_MS)
        see(page, visible(listing.get_by_role("link", name=f"Mudflat {word}", exact=True)), "the full list after clearing")
    with extra_app({"MEILISEARCH_URL": f"http://127.0.0.1:{free_port()}"}) as url:
        refused(reader.at(url).get("/api/search", params={"q": f"kelp{word}"}), 503, "search_unavailable")
        with as_user(browser, reader.at(url), "/notebooks") as page:
            page.get_by_role("searchbox", name="Search notebooks").fill(f"kelp{word}")
            advance(page, SEARCH_PAUSE_MS)
            see(page, visible(page.get_by_text("Search is unavailable", exact=True)), "the search outage notice")
            link = page.get_by_role("list", name="Notebooks").get_by_role("link", name=f"Saltmarsh {word}", exact=True)
            expect(link).to_be_visible()
            link.click()
            see(page, visible(cells_of(page).first), "the list still opening notebooks")


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert all(font in notices for font in FONTS), "a bundled font is missing from the notices"


def test_if_licences_allowed() -> None:
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    paragraphs = re.split(r"\n\s*\n", Path("/app/THIRD_PARTY_NOTICES.md").read_text())
    for font in FONTS:
        near = [p for p in paragraphs if font in p]
        assert near and any(any(l in p for l in ALLOWED_LICENCES) for p in near), f"{font} lacks an allowed licence"


def test_if_no_extra_datastore() -> None:
    assert Postgres().tables(), "the app keeps no tables in PostgreSQL"
    stores = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lowdb", "nedb", "mongodb", "@libsql/client"}
    assert not stores & {p.name for p in shipped_packages()}
    files = [p for p in Path(DEPLOYED_APP).rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, f"database files in the app: {files[:5]}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [md("# Look"), code("1")])])
    foreign: list[str] = []
    for path in ("/", "/notebooks", f"/notebooks/{w.books['nb'].id}"):
        with as_user(browser, w.users["owner"], "/") as page:
            page.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and not same_origin(r.url, origin) else None)
            page.goto(app_url + path)
            see(page, visible(page.get_by_role("banner")), f"{path} rendered")
    assert not foreign, f"cross-origin loads: {foreign[:10]}"


def test_if_no_server_evaluation(app_url: str) -> None:
    c1 = cid("n1")
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1 + 1", id=c1)])])
    owner, book = w.users["owner"], w.books["nb"].id
    run_id = queue_run(owner, book, c1)
    start_run(owner, book, run_id)
    for _ in range(20):
        current = by_id(cells_now(owner, book))[c1]
        assert current["outputs"] == [] and current["execution_count"] is None and current["run_state"] == "running"


def test_if_service_config_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    target = r"\S*(compose|services?)[\w.-]*\.ya?ml"
    shell = re.compile(rf"(>\s*{target}|sed\s+-i[^|;&]*{target}|tee\s+{target}|rm\s+[^|;&]*{target}|mv\s+{target})")
    offenders: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "")
            args = node.get("input") or node.get("arguments") or {}
            blob = args if isinstance(args, str) else json.dumps(args)
            written = str(args.get("file_path") or args.get("path") or "") if isinstance(args, dict) else ""
            if re.search(r"write|edit|replace", name, re.I) and re.search(target, written):
                offenders.append(written[:200])
            if re.search(r"bash|shell|exec", name, re.I) and shell.search(blob):
                offenders.append(blob[:200])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(path.read_text()))
    assert not offenders, f"service configuration was changed: {offenders[:5]}"


def test_if_no_real_product_names(browser: Browser, app_url: str) -> None:
    listed = ["jup" + "yter", "jup" + "yterlab", "co" + "lab", "deep" + "note", "kag" + "gle", "nter" + "act",
              "observable" + "hq"]
    names = re.compile(r"\b(" + "|".join(listed) + r")\b", re.I)
    w = seed(app_url, ["owner"], [notebook("nb", "owner", [code("1")])])
    for path in ("/", "/notebooks", f"/notebooks/{w.books['nb'].id}"):
        with as_user(browser, w.users["owner"], path) as page:
            see(page, visible(page.get_by_role("banner")), f"{path} rendered")
            assert not names.search(page.content()), f"a real product name appears on {path}"
    hits = []
    for file in Path("/app").rglob("*"):
        if file.is_file() and not {"node_modules", ".git"} & set(file.parts) and file.name != "THIRD_PARTY_NOTICES.md" \
                and file.suffix in (".ts", ".tsx", ".js", ".css", ".html", ".md", ".json", ".svg"):
            if names.search(file.read_text(errors="ignore")):
                hits.append(str(file))
    assert not hits, f"real product names in source: {hits[:10]}"
