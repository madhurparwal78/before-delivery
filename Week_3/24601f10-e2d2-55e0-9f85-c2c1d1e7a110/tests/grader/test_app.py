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
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    animations,
    check,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    motion,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    tap,
)

CUP = "Back Room Cup"
NAMES = ("Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus", "Hal")
PASSWORD = "dana-pass-1"
SE, DE, RR, SWISS = "single_elimination", "double_elimination", "round_robin", "swiss"
STARTED = "The tournament has already started."
NOT_RUNNING = "The tournament is not running."
FINISHED = "This tournament is finished. Its results can no longer change."
ROSTER_INVALID = "The roster was not added. Fix these lines and upload again."
STORAGE_DOWN = "File storage is unavailable. Nothing was added. Try again in a moment."
NEED_WINNER = "Elimination matches need a winner."
RR_COLUMNS = ["Place", "Entrant", "Played", "Match points", "Head-to-head", "Game difference",
              "Games won", "Seed", "Decided by"]
SWISS_COLUMNS = ["Place", "Entrant", "Played", "Match points", "Buchholz cut 1", "Buchholz",
                 "Sonneborn-Berger", "Seed", "Decided by"]
FORMAT_OBJECTS = {"Single elimination": "Single elimination cup",
                  "Double elimination": "Double elimination loving cup",
                  "Round robin": "Round robin medal", "Swiss": "Swiss counters"}
ERROR_EXTRAS = {"validation": {"fields"}, "stale_match": {"match"}, "already_resolved": {"match"},
                "stale_seeding": {"entrants"}, "roster_invalid": {"errors"}}
PUBLIC_FORBIDDEN_KEYS = {"overdue", "updated_by", "share_url", "co_organizers"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}

FORBIDDEN_STORES = ("SQLite", "Redis")
JSON_LIMIT = 65536
LOGIN_RATE = 10
REPORT_RATE = 20
RATE_WINDOW_MS = 60000
CLOCK_MAX_MS = 604800000
CHECKIN_AHEAD_MS = 3600000
LIVE_S = 2
ADVANCE_MS = 320
SEGMENT_MS = 320
STAGGER_MS = 90
SLAT_MS = 240
TRACE_BUDGET_MS = 10000
AT_ONCE_MS = STAGGER_MS
SWIPE_PX = 50
HEALTH_STALE_S = 5
NAME_MAX = 40
ROSTER_LINE_CAP = 20
SHARE_CODE_LEN = 22
DESK = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}

HTTP_TIMEOUT_S = 30
WAIT_S = 30
STEP_MS = 50
TRACE_STEP_MS = 10
BOOT_S = 240
CLOCK_MARGIN_MS = 1000
POLL_SLACK_S = 10
RELAY_CHUNK = 65536
SWIPE_Y_PX = 80
SWIPE_MOVES = 6
SWIPE_EXTRA_PX = 40
SHORT_SWIPE_PX = 20
TAB_PRESSES = 8
DEVICE_SKEW = timedelta(hours=3)
CLOCK_PROBE_MS = 1000


def fresh() -> str:
    return uuid.uuid4().hex[:8]


class Api:

    def __init__(self, base: str, username: str | None = None):
        self.base = base
        self.username = username
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        if username:
            r = self.http.post("/api/grading/session", json={"username": username})
            assert r.status_code == 200, f"POST /api/grading/session {username}: {r.status_code} {r.text}"

    def call(self, method: str, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        if body is not None:
            kw["json"] = body
        return self.http.request(method, path, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, body, **kw)

    def patch(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("PATCH", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)

    def upload(self, path: str, name: str, data: bytes, ctype: str = "text/plain") -> httpx.Response:
        return self.http.post(path, files={"file": (name, data, ctype)})


def ok_json(r: httpx.Response, status: int, what: str) -> Any:
    assert r.status_code == status, f"{what}: expected {status}, got {r.status_code} {r.text[:500]}"
    return r.json() if r.content else None


def refused(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:500]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code}, got {body}"
    assert {"error", "message"} <= set(body) <= {"error", "message"} | ERROR_EXTRAS.get(code, set()), body
    if message is not None:
        assert body["message"] == message, f"expected message {message!r}, got {body['message']!r}"
    return body


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def config(base: str) -> dict:
    return ok_json(httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT_S), 200, "GET /api/config")


def server_now(base: str) -> datetime:
    return parse(config(base)["server_time"])


def move_clock(base: str, ms: int) -> datetime:
    body = ok_json(post_json(base, "/api/grading/clock", {"advance_ms": int(ms)}), 200, "POST /api/grading/clock")
    return parse(body["server_time"])


def post_json(base: str, path: str, body: Any) -> httpx.Response:
    return httpx.post(base + path, json=body, timeout=HTTP_TIMEOUT_S)


def poll(check: Callable[[], Any], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            got = check()
            if got:
                return got
        except (PlaywrightError, httpx.HTTPError) as err:
            last = err
    pytest.fail(f"{what} (last error: {last})")


def rnd(r: int, m: int) -> str:
    return f"Round {r}, match {m}"


def win(r: int, m: int) -> str:
    return f"Winners round {r}, match {m}"


def los(r: int, m: int) -> str:
    return f"Losers round {r}, match {m}"


GF, GFR = "Grand final", "Grand final reset"


def saved(label: str, u: int, l: int, by: str | None = None) -> dict:
    s = {"match": label, "action": "confirmed", "upper_games": u, "lower_games": l}
    if by:
        s["by"] = by
    return s


def rep(label: str, u: int, l: int, by: str) -> dict:
    return {"match": label, "action": "reported", "upper_games": u, "lower_games": l, "by": by}


def dis(label: str, u: int, l: int, by: str, cu: int, cl: int) -> dict:
    return {"match": label, "action": "disputed", "upper_games": u, "lower_games": l, "by": by,
            "counter": {"upper_games": cu, "lower_games": cl}}


def res(label: str, u: int, l: int, resolver: str | None = None) -> dict:
    s = {"match": label, "action": "resolved", "upper_games": u, "lower_games": l}
    if resolver:
        s["resolver"] = resolver
    return s


def called(label: str) -> dict:
    return {"match": label, "action": "called"}


NEXT_ROUND = {"action": "next_round"}

SE_R1 = [saved(rnd(1, m), 2, 0) for m in (1, 2, 3, 4)]
SE_TO_FINAL = SE_R1 + [saved(rnd(2, 1), 2, 0), saved(rnd(2, 2), 2, 0)]
DE_W1 = [saved(win(1, m), 2, 0) for m in (1, 2, 3, 4)]
DE_TO_L4 = DE_W1 + [saved(los(1, 1), 2, 0), saved(los(1, 2), 2, 0), saved(win(2, 1), 2, 0),
                    saved(win(2, 2), 2, 0), saved(los(2, 1), 2, 0), saved(los(2, 2), 2, 0),
                    saved(win(3, 1), 2, 0), saved(los(3, 1), 2, 0), saved(los(4, 1), 2, 0)]
EDIT_STEPS = SE_R1 + [saved(rnd(2, 1), 2, 1), dis(rnd(2, 2), 2, 0, "Ben", 0, 2), res(rnd(2, 2), 2, 0)]
EDIT_CARD = "Round 1, match 1: Ana vs Hal, 2-0, Ana wins"
R2M1_DONE = "Round 2, match 1: Ana vs Dov, 2-1, Ana wins"
R3M1_OPEN = "Round 3, match 1: Ana vs Ben, not played"

RR5_RESULTS = {rnd(1, 2): (2, 0), rnd(1, 3): (2, 1), rnd(2, 1): (2, 0), rnd(2, 3): (2, 0),
               rnd(3, 1): (2, 0), rnd(3, 2): (1, 2), rnd(4, 1): (0, 2), rnd(4, 2): (1, 2),
               rnd(5, 1): (2, 1), rnd(5, 3): (2, 1)}
RR5_TABLE = [["1", "Ben", "4", "9", "3", "+4", "7", "2", "Game difference"],
             ["2", "Ana", "4", "9", "3", "+3", "6", "1", "Game difference"],
             ["3", "Cai", "4", "9", "3", "+2", "6", "3", "Game difference"],
             ["4", "Dov", "4", "3", "0", "-3", "4", "4", "Match points"],
             ["5", "Eli", "4", "0", "0", "-6", "2", "5", "Match points"]]
SWISS6_R1 = [saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 1, 2), saved(rnd(1, 3), 1, 1)]
SWISS6_R2 = [saved(rnd(2, 1), 2, 1), saved(rnd(2, 2), 2, 0), saved(rnd(2, 3), 1, 1)]
SWISS6_TABLE = [("Ana", 6, 3, 4, 4, 1), ("Cai", 4, 2, 2, 1, 3), ("Eli", 3, 6, 6, 0, 5),
                ("Fen", 2, 4, 5, 2.5, 6), ("Dov", 1, 6, 8, 1, 4), ("Ben", 0, 4, 7, 0, 2)]


@dataclass
class Cup:
    base: str
    id: str
    share_code: str
    entrants: dict[str, str]
    matches: dict[str, str]
    org: str
    co: str
    viewer: str
    users: dict[str, str]

    @property
    def path(self) -> str:
        return f"/api/tournaments/{self.id}"


def seed_cup(base: str, fmt: str, n: int = 8, state: str = "running", steps: list | tuple = (), *,
             checked_in: set[str] | None = None, closes_at: str | None = None, time_zone: str = "UTC",
             co: bool = True, tag: str | None = None, new_users: bool = True, linked: bool = True) -> Cup:
    tag = tag or fresh()
    org, co_user, viewer = f"dana_{tag}", f"eve_{tag}", f"zed_{tag}"
    names = NAMES[:n]
    users = {nm: f"{nm.lower()}_{tag}" for nm in NAMES}
    accounts = [org, co_user, viewer, *users.values()] if new_users else []
    entrants = []
    for i, nm in enumerate(names):
        present = (state != "draft") if checked_in is None else nm in checked_in
        e = {"name": nm, "seed": i + 1, "checked_in": present}
        if linked:
            e["username"] = users[nm]
        entrants.append(e)
    t = {"key": "cup", "name": CUP, "format": fmt, "organizer": org, "co_organizers": [co_user] if co else [],
         "time_zone": time_zone, "fill": "lilac", "state": state, "entrants": entrants, "steps": list(steps)}
    if closes_at:
        t["checkin_closes_at"] = closes_at
    body = {"users": [{"username": u, "password": PASSWORD} for u in accounts], "tournaments": [t]}
    data = ok_json(post_json(base, "/api/grading/seed", body), 201, "POST /api/grading/seed")
    d = data["tournaments"]["cup"]
    return Cup(base, d["id"], d["share_code"], d["entrants"], d["matches"], org, co_user, viewer, users)


def board(api: Api, cup: Cup) -> dict[str, dict]:
    body = ok_json(api.get(f"{cup.path}/matches"), 200, "GET matches")
    return {m["label"]: m for m in body["matches"]}


def who(slot: dict | None) -> str | None:
    if slot is None:
        return None
    return "bye" if slot.get("bye") else slot["name"]


def write(api: Api, cup: Cup, label: str, action: str, u: int | None = None, l: int | None = None) -> httpx.Response:
    m = board(api, cup)[label]
    body: dict[str, Any] = {"version": m["version"]}
    if u is not None:
        body.update(upper_games=u, lower_games=l)
    return api.post(f"/api/matches/{m['id']}/{action}", body)


def tournament(api: Api, cup: Cup) -> dict:
    return ok_json(api.get(cup.path), 200, "GET tournament")["tournament"]


def entrant_names(api: Api, cup: Cup) -> list[str]:
    return [e["name"] for e in ok_json(api.get(f"{cup.path}/entrants"), 200, "GET entrants")["entrants"]]


def standings(api: Api, cup: Cup) -> dict:
    return ok_json(api.get(f"{cup.path}/standings"), 200, "GET standings")


def history_text(api: Api, username: str, tid: str) -> str:
    rows = ok_json(api.get(f"/api/users/{username}/history"), 200, "GET history")["rows"]
    mine = [r for r in rows if r["tournament_id"] == tid]
    assert len(mine) == 1, f"one history row per finished tournament for {username}, got {rows}"
    return mine[0]["text"]


