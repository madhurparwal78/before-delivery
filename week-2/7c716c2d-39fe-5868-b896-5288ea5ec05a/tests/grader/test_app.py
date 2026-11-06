from __future__ import annotations

import concurrent.futures as futures
import http.client
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    KillBill,
    Mailpit,
    Postgres,
    S3,
    addresses,
    animations,
    center,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    same_origin,
    select,
    session,
    tab_order,
    text,
    unique,
)

PASSWORD = "tally-demo-1"
ANA, BEN, CHIARA = "ana@kereru.test", "ben@kereru.test", "chiara@kereru.test"
DEV, ELIN, FEMI = "dev@kereru.test", "elin@kereru.test", "femi@kereru.test"
HAL, IRIS = "hal@halyard.test", "iris@halyard.test"
ANA_NAME, CHIARA_NAME, DEV_NAME, FEMI_NAME = "Ana Whitlow", "Chiara Lund", "Dev Ramaswamy", "Femi Ade"

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}

LIVE_S = 2
LIVE_MS = 2000
NOTICE_MS = 12000
REFRESH_MS = 12000
FRESH_S = 12
FRESH_UI_MS = 22000
UI_MS = 8000
HTTP_TIMEOUT = 30
WALK_LIMIT = 200
BOOT_S = 90
POLL_S = 0.1
SETTLE_S = 1.5
TAB_LIMIT = 60
TRAP_TABS = 12
BIG_LIST = 18
TYPING_LAPSE_S = 8
KEEPALIVE_S = 20
MAIL_RETRY_S = 45
DIGEST_S = 200
DIGEST_START = "2026-11-03T07:59:30+13:00"
QUEUE_S = 45
ABORTS = 20
SEATS_MAX = 40
SEAT_PRICE = 8
MAX_MESSAGE = 4000
MAX_DOC_BODY = 200000
MAX_DOC_TITLE = 200
MAX_FILE = 10000000
MAX_FILENAME = 255
MAX_JSON = 1000000
MAX_EVENTS = 1000
CREASE_MAX_PX = 9
CENTRE_PX = 2
TARGET_PX = 44
SEQUENCE_MAX_MS = 1000
LONG_PRESS_MS = 400
HOLD_SLACK_MS = 150
SESSION_DRIFT = 2
RELEASE_S = 5
ACTIVE_TYPES = ("text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript")
STATUS_LABEL = {"backlog": "Backlog", "todo": "Todo", "in_progress": "In progress", "in_review": "In review", "done": "Done", "cancelled": "Cancelled"}
EDGES = {
    "backlog": ("todo", "cancelled"),
    "todo": ("backlog", "in_progress", "cancelled"),
    "in_progress": ("todo", "in_review", "cancelled"),
    "in_review": ("in_progress", "done", "cancelled"),
    "done": ("in_progress",),
    "cancelled": ("backlog",),
}

ISSUE_ANY_GLOB = "**/api/issues**"
ISSUE_PATCH_GLOB = "**/api/issues/*"
UPLOAD_GLOB = "**/attachments"
SEATS_GLOB = "**/api/billing/seats"
STATUS_GLOB = "**/api/status"
IDEMPOTENCY_HEADER = "idempotency-key"
CORS_HEADER = "access-control-allow-origin"

PAUSE = threading.Event()
expect.set_options(timeout=UI_MS)

