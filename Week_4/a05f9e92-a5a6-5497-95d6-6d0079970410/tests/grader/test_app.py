from __future__ import annotations

import contextlib
import json
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    S3,
    advance,
    center,
    fill,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    unique,
)

GRADING_KEY_DEFAULT = "switchyard-grading-local"
SESSION_COOKIE = "switchyard_session"
PASSWORD_SUFFIX = "-yard-2026"
BERLIN = ZoneInfo("Europe/Berlin")
LISBON = ZoneInfo("Europe/Lisbon")
LIVE_MS = 2000
POLICY_MS = 500
SUGGEST_MS = 300
SWIPE_DISTANCE = 96
UNDO_MS = 5000
LONG_PRESS_MS = 600
MAP_EXPAND_MS = 420
STEP_MOVE_MS = 180
COUNTER_MS = 420
MAP_X0 = 40
MAP_DX = 200
MAP_DY = 120
JSON_LIMIT = 1_000_000
MULTIPART_EXTRA = 65_536
ATTACHMENT_MAX = 5_000_000
ATTACHMENT_QUOTA = 20_000_000
LOGIN_LIMIT = 10
STORAGE_RETRY_SECONDS = 10
DEPTH_LIMIT = 5
WAIT_UNIT_SECONDS = 60
HOUR = 3600
RESOLUTION_TARGETS = {1: 4 * HOUR, 2: 9 * HOUR, 3: 18 * HOUR, 4: 36 * HOUR, 5: 72 * HOUR}
MATRIX = {(1, 1): 1, (1, 2): 2, (1, 3): 3, (2, 1): 2, (2, 2): 3, (2, 3): 4, (3, 1): 3, (3, 2): 4, (3, 3): 5}
SETTING_DEFAULTS = {
    "WRITE_RATE_LIMIT_PER_MINUTE": 600,
    "LIST_PAGE_SIZE": 20,
    "WORKFLOW_LOOP_LIMIT": 100,
}
CLASS_LABELS = ["Configuration item", "Business service", "Application", "Server", "Virtual server", "Cluster", "Network device", "Storage"]
STATUS_LABELS = {"healthy": "Healthy", "degraded": "Degraded", "down": "Down", "maintenance": "In maintenance"}
STORAGE_BANNER_DESK = "File storage is unreachable. Ticket work continues; uploads are queued and exports will retry when storage returns."
STORAGE_BANNER_PORTAL = "Attachments are paused while file storage is unreachable. Your request still goes through."
STORAGE_503 = {"error": {"code": "storage_unavailable", "message": "File storage is unreachable. Try again when it returns."}}
OPERATOR_ONLY = {"error": {"code": "operator_only", "message": "Only the operator can do this."}}
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}

HTTP_TIMEOUT = 120
UI_SLACK_MS = 4000
UI_MS = LIVE_MS + UI_SLACK_MS
LOAD_MS = 15000
API_WAIT_S = 30
STORAGE_WAIT_S = STORAGE_RETRY_SECONDS * 4 + 20
DRIFT_S = 90
TAB_LIMIT = 150
DEAD_ENDPOINT = "http://127.0.0.1:9"
FOREIGN_ORIGIN = "http://elsewhere.example"
WRONG_DEVICE_TIME = datetime(2031, 7, 4, 3, 0)
TAG_STEP = "Tag it"
BIG_NAME = "big.txt"
EXE_NAME = "tool.exe"
UNKNOWN_PATH = "/api/no-such-endpoint"
SHOE_COLUMN = "shoe"
BAD_FLAG = "maybe"
OONA_TEXT = "oona text"
TECH_TEXT = "tech text"
TECH_NEWER = "tech newer"
GHOST_USER = "design09"
GHOST_NAME = "Design staff 09"
OONA_NAME = "Oona Petrakis"


def label_of(field: str) -> str:
    return field.replace("_", " ").capitalize()


NOBODY = "nobody"


def inbox_link(n: int) -> str:
    return f"Inbox, {n} unread"


def group_match_label(g: int) -> str:
    return f"Group {g} match"


def cart_link(n: int) -> str:
    return f"Cart, {n} items"


def cart_lines(c: httpx.Client, n: int) -> None:
    poll(lambda: len(c.get("/api/cart").json()["lines"]) == n, API_WAIT_S, f"GET /api/cart lists {n} lines")


def move_label(label: str) -> str:
    return f"Move to {label}"


def add_condition_label(group: int) -> str:
    return f"Add condition to group {group}"


def weight_tally(a: int, r: int, w: int, need: int, of: int) -> str:
    return f"Approve weight {a}, reject weight {r}, waiting weight {w}. Needs {need} of {of}."


def base(url: str) -> str:
    return url.rstrip("/")


def origin_of(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def q(text: str) -> str:
    return quote(text, safe="")


def new_client(app_url: str) -> httpx.Client:
    b = base(app_url)
    return httpx.Client(base_url=b, timeout=HTTP_TIMEOUT, follow_redirects=False, headers={"Origin": origin_of(b)})


def gk() -> dict[str, str]:
    return {"X-Grading-Key": os.environ.get("GRADING_KEY", GRADING_KEY_DEFAULT)}


def as_user(app_url: str, username: str) -> httpx.Client:
    c = new_client(app_url)
    r = c.post("/api/grading/session", json={"username": username}, headers=gk())
    assert r.status_code == 200, f"POST /api/grading/session for {username} answered {r.status_code}: {r.text[:300]}"
    return c


def grade(app_url: str, method: str, path: str, body: Any = None) -> httpx.Response:
    with new_client(app_url) as c:
        return c.request(method, path, json=body, headers=gk())


def fixtures(app_url: str, body: dict) -> dict:
    r = grade(app_url, "POST", "/api/grading/fixtures", body)
    assert r.status_code == 201, f"POST /api/grading/fixtures answered {r.status_code}: {r.text[:800]}"
    return r.json()["created"]


def parse_instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def set_clock(app_url: str, instant: str) -> datetime:
    r = grade(app_url, "POST", "/api/grading/clock", {"set": instant})
    assert r.status_code == 200, f"POST /api/grading/clock set answered {r.status_code}: {r.text[:300]}"
    return parse_instant(r.json()["server_time"])


def advance_clock(app_url: str, seconds: int) -> datetime:
    r = grade(app_url, "POST", "/api/grading/clock", {"advance_seconds": seconds})
    assert r.status_code == 200, f"POST /api/grading/clock advance answered {r.status_code}: {r.text[:300]}"
    return parse_instant(r.json()["server_time"])


@contextmanager
def settings(app_url: str, **values: Any) -> Iterator[None]:
    r = grade(app_url, "PUT", "/api/grading/settings", values)
    assert r.status_code == 200, f"PUT /api/grading/settings answered {r.status_code}: {r.text[:300]}"
    try:
        yield
    finally:
        grade(app_url, "PUT", "/api/grading/settings", {k: SETTING_DEFAULTS[k] for k in values})


@contextmanager
def storage_redirect(app_url: str, endpoint: str | None) -> Iterator[None]:
    r = grade(app_url, "POST", "/api/grading/storage", {"endpoint": endpoint})
    assert r.status_code == 200, f"POST /api/grading/storage answered {r.status_code}: {r.text[:300]}"
    try:
        yield
    finally:
        grade(app_url, "POST", "/api/grading/storage", {"endpoint": None})


def tag(prefix: str = "t") -> str:
    raw = re.sub(r"[^a-z0-9]", "", unique(prefix)[0].lower())
    return f"{raw}{uuid.uuid4().hex[:6]}"


def eq_filter(t: str) -> str:
    return f'short_description = "{t}"'


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
    pytest.fail(f"{what} (last observed: {last!r})"[:2000])


def assert_error(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:600]}; expected {status} {code}"
    body = r.json()
    assert set(body) == {"error"}, f"error body has only the error member: {body}"
    assert body["error"]["code"] == code, body
    if message is not None:
        assert body["error"]["message"] == message, body
    return body["error"]


def make_user(app_url: str, roles: list[str], department: str = "IT provider", **extra: Any) -> dict:
    u = tag("u")
    body = {"username": u, "password": f"{u}{PASSWORD_SUFFIX}", "display_name": f"Person {u}", "roles": roles,
            "department": department, "time_zone": "Europe/Berlin", "out_of_office": False, "capacity": None, "active": True}
    body.update(extra)
    fixtures(app_url, {"users": [body]})
    return body


def make_record(app_url: str, table: str, fields: dict, state: str | None = None, created_at: str | None = None,
                history: list[dict] | None = None, parent: str | None = None, problem: str | None = None) -> str:
    rec: dict[str, Any] = {"table": table, "fields": fields}
    if state:
        rec["state"] = state
    if created_at:
        rec["created_at"] = created_at
        rec["state_history"] = history or [{"state": state or "new", "at": created_at}]
    elif history:
        rec["state_history"] = history
    if parent:
        rec["parent"] = parent
    if problem:
        rec["problem"] = problem
    created = fixtures(app_url, {"records": [rec]})
    return created["records"][0]["number"]


def record(c: httpx.Client, number: str) -> dict:
    r = c.get(f"/api/records/{number}")
    assert r.status_code == 200, f"GET /api/records/{number} answered {r.status_code}: {r.text[:300]}"
    return r.json()["record"]


def value(rec: dict, field: str) -> Any:
    return rec["fields"][field]["value"]


def versioned(rec: dict, values: dict) -> dict:
    return {k: {"value": v, "version": rec["fields"].get(k, {}).get("version", 1)} for k, v in values.items()}


def patch(c: httpx.Client, number: str, **values: Any) -> httpx.Response:
    rec = record(c, number)
    return c.patch(f"/api/records/{number}", json={"fields": versioned(rec, values)})


def move(c: httpx.Client, number: str, to: str, **values: Any) -> httpx.Response:
    rec = record(c, number)
    return c.post(f"/api/records/{number}/transition", json={"to": to, "fields": versioned(rec, values)})


def move_ok(c: httpx.Client, number: str, to: str, **values: Any) -> dict:
    r = move(c, number, to, **values)
    assert r.status_code == 200, f"move {number} to {to} answered {r.status_code}: {r.text[:500]}"
    return r.json()["record"]


def create(c: httpx.Client, table: str, fields: dict) -> httpx.Response:
    return c.post(f"/api/tables/{table}/records", json={"fields": fields})


def create_ok(c: httpx.Client, table: str, fields: dict) -> str:
    r = create(c, table, fields)
    assert r.status_code == 201, f"create {table} answered {r.status_code}: {r.text[:500]}"
    return r.json()["record"]["number"]


def activity_texts(c: httpx.Client, number: str) -> list[str]:
    r = c.get(f"/api/records/{number}/activity")
    assert r.status_code == 200, r.text[:300]
    return [e["text"] for e in r.json()["entries"]]


def inbox_items(c: httpx.Client) -> list[dict]:
    r = c.get("/api/inbox")
    assert r.status_code == 200, r.text[:300]
    return r.json()["items"]


def inbox_count(c: httpx.Client, text: str) -> int:
    return sum(1 for i in inbox_items(c) if i["text"] == text)


def slas(c: httpx.Client, number: str) -> list[dict]:
    r = c.get(f"/api/records/{number}/sla")
    assert r.status_code == 200, r.text[:300]
    return r.json()["slas"]


def sla_named(c: httpx.Client, number: str, definition: str) -> dict:
    found = [s for s in slas(c, number) if s["definition"] == definition and s["stage"] != "cancelled"]
    assert found, f"{number} carries an SLA from definition {definition}"
    return found[-1]


def find_named(data: Any, name: str) -> dict | None:
    if isinstance(data, dict):
        if data.get("name") == name:
            return data
        for v in data.values():
            hit = find_named(v, name)
            if hit is not None:
                return hit
    elif isinstance(data, list):
        for v in data:
            hit = find_named(v, name)
            if hit is not None:
                return hit
    return None


def strings_in(data: Any) -> list[str]:
    if isinstance(data, str):
        return [data]
    if isinstance(data, dict):
        return [s for v in data.values() for s in strings_in(v)]
    if isinstance(data, list):
        return [s for v in data for s in strings_in(v)]
    return []


def fmt_hms(seconds: int) -> str:
    seconds = abs(int(seconds))
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def hms_values(text: str) -> list[int]:
    return [int(h) * 3600 + int(m) * 60 + int(s) for h, m, s in re.findall(r"(\d+):(\d{2}):(\d{2})", text)]


def ci(name: str, cls: str, crit: int, bc: bool = False, owner: str = "IT provider", **attrs: Any) -> dict:
    d = {"name": name, "class": cls, "criticality": crit, "business_critical": bc, "owner_department": owner}
    d.update(attrs)
    return d


def rel(source: str, kind: str, target: str) -> dict:
    return {"source": source, "type": kind, "target": target}


def department_size(c: httpx.Client, name: str) -> int:
    r = c.get("/api/departments")
    assert r.status_code == 200, r.text[:300]
    hit = [d for d in r.json()["departments"] if d["name"] == name]
    assert hit, f"department {name} exists"
    return int(hit[0]["members"])


def people_band(n: int) -> int:
    return 0 if n == 0 else 1 if n <= 10 else 2 if n <= 50 else 3


def steps_of(c: httpx.Client, number: str) -> list[dict]:
    r = c.get(f"/api/records/{number}/approvals")
    assert r.status_code == 200, r.text[:300]
    return r.json()["steps"]


def vote(c: httpx.Client, number: str, step: int, decision: str, on_behalf_of: str | None = None) -> httpx.Response:
    return c.post(f"/api/records/{number}/steps/{step}/votes", json={"decision": decision, "comment": "", "on_behalf_of": on_behalf_of})


def new_change(c: httpx.Client, ci_name: str, start: str, end: str, title: str, model: str = "normal",
               backout_tested: bool = False, **extra: Any) -> str:
    fields = {"title": title, "model": model, "configuration_item": ci_name, "planned_start": start, "planned_end": end,
              "implementation_plan": "Apply the update", "backout_plan": "Restore the snapshot", "backout_tested": backout_tested}
    fields.update(extra)
    return create_ok(c, "change", fields)


def find_page(c: httpx.Client, page_id: Any) -> dict:
    r = c.get("/api/pages")
    assert r.status_code == 200, r.text[:300]
    hit = [p for p in r.json()["pages"] if p["id"] == page_id]
    assert hit, f"GET /api/pages lists page {page_id}"
    return hit[0]


@contextmanager
def app_page(browser: Browser, url: str, **kw: Any) -> Iterator[Page]:
    handle = open_app(browser, url, **kw)
    if hasattr(handle, "__enter__"):
        with handle as page:
            yield page
    else:
        page = next(handle)
        try:
            yield page
        finally:
            with contextlib.suppress(StopIteration):
                next(handle)


@contextmanager
def browse(browser: Browser, app_url: str, username: str | None, path: str, *, width: int = 1280, height: int = 800,
           reduced_motion: str = "no-preference", resume: bool = True, device_time: datetime | None = None) -> Iterator[Page]:
    b = base(app_url)
    with app_page(browser, b + "/login", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": width, "height": height})
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if resume:
            page.clock.resume()
        if username:
            c = as_user(app_url, username)
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": c.cookies.get(SESSION_COOKIE), "url": b}])
            c.close()
        page.goto(b + path)
        yield page


def announcer(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def contains_focus(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el.contains(document.activeElement)"))


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el === document.activeElement"))


def tab_into(page: Page, locator: Locator, what: str) -> None:
    for _ in range(TAB_LIMIT):
        if contains_focus(locator):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"Tab never reached {what}")


def shown(locator: Locator, page: Page) -> bool:
    if locator.count() == 0 or not locator.first.is_visible():
        return False
    box = locator.first.bounding_box()
    vw = page.viewport_size["width"]
    return bool(box) and box["x"] < vw and box["x"] + box["width"] > 0 and box["width"] > 0


def text_shown_somewhere(scope: Any, text: str, ms: int) -> None:
    loc = scope.get_by_text(text, exact=True)
    poll(lambda: any(loc.nth(i).is_visible() for i in range(loc.count())), ms / 1000, f"{text!r} visible")


ANIM_RECORDER = """() => {
  if (window.__swAnims) return;
  window.__swAnims = [];
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = original.call(this, keyframes, options);
    const d = typeof options === 'number' ? options : (options && options.duration);
    window.__swAnims.push({ el: this, d: Number(d) });
    return animation;
  };
}"""


def durations_on(locator: Locator) -> list[float]:
    return locator.evaluate("""(el) => {
      const recorded = (window.__swAnims || []).filter(a => a.el === el || el.contains(a.el)).map(a => a.d);
      const running = el.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration));
      return recorded.concat(running);
    }""")


_CDP: dict[int, Any] = {}


def cdp(page: Page) -> Any:
    key = id(page)
    if key not in _CDP:
        s = session(page)
        s.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        _CDP[key] = s
    return _CDP[key]


def touch_swipe(page: Page, locator: Locator, dx: float) -> None:
    s = cdp(page)
    x, y = center(locator)
    s.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, 9):
        s.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 8, "y": y}]})
    s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_hold(page: Page, locator: Locator, hold_ms: int) -> None:
    s = cdp(page)
    x, y = center(locator)
    s.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    page.clock.run_for(hold_ms)
    s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


INERT_CHECK = """(els) => els.every(el => {
  if (!el.isConnected) return true;
  const visible = el.checkVisibility ? el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) : !!el.offsetParent;
  if (!visible) return true;
  const r = el.getBoundingClientRect();
  const off = r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight;
  return off && !!el.closest('[inert]');
})"""


def assert_inert_after_close(page: Page, handles: list[Any], what: str) -> None:
    assert handles, f"{what} held focusable controls while open"
    assert page.evaluate(INERT_CHECK, handles), f"closed {what} left controls visible or reachable"
    for _ in range(40):
        page.keyboard.press("Tab")
        assert not page.evaluate("(els) => els.includes(document.activeElement)", handles), f"Tab reached a control of the closed {what}"


def focusables(dialog: Locator) -> list[Any]:
    return dialog.get_by_role("link").element_handles() + dialog.get_by_role("button").element_handles()


def pick(locator: Locator, wanted: str) -> None:
    pairs = locator.evaluate(
        "e => e.tagName === 'SELECT' ? [...e.options].filter(o => o.value !== '').map(o => [(o.label || o.text || '').trim(), o.value]) : null")
    if pairs is None:
        pairs = [[x, x] for x in _b_choice_labels(locator)]
    low = wanted.lower()
    hit = ([p for p in pairs if p[1].lower() == low] or [p for p in pairs if p[0].lower() == low]
           or [p for p in pairs if re.search(rf"\b{re.escape(low)}\b", p[0].lower())] or [p for p in pairs if low in p[0].lower()])
    assert hit, f"no option matching {wanted!r} among {pairs}"
    select(locator, hit[0][0])


def _ci_name(value: Any) -> Any:
    return value.get("name") if isinstance(value, dict) else value


def test_health_answers_published_bodies(app_url):
    with new_client(app_url) as c:
        r = c.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    down = os.environ.get("APP_MINIO_DOWN_URL")
    assert down, "APP_MINIO_DOWN_URL names the storage-down instance"
    with new_client(down) as c:
        poll(lambda: (lambda x: x.status_code == 200 and x.json() == {"status": "unavailable"})(c.get("/api/health")),
             STORAGE_WAIT_S, "storage-down instance answers 200 {\"status\":\"unavailable\"} on /api/health")


def test_sign_in_home_screens_and_role_screens(browser, app_url):
    homes = {"oona": "/desk", "teodor": "/desk", "ana": "/approve", "mae": "/portal", "ruth": "/portal"}
    with new_client(app_url) as anon:
        bad = anon.post("/api/session", json={"username": "kofi", "password": "not-the-password"})
        assert_error(bad, 401, "bad_credentials", "That username and password do not match.")
        ok = anon.post("/api/session", json={"username": "kofi", "password": f"kofi{PASSWORD_SUFFIX}"})
        assert ok.status_code == 200, ok.text
        user = ok.json()["user"]
        assert user["username"] == "kofi" and user["roles"] == ["requester"] and user["department"] == "Finance"
        assert SESSION_COOKIE in ok.headers.get("set-cookie", "")
        assert "HttpOnly".lower() in ok.headers.get("set-cookie", "").lower()
    with new_client(app_url) as anon:
        r = anon.get("/desk")
        assert r.status_code == 302 and r.headers["location"].rstrip("/").endswith("/login"), (r.status_code, r.headers)
        r = anon.get("/approve")
        assert r.status_code == 302 and r.headers["location"].rstrip("/").endswith("/login")
    for username, home in homes.items():
        with browse(browser, app_url, None, "/login") as page:
            page.get_by_role("textbox", name="Username").fill(username)
            page.get_by_label("Password").fill(f"{username}{PASSWORD_SUFFIX}")
            page.get_by_role("button", name="Sign in").click()
            page.wait_for_url(lambda u: urlparse(u).path.rstrip("/") == home, timeout=LOAD_MS)
            if username == "ruth":
                resp = page.goto(base(app_url) + "/desk")
                assert resp is not None and resp.status == 404
                expect(page.get_by_text("That page isn't on the switchyard.", exact=True)).to_be_visible(timeout=LOAD_MS)
                expect(page.get_by_role("button", name="Back to your desk")).to_be_visible()
                page.goto(base(app_url) + "/login")
                page.wait_for_url(lambda u: urlparse(u).path.rstrip("/") == "/portal", timeout=LOAD_MS)
            if username == "mae":
                resp = page.goto(base(app_url) + "/desk/admin/users")
                assert resp is not None and resp.status == 404
                resp = page.goto(base(app_url) + "/desk/map")
                assert resp is not None and resp.status == 200
    ruth = as_user(app_url, "ruth")
    assert_error(ruth.get("/api/users"), 403, "forbidden", "Your role cannot do this.")
    teodor = as_user(app_url, "teodor")
    assert teodor.get("/api/users").status_code == 200


