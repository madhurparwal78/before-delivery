from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    capture,
    center,
    decode,
    difference,
    held,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
)

PASSWORD = "sprig-pass-1"
DESK = (1280, 800)
TABLET = (768, 1024)
PHONE = (390, 844)
PHONE_SMALL = (375, 812)
JSON_LIMIT = 1000000
ROOT_W = 240
ROOT_H = 48
TOPIC_W = 180
TOPIC_H = 32
LINE_H = 20
LEVEL_GAP = 80
ORG_GAP = 60
LIST_INDENT = 32
LIST_GAP = 8
FLOAT_DROP = 120
BOUNDARY_PAD = 12
FIT_MARGIN = 96
WHEEL_STEP = 1.1
MINIMAP_STEP = 40
LONG_PRESS_MS = 500
EDGE_STEP_MS = 16
EDGE_STEP_PX = 8
SWIPE_PX = 50
REGROW_MS = 320
CONNECTOR_MS = 200
ENTER_MS = 160
TOAST_ENTER_MS = 120
CAMERA_MS = 400
CAMERA_MAX_MS = 500
TAP_MIN_PX = 44
VERSION_STEP_MS = 300000
PRESENTER_GRACE_MS = 60000
MINUTE_MS = 60000
LINK_EXPIRY_MS = 60000
OVERSIZE = 2000001
TITLE_MAX = 200
LOAD_BUDGET_S = 3
ZOOM_EPS = 0.0001
BRANCH_COLOURS = ["indigo", "azure", "teal", "green", "violet", "magenta", "orange", "ochre"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense"}
EXPORT_PROGRESS = {0, 20, 40, 60, 80, 100}

MIND = {
    "t-root": ("0", "0", "240", "48", "none"),
    "t-stalls": ("290", "-48", "180", "32", "right"),
    "t-music": ("-290", "-24", "180", "32", "left"),
    "t-vol": ("290", "24", "180", "52", "right"),
    "t-budget": ("-290", "24", "180", "32", "left"),
    "t-morning": ("550", "0", "180", "32", "right"),
    "t-afternoon": ("550", "48", "180", "32", "right"),
}
REBALANCED = {
    "t-stalls": ("290", "-48", "right"),
    "t-permits": ("-290", "-48", "left"),
    "t-music": ("290", "0", "right"),
    "t-vol": ("-290", "24", "left"),
    "t-budget": ("290", "48", "right"),
    "t-morning": ("-550", "0", "left"),
    "t-afternoon": ("-550", "48", "left"),
}
ORG = {
    "t-root": ("0", "0"),
    "t-stalls": ("-408", "100"),
    "t-music": ("-204", "100"),
    "t-vol": ("102", "110"),
    "t-budget": ("408", "100"),
    "t-morning": ("0", "212"),
    "t-afternoon": ("204", "212"),
}
LIST = {
    "t-root": ("120", "24"),
    "t-stalls": ("122", "72"),
    "t-music": ("122", "112"),
    "t-vol": ("122", "162"),
    "t-morning": ("154", "212"),
    "t-afternoon": ("154", "252"),
    "t-budget": ("122", "292"),
}
TITLES = {"t-root": "Street fair", "t-stalls": "Stalls", "t-music": "Music stage", "t-vol": "Volunteers and rotas",
          "t-morning": "Morning shift", "t-afternoon": "Afternoon shift", "t-budget": "Budget"}

BUDGET_ID = "t-budget"
MUSIC_ID = "t-music"
MORNING_ID = "t-morning"
ID_B = "t-b"
SECRET_NOTE = "Secret speaker note"
SHIFT_EDITED = TITLES["t-afternoon"] + " x"
BLOCKED_BY_HALL = "Blocked by Book hall"
NOTE_BEFORE = "Ask each stall"
NOTE_AFTER = "Ask each booth"
LOCKED_TITLE = "Stall music"
EXACT_NAME = "exact.png"
TICKETS_FILE = "tickets.sprig.txt"
NEW_BRANCH = "Tickets"
RENAMED_BRANCH = "Money"
LIVE_MUSIC = "Live " + TITLES["t-music"]
REMOTE_BUDGET = "Our Budget cap"
PHONE_NOTE = "Bring **tables**"
PHONE_NOTE_SHOWN = "Bring tables"
LARGE_MAP = 2000
ID_VOL = "t-vol"
ID_COST = "t-cost"
ID_SECRET = "t-secret"
TABLES = "Tables"
NOTE_SHOWN = "bold and soft and code"
SCRIPT_TEXT = "<script>window.__pwned=2</script>"
GUEST_PAT = "Pat Guest"
GUEST_SAM = "Sam Guest"
NOTE_CHAIRS = "Bring chairs"
NOTE_LOUD = "Turn it up"
FAIR_PLAN = "Fair plan"
NOTE_ESCAPED = "Line one\nLine | two"
GRAND_CHILD = "Grand \\ child"
DUE_FIRST = "2020-01-01"
DUE_SECOND = "2020-01-02"
BUDGET_CAP = "Budget cap"
STALLS_ROW = "Stalls row"
BUDGET_PLAN = "Budget plan"
BIG_STALLS_ROW = "Big Stalls row"
OUR_BUDGET = "Our Budget"
MUSIC_TENT = "Music tent"
GAMES = "Games"
BIG_STALLS_FAIR = "Big Stalls fair"
QUEUED_TITLE = "Music stage tent"
ID_QUOTE = "t-q"


def label(title: str, level: int, pos: int, size: int, *parts: str) -> str:
    return ", ".join([title, f"level {level}", f"{pos} of {size}", *parts])


def vote_name(title: str) -> str:
    return f"Vote for {title}"


def back_online(sent: int, conflicts: int) -> str:
    changes = "change" if sent == 1 else "changes"
    found = "conflict" if conflicts == 1 else "conflicts"
    return f"Back online: {sent} {changes} sent, {conflicts} {found}."


def offline_banner(n: int) -> str:
    changes = "change" if n == 1 else "changes"
    return f"You're working offline. {n} {changes} waiting."


def rollup(*pairs: tuple[int, int]) -> int:
    weights = sum(w for w, _ in pairs)
    total = sum(w * p for w, p in pairs)
    return (2 * total + weights) // (2 * weights)


def inbox_name(n: int) -> str:
    return f"Inbox ({n})"


def link_el(page: Page, src: str, dst: str) -> Locator:
    return page.locator(f'[data-from="{src}"][data-to="{dst}"]')


def boundary_el(page: Page, bid: str) -> Locator:
    return page.locator(f'[data-boundary="{bid}"]')


UI_MS = 20000
HTTP_TIMEOUT = 30
DEADLINE_S = 60
POLL_MS = 250
TAB_PRESSES = 25
COPY_BOOT_S = 180
LOGIN_PROBES = 2500
RATE_PROBE = 5
SAVE_NAME_WAIT_MS = 1500
QUOTA_PROBES = 25
VERSION_PROBES = 30
COORD_SLACK = 1.0
DEVICE_TIME = datetime(2099, 1, 1, tzinfo=timezone.utc)

expect.set_options(timeout=UI_MS)


def uname(prefix: str = "u") -> str:
    return prefix + uuid.uuid4().hex[:10]


def gid(prefix: str = "g") -> str:
    return prefix + uuid.uuid4().hex[:12]


def op(kind: str, **fields: Any) -> dict:
    return {"op_id": gid("o"), "kind": kind, **fields}


def task(percent: int = 0, weight: int = 1, state: str = "open", due: str | None = None, assignee: str | None = None) -> dict:
    return {"percent": percent, "weight": weight, "state": state, "priority": "normal", "due": due, "assignee": assignee}


def node(tid: str, title: str, *children: dict, **extra: Any) -> dict:
    return {"id": tid, "title": title, "children": list(children), **extra}


def fair(**extra: dict) -> dict:
    x = lambda tid, title, *kids: {**node(tid, title, *kids), **extra.get(tid, {})}
    return node("t-root", "Street fair",
                x("t-stalls", "Stalls"),
                x("t-music", "Music stage"),
                x("t-vol", "Volunteers and rotas",
                  x("t-morning", "Morning shift"),
                  x("t-afternoon", "Afternoon shift")),
                x("t-budget", "Budget"))


def seed(app_url: str, users: list[str], maps: list[dict]) -> dict:
    r = post_json(app_url, "/api/grading/seed",
                  {"users": [{"username": u, "password": PASSWORD} for u in users], "maps": maps})
    assert r.status_code == 201, f"POST /api/grading/seed answers 201: {r.status_code} {r.text}"
    return r.json()


def setup(app_url: str, *roles: str, owner: str | None = None, users: list[str] | None = None,
          root: dict | None = None, **extra: Any) -> SimpleNamespace:
    owner = owner or uname("o")
    users = users or [uname("u") for _ in roles]
    key = gid("k")
    entry = {"key": key, "owner": owner, "layout": "map", "theme": "daylight", "root": root or fair(),
             "roles": [{"username": u, "role": r} for u, r in zip(users, roles)]}
    entry.update(extra)
    body = seed(app_url, [owner, *users], [entry])
    m = body["maps"][key]
    return SimpleNamespace(id=m["id"], owner=owner, users=users, links=m.get("links") or {},
                           versions=m.get("versions") or [], presentation=m.get("presentation"))


class Api:

    def __init__(self, base: str, username: str | None = None):
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        if username:
            r = self.c.post("/api/grading/session", json={"username": username})
            assert r.status_code == 200, f"POST /api/grading/session answers 200: {r.status_code} {r.text}"

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.get(path, **kw)

    def post(self, path: str, body: Any = None, content: bytes | None = None, **kw: Any) -> httpx.Response:
        if content is not None:
            return self.c.post(path, content=content, **kw)
        return self.c.post(path, json=body, **kw)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.c.put(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.c.delete(path)

    def map(self, mid: str) -> dict:
        r = self.get(f"/api/maps/{mid}")
        assert r.status_code == 200, f"GET /api/maps/{mid} answers 200: {r.status_code} {r.text}"
        return r.json()

    def topics(self, mid: str) -> dict[str, dict]:
        return {t["id"]: t for t in self.map(mid)["topics"]}

    def revision(self, mid: str) -> int:
        return self.map(mid)["map"]["revision"]

    def ops(self, mid: str, *ops: dict, base: int | None = None) -> httpx.Response:
        body = {"group_id": gid(), "base_revision": self.revision(mid) if base is None else base, "ops": list(ops)}
        return self.post(f"/api/maps/{mid}/ops", body)


def grading_ops(app_url: str, mid: str, user: str, *ops: dict, base: int | None = None) -> httpx.Response:
    if base is None:
        base = Api(app_url, user).revision(mid)
    return post_json(app_url, f"/api/grading/maps/{mid}/ops",
                     {"as": user, "group_id": gid(), "base_revision": base, "ops": list(ops)})


def as_user(app_url: str, mid: str, user: str, *ops: dict, base: int | None = None) -> dict:
    r = grading_ops(app_url, mid, user, *ops, base=base)
    assert r.status_code == 200, f"grading ops as {user} answer 200: {r.status_code} {r.text}"
    return r.json()


def clock(app_url: str, ms: int) -> str:
    r = post_json(app_url, "/api/grading/clock", {"advance_ms": ms})
    assert r.status_code == 200, f"POST /api/grading/clock answers 200: {r.status_code} {r.text}"
    return r.json()["server_time"]


def instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def kids(topics: dict[str, dict], parent: str) -> list[str]:
    return [t["id"] for t in sorted((t for t in topics.values() if t["parent_id"] == parent), key=lambda t: t["rank"])]


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert body["error"] == code and isinstance(body["message"], str), body
    return body


def eventually(check: Callable[[], Any], what: str, page: Page | None = None, seconds: float = DEADLINE_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            value = check()
        except (AssertionError, KeyError, IndexError, TypeError, httpx.HTTPError) as error:
            last, value = error, None
        if value:
            return value
        if page is not None:
            advance(page, POLL_MS)
    pytest.fail(f"{what} (last: {last!r})")


def export_done(api: Api, export_id: str, seconds: float = DEADLINE_S) -> tuple[dict, list]:
    seen: list = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        e = api.get(f"/api/exports/{export_id}").json()["export"]
        if not seen or seen[-1] != (e["state"], e["progress"]):
            seen.append((e["state"], e["progress"]))
        if e["state"] in ("ready", "failed"):
            return e, seen
    pytest.fail(f"export {export_id} reaches ready or failed after its five published steps; saw {seen}")


def export_bytes(api: Api, mid: str, fmt: str, topic_id: str | None = None) -> tuple[bytes, dict, httpx.Response]:
    r = api.post(f"/api/maps/{mid}/exports", {"format": fmt, "topic_id": topic_id})
    assert r.status_code == 202, r.text
    job = r.json()["export"]
    final, _ = export_done(api, job["id"])
    assert final["state"] == "ready", final
    dl = api.get(f"/api/exports/{job['id']}/download")
    assert dl.status_code == 200, dl.text
    return dl.content, final, dl


def make_png(size: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    body = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"") + uuid.uuid4().bytes)
    return body + b"\x00" * (size - len(body)) if size else body


def make_jpeg() -> bytes:
    return b"\xff\xd8\xff\xe0" + uuid.uuid4().bytes + b"\xff\xd9"


def minio_down_url() -> str:
    url = os.environ.get("APP_MINIO_DOWN_URL")
    assert url, "APP_MINIO_DOWN_URL names the storage-outage instance (spec outages minio-down)"
    return url.rstrip("/")


@contextmanager
def storage_down(app_url: str) -> Iterator[None]:
    r = post_json(app_url, "/api/grading/storage", {"down": True})
    assert r.status_code == 200 and r.json() == {"storage": "down"}, r.text
    try:
        yield
    finally:
        up = post_json(app_url, "/api/grading/storage", {"down": False})
        assert up.status_code == 200 and up.json() == {"storage": "up"}, up.text


@contextmanager
def app_copy(overrides: dict[str, str], drop: tuple[str, ...] = ()) -> Iterator[tuple[str, Callable[[], str]]]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}; log tail:\n{tail()}")
            try:
                httpx.get(f"{base}/api/health", timeout=2)
                break
            except httpx.HTTPError:
                continue
        else:
            pytest.fail(f"app copy never answered /api/health; log tail:\n{tail()}")
        yield base, tail
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


@contextmanager
def browse(browser: Browser, app_url: str, user: str | None, path: str, size: tuple[int, int] = DESK,
           device_time: datetime | None = None, **options: Any) -> Iterator[Page]:
    with open_app(browser, f"{app_url}/signin", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if user:
            r = page.request.post(f"{app_url}/api/grading/session", data={"username": user})
            assert r.status == 200, f"POST /api/grading/session answers 200: {r.status}"
        if device_time is not None:
            page.clock.set_system_time(device_time)
        page.goto(f"{app_url}{path}")
        yield page


@contextmanager
def editor(browser: Browser, app_url: str, user: str, mid: str, size: tuple[int, int] = DESK, query: str = "",
           root: str = "t-root", **options: Any) -> Iterator[Page]:
    with browse(browser, app_url, user, f"/m/{mid}{query}", size, **options) as page:
        expect(topic(page, root)).to_be_visible()
        yield page


def tree(page: Page) -> Locator:
    return page.get_by_role("tree", name="Map", exact=True)


def topic(page: Page, tid: str) -> Locator:
    return tree(page).locator(f'[data-topic-id="{tid}"]')


def item(page: Page, title: str) -> Locator:
    return tree(page).get_by_role("treeitem", name=re.compile("^" + re.escape(title) + ", level"))


def shown(page: Page, text: Any) -> Locator:
    return page.get_by_text(text).first


def select_role(box: Locator, role: str) -> None:
    try:
        select(box, role)
    except AssertionError:
        select(box, role.lower())


def said(page: Page) -> Locator:
    return page.get_by_role("status", name="Map announcements")


def notices(page: Page) -> Locator:
    return page.get_by_role("region", name="Notices")


def canvas(page: Page) -> Locator:
    return page.get_by_role("region", name="Canvas")


def stage(page: Page) -> Locator:
    return canvas(page).locator("[data-zoom]")


def tool(page: Page, name: str) -> Locator:
    return page.get_by_role("toolbar", name="Map tools").get_by_role("button", name=name, exact=True)


def outline(page: Page) -> Locator:
    return page.get_by_role("complementary", name="Outline").get_by_role("tree", name="Outline")


def row(page: Page, title: str) -> Locator:
    return outline(page).get_by_role("treeitem", name=re.compile("^" + re.escape(title)))


def at(loc: Locator, x: str, y: str) -> None:
    expect(loc).to_have_attribute("data-x", x)
    expect(loc).to_have_attribute("data-y", y)


def focus_topic(page: Page, tid: str) -> None:
    loc = topic(page, tid)
    loc.click()
    if not loc.evaluate("e => e === document.activeElement"):
        loc.focus()
    expect(loc).to_be_focused()


def commit(page: Page, text: str) -> None:
    page.keyboard.type(text)
    page.keyboard.press("Enter")


def typing(page: Page) -> dict:
    return page.evaluate("() => { const e = document.activeElement;"
                         " return {value: e ? e.value : null, start: e ? e.selectionStart : null, end: e ? e.selectionEnd : null}; }")


EMPTY_POINT = """(c) => {
  const r = c.getBoundingClientRect();
  for (const fy of [0.9, 0.5, 0.1, 0.7, 0.3]) for (const fx of [0.5, 0.1, 0.9, 0.3, 0.7]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy, e = document.elementFromPoint(x, y);
    if (e && c.contains(e) && !e.closest('[data-topic-id],button,a,input,select,textarea,[role=dialog],[role=menu],[aria-label=Minimap]')) return [x, y];
  }
  return null;
}"""
REVEAL_DRAGS = 8


def reveal(loc: Locator) -> None:
    page = loc.page
    for _ in range(REVEAL_DRAGS):
        box, cb = loc.bounding_box(), canvas(page).bounding_box()
        dx = cb["x"] + cb["width"] / 2 - box["x"] - box["width"] / 2
        dy = cb["y"] + cb["height"] / 2 - box["y"] - box["height"] / 2
        if abs(dx) + box["width"] / 2 <= cb["width"] / 2 and abs(dy) + box["height"] / 2 <= cb["height"] / 2:
            break
        start = canvas(page).evaluate(EMPTY_POINT)
        assert start, "the canvas has an empty point to drag"
        x = min(max(start[0] + dx, cb["x"] + 1), cb["x"] + cb["width"] - 1)
        y = min(max(start[1] + dy, cb["y"] + 1), cb["y"] + cb["height"] - 1)
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(x, y, steps=2)
        page.mouse.up()
    expect(loc).to_be_in_viewport()


def fit_view(page: Page) -> None:
    phone = page.viewport_size["width"] < 768
    if phone:
        page.get_by_role("button", name="Tools", exact=True).click()
    tool(page, "Fit to screen").click()
    if phone:
        page.keyboard.press("Escape")
    eventually(lambda: view(page)[0] < 1, "Fit to screen zooms out to show the whole map", page)


def save_version(page: Page) -> None:
    tool(page, "Save version").click()
    dialog = page.get_by_role("dialog")
    box = dialog.get_by_role("textbox")
    try:
        box.first.wait_for(state="visible", timeout=SAVE_NAME_WAIT_MS)
    except PlaywrightTimeoutError:
        return
    box.first.fill("Checkpoint")
    confirm = dialog.get_by_role("button", name=re.compile("save", re.IGNORECASE))
    if confirm.count():
        confirm.first.click()
    else:
        page.keyboard.press("Enter")


def view(page: Page) -> tuple[float, float, float]:
    s = stage(page)
    return float(s.get_attribute("data-zoom")), float(s.get_attribute("data-pan-x")), float(s.get_attribute("data-pan-y"))


def focus_inside(page: Page, container: Locator) -> bool:
    return container.evaluate("e => e.contains(document.activeElement)")


class Touch:

    def __init__(self, page: Page):
        self.cdp = session(page)
        self.cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})

    def _send(self, kind: str, points: tuple) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [
            {"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})

    def start(self, *points: tuple[float, float]) -> None:
        self._send("touchStart", points)

    def move(self, *points: tuple[float, float]) -> None:
        self._send("touchMove", points)

    def end(self) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def lift_after_hold(self) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchCancel", "touchPoints": []})

    def tap(self, loc: Locator) -> None:
        self.start(center(loc))
        self.end()


def long_press(page: Page, touch: Touch, loc: Locator) -> Locator:
    reveal(loc)
    touch.start(center(loc))
    advance(page, LONG_PRESS_MS)
    touch.lift_after_hold()
    menu = page.get_by_role("menu", name="Topic actions")
    expect(menu).to_be_visible()
    return menu


def open_details(page: Page, touch: Touch, tid: str) -> Locator:
    long_press(page, touch, topic(page, tid)).get_by_role("menuitem", name="Open details").click()
    sheet = page.get_by_role("dialog", name="Topic")
    expect(sheet).to_be_visible()
    return sheet


ANIMATION_HOOK = """() => {
  if (window.__anims) return;
  window.__anims = [];
  const keep = a => { if (a && !window.__anims.includes(a)) window.__anims.push(a); return a; };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { return keep(animate.apply(this, args)); };
  const play = Animation.prototype.play;
  Animation.prototype.play = function (...args) { keep(this); return play.apply(this, args); };
}"""
READ_ANIMS = """(ids) => (window.__anims || []).filter(a => ids.includes(a.id)).map(a => {
  const t = a.effect && a.effect.target; const timing = a.effect.getTiming();
  return {id: a.id, topic: t && t.getAttribute('data-topic-id'), connector: t && t.getAttribute('data-connector'),
          duration: Number(timing.duration), delay: Number(timing.delay || 0),
          frames: a.effect.getKeyframes().map(k => ({transform: k.transform === undefined ? null : String(k.transform),
                                                     opacity: k.opacity === undefined ? null : String(k.opacity)}))};
})"""
ANIM_IDS = ["regrow-topic", "regrow-connector", "topic-enter", "toast-enter", "camera"]
TRANSLATE = re.compile(r"translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)")


def test_health_reports_storage(app_url):
    health = lambda base: httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    r = health(app_url)
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    with storage_down(app_url):
        r = health(app_url)
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}, r.text
    eventually(lambda: health(app_url).json() == {"status": "ok"}, "GET /api/health reports ok once storage is back")
    down = health(minio_down_url())
    assert down.status_code == 200 and down.json() == {"status": "unavailable"}, down.text


SETTING_ENV = {"toast_ms": "SPRIG_TOAST_MS", "presence_timeout_ms": "SPRIG_PRESENCE_TIMEOUT_MS",
               "virtual_from": "SPRIG_VIRTUAL_FROM", "dom_margin_px": "SPRIG_DOM_MARGIN_PX",
               "dom_ceiling": "SPRIG_DOM_CEILING"}


def test_settings_apply_on_page_timers(browser, app_url):
    w = setup(app_url)
    settings = Api(app_url, w.owner).map(w.id)["settings"]
    for key, env in SETTING_ENV.items():
        assert isinstance(settings[key], int), (key, settings)
        if env in os.environ:
            assert settings[key] == int(os.environ[env]), f"{key} reads {env} at boot"
    sentence = "The central topic can't be deleted."
    with editor(browser, app_url, w.owner, w.id) as page:
        focus_topic(page, "t-root")
        page.keyboard.press("Delete")
        expect(notices(page)).to_contain_text(sentence)
        advance(page, settings["toast_ms"] - 1)
        expect(notices(page)).to_contain_text(sentence)
        advance(page, 2)
        expect(notices(page)).not_to_contain_text(sentence)


NON_DEFAULT = {"SPRIG_GRADING": "1", "SPRIG_TOAST_MS": "1234", "SPRIG_PRESENCE_TIMEOUT_MS": "2222",
               "SPRIG_VIRTUAL_FROM": "50", "SPRIG_DOM_MARGIN_PX": "77", "SPRIG_DOM_CEILING": "60",
               "SPRIG_OP_WINDOW": "3", "SPRIG_UNDO_DEPTH": "2", "SPRIG_OP_RATE": "12",
               "SPRIG_SESSION_TTL_MS": "120000"}
TTL_SLACK_MS = 5000
GENERATED_TOPICS = 80


@pytest.mark.timeout(900)
def test_settings_non_default_values(browser):
    cfg = {k: int(v) for k, v in NON_DEFAULT.items() if k != "SPRIG_GRADING"}
    with app_copy(NON_DEFAULT) as (base, tail):
        w = setup(base, "editor", "editor", "editor")
        a, b, c = w.users
        settings = Api(base, w.owner).map(w.id)["settings"]
        for key, env in SETTING_ENV.items():
            assert settings[key] == cfg[env], f"{key} reads {env}: {settings}\n{tail()}"
        ua = Api(base, a)
        for i in range(cfg["SPRIG_OP_WINDOW"] + 1):
            assert ua.ops(w.id, op("style", topic_id="t-stalls", icon="star" if i % 2 else "flag")).status_code == 200
        current = ua.revision(w.id)
        err(ua.ops(w.id, op("style", topic_id="t-music", icon="pin"), base=current - cfg["SPRIG_OP_WINDOW"] - 1), 409, "stale_base")
        assert ua.ops(w.id, op("style", topic_id="t-music", icon="pin"), base=current - cfg["SPRIG_OP_WINDOW"]).status_code == 200
        ub = Api(base, b)
        for tid in ("t-budget", "t-vol", "t-afternoon"):
            assert ub.ops(w.id, op("style", topic_id=tid, icon="star")).status_code == 200
        statuses = [ub.post(f"/api/maps/{w.id}/undo").json()["status"] for _ in range(3)]
        assert statuses == ["undone", "undone", "empty"], "the undo stack keeps only SPRIG_UNDO_DEPTH groups"
        uc = Api(base, c)
        for i in range(cfg["SPRIG_OP_RATE"]):
            assert uc.ops(w.id, op("style", topic_id="t-morning", icon="star" if i % 2 else "flag")).status_code == 200
        err(uc.ops(w.id, op("style", topic_id="t-morning", icon="bulb")), 429, "rate_limited")
        user = uname("s")
        cl = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        assert cl.post("/api/auth/signup", json={"username": user, "password": PASSWORD}).status_code == 201
        me = cl.get("/api/me").json()
        ttl = (instant(me["session_expires_at"]) - instant(me["server_time"])).total_seconds() * 1000
        assert abs(ttl - cfg["SPRIG_SESSION_TTL_MS"]) <= TTL_SLACK_MS
        big = setup(base, root=node("t-root", "x"), generate={"topics": GENERATED_TOPICS, "fanout": 4})
        with editor(browser, base, big.owner, big.id, root="g0") as page:
            shown = tree(page).get_by_role("treeitem").count()
            assert shown <= cfg["SPRIG_DOM_CEILING"] and shown < GENERATED_TOPICS
        sentence = "The central topic can't be deleted."
        with editor(browser, base, w.owner, w.id) as page:
            focus_topic(page, "t-root")
            page.keyboard.press("Delete")
            expect(notices(page)).to_contain_text(sentence)
            advance(page, cfg["SPRIG_TOAST_MS"] - 1)
            expect(notices(page)).to_contain_text(sentence)
            advance(page, 2)
            expect(notices(page)).not_to_contain_text(sentence)


GRADING_ROUTES = ["/api/grading/seed", "/api/grading/session", "/api/grading/clock",
                  "/api/grading/maps/m1/ops", "/api/grading/storage"]


def test_grading_routes_on_and_off(app_url):
    owner = uname("o")
    key = gid("k")
    body = seed(app_url, [owner], [{"key": key, "owner": owner, "root": node("t-root", "Ignored"),
                                    "generate": {"topics": 7, "fanout": 2}}])
    assert set(body["users"]) == {owner}
    mid = body["maps"][key]["id"]
    api = Api(app_url, owner)
    me = api.get("/api/me").json()
    assert me["user"]["username"] == owner
    data = api.map(mid)
    assert data["map"]["revision"] == 1
    topics = {t["id"]: t for t in data["topics"]}
    assert topics["g0"]["title"] == "Generated map" and len(topics) == 7
    assert kids(topics, "g0") == ["g1", "g2"] and kids(topics, "g1") == ["g3", "g4"]
    assert topics["g3"]["title"] == "Topic 3"
    t0 = instant(me["server_time"])
    t1 = instant(clock(app_url, 1000))
    assert (t1 - t0).total_seconds() * 1000 >= 1000
    applied = as_user(app_url, mid, owner, op("title", topic_id="g3", offset=0, delete=0, insert="My "), base=1)
    assert applied["status"] == "applied" and applied["revision"] == 2
    assert api.topics(mid)["g3"]["title"] == f"My {topics['g3']['title']}"
    with storage_down(app_url):
        pass
    with app_copy({}, drop=("SPRIG_GRADING",)) as (base, tail):
        for path in GRADING_ROUTES:
            r = httpx.post(f"{base}{path}", json={"username": owner}, timeout=HTTP_TIMEOUT)
            assert r.status_code == 404 and r.json()["error"] == "not_found", f"{path} with grading off: {r.text}\n{tail()}"


def test_accounts_sessions_and_expiry(browser, app_url):
    user = uname("s")
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = c.post("/api/auth/signup", json={"username": user, "password": PASSWORD})
    assert r.status_code == 201 and r.json()["user"]["username"] == user, r.text
    cookie = r.headers.get("set-cookie", "").lower()
    assert "sprig_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    assert "Secure".lower() not in cookie.replace("HttpOnly".lower(), "")
    assert c.get("/api/me").json()["user"]["username"] == user
    err(httpx.post(f"{app_url}/api/auth/signup", json={"username": user, "password": PASSWORD}), 409, "username_taken")
    bad = err(httpx.post(f"{app_url}/api/auth/signup", json={"username": "AB", "password": PASSWORD}), 422, "invalid")
    assert "username" in bad["fields"]
    short = err(httpx.post(f"{app_url}/api/auth/signup", json={"username": uname("s"), "password": "short"}), 422, "invalid")
    assert "password" in short["fields"]
    err(httpx.post(f"{app_url}/api/auth/login", json={"username": user, "password": "wrong-pass-9"}), 401, "bad_credentials")
    assert c.post("/api/auth/logout").status_code == 204
    err(c.get("/api/me"), 401, "unauthenticated")
    assert c.post("/api/auth/login", json={"username": user, "password": PASSWORD}).status_code == 200
    me = c.get("/api/me").json()
    ttl_ms = (instant(me["session_expires_at"]) - instant(me["server_time"])).total_seconds() * 1000
    assert ttl_ms > 0
    clock(app_url, int(ttl_ms) + 1000)
    err(c.get("/api/me"), 401, "session_expired")

    with browse(browser, app_url, None, "/signup") as page:
        page.get_by_label("Username").fill("AB")
        page.get_by_label("Password").fill("short")
        page.get_by_role("button", name="Create account").click()
        expect(shown(page, "Username must be 3 to 24 characters: lowercase letters, digits or underscores.")).to_be_visible()
        expect(shown(page, "Password must be at least 8 characters.")).to_be_visible()
        page.get_by_label("Username").fill(user)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Create account").click()
        expect(shown(page, "That username is taken.")).to_be_visible()
        page.goto(f"{app_url}/signin")
        page.get_by_label("Username").fill(user)
        page.get_by_label("Password").fill("wrong-pass-9")
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(shown(page, "Wrong username or password.")).to_be_visible()
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in", exact=True).click()
        eventually(lambda: page.request.get(f"{app_url}/api/me").status == 200, "the sign-in form signs the person in")


@pytest.mark.timeout(600)
def test_sign_in_rate_limit():
    with app_copy({"SPRIG_LOGIN_RATE": str(RATE_PROBE), "SPRIG_GRADING": "1"}) as (base, _tail):
        sign_in_limit_checks(base, RATE_PROBE)


def sign_in_limit_checks(app_url: str, limit: int) -> None:
    user, other = uname("r"), uname("r")
    seed(app_url, [user, other], [])
    attempts = 0
    for _ in range(LOGIN_PROBES):
        r = httpx.post(f"{app_url}/api/auth/login", json={"username": user, "password": "wrong-pass-9"}, timeout=HTTP_TIMEOUT)
        if r.status_code == 429:
            break
        assert r.status_code == 401, r.text
        attempts += 1
    else:
        pytest.fail("POST /api/auth/login refuses with 429 once the per-username limit is reached")
    err(r, 429, "rate_limited")
    assert re.fullmatch(r"\d+", r.headers.get("retry-after", "")), "Retry-After in whole seconds"
    assert attempts == limit
    err(httpx.post(f"{app_url}/api/auth/login", json={"username": user, "password": PASSWORD}), 429, "rate_limited")
    assert httpx.post(f"{app_url}/api/auth/login", json={"username": other, "password": PASSWORD}).status_code == 200
    clock(app_url, MINUTE_MS)
    assert httpx.post(f"{app_url}/api/auth/login", json={"username": user, "password": PASSWORD}).status_code == 200


def test_error_shape_and_precedence(app_url):
    w = setup(app_url, "editor", "viewer")
    ed, viewer = w.users
    stranger = uname("x")
    seed(app_url, [stranger], [])
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    big = b'{"title":"' + b"x" * JSON_LIMIT + b'"}'
    r = anon.post("/api/maps", content=big, headers={"content-type": "application/json"})
    err(r, 413, "too_large")
    assert "application/json" in r.headers["content-type"]
    err(anon.get(f"/api/maps/{w.id}"), 401, "unauthenticated")
    err(Api(app_url, stranger).get(f"/api/maps/{w.id}"), 404, "not_found")
    e = Api(app_url, ed)
    first_op = op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big ")
    group = {"group_id": gid(), "base_revision": 1, "ops": [first_op]}
    first = e.post(f"/api/maps/{w.id}/ops", group)
    assert first.status_code == 200 and first.json()["replayed"] is False, first.text
    owner = Api(app_url, w.owner)
    assert owner.put(f"/api/maps/{w.id}/members/{ed}", {"role": "viewer"}).status_code == 200
    again = e.post(f"/api/maps/{w.id}/ops", group)
    assert again.status_code == 200 and again.json()["replayed"] is True
    assert again.json()["revision"] == first.json()["revision"]
    rev = owner.revision(w.id)
    junk = {"op_id": gid(), "kind": "no_such_kind"}
    err(Api(app_url, viewer).post(f"/api/maps/{w.id}/ops", {"group_id": gid(), "base_revision": rev, "ops": [junk]}), 403, "forbidden")
    err(owner.post(f"/api/maps/{w.id}/ops", {"group_id": gid(), "base_revision": rev, "ops": [first_op, junk]}), 409, "op_id_reused")
    err(owner.post(f"/api/maps/{w.id}/ops", {"group_id": gid(), "base_revision": rev, "ops": [junk]}), 422, "invalid")
    assert owner.revision(w.id) == rev


NEVER_SERVED = ["/run.json", "/package.json", "/.env", "/package-lock.json", "/.gitignore", "/src/server.ts"]


def test_server_boundary(app_url):
    for path in NEVER_SERVED:
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path
    home = httpx.get(f"{app_url}/", timeout=HTTP_TIMEOUT)
    csp = home.headers.get("content-security-policy", "")
    assert csp, "responses carry a content security policy"
    for source in re.findall(r"https?://[^\s;]+", csp):
        assert same_origin(source, app_url), f"CSP allows a foreign source {source}"
    owner = uname("o")
    seed(app_url, [owner], [])
    api = Api(app_url, owner)
    evil = "http://evil.example"
    title = gid("Evil")
    err(api.post("/api/maps", {"title": title, "template": None}, headers={"Origin": evil}), 403, "forbidden")
    assert title not in [m["title"] for m in api.get("/api/maps").json()["maps"]]
    origin = re.match(r"https?://[^/]+", app_url).group(0)
    assert api.post("/api/maps", {"title": gid("Ok"), "template": None}, headers={"Origin": origin}).status_code == 201
    mid = api.get("/api/maps").json()["maps"][0]["id"]
    ws = api.get(f"/api/maps/{mid}/live", headers={"Connection": "Upgrade", "Upgrade": "websocket",
                                                   "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                                                   "Origin": evil})
    assert ws.status_code == 403, "a cross-origin WebSocket upgrade is refused"
    prefix = b'{"title":"Pad","template":null}'
    exact = prefix + b" " * (JSON_LIMIT - len(prefix))
    assert len(exact) == JSON_LIMIT
    r = api.post("/api/maps", content=exact, headers={"content-type": "application/json"})
    assert r.status_code == 201, f"exactly {JSON_LIMIT} bytes is allowed: {r.status_code}"
    err(api.post("/api/maps", content=exact + b" ", headers={"content-type": "application/json"}), 413, "too_large")


@pytest.mark.timeout(600)
def test_database_unreachable_at_boot():
    with app_copy({"DATABASE_URL": "postgres://sprig:none@127.0.0.1:9/none"}) as (base, tail):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and r.json() == {"status": "starting"}, f"{r.status_code} {r.text}\n{tail()}"


TEMPLATE_CASES = {
    "blank": (None, "Blank", [], 1),
    "street-fair": ("street-fair", "Street fair", ["Stalls", "Music stage", "Volunteers and rotas", "Budget"], 7),
    "exam-revision": ("exam-revision", "Exam revision", ["Biology", "History", "Maths", "Past papers"], 7),
    "house-move": ("house-move", "House move", ["Boxes", "Utilities", "Change of address", "Moving day"], 5),
}


@pytest.mark.parametrize("case", list(TEMPLATE_CASES), ids=["blank", "street-fair", "exam-revision", "house-move"])
def test_map_list_and_templates(browser, app_url, case):
    slug, radio, children, count = TEMPLATE_CASES[case]
    owner = uname("o")
    seed(app_url, [owner], [])
    api = Api(app_url, owner)
    idea = gid("Idea ")
    with browse(browser, app_url, owner, "/maps") as page:
        expect(shown(page, "You have no maps yet. Start one from a central idea.")).to_be_visible()
        olds = [gid("Old ") for _ in range(3)]
        for title in olds:
            assert api.post("/api/maps", {"title": title, "template": None}).status_code == 201
        page.reload()
        expect(page.get_by_role("heading", name="Your maps")).to_be_visible()
        opener = page.get_by_role("button", name="New map")
        opener.click()
        dialog = page.get_by_role("dialog", name="New map")
        dialog.get_by_role("textbox", name="Central idea").fill(idea)
        dialog.get_by_role("radiogroup", name="Start from").get_by_role("radio", name=radio, exact=True).check()
        dialog.get_by_role("button", name="Create map").click()
        expect(page).to_have_url(re.compile(r"/m/[^/?]+"))
        expect(item(page, idea)).to_be_visible()
        for child in children:
            expect(item(page, child)).to_be_visible()
        if not children:
            expect(shown(page, "Press Tab to add the first branch.")).to_be_visible()
        made = next(m for m in api.get("/api/maps").json()["maps"] if m["title"] == idea)
        assert made["topic_count"] == count and made["role"] == "owner"
        topics = api.topics(made["id"])
        if slug == "exam-revision":
            maths = next(t for t in topics.values() if t["title"] == "Maths")
            assert maths["task"] is not None and maths["task"]["percent"] == 0
        page.goto(f"{app_url}/maps")
        ordered = [m["title"] for m in api.get("/api/maps").json()["maps"]]
        recent = page.get_by_role("region", name="Recent maps")
        for title in ordered[:3]:
            expect(recent).to_contain_text(title)
        expect(recent).not_to_contain_text(ordered[3])
        grid = page.get_by_role("list", name="All maps")
        for title in ordered:
            expect(grid.get_by_role("link", name=title)).to_be_visible()
        card = grid.get_by_role("listitem").filter(has_text=idea)
        before = decode(capture(card))
        root_id = next(t["id"] for t in topics.values() if t["parent_id"] is None)
        previous = None
        for _ in range(4):
            tid = gid("t")
            grown = api.ops(made["id"], op("add", topic_id=tid, parent_id=root_id, after=previous, title="Branch"))
            assert grown.status_code == 200, grown.text
            previous = tid
        page.reload()
        card = page.get_by_role("list", name="All maps").get_by_role("listitem").filter(has_text=idea)
        expect(card).to_be_visible()
        assert difference(before, decode(capture(card))) > 0, "the map card miniature renders the map's topics"


def test_dialogs_trap_focus_and_close(browser, app_url):
    w = setup(app_url)
    with editor(browser, app_url, w.owner, w.id) as page:
        for opener_name in ("Share", "History", "Export", "Import outline"):
            opener = tool(page, opener_name)
            opener.click()
            dialog = page.get_by_role("dialog", name=opener_name)
            expect(dialog).to_be_visible()
            assert focus_inside(page, dialog), f"{opener_name} moves focus inside on open"
            for key in ("Tab", "Shift+Tab"):
                for _ in range(TAB_PRESSES):
                    page.keyboard.press(key)
                    assert focus_inside(page, dialog), f"{key} stays inside dialog {opener_name}"
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(opener).to_be_focused()
        tool(page, "Share").click()
        share = page.get_by_role("dialog", name="Share", exact=True)
        for name in ("Owner", "Editor", "Commenter", "Viewer"):
            expect(share.get_by_role("button", name=name, exact=True)).to_be_visible()
        rows_before = share.get_by_role("listitem").count()
        share.get_by_role("button", name="Editor", exact=True).click()
        eventually(lambda: share.get_by_role("listitem").count() >= rows_before + 3,
                   "an opened share role row shows its three-item checklist", page)
        opened = share.get_by_role("listitem").count()
        share.get_by_role("button", name="Editor", exact=True).click()
        eventually(lambda: share.get_by_role("listitem").count() < opened,
                   "a closed share role row leaves the accessibility tree", page)
        page.keyboard.press("Escape")
        tool(page, "Import outline").click()
        help_rows = page.get_by_role("dialog", name="Import outline").get_by_role("button", expanded=False)
        assert help_rows.count() >= 6, "the text format help accordion has six or more closed question rows"
        page.keyboard.press("Escape")
    with editor(browser, app_url, w.owner, w.id, size=PHONE_SMALL) as page:
        undo = page.get_by_role("button", name="Undo", exact=True)
        expect(undo).to_be_hidden()
        assert "Undo" not in tab_order(page, TAB_PRESSES)
        tools = page.get_by_role("button", name="Tools", exact=True)
        tools.click()
        expect(page.get_by_role("toolbar", name="Map tools")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("toolbar", name="Map tools")).to_be_hidden()
        expect(tools).to_be_focused()
        opener = page.get_by_role("button", name="Outline", exact=True)
        opener.click()
        sheet = page.get_by_role("dialog", name="Outline")
        expect(sheet).to_be_visible()
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            assert focus_inside(page, sheet)
        page.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()


def test_mind_map_layout_worked_examples(browser, app_url):
    w = setup(app_url, "editor")
    with editor(browser, app_url, w.owner, w.id) as page:
        for tid, (x, y, wd, h, side) in MIND.items():
            loc = topic(page, tid)
            at(loc, x, y)
            expect(loc).to_have_attribute("data-w", wd)
            expect(loc).to_have_attribute("data-h", h)
            expect(loc).to_have_attribute("data-side", side)
        as_user(app_url, w.id, w.users[0], op("add", topic_id="t-permits", parent_id="t-root", after="t-stalls", title="Permits"))
        for tid, (x, y, side) in REBALANCED.items():
            at(topic(page, tid), x, y)
            expect(topic(page, tid)).to_have_attribute("data-side", side)
        as_user(app_url, w.id, w.owner, op("add", topic_id="t-long", parent_id="t-stalls", after=None,
                                           title="Abcdefghijklmnopqrstuvwxyz"))
        expect(topic(page, "t-long")).to_have_attribute("data-h", str(TOPIC_H + LINE_H))
        expect(topic(page, "t-long")).to_have_attribute("data-w", str(TOPIC_W))
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-root", offset=11, delete=0,
                                           insert=" and summer market day"))
        expect(topic(page, "t-root")).to_have_attribute("data-h", str(ROOT_H + LINE_H))
        expect(topic(page, "t-root")).to_have_attribute("data-w", str(ROOT_W))


def test_topic_keys(browser, app_url):
    w = setup(app_url, root=node("t-root", "Plan"))
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        prompt = page.get_by_text("Press Tab to add the first branch.")
        expect(prompt).to_be_visible()
        focus_topic(page, "t-root")
        page.keyboard.press("Tab")
        state = typing(page)
        assert state["value"] == "New topic" and state["start"] == 0 and state["end"] == len("New topic")
        commit(page, "Alpha")
        expect(item(page, "Alpha")).to_be_focused()
        expect(item(page, "Alpha")).to_have_accessible_name(re.compile(r"^Alpha, level 2, 1 of 1"))
        expect(prompt).to_be_hidden()
        page.keyboard.press("Enter")
        page.keyboard.press("Escape")
        expect(item(page, "New topic")).to_be_focused()
        page.keyboard.press("F2")
        state = typing(page)
        assert state["start"] == state["end"] == len("New topic")
        commit(page, "X")
        expect(item(page, "New topicX")).to_be_focused()
        page.keyboard.press("Z")
        assert typing(page)["value"] == "Z"
        commit(page, "eta")
        expect(item(page, "Zeta")).to_be_focused()
        page.keyboard.press("F2")
        page.keyboard.type("junk")
        page.keyboard.press("Escape")
        expect(item(page, "Zeta")).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(item(page, "Alpha")).to_be_focused()
        page.keyboard.press("Enter")
        commit(page, "Mid")
        expect(item(page, "Mid")).to_be_focused()
        eventually(lambda: [api.topics(w.id)[t]["title"] for t in kids(api.topics(w.id), "t-root")] == ["Alpha", "Mid", "Zeta"],
                   "keyboard-created topics reach the server in order", page)
        page.keyboard.press("Delete")
        expect(item(page, "Zeta")).to_be_focused()
        page.keyboard.press("Delete")
        expect(item(page, "Alpha")).to_be_focused()
        page.keyboard.press("Delete")
        expect(topic(page, "t-root")).to_be_focused()
        page.keyboard.press("Delete")
        expect(said(page)).to_contain_text("The central topic can't be deleted.")
        eventually(lambda: list(api.topics(w.id)) == ["t-root"], "Delete removed every branch on the server", page)


def test_arrow_navigation(browser, app_url):
    w = setup(app_url)
    with editor(browser, app_url, w.owner, w.id) as page:
        def go(key: str, tid: str) -> None:
            page.keyboard.press(key)
            expect(topic(page, tid)).to_be_focused()
        focus_topic(page, "t-root")
        go("ArrowRight", "t-stalls")
        go("ArrowRight", "t-stalls")
        go("ArrowDown", "t-music")
        go("ArrowLeft", "t-music")
        go("ArrowRight", "t-root")
        go("ArrowLeft", "t-music")
        go("ArrowUp", "t-stalls")
        go("ArrowUp", "t-stalls")
        focus_topic(page, "t-vol")
        go("ArrowRight", "t-morning")
        go("ArrowDown", "t-afternoon")
        go("ArrowDown", "t-afternoon")
        go("ArrowLeft", "t-vol")
        go("Home", "t-root")
        go("End", "t-budget")
        as_user(app_url, w.id, w.owner, op("layout", layout="org"))
        expect(stage(page)).to_have_attribute("data-layout", "org")
        focus_topic(page, "t-root")
        go("ArrowDown", "t-stalls")
        go("ArrowRight", "t-music")
        go("ArrowLeft", "t-stalls")
        go("ArrowUp", "t-root")
        as_user(app_url, w.id, w.owner, op("layout", layout="list"))
        expect(stage(page)).to_have_attribute("data-layout", "list")
        focus_topic(page, "t-root")
        for tid in ("t-stalls", "t-music", "t-vol", "t-morning"):
            go("ArrowDown", tid)
        go("ArrowLeft", "t-vol")
        page.keyboard.press("Space")
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "false")
        expect(topic(page, "t-vol")).to_be_focused()
        go("ArrowRight", "t-vol")
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "true")
        expect(topic(page, "t-morning")).to_be_visible()


