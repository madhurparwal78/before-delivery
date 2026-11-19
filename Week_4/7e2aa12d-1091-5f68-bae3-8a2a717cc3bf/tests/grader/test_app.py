from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    advance,
    center,
    held,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    session,
    shipped_packages,
    tap,
    unique,
)
from conftest import layout as no_page_overflow


PASSWORD = "drafting-01"
GRADING_KEY = os.environ.get("GRADING_KEY", "gk-mullion-5d81c0e2a4")
PRESENCE_SECONDS = int(os.environ.get("PRESENCE_SECONDS", "10"))
MAX_TRACKS = int(os.environ.get("MAX_TRACKS", "12"))
MAX_BREAKPOINTS = int(os.environ.get("MAX_BREAKPOINTS", "3"))
OUTAGE_ENV = "APP_VALKEY_DOWN_URL"

USERNAME_MSG = "Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter."
PASSWORD_MSG = "Passwords are 8 to 128 characters."
TAKEN_MSG = "That username is taken."
WRONG_CREDENTIALS_MSG = "Wrong username or password."
INVALID_BODY_MSG = "The request body is not valid."
LAYOUT_NAME_MSG = "Layout names are 1 to 80 characters."
TEMPLATE_MSG = "Choose a starter template."
SIZE_FORM_MSG = "Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr)."
SIZE_RANGE_MSG = "Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%."
SIZE_FR_MIN_MSG = "A flexible size (fr) can only be the maximum in minmax."
SIZE_ORDER_MSG = "The minimum is larger than the maximum."
GAP_MSG = "Gaps are whole pixels from 0 to 200."
AREA_NAME_MSG = "Area names use 1 to 24 lowercase letters, digits and hyphens and start with a letter."
RESERVED_MSG = "The name layout is reserved."
BREAKPOINT_RANGE_MSG = "Breakpoints start between 400px and 1440px."
CSS_LONG_MSG = "The CSS is longer than 20,000 characters."
VERSION_NAME_MSG = "Version names are 1 to 60 characters."
NOT_AVAILABLE = "This layout is not available."
LIVE_PAUSED = "Live updates are paused. Your changes are still saved."
ALL_SAVED = "All changes saved."
SAVING = "Saving…"
NO_CHANGES = "No changes."
UNKNOWN_CHANGE_MSG = "Unknown change."
UNKNOWN_BASE_MSG = "Unknown base revision."
NOTHING_TO_UNDO = "Nothing to undo."
NOTHING_TO_REDO = "Nothing to redo."
VERSION_NAME = "First pass"

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
PREVIEW_MIN = 320
PREVIEW_MAX = 1440
PREVIEW_START = 1280
PREVIEW_STEP = 10
BASE_TAB_WIDTH = 375
NARROWEST_BREAKPOINT = 400
WIDEST_BREAKPOINT = 1440
PX_STEP = 10
FR_STEP = 0.25
PCT_STEP = 1
DRAG_STEP_PX = 20
TOUCH_TARGET_PX = 44
GAP_MAX = 200
BODY_LIMIT = 65_536
CSS_LIMIT = 20_000
TOKEN_MIN_CHARS = 22
LIVE_MS = 2000
LIVE_S = LIVE_MS / 1000
NOTICE_STAY_MS = 8000
NOTICE_MAX_MS = 300
DRAWER_MAX_MS = 350
FOLD_MAX_MS = 300
FOLD_MIN_MS = 150
NOTICE_MIN_MS = 150
DRAWER_MIN_MS = 200
AT_ONCE_MS = 20
FRAME_MS = 20
FRAME_TRIES = 5

HTTP_TIMEOUT_S = 30
UI_MS = 15_000
UI_S = 15
API_S = 15
POLL_MS = 250
CLOCK_NUDGE_MS = 50
TAB_LIMIT = 80
CHANGES_GLOB = "**/api/layouts/*/changes"

PROBE_TOO_SHORT_USERNAME = "ab"
PROBE_BAD_USERNAMES = ["ab", "a" * 25, "1abc", "abc_d", "Abcd", "-abc"]
PROBE_UNKNOWN_KIND = "paint"
PROBE_FOREIGN_NEXT = "//elsewhere.invalid/x"
PROBE_UNKNOWN_VERSION = 9
PROBE_UNKNOWN_INDEX = 9
PROBE_LOW_BREAKPOINT = NARROWEST_BREAKPOINT - 1
PROBE_FOREIGN_ORIGIN = "http://elsewhere.invalid"
PROBE_SOURCE_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/.package-lock.json"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sqlite", "mongodb", "mongoose", "mysql", "mysql2", "lowdb", "nedb", "level", "lmdb", "pouchdb", "nano", "cassandra-driver", "ioredis-mock", "memcached"}
APP_DIR = Path("/app")


def root(url: str) -> str:
    return url.rstrip("/")


def name_for(prefix: str) -> str:
    token = unique(prefix)[0]
    return f"{prefix}-{hashlib.sha256(token.encode()).hexdigest()[:10]}"


def area(name: str, r1: int, c1: int, r2: int, c2: int) -> dict[str, Any]:
    return {"name": name, "row_start": r1, "column_start": c1, "row_end": r2, "column_end": c2}


def bp(min_width: int, columns: list[str], rows: list[str], areas: list[dict] | tuple = (), gap: dict | None = None) -> dict[str, Any]:
    return {"min_width": min_width, "columns": list(columns), "rows": list(rows), "areas": list(areas), "gap": gap}


def fields(columns: list[str], rows: list[str], gap: tuple[int, int] = (16, 16), areas: list | tuple = (), breakpoints: list | tuple = ()) -> dict[str, Any]:
    return {"columns": list(columns), "rows": list(rows), "gap": {"row": gap[0], "column": gap[1]}, "areas": list(areas), "breakpoints": list(breakpoints)}


def _area_shape(a: dict) -> dict:
    return {k: a[k] for k in ("name", "row_start", "column_start", "row_end", "column_end")}


def shape(layout: dict) -> dict:
    def gap(g: dict | None) -> dict | None:
        return None if g is None else {"row": g["row"], "column": g["column"]}

    return {
        "columns": layout["columns"],
        "rows": layout["rows"],
        "gap": gap(layout["gap"]),
        "areas": [_area_shape(a) for a in layout["areas"]],
        "breakpoints": [
            {"min_width": b["min_width"], "columns": b["columns"], "rows": b["rows"], "areas": [_area_shape(a) for a in b["areas"]], "gap": gap(b["gap"])}
            for b in layout["breakpoints"]
        ],
    }


HG_BASE_AREAS = [area("header", 1, 1, 2, 2), area("nav", 2, 1, 3, 2), area("main", 3, 1, 4, 2), area("aside", 4, 1, 5, 2), area("footer", 5, 1, 6, 2)]
HG_BP_AREAS = [area("header", 1, 1, 2, 4), area("nav", 2, 1, 3, 2), area("main", 2, 2, 3, 3), area("aside", 2, 3, 3, 4), area("footer", 3, 1, 4, 4)]
BLANK = fields(["1fr", "1fr", "1fr"], ["1fr", "1fr", "1fr"], (16, 16))
HOLY_GRAIL = fields(["1fr"], ["auto", "auto", "1fr", "auto", "auto"], (16, 16), HG_BASE_AREAS, [bp(768, ["200px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS)])
DASHBOARD = fields(["1fr"], ["56px", "auto", "1fr"], (12, 12), [area("top", 1, 1, 2, 2), area("side", 2, 1, 3, 2), area("content", 3, 1, 4, 2)],
                   [bp(1024, ["240px", "1fr"], ["56px", "1fr"], [area("top", 1, 1, 2, 3), area("side", 2, 1, 3, 2), area("content", 2, 2, 3, 3)])])
MAG_BASE_AREAS = [area("lead", 1, 1, 2, 3), area("story-a", 2, 1, 3, 2), area("story-b", 2, 2, 3, 3), area("story-c", 3, 1, 4, 3)]
MAG_BP_AREAS = [area("lead", 1, 1, 3, 2), area("story-a", 1, 2, 2, 3), area("story-b", 1, 3, 2, 4), area("story-c", 2, 2, 3, 4)]
MAGAZINE = fields(["1fr", "1fr"], ["auto", "auto", "auto"], (24, 16), MAG_BASE_AREAS, [bp(1280, ["2fr", "1fr", "1fr"], ["auto", "1fr"], MAG_BP_AREAS)])
HG768_AS_BASE = fields(["200px", "1fr", "200px"], ["auto", "1fr", "auto"], (16, 16), HG_BP_AREAS)
BLANK_MAIN = fields(["1fr", "1fr", "1fr"], ["1fr", "1fr", "1fr"], (16, 16), [area("main", 2, 1, 3, 4)])

BLANK_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 16px;
}
"""
BLANK_HTML = '<div class="layout"></div>\n'

HOLY_GRAIL_BASE_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr auto auto;
  gap: 16px;
  grid-template-areas:
    "header"
    "nav"
    "main"
    "aside"
    "footer";
}

.header { grid-area: header; }
.nav { grid-area: nav; }
.main { grid-area: main; }
.aside { grid-area: aside; }
.footer { grid-area: footer; }
"""
HOLY_GRAIL_CSS = HOLY_GRAIL_BASE_CSS + """
@media (min-width: 768px) {
  .layout {
    grid-template-columns: 200px 1fr 200px;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header header"
      "nav main aside"
      "footer footer footer";
  }
}
"""
HOLY_GRAIL_HTML = """<div class="layout">
  <div class="header">header</div>
  <div class="nav">nav</div>
  <div class="main">main</div>
  <div class="aside">aside</div>
  <div class="footer">footer</div>
</div>
"""
DASHBOARD_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 56px auto 1fr;
  gap: 12px;
  grid-template-areas:
    "top"
    "side"
    "content";
}

.top { grid-area: top; }
.side { grid-area: side; }
.content { grid-area: content; }

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: 240px 1fr;
    grid-template-rows: 56px 1fr;
    grid-template-areas:
      "top top"
      "side content";
  }
}
"""
DASHBOARD_HTML = """<div class="layout">
  <div class="top">top</div>
  <div class="side">side</div>
  <div class="content">content</div>
</div>
"""
MAGAZINE_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 24px 16px;
  grid-template-areas:
    "lead lead"
    "story-a story-b"
    "story-c story-c";
}

.lead { grid-area: lead; }
.story-a { grid-area: story-a; }
.story-b { grid-area: story-b; }
.story-c { grid-area: story-c; }

@media (min-width: 1280px) {
  .layout {
    grid-template-columns: 2fr 1fr 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "lead story-a story-b"
      "lead story-c story-c";
  }
}
"""
MAGAZINE_HTML = """<div class="layout">
  <div class="lead">lead</div>
  <div class="story-a">story-a</div>
  <div class="story-b">story-b</div>
  <div class="story-c">story-c</div>
</div>
"""
BLANK_MAIN_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 16px;
  grid-template-areas:
    ". . ."
    "main main main"
    ". . .";
}