def png(width: int = 4, height: int = 4) -> bytes:
    raw = b"".join(b"\x00" + b"\xf2\x8c\x28" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


JPEG_HEAD = b"\xff\xd8\xff\xe0" + bytes(64)


@contextmanager
def _ctx(made: Any) -> Iterator[Any]:
    if hasattr(made, "__enter__"):
        with made as value:
            yield value
        return
    value = next(made)
    try:
        yield value
    finally:
        made.close()


@contextmanager
def screen(browser: Browser, base: str, path: str, user: str | None = None, *, size: dict = DESK,
           reduced: str = "no-preference", touch: bool = False) -> Iterator[Page]:
    first = "/api/health" if (user or touch) else path
    with _ctx(open_app(browser, base + first, reduced_motion=reduced)) as page:
        page.set_viewport_size(size)
        if touch:
            session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        if user:
            r = page.request.post(base + "/api/grading/session", data={"username": user})
            assert r.status == 200, f"POST /api/grading/session {user}: {r.status}"
        if user or touch:
            page.goto(base + path)
        yield page


def wait_until(page: Page, check: Callable[[], Any], what: str, seconds: float = WAIT_S, *,
               by: float | None = None, step: float = STEP_MS) -> None:
    deadline = by if by is not None else time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except PlaywrightError as err:
            last = err
        advance(page, step)
    try:
        if check():
            return
    except PlaywrightError as err:
        last = err
    pytest.fail(f"{what} (last error: {last})")


def card(page: Page | Locator, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name)


def games(name: str) -> str:
    return f"{name} games"


def named(template: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        template = template.replace(f"<{key}>", value)
    return template


def seat(number: int, name: str) -> str:
    return f"{number}. {name}"


def text(loc: Locator) -> str:
    return (loc.first.text_content() or "").strip() if loc.count() else ""


def shown(page: Page, loc: Locator, what: str, **kw: Any) -> None:
    wait_until(page, lambda: loc.count() > 0 and loc.first.is_visible(), f"{what} is shown", **kw)


def present(page: Page, loc: Locator, what: str, **kw: Any) -> None:
    wait_until(page, lambda: loc.count() > 0, f"{what} is present", **kw)


def reads(page: Page, loc: Locator, expected: str, what: str, **kw: Any) -> None:
    wait_until(page, lambda: expected in text(loc), f"{what} reads {expected!r}", **kw)


def active_match(page: Page) -> str | None:
    return page.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-match-id')")


def is_focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e === document.activeElement")


def focus_in(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e.contains(document.activeElement)")


def box(loc: Locator) -> dict:
    b = loc.first.bounding_box()
    assert b is not None, "element has a layout box"
    return b


def tokens(loc: Locator) -> list[str]:
    return [t.strip() for t in re.split(r"[\t\n]+", loc.inner_text()) if t.strip()]


def table_rows(page: Page) -> list[list[str]]:
    rows = page.get_by_role("table", name="Standings").get_by_role("row")
    return [tokens(rows.nth(i)) for i in range(rows.count())]


def no_page_overflow(page: Page) -> None:
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), \
        "the page scrolls horizontally (L112: panning happens inside the bracket area)"


def report_dialog(page: Page, card_name: str, upper: str, lower: str, u: int, l: int, button: str) -> Locator:
    c = card(page, card_name)
    shown(page, c, card_name)
    click(c.first)
    dlg = page.get_by_role("dialog", name="Report score")
    shown(page, dlg, 'dialog "Report score"')
    fill(dlg.get_by_role("spinbutton", name=f"{upper} games"), str(u))
    fill(dlg.get_by_role("spinbutton", name=f"{lower} games"), str(l))
    click(dlg.get_by_role("button", name=button, exact=True))
    return dlg


LISTEN_JS = """([url, key]) => new Promise((resolve) => {
  window.__cupfold = window.__cupfold || {};
  const box = {messages: [], closed: null};
  window.__cupfold[key] = box;
  const ws = new WebSocket(url);
  box.ws = ws;
  ws.onmessage = (e) => box.messages.push(JSON.parse(e.data));
  ws.onclose = (e) => { box.closed = {code: e.code, reason: e.reason}; resolve(false); };
  ws.onopen = () => resolve(true);
})"""


def listen(page: Page, base: str, path: str, key: str) -> None:
    url = re.sub(r"^http", "ws", base) + path
    assert page.evaluate(LISTEN_JS, [url, key]), f"WebSocket {path} opens"


def heard(page: Page, key: str) -> list[dict]:
    return page.evaluate("k => window.__cupfold[k].messages", key)


def socket_closed(page: Page, key: str) -> dict | None:
    return page.evaluate("k => window.__cupfold[k].closed", key)


def hang_up(page: Page, key: str) -> None:
    page.evaluate("k => window.__cupfold[k].ws.close()", key)


def open_edit(page: Page, u: int, l: int) -> tuple[Locator, Locator]:
    c = card(page, EDIT_CARD)
    shown(page, c, "the confirmed card to edit")
    click(c.first)
    details = page.get_by_role("dialog", name="Match details")
    shown(page, details, 'dialog "Match details"')
    click(details.get_by_role("button", name="Edit result"))
    edit = page.get_by_role("dialog", name="Edit result")
    shown(page, edit, 'dialog "Edit result"')
    fill(edit.get_by_role("spinbutton", name=games("Ana")), str(u))
    fill(edit.get_by_role("spinbutton", name=games("Hal")), str(l))
    return details, edit


def swipe(page: Page, target: Locator, dx: float) -> None:
    b = box(target)
    x0 = b["x"] + b["width"] / 2
    y = b["y"] + min(b["height"] / 2, SWIPE_Y_PX)
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
    for i in range(1, SWIPE_MOVES + 1):
        cdp.send("Input.dispatchTouchEvent",
                 {"type": "touchMove", "touchPoints": [{"x": x0 + dx * i / SWIPE_MOVES, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def selected_tab(page: Page, name: str) -> bool:
    tab = page.get_by_role("tablist", name="Rounds").get_by_role("tab", name=name, exact=True)
    return tab.count() > 0 and tab.first.get_attribute("aria-selected") == "true"


def centre(r: dict) -> tuple[float, float]:
    x = r.get("x", r.get("left", 0.0))
    y = r.get("y", r.get("top", 0.0))
    return x + r.get("width", 0.0) / 2, y + r.get("height", 0.0) / 2


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str], drop: tuple[str, ...] = ()) -> Iterator[str]:
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base}
    for key in drop:
        env.pop(key, None)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_bytes()[-4000:].decode("utf-8", "replace")

    try:
        deadline = time.monotonic() + BOOT_S
        up = False
        while time.monotonic() < deadline and not up:
            try:
                up = httpx.get(base + "/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                up = False
            if not up:
                try:
                    proc.wait(timeout=1)
                    pytest.fail(f"app copy exited with {proc.returncode}: {tail()}")
                except subprocess.TimeoutExpired:
                    pass
        if not up:
            pytest.fail(f"app copy never answered GET /api/health 200: {tail()}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=30)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()


class Relay:

    def __init__(self, target: tuple[str, int], port: int = 0):
        self.target = target
        self.stopped = threading.Event()
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopped.is_set():
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    def _pipe(self, src: socket.socket, dst: socket.socket) -> None:
        try:
            while not self.stopped.is_set():
                data = src.recv(RELAY_CHUNK)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        self.stopped.set()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()
        with self.lock:
            for s in self.conns:
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()


def test_health_and_served_files(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
    page = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200 and page.content
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, f"{path} must answer 404"
    refused(httpx.get(app_url + f"/api/no_such_route_{fresh()}", timeout=HTTP_TIMEOUT_S), 404, "not_found")


def test_accounts_signup_signin_signout(app_url):
    tag = fresh()
    c = Api(app_url)
    bad = refused(c.post("/api/auth/signup", {"username": "a!", "password": "short"}), 422, "validation",
                  "Check the highlighted fields.")
    assert bad["fields"]["username"] == "Use 3 to 24 characters: a-z, 0-9 or _."
    assert bad["fields"]["password"] == "Use at least 8 characters."
    mixed = f"Ana_{tag}"
    r = c.post("/api/auth/signup", {"username": mixed, "password": PASSWORD})
    assert ok_json(r, 201, "sign-up")["user"]["username"] == mixed.lower()
    cookie = "; ".join(r.headers.get_list("set-cookie")).lower()
    for part in ("cupfold_session", "HttpOnly", "SameSite=Lax", "Path=/"):
        assert part.lower() in cookie, f"session cookie carries {part}: {cookie}"
    assert ok_json(c.get("/api/me"), 200, "GET /api/me")["user"]["username"] == mixed.lower()
    refused(Api(app_url).post("/api/auth/signup", {"username": mixed.lower(), "password": PASSWORD}), 409,
            "username_taken", "That username is taken.")
    assert c.post("/api/auth/signout").status_code == 204
    refused(c.get("/api/me"), 401, "unauthenticated", "Sign in to continue.")
    refused(c.post("/api/auth/signin", {"username": mixed.lower(), "password": PASSWORD + "x"}), 401,
            "bad_credentials", "Username or password is wrong.")
    assert ok_json(c.post("/api/auth/signin", {"username": mixed.lower(), "password": PASSWORD}), 200,
                   "sign-in")["user"]["username"] == mixed.lower()
    assert c.get("/api/me").status_code == 200

    limited = f"rl_{tag}"
    ok_json(Api(app_url).post("/api/auth/signup", {"username": limited, "password": PASSWORD}), 201, "sign-up")
    probe = Api(app_url)
    for _ in range(LOGIN_RATE):
        refused(probe.post("/api/auth/signin", {"username": limited, "password": "wrong-pass-0"}), 401,
                "bad_credentials")
    refused(probe.post("/api/auth/signin", {"username": limited, "password": PASSWORD}), 429, "rate_limited",
            "Too many sign-in attempts. Wait a minute and try again.")
    move_clock(app_url, RATE_WINDOW_MS + CLOCK_MARGIN_MS)
    ok_json(probe.post("/api/auth/signin", {"username": limited, "password": PASSWORD}), 200,
            "sign-in once the rolling minute has passed on server time")


def _exact_body(size: int) -> bytes:
    body = {"name": "", "format": SE, "time_zone": "UTC", "fill": "lilac"}
    empty = len(json.dumps(body, separators=(",", ":")).encode())
    body["name"] = "n" * (size - empty)
    data = json.dumps(body, separators=(",", ":")).encode()
    assert len(data) == size
    return data


def test_error_shape_and_precedence(app_url):
    cup = seed_cup(app_url, SE, n=4, steps=[saved(rnd(1, 1), 2, 0)])
    draft = seed_cup(app_url, SE, n=4, state="draft")
    anon = Api(app_url)
    json_header = {"content-type": "application/json"}
    too_big = _exact_body(JSON_LIMIT + 1)
    refused(anon.post(f"/api/share/{cup.share_code}", content=too_big, headers=json_header), 405, "read_only",
            "Share links are read-only.")
    refused(anon.post("/api/tournaments", content=too_big, headers=json_header), 413, "too_large",
            f"The request body is larger than {JSON_LIMIT} bytes.")
    refused(anon.get(draft.path), 401, "unauthenticated", "Sign in to continue.")
    refused(anon.post(f"{cup.path}/start"), 401, "unauthenticated")
    org = Api(app_url, cup.org)
    at_limit = refused(org.post("/api/tournaments", content=_exact_body(JSON_LIMIT), headers=json_header), 422,
                       "validation")
    assert at_limit["fields"]["name"] == "Enter a name of 1 to 60 characters."
    viewer = Api(app_url, cup.viewer)
    refused(viewer.get(draft.path), 404, "not_found", "We couldn't find that tournament.")
    refused(viewer.post(f"{draft.path}/start"), 404, "not_found")
    refused(viewer.get(f"/api/tournaments/missing{fresh()}"), 404, "not_found", "We couldn't find that tournament.")
    refused(viewer.post(f"{cup.path}/start"), 403, "forbidden", "You cannot change this tournament.")
    m = board(org, cup)[rnd(1, 1)]
    refused(org.post(f"/api/matches/{m['id']}/result", {"upper_games": 0, "lower_games": 0, "version": m["version"]}),
            409, "wrong_state", "This match already has a result.")
    refused(org.post(f"{cup.path}/co-organizers", {"username": cup.viewer},
                     headers={"Origin": "http://elsewhere.example"}), 403, "forbidden",
            "Cross-site requests are refused.")
    assert cup.viewer not in tournament(org, cup)["co_organizers"], "a refused cross-site write changed nothing"


def test_match_write_rate_limit(app_url):
    cup = seed_cup(app_url, RR, n=8)
    org = Api(app_url, cup.org)
    playable = [m for m in board(org, cup).values() if m["state"] == "pending" and m["upper"] and m["lower"]]
    assert len(playable) > REPORT_RATE
    for m in playable[:REPORT_RATE]:
        ok_json(org.post(f"/api/matches/{m['id']}/result", {"upper_games": 2, "lower_games": 0,
                                                             "version": m["version"]}), 200, "organizer save")
    extra = playable[REPORT_RATE]
    refused(org.post(f"/api/matches/{extra['id']}/result", {"upper_games": 2, "lower_games": 0,
                                                            "version": extra["version"]}), 429, "rate_limited",
            "Too many score reports. Wait a minute and try again.")
    after = board(org, cup)[extra["label"]]
    assert after["state"] == "pending" and after["version"] == extra["version"]
    move_clock(app_url, RATE_WINDOW_MS + CLOCK_MARGIN_MS)
    ok_json(org.post(f"/api/matches/{extra['id']}/result", {"upper_games": 2, "lower_games": 0,
                                                            "version": extra["version"]}), 200,
            "write allowed once the rolling minute passed")


def test_grading_routes(app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[saved(rnd(1, 2), 2, 1), rep(rnd(1, 1), 2, 0, "Ana"),
                                           dis(rnd(1, 3), 2, 0, "Ben", 0, 2), called(rnd(1, 4))])
    assert re.fullmatch(r"[A-Za-z0-9_-]{%d}" % SHARE_CODE_LEN, cup.share_code), cup.share_code
    assert set(cup.entrants) == set(NAMES) and rnd(3, 1) in cup.matches
    s = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    r = s.post("/api/grading/session", json={"username": cup.org})
    assert ok_json(r, 200, "grading session")["user"]["username"] == cup.org
    assert "cupfold_session" in "; ".join(r.headers.get_list("set-cookie"))
    assert s.get("/api/me").json()["user"]["username"] == cup.org
    refused(s.post("/api/grading/session", json={"username": f"ghost_{fresh()}"}), 404, "not_found")
    ms = board(Api(app_url, cup.org), cup)
    assert ms[rnd(1, 2)]["state"] == "confirmed" and ms[rnd(1, 2)]["updated_by"] == cup.org
    assert who(ms[rnd(2, 1)]["lower"]) == "Dov"
    assert ms[rnd(1, 1)]["state"] == "reported" and ms[rnd(1, 1)]["report"]["by"] == "Ana"
    assert ms[rnd(1, 1)]["updated_by"] == cup.users["Ana"]
    d = ms[rnd(1, 3)]
    assert d["state"] == "disputed" and d["report"]["by"] == "Ben" and d["dispute"]["by"] == "Gus"
    assert (d["dispute"]["upper_games"], d["dispute"]["lower_games"]) == (0, 2) and d["updated_by"] == cup.users["Gus"]
    assert ms[rnd(1, 4)]["state"] == "called"

    ghost = f"ghost_{fresh()}"
    bad = {"users": [{"username": ghost, "password": PASSWORD}],
           "tournaments": [{"key": "cup", "name": CUP, "format": SE, "organizer": ghost, "co_organizers": [],
                            "time_zone": "UTC", "fill": "lilac", "state": "running",
                            "entrants": [{"name": "Ana", "seed": 1}, {"name": "Ben", "seed": 2}],
                            "steps": [saved(rnd(1, 1), 1, 1)]}]}
    refused(post_json(app_url, "/api/grading/seed", bad), 422, "validation", NEED_WINNER)
    refused(post_json(app_url, "/api/grading/session", {"username": ghost}), 404, "not_found")
    bad["tournaments"][0].update(state="finished", steps=[])
    refused(post_json(app_url, "/api/grading/seed", bad), 422, "validation")
    taken = {"users": [{"username": cup.org, "password": PASSWORD}], "tournaments": []}
    refused(post_json(app_url, "/api/grading/seed", taken), 409, "username_taken")

    before = server_now(app_url)
    assert move_clock(app_url, 0) >= before
    moved = move_clock(app_url, CLOCK_PROBE_MS)
    assert moved - before >= timedelta(milliseconds=CLOCK_PROBE_MS)
    for out in (CLOCK_MAX_MS + 1, -1):
        refused(post_json(app_url, "/api/grading/clock", {"advance_ms": out}), 422, "validation")


@pytest.mark.timeout(900)
def test_grading_routes_absent_without_flag():
    with app_copy({}, drop=("CUPFOLD_GRADING",)) as base:
        for path, body in (("/api/grading/seed", {"users": [], "tournaments": []}),
                           ("/api/grading/session", {"username": "dana"}),
                           ("/api/grading/clock", {"advance_ms": 0})):
            refused(post_json(base, path, body), 404, "not_found")


ENV_PROBE = {"CUPFOLD_CONFIRM_WINDOW_MS": "45000", "CUPFOLD_MATCH_LIMIT_MS": "46000",
             "CUPFOLD_SWISS_ROUND_MS": "47000", "CUPFOLD_TOAST_MS": "2345", "CUPFOLD_LOGIN_RATE": "3",
             "CUPFOLD_REPORT_RATE": "2", "CUPFOLD_ROSTER_MAX_BYTES": "2048",
             "CUPFOLD_LOGO_MAX_BYTES": "1024"}
CONFIG_KEYS = {"confirm_window_ms": "CUPFOLD_CONFIRM_WINDOW_MS", "match_limit_ms": "CUPFOLD_MATCH_LIMIT_MS",
               "swiss_round_ms": "CUPFOLD_SWISS_ROUND_MS", "toast_ms": "CUPFOLD_TOAST_MS",
               "roster_max_bytes": "CUPFOLD_ROSTER_MAX_BYTES", "logo_max_bytes": "CUPFOLD_LOGO_MAX_BYTES"}


@pytest.mark.timeout(900)
def test_timers_and_limits_follow_environment():
    with app_copy(ENV_PROBE) as base:
        cfg = config(base)
        for key, var in CONFIG_KEYS.items():
            assert cfg[key] == int(ENV_PROBE[var]), f"/api/config {key} follows {var}"
        login = int(ENV_PROBE["CUPFOLD_LOGIN_RATE"])
        user = f"rl_{fresh()}"
        ok_json(Api(base).post("/api/auth/signup", {"username": user, "password": PASSWORD}), 201, "sign-up")
        probe = Api(base)
        for _ in range(login):
            refused(probe.post("/api/auth/signin", {"username": user, "password": "wrong-pass-0"}), 401,
                    "bad_credentials")
        refused(probe.post("/api/auth/signin", {"username": user, "password": PASSWORD}), 429, "rate_limited")
        timed = seed_cup(base, SE, n=4, steps=[rep(rnd(1, 1), 2, 1, "Ana")])
        report = board(Api(base, timed.org), timed)[rnd(1, 1)]["report"]
        gap = parse(report["auto_confirm_at"]) - parse(report["reported_at"])
        assert gap == timedelta(milliseconds=int(ENV_PROBE["CUPFOLD_CONFIRM_WINDOW_MS"]))
        writes = int(ENV_PROBE["CUPFOLD_REPORT_RATE"])
        cup = seed_cup(base, RR, n=8)
        org = Api(base, cup.org)
        playable = [m for m in board(org, cup).values() if m["state"] == "pending" and m["upper"] and m["lower"]]
        for m in playable[:writes]:
            ok_json(org.post(f"/api/matches/{m['id']}/result", {"upper_games": 2, "lower_games": 0,
                                                                 "version": m["version"]}), 200, "organizer save")
        extra = playable[writes]
        refused(org.post(f"/api/matches/{extra['id']}/result", {"upper_games": 2, "lower_games": 0,
                                                                "version": extra["version"]}), 429, "rate_limited")
        roster = int(ENV_PROBE["CUPFOLD_ROSTER_MAX_BYTES"])
        draft = seed_cup(base, SE, n=2, state="draft")
        dorg = Api(base, draft.org)
        head = b"1 | Ana\n2 | Ben\n"
        exact = b"# " + b"x" * (roster - len(head) - 3) + b"\n" + head
        assert len(exact) == roster
        ok_json(dorg.upload(f"{draft.path}/roster", "edge.cupfold.txt", exact), 201, "roster at the configured limit")
        refused(dorg.upload(f"{draft.path}/roster", "over.cupfold.txt", exact + b"x"), 413, "too_large",
                f"This file is larger than {roster} bytes.")
        logo = int(ENV_PROBE["CUPFOLD_LOGO_MAX_BYTES"])
        image = png()
        image += b"\x00" * (logo - len(image) + 1)
        refused(dorg.upload(f"{draft.path}/logo", "logo.png", image, "image/png"), 413, "too_large",
                f"This file is larger than {logo} bytes.")


def test_config_limits_from_environment(app_url):
    cfg = config(app_url)
    for key in ("confirm_window_ms", "match_limit_ms", "swiss_round_ms", "toast_ms", "roster_max_bytes", "logo_max_bytes"):
        assert isinstance(cfg[key], int) and cfg[key] > 0, f"/api/config {key}: {cfg.get(key)}"
    parse(cfg["server_time"])
    cup = seed_cup(app_url, SE, n=4, state="draft")
    org = Api(app_url, cup.org)
    limit = cfg["roster_max_bytes"]
    body = b"\n1 | Ana\n2 | Ben\n"
    pad = limit - len(body) - 2
    exact = b"# " + b"x" * pad + body
    assert len(exact) == limit
    ok_json(org.upload(f"{cup.path}/roster", "edge.cupfold.txt", exact), 201, "roster at the byte limit")
    refused(org.upload(f"{cup.path}/roster", "over.cupfold.txt", exact + b"x"), 413, "too_large",
            f"This file is larger than {limit} bytes.")
    logo_limit = cfg["logo_max_bytes"]
    image = png()
    image += b"\x00" * (logo_limit - len(image))
    ok_json(org.upload(f"{cup.path}/logo", "logo.png", image, "image/png"), 201, "logo at the byte limit")
    refused(org.upload(f"{cup.path}/logo", "logo.png", image + b"\x00", "image/png"), 413, "too_large",
            f"This file is larger than {logo_limit} bytes.")
    running = seed_cup(app_url, SE, n=4, steps=[rep(rnd(1, 1), 2, 1, "Ana")])
    report = board(Api(app_url, running.org), running)[rnd(1, 1)]["report"]
    gap = parse(report["auto_confirm_at"]) - parse(report["reported_at"])
    assert gap == timedelta(milliseconds=cfg["confirm_window_ms"]), "auto-confirm uses the published window"


def test_wf_roster_upload_outage_happy(browser, app_url):
    tag = fresh()
    org_name = f"dana_{tag}"
    nobody = f"nobody_{tag}"
    bad = f"1 | Ana\n1 | Ben\nCai @{nobody}\nana\nDov\n".encode()
    good = b"1 | Ana\n2 | Ben\nCai\nDov\n"
    file_name = "thursday.cupfold.txt"
    with screen(browser, app_url, "/signup") as page:
        fill(page.get_by_role("textbox", name="Username"), org_name)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        wait_until(page, lambda: urlsplit(page.url).path == "/t", "sign-up without ?next lands on /t")
        page.goto(app_url + "/t/new")
        fill(page.get_by_role("textbox", name="Tournament name"), CUP)
        check(page.get_by_role("radio", name="Single elimination"))
        select(page.get_by_role("combobox", name="Time zone"), "UTC")
        check(page.get_by_role("radio", name="Lilac"))
        click(page.get_by_role("button", name="Create tournament"))
        wait_until(page, lambda: re.fullmatch(r"/t/[^/]+/setup", urlsplit(page.url).path),
                   "creating lands on /t/<id>/setup")
        tid = urlsplit(page.url).path.split("/")[2]
        page.reload()
        shown(page, page.get_by_role("heading", name=CUP, level=1), "setup heading after reload")
        org = Api(app_url, org_name)

        def send(data: bytes) -> None:
            dlg = page.get_by_role("dialog", name="Upload roster")
            if not (dlg.count() and dlg.first.is_visible()):
                click(page.get_by_role("button", name="Upload roster"))
            shown(page, dlg, 'dialog "Upload roster"')
            dlg.get_by_label("Roster file").set_input_files({"name": file_name, "mimeType": "text/plain", "buffer": data})
            click(dlg.get_by_role("button", name="Add roster"))

        send(bad)
        errors = page.get_by_role("list", name="Roster errors").get_by_role("listitem")
        expected = ["Line 2: seed 1 is already used on line 1", f"Line 3: no account named @{nobody}",
                    'Line 4: duplicate name "Ana" (first on line 1)']
        wait_until(page, lambda: [t.strip() for t in errors.all_text_contents()] == expected, "roster errors in order")
        heading = page.get_by_role("heading", name=ROSTER_INVALID, level=2)
        wait_until(page, lambda: is_focused(heading), "focus moves to the roster error heading")
        assert ok_json(org.get(f"/api/tournaments/{tid}/entrants"), 200, "entrants")["entrants"] == []
        send(good)
        reads(page, status(page, "Page notice"), f"Added 4 entrants from {file_name}.", "page notice")
        seeding = page.get_by_role("list", name="Seeding")
        for i, nm in enumerate(("Ana", "Ben", "Cai", "Dov"), 1):
            present(page, seeding.get_by_role("listitem", name=seat(i, nm), exact=True), f"seed {i} {nm}")
        with page.expect_download() as dl:
            click(page.get_by_role("button", name="Download roster file"))
        assert Path(dl.value.path()).read_bytes() == good, "downloaded roster is byte for byte the upload"
        image = png()
        click(page.get_by_role("button", name="Upload logo"))
        logo_dlg = page.get_by_role("dialog", name="Upload logo")
        logo_dlg.get_by_label("Logo image").set_input_files({"name": "logo.png", "mimeType": "image/png", "buffer": image})
        click(logo_dlg.get_by_role("button", name="Add logo"))
        shown(page, page.get_by_role("img", name=f"{CUP} logo"), "logo on the setup page")
        assert f"logos/{tid}/{hashlib.sha256(image).hexdigest()}.png" in S3().keys(f"logos/{tid}/")
        ok_json(org.post(f"/api/tournaments/{tid}/checkin/open", {}), 200, "open check-in")
        share = urlsplit(ok_json(org.get(f"/api/tournaments/{tid}"), 200, "t")["tournament"]["share_url"]).path
        page.goto(app_url + share)
        shown(page, page.get_by_role("img", name=f"{CUP} logo"), "logo on the public page after check-in opens")


ROSTER_CASES = ["line_errors", "file_name", "empty", "not_utf8", "count", "cap"]


@pytest.mark.parametrize("case", ROSTER_CASES, ids=ROSTER_CASES)
def test_roster_format_refusals(app_url, case):
    cup = seed_cup(app_url, SE, n=2, state="draft")
    org = Api(app_url, cup.org)
    before = entrant_names(org, cup)
    ana = cup.users["Ana"]
    url = f"{cup.path}/roster"
    if case == "line_errors":
        nobody = f"nobody_{fresh()}"
        lines = ["# Thursday back room cup", f"1 | Ana @{ana}", "1 | Ben", "x | Cai", "99 | Dov", "", "2 |",
                 "N" * (NAME_MAX + 1), "ana", f"Eli @{nobody}", f"Fen @{ana}"]
        body = refused(org.upload(url, "a.cupfold.txt", "\n".join(lines).encode()), 422, "roster_invalid", ROSTER_INVALID)
        assert body["errors"] == [
            "Line 3: seed 1 is already used on line 2", "Line 4: seed must be a whole number from 1 to 128",
            "Line 5: seed 99 is larger than the number of entrants (9)", "Line 7: name is empty",
            "Line 8: name is longer than 40 characters", 'Line 9: duplicate name "Ana" (first on line 2)',
            f"Line 10: no account named @{nobody}", f"Line 11: @{ana} is already on line 2"]
    elif case == "file_name":
        refused(org.upload(url, "field.csv", b"Ana\nBen\n"), 422, "validation", "Roster files end in .cupfold.txt.")
        assert S3().keys(f"rosters/{cup.id}/") == [], "a refused file name is not stored"
    elif case == "empty":
        refused(org.upload(url, "a.cupfold.txt", b""), 422, "validation", "The roster file is empty.")
        assert S3().keys(f"rosters/{cup.id}/") == [], "an empty file is not stored"
    elif case == "not_utf8":
        data = b"Ana\n\xc3\x28 Ben\n"
        body = refused(org.upload(url, "a.cupfold.txt", data), 422, "roster_invalid", ROSTER_INVALID)
        assert body["errors"] == ["The roster file is not UTF-8 text."]
        key = f"rosters/{cup.id}/{hashlib.sha256(data).hexdigest()}.cupfold.txt"
        assert S3().get(key) == data, "rejected files are stored too (L941)"
    elif case == "count":
        body = refused(org.upload(url, "a.cupfold.txt", b"Ana\n"), 422, "roster_invalid", ROSTER_INVALID)
        assert body["errors"] == ["The roster has 1 entrants. A roster needs 2 to 128."]
    else:
        data = "\n".join(f"x | P{i}" for i in range(ROSTER_LINE_CAP + 5)).encode()
        body = refused(org.upload(url, "a.cupfold.txt", data), 422, "roster_invalid", ROSTER_INVALID)
        assert body["errors"] == [f"Line {i}: seed must be a whole number from 1 to 128"
                                  for i in range(1, ROSTER_LINE_CAP + 1)]
    assert entrant_names(org, cup) == before, "a refused roster changes nothing"


def test_roster_stored_byte_for_byte(app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft")
    org = Api(app_url, cup.org)
    ana = cup.users["Ana"]
    data = f"\ufeff# Thursday back room cup\r\n2 | Ben\r\nAna @{ana}\r\n\r\nCai\r\n1 | Dov\r\n".encode()
    sha = hashlib.sha256(data).hexdigest()
    night = "night.cupfold.txt"
    body = ok_json(org.upload(f"{cup.path}/roster", night, data), 201, "roster upload")
    assert body["sha256"] == sha and body["file_name"] == night
    assert [e["name"] for e in body["entrants"]] == ["Dov", "Ben", "Ana", "Cai"]
    assert S3().get(f"rosters/{cup.id}/{sha}.cupfold.txt") == data
    listed = ok_json(org.get(f"{cup.path}/entrants"), 200, "entrants")["entrants"]
    assert [(e["name"], e["seed"]) for e in listed] == [("Dov", 1), ("Ben", 2), ("Ana", 3), ("Cai", 4)]
    assert {e["name"]: e["username"] for e in listed}["Ana"] == ana
    rejected = b"Solo\n"
    refused(org.upload(f"{cup.path}/roster", "solo.cupfold.txt", rejected), 422, "roster_invalid")
    assert S3().get(f"rosters/{cup.id}/{hashlib.sha256(rejected).hexdigest()}.cupfold.txt") == rejected
    assert entrant_names(org, cup) == ["Dov", "Ben", "Ana", "Cai"]


def test_roster_download_byte_for_byte(browser, app_url):
    cup = seed_cup(app_url, SE, n=2, state="draft")
    org = Api(app_url, cup.org)
    refused(org.get(f"{cup.path}/roster"), 404, "not_found", "No roster file has been added.")
    v2_name = "v2.cupfold.txt"
    v1, v2 = b"Ana\nBen\n", b"\xef\xbb\xbf2 | Ben\r\n1 | Ana\r\nCai\r\n"
    ok_json(org.upload(f"{cup.path}/roster", "v1.cupfold.txt", v1), 201, "v1")
    ok_json(org.upload(f"{cup.path}/roster", v2_name, v2), 201, "v2")
    refused(org.upload(f"{cup.path}/roster", "v3.cupfold.txt", b"Solo\n"), 422, "roster_invalid")
    r = org.get(f"{cup.path}/roster")
    assert r.status_code == 200 and r.content == v2
    assert r.headers["content-type"].lower().replace(" ", "").startswith("text/plain;charset=utf-8")
    assert v2_name in r.headers["content-disposition"]
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        button = page.get_by_role("button", name="Download roster file")
        shown(page, button, "Download roster file")
        with page.expect_download() as dl:
            click(button)
        assert Path(dl.value.path()).read_bytes() == v2
        assert dl.value.suggested_filename == v2_name


def test_logo_stored_and_shown(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, state="draft")
    org = Api(app_url, cup.org)
    refused(org.upload(f"{cup.path}/logo", "logo.gif", b"GIF89a" + bytes(16), "image/gif"), 422, "validation",
            "Logos must be PNG or JPEG images.")
    assert tournament(org, cup)["logo_url"] is None
    jpeg = ok_json(org.upload(f"{cup.path}/logo", "logo.jpg", JPEG_HEAD, "image/jpeg"), 201, "jpeg logo")
    assert S3().get(f"logos/{cup.id}/{jpeg['sha256']}.jpg") == JPEG_HEAD
    image = png()
    body = ok_json(org.upload(f"{cup.path}/logo", "logo.png", image, "image/png"), 201, "png logo")
    assert body["sha256"] == hashlib.sha256(image).hexdigest() and body["logo_url"]
    assert S3().get(f"logos/{cup.id}/{body['sha256']}.png") == image
    got = org.get(f"{cup.path}/logo")
    assert got.status_code == 200 and got.content == image and got.headers["content-type"].startswith("image/png")
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        shown(page, page.get_by_role("img", name=f"{CUP} logo"), "logo on setup")
        page.goto(app_url + f"/s/{cup.share_code}")
        shown(page, page.get_by_text("This tournament is not public yet.", exact=True), "draft share copy")
        assert page.get_by_role("img", name=f"{CUP} logo").count() == 0
        ok_json(org.post(f"{cup.path}/checkin/open", {}), 200, "open check-in")
        page.reload()
        shown(page, page.get_by_role("img", name=f"{CUP} logo"), "logo on the public page")
    share_logo = httpx.get(app_url + f"/api/share/{cup.share_code}/logo", timeout=HTTP_TIMEOUT_S)
    assert share_logo.status_code == 200 and share_logo.content == image


def test_wf_roster_upload_outage_outage(browser):
    down = os.environ["APP_MINIO_DOWN_URL"]
    poll(lambda: httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "unavailable"},
         'health answers 200 {"status":"unavailable"} while MinIO is down', HEALTH_STALE_S + POLL_SLACK_S)
    assert httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200
    cup = seed_cup(down, SE, n=4, state="draft")
    org = Api(down, cup.org)
    refused(org.upload(f"{cup.path}/roster", "a.cupfold.txt", b"Ana\nBen\n"), 503, "storage_unavailable", STORAGE_DOWN)
    refused(org.upload(f"{cup.path}/logo", "logo.png", png(), "image/png"), 503, "storage_unavailable", STORAGE_DOWN)
    assert entrant_names(org, cup) == ["Ana", "Ben", "Cai", "Dov"]
    assert tournament(org, cup)["logo_url"] is None
    play = seed_cup(down, SE, n=4)
    assert ok_json(write(Api(down, play.users["Ana"]), play, rnd(1, 1), "report", 2, 1), 200, "report")["outcome"] == "reported"
    with screen(browser, down, f"/t/{cup.id}/setup", cup.org) as page:
        click(page.get_by_role("button", name="Upload roster"))
        dlg = page.get_by_role("dialog", name="Upload roster")
        shown(page, dlg, 'dialog "Upload roster"')
        dlg.get_by_label("Roster file").set_input_files({"name": "a.cupfold.txt", "mimeType": "text/plain",
                                                         "buffer": b"Ana\nBen\n"})
        click(dlg.get_by_role("button", name="Add roster"))
        reads(page, dlg.get_by_role("status", name="Dialog status"), STORAGE_DOWN, "dialog status")
        reads(page, page.get_by_role("alert"), STORAGE_DOWN, "lemon band")
        assert dlg.first.is_visible() and focus_in(dlg), "focus stays in the upload dialog"
    assert entrant_names(org, cup) == ["Ana", "Ben", "Cai", "Dov"]


@pytest.mark.timeout(900)
def test_storage_recovers_without_restart():
    target = urlsplit(os.environ["S3_ENDPOINT"])
    upstream = (target.hostname, target.port or (443 if target.scheme == "https" else 80))
    relay = Relay(upstream)
    port = relay.port
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{port}"}) as base:
            cup = seed_cup(base, SE, n=4, state="draft")
            org = Api(base, cup.org)
            ok_json(org.upload(f"{cup.path}/roster", "v1.cupfold.txt", b"Ana\nBen\n"), 201, "upload with storage up")
            relay.stop()
            poll(lambda: httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "unavailable"},
                 "health reports storage unavailable", HEALTH_STALE_S + POLL_SLACK_S)
            v2 = b"Cai\nDov\nEli\n"
            refused(org.upload(f"{cup.path}/roster", "v2.cupfold.txt", v2), 503, "storage_unavailable", STORAGE_DOWN)
            refused(org.get(f"{cup.path}/roster"), 503, "storage_unavailable")
            assert entrant_names(org, cup) == ["Ana", "Ben"]
            listed = ok_json(org.get(f"{cup.path}/entrants"), 200, "entrants")
            ids = [e["id"] for e in listed["entrants"]][::-1]
            seeding_version = tournament(org, cup)["seeding_version"]
            ok_json(org.put(f"{cup.path}/seeding", {"order": ids, "seeding_version": seeding_version}), 200,
                    "seeding works during the outage")
            relay = Relay(upstream, port=port)
            poll(lambda: org.upload(f"{cup.path}/roster", "v2.cupfold.txt", v2).status_code == 201,
                 "uploads succeed once storage returns, without a restart", HEALTH_STALE_S + POLL_SLACK_S)
            assert entrant_names(org, cup) == ["Cai", "Dov", "Eli"]
            assert S3().get(f"rosters/{cup.id}/{hashlib.sha256(v2).hexdigest()}.cupfold.txt") == v2
    finally:
        relay.stop()


STATE_CASES = ["draft", "checkin_open", "checkin_closed", "running", "finished"]
MOVE_REFUSALS = {
    "checkin/open": {"checkin_open": "Check-in is already open.",
                     "checkin_closed": "Check-in has already closed. Go back to draft to open it again.",
                     "running": STARTED, "finished": STARTED},
    "checkin/close": {"draft": "Check-in is not open.", "checkin_closed": "Check-in is not open.",
                      "running": STARTED, "finished": STARTED},
    "draft": {"draft": "The tournament is already a draft.", "running": STARTED, "finished": STARTED},
    "start": {"checkin_open": "Close check-in before starting.",
              "checkin_closed": "At least 2 checked-in entrants are needed to start.",
              "running": STARTED, "finished": STARTED},
}


@pytest.mark.parametrize("state", STATE_CASES, ids=STATE_CASES)
def test_lifecycle_refusals(app_url, state):
    now = server_now(app_url)
    closes = iso(now + timedelta(milliseconds=CHECKIN_AHEAD_MS))
    if state == "finished":
        cup = seed_cup(app_url, SE, n=2, state="finished", steps=[saved(rnd(1, 1), 2, 0)])
    elif state == "checkin_closed":
        cup = seed_cup(app_url, SE, n=4, state=state, checked_in={"Ana"}, closes_at=iso(now))
    elif state == "checkin_open":
        cup = seed_cup(app_url, SE, n=4, state=state, checked_in=set(), closes_at=closes)
    else:
        cup = seed_cup(app_url, SE, n=4, state=state)
    org = Api(app_url, cup.org)

    def wrong(r: httpx.Response, message: str) -> None:
        refused(r, 409, "wrong_state", message)

    for move, cells in MOVE_REFUSALS.items():
        if state in cells:
            wrong(org.post(f"{cup.path}/{move}", {"closes_at": closes} if move == "checkin/open" else None), cells[state])
    wrong(org.post(f"{cup.path}/rounds"), "Only Swiss tournaments have a next round.")
    wrong(org.get(f"{cup.path}/standings"), "Standings exist only for round robin and Swiss.")
    if state == "draft":
        wrong(org.put(f"/api/entrants/{cup.entrants['Ana']}/checkin", {"checked_in": True}), "Check-in is not open.")
        lone = seed_cup(app_url, SE, n=1, state="draft")
        wrong(Api(app_url, lone.org).post(f"{lone.path}/start"), "At least 2 entrants are needed to start.")
        swiss = seed_cup(app_url, SWISS, n=4, state="draft")
        wrong(Api(app_url, swiss.org).post(f"{swiss.path}/rounds"), NOT_RUNNING)
    elif state != "checkin_open":
        refused(Api(app_url, cup.users["Ana"]).post(f"{cup.path}/checkin"), 409, "checkin_closed", "Check-in is closed.")
    if state in ("running", "finished"):
        wrong(org.post(f"{cup.path}/entrants", {"name": "Ivo"}), STARTED)
        wrong(org.delete(cup.path), STARTED)
    if state == "finished":
        wrong(write(org, cup, rnd(1, 1), "result", 0, 2), FINISHED)
    assert tournament(org, cup)["state"] == state, "refused moves leave the state as it was"
    if state == "draft":
        assert ok_json(org.post(f"{cup.path}/checkin/open", {"closes_at": closes}), 200, "open")["tournament"]["state"] == "checkin_open"
    elif state == "checkin_open":
        assert ok_json(org.post(f"{cup.path}/checkin/close"), 200, "close")["tournament"]["state"] == "checkin_closed"
    elif state == "checkin_closed":
        t = ok_json(org.post(f"{cup.path}/draft"), 200, "back to draft")["tournament"]
        assert t["state"] == "draft" and t["checked_in_count"] == 0


def test_co_organizer_powers(app_url):
    cup = seed_cup(app_url, SE, n=4, state="draft", co=False)
    org, eve = Api(app_url, cup.org), Api(app_url, cup.co)
    url = f"{cup.path}/co-organizers"
    assert ok_json(org.post(url, {"username": cup.co}), 201, "add co-organizer")["co_organizers"] == [cup.co]
    b = refused(org.post(url, {"username": cup.co}), 422, "validation")
    assert b["fields"]["username"] == f"@{cup.co} is already a co-organizer."
    ghost = f"ghost_{fresh()}"
    assert refused(org.post(url, {"username": ghost}), 422, "validation")["fields"]["username"] == f"No account named @{ghost}."
    assert refused(org.post(url, {"username": cup.org}), 422, "validation")["fields"]["username"] == "You already organize this tournament."
    t = tournament(eve, cup)
    assert t["my_role"] == "co_organizer" and cup.co in t["co_organizers"] and t["share_url"]
    ok_json(eve.post(f"{cup.path}/checkin/open", {}), 200, "co-organizer opens check-in")
    ok_json(eve.post(f"{cup.path}/draft"), 200, "co-organizer returns to draft")
    refused(eve.post(url, {"username": cup.viewer}), 403, "forbidden", "Only the organizer can do this.")
    refused(eve.delete(f"{url}/{cup.co}"), 403, "forbidden", "Only the organizer can do this.")
    refused(eve.delete(cup.path), 403, "forbidden", "Only the organizer can do this.")
    assert tournament(org, cup)["co_organizers"] == [cup.co]
    assert org.delete(f"{url}/{cup.co}").status_code == 204
    refused(eve.get(cup.path), 404, "not_found")
    assert tournament(org, cup)["co_organizers"] == []


def preview_texts(page: Page) -> list[str]:
    items = page.get_by_role("list", name="Round 1 preview").get_by_role("listitem")
    return [t.strip() for t in items.all_text_contents()]


EIGHT_SLOTS = [(1, 8), (4, 5), (2, 7), (3, 6)]


def test_wf_seeding_keyboard_start_keyboard(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft")
    org = Api(app_url, cup.org)
    v0 = tournament(org, cup)["seeding_version"]
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        seeding = page.get_by_role("list", name="Seeding")
        ben = seeding.get_by_role("listitem", name=seat(2, "Ben"), exact=True)
        shown(page, ben, "2. Ben")
        ben.first.focus()
        page.keyboard.press("Alt+ArrowUp")
        moved = seeding.get_by_role("listitem", name=seat(1, "Ben"), exact=True)
        wait_until(page, lambda: is_focused(moved), "Ben moves to seed 1 with focus kept on his item")
        assert seeding.get_by_role("listitem", name=seat(2, "Ana"), exact=True).count() == 1
        reads(page, status(page, "Your action"), "Ben moved to seed 1", "Your action")
        wait_until(page, lambda: preview_texts(page) == ["Match 1: Ben vs Hal", "Match 2: Dov vs Eli",
                                                         "Match 3: Ana vs Gus", "Match 4: Cai vs Fen"],
                   "round 1 preview follows the move")
        wait_until(page, lambda: entrant_names(org, cup)[:2] == ["Ben", "Ana"], "order saved")
        assert tournament(org, cup)["seeding_version"] == v0 + 1
        page.keyboard.press("Alt+ArrowUp")
        advance(page, STEP_MS * 10)
        assert is_focused(moved) and tournament(org, cup)["seeding_version"] == v0 + 1, "no wrap at seed 1"
        page.keyboard.press("Alt+ArrowDown")
        back = seeding.get_by_role("listitem", name=seat(2, "Ben"), exact=True)
        wait_until(page, lambda: is_focused(back), "Alt+ArrowDown moves Ben back to seed 2")
        reads(page, status(page, "Your action"), "Ben moved to seed 2", "Your action")
        wait_until(page, lambda: entrant_names(org, cup)[:2] == ["Ana", "Ben"], "order saved again")


def test_seed_typed_dragged_and_stale(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft")
    org = Api(app_url, cup.org)
    v0 = tournament(org, cup)["seeding_version"]
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        puts: list[str] = []
        page.on("request", lambda req: puts.append(req.url) if req.method == "PUT" and "/seeding" in req.url else None)
        seeding = page.get_by_role("list", name="Seeding")
        sb = page.get_by_role("spinbutton", name="Seed for Hal")
        shown(page, sb, "Seed for Hal")
        fill(sb, "1")
        page.keyboard.press("Enter")
        present(page, seeding.get_by_role("listitem", name=seat(1, "Hal"), exact=True), "Hal at seed 1")
        wait_until(page, lambda: is_focused(page.get_by_role("spinbutton", name="Seed for Hal")), "focus on Hal's spinbutton")
        reads(page, status(page, "Your action"), "Hal moved to seed 1", "Your action")
        wait_until(page, lambda: preview_texts(page)[:1] == ["Match 1: Hal vs Gus"], "preview follows the typed seed")
        sent = len(puts)
        fill(page.get_by_role("spinbutton", name="Seed for Hal"), "9")
        page.keyboard.press("Enter")
        shown(page, page.get_by_text("Enter a seed from 1 to 8.", exact=True), "seed range error")
        assert len(puts) == sent, "an out-of-range seed sends no request"
        gus = seeding.get_by_role("listitem", name=seat(8, "Gus"), exact=True)
        gus.first.drag_to(seeding.get_by_role("listitem", name=seat(1, "Hal"), exact=True).first)
        wait_until(page, lambda: entrant_names(org, cup).index("Gus") < 7, "the drag moves Gus up and saves")
        order = entrant_names(org, cup)
        present(page, seeding.get_by_role("listitem", name=seat(order.index("Gus") + 1, "Gus"), exact=True), "Gus renumbered")
        expected = [f"Match {i}: {order[a - 1]} vs {order[b - 1]}" for i, (a, b) in enumerate(EIGHT_SLOTS, 1)]
        wait_until(page, lambda: preview_texts(page) == expected, "preview follows the drag")
    listed = ok_json(org.get(f"{cup.path}/entrants"), 200, "entrants")["entrants"]
    body = refused(org.put(f"{cup.path}/seeding", {"order": [e["id"] for e in listed][::-1], "seeding_version": v0}),
                   409, "stale_seeding", f"The seeding was changed by {cup.org}. The list now shows their order.")
    assert [e["name"] for e in body["entrants"]] == order == entrant_names(org, cup)


SIZE_CASES = ["three", "five", "six", "eight"]
SIZE_ROUND1 = {"three": [("Ana", "bye"), ("Ben", "Cai")],
               "five": [("Ana", "bye"), ("Dov", "Eli"), ("Ben", "bye"), ("Cai", "bye")],
               "six": [("Ana", "bye"), ("Dov", "Eli"), ("Ben", "bye"), ("Cai", "Fen")],
               "eight": [("Ana", "Hal"), ("Dov", "Eli"), ("Ben", "Gus"), ("Cai", "Fen")]}
SIZE_FIELDS = {"three": 3, "five": 5, "six": 6, "eight": 8}


@pytest.mark.parametrize("size", SIZE_CASES, ids=SIZE_CASES)
def test_bracket_seed_placement(app_url, size):
    cup = seed_cup(app_url, SE, n=SIZE_FIELDS[size], state="draft")
    org = Api(app_url, cup.org)
    expected = SIZE_ROUND1[size]
    preview = ok_json(org.get(f"{cup.path}/preview"), 200, "preview")["matches"]
    assert [(who(m["upper"]), who(m["lower"])) for m in sorted(preview, key=lambda m: m["number"])] == expected
    ok_json(org.post(f"{cup.path}/start"), 200, "start")
    ms = board(org, cup)
    for i, (upper, lower) in enumerate(expected, 1):
        m = ms[rnd(1, i)]
        assert (who(m["upper"]), who(m["lower"])) == (upper, lower)
        nxt = ms[rnd(2, (i + 1) // 2)]
        fed = nxt["upper"] if i % 2 else nxt["lower"]
        if lower == "bye":
            assert m["state"] == "bye" and who(fed) == upper, f"bye winner {upper} already placed in round 2"
        else:
            assert m["state"] == "pending" and fed is None


SIX_CARDS = ["Round 1, match 1: Ana vs bye", "Round 1, match 2: Dov vs Eli, not played",
             "Round 1, match 3: Ben vs bye", "Round 1, match 4: Cai vs Fen, not played",
             "Round 2, match 1: Ana vs to be decided", "Round 2, match 2: Ben vs to be decided",
             "Round 3, match 1: to be decided vs to be decided"]


def test_wf_seeding_keyboard_start_start(browser, app_url):
    cup = seed_cup(app_url, SE, n=6, state="draft")
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        click(page.get_by_role("button", name="Start tournament"))
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/bracket", "start lands on the bracket")
        for _ in range(2):
            for name in SIX_CARDS:
                present(page, card(page, name), name)
            bye = card(page, SIX_CARDS[0]).first
            assert bye.get_attribute("data-state") == "bye" and "Bye" in bye.inner_text()
            page.reload()
    assert tournament(Api(app_url, cup.org), cup)["state"] == "running"


def _check_cards(page: Page, api: Api, cup: Cup, expected: list[tuple[str, str, str, str]]) -> None:
    ms = board(api, cup)
    for label, name, state, word in expected:
        c = card(page, name)
        present(page, c, name)
        el = c.first
        m = ms[label]
        assert el.get_attribute("data-match-id") == m["id"]
        assert el.get_attribute("data-state") == state == m["state"], f"{name}: data-state"
        assert el.get_attribute("data-round") == str(m["round"]) and el.get_attribute("data-match") == str(m["number"])
        assert el.get_attribute("data-bracket") == m["bracket"]
        assert word in el.inner_text(), f"{name} shows the status word {word!r}"


def test_card_names_every_state(browser, app_url):
    se = seed_cup(app_url, SE, n=8, steps=[rep(rnd(1, 4), 2, 1, "Cai"), saved(rnd(1, 1), 2, 1),
                                          dis(rnd(1, 2), 2, 0, "Dov", 0, 2), res(rnd(1, 2), 2, 0),
                                          called(rnd(2, 1)), dis(rnd(1, 3), 2, 0, "Ben", 0, 2)])
    with screen(browser, app_url, f"/t/{se.id}/bracket", se.users["Ana"]) as page:
        _check_cards(page, Api(app_url, se.users["Ana"]), se, [
            (rnd(1, 4), "Round 1, match 4: Cai vs Fen, 2-1 reported by Cai, awaiting Fen", "reported", "Awaiting confirmation"),
            (rnd(1, 1), "Round 1, match 1: Ana vs Hal, 2-1, Ana wins", "confirmed", "Confirmed"),
            (rnd(1, 2), "Round 1, match 2: Dov vs Eli, 2-0, Dov wins", "resolved", "Resolved"),
            (rnd(1, 3), "Round 1, match 3: Ben vs Gus, disputed", "disputed", "Disputed"),
            (rnd(2, 1), "Round 2, match 1: Ana vs Dov, called", "called", "Called"),
            (rnd(2, 2), "Round 2, match 2: to be decided vs to be decided", "pending", "Pending"),
            (rnd(3, 1), "Round 3, match 1: to be decided vs to be decided", "pending", "Pending")])
    de = seed_cup(app_url, DE, n=5)
    with screen(browser, app_url, f"/t/{de.id}/bracket", de.users["Ana"]) as page:
        _check_cards(page, Api(app_url, de.users["Ana"]), de, [
            (win(1, 1), "Winners round 1, match 1: Ana vs bye", "bye", "Bye"),
            (win(1, 2), "Winners round 1, match 2: Dov vs Eli, not played", "pending", "Pending"),
            (los(1, 2), "Losers round 1, match 2: not needed", "not_needed", "Not needed"),
            (GFR, "Grand final reset: waiting for grand final", "waiting", "Waiting")])
    rr = seed_cup(app_url, RR, n=4, steps=[saved(rnd(1, 1), 1, 1)])
    with screen(browser, app_url, f"/t/{rr.id}/bracket", rr.users["Ana"]) as page:
        _check_cards(page, Api(app_url, rr.users["Ana"]), rr, [
            (rnd(1, 1), "Round 1, match 1: Ana vs Dov, 1-1, draw", "confirmed", "Confirmed")])


def _tab_stops(region: Locator) -> list[str]:
    return region.get_by_role("button").evaluate_all(
        "els => els.filter(e => e.hasAttribute('data-match-id') && e.tabIndex >= 0).map(e => e.getAttribute('data-match-id'))")


def test_bracket_regions_tab_stops(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_W1)
    ms = board(Api(app_url, cup.org), cup)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        for size in (DESK, TABLET):
            page.set_viewport_size(size)
            regions = [page.get_by_role("region", name=n) for n in ("Winners bracket", "Losers bracket", "Grand final")]
            for r in regions:
                shown(page, r, "bracket region")
            ys = [box(r)["y"] for r in regions]
            assert ys[0] < ys[1] < ys[2], f"winners, losers, grand final stacked top to bottom at {size}"
            wait_until(page, lambda: _tab_stops(regions[0]) == [ms[win(2, 1)]["id"]], "winners tab stop is W2 m1")
            assert _tab_stops(regions[1]) == [ms[los(1, 1)]["id"]], "losers tab stop is L1 m1"
            assert len(_tab_stops(regions[2])) == 1
        winners = page.get_by_role("region", name="Winners bracket")
        card(page, "Winners round 2, match 1: Ana vs Dov, not played").first.focus()
        page.keyboard.press("Tab")
        advance(page, STEP_MS)
        assert not focus_in(winners), "Tab leaves the region after its one stop"
        second = card(page, "Winners round 2, match 2: Ben vs Cai, not played")
        second.first.focus()
        page.keyboard.press("Tab")
        page.keyboard.press("Shift+Tab")
        wait_until(page, lambda: active_match(page) == ms[win(2, 2)]["id"], "Shift+Tab returns to the last focused card")


def test_wf_bracket_keyboard_scoring_arrows(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_W1)
    org = Api(app_url, cup.org)
    ids = {label: m["id"] for label, m in board(org, cup).items()}
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        def go(key: str, label: str) -> None:
            page.keyboard.press(key)
            wait_until(page, lambda: active_match(page) == ids[label], f"{key} moves focus to {label}")

        def stay(key: str, label: str) -> None:
            page.keyboard.press(key)
            advance(page, STEP_MS * 4)
            assert active_match(page) == ids[label], f"{key} on {label} does nothing"

        start = card(page, "Winners round 1, match 1: Ana vs Hal, 2-0, Ana wins")
        shown(page, start, "W1 m1")
        start.first.focus()
        go("ArrowRight", win(2, 1)); go("ArrowLeft", win(1, 1)); go("ArrowDown", win(1, 2))
        go("ArrowDown", win(1, 3)); go("ArrowUp", win(1, 2)); go("ArrowRight", win(2, 1))
        go("ArrowDown", win(2, 2)); go("ArrowLeft", win(1, 3)); go("End", win(3, 1))
        stay("ArrowRight", win(3, 1)); go("Home", win(1, 1)); stay("ArrowUp", win(1, 1))
        card(page, "Losers round 1, match 2: Gus vs Fen, not played").first.focus()
        go("ArrowRight", los(2, 2)); go("ArrowLeft", los(1, 2)); go("ArrowRight", los(2, 2))
        go("ArrowUp", los(2, 1)); go("ArrowRight", los(3, 1)); go("ArrowLeft", los(2, 1))
        go("End", los(4, 1)); go("Home", los(1, 1))
        card(page, "Grand final: to be decided vs to be decided").first.focus()
        go("ArrowRight", GFR); stay("ArrowDown", GFR); go("ArrowLeft", GF); go("End", GFR); go("Home", GF)
        target = card(page, "Winners round 2, match 1: Ana vs Dov, not played")
        target.first.focus()
        whole = page.get_by_role("button", name="Whole bracket")
        page.keyboard.press("z")
        wait_until(page, lambda: whole.first.get_attribute("aria-pressed") == "true", "Z turns on the whole bracket")
        page.keyboard.press("z")
        wait_until(page, lambda: whole.first.get_attribute("aria-pressed") == "false", "Z turns it off")
        target.first.focus()
        dlg = page.get_by_role("dialog", name="Report score")
        page.keyboard.press("Enter")
        shown(page, dlg, "Enter opens Report score for the organizer")
        page.keyboard.press("Escape")
        wait_until(page, lambda: dlg.count() == 0 or not dlg.first.is_visible(), "Escape closes")
        wait_until(page, lambda: active_match(page) == ids[win(2, 1)], "focus returns to the card")
        page.keyboard.press(" ")
        shown(page, dlg, "Space opens Report score")
        click(dlg.get_by_role("button", name="Cancel"))
        wait_until(page, lambda: active_match(page) == ids[win(2, 1)], "Cancel returns focus to the card")
    assert board(org, cup)[win(2, 1)]["state"] == "pending"


def test_wf_bracket_keyboard_scoring_report(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    ana = Api(app_url, cup.users["Ana"])
    mid = cup.matches[rnd(1, 1)]
    v0 = board(ana, cup)[rnd(1, 1)]["version"]
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Ana"]) as page:
        c = card(page, "Round 1, match 1: Ana vs Hal, not played")
        shown(page, c, "Ana's card")
        c.first.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Report score")
        shown(page, dlg, 'dialog "Report score"')
        first = dlg.get_by_role("spinbutton", name=games("Ana"))
        first.first.focus()
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            assert focus_in(dlg), "Tab stays inside the dialog"
        first.first.focus()
        page.keyboard.press("Shift+Tab")
        assert focus_in(dlg) and not is_focused(first), "Shift+Tab on the first control wraps to the last"
        page.keyboard.press("Escape")
        wait_until(page, lambda: dlg.count() == 0 or not dlg.first.is_visible(), "Escape closes the dialog")
        wait_until(page, lambda: active_match(page) == mid, "focus back on the card")
        assert board(ana, cup)[rnd(1, 1)]["version"] == v0
        page.keyboard.press("Enter")
        shown(page, dlg, "dialog reopened")

        def type_games(u: str, l: str) -> None:
            for name, v in ((games("Ana"), u), (games("Hal"), l)):
                dlg.get_by_role("spinbutton", name=name).first.focus()
                page.keyboard.press("Control+a")
                page.keyboard.type(v)

        type_games("1", "1")
        dlg.get_by_role("button", name="Submit score").first.focus()
        page.keyboard.press("Enter")
        reads(page, dlg.get_by_role("status", name="Dialog status"), NEED_WINNER, "draw refused")
        wait_until(page, lambda: is_focused(first), "a refused write focuses the first spinbutton")
        assert board(ana, cup)[rnd(1, 1)]["state"] == "pending"
        type_games("2", "1")
        submit = dlg.get_by_role("button", name="Submit score")
        with _ctx(held(page, "**/api/matches/*/report")) as gate:
            submit.first.focus()
            page.keyboard.press("Enter")
            reads(page, dlg.get_by_role("status", name="Dialog status"), "Saving...", "pending text")
            assert submit.first.is_disabled(), "the submit button is disabled while in flight"
            gate.release()
        wait_until(page, lambda: dlg.count() == 0 or not dlg.first.is_visible(), "dialog closes after submit")
        wait_until(page, lambda: active_match(page) == mid, "focus returns to the card after the save")
        present(page, card(page, "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal"), "reported card")
        reads(page, status(page, "Your action"), "Score reported, awaiting Hal", "Your action")
    m = board(ana, cup)[rnd(1, 1)]
    assert m["state"] == "reported" and m["report"]["by"] == "Ana"


def test_who_may_report(app_url):
    cup = seed_cup(app_url, SE, n=8)
    viewer, gus, ana, hal, dov = (Api(app_url, u) for u in
                                  (cup.viewer, cup.users["Gus"], cup.users["Ana"], cup.users["Hal"], cup.users["Dov"]))
    org = Api(app_url, cup.org)
    msg = "Only the two players in this match or an organizer can report it."
    refused(write(viewer, cup, rnd(1, 1), "report", 2, 1), 403, "forbidden", msg)
    refused(write(gus, cup, rnd(1, 1), "report", 2, 1), 403, "forbidden", msg)
    assert ok_json(write(ana, cup, rnd(1, 1), "report", 2, 1), 200, "report")["outcome"] == "reported"
    v = board(org, cup)[rnd(1, 1)]["version"]
    refused(write(ana, cup, rnd(1, 1), "confirm"), 403, "forbidden", "You cannot confirm your own report.")
    refused(write(ana, cup, rnd(1, 1), "report", 2, 0), 409, "wrong_state", "You already reported this match.")
    refused(write(hal, cup, rnd(1, 1), "dispute", 2, 1), 422, "validation", "Change the score to dispute it.")
    refused(write(hal, cup, rnd(1, 1), "resolve", 2, 1), 403, "forbidden", "Only organizers can resolve disputes.")
    assert board(org, cup)[rnd(1, 1)]["version"] == v and board(org, cup)[rnd(1, 1)]["state"] == "reported"
    refused(write(dov, cup, rnd(1, 2), "confirm"), 409, "wrong_state", "There is no report to answer.")
    refused(write(org, cup, rnd(1, 2), "resolve", 2, 0), 409, "wrong_state", "There is no open dispute.")
    refused(write(org, cup, rnd(2, 1), "report", 2, 0), 409, "wrong_state", "This match is not ready to play.")
    refused(write(dov, cup, rnd(1, 2), "report", 0, 0), 422, "validation", "A score needs at least one game.")
    b = refused(write(dov, cup, rnd(1, 2), "report", 100, 0), 422, "validation")
    assert b["fields"]["upper_games"] == "Enter a whole number from 0 to 99."
    assert board(org, cup)[rnd(1, 2)]["state"] == "pending"


def test_wf_report_confirm_dispute_dispute(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, \
            screen(browser, app_url, path, cup.users["Hal"]) as hal, \
            screen(browser, app_url, path, cup.org) as org:
        present(hal, card(hal, "Round 1, match 1: Ana vs Hal, not played"), "Hal's card before the report")
        dlg = report_dialog(ana, "Round 1, match 1: Ana vs Hal, not played", "Ana", "Hal", 2, 1, "Submit score")
        wait_until(ana, lambda: dlg.count() == 0 or not dlg.first.is_visible(), "Ana's dialog closes")
        waiting = card(hal, "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal")
        present(hal, waiting, "Hal's card waits on him, live")
        click(waiting.first)
        conf = hal.get_by_role("dialog", name="Confirm score")
        shown(hal, conf, 'dialog "Confirm score"')
        reported = named("<reporter> reported <u>-<l>", {"reporter": "Ana", "u": "2", "l": "1"})
        shown(hal, conf.get_by_text(reported, exact=True), "the report text")
        assert conf.get_by_role("spinbutton", name=games("Ana")).first.input_value() == "2"
        fill(conf.get_by_role("spinbutton", name=games("Ana")), "1")
        fill(conf.get_by_role("spinbutton", name=games("Hal")), "2")
        click(conf.get_by_role("button", name="Dispute score"))
        reads(hal, status(hal, "Your action"), "Score disputed", "Hal's Your action")
        disputed = card(org, "Round 1, match 1: Ana vs Hal, disputed")
        present(org, disputed, "organizer sees the dispute live")
        assert disputed.first.get_attribute("data-state") == "disputed"
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert m["state"] == "disputed" and m["report"]["by"] == "Ana" and m["dispute"]["by"] == "Hal"
    assert (m["dispute"]["upper_games"], m["dispute"]["lower_games"]) == (1, 2)


def test_wf_report_confirm_dispute_confirm(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Hal"]) as hal:
        present(ana, card(ana, "Round 1, match 1: Ana vs Hal, not played"), "Ana's card")
        ok_json(write(Api(app_url, cup.users["Ana"]), cup, rnd(1, 1), "report", 2, 1), 200, "report")
        waiting = card(hal, "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal")
        present(hal, waiting, "reported card on Hal's screen")
        click(waiting.first)
        conf = hal.get_by_role("dialog", name="Confirm score")
        shown(hal, conf, 'dialog "Confirm score"')
        click(conf.get_by_role("button", name="Confirm score"))
        reads(hal, status(hal, "Your action"), "Score confirmed", "Hal's Your action")
        wait_until(hal, lambda: active_match(hal) == cup.matches[rnd(1, 1)], "focus returns to the card")
        done = "Round 1, match 1: Ana vs Hal, 2-1, Ana wins"
        for page in (ana, hal):
            present(page, card(page, done), "confirmed card")
            reads(page, status(page, "Bracket announcements"), "Ana advances to round 2", "announcement")
    assert board(Api(app_url, cup.org), cup)[rnd(1, 1)]["state"] == "confirmed"


def test_wf_report_confirm_dispute_resolve(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[dis(rnd(1, 1), 2, 0, "Ana", 0, 2)])
    mid = cup.matches[rnd(1, 1)]
    refused(Api(app_url, cup.users["Hal"]).get(f"{cup.path}/disputes"), 403, "forbidden")
    with screen(browser, app_url, f"/t/{cup.id}/disputes", cup.org) as page:
        resolve_name = named("Resolve <card label>", {"card label": rnd(1, 1)})
        button = page.get_by_role("list", name="Open disputes").get_by_role("button", name=resolve_name, exact=True)
        shown(page, button, "the resolve button of the disputed card")
        click(button.first)
        dlg = page.get_by_role("dialog", name="Resolve dispute")
        shown(page, dlg, 'dialog "Resolve dispute"')
        says = "<name> says <u>-<l>"
        shown(page, dlg.get_by_text(named(says, {"name": "Ana", "u": "2", "l": "0"}), exact=True), "Ana's claim")
        shown(page, dlg.get_by_text(named(says, {"name": "Hal", "u": "0", "l": "2"}), exact=True), "Hal's claim")
        fill(dlg.get_by_role("spinbutton", name=games("Ana")), "2")
        fill(dlg.get_by_role("spinbutton", name=games("Hal")), "1")
        click(dlg.get_by_role("button", name="Resolve"))
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/bracket"
                   and parse_qs(urlsplit(page.url).query).get("match") == [mid], "resolve lands on bracket?match=<id>")
        wait_until(page, lambda: active_match(page) == mid, "the resolved card has focus")
        present(page, card(page, "Round 1, match 1: Ana vs Hal, 2-1, Ana wins"), "resolved card")
        page.goto(app_url + f"/t/{cup.id}/disputes")
        shown(page, page.get_by_text("No open disputes.", exact=True), "empty disputes")
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert m["state"] == "resolved" and (m["upper_games"], m["lower_games"], m["winner"]) == (2, 1, "upper")


def test_auto_confirm_on_server_time(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, steps=[rep(rnd(1, 1), 2, 1, "Ana")])
    window = config(app_url)["confirm_window_ms"]
    org = Api(app_url, cup.org)
    name = "Round 1, match 1: Ana vs Dov, 2-1 reported by Ana, awaiting Dov"

    def countdown(page: Page) -> int | None:
        found = re.search(r"Auto-confirms in (\d+):(\d{2})", card(page, name).first.inner_text())
        return int(found.group(1)) * 60 + int(found.group(2)) if found else None

    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Dov"]) as page:
        move_clock(app_url, window // 4)
        assert board(org, cup)[rnd(1, 1)]["state"] == "reported", "not confirmed before the window passes"
        page.clock.set_system_time(server_now(app_url) + DEVICE_SKEW)
        for _ in range(2):
            page.reload()
            present(page, card(page, name), "reported card")
            wait_until(page, lambda: countdown(page) is not None, "countdown on the card")
            secs = countdown(page)
            assert 1 <= secs <= -(-(window - window // 4) // 1000), f"countdown {secs}s follows server time, not the device clock"
        move_clock(app_url, window)
        present(page, card(page, "Round 1, match 1: Ana vs Dov, 2-1, Ana wins"), "auto-confirmed card, live")
    m = board(org, cup)[rnd(1, 1)]
    assert m["state"] == "confirmed" and m["updated_by"] == "system"


def test_overdue_flag(browser, app_url):
    cfg = config(app_url)
    cup = seed_cup(app_url, SE, n=4, steps=[called(rnd(1, 1))])
    org, ana = Api(app_url, cup.org), Api(app_url, cup.users["Ana"])
    m0 = board(org, cup)[rnd(1, 1)]
    assert m0["overdue"] is False
    move_clock(app_url, cfg["match_limit_ms"] + CLOCK_MARGIN_MS)
    m1 = board(org, cup)[rnd(1, 1)]
    assert m1["overdue"] is True and m1["version"] == m0["version"] and m1["updated_by"] == m0["updated_by"]
    seen = board(ana, cup)[rnd(1, 1)]
    assert "overdue" not in seen and "updated_by" not in seen
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        page.clock.set_system_time(server_now(app_url) - DEVICE_SKEW)
        page.reload()
        c = card(page, "Round 1, match 1: Ana vs Dov, called, overdue")
        present(page, c, "organizer card flagged overdue")
        assert "Overdue" in c.first.inner_text()
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Ana"]) as page:
        c = card(page, "Round 1, match 1: Ana vs Dov, called")
        present(page, c, "player card without overdue")
        assert "Overdue" not in c.first.inner_text()
    ok_json(write(ana, cup, rnd(1, 1), "report", 2, 0), 200, "report")
    assert board(org, cup)[rnd(1, 1)]["overdue"] is False, "reporting clears overdue"
    swiss = seed_cup(app_url, SWISS, n=4)
    sorg = Api(app_url, swiss.org)
    assert board(sorg, swiss)[rnd(1, 1)]["overdue"] is False
    move_clock(app_url, cfg["swiss_round_ms"] + CLOCK_MARGIN_MS)
    assert all(board(sorg, swiss)[rnd(1, m)]["overdue"] for m in (1, 2))
    with screen(browser, app_url, f"/t/{swiss.id}/bracket", swiss.org) as page:
        present(page, card(page, "Round 1, match 1: Ana vs Cai, not played, overdue"), "Swiss overdue card")


def test_wf_coorganizer_conflict_stale_save(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    name = "Round 1, match 1: Ana vs Hal, not played"
    with screen(browser, app_url, path, cup.org) as dana, screen(browser, app_url, path, cup.co) as eve:
        dialogs = {}
        for page in (dana, eve):
            c = card(page, name)
            shown(page, c, "the shared match")
            click(c.first)
            dialogs[page] = page.get_by_role("dialog", name="Report score")
            shown(page, dialogs[page], "Report score")
        e_dlg, d_dlg = dialogs[eve], dialogs[dana]
        fill(e_dlg.get_by_role("spinbutton", name=games("Ana")), "2")
        fill(e_dlg.get_by_role("spinbutton", name=games("Hal")), "1")
        with _ctx(held(eve, "**/api/matches/**")) as gate:
            click(e_dlg.get_by_role("button", name="Save result"))
            reads(eve, e_dlg.get_by_role("status", name="Dialog status"), "Saving...", "eve's pending save")
            fill(d_dlg.get_by_role("spinbutton", name=games("Ana")), "2")
            fill(d_dlg.get_by_role("spinbutton", name=games("Hal")), "0")
            click(d_dlg.get_by_role("button", name="Save result"))
            reads(dana, status(dana, "Your action"), "Result saved", "dana's Your action")
            gate.release()
        reads(eve, e_dlg.get_by_role("status", name="Dialog status"),
              f"This match was updated by {cup.org}. Current score: 2-0.", "eve's refusal")
        assert e_dlg.first.is_visible(), "the refused dialog stays open"
        wait_until(eve, lambda: is_focused(e_dlg.get_by_role("spinbutton", name=games("Ana"))), "focus on first spinbutton")
        for page in (dana, eve):
            present(page, card(page, "Round 1, match 1: Ana vs Hal, 2-0, Ana wins"), "same result on both screens")
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert (m["upper_games"], m["lower_games"], m["state"]) == (2, 0, "confirmed")
    stale = refused(Api(app_url, cup.co).post(f"/api/matches/{m['id']}/result",
                                              {"upper_games": 2, "lower_games": 1, "version": m["version"] - 1}),
                    409, "stale_match", f"This match was updated by {cup.org}. Current score: 2-0.")
    assert stale["match"]["id"] == m["id"]


def test_conflicting_reports_one_dispute(app_url):
    cup = seed_cup(app_url, SE, n=8)
    org = Api(app_url, cup.org)
    cases = [(rnd(1, 1), "Ana", "Hal", (1, 2)), (rnd(1, 2), "Dov", "Eli", (1, 2)),
             (rnd(1, 3), "Ben", "Gus", (1, 2)), (rnd(1, 4), "Cai", "Fen", (2, 1))]
    for label, up, low, low_claim in cases:
        m = board(org, cup)[label]
        a, b = Api(app_url, cup.users[up]), Api(app_url, cup.users[low])
        url = f"/api/matches/{m['id']}/report"
        with ThreadPoolExecutor(2) as ex:
            fa = ex.submit(a.post, url, {"upper_games": 2, "lower_games": 1, "version": m["version"]})
            fb = ex.submit(b.post, url, {"upper_games": low_claim[0], "lower_games": low_claim[1], "version": m["version"]})
        outcomes = sorted(ok_json(f.result(), 200, f"{label} report")["outcome"] for f in (fa, fb))
        after = board(org, cup)[label]
        if low_claim == (2, 1):
            assert outcomes == ["confirmed", "reported"] and after["state"] == "confirmed" and after["winner"] == "upper"
        else:
            assert outcomes == ["disputed", "reported"]
            assert after["state"] == "disputed" and after["winner"] is None
            claims = {after["report"]["by"]: (after["report"]["upper_games"], after["report"]["lower_games"]),
                      after["dispute"]["by"]: (after["dispute"]["upper_games"], after["dispute"]["lower_games"])}
            assert claims == {up: (2, 1), low: low_claim}
    ms = board(org, cup)
    assert ms[rnd(2, 1)]["upper"] is None and ms[rnd(2, 1)]["lower"] is None and who(ms[rnd(2, 2)]["lower"]) == "Cai"


def test_one_resolution_per_dispute(app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[dis(rnd(1, m), 2, 0, n, 0, 2) for m, n in ((1, "Ana"), (2, "Dov"), (3, "Ben"))])
    dana, eve = Api(app_url, cup.org), Api(app_url, cup.co)
    for m in (1, 2, 3):
        match = board(dana, cup)[rnd(1, m)]
        url = f"/api/matches/{match['id']}/resolve"
        with ThreadPoolExecutor(2) as ex:
            fd = ex.submit(dana.post, url, {"upper_games": 2, "lower_games": 0, "version": match["version"]})
            fe = ex.submit(eve.post, url, {"upper_games": 0, "lower_games": 2, "version": match["version"]})
        results = {cup.org: (fd.result(), "2-0"), cup.co: (fe.result(), "0-2")}
        winners = [u for u, (r, _) in results.items() if r.status_code == 200]
        assert len(winners) == 1, f"exactly one resolution stands: {[r.status_code for r, _ in results.values()]}"
        loser = cup.co if winners[0] == cup.org else cup.org
        body = refused(results[loser][0], 409, "already_resolved",
                       f"This dispute was already resolved by {winners[0]}. Result: {results[winners[0]][1]}.")
        assert body["match"]["state"] == "resolved"
        final = board(dana, cup)[rnd(1, m)]
        assert f"{final['upper_games']}-{final['lower_games']}" == results[winners[0]][1]


def test_wf_coorganizer_conflict_double_resolve(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[dis(rnd(1, 1), 2, 0, "Ana", 0, 2)])
    with screen(browser, app_url, f"/t/{cup.id}/disputes", cup.org) as dana, \
            screen(browser, app_url, f"/t/{cup.id}/bracket", cup.co) as eve:
        c = card(eve, "Round 1, match 1: Ana vs Hal, disputed")
        shown(eve, c, "disputed card")
        click(c.first)
        e_dlg = eve.get_by_role("dialog", name="Resolve dispute")
        shown(eve, e_dlg, "eve's Resolve dispute")
        b = dana.get_by_role("button", name=named("Resolve <card label>", {"card label": rnd(1, 1)}), exact=True)
        shown(dana, b, "dana's resolve button")
        click(b.first)
        d_dlg = dana.get_by_role("dialog", name="Resolve dispute")
        shown(dana, d_dlg, "dana's Resolve dispute")
        fill(e_dlg.get_by_role("spinbutton", name=games("Ana")), "0")
        fill(e_dlg.get_by_role("spinbutton", name=games("Hal")), "2")
        with _ctx(held(eve, "**/api/matches/**")) as gate:
            click(e_dlg.get_by_role("button", name="Resolve"))
            fill(d_dlg.get_by_role("spinbutton", name=games("Ana")), "2")
            fill(d_dlg.get_by_role("spinbutton", name=games("Hal")), "1")
            click(d_dlg.get_by_role("button", name="Resolve"))
            wait_until(dana, lambda: urlsplit(dana.url).path == f"/t/{cup.id}/bracket", "dana lands on the bracket")
            gate.release()
        reads(eve, e_dlg.get_by_role("status", name="Dialog status"),
              f"This dispute was already resolved by {cup.org}. Result: 2-1.", "eve is told who resolved it")
        assert e_dlg.first.is_visible()
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert (m["state"], m["upper_games"], m["lower_games"]) == ("resolved", 2, 1)


def test_edit_preview_dependent_set(app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    org = Api(app_url, cup.org)
    before = board(org, cup)
    m = before[rnd(1, 1)]
    url = f"/api/matches/{m['id']}/edit-preview"
    p = ok_json(org.post(url, {"upper_games": 0, "lower_games": 2, "version": m["version"]}), 200, "preview")
    assert [(d["label"], d["state"]) for d in p["dependents"]] == [(rnd(2, 1), "confirmed"), (rnd(3, 1), "pending")]
    assert [d["match_id"] for d in p["dependents"]] == [cup.matches[rnd(2, 1)], cup.matches[rnd(3, 1)]]
    assert p["count"] == 2 and p["confirmed_count"] == 1 and p["preview_token"]
    same = ok_json(org.post(url, {"upper_games": 2, "lower_games": 1, "version": m["version"]}), 200, "same winner")
    assert same["dependents"] == [] and same["count"] == 0 and same["confirmed_count"] == 0
    refused(org.post(url, {"upper_games": 0, "lower_games": 0, "version": m["version"]}), 422, "validation",
            "A score needs at least one game.")
    refused(org.post(url, {"upper_games": 1, "lower_games": 1, "version": m["version"]}), 422, "validation", NEED_WINNER)
    r3 = before[rnd(3, 1)]
    refused(org.post(f"/api/matches/{r3['id']}/edit-preview", {"upper_games": 2, "lower_games": 0, "version": r3["version"]}),
            409, "wrong_state", "Only confirmed or resolved results can be edited.")
    refused(Api(app_url, cup.users["Ana"]).post(url, {"upper_games": 0, "lower_games": 2, "version": m["version"]}),
            403, "forbidden")
    assert board(org, cup) == before, "previews change nothing"
    de = seed_cup(app_url, DE, n=8, steps=DE_W1)
    dorg = Api(app_url, de.org)
    w = board(dorg, de)[win(1, 1)]
    dp = ok_json(dorg.post(f"/api/matches/{w['id']}/edit-preview", {"upper_games": 0, "lower_games": 2,
                                                                      "version": w["version"]}), 200, "DE preview")
    assert [d["label"] for d in dp["dependents"]] == [win(2, 1), los(1, 1)], "winners before losers at one distance"
    assert dp["count"] == 2 and dp["confirmed_count"] == 0


def test_wf_shutter_trace_edit_commit(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    org = Api(app_url, cup.org)
    before = board(org, cup)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        c = card(page, EDIT_CARD)
        shown(page, c, "confirmed card")
        c.first.focus()
        page.keyboard.press("Enter")
        details = page.get_by_role("dialog", name="Match details")
        shown(page, details, "Match details")
        details.get_by_role("button", name="Edit result").first.focus()
        page.keyboard.press("Enter")
        edit = page.get_by_role("dialog", name="Edit result")
        shown(page, edit, "Edit result")
        assert edit.get_by_role("spinbutton", name=games("Ana")).first.input_value() == "2"
        assert edit.get_by_role("spinbutton", name=games("Hal")).first.input_value() == "0"
        fill(edit.get_by_role("spinbutton", name=games("Ana")), "0")
        fill(edit.get_by_role("spinbutton", name=games("Hal")), "2")
        edit.get_by_role("button", name="Review edit").first.focus()
        page.keyboard.press("Enter")
        reads(page, edit.get_by_role("status", name="Reset count"), "2 matches will reset, 1 of them confirmed", "reset count")
        items = edit.get_by_role("list", name="Matches that will reset").get_by_role("listitem")
        wait_until(page, lambda: items.count() == 2, "two matches listed")
        assert rnd(2, 1) in items.nth(0).inner_text() and rnd(3, 1) in items.nth(1).inner_text(), "listed in reset order"
        confirm = edit.get_by_role("button", name="Confirm edit")
        shown(page, confirm, "Confirm edit")
        confirm.first.focus()
        page.keyboard.press("Enter")
        wait_until(page, lambda: details.count() == 0 or not details.first.is_visible(), "both dialogs close")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 1)], "focus on the edited card")
        present(page, card(page, "Round 1, match 1: Ana vs Hal, 0-2, Hal wins"), "edited card")
        present(page, card(page, "Round 2, match 1: Hal vs Dov, not played"), "reset card with the new winner")
        reads(page, status(page, "Your action"), "Result edited", "Your action")
        reads(page, status(page, "Bracket announcements"), "2 matches reset", "announcement")
    after = board(org, cup)
    r2, r3 = after[rnd(2, 1)], after[rnd(3, 1)]
    assert r2["state"] == "pending" and (who(r2["upper"]), who(r2["lower"])) == ("Hal", "Dov") and r2["report"] is None
    assert r3["state"] == "pending" and r3["upper"] is None and who(r3["lower"]) == "Ben"
    assert r2["version"] > before[rnd(2, 1)]["version"] and r3["version"] > before[rnd(3, 1)]["version"]
    for label in (rnd(1, 2), rnd(1, 3), rnd(1, 4), rnd(2, 2)):
        assert after[label] == before[label], f"{label} is outside the set and unchanged"


def test_wf_shutter_trace_edit_cancel(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    org = Api(app_url, cup.org)
    before = board(org, cup)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        details, edit = open_edit(page, 0, 2)
        click(edit.get_by_role("button", name="Review edit"))
        confirm = edit.get_by_role("button", name="Confirm edit")
        shown(page, confirm, "Confirm edit after review")
        fill(edit.get_by_role("spinbutton", name=games("Hal")), "1")
        wait_until(page, lambda: confirm.count() == 0 or not confirm.first.is_visible(), "a score change hides Confirm edit")
        page.keyboard.press("Escape")
        wait_until(page, lambda: edit.count() == 0 or not edit.first.is_visible(), "Escape closes Edit result")
        wait_until(page, lambda: is_focused(details.get_by_role("button", name="Edit result")), "focus on Edit result")
        click(details.get_by_role("button", name="Edit result"))
        shown(page, edit, "Edit result again")
        click(edit.get_by_role("button", name="Cancel"))
        wait_until(page, lambda: is_focused(details.get_by_role("button", name="Edit result")), "Cancel focuses Edit result")
        page.keyboard.press("Escape")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 1)], "second Escape returns to the card")
    assert board(org, cup) == before, "cancelling leaves the server unchanged"


def test_stale_preview_refused(app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    org = Api(app_url, cup.org)
    m = board(org, cup)[rnd(1, 1)]
    p = ok_json(org.post(f"/api/matches/{m['id']}/edit-preview", {"upper_games": 0, "lower_games": 2,
                                                                    "version": m["version"]}), 200, "preview")
    ok_json(write(Api(app_url, cup.users["Ana"]), cup, rnd(3, 1), "report", 2, 1), 200, "a dependent changes")
    before = board(org, cup)
    refused(org.post(f"/api/matches/{m['id']}/edit", {"upper_games": 0, "lower_games": 2, "preview_token": p["preview_token"]}),
            409, "stale_preview", "The bracket changed since this preview. Review the edit again.")
    assert board(org, cup) == before, "a stale commit changes nothing"
    p2 = ok_json(org.post(f"/api/matches/{m['id']}/edit-preview", {"upper_games": 0, "lower_games": 2,
                                                                     "version": m["version"]}), 200, "re-preview")
    e = ok_json(org.post(f"/api/matches/{m['id']}/edit", {"upper_games": 0, "lower_games": 2,
                                                          "preview_token": p2["preview_token"]}), 200, "commit")
    assert e["reset"] == [d["match_id"] for d in p2["dependents"]] and e["match"]["winner"] == "lower"


def test_shutter_trace_motion(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        _, edit = open_edit(page, 0, 2)
        cards = {"r2": card(page, R2M1_DONE), "r3": card(page, R3M1_OPEN)}
        items = edit.get_by_role("list", name="Matches that will reset").get_by_role("listitem")
        with page.expect_response(lambda r: "/edit-preview" in r.url):
            click(edit.get_by_role("button", name="Review edit"))
        reached: dict[str, int] = {}
        counts: list[int] = []
        elapsed = 0
        for _ in range(TRACE_BUDGET_MS // TRACE_STEP_MS + 1):
            for key, c in cards.items():
                if key not in reached and c.first.get_attribute("data-shutter") == "half":
                    reached[key] = elapsed
            counts.append(items.count())
            if len(reached) == 2:
                break
            advance(page, TRACE_STEP_MS)
            elapsed += TRACE_STEP_MS
        assert len(reached) == 2, f"both dependents half-close within {TRACE_BUDGET_MS} ms; reached {reached}"
        assert reached["r2"] < reached["r3"], "cards are reached in reset order"
        assert reached["r3"] - reached["r2"] >= STAGGER_MS - TRACE_STEP_MS, "cards reached at least 90 ms apart"
        assert counts[0] == 0 and 1 in counts, f"the reset list counts up card by card: {counts}"
        assert page.locator("[data-trace-path]").count() > 0, "the trace path is drawn"
        reads(page, edit.get_by_role("status", name="Reset count"), "2 matches will reset, 1 of them confirmed", "final count")
        click(edit.get_by_role("button", name="Cancel"))
        opened: dict[str, int] = {}
        elapsed = 0
        for _ in range(TRACE_BUDGET_MS // TRACE_STEP_MS + 1):
            for key, c in cards.items():
                if key not in opened and c.first.get_attribute("data-shutter") != "half":
                    opened[key] = elapsed
            if len(opened) == 2:
                break
            advance(page, TRACE_STEP_MS)
            elapsed += TRACE_STEP_MS
        assert len(opened) == 2, "cancel reopens every slat"
        assert opened["r3"] < opened["r2"] and opened["r2"] - opened["r3"] >= STAGGER_MS - TRACE_STEP_MS, \
            f"slats reopen in reverse order, 90 ms apart: {opened}"


def test_shutter_trace_reduced_motion(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org, reduced="reduce") as page:
        details, edit = open_edit(page, 0, 2)
        items = edit.get_by_role("list", name="Matches that will reset").get_by_role("listitem")
        count = edit.get_by_role("status", name="Reset count")

        def complete() -> bool:
            return (items.count() == 2 and text(count) == "2 matches will reset, 1 of them confirmed"
                    and all("Will reset" in card(page, n).first.inner_text() for n in (R2M1_DONE, R3M1_OPEN)))

        with page.expect_response(lambda r: "/edit-preview" in r.url):
            click(edit.get_by_role("button", name="Review edit"))
        elapsed = 0
        deadline = time.monotonic() + WAIT_S
        while not complete() and time.monotonic() < deadline and elapsed <= AT_ONCE_MS:
            if elapsed < AT_ONCE_MS:
                advance(page, TRACE_STEP_MS)
            elapsed += TRACE_STEP_MS if elapsed < AT_ONCE_MS else 0
        assert complete(), "dependents, list and count appear at once under reduced motion"
        page.keyboard.press("Escape")
        wait_until(page, lambda: is_focused(details.get_by_role("button", name="Edit result")), "cancel focuses Edit result")
        click(details.get_by_role("button", name="Edit result"))
        fill(edit.get_by_role("spinbutton", name=games("Ana")), "0")
        fill(edit.get_by_role("spinbutton", name=games("Hal")), "2")
        click(edit.get_by_role("button", name="Review edit"))
        click(edit.get_by_role("button", name="Confirm edit"))
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 1)], "confirm focuses the edited card")
        advance(page, ADVANCE_MS * 2)
        assert page.locator('[data-motion="advance"]').count() == 0


def test_resets_reach_every_screen(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=EDIT_STEPS)
    org = Api(app_url, cup.org)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.co) as eve, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spectator:
        for page in (eve, spectator):
            present(page, card(page, R2M1_DONE), "card before the edit")
        listen(eve, app_url, f"{cup.path}/live", "eve")
        listen(spectator, app_url, f"{cup.path}/live?share={cup.share_code}", "spec")
        m = board(org, cup)[rnd(1, 1)]
        p = ok_json(org.post(f"/api/matches/{m['id']}/edit-preview", {"upper_games": 0, "lower_games": 2,
                                                                        "version": m["version"]}), 200, "preview")
        ok_json(org.post(f"/api/matches/{m['id']}/edit", {"upper_games": 0, "lower_games": 2,
                                                          "preview_token": p["preview_token"]}), 200, "edit")
        by = time.monotonic() + LIVE_S
        for page in (eve, spectator):
            wait_until(page, lambda: card(page, "Round 2, match 1: Hal vs Dov, not played").count() > 0
                       and card(page, "Round 3, match 1: to be decided vs Ben").count() > 0, "reset cards within 2 s", by=by)
            wait_until(page, lambda: "2 matches reset" in text(status(page, "Bracket announcements")), "reset count announced", by=by)
        assert text(status(eve, "Bracket announcements")) == text(status(spectator, "Bracket announcements"))
        expected = [d["match_id"] for d in p["dependents"]]
        for page, key in ((eve, "eve"), (spectator, "spec")):
            msgs = heard(page, key)
            types = [x["type"] for x in msgs]
            i = types.index("matches.reset")
            assert [x["id"] for x in msgs[i]["data"]["matches"]] == expected, "reset message in reset order"
            later = [x for x in msgs[i + 1:] if x["type"] == "match.updated" and x["data"]["match"]["id"] == m["id"]]
            assert later, "edited match follows the reset"
        spec_text = json.dumps(heard(spectator, "spec"))
        assert cup.org not in spec_text and cup.users["Ana"] not in spec_text, "share socket carries no usernames"


def test_losers_bracket_mapping(app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_L4)
    ms = board(Api(app_url, cup.org), cup)
    expected = {los(1, 1): ("Hal", "Eli"), los(1, 2): ("Gus", "Fen"), los(2, 1): ("Hal", "Cai"),
                los(2, 2): ("Gus", "Dov"), los(3, 1): ("Hal", "Gus"), los(4, 1): ("Hal", "Ben"), GF: ("Ana", "Hal")}
    for label, pair in expected.items():
        assert (who(ms[label]["upper"]), who(ms[label]["lower"])) == pair, f"{label}"
    small = seed_cup(app_url, DE, n=5, steps=[saved(win(1, 2), 2, 0)])
    sm = board(Api(app_url, small.org), small)
    assert sm[los(1, 1)]["state"] == "bye" and who(sm[los(1, 1)]["lower"]) == "Eli"
    assert who(sm[los(2, 1)]["upper"]) == "Eli"
    assert sm[los(1, 2)]["state"] == "not_needed" and who(sm[los(2, 2)]["upper"]) == "bye"


def test_wf_double_elimination_final_reset(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_L4)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spec:
        present(spec, card(spec, "Grand final reset: waiting for grand final"), "reset waiting")
        report_dialog(org, "Grand final: Ana vs Hal, not played", "Ana", "Hal", 1, 2, "Save result")
        present(spec, card(spec, "Grand final reset: Ana vs Hal, not played"), "reset appears live for spectators")
        reads(spec, status(spec, "Bracket announcements"), "Grand final reset needed", "reset announcement")
        report_dialog(org, "Grand final reset: Ana vs Hal, not played", "Ana", "Hal", 0, 2, "Save result")
        present(spec, card(spec, "Grand final reset: Ana vs Hal, 0-2, Hal wins"), "reset result live")
        reads(spec, status(spec, "Bracket announcements"), "Hal wins the tournament", "champion announced")
    refused(httpx.post(app_url + f"/api/share/{cup.share_code}", json={}, timeout=HTTP_TIMEOUT_S), 405, "read_only")
    assert tournament(Api(app_url, cup.org), cup)["state"] == "finished"


def test_wf_double_elimination_final_upper_wins(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_L4)
    org_api = Api(app_url, cup.org)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spec:
        present(spec, card(spec, "Grand final: Ana vs Hal, not played"), "grand final")
        report_dialog(org, "Grand final: Ana vs Hal, not played", "Ana", "Hal", 2, 0, "Save result")
        reset = card(spec, "Grand final reset: not needed")
        present(spec, reset, "reset not needed")
        assert reset.first.get_attribute("data-state") == "not_needed" and "Not needed" in reset.first.inner_text()
        reads(spec, status(spec, "Bracket announcements"), "Ana wins the tournament", "champion announced")
    assert board(org_api, cup)[GFR]["state"] == "not_needed" and tournament(org_api, cup)["state"] == "finished"


RR5_PAIRS = {1: [("Ana", "bye"), ("Ben", "Eli"), ("Cai", "Dov")], 2: [("Ana", "Eli"), ("bye", "Dov"), ("Ben", "Cai")],
             3: [("Ana", "Dov"), ("Eli", "Cai"), ("bye", "Ben")], 4: [("Ana", "Cai"), ("Dov", "Ben"), ("Eli", "bye")],
             5: [("Ana", "Ben"), ("Cai", "bye"), ("Dov", "Eli")]}
RR4_PAIRS = {1: [("Ana", "Dov"), ("Ben", "Cai")], 2: [("Ana", "Cai"), ("Dov", "Ben")], 3: [("Ana", "Ben"), ("Cai", "Dov")]}


def test_round_robin_schedule(app_url):
    for n, pairs in ((5, RR5_PAIRS), (4, RR4_PAIRS)):
        cup = seed_cup(app_url, RR, n=n)
        ms = board(Api(app_url, cup.org), cup)
        assert len(ms) == sum(len(v) for v in pairs.values())
        met = []
        for r, row in pairs.items():
            for m, pair in enumerate(row, 1):
                got = ms[rnd(r, m)]
                assert (who(got["upper"]), who(got["lower"])) == pair, f"{n} entrants {rnd(r, m)}"
                if "bye" in pair:
                    assert got["state"] == "bye"
                else:
                    met.append(frozenset(pair))
        assert len(met) == len(set(met)) == n * (n - 1) // 2


def signed(value: Any) -> str:
    if isinstance(value, str):
        return value
    return f"{value:+d}" if value else "0"


def test_round_robin_standings_worked_example(app_url):
    draft = seed_cup(app_url, RR, n=4, state="draft")
    zero = standings(Api(app_url, draft.org), draft)
    assert [r["name"] for r in zero["rows"]] == ["Ana", "Ben", "Cai", "Dov"]
    assert all(r["match_points"] == 0 and r["played"] == 0 for r in zero["rows"])
    cup = seed_cup(app_url, RR, n=5, state="finished",
                   steps=[saved(label, u, l) for label, (u, l) in RR5_RESULTS.items()])
    s = standings(Api(app_url, cup.org), cup)
    assert s["columns"] == RR_COLUMNS
    got = [[str(r["place"]), r["name"], str(r["played"]), str(r["match_points"]), str(r["head_to_head"]),
            signed(r["game_difference"]), str(r["games_won"]), str(r["seed"]), r["decided_by"]]
           for r in s["rows"]]
    assert got == RR5_TABLE


def test_wf_round_robin_standings_live(browser, app_url):
    cup = seed_cup(app_url, RR, n=5, steps=[saved(label, u, l) for label, (u, l) in RR5_RESULTS.items() if label != rnd(5, 1)])
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spec, \
            screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Eli"]) as eli:
        for page in (spec, eli):
            present(page, page.get_by_role("table", name="Standings"), "standings table")
        c = card(org, "Round 5, match 1: Ana vs Ben, not played")
        shown(org, c, "last match")
        c.first.focus()
        org.keyboard.press("Enter")
        dlg = org.get_by_role("dialog", name="Report score")
        shown(org, dlg, "Report score")
        for name, v in ((games("Ana"), "2"), (games("Ben"), "1")):
            dlg.get_by_role("spinbutton", name=name).first.focus()
            org.keyboard.press("Control+a")
            org.keyboard.type(v)
        dlg.get_by_role("button", name="Save result").first.focus()
        org.keyboard.press("Enter")
        for page in (spec, eli):
            wait_until(page, lambda: table_rows(page) == [RR_COLUMNS] + RR5_TABLE, "standings reorder live")
        reads(eli, status(eli, "Bracket announcements"), "Ben wins the tournament", "winner announced")
    s = standings(Api(app_url, cup.org), cup)
    assert [r["name"] for r in s["rows"]] == ["Ben", "Ana", "Cai", "Dov", "Eli"]


def test_wf_round_robin_standings_draw(browser, app_url):
    cup = seed_cup(app_url, RR, n=4)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Dov"]) as dov:
        present(dov, dov.get_by_role("table", name="Standings"), "standings")
        report_dialog(org, "Round 1, match 1: Ana vs Dov, not played", "Ana", "Dov", 1, 1, "Save result")
        present(dov, card(dov, "Round 1, match 1: Ana vs Dov, 1-1, draw"), "draw card live")

        def drawn() -> bool:
            rows = table_rows(dov)
            by_name = {r[1]: r for r in rows[1:]}
            return rows[0] == RR_COLUMNS and all(by_name[n][2:4] == ["1", "1"] for n in ("Ana", "Dov"))

        wait_until(dov, drawn, "Ana and Dov each show played 1, match points 1")
    rows = {r["name"]: r for r in standings(Api(app_url, cup.org), cup)["rows"]}
    assert rows["Ana"]["match_points"] == rows["Dov"]["match_points"] == 1


def test_wf_swiss_round_two_pairing(browser, app_url):
    cup = seed_cup(app_url, SWISS, n=6, steps=SWISS6_R1)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/t/{cup.id}/me", cup.users["Fen"], size=PHONE) as fen:
        shown(fen, fen.get_by_role("region", name="Next match"), "Fen's next match region")
        click(org.get_by_role("button", name="Start next round"))
        present(fen, fen.get_by_role("region", name="Next match").get_by_role("button", name="Round 2, match 3: Fen vs Dov, not played", exact=True),
                "Fen's new card live")
        reads(fen, status(fen, "Bracket announcements"), "Round 2 is paired", "pairing announcement")
    ms = board(Api(app_url, cup.org), cup)
    assert [(who(ms[rnd(2, m)]["upper"]), who(ms[rnd(2, m)]["lower"])) for m in (1, 2, 3)] == \
        [("Ana", "Eli"), ("Cai", "Ben"), ("Fen", "Dov")]


def test_wf_swiss_round_two_unfinished(browser, app_url):
    cup = seed_cup(app_url, SWISS, n=6, steps=SWISS6_R1[:2])
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org:
        b = org.get_by_role("button", name="Start next round")
        shown(org, b, "Start next round")
        click(b.first)
        reads(org, org.get_by_role("alert"), "Finish every match in round 1 first.", "refusal band")
    assert not any(label.startswith("Round 2,") for label in board(Api(app_url, cup.org), cup))


def test_swiss_bye(app_url):
    cup = seed_cup(app_url, SWISS, n=5)
    org = Api(app_url, cup.org)
    ms = board(org, cup)
    assert [(who(ms[rnd(1, m)]["upper"]), who(ms[rnd(1, m)]["lower"])) for m in (1, 2, 3)] == \
        [("Ana", "Cai"), ("Ben", "Dov"), ("Eli", "bye")]
    assert ms[rnd(1, 3)]["state"] == "bye"
    rows = {r["name"]: r for r in standings(org, cup)["rows"]}
    assert rows["Eli"]["match_points"] == 3 and rows["Eli"]["played"] == 1
    for label in (rnd(1, 1), rnd(1, 2)):
        ok_json(write(org, cup, label, "result", 2, 0), 200, "round 1 result")
    ok_json(org.post(f"{cup.path}/rounds"), 201, "pair round 2")
    ms = board(org, cup)
    assert [(who(ms[rnd(2, m)]["upper"]), who(ms[rnd(2, m)]["lower"])) for m in (1, 2, 3)] == \
        [("Ana", "Ben"), ("Eli", "Cai"), ("Dov", "bye")]


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def test_swiss_standings_worked_example(browser, app_url):
    cup = seed_cup(app_url, SWISS, n=6, steps=SWISS6_R1 + [NEXT_ROUND] + SWISS6_R2)
    s = standings(Api(app_url, cup.org), cup)
    assert s["columns"] == SWISS_COLUMNS
    for i, (row, (name, mp, bc1, b, sb, seed)) in enumerate(zip(s["rows"], SWISS6_TABLE), 1):
        assert (row["place"], row["name"], row["played"], row["seed"], row["decided_by"]) == (i, name, 2, seed, "Match points")
        assert tuple(float(row[k]) for k in ("match_points", "buchholz_cut_1", "buchholz", "sonneborn_berger")) == \
            (float(mp), float(bc1), float(b), float(sb)), "the brief fixes the values, not their JSON type"
    expected = [SWISS_COLUMNS] + [[str(i), n, "2", _fmt(mp), _fmt(bc1), _fmt(b), _fmt(sb), str(seed), "Match points"]
                                  for i, (n, mp, bc1, b, sb, seed) in enumerate(SWISS6_TABLE, 1)]
    with screen(browser, app_url, f"/s/{cup.share_code}") as page:
        present(page, page.get_by_role("table", name="Standings"), "standings")
        wait_until(page, lambda: table_rows(page) == expected, "share standings show the worked table")


def test_wf_check_in_clock_open(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, state="draft")
    org = Api(app_url, cup.org)
    closes = (server_now(app_url) + timedelta(milliseconds=CHECKIN_AHEAD_MS)).replace(microsecond=0)
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/checkin/open" in r.url else None)
        click(page.get_by_role("button", name="Open check-in"))
        dlg = page.get_by_role("dialog", name="Open check-in")
        box_ = dlg.get_by_role("textbox", name="Check-in closes")
        shown(page, box_, "Check-in closes")
        assert box_.first.input_value() == ""
        fill(box_, "next thursday")
        click(dlg.get_by_role("button", name="Start check-in"))
        shown(page, page.get_by_text("Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.", exact=True), "format error")
        assert sent == [], "a malformed close time sends nothing"
        fill(box_, f"{closes:%Y-%m-%d %H:%M:%S}")
        click(dlg.get_by_role("button", name="Start check-in"))
        wait_until(page, lambda: tournament(org, cup)["state"] == "checkin_open", "check-in opens")
        assert parse(tournament(org, cup)["checkin_closes_at"]) == closes
        with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Dov"]) as dov:
            shown(dov, dov.get_by_text(f"Check-in closes at {closes:%H:%M} (UTC)", exact=True), "close time in the rail")
            reads(dov, status(dov, "Check-in count"), "0 of 4 checked in", "count")
            ok_json(Api(app_url, cup.users["Ana"]).post(f"{cup.path}/checkin"), 200, "Ana checks in")
            reads(dov, status(dov, "Check-in count"), "1 of 4 checked in", "count rises live")
            reads(dov, status(dov, "Bracket announcements"), "Ana checked in", "announcement")
            reads(page, status(page, "Check-in count"), "1 of 4 checked in", "organizer count")
            check(page.get_by_role("checkbox", name=named("Checked in: <name>", {"name": "Ben"})))
            reads(dov, status(dov, "Check-in count"), "2 of 4 checked in", "organizer tick reaches players live")
    listed = {e["name"]: e["checked_in"] for e in ok_json(org.get(f"{cup.path}/entrants"), 200, "e")["entrants"]}
    assert listed == {"Ana": True, "Ben": True, "Cai": False, "Dov": False}


def test_checkin_closes_on_server_time(browser, app_url):
    closes = server_now(app_url) + timedelta(milliseconds=CHECKIN_AHEAD_MS)
    cup = seed_cup(app_url, SE, n=4, state="checkin_open", checked_in=set(), closes_at=iso(closes))
    org = Api(app_url, cup.org)
    ana = Api(app_url, cup.users["Ana"])
    ok_json(ana.post(f"{cup.path}/checkin"), 200, "check-in")
    ok_json(ana.post(f"{cup.path}/checkin"), 200, "repeat check-in")
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Ben"]) as ben:
        ben.clock.set_system_time(server_now(app_url) + DEVICE_SKEW)
        ben.reload()
        shown(ben, ben.get_by_role("button", name="Check in"), "Check in while the server says open")
        move_clock(app_url, CHECKIN_AHEAD_MS + CLOCK_MARGIN_MS)
        reads(ben, status(ben, "Bracket announcements"), "Check-in is closed.", "closing announced live")
        assert tournament(org, cup)["state"] == "checkin_closed"
        refused(Api(app_url, cup.users["Ben"]).post(f"{cup.path}/checkin"), 409, "checkin_closed", "Check-in is closed.")
        refused(org.put(f"/api/entrants/{cup.entrants['Cai']}/checkin", {"checked_in": True}), 409, "checkin_closed")
        ben.clock.set_system_time(server_now(app_url) - DEVICE_SKEW)
        ben.reload()
        shown(ben, ben.get_by_text(f"Check-in closed at {closes:%H:%M} (UTC)", exact=True), "closed time in the rail")
        assert ben.get_by_role("button", name="Check in").count() == 0, "no Check in once the server closed it"
    assert tournament(org, cup)["checked_in_count"] == 1


def test_wf_check_in_clock_no_shows(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="checkin_closed", checked_in={"Ana", "Ben", "Cai", "Dov", "Eli", "Gus"},
                   closes_at=iso(server_now(app_url)))
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        click(page.get_by_role("button", name="Start tournament"))
        reads(page, status(page, "Page notice"), "Removed 2 no-shows: Fen, Hal.", "no-show notice")
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/bracket", "start lands on the bracket")
        for name in ("Round 1, match 1: Ana vs bye", "Round 1, match 2: Dov vs Eli, not played",
                     "Round 1, match 3: Ben vs bye", "Round 1, match 4: Cai vs Gus, not played"):
            present(page, card(page, name), name)
    org = Api(app_url, cup.org)
    listed = ok_json(org.get(f"{cup.path}/entrants"), 200, "entrants")["entrants"]
    assert [(e["name"], e["seed"]) for e in listed] == [("Ana", 1), ("Ben", 2), ("Cai", 3), ("Dov", 4), ("Eli", 5), ("Gus", 6)]
    assert tournament(org, cup)["field_size"] == 6


def test_wf_check_in_clock_player_me(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, state="checkin_open", checked_in={"Ben", "Cai", "Dov"},
                   closes_at=iso(server_now(app_url) + timedelta(milliseconds=CHECKIN_AHEAD_MS)))
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Ana"], size=PHONE) as page:
        b = page.get_by_role("button", name="Check in")
        shown(page, b, "Check in")
        click(b.first)
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/me", "check-in lands on /me")
        region = page.get_by_role("region", name="Next match")
        reads(page, region, "You're checked in. Your first match appears here when the tournament starts.", "before start")
        org = Api(app_url, cup.org)
        ok_json(org.post(f"{cup.path}/checkin/close"), 200, "close")
        ok_json(org.post(f"{cup.path}/start"), 200, "start")
        present(page, card(region, "Round 1, match 1: Ana vs Dov, not played"), "first match appears live")
        ok_json(write(Api(app_url, cup.users["Dov"]), cup, rnd(1, 1), "report", 0, 2), 200, "Dov reports")
        present(page, card(region, "Round 1, match 1: Ana vs Dov, 0-2 reported by Dov, awaiting Ana"), "card follows live")
    assert ok_json(Api(app_url, cup.users["Ana"]).get(f"{cup.path}/me"), 200, "me")["checked_in"] is True


BREAKPOINT_CASES = ["phone", "tablet", "desk"]
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desk": DESK}


@pytest.mark.parametrize("viewport", BREAKPOINT_CASES, ids=BREAKPOINT_CASES)
def test_breakpoints_layout(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    draft = seed_cup(app_url, SE, n=8, state="draft")
    running = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, "/", size=size) as page:
        shown(page, page.get_by_role("heading", name="Cupfold", level=1), "wordmark")
        layout(page)
        tabs = page.get_by_role("tablist", name="Formats")
        chosen = tabs.get_by_role("tab", selected=True).first.inner_text().strip()
        img = page.get_by_role("img", name=FORMAT_OBJECTS[chosen])
        shown(page, img, "format object")
        (tx, ty), (ix, iy) = centre(box(tabs)), centre(box(img))
        assert (ty < iy) if viewport == "phone" else (tx < ix), f"format names vs tile at {viewport}"
    with screen(browser, app_url, f"/t/{draft.id}/setup", draft.org, size=size) as page:
        seeding, preview = page.get_by_role("list", name="Seeding"), page.get_by_role("region", name="Bracket preview")
        shown(page, preview, "preview")
        layout(page)
        s, p = box(seeding), box(preview)
        if viewport == "desk":
            assert p["x"] >= s["x"] + s["width"] - 1, "desk: preview in the right column"
        else:
            assert p["y"] >= s["y"] + s["height"] - 1, "one column: preview under seeding"
    with screen(browser, app_url, f"/t/{running.id}/bracket", running.org, size=size) as page:
        rounds = page.get_by_role("tablist", name="Rounds")
        if viewport == "phone":
            shown(page, rounds, "phone round tabs")
        else:
            shown(page, page.get_by_role("region", name="Bracket"), "bracket region")
            assert rounds.count() == 0 or not rounds.first.is_visible()
        no_page_overflow(page)
    with screen(browser, app_url, f"/s/{running.share_code}", size=size) as page:
        shown(page, page.get_by_role("heading", name=CUP, level=1), "share hero")
        no_page_overflow(page)


def test_wf_phone_bracket_swipe(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=SE_R1)
    with screen(browser, app_url, f"/s/{cup.share_code}", size=PHONE, touch=True) as page:
        tablist = page.get_by_role("tablist", name="Rounds")
        shown(page, tablist, "tablist Rounds")
        assert [t.strip() for t in tablist.get_by_role("tab").all_inner_texts()] == ["Round 1", "Round 2", "Round 3"]
        wait_until(page, lambda: selected_tab(page, "Round 2"), "current round selected on load")
        panel = page.get_by_role("tabpanel", name="Round 2")
        present(page, card(panel, "Round 2, match 1: Ana vs Dov, not played"), "round 2 card in its panel")
        ok_json(write(Api(app_url, cup.users["Ana"]), cup, rnd(2, 1), "report", 2, 0), 200, "report")
        present(page, card(panel, "Round 2, match 1: Ana vs Dov, 2-0 reported by Ana, awaiting Dov"), "card updates live")
        far = SWIPE_PX + SWIPE_EXTRA_PX

        def swipe_to(dx: float, tab: str) -> None:
            current = page.get_by_role("tabpanel")
            swipe(page, current.first, dx)
            wait_until(page, lambda: selected_tab(page, tab), f"swipe {dx}px selects {tab}")

        swipe_to(-far, "Round 3")
        swipe_to(-far, "Round 3")
        swipe_to(far, "Round 2")
        swipe(page, page.get_by_role("tabpanel").first, SHORT_SWIPE_PX)
        advance(page, STEP_MS * 4)
        assert selected_tab(page, "Round 2"), "a swipe under 50 px does nothing"
        swipe_to(far, "Round 1")
        swipe_to(far, "Round 1")
        tablist.get_by_role("tab", name="Round 1", exact=True).first.focus()
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: is_focused(tablist.get_by_role("tab", name="Round 2", exact=True)), "ArrowRight moves tabs")


def _walk_keys(obj: Any) -> Iterator[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_keys(v)


def test_share_link_read_only(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[saved(rnd(1, 1), 2, 1), called(rnd(1, 2))])
    secrets = [cup.org, cup.co, *cup.users.values()]
    url = app_url + f"/api/share/{cup.share_code}"
    r = httpx.get(url, timeout=HTTP_TIMEOUT_S)
    body = ok_json(r, 200, "share GET")
    assert {"tournament", "entrants", "matches", "standings"} <= set(body)
    assert all(set(e) <= {"name", "seed"} for e in body["entrants"])
    assert not PUBLIC_FORBIDDEN_KEYS & set(_walk_keys(body))
    assert not [s for s in secrets if s in r.text], "no usernames in the public shape"
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        refused(httpx.request(method, url, json={}, timeout=HTTP_TIMEOUT_S), 405, "read_only", "Share links are read-only.")
    refused(httpx.post(url + "/logo", json={}, timeout=HTTP_TIMEOUT_S), 405, "read_only")
    draft = seed_cup(app_url, SE, n=4, state="draft")
    refused(httpx.get(app_url + f"/api/share/{draft.share_code}", timeout=HTTP_TIMEOUT_S), 404, "not_found",
            "This tournament is not public yet.")
    refused(httpx.get(app_url + "/api/share/" + "A" * SHARE_CODE_LEN, timeout=HTTP_TIMEOUT_S), 404, "not_found",
            "This link no longer works.")
    with screen(browser, app_url, f"/s/{cup.share_code}") as page:
        shown(page, page.get_by_role("heading", name=CUP, level=1), "share heading")
        field = page.get_by_role("list", name="Field").get_by_role("listitem")
        wait_until(page, lambda: field.count() == 8, "field list")
        shown(page, page.get_by_role("img", name=f"{CUP} trophy"), "trophy")
        assert page.get_by_role("button", name="Share").count() == 0
        listen(page, app_url, f"{cup.path}/live?share={cup.share_code}", "spec")
        c = card(page, "Round 1, match 1: Ana vs Hal, 2-1, Ana wins")
        click(c.first)
        shown(page, page.get_by_role("dialog", name="Match details"), "spectators get Match details")
        assert page.get_by_role("dialog", name="Report score").count() == 0
        ok_json(write(Api(app_url, cup.users["Dov"]), cup, rnd(1, 2), "report", 2, 0), 200, "report")
        msgs = poll(lambda: heard(page, "spec") or None, "share socket receives the change")
        assert not [s for s in secrets if s in json.dumps(msgs) + page.content()]
        assert not PUBLIC_FORBIDDEN_KEYS & set(_walk_keys(msgs))


def test_wf_phone_bracket_replace_link(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    old = cup.share_code
    toast_ms = config(app_url)["toast_ms"]
    with screen(browser, app_url, f"/s/{old}", size=PHONE, touch=True) as spec, \
            screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org:
        listen(spec, app_url, f"{cup.path}/live?share={old}", "old")
        org.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        click(org.get_by_role("button", name="Share"))
        dlg = org.get_by_role("dialog", name="Share tournament")
        link = dlg.get_by_role("textbox", name="Share link")
        shown(org, link, "share link")
        assert link.first.input_value().endswith(f"/s/{old}")
        click(dlg.get_by_role("button", name="Copy link"))
        reads(org, status(org, "Page notice"), "Link copied", "copy notice")
        assert org.evaluate("() => navigator.clipboard.readText()") == link.first.input_value()
        advance(org, toast_ms + STEP_MS)
        assert "Link copied" not in text(status(org, "Page notice")), "notice leaves after the toast lifetime"
        click(dlg.get_by_role("button", name="Replace link"))
        wait_until(org, lambda: not link.first.input_value().endswith(f"/s/{old}"), "textbox shows the new link")
        new = urlsplit(link.first.input_value()).path.rsplit("/", 1)[-1]
        reads(org, status(org, "Page notice"), "Link replaced. The old link no longer works.", "replace notice")
        closed = poll(lambda: socket_closed(spec, "old"), "the old share socket is closed", LIVE_S)
        assert closed == {"code": 4404, "reason": "link_replaced"}
        spec.reload()
        shown(spec, spec.get_by_text("This link no longer works.", exact=True), "dead link page")
        spec.goto(app_url + f"/s/{new}")
        shown(spec, spec.get_by_role("heading", name=CUP, level=1), "new link works")
    refused(httpx.get(app_url + f"/api/share/{old}", timeout=HTTP_TIMEOUT_S), 404, "not_found", "This link no longer works.")
    ok_json(httpx.get(app_url + f"/api/share/{new}", timeout=HTTP_TIMEOUT_S), 200, "new share link")


def test_live_channel_seq_and_catch_up(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spec:
        present(spec, card(spec, "Round 1, match 1: Ana vs Hal, not played"), "spectator card")
        live = f"{cup.path}/live"
        listen(org, app_url, live, "a")
        ok_json(write(Api(app_url, cup.users["Ana"]), cup, rnd(1, 1), "report", 2, 1), 200, "report")
        by = time.monotonic() + LIVE_S
        msgs = poll(lambda: [m for m in heard(org, "a") if m["type"] == "match.updated"
                             and m["data"]["match"]["id"] == cup.matches[rnd(1, 1)]], "match.updated within 2 s", LIVE_S)
        wait_until(spec, lambda: card(spec, "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal").count() > 0,
                   "spectator screen updates within 2 s without reload", by=by)
        got = heard(org, "a")
        assert all({"seq", "type", "at", "data"} <= set(m) for m in got)
        seqs = [m["seq"] for m in got]
        assert seqs == list(range(seqs[0], seqs[0] + len(seqs)))
        last = seqs[-1]
        hang_up(org, "a")
        ok_json(write(Api(app_url, cup.users["Hal"]), cup, rnd(1, 1), "confirm"), 200, "confirm while away")
        listen(org, app_url, f"{live}?after={last}", "b")
        replay = poll(lambda: [m for m in heard(org, "b") if m["type"] == "match.updated"
                               and m["data"]["match"]["state"] == "confirmed"] and heard(org, "b"), "missed messages replayed")
        rs = [m["seq"] for m in replay]
        assert rs[0] == last + 1 and rs == list(range(last + 1, last + 1 + len(rs)))
        listen(org, app_url, f"{live}?after=0", "c")
        assert poll(lambda: heard(org, "c"), "full replay")[0]["seq"] == 1
    r = Api(app_url, cup.org).get(f"/api/tournaments/missing{fresh()}/live",
                                  headers={"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
                                           "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})
    assert r.status_code == 404


ADVANCE_SAMPLES = 16
RECT_JS = "e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }"


def test_advance_motion(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        src = card(page, "Round 1, match 1: Ana vs Hal, not played")
        dst = card(page, "Round 2, match 1: to be decided vs to be decided")
        present(page, dst, "next card")
        a, b = centre(box(src)), centre(box(dst))
        report_dialog(page, "Round 1, match 1: Ana vs Hal, not played", "Ana", "Hal", 2, 0, "Save result")
        mover = page.locator('[data-motion="advance"]')
        wait_until(page, lambda: mover.count() > 0, 'a data-motion="advance" name is created',
                   step=TRACE_STEP_MS)
        if mover.first.evaluate("e => e.getAnimations({subtree: true}).length"):
            path = motion(mover.first, ADVANCE_MS)
        else:
            path = []
            while mover.count() > 0 and len(path) <= ADVANCE_SAMPLES * 2:
                path.append(mover.first.evaluate(RECT_JS))
                page.clock.run_for(round(ADVANCE_MS / ADVANCE_SAMPLES))
        assert len(path) >= 2
        start, end = centre(path[0]), centre(path[-1])
        assert dist(start, a) < dist(start, b), "the name starts at its card"
        assert dist(end, b) < dist(end, a) and dist(end, b) < dist(start, b), "and arrives at the next card by 320 ms"


def test_wf_advance_motion_announce_reduced(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org, reduced="reduce") as page:
        present(page, card(page, "Round 1, match 1: Ana vs Hal, not played"), "card")
        page.evaluate("""() => { window.__advanced = false;
            new MutationObserver(() => { if (document.querySelector('[data-motion="advance"]')) window.__advanced = true; })
              .observe(document.body, {subtree: true, childList: true, attributes: true}); }""")
        report_dialog(page, "Round 1, match 1: Ana vs Hal, not played", "Ana", "Hal", 2, 0, "Save result")
        done = card(page, "Round 1, match 1: Ana vs Hal, 2-0, Ana wins")
        present(page, done, "result shown")
        assert animations(done.first) == [], "no card animation under reduced motion"
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 1)], "focus returns to the card")
        reads(page, status(page, "Bracket announcements"), "Ana advances to round 2", "announcement")
        reads(page, status(page, "Your action"), "Result saved", "Your action")
        advance(page, ADVANCE_MS * 2)
        assert page.evaluate("() => window.__advanced") is False, "no advance element is ever created"
    assert board(Api(app_url, cup.org), cup)[rnd(1, 1)]["state"] == "confirmed"


def test_wf_advance_motion_announce_sentences(browser, app_url):
    cup = seed_cup(app_url, DE, n=8)
    path = f"/t/{cup.id}/bracket"
    sentence = "Ana advances to winners round 2. Hal drops to losers round 1"
    with screen(browser, app_url, path, cup.org) as org, \
            screen(browser, app_url, path, cup.users["Hal"], size=PHONE) as hal, \
            screen(browser, app_url, f"/s/{cup.share_code}") as spec:
        name = "Winners round 1, match 1: Ana vs Hal, not played"
        c = card(org, name)
        shown(org, c, name)
        c.first.focus()
        org.keyboard.press("Enter")
        dlg = org.get_by_role("dialog", name="Report score")
        fill(dlg.get_by_role("spinbutton", name=games("Ana")), "2")
        fill(dlg.get_by_role("spinbutton", name=games("Hal")), "0")
        dlg.get_by_role("button", name="Save result").first.focus()
        org.keyboard.press("Enter")
        for page in (org, hal, spec):
            reads(page, status(page, "Bracket announcements"), sentence, "announcement")
        assert len({text(status(p, "Bracket announcements")) for p in (org, hal, spec)}) == 1, "identical on every screen"
        reads(org, status(org, "Your action"), "Result saved", "actor outcome")
        assert active_match(org) == cup.matches[win(1, 1)], "announcing does not move focus"
        assert "Result saved" not in text(status(hal, "Your action"))
    assert who(board(Api(app_url, cup.org), cup)[los(1, 1)]["upper"]) == "Hal"


SE_PLACES = {"Ana": "1st", "Ben": "2nd", "Dov": "3rd", "Cai": "3rd", "Hal": "5th", "Eli": "5th", "Gus": "5th", "Fen": "5th"}
DE_PLACES = {"Ana": "1st", "Hal": "2nd", "Ben": "3rd", "Gus": "4th", "Cai": "5th", "Dov": "5th", "Eli": "7th", "Fen": "7th"}


def test_final_placements(browser, app_url):
    for cup, label, places in ((seed_cup(app_url, SE, n=8, steps=SE_TO_FINAL), rnd(3, 1), SE_PLACES),
                               (seed_cup(app_url, DE, n=8, steps=DE_TO_L4), GF, DE_PLACES)):
        org = Api(app_url, cup.org)
        with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
            listen(page, app_url, f"{cup.path}/live", "w")
            ok_json(write(org, cup, label, "result", 2, 0), 200, "final result")
            poll(lambda: any(m["type"] == "announcement" and "Ana wins the tournament" in m["data"]["text"]
                             for m in heard(page, "w")), "winner announced on the live channel")
        assert tournament(org, cup)["state"] == "finished"
        for name, place in places.items():
            row = history_text(org, cup.users[name], cup.id)
            assert f" · {place} of 8 · " in row, f"{name}: {row}"


def test_wf_final_ranking_history_row(browser, app_url):
    tag = fresh()
    first = seed_cup(app_url, SE, n=4, steps=[saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 2, 0)], tag=tag)
    before = server_now(app_url)
    with screen(browser, app_url, f"/t/{first.id}/bracket", first.org) as page:
        report_dialog(page, "Round 2, match 1: Ana vs Ben, not played", "Ana", "Ben", 2, 1, "Save result")
        present(page, card(page, "Round 2, match 1: Ana vs Ben, 2-1, Ana wins"), "final result")
    after = server_now(app_url)
    ben_user = first.users["Ben"]
    ben = Api(app_url, ben_user)
    row = poll(lambda: history_text(ben, ben_user, first.id), "Ben's history row is written")
    assert row in {f"{CUP} · 2nd of 4 · {d:%Y-%m-%d}" for d in (before, after)}
    with screen(browser, app_url, f"/u/{ben_user}", ben_user) as page:
        shown(page, page.get_by_role("heading", name=ben_user, level=1), "history heading")
        items = page.get_by_role("list", name="Tournament history").get_by_role("listitem")
        for _ in range(2):
            wait_until(page, lambda: items.count() > 0 and items.first.inner_text().strip() == row, "row shown")
            page.reload()
    second = seed_cup(app_url, SE, n=4, steps=[saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 2, 0)], tag=tag, new_users=False)
    org2 = Api(app_url, second.org)
    m = board(org2, second)[rnd(1, 1)]
    p = ok_json(org2.post(f"/api/matches/{m['id']}/edit-preview", {"upper_games": 0, "lower_games": 2, "version": m["version"]}), 200, "p")
    ok_json(org2.post(f"/api/matches/{m['id']}/edit", {"upper_games": 0, "lower_games": 2, "preview_token": p["preview_token"]}), 200, "edit")
    assert history_text(ben, ben_user, first.id) == row, "edits elsewhere never touch a written row"
    ok_json(write(org2, second, rnd(2, 1), "result", 2, 0), 200, "finish second")
    rows = ok_json(ben.get(f"/api/users/{ben_user}/history"), 200, "history")["rows"]
    assert [r["tournament_id"] for r in rows][:2] == [second.id, first.id], "newest first"
    refused(write(Api(app_url, first.org), first, rnd(2, 1), "edit-preview", 0, 2), 409, "wrong_state", FINISHED)


def test_wf_final_ranking_history_empty(browser, app_url):
    cup = seed_cup(app_url, SE, n=2, state="draft")
    with screen(browser, app_url, f"/u/{cup.viewer}", cup.viewer) as page:
        shown(page, page.get_by_role("heading", name=cup.viewer, level=1), "heading")
        shown(page, page.get_by_text("No finished tournaments yet.", exact=True), "empty history")
    with screen(browser, app_url, f"/u/{cup.viewer}") as page:
        wait_until(page, lambda: urlsplit(page.url).path == "/signin"
                   and parse_qs(urlsplit(page.url).query).get("next") == [f"/u/{cup.viewer}"], "redirect to sign in")
    api = Api(app_url, cup.viewer)
    assert ok_json(api.get(f"/api/users/{cup.viewer}/history"), 200, "history")["rows"] == []
    unknown = named("/api/users/<username>/history", {"username": f"ghost_{fresh()}"})
    refused(api.get(unknown), 404, "not_found")


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(m[key], str) and m[key].strip(), key


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing}"
    assert "Geist" in notices


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_storage_only_postgres_minio():
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names if any(store.lower() in n for store in FORBIDDEN_STORES)]
    assert Postgres().tables(), "the schema exists in Postgres"


def test_if_same_origin_assets(browser, app_url):
    with _ctx(open_app(browser, app_url + "/")) as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/signin", "/signup"):
            page.goto(app_url + path)
            advance(page, STEP_MS * 10)
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not foreign, f"cross-origin loads: {foreign}"


def test_if_lockfile_npm_ci():
    assert Path("/app/package-lock.json").is_file()
    assert json.loads(Path("/app/run.json").read_text())["install"].split()[:2] == ["npm", "ci"]


def test_if_services_untouched(app_url):
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    assert Postgres().tables()
    assert isinstance(S3().keys(""), list)


def test_if_no_service_worker(browser, app_url):
    with _ctx(open_app(browser, app_url + "/")) as page:
        for path in ("/", "/signin"):
            page.goto(app_url + path)
            advance(page, STEP_MS * 10)
            assert page.evaluate("async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0") == 0


def key_in(page: Page, spin: Locator, value: int) -> None:
    spin.first.focus()
    page.keyboard.press("Control+a")
    page.keyboard.type(str(value))


def press_on(page: Page, loc: Locator, key: str = "Enter") -> None:
    loc.first.focus()
    page.keyboard.press(key)


def open_card(page: Page, name: str, dialog: str) -> Locator:
    c = card(page, name)
    shown(page, c, name)
    press_on(page, c)
    dlg = page.get_by_role("dialog", name=dialog)
    shown(page, dlg, f'Enter on "{name}" opens dialog "{dialog}"')
    return dlg


def gone(dlg: Locator) -> bool:
    return dlg.count() == 0 or not dlg.first.is_visible()


def save_by_keys(page: Page, dlg: Locator, upper: str, lower: str, u: int, l: int, button: str) -> None:
    key_in(page, dlg.get_by_role("spinbutton", name=games(upper)), u)
    key_in(page, dlg.get_by_role("spinbutton", name=games(lower)), l)
    press_on(page, dlg.get_by_role("button", name=button, exact=True))


def test_wf_seeding_keyboard_start_six_byes(browser, app_url):
    cup = seed_cup(app_url, SE, n=6, state="draft")
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        seeding = page.get_by_role("list", name="Seeding")
        fen = seeding.get_by_role("listitem", name=seat(6, "Fen"), exact=True)
        shown(page, fen, "6. Fen")
        fen.first.focus()
        page.keyboard.press("Alt+ArrowUp")
        five = seeding.get_by_role("listitem", name=seat(5, "Fen"), exact=True)
        wait_until(page, lambda: is_focused(five), "Fen moves to seed 5 with focus kept on his item")
        page.keyboard.press("Alt+ArrowUp")
        four = seeding.get_by_role("listitem", name=seat(4, "Fen"), exact=True)
        wait_until(page, lambda: is_focused(four), "Fen moves to seed 4 with focus kept on his item")
        reads(page, status(page, "Your action"), "Fen moved to seed 4", "Your action")
        preview = ["Match 1: Ana vs bye", "Match 2: Fen vs Dov", "Match 3: Ben vs bye", "Match 4: Cai vs Eli"]
        wait_until(page, lambda: preview_texts(page) == preview, "round 1 preview gives the byes to seeds 1 and 2")
        press_on(page, page.get_by_role("button", name="Start tournament", exact=True))
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/bracket", "start lands on /t/<id>/bracket")
        names = ["Round 1, match 1: Ana vs bye", "Round 1, match 2: Fen vs Dov, not played",
                 "Round 1, match 3: Ben vs bye", "Round 1, match 4: Cai vs Eli, not played",
                 "Round 2, match 1: Ana vs to be decided", "Round 2, match 2: Ben vs to be decided",
                 "Round 3, match 1: to be decided vs to be decided"]
        for when in ("after start", "after reload"):
            for name in names:
                present(page, card(page, name), f"{name} {when}")
            page.reload()
    org = Api(app_url, cup.org)
    assert entrant_names(org, cup) == ["Ana", "Ben", "Cai", "Fen", "Dov", "Eli"]
    assert board(org, cup)[rnd(1, 1)]["state"] == "bye"


def test_wf_seeding_keyboard_start_typed_seed(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft")
    org = Api(app_url, cup.org)
    v0 = tournament(org, cup)["seeding_version"]
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/seeding" in r.url else None)
        spin = page.get_by_role("spinbutton", name="Seed for Hal", exact=True)
        shown(page, spin, "Seed for Hal")
        key_in(page, spin, 9)
        page.keyboard.press("Enter")
        shown(page, page.get_by_text("Enter a seed from 1 to 8.", exact=True), "the seed field error under the field")
        advance(page, STEP_MS * 10)
        assert sent == [], "an out-of-range seed sends no request (L422)"
        key_in(page, spin, 1)
        page.keyboard.press("Enter")
        seeding = page.get_by_role("list", name="Seeding")
        present(page, seeding.get_by_role("listitem", name=seat(1, "Hal"), exact=True), "Hal at seed 1")
        wait_until(page, lambda: is_focused(page.get_by_role("spinbutton", name="Seed for Hal", exact=True)),
                   "focus stays on the spinbutton after typing")
        reads(page, status(page, "Your action"), "Hal moved to seed 1", "Your action")
        wait_until(page, lambda: preview_texts(page) == ["Match 1: Hal vs Gus", "Match 2: Cai vs Dov",
                                                         "Match 3: Ana vs Fen", "Match 4: Ben vs Eli"],
                   "round 1 preview follows the typed seed")
    assert entrant_names(org, cup) == ["Hal", "Ana", "Ben", "Cai", "Dov", "Eli", "Fen", "Gus"]
    assert tournament(org, cup)["seeding_version"] == v0 + 1


def test_wf_bracket_keyboard_scoring_organizer_keys(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        dlg = open_card(page, "Round 1, match 2: Dov vs Eli, not played", "Report score")
        first = dlg.get_by_role("spinbutton", name=games("Dov"))
        first.first.focus()
        page.keyboard.press("Shift+Tab")
        wait_until(page, lambda: focus_in(dlg), "Shift+Tab keeps focus inside the dialog")
        save_by_keys(page, dlg, "Dov", "Eli", 1, 1, "Save result")
        reads(page, dlg.get_by_role("status", name="Dialog status"), NEED_WINNER, "the draw is refused in the dialog")
        wait_until(page, lambda: is_focused(first), "a refused write puts focus on the first spinbutton")
        save_by_keys(page, dlg, "Dov", "Eli", 1, 2, "Save result")
        wait_until(page, lambda: gone(dlg), "the dialog closes after the save")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 2)], "focus returns to the card")
        present(page, card(page, "Round 1, match 2: Dov vs Eli, 1-2, Eli wins"), "saved card")
        reads(page, status(page, "Your action"), "Result saved", "Your action")
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(2, 1)], "ArrowRight goes to round 2 match 1")
        present(page, card(page, "Round 2, match 1: to be decided vs Eli"), "Eli fills the lower slot of round 2 match 1")
    m = board(Api(app_url, cup.org), cup)[rnd(1, 2)]
    assert (m["state"], m["upper_games"], m["lower_games"], m["winner"]) == ("confirmed", 1, 2, "lower")


def test_wf_report_confirm_dispute_keyboard_confirm(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    name = "Round 1, match 1: Ana vs Hal, not played"
    waiting_name = "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Hal"]) as hal:
        present(hal, card(hal, name), "Hal's card before the report")
        dlg = open_card(ana, name, "Report score")
        save_by_keys(ana, dlg, "Ana", "Hal", 2, 1, "Submit score")
        reads(ana, status(ana, "Your action"), "Score reported, awaiting Hal", "Ana's Your action")
        wait_until(ana, lambda: active_match(ana) == cup.matches[rnd(1, 1)], "focus returns to Ana's card")
        waiting = card(hal, waiting_name)
        present(hal, waiting, "Hal's card waits on him, live")
        assert waiting.first.get_attribute("data-state") == "reported"
        assert "Awaiting confirmation" in waiting.first.inner_text(), "the visible status word"
        conf = open_card(hal, waiting_name, "Confirm score")
        hal.keyboard.press("Escape")
        wait_until(hal, lambda: gone(conf), "Escape closes Confirm score")
        wait_until(hal, lambda: active_match(hal) == cup.matches[rnd(1, 1)], "focus back on Hal's card")
        assert board(Api(app_url, cup.org), cup)[rnd(1, 1)]["state"] == "reported", "Escape sent nothing"
        conf = open_card(hal, waiting_name, "Confirm score")
        press_on(hal, conf.get_by_role("button", name="Confirm score", exact=True))
        reads(hal, status(hal, "Your action"), "Score confirmed", "Hal's Your action")
        for page in (ana, hal):
            present(page, card(page, "Round 1, match 1: Ana vs Hal, 2-1, Ana wins"), "confirmed card on both screens")
            reads(page, status(page, "Bracket announcements"), "Ana advances to round 2", "announcement")


def test_wf_report_confirm_dispute_reporter_details(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[rep(rnd(1, 1), 2, 1, "Ana")])
    name = "Round 1, match 1: Ana vs Hal, 2-1 reported by Ana, awaiting Hal"
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Gus"]) as gus:
        for page in (ana, gus):
            details = open_card(page, name, "Match details")
            assert page.get_by_role("dialog", name="Confirm score").count() == 0
            assert details.get_by_role("button", name="Confirm score").count() == 0
            page.keyboard.press("Escape")
            wait_until(page, lambda: gone(details), "Escape closes Match details")
            wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 1)], "focus back on the card")
    refused(write(Api(app_url, cup.users["Ana"]), cup, rnd(1, 1), "confirm"), 403, "forbidden",
            "You cannot confirm your own report.")
    refused(write(Api(app_url, cup.users["Gus"]), cup, rnd(1, 1), "report", 2, 0), 403, "forbidden",
            "Only the two players in this match or an organizer can report it.")
    assert board(Api(app_url, cup.org), cup)[rnd(1, 1)]["state"] == "reported"


def test_wf_coorganizer_conflict_confirm_after_overwrite(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[rep(rnd(1, 1), 2, 0, "Ana")])
    path = f"/t/{cup.id}/bracket"
    reported = "Round 1, match 1: Ana vs Hal, 2-0 reported by Ana, awaiting Hal"
    done = "Round 1, match 1: Ana vs Hal, 2-1, Ana wins"
    with screen(browser, app_url, path, cup.users["Hal"]) as hal, screen(browser, app_url, path, cup.co) as eve:
        conf = open_card(hal, reported, "Confirm score")
        dlg = open_card(eve, reported, "Report score")
        save_by_keys(eve, dlg, "Ana", "Hal", 2, 1, "Save result")
        reads(eve, status(eve, "Your action"), "Result saved", "the co-organizer's Your action")
        present(eve, card(eve, done), "the co-organizer's card")
        press_on(hal, conf.get_by_role("button", name="Confirm score", exact=True))
        msg = named("This match was updated by <username>. Current score: <score>.", {"username": cup.co, "score": "2-1"})
        reads(hal, conf.get_by_role("status", name="Dialog status"), msg, "the stale sentence in Hal's dialog")
        assert conf.first.is_visible(), "the refused dialog stays open"
        hal.keyboard.press("Escape")
        wait_until(hal, lambda: gone(conf), "Escape closes the refused dialog")
        present(hal, card(hal, done), "Hal's bracket shows the saved result")
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert (m["state"], m["upper_games"], m["lower_games"], m["updated_by"]) == ("confirmed", 2, 1, cup.co)


def test_wf_coorganizer_conflict_both_players_report(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    name = "Round 1, match 1: Ana vs Hal, not played"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Hal"]) as hal:
        a = open_card(ana, name, "Report score")
        h = open_card(hal, name, "Report score")
        key_in(hal, h.get_by_role("spinbutton", name=games("Ana")), 1)
        key_in(hal, h.get_by_role("spinbutton", name=games("Hal")), 2)
        save_by_keys(ana, a, "Ana", "Hal", 2, 1, "Submit score")
        reads(ana, status(ana, "Your action"), "Score reported, awaiting Hal", "Ana's report lands first")
        press_on(hal, h.get_by_role("button", name="Submit score", exact=True))
        wait_until(hal, lambda: gone(h), "Hal's report is accepted as his answer, so his dialog closes")
        for page in (ana, hal):
            disputed = card(page, "Round 1, match 1: Ana vs Hal, disputed")
            present(page, disputed, "one disputed card on both screens")
            assert disputed.first.get_attribute("data-state") == "disputed"
    m = board(Api(app_url, cup.org), cup)[rnd(1, 1)]
    assert m["state"] == "disputed" and m["report"]["by"] == "Ana" and m["dispute"]["by"] == "Hal"
    assert (m["dispute"]["upper_games"], m["dispute"]["lower_games"]) == (1, 2)


def test_wf_coorganizer_conflict_add_co_organizer(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft", co=False)
    ghost = f"ghost_{fresh()}"
    path = f"/t/{cup.id}/setup"
    with screen(browser, app_url, path, cup.org) as org:
        box_ = org.get_by_role("textbox", name="Co-organizer username")
        shown(org, box_, "Co-organizer username")
        box_.first.focus()
        org.keyboard.type(ghost)
        press_on(org, org.get_by_role("button", name="Add co-organizer", exact=True))
        shown(org, org.get_by_text(f"No account named @{ghost}.", exact=True), "the unknown-account error under the field")
        box_.first.focus()
        org.keyboard.press("Control+a")
        org.keyboard.type(cup.viewer)
        press_on(org, org.get_by_role("button", name="Add co-organizer", exact=True))
        listed = org.get_by_role("list", name="Co-organizers").get_by_role("button", name=f"Remove {cup.viewer}", exact=True)
        present(org, listed, "the new co-organizer is listed")
        with screen(browser, app_url, path, cup.viewer) as zed:
            seeding = zed.get_by_role("list", name="Seeding")
            ben = seeding.get_by_role("listitem", name=seat(2, "Ben"), exact=True)
            shown(zed, ben, "the co-organizer sees the seeding list")
            ben.first.focus()
            zed.keyboard.press("Alt+ArrowUp")
            wait_until(zed, lambda: is_focused(seeding.get_by_role("listitem", name=seat(1, "Ben"), exact=True)),
                       "the co-organizer moves Ben to seed 1")
            assert zed.get_by_role("button", name="Delete tournament").count() == 0, "no Delete for co-organizers"
            assert zed.get_by_role("textbox", name="Co-organizer username").count() == 0, "no co-organizer controls"
    org_api = Api(app_url, cup.org)
    assert tournament(org_api, cup)["co_organizers"] == [cup.viewer]
    assert entrant_names(org_api, cup)[:2] == ["Ben", "Ana"]
    refused(Api(app_url, cup.viewer).delete(cup.path), 403, "forbidden", "Only the organizer can do this.")


DE_TO_W2 = DE_W1 + [saved(los(1, 1), 2, 0), saved(los(1, 2), 2, 0)]


def test_wf_double_elimination_final_drop_live(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_W2)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as fan:
        present(fan, card(fan, "Losers round 2, match 2: Gus vs to be decided"), "losers round 2 match 2 waits")
        dlg = open_card(org, "Winners round 2, match 1: Ana vs Dov, not played", "Report score")
        save_by_keys(org, dlg, "Ana", "Dov", 2, 0, "Save result")
        wait_until(org, lambda: gone(dlg), "the dialog closes")
        present(fan, card(fan, "Losers round 2, match 2: Gus vs Dov, not played"), "Dov drops to losers round 2 match 2 live")
        present(fan, card(fan, "Losers round 2, match 1: Hal vs to be decided"), "match 1 still waits on winners round 2 match 2")
        present(fan, card(fan, "Winners round 3, match 1: Ana vs to be decided"), "Ana advances live")
        for page in (org, fan):
            reads(page, status(page, "Bracket announcements"), "Ana advances to winners round 3. Dov drops to losers round 2",
                  "the joined announcement")


def test_wf_double_elimination_final_keyboard_reset(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_L4)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as fan:
        present(fan, card(fan, "Grand final reset: waiting for grand final"), "the reset waits")
        dlg = open_card(org, "Grand final: Ana vs Hal, not played", "Report score")
        save_by_keys(org, dlg, "Ana", "Hal", 1, 2, "Save result")
        wait_until(org, lambda: active_match(org) == cup.matches[GF], "focus returns to the grand final card")
        reset = "Grand final reset: Ana vs Hal, not played"
        for page in (org, fan):
            present(page, card(page, reset), "the reset fills live")
            reads(page, status(page, "Bracket announcements"), "Grand final reset needed", "the reset announcement")
        org.keyboard.press("ArrowRight")
        wait_until(org, lambda: active_match(org) == cup.matches[GFR], "ArrowRight reaches the reset")
        org.keyboard.press("Enter")
        dlg = org.get_by_role("dialog", name="Report score")
        shown(org, dlg, "Enter opens Report score on the reset")
        save_by_keys(org, dlg, "Ana", "Hal", 2, 0, "Save result")
        for page in (org, fan):
            present(page, card(page, "Grand final reset: Ana vs Hal, 2-0, Ana wins"), "the reset result")
            reads(page, status(page, "Bracket announcements"), "Ana wins the tournament", "the champion")
    assert tournament(Api(app_url, cup.org), cup)["state"] == "finished"


def test_wf_double_elimination_final_bye_paths(browser, app_url):
    cup = seed_cup(app_url, DE, n=5)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as fan:
        nn = card(fan, "Losers round 1, match 2: not needed")
        present(fan, nn, "the two-bye losers match")
        assert nn.first.get_attribute("data-state") == "not_needed"
        assert "Not needed" in nn.first.inner_text(), "the visible status word"
        present(fan, card(fan, "Winners round 1, match 4: Cai vs bye"), "the bye card")
        dlg = open_card(org, "Winners round 1, match 2: Dov vs Eli, not played", "Report score")
        save_by_keys(org, dlg, "Dov", "Eli", 2, 0, "Save result")
        present(fan, card(fan, "Losers round 1, match 1: Eli vs bye"), "Eli meets the passed-on bye, live")
        present(fan, card(fan, "Winners round 2, match 1: Ana vs Dov, not played"), "Dov meets Ana, live")


def test_wf_round_robin_standings_phone_share(browser, app_url):
    steps = [saved(label, u, l) for label, (u, l) in RR5_RESULTS.items() if label != rnd(1, 2)]
    cup = seed_cup(app_url, RR, n=5, steps=steps)
    with screen(browser, app_url, f"/s/{cup.share_code}", size=PHONE, touch=True) as fan:
        shown(fan, fan.get_by_role("tablist", name="Rounds"), "tablist Rounds")
        wait_until(fan, lambda: selected_tab(fan, "Round 1"), "the current round's tab is selected on load")
        swipe(fan, fan.get_by_role("tabpanel").first, -(SWIPE_PX + SWIPE_EXTRA_PX))
        wait_until(fan, lambda: selected_tab(fan, "Round 2"), "a swipe left selects Round 2")
        present(fan, fan.get_by_role("table", name="Standings"), "standings under the rounds")
        ok_json(write(Api(app_url, cup.org), cup, rnd(1, 2), "result", 2, 0), 200, "save Ben–Eli")
        wait_until(fan, lambda: table_rows(fan) == [RR_COLUMNS] + RR5_TABLE, "the phone standings update live")
        no_page_overflow(fan)


def test_wf_round_robin_standings_keyboard_schedule(browser, app_url):
    cup = seed_cup(app_url, RR, n=5)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        rounds = page.get_by_role("region", name="Rounds")
        start = card(rounds, "Round 1, match 1: Ana vs bye")
        shown(page, start, "round 1 bye card")
        start.first.focus()
        for key, label, name in (("ArrowRight", rnd(2, 1), "Round 2, match 1: Ana vs Eli, not played"),
                                 ("ArrowDown", rnd(2, 2), "Round 2, match 2: Dov vs bye"),
                                 ("ArrowDown", rnd(2, 3), "Round 2, match 3: Ben vs Cai, not played"),
                                 ("ArrowRight", rnd(3, 3), "Round 3, match 3: Ben vs bye"),
                                 ("End", rnd(5, 1), "Round 5, match 1: Ana vs Ben, not played"),
                                 ("Home", rnd(1, 1), "Round 1, match 1: Ana vs bye"),
                                 ("ArrowRight", rnd(2, 1), "Round 2, match 1: Ana vs Eli, not played")):
            page.keyboard.press(key)
            wait_until(page, lambda: active_match(page) == cup.matches[label], f"{key} moves to {label}")
            assert is_focused(card(rounds, name)), f"the focused card is named {name!r}"
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Report score")
        shown(page, dlg, "Enter opens Report score")
        save_by_keys(page, dlg, "Ana", "Eli", 1, 1, "Save result")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(2, 1)], "focus returns to the card")
        present(page, card(rounds, "Round 2, match 1: Ana vs Eli, 1-1, draw"), "the draw card")


RR4_STEPS = [saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 2, 0), saved(rnd(2, 1), 2, 0), saved(rnd(2, 2), 2, 0),
             saved(rnd(3, 2), 2, 1)]
RR4_TABLE = [["1", "Ben", "3", "6", "3", "+2", "4", "2", "Head-to-head"],
             ["2", "Ana", "3", "6", "0", "+2", "4", "1", "Head-to-head"],
             ["3", "Cai", "3", "3", "3", "-3", "2", "3", "Head-to-head"],
             ["4", "Dov", "3", "3", "0", "-1", "3", "4", "Head-to-head"]]


def test_wf_round_robin_standings_head_to_head(browser, app_url):
    cup = seed_cup(app_url, RR, n=4, steps=RR4_STEPS)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as fan:
        present(fan, fan.get_by_role("table", name="Standings"), "the spectator's standings")
        dlg = open_card(org, "Round 3, match 1: Ana vs Ben, not played", "Report score")
        save_by_keys(org, dlg, "Ana", "Ben", 0, 2, "Save result")
        wait_until(fan, lambda: table_rows(fan) == [RR_COLUMNS] + RR4_TABLE, "head-to-head decides, live")
        reads(fan, status(fan, "Bracket announcements"), "Ben wins the tournament", "the winner")
        fan.reload()
        wait_until(fan, lambda: table_rows(fan) == [RR_COLUMNS] + RR4_TABLE, "the same table after reload")
    assert [r["decided_by"] for r in standings(Api(app_url, cup.org), cup)["rows"]] == ["Head-to-head"] * 4


def test_wf_swiss_round_two_keyboard_bye(browser, app_url):
    cup = seed_cup(app_url, SWISS, n=7, steps=[saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 1, 2)])
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/t/{cup.id}/me", cup.users["Gus"]) as gus:
        present(org, card(org, "Round 1, match 4: Gus vs bye"), "the round 1 bye is the last card")
        dlg = open_card(org, "Round 1, match 3: Cai vs Fen, not played", "Report score")
        save_by_keys(org, dlg, "Cai", "Fen", 1, 1, "Save result")
        present(org, card(org, "Round 1, match 3: Cai vs Fen, 1-1, draw"), "the draw")
        press_on(org, org.get_by_role("button", name="Start next round", exact=True))
        for name in ("Round 2, match 1: Ana vs Eli, not played", "Round 2, match 2: Gus vs Cai, not played",
                     "Round 2, match 3: Fen vs Ben, not played", "Round 2, match 4: Dov vs bye"):
            present(org, card(org, name), name)
        reads(org, status(org, "Bracket announcements"), "Round 2 is paired", "the pairing announcement")
        nxt = gus.get_by_role("region", name="Next match")
        present(gus, card(nxt, "Round 2, match 2: Gus vs Cai, not played"), "Gus's next match appears live")
    m = board(Api(app_url, cup.org), cup)[rnd(2, 4)]
    assert m["state"] == "bye" and who(m["upper"]) == "Dov"


def test_wf_check_in_clock_organizer_ticks(browser, app_url):
    closes = iso(server_now(app_url) + timedelta(milliseconds=CHECKIN_AHEAD_MS))
    cup = seed_cup(app_url, SE, n=8, state="checkin_open", checked_in={"Ana"}, closes_at=closes)
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as org, \
            screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Ben"]) as ben:
        button = ben.get_by_role("button", name="Check in", exact=True)
        shown(ben, button, "Ben's Check in button")
        reads(ben, status(ben, "Check-in count"), "1 of 8 checked in", "Ben's count")
        tick = org.get_by_role("checkbox", name=named("Checked in: <name>", {"name": "Ben"}), exact=True)
        shown(org, tick, "the organizer's checkbox")
        press_on(org, tick, "Space")
        wait_until(org, lambda: tick.first.is_checked(), "Space ticks the checkbox")
        for page in (org, ben):
            reads(page, status(page, "Check-in count"), "2 of 8 checked in", "the count rises live")
        reads(ben, status(ben, "Bracket announcements"), "Ben checked in", "the announcement")
        wait_until(ben, lambda: button.count() == 0 or not button.first.is_visible(), "Ben's Check in button goes away live")
    rows = ok_json(Api(app_url, cup.org).get(f"{cup.path}/entrants"), 200, "entrants")["entrants"]
    assert [e["name"] for e in rows if e["checked_in"]] == ["Ana", "Ben"]


def test_wf_advance_motion_announce_two_screens(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=SE_R1)
    path = f"/t/{cup.id}/bracket"
    name = "Round 2, match 1: Ana vs Dov, not played"
    with screen(browser, app_url, path, cup.org) as org, \
            screen(browser, app_url, path, cup.users["Ana"], reduced="reduce") as ana:
        present(ana, card(ana, name), "Ana's card")
        ana.evaluate("""() => { window.__advanced = false;
            new MutationObserver(() => { if (document.querySelector('[data-motion="advance"]')) window.__advanced = true; })
              .observe(document.body, {subtree: true, childList: true, attributes: true}); }""")
        other = card(ana, "Round 2, match 2: Ben vs Cai, not played")
        shown(ana, other, "another card")
        other.first.focus()
        dlg = open_card(org, name, "Report score")
        save_by_keys(org, dlg, "Ana", "Dov", 2, 0, "Save result")
        mover = org.locator('[data-motion="advance"]')
        wait_until(org, lambda: mover.count() > 0, "the organizer's screen moves the winner's name", step=TRACE_STEP_MS)
        for page in (org, ana):
            reads(page, status(page, "Bracket announcements"), "Ana advances to round 3", "the announcement")
        present(ana, card(ana, "Round 2, match 1: Ana vs Dov, 2-0, Ana wins"), "Ana's screen shows the result at once")
        advance(ana, ADVANCE_MS * 2)
        assert ana.evaluate("() => window.__advanced") is False, "no moving name under reduced motion"
        assert active_match(ana) == cup.matches[rnd(2, 2)], "a live update never moves the watching player's focus"


def test_wf_advance_motion_announce_share_and_me(browser, app_url):
    cup = seed_cup(app_url, DE, n=8)
    sentence = "Ana advances to winners round 2. Hal drops to losers round 1"
    with screen(browser, app_url, f"/s/{cup.share_code}", size=PHONE, touch=True) as fan, \
            screen(browser, app_url, f"/t/{cup.id}/me", cup.users["Hal"]) as hal:
        nxt = hal.get_by_role("region", name="Next match")
        present(hal, card(nxt, "Winners round 1, match 1: Ana vs Hal, not played"), "Hal's first match")
        ok_json(write(Api(app_url, cup.org), cup, win(1, 1), "result", 2, 0), 200, "organizer saves")
        for page in (fan, hal):
            reads(page, status(page, "Bracket announcements"), sentence, "the same sentence on every screen")
        present(hal, card(nxt, "Losers round 1, match 1: Hal vs to be decided"), "Hal's next match follows him live")
        assert "Result saved" not in text(status(hal, "Your action")), "only the actor's Your action reads the outcome"


def test_wf_roster_upload_outage_keyboard_errors(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, state="draft")
    data = b"# club night\nx | Ana\n5 | Ben\n\n2 | \nDov\n"
    expected = ["Line 2: seed must be a whole number from 1 to 128",
                "Line 3: seed 5 is larger than the number of entrants (4)",
                "Line 5: name is empty"]
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        press_on(page, page.get_by_role("button", name="Upload roster", exact=True))
        dlg = page.get_by_role("dialog", name="Upload roster")
        shown(page, dlg, 'Enter opens dialog "Upload roster"')
        dlg.get_by_label("Roster file").set_input_files({"name": "club.cupfold.txt", "mimeType": "text/plain", "buffer": data})
        press_on(page, dlg.get_by_role("button", name="Add roster", exact=True))
        errors = page.get_by_role("list", name="Roster errors").get_by_role("listitem")
        wait_until(page, lambda: [t.strip() for t in errors.all_text_contents()] == expected, "roster errors in order")
        heading = page.get_by_role("heading", name=ROSTER_INVALID, level=2)
        wait_until(page, lambda: is_focused(heading), "focus moves to the roster error heading")
    org = Api(app_url, cup.org)
    assert entrant_names(org, cup) == list(NAMES), "a refused roster changes nothing"
    assert f"rosters/{cup.id}/{hashlib.sha256(data).hexdigest()}.cupfold.txt" in S3().keys(f"rosters/{cup.id}/"), \
        "the refused file is stored too (L941)"
    refused(org.get(f"{cup.path}/roster"), 404, "not_found", "No roster file has been added.")


def test_wf_final_ranking_history_players_finish(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, steps=[saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 2, 0)])
    path = f"/t/{cup.id}/bracket"
    before = server_now(app_url)
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Ben"]) as ben:
        dlg = open_card(ana, "Round 2, match 1: Ana vs Ben, not played", "Report score")
        save_by_keys(ana, dlg, "Ana", "Ben", 2, 1, "Submit score")
        reads(ana, status(ana, "Your action"), "Score reported, awaiting Ben", "Ana's Your action")
        conf = open_card(ben, "Round 2, match 1: Ana vs Ben, 2-1 reported by Ana, awaiting Ben", "Confirm score")
        press_on(ben, conf.get_by_role("button", name="Confirm score", exact=True))
        for page in (ana, ben):
            reads(page, status(page, "Bracket announcements"), "Ana wins the tournament", "the winner on both screens")
        after = server_now(app_url)
        for page, entrant, place in ((ana, "Ana", "1st"), (ben, "Ben", "2nd")):
            user = cup.users[entrant]
            rows = {f"{CUP} · {place} of 4 · {d:%Y-%m-%d}" for d in (before, after)}
            page.goto(app_url + f"/u/{user}")
            items = page.get_by_role("list", name="Tournament history").get_by_role("listitem")
            for _ in range(2):
                wait_until(page, lambda: items.count() == 1 and items.first.inner_text().strip() in rows,
                           f"{entrant}'s history row reads {place} of 4")
                page.reload()