def test_tree_semantics_and_label_grammar(browser, app_url):
    o = uname("o")
    root = node("t-root", "Street fair",
                node("t-stalls", "Stalls", task=task(50), locked_by=o),
                node("t-music", "Music stage"),
                node("t-budget", "Budget", node("t-tables", "Tables", node("t-legs", "Legs")),
                     node("t-chairs", "Chairs"), node("t-tents", "Tents")),
                node("t-extras", "Extras"), node("t-signs", "Signs"))
    w = setup(app_url, owner=o, root=root, floating=[{"id": "f1", "title": "Ideas", "x": 0, "y": 300, "children": []}],
              comments=[{"id": gid("c"), "topic_id": "t-budget", "author": o, "body": "Cap it?", "resolved": False,
                         "replies": [{"id": gid("c"), "author": o, "body": "Yes."}]}],
              votes=[{"topic_id": "t-music", "username": o}])
    api = Api(app_url, o)
    assert api.put(f"/api/maps/{w.id}/collapse", {"topic_id": "t-budget", "collapsed": True}).status_code == 204
    with editor(browser, app_url, o, w.id) as page:
        assert page.evaluate("() => document.activeElement !== document.body")
        expect(topic(page, "t-budget")).to_have_accessible_name("Budget, level 2, 3 of 5, 4 subtopics, collapsed, 2 comments")
        expect(topic(page, "t-stalls")).to_have_accessible_name(label("Stalls", 2, 1, 5, f"{50}% done", "locked"))
        expect(topic(page, "t-music")).to_have_accessible_name(label("Music stage", 2, 2, 5, "1 vote"))
        items = tree(page).get_by_role("treeitem")
        assert items.evaluate_all("els => els.filter(e => e.tabIndex === 0).length") == 1
        for tid, level, pos, size in (("t-root", "1", "1", "2"), ("f1", "1", "2", "2"), ("t-signs", "2", "5", "5")):
            loc = topic(page, tid)
            expect(loc).to_have_attribute("aria-level", level)
            expect(loc).to_have_attribute("aria-posinset", pos)
            expect(loc).to_have_attribute("aria-setsize", size)
        expect(topic(page, "t-budget")).to_have_attribute("aria-expanded", "false")
        expect(topic(page, "t-root")).to_have_attribute("aria-expanded", "true")
        assert topic(page, "t-signs").get_attribute("aria-expanded") is None
        expect(topic(page, "t-tables")).to_have_count(0)
        focus_topic(page, "t-budget")
        page.keyboard.press("Space")
        expect(topic(page, "t-tables")).to_have_attribute("aria-level", "3")
        expect(topic(page, "t-tables")).to_have_attribute("aria-setsize", "3")
        expect(topic(page, "t-tables")).to_have_attribute("aria-expanded", "true")
        assert items.evaluate_all("els => els.filter(e => e.tabIndex === 0).length") == 1


def test_keyboard_moves_and_pins(browser, app_url):
    w = setup(app_url, root=fair(**{"t-music": {"children": [node("t-sound", "Sound check")]}}))
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        focus_topic(page, "t-budget")
        page.keyboard.press("Alt+ArrowUp")
        expect(said(page)).to_contain_text("Budget is now 3 of 4 under Street fair.")
        expect(topic(page, "t-budget")).to_be_focused()
        expect(topic(page, "t-budget")).to_have_attribute("data-side", "right")
        page.keyboard.press("Alt+ArrowLeft")
        expect(topic(page, "t-budget")).to_have_attribute("data-side", "left")
        eventually(lambda: api.topics(w.id)["t-budget"]["side_pin"] == "left", "the pin is stored", page)
        focus_topic(page, "t-music")
        page.keyboard.press("Space")
        expect(topic(page, "t-music")).to_have_attribute("aria-expanded", "false")
        focus_topic(page, "t-budget")
        page.keyboard.press("Alt+ArrowLeft")
        expect(said(page)).to_contain_text("Budget is now 2 of 2 under Music stage.")
        expect(topic(page, "t-music")).to_have_attribute("aria-expanded", "true")
        expect(topic(page, "t-budget")).to_be_focused()
        side = topic(page, "t-budget").get_attribute("data-side")
        page.keyboard.press("Alt+ArrowLeft" if side == "right" else "Alt+ArrowRight")
        expect(said(page)).to_contain_text("Budget is now 3 of 4 under Street fair.")
        focus_topic(page, "t-stalls")
        topics = eventually(lambda: (lambda t: t if kids(t, "t-root") == ["t-stalls", "t-music", "t-budget", "t-vol"] else None)(api.topics(w.id)),
                            "Budget sits third under the root on the server", page)
        assert topics["t-budget"]["parent_id"] == "t-root"
        rev = api.revision(w.id)
        page.keyboard.press("Alt+ArrowUp")
        expect(said(page)).to_contain_text("Stalls can't move that way.")
        assert api.revision(w.id) == rev