def test_error_body_and_check_order(app_url):
    requester = make_user(app_url, ["requester"], "Design Studio")
    t = tag("ord")
    hidden = make_record(app_url, "incident", {"short_description": f"{t} hidden", "caller": "kofi", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    mine = make_record(app_url, "incident", {"short_description": f"{t} mine", "caller": requester["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with new_client(app_url) as anon:
        e = assert_error(anon.get(f"/api/records/{hidden}"), 401, "unauthenticated", "Sign in to continue.")
        assert "fields" not in e
        assert_error(anon.patch(f"/api/records/{hidden}", json={"fields": {"short_description": {"value": "", "version": 0}}}), 401, "unauthenticated")
        unknown = anon.get(UNKNOWN_PATH)
        if unknown.status_code == 401:
            assert_error(unknown, 401, "unauthenticated")
        else:
            assert_error(unknown, 404, "not_found")
    req = as_user(app_url, requester["username"])
    e = assert_error(req.patch(f"/api/records/{hidden}", json={"fields": {"assigned_to": {"value": "oona", "version": 0}}}), 404, "not_found", "No such record.")
    assert "fields" not in e
    assert_error(req.patch(f"/api/records/{mine}", json={"fields": {"assigned_to": {"value": "oona", "version": 0}}}), 403, "field_denied", "You cannot change Assigned to.")
    oona = as_user(app_url, "oona")
    assert patch(oona, mine, short_description=f"{t} renamed").status_code == 200
    stale = oona.patch(f"/api/records/{mine}", json={"fields": {"short_description": {"value": "", "version": 1}}})
    assert_error(stale, 409, "field_conflict")
    err = assert_error(patch(oona, mine, short_description=""), 422, "validation")
    assert "short_description" in err["fields"]
    assert value(record(oona, mine), "short_description") == f"{t} renamed"


def test_grading_route_guarded_and_effective(app_url):
    with new_client(app_url) as c:
        assert_error(c.post("/api/grading/session", json={"username": "oona"}), 404, "not_found")
        assert SESSION_COOKIE not in c.cookies
        assert_error(c.post("/api/grading/clock", json={"advance_seconds": 0}, headers={"X-Grading-Key": "wrong-key"}), 404, "not_found")
    t = tag("fx")
    bad = grade(app_url, "POST", "/api/grading/fixtures", {
        "users": [{"username": t, "password": f"{t}{PASSWORD_SUFFIX}", "display_name": f"Person {t}", "roles": ["requester"], "department": "Finance", "time_zone": "Europe/Berlin"}],
        "relationships": [rel(f"{t} missing", "depends on", f"{t} nowhere")]})
    assert_error(bad, 422, "validation")
    oona = as_user(app_url, "oona")
    assert all(u["username"] != t for u in oona.get("/api/users").json()["users"]), "a refused fixture created nothing"
    at = set_clock(app_url, "2027-08-02T10:00:00+02:00")
    assert abs((at - parse_instant("2027-08-02T10:00:00+02:00")).total_seconds()) < DRIFT_S
    later = advance_clock(app_url, HOUR)
    assert HOUR <= (later - at).total_seconds() < HOUR + DRIFT_S
    n = make_record(app_url, "incident", {"short_description": f"{t} save", "description": "first", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    r = grade(app_url, "POST", f"/api/grading/records/{n}/save", {"as": "teodor", "fields": {"description": {"value": "by teodor", "version": 1}}})
    assert r.status_code == 200, r.text
    assert value(r.json()["record"], "description") == "by teodor"
    r = grade(app_url, "POST", f"/api/grading/records/{n}/save", {"as": "oona", "fields": {"description": {"value": "stale", "version": 1}}})
    assert_error(r, 409, "field_conflict")
    audit = oona.get(f"/api/records/{n}/audit").json()["entries"]
    assert any(e["field"] == "description" and e["after"] == "by teodor" and e["actor"] in ("teodor", "Teodor Lindqvist") for e in audit), audit
    with settings(app_url, LIST_PAGE_SIZE=2):
        page = oona.get("/api/tables/incident/records").json()
        assert page["page_size"] == 2 and len(page["records"]) <= 2
    assert oona.get("/api/tables/incident/records").json()["page_size"] == SETTING_DEFAULTS["LIST_PAGE_SIZE"]
    with storage_redirect(app_url, DEAD_ENDPOINT):
        poll(lambda: oona.get("/api/storage").json()["storage"] == "unavailable", STORAGE_WAIT_S, "storage reported unavailable after redirect")
    poll(lambda: oona.get("/api/storage").json()["storage"] == "available", STORAGE_WAIT_S, "storage available after redirect cleared")


EXPR_CASES = {
    "unexpected-token": ("priority = 1 2", 'Expression error at column 14: unexpected "2".', "priority = 1"),
    "unknown-field": ("nosuch = 1", 'Expression error at column 1: unknown field "nosuch".', "urgency = 1"),
    "unknown-function": ("frob(1)", 'Expression error at column 1: unknown function "frob".', "is_empty(description)"),
    "expected-value": ("priority = = 1", "Expression error at column 12: expected a value.", "priority = 2"),
    "expected-paren": ("(priority = 1", 'Expression error at column 14: expected ")".', "(priority = 1)"),
    "unterminated-string": ('short_description = "abc', 'Expression error at column 21: unexpected "\\"".', 'short_description = "abc"'),
}


@pytest.mark.parametrize("case", list(EXPR_CASES), ids=list(EXPR_CASES))
def test_expression_errors_report_column(app_url, case):
    bad, message, good = EXPR_CASES[case]
    t = tag("ex")
    oona = as_user(app_url, "oona")
    rule = {"name": f"Rule {t}", "table": "incident", "when": "before", "order": 100, "operations": ["insert"], "condition": bad,
            "actions": [{"work_note": "checked"}], "active": False}
    assert_error(oona.post("/api/business-rules", json=rule), 422, "expression_error", message)
    assign = {"name": f"Assign {t}", "order": 100, "table": "incident", "condition": bad, "group": "Triage", "active": False}
    assert_error(oona.post("/api/assignment-rules", json=assign), 422, "expression_error", message)
    assert find_named(oona.get("/api/business-rules").json(), f"Rule {t}") is None
    rule["condition"] = good
    r = oona.post("/api/business-rules", json=rule)
    assert r.status_code == 201, r.text


VIEWPORTS = {
    "375x812": (375, 812, "phone"),
    "767x1024": (767, 1024, "phone"),
    "768x1024": (768, 1024, "tablet"),
    "1023x800": (1023, 800, "tablet"),
    "1024x800": (1024, 800, "desktop"),
    "1280x800": (1280, 800, "desktop"),
}


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_workspace_and_portal_breakpoints(browser, app_url, viewport):
    width, height, kind = VIEWPORTS[viewport]
    t = tag("bp")
    n = make_record(app_url, "incident", {"short_description": t, "caller": "ruth", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with browse(browser, app_url, "oona", f"/desk/records/{n}", width=width, height=height) as page:
        form = page.get_by_role("form", name=n)
        expect(form).to_be_visible(timeout=LOAD_MS)
        nav = page.get_by_role("navigation", name="Queues")
        grid = page.get_by_role("grid")
        if kind == "desktop":
            assert shown(nav, page) and shown(grid, page)
            nb, gb, fb = nav.first.bounding_box(), grid.first.bounding_box(), form.bounding_box()
            assert nb["x"] < gb["x"] < fb["x"], (nb, gb, fb)
        elif kind == "tablet":
            assert not shown(nav, page), "tablet moves the queues into the drawer"
            assert shown(grid, page)
            assert grid.first.bounding_box()["x"] < form.bounding_box()["x"]
        else:
            assert not shown(nav, page) and not shown(grid, page), "phone shows one pane"
        layout(page)
    with browse(browser, app_url, "ruth", "/portal", width=width, height=height) as page:
        regions = [page.get_by_role("region", name=x) for x in ("Search knowledge", "Catalog", "My requests")]
        for r in regions:
            expect(r).to_be_visible(timeout=LOAD_MS)
        s, cat, mine = (r.bounding_box() for r in regions)
        if kind == "desktop":
            assert s["x"] < cat["x"] < mine["x"], (s, cat, mine)
            assert abs(s["y"] - cat["y"]) < cat["height"] and abs(cat["y"] - mine["y"]) < cat["height"]
        elif kind == "tablet":
            assert s["y"] + s["height"] <= cat["y"] + 1 and s["y"] + s["height"] <= mine["y"] + 1
            assert cat["x"] < mine["x"] and abs(cat["y"] - mine["y"]) < cat["height"]
            assert s["width"] > cat["width"]
        else:
            assert s["y"] < cat["y"] < mine["y"]
            assert abs(s["x"] - cat["x"]) < 2 and abs(cat["x"] - mine["x"]) < 2
        layout(page)


EMPTY_STATE_IDS = ["queue", "filter", "knowledge", "inbox", "votes", "not-found"]


@pytest.mark.parametrize("state", EMPTY_STATE_IDS, ids=EMPTY_STATE_IDS)
def test_empty_and_not_found_states(browser, app_url, state):
    t = tag("es")
    if state == "queue":
        oona = as_user(app_url, "oona")
        r = oona.post("/api/filters", json={"name": f"Queue {t}", "table": "incident", "filter": eq_filter(t), "shared": True})
        assert r.status_code == 201, r.text
        with browse(browser, app_url, "oona", "/desk") as page:
            page.get_by_role("navigation", name="Queues").get_by_role("link", name=f"Queue {t}").click(timeout=LOAD_MS)
            expect(page.get_by_text(f"Nothing waiting in Queue {t}.", exact=True)).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_role("button", name="Show all open incidents")).to_be_visible()
    elif state == "filter":
        flt = q(eq_filter(t))
        with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={flt}") as page:
            expect(page.get_by_text("No records match this filter.", exact=True)).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_role("button", name="Clear filter")).to_be_visible()
    elif state == "knowledge":
        query = f"zq{t}"
        with browse(browser, app_url, "ruth", "/portal") as page:
            box = page.get_by_role("searchbox", name="Search knowledge")
            box.fill(query)
            box.press("Enter")
            expect(page.get_by_text(f'No articles match "{query}".', exact=True)).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_role("button", name="Report a fault")).to_be_visible()
    elif state == "inbox":
        u = make_user(app_url, ["requester"], "Finance")
        with browse(browser, app_url, u["username"], "/inbox") as page:
            expect(page.get_by_text("Your inbox is empty.", exact=True)).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_role("button", name="Back to your desk")).to_be_visible()
    elif state == "votes":
        u = make_user(app_url, ["approver"], "Leadership")
        with browse(browser, app_url, u["username"], "/approve") as page:
            expect(page.get_by_text("No votes waiting for you.", exact=True)).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_role("button", name="Open changes")).to_be_visible()
    else:
        for who in (None, "ruth"):
            with browse(browser, app_url, who, "/") as page:
                resp = page.goto(base(app_url) + f"/nowhere-{t}")
                assert resp is not None and resp.status == 404
                expect(page.get_by_text("That page isn't on the switchyard.", exact=True)).to_be_visible(timeout=LOAD_MS)
                expect(page.get_by_role("button", name="Back to your desk")).to_be_visible()


def test_cross_origin_and_body_limits(app_url):
    oona = as_user(app_url, "oona")
    r = oona.post("/api/inbox/read-all", headers={"Origin": FOREIGN_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": {"code": "cross_origin", "message": "Requests must come from Switchyard itself."}}, r.text
    r = oona.get("/api/health", headers={"Origin": FOREIGN_ORIGIN})
    assert not any(h.lower().startswith("access-control-") for h in r.headers), dict(r.headers)
    probe_user = tag("big")
    head = b'{"username":"' + probe_user.encode() + b'","password":"x"'
    exact = head + b" " * (JSON_LIMIT - len(head) - 1) + b"}"
    assert len(exact) == JSON_LIMIT
    with new_client(app_url) as anon:
        r = anon.post("/api/session", content=exact, headers={"Content-Type": "application/json; charset=utf-8"})
        assert r.status_code != 413, "a JSON body of exactly the limit is allowed"
        over = head + b" " * (JSON_LIMIT - len(head)) + b"}"
        r = anon.post("/api/session", content=over, headers={"Content-Type": "application/json; charset=utf-8"})
        assert r.status_code == 413 and r.json() == {"error": {"code": "too_large", "message": "Request bodies can be at most 1,000,000 bytes."}}, r.text[:300]
    t = tag("mp")
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    boundary = f"swb{uuid.uuid4().hex}"
    top = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\nContent-Type: text/plain\r\n\r\n'.encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    total = ATTACHMENT_MAX + MULTIPART_EXTRA + 1
    body = top + b"a" * (total - len(top) - len(tail)) + tail
    r = oona.post(f"/api/records/{n}/attachments", content=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 413 and r.json() == {"error": {"code": "too_large", "message": "Request bodies can be at most 5,065,536 bytes."}}, r.text[:300]


def test_never_serves_source_or_credentials(app_url):
    with new_client(app_url) as c:
        for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/pg/package.json",
                     "/src/server.ts", "/server.ts", "/dist/server.js", "/dist/server.js.map", "/tsconfig.json"):
            assert c.get(path).status_code == 404, f"{path} must not be served"
        html = c.get("/").text
        assets = [html]
        for src in re.findall(r'(?:src|href)="([^"]+\.(?:js|css|mjs))"', html):
            url = src if src.startswith("http") else "/" + src.lstrip("/")
            if url.startswith("http") and not same_origin(url, origin_of(base(app_url))):
                continue
            assets.append(c.get(url).text)
    secrets = [os.environ.get("S3_SECRET_ACCESS_KEY", ""), os.environ.get("S3_ACCESS_KEY_ID", ""),
               urlparse(os.environ.get("DATABASE_URL", "")).password or "", os.environ.get("DATABASE_URL", "")]
    for secret in (s for s in secrets if len(s) >= 6):
        assert all(secret not in a for a in assets), "a configured credential appears in a served asset"


def test_rate_limits_answer_429(app_url):
    u = make_user(app_url, ["requester"], "Finance")
    with new_client(app_url) as anon:
        for _ in range(LOGIN_LIMIT):
            assert anon.post("/api/session", json={"username": u["username"], "password": "wrong"}).status_code == 401
        r = anon.post("/api/session", json={"username": u["username"], "password": u["password"]})
        e = assert_error(r, 429, "rate_limited")
        assert re.fullmatch(r"Too many requests\. Try again in \d+ seconds\.", e["message"]), e
        assert int(r.headers["Retry-After"]) >= 1
    w = make_user(app_url, ["requester"], "Finance")
    c = as_user(app_url, w["username"])
    with settings(app_url, WRITE_RATE_LIMIT_PER_MINUTE=3):
        codes = [c.post("/api/inbox/read-all").status_code for _ in range(5)]
        assert 429 in codes, codes
        r = c.post("/api/inbox/read-all")
        e = assert_error(r, 429, "rate_limited")
        assert int(r.headers["Retry-After"]) >= 1
        assert c.get("/api/inbox").status_code == 200, "reads are not rate limited"


def test_numbering_has_no_gaps(app_url):
    oona = as_user(app_url, "oona")
    t = tag("num")
    for table, prefix, good, bad in (
        ("incident", "BRK-", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"}, {"short_description": "", "impact": 3, "urgency": 3}),
        ("problem", "ROOT-", {"short_description": t}, {"short_description": ""}),
        ("task", "JOB-", {"short_description": t}, None),
        ("change", "ALT-", {"title": t, "model": "normal"}, None),
    ):
        first = create_ok(oona, table, good)
        assert re.fullmatch(re.escape(prefix) + r"\d{6}", first), first
        if bad is not None:
            assert_error(create(oona, table, bad), 422, "validation")
        second = create_ok(oona, table, good)
        assert int(second[len(prefix):]) == int(first[len(prefix):]) + 1, (first, second)


def test_transition_tables_refuse_illegal_moves(app_url):
    t = tag("tr")
    oona, teodor = as_user(app_url, "oona"), as_user(app_url, "teodor")
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert_error(move(oona, n, "resolved"), 422, "illegal_transition", "Cannot move incident from New to Resolved.")
    move_ok(oona, n, "assigned", assigned_to="oona")
    rec = move_ok(oona, n, "in_progress")
    assert rec["state"] == "in_progress" and rec["state_label"] == "In progress"
    err = assert_error(move(oona, n, "resolved"), 422, "field_required", "Resolution code is required to move to Resolved.")
    assert list(err["fields"]) == ["resolution_code"]
    move_ok(oona, n, "on_hold", hold_reason="awaiting_supplier")
    move_ok(oona, n, "in_progress")
    rec = move_ok(oona, n, "resolved", resolution_code="fixed", resolution_note="Replaced cable")
    assert rec["state_label"] == "Resolved"
    assert all(x["to"] != "closed" for x in record(teodor, n)["transitions"])
    assert_error(move(teodor, n, "closed"), 422, "role_not_allowed", "Your role cannot move this incident to Closed.")
    assert record(oona, n)["state"] == "resolved"
    p = make_record(app_url, "problem", {"short_description": t})
    assert_error(move(oona, p, "known_error"), 422, "illegal_transition", "Cannot move problem from New to Known error.")
    ch = make_record(app_url, "change", {"title": t, "model": "normal"}, state="draft")
    assert_error(move(oona, ch, "done"), 422, "illegal_transition", "Cannot move change from Draft to Done.")
    job = make_record(app_url, "task", {"short_description": t}, state="open")
    assert_error(move(oona, job, "done"), 422, "illegal_transition", "Cannot move task from Open to Done.")
    itm = make_record(app_url, "request_item", {"item": "building-pass", "quantity": 1, "variables": {"office": "kanal", "start_date": "2027-01-11"}, "requested_for": "ruth"}, state="delivered")
    assert_error(move(oona, itm, "fulfilling"), 422, "illegal_transition", "Cannot move request item from Delivered to Fulfilling.")
    assert record(oona, itm)["state"] == "delivered"


def test_incident_reopen_deadline_counts_open_days(app_url):
    set_clock(app_url, "2026-12-23T12:00:00+01:00")
    t = tag("ro")
    hist = [{"state": "new", "at": "2026-12-23T09:00:00+01:00"}, {"state": "in_progress", "at": "2026-12-23T09:30:00+01:00"},
            {"state": "resolved", "at": "2026-12-23T10:00:00+01:00"}]
    fields = {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage", "assigned_to": "oona",
              "resolution_code": "fixed", "resolution_note": "done", "resolved_at": "2026-12-23T10:00:00+01:00"}
    a = make_record(app_url, "incident", dict(fields), state="resolved", created_at=hist[0]["at"], history=hist)
    b = make_record(app_url, "incident", dict(fields), state="resolved", created_at=hist[0]["at"], history=hist)
    deadline = datetime(2026, 12, 31, 10, 0, tzinfo=BERLIN)
    oona = as_user(app_url, "oona")
    set_clock(app_url, (deadline - timedelta(minutes=10)).isoformat())
    assert record(oona, b)["state"] == "resolved"
    assert move_ok(oona, a, "in_progress", reopen_reason="Came back")["state"] == "in_progress"
    set_clock(app_url, (deadline + timedelta(minutes=10)).isoformat())
    assert record(oona, b)["state"] == "closed", "a resolved incident closes after its reopen deadline"
    assert move(oona, b, "in_progress", reopen_reason="Too late").status_code == 422


def test_priority_matrix_bump_and_override(browser, app_url):
    t = tag("pri")
    fixtures(app_url, {"cis": [ci(f"{t} core", "Application", 3, bc=True)]})
    oona, teodor = as_user(app_url, "oona"), as_user(app_url, "teodor")
    for (impact, urgency), expected in MATRIX.items():
        plain = create_ok(oona, "incident", {"short_description": t, "impact": impact, "urgency": urgency, "assignment_group": "Triage"})
        assert value(record(oona, plain), "priority") == expected
        bumped = create_ok(oona, "incident", {"short_description": t, "impact": impact, "urgency": urgency, "assignment_group": "Triage", "configuration_item": f"{t} core"})
        assert value(record(oona, bumped), "priority") == max(1, expected - 1)
    n = create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert patch(oona, n, impact=2).status_code == 200
    assert value(record(oona, n), "priority") == MATRIX[(2, 3)]
    r = teodor.post(f"/api/records/{n}/priority-override", json={"priority": 2, "reason": "x"})
    assert r.status_code == 403 and r.json() == OPERATOR_ONLY
    assert_error(oona.post(f"/api/records/{n}/priority-override", json={"priority": 2, "reason": ""}), 422, "validation")
    r = oona.post(f"/api/records/{n}/priority-override", json={"priority": 2, "reason": f"Board asked {t}"})
    assert r.status_code == 200 and r.json()["record"]["priority_overridden"] is True
    assert patch(oona, n, urgency=1).status_code == 200
    assert value(record(oona, n), "priority") == 2, "an override freezes priority"
    audit = teodor.get(f"/api/records/{n}/audit").json()["entries"]
    assert any(e["field"] == "priority" and e["reason"] == f"Board asked {t}" for e in audit), audit
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as page:
        expect(page.get_by_role("form", name=n).get_by_text("Priority overridden", exact=True)).to_be_visible(timeout=LOAD_MS)
    r = oona.delete(f"/api/records/{n}/priority-override")
    assert r.status_code == 200
    rec = record(oona, n)
    assert rec["priority_overridden"] is False and value(rec, "priority") == MATRIX[(2, 1)]


def test_knowledge_search_and_suggestions_rank(app_url):
    set_clock(app_url, "2026-11-05T12:00:00+01:00")
    tok = tag("kb")
    oona = as_user(app_url, "oona")

    def publish(body: dict) -> str:
        r = oona.post("/api/knowledge/articles", json={"keywords": [], "valid_until": None, "audience": {"roles": [], "departments": []}, **body})
        assert r.status_code == 201, r.text
        number = re.search(r"ART-\d{6}", r.text).group()
        assert oona.post(f"/api/knowledge/articles/{number}/submit").status_code == 200
        assert oona.post(f"/api/knowledge/articles/{number}/approve").status_code == 200
        return number

    a = publish({"title": f"Fixing {tok} quickly", "body": "Steps."})
    b = publish({"title": "Second guide", "keywords": [tok], "body": f"Mentions {tok} once."})
    c = publish({"title": "Third guide", "body": f"Also {tok} here."})
    publish({"title": f"Old {tok} notes", "body": "Expired.", "valid_until": "2026-01-01"})
    publish({"title": f"Finance {tok} notes", "body": "Restricted.", "audience": {"roles": [], "departments": ["Finance"]}})
    draft = oona.post("/api/knowledge/articles", json={"title": f"Draft {tok}", "body": "x", "keywords": [], "valid_until": None, "audience": {"roles": [], "departments": []}})
    assert draft.status_code == 201
    voter = make_user(app_url, ["requester"], "Design Studio")
    vc = as_user(app_url, voter["username"])
    assert vc.put(f"/api/knowledge/articles/{c}/vote", json={"helpful": True}).status_code == 200
    got = vc.get("/api/knowledge/articles", params={"q": f"the {tok}"}).json()["articles"]
    assert [x["number"] for x in got] == [a, b, c], got
    assert [x["score"] for x in got] == [5, 3, 2], got
    kofi_hits = [x["title"] for x in as_user(app_url, "kofi").get("/api/knowledge/articles", params={"q": tok}).json()["articles"]]
    assert f"Finance {tok} notes" in kofi_hits
    sug = vc.get("/api/knowledge/suggest", params={"text": f"Printer {tok} broken"}).json()["articles"]
    assert [x["number"] for x in sug] == [a, b, c]


def _keyboard_incident(app_url: str, t: str, requester: dict, state: str = "assigned") -> str:
    fixtures(app_url, {"cis": [ci(f"{t} studio", "Application", 3, bc=True)]})
    return make_record(app_url, "incident", {"short_description": t, "caller": requester["username"], "configuration_item": f"{t} studio",
                                            "impact": 3, "urgency": 3, "assignment_group": "Triage", "assigned_to": "oona"}, state=state)


def test_wf_incident_keyboard_happy(browser, app_url):
    t = tag("kbd")
    requester = make_user(app_url, ["requester"], "Design Studio")
    n = _keyboard_incident(app_url, t, requester)
    flt = q(eq_filter(t))
    with browse(browser, app_url, requester["username"], f"/portal/incidents/{n}") as portal, \
            browse(browser, app_url, "oona", f"/desk/lists/incident?filter={flt}") as desk:
        expect(portal.get_by_role("heading", level=1)).to_contain_text(n, timeout=LOAD_MS)
        grid = desk.get_by_role("grid").first
        expect(grid).to_be_visible(timeout=LOAD_MS)
        tab_into(desk, grid, "the incident grid")
        row = grid.get_by_role("row", name=re.compile(re.escape(n)))
        for _ in range(6):
            if contains_focus(row):
                break
            desk.keyboard.press("ArrowDown")
        assert contains_focus(row), "arrow keys reach the incident row"
        desk.keyboard.press("Enter")
        form = desk.get_by_role("form", name=n)
        expect(form).to_be_visible(timeout=UI_MS)
        impact, urgency = form.get_by_label("Impact"), form.get_by_label("Urgency")
        tab_into(desk, impact, "the Impact field")
        pick(impact, "2")
        pick(urgency, "2")
        desk.keyboard.press("Control+s")
        expect(announcer(desk)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        oona = as_user(app_url, "oona")
        assert value(record(oona, n), "priority") == MATRIX[(2, 2)] - 1, "business-critical bump applies"
        go = form.get_by_role("button", name=move_label("In progress"))
        go.focus()
        desk.keyboard.press("Enter")
        expect(announcer(desk)).to_have_text(f"{n} moved to In progress.", timeout=UI_MS)
        expect(announcer(portal)).to_have_text(f"Your request {n} is now In progress.", timeout=UI_MS)
        resolve = form.get_by_role("button", name=move_label("Resolved"))
        resolve.focus()
        desk.keyboard.press("Enter")
        text_shown_somewhere(desk, "Resolution code is required to move to Resolved.", UI_MS)
        assert record(oona, n)["state"] == "in_progress"
        pick(form.get_by_label("Resolution code"), "fixed")
        form.get_by_label("Resolution note").fill("Reseated the card")
        resolve.focus()
        desk.keyboard.press("Enter")
        expect(announcer(desk)).to_have_text(f"{n} moved to Resolved.", timeout=UI_MS)
        assert n in (desk.evaluate("() => (document.activeElement && document.activeElement.textContent) || ''")), "focus moves to the record heading"
        expect(announcer(portal)).to_have_text(f"Your request {n} is now Resolved.", timeout=UI_MS)
        expect(portal.get_by_role("region", name="Incident status")).to_contain_text(f"{n}: Resolved", timeout=UI_MS)
    rec = record(as_user(app_url, "oona"), n)
    assert rec["state"] == "resolved" and value(rec, "resolution_code") == "fixed"


def test_wf_incident_keyboard_phone(browser, app_url):
    t = tag("ph")
    requester = make_user(app_url, ["requester"], "Design Studio")
    n = _keyboard_incident(app_url, t, requester)
    flt = eq_filter(t)
    oona = as_user(app_url, "oona")
    summary = oona.get("/api/tables/incident/records", params={"filter": flt}).json()["records"][0]
    assert re.fullmatch(rf"Incident {n}, priority \d, Assigned, assigned to Oona Petrakis, (SLA \d+ percent|no SLA)", summary["label"]), summary["label"]
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={q(flt)}", width=375, height=812) as page:
        card = page.get_by_role("listitem", name=summary["label"], exact=True)
        expect(card).to_be_visible(timeout=LOAD_MS)
        filt = page.get_by_role("button", name="Filter")
        assert filt.bounding_box()["y"] < card.bounding_box()["y"]
        assert not shown(page.get_by_role("grid"), page)
        layout(page)
        tab_into(page, card, "the incident card")
        page.keyboard.press("Enter")
        expect(page.get_by_role("form", name=n)).to_be_visible(timeout=UI_MS)
        assert n in (page.evaluate("() => (document.activeElement && document.activeElement.textContent) || ''")), "focus is on the record heading"
        layout(page)


def test_wf_incident_keyboard_invalid(browser, app_url):
    t = tag("inv")
    requester = make_user(app_url, ["requester"], "Design Studio")
    n = _keyboard_incident(app_url, t, requester)
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as page:
        form = page.get_by_role("form", name=n)
        field = form.get_by_label("Short description")
        expect(field).to_be_visible(timeout=LOAD_MS)
        field.fill("")
        page.keyboard.press("Control+s")
        expect(announcer(page)).to_have_text("1 problems to fix before saving.", timeout=UI_MS)
        problems = page.get_by_role("group", name="Problems to fix")
        expect(problems).to_be_visible()
        assert contains_focus(problems), "focus moves to Problems to fix"
        link = problems.get_by_role("link").first
        link.focus()
        page.keyboard.press("Enter")
        expect(field).to_be_focused(timeout=UI_MS)
    assert value(record(as_user(app_url, "oona"), n), "short_description") == t


def _clock_definition(app_url: str, t: str, target: int, table: str = "incident", pause: str = 'state = "on_hold"',
                      stop: str = 'state in ["resolved", "closed", "cancelled"]') -> str:
    name = f"Clock {t}"
    fixtures(app_url, {"sla_definitions": [{"name": name, "table": table, "start": f'short_description = "{t}"', "pause": pause, "stop": stop,
                                            "schedule": "Around the clock", "targets": {str(p): target for p in range(1, 6)}}]})
    return name


BUSINESS_TIME_CASES = {
    "office-spring": ("Incident resolution", "2026-03-27T16:00:00+01:00", "2026-03-30T08:30:00+02:00", 5400, "2026-03-30T17:00:00+02:00"),
    "office-autumn": ("Incident resolution", "2026-10-23T16:00:00+02:00", "2026-10-26T08:30:00+01:00", 5400, "2026-10-26T17:00:00+01:00"),
    "office-holiday": ("Incident resolution", "2026-04-02T16:00:00+02:00", "2026-04-07T08:30:00+02:00", 5400, "2026-04-07T17:00:00+02:00"),
    "clock-spring": (None, "2026-03-28T12:00:00+01:00", "2026-03-29T12:00:00+02:00", 23 * HOUR, None),
    "clock-autumn": (None, "2026-10-24T12:00:00+02:00", "2026-10-25T12:00:00+01:00", 25 * HOUR, None),
}


BUSINESS_TIME_IDS = ["office-spring", "office-autumn", "office-holiday", "clock-spring", "clock-autumn"]


@pytest.mark.parametrize("case", BUSINESS_TIME_IDS, ids=BUSINESS_TIME_IDS)
def test_business_time_across_daylight_saving(app_url, case):
    definition, created, now, expected, next_change = BUSINESS_TIME_CASES[case]
    t = tag("bt")
    if definition is None:
        definition = _clock_definition(app_url, t, 400000)
    set_clock(app_url, now)
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"}, state="new", created_at=created)
    s = sla_named(as_user(app_url, "oona"), n, definition)
    assert expected <= s["elapsed_seconds"] <= expected + DRIFT_S, (case, s)
    assert s["remaining_seconds"] == s["target_seconds"] - s["elapsed_seconds"]
    assert s["percent"] == s["elapsed_seconds"] * 100 // s["target_seconds"]
    assert s["ticking"] is True
    if next_change is None:
        assert s["next_change_at"] is None
    else:
        assert parse_instant(s["next_change_at"]) == parse_instant(next_change)


def test_sla_pause_priority_swap_and_reopen(app_url):
    set_clock(app_url, "2026-11-09T18:00:00+01:00")
    t = tag("sp")
    day = "2026-11-09T{}:00+01:00"
    hist = [{"state": "new", "at": day.format("08:00")}, {"state": "in_progress", "at": day.format("09:00")},
            {"state": "on_hold", "at": day.format("11:00")}, {"state": "in_progress", "at": day.format("13:00")},
            {"state": "resolved", "at": day.format("15:00")}]
    n = make_record(app_url, "incident", {"short_description": t, "impact": 2, "urgency": 2, "assignment_group": "Triage", "assigned_to": "oona",
                                          "hold_reason": "awaiting_supplier", "resolution_code": "fixed", "resolution_note": "ok",
                                          "resolved_at": day.format("15:00")}, state="resolved", created_at=hist[0]["at"], history=hist)
    oona = as_user(app_url, "oona")
    s = sla_named(oona, n, "Incident resolution")
    assert s["stage"] == "completed" and s["elapsed_seconds"] == 5 * HOUR and s["paused_seconds"] == 2 * HOUR, s
    set_clock(app_url, "2026-11-10T10:00:00+01:00")
    move_ok(oona, n, "in_progress", reopen_reason="Back again")
    s = sla_named(oona, n, "Incident resolution")
    assert s["stage"] == "in_progress" and 5 * HOUR <= s["elapsed_seconds"] <= 5 * HOUR + DRIFT_S, s
    old_start = s["start_at"]
    assert patch(oona, n, impact=1).status_code == 200
    all_res = [x for x in slas(oona, n) if x["definition"] == "Incident resolution"]
    assert any(x["stage"] == "cancelled" and x["priority"] == 3 for x in all_res), all_res
    new = [x for x in all_res if x["stage"] == "in_progress"]
    assert len(new) == 1 and new[0]["priority"] == 2 and new[0]["target_seconds"] == RESOLUTION_TARGETS[2], all_res
    assert parse_instant(new[0]["start_at"]) == parse_instant(old_start)
    assert 5 * HOUR <= new[0]["elapsed_seconds"] <= 5 * HOUR + DRIFT_S
    move_ok(oona, n, "on_hold", hold_reason="awaiting_supplier")
    held = sla_named(oona, n, "Incident resolution")
    assert held["stage"] == "paused"
    advance_clock(app_url, HOUR)
    after = sla_named(oona, n, "Incident resolution")
    assert after["stage"] == "paused" and abs(after["elapsed_seconds"] - held["elapsed_seconds"]) <= 5, (held, after)
    assert after["paused_seconds"] >= held["paused_seconds"] + HOUR - 5
    move_ok(oona, n, "in_progress")
    assert sla_named(oona, n, "Incident resolution")["stage"] == "in_progress"


def test_sla_thresholds_fire_once_on_server_clock(app_url):
    set_clock(app_url, "2027-02-01T10:00:00+01:00")
    t = tag("th")
    name = _clock_definition(app_url, t, HOUR)
    tech = make_user(app_url, ["technician"])
    caller = make_user(app_url, ["requester"], "Leadership")
    manager = make_user(app_url, ["manager"], "Leadership")
    n = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "assigned_to": tech["username"], "impact": 3, "urgency": 3,
                                          "assignment_group": "Triage"}, state="assigned", created_at="2027-02-01T10:00:00+01:00")
    ta, tm, oona = as_user(app_url, tech["username"]), as_user(app_url, manager["username"]), as_user(app_url, "oona")
    t50, t75, tb = f"{n} has used 50 percent of {name}.", f"{n} has used 75 percent of {name}.", f"{n} breached {name}."
    advance_clock(app_url, 1700)
    assert inbox_count(ta, t50) == 0
    advance_clock(app_url, 200)
    assert inbox_count(ta, t50) == 1 and inbox_count(tm, t50) == 0
    advance_clock(app_url, 900)
    assert inbox_count(ta, t75) == 1 and inbox_count(tm, t75) == 1
    assert sla_named(oona, n, name)["breached"] is False
    advance_clock(app_url, 1000)
    assert inbox_count(ta, tb) == 1 and inbox_count(tm, tb) == 1 and inbox_count(oona, tb) == 1
    assert sla_named(oona, n, name)["breached"] is True and value(record(oona, n), "sla_breached") is True
    advance_clock(app_url, HOUR)
    assert (inbox_count(ta, t50), inbox_count(ta, t75), inbox_count(ta, tb), inbox_count(oona, tb)) == (1, 1, 1, 1)
    now = advance_clock(app_url, 1)
    n2 = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "assigned_to": tech["username"], "impact": 3, "urgency": 3,
                                           "assignment_group": "Triage"}, state="assigned", created_at=now.isoformat())
    advance_clock(app_url, 4000)
    for text in (f"{n2} has used 50 percent of {name}.", f"{n2} has used 75 percent of {name}.", f"{n2} breached {name}."):
        assert inbox_count(ta, text) == 1, text


def test_countdown_follows_server_not_device_clock(browser, app_url):
    t0 = "2027-02-08T12:00:00+01:00"
    set_clock(app_url, t0)
    t = tag("cd")
    name = _clock_definition(app_url, t, HOUR, table="problem", pause='state = "assessing"')
    start = parse_instant(t0)
    running = make_record(app_url, "problem", {"short_description": t}, state="new", created_at=(start - timedelta(seconds=600)).isoformat())
    paused = make_record(app_url, "problem", {"short_description": t}, state="assessing", created_at=(start - timedelta(seconds=1100)).isoformat(),
                         history=[{"state": "new", "at": (start - timedelta(seconds=1100)).isoformat()}, {"state": "assessing", "at": (start - timedelta(seconds=600)).isoformat()}])
    oona = as_user(app_url, "oona")
    with browse(browser, app_url, "oona", f"/desk/records/{running}", device_time=WRONG_DEVICE_TIME) as page:
        region = page.get_by_role("region", name="SLA")
        expect(region.get_by_role("progressbar", name=name)).to_be_visible(timeout=LOAD_MS)
        expect(region).to_contain_text(" left", timeout=UI_MS)
        shown_left = hms_values(region.inner_text())
        api_left = sla_named(oona, running, name)["remaining_seconds"]
        assert any(abs(v - api_left) <= 5 for v in shown_left), (shown_left, api_left)
        page.goto(base(app_url) + f"/desk/records/{paused}")
        region = page.get_by_role("region", name="SLA")
        api_paused = sla_named(oona, paused, name)
        assert api_paused["stage"] == "paused"
        expect(region).to_contain_text(f"Paused at {fmt_hms(api_paused['remaining_seconds'])} left", timeout=LOAD_MS)
        page.clock.fast_forward(600_000)
        expect(region).to_contain_text(f"Paused at {fmt_hms(api_paused['remaining_seconds'])} left")
        now = advance_clock(app_url, 0)
        nearly = make_record(app_url, "problem", {"short_description": t}, state="new", created_at=(now - timedelta(seconds=HOUR - 90)).isoformat())
        page.goto(base(app_url) + f"/desk/records/{nearly}")
        region = page.get_by_role("region", name="SLA")
        expect(region).to_contain_text(" left", timeout=LOAD_MS)
        page.clock.fast_forward(300_000)
        expect(region).to_contain_text("0:00:00 left", timeout=UI_MS)
        assert "Breached by" not in region.inner_text(), "only the server declares a breach"
        advance_clock(app_url, 600)
        expect(region).to_contain_text("Breached by", timeout=UI_MS)
        expect(announcer(page)).to_have_text(f"SLA breached: {name}", timeout=UI_MS)


def test_wf_sla_clock_agent_and_requester_agree(browser, app_url):
    set_clock(app_url, "2027-01-13T01:00:00+01:00")
    t = tag("swj")
    name = _clock_definition(app_url, t, 2 * HOUR)
    requester = make_user(app_url, ["requester"], "Design Studio")
    tech = make_user(app_url, ["technician"])
    n = make_record(app_url, "incident", {"short_description": t, "caller": requester["username"], "assigned_to": tech["username"], "impact": 3, "urgency": 3,
                                          "assignment_group": "Triage"}, state="in_progress", created_at="2027-01-13T01:00:00+01:00")
    tc, oona = as_user(app_url, tech["username"]), as_user(app_url, "oona")

    def agree(agent: Page, portal: Page) -> None:
        left = sla_named(oona, n, name)["remaining_seconds"]
        a = hms_values(agent.get_by_role("region", name="SLA").inner_text())
        p = hms_values(portal.get_by_role("region", name="SLA").inner_text())
        assert any(abs(v - abs(left)) <= 5 for v in a) and any(abs(v - abs(left)) <= 5 for v in p), (a, p, left)

    with browse(browser, app_url, "oona", f"/desk/records/{n}") as agent, browse(browser, app_url, requester["username"], f"/portal/incidents/{n}") as portal:
        mine = portal.get_by_role("region", name="SLA")
        expect(mine).to_contain_text(" left", timeout=LOAD_MS)
        expect(agent.get_by_role("region", name="SLA").get_by_role("progressbar", name=name)).to_be_visible(timeout=LOAD_MS)
        agree(agent, portal)
        move_ok(tc, n, "on_hold", hold_reason="awaiting_requester")
        expect(announcer(agent)).to_have_text("SLA paused: on hold", timeout=UI_MS)
        left = sla_named(oona, n, name)["remaining_seconds"]
        expect(agent.get_by_role("region", name="SLA")).to_contain_text(f"Paused at {fmt_hms(left)} left", timeout=UI_MS)
        expect(mine).to_contain_text(f"Paused at {fmt_hms(left)} left", timeout=UI_MS)
        move_ok(tc, n, "in_progress")
        expect(announcer(agent)).to_have_text("SLA resumed", timeout=UI_MS)
        agree(agent, portal)
        advance_clock(app_url, 2 * HOUR + 120)
        expect(announcer(agent)).to_have_text(f"SLA breached: {name}", timeout=UI_MS)
        expect(agent.get_by_role("region", name="SLA")).to_contain_text("Breached by", timeout=UI_MS)
        expect(mine).to_contain_text("Breached by", timeout=UI_MS)
        agree(agent, portal)
        move_ok(tc, n, "resolved", resolution_code="fixed", resolution_note="Done")
        expect(announcer(portal)).to_have_text(f"Your request {n} is now Resolved.", timeout=UI_MS)
        expect(agent.get_by_role("region", name="SLA")).to_contain_text("Missed", timeout=UI_MS)
        move_ok(as_user(app_url, requester["username"]), n, "in_progress", reopen_reason="Still broken")
        expect(mine).to_contain_text("Breached by", timeout=UI_MS)
        expect(agent.get_by_role("region", name="SLA")).to_contain_text("Breached by", timeout=UI_MS)
    s = sla_named(oona, n, name)
    assert s["stage"] == "in_progress" and s["breached"] is True


def test_wf_sla_clock_threshold_inbox_live(browser, app_url):
    set_clock(app_url, "2027-01-20T02:00:00+01:00")
    t = tag("swi")
    name = _clock_definition(app_url, t, HOUR)
    caller = make_user(app_url, ["requester"], "Leadership")
    manager = make_user(app_url, ["manager"], "Leadership")
    n = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "impact": 3, "urgency": 3,
                                          "assignment_group": "Triage"}, state="new", created_at="2027-01-20T02:00:00+01:00")
    text = f"{n} has used 75 percent of {name}."
    with browse(browser, app_url, manager["username"], "/inbox", device_time=WRONG_DEVICE_TIME) as page:
        link = page.get_by_role("link", name=re.compile(r"^Inbox, \d+ unread$"))
        expect(link).to_be_visible(timeout=LOAD_MS)
        before = int(re.search(r"\d+", link.inner_text() or link.get_attribute("aria-label") or "0").group())
        advance_clock(app_url, 2820)
        expect(page.get_by_role("list", name="Inbox").get_by_text(text, exact=True)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("link", name=f"Inbox, {before + 1} unread")).to_be_visible(timeout=UI_MS)
    mc = as_user(app_url, manager["username"])
    assert inbox_count(mc, text) == 1
    assert mc.get("/api/inbox").json()["unread"] == before + 1


def test_wf_sla_clock_reopen_across_holiday(browser, app_url):
    set_clock(app_url, "2026-04-07T18:00:00+02:00")
    t = tag("swh")
    requester = make_user(app_url, ["requester"], "Design Studio")
    hist = [{"state": "new", "at": "2026-03-27T16:00:00+01:00"}, {"state": "in_progress", "at": "2026-03-27T16:10:00+01:00"},
            {"state": "resolved", "at": "2026-03-30T10:00:00+02:00"}]
    n = make_record(app_url, "incident", {"short_description": t, "caller": requester["username"], "assigned_to": "oona", "impact": 2, "urgency": 2,
                                          "assignment_group": "Triage", "resolution_code": "fixed", "resolution_note": "ok",
                                          "resolved_at": "2026-03-30T10:00:00+02:00"}, state="resolved", created_at=hist[0]["at"], history=hist)
    expected_left = RESOLUTION_TARGETS[3] - 3 * HOUR
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as agent, browse(browser, app_url, requester["username"], f"/portal/incidents/{n}") as portal:
        form = agent.get_by_role("form", name=n)
        expect(agent.get_by_role("region", name="SLA")).to_contain_text("Met", timeout=LOAD_MS)
        form.get_by_label("Reopen reason").fill("Printer jams again")
        form.get_by_role("button", name=move_label("In progress")).click()
        expect(announcer(agent)).to_have_text(f"{n} moved to In progress.", timeout=UI_MS)
        expect(agent.get_by_role("region", name="SLA")).to_contain_text(f"{fmt_hms(expected_left)} left", timeout=UI_MS)
        expect(portal.get_by_role("region", name="SLA")).to_contain_text(f"{fmt_hms(expected_left)} left", timeout=UI_MS)
    s = sla_named(as_user(app_url, "oona"), n, "Incident resolution")
    assert s["remaining_seconds"] == expected_left and s["ticking"] is False


def test_field_versions_conflicts_and_audit(app_url):
    t = tag("fv")
    n = make_record(app_url, "incident", {"short_description": t, "description": "orig", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    oona, teodor = as_user(app_url, "oona"), as_user(app_url, "teodor")
    r = teodor.patch(f"/api/records/{n}", json={"fields": {"description": {"value": "by teodor", "version": 1}}})
    assert r.status_code == 200 and r.json()["record"]["fields"]["description"]["version"] == 2
    r = oona.patch(f"/api/records/{n}", json={"fields": {"short_description": {"value": f"{t} b", "version": 1}}})
    assert r.status_code == 200
    rec = record(oona, n)
    assert value(rec, "description") == "by teodor" and value(rec, "short_description") == f"{t} b"
    urg_v = rec["fields"]["urgency"]["version"]
    r = oona.patch(f"/api/records/{n}", json={"fields": {"description": {"value": "mine", "version": 1}, "urgency": {"value": 1, "version": urg_v}}})
    assert_error(r, 409, "field_conflict")
    conflict = [x for x in r.json()["error"]["conflicts"] if x["field"] == "description"][0]
    assert conflict["yours"] == "mine" and conflict["theirs"] == "by teodor" and conflict["version"] == 2 and conflict["label"] == "Description"
    assert conflict["theirs_by"] in ("teodor", "Teodor Lindqvist")
    assert value(record(oona, n), "urgency") == 3, "nothing applies when any field is stale"
    v = record(oona, n)["fields"]["urgency"]["version"]
    results: list[int] = []

    def save(c: httpx.Client, val: int) -> None:
        results.append(c.patch(f"/api/records/{n}", json={"fields": {"urgency": {"value": val, "version": v}}}).status_code)

    threads = [threading.Thread(target=save, args=(oona, 1)), threading.Thread(target=save, args=(teodor, 2))]
    for th in threads:
        th.start()
    for th in threads:
        th.join(HTTP_TIMEOUT)
    assert sorted(results) == [200, 409], results
    for c, text in ((oona, f"note one {t}"), (teodor, f"note two {t}")):
        assert c.post(f"/api/records/{n}/work-notes", json={"text": text}).status_code == 201
    texts = activity_texts(oona, n)
    assert any(f"note one {t}" in x for x in texts) and any(f"note two {t}" in x for x in texts)
    audit = oona.get(f"/api/records/{n}/audit").json()["entries"]
    assert any(a["field"] == "description" and a["before"] == "orig" and a["after"] == "by teodor" for a in audit), audit
    assert any(a["field"] == "short_description" and a["after"] == f"{t} b" and a["actor"] in ("oona", "Oona Petrakis") for a in audit)


def test_presence_lists_viewers_and_drops_on_close(browser, app_url):
    t = tag("pr")
    a = make_user(app_url, ["technician"])
    b = make_user(app_url, ["technician"])
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with browse(browser, app_url, a["username"], f"/desk/records/{n}") as pa:
        with browse(browser, app_url, b["username"], f"/desk/records/{n}") as pb:
            expect(pa.get_by_role("list", name="Also viewing").get_by_role("listitem", name=f"{b['display_name']} is viewing")).to_be_visible(timeout=LOAD_MS)
            expect(pb.get_by_role("list", name="Also viewing").get_by_role("listitem", name=f"{a['display_name']} is viewing")).to_be_visible(timeout=UI_MS)
        expect(pa.get_by_role("listitem", name=f"{b['display_name']} is viewing")).to_have_count(0, timeout=UI_MS)


def test_business_rules_order_changes_abort_depth(app_url):
    t = tag("br")
    oona = as_user(app_url, "oona")
    rules = [
        {"name": f"A late {t}", "table": "incident", "when": "before", "order": 20, "operations": ["insert", "update"],
         "condition": f'short_description = "{t}" and changes(urgency)', "actions": [{"set": {"description": '"second"'}}], "active": True},
        {"name": f"Z early {t}", "table": "incident", "when": "before", "order": 10, "operations": ["insert", "update"],
         "condition": f'short_description = "{t}" and changes(urgency)', "actions": [{"set": {"description": '"first"'}}], "active": True},
        {"name": f"Moved {t}", "table": "incident", "when": "after", "order": 100, "operations": ["update"],
         "condition": f'short_description = "{t}" and changes_to(state, "in_progress")', "actions": [{"work_note": f"started {t}"}], "active": True},
        {"name": f"Block {t}", "table": "incident", "when": "before", "order": 100, "operations": ["insert"],
         "condition": f'short_description = "{t}" and impact = 1', "actions": [{"abort": f"Blocked {t}."}], "active": True},
        {"name": f"Chain {t}", "table": "incident", "when": "before", "order": 100, "operations": ["update"],
         "condition": f'short_description startswith "{t}chain" and changes(description)',
         "actions": [{"update_record": {"path": "parent", "fields": {"description": "description"}}}], "active": True},
    ]
    for rule in rules:
        r = oona.post("/api/business-rules", json=rule)
        assert r.status_code == 201, r.text
    after_abort = dict(rules[3], name=f"Bad {t}", when="after")
    assert_error(oona.post("/api/business-rules", json=after_abort), 422, "validation", "Only before rules can abort.")
    first = create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert_error(create(oona, "incident", {"short_description": t, "impact": 1, "urgency": 3, "assignment_group": "Triage"}), 422, "aborted", f"Blocked {t}.")
    second = create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert int(second[4:]) == int(first[4:]) + 1
    assert patch(oona, first, urgency=2).status_code == 200
    assert value(record(oona, first), "description") == "second"
    move_ok(oona, first, "assigned", assigned_to="oona")
    move_ok(oona, first, "in_progress")
    assert f"started {t}" in activity_texts(oona, first)
    parent = None
    chain = []
    for i in range(8):
        parent = make_record(app_url, "incident", {"short_description": f"{t}chain{i}", "description": "d", "impact": 3, "urgency": 3, "assignment_group": "Triage"}, parent=parent)
        chain.append(parent)
    head = chain[-1]
    assert_error(patch(oona, head, description="ripple"), 422, "rule_depth", f'Business rules stopped after {DEPTH_LIMIT} nested updates at rule "Chain {t}".')
    assert value(record(oona, head), "description") == "d" and value(record(oona, chain[-2]), "description") == "d"


def _conflict_incident(app_url: str, t: str) -> str:
    return make_record(app_url, "incident", {"short_description": t, "description": "start", "impact": 3, "urgency": 3, "assignment_group": "Triage"})


def test_wf_form_conflict_shared_edit(browser, app_url):
    t = tag("sh")
    tech = make_user(app_url, ["technician"])
    n = _conflict_incident(app_url, t)
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as po, browse(browser, app_url, tech["username"], f"/desk/records/{n}") as pt:
        expect(po.get_by_role("listitem", name=f"{tech['display_name']} is viewing")).to_be_visible(timeout=LOAD_MS)
        expect(pt.get_by_role("listitem", name=f"{OONA_NAME} is viewing")).to_be_visible(timeout=UI_MS)
        fo, ft = po.get_by_role("form", name=n), pt.get_by_role("form", name=n)
        ft.get_by_label("Description", exact=True).fill(TECH_TEXT)
        ft.get_by_label("Description", exact=True).press("Control+s")
        expect(announcer(pt)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        fo.get_by_label("Short description").fill(f"{t} renamed")
        fo.get_by_label("Short description").press("Control+s")
        expect(announcer(po)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        fo.get_by_label("Description", exact=True).fill(OONA_TEXT)
        grade(app_url, "POST", f"/api/grading/records/{n}/save", {"as": tech["username"], "fields": {"description": {"value": TECH_NEWER, "version": 2}}})
        fo.get_by_label("Description", exact=True).press("Control+s")
        dialog = po.get_by_role("dialog", name="Field conflict")
        expect(dialog).to_be_visible(timeout=UI_MS)
        expect(announcer(po)).to_have_text(f"Conflict on Description: {tech['display_name']} saved a newer value.", timeout=UI_MS)
        expect(dialog).to_contain_text(f"Yours: {OONA_TEXT}")
        expect(dialog).to_contain_text(f"Theirs: {TECH_NEWER}, saved by {tech['display_name']}")
        keep = dialog.get_by_role("radiogroup", name="Description").get_by_role("radio", name="Keep mine")
        keep.focus()
        po.keyboard.press("Space")
        apply = dialog.get_by_role("button", name="Apply choices")
        apply.focus()
        po.keyboard.press("Enter")
        expect(dialog).to_have_count(0, timeout=UI_MS)
        expect(fo.get_by_label("Description", exact=True)).to_be_focused()
    oona = as_user(app_url, "oona")
    rec = record(oona, n)
    assert value(rec, "description") == OONA_TEXT and value(rec, "short_description") == f"{t} renamed"
    audit = oona.get(f"/api/records/{n}/audit").json()["entries"]
    afters = {(a["field"], a["after"]) for a in audit}
    assert {("description", TECH_TEXT), ("description", TECH_NEWER), ("description", OONA_TEXT), ("short_description", f"{t} renamed")} <= afters


def test_wf_form_conflict_live_notes(browser, app_url):
    t = tag("ln")
    tech = make_user(app_url, ["technician"])
    n = _conflict_incident(app_url, t)
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as po, browse(browser, app_url, tech["username"], f"/desk/records/{n}") as pt:
        expect(pt.get_by_role("region", name="Activity")).to_be_visible(timeout=LOAD_MS)
        po.get_by_role("textbox", name="Work note").fill(f"oona note {t}")
        po.get_by_role("button", name="Add work note").click()
        expect(announcer(po)).to_have_text("Note added.", timeout=UI_MS)
        expect(pt.get_by_role("region", name="Activity")).to_contain_text(f"oona note {t}", timeout=UI_MS)
        pt.get_by_role("textbox", name="Work note").fill(f"tech note {t}")
        pt.get_by_role("button", name="Add work note").click()
        expect(po.get_by_role("region", name="Activity")).to_contain_text(f"tech note {t}", timeout=UI_MS)
    texts = activity_texts(as_user(app_url, "oona"), n)
    assert any(f"oona note {t}" in x for x in texts) and any(f"tech note {t}" in x for x in texts)


def test_assignment_round_robin_capacity_and_triage(app_url):
    t = tag("as")
    u1 = make_user(app_url, ["technician"], capacity=2)
    u2 = make_user(app_url, ["technician"], out_of_office=True)
    u3 = make_user(app_url, ["technician"], capacity=1)
    group, rule = f"Group {t}", f"Rule {t}"
    fixtures(app_url, {"groups": [{"name": group, "members": [u1["username"], u2["username"], u3["username"]], "escalation_policy": None}],
                       "assignment_rules": [{"name": rule, "order": 1, "table": "incident", "condition": f'short_description = "{t}"', "group": group, "active": True}]})
    oona = as_user(app_url, "oona")
    got = []
    for _ in range(4):
        n = create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3})
        rec = record(oona, n)
        got.append((n, value(rec, "assignment_group"), value(rec, "assigned_to")))
    assert [g[2] for g in got] == [u1["username"], u3["username"], u1["username"], None], got
    assert [g[1] for g in got] == [group, group, group, "Triage"]
    assert f'Assigned to {u1["display_name"]} by rule "{rule}".' in activity_texts(oona, got[0][0])
    assert f"No one in {group} could take {got[3][0]}; sent to Triage." in activity_texts(oona, got[3][0])


def test_rotation_handover_across_dst_and_overrides(app_url):
    t = tag("rot")
    a, b, c, d = (make_user(app_url, ["technician"]) for _ in range(4))
    name = f"Rotation {t}"
    fixtures(app_url, {"rotations": [{"name": name, "time_zone": "Europe/Berlin", "handover_weekday": "monday", "handover_time": "09:00",
                                      "members": [a["username"], b["username"]], "anchor_date": "2026-03-16"}]})
    oona = as_user(app_url, "oona")

    def oncall(at: str) -> dict:
        r = oona.get(f"/api/rotations/{q(name)}/oncall", params={"at": at})
        assert r.status_code == 200, r.text
        return r.json()

    x = oncall("2026-03-30T08:59:00+02:00")
    assert x["username"] == b["username"] and x["override"] is False
    s, e = parse_instant(x["shift_start"]), parse_instant(x["shift_end"])
    assert s == datetime(2026, 3, 23, 9, tzinfo=BERLIN) and e == datetime(2026, 3, 30, 9, tzinfo=BERLIN)
    assert (e - s) == timedelta(hours=167)
    assert oncall("2026-03-30T09:00:00+02:00")["username"] == a["username"]
    y = oncall("2026-10-26T08:59:00+01:00")
    assert y["username"] == b["username"]
    assert parse_instant(y["shift_end"]) - parse_instant(y["shift_start"]) == timedelta(hours=169)
    shifts = oona.get(f"/api/rotations/{q(name)}/shifts", params={"from": "2026-03-23T12:00:00+01:00", "to": "2026-04-01T00:00:00+02:00"}).json()["shifts"]
    assert any(parse_instant(sh["start"]) == datetime(2026, 3, 30, 9, tzinfo=BERLIN) and sh["username"] == a["username"] for sh in shifts), shifts
    for who, start, end in ((c, "2026-03-25T10:00:00+01:00", "2026-03-25T12:00:00+01:00"), (d, "2026-03-25T11:00:00+01:00", "2026-03-25T13:00:00+01:00")):
        assert oona.post(f"/api/rotations/{q(name)}/overrides", json={"username": who["username"], "start": start, "end": end}).status_code == 201
    assert oncall("2026-03-25T10:30:00+01:00")["username"] == c["username"]
    z = oncall("2026-03-25T11:30:00+01:00")
    assert z["username"] == d["username"] and z["override"] is True
    assert oncall("2026-03-25T12:30:00+01:00")["username"] == d["username"]
    assert oncall("2026-03-25T13:30:00+01:00")["username"] == b["username"]


def test_escalation_ladder_and_late_acknowledge(app_url):
    set_clock(app_url, "2027-03-03T02:00:00+01:00")
    t = tag("esc")
    u1, u2, u3 = (make_user(app_url, ["technician"]) for _ in range(3))
    policy = f"Ladder {t}"
    fixtures(app_url, {"escalation_policies": [{"name": policy, "levels": [{"target": {"user": u1["username"]}, "ack_minutes": 10},
                                                                            {"target": {"user": u2["username"]}, "ack_minutes": 10}]}]})
    oona = as_user(app_url, "oona")
    c1, c2, c3 = (as_user(app_url, u["username"]) for u in (u1, u2, u3))

    def start_page() -> tuple[str, dict]:
        n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
        r = oona.post(f"/api/records/{n}/page", json={"policy": policy})
        assert r.status_code == 201, r.text
        return n, r.json()["page"]

    n, pg = start_page()
    assert pg["level"] == 1 and pg["levels"][0]["username"] == u1["username"]
    l1 = pg["levels"][0]
    assert parse_instant(l1["ack_due_at"]) - parse_instant(l1["notified_at"]) == timedelta(minutes=10)
    advance_clock(app_url, 590)
    assert find_page(oona, pg["id"])["level"] == 1
    advance_clock(app_url, 20)
    now = find_page(oona, pg["id"])
    assert now["level"] == 2 and parse_instant(now["levels"][1]["notified_at"]) == parse_instant(l1["ack_due_at"])
    assert inbox_count(c2, f"Page for {n}: please acknowledge.") == 1
    assert_error(c3.post(f"/api/pages/{pg['id']}/acknowledge", json={}), 403, "not_paged", "You were not paged for this.")
    r = c1.post(f"/api/pages/{pg['id']}/acknowledge", json={})
    assert r.status_code == 200 and r.json()["page"]["late"] is True and r.json()["page"]["acknowledged_level"] == 1
    assert f"Late acknowledge from {u1['display_name']} at level 1; paging had reached level 2." in activity_texts(oona, n)
    assert_error(c2.post(f"/api/pages/{pg['id']}/acknowledge", json={}), 409, "already_acknowledged", f"Already acknowledged by {u1['display_name']}.")
    advance_clock(app_url, 1200)
    assert find_page(oona, pg["id"])["status"] == "acknowledged", "an acknowledge stops the ladder"
    n2, pg2 = start_page()
    assert_error(oona.post(f"/api/records/{n2}/page", json={"policy": policy}), 409, "already_paging")
    assert c1.post(f"/api/pages/{pg2['id']}/acknowledge", json={}).json()["page"]["late"] is False
    assert f"Acknowledged by {u1['display_name']} at level 1." in activity_texts(oona, n2)
    n3, pg3 = start_page()
    advance_clock(app_url, 1300)
    assert find_page(oona, pg3["id"])["status"] == "exhausted"
    assert inbox_count(oona, f"Page for {n3} was not acknowledged at any level.") == 1
    assert c2.post(f"/api/pages/{pg3['id']}/acknowledge", json={}).json()["page"]["late"] is True


INERT_VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024)}


@pytest.mark.parametrize("viewport", list(INERT_VIEWPORTS), ids=list(INERT_VIEWPORTS))
def test_closed_drawers_and_sheets_are_inert(browser, app_url, viewport):
    width, height = INERT_VIEWPORTS[viewport]
    with browse(browser, app_url, "teodor", "/desk/lists/incident", width=width, height=height) as page:
        menu = page.get_by_role("banner").get_by_role("button", name="Menu")
        expect(menu).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("dialog", name="Navigation")).to_have_count(0)
        menu.click()
        drawer = page.get_by_role("dialog", name="Navigation")
        expect(drawer).to_be_visible(timeout=UI_MS)
        handles = focusables(drawer)
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="Navigation")).to_have_count(0, timeout=UI_MS)
        assert_inert_after_close(page, handles, "navigation drawer")
        layout(page)
        menu.click()
        expect(page.get_by_role("dialog", name="Navigation")).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Filter").click()
        sheet = page.get_by_role("dialog", name="Filter")
        expect(sheet).to_be_visible(timeout=UI_MS)
        handles = focusables(sheet)
        sheet.get_by_role("button", name="Close").click()
        expect(page.get_by_role("dialog", name="Filter")).to_have_count(0, timeout=UI_MS)
        assert_inert_after_close(page, handles, "filter sheet")
        layout(page)