def test_wf_bracket_keyboard_scoring_roving_tab(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as page:
        region = page.get_by_role("region", name="Bracket")
        first = card(region, "Round 1, match 1: Ana vs Hal, not played")
        shown(page, first, "the first card of the current round")
        wait_until(page, lambda: _tab_stops(region) == [cup.matches[rnd(1, 1)]],
                   "the region's single Tab stop starts on the current round's first match")
        first.first.focus()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 3)], "arrows reach round 1 match 3")
        page.keyboard.press("Tab")
        wait_until(page, lambda: not focus_in(region), "one Tab leaves the region")
        page.keyboard.press("Shift+Tab")
        wait_until(page, lambda: active_match(page) == cup.matches[rnd(1, 3)], "Shift+Tab returns to the last focused card")
        whole = page.get_by_role("button", name="Whole bracket", exact=True)
        page.keyboard.press("z")
        wait_until(page, lambda: whole.first.get_attribute("aria-pressed") == "true", "Z shows the whole bracket")
        page.keyboard.press("z")
        wait_until(page, lambda: whole.first.get_attribute("aria-pressed") == "false", "Z again returns")
        dlg = open_card(page, "Round 1, match 3: Ben vs Gus, not played", "Report score")
        page.keyboard.press("z")
        advance(page, STEP_MS * 4)
        assert whole.first.get_attribute("aria-pressed") == "false", "Z does nothing while a dialog is open"
        page.keyboard.press("Escape")
        wait_until(page, lambda: gone(dlg), "Escape closes the dialog")


