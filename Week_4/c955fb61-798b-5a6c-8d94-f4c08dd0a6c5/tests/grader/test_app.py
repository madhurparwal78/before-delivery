from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    S3,
    addresses,
    advance,
    axe,
    center,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    select,
    session,
    shipped_packages,
    state_styles,
    text,
)


DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
DAY_PX = 32
DRAG_PX = 64
TAP_MIN_PX = 44
BODY_LIMIT = 100_000
NOTICE_LATEST_S = 5
COMMENT_MAX = 1000
LAG_LIMIT = 30
PDF_ROWS = 20
SLIDER_STEP = 5
HTTP_TIMEOUT_S = 30
SETTLE_S = 20
POLL_MS = 250
STEP_MS = 100
LIVE_S = 10
MAIL_SLACK_S = 10
MAIL_POLL_S = 0.5
TAB_PRESSES = 30
EVIL_ORIGIN = "http://evil.example"
UNKNOWN_ITEM = "no-such-item"
UNKNOWN_ENDPOINT = "no-such-endpoint"
UNKNOWN_PROJECT = "no-such-project"
COMMENT_NOW = "Copy due Friday."
COMMENT_OLD = "Supplier slipped."
RENAMED = "Write copy draft two"
LONG_PLAN = "Long plan"
BAD_DATE = "03/02/2027"
SECOND_NAME = "Ezra Two"
SET_COOKIE = "set-cookie"
CSV_TYPE = "text/csv; charset=utf-8"
DRAFT_BRIEF = "Draft brief"
FAR_BROWSER_TIME = "2031-01-15T09:00:00Z"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
FORBIDDEN_BACKENDS = {
    "redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "lowdb", "nedb",
    "level", "lmdb", "amqplib", "kafkajs", "bullmq", "bull", "bee-queue", "memcached", "pusher", "ably",
    "@supabase/supabase-js", "firebase", "firebase-admin", "@pusher/push-notifications-server",
}
APP_ROOT = Path("/app")

COLS = ["Row", "Name", "Start", "End", "Duration", "Predecessors", "Assignees", "% complete", "Variance"]
CSV_HEADER = "Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,Baseline start,Baseline end,Variance"
READ_ONLY = "You can view this project but not change it."
LOOP_SPRING = "That link would make the project wait on itself: Design pages -> Draft brief -> Review brief -> Design pages."
OUTAGE_ALERT = "File storage is unavailable. Your export was not saved. Try again later."
SPRING_CSV = "spring-launch-2027-03-04.csv"
SPRING_PDF = "spring-launch-2027-03-04.pdf"

PEOPLE = {
    "asha": ("Asha Rao", "asha-plans-2027", "owner"),
    "ben": ("Ben Ode", "ben-plans-2027", "editor"),
    "cara": ("Cara Lund", "cara-plans-2027", "editor"),
    "devi": ("Devi Shah", "devi-plans-2027", "viewer"),
}


def mar(day: int) -> str:
    return f"2027-03-{day:02d}"


TODAY = mar(4)
FOUNDERS = {"date": mar(10), "name": "Founders Day"}


def it(key: str, name: str, kind: str, group: str | None, start: str, duration: int, percent: int,
       assignees: tuple[tuple[str, float], ...] = ()) -> dict[str, Any]:
    return {"key": key, "name": name, "kind": kind, "group": group, "start": start, "duration": duration,
            "percent": percent, "assignees": [{"email": e, "hours": h} for e, h in assignees]}


def lk(a: str, b: str, kind: str, lag: int) -> dict[str, Any]:
    return {"from": a, "to": b, "type": kind, "lag": lag}


def spring_project(em: dict[str, str], baseline: dict | None) -> dict[str, Any]:
    return {"name": "Spring launch", "holidays": [FOUNDERS], "items": [
        it("content", "Content", "group", None, mar(1), 0, 0),
        it("draft", "Draft brief", "task", "content", mar(1), 3, 20, ((em["asha"], 4),)),
        it("review", "Review brief", "task", "content", mar(4), 2, 75),
        it("write", "Write copy", "task", "content", mar(2), 2, 10),
        it("design", "Design pages", "task", None, mar(11), 4, 0, ((em["ben"], 8),)),
        it("signoff", "Sign-off", "milestone", None, mar(15), 0, 0),
    ], "links": [lk("draft", "review", "FS", 0), lk("draft", "write", "SS", 1),
                 lk("review", "design", "FS", 0), lk("design", "signoff", "FS", 0)],
        "baseline": baseline}


def office_project(em: dict[str, str]) -> dict[str, Any]:
    return {"name": "Office move", "holidays": [], "items": [
        it("pack", "Pack desks", "task", None, mar(8), 3, 0, ((em["asha"], 3),))], "links": [], "baseline": None}


def link_project() -> dict[str, Any]:
    return {"name": "Link examples", "holidays": [FOUNDERS], "items": [
        it("a", "Plan route", "task", None, mar(1), 3, 0),
        it("b", "Book venue", "task", None, mar(1), 2, 0),
        it("c", "Print maps", "task", None, mar(1), 4, 0),
        it("d", "Pack kits", "task", None, mar(1), 3, 0),
        it("e", "Kick-off", "milestone", None, mar(1), 0, 0),
        it("f", "Send reminders", "task", None, mar(1), 2, 0),
    ], "links": [], "baseline": None}


def grading_key() -> str:
    value = os.environ.get("GRADING_KEY")
    if not value:
        pytest.fail("GRADING_KEY is not set in the verifier environment; the setup route cannot be called")
    return value


def grading_setup(base: str, body: Any, key: str | None = None) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key is not None else {"X-Grading-Key": grading_key()}
    return httpx.post(base + "/api/grading/setup", json=body, headers=headers, timeout=HTTP_TIMEOUT_S)


def outage_url() -> str:
    value = os.environ.get("APP_STORAGE_DOWN_URL")
    if not value:
        pytest.fail("APP_STORAGE_DOWN_URL is not set; the storage-outage instance cannot be reached")
    return value.rstrip("/")


class Api:
    def __init__(self, base: str, email: str, password: str) -> None:
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        r = self.http.post("/api/session", json={"email": email, "password": password})
        assert r.status_code == 200, f"POST /api/session for {email} answered {r.status_code}: {r.text[:200]}"

    def project(self, pid: str) -> dict[str, Any]:
        r = self.http.get(f"/api/projects/{pid}")
        assert r.status_code == 200, f"GET /api/projects/{pid} answered {r.status_code}: {r.text[:200]}"
        return r.json()

    def items(self, pid: str) -> dict[str, dict[str, Any]]:
        return {i["id"]: i for i in self.project(pid)["items"]}


class Seed:

    def __init__(self, base: str, projects: tuple[str, ...] = ("spring", "office", "links"), *,
                 baseline: dict | None = None, extra: list[dict] | None = None) -> None:
        t = uuid.uuid4().hex[:10]
        self.base, self.tag = base, t
        self.emails = {k: f"{k}.{t}@slackwater.test" for k in PEOPLE}
        self.ws_name = f"Harbour Street Studio {t}"
        made = {"spring": lambda: spring_project(self.emails, baseline),
                "office": lambda: office_project(self.emails), "links": link_project}
        self.body = {
            "users": [{"email": self.emails[k], "name": n, "password": pw, "capacity": 8}
                      for k, (n, pw, _) in PEOPLE.items()],
            "workspace": {"name": self.ws_name,
                          "members": [{"email": self.emails[k], "role": r} for k, (_, _, r) in PEOPLE.items()]},
            "projects": [made[p]() for p in projects] + list(extra or []),
        }
        r = grading_setup(base, self.body)
        assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code}: {r.text[:300]}"
        self.response = r
        data = r.json()
        self.workspace = data["workspace"]["id"]
        self.users = {k: next(u["id"] for u in data["users"] if u["email"] == self.emails[k]) for k in PEOPLE}
        self.pid = {p["name"]: p["id"] for p in data["projects"]}
        self.ids = {p["name"]: p["items"] for p in data["projects"]}
        self.sp = self.pid.get("Spring launch", "")
        self.s = self.ids.get("Spring launch", {})
        self.lp = self.pid.get("Link examples", "")
        self.lx = self.ids.get("Link examples", {})

    def api(self, who: str) -> Api:
        return Api(self.base, self.emails[who], PEOPLE[who][1])

    def page(self, browser: Browser, who: str, path: str, size: dict | None = None,
             reduced_motion: str = "no-preference"):
        return signed_in(browser, self.base, self.emails[who], PEOPLE[who][1], path, size, reduced_motion)


@contextmanager
def signed_in(browser: Browser, base: str, email: str, password: str, path: str,
              size: dict | None = None, reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base + "/signin", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size or DESKTOP)
        resp = page.request.post(base + "/api/session", data={"email": email, "password": password})
        assert resp.status == 200, f"POST /api/session for {email} answered {resp.status}"
        page.goto(base + path)
        yield page


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path} answered {r.status_code}, expected {status}: {r.text[:300]}")
    return r.json() if r.content else None


def expect_error(r: httpx.Response, status: int, code: str, keys: tuple[str, ...] = (), **values: Any) -> dict:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:300]}; expected {status} {code}")
    body = r.json()
    assert body.get("error") == code, f"error code {body!r}; expected {code}"
    assert set(body) == {"error", *keys, *values}, f"error body keys {sorted(body)}; expected the published shape"
    for k, v in values.items():
        assert body[k] == v, f"error {code} {k}={body[k]!r}; expected {v!r}"
    return body


def config(base: str) -> dict[str, Any]:
    return ok(httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT_S))


def edit(api: Api, pid: str, iid: str, **fields: Any) -> dict[str, Any]:
    version = api.items(pid)[iid]["version"]
    return ok(api.http.patch(f"/api/items/{iid}", json={"baseVersion": version, **fields}))


def link_set(api: Api, pid: str) -> set[tuple]:
    return {(l["from"], l["to"], l["type"], l["lag"]) for l in api.project(pid)["links"]}


def weekdays_from(monday: str, count: int) -> list[str]:
    d, out = date.fromisoformat(monday), []
    while len(out) < count:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def wait_for(page: Page, check_fn: Callable[[], None], what: str, seconds: float = SETTLE_S) -> None:
    deadline, last = time.monotonic() + seconds, None
    while time.monotonic() < deadline:
        try:
            check_fn()
            return
        except AssertionError as exc:
            last = exc
            advance(page, STEP_MS)
    pytest.fail(f"{what}: {last}")


def shows(page: Page, loc: Locator, value: str, what: str | None = None, seconds: float = SETTLE_S) -> None:
    wait_for(page, lambda: expect(loc).to_contain_text(value, timeout=POLL_MS), what or f"expected text {value!r}", seconds)


def attr(page: Page, loc: Locator, name: str, value: str, what: str | None = None, seconds: float = SETTLE_S) -> None:
    wait_for(page, lambda: expect(loc).to_have_attribute(name, value, timeout=POLL_MS),
             what or f"expected {name}={value!r}", seconds)


def seen(page: Page, loc: Locator, what: str, seconds: float = SETTLE_S) -> None:
    wait_for(page, lambda: expect(loc).to_be_visible(timeout=POLL_MS), what, seconds)


def gone(page: Page, loc: Locator, what: str, seconds: float = SETTLE_S) -> None:
    wait_for(page, lambda: expect(loc).to_have_count(0, timeout=POLL_MS), what, seconds)


def focused(page: Page, loc: Locator, what: str) -> None:
    wait_for(page, lambda: expect(loc).to_be_focused(timeout=POLL_MS), what)


def value_is(page: Page, loc: Locator, value: str, what: str) -> None:
    wait_for(page, lambda: expect(loc).to_have_value(value, timeout=POLL_MS), what)


def ready(page: Page, title: str) -> None:
    seen(page, page.get_by_role("heading", level=1, name=title), f"project page heading {title!r}")


def bar(page: Page, item_id: str) -> Locator:
    return page.get_by_role("region", name="Chart").locator(f'[data-item-id="{item_id}"]:not([data-baseline-bar])')


def ghost(page: Page, item_id: str) -> Locator:
    return page.locator(f'[data-baseline-bar][data-item-id="{item_id}"]')


def on_dates(page: Page, item_id: str, start: str, end: str, what: str) -> None:
    attr(page, bar(page, item_id), "data-start", start, f"{what}: bar data-start")
    attr(page, bar(page, item_id), "data-end", end, f"{what}: bar data-end")


def schedule(page: Page) -> Locator:
    return page.get_by_role("status", name="Schedule updates")


def updates(page: Page) -> Locator:
    return page.get_by_role("status", name="Project updates")


def by_id(scope: Page, ident: str) -> Locator:
    return scope.locator(f'[id="{ident}"]')


def today_line(scope: Page) -> Locator:
    return by_id(scope, "today-line")


def finish_line(scope: Page) -> Locator:
    return by_id(scope, "project-finish")


def crit_count(scope: Page) -> Locator:
    return by_id(scope, "critical-count")


def fin_variance(scope: Page) -> Locator:
    return by_id(scope, "finish-variance")


def drag_tip(scope: Page) -> Locator:
    return by_id(scope, "drag-tip")


def finish_marker(scope: Page) -> Locator:
    return by_id(scope, "finish-marker")


def alert_with(scope: Page | Locator, message: str) -> Locator:
    return scope.get_by_role("alert").filter(has_text=message).first


def tab_into(page: Page, container: Locator, presses: int = TAB_PRESSES) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if container.evaluate("(el) => el.contains(document.activeElement)"):
            return
    pytest.fail("Tab never reached the container's tab stop")


def tab_to(page: Page, target: Locator, presses: int = TAB_PRESSES) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if target.evaluate("(el) => el === document.activeElement || el.contains(document.activeElement)"):
            return
    pytest.fail("Tab never reached the published control")


def press(page: Page, key: str) -> None:
    page.keyboard.press(key)
    page.evaluate("() => 0")


def wait_present(page: Page, api: Api, pid: str, name: str) -> None:
    def check_fn() -> None:
        people = ok(api.http.get(f"/api/projects/{pid}/presence"))["people"]
        if name not in [p["name"] for p in people]:
            raise AssertionError(f"presence lists {people!r}")
    wait_for(page, check_fn, f"GET presence never listed {name}", LIVE_S)


def drag(page: Page, target: Locator, dx: float, *, release: bool = True, steps: int = 8) -> None:
    x, y = center(target)
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x + dx * i / steps, y)
    if release:
        page.mouse.up()


JS_ACTIVE = """() => {
  const a = document.activeElement;
  if (!a) return null;
  const cell = a.closest('[role=gridcell],[role=rowheader],[role=columnheader]');
  const row = a.closest('[role=row]');
  if (!cell || !row) return null;
  const cells = Array.from(row.querySelectorAll('[role=gridcell],[role=rowheader],[role=columnheader]'));
  return {item: row.getAttribute('data-item-id'), col: cells.indexOf(cell),
          header: cell.getAttribute('role') === 'columnheader', text: (cell.textContent || '').trim()};
}"""


def active(page: Page) -> dict[str, Any]:
    state = page.evaluate(JS_ACTIVE)
    if state is None:
        pytest.fail("focus is not on a cell of a grid")
    return state


def grid_goto(page: Page, grid: Locator, order: list[str], target: str | None, column: str) -> None:
    if not grid.evaluate("(g) => g.contains(document.activeElement)"):
        tab_into(page, grid)
    state = active(page)
    if state["header"]:
        press(page, "ArrowDown")
        state = active(page)
    rows: list[str | None] = list(order) + [None]
    cur = rows.index(state["item"]) if state["item"] in rows else len(order)
    tgt = rows.index(target)
    for _ in range(abs(tgt - cur)):
        press(page, "ArrowDown" if tgt > cur else "ArrowUp")
    press(page, "Home")
    for _ in range(COLS.index(column) if target is not None else 1):
        press(page, "ArrowRight")
    state = active(page)
    if state["item"] != target or (target is not None and state["col"] != COLS.index(column)):
        pytest.fail(f"Task list active cell did not reach {column} of row {target}: {state}")


def edit_cell(page: Page, column: str, value: str, commit: str = "Enter") -> Locator:
    press(page, "F2")
    editor = page.get_by_role("textbox", name=column)
    focused(page, editor, f"F2 opened the {column} textbox")
    fill(editor, value)
    press(page, commit)
    return editor


def add_row(page: Page, name: str, group: bool = False) -> None:
    press(page, name[0])
    editor = page.get_by_role("textbox", name="Name")
    focused(page, editor, "typing on the Add task row opened the Name textbox")
    fill(editor, name)
    press(page, "Shift+Enter" if group else "Enter")


def px(transform: str | None) -> float:
    if not transform or transform == "none":
        return 0.0
    m = re.search(r"translateX\((-?[\d.]+)px\)", transform)
    if not m:
        pytest.fail(f"inline transform {transform!r} is not translateX(<px>px)")
    return float(m.group(1))


def motion_state(page: Page, loc: Locator) -> tuple[str | None, float]:
    m, t = loc.evaluate("(el) => [el.getAttribute('data-motion'), el.style.transform || '']")
    return m, px(t)


def touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float], steps: int = 6) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1]}]})
    for i in range(1, steps + 1):
        x = start[0] + (end[0] - start[0]) * i / steps
        y = start[1] + (end[1] - start[1]) * i / steps
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def slider_value(loc: Locator) -> str:
    return loc.evaluate("(el) => el.getAttribute('aria-valuenow') ?? String(el.value)")


def slider_is(page: Page, loc: Locator, value: str, what: str) -> None:
    def check_fn() -> None:
        got = slider_value(loc)
        if got != value:
            raise AssertionError(f"slider value {got!r}")
    wait_for(page, check_fn, f"{what}: expected {value}")


def mails_to(mail: Any, email: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=MAIL_POLL_S) if email in addresses(m.get("To"))]


def wait_mail(mail: Any, email: str, until_s: float, what: str) -> tuple[list[dict[str, Any]], float]:
    while time.monotonic() < until_s:
        got = mails_to(mail, email)
        if got:
            return got, time.monotonic()
    pytest.fail(f"{what}: no assignment notice reached {email} in time")


def export_once(api: Api, pid: str, fmt: str) -> dict[str, Any]:
    return ok(api.http.post(f"/api/projects/{pid}/exports", json={"format": fmt}), 201)


def rows_of(boxes: list[dict[str, float]]) -> int:
    rows: list[dict[str, float]] = []
    for b in sorted(boxes, key=lambda b: b["y"]):
        if not any(b["y"] < r["bottom"] and b["y"] + b["height"] > r["top"] for r in rows):
            rows.append({"top": b["y"], "bottom": b["y"] + b["height"]})
    return len(rows)


def test_health_ok_on_every_instance(app_url: str) -> None:
    for base in (app_url, outage_url()):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"{base} health answered {r.status_code}"
        assert r.json() == {"status": "ok"}


def test_grading_setup_builds_the_plan(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, baseline={"name": "Promised"})
    data = s.response.json()
    assert set(data) == {"workspace", "users", "projects"}, "setup must return only ids"
    assert SET_COOKIE not in s.response.headers, "setup must never return a session cookie"
    assert sorted(u["email"] for u in data["users"]) == sorted(s.emails.values())
    assert set(s.ids["Spring launch"]) == {"content", "draft", "review", "write", "design", "signoff"}
    assert set(s.ids["Link examples"]) == {"a", "b", "c", "d", "e", "f"}
    asha = s.api("asha")
    listed = ok(asha.http.get("/api/projects"))["projects"]
    assert [p["name"] for p in listed] == ["Link examples", "Office move", "Spring launch"]
    assert all(p["workspace"] == {"id": s.workspace, "name": s.ws_name} for p in listed)
    assert next(p for p in listed if p["name"] == "Spring launch")["finish"] == mar(16)
    proj = asha.project(s.sp)
    assert [i["name"] for i in proj["items"]] == ["Content", "Draft brief", "Review brief", "Write copy", "Design pages", "Sign-off"]
    draft = asha.items(s.sp)[s.s["draft"]]
    assert draft["assignees"] == [{"userId": s.users["asha"], "name": "Asha Rao", "hours": 4}]
    assert draft["group"] == s.s["content"]
    assert {(l["from"], l["to"], l["type"], l["lag"]) for l in proj["links"]} == {
        (s.s["draft"], s.s["review"], "FS", 0), (s.s["draft"], s.s["write"], "SS", 1),
        (s.s["review"], s.s["design"], "FS", 0), (s.s["design"], s.s["signoff"], "FS", 0)}
    assert proj["holidays"] == [FOUNDERS]
    assert proj["baseline"] == {"name": "Promised", "finish": mar(16), "finishVariance": 0}
    assert draft["baseline"] == {"start": mar(1), "end": mar(3), "variance": 0}
    assert asha.items(s.sp)[s.s["content"]]["baseline"] is None
    expect_error(grading_setup(app_url, s.body, key="not-the-grading-key"), 404, "not_found")
    r = httpx.post(app_url + "/api/grading/setup", json=s.body, timeout=HTTP_TIMEOUT_S)
    expect_error(r, 404, "not_found")
    bad = grading_setup(app_url, {"users": "nobody"})
    assert bad.status_code == 422 and bad.json().get("error") == "invalid_field"
    assert isinstance(bad.json().get("field"), str)
    ben_email = s.emails["ben"]
    again = {"users": [{"email": ben_email, "name": "Ben Ode", "password": "ben-plans-2027-b", "capacity": 6}],
             "workspace": {"name": f"{s.ws_name} second", "members": [{"email": ben_email, "role": "owner"}]},
             "projects": []}
    ok(grading_setup(app_url, again), 201)
    expect_error(httpx.post(app_url + "/api/session", json={"email": ben_email, "password": "ben-plans-2027"},
                            timeout=HTTP_TIMEOUT_S), 401, "invalid_credentials")
    ben = Api(app_url, ben_email, "ben-plans-2027-b")
    assert len(ok(ben.http.get("/api/me"))["workspaces"]) == 2
    load = ok(ben.http.get(f"/api/workspaces/{s.workspace}/workload", params={"from": mar(1)}))
    assert next(p for p in load["people"] if p["name"] == "Ben Ode")["capacity"] == 6
    with s.page(browser, "asha", "/") as page:
        links = page.get_by_role("list", name="Projects").get_by_role("link")
        wait_for(page, lambda: expect(links).to_have_text(["Link examples", "Office move", "Spring launch"], timeout=POLL_MS),
                 "signed-in home lists the person's projects by name")


def test_wf_cross_cutting_signup_journey(browser: Browser, app_url: str) -> None:
    t = uuid.uuid4().hex[:10]
    email = f"ezra.{t}@slackwater.test"
    with open_app(browser, app_url + "/signup") as page:
        name = page.get_by_role("textbox", name="Name")
        mail_box = page.get_by_role("textbox", name="Email")
        password = page.get_by_label("Password", exact=True)
        create = page.get_by_role("button", name="Create account")
        click(create)
        seen(page, alert_with(page, "Enter your name."), "empty name refused")
        fill(name, "Ezra Vale")
        fill(mail_box, "not-an-email")
        click(create)
        seen(page, alert_with(page, "Enter a valid email address."), "bad email refused")
        fill(mail_box, email)
        fill(password, "short")
        click(create)
        seen(page, alert_with(page, "Password must be at least 10 characters."), "short password refused")
        fill(password, "ezra-plans-2027")
        click(create)
        seen(page, page.get_by_role("heading", name="Projects"), "sign-up lands signed in on Projects")
        seen(page, page.get_by_role("button", name="New project"), "New project offered")
        me = page.request.get(app_url + "/api/me")
        assert me.status == 200 and me.json()["user"]["email"] == email
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    expect_error(c.post("/api/signup", json={"name": "Ezra", "email": email, "password": "ezra-plans-2027"}), 409, "email_taken")
    expect_error(c.post("/api/signup", json={"name": "", "email": "bad", "password": "x"}), 422, "invalid_field", field="name")
    expect_error(c.post("/api/signup", json={"name": "Ezra", "email": "bad", "password": "x"}), 422, "invalid_field", field="email")
    expect_error(c.post("/api/signup", json={"name": "Ezra", "email": f"ezra2.{t}@slackwater.test", "password": "123456789"}),
                 422, "invalid_field", field="password")
    fresh = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    made = ok(fresh.post("/api/signup", json={"name": SECOND_NAME, "email": f"ezra3.{t}@slackwater.test", "password": "ezra-plans-2027"}), 201)
    assert set(made) == {"user"} and set(made["user"]) == {"id", "name", "email"}
    assert ok(fresh.get("/api/me"))["user"]["name"] == SECOND_NAME
    expect_error(c.post("/api/session", json={"email": email, "password": "wrong-password-0"}), 401, "invalid_credentials")
    signed = ok(c.post("/api/session", json={"email": email, "password": "ezra-plans-2027"}))
    assert signed["user"]["email"] == email
    assert c.delete("/api/session").status_code == 204
    expect_error(c.get("/api/me"), 401, "unauthenticated")
    with open_app(browser, app_url + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), "wrong-password-0")
        click(page.get_by_role("button", name="Sign in"))
        seen(page, alert_with(page, "Email or password is incorrect."), "wrong password refused at /signin")