def test_multi_select_one_group(browser, app_url):
    w = setup(app_url)
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        focus_topic(page, "t-stalls")
        topic(page, "t-budget").click(modifiers=["Control"])
        expect(said(page)).to_contain_text("2 topics selected.")
        page.keyboard.press("ArrowDown")
        expect(tree(page).locator('[aria-selected="true"]')).to_have_count(0)
        focus_topic(page, "t-stalls")
        page.keyboard.press("Shift+ArrowDown")
        expect(said(page)).to_contain_text("2 topics selected.")
        page.keyboard.press("Shift+ArrowDown")
        expect(said(page)).to_contain_text("3 topics selected.")
        expect(topic(page, "t-vol")).to_be_focused()
        for tid in ("t-stalls", "t-music", "t-vol"):
            expect(topic(page, tid)).to_have_attribute("aria-selected", "true")
        rev = api.revision(w.id)
        page.keyboard.press("Delete")
        eventually(lambda: set(api.topics(w.id)) == {"t-root", "t-budget"}, "all selected branches deleted", page)
        assert api.revision(w.id) == rev + 1
        entries = api.get(f"/api/maps/{w.id}/activity").json()["entries"]
        assert entries[0]["sentence"] == f"{w.owner} deleted 3 topics"
        page.keyboard.press("Control+z")
        eventually(lambda: set(api.topics(w.id)) == set(TITLES), "one undo restores every selected branch", page)
        assert api.revision(w.id) == rev + 2


def test_wf_keyboard_build_happy(browser, app_url):
    w = setup(app_url, root=node("t-root", "Street fair"))
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        focus_topic(page, "t-root")
        page.keyboard.press("Tab")
        commit(page, "Stalls")
        for title in ("Music stage", "Volunteers and rotas"):
            page.keyboard.press("Enter")
            commit(page, title)
        page.keyboard.press("Tab")
        commit(page, "Morning shift")
        page.keyboard.press("Enter")
        commit(page, "Afternoon shift")
        page.keyboard.press("ArrowLeft")
        expect(item(page, "Volunteers and rotas")).to_be_focused()
        page.keyboard.press("Enter")
        commit(page, "Budget")
        expect(item(page, "Budget")).to_be_focused()
        for tid, (x, y, wd, h, side) in MIND.items():
            loc = topic(page, "t-root") if tid == "t-root" else item(page, TITLES[tid])
            at(loc, x, y)
            expect(loc).to_have_attribute("data-h", h)
            expect(loc).to_have_attribute("data-side", side)
        item(page, "Stalls").click()
        page.keyboard.press("Enter")
        commit(page, "Permits")
        for tid, (x, y, side) in REBALANCED.items():
            loc = item(page, "Permits") if tid == "t-permits" else item(page, TITLES[tid])
            at(loc, x, y)
            expect(loc).to_have_attribute("data-side", side)
        page.keyboard.press("Alt+ArrowDown")
        expect(said(page)).to_contain_text("Permits is now 3 of 5 under Street fair.")
        expect(item(page, "Permits")).to_be_focused()
        expect(item(page, "Permits")).to_have_attribute("data-side", "right")
        page.keyboard.press("Alt+ArrowLeft")
        expect(item(page, "Permits")).to_have_attribute("data-side", "left")

        def built() -> bool:
            t = api.topics(w.id)
            titles = [t[i]["title"] for i in kids(t, "t-root")]
            permits = next(x for x in t.values() if x["title"] == "Permits")
            vol = next(x for x in t.values() if x["title"] == "Volunteers and rotas")
            return (titles == ["Stalls", "Music stage", "Permits", "Volunteers and rotas", "Budget"]
                    and permits["side_pin"] == "left"
                    and [t[i]["title"] for i in kids(t, vol["id"])] == ["Morning shift", "Afternoon shift"])
        eventually(built, "the keyboard-built map is stored on the server", page)


def test_wf_keyboard_build_readonly(browser, app_url):
    w = setup(app_url, "viewer")
    viewer = w.users[0]
    api = Api(app_url, w.owner)
    rev = api.revision(w.id)
    with editor(browser, app_url, viewer, w.id) as page:
        focus_topic(page, "t-stalls")
        for key in ("Tab", "Enter", "F2", "x", "Delete", "Alt+ArrowDown", "Alt+Enter", "Control+v", "Control+z"):
            page.keyboard.press(key)
            expect(said(page)).to_contain_text("You can view this map but not edit it.")
            expect(topic(page, "t-stalls")).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(topic(page, "t-music")).to_be_focused()
        focus_topic(page, "t-vol")
        page.keyboard.press("Space")
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "false")
    assert api.revision(w.id) == rev
    assert set(api.topics(w.id)) == set(TITLES)