def test_wf_check_in_clock_zone_and_player(browser, app_url):
    zone = "Asia/Kolkata"
    cup = seed_cup(app_url, SE, n=4, state="draft", time_zone=zone)
    org = Api(app_url, cup.org)
    closes = (server_now(app_url) + timedelta(milliseconds=CHECKIN_AHEAD_MS)).replace(second=0, microsecond=0)
    local = closes.astimezone(ZoneInfo(zone))
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org) as page:
        press_on(page, page.get_by_role("button", name="Open check-in", exact=True))
        dlg = page.get_by_role("dialog", name="Open check-in")
        box_ = dlg.get_by_role("textbox", name="Check-in closes")
        shown(page, box_, "Check-in closes")
        box_.first.focus()
        page.keyboard.type(f"{local:%Y-%m-%d %H:%M}")
        press_on(page, dlg.get_by_role("button", name="Start check-in", exact=True))
        wait_until(page, lambda: tournament(org, cup)["state"] == "checkin_open", "check-in opens")
        assert parse(tournament(org, cup)["checkin_closes_at"]) == closes, "the local time is sent as UTC"
        with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.users["Dov"]) as dov:
            button = dov.get_by_role("button", name="Check in", exact=True)
            shown(dov, button, "Dov's Check in button while the server says check-in is open")
            shown(dov, dov.get_by_text(f"Check-in closes at {local:%H:%M} ({zone})", exact=True), "the close time in the zone")
            press_on(dov, button)
            wait_until(dov, lambda: urlsplit(dov.url).path == f"/t/{cup.id}/me", "checking in lands on /t/<id>/me")
            reads(dov, dov.get_by_role("region", name="Next match"),
                  "You're checked in. Your first match appears here when the tournament starts.", "the player page sentence")
            reads(page, status(page, "Check-in count"), "1 of 4 checked in", "the organizer's count rises live")