.main { grid-area: main; }
"""
MAIN_HTML = '<div class="layout">\n  <div class="main">main</div>\n</div>\n'


class Api:
    def __init__(self, base: str, cookie: str | None = None) -> None:
        self.base = base
        self.cookie = cookie

    def call(self, method: str, path: str, body: Any = None, *, content: bytes | str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
        sent = {"Content-Type": "application/json"}
        if self.cookie:
            sent["Cookie"] = f"mullion_session={self.cookie}"
        if body is not None:
            content = json.dumps(body)
        sent.update(headers or {})
        return httpx.request(method, self.base + path, content=content, headers=sent, timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    def get_layout(self, lid: str) -> dict:
        r = self.call("GET", f"/api/layouts/{lid}")
        assert r.status_code == 200, f"GET /api/layouts/{lid} answered {r.status_code} {r.text[:300]}; expected 200 (L468)"
        return r.json()

    def change(self, lid: str, change: dict, base: int | None = None) -> httpx.Response:
        if base is None:
            base = self.get_layout(lid)["revision"]
        return self.call("POST", f"/api/layouts/{lid}/changes", {"base_revision": base, "change": change})

    def applied(self, lid: str, change: dict, base: int | None = None) -> dict:
        r = self.change(lid, change, base)
        assert r.status_code == 200 and "layout" in r.json(), f"change {change} answered {r.status_code} {r.text[:300]}; expected 200 with the layout (L469)"
        return r.json()

    def refused(self, lid: str, change: dict, message: str, base: int | None = None) -> None:
        r = self.change(lid, change, base)
        expect_error(r, 422, "invalid", message, f"change {change}")


def expect_error(r: httpx.Response, status: int, error: str, message: str | None = None, what: str = "") -> dict:
    assert r.status_code == status, f"{what} answered {r.status_code} {r.text[:300]}; expected {status}"
    body = r.json()
    assert body.get("error") == error, f"{what} body {body}; expected error {error!r}"
    if message is not None:
        assert body.get("message") == message, f"{what} message {body.get('message')!r}; expected {message!r}"
    return body


@dataclass
class World:
    base: str
    sessions: dict[str, str]
    layouts: dict[str, dict[str, Any]]

    def api(self, user: str | None = None) -> Api:
        return Api(self.base, self.sessions[user] if user else None)

    def lid(self, ref: str = "L1") -> str:
        return self.layouts[ref]["id"]


def spec(ref: str, owner: str, *, template: str | None = None, grid: dict | None = None, name: str | None = None,
         versions: list | tuple = (), collaborators: list | tuple = (), view_link: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {"ref": ref, "owner": owner, "name": name or name_for("layout")}
    if template:
        body["template"] = template
    if grid:
        body.update(grid)
    body["versions"] = list(versions)
    body["collaborators"] = list(collaborators)
    body["view_link"] = view_link
    return body


def seed(base: str, users: list[str], layouts: list[dict] | tuple = ()) -> World:
    body = {"users": [{"username": u, "password": PASSWORD} for u in users], "layouts": list(layouts)}
    r = post_json(base, "/api/grading/setup", body, **{"X-Grading-Key": GRADING_KEY})
    assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code} {r.text[:400]}; expected 201 (L546)"
    data = r.json()
    return World(base, data["sessions"], data["layouts"])


def outage_base() -> str:
    url = os.environ.get(OUTAGE_ENV)
    if not url:
        pytest.fail(f"{OUTAGE_ENV} is not set; the valkey-down copy from the spec outages is required")
    return root(url)


def session_cookie(r: httpx.Response) -> tuple[str, str]:
    for header in r.headers.get_list("set-cookie"):
        if header.startswith("mullion_session="):
            return header.split(";", 1)[0].split("=", 1)[1], header
    pytest.fail(f"response {r.status_code} set no mullion_session cookie (L460); headers {r.headers}")


def token_of(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[1]


def api_until(fetch: Callable[[], Any], ok: Callable[[Any], bool], what: str, seconds: float = API_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ok(last):
            return last
    pytest.fail(f"{what}; last seen {str(last)[:500]}")


SOCKETS: dict[int, list[Any]] = {}


@contextmanager
def opened(browser: Browser, base: str, path: str, cookie: str | None = None, *, viewport: dict = DESKTOP,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport)
        sockets: list[Any] = []
        SOCKETS[id(page)] = sockets
        page.on("websocket", lambda ws: sockets.append(ws))
        if cookie:
            page.context.add_cookies([{"name": "mullion_session", "value": cookie, "url": base + "/"}])
        page.goto(base + path)
        try:
            yield page
        finally:
            SOCKETS.pop(id(page), None)


def soon(page: Page, check: Callable[[], None], what: str, seconds: float = UI_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except AssertionError as exc:
            last = exc
            advance(page, CLOCK_NUDGE_MS)
    pytest.fail(f"{what}: {last}")


def save_state(page: Page) -> Locator:
    return page.get_by_role("status", name="Save state")


def ready(page: Page) -> None:
    soon(page, lambda: expect(save_state(page)).to_contain_text(ALL_SAVED, timeout=POLL_MS), "editor shows Save state 'All changes saved.' at load (L346)")


@contextmanager
def editor(browser: Browser, world: World, user: str, ref: str = "L1", **kw: Any) -> Iterator[Page]:
    with opened(browser, world.base, f"/layouts/{world.lid(ref)}", world.sessions[user], **kw) as page:
        ready(page)
        yield page


def grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Layout grid")


def cell(page: Page, r: int, c: int) -> Locator:
    return grid(page).get_by_role("gridcell", name=re.compile(rf"^Row {r}, column {c}, "))


def named_cell(page: Page, r: int, c: int, area_name: str) -> Locator:
    return grid(page).get_by_role("gridcell", name=f"Row {r}, column {c}, {area_name}", exact=True)


def field(page: Page, name: str) -> Locator:
    return page.get_by_role("textbox", name=name, exact=True)


def button(page: Page, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def dialog(page: Page, name: str) -> Locator:
    return page.get_by_role("dialog", name=name, exact=True)


def updates(page: Page) -> Locator:
    return page.get_by_role("status", name="Layout updates")


def edit_problem(page: Page) -> Locator:
    return page.get_by_role("alert", name="Edit problem")


def notice(page: Page) -> Locator:
    return page.get_by_role("alert", name="Editor notice")


def live_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Live status")


def designers(page: Page) -> Locator:
    return page.get_by_role("list", name="Designers here")


def slider(page: Page) -> Locator:
    return page.get_by_role("slider", name="Preview width")


def bp_tab(page: Page, name: str) -> Locator:
    return page.get_by_role("tablist", name="Breakpoints").get_by_role("tab", name=name, exact=True)


def colheader(page: Page, n: int) -> Locator:
    return page.get_by_role("columnheader", name=f"Column {n}", exact=True)


def rowheader(page: Page, n: int) -> Locator:
    return page.get_by_role("rowheader", name=f"Row {n}", exact=True)


def separator(page: Page, name: str) -> Locator:
    return page.get_by_role("separator", name=name, exact=True)


def block(page: Page, name: str) -> Locator:
    return page.locator(f'[data-area-name="{name}"]')


def preview(page: Page) -> Locator:
    return page.get_by_title("Layout preview")


def preview_columns(page: Page) -> list[float]:
    text = preview(page).element_handle().content_frame().evaluate("() => getComputedStyle(document.getElementsByClassName('layout')[0]).gridTemplateColumns")
    return [float(v[:-2]) for v in text.split()]


def preview_shows(page: Page, class_name: str) -> None:
    def check() -> None:
        count = preview(page).element_handle().content_frame().evaluate("n => document.getElementsByClassName(n).length", class_name)
        assert count == 1, f"the preview holds {count} elements of class {class_name}; expected 1 (L621)"
    soon(page, check, f"the preview shows area {class_name}")


def half_up(x: float) -> int:
    return math.floor(x + 0.5)


def announce(page: Page, text: str, seconds: float = UI_S) -> None:
    soon(page, lambda: expect(updates(page)).to_contain_text(text, timeout=POLL_MS), f"'Layout updates' announced {text!r}", seconds)


def enter(box: Locator, value: str) -> None:
    box.fill(value)
    box.press("Enter")


def code_box(page: Page, which: str) -> Locator:
    page.get_by_role("tablist", name="Code").get_by_role("tab", name=which, exact=True).click()
    return field(page, "Layout CSS" if which == "CSS" else "Layout HTML")


def code_equals(page: Page, which: str, text: str) -> None:
    box = code_box(page, which)
    soon(page, lambda: expect(box).to_have_value(text, timeout=POLL_MS), f"Layout {which} shows the canonical code (L64)")


def code_contains(page: Page, which: str, text: str) -> None:
    box = code_box(page, which)
    soon(page, lambda: expect(box).to_have_value(re.compile(re.escape(text)), timeout=POLL_MS), f"Layout {which} contains {text!r}")


def browser_cookie(page: Page) -> str:
    for c in page.context.cookies():
        if c["name"] == "mullion_session":
            return c["value"]
    pytest.fail("the browser holds no mullion_session cookie (L460)")


def focused_in(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el.contains(document.activeElement)"))


def grid_has_focus(page: Page) -> bool:
    return bool(grid(page).get_by_role("gridcell").evaluate_all("cells => cells.some(c => c === document.activeElement || c.contains(document.activeElement))"))


def focused_soon(page: Page, loc: Locator, what: str) -> None:
    soon(page, lambda: expect(loc).to_be_focused(timeout=POLL_MS), what)


def back_in_grid(page: Page) -> None:
    soon(page, lambda: _assert_eq(grid_has_focus(page), True, "focus is back in the grid"), "focus returns to the cursor cell (L260)")


def tab_into_grid(page: Page) -> None:
    field(page, "Column 1 size").focus()
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if grid_has_focus(page):
            return
    pytest.fail("Tab from the header controls never reached the grid cells (L233)")


def wait_designers(page: Page, names: list[str], seconds: float = UI_S) -> None:
    soon(page, lambda: expect(designers(page).get_by_role("listitem")).to_have_text(sorted(names), timeout=POLL_MS),
         f"'Designers here' lists {sorted(names)} alphabetically (L786)", seconds)


def wait_socket(page: Page) -> None:
    def check() -> None:
        assert any(not ws.is_closed() for ws in SOCKETS.get(id(page), [])), "no open live WebSocket"
    soon(page, check, "the page opened its live connection (L514)")


def mark_page(page: Page) -> None:
    page.evaluate("() => { window.__mullionProbe = 1; }")


def still_same_page(page: Page) -> None:
    assert page.evaluate("() => window.__mullionProbe === 1"), "the page reloaded; the brief requires in-place updates (L87)"


def mouse_drag(page: Page, start: Locator, end: Locator, *, release: bool = True) -> None:
    x0, y0 = center(start)
    x1, y1 = center(end)
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=8)
    if release:
        page.mouse.up()


class Finger:

    def __init__(self, page: Page) -> None:
        self.cdp = session(page)
        self.cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        self.at = (0.0, 0.0)

    def down(self, x: float, y: float) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        self.at = (x, y)

    def move(self, x: float, y: float, steps: int = 8) -> None:
        x0, y0 = self.at
        for i in range(1, steps + 1):
            px, py = x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": px, "y": py}]})
        self.at = (x, y)

    def up(self) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def change_posts(page: Page) -> list[str]:
    seen: list[str] = []
    page.on("request", lambda req: seen.append(req.url) if req.method == "POST" and req.url.endswith("/changes") else None)
    return seen


FREEZE_JS = """() => {
  if (window.__mullionFreeze) return;
  window.__mullionFreeze = true;
  const hold = (a) => { try { a.pause(); } catch (e) {} };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); hold(a); return a; };
  const grab = (event) => { for (const a of event.target.getAnimations()) hold(a); };
  document.addEventListener('animationstart', grab, true);
  document.addEventListener('transitionrun', grab, true);
}"""


def freeze(page: Page) -> None:
    page.evaluate(FREEZE_JS)


def _geo(s: dict[str, float]) -> tuple[float, float, float, float]:
    x = s.get("x", s.get("left"))
    y = s.get("y", s.get("top"))
    if x is None or y is None:
        pytest.fail(f"motion sample has no position: {s}")
    return (float(x), float(y), float(s.get("width", 0.0)), float(s.get("height", 0.0)))


def _near(a: tuple, b: tuple) -> bool:
    return all(abs(p - q) <= 1.0 for p, q in zip(a, b))


CHAIN_JS = """(e, n) => {
  const chain = [];
  for (let el = e; el; el = el.parentElement) chain.push(el);
  const live = a => a.playState !== 'finished' && Number.isFinite(a.effect?.getComputedTiming().endTime);
  const anims = chain.flatMap(el => el.getAnimations()).filter(live);
  const box = () => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; };
  if (!anims.length) return {total: 0, path: [box()]};
  const total = Math.max(...anims.map(a => a.effect.getComputedTiming().endTime));
  const saved = anims.map(a => [a, a.currentTime, a.playState]);
  anims.forEach(a => a.pause());
  const path = [];
  for (let i = 0; i <= n; i++) {
    const t = total * i / n;
    anims.forEach(a => { a.currentTime = Math.min(t, a.effect.getComputedTiming().endTime); });
    path.push({t, ...box()});
  }
  saved.forEach(([a, t, state]) => { a.currentTime = t; if (state === 'running') a.play(); });
  return {total, path};
}"""

SETTLE_JS = """e => {
  const els = [e, ...e.querySelectorAll('*')];
  for (let el = e.parentElement; el; el = el.parentElement) els.push(el);
  els.flatMap(el => el.getAnimations()).forEach(a => {
    if (a.playState !== 'finished' && Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
  });
}"""

BOX_JS = "e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }"


def _clock_path(locator: Locator, window_ms: float, samples: int = 12) -> list[dict[str, float]]:
    step, path = window_ms / (samples - 1), []
    for i in range(samples):
        if i:
            locator.page.clock.run_for(round(step))
        path.append({"t": step * i, **locator.evaluate(BOX_JS)})
    return path


def _seen(locator: Locator, points: int) -> dict:
    seen = locator.evaluate(CHAIN_JS, points)
    for _ in range(FRAME_TRIES):
        if seen["total"]:
            break
        locator.page.clock.run_for(FRAME_MS)
        seen = locator.evaluate(CHAIN_JS, points)
    return seen


def glide(locator: Locator, min_ms: float, max_ms: float, what: str) -> tuple[tuple, tuple]:
    seen = _seen(locator, 24)
    if seen["total"]:
        path = seen["path"]
        assert min_ms - 1 <= seen["total"] <= max_ms + 1, (
            f"{what}: the motion lasts {seen['total']:.0f} ms; the brief says {min_ms:g} to {max_ms:g} ms")
    else:
        path = _clock_path(locator, max_ms * 2)
        last = _geo(path[-1])
        moving = [s["t"] for s in path if not _near(_geo(s), last)]
        assert not moving or max(moving) <= max_ms, f"{what}: still moving after {max_ms:g} ms: {path}"
    start, end = _geo(path[0]), _geo(path[-1])
    assert not _near(start, end), f"{what}: the element did not move ({start} → {end})"
    assert any(not _near(_geo(s), start) and not _near(_geo(s), end) for s in path[1:-1]), (
        f"{what}: jumped instead of gliding: {path}")
    return start, end


def still(locator: Locator, what: str) -> None:
    seen = _seen(locator, 8)
    if seen["total"] > AT_ONCE_MS:
        first = _geo(seen["path"][0])
        assert all(_near(_geo(s), first) for s in seen["path"]), (
            f"{what}: moved for {seen['total']:.0f} ms: {seen['path']}")
    elif not seen["total"]:
        path = _clock_path(locator, AT_ONCE_MS * 10, samples=6)
        last = _geo(path[-1])
        assert all(_near(_geo(s), last) for s in path[1:]), f"{what}: still moving after the first frame: {path}"
    settle_all(locator)


def settle_all(locator: Locator) -> None:
    locator.evaluate(SETTLE_JS)


def drawer_on_screen(page: Page) -> Locator:
    drawer = dialog(page, "Versions")

    def check() -> None:
        expect(drawer).to_be_visible(timeout=POLL_MS)
        settle_all(drawer)
        box, width = drawer.bounding_box(), page.viewport_size["width"]
        assert box is not None and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, f"drawer box {box} is not on screen"

    soon(page, check, "the Versions drawer opens fully on screen (L295)")
    return drawer


def drawer_closed(page: Page) -> None:
    soon(page, lambda: expect(dialog(page, "Versions")).to_have_count(0, timeout=POLL_MS), "the Versions drawer closes (L295)")


def point_of(locator: Locator) -> tuple[float, float]:
    expect(locator).to_be_visible(timeout=UI_MS)
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box is not None
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def test_wf_keyboard_build_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    user, title = name_for("ana"), name_for("layout")
    with opened(browser, base, "/signup") as page:
        expect(page.get_by_role("heading", name="Create your account")).to_be_visible(timeout=UI_MS)
        field(page, "Username").fill(user)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Create account").click()
        page.wait_for_url(base + "/", timeout=UI_MS)
        expect(page.get_by_role("heading", name="Your layouts", level=1)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("No layouts yet.")).to_be_visible()
        button(page, "New layout").click()
        new = dialog(page, "New layout")
        expect(new.get_by_role("radio", name="Blank")).to_be_checked()
        new.get_by_role("textbox", name="Layout name").fill(title)
        new.get_by_role("button", name="Create layout").click()
        page.wait_for_url(re.compile(r"/layouts/[^/?#]+$"), timeout=UI_MS)
        lid = urlparse(page.url).path.split("/layouts/")[1]
        api = Api(base, browser_cookie(page))
        start = api.get_layout(lid)
        assert start["revision"] == 1 and shape(start) == BLANK, f"a new Blank layout must be exactly the template at revision 1 (L778): {start}"
        assert start["css"] == BLANK_CSS and start["html"] == BLANK_HTML, f"Blank code differs from L807-815: {start['css']!r}"
        ready(page)
        tab_into_grid(page)
        expect(cell(page, 1, 1)).to_be_focused()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        for c in (1, 2, 3):
            expect(cell(page, 2, c)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 1, 1)).to_have_attribute("aria-selected", "false")
        page.keyboard.press("Enter")
        name_box = dialog(page, "Name area").get_by_role("textbox", name="Area name")
        expect(name_box).to_be_focused(timeout=UI_MS)
        page.keyboard.type("main")
        page.keyboard.press("Enter")
        announce(page, "Area main created.")
        soon(page, lambda: expect(dialog(page, "Name area")).to_have_count(0, timeout=POLL_MS), "Name area closes after saving")
        focused_soon(page, cell(page, 2, 3), "focus returns to the cursor cell (L260)")
        expect(named_cell(page, 2, 1, "main")).to_have_count(1)
        for attr, value in (("data-row-start", "2"), ("data-column-start", "1"), ("data-row-end", "3"), ("data-column-end", "4")):
            expect(block(page, "main")).to_have_attribute(attr, value)
        code_equals(page, "CSS", BLANK_MAIN_CSS)
        preview_shows(page, "main")
        cell(page, 2, 3).focus()
        page.keyboard.press("r")
        announce(page, "Row added after row 2.")
        page.keyboard.press("Control+z")
        announce(page, "Undone.")
        page.keyboard.press("Control+Shift+z")
        announce(page, "Redone.")
        page.keyboard.press("Control+z")
        final = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 6, "six revisions: create, area, row, undo, redo, undo (L715, L741)")
        assert shape(final) == BLANK_MAIN, f"stored layout after undo {shape(final)}; expected the named area on 3 rows"
        assert final["css"] == BLANK_MAIN_CSS and final["html"] == MAIN_HTML, f"stored code {final['css']!r} {final['html']!r}"
        page.goto(base + "/")
        link = page.get_by_role("link", name=title)
        expect(link).to_be_visible(timeout=UI_MS)
        expect(link).to_contain_text("1fr 1fr 1fr")
        link.click()
        page.wait_for_url(re.compile(rf"/layouts/{re.escape(lid)}$"), timeout=UI_MS)
        ready(page)
        code_equals(page, "CSS", BLANK_MAIN_CSS)


def test_wf_keyboard_build_form_refusals(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    user = name_for("ana")
    with opened(browser, base, "/signup") as page:
        expect(field(page, "Username")).to_be_visible(timeout=UI_MS)
        field(page, "Username").fill(PROBE_TOO_SHORT_USERNAME)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Create account").click()
        expect(page.get_by_role("alert", name="Form problem")).to_contain_text(USERNAME_MSG, timeout=UI_MS)
        field(page, "Username").fill(user)
        page.get_by_label("Password", exact=True).fill(PASSWORD[:7])
        button(page, "Create account").click()
        expect(page.get_by_role("alert", name="Form problem")).to_contain_text(PASSWORD_MSG, timeout=UI_MS)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Create account").click()
        page.wait_for_url(base + "/", timeout=UI_MS)
        button(page, "New layout").click()
        new = dialog(page, "New layout")
        new.get_by_role("textbox", name="Layout name").fill("   ")
        new.get_by_role("button", name="Create layout").click()
        expect(new.get_by_role("alert", name="Dialog problem")).to_contain_text(LAYOUT_NAME_MSG, timeout=UI_MS)
        expect(new).to_be_visible()
        title = name_for("layout")
        new.get_by_role("textbox", name="Layout name").fill(title)
        new.get_by_role("radio", name="Magazine Spread").check()
        new.get_by_role("button", name="Create layout").click()
        page.wait_for_url(re.compile(r"/layouts/[^/?#]+$"), timeout=UI_MS)
        lid = urlparse(page.url).path.split("/layouts/")[1]
        stored = Api(base, browser_cookie(page)).get_layout(lid)
        assert stored["name"] == title and shape(stored) == MAGAZINE, f"created layout {stored}; expected the Magazine Spread template (L899)"
        lib = Api(base, browser_cookie(page)).call("GET", "/api/layouts").json()["layouts"]
        assert [x["id"] for x in lib] == [lid], f"only the accepted create may enter the library: {lib}"


def test_wf_keyboard_build_next_path(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid = world.lid()
    with opened(browser, base, f"/layouts/{lid}") as page:
        page.wait_for_url(re.compile(r"/signin\?"), timeout=UI_MS)
        assert parse_qs(urlparse(page.url).query).get("next") == [f"/layouts/{lid}"], f"redirect {page.url}; expected next=/layouts/{lid} (L556)"
        create = page.get_by_role("link", name="Create an account")
        href = create.get_attribute("href") or ""
        assert urlparse(href).path == "/signup" and parse_qs(urlparse(href).query).get("next") == [f"/layouts/{lid}"], f"Create an account href {href!r} must carry next (L557)"
        field(page, "Username").fill(ana)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        page.wait_for_url(re.compile(rf"/layouts/{re.escape(lid)}$"), timeout=UI_MS)
        ready(page)
    with opened(browser, base, "/signin?next=" + PROBE_FOREIGN_NEXT) as page:
        field(page, "Username").fill(ana)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        page.wait_for_url(base + "/", timeout=UI_MS)


def test_accounts_signup_and_signin(app_url: str) -> None:
    base = root(app_url)
    anon = Api(base)
    user = name_for("ana")
    r = anon.call("POST", "/api/signup", {"username": user, "password": PASSWORD})
    assert r.status_code == 201 and r.json().get("username") == user, f"sign-up answered {r.status_code} {r.text}; expected 201 {{username}} (L455)"
    value, header = session_cookie(r)
    attrs = {a.strip().casefold() for a in header.split(";")[1:]}
    wanted = {"HttpOnly".casefold(), "SameSite=Lax".casefold(), "Path".casefold() + "=" + "/"}
    assert wanted <= attrs, f"cookie {header!r} must be HttpOnly, SameSite=Lax, Path / (L460)"
    me = Api(base, value).call("GET", "/api/me")
    assert me.status_code == 200 and me.json().get("username") == user, f"GET /api/me {me.status_code} {me.text}"
    expect_error(anon.call("POST", "/api/signup", {"username": user, "password": PASSWORD}), 409, "taken", TAKEN_MSG, "duplicate sign-up")
    for bad in PROBE_BAD_USERNAMES:
        expect_error(anon.call("POST", "/api/signup", {"username": bad, "password": PASSWORD}), 422, "invalid", USERNAME_MSG, f"username {bad!r}")
    for pw in ("x" * 7, "x" * 129):
        expect_error(anon.call("POST", "/api/signup", {"username": name_for("pw"), "password": pw}), 422, "invalid", PASSWORD_MSG, f"password of {len(pw)}")
    for pw in ("x" * 8, "x" * 128):
        ok = anon.call("POST", "/api/signup", {"username": name_for("pw"), "password": pw})
        assert ok.status_code == 201, f"password of {len(pw)} characters must be accepted (L554): {ok.status_code} {ok.text}"
    longest = "a" + hashlib.sha256(unique("long")[0].encode()).hexdigest()[:23]
    assert anon.call("POST", "/api/signup", {"username": longest, "password": PASSWORD}).status_code == 201, "a 24-character username is allowed (L552)"
    shortest = "a" + hashlib.sha256(unique("short")[0].encode()).hexdigest()[:2]
    assert anon.call("POST", "/api/signup", {"username": shortest, "password": PASSWORD}).status_code in (201, 409), "a 3-character username passes the rule (L552)"
    expect_error(anon.call("POST", "/api/signup", {"username": 5, "password": PASSWORD}), 422, "invalid", INVALID_BODY_MSG, "username of the wrong type")
    expect_error(anon.call("POST", "/api/session", {"username": user, "password": PASSWORD + "x"}), 401, "wrong_credentials", WRONG_CREDENTIALS_MSG, "wrong password")
    expect_error(anon.call("POST", "/api/session", {"username": name_for("nobody"), "password": PASSWORD}), 401, "wrong_credentials", WRONG_CREDENTIALS_MSG, "unknown user")
    s = anon.call("POST", "/api/session", {"username": user, "password": PASSWORD})
    assert s.status_code == 200 and s.json().get("username") == user, f"sign-in {s.status_code} {s.text}"
    fresh, _ = session_cookie(s)
    assert Api(base, fresh).call("GET", "/api/me").status_code == 200
    expect_error(anon.call("GET", "/api/me"), 401, "sign_in_required", None, "GET /api/me without a session")


def test_accounts_sign_out(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    user = name_for("ana")
    r = Api(base).call("POST", "/api/signup", {"username": user, "password": PASSWORD})
    value, _ = session_cookie(r)
    out = Api(base, value).call("DELETE", "/api/session")
    assert out.status_code == 204, f"DELETE /api/session answered {out.status_code}; expected 204 (L457)"
    cleared = [h for h in out.headers.get_list("set-cookie") if h.startswith("mullion_session=")]
    assert cleared, "DELETE /api/session must clear the mullion_session cookie (L457)"
    expect_error(Api(base, value).call("GET", "/api/me"), 401, "sign_in_required", None, "old cookie after sign-out")
    with opened(browser, base, "/signin") as page:
        field(page, "Username").fill(user)
        page.get_by_label("Password", exact=True).fill(PASSWORD + "x")
        button(page, "Sign in").click()
        expect(page.get_by_role("alert", name="Form problem")).to_contain_text(WRONG_CREDENTIALS_MSG, timeout=UI_MS)
        page.get_by_label("Password", exact=True).fill(PASSWORD)
        button(page, "Sign in").click()
        page.wait_for_url(base + "/", timeout=UI_MS)
        old = browser_cookie(page)
        button(page, "Sign out").click()
        page.wait_for_url(re.compile(r"/signin(\?.*)?$"), timeout=UI_MS)
    expect_error(Api(base, old).call("GET", "/api/me"), 401, "sign_in_required", None, "browser session after Sign out")


def test_library_lists_and_validates(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("B1", bob, template="holy-grail")])
    a = world.api(ana)
    made: list[tuple[str, str]] = []
    for tpl in ("blank", "holy-grail", "dashboard-shell"):
        title = name_for("layout")
        r = a.call("POST", "/api/layouts", {"name": title, "template": tpl})
        assert r.status_code == 201 and r.json()["revision"] == 1, f"POST /api/layouts {tpl} answered {r.status_code} {r.text[:200]}"
        made.append((r.json()["id"], title))
    default = a.call("POST", "/api/layouts", {"name": name_for("layout")})
    assert default.status_code == 201 and shape(default.json()) == BLANK, f"template defaults to blank (L467): {default.text[:300]}"
    joined = a.call("POST", f"/api/join/{token_of(world.layouts['B1']['join_path'])}")
    assert joined.status_code == 200 and joined.json().get("layout_id") == world.lid("B1"), f"join answered {joined.status_code} {joined.text}"
    lib = a.call("GET", "/api/layouts").json()["layouts"]
    expected_ids = [world.lid("B1"), default.json()["id"]] + [m[0] for m in reversed(made)]
    assert [x["id"] for x in lib] == expected_ids, f"library order {[x['id'] for x in lib]}; expected newest first {expected_ids} (L466)"
    by_id = {x["id"]: x for x in lib}
    assert by_id[world.lid("B1")]["role"] == "collaborator" and by_id[made[0][0]]["role"] == "owner"
    assert by_id[made[0][0]]["columns"] == ["1fr", "1fr", "1fr"] and by_id[made[1][0]]["columns"] == ["1fr"], f"columns are the base column list: {lib}"
    for bad in ("", "   ", "x" * 81):
        expect_error(a.call("POST", "/api/layouts", {"name": bad, "template": "blank"}), 422, "invalid", LAYOUT_NAME_MSG, f"layout name of {len(bad)}")
    expect_error(a.call("POST", "/api/layouts", {"name": name_for("layout"), "template": "masonry"}), 422, "invalid", TEMPLATE_MSG, "unknown template")
    assert a.call("POST", "/api/layouts", {"name": "x" * 80, "template": "blank"}).status_code == 201, "an 80-character name is allowed (L570)"
    after = a.call("GET", "/api/layouts").json()["layouts"]
    assert len(after) == len(lib) + 1, f"refused creates must add nothing: {len(lib)} → {len(after)}"
    other = Api(outage_base(), world.sessions[ana]).call("GET", "/api/layouts")
    assert other.status_code == 200 and [x["id"] for x in other.json()["layouts"]][1:] == [x["id"] for x in lib], \
        f"another app process on the same Postgres must list the same library: {other.text[:300]}"
    with opened(browser, base, "/", world.sessions[ana]) as page:
        expect(page.get_by_role("heading", name="Your layouts", level=1)).to_be_visible(timeout=UI_MS)
        ys = []
        for _, title in reversed(made):
            link = page.get_by_role("link", name=title)
            expect(link).to_be_visible(timeout=UI_MS)
            ys.append(link.bounding_box()["y"])
        assert ys == sorted(ys), f"library links must be newest first on screen: {ys}"


def test_grid_keys_and_dialog_focus(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        expect(cell(page, 1, 1)).to_be_focused()
        page.keyboard.press("Tab")
        assert not grid_has_focus(page), "Tab must leave the grid: the cells are a single Tab stop (L233)"
        page.keyboard.press("Shift+Tab")
        expect(cell(page, 1, 1)).to_be_focused()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowLeft")
        expect(cell(page, 1, 1)).to_be_focused()
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        expect(cell(page, 1, 3)).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(cell(page, 2, 3)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 1, 3)).to_have_attribute("aria-selected", "false")
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Shift+ArrowLeft")
        expect(cell(page, 2, 1)).to_be_focused()
        for c in (1, 2, 3):
            expect(cell(page, 2, c)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("ArrowUp")
        expect(cell(page, 1, 1)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 2, 2)).to_have_attribute("aria-selected", "false")
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Enter")
        dlg = dialog(page, "Name area")
        expect(dlg.get_by_role("textbox", name="Area name")).to_be_focused(timeout=UI_MS)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(6):
                page.keyboard.press(key)
                assert focused_in(dlg), f"{key} left the open Name area dialog (L258)"
        page.keyboard.press("Escape")
        soon(page, lambda: expect(dlg).to_have_count(0, timeout=POLL_MS), "Escape closes Name area (L259)")
        focused_soon(page, cell(page, 2, 1), "focus returns to the cursor cell after Escape (L260)")
        page.keyboard.press("Enter")
        dlg.get_by_role("button", name="Cancel").click()
        soon(page, lambda: expect(dlg).to_have_count(0, timeout=POLL_MS), "Cancel closes Name area (L259)")
        focused_soon(page, cell(page, 2, 1), "focus returns to the cursor cell after Cancel (L260)")
        assert api.get_layout(lid)["revision"] == 1, "Escape and Cancel must change nothing (L259)"
        page.keyboard.press("c")
        announce(page, "Column added after column 1.")
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        expect(cell(page, 2, 4)).to_be_focused()
        page.keyboard.press("Shift+C")
        announce(page, "Column 4 removed.")
        expect(cell(page, 2, 3)).to_be_focused()
        page.keyboard.press("r")
        announce(page, "Row added after row 2.")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Shift+R")
        announce(page, "Row 4 removed.")
        expect(cell(page, 3, 3)).to_be_focused()
        stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 5, "four accepted track-key changes")
        assert len(stored["columns"]) == 3 and len(stored["rows"]) == 3, f"track keys left {stored['columns']} / {stored['rows']}"
        for opener, name in (("Versions", "Versions"), ("Add breakpoint", "Add breakpoint"), ("Save version", "Save version"), ("Share", "Share")):
            button(page, opener).focus()
            page.keyboard.press("Enter")
            dlg = dialog(page, name)
            expect(dlg).to_be_visible(timeout=UI_MS)
            for key in ("Tab", "Shift+Tab"):
                for _ in range(8):
                    page.keyboard.press(key)
                    assert focused_in(dlg), f"{key} left the open {name} dialog (L258)"
            page.keyboard.press("Escape")
            soon(page, lambda: expect(button(page, opener)).to_be_focused(timeout=POLL_MS), f"focus returns to {opener} after Escape (L260)")


def test_undo_redo(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, a, b = world.lid(), world.api(ana), world.api(bob)
    a.refused(lid, {"kind": "undo"}, NOTHING_TO_UNDO)
    a.refused(lid, {"kind": "redo"}, NOTHING_TO_REDO)
    a.applied(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 1, "size": "2fr"})
    b.refused(lid, {"kind": "undo"}, NOTHING_TO_UNDO)
    undone = a.applied(lid, {"kind": "undo"})
    assert undone["revision"] == 3 and undone["layout"]["columns"][0] == "1fr", f"undo is a new revision restoring 1fr: {undone}"
    redone = a.applied(lid, {"kind": "redo"})
    assert redone["revision"] == 4 and redone["layout"]["columns"][0] == "2fr"
    a.applied(lid, {"kind": "undo"})
    a.applied(lid, {"kind": "set_gap", "scope": "base", "row": 24, "column": 16})
    a.refused(lid, {"kind": "redo"}, NOTHING_TO_REDO)
    with editor(browser, world, ana) as page:
        row_gap = field(page, "Row gap")
        row_gap.focus()
        page.keyboard.press("Control+z")
        button(page, "Add column").focus()
        page.keyboard.press("Control+z")
        announce(page, "Undone.")
        after = api_until(lambda: a.get_layout(lid), lambda l: l["revision"] >= 7, "Control+Z on a button applied an undo")
        assert after["revision"] == 7 and after["gap"] == {"row": 16, "column": 16}, f"only the button press may undo, the text-field press edits text (L248): {after}"
        bp_tab(page, "Base").focus()
        page.keyboard.press("Control+Shift+z")
        announce(page, "Redone.")
        redo = api_until(lambda: a.get_layout(lid), lambda l: l["revision"] == 8, "Control+Shift+Z on a tab applied a redo")
        assert redo["gap"] == {"row": 24, "column": 16}


def test_wf_track_sizes_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        mark_page(page)
        enter(field(page, "Column 2 size"), "minmax(200px, 1fr)")
        announce(page, "Column 2 set to minmax(200px, 1fr).")
        head = colheader(page, 2)
        expect(head).to_have_attribute("data-track-size", "minmax(200px, 1fr)")
        expect(head).to_have_attribute("data-track-unit", "minmax")
        soon(page, lambda: expect(head).to_have_attribute("data-resolved-px", "848", timeout=POLL_MS), "Column 2 resolves to 848 at 1280 (L705)")
        code_contains(page, "CSS", "grid-template-columns: 200px minmax(200px, 1fr) 200px;")
        soon(page, lambda: _assert_eq(preview_columns(page), [200.0, 848.0, 200.0], "preview columns"), "the preview follows the new track")
        enter(field(page, "Row 2 size"), "56px")
        announce(page, "Row 2 set to 56px.")
        expect(rowheader(page, 2)).to_have_attribute("data-track-size", "56px")
        code_contains(page, "CSS", "grid-template-rows: auto 56px auto;")
        enter(field(page, "Column 2 size"), "1.50fr")
        announce(page, "Column 2 set to 1.5fr.")
        expect(field(page, "Column 2 size")).to_have_value("1.5fr")
        still_same_page(page)
    stored = api.get_layout(lid)
    assert stored["revision"] == 4 and stored["columns"] == ["200px", "1.5fr", "200px"] and stored["rows"] == ["auto", "56px", "auto"], f"stored {stored['columns']} {stored['rows']} rev {stored['revision']}"


def _assert_eq(actual: Any, expected: Any, what: str) -> None:
    assert actual == expected, f"{what}: {actual} != {expected}"


def test_wf_track_sizes_refusals(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        box = field(page, "Column 1 size")
        for typed, message in (("10em", SIZE_FORM_MSG), ("minmax(1fr, 200px)", SIZE_FR_MIN_MSG), ("minmax(300px, 200px)", SIZE_ORDER_MSG)):
            enter(box, typed)
            soon(page, lambda m=message: expect(edit_problem(page)).to_contain_text(m, timeout=POLL_MS), f"Edit problem shows {message!r} (L341)")
            soon(page, lambda: expect(box).to_have_value("200px", timeout=POLL_MS), "the field keeps the stored size (L341)")
            assert api.get_layout(lid)["revision"] == 1, f"refused {typed!r} changed the layout"
        expect(colheader(page, 1)).to_have_attribute("data-track-size", "200px")
        enter(box, "240px")
        announce(page, "Column 1 set to 240px.")
    stored = api.get_layout(lid)
    assert stored["revision"] == 2 and stored["columns"][0] == "240px", f"only the valid size may apply: {stored['columns']}"


SIZE_FORMS = {
    "fr-trailing-zero": ("1.50fr", "1.5fr"),
    "fr-point-zero": ("2.0fr", "2fr"),
    "fr-minimum": ("0.25fr", "0.25fr"),
    "fr-maximum": ("100fr", "100fr"),
    "px-minimum": ("1px", "1px"),
    "px-maximum": ("4000px", "4000px"),
    "percent-minimum": ("1%", "1%"),
    "percent-maximum": ("100%", "100%"),
    "percent": ("25%", "25%"),
    "auto": ("auto", "auto"),
    "outer-spaces": (" 200px ", "200px"),
    "minmax-inner-spaces": ("minmax( 200px , 300px )", "minmax(200px, 300px)"),
    "minmax-fr-maximum": ("minmax(100px, 1fr)", "minmax(100px, 1fr)"),
    "minmax-px": ("minmax(100px, 300px)", "minmax(100px, 300px)"),
}


@pytest.mark.parametrize("case", list(SIZE_FORMS), ids=["fr-trailing-zero", "fr-point-zero", "fr-minimum", "fr-maximum", "px-minimum", "px-maximum", "percent-minimum", "percent-maximum", "percent", "auto", "outer-spaces", "minmax-inner-spaces", "minmax-fr-maximum", "minmax-px"])
def test_track_size_forms(app_url: str, case: str) -> None:
    typed, canonical = SIZE_FORMS[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    out = api.applied(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 1, "size": typed})
    assert out["revision"] == 2 and out["layout"]["columns"][0] == canonical, f"{typed!r} stored as {out['layout']['columns'][0]!r}; expected {canonical!r} (L580)"
    stored = api.get_layout(lid)
    assert stored["columns"] == [canonical, "1fr", "1fr"]
    assert f"grid-template-columns: {canonical} 1fr 1fr;" in stored["css"], f"generated CSS lacks canonical {canonical!r}: {stored['css']!r}"


SIZE_REFUSALS = {
    "unit-em": ("10em", SIZE_FORM_MSG),
    "px-decimal": ("200.5px", SIZE_FORM_MSG),
    "fit-content": ("fit-content(200px)", SIZE_FORM_MSG),
    "uppercase": ("1FR", SIZE_FORM_MSG),
    "fr-zero": ("0fr", SIZE_RANGE_MSG),
    "fr-below": ("0.2fr", SIZE_RANGE_MSG),
    "fr-above": ("101fr", SIZE_RANGE_MSG),
    "px-zero": ("0px", SIZE_RANGE_MSG),
    "px-above": ("4001px", SIZE_RANGE_MSG),
    "percent-above": ("150%", SIZE_RANGE_MSG),
    "range-before-fr-minimum": ("minmax(1fr, 0.1fr)", SIZE_RANGE_MSG),
    "fr-minimum": ("minmax(1fr, 200px)", SIZE_FR_MIN_MSG),
    "px-order": ("minmax(300px, 200px)", SIZE_ORDER_MSG),
    "percent-order": ("minmax(50%, 20%)", SIZE_ORDER_MSG),
}


@pytest.mark.parametrize("case", list(SIZE_REFUSALS), ids=["unit-em", "px-decimal", "fit-content", "uppercase", "fr-zero", "fr-below", "fr-above", "px-zero", "px-above", "percent-above", "range-before-fr-minimum", "fr-minimum", "px-order", "percent-order"])
def test_track_size_refusals(app_url: str, case: str) -> None:
    typed, message = SIZE_REFUSALS[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    for axis in ("column", "row"):
        api.refused(lid, {"kind": "set_track", "scope": "base", "axis": axis, "index": 1, "size": typed}, message)
    stored = api.get_layout(lid)
    assert stored["revision"] == 1 and shape(stored) == BLANK, f"refused {typed!r} changed the layout: {shape(stored)}"


RESOLVED_CASES = {
    "fixed-and-fr-at-1280": (["200px", "1fr", "200px"], 16, 1280, [200, 848, 200]),
    "fr-ratio-at-1280": (["2fr", "1fr", "1fr"], 16, 1280, [624, 312, 312]),
    "percent-at-800": (["25%", "1fr", "100px"], 20, 800, [200, 460, 100]),
    "minmax-cap-at-1000": (["minmax(100px, 300px)", "1fr"], 0, 1000, [300, 700]),
    "minmax-floor-at-375": (["minmax(200px, 1fr)", "2fr"], 16, 375, [200, 159]),
    "half-pixels-at-375": (["1fr", "1fr"], 16, 375, [180, 180]),
}


@pytest.mark.parametrize("case", list(RESOLVED_CASES), ids=["fixed-and-fr-at-1280", "fr-ratio-at-1280", "percent-at-800", "minmax-cap-at-1000", "minmax-floor-at-375", "half-pixels-at-375"])
def test_resolved_widths(browser: Browser, app_url: str, case: str) -> None:
    columns, gap, width, expected = RESOLVED_CASES[case]
    base = root(app_url)
    ana = name_for("ana")
    bps = [bp(NARROWEST_BREAKPOINT, columns, ["1fr"])] if width == BASE_TAB_WIDTH else []
    world = seed(base, [ana], [spec("L1", ana, grid=fields(columns, ["1fr"], (gap, gap), [], bps))])
    with editor(browser, world, ana) as page:
        if width == BASE_TAB_WIDTH:
            bp_tab(page, "Base").click()
        else:
            slider(page).focus()
            for _ in range((PREVIEW_START - width) // PREVIEW_STEP):
                page.keyboard.press("ArrowLeft")
        soon(page, lambda: expect(slider(page)).to_have_attribute("aria-valuetext", f"{width}px", timeout=POLL_MS), f"Preview width at {width}px")
        for i, px in enumerate(expected, start=1):
            head = colheader(page, i)
            soon(page, lambda h=head, p=px: expect(h).to_have_attribute("data-resolved-px", str(p), timeout=POLL_MS), f"Column {i} resolves to {px} (L705-711)")
            expect(head).to_contain_text(f"{px}px")
        computed = preview_columns(page)
        assert [half_up(x) for x in computed] == expected, f"preview computed {computed}; readouts must equal them rounded half up (L225)"


def test_wf_drag_naming_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        mark_page(page)
        mouse_drag(page, cell(page, 1, 1), cell(page, 1, 2), release=False)
        expect(cell(page, 1, 1)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 1, 2)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 1, 3)).to_have_attribute("aria-selected", "false")
        page.mouse.up()
        box = dialog(page, "Name area").get_by_role("textbox", name="Area name")
        expect(box).to_have_value("", timeout=UI_MS)
        enter(box, "lead")
        announce(page, "Area lead created.")
        mouse_drag(page, cell(page, 2, 1), cell(page, 2, 2))
        enter(box, "lead")
        announce(page, "Area lead extended.")
        expect(block(page, "lead")).to_have_attribute("data-row-end", "3")
        mouse_drag(page, cell(page, 1, 1), cell(page, 2, 2))
        expect(box).to_have_value("lead", timeout=UI_MS)
        enter(box, "story-a")
        announce(page, "Area lead renamed to story-a.")
        expect(named_cell(page, 2, 2, "story-a")).to_have_count(1)
        code_contains(page, "CSS", ".story-a { grid-area: story-a; }")
        code_contains(page, "HTML", '<div class="story-a">story-a</div>')
        preview_shows(page, "story-a")
        still_same_page(page)
    stored = api.get_layout(lid)
    assert stored["revision"] == 4 and stored["areas"] == [area("story-a", 1, 1, 3, 3)], f"stored {stored['areas']} rev {stored['revision']}"


def test_wf_drag_naming_press_and_cancel(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        cell(page, 2, 3).click()
        expect(cell(page, 2, 3)).to_be_focused()
        expect(cell(page, 2, 3)).to_have_attribute("aria-selected", "true")
        expect(cell(page, 1, 1)).to_have_attribute("aria-selected", "false")
        expect(dialog(page, "Name area")).to_have_count(0)
        mouse_drag(page, cell(page, 1, 1), cell(page, 3, 1))
        expect(dialog(page, "Name area")).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(dialog(page, "Name area")).to_be_hidden()
    assert api.get_layout(lid)["revision"] == 1, "a cancelled drag must store nothing (L259)"


def test_grid_markup(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", view_link=True)])
    with editor(browser, world, ana) as page:
        expect(grid(page).get_by_role("gridcell")).to_have_count(9)
        main = named_cell(page, 2, 2, "main")
        for attr, value in (("data-row", "2"), ("data-column", "2"), ("data-area", "main"), ("aria-selected", "false")):
            expect(main).to_have_attribute(attr, value)
        for n, size, unit, px in ((1, "200px", "px", "200"), (2, "1fr", "fr", "848")):
            head = colheader(page, n)
            for attr, value in (("data-track-index", str(n)), ("data-track-size", size), ("data-track-unit", unit), ("data-resolved-px", px)):
                expect(head).to_have_attribute(attr, value)
            expect(head).to_contain_text(f"{px}px")
        expect(rowheader(page, 1)).to_have_attribute("data-track-unit", "auto")
        expect(rowheader(page, 2)).to_have_attribute("data-track-size", "1fr")
        expect(page.locator("[data-area-name]")).to_have_count(5)
        for name, lines in (("main", ("2", "2", "3", "3")), ("header", ("1", "1", "2", "4"))):
            for attr, value in zip(("data-row-start", "data-column-start", "data-row-end", "data-column-end"), lines):
                expect(block(page, name)).to_have_attribute(attr, value)
        bp_tab(page, "Base").click()
        soon(page, lambda: expect(named_cell(page, 5, 1, "footer")).to_have_count(1, timeout=POLL_MS), "Base scope shows footer in row 5")
        expect(block(page, "footer")).to_have_attribute("data-row-start", "5")
        soon(page, lambda: expect(colheader(page, 1)).to_have_attribute("data-resolved-px", "375", timeout=POLL_MS), "Column 1 resolves to 375 at 375")
    with opened(browser, base, world.layouts["L1"]["view_path"]) as view:
        target = named_cell(view, 2, 2, "main")
        expect(target).to_be_visible(timeout=UI_MS)
        expect(target).to_have_attribute("data-area", "main")
        assert target.get_attribute("aria-selected") is None, "view-page cells carry no aria-selected (L219)"


def test_rename_everywhere(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="holy-grail", versions=[{"name": VERSION_NAME, "template": "holy-grail"}], collaborators=[bob], view_link=True)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb, opened(browser, base, world.layouts["L1"]["view_path"]) as pv:
        wait_designers(pa, [ana, bob])
        wait_designers(pb, [ana, bob])
        expect(named_cell(pv, 2, 1, "nav")).to_be_visible(timeout=UI_MS)
        wait_socket(pv)
        cell(pa, 2, 1).click()
        pa.keyboard.press("Enter")
        box = dialog(pa, "Name area").get_by_role("textbox", name="Area name")
        expect(box).to_have_value("nav", timeout=UI_MS)
        enter(box, "side")
        announce(pa, "Area nav renamed to side.")
        expect(named_cell(pa, 2, 1, "side")).to_have_count(1)
        expect(block(pa, "side")).to_have_count(1)
        expect(block(pa, "nav")).to_have_count(0)
        code_contains(pa, "CSS", ".side { grid-area: side; }")
        expect(code_box(pa, "CSS")).not_to_have_value(re.compile(re.escape(".nav {")))
        code_contains(pa, "HTML", '<div class="side">side</div>')
        preview_shows(pa, "side")
        announce(pb, f"{ana}: Area nav renamed to side.", LIVE_S)
        expect(named_cell(pb, 2, 1, "side")).to_have_count(1)
        announce(pv, "Layout updated.", LIVE_S)
        expect(named_cell(pv, 2, 1, "side")).to_have_count(1)
    stored = api.get_layout(lid)
    every = [a["name"] for a in stored["areas"]] + [a["name"] for b in stored["breakpoints"] for a in b["areas"]]
    assert "side" in every and "nav" not in every, f"rename must apply in every scope (L611): {every}"
    v1 = api.call("GET", f"/api/layouts/{lid}/versions/1").json()["layout"]
    assert "nav" in [a["name"] for a in v1["areas"]] and not re.search(r"(?<![\w-])side(?![\w-])", v1["css"]), "saved versions keep the old name (L611)"


CODE_CASES = {
    "empty-cells-uneven-gap": (
        fields(["1fr", "1fr", "1fr"], ["1fr", "1fr", "1fr"], (0, 16), [area("main", 2, 1, 3, 4)]),
        BLANK_MAIN_CSS.replace("gap: 16px;", "gap: 0px 16px;"),
        MAIN_HTML,
    ),
    "zero-gap-no-areas": (
        fields(["200px", "1fr"], ["auto"], (0, 0)),
        ".layout {\n  display: grid;\n  grid-template-columns: 200px 1fr;\n  grid-template-rows: auto;\n  gap: 0px;\n}\n",
        BLANK_HTML,
    ),
    "reading-order": (
        fields(["1fr", "200px"], ["auto", "auto"], (16, 16), [area("footer", 2, 1, 3, 3), area("header", 1, 1, 2, 2), area("aside", 1, 2, 2, 3)]),
        ".layout {\n  display: grid;\n  grid-template-columns: 1fr 200px;\n  grid-template-rows: auto auto;\n  gap: 16px;\n"
        "  grid-template-areas:\n    \"header aside\"\n    \"footer footer\";\n}\n\n"
        ".header { grid-area: header; }\n.aside { grid-area: aside; }\n.footer { grid-area: footer; }\n",
        '<div class="layout">\n  <div class="header">header</div>\n  <div class="aside">aside</div>\n  <div class="footer">footer</div>\n</div>\n',
    ),
}


@pytest.mark.parametrize("case", list(CODE_CASES), ids=["empty-cells-uneven-gap", "zero-gap-no-areas", "reading-order"])
def test_generated_code(browser: Browser, app_url: str, case: str) -> None:
    grid_fields, css, html = CODE_CASES[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=grid_fields)])
    stored = world.api(ana).get_layout(world.lid())
    assert stored["css"] == css, f"css {stored['css']!r}; expected {css!r} (L621-630)"
    assert stored["html"] == html, f"html {stored['html']!r}; expected {html!r} (L631)"
    assert [a["name"] for a in stored["areas"]] == [a["name"] for a in sorted(grid_fields["areas"], key=lambda a: (a["row_start"], a["column_start"]))], "areas in reading order (L446)"
    with editor(browser, world, ana) as page:
        code_equals(page, "CSS", css)
        code_equals(page, "HTML", html)


def _name_area(page: Page, name: str) -> Locator:
    page.keyboard.press("Enter")
    dlg = dialog(page, "Name area")
    box = dlg.get_by_role("textbox", name="Area name")
    expect(box).to_be_focused(timeout=UI_MS)
    box.fill(name)
    box.press("Enter")
    return dlg


def _dialog_refusal(page: Page, dlg: Locator, message: str) -> None:
    soon(page, lambda: expect(dlg.get_by_role("alert", name="Dialog problem")).to_contain_text(message, timeout=POLL_MS), f"Dialog problem shows {message!r}")
    expect(dlg).to_be_visible()


def test_wf_naming_rules_keyboard(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["1fr"] * 3, ["1fr"] * 3, (16, 16), [area("main", 1, 1, 2, 3)]))])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        for key in ("ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight"):
            page.keyboard.press(key)
        dlg = _name_area(page, "Main")
        _dialog_refusal(page, dlg, AREA_NAME_MSG)
        dlg.get_by_role("textbox", name="Area name").fill("layout")
        dlg.get_by_role("textbox", name="Area name").press("Enter")
        _dialog_refusal(page, dlg, RESERVED_MSG)
        page.keyboard.press("Escape")
        back_in_grid(page)
        for key in ("ArrowUp", "ArrowUp", "Shift+ArrowLeft"):
            page.keyboard.press(key)
        dlg = _name_area(page, "side")
        _dialog_refusal(page, dlg, "Area side would overlap area main.")
        page.keyboard.press("Escape")
        back_in_grid(page)
        for key in ("ArrowDown", "ArrowLeft"):
            page.keyboard.press(key)
        focused_soon(page, cell(page, 2, 1), "the cursor moved to row 2, column 1")
        dlg = _name_area(page, "main")
        _dialog_refusal(page, dlg, "Area main must stay one rectangle.")
        page.keyboard.press("Escape")
        back_in_grid(page)
        assert api.get_layout(lid)["revision"] == 1, "refusals must store nothing (L605)"
        page.keyboard.press("Shift+ArrowRight")
        _name_area(page, "main")
        announce(page, "Area main extended.")
        back_in_grid(page)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        focused_soon(page, cell(page, 2, 2), "the cursor moved to row 2, column 2")
        page.keyboard.press("Delete")
        soon(page, lambda: expect(edit_problem(page)).to_contain_text("Area main must stay one rectangle.", timeout=POLL_MS), "refused clear in Edit problem (L616)")
        assert api.get_layout(lid)["areas"] == [area("main", 1, 1, 3, 3)]
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Backspace")
        announce(page, "Cells cleared.")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Delete")
        announce(page, "Cells cleared. Area main removed.")
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 4, "extend and two clears store three revisions")
    assert stored["areas"] == [], f"main must be removed after its last cells clear: {stored['areas']}"


def test_wf_naming_rules_unchanged(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["1fr"] * 3, ["1fr"] * 3, (16, 16), [area("main", 1, 1, 2, 3)]))])
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Enter")
        box = dialog(page, "Name area").get_by_role("textbox", name="Area name")
        expect(box).to_have_value("main", timeout=UI_MS)
        box.press("Enter")
        announce(page, NO_CHANGES)
    assert world.api(ana).get_layout(world.lid())["revision"] == 1, "an unchanged save gets no revision (L718)"


def test_area_names(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    sel = {"scope": "base", "row_start": 1, "column_start": 1, "row_end": 2, "column_end": 2}
    for bad in ("Main", "1main", "main_area", "-main", "", "a" * 25):
        api.refused(lid, {"kind": "set_area", "name": bad, **sel}, AREA_NAME_MSG)
    api.refused(lid, {"kind": "set_area", "name": "layout", **sel}, RESERVED_MSG)
    api.applied(lid, {"kind": "set_area", "name": "a", **sel})
    longest = "a" * 24
    api.applied(lid, {"kind": "set_area", "name": longest, "scope": "base", "row_start": 2, "column_start": 1, "row_end": 3, "column_end": 2})
    api.refused(lid, {"kind": "rename_area", "name": "nav", "new_name": "side"}, "There is no area nav.")
    api.refused(lid, {"kind": "rename_area", "name": "a", "new_name": "layout"}, RESERVED_MSG)
    api.refused(lid, {"kind": "rename_area", "name": "a", "new_name": "Side"}, AREA_NAME_MSG)
    api.refused(lid, {"kind": "rename_area", "name": "a", "new_name": longest}, f"The name {longest} is already used.")
    stored = api.get_layout(lid)
    assert stored["revision"] == 3 and [x["name"] for x in stored["areas"]] == ["a", longest], f"only valid names store: {stored['areas']}"


def test_overlap_and_shape(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    start = fields(["1fr"] * 3, ["1fr"] * 3, (16, 16), [area("nav", 1, 1, 2, 2), area("main", 1, 2, 2, 3), area("footer", 3, 1, 4, 4)])
    world = seed(base, [ana], [spec("L1", ana, grid=start)])
    lid, api = world.lid(), world.api(ana)

    def put(name: str, r1: int, c1: int, r2: int, c2: int) -> dict:
        return {"kind": "set_area", "scope": "base", "name": name, "row_start": r1, "column_start": c1, "row_end": r2, "column_end": c2}

    api.refused(lid, put("aside", 1, 1, 2, 4), "Area aside would overlap area nav.")
    api.refused(lid, put("nav", 1, 1, 2, 3), "Area nav would overlap area main.")
    api.refused(lid, put("nav", 2, 2, 3, 3), "Area nav must stay one rectangle.")
    api.refused(lid, put("layout", 1, 1, 2, 4), RESERVED_MSG)
    stored = api.get_layout(lid)
    assert stored["revision"] == 1 and shape(stored) == start, f"refusals changed the layout: {shape(stored)}"
    out = api.applied(lid, put("nav", 2, 1, 3, 2))
    assert out["layout"]["areas"][0] == area("nav", 1, 1, 3, 2), f"a rectangular union extends nav: {out['layout']['areas']}"


def test_clear_cells(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    start = fields(["1fr"] * 3, ["1fr"] * 3, (16, 16), [area("main", 1, 1, 3, 3), area("aside", 1, 3, 4, 4)])
    world = seed(base, [ana], [spec("L1", ana, grid=start)])
    lid, api = world.lid(), world.api(ana)

    def clear(r1: int, c1: int, r2: int, c2: int) -> dict:
        return {"kind": "clear_cells", "scope": "base", "row_start": r1, "column_start": c1, "row_end": r2, "column_end": c2}

    api.refused(lid, clear(1, 1, 2, 2), "Area main must stay one rectangle.")
    api.refused(lid, clear(2, 2, 3, 4), "Area main must stay one rectangle.")
    assert api.get_layout(lid)["revision"] == 1
    out = api.applied(lid, clear(3, 1, 4, 4))
    assert out["layout"]["areas"] == [area("main", 1, 1, 3, 3), area("aside", 1, 3, 3, 4)], f"{out['layout']['areas']}"
    out = api.applied(lid, clear(1, 3, 3, 4))
    assert out["layout"]["areas"] == [area("main", 1, 1, 3, 3)] and out["revision"] == 3
    again = api.change(lid, clear(3, 1, 4, 4))
    assert again.status_code == 200 and again.json().get("unchanged") is True and again.json().get("revision") == 3, f"empty clear must answer unchanged (L469): {again.text}"


def test_wf_track_edits_keys_and_buttons(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        mark_page(page)
        cell(page, 1, 1).click()
        page.keyboard.press("c")
        announce(page, "Column added after column 1.")
        page.keyboard.press("r")
        announce(page, "Row added after row 1.")
        button(page, "Remove column 4").click()
        announce(page, "Column 4 removed. Area aside removed.")
        cell(page, 1, 1).click()
        page.keyboard.press("Shift+R")
        announce(page, "Row 1 removed. Area header removed.")
        bp768 = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 5, "four track edits stored")["breakpoints"][0]
        assert bp768["columns"] == ["200px", "1fr", "1fr"] and bp768["rows"] == ["1fr", "1fr", "auto"], f"{bp768}"
        assert bp768["areas"] == [area("nav", 1, 1, 2, 2), area("main", 1, 3, 2, 4), area("footer", 2, 1, 3, 4)] or \
            bp768["areas"] == [area("nav", 2, 1, 3, 2), area("main", 2, 3, 3, 4), area("footer", 3, 1, 4, 4)], f"areas {bp768['areas']}"
        button(page, "Add row").click()
        soon(page, lambda: expect(updates(page)).to_contain_text(re.compile(r"Row added after row \d+\."), timeout=POLL_MS), "Add row announced (L358)")
        expect(named_cell(page, 1, 2, "empty").or_(named_cell(page, 2, 2, "empty")).first).to_be_visible()
        still_same_page(page)
    stored = api.get_layout(lid)
    assert len(stored["breakpoints"][0]["rows"]) == 4 and shape(stored)["areas"] == HG_BASE_AREAS, "Add row edits only the scope shown"


def test_wf_track_edits_limits(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["1fr"] * MAX_TRACKS, ["1fr"]))])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        cell(page, 1, 1).click()
        page.keyboard.press("c")
        soon(page, lambda: expect(edit_problem(page)).to_contain_text(f"A layout can have at most {MAX_TRACKS} columns.", timeout=POLL_MS), "column limit refusal")
        page.keyboard.press("Shift+R")
        soon(page, lambda: expect(edit_problem(page)).to_contain_text("A layout needs at least one row.", timeout=POLL_MS), "row minimum refusal")
        gap = field(page, "Row gap")
        enter(gap, str(GAP_MAX + 1))
        soon(page, lambda: expect(edit_problem(page)).to_contain_text(GAP_MSG, timeout=POLL_MS), "gap refusal")
        soon(page, lambda: expect(gap).to_have_value("16", timeout=POLL_MS), "gap field keeps 16")
        assert api.get_layout(lid)["revision"] == 1
        enter(gap, "0")
        announce(page, "Row gap set to 0px.")
    assert api.get_layout(lid)["gap"] == {"row": 0, "column": 16}


def test_add_track_joins_areas(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail"), spec("L2", ana, template="holy-grail"), spec("L3", ana, template="magazine-spread")])
    api = world.api(ana)
    one = api.applied(world.lid("L1"), {"kind": "add_track", "scope": 768, "axis": "column", "after": 1})["layout"]
    b = one["breakpoints"][0]
    assert b["columns"] == ["200px", "1fr", "1fr", "200px"]
    assert b["areas"] == [area("header", 1, 1, 2, 5), area("nav", 2, 1, 3, 2), area("main", 2, 3, 3, 4), area("aside", 2, 4, 3, 5), area("footer", 3, 1, 4, 5)], f"{b['areas']}"
    assert '"nav . main aside"' in one["css"] and '"header header header header"' in one["css"]
    three = api.applied(world.lid("L2"), {"kind": "add_track", "scope": 768, "axis": "column", "after": 3})["layout"]
    assert three["breakpoints"][0]["columns"] == ["200px", "1fr", "200px", "1fr"]
    assert '"header header header ."' in three["css"] and '"nav main aside ."' in three["css"], three["css"]
    mag = api.applied(world.lid("L3"), {"kind": "add_track", "scope": 1280, "axis": "row", "after": 1})["layout"]["breakpoints"][0]
    assert mag["rows"] == ["auto", "1fr", "1fr"]
    assert mag["areas"] == [area("lead", 1, 1, 4, 2), area("story-a", 1, 2, 2, 3), area("story-b", 1, 3, 2, 4), area("story-c", 3, 2, 4, 4)], f"{mag['areas']}"


def test_remove_track(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail"), spec("L2", ana, template="magazine-spread")])
    api = world.api(ana)
    out = api.applied(world.lid("L1"), {"kind": "remove_track", "scope": 768, "axis": "column", "index": 3})["layout"]
    assert out["breakpoints"][0]["areas"] == [area("header", 1, 1, 2, 3), area("nav", 2, 1, 3, 2), area("main", 2, 2, 3, 3), area("footer", 3, 1, 4, 3)]
    assert out["css"].endswith("@media (min-width: 768px) {\n  .layout {\n    grid-template-columns: 200px 1fr;\n    grid-template-rows: auto 1fr auto;\n"
                               "    grid-template-areas:\n      \"header header\"\n      \"nav main\"\n      \"footer footer\";\n  }\n  .aside { display: none; }\n}\n"), out["css"]
    api.refused(world.lid("L1"), {"kind": "remove_track", "scope": 768, "axis": "row", "index": PROBE_UNKNOWN_INDEX}, f"There is no row {PROBE_UNKNOWN_INDEX}.")
    with editor(browser, world, ana, "L2") as page:
        bp_tab(page, "Base").click()
        soon(page, lambda: expect(named_cell(page, 2, 1, "story-a")).to_have_count(1, timeout=POLL_MS), "Base scope shown")
        button(page, "Remove row 2").click()
        announce(page, "Row 2 removed. Area story-a removed. Area story-b removed.")
    stored = api.get_layout(world.lid("L2"))
    assert stored["rows"] == ["auto", "auto"] and stored["areas"] == [area("lead", 1, 1, 2, 3), area("story-c", 2, 1, 3, 3)], f"{stored['areas']}"


def test_track_count_and_gap_limits(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank"), spec("L2", ana, grid=fields(["1fr"], ["1fr"]))])
    lid, api = world.lid(), world.api(ana)
    for axis, word in (("column", "columns"), ("row", "rows")):
        for _ in range(MAX_TRACKS - 3):
            api.applied(lid, {"kind": "add_track", "scope": "base", "axis": axis, "after": 1})
        api.refused(lid, {"kind": "add_track", "scope": "base", "axis": axis, "after": 1}, f"A layout can have at most {MAX_TRACKS} {word}.")
    api.refused(world.lid("L2"), {"kind": "remove_track", "scope": "base", "axis": "column", "index": 1}, "A layout needs at least one column.")
    api.refused(world.lid("L2"), {"kind": "remove_track", "scope": "base", "axis": "row", "index": 1}, "A layout needs at least one row.")
    for row, col in ((GAP_MAX + 1, 16), (-1, 16), (16, GAP_MAX + 1)):
        api.refused(lid, {"kind": "set_gap", "scope": "base", "row": row, "column": col}, GAP_MSG)
    before = api.get_layout(lid)["revision"]
    api.applied(lid, {"kind": "set_gap", "scope": "base", "row": 0, "column": GAP_MAX})
    stored = api.get_layout(lid)
    assert stored["revision"] == before + 1 and stored["gap"] == {"row": 0, "column": GAP_MAX}
    assert len(stored["columns"]) == MAX_TRACKS and len(stored["rows"]) == MAX_TRACKS


PASTED_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-rows: auto 1fr;
  gap: 24px 16px;
  grid-template-areas:
    "header header"
    "main promo";
}
.header { grid-area: header; }
.main { grid-area: main; }
.promo { grid-area: promo; }
"""


def test_wf_css_roundtrip_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        box.fill(PASTED_CSS)
        button(page, "Apply CSS").click()
        announce(page, "CSS applied. Areas added: promo. Areas removed: nav, aside, footer.")
        soon(page, lambda: expect(named_cell(page, 2, 2, "promo")).to_have_count(1, timeout=POLL_MS), "grid shows promo")
        preview_shows(page, "promo")
        stored = api.get_layout(lid)
        assert stored["revision"] == 2 and shape(stored) == fields(["1fr", "300px"], ["auto", "1fr"], (24, 16), [area("header", 1, 1, 2, 3), area("main", 2, 1, 3, 2), area("promo", 2, 2, 3, 3)]), f"{shape(stored)}"
        box = code_box(page, "CSS")
        box.fill(PASTED_CSS)
        box.press("Control+Enter")
        announce(page, NO_CHANGES)
    assert api.get_layout(lid)["revision"] == 2, "re-applying equal CSS must create no revision (L688)"


def test_wf_css_roundtrip_line_error(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    typed = '.layout {\n  display: grid;\n  grid-template-columns: 10em 1fr;\n  grid-template-rows: auto;\n  grid-template-areas:\n    "header main";\n}\n'
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        box.fill(typed)
        button(page, "Apply CSS").click()
        soon(page, lambda: expect(edit_problem(page)).to_contain_text(f"Line 3: {SIZE_FORM_MSG}", timeout=POLL_MS), "line error shown (L670)")
        expect(box).to_have_value(typed)
        assert api.get_layout(lid)["revision"] == 1
        box.fill(typed.replace("10em", "200px"))
        button(page, "Apply CSS").click()
        announce(page, "CSS applied. Areas removed: nav, aside, footer.")
    stored = api.get_layout(lid)
    assert shape(stored) == fields(["200px", "1fr"], ["auto"], (0, 0), [area("header", 1, 1, 2, 2), area("main", 1, 2, 2, 3)]), f"{shape(stored)}"


def test_css_accepted(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("A", ana, template="holy-grail"), spec("B", ana, template="blank"), spec("C", ana, template="blank"), spec("D", ana, template="blank")])
    api = world.api(ana)
    a = api.applied(world.lid("A"), {"kind": "apply_css", "css": '/* imported */ .layout{grid-template-areas:"header main";gap:24px 16px;display:grid;}\n.header{grid-area:header;}\n.main  {  grid-area :  main ;  }\n'})["layout"]
    assert shape(a) == fields(["1fr", "1fr"], ["1fr"], (24, 16), [area("header", 1, 1, 2, 2), area("main", 1, 2, 2, 3)]), f"{shape(a)}"
    b = api.applied(world.lid("B"), {"kind": "apply_css", "css": ".layout {\n  row-gap: 0;\n  column-gap: 12px;\n  display: grid;\n  grid-template-rows: auto;\n  grid-template-columns: 200px 1fr;\n}\n"})["layout"]
    assert shape(b) == fields(["200px", "1fr"], ["auto"], (0, 12)), f"{shape(b)}"
    c_css = ('.layout {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  grid-template-rows: auto 1fr;\n  grid-template-areas:\n    "header header"\n    "main main";\n}\n'
             '.header { grid-area: header; }\n.main { grid-area: main; }\n.main { display: block; }\n'
             '@media (min-width: 768px) {\n  .layout {\n    grid-template-areas:\n      "header main"\n      "header main";\n  }\n}\n')
    c = api.applied(world.lid("C"), {"kind": "apply_css", "css": c_css})["layout"]
    assert shape(c) == fields(["1fr", "1fr"], ["auto", "1fr"], (0, 0), [area("header", 1, 1, 2, 3), area("main", 2, 1, 3, 3)],
                              [bp(768, ["1fr", "1fr"], ["auto", "1fr"], [area("header", 1, 1, 3, 2), area("main", 1, 2, 3, 3)])]), f"{shape(c)}"
    assert "display: block" not in c["css"], "display rules are recomputed (L661)"
    padding = CSS_LIMIT - len(BLANK_CSS) - 4
    at_limit = "/*" + "x" * padding + "*/" + BLANK_CSS
    r = api.change(world.lid("D"), {"kind": "apply_css", "css": at_limit})
    assert r.status_code == 200, f"20,000 characters are allowed (L657): {r.status_code} {r.text[:200]}"
    api.refused(world.lid("D"), {"kind": "apply_css", "css": at_limit + " "}, CSS_LONG_MSG)


def _css(*lines: str, newline: bool = True) -> str:
    return "\n".join(lines) + ("\n" if newline else "")


def _media_blocks(n: int) -> list[str]:
    out: list[str] = []
    for w in (600, 768, 1024, 1280, 1440)[:n]:
        out += [f"@media (min-width: {w}px) {{", "  .layout { grid-template-columns: 1fr; }", "}"]
    return out


CSS_ERRORS = {
    "unknown-property": (_css(".layout {", "  display: grid;", "  color: red;", "}"), "Line 3: unknown property color."),
    "track-form": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr 10em;", "}"), f"Line 3: {SIZE_FORM_MSG}"),
    "track-range": (_css(".layout {", "  display: grid;", "  grid-template-rows: 0fr;", "}"), f"Line 3: {SIZE_RANGE_MSG}"),
    "gap": (_css(".layout {", "  display: grid;", "  gap: 201px;", "}"), f"Line 3: {GAP_MSG}"),
    "row-cells": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr 1fr;", "  grid-template-rows: auto auto;", "  grid-template-areas:", '    "header header"', '    "main";', "}"),
                  "Line 7: every area row needs 2 cells."),
    "not-rectangle": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr 1fr;", "  grid-template-rows: auto auto;", "  grid-template-areas:", '    "main main"', '    "main nav";', "}"),
                      "Line 6: area main is not one rectangle."),
    "bad-name": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr;", "  grid-template-rows: auto;", "  grid-template-areas:", '    "Main";', "}"), f"Line 6: {AREA_NAME_MSG}"),
    "reserved": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr;", "  grid-template-rows: auto;", "  grid-template-areas:", '    "layout";', "}"), f"Line 6: {RESERVED_MSG}"),
    "orphan-rule": (_css(".layout {", "  display: grid;", "}", ".main { grid-area: main; }"), "Line 4: area main is not in any grid-template-areas."),
    "other-selector": (_css(".layout {", "  display: grid;", "}", "body { margin: 0; }"), "Line 4: only .layout and area rules are allowed."),
    "breakpoint-range": (_css(".layout {", "  display: grid;", "}", f"@media (min-width: {PROBE_LOW_BREAKPOINT}px) {{", "  .layout { grid-template-columns: 1fr; }", "}"), f"Line 4: {BREAKPOINT_RANGE_MSG}"),
    "breakpoint-duplicate": (_css(".layout {", "  display: grid;", "}", *_media_blocks(2), "@media (min-width: 768px) {", "  .layout { grid-template-columns: 1fr; }", "}"),
                             "Line 10: There is already a breakpoint at 768px."),
    "breakpoint-count": (_css(".layout {", "  display: grid;", "}", *_media_blocks(MAX_BREAKPOINTS + 1)), f"Line {4 + 3 * MAX_BREAKPOINTS}: A layout can have at most {MAX_BREAKPOINTS} breakpoints."),
    "column-count": (_css(".layout {", "  display: grid;", "  grid-template-columns: " + " ".join(["1fr"] * (MAX_TRACKS + 1)) + ";", "}"), f"Line 3: A layout can have at most {MAX_TRACKS} columns."),
    "no-display": (_css("/* imported */", ".layout {", "  grid-template-columns: 1fr;", "}"), "Line 2: .layout needs display: grid."),
    "missing-brace": (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr;", newline=False), "Line 3: missing }."),
    "first-by-line": (_css(".layout {", "  display: grid;", "  grid-template-rows: 10em;", "  color: red;", "}"), f"Line 3: {SIZE_FORM_MSG}"),
}