def test_org_list_and_floating_layouts(browser, app_url):
    w = setup(app_url, layout="org", floating=[{"id": "f1", "title": "Ideas", "x": 0, "y": 300,
                                                 "children": [node("f1c", "Raffle")]}])
    with editor(browser, app_url, w.owner, w.id) as page:
        expect(stage(page)).to_have_attribute("data-layout", "org")
        for tid, (x, y) in ORG.items():
            at(topic(page, tid), x, y)
        at(topic(page, "f1"), "0", "300")
        at(topic(page, "f1c"), "0", str(300 + TOPIC_H // 2 + ORG_GAP + TOPIC_H // 2))
        layouts = page.get_by_role("radiogroup", name="Layout")
        themes = page.get_by_role("radiogroup", name="Theme")
        tiles = [layouts.get_by_role("radio", name=n) for n in ("Mind map", "Org chart", "List")]
        shades = [themes.get_by_role("radio", name=n) for n in ("Daylight", "Paper", "Dusk")]
        top = [t.bounding_box() for t in tiles]
        bottom = [t.bounding_box() for t in shades]
        assert len({round(b["y"]) for b in top}) == 1 and len({round(b["y"]) for b in bottom}) == 1
        assert bottom[0]["y"] > top[0]["y"] and len({round(b["x"]) for b in top}) == 3
        tiles[2].click()
        expect(stage(page)).to_have_attribute("data-layout", "list")
        for tid, (x, y) in LIST.items():
            at(topic(page, tid), x, y)
        float_top = int(LIST["t-budget"][1]) + TOPIC_H // 2 + LIST_GAP
        at(topic(page, "f1"), str(TOPIC_W // 2), str(float_top + TOPIC_H // 2))
        at(topic(page, "f1c"), str(LIST_INDENT + TOPIC_W // 2), str(float_top + TOPIC_H + LIST_GAP + TOPIC_H // 2))
        tiles[0].click()
        expect(stage(page)).to_have_attribute("data-layout", "map")
        at(topic(page, "f1"), "0", "300")
        expect(topic(page, "f1")).to_have_attribute("data-side", "none")
        at(topic(page, "f1c"), str(TOPIC_W // 2 + LEVEL_GAP + TOPIC_W // 2), "300")
        expect(topic(page, "f1c")).to_have_attribute("data-side", "right")
        focus_topic(page, "t-root")
        page.keyboard.press("Alt+Enter")
        fresh = item(page, "New topic")
        expect(fresh).to_be_visible()
        if typing(page)["value"] is not None:
            page.keyboard.press("Escape")
        at(fresh, "0", str(300 + TOPIC_H // 2 + FLOAT_DROP))
        expect(fresh).to_have_attribute("aria-level", "1")
        expect(fresh).to_have_attribute("aria-posinset", "3")


def test_regrow_and_published_animations(browser, app_url):
    w = setup(app_url)
    for motion in ("no-preference", "reduce"):
        with editor(browser, app_url, w.owner, w.id, reduced_motion=motion) as page:
            page.evaluate(ANIMATION_HOOK)
            zoom = view(page)[0]
            page.get_by_role("radiogroup", name="Layout").get_by_role("radio", name="Org chart").click()
            expect(stage(page)).to_have_attribute("data-layout", "org")
            for tid, (x, y) in ORG.items():
                at(topic(page, tid), x, y)
            focus_topic(page, "t-root")
            page.keyboard.press("Tab")
            page.keyboard.press("Escape")
            expect(item(page, "New topic")).to_be_visible()
            page.keyboard.press("Home")
            page.keyboard.press("Delete")
            expect(notices(page)).to_contain_text("The central topic can't be deleted.")
            records = page.evaluate(READ_ANIMS, ANIM_IDS)
            if motion == "reduce":
                assert records == [], f"no published animation runs under reduced motion: {records}"
                running = tree(page).get_by_role("treeitem").evaluate_all(
                    "els => els.reduce((n, e) => n + e.getAnimations().length, 0)")
                assert running == 0
            else:
                grow = {r["topic"]: r for r in records if r["id"] == "regrow-topic"}
                assert set(ORG) <= set(grow), f"every topic in the page regrows: {sorted(grow)}"
                for tid, (x, y) in ORG.items():
                    r = grow[tid]
                    assert r["duration"] == REGROW_MS and len(r["frames"]) == 2
                    dx, dy = (float(v) for v in TRANSLATE.search(r["frames"][0]["transform"]).groups())
                    assert abs(dx - (int(MIND[tid][0]) - int(x)) * zoom) <= COORD_SLACK
                    assert abs(dy - (int(MIND[tid][1]) - int(y)) * zoom) <= COORD_SLACK
                    assert [float(v) for v in TRANSLATE.search(r["frames"][1]["transform"]).groups()] == [0, 0]
                connectors = [r for r in records if r["id"] == "regrow-connector"]
                assert connectors and all(r["duration"] == CONNECTOR_MS and r["delay"] == REGROW_MS
                                          and [f["opacity"] for f in r["frames"]] == ["0", "1"] for r in connectors)
                enter = [r for r in records if r["id"] == "topic-enter"]
                assert enter and enter[-1]["duration"] == ENTER_MS
                assert [re.sub(r"\s", "", f["transform"]) for f in enter[-1]["frames"]] == ["scale(0.9)", "scale(1)"]
                toast = [r for r in records if r["id"] == "toast-enter"]
                assert toast and toast[-1]["duration"] == TOAST_ENTER_MS
                assert [f["opacity"] for f in toast[-1]["frames"]] == ["0", "1"]
            page.get_by_role("radiogroup", name="Layout").get_by_role("radio", name="Mind map").click()
            expect(stage(page)).to_have_attribute("data-layout", "map")
            focus_topic(page, "t-root")
            page.keyboard.press("End")
            leftovers = [op("delete", topic_id=t["id"]) for t in Api(app_url, w.owner).topics(w.id).values()
                         if t["title"] == "New topic"]
            if leftovers:
                as_user(app_url, w.id, w.owner, *leftovers)


def test_per_person_collapse(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        focus_topic(mine, "t-vol")
        mine.keyboard.press("Space")
        vol = topic(mine, "t-vol")
        expect(vol).to_have_attribute("aria-expanded", "false")
        expect(vol).to_be_focused()
        expect(vol).to_have_accessible_name(re.compile(r"^Volunteers and rotas, level 2, 3 of 4, 2 subtopics, collapsed"))
        expect(said(mine)).to_contain_text("Volunteers and rotas collapsed")
        for tid in ("t-morning", "t-afternoon"):
            expect(topic(mine, tid)).to_have_count(0)
            expect(row(mine, TITLES[tid])).to_have_count(0)
            expect(topic(theirs, tid)).to_be_visible()
        expect(topic(theirs, "t-vol")).to_have_attribute("aria-expanded", "true")
        eventually(lambda: Api(app_url, w.owner).map(w.id)["collapsed"] == ["t-vol"], "collapse is stored for me", mine)
        assert Api(app_url, ben).map(w.id)["collapsed"] == []
        as_user(app_url, w.id, ben, op("add", topic_id="t-evening", parent_id="t-vol", after="t-afternoon", title="Evening shift"))
        expect(vol).to_have_accessible_name(re.compile(r", 3 subtopics, collapsed"))
        expect(topic(theirs, "t-evening")).to_be_visible()
        mine.reload()
        expect(topic(mine, "t-vol")).to_have_attribute("aria-expanded", "false")
        expect(topic(mine, "t-morning")).to_have_count(0)
        expect(topic(theirs, "t-morning")).to_be_visible()


def test_cross_links_and_boundaries(browser, app_url):
    w = setup(app_url, "editor", links=[{"id": "l1", "from": "t-stalls", "to": "t-morning", "label": "", "type": "related"},
                                        {"id": "l2", "from": "t-morning", "to": "t-afternoon", "label": "", "type": "related"}],
              boundaries=[{"id": "b1", "topic_id": "t-vol", "label": ""}])
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as page:
        box = boundary_el(page, "b1")
        expect(box).to_have_attribute("data-w", str(640 - 200 + 2 * BOUNDARY_PAD))
        expect(box).to_have_attribute("data-h", str(64 + 16 + 2 * BOUNDARY_PAD))
        focus_topic(page, "t-vol")
        page.keyboard.press("Space")
        l1 = link_el(page, "t-stalls", "t-morning")
        expect(l1).to_have_attribute("data-drawn-to", "t-vol")
        expect(l1).to_have_attribute("data-drawn-from", "t-stalls")
        expect(link_el(page, "t-morning", "t-afternoon")).to_be_hidden()
        expect(box).to_have_attribute("data-w", str(TOPIC_W + 2 * BOUNDARY_PAD))
        expect(box).to_have_attribute("data-h", str(52 + 2 * BOUNDARY_PAD))
        page.keyboard.press("Space")
        as_user(app_url, w.id, ben, op("move", topic_id="t-morning", parent_id="t-stalls", after=None))
        expect(l1).to_have_attribute("data-drawn-to", "t-morning")
        api = Api(app_url, ben)
        assert api.ops(w.id, op("delete", topic_id="t-morning")).status_code == 200
        eventually(lambda: [l["id"] for l in api.map(w.id)["links"]] == [], "deleting an end removes its links")
        expect(l1).to_have_count(0)
        assert api.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
        eventually(lambda: sorted(l["id"] for l in api.map(w.id)["links"]) == ["l1", "l2"], "undo brings links back")
        expect(l1).to_have_attribute("data-drawn-to", "t-morning")
        as_user(app_url, w.id, ben, op("delete", topic_id="t-vol"))
        eventually(lambda: api.map(w.id)["boundaries"] == [], "a boundary is removed with its topic")
        expect(box).to_have_count(0)


def test_viewport_focus_branch_minimap(browser, app_url):
    w = setup(app_url, "editor")
    with editor(browser, app_url, w.owner, w.id) as page:
        cb = canvas(page).bounding_box()
        zoom, px, py = view(page)
        assert abs(zoom - 1) <= ZOOM_EPS
        assert abs(px - cb["width"] / 2) <= COORD_SLACK and abs(py - cb["height"] / 2) <= COORD_SLACK
        p = (cb["width"] / 2 + 100, cb["height"] - 60)
        page.mouse.move(cb["x"] + p[0], cb["y"] + p[1])
        page.keyboard.down("Control")
        page.mouse.wheel(0, -100)
        page.keyboard.up("Control")
        eventually(lambda: abs(view(page)[0] - WHEEL_STEP) <= ZOOM_EPS, "Ctrl+wheel up multiplies zoom by 1.1", page)
        z, nx, ny = view(page)
        assert abs(nx - (p[0] - (p[0] - px) * z / zoom)) <= COORD_SLACK
        assert abs(ny - (p[1] - (p[1] - py) * z / zoom)) <= COORD_SLACK
        tool(page, "Fit to screen").click()
        boxes = [(int(m[0]), int(m[1]), int(m[2]), int(m[3])) for m in MIND.values()]
        left = min(x - wd / 2 for x, _, wd, _ in boxes); right = max(x + wd / 2 for x, _, wd, _ in boxes)
        top = min(y - h / 2 for _, y, _, h in boxes); bottom = max(y + h / 2 for _, y, _, h in boxes)
        cb = canvas(page).bounding_box()
        fit = min(1, (cb["width"] - FIT_MARGIN) / (right - left), (cb["height"] - FIT_MARGIN) / (bottom - top))
        eventually(lambda: abs(view(page)[0] - fit) <= ZOOM_EPS, "Fit to screen uses the published fit rule", page)
        _, fx, fy = view(page)
        assert abs(fx - (cb["width"] / 2 - (left + right) / 2 * fit)) <= COORD_SLACK
        assert abs(fy - (cb["height"] / 2 - (top + bottom) / 2 * fit)) <= COORD_SLACK
        minimap = page.get_by_role("region", name="Minimap")
        _, mx, my = view(page)
        minimap.get_by_role("button", name="Visible area").focus()
        page.keyboard.press("ArrowRight")
        eventually(lambda: abs(abs(view(page)[1] - mx) - MINIMAP_STEP) <= COORD_SLACK, "minimap arrow moves 40 px", page)
        assert abs(view(page)[2] - my) <= COORD_SLACK
        focus_topic(page, "t-vol")
        page.keyboard.press("Control+Shift+F")
        expect(page).to_have_url(re.compile(r"focus=t-vol"))
        expect(topic(page, "t-stalls")).to_have_count(0)
        crumbs = page.get_by_role("navigation", name="Breadcrumb").get_by_role("link")
        expect(crumbs).to_have_text(["Street fair"])
        as_user(app_url, w.id, w.users[0], op("move", topic_id="t-vol", parent_id="t-stalls", after=None))
        expect(crumbs).to_have_text(["Street fair", "Stalls"])
        as_user(app_url, w.id, w.users[0], op("delete", topic_id="t-vol"))
        expect(notices(page)).to_contain_text("This branch was deleted. Showing the whole map.")
        expect(topic(page, "t-stalls")).to_be_visible()
        page.goto(f"{app_url}/m/{w.id}?topic=t-nope")
        expect(notices(page)).to_contain_text("That topic no longer exists.")
        expect(topic(page, "t-music")).to_be_visible()
        page.goto(f"{app_url}/m/{w.id}?topic=t-budget")
        expect(topic(page, "t-budget")).to_be_focused()
        expect(topic(page, "t-budget")).to_be_in_viewport()


def test_wf_layout_switch_together(browser, app_url):
    w = setup(app_url, "editor", links=[{"id": "l1", "from": "t-stalls", "to": "t-morning", "label": "", "type": "related"}])
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        theirs.evaluate(ANIMATION_HOOK)
        mine.get_by_role("radiogroup", name="Layout").get_by_role("radio", name="Org chart").click()
        for page in (mine, theirs):
            expect(stage(page)).to_have_attribute("data-layout", "org")
            for tid, (x, y) in ORG.items():
                at(topic(page, tid), x, y)
        grown = theirs.evaluate(READ_ANIMS, ["regrow-topic"])
        assert {r["topic"] for r in grown} >= set(ORG), "the co-editor's screen regrows too"
        expect(said(theirs)).to_contain_text(f"{w.owner} switched to Org chart")
        focus_topic(theirs, "t-vol")
        theirs.keyboard.press("Space")
        expect(link_el(theirs, "t-stalls", "t-morning")).to_have_attribute("data-drawn-to", "t-vol")
        expect(topic(mine, "t-morning")).to_be_visible()
        focus_topic(theirs, "t-stalls")
        theirs.keyboard.press("Control+Shift+F")
        expect(theirs.get_by_role("navigation", name="Breadcrumb").get_by_role("link")).to_have_text(["Street fair"])
        expect(topic(mine, "t-budget")).to_be_visible()
    assert Api(app_url, w.owner).map(w.id)["map"]["layout"] == "org"
    assert Api(app_url, w.owner).map(w.id)["collapsed"] == []
    assert Api(app_url, ben).map(w.id)["collapsed"] == ["t-vol"]


def test_wf_layout_switch_reduced_motion(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id, reduced_motion="reduce") as theirs:
        theirs.evaluate(ANIMATION_HOOK)
        mine.get_by_role("radiogroup", name="Layout").get_by_role("radio", name="List").click()
        expect(stage(theirs)).to_have_attribute("data-layout", "list")
        for tid, (x, y) in LIST.items():
            at(topic(theirs, tid), x, y)
        assert theirs.evaluate(READ_ANIMS, ANIM_IDS) == []
    assert Api(app_url, ben).map(w.id)["map"]["layout"] == "list"


def test_outline_view_two_way(browser, app_url):
    w = setup(app_url, "editor")
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        texts = outline(page).get_by_role("treeitem").all_inner_texts()
        order = [next(i for i, t in enumerate(texts) if t.strip().startswith(TITLES[tid])) for tid in LIST]
        assert order == sorted(order), f"outline rows follow list order: {texts}"
        music = row(page, "Music stage")
        music.click()
        page.keyboard.press("Tab")
        eventually(lambda: api.topics(w.id)["t-music"]["parent_id"] == "t-stalls", "Tab indents under the previous sibling", page)
        expect(topic(page, "t-music")).to_have_attribute("aria-level", "3")
        expect(row(page, "Music stage")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        eventually(lambda: kids(api.topics(w.id), "t-root")[:2] == ["t-stalls", "t-music"], "Shift+Tab outdents after the parent", page)
        expect(topic(page, "t-music")).to_have_attribute("aria-level", "2")
        page.keyboard.press("Enter")
        commit(page, NEW_BRANCH)
        expect(item(page, NEW_BRANCH)).to_be_visible()
        expect(row(page, NEW_BRANCH)).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(row(page, "Volunteers and rotas")).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(row(page, "Morning shift")).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(row(page, "Volunteers and rotas")).to_be_focused()
        as_user(app_url, w.id, w.users[0], op("title", topic_id=BUDGET_ID, offset=0, delete=6, insert=RENAMED_BRANCH))
        expect(row(page, RENAMED_BRANCH)).to_be_visible()
        row(page, RENAMED_BRANCH).click()
        page.keyboard.press("F6")
        assert not focus_inside(page, outline(page))
    titles = [t["title"] for t in api.topics(w.id).values()]
    assert NEW_BRANCH in titles and RENAMED_BRANCH in titles


def test_find_filter_replace(browser, app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], root=fair(**{
        "t-music": {"title": LOCKED_TITLE, "locked_by": o}, "t-budget": {"note": NOTE_BEFORE},
        "t-morning": {"task": task(0, assignee=ben)}}))
    api = Api(app_url, ben)
    with editor(browser, app_url, ben, w.id) as page:
        focus_topic(page, "t-vol")
        page.keyboard.press("Space")
        focus_topic(page, "t-root")
        page.keyboard.press("Control+f")
        search = page.get_by_role("search", name="Find in map")
        find = search.get_by_role("textbox", name="Find")
        expect(find).to_be_focused()
        find.fill("morning")
        expect(search).to_contain_text("1 of 1")
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "true")
        find.fill("zzzq")
        expect(search).to_contain_text("No matches")
        find.fill("stall")
        expect(search).to_contain_text("1 of 3")
        expect(topic(page, "t-vol")).to_have_attribute("data-dim", "true")
        expect(topic(page, "t-budget")).not_to_have_attribute("data-dim", "true")
        nxt = search.get_by_role("button", name="Next match")
        nxt.click()
        expect(search).to_contain_text("2 of 3")
        expect(topic(page, "t-music")).to_be_focused()
        nxt.click(); nxt.click()
        expect(search).to_contain_text("1 of 3")
        search.get_by_role("button", name="Previous match").click()
        expect(search).to_contain_text("3 of 3")
        search.get_by_role("textbox", name="Replace with").fill("booth")
        rev = api.revision(w.id)
        search.get_by_role("button", name="Replace all").click()
        expect(said(page)).to_contain_text("Replaced 2. Skipped 1 locked.")
        t = eventually(lambda: (lambda t: t if t["t-stalls"]["title"] == "booths" else None)(api.topics(w.id)), "Replace all applied", page)
        assert t[BUDGET_ID]["note"] == NOTE_AFTER and t[MUSIC_ID]["title"] == LOCKED_TITLE
        assert api.revision(w.id) == rev + 1
        find.fill("")
        select(search.get_by_role("combobox", name="Filter by assignee"), ben)
        expect(topic(page, "t-stalls")).to_have_attribute("data-dim", "true")
        expect(topic(page, "t-morning")).not_to_have_attribute("data-dim", "true")
        page.keyboard.press("Escape")
        expect(search).to_be_hidden()
        tool(page, "Undo").click()
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls" and api.topics(w.id)["t-budget"]["note"] == NOTE_BEFORE,
                   "one undo reverses the whole replace", page)


def test_live_sync_and_presence(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, w.owner)
    timeout_ms = api.map(w.id)["settings"]["presence_timeout_ms"]
    with editor(browser, app_url, w.owner, w.id) as mine:
        people = mine.get_by_role("list", name="People here")
        expect(people).to_contain_text(w.owner)
        with editor(browser, app_url, ben, w.id) as theirs:
            expect(people).to_contain_text(ben)
            cb = canvas(theirs).bounding_box()
            cursor = mine.locator("[data-user]").filter(has_text=ben)

            def moved() -> bool:
                theirs.mouse.move(cb["x"] + cb["width"] / 2 + 40, cb["y"] + cb["height"] - 50)
                return cursor.count() == 1
            eventually(moved, "the co-editor's cursor shows on my screen", theirs)
            expect(cursor).to_have_attribute("data-colour", BRANCH_COLOURS[1])
            focus_topic(theirs, "t-stalls")
            eventually(lambda: mine.locator("[data-selected-by]").count() >= 1, "a selection ring shows", theirs)
            expect(mine.locator("[data-selected-by]").first).to_have_attribute("data-colour", BRANCH_COLOURS[1])
            rev = api.revision(w.id)
            as_user(app_url, w.id, ben, op("title", topic_id="t-stalls", offset=6, delete=0, insert=" row"))
            expect(item(mine, "Stalls row")).to_be_visible()
            expect(stage(mine)).to_have_attribute("data-revision", str(rev + 1))
            mine.get_by_role("button", name=f"Follow {ben}").click()
            expect(said(mine)).to_contain_text(f"Following {ben}.")
            theirs.mouse.move(cb["x"] + 60, cb["y"] + cb["height"] - 50)
            theirs.keyboard.down("Control"); theirs.mouse.wheel(0, -100); theirs.keyboard.up("Control")
            eventually(lambda: abs(view(mine)[0] - view(theirs)[0]) <= ZOOM_EPS, "following matches the followed zoom", theirs)
            mb = canvas(mine).bounding_box()
            mine.mouse.move(mb["x"] + 30, mb["y"] + mb["height"] - 30)
            mine.keyboard.down("Control"); mine.mouse.wheel(0, 100); mine.keyboard.up("Control")
            expect(said(mine)).to_contain_text(f"Stopped following {ben}.")
        clock(app_url, timeout_ms)
        expect(people).not_to_contain_text(ben)
        expect(cursor).to_have_count(0)


def test_wf_outline_sync_together(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        row(mine, "Music stage").click()
        mine.keyboard.press("Tab")
        focus_topic(theirs, "t-budget")
        theirs.keyboard.press("F2")
        commit(theirs, " plan")
        for page in (mine, theirs):
            expect(topic(page, "t-music")).to_have_attribute("aria-level", "3")
            expect(topic(page, "t-stalls")).to_have_attribute("aria-setsize", "3")
            expect(item(page, "Budget plan")).to_be_visible()
        theirs.keyboard.press("Control+f")
        search = theirs.get_by_role("search", name="Find in map")
        search.get_by_role("textbox", name="Find").fill("shift")
        search.get_by_role("textbox", name="Replace with").fill("slot")
        search.get_by_role("button", name="Replace all").click()
        expect(said(theirs)).to_contain_text("Replaced 2. Skipped 0 locked.")
        expect(item(mine, "Morning slot")).to_be_visible()
        expect(row(mine, "Afternoon slot")).to_be_visible()
        theirs.keyboard.press("Escape")
        tool(theirs, "Undo").click()
        for page in (mine, theirs):
            expect(item(page, "Morning shift")).to_be_visible()
            expect(item(page, "Afternoon shift")).to_be_visible()
    t = api.topics(w.id)
    assert t["t-music"]["parent_id"] == "t-stalls" and t["t-budget"]["title"] == BUDGET_PLAN
    assert t["t-morning"]["title"] == "Morning shift" and t["t-afternoon"]["title"] == "Afternoon shift"


def test_wf_outline_sync_readonly(browser, app_url):
    w = setup(app_url, "commenter")
    cara = w.users[0]
    api = Api(app_url, cara)
    rev = api.revision(w.id)
    with editor(browser, app_url, cara, w.id) as page:
        row(page, "Music stage").click()
        page.keyboard.press("Tab")
        expect(said(page)).to_contain_text("You can view this map but not edit it.")
        expect(topic(page, "t-music")).to_have_attribute("aria-level", "2")
    err(api.ops(w.id, op("move", topic_id="t-music", parent_id="t-stalls", after=None)), 403, "forbidden")
    assert api.revision(w.id) == rev and api.topics(w.id)["t-music"]["parent_id"] == "t-root"


@pytest.mark.timeout(1800)
def test_operation_log(browser, app_url):
    w = setup(app_url, "editor")
    api = Api(app_url, w.owner)
    group = {"group_id": gid(), "base_revision": 1, "ops": [op("add", topic_id="t-a", parent_id="t-root", after=None, title="A")]}
    first = api.post(f"/api/maps/{w.id}/ops", group)
    body = first.json()
    assert first.status_code == 200 and body["status"] == "applied" and body["revision"] == 2 and body["replayed"] is False
    again = api.post(f"/api/maps/{w.id}/ops", group).json()
    assert again["replayed"] is True and {k: v for k, v in again.items() if k != "replayed"} == {k: v for k, v in body.items() if k != "replayed"}
    assert api.revision(w.id) == 2
    bad = api.ops(w.id, op("add", topic_id=ID_B, parent_id="t-root", after=None, title="B"),
                  op("move", topic_id="t-vol", parent_id=MORNING_ID, after=None)).json()
    assert bad["status"] == "rejected" and bad["revision"] == 2
    assert [r["status"] for r in bad["results"]] == ["rejected", "rejected"]
    assert [r["reason"] for r in bad["results"]] == [None, "cycle"]
    assert ID_B not in api.topics(w.id)
    r1 = api.ops(w.id, op("style", topic_id="t-stalls", icon="star"), base=2).json()
    r2 = as_user(app_url, w.id, w.users[0], op("style", topic_id="t-music", icon="flag"), base=2)
    assert (r1["revision"], r2["revision"]) == (3, 4)
    with editor(browser, app_url, w.owner, w.id) as page:
        expect(stage(page)).to_have_attribute("data-revision", "4")
        as_user(app_url, w.id, w.users[0], op("style", topic_id="t-music", icon="bulb"))
        expect(stage(page)).to_have_attribute("data-revision", "5")


MERGE_CASES = {
    "insert-apart": ({"offset": 4, "delete": 0, "insert": " a"}, {"offset": 9, "delete": 0, "insert": " now"}, "Plan a trip now"),
    "same-offset": ({"offset": 0, "delete": 0, "insert": "Big "}, {"offset": 0, "delete": 0, "insert": "Our "}, "Big Our Plan trip"),
    "overlapping-deletes": ({"offset": 0, "delete": 5, "insert": ""}, {"offset": 2, "delete": 5, "insert": ""}, "ip"),
    "replace-both": ({"offset": 5, "delete": 4, "insert": "holiday"}, {"offset": 0, "delete": 4, "insert": "Book"}, "Book holiday"),
}


@pytest.mark.parametrize("case", list(MERGE_CASES), ids=["insert-apart", "same-offset", "overlapping-deletes", "replace-both"])
def test_title_merge(browser, app_url, case):
    a, b, result = MERGE_CASES[case]
    w = setup(app_url, "editor", root=node("t-root", "Trips", node("t-plan", "Plan trip")))
    ben = w.users[0]
    with editor(browser, app_url, ben, w.id) as page:
        focus_topic(page, "t-plan")
        page.keyboard.press("F2")
        first = as_user(app_url, w.id, w.owner, op("title", topic_id="t-plan", **a), base=1)
        assert first["status"] == "applied"
        after_a = "Plan trip"[:a["offset"]] + a["insert"] + "Plan trip"[a["offset"] + a["delete"]:]
        eventually(lambda: typing(page)["value"] == after_a, "an open title input takes the remote edit live")
        assert typing(page)["start"] == len(after_a)
        page.keyboard.press("Escape")
        second = as_user(app_url, w.id, ben, op("title", topic_id="t-plan", **b), base=1)
        assert second["status"] == "merged" and second["results"][0]["status"] == "merged"
        assert Api(app_url, ben).topics(w.id)["t-plan"]["title"] == result
        expect(item(page, result)).to_be_visible()


def test_work_offline_queue(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, w.owner)
    with editor(browser, app_url, ben, w.id) as page:
        page.get_by_role("switch", name="Work offline").click()
        banner = page.get_by_role("region", name="Connection")
        expect(banner).to_contain_text(offline_banner(0))
        focus_topic(page, "t-stalls")
        page.keyboard.press("F2")
        commit(page, " fair")
        expect(banner).to_contain_text(offline_banner(1))
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big "))
        rev = api.revision(w.id)
        focus_topic(page, "t-music")
        page.keyboard.press("F2")
        commit(page, " tent")
        expect(banner).to_contain_text(offline_banner(2))
        focus_topic(page, "t-budget")
        page.keyboard.press("F2")
        commit(page, " x")
        expect(banner).to_contain_text(offline_banner(3))
        page.keyboard.press("Control+z")
        expect(banner).to_contain_text(offline_banner(2))
        page.reload()
        expect(topic(page, "t-root")).to_be_visible()
        expect(banner).to_contain_text(offline_banner(2))
        expect(item(page, QUEUED_TITLE)).to_be_visible()
        assert api.topics(w.id)["t-music"]["title"] == TITLES["t-music"]
        page.get_by_role("switch", name="Work offline").click()
        expect(said(page)).to_contain_text(back_online(2, 1))
    t = eventually(lambda: (lambda t: t if t["t-music"]["title"] == QUEUED_TITLE else None)(api.topics(w.id)), "queue replayed")
    assert t["t-stalls"]["title"] == BIG_STALLS_FAIR
    assert t["t-budget"]["title"] == TITLES["t-budget"]
    assert api.revision(w.id) == rev + 2


def test_session_expiry_dialog(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, ben, w.id, device_time=DEVICE_TIME) as page:
        dialog = page.get_by_role("dialog", name="Sign in again")
        expect(dialog).to_have_count(0)
        focus_topic(page, "t-stalls")
        page.keyboard.press("F2")
        page.keyboard.type(" x")
        me = page.request.get(f"{app_url}/api/me").json()
        ttl = (instant(me["session_expires_at"]) - instant(me["server_time"])).total_seconds() * 1000
        clock(app_url, int(ttl) + 1000)
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text("Your session ended. Sign in again to keep your changes.")
        page.keyboard.press("Escape")
        expect(dialog).to_be_visible()
        dialog.get_by_label("Password").fill(PASSWORD)
        dialog.get_by_role("button", name="Sign in", exact=True).click()
        expect(dialog).to_be_hidden()
        eventually(lambda: typing(page)["value"] == "Stalls x" and typing(page)["start"] == len("Stalls x"),
                   "focus returns to the open title input with its caret", page)
        commit(page, " y")
    eventually(lambda: Api(app_url, ben).topics(w.id)["t-stalls"]["title"] == "Stalls x y", "the kept edit reaches the server")


def test_wf_offline_merge_two_offline(browser, app_url):
    w = setup(app_url, "editor", "editor", root=node("t-root", "Trips", node("t-plan", "Plan trip")))
    ben, cara = w.users
    with editor(browser, app_url, ben, w.id) as b, editor(browser, app_url, cara, w.id) as c:
        for page in (b, c):
            page.get_by_role("switch", name="Work offline").click()
            focus_topic(page, "t-plan")
            page.keyboard.press("F2")
        b.keyboard.press("Home")
        for _ in range(4):
            b.keyboard.press("ArrowRight")
        commit(b, " a")
        commit(c, " now")
        b.get_by_role("switch", name="Work offline").click()
        expect(said(b)).to_contain_text(back_online(1, 0))
        c.get_by_role("switch", name="Work offline").click()
        expect(said(c)).to_contain_text(back_online(1, 1))
        for page in (b, c):
            expect(item(page, "Plan a trip now")).to_be_visible()
    assert Api(app_url, ben).topics(w.id)["t-plan"]["title"] == "Plan a trip now"


def test_wf_offline_merge_deleted(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    with editor(browser, app_url, ben, w.id) as page:
        page.get_by_role("switch", name="Work offline").click()
        focus_topic(page, "t-stalls")
        page.keyboard.press("F2")
        commit(page, " row")
        as_user(app_url, w.id, w.owner, op("delete", topic_id="t-stalls"))
        page.get_by_role("switch", name="Work offline").click()
        expect(said(page)).to_contain_text(back_online(1, 1))
        recovered = page.get_by_role("region", name="Recovered edits")
        expect(recovered).to_contain_text(STALLS_ROW)
        recovered.get_by_role("button", name="Re-apply").click()
        expect(item(page, "Stalls row")).to_be_visible()
        expect(page.get_by_role("region", name="Recovered edits")).to_have_count(0)
    t = api.topics(w.id)
    assert "t-stalls" not in t and any(x["title"] == STALLS_ROW and x["parent_id"] == "t-root" for x in t.values())
    assert api.map(w.id)["recovered"] == []


def test_move_conflicts(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with ThreadPoolExecutor(2) as pool:
        a = pool.submit(as_user, app_url, w.id, w.owner, op("move", topic_id="t-stalls", parent_id=MUSIC_ID, after=None), base=1)
        b = pool.submit(as_user, app_url, w.id, ben, op("move", topic_id=MUSIC_ID, parent_id="t-stalls", after=None), base=1)
        results = [a.result(), b.result()]
    assert sorted(r["status"] for r in results) == ["applied", "rejected"]
    loser = next(r for r in results if r["status"] == "rejected")
    assert loser["results"][0]["reason"] == "cycle"
    t = Api(app_url, ben).topics(w.id)
    assert {t["t-stalls"]["parent_id"], t[MUSIC_ID]["parent_id"]} in ({MUSIC_ID, "t-root"}, {"t-stalls", "t-root"})
    assert len(t) == len(TITLES)

    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        base = Api(app_url, ben).revision(w.id)
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-budget", parent_id="t-stalls", after=None), base=base)
        late = as_user(app_url, w.id, ben, op("move", topic_id=BUDGET_ID, parent_id=MUSIC_ID, after=None), base=base)
        assert late["status"] == "applied"
        expect(notices(mine)).to_contain_text(f"{ben} moved Budget after you.")
        theirs.get_by_role("switch", name="Work offline").click()
        focus_topic(theirs, "t-music")
        theirs.keyboard.press("Alt+ArrowLeft")
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-stalls", parent_id=MUSIC_ID, after=None))
        theirs.get_by_role("switch", name="Work offline").click()
        expect(notices(theirs)).to_contain_text("Move undone: Music stage can't go inside its own branch.")
        expect(topic(theirs, "t-music")).to_be_focused()
        expect(topic(theirs, "t-music")).to_have_attribute("aria-level", "2")
        expect(topic(theirs, "t-stalls")).to_have_attribute("aria-level", "3")
    t = Api(app_url, ben).topics(w.id)
    assert t[BUDGET_ID]["parent_id"] == MUSIC_ID and t["t-stalls"]["parent_id"] == MUSIC_ID and t[MUSIC_ID]["parent_id"] == "t-root"


def test_delete_wins_recovered_edits(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    as_user(app_url, w.id, w.owner, op("delete", topic_id="t-vol"), base=1)
    rev = api.revision(w.id)
    r = api.ops(w.id, op("title", topic_id="t-morning", offset=13, delete=0, insert=" late"), base=1).json()
    assert r["status"] == "recovered" and r["results"][0]["reason"] == "deleted" and r["revision"] == rev
    assert r["notice"] == f"{w.owner} deleted this branch. Your edit is in Recovered edits."
    entry = next(e for e in api.map(w.id)["recovered"] if e["text"] == "Morning shift late")
    assert entry["kind"] == "title" and entry["from_title"] == "Morning shift"
    assert api.delete(f"/api/maps/{w.id}/recovered/{entry['id']}").status_code == 204
    assert api.map(w.id)["recovered"] == []
    w2 = setup(app_url, "editor", owner=uname("o"), users=[uname("u")])
    ben2 = w2.users[0]
    with editor(browser, app_url, ben2, w2.id) as page:
        focus_topic(page, "t-afternoon")
        page.keyboard.press("F2")
        page.keyboard.type(" x")
        as_user(app_url, w2.id, w2.owner, op("delete", topic_id="t-vol"))
        expect(said(page)).to_contain_text(f"{w2.owner} deleted this branch. Your edit is in Recovered edits.")
        recovered = page.get_by_role("region", name="Recovered edits")
        expect(recovered).to_contain_text(SHIFT_EDITED)
        eventually(lambda: focus_inside(page, tree(page)), "focus lands on a surviving topic, not the page body", page)
        recovered.get_by_role("button", name="Re-apply").click()
        expect(item(page, SHIFT_EDITED)).to_be_visible()
        expect(page.get_by_role("region", name="Recovered edits")).to_have_count(0)
    t = Api(app_url, ben2).topics(w2.id)
    assert any(x["title"] == SHIFT_EDITED and x["parent_id"] == "t-root" for x in t.values())


def test_anchored_reorder_and_locked_groups(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    as_user(app_url, w.id, w.owner, op("delete", topic_id="t-music"), base=1)
    r = api.ops(w.id, op("move", topic_id=BUDGET_ID, parent_id="t-root", after=MUSIC_ID), base=1).json()
    assert r["status"] == "applied" and r["results"][0]["reason"] == "anchor_gone"
    assert r["notice"] == f"Order changed: {w.owner} reordered these topics too."
    assert kids(api.topics(w.id), "t-root")[-1] == BUDGET_ID
    as_user(app_url, w.id, w.owner, op("lock", topic_id="t-vol"))
    rev = api.revision(w.id)
    err(api.ops(w.id, op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big "),
                op("title", topic_id="t-morning", offset=0, delete=0, insert="Early ")), 403, "branch_locked")
    err(api.ops(w.id, op("move", topic_id="t-stalls", parent_id="t-vol", after=None)), 403, "branch_locked")
    t = api.topics(w.id)
    assert api.revision(w.id) == rev and t["t-stalls"]["title"] == "Stalls" and t["t-stalls"]["parent_id"] == "t-root"
    assert Api(app_url, w.owner).ops(w.id, op("title", topic_id="t-morning", offset=0, delete=0, insert="Early ")).status_code == 200
    w2 = setup(app_url, "editor", root=fair(**{"t-vol": {"locked_by": None}}))
    ben2 = w2.users[0]
    as_user(app_url, w2.id, w2.owner, op("lock", topic_id="t-vol"))
    with editor(browser, app_url, ben2, w2.id) as page:
        focus_topic(page, "t-budget")
        page.keyboard.press("Alt+ArrowLeft")
        expect(notices(page)).to_contain_text("Nothing moved: Volunteers and rotas is locked.")
        focus_topic(page, "t-morning")
        page.keyboard.press("F2")
        commit(page, " x")
        expect(notices(page)).to_contain_text(f"Morning shift is locked by {w2.owner}.")
        expect(topic(page, "t-budget")).to_have_attribute("aria-level", "2")
    t = Api(app_url, ben2).topics(w2.id)
    assert t[BUDGET_ID]["parent_id"] == "t-root" and t[MORNING_ID]["title"] == "Morning shift"


def test_wf_crossing_moves_cycle(browser, app_url):
    w = setup(app_url, "editor", "editor")
    ben, cara = w.users
    with editor(browser, app_url, ben, w.id) as b, editor(browser, app_url, cara, w.id) as c:
        b.get_by_role("switch", name="Work offline").click()
        focus_topic(b, "t-music")
        b.keyboard.press("Alt+ArrowLeft")
        focus_topic(c, "t-stalls")
        as_user(app_url, w.id, cara, op("move", topic_id="t-stalls", parent_id="t-music", after=None))
        b.get_by_role("switch", name="Work offline").click()
        expect(notices(b)).to_contain_text("Move undone: Music stage can't go inside its own branch.")
        expect(said(b)).to_contain_text(back_online(1, 1))
        for page in (b, c):
            expect(topic(page, "t-stalls")).to_have_attribute("aria-level", "3")
            expect(topic(page, "t-music")).to_have_attribute("aria-level", "2")
    t = Api(app_url, ben).topics(w.id)
    assert t["t-stalls"]["parent_id"] == MUSIC_ID and t[MUSIC_ID]["parent_id"] == "t-root"


def test_wf_crossing_moves_competing(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        base = Api(app_url, ben).revision(w.id)
        focus_topic(mine, "t-budget")
        mine.keyboard.press("Alt+ArrowUp")
        eventually(lambda: Api(app_url, ben).revision(w.id) == base + 1, "the reorder reaches the server", mine)
        as_user(app_url, w.id, ben, op("move", topic_id="t-budget", parent_id="t-stalls", after=None), base=base)
        expect(notices(mine)).to_contain_text(f"{ben} moved Budget after you.")
        for page in (mine, theirs):
            expect(topic(page, "t-budget")).to_have_attribute("aria-level", "3")
    assert Api(app_url, ben).topics(w.id)["t-budget"]["parent_id"] == "t-stalls"


def test_wf_crossing_moves_delete_under_edit(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        focus_topic(theirs, "t-budget")
        theirs.keyboard.press("F2")
        theirs.keyboard.type(" cap")
        focus_topic(mine, "t-budget")
        mine.keyboard.press("Delete")
        expect(theirs.get_by_role("region", name="Recovered edits")).to_contain_text(BUDGET_CAP)
        expect(said(theirs)).to_contain_text(f"{w.owner} deleted this branch. Your edit is in Recovered edits.")
        for page in (mine, theirs):
            expect(topic(page, "t-budget")).to_have_count(0)
    assert BUDGET_ID not in Api(app_url, ben).topics(w.id)
    assert [e["text"] for e in Api(app_url, ben).map(w.id)["recovered"]] == [BUDGET_CAP]


def test_personal_undo_redo(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    with editor(browser, app_url, ben, w.id) as page:
        focus_topic(page, "t-stalls")
        page.keyboard.press("F2")
        commit(page, " row")
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-music", offset=0, delete=0, insert="Live "))
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls row", "my rename stored", page)
        page.keyboard.press("Control+z")
        expect(said(page)).to_contain_text("Undone.")
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls", "undo reverses my rename", page)
        assert api.topics(w.id)[MUSIC_ID]["title"] == LIVE_MUSIC
        page.keyboard.press("Control+Shift+Z")
        expect(said(page)).to_contain_text("Redone.")
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls row", "redo re-applies", page)
        page.reload()
        expect(topic(page, "t-root")).to_be_visible()
        tool(page, "Undo").click()
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls", "the stack survived reload", page)
        focus_topic(page, "t-budget")
        page.keyboard.press("F2")
        commit(page, " cap")
        eventually(lambda: api.topics(w.id)["t-budget"]["title"] == "Budget cap", "rename stored", page)
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-budget", offset=0, delete=0, insert="Our "))
        page.keyboard.press("Control+z")
        expect(notices(page)).to_contain_text(f"Can't undo: {w.owner} changed {REMOTE_BUDGET} after you.")
        page.keyboard.press("Control+Shift+Z")
        expect(said(page)).to_contain_text("Nothing to redo.")
    assert api.topics(w.id)[BUDGET_ID]["title"] == REMOTE_BUDGET
    while_empty = None
    for _ in range(5):
        while_empty = api.post(f"/api/maps/{w.id}/undo").json()
        if while_empty["status"] == "empty":
            break
    assert while_empty["status"] == "empty" and while_empty["notice"] == "Nothing to undo."
    assert api.topics(w.id)[MUSIC_ID]["title"] == LIVE_MUSIC


def test_undo_delete_restores_branch(app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], root=fair(**{"t-morning": {"note": "Coffee", "task": task(30), "colour": "orange"}}),
              links=[{"id": "l1", "from": "t-stalls", "to": "t-morning", "label": "ask", "type": "related"}],
              boundaries=[{"id": "b1", "topic_id": "t-vol", "label": "crew"}],
              comments=[{"id": gid("c"), "topic_id": "t-morning", "author": o, "body": "Who?", "resolved": False,
                         "replies": [{"id": gid("c"), "author": ben, "body": "Me."}]}],
              votes=[{"topic_id": "t-morning", "username": ben}])
    api = Api(app_url, ben)
    up = api.post(f"/api/maps/{w.id}/topics/t-morning/attachments", content=make_png())
    assert up.status_code == 201, up.text
    before = api.map(w.id)
    keep = {"id", "parent_id", "rank", "title", "note", "task", "colour", "shape", "icon", "attachments", "comment_count", "vote_count"}
    snap = {t["id"]: {k: t[k] for k in keep} for t in before["topics"] if t["id"] in ("t-vol", "t-morning", "t-afternoon")}
    assert api.ops(w.id, op("delete", topic_id="t-vol")).json()["status"] == "applied"
    gone = api.map(w.id)
    assert ID_VOL not in {t["id"] for t in gone["topics"]} and gone["links"] == [] and gone["boundaries"] == []
    u = api.post(f"/api/maps/{w.id}/undo").json()
    assert u["status"] == "undone" and u["focus_topic_id"] == ID_VOL
    after = api.map(w.id)
    back = {t["id"]: {k: t[k] for k in keep} for t in after["topics"] if t["id"] in snap}
    assert back == snap
    assert after["links"] == before["links"] and after["boundaries"] == before["boundaries"]
    threads = api.get(f"/api/maps/{w.id}/topics/t-morning/comments").json()["threads"]
    assert sum(1 + len(t["replies"]) for t in threads if not t["resolved"]) == 2


def test_activity_panel(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    as_user(app_url, w.id, ben, op("add", topic_id="t-raffle", parent_id="t-stalls", after=None, title="Raffle"))
    as_user(app_url, w.id, w.owner, op("title", topic_id="t-budget", offset=0, delete=6, insert="Money"))
    as_user(app_url, w.id, ben, op("delete", topic_id="t-music"))
    sentences = [f"{ben} deleted Music stage", f"{w.owner} renamed Budget to Money", f"{ben} added Raffle"]
    api = Api(app_url, w.owner)
    entries = api.get(f"/api/maps/{w.id}/activity").json()["entries"]
    assert [e["sentence"] for e in entries[:3]] == sentences
    assert [e["seq"] for e in entries] == sorted((e["seq"] for e in entries), reverse=True)
    mine = api.get(f"/api/maps/{w.id}/activity", params={"person": ben}).json()["entries"]
    assert {e["user"] for e in mine} == {ben} and [e["sentence"] for e in mine[:2]] == [sentences[0], sentences[2]]
    with editor(browser, app_url, w.owner, w.id) as page:
        tool(page, "Activity").click()
        region = page.get_by_role("region", name="Activity", exact=True)
        texts = region.get_by_role("button").all_inner_texts()
        idx = [next(i for i, t in enumerate(texts) if s in t) for s in sentences]
        assert idx == sorted(idx), texts
        select(region.get_by_role("combobox", name="Person"), ben)
        expect(region.get_by_role("button", name=re.compile(re.escape(sentences[1])))).to_have_count(0)
        region.get_by_role("button", name=re.compile(re.escape(sentences[2]))).click()
        expect(topic(page, "t-raffle")).to_be_focused()
        region.get_by_role("button", name=re.compile(re.escape(sentences[0]))).click()
        expect(notices(page)).to_contain_text("That topic no longer exists.")
        tool(page, "Activity").click()
        expect(page.get_by_role("region", name="Activity", exact=True)).to_have_count(0)


def test_wf_personal_undo_skip(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    with editor(browser, app_url, ben, w.id) as page:
        focus_topic(page, "t-music")
        page.keyboard.press("F2")
        commit(page, " tent")
        focus_topic(page, "t-stalls")
        page.keyboard.press("F2")
        commit(page, " row")
        eventually(lambda: api.topics(w.id)["t-stalls"]["title"] == "Stalls row", "rename stored", page)
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big "))
        page.keyboard.press("Control+z")
        expect(notices(page)).to_contain_text(f"Can't undo: {w.owner} changed Big Stalls row after you.")
        page.keyboard.press("Control+z")
        expect(said(page)).to_contain_text("Undone.")
        expect(topic(page, "t-music")).to_be_focused()
    t = api.topics(w.id)
    assert t["t-stalls"]["title"] == BIG_STALLS_ROW and t["t-music"]["title"] == "Music stage"


def test_wf_personal_undo_reload(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    api = Api(app_url, ben)
    with editor(browser, app_url, ben, w.id) as page:
        focus_topic(page, "t-vol")
        page.keyboard.press("Delete")
        eventually(lambda: "t-vol" not in api.topics(w.id), "delete stored", page)
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-budget", offset=0, delete=0, insert="Our "))
        page.reload()
        expect(topic(page, "t-root")).to_be_visible()
        topic(page, "t-root").focus()
        page.keyboard.press("Control+z")
        expect(topic(page, "t-morning")).to_be_visible()
        expect(topic(page, "t-vol")).to_be_focused()
        page.keyboard.press("Control+Shift+Z")
        expect(said(page)).to_contain_text("Redone.")
        expect(topic(page, "t-vol")).to_have_count(0)
    t = api.topics(w.id)
    assert ID_VOL not in t and t["t-budget"]["title"] == OUR_BUDGET
    assert api.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
    assert {"t-vol", "t-morning", "t-afternoon"} <= set(api.topics(w.id))


VIEWPORTS = {"phone-375": PHONE_SMALL, "phone-390": PHONE, "tablet-768": TABLET, "desk-1280": DESK}


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=["phone-375", "phone-390", "tablet-768", "desk-1280"])
def test_published_breakpoints(browser, app_url, size):
    width, height = VIEWPORTS[size]
    kind = "phone" if width < 768 else "tablet" if width < 1280 else "desk"
    w = setup(app_url)
    for _ in range(3):
        assert Api(app_url, w.owner).post("/api/maps", {"title": gid("Map "), "template": None}).status_code == 201
    with browse(browser, app_url, None, "/", (width, height)) as page:
        bar = page.get_by_role("banner")
        expect(bar.get_by_role("link", name="Sign in", exact=True)).to_be_visible()
        start = bar.get_by_role("link", name="Get started")
        expect(start).to_be_visible()
        assert start.bounding_box()["height"] >= TAP_MIN_PX
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        layout(page)
        assert page.get_by_role("heading").count() >= 4
        if kind == "phone":
            assert page.get_by_role("button", expanded=False).count() >= 1
        def bar_height() -> float:
            return bar.evaluate("e => e.getBoundingClientRect().height")
        page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
        since, heights = time.monotonic(), []
        def settled_at_top() -> bool:
            heights.append(bar_height())
            return time.monotonic() - since >= 0.5 and len(heights) >= 2 and abs(heights[-1] - heights[-2]) < 0.5
        eventually(settled_at_top, "the top bar settles at the top of the page", page)
        tall = heights[-1]
        def scrolled_height(y: int) -> float:
            page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", y)
            return bar_height()
        eventually(lambda: scrolled_height(400) < tall, "the shrinking top bar compacts on scroll", page)
        eventually(lambda: abs(scrolled_height(0) - tall) < 1, "the shrinking top bar grows back at the top", page)
    with browse(browser, app_url, w.owner, "/maps", (width, height)) as page:
        cards = page.get_by_role("list", name="All maps").get_by_role("listitem")
        expect(cards).to_have_count(4)
        columns = len({round(cards.nth(i).bounding_box()["x"]) for i in range(4)})
        assert columns == {"phone": 1, "tablet": 2, "desk": 3}[kind]
        layout(page)
    with editor(browser, app_url, w.owner, w.id, size=(width, height)) as page:
        layout(page)
        rail = page.get_by_role("complementary", name="Outline")
        if kind == "phone":
            expect(page.get_by_role("toolbar", name="Map tools")).to_be_hidden()
            page.get_by_role("button", name="Tools", exact=True).click()
            expect(page.get_by_role("toolbar", name="Map tools")).to_be_visible()
            tool(page, "Activity").click()
            expect(page.get_by_role("dialog", name="Activity panel").get_by_role("region", name="Activity", exact=True)).to_be_visible()
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog", name="Activity panel")).to_be_hidden()
            if page.get_by_role("toolbar", name="Map tools").is_visible():
                page.keyboard.press("Escape")
                expect(page.get_by_role("toolbar", name="Map tools")).to_be_hidden()
            page.get_by_role("button", name="Outline", exact=True).click()
            expect(page.get_by_role("dialog", name="Outline")).to_be_visible()
            page.keyboard.press("Escape")
        elif kind == "tablet":
            expect(page.get_by_role("toolbar", name="Map tools")).to_be_visible()
            toggle = page.get_by_role("button", name="Outline", exact=True)
            was = rail.is_visible()
            toggle.click()
            expect(rail).to_be_visible() if not was else expect(rail).to_be_hidden()
            toggle.click()
            expect(rail).to_be_hidden() if not was else expect(rail).to_be_visible()
            tool(page, "Activity").click()
            expect(page.get_by_role("region", name="Activity", exact=True)).to_be_visible()
        else:
            expect(rail).to_be_visible()
            expect(page.get_by_role("button", name="Outline", exact=True)).to_have_count(0)
            share = rail.bounding_box()["width"] / width
            assert 0.15 <= share <= 0.35, f"the outline rail is about a quarter of the width: {share}"
            tool(page, "Activity").click()
            expect(page.get_by_role("region", name="Activity", exact=True)).to_be_visible()
        layout(page)


def test_touch_gestures(browser, app_url):
    w = setup(app_url)
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id, size=PHONE) as page:
        touch = Touch(page)
        fit_view(page)
        touch.tap(topic(page, "t-stalls"))
        expect(topic(page, "t-stalls")).to_be_focused()
        menu = page.get_by_role("menu", name="Topic actions")
        touch.start(center(topic(page, "t-music")))
        advance(page, LONG_PRESS_MS - 1)
        expect(menu).to_be_hidden()
        advance(page, 1)
        expect(menu).to_be_visible()
        touch.lift_after_hold()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        bx, by = center(topic(page, "t-budget"))
        sx, sy = center(topic(page, "t-stalls"))
        touch.start((bx, by)); touch.move((bx + 12, by)); touch.move(((bx + sx) / 2, (by + sy) / 2)); touch.move((sx, sy))
        expect(topic(page, "t-stalls")).to_have_attribute("data-drop-target", "true")
        expect(said(page)).to_contain_text("Drop to make Budget a child of Stalls")
        touch.end()
        eventually(lambda: api.topics(w.id)["t-budget"]["parent_id"] == "t-stalls", "release reparents onto the target", page)
        cb = canvas(page).bounding_box()
        mx, my = center(topic(page, "t-music"))
        touch.start((mx, my)); touch.move((mx, my + 12)); touch.move((cb["x"] + 10, my + 12))
        before = view(page)[1]
        advance(page, EDGE_STEP_MS * 10)
        moved = view(page)[1] - before
        assert moved > 0 and abs(moved - EDGE_STEP_PX * 10) <= EDGE_STEP_PX, f"edge panning shows more beyond the left edge: {moved}"
        touch.end()
        assert api.topics(w.id)["t-music"]["parent_id"] == "t-root"
        px, py = cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] - 120
        z0, p0x, p0y = view(page)
        touch.start((px - 50, py), (px + 50, py)); touch.move((px - 100, py), (px + 100, py))
        z1, p1x, p1y = view(page)
        assert abs(z1 - z0 * 2) <= ZOOM_EPS
        mid = (px - cb["x"], py - cb["y"])
        assert abs(p1x - (mid[0] - (mid[0] - p0x) * z1 / z0)) <= COORD_SLACK
        assert abs(p1y - (mid[1] - (mid[1] - p0y) * z1 / z0)) <= COORD_SLACK
        touch.end()
        touch.start((px, py)); touch.move((px + 30, py + 20)); touch.end()
        _, p2x, p2y = view(page)
        assert abs(p2x - p1x - 30) <= COORD_SLACK and abs(p2y - p1y - 20) <= COORD_SLACK


def test_phone_topic_sheet(browser, app_url):
    w = setup(app_url)
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id, size=PHONE) as page:
        touch = Touch(page)
        menu = long_press(page, touch, topic(page, "t-vol"))
        for name in ("Add child", "Add sibling", "Rename", "Collapse", "Open details", "Delete"):
            expect(menu.get_by_role("menuitem", name=name, exact=True)).to_be_visible()
        menu.get_by_role("menuitem", name="Collapse").click()
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "false")
        long_press(page, touch, topic(page, "t-vol")).get_by_role("menuitem", name="Expand").click()
        expect(topic(page, "t-vol")).to_have_attribute("aria-expanded", "true")
        long_press(page, touch, topic(page, "t-stalls")).get_by_role("menuitem", name="Add child").click()
        assert typing(page)["value"] == "New topic"
        commit(page, "Tables")
        sheet = open_details(page, touch, "t-stalls")
        for name in ("Notes", "Task", "Comments"):
            expect(sheet.get_by_role("tab", name=name)).to_be_visible()
        expect(sheet.get_by_role("tab", name="Notes")).to_have_attribute("aria-selected", "true")
        sheet.get_by_role("textbox", name="Note", exact=True).fill(PHONE_NOTE)
        expect(sheet.get_by_role("region", name="Note preview")).to_contain_text(PHONE_NOTE_SHOWN)
        page.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        eventually(lambda: api.topics(w.id)["t-stalls"]["note"] == PHONE_NOTE, "the sheet note is saved", page)
        long_press(page, touch, topic(page, "t-budget")).get_by_role("menuitem", name="Delete").click()
        eventually(lambda: "t-budget" not in api.topics(w.id), "Delete from the menu removes the branch", page)
    t = api.topics(w.id)
    assert any(x["title"] == TABLES and x["parent_id"] == "t-stalls" for x in t.values())


def test_wf_phone_touch_edit_live(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as desk, editor(browser, app_url, ben, w.id, size=PHONE) as phone:
        touch = Touch(phone)
        fit_view(phone)
        long_press(phone, touch, topic(phone, "t-stalls")).get_by_role("menuitem", name="Add child").click()
        commit(phone, "Tables")
        expect(item(desk, "Tables")).to_be_visible()
        bx, by = center(topic(phone, "t-budget"))
        sx, sy = center(topic(phone, "t-music"))
        touch.start((bx, by)); touch.move((bx + 12, by)); touch.move((sx, sy))
        expect(said(phone)).to_contain_text("Drop to make Budget a child of Music stage")
        touch.end()
        expect(topic(desk, "t-budget")).to_have_attribute("aria-level", "3")
        sheet = open_details(phone, touch, "t-music")
        sheet.get_by_role("textbox", name="Note", exact=True).fill("Sound check at noon")
        phone.keyboard.press("Escape")
        eventually(lambda: Api(app_url, w.owner).topics(w.id)["t-music"]["note"] == "Sound check at noon", "note stored", phone)
    t = Api(app_url, w.owner).topics(w.id)
    assert t["t-budget"]["parent_id"] == MUSIC_ID and any(x["title"] == TABLES for x in t.values())


def test_wf_phone_touch_outline_sheet(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as desk, editor(browser, app_url, ben, w.id, size=PHONE) as phone:
        opener = phone.get_by_role("button", name="Outline", exact=True)
        opener.click()
        sheet = phone.get_by_role("dialog", name="Outline")
        sheet.get_by_role("tree", name="Outline").get_by_role("treeitem", name=re.compile("^Budget")).click()
        phone.keyboard.press("F2")
        commit(phone, " cap")
        expect(item(desk, "Budget cap")).to_be_visible()
        phone.keyboard.press("Escape")
        if sheet.is_visible():
            phone.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()
    assert Api(app_url, ben).topics(w.id)["t-budget"]["title"] == BUDGET_CAP


def test_versions_and_playback(browser, app_url):
    o, ben, cara = uname("o"), uname("u"), uname("u")
    w = setup(app_url, "editor", "commenter", owner=o, users=[ben, cara], versions=[{"name": "Seeded", "by": o}])
    api, s3 = Api(app_url, o), S3()
    v1 = w.versions[0]
    snap = json.loads(s3.get(f"versions/{w.id}/{v1}.json"))
    assert snap["format"] == "sprigmap-version-1" and {t["id"] for t in snap["topics"]} == set(TITLES)
    err(Api(app_url, cara).post(f"/api/maps/{w.id}/versions", {"name": "Nope"}), 403, "forbidden")
    err(api.post(f"/api/maps/{w.id}/versions", {"name": ""}), 422, "invalid")
    r = api.post(f"/api/maps/{w.id}/versions", {"name": "Before party"})
    assert r.status_code == 201 and r.json()["version"]["number"] == 2 and r.json()["version"]["kind"] == "named"
    assert f"versions/{w.id}/{r.json()['version']['id']}.json" in s3.keys(f"versions/{w.id}/")
    as_user(app_url, w.id, ben, op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big "))
    versions = lambda: api.get(f"/api/maps/{w.id}/versions").json()["versions"]
    steps = 0
    for steps in range(1, VERSION_PROBES + 1):
        clock(app_url, VERSION_STEP_MS)
        if len(versions()) == 3:
            break
    else:
        pytest.fail("an automatic version is cut once the interval passes after a change")
    auto = versions()[-1]
    assert auto["kind"] == "auto" and auto["number"] == 3 and auto["by"] == ben
    for _ in range(steps + 1):
        clock(app_url, VERSION_STEP_MS)
    assert len(versions()) == 3, "no automatic version without a change"
    with editor(browser, app_url, o, w.id) as page:
        tool(page, "History").click()
        slider = page.get_by_role("dialog", name="History").get_by_role("slider", name="Version playback")
        expect(slider).to_have_attribute("aria-valuetext", f"Version 3 of 3 by {ben}")
        slider.focus()
        page.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", f"Version 2 of 3 by {o}")
        page.get_by_role("button", name="View version").click()
        expect(page).to_have_url(re.compile(rf"/m/{re.escape(w.id)}/versions/"))
        expect(shown(page, "This is version 2. Read only.")).to_be_visible()
        expect(page.get_by_role("button", name="Undo", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Restore this version")).to_be_visible()
        expect(page.get_by_role("combobox", name="Compare with")).to_be_visible()
        expect(item(page, "Stalls")).to_be_visible()


def test_version_diff(browser, app_url):
    o, ben, cara = uname("o"), uname("u"), uname("u")
    w = setup(app_url, "editor", "commenter", owner=o, users=[ben, cara], versions=[{"name": "Seeded", "by": o}])
    api, b = Api(app_url, o), Api(app_url, ben)
    as_user(app_url, w.id, o, op("add", topic_id="t-new", parent_id="t-root", after=None, title="Raffle"),
            op("add", topic_id="t-secret", parent_id="t-root", after=None, title="Prize money"),
            op("delete", topic_id="t-music"),
            op("move", topic_id="t-budget", parent_id="t-stalls", after=None),
            op("title", topic_id="t-vol", offset=0, delete=0, insert="Our "),
            op("move", topic_id="t-afternoon", parent_id="t-stalls", after=None),
            op("note", topic_id="t-afternoon", text="Shade"))
    as_user(app_url, w.id, o, op("restrict", topic_id="t-secret", restricted=True))
    assert b.ops(w.id, op("delete", topic_id="t-morning")).status_code == 200
    assert b.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
    v2 = api.post(f"/api/maps/{w.id}/versions", {"name": "After"}).json()["version"]["id"]
    v1 = w.versions[0]
    d = api.get(f"/api/maps/{w.id}/versions/diff", params={"from": v1, "to": v2}).json()
    assert sorted(d["added"]) == ["t-new", "t-secret"] and d["removed"] == ["t-music"]
    assert sorted(d["moved"]) == ["t-afternoon", "t-budget"] and sorted(d["edited"]) == ["t-afternoon", "t-vol"]
    assert d["summary"] == "Added 2, removed 1, moved 2, edited 2"
    c = Api(app_url, cara).get(f"/api/maps/{w.id}/versions/diff", params={"from": v1, "to": v2}).json()
    assert c["added"] == ["t-new"] and c["summary"] == "Added 1, removed 1, moved 2, edited 2"
    assert ID_SECRET not in json.dumps(Api(app_url, cara).get(f"/api/maps/{w.id}/versions/{v2}").json())
    with editor(browser, app_url, o, w.id, query=f"/versions/{v2}?compare={v1}", root="t-new") as page:
        expect(page.get_by_role("region", name="Changes")).to_contain_text("Added 2, removed 1, moved 2, edited 2")
        removed = page.get_by_role("list", name="Removed topics")
        expect(removed).to_contain_text("Music stage")
        expect(removed.locator('[data-diff="removed"]')).to_have_count(1)
        for tid, value in (("t-new", "added"), ("t-budget", "moved"), ("t-vol", "edited"), ("t-afternoon", "moved edited")):
            expect(topic(page, tid)).to_have_attribute("data-diff", value)
        assert topic(page, "t-morning").get_attribute("data-diff") in (None, "")


def test_version_restore(app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], versions=[{"name": "Seeded", "by": o}],
              root=fair(**{"t-stalls": {"note": "Ask early"}}),
              links=[{"id": "l1", "from": "t-stalls", "to": "t-budget", "label": "", "type": "related"}],
              boundaries=[{"id": "b1", "topic_id": "t-stalls", "label": ""}],
              comments=[{"id": gid("c"), "topic_id": "t-stalls", "author": ben, "body": "Tables?", "resolved": False, "replies": []}])
    api = Api(app_url, o)
    vid = w.versions[0]
    as_user(app_url, w.id, ben, op("delete", topic_id="t-stalls"), op("title", topic_id="t-budget", offset=0, delete=0, insert="Our "),
            op("layout", layout="org"))
    err(Api(app_url, ben).post(f"/api/maps/{w.id}/versions/{vid}/restore"), 403, "forbidden")
    r = api.post(f"/api/maps/{w.id}/versions/{vid}/restore")
    assert r.status_code == 200 and r.json()["status"] == "applied", r.text
    version = r.json()["version"]
    assert version["kind"] == "restore" and version["name"] == "Restored from version 1"
    snap = json.loads(S3().get(f"versions/{w.id}/{vid}.json"))
    m = api.map(w.id)
    topics = {t["id"]: t for t in m["topics"]}
    fields = ("parent_id", "rank", "title", "note", "task", "colour", "shape", "icon", "side_pin", "attachments")
    for t in snap["topics"]:
        assert {k: topics[t["id"]][k] for k in fields} == {k: t[k] for k in fields}, t["id"]
    assert set(topics) == {t["id"] for t in snap["topics"]}
    assert m["links"] == snap["links"] and m["boundaries"] == snap["boundaries"] and m["map"]["layout"] == "map"
    assert topics["t-stalls"]["comment_count"] == 1
    assert f"versions/{w.id}/{version['id']}.json" in S3().keys(f"versions/{w.id}/")
    assert api.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
    assert "t-stalls" not in api.topics(w.id) and api.map(w.id)["map"]["layout"] == "org"


def test_wf_version_history_replay_restore(browser, app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], versions=[{"name": "Seeded", "by": o}])
    vid = w.versions[0]
    as_user(app_url, w.id, ben, op("delete", topic_id="t-stalls"))
    v2 = Api(app_url, o).post(f"/api/maps/{w.id}/versions", {"name": "Lost stalls"}).json()["version"]["id"]
    with editor(browser, app_url, o, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        tool(mine, "History").click()
        slider = mine.get_by_role("slider", name="Version playback")
        slider.focus()
        mine.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", f"Version 1 of 2 by {o}")
        mine.get_by_role("button", name="View version").click()
        expect(shown(mine, "This is version 1. Read only.")).to_be_visible()
        mine.goto(f"{app_url}/m/{w.id}/versions/{vid}?compare={v2}")
        expect(mine.get_by_role("region", name="Changes")).to_contain_text("Added 0, removed 1, moved 0, edited 0")
        mine.get_by_role("button", name="Restore this version").click()
        expect(notices(mine)).to_contain_text("Restored version 1.")
        expect(topic(theirs, "t-stalls")).to_be_visible()
        mine.goto(f"{app_url}/m/{w.id}")
        expect(topic(mine, "t-stalls")).to_be_visible()
        tool(mine, "Undo").click()
        expect(topic(theirs, "t-stalls")).to_have_count(0)
    kinds = [v["kind"] for v in Api(app_url, o).get(f"/api/maps/{w.id}/versions").json()["versions"]]
    assert kinds[-1] == "restore" and "t-stalls" not in Api(app_url, o).topics(w.id)


def test_wf_version_history_outage(browser, app_url):
    w = setup(app_url, "editor")
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        with storage_down(app_url):
            save_version(page)
            expect(shown(page, "File storage is unavailable. The version was not saved. Try again in a moment.")).to_be_visible()
            assert api.get(f"/api/maps/{w.id}/versions").json()["versions"] == []
            page.keyboard.press("Escape")
        save_version(page)
        expect(notices(page)).to_contain_text("Saved version 1.")
    versions = api.get(f"/api/maps/{w.id}/versions").json()["versions"]
    assert [v["number"] for v in versions] == [1]
    assert f"versions/{w.id}/{versions[0]['id']}.json" in S3().keys(f"versions/{w.id}/")


def test_slides_and_presenter(browser, app_url):
    w = setup(app_url, "editor", root=fair(**{"t-stalls": {"note": "Bring **chairs**"}}), slides=["t-stalls", "t-music", "t-budget"])
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        start = tool(page, "Start presentation")
        start.click()
        presenter = page.get_by_role("region", name="Presenter")
        expect(presenter).to_contain_text("/p/")
        code = re.search(r"/p/([A-Za-z0-9_-]+)", presenter.inner_text()).group(1)
        slides = presenter.get_by_role("list", name="Slides")
        slides.get_by_role("listitem").filter(has_text="Budget").click()
        page.keyboard.press("Alt+ArrowUp")
        eventually(lambda: api.map(w.id)["slides"] == ["t-stalls", "t-budget", "t-music"], "slide reorder stored", page)
        topic(page, "t-vol").click()
        presenter.get_by_role("button", name="Add slide").click()
        eventually(lambda: api.map(w.id)["slides"] == ["t-stalls", "t-budget", "t-music", "t-vol"], "Add slide appends", page)
        presenter.get_by_role("button", name="Go live").click()
        expect(presenter).to_contain_text("Slide 1 of 4")
        notes = presenter.get_by_role("region", name="Speaker notes")
        expect(notes).to_contain_text(NOTE_CHAIRS)
        expect(notes).not_to_contain_text("**")
        expect(presenter).to_contain_text("0 following")
        with browse(browser, app_url, None, f"/p/{code}", PHONE) as audience:
            expect(audience.get_by_role("region", name="Slide", exact=True)).to_contain_text("Stalls")
            expect(presenter).to_contain_text("1 following")
            as_user(app_url, w.id, w.owner, op("delete", topic_id="t-budget"))
            page.keyboard.press("ArrowRight")
            expect(notices(page)).to_contain_text("Slide 2 was skipped: its topic was deleted.")
            expect(presenter).to_contain_text("Slide 3 of 4")
            as_user(app_url, w.id, w.owner, op("note", topic_id="t-music", text="Turn it up"))
            expect(notes).to_contain_text(NOTE_LOUD)
            as_user(app_url, w.id, w.owner, op("restrict", topic_id="t-vol", restricted=True))
            page.keyboard.press("ArrowRight")
            expect(notices(page)).to_contain_text("Slide 4 was skipped: it is restricted.")
            expect(presenter).to_contain_text("Slide 3 of 4")
        expect(presenter).to_contain_text("0 following")
        page.keyboard.press("Escape")
        expect(start).to_be_focused()
    assert httpx.get(f"{app_url}/api/presentations/by-code/{code}").json()["state"] == "ended"


def test_presentation_camera(browser, app_url):
    w = setup(app_url, slides=["t-stalls", "t-vol"], presentation={"state": "waiting"})
    pid, code = w.presentation["id"], w.presentation["code"]
    owner = Api(app_url, w.owner)
    with browse(browser, app_url, None, f"/p/{code}", PHONE) as glide, \
            browse(browser, app_url, None, f"/p/{code}", PHONE, reduced_motion="reduce") as cut:
        assert owner.post(f"/api/presentations/{pid}/state", {"to": "live"}).status_code == 200
        frames = [page.get_by_role("region", name="Slide", exact=True).locator("[data-zoom]") for page in (glide, cut)]
        for page in (glide, cut):
            expect(page.get_by_role("region", name="Slide", exact=True)).to_contain_text("Stalls")
            page.evaluate(ANIMATION_HOOK)
        assert owner.post(f"/api/presentations/{pid}/step", {"index": 1}).status_code == 200
        for page in (glide, cut):
            expect(page.get_by_role("region", name="Slide", exact=True).get_by_text("Morning shift")).to_be_in_viewport()
        final = [tuple(f.get_attribute(a) for a in ("data-zoom", "data-pan-x", "data-pan-y")) for f in frames]
        assert final[0] == final[1], "both screens settle on the same frame"
        assert float(final[0][0]) <= 1
        camera = [r for r in glide.evaluate(READ_ANIMS, ["camera"])]
        assert camera, "the step runs the camera animation"
        last = camera[-1]
        assert last["duration"] == CAMERA_MS and last["duration"] < CAMERA_MAX_MS and len(last["frames"]) == 2
        end = re.findall(r"-?[\d.]+", last["frames"][1]["transform"])
        assert [round(float(v), 2) for v in end[:3]] == [round(float(final[0][1]), 2), round(float(final[0][2]), 2), round(float(final[0][0]), 2)]
        assert cut.evaluate(READ_ANIMS, ["camera"]) == []


def test_audience_session_states(browser, app_url):
    w = setup(app_url, root=fair(**{"t-stalls": {"note": SECRET_NOTE}}), slides=["t-stalls", MUSIC_ID, BUDGET_ID],
              presentation={"state": "waiting"})
    pid, code = w.presentation["id"], w.presentation["code"]
    owner = Api(app_url, w.owner)
    err(owner.post(f"/api/maps/{w.id}/presentations"), 409, "already_presenting")

    step_waiting = owner.post(f"/api/presentations/{pid}/step", {"index": 1})
    assert step_waiting.status_code == 409
    as_user(app_url, w.id, w.owner, op("restrict", topic_id=BUDGET_ID, restricted=True))
    with browse(browser, app_url, None, f"/p/{code}", PHONE, device_time=DEVICE_TIME) as page:
        status = page.get_by_role("status", name="Presentation status")
        expect(status).to_have_text(f"The presentation hasn't started yet. It will appear here when {w.owner} goes live.")
        assert owner.post(f"/api/presentations/{pid}/state", {"to": "live"}).json()["presentation"]["state"] == "live"
        card = page.get_by_role("region", name="Slide", exact=True)
        expect(card).to_contain_text("Stalls")
        assert status.bounding_box()["y"] >= card.bounding_box()["y"], "the status line sits under the presentation slide card"
        err(owner.post(f"/api/presentations/{pid}/state", {"to": "live"}), 409, "invalid_transition")
        assert owner.post(f"/api/presentations/{pid}/step", {"index": 1}).status_code == 200
        expect(card).to_contain_text("Music stage")
        body = httpx.get(f"{app_url}/api/presentations/by-code/{code}").text
        assert SECRET_NOTE not in body and BUDGET_ID not in body
        touch = Touch(page)
        x, y = center(card)
        touch.start((x, y)); touch.move((x + SWIPE_PX + 30, y)); touch.end()
        expect(card).to_contain_text("Stalls")
        back = page.get_by_role("button", name="Back to live")
        expect(back).to_be_visible()
        back.click()
        expect(card).to_contain_text("Music stage")
        expect(back).to_be_hidden()
        touch.start((x, y)); touch.move((x - SWIPE_PX - 30, y)); touch.end()
        expect(card).to_contain_text("Music stage")
        assert owner.post(f"/api/presentations/{pid}/state", {"to": "ended"}).status_code == 200
        expect(status).to_have_text("This presentation has ended.")
    err(owner.post(f"/api/presentations/{pid}/state", {"to": "live"}), 409, "session_ended")


def test_wf_presentation_audience(browser, app_url):
    w = setup(app_url, "editor", slides=["t-stalls", "t-music", "t-budget"])
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as page:
        tool(page, "Start presentation").click()
        presenter = page.get_by_role("region", name="Presenter")
        expect(presenter).to_contain_text("/p/")
        code = re.search(r"/p/([A-Za-z0-9_-]+)", presenter.inner_text()).group(1)
        with browse(browser, app_url, None, f"/p/{code}", PHONE) as audience:
            status = audience.get_by_role("status", name="Presentation status")
            expect(status).to_have_text(f"The presentation hasn't started yet. It will appear here when {w.owner} goes live.")
            presenter.get_by_role("button", name="Go live").click()
            card = audience.get_by_role("region", name="Slide", exact=True)
            expect(card).to_contain_text("Stalls")
            page.keyboard.press("ArrowRight")
            expect(card).to_contain_text("Music stage")
            as_user(app_url, w.id, ben, op("delete", topic_id="t-budget"))
            page.keyboard.press("ArrowRight")
            expect(notices(page)).to_contain_text("Slide 3 was skipped: its topic was deleted.")
            as_user(app_url, w.id, ben, op("title", topic_id="t-music", offset=6, delete=5, insert="tent"))
            expect(card).to_contain_text(MUSIC_TENT)
            presenter.get_by_role("button", name="End presentation").click()
            expect(status).to_have_text("This presentation has ended.")
    by_code = httpx.get(f"{app_url}/api/presentations/by-code/{code}").json()
    assert by_code["state"] == "ended" and by_code["slide_index"] == 1


def test_wf_presentation_paused(browser, app_url):
    w = setup(app_url, slides=["t-stalls"])
    away = "The presenter has stepped away. The show will continue here."
    with editor(browser, app_url, w.owner, w.id) as page:
        tool(page, "Start presentation").click()
        presenter = page.get_by_role("region", name="Presenter")
        expect(presenter).to_contain_text("/p/")
        code = re.search(r"/p/([A-Za-z0-9_-]+)", presenter.inner_text()).group(1)
        go_live = presenter.get_by_role("button", name="Go live")
        go_live.click()
        state = lambda: httpx.get(f"{app_url}/api/presentations/by-code/{code}").json()["state"]
        with browse(browser, app_url, None, f"/p/{code}", PHONE) as audience:
            status = audience.get_by_role("status", name="Presentation status")
            card = audience.get_by_role("region", name="Slide", exact=True)
            expect(card).to_contain_text("Stalls")
            page.get_by_role("switch", name="Work offline").click()
            clock(app_url, PRESENTER_GRACE_MS)
            expect(status).to_have_text(away)
            assert state() == "paused"
            page.get_by_role("switch", name="Work offline").click()

            def resumed() -> bool:
                current = state()
                if current == "paused" and go_live.count() and go_live.is_enabled():
                    go_live.click()
                return current == "live"
            eventually(resumed, "the presenter's return resumes the show", page)
            expect(status).not_to_have_text(away)
            expect(card).to_contain_text("Stalls")


def test_permission_table(app_url):
    o, ed, co, vi = uname("o"), uname("u"), uname("u"), uname("u")
    w = setup(app_url, "editor", "commenter", "viewer", owner=o, users=[ed, co, vi], versions=[{"name": "Seeded", "by": o}])
    edit, talk = {"owner", "editor"}, {"owner", "editor", "commenter"}
    stranger = uname("x")
    seed(app_url, [stranger], [])
    err(Api(app_url, stranger).get(f"/api/maps/{w.id}"), 404, "not_found")
    for user, role in ((vi, "viewer"), (co, "commenter"), (ed, "editor"), (o, "owner")):
        api = Api(app_url, user)
        def check(r: httpx.Response, ok: int, allowed: bool, what: str) -> None:
            assert r.status_code == (ok if allowed else 403), f"{role} {what}: {r.status_code} {r.text}"
            if not allowed:
                assert r.json()["error"] == "forbidden"
        check(api.ops(w.id, op("title", topic_id="t-stalls", offset=0, delete=0, insert="x")), 200, role in edit, "edit")
        check(api.post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "Hi", "reply_to": None}), 201, role in talk, "comment")
        check(api.put(f"/api/maps/{w.id}/topics/t-stalls/vote", {"voted": True}), 200, role in talk, "vote")
        check(api.ops(w.id, op("lock", topic_id="t-music")), 200, role in edit, "lock")
        if role in edit:
            assert api.ops(w.id, op("unlock", topic_id="t-music")).status_code == 200
        check(api.ops(w.id, op("restrict", topic_id="t-budget", restricted=False)), 200, role == "owner", "restrict")
        check(api.put(f"/api/maps/{w.id}/members/{vi}", {"role": "viewer"}), 200, role == "owner", "manage roles")
        check(api.get(f"/api/maps/{w.id}/links"), 200, role == "owner", "manage links")
        check(api.post(f"/api/maps/{w.id}/versions/{w.versions[0]}/restore"), 200, role == "owner", "restore")
        check(api.post(f"/api/maps/{w.id}/presentations"), 201, role == "owner", "present")
        assert api.post(f"/api/maps/{w.id}/exports", {"format": "sprig", "topic_id": None}).status_code == 202
        assert api.put(f"/api/maps/{w.id}/collapse", {"topic_id": "t-vol", "collapsed": True}).status_code == 204
        if role != "owner":
            err(api.delete(f"/api/maps/{w.id}"), 403, "forbidden")
    assert Api(app_url, o).delete(f"/api/maps/{w.id}").status_code == 204
    err(Api(app_url, o).get(f"/api/maps/{w.id}"), 404, "not_found")


def test_live_role_change(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    owner = Api(app_url, w.owner)
    with editor(browser, app_url, ben, w.id) as page:
        expect(tool(page, "Import outline")).to_be_visible()
        focus_topic(page, "t-stalls")
        assert owner.put(f"/api/maps/{w.id}/members/{ben}", {"role": "commenter"}).status_code == 200
        expect(said(page)).to_contain_text("Your role is now commenter.")
        expect(tool(page, "Import outline")).to_have_count(0)
        expect(topic(page, "t-stalls")).to_be_focused()
        assert owner.delete(f"/api/maps/{w.id}/members/{ben}").status_code == 204
        expect(shown(page, "You no longer have access to this map.")).to_be_visible()
        expect(page.get_by_role("link", name="Your maps")).to_be_visible()
        expect(tree(page)).to_have_count(0)
    err(Api(app_url, ben).get(f"/api/maps/{w.id}"), 404, "not_found")


def test_branch_locks(browser, app_url):
    w = setup(app_url, "editor", "editor")
    ben, cara = w.users
    b, c, o = Api(app_url, ben), Api(app_url, cara), Api(app_url, w.owner)
    assert b.ops(w.id, op("lock", topic_id="t-vol")).status_code == 200
    t = o.topics(w.id)
    assert t["t-vol"]["locked_by"] == ben and t["t-morning"]["lock_inherited"] is True
    with editor(browser, app_url, cara, w.id) as page:
        for tid in ("t-vol", "t-morning"):
            expect(topic(page, tid)).to_have_accessible_name(re.compile(r", locked$"))
            expect(topic(page, tid)).to_contain_text(f"Locked by {ben}")
        expect(topic(page, "t-stalls")).not_to_have_accessible_name(re.compile(r", locked$"))
    err(c.ops(w.id, op("title", topic_id="t-morning", offset=0, delete=0, insert="x")), 403, "branch_locked")
    err(c.ops(w.id, op("move", topic_id="t-stalls", parent_id="t-vol", after=None)), 403, "branch_locked")
    assert c.ops(w.id, op("lock", topic_id="t-morning")).status_code != 200
    assert c.ops(w.id, op("unlock", topic_id="t-vol")).status_code == 403
    assert b.ops(w.id, op("title", topic_id="t-morning", offset=0, delete=0, insert="Early ")).status_code == 200
    assert o.ops(w.id, op("title", topic_id="t-afternoon", offset=0, delete=0, insert="Late ")).status_code == 200
    assert o.topics(w.id)["t-vol"]["locked_by"] == ben
    assert o.ops(w.id, op("unlock", topic_id="t-vol")).status_code == 200
    assert o.topics(w.id)["t-morning"]["locked_by"] is None
    assert c.ops(w.id, op("title", topic_id="t-morning", offset=0, delete=0, insert="x")).status_code == 200


def test_share_links(browser, app_url):
    w = setup(app_url, "editor", share_links=[{"role": "commenter", "expires_in_ms": LINK_EXPIRY_MS}])
    other = setup(app_url)
    code = w.links["commenter"]
    owner = Api(app_url, w.owner)
    info = httpx.get(f"{app_url}/api/share/{code}").json()
    assert info["role"] == "commenter" and info["state"] == "active" and info["map_id"] == w.id
    err(Api(app_url, w.users[0]).post(f"/api/maps/{w.id}/links", {"role": "viewer", "expires_at": None}), 403, "forbidden")
    err(owner.post(f"/api/maps/{w.id}/links", {"role": "viewer", "expires_at": "2000-01-01T00:00:00Z"}), 422, "invalid")
    assert httpx.post(f"{app_url}/api/share/{code}/join", json={"display_name": ""}).status_code == 422
    with editor(browser, app_url, w.owner, w.id) as mine, browse(browser, app_url, None, f"/s/{code}", device_time=DEVICE_TIME) as guest:
        join = guest.get_by_role("dialog", name="Join map")
        join.get_by_role("textbox", name="Your name").fill("Pat Guest")
        guest.keyboard.press("Escape")
        expect(join).to_be_visible()
        join.get_by_role("button", name="Join", exact=True).click()
        expect(topic(guest, "t-root")).to_be_visible()
        expect(mine.get_by_role("list", name="People here")).to_contain_text(f"{GUEST_PAT} (guest)")
        focus_topic(guest, "t-stalls")
        guest.keyboard.press("Tab")
        expect(said(guest)).to_contain_text("You can view this map but not edit it.")
        assert guest.request.get(f"{app_url}/api/maps/{other.id}").status == 404
        clock(app_url, LINK_EXPIRY_MS)
        expect(shown(guest, "This link has expired.")).to_be_visible()
    err(httpx.get(f"{app_url}/api/share/{code}"), 404, "link_expired")
    link = owner.post(f"/api/maps/{w.id}/links", {"role": "viewer", "expires_at": None}).json()["link"]
    assert link["state"] == "active" and link["url"] == f"/s/{link['code']}"
    with browse(browser, app_url, None, f"/s/{link['code']}") as guest:
        guest.get_by_role("dialog", name="Join map").get_by_role("textbox", name="Your name").fill("Lee Guest")
        guest.get_by_role("button", name="Join", exact=True).click()
        expect(topic(guest, "t-root")).to_be_visible()
        fresh = owner.post(f"/api/maps/{w.id}/links/{link['id']}/regenerate").json()["link"]
        assert fresh["code"] != link["code"]
        expect(shown(guest, "This link was turned off by the map's owner.")).to_be_visible()
    err(httpx.get(f"{app_url}/api/share/{link['code']}"), 404, "link_revoked")
    assert httpx.get(f"{app_url}/api/share/{fresh['code']}").json()["state"] == "active"
    assert owner.delete(f"/api/maps/{w.id}/links/{fresh['id']}").status_code == 204
    err(owner.delete(f"/api/maps/{w.id}/links/{fresh['id']}"), 409, "invalid_transition")
    err(httpx.get(f"{app_url}/api/share/{fresh['code']}"), 404, "link_revoked")


def test_restricted_branches(browser, app_url):
    o, cara = uname("o"), uname("u")
    w = setup(app_url, "commenter", owner=o, users=[cara], versions=[{"name": "Seeded", "by": o}],
              root=fair(**{"t-stalls": {"task": task(0)},
                           "t-budget": {"restricted": True, "children": [node("t-cost", "Hall cost", task=task(0))]}}),
              links=[{"id": "l1", "from": "t-stalls", "to": "t-cost", "label": "", "type": "depends"}],
              comments=[{"id": gid("c"), "topic_id": "t-cost", "author": o, "body": "Ouch", "resolved": False, "replies": []}])
    c, api = Api(app_url, cara), Api(app_url, o)
    m = c.map(w.id)
    ids = {t["id"] for t in m["topics"]}
    assert BUDGET_ID not in ids and ID_COST not in ids and m["links"] == []
    root = next(t for t in m["topics"] if t["id"] == "t-root")
    stalls = next(t for t in m["topics"] if t["id"] == "t-stalls")
    assert root["derived"]["subtopics"] == 5 and root["derived"]["blocked_count"] == 0 and stalls["derived"]["blocked_by"] == []
    assert api.topics(w.id)["t-stalls"]["derived"]["blocked_by"] == ["t-cost"]
    err(c.get(f"/api/maps/{w.id}/topics/t-cost/comments"), 404, "not_found")
    text, _, _ = export_bytes(c, w.id, "sprig")
    assert b"Stalls" in text and b"Budget" not in text and b"Hall cost" not in text
    assert BUDGET_ID not in json.dumps(c.get(f"/api/maps/{w.id}/versions/{w.versions[0]}").json())
    as_user(app_url, w.id, o, op("add", topic_id="t-fee", parent_id="t-budget", after=None, title="Fee"))
    v2 = api.post(f"/api/maps/{w.id}/versions", {"name": "Fees"}).json()["version"]["id"]
    assert c.get(f"/api/maps/{w.id}/versions/diff", params={"from": w.versions[0], "to": v2}).json()["added"] == []
    with editor(browser, app_url, cara, w.id) as page:
        expect(topic(page, "t-budget")).to_have_count(0)
        expect(topic(page, "t-stalls")).to_have_attribute("aria-setsize", "3")
        expect(page.get_by_role("complementary", name="Outline")).not_to_contain_text("Budget")
        focus_topic(page, "t-root")
        page.keyboard.press("Control+f")
        search = page.get_by_role("search", name="Find in map")
        search.get_by_role("textbox", name="Find").fill("Budget")
        expect(search).to_contain_text("No matches")
        page.keyboard.press("Escape")
        as_user(app_url, w.id, o, op("restrict", topic_id="t-budget", restricted=False))
        expect(topic(page, "t-budget")).to_be_visible()
        expect(topic(page, "t-stalls")).to_have_attribute("aria-setsize", "4")


def test_wf_sharing_roles_share_and_restrict(browser, app_url):
    w = setup(app_url)
    ben = uname("u")
    seed(app_url, [ben], [])
    owner = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as mine:
        tool(mine, "Share").click()
        share = mine.get_by_role("dialog", name="Share", exact=True)
        share.get_by_role("textbox", name="Invite username").fill(ben)
        select_role(share.get_by_role("combobox", name="Role", exact=True), "Editor")
        share.get_by_role("button", name="Invite", exact=True).click()
        expect(share.get_by_role("list", name="People with access")).to_contain_text(ben)
        with editor(browser, app_url, ben, w.id) as theirs:
            expect(tool(theirs, "Import outline")).to_be_visible()
            select_role(share.get_by_role("combobox", name=f"Role for {ben}"), "Commenter")
            expect(said(theirs)).to_contain_text("Your role is now commenter.")
            as_user(app_url, w.id, w.owner, op("restrict", topic_id="t-budget", restricted=True))
            expect(topic(theirs, "t-budget")).to_have_count(0)
            select_role(share.get_by_role("combobox", name="Link role"), "Viewer")
            share.get_by_role("button", name="Create link").click()
            links = share.get_by_role("list", name="Share links")
            expect(links.get_by_role("button", name="Turn off")).to_have_count(1)
            links.get_by_role("button", name="Turn off").click()
            share.get_by_role("button", name=f"Remove {ben}").click()
            expect(shown(theirs, "You no longer have access to this map.")).to_be_visible()
    assert all(m["username"] != ben for m in owner.get(f"/api/maps/{w.id}/members").json()["members"])
    assert [l["state"] for l in owner.get(f"/api/maps/{w.id}/links").json()["links"]] == ["revoked"]
    assert owner.topics(w.id)["t-budget"]["restricted"] is True


def test_wf_sharing_roles_link_expiry(browser, app_url):
    w = setup(app_url, share_links=[{"role": "viewer", "expires_in_ms": LINK_EXPIRY_MS}])
    code = w.links["viewer"]
    with editor(browser, app_url, w.owner, w.id) as mine, browse(browser, app_url, None, f"/s/{code}") as guest:
        guest.get_by_role("dialog", name="Join map").get_by_role("textbox", name="Your name").fill("Sam Guest")
        guest.get_by_role("button", name="Join", exact=True).click()
        expect(mine.get_by_role("list", name="People here")).to_contain_text(f"{GUEST_SAM} (guest)")
        clock(app_url, LINK_EXPIRY_MS)
        expect(shown(guest, "This link has expired.")).to_be_visible()
        expect(tree(guest)).to_have_count(0)
    err(httpx.get(f"{app_url}/api/share/{code}"), 404, "link_expired")


def test_task_rollups(browser, app_url):
    o, ben = uname("o"), uname("u")
    root = node("t-root", "Plan",
                node("t-p", "Party", node("t-a", "Hire band", task=task(50, 2, due="2020-01-01")),
                     node("t-b", "Book hall", task=task(100, 1)), node("t-c", "Fireworks", task=task(0, 3, "cancelled")),
                     node("t-d", "Thank-you notes", task=task(0, 0, due="2020-01-02"))),
                node("t-q", "Quiz", task=task(0, 1)))
    w = setup(app_url, "editor", owner=o, users=[ben], root=root)
    api = Api(app_url, o)
    m = api.map(w.id)
    t = {x["id"]: x for x in m["topics"]}
    assert t["t-p"]["derived"]["percent"] == 67 and t["t-root"]["derived"]["percent"] == 34
    assert t["t-p"]["derived"]["earliest_due"] == DUE_FIRST and t["t-p"]["derived"]["overdue"] is True
    assert m["server_date"] > DUE_SECOND
    dash = setup(app_url, root=node("t-root", "Dash", node("t-z1", "One", task=task(0, 0)), node("t-z2", "Two", task=task(0, 0))))
    assert Api(app_url, dash.owner).topics(dash.id)["t-root"]["derived"]["percent"] == "dash"
    with editor(browser, app_url, o, w.id) as desk, editor(browser, app_url, ben, w.id, size=PHONE) as phone:
        expect(topic(desk, "t-p")).to_have_attribute("data-percent", "67")
        expect(topic(desk, "t-root")).to_have_attribute("data-percent", "34")
        expect(topic(desk, "t-p")).to_have_accessible_name(re.compile(r", 67% done"))
        expect(topic(desk, "t-p")).to_contain_text("Overdue")
        sheet = open_details(phone, Touch(phone), "t-a")
        sheet.get_by_role("tab", name="Task").click()
        sheet.get_by_role("checkbox", name="Done").check()
        for page in (desk, phone):
            expect(topic(page, "t-p")).to_have_attribute("data-percent", "100")
            expect(topic(page, "t-root")).to_have_attribute("data-percent", "50")
    t = api.topics(w.id)
    assert t["t-a"]["task"]["percent"] == 100 and t["t-p"]["derived"]["earliest_due"] == DUE_SECOND
    with editor(browser, app_url, dash.owner, dash.id) as page:
        expect(topic(page, "t-root")).to_have_attribute("data-percent", "")
        expect(topic(page, "t-root")).to_contain_text("—")
        expect(topic(page, "t-root")).not_to_have_accessible_name(re.compile(r"% done"))


def test_dependencies(browser, app_url):
    root = node("t-root", "Deps", node("t-p", "Prep", node("t-a", "Hire band", task=task(0)), node("t-b", "Book hall", task=task(0)),
                                       node("t-c", "Notes")))
    w = setup(app_url, root=root, links=[{"id": "l1", "from": "t-a", "to": ID_B, "label": "", "type": "depends"},
                                         {"id": "l2", "from": "t-a", "to": "t-c", "label": "", "type": "depends"}])
    api = Api(app_url, w.owner)
    t = api.topics(w.id)
    assert t["t-a"]["derived"]["blocked_by"] == [ID_B] and t["t-p"]["derived"]["blocked_count"] == 1
    r = api.ops(w.id, op("link_add", link_id="l3", **{"from": ID_B}, to="t-a", label="", type="depends")).json()
    assert r["status"] == "rejected" and r["results"][0]["reason"] == "dependency_loop"
    with editor(browser, app_url, w.owner, w.id) as page:
        expect(topic(page, "t-a")).to_contain_text(BLOCKED_BY_HALL)
        expect(topic(page, "t-p")).to_contain_text("1 blocked")
        expect(topic(page, "t-p")).to_have_accessible_name(re.compile(r", 1 blocked"))
        focus_topic(page, "t-b")
        page.keyboard.press("Control+Shift+L")
        dialog = page.get_by_role("dialog", name="Add cross-link")
        select(dialog.get_by_role("combobox", name="Link to"), "Hire band")
        dialog.get_by_role("radio", name="Depends on").check()
        dialog.get_by_role("button", name="Add link").click()
        expect(notices(page)).to_contain_text("That would make a dependency loop.")
        as_user(app_url, w.id, w.owner, op("task", topic_id=ID_B, task={"percent": 100}))
        expect(topic(page, "t-a")).not_to_contain_text("Blocked by")
        expect(topic(page, "t-p")).not_to_contain_text("1 blocked")
        as_user(app_url, w.id, w.owner, op("task", topic_id=ID_B, task={"percent": 0}))
        expect(topic(page, "t-a")).to_contain_text(BLOCKED_BY_HALL)
        as_user(app_url, w.id, w.owner, op("task", topic_id=ID_B, task={"state": "cancelled"}))
        expect(topic(page, "t-a")).not_to_contain_text("Blocked by")
        as_user(app_url, w.id, w.owner, op("task", topic_id=ID_B, task={"state": "open"}))
        expect(topic(page, "t-a")).to_contain_text(BLOCKED_BY_HALL)
        as_user(app_url, w.id, w.owner, op("delete", topic_id=ID_B))
        expect(topic(page, "t-a")).not_to_contain_text("Blocked by")
    assert all(l["to"] != ID_B for l in api.map(w.id)["links"])
    assert api.topics(w.id)["t-p"]["derived"]["blocked_count"] == 0


def test_style_cascade_and_themes(browser, app_url):
    w = setup(app_url, floating=[{"id": "f1", "title": "Ideas", "x": 0, "y": 300, "children": []}])
    api = Api(app_url, w.owner)
    with editor(browser, app_url, w.owner, w.id) as page:
        expected = {"t-root": "accent", "t-stalls": "indigo", "t-music": "azure", "t-vol": "teal", "t-morning": "teal",
                    "t-budget": "green", "f1": "indigo"}
        for tid, colour in expected.items():
            expect(topic(page, tid)).to_have_attribute("data-colour", colour)
        expect(topic(page, "t-root")).to_have_attribute("data-shape", "rounded")
        expect(topic(page, "t-root")).to_have_attribute("data-text", "white")
        expect(topic(page, "t-stalls")).to_have_attribute("data-shape", "pill")
        expect(topic(page, "t-stalls")).to_have_attribute("data-text", "ink")
        as_user(app_url, w.id, w.owner, op("style", topic_id="t-vol", colour="violet"), op("style", topic_id="t-stalls", icon="star"),
                op("style", topic_id="t-budget", colour="#ffeeaa"), op("style", topic_id="t-music", colour="#102030"))
        expect(topic(page, "t-morning")).to_have_attribute("data-colour", "violet")
        expect(topic(page, "t-stalls")).to_have_attribute("data-icon", "star")
        page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Dusk").click()
        for tid, text in (("t-stalls", "white"), ("t-morning", "white"), ("t-budget", "ink"), ("t-music", "white")):
            expect(topic(page, tid)).to_have_attribute("data-shape", "filled")
            expect(topic(page, tid)).to_have_attribute("data-text", text)
        as_user(app_url, w.id, w.owner, op("style", topic_id="t-vol", colour="azure"))
        expect(topic(page, "t-morning")).to_have_attribute("data-text", "ink")
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-morning", parent_id="t-stalls", after=None))
        expect(topic(page, "t-morning")).to_have_attribute("data-colour", "indigo")
        expect(topic(page, "t-morning")).to_have_attribute("data-text", "white")
        page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Paper").click()
        expect(topic(page, "t-stalls")).to_have_attribute("data-shape", "underline")
        expect(topic(page, "t-stalls")).to_have_attribute("data-text", "ink")
    assert api.map(w.id)["map"]["theme"] == "paper"
    for i in range(8):
        assert api.ops(w.id, op("custom_colour", colour=f"#0000{i:02x}")).status_code == 200
    err(api.ops(w.id, op("custom_colour", colour="#abcdef")), 422, "invalid")
    assert len(api.map(w.id)["map"]["custom_colours"]) == 8


@pytest.mark.timeout(900)
def test_large_maps(browser, app_url):
    probe = setup(app_url)
    settings = Api(app_url, probe.owner).map(probe.id)["settings"]
    small = setup(app_url, root=node("t-root", "x"), generate={"topics": settings["virtual_from"] - 1, "fanout": 4})
    with editor(browser, app_url, small.owner, small.id, root="g0") as page:
        expect(tree(page).get_by_role("treeitem")).to_have_count(settings["virtual_from"] - 1)
    big = setup(app_url, root=node("t-root", "x"), generate={"topics": LARGE_MAP, "fanout": 4})
    with browse(browser, app_url, big.owner, "/maps") as page:
        started = time.monotonic()
        page.goto(f"{app_url}/m/{big.id}")
        expect(topic(page, "g0")).to_be_focused()
        assert time.monotonic() - started <= LOAD_BUDGET_S, "a 2,000-topic editor is usable within three seconds"
        count = tree(page).get_by_role("treeitem").count()
        assert count <= settings["dom_ceiling"] and count < LARGE_MAP
        page.keyboard.press("End")
        last = topic(page, "g1364")
        expect(last).to_be_focused()
        expect(last).to_have_attribute("aria-level", "6")
        expect(last).to_have_attribute("aria-posinset", "4")
        expect(last).to_have_attribute("aria-setsize", "4")
        expect(last).to_be_in_viewport()
        assert tree(page).get_by_role("treeitem").count() <= settings["dom_ceiling"]
        page.keyboard.press("Home")
        expect(topic(page, "g0")).to_be_focused()
        expect(topic(page, "g0")).to_have_accessible_name(re.compile(rf"^Generated map, level 1, 1 of 1, {LARGE_MAP - 1} subtopics"))


@pytest.mark.timeout(900)
def test_wf_rollups_style_large_map(browser, app_url):
    w = setup(app_url, "editor", root=node("t-root", "x"), generate={"topics": 400, "fanout": 3})
    ben = w.users[0]
    as_user(app_url, w.id, w.owner, op("task", topic_id="g4", task={"percent": 0, "weight": 1}),
            op("task", topic_id="g5", task={"percent": 50, "weight": 1}),
            op("link_add", link_id="l1", **{"from": "g6"}, to="g4", label="", type="depends"))
    with editor(browser, app_url, w.owner, w.id, root="g0") as desk, \
            editor(browser, app_url, ben, w.id, size=PHONE, root="g0", query="?topic=g4") as phone:
        expect(topic(phone, "g4")).to_be_in_viewport()
        expect(topic(desk, "g1")).to_have_attribute("data-percent", str(rollup((1, 0), (1, 50))))
        expect(topic(desk, "g1")).to_contain_text("1 blocked")
        sheet = open_details(phone, Touch(phone), "g4")
        sheet.get_by_role("tab", name="Task").click()
        sheet.get_by_role("checkbox", name="Done").check()
        for page in (desk, phone):
            expect(topic(page, "g1")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 50))))
            expect(topic(page, "g1")).not_to_contain_text("1 blocked")
        api = Api(app_url, w.owner)
        assert api.ops(w.id, op("move", topic_id="g1", parent_id="g2", after=None)).status_code == 200
        for page in (desk, phone):
            expect(topic(page, "g2")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 50))))
        with editor(browser, app_url, w.owner, w.id, root="g1", query="?topic=g1") as moved:
            expect(topic(moved, "g1")).to_have_attribute("data-colour", BRANCH_COLOURS[0])
        assert api.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
        for page in (desk, phone):
            expect(topic(page, "g1")).to_have_attribute("data-colour", BRANCH_COLOURS[0])
        with editor(browser, app_url, w.owner, w.id, root="g2", query="?topic=g2") as restored:
            expect(topic(restored, "g2")).to_have_attribute("data-colour", BRANCH_COLOURS[1])
    t = Api(app_url, ben).topics(w.id)
    assert t["g1"]["derived"]["percent"] == rollup((1, 100), (1, 50)) and t["g1"]["derived"]["blocked_count"] == 0 and t["g1"]["parent_id"] == "g0"


@pytest.mark.timeout(900)
def test_wf_rollups_style_collapse(browser, app_url):
    w = setup(app_url, root=node("t-root", "x"), generate={"topics": 400, "fanout": 3})
    with editor(browser, app_url, w.owner, w.id, root="g0") as page:
        focus_topic(page, "g1")
        page.keyboard.press("Space")
        expect(topic(page, "g1")).to_have_attribute("aria-expanded", "false")
        expect(topic(page, "g4")).to_have_count(0)
        expect(topic(page, "g2")).to_have_attribute("aria-setsize", "3")
        page.keyboard.press("ArrowDown")
        expect(topic(page, "g2")).to_be_focused()
        page.keyboard.press("Home")
        expect(topic(page, "g0")).to_have_accessible_name(re.compile(r", \d+ subtopics"))
    assert Api(app_url, w.owner).map(w.id)["collapsed"] == ["g1"]


def test_comments_and_mentions(browser, app_url):
    w = setup(app_url, "editor", "commenter", "viewer")
    ben, cara, vic = w.users
    with editor(browser, app_url, ben, w.id) as desk, editor(browser, app_url, cara, w.id, size=PHONE) as phone:
        expect(desk.get_by_role("button", name=inbox_name(0))).to_be_visible()
        sheet = open_details(phone, Touch(phone), "t-stalls")
        sheet.get_by_role("tab", name="Comments").click()
        box = sheet.get_by_role("textbox", name="Add a comment")
        box.click()
        phone.keyboard.type("Can @" + ben[:8])
        mention = phone.get_by_role("listbox", name="Mention")
        expect(mention).to_contain_text(ben)
        phone.keyboard.press("ArrowDown")
        phone.keyboard.press("Enter")
        phone.keyboard.type(" book tables?")
        sheet.get_by_role("button", name="Post comment").click()
        expect(said(desk)).to_contain_text(f"{cara} commented on Stalls")
        inbox = desk.get_by_role("button", name=inbox_name(1))
        expect(inbox).to_be_visible()
        inbox.click()
        desk.get_by_role("dialog", name="Inbox").get_by_role("link").first.click()
        expect(desk).to_have_url(re.compile(r"topic=t-stalls"))
        expect(desk).to_have_url(re.compile(r"comment="))
        expect(desk.get_by_role("button", name=inbox_name(0))).to_be_visible()
    c = Api(app_url, cara)
    thread = c.get(f"/api/maps/{w.id}/topics/t-stalls/comments").json()["threads"][0]
    assert f"@{ben}" in thread["body"]
    assert Api(app_url, ben).get("/api/inbox").json()["unread"] == 0
    reply = c.post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "Yes", "reply_to": thread["id"]})
    assert reply.status_code == 201
    err(c.post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "No", "reply_to": reply.json()["comment"]["id"]}), 422, "invalid")
    assert Api(app_url, ben).topics(w.id)["t-stalls"]["comment_count"] == 2
    assert c.post(f"/api/comments/{thread['id']}/resolve").json()["thread"]["resolved"] is True
    err(c.post(f"/api/comments/{thread['id']}/resolve"), 409, "invalid_transition")
    assert c.topics(w.id)["t-stalls"]["comment_count"] == 0
    assert c.post(f"/api/comments/{thread['id']}/reopen").status_code == 200
    err(c.post(f"/api/comments/{thread['id']}/reopen"), 409, "invalid_transition")
    assert c.topics(w.id)["t-stalls"]["comment_count"] == 2
    err(Api(app_url, vic).post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "Hi", "reply_to": None}), 403, "forbidden")


def test_votes_and_counts(browser, app_url):
    o, ben, cara = uname("o"), uname("u"), uname("u")
    w = setup(app_url, "editor", "commenter", owner=o, users=[ben, cara], versions=[{"name": "Seeded", "by": o}],
              comments=[{"id": gid("c"), "topic_id": "t-stalls", "author": cara, "body": "Tables?", "resolved": False,
                         "replies": [{"id": gid("c"), "author": o, "body": "Ten."}]}])
    b, owner = Api(app_url, ben), Api(app_url, o)

    def counts(api: Api) -> tuple[int, int]:
        t = api.topics(w.id)["t-stalls"]
        threads = api.get(f"/api/maps/{w.id}/topics/t-stalls/comments").json()["threads"]
        assert t["comment_count"] == sum(1 + len(x["replies"]) for x in threads if not x["resolved"])
        return t["vote_count"], t["comment_count"]
    with editor(browser, app_url, o, w.id) as desk, editor(browser, app_url, ben, w.id, size=PHONE) as phone:
        sheet = open_details(phone, Touch(phone), "t-stalls")
        sheet.get_by_role("tab", name="Comments").click()
        vote = sheet.get_by_role("button", name=vote_name("Stalls"))
        vote.click()
        expect(vote).to_have_attribute("aria-pressed", "true")
        expect(topic(desk, "t-stalls")).to_have_accessible_name(re.compile(r", 2 comments, 1 vote$"))
        assert Api(app_url, cara).put(f"/api/maps/{w.id}/topics/t-stalls/vote", {"voted": True}).json()["vote_count"] == 2
        expect(topic(desk, "t-stalls")).to_have_accessible_name(re.compile(r", 2 votes$"))
        expect(topic(desk, "t-stalls")).to_contain_text("2")
    assert counts(owner) == (2, 2)
    as_user(app_url, w.id, o, op("move", topic_id="t-stalls", parent_id="t-music", after=None))
    assert counts(owner) == (2, 2) and owner.topics(w.id)["t-music"]["derived"]["subtopics"] == 1
    assert b.ops(w.id, op("delete", topic_id="t-music")).status_code == 200
    assert "t-stalls" not in owner.topics(w.id)
    assert b.post(f"/api/maps/{w.id}/undo").json()["status"] == "undone"
    assert counts(owner) == (2, 2)
    assert owner.post(f"/api/maps/{w.id}/versions/{w.versions[0]}/restore").status_code == 200
    assert counts(owner) == (2, 2)
    assert b.put(f"/api/maps/{w.id}/topics/t-stalls/vote", {"voted": False}).json()["vote_count"] == 1
    assert counts(owner) == (1, 2)


NOTE = ("**bold** and *soft* and `code`\n- first\n- second\n[site](https://example.org)\n"
        "<img src=x onerror=\"window.__pwned=1\"><script>window.__pwned=2</script>")


def test_safe_notes(browser, app_url):
    w = setup(app_url, "editor", "commenter")
    ben, cara = w.users
    b = Api(app_url, ben)
    bad = b.ops(w.id, op("note", topic_id="t-stalls", text="[x](javascript:alert(1))"))
    assert err(bad, 422, "invalid")["message"] == "Links must start with http:// or https://."
    assert b.ops(w.id, op("note", topic_id="t-stalls", text=NOTE)).status_code == 200
    as_user(app_url, w.id, ben, op("title", topic_id="t-music", offset=0, delete=0, insert="<b onmouseover=x>"))
    with editor(browser, app_url, cara, w.id, size=PHONE) as page:
        sheet = open_details(page, Touch(page), "t-stalls")
        preview = sheet.get_by_role("region", name="Note preview")
        expect(preview).to_contain_text(NOTE_SHOWN)
        expect(preview).not_to_contain_text("**")
        expect(preview.get_by_role("listitem")).to_have_count(2)
        expect(preview.get_by_role("link", name="site")).to_have_attribute("href", "https://example.org")
        expect(preview).to_contain_text(SCRIPT_TEXT)
        expect(preview.get_by_role("img")).to_have_count(0)
        expect(item(page, "<b onmouseover=x>Music stage")).to_be_visible()
        assert page.evaluate("() => window.__pwned === undefined")
    assert b.topics(w.id)["t-stalls"]["note"] == NOTE


def test_wf_comments_votes_discuss(browser, app_url):
    w = setup(app_url, "editor", "commenter")
    ben, cara = w.users
    with editor(browser, app_url, ben, w.id) as desk, editor(browser, app_url, cara, w.id, size=PHONE) as phone:
        sheet = open_details(phone, Touch(phone), "t-budget")
        sheet.get_by_role("tab", name="Comments").click()
        sheet.get_by_role("textbox", name="Add a comment").click()
        phone.keyboard.type("Ask @" + ben[:8])
        expect(phone.get_by_role("listbox", name="Mention")).to_contain_text(ben)
        phone.keyboard.press("ArrowDown")
        phone.keyboard.press("Enter")
        phone.keyboard.type(" about the cap")
        sheet.get_by_role("button", name="Post comment").click()
        sheet.get_by_role("button", name=vote_name("Budget")).click()
        expect(desk.get_by_role("button", name=inbox_name(1))).to_be_visible()
        expect(topic(desk, "t-budget")).to_have_accessible_name(re.compile(r", 1 comment, 1 vote$"))
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-budget", parent_id="t-stalls", after=None))
        expect(topic(desk, "t-budget")).to_have_accessible_name(re.compile(r"^Budget, level 3, .*1 comment, 1 vote$"))
        focus_topic(desk, "t-budget")
        desk.keyboard.press("Delete")
        expect(topic(desk, "t-budget")).to_have_count(0)
        desk.keyboard.press("Control+z")
        expect(topic(desk, "t-budget")).to_have_accessible_name(re.compile(r", 1 comment, 1 vote$"))
    t = Api(app_url, ben).topics(w.id)["t-budget"]
    assert t["parent_id"] == "t-stalls" and t["comment_count"] == 1 and t["vote_count"] == 1


def test_wf_comments_votes_viewer(browser, app_url):
    o = uname("o")
    w = setup(app_url, "viewer", owner=o, comments=[{"id": gid("c"), "topic_id": "t-stalls", "author": o, "body": "Hi", "resolved": False, "replies": []}])
    vic = w.users[0]
    v = Api(app_url, vic)
    err(v.post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "Me too", "reply_to": None}), 403, "forbidden")
    err(v.put(f"/api/maps/{w.id}/topics/t-stalls/vote", {"voted": True}), 403, "forbidden")
    with editor(browser, app_url, vic, w.id) as page:
        expect(topic(page, "t-stalls")).to_have_accessible_name(re.compile(r", 1 comment$"))
    t = Api(app_url, w.owner).topics(w.id)["t-stalls"]
    assert t["comment_count"] == 1 and t["vote_count"] == 0


CANON = ("sprig 1\n"
         "Fair plan | done=40 | weight=2 | priority=high | due=2026-05-01 | colour=teal | icon=star | note=Line one\\nLine \\| two\n"
         "  Child a\n"
         "  Child b | done=0 | state=cancelled\n"
         "    Grand \\\\ child\n").encode()
OUTLINE_CASES = {
    "roundtrip": (CANON, None),
    "first-line": (b"sprig 2\nRoot\n", ['Line 1: first line must be "sprig 1"']),
    "indent": (b"sprig 1\nRoot\n   Odd\n", ["Line 3: indent must be a multiple of two spaces"]),
    "tab-indent": (b"sprig 1\nRoot\n\tTabbed\n", ["Line 3: indent must be a multiple of two spaces"]),
    "indent-jump": (b"sprig 1\nRoot\n    Deep\n", ["Line 3: indent jumps more than one level"]),

    "long-title": (b"sprig 1\n" + b"T" * (TITLE_MAX + 1) + b"\n", [f"Line 2: title is longer than {TITLE_MAX} characters"]),
    "unknown-field": (b"sprig 1\nRoot | colr=teal\n", ['Line 2: unknown field "colr"']),
    "twice": (b"sprig 1\nRoot | icon=star | icon=flag\n", ['Line 2: field "icon" appears twice']),
    "bad-value": (b"sprig 1\nRoot | done=101\n", ['Line 2: field "done" has an invalid value']),
    "several": (b"sprig 1\nRoot\n   Odd | done=5\n  Ok | colr=x | icon=zz\n",
                ["Line 3: indent must be a multiple of two spaces", 'Line 4: unknown field "colr"']),
    "no-central": (b"sprig 1\n", ["Line 2: the map needs a central topic"]),
    "not-utf8": (b"sprig 1\n\xff\xfe\n", ["The file is not UTF-8 text."]),
}


@pytest.mark.parametrize("case", list(OUTLINE_CASES), ids=["roundtrip", "first-line", "indent", "tab-indent", "indent-jump", "long-title", "unknown-field", "twice", "bad-value", "several", "no-central", "not-utf8"])
def test_sprig_outline_format(app_url, case):
    data, lines = OUTLINE_CASES[case]
    w = setup(app_url)
    api = Api(app_url, w.owner)
    r = api.post(f"/api/maps/{w.id}/imports", content=data)
    if lines is not None:
        assert err(r, 422, "invalid_outline")["lines"] == lines
        return
    assert r.status_code == 201, r.text
    imp = r.json()
    assert imp["import"]["topic_count"] == 4 and imp["preview"][0]["title"] == FAIR_PLAN
    g = api.post(f"/api/maps/{w.id}/imports/{imp['import']['id']}/graft",
                 {"parent_id": "t-stalls", "group_id": gid(), "base_revision": api.revision(w.id)})
    assert g.json()["status"] == "applied"
    top = next(t for t in api.topics(w.id).values() if t["title"] == FAIR_PLAN)
    assert top["note"] == NOTE_ESCAPED and top["task"]["percent"] == 40
    assert any(t["title"] == GRAND_CHILD for t in api.topics(w.id).values())
    out, _, dl = export_bytes(api, w.id, "sprig", top["id"])
    assert out == CANON


def test_import_preview_and_paste(browser, app_url):
    owner = uname("o")
    k1, k2 = gid("k"), gid("k")
    body = seed(app_url, [owner], [
        {"key": k1, "owner": owner, "root": fair(), "links": [
            {"id": "l1", "from": MORNING_ID, "to": "t-afternoon", "label": "", "type": "related"},
            {"id": "l2", "from": "t-stalls", "to": MORNING_ID, "label": "", "type": "related"}],
         "votes": [{"topic_id": MORNING_ID, "username": owner}]},
        {"key": k2, "owner": owner, "root": node("t-root", "Second")}])
    m1, m2 = body["maps"][k1]["id"], body["maps"][k2]["id"]
    api = Api(app_url, owner)
    data = b"sprig 1\nTickets\n  Online\n  Door\n"
    sha = hashlib.sha256(data).hexdigest()
    with editor(browser, app_url, owner, m1) as page:
        focus_topic(page, "t-stalls")
        tool(page, "Import outline").click()
        with held(page, "**/imports") as gate:
            page.get_by_role("dialog", name="Import outline").get_by_label("Outline file").set_input_files(
                {"name": TICKETS_FILE, "mimeType": "text/plain", "buffer": data})
            expect(shown(page, f"Reading {TICKETS_FILE}")).to_be_visible()
            gate.release()
        preview = page.get_by_role("dialog", name="Import preview")
        expect(preview).to_contain_text("Adds 3 topics under Stalls.")
        assert S3().get(f"imports/{m1}/{sha}.sprig.txt") == data
        preview.get_by_role("button", name="Add to map").click()
        expect(item(page, "Online")).to_be_visible()
        t = api.topics(m1)
        tickets = next(x for x in t.values() if x["title"] == "Tickets")
        assert tickets["parent_id"] == "t-stalls"
        assert api.get(f"/api/maps/{m1}/activity").json()["entries"][0]["sentence"] == f"{owner} imported 3 topics under Stalls"
        tool(page, "Undo").click()
        eventually(lambda: all(x["title"] not in ("Tickets", "Online", "Door") for x in api.topics(m1).values()), "one undo removes the graft", page)
        focus_topic(page, "t-vol")
        page.keyboard.press("Control+c")
        expect(said(page)).to_contain_text("Copied 3 topics.")
        page.goto(f"{app_url}/m/{m2}")
        focus_topic(page, "t-root")
        page.keyboard.press("Control+v")
        expect(said(page)).to_contain_text("Pasted 3 topics.")
        expect(item(page, "Morning shift")).to_be_visible()
    m = api.map(m2)
    pasted = {t["title"]: t for t in m["topics"]}
    assert {"Volunteers and rotas", "Morning shift", "Afternoon shift"} <= set(pasted)
    assert pasted["Morning shift"]["id"] != MORNING_ID and pasted["Morning shift"]["vote_count"] == 0
    assert [(l["from"], l["to"]) for l in m["links"]] == [(pasted["Morning shift"]["id"], pasted["Afternoon shift"]["id"])]
    fresh = uname("o")
    seed(app_url, [fresh], [{"key": gid("k"), "owner": fresh, "root": node("t-root", "Empty")}])
    fid = Api(app_url, fresh).get("/api/maps").json()["maps"][0]["id"]
    err(Api(app_url, fresh).post(f"/api/maps/{fid}/paste", {"parent_id": "t-root", "group_id": gid(), "base_revision": 1}), 409, "clipboard_empty")


def test_export_jobs(browser, app_url):
    w = setup(app_url, root=fair(**{"t-budget": {"title": "<script>alert(1)</script>"}}))
    api = Api(app_url, w.owner)
    err(api.post(f"/api/maps/{w.id}/exports", {"format": "pdf", "topic_id": None}), 422, "invalid")
    r = api.post(f"/api/maps/{w.id}/exports", {"format": "sprig", "topic_id": None})
    job = r.json()["export"]
    assert r.status_code == 202 and job["state"] == "queued" and job["progress"] == 0
    early = api.get(f"/api/exports/{job['id']}/download")
    final, seen = export_done(api, job["id"])
    if early.status_code != 200:
        err(early, 409, "not_ready")
    assert final["state"] == "ready" and final["progress"] == 100 and final["download_url"]
    assert all(p in EXPORT_PROGRESS for _, p in seen) and [p for _, p in seen] == sorted(p for _, p in seen)
    stored = S3().get(f"exports/{w.id}/{job['id']}.sprig.txt")
    dl = api.get(f"/api/exports/{job['id']}/download")
    assert dl.content == stored and dl.content.startswith(b"sprig 1\n")
    title = api.map(w.id)["map"]["title"]
    assert "text/plain" in dl.headers["content-type"] and f"{title}.sprig.txt" in unquote(dl.headers["content-disposition"])
    err(api.post(f"/api/exports/{job['id']}/retry"), 409, "invalid_transition")
    svg, sjob, sdl = export_bytes(api, w.id, "svg")
    assert "image/svg+xml" in sdl.headers["content-type"] and f"{title}.svg" in unquote(sdl.headers["content-disposition"])
    assert b"<script" not in svg and b"&lt;script&gt;" in svg and b"http" not in svg.replace(b"http://www.w3.org", b"")
    groups = {e.get("data-topic-id"): e for e in ET.fromstring(svg).iter() if e.get("data-topic-id")}
    assert groups["t-stalls"].get("data-x") == "290" and groups["t-stalls"].get("data-y") == "-48"
    assert len(groups) == len(TITLES)
    assert S3().get(f"exports/{w.id}/{sjob['id']}.svg") == svg
    with editor(browser, app_url, w.owner, w.id) as page:
        tool(page, "Export").click()
        dialog = page.get_by_role("dialog", name="Export")
        dialog.get_by_role("radio", name="Sprig outline").check()
        before = set(S3().keys(f"exports/{w.id}/"))
        dialog.get_by_role("button", name="Start export").click()
        expect(dialog.get_by_role("progressbar", name="Export")).to_be_visible()
        link = dialog.get_by_role("link", name="Download export")
        expect(link).to_be_visible()
        new = set(S3().keys(f"exports/{w.id}/")) - before
        assert len(new) == 1, "the stored object exists when the download is offered"
        expect(shown(page, "Export ready.")).to_be_visible()
        with page.expect_download() as d:
            link.click()
        assert Path(d.value.path()).read_bytes() == S3().get(new.pop())


def test_image_attachments(browser, app_url):
    w = setup(app_url, "editor", "commenter")
    ben, cara = w.users
    b, s3 = Api(app_url, ben), S3()
    url = f"/api/maps/{w.id}/topics/t-stalls/attachments"
    png = make_png()
    r = b.post(url, content=png)
    a = r.json()["attachment"]
    assert r.status_code == 201 and a["state"] == "stored" and a["sha256"] == hashlib.sha256(png).hexdigest() and a["type"] == "png"
    assert s3.get(f"attachments/{w.id}/{a['sha256']}.png") == png
    assert b.get(f"/api/attachments/{a['id']}").content == png
    jpg = make_jpeg()
    j = b.post(url, content=jpg).json()["attachment"]
    assert j["type"] == "jpg" and s3.get(f"attachments/{w.id}/{j['sha256']}.jpg") == jpg
    gif = b"GIF89a" + uuid.uuid4().bytes
    err(b.post(url, content=gif), 422, "wrong_type")
    assert not any(hashlib.sha256(gif).hexdigest() in k for k in s3.keys(f"attachments/{w.id}/"))
    err(b.post(url, content=b"GIF89a" + b"\x00" * OVERSIZE), 413, "too_large")
    err(Api(app_url, cara).post(url, content=make_png()), 403, "forbidden")
    with editor(browser, app_url, ben, w.id, size=PHONE) as page:
        sheet = open_details(page, Touch(page), "t-music")
        def attach(data: bytes, name: str) -> None:
            with page.expect_file_chooser() as fc:
                sheet.get_by_role("button", name="Attach image").click()
            fc.value.set_files({"name": name, "mimeType": "image/png", "buffer": data})
        attach(make_png(OVERSIZE), "huge.png")
        msg = shown(page, re.compile(r"This image is larger than \d+ bytes\."))
        expect(msg).to_be_visible()
        limit = int(re.search(r"(\d+)", msg.inner_text()).group(1))
        exact = make_png(limit)
        with held(page, "**/attachments") as gate:
            attach(exact, EXACT_NAME)
            expect(shown(page, f"Uploading {EXACT_NAME}")).to_be_visible()
            gate.release()
        expect(shown(page, "Image attached.")).to_be_visible()
        assert s3.get(f"attachments/{w.id}/{hashlib.sha256(exact).hexdigest()}.png") == exact
        expect(sheet.get_by_role("img", name="Attachment on Music stage")).to_be_visible()
        err(b.post(url, content=make_png(limit + 1)), 413, "too_large")
        total = len(png) + len(jpg) + limit
        for _ in range(QUOTA_PROBES):
            r = b.post(url, content=make_png(limit))
            if r.status_code == 409:
                break
            assert r.status_code == 201
            total += limit
        else:
            pytest.fail("the per-map quota refuses with 409 quota_exceeded")
        assert r.json()["error"] == "quota_exceeded"
        err(b.post(url, content=b"GIF89a" + b"\x00" * 10), 422, "wrong_type")
        attach(make_png(limit), "more.png")
        q = shown(page, re.compile(r"This map's images would pass its \d+ byte limit\."))
        expect(q).to_be_visible()
        quota = int(re.search(r"(\d+)", q.inner_text()).group(1))
        assert total <= quota < total + limit
    assert b.delete(f"/api/attachments/{a['id']}").status_code == 204
    assert all(x["id"] != a["id"] for x in b.topics(w.id)["t-stalls"]["attachments"])


def test_storage_outage(browser, app_url):
    down = minio_down_url()
    w = setup(down, "editor")
    d = Api(down, w.owner)
    assert d.ops(w.id, op("title", topic_id="t-stalls", offset=0, delete=0, insert="Big ")).status_code == 200
    assert d.post(f"/api/maps/{w.id}/topics/t-stalls/comments", {"body": "Hi", "reply_to": None}).status_code == 201
    err(d.post(f"/api/maps/{w.id}/topics/t-stalls/attachments", content=make_png()), 503, "storage_unavailable")
    err(d.post(f"/api/maps/{w.id}/imports", content=b"sprig 1\nA\n"), 503, "storage_unavailable")
    err(d.post(f"/api/maps/{w.id}/versions", {"name": "Down"}), 503, "storage_unavailable")
    job = d.post(f"/api/maps/{w.id}/exports", {"format": "sprig", "topic_id": None}).json()["export"]
    final, _ = export_done(d, job["id"])
    assert final["state"] == "failed" and final["progress"] == 80 and final["download_url"] is None
    assert d.topics(w.id)["t-stalls"]["attachments"] == [] and d.get(f"/api/maps/{w.id}/versions").json()["versions"] == []
    with editor(browser, down, w.owner, w.id, size=PHONE) as page:
        sheet = open_details(page, Touch(page), "t-music")
        with page.expect_file_chooser() as fc:
            sheet.get_by_role("button", name="Attach image").click()
        fc.value.set_files({"name": "a.png", "mimeType": "image/png", "buffer": make_png()})
        expect(shown(page, "File storage is unavailable. Nothing was added. Try again in a moment.")).to_be_visible()
    p = setup(app_url, versions=[{"name": "Seeded"}])
    api = Api(app_url, p.owner)
    as_user(app_url, p.id, p.owner, op("delete", topic_id="t-music"))
    with storage_down(app_url):
        err(api.post(f"/api/maps/{p.id}/versions/{p.versions[0]}/restore"), 503, "storage_unavailable")
        assert MUSIC_ID not in api.topics(p.id)
        err(api.post(f"/api/maps/{p.id}/topics/t-stalls/attachments", content=make_png()), 503, "storage_unavailable")
        job = api.post(f"/api/maps/{p.id}/exports", {"format": "sprig", "topic_id": None}).json()["export"]
        assert export_done(api, job["id"])[0]["state"] == "failed"
    retried = api.post(f"/api/exports/{job['id']}/retry")
    assert retried.status_code == 202 and retried.json()["export"]["progress"] == 80
    assert export_done(api, job["id"])[0]["state"] == "ready"
    assert S3().get(f"exports/{p.id}/{job['id']}.sprig.txt").startswith(b"sprig 1\n")
    assert api.post(f"/api/maps/{p.id}/topics/t-stalls/attachments", content=make_png()).status_code == 201
    assert api.post(f"/api/maps/{p.id}/versions/{p.versions[0]}/restore").status_code == 200
    assert MUSIC_ID in api.topics(p.id)


def test_wf_import_export_happy(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    data = b"sprig 1\nGames\n  Tombola\n"
    with editor(browser, app_url, ben, w.id) as page:
        tool(page, "Import outline").click()
        page.get_by_role("dialog", name="Import outline").get_by_label("Outline file").set_input_files(
            {"name": "games.sprig.txt", "mimeType": "text/plain", "buffer": data})
        preview = page.get_by_role("dialog", name="Import preview")
        expect(preview).to_contain_text("Adds 2 topics under Street fair.")
        assert S3().get(f"imports/{w.id}/{hashlib.sha256(data).hexdigest()}.sprig.txt") == data
        preview.get_by_role("button", name="Add to map").click()
        expect(item(page, "Tombola")).to_be_visible()
        tool(page, "Export").click()
        dialog = page.get_by_role("dialog", name="Export")
        dialog.get_by_role("radio", name="SVG picture").check()
        dialog.get_by_role("button", name="Start export").click()
        expect(dialog.get_by_role("link", name="Download export")).to_be_visible()
        keys = [k for k in S3().keys(f"exports/{w.id}/") if k.endswith(".svg")]
        assert len(keys) == 1 and b"Tombola" in S3().get(keys[0])
    with editor(browser, app_url, ben, w.id, size=PHONE) as page:
        sheet = open_details(page, Touch(page), "t-stalls")
        img = make_png()
        with page.expect_file_chooser() as fc:
            sheet.get_by_role("button", name="Attach image").click()
        fc.value.set_files({"name": "stall.png", "mimeType": "image/png", "buffer": img})
        expect(shown(page, "Image attached.")).to_be_visible()
        assert S3().get(f"attachments/{w.id}/{hashlib.sha256(img).hexdigest()}.png") == img
    t = Api(app_url, ben).topics(w.id)
    assert any(x["title"] == GAMES and x["parent_id"] == "t-root" for x in t.values()) and len(t["t-stalls"]["attachments"]) == 1


def test_wf_import_export_outage(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, ben, w.id) as page:
        tool(page, "Export").click()
        dialog = page.get_by_role("dialog", name="Export")
        dialog.get_by_role("radio", name="Sprig outline").check()
        with storage_down(app_url):
            dialog.get_by_role("button", name="Start export").click()
            expect(shown(page, "Export failed: file storage is unavailable.")).to_be_visible()
            expect(dialog.get_by_role("link", name="Download export")).to_have_count(0)
            assert S3().keys(f"exports/{w.id}/") == []
        dialog.get_by_role("button", name="Retry export").click()
        expect(dialog.get_by_role("link", name="Download export")).to_be_visible()
        keys = S3().keys(f"exports/{w.id}/")
        assert len(keys) == 1 and S3().get(keys[0]).startswith(b"sprig 1\nStreet fair\n")


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data[key], str) and data[key].strip(), key


def test_if_third_party_notices():
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing}"
    assert "Figtree" in text


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert "Open Font License" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_other_datastore():
    names = {p.name for p in shipped_packages()}
    assert not names & {"sqlite3", "better-sqlite3", "lowdb", "nedb", "redis", "ioredis", "mongodb", "level"}
    files = [p for p in Path(DEPLOYED_APP).rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, files
    assert Postgres().tables()


def test_if_same_origin_only(browser, app_url):
    w = setup(app_url)
    with browse(browser, app_url, w.owner, "/") as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/maps", f"/m/{w.id}"):
            page.goto(f"{app_url}{path}")
            page.wait_for_load_state("networkidle")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not foreign, foreign


def test_if_service_config_unchanged():
    path = Path("/logs/agent/trajectory.json")
    if not path.is_file():
        return
    writers ={"Edit", "Write", "MultiEdit", "NotebookEdit"}
    config_file = re.compile(r"(^|/)(\.env[^/\s]*|docker-compose[^/\s]*|compose\.ya?ml)$")
    config_write = re.compile(r"(>>?|\btee\b|\bsed\s+-i\b|\bmv\b|\brm\b|\bcp\b)[^|;&\n]*(\.env\b|docker-compose|compose\.ya?ml)")
    touched: list[str] = []

    def walk(value: Any, writing: bool = False) -> None:
        if isinstance(value, dict):
            writing = writing or value.get("name") in writers or value.get("tool_name") in writers
            for k, v in value.items():
                if writing and k in ("file_path", "path", "notebook_path") and isinstance(v, str) and config_file.search(v):
                    touched.append(v)
                if k == "command" and isinstance(v, str) and config_write.search(v):
                    touched.append(v)
                walk(v, writing)
        elif isinstance(value, list):
            for v in value:
                walk(v, writing)
    walk(json.loads(path.read_text()))
    assert not touched, touched


def test_if_no_service_worker(browser, app_url):
    w = setup(app_url)
    with browse(browser, app_url, w.owner, "/") as page:
        page.add_init_script("(() => { window.__sw = 0; if (navigator.serviceWorker) { const r = navigator.serviceWorker.register.bind(navigator.serviceWorker);"
                             " navigator.serviceWorker.register = (...a) => { window.__sw += 1; return r(...a); }; } })()")
        for path in ("/", "/maps", f"/m/{w.id}"):
            page.goto(f"{app_url}{path}")
            page.wait_for_load_state("networkidle")
            assert page.evaluate("() => window.__sw") == 0
        assert page.evaluate("async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0") == 0


@pytest.mark.timeout(600)
def test_if_schema_applied_each_serve(app_url):
    w = setup(app_url)
    with app_copy({}) as (base, tail):
        def ready() -> bool:
            health = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
            assert health.status_code == 200, f"{health.text}\n{tail()}"
            return True
        eventually(ready, "the copy's /api/health answers 200 once it is ready")
        assert Api(base, w.owner).map(w.id)["map"]["title"] == Api(app_url, w.owner).map(w.id)["map"]["title"]
    assert Postgres().tables()


ROLLUP_TREE = node("t-root", "Trip",
                   node("t-p", "Plan", node("t-a", "Alpha", task=task(100)), node("t-b", "Beta", task=task(0))),
                   node("t-q", "Quote", node("t-c", "Gamma", task=task(80))))


@pytest.mark.timeout(300)
def test_wf_outline_sync_outdent_rebalance(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as mine, editor(browser, app_url, ben, w.id) as theirs:
        focus_topic(theirs, "t-budget")
        row(mine, "Morning shift").click()
        mine.keyboard.press("Shift+Tab")
        expect(row(mine, "Morning shift")).to_be_focused()
        for page in (mine, theirs):
            moved = topic(page, "t-morning")
            expect(moved).to_have_attribute("aria-level", "2")
            expect(moved).to_have_attribute("aria-setsize", "5")
            expect(moved).to_have_attribute("aria-posinset", "4")
            expect(topic(page, "t-afternoon")).to_have_attribute("aria-setsize", "1")
            at(moved, "-290", "0")
            expect(moved).to_have_attribute("data-side", "left")
            at(topic(page, "t-budget"), "-290", "48")
            at(topic(page, "t-vol"), "290", "24")
        expect(topic(theirs, "t-budget")).to_be_focused()
        tool(mine, "Undo").click()
        for page in (mine, theirs):
            expect(topic(page, "t-morning")).to_have_attribute("aria-level", "3")
            at(topic(page, "t-morning"), "550", "0")
            at(topic(page, "t-budget"), "-290", "24")
        expect(topic(theirs, "t-budget")).to_be_focused()
    assert Api(app_url, ben).topics(w.id)["t-morning"]["parent_id"] == ID_VOL


@pytest.mark.timeout(300)
def test_wf_personal_undo_two_people(browser, app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben],
              links=[{"id": "l1", "from": "t-stalls", "to": "t-morning", "label": "ask", "type": "related"}],
              boundaries=[{"id": "b1", "topic_id": "t-vol", "label": "crew"}],
              comments=[{"id": gid("c"), "topic_id": "t-morning", "author": o, "body": "Who?", "resolved": False,
                         "replies": [{"id": gid("c"), "author": ben, "body": "Me."}]}],
              votes=[{"topic_id": "t-morning", "username": ben}])
    named = label("Morning shift", 3, 1, 2, "2 comments", "1 vote")
    with editor(browser, app_url, ben, w.id) as b, editor(browser, app_url, o, w.id) as owner:
        expect(topic(owner, "t-morning")).to_have_accessible_name(named)
        focus_topic(b, "t-vol")
        b.keyboard.press("Delete")
        for page in (b, owner):
            expect(topic(page, "t-morning")).to_have_count(0)
            expect(link_el(page, "t-stalls", "t-morning")).to_have_count(0)
            expect(boundary_el(page, "b1")).to_have_count(0)
        focus_topic(owner, "t-budget")
        owner.keyboard.press("F2")
        commit(owner, " plan")
        expect(item(b, BUDGET_PLAN)).to_be_visible()
        owner.keyboard.press("Control+z")
        expect(said(owner)).to_contain_text("Undone.")
        expect(item(b, "Budget")).to_be_visible()
        expect(topic(owner, "t-vol")).to_have_count(0)
        owner.keyboard.press("Control+z")
        expect(said(owner)).to_contain_text("Nothing to undo.")
        expect(topic(owner, "t-vol")).to_have_count(0)
        b.keyboard.press("Control+z")
        expect(topic(b, "t-vol")).to_be_focused()
        expect(topic(owner, "t-budget")).to_be_focused()
        for page in (b, owner):
            expect(topic(page, "t-morning")).to_have_accessible_name(named)
            expect(link_el(page, "t-stalls", "t-morning")).to_have_count(1)
            expect(boundary_el(page, "b1")).to_have_count(1)


@pytest.mark.timeout(300)
def test_wf_personal_undo_rollup_live(browser, app_url):
    w = setup(app_url, "editor", root=ROLLUP_TREE)
    ben = w.users[0]
    with editor(browser, app_url, ben, w.id) as b, editor(browser, app_url, w.owner, w.id) as owner:
        expect(topic(owner, "t-p")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 0))))
        expect(topic(owner, "t-root")).to_have_attribute("data-percent", str(rollup((1, 50), (1, 80))))
        focus_topic(b, "t-b")
        b.keyboard.press("Alt+ArrowLeft")
        expect(topic(b, "t-b")).to_be_focused()
        expect(topic(owner, "t-b")).to_have_attribute("aria-level", "2")
        expect(topic(owner, "t-p")).to_have_attribute("data-percent", "100")
        expect(topic(owner, "t-root")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 0), (1, 80))))
        b.keyboard.press("Control+z")
        expect(topic(b, "t-b")).to_be_focused()
        expect(topic(owner, "t-p")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 0))))
        expect(topic(owner, "t-root")).to_have_attribute("data-percent", str(rollup((1, 50), (1, 80))))
        b.keyboard.press("Control+Shift+Z")
        expect(said(b)).to_contain_text("Redone.")
        expect(topic(owner, "t-p")).to_have_attribute("data-percent", "100")
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-b", parent_id=ID_QUOTE, after=None))
        expect(topic(b, "t-b")).to_have_attribute("aria-level", "3")
        b.keyboard.press("Control+z")
        expect(notices(b)).to_contain_text(f"Can't undo: {w.owner} changed Beta after you.")
        for page in (b, owner):
            expect(topic(page, "t-b")).to_have_attribute("aria-level", "3")
            expect(topic(page, ID_QUOTE)).to_have_attribute("data-percent", str(rollup((1, 80), (1, 0))))
            expect(topic(page, "t-root")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 40))))
    assert Api(app_url, ben).topics(w.id)["t-b"]["parent_id"] == ID_QUOTE