def test_wf_phone_bracket_tap_details(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_W1)
    with screen(browser, app_url, f"/s/{cup.share_code}", size=PHONE, touch=True) as fan:
        tablist = fan.get_by_role("tablist", name="Rounds")
        shown(fan, tablist, "tablist Rounds")
        assert [t.strip() for t in tablist.get_by_role("tab").all_inner_texts()] == \
            ["Winners 1", "Winners 2", "Winners 3", "Losers 1", "Losers 2", "Losers 3", "Losers 4", "Grand final"]
        tap(tablist.get_by_role("tab", name="Losers 1", exact=True).first)
        wait_until(fan, lambda: selected_tab(fan, "Losers 1"), "tapping Losers 1 selects it")
        panel = fan.get_by_role("tabpanel", name="Losers 1")
        name = "Losers round 1, match 1: Hal vs Eli, not played"
        c = card(panel, name)
        shown(fan, c, name)
        tap(c.first)
        details = fan.get_by_role("dialog", name="Match details")
        shown(fan, details, "tapping a card opens Match details for a spectator")
        assert details.get_by_role("button", name="Edit result").count() == 0
        assert fan.get_by_role("dialog", name="Report score").count() == 0
        tap(details.get_by_role("button", name="Close", exact=True).first)
        wait_until(fan, lambda: gone(details), "Close closes the dialog")
        ok_json(write(Api(app_url, cup.org), cup, los(1, 1), "result", 2, 1), 200, "the organizer saves")
        present(fan, card(panel, "Losers round 1, match 1: Hal vs Eli, 2-1, Hal wins"), "the card updates live")
        no_page_overflow(fan)