def _oncall_setup(app_url: str, t: str) -> tuple[dict, dict, str]:
    tech = make_user(app_url, ["technician"])
    away = make_user(app_url, ["technician"], out_of_office=True)
    op2 = make_user(app_url, ["operator"])
    rotation, policy, group = f"Rot {t}", f"Pol {t}", f"Grp {t}"
    fixtures(app_url, {"rotations": [{"name": rotation, "time_zone": "Europe/Berlin", "handover_weekday": "monday", "handover_time": "09:00",
                                      "members": [tech["username"]], "anchor_date": "2027-01-04"}],
                       "escalation_policies": [{"name": policy, "levels": [{"target": {"rotation": rotation}, "ack_minutes": 5}, {"target": {"user": op2["username"]}, "ack_minutes": 5}]}],
                       "groups": [{"name": group, "members": [away["username"], tech["username"]], "escalation_policy": policy}],
                       "assignment_rules": [{"name": f"Rule {t}", "order": 1, "table": "incident", "condition": f'short_description = "{t}"', "group": group, "active": True}]})
    return tech, op2, group


def test_wf_assign_oncall_page_escalates_live(browser, app_url):
    set_clock(app_url, "2027-03-10T02:00:00+01:00")
    t = tag("oc")
    tech, op2, group = _oncall_setup(app_url, t)
    oona = as_user(app_url, "oona")
    n = create_ok(oona, "incident", {"short_description": t, "impact": 1, "urgency": 1})
    rec = record(oona, n)
    assert value(rec, "assigned_to") == tech["username"] and value(rec, "assignment_group") == group
    pg = poll(lambda: [p for p in oona.get("/api/pages").json()["pages"] if p["record"] == n], API_WAIT_S, f"a page starts for {n}")[0]
    assert pg["levels"][0]["username"] == tech["username"]
    with browse(browser, app_url, op2["username"], f"/desk/records/{n}") as desk, \
            browse(browser, app_url, tech["username"], "/pages", width=375, height=812, resume=False, device_time=WRONG_DEVICE_TIME) as phone:
        link = desk.get_by_role("link", name=re.compile(r"^Inbox, \d+ unread$"))
        expect(link).to_be_visible(timeout=LOAD_MS)
        before = int(re.search(r"\d+", link.get_attribute("aria-label") or link.inner_text()).group())
        advance_clock(app_url, 310)
        expect(desk.get_by_role("link", name=f"Inbox, {before + 1} unread")).to_be_visible(timeout=UI_MS)
        card = phone.get_by_role("article", name=f"Page for {n}")
        expect(card).to_be_visible(timeout=LOAD_MS)
        touch_hold(phone, card, LONG_PRESS_MS + 100)
        sheet = phone.get_by_role("dialog", name="Page actions")
        expect(sheet).to_be_visible(timeout=UI_MS)
        sheet.get_by_role("button", name="Acknowledge").click()
        expect(announcer(phone)).to_have_text("Page acknowledged.", timeout=UI_MS)
        expect(desk.get_by_role("region", name="Activity")).to_contain_text(
            f"Late acknowledge from {tech['display_name']} at level 1; paging had reached level 2.", timeout=UI_MS)
    final = find_page(oona, pg["id"])
    assert final["status"] == "acknowledged" and final["late"] is True


def test_wf_assign_oncall_swipe_with_undo(browser, app_url):
    set_clock(app_url, "2027-03-17T02:00:00+01:00")
    t = tag("sw")
    tech, _, _ = _oncall_setup(app_url, t)
    oona = as_user(app_url, "oona")
    n = create_ok(oona, "incident", {"short_description": t, "impact": 1, "urgency": 1})
    pg = poll(lambda: [p for p in oona.get("/api/pages").json()["pages"] if p["record"] == n], API_WAIT_S, f"a page starts for {n}")[0]
    with browse(browser, app_url, tech["username"], "/pages", width=375, height=812, resume=False) as phone:
        card = phone.get_by_role("article", name=f"Page for {n}")
        expect(card).to_be_visible(timeout=LOAD_MS)
        touch_swipe(phone, card, SWIPE_DISTANCE + 40)
        undo = phone.get_by_role("button", name="Undo")
        expect(undo).to_be_visible(timeout=UI_MS)
        phone.clock.run_for(UNDO_MS - 2000)
        undo.click()
        expect(card).to_be_visible(timeout=UI_MS)
        phone.clock.run_for(UNDO_MS + 1000)
        assert find_page(oona, pg["id"])["status"] == "paging", "Undo within 5 seconds sends nothing"
        touch_swipe(phone, card, SWIPE_DISTANCE + 40)
        phone.clock.run_for(UNDO_MS + 200)
        expect(announcer(phone)).to_have_text("Page acknowledged.", timeout=UI_MS)
    assert find_page(oona, pg["id"])["status"] == "acknowledged"


def test_ci_classes_and_dependency_loops(app_url):
    t = tag("cls")
    oona = as_user(app_url, "oona")
    r = oona.post("/api/cis", json=ci(f"{t} vm", "Virtual server", 2, host_name="h1", operating_system="Linux", location="Rack 4"))
    assert r.status_code == 201, r.text
    attrs = oona.get(f"/api/cis/{q(f'{t} vm')}").json()["ci"]["attributes"]
    assert {"host_name", "operating_system", "location"} <= set(attrs)
    assert_error(oona.post("/api/cis", json=ci(f"{t} VM".upper(), "Application", 1)), 422, "validation")
    for x in ("a", "b", "c"):
        assert oona.post("/api/cis", json=ci(f"{t} {x}", "Application", 1)).status_code == 201
    assert_error(oona.post("/api/relationships", json=rel(f"{t} a", "relies on", f"{t} b")), 422, "validation")
    assert oona.post("/api/relationships", json=rel(f"{t} a", "depends on", f"{t} b")).status_code == 201
    assert oona.post("/api/relationships", json=rel(f"{t} b", "runs on", f"{t} c")).status_code == 201
    assert_error(oona.post("/api/relationships", json=rel(f"{t} c", "hosted by", f"{t} a")), 422, "cycle",
                 f"This relationship would form a dependency loop: {t} c -> {t} a -> {t} b -> {t} c.")
    edges = oona.get("/api/service-map").json()["edges"]
    assert not any(e["source"] == f"{t} c" and e["target"] == f"{t} a" for e in edges)
    assert oona.post("/api/relationships", json=rel(f"{t} c", "connects to", f"{t} a")).status_code == 201


def _class_label(raw: str) -> str:
    for label in CLASS_LABELS:
        if raw == label or raw == label.lower().replace(" ", "_"):
            return label
    return raw


def _expected_layout(nodes: list[dict], edges: list[dict], crit: dict[str, int]) -> dict[str, tuple[int, int, int]]:
    out: dict[str, list[str]] = {n["name"]: [] for n in nodes}
    for e in edges:
        if e["type"] in ("depends on", "runs on", "hosted by"):
            out[e["source"]].append(e["target"])
        elif e["type"] == "member of":
            out[e["target"]].append(e["source"])
    layer: dict[str, int] = {}

    def lay(name: str) -> int:
        if name not in layer:
            layer[name] = 0 if not out[name] else 1 + max(lay(x) for x in out[name])
        return layer[name]

    for n in out:
        lay(n)
    top = max(layer.values())
    result = {}
    for lv in range(top + 1):
        row = sorted([n for n in layer if layer[n] == lv], key=lambda n: (-crit[n], n.lower()))
        for pos, n in enumerate(row):
            result[n] = (MAP_X0 + MAP_DX * pos, MAP_X0 + MAP_DY * (top - lv), lv)
    return result


def test_map_layout_names_keyboard_and_expand(browser, app_url):
    oona = as_user(app_url, "oona")
    m = oona.get("/api/service-map").json()
    cis_all = oona.get("/api/cis").json()["cis"]
    crit = {c["name"]: c["criticality"] for c in cis_all}
    eff = {c["name"]: c["effective_status"] for c in cis_all}

    def _layout_known(nodes: list[dict], edges: list[dict]) -> dict[str, tuple[int, int, int]]:
        names = [n["name"] for n in nodes]
        out: dict[str, list[str]] = {n: [] for n in names}
        for e in edges:
            if e["type"] in ("depends on", "runs on", "hosted by"):
                out.setdefault(e["source"], []).append(e["target"])
            elif e["type"] == "member of":
                out.setdefault(e["target"], []).append(e["source"])
        layer: dict[str, int] = {}

        def lay(name: str) -> int:
            if name not in layer:
                layer[name] = 0 if not out.get(name) else 1 + max(lay(x) for x in out[name])
            return layer[name]

        for n in names:
            lay(n)
        top = max(layer[n] for n in names)
        result = {}
        for lv in range(top + 1):
            row = sorted([n for n in names if layer[n] == lv], key=lambda n: (-crit[n], n.lower()))
            for pos, n in enumerate(row):
                result[n] = (MAP_X0 + MAP_DX * pos, MAP_X0 + MAP_DY * (top - lv), lv)
        return result

    expected = _layout_known(m["nodes"], m["edges"])
    for node in m["nodes"]:
        assert (node["x"], node["y"]) == expected[node["name"]][:2], node
    with browse(browser, app_url, "oona", "/desk/map") as page:
        group = page.get_by_role("group", name="Service map")
        expect(group).to_be_visible(timeout=LOAD_MS)
        for node in m["nodes"]:
            btn = group.get_by_role("button", name=f"{node['name']}, {_class_label(node['class'])}, {STATUS_LABELS[eff[node['name']]]}", exact=True)
            expect(btn).to_have_count(1)
            xy = btn.evaluate("el => { const h = el.closest('[data-x]') || el; return [Number(h.dataset.x), Number(h.dataset.y)]; }")
            assert tuple(xy) == expected[node["name"]][:2], (node["name"], xy)
        rows: dict[int, list[str]] = {}
        for name, (x, y, _) in sorted(expected.items(), key=lambda kv: (kv[1][1], kv[1][0])):
            rows.setdefault(y, []).append(name)
        ys = sorted(rows)
        status = {n["name"]: n for n in m["nodes"]}

        def btn_of(name: str) -> Locator:
            n = status[name]
            return group.get_by_role("button", name=f"{name}, {_class_label(n['class'])}, {STATUS_LABELS[eff[name]]}", exact=True)

        tab_into(page, group, "the service map")
        first = rows[ys[0]][0]
        assert is_focused(btn_of(first)), "focus lands on the top-left node"
        if len(rows[ys[0]]) > 1:
            page.keyboard.press("ArrowRight")
            expect(btn_of(rows[ys[0]][1])).to_be_focused(timeout=UI_MS)
            page.keyboard.press("End")
            expect(btn_of(rows[ys[0]][-1])).to_be_focused(timeout=UI_MS)
            page.keyboard.press("Home")
            expect(btn_of(first)).to_be_focused(timeout=UI_MS)
        page.keyboard.press("ArrowLeft")
        assert is_focused(btn_of(first)), "nothing happens at the end of a row"
        below = rows[ys[1]]
        fx = expected[first][0]
        target = min(below, key=lambda n: (abs(expected[n][0] - fx), expected[n][0]))
        page.keyboard.press("ArrowDown")
        expect(btn_of(target)).to_be_focused(timeout=UI_MS)
        page.evaluate(ANIM_RECORDER)
        page.keyboard.press("Enter")
        details = page.get_by_role("region", name=f"{target} details")
        expect(details).to_be_visible(timeout=UI_MS)
        assert MAP_EXPAND_MS in [round(d) for d in durations_on(details)], durations_on(details)


def test_impact_spread_cluster_maintenance_and_people(app_url):
    set_clock(app_url, "2027-04-07T12:00:00+02:00")
    t = tag("imp")

    def N(s: str) -> str:
        return f"{t} {s}"

    fixtures(app_url, {"cis": [ci(N("array"), "Storage", 3), ci(N("cluster"), "Cluster", 3, required_healthy=2),
                               ci(N("node1"), "Server", 2), ci(N("node2"), "Server", 2), ci(N("node3"), "Server", 2),
                               ci(N("vm"), "Virtual server", 3), ci(N("vm2"), "Virtual server", 2), ci(N("app"), "Application", 3), ci(N("app2"), "Application", 2),
                               ci(N("payroll"), "Business service", 3, bc=True, used_by={"departments": ["Finance"], "people": ["ops01"]}),
                               ci(N("ledger"), "Business service", 2, used_by={"departments": [], "people": ["fin01"]}),
                               ci(N("mail"), "Business service", 3, bc=True, used_by={"departments": ["Leadership"], "people": []})],
                       "relationships": [rel(N("cluster"), "depends on", N("array")), rel(N("node1"), "member of", N("cluster")), rel(N("node2"), "member of", N("cluster")),
                                         rel(N("node3"), "member of", N("cluster")), rel(N("vm"), "hosted by", N("cluster")), rel(N("vm2"), "hosted by", N("cluster")),
                                         rel(N("app"), "runs on", N("vm")), rel(N("app2"), "runs on", N("vm2")), rel(N("payroll"), "depends on", N("app")),
                                         rel(N("ledger"), "depends on", N("app")), rel(N("mail"), "depends on", N("app2"))],
                       "maintenance": [{"ci": N("vm2"), "start": "2027-04-07T11:00:00+02:00", "end": "2027-04-07T17:00:00+02:00"}]})
    oona = as_user(app_url, "oona")
    finance = department_size(oona, "Finance")
    r = oona.post(f"/api/cis/{q(N('array'))}/status", json={"status": "down"})
    assert r.status_code == 200, r.text
    imp = r.json()["impact"]
    assert [a["ci"]["name"] for a in imp["affected"]] == [N("cluster"), N("vm"), N("app"), N("payroll"), N("ledger")], imp["affected"]
    assert imp["affected"][3]["path"] == ["depends on", "runs on", "hosted by", "depends on"]
    assert [a["tier"] for a in imp["affected"]] == [2, 2, 2, 1, 3]
    assert imp["people_total"] == finance + 1 and imp["affected"][4]["people_added"] == 0
    assert [a["running_people"] for a in imp["affected"]] == [0, 0, 0, finance + 1, finance + 1]
    assert oona.get(f"/api/cis/{q(N('vm2'))}").json()["ci"]["effective_status"] == "maintenance"
    assert oona.get(f"/api/cis/{q(N('mail'))}").json()["ci"]["effective_status"] == "healthy"
    assert oona.post(f"/api/cis/{q(N('array'))}/status", json={"status": "healthy"}).status_code == 200
    imp = oona.post(f"/api/cis/{q(N('node1'))}/status", json={"status": "down"}).json()["impact"]
    assert imp["affected"] == [] and N("cluster") in [d["ci"] if isinstance(d["ci"], str) else d["ci"]["name"] for d in imp["degraded"]]
    assert oona.get(f"/api/cis/{q(N('cluster'))}").json()["ci"]["effective_status"] == "degraded"
    imp = oona.post(f"/api/cis/{q(N('node2'))}/status", json={"status": "down"}).json()["impact"]
    assert N("cluster") in [a["ci"]["name"] for a in imp["affected"]]
    assert oona.get(f"/api/cis/{q(N('cluster'))}").json()["ci"]["effective_status"] == "down"


def _map_items(app_url: str, t: str) -> dict[str, str]:
    names = {"array": f"{t} array", "svc1": f"{t} svc one", "svc2": f"{t} svc two", "app": f"{t} app"}
    fixtures(app_url, {"cis": [ci(names["array"], "Storage", 3), ci(names["app"], "Application", 3),
                               ci(names["svc1"], "Business service", 3, bc=True, used_by={"departments": ["Leadership"], "people": []}),
                               ci(names["svc2"], "Business service", 3, bc=True, used_by={"departments": [], "people": ["ops02"]})],
                       "relationships": [rel(names["svc1"], "depends on", names["array"]), rel(names["svc2"], "depends on", names["array"])]})
    return names


def test_wf_service_map_keyboard_outage(browser, app_url):
    t = tag("mk")
    names = _map_items(app_url, t)
    with browse(browser, app_url, "oona", "/desk/map") as page:
        group = page.get_by_role("group", name="Service map")
        node = group.get_by_role("button", name=f"{names['array']}, Storage, Healthy", exact=True)
        expect(node).to_be_visible(timeout=LOAD_MS)
        node.focus()
        page.keyboard.press("Enter")
        details = page.get_by_role("region", name=f"{names['array']} details")
        expect(details).to_be_visible(timeout=UI_MS)
        mark = page.get_by_role("button", name="Mark down")
        mark.focus()
        page.keyboard.press("Enter")
        expect(group.get_by_role("button", name=f"{names['array']}, Storage, Down", exact=True)).to_be_visible(timeout=UI_MS)
        expect(group.get_by_role("button", name=f"{names['svc2']}, Business service, Down", exact=True)).to_be_visible(timeout=UI_MS)
    oona = as_user(app_url, "oona")
    assert oona.get(f"/api/cis/{q(names['svc2'])}").json()["ci"]["effective_status"] == "down"


def test_wf_service_map_reduced_motion(browser, app_url):
    t = tag("mr")
    names = _map_items(app_url, t)
    with browse(browser, app_url, "oona", "/desk/map", reduced_motion="reduce") as page:
        node = page.get_by_role("group", name="Service map").get_by_role("button", name=f"{names['app']}, Application, Healthy", exact=True)
        expect(node).to_be_visible(timeout=LOAD_MS)
        page.evaluate(ANIM_RECORDER)
        node.focus()
        page.keyboard.press("Enter")
        details = page.get_by_role("region", name=f"{names['app']} details")
        expect(details).to_be_visible(timeout=UI_MS)
        assert durations_on(details) == []
        assert page.evaluate("() => document.getAnimations().length") == 0


def test_wf_service_map_maintenance_and_proposal_banner(browser, app_url):
    set_clock(app_url, "2027-04-14T10:00:00+02:00")
    t = tag("mm")
    names = _map_items(app_url, t)
    fixtures(app_url, {"cis": [ci(f"{t} edge", "Network device", 2), ci(f"{t} remote", "Business service", 2, used_by={"departments": [], "people": ["ops03"]})],
                       "relationships": [rel(f"{t} remote", "depends on", f"{t} edge")]})
    with browse(browser, app_url, "oona", "/desk/map") as page:
        group = page.get_by_role("group", name="Service map")
        group.get_by_role("button", name=f"{t} edge, Network device, Healthy", exact=True).click(timeout=LOAD_MS)
        page.get_by_role("button", name="Schedule maintenance").click()
        dlg = page.get_by_role("dialog", name="Schedule maintenance")
        dlg.get_by_role("textbox", name="Start").fill("2027-04-14 00:00")
        dlg.get_by_role("textbox", name="End").fill("2027-04-14 23:00")
        dlg.get_by_role("button", name="Schedule").click()
        expect(group.get_by_role("button", name=f"{t} edge, Network device, In maintenance", exact=True)).to_be_visible(timeout=UI_MS)
        group.get_by_role("button", name=f"{names['array']}, Storage, Healthy", exact=True).click()
        page.get_by_role("button", name="Mark down").click()
        expect(group.get_by_role("button", name=f"{names['array']}, Storage, Down", exact=True)).to_be_visible(timeout=UI_MS)
    oona = as_user(app_url, "oona")
    imp = oona.get(f"/api/cis/{q(f'{t} edge')}/impact").json()
    assert imp["affected"] == []
    assert oona.get(f"/api/cis/{q(f'{t} remote')}").json()["ci"]["effective_status"] == "healthy"
    assert any(_ci_name(p["ci"]) == names["array"] and p["status"] == "open" for p in oona.get("/api/major-proposals").json()["proposals"])


def _proposal_for(oona: httpx.Client, ci_name: str) -> dict:
    return poll(lambda: [p for p in oona.get("/api/major-proposals").json()["proposals"] if _ci_name(p["ci"]) == ci_name], API_WAIT_S, f"a proposal for {ci_name}")[0]