@pytest.mark.timeout(300)
def test_wf_phone_touch_pinch_collapse_live(browser, app_url):
    w = setup(app_url, "editor")
    ben = w.users[0]
    with editor(browser, app_url, w.owner, w.id) as desk, editor(browser, app_url, ben, w.id, size=PHONE) as phone:
        touch = Touch(phone)
        fit_view(phone)
        long_press(phone, touch, topic(phone, "t-vol")).get_by_role("menuitem", name="Collapse").click()
        expect(topic(phone, "t-vol")).to_have_attribute("aria-expanded", "false")
        expect(topic(phone, "t-morning")).to_have_count(0)
        expect(topic(desk, "t-morning")).to_be_visible()
        expect(topic(desk, "t-vol")).to_have_attribute("aria-expanded", "true")
        cb = canvas(phone).bounding_box()
        px, py = cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] - 120
        z0, p0x, p0y = view(phone)
        touch.start((px - 50, py), (px + 50, py))
        touch.move((px - 100, py), (px + 100, py))
        touch.end()
        z1, p1x, p1y = view(phone)
        assert abs(z1 - z0 * 2) <= ZOOM_EPS
        mid = (px - cb["x"], py - cb["y"])
        assert abs(p1x - (mid[0] - (mid[0] - p0x) * z1 / z0)) <= COORD_SLACK
        assert abs(p1y - (mid[1] - (mid[1] - p0y) * z1 / z0)) <= COORD_SLACK
        focus_topic(desk, "t-stalls")
        desk.keyboard.press("Tab")
        commit(desk, TABLES)
        expect(item(phone, TABLES)).to_have_count(1)
        as_user(app_url, w.id, w.owner, op("title", topic_id="t-afternoon", offset=0, delete=0, insert="Late "))
        expect(topic(phone, "t-vol")).to_have_attribute("aria-expanded", "false")
        expect(topic(phone, "t-morning")).to_have_count(0)
        assert view(phone) == (z1, p1x, p1y), "live edits leave my zoom and pan alone"