def test_wf_advance_motion_announce_resolve(browser, app_url):
    cup = seed_cup(app_url, SE, n=8, steps=[dis(rnd(1, 1), 2, 0, "Ana", 0, 2)])
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.org) as org, screen(browser, app_url, path, cup.users["Hal"]) as hal:
        present(hal, card(hal, "Round 1, match 1: Ana vs Hal, disputed"), "Hal sees the dispute")
        dlg = open_card(org, "Round 1, match 1: Ana vs Hal, disputed", "Resolve dispute")
        for claim in ("Ana says 2-0", "Hal says 0-2"):
            shown(org, dlg.get_by_text(claim, exact=True), claim)
        save_by_keys(org, dlg, "Ana", "Hal", 2, 1, "Resolve")
        wait_until(org, lambda: gone(dlg), "the dialog closes")
        wait_until(org, lambda: active_match(org) == cup.matches[rnd(1, 1)], "focus returns to the card")
        reads(org, status(org, "Your action"), "Dispute resolved", "the organizer's Your action")
        for page in (org, hal):
            present(page, card(page, "Round 1, match 1: Ana vs Hal, 2-1, Ana wins"), "the resolved card")
            reads(page, status(page, "Bracket announcements"), "Ana advances to round 2", "the same sentence")
        assert "Dispute resolved" not in text(status(hal, "Your action")), "only the actor's Your action reads it"
    assert board(Api(app_url, cup.org), cup)[rnd(1, 1)]["state"] == "resolved"