def test_wf_cross_cutting_redirect_signin(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    other = Seed(app_url, projects=("spring",))
    path = f"/projects/{s.sp}?view=list"
    with open_app(browser, app_url + path) as page:
        wait_for(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=POLL_MS), "redirect to sign-in")
        assert parse_qs(urlparse(page.url).query)["next"][0] == path
        fill(page.get_by_role("textbox", name="Email"), s.emails["asha"])
        fill(page.get_by_label("Password", exact=True), PEOPLE["asha"][1])
        click(page.get_by_role("button", name="Sign in"))
        seen(page, page.get_by_role("grid", name="Task list"), "returned to the List view after sign-in")
        assert urlparse(page.url).path == f"/projects/{s.sp}" and parse_qs(urlparse(page.url).query)["view"] == ["list"]
        page.goto(app_url + f"/projects/{other.sp}")
        seen(page, page.get_by_role("heading", name="No such project."), "another workspace's project reads as missing")
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    expect_error(anon.get("/api/projects"), 401, "unauthenticated")
    expect_error(anon.get(f"/api/projects/{s.sp}"), 401, "unauthenticated")
    expect_error(s.api("asha").http.get(f"/api/projects/{other.sp}"), 404, "not_found")


def test_server_today_drives_late_flags(browser: Browser, app_url: str) -> None:
    cfg = config(app_url)
    assert cfg == {"today": TODAY, "timeZone": "Europe/London", "assignNoticeDelaySeconds": 6,
                   "presenceTimeoutSeconds": 5, "knockOnMs": 220, "knockOnStaggerMs": 45, "finishMotionMs": 320}
    s = Seed(app_url, projects=("spring",))
    items = s.api("asha").items(s.sp)
    assert items[s.s["draft"]]["late"] is True and items[s.s["write"]]["late"] is True
    assert items[s.s["review"]]["late"] is False and items[s.s["design"]]["late"] is False
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        page.clock.set_system_time(FAR_BROWSER_TIME)
        page.reload()
        ready(page, "Spring launch")
        attr(page, today_line(page), "data-date", TODAY, "today line follows the server")
        attr(page, bar(page, s.s["draft"]), "data-late", "true")
        attr(page, bar(page, s.s["write"]), "data-late", "true")
        attr(page, bar(page, s.s["review"]), "data-late", "false")


def test_error_precedence_and_limits(app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    other = Seed(app_url, projects=("spring",))
    draft = s.s["draft"]

    def body_of(size: int, **fields: Any) -> bytes:
        base = dict(fields, pad="")
        raw = json.dumps(base, separators=(",", ":")).encode()
        base["pad"] = "a" * (size - len(raw))
        data = json.dumps(base, separators=(",", ":")).encode()
        assert len(data) == size
        return data

    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    items_path = f"/api/projects/{s.sp}/items"
    expect_error(anon.post(items_path, content=body_of(BODY_LIMIT + 1, name="x"),
                           headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}), 413, "too_large")
    expect_error(anon.post("/api/session", content=body_of(BODY_LIMIT, email=s.emails["asha"], password="wrong-password-0"),
                           headers={"Content-Type": "application/json"}), 401, "invalid_credentials")
    expect_error(anon.post(items_path, content=b"name=x", headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}),
                 415, "unsupported_media_type")
    expect_error(anon.post(items_path, json={"name": "x", "kind": "task"}, headers={"Origin": EVIL_ORIGIN}), 403, "bad_origin")
    expect_error(anon.post(items_path, json={"name": "x", "kind": "task"}), 401, "unauthenticated")
    expect_error(anon.get("/api/me"), 401, "unauthenticated")
    asha = s.api("asha")
    expect_error(asha.http.patch(f"/api/items/{draft}", json={"baseVersion": 1, "name": "Hijack"},
                                 headers={"Origin": EVIL_ORIGIN}), 403, "bad_origin")
    assert asha.items(s.sp)[draft]["name"] == "Draft brief"
    own = urlparse(app_url)
    ok(asha.http.patch(f"/api/items/{draft}", json={"baseVersion": 1, "name": "Draft brief"},
                       headers={"Origin": f"{own.scheme}://{own.netloc}"}))
    expect_error(asha.http.get(f"/api/projects/{other.sp}"), 404, "not_found")
    expect_error(asha.http.get(f"/api/projects/{UNKNOWN_PROJECT}"), 404, "not_found")
    expect_error(asha.http.get(f"/api/{UNKNOWN_ENDPOINT}"), 404, "not_found")
    devi = s.api("devi")
    expect_error(devi.http.patch(f"/api/items/{UNKNOWN_ITEM}", json={"baseVersion": 1}), 404, "not_found")
    expect_error(devi.http.patch(f"/api/items/{draft}", json={}), 403, "read_only")
    expect_error(asha.http.patch(f"/api/items/{draft}", json={"baseVersion": 1, "name": ""}), 409, "version_conflict", keys=("item", "by"))
    expect_error(asha.http.patch(f"/api/items/{draft}", json={"name": "x"}), 422, "invalid_field", field="baseVersion")
    expect_error(asha.http.post(items_path, json={"name": "", "kind": "bogus"}), 422, "invalid_field", field="name")
    expect_error(asha.http.post(items_path, json={"name": "Hang signs", "kind": "bogus"}), 422, "invalid_field", field="kind")