@pytest.mark.timeout(300)
def test_wf_version_history_read_only_live(browser, app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], versions=[{"name": "Seeded", "by": o}])
    vid = w.versions[0]
    with editor(browser, app_url, o, w.id, query=f"/versions/{vid}") as mine, editor(browser, app_url, ben, w.id) as theirs:
        expect(shown(mine, "This is version 1. Read only.")).to_be_visible()
        expect(mine.get_by_role("combobox", name="Compare with")).to_be_visible()
        focus_topic(theirs, "t-budget")
        theirs.keyboard.press("F2")
        commit(theirs, " cap")
        expect(item(theirs, BUDGET_CAP)).to_be_visible()
        eventually(lambda: Api(app_url, ben).topics(w.id)["t-budget"]["title"] == BUDGET_CAP, "rename stored", theirs)
        expect(item(mine, "Budget")).to_be_visible()
        expect(item(mine, BUDGET_CAP)).to_have_count(0)
        mine.get_by_role("button", name="Restore this version").click()
        expect(notices(mine)).to_contain_text("Restored version 1.")
        expect(item(theirs, "Budget")).to_be_visible()
        mine.goto(f"{app_url}/m/{w.id}")
        expect(topic(mine, "t-root")).to_be_visible()
        tool(mine, "Undo").click()
        expect(item(theirs, BUDGET_CAP)).to_be_visible()
        expect(item(mine, BUDGET_CAP)).to_be_visible()
    kinds = [v["kind"] for v in Api(app_url, o).get(f"/api/maps/{w.id}/versions").json()["versions"]]
    assert kinds[0] != "restore" and kinds[-1] == "restore", "a restore erases no history"