def test_wf_final_ranking_history_double_elim_places(browser, app_url):
    cup = seed_cup(app_url, DE, n=8, steps=DE_TO_L4)
    before = server_now(app_url)
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org:
        dlg = open_card(org, "Grand final: Ana vs Hal, not played", "Report score")
        save_by_keys(org, dlg, "Ana", "Hal", 2, 0, "Save result")
        present(org, card(org, "Grand final reset: not needed"), "the reset is not needed")
        reads(org, status(org, "Bracket announcements"), "Ana wins the tournament", "the winner")
    after = server_now(app_url)
    for entrant, place in (("Ben", "3rd"), ("Gus", "4th")):
        user = cup.users[entrant]
        rows = {f"{CUP} · {place} of 8 · {d:%Y-%m-%d}" for d in (before, after)}
        with screen(browser, app_url, f"/u/{user}", user) as page:
            items = page.get_by_role("list", name="Tournament history").get_by_role("listitem")
            for _ in range(2):
                wait_until(page, lambda: items.count() == 1 and items.first.inner_text().strip() in rows,
                           f"{entrant}'s row reads {place} of 8")
                page.reload()


def test_wf_report_confirm_dispute_phone_touch(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.users["Ana"], size=PHONE, touch=True) as ana, \
            screen(browser, app_url, path, cup.users["Hal"]) as hal:
        wait_until(ana, lambda: selected_tab(ana, "Round 1"), "the current round's tab is selected on the phone")
        panel = ana.get_by_role("tabpanel", name="Round 1")
        c = card(panel, "Round 1, match 1: Ana vs Hal, not played")
        shown(ana, c, "Ana's card in the round panel")
        tap(c.first)
        dlg = ana.get_by_role("dialog", name="Report score")
        shown(ana, dlg, "tapping the card opens Report score")
        for side, value in (("Ana", "2"), ("Hal", "0")):
            spin = dlg.get_by_role("spinbutton", name=games(side))
            tap(spin.first)
            spin.first.fill(value)
        tap(dlg.get_by_role("button", name="Submit score", exact=True).first)
        reads(ana, status(ana, "Your action"), "Score reported, awaiting Hal", "Ana's Your action")
        waiting = card(hal, "Round 1, match 1: Ana vs Hal, 2-0 reported by Ana, awaiting Hal")
        present(hal, waiting, "Hal sees the report live")
        click(waiting.first)
        conf = hal.get_by_role("dialog", name="Confirm score")
        shown(hal, conf, 'dialog "Confirm score"')
        click(conf.get_by_role("button", name="Confirm score", exact=True))
        present(ana, card(panel, "Round 1, match 1: Ana vs Hal, 2-0, Ana wins"), "Ana's phone card updates live")
        no_page_overflow(ana)