RECORDER = """
(() => {
  const label = el => {
    const direct = el.getAttribute('aria-label');
    if (direct) return direct.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    return (el.textContent || '').trim();
  };
  window.__ribbon = [];
  const tick = () => {
    const creases = [...document.querySelectorAll('button,[role=button]')].filter(el => /, not counted$/.test(label(el)));
    if (creases.length) {
      const groups = [...document.querySelectorAll('[role=group],fieldset')].filter(el => /^[A-Z][a-z]{2} \\d{1,2} [A-Z][a-z]{2}$/.test(label(el)));
      const counter = [...document.querySelectorAll('[role=status],output')].find(el => el.getAttribute('aria-label') === 'Cycle length' || label(el) === 'Cycle length');
      window.__ribbon.push({
        t: performance.now(),
        labels: creases.map(label),
        creases: creases.map(el => el.getBoundingClientRect().width),
        groups: groups.map(el => el.getBoundingClientRect().width),
        counter: counter ? counter.textContent.trim() : '',
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""


def poll(check: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = check()
        if value:
            return value
        if time.monotonic() > deadline:
            pytest.fail(f"not within {seconds}s: {what}")
        PAUSE.wait(POLL_S)


def stays(check: Callable[[], Any], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert check(), what
        PAUSE.wait(POLL_S)


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in second else (second, first)


def stamp(prefix: str = "Item") -> str:
    return f"{prefix} {uuid.uuid4().hex[:10]}"


def pretty(value: str) -> str:
    day = date.fromisoformat(value)
    return f"{day:%a} {day.day} {day:%b}"


def shifted(value: str, days: int) -> str:
    return (date.fromisoformat(value) + timedelta(days=days)).isoformat()


def issue_path(key: str) -> str:
    return f"/api/issues/{key}"


def cycle_at(api: Api, number: int) -> dict[str, Any]:
    return api.get(f"/api/cycles/{number}").json()


def digest_subject(value: str) -> str:
    day = date.fromisoformat(value)
    return f"Your Tallyroom digest for {day:%A} {day.day} {day:%B}"


def saved_copy(version: int) -> str:
    return f"Saved version {version}."


def conflict_copy(name: str, version: int) -> str:
    return f"{name} saved version {version} while you were editing. Keep mine or load theirs?"


def mark_page(page: Page) -> None:
    page.evaluate("window.__same = true")


def page_kept(page: Page) -> bool:
    return page.evaluate("window.__same === true")


def touch_down(cdp: Any, x: float, y: float) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})


def touch_move(cdp: Any, x: float, y: float) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})


def touch_up(cdp: Any) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def stored_object(bucket: S3, item: dict[str, Any]) -> bytes:
    keys = bucket.keys(f"kereru/{item['id']}/")
    assert len(keys) == 1, keys
    assert not re.search(r"[\s\"]", keys[0]), keys[0]
    return bucket.get(keys[0])


def bundles_of(account_id: str) -> list[dict[str, Any]]:
    with kill_bill() as client:
        return client.get(f"/1.0/kb/accounts/{account_id}/bundles").json()


def copy_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def clock_url() -> str:
    return copy_url("APP_SHIFTED_CLOCK_URL")


def short_url() -> str:
    return copy_url("APP_SHORT_URL")


def twin_url() -> str:
    return copy_url("APP_SHORT_TWIN_URL")


class Api:
    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD) -> None:
        self.held: Stream | None = None
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.person: dict[str, Any] = {}
        self.email = email
        if email:
            answer = poll(lambda: self._sign_in(email, password), BOOT_S, f"sign in as {email}")
            self.person = answer["person"]

    def _sign_in(self, email: str, password: str) -> dict[str, Any] | None:
        response = self.http.post("/api/session", json={"email": email, "password": password})
        if response.status_code == 503:
            return None
        assert response.status_code == 200, response.text
        return response.json()

    @property
    def id(self) -> str:
        return self.person["id"]

    @property
    def cookie(self) -> str:
        return "; ".join(f"{item.name}={item.value}" for item in self.http.cookies.jar)

    def get(self, path: str, **options: Any) -> httpx.Response:
        return self.http.get(path, **options)

    def post(self, path: str, body: Any = None, key: str | None = None, **options: Any) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        return self.http.post(path, json={} if body is None else body, headers=headers, **options)

    def put(self, path: str, body: Any, key: str | None = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        return self.http.put(path, json=body, headers=headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def workspace(self) -> dict[str, Any]:
        return self.get("/api/workspace").json()

    def project(self, key: str) -> str:
        return next(item["id"] for item in self.get("/api/projects").json()["projects"] if item["key"] == key)

    def channel(self, name: str) -> str:
        return next(item["id"] for item in self.get("/api/channels").json()["channels"] if item["name"] == name)

    def current(self) -> dict[str, Any]:
        return self.get("/api/cycles/current").json()

    def unread(self) -> dict[str, Any]:
        return self.get("/api/unread").json()

    def room(self, name: str) -> dict[str, Any]:
        return next(item for item in self.get("/api/floor").json()["rooms"] if item["name"] == name)

    def inside(self, name: str) -> list[str]:
        return [item["person_id"] for item in self.room(name)["occupants"]]

    def post_message(self, channel: str, body: str, root: int | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"body": body}
        if root is not None:
            payload["thread_root_id"] = root
        response = self.post(f"/api/channels/{channel}/messages", payload)
        assert response.status_code == 201, response.text
        return response.json()


def failed(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code, response.text
    return response.json()["error"]


class Stream:
    def __init__(self, api: Api, last_id: int | None = None) -> None:
        parts = urlsplit(api.base)
        self.connection = http.client.HTTPConnection(parts.hostname, parts.port, timeout=HTTP_TIMEOUT)
        self.connection.connect()
        self.sock = self.connection.sock
        headers = {"Cookie": api.cookie, "Accept": "text/event-stream"}
        if last_id is not None:
            headers["Last-Event-ID"] = str(last_id)
        self.connection.request("GET", "/api/events", headers=headers)
        self.response = self.connection.getresponse()
        self.sock.settimeout(None)
        self.status = self.response.status
        self.headers = {name.lower(): value for name, value in self.response.getheaders()}
        self.events: list[dict[str, Any]] = []
        self.comments: list[str] = []
        self.closed = threading.Event()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        current: dict[str, Any] = {}
        try:
            while True:
                line = self.response.readline()
                if not line:
                    break
                row = line.decode().rstrip("\r\n")
                if row.startswith(":"):
                    self.comments.append(row)
                elif not row:
                    if "event" in current:
                        current["data"] = json.loads(current.get("data") or "{}")
                        current["at"] = time.monotonic()
                        self.events.append(current)
                    current = {}
                else:
                    field, _, value = row.partition(":")
                    current[field] = value.removeprefix(" ")
        except (OSError, ValueError, http.client.HTTPException):
            pass
        finally:
            self.closed.set()

    def named(self, event: str, match: Callable[[dict[str, Any]], bool] = lambda _: True) -> list[dict[str, Any]]:
        return [item for item in list(self.events) if item["event"] == event and match(item["data"])]

    def wait(self, event: str, match: Callable[[dict[str, Any]], bool] = lambda _: True, seconds: float = LIVE_S) -> dict[str, Any]:
        return poll(lambda: (self.named(event, match) or [None])[0], seconds, f"event {event}")

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()


@contextmanager
def streaming(api: Api, last_id: int | None = None) -> Iterator[Stream]:
    stream = Stream(api, last_id)
    assert stream.status == 200
    try:
        yield stream
    finally:
        stream.close()


def is_stream(response: Any) -> bool:
    return urlsplit(response.url).path == "/api/events"


def is_refresh(response: Any) -> bool:
    return urlsplit(response.url).path in ("/api/workspace", "/api/me")


def visit(page: Page, url: str, stream: bool = True) -> None:
    if stream:
        with page.expect_response(is_stream, timeout=UI_MS * 2):
            page.goto(url)
    else:
        page.goto(url)


@contextmanager
def blank(browser: Browser, viewport: dict[str, int] = DESKTOP, script: str | None = None, device_time: str | None = None, **options: Any) -> Iterator[Page]:
    context = browser.new_context(viewport=viewport, **options)
    try:
        if script:
            context.add_init_script(script)
        page = context.new_page()
        if device_time:
            page.clock.set_fixed_time(device_time)
        yield page
    finally:
        context.close()


@contextmanager
def signed_in(browser: Browser, base: str, email: str, route: str = "/issues", password: str = PASSWORD, stream: bool = True, **options: Any) -> Iterator[Page]:
    with blank(browser, **options) as page:
        answer = page.context.request.post(f"{base}/api/session", data={"email": email, "password": password})
        assert answer.status == 200
        visit(page, f"{base}{route}", stream)
        yield page


def role(scope: Page | Locator, kind: str, name: str, **options: Any) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True, **options)


def detail(page: Page) -> Locator:
    return role(page, "region", "Detail")


def listing(page: Page) -> Locator:
    return role(page, "region", "List")


def ribbon(page: Page) -> Locator:
    return role(page, "region", "Cycle ribbon")


def announced(page: Page, copy: str, timeout: int = UI_MS) -> None:
    expect(role(page, "status", "Announcements")).to_contain_text(copy, timeout=timeout)


def notices(page: Page) -> Locator:
    return role(page, "region", "Service notices").get_by_role("alert")


def notices_behind_modal(page: Page) -> Locator:
    return role(page, "region", "Service notices", include_hidden=True).get_by_role("alert", include_hidden=True)


def row_of(page: Page, issue: dict[str, Any]) -> Locator:
    return listing(page).get_by_role("row", name=f"{issue['key']} {issue['title']}")


def chip(scope: Page | Locator, key: str) -> Locator:
    return scope.get_by_role("button", name=re.compile(rf"^{key}( due |, no due date)"))


def sign_in_form(page: Page, email: str, password: str = PASSWORD) -> None:
    form = role(page, "form", "Sign in")
    role(form, "textbox", "Email").fill(email)
    role(form, "textbox", "Password").fill(password)
    role(form, "button", "Sign in").click()


def path_of(page: Page) -> str:
    parts = urlsplit(page.url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


def focus_inside(scope: Locator) -> bool:
    return scope.evaluate("el => el.contains(document.activeElement)")


def focus_settles(scope: Locator) -> None:
    poll(lambda: focus_inside(scope), UI_MS / 1000, "focus moves into place")


def tab_to_row(page: Page) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if listing(page).evaluate("el => { const a = document.activeElement; return el.contains(a) && !!a.closest('[role=row],tr'); }"):
            return
    pytest.fail("Tab never reached a row of the list")


def select_row(page: Page, keys: list[str], key: str) -> None:
    tab_to_row(page)
    for _ in keys:
        page.keyboard.press("k")
    for _ in range(keys.index(key)):
        page.keyboard.press("j")


def choose(page: Page, picker: str, label: str) -> None:
    box = role(page, "listbox", picker)
    expect(role(box, "option", label)).to_be_visible()
    labels = [item.strip() for item in box.get_by_role("option").all_inner_texts()]
    for _ in range(labels.index(label)):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")


def option_labels(page: Page, combobox: Locator) -> list[str]:
    combobox.click()
    inner = combobox.get_by_role("option")

    def rendered() -> list[str]:
        found = inner if inner.count() else page.get_by_role("option")
        return [item.strip() for item in found.all_inner_texts()]

    labels = poll(rendered, UI_MS / 1000, "combobox options")
    page.keyboard.press("Escape")
    return labels


def attach(page: Page, name: str, data: bytes, mime: str = "text/plain") -> None:
    with page.expect_file_chooser() as chooser:
        role(detail(page), "button", "Attach file").click()
    chooser.value.set_files({"name": name, "mimeType": mime, "buffer": data})


def wait_refreshes(page: Page, count: int = 2) -> None:
    for _ in range(count):
        with page.expect_response(is_refresh, timeout=REFRESH_MS):
            pass


def samples(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("window.__ribbon")


def fold_ended(page: Page) -> bool:
    frames = samples(page)
    return bool(frames) and frames[-1]["creases"][0] <= CREASE_MAX_PX


def new_issue(api: Api, project: str, title: str | None = None, **extra: Any) -> dict[str, Any]:
    response = api.post("/api/issues", {"project_id": project, "title": title or stamp("Issue"), **extra})
    assert response.status_code == 201, response.text
    return response.json()


def walk(api: Api, key: str, target: str) -> dict[str, Any]:
    issue = api.get(f"/api/issues/{key}").json()
    routes = deque([[issue["status"]]])
    seen = {issue["status"]}
    while routes:
        route = routes.popleft()
        if route[-1] == target:
            for step in route[1:]:
                answer = api.post(f"/api/issues/{key}/transition", {"to": step})
                assert answer.status_code == 200, answer.text
                issue = answer.json()
            return issue
        for step in EDGES[route[-1]]:
            if step not in seen:
                seen.add(step)
                routes.append([*route, step])
    pytest.fail(f"no route to {target}")


def new_doc(api: Api, project: str, body: str = "First body") -> dict[str, Any]:
    response = api.post("/api/docs", {"project_id": project, "title": stamp("Doc"), "body": body})
    assert response.status_code == 201, response.text
    return response.json()


def upload(api: Api, path: str, name: str, data: bytes = b"tally bytes", mime: str = "text/plain") -> httpx.Response:
    return api.http.post(path, files={"file": (name, data, mime)})


def browser_upload(api: Api, path: str, name: str, data: bytes, mime: str) -> httpx.Response:
    boundary = uuid.uuid4().hex
    filename = name.replace('"', "%22")
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'
    body = head.encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return api.http.post(path, content=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def essence(mime: str) -> str:
    return mime.split(";")[0].strip().lower()


def calendar_of(workspace: dict[str, Any]) -> dict[str, Any]:
    return {key: workspace[key] for key in ("time_zone", "working_weekdays", "holidays", "cycle_anchor")}


@contextmanager
def calendar_kept(owner: Api) -> Iterator[dict[str, Any]]:
    original = calendar_of(owner.workspace())
    try:
        yield original
    finally:
        assert owner.put("/api/workspace/calendar", original).status_code == 200


def save_calendar(owner: Api, **changes: Any) -> dict[str, Any]:
    response = owner.put("/api/workspace/calendar", {**calendar_of(owner.workspace()), **changes})
    assert response.status_code == 200, response.text
    return response.json()


def last_counted_after_today(owner: Api) -> str:
    today = owner.workspace()["today"]
    days = [item["date"] for item in owner.current()["days"] if item["counted"] and item["date"] > today]
    assert days, "the shifted-clock cycle still has counted days ahead"
    return days[-1]


def first_cycle_on(owner: Api, target: str) -> dict[str, Any]:
    number = owner.current()["number"]
    for _ in range(WALK_LIMIT):
        cycle = owner.get(f"/api/cycles/{number}").json()
        if cycle["first_working_date"] == target:
            return cycle
        if cycle["first_working_date"] > target:
            before = owner.get(f"/api/cycles/{number - 1}").json()
            gap = (date.fromisoformat(target) - date.fromisoformat(before["first_working_date"])).days
            held = {item["date"] for item in owner.workspace()["holidays"]}
            extra: list[dict[str, str]] = []
            day = before["first_working_date"]
            while len(extra) < gap:
                day = shifted(day, -1)
                if day not in held:
                    extra.append({"date": day, "name": f"Shift {len(extra)}"})
            save_calendar(owner, holidays=owner.workspace()["holidays"] + extra)
            number -= 1
            continue
        number += 1
    pytest.fail(f"no cycle started on {target} within {WALK_LIMIT} reads")


class Crew:
    def __init__(self) -> None:
        self.joined: list[tuple[Api, str]] = []
        self.pending: list[tuple[Api, str]] = []

    def invite(self, owner: Api, role_name: str = "member", projects: tuple[str, ...] = (), channels: tuple[str, ...] = ()) -> tuple[dict[str, Any], str]:
        ensure_seats(owner)
        name, email = fresh("crew")
        response = owner.post("/api/invites", {"email": email, "role": role_name, "project_ids": list(projects), "channel_ids": list(channels)})
        assert response.status_code == 201, response.text
        self.pending.append((owner, response.json()["id"]))
        return response.json(), email

    def account(self, base: str, email: str) -> Api:
        api = Api(base)
        response = api.post("/api/accounts", {"name": stamp("Crew"), "email": email, "password": PASSWORD})
        assert response.status_code == 201, response.text
        api.person = response.json()["person"]
        api.email = email
        return api

    def join(self, owner: Api, role_name: str = "member", projects: tuple[str, ...] = (), channels: tuple[str, ...] = ()) -> Api:
        invite, email = self.invite(owner, role_name, projects, channels)
        api = self.account(owner.base, email)
        answer = api.post(f"/api/invites/{invite['id']}/accept")
        assert answer.status_code == 200, answer.text
        api.person = answer.json()["person"]
        self.joined.append((owner, api.id))
        return api

    def dismiss(self) -> None:
        for owner, path in [(o, f"/api/invites/{i}") for o, i in self.pending] + [(o, f"/api/members/{p}") for o, p in self.joined]:
            try:
                owner.delete(path)
            except httpx.TransportError:
                pass


@pytest.fixture
def crew() -> Iterator[Crew]:
    team = Crew()
    yield team
    team.dismiss()


def billing(owner: Api) -> dict[str, Any]:
    return owner.get("/api/billing").json()


def ensure_seats(owner: Api, count: int = 1) -> None:
    state = poll(lambda: (lambda item: item if item.get("billing_status") == "ok" else None)(billing(owner)), BOOT_S, "billing ready")
    need = state["active"] + state["pending"] + count
    if need > state["limit"]:
        answer = owner.put("/api/billing/seats", {"seats": need})
        assert answer.status_code == 200, answer.text


def kill_bill() -> httpx.Client:
    return httpx.Client(
        base_url=os.environ["KILLBILL_URL"],
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        timeout=HTTP_TIMEOUT,
        headers={
            "X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
            "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
            "X-Killbill-CreatedBy": "verifier",
        },
    )


def subscription(killbill: KillBill, workspace_id: str) -> dict[str, Any]:
    account = killbill.account_by_key(f"tallyroom-{workspace_id}")
    assert account, "the workspace has a Kill Bill account"
    items = killbill.subscriptions(account["accountId"])
    assert len(items) == 1
    return items[0]


def fields(subscription_id: str) -> dict[str, dict[str, Any]]:
    with kill_bill() as client:
        items = client.get(f"/1.0/kb/subscriptions/{subscription_id}/customFields").json()
    return {item["name"]: item for item in items}


def write_field(subscription_id: str, name: str, value: str) -> None:
    current = fields(subscription_id).get(name)
    with kill_bill() as client:
        path = f"/1.0/kb/subscriptions/{subscription_id}/customFields"
        if current:
            response = client.put(path, json=[{"customFieldId": current["customFieldId"], "name": name, "value": value}])
        else:
            response = client.post(path, json=[{"name": name, "value": value}])
    assert response.status_code < 300, response.text


def drop_field(subscription_id: str, name: str) -> None:
    current = fields(subscription_id).get(name)
    if current:
        with kill_bill() as client:
            client.delete(f"/1.0/kb/subscriptions/{subscription_id}/customFields", params={"customField": current["customFieldId"]})


def limit_is(owner: Api, value: int) -> None:
    poll(lambda: billing(owner).get("limit") == value, FRESH_S, f"limit {value}")


@contextmanager
def seats_kept(owner: Api, killbill: KillBill) -> Iterator[dict[str, Any]]:
    ensure_seats(owner, 0)
    state = billing(owner)
    sub = subscription(killbill, owner.workspace()["id"])
    try:
        yield {"state": state, "id": sub["subscriptionId"]}
    finally:
        drop_field(sub["subscriptionId"], "seats_scheduled")
        write_field(sub["subscriptionId"], "seats", str(state["limit"]))
        limit_is(owner, state["limit"])


def workspace_of(message: dict[str, Any]) -> str | None:
    headers = httpx.get(f"{os.environ['MAILPIT_URL']}/api/v1/message/{message['ID']}/headers", timeout=HTTP_TIMEOUT).json()
    for name, values in headers.items():
        if name.lower() == "x-tallyroom-workspace":
            return values[0]
    return None


def mail_for(mail: Mailpit, workspace_id: str, subject: str | None = None, to: str | None = None) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages():
        if subject and message.get("Subject") != subject:
            continue
        if to and to.lower() not in [item.lower() for item in addresses(message.get("To"))]:
            continue
        if workspace_of(message) == workspace_id:
            found.append(message)
    return found


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = False
        self.open: list[socket.socket] = []
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            upstream = socket.create_connection(self.target)
            self.open += [client, upstream]
            threading.Thread(target=self._pump, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pump, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                sink.sendall(data)
        except OSError:
            pass
        finally:
            for item in (source, sink):
                try:
                    item.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        self.listener.shutdown(socket.SHUT_RDWR)
        self.listener.close()
        for item in self.open:
            item.close()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def app_copy(**env: str) -> Iterator[str]:
    port = free_port()
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    environment = {**os.environ, "APP_PUBLIC_PORT": str(port)}
    environment.pop("SERVER_CLOCK_START", None)
    environment.update(env)
    process = subprocess.Popen(shlex.split(manifest["serve"]), cwd=DEPLOYED_APP, env=environment, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def healthy() -> bool:
        assert process.poll() is None, Path(log.name).read_text()[-2000:]
        try:
            return httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(healthy, BOOT_S, f"copy health: {Path(log.name).read_text()[-2000:]}")
        yield base
    finally:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=HTTP_TIMEOUT)


@contextmanager
def mail_outage() -> Iterator[tuple[str, Relay]]:
    relay = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    try:
        with app_copy(
            SMTP_HOST="127.0.0.1",
            SMTP_PORT=str(relay.port),
            DATABASE_URL=os.environ["DATABASE_URL"] + "_mail",
            S3_BUCKET=os.environ["S3_BUCKET"] + "-mail",
            OUTBOX_RETRY_SECONDS="2",
        ) as base:
            yield base, relay
    finally:
        relay.stop()


def held_mail(owner: Api) -> int:
    return owner.get("/api/status").json()["held_mail"]


def delayed_copy(count: int) -> str:
    return "Mail delayed: 1 message waiting to send." if count == 1 else f"Mail delayed: {count} messages waiting to send."


def clear_inbox(api: Api) -> None:
    for item in api.get("/api/inbox").json()["items"]:
        if item["thread_root_id"] is None:
            api.post(f"/api/channels/{item['channel_id']}/read", {"up_to": item["id"]})
        else:
            api.post(f"/api/threads/{item['thread_root_id']}/read", {"up_to": item["id"]})
    for channel, count in api.unread()["channels"].items():
        if count:
            newest = api.get(f"/api/channels/{channel}/messages").json()["messages"][-1]["id"]
            api.post(f"/api/channels/{channel}/read", {"up_to": newest})


def enter_room(api: Api, room: str) -> None:
    if api.held is None:
        api.held = Stream(api)
    answer = api.post(f"/api/rooms/{room}/join")
    assert answer.status_code == 200, answer.text


def leave_all(*people: Api) -> None:
    for person in people:
        person.post("/api/rooms/leave")
        if person.held is not None:
            person.held.close()
            person.held = None


def empty_channel(owner: Api, channel: str) -> None:
    for item in owner.get(f"/api/channels/{channel}/messages").json()["messages"]:
        owner.delete(f"/api/messages/{item['id']}")


def test_session_gate(app_url: str, browser: Browser) -> None:
    anonymous = Api(app_url)
    for path in ("/api/me", "/api/workspace", "/api/issues", "/api/channels", "/api/floor", "/api/events"):
        failed(anonymous.get(path), 401, "unauthenticated")
    assert anonymous.get("/api/health").json() == {"status": "ok"}
    assert anonymous.get("/api/status").status_code == 200
    failed(anonymous.post("/api/session", {"email": BEN, "password": "wrong-password"}), 401, "invalid_credentials")
    answer = anonymous.post("/api/session", {"email": BEN, "password": PASSWORD})
    assert answer.status_code == 200
    cookie = next(item for item in answer.headers.get_list("set-cookie") if item.startswith("tr_session="))
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    assert anonymous.get("/api/me").json()["person"]["email"] == BEN
    assert anonymous.delete("/api/session").status_code == 204
    failed(anonymous.get("/api/me"), 401, "unauthenticated")
    with blank(browser) as page:
        page.goto(f"{app_url}/issues")
        expect(page).to_have_url(f"{app_url}/sign-in?next=%2Fissues")


def test_workspace_scoping(app_url: str) -> None:
    ana, hal = Api(app_url, ANA), Api(app_url, HAL)
    channel = ana.channel("general")
    message = ana.post_message(channel, stamp("Scoped"))
    doc = new_doc(ana, ana.project("KIL"))
    stored = upload(ana, f"{issue_path('KIL-1')}/attachments", "scoped.txt").json()
    room = ana.room("Lobby")
    for path in (
        issue_path("KIL-1"),
        f"/api/channels/{channel}/messages",
        f"/api/messages/{message['id']}/thread",
        f"/api/docs/{doc['id']}",
        f"/api/attachments/{stored['id']}",
    ):
        failed(hal.get(path), 404, "not_found")
    failed(hal.patch(issue_path("KIL-1"), {"title": "Taken"}), 404, "not_found")
    failed(hal.post(f"/api/channels/{channel}/messages", {"body": "Taken"}), 404, "not_found")
    failed(hal.post(f"/api/rooms/{room['id']}/join"), 404, "not_found")
    failed(hal.delete(f"/api/messages/{message['id']}"), 404, "not_found")
    failed(hal.delete(f"/api/members/{ana.id}"), 404, "not_found")
    failed(ana.get(issue_path("RIG-1")), 404, "not_found")
    assert ana.get(issue_path("KIL-1")).json()["title"] == "Kiln onboarding checklist"
    assert all(item["key"].startswith("RIG-") for item in hal.get("/api/issues", params={"cycle": "1"}).json()["issues"])


def test_guest_api_visibility(app_url: str, crew: Crew) -> None:
    ana, femi = Api(app_url, ANA), Api(app_url, FEMI)
    atlas, kiln = ana.project("ATL"), ana.project("KIL")
    general = ana.channel("general")
    atlas_doc = next(item for item in ana.get("/api/docs").json()["docs"] if item["title"] == "Atlas notes")
    kiln_doc = next(item for item in femi.get("/api/docs").json()["docs"] if item["title"] == "Kiln launch spec")
    failed(femi.get(issue_path("ATL-1")), 404, "not_found")
    failed(femi.get(f"/api/docs/{atlas_doc['id']}"), 404, "not_found")
    failed(femi.get(f"/api/channels/{general}/messages"), 404, "not_found")
    failed(femi.post("/api/issues", {"project_id": atlas, "title": "Hidden"}), 404, "not_found")
    assert [item["key"] for item in femi.get("/api/projects").json()["projects"]] == ["KIL"]
    assert [item["name"] for item in femi.get("/api/channels").json()["channels"]] == ["kiln-review"]
    assert all(item["project_id"] == kiln for item in femi.get("/api/docs").json()["docs"])
    failed(femi.post("/api/docs", {"project_id": kiln, "title": "No", "body": ""}), 403, "forbidden")
    failed(femi.put(f"/api/docs/{kiln_doc['id']}", {"title": "No", "body": "", "base_version": kiln_doc["version"]}), 403, "forbidden")
    failed(femi.get(f"/api/docs/{kiln_doc['id']}/versions"), 403, "forbidden")
    failed(femi.get("/api/invites"), 403, "forbidden")
    guest = crew.join(ana, "guest", projects=(kiln,))
    key = new_issue(guest, kiln)["key"]
    assert guest.get(f"/api/issues/{key}").status_code == 200
    assert ana.delete(f"/api/projects/{kiln}/members/{guest.id}").status_code == 204
    failed(guest.get(f"/api/issues/{key}"), 404, "not_found")
    assert ana.post(f"/api/projects/{kiln}/members", {"person_id": guest.id}).status_code == 204
    assert guest.get(f"/api/issues/{key}").status_code == 200


def test_removal_ends_access(app_url: str, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    member = crew.join(ana)
    channel = ana.channel("general")
    assert member.post(f"/api/rooms/{ana.room('Focus Booth')['id']}/join").status_code == 200
    before = billing(ana)["active"]
    failed(Api(app_url, BEN).delete(f"/api/members/{member.id}"), 403, "forbidden")
    failed(ana.delete(f"/api/members/{ana.id}"), 409, "owner_required")
    with streaming(member) as stream:
        assert ana.delete(f"/api/members/{member.id}").status_code == 204
        revoked = stream.wait("revoked", lambda data: data["scope"] == "workspace")
        assert revoked["data"]["id"] == ana.workspace()["id"]
        assert stream.closed.wait(LIVE_S), "the stream closes"
    failed(member.get("/api/me"), 401, "unauthenticated")
    assert billing(ana)["active"] == before - 1
    assert member.id not in ana.inside("Focus Booth")
    assert member.id not in [item["id"] for item in ana.get("/api/members").json()["members"]]
    ana.post_message(channel, f"@{member.person['handle']} gone")
    assert ana.get(f"/api/channels/{channel}/messages").json()["messages"][-1]["mentions"] == []


def test_lost_channel_stream(app_url: str, crew: Crew) -> None:
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    kiln, channel = ana.project("KIL"), ana.channel("kiln-review")
    guest = crew.join(ana, "guest", projects=(kiln,), channels=(channel,))
    with streaming(guest) as stream:
        first = ben.post_message(channel, stamp("Before"))
        seen = stream.wait("message", lambda data: data["id"] == first["id"])
        marker = int(seen["id"])
        assert ana.delete(f"/api/channels/{channel}/members/{guest.id}").status_code == 204
        stream.wait("revoked", lambda data: data == {"scope": "channel", "id": channel})
        stream.wait("unread", lambda data: channel not in data["channels"])
        hidden = ben.post_message(channel, stamp("After"))
        assert ben.post(f"/api/channels/{channel}/typing").status_code == 204
        assert ana.delete(f"/api/projects/{kiln}/members/{guest.id}").status_code == 204
        stream.wait("revoked", lambda data: data == {"scope": "project", "id": kiln})
        issue = new_issue(ben, kiln)
        ping = ana.post_message(ana.channel("general"), stamp("Ping"))
        stays(lambda: True, LIVE_S, "delivery window")
        assert len(stream.named("revoked", lambda data: data["id"] == channel)) == 1
        assert len(stream.named("revoked", lambda data: data["id"] == kiln)) == 1
        assert not stream.named("message", lambda data: data["id"] == hidden["id"])
        assert not stream.named("typing", lambda data: data["channel_id"] == channel)
        assert not stream.named("issue", lambda data: data["key"] == issue["key"])
    with streaming(guest, marker) as replay:
        stays(lambda: True, LIVE_S, "replay window")
        assert not replay.named("message") and not replay.named("issue", lambda data: data["project_id"] == kiln)
        assert ping["id"] not in [item["data"].get("id") for item in replay.events]


def test_password_change_ends_sessions(app_url: str, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    first = crew.join(ana)
    second = Api(app_url, first.email)
    fresh_password = "tally-demo-2"
    failed(first.post("/api/account/password", {"current_password": "wrong-password", "new_password": fresh_password}), 403, "invalid_credentials")
    assert first.get("/api/me").status_code == 200
    error = failed(first.post("/api/account/password", {"current_password": PASSWORD, "new_password": "short"}), 422, "validation")
    assert "new_password" in error["fields"]
    with streaming(first) as kept, streaming(second) as other:
        assert first.post("/api/account/password", {"current_password": PASSWORD, "new_password": fresh_password}).status_code == 204
        other.wait("revoked", lambda data: data["scope"] == "workspace")
        assert other.closed.wait(LIVE_S)
        assert not kept.closed.is_set() and not kept.named("revoked")
    failed(second.get("/api/me"), 401, "unauthenticated")
    assert first.get("/api/me").status_code == 200
    failed(Api(app_url).post("/api/session", {"email": first.email, "password": PASSWORD}), 401, "invalid_credentials")
    assert Api(app_url).post("/api/session", {"email": first.email, "password": fresh_password}).status_code == 200


def test_wf_gate_and_tenancy_sign_in(app_url: str, browser: Browser) -> None:
    with blank(browser) as page:
        page.goto(f"{app_url}/sign-in")
        sign_in_form(page, BEN)
        expect(page).to_have_url(f"{app_url}/issues")
        expect(role(page, "link", "Issues")).to_have_attribute("aria-current", "page")
        expect(row_of(page, {"key": "KIL-1", "title": "Kiln onboarding checklist"})).to_be_visible()
        role(page, "button", "Sign out").click()
        expect(page).to_have_url(f"{app_url}/sign-in")
        answer = page.context.request.get(f"{app_url}/api/me")
        assert answer.status == 401


def test_wf_gate_and_tenancy_guest_surfaces(app_url: str, browser: Browser, crew: Crew) -> None:
    ana, femi = Api(app_url, ANA), Api(app_url, FEMI)
    outsider = crew.join(ana, "guest", projects=(ana.project("ATL"),))
    assert femi.get("/api/workspace").json()["seats"] is None
    assert ana.workspace()["seats"]["active"] >= 7
    names = [item["id"] for item in femi.get("/api/members").json()["members"]]
    assert outsider.id not in names and ana.id in names
    assert all(key.startswith("KIL-") for key in femi.current()["issue_keys"])
    assert all(item["key"].startswith("KIL-") for item in femi.get("/api/issues").json()["issues"])
    with signed_in(browser, app_url, FEMI, "/issues") as page:
        assert option_labels(page, role(page, "combobox", "Project filter")) == ["All projects", "Kiln"]
        expect(listing(page).get_by_role("row", name=re.compile("^ATL-"))).to_have_count(0)
        row_of(page, {"key": "KIL-1", "title": "Kiln onboarding checklist"}).get_by_role("button", name=re.compile("^Assignee: ")).click()
        box = role(page, "listbox", "Assignee")
        expect(box.get_by_role("option")).to_have_text(["Unassigned", "Ana Whitlow", "Ben Ostrow", "Chiara Lund", "Dev Ramaswamy", "Elin Park", "Femi Ade"])
        page.keyboard.press("Escape")
        page.goto(f"{app_url}/cycle")
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        expect(chip(page, "ATL-1")).to_have_count(0)
        expect(page.get_by_text(re.compile(r"\d+ of \d+ seats used"))).to_have_count(0)
        page.goto(f"{app_url}/settings")
        expect(page).to_have_url(f"{app_url}/issues")


def test_wf_gate_and_tenancy_next_person_on_tab(app_url: str, browser: Browser) -> None:
    ben, femi = Api(app_url, BEN), Api(app_url, FEMI)

    def identity(api: Api) -> bool:
        me = api.get("/api/me").json()["person"]["email"]
        keys = [item["key"] for item in api.get("/api/issues", params={"cycle": "1"}).json()["issues"]]
        return me == api.email and (api is ben or all(key.startswith("KIL-") for key in keys))

    with futures.ThreadPoolExecutor(8) as pool:
        assert all(pool.map(identity, [ben, femi] * 20))
    with signed_in(browser, app_url, BEN, "/issues") as page:
        role(page, "textbox", "Title").count()
        with held(page, ISSUE_ANY_GLOB) as release:
            select(role(page, "combobox", "Project filter"), "Atlas")
            role(page, "button", "Sign out").click()
            expect(page).to_have_url(f"{app_url}/sign-in")
            sign_in_form(page, FEMI)
            expect(page).to_have_url(f"{app_url}/issues")
            release()
        expect(row_of(page, {"key": "KIL-1", "title": "Kiln onboarding checklist"})).to_be_visible()
        expect(listing(page).get_by_role("row", name=re.compile("^ATL-"))).to_have_count(0)
        assert [item.strip() for item in page.get_by_role("link", name="Settings").all_inner_texts()] == []


def test_calendar_validation(app_url: str) -> None:
    owner, iris = Api(clock_url(), HAL), Api(clock_url(), IRIS)
    original = calendar_of(owner.workspace())
    failed(iris.put("/api/workspace/calendar", original), 403, "forbidden")
    bad = {"time_zone": "Mars/Base", "working_weekdays": [], "holidays": [{"date": "2027-02-30", "name": "Bad"}], "cycle_anchor": "2026-13-40"}
    error = failed(owner.put("/api/workspace/calendar", bad), 422, "validation")
    assert error["fields"]["time_zone"] == "Choose a time zone from the list."
    assert error["fields"]["working_weekdays"] == "Pick at least one working day."
    assert error["fields"]["holidays"] == "Enter a date as YYYY-MM-DD."
    assert error["fields"]["cycle_anchor"] == "Enter a date as YYYY-MM-DD."
    holiday = {"date": "2027-03-01", "name": "One"}
    for holidays, copy in (
        ([holiday, holiday], "That date is already a holiday."),
        ([{"date": "2027-03-01", "name": ""}], "Give the holiday a name."),
        ([{"date": "2027-03-01", "name": "x" * 61}], "Holiday names can be up to 60 characters."),
    ):
        answer = failed(owner.put("/api/workspace/calendar", {**original, "holidays": holidays}), 422, "validation")
        assert answer["fields"] == {"holidays": copy}
    moved = failed(owner.put("/api/workspace/calendar", {**original, "cycle_anchor": "2026-11-02"}), 422, "validation")
    assert moved["fields"]["cycle_anchor"] == "The first cycle start can't change after cycle 1 has begun."
    assert calendar_of(owner.workspace()) == original
    with calendar_kept(owner):
        saved = save_calendar(owner, working_weekdays=[2, 3, 4], holidays=[{"date": "2027-03-02", "name": "x" * 60}])
        assert saved["working_weekdays"] == [2, 3, 4] and saved["holidays"][0]["name"] == "x" * 60


def test_workspace_today_device_clock(browser: Browser) -> None:
    owner, kereru = Api(clock_url(), HAL), Api(clock_url(), ANA)
    ana_today = kereru.workspace()
    assert ana_today["today"] in [item["date"] for item in kereru.current()["days"]]
    weekday = date.fromisoformat(ana_today["today"]).isoweekday()
    assert ana_today["is_working_day"] == (weekday in ana_today["working_weekdays"])
    far_west, far_east = "Pacific/Pago_Pago", "Pacific/Kiritimati"
    with calendar_kept(owner):
        save_calendar(owner, time_zone=far_west)
        west = owner.workspace()["today"]
        with signed_in(browser, clock_url(), IRIS, "/cycle", device_time="2031-06-15T12:00:00Z", timezone_id="Europe/Paris") as page:
            expect(detail(page).get_by_text(f"Today: {pretty(west)}")).to_be_visible()
            save_calendar(owner, time_zone=far_east)
            east = owner.workspace()["today"]
            assert east != west
            expect(detail(page).get_by_text(f"Today: {pretty(east)}")).to_be_visible(timeout=REFRESH_MS)


def test_wf_working_calendar_refresh_journey(browser: Browser) -> None:
    ana = Api(clock_url(), ANA)
    with calendar_kept(ana) as original:
        target = last_counted_after_today(ana)
        holiday = stamp("Harbour")
        finished = cycle_at(ana, 1)
        with signed_in(browser, clock_url(), BEN, "/cycle", timezone_id="Europe/Paris") as ben, signed_in(browser, clock_url(), ANA, "/settings") as page:
            mark_page(ben)
            form = role(page, "form", "Working calendar")
            for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"):
                expect(role(form, "checkbox", day)).to_be_checked()
            expect(role(form, "checkbox", "Saturday")).not_to_be_checked()
            role(form, "textbox", "Holiday date").fill(target)
            role(form, "textbox", "Holiday name").fill(holiday)
            wait_refreshes(page)
            expect(role(form, "textbox", "Holiday date")).to_have_value(target)
            expect(role(form, "textbox", "Holiday name")).to_have_value(holiday)
            role(form, "button", "Add holiday").click()
            role(form, "button", "Save calendar").click()
            announced(page, "Calendar saved.")
            stored = ana.workspace()["holidays"]
            assert len(stored) == len(original["holidays"]) + 1 and {"date": target, "name": holiday} in stored
            expect(role(ribbon(ben), "button", f"{pretty(target)}, not counted")).to_be_visible(timeout=REFRESH_MS)
            expect(detail(ben).get_by_text(f"Today: {pretty(ana.workspace()['today'])}")).to_be_visible()
            assert page_kept(ben)
        assert cycle_at(ana, 1) == finished


def test_refresh_keeps_crease_and_focus(browser: Browser) -> None:
    ana = Api(clock_url(), ANA)
    with calendar_kept(ana):
        cycle = ana.current()
        weekend = next(item["date"] for item in cycle["days"] if item["reason"] == "Weekend")
        with signed_in(browser, clock_url(), BEN, "/cycle", script=RECORDER) as page:
            expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
            crease = role(ribbon(page), "button", f"{pretty(weekend)}, not counted")
            crease.click()
            expect(crease).to_have_attribute("aria-expanded", "true")
            wait_refreshes(page)
            expect(crease).to_have_attribute("aria-expanded", "true")
            expect(crease).to_be_focused()
            page.keyboard.press("Tab")
            expect(crease).to_have_attribute("aria-expanded", "false")
            target = last_counted_after_today(ana)
            page.evaluate("window.__ribbon.length = 0")
            save_calendar(ana, holidays=ana.workspace()["holidays"] + [{"date": target, "name": "Redraw Day"}])
            added = role(ribbon(page), "button", f"{pretty(target)}, not counted")
            expect(added).to_be_visible(timeout=REFRESH_MS)
            redrawn = poll(lambda: [item for item in samples(page) if f"{pretty(target)}, not counted" in item["labels"]], UI_MS / 1000, "redrawn ribbon sampled")
            assert max(redrawn[0]["creases"]) <= CREASE_MAX_PX
            assert all(item["counter"] == "10 working days" for item in redrawn)
        with signed_in(browser, clock_url(), ANA, "/settings") as page:
            next_at = ana.workspace()["next_digest_at"][:10]
            expect(page.get_by_text(f"Next digest: {pretty(next_at)} 08:00")).to_be_visible()


def test_wf_working_calendar_error_summary(browser: Browser) -> None:
    ana = Api(clock_url(), ANA)
    original = calendar_of(ana.workspace())
    with calendar_kept(ana), signed_in(browser, clock_url(), ANA, "/settings") as page:
        form = role(page, "form", "Working calendar")
        zone = role(form, "combobox", "Time zone")
        zone.fill("Mars/Base")
        role(form, "textbox", "Holiday date").fill("2026-12-30")
        role(form, "button", "Add holiday").click()
        role(form, "button", "Save calendar").click()
        problems = 2
        announced(page, f"Calendar not saved: {problems} problems.")
        summary = role(page, "region", "Calendar errors")
        expect(summary.get_by_role("link")).to_have_text(["Choose a time zone from the list.", "Give the holiday a name."])
        wait_refreshes(page)
        expect(summary.get_by_role("link")).to_have_count(2)
        expect(zone).to_have_attribute("aria-invalid", "true")
        assert zone.get_attribute("aria-describedby")
        role(summary, "link", "Choose a time zone from the list.").click()
        expect(zone).to_be_focused()
        role(summary, "link", "Give the holiday a name.").click()
        expect(role(form, "textbox", "Holiday date")).to_be_focused()
        assert calendar_of(ana.workspace()) == original
        zone.fill("Pacific/Auckland")
        expect(summary.get_by_role("link")).to_have_count(1)
        role(form, "button", "Save calendar").click()
        announced(page, "Calendar not saved: 1 problem.")
        role(form, "button", f"Remove holiday {pretty('2026-12-30')}").click()
        role(form, "button", "Save calendar").click()
        announced(page, "Calendar saved.")
        expect(summary.get_by_role("link")).to_have_count(0)


def test_calendar_from_today(app_url: str) -> None:
    ana, femi = Api(clock_url(), ANA), Api(clock_url(), FEMI)
    finished = {api: cycle_at(api, 1) for api in (ana, femi)}
    members = {api: api.get("/api/issues", params={"cycle": "1"}).json()["issues"] for api in (ana, femi)}
    assert finished[ana]["is_finished"]
    keys = {item["key"] for item in members[ana]}
    before = ana.current()
    today = ana.workspace()["today"]
    with calendar_kept(ana) as original:
        past = {"date": "2026-10-21", "name": "Too Late"}
        saved = save_calendar(ana, working_weekdays=[1, 2, 3, 5], holidays=original["holidays"] + [past])
        assert past in saved["holidays"]
        after = ana.current()
        assert after["starts_at"] == before["starts_at"] and after["working_day_count"] == 10
        earlier = {item["date"]: item for item in before["days"]}
        for item in after["days"]:
            if item["date"] < today:
                assert item == earlier[item["date"]]
            elif item["date"] > today and date.fromisoformat(item["date"]).isoweekday() == 4:
                assert not item["counted"] and item["reason"] == "Non-working day"
        assert after["last_working_date"] > before["last_working_date"]
        assert cycle_at(ana, 1) == finished[ana]
        assert cycle_at(femi, 1) == finished[femi]
        try:
            for status in ("cancelled", "todo"):
                walk(ana, "ATL-1", status)
                assert cycle_at(ana, 1) == finished[ana]
                assert {item["key"] for item in ana.get("/api/issues", params={"cycle": "1"}).json()["issues"]} == keys
        finally:
            walk(ana, "ATL-1", "todo")


def test_cycle_boundaries(app_url: str) -> None:
    ana, hal = Api(app_url, ANA), Api(app_url, HAL)
    first = cycle_at(ana, 1)
    assert (first["starts_at"], first["ends_at"]) == ("2026-10-19T00:00:00+13:00", "2026-11-02T00:00:00+13:00")
    assert first["calendar_days"] == 14 and first["working_day_count"] == 10 and len(first["days"]) == 14
    fifth = cycle_at(ana, 5)
    assert (fifth["first_working_date"], fifth["last_working_date"]) == ("2026-12-14", "2026-12-29")
    assert cycle_at(ana, 2)["starts_at"] == first["ends_at"]
    halyard = cycle_at(hal, 1)
    assert (halyard["starts_at"], halyard["ends_at"]) == ("2026-10-26T00:00:00-04:00", "2026-11-09T00:00:00-05:00")
    sunday = next(item for item in halyard["days"] if item["date"] == "2026-11-01")
    assert sunday == {"date": "2026-11-01", "counted": False, "reason": "Weekend", "clock_change": "back"}
    for bad in ("0", "1001", "abc"):
        failed(ana.get(f"/api/cycles/{bad}"), 404, "not_found")
    owner = Api(clock_url(), HAL)
    with calendar_kept(owner):
        save_calendar(owner, time_zone="Africa/Cairo", working_weekdays=[1, 2, 3, 4, 5, 6, 7])
        cairo = first_cycle_on(owner, "2027-04-30")
        assert cairo["starts_at"] == "2027-04-30T01:00:00+03:00"
        assert cairo["days"][0]["clock_change"] == "forward"
        assert owner.get(f"/api/cycles/{cairo['number'] - 1}").json()["ends_at"] == cairo["starts_at"]
    with calendar_kept(owner):
        save_calendar(owner, time_zone="America/Havana", working_weekdays=[1, 2, 3, 4, 5, 6, 7])
        havana = first_cycle_on(owner, "2027-11-07")
        assert havana["starts_at"] == "2027-11-07T00:00:00-04:00"
        assert havana["days"][0]["clock_change"] == "back"


def test_rollover_attribution() -> None:
    ana, hal = Api(clock_url(), ANA), Api(clock_url(), HAL)
    current = ana.current()["number"]
    assert current >= 2
    assert ana.get(issue_path("KIL-1")).json()["cycle_number"] == current
    assert ana.get(issue_path("KIL-3")).json()["cycle_number"] == 1
    assert ana.get(issue_path("KIL-6")).json()["cycle_number"] is None
    with calendar_kept(hal) as original:
        today = hal.workspace()["today"]
        save_calendar(hal, holidays=original["holidays"] + [{"date": today, "name": "Closing Day"}])
        assert hal.workspace()["is_working_day"] is False
        cycle = hal.current()["number"]
        planned = new_issue(hal, hal.project("RIG"), cycle_number=cycle + 1)
        assert planned["cycle_number"] == cycle + 1
        closed = walk(hal, planned["key"], "done")
        assert closed["closed_at"] and closed["cycle_number"] == cycle
        assert planned["key"] in hal.current()["issue_keys"]


def test_due_date_snap(app_url: str) -> None:
    ana = Api(app_url, ANA)
    kiln = ana.project("KIL")
    created = new_issue(ana, kiln, due_date="2026-12-25")
    assert (created["due_date"], created["due_date_snapped"]) == ("2026-12-29", True)
    key = created["key"]
    plain = ana.patch(f"/api/issues/{key}", {"due_date": "2026-12-30"}).json()
    assert (plain["due_date"], plain["due_date_snapped"]) == ("2026-12-30", False)
    weekend = ana.patch(f"/api/issues/{key}", {"due_date": "2026-12-26"}).json()
    assert (weekend["due_date"], weekend["due_date_snapped"]) == ("2026-12-29", True)
    assert ana.get(f"/api/issues/{key}").json()["due_date"] == "2026-12-29"
    for bad in ("2026-02-30", "soon"):
        assert "due_date" in failed(ana.patch(f"/api/issues/{key}", {"due_date": bad}), 422, "validation")["fields"]
    assert ana.patch(f"/api/issues/{key}", {"due_date": None}).json()["due_date"] is None


def test_crease_fold(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    cycle = ben.current()
    with signed_in(browser, app_url, BEN, "/cycle", script=RECORDER) as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        poll(lambda: fold_ended(page), UI_MS / 1000, "fold ends")
        frames = samples(page)
        start, end = frames[0], frames[-1]
        assert start["counter"] == f"{cycle['calendar_days']} days"
        assert abs(start["creases"][0] - start["groups"][0]) <= CENTRE_PX
        assert max(end["creases"]) <= CREASE_MAX_PX and min(end["groups"]) > start["groups"][0]
        counted = next(item for item in frames if item["counter"] == "10 working days")
        assert counted["t"] - start["t"] <= SEQUENCE_MAX_MS
        label = next(item["date"] for item in cycle["days"] if not item["counted"])
        crease = role(ribbon(page), "button", f"{pretty(label)}, not counted")
        assert crease.inner_text().strip()
        assert crease.bounding_box()["height"] >= TARGET_PX


def test_crease_unfold(app_url: str, browser: Browser) -> None:
    with signed_in(browser, app_url, IRIS, "/cycle/1") as page:
        crease = role(ribbon(page), "button", "Sun 1 Nov, not counted")
        expect(crease).to_have_attribute("aria-expanded", "false")
        crease.click()
        expect(crease).to_have_attribute("aria-expanded", "true")
        for copy in ("Not counted", "Weekend", "Clocks go back"):
            poll(lambda: any(item.is_visible() for item in ribbon(page).get_by_text(copy).all()), UI_MS / 1000, f"{copy} shown")
        other = role(ribbon(page), "button", "Sat 31 Oct, not counted")
        other.focus()
        expect(crease).to_have_attribute("aria-expanded", "false")
        page.keyboard.press("Enter")
        expect(other).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("Tab")
        expect(other).to_have_attribute("aria-expanded", "false")
        crease.focus()
        page.keyboard.press("Space")
        expect(crease).to_have_attribute("aria-expanded", "true")
        expect(other).to_have_attribute("aria-expanded", "false")
    with signed_in(browser, app_url, BEN, "/cycle/5") as page:
        crease = role(ribbon(page), "button", "Fri 25 Dec, not counted")
        crease.click()
        poll(lambda: any(item.is_visible() for item in ribbon(page).get_by_text("Christmas Day").all()), UI_MS / 1000, "holiday name shown")


def test_burndown_values(browser: Browser) -> None:
    expected = {ANA: [6, 6, 5, 5, 5, 5, 5, 5, 5, 5], FEMI: [5, 5, 4, 4, 4, 4, 4, 4, 4, 4]}
    for email, values in expected.items():
        api = Api(clock_url(), email)
        cycle = cycle_at(api, 1)
        assert [item["open"] for item in cycle["burndown"]] == values
        counted = [item["date"] for item in cycle["days"] if item["counted"]]
        assert [item["date"] for item in cycle["burndown"]] == counted
        route = "/cycle/1"
        with signed_in(browser, clock_url(), email, route) as page:
            rows = role(page, "list", "Burndown values").get_by_role("listitem")
            expect(rows).to_have_text([f"{pretty(day)}: {value} open" for day, value in zip(counted, values)])
            expect(role(page, "img", "Burndown").locator("circle")).to_have_count(10)


def test_reduced_motion_ribbon(app_url: str, browser: Browser) -> None:
    cycle = Api(app_url, BEN).current()
    with signed_in(browser, app_url, BEN, "/cycle", script=RECORDER, reduced_motion="reduce") as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        frames = poll(lambda: samples(page), UI_MS / 1000, "ribbon sampled")
        assert max(frames[0]["creases"]) <= CREASE_MAX_PX
        assert all(item["counter"] == "10 working days" for item in frames)
        day = next(item["date"] for item in cycle["days"] if not item["counted"])
        crease = role(ribbon(page), "button", f"{pretty(day)}, not counted")
        crease.click()
        expect(crease).to_have_attribute("aria-expanded", "true")
        assert animations(crease) == []


def test_wf_crease_cycle_planning(browser: Browser) -> None:
    chiara, ana = Api(clock_url(), CHIARA), Api(clock_url(), ANA)
    with calendar_kept(ana) as original:
        target = last_counted_after_today(ana)
        holiday_name = stamp("Planning")
        save_calendar(ana, holidays=original["holidays"] + [{"date": target, "name": holiday_name}])
        cycle = chiara.current()
        issue = new_issue(chiara, chiara.project("KIL"), cycle_number=cycle["number"])
        dates = [item["date"] for item in cycle["days"]]
        weekend = next(item["date"] for item in cycle["days"] if item["reason"] == "Weekend")
        landing = next(item["date"] for item in cycle["days"] if item["counted"] and item["date"] > weekend)
        assert landing in dates
        with signed_in(browser, clock_url(), CHIARA, "/cycle") as page:
            expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
            holiday = role(ribbon(page), "button", f"{pretty(target)}, not counted")
            holiday.click()
            expect(ribbon(page).get_by_text(holiday_name).first).to_be_visible()
            tray_chip = role(role(page, "group", "Unplaced"), "button", f"{issue['key']}, no due date")
            tray_chip.drag_to(role(ribbon(page), "button", f"{pretty(weekend)}, not counted"))
            announced(page, f"Due date moved to {pretty(landing)}, the next working day.")
            expect(role(role(ribbon(page), "group", pretty(landing)), "button", f"{issue['key']} due {pretty(landing)}")).to_be_visible()
        assert chiara.get(f"/api/issues/{issue['key']}").json()["due_date"] == landing


def test_wf_crease_cycle_failed_move(browser: Browser) -> None:
    chiara = Api(clock_url(), CHIARA)
    cycle = chiara.current()
    counted = [item["date"] for item in cycle["days"] if item["counted"]]
    start, target = counted[-3], counted[-2]
    issue = new_issue(chiara, chiara.project("KIL"), cycle_number=cycle["number"], due_date=start)
    gate: list[Any] = []
    with signed_in(browser, clock_url(), CHIARA, "/cycle") as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        page.route(ISSUE_PATCH_GLOB, lambda route: gate.append(route) if route.request.method == "PATCH" else route.fallback())
        moving = chip(page, issue["key"])
        moving.focus()
        with page.expect_request(lambda request: request.method == "PATCH"):
            page.keyboard.press("Shift+ArrowRight")
        expect(chip(role(ribbon(page), "group", pretty(target)), issue["key"])).to_be_visible()
        gate[0].fulfill(status=500, content_type="application/json", body=json.dumps({"error": {"code": "database_unavailable", "message": "Down"}}))
        announced(page, "Due date not saved.")
        expect(chip(role(ribbon(page), "group", pretty(start)), issue["key"])).to_be_visible()
        expect(chip(page, issue["key"])).to_be_focused()
    assert chiara.get(f"/api/issues/{issue['key']}").json()["due_date"] == start


def test_wf_crease_cycle_touch_drag(browser: Browser) -> None:
    chiara = Api(clock_url(), CHIARA)
    cycle = chiara.current()
    weekend = next(item["date"] for item in cycle["days"] if item["reason"] == "Weekend")
    landing = next(item["date"] for item in cycle["days"] if item["counted"] and item["date"] > weekend)
    issue = new_issue(chiara, chiara.project("KIL"), cycle_number=cycle["number"])
    with signed_in(browser, clock_url(), CHIARA, "/cycle", viewport=PHONE, has_touch=True) as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        cdp = session(page)
        moving = chip(page, issue["key"])
        moving.scroll_into_view_if_needed()
        x, y = center(moving)
        touch_down(cdp, x, y)
        touch_move(cdp, x, y - 40)
        touch_up(cdp)
        assert chiara.get(f"/api/issues/{issue['key']}").json()["due_date"] is None
        crease = role(ribbon(page), "button", f"{pretty(weekend)}, not counted")
        crease.scroll_into_view_if_needed()
        moving.scroll_into_view_if_needed()
        start, target = moving.bounding_box(), crease.bounding_box()
        x, y = start["x"] + start["width"] / 2, start["y"] + start["height"] / 2
        target_x, target_y = target["x"] + target["width"] / 2, target["y"] + target["height"] / 2
        touch_down(cdp, x, y)
        page.evaluate("ms => new Promise(done => setTimeout(done, ms))", LONG_PRESS_MS + HOLD_SLACK_MS)
        touch_move(cdp, (x + target_x) / 2, (y + target_y) / 2)
        touch_move(cdp, target_x, target_y)
        touch_up(cdp)
        announced(page, f"Due date moved to {pretty(landing)}, the next working day.")
    assert chiara.get(f"/api/issues/{issue['key']}").json()["due_date"] == landing
    finished = cycle_at(chiara, 1)
    counted = [item["date"] for item in finished["days"] if item["counted"]]
    with signed_in(browser, clock_url(), CHIARA, "/cycle/1", script=RECORDER) as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        circles = role(page, "img", "Burndown").locator("circle")
        expect(circles).to_have_count(10)

        def aligned() -> bool:
            for index, day in enumerate(counted):
                box = circles.nth(index).bounding_box()
                column = role(ribbon(page), "group", pretty(day)).bounding_box()
                if abs((box["x"] + box["width"] / 2) - (column["x"] + column["width"] / 2)) > CENTRE_PX:
                    return False
            return True

        poll(lambda: fold_ended(page), UI_MS / 1000, "fold ends")
        expect(circles.last).to_be_visible()
        page.get_by_role("button", name=re.compile(", not counted$")).first.click()
        poll(lambda: any(item.is_visible() for item in page.get_by_text("Not counted").all()), UI_MS / 1000, "Not counted shown")
        poll(lambda: ribbon(page).evaluate("el => el.getAnimations({subtree: true}).every(item => item.playState !== 'running')"), UI_MS / 1000, "unfold settles")
        poll(aligned, UI_MS / 1000, "circles sit over their columns")
        page.emulate_media(reduced_motion="reduce")
        old = samples(page)[-1]["labels"]
        page.evaluate("window.__ribbon.length = 0")
        role(page, "button", "Next cycle").click()
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        poll(lambda: [item for item in samples(page) if item["labels"] != old], UI_MS / 1000, "next cycle drawn")
        drawn = [item for item in samples(page) if item["labels"] != old]
        assert max(drawn[0]["creases"]) <= CREASE_MAX_PX
        assert all(item["counter"] == "10 working days" for item in drawn)


def test_issue_keys(app_url: str) -> None:
    ben, femi = Api(app_url, BEN), Api(app_url, FEMI)
    kiln, atlas = ben.project("KIL"), ben.project("ATL")
    first = new_issue(femi, kiln)
    start = int(first["key"].split("-")[1])
    assert first["key"].startswith("KIL-")
    with futures.ThreadPoolExecutor(8) as pool:
        created = list(pool.map(lambda _: new_issue(ben, kiln), range(8)))
    numbers = sorted(int(item["key"].split("-")[1]) for item in created)
    assert numbers == list(range(start + 1, start + 9))
    assert ben.get(f"/api/issues/{first['key']}").json()["title"] == first["title"]
    assert new_issue(ben, atlas)["key"].startswith("ATL-")
    assert "title" in failed(ben.post("/api/issues", {"project_id": kiln, "title": "   "}), 422, "validation")["fields"]
    assert "title" in failed(ben.post("/api/issues", {"project_id": kiln, "title": "x" * 201}), 422, "validation")["fields"]
    assert new_issue(ben, kiln, title="😀" * 200)["title"] == "😀" * 200
    failed(ben.post("/api/issues", {"project_id": atlas, "title": "Bad", "assignee_id": femi.id}), 422, "validation")
    failed(ben.post("/api/issues", {"project_id": kiln, "title": "Bad", "parent_key": "ATL-1"}), 422, "validation")
    child = new_issue(ben, kiln, parent_key=first["key"])
    assert child["parent_key"] == first["key"]
    assert child["key"] in ben.get(f"/api/issues/{first['key']}").json()["sub_issue_keys"]
    failed(ben.post("/api/issues", {"project_id": kiln, "title": "Bad", "parent_key": child["key"]}), 422, "validation")
    clock = Api(clock_url(), BEN)
    failed(clock.post("/api/issues", {"project_id": clock.project("KIL"), "title": "Late", "cycle_number": 1}), 409, "cycle_closed")


def test_status_edges(app_url: str) -> None:
    ben = Api(app_url, BEN)
    kiln = ben.project("KIL")
    key = new_issue(ben, kiln)["key"]
    for source, targets in EDGES.items():
        for target in STATUS_LABEL:
            if target not in targets:
                walk(ben, key, source)
                failed(ben.post(f"/api/issues/{key}/transition", {"to": target}), 409, "illegal_transition")
                assert ben.get(f"/api/issues/{key}").json()["status"] == source
        for target in targets:
            walk(ben, key, source)
            moved = ben.post(f"/api/issues/{key}/transition", {"to": target}).json()
            assert moved["status"] == target
            assert bool(moved["closed_at"]) == (target in ("done", "cancelled"))
    failed(ben.post(f"/api/issues/{key}/transition", {"to": "shipped"}), 422, "validation")
    parent = new_issue(ben, kiln)["key"]
    child = new_issue(ben, kiln, parent_key=parent)["key"]
    walk(ben, parent, "in_review")
    failed(ben.post(f"/api/issues/{parent}/transition", {"to": "done"}), 409, "open_sub_issues")
    assert ben.get(f"/api/issues/{parent}").json()["status"] == "in_review"
    walk(ben, child, "cancelled")
    assert ben.post(f"/api/issues/{parent}/transition", {"to": "done"}).status_code == 200


def test_pickers_shortcuts(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    keys = [item["key"] for item in ben.get("/api/issues", params={"project": ben.project("KIL"), "cycle": "current"}).json()["issues"]]
    with signed_in(browser, app_url, BEN, f"/issues?project={ben.project('KIL')}") as page:
        row = row_of(page, {"key": "KIL-1", "title": "Kiln onboarding checklist"})
        expect(row).to_be_visible()
        select_row(page, keys, "KIL-1")
        button = row.get_by_role("button", name=re.compile("^Status: "))
        button.focus()
        page.keyboard.press("s")
        box = role(page, "listbox", "Status")
        expect(box.get_by_role("option")).to_have_text(["Backlog", "In progress", "Cancelled"])
        expect(box.get_by_role("option").first).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(box.get_by_role("option").first).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(box.get_by_role("option").nth(1)).to_be_focused()
        page.keyboard.press("Escape")
        expect(box).to_have_count(0)
        expect(button).to_be_focused()
        assert ben.get(issue_path("KIL-1")).json()["status"] == "todo"
        page.keyboard.press("a")
        assignee = role(page, "listbox", "Assignee")
        expect(assignee.get_by_role("option").first).to_have_text("Unassigned")
        page.keyboard.press("Escape")
        expect(button).to_be_focused()
        page.goto(f"{app_url}/cycle")
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if focus_inside(listing(page)):
                break
        origin = page.evaluate("document.activeElement.outerHTML")
        page.keyboard.press("s")
        expect(role(page, "listbox", "Status")).to_be_visible()
        page.keyboard.press("Escape")
        poll(lambda: page.evaluate("document.activeElement.outerHTML") == origin, UI_MS / 1000, "focus returns to where it started")


def test_wf_issue_triage_keyboard(app_url: str, browser: Browser) -> None:
    ben, chiara = Api(app_url, BEN), Api(app_url, CHIARA)
    kiln = ben.project("KIL")
    current = ben.current()["number"]
    first, second, third = (new_issue(ben, kiln, cycle_number=current) for _ in range(3))
    for item in (first, second, third):
        walk(ben, item["key"], "todo")
    with signed_in(browser, app_url, BEN, "/issues") as page:
        select(role(page, "combobox", "Project filter"), "Kiln")
        expect(page).to_have_url(re.compile(rf"project={kiln}"))
        expect(row_of(page, first)).to_be_visible()
        with page.expect_response(is_stream):
            page.reload()
        expect(page).to_have_url(re.compile(rf"project={kiln}"))
        expect(row_of(page, first)).to_be_visible()
        keys = [item["key"] for item in ben.get("/api/issues", params={"project": kiln, "cycle": "current"}).json()["issues"]]
        select_row(page, keys, first["key"])
        page.keyboard.press("s")
        choose(page, "Status", "In progress")
        progress = STATUS_LABEL["in_progress"]
        announced(page, f"{first['key']} moved to {progress}.")
        expect(row_of(page, first).get_by_role("button", name=f"Status: {progress}")).to_be_visible()
        focus_settles(row_of(page, first))
        keys = [item["key"] for item in ben.get("/api/issues", params={"project": kiln, "cycle": "current"}).json()["issues"]]
        for _ in keys:
            page.keyboard.press("k")
        for _ in range(keys.index(second["key"])):
            page.keyboard.press("j")
        page.keyboard.press("a")
        choose(page, "Assignee", CHIARA_NAME)
        announced(page, f"{second['key']} assigned to {CHIARA_NAME}.")
        expect(row_of(page, second).get_by_role("button", name=f"Assignee: {CHIARA_NAME}")).to_be_visible()
        focus_settles(row_of(page, second))
        assert chiara.post(f"/api/issues/{third['key']}/transition", {"to": "in_progress"}).status_code == 200
        expect(row_of(page, third).get_by_role("button", name=f"Status: {progress}")).to_be_visible(timeout=LIVE_MS)
    assert ben.get(f"/api/issues/{first['key']}").json()["status"] == "in_progress"
    assert ben.get(f"/api/issues/{second['key']}").json()["assignee_id"] == chiara.id


def test_wf_issue_triage_address_filters(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    kiln, atlas = ben.project("KIL"), ben.project("ATL")
    unplanned = {"key": "KIL-6", "title": "Kiln empty states"}
    atlas_row = {"key": "ATL-2", "title": "Atlas rate limits"}
    with signed_in(browser, app_url, BEN, "/issues") as page:
        select(role(page, "combobox", "Project filter"), "Kiln")
        expect(page).to_have_url(f"{app_url}/issues?project={kiln}")
        select(role(page, "combobox", "Cycle filter"), "No cycle")
        expect(page).to_have_url(f"{app_url}/issues?project={kiln}&cycle=none")
        expect(row_of(page, unplanned)).to_be_visible()
        page.go_back()
        expect(page).to_have_url(f"{app_url}/issues?project={kiln}")
        expect(row_of(page, unplanned)).to_have_count(0)
        page.go_forward()
        expect(row_of(page, unplanned)).to_be_visible()
        page.reload()
        expect(row_of(page, unplanned)).to_be_visible()
        with signed_in(browser, app_url, CHIARA, f"/issues?project={kiln}&cycle=none") as shared:
            expect(row_of(shared, unplanned)).to_be_visible()
        visit(page, f"{app_url}/issues?project={uuid.uuid4()}&cycle=none")
        expect(page).to_have_url(f"{app_url}/issues?cycle=none")
        visit(page, f"{app_url}/issues?cycle=none")
        late: list[Any] = []
        page.route(f"{ISSUE_ANY_GLOB}project={kiln}*", lambda route: late.append(route))
        with page.expect_request(lambda request: f"project={kiln}" in request.url):
            select(role(page, "combobox", "Project filter"), "Kiln")
        select(role(page, "combobox", "Project filter"), "Atlas")
        expect(page).to_have_url(f"{app_url}/issues?project={atlas}&cycle=none")
        expect(row_of(page, atlas_row)).to_be_visible()
        late[0].continue_()
        stays(lambda: row_of(page, atlas_row).count() == 1 and row_of(page, unplanned).count() == 0, LIVE_S, "the latest choice stays on screen")


def test_wf_issue_triage_live_rows(app_url: str, browser: Browser) -> None:
    ben, chiara, femi = Api(app_url, BEN), Api(app_url, CHIARA), Api(app_url, FEMI)
    kiln = ben.project("KIL")
    cycle = ben.current()
    other, leaving = (new_issue(ben, kiln, cycle_number=cycle["number"]) for _ in range(2))
    with streaming(femi) as stream, signed_in(browser, app_url, BEN, f"/issues?project={kiln}") as page:
        row = row_of(page, leaving)
        expect(row).to_be_visible()
        row.get_by_role("button", name=re.compile("^Status: ")).click()
        box = role(page, "listbox", "Status")
        expect(box).to_be_visible()
        renamed = stamp("Renamed")
        assert chiara.patch(f"/api/issues/{other['key']}", {"title": renamed}).status_code == 200
        stream.wait("issue", lambda data: data["key"] == other["key"] and data["title"] == renamed)
        expect(row_of(page, {"key": other["key"], "title": renamed})).to_be_visible(timeout=LIVE_MS)
        expect(box).to_be_visible()
        focus_settles(box)
        assert chiara.patch(f"/api/issues/{leaving['key']}", {"cycle_number": None}).status_code == 200
        expect(row).to_have_count(0, timeout=LIVE_MS)
        expect(box).to_have_count(0)
        focus_settles(listing(page))
        hidden = new_issue(ben, ben.project("ATL"))
        stays(lambda: True, LIVE_S, "delivery window")
        assert not stream.named("issue", lambda data: data["key"] == hidden["key"])
        page.goto(f"{app_url}/cycle")
        counted = [item["date"] for item in cycle["days"] if item["counted"]]
        with page.expect_response(is_stream):
            page.reload()
        expect(role(role(page, "group", "Unplaced"), "button", f"{other['key']}, no due date")).to_be_visible()
        assert chiara.patch(f"/api/issues/{other['key']}", {"due_date": counted[-1]}).status_code == 200
        expect(role(role(ribbon(page), "group", pretty(counted[-1])), "button", f"{other['key']} due {pretty(counted[-1])}")).to_be_visible(timeout=LIVE_MS)
        expect(role(page, "group", "Unplaced").get_by_role("button", name=re.compile(other["key"]))).to_have_count(0)


def test_wf_issue_triage_pending_chip(browser: Browser) -> None:
    ben, chiara = Api(clock_url(), BEN), Api(clock_url(), CHIARA)
    cycle = chiara.current()
    counted = [item["date"] for item in cycle["days"] if item["counted"]]
    start, target = counted[-3], counted[-2]
    issue = new_issue(chiara, chiara.project("KIL"), cycle_number=cycle["number"], due_date=start)
    gate: list[Any] = []
    with signed_in(browser, clock_url(), CHIARA, "/cycle") as page:
        expect(role(page, "status", "Cycle length")).to_have_text("10 working days")
        page.route(ISSUE_PATCH_GLOB, lambda route: gate.append(route) if route.request.method == "PATCH" else route.fallback())
        chip(page, issue["key"]).focus()
        with page.expect_request(lambda request: request.method == "PATCH"):
            page.keyboard.press("Shift+ArrowRight")
        placed = chip(role(ribbon(page), "group", pretty(target)), issue["key"])
        expect(placed).to_be_visible()
        assert ben.patch(f"/api/issues/{issue['key']}", {"title": stamp("Live")}).status_code == 200
        stays(lambda: placed.count() == 1, LIVE_S, "the pending chip stays at its target")
        gate[0].continue_()
        announced(page, f"Due date set to {pretty(target)}.")
        expect(placed).to_be_visible()
    assert chiara.get(f"/api/issues/{issue['key']}").json()["due_date"] == target


def test_picker_reachable(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    atlas = ben.project("ATL")
    for _ in range(BIG_LIST):
        new_issue(ben, atlas)
    last = new_issue(ben, atlas)
    walk(ben, last["key"], "cancelled")
    for viewport in (PHONE, TABLET, DESKTOP):
        ben.patch(f"/api/issues/{last['key']}", {"assignee_id": None})
        with signed_in(browser, app_url, BEN, f"/issues?project={atlas}&cycle=none", viewport=viewport) as page:
            row = row_of(page, last)
            row.scroll_into_view_if_needed()
            row.get_by_role("button", name=re.compile("^Assignee: ")).click()
            options = role(page, "listbox", "Assignee").get_by_role("option")
            expect(options.filter(has_text="Elin Park")).to_be_visible()
            for index in range(options.count()):
                box = options.nth(index).bounding_box()
                assert box["y"] >= 0 and box["y"] + box["height"] <= viewport["height"]
                assert box["x"] >= 0 and box["x"] + box["width"] <= viewport["width"]
                x, y = center(options.nth(index))
                assert options.nth(index).evaluate("(el, p) => el.contains(document.elementFromPoint(p[0], p[1]))", [x, y])
            options.last.click()
            announced(page, f"{last['key']} assigned to Elin Park.")
    assert ben.get(f"/api/issues/{last['key']}").json()["assignee_id"]


def test_hidden_pane(app_url: str, browser: Browser) -> None:
    title = "Kiln onboarding checklist"
    ben = Api(app_url, BEN)
    with signed_in(browser, app_url, BEN, "/issues", viewport=PHONE) as page:
        row = row_of(page, {"key": "KIL-1", "title": title})
        expect(row).to_be_visible()
        expect(detail(page)).to_have_count(0)
        listed = ben.get("/api/issues", params={"cycle": "current"}).json()["issues"]
        keys = [item["key"] for item in listed]
        shown = next(item for item in listed if item["key"] == "KIL-1")
        names = {item["id"]: item["name"] for item in ben.get("/api/members").json()["members"]}
        foreign = {f"{item['key']} {item['title']}" for item in listed if item["key"] != "KIL-1"}
        foreign |= {f"Status: {STATUS_LABEL[item['status']]}" for item in listed if item["status"] != shown["status"]}
        foreign |= {f"Assignee: {names[item['assignee_id']]}" for item in listed if item["assignee_id"] in names and item["assignee_id"] != shown["assignee_id"]}
        select_row(page, keys, "KIL-1")
        page.keyboard.press("Enter")
        expect(page).to_have_url(f"{app_url}/issues/KIL-1")
        back = role(page, "button", "Back")
        expect(back).to_be_visible()
        focus_settles(detail(page))
        expect(listing(page)).to_have_count(0)
        assert not foreign & set(tab_order(page, 15))
        page.keyboard.press("s")
        expect(role(page, "listbox", "Status")).to_have_count(0)
        role(page, "button", "Back").click()
        expect(row).to_be_visible()
        focus_settles(row)
        expect(detail(page)).to_have_count(0)


def test_channels_threads(app_url: str) -> None:
    ben, chiara, ana, femi = Api(app_url, BEN), Api(app_url, CHIARA), Api(app_url, ANA), Api(app_url, FEMI)
    channel = ben.channel("general")
    root = ben.post_message(channel, stamp("Root"))
    reply = chiara.post_message(channel, stamp("Reply"), root["id"])
    assert reply["thread_root_id"] == root["id"]
    thread = ben.get(f"/api/messages/{root['id']}/thread").json()
    assert thread["root"]["reply_count"] == 1 and [item["id"] for item in thread["replies"]] == [reply["id"]]
    listed = ben.get(f"/api/channels/{channel}/messages").json()["messages"]
    assert reply["id"] not in [item["id"] for item in listed] and root["id"] in [item["id"] for item in listed]
    path = f"/api/channels/{channel}/messages"
    failed(ben.post(path, {"body": "x", "thread_root_id": reply["id"]}), 422, "validation")
    assert "body" in failed(ben.post(path, {"body": "x" * (MAX_MESSAGE + 1)}), 422, "validation")["fields"]
    assert "body" in failed(ben.post(path, {"body": "   "}), 422, "validation")["fields"]
    assert "body" in failed(ben.post(path, {"body": "a\u0000b"}), 422, "validation")["fields"]
    assert ben.post(path, {"body": "😀" * MAX_MESSAGE}).status_code == 201
    failed(femi.post(path, {"body": "x"}), 404, "not_found")
    failed(chiara.delete(f"/api/messages/{root['id']}"), 403, "forbidden")
    assert chiara.delete(f"/api/messages/{reply['id']}").status_code == 204
    second = chiara.post_message(channel, stamp("Reply"), root["id"])
    assert ana.delete(f"/api/messages/{root['id']}").status_code == 204
    failed(ben.get(f"/api/messages/{root['id']}/thread"), 404, "not_found")
    failed(chiara.delete(f"/api/messages/{second['id']}"), 404, "not_found")


def test_unread_derivation(app_url: str, crew: Crew) -> None:
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    member = crew.join(ana)
    channel = ana.channel("general")

    def counts(expected_channel: int, expected_inbox: int) -> None:
        unread = member.unread()
        assert unread["channels"][channel] == expected_channel
        assert unread["inbox"] == expected_inbox
        assert len(member.get("/api/inbox").json()["items"]) == expected_inbox

    counts(0, 0)
    first = ben.post_message(channel, stamp("One"))
    second = ben.post_message(channel, stamp("Two"))
    counts(2, 0)
    ben.post_message(channel, stamp("Thread"), first["id"])
    counts(2, 0)
    own = member.post_message(channel, stamp("Mine"))
    counts(2, 0)
    answer = ben.post_message(channel, stamp("Answer"), own["id"])
    counts(2, 1)
    mention = ben.post_message(channel, f"@{member.person['handle']} look")
    counts(3, 2)
    assert ben.delete(f"/api/messages/{second['id']}").status_code == 204
    counts(2, 2)
    body = member.post(f"/api/channels/{channel}/read", {"up_to": mention["id"]})
    assert body.json()["channels"][channel] == 0
    counts(0, 1)
    assert member.post(f"/api/channels/{channel}/read", {"up_to": first["id"]}).status_code == 200
    counts(0, 1)
    other = ana.post_message(ana.channel("random"), stamp("Elsewhere"))
    failed(member.post(f"/api/channels/{channel}/read", {"up_to": other["id"]}), 422, "validation")
    assert member.post(f"/api/threads/{own['id']}/read", {"up_to": answer["id"]}).status_code == 200
    counts(0, 0)
    ben.post_message(channel, stamp("Again"))
    assert ana.delete(f"/api/channels/{channel}/members/{member.id}").status_code == 204
    assert channel not in member.unread()["channels"] and member.unread()["inbox"] == 0
    assert ana.post(f"/api/channels/{channel}/members", {"person_id": member.id}).status_code == 204
    counts(0, 0)


def test_mention_inbox_and_email(app_url: str, mail: Mailpit, crew: Crew) -> None:
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    member = crew.join(ana)
    outsider = crew.join(ana, "guest", projects=(ana.project("ATL"),))
    channel = ana.channel("general")
    with streaming(member) as stream:
        message = ben.post_message(channel, f"Hi @{member.person['handle'].upper()} and @{outsider.person['handle']}")
        stream.wait("unread", lambda data: data["inbox"] == 1)
    assert message["mentions"] == [member.id]
    assert [item["id"] for item in member.get("/api/inbox").json()["items"]] == [message["id"]]
    workspace = ana.workspace()["id"]
    subject = "Ben Ostrow mentioned you in #general"
    poll(lambda: mail_for(mail, workspace, subject, member.email), MAIL_RETRY_S, "mention email")
    assert len(mail_for(mail, workspace, subject, member.email)) == 1
    assert mail_for(mail, workspace, subject, outsider.email) == []


def test_typing_indicator(app_url: str, browser: Browser, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    channel = ana.channel("general")
    others = [Api(app_url, email) for email in (CHIARA, DEV, ELIN)]
    with signed_in(browser, app_url, BEN, f"/chat/{channel}") as page:
        line = role(page, "status", "Typing")
        for _ in range(2):
            assert others[0].post(f"/api/channels/{channel}/typing").status_code == 204
        expect(line).to_have_text(f"{CHIARA_NAME} is typing", timeout=LIVE_MS)
        assert others[1].post(f"/api/channels/{channel}/typing").status_code == 204
        expect(line).to_have_text(f"{CHIARA_NAME} and {DEV_NAME} are typing", timeout=LIVE_MS)
        assert others[2].post(f"/api/channels/{channel}/typing").status_code == 204
        expect(line).to_have_text("Several people are typing", timeout=LIVE_MS)
        listed = ana.get(f"/api/channels/{channel}/messages").json()["typing"]
        assert listed == [item.id for item in others]
        others[1].post_message(channel, stamp("Sent"))
        assert others[1].id not in ana.get(f"/api/channels/{channel}/messages").json()["typing"]
        expect(line).to_have_text("", timeout=TYPING_LAPSE_S * 1000)
        with signed_in(browser, app_url, CHIARA, f"/chat/{channel}") as typist:
            role(typist, "textbox", "Message #general").press_sequentially("hello")
            expect(line).to_have_text(f"{CHIARA_NAME} is typing", timeout=LIVE_MS)


def test_message_replay(app_url: str) -> None:
    ben = Api(app_url, BEN)
    channel = ben.channel("general")
    path = f"/api/channels/{channel}/messages"
    body = {"body": stamp("Replay")}
    key = idempotency_key()
    first = ben.post(path, body, key)
    assert first.status_code == 201
    again = ben.post(path, body, key)
    assert (again.status_code, again.json()) == (201, first.json())
    assert again.headers["Idempotent-Replay"] == "true"
    failed(ben.post(path, {"body": stamp("Other")}, key), 409, "idempotency_conflict")
    shared = {"body": stamp("Together")}
    together = idempotency_key()
    with futures.ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: ben.post(path, shared, together), range(6)))
    assert {item.status_code for item in answers} == {201}
    assert len({item.json()["id"] for item in answers}) == 1
    stored = [item for item in ben.get(path).json()["messages"] if item["body"] in (body["body"], shared["body"])]
    assert len(stored) == 2


def test_wf_team_chat_mention_badges(app_url: str, browser: Browser, mail: Mailpit) -> None:
    ana, elin = Api(app_url, ANA), Api(app_url, ELIN)
    channel = ana.channel("random")
    empty_channel(ana, channel)
    clear_inbox(elin)
    workspace = ana.workspace()["id"]
    subject = "Dev Ramaswamy mentioned you in #random"
    before = {item["ID"] for item in mail_for(mail, workspace, subject, ELIN)}
    with signed_in(browser, app_url, ELIN, "/chat/inbox") as first:
        second = first.context.new_page()
        visit(second, f"{app_url}/chat/inbox")
        with signed_in(browser, app_url, DEV, f"/chat/{channel}") as dev, signed_in(browser, app_url, BEN, f"/chat/{channel}") as ben:
            label = "random"
            expect(detail(dev).get_by_text(f"No messages in #{label} yet.")).to_be_visible()
            body = f"@elin {stamp('Please look')}"
            role(dev, "textbox", "Message #random").fill(body)
            role(dev, "button", "Send").click()
            expect(detail(dev).get_by_role("article").filter(has_text=body)).to_be_visible()
            for tab in (first, second):
                expect(role(tab, "link", "#random, 1 unread")).to_be_visible(timeout=LIVE_MS)
                expect(role(tab, "link", "Inbox, 1 unread")).to_be_visible(timeout=LIVE_MS)
            article = detail(ben).get_by_role("article").filter(has_text=body)
            role(article, "button", "Reply in thread").click()
            thread = role(ben, "complementary", "Thread")
            reply = stamp("Thread reply")
            role(thread, "textbox", "Reply").fill(reply)
            role(thread, "button", "Send reply").click()
            expect(thread.get_by_role("article").filter(has_text=reply)).to_be_visible()
            role(first, "link", "#random, 1 unread").click()
            for tab in (first, second):
                expect(role(tab, "link", "#random")).to_be_visible(timeout=LIVE_MS)
                expect(role(tab, "link", "Inbox")).to_be_visible(timeout=LIVE_MS)
    assert elin.unread()["channels"][channel] == 0 and elin.unread()["inbox"] == 0
    found = poll(lambda: [item for item in mail_for(mail, workspace, subject, ELIN) if item["ID"] not in before], MAIL_RETRY_S, "mention mail")
    assert len(found) == 1


def test_wf_team_chat_lost_response(app_url: str, browser: Browser) -> None:
    ana, dev = Api(app_url, ANA), Api(app_url, DEV)
    channel = ana.channel("random")
    body = stamp("Fragile")
    path = f"/api/channels/{channel}/messages"
    gate: list[Any] = []
    with signed_in(browser, app_url, DEV, f"/chat/{channel}") as page:
        page.route(f"**{path}", lambda route: gate.append(route) if route.request.method == "POST" and not gate else route.fallback())
        composer = role(page, "textbox", "Message #random")
        composer.fill(body)
        with page.expect_request(lambda request: request.method == "POST" and request.url.endswith(path)):
            page.keyboard.press("Enter")
        article = detail(page).get_by_role("article").filter(has_text=body)
        expect(article).to_contain_text("Sending")
        expect(composer).to_have_value("")
        first_key = gate[0].request.headers[IDEMPOTENCY_HEADER]
        gate[0].fetch()
        gate[0].abort()
        expect(article).to_contain_text("Not sent.")
        stays(lambda: article.count() == 1, LIVE_S, "one article while not sent")
        with page.expect_request(lambda request: request.method == "POST" and request.url.endswith(path)) as retry:
            role(article, "button", "Retry send").click()
        assert retry.value.headers[IDEMPOTENCY_HEADER] == first_key
        expect(article).not_to_contain_text("Not sent.")
        expect(article).to_have_count(1)
        composer.fill("x" * (MAX_MESSAGE + 1))
        role(page, "button", "Send").click()
        announced(page, "Messages can be up to 4000 characters.")
        expect(composer).to_have_value("x" * (MAX_MESSAGE + 1))
    stored = [item for item in dev.get(path).json()["messages"] if item["body"] == body]
    assert len(stored) == 1


def test_event_replay(crew: Crew) -> None:
    base = short_url()
    ana, ben, chiara = Api(base, ANA), Api(base, BEN), Api(base, CHIARA)
    channel = ana.channel("random")
    path = f"/api/channels/{channel}/messages"
    with streaming(chiara) as live, streaming(ben) as author:
        assert live.headers["content-type"].startswith("text/event-stream")
        assert live.headers["cache-control"] == "no-cache"
        key = idempotency_key()
        sent = ben.post(path, {"body": stamp("Live")}, key).json()
        seen = live.wait("message", lambda data: data["id"] == sent["id"])
        assert seen["data"]["client_key"] is None
        assert author.wait("message", lambda data: data["id"] == sent["id"])["data"]["client_key"] == key
        poll(lambda: ": keepalive" in live.comments, KEEPALIVE_S, "keepalive comment")
    marker = int(seen["id"])
    kept = ben.post_message(channel, stamp("Kept"))
    gone = ben.post_message(channel, stamp("Gone"))
    reply = ben.post_message(channel, stamp("Reply"), kept["id"])
    assert ben.delete(f"/api/messages/{gone['id']}").status_code == 204
    issue = new_issue(ben, ben.project("KIL"))
    with streaming(chiara, marker) as replay:
        replay.wait("issue", lambda data: data["key"] == issue["key"])
        assert ben.post_message(channel, stamp("After"))["id"]
        replay.wait("message")
        ids = [int(item["id"]) for item in replay.events if "id" in item]
        assert ids == sorted(set(ids)) and all(value > marker for value in ids)
        assert [item["data"]["id"] for item in replay.named("message") if item["data"]["id"] in (kept["id"], gone["id"])] == [kept["id"]]
        assert len(replay.named("thread_reply", lambda data: data["id"] == reply["id"])) == 1
        assert len(replay.named("message_deleted", lambda data: data["id"] == gone["id"])) == 1
    with futures.ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda index: ben.post_message(channel, f"Fill {index}"), range(MAX_EVENTS + 5)))
    with streaming(chiara, 0) as behind:
        reset = behind.wait("reset")
        assert "id" not in reset and reset["data"] == {}
        assert behind.events[0]["event"] == "reset" and not behind.named("message")
    empty_channel(ana, channel)


def test_stream_abort_release(app_url: str) -> None:
    ben = Api(app_url, BEN)
    observer = Postgres()
    count_sql = "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user"
    stuck_sql = "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND state = 'idle in transaction'"
    before = observer.rows(count_sql)[0]["n"]
    for _ in range(ABORTS):
        Stream(ben).close()
    poll(lambda: observer.rows(count_sql)[0]["n"] <= before + SESSION_DRIFT, RELEASE_S, "sessions return")
    poll(lambda: observer.rows(stuck_sql)[0]["n"] == 0, RELEASE_S, "no session left idle in transaction")
    assert ben.get("/api/me").status_code == 200


def test_doc_versions(app_url: str) -> None:
    ben, chiara = Api(app_url, BEN), Api(app_url, CHIARA)
    doc = new_doc(ben, ben.project("KIL"))
    path = f"/api/docs/{doc['id']}"
    second = stamp("Body")
    saved = chiara.put(path, {"title": doc["title"], "body": second, "base_version": 1}).json()
    assert saved["version"] == 2
    stale = ben.put(path, {"title": doc["title"], "body": "Older", "base_version": 1})
    failed(stale, 412, "version_conflict")
    assert stale.json()["current"]["body"] == second and stale.json()["current"]["version"] == 2
    assert ben.get(path).json()["body"] == second
    with futures.ThreadPoolExecutor(8) as pool:
        answers = list(pool.map(lambda index: ben.put(path, {"title": doc["title"], "body": f"Race {index}", "base_version": 2}), range(8)))
    assert sorted(item.status_code for item in answers) == [200] + [412] * 7
    winner = next(item.json() for item in answers if item.status_code == 200)
    assert ben.get(path).json()["body"] == winner["body"] and winner["version"] == 3
    assert [item["version"] for item in ben.get(f"{path}/versions").json()["versions"]] == [3, 2, 1]


def test_doc_text_exact(app_url: str) -> None:
    ben = Api(app_url, BEN)
    doc = new_doc(ben, ben.project("KIL"))
    path = f"/api/docs/{doc['id']}"
    body = "Añadir café 😀\r\n\r\n  spaced  \n\rlast\t\n"
    title = "  Tïtle 😀  "
    saved = ben.put(path, {"title": title, "body": body, "base_version": 1}).json()
    assert (saved["title"], saved["body"]) == (title, body)
    assert ben.get(path).json()["body"] == body
    assert ben.get(f"{path}/versions").json()["versions"][0]["body"] == body
    version = saved["version"]
    wide = ben.put(path, {"title": "😀" * MAX_DOC_TITLE, "body": "😀" * MAX_DOC_BODY, "base_version": version})
    assert wide.status_code == 200
    version = wide.json()["version"]
    assert "title" in failed(ben.put(path, {"title": "😀" * (MAX_DOC_TITLE + 1), "body": "", "base_version": version}), 422, "validation")["fields"]
    assert "body" in failed(ben.put(path, {"title": "T", "body": "x" * (MAX_DOC_BODY + 1), "base_version": version}), 422, "validation")["fields"]
    assert "title" in failed(ben.put(path, {"title": "   ", "body": "", "base_version": version}), 422, "validation")["fields"]
    assert "body" in failed(ben.put(path, {"title": "T", "body": "a\u0000b", "base_version": version}), 422, "validation")["fields"]
    raw = ben.http.put(path, content=b'{"title":"T","body":"a\\ud800b","base_version":%d}' % version, headers={"Content-Type": "application/json"})
    assert "body" in failed(raw, 422, "validation")["fields"]
    assert ben.get(path).json()["version"] == version


def test_doc_restore(app_url: str, browser: Browser) -> None:
    ben, femi = Api(app_url, BEN), Api(app_url, FEMI)
    doc = new_doc(ben, ben.project("KIL"), "One\r\n😀")
    path = f"/api/docs/{doc['id']}"
    ben.put(path, {"title": "Two", "body": "Two", "base_version": 1})
    third = stamp("Third")
    ben.put(path, {"title": third, "body": third, "base_version": 2})
    failed(ben.post(f"{path}/restore", {"version": 1, "base_version": 2}), 412, "version_conflict")
    assert "version" in failed(ben.post(f"{path}/restore", {"version": 3, "base_version": 3}), 422, "validation")["fields"]
    assert "version" in failed(ben.post(f"{path}/restore", {"version": 99, "base_version": 3}), 422, "validation")["fields"]
    failed(femi.post(f"{path}/restore", {"version": 1, "base_version": 3}), 403, "forbidden")
    restored = ben.post(f"{path}/restore", {"version": 1, "base_version": 3}).json()
    assert (restored["version"], restored["title"], restored["body"]) == (4, doc["title"], doc["body"])
    assert [item["version"] for item in ben.get(f"{path}/versions").json()["versions"]] == [4, 3, 2, 1]
    with futures.ThreadPoolExecutor(4) as pool:
        racing = list(pool.map(lambda _: ben.post(f"{path}/restore", {"version": 2, "base_version": 4}), range(4)))
    assert sorted(item.status_code for item in racing) == [200, 412, 412, 412]
    with signed_in(browser, app_url, BEN, f"/docs/{doc['id']}") as page:
        role(page, "button", "Version history").click()
        dialog = role(page, "dialog", "Version history")
        expect(dialog.get_by_role("button")).to_contain_text([f"Restore version {number}" for number in (4, 3, 2, 1)])
        source, result = 3, 6
        role(dialog, "button", f"Restore version {source}").click()
        expect(role(page, "status", "Doc status")).to_contain_text(f"Restored version {source} as version {result}.")
        expect(role(page, "textbox", "Doc body")).to_have_value(third)
    assert ben.get(path).json()["version"] == 6


def test_wf_shared_docs_keep_mine(app_url: str, browser: Browser) -> None:
    ben, chiara = Api(app_url, BEN), Api(app_url, CHIARA)
    original = "Añadir café 😀\r\n\r\nSecond line\nThird line\r\n"
    doc = new_doc(ben, ben.project("KIL"), original)
    path = f"/api/docs/{doc['id']}"
    with signed_in(browser, app_url, BEN, f"/docs/{doc['id']}") as page, signed_in(browser, app_url, CHIARA, f"/docs/{doc['id']}") as other:
        body = role(page, "textbox", "Doc body")
        expect(body).not_to_have_value("")
        addition = stamp("Ben")
        body.press("Control+End")
        body.press_sequentially(addition)
        theirs = role(other, "textbox", "Doc body")
        theirs.fill("Chiara text")
        role(other, "button", "Save doc").click()
        expect(role(other, "status", "Doc status")).to_contain_text(saved_copy(2))
        role(page, "button", "Save doc").click()
        status = role(page, "status", "Doc status")
        expect(status).to_contain_text(conflict_copy(CHIARA_NAME, 2))
        dialog = role(page, "dialog", "Newer version saved")
        role(dialog, "button", "Keep mine").click()
        expect(status).to_contain_text(saved_copy(3))
        expect(theirs).to_have_value(re.compile(re.escape(addition)), timeout=LIVE_MS)
    stored = chiara.get(path).json()
    assert stored["version"] == 3
    assert stored["body"].rstrip("\n") == original + addition


def test_wf_shared_docs_load_theirs(app_url: str, browser: Browser) -> None:
    ben, chiara = Api(app_url, BEN), Api(app_url, CHIARA)
    doc = new_doc(ben, ben.project("KIL"))
    with signed_in(browser, app_url, BEN, f"/docs/{doc['id']}") as page:
        body = role(page, "textbox", "Doc body")
        mine, newer = stamp("Mine"), stamp("Newer")
        body.fill(mine)
        assert chiara.put(f"/api/docs/{doc['id']}", {"title": doc["title"], "body": newer, "base_version": 1}).status_code == 200
        stays(lambda: body.input_value() == mine, LIVE_S, "unsaved text is left alone")
        role(page, "button", "Save doc").click()
        status = role(page, "status", "Doc status")
        loaded = 2
        expect(status).to_contain_text(conflict_copy(CHIARA_NAME, loaded))
        role(role(page, "dialog", "Newer version saved"), "button", "Load theirs").click()
        expect(status).to_contain_text(f"Loaded version {loaded} from {CHIARA_NAME}.")
        expect(body).to_have_value(newer)
    assert ben.get(f"/api/docs/{doc['id']}").json()["version"] == 2


def test_wf_shared_docs_lost_session(app_url: str, browser: Browser) -> None:
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    stored_text, first_draft, second_draft = stamp("Stored"), stamp("Draft"), stamp("Draft")
    doc = new_doc(ben, ben.project("KIL"), stored_text)
    path = f"/api/docs/{doc['id']}"

    def end_session(page: Page) -> None:
        cookie = next(item for item in page.context.cookies() if item["name"] == "tr_session")
        with httpx.Client(base_url=app_url, cookies={"tr_session": cookie["value"]}, timeout=HTTP_TIMEOUT) as client:
            assert client.delete("/api/session").status_code == 204

    with signed_in(browser, app_url, BEN, f"/docs/{doc['id']}") as page:
        body = role(page, "textbox", "Doc body")
        expect(body).to_have_value(stored_text)
        body.fill(first_draft)
        end_session(page)
        role(page, "button", "Save doc").click()
        page.wait_for_url(lambda url: urlsplit(url).path == "/sign-in")
        assert unquote(urlsplit(page.url).query) == f"next=/docs/{doc['id']}"
        sign_in_form(page, CHIARA)
        expect(page).to_have_url(f"{app_url}/docs/{doc['id']}")
        expect(role(page, "textbox", "Doc body")).to_have_value(stored_text)
        expect(role(page, "status", "Doc status")).not_to_contain_text("Your unsaved changes were restored.")
        role(page, "button", "Sign out").click()
        expect(page).to_have_url(f"{app_url}/sign-in")
        sign_in_form(page, BEN, PASSWORD)
        expect(page).to_have_url(f"{app_url}/issues")
        page.goto(f"{app_url}/docs/{doc['id']}")
        expect(role(page, "textbox", "Doc body")).to_have_value(stored_text)
        role(page, "textbox", "Doc body").fill(second_draft)
        end_session(page)
        role(page, "button", "Save doc").click()
        page.wait_for_url(lambda url: urlsplit(url).path == "/sign-in")
        sign_in_form(page, BEN)
        expect(page).to_have_url(f"{app_url}/docs/{doc['id']}")
        expect(role(page, "textbox", "Doc body")).to_have_value(second_draft)
        expect(role(page, "status", "Doc status")).to_contain_text("Your unsaved changes were restored.")
        assert ana.get(path).json()["version"] == 1
        role(page, "button", "Save doc").click()
        expect(role(page, "status", "Doc status")).to_contain_text(saved_copy(2))
    assert ana.get(path).json()["body"] == second_draft


def test_attachment_stored_first(app_url: str) -> None:
    ben = Api(app_url, BEN)
    bucket = S3()
    issue = new_issue(ben, ben.project("KIL"))
    path = f"/api/issues/{issue['key']}/attachments"
    name = "plan v1 é.txt"
    data = b"stored bytes"
    stored = upload(ben, path, name, data)
    assert stored.status_code == 201
    item = stored.json()
    assert item["parent"] == {"type": "issue", "id": issue["key"]} or item["parent"]["type"] == "issue"
    assert stored_object(bucket, item) == data
    assert [entry["id"] for entry in ben.get(f"/api/issues/{issue['key']}").json()["attachments"]] == [item["id"]]
    before = set(bucket.keys("kereru/"))
    failed(upload(ben, path, "big.bin", b"x" * (MAX_FILE + 1)), 413, "too_large")
    assert "file" in failed(upload(ben, path, "empty.bin", b""), 422, "validation")["fields"]
    assert "file" in failed(upload(ben, path, "n" * (MAX_FILENAME + 1), b"x"), 422, "validation")["fields"]
    down = Api(copy_url("APP_MINIO_DOWN_URL"), BEN)
    failed(upload(down, path, "down.txt", b"x"), 503, "storage_unavailable")
    assert set(bucket.keys("kereru/")) == before
    assert len(ben.get(f"/api/issues/{issue['key']}").json()["attachments"]) == 1
    boundary = upload(ben, path, "n" * MAX_FILENAME, b"x" * MAX_FILE)
    assert boundary.status_code == 201 and boundary.json()["size"] == MAX_FILE
    channel = ben.channel("general")
    message = ben.post_message(channel, stamp("Attach"))
    failed(upload(Api(app_url, CHIARA), f"/api/messages/{message['id']}/attachments", "x.txt"), 403, "not_author")
    assert upload(ben, f"/api/messages/{message['id']}/attachments", "x.txt").status_code == 201
    doc = new_doc(ben, ben.project("KIL"))
    assert upload(ben, f"/api/docs/{doc['id']}/attachments", "x.txt").status_code == 201


def test_attachment_access(app_url: str, crew: Crew) -> None:
    ana, ben, femi, hal = Api(app_url, ANA), Api(app_url, BEN), Api(app_url, FEMI), Api(app_url, HAL)
    atlas = new_issue(ben, ben.project("ATL"))
    kiln = new_issue(ben, ben.project("KIL"))
    hidden = upload(ben, f"/api/issues/{atlas['key']}/attachments", "a.txt", b"atlas").json()
    shared = upload(ben, f"/api/issues/{kiln['key']}/attachments", "k.txt", b"kiln").json()
    assert ben.get(f"/api/attachments/{hidden['id']}").content == b"atlas"
    assert femi.get(f"/api/attachments/{shared['id']}").content == b"kiln"
    failed(femi.get(f"/api/attachments/{hidden['id']}"), 404, "not_found")
    failed(hal.get(f"/api/attachments/{shared['id']}"), 404, "not_found")
    failed(Api(app_url).get(f"/api/attachments/{shared['id']}"), 401, "unauthenticated")
    guest = crew.join(ana, "guest", projects=(ana.project("KIL"),))
    assert guest.get(f"/api/attachments/{shared['id']}").status_code == 200
    ana.delete(f"/api/projects/{ana.project('KIL')}/members/{guest.id}")
    failed(guest.get(f"/api/attachments/{shared['id']}"), 404, "not_found")


def test_upload_announcements(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    issue = new_issue(ben, ben.project("KIL"))
    with signed_in(browser, app_url, BEN, f"/issues/{issue['key']}") as page:
        status = role(page, "status", "Upload status")
        name, big, empty = "notes.txt", "big.bin", "empty.bin"
        with held(page, UPLOAD_GLOB) as release:
            attach(page, name, b"hello")
            expect(status).to_contain_text(f"Uploading {name}")
            expect(role(page, "progressbar", "Upload progress")).to_be_visible()
            release()
        expect(status).to_contain_text(f"Attached {name}.")
        expect(role(detail(page), "link", name)).to_be_visible()
        attach(page, big, b"x" * (MAX_FILE + 1))
        expect(status).to_contain_text(f"{big} is too large and was not attached.")
        attach(page, empty, b"")
        expect(status).to_contain_text(f"{empty} is empty and was not attached.")
        attach(page, "n" * (MAX_FILENAME + 1), b"x")
        expect(status).to_contain_text("That file name is too long. Use 255 characters or fewer.")
        page.route(UPLOAD_GLOB, lambda route: route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {"code": "storage_unavailable", "message": "Down"}})))
        attach(page, "late.txt", b"x")
        expect(status).to_contain_text("Upload failed: storage is unavailable. Nothing was attached.")
    assert [item["filename"] for item in ben.get(f"/api/issues/{issue['key']}").json()["attachments"]] == [name]


def test_download_headers(app_url: str) -> None:
    ben = Api(app_url, BEN)
    issue = new_issue(ben, ben.project("KIL"))
    path = f"/api/issues/{issue['key']}/attachments"
    name = 'Résumé "final" v2\\.html'
    data = b"<html><script>1</script></html>"
    for mime in (*ACTIVE_TYPES, "Text/HTML; charset=utf-8"):
        item = browser_upload(ben, path, name, data, mime).json()
        assert item["filename"] == name and essence(item["content_type"]) == essence(mime)
        answer = ben.get(f"/api/attachments/{item['id']}")
        assert answer.content == data
        assert answer.headers["Content-Type"] == "application/octet-stream"
        assert answer.headers["X-Content-Type-Options"] == "nosniff"
        assert answer.headers["Content-Length"] == str(len(data))
        fallback = re.sub(r'[^\x20-\x7e]|["\\]', "_", name)
        encoded = quote(name, safe="!#$&+-.^_`|~")
        assert answer.headers["Content-Disposition"] == f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
    plain = upload(ben, path, "picture.png", b"\x89PNG", "image/png").json()
    assert ben.get(f"/api/attachments/{plain['id']}").headers["Content-Type"].startswith("image/png")


def test_deletion_reaches_storage(app_url: str) -> None:
    ben = Api(app_url, BEN)
    bucket = S3()
    channel = ben.channel("general")
    root = ben.post_message(channel, stamp("Filed"))
    reply = ben.post_message(channel, stamp("Filed reply"), root["id"])
    items = [
        upload(ben, f"/api/messages/{root['id']}/attachments", "root.txt").json(),
        upload(ben, f"/api/messages/{reply['id']}/attachments", "reply.txt").json(),
    ]
    down = Api(copy_url("APP_MINIO_DOWN_URL"), BEN)
    assert down.delete(f"/api/messages/{root['id']}").status_code == 204
    for item in items:
        failed(ben.get(f"/api/attachments/{item['id']}"), 404, "not_found")
    poll(lambda: not any(key.split("/")[1] in {item["id"] for item in items} for key in bucket.keys("kereru/")), QUEUE_S, "objects removed")


def test_wf_attachments_guest_file(app_url: str, browser: Browser) -> None:
    femi, ben = Api(app_url, FEMI), Api(app_url, BEN)
    bucket = S3()
    issue = new_issue(femi, femi.project("KIL"))
    name = 'Résumé "final" v2.html'
    data = b"<p>review</p>"
    with signed_in(browser, app_url, FEMI, f"/issues/{issue['key']}") as page:
        attach(page, name, data, "text/html")
        expect(role(page, "status", "Upload status")).to_contain_text(f"Attached {name}.")
    item = ben.get(f"/api/issues/{issue['key']}").json()["attachments"][0]
    assert (item["filename"], item["content_type"]) == (name, "text/html")
    assert stored_object(bucket, item) == data
    with signed_in(browser, app_url, BEN, f"/issues/{issue['key']}") as page:
        with page.expect_download() as download:
            role(detail(page), "link", name).click()
        url = download.value.url
    answer = ben.get(urlsplit(url).path)
    assert answer.content == data
    assert unquote(answer.headers["Content-Disposition"].split("filename*=UTF-8''")[1]) == name


def test_wf_attachments_storage_outage(browser: Browser) -> None:
    base = copy_url("APP_MINIO_DOWN_URL")
    ben = Api(base, BEN)
    issue = new_issue(ben, ben.project("KIL"))
    choosers: list[Any] = []
    copy = "Attachments are unavailable right now. Nothing new can be attached."
    with signed_in(browser, base, BEN, f"/issues/{issue['key']}") as page:
        button = role(detail(page), "button", "Attach file")
        expect(button).to_have_attribute("aria-disabled", "true", timeout=NOTICE_MS)
        page.on("filechooser", lambda chooser: choosers.append(chooser))
        button.click(force=True)
        expect(role(page, "status", "Upload status")).to_contain_text(copy)
        assert choosers == []


def test_floor_presence(browser: Browser) -> None:
    base = short_url()
    ben, chiara = Api(base, BEN), Api(base, CHIARA)
    room = ben.room("Studio")
    try:
        with streaming(chiara) as stream, signed_in(browser, base, CHIARA, "/office") as page:
            enter_room(ben, room["id"])
            expect(role(role(page, "region", "Office floor"), "button", "Studio, 1 inside")).to_be_visible(timeout=LIVE_MS)
            stream.wait("room", lambda data: data["id"] == room["id"] and data["occupants"][0]["person_id"] == ben.id)
            occupant = ben.room("Studio")["occupants"][0]
            assert (occupant["name"], occupant["status"]) == ("Ben Ostrow", "active")
            stream.wait("presence", lambda data: data == {"person_id": ben.id, "status": "away"}, seconds=9)
            assert chiara.room("Studio")["occupants"][0]["status"] == "away"
            assert ben.post("/api/presence/heartbeat").status_code == 204
            poll(lambda: chiara.room("Studio")["occupants"][0]["status"] == "active", LIVE_S, "active again")
    finally:
        leave_all(ben)


def test_knock_lifecycle() -> None:
    base = short_url()
    ben, chiara, dev, elin = Api(base, BEN), Api(base, CHIARA), Api(base, DEV), Api(base, ELIN)
    room = ben.room("Focus Booth")
    path = f"/api/rooms/{room['id']}"
    try:
        failed(chiara.post(f"{path}/knocks"), 409, "room_empty")
        failed(chiara.post(f"/api/rooms/{ben.room('Lobby')['id']}/knocks"), 409, "room_open")
        enter_room(ben, room["id"])
        failed(ben.post(f"{path}/knocks"), 409, "already_inside")
        failed(chiara.post(f"{path}/join"), 403, "knock_required")
        knock = chiara.post(f"{path}/knocks")
        assert knock.status_code == 201 and knock.json()["status"] == "waiting"
        again = chiara.post(f"{path}/knocks")
        assert again.status_code == 200 and again.json()["id"] == knock.json()["id"]
        failed(dev.post(f"/api/knocks/{knock.json()['id']}/answer", {"answer": "let_in"}), 403, "not_in_room")
        failed(ben.post(f"/api/knocks/{knock.json()['id']}/answer", {"answer": "maybe"}), 422, "validation")
        assert ben.get(f"{path}/knocks").json()["knocks"][0]["id"] == knock.json()["id"]
        answered = ben.post(f"/api/knocks/{knock.json()['id']}/answer", {"answer": "not_now"})
        assert answered.json()["status"] == "not_now"
        failed(ben.post(f"/api/knocks/{knock.json()['id']}/answer", {"answer": "let_in"}), 409, "knock_answered")
        assert chiara.id not in ben.inside("Focus Booth")
        with streaming(dev) as stream:
            expiring = dev.post(f"{path}/knocks").json()
            created = datetime.fromisoformat(expiring["created_at"])
            ends = datetime.fromisoformat(expiring["expires_at"])
            assert (ends - created).total_seconds() == 4
            stream.wait("knock", lambda data: data["id"] == expiring["id"] and data["status"] == "expired", seconds=8)
        assert dev.get(f"/api/knocks/{expiring['id']}").json()["status"] == "expired"
        failed(ben.post(f"/api/knocks/{expiring['id']}/answer", {"answer": "let_in"}), 409, "knock_expired")
        race = elin.post(f"{path}/knocks").json()
        chiara_knock = chiara.post(f"{path}/knocks").json()
        assert ben.post(f"/api/knocks/{chiara_knock['id']}/answer", {"answer": "let_in"}).json()["status"] == "let_in"
        assert chiara.id in ben.inside("Focus Booth")
        with futures.ThreadPoolExecutor(2) as pool:
            answers = list(pool.map(lambda api: api.post(f"/api/knocks/{race['id']}/answer", {"answer": "not_now"}), (ben, chiara)))
        assert sorted(item.status_code for item in answers) == [200, 409]
        waiting = dev.post(f"{path}/knocks").json()
        leave_all(ben, chiara)
        assert dev.get(f"/api/knocks/{waiting['id']}").json()["status"] == "expired"
    finally:
        leave_all(ben, chiara, dev, elin)


def test_knock_status_server(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    room = ben.room("Focus Booth")
    try:
        enter_room(ben, room["id"])
        with signed_in(browser, app_url, CHIARA, "/office", device_time="2031-06-15T12:00:00Z") as page:
            role(page, "button", "Knock on Focus Booth").click()
            status = role(page, "status", "Knock status")
            expect(status).to_have_text("Waiting")
            with page.expect_response(is_stream):
                page.reload()
            expect(status).to_have_text("Waiting", timeout=LIVE_MS)
            knock = ben.get(f"/api/rooms/{room['id']}/knocks").json()["knocks"][0]
            ben.post(f"/api/knocks/{knock['id']}/answer", {"answer": "not_now"})
            expect(status).to_have_text("Not now", timeout=LIVE_MS)
    finally:
        leave_all(ben)
    base = short_url()
    ben = Api(base, BEN)
    room = ben.room("Focus Booth")
    try:
        enter_room(ben, room["id"])
        with signed_in(browser, base, CHIARA, "/office", device_time="2020-01-01T00:00:00Z") as page:
            role(page, "button", "Knock on Focus Booth").click()
            expect(role(page, "status", "Knock status")).to_have_text("Knock expired", timeout=UI_MS)
    finally:
        leave_all(ben)


def test_wf_office_floor_answer_keyboard(app_url: str, browser: Browser) -> None:
    ben, chiara, dev = Api(app_url, BEN), Api(app_url, CHIARA), Api(app_url, DEV)
    room = ben.room("Focus Booth")
    channel = ben.channel("general")
    draft = stamp("Draft")
    try:
        enter_room(ben, room["id"])
        with signed_in(browser, app_url, BEN, f"/chat/{channel}") as page:
            composer = role(page, "textbox", "Message #general")
            composer.fill(draft)
            composer.focus()
            first = chiara.post(f"/api/rooms/{room['id']}/knocks").json()
            second = dev.post(f"/api/rooms/{room['id']}/knocks").json()
            dialog = role(page, "dialog", "Knock at Focus Booth")
            expect(dialog).to_contain_text(f"{CHIARA_NAME} is at the door.", timeout=LIVE_MS)
            expect(role(page, "dialog", "Knock at Focus Booth")).to_have_count(1)
            expect(role(dialog, "button", "Let in")).to_be_focused()
            page.keyboard.press("Enter")
            expect(role(page, "status", "Announcements", include_hidden=True)).to_contain_text(f"Let {CHIARA_NAME} in.")
            expect(dialog).to_contain_text(f"{DEV_NAME} is at the door.", timeout=LIVE_MS)
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            expect(composer).to_be_focused()
            expect(composer).to_have_value(draft)
        assert ben.get(f"/api/knocks/{first['id']}").json()["status"] == "let_in"
        assert ben.get(f"/api/knocks/{second['id']}").json()["status"] == "waiting"
    finally:
        leave_all(ben, chiara, dev)


def test_wf_office_floor_knock(app_url: str, browser: Browser) -> None:
    ben, femi = Api(app_url, BEN), Api(app_url, FEMI)
    try:
        with signed_in(browser, app_url, BEN, "/office") as member, signed_in(browser, app_url, FEMI, "/office") as guest:
            role(member, "button", "Review Room, 0 inside").click()
            expect(role(guest, "button", "Review Room, 1 inside")).to_be_visible(timeout=LIVE_MS)
            role(guest, "button", "Review Room, 1 inside").click()
            knock_button = role(guest, "button", "Knock on Review Room")
            expect(knock_button).to_be_focused()
            guest.keyboard.press("Enter")
            expect(role(guest, "status", "Knock status")).to_have_text("Waiting")
            dialog = role(member, "dialog", "Knock at Review Room")
            expect(dialog).to_contain_text(f"{FEMI_NAME} is at the door.", timeout=LIVE_MS)
            role(dialog, "button", "Let in").click()
            announced(member, f"Let {FEMI_NAME} in.")
            expect(role(guest, "status", "Knock status")).to_have_text("Let in", timeout=LIVE_MS)
            for page in (member, guest):
                expect(role(page, "button", "Review Room, 2 inside")).to_be_visible(timeout=LIVE_MS)
            assert set(ben.inside("Review Room")) == {ben.id, femi.id}
    finally:
        leave_all(ben, femi)


def test_knock_dialog_updates(app_url: str, browser: Browser) -> None:
    ben, chiara, dev = Api(app_url, BEN), Api(app_url, CHIARA), Api(app_url, DEV)
    room = ben.room("Focus Booth")
    try:
        enter_room(ben, room["id"])
        chiara.post(f"/api/rooms/{room['id']}/knocks")
        answerer = chiara.get(f"/api/rooms/{room['id']}/knocks/mine").json()
        ben.post(f"/api/knocks/{answerer['id']}/answer", {"answer": "let_in"})
        with signed_in(browser, app_url, BEN, "/office") as page:
            knock = dev.post(f"/api/rooms/{room['id']}/knocks").json()
            dialog = role(page, "dialog", "Knock at Focus Booth")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            button = role(dialog, "button", "Not now")
            button.focus()
            elin = Api(app_url, ELIN)
            enter_room(elin, ben.room("Lobby")["id"])
            expect(role(page, "button", "Lobby, 1 inside", include_hidden=True)).to_be_visible(timeout=LIVE_MS)
            leave_all(elin)
            expect(role(page, "dialog", "Knock at Focus Booth")).to_have_count(1)
            expect(button).to_be_focused()
            chiara.post(f"/api/knocks/{knock['id']}/answer", {"answer": "not_now"})
            expect(dialog).to_have_count(0, timeout=LIVE_MS)
            announced(page, "That knock was already answered.")
    finally:
        leave_all(ben, chiara, dev)
    base = short_url()
    ben, dev = Api(base, BEN), Api(base, DEV)
    room = ben.room("Focus Booth")
    try:
        enter_room(ben, room["id"])
        with signed_in(browser, base, BEN, "/office") as page:
            role(page, "link", "Issues").focus()
            dev.post(f"/api/rooms/{room['id']}/knocks")
            dialog = role(page, "dialog", "Knock at Focus Booth")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            expect(dialog).to_have_count(0, timeout=UI_MS)
            announced(page, "That knock has expired.")
            expect(role(page, "link", "Issues")).to_be_focused()
    finally:
        leave_all(ben, dev)


def test_presence_person() -> None:
    base = short_url()
    ben = Api(base, BEN)
    room = ben.room("Studio")
    grace = 4
    try:
        with streaming(ben) as first:
            second = Stream(ben)
            ben.post(f"/api/rooms/{room['id']}/join")
            second.close()
            stays(lambda: ben.id in ben.inside("Studio"), grace + LIVE_S, "one tab closed: still inside")
            assert first.status == 200
        stays(lambda: ben.id in ben.inside("Studio"), grace - 1, "inside during grace")
        with streaming(ben):
            stays(lambda: ben.id in ben.inside("Studio"), LIVE_S + 1, "a new stream cancels the leave")
        poll(lambda: ben.id not in ben.inside("Studio"), grace + LIVE_S + 1, "leaves after grace")
    finally:
        leave_all(ben)


def test_office_viewports(app_url: str, browser: Browser, crew: Crew) -> None:
    ana, ben, chiara = Api(app_url, ANA), Api(app_url, BEN), Api(app_url, CHIARA)
    room = ben.room("Focus Booth")
    for viewport in (PHONE, TABLET, DESKTOP):
        try:
            enter_room(ben, room["id"])
            with signed_in(browser, app_url, BEN, "/office", viewport=viewport) as page:
                floor = role(page, "region", "Office floor")
                expect(floor).to_be_visible()
                box = floor.bounding_box()
                assert box["x"] >= 0 and box["x"] + box["width"] <= viewport["width"]
                for name in ("Lobby, 0 inside", "Studio, 0 inside", "Review Room, 0 inside", "Focus Booth, 1 inside"):
                    target = role(floor, "button", name).bounding_box()
                    assert target["width"] >= TARGET_PX and target["height"] >= TARGET_PX
                    assert target["x"] + target["width"] <= viewport["width"]
                visit(page, f"{app_url}/issues")
                knock = chiara.post(f"/api/rooms/{room['id']}/knocks").json()
                dialog = role(page, "dialog", "Knock at Focus Booth")
                expect(dialog).to_be_visible(timeout=LIVE_MS)
                shape = dialog.bounding_box()
                assert shape["x"] >= 0 and shape["y"] >= 0
                assert shape["x"] + shape["width"] <= viewport["width"] and shape["y"] + shape["height"] <= viewport["height"]
            leave_all(ben)
            assert chiara.get(f"/api/knocks/{knock['id']}").json()["status"] == "expired"
        finally:
            leave_all(ben)
    knocker = crew.join(ana)
    try:
        enter_room(ben, room["id"])
        knock = knocker.post(f"/api/rooms/{room['id']}/knocks").json()
        ana.delete(f"/api/members/{knocker.id}")
        assert ben.get(f"/api/knocks/{knock['id']}").json()["status"] == "expired"
    finally:
        leave_all(ben)


def test_invite_rules(app_url: str, crew: Crew, mail: Mailpit) -> None:
    ana = Api(app_url, ANA)
    kiln = ana.project("KIL")
    ensure_seats(ana, 2)
    failed(Api(app_url, BEN).post("/api/invites", {"email": "x@kereru.test", "role": "member", "project_ids": [], "channel_ids": []}), 403, "forbidden")
    _, email = fresh("rule")
    failed(ana.post("/api/invites", {"email": email, "role": "guest", "project_ids": [], "channel_ids": []}), 422, "validation")
    failed(ana.post("/api/invites", {"email": email, "role": "member", "project_ids": [kiln], "channel_ids": []}), 422, "validation")
    failed(ana.post("/api/invites", {"email": BEN.upper(), "role": "member", "project_ids": [], "channel_ids": []}), 409, "already_member")
    assert mail_for(mail, ana.workspace()["id"], to=email) == []
    invite, invited = crew.invite(ana)
    failed(ana.post("/api/invites", {"email": invited.upper(), "role": "member", "project_ids": [], "channel_ids": []}), 409, "invite_pending")
    key = idempotency_key()
    _, keyed = fresh("keyed")
    body = {"email": keyed, "role": "member", "project_ids": [], "channel_ids": []}
    ensure_seats(ana)
    first = ana.post("/api/invites", body, key)
    crew.pending.append((ana, first.json()["id"]))
    replay = ana.post("/api/invites", body, key)
    assert replay.json()["id"] == first.json()["id"] and replay.headers["Idempotent-Replay"] == "true"
    failed(ana.post("/api/invites", {**body, "role": "guest", "project_ids": [kiln]}, key), 409, "idempotency_conflict")
    state = billing(ana)
    for _ in range(state["limit"] - state["active"] - state["pending"]):
        _, extra = fresh("fill")
        crew.pending.append((ana, ana.post("/api/invites", {"email": extra, "role": "member", "project_ids": [], "channel_ids": []}).json()["id"]))
    _, overflow = fresh("over")
    failed(ana.post("/api/invites", {"email": overflow, "role": "member", "project_ids": [], "channel_ids": []}), 409, "workspace_full")
    assert ana.delete(f"/api/invites/{invite['id']}").json()["status"] == "revoked"
    failed(ana.delete(f"/api/invites/{invite['id']}"), 409, "invite_not_pending")
    down = Api(copy_url("APP_KILLBILL_DOWN_URL"), ANA)
    failed(down.post("/api/invites", {"email": overflow, "role": "member", "project_ids": [], "channel_ids": []}), 503, "billing_unavailable")
    again = ana.post("/api/invites", {"email": overflow, "role": "member", "project_ids": [], "channel_ids": []})
    assert again.status_code == 201
    crew.pending.append((ana, again.json()["id"]))


def test_invite_email(app_url: str, mail: Mailpit, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    invite, email = crew.invite(ana)
    workspace = ana.workspace()["id"]
    subject = "You're invited to Kereru Labs on Tallyroom"
    found = poll(lambda: mail_for(mail, workspace, subject, email), MAIL_RETRY_S, "invite email")
    assert len(found) == 1
    message = found[0]
    assert mail_from_address() in addresses(message.get("From"))
    body = text(message)
    assert "Ana Whitlow" in body and "Kereru Labs" in body and email in body
    public = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    assert public in body and invite["id"] not in body
    for link in re.findall(r"https?://[^\s<>\"]+", body):
        target = urlsplit(link.rstrip("/.,"))
        assert link.startswith(public), link
        assert not target.query and not target.fragment, link
        assert target.path in ("", "/sign-in", "/create-account", "/invitations"), link


def test_invite_expiry(browser: Browser, crew: Crew) -> None:
    base = short_url()
    ana = Api(base, ANA)
    invite, email = crew.invite(ana)
    created = datetime.fromisoformat(invite["created_at"])
    assert (datetime.fromisoformat(invite["expires_at"]) - created).total_seconds() == 5
    person = crew.account(base, email)
    with blank(browser, device_time="2020-01-01T00:00:00Z") as page:
        page.context.request.post(f"{base}/api/session", data={"email": email, "password": PASSWORD})
        page.goto(f"{base}/invitations")
        button = role(page, "button", "Join Kereru Labs")
        expect(button).to_be_visible()
        poll(lambda: person.get("/api/invites/mine").json()["invites"][0]["status"] == "expired", 8, "invite expires")
        button.click()
        expect(role(page, "heading", "This invite has expired")).to_be_visible()
        expect(page.get_by_text(f"Ask {ANA_NAME} to send a new one.")).to_be_visible()
        expect(page).to_have_url(f"{base}/invitations")
    failed(person.post(f"/api/invites/{invite['id']}/accept"), 409, "invite_expired")
    assert person.get("/api/me").json()["workspace"] is None
    failed(ana.delete(f"/api/invites/{invite['id']}"), 409, "invite_not_pending")


def race_last_seat(first_base: str, second_base: str, crew: Crew, killbill: KillBill) -> tuple[Api, dict[str, Any]]:
    owner = Api(first_base, ANA)
    ensure_seats(owner, 2)
    state = billing(owner)
    invites = [crew.invite(owner) for _ in range(2)]
    invited = [crew.account(base, email) for base, (_, email) in zip((first_base, second_base), invites)]
    sub = subscription(killbill, owner.workspace()["id"])
    write_field(sub["subscriptionId"], "seats", str(state["active"] + 1))
    limit_is(owner, state["active"] + 1)
    with futures.ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda pair: pair[0].post(f"/api/invites/{pair[1][0]['id']}/accept"), zip(invited, invites)))
    assert sorted(item.status_code for item in answers) == [200, 409]
    winner = next(index for index, item in enumerate(answers) if item.status_code == 200)
    loser = 1 - winner
    failed(answers[loser], 409, "workspace_full")
    crew.joined.append((owner, invited[winner].person["id"]))
    assert billing(owner)["active"] == state["active"] + 1
    assert invited[loser].get("/api/invites/mine").json()["invites"][0]["status"] == "pending"
    return invited[loser], {"state": state, "subscription": sub["subscriptionId"], "owner": owner}


def test_last_seat(app_url: str, browser: Browser, crew: Crew, killbill: KillBill) -> None:
    base = app_url
    loser, facts = race_last_seat(base, base, crew, killbill)
    try:
        with blank(browser) as page:
            page.context.request.post(f"{base}/api/session", data={"email": loser.email, "password": PASSWORD})
            page.goto(f"{base}/invitations")
            role(page, "button", "Join Kereru Labs").click()
            expect(role(page, "heading", "This workspace is full")).to_be_visible()
            expect(page.get_by_text(f"Ask {ANA_NAME} to add a seat, then try again.")).to_be_visible()
            role(page, "link", "Back to your invitations").click()
            expect(role(page, "button", "Join Kereru Labs")).to_be_visible()
    finally:
        write_field(facts["subscription"], "seats", str(facts["state"]["limit"]))
        limit_is(facts["owner"], facts["state"]["limit"])


def test_wf_invites_guest_acceptance(app_url: str, browser: Browser, crew: Crew, mail: Mailpit) -> None:
    ana = Api(app_url, ANA)
    ensure_seats(ana)
    name, email = fresh("guest")
    with signed_in(browser, app_url, ANA, "/settings") as page:
        form = role(page, "form", "Invite")
        role(form, "textbox", "Invite email").fill(email)
        role(form, "radio", "Guest").check()
        role(form, "checkbox", "Kiln").check()
        role(form, "checkbox", "#kiln-review").check()
        role(form, "button", "Send invite").click()
        announced(page, f"Invite created for {email}.")
    poll(lambda: mail_for(mail, ana.workspace()["id"], to=email), MAIL_RETRY_S, "invite email")
    with blank(browser) as page:
        page.goto(f"{app_url}/create-account")
        form = role(page, "form", "Create account")
        role(form, "textbox", "Name").fill(name)
        role(form, "textbox", "Email").fill(email)
        role(form, "textbox", "Password").fill(PASSWORD)
        role(form, "button", "Create account").click()
        expect(page).to_have_url(f"{app_url}/invitations")
        expect(role(page, "heading", "Your invitations")).to_be_visible()
        role(page, "button", "Join Kereru Labs").click()
        expect(page).to_have_url(f"{app_url}/welcome")
        expect(role(page, "heading", "Welcome to Kereru Labs")).to_be_visible()
        page.reload()
        expect(role(page, "heading", "Welcome to Kereru Labs")).to_be_visible()
        role(page, "link", "Go to Issues").click()
        expect(page).to_have_url(f"{app_url}/issues")
        expect(listing(page).get_by_role("row", name=re.compile("^KIL-")).first).to_be_visible()
        expect(listing(page).get_by_role("row", name=re.compile("^ATL-"))).to_have_count(0)
    member = next(item for item in ana.get("/api/members").json()["members"] if item["email"] == email)
    assert member["role"] == "guest"
    crew.joined.append((ana, member["id"]))


def test_wf_invites_landing_routes(app_url: str, browser: Browser, crew: Crew) -> None:
    with blank(browser) as page:
        page.goto(f"{app_url}/")
        expect(page).to_have_url(f"{app_url}/sign-in")
        page.goto(f"{app_url}/issues?cycle=all")
        expect(page).to_have_url(f"{app_url}/sign-in?next=%2Fissues%3Fcycle%3Dall")
        sign_in_form(page, BEN)
        expect(page).to_have_url(f"{app_url}/issues?cycle=all")
        page.reload()
        expect(page).to_have_url(f"{app_url}/issues?cycle=all")
        for route in ("/sign-in", "/create-account", "/invitations", "/welcome", "/"):
            page.goto(f"{app_url}{route}")
            expect(page).to_have_url(f"{app_url}/issues")
        page.goto(f"{app_url}/settings")
        expect(page).to_have_url(f"{app_url}/issues")
    for target in ("%2F%2Fevil.test", "https%3A%2F%2Fevil.test", "%2F%5Cevil.test"):
        with blank(browser) as page:
            page.goto(f"{app_url}/sign-in?next={target}")
            sign_in_form(page, BEN)
            expect(page).to_have_url(f"{app_url}/issues")
    with blank(browser) as page:
        page.goto(f"{app_url}/sign-in?next={quote('/chat/inbox', safe='')}")
        sign_in_form(page, BEN)
        expect(page).to_have_url(f"{app_url}/chat/inbox")
    with signed_in(browser, app_url, ANA, "/account") as page:
        expect(page).to_have_url(f"{app_url}/settings")
    with signed_in(browser, app_url, FEMI, "/issues/ATL-1") as page:
        expect(role(detail(page), "heading", "Not found")).to_be_visible()
        expect(detail(page).get_by_text("That item doesn't exist or isn't shared with you.")).to_be_visible()
        expect(page).to_have_url(f"{app_url}/issues/ATL-1")
        unknown = "docs/unknown/path"
        page.goto(f"{app_url}/{unknown}")
        expect(role(detail(page), "heading", "Not found")).to_be_visible()
    _, email = fresh("nowhere")
    person = crew.account(app_url, email)
    with signed_in(browser, app_url, email, "/issues", stream=False) as page:
        expect(page).to_have_url(f"{app_url}/invitations")
        expect(page.get_by_text(f"No invitations for {email}.")).to_be_visible()
        page.goto(f"{app_url}/account")
        expect(page).to_have_url(f"{app_url}/invitations")
    assert person.get("/api/me").json()["workspace"] is None


def test_kill_bill_subscription(app_url: str, killbill: KillBill) -> None:
    for email, name in ((ANA, "Kereru Labs"), (HAL, "Halyard Works")):
        owner = Api(app_url, email)
        ensure_seats(owner, 0)
        workspace = owner.workspace()
        key = f"tallyroom-{workspace['id']}"
        account = killbill.account_by_key(key)
        assert account and account["name"] == name and account["currency"] == "USD"
        bundles = bundles_of(account["accountId"])
        assert [item["externalKey"] for item in bundles] == [f"{key}-seats"]
        subscriptions = bundles[0]["subscriptions"]
        assert len(subscriptions) == 1 and subscriptions[0]["planName"] == "tallyroom-seat-monthly"
        state = billing(owner)
        assert fields(subscriptions[0]["subscriptionId"])["seats"]["value"] == str(state["limit"])
        assert state["account_external_key"] == key and state["billing_status"] == "ok"
        assert state["price_per_seat"] == "8.00" and state["currency"] == "USD"
        assert state["monthly_total"] == f"{state['limit'] * SEAT_PRICE:.2f}"
        assert workspace["seats"]["limit"] == state["limit"]
    failed(Api(app_url, BEN).get("/api/billing"), 403, "forbidden")
    assert Api(app_url, BEN).workspace()["seats"] is None


def test_seat_raise_confirmed(app_url: str, browser: Browser, killbill: KillBill) -> None:
    ana = Api(app_url, ANA)
    with seats_kept(ana, killbill) as kept:
        limit = kept["state"]["limit"]
        raised = ana.put("/api/billing/seats", {"seats": limit + 1}, idempotency_key())
        assert raised.status_code == 200
        assert raised.json()["limit"] == limit + 1
        assert raised.json()["monthly_total"] == f"{(limit + 1) * SEAT_PRICE:.2f}"
        assert fields(kept["id"])["seats"]["value"] == str(limit + 1)
        for bad in (0, SEATS_MAX + 1):
            assert "seats" in failed(ana.put("/api/billing/seats", {"seats": bad}), 422, "validation")["fields"]
        down_url = copy_url("APP_KILLBILL_DOWN_URL")
        down = Api(down_url, ANA)
        failed(down.put("/api/billing/seats", {"seats": limit + 2}), 503, "billing_unavailable")
        assert fields(kept["id"])["seats"]["value"] == str(limit + 1)
        answer = billing(down)
        assert answer["billing_status"] == "unavailable" and answer["limit"] == limit + 1
        with signed_in(browser, down_url, ANA, "/settings") as page:
            expect(notices(page).filter(has_text=f"Billing unavailable. Your seat limit stays at {limit + 1} until billing is back.")).to_be_visible(timeout=NOTICE_MS)


def test_direct_kill_bill_change(app_url: str, browser: Browser, killbill: KillBill, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    with seats_kept(ana, killbill) as kept, signed_in(browser, app_url, ANA, "/settings") as page:
        limit = kept["state"]["limit"]
        active = kept["state"]["active"]
        write_field(kept["id"], "seats", str(limit + 2))
        limit_is(ana, limit + 2)
        assert ana.workspace()["seats"]["limit"] == limit + 2
        expect(page.get_by_text(f"Monthly total: ${(limit + 2) * SEAT_PRICE:.2f}")).to_be_visible(timeout=FRESH_UI_MS)
        lowered = max(active - 1, 1)
        write_field(kept["id"], "seats", str(lowered))
        _, email = fresh("late")
        failed(ana.post("/api/invites", {"email": email, "role": "member", "project_ids": [], "channel_ids": []}), 409, "workspace_full")
        limit_is(ana, lowered)
        assert billing(ana)["active"] == active
        assert Api(app_url, BEN).get("/api/me").status_code == 200


def test_seat_reduction(browser: Browser, killbill: KillBill) -> None:
    base = short_url()
    ana = Api(base, ANA)
    with seats_kept(ana, killbill) as kept:
        active = billing(ana)["active"]
        if billing(ana)["limit"] <= active:
            write_field(kept["id"], "seats", str(active + 2))
            limit_is(ana, active + 2)
        limit = billing(ana)["limit"]
        workspace = ana.workspace()["id"]
        charged = poll(lambda: subscription(killbill, workspace).get("chargedThroughDate"), BOOT_S, "invoiced subscription")[:10]
        failed(ana.put("/api/billing/seats", {"seats": active - 1}), 409, "seats_below_active")
        target = limit - 1
        answer = ana.put("/api/billing/seats", {"seats": target}).json()
        assert (answer["limit"], answer["scheduled_limit"], answer["scheduled_on"]) == (limit, target, charged)
        assert answer["monthly_total"] == f"{limit * SEAT_PRICE:.2f}"
        stored = fields(kept["id"])
        assert stored["seats_scheduled"]["value"] == f"{target}@{charged}" and stored["seats"]["value"] == str(limit)
        with signed_in(browser, base, ANA, "/settings") as page:
            copy = f"Seat limit stays at {limit} until {pretty(charged)}, then {target}."
            expect(role(page, "status", "Billing status")).to_contain_text(copy)
        cleared = ana.put("/api/billing/seats", {"seats": limit}).json()
        assert cleared["scheduled_limit"] is None and "seats_scheduled" not in fields(kept["id"])
        ana.put("/api/billing/seats", {"seats": target})
        raised = ana.put("/api/billing/seats", {"seats": limit + 1}).json()
        assert raised["scheduled_on"] is None and "seats_scheduled" not in fields(kept["id"])
        due = ana.workspace()["today"]
        write_field(kept["id"], "seats_scheduled", f"{limit}@{due}")
        limit_is(ana, limit)
        poll(lambda: "seats_scheduled" not in fields(kept["id"]), FRESH_S, "schedule removed")
        assert fields(kept["id"])["seats"]["value"] == str(limit)
        assert billing(ana)["scheduled_limit"] is None


def test_wf_seats_and_billing_journey(app_url: str, browser: Browser, killbill: KillBill) -> None:
    ana = Api(app_url, ANA)
    with seats_kept(ana, killbill) as kept, signed_in(browser, app_url, ANA, "/settings") as page:
        limit, active = kept["state"]["limit"], kept["state"]["active"]
        expect(page.get_by_text(f"{active} of {limit} seats used, {kept['state']['pending']} pending")).to_be_visible()
        seats = role(page, "spinbutton", "Seats")
        status = role(page, "status", "Billing status")
        seats.fill(str(limit + 1))
        role(page, "button", "Update seats").click()
        expect(status).to_contain_text(f"Seat limit is now {limit + 1}.")
        expect(page.get_by_text(f"Monthly total: ${(limit + 1) * SEAT_PRICE:.2f}")).to_be_visible()
        assert fields(kept["id"])["seats"]["value"] == str(limit + 1)
        seats.fill(str(active - 1))
        role(page, "button", "Update seats").click()
        expect(status).to_contain_text(f"You have {active} people in this workspace. Remove someone before lowering seats below that.")
        assert fields(kept["id"])["seats"]["value"] == str(limit + 1)


def test_wf_seats_and_billing_outage(app_url: str, browser: Browser) -> None:
    base = copy_url("APP_KILLBILL_DOWN_URL")
    ana = Api(base, ANA)
    limit = billing(ana)["limit"]
    wanted = str(limit + 1)
    with signed_in(browser, base, ANA, "/settings") as page:
        seats = role(page, "spinbutton", "Seats")
        update = role(page, "button", "Update seats")
        status = role(page, "status", "Billing status")
        seats.fill(wanted)
        with held(page, SEATS_GLOB) as release:
            update.click()
            expect(update).to_have_attribute("aria-disabled", "true")
            expect(status).to_contain_text("Confirming with billing")
            release()
        copy = f"Seat limit not changed. It stays at {limit}."
        expect(status).to_contain_text(copy)
        wait_refreshes(page)
        expect(status).to_contain_text(copy)
        expect(seats).to_have_value(wanted)
    assert billing(ana)["limit"] == limit


def run_psql(sql: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["psql", os.environ["DATABASE_URL"], "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


@contextmanager
def scratch_database() -> Iterator[str]:
    name = f"tally_digest_{uuid.uuid4().hex[:10]}"
    created = run_psql(f'CREATE DATABASE "{name}"')
    assert created.returncode == 0, created.stderr
    try:
        yield urlunsplit(urlsplit(os.environ["DATABASE_URL"])._replace(path=f"/{name}"))
    finally:
        run_psql(f'DROP DATABASE IF EXISTS "{name}"')


def signs_in(base: str, email: str) -> bool:
    return Api(base).post("/api/session", {"email": email, "password": PASSWORD}).status_code == 200


def test_digest_schedule(mail: Mailpit) -> None:
    bucket = f"{os.environ['S3_BUCKET']}-{uuid.uuid4().hex[:10]}"
    due = DIGEST_START[:10]
    with scratch_database() as url, app_copy(SERVER_CLOCK_START=DIGEST_START, OUTBOX_RETRY_SECONDS="2", DATABASE_URL=url, S3_BUCKET=bucket) as base:
        poll(lambda: signs_in(base, ANA) and signs_in(base, HAL), BOOT_S, "the fresh copy seeds itself")
        ana, hal = Api(base, ANA), Api(base, HAL)
        workspace, other = ana.workspace(), hal.workspace()
        subject = digest_subject(due)
        people = (ANA, BEN, CHIARA, DEV, ELIN)
        poll(lambda: len(mail_for(mail, workspace["id"], subject)) >= len(people), DIGEST_S, "Kereru digests")
        found = mail_for(mail, workspace["id"], subject)
        assert sorted(addresses(item["To"])[0] for item in found) == sorted(people)
        assert mail_for(mail, workspace["id"], subject, FEMI) == []
        body = text(found[0])
        assert "KIL-1" in body and "RIG-1" not in body
        halyard = poll(lambda: mail_for(mail, other["id"], digest_subject(other["today"]), IRIS), DIGEST_S, "Halyard digest")
        assert len(halyard) == 1
        assert "RIG-1" in text(halyard[0]) and "KIL-1" not in text(halyard[0])
        instant = datetime.fromisoformat(ana.workspace()["next_digest_at"])
        assert (instant.hour, instant.minute) == (8, 0)
        assert instant.date().isoformat() > due and instant.isoweekday() in workspace["working_weekdays"]


def test_outbox_exactly_once(mail: Mailpit, crew: Crew) -> None:
    base = short_url()
    ana = Api(base, ANA)
    ensure_seats(ana, 5)
    addresses_sent = [crew.invite(ana)[1] for _ in range(5)]
    workspace = ana.workspace()["id"]
    poll(lambda: all(mail_for(mail, workspace, to=item) for item in addresses_sent), MAIL_RETRY_S, "invite mail")
    assert all(len(mail_for(mail, workspace, to=item)) == 1 for item in addresses_sent)
    poll(lambda: held_mail(ana) == 0, MAIL_RETRY_S, "outbox drains")
    assert Api(base, BEN).get("/api/status").json()["held_mail"] is None
    assert Api(base).get("/api/status").json()["held_mail"] is None
    down = copy_url("APP_MAILPIT_DOWN_URL")
    owner = Api(down, ANA)
    ensure_seats(owner)
    before = held_mail(owner)
    _, email = crew.invite(owner)
    assert held_mail(owner) == before + 1
    poll(lambda: owner.get("/api/status").json()["mail"] == "delayed", FRESH_S, "mail reads delayed")
    assert mail_for(mail, owner.workspace()["id"], to=email) == []


def test_held_mail_follows_record(mail: Mailpit, crew: Crew) -> None:
    with mail_outage() as (base, relay):
        ana, ben = Api(base, ANA), Api(base, BEN)
        workspace = ana.workspace()["id"]
        general = ana.channel("general")
        invite, revoked = crew.invite(ana)
        kept = crew.join(ana)
        leaver = crew.join(ana)
        removed = crew.join(ana)
        start = held_mail(ana)
        assert ana.delete(f"/api/invites/{invite['id']}").status_code == 200
        assert held_mail(ana) == start - 1
        message = ben.post_message(general, f"@{kept.person['handle']} first")
        subject = "Ben Ostrow mentioned you in #general"
        assert held_mail(ana) == start
        assert ben.delete(f"/api/messages/{message['id']}").status_code == 204
        assert held_mail(ana) == start - 1
        ben.post_message(general, f"@{leaver.person['handle']} channel")
        assert ana.delete(f"/api/channels/{general}/members/{leaver.id}").status_code == 204
        assert held_mail(ana) == start - 1
        ben.post_message(general, f"@{removed.person['handle']} person")
        assert ana.delete(f"/api/members/{removed.id}").status_code == 204
        lower = held_mail(ana)
        assert lower <= start - 1
        survivor = ben.post_message(general, f"@{kept.person['handle']} stays")
        assert survivor["mentions"] == [kept.id]
        relay.up = True
        poll(lambda: mail_for(mail, workspace, subject, kept.email), MAIL_RETRY_S, "kept mention sent")
        poll(lambda: held_mail(ana) == 0, MAIL_RETRY_S, "outbox drains")
        assert len(mail_for(mail, workspace, subject, kept.email)) == 1
        assert mail_for(mail, workspace, to=revoked) == []
        assert mail_for(mail, workspace, subject, leaver.email) == []
        assert mail_for(mail, workspace, to=removed.email) == []
        crew.dismiss()
        crew.joined.clear()
        crew.pending.clear()


def test_wf_mail_outbox_recovery(browser: Browser, mail: Mailpit, crew: Crew) -> None:
    twin = copy_url("APP_MAILPIT_DOWN_URL")
    with mail_outage() as (base, relay):
        ana, ben = Api(base, ANA), Api(base, BEN)
        ensure_seats(ana, 2)
        workspace = ana.workspace()["id"]
        held_before = held_mail(ana)
        _, first = fresh("held")
        _, second = fresh("held")
        with signed_in(browser, base, ANA, "/settings") as page:
            form = role(page, "form", "Invite")
            for email in (first, second):
                role(form, "textbox", "Invite email").fill(email)
                role(form, "radio", "Member").check()
                role(form, "button", "Send invite").click()
                announced(page, f"Invite created for {email}.")
            ben.post_message(ana.channel("general"), "@elin held mention")
            expected = held_before + 3
            assert held_mail(ana) == expected
            expect(notices(page).filter(has_text=delayed_copy(expected))).to_be_visible(timeout=NOTICE_MS)
            invites = ana.get("/api/invites").json()["invites"]
            for item in invites:
                if item["email"] in (first, second):
                    crew.pending.append((Api(twin, ANA), item["id"]))
            table = role(page, "table", "Invites")
            role(table, "button", f"Revoke invite for {first}").click()
            announced(page, f"Invite for {first} revoked.")
            assert held_mail(ana) == expected - 1
            expect(notices(page).filter(has_text=delayed_copy(expected - 1))).to_be_visible(timeout=NOTICE_MS)
            relay.up = True
            poll(lambda: held_mail(ana) == 0, MAIL_RETRY_S, "outbox drains")
            expect(notices(page).filter(has_text="Mail delayed")).to_have_count(0, timeout=NOTICE_MS)
        assert len(mail_for(mail, workspace, to=second)) == 1
        assert mail_for(mail, workspace, to=first) == []


def test_database_outage(browser: Browser) -> None:
    base = copy_url("APP_POSTGRES_DOWN_URL")
    api = Api(base)
    assert api.get("/api/health").json() == {"status": "ok"}
    poll(lambda: api.get("/api/status").json()["database"] == "unavailable", FRESH_S, "database reads unavailable")
    assert api.get("/api/status").json()["held_mail"] is None
    for call in (api.get("/api/me"), api.get("/api/events"), api.post("/api/session", {"email": BEN, "password": PASSWORD}), api.get("/api/issues")):
        failed(call, 503, "database_unavailable")
    failed(api.post("/api/session", {"pad": "x" * MAX_JSON}), 413, "too_large")
    with blank(browser) as page:
        page.goto(f"{base}/sign-in")
        expect(role(page, "form", "Sign in")).to_be_visible()
        expect(notices(page).filter(has_text="Tallyroom can't reach its database. Changes are not being saved.")).to_be_visible(timeout=NOTICE_MS)


def test_service_status_notices(app_url: str, browser: Browser) -> None:
    assert set(Api(app_url).get("/api/status").json()) == {"database", "mail", "storage", "billing", "held_mail"}
    ana = Api(app_url, ANA)
    poll(lambda: (lambda item: (item["database"], item["storage"], item["billing"], item["mail"]) == ("ok", "ok", "ok", "ok"))(ana.get("/api/status").json()), MAIL_RETRY_S, "all services ok")
    with signed_in(browser, app_url, ANA, "/settings") as page:
        expect(role(page, "region", "Service notices")).to_be_attached()
        expect(notices(page)).to_have_count(0)
    billing_url = copy_url("APP_KILLBILL_DOWN_URL")
    poll(lambda: Api(billing_url).get("/api/status").json()["billing"] == "unavailable", FRESH_S, "billing reads unavailable")
    with signed_in(browser, billing_url, BEN, "/issues") as page:
        expect(page.get_by_text("Billing unavailable.")).to_have_count(0)
        expect(notices(page)).to_have_count(0)
    storage_url = copy_url("APP_MINIO_DOWN_URL")
    poll(lambda: Api(storage_url).get("/api/status").json()["storage"] == "unavailable", FRESH_S, "storage reads unavailable")
    with signed_in(browser, storage_url, BEN, "/issues") as page:
        expect(notices(page).filter(has_text="Attachments are unavailable right now. Nothing new can be attached.")).to_be_visible(timeout=NOTICE_MS)
    mail_url = copy_url("APP_MAILPIT_DOWN_URL")
    owner = Api(mail_url, ANA)
    ensure_seats(owner)
    crew = Crew()
    try:
        crew.invite(owner)
        with signed_in(browser, mail_url, ANA, "/issues") as page:
            expect(notices(page).filter(has_text="Mail delayed:")).to_be_visible(timeout=NOTICE_MS)
        with signed_in(browser, mail_url, BEN, "/issues") as page:
            expect(notices(page).filter(has_text="Mail delayed:")).to_have_count(0)
    finally:
        crew.dismiss()


def test_wf_service_outages_storage_in_place(app_url: str, browser: Browser) -> None:
    ben = Api(app_url, BEN)
    doc = new_doc(ben, ben.project("KIL"))
    draft = stamp("Draft")
    state = {"storage": "ok"}

    def answer(route: Any) -> None:
        body = route.fetch().json()
        route.fulfill(json={**body, "storage": state["storage"]})

    copy = "Attachments are unavailable right now. Nothing new can be attached."
    with signed_in(browser, app_url, BEN, f"/docs/{doc['id']}") as page:
        page.route(STATUS_GLOB, answer)
        body = role(page, "textbox", "Doc body")
        body.fill(draft)
        role(page, "button", "Version history").click()
        dialog = role(page, "dialog", "Version history")
        expect(dialog).to_be_visible()
        state["storage"] = "unavailable"
        expect(notices_behind_modal(page).filter(has_text=copy)).to_be_visible(timeout=NOTICE_MS)
        expect(role(page, "button", "Attach file", include_hidden=True).first).to_have_attribute("aria-disabled", "true")
        expect(dialog).to_be_visible()
        focus_settles(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden(timeout=UI_MS)
        expect(role(page, "button", "Version history")).to_be_focused(timeout=UI_MS)
        body.focus()
        state["storage"] = "ok"
        expect(notices(page).filter(has_text=copy)).to_have_count(0, timeout=NOTICE_MS)
        expect(role(detail(page), "button", "Attach file")).not_to_have_attribute("aria-disabled", "true")
        expect(body).to_be_focused()
        expect(body).to_have_value(draft)


def test_wf_service_outages_recovers_without_restart() -> None:
    parts = urlsplit(os.environ["DATABASE_URL"] + "_mail")
    relay = Relay(parts.hostname, parts.port or 5432)
    credentials = parts.netloc.rsplit("@", 1)[0]
    url = urlunsplit((parts.scheme, f"{credentials}@127.0.0.1:{relay.port}", parts.path, parts.query, ""))
    try:
        with app_copy(DATABASE_URL=url, S3_BUCKET=os.environ["S3_BUCKET"] + "-mail") as base:
            api = Api(base)
            assert api.get("/api/health").json() == {"status": "ok"}
            failed(api.get("/api/me"), 503, "database_unavailable")
            assert api.get("/sign-in").status_code == 200
            relay.up = True
            poll(lambda: api.post("/api/session", {"email": BEN, "password": PASSWORD}).status_code == 200, FRESH_S, "database reconnects")
            poll(lambda: api.get("/api/status").json()["database"] == "ok", FRESH_S, "status reads ok")
    finally:
        relay.stop()
    for name in ("APP_POSTGRES_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_KILLBILL_DOWN_URL"):
        assert httpx.get(f"{copy_url(name)}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_wf_app_copies_idempotent_replay(killbill: KillBill) -> None:
    first, second = Api(short_url(), BEN), Api(twin_url(), BEN)
    channel = first.channel("general")
    path = f"/api/channels/{channel}/messages"
    body, key = {"body": stamp("Copies")}, idempotency_key()
    with futures.ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda api: api.post(path, body, key), (first, second)))
    assert {item.status_code for item in answers} == {201} and len({item.json()["id"] for item in answers}) == 1
    assert [item["body"] for item in first.get(path).json()["messages"]].count(body["body"]) == 1
    owner, other = Api(short_url(), ANA), Api(twin_url(), ANA)
    with seats_kept(owner, killbill) as kept:
        limit = kept["state"]["limit"]
        seat_key = idempotency_key()
        payload = {"seats": limit + 1}
        one = owner.put("/api/billing/seats", payload, seat_key)
        two = other.put("/api/billing/seats", payload, seat_key)
        assert one.status_code == two.status_code == 200 and two.headers["Idempotent-Replay"] == "true"
        assert billing(other)["limit"] == limit + 1
        assert fields(kept["id"])["seats"]["value"] == str(limit + 1)


def test_wf_app_copies_shared_state() -> None:
    first, second = Api(short_url(), BEN), Api(twin_url(), CHIARA)
    other_copy_ben = Api(twin_url(), BEN)
    channel = first.channel("general")
    room = first.room("Studio")
    private = first.room("Review Room")
    try:
        with streaming(second) as stream:
            first.post(f"/api/channels/{channel}/typing")
            assert first.id in second.get(f"/api/channels/{channel}/messages").json()["typing"]
            stream.wait("typing", lambda data: first.id in data["typing"])
            lapse = poll(
                lambda: stream.named("typing", lambda data: data["channel_id"] == channel and first.id not in data["typing"]),
                TYPING_LAPSE_S,
                "typing lapse event",
            )
            assert len(lapse) == 1
            assert other_copy_ben.post(f"/api/rooms/{room['id']}/join").status_code == 200
            assert first.id in first.inside("Studio")
            with streaming(other_copy_ben):
                opened = Stream(first)
                opened.close()
                stays(lambda: first.id in second.inside("Studio"), 6, "a stream on the other copy keeps the person inside")
            leave_all(first)
            assert first.id not in second.inside("Studio")
            message = first.post_message(channel, stamp("Shared unread"))
            assert second.unread()["channels"][channel] >= 1
            assert second.post(f"/api/channels/{channel}/read", {"up_to": message["id"]}).status_code == 200
            assert Api(short_url(), CHIARA).unread()["channels"][channel] == 0
            assert first.post(f"/api/rooms/{private['id']}/join").status_code == 200
            with streaming(first) as occupant:
                knock = second.post(f"/api/rooms/{private['id']}/knocks").json()
                expired = lambda data: data["id"] == knock["id"] and data["status"] == "expired"
                stream.wait("knock", expired, seconds=8)
                occupant.wait("knock", expired, seconds=8)
                stays(lambda: True, LIVE_S, "a duplicate would arrive here")
                assert len(stream.named("knock", expired)) == 1 and len(occupant.named("knock", expired)) == 1
                assert stream.named("knock", expired)[0]["id"] == occupant.named("knock", expired)[0]["id"]
    finally:
        leave_all(first, second)


def test_wf_app_copies_event_order() -> None:
    first, second = Api(short_url(), BEN), Api(twin_url(), DEV)
    reader_one, reader_two = Api(short_url(), CHIARA), Api(twin_url(), CHIARA)
    channel = first.channel("general")
    count = 30
    with streaming(reader_one) as one, streaming(reader_two) as two:
        anchor = first.post_message(channel, stamp("Anchor"))
        marker = int(one.wait("message", lambda data: data["id"] == anchor["id"])["id"])
        with futures.ThreadPoolExecutor(8) as pool:
            sent = list(pool.map(lambda index: (first if index % 2 else second).post_message(channel, f"Order {index}"), range(count)))
        wanted = {item["id"] for item in sent}
        for stream in (one, two):
            poll(lambda: wanted <= {item["data"]["id"] for item in stream.named("message")}, LIVE_S * 2, "all messages delivered")
        order = [[int(item["id"]) for item in stream.named("message") if item["data"]["id"] in wanted] for stream in (one, two)]
        assert order[0] == order[1] and order[0] == sorted(set(order[0])) and len(order[0]) == count
    with streaming(reader_one, marker) as replay:
        poll(lambda: wanted <= {item["data"]["id"] for item in replay.named("message")}, LIVE_S * 2, "replay delivered")
        assert [int(item["id"]) for item in replay.named("message") if item["data"]["id"] in wanted] == order[0]


def test_held_count_across_copies(crew: Crew) -> None:
    with mail_outage() as (base, _):
        ana, other = Api(base, ANA), Api(copy_url("APP_MAILPIT_DOWN_URL"), ANA)
        ensure_seats(other)
        before = held_mail(ana)
        crew.invite(other)
        assert held_mail(ana) == before + 1


def test_wf_app_copies_last_seat(app_url: str, crew: Crew, killbill: KillBill) -> None:
    _, facts = race_last_seat(app_url, copy_url("APP_MINIO_DOWN_URL"), crew, killbill)
    write_field(facts["subscription"], "seats", str(facts["state"]["limit"]))
    limit_is(facts["owner"], facts["state"]["limit"])


def test_wf_cross_cutting_layouts(app_url: str, browser: Browser) -> None:
    with signed_in(browser, app_url, BEN, "/issues", viewport=DESKTOP) as page:
        navigation = role(page, "navigation", "Modules")

        def boxes() -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
            return navigation.bounding_box(), listing(page).bounding_box(), detail(page).bounding_box()

        nav, items, sheet = boxes()
        assert nav["height"] > nav["width"] and nav["x"] + nav["width"] <= items["x"] + 1
        assert items["x"] + items["width"] <= sheet["x"] + 1
        layout(page)
        for width in (1279, TABLET["width"]):
            page.set_viewport_size({"width": width, "height": TABLET["height"]})
            expect(detail(page)).to_be_visible()
            nav, items, sheet = boxes()
            assert nav["width"] > nav["height"] and nav["y"] + nav["height"] <= items["y"] + 1
            assert items["x"] + items["width"] <= sheet["x"] + 1 and abs(items["y"] - sheet["y"]) <= 1
            layout(page)
        for width in (767, PHONE["width"]):
            page.set_viewport_size({"width": width, "height": PHONE["height"]})
            expect(listing(page)).to_be_visible()
            expect(detail(page)).to_have_count(0)
            nav = navigation.bounding_box()
            assert nav["width"] > nav["height"] and nav["y"] + nav["height"] <= PHONE["height"]
            assert nav["y"] + nav["height"] >= PHONE["height"] - 1
            expect(role(page, "button", "Back")).to_have_count(0)
            layout(page)
        role(page, "link", "Cycle").click()
        expect(detail(page)).to_be_visible()
        expect(listing(page)).to_have_count(0)
        expect(role(page, "button", "Back")).to_be_visible()
        layout(page)


def test_wf_cross_cutting_dialogs(app_url: str, browser: Browser) -> None:
    with signed_in(browser, app_url, BEN, "/issues") as page:
        opener = role(page, "button", "New issue")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "New issue")
        expect(dialog).to_be_visible()
        focus_settles(dialog)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TRAP_TABS):
                page.keyboard.press(key)
                assert focus_inside(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        button = row_of(page, {"key": "KIL-1", "title": "Kiln onboarding checklist"}).get_by_role("button", name=re.compile("^Status: "))
        button.click()
        box = role(page, "listbox", "Status")
        expect(box).to_be_visible()
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TRAP_TABS):
                page.keyboard.press(key)
                assert focus_inside(box)
        page.keyboard.press("Escape")
        expect(box).to_have_count(0)
        expect(button).to_be_focused()


def test_verbatim_copy(app_url: str, browser: Browser, crew: Crew) -> None:
    ana = Api(app_url, ANA)
    member = crew.join(ana)
    clear_inbox(member)
    with blank(browser) as page:
        page.goto(f"{app_url}/sign-in")
        sign_in_form(page, BEN, "wrong-password")
        expect(role(page, "form", "Sign in")).to_contain_text("That email and password don't match.")
        page.goto(f"{app_url}/create-account")
        form = role(page, "form", "Create account")
        role(form, "textbox", "Name").fill("Taken")
        role(form, "textbox", "Email").fill(BEN)
        role(form, "textbox", "Password").fill(PASSWORD)
        role(form, "button", "Create account").click()
        expect(page.get_by_text("An account with that email already exists.")).to_be_visible()
    with signed_in(browser, app_url, member.email, "/account") as page:
        form = role(page, "form", "Password")
        role(form, "textbox", "Current password").fill("wrong-password")
        role(form, "textbox", "New password").fill("tally-demo-3")
        role(form, "button", "Change password").click()
        announced(page, "That current password isn't right.")
        role(form, "textbox", "Current password").fill(PASSWORD)
        role(form, "textbox", "New password").fill("short")
        role(form, "button", "Change password").click()
        announced(page, "Use 8 to 128 characters.")
        role(form, "textbox", "New password").fill("tally-demo-3")
        role(form, "button", "Change password").click()
        announced(page, "Password changed. Other devices were signed out.")
        page.goto(f"{app_url}/chat/inbox")
        expect(page.get_by_text("You're all caught up.")).to_be_visible()
        page.goto(f"{app_url}/issues")
        role(page, "button", "New issue").click()
        dialog = role(page, "dialog", "New issue")
        role(dialog, "button", "Create issue").click()
        expect(page.get_by_text("Give the issue a title.").first).to_be_visible()
        title = stamp("Copy")
        role(dialog, "textbox", "Title").fill(title)
        select(role(dialog, "combobox", "Project"), "Kiln")
        role(dialog, "button", "Create issue").click()
        key = poll(lambda: next((item["key"] for item in ana.get("/api/issues").json()["issues"] if item["title"] == title), None), UI_MS / 1000, "issue stored")
        announced(page, f"{key} created.")
    target = crew.join(ana)
    with signed_in(browser, app_url, target.email, "/issues") as page:
        assert ana.delete(f"/api/members/{target.id}").status_code == 204
        expect(page).to_have_url(f"{app_url}/sign-in", timeout=UI_MS)
        expect(page.get_by_text("You've been signed out.")).to_be_visible()


def test_server_boundary(app_url: str) -> None:
    ben = Api(app_url, BEN)
    channel = ben.channel("general")
    path = f"/api/channels/{channel}/messages"
    failed(ben.http.post(path, json={"body": "x"}, headers={"Origin": "http://evil.test"}), 403, "cross_origin")
    same = ben.http.post(path, json={"body": stamp("Same")}, headers={"Origin": app_url})
    assert same.status_code == 201 and CORS_HEADER not in same.headers
    failed(ben.http.post(path, content="body", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    frame = len(json.dumps({"email": BEN, "password": "x", "pad": ""}))
    exact = {"email": BEN, "password": "x", "pad": "p" * (MAX_JSON - frame)}
    failed(Api(app_url).post("/api/session", exact), 401, "invalid_credentials")
    failed(Api(app_url).post("/api/session", {**exact, "pad": "p" * MAX_JSON}), 413, "too_large")
    failed(ben.get(f"/api/{uuid.uuid4().hex}"), 404, "not_found")
    for item in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json"):
        assert httpx.get(f"{app_url}{item}", timeout=HTTP_TIMEOUT).status_code == 404
    page = httpx.get(f"{app_url}/sign-in", timeout=HTTP_TIMEOUT).text
    served = [page]
    for asset in re.findall(r"""(?:src|href)=["'](/[^"']+)["']""", page):
        served.append(httpx.get(f"{app_url}{asset}", timeout=HTTP_TIMEOUT).text)
    for name in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "DATABASE_URL"):
        secret = os.environ.get(name)
        if not secret or secret.isalpha():
            continue
        assert not any(secret in body for body in served)


APP_ROOT = Path("/app")


def licence_of(item: dict[str, Any]) -> str:
    value = item.get("license") or item.get("licenses") or ""
    if isinstance(value, dict):
        value = value.get("type", "")
    if isinstance(value, list):
        value = " OR ".join(entry.get("type", "") if isinstance(entry, dict) else str(entry) for entry in value)
    return value


def shipped_packages() -> dict[str, str]:
    cwd = APP_ROOT if (APP_ROOT / "node_modules").exists() else Path(DEPLOYED_APP)
    result = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True, text=True)
    found: dict[str, str] = {}

    def visit_tree(node: dict[str, Any]) -> None:
        for name, item in (node.get("dependencies") or {}).items():
            if item.get("version") and name not in found:
                found[name] = licence_of(item)
                visit_tree(item)

    visit_tree(json.loads(result.stdout))
    return found


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(value, str) and value for value in manifest.values())


def test_if_third_party_notices() -> None:
    notices_text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    for name in shipped_packages():
        assert name in notices_text, name
    assert "IBM Plex" in notices_text and "Lucide" in notices_text


def test_if_licences() -> None:
    allowed = {"MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1"}
    for name, licence in shipped_packages().items():
        terms = set(re.findall(r"[A-Za-z0-9.\-]+", licence)) - {"OR"}
        assert terms & allowed if " OR " in licence else licence in allowed, f"{name}: {licence}"


def test_if_no_other_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lowdb", "nedb"}
    assert not banned & set(shipped_packages())
    skip = {"node_modules", ".git"}
    for path in APP_ROOT.rglob("*"):
        if not skip & set(path.parts):
            assert path.suffix not in (".sqlite", ".sqlite3", ".db"), str(path)


def test_if_service_config_untouched() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    assert not trajectory.exists() or not re.search(
        r'"(?:file_path|path)"\s*:\s*"[^"]*(?:docker-compose|compose\.ya?ml|services/[^"]*\.ya?ml)[^"]*"',
        "\n".join(line for line in trajectory.read_text().splitlines() if re.search(r"Write|Edit", line)),
    )


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", ".git", "out"}
    files = [path for path in APP_ROOT.rglob("*") if path.is_file() and not skip & set(path.parts)]
    assert any(path.suffix in (".ts", ".tsx") for path in files)
    for path in files:
        if path.suffix in (".js", ".jsx", ".mjs", ".cjs"):
            assert re.search(r"config|rc\.", path.name), str(path)


def test_if_same_origin_assets(app_url: str, browser: Browser) -> None:
    requests: list[str] = []
    with blank(browser) as page:
        page.on("request", lambda request: requests.append(request.url))
        page.goto(f"{app_url}/sign-in")
        sign_in_form(page, BEN)
        expect(page).to_have_url(f"{app_url}/issues")
        page.goto(f"{app_url}/office")
        expect(role(page, "region", "Office floor")).to_be_visible()
    origin = f"{urlsplit(app_url).scheme}://{urlsplit(app_url).netloc}"
    assert requests and all(same_origin(item, origin) for item in requests if item.startswith("http"))