@pytest.mark.timeout(300)
def test_wf_version_history_restore_rollup(browser, app_url):
    o, ben = uname("o"), uname("u")
    w = setup(app_url, "editor", owner=o, users=[ben], root=ROLLUP_TREE, versions=[{"name": "Seeded", "by": o}])
    vid = w.versions[0]
    as_user(app_url, w.id, ben, op("task", topic_id="t-b", task={"percent": 100}))
    with editor(browser, app_url, o, w.id, query=f"/versions/{vid}") as mine, editor(browser, app_url, ben, w.id) as theirs:
        expect(topic(theirs, "t-p")).to_have_attribute("data-percent", "100")
        mine.get_by_role("button", name="Restore this version").click()
        expect(topic(theirs, "t-p")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 0))))
        expect(topic(theirs, "t-root")).to_have_attribute("data-percent", str(rollup((1, 50), (1, 80))))
        mine.goto(f"{app_url}/m/{w.id}")
        expect(topic(mine, "t-root")).to_be_visible()
        tool(mine, "Undo").click()
        for page in (mine, theirs):
            expect(topic(page, "t-p")).to_have_attribute("data-percent", "100")
            expect(topic(page, "t-root")).to_have_attribute("data-percent", str(rollup((1, 100), (1, 80))))


@pytest.mark.timeout(300)
def test_wf_presentation_followers_motion(browser, app_url):
    w = setup(app_url, slides=["t-stalls", "t-music"])
    with editor(browser, app_url, w.owner, w.id) as page:
        tool(page, "Start presentation").click()
        presenter = page.get_by_role("region", name="Presenter")
        expect(presenter).to_contain_text("/p/")
        code = re.search(r"/p/([A-Za-z0-9_-]+)", presenter.inner_text()).group(1)
        with browse(browser, app_url, None, f"/p/{code}", PHONE) as glide:
            with browse(browser, app_url, None, f"/p/{code}", PHONE, reduced_motion="reduce") as cut:
                expect(presenter).to_contain_text("2 following")
                presenter.get_by_role("button", name="Go live").click()
                for audience in (glide, cut):
                    expect(audience.get_by_role("region", name="Slide", exact=True)).to_contain_text("Stalls")
                    audience.evaluate(ANIMATION_HOOK)
                page.keyboard.press("ArrowRight")
                expect(presenter).to_contain_text("Slide 2 of 2")
                for audience in (glide, cut):
                    expect(audience.get_by_role("region", name="Slide", exact=True)).to_contain_text("Music stage")
                assert [a["duration"] for a in glide.evaluate(READ_ANIMS, ["camera"])][-1] == CAMERA_MS
                assert cut.evaluate(READ_ANIMS, ["camera"]) == []
            expect(presenter).to_contain_text("1 following")