def test_wf_seeding_keyboard_start_phone_start(browser, app_url):
    cup = seed_cup(app_url, SE, n=6, state="draft")
    with screen(browser, app_url, f"/t/{cup.id}/setup", cup.org, size=PHONE, touch=True) as page:
        start = page.get_by_role("button", name="Start tournament", exact=True)
        shown(page, start, "Start tournament")
        tap(start.first)
        wait_until(page, lambda: urlsplit(page.url).path == f"/t/{cup.id}/bracket", "start lands on /t/<id>/bracket")
        tablist = page.get_by_role("tablist", name="Rounds")
        shown(page, tablist, "tablist Rounds")
        assert [t.strip() for t in tablist.get_by_role("tab").all_inner_texts()] == ["Round 1", "Round 2", "Round 3"]
        wait_until(page, lambda: selected_tab(page, "Round 1"), "Round 1 is selected")
        panel = page.get_by_role("tabpanel", name="Round 1")
        for name in ("Round 1, match 1: Ana vs bye", "Round 1, match 2: Dov vs Eli, not played",
                     "Round 1, match 3: Ben vs bye", "Round 1, match 4: Cai vs Fen, not played"):
            present(page, card(panel, name), name)
        no_page_overflow(page)


def test_wf_final_ranking_history_auto_confirm_finish(browser, app_url):
    cup = seed_cup(app_url, SE, n=4, steps=[saved(rnd(1, 1), 2, 0), saved(rnd(1, 2), 2, 0), rep(rnd(2, 1), 2, 1, "Ana")])
    window = config(app_url)["confirm_window_ms"]
    before = server_now(app_url)
    path = f"/t/{cup.id}/bracket"
    with screen(browser, app_url, path, cup.users["Ana"]) as ana, screen(browser, app_url, path, cup.users["Ben"]) as ben:
        move_clock(app_url, window + CLOCK_MARGIN_MS)
        for page in (ana, ben):
            present(page, card(page, "Round 2, match 1: Ana vs Ben, 2-1, Ana wins"), "the final confirms itself, live")
            reads(page, status(page, "Bracket announcements"), "Ana wins the tournament", "the winner, live")
        after = server_now(app_url)
        for page, entrant, place in ((ana, "Ana", "1st"), (ben, "Ben", "2nd")):
            user = cup.users[entrant]
            rows = {f"{CUP} · {place} of 4 · {d:%Y-%m-%d}" for d in (before, after)}
            page.goto(app_url + f"/u/{user}")
            items = page.get_by_role("list", name="Tournament history").get_by_role("listitem")
            wait_until(page, lambda: items.count() == 1 and items.first.inner_text().strip() in rows,
                       f"{entrant}'s history row reads {place} of 4")
    assert tournament(Api(app_url, cup.org), cup)["state"] == "finished"
    assert board(Api(app_url, cup.org), cup)[rnd(2, 1)]["updated_by"] == "system"


def test_wf_coorganizer_conflict_race_focus(browser, app_url):
    cup = seed_cup(app_url, SE, n=8)
    path = f"/t/{cup.id}/bracket"
    name = "Round 1, match 2: Dov vs Eli, not played"
    done = "Round 1, match 2: Dov vs Eli, 0-2, Eli wins"
    with screen(browser, app_url, path, cup.org) as dana, screen(browser, app_url, path, cup.co) as eve:
        d = open_card(dana, name, "Report score")
        e = open_card(eve, name, "Report score")
        save_by_keys(dana, d, "Dov", "Eli", 0, 2, "Save result")
        wait_until(dana, lambda: gone(d), "the first save closes its dialog")
        wait_until(dana, lambda: active_match(dana) == cup.matches[rnd(1, 2)], "focus returns to the card after the save")
        reads(dana, status(dana, "Your action"), "Result saved", "the first co-organizer's Your action")
        save_by_keys(eve, e, "Dov", "Eli", 2, 1, "Save result")
        msg = named("This match was updated by <username>. Current score: <score>.", {"username": cup.org, "score": "0-2"})
        reads(eve, e.get_by_role("status", name="Dialog status"), msg, "the second save is refused in its dialog")
        wait_until(eve, lambda: is_focused(e.get_by_role("spinbutton", name=games("Dov"))), "focus on the first spinbutton")
        eve.keyboard.press("Escape")
        wait_until(eve, lambda: gone(e), "Escape closes the refused dialog")
        wait_until(eve, lambda: active_match(eve) == cup.matches[rnd(1, 2)], "focus returns to the card")
        for page in (dana, eve):
            present(page, card(page, done), "one result on both screens")
    m = board(Api(app_url, cup.org), cup)[rnd(1, 2)]
    assert (m["state"], m["upper_games"], m["lower_games"], m["updated_by"]) == ("confirmed", 0, 2, cup.org)


def test_wf_swiss_round_two_keyboard_standings(browser, app_url):
    cup = seed_cup(app_url, SWISS, n=6, steps=SWISS6_R1 + [NEXT_ROUND] + SWISS6_R2[:2])
    expected = [SWISS_COLUMNS] + [[str(i), n, "2", _fmt(mp), _fmt(bc1), _fmt(b), _fmt(sb), str(seed), "Match points"]
                                  for i, (n, mp, bc1, b, sb, seed) in enumerate(SWISS6_TABLE, 1)]
    with screen(browser, app_url, f"/t/{cup.id}/bracket", cup.org) as org, \
            screen(browser, app_url, f"/s/{cup.share_code}") as fan:
        present(fan, fan.get_by_role("table", name="Standings"), "the spectator's standings")
        dlg = open_card(org, "Round 2, match 3: Fen vs Dov, not played", "Report score")
        save_by_keys(org, dlg, "Fen", "Dov", 1, 1, "Save result")
        wait_until(org, lambda: gone(dlg), "the dialog closes")
        wait_until(org, lambda: active_match(org) == cup.matches[rnd(2, 3)], "focus returns to the card after the save")
        present(org, card(org, "Round 2, match 3: Fen vs Dov, 1-1, draw"), "the draw card")
        wait_until(fan, lambda: table_rows(fan) == expected, "the worked Swiss table reaches the spectator live")


def test_sign_in_errors_in_alert_band(browser, app_url):
    user = f"ana_{fresh()}"
    ok_json(post_json(app_url, "/api/auth/signup", {"username": user, "password": PASSWORD}), 201, "sign up")
    with screen(browser, app_url, "/signin") as page:
        def attempt(password: str) -> None:
            box_ = page.get_by_role("textbox", name="Username")
            shown(page, box_, "Username")
            box_.first.focus()
            page.keyboard.press("Control+a")
            page.keyboard.type(user)
            pw = page.get_by_label("Password", exact=True)
            pw.first.focus()
            page.keyboard.press("Control+a")
            page.keyboard.type(password)
            page.keyboard.press("Enter")

        attempt("wrong-pass-1")
        reads(page, page.get_by_role("alert"), "Username or password is wrong.", "the bad-credentials message in the alert band")
        for _ in range(LOGIN_RATE - 1):
            post_json(app_url, "/api/auth/signin", {"username": user, "password": "wrong-pass-1"})
        attempt(PASSWORD)
        reads(page, page.get_by_role("alert"), "Too many sign-in attempts. Wait a minute and try again.",
              "the rate-limit message in the alert band")
        assert urlsplit(page.url).path == "/signin", "a refused sign-in stays on the form"
        move_clock(app_url, RATE_WINDOW_MS + CLOCK_MARGIN_MS)
        attempt(PASSWORD)
        wait_until(page, lambda: urlsplit(page.url).path == "/t", "sign-in succeeds once the minute has passed")