@pytest.mark.parametrize("case", list(CSS_ERRORS), ids=["unknown-property", "track-form", "track-range", "gap", "row-cells", "not-rectangle", "bad-name", "reserved", "orphan-rule", "other-selector", "breakpoint-range", "breakpoint-duplicate", "breakpoint-count", "column-count", "no-display", "missing-brace", "first-by-line"])
def test_css_errors(app_url: str, case: str) -> None:
    css, message = CSS_ERRORS[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    api.refused(lid, {"kind": "apply_css", "css": css}, message)
    stored = api.get_layout(lid)
    assert stored["revision"] == 1 and shape(stored) == HOLY_GRAIL, "a refused apply must change nothing (L668)"


def test_css_matching_unchanged(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec(t, ana, template=t) for t in ("blank", "holy-grail", "dashboard-shell", "magazine-spread")])
    api = world.api(ana)
    for ref in ("blank", "holy-grail", "dashboard-shell", "magazine-spread"):
        lid = world.lid(ref)
        css = api.get_layout(lid)["css"]
        for text in (css, "/* same */\n" + re.sub(r"\s+", " ", css)):
            r = api.change(lid, {"kind": "apply_css", "css": text})
            assert r.status_code == 200 and r.json().get("unchanged") is True and r.json().get("revision") == 1, f"{ref}: equal CSS must answer unchanged (L688): {r.text[:200]}"
    lid = world.lid("holy-grail")
    out = api.applied(lid, {"kind": "apply_css", "css": PASTED_CSS})
    assert out["revision"] == 2
    again = api.change(lid, {"kind": "apply_css", "css": api.get_layout(lid)["css"]})
    assert again.status_code == 200 and again.json().get("unchanged") is True and api.get_layout(lid)["revision"] == 2