@pytest.mark.timeout(300)
def test_wf_comments_votes_inbox_follows_move(browser, app_url):
    w = setup(app_url, "editor", "commenter")
    ben, cara = w.users
    with editor(browser, app_url, ben, w.id) as desk, editor(browser, app_url, cara, w.id, size=PHONE) as phone:
        sheet = open_details(phone, Touch(phone), "t-budget")
        sheet.get_by_role("tab", name="Comments").click()
        sheet.get_by_role("textbox", name="Add a comment").click()
        phone.keyboard.type("Ask @" + ben[:8])
        expect(phone.get_by_role("listbox", name="Mention")).to_contain_text(ben)
        phone.keyboard.press("ArrowDown")
        phone.keyboard.press("Enter")
        sheet.get_by_role("button", name="Post comment").click()
        inbox = desk.get_by_role("button", name=inbox_name(1))
        expect(inbox).to_be_visible()
        as_user(app_url, w.id, w.owner, op("move", topic_id="t-budget", parent_id="t-stalls", after=None))
        expect(topic(desk, "t-budget")).to_have_accessible_name(label("Budget", 3, 1, 1, "1 comment"))
        inbox.click()
        desk.get_by_role("dialog", name="Inbox").get_by_role("link").first.click()
        expect(desk).to_have_url(re.compile(r"topic=t-budget"))
        expect(desk.get_by_role("button", name=inbox_name(0))).to_be_visible()
        sheet.get_by_role("button", name=vote_name("Budget")).click()
        expect(topic(desk, "t-budget")).to_have_accessible_name(label("Budget", 3, 1, 1, "1 comment", "1 vote"))
        sheet.get_by_role("button", name="Resolve").click()
        expect(topic(desk, "t-budget")).to_have_accessible_name(label("Budget", 3, 1, 1, "1 vote"))
        sheet.get_by_role("button", name="Reopen").click()
        expect(topic(desk, "t-budget")).to_have_accessible_name(label("Budget", 3, 1, 1, "1 comment", "1 vote"))


def test_phone_drawer_keeps_and_returns_focus(browser, app_url):
    w = setup(app_url)
    with editor(browser, app_url, w.owner, w.id, size=PHONE) as page:
        opener = page.get_by_role("button", name="Tools", exact=True)
        opener.click()
        drawer = page.get_by_role("toolbar", name="Map tools")
        expect(drawer).to_be_visible()
        drawer.get_by_role("button").first.focus()
        for key in ("Shift+Tab", "Tab", "Tab", "Tab"):
            page.keyboard.press(key)
            assert focus_inside(page, drawer), f"{key} stays inside the drawer"
        page.keyboard.press("Escape")
        expect(drawer).to_be_hidden()
        expect(opener).to_be_focused()
        inbox = page.get_by_role("button", name=inbox_name(0))
        inbox.click()
        expect(page.get_by_role("dialog", name="Inbox")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="Inbox")).to_be_hidden()
        expect(inbox).to_be_focused()


def test_click_moves_roving_focus(browser, app_url):
    w = setup(app_url)
    with editor(browser, app_url, w.owner, w.id) as page:
        for tid in ("t-vol", "t-budget"):
            topic(page, tid).click()
            expect(topic(page, tid)).to_be_focused()
            expect(topic(page, tid)).to_have_attribute("tabindex", "0")
            assert tree(page).get_by_role("treeitem").evaluate_all("els => els.filter(e => e.tabIndex === 0).length") == 1