def test_major_incident_proposal_promote_reject(app_url):
    t = tag("mj")
    names = _map_items(app_url, t)
    oona, teodor = as_user(app_url, "oona"), as_user(app_url, "teodor")
    open1 = make_record(app_url, "incident", {"short_description": t, "configuration_item": names["svc1"], "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    open2 = make_record(app_url, "incident", {"short_description": t, "configuration_item": names["svc2"], "impact": 3, "urgency": 3, "assignment_group": "Triage"}, state="assigned")
    done = make_record(app_url, "incident", {"short_description": t, "configuration_item": names["svc2"], "impact": 3, "urgency": 3, "assignment_group": "Triage",
                                             "resolution_code": "fixed", "resolution_note": "x"}, state="resolved")
    imp = oona.post(f"/api/cis/{q(names['array'])}/status", json={"status": "down"}).json()["impact"]
    assert imp["proposal"] is not None and imp["business_critical_affected"] == 2
    prop = _proposal_for(oona, names["array"])
    assert prop["reason"] == "2 business-critical services affected" and prop["status"] == "open"
    assert inbox_count(oona, f"Major incident proposed for {names['array']}: 2 business-critical services affected.") == 1
    r = teodor.post(f"/api/major-proposals/{prop['id']}/promote")
    assert r.status_code == 403 and r.json() == OPERATOR_ONLY
    r = oona.post(f"/api/major-proposals/{prop['id']}/promote")
    assert r.status_code == 201, r.text
    major = r.json()["record"]
    assert value(major, "is_major") is True and value(major, "short_description") == f"Outage: {names['array']}" and value(major, "priority") == 1 and major["state"] == "new"
    assert sorted(major["links"]["children"]) == sorted([open1, open2]) and done not in major["links"]["children"]
    assert_error(oona.post(f"/api/major-proposals/{prop['id']}/promote"), 409, "proposal_closed")
    fixtures(app_url, {"cis": [ci(f"{t} switch", "Network device", 2), ci(f"{t} print", "Business service", 1, used_by={"departments": [], "people": ["ops04"]})],
                       "relationships": [rel(f"{t} print", "depends on", f"{t} switch")]})
    for _ in range(3):
        make_record(app_url, "incident", {"short_description": t, "configuration_item": f"{t} print", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    oona.post(f"/api/cis/{q(f'{t} switch')}/status", json={"status": "down"})
    p2 = _proposal_for(oona, f"{t} switch")
    assert p2["reason"] == "3 open incidents on affected items"
    r = oona.post(f"/api/major-proposals/{p2['id']}/reject", json={"reason": "Known flap"})
    assert r.status_code == 200 and r.json()["proposal"]["status"] == "rejected"
    assert_error(oona.post(f"/api/major-proposals/{p2['id']}/promote"), 409, "proposal_closed")


def _major_with_children(app_url: str, t: str, extra_short: str | None = None) -> tuple[str, list[str], str]:
    parent = make_record(app_url, "incident", {"short_description": f"Outage {t}", "is_major": True, "impact": 1, "urgency": 1, "assignment_group": "Triage", "assigned_to": "oona"}, state="in_progress")
    kids = []
    for state, extra in (("new", {}), ("assigned", {"assigned_to": "oona"}), ("in_progress", {"assigned_to": "oona"}), ("on_hold", {"assigned_to": "oona", "hold_reason": "awaiting_supplier"})):
        kids.append(make_record(app_url, "incident", {"short_description": extra_short if (extra_short and state == "on_hold") else f"{t} child", "impact": 3, "urgency": 3, "assignment_group": "Triage", **extra}, state=state, parent=parent))
    old = make_record(app_url, "incident", {"short_description": f"{t} old", "impact": 3, "urgency": 3, "assignment_group": "Triage", "resolution_code": "duplicate", "resolution_note": "earlier"}, state="resolved", parent=parent)
    return parent, kids, old


def test_resolve_together_all_or_nothing(app_url):
    t = tag("rt")
    oona = as_user(app_url, "oona")
    oona.post("/api/business-rules", json={"name": f"Blocker {t}", "table": "incident", "when": "before", "order": 100, "operations": ["update"],
                                           "condition": f'short_description = "{t} blocker" and changes_to(state, "resolved")', "actions": [{"abort": f"Blocked {t}"}], "active": True})
    parent, kids, _ = _major_with_children(app_url, f"{t}x", extra_short=f"{t} blocker")
    blocker = kids[3]
    assert_error(move(oona, parent, "resolved", resolution_code="workaround_given", resolution_note="Array swapped"), 422, "child_failed",
                 f"Child {blocker} could not be resolved: Blocked {t}.")
    assert record(oona, parent)["state"] == "in_progress" and all(record(oona, k)["state"] != "resolved" for k in kids)
    parent, kids, old = _major_with_children(app_url, t)
    move_ok(oona, parent, "resolved", resolution_code="workaround_given", resolution_note="Array swapped")
    for k in kids:
        rec = record(oona, k)
        assert rec["state"] == "resolved" and value(rec, "resolution_code") == "workaround_given"
        assert value(rec, "resolution_note") == f"Resolved with major incident {parent}: Array swapped"
    assert value(record(oona, old), "resolution_note") == "earlier"
    move_ok(oona, kids[0], "in_progress", reopen_reason="Still slow")
    assert record(oona, kids[0])["state"] == "in_progress" and record(oona, parent)["state"] == "resolved"
    assert all(record(oona, k)["state"] == "resolved" for k in kids[1:])


def _relay_major(app_url: str, t: str) -> tuple[str, str, dict]:
    array, app = f"{t} array", f"{t} alpha app"
    fixtures(app_url, {"cis": [ci(array, "Storage", 3), ci(app, "Application", 3),
                               ci(f"{t} books", "Business service", 3, bc=True, used_by={"departments": ["Finance"], "people": []}),
                               ci(f"{t} mailbox", "Business service", 3, bc=True, used_by={"departments": ["Leadership"], "people": ["ops01"]}),
                               ci(f"{t} plotter", "Business service", 1, used_by={"departments": [], "people": ["design01"]})],
                       "relationships": [rel(app, "depends on", array), rel(f"{t} books", "depends on", app), rel(f"{t} mailbox", "depends on", array),
                                         rel(f"{t} plotter", "depends on", app)]})
    make_record(app_url, "incident", {"short_description": f"{t} child", "configuration_item": f"{t} books", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    oona = as_user(app_url, "oona")
    oona.post(f"/api/cis/{q(array)}/status", json={"status": "down"})
    prop = _proposal_for(oona, array)
    major = oona.post(f"/api/major-proposals/{prop['id']}/promote").json()["record"]["number"]
    data = oona.get(f"/api/major/{major}").json()
    return major, array, data["impact"]


def test_outage_relay_scroll_counter(browser, app_url):
    t = tag("rl")
    major, array, imp = _relay_major(app_url, t)
    oona = as_user(app_url, "oona")
    assert imp["people_total"] == department_size(oona, "Finance") + department_size(oona, "Leadership") + 2
    affected = imp["affected"]
    with browse(browser, app_url, "oona", f"/desk/major/{major}", resume=False) as page:
        expect(page.get_by_role("heading", level=1, name=array)).to_be_visible(timeout=LOAD_MS)
        panels = page.get_by_role("article")
        names = [a["ci"]["name"] for a in affected]
        for i, a in enumerate(affected):
            art = page.get_by_role("article", name=a["ci"]["name"], exact=True)
            expect(art).to_contain_text(f"Tier {a['tier']}")
            expect(art).to_contain_text(f"+{a['people_added']} people")
            expect(art.get_by_role("img", name=f"{a['ci']['name']} portrait")).to_have_count(1)
        tops = [page.get_by_role("article", name=nm, exact=True).evaluate("el => el.getBoundingClientRect().top + window.scrollY") for nm in names]
        assert tops == sorted(tops), (names, tops)
        counter = page.get_by_role("group", name="Affected people")
        vh = page.viewport_size["height"]
        total_h = page.evaluate("() => document.scrollingElement.scrollHeight")
        positions = list(range(0, int(total_h), max(1, vh // 3)))[:60]
        seen: list[int] = []
        for pos in positions + positions[::-1]:
            page.evaluate("y => window.scrollTo(0, y)", pos)
            advance(page, COUNTER_MS + 100)
            settle(counter)
            passed = [i for i, a in enumerate(affected) if (page.get_by_role("article", name=a["ci"]["name"], exact=True).bounding_box() or {"y": vh})["y"] < vh / 2]
            want = affected[max(passed)]["running_people"] if passed else imp["base_people"]
            got = int(re.search(r"\d+", counter.inner_text()).group())
            assert got == want, (pos, got, want)
            seen.append(got)
        assert imp["people_total"] in seen, "the counter reaches the server total"
        half = len(positions)
        assert seen[:half] == sorted(seen[:half]) and seen[half:] == sorted(seen[half:], reverse=True)


def test_outage_relay_reduced_motion_static_list(browser, app_url):
    t = tag("rm")
    major, array, imp = _relay_major(app_url, t)
    with browse(browser, app_url, "oona", f"/desk/major/{major}", reduced_motion="reduce") as page:
        expect(page.get_by_role("heading", level=1, name=array)).to_be_visible(timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(f"{imp['people_total']} people affected by {array}.", timeout=UI_MS)
        text = page.evaluate("() => document.body.textContent")
        idx = [text.find(a["ci"]["name"]) for a in imp["affected"]]
        assert all(i >= 0 for i in idx) and idx == sorted(idx), idx
        page.evaluate("() => window.scrollTo(0, document.scrollingElement.scrollHeight)")
        assert page.evaluate("() => document.getAnimations().length") == 0
        assert str(imp["people_total"]) in page.get_by_role("group", name="Affected people").inner_text()


def test_problem_workaround_and_closure_rules(browser, app_url):
    t = tag("pb")
    tech = make_user(app_url, ["technician"])
    oona = as_user(app_url, "oona")
    fixtures(app_url, {"cis": [ci(f"{t} plotter", "Application", 1)]})
    i1 = make_record(app_url, "incident", {"short_description": t, "assigned_to": tech["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"}, state="assigned")
    i2 = make_record(app_url, "incident", {"short_description": t, "assigned_to": "oona", "impact": 3, "urgency": 3, "assignment_group": "Triage"}, state="assigned")
    p = make_record(app_url, "problem", {"short_description": t}, state="assessing")
    assert oona.post(f"/api/records/{p}/incidents", json={"numbers": [i1, i2]}).status_code == 200
    assert_error(move(oona, p, "known_error"), 422, "field_required")
    with browse(browser, app_url, tech["username"], f"/desk/records/{i1}") as page:
        expect(page.get_by_role("form", name=i1)).to_be_visible(timeout=LOAD_MS)
        assert oona.post(f"/api/records/{p}/workaround", json={"text": f"Feed sheets by hand {t}"}).status_code == 200
        expect(page.get_by_role("region", name=f"Workaround from {p}")).to_contain_text(f"Feed sheets by hand {t}", timeout=UI_MS)
    assert record(oona, i2)["workaround"] == {"problem": p, "text": f"Feed sheets by hand {t}"}
    assert inbox_count(as_user(app_url, tech["username"]), f"A workaround was published on {p} for {i1}.") == 1
    move_ok(oona, p, "known_error")
    fix = make_record(app_url, "change", {"title": t, "model": "normal", "configuration_item": f"{t} plotter"}, state="implementing")
    move_ok(oona, p, "fix_in_progress", fix_change=fix)
    assert_error(move(oona, p, "resolved"), 422, "fix_not_done", f"The fix change {fix} is not done yet.")
    move_ok(oona, fix, "done", outcome="successful", close_note="Patched")
    poll(lambda: record(oona, p)["state"] == "resolved", API_WAIT_S, "problem resolves when its fix change is done")
    assert f"Resolved by fix change {fix}." in activity_texts(oona, p)
    assert_error(move(oona, p, "closed"), 422, "open_incidents", "Resolve or close the 2 linked open incidents before closing this problem.")
    for i in (i1, i2):
        move_ok(oona, i, "cancelled", cancel_reason="Covered by fix")
    assert move_ok(oona, p, "closed")["state"] == "closed"


def test_wf_major_incident_promote_resolve(browser, app_url):
    t = tag("mw")
    names = _map_items(app_url, t)
    kids = [make_record(app_url, "incident", {"short_description": t, "configuration_item": names[k], "impact": 3, "urgency": 3, "assignment_group": "Triage"}) for k in ("svc1", "svc2")]
    oona = as_user(app_url, "oona")
    oona.post(f"/api/cis/{q(names['array'])}/status", json={"status": "down"})
    prop = _proposal_for(oona, names["array"])
    major = oona.post(f"/api/major-proposals/{prop['id']}/promote").json()["record"]["number"]
    move_ok(oona, major, "assigned", assigned_to="oona")
    move_ok(oona, major, "in_progress")
    with browse(browser, app_url, "oona", f"/desk/major/{major}") as page:
        page.get_by_role("button", name="Resolve together").click(timeout=LOAD_MS)
        dlg = page.get_by_role("dialog", name="Resolve together")
        pick(dlg.get_by_role("combobox", name="Resolution code"), "fixed")
        dlg.get_by_role("textbox", name="Resolution note").fill("Controller replaced")
        dlg.get_by_role("button", name="Resolve").click()
        expect(announcer(page)).to_have_text(f"{major} moved to Resolved.", timeout=UI_MS)
        children = page.get_by_role("list", name="Child incidents")
        for k in kids:
            expect(children.get_by_role("listitem").filter(has_text=k)).to_contain_text("Resolved", timeout=UI_MS)
        move_ok(oona, kids[0], "in_progress", reopen_reason="Slow again")
        expect(children.get_by_role("listitem").filter(has_text=kids[0])).to_contain_text("In progress", timeout=UI_MS)
    assert record(oona, major)["state"] == "resolved" and record(oona, kids[1])["state"] == "resolved"


def test_wf_major_incident_shared_timeline_live(browser, app_url):
    t = tag("mt")
    names = _map_items(app_url, t)
    manager = make_user(app_url, ["manager"], "Leadership")
    child = make_record(app_url, "incident", {"short_description": t, "configuration_item": names["svc1"], "assigned_to": "oona", "impact": 3, "urgency": 3, "assignment_group": "Triage"}, state="assigned")
    oona = as_user(app_url, "oona")
    oona.post(f"/api/cis/{q(names['array'])}/status", json={"status": "down"})
    major = oona.post(f"/api/major-proposals/{_proposal_for(oona, names['array'])['id']}/promote").json()["record"]["number"]
    p = make_record(app_url, "problem", {"short_description": t}, state="assessing")
    oona.post(f"/api/records/{p}/incidents", json={"numbers": [child]})
    with browse(browser, app_url, "oona", f"/desk/major/{major}") as po, browse(browser, app_url, manager["username"], f"/desk/major/{major}") as pm, \
            browse(browser, app_url, "oona", f"/desk/records/{child}") as pc:
        expect(pm.get_by_role("feed", name="Timeline")).to_be_visible(timeout=LOAD_MS)
        assert oona.post(f"/api/records/{major}/work-notes", json={"text": f"Vendor on site {t}"}).status_code == 201
        expect(pm.get_by_role("feed", name="Timeline")).to_contain_text(f"Vendor on site {t}", timeout=UI_MS)
        expect(po.get_by_role("feed", name="Timeline")).to_contain_text(f"Vendor on site {t}", timeout=UI_MS)
        oona.post(f"/api/records/{p}/workaround", json={"text": f"Use the spare {t}"})
        expect(pc.get_by_role("region", name=f"Workaround from {p}")).to_contain_text(f"Use the spare {t}", timeout=UI_MS)
    assert record(oona, child)["workaround"]["text"] == f"Use the spare {t}"


def test_change_risk_score_band_and_routing(app_url):
    t = tag("rk")
    oona = as_user(app_url, "oona")
    fin = department_size(oona, "Finance")
    fixtures(app_url, {"cis": [ci(f"{t} low", "Application", 1, owner="Finance"), ci(f"{t} mod", "Application", 2, owner="Finance"),
                               ci(f"{t} high", "Application", 3, owner="Finance"),
                               ci(f"{t} ledger", "Business service", 3, owner="Finance", used_by={"departments": ["Finance"], "people": []})],
                       "relationships": [rel(f"{t} ledger", "depends on", f"{t} high")]})
    for when, pe in (("in", "2027-01-20T12:00:00+01:00"), ("out", "2026-10-01T12:00:00+02:00")):
        make_record(app_url, "change", {"title": f"{t} failed {when}", "model": "normal", "configuration_item": f"{t} high", "outcome": "failed",
                                        "planned_start": pe, "planned_end": pe}, state="done")
    band = people_band(fin)
    cases = [
        (f"{t} low", "2027-02-13T10:00:00+01:00", "2027-02-13T14:00:00+01:00", True, 3, "Low", 4, ["Department sign-off"]),
        (f"{t} mod", "2027-02-13T10:00:00+01:00", "2027-02-13T16:00:00+01:00", False, 12, "Moderate", 3, ["Department sign-off", "Change board"]),
        (f"{t} high", "2027-02-17T10:00:00+01:00", "2027-02-17T15:00:00+01:00", False, 20 + 2 * band, "High", 2, ["Department sign-off", "Change board"]),
    ]
    for item, start, end, tested, score, band_name, pri, steps in cases:
        n = new_change(oona, item, start, end, f"{t} {band_name}", backout_tested=tested)
        assert value(record(oona, n), "priority") == 5
        move_ok(oona, n, "assessed")
        risk = oona.get(f"/api/records/{n}/risk").json()
        assert (risk["score"], risk["band"]) == (score, band_name), risk
        assert value(record(oona, n), "priority") == pri
        if band_name == "High":
            i = risk["inputs"]
            assert i["failed_changes_90d"] == 1 and i["in_business_hours"] is True and i["people_total"] == fin and i["people_band"] == band and i["criticality"] == 3
        move_ok(oona, n, "peer_review")
        assert [s["name"] for s in steps_of(oona, n)] == steps


def test_change_models_follow_their_tables(app_url):
    t = tag("md")
    oona = as_user(app_url, "oona")
    fixtures(app_url, {"cis": [ci(f"{t} a", "Application", 1, owner="Finance"), ci(f"{t} b", "Application", 1, owner="Finance")]})
    std = new_change(oona, f"{t} a", "2027-02-20T10:00:00+01:00", "2027-02-20T11:00:00+01:00", f"{t} std", model="standard")
    assert_error(move(oona, std, "approved"), 422, "field_required", "Standard template is required to move to Approved.")
    assert move_ok(oona, std, "approved", standard_template="Monthly patch")["state"] == "approved"
    em = new_change(oona, f"{t} b", "2027-02-20T10:00:00+01:00", "2027-02-20T11:00:00+01:00", f"{t} em", model="emergency")
    rec = move_ok(oona, em, "board_vote")
    assert value(rec, "priority") == 1 and [s["name"] for s in steps_of(oona, em)] == ["Emergency board"]


def test_freeze_and_overlap_refusals(app_url):
    t = tag("fz")

    def N(s: str) -> str:
        return f"{t} {s}"

    freeze = f"Freeze {t}"
    fixtures(app_url, {"cis": [ci(N("app"), "Application", 1, owner="Finance"), ci(N("svc"), "Business service", 1, owner="Finance", used_by={"departments": [], "people": []}),
                               ci(N("app2"), "Application", 1, owner="Finance"), ci(N("svc2"), "Business service", 1, owner="Finance", used_by={"departments": [], "people": []})],
                       "relationships": [rel(N("svc"), "depends on", N("app")), rel(N("svc2"), "depends on", N("app2"))],
                       "freeze_windows": [{"name": freeze, "start": "2027-05-10T00:00:00+02:00", "end": "2027-05-12T00:00:00+02:00", "time_zone": "Europe/Berlin", "scope": {"items": [N("svc")]}}]})
    oona = as_user(app_url, "oona")
    c1 = new_change(oona, N("app"), "2027-05-11T10:00:00+02:00", "2027-05-11T12:00:00+02:00", f"{t} in freeze")
    assert_error(move(oona, c1, "assessed"), 422, "freeze", f'This change falls inside the freeze "{freeze}" (2027-05-10 00:00 to 2027-05-12 00:00).')
    assert record(oona, c1)["state"] == "draft"
    c2 = new_change(oona, N("app"), "2027-05-12T00:00:00+02:00", "2027-05-12T02:00:00+02:00", f"{t} after freeze")
    move_ok(oona, c2, "assessed")
    em = new_change(oona, N("svc"), "2027-05-11T13:00:00+02:00", "2027-05-11T14:00:00+02:00", f"{t} emergency", model="emergency")
    assert move(oona, em, "board_vote").status_code == 422
    move_ok(oona, em, "board_vote", freeze_override_reason="Outage fix")
    w = ("2027-06-02T10:00:00+02:00", "2027-06-02T12:00:00+02:00", "(2027-06-02 10:00 to 2027-06-02 12:00)")
    x = new_change(oona, N("app"), w[0], w[1], f"{t} x")
    move_ok(oona, x, "assessed")
    y = new_change(oona, N("app"), w[0], w[1], f"{t} y")
    assert_error(move(oona, y, "assessed"), 422, "overlap", f"This change overlaps {x} on {N('app')} {w[2]}.")
    z = new_change(oona, N("svc"), w[0], w[1], f"{t} z")
    assert_error(move(oona, z, "assessed"), 422, "overlap", f"This change overlaps {x} on {N('app')}, which {N('svc')} depends on {w[2]}.")
    v = new_change(oona, N("svc2"), w[0], w[1], f"{t} v")
    move_ok(oona, v, "assessed")
    u = new_change(oona, N("app2"), w[0], w[1], f"{t} u")
    assert_error(move(oona, u, "assessed"), 422, "overlap", f"This change overlaps {v} on {N('svc2')}, which depends on {N('app2')} {w[2]}.")
    new_change(oona, N("app"), "2027-06-09T10:00:00+02:00", "2027-06-09T12:00:00+02:00", f"{t} draft only")
    ok = new_change(oona, N("app"), "2027-06-09T10:00:00+02:00", "2027-06-09T12:00:00+02:00", f"{t} free")
    move_ok(oona, ok, "assessed")


def _peer_review_change(app_url: str, t: str, crit: int = 1, tested: bool = True, start: str = "2027-07-03T10:00:00+02:00", end: str = "2027-07-03T12:00:00+02:00") -> str:
    name = f"{t} item"
    fixtures(app_url, {"cis": [ci(name, "Application", crit, owner="Finance")]})
    oona = as_user(app_url, "oona")
    n = new_change(oona, name, start, end, f"{t} change", backout_tested=tested)
    move_ok(oona, n, "assessed")
    move_ok(oona, n, "peer_review")
    return n


def test_locked_field_resets_approval_live(browser, app_url):
    t = tag("lk")
    voter = make_user(app_url, ["approver"], "Finance")
    oona = as_user(app_url, "oona")
    n = _peer_review_change(app_url, t)
    assert vote(as_user(app_url, voter["username"]), n, 1, "approve").status_code == 201
    assert record(oona, n)["state"] == "approved"
    assert patch(oona, n, planned_end="2027-07-03T13:00:00+02:00").status_code == 200
    rec = record(oona, n)
    assert rec["state"] == "assessed"
    st = steps_of(oona, n)[0]
    assert st["status"] == "not_started" and all(v["decision"] is None for v in st["voters"])
    assert f"Approval reset because {label_of('planned_end')} changed." in activity_texts(oona, n)
    assert inbox_count(as_user(app_url, voter["username"]), f"Approval on {n} was reset: {label_of('planned_end')} changed.") == 1
    m = _peer_review_change(app_url, f"{t}b")
    with browse(browser, app_url, voter["username"], "/approve") as page:
        card = page.get_by_role("article", name=f"{m}: {t}b change")
        expect(card).to_be_visible(timeout=LOAD_MS)
        assert patch(oona, m, implementation_plan="Apply in two steps").status_code == 200
        expect(card).to_have_count(0, timeout=UI_MS)
        expect(announcer(page)).to_have_text(f"{m} changed and needs a new vote.", timeout=UI_MS)


WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _cell_date(name: str) -> date:
    m = re.match(r"(\w+), (\d+) (\w+) (\d{4}), \d+ changes?", name)
    assert m, f"gridcell name follows the published pattern: {name!r}"
    d = date(int(m.group(4)), MONTHS.index(m.group(3)) + 1, int(m.group(2)))
    assert WEEKDAYS[d.weekday()] == m.group(1)
    return d


def _month_shift(d: date, months: int) -> date:
    y, mth = divmod(d.month - 1 + months, 12)
    y += d.year
    last = (date(y + (mth + 1) // 12, (mth + 1) % 12 + 1, 1) - timedelta(days=1)).day
    return date(y, mth + 1, min(d.day, last))


def test_change_calendar_keyboard(browser, app_url):
    set_clock(app_url, "2027-03-17T12:00:00+01:00")
    with browse(browser, app_url, "oona", "/desk/changes/calendar") as page:
        grid = page.get_by_role("grid", name="Change calendar")
        expect(grid).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the change calendar")

        def focused() -> date:
            return _cell_date(page.evaluate("""() => {
              const e = document.activeElement;
              if (!e) return '';
              const l = e.getAttribute('aria-label');
              if (l) return l;
              const ids = e.getAttribute('aria-labelledby');
              if (ids) return ids.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
              return (e.textContent || '').trim();
            }"""))

        d = focused()
        for key, delta in (("ArrowRight", 1), ("ArrowLeft", -1), ("ArrowDown", 7), ("ArrowUp", -7)):
            page.keyboard.press(key)
            d = d + timedelta(days=delta)
            assert focused() == d, key
        page.keyboard.press("Home")
        assert focused() == d - timedelta(days=d.weekday())
        page.keyboard.press("End")
        d = d - timedelta(days=d.weekday()) + timedelta(days=6)
        assert focused() == d
        page.keyboard.press("PageDown")
        d = _month_shift(d, 1)
        assert focused() == d
        page.keyboard.press("PageUp")
        d = _month_shift(d, -1)
        assert focused() == d
        for _ in range(12):
            if d.month == 1:
                break
            page.keyboard.press("PageDown")
            d = _month_shift(d, 1)
        for _ in range(40):
            if d.day == 31:
                break
            page.keyboard.press("ArrowRight")
            d = d + timedelta(days=1)
        assert focused() == d and d.day == 31
        page.keyboard.press("PageDown")
        assert focused() == _month_shift(d, 1) and focused().month == 2
        d = focused()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=f"Changes on {d.day} {MONTHS[d.month - 1]} {d.year}")
        expect(dlg).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0, timeout=UI_MS)
        assert focused() == d


def test_wf_change_risk_draft_to_approval(browser, app_url):
    t = tag("cj")
    approver = make_user(app_url, ["approver"], "Finance")
    fixtures(app_url, {"cis": [ci(f"{t} item", "Application", 1, owner="Finance")],
                       "freeze_windows": [{"name": f"Freeze {t}", "start": "2027-08-09T00:00:00+02:00", "end": "2027-08-10T00:00:00+02:00", "time_zone": "Europe/Berlin", "scope": {"items": [f"{t} item"]}}]})
    oona = as_user(app_url, "oona")
    n = new_change(oona, f"{t} item", "2027-08-11T10:00:00+02:00", "2027-08-11T12:00:00+02:00", f"{t} patch", backout_tested=True)
    frozen = new_change(oona, f"{t} item", "2027-08-09T10:00:00+02:00", "2027-08-09T12:00:00+02:00", f"{t} frozen", backout_tested=True)
    with browse(browser, app_url, "oona", f"/desk/records/{frozen}") as page:
        b = page.get_by_role("button", name="Move to Assessed")
        b.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_text(f'This change falls inside the freeze "Freeze {t}" (2027-08-09 00:00 to 2027-08-10 00:00).', exact=True)).to_be_visible(timeout=UI_MS)
        page.goto(base(app_url) + f"/desk/records/{n}")
        b = page.get_by_role("button", name="Move to Assessed")
        b.focus()
        page.keyboard.press("Enter")
        expect(announcer(page)).to_have_text(f"{n} moved to Assessed.", timeout=UI_MS)
        expect(page.get_by_role("region", name="Risk")).to_have_text(re.compile(r"Risk 5, Low"), timeout=UI_MS)
        b = page.get_by_role("button", name=move_label("Peer review"))
        b.focus()
        page.keyboard.press("Enter")
        expect(announcer(page)).to_have_text(f"{n} moved to Peer review.", timeout=UI_MS)
    with browse(browser, app_url, approver["username"], "/approve") as page:
        card = page.get_by_role("article", name=f"{n}: {t} patch")
        card.get_by_role("button", name="Approve").click(timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(f"Vote recorded: approve on {n}.", timeout=UI_MS)
    assert record(oona, n)["state"] == "approved"
    day = [d for d in oona.get("/api/changes/calendar", params={"month": "2027-08"}).json()["days"] if d["date"] == "2027-08-11"][0]
    assert n in [c["number"] for c in day["changes"]] and frozen not in [c["number"] for c in day["changes"]]


def test_wf_change_risk_locked_reset_watched(browser, app_url):
    t = tag("cw")
    approver = make_user(app_url, ["approver"], "Finance")
    n = _peer_review_change(app_url, t)
    oona = as_user(app_url, "oona")
    with browse(browser, app_url, approver["username"], f"/desk/records/{n}") as page:
        group = page.get_by_role("region", name="Approvals").get_by_role("group", name="Department sign-off")
        expect(group.get_by_role("button", name="Approve")).to_be_visible(timeout=LOAD_MS)
        assert patch(oona, n, implementation_plan="Phase it").status_code == 200
        expect(page.get_by_role("region", name="Activity")).to_contain_text(f"Approval reset because {label_of('implementation_plan')} changed.", timeout=UI_MS)
        expect(group.get_by_role("button", name="Approve")).to_have_count(0, timeout=UI_MS)
    assert record(oona, n)["state"] == "assessed"


def test_wf_change_risk_operator_only(browser, app_url):
    t = tag("co")
    approver = make_user(app_url, ["approver"], "Finance")
    n = _peer_review_change(app_url, t)
    ac, oona = as_user(app_url, approver["username"]), as_user(app_url, "oona")
    r = ac.post(f"/api/records/{n}/steps/1/close")
    assert r.status_code == 403 and r.json() == OPERATOR_ONLY
    fixtures(app_url, {"cis": [ci(f"{t} other", "Application", 1, owner="Finance")]})
    m = new_change(oona, f"{t} other", "2027-08-07T10:00:00+02:00", "2027-08-07T12:00:00+02:00", f"{t} second")
    move_ok(oona, m, "assessed")
    refused = move(ac, m, "peer_review")
    assert refused.status_code in (403, 422), refused.text[:300]
    assert refused.json()["error"]["code"] in ("role_not_allowed", "denied", "forbidden"), refused.text[:300]
    assert record(oona, m)["state"] == "assessed"
    assert record(oona, n)["state"] == "peer_review" and steps_of(oona, n)[0]["status"] == "open"
    with browse(browser, app_url, approver["username"], f"/desk/records/{n}") as page:
        expect(page.get_by_role("region", name="Approvals")).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("button", name="Close vote")).to_have_count(0)


CHANGE_BOARD_SEED = {"name": "Change board", "rule": "weighted", "n": None, "threshold_percent": 60, "window_hours": 48,
                     "members": [{"username": "ana", "weight": 2}, {"username": "dev", "weight": 1}, {"username": "jonas", "weight": 1}]}


def _board_change(app_url: str, t: str, start: str) -> str:
    n = _peer_review_change(app_url, t, crit=2, tested=False, start=start, end=(parse_instant(start) + timedelta(hours=6)).isoformat())
    assert vote(as_user(app_url, "ana"), n, 1, "approve").status_code == 201
    assert record(as_user(app_url, "oona"), n)["state"] == "board_vote"
    return n


def test_quorum_delegates_late_and_repeated_votes(app_url):
    set_clock(app_url, "2027-06-14T10:00:00+02:00")
    t = tag("qr")
    delegate = make_user(app_url, ["approver"], "Studio Operations")
    outsider = make_user(app_url, ["approver"], "Leadership")
    fixtures(app_url, {"delegations": [{"member": "jonas", "delegate": delegate["username"], "from": "2027-06-14T00:00:00+02:00", "to": "2027-06-15T00:00:00+02:00"}]})
    ana, dev, jonas = (as_user(app_url, u) for u in ("ana", "dev", "jonas"))
    dc, oc, oona = as_user(app_url, delegate["username"]), as_user(app_url, outsider["username"]), as_user(app_url, "oona")
    a = _board_change(app_url, f"{t}a", "2027-06-19T10:00:00+02:00")
    r = vote(ana, a, 2, "approve")
    assert r.status_code == 201
    tally = r.json()["step"]["tally"]
    assert (tally["approve_weight"], tally["total_weight"], tally["needed"]) == (2, 4, 3)
    assert_error(vote(ana, a, 2, "approve"), 409, "already_voted", "Ana Feld has already voted on this step.")
    assert_error(vote(oc, a, 2, "approve"), 403, "not_a_voter", "You are not a voter on this step.")
    r = vote(dc, a, 2, "approve", on_behalf_of="jonas")
    assert r.status_code == 201 and r.json()["vote"]["voter"] == "jonas" and r.json()["vote"]["voted_by"] == delegate["username"]
    assert r.json()["step"]["status"] == "approved" and record(oona, a)["state"] == "approved"
    e = assert_error(vote(dev, a, 2, "approve"), 409, "vote_closed")
    assert re.fullmatch(r"This vote closed at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\.", e["message"]), e
    b = _board_change(app_url, f"{t}b", "2027-06-20T10:00:00+02:00")
    assert vote(dc, b, 2, "approve", on_behalf_of="jonas").status_code == 201
    assert_error(vote(jonas, b, 2, "approve"), 409, "already_voted", "Jonas Brandt has already voted on this step.")
    assert vote(ana, b, 2, "reject").json()["step"]["status"] == "rejected"
    assert record(oona, b)["state"] == "rejected"
    move_ok(oona, b, "assessed")
    move_ok(oona, b, "peer_review")
    st = steps_of(oona, b)
    assert st[0]["status"] == "approved" and st[1]["status"] == "open"
    c = _peer_review_change(app_url, f"{t}c", crit=2, tested=False, start="2027-06-21T10:00:00+02:00", end="2027-06-21T16:00:00+02:00")
    for v in steps_of(oona, c)[0]["voters"]:
        vote(as_user(app_url, v["username"]), c, 1, "reject")
    st = steps_of(oona, c)
    assert record(oona, c)["state"] == "rejected" and st[0]["status"] == "rejected" and st[1]["status"] == "not_started"
    d = _board_change(app_url, f"{t}d", "2027-06-22T10:00:00+02:00")
    vote(ana, d, 2, "approve")
    assert oona.post(f"/api/records/{d}/steps/2/close").json()["step"]["status"] == "rejected"
    try:
        assert oona.put("/api/boards/Change board", json=dict(CHANGE_BOARD_SEED, rule="n_of_m", n=2, threshold_percent=None)).status_code == 200
        e2 = _board_change(app_url, f"{t}e", "2027-06-23T10:00:00+02:00")
        vote(dev, e2, 2, "approve")
        r = vote(jonas, e2, 2, "reject")
        assert r.json()["step"]["status"] == "open" and (r.json()["step"]["tally"]["needed"], r.json()["step"]["tally"]["of"]) == (2, 3)
        assert vote(ana, e2, 2, "approve").json()["step"]["status"] == "approved"
    finally:
        oona.put("/api/boards/Change board", json=CHANGE_BOARD_SEED)
    fixtures(app_url, {"cis": [ci(f"{t} em", "Application", 1, owner="Finance")]})
    em = new_change(oona, f"{t} em", "2027-06-24T10:00:00+02:00", "2027-06-24T11:00:00+02:00", f"{t} em", model="emergency")
    move_ok(oona, em, "board_vote")
    advance_clock(app_url, HOUR + 100)
    assert steps_of(oona, em)[0]["status"] == "rejected"
    assert "Vote closed without reaching quorum." in activity_texts(oona, em)
    assert_error(vote(ana, em, 1, "approve"), 409, "vote_closed")


OPERATOR_ONLY_IDS = ["workspace", "impersonate", "audit-log", "business-rule", "access-rule", "user", "ci", "inbox-rules", "config-set",
                     "publish-workflow", "commit-set", "backout-set", "close-vote", "priority-override", "import"]


@pytest.mark.parametrize("endpoint", OPERATOR_ONLY_IDS, ids=OPERATOR_ONLY_IDS)
def test_operator_only_endpoints_refuse_other_roles(app_url, endpoint):
    t = tag("oo")
    oona = as_user(app_url, "oona")
    approver = make_user(app_url, ["approver"], "Finance")
    calls: dict[str, Callable[[httpx.Client], httpx.Response]] = {
        "workspace": lambda c: c.put("/api/session/workspace", json={"workspace": "test"}),
        "impersonate": lambda c: c.post("/api/impersonate", json={"username": "ruth"}),
        "audit-log": lambda c: c.get("/api/audit-log"),
        "business-rule": lambda c: c.post("/api/business-rules", json={"name": f"Rule {t}", "table": "incident", "when": "before", "order": 100, "operations": ["insert"], "condition": "true", "actions": [], "active": False}),
        "access-rule": lambda c: c.post("/api/access-rules", json={"name": f"Rule {t}", "type": "table", "table": "incident", "field": None, "operation": "write", "roles": ["requester"], "condition": None, "active": False}),
        "user": lambda c: c.post("/api/users", json={"username": t, "password": f"{t}{PASSWORD_SUFFIX}", "display_name": t, "roles": ["requester"], "department": "Finance", "time_zone": "Europe/Berlin"}),
        "ci": lambda c: c.post("/api/cis", json=ci(f"{t} x", "Application", 1)),
        "inbox-rules": lambda c: c.put("/api/inbox-rules", json={"rules": []}),
        "config-set": lambda c: c.post("/api/config-sets", json={"name": t}),
        "import": lambda c: c.post("/api/imports", data={"table": "people"}, files={"file": ("p.csv", b"#switchyard-import v1 people\nusername,display_name\n", "text/csv")}),
    }
    if endpoint == "publish-workflow":
        wid = oona.post("/api/workflows", json={"name": f"Flow {t}", "kind": "flow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
        calls[endpoint] = lambda c: c.post(f"/api/workflows/{wid}/publish")
    if endpoint in ("commit-set", "backout-set"):
        op2 = make_user(app_url, ["operator"])
        opc = as_user(app_url, op2["username"])
        sid = opc.post("/api/config-sets", json={"name": t}).json()["set"]["id"]
        calls[endpoint] = (lambda c: c.post(f"/api/config-sets/{sid}/commit", json={"choices": {}})) if endpoint == "commit-set" else (lambda c: c.post(f"/api/config-sets/{sid}/backout"))
    if endpoint == "close-vote":
        n = _peer_review_change(app_url, t)
        calls[endpoint] = lambda c: c.post(f"/api/records/{n}/steps/1/close")
    if endpoint == "priority-override":
        n = make_record(app_url, "incident", {"short_description": t, "caller": approver["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"})
        calls[endpoint] = lambda c: c.post(f"/api/records/{n}/priority-override", json={"priority": 1, "reason": "x"})
    for who in ("teodor", approver["username"]):
        r = calls[endpoint](as_user(app_url, who))
        assert r.status_code == 403 and r.json() == OPERATOR_ONLY, (endpoint, who, r.status_code, r.text[:300])
    if endpoint == "business-rule":
        assert find_named(oona.get("/api/business-rules").json(), f"Rule {t}") is None
    if endpoint == "workspace":
        assert as_user(app_url, "teodor").get("/api/session").json()["workspace"] == "live"
    if endpoint == "close-vote":
        assert steps_of(oona, n)[0]["status"] == "open"
    if endpoint in ("commit-set", "backout-set"):
        assert opc.post(f"/api/config-sets/{sid}/export").status_code == 201
        assert opc.post(f"/api/config-sets/{sid}/commit", json={"choices": {}}).status_code == 200


def test_phone_vote_swipes_undo_and_long_press(browser, app_url):
    t = tag("vg")
    voter = make_user(app_url, ["approver"], "Finance")
    a = _peer_review_change(app_url, f"{t}a", start="2027-07-05T10:00:00+02:00", end="2027-07-05T11:00:00+02:00")
    b = _peer_review_change(app_url, f"{t}b", start="2027-07-06T10:00:00+02:00", end="2027-07-06T11:00:00+02:00")
    c = _peer_review_change(app_url, f"{t}c", start="2027-07-07T10:00:00+02:00", end="2027-07-07T11:00:00+02:00")
    oona = as_user(app_url, "oona")

    def decision(n: str) -> Any:
        return [v for v in steps_of(oona, n)[0]["voters"] if v["username"] == voter["username"]][0]["decision"]

    with browse(browser, app_url, voter["username"], "/approve", width=375, height=812, resume=False) as page:
        card = page.get_by_role("article", name=f"{a}: {t}a change")
        expect(card).to_be_visible(timeout=LOAD_MS)
        touch_swipe(page, card, SWIPE_DISTANCE - 46)
        page.clock.run_for(UNDO_MS + 1000)
        expect(card).to_be_visible()
        assert decision(a) is None, "a short swipe sends nothing"
        touch_swipe(page, card, SWIPE_DISTANCE + 40)
        expect(announcer(page)).to_have_text(f"Approving {a}. Undo within 5 seconds.", timeout=UI_MS)
        page.clock.run_for(UNDO_MS - 2000)
        page.get_by_role("button", name="Undo").click()
        expect(announcer(page)).to_have_text("Vote undone.", timeout=UI_MS)
        page.clock.run_for(UNDO_MS + 1000)
        assert decision(a) is None
        touch_swipe(page, card, SWIPE_DISTANCE + 40)
        page.clock.run_for(UNDO_MS + 200)
        expect(announcer(page)).to_have_text(f"Vote recorded: approve on {a}.", timeout=UI_MS)
        assert decision(a) == "approve"
        card_b = page.get_by_role("article", name=f"{b}: {t}b change")
        touch_hold(page, card_b, LONG_PRESS_MS - 200)
        expect(page.get_by_role("dialog", name="Vote actions")).to_have_count(0)
        touch_hold(page, card_b, LONG_PRESS_MS + 100)
        sheet = page.get_by_role("dialog", name="Vote actions")
        expect(sheet).to_be_visible(timeout=UI_MS)
        sheet.get_by_role("button", name="Reject").click()
        expect(announcer(page)).to_have_text(f"Vote recorded: reject on {b}.", timeout=UI_MS)
        card_c = page.get_by_role("article", name=f"{c}: {t}c change")
        touch_swipe(page, card_c, -(SWIPE_DISTANCE + 40))
        expect(announcer(page)).to_have_text(f"Rejecting {c}. Undo within 5 seconds.", timeout=UI_MS)
        page.clock.run_for(UNDO_MS + 200)
    assert decision(b) == "reject"
    poll(lambda: decision(c) == "reject", API_WAIT_S, "the left swipe was sent as a reject after the Undo period")


def test_inbox_events_rules_digest_and_unread(app_url):
    set_clock(app_url, "2027-07-10T10:00:00+02:00")
    t = tag("ib")
    u = make_user(app_url, ["technician"])
    uc, oona = as_user(app_url, u["username"]), as_user(app_url, "oona")
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert patch(oona, n, assigned_to=u["username"]).status_code == 200
    assert inbox_count(uc, f"{n} was assigned to you.") == 1
    oona.post(f"/api/records/{n}/work-notes", json={"text": f"Over to @{u['username']}"})
    assert inbox_count(uc, f"Oona Petrakis mentioned you on {n}.") == 1
    raw_rules = oona.get("/api/inbox-rules").json()
    original = raw_rules["rules"] if isinstance(raw_rules, dict) and "rules" in raw_rules else raw_rules
    roles = ["operator", "requester", "approver", "manager"]
    try:
        rules = [r for r in original if r["event"] != "mentioned"] + [{"event": "mentioned", "roles": roles, "enabled": True}, {"event": "mentioned", "roles": ["technician"], "enabled": False}]
        assert oona.put("/api/inbox-rules", json={"rules": rules}).status_code == 200
        oona.post(f"/api/records/{n}/comments", json={"text": f"Again @{u['username']}"})
        assert inbox_count(uc, f"Oona Petrakis mentioned you on {n}.") == 1, "a disabled event delivers nothing to that role"
    finally:
        oona.put("/api/inbox-rules", json={"rules": original})
    unread = uc.get("/api/inbox").json()["unread"]
    item = inbox_items(uc)[0]
    assert uc.post(f"/api/inbox/{item['id']}/read").json()["unread"] == unread - 1
    assert uc.post("/api/inbox/read-all").json()["unread"] == 0
    assert uc.put("/api/inbox/settings", json={"digest": "daily"}).status_code == 200
    m1 = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    m2 = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    for m in (m1, m2):
        patch(oona, m, assigned_to=u["username"])
        assert inbox_count(uc, f"{m} was assigned to you.") == 0
    policy = f"Ladder {t}"
    fixtures(app_url, {"escalation_policies": [{"name": policy, "levels": [{"target": {"user": u["username"]}, "ack_minutes": 10}]}]})
    oona.post(f"/api/records/{m1}/page", json={"policy": policy})
    assert inbox_count(uc, f"Page for {m1}: please acknowledge.") == 1
    set_clock(app_url, "2027-07-11T08:00:30+02:00")
    assert inbox_count(uc, "Daily digest: 2 updates") == 1


def test_wf_change_board_live_tally(browser, app_url):
    set_clock(app_url, "2027-08-02T10:00:00+02:00")
    t = tag("bj")
    delegate = make_user(app_url, ["approver"], "Studio Operations")
    fixtures(app_url, {"delegations": [{"member": "jonas", "delegate": delegate["username"], "from": "2027-08-02T00:00:00+02:00", "to": "2027-08-03T00:00:00+02:00"}]})
    n = _board_change(app_url, t, "2027-08-14T10:00:00+02:00")
    with browse(browser, app_url, "ana", f"/desk/records/{n}") as pa, browse(browser, app_url, "dev", f"/desk/records/{n}") as pd:
        tally_d = pd.get_by_role("group", name="Change board").get_by_role("region", name="Tally")
        expect(tally_d).to_have_text(weight_tally(0, 0, 4, 3, 4), timeout=LOAD_MS)
        pa.get_by_role("group", name="Change board").get_by_role("button", name="Approve").click()
        expect(announcer(pa)).to_have_text(f"Vote recorded: approve on {n}.", timeout=UI_MS)
        expect(tally_d).to_have_text(weight_tally(2, 0, 2, 3, 4), timeout=UI_MS)
        vote(as_user(app_url, delegate["username"]), n, 2, "approve", on_behalf_of="jonas")
        expect(tally_d).to_contain_text("Closed: approved", timeout=UI_MS)
    oona = as_user(app_url, "oona")
    assert record(oona, n)["state"] == "approved"
    assert inbox_count(oona, f"{n} was approved at Change board.") == 1


def test_wf_change_board_rejection_resets(browser, app_url):
    t = tag("bk")
    n = _board_change(app_url, t, "2027-08-15T10:00:00+02:00")
    with browse(browser, app_url, "ana", f"/desk/records/{n}") as page:
        g = page.get_by_role("group", name="Change board")
        g.get_by_role("button", name="Reject").click(timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(f"Vote recorded: reject on {n}.", timeout=UI_MS)
        expect(g.get_by_role("region", name="Tally")).to_contain_text("Closed: rejected", timeout=UI_MS)
    oona = as_user(app_url, "oona")
    assert record(oona, n)["state"] == "rejected"
    assert inbox_count(oona, f"{n} was rejected at Change board.") == 1


def test_wf_change_board_window_closes_on_server(browser, app_url):
    t = tag("bw")
    voter = make_user(app_url, ["approver"], "Finance")
    set_clock(app_url, "2027-08-16T10:00:00+02:00")
    n = _peer_review_change(app_url, t, start="2027-08-20T10:00:00+02:00", end="2027-08-20T11:00:00+02:00")
    with browse(browser, app_url, voter["username"], "/approve", device_time=WRONG_DEVICE_TIME) as page:
        card = page.get_by_role("article", name=f"{n}: {t} change")
        expect(card).to_be_visible(timeout=LOAD_MS)
        advance_clock(app_url, 48 * HOUR + 60)
        expect(card).to_have_count(0, timeout=UI_MS)
    e = assert_error(vote(as_user(app_url, voter["username"]), n, 1, "approve"), 409, "vote_closed")
    assert e["message"].startswith("This vote closed at ")
    assert steps_of(as_user(app_url, "oona"), n)[0]["status"] == "rejected"


def _vars(c: httpx.Client, item: str) -> dict[str, dict]:
    return {v["name"]: v for v in c.get(f"/api/catalog/items/{item}").json()["item"]["variables"]}


def test_catalog_dependent_choices_and_order_guide(app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    c = as_user(app_url, u["username"])
    lv = _vars(c, "laptop")
    assert {"model", "memory", "justification"} <= set(lv) and lv["justification"]["label"] == "Why you need it"
    r = c.post("/api/cart/lines", json={"item": "laptop", "quantity": 1, "variables": {"model": "standard14", "memory": "64"}})
    e = assert_error(r, 422, "validation")
    assert e["fields"]["memory"] == f"{lv['memory']['label']} must be one of 16 GB."
    dv = _vars(c, "shared-drive")
    r = c.post("/api/cart/lines", json={"item": "shared-drive", "quantity": 1, "variables": {"drive": "archive", "access": "write"}})
    assert assert_error(r, 422, "validation")["fields"]["access"] == f"{dv['access']['label']} must be one of Read."
    assert c.post("/api/cart/lines", json={"item": "shared-drive", "quantity": 1, "variables": {"drive": "projects", "access": "write"}}).status_code == 201
    assert "office" in assert_error(c.post("/api/cart/lines", json={"item": "building-pass", "quantity": 1, "variables": {"start_date": "2027-01-11"}}), 422, "validation")["fields"]
    for role, items in (("architect", ["laptop", "software-licence", "shared-drive", "building-pass"]), ("finance", ["laptop", "shared-drive", "building-pass"])):
        assert c.post("/api/catalog/guides/new-starter/resolve", json={"answers": {"role": role}}).json()["items"] == items


def test_form_policies_server_and_browser(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    c = as_user(app_url, u["username"])
    r = c.post("/api/cart/lines", json={"item": "laptop", "quantity": 1, "variables": {"model": "studio16", "memory": "32"}})
    assert assert_error(r, 422, "validation")["fields"]["justification"] == "Why you need it is required."
    r = c.post("/api/cart/lines", json={"item": "laptop", "quantity": 1, "variables": {"model": "standard14", "memory": "16", "justification": "ignored"}})
    assert r.status_code == 201
    assert c.post("/api/cart/lines", json={"item": "software-licence", "quantity": 1, "variables": {"seat": "cad", "cost_centre": "Design Studio"}}).status_code == 201
    lv = _vars(c, "laptop")
    with browse(browser, app_url, u["username"], "/portal/items/laptop") as page:
        model = page.get_by_label(lv["model"]["label"])
        expect(model).to_be_visible(timeout=LOAD_MS)
        select(model, "Standard 14-inch")
        select(model, "Studio 16-inch")
        expect(page.get_by_label("Why you need it")).to_be_visible(timeout=POLICY_MS + UI_SLACK_MS)
        select(page.get_by_label(lv["memory"]["label"]), "32 GB")
        page.get_by_role("button", name="Add to cart").click()
        expect(page.get_by_text("Why you need it is required.", exact=True).first).to_be_visible(timeout=UI_MS)


def test_cart_checkout_and_idempotent_replay(app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    c = as_user(app_url, u["username"])
    assert c.post("/api/cart/lines", json={"item": "laptop", "quantity": 2, "variables": {"model": "standard14", "memory": "16"}}).status_code == 201
    assert c.post("/api/cart/lines", json={"item": "building-pass", "quantity": 1, "variables": {"office": "hafen", "start_date": "2027-02-01"}}).status_code == 201
    key = f"ck-{uuid.uuid4().hex}"
    r = c.post("/api/cart/checkout", json={"requested_for": None}, headers={"Idempotency-Key": key})
    assert r.status_code == 201, r.text
    req = r.json()["request"]
    assert re.fullmatch(r"ASK-\d{6}", req["number"]) and len(req["items"]) == 2
    assert all(re.fullmatch(r"ITM-\d{6}", i["number"]) for i in req["items"])
    assert c.get("/api/cart").json()["lines"] == []
    replay = c.post("/api/cart/checkout", json={"requested_for": None}, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.json() == r.json(), "a replay answers before the empty-cart check"
    assert_error(c.post("/api/cart/checkout", json={"requested_for": "ruth"}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict",
                 "This key was already used for a different request.")
    assert_error(c.post("/api/cart/checkout", json={"requested_for": None}), 422, "empty_cart", "Your cart is empty.")
    detail = poll(lambda: (lambda d: d if all(i["tasks"] for i in d["items"]) else None)(c.get(f"/api/requests/{req['number']}").json()["request"]),
                  API_WAIT_S, "each item's workflow created its task")
    assert detail["state"] == "open"
    assert all(re.fullmatch(r"JOB-\d{6}", i["tasks"][0]["number"]) for i in detail["items"])
    laptop = [i for i in req["items"] if i["item"] == "laptop"][0]["number"]
    rec = record(as_user(app_url, "oona"), laptop)
    assert value(rec, "quantity") == 2 and value(rec, "variables")["model"] == "standard14"


def test_wf_catalog_request_to_delivered(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    approver = make_user(app_url, ["approver"], "Design Studio")
    lv = _vars(as_user(app_url, u["username"]), "laptop")
    with browse(browser, app_url, u["username"], "/portal/items/laptop") as page:
        select(page.get_by_label(lv["model"]["label"]), "Studio 16-inch")
        select(page.get_by_label(lv["memory"]["label"]), "32 GB")
        page.get_by_label("Why you need it").fill("Rendering large models")
        page.get_by_role("button", name="Add to cart").click()
        cart_lines(as_user(app_url, u["username"]), 1)
        page.goto(base(app_url) + "/portal/cart")
        page.get_by_role("button", name="Submit request").click(timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(re.compile(r"^Request ASK-\d{6} submitted with 1 items\.$"), timeout=UI_MS)
        ask = re.search(r"ASK-\d{6}", announcer(page).inner_text()).group()
    uc = as_user(app_url, u["username"])
    itm = uc.get(f"/api/requests/{ask}").json()["request"]["items"][0]["number"]
    poll(lambda: uc.get(f"/api/requests/{ask}").json()["request"]["items"][0]["state"] == "awaiting_approval", API_WAIT_S, "item waits for approval")
    with browse(browser, app_url, u["username"], f"/portal/requests/{ask}") as portal, browse(browser, app_url, approver["username"], "/approve") as ap:
        status = portal.get_by_role("region", name="Request status")
        expect(status.get_by_role("listitem").filter(has_text=f"{itm} Laptop: Awaiting approval")).to_be_visible(timeout=LOAD_MS)
        ap.get_by_role("article", name=f"{itm}: Laptop").get_by_role("button", name="Approve").click(timeout=LOAD_MS)


def test_wf_catalog_request_policy_recovery(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    uc = as_user(app_url, u["username"])
    lv = _vars(uc, "laptop")
    with browse(browser, app_url, u["username"], "/portal/items/laptop") as page:
        select(page.get_by_label(lv["model"]["label"]), "Studio 16-inch")
        select(page.get_by_label(lv["memory"]["label"]), "64 GB")
        page.get_by_role("button", name="Add to cart").click()
        expect(page.get_by_text("Why you need it is required.", exact=True).first).to_be_visible(timeout=UI_MS)
        assert uc.get("/api/cart").json()["lines"] == []
        page.get_by_label("Why you need it").fill("Large renders")
        page.get_by_role("button", name="Add to cart").click()
        cart_lines(uc, 1)
    assert uc.get("/api/cart").json()["lines"][0]["variables"]["model"] == "studio16"


def test_wf_catalog_request_breakpoints(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    lv = _vars(as_user(app_url, u["username"]), "laptop")
    for width, height in ((375, 812), (768, 1024), (1280, 800)):
        with browse(browser, app_url, u["username"], "/portal/items/laptop", width=width, height=height) as page:
            boxes = [page.get_by_label(lv[k]["label"]).bounding_box() for k in ("model", "memory")]
            expect(page.get_by_role("button", name="Add to cart")).to_be_visible(timeout=LOAD_MS)
            assert abs(boxes[0]["x"] - boxes[1]["x"]) < 2 and boxes[0]["y"] < boxes[1]["y"]
            layout(page)
            page.goto(base(app_url) + "/portal/cart")
            expect(page.get_by_role("button", name="Submit request")).to_be_visible(timeout=LOAD_MS)
            layout(page)


def _flow(app_url: str, t: str, steps: list[dict]) -> Any:
    oona = as_user(app_url, "oona")
    wid = oona.post("/api/workflows", json={"name": f"Flow {t}", "kind": "flow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
    r = oona.put(f"/api/workflows/{wid}/draft", json={"steps": steps})
    assert r.status_code == 200, r.text
    return wid


def _trigger(t: str) -> dict:
    return {"id": "s0", "type": "trigger", "name": "Start", "on": "record_created", "table": "incident", "items": [], "condition": f'short_description startswith "{t}"', "on_error": []}


def test_designer_keyboard_add_move_delete(browser, app_url):
    t = tag("dz")
    wid = _flow(app_url, t, [_trigger(t),
                             {"id": "s1", "type": "set_fields", "name": TAG_STEP, "fields": {"description": '"x"'}, "on_error": []},
                             {"id": "s2", "type": "if", "name": "Urgent", "condition": "priority = 1", "then": [], "else": [], "on_error": []},
                             {"id": "s3", "type": "end", "name": "Finish", "on_error": []}])
    with browse(browser, app_url, "oona", f"/desk/workflows/{wid}") as page:
        tree = page.get_by_role("tree", name="Flow steps")

        def item(name: str) -> Locator:
            return tree.get_by_role("treeitem", name=name, exact=True)

        expect(item("Start, Trigger")).to_be_visible(timeout=LOAD_MS)
        tab_into(page, tree, "the flow tree")
        for _ in range(6):
            if is_focused(item("Start, Trigger")):
                break
            page.keyboard.press("ArrowUp")
        page.keyboard.press("Alt+ArrowDown")
        expect(announcer(page)).to_have_text("The trigger stays first.", timeout=UI_MS)
        page.keyboard.press("ArrowDown")
        assert is_focused(item(f"{TAG_STEP}, Set fields"))
        page.keyboard.press("Insert")
        dlg = page.get_by_role("dialog", name="Add step")
        select(dlg.get_by_role("combobox", name="Step type"), "Notify")
        dlg.get_by_role("textbox", name="Step name").fill(f"Tell {t}")
        dlg.get_by_role("button", name="Add step").click()
        new = item(f"Tell {t}, Notify")
        expect(new).to_be_focused(timeout=UI_MS)
        page.evaluate(ANIM_RECORDER)
        page.keyboard.press("Alt+ArrowDown")
        expect(new).to_be_focused()
        assert STEP_MOVE_MS in [round(d) for d in durations_on(new)]
        urgent_y = tree.get_by_role("treeitem", name=re.compile(r"^Urgent, ")).first.bounding_box()["y"]
        assert urgent_y < new.bounding_box()["y"], "the moved step now sits below Urgent"
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        assert is_focused(tree.get_by_role("treeitem", name="Yes", exact=True).first)
        page.keyboard.press("ArrowLeft")
        assert is_focused(item("Urgent, If"))
        item(f"{TAG_STEP}, Set fields").focus()
        page.keyboard.press("Delete")
        page.get_by_role("dialog", name="Delete step").get_by_role("button", name="Delete").click()
        expect(item(f"{TAG_STEP}, Set fields")).to_have_count(0, timeout=UI_MS)
        assert is_focused(item("Start, Trigger"))
        item(f"Tell {t}, Notify").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("dialog", name=f"Edit step Tell {t}")).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Publish").click()
        expect(announcer(page)).to_have_text("Version 1 published.", timeout=UI_MS)
    wf = find_named(as_user(app_url, "oona").get("/api/workflows").json(), f"Flow {t}")
    order = [s["name"] for s in wf["draft"]]
    assert order[0] == "Start" and TAG_STEP not in order and order.index("Urgent") < order.index(f"Tell {t}")
    assert 1 in wf["versions"]


def _run(oona: httpx.Client, run_id: Any, done: Callable[[dict], bool]) -> dict:
    return poll(lambda: (lambda r: r if done(r) else None)(oona.get(f"/api/runs/{run_id}").json()["run"]), API_WAIT_S, f"run {run_id} settles")


def test_workflow_versions_limits_and_retry(app_url):
    set_clock(app_url, "2027-09-06T10:00:00+02:00")
    t = tag("wv")
    oona = as_user(app_url, "oona")

    def steps(val: str) -> list[dict]:
        return [_trigger(t), {"id": "w", "type": "wait", "name": "Pause", "units": 1, "on_error": []},
                {"id": "s", "type": "set_fields", "name": "Mark", "fields": {"description": f'"{val}"'}, "on_error": []}]

    wid = _flow(app_url, t, steps("v1"))
    assert oona.post(f"/api/workflows/{wid}/publish").status_code == 201
    a = create_ok(oona, "incident", {"short_description": f"{t} a", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    oona.put(f"/api/workflows/{wid}/draft", json={"steps": steps("v2")})
    assert oona.post(f"/api/workflows/{wid}/publish").status_code == 201
    b = create_ok(oona, "incident", {"short_description": f"{t} b", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    advance_clock(app_url, 2 * WAIT_UNIT_SECONDS)
    poll(lambda: value(record(oona, a), "description") == "v1" and value(record(oona, b), "description") == "v2", API_WAIT_S, "runs stay on the version they started on")
    s1 = oona.post("/api/workflows", json={"name": f"Sub A {t}", "kind": "subflow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
    s2 = oona.post("/api/workflows", json={"name": f"Sub B {t}", "kind": "subflow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
    oona.put(f"/api/workflows/{s1}/draft", json={"steps": [{"id": "e", "type": "end", "name": "Done", "on_error": []}]})
    assert oona.post(f"/api/workflows/{s1}/publish").status_code == 201
    oona.put(f"/api/workflows/{s2}/draft", json={"steps": [{"id": "c", "type": "subflow", "name": "Call A", "flow": f"Sub A {t}", "inputs": {}, "on_error": []}]})
    assert oona.post(f"/api/workflows/{s2}/publish").status_code == 201
    oona.put(f"/api/workflows/{s1}/draft", json={"steps": [{"id": "c", "type": "subflow", "name": "Call B", "flow": f"Sub B {t}", "inputs": {}, "on_error": []}]})
    assert_error(oona.post(f"/api/workflows/{s1}/publish"), 422, "subflow_cycle", f"This subflow calls itself: Sub A {t} -> Sub B {t} -> Sub A {t}.")
    target = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    notify = {"id": "n", "type": "notify", "name": "Ping", "to": {"users": ["oona"], "roles": []}, "text": "x", "on_error": []}

    def loop(handled: bool) -> dict:
        return {"id": "l", "type": "loop", "name": f"Repeat {t}", "over": "[1, 2, 3, 4, 5]", "until": None, "body": [notify],
                "on_error": [dict(notify, id="h", name="Handle")] if handled else []}

    lw = _flow(app_url, f"{t}l", [_trigger(f"{t}l"), loop(False)])
    hw = _flow(app_url, f"{t}h", [_trigger(f"{t}h"), loop(True)])
    with settings(app_url, WORKFLOW_LOOP_LIMIT=3):
        run = oona.post(f"/api/workflows/{lw}/test-run", json={"record": target}).json()["run"]
        failed = _run(oona, run["id"], lambda r: r["status"] in ("failed", "done"))
        assert failed["status"] == "failed"
        step = [s for s in failed["steps"] if s["name"] == f"Repeat {t}"][0]
        assert step["status"].lower() == "failed" and step["error"] == f'Loop "Repeat {t}" stopped after 3 iterations.'
        hrun = oona.post(f"/api/workflows/{hw}/test-run", json={"record": target}).json()["run"]
        handled = _run(oona, hrun["id"], lambda r: r["status"] in ("failed", "done"))
        assert handled["status"] == "done" and [s for s in handled["steps"] if s["name"] == f"Repeat {t}"][0]["status"].lower() == "handled"
    assert oona.post(f"/api/runs/{run['id']}/retry").status_code == 202
    assert _run(oona, run["id"], lambda r: r["status"] in ("done", "failed"))["status"] == "done"
    assert_error(oona.post(f"/api/runs/{run['id']}/retry"), 409, "nothing_to_retry")


def test_wf_workflow_designer_build_publish(browser, app_url):
    set_clock(app_url, "2027-09-13T10:00:00+02:00")
    t = tag("wd")
    oona = as_user(app_url, "oona")
    wid = _flow(app_url, t, [_trigger(t), {"id": "w", "type": "wait", "name": "Pause", "units": 1, "on_error": []},
                             {"id": "s", "type": "set_fields", "name": "Mark", "fields": {"description": '"one"'}, "on_error": []}])
    oona.post(f"/api/workflows/{wid}/publish")
    a = create_ok(oona, "incident", {"short_description": f"{t} a", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with browse(browser, app_url, "oona", f"/desk/workflows/{wid}") as page:
        tree = page.get_by_role("tree", name="Flow steps")
        tree.get_by_role("treeitem", name="Mark, Set fields", exact=True).focus()
        page.keyboard.press("Insert")
        dlg = page.get_by_role("dialog", name="Add step")
        select(dlg.get_by_role("combobox", name="Step type"), "End")
        dlg.get_by_role("textbox", name="Step name").fill("Stop here")
        dlg.get_by_role("button", name="Add step").click()
        page.get_by_role("button", name="Publish").click()
        expect(announcer(page)).to_have_text("Version 2 published.", timeout=UI_MS)
    assert 2 in find_named(oona.get("/api/workflows").json(), f"Flow {t}")["versions"]
    advance_clock(app_url, 2 * WAIT_UNIT_SECONDS)
    poll(lambda: value(record(oona, a), "description") == "one", API_WAIT_S, "the version 1 run finished on version 1")


def test_wf_workflow_designer_run_live_retry(browser, app_url):
    t = tag("wr")
    tech = make_user(app_url, ["technician"])
    oona = as_user(app_url, "oona")
    target = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    wid = _flow(app_url, t, [_trigger(t), {"id": "l", "type": "loop", "name": f"Repeat {t}", "over": "[1, 2, 3, 4, 5]", "until": None,
                                           "body": [{"id": "n", "type": "notify", "name": "Ping", "to": {"users": [tech["username"]], "roles": []}, "text": "x", "on_error": []}], "on_error": []}])
    with settings(app_url, WORKFLOW_LOOP_LIMIT=3):
        run = oona.post(f"/api/workflows/{wid}/test-run", json={"record": target}).json()["run"]
        _run(oona, run["id"], lambda r: r["status"] == "failed")
    with browse(browser, app_url, tech["username"], f"/desk/runs/{run['id']}") as page:
        steps = page.get_by_role("list", name="Run steps")
        expect(steps.get_by_role("listitem", name=f"Repeat {t}: Failed")).to_be_visible(timeout=LOAD_MS)
        assert oona.post(f"/api/runs/{run['id']}/retry").status_code == 202
        expect(steps.get_by_role("listitem", name=f"Repeat {t}: Done")).to_be_visible(timeout=UI_MS)


def test_wf_workflow_designer_reduced_motion(browser, app_url):
    t = tag("wm")
    wid = _flow(app_url, t, [_trigger(t), {"id": "a", "type": "notify", "name": "One", "to": {"users": ["oona"], "roles": []}, "text": "x", "on_error": []},
                             {"id": "b", "type": "end", "name": "Two", "on_error": []}])
    with browse(browser, app_url, "oona", f"/desk/workflows/{wid}", reduced_motion="reduce") as page:
        one = page.get_by_role("tree", name="Flow steps").get_by_role("treeitem", name="One, Notify", exact=True)
        expect(one).to_be_visible(timeout=LOAD_MS)
        one.focus()
        page.evaluate(ANIM_RECORDER)
        page.keyboard.press("Alt+ArrowDown")
        expect(one).to_be_focused()
        assert durations_on(one) == [] and page.evaluate("() => document.getAnimations().length") == 0


def test_wf_workflow_designer_technician_refused(browser, app_url):
    t = tag("wt")
    wid = _flow(app_url, t, [_trigger(t)])
    target = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    tc = as_user(app_url, "teodor")
    for r in (tc.put(f"/api/workflows/{wid}/draft", json={"steps": []}), tc.post(f"/api/workflows/{wid}/test-run", json={"record": target})):
        assert r.status_code == 403 and r.json() == OPERATOR_ONLY
    with browse(browser, app_url, "teodor", f"/desk/workflows/{wid}") as page:
        expect(page.get_by_text("That page isn't on the switchyard.", exact=True)).to_be_visible(timeout=LOAD_MS)
    assert len(find_named(as_user(app_url, "oona").get("/api/workflows").json(), f"Flow {t}")["draft"]) == 1


def test_access_rule_evaluation(app_url):
    t = tag("ac")
    oona, teodor, mae = as_user(app_url, "oona"), as_user(app_url, "teodor"), as_user(app_url, "mae")
    conf = make_record(app_url, "incident", {"short_description": t, "caller": "ruth", "confidential": True, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    for r in (teodor.get(f"/api/records/{conf}"), teodor.get(f"/api/records/{conf}/sla"), teodor.get(f"/api/records/{conf}/activity"),
              teodor.post(f"/api/records/{conf}/work-notes", json={"text": "x"}), teodor.post(f"/api/records/{conf}/transition", json={"to": "assigned", "fields": {"assigned_to": {"value": "teodor", "version": 1}}})):
        assert_error(r, 404, "not_found", "No such record.")
    assert record(oona, conf)["number"] == conf
    vis = make_record(app_url, "incident", {"short_description": t, "caller": "ruth", "affected_person": "design07", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert "affected_person" not in record(mae, vis)["fields"]
    denied = mae.patch(f"/api/records/{vis}", json={"fields": {"affected_person": {"value": "design08", "version": 1}}})
    assert denied.status_code == 403 and set(denied.json()) == {"error"}, denied.text[:300]
    other = make_record(app_url, "incident", {"short_description": t, "caller": "kofi", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert_error(as_user(app_url, "ruth").get(f"/api/records/{other}"), 404, "not_found")
    name = f"No problem writes {t}"
    p = make_record(app_url, "problem", {"short_description": t})
    assert oona.post("/api/access-rules", json={"name": name, "type": "table", "table": "problem", "field": None, "operation": "write", "roles": ["technician"], "condition": None, "active": True}).status_code == 201
    try:
        e = assert_error(patch(teodor, p, description="x"), 403, "denied")
        assert e["message"].startswith("You cannot change ") and e["message"].endswith(" records.")
        assert patch(oona, p, description="by operator").status_code == 200
    finally:
        oona.put(f"/api/access-rules/{q(name)}", json={"name": name, "type": "table", "table": "problem", "field": None, "operation": "write", "roles": ["technician"], "condition": None, "active": False})


def test_denied_fields_leave_no_trace(app_url):
    t = tag("dn")
    caller = make_user(app_url, ["requester"], "Design Studio")
    shown_n = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "affected_person": "design07", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "confidential": True, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    mae = as_user(app_url, "mae")
    flt = eq_filter(t)
    lst = mae.get("/api/tables/incident/records", params={"filter": flt}).json()
    assert [r["number"] for r in lst["records"]] == [shown_n] and "affected_person" not in json.dumps(lst["records"])
    groups = mae.get("/api/tables/incident/records", params={"filter": flt, "group_by": "priority"}).json()["groups"]
    assert sum(g["count"] for g in groups) == 1
    for params in ({"filter": 'affected_person = "design07"'}, {"group_by": "affected_person"}, {"sort": "affected_person"}):
        assert_error(mae.get("/api/tables/incident/records", params=params), 422, "unknown_field", 'Unknown field "affected_person".')
    assert [r["number"] for r in mae.get("/api/search", params={"q": t}).json()["records"]] == [shown_n]
    assert mae.post("/api/reports/aggregate", json={"table": "incident", "filter": flt, "group_by": None, "bucket": None, "date_field": None, "time_zone": None}).json()["total"] == 1
    oona = as_user(app_url, "oona")
    assert patch(oona, shown_n, affected_person=GHOST_USER).status_code == 200
    assert not any(GHOST_USER in x or GHOST_NAME in x for x in activity_texts(mae, shown_n))
    ex = mae.post("/api/exports", json={"table": "incident", "filter": flt, "columns": ["number"]})
    assert ex.status_code == 202 and ex.json()["export"]["status"] == "queued", ex.text[:300]


def test_impersonation_audit_and_live_access_change(browser, app_url):
    t = tag("im")
    target = make_user(app_url, ["requester"], "Finance")
    oona = as_user(app_url, "oona")
    n = make_record(app_url, "incident", {"short_description": t, "caller": target["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert oona.post("/api/impersonate", json={"username": target["username"]}).json()["impersonating"]["username"] == target["username"]
    assert oona.post(f"/api/records/{n}/comments", json={"text": f"as them {t}"}).status_code == 201
    assert oona.delete("/api/impersonate").status_code == 204
    entry = [e for e in oona.get(f"/api/records/{n}/activity").json()["entries"] if f"as them {t}" in e["text"]][0]
    who = {entry["actor"], entry["acting_for"]}
    assert who & {"oona", "Oona Petrakis"} and who & {target["username"], target["display_name"]}
    kinds = [e["kind"] for e in oona.get("/api/audit-log").json()["entries"] if e["target"] in (target["username"], target["display_name"])]
    assert "impersonation_started" in kinds and "impersonation_stopped" in kinds
    with browse(browser, app_url, "oona", "/desk/admin/users") as page:
        page.get_by_role("button", name=f"Impersonate {target['display_name']}").click(timeout=LOAD_MS)
        page.wait_for_url(lambda u: urlparse(u).path.rstrip("/") == "/portal", timeout=LOAD_MS)
        expect(page.get_by_role("region", name="Impersonation")).to_contain_text(
            f"Impersonating {target['display_name']} ({target['username']}). Everything you do is recorded.", timeout=UI_MS)
        page.get_by_role("button", name="Stop impersonating").click()
        poll(lambda: [e["kind"] for e in oona.get("/api/audit-log").json()["entries"]
                      if e["target"] in (target["username"], target["display_name"])].count("impersonation_stopped") >= 2,
             API_WAIT_S, "stopping from the banner is audited")
    with browse(browser, app_url, target["username"], "/portal") as page:
        expect(page.get_by_role("region", name="My requests")).to_be_visible(timeout=LOAD_MS)
        assert oona.patch(f"/api/users/{target['username']}", json={"roles": ["requester", "manager"]}).status_code == 200
        expect(announcer(page)).to_have_text("Your access changed.", timeout=UI_MS)
    tech = make_user(app_url, ["technician"])
    rule = {"name": f"Hide affected {t}", "type": "field", "table": "incident", "field": "affected_person", "operation": "read", "roles": ["technician"],
            "condition": f'short_description = "{t}"', "active": True}
    with browse(browser, app_url, tech["username"], f"/desk/records/{n}") as page:
        form = page.get_by_role("form", name=n)
        expect(form.get_by_label("Affected person")).to_be_visible(timeout=LOAD_MS)
        assert oona.post("/api/access-rules", json=rule).status_code == 201
        try:
            expect(form.get_by_label("Affected person")).to_have_count(0, timeout=UI_MS)
        finally:
            oona.put(f"/api/access-rules/{q(rule['name'])}", json=dict(rule, active=False))


def _manager_records(app_url: str, t: str, manager_dept: str = "Design Studio") -> tuple[dict, str, str]:
    manager = make_user(app_url, ["manager"], manager_dept)
    caller = make_user(app_url, ["requester"], manager_dept)
    vis = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "affected_person": "design11", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    hid = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "confidential": True, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    return manager, vis, hid


def test_wf_access_rules_manager_surfaces(browser, app_url):
    t = tag("aw")
    manager, vis, hid = _manager_records(app_url, t)
    flt = q(eq_filter(t))
    with browse(browser, app_url, manager["username"], f"/desk/lists/incident?filter={flt}") as page:
        grid = page.get_by_role("grid").first
        expect(grid.get_by_role("row", name=re.compile(re.escape(vis)))).to_be_visible(timeout=LOAD_MS)
        expect(grid.get_by_role("row", name=re.compile(re.escape(hid)))).to_have_count(0)
        page.goto(base(app_url) + f"/desk/records/{vis}")
        expect(page.get_by_role("form", name=vis)).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("form", name=vis).get_by_label("Affected person")).to_have_count(0)
        page.goto(base(app_url) + f"/desk/records/{hid}")
        expect(page.get_by_text("That page isn't on the switchyard.", exact=True)).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("form", name=hid)).to_have_count(0)
    mc = as_user(app_url, manager["username"])
    assert_error(mc.get(f"/api/records/{hid}"), 404, "not_found")
    assert "affected_person" not in record(mc, vis)["fields"]


def test_wf_access_rules_impersonation_banner(browser, app_url):
    t = tag("ai")
    manager, vis, hid = _manager_records(app_url, t)
    r = as_user(app_url, "teodor").post("/api/impersonate", json={"username": manager["username"]})
    assert r.status_code == 403 and r.json() == OPERATOR_ONLY
    with browse(browser, app_url, "oona", "/desk/admin/users") as page:
        page.get_by_role("button", name=f"Impersonate {manager['display_name']}").click(timeout=LOAD_MS)
        expect(page.get_by_role("region", name="Impersonation")).to_contain_text(
            f"Impersonating {manager['display_name']} ({manager['username']}). Everything you do is recorded.", timeout=UI_MS)
        page.goto(base(app_url) + f"/desk/records/{vis}")
        expect(page.get_by_role("form", name=vis)).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("form", name=vis).get_by_label("Affected person")).to_have_count(0)
        page.get_by_role("button", name="Stop impersonating").click()
    entries = as_user(app_url, "oona").get("/api/audit-log", params={"kind": "impersonation_started"}).json()["entries"]
    assert any(e["target"] in (manager["username"], manager["display_name"]) for e in entries)


def test_wf_access_rules_live_role_change(browser, app_url):
    t = tag("al")
    manager, vis, _ = _manager_records(app_url, t)
    with browse(browser, app_url, manager["username"], f"/desk/records/{vis}") as page:
        expect(page.get_by_role("form", name=vis)).to_be_visible(timeout=LOAD_MS)
        assert as_user(app_url, "oona").patch(f"/api/users/{manager['username']}", json={"roles": ["requester"]}).status_code == 200
        expect(announcer(page)).to_have_text("Your access changed.", timeout=UI_MS)
    assert_error(as_user(app_url, manager["username"]).get(f"/api/records/{vis}"), 404, "not_found")


def test_wf_access_rules_phone_drawer(browser, app_url):
    t = tag("ad")
    manager, _, _ = _manager_records(app_url, t)
    allowed = ("/portal", "/inbox", "/desk", "/desk/lists", "/desk/records", "/desk/map", "/desk/major", "/desk/exports", "/dashboards")
    with browse(browser, app_url, manager["username"], "/portal", width=375, height=812) as page:
        page.get_by_role("banner").get_by_role("button", name="Menu").click(timeout=LOAD_MS)
        drawer = page.get_by_role("dialog", name="Navigation")
        expect(drawer).to_be_visible(timeout=UI_MS)
        for link in drawer.get_by_role("link").all():
            path = urlparse(link.get_attribute("href") or "/").path.rstrip("/") or "/"
            assert path == "/" or any(path == a or path.startswith(a + "/") for a in allowed), path
        handles = focusables(drawer)
        drawer.get_by_role("button", name="Close", exact=True).click()
        expect(page.get_by_role("dialog", name="Navigation")).to_have_count(0, timeout=UI_MS)
        assert_inert_after_close(page, handles, "navigation drawer")


FILTER_CASES = {
    "queue-example": ('assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]',
                      '(assigned_to.username = me()) and (state in ["new", "assigned", "in_progress", "on_hold"])'),
    "number-format": ("priority = 02.50", "priority = 2.5"),
    "nested-groups": ('(priority = 1 or priority = 2) and state = "new"', '(priority = 1 or priority = 2) and (state = "new")'),
    "empty-check": ("is_empty(assigned_to) or not is_empty(problem)", "(is_empty(assigned_to)) or (not is_empty(problem))"),
    "mixed-connectors": ('priority = 1 and state = "new" or urgency = 1', None),
    "unknown-field": ("nosuch = 1", None),
}


@pytest.mark.parametrize("case", list(FILTER_CASES), ids=list(FILTER_CASES))
def test_filter_text_round_trip(app_url, case):
    text, canonical = FILTER_CASES[case]
    oona = as_user(app_url, "oona")
    r = oona.post("/api/filters/parse", json={"table": "incident", "filter": text})
    if case == "mixed-connectors":
        assert_error(r, 422, "filter_too_complex", "This filter cannot be shown in the builder.")
        return
    if case == "unknown-field":
        assert_error(r, 422, "unknown_field", 'Unknown field "nosuch".')
        return
    assert r.status_code == 200, r.text
    builder, got = r.json()["builder"], r.json()["filter"]
    assert got == canonical
    composed = oona.post("/api/filters/compose", json={"table": "incident", "builder": builder}).json()["filter"]
    assert composed == canonical
    again = oona.post("/api/filters/parse", json={"table": "incident", "filter": canonical}).json()
    assert again["builder"] == builder and again["filter"] == canonical


def test_groups_paging_and_bulk_update(app_url):
    t = tag("gp")
    oona = as_user(app_url, "oona")
    nums = []
    for i in range(25):
        impact, urgency = [(3, 3), (3, 2), (2, 2)][i % 3]
        nums.append(make_record(app_url, "incident", {"short_description": f"{t} lock" if i == 2 else t, "impact": impact, "urgency": urgency, "assignment_group": "Triage",
                                                      "assigned_to": "teodor" if i % 2 else None}))
    flt = f'short_description startswith "{t}"'
    groups = oona.get("/api/tables/incident/records", params={"filter": flt, "group_by": "priority"}).json()["groups"]
    assert [(g["value"], g["label"], g["filter"]) for g in groups] == [(3, "3 Moderate", "priority = 3"), (4, "4 Low", "priority = 4"), (5, "5 Planning", "priority = 5")]
    assert sum(g["count"] for g in groups) == 25
    ag = oona.get("/api/tables/incident/records", params={"filter": flt, "group_by": "assigned_to"}).json()["groups"]
    assert ag[-1]["value"] is None and ag[-1]["label"] == "(empty)" and ag[-1]["filter"] == "is_empty(assigned_to)"
    assert ag[0]["filter"] == 'assigned_to = "teodor"' and ag[0]["count"] == 12
    seen = []
    for p in (1, 2):
        page = oona.get("/api/tables/incident/records", params={"filter": flt, "sort": "priority", "dir": "asc", "page": p}).json()
        seen += [(r["priority"], r["number"]) for r in page["records"]]
    assert len(seen) == 25 and seen == sorted(seen) and len({n for _, n in seen}) == 25
    assert oona.post("/api/business-rules", json={"name": f"Lock {t}", "table": "incident", "when": "before", "order": 100, "operations": ["update"],
                                                  "condition": f'short_description = "{t} lock" and changes(urgency)', "actions": [{"abort": f"Locked {t}."}], "active": True}).status_code == 201
    res = oona.post("/api/records/bulk", json={"numbers": nums[:3], "fields": {"urgency": 1}}).json()["results"]
    assert [r["ok"] for r in res] == [True, True, False] and res[2]["message"] == f"Locked {t}."
    assert value(record(oona, nums[0]), "urgency") == 1 and value(record(oona, nums[2]), "urgency") == 2


def test_dashboards_aggregate_in_viewer_zone_after_access(app_url):
    set_clock(app_url, "2026-11-04T23:30:00+00:00")
    oona, hugo = as_user(app_url, "oona"), as_user(app_url, "hugo")

    def widget(c: httpx.Client, d: str, title: str) -> dict:
        return [w for w in c.get(f"/api/dashboards/{d}").json()["dashboard"]["widgets"] if w["title"] == title][0]

    berlin = widget(oona, "desk-overview", "Opened per day")["data"]
    lisbon = widget(hugo, "department-standing", "Opened per day")["data"]
    assert len(berlin) == 14 and len(lisbon) == 14
    assert berlin[-1]["key"] == "2026-11-05" and lisbon[-1]["key"] == "2026-11-04"
    assert [b["key"] for b in berlin] == [(date(2026, 11, 5) - timedelta(days=13 - i)).isoformat() for i in range(14)]
    nov4 = [b for b in berlin if b["key"] == "2026-11-04"][0]
    assert nov4["filter"] == '(created_at >= "2026-11-04T00:00:00+01:00") and (created_at < "2026-11-05T00:00:00+01:00")'
    lo, hi = re.findall(r'"([^"]+)"', lisbon[-1]["filter"])
    assert parse_instant(lo) == datetime(2026, 11, 4, tzinfo=LISBON) and parse_instant(hi) == datetime(2026, 11, 5, tzinfo=LISBON)
    t = tag("db")
    before_b, before_l = berlin[-1]["count"], lisbon[-1]["count"]
    make_record(app_url, "incident", {"short_description": t, "caller": "kofi", "impact": 3, "urgency": 3, "assignment_group": "Triage"}, created_at="2026-11-04T23:30:00+00:00")
    assert widget(oona, "desk-overview", "Opened per day")["data"][-1]["count"] == before_b + 1
    assert widget(hugo, "department-standing", "Opened per day")["data"][-1]["count"] == before_l + 1

    def bars(c: httpx.Client, d: str) -> dict:
        return {str(g["key"]): g["count"] for g in widget(c, d, "Open by priority")["data"]}

    bo, bh = bars(oona, "desk-overview"), bars(hugo, "department-standing")
    make_record(app_url, "incident", {"short_description": t, "caller": "kofi", "confidential": True, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert bars(oona, "desk-overview").get("5", 0) == bo.get("5", 0) + 1
    assert bars(hugo, "department-standing") == bh, "a confidential row never reaches a manager's totals"


def test_wf_lists_dashboards_builder_keyboard(browser, app_url):
    t = tag("lb")
    a = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 2, "assignment_group": "Triage"})
    b = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    make_record(app_url, "incident", {"short_description": t, "impact": 2, "urgency": 2, "assignment_group": "Triage"})
    start_filter = q(f'short_description contains "{t}"')
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={start_filter}") as page:
        grid = page.get_by_role("grid").first
        expect(grid).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the grid")
        page.keyboard.press("/")
        dlg = page.get_by_role("dialog", name="Filter")
        expect(dlg).to_be_visible(timeout=UI_MS)

        def cond(c: int, g: int) -> Locator:
            return dlg.get_by_role("group", name=f"Condition {c} of group {g}")

        expect(cond(1, 1).get_by_role("combobox", name="Field")).to_be_focused()
        text = dlg.get_by_role("textbox", name="Filter text")
        text.fill(f'(priority = 4 or priority = 5) and (short_description contains "{t}")')
        text.press("Enter")
        expect(cond(2, 1)).to_be_visible(timeout=UI_MS)
        cond(1, 1).get_by_role("textbox", name="Value").focus()
        page.keyboard.press("Alt+ArrowDown")
        expect(text).to_have_value(f'(priority = 5 or priority = 4) and (short_description contains "{t}")', timeout=POLICY_MS + UI_SLACK_MS)
        assert contains_focus(cond(2, 1))
        add = dlg.get_by_role("button", name=add_condition_label(2))
        add.focus()
        page.keyboard.press("Enter")
        expect(cond(2, 2).get_by_role("combobox", name="Field")).to_be_focused(timeout=UI_MS)
        rm = cond(2, 2).get_by_role("button", name="Remove condition")
        rm.focus()
        page.keyboard.press("Enter")
        expect(cond(1, 2).get_by_role("combobox", name="Field")).to_be_focused(timeout=UI_MS)
        for _ in range(40):
            page.keyboard.press("Tab")
            assert contains_focus(dlg), "Tab wraps inside the Filter dialog"
        dlg.get_by_role("button", name="Apply filter").click()
        expect(dlg).to_have_count(0, timeout=UI_MS)
        assert contains_focus(grid)
        for n in (a, b):
            expect(grid.get_by_role("row", name=re.compile(re.escape(n)))).to_be_visible(timeout=UI_MS)
    numbers = {r["number"] for r in as_user(app_url, "oona").get("/api/tables/incident/records", params={"filter": f'(priority = 5 or priority = 4) and (short_description contains "{t}")'}).json()["records"]}
    assert numbers == {a, b}


def test_wf_lists_dashboards_bulk_partial(browser, app_url):
    t = tag("bu")
    nums = [make_record(app_url, "incident", {"short_description": f"{t} lock" if i == 2 else t, "impact": 3, "urgency": 3, "assignment_group": "Triage"}) for i in range(3)]
    oona = as_user(app_url, "oona")
    assert oona.post("/api/business-rules", json={"name": f"Lock {t}", "table": "incident", "when": "before", "order": 100, "operations": ["update"],
                                                  "condition": f'short_description = "{t} lock" and changes(urgency)', "actions": [{"abort": f"Locked {t}."}], "active": True}).status_code == 201
    flt = q(f'short_description startswith "{t}"')
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={flt}") as page:
        grid = page.get_by_role("grid").first
        expect(grid.get_by_role("row", name=re.compile(re.escape(nums[0])))).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the grid")
        for n in nums:
            row = grid.get_by_role("row", name=re.compile(re.escape(n)))
            for _ in range(6):
                if contains_focus(row):
                    break
                page.keyboard.press("ArrowDown")
            page.keyboard.press("Space")
        page.get_by_role("button", name="Update selected").click()
        dlg = page.get_by_role("dialog", name="Bulk update")
        pick(dlg.get_by_role("combobox", name="Field"), "Urgency")
        dlg.get_by_role("textbox", name="Value").fill("1")
        dlg.get_by_role("button", name="Update").click()
        expect(announcer(page)).to_have_text("2 updated, 1 not updated.", timeout=UI_MS)
        report = page.get_by_role("region", name="Bulk update report")
        expect(report.get_by_role("heading", name="Bulk update report")).to_be_focused(timeout=UI_MS)
        for n in nums[:2]:
            expect(report).to_contain_text(f"{n} updated")
        expect(report).to_contain_text(f"{nums[2]} not updated: Locked {t}.")
    assert [value(record(oona, n), "urgency") for n in nums] == [1, 1, 3]


def test_wf_lists_dashboards_notice_and_drilldown(browser, app_url):
    set_clock(app_url, "2026-11-04T23:30:00+00:00")
    t = tag("nd")
    a = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    flt = q(eq_filter(t))
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={flt}") as page:
        grid = page.get_by_role("grid").first
        expect(grid.get_by_role("row", name=re.compile(re.escape(a)))).to_be_visible(timeout=LOAD_MS)
        b = create_ok(as_user(app_url, "teodor"), "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
        notice = page.get_by_role("button", name="1 new record")
        expect(notice).to_be_visible(timeout=UI_MS)
        expect(grid.get_by_role("row", name=re.compile(re.escape(b)))).to_have_count(0)
        notice.click()
        expect(grid.get_by_role("row", name=re.compile(re.escape(b)))).to_be_visible(timeout=UI_MS)
    with browse(browser, app_url, "hugo", "/dashboards/department-standing") as page:
        region = page.get_by_role("region", name="Opened per day")
        link = region.get_by_role("link", name=re.compile(r"^2026-11-04: \d+$"))
        expect(link).to_be_visible(timeout=LOAD_MS)
        count = int(re.search(r"(\d+)$", link.get_attribute("aria-label") or link.inner_text()).group(1))
        create_ok(as_user(app_url, "oona"), "incident", {"short_description": t, "caller": "kofi", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
        expect(region.get_by_role("link", name=f"2026-11-04: {count + 1}")).to_be_visible(timeout=UI_MS)
        region.get_by_role("button", name="Show data table").click()
        widget_title = "Opened per day"
        expect(region.get_by_role("table", name=f"{widget_title} data")).to_be_visible(timeout=UI_MS)
        region.get_by_role("link", name=f"2026-11-04: {count + 1}").click()
        page.wait_for_url(re.compile(r"/desk/lists/incident\?filter="), timeout=LOAD_MS)
        lo, hi = re.findall(r'"([^"]+)"', parse_qs(urlparse(page.url).query)["filter"][0])
        assert parse_instant(lo) == datetime(2026, 11, 4, tzinfo=LISBON) and parse_instant(hi) == datetime(2026, 11, 5, tzinfo=LISBON)
        page.get_by_role("button", name="Filter").click()
        box = page.get_by_role("dialog", name="Filter").get_by_role("textbox", name="Filter text")
        expect(box).to_have_value(re.compile(r'^\(created_at >= "[^"]+"\) and \(created_at < "[^"]+"\)$'), timeout=UI_MS)


def _import(c: httpx.Client, content: str, name: str = "people.csv", table: str = "people", mapping: dict | None = None) -> httpx.Response:
    data = {"table": table}
    if mapping:
        data["mapping"] = json.dumps(mapping)
    return c.post("/api/imports", data=data, files={"file": (name, content.encode(), "text/csv")})


def test_import_preview_errors_and_reruns(app_url):
    t = tag("ip")
    oona = as_user(app_url, "oona")
    lines = ["#switchyard-import v1 people", "username,display_name,department,active",
             f"{t}a,Import A,Finance,true", f"{t}b,,Finance,true", f"{t}c,Import C,Nowhere{t},true", f"{t}d,Import D,Finance,{BAD_FLAG}",
             f"{t}a,Import A2,Finance,true", f"{t}e,Import E,Finance", "", f"{t}f,Import F,Design Studio,false"]
    r = _import(oona, "\n".join(lines) + "\n", name=f"{t}.csv")
    assert r.status_code == 201, r.text
    imp = r.json()["import"]
    rows = {row["line"]: row for row in imp["rows"]}
    assert rows[10]["action"] == "create"
    assert "Line 4: display_name is required." in rows[4]["errors"]
    assert f'Line 5: department "Nowhere{t}" does not exist.' in rows[5]["errors"]
    assert f'Line 6: active "{BAD_FLAG}" is not one of true, false.' in rows[6]["errors"]
    assert f'Line 7: duplicate key "{t}a" also on line 3.' in rows[7]["errors"]
    assert "Line 8: expected 4 values, found 3." in rows[8]["errors"]
    assert f"imports/{imp['id']}/{t}.csv" in S3().keys(f"imports/{imp['id']}/")
    c1 = oona.post(f"/api/imports/{imp['id']}/commit")
    assert c1.status_code == 200 and {x["line"]: x["outcome"] for x in c1.json()["import"]["results"]}[10] == "created"
    assert_error(oona.post(f"/api/imports/{imp['id']}/commit"), 409, "already_committed")
    clean = ["#switchyard-import v1 people", "username,display_name,department,active", f"{t}f,Import F,Design Studio,false"]
    again = _import(oona, "\n".join(clean) + "\n").json()["import"]
    assert [x["action"] for x in again["rows"]] == ["unchanged"] and again["counts"]["unchanged"] == 1
    changed = _import(oona, "\r\n".join(clean[:2] + [f"{t}f,Import F renamed,Design Studio,false"]) + "\r\n").json()["import"]
    assert [x["action"] for x in changed["rows"]] == ["update"]
    oona.post(f"/api/imports/{changed['id']}/commit")
    mapped = _import(oona, "#switchyard-import v1 people\nlogin,display_name,department,active\n" + f"{t}f,Import F renamed,Design Studio,false\n", mapping={"login": "username"}).json()["import"]
    assert [x["action"] for x in mapped["rows"]] == ["unchanged"]
    bad = _import(oona, "#switchyard-import v2 people\nusername,display_name\n")
    assert 'Line 1: the first line must be "#switchyard-import v1 people".' in strings_in(bad.json())
    bad = _import(oona, f"#switchyard-import v1 people\nusername,display_name,{SHOE_COLUMN}\n")
    assert f'Line 2: unknown column "{SHOE_COLUMN}".' in strings_in(bad.json())


def _set_flow(app_url: str) -> tuple[dict, httpx.Client]:
    op = make_user(app_url, ["operator"])
    c = as_user(app_url, op["username"])
    return op, c


def _rule(name: str, note: str) -> dict:
    return {"name": name, "table": "incident", "when": "after", "order": 100, "operations": ["insert"], "condition": f'short_description = "{name}"',
            "actions": [{"work_note": note}], "active": False}


def test_configuration_sets_capture_preview_commit_backout(app_url):
    t = tag("cs")
    _, c = _set_flow(app_url)

    def live(name: str) -> dict | None:
        return find_named(c.get("/api/business-rules").json(), name)

    r1, r2 = f"Rule one {t}", f"Rule two {t}"
    assert c.put("/api/session/workspace", json={"workspace": "test"}).status_code == 200
    s1 = c.post("/api/config-sets", json={"name": f"First {t}"}).json()["set"]
    assert_error(c.post("/api/config-sets", json={"name": f"Second {t}"}), 409, "set_already_open")
    c.post("/api/business-rules", json=_rule(r1, "v1"))
    c.post("/api/business-rules", json=_rule(r2, "v1"))
    exp = c.post(f"/api/config-sets/{s1['id']}/export")
    assert exp.status_code == 201 and exp.json()["set"]["key"] == f"config-sets/{s1['number']}.json"
    doc = json.loads(S3().get(f"config-sets/{s1['number']}.json"))
    assert doc["format"] == "switchyard-config-set" and doc["version"] == 1 and doc["number"] == s1["number"]
    assert {(i["kind"], i["name"]) for i in doc["items"]} == {("business_rule", r1), ("business_rule", r2)}
    c.put("/api/session/workspace", json={"workspace": "live"})
    assert live(r1) is None, "test workspace changes are not live"
    assert {i["name"]: i["action"] for i in c.post(f"/api/config-sets/{s1['id']}/preview").json()["items"]} == {r1: "create", r2: "create"}
    assert c.post(f"/api/config-sets/{s1['id']}/commit", json={"choices": {}}).json()["applied"] == 2
    c.put(f"/api/business-rules/{q(r2)}", json=_rule(r2, "edited live"))
    c.put("/api/session/workspace", json={"workspace": "test"})
    s2 = c.post("/api/config-sets", json={"name": f"Second {t}"}).json()["set"]
    c.put(f"/api/business-rules/{q(r1)}", json=_rule(r1, "v2"))
    c.put(f"/api/business-rules/{q(r2)}", json=_rule(r2, "v2"))
    c.post(f"/api/config-sets/{s2['id']}/export")
    c.put("/api/session/workspace", json={"workspace": "live"})
    assert {i["name"]: i["action"] for i in c.post(f"/api/config-sets/{s2['id']}/preview").json()["items"]} == {r1: "update", r2: "collision"}
    assert_error(c.post(f"/api/config-sets/{s2['id']}/commit", json={"choices": {}}), 422, "choice_required", f"Choose Take set or Keep live for {r2}.")
    r = c.post(f"/api/config-sets/{s2['id']}/commit", json={"choices": {f"business_rule:{r2}": "take_set"}})
    assert r.status_code == 200 and r.json()["applied"] == 2 and r.json()["set"]["state"] == "committed"
    assert live(r1)["actions"] == [{"work_note": "v2"}] and live(r2)["actions"] == [{"work_note": "v2"}]
    assert_error(c.post(f"/api/config-sets/{s1['id']}/backout"), 409, "later_set", f"A later set changed {r1}; back that out first.")
    assert c.post(f"/api/config-sets/{s2['id']}/backout").json()["set"]["state"] == "backed_out"
    assert live(r1)["actions"] == [{"work_note": "v1"}] and live(r2)["actions"] == [{"work_note": "edited live"}]
    assert c.post(f"/api/config-sets/{s1['id']}/backout").status_code == 200
    assert live(r1) is None and live(r2) is None


def test_attachments_and_exports_stored_only_after_storage(app_url):
    t = tag("at")
    u = make_user(app_url, ["technician"])
    c = as_user(app_url, u["username"])
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    payload = f"log line {t}\n".encode()
    r = c.post(f"/api/records/{n}/attachments", files={"file": ("trace.log", payload, "text/plain")})
    assert r.status_code == 201 and r.json()["attachment"]["status"] == "stored", r.text
    aid = r.json()["attachment"]["id"]
    assert S3().get(f"attachments/{n}/{aid}/trace.log") == payload
    assert c.get(f"/api/attachments/{aid}").content == payload
    assert_error(c.post(f"/api/records/{n}/attachments", files={"file": (EXE_NAME, b"MZ", "application/octet-stream")}), 422, "bad_type",
                 "Switchyard accepts PNG, JPEG, PDF, TXT, LOG and CSV files.")
    assert_error(c.post(f"/api/records/{n}/attachments", files={"file": (BIG_NAME, b"a" * (ATTACHMENT_MAX + 1), "text/plain")}), 413, "too_large",
                 "Files can be at most 5,000,000 bytes.")
    assert all(EXE_NAME not in k and BIG_NAME not in k for k in S3().keys(f"attachments/{n}/"))
    q2 = make_user(app_url, ["technician"])
    qc = as_user(app_url, q2["username"])
    blob = b"b" * (ATTACHMENT_MAX - len(payload))
    first = qc.post(f"/api/records/{n}/attachments", files={"file": ("q0.txt", payload, "text/plain")})
    assert first.status_code == 201
    for i in range(1, 4):
        assert qc.post(f"/api/records/{n}/attachments", files={"file": (f"q{i}.txt", b"c" * ATTACHMENT_MAX, "text/plain")}).status_code == 201
    assert qc.post(f"/api/records/{n}/attachments", files={"file": ("q4.txt", blob, "text/plain")}).status_code == 201, "reaching the quota exactly is allowed"
    assert_error(qc.post(f"/api/records/{n}/attachments", files={"file": ("q5.txt", b"x", "text/plain")}), 422, "over_quota",
                 "This upload would take you past your 20,000,000-byte attachment quota.")
    ex = c.post("/api/exports", json={"table": "incident", "filter": eq_filter(t), "columns": ["number", "short_description"]})
    assert ex.status_code == 202 and ex.json()["export"]["status"] == "queued"
    eid = ex.json()["export"]["id"]
    done = poll(lambda: (lambda e: e if e["status"] == "complete" else None)(c.get(f"/api/exports/{eid}").json()["export"]), API_WAIT_S, "export completes")
    assert done["key"] == f"exports/{eid}.csv"
    assert S3().get(f"exports/{eid}.csv") == c.get(f"/api/exports/{eid}/file").content


def test_storage_outage_queues_and_recovers(browser, app_url):
    down = os.environ.get("APP_MINIO_DOWN_URL")
    assert down, "APP_MINIO_DOWN_URL names the storage-down instance"
    t = tag("so")
    dc = as_user(down, "oona")
    poll(lambda: dc.get("/api/storage").json()["storage"] == "unavailable", STORAGE_WAIT_S, "the storage-down instance reports unavailable")
    n = create_ok(dc, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    r = dc.post(f"/api/records/{n}/attachments", files={"file": ("q.txt", f"queued {t}".encode(), "text/plain")})
    assert r.status_code == 202 and r.json()["attachment"]["status"] == "queued"
    assert_error(dc.get(f"/api/attachments/{r.json()['attachment']['id']}"), 409, "not_stored")
    imp = _import(dc, "#switchyard-import v1 people\nusername,display_name\n")
    assert imp.status_code == 503 and imp.json() == STORAGE_503
    with browse(browser, down, "oona", "/desk") as page:
        expect(page.get_by_role("region", name="Storage status")).to_contain_text(STORAGE_BANNER_DESK, timeout=LOAD_MS)
    with browse(browser, down, "ruth", "/portal") as page:
        expect(page.get_by_role("region", name="Storage status")).to_contain_text(STORAGE_BANNER_PORTAL, timeout=LOAD_MS)
    oona = as_user(app_url, "oona")
    m = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with storage_redirect(app_url, DEAD_ENDPOINT):
        poll(lambda: oona.get("/api/storage").json()["storage"] == "unavailable", STORAGE_WAIT_S, "storage reported unavailable")
        up = oona.post(f"/api/records/{m}/attachments", files={"file": ("w.txt", f"wait {t}".encode(), "text/plain")})
        assert up.status_code == 202
        aid = up.json()["attachment"]["id"]
        ex = oona.post("/api/exports", json={"table": "incident", "filter": eq_filter(t), "columns": ["number"]}).json()["export"]
        failed = poll(lambda: (lambda e: e if e["status"] == "failed" else None)(oona.get(f"/api/exports/{ex['id']}").json()["export"]), STORAGE_WAIT_S, "export fails while storage is down")
        assert failed["error"] == "storage_unavailable"
        r = oona.post(f"/api/exports/{ex['id']}/retry")
        assert r.status_code == 503 and r.json() == STORAGE_503
        assert create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    poll(lambda: f"attachments/{m}/{aid}/w.txt" in S3().keys(f"attachments/{m}/"), STORAGE_WAIT_S, "queued upload stored after storage returned")
    poll(lambda: oona.get(f"/api/exports/{ex['id']}").json()["export"]["status"] == "complete", STORAGE_WAIT_S, "failed export retried automatically")
    assert f"exports/{ex['id']}.csv" in S3().keys("exports/")
    real = os.environ.get("S3_ENDPOINT")
    if real:
        assert grade(down, "POST", "/api/grading/storage", {"endpoint": real}).status_code == 200
        poll(lambda: dc.get("/api/health").json() == {"status": "ok"}, STORAGE_WAIT_S, "storage-down instance recovers without a restart")


def test_wf_import_promotion_import_ui(browser, app_url):
    t = tag("iu")
    content = f"#switchyard-import v1 people\nusername,display_name,department,active\n{t}a,Import A,Finance,true\n{t}b,,Finance,true\n"
    path = Path(os.environ.get("TMPDIR", "/tmp")) / f"{t}.csv"
    path.write_text(content)
    with browse(browser, app_url, "oona", "/desk/imports") as page:
        for expected_check, expected_done in (("Import checked: 1 to create, 0 to update, 0 unchanged, 1 with errors.", "Import finished: 1 created, 0 updated, 0 unchanged, 1 failed."),
                                              ("Import checked: 0 to create, 0 to update, 1 unchanged, 1 with errors.", None)):
            with page.expect_file_chooser(timeout=LOAD_MS) as fc:
                page.get_by_role("button", name="Upload import file").click()
            fc.value.set_files(str(path))
            expect(announcer(page)).to_have_text(expected_check, timeout=UI_MS)
            expect(page.get_by_role("table", name="Import preview")).to_contain_text("Line 4: display_name is required.")
            if expected_done:
                page.get_by_role("button", name="Commit import").click()
                expect(announcer(page)).to_have_text(expected_done, timeout=UI_MS)
    assert any(k.endswith(f"/{t}.csv") for k in S3().keys("imports/"))


def test_wf_import_promotion_config_set_ui(browser, app_url):
    t = tag("cu")
    op, c = _set_flow(app_url)
    name = f"Rule {t}"
    c.put("/api/session/workspace", json={"workspace": "test"})
    s = c.post("/api/config-sets", json={"name": f"Set {t}"}).json()["set"]
    c.post("/api/business-rules", json=_rule(name, "from set"))
    c.put("/api/session/workspace", json={"workspace": "live"})
    with browse(browser, app_url, op["username"], "/desk/config-sets") as page:
        row = page.get_by_role("row").filter(has_text=s["number"])
        row.get_by_role("button", name="Export set").click(timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(f"Set {s['number']} exported.", timeout=UI_MS)
        row.get_by_role("button", name="Preview against live").click()
        expect(page.get_by_role("table", name="Set preview")).to_contain_text(name, timeout=UI_MS)
        row.get_by_role("button", name="Commit set").click()
        expect(announcer(page)).to_have_text(f"Set {s['number']} committed: 1 items applied.", timeout=UI_MS)
        assert find_named(c.get("/api/business-rules").json(), name) is not None
        row.get_by_role("button", name="Back out set").click()
        expect(announcer(page)).to_have_text(f"Set {s['number']} backed out.", timeout=UI_MS)
    assert find_named(c.get("/api/business-rules").json(), name) is None


def test_wf_import_promotion_export_outage(browser, app_url):
    t = tag("eo")
    oona = as_user(app_url, "oona")
    make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    before = set(S3().keys("exports/"))
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={q(eq_filter(t))}") as page:
        expect(page.get_by_role("grid").first).to_be_visible(timeout=LOAD_MS)
        with storage_redirect(app_url, DEAD_ENDPOINT):
            expect(page.get_by_role("region", name="Storage status")).to_contain_text(STORAGE_BANNER_DESK, timeout=STORAGE_WAIT_S * 1000)
            page.get_by_role("button", name="Export", exact=True).click()
            expect(announcer(page)).to_have_text("Export failed: file storage is unreachable.", timeout=STORAGE_WAIT_S * 1000)
            assert create_ok(oona, "incident", {"short_description": f"{t} other", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
            assert set(S3().keys("exports/")) == before, "nothing is stored while storage is down"
        expect(announcer(page)).to_have_text("Export complete: 1 rows.", timeout=STORAGE_WAIT_S * 1000)
        new_keys = set(S3().keys("exports/")) - before
        assert len(new_keys) == 1, "complete is shown only after storage holds the object"
        expect(page.get_by_role("region", name="Storage status")).to_have_count(0, timeout=UI_MS)


APP = Path("/app")


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    text = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert "Unbounded" in text and "Onest" in text


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)]
    assert not bad, bad[:20]


def test_if_no_extra_datastore():
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lmdb", "nedb", "lowdb", "pouchdb", "keyv"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]
    found = []
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        found += [f for f in files if f.endswith((".sqlite", ".sqlite3", ".db"))]
    assert not found, found


def test_if_same_origin_assets(browser, app_url):
    seen: list[str] = []
    with browse(browser, app_url, "ruth", "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        page.goto(base(app_url) + "/portal")
        expect(page.get_by_role("region", name="Catalog")).to_be_visible(timeout=LOAD_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(base(app_url)))]
    assert not foreign, foreign[:10]


def test_if_user_text_never_runs(app_url):
    oona = as_user(app_url, "oona")
    for payload in ('process.exit(1)', 'constructor.constructor("return 1")()', "require(\"fs\")", "${1+1} = 2"):
        r = oona.post("/api/business-rules", json={"name": f"Inject {tag('ij')}", "table": "incident", "when": "before", "order": 100,
                                                   "operations": ["insert"], "condition": payload, "actions": [], "active": False})
        assert_error(r, 422, "expression_error")
    with new_client(app_url) as c:
        assert c.get("/api/health").json() == {"status": "ok"}


def test_if_lockfile_used():
    assert (APP / "package-lock.json").is_file()
    assert "npm ci" in json.loads((APP / "run.json").read_text())["install"]


def test_if_compose_unchanged():
    files = [p for p in APP.iterdir() if re.fullmatch(r"(docker-)?compose[\w.-]*\.ya?ml", p.name)]
    assert files, "a compose file is present"
    assert all(p.read_text().strip() for p in files)


_A_SLA_BAR_MS = 420
_A_SNAP_MS = 180
_A_PRESENCE_DEFAULT = 30
_A_HEARTBEAT_S = 10


def _a_active_cell_text(page: Page) -> str:
    return page.evaluate("""() => {
      const a = document.activeElement;
      if (!a) return '';
      const c = a.closest('[role="gridcell"],[role="cell"],[role="rowheader"],td,th') || a;
      return (c.innerText || c.textContent || '').trim();
    }""")


def _a_arrow_to(page: Page, row: Locator, key: str, what: str, limit: int = 8) -> None:
    for _ in range(limit):
        if contains_focus(row):
            return
        page.keyboard.press(key)
    assert contains_focus(row), f"{key} never reached {what}"


def _a_focus_cell(page: Page, row: Locator, text: str) -> None:
    for _ in range(8):
        page.keyboard.press("ArrowLeft")
    for _ in range(8):
        if contains_focus(row) and _a_active_cell_text(page) == text:
            return
        page.keyboard.press("ArrowRight")
    pytest.fail(f"arrow keys never reached the cell reading {text!r}")


def _a_pump_until(page: Page, fn: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if fn():
            return
        page.clock.run_for(50)
    pytest.fail(what)


def _a_publish_article(c: httpx.Client, body: dict) -> str:
    r = c.post("/api/knowledge/articles", json={"keywords": [], "valid_until": None, "audience": {"roles": [], "departments": []}, **body})
    assert r.status_code == 201, r.text[:300]
    number = re.search(r"ART-\d{6}", r.text).group()
    assert c.post(f"/api/knowledge/articles/{number}/submit").status_code == 200
    assert c.post(f"/api/knowledge/articles/{number}/approve").status_code == 200
    return number


def _a_unread(link: Locator) -> int:
    return int(re.search(r"\d+", link.get_attribute("aria-label") or link.inner_text()).group())


@contextmanager
def _a_setting(app_url: str, name: str, new: Any, default: Any) -> Iterator[None]:
    r = grade(app_url, "PUT", "/api/grading/settings", {name: new})
    assert r.status_code == 200, f"PUT /api/grading/settings answered {r.status_code}: {r.text[:300]}"
    try:
        yield
    finally:
        grade(app_url, "PUT", "/api/grading/settings", {name: default})


def test_wf_incident_keyboard_grid_f2_selection(browser, app_url):
    set_clock(app_url, "2027-03-13T03:00:00+01:00")
    t = tag("kgf")
    nums = [make_record(app_url, "incident", {"short_description": f"{t} {s}", "description": "orig", "impact": 3, "urgency": 3,
                                              "assignment_group": "Triage"}) for s in ("one", "two", "three")]
    oona = as_user(app_url, "oona")
    flt = f'short_description startswith "{t}"'
    labels = {r["number"]: r["label"] for r in oona.get("/api/tables/incident/records", params={"filter": flt}).json()["records"]}
    assert set(labels) == set(nums), labels
    for n in nums:
        assert re.fullmatch(rf"Incident {n}, priority {MATRIX[(3, 3)]}, New, assigned to nobody, (SLA \d+ percent|no SLA)", labels[n]), labels[n]
    edited = f"{t} one edited"
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={q(flt)}") as page:
        grid = page.get_by_role("grid").first
        rows = [grid.get_by_role("row", name=labels[n], exact=True) for n in nums]
        for row in rows:
            expect(row).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the incident grid")
        _a_arrow_to(page, rows[0], "ArrowDown", "the first incident row")
        _a_focus_cell(page, rows[0], f"{t} one")
        other = grade(app_url, "POST", f"/api/grading/records/{nums[0]}/save",
                      {"as": "teodor", "fields": {"description": {"value": TECH_TEXT, "version": 1}}})
        assert other.status_code == 200, other.text[:300]
        page.keyboard.press("F2")
        page.locator(":focus").fill(edited)
        page.keyboard.press("Enter")
        expect(announcer(page)).to_have_text(f"Saved {nums[0]}.", timeout=UI_MS)
        poll(lambda: contains_focus(rows[0]) and _a_active_cell_text(page) == edited, UI_MS / 1000,
             "after Enter, focus returns to the edited Short description cell")
        rec = record(oona, nums[0])
        assert value(rec, "short_description") == edited and rec["fields"]["short_description"]["version"] == 2, rec["fields"]["short_description"]
        assert value(rec, "description") == TECH_TEXT, "the F2 save sends only its own field, so the concurrent description edit stays"
        page.keyboard.press("F2")
        page.locator(":focus").fill(f"{t} discarded")
        page.keyboard.press("Escape")
        expect(rows[0]).to_contain_text(edited, timeout=UI_MS)
        landed_by = time.monotonic() + 1
        while time.monotonic() < landed_by:
            assert value(record(oona, nums[0]), "short_description") == edited, "Escape cancels the cell edit"
        if not contains_focus(grid):
            tab_into(page, grid, "the incident grid")
        _a_arrow_to(page, rows[0], "ArrowUp", "the first incident row")
        page.keyboard.press("Space")
        page.keyboard.press("Shift+ArrowDown")
        _a_arrow_to(page, rows[2], "ArrowDown", "the third incident row")
        page.keyboard.press("Space")
        page.keyboard.press("Space")
        upd = page.get_by_role("button", name="Update selected")
        upd.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Bulk update")
        expect(dlg).to_be_visible(timeout=UI_MS)
        pick(dlg.get_by_role("combobox", name="Field"), "Urgency")
        dlg.get_by_role("textbox", name="Value").fill("2")
        dlg.get_by_role("button", name="Update", exact=True).focus()
        page.keyboard.press("Enter")
        expect(announcer(page)).to_have_text("2 updated, 0 not updated.", timeout=UI_MS)
        report = page.get_by_role("region", name="Bulk update report")
        expect(report.get_by_role("heading", name="Bulk update report")).to_be_focused(timeout=UI_MS)
        for n in nums[:2]:
            expect(report).to_contain_text(f"{n} updated")
        expect(report).not_to_contain_text(nums[2])
    assert [value(record(oona, n), "urgency") for n in nums] == [2, 2, 3]


def test_wf_incident_keyboard_suggestions_debounce(browser, app_url):
    set_clock(app_url, "2026-11-05T12:00:00+01:00")
    tok = tag("sug")
    oona = as_user(app_url, "oona")
    titles = [f"Fixing {tok} fast", f"{tok} first aid", "Spare parts list", "Cable notes"]
    ranked = [
        _a_publish_article(oona, {"title": titles[0], "keywords": [tok], "body": "Steps."}),
        _a_publish_article(oona, {"title": titles[1], "body": "Steps."}),
        _a_publish_article(oona, {"title": titles[2], "keywords": [tok], "body": f"Ask about {tok} first."}),
        _a_publish_article(oona, {"title": titles[3], "body": f"Mentions {tok} once."}),
    ]
    _a_publish_article(oona, {"title": f"Old {tok} fix", "keywords": [tok], "body": tok, "valid_until": "2026-11-04"})
    requester = make_user(app_url, ["requester"], "Design Studio")
    t = tag("ksd")
    n = make_record(app_url, "incident", {"short_description": t, "caller": requester["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with browse(browser, app_url, "oona", f"/desk/records/{n}", resume=False) as desk, \
            browse(browser, app_url, requester["username"], "/portal") as portal:
        field = desk.get_by_role("form", name=n).get_by_label("Short description")
        expect(field).to_be_visible(timeout=LOAD_MS)
        suggested = desk.get_by_role("list", name="Suggested articles")
        field.focus()
        desk.keyboard.press("Control+a")
        desk.keyboard.type(f"the {tok}")
        desk.clock.run_for(SUGGEST_MS - 100)
        early_until = time.monotonic() + 1
        while time.monotonic() < early_until:
            for title in titles:
                assert suggested.get_by_role("link", name=title, exact=True).count() == 0, "no suggestions before 300 ms of quiet"
        desk.clock.run_for(150)
        _a_pump_until(desk, lambda: [x.strip() for x in suggested.get_by_role("link").all_inner_texts()] == titles[:3], UI_MS / 1000,
                      "Suggested articles lists the top 3 by score once 300 ms have passed")
        expect(suggested.get_by_role("link")).to_have_text(titles[:3])
        box = portal.get_by_role("searchbox", name="Search knowledge")
        expect(box).to_be_visible(timeout=LOAD_MS)
        box.focus()
        portal.keyboard.type(tok)
        portal.keyboard.press("Enter")
        results = portal.get_by_role("list", name="Knowledge results").get_by_role("listitem")
        expect(results).to_have_count(len(titles), timeout=UI_MS)
        expect(results).to_contain_text(titles)
    sug = oona.get("/api/knowledge/suggest", params={"text": f"the {tok}"}).json()["articles"]
    assert [x["number"] for x in sug] == ranked[:3], sug


def test_wf_sla_clock_bar_motion_threshold(browser, app_url):
    set_clock(app_url, "2027-02-15T03:00:00+01:00")
    t = tag("sbm")
    name = _clock_definition(app_url, t, HOUR)
    tech = make_user(app_url, ["technician"])
    now = advance_clock(app_url, 0)
    n = make_record(app_url, "incident", {"short_description": t, "assigned_to": tech["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"},
                    state="assigned", created_at=(now - timedelta(seconds=1500)).isoformat())
    oona = as_user(app_url, "oona")
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as moving, \
            browse(browser, app_url, tech["username"], f"/desk/records/{n}", reduced_motion="reduce") as still:
        bars = []
        for page in (moving, still):
            region = page.get_by_role("region", name="SLA")
            bar = region.get_by_role("progressbar", name=name)
            expect(bar).to_be_visible(timeout=LOAD_MS)
            expect(region).to_contain_text(" left", timeout=UI_MS)
            page.evaluate(ANIM_RECORDER)
            bars.append(bar)
        advance_clock(app_url, 600)
        for page in (moving, still):
            expect(announcer(page)).to_have_text(f"SLA at 50 percent: {name}", timeout=UI_MS)
        poll(lambda: _A_SLA_BAR_MS in [round(d) for d in durations_on(bars[0])], UI_MS / 1000,
             "the SLA bar fill animates for 420 ms when the server sends the new value")
        assert durations_on(bars[1]) == [], durations_on(bars[1])
        assert still.evaluate("() => document.getAnimations().length") == 0, "reduced motion creates no animations"
        for page in (moving, still):
            region = page.get_by_role("region", name="SLA")
            poll(lambda: any(abs(v - sla_named(oona, n, name)["remaining_seconds"]) <= 5 for v in hms_values(region.inner_text())),
                 UI_MS / 1000, "the countdown follows the last server value plus elapsed browser time")
    s = sla_named(oona, n, name)
    assert 50 <= s["percent"] < 75, s


def test_wf_sla_clock_priority_swap_holiday(browser, app_url):
    set_clock(app_url, "2026-12-28T07:00:00+01:00")
    t = tag("sph")
    requester = make_user(app_url, ["requester"], "Design Studio")
    tech = make_user(app_url, ["technician"])
    hist = [{"state": "new", "at": "2026-12-23T16:00:00+01:00"}, {"state": "in_progress", "at": "2026-12-23T16:05:00+01:00"}]
    n = make_record(app_url, "incident", {"short_description": t, "caller": requester["username"], "assigned_to": tech["username"], "impact": 3, "urgency": 3,
                                          "assignment_group": "Triage"}, state="in_progress", created_at=hist[0]["at"], history=hist)
    elapsed = 10 * HOUR
    oona, tc = as_user(app_url, "oona"), as_user(app_url, tech["username"])
    first = sla_named(oona, n, "Incident resolution")
    assert first["priority"] == MATRIX[(3, 3)] and first["elapsed_seconds"] == elapsed and first["ticking"] is False, first
    new_priority = MATRIX[(1, 3)]
    new_left = RESOLUTION_TARGETS[new_priority] - elapsed
    t50 = f"{n} has used 50 percent of Incident resolution."
    t75 = f"{n} has used 75 percent of Incident resolution."
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as agent, browse(browser, app_url, requester["username"], f"/portal/incidents/{n}") as portal:
        region = agent.get_by_role("region", name="SLA")
        mine = portal.get_by_role("region", name="SLA")
        old_left = f"{fmt_hms(RESOLUTION_TARGETS[MATRIX[(3, 3)]] - elapsed)} left"
        expect(region).to_contain_text(old_left, timeout=LOAD_MS)
        expect(mine).to_contain_text(old_left, timeout=LOAD_MS)
        impact = agent.get_by_role("form", name=n).get_by_label("Impact")
        tab_into(agent, impact, "the Impact field")
        pick(impact, "1")
        agent.keyboard.press("Control+s")
        expect(region).to_contain_text(f"{fmt_hms(new_left)} left", timeout=UI_MS)
        expect(mine).to_contain_text(f"{fmt_hms(new_left)} left", timeout=UI_MS)
        res = [s for s in slas(oona, n) if s["definition"] == "Incident resolution"]
        assert any(s["stage"] == "cancelled" and s["priority"] == MATRIX[(3, 3)] for s in res), res
        live = [s for s in res if s["stage"] == "in_progress"]
        assert len(live) == 1 and live[0]["priority"] == new_priority and live[0]["elapsed_seconds"] == elapsed, res
        assert parse_instant(live[0]["start_at"]) == parse_instant(first["start_at"]), "the new SLA keeps the original start"
        poll(lambda: inbox_count(tc, t50) == 1, API_WAIT_S, "the already passed 50 percent threshold sends its item once")
        assert inbox_count(tc, t75) == 0
        set_clock(app_url, "2026-12-28T11:31:00+01:00")
        expect(announcer(agent)).to_have_text("SLA at 75 percent: Incident resolution", timeout=UI_MS)

        def agrees(loc: Locator) -> bool:
            left = sla_named(oona, n, "Incident resolution")["remaining_seconds"]
            return any(abs(v - left) <= 5 for v in hms_values(loc.inner_text()))

        poll(lambda: agrees(region) and agrees(mine), UI_MS / 1000, "agent and requester countdowns agree with the server after the clock jump")
    assert inbox_count(tc, t50) == 1 and inbox_count(tc, t75) == 1
    assert inbox_count(as_user(app_url, "mae"), t75) == 1, "the manager of the caller's department gets the 75 percent item"


def test_wf_form_conflict_two_field_choices(browser, app_url):
    t = tag("fcc")
    tech = make_user(app_url, ["technician"])
    who = tech["display_name"]
    n = _conflict_incident(app_url, t)
    mine_sd, theirs_sd = f"{t} mine", f"{t} theirs"
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as po, browse(browser, app_url, tech["username"], f"/desk/records/{n}") as pt:
        expect(po.get_by_role("listitem", name=f"{who} is viewing")).to_be_visible(timeout=LOAD_MS)
        fo, ft = po.get_by_role("form", name=n), pt.get_by_role("form", name=n)
        fo.get_by_label("Short description").fill(mine_sd)
        fo.get_by_label("Description", exact=True).fill(OONA_TEXT)
        ft.get_by_label("Short description").fill(theirs_sd)
        ft.get_by_label("Description", exact=True).fill(TECH_TEXT)
        ft.get_by_label("Description", exact=True).press("Control+s")
        expect(announcer(pt)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        fo.get_by_label("Description", exact=True).press("Control+s")
        dialog = po.get_by_role("dialog", name="Field conflict")
        expect(dialog).to_be_visible(timeout=UI_MS)
        for text in (f"Yours: {mine_sd}", f"Theirs: {theirs_sd}, saved by {who}", f"Yours: {OONA_TEXT}", f"Theirs: {TECH_TEXT}, saved by {who}"):
            expect(dialog).to_contain_text(text)
        sd_group = dialog.get_by_role("radiogroup", name="Short description", exact=True)
        d_group = dialog.get_by_role("radiogroup", name="Description", exact=True)
        expect(sd_group).to_be_visible()
        expect(d_group).to_be_visible()
        dialog.get_by_role("button", name="Cancel").focus()
        for _ in range(12):
            po.keyboard.press("Tab")
            assert contains_focus(dialog), "Tab wraps inside the Field conflict dialog"
        for _ in range(4):
            po.keyboard.press("Shift+Tab")
            assert contains_focus(dialog), "Shift+Tab wraps inside the Field conflict dialog"
        theirs = sd_group.get_by_role("radio", name="Use theirs")
        theirs.focus()
        po.keyboard.press("Space")
        expect(theirs).to_be_checked()
        keep = d_group.get_by_role("radio", name="Keep mine")
        keep.focus()
        po.keyboard.press("Space")
        expect(keep).to_be_checked()
        dialog.get_by_role("button", name="Apply choices").focus()
        po.keyboard.press("Enter")
        expect(dialog).to_have_count(0, timeout=UI_MS)
        expect(announcer(po)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        assert contains_focus(fo.get_by_label("Short description")) or contains_focus(fo.get_by_label("Description", exact=True)), \
            "after Apply choices, focus returns to a field that was in conflict"
        expect(fo.get_by_label("Short description")).to_have_value(theirs_sd, timeout=UI_MS)
    oona = as_user(app_url, "oona")
    rec = record(oona, n)
    assert value(rec, "short_description") == theirs_sd and value(rec, "description") == OONA_TEXT
    audit = oona.get(f"/api/records/{n}/audit").json()["entries"]
    pairs = {(a["field"], a["before"], a["after"]) for a in audit}
    assert {("short_description", t, theirs_sd), ("description", "start", TECH_TEXT), ("description", TECH_TEXT, OONA_TEXT)} <= pairs, audit
    assert any(a["field"] == "description" and a["after"] == OONA_TEXT and a["actor"] in ("oona", OONA_NAME) for a in audit), audit
    assert all(a["after"] != mine_sd for a in audit), "Use theirs keeps my short description out of the record and the audit"


def test_wf_form_conflict_rule_note_and_abort_live(browser, app_url):
    t = tag("fra")
    tech = make_user(app_url, ["technician"])
    oona = as_user(app_url, "oona")
    note = f"Urgency reviewed {t}"
    r = oona.post("/api/business-rules", json={"name": f"Review {t}", "table": "incident", "when": "after", "order": 100, "operations": ["update"],
                                               "condition": f'short_description = "{t}" and changes(urgency)', "actions": [{"work_note": note}], "active": True})
    assert r.status_code == 201, r.text[:300]
    n = make_record(app_url, "incident", {"short_description": t, "is_major": True, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    with browse(browser, app_url, "oona", f"/desk/records/{n}") as po, browse(browser, app_url, tech["username"], f"/desk/records/{n}") as pt:
        fo, ft = po.get_by_role("form", name=n), pt.get_by_role("form", name=n)
        expect(ft.get_by_role("button", name=move_label("In progress"))).to_be_visible(timeout=LOAD_MS)
        expect(ft.get_by_role("button", name=move_label("Cancelled"))).to_have_count(0)
        activity_t = pt.get_by_role("region", name="Activity")
        urgency = fo.get_by_label("Urgency")
        expect(urgency).to_be_visible(timeout=LOAD_MS)
        tab_into(po, urgency, "the Urgency field")
        pick(urgency, "2")
        po.keyboard.press("Control+s")
        expect(announcer(po)).to_have_text(f"Saved {n}.", timeout=UI_MS)
        expect(activity_t).to_contain_text(note, timeout=UI_MS)
        fo.get_by_label("Cancel reason").focus()
        po.keyboard.type("Duplicate report")
        fo.get_by_role("button", name=move_label("Cancelled")).focus()
        po.keyboard.press("Enter")
        text_shown_somewhere(po, "Major incidents are resolved, not cancelled.", UI_MS)
    rec = record(oona, n)
    assert rec["state"] == "new" and value(rec, "urgency") == 2 and value(rec, "priority") == MATRIX[(3, 2)]
    assert sum(1 for x in activity_texts(oona, n) if note in x) == 1, "the after rule wrote its note once"


def test_wf_form_conflict_presence_timeout_f6(browser, app_url):
    t = tag("fpt")
    tech = make_user(app_url, ["technician"])
    n = _conflict_incident(app_url, t)
    timeout = 15
    viewing = f"{tech['display_name']} is viewing"
    with _a_setting(app_url, "PRESENCE_TIMEOUT_SECONDS", timeout, _A_PRESENCE_DEFAULT):
        with browse(browser, app_url, "oona", f"/desk/records/{n}") as po, browse(browser, app_url, tech["username"], f"/desk/records/{n}") as pt:
            item = po.get_by_role("list", name="Also viewing").get_by_role("listitem", name=viewing)
            expect(item).to_be_visible(timeout=LOAD_MS)
            activity = po.get_by_role("region", name="Activity")
            queues = po.get_by_role("navigation", name="Queues")
            po.get_by_role("form", name=n).get_by_label("Short description").focus()
            po.keyboard.press("F6")
            poll(lambda: contains_focus(activity), 2, "F6 from the form moves focus to the activity region")
            po.keyboard.press("F6")
            poll(lambda: contains_focus(queues), 2, "F6 from activity moves focus back to the navigation")
            po.keyboard.press("Shift+F6")
            poll(lambda: contains_focus(activity), 2, "Shift+F6 moves focus backwards to the activity region")
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                assert item.count() == 1, "a viewer whose heartbeats keep arriving stays listed"
            pt.clock.pause_at(pt.evaluate("() => Date.now()") / 1000 + 0.5)
            expect(item).to_have_count(0, timeout=(timeout + 2) * 1000 + UI_SLACK_MS)
            expect(pt.get_by_role("form", name=n)).to_be_visible()
            pt.clock.resume()
            expect(item).to_be_visible(timeout=(_A_HEARTBEAT_S + 2) * 1000 + UI_SLACK_MS)


def test_wf_assign_oncall_rule_order_triage_notice(browser, app_url):
    set_clock(app_url, "2027-03-13T03:00:00+01:00")
    t = tag("aro")
    away = make_user(app_url, ["technician"], out_of_office=True)
    full = make_user(app_url, ["technician"], capacity=1)
    free = make_user(app_url, ["technician"], capacity=1)
    other = make_user(app_url, ["technician"])
    viewer = make_user(app_url, ["technician"])
    g_main, g_other = f"Main {t}", f"Other {t}"
    cond = f'short_description = "{t}"'
    fixtures(app_url, {"groups": [{"name": g_main, "members": [away["username"], full["username"], free["username"]], "escalation_policy": None},
                                  {"name": g_other, "members": [other["username"]], "escalation_policy": None}],
                       "assignment_rules": [
                           {"name": f"C {t}", "order": 5, "table": "incident", "condition": f'short_description = "{t} none"', "group": g_other, "active": True},
                           {"name": f"Y {t}", "order": 9, "table": "incident", "condition": cond, "group": g_main, "active": True},
                           {"name": f"Z {t}", "order": 9, "table": "incident", "condition": cond, "group": g_other, "active": True},
                           {"name": f"A {t}", "order": 10, "table": "incident", "condition": cond, "group": g_other, "active": True}]})
    p0 = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": g_main, "assigned_to": full["username"]},
                     state="assigned")
    oona, vc = as_user(app_url, "oona"), as_user(app_url, viewer["username"])
    with browse(browser, app_url, viewer["username"], f"/desk/lists/incident?filter={q(eq_filter(t))}") as page:
        grid = page.get_by_role("grid").first
        first_row = grid.get_by_role("row", name=re.compile(re.escape(p0)))
        expect(first_row).to_be_visible(timeout=LOAD_MS)
        created = []
        for _ in range(2):
            n = create_ok(oona, "incident", {"short_description": t, "impact": 3, "urgency": 3})
            created.append(n)
            notice = page.get_by_role("button", name="1 new record", exact=True)
            expect(notice).to_be_visible(timeout=UI_MS)
            expect(grid.get_by_role("row", name=re.compile(re.escape(n)))).to_have_count(0)
            notice.focus()
            page.keyboard.press("Enter")
            poll(lambda: contains_focus(first_row), UI_MS / 1000, "activating the notice moves focus to the first row")
        n1, n2 = created
        labels = {r["number"]: r["label"] for r in vc.get("/api/tables/incident/records", params={"filter": eq_filter(t)}).json()["records"]}
        assert f"assigned to {free['display_name']}," in labels[n1], labels[n1]
        assert f", assigned to {NOBODY}," in labels[n2], labels[n2]
        expect(grid.get_by_role("row", name=labels[n1], exact=True)).to_be_visible(timeout=UI_MS)
        row2 = grid.get_by_role("row", name=labels[n2], exact=True)
        expect(row2).to_be_visible(timeout=UI_MS)
        _a_arrow_to(page, row2, "ArrowDown", "the Triage row")
        page.keyboard.press("Enter")
        expect(page.get_by_role("form", name=n2)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("region", name="Activity")).to_contain_text(f"No one in {g_main} could take {n2}; sent to Triage.", timeout=UI_MS)
    r1, r2 = record(oona, n1), record(oona, n2)
    assert (value(r1, "assignment_group"), value(r1, "assigned_to")) == (g_main, free["username"])
    assert (value(r2, "assignment_group"), value(r2, "assigned_to")) == ("Triage", None)
    assert f'Assigned to {free["display_name"]} by rule "Y {t}".' in activity_texts(oona, n1)


def test_wf_assign_oncall_handover_pages_sheet(browser, app_url):
    set_clock(app_url, "2026-10-26T08:58:00+01:00")
    t = tag("aho")
    a, b, c = (make_user(app_url, ["technician"]) for _ in range(3))
    rotation, policy = f"Rot {t}", f"Pol {t}"
    fixtures(app_url, {"rotations": [{"name": rotation, "time_zone": "Europe/Berlin", "handover_weekday": "monday", "handover_time": "09:00",
                                      "members": [a["username"], b["username"]], "anchor_date": "2026-10-12"}],
                       "escalation_policies": [{"name": policy, "levels": [{"target": {"rotation": rotation}, "ack_minutes": 30},
                                                                           {"target": {"user": c["username"]}, "ack_minutes": 30}]}]})
    oona = as_user(app_url, "oona")
    early = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    later = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    r = oona.post(f"/api/records/{early}/page", json={"policy": policy})
    assert r.status_code == 201, r.text[:300]
    pg_early = r.json()["page"]
    assert pg_early["levels"][0]["username"] == b["username"], "before 09:00 local the shift from 19 October still runs"
    set_clock(app_url, "2026-10-26T09:00:30+01:00")
    r = oona.post(f"/api/records/{later}/page", json={"policy": policy})
    assert r.status_code == 201, r.text[:300]
    pg_later = r.json()["page"]
    assert pg_later["levels"][0]["username"] == a["username"], "the handover keeps 09:00 local after the clock change"
    with browse(browser, app_url, "oona", f"/desk/records/{later}") as desk, \
            browse(browser, app_url, a["username"], "/pages", width=375, height=812, resume=False) as phone:
        activity = desk.get_by_role("region", name="Activity")
        expect(activity).to_be_visible(timeout=LOAD_MS)
        card = phone.get_by_role("article", name=f"Page for {later}")
        expect(card).to_be_visible(timeout=LOAD_MS)
        touch_hold(phone, card, LONG_PRESS_MS + 100)
        sheet = phone.get_by_role("dialog", name="Page actions")
        expect(sheet).to_be_visible(timeout=UI_MS)
        sheet.get_by_role("button", name="Cancel").focus()
        for _ in range(8):
            phone.keyboard.press("Tab")
            assert contains_focus(sheet), "Tab wraps inside the Page actions sheet"
        phone.keyboard.press("Escape")
        expect(phone.get_by_role("dialog", name="Page actions")).to_have_count(0, timeout=UI_MS)
        assert find_page(oona, pg_later["id"])["status"] == "paging", "closing the sheet sends nothing"
        touch_hold(phone, card, LONG_PRESS_MS + 100)
        expect(sheet).to_be_visible(timeout=UI_MS)
        sheet.get_by_role("button", name="Acknowledge").focus()
        phone.keyboard.press("Enter")
        expect(announcer(phone)).to_have_text("Page acknowledged.", timeout=UI_MS)
        expect(activity).to_contain_text(f"Acknowledged by {a['display_name']} at level 1.", timeout=UI_MS)
    final = find_page(oona, pg_later["id"])
    assert final["status"] == "acknowledged" and final["late"] is False and final["acknowledged_level"] == 1, final
    advance_clock(app_url, 30 * 60)
    climbed = find_page(oona, pg_early["id"])
    assert climbed["status"] == "paging" and climbed["level"] == 2 and climbed["levels"][1]["username"] == c["username"], climbed
    assert find_page(oona, pg_later["id"])["status"] == "acknowledged", "an acknowledge stops the ladder"


def test_wf_assign_oncall_inbox_swipe_snap(browser, app_url):
    set_clock(app_url, "2027-03-24T02:00:00+01:00")
    t = tag("ais")
    u1, u2 = (make_user(app_url, ["technician"]) for _ in range(2))
    policy = f"Ladder {t}"
    fixtures(app_url, {"escalation_policies": [{"name": policy, "levels": [{"target": {"user": u1["username"]}, "ack_minutes": 5},
                                                                            {"target": {"user": u2["username"]}, "ack_minutes": 5}]}]})
    oona = as_user(app_url, "oona")
    n = make_record(app_url, "incident", {"short_description": t, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    r = oona.post(f"/api/records/{n}/page", json={"policy": policy})
    assert r.status_code == 201, r.text[:300]
    pg = r.json()["page"]
    text = f"Page for {n}: please acknowledge."
    with browse(browser, app_url, u2["username"], "/inbox") as desk, \
            browse(browser, app_url, u2["username"], "/pages", width=375, height=812, resume=False) as phone:
        link = desk.get_by_role("link", name=re.compile(r"^Inbox, \d+ unread$"))
        expect(link).to_be_visible(timeout=LOAD_MS)
        before = _a_unread(link)
        advance_clock(app_url, 310)
        expect(desk.get_by_role("list", name="Inbox").get_by_text(text, exact=True)).to_be_visible(timeout=UI_MS)
        expect(desk.get_by_role("link", name=f"Inbox, {before + 1} unread")).to_be_visible(timeout=UI_MS)
        assert find_page(oona, pg["id"])["level"] == 2
        card = phone.get_by_role("article", name=f"Page for {n}")
        expect(card).to_be_visible(timeout=LOAD_MS)
        phone.evaluate(ANIM_RECORDER)
        touch_swipe(phone, card, SWIPE_DISTANCE - 46)
        phone.clock.run_for(UNDO_MS + 1000)
        expect(card).to_be_visible()
        assert _A_SNAP_MS in [round(d) for d in durations_on(card)], durations_on(card)
        assert find_page(oona, pg["id"])["status"] == "paging", "a short swipe sends nothing"
        touch_swipe(phone, card, SWIPE_DISTANCE + 40)
        expect(phone.get_by_role("button", name="Undo")).to_be_visible(timeout=UI_MS)
        phone.clock.run_for(UNDO_MS + 200)
        expect(announcer(phone)).to_have_text("Page acknowledged.", timeout=UI_MS)
        mark = desk.get_by_role("button", name="Mark all read")
        mark.focus()
        desk.keyboard.press("Enter")
        expect(desk.get_by_role("link", name=inbox_link(0))).to_be_visible(timeout=UI_MS)
    final = find_page(oona, pg["id"])
    assert final["status"] == "acknowledged" and final["late"] is False and final["acknowledged_level"] == 2, final
    assert f"Acknowledged by {u2['display_name']} at level 2." in activity_texts(oona, n)
    c2 = as_user(app_url, u2["username"])
    assert c2.get("/api/inbox").json()["unread"] == 0 and inbox_count(c2, text) == 1


_B_FOCUSED_XY = """() => {
  const e = document.activeElement;
  const h = (e && e.closest('[data-x]')) || e;
  return [Number(h.dataset.x), Number(h.dataset.y)];
}"""

_B_FOCUSED_LABEL = """() => {
  const e = document.activeElement;
  if (!e) return '';
  const l = e.getAttribute('aria-label');
  if (l) return l;
  const ids = e.getAttribute('aria-labelledby');
  if (ids) return ids.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
  return (e.textContent || '').trim();
}"""


def _b_node(page: Page, name: str, cls: str, status: str) -> Locator:
    return page.get_by_role("group", name="Service map").get_by_role("button", name=f"{name}, {cls}, {status}", exact=True)


def _b_mark_by_keyboard(page: Page, name: str, cls: str, before: str, action: str, after: str) -> None:
    node = _b_node(page, name, cls, before)
    expect(node).to_have_count(1, timeout=LOAD_MS)
    node.focus()
    page.keyboard.press("Enter")
    details = page.get_by_role("region", name=f"{name} details")
    expect(details).to_be_visible(timeout=UI_MS)
    mark = page.get_by_role("button", name=action, exact=True)
    mark.focus()
    page.keyboard.press("Enter")
    changed_node = _b_node(page, name, cls, after)
    expect(changed_node).to_have_count(1, timeout=UI_MS)
    if details.is_visible():
        changed_node.focus()
        page.keyboard.press("Enter")
    expect(details).to_be_hidden(timeout=UI_MS)


def test_wf_service_map_cluster_quorum_by_keyboard(browser, app_url):
    t = tag("smq")

    def N(s: str) -> str:
        return f"{t} {s}"

    fixtures(app_url, {"cis": [ci(N("cluster"), "Cluster", 3, required_healthy=2), ci(N("m1"), "Server", 2), ci(N("m2"), "Server", 2), ci(N("m3"), "Server", 2),
                               ci(N("app"), "Application", 3), ci(N("svc"), "Business service", 3, used_by={"departments": [], "people": ["ops05"]})],
                       "relationships": [rel(N("m1"), "member of", N("cluster")), rel(N("m2"), "member of", N("cluster")), rel(N("m3"), "member of", N("cluster")),
                                         rel(N("app"), "runs on", N("cluster")), rel(N("svc"), "depends on", N("app"))]})
    manager = make_user(app_url, ["manager"], "Leadership")
    oona = as_user(app_url, "oona")
    nodes = oona.get("/api/service-map").json()["nodes"]
    here = [n for n in nodes if n["name"] == N("cluster")][0]
    below = [n for n in nodes if n["y"] == here["y"] + MAP_DY]
    target = min(below, key=lambda n: (abs(n["x"] - here["x"]), n["x"]))

    def dependents(page: Page, status: str) -> None:
        expect(_b_node(page, N("cluster"), "Cluster", status)).to_have_count(1, timeout=UI_MS)
        expect(_b_node(page, N("app"), "Application", status)).to_have_count(1, timeout=UI_MS)
        expect(_b_node(page, N("svc"), "Business service", status)).to_have_count(1, timeout=UI_MS)

    with browse(browser, app_url, "oona", "/desk/map") as po, browse(browser, app_url, manager["username"], "/desk/map") as pm:
        cluster = _b_node(po, N("cluster"), "Cluster", "Healthy")
        expect(cluster).to_have_count(1, timeout=LOAD_MS)
        cluster.focus()
        po.keyboard.press("ArrowDown")
        poll(lambda: po.evaluate(_B_FOCUSED_XY) == [target["x"], target["y"]], UI_MS / 1000, f"ArrowDown focuses the nearest node below {target}")
        _b_mark_by_keyboard(po, N("m1"), "Server", "Healthy", "Mark down", "Down")
        dependents(po, "Degraded")
        imp = oona.get(f"/api/cis/{q(N('m1'))}/impact").json()
        assert imp["affected"] == [] and imp["people_total"] == 0, imp
        pm.reload()
        dependents(pm, "Degraded")
        _b_mark_by_keyboard(po, N("m2"), "Server", "Healthy", "Mark down", "Down")
        dependents(po, "Down")
        imp = oona.get(f"/api/cis/{q(N('m2'))}/impact").json()
        assert [a["ci"]["name"] for a in imp["affected"]] == [N("cluster"), N("app"), N("svc")], imp["affected"]
        assert imp["people_total"] == 1, imp
        pm.reload()
        dependents(pm, "Down")
        _b_mark_by_keyboard(po, N("m2"), "Server", "Down", "Mark healthy", "Healthy")
        dependents(po, "Degraded")
        expect(_b_node(po, N("m1"), "Server", "Down")).to_have_count(1)
        pm.reload()
        dependents(pm, "Degraded")
    assert oona.get(f"/api/cis/{q(N('svc'))}").json()["ci"]["effective_status"] == "degraded"


def test_wf_service_map_expand_collapse_motion_and_phone(browser, app_url):
    t = tag("smx")
    app, host = f"{t} app", f"{t} host"
    fixtures(app_url, {"cis": [ci(app, "Application", 2), ci(host, "Server", 2)], "relationships": [rel(app, "runs on", host)]})
    with browse(browser, app_url, "oona", "/desk/map") as po, \
            browse(browser, app_url, "oona", "/desk/map", width=375, height=812, reduced_motion="reduce") as pp:
        node = _b_node(po, app, "Application", "Healthy")
        expect(node).to_have_count(1, timeout=LOAD_MS)
        po.evaluate(ANIM_RECORDER)
        node.focus()
        po.keyboard.press("Enter")
        details = po.get_by_role("region", name=f"{app} details")
        expect(details).to_be_visible(timeout=UI_MS)
        poll(lambda: MAP_EXPAND_MS in [round(d) for d in durations_on(details)], UI_MS / 1000, "expanding runs a 420 ms animation on the details region")
        node.focus()
        po.keyboard.press("Enter")
        expect(details).to_be_hidden(timeout=UI_MS)
        pnode = _b_node(pp, app, "Application", "Healthy")
        expect(pnode).to_have_count(1, timeout=LOAD_MS)
        pp.evaluate(ANIM_RECORDER)
        pnode.focus()
        pp.keyboard.press("Enter")
        pdetails = pp.get_by_role("region", name=f"{app} details")
        expect(pdetails).to_be_visible(timeout=UI_MS)
        assert durations_on(pdetails) == []
        assert pp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "no horizontal page overflow at 375 px"
        pnode.focus()
        pp.keyboard.press("Enter")
        expect(pdetails).to_be_hidden(timeout=UI_MS)
        assert pp.evaluate("() => (window.__swAnims || []).length") == 0
        assert pp.evaluate("() => document.getAnimations().length") == 0


def test_wf_major_incident_keyboard_resolve_watched(browser, app_url):
    t = tag("mkr")
    names = _map_items(app_url, t)
    manager = make_user(app_url, ["manager"], "Leadership")
    caller = make_user(app_url, ["requester"], "Leadership")
    kids = [make_record(app_url, "incident", {"short_description": f"{t} {k}", "caller": caller["username"], "configuration_item": names[k], "impact": 3,
                                              "urgency": 3, "assignment_group": "Triage", "assigned_to": "oona"}, state=s)
            for k, s in (("svc1", "assigned"), ("svc2", "in_progress"))]
    oona = as_user(app_url, "oona")
    oona.post(f"/api/cis/{q(names['array'])}/status", json={"status": "down"})
    major = oona.post(f"/api/major-proposals/{_proposal_for(oona, names['array'])['id']}/promote").json()["record"]["number"]
    assert sorted(record(oona, major)["links"]["children"]) == sorted(kids)
    move_ok(oona, major, "assigned", assigned_to="oona")
    move_ok(oona, major, "in_progress")
    note = f"Controller swapped {t}"
    with browse(browser, app_url, "oona", f"/desk/major/{major}") as po, browse(browser, app_url, manager["username"], f"/desk/major/{major}") as pm:
        watched = pm.get_by_role("list", name="Child incidents")
        for k in kids:
            expect(watched.get_by_role("listitem").filter(has_text=k)).to_have_count(1, timeout=LOAD_MS)
        opener = po.get_by_role("button", name="Resolve together")
        expect(opener).to_be_visible(timeout=LOAD_MS)
        opener.focus()
        po.keyboard.press("Enter")
        dlg = po.get_by_role("dialog", name="Resolve together")
        expect(dlg).to_be_visible(timeout=UI_MS)
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            po.keyboard.press(key)
            assert contains_focus(dlg), "focus never leaves the open dialog"
        po.keyboard.press("Escape")
        expect(dlg).to_have_count(0, timeout=UI_MS)
        assert is_focused(opener), "Escape returns focus to the opener"
        assert record(oona, major)["state"] == "in_progress"
        opener.focus()
        po.keyboard.press("Enter")
        expect(dlg).to_be_visible(timeout=UI_MS)
        pick(dlg.get_by_role("combobox", name="Resolution code"), "fixed")
        dlg.get_by_role("textbox", name="Resolution note").focus()
        po.keyboard.type(note)
        dlg.get_by_role("button", name="Resolve").focus()
        po.keyboard.press("Enter")
        expect(announcer(po)).to_have_text(f"{major} moved to Resolved.", timeout=UI_MS)
        for k in kids:
            expect(watched.get_by_role("listitem").filter(has_text=k)).to_contain_text("Resolved", timeout=UI_MS)
        move_ok(as_user(app_url, "teodor"), kids[1], "in_progress", reopen_reason="Still failing")
        expect(watched.get_by_role("listitem").filter(has_text=kids[1])).to_contain_text("In progress", timeout=UI_MS)
        expect(watched.get_by_role("listitem").filter(has_text=kids[0])).to_contain_text("Resolved")
    assert record(oona, major)["state"] == "resolved"
    first = record(oona, kids[0])
    assert first["state"] == "resolved" and value(first, "resolution_code") == "fixed"
    assert value(first, "resolution_note") == f"Resolved with major incident {major}: {note}"


def _b_calendar_go(page: Page, target: date) -> date:
    d = _cell_date(page.evaluate(_B_FOCUSED_LABEL))
    for _ in range(80):
        if (d.year, d.month) == (target.year, target.month):
            break
        forward = (d.year, d.month) < (target.year, target.month)
        page.keyboard.press("PageDown" if forward else "PageUp")
        want = _month_shift(d, 1 if forward else -1)
        d = _cell_date(page.evaluate(_B_FOCUSED_LABEL))
        assert d == want, (d, want)
    delta = (target - d).days
    while abs(delta) >= 7:
        page.keyboard.press("ArrowDown" if delta > 0 else "ArrowUp")
        delta += -7 if delta > 0 else 7
    for _ in range(abs(delta)):
        page.keyboard.press("ArrowRight" if delta > 0 else "ArrowLeft")
    d = _cell_date(page.evaluate(_B_FOCUSED_LABEL))
    assert d == target, (d, target)
    return d


def _b_cell_name(d: date, n: int) -> str:
    return f"{WEEKDAYS[d.weekday()]}, {d.day} {MONTHS[d.month - 1]} {d.year}, {n} {'change' if n == 1 else 'changes'}"


def test_wf_change_risk_dependency_overlap_and_calendar(browser, app_url):
    set_clock(app_url, "2028-08-21T10:00:00+02:00")
    t = tag("cdo")
    app, svc, freeze = f"{t} app", f"{t} svc", f"Freeze {t}"
    fixtures(app_url, {"cis": [ci(app, "Application", 1, owner="Finance"), ci(svc, "Business service", 1, owner="Finance", used_by={"departments": [], "people": []})],
                       "relationships": [rel(svc, "depends on", app)],
                       "freeze_windows": [{"name": freeze, "start": "2028-09-14T00:00:00+02:00", "end": "2028-09-15T00:00:00+02:00", "time_zone": "Europe/Berlin", "scope": {"items": [app]}}]})
    oona = as_user(app_url, "oona")
    start, end = "2028-09-13T10:00:00+02:00", "2028-09-13T12:00:00+02:00"
    x = new_change(oona, app, start, end, f"{t} base", backout_tested=True)
    move_ok(oona, x, "assessed")
    z = new_change(oona, svc, start, end, f"{t} dependent", backout_tested=True)
    with browse(browser, app_url, "oona", f"/desk/records/{z}") as page:
        b = page.get_by_role("button", name=move_label("Assessed"))
        expect(b).to_be_visible(timeout=LOAD_MS)
        b.focus()
        page.keyboard.press("Enter")
        msg = f"This change overlaps {x} on {app}, which {svc} depends on (2028-09-13 10:00 to 2028-09-13 12:00)."
        expect(page.get_by_text(msg, exact=True).first).to_be_visible(timeout=UI_MS)
        assert record(oona, z)["state"] == "draft"
        days = {d["date"]: d for d in oona.get("/api/changes/calendar", params={"month": "2028-09"}).json()["days"]}
        day13, day14 = days["2028-09-13"], days["2028-09-14"]
        numbers13 = [c["number"] for c in day13["changes"]]
        assert x in numbers13 and z not in numbers13, numbers13
        assert freeze in day14["freezes"] and freeze not in day13["freezes"]
        page.goto(base(app_url) + "/desk/changes/calendar")
        grid = page.get_by_role("grid", name="Change calendar")
        expect(grid).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the change calendar")
        d13 = _b_calendar_go(page, date(2028, 9, 13))
        cell13 = grid.get_by_role("gridcell", name=_b_cell_name(d13, len(day13["changes"])), exact=True)
        expect(cell13).to_have_count(1)
        assert contains_focus(cell13), "focus is on the day cell named with the server's change count"
        if not day13["freezes"]:
            expect(cell13).not_to_contain_text("Freeze")
        page.keyboard.press("ArrowRight")
        cell14 = grid.get_by_role("gridcell", name=_b_cell_name(date(2028, 9, 14), len(day14["changes"])), exact=True)
        expect(cell14).to_have_count(1)
        assert contains_focus(cell14)
        expect(cell14).to_contain_text("Freeze")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=f"Changes on {d13.day} {MONTHS[d13.month - 1]} {d13.year}")
        expect(dlg).to_be_visible(timeout=UI_MS)
        expect(dlg.get_by_role("link").filter(has_text=re.compile(f"{re.escape(x)}|{re.escape(t)} base"))).to_have_count(1)
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0, timeout=UI_MS)
        assert _cell_date(page.evaluate(_B_FOCUSED_LABEL)) == d13


def _b_board(oona: httpx.Client, rule: str, members: list[tuple[str, int]], n: int | None, threshold: int | None) -> None:
    body = {"name": "Change board", "rule": rule, "n": n, "threshold_percent": threshold, "window_hours": 48,
            "members": [{"username": u, "weight": w} for u, w in members]}
    r = oona.put("/api/boards/Change board", json=body)
    assert r.status_code == 200, r.text


def _b_board_change(app_url: str, t: str, creator: str, start: str) -> str:
    name = f"{t} item"
    fixtures(app_url, {"cis": [ci(name, "Application", 2, owner="Finance")]})
    c = as_user(app_url, creator)
    n = new_change(c, name, start, (parse_instant(start) + timedelta(hours=6)).isoformat(), f"{t} change", backout_tested=False)
    move_ok(c, n, "assessed")
    move_ok(c, n, "peer_review")
    assert vote(as_user(app_url, "ana"), n, 1, "approve").status_code == 201
    poll(lambda: record(c, n)["state"] == "board_vote", API_WAIT_S, f"{n} reaches the board vote")
    return n


def _b_count_tally(a: int, r: int, w: int, need: int, of: int) -> str:
    return f"Approve {a}, reject {r}, waiting {w}. Needs {need} of {of}."


def test_wf_change_board_n_of_m_phone_swipe_live(browser, app_url):
    set_clock(app_url, "2029-03-05T09:00:00+01:00")
    t = tag("bnm")
    u1, u2, u3 = (make_user(app_url, ["approver"], "Leadership") for _ in range(3))
    op2 = make_user(app_url, ["operator"])
    oona = as_user(app_url, "oona")
    try:
        _b_board(oona, "n_of_m", [(u1["username"], 1), (u2["username"], 1), (u3["username"], 1)], 2, None)
        n = _b_board_change(app_url, t, op2["username"], "2029-03-07T10:00:00+01:00")

        def decision(user: dict) -> Any:
            return [v for v in steps_of(oona, n)[1]["voters"] if v["username"] == user["username"]][0]["decision"]

        with browse(browser, app_url, u2["username"], f"/desk/records/{n}") as desk, \
                browse(browser, app_url, u1["username"], "/approve", width=375, height=812, resume=False) as phone, \
                browse(browser, app_url, op2["username"], "/inbox") as inbox:
            board = desk.get_by_role("region", name="Approvals").get_by_role("group", name="Change board")
            tally = board.get_by_role("region", name="Tally")
            expect(tally).to_contain_text(_b_count_tally(0, 0, 3, 2, 3), timeout=LOAD_MS)
            card = phone.get_by_role("article", name=f"{n}: {t} change")
            expect(card).to_be_visible(timeout=LOAD_MS)
            touch_swipe(phone, card, SWIPE_DISTANCE + 40)
            expect(announcer(phone)).to_have_text(f"Approving {n}. Undo within 5 seconds.", timeout=UI_MS)
            phone.clock.run_for(UNDO_MS - 2000)
            phone.get_by_role("button", name="Undo").click()
            expect(announcer(phone)).to_have_text("Vote undone.", timeout=UI_MS)
            expect(card).to_be_visible(timeout=UI_MS)
            phone.clock.run_for(UNDO_MS + 1000)
            assert decision(u1) is None, "Undo within 5 seconds sends nothing"
            expect(tally).to_contain_text(_b_count_tally(0, 0, 3, 2, 3))
            touch_swipe(phone, card, -(SWIPE_DISTANCE + 40))
            expect(announcer(phone)).to_have_text(f"Rejecting {n}. Undo within 5 seconds.", timeout=UI_MS)
            phone.clock.run_for(UNDO_MS + 200)
            expect(announcer(phone)).to_have_text(f"Vote recorded: reject on {n}.", timeout=UI_MS)
            phone.clock.resume()
            expect(phone.get_by_text("No votes waiting for you.", exact=True)).to_be_visible(timeout=UI_MS)
            expect(phone.get_by_role("button", name="Open changes")).to_be_focused(timeout=UI_MS)
            expect(tally).to_contain_text(_b_count_tally(0, 1, 2, 2, 3), timeout=UI_MS)
            approve = board.get_by_role("button", name="Approve")
            approve.focus()
            desk.keyboard.press("Enter")
            expect(announcer(desk)).to_have_text(f"Vote recorded: approve on {n}.", timeout=UI_MS)
            expect(tally).to_contain_text(_b_count_tally(1, 1, 1, 2, 3), timeout=UI_MS)
            assert steps_of(oona, n)[1]["status"] == "open"
            r = vote(as_user(app_url, u3["username"]), n, 2, "reject")
            assert r.status_code == 201 and r.json()["step"]["status"] == "rejected", r.text
            expect(tally).to_contain_text(_b_count_tally(1, 2, 0, 2, 3), timeout=UI_MS)
            expect(tally).to_contain_text("Closed: rejected", timeout=UI_MS)
            expect(inbox.get_by_role("list", name="Inbox")).to_contain_text(f"{n} was rejected at Change board.", timeout=UI_MS)
        assert record(oona, n)["state"] == "rejected"
        assert decision(u1) == "reject"
    finally:
        oona.put("/api/boards/Change board", json=CHANGE_BOARD_SEED)


def test_wf_change_board_weighted_threshold_delegate_live(browser, app_url):
    set_clock(app_url, "2029-03-12T09:00:00+01:00")
    t = tag("bwt")
    w1, w2, w3, d = (make_user(app_url, ["approver"], "Leadership") for _ in range(4))
    op2 = make_user(app_url, ["operator"])
    fixtures(app_url, {"delegations": [{"member": w3["username"], "delegate": d["username"], "from": "2029-03-12T00:00:00+01:00", "to": "2029-03-13T00:00:00+01:00"}]})
    oona = as_user(app_url, "oona")
    try:
        _b_board(oona, "weighted", [(w1["username"], 3), (w2["username"], 1), (w3["username"], 1)], None, 60)
        n = _b_board_change(app_url, t, op2["username"], "2029-03-14T10:00:00+01:00")
        with browse(browser, app_url, w2["username"], f"/desk/records/{n}") as p2, browse(browser, app_url, w1["username"], f"/desk/records/{n}") as p1, \
                browse(browser, app_url, op2["username"], "/inbox") as inbox:
            g1 = p1.get_by_role("region", name="Approvals").get_by_role("group", name="Change board")
            g2 = p2.get_by_role("region", name="Approvals").get_by_role("group", name="Change board")
            t1, t2 = g1.get_by_role("region", name="Tally"), g2.get_by_role("region", name="Tally")
            expect(t1).to_contain_text(weight_tally(0, 0, 5, 3, 5), timeout=LOAD_MS)
            reject = g2.get_by_role("button", name="Reject")
            reject.focus()
            p2.keyboard.press("Enter")
            expect(announcer(p2)).to_have_text(f"Vote recorded: reject on {n}.", timeout=UI_MS)
            expect(t1).to_contain_text(weight_tally(0, 1, 4, 3, 5), timeout=UI_MS)
            r = vote(as_user(app_url, d["username"]), n, 2, "reject", on_behalf_of=w3["username"])
            assert r.status_code == 201, r.text
            assert r.json()["vote"]["voter"] == w3["username"] and r.json()["vote"]["voted_by"] == d["username"]
            assert r.json()["step"]["status"] == "open", "100 x (5 - 2) = 300 is not below 60 x 5"
            expect(t1).to_contain_text(weight_tally(0, 2, 3, 3, 5), timeout=UI_MS)
            expect(t2).to_contain_text(weight_tally(0, 2, 3, 3, 5), timeout=UI_MS)
            approve = g1.get_by_role("button", name="Approve")
            approve.focus()
            p1.keyboard.press("Enter")
            expect(announcer(p1)).to_have_text(f"Vote recorded: approve on {n}.", timeout=UI_MS)
            expect(t1).to_contain_text(weight_tally(3, 2, 0, 3, 5), timeout=UI_MS)
            expect(t1).to_contain_text("Closed: approved", timeout=UI_MS)
            expect(t2).to_contain_text("Closed: approved", timeout=UI_MS)
            expect(inbox.get_by_role("list", name="Inbox")).to_contain_text(f"{n} was approved at Change board.", timeout=UI_MS)
        assert record(oona, n)["state"] == "approved"
        voters = {v["username"]: v for v in steps_of(oona, n)[1]["voters"]}
        assert voters[w3["username"]]["decision"] == "reject" and voters[w3["username"]]["voted_by"] == d["username"]
        assert d["username"] not in voters, "the delegate is not counted as a voter of their own"
    finally:
        oona.put("/api/boards/Change board", json=CHANGE_BOARD_SEED)


def _b_choice_labels(locator: Locator) -> list[str]:
    labels = locator.evaluate("e => e.tagName === 'SELECT' ? [...e.options].filter(o => o.value !== '').map(o => (o.label || o.text || '').trim()) : null")
    if labels is not None:
        return labels
    page = locator.page
    locator.focus()
    page.keyboard.press("ArrowDown")
    options = page.get_by_role("option")
    names = [options.nth(i).inner_text().strip() for i in range(options.count())]
    page.keyboard.press("Escape")
    return names


def _b_press(page: Page, locator: Locator) -> None:
    expect(locator).to_be_visible(timeout=LOAD_MS)
    locator.focus()
    page.keyboard.press("Enter")


def test_wf_catalog_request_choices_policies_cart_keyboard(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    uc = as_user(app_url, u["username"])
    dv, lv, sv = _vars(uc, "shared-drive"), _vars(uc, "laptop"), _vars(uc, "software-licence")
    with browse(browser, app_url, u["username"], "/portal/items/shared-drive") as page:
        drive, access = page.get_by_label(dv["drive"]["label"]), page.get_by_label(dv["access"]["label"])
        expect(drive).to_be_visible(timeout=LOAD_MS)
        select(drive, "Archive")
        poll(lambda: _b_choice_labels(access) == ["Read"], UI_MS / 1000, "Archive offers only Read")
        select(drive, "Projects")
        poll(lambda: _b_choice_labels(access) == ["Read", "Write"], UI_MS / 1000, "Projects offers Read and Write")
        select(access, "Write")
        _b_press(page, page.get_by_role("button", name="Add to cart"))
        cart_lines(uc, 1)
        page.goto(base(app_url) + "/portal/items/laptop")
        model, memory = page.get_by_label(lv["model"]["label"]), page.get_by_label(lv["memory"]["label"])
        expect(model).to_be_visible(timeout=LOAD_MS)
        select(model, "Studio 16-inch")
        expect(page.get_by_label("Why you need it")).to_be_visible(timeout=POLICY_MS + UI_SLACK_MS)
        poll(lambda: _b_choice_labels(memory) == ["32 GB", "64 GB"], UI_MS / 1000, "Studio 16-inch offers 32 GB and 64 GB")
        select(model, "Standard 14-inch")
        poll(lambda: _b_choice_labels(memory) == ["16 GB"], UI_MS / 1000, "Standard 14-inch offers only 16 GB")
        select(memory, "16 GB")
        _b_press(page, page.get_by_role("button", name="Add to cart"))
        cart_lines(uc, 2)
        page.goto(base(app_url) + "/portal/items/software-licence")
        cost = page.get_by_label(sv["cost_centre"]["label"])
        expect(cost).to_have_value("Design Studio", timeout=LOAD_MS)
        select(page.get_by_label(sv["seat"]["label"]), "CAD seat")
        _b_press(page, page.get_by_role("button", name="Add to cart"))
        cart_lines(uc, 3)
        page.goto(base(app_url) + "/portal/cart")
        _b_press(page, page.get_by_role("button", name="Remove Laptop"))
        cart_lines(uc, 2)
        expect(page.get_by_role("button", name="Remove Laptop")).to_have_count(0, timeout=UI_MS)
        _b_press(page, page.get_by_role("button", name="Submit request"))
        expect(announcer(page)).to_have_text(re.compile(r"^Request ASK-\d{6} submitted with 2 items\.$"), timeout=UI_MS)
        ask = re.search(r"ASK-\d{6}", announcer(page).inner_text()).group()
        items = {i["item"]: i["number"] for i in uc.get(f"/api/requests/{ask}").json()["request"]["items"]}
        assert set(items) == {"shared-drive", "software-licence"}, items
        page.goto(base(app_url) + f"/portal/requests/{ask}")
        status = page.get_by_role("region", name="Request status")
        expect(status.get_by_role("listitem").filter(has_text=f"{items['shared-drive']} Shared drive access: Awaiting approval")).to_be_visible(timeout=LOAD_MS)
        expect(status.get_by_role("listitem").filter(has_text=f"{items['software-licence']} Software licence: Fulfilling")).to_be_visible(timeout=LOAD_MS)
    rec = record(as_user(app_url, "oona"), items["software-licence"])
    assert value(rec, "variables")["cost_centre"] == "Design Studio" and value(rec, "variables")["seat"] == "cad"
    assert value(record(as_user(app_url, "oona"), items["shared-drive"]), "variables")["access"] == "write"


def test_wf_catalog_request_desk_cancel_tracked_live(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    uc = as_user(app_url, u["username"])
    assert uc.post("/api/cart/lines", json={"item": "shared-drive", "quantity": 1, "variables": {"drive": "finance", "access": "write"}}).status_code == 201
    assert uc.post("/api/cart/lines", json={"item": "building-pass", "quantity": 1, "variables": {"office": "kanal", "start_date": "2027-03-01"}}).status_code == 201
    r = uc.post("/api/cart/checkout", json={"requested_for": None})
    assert r.status_code == 201, r.text
    ask = r.json()["request"]["number"]
    items = {i["item"]: i["number"] for i in r.json()["request"]["items"]}
    drive_item, pass_item = items["shared-drive"], items["building-pass"]

    def detail() -> dict:
        return {i["item"]: i for i in uc.get(f"/api/requests/{ask}").json()["request"]["items"]}

    poll(lambda: detail()["shared-drive"]["state"] == "awaiting_approval" and detail()["building-pass"]["tasks"], API_WAIT_S,
         "the drive item waits for approval and the pass item has its task")
    job = detail()["building-pass"]["tasks"][0]["number"]
    with browse(browser, app_url, u["username"], f"/portal/requests/{ask}") as portal, browse(browser, app_url, "oona", f"/desk/records/{drive_item}") as desk:
        status = portal.get_by_role("region", name="Request status")
        expect(status.get_by_role("listitem").filter(has_text=f"{drive_item} Shared drive access: Awaiting approval")).to_be_visible(timeout=LOAD_MS)
        expect(status.get_by_role("listitem").filter(has_text=f"{pass_item} Building pass: Fulfilling")).to_be_visible(timeout=LOAD_MS)
        form = desk.get_by_role("form", name=drive_item)
        expect(form).to_be_visible(timeout=LOAD_MS)
        cancel = desk.get_by_role("button", name=move_label("Cancelled"))
        _b_press(desk, cancel)
        expect(desk.get_by_text("Cancel reason is required to move to Cancelled.", exact=True).first).to_be_visible(timeout=UI_MS)
        assert detail()["shared-drive"]["state"] == "awaiting_approval"
        move_ok(as_user(app_url, "oona"), drive_item, "cancelled", cancel_reason="Access no longer needed")
        expect(status.get_by_role("listitem").filter(has_text=f"{drive_item} Shared drive access: Cancelled")).to_be_visible(timeout=UI_MS)
        assert uc.get(f"/api/requests/{ask}").json()["request"]["state"] == "open", "one item is still being fulfilled"
        tc = as_user(app_url, "teodor")
        move_ok(tc, job, "in_progress")
        move_ok(tc, job, "done", close_note="Pass printed")
        expect(status).to_contain_text(f"{job}: Done", timeout=UI_MS)
        expect(status.get_by_role("listitem").filter(has_text=f"{pass_item} Building pass: Delivered")).to_be_visible(timeout=UI_MS)
    poll(lambda: uc.get(f"/api/requests/{ask}").json()["request"]["state"] == "closed", API_WAIT_S, "the request closes once every item is delivered or cancelled")


_TOKYO = ZoneInfo("Asia/Tokyo")


def _row(grid: Locator, number: str) -> Locator:
    return grid.get_by_role("row", name=re.compile(re.escape(number)))


def _link_count(link: Locator) -> int:
    text = link.get_attribute("aria-label") or link.inner_text()
    return int(re.search(r"(\d+)\s*$", text).group(1))


def test_wf_workflow_designer_subflow_chain_keyboard(browser, app_url):
    t = tag("sc")
    oona = as_user(app_url, "oona")
    a_name, b_name = f"Sub A {t}", f"Sub B {t}"
    call_b, repeat, ping, first = f"Call B {t}", f"Repeat {t}", f"Ping {t}", f"First {t}"
    sa = oona.post("/api/workflows", json={"name": a_name, "kind": "subflow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
    sb = oona.post("/api/workflows", json={"name": b_name, "kind": "subflow", "inputs": [], "outputs": []}).json()["workflow"]["id"]
    assert oona.put(f"/api/workflows/{sa}/draft", json={"steps": [{"id": "e", "type": "end", "name": "Done", "on_error": []}]}).status_code == 200
    assert oona.post(f"/api/workflows/{sa}/publish").status_code == 201
    assert oona.put(f"/api/workflows/{sb}/draft", json={"steps": [{"id": "c", "type": "subflow", "name": f"Call A {t}", "flow": a_name, "inputs": {}, "on_error": []}]}).status_code == 200
    assert oona.post(f"/api/workflows/{sb}/publish").status_code == 201
    notify = {"id": "n", "type": "notify", "name": ping, "to": {"users": ["oona"], "roles": []}, "text": "x", "on_error": []}
    assert oona.put(f"/api/workflows/{sa}/draft", json={"steps": [
        {"id": "c", "type": "subflow", "name": call_b, "flow": b_name, "inputs": {}, "on_error": []},
        {"id": "l", "type": "loop", "name": repeat, "over": "[1, 2]", "until": None, "body": [notify], "on_error": []}]}).status_code == 200
    with browse(browser, app_url, "oona", f"/desk/workflows/{sa}") as page:
        tree = page.get_by_role("tree", name="Flow steps")

        def item(name: str) -> Locator:
            return tree.get_by_role("treeitem", name=name, exact=True)

        expect(item(f"{call_b}, Subflow")).to_be_visible(timeout=LOAD_MS)
        page.get_by_role("button", name="Publish", exact=True).press("Enter")
        expect(announcer(page)).to_have_text(f"This subflow calls itself: {a_name} -> {b_name} -> {a_name}.", timeout=UI_MS)
        item(f"{repeat}, Loop").focus()
        page.keyboard.press("ArrowRight")
        body = tree.get_by_role("treeitem", name="Loop body", exact=True)
        expect(body).to_be_visible(timeout=UI_MS)
        for _ in range(6):
            if is_focused(body):
                break
            page.keyboard.press("ArrowDown")
        assert is_focused(body), "Down from the expanded loop reaches its Loop body lane"
        page.keyboard.press("Insert")
        dlg = page.get_by_role("dialog", name="Add step")
        expect(dlg).to_be_visible(timeout=UI_MS)
        select(dlg.get_by_role("combobox", name="Step type"), "Notify")
        dlg.get_by_role("textbox", name="Step name").fill(first)
        dlg.get_by_role("button", name="Add step").press("Enter")
        new = item(f"{first}, Notify")
        expect(new).to_be_focused(timeout=UI_MS)
        expect(item(f"{ping}, Notify")).to_be_visible()
        assert new.bounding_box()["y"] < item(f"{ping}, Notify").bounding_box()["y"], "Insert on a lane item puts the step first in that lane"
        item(f"{call_b}, Subflow").focus()
        page.keyboard.press("Delete")
        confirm = page.get_by_role("dialog", name="Delete step")
        expect(confirm).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(confirm).to_have_count(0, timeout=UI_MS)
        expect(item(f"{call_b}, Subflow")).to_be_focused()
        page.keyboard.press("Delete")
        confirm.get_by_role("button", name="Delete", exact=True).press("Enter")
        expect(item(f"{call_b}, Subflow")).to_have_count(0, timeout=UI_MS)
        expect(item(f"{repeat}, Loop")).to_be_focused()
        page.get_by_role("button", name="Publish", exact=True).press("Enter")
        expect(announcer(page)).to_have_text("Version 2 published.", timeout=UI_MS)
    wf = find_named(oona.get("/api/workflows").json(), a_name)
    assert 2 in wf["versions"], wf["versions"]
    assert [s["name"] for s in wf["draft"]] == [repeat]
    assert [s["name"] for s in wf["draft"][0]["body"]] == [first, ping]


def test_wf_access_rules_row_rule_live_group_counts(browser, app_url):
    t = tag("ag")
    manager = make_user(app_url, ["manager"], "Design Studio")
    caller = make_user(app_url, ["requester"], "Design Studio")
    fields = {"caller": caller["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"}
    hidden = [make_record(app_url, "incident", dict(fields, short_description=t)) for _ in range(2)]
    kept = make_record(app_url, "incident", dict(fields, short_description=f"{t} keep"))
    oona = as_user(app_url, "oona")
    name = f"Hide {t} from managers"
    rule = {"name": name, "type": "row", "table": "incident", "field": None, "operation": "read", "roles": ["manager"],
            "condition": f'short_description = "{t}"', "active": False}
    assert oona.post("/api/access-rules", json=rule).status_code == 201
    flt = f'short_description startswith "{t}"'
    try:
        with browse(browser, app_url, manager["username"], f"/desk/lists/incident?filter={q(flt)}") as mpage:
            grid = mpage.get_by_role("grid").first
            for n in hidden + [kept]:
                expect(_row(grid, n)).to_be_visible(timeout=LOAD_MS)
            select(mpage.get_by_role("combobox", name="Group by"), "Priority")
            mpage.evaluate("() => { window.__swSamePage = true; }")
            with browse(browser, app_url, "oona", "/desk/admin/access-rules") as opage:
                opage.get_by_role("list", name="Access rules").get_by_role("link", name=name, exact=True).press("Enter", timeout=LOAD_MS)
                form = opage.get_by_role("form", name="access rule")
                active = form.get_by_role("checkbox", name="Active")
                expect(active).not_to_be_checked(timeout=UI_MS)
                active.press("Space")
                expect(active).to_be_checked()
                opage.get_by_role("button", name="Save access rule").press("Enter")
                poll(lambda: (find_named(oona.get("/api/access-rules").json(), name) or {}).get("active") is True, API_WAIT_S, "the saved access rule is active")
            for n in hidden:
                expect(_row(grid, n)).to_have_count(0, timeout=UI_MS)
            expect(_row(grid, kept)).to_be_visible(timeout=UI_MS)
            assert mpage.evaluate("() => window.__swSamePage === true"), "the manager's list changed without a reload"
        mc = as_user(app_url, manager["username"])
        groups = mc.get("/api/tables/incident/records", params={"filter": flt, "group_by": "priority"}).json()["groups"]
        assert [g["count"] for g in groups] == [1]
        assert [r["number"] for r in mc.get("/api/search", params={"q": t}).json()["records"]] == [kept]
        assert_error(mc.get(f"/api/records/{hidden[0]}"), 404, "not_found")
    finally:
        oona.put(f"/api/access-rules/{q(name)}", json=dict(rule, active=False))


def test_wf_lists_dashboards_groups_any_reference(browser, app_url):
    t = tag("lg")
    c1 = make_user(app_url, ["requester"], "Finance")["username"]
    c2 = make_user(app_url, ["requester"], "Finance")["username"]
    a = make_record(app_url, "incident", {"short_description": t, "caller": c1, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    b = make_record(app_url, "incident", {"short_description": t, "caller": c2, "impact": 3, "urgency": 2, "assignment_group": "Triage"})
    c = make_record(app_url, "incident", {"short_description": t, "caller": c2, "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    all_text = f'(caller.username = "{c1}") and (short_description = "{t}" and priority = 4)'
    any_text = f'(caller.username = "{c1}") or (short_description = "{t}" and priority = 4)'
    with browse(browser, app_url, "oona", f"/desk/lists/incident?filter={q(eq_filter(t))}") as page:
        grid = page.get_by_role("grid").first
        expect(_row(grid, a)).to_be_visible(timeout=LOAD_MS)
        tab_into(page, grid, "the grid")
        page.keyboard.press("/")
        dlg = page.get_by_role("dialog", name="Filter")
        expect(dlg).to_be_visible(timeout=UI_MS)

        def cond(n: int, g: int) -> Locator:
            return dlg.get_by_role("group", name=f"Condition {n} of group {g}", exact=True)

        expect(cond(1, 1).get_by_role("combobox", name="Field")).to_be_focused(timeout=UI_MS)
        dlg.get_by_role("button", name="Add group", exact=True).press("Enter")
        expect(cond(1, 2).get_by_role("combobox", name="Field")).to_be_focused(timeout=UI_MS)
        cond(1, 2).get_by_role("button", name="Remove condition").press("Enter")
        expect(dlg.get_by_role("button", name=add_condition_label(2), exact=True)).to_be_focused(timeout=UI_MS)
        text = dlg.get_by_role("textbox", name="Filter text")
        text.fill(all_text)
        text.press("Enter")
        expect(cond(2, 2)).to_be_visible(timeout=UI_MS)
        expect(cond(1, 1)).to_be_visible()
        expect(cond(2, 1)).to_have_count(0)
        expect(dlg.get_by_role("group", name="Group 3", exact=True)).to_have_count(0)
        expect(text).to_have_value(all_text, timeout=POLICY_MS + UI_SLACK_MS)
        groups_match = dlg.get_by_role("radiogroup", name="Groups match")
        all_groups = groups_match.get_by_role("radio", name="All groups")
        expect(all_groups).to_be_checked()
        expect(dlg.get_by_role("radiogroup", name=group_match_label(2)).get_by_role("radio", name="All conditions")).to_be_checked()
        all_groups.press("ArrowDown")
        expect(groups_match.get_by_role("radio", name="Any group")).to_be_checked(timeout=UI_MS)
        expect(text).to_have_value(any_text, timeout=POLICY_MS + UI_SLACK_MS)
        dlg.get_by_role("button", name="Apply filter").press("Enter")
        expect(dlg).to_have_count(0, timeout=UI_MS)
        for n in (a, b):
            expect(_row(grid, n)).to_be_visible(timeout=UI_MS)
        expect(_row(grid, c)).to_have_count(0)
        poll(lambda: contains_focus(_row(grid, a)) or contains_focus(grid.get_by_role("row").first), UI_MS / 1000, "Apply filter moves focus to the grid's first row")
        page.keyboard.press("/")
        expect(page.get_by_role("dialog", name="Filter").get_by_role("textbox", name="Filter text")).to_have_value(any_text, timeout=UI_MS)
    oona = as_user(app_url, "oona")
    assert {r["number"] for r in oona.get("/api/tables/incident/records", params={"filter": any_text}).json()["records"]} == {a, b}
    parsed = oona.post("/api/filters/parse", json={"table": "incident", "filter": any_text}).json()
    assert parsed["filter"] == any_text and parsed["builder"]["connector"] == "or" and len(parsed["builder"]["groups"]) == 2


def test_wf_lists_dashboards_notice_two_viewers(browser, app_url):
    t = tag("nn")
    fields = {"impact": 3, "urgency": 3, "assignment_group": "Triage"}
    a = make_record(app_url, "incident", dict(fields, short_description=t))
    teodor = as_user(app_url, "teodor")
    path = f"/desk/lists/incident?filter={q(eq_filter(t))}"
    with browse(browser, app_url, "oona", path) as op, browse(browser, app_url, "bastian", path) as bp:
        og, bg = op.get_by_role("grid").first, bp.get_by_role("grid").first
        for g in (og, bg):
            expect(_row(g, a)).to_be_visible(timeout=LOAD_MS)
        b1 = create_ok(teodor, "incident", dict(fields, short_description=t))
        create_ok(teodor, "incident", dict(fields, short_description=f"{t} other"))
        b2 = create_ok(teodor, "incident", dict(fields, short_description=t))
        for p, g in ((op, og), (bp, bg)):
            expect(p.get_by_role("button", name="2 new records", exact=True)).to_be_visible(timeout=UI_MS)
            expect(announcer(p)).to_have_text("2 new records", timeout=UI_MS)
            for n in (b1, b2):
                expect(_row(g, n)).to_have_count(0)
            expect(_row(g, a)).to_be_visible()
        op.get_by_role("button", name="2 new records", exact=True).press("Enter")
        for n in (b1, b2):
            expect(_row(og, n)).to_be_visible(timeout=UI_MS)
        poll(lambda: contains_focus(_row(og, a)) or contains_focus(og.get_by_role("row").first), UI_MS / 1000, "the notice moves focus to the first row")
        expect(op.get_by_role("button", name="2 new records", exact=True)).to_have_count(0, timeout=UI_MS)
        expect(bp.get_by_role("button", name="2 new records", exact=True)).to_be_visible()
        for n in (b1, b2):
            expect(_row(bg, n)).to_have_count(0)
        b3 = create_ok(teodor, "incident", dict(fields, short_description=t))
        expect(op.get_by_role("button", name="1 new record", exact=True)).to_be_visible(timeout=UI_MS)
        expect(announcer(op)).to_have_text("1 new record", timeout=UI_MS)
        expect(bp.get_by_role("button", name="3 new records", exact=True)).to_be_visible(timeout=UI_MS)
        expect(announcer(bp)).to_have_text("3 new records", timeout=UI_MS)
        expect(_row(og, b3)).to_have_count(0)
        expect(_row(bg, b3)).to_have_count(0)


def test_wf_lists_dashboards_two_zones_live_drilldown(browser, app_url):
    set_clock(app_url, "2026-11-05T16:30:00+00:00")
    t = tag("dz")
    manager = make_user(app_url, ["manager"], "Finance", time_zone="Asia/Tokyo")
    oona = as_user(app_url, "oona")
    title = "Opened per day"
    tokyo_day = date(2026, 11, 6).isoformat()
    fields = {"short_description": t, "caller": "kofi", "impact": 3, "urgency": 3, "assignment_group": "Triage"}
    with browse(browser, app_url, "oona", "/desk/dashboards/desk-overview") as op, browse(browser, app_url, manager["username"], "/dashboards/department-standing") as mp:
        oreg, mreg = op.get_by_role("region", name=title), mp.get_by_role("region", name=title)
        olink = oreg.get_by_role("link", name=re.compile(r"^2026-11-05: \d+$")).first
        mlink = mreg.get_by_role("link", name=re.compile(r"^2026-11-06: \d+$")).first
        expect(olink).to_be_visible(timeout=LOAD_MS)
        expect(mlink).to_be_visible(timeout=LOAD_MS)
        expect(oreg.get_by_role("link", name=re.compile(r"^2026-11-06: "))).to_have_count(0)
        expect(mreg.get_by_role("link", name=re.compile(r"^2026-11-07: "))).to_have_count(0)
        m0, n0 = _link_count(olink), _link_count(mlink)
        v = create_ok(oona, "incident", fields)
        expect(oreg.get_by_role("link", name=f"2026-11-05: {m0 + 1}", exact=True).first).to_be_visible(timeout=UI_MS)
        expect(mreg.get_by_role("link", name=f"2026-11-06: {n0 + 1}", exact=True).first).to_be_visible(timeout=UI_MS)
        h = create_ok(oona, "incident", dict(fields, confidential=True))
        expect(oreg.get_by_role("link", name=f"2026-11-05: {m0 + 2}", exact=True).first).to_be_visible(timeout=UI_MS)
        quiet_until = time.monotonic() + LIVE_MS / 1000
        while time.monotonic() < quiet_until:
            assert mreg.get_by_role("link", name=f"{tokyo_day}: {n0 + 1}", exact=True).count() >= 1, "the confidential row never reaches the manager's bucket"
        expect(mreg.get_by_role("link", name=f"2026-11-06: {n0 + 1}", exact=True).first).to_be_visible()
        mine = [w for w in as_user(app_url, manager["username"]).get("/api/dashboards/department-standing").json()["dashboard"]["widgets"] if w["title"] == title][0]
        assert mine["data"][-1]["key"] == tokyo_day and mine["data"][-1]["count"] == n0 + 1
        mreg.get_by_role("button", name="Show data table").press("Enter")
        table = mreg.get_by_role("table", name=f"{title} data")
        expect(table).to_be_visible(timeout=UI_MS)
        expect(table).to_contain_text(tokyo_day)
        mreg.get_by_role("link", name=f"2026-11-06: {n0 + 1}", exact=True).first.press("Enter")
        mp.wait_for_url(re.compile(r"/desk/lists/incident\?filter="), timeout=LOAD_MS)
        lo, hi = re.findall(r'"([^"]+)"', parse_qs(urlparse(mp.url).query)["filter"][0])
        assert parse_instant(lo) == datetime(2026, 11, 6, tzinfo=_TOKYO) and parse_instant(hi) == datetime(2026, 11, 7, tzinfo=_TOKYO)
        grid = mp.get_by_role("grid").first
        expect(_row(grid, v)).to_be_visible(timeout=LOAD_MS)
        expect(_row(grid, h)).to_have_count(0)


def test_wf_import_promotion_collision_keyboard(browser, app_url):
    t = tag("ck")
    op, c = _set_flow(app_url)
    r1, r2 = f"Rule one {t}", f"Rule two {t}"

    def live(name: str) -> dict | None:
        return find_named(c.get("/api/business-rules").json(), name)

    assert c.put("/api/session/workspace", json={"workspace": "test"}).status_code == 200
    s1 = c.post("/api/config-sets", json={"name": f"First {t}"}).json()["set"]
    assert c.post("/api/business-rules", json=_rule(r1, "v1")).status_code == 201
    assert c.post("/api/business-rules", json=_rule(r2, "v1")).status_code == 201
    assert c.post(f"/api/config-sets/{s1['id']}/export").status_code == 201
    assert c.put("/api/session/workspace", json={"workspace": "live"}).status_code == 200
    assert c.post(f"/api/config-sets/{s1['id']}/preview").status_code == 200
    assert c.post(f"/api/config-sets/{s1['id']}/commit", json={"choices": {}}).json()["applied"] == 2
    assert c.put(f"/api/business-rules/{q(r2)}", json=_rule(r2, "edited live")).status_code == 200
    assert c.put("/api/session/workspace", json={"workspace": "test"}).status_code == 200
    s2 = c.post("/api/config-sets", json={"name": f"Second {t}"}).json()["set"]
    assert c.put(f"/api/business-rules/{q(r1)}", json=_rule(r1, "v2")).status_code == 200
    assert c.put(f"/api/business-rules/{q(r2)}", json=_rule(r2, "v2")).status_code == 200
    assert c.put("/api/session/workspace", json={"workspace": "live"}).status_code == 200
    number = s2["number"]
    with browse(browser, app_url, op["username"], "/desk/config-sets") as page:
        row = page.get_by_role("row").filter(has_text=number)
        row.get_by_role("button", name="Export set").press("Enter", timeout=LOAD_MS)
        expect(announcer(page)).to_have_text(f"Set {number} exported.", timeout=UI_MS)
        row.get_by_role("button", name="Preview against live").press("Enter")
        preview = page.get_by_role("table", name="Set preview")
        expect(preview).to_contain_text(r2, timeout=UI_MS)
        expect(preview).to_contain_text(r1)
        choice = page.get_by_role("radiogroup", name=r2, exact=True)
        expect(choice).to_be_visible()
        expect(page.get_by_role("radiogroup", name=r1, exact=True)).to_have_count(0)
        keep = choice.get_by_role("radio", name="Keep live")
        keep.press("Space")
        expect(keep).to_be_checked()
        expect(choice.get_by_role("radio", name="Take set")).not_to_be_checked()
        row.get_by_role("button", name="Commit set").press("Enter")
        expect(announcer(page)).to_have_text(f"Set {number} committed: 1 items applied.", timeout=UI_MS)
        assert live(r1)["actions"] == [{"work_note": "v2"}] and live(r2)["actions"] == [{"work_note": "edited live"}]
        row.get_by_role("button", name="Back out set").press("Enter")
        expect(announcer(page)).to_have_text(f"Set {number} backed out.", timeout=UI_MS)
    assert live(r1)["actions"] == [{"work_note": "v1"}] and live(r2)["actions"] == [{"work_note": "edited live"}]


def test_wf_import_promotion_reimport_after_outage(browser, app_url):
    t = tag("ir")
    oona = as_user(app_url, "oona")
    seed = f"#switchyard-import v1 people\nusername,display_name,department,active\n{t}a,Person A,Finance,true\n{t}b,Person B,Finance,true\n"
    first = _import(oona, seed, name=f"{t}seed.csv")
    assert first.status_code == 201, first.text
    assert oona.post(f"/api/imports/{first.json()['import']['id']}/commit").status_code == 200
    finance = department_size(oona, "Finance")
    lines = ["#switchyard-import v1 people", "username,display_name,department,active",
             f"{t}a,Person A,Finance,true",
             f'{t}b,"Person B, renamed",Finance,true',
             "",
             f'{t}c,"Person ""C""",Finance,true',
             f"{t}d,Person D,Finance,true,extra",
             f"{t}e,Person E,Nowhere{t},true"]
    path = Path(os.environ.get("TMPDIR", "/tmp")) / f"{t}.csv"
    path.write_bytes(("\r\n".join(lines) + "\r\n").encode())
    errors = ["Line 7: expected 4 values, found 5.", f'Line 8: department "Nowhere{t}" does not exist.']
    runs = (("Import checked: 1 to create, 1 to update, 1 unchanged, 2 with errors.", "Import finished: 1 created, 1 updated, 1 unchanged, 2 failed."),
            ("Import checked: 0 to create, 0 to update, 3 unchanged, 2 with errors.", "Import finished: 0 created, 0 updated, 3 unchanged, 2 failed."))
    with browse(browser, app_url, "oona", "/desk/imports") as page:
        upload = page.get_by_role("button", name="Upload import file")
        expect(upload).to_be_visible(timeout=LOAD_MS)
        banner = page.get_by_role("region", name="Storage status")
        with storage_redirect(app_url, DEAD_ENDPOINT):
            expect(banner).to_contain_text(STORAGE_BANNER_DESK, timeout=STORAGE_WAIT_S * 1000)
            down = _import(oona, seed, name=f"{t}down.csv")
            assert down.status_code == 503 and down.json() == STORAGE_503
        expect(banner).to_have_count(0, timeout=STORAGE_WAIT_S * 1000)
        for checked, finished in runs:
            with page.expect_file_chooser(timeout=LOAD_MS) as fc:
                upload.press("Enter")
            fc.value.set_files(str(path))
            expect(announcer(page)).to_have_text(checked, timeout=UI_MS)
            preview = page.get_by_role("table", name="Import preview")
            for e in errors:
                expect(preview).to_contain_text(e)
            page.get_by_role("button", name="Commit import").press("Enter")
            expect(announcer(page)).to_have_text(finished, timeout=UI_MS)
    assert department_size(oona, "Finance") == finance + 1


def test_baseline_denied_field_write_answers_field_denied(app_url):
    t = tag("fd")
    mae = as_user(app_url, "mae")
    vis = make_record(app_url, "incident", {"short_description": t, "caller": "ruth", "affected_person": "design07", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    assert "affected_person" not in record(mae, vis)["fields"]
    assert_error(mae.patch(f"/api/records/{vis}", json={"fields": {"affected_person": {"value": "design08", "version": 1}}}), 403, "field_denied", "You cannot change Affected person.")


def test_denied_columns_left_out_of_lists_and_exports(app_url):
    t = tag("dc")
    caller = make_user(app_url, ["requester"], "Design Studio")
    shown_n = make_record(app_url, "incident", {"short_description": t, "caller": caller["username"], "affected_person": "design07", "impact": 3, "urgency": 3, "assignment_group": "Triage"})
    mae = as_user(app_url, "mae")
    flt = eq_filter(t)
    lst = mae.get("/api/tables/incident/records", params={"filter": flt, "columns": "number,affected_person"}).json()
    assert [r["number"] for r in lst["records"]] == [shown_n] and "affected_person" not in json.dumps(lst["records"])
    ex = mae.post("/api/exports", json={"table": "incident", "filter": flt, "columns": ["number", "affected_person"]}).json()["export"]
    done = poll(lambda: (lambda e: e if e["status"] == "complete" else None)(mae.get(f"/api/exports/{ex['id']}").json()["export"]), API_WAIT_S, "export completes")
    body = S3().get(f"exports/{ex['id']}.csv").decode()
    lines = [x for x in body.splitlines() if x.strip()]
    assert len(lines) == 2 and shown_n in lines[1] and "Affected person" not in lines[0]
    assert done["key"] == f"exports/{ex['id']}.csv"


def test_stop_impersonating_removes_the_banner(browser, app_url):
    target = make_user(app_url, ["requester"], "Finance")
    with browse(browser, app_url, "oona", "/desk/admin/users") as page:
        page.get_by_role("button", name=f"Impersonate {target['display_name']}").click(timeout=LOAD_MS)
        page.wait_for_url(lambda u: urlparse(u).path.rstrip("/") == "/portal", timeout=LOAD_MS)
        expect(page.get_by_role("region", name="Impersonation")).to_contain_text(
            f"Impersonating {target['display_name']} ({target['username']}). Everything you do is recorded.", timeout=UI_MS)
        page.get_by_role("button", name="Stop impersonating").click()
        expect(page.get_by_role("region", name="Impersonation")).to_have_count(0, timeout=UI_MS)


def test_group_headers_recount_when_a_row_rule_starts(browser, app_url):
    t = tag("gh")
    manager = make_user(app_url, ["manager"], "Design Studio")
    caller = make_user(app_url, ["requester"], "Design Studio")
    fields = {"caller": caller["username"], "impact": 3, "urgency": 3, "assignment_group": "Triage"}
    for _ in range(2):
        make_record(app_url, "incident", dict(fields, short_description=t))
    make_record(app_url, "incident", dict(fields, short_description=f"{t} keep"))
    oona = as_user(app_url, "oona")
    name = f"Hide {t} from managers"
    rule = {"name": name, "type": "row", "table": "incident", "field": None, "operation": "read", "roles": ["manager"],
            "condition": f'short_description = "{t}"', "active": False}
    assert oona.post("/api/access-rules", json=rule).status_code == 201
    flt = f'short_description startswith "{t}"'
    try:
        with browse(browser, app_url, manager["username"], f"/desk/lists/incident?filter={q(flt)}") as page:
            select(page.get_by_role("combobox", name="Group by"), "Priority")
            expect(page.get_by_text("5 Planning (3)", exact=True)).to_be_visible(timeout=LOAD_MS)
            assert oona.put(f"/api/access-rules/{q(name)}", json=dict(rule, active=True)).status_code == 200
            expect(page.get_by_text("5 Planning (1)", exact=True)).to_be_visible(timeout=UI_MS)
        groups = as_user(app_url, manager["username"]).get("/api/tables/incident/records", params={"filter": flt, "group_by": "priority"}).json()["groups"]
        assert [(g["label"], g["count"]) for g in groups] == [("5 Planning", 1)]
    finally:
        oona.put(f"/api/access-rules/{q(name)}", json=dict(rule, active=False))


def test_relationship_dialog_by_keyboard_meets_the_loop_refusal(browser, app_url):
    t = tag("rk")
    names = _map_items(app_url, t)
    with browse(browser, app_url, "oona", "/desk/map") as page:
        opener = page.get_by_role("button", name="Add relationship")
        expect(opener).to_be_visible(timeout=LOAD_MS)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Add relationship")
        expect(dialog).to_be_visible(timeout=UI_MS)
        for _ in range(30):
            page.keyboard.press("Tab")
            assert contains_focus(dialog), "Tab stays inside the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0, timeout=UI_MS)
        assert is_focused(opener)
        for frm, kind, to in ((names["app"], "depends on", names["svc1"]), (names["array"], "depends on", names["app"])):
            opener.focus()
            page.keyboard.press("Enter")
            select(dialog.get_by_role("combobox", name="From"), frm)
            select(dialog.get_by_role("combobox", name="Type"), kind)
            select(dialog.get_by_role("combobox", name="To"), to)
            add = dialog.get_by_role("button", name="Add")
            add.focus()
            page.keyboard.press("Enter")
            if frm == names["app"]:
                expect(dialog).to_have_count(0, timeout=UI_MS)
        loop = f"This relationship would form a dependency loop: {names['array']} -> {names['app']} -> {names['svc1']} -> {names['array']}."
        expect(page.get_by_text(loop, exact=True).first).to_be_visible(timeout=UI_MS)
    edges = as_user(app_url, "oona").get("/api/service-map").json()["edges"]
    assert any(e["source"] == names["app"] and e["target"] == names["svc1"] for e in edges)
    assert not any(e["source"] == names["array"] and e["target"] == names["app"] for e in edges)


def test_map_outage_proposal_banner_with_maintenance_in_viewer_zone(browser, app_url):
    set_clock(app_url, "2027-04-14T10:00:00+02:00")
    t = tag("mp")
    names = _map_items(app_url, t)
    fixtures(app_url, {"cis": [ci(f"{t} edge", "Network device", 2), ci(f"{t} remote", "Business service", 2, used_by={"departments": [], "people": ["ops03"]})],
                       "relationships": [rel(f"{t} remote", "depends on", f"{t} edge")]})
    with browse(browser, app_url, "oona", "/desk/map") as page:
        group = page.get_by_role("group", name="Service map")
        group.get_by_role("button", name=f"{t} edge, Network device, Healthy", exact=True).click(timeout=LOAD_MS)
        page.get_by_role("button", name="Schedule maintenance").click()
        dlg = page.get_by_role("dialog", name="Schedule maintenance")
        dlg.get_by_role("textbox", name="Start").fill("2027-04-14 09:00")
        dlg.get_by_role("textbox", name="End").fill("2027-04-14 18:00")
        dlg.get_by_role("button", name="Schedule").click()
        expect(group.get_by_role("button", name=f"{t} edge, Network device, In maintenance", exact=True)).to_be_visible(timeout=UI_MS)
        group.get_by_role("button", name=f"{names['array']}, Storage, Healthy", exact=True).click()
        page.get_by_role("button", name="Mark down").click()
        expect(page.get_by_text(f"Major incident proposed for {names['array']}.", exact=True).first).to_be_visible(timeout=UI_MS)


def test_map_collapse_reverses_the_expand_animation(browser, app_url):
    t = tag("mc")
    app, host = f"{t} app", f"{t} host"
    fixtures(app_url, {"cis": [ci(app, "Application", 2), ci(host, "Server", 2)], "relationships": [rel(app, "runs on", host)]})
    with browse(browser, app_url, "oona", "/desk/map") as page:
        node = _b_node(page, app, "Application", "Healthy")
        expect(node).to_have_count(1, timeout=LOAD_MS)
        page.evaluate(ANIM_RECORDER)
        node.focus()
        page.keyboard.press("Enter")
        details = page.get_by_role("region", name=f"{app} details")
        expect(details).to_be_visible(timeout=UI_MS)
        handle = details.element_handle()
        start = page.evaluate("() => window.__swAnims.length")
        node.focus()
        page.keyboard.press("Enter")
        collapse_js = """([h, n]) => window.__swAnims.slice(n).filter(a => a.el === h || h.contains(a.el)).map(a => a.d)
          .concat(h.isConnected ? h.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration)) : [])"""
        poll(lambda: MAP_EXPAND_MS in [round(d) for d in page.evaluate(collapse_js, [handle, start])],
             UI_MS / 1000, "collapsing reverses the 420 ms animation on the details region")


def test_form_policies_hide_strip_and_lock_fields(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    c = as_user(app_url, u["username"])
    r = c.post("/api/cart/lines", json={"item": "laptop", "quantity": 1, "variables": {"model": "standard14", "memory": "16", "justification": "ignored"}})
    assert r.status_code == 201 and "justification" not in (r.json()["line"]["variables"] or {})
    sv, lv = _vars(c, "software-licence"), _vars(c, "laptop")
    r = c.post("/api/cart/lines", json={"item": "software-licence", "quantity": 1, "variables": {"seat": "cad", "cost_centre": "Elsewhere"}})
    assert assert_error(r, 422, "validation")["fields"]["cost_centre"] == f"{sv['cost_centre']['label']} is read-only."
    with browse(browser, app_url, u["username"], "/portal/items/laptop") as page:
        model = page.get_by_label(lv["model"]["label"])
        expect(model).to_be_visible(timeout=LOAD_MS)
        select(model, "Standard 14-inch")
        expect(page.get_by_label("Why you need it")).to_be_hidden(timeout=POLICY_MS + UI_SLACK_MS)
        page.goto(base(app_url) + "/portal/items/software-licence")
        cost = page.get_by_label(sv["cost_centre"]["label"])
        expect(cost).to_have_value("Design Studio", timeout=LOAD_MS)
        expect(cost).not_to_be_editable(timeout=POLICY_MS + UI_SLACK_MS)


def test_approved_item_moves_through_fulfilment_to_delivered(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    approver = make_user(app_url, ["approver"], "Design Studio")
    uc = as_user(app_url, u["username"])
    assert uc.post("/api/cart/lines", json={"item": "laptop", "quantity": 1, "variables": {"model": "studio16", "memory": "32", "justification": "Rendering large models"}}).status_code == 201
    r = uc.post("/api/cart/checkout", json={"requested_for": None})
    assert r.status_code == 201, r.text
    ask = r.json()["request"]["number"]
    itm = r.json()["request"]["items"][0]["number"]
    poll(lambda: uc.get(f"/api/requests/{ask}").json()["request"]["items"][0]["state"] == "awaiting_approval", API_WAIT_S, "item waits for approval")
    with browse(browser, app_url, u["username"], f"/portal/requests/{ask}") as portal, browse(browser, app_url, approver["username"], "/approve") as ap:
        status = portal.get_by_role("region", name="Request status")
        expect(status).to_be_visible(timeout=LOAD_MS)
        ap.get_by_role("article", name=f"{itm}: Laptop").get_by_role("button", name="Approve").click(timeout=LOAD_MS)
        job = poll(lambda: (uc.get(f"/api/requests/{ask}").json()["request"]["items"][0]["tasks"] or [None])[0], API_WAIT_S, "the Prepare laptop task exists")["number"]
        expect(status).to_contain_text(f"{job}: Open", timeout=UI_MS)
        tc = as_user(app_url, "teodor")
        move_ok(tc, job, "in_progress")
        move_ok(tc, job, "done", close_note="Imaged and labelled")
        expect(status).to_contain_text(f"{job}: Done", timeout=UI_MS)
        expect(status.get_by_role("listitem").filter(has_text=f"{itm} Laptop: Delivered")).to_be_visible(timeout=UI_MS)
    assert uc.get(f"/api/requests/{ask}").json()["request"]["state"] == "closed"


def test_desk_cancel_by_keyboard_sends_the_typed_reason(browser, app_url):
    u = make_user(app_url, ["requester"], "Design Studio")
    uc = as_user(app_url, u["username"])
    assert uc.post("/api/cart/lines", json={"item": "shared-drive", "quantity": 1, "variables": {"drive": "finance", "access": "write"}}).status_code == 201
    r = uc.post("/api/cart/checkout", json={"requested_for": None})
    assert r.status_code == 201, r.text
    ask = r.json()["request"]["number"]
    drive_item = r.json()["request"]["items"][0]["number"]
    poll(lambda: uc.get(f"/api/requests/{ask}").json()["request"]["items"][0]["state"] == "awaiting_approval", API_WAIT_S, "the item waits for approval")
    with browse(browser, app_url, "oona", f"/desk/records/{drive_item}") as desk:
        form = desk.get_by_role("form", name=drive_item)
        expect(form).to_be_visible(timeout=LOAD_MS)
        form.get_by_label(label_of("cancel_reason"), exact=True).focus()
        desk.keyboard.type("Access no longer needed")
        _b_press(desk, desk.get_by_role("button", name=move_label("Cancelled")))
        expect(announcer(desk)).to_have_text(f"{drive_item} moved to Cancelled.", timeout=UI_MS)