def test_working_day_calendar(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    path = f"/api/projects/{s.sp}/items"
    sat = ok(asha.http.post(path, json={"name": "Hang signs", "kind": "task", "start": mar(6), "duration": 2}), 201)["item"]
    assert (sat["chosenStart"], sat["start"], sat["end"], sat["duration"]) == (mar(8), mar(8), mar(9), 2)
    hol = ok(asha.http.post(path, json={"name": "Ring venue", "kind": "task", "start": mar(10), "duration": 2}), 201)["item"]
    assert (hol["chosenStart"], hol["start"], hol["end"]) == (mar(11), mar(11), mar(12))
    plain = ok(asha.http.post(path, json={"name": "Check lights", "kind": "task"}), 201)["item"]
    assert (plain["start"], plain["end"], plain["duration"], plain["percent"]) == (TODAY, TODAY, 1, 0)
    stone = ok(asha.http.post(path, json={"name": "Doors open", "kind": "milestone"}), 201)["item"]
    assert (stone["start"], stone["end"], stone["duration"]) == (TODAY, TODAY, 0)
    moved = edit(asha, s.sp, s.s["draft"], start=mar(6))["item"]
    assert moved["chosenStart"] == mar(8)
    expect_error(asha.http.post(path, json={"name": "Zero", "kind": "task", "duration": 0}), 422, "invalid_field", field="duration")
    expect_error(asha.http.post(path, json={"name": "Two", "kind": "milestone", "duration": 2}), 422, "invalid_field", field="duration")
    expect_error(asha.http.post(path, json={"name": "Long", "kind": "task", "duration": 1000}), 422, "invalid_field", field="duration")
    expect_error(asha.http.post(path, json={"name": "Nest", "kind": "task", "group": s.s["draft"]}), 422, "invalid_field", field="group")
    design = asha.items(s.sp)[s.s["design"]]
    assert (design["start"], design["end"], design["duration"]) == (mar(16), mar(19), 4)
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        attr(page, page.locator(f'[data-day="{mar(10)}"]'), "data-holiday", "Founders Day")
        attr(page, page.locator(f'[data-day="{mar(10)}"]'), "data-working", "false")
        attr(page, page.locator(f'[data-day="{mar(6)}"]'), "data-working", "false")
        attr(page, page.locator(f'[data-day="{mar(11)}"]'), "data-working", "true")
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        row = page.get_by_role("grid", name="Task list").locator(f'[data-item-id="{s.s["design"]}"]')
        shows(page, row, "Tue 16 Mar 2027", "grid Start uses the long date")
        shows(page, row, "Fri 19 Mar 2027", "grid End uses the long date")


def test_project_read_model(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    proj = s.api("asha").project(s.sp)
    assert set(proj) == {"id", "name", "finish", "holidays", "items", "links", "baseline"}
    assert proj["finish"] == mar(16) and proj["baseline"] is None
    for i in proj["items"]:
        assert set(i) == {"id", "row", "name", "kind", "group", "chosenStart", "start", "end", "duration", "percent",
                          "critical", "float", "late", "version", "assignees", "baseline"}, i["name"]
        assert all(set(a) == {"userId", "name", "hours"} for a in i["assignees"])
    assert all(set(l) == {"id", "from", "to", "type", "lag", "critical"} for l in proj["links"])
    by = {i["id"]: i for i in proj["items"]}
    exp = {"content": (1, mar(1), mar(5), 5, 33, None, None), "draft": (2, mar(1), mar(3), 3, 20, 2, mar(1)),
           "review": (3, mar(4), mar(5), 2, 75, 2, mar(4)), "write": (4, mar(2), mar(3), 2, 10, 8, mar(2)),
           "design": (5, mar(11), mar(16), 4, 0, 0, mar(11)), "signoff": (6, mar(16), mar(16), 0, 0, 0, mar(15))}
    for k, (row, start, end, dur, pct, fl, chosen) in exp.items():
        i = by[s.s[k]]
        assert (i["row"], i["start"], i["end"], i["duration"], i["percent"], i["float"], i["chosenStart"]) == \
               (row, start, end, dur, pct, fl, chosen), k
        assert i["version"] == 1 and i["baseline"] is None
    assert by[s.s["content"]]["kind"] == "group" and by[s.s["signoff"]]["kind"] == "milestone"
    assert {k for k in exp if by[s.s[k]]["critical"]} == {"design", "signoff"}
    with s.page(browser, "devi", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        for k, i in ((k, by[s.s[k]]) for k in exp):
            attr(page, bar(page, i["id"]), "data-critical", str(i["critical"]).lower(), f"{k} chart critical")
            attr(page, bar(page, i["id"]), "data-percent", str(i["percent"]), f"{k} chart percent")
            attr(page, bar(page, i["id"]), "data-duration", str(i["duration"]), f"{k} chart duration")
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        grid = page.get_by_role("grid", name="Task list")
        for k, i in ((k, by[s.s[k]]) for k in exp):
            row = grid.locator(f'[data-item-id="{i["id"]}"]')
            attr(page, row, "data-critical", str(i["critical"]).lower(), f"{k} grid critical")
            attr(page, row, "data-late", str(i["late"]).lower(), f"{k} grid late")


def test_empty_project_state(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    name = f"Quiet plan {s.tag}"
    with s.page(browser, "asha", "/") as page:
        click(page.get_by_role("button", name="New project"))
        dialog = page.get_by_role("dialog", name="New project")
        seen(page, dialog, "New project dialog opens")
        click(dialog.get_by_role("button", name="Create project"))
        seen(page, alert_with(dialog, "Project name must be 1 to 80 characters."), "empty project name refused")
        fill(dialog.get_by_role("textbox", name="Project name"), name)
        click(dialog.get_by_role("button", name="Create project"))
        gone(page, dialog, "New project dialog closes after creating")
        projects = ok(s.api("asha").http.get("/api/projects"))["projects"]
        made = next((p for p in projects if p["name"] == name), None)
        assert made is not None and made["finish"] is None and made["workspace"]["id"] == s.workspace
        page.goto(app_url + f"/projects/{made['id']}")
        ready(page, name)
        seen(page, page.get_by_text("No tasks yet. Add the first task in the list.", exact=True), "empty sentence")
        shows(page, finish_line(page), "No finish date yet")
        expect(fin_variance(page)).to_have_count(0)
        shows(page, crit_count(page), "No critical tasks")
        expect(page.get_by_role("region", name="Chart")).to_have_count(0)
        click(page.get_by_role("button", name="Open the list"))
        attr(page, page.get_by_role("tab", name="List"), "aria-selected", "true", "Open the list selects the List tab")
        seen(page, page.get_by_role("grid", name="Task list"), "the Task list grid is shown")
        assert parse_qs(urlparse(page.url).query).get("view") == ["list"]
    assert s.api("asha").project(made["id"])["items"] == []


def test_task_list_grid_keyboard(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    order = [s.s[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        wait_for(page, lambda: expect(grid.get_by_role("columnheader")).to_have_text(COLS, timeout=POLL_MS), "published columns")
        tab_into(page, grid)
        st = active(page)
        assert (st["item"], st["col"], st["text"]) == (s.s["content"], 1, "Content"), st
        press(page, "ArrowRight")
        assert active(page)["text"] == "Mon 1 Mar 2027"
        press(page, "End")
        assert active(page)["col"] == len(COLS) - 1
        press(page, "Home")
        assert active(page)["col"] == 0
        press(page, "ArrowDown")
        assert active(page)["item"] == s.s["draft"]
        grid_goto(page, grid, order, s.s["draft"], "Name")
        press(page, "Enter")
        name_box = page.get_by_role("textbox", name="Name")
        value_is(page, name_box, "Draft brief", "Enter opens Name holding the value")
        press(page, "Escape")
        gone(page, name_box, "Escape closes the editor")
        press(page, "Z")
        value_is(page, name_box, "Z", "a typed character replaces the value")
        press(page, "Escape")
        shows(page, grid.locator(f'[data-item-id="{s.s["draft"]}"]'), "Draft brief", "Escape kept the old value")
        edit_cell(page, "Name", "Draft outline", commit="Tab")
        shows(page, schedule(page), "Draft outline saved.")
        st = active(page)
        assert (st["item"], st["col"]) == (s.s["draft"], COLS.index("Start")), st
        grid_goto(page, grid, order, s.s["review"], "Duration")
        edit_cell(page, "Duration", "3")
        wait_for(page, lambda: expect(grid.locator(f'[data-item-id="{s.s["review"]}"]')).to_contain_text("Mon 8 Mar 2027", timeout=POLL_MS),
                 "duration saved and End recomputed")
        st = active(page)
        assert (st["item"], st["col"]) == (s.s["write"], COLS.index("Duration")), st
        grid_goto(page, grid, order, s.s["write"], "Duration")
        editor = edit_cell(page, "Duration", "1000")
        attr(page, editor, "aria-invalid", "true")
        seen(page, alert_with(page, "Duration must be a whole number from 0 to 999."), "duration refusal in page alert")
        press(page, "Escape")
        grid_goto(page, grid, order, s.s["write"], "End")
        press(page, "Enter")
        expect(page.get_by_role("textbox", name="End")).to_have_count(0)
        grid_goto(page, grid, order, s.s["content"], "Start")
        press(page, "Enter")
        expect(page.get_by_role("textbox", name="Start")).to_have_count(0)
        grid_goto(page, grid, order, s.s["signoff"], "Start")
        assert active(page)["text"] == "Tue 16 Mar 2027"
        press(page, "F2")
        value_is(page, page.get_by_role("textbox", name="Start"), mar(15), "Start editor holds the chosen start")
        press(page, "Escape")
        grid_goto(page, grid, order, s.s["write"], "% complete")
        assert active(page)["text"] == "10%"
        press(page, "F2")
        value_is(page, page.get_by_role("textbox", name="% complete"), "10", "% complete edited without %")
        press(page, "Escape")
        grid_goto(page, grid, order, s.s["design"], "Assignees")
        assert active(page)["text"] == "Ben Ode (8)"
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Task details")
        seen(page, dialog, "Enter on Assignees opens Task details")
        press(page, "Escape")
        gone(page, dialog, "Escape closes Task details")
        assert active(page)["col"] == COLS.index("Assignees")
        grid_goto(page, grid, order, s.s["write"], "Duration")
        edit_cell(page, "Duration", "0")
        grid_goto(page, grid, order, None, "Name")
        add_row(page, "Book hall")
        shows(page, schedule(page), "Book hall added as row 7.")
        st = active(page)
        assert st["item"] is None, st
        expect(page.get_by_role("textbox", name="Name")).to_have_count(0)
        add_row(page, "Stage", group=True)
        shows(page, schedule(page), "Stage added as row 8.")
        press(page, "Enter")
        press(page, "Enter")
        expect(page.get_by_role("textbox", name="Name")).to_have_count(0)
    items = list(asha.project(s.sp)["items"])
    assert len(items) == 8, "Enter with an empty name must add nothing"
    by = {i["id"]: i for i in items}
    assert by[s.s["draft"]]["name"] == "Draft outline"
    assert by[s.s["review"]]["duration"] == 3 and by[s.s["write"]]["duration"] == 0 and by[s.s["write"]]["kind"] == "milestone"
    assert by[s.s["write"]]["version"] == 2, "the refused 1000 and the cancelled edits saved nothing"
    hall, stage = items[6], items[7]
    assert (hall["name"], hall["kind"], hall["start"], hall["duration"], hall["percent"]) == ("Book hall", "task", TODAY, 1, 0)
    assert (stage["name"], stage["kind"]) == ("Stage", "group")


def test_predecessors_cell(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    order = [s.s[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        for k, canon in (("review", "2FS"), ("write", "2SS+1"), ("design", "3FS"), ("signoff", "5FS")):
            shows(page, grid.locator(f'[data-item-id="{s.s[k]}"]'), canon, f"{k} canonical predecessors")
        grid_goto(page, grid, order, s.s["design"], "Predecessors")
        edit_cell(page, "Predecessors", "3fs, 4 ss -1")
        shows(page, schedule(page), "Predecessors of Design pages set to 3FS, 4SS-1. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        shows(page, grid.locator(f'[data-item-id="{s.s["design"]}"]'), "3FS, 4SS-1")
        grid_goto(page, grid, order, s.s["draft"], "Predecessors")
        editor = edit_cell(page, "Predecessors", "5")
        attr(page, editor, "aria-invalid", "true")
        seen(page, alert_with(page, LOOP_SPRING), "loop refused in the page alert")
        press(page, "Escape")
        grid_goto(page, grid, order, s.s["write"], "Predecessors")
        edit_cell(page, "Predecessors", "")
        shows(page, schedule(page), "Predecessors of Write copy cleared.")
    links = link_set(asha, s.sp)
    assert {(a, b, t, l) for a, b, t, l in links if b == s.s["design"]} == {
        (s.s["review"], s.s["design"], "FS", 0), (s.s["write"], s.s["design"], "SS", -1)}
    assert not any(b in (s.s["draft"], s.s["write"]) for _, b, _, _ in links)
    assert asha.items(s.sp)[s.s["write"]]["start"] == mar(2)
    before = link_set(asha, s.sp)
    cases = [("review", "x", "Write predecessors like 2FS+1, 3SS-2."),
             ("review", "9", "There is no row 9."),
             ("design", "5", "A task cannot wait for itself."),
             ("review", "1", "Groups cannot be linked."),
             ("review", "2FS+31", "Lag must be between -30 and 30 working days."),
             ("review", "2, 2SS", "Row 2 is listed twice."),
             ("review", "x, 9", "Write predecessors like 2FS+1, 3SS-2."),
             ("review", "9, 1", "There is no row 9."),
             ("review", "1, 9", "Groups cannot be linked."),
             ("draft", "5", LOOP_SPRING)]
    for k, entry, message in cases:
        version = asha.items(s.sp)[s.s[k]]["version"]
        r = asha.http.put(f"/api/items/{s.s[k]}/predecessors", json={"baseVersion": version, "text": entry})
        expect_error(r, 422, "invalid_predecessors", message=message)
        assert link_set(asha, s.sp) == before, f"refused {entry!r} changed the links"
    expect_error(asha.http.put(f"/api/items/{s.s['review']}/predecessors", json={"baseVersion": 99, "text": "2"}),
                 409, "version_conflict", keys=("item", "by"))


def test_keyboard_reorder_and_grouping(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        order = [S[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
        grid_goto(page, grid, order, S["design"], "Name")
        press(page, "Alt+ArrowUp")
        shows(page, schedule(page), "Design pages moved to row 1.")
        assert active(page)["item"] == S["design"], "active cell follows the moved item"
        order = [S[k] for k in ("design", "content", "draft", "review", "write", "signoff")]
        grid_goto(page, grid, order, S["draft"], "Name")
        press(page, "Alt+ArrowDown")
        shows(page, schedule(page), "Draft brief moved to row 4.")
        order = [S[k] for k in ("design", "content", "review", "draft", "write", "signoff")]
        grid_goto(page, grid, order, S["write"], "Name")
        press(page, "Alt+ArrowLeft")
        shows(page, schedule(page), "Write copy is no longer in a group.")
        grid_goto(page, grid, order, S["signoff"], "Name")
        press(page, "Alt+ArrowRight")
        shows(page, schedule(page), "Sign-off is now in Content.")
        shows(page, grid.locator(f'[data-item-id="{S["review"]}"]'), "4FS", "review predecessors follow the new rows")
        shows(page, grid.locator(f'[data-item-id="{S["signoff"]}"]'), "1FS", "sign-off predecessors follow the new rows")
    items = asha.project(s.sp)["items"]
    assert [i["id"] for i in items] == [S[k] for k in ("design", "content", "review", "draft", "signoff", "write")]
    assert [i["row"] for i in items] == [1, 2, 3, 4, 5, 6]
    by = {i["id"]: i for i in items}
    assert by[S["write"]]["group"] is None and by[S["signoff"]]["group"] == S["content"]
    first = ok(asha.http.post(f"/api/items/{S['design']}/reorder", json={"direction": "up"}))
    assert first["changed"] is False and [r["id"] for r in first["rows"]] == [i["id"] for i in items]
    assert set(first["rows"][0]) == {"id", "row", "group"}
    expect_error(asha.http.post(f"/api/items/{S['content']}/reorder", json={"direction": "up"}), 422, "not_reorderable")
    expect_error(asha.http.post(f"/api/items/{S['draft']}/reorder", json={"direction": "sideways"}),
                 422, "invalid_field", field="direction")
    ok(asha.http.delete(f"/api/items/{S['content']}"))
    after = asha.project(s.sp)["items"]
    assert [i["id"] for i in after] == [S[k] for k in ("design", "review", "draft", "signoff", "write")]
    assert all(i["group"] is None for i in after)


def test_wf_list_grid_build_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    pid = ok(asha.http.post("/api/projects", json={"name": f"Kitchen refit {s.tag}", "workspace": s.workspace}), 201)["project"]["id"]
    title = f"Kitchen refit {s.tag}"
    with s.page(browser, "ben", f"/projects/{pid}") as watch, s.page(browser, "asha", f"/projects/{pid}?view=list") as page:
        ready(watch, title)
        ready(page, title)
        grid = page.get_by_role("grid", name="Task list")
        tab_into(page, grid)
        assert active(page)["item"] is None, "an empty project's active cell is on the Add task row"
        names = ["Survey site", "Fit kitchen", "Paint walls"]
        for n, name in enumerate(names, start=1):
            add_row(page, name)
            shows(page, schedule(page), f"{name} added as row {n}.")
            iid = next(i["id"] for i in asha.project(pid)["items"] if i["name"] == name)
            seen(watch, bar(watch, iid), f"the editor's chart shows {name} as it arrives", LIVE_S)
        add_row(page, "Finishing", group=True)
        shows(page, schedule(page), "Finishing added as row 4.")
        ids = {i["name"]: i["id"] for i in asha.project(pid)["items"]}
        order = [ids[n] for n in names] + [ids["Finishing"]]
        grid_goto(page, grid, order, ids["Survey site"], "Duration")
        press(page, "3")
        press(page, "Enter")
        attr(watch, bar(watch, ids["Survey site"]), "data-end", mar(8), "survey lasts three working days", LIVE_S)
        grid_goto(page, grid, order, ids["Fit kitchen"], "Predecessors")
        press(page, "1")
        fill(page.get_by_role("textbox", name="Predecessors"), "1FS+1")
        press(page, "Enter")
        shows(page, schedule(page), "Predecessors of Fit kitchen set to 1FS+1.")
        grid_goto(page, grid, order, ids["Paint walls"], "Name")
        press(page, "Alt+ArrowDown")
        shows(page, schedule(page), "Paint walls moved to row 4.")
        press(page, "Alt+ArrowRight")
        shows(page, schedule(page), "Paint walls is now in Finishing.")
        attr(watch, bar(watch, ids["Finishing"]), "data-kind", "group", "the editor's chart draws the now non-empty group", LIVE_S)
        attr(watch, watch.locator(f'[data-link-id][data-from="{ids["Survey site"]}"][data-to="{ids["Fit kitchen"]}"]'),
             "data-lag", "1", "the editor's chart draws the link", LIVE_S)
        page.reload()
        ready(page, title)
        shows(page, page.get_by_role("grid", name="Task list").locator(f'[data-item-id="{ids["Fit kitchen"]}"]'), "1FS+1")
    items = asha.project(pid)
    rows = {i["name"]: i for i in items["items"]}
    assert [i["name"] for i in items["items"]] == ["Survey site", "Fit kitchen", "Finishing", "Paint walls"]
    assert (rows["Survey site"]["start"], rows["Survey site"]["end"], rows["Survey site"]["duration"]) == (TODAY, mar(8), 3)
    assert rows["Fit kitchen"]["start"] == mar(10)
    assert rows["Paint walls"]["group"] == rows["Finishing"]["id"]
    assert {(l["from"], l["to"], l["type"], l["lag"]) for l in items["links"]} == {(ids["Survey site"], ids["Fit kitchen"], "FS", 1)}


def test_wf_list_grid_build_bad_predecessor(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    order = [s.s[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        grid_goto(page, grid, order, s.s["review"], "Predecessors")
        editor = edit_cell(page, "Predecessors", "9")
        attr(page, editor, "aria-invalid", "true")
        seen(page, alert_with(page, "There is no row 9."), "missing row refused")
        assert link_set(asha, s.sp) == {(s.s["draft"], s.s["review"], "FS", 0), (s.s["draft"], s.s["write"], "SS", 1),
                                        (s.s["review"], s.s["design"], "FS", 0), (s.s["design"], s.s["signoff"], "FS", 0)}
        fill(editor, "2FS+1")
        press(page, "Enter")
        shows(page, schedule(page), "Predecessors of Review brief set to 2FS+1. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        shows(page, grid.locator(f'[data-item-id="{s.s["review"]}"]'), "2FS+1")
    review = asha.items(s.sp)[s.s["review"]]
    assert (review["start"], review["end"]) == (mar(5), mar(8))
    assert (s.s["draft"], s.s["review"], "FS", 1) in link_set(asha, s.sp)


def test_pointer_drag_snap_resize_and_cancel(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        review = bar(page, s.s["review"])
        drag(page, review, DRAG_PX, release=False)
        shows(page, drag_tip(page), "Mon 8 Mar 2027 - Tue 9 Mar 2027", "drag tip shows the snapped result")
        press(page, "Escape")
        page.mouse.up()
        on_dates(page, s.s["review"], mar(4), mar(5), "Escape put the bar back")
        drag(page, review, DRAG_PX)
        shows(page, schedule(page), "Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027.")
        on_dates(page, s.s["write"], mar(2), mar(3), "")
        drag(page, bar(page, s.s["write"]).locator('[data-handle="end"]'), -DRAG_PX)
        attr(page, bar(page, s.s["write"]), "data-duration", "1", "end handle never goes before the start")
        drag(page, bar(page, s.s["draft"]).locator('[data-handle="start"]'), DRAG_PX)
        attr(page, bar(page, s.s["draft"]), "data-start", mar(3), "start handle moves the start and keeps the end")
    items = asha.items(s.sp)
    r = items[s.s["review"]]
    assert (r["chosenStart"], r["start"], r["end"], r["duration"], r["version"]) == (mar(8), mar(8), mar(9), 2, 2)
    assert items[s.s["design"]]["start"] == mar(11), "no dependent moved"
    w = items[s.s["write"]]
    assert w["duration"] == 1
    d = items[s.s["draft"]]
    assert (d["end"], d["duration"]) == (mar(3), 1)


def test_holidays_dialog(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    path = f"/api/projects/{s.sp}/holidays"
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        click(page.get_by_role("button", name="Holidays"))
        dialog = page.get_by_role("dialog", name="Holidays")
        shows(page, dialog.get_by_role("list", name="Holidays"), "Wed 10 Mar 2027 Founders Day")
        date_box, name_box = dialog.get_by_role("textbox", name="Date"), dialog.get_by_role("textbox", name="Holiday name")
        add = dialog.get_by_role("button", name="Add holiday")
        for when, label, message in (("15/03/2027", "Quiet day", "Enter a date as YYYY-MM-DD."),
                                     (mar(15), "", "Holiday name must be 1 to 60 characters."),
                                     (mar(10), "Quiet day", "That date is already a holiday.")):
            fill(date_box, when)
            fill(name_box, label)
            click(add)
            seen(page, alert_with(dialog, message), f"holiday refusal {message}")
        fill(date_box, mar(15))
        fill(name_box, "Quiet day")
        click(add)
        shows(page, schedule(page), "Holiday Quiet day added. 2 tasks moved. Project finishes Wed 17 Mar 2027.")
        shows(page, dialog.get_by_role("list", name="Holidays"), "Mon 15 Mar 2027 Quiet day")
        attr(page, page.locator(f'[data-day="{mar(15)}"]'), "data-holiday", "Quiet day")
        attr(page, page.locator(f'[data-day="{mar(15)}"]'), "data-working", "false")
        on_dates(page, s.s["design"], mar(11), mar(17), "design skips the new holiday")
        assert asha.items(s.sp)[s.s["design"]]["end"] == mar(17)
        click(dialog.get_by_role("button", name="Remove Quiet day"))
        shows(page, schedule(page), "Holiday Quiet day removed. 2 tasks moved. Project finishes Tue 16 Mar 2027.")
        attr(page, page.locator(f'[data-day="{mar(15)}"]'), "data-working", "true")
    proj = asha.project(s.sp)
    assert proj["holidays"] == [FOUNDERS] and proj["finish"] == mar(16)
    expect_error(asha.http.post(path, json={"date": "2027-3-15", "name": "Quiet day"}), 422, "invalid_field", field="date")
    expect_error(asha.http.post(path, json={"date": mar(15), "name": "x" * 61}), 422, "invalid_field", field="name")
    expect_error(asha.http.post(path, json={"date": mar(6), "name": "Quiet day"}), 422, "weekend")
    expect_error(asha.http.post(path, json={"date": mar(10), "name": "Quiet day"}), 409, "duplicate_holiday")
    expect_error(asha.http.delete(f"{path}/{mar(15)}"), 404, "not_found")
    assert asha.project(s.sp)["holidays"] == [FOUNDERS], "refused holidays saved nothing"
    made = ok(asha.http.post(path, json={"date": mar(15), "name": "Quiet day"}), 201)
    assert made["holiday"] == {"date": mar(15), "name": "Quiet day"} and made["finish"] == mar(17)


def test_wf_drag_calendar_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        review = bar(page, s.s["review"])
        drag(page, review, DRAG_PX)
        shows(page, schedule(page), "Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027. No dependent tasks moved.")
        drag(page, review.locator('[data-handle="end"]'), DRAG_PX)
        shows(page, schedule(page), "Review brief now lasts 3 working days and ends Thu 11 Mar 2027.")
        drag(page, review, DRAG_PX, release=False)
        seen(page, drag_tip(page), "drag tip during the cancelled drag")
        press(page, "Escape")
        page.mouse.up()
        on_dates(page, s.s["review"], mar(8), mar(11), "Escape kept the bar")
        holidays = page.get_by_role("button", name="Holidays")
        tab_to(page, holidays)
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Holidays")
        tab_to(page, dialog.get_by_role("textbox", name="Date"))
        page.keyboard.type(mar(15))
        tab_to(page, dialog.get_by_role("textbox", name="Holiday name"))
        page.keyboard.type("Quiet day")
        tab_to(page, dialog.get_by_role("button", name="Add holiday"))
        press(page, "Enter")
        shows(page, schedule(page), "Holiday Quiet day added. 2 tasks moved. Project finishes Thu 18 Mar 2027.")
        press(page, "Escape")
        focused(page, holidays, "Escape returns focus to Holidays")
        page.reload()
        ready(page, "Spring launch")
        on_dates(page, s.s["review"], mar(8), mar(11), "review after reload")
        on_dates(page, s.s["design"], mar(12), mar(18), "design after reload")
        on_dates(page, s.s["signoff"], mar(18), mar(18), "sign-off after reload")
        attr(page, page.locator(f'[data-day="{mar(15)}"]'), "data-holiday", "Quiet day")
    items = asha.items(s.sp)
    assert (items[s.s["review"]]["duration"], items[s.s["review"]]["version"]) == (3, 3), "the cancelled drag saved nothing"
    assert (items[s.s["design"]]["start"], items[s.s["design"]]["end"]) == (mar(12), mar(18))
    assert asha.project(s.sp)["finish"] == mar(18)


def test_wf_drag_calendar_holiday_recovery(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        holidays = page.get_by_role("button", name="Holidays")
        tab_to(page, holidays)
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Holidays")
        date_box = dialog.get_by_role("textbox", name="Date")
        tab_to(page, date_box)
        page.keyboard.type(mar(6))
        tab_to(page, dialog.get_by_role("textbox", name="Holiday name"))
        page.keyboard.type("Quiet day")
        tab_to(page, dialog.get_by_role("button", name="Add holiday"))
        press(page, "Enter")
        seen(page, alert_with(dialog, "That date is a weekend."), "weekend refused")
        fill(date_box, mar(15))
        tab_to(page, dialog.get_by_role("button", name="Add holiday"))
        press(page, "Enter")
        shows(page, schedule(page), "Holiday Quiet day added. 2 tasks moved. Project finishes Wed 17 Mar 2027.")
        press(page, "Escape")
        focused(page, holidays, "Escape returns focus to Holidays")
        page.reload()
        ready(page, "Spring launch")
        attr(page, page.locator(f'[data-day="{mar(15)}"]'), "data-holiday", "Quiet day")
        on_dates(page, s.s["design"], mar(11), mar(17), "design after reload")
    proj = s.api("asha").project(s.sp)
    assert proj["holidays"] == [FOUNDERS, {"date": mar(15), "name": "Quiet day"}]


def test_wf_drag_calendar_touch_tablet(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}", TABLET) as owner, s.page(browser, "ben", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        review = bar(owner, S["review"])
        x, y = center(review)
        touch_drag(owner, (x, y), (x + DRAG_PX, y))
        shows(owner, schedule(owner), "Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        on_dates(owner, S["review"], mar(8), mar(9), "touch drop on Sat 6 Mar snaps to Mon 8 Mar")
        wait_for(owner, lambda: expect(review).to_have_accessible_description(
            "Starts Mon 8 Mar 2027, ends Tue 9 Mar 2027. 2 working days, 75% complete. Critical. Waits for Draft brief, finish to start, lag 0.",
            timeout=POLL_MS), "Review brief's description after the touch drop")
        shows(owner, crit_count(owner), "3 critical tasks")
        attr(editor, bar(editor, S["review"]), "data-start", mar(8), "the editor's chart shows the touch drop", LIVE_S)
        shows(editor, updates(editor), "Asha Rao changed Review brief.", seconds=LIVE_S)
        hx, hy = center(review.locator('[data-handle="end"]'))
        touch_drag(owner, (hx, hy), (hx + DRAG_PX, hy))
        shows(owner, schedule(owner), "Review brief now lasts 3 working days and ends Thu 11 Mar 2027. 2 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        for k, a, b in (("design", mar(12), mar(17)), ("signoff", mar(17), mar(17))):
            on_dates(owner, S[k], a, b, f"{k} after the touch resize")
            attr(editor, bar(editor, S[k]), "data-start", a, f"the editor's chart shows {k} moved", LIVE_S)
        assert owner.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "the tablet page scrolls sideways"
    r = s.api("asha").items(s.sp)[S["review"]]
    assert (r["chosenStart"], r["start"], r["end"], r["duration"]) == (mar(8), mar(8), mar(11), 3)


def test_bar_keys_move_and_resize(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        tab_into(page, page.get_by_role("region", name="Chart"))
        draft = bar(page, s.s["draft"])
        focused(page, draft, "the chart tab stop starts on the first task bar")
        press(page, "ArrowUp")
        expect(bar(page, s.s["content"])).not_to_be_focused()
        press(page, "ArrowDown")
        focused(page, bar(page, s.s["review"]), "ArrowDown moves to the next bar")
        press(page, "ArrowUp")
        focused(page, draft, "ArrowUp moves back")
        press(page, "ArrowRight")
        attr(page, draft, "data-start", mar(2), "ArrowRight moved one working day")
        focused(page, draft, "focus kept after the redraw")
        press(page, "ArrowLeft")
        attr(page, draft, "data-start", mar(1), "ArrowLeft moved back one working day")
        press(page, "Shift+ArrowRight")
        attr(page, draft, "data-duration", "4", "Shift+ArrowRight adds a working day")
        attr(page, draft, "data-end", mar(4))
        focused(page, draft, "focus kept after resize")
        review = bar(page, s.s["review"])
        click(review)
        focused(page, review, "clicking a bar focuses it")
        press(page, "Shift+ArrowLeft")
        attr(page, review, "data-duration", "1", "Shift+ArrowLeft removes a working day")
        press(page, "Shift+ArrowLeft")
        shows(page, schedule(page), "Review brief is already 1 working day long.")
        signoff = bar(page, s.s["signoff"])
        click(signoff)
        press(page, "Shift+ArrowRight")
        press(page, "ArrowRight")
        shows(page, schedule(page), "Sign-off is now on Wed 17 Mar 2027.")
        focused(page, signoff, "focus kept on the milestone")
        edit(s.api("ben"), s.sp, s.s["write"], percent=30)
        attr(page, bar(page, s.s["write"]), "data-percent", "30", "pushed change redrew the chart", LIVE_S)
        focused(page, signoff, "focus kept after a pushed change")
    items = asha.items(s.sp)
    d = items[s.s["draft"]]
    assert (d["chosenStart"], d["duration"], d["version"]) == (mar(1), 4, 4)
    assert (items[s.s["review"]]["duration"], items[s.s["review"]]["version"]) == (1, 2), "the one-day press saved nothing"
    so = items[s.s["signoff"]]
    assert (so["kind"], so["start"], so["version"]) == ("milestone", mar(17), 2), "Shift ignored on a milestone"


def test_bar_keys_open_dialogs(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, s.s["draft"])
        click(draft)
        press(page, "Enter")
        details = page.get_by_role("dialog", name="Task details")
        seen(page, details, "Enter opens Task details")
        value_is(page, details.get_by_role("textbox", name="Name"), "Draft brief", "Task details is for the bar's item")
        press(page, "Escape")
        gone(page, details, "Escape closes Task details")
        focused(page, draft, "focus back on the bar")
        press(page, "l")
        add = page.get_by_role("dialog", name="Add link")
        seen(page, add.get_by_role("heading", name=f"Link from {DRAFT_BRIEF}"), "L opens Add link from this bar")
        press(page, "Escape")
        gone(page, add, "Escape closes Add link")
        focused(page, draft, "focus back on the bar")


def test_chosen_start_and_link_bounds(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        drag(page, bar(page, s.s["review"]), -3 * DAY_PX)
        shows(page, schedule(page), "Review brief can start no earlier than Thu 4 Mar 2027 because of Draft brief.")
        r = asha.items(s.sp)[s.s["review"]]
        assert (r["chosenStart"], r["start"]) == (mar(1), mar(4))
        ok(asha.http.post(f"/api/projects/{s.sp}/links", json={"from": s.s["write"], "to": s.s["design"], "type": "FS", "lag": 0}), 201)
        design = bar(page, s.s["design"])
        click(design)
        press(page, "Enter")
        details = page.get_by_role("dialog", name="Task details")
        fill(details.get_by_role("textbox", name="Start"), mar(1))
        click(details.get_by_role("button", name="Save task"))
        shows(page, schedule(page), "Design pages can start no earlier than Mon 8 Mar 2027 because of Review brief.")
        attr(page, design, "data-start", mar(8))
    d = asha.items(s.sp)[s.s["design"]]
    assert (d["chosenStart"], d["start"]) == (mar(1), mar(8))


def test_bar_descriptions(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    expected = {
        "content": ("Content", "Group from Mon 1 Mar 2027 to Fri 5 Mar 2027. 33% complete."),
        "draft": ("Draft brief", "Starts Mon 1 Mar 2027, ends Wed 3 Mar 2027. 3 working days, 20% complete. Late."),
        "review": ("Review brief", "Starts Thu 4 Mar 2027, ends Fri 5 Mar 2027. 2 working days, 75% complete. Waits for Draft brief, finish to start, lag 0."),
        "write": ("Write copy", "Starts Tue 2 Mar 2027, ends Wed 3 Mar 2027. 2 working days, 10% complete. Late. Waits for Draft brief, start to start, lag 1."),
        "design": ("Design pages", "Starts Thu 11 Mar 2027, ends Tue 16 Mar 2027. 4 working days, 0% complete. Critical. Waits for Review brief, finish to start, lag 0."),
        "signoff": ("Sign-off", "Milestone on Tue 16 Mar 2027. Not done. Critical. Waits for Design pages, finish to start, lag 0."),
    }
    with s.page(browser, "devi", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        for k, (name, desc) in expected.items():
            b = bar(page, s.s[k])
            wait_for(page, lambda b=b, name=name: expect(b).to_have_accessible_name(name, timeout=POLL_MS), f"{k} accessible name")
            wait_for(page, lambda b=b, desc=desc: expect(b).to_have_accessible_description(desc, timeout=POLL_MS), f"{k} description")


def test_schedule_updates_after_answer(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring", "office"))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, s.s["draft"])
        click(draft)
        page.route("**/api/items/*", lambda route: route.abort())
        press(page, "ArrowRight")
        seen(page, alert_with(page, "Your change could not be saved. Try again."), "unanswered edit shows the save alert")
        attr(page, draft, "data-start", mar(1), "the bar returns to the server's place")
        expect(schedule(page)).not_to_contain_text("Draft brief now starts")
        page.unroute("**/api/items/*")
        with held(page, "**/api/items/*") as gate:
            press(page, "ArrowRight")
            attr(page, draft, "aria-busy", "true", "the bar is busy while the edit is in flight")
            expect(schedule(page)).not_to_contain_text("Draft brief now starts")
            gate.release()
        shows(page, schedule(page), "Draft brief now starts Tue 2 Mar 2027 and ends Thu 4 Mar 2027.")
        expect(draft).not_to_have_attribute("aria-busy", "true")
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        grid = page.get_by_role("grid", name="Task list")
        order = [s.s[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
        grid_goto(page, grid, order, s.s["draft"], "% complete")
        edit_cell(page, "% complete", "40")
        shows(page, schedule(page), "Draft brief is 40% complete.")
        office, pack = s.pid["Office move"], s.ids["Office move"]["pack"]
        page.goto(app_url + f"/projects/{office}?task={pack}")
        details = page.get_by_role("dialog", name="Task details")
        seen(page, details, "?task= opens Task details")
        click(details.get_by_role("button", name="Delete task"))
        shows(page, schedule(page), "Pack desks deleted. The project has no tasks left.")
    assert asha.items(s.sp)[s.s["draft"]]["chosenStart"] == mar(2)
    assert asha.project(s.pid["Office move"])["items"] == []


def test_viewers_cannot_edit(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    devi, asha = s.api("devi"), s.api("asha")
    S = s.s
    writes = [
        ("patch", f"/api/items/{S['draft']}", {"baseVersion": 1, "name": "Mine"}),
        ("post", f"/api/projects/{s.sp}/items", {"name": "Mine", "kind": "task"}),
        ("delete", f"/api/items/{S['draft']}", None),
        ("post", f"/api/items/{S['draft']}/reorder", {"direction": "down"}),
        ("put", f"/api/items/{S['review']}/predecessors", {"baseVersion": 1, "text": ""}),
        ("post", f"/api/projects/{s.sp}/links", {"from": S["write"], "to": S["signoff"], "type": "FS", "lag": 0}),
        ("post", f"/api/projects/{s.sp}/holidays", {"date": mar(15), "name": "Quiet day"}),
        ("delete", f"/api/projects/{s.sp}/holidays/{mar(10)}", None),
        ("post", f"/api/projects/{s.sp}/baseline", {"name": "Mine"}),
        ("post", f"/api/items/{S['review']}/assignees", {"userId": s.users["cara"], "hours": 2}),
        ("delete", f"/api/items/{S['draft']}/assignees/{s.users['asha']}", None),
        ("post", f"/api/items/{S['draft']}/comments", {"text": "Mine"}),
        ("post", "/api/projects", {"name": "Mine", "workspace": s.workspace}),
    ]
    before = asha.project(s.sp)
    for method, path, body in writes:
        r = getattr(devi.http, method)(path, json=body) if body is not None else getattr(devi.http, method)(path)
        expect_error(r, 403, "read_only")
    assert asha.project(s.sp) == before, "a refused viewer write changed the project"
    ok(devi.http.get(f"/api/projects/{s.sp}"))
    ok(devi.http.get(f"/api/workspaces/{s.workspace}/workload", params={"from": mar(1)}))
    export_once(devi, s.sp, "csv")
    with s.page(browser, "devi", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, S["draft"])
        attr(page, draft, "aria-disabled", "true")
        draft.focus()
        press(page, "ArrowRight")
        shows(page, schedule(page), READ_ONLY)
        review_box = bar(page, S["review"]).bounding_box()
        assert review_box, "Review brief's bar is not laid out"
        rx, ry = review_box["x"] + review_box["width"] / 2, review_box["y"] + review_box["height"] / 2
        page.mouse.move(rx, ry)
        page.mouse.down()
        for i in range(1, 9):
            page.mouse.move(rx + DRAG_PX * i / 8, ry)
        page.mouse.up()
        attr(page, bar(page, S["review"]), "data-start", mar(4), "a viewer drag changes nothing")
        for name in ("Save baseline", "Holidays"):
            attr(page, page.get_by_role("button", name=name), "aria-disabled", "true")
        page.get_by_role("button", name="Save baseline").focus()
        press(page, "Enter")
        seen(page, alert_with(page, READ_ONLY), "activating Save baseline shows the read-only alert")
        page.goto(app_url + f"/projects/{s.sp}?task={S['draft']}")
        details = page.get_by_role("dialog", name="Task details")
        seen(page, details, "?task= opens read-only Task details for a viewer")
        for name in ("Save task", "Delete task", "Assign", "Post comment"):
            expect(details.get_by_role("button", name=name)).to_have_count(0)
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        grid = page.get_by_role("grid", name="Task list")
        tab_into(page, grid)
        press(page, "Enter")
        expect(page.get_by_role("textbox", name="Name")).to_have_count(0)
    assert asha.project(s.sp)["items"] == before["items"]


def test_wf_keyboard_bars_owner_nudge(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        tab_into(page, page.get_by_role("region", name="Chart"))
        draft = bar(page, s.s["draft"])
        focused(page, draft, "first bar holds the tab stop")
        for day in (2, 3, 4):
            press(page, "ArrowRight")
            attr(page, draft, "data-start", mar(day), f"nudge to {mar(day)}")
            focused(page, draft, "focus stays on the nudged bar")
        shows(page, schedule(page), "Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        press(page, "Shift+ArrowRight")
        shows(page, schedule(page), "Draft brief now lasts 4 working days and ends Tue 9 Mar 2027.")
        focused(page, draft, "focus stays after resize")
        page.reload()
        ready(page, "Spring launch")
        on_dates(page, s.s["draft"], mar(4), mar(9), "dates survive a reload")
    d = s.api("asha").items(s.sp)[s.s["draft"]]
    assert (d["chosenStart"], d["duration"], d["end"]) == (mar(4), 4, mar(9))


def test_wf_keyboard_bars_viewer_blocked(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "devi", f"/projects/{s.sp}") as viewer, s.page(browser, "asha", f"/projects/{s.sp}") as owner:
        ready(viewer, "Spring launch")
        ready(owner, "Spring launch")
        tab_into(viewer, viewer.get_by_role("region", name="Chart"))
        vdraft = bar(viewer, s.s["draft"])
        focused(viewer, vdraft, "viewer focus on the first bar")
        attr(viewer, vdraft, "aria-disabled", "true")
        for key in ("ArrowRight", "Shift+ArrowRight", "ArrowLeft"):
            press(viewer, key)
            shows(viewer, schedule(viewer), READ_ONLY)
        attr(viewer, vdraft, "data-start", mar(1), "viewer keys changed nothing")
        click(bar(owner, s.s["draft"]))
        press(owner, "ArrowRight")
        shows(owner, schedule(owner), "Draft brief now starts Tue 2 Mar 2027 and ends Thu 4 Mar 2027.")
        attr(viewer, vdraft, "data-start", mar(2), "the owner's nudge reaches the viewer", LIVE_S)
        focused(viewer, vdraft, "viewer focus kept after the push")
    d = s.api("asha").items(s.sp)[s.s["draft"]]
    assert (d["chosenStart"], d["duration"], d["version"]) == (mar(2), 3, 2), "only the owner's edit was stored"


LINK_CHAIN = [("a", "b", "FS", 2), ("b", "c", "SS", -1), ("c", "d", "FF", 1), ("d", "e", "FS", 0), ("e", "f", "SF", 0)]
LINK_CASES = {
    "FS": (1, "b", mar(8), mar(9)),
    "SS": (2, "c", mar(5), mar(11)),
    "FF": (3, "d", mar(9), mar(12)),
    "SF": (5, "f", mar(11), mar(12)),
}


LINK_IDS = ["FS", "SS", "FF", "SF"]


@pytest.mark.parametrize("link_type", LINK_IDS, ids=LINK_IDS)
def test_four_link_types_with_lag(app_url: str, link_type: str) -> None:
    s = Seed(app_url, projects=("links",))
    asha = s.api("asha")
    count, succ, start, end = LINK_CASES[link_type]
    for a, b, kind, lag in LINK_CHAIN[:count]:
        made = ok(asha.http.post(f"/api/projects/{s.lp}/links", json={"from": s.lx[a], "to": s.lx[b], "type": kind, "lag": lag}), 201)
        assert {k: made["link"][k] for k in ("from", "to", "type", "lag")} == {"from": s.lx[a], "to": s.lx[b], "type": kind, "lag": lag}
        assert isinstance(made["link"]["id"], str)
        assert s.lx[b] in [m["id"] for m in made["moved"]], "moved includes the successor"
        assert made["finish"] == asha.project(s.lp)["finish"]
    i = asha.items(s.lp)[s.lx[succ]]
    assert (i["start"], i["end"]) == (start, end)
    if link_type == "SF":
        e = asha.items(s.lp)[s.lx["e"]]
        assert (e["start"], e["end"]) == (mar(12), mar(12))


def test_add_link_dialog(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, s.s["draft"])
        click(draft)
        press(page, "l")
        dialog = page.get_by_role("dialog", name="Add link")
        seen(page, dialog.get_by_role("heading", name=f"Link from {DRAFT_BRIEF}"), "Add link from Draft brief")
        succ = dialog.get_by_role("combobox", name="Successor")
        succ.focus()
        press(page, "ArrowDown")
        wait_for(page, lambda: expect(dialog.get_by_role("option", name="3 Review brief")).to_have_count(1, timeout=POLL_MS), "options list items")
        expect(dialog.get_by_role("option", name="1 Content")).to_have_count(0)
        expect(dialog.get_by_role("option", name="2 Draft brief")).to_have_count(0)
        select(succ, "3 Review brief")
        expect(dialog.get_by_role("radio", name="Finish to start")).to_be_checked()
        click(dialog.get_by_role("button", name="Add link"))
        seen(page, alert_with(dialog, "Those tasks are already linked."), "duplicate refused in the dialog")
        select(succ, "5 Design pages")
        lag = dialog.get_by_role("spinbutton", name="Lag in working days")
        value_is(page, lag, "0", "lag starts at 0")
        lag.focus()
        press(page, "ArrowUp")
        value_is(page, lag, "1", "ArrowUp adds 1")
        dialog.get_by_role("button", name="Add link").focus()
        press(page, "Enter")
        gone(page, dialog, "dialog closes on success")
        focused(page, draft, "focus back on the bar")
        shows(page, schedule(page), "Linked Draft brief to Design pages, finish to start, lag 1.")
        shows(page, schedule(page), "Project finishes Tue 16 Mar 2027.")
    assert (s.s["draft"], s.s["design"], "FS", 1) in link_set(asha, s.sp)


def test_link_errors_and_loops(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S, path = s.s, f"/api/projects/{s.sp}/links"
    before = link_set(asha, s.sp)
    expect_error(asha.http.post(path, json={"from": S["draft"], "to": S["review"], "type": "SS", "lag": 0}), 409, "duplicate_link")
    expect_error(asha.http.post(path, json={"from": S["design"], "to": S["design"], "type": "FS", "lag": 0}), 422, "self_link")
    expect_error(asha.http.post(path, json={"from": S["content"], "to": S["design"], "type": "FS", "lag": 0}), 422, "group_link")
    expect_error(asha.http.post(path, json={"from": "nope", "to": "nope", "type": "XX", "lag": 99}), 422, "invalid_link", field="type")
    expect_error(asha.http.post(path, json={"from": S["write"], "to": S["signoff"], "type": "FS", "lag": LAG_LIMIT + 1}), 422, "invalid_link", field="lag")
    expect_error(asha.http.post(path, json={"from": S["write"], "to": S["signoff"], "type": "FS", "lag": -LAG_LIMIT - 1}), 422, "invalid_link", field="lag")
    expect_error(asha.http.post(path, json={"from": "no-such-item", "to": S["signoff"], "type": "FS", "lag": 0}), 422, "invalid_link", field="from")
    loop = expect_error(asha.http.post(path, json={"from": S["design"], "to": S["draft"], "type": "FS", "lag": 0}),
                        422, "loop", keys=("path",), message=LOOP_SPRING)
    assert loop["path"] == [S["design"], S["draft"], S["review"], S["design"]]
    assert link_set(asha, s.sp) == before, "refused links saved nothing"
    for a, lag in (("write", LAG_LIMIT), ("review", -LAG_LIMIT)):
        made = ok(asha.http.post(path, json={"from": S[a], "to": S["signoff"], "type": "FS", "lag": lag}), 201)
        gone_ = ok(asha.http.delete(f"/api/links/{made['link']['id']}"))
        assert set(gone_) == {"moved", "finish"} and gone_["finish"] == mar(16)
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        click(bar(page, S["design"]))
        press(page, "l")
        dialog = page.get_by_role("dialog", name="Add link")
        select(dialog.get_by_role("combobox", name="Successor"), "2 Draft brief")
        click(dialog.get_by_role("button", name="Add link"))
        seen(page, alert_with(dialog, LOOP_SPRING), "loop message in the dialog")
        expect(dialog).to_be_visible()
    assert link_set(asha, s.sp) == before


def link_by_keyboard(page: Page, dialog: Locator, successor: str, kind_presses: int, lag: int) -> None:
    select(dialog.get_by_role("combobox", name="Successor"), successor)
    dialog.get_by_role("radio", name="Finish to start").focus()
    for _ in range(kind_presses):
        press(page, "ArrowRight")
    spin = dialog.get_by_role("spinbutton", name="Lag in working days")
    spin.focus()
    for _ in range(abs(lag)):
        press(page, "ArrowUp" if lag > 0 else "ArrowDown")
    value_is(page, spin, str(lag), "lag set by Arrow keys")
    dialog.get_by_role("button", name="Add link").focus()
    press(page, "Enter")


def test_wf_link_types_and_loops_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("links",))
    asha = s.api("asha")
    names = {"a": "Plan route", "b": "Book venue", "c": "Print maps", "d": "Pack kits", "e": "Kick-off", "f": "Send reminders"}
    rows = {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6}
    words = {"FS": ("finish to start", 0), "SS": ("start to start", 1), "FF": ("finish to finish", 2), "SF": ("start to finish", 3)}
    with s.page(browser, "asha", f"/projects/{s.lp}") as page:
        ready(page, "Link examples")
        shows(page, crit_count(page), "1 critical task")
        tab_into(page, page.get_by_role("region", name="Chart"))
        for n, (a, b, kind, lag) in enumerate(LINK_CHAIN):
            if n:
                press(page, "ArrowDown")
            src = bar(page, s.lx[a])
            focused(page, src, f"focus on {names[a]}")
            press(page, "l")
            dialog = page.get_by_role("dialog", name="Add link")
            seen(page, dialog.get_by_role("heading", name=f"Link from {names[a]}"), "link dialog from the focused bar")
            link_by_keyboard(page, dialog, f"{rows[b]} {names[b]}", words[kind][1], lag)
            gone(page, dialog, "dialog closed")
            focused(page, src, "focus back on the predecessor")
            shows(page, schedule(page), f"Linked {names[a]} to {names[b]}, {words[kind][0]}, lag {lag}.")
        shows(page, crit_count(page), "6 critical tasks")
        page.reload()
        ready(page, "Link examples")
        for k, start, end in (("b", mar(8), mar(9)), ("c", mar(5), mar(11)), ("d", mar(9), mar(12)), ("e", mar(12), mar(12)), ("f", mar(11), mar(12))):
            on_dates(page, s.lx[k], start, end, f"{names[k]} after reload")
    items = asha.items(s.lp)
    assert [(items[s.lx[k]]["start"], items[s.lx[k]]["end"]) for k in "abcdef"] == [
        (mar(1), mar(3)), (mar(8), mar(9)), (mar(5), mar(11)), (mar(9), mar(12)), (mar(12), mar(12)), (mar(11), mar(12))]
    assert all(i["critical"] for i in items.values())


def test_wf_link_types_and_loops_loop_refused(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("links",))
    asha = s.api("asha")
    ok(asha.http.post(f"/api/projects/{s.lp}/links", json={"from": s.lx["a"], "to": s.lx["b"], "type": "FS", "lag": 2}), 201)
    with s.page(browser, "asha", f"/projects/{s.lp}") as page:
        ready(page, "Link examples")
        b = bar(page, s.lx["b"])
        click(b)
        press(page, "l")
        dialog = page.get_by_role("dialog", name="Add link")
        link_by_keyboard(page, dialog, "1 Plan route", 0, 0)
        seen(page, alert_with(dialog, "That link would make the project wait on itself: Book venue -> Plan route -> Book venue."), "loop path named")
        assert link_set(asha, s.lp) == {(s.lx["a"], s.lx["b"], "FS", 2)}
        link_by_keyboard(page, dialog, "3 Print maps", 1, -1)
        gone(page, dialog, "valid link closes the dialog")
        focused(page, b, "focus back on Book venue")
        on_dates(page, s.lx["c"], mar(5), mar(11), "Print maps lands on its published dates")
    assert link_set(asha, s.lp) == {(s.lx["a"], s.lx["b"], "FS", 2), (s.lx["b"], s.lx["c"], "SS", -1)}


def test_wf_link_types_and_loops_described(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("links",))
    asha = s.api("asha")
    L = s.lx
    with s.page(browser, "asha", f"/projects/{s.lp}") as owner, s.page(browser, "devi", f"/projects/{s.lp}") as viewer:
        ready(owner, "Link examples")
        ready(viewer, "Link examples")
        tab_into(owner, owner.get_by_role("region", name="Chart"))
        plan = bar(owner, L["a"])
        focused(owner, plan, "the chart's tab stop starts on Plan route")
        press(owner, "l")
        dialog = owner.get_by_role("dialog", name="Add link")
        plan_name = "Plan route"
        seen(owner, dialog.get_by_role("heading", name=f"Link from {plan_name}"), "link dialog from Plan route")
        link_by_keyboard(owner, dialog, "2 Book venue", 0, 2)
        gone(owner, dialog, "the link dialog closed")
        focused(owner, plan, "focus back on Plan route")
        shows(owner, schedule(owner), "Linked Plan route to Book venue, finish to start, lag 2. 1 dependent task moved. Project finishes Tue 9 Mar 2027.")
        described = {"a": "Starts Mon 1 Mar 2027, ends Wed 3 Mar 2027. 3 working days, 0% complete. Critical. Late.",
                     "b": "Starts Mon 8 Mar 2027, ends Tue 9 Mar 2027. 2 working days, 0% complete. Critical. Waits for Plan route, finish to start, lag 2."}
        for pg in (owner, viewer):
            for k, desc in described.items():
                b = bar(pg, L[k])
                wait_for(pg, lambda b=b, desc=desc: expect(b).to_have_accessible_description(desc, timeout=POLL_MS),
                         f"{k} description", LIVE_S)
            shows(pg, crit_count(pg), "2 critical tasks", seconds=LIVE_S)
        vlink = viewer.locator(f'[data-link-id][data-from="{L["a"]}"][data-to="{L["b"]}"]')
        attr(viewer, vlink, "data-type", "FS", "the viewer sees the new link", LIVE_S)
        attr(viewer, vlink, "data-lag", "2", "the viewer sees its lag")
        attr(viewer, vlink, "data-critical", "true", "both ends are critical")
        shows(viewer, updates(viewer), "Asha Rao changed Plan route.", seconds=LIVE_S)
        press(owner, "l")
        seen(owner, dialog, "L opens the link dialog again")
        link_by_keyboard(owner, dialog, "2 Book venue", 0, 0)
        seen(owner, alert_with(dialog, "Those tasks are already linked."), "the duplicate is refused in the dialog")
        press(owner, "Escape")
        gone(owner, dialog, "Escape closes the dialog")
        focused(owner, plan, "Escape returns focus to Plan route")
    assert link_set(asha, s.lp) == {(L["a"], L["b"], "FS", 2)}


def test_task_details_dialog(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha, ben = s.api("asha"), s.api("ben")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, S["draft"])
        click(draft)
        press(page, "Enter")
        d = page.get_by_role("dialog", name="Task details")
        name, start = d.get_by_role("textbox", name="Name"), d.get_by_role("textbox", name="Start")
        dur, pct = d.get_by_role("spinbutton", name="Duration"), d.get_by_role("spinbutton", name="Percent complete")
        for loc, v in ((name, "Draft brief"), (start, mar(1)), (dur, "3"), (pct, "20")):
            value_is(page, loc, v, "Task details shows the item")
        shows(page, d.get_by_role("list", name="Assignees"), "Asha Rao, 4 hours a day")
        seen(page, d.get_by_role("region", name="Comments"), "Comments region")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                press(page, key)
                assert d.evaluate("(el) => el.contains(document.activeElement)"), f"{key} left Task details"
        fill(start, BAD_DATE)
        click(d.get_by_role("button", name="Save task"))
        seen(page, alert_with(d, "Enter a date as YYYY-MM-DD."), "bad start refused")
        attr(page, start, "aria-invalid", "true")
        edit(ben, s.sp, S["design"], percent=25)
        attr(page, bar(page, S["design"]), "data-percent", "25", "the push redrew the chart", LIVE_S)
        expect(alert_with(d, "Enter a date as YYYY-MM-DD.")).to_be_visible()
        expect(start).to_have_value(BAD_DATE)
        fill(start, mar(2))
        fill(name, "Draft outline")
        fill(dur, "2")
        fill(pct, "40")
        click(d.get_by_role("button", name="Save task"))
        gone(page, d, "Save task closes the dialog")
        focused(page, draft, "focus returns to the bar")
        for target, field, value, message in ((S["draft"], "Name", "", "Name must be 1 to 120 characters."),
                                              (S["draft"], "Percent complete", "101", "Percent complete must be a whole number from 0 to 100."),
                                              (S["design"], "Duration", "0", "Remove the assignees before making this a milestone.")):
            click(bar(page, target))
            press(page, "Enter")
            box = d.get_by_role("spinbutton" if field != "Name" else "textbox", name=field)
            fill(box, value)
            click(d.get_by_role("button", name="Save task"))
            seen(page, alert_with(d, message), f"{field} refused")
            press(page, "Escape")
            gone(page, d, "Escape closes")
            focused(page, bar(page, target), "focus back on the bar")
        signoff = bar(page, S["signoff"])
        click(signoff)
        press(page, "Enter")
        value_is(page, start, mar(15), "Start shows the chosen start, not the shown start")
        expect(d.get_by_role("region", name="Assignees")).to_have_count(0)
        fill(pct, "50")
        click(d.get_by_role("button", name="Save task"))
        seen(page, alert_with(d, "A milestone is either 0% or 100% complete."), "milestone percent refused")
        click(d.get_by_role("button", name="Delete task"))
        gone(page, d, "delete closes")
        focused(page, bar(page, S["design"]), "focus to the previous bar after deleting the last")
        shows(page, schedule(page), "Sign-off deleted. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        page.goto(app_url + f"/projects/{s.sp}?task={S['content']}")
        seen(page, d, "?task= opens a group")
        value_is(page, name, "Content", "group name")
        expect(d.get_by_role("region", name="Assignees")).to_have_count(0)
        assert start.count() == 0 or not start.is_editable(), "a group's Start is not editable"
        press(page, "Escape")
        focused(page, draft, "?task= returns focus to the first bar")
    items = asha.items(s.sp)
    i = items[S["draft"]]
    assert (i["name"], i["chosenStart"], i["duration"], i["percent"], i["version"]) == ("Draft outline", mar(2), 2, 40, 2)
    assert S["signoff"] not in items and items[S["design"]]["duration"] == 4


def test_live_updates_in_place(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "ben", f"/projects/{s.sp}") as page, s.page(browser, "cara", f"/projects/{s.sp}?view=list") as lst:
        ready(page, "Spring launch")
        ready(lst, "Spring launch")
        wait_present(page, asha, s.sp, "Ben Ode")
        wait_present(lst, asha, s.sp, "Cara Lund")
        page.evaluate("() => { window.__liveProbe = 1; }")
        chart = page.get_by_role("region", name="Chart")
        scroll = chart.evaluate(f"(el) => {{ el.scrollLeft = {DAY_PX}; return el.scrollLeft; }}")
        design = bar(page, S["design"])
        click(design)
        edit(asha, s.sp, S["draft"], start=mar(4))
        on_dates(page, S["design"], mar(12), mar(17), "push reached the Gantt view")
        shows(page, updates(page), "Asha Rao changed Draft brief.", seconds=LIVE_S)
        shows(lst, lst.get_by_role("grid", name="Task list").locator(f'[data-item-id="{S["draft"]}"]'), "Thu 4 Mar 2027", "push reached the List view", LIVE_S)
        focused(page, design, "focus kept")
        assert chart.evaluate("(el) => el.scrollLeft") == scroll, "scroll kept"
        made = ok(asha.http.post(f"/api/projects/{s.sp}/items", json={"name": "Hang signs", "kind": "task"}), 201)["item"]
        shows(page, updates(page), "Asha Rao added Hang signs.", seconds=LIVE_S)
        ok(asha.http.delete(f"/api/items/{made['id']}"))
        shows(page, updates(page), "Asha Rao deleted Hang signs.", seconds=LIVE_S)
        ok(asha.http.post(f"/api/items/{S['draft']}/comments", json={"text": "Supplier slipped."}), 201)
        shows(page, updates(page), "Asha Rao commented on Draft brief.", seconds=LIVE_S)
        ok(asha.http.post(f"/api/projects/{s.sp}/holidays", json={"date": mar(15), "name": "Quiet day"}), 201)
        shows(page, updates(page), "Asha Rao changed the holidays.", seconds=LIVE_S)
        ok(asha.http.post(f"/api/projects/{s.sp}/baseline", json={"name": "Promised"}), 201)
        shows(page, updates(page), "Asha Rao saved the baseline.", seconds=LIVE_S)
        ok(asha.http.post(f"/api/projects/{s.sp}/links", json={"from": S["review"], "to": S["signoff"], "type": "FS", "lag": 0}), 201)
        shows(page, updates(page), "Asha Rao changed Review brief.", seconds=LIVE_S)
        focused(page, design, "focus kept through every push")
        assert page.evaluate("() => window.__liveProbe") == 1, "the page reloaded"


def test_wf_move_later_earlier_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    later = {"draft": (mar(4), mar(8)), "review": (mar(9), mar(11)), "write": (mar(5), mar(8)), "design": (mar(12), mar(17)), "signoff": (mar(17), mar(17))}
    first = {"draft": (mar(1), mar(3)), "review": (mar(4), mar(5)), "write": (mar(2), mar(3)), "design": (mar(11), mar(16)), "signoff": (mar(16), mar(16))}
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "ben", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        wait_present(editor, asha, s.sp, "Ben Ode")
        click(bar(owner, S["draft"]))
        press(owner, "Enter")
        d = owner.get_by_role("dialog", name="Task details")
        fill(d.get_by_role("textbox", name="Start"), mar(4))
        click(d.get_by_role("button", name="Save task"))
        shows(owner, schedule(owner), "4 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        for pg in (owner, editor):
            for k, (a, b) in later.items():
                on_dates(pg, S[k], a, b, f"{k} pushed later")
            shows(pg, finish_line(pg), "Finishes Wed 17 Mar 2027")
        shows(editor, updates(editor), "Asha Rao changed Draft brief.")
        edrag = bar(editor, S["draft"])
        click(edrag)
        for day in (3, 2, 1):
            press(editor, "ArrowLeft")
            attr(editor, edrag, "data-start", mar(day), "editor moves it back")
        for pg in (owner, editor):
            for k, (a, b) in first.items():
                on_dates(pg, S[k], a, b, f"{k} back to example 1")
    items = asha.items(s.sp)
    assert {k: (items[S[k]]["start"], items[S[k]]["end"]) for k in first} == first
    assert items[S["review"]]["chosenStart"] == mar(4)


def test_wf_move_later_earlier_chosen_start_floor(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    edit(asha, s.sp, s.s["review"], start=mar(8))
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "ben", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        draft = bar(owner, s.s["draft"])
        click(draft)
        for day in (2, 3, 4):
            press(owner, "ArrowRight")
            attr(owner, draft, "data-start", mar(day), "nudge later")
        for pg in (owner, editor):
            attr(pg, bar(pg, s.s["review"]), "data-start", mar(9), "review pushed past its chosen start", LIVE_S)
        for day in (3, 2, 1):
            press(owner, "ArrowLeft")
            attr(owner, draft, "data-start", mar(day), "nudge back")
        for pg in (owner, editor):
            attr(pg, bar(pg, s.s["review"]), "data-start", mar(8), "review returns to its chosen start", LIVE_S)
    r = asha.items(s.sp)[s.s["review"]]
    assert (r["chosenStart"], r["start"]) == (mar(8), mar(8))


MOTION_PROBE = """() => {
  window.__motionSeen = [];
  const sel = '[data-item-id]:not([data-baseline-bar]), #finish-marker';
  const look = (el) => {
    const t = (el.style && el.style.transform) || '';
    if (el.hasAttribute('data-motion') || /translateX\\((?!-?0(px)?\\))/.test(t)) {
      window.__motionSeen.push(el.getAttribute('data-item-id') || el.id || el.tagName);
    }
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof Element && r.target.matches(sel)) look(r.target);
      for (const n of r.addedNodes || []) {
        if (!(n instanceof Element)) continue;
        if (n.matches(sel)) look(n);
        n.querySelectorAll(sel).forEach(look);
      }
    }
  }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-motion', 'style']});
}"""


def test_wf_move_later_earlier_grid_reduced_motion(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    order = [S[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
    later = {"review": (mar(9), mar(11)), "write": (mar(5), mar(8)), "design": (mar(12), mar(17)), "signoff": (mar(17), mar(17))}
    first = {"review": (mar(4), mar(5)), "write": (mar(2), mar(3)), "design": (mar(11), mar(16)), "signoff": (mar(16), mar(16))}
    with s.page(browser, "ben", f"/projects/{s.sp}?view=list") as editor, \
            s.page(browser, "devi", f"/projects/{s.sp}", reduced_motion="reduce") as viewer:
        ready(editor, "Spring launch")
        ready(viewer, "Spring launch")
        wait_present(viewer, s.api("asha"), s.sp, "Devi Shah")
        viewer.evaluate(MOTION_PROBE)
        grid = editor.get_by_role("grid", name="Task list")
        grid_goto(editor, grid, order, S["draft"], "Start")
        edit_cell(editor, "Start", mar(4))
        shows(editor, schedule(editor), "Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        shows(editor, grid.locator(f'[data-item-id="{S["review"]}"]'), "Tue 9 Mar 2027", "the editor's grid shows Review brief pushed")
        for k, (a, b) in later.items():
            attr(viewer, bar(viewer, S[k]), "data-start", a, f"viewer: {k} pushed", LIVE_S)
            attr(viewer, bar(viewer, S[k]), "data-end", b, f"viewer: {k} pushed end")
            attr(viewer, bar(viewer, S[k]), "data-shifted", "true", f"viewer: {k} marked shifted")
        shows(viewer, updates(viewer), "Ben Ode changed Draft brief.", seconds=LIVE_S)
        shows(viewer, finish_line(viewer), "Finishes Wed 17 Mar 2027")
        signoff = bar(viewer, S["signoff"])
        wait_for(viewer, lambda: expect(signoff).to_have_accessible_description(
            "Milestone on Wed 17 Mar 2027. Not done. Critical. Waits for Design pages, finish to start, lag 0.", timeout=POLL_MS),
            "viewer: Sign-off's description after the push")
        grid_goto(editor, grid, order, S["draft"], "Start")
        edit_cell(editor, "Start", mar(1))
        shows(editor, schedule(editor), "Draft brief now starts Mon 1 Mar 2027 and ends Wed 3 Mar 2027. 4 dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        for k, (a, b) in first.items():
            attr(viewer, bar(viewer, S[k]), "data-start", a, f"viewer: {k} back, no earlier than its chosen start", LIVE_S)
            attr(viewer, bar(viewer, S[k]), "data-end", b, f"viewer: {k} back end")
        advance(viewer, 1000)
        assert viewer.evaluate("() => window.__motionSeen") == [], "reduced motion still showed data-motion or a slide"
    r = s.api("asha").items(s.sp)[S["review"]]
    assert (r["chosenStart"], r["start"]) == (mar(4), mar(4))


def test_critical_path_and_float(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    proj = asha.project(s.sp)
    links = {(l["from"], l["to"]): l["critical"] for l in proj["links"]}
    assert links[(S["design"], S["signoff"])] is True and links[(S["review"], S["design"])] is False
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        shows(page, crit_count(page), "2 critical tasks")
        attr(page, page.locator(f'[data-link-id][data-from="{S["design"]}"][data-to="{S["signoff"]}"]'), "data-critical", "true")
        attr(page, page.locator(f'[data-link-id][data-from="{S["review"]}"][data-to="{S["design"]}"]'), "data-critical", "false")
        check(page.get_by_role("checkbox", name="Highlight critical path"))
        for k in ("content", "draft", "review", "write"):
            attr(page, bar(page, S[k]), "data-dimmed", "true", f"{k} dimmed")
        for k in ("design", "signoff"):
            expect(bar(page, S[k])).not_to_have_attribute("data-dimmed", "true")
        assert parse_qs(urlparse(page.url).query).get("critical") == ["on"]
        edit(asha, s.sp, S["draft"], start=mar(4))
        shows(page, crit_count(page), "4 critical tasks", seconds=LIVE_S)
        expect(bar(page, S["draft"])).not_to_have_attribute("data-dimmed", "true")
        attr(page, bar(page, S["write"]), "data-dimmed", "true")
    items = asha.items(s.sp)
    assert {k for k in S if items[S[k]]["critical"]} == {"draft", "review", "design", "signoff"}


def test_wf_critical_path_keyboard_join(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "ben", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        wait_present(editor, asha, s.sp, "Ben Ode")
        draft = bar(owner, S["draft"])
        click(draft)
        for day in (2, 3, 4):
            press(owner, "ArrowRight")
            attr(owner, draft, "data-start", mar(day), "nudge")
        shows(owner, schedule(owner), "Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        for pg in (owner, editor):
            shows(pg, crit_count(pg), "4 critical tasks", seconds=LIVE_S)
            for k in ("draft", "review", "design", "signoff"):
                attr(pg, bar(pg, S[k]), "data-critical", "true", f"{k} critical", LIVE_S)
            attr(pg, bar(pg, S["write"]), "data-critical", "false")
        click(owner.get_by_role("tab", name="List"))
        grid = owner.get_by_role("grid", name="Task list")
        for k, flag in (("draft", "true"), ("review", "true"), ("write", "false")):
            attr(owner, grid.locator(f'[data-item-id="{S[k]}"]'), "data-critical", flag, f"list {k}")
    items = asha.items(s.sp)
    assert {k for k in S if items[S[k]]["critical"]} == {"draft", "review", "design", "signoff"}


def test_wf_critical_path_drop_review(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "ben", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        drag(owner, bar(owner, S["review"]), DRAG_PX)
        shows(owner, schedule(owner), "Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027.")
        for pg in (owner, editor):
            shows(pg, crit_count(pg), "3 critical tasks", seconds=LIVE_S)
            attr(pg, bar(pg, S["review"]), "data-critical", "true", "review critical", LIVE_S)
            attr(pg, bar(pg, S["draft"]), "data-critical", "false")
    items = asha.items(s.sp)
    assert {k for k in S if items[S[k]]["critical"]} == {"review", "design", "signoff"}
    assert items[S["draft"]]["float"] == 2


def test_wf_critical_path_resize_and_highlight(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "ben", f"/projects/{s.sp}?view=list") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        review = bar(owner, S["review"])
        click(review)
        press(owner, "Shift+ArrowRight")
        shows(owner, schedule(owner), "Review brief now lasts 3 working days and ends Mon 8 Mar 2027. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        shows(owner, crit_count(owner), "2 critical tasks")
        attr(owner, review, "data-critical", "false", "one working day of float left")
        press(owner, "Shift+ArrowRight")
        shows(owner, schedule(owner), "Review brief now lasts 4 working days and ends Tue 9 Mar 2027. No dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        focused(owner, review, "focus stays on Review brief")
        shows(owner, crit_count(owner), "4 critical tasks")
        for k, flag in (("draft", "true"), ("review", "true"), ("write", "false"), ("design", "true"), ("signoff", "true")):
            attr(owner, bar(owner, S[k]), "data-critical", flag, f"{k} critical flag")
        attr(owner, owner.locator(f'[data-link-id][data-from="{S["draft"]}"][data-to="{S["review"]}"]'), "data-critical", "true")
        attr(owner, owner.locator(f'[data-link-id][data-from="{S["draft"]}"][data-to="{S["write"]}"]'), "data-critical", "false")
        box = owner.get_by_role("checkbox", name="Highlight critical path")
        box.focus()
        press(owner, "Space")
        attr(owner, bar(owner, S["write"]), "data-dimmed", "true", "Write copy dimmed")
        expect(bar(owner, S["draft"])).not_to_have_attribute("data-dimmed", "true")
        owner.reload()
        ready(owner, "Spring launch")
        expect(box).to_be_checked()
        attr(owner, bar(owner, S["write"]), "data-dimmed", "true", "the highlight survives a reload")
        grid = editor.get_by_role("grid", name="Task list")
        for k, flag in (("draft", "true"), ("review", "true"), ("write", "false"), ("design", "true"), ("signoff", "true")):
            attr(editor, grid.locator(f'[data-item-id="{S[k]}"]'), "data-critical", flag, f"editor's list: {k}", LIVE_S)
    items = s.api("asha").items(s.sp)
    assert {k for k in S if items[S[k]]["critical"]} == {"draft", "review", "design", "signoff"}
    assert items[S["review"]]["duration"] == 4 and items[S["design"]]["start"] == mar(11)


def test_wf_critical_path_two_nudges_described(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    described = {
        "draft": "Starts Wed 3 Mar 2027, ends Fri 5 Mar 2027. 3 working days, 20% complete. Critical.",
        "review": "Starts Mon 8 Mar 2027, ends Tue 9 Mar 2027. 2 working days, 75% complete. Critical. Waits for Draft brief, finish to start, lag 0.",
        "write": "Starts Thu 4 Mar 2027, ends Fri 5 Mar 2027. 2 working days, 10% complete. Waits for Draft brief, start to start, lag 1.",
    }
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner, s.page(browser, "cara", f"/projects/{s.sp}") as editor:
        ready(owner, "Spring launch")
        ready(editor, "Spring launch")
        draft = bar(owner, S["draft"])
        wait_for(owner, lambda: expect(draft).to_have_accessible_description(
            "Starts Mon 1 Mar 2027, ends Wed 3 Mar 2027. 3 working days, 20% complete. Late.", timeout=POLL_MS), "Draft brief at start")
        tab_into(owner, owner.get_by_role("region", name="Chart"))
        focused(owner, draft, "the chart's tab stop starts on Draft brief")
        for day in (2, 3):
            press(owner, "ArrowRight")
            attr(owner, draft, "data-start", mar(day), "nudge later")
        shows(owner, schedule(owner), "Draft brief now starts Wed 3 Mar 2027 and ends Fri 5 Mar 2027. 2 dependent tasks moved. Project finishes Tue 16 Mar 2027.")
        focused(owner, draft, "focus stays on Draft brief")
        for pg in (owner, editor):
            shows(pg, crit_count(pg), "4 critical tasks", seconds=LIVE_S)
            for k, desc in described.items():
                b = bar(pg, S[k])
                wait_for(pg, lambda b=b, desc=desc: expect(b).to_have_accessible_description(desc, timeout=POLL_MS),
                         f"{k} description", LIVE_S)
            for k in ("draft", "write"):
                attr(pg, bar(pg, S[k]), "data-late", "false", f"{k} no longer late")
            shows(pg, finish_line(pg), "Finishes Tue 16 Mar 2027")
    items = s.api("asha").items(s.sp)
    assert {k for k in S if items[S[k]]["critical"]} == {"draft", "review", "design", "signoff"}
    assert items[S["write"]]["float"] == 6 and not items[S["write"]]["late"]


def test_baseline_save_and_replace(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        for name, warn in (("Plan A", None), ("Plan B", "This replaces the baseline Plan A.")):
            click(page.get_by_role("button", name="Save baseline"))
            d = page.get_by_role("dialog", name="Save baseline")
            if warn:
                shows(page, d, warn, "replace sentence before saving")
            else:
                click(d.get_by_role("button", name="Save baseline"))
                seen(page, alert_with(d, "Baseline name must be 1 to 60 characters."), "empty name refused")
            fill(d.get_by_role("textbox", name="Baseline name"), name)
            click(d.get_by_role("button", name="Save baseline"))
            seen(page, d.get_by_role("heading", name="Baseline set"), "Baseline set shown")
            shows(page, schedule(page), f"Baseline {name} saved.")
            click(d.get_by_role("button", name="Back to plan"))
            gone(page, d, "Back to plan closes")
        shows(page, fin_variance(page), "On baseline")
    proj = asha.project(s.sp)
    assert proj["baseline"] == {"name": "Plan B", "finish": mar(16), "finishVariance": 0}
    assert asha.items(s.sp)[s.s["draft"]]["baseline"] == {"start": mar(1), "end": mar(3), "variance": 0}
    path = f"/api/projects/{s.sp}/baseline"
    expect_error(asha.http.post(path, json={"name": "Plan C"}), 409, "baseline_exists", name="Plan B")
    expect_error(asha.http.post(path, json={"name": "x" * 61, "replace": True}), 422, "invalid_field", field="name")
    assert asha.project(s.sp)["baseline"]["name"] == "Plan B"
    made = ok(asha.http.post(path, json={"name": "Plan C", "replace": True}), 201)
    assert made["baseline"] == {"name": "Plan C", "finish": mar(16), "finishVariance": 0}


def test_variance_and_baseline_ghosts(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",), baseline={"name": "Promised"})
    asha = s.api("asha")
    S = s.s
    edit(asha, s.sp, S["draft"], start=mar(4))
    late = ok(asha.http.post(f"/api/projects/{s.sp}/items", json={"name": "Hang signs", "kind": "task"}), 201)["item"]
    items = asha.items(s.sp)
    want = {"draft": 3, "review": 3, "write": 3, "design": 1, "signoff": 1}
    assert {k: items[S[k]]["baseline"]["variance"] for k in want} == want
    assert items[late["id"]]["baseline"] is None and items[S["content"]]["baseline"] is None
    assert asha.project(s.sp)["baseline"]["finishVariance"] == 1
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        shows(page, fin_variance(page), "1 working day later than baseline")
        for k, v in want.items():
            attr(page, bar(page, S[k]), "data-variance", str(v), f"{k} variance")
        attr(page, bar(page, S["draft"]), "data-baseline-start", mar(1))
        attr(page, bar(page, S["draft"]), "data-baseline-end", mar(3))
        for iid in (S["content"], late["id"]):
            for name in ("data-variance", "data-baseline-start", "data-baseline-end"):
                expect(bar(page, iid)).not_to_have_attribute(name, re.compile(".*"))
        wait_for(page, lambda: expect(bar(page, S["draft"])).to_have_accessible_description(re.compile(r"3 working days later than baseline"), timeout=POLL_MS), "variance in description")
        check(page.get_by_role("checkbox", name="Show baseline"))
        attr(page, ghost(page, S["design"]), "data-start", mar(11), "ghost at baseline start")
        attr(page, ghost(page, S["design"]), "data-end", mar(16))
        expect(ghost(page, late["id"])).to_have_count(0)
        assert parse_qs(urlparse(page.url).query).get("baseline") == ["on"]
        edit(asha, s.sp, S["design"], duration=2)
        attr(page, bar(page, S["design"]), "data-variance", "-1", "shrinking gives a negative variance", LIVE_S)
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        grid = page.get_by_role("grid", name="Task list")
        grid_goto(page, grid, [i["id"] for i in asha.project(s.sp)["items"]], S["draft"], "Variance")
        assert active(page)["text"] == "+3"
        grid_goto(page, grid, [i["id"] for i in asha.project(s.sp)["items"]], S["design"], "Variance")
        assert active(page)["text"] == "-1"
        grid_goto(page, grid, [i["id"] for i in asha.project(s.sp)["items"]], S["content"], "Variance")
        assert active(page)["text"] == ""


def test_wf_baseline_variance_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        save = page.get_by_role("button", name="Save baseline")
        tab_to(page, save)
        press(page, "Enter")
        d = page.get_by_role("dialog", name="Save baseline")
        tab_to(page, d.get_by_role("textbox", name="Baseline name"))
        page.keyboard.type("Promised")
        tab_to(page, d.get_by_role("button", name="Save baseline"))
        press(page, "Enter")
        seen(page, d.get_by_role("heading", name="Baseline set"), "baseline saved by keyboard")
        tab_to(page, d.get_by_role("button", name="Back to plan"))
        press(page, "Enter")
        gone(page, d, "dialog closed")
        tab_into(page, page.get_by_role("region", name="Chart"))
        draft = bar(page, S["draft"])
        for day in (2, 3, 4):
            press(page, "ArrowRight")
            attr(page, draft, "data-start", mar(day), "nudge")
        shows(page, fin_variance(page), "1 working day later than baseline")
        page.goto(app_url + f"/projects/{s.sp}?baseline=on")
        ready(page, "Spring launch")
        for k, v in {"draft": 3, "review": 3, "write": 3, "design": 1, "signoff": 1}.items():
            attr(page, bar(page, S[k]), "data-variance", str(v), f"{k} variance after reload")
        attr(page, ghost(page, S["draft"]), "data-start", mar(1), "ghost after reload")
        attr(page, ghost(page, S["signoff"]), "data-end", mar(16))
        shows(page, fin_variance(page), "1 working day later than baseline")
    assert asha.project(s.sp)["baseline"] == {"name": "Promised", "finish": mar(16), "finishVariance": 1}


def test_wf_baseline_variance_replace(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",), baseline={"name": "Promised"})
    asha = s.api("asha")
    edit(asha, s.sp, s.s["draft"], start=mar(4))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        shows(page, fin_variance(page), "1 working day later than baseline")
        click(page.get_by_role("button", name="Save baseline"))
        d = page.get_by_role("dialog", name="Save baseline")
        shows(page, d, "This replaces the baseline Promised.")
        fill(d.get_by_role("textbox", name="Baseline name"), "Replanned")
        click(d.get_by_role("button", name="Save baseline"))
        shows(page, schedule(page), "Baseline Replanned saved.")
        click(d.get_by_role("button", name="Back to plan"))
        shows(page, fin_variance(page), "On baseline")
        attr(page, bar(page, s.s["draft"]), "data-variance", "0")
    proj = asha.project(s.sp)
    assert proj["baseline"] == {"name": "Replanned", "finish": mar(17), "finishVariance": 0}
    assert all(i["baseline"]["variance"] == 0 for i in proj["items"] if i["kind"] != "group")


def test_wf_baseline_variance_shrink_earlier(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",), baseline={"name": "Signed off"})
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        shows(page, fin_variance(page), "On baseline")
        design = bar(page, S["design"])
        click(design)
        press(page, "Shift+ArrowLeft")
        shows(page, schedule(page), "Design pages now lasts 3 working days and ends Mon 15 Mar 2027. 1 dependent task moved. Project finishes Mon 15 Mar 2027.")
        press(page, "Shift+ArrowLeft")
        shows(page, schedule(page), "Design pages now lasts 2 working days and ends Fri 12 Mar 2027. No dependent tasks moved. Project finishes Mon 15 Mar 2027.")
        focused(page, design, "focus stays on Design pages")
        for k, v in (("design", "-2"), ("signoff", "-1"), ("draft", "0"), ("review", "0")):
            attr(page, bar(page, S[k]), "data-variance", v, f"{k} variance")
        shows(page, fin_variance(page), "1 working day earlier than baseline")
        for k, desc in (("design", "Starts Thu 11 Mar 2027, ends Fri 12 Mar 2027. 2 working days, 0% complete. 2 working days earlier than baseline. Waits for Review brief, finish to start, lag 0."),
                        ("signoff", "Milestone on Mon 15 Mar 2027. Not done. Critical. 1 working day earlier than baseline. Waits for Design pages, finish to start, lag 0.")):
            b = bar(page, S[k])
            wait_for(page, lambda b=b, desc=desc: expect(b).to_have_accessible_description(desc, timeout=POLL_MS), f"{k} description")
        box = page.get_by_role("checkbox", name="Show baseline")
        box.focus()
        press(page, "Space")
        attr(page, ghost(page, S["design"]), "data-start", mar(11), "Design pages' ghost start")
        attr(page, ghost(page, S["design"]), "data-end", mar(16), "Design pages' ghost keeps the baseline end")
        gantt = page.get_by_role("tab", name="Gantt")
        gantt.focus()
        press(page, "ArrowRight")
        grid = page.get_by_role("grid", name="Task list")
        for k, v in (("design", "-2"), ("signoff", "-1"), ("draft", "0")):
            cell = grid.locator(f'[data-item-id="{S[k]}"]').get_by_role("gridcell").last
            wait_for(page, lambda cell=cell, v=v: expect(cell).to_have_text(v, timeout=POLL_MS), f"grid Variance for {k}")
    proj = s.api("asha").project(s.sp)
    items = {i["id"]: i for i in proj["items"]}
    assert (items[S["design"]]["baseline"]["variance"], items[S["signoff"]]["baseline"]["variance"]) == (-2, -1)
    assert proj["finish"] == mar(15) and proj["baseline"]["finishVariance"] == -1


def test_percent_and_group_rollup(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    assert asha.items(s.sp)[S["content"]]["percent"] == 33
    edit(asha, s.sp, S["draft"], percent=40)
    assert asha.items(s.sp)[S["content"]]["percent"] == 41
    for bad in (101, -1, 12.5):
        expect_error(asha.http.patch(f"/api/items/{S['review']}", json={"baseVersion": 1, "percent": bad}), 422, "invalid_field", field="percent")
    expect_error(asha.http.patch(f"/api/items/{S['signoff']}", json={"baseVersion": 1, "percent": 50}), 422, "invalid_field", field="percent")
    ok(asha.http.patch(f"/api/items/{S['signoff']}", json={"baseVersion": 1, "percent": 100}))
    path = f"/api/projects/{s.sp}/items"
    half = ok(asha.http.post(path, json={"name": "Stage", "kind": "group"}), 201)["item"]
    ok(asha.http.post(path, json={"name": "Rig lights", "kind": "task", "group": half["id"]}), 201)
    one = ok(asha.http.post(path, json={"name": "Hang drapes", "kind": "task", "group": half["id"]}), 201)["item"]
    ok(asha.http.patch(f"/api/items/{one['id']}", json={"baseVersion": 1, "percent": 1}))
    only = ok(asha.http.post(path, json={"name": "Gates", "kind": "group"}), 201)["item"]
    ok(asha.http.post(path, json={"name": "Gates open", "kind": "milestone", "group": only["id"]}), 201)
    empty = ok(asha.http.post(path, json={"name": "Spare", "kind": "group"}), 201)["item"]
    items = asha.items(s.sp)
    assert items[half["id"]]["percent"] == 1, "0.5 rounds half up"
    assert items[only["id"]]["percent"] == 0
    e = items[empty["id"]]
    assert (e["percent"], e["start"], e["end"], e["duration"]) == (0, None, None, 0)
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        attr(page, bar(page, S["content"]), "data-percent", "41")
        page.goto(app_url + f"/projects/{s.sp}?view=list")
        shows(page, page.get_by_role("grid", name="Task list").locator(f'[data-item-id="{S["content"]}"]'), "41%")


def timeline_card(page: Page, name: str) -> Locator:
    return page.get_by_role("list", name="Timeline").get_by_role("listitem").filter(has_text=name)


def test_phone_timeline(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "devi", f"/projects/{s.sp}", size=PHONE) as page:
        ready(page, "Spring launch")
        timeline = page.get_by_role("list", name="Timeline")
        seen(page, timeline, "Timeline list")
        expect(page.get_by_role("region", name="Chart")).to_have_count(0)
        cards = timeline.get_by_role("listitem")
        wait_for(page, lambda: expect(cards).to_have_count(6, timeout=POLL_MS), "one card per row")
        for n, name in enumerate(["Content", "Draft brief", "Review brief", "Write copy", "Design pages", "Sign-off"]):
            expect(cards.nth(n)).to_contain_text(name)
        shows(page, timeline_card(page, "Draft brief"), "Mon 1 Mar - Wed 3 Mar")
        shows(page, timeline_card(page, "Draft brief"), "20% complete")
        shows(page, timeline_card(page, "Draft brief"), "Late")
        expect(timeline_card(page, "Review brief")).not_to_contain_text("Late")
        shows(page, timeline_card(page, "Design pages"), "Thu 11 Mar - Tue 16 Mar")
        shows(page, timeline_card(page, "Design pages"), "Critical")
        expect(timeline_card(page, "Draft brief")).not_to_contain_text("Critical")
        shows(page, timeline_card(page, "Sign-off"), "Tue 16 Mar")
        shows(page, timeline_card(page, "Content"), "33% complete")
        for name in ("Draft brief", "Review brief", "Write copy", "Design pages"):
            seen(page, page.get_by_role("button", name=f"Update progress for {name}"), f"Update progress for {name}")
        for name in ("Content", "Sign-off"):
            expect(page.get_by_role("button", name=f"Update progress for {name}")).to_have_count(0)


def test_progress_sheet(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "ben", f"/projects/{s.sp}", size=PHONE) as page:
        ready(page, "Spring launch")
        opener = page.get_by_role("button", name=f"Update progress for {DRAFT_BRIEF}")
        click(opener)
        sheet = page.get_by_role("dialog", name="Update progress")
        seen(page, sheet.get_by_role("heading", name="Draft brief"), "sheet heading")
        slider = sheet.get_by_role("slider", name="Percent complete")
        slider_is(page, slider, "20", "slider starts at the task's percent")
        shows(page, sheet, "20%")
        slider.focus()
        for key, v in (("ArrowRight", "25"), ("ArrowUp", "30"), ("ArrowLeft", "25"), ("ArrowDown", "20"), ("End", "100"), ("Home", "0")):
            press(page, key)
            slider_is(page, slider, v, f"{key}")
        click(sheet.get_by_role("button", name="Cancel"))
        gone(page, sheet, "Cancel closes")
        focused(page, opener, "focus back on the card button")
        click(opener)
        press(page, "End")
        press(page, "Escape")
        gone(page, sheet, "Escape closes")
        focused(page, opener, "focus back after Escape")
        assert asha.items(s.sp)[s.s["draft"]]["percent"] == 20, "Cancel and Escape saved nothing"
        click(opener)
        box = slider.bounding_box()
        assert box is not None
        y = box["y"] + box["height"] / 2
        before = page.evaluate("() => [window.scrollX, window.scrollY]")
        touch_drag(page, (box["x"] + box["width"] * 0.2, y), (box["x"] + box["width"] + SLIDER_STEP, y))
        slider_is(page, slider, "100", "touch drag to the right end")
        touch_drag(page, (box["x"] + box["width"] - 1, y), (box["x"] - SLIDER_STEP, y))
        slider_is(page, slider, "0", "touch drag to the left end")
        assert page.evaluate("() => [window.scrollX, window.scrollY]") == before, "touch drag scrolled the page"
        press(page, "ArrowRight")
        slider_is(page, slider, "5", "steps of 5")
        click(sheet.get_by_role("button", name="Save progress"))
        gone(page, sheet, "Save progress closes")
        focused(page, opener, "focus back after saving")
        shows(page, timeline_card(page, "Draft brief"), "5% complete")
    assert asha.items(s.sp)[s.s["draft"]]["percent"] == 5


def test_published_breakpoints(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    toolbar = [("checkbox", "Show baseline"), ("checkbox", "Highlight critical path"), ("button", "Save baseline"), ("button", "Holidays"), ("button", "Export")]
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            for view in ("gantt", "list", "workload"):
                page.goto(app_url + f"/projects/{s.sp}?view={view}")
                ready(page, "Spring launch")
                layout(page)
            page.goto(app_url + f"/projects/{s.sp}")
            ready(page, "Spring launch")
            phone = size is PHONE
            if phone:
                seen(page, page.get_by_role("list", name="Timeline"), "phone timeline")
                expect(page.get_by_role("region", name="Chart")).to_have_count(0)
                for loc in page.get_by_role("button").all() + page.get_by_role("tab").all():
                    b = loc.bounding_box()
                    if b and loc.is_visible():
                        assert b["width"] >= TAP_MIN_PX and b["height"] >= TAP_MIN_PX, f"tap target {b} under 44 pixels"
            else:
                seen(page, page.get_by_role("region", name="Chart"), "chart from 768")
                expect(page.get_by_role("list", name="Timeline")).to_have_count(0)
            boxes = {n: page.get_by_role(r, name=n).bounding_box() for r, n in toolbar}
            head = page.get_by_role("heading", level=1).bounding_box()
            fin = finish_line(page).bounding_box()
            count = crit_count(page).bounding_box()
            people = page.get_by_role("list", name="People here").bounding_box()
            tabs = page.get_by_role("tablist", name="View").bounding_box()
            exports = page.get_by_role("region", name="Exports").bounding_box()
            assert all([head, fin, count, people, tabs, exports]) and all(boxes.values())
            if size is DESKTOP:
                assert rows_of(list(boxes.values())) == 1, "desktop toolbar fits one row"
                assert people["x"] > size["width"] / 2 and people["y"] < tabs["y"], "People here at the right of the header"
            elif size is TABLET:
                assert rows_of(list(boxes.values())) <= 2, "tablet toolbar wraps onto at most two rows"
                assert people["y"] >= count["y"] + count["height"], "People here under the header block"
            else:
                assert head["y"] < fin["y"] < count["y"] < people["y"] < tabs["y"], "phone header stacks in order"
                assert exports["y"] >= tabs["y"], "Exports comes last"
        page.set_viewport_size(DESKTOP)
        for view, grid_name in (("list", "Task list"), ("workload", "Workload")):
            page.goto(app_url + f"/projects/{s.sp}?view={view}")
            grid = page.get_by_role("grid", name=grid_name)
            seen(page, grid, grid_name)
            for h in grid.get_by_role("columnheader").all():
                b = h.bounding_box()
                assert b and b["x"] + b["width"] <= DESKTOP["width"], f"{grid_name} column outside 1280"


def test_wf_progress_phone_keyboard(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as desk, s.page(browser, "ben", f"/projects/{s.sp}", size=PHONE) as phone:
        ready(desk, "Spring launch")
        ready(phone, "Spring launch")
        wait_present(desk, asha, s.sp, "Ben Ode")
        click(phone.get_by_role("button", name=f"Update progress for {DRAFT_BRIEF}"))
        sheet = phone.get_by_role("dialog", name="Update progress")
        slider = sheet.get_by_role("slider", name="Percent complete")
        slider.focus()
        for _ in range(4):
            press(phone, "ArrowRight")
        slider_is(phone, slider, "40", "four steps of 5")
        click(sheet.get_by_role("button", name="Save progress"))
        shows(phone, schedule(phone), "Draft brief is 40% complete.")
        shows(phone, timeline_card(phone, "Draft brief"), "40% complete")
        shows(phone, timeline_card(phone, "Content"), "41% complete")
        attr(desk, bar(desk, s.s["draft"]), "data-percent", "40", "desktop sees the percent live", LIVE_S)
        attr(desk, bar(desk, s.s["content"]), "data-percent", "41", "desktop sees the rollup live", LIVE_S)
        shows(desk, updates(desk), "Ben Ode changed Draft brief.")
    items = asha.items(s.sp)
    assert (items[s.s["draft"]]["percent"], items[s.s["content"]]["percent"]) == (40, 41)


def test_wf_progress_phone_touch(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as desk, s.page(browser, "ben", f"/projects/{s.sp}", size=PHONE) as phone:
        ready(desk, "Spring launch")
        ready(phone, "Spring launch")
        click(phone.get_by_role("button", name=f"Update progress for {DRAFT_BRIEF}"))
        sheet = phone.get_by_role("dialog", name="Update progress")
        slider = sheet.get_by_role("slider", name="Percent complete")
        box = slider.bounding_box()
        assert box is not None
        y = box["y"] + box["height"] / 2
        touch_drag(phone, (box["x"] + box["width"] * 0.2, y), (box["x"] + box["width"] + SLIDER_STEP, y))
        slider_is(phone, slider, "100", "touch drag to 100")
        click(sheet.get_by_role("button", name="Save progress"))
        shows(phone, timeline_card(phone, "Draft brief"), "100% complete")
        wait_for(phone, lambda: expect(timeline_card(phone, "Draft brief")).not_to_contain_text("Late", timeout=POLL_MS), "no longer late")
        shows(phone, timeline_card(phone, "Content"), "67% complete")
        attr(desk, bar(desk, s.s["draft"]), "data-late", "false", "desktop late flag live", LIVE_S)
        attr(desk, bar(desk, s.s["content"]), "data-percent", "67", "desktop rollup live", LIVE_S)
    d = asha.items(s.sp)[s.s["draft"]]
    assert (d["percent"], d["late"]) == (100, False)


def test_workload_hours(app_url: str) -> None:
    s = Seed(app_url)
    asha = s.api("asha")
    ok(asha.http.post(f"/api/items/{s.s['write']}/assignees", json={"userId": s.users["asha"], "hours": 6}), 201)
    w = ok(asha.http.get(f"/api/workspaces/{s.workspace}/workload", params={"from": mar(1)}))
    assert w["from"] == mar(1) and w["days"] == weekdays_from(mar(1), 10)
    assert [p["name"] for p in w["people"]] == ["Asha Rao", "Ben Ode", "Cara Lund"]
    people = {p["name"]: p for p in w["people"]}
    a = {d["date"]: d for d in people["Asha Rao"]["days"]}
    assert (a[mar(1)]["hours"], a[mar(1)]["over"]) == (4, False)
    assert (a[mar(2)]["hours"], a[mar(2)]["over"], a[mar(3)]["hours"], a[mar(3)]["over"]) == (10, True, 10, True)
    assert a[mar(2)]["assignments"] == [{"project": "Spring launch", "item": "Draft brief", "hours": 4},
                                        {"project": "Spring launch", "item": "Write copy", "hours": 6}]
    assert a[mar(10)]["hours"] == 3 and a[mar(10)]["assignments"] == [{"project": "Office move", "item": "Pack desks", "hours": 3}]
    assert people["Asha Rao"]["overDays"] == 2 and people["Asha Rao"]["capacity"] == 8
    b = {d["date"]: d for d in people["Ben Ode"]["days"]}
    assert (b[mar(11)]["hours"], b[mar(11)]["over"], b[mar(12)]["hours"], b[mar(12)]["over"]) == (8, False, 8, False)
    assert b[mar(10)]["hours"] == 0
    for bad in (None, mar(2), "soon"):
        params = {"from": bad} if bad else {}
        expect_error(asha.http.get(f"/api/workspaces/{s.workspace}/workload", params=params), 422, "invalid_field", field="from")


def test_workload_grid(browser: Browser, app_url: str) -> None:
    s = Seed(app_url)
    ok(s.api("asha").http.post(f"/api/items/{s.s['write']}/assignees", json={"userId": s.users["asha"], "hours": 6}), 201)
    heads = ["Person", "Mon 1 Mar", "Tue 2 Mar", "Wed 3 Mar", "Thu 4 Mar", "Fri 5 Mar", "Mon 8 Mar", "Tue 9 Mar", "Wed 10 Mar", "Thu 11 Mar", "Fri 12 Mar", "Over-allocated days"]
    with s.page(browser, "asha", f"/projects/{s.sp}?view=workload") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Workload")
        wait_for(page, lambda: expect(grid.get_by_role("columnheader")).to_have_text(heads, timeout=POLL_MS), "workload headers")
        expect(grid.get_by_text("Devi Shah")).to_have_count(0)
        over = page.get_by_label("Asha Rao, Tue 2 Mar 2027: 10 of 8 hours, over-allocated", exact=True)
        attr(page, over, "data-hours", "10")
        attr(page, over, "data-over", "true")
        attr(page, over, "data-date", mar(2))
        mon = page.get_by_label("Asha Rao, Mon 1 Mar 2027: 4 of 8 hours", exact=True)
        attr(page, mon, "data-over", "false")
        attr(page, page.get_by_label("Ben Ode, Thu 11 Mar 2027: 8 of 8 hours", exact=True), "data-over", "false")
        row = grid.get_by_role("row").filter(has=mon)
        shows(page, row.get_by_role("gridcell").last, "2", "Over-allocated days count")
        tab_into(page, grid)
        focused(page, mon, "active cell starts on the first person's first day")
        press(page, "ArrowRight")
        focused(page, over, "ArrowRight moves the active cell")
        press(page, "Enter")
        d = page.get_by_role("dialog", name="Asha Rao, Tue 2 Mar 2027", exact=True)
        lst = d.get_by_role("list", name="Assignments").get_by_role("listitem")
        wait_for(page, lambda: expect(lst).to_have_text(["Spring launch: Draft brief, 4 hours", "Spring launch: Write copy, 6 hours"], timeout=POLL_MS), "breakdown")
        press(page, "Escape")
        gone(page, d, "Escape closes the breakdown")
        focused(page, over, "focus back on the cell")
        click(page.get_by_role("button", name="Next two weeks"))
        shows(page, grid.get_by_role("columnheader").nth(1), "Mon 15 Mar")
        assert parse_qs(urlparse(page.url).query).get("from") == [mar(15)]
        click(page.get_by_role("button", name="Previous two weeks"))
        shows(page, grid.get_by_role("columnheader").nth(1), "Mon 1 Mar")


def test_assignments(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha, ben = s.api("asha"), s.api("ben")
    S, U = s.s, s.users
    path = f"/api/items/{S['review']}/assignees"
    made = ok(ben.http.post(path, json={"userId": U["cara"], "hours": 2.5}), 201)["item"]
    assert made["assignees"] == [{"userId": U["cara"], "name": "Cara Lund", "hours": 2.5}] and made["version"] == 2
    expect_error(asha.http.post(path, json={"userId": U["cara"], "hours": 2}), 409, "already_assigned")
    for hours in (0, 0.3, 24.5):
        expect_error(asha.http.post(path, json={"userId": U["ben"], "hours": hours}), 422, "invalid_field", field="hours")
    expect_error(asha.http.post(path, json={"userId": U["devi"], "hours": 2}), 422, "invalid_field", field="userId")
    expect_error(asha.http.post(f"/api/items/{S['signoff']}/assignees", json={"userId": U["ben"], "hours": 2}), 422, "not_a_task")
    ok(asha.http.post(path, json={"userId": U["ben"], "hours": 0.5}), 201)
    ok(asha.http.post(path, json={"userId": U["asha"], "hours": 24}), 201)
    gone_ = ok(asha.http.delete(f"{path}/{U['cara']}"))["item"]
    assert U["cara"] not in [a["userId"] for a in gone_["assignees"]]
    expect_error(asha.http.delete(f"{path}/{U['cara']}"), 404, "not_found")
    with s.page(browser, "asha", f"/projects/{s.sp}?task={S['write']}") as page:
        d = page.get_by_role("dialog", name="Task details")
        seen(page, d, "Task details for Write copy")
        region = d.get_by_role("region", name="Assignees")
        add = region.get_by_role("combobox", name="Add person")
        add.focus()
        page.keyboard.type("Devi")
        expect(region.get_by_role("option", name="Devi Shah")).to_have_count(0)
        fill(add, "")
        select(add, "Cara Lund")
        hours = region.get_by_role("spinbutton", name="Hours a day")
        value_is(page, hours, "8", "hours start at 8")
        fill(hours, "0.3")
        click(region.get_by_role("button", name="Assign"))
        seen(page, alert_with(d, "Hours a day must be from 0.5 to 24 in steps of 0.5."), "bad hours refused")
        fill(hours, "2.5")
        click(region.get_by_role("button", name="Assign"))
        shows(page, schedule(page), "Cara Lund assigned to Write copy, 2.5 hours a day.")
        shows(page, region.get_by_role("list", name="Assignees"), "Cara Lund, 2.5 hours a day")
        click(region.get_by_role("button", name="Remove Cara Lund"))
        shows(page, schedule(page), "Cara Lund removed from Write copy.")
    assert asha.items(s.sp)[S["write"]]["assignees"] == []


def test_wf_workload_happy(browser: Browser, app_url: str) -> None:
    s = Seed(app_url)
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}?view=workload") as owner, s.page(browser, "ben", f"/projects/{s.sp}?task={s.s['write']}") as editor:
        ready(owner, "Spring launch")
        attr(owner, owner.get_by_label("Asha Rao, Tue 2 Mar 2027: 4 of 8 hours", exact=True), "data-over", "false")
        owner.evaluate("() => { window.__liveProbe = 1; }")
        d = editor.get_by_role("dialog", name="Task details")
        seen(editor, d, "editor's Task details")
        region = d.get_by_role("region", name="Assignees")
        select(region.get_by_role("combobox", name="Add person"), "Asha Rao")
        fill(region.get_by_role("spinbutton", name="Hours a day"), "6")
        click(region.get_by_role("button", name="Assign"))
        shows(editor, schedule(editor), "Asha Rao assigned to Write copy, 6 hours a day.")
        for day in ("Tue 2 Mar 2027", "Wed 3 Mar 2027"):
            attr(owner, owner.get_by_label(f"Asha Rao, {day}: 10 of 8 hours, over-allocated", exact=True), "data-over", "true", f"{day} over in place", LIVE_S)
        mon = owner.get_by_label("Asha Rao, Mon 1 Mar 2027: 4 of 8 hours", exact=True)
        shows(owner, owner.get_by_role("grid", name="Workload").get_by_role("row").filter(has=mon).get_by_role("gridcell").last, "2")
        assert owner.evaluate("() => window.__liveProbe") == 1, "the owner's page reloaded"
    w = ok(asha.http.get(f"/api/workspaces/{s.workspace}/workload", params={"from": mar(1)}))
    assert next(p for p in w["people"] if p["name"] == "Asha Rao")["overDays"] == 2


def test_wf_workload_remove(browser: Browser, app_url: str) -> None:
    s = Seed(app_url)
    asha = s.api("asha")
    ok(asha.http.post(f"/api/items/{s.s['write']}/assignees", json={"userId": s.users["asha"], "hours": 6}), 201)
    with s.page(browser, "asha", f"/projects/{s.sp}?view=workload") as owner, s.page(browser, "ben", f"/projects/{s.sp}?task={s.s['write']}") as editor:
        ready(owner, "Spring launch")
        attr(owner, owner.get_by_label("Asha Rao, Tue 2 Mar 2027: 10 of 8 hours, over-allocated", exact=True), "data-over", "true")
        d = editor.get_by_role("dialog", name="Task details")
        click(d.get_by_role("region", name="Assignees").get_by_role("button", name="Remove Asha Rao"))
        shows(editor, schedule(editor), "Asha Rao removed from Write copy.")
        attr(owner, owner.get_by_label("Asha Rao, Tue 2 Mar 2027: 4 of 8 hours", exact=True), "data-over", "false", "over-allocation cleared live", LIVE_S)
    w = ok(asha.http.get(f"/api/workspaces/{s.workspace}/workload", params={"from": mar(1)}))
    assert next(p for p in w["people"] if p["name"] == "Asha Rao")["overDays"] == 0


def cell_has_focus(page: Page, loc: Locator, what: str) -> None:
    def check_fn() -> None:
        if not loc.evaluate("(el) => el === document.activeElement || el.contains(document.activeElement)"):
            raise AssertionError("focus is elsewhere")
    wait_for(page, check_fn, what)


def test_wf_workload_breakdown_live_cross_project(browser: Browser, app_url: str) -> None:
    s = Seed(app_url)
    office, pack = s.pid["Office move"], s.ids["Office move"]["pack"]
    with s.page(browser, "asha", f"/projects/{s.sp}?view=workload") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Workload")
        asha_row = grid.get_by_role("row").filter(has=page.get_by_role("rowheader", name="Asha Rao"))
        ben_row = grid.get_by_role("row").filter(has=page.get_by_role("rowheader", name="Ben Ode"))
        tab_into(page, grid)
        cell_has_focus(page, asha_row.locator(f'[data-date="{mar(1)}"]'), "the active cell starts on Asha Rao's Mon 1 Mar")
        for _ in range(7):
            press(page, "ArrowRight")
        wed = asha_row.locator(f'[data-date="{mar(10)}"]')
        cell_has_focus(page, wed, "seven ArrowRight presses reach Wed 10 Mar")
        attr(page, wed, "aria-label", "Asha Rao, Wed 10 Mar 2027: 3 of 8 hours")
        attr(page, wed, "data-over", "false")
        press(page, "Enter")
        asha_name = PEOPLE["asha"][0]
        dlg = page.get_by_role("dialog", name=f"{asha_name}, Wed 10 Mar 2027")
        items = dlg.get_by_role("list", name="Assignments").get_by_role("listitem")
        wait_for(page, lambda: expect(items).to_have_text(["Office move: Pack desks, 3 hours"], timeout=POLL_MS), "Wed 10 Mar breakdown")
        press(page, "Escape")
        gone(page, dlg, "Escape closes the breakdown")
        cell_has_focus(page, wed, "focus back on Wed 10 Mar")
        edit(s.api("ben"), office, pack, start=mar(11))
        attr(page, wed, "data-hours", "0", "the push emptied Wed 10 Mar", LIVE_S)
        attr(page, wed, "aria-label", "Asha Rao, Wed 10 Mar 2027: 0 of 8 hours")
        for day in (11, 12):
            attr(page, asha_row.locator(f'[data-date="{mar(day)}"]'), "data-hours", "3", f"Pack desks now on {day} Mar")
        cell_has_focus(page, wed, "focus kept through the push")
        nxt = page.get_by_role("button", name="Next two weeks")
        nxt.focus()
        press(page, "Enter")
        wait_for(page, lambda: expect(page).to_have_url(re.compile(r"[?&]from=2027-03-15(&|$)"), timeout=POLL_MS), "from in the URL")
        attr(page, asha_row.locator(f'[data-date="{mar(15)}"]'), "data-hours", "3", "Pack desks' third day")
        mon = ben_row.locator(f'[data-date="{mar(15)}"]')
        attr(page, mon, "data-hours", "8")
        attr(page, mon, "data-over", "false", "8 of 8 is not over")
        attr(page, mon, "aria-label", "Ben Ode, Mon 15 Mar 2027: 8 of 8 hours")


def test_version_conflicts(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha, ben, cara = s.api("asha"), s.api("ben"), s.api("cara")
    S = s.s
    first = expect_error(ben.http.patch(f"/api/items/{S['review']}", json={"baseVersion": 0, "name": "x"}), 409, "version_conflict", keys=("item", "by"))
    assert first["by"] == "Asha Rao" and first["item"]["version"] == 1
    edit(ben, s.sp, S["review"], percent=80)
    stale = expect_error(cara.http.patch(f"/api/items/{S['review']}", json={"baseVersion": 1, "percent": 90}), 409, "version_conflict", keys=("item", "by"))
    assert stale["by"] == "Ben Ode" and stale["item"]["version"] == 2 and stale["item"]["percent"] == 80
    clients = [(asha, 30), (ben, 40), (cara, 50), (asha, 60)]
    barrier, results = threading.Barrier(len(clients)), [None] * len(clients)

    def fire(n: int, client: Api, pct: int) -> None:
        barrier.wait()
        results[n] = client.http.patch(f"/api/items/{S['write']}", json={"baseVersion": 1, "percent": pct})

    threads = [threading.Thread(target=fire, args=(n, c, p)) for n, (c, p) in enumerate(clients)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT_S)
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == len(clients) - 1, codes
    win = codes.index(200)
    stored = asha.items(s.sp)[S["write"]]
    assert (stored["percent"], stored["version"]) == (clients[win][1], 2)
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"] == "version_conflict" and r.json()["by"] in ("Asha Rao", "Ben Ode", "Cara Lund")
    with s.page(browser, "ben", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        draft = bar(page, S["draft"])
        click(draft)
        with held(page, "**/api/items/*") as gate:
            press(page, "ArrowRight")
            attr(page, draft, "aria-busy", "true")
            edit(asha, s.sp, S["draft"], start=mar(4))
            gate.release()
        seen(page, alert_with(page, "Asha Rao changed Draft brief first. Your change was not saved."), "conflict notice")
        attr(page, draft, "data-start", mar(4), "the bar shows the server's place", LIVE_S)
        edit(asha, s.sp, S["write"], percent=35)
        attr(page, bar(page, S["write"]), "data-percent", "35", "a later push arrived", LIVE_S)
        expect(alert_with(page, "Asha Rao changed Draft brief first. Your change was not saved.")).to_be_visible()
    d = asha.items(s.sp)[S["draft"]]
    assert (d["chosenStart"], d["version"]) == (mar(4), 2)


def test_presence_and_selection(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    timeout = config(app_url)["presenceTimeoutSeconds"]
    with s.page(browser, "asha", f"/projects/{s.sp}") as me:
        ready(me, "Spring launch")
        people = me.get_by_role("list", name="People here").get_by_role("listitem")
        with s.page(browser, "ben", f"/projects/{s.sp}") as ben:
            ready(ben, "Spring launch")
            with s.page(browser, "cara", f"/projects/{s.sp}") as cara:
                ready(cara, "Spring launch")
                wait_for(me, lambda: expect(people).to_have_text(["Asha Rao (you)", "Ben Ode", "Cara Lund"], timeout=POLL_MS), "People here", LIVE_S)
                wait_for(ben, lambda: expect(ben.get_by_role("list", name="People here").get_by_role("listitem")).to_have_text(
                    ["Ben Ode (you)", "Asha Rao", "Cara Lund"], timeout=POLL_MS), "Ben's People here", LIVE_S)
                click(bar(ben, s.s["design"]))
                attr(me, bar(me, s.s["design"]), "data-selected-by", "Ben Ode", "Ben's focus marked", LIVE_S)
                click(bar(cara, s.s["design"]))
                attr(me, bar(me, s.s["design"]), "data-selected-by", "Ben Ode, Cara Lund", "both names sorted", LIVE_S)
                press(ben, "ArrowUp")
                attr(me, bar(me, s.s["design"]), "data-selected-by", "Cara Lund", "Ben moved away", LIVE_S)
                attr(me, bar(me, s.s["write"]), "data-selected-by", "Ben Ode", "Ben's new focus", LIVE_S)
                pres = {p["name"]: p for p in ok(asha.http.get(f"/api/projects/{s.sp}/presence"))["people"]}
                assert pres["Ben Ode"]["selected"] == s.s["write"] and pres["Cara Lund"]["selected"] == s.s["design"]
                assert set(pres["Ben Ode"]) == {"userId", "name", "selected"}
        wait_for(me, lambda: expect(people).to_have_text(["Asha Rao (you)"], timeout=POLL_MS), "leavers removed", timeout + LIVE_S)
        expect(bar(me, s.s["design"])).not_to_have_attribute("data-selected-by", re.compile(".+"))


def test_open_dialog_keeps_its_edits(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "ben", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        wait_present(page, asha, s.sp, "Ben Ode")
        click(bar(page, S["write"]))
        press(page, "Enter")
        d = page.get_by_role("dialog", name="Task details")
        name = d.get_by_role("textbox", name="Name")
        fill(name, RENAMED)
        name.focus()
        edit(asha, s.sp, S["draft"], start=mar(4))
        attr(page, bar(page, S["write"]), "data-start", mar(5), "chart redrawn behind the dialog", LIVE_S)
        expect(name).to_have_value(RENAMED)
        expect(name).to_be_focused()
        expect(d.get_by_role("textbox", name="Start")).to_have_value(mar(2))
        edit(asha, s.sp, S["write"], percent=35)
        attr(page, bar(page, S["write"]), "data-percent", "35", "second push", LIVE_S)
        expect(d.get_by_role("spinbutton", name="Percent complete")).to_have_value("10")
        click(d.get_by_role("button", name="Save task"))
        seen(page, alert_with(d, "Asha Rao changed Write copy first. Your change was not saved."), "conflict in the dialog")
        value_is(page, name, "Write copy", "dialog takes the current name")
        value_is(page, d.get_by_role("spinbutton", name="Percent complete"), "35", "dialog takes the current percent")
        fill(name, RENAMED)
        click(d.get_by_role("button", name="Save task"))
        gone(page, d, "second save succeeds")
    w = asha.items(s.sp)[S["write"]]
    assert (w["name"], w["percent"], w["version"]) == (RENAMED, 35, 3)


def test_wf_live_conflict_dialog_conflict(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    path = f"/projects/{s.sp}?task={s.s['review']}"
    with s.page(browser, "ben", path) as ben, s.page(browser, "cara", path) as cara:
        for pg, other in ((ben, "Cara Lund"), (cara, "Ben Ode")):
            shows(pg, pg.get_by_role("list", name="People here"), other, "each sees the other", LIVE_S)
        bd, cd = ben.get_by_role("dialog", name="Task details"), cara.get_by_role("dialog", name="Task details")
        fill(bd.get_by_role("textbox", name="Name"), "Review brief with legal")
        fill(cd.get_by_role("textbox", name="Name"), "Review brief twice")
        click(cd.get_by_role("button", name="Save task"))
        gone(cara, cd, "first save wins")
        click(bd.get_by_role("button", name="Save task"))
        seen(ben, alert_with(bd, "Cara Lund changed Review brief first. Your change was not saved."), "conflict notice names Cara")
        value_is(ben, bd.get_by_role("textbox", name="Name"), "Review brief twice", "current values shown")
        fill(bd.get_by_role("textbox", name="Name"), "Review brief with legal")
        click(bd.get_by_role("button", name="Save task"))
        gone(ben, bd, "second save succeeds")
    r = asha.items(s.sp)[s.s["review"]]
    assert (r["name"], r["version"]) == ("Review brief with legal", 3)


def test_wf_live_conflict_simultaneous_nudge(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "ben", f"/projects/{s.sp}") as ben, s.page(browser, "cara", f"/projects/{s.sp}") as cara:
        ready(ben, "Spring launch")
        ready(cara, "Spring launch")
        for pg in (ben, cara):
            click(bar(pg, s.s["draft"]))
        with held(ben, "**/api/items/*") as gb, held(cara, "**/api/items/*") as gc:
            press(ben, "ArrowRight")
            press(cara, "ArrowRight")
            gb.release()
            gc.release()
        sentence = "Draft brief now starts Tue 2 Mar 2027 and ends Thu 4 Mar 2027."
        notice = "changed Draft brief first. Your change was not saved."
        deadline = time.monotonic() + SETTLE_S
        while time.monotonic() < deadline:
            won = [pg for pg in (ben, cara) if sentence in schedule(pg).inner_text()]
            lost = [pg for pg in (ben, cara) if alert_with(pg, notice).count() and alert_with(pg, notice).is_visible()]
            if won and lost:
                break
            advance(ben, STEP_MS)
            advance(cara, STEP_MS)
        else:
            pytest.fail("expected one editor to hear the move and the other to see the conflict notice")
        assert len(won) == 1 and len(lost) == 1 and won[0] is not lost[0]
        for pg in (ben, cara):
            attr(pg, bar(pg, s.s["draft"]), "data-start", mar(2), "both show the server's place", LIVE_S)
    d = asha.items(s.sp)[s.s["draft"]]
    assert (d["chosenStart"], d["version"]) == (mar(2), 2)


def test_comments(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha, ben, devi = s.api("asha"), s.api("ben"), s.api("devi")
    path = f"/api/items/{s.s['draft']}/comments"
    first = ok(asha.http.post(path, json={"text": "Supplier slipped."}), 201)["comment"]
    assert set(first) == {"id", "author", "text", "createdAt"} and first["author"] == {"userId": s.users["asha"], "name": "Asha Rao"}
    assert re.match(r"\d{4}-\d{2}-\d{2}T", first["createdAt"])
    ok(ben.http.post(path, json={"text": "x" * COMMENT_MAX}), 201)
    expect_error(ben.http.post(path, json={"text": "x" * (COMMENT_MAX + 1)}), 422, "invalid_field", field="text")
    expect_error(ben.http.post(path, json={"text": "   "}), 422, "invalid_field", field="text")
    expect_error(devi.http.post(path, json={"text": "Mine"}), 403, "read_only")
    listed = ok(devi.http.get(path))["comments"]
    assert [c["author"]["name"] for c in listed] == ["Asha Rao", "Ben Ode"]
    assert asha.items(s.sp)[s.s["draft"]]["version"] == 1, "comments do not change the version"
    with s.page(browser, "ben", f"/projects/{s.sp}?task={s.s['draft']}") as watch, s.page(browser, "asha", f"/projects/{s.sp}?task={s.s['draft']}") as page:
        wd = watch.get_by_role("dialog", name="Task details")
        seen(watch, wd, "Ben's dialog")
        d = page.get_by_role("dialog", name="Task details")
        post = d.get_by_role("button", name="Post comment")
        wait_for(page, lambda: expect(post).to_be_disabled(timeout=POLL_MS), "Post comment disabled while empty")
        box = d.get_by_role("textbox", name="New comment")
        fill(box, "Copy due Friday.")
        box.focus()
        press(page, "Control+Enter")
        shows(page, schedule(page), "Comment posted.")
        items = wd.get_by_role("list", name="Comments").get_by_role("listitem")
        wait_for(watch, lambda: expect(items.last).to_have_text(f"Asha Rao: {COMMENT_NOW}", timeout=POLL_MS), "comment pushed live", LIVE_S)
        expect(items.first).to_have_text(f"Asha Rao: {COMMENT_OLD}")


def test_assignment_notice(app_url: str, mail: Any) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    delay = config(app_url)["assignNoticeDelaySeconds"]
    t0 = time.monotonic()
    ok(asha.http.post(f"/api/items/{s.s['write']}/assignees", json={"userId": s.users["ben"], "hours": 6}), 201)
    t1 = time.monotonic()
    ok(asha.http.post(f"/api/items/{s.s['review']}/assignees", json={"userId": s.users["cara"], "hours": 2}), 201)
    ok(asha.http.delete(f"/api/items/{s.s['review']}/assignees/{s.users['cara']}"))
    ok(asha.http.post(f"/api/items/{s.s['review']}/assignees", json={"userId": s.users["asha"], "hours": 2}), 201)
    while time.monotonic() < t0 + delay - MAIL_POLL_S:
        assert not mails_to(mail, s.emails["ben"]), "the notice arrived before the configured delay"
    got, seen_at = wait_mail(mail, s.emails["ben"], t1 + delay + NOTICE_LATEST_S + MAIL_SLACK_S, "assignment notice")
    assert seen_at <= t1 + delay + NOTICE_LATEST_S + MAIL_SLACK_S
    end = t1 + delay + NOTICE_LATEST_S + MAIL_SLACK_S
    while time.monotonic() < end:
        mails_to(mail, s.emails["ben"])
    msgs = mails_to(mail, s.emails["ben"])
    assert len(msgs) == 1, f"expected exactly one notice, got {len(msgs)}"
    m = msgs[0]
    assert m["Subject"] == "New assignment: Write copy in Spring launch"
    assert addresses(m.get("To")) == [s.emails["ben"]]
    assert mail_from_address() in addresses(m.get("From"))
    lines = [l.strip() for l in text(m).splitlines() if l.strip()]
    for line in ("Asha Rao assigned you to Write copy in Spring launch.", "Starts: Tue 2 Mar 2027", "Ends: Wed 3 Mar 2027", "Hours a day: 6"):
        assert line in lines, f"missing body line {line!r}"
    opened = [l for l in lines if l.startswith("Open: ")]
    assert len(opened) == 1 and opened[0].endswith(f"/projects/{s.sp}?task={s.s['write']}")
    assert not mails_to(mail, s.emails["cara"]), "a removed assignment sent a notice"
    assert not mails_to(mail, s.emails["asha"]), "self-assignment or the setup route sent a notice"


def test_wf_comments_mail_happy(browser: Browser, app_url: str, mail: Any) -> None:
    s = Seed(app_url, projects=("spring",))
    delay = config(app_url)["assignNoticeDelaySeconds"]
    with s.page(browser, "ben", f"/projects/{s.sp}?task={s.s['write']}") as editor, s.page(browser, "asha", f"/projects/{s.sp}") as owner:
        wd = editor.get_by_role("dialog", name="Task details")
        seen(editor, wd, "editor's dialog open")
        ready(owner, "Spring launch")
        tab_into(owner, owner.get_by_role("region", name="Chart"))
        for _ in range(2):
            press(owner, "ArrowDown")
        focused(owner, bar(owner, s.s["write"]), "focus on Write copy")
        press(owner, "Enter")
        d = owner.get_by_role("dialog", name="Task details")
        tab_to(owner, d.get_by_role("textbox", name="New comment"))
        owner.keyboard.type("Copy due Friday.")
        press(owner, "Control+Enter")
        shows(owner, schedule(owner), "Comment posted.")
        shows(editor, wd.get_by_role("list", name="Comments"), f"Asha Rao: {COMMENT_NOW}", "comment live for the editor", LIVE_S)
        combo = d.get_by_role("combobox", name="Add person")
        tab_to(owner, combo)
        select(combo, "Ben Ode")
        tab_to(owner, d.get_by_role("button", name="Assign"))
        t0 = time.monotonic()
        press(owner, "Enter")
        shows(owner, schedule(owner), "Ben Ode assigned to Write copy, 8 hours a day.")
        got, _ = wait_mail(mail, s.emails["ben"], t0 + delay + NOTICE_LATEST_S + MAIL_SLACK_S, "editor's notice")
        assert got[0]["Subject"] == "New assignment: Write copy in Spring launch"
        link = next(l.strip()[len("Open: "):] for l in text(got[0]).splitlines() if l.strip().startswith("Open: "))
        target = urlparse(link)
        editor.goto(app_url + f"{target.path}?{target.query}")
        value_is(editor, editor.get_by_role("dialog", name="Task details").get_by_role("textbox", name="Name"), "Write copy", "mail link opens the task")
    assert s.users["ben"] in [a["userId"] for a in s.api("asha").items(s.sp)[s.s["write"]]["assignees"]]


@pytest.mark.timeout(240)
def test_wf_comments_mail_cancelled(browser: Browser, app_url: str, mail: Any) -> None:
    s = Seed(app_url, projects=("spring",))
    delay = config(app_url)["assignNoticeDelaySeconds"]
    with s.page(browser, "asha", f"/projects/{s.sp}?task={s.s['review']}") as page:
        d = page.get_by_role("dialog", name="Task details")
        region = d.get_by_role("region", name="Assignees")
        select(region.get_by_role("combobox", name="Add person"), "Cara Lund")
        t0 = time.monotonic()
        click(region.get_by_role("button", name="Assign"))
        shows(page, schedule(page), "Cara Lund assigned to Review brief, 8 hours a day.")
        click(region.get_by_role("button", name="Remove Cara Lund"))
        shows(page, schedule(page), "Cara Lund removed from Review brief.")
    while time.monotonic() < t0 + delay + NOTICE_LATEST_S + MAIL_SLACK_S:
        assert not mails_to(mail, s.emails["cara"]), "a cancelled notice was sent"
    assert s.api("asha").items(s.sp)[s.s["review"]]["assignees"] == []


def test_wf_comments_mail_two_dialogs_live(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    note, answer = "Grids need a second pass.", "Second pass booked for Monday."
    path = f"/projects/{s.sp}?task={s.s['design']}"
    with s.page(browser, "ben", path) as ben, s.page(browser, "cara", path) as cara:
        bd, cd = ben.get_by_role("dialog", name="Task details"), cara.get_by_role("dialog", name="Task details")
        seen(ben, bd, "Ben's Task details")
        seen(cara, cd, "Cara's Task details")
        wait_present(cara, s.api("asha"), s.sp, "Cara Lund")
        cbox = cd.get_by_role("textbox", name="New comment")
        tab_to(cara, cbox)
        cara.keyboard.type(answer)
        bbox = bd.get_by_role("textbox", name="New comment")
        tab_to(ben, bbox)
        ben.keyboard.type(note)
        press(ben, "Control+Enter")
        shows(ben, schedule(ben), "Comment posted.")
        shows(cara, cd.get_by_role("list", name="Comments"), f"Ben Ode: {note}", "Ben's comment live in Cara's dialog", LIVE_S)
        shows(cara, updates(cara), "Ben Ode commented on Design pages.", seconds=LIVE_S)
        value_is(cara, cbox, answer, "Cara's unsaved comment kept")
        focused(cara, cbox, "Cara's focus kept")
        value_is(cara, cd.get_by_role("textbox", name="Name"), "Design pages", "Cara's fields unchanged")
        press(cara, "Control+Enter")
        shows(cara, schedule(cara), "Comment posted.")
        order = [f"Ben Ode: {note}", f"Cara Lund: {answer}"]
        bitems = bd.get_by_role("list", name="Comments").get_by_role("listitem")
        wait_for(ben, lambda: expect(bitems).to_have_text(order, timeout=POLL_MS), "oldest first in Ben's dialog", LIVE_S)
        shows(ben, updates(ben), "Cara Lund commented on Design pages.", seconds=LIVE_S)
        cara.reload()
        citems = cara.get_by_role("dialog", name="Task details").get_by_role("list", name="Comments").get_by_role("listitem")
        wait_for(cara, lambda: expect(citems).to_have_text(order, timeout=POLL_MS), "oldest first after a reload")
    listed = ok(s.api("asha").http.get(f"/api/items/{s.s['design']}/comments"))["comments"]
    assert [(c["author"]["name"], c["text"]) for c in listed] == [("Ben Ode", note), ("Cara Lund", answer)]


@pytest.mark.timeout(240)
def test_wf_comments_mail_rescheduled_and_signin(browser: Browser, app_url: str, mail: Any) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    delay = config(app_url)["assignNoticeDelaySeconds"]
    with s.page(browser, "asha", f"/projects/{s.sp}") as owner:
        ready(owner, "Spring launch")
        review = bar(owner, S["review"])
        click(review)
        press(owner, "Enter")
        d = owner.get_by_role("dialog", name="Task details")
        region = d.get_by_role("region", name="Assignees")
        ben = s.api("ben")
        combo = region.get_by_role("combobox", name="Add person")
        tab_to(owner, combo)
        select(combo, "Cara Lund")
        fill(region.get_by_role("spinbutton", name="Hours a day"), "2.5")
        tab_to(owner, region.get_by_role("button", name="Assign"))
        t0 = time.monotonic()
        press(owner, "Enter")
        shows(owner, schedule(owner), "Cara Lund assigned to Review brief, 2.5 hours a day.")
        edit(ben, s.sp, S["review"], start=mar(5))
        assert time.monotonic() - t0 < delay, "infra: the reschedule did not land inside the notice delay"
        shows(owner, region.get_by_role("list", name="Assignees"), "Cara Lund, 2.5 hours a day")
        press(owner, "Escape")
        focused(owner, review, "Escape returns focus to Review brief")
        on_dates(owner, S["review"], mar(5), mar(8), "the editor's move reached the owner's chart")
        shows(owner, updates(owner), "Ben Ode changed Review brief.", seconds=LIVE_S)
    got, _ = wait_mail(mail, s.emails["cara"], t0 + delay + NOTICE_LATEST_S + MAIL_SLACK_S, "Cara's notice")
    m = got[0]
    assert m["Subject"] == "New assignment: Review brief in Spring launch"
    lines = [l.strip() for l in text(m).splitlines() if l.strip()]
    for line in ("Asha Rao assigned you to Review brief in Spring launch.", "Starts: Fri 5 Mar 2027", "Ends: Mon 8 Mar 2027", "Hours a day: 2.5"):
        assert line in lines, f"missing body line {line!r} (dates as scheduled when the mail is sent)"
    link = next(l[len("Open: "):] for l in lines if l.startswith("Open: "))
    target = urlparse(link)
    with open_app(browser, app_url + f"{target.path}?{target.query}") as page:
        wait_for(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=POLL_MS), "signed out: sent to sign-in")
        tab_to(page, page.get_by_role("textbox", name="Email"))
        page.keyboard.type(s.emails["cara"])
        tab_to(page, page.get_by_label("Password", exact=True))
        page.keyboard.type(PEOPLE["cara"][1])
        tab_to(page, page.get_by_role("button", name="Sign in"))
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Task details")
        value_is(page, dialog.get_by_role("textbox", name="Name"), "Review brief", "the link opens Review brief after sign-in")
        assert parse_qs(urlparse(page.url).query).get("task") == [S["review"]]
        shows(page, dialog.get_by_role("list", name="Assignees"), "Cara Lund, 2.5 hours a day")


def test_export_menu_and_stored_files(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        export = page.get_by_role("button", name="Export")
        export.focus()
        press(page, "Enter")
        menu = page.get_by_role("menu", name="Export")
        focused(page, menu.get_by_role("menuitem", name="Export CSV"), "menu opens on its first item")
        press(page, "ArrowDown")
        focused(page, menu.get_by_role("menuitem", name="Export PDF"), "ArrowDown")
        press(page, "Escape")
        gone(page, menu, "Escape closes the menu")
        focused(page, export, "focus back on Export")
        press(page, "ArrowDown")
        focused(page, menu.get_by_role("menuitem", name="Export CSV"), "ArrowDown opens the menu")
        link = page.get_by_role("region", name="Exports").get_by_role("link", name=f"Download {SPRING_CSV}")
        with held(page, "**/api/projects/*/exports") as gate:
            press(page, "Enter")
            gone(page, menu, "choosing closes the menu")
            focused(page, export, "focus back on Export")
            shows(page, page.get_by_role("status", name="Export status"), "Preparing the CSV export.")
            expect(link).to_have_count(0)
            gate.release()
        shows(page, page.get_by_role("status", name="Export status"), f"{SPRING_CSV} is ready to download.")
        seen(page, link, "download link after the 201")
        shows(page, page.get_by_role("region", name="Exports"), "Ready")
        page.reload()
        seen(page, link, "export listed after a reload")
        href = urljoin(app_url + "/", link.get_attribute("href") or "")
    listed = ok(asha.http.get(f"/api/projects/{s.sp}/exports"))["exports"]
    assert len(listed) == 1 and listed[0]["filename"] == SPRING_CSV and listed[0]["downloadUrl"] == f"/api/exports/{listed[0]['id']}/download"
    key = f"exports/{s.sp}/{listed[0]['id']}/{SPRING_CSV}"
    assert key in S3().keys(f"exports/{s.sp}/"), "the stored object is in MinIO"
    r = asha.http.get(href)
    assert r.status_code == 200 and r.content == S3().get(key)
    assert r.headers["content-type"].lower().replace(" ", "") == CSV_TYPE.replace(" ", "")
    assert r.headers["content-disposition"] == f'attachment; filename="{SPRING_CSV}"'
    pdf = export_once(asha, s.sp, "pdf")
    assert set(pdf) == {"id", "format", "filename", "downloadUrl"} and pdf["filename"] == SPRING_PDF
    assert [e["format"] for e in ok(asha.http.get(f"/api/projects/{s.sp}/exports"))["exports"]] == ["pdf", "csv"], "newest first"
    expect_error(asha.http.post(f"/api/projects/{s.sp}/exports", json={"format": "docx"}), 422, "invalid_field", field="format")


CSV_CASES = {"equals": "=", "plus": "+", "minus": "-", "at": "@"}


CSV_IDS = ["equals", "plus", "minus", "at"]


@pytest.mark.parametrize("lead", ["=", "+", "-", "@"], ids=CSV_IDS)
def test_csv_content(app_url: str, lead: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    grp = ok(asha.http.post(f"/api/projects/{s.sp}/items", json={"name": f"{lead}Stage", "kind": "group"}), 201)["item"]
    ok(asha.http.post(f"/api/projects/{s.sp}/items", json={"name": f"{lead}Total", "kind": "task", "group": grp["id"]}), 201)
    made = export_once(asha, s.sp, "csv")
    data = S3().get(f"exports/{s.sp}/{made['id']}/{made['filename']}")
    assert not data.startswith(b"\xef\xbb\xbf"), "no byte-order mark"
    body = data.decode("utf-8")
    assert "\n" not in body.replace("\r\n", ""), "every line ends with CRLF"
    lines = body.split("\r\n")
    assert lines[0] == CSV_HEADER
    assert lines[1:7] == [
        "1,Content,group,,2027-03-01,2027-03-05,5,33,no,,,,,",
        "2,Draft brief,task,Content,2027-03-01,2027-03-03,3,20,no,Asha Rao (4),,,,",
        "3,Review brief,task,Content,2027-03-04,2027-03-05,2,75,no,,2FS,,,",
        f"4,Write copy,task,Content,{mar(2)},{mar(3)},2,10,no,,2SS+1,,,",
        f"5,Design pages,task,,{mar(11)},{mar(16)},4,0,yes,Ben Ode (8),3FS,,,",
        f"6,Sign-off,milestone,,{mar(16)},{mar(16)},0,0,yes,,5FS,,,",
    ]
    rows = [r for r in csv.reader(io.StringIO(body, newline="")) if r]
    assert len(rows) == 9
    assert rows[7][1:4] == [f"'{lead}Stage", "group", ""]
    assert rows[8][1:4] == [f"'{lead}Total", "task", f"'{lead}Stage"] and rows[8][4] == TODAY


def test_pdf_content(app_url: str) -> None:
    steps = [it(f"s{n}", f"Step {n}", "task", None, mar(1), 1, 0) for n in range(1, PDF_ROWS + 2)]
    s = Seed(app_url, projects=("spring",), extra=[{"name": LONG_PLAN, "holidays": [], "items": steps, "links": [], "baseline": None}])
    asha = s.api("asha")
    made = export_once(asha, s.sp, "pdf")
    r = asha.http.get(made["downloadUrl"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    assert r.content == S3().get(f"exports/{s.sp}/{made['id']}/{SPRING_PDF}")
    flat = " ".join(pdf_text(r.content).split())
    assert "Spring launch" in flat and "Page 1 of 1" in flat
    assert f"2 Draft brief {mar(1)} {mar(3)} 3 20%" in flat
    assert f"6 Sign-off {mar(16)} {mar(16)} 0 0%" in flat
    long_pid = s.pid[LONG_PLAN]
    data = asha.http.get(export_once(asha, long_pid, "pdf")["downloadUrl"]).content
    pages = [" ".join(p.split()) for p in pdf_text(data).split("\f") if p.strip()]
    assert len(pages) == 2, f"expected ceil(21 / 20) pages, got {len(pages)}"
    for n, page in enumerate(pages, start=1):
        assert LONG_PLAN in page and f"Page {n} of 2" in page
    for n in range(1, PDF_ROWS + 1):
        assert f"{n} Step {n} {mar(1)} {mar(1)} 1 0%" in pages[0]
    assert f"{PDF_ROWS + 1} Step {PDF_ROWS + 1} {mar(1)} {mar(1)} 1 0%" in pages[1]


def test_storage_outage_api(app_url: str) -> None:
    base = outage_url()
    s = Seed(base, projects=("spring",))
    asha = s.api("asha")
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    for fmt in ("csv", "pdf"):
        expect_error(asha.http.post(f"/api/projects/{s.sp}/exports", json={"format": fmt}), 503, "storage_unavailable")
    assert ok(asha.http.get(f"/api/projects/{s.sp}/exports")) == {"exports": []}
    assert S3().keys(f"exports/{s.sp}/") == []
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200


def menu_export(page: Page, item: str) -> None:
    export = page.get_by_role("button", name="Export")
    tab_to(page, export)
    press(page, "Enter")
    menu = page.get_by_role("menu", name="Export")
    focused(page, menu.get_by_role("menuitem", name="Export CSV"), "menu open")
    if item == "Export PDF":
        press(page, "ArrowDown")
    press(page, "Enter")


def test_wf_export_and_outage_owner_keyboard(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        shelf = page.get_by_role("region", name="Exports")
        for item, fname in (("Export CSV", SPRING_CSV), ("Export PDF", SPRING_PDF)):
            with held(page, "**/api/projects/*/exports") as gate:
                menu_export(page, item)
                expect(shelf.get_by_role("link", name=f"Download {fname}")).to_have_count(0)
                gate.release()
            seen(page, shelf.get_by_role("link", name=f"Download {fname}"), f"{fname} link after storing")
        page.reload()
        for fname in (SPRING_CSV, SPRING_PDF):
            seen(page, shelf.get_by_role("link", name=f"Download {fname}"), f"{fname} after reload")
    for e in ok(asha.http.get(f"/api/projects/{s.sp}/exports"))["exports"]:
        body = asha.http.get(e["downloadUrl"]).content
        assert body == S3().get(f"exports/{s.sp}/{e['id']}/{e['filename']}")
        if e["format"] == "csv":
            assert body.decode("utf-8").split("\r\n")[0] == CSV_HEADER
        else:
            assert "Spring launch" in pdf_text(body)


def test_wf_export_and_outage_viewer(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "devi", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        menu_export(page, "Export CSV")
        link = page.get_by_role("region", name="Exports").get_by_role("link", name=f"Download {SPRING_CSV}")
        seen(page, link, "viewer's download link")
        resp = page.request.get(urljoin(app_url + "/", link.get_attribute("href") or ""))
        body = resp.body()
        assert resp.status == 200 and body.decode("utf-8").split("\r\n")[0] == CSV_HEADER
    listed = ok(s.api("devi").http.get(f"/api/projects/{s.sp}/exports"))["exports"]
    assert S3().get(f"exports/{s.sp}/{listed[0]['id']}/{SPRING_CSV}") == body


def test_wf_export_and_outage_outage(browser: Browser, app_url: str) -> None:
    base = outage_url()
    s = Seed(base, projects=("spring",))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        menu_export(page, "Export CSV")
        seen(page, alert_with(page, OUTAGE_ALERT), "outage alert")
        shelf = page.get_by_role("region", name="Exports")
        expect(shelf.get_by_role("link", name=f"Download {SPRING_CSV}")).to_have_count(0)
        page.reload()
        ready(page, "Spring launch")
        expect(shelf.get_by_role("link")).to_have_count(0)
    assert S3().keys(f"exports/{s.sp}/") == []


def test_wf_export_and_outage_phone_progress(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "ben", f"/projects/{s.sp}", PHONE) as page:
        ready(page, "Spring launch")
        cards = page.get_by_role("list", name="Timeline")
        write_card = cards.get_by_role("listitem").filter(has_text="Write copy")
        shows(page, write_card, "Late", "Write copy is late at start")
        write = "Write copy"
        button = page.get_by_role("button", name=f"Update progress for {write}")
        tab_to(page, button)
        press(page, "Enter")
        sheet = page.get_by_role("dialog", name="Update progress")
        slider = sheet.get_by_role("slider", name="Percent complete")
        slider.focus()
        press(page, "End")
        slider_is(page, slider, "100", "End sets 100")
        shows(page, sheet, "100%")
        tab_to(page, sheet.get_by_role("button", name="Save progress"))
        press(page, "Enter")
        shows(page, schedule(page), "Write copy is 100% complete.")
        focused(page, button, "focus returns to the card's button")
        shows(page, write_card, "100% complete")
        wait_for(page, lambda: expect(write_card).not_to_contain_text("Late", timeout=POLL_MS), "Write copy no longer late")
        shows(page, cards.get_by_role("listitem").filter(has_text="Content"), "59% complete", "Content rollup (60 + 150 + 200) / 7")
        export = page.get_by_role("button", name="Export")
        export.focus()
        press(page, "Enter")
        focused(page, page.get_by_role("menu", name="Export").get_by_role("menuitem", name="Export CSV"), "menu opens on Export CSV")
        press(page, "Enter")
        shows(page, page.get_by_role("status", name="Export status"), f"{SPRING_CSV} is ready to download.")
        link = page.get_by_role("region", name="Exports").get_by_role("link", name=f"Download {SPRING_CSV}")
        seen(page, link, "download link on the phone")
        box = link.bounding_box()
        assert box and box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX, f"download link {box} is under 44 by 44"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "the phone page scrolls sideways"
    listed = ok(s.api("ben").http.get(f"/api/projects/{s.sp}/exports"))["exports"]
    lines = S3().get(f"exports/{s.sp}/{listed[0]['id']}/{SPRING_CSV}").decode("utf-8").split("\r\n")
    rollup = round((3 * 20 + 2 * 75 + 2 * 100) / 7)
    assert lines[1] == f"1,Content,group,,{mar(1)},{mar(5)},5,{rollup},no,,,,,"
    assert lines[4] == f"4,Write copy,task,Content,{mar(2)},{mar(3)},2,100,no,,2SS+1,,,"


def test_knock_on_motion(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    cfg = config(app_url)
    stagger, slide, fin = cfg["knockOnStaggerMs"], cfg["knockOnMs"], cfg["finishMotionMs"]
    asha = s.api("asha")
    S = s.s
    full = {"review": -5 * DAY_PX, "write": -3 * DAY_PX, "design": -DAY_PX, "signoff": -DAY_PX}
    with s.page(browser, "ben", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        wait_present(page, asha, s.sp, "Ben Ode")
        edit(asha, s.sp, S["draft"], start=mar(4))
        expect(bar(page, S["design"])).to_have_attribute("data-start", mar(12), timeout=LIVE_S * 1000)
        marker = finish_marker(page)
        elapsed = 0.0

        def at(ms: float) -> dict[str, tuple[str | None, float]]:
            nonlocal elapsed
            advance(page, ms - elapsed)
            elapsed = ms
            out = {k: motion_state(page, bar(page, S[k])) for k in ("draft", "content", *full)}
            out["finish"] = motion_state(page, marker)
            return out

        t = at(stagger / 2)
        for k, v in full.items():
            assert t[k] == ("knock-on", v), f"{k} holds its old place before its depth starts: {t[k]}"
        assert t["draft"][0] is None and t["content"][0] is None, "edited and group bars jump"
        assert t["finish"][0] is None
        t = at(stagger * 1.5)
        for k in ("review", "write"):
            assert t[k][0] == "knock-on" and full[k] < t[k][1] < 0, f"depth 1 {k} slides: {t[k]}"
        assert t["design"] == ("knock-on", full["design"]) and t["signoff"] == ("knock-on", full["signoff"]), "deeper bars wait"
        t = at(stagger + slide + stagger / 2)
        for k in ("review", "write"):
            assert t[k][0] is None and t[k][1] == 0, f"depth 1 {k} settled: {t[k]}"
        assert t["signoff"][0] == "knock-on", "depth 3 still sliding"
        assert t["finish"][0] is None, "finish waits for the last bar"
        t = at(3 * stagger + slide + fin / 2)
        assert all(t[k][0] is None and t[k][1] == 0 for k in full), t
        assert t["finish"][0] == "finish" and t["finish"][1] <= 0
        t = at(3 * stagger + slide + fin + 2 * stagger)
        assert t["finish"] == (None, 0), t["finish"]
        expect(marker).to_have_attribute("data-date", mar(17))
        for k in full:
            expect(bar(page, S[k])).to_have_attribute("data-shifted", "true")


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    cfg = config(app_url)
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}", reduced_motion="reduce") as page:
        ready(page, "Spring launch")
        draft = bar(page, S["draft"])
        click(draft)
        for day in (2, 3, 4):
            press(page, "ArrowRight")
            expect(draft).to_have_attribute("data-start", mar(day), timeout=LIVE_S * 1000)
            for _ in range(3):
                assert page.evaluate("() => document.querySelectorAll('[data-motion]').length") == 0, "data-motion under reduced motion"
                for k in ("review", "write", "design", "signoff"):
                    assert motion_state(page, bar(page, S[k]))[1] == 0
                assert motion_state(page, finish_marker(page))[1] == 0
                advance(page, cfg["knockOnStaggerMs"])
        shows(page, schedule(page), "Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.")
        for k in ("review", "write", "design", "signoff"):
            expect(bar(page, S[k])).to_have_attribute("data-shifted", "true")
        expect(finish_marker(page)).to_have_attribute("data-date", mar(17))


def test_axe_at_published_sizes(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            for view in ("gantt", "list", "workload"):
                page.goto(app_url + f"/projects/{s.sp}?view={view}")
                ready(page, "Spring launch")
                axe(page)


def test_focus_visible_and_dialog_traps(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    ring = ("outline-style", "outline-width", "outline-color", "box-shadow", "stroke", "stroke-width")
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        for loc in (bar(page, s.s["draft"]), page.get_by_role("button", name="Holidays")):
            rest, focus = state_styles(loc, *ring, state="focus")
            assert rest != focus, "keyboard focus is not visible"
        opener = page.get_by_role("button", name="Holidays")
        click(opener)
        d = page.get_by_role("dialog", name="Holidays")
        seen(page, d, "Holidays open")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                press(page, key)
                assert d.evaluate("(el) => el.contains(document.activeElement)"), f"{key} left the Holidays dialog"
        press(page, "Escape")
        gone(page, d, "Escape closes Holidays")
        focused(page, opener, "focus back on Holidays")
        page.set_viewport_size(PHONE)
        btn = page.get_by_role("button", name=f"Update progress for {DRAFT_BRIEF}")
        click(btn)
        sheet = page.get_by_role("dialog", name="Update progress")
        seen(page, sheet, "sheet open")
        for _ in range(TAB_PRESSES):
            press(page, "Tab")
            assert sheet.evaluate("(el) => el.contains(document.activeElement)"), "Tab left the progress sheet"
        press(page, "Escape")
        gone(page, sheet, "Escape closes the sheet")
        focused(page, btn, "focus back on the card button")


def test_wf_list_grid_build_rows_after_regroup(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        order = [S[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
        grid_goto(page, grid, order, None, "Name")
        add_row(page, "Hire van")
        shows(page, schedule(page), "Hire van added as row 7.")
        van = next(i["id"] for i in asha.project(s.sp)["items"] if i["name"] == "Hire van")
        order = order + [van]
        for key, group_sentence in (("design", "Design pages is now in Content."), ("signoff", "Sign-off is now in Content.")):
            grid_goto(page, grid, order, S[key], "Name")
            press(page, "Alt+ArrowRight")
            shows(page, schedule(page), group_sentence)
        grid_goto(page, grid, order, None, "Name")
        add_row(page, "Book caterer")
        shows(page, schedule(page), "Book caterer added as row 8.", "a new task is the project's last row")
        caterer = next(i["id"] for i in asha.project(s.sp)["items"] if i["name"] == "Book caterer")
        grid_rows = grid.get_by_role("row")
        attr(page, grid_rows.nth(grid_rows.count() - 2), "data-item-id", caterer,
             "Book caterer is the last item row, just above Add task")
        order = order + [caterer]
        grid_goto(page, grid, order, S["content"], "Name")
        before = schedule(page).inner_text()
        press(page, "Alt+ArrowDown")
        assert active(page)["item"] == S["content"], "Alt+ArrowDown on a group row leaves the active cell on Content"
        assert schedule(page).inner_text() == before, "nothing is announced for a group row"
    items = asha.project(s.sp)["items"]
    assert [i["name"] for i in items][-2:] == ["Hire van", "Book caterer"] and items[-1]["row"] == 8
    by = {i["id"]: i for i in items}
    assert by[S["design"]]["group"] == S["content"] and by[S["signoff"]]["group"] == S["content"]


def test_wf_list_grid_build_empty_cells_refused(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}?view=list") as page:
        ready(page, "Spring launch")
        grid = page.get_by_role("grid", name="Task list")
        order = [S[k] for k in ("content", "draft", "review", "write", "design", "signoff")]
        for key, column, message in (("review", "Duration", "Duration must be a whole number from 0 to 999."),
                                     ("draft", "% complete", "Percent complete must be a whole number from 0 to 100.")):
            grid_goto(page, grid, order, S[key], column)
            editor = edit_cell(page, column, "")
            attr(page, editor, "aria-invalid", "true", f"an empty {column} is refused")
            seen(page, alert_with(page, message), f"empty {column} refusal in the page alert")
            seen(page, editor, f"the {column} textbox stays open")
            press(page, "Escape")
            gone(page, page.get_by_role("textbox", name=column), "Escape closes the textbox")
    items = asha.items(s.sp)
    r, d = items[S["review"]], items[S["draft"]]
    assert (r["kind"], r["duration"], r["version"]) == ("task", 2, 1), "the empty Duration saved nothing"
    assert (d["percent"], d["version"]) == (20, 1), "the empty % complete saved nothing"


def test_wf_keyboard_bars_baseline_shown(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",), baseline={"name": "Plan A"})
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}?baseline=on") as page:
        ready(page, "Spring launch")
        seen(page, ghost(page, S["draft"]), "Show baseline draws the ghost bars")
        tab_into(page, page.get_by_role("region", name="Chart"))
        focused(page, bar(page, S["draft"]), "the chart tab stop starts on Draft brief")
        press(page, "ArrowDown")
        focused(page, bar(page, S["review"]), "ArrowDown moves to Review brief with the baseline shown")
        press(page, "ArrowDown")
        focused(page, bar(page, S["write"]), "ArrowDown moves to Write copy")
        press(page, "ArrowUp")
        focused(page, bar(page, S["review"]), "ArrowUp moves back to Review brief")
        press(page, "ArrowRight")
        attr(page, bar(page, S["review"]), "data-start", mar(5), "ArrowRight moved Review brief one working day")
        focused(page, bar(page, S["review"]), "focus kept on Review brief")
    assert s.api("asha").items(s.sp)[S["review"]]["chosenStart"] == mar(5)


def test_wf_move_later_earlier_details_refusals(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        review = bar(page, S["review"])
        click(review)
        press(page, "Enter")
        d = page.get_by_role("dialog", name="Task details")
        seen(page, d, "Task details for Review brief")
        dur = d.get_by_role("spinbutton", name="Duration")
        fill(dur, "")
        click(d.get_by_role("button", name="Save task"))
        seen(page, alert_with(d, "Duration must be a whole number from 0 to 999."), "empty Duration refused")
        attr(page, dur, "aria-invalid", "true")
        expect(d).to_be_visible()
        press(page, "Escape")
        gone(page, d, "Escape closes")
        attr(page, review, "data-kind", "task", "Review brief is still a task")
        attr(page, review, "data-duration", "2")
        click(review)
        press(page, "Enter")
        seen(page, d, "Task details reopened")
        name = d.get_by_role("textbox", name="Name")
        fill(name, "")
        fill(d.get_by_role("textbox", name="Start"), "2027-13-01")
        click(d.get_by_role("button", name="Save task"))
        seen(page, alert_with(d, "Name must be 1 to 120 characters."), "the Name error comes first")
        attr(page, name, "aria-invalid", "true")
        press(page, "Escape")
        gone(page, d, "Escape closes")
    r = s.api("asha").items(s.sp)[S["review"]]
    assert (r["name"], r["kind"], r["duration"], r["chosenStart"], r["version"]) == ("Review brief", "task", 2, mar(4), 1)


def test_wf_workload_add_person_refreshes(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    asha = s.api("asha")
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}?task={S['draft']}") as page:
        d = page.get_by_role("dialog", name="Task details")
        seen(page, d, "Task details for Draft brief")
        region = d.get_by_role("region", name="Assignees")
        add = region.get_by_role("combobox", name="Add person")
        click(region.get_by_role("button", name="Remove Asha Rao"))
        shows(page, schedule(page), "Asha Rao removed from Draft brief.")
        add.focus()
        fill(add, "")
        page.keyboard.type("Asha")
        press(page, "ArrowDown")
        wait_for(page, lambda: expect(region.get_by_role("option", name="Asha Rao")).to_have_count(1, timeout=POLL_MS),
                 "Add person offers Asha Rao again after her removal")
        fill(add, "")
        select(add, "Cara Lund")
        click(region.get_by_role("button", name="Assign"))
        shows(page, schedule(page), "Cara Lund assigned to Draft brief, 8 hours a day.")
        shows(page, region.get_by_role("list", name="Assignees"), "Cara Lund, 8 hours a day")
        add.focus()
        fill(add, "")
        page.keyboard.type("Cara")
        press(page, "ArrowDown")
        wait_for(page, lambda: expect(region.get_by_role("option", name="Cara Lund")).to_have_count(0, timeout=POLL_MS),
                 "Add person no longer offers Cara Lund once assigned")
    assert [a["name"] for a in asha.items(s.sp)[S["draft"]]["assignees"]] == ["Cara Lund"]


def test_wf_baseline_variance_keeps_shifted(browser: Browser, app_url: str) -> None:
    s = Seed(app_url, projects=("spring",))
    S = s.s
    with s.page(browser, "asha", f"/projects/{s.sp}") as page:
        ready(page, "Spring launch")
        tab_into(page, page.get_by_role("region", name="Chart"))
        focused(page, bar(page, S["draft"]), "the chart tab stop starts on Draft brief")
        press(page, "ArrowRight")
        shows(page, schedule(page), "2 dependent tasks moved.")
        for key in ("review", "write"):
            attr(page, bar(page, S[key]), "data-shifted", "true", f"{key} moved by the edit")
        expect(bar(page, S["design"])).not_to_have_attribute("data-shifted", "true")
        click(page.get_by_role("button", name="Save baseline"))
        dlg = page.get_by_role("dialog", name="Save baseline")
        fill(dlg.get_by_role("textbox", name="Baseline name"), "Plan A")
        click(dlg.get_by_role("button", name="Save baseline"))
        shows(page, schedule(page), "Baseline Plan A saved.")
        click(dlg.get_by_role("button", name="Back to plan"))
        gone(page, dlg, "Back to plan closes")
        for key in ("review", "write"):
            attr(page, bar(page, S[key]), "data-shifted", "true", f"{key} keeps data-shifted after the baseline save")
        expect(bar(page, S["design"])).not_to_have_attribute("data-shifted", "true")


def test_wf_cross_cutting_knock_on_depth_cap(browser: Browser, app_url: str) -> None:
    names = [f"Step {n}" for n in range(1, 15)]
    chain = {"name": "Long chain", "holidays": [], "items": [
        it(f"t{n}", names[n - 1], "task", None, mar(1), 1, 0) for n in range(1, 15)],
        "links": [lk(f"t{n}", f"t{n + 1}", "FS", 0) for n in range(1, 14)], "baseline": None}
    s = Seed(app_url, projects=(), extra=[chain])
    cfg = config(app_url)
    stagger, slide = cfg["knockOnStaggerMs"], cfg["knockOnMs"]
    pid, ids = s.pid["Long chain"], s.ids["Long chain"]
    asha = s.api("asha")
    with s.page(browser, "ben", f"/projects/{pid}") as page:
        ready(page, "Long chain")
        wait_present(page, asha, pid, "Ben Ode")
        last_start = asha.items(pid)[ids["t14"]]["start"]
        edit(asha, pid, ids["t1"], start=mar(2))
        expect(bar(page, ids["t14"])).not_to_have_attribute("data-start", last_start, timeout=LIVE_S * 1000)
        elapsed = 0.0

        def at(ms: float) -> tuple[str | None, float]:
            nonlocal elapsed
            advance(page, ms - elapsed)
            elapsed = ms
            return motion_state(page, bar(page, ids["t14"]))

        held_state = at(stagger * 11.5)
        assert held_state[0] == "knock-on" and held_state[1] < 0, f"depth 12 holds its old place: {held_state}"
        sliding = at(stagger * 12 + slide / 2)
        assert sliding[0] == "knock-on" and held_state[1] < sliding[1] < 0, f"the 14th bar slides at depth 12: {sliding}"
        done = at(stagger * 12 + slide + stagger / 2)
        assert done == (None, 0), f"the 14th bar settled one slide after its capped depth 12 began: {done}"


def test_if_run_manifest() -> None:
    data = json.loads((APP_ROOT / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    assert all(isinstance(data.get(k), str) and data[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "STIX Two Text" in notices


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_only_published_backing_services() -> None:
    found = sorted({p.name for p in shipped_packages()} & FORBIDDEN_BACKENDS)
    assert not found, f"excluded backing-service packages shipped: {found}"


def test_if_service_config_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            target = node.get("file_path") or node.get("path")
            if isinstance(target, str) and ({"content", "new_string", "edits"} & set(node)):
                base = Path(target).name
                if re.fullmatch(r"(docker-)?compose(\..+)?\.ya?ml|\.env(\..+)?", base) and not re.search(r"\.(example|sample|template)$", base):
                    hits.append(target)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(path.read_text()))
    assert not hits, f"service configuration edited: {hits}"


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


def test_if_typescript_source() -> None:
    assert (APP_ROOT / "package-lock.json").is_file()
    ts = sum(1 for f in APP_ROOT.rglob("*") if f.suffix in (".ts", ".tsx") and "node_modules" not in f.parts)
    js = _plain_js(APP_ROOT)
    assert ts > 0, "no TypeScript source found"
    assert not js, f"JavaScript application source: {js[:10]}"