BP_MAIN_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 16px;
}

.main { grid-area: main; }
.main { display: none; }

@media (min-width: 768px) {
  .layout {
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr 1fr;
    gap: 24px 16px;
    grid-template-areas:
      ". . ."
      "main main main"
      ". . .";
  }
  .main { display: block; }
}
"""


def test_wf_breakpoints_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        mark_page(page)
        button(page, "Add breakpoint").click()
        dlg = dialog(page, "Add breakpoint")
        dlg.get_by_role("textbox", name="Minimum width").fill("768")
        dlg.get_by_role("button", name="Add").click()
        announce(page, "Breakpoint From 768px added.")
        expect(bp_tab(page, "From 768px")).to_have_attribute("aria-selected", "true")
        cell(page, 2, 1).click()
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        _name_area(page, "main")
        announce(page, "Area main created.")
        enter(field(page, "Row gap"), "24")
        announce(page, "Row gap set to 24px.")
        code_equals(page, "CSS", BP_MAIN_CSS)
        s = slider(page)
        s.focus()
        page.keyboard.press("PageDown")
        expect(s).to_have_attribute("aria-valuetext", "768px")
        page.keyboard.press("ArrowLeft")
        announce(page, "Showing Base at 758px.")
        expect(bp_tab(page, "Base")).to_have_attribute("aria-selected", "true")
        expect(block(page, "main")).to_have_count(0)
        page.keyboard.press("ArrowRight")
        announce(page, "Showing From 768px at 768px.")
        expect(bp_tab(page, "From 768px")).to_have_attribute("aria-selected", "true")
        expect(block(page, "main")).to_have_attribute("data-row-start", "2")
        box = s.bounding_box()
        span = PREVIEW_MAX - PREVIEW_MIN
        thumb = box["x"] + (768 - PREVIEW_MIN) / span * box["width"]
        page.mouse.move(thumb, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + 1, box["y"] + box["height"] / 2, steps=8)
        page.mouse.up()
        soon(page, lambda: expect(bp_tab(page, "Base")).to_have_attribute("aria-selected", "true", timeout=POLL_MS), "dragging left selects Base (L289)")
        assert int((s.get_attribute("aria-valuetext") or "9999px")[:-2]) < 768
        still_same_page(page)
    stored = api.get_layout(lid)
    assert stored["css"] == BP_MAIN_CSS and stored["breakpoints"] == [bp(768, ["1fr"] * 3, ["1fr"] * 3, [area("main", 2, 1, 3, 4)], {"row": 24, "column": 16})], f"{stored['breakpoints']}"


def test_wf_breakpoints_refusals(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        button(page, "Add breakpoint").click()
        dlg = dialog(page, "Add breakpoint")
        width = dlg.get_by_role("textbox", name="Minimum width")
        for typed, message in ((str(PROBE_LOW_BREAKPOINT), BREAKPOINT_RANGE_MSG), ("768", "There is already a breakpoint at 768px.")):
            width.fill(typed)
            dlg.get_by_role("button", name="Add").click()
            _dialog_refusal(page, dlg, message)
        width.fill("1024")
        dlg.get_by_role("button", name="Add").click()
        announce(page, "Breakpoint From 1024px added.")
        assert [b["min_width"] for b in api.get_layout(lid)["breakpoints"]] == [768, 1024]
        bp_tab(page, "From 1024px").click()
        button(page, "Remove breakpoint").click()
        announce(page, "Breakpoint From 1024px removed.")
        bp_tab(page, "Base").click()
        expect(button(page, "Remove breakpoint")).to_be_disabled()
    assert [b["min_width"] for b in api.get_layout(lid)["breakpoints"]] == [768]


def test_wf_breakpoints_finger_slider(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    with editor(browser, world, ana, reduced_motion="reduce") as page:
        freeze(page)
        finger = Finger(page)
        box = slider(page).bounding_box()
        y = box["y"] + box["height"] / 2
        finger.down(box["x"] + (PREVIEW_START - PREVIEW_MIN) / (PREVIEW_MAX - PREVIEW_MIN) * box["width"], y)
        finger.move(box["x"] + 1, y)
        finger.up()
        announce(page, "Showing Base at ")
        expect(bp_tab(page, "Base")).to_have_attribute("aria-selected", "true")
        expect(block(page, "main")).to_have_attribute("data-row-start", "3")
        still(block(page, "main"), "reduced motion: blocks jump to their new cells (L335)")


def test_breakpoint_limits_and_inheritance(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    api.refused(lid, {"kind": "add_breakpoint", "min_width": NARROWEST_BREAKPOINT - 1}, BREAKPOINT_RANGE_MSG)
    api.refused(lid, {"kind": "add_breakpoint", "min_width": WIDEST_BREAKPOINT + 1}, BREAKPOINT_RANGE_MSG)
    api.refused(lid, {"kind": "add_breakpoint", "min_width": 768}, "There is already a breakpoint at 768px.")
    after = api.applied(lid, {"kind": "add_breakpoint", "min_width": 1024})["layout"]["breakpoints"]
    assert after[1] == bp(1024, ["200px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS), f"1024 copies the 768 grid: {after[1]}"
    after = api.applied(lid, {"kind": "add_breakpoint", "min_width": 600})["layout"]["breakpoints"]
    assert after[0] == bp(600, ["1fr"], ["auto", "auto", "1fr", "auto", "auto"], HG_BASE_AREAS), f"600 copies Base: {after[0]}"
    if MAX_BREAKPOINTS == 3:
        api.refused(lid, {"kind": "add_breakpoint", "min_width": WIDEST_BREAKPOINT}, f"A layout can have at most {MAX_BREAKPOINTS} breakpoints.")
    api.applied(lid, {"kind": "set_track", "scope": 768, "axis": "column", "index": 1, "size": "240px"})
    api.applied(lid, {"kind": "set_gap", "scope": "base", "row": 24, "column": 24})
    stored = api.get_layout(lid)
    assert stored["breakpoints"][2]["columns"] == ["200px", "1fr", "200px"] and all(b["gap"] is None for b in stored["breakpoints"]), f"{stored['breakpoints']}"
    assert stored["css"].count("gap:") == 1, "inherited gaps write no gap line (L627)"
    api.refused(lid, {"kind": "remove_breakpoint", "min_width": WIDEST_BREAKPOINT}, f"There is no breakpoint at {WIDEST_BREAKPOINT}px.")
    api.applied(lid, {"kind": "remove_breakpoint", "min_width": 600})
    api.applied(lid, {"kind": "add_breakpoint", "min_width": WIDEST_BREAKPOINT})
    api.applied(lid, {"kind": "remove_breakpoint", "min_width": WIDEST_BREAKPOINT})
    api.applied(lid, {"kind": "add_breakpoint", "min_width": NARROWEST_BREAKPOINT})
    own = api.applied(lid, {"kind": "set_gap", "scope": 1024, "row": 12, "column": 12})["layout"]["breakpoints"]
    assert own[-1]["gap"] == {"row": 12, "column": 12}, "setting a gap makes it the breakpoint's own (L593)"
    with editor(browser, world, ana) as page:
        bp_tab(page, "From 768px").click()
        soon(page, lambda: expect(page.get_by_text("inherited")).to_be_visible(timeout=POLL_MS), "inherited gap shown under the fields (L182)")
        expect(field(page, "Row gap")).to_have_value("24")


BREAKPOINT_CSS_CASES = {
    "hidden-area": (
        fields(["1fr"], ["auto", "auto", "1fr", "auto", "auto"], (16, 16), HG_BASE_AREAS,
               [bp(768, ["200px", "1fr"], ["auto", "1fr", "auto"], [area("header", 1, 1, 2, 3), area("nav", 2, 1, 3, 2), area("main", 2, 2, 3, 3), area("footer", 3, 1, 4, 3)])]),
        HOLY_GRAIL_BASE_CSS + "\n@media (min-width: 768px) {\n  .layout {\n    grid-template-columns: 200px 1fr;\n    grid-template-rows: auto 1fr auto;\n"
        "    grid-template-areas:\n      \"header header\"\n      \"nav main\"\n      \"footer footer\";\n  }\n  .aside { display: none; }\n}\n",
        HOLY_GRAIL_HTML,
    ),
    "show-and-inherit": (
        fields(["1fr"], ["auto", "1fr"], (16, 16), [area("header", 1, 1, 2, 2), area("main", 2, 1, 3, 2)],
               [bp(600, ["1fr"], ["auto", "1fr"], [area("header", 1, 1, 2, 2), area("main", 2, 1, 3, 2)], {"row": 24, "column": 24}),
                bp(1024, ["1fr", "300px"], ["auto", "1fr"], [area("header", 1, 1, 2, 3), area("main", 2, 1, 3, 2), area("promo", 2, 2, 3, 3)])]),
        ".layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto 1fr;\n  gap: 16px;\n  grid-template-areas:\n    \"header\"\n    \"main\";\n}\n\n"
        ".header { grid-area: header; }\n.main { grid-area: main; }\n.promo { grid-area: promo; }\n.promo { display: none; }\n\n"
        "@media (min-width: 600px) {\n  .layout {\n    grid-template-columns: 1fr;\n    grid-template-rows: auto 1fr;\n    gap: 24px;\n"
        "    grid-template-areas:\n      \"header\"\n      \"main\";\n  }\n}\n\n"
        "@media (min-width: 1024px) {\n  .layout {\n    grid-template-columns: 1fr 300px;\n    grid-template-rows: auto 1fr;\n"
        "    grid-template-areas:\n      \"header header\"\n      \"main promo\";\n  }\n  .promo { display: block; }\n}\n",
        '<div class="layout">\n  <div class="header">header</div>\n  <div class="main">main</div>\n  <div class="promo">promo</div>\n</div>\n',
    ),
    "areas-none": (
        fields(["1fr"], ["1fr"], (16, 16), [area("main", 1, 1, 2, 2)], [bp(768, ["1fr", "1fr"], ["1fr"], [])]),
        ".layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: 1fr;\n  gap: 16px;\n  grid-template-areas:\n    \"main\";\n}\n\n"
        ".main { grid-area: main; }\n\n@media (min-width: 768px) {\n  .layout {\n    grid-template-columns: 1fr 1fr;\n    grid-template-rows: 1fr;\n"
        "    grid-template-areas: none;\n  }\n  .main { display: none; }\n}\n",
        MAIN_HTML,
    ),
}


@pytest.mark.parametrize("case", list(BREAKPOINT_CSS_CASES), ids=["hidden-area", "show-and-inherit", "areas-none"])
def test_breakpoint_css(app_url: str, case: str) -> None:
    grid_fields, css, html = BREAKPOINT_CSS_CASES[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=grid_fields)])
    stored = world.api(ana).get_layout(world.lid())
    assert stored["css"] == css, f"css {stored['css']!r}; expected {css!r} (L625-653)"
    assert stored["html"] == html


def test_preview_width_keys(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    with editor(browser, world, ana) as page:
        s = slider(page)
        expect(s).to_have_attribute("aria-valuetext", f"{PREVIEW_START}px")
        s.focus()
        steps = [("PageUp", PREVIEW_MAX), ("PageUp", PREVIEW_MAX), ("PageDown", 768), ("PageDown", PREVIEW_MIN), ("ArrowRight", 330),
                 ("ArrowUp", 340), ("ArrowDown", 330), ("ArrowLeft", PREVIEW_MIN), ("ArrowLeft", PREVIEW_MIN), ("PageUp", 768), ("Home", PREVIEW_MIN)]
        for key, value in steps:
            page.keyboard.press(key)
            soon(page, lambda v=value: expect(s).to_have_attribute("aria-valuetext", f"{v}px", timeout=POLL_MS), f"{key} → {value}px (L281-285)")
        expect(bp_tab(page, "Base")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("End")
        announce(page, f"Showing From 768px at {PREVIEW_MAX}px.")
        expect(bp_tab(page, "From 768px")).to_have_attribute("aria-selected", "true")
        assert round(preview(page).evaluate("f => f.getBoundingClientRect().width")) == PREVIEW_MAX, "the frame keeps the preview width (L134)"
        bp_tab(page, "Base").click()
        soon(page, lambda: expect(s).to_have_attribute("aria-valuetext", f"{BASE_TAB_WIDTH}px", timeout=POLL_MS), "Base sets 375 (L291)")
        expect(colheader(page, 1)).to_have_attribute("data-resolved-px", str(BASE_TAB_WIDTH))
        bp_tab(page, "From 768px").click()
        soon(page, lambda: expect(s).to_have_attribute("aria-valuetext", "768px", timeout=POLL_MS), "From 768px sets 768")
        announce(page, "Showing From 768px at 768px.")
        assert round(preview(page).evaluate("f => f.getBoundingClientRect().width")) == 768


def test_breakpoint_fold_glide(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    grid_fields = fields(["1fr"], ["auto", "auto", "1fr", "auto"], (16, 16), [area("header", 1, 1, 2, 2), area("nav", 2, 1, 3, 2), area("main", 3, 1, 4, 2), area("footer", 4, 1, 5, 2)],
                         [bp(768, ["200px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS)])
    world = seed(base, [ana], [spec("L1", ana, grid=grid_fields)])
    with editor(browser, world, ana) as page:
        s = slider(page)
        s.focus()
        page.keyboard.press("PageDown")
        soon(page, lambda: expect(s).to_have_attribute("aria-valuetext", "768px", timeout=POLL_MS), "at 768")
        freeze(page)
        page.keyboard.press("ArrowLeft")
        expect(block(page, "aside")).to_have_count(0)
        expect(block(page, "main")).to_have_attribute("data-row-start", "3")
        expect(bp_tab(page, "Base")).to_have_attribute("aria-selected", "true")
        glide(block(page, "main"), FOLD_MIN_MS, FOLD_MAX_MS, "main glides to Base (L330)")
        settle_all(block(page, "main"))
        announce(page, "Showing Base at 758px.")
        page.keyboard.press("ArrowRight")
        expect(block(page, "aside")).to_have_count(1)
        still(block(page, "aside"), "aside appears at once (L331)")
        expect(block(page, "main")).to_have_attribute("data-row-start", "2")
        expect(bp_tab(page, "From 768px")).to_have_attribute("aria-selected", "true")
        settle_all(block(page, "main"))
        announce(page, "Showing From 768px at 768px.")


def test_wf_track_resize_keyboard(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        sep = separator(page, "Resize column 1")
        sep.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        grown = f"{200 + PX_STEP}px"
        soon(page, lambda: expect(sep).to_have_attribute("aria-valuetext", grown, timeout=POLL_MS), "column 1 one step up")
        expect(field(page, "Column 1 size")).to_have_value(grown)
        separator(page, "Resize column 2").focus()
        page.keyboard.press("ArrowRight")
        separator(page, "Resize row 2").focus()
        page.keyboard.press("ArrowDown")
        auto = separator(page, "Resize row 1")
        expect(auto).to_have_attribute("aria-disabled", "true")
        auto.focus()
        page.keyboard.press("ArrowDown")
    fr = f"{1 + FR_STEP:g}fr"
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] >= 6, "five separator steps stored")
    assert stored["revision"] == 6 and stored["columns"] == [grown, fr, "200px"] and stored["rows"] == ["auto", fr, "auto"], f"{stored['columns']} {stored['rows']}"


def test_wf_track_resize_mouse(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        posts = change_posts(page)
        x, y = center(separator(page, "Resize column 3"))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + DRAG_STEP_PX * 2 + 5, y, steps=6)
        size = f"{200 + 2 * PX_STEP}px"
        soon(page, lambda: expect(field(page, "Column 3 size")).to_have_value(size, timeout=POLL_MS), "size shown while dragging (L274)")
        expect(separator(page, "Resize column 3")).to_have_attribute("aria-valuetext", size)
        assert posts == [] and api.get_layout(lid)["revision"] == 1, "nothing is sent before release"
        page.mouse.up()
        stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "one change on release")
        assert stored["columns"][2] == size, f"{stored['columns']}"
        soon(page, lambda: _assert_eq(len(posts), 1, f"change requests sent on release {posts}"), "exactly one change is sent on release (L274)")


def test_wf_track_resize_finger(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        finger = Finger(page)
        x, y = center(separator(page, "Resize row 2"))
        finger.down(x, y)
        finger.move(x, y + DRAG_STEP_PX * 2 + 1)
        soon(page, lambda: expect(separator(page, "Resize row 2")).to_have_attribute("aria-valuetext", "1.5fr", timeout=POLL_MS), "size shown while dragging")
        finger.up()
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "one change after the finger drag")
    assert stored["rows"][1] == "1.5fr"


def test_separator_keys(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["4000px", "0.25fr", "100%", "minmax(100px, 1fr)"], ["auto"]))])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        posts = change_posts(page)
        plan = [("Resize column 1", ["ArrowRight", "ArrowDown", "ArrowLeft"], f"{4000 - PX_STEP}px"),
                ("Resize column 2", ["ArrowLeft", "ArrowUp", "ArrowRight"], f"{0.25 + FR_STEP:g}fr"),
                ("Resize column 3", ["ArrowRight", "ArrowLeft"], f"{100 - PCT_STEP}%")]
        for name, keys, final in plan:
            sep = separator(page, name)
            sep.focus()
            for key in keys:
                page.keyboard.press(key)
            soon(page, lambda s=sep, f=final: expect(s).to_have_attribute("aria-valuetext", f, timeout=POLL_MS), f"{name} shows {final}")
        for name in ("Resize column 4", "Resize row 1"):
            sep = separator(page, name)
            expect(sep).to_have_attribute("aria-disabled", "true")
            sep.focus()
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
        stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] >= 4, "three in-range steps stored")
        assert stored["revision"] == 4 and stored["columns"] == [f"{4000 - PX_STEP}px", "0.5fr", "99%", "minmax(100px, 1fr)"], f"{stored['columns']}"
        assert len(posts) == 3, f"out-of-range and disabled keys must send nothing (L273): {posts}"


def test_separator_drag(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["200px", "minmax(100px, 1fr)"], ["1fr"]))])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        posts = change_posts(page)
        x, y = center(separator(page, "Resize column 1"))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + DRAG_STEP_PX - 1, y, steps=4)
        page.mouse.up()
        x, y = center(separator(page, "Resize column 1"))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - DRAG_STEP_PX * 3, y, steps=6)
        shrunk = f"{200 - 3 * PX_STEP}px"
        soon(page, lambda: expect(field(page, "Column 1 size")).to_have_value(shrunk, timeout=POLL_MS), "three steps shown while dragging")
        page.mouse.up()
        x, y = point_of(separator(page, "Resize column 2"))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + DRAG_STEP_PX * 3, y, steps=6)
        page.mouse.up()
        stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] >= 2, "drag stored")
        assert stored["revision"] == 2 and stored["columns"] == [shrunk, "minmax(100px, 1fr)"] and len(posts) == 1, f"{stored['columns']} posts {posts}"


def test_wf_live_conflict_presence_and_live(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pa, [ana, bob])
        wait_designers(pb, [ana, bob])
        mark_page(pb)
        enter(field(pa, "Column 2 size"), "2fr")
        announce(pa, "Column 2 set to 2fr.")
        announce(pb, f"{ana}: Column 2 set to 2fr.", LIVE_S)
        expect(field(pb, "Column 2 size")).to_have_value("2fr")
        enter(field(pb, "Column gap"), "24")
        announce(pb, "Column gap set to 24px.")
        announce(pa, f"{bob}: Column gap set to 24px.", LIVE_S)
        still_same_page(pb)
    stored = api.get_layout(lid)
    assert stored["columns"][1] == "2fr" and stored["gap"] == {"row": 16, "column": 24} and stored["revision"] == 3


def test_wf_live_conflict_same_column(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pb, [ana, bob])
        with held(pb, CHANGES_GLOB) as gate:
            enter(field(pb, "Column 2 size"), "1.5fr")
            expect(save_state(pb)).to_contain_text(SAVING, timeout=UI_MS)
            enter(field(pa, "Column 2 size"), "2fr")
            announce(pa, "Column 2 set to 2fr.")
            api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "the founder's change arrived first")
            gate.release()
        expect(notice(pb)).to_contain_text(f"{ana} changed column 2 first. Your change was not applied.", timeout=UI_MS)
        soon(pb, lambda: expect(field(pb, "Column 2 size")).to_have_value("2fr", timeout=POLL_MS), "the guest shows the current layout from the 409")
    stored = api.get_layout(lid)
    assert stored["revision"] == 2 and stored["columns"][1] == "2fr", f"the refused change must not apply: {stored['columns']}"


def test_presence(browser: Browser, app_url: str, valkey: Any) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid = world.lid()
    key_a, key_b = f"presence:{lid}:{ana}", f"presence:{lid}:{bob}"
    with editor(browser, world, ana) as pa:
        with editor(browser, world, bob) as pb:
            wait_designers(pa, [ana, bob])
            wait_designers(pb, [ana, bob])
            api_until(lambda: valkey.ttl(key_b), lambda t: 1 <= t <= PRESENCE_SECONDS, f"{key_b} has an expiry within 1..PRESENCE_SECONDS (L782)")
            deadline = time.monotonic() + PRESENCE_SECONDS * 1.5
            while time.monotonic() < deadline:
                ttl = valkey.ttl(key_a)
                assert 1 <= ttl <= PRESENCE_SECONDS, f"{key_a} lapsed while the editor was open (ttl {ttl}); it must be renewed (L782)"
        wait_designers(pa, [ana], LIVE_S)
        api_until(lambda: valkey.ttl(key_b), lambda t: t == -2, f"{key_b} is deleted when the last connection closes (L783)", LIVE_S)


def test_live_delivery(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob], view_link=True)])
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb, opened(browser, base, world.layouts["L1"]["view_path"]) as pv:
        wait_designers(pa, [ana, bob])
        wait_designers(pb, [ana, bob])
        expect(grid(pv)).to_be_visible(timeout=UI_MS)
        wait_socket(pv)
        mark_page(pb)
        mark_page(pv)
        enter(field(pa, "Column 2 size"), "2fr")
        announce(pa, "Column 2 set to 2fr.")
        announce(pb, f"{ana}: Column 2 set to 2fr.", LIVE_S)
        announce(pv, "Layout updated.", LIVE_S)
        code_contains(pv, "CSS", "grid-template-columns: 1fr 2fr 1fr;")
        cell(pa, 1, 1).click()
        pa.keyboard.press("Shift+ArrowRight")
        _name_area(pa, "main")
        announce(pa, "Area main created.")
        announce(pb, f"{ana}: Area main created.", LIVE_S)
        expect(named_cell(pb, 1, 2, "main")).to_have_count(1)
        soon(pv, lambda: expect(named_cell(pv, 1, 1, "main")).to_have_count(1, timeout=POLL_MS), "view grid shows main", LIVE_S)
        still_same_page(pb)
        still_same_page(pv)


def test_server_order_and_conflicts(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    others = [name_for(p) for p in ("bob", "cara", "dan", "eve")]
    world = seed(base, [ana, *others], [spec("L1", ana, template="blank", collaborators=others)])
    lid, a = world.lid(), world.api(ana)
    barrier = threading.Barrier(3)

    def own(i: int) -> httpx.Response:
        barrier.wait()
        return a.change(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": i, "size": "2fr"}, 1)

    with ThreadPoolExecutor(3) as pool:
        mine = list(pool.map(own, (1, 2, 3)))
    assert sorted(r.json()["revision"] for r in mine) == [2, 3, 4], f"own changes apply in order with unique revisions: {[r.text[:80] for r in mine]}"
    sizes = ["1.5fr", "25%", "200px", "56px"]
    race = threading.Barrier(len(others))

    def claim(i: int) -> httpx.Response:
        race.wait()
        return world.api(others[i]).change(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 2, "size": sizes[i]}, 4)

    with ThreadPoolExecutor(len(others)) as pool:
        results = list(pool.map(claim, range(len(others))))
    winners = [i for i, r in enumerate(results) if r.status_code == 200]
    assert len(winners) == 1, f"exactly one simultaneous change wins (L724): {[r.status_code for r in results]}"
    for r in results:
        if r.status_code != 200:
            body = expect_error(r, 409, "conflict", None, "losing change")
            assert body["revision"] == 5 and body["layout"]["columns"][1] == sizes[winners[0]]
    stored = a.get_layout(lid)
    assert stored["revision"] == 5 and stored["columns"][1] == sizes[winners[0]]
    bob = world.api(others[0])
    assert bob.change(lid, {"kind": "set_gap", "scope": "base", "row": 24, "column": 16}, 4).status_code == 200, "a stale change on another target applies"
    a.applied(lid, {"kind": "add_track", "scope": "base", "axis": "row", "after": 1})
    expect_error(bob.change(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 3, "size": "2fr"}, 6), 409, "conflict", None, "change after a track add")
    expect_error(a.change(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 1, "size": "1fr"}, 2), 200 if False else 200, "", None, "") if False else None
    assert a.change(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 1, "size": "1fr"}, 2).status_code == 200, "own earlier changes never conflict (L730)"
    a.refused(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 1, "size": "2fr"}, UNKNOWN_BASE_MSG, a.get_layout(lid)["revision"] + 5)


def test_editor_notice(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, a = world.lid(), world.api(ana)
    text = f"{ana} changed column 2 first. Your change was not applied."
    with editor(browser, world, bob) as page:
        dismiss = button(page, "Dismiss notice")

        def provoke(typed: str, winner: str) -> None:
            with held(page, CHANGES_GLOB) as gate:
                enter(field(page, "Column 2 size"), typed)
                expect(save_state(page)).to_contain_text(SAVING, timeout=UI_MS)
                a.applied(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": 2, "size": winner})
                gate.release()

        freeze(page)
        provoke("1.5fr", "200px")
        expect(notice(page)).to_contain_text(text, timeout=UI_MS)
        start, end = glide(dismiss, NOTICE_MIN_MS, NOTICE_MAX_MS, "notice enters (L327)")
        assert start[1] < end[1], "the notice slides down into place"
        settle_all(dismiss)
        advance(page, NOTICE_STAY_MS - 1000)
        expect(notice(page)).to_contain_text(text)
        advance(page, 1000)
        soon(page, lambda: expect(dismiss).to_have_count(1, timeout=POLL_MS), "notice still in the DOM while leaving")
        s0, s1 = glide(dismiss, NOTICE_MIN_MS, NOTICE_MAX_MS, "notice leaves (L327)")
        assert s1[1] < s0[1], "the notice slides up and away"
        settle_all(dismiss)
        soon(page, lambda: expect(dismiss).to_have_count(0, timeout=POLL_MS), "notice removed after 8 s")
        provoke("25%", "56px")
        expect(notice(page)).to_contain_text(text, timeout=UI_MS)
        settle_all(dismiss)
        dismiss.click()
        settle_all(dismiss)
        soon(page, lambda: expect(page.get_by_text(text)).to_have_count(0, timeout=POLL_MS), "Dismiss notice ends it early", NOTICE_STAY_MS / 4000)


RESTORE_SHAPE = fields(["1fr", "1fr"], ["auto", "auto", "auto"], (24, 16), MAG_BASE_AREAS,
                       [bp(600, ["1fr", "1fr"], ["auto", "auto", "auto"], MAG_BASE_AREAS, {"row": 24, "column": 24}), bp(1280, ["2fr", "1fr", "1fr"], ["auto", "1fr"], MAG_BP_AREAS)])
BLANK_TO_HOLY = ["Columns: 1fr 1fr 1fr → 1fr", "Rows: 1fr 1fr 1fr → auto auto 1fr auto auto", "Area aside added: 4 / 1 / 5 / 2", "Area footer added: 5 / 1 / 6 / 2",
                 "Area header added: 1 / 1 / 2 / 2", "Area main added: 3 / 1 / 4 / 2", "Area nav added: 2 / 1 / 3 / 2", "Breakpoint From 768px added"]


def test_wf_versions_restore(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    versions = [{"name": VERSION_NAME, "template": "blank"}, {"name": VERSION_NAME, "template": "holy-grail"}, {"name": VERSION_NAME, **RESTORE_SHAPE}]
    world = seed(base, [ana, bob], [spec("L1", ana, template="holy-grail", versions=versions, collaborators=[bob])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pb, [ana, bob])
        button(pa, "Versions").click()
        drawer = drawer_on_screen(pa)
        saved = drawer.get_by_role("list", name="Saved versions").get_by_role("listitem")
        expect(saved).to_have_count(3, timeout=UI_MS)
        for n in (1, 2, 3):
            expect(saved.nth(n - 1)).to_contain_text(f"Version {n}: {VERSION_NAME}")
        from conftest import select
        select(drawer.get_by_role("combobox", name="Compare from"), f"Version 1: {VERSION_NAME}")
        select(drawer.get_by_role("combobox", name="Compare to"), f"Version 2: {VERSION_NAME}")
        drawer.get_by_role("button", name="Compare").click()
        diff = drawer.get_by_role("list", name="Differences").get_by_role("listitem")
        expect(diff).to_have_text(BLANK_TO_HOLY, timeout=UI_MS)
        drawer.get_by_role("button", name="Restore version 3").click()
        confirm = dialog(pa, "Restore version 3?")
        confirm.get_by_role("button", name="Restore").click()
        announce(pa, "Restored version 3.")
        expect(drawer).to_be_visible()
        expect(saved.nth(3)).to_contain_text(f"Version {4}: " + "Restored from version 3", timeout=UI_MS)
        expect(notice(pb)).to_contain_text(f"{ana} restored version 3.", timeout=UI_MS)
        soon(pb, lambda: expect(named_cell(pb, 1, 1, "lead")).to_have_count(1, timeout=POLL_MS), "guest shows the restored grid", LIVE_S)
    stored = api.get_layout(lid)
    assert stored["revision"] == 2 and shape(stored) == RESTORE_SHAPE, f"restore must be exact (L757): {shape(stored)}"
    listed = api.call("GET", f"/api/layouts/{lid}/versions").json()["versions"]
    assert [(v["number"], v["name"]) for v in listed] == [(1, VERSION_NAME), (2, VERSION_NAME), (3, VERSION_NAME), (4, "Restored from version 3")]


def test_wf_versions_save(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        button(page, "Save version").click()
        dlg = dialog(page, "Save version")
        dlg.get_by_role("button", name="Save").click()
        _dialog_refusal(page, dlg, VERSION_NAME_MSG)
        dlg.get_by_role("textbox", name="Version name").fill(VERSION_NAME)
        dlg.get_by_role("button", name="Save").click()
        announce(page, "Version 1 saved.")
        button(page, "Versions").click()
        expect(dialog(page, "Versions").get_by_role("list", name="Saved versions").get_by_role("listitem")).to_have_text([re.compile(f"Version 1: {VERSION_NAME}")], timeout=UI_MS)
    assert api.get_layout(lid)["revision"] == 1
    v = api.call("GET", f"/api/layouts/{lid}/versions/1").json()
    assert v["name"] == VERSION_NAME and shape(v["layout"]) == HOLY_GRAIL


def test_versions_save_and_drawer(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    for bad in ("", "x" * 61):
        expect_error(api.call("POST", f"/api/layouts/{lid}/versions", {"name": bad}), 422, "invalid", VERSION_NAME_MSG, f"version name of {len(bad)}")
    r = api.call("POST", f"/api/layouts/{lid}/versions", {"name": "x" * 60})
    assert r.status_code == 201 and r.json()["number"] == 1
    api.applied(lid, {"kind": "set_gap", "scope": "base", "row": 24, "column": 16})
    r = api.call("POST", f"/api/layouts/{lid}/versions", {"name": VERSION_NAME})
    assert r.status_code == 201 and r.json() == {"number": 2, "name": VERSION_NAME} or (r.json()["number"] == 2 and r.json()["name"] == VERSION_NAME)
    assert api.get_layout(lid)["revision"] == 2, "saving a version does not change the revision (L719)"
    listed = api.call("GET", f"/api/layouts/{lid}/versions").json()["versions"]
    assert [v["number"] for v in listed] == [1, 2]
    v1 = api.call("GET", f"/api/layouts/{lid}/versions/1").json()
    assert v1["layout"]["revision"] == 1 and shape(v1["layout"]) == HOLY_GRAIL
    expect_error(api.call("GET", f"/api/layouts/{lid}/versions/{PROBE_UNKNOWN_VERSION}"), 404, "not_found", None, "unknown version")
    with editor(browser, world, ana) as page:
        freeze(page)
        button(page, "Versions").click()
        drawer = dialog(page, "Versions")
        expect(drawer).to_have_count(1, timeout=UI_MS)
        start, end = glide(drawer, DRAWER_MIN_MS, DRAWER_MAX_MS, "drawer opens (L326)")
        assert start[0] > end[0], "the drawer slides in from the right"
        settle_all(drawer)
        page.keyboard.press("Escape")
        s0, s1 = glide(drawer, DRAWER_MIN_MS, DRAWER_MAX_MS, "drawer closes (L326)")
        assert s1[0] > s0[0], "the drawer slides back out to the right"
        settle_all(drawer)


def test_version_differences(app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    gap_and_track = fields(["1fr"], ["auto", "auto", "1fr", "auto", "auto"], (24, 16), HG_BASE_AREAS, [bp(768, ["240px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS)])
    own_gap = fields(["1fr"], ["auto", "auto", "1fr", "auto", "auto"], (16, 16), HG_BASE_AREAS, [bp(768, ["200px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS, {"row": 24, "column": 24})])
    versions = [{"name": VERSION_NAME, "template": "blank"}, {"name": VERSION_NAME, "template": "holy-grail"}, {"name": VERSION_NAME, **gap_and_track}, {"name": VERSION_NAME, **own_gap}]
    world = seed(base, [ana], [spec("L1", ana, template="blank", versions=versions)])
    lid, api = world.lid(), world.api(ana)

    def diff(a: int, b: int) -> list[str]:
        r = api.call("GET", f"/api/layouts/{lid}/compare?from={a}&to={b}")
        assert r.status_code == 200, f"compare {a}→{b} answered {r.status_code}"
        return r.json()["differences"]

    assert diff(1, 2) == BLANK_TO_HOLY
    assert diff(2, 3) == ["Gap: 16px → 24px 16px", "From 768px Columns: 200px 1fr 200px → 240px 1fr 200px"]
    assert diff(2, 4) == ["From 768px Gap: inherited → 24px"]
    assert diff(2, 1) == ["Columns: 1fr → 1fr 1fr 1fr", "Rows: auto auto 1fr auto auto → 1fr 1fr 1fr", "Area aside removed", "Area footer removed",
                          "Area header removed", "Area main removed", "Area nav removed", "Breakpoint From 768px removed"]
    assert diff(2, 2) == ["No differences."]
    expect_error(api.call("GET", f"/api/layouts/{lid}/compare?from=1&to={PROBE_UNKNOWN_VERSION}"), 404, "not_found", None, "compare with an unknown version")


def test_exact_restore(app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", versions=[{"name": VERSION_NAME, "template": "holy-grail"}, {"name": VERSION_NAME, **RESTORE_SHAPE}], collaborators=[bob])])
    lid, a, b = world.lid(), world.api(ana), world.api(bob)
    v1_before = a.call("GET", f"/api/layouts/{lid}/versions/1").json()
    a.applied(lid, {"kind": "set_gap", "scope": "base", "row": 0, "column": 0})
    out = a.applied(lid, {"kind": "restore_version", "number": 2}, 2)
    assert out["revision"] == 3 and shape(out["layout"]) == RESTORE_SHAPE, f"{shape(out['layout'])}"
    listed = a.call("GET", f"/api/layouts/{lid}/versions").json()["versions"]
    assert [(v["number"], v["name"]) for v in listed] == [(1, VERSION_NAME), (2, VERSION_NAME), (3, "Restored from version 2")]
    assert shape(a.call("GET", f"/api/layouts/{lid}/versions/3").json()["layout"]) == RESTORE_SHAPE
    assert a.call("GET", f"/api/layouts/{lid}/versions/1").json() == v1_before, "earlier versions never change (L760)"
    body = expect_error(b.change(lid, {"kind": "set_track", "scope": "base", "axis": "row", "index": 1, "size": "1fr"}, 2), 409, "conflict", None, "stale collaborator change after restore")
    assert body["revision"] == 3 and shape(body["layout"]) == RESTORE_SHAPE
    a.refused(lid, {"kind": "restore_version", "number": PROBE_UNKNOWN_VERSION}, f"There is no version {PROBE_UNKNOWN_VERSION}.")


def _path_in(box: Locator, kind: str) -> str:
    m = re.search(rf"/{kind}/[^\s?#\"']+", box.input_value())
    assert m, f"{kind} link field holds {box.input_value()!r}"
    return m.group(0)


def test_wf_view_link_developer(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    title = api.get_layout(lid)["name"]
    with editor(browser, world, ana) as pa:
        button(pa, "Share").click()
        share = dialog(pa, "Share")
        share.get_by_role("button", name="Create view link").click()
        announce(pa, "View link created.")
        first = _path_in(share.get_by_role("textbox", name="View link"), "view")
        page.keyboard if False else None
        pa.keyboard.press("Escape")
        with opened(browser, base, first) as dev:
            expect(dev.get_by_role("heading", name=title)).to_be_visible(timeout=UI_MS)
            code_equals(dev, "CSS", HOLY_GRAIL_CSS)
            slider(dev).focus()
            dev.keyboard.press("Home")
            soon(dev, lambda: expect(bp_tab(dev, "Base")).to_have_attribute("aria-selected", "true", timeout=POLL_MS), "Home selects Base")
            dev.keyboard.press("End")
            soon(dev, lambda: expect(bp_tab(dev, "From 768px")).to_have_attribute("aria-selected", "true", timeout=POLL_MS), "End selects From 768px")
            wait_socket(dev)
            enter(field(pa, "Column 2 size"), "2fr")
            announce(pa, "Column 2 set to 2fr.")
            announce(dev, "Layout updated.", LIVE_S)
            code_contains(dev, "CSS", "grid-template-columns: 200px 2fr 200px;")
            button(pa, "Share").click()
            share.get_by_role("button", name="Regenerate view link").click()
            announce(pa, "View link regenerated.")
            soon(pa, lambda: _assert_eq(_path_in(share.get_by_role("textbox", name="View link"), "view") != first, True, "new view link"), "view link replaced")
            second = _path_in(share.get_by_role("textbox", name="View link"), "view")
            dev.reload()
            expect(dev.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
            expect(dev.get_by_role("link", name="Sign in")).to_be_visible()
            dev.goto(base + second)
            expect(dev.get_by_role("heading", name=title)).to_be_visible(timeout=UI_MS)
            share.get_by_role("button", name="Revoke view link").click()
            announce(pa, "View link revoked.")
            dev.reload()
            expect(dev.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
    for path in (first, second):
        expect_error(Api(base).call("GET", f"/api/view/{token_of(path)}"), 404, "not_found", None, f"old view link {path}")


def test_wf_view_link_join(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, guest = name_for("ana"), name_for("bob")
    world = seed(base, [ana, guest], [spec("L1", ana, template="blank")])
    lid, a = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa:
        button(pa, "Share").click()
        share = dialog(pa, "Share")
        join = _path_in(share.get_by_role("textbox", name="Co-edit link"), "join")
        with opened(browser, base, join) as pg:
            pg.wait_for_url(re.compile(r"/signin\?"), timeout=UI_MS)
            assert parse_qs(urlparse(pg.url).query).get("next") == [join]
            field(pg, "Username").fill(guest)
            pg.get_by_label("Password", exact=True).fill(PASSWORD)
            button(pg, "Sign in").click()
            pg.wait_for_url(re.compile(rf"/layouts/{re.escape(lid)}$"), timeout=UI_MS)
            guest_api = Api(base, browser_cookie(pg))
            assert a.call("GET", f"/api/layouts/{lid}/share").json()["collaborators"] == [guest]
            pa.keyboard.press("Escape")
            button(pa, "Share").click()
            share.get_by_role("list", name="Collaborators").get_by_role("button", name=f"Remove {guest}").click()
            announce(pa, f"{guest} removed from collaborators.")
            expect_error(guest_api.call("GET", f"/api/layouts/{lid}"), 404, "not_found", None, "removed collaborator")
            assert lid not in [x["id"] for x in guest_api.call("GET", "/api/layouts").json()["layouts"]]
            share.get_by_role("button", name="Regenerate co-edit link").click()
            announce(pa, "Co-edit link regenerated.")
            pg.goto(base + join)
            expect(pg.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
            expect(pg.get_by_role("link", name="Your layouts")).to_be_visible()
    assert a.call("GET", f"/api/layouts/{lid}/share").json()["collaborators"] == []


def test_read_only_view(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", view_link=True)])
    lid, api = world.lid(), world.api(ana)
    token = token_of(world.layouts["L1"]["view_path"])
    with opened(browser, base, world.layouts["L1"]["view_path"]) as page:
        expect(grid(page)).to_be_visible(timeout=UI_MS)
        expect(updates(page)).to_have_count(1)
        for name in ("Add column", "Add row", "Apply CSS", "Save version", "Share", "Versions", "Add breakpoint", "Remove breakpoint", "Remove column 1"):
            expect(button(page, name)).to_have_count(0)
        expect(page.get_by_role("separator")).to_have_count(0)
        expect(field(page, "Column 1 size")).to_have_count(0)
        expect(designers(page)).to_have_count(0)
        expect(code_box(page, "CSS")).not_to_be_editable()
        expect(code_box(page, "HTML")).not_to_be_editable()
        cell(page, 1, 1).focus()
        page.keyboard.press("ArrowRight")
        expect(cell(page, 1, 2)).to_be_focused()
        for key in ("Enter", "Delete", "Backspace", "c", "Shift+C", "r", "Control+z"):
            page.keyboard.press(key)
        mouse_drag(page, cell(page, 1, 1), cell(page, 2, 2))
        expect(page.get_by_role("dialog")).to_have_count(0)
        page.set_viewport_size(PHONE)
        for name in ("Grid", "Preview", "Code"):
            expect(page.get_by_role("tab", name=name, exact=True)).to_have_count(1)
        expect(page.get_by_role("tab", name="Tracks", exact=True)).to_have_count(0)
    anon = Api(base)
    expect_error(anon.call("POST", f"/api/layouts/{lid}/changes", {"base_revision": 1, "change": {"kind": "add_track", "scope": "base", "axis": "row", "after": 1}}), 401, "sign_in_required", None, "change without a session")
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        r = anon.call(method, f"/api/view/{token}", {"kind": "add_track"})
        assert r.status_code >= 400 and r.status_code != 403, f"{method} through a view link answered {r.status_code}"
    view = anon.call("GET", f"/api/view/{token}").json()
    assert view["role"] == "viewer" and api.get_layout(lid)["revision"] == 1, "nothing through the view link may change the layout"


def test_link_lifecycle(app_url: str) -> None:
    base = root(app_url)
    ana, bob, cara = name_for("ana"), name_for("bob"), name_for("cara")
    world = seed(base, [ana, bob, cara], [spec("L1", ana, template="blank")])
    lid, a, b, c = world.lid(), world.api(ana), world.api(bob), world.api(cara)
    anon = Api(base)
    share = a.call("GET", f"/api/layouts/{lid}/share").json()
    assert share["view_path"] is None and share["join_path"].startswith("/join/") and share["collaborators"] == []
    expect_error(a.call("DELETE", f"/api/layouts/{lid}/view-link"), 409, "no_view_link", None, "revoke with none")
    paths = []
    for _ in range(2):
        r = a.call("POST", f"/api/layouts/{lid}/view-link")
        assert r.status_code == 201
        paths.append(r.json()["view_path"])
    assert paths[0] != paths[1] and all(len(token_of(p)) >= TOKEN_MIN_CHARS for p in paths)
    expect_error(anon.call("GET", f"/api/view/{token_of(paths[0])}"), 404, "not_found", None, "replaced view link")
    assert anon.call("GET", f"/api/view/{token_of(paths[1])}").status_code == 200
    assert a.call("DELETE", f"/api/layouts/{lid}/view-link").status_code == 204
    expect_error(anon.call("GET", f"/api/view/{token_of(paths[1])}"), 404, "not_found", None, "revoked view link")
    expect_error(a.call("DELETE", f"/api/layouts/{lid}/view-link"), 409, "no_view_link", None, "revoke twice")
    again = a.call("POST", f"/api/layouts/{lid}/view-link").json()["view_path"]
    assert anon.call("GET", f"/api/view/{token_of(again)}").status_code == 200, "a revoked link can be followed by a new one"
    old_join = token_of(share["join_path"])
    assert b.call("POST", f"/api/join/{old_join}").json()["layout_id"] == lid
    assert a.call("POST", f"/api/join/{old_join}").status_code == 200
    assert c.call("POST", f"/api/join/{old_join}").status_code == 200
    assert a.call("GET", f"/api/layouts/{lid}/share").json()["collaborators"] == sorted([bob, cara])
    expect_error(c.call("GET", f"/api/layouts/{lid}/share"), 404, "not_found", None, "share by a collaborator")
    new_join = token_of(a.call("POST", f"/api/layouts/{lid}/join-link").json()["join_path"])
    expect_error(b.call("POST", f"/api/join/{old_join}"), 404, "not_found", None, "replaced co-edit link")
    assert a.call("DELETE", f"/api/layouts/{lid}/collaborators/{bob}").status_code == 204
    expect_error(b.call("GET", f"/api/layouts/{lid}"), 404, "not_found", None, "removed collaborator")
    assert lid not in [x["id"] for x in b.call("GET", "/api/layouts").json()["layouts"]]
    expect_error(a.call("DELETE", f"/api/layouts/{lid}/collaborators/{bob}"), 404, "not_found", None, "remove a non-collaborator")
    assert b.call("POST", f"/api/join/{new_join}").status_code == 200
    assert bob in a.call("GET", f"/api/layouts/{lid}/share").json()["collaborators"]
    assert a.get_layout(lid)["revision"] == 1, "link and collaborator actions keep the revision (L719)"


def test_errors_and_limits(app_url: str) -> None:
    base = root(app_url)
    ana, bob, cara = name_for("ana"), name_for("bob"), name_for("cara")
    world = seed(base, [ana, bob, cara], [spec("L1", ana, template="blank", collaborators=[cara])])
    lid, a, b, c, anon = world.lid(), world.api(ana), world.api(bob), world.api(cara), Api(base)
    expect_error(anon.call("POST", "/api/layouts", content="x" * (BODY_LIMIT + 1)), 413, "too_large", None, "oversize body without a session")
    prefix = '{"name":"' + name_for("layout") + '","template":"blank"'
    exact = prefix + " " * (BODY_LIMIT - len(prefix) - 1) + "}"
    assert len(exact.encode()) == BODY_LIMIT
    assert a.call("POST", "/api/layouts", content=exact).status_code == 201, "exactly 65,536 bytes is allowed (L394)"
    expect_error(a.call("POST", "/api/layouts", content=exact + " "), 413, "too_large", None, "65,537 bytes")
    expect_error(anon.call("POST", f"/api/layouts/{lid}/changes", content="{"), 401, "sign_in_required", None, "invalid JSON without a session")
    expect_error(a.call("POST", "/api/layouts/unknown-layout/changes", content="{"), 404, "not_found", None, "invalid JSON to an unknown layout")
    expect_error(a.call("POST", f"/api/layouts/{lid}/changes", content="{"), 422, "invalid", INVALID_BODY_MSG, "invalid JSON")
    expect_error(a.call("POST", "/api/layouts", {"name": 5}), 422, "invalid", INVALID_BODY_MSG, "wrong field type")
    statuses = []
    for r in (b.call("GET", f"/api/layouts/{lid}"), b.change(lid, {"kind": "undo"}, 1), b.call("GET", f"/api/layouts/{lid}/versions"),
              c.call("GET", f"/api/layouts/{lid}/share"), c.call("POST", f"/api/layouts/{lid}/view-link"), a.call("GET", "/api/nothing-here")):
        statuses.append(r.status_code)
        expect_error(r, 404, "not_found", None, "hidden resource")
    a.refused(lid, {"kind": PROBE_UNKNOWN_KIND}, UNKNOWN_CHANGE_MSG)
    a.refused(lid, {"kind": "add_track", "scope": WIDEST_BREAKPOINT, "axis": "row", "after": 1}, f"There is no breakpoint at {WIDEST_BREAKPOINT}px.")
    a.refused(lid, {"kind": "set_track", "scope": "base", "axis": "column", "index": PROBE_UNKNOWN_INDEX, "size": "1fr"}, f"There is no column {PROBE_UNKNOWN_INDEX}.")
    assert 403 not in statuses
    h = httpx.get(base + "/api/health", headers={"Origin": PROBE_FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert not any(k.lower().startswith("access-control-allow") for k in h.headers), f"no cross-origin headers (L407): {dict(h.headers)}"
    for path in PROBE_SOURCE_PATHS:
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, f"{path} must answer 404 (L967)"
    index = httpx.get(base + "/signin", timeout=HTTP_TIMEOUT_S).text
    secrets = [GRADING_KEY]
    password = urlparse(os.environ.get("DATABASE_URL", "")).password
    if password:
        secrets.append(password)
    bodies = [index] + [httpx.get(base + p, timeout=HTTP_TIMEOUT_S).text for p in re.findall(r'(?:src|href)="(/[^"]+)"', index)[:30]]
    for s in secrets:
        assert not any(s in body for body in bodies), "a credential reached the browser (L967)"


def test_wf_phone_editing_happy(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="dashboard-shell")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana, viewport=PHONE, reduced_motion="reduce") as page:
        finger = Finger(page)
        panes = page.get_by_role("tablist", name="Editor panes")
        tap(panes.get_by_role("tab", name="Tracks", exact=True))
        expect(button(page, "Add row")).to_be_visible(timeout=UI_MS)
        tap(button(page, "Add row"))
        announce(page, "Row added after row ")
        scope = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "Add row stored")["breakpoints"][0]
        used = {r for a in scope["areas"] for r in range(a["row_start"], a["row_end"])}
        empty_row = next(r for r in range(1, len(scope["rows"]) + 1) if r not in used)
        tap(panes.get_by_role("tab", name="Grid", exact=True))
        expect(grid(page)).to_be_visible(timeout=UI_MS)
        tap(cell(page, empty_row, 1))
        expect(cell(page, empty_row, 1)).to_be_focused()
        x0, y0 = center(cell(page, empty_row, 1))
        x1, y1 = center(cell(page, empty_row, 2))
        finger.down(x0, y0)
        finger.move(x1, y1)
        finger.up()
        box = dialog(page, "Name area").get_by_role("textbox", name="Area name")
        expect(box).to_be_visible(timeout=UI_MS)
        enter(box, "promo")
        announce(page, "Area promo created.")
        tap(panes.get_by_role("tab", name="Code", exact=True))
        code_contains(page, "CSS", ".promo { grid-area: promo; }")
    stored = api.get_layout(lid)["breakpoints"][0]["areas"]
    assert area("promo", empty_row, 1, empty_row + 1, 3) in stored, f"{stored}"


def test_wf_phone_editing_panes(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="dashboard-shell")])
    with editor(browser, world, ana, viewport=PHONE) as page:
        panes = page.get_by_role("tablist", name="Editor panes")
        checks = {"Grid": grid(page), "Tracks": button(page, "Add column"), "Preview": slider(page), "Code": field(page, "Layout CSS")}
        for name, shown in checks.items():
            tap(panes.get_by_role("tab", name=name, exact=True))
            expect(shown).to_be_visible(timeout=UI_MS)
            for other, hidden in checks.items():
                if other != name:
                    expect(hidden).to_be_hidden()
        tap(panes.get_by_role("tab", name="Grid", exact=True))
        panes.get_by_role("tab", name="Grid", exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(panes.get_by_role("tab", name="Tracks", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(panes.get_by_role("tab", name="Tracks", exact=True)).to_have_attribute("aria-selected", "true")
        tap(panes.get_by_role("tab", name="Grid", exact=True))
        before = page.evaluate("() => [window.scrollX, window.scrollY]")
        finger = Finger(page)
        x0, y0 = center(cell(page, 1, 1))
        x1, y1 = center(cell(page, 2, 2))
        finger.down(x0, y0)
        finger.move(x1, y1)
        assert page.evaluate("() => [window.scrollX, window.scrollY]") == before, "a finger drag on the grid must not scroll the page (L254)"
        finger.up()
        page.keyboard.press("Escape")
        no_page_overflow(page)
    assert world.api(ana).get_layout(world.lid())["revision"] == 1


EDITOR_WIDTHS = {"desktop-1280x800": DESKTOP, "tablet-768x1024": TABLET, "phone-375x812": PHONE}


@pytest.mark.parametrize("case", list(EDITOR_WIDTHS), ids=["desktop-1280x800", "tablet-768x1024", "phone-375x812"])
def test_editor_widths(browser: Browser, app_url: str, case: str) -> None:
    viewport = EDITOR_WIDTHS[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    with editor(browser, world, ana, viewport=viewport) as page:
        no_page_overflow(page)
        panes = page.get_by_role("tablist", name="Editor panes")
        if viewport is PHONE:
            expect(panes).to_be_visible()
            for name in ("Grid", "Tracks", "Preview", "Code"):
                expect(panes.get_by_role("tab", name=name, exact=True)).to_have_count(1)
            tap(panes.get_by_role("tab", name="Grid", exact=True))
        else:
            expect(panes).to_be_hidden()
            rail, canvas, side = button(page, "Add column").bounding_box(), grid(page).bounding_box(), slider(page).bounding_box()
            assert rail["x"] < canvas["x"], "rail sits left of the canvas"
            if viewport is DESKTOP:
                assert side["x"] > canvas["x"] and side["y"] < canvas["y"] + canvas["height"], "preview sits beside the canvas at 1280"
            else:
                assert side["y"] >= canvas["y"] + canvas["height"] - 1, "preview stacks below at 768"
        targets = [grid(page).get_by_role("gridcell"), page.get_by_role("separator"), page.get_by_role("button")]
        for group in targets:
            for i in range(group.count()):
                item = group.nth(i)
                if item.is_visible():
                    box = item.bounding_box()
                    assert box["width"] >= TOUCH_TARGET_PX - 0.5 and box["height"] >= TOUCH_TARGET_PX - 0.5, f"target {i} is {box} (L318)"


TEMPLATE_CASES = {
    "blank": ("Blank", BLANK, BLANK_CSS, BLANK_HTML),
    "holy-grail": ("Holy Grail", HOLY_GRAIL, HOLY_GRAIL_CSS, HOLY_GRAIL_HTML),
    "dashboard-shell": ("Dashboard Shell", DASHBOARD, DASHBOARD_CSS, DASHBOARD_HTML),
    "magazine-spread": ("Magazine Spread", MAGAZINE, MAGAZINE_CSS, MAGAZINE_HTML),
}


@pytest.mark.parametrize("case", list(TEMPLATE_CASES), ids=["blank", "holy-grail", "dashboard-shell", "magazine-spread"])
def test_starter_templates(browser: Browser, app_url: str, case: str) -> None:
    label, grid_fields, css, html = TEMPLATE_CASES[case]
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana])
    with opened(browser, base, "/", world.sessions[ana]) as page:
        button(page, "New layout").click()
        dlg = dialog(page, "New layout")
        dlg.get_by_role("textbox", name="Layout name").fill(name_for("layout"))
        dlg.get_by_role("radio", name=label).check()
        dlg.get_by_role("button", name="Create layout").click()
        page.wait_for_url(re.compile(r"/layouts/[^/?#]+$"), timeout=UI_MS)
        lid = urlparse(page.url).path.split("/layouts/")[1]
        ready(page)
        code_equals(page, "CSS", css)
    api = world.api(ana)
    stored = api.get_layout(lid)
    assert stored["revision"] == 1 and stored["role"] == "owner" and shape(stored) == grid_fields, f"{shape(stored)}"
    assert stored["css"] == css and stored["html"] == html
    assert api.call("GET", f"/api/layouts/{lid}/versions").json()["versions"] == []
    share = api.call("GET", f"/api/layouts/{lid}/share").json()
    assert share["view_path"] is None and share["collaborators"] == []
    for example in ("ana-1", "bob-1"):
        assert Api(base).call("POST", "/api/session", {"username": example, "password": PASSWORD}).status_code == 401, "the shipped app seeds no designers (L804)"


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="holy-grail", collaborators=[bob])])
    lid, a = world.lid(), world.api(ana)
    with editor(browser, world, bob, reduced_motion="reduce") as page:
        freeze(page)
        button(page, "Versions").click()
        drawer = dialog(page, "Versions")
        expect(drawer).to_be_visible(timeout=UI_MS)
        still(drawer, "drawer opens at once (L335)")
        assert drawer.bounding_box()["x"] + drawer.bounding_box()["width"] <= DESKTOP["width"] + 1
        page.keyboard.press("Escape")
        expect(drawer).to_be_hidden()
        s = slider(page)
        s.focus()
        page.keyboard.press("PageDown")
        page.keyboard.press("ArrowLeft")
        expect(block(page, "main")).to_have_attribute("data-row-start", "3")
        still(block(page, "main"), "fold blocks jump (L335)")
        announce(page, "Showing Base at 758px.")
        with held(page, CHANGES_GLOB) as gate:
            enter(field(page, "Row 1 size"), "56px")
            expect(save_state(page)).to_contain_text(SAVING, timeout=UI_MS)
            a.applied(lid, {"kind": "set_track", "scope": "base", "axis": "row", "index": 1, "size": "1fr"})
            gate.release()
        text = f"{ana} changed row 1 first. Your change was not applied."
        expect(notice(page)).to_contain_text(text, timeout=UI_MS)
        still(button(page, "Dismiss notice"), "notice appears in place (L335)")
        advance(page, NOTICE_STAY_MS - 1000)
        expect(notice(page)).to_contain_text(text)
        advance(page, 1000)
        expect(page.get_by_text(text)).to_have_count(0, timeout=UI_MS)


def test_wf_live_outage_edit(browser: Browser, app_url: str) -> None:
    ob = outage_base()
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(ob, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        expect(live_status(pa)).to_have_text(LIVE_PAUSED)
        expect(live_status(pb)).to_have_text(LIVE_PAUSED)
        enter(field(pa, "Column 2 size"), "2fr")
        announce(pa, "Column 2 set to 2fr.")
        soon(pa, lambda: expect(save_state(pa)).to_contain_text(ALL_SAVED, timeout=POLL_MS), "saved through Postgres")
        api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "change stored on the outage copy")
        deadline = time.monotonic() + LIVE_S + 1
        while time.monotonic() < deadline:
            assert field(pb, "Column 2 size").input_value() == "1fr", "nothing is pushed live while Valkey is down (L796)"
        for p in (pa, pb):
            p.reload()
            ready(p)
            expect(field(p, "Column 2 size")).to_have_value("2fr")
    assert api.get_layout(lid)["live"] is False


def test_wf_live_outage_versions_links(browser: Browser, app_url: str) -> None:
    ob = outage_base()
    ana = name_for("ana")
    world = seed(ob, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        button(page, "Save version").click()
        dlg = dialog(page, "Save version")
        dlg.get_by_role("textbox", name="Version name").fill(VERSION_NAME)
        dlg.get_by_role("button", name="Save").click()
        announce(page, "Version 1 saved.")
        button(page, "Share").click()
        dialog(page, "Share").get_by_role("button", name="Create view link").click()
        announce(page, "View link created.")
        view = _path_in(dialog(page, "Share").get_by_role("textbox", name="View link"), "view")
    assert [v["number"] for v in api.call("GET", f"/api/layouts/{lid}/versions").json()["versions"]] == [1]
    with opened(browser, ob, view) as dev:
        expect(live_status(dev)).to_have_text(LIVE_PAUSED, timeout=UI_MS)


def test_health_and_live_flag(browser: Browser, app_url: str) -> None:
    base, ob = root(app_url), outage_base()
    h = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert h.status_code == 200 and h.json() == {"status": "ok"}
    o = httpx.get(ob + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert o.status_code == 200 and o.json() == {"status": "unavailable"}
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    assert world.api(ana).get_layout(world.lid())["live"] is True
    assert Api(ob, world.sessions[ana]).get_layout(world.lid())["live"] is False
    with editor(browser, world, ana) as page:
        expect(live_status(page)).to_have_text("")
    down = World(ob, world.sessions, world.layouts)
    with editor(browser, down, ana) as page:
        expect(live_status(page)).to_have_text(LIVE_PAUSED)


def test_outage_saves_without_live(browser: Browser, app_url: str, valkey: Any) -> None:
    base, ob = root(app_url), outage_base()
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(ob, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, oa, ob_bob = world.lid(), world.api(ana), world.api(bob)
    assert oa.applied(lid, {"kind": "set_gap", "scope": "base", "row": 24, "column": 16})["revision"] == 2
    assert oa.call("POST", f"/api/layouts/{lid}/versions", {"name": VERSION_NAME}).status_code == 201
    assert oa.call("POST", f"/api/layouts/{lid}/view-link").status_code == 201
    assert oa.call("DELETE", f"/api/layouts/{lid}/collaborators/{bob}").status_code == 204
    join = token_of(oa.call("POST", f"/api/layouts/{lid}/join-link").json()["join_path"])
    assert ob_bob.call("POST", f"/api/join/{join}").status_code == 200
    primary = Api(base, world.sessions[ana])
    assert primary.get_layout(lid)["gap"] == {"row": 24, "column": 16}
    share = primary.call("GET", f"/api/layouts/{lid}/share").json()
    assert share["view_path"] and share["collaborators"] == [bob]
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pa, [ana])
        wait_designers(pb, [bob])
        assert valkey.keys(f"presence:{lid}:*") == []


def test_grading_setup(app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    layout = {"ref": "L1", "owner": ana, "name": "Pricing page", "template": "holy-grail", "columns": ["1fr"], "rows": ["1fr"], "gap": {"row": 16, "column": 16},
              "areas": [area("main", 1, 1, 2, 2)], "breakpoints": [bp(768, ["1fr", "1fr"], ["1fr"])], "versions": [{"name": VERSION_NAME, "template": "blank"}],
              "collaborators": [bob], "view_link": True}
    body = {"users": [{"username": ana, "password": PASSWORD}, {"username": bob, "password": PASSWORD}], "layouts": [layout]}
    for headers in ({"X-Grading-Key": GRADING_KEY + "x"}, {}):
        expect_error(post_json(base, "/api/grading/setup", body, **headers), 404, "not_found", None, "grading setup with a wrong or missing key")
    bad_user = name_for("cara")
    bad = {"users": [{"username": bad_user, "password": PASSWORD}], "layouts": [{**layout, "owner": bad_user, "template": None, "columns": ["10em"], "collaborators": []}]}
    bad["layouts"][0].pop("template")
    expect_error(post_json(base, "/api/grading/setup", bad, **{"X-Grading-Key": GRADING_KEY}), 422, "invalid", SIZE_FORM_MSG, "invalid setup")
    assert Api(base).call("POST", "/api/session", {"username": bad_user, "password": PASSWORD}).status_code == 401, "a refused setup creates nothing (L544)"
    r = post_json(base, "/api/grading/setup", body, **{"X-Grading-Key": GRADING_KEY})
    assert r.status_code == 201, r.text[:300]
    data = r.json()
    ref = data["layouts"]["L1"]
    assert ref["revision"] == 1 and ref["view_path"].startswith("/view/") and ref["join_path"].startswith("/join/")
    a = Api(base, data["sessions"][ana])
    assert a.call("GET", "/api/me").json()["username"] == ana
    stored = a.get_layout(ref["id"])
    assert stored["name"] == "Pricing page" and shape(stored) == HOLY_GRAIL, "template wins over fields (L542)"
    v = a.call("GET", f"/api/layouts/{ref['id']}/versions/1").json()
    assert v["name"] == VERSION_NAME and shape(v["layout"]) == BLANK
    assert a.call("GET", f"/api/layouts/{ref['id']}/share").json()["collaborators"] == [bob]
    assert Api(base).call("GET", f"/api/view/{token_of(ref['view_path'])}").json()["role"] == "viewer"
    clash = {"users": [{"username": ana, "password": PASSWORD + "x"}], "layouts": []}
    expect_error(post_json(base, "/api/grading/setup", clash, **{"X-Grading-Key": GRADING_KEY}), 409, "taken", TAKEN_MSG, "existing user with another password")
    reuse = post_json(base, "/api/grading/setup", {"users": [{"username": ana, "password": PASSWORD}], "layouts": []}, **{"X-Grading-Key": GRADING_KEY})
    assert reuse.status_code == 201, "an existing user with the same password is reused (L545)"


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"} and data["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) for v in data.values())


def test_if_notices() -> None:
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({p.name for p in shipped_packages() if p.name not in text})
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing}"


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_datastores() -> None:
    drivers = sorted({p.name for p in shipped_packages() if p.name in DATASTORE_PACKAGES})
    assert not drivers, f"extra datastore packages shipped: {drivers}"
    files = []
    for dirpath, dirnames, filenames in os.walk(APP_DIR):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".git"}]
        files += [os.path.join(dirpath, f) for f in filenames if f.endswith((".sqlite", ".sqlite3", ".db"))]
    assert not files, f"file-based stores found: {files}"


def test_if_same_origin(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", view_link=True)])
    foreign: list[str] = []
    for path, cookie in ((f"/layouts/{world.lid()}", world.sessions[ana]), (world.layouts["L1"]["view_path"], None)):
        with opened(browser, base, path, cookie) as page:
            page.on("request", lambda req: foreign.append(req.url) if not req.url.startswith(("data:", "blob:", "about:")) and not same_origin(req.url, base) else None)
            page.reload()
            expect(grid(page)).to_be_visible(timeout=UI_MS)
    assert not foreign, f"requests to other origins: {foreign}"


def test_if_service_config() -> None:
    pattern = re.compile(r"(^|/)(docker-)?compose[^/]*\.ya?ml$|(^|/)\.devcontainer/")
    if (APP_DIR / ".git").exists():
        roots = subprocess.run(["git", "-C", str(APP_DIR), "rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True, timeout=60).stdout.split()
        if not roots:
            return
        diff = subprocess.run(["git", "-C", str(APP_DIR), "diff", "--name-only", roots[-1]], capture_output=True, text=True, timeout=60).stdout.splitlines()
        changed = [p for p in diff if pattern.search(p)]
        assert not changed, f"service configuration changed: {changed}"
        return
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            tool = str(node.get("name") or node.get("function_name") or node.get("tool") or "")
            args = node.get("input") or node.get("arguments") or node.get("args")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = None
            if re.search(r"write|edit|create|replace|patch", tool, re.I) and isinstance(args, dict):
                for k in ("file_path", "path", "filename", "target_file"):
                    v = args.get(k)
                    if isinstance(v, str) and pattern.search(v):
                        hits.append(v)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(trajectory.read_text()))
    assert not hits, f"the agent wrote service configuration: {hits}"


def test_if_typescript() -> None:
    skip = {"node_modules", "dist", "build", "out", ".git", ".next", "coverage", "public"}
    config = re.compile(r"(\.config\.|^\.)")
    ts, js = [], []
    for dirpath, dirnames, filenames in os.walk(APP_DIR):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for f in filenames:
            if f.endswith((".ts", ".tsx", ".mts", ".cts")):
                ts.append(f)
            elif f.endswith((".js", ".jsx", ".mjs", ".cjs")) and not config.search(f):
                js.append(os.path.join(dirpath, f))
    assert ts, "no TypeScript source found in /app"
    assert not js, f"JavaScript source outside build output: {js}"


PROBE_JUNK_TOKEN = "no-such-token-0000000000"
LOOSE_CSS = """/* pasted from an older stylesheet */
.layout {
    grid-template-areas: "top top"
                         "body side";
    column-gap: 16px;
    row-gap: 24px;
    display: grid;
    grid-template-columns: 2fr   1fr;
    grid-template-rows: auto 1fr;
}
.top { grid-area: top; }
.body { grid-area: body; }
.side { grid-area: side; }
"""
LOOSE_CANONICAL = """.layout {
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-template-rows: auto 1fr;
  gap: 24px 16px;
  grid-template-areas:
    "top top"
    "body side";
}

.top { grid-area: top; }
.body { grid-area: body; }
.side { grid-area: side; }
"""
REFORMATTED_HG_CSS = """/* Holy Grail, formatted by hand */
.layout {
  grid-template-areas: "header" "nav" "main" "aside" "footer";
  grid-template-rows: auto auto 1fr auto auto;
  grid-template-columns: 1fr;
  row-gap: 16px;
  column-gap: 16px;
  display: grid;
}
.header { grid-area: header; }
.nav { grid-area: nav; }
.main { grid-area: main; }
.aside { grid-area: aside; }
.footer { grid-area: footer; }
@media (min-width: 768px) {
  .layout {
    grid-template-areas: "header header header" "nav main aside" "footer footer footer";
    grid-template-columns: 200px 1fr 200px;
    grid-template-rows: auto 1fr auto;
  }
}
"""
CLEARED_ROW_CSS = """.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 16px;
  grid-template-areas:
    ". . ."
    "main main main";
}

.main { grid-area: main; }
"""
HG_WIDER = fields(["1fr"], ["auto", "auto", "1fr", "auto", "auto"], (24, 16), HG_BASE_AREAS,
                  [bp(768, ["240px", "1fr", "200px"], ["auto", "1fr", "auto"], HG_BP_AREAS)])


def _areas_by_name(layout: dict) -> dict[str, dict]:
    return {a["name"]: _area_shape(a) for a in layout["areas"]}


def _drag_name(page: Page, start: Locator, end: Locator, name: str) -> Locator:
    mouse_drag(page, start, end)
    dlg = dialog(page, "Name area")
    box = dlg.get_by_role("textbox", name="Area name")
    expect(box).to_be_focused(timeout=UI_MS)
    box.fill(name)
    box.press("Enter")
    return dlg


def _wraps_inside(page: Page, dlg: Locator, first: Locator) -> None:
    first.focus()
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        assert focused_in(dlg), "Tab left the open dialog (L258)"
        if first.evaluate("e => e === document.activeElement"):
            return
    pytest.fail("Tab never wrapped back round inside the dialog (L258)")


def _preview_style(page: Page, prop: str) -> str:
    return preview(page).element_handle().content_frame().evaluate(
        "p => getComputedStyle(document.getElementsByClassName('layout')[0]).getPropertyValue(p)", prop)


def test_wf_track_sizes_typed_forms(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    typed = [("1.50fr", "1.5fr", "fr"), ("minmax( 200px , 300px )", "minmax(200px, 300px)", "minmax"), ("2.0fr", "2fr", "fr")]
    with editor(browser, world, ana) as page:
        for n, (raw, canonical, unit) in enumerate(typed, 1):
            box = field(page, f"Column {n} size")
            enter(box, raw)
            announce(page, f"Column {n} set to {canonical}.")
            soon(page, lambda b=box, c=canonical: expect(b).to_have_value(c, timeout=POLL_MS), f"Column {n} size shows {canonical} (L580)")
            expect(colheader(page, n)).to_have_attribute("data-track-size", canonical)
            expect(colheader(page, n)).to_have_attribute("data-track-unit", unit)
        enter(field(page, "Row 1 size"), "auto")
        announce(page, "Row 1 set to auto.")
        expect(rowheader(page, 1)).to_have_attribute("data-track-unit", "auto")
        code_contains(page, "CSS", "grid-template-columns: " + " ".join(c for _, c, _ in typed) + ";")
        code_contains(page, "CSS", "grid-template-rows: auto 1fr 1fr;")
    stored = api.get_layout(lid)
    assert stored["revision"] == 5, f"four typed sizes store four revisions, found revision {stored['revision']}"
    assert stored["columns"] == [c for _, c, _ in typed] and stored["rows"] == ["auto", "1fr", "1fr"], f"{stored['columns']} {stored['rows']}"


def test_wf_track_sizes_refused_on_leave(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        box = field(page, "Column 2 size")
        for typed, message in (("1FR", SIZE_FORM_MSG), ("minmax(1fr, 0.1fr)", SIZE_RANGE_MSG), ("minmax(50%, 20%)", SIZE_ORDER_MSG), ("101fr", SIZE_RANGE_MSG)):
            box.fill(typed)
            box.press("Tab")
            soon(page, lambda m=message: expect(edit_problem(page)).to_contain_text(m, timeout=POLL_MS), f"leaving with {typed!r} shows {message!r} (L266, L581)")
            soon(page, lambda: expect(box).to_have_value("1fr", timeout=POLL_MS), "the field keeps the stored size (L341)")
            expect(colheader(page, 2)).to_have_attribute("data-track-size", "1fr")
        assert api.get_layout(lid)["revision"] == 1, "refused sizes store nothing (L341)"
        box.fill("0.25fr")
        box.press("Tab")
        announce(page, "Column 2 set to 0.25fr.")
    stored = api.get_layout(lid)
    assert stored["revision"] == 2 and stored["columns"] == ["200px", "0.25fr", "200px"], f"{stored['columns']}"


def test_area_name_bounds_by_keyboard(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    longest = "a" * 24
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        page.keyboard.press("Shift+ArrowRight")
        dlg = _name_area(page, "9lives")
        _dialog_refusal(page, dlg, AREA_NAME_MSG)
        name_box = dlg.get_by_role("textbox", name="Area name")
        for bad in ("a" * 25, "Top", "top_bar"):
            for typed, message in (("layout", RESERVED_MSG), (bad, AREA_NAME_MSG)):
                name_box.fill(typed)
                name_box.press("Enter")
                _dialog_refusal(page, dlg, message)
        _wraps_inside(page, dlg, name_box)
        page.keyboard.press("Escape")
        soon(page, lambda: expect(dlg).to_have_count(0, timeout=POLL_MS), "Escape closes Name area (L259)")
        soon(page, lambda: expect(cell(page, 1, 2)).to_be_focused(timeout=POLL_MS), "focus returns to the cursor cell (L260)")
        assert api.get_layout(lid)["revision"] == 1, "refused names store nothing (L606)"
        _name_area(page, longest)
        announce(page, f"Area {longest} created.")
        back_in_grid(page)
        page.keyboard.press("ArrowDown")
        _name_area(page, "x")
        announce(page, "Area x created.")
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 3, "two accepted names store two revisions")
    assert _areas_by_name(stored) == {longest: area(longest, 1, 1, 2, 3), "x": area("x", 2, 2, 3, 3)}, f"{stored['areas']}"


def test_overlap_and_shape_by_drag(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    grid4 = fields(["1fr"] * 4, ["1fr"] * 3, (16, 16), [area("header", 1, 1, 2, 5), area("side", 2, 1, 4, 2)])
    world = seed(base, [ana], [spec("L1", ana, grid=grid4)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        dlg = _drag_name(page, cell(page, 3, 4), cell(page, 1, 3), "main")
        _dialog_refusal(page, dlg, "Area main would overlap area header.")
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        assert api.get_layout(lid)["revision"] == 1, "the overlap stores nothing (L612)"
        _drag_name(page, cell(page, 2, 2), cell(page, 3, 3), "main")
        announce(page, "Area main created.")
        cell(page, 2, 4).click()
        expect(cell(page, 2, 4)).to_be_focused()
        dlg = _name_area(page, "main")
        _dialog_refusal(page, dlg, "Area main must stay one rectangle.")
        page.keyboard.press("Escape")
        _drag_name(page, cell(page, 2, 4), cell(page, 3, 4), "main")
        announce(page, "Area main extended.")
        expect(block(page, "main")).to_have_attribute("data-column-end", "5")
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 3, "create and extend store two revisions")
    assert _areas_by_name(stored)["main"] == area("main", 2, 2, 4, 5), f"{stored['areas']}"


def test_clear_two_areas_by_keys(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    grid3 = fields(["1fr"] * 3, ["1fr"] * 2, (16, 16), [area("header", 1, 1, 2, 3), area("nav", 1, 3, 2, 4), area("main", 2, 1, 3, 4)])
    world = seed(base, [ana], [spec("L1", ana, grid=grid3)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        expect(cell(page, 1, 3)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Delete")
        announce(page, "Cells cleared. Area header removed. Area nav removed.")
        for c in (1, 2, 3):
            soon(page, lambda c=c: expect(cell(page, 1, c)).to_have_attribute("data-area", "", timeout=POLL_MS), f"row 1, column {c} is empty")
        expect(block(page, "header")).to_have_count(0)
        expect(named_cell(page, 2, 1, "main")).to_have_count(1)
        code_equals(page, "CSS", CLEARED_ROW_CSS)
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "one clear stores one revision")
    assert [_area_shape(a) for a in stored["areas"]] == [area("main", 2, 1, 3, 4)], f"{stored['areas']}"


def test_add_tracks_inside_areas_by_keys(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE)])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        page.keyboard.press("c")
        announce(page, "Column added after column 1.")
        soon(page, lambda: expect(named_cell(page, 1, 2, "header")).to_have_count(1, timeout=POLL_MS), "header joins the new column (L597)")
        expect(cell(page, 2, 2)).to_have_attribute("data-area", "")
        expect(named_cell(page, 2, 3, "main")).to_have_count(1)
        expect(block(page, "header")).to_have_attribute("data-column-end", "5")
        expect(block(page, "footer")).to_have_attribute("data-column-end", "5")
        expect(colheader(page, 2)).to_have_attribute("data-track-size", "1fr")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("r")
        announce(page, "Row added after row 2.")
        for c in (1, 2, 3, 4):
            soon(page, lambda c=c: expect(cell(page, 3, c)).to_have_attribute("data-area", "", timeout=POLL_MS), f"new row 3, column {c} is empty")
        expect(block(page, "footer")).to_have_attribute("data-row-start", "4")
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 3, "two added tracks store two revisions")
    assert stored["columns"] == ["200px", "1fr", "1fr", "200px"] and stored["rows"] == ["auto", "1fr", "1fr", "auto"], f"{stored['columns']} {stored['rows']}"
    want = [area("header", 1, 1, 2, 5), area("nav", 2, 1, 3, 2), area("main", 2, 3, 3, 4), area("aside", 2, 4, 3, 5), area("footer", 4, 1, 5, 5)]
    assert _areas_by_name(stored) == {a["name"]: a for a in want}, f"{stored['areas']}"


def test_gap_bounds_in_preview(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        enter(field(page, "Column gap"), str(GAP_MAX))
        announce(page, f"Column gap set to {GAP_MAX}px.")
        soon(page, lambda: _assert_eq(_preview_style(page, "column-gap"), f"{GAP_MAX}px", "preview column gap"), "the preview's column gap follows (L592)")
        enter(field(page, "Column gap"), str(GAP_MAX + 1))
        soon(page, lambda: expect(edit_problem(page)).to_contain_text(GAP_MSG, timeout=POLL_MS), "a gap above the range is refused (L592)")
        assert api.get_layout(lid)["revision"] == 2, "the refused gap stores nothing (L341)"
        enter(field(page, "Row gap"), "0")
        announce(page, "Row gap set to 0px.")
        soon(page, lambda: _assert_eq(_preview_style(page, "row-gap"), "0px", "preview row gap"), "the preview's row gap follows (L592)")
        code_contains(page, "CSS", f"gap: 0px {GAP_MAX}px;")
    stored = api.get_layout(lid)
    assert stored["revision"] == 3 and stored["gap"] == {"row": 0, "column": GAP_MAX}, f"{stored['gap']}"


def test_css_loose_formatting_typed(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        box.fill(LOOSE_CSS)
        box.press("Control+Enter")
        announce(page, "CSS applied. Areas added: top, body, side.")
        code_equals(page, "CSS", LOOSE_CANONICAL)
        soon(page, lambda: expect(named_cell(page, 2, 2, "side")).to_have_count(1, timeout=POLL_MS), "the grid shows side (L664)")
        soon(page, lambda: _assert_eq(abs(preview_columns(page)[0] - 2 * preview_columns(page)[1]) <= 1, True, "2fr is twice 1fr in the preview"), "the preview follows the CSS")
    stored = api.get_layout(lid)
    want = fields(["2fr", "1fr"], ["auto", "1fr"], (24, 16), [area("top", 1, 1, 2, 3), area("body", 2, 1, 3, 2), area("side", 2, 2, 3, 3)])
    assert stored["revision"] == 2 and shape(stored) == want, f"{shape(stored)}"


def test_wf_css_roundtrip_error_lines(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    cases = [
        (_css(".layout {", "  display: grid;", "  grid-auto-flow: row;", "  grid-template-columns: 1fr;", "}"), "Line 3: unknown property grid-auto-flow."),
        (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr 1fr;", "  grid-template-rows: auto auto;", "  grid-template-areas:",
              '    "head head"', '    "main";', "}"), "Line 7: every area row needs 2 cells."),
        (_css(".layout {", "  display: grid;", "  grid-template-columns: 1fr;", newline=False), "Line 3: missing }."),
    ]
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        for typed, message in cases:
            box.fill(typed)
            box.press("Control+Enter")
            soon(page, lambda m=message: expect(edit_problem(page)).to_contain_text(m, timeout=POLL_MS), f"Edit problem shows {message!r} (L668)")
            expect(box).to_have_value(typed)
        assert api.get_layout(lid)["revision"] == 1, "CSS with an error stores nothing (L668)"


def test_css_equal_and_renamed_typed(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    renamed = _css(".layout {", "  display: grid;", "  grid-template-columns: 1fr 2fr;", "  grid-template-rows: auto 1fr;", "  gap: 16px;",
                   "  grid-template-areas:", '    "header header"', '    "menu content";', "}", "",
                   ".header { grid-area: header; }", ".menu { grid-area: menu; }", ".content { grid-area: content; }")
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        box.fill(REFORMATTED_HG_CSS)
        button(page, "Apply CSS").click()
        announce(page, NO_CHANGES)
        assert api.get_layout(lid)["revision"] == 1, "CSS equal to the layout creates no revision (L688)"
        box = code_box(page, "CSS")
        box.fill(renamed)
        box.press("Control+Enter")
        announce(page, "CSS applied. Areas added: menu, content. Areas removed: nav, main, aside, footer.")
        soon(page, lambda: expect(named_cell(page, 2, 2, "content")).to_have_count(1, timeout=POLL_MS), "the grid shows content")
    stored = api.get_layout(lid)
    want = fields(["1fr", "2fr"], ["auto", "1fr"], (16, 16), [area("header", 1, 1, 2, 3), area("menu", 2, 1, 3, 2), area("content", 2, 2, 3, 3)])
    assert stored["revision"] == 2 and shape(stored) == want, f"{shape(stored)}"


def test_compare_in_drawer_by_keyboard(browser: Browser, app_url: str) -> None:
    from conftest import select

    base = root(app_url)
    ana = name_for("ana")
    versions = [{"name": VERSION_NAME, "template": "holy-grail"}, {"name": VERSION_NAME, **HG_WIDER}, {"name": VERSION_NAME, "template": "holy-grail"}]
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", versions=versions)])
    with editor(browser, world, ana) as page:
        opener = button(page, "Versions")
        opener.focus()
        page.keyboard.press("Enter")
        drawer = drawer_on_screen(page)
        select(drawer.get_by_role("combobox", name="Compare from"), f"Version 1: {VERSION_NAME}")
        select(drawer.get_by_role("combobox", name="Compare to"), f"Version 2: {VERSION_NAME}")
        drawer.get_by_role("button", name="Compare", exact=True).click()
        diff = drawer.get_by_role("list", name="Differences").get_by_role("listitem")
        expect(diff).to_have_text(["Gap: 16px → 24px 16px", "From 768px Columns: 200px 1fr 200px → 240px 1fr 200px"], timeout=UI_MS)
        select(drawer.get_by_role("combobox", name="Compare to"), f"Version 3: {VERSION_NAME}")
        drawer.get_by_role("button", name="Compare", exact=True).click()
        expect(diff).to_have_text(["No differences."], timeout=UI_MS)
        drawer.get_by_role("button", name="Compare", exact=True).focus()
        page.keyboard.press("Escape")
        soon(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS), "Escape returns focus to Versions (L260)")


def test_restore_by_keyboard(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", versions=[{"name": VERSION_NAME, "template": "blank"}])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        button(page, "Versions").click()
        drawer = drawer_on_screen(page)
        restore = drawer.get_by_role("button", name="Restore version 1", exact=True)
        restore.focus()
        page.keyboard.press("Enter")
        confirm = dialog(page, "Restore version 1?")
        expect(confirm).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        soon(page, lambda: expect(confirm).to_have_count(0, timeout=POLL_MS), "Escape closes the confirmation (L259)")
        soon(page, lambda: expect(restore).to_be_focused(timeout=POLL_MS), "focus returns to Restore version 1 (L260)")
        assert api.get_layout(lid)["revision"] == 1, "Escape restores nothing (L259)"
        page.keyboard.press("Enter")
        expect(confirm).to_be_visible(timeout=UI_MS)
        confirm.get_by_role("button", name="Restore", exact=True).focus()
        page.keyboard.press("Enter")
        announce(page, "Restored version 1.")
        drawer.get_by_role("button", name="Close versions").click()
        drawer_closed(page)
        code_equals(page, "CSS", BLANK_CSS)
        button(page, "Versions").click()
        saved = drawer_on_screen(page).get_by_role("list", name="Saved versions").get_by_role("listitem")
        expect(saved).to_have_count(2, timeout=UI_MS)
        expect(saved.nth(1)).to_contain_text("Restored from version 1")
    stored = api.get_layout(lid)
    assert stored["revision"] == 2 and shape(stored) == BLANK, f"restore must be exact (L756): {shape(stored)}"
    listed = api.call("GET", f"/api/layouts/{lid}/versions").json()["versions"]
    assert [(v["number"], v["name"]) for v in listed] == [(1, VERSION_NAME), (2, "Restored from version 1")], f"{listed}"


def test_share_links_by_keyboard(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank")])
    lid, owner = world.lid(), world.api(ana)
    old_join = world.layouts["L1"]["join_path"]
    with editor(browser, world, ana) as pa:
        opener = button(pa, "Share")
        opener.focus()
        pa.keyboard.press("Enter")
        share = dialog(pa, "Share")
        expect(share).to_be_visible(timeout=UI_MS)
        create = share.get_by_role("button", name="Create view link", exact=True)
        _wraps_inside(pa, share, create)
        create.focus()
        pa.keyboard.press("Enter")
        announce(pa, "View link created.")
        soon(pa, lambda: _path_in(share.get_by_role("textbox", name="View link"), "view"), "the View link field fills in place (L297)")
        view = _path_in(share.get_by_role("textbox", name="View link"), "view")
        share.get_by_role("button", name="Regenerate co-edit link", exact=True).focus()
        pa.keyboard.press("Enter")
        announce(pa, "Co-edit link regenerated.")
        soon(pa, lambda: _assert_eq(_path_in(share.get_by_role("textbox", name="Co-edit link"), "join") != old_join, True, "co-edit link replaced"), "the co-edit link field updates in place (L297)")
        new_join = _path_in(share.get_by_role("textbox", name="Co-edit link"), "join")
        pa.keyboard.press("Escape")
        soon(pa, lambda: expect(share).to_have_count(0, timeout=POLL_MS), "Escape closes Share (L259)")
        soon(pa, lambda: expect(opener).to_be_focused(timeout=POLL_MS), "focus returns to Share (L260)")
    with opened(browser, base, old_join, world.sessions[bob]) as guest:
        expect(guest.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
        guest.goto(base + new_join)
        soon(guest, lambda: _assert_eq(guest.url.split("?")[0].endswith("/layouts/" + lid), True, f"joined and landed on the editor, at {guest.url}"), "the new co-edit link lands on the editor (L562)")
    shared = owner.call("GET", f"/api/layouts/{lid}/share").json()
    assert shared["collaborators"] == [bob], f"the guest joined through the new link: {shared}"
    assert shared["view_path"] == view, f"the view link field shows the stored link: {shared}"


def test_not_available_pages(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank")])
    lid = world.lid()
    with opened(browser, base, f"/layouts/{lid}", world.sessions[bob]) as page:
        expect(page.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("link", name="Your layouts")).to_be_visible()
        page.goto(base + "/join/" + PROBE_JUNK_TOKEN)
        expect(page.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
    with opened(browser, base, "/view/" + PROBE_JUNK_TOKEN) as page:
        expect(page.get_by_role("heading", name=NOT_AVAILABLE, level=1)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("link", name="Sign in")).to_be_visible()
    expect_error(world.api(bob).call("GET", f"/api/layouts/{lid}"), 404, "not_found", None, "another designer's private layout")
    expect_error(Api(base).call("GET", "/api/view/" + PROBE_JUNK_TOKEN), 404, "not_found", None, "an unknown view link")


def test_grading_world_in_editor(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="holy-grail", versions=[{"name": VERSION_NAME, "template": "blank"}],
                                         collaborators=[bob], view_link=True)])
    lid = world.lid()
    view = world.layouts["L1"]["view_path"]
    title = world.api(ana).get_layout(lid)["name"]
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pa, [ana, bob])
        opener = button(pa, "Versions")
        opener.focus()
        pa.keyboard.press("Enter")
        drawer = drawer_on_screen(pa)
        saved = drawer.get_by_role("list", name="Saved versions").get_by_role("listitem")
        expect(saved).to_have_count(1, timeout=UI_MS)
        expect(saved.nth(0)).to_contain_text(f"Version 1: {VERSION_NAME}")
        drawer.get_by_role("button", name="Close versions").click()
        drawer_closed(pa)
        button(pa, "Share").click()
        share = dialog(pa, "Share")
        expect(share.get_by_role("list", name="Collaborators").get_by_role("listitem")).to_contain_text([bob], timeout=UI_MS)
        soon(pa, lambda: _assert_eq(_path_in(share.get_by_role("textbox", name="View link"), "view"), view, "view link field"), "Share shows the created view link (L106)")
        expect(pb.get_by_role("heading", name=title, level=1)).to_be_visible()
        expect(button(pb, "Share")).to_have_count(0)
    with opened(browser, base, view) as dev:
        expect(dev.get_by_role("heading", name=title)).to_be_visible(timeout=UI_MS)
        code_equals(dev, "CSS", HOLY_GRAIL_CSS)


SETTLE_MS = 500


def settled(page: Page) -> None:
    soon(page, lambda: expect(save_state(page)).to_contain_text(ALL_SAVED, timeout=POLL_MS), "Save state settles (L346)")
    advance(page, SETTLE_MS)
    soon(page, lambda: expect(save_state(page)).to_contain_text(ALL_SAVED, timeout=POLL_MS), "Save state stays settled (L346)")


def test_breakpoint_separator_keys_in_scope(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        soon(page, lambda: expect(bp_tab(page, "From 768px")).to_have_attribute("aria-selected", "true", timeout=POLL_MS), "From 768px is in effect at 1280 (L290)")
        separator(page, "Resize column 1").focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        grown = f"{200 + 2 * PX_STEP}px"
        soon(page, lambda: expect(separator(page, "Resize column 1")).to_have_attribute("aria-valuetext", grown, timeout=POLL_MS), "two separator steps, one per key (L271, L272)")
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] >= 3, "two key presses store two changes")
    assert stored["revision"] == 3, f"each key press is one change (L272): revision {stored['revision']}"
    assert stored["breakpoints"][0]["columns"] == [grown, "1fr", "200px"] and stored["columns"] == ["1fr"], f"{stored['breakpoints'][0]['columns']} {stored['columns']}"


def test_wf_phone_editing_separator_finger(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=fields(["100px", "1fr"], ["1fr"]))])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana, viewport=PHONE) as page:
        tap(page.get_by_role("tablist", name="Editor panes").get_by_role("tab", name="Grid", exact=True))
        finger = Finger(page)
        x, y = center(separator(page, "Resize column 1"))
        finger.down(x, y)
        finger.move(x + DRAG_STEP_PX * 2 + 1, y)
        grown = f"{100 + 2 * PX_STEP}px"
        soon(page, lambda: expect(separator(page, "Resize column 1")).to_have_attribute("aria-valuetext", grown, timeout=POLL_MS), "the size shows while the finger drags (L274)")
        finger.up()
    stored = api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "one change on release (L274)")
    assert stored["columns"][0] == grown, f"{stored['columns']}"


def test_outage_restore_lists_version(browser: Browser, app_url: str) -> None:
    base = outage_base()
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="holy-grail", versions=[{"name": VERSION_NAME, "template": "blank"}])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        button(page, "Versions").click()
        drawer = drawer_on_screen(page)
        drawer.get_by_role("button", name="Restore version 1", exact=True).click()
        dialog(page, "Restore version 1?").get_by_role("button", name="Restore", exact=True).click()
        announce(page, "Restored version 1.")
        saved = drawer.get_by_role("list", name="Saved versions").get_by_role("listitem")
        expect(saved).to_have_count(2, timeout=UI_MS)
        expect(saved.nth(1)).to_contain_text("Restored from version 1")
    assert shape(api.get_layout(lid)) == BLANK, "the restore saved through Postgres (L795)"


def test_wf_track_edits_new_column_sized(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        tab_into_grid(page)
        page.keyboard.press("c")
        announce(page, "Column added after column 1.")
        enter(field(page, "Column 2 size"), "1.50fr")
        api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 3, "the typed size is stored (L266)")
        settled(page)
        expect(updates(page)).to_have_text("Column 2 set to 1.5fr.")
        expect(field(page, "Column 2 size")).to_have_value("1.5fr")
    assert api.get_layout(lid)["revision"] == 3, "one typed size is one change (L266)"


def test_wf_live_conflict_typed_size_both(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana, bob = name_for("ana"), name_for("bob")
    world = seed(base, [ana, bob], [spec("L1", ana, template="blank", collaborators=[bob])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as pa, editor(browser, world, bob) as pb:
        wait_designers(pa, [ana, bob])
        enter(field(pb, "Column 2 size"), "2.0fr")
        announce(pa, f"{bob}: Column 2 set to 2fr.", LIVE_S)
        api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 2, "the typed size is stored (L266)")
        settled(pb)
        expect(updates(pb)).to_have_text("Column 2 set to 2fr.")
    assert api.get_layout(lid)["revision"] == 2, "one typed size is one change (L266)"


def test_wf_css_roundtrip_typed_size(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, template="blank")])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        box = code_box(page, "CSS")
        box.fill(LOOSE_CSS)
        box.press("Control+Enter")
        announce(page, "CSS applied. Areas added: top, body, side.")
        enter(field(page, "Column 1 size"), "1.50fr")
        api_until(lambda: api.get_layout(lid), lambda l: l["revision"] == 3, "the typed size is stored (L266)")
        code_contains(page, "CSS", "  grid-template-columns: 1.5fr 1fr;\n")
        settled(page)
        expect(updates(page)).to_have_text("Column 1 set to 1.5fr.")
    assert api.get_layout(lid)["revision"] == 3, "one typed size is one change (L266)"


def test_rename_then_restore_history(browser: Browser, app_url: str) -> None:
    base = root(app_url)
    ana = name_for("ana")
    world = seed(base, [ana], [spec("L1", ana, grid=HG768_AS_BASE, versions=[{"name": VERSION_NAME, **HG768_AS_BASE}])])
    lid, api = world.lid(), world.api(ana)
    with editor(browser, world, ana) as page:
        mouse_drag(page, cell(page, 2, 1), cell(page, 2, 1))
        page.keyboard.press("Enter")
        box = dialog(page, "Name area").get_by_role("textbox", name="Area name")
        expect(box).to_have_value("nav", timeout=UI_MS)
        box.fill("side")
        box.press("Enter")
        announce(page, "Area nav renamed to side.")
        button(page, "Versions").click()
        drawer = drawer_on_screen(page)
        drawer.get_by_role("button", name="Restore version 1", exact=True).click()
        dialog(page, "Restore version 1?").get_by_role("button", name="Restore", exact=True).click()
        announce(page, "Restored version 1.")
        saved = drawer.get_by_role("list", name="Saved versions").get_by_role("listitem")
        expect(saved).to_have_count(2, timeout=UI_MS)
        expect(saved.nth(1)).to_contain_text("Restored from version 1")
    assert "nav" in [a["name"] for a in api.get_layout(lid)["areas"]], "the restore brings nav back exactly (L756)"
