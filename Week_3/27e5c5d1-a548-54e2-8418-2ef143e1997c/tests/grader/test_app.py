from __future__ import annotations

import importlib
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
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    center,
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
    tab_order,
)


def _client(name: str, modules: tuple[str, ...]) -> Any:
    for module in modules:
        try:
            found = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(found, name):
            return getattr(found, name)
    raise ImportError(f"the {name} provider client is not importable")


def Postgres(*args: Any) -> Any:
    return _client("Postgres", ("conftest", "postgres", "postgres_client", "clients", "providers"))(*args)


def S3(*args: Any) -> Any:
    return _client("S3", ("conftest", "minio", "minio_client", "s3", "clients", "providers"))(*args)


RUTH = ("ruth@kinfold.test", "Kinfold-ruth-2026", "Ruth Hale")
GRACE = ("grace@kinfold.test", "Kinfold-grace-2026", "Grace Ng")
HALE = "Hale family"
NG = "Ng family"
NG_ZONE = "America/Los_Angeles"
PARENT = "Margaret Hale"
SESSION_COOKIE = "kinfold_session"
COLOURS = ["sage", "clay", "plum", "ochre", "slate", "rose"]
STORAGE_DOWN_ENV = "APP_STORAGE_DOWN_URL"
LIVE_DOWN_ENV = "APP_LIVE_DOWN_URL"

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
LIST_ORDER = ["Inbox", "Pharmacy", "Appointments", "Aide visits", "Waiting on others"]
FIVE: dict[str, list[str]] = {
    "Inbox": ["Refill lisinopril", "Call about hearing aid batteries", "Book podiatry follow-up"],
    "Pharmacy": ["Pick up eye drops", "Ask about a weekly pill organiser", "Move metformin to mail order"],
    "Appointments": ["Ride to cardiology on Thursday", "Dental cleaning"],
    "Aide visits": ["Tuesday visit", "Friday visit"],
    "Waiting on others": [],
}
BREAKPOINTS = [(375, 812, 1), (767, 812, 1), (768, 1024, 2), (1199, 800, 2), (1200, 800, 5), (1280, 800, 5)]

SEARCH_SETTLE_MS = 500
SEARCH_RESULT_CAP = 50
SEARCH_MAX_CP = 100
TITLE_MAX = 120
NOTES_MAX = 4000
BOARD_NAME_MAX = 60
LIST_NAME_MAX = 40
FILENAME_MAX_CP = 200
PASSWORD_MIN = 12
PASSWORD_MAX = 200
ID_LONG = 300
JSON_MAX = 65536
UPLOAD_MAX = 10_000_000
WORKER_CONNECTIONS = 20
CHIP_MS = 2000
CHIP_GONE_MS = 2500
GLIDE_MIN_MS = 250
GLIDE_MAX_MS = 400
REREAD_MS = 60000
LIVE_MS = 2000
BANNER_DOWN_S = 5
BANNER_UP_S = 10
DRAG_SLOP_PX = 4
TEXT_CONTRAST = 4.5
MOVER_CONTRAST = 3

STEP_MS = 100
POLL_MS = 1000
UI_S = 20
UI_MS = UI_S * 1000
SLACK_S = 5
HTTP_S = 30
UPLOAD_S = 120
BOOT_S = 120
POLL_GAP_S = 0.25
LOOP_CAP = 100000
WORKER_TRIES = 80
REQUEST_ROUNDS = 10
EMOJI = "\U0001F600"
PNG_SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SIG = b"\xff\xd8\xff"

PAUSED = "Live updates are paused. Your changes still save, but others' changes won't appear until live updates are back."
STORAGE_DOWN = "Attachments are unavailable right now. Cards, moves and checklists still work."
LIVE_BACK = "Live updates are back."
SIGNED_OUT = "You've been signed out. Sign in again to continue."
BAD_LOGIN = "That email and password don't match."
EMPTY_LIST = "Nothing here yet. Add a card when something needs doing."
NO_LISTS = "This board has no lists yet. Add a list to get started."
BOARD_GONE = "We couldn't find that board"
BOARD_GONE_BODY = "It may have been made private, or it isn't shared with you."
CARD_GONE = "We couldn't find that card"
CARD_GONE_BODY = "It may have been archived, or it isn't shared with you."
KEY_MAP = [
    ("Space", "focus on a card button", "lifts the card"),
    ("Up Arrow / Down Arrow", "card lifted", "one position up or down in the current list, stopping at the ends"),
    ("Left Arrow / Right Arrow", "card lifted",
     "to the previous or next list, keeping the same position number when it exists, otherwise last"),
    ("Space or Enter", "card lifted", "drops the card where it is"),
    ("Escape", "card lifted", "cancels; the card returns to where it started"),
    ("Tab", "card lifted", "cancels, then moves focus as usual"),
    ("Enter", "focus on a card button, not lifted", "opens the card dialog"),
    ("?", "focus on any control in the board area that is not a text field", "opens the Keyboard shortcuts dialog"),
    ("Escape", "a dialog, sheet or menu is open", "closes it and returns focus to the control that opened it"),
]

OBSERVER_CARD_KEYS = {"id", "boardId", "listId", "title", "position", "labels", "dueDate", "dueState", "status",
                      "version", "owner", "checklist"}
MEMBER_CARD_KEYS = OBSERVER_CARD_KEYS | {"notes", "isPrivate", "privateMembers", "attachments"}
ATTACHMENT_KEYS = {"id", "filename", "contentType", "size", "uploadedAt", "uploadedBy"}
ENTRY_KEYS = {"id", "at", "actor", "action", "target", "board", "before", "after"}

RECORDER_JS = """() => { if (window.__kitAnim) return; window.__kitAnim = true;
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const d = typeof options === 'number' ? options : (options && options.duration);
    (this.__kitDur = this.__kitDur || []).push(d);
    return orig.call(this, keyframes, options);
  }; }"""
RECORDED_JS = "(el) => el.__kitDur || []"
CONTRAST_JS = """(el) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (node) => { let n = node; while (n) { const c = parse(getComputedStyle(n).backgroundColor);
    if (c[3] > 0.5) return c; n = n.parentElement; } return [255, 255, 255, 1]; };
  const own = bgOf(el);
  const surface = el.parentElement ? bgOf(el.parentElement) : [255, 255, 255, 1];
  const text = parse(getComputedStyle(el).color);
  return {text: ratio(text, own), against_surface: ratio(own, surface), text_visible: el.textContent.trim()};
}"""
OUTLINE_JS = """(el) => [el, ...el.querySelectorAll('*')].some(e => { const s = getComputedStyle(e);
  return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none'; })"""


def tag() -> str:
    return uuid.uuid4().hex[:8]


class Api:
    def __init__(self, base: str, token: str | None = None):
        self.base = base
        self.token = token

    def cookie(self) -> dict[str, str]:
        return {"Cookie": f"{SESSION_COOKIE}={self.token}"} if self.token else {}

    def call(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None) -> httpx.Response:
        merged = {**self.cookie(), **(headers or {})}
        return httpx.request(method, f"{self.base}{path}", json=body, headers=merged, timeout=HTTP_S)

    def ok(self, method: str, path: str, body: Any = None, status: int = 200) -> Any:
        res = self.call(method, path, body)
        assert res.status_code == status, f"{method} {path} answered {res.status_code}: {res.text[:300]}"
        return res.json() if res.content else {}


def login(base: str, email: str, password: str) -> str:
    res = httpx.post(f"{base}/api/session", json={"email": email, "password": password}, timeout=HTTP_S)
    assert res.status_code == 200, f"sign-in for {email} answered {res.status_code}: {res.text[:200]}"
    found = re.search(rf"{SESSION_COOKIE}=([^;]+)", cookie_header(res))
    assert found, "sign-in set no session cookie"
    return found.group(1)


def cookie_header(res: httpx.Response) -> str:
    return next((v for _, v in res.headers.multi_items() if SESSION_COOKIE in v), "")


RUN_MANIFEST = Path("/app/run.json")


def serve_command() -> str:
    return json.loads(RUN_MANIFEST.read_text())["serve"]


def ruth(base: str) -> Api:
    return Api(base, login(base, RUTH[0], RUTH[1]))


def grace(base: str) -> Api:
    return Api(base, login(base, GRACE[0], GRACE[1]))


@dataclass(eq=False)
class Person:
    name: str
    email: str
    password: str
    user_id: str
    initials: str
    colour: str
    api: Api


@dataclass
class Board:
    id: str
    name: str
    lists: dict[str, str]
    cards: dict[str, str]
    titles: dict[str, str]


def _api(who: Any) -> Api:
    return who.api if isinstance(who, Person) else who


def creds(who: Any) -> tuple[str, str]:
    return (who.email, who.password) if isinstance(who, Person) else (who[0], who[1])


def add_person(base: str, admin: Any, ws: str, *, first: str = "Alex", role: str = "member", phone: str | None = None) -> Person:
    t = tag()
    body: dict[str, Any] = {"displayName": f"{first} Vale{t}", "email": f"{first.lower()}-{t}@kinfold.test",
                            "password": f"Starting-{t}-pw", "role": role}
    if phone:
        body["phone"] = phone
    member = _api(admin).ok("POST", f"/api/workspaces/{ws}/members", body, status=201)["member"]
    return Person(body["displayName"], body["email"], body["password"], member["userId"], member["initials"],
                  member["colour"], Api(base, login(base, body["email"], body["password"])))


def workspace(who: Any, name: str) -> str:
    for w in _api(who).ok("GET", "/api/me")["workspaces"]:
        if w["name"] == name:
            return w["id"]
    pytest.fail(f"/api/me listed no workspace named {name}")


def me_id(who: Any) -> str:
    return _api(who).ok("GET", "/api/me")["userId"]


def make_board(who: Any, ws: str, lists: dict[str, list[str]], *, visibility: str = "private",
               members: Any = (), name: str | None = None) -> Board:
    api = _api(who)
    board = api.ok("POST", f"/api/workspaces/{ws}/boards",
                   {"name": name or f"Zz board {tag()}", "visibility": visibility}, status=201)["board"]
    for person, role in members:
        api.ok("POST", f"/api/boards/{board['id']}/members", {"userId": person.user_id, "role": role}, status=201)
    list_ids: dict[str, str] = {}
    card_ids: dict[str, str] = {}
    for list_name, titles in lists.items():
        list_ids[list_name] = api.ok("POST", f"/api/boards/{board['id']}/lists", {"name": list_name}, status=201)["list"]["id"]
        for title in titles:
            card_ids[title] = api.ok("POST", f"/api/lists/{list_ids[list_name]}/cards", {"title": title}, status=201)["card"]["id"]
    return Board(board["id"], board["name"], list_ids, card_ids, {k: k for k in card_ids})


def view(who: Any, bid: str) -> Any:
    return _api(who).ok("GET", f"/api/boards/{bid}")


def titles_in(who: Any, bid: str) -> dict[str, list[str]]:
    return {l["name"]: [c["title"] for c in l["cards"]] for l in view(who, bid)["lists"]}


def assert_dense(who: Any, bid: str, label: str) -> None:
    for l in view(who, bid)["lists"]:
        positions = [c["position"] for c in l["cards"]]
        assert positions == list(range(1, len(positions) + 1)), f"{label}: {l['name']} positions {positions}"
        assert l["count"] == len(positions), f"{label}: {l['name']} count {l['count']} for {len(positions)} cards"


def board_open(who: Any, ws: str, bid: str) -> int:
    for b in _api(who).ok("GET", f"/api/workspaces/{ws}/boards")["boards"]:
        if b["id"] == bid:
            return b["openCards"]
    pytest.fail("the board is not in the caller's board list")


def card(who: Any, cid: str) -> Any:
    return _api(who).ok("GET", f"/api/cards/{cid}")["card"]


def move(who: Any, cid: str, list_id: str, position: Any, version: int) -> httpx.Response:
    return _api(who).call("POST", f"/api/cards/{cid}/move", {"toListId": list_id, "position": position, "version": version})


def member_role(who: Any, bid: str, uid: str) -> str | None:
    for m in _api(who).ok("GET", f"/api/boards/{bid}/members")["members"]:
        if m.get("userId") == uid:
            return m["role"]
    return None


def log_entries(who: Any, ws: str) -> list[dict[str, Any]]:
    return _api(who).ok("GET", f"/api/workspaces/{ws}/permission-log")["entries"]


def log_for(who: Any, ws: str, action: str, target_id: str, board_id: str | None = None) -> list[dict[str, Any]]:
    return [e for e in log_entries(who, ws) if e["action"] == action and e["target"]["id"] == target_id
            and (board_id is None or (e["board"] or {}).get("id") == board_id)]


def iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def pdf_bytes(size: int = 2048) -> bytes:
    return b"%PDF-1.4\n" + os.urandom(max(size - 9, 0))


def upload(who: Any, cid: str, filename: str, data: bytes, content_type: str) -> httpx.Response:
    api = _api(who)
    boundary = "kit" + uuid.uuid4().hex
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n").encode("utf-8")
    body = head + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return httpx.post(f"{api.base}/api/cards/{cid}/attachments", content=body, timeout=UPLOAD_S,
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **api.cookie()})


def disposition(name: str) -> str:
    if all(32 <= ord(c) <= 126 for c in name) and '"' not in name and "\\" not in name:
        return f'attachment; filename="{name}"'
    fallback = "".join("_" if ord(c) > 126 or c in '"\\' else c for c in name)
    keep = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&+-.^_`|~")
    encoded = "".join(chr(b) if chr(b) in keep else f"%{b:02X}" for b in name.encode("utf-8"))
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait(timeout=HTTP_S)
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, fn) for fn in calls]]


def _nap(seconds: float = POLL_GAP_S) -> None:
    threading.Event().wait(seconds)


def poll_api(fetch: Callable[[], Any], ready: Callable[[Any], bool], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ready(last):
            return last
        _nap()
    pytest.fail(f"{what}; last answer {last!r}")


def outage_url(var: str) -> str:
    value = os.environ.get(var)
    if not value:
        pytest.fail(f"{var} is not set; the outage instance is unavailable")
    return value.rstrip("/")


def assert_opaque(text: str, where_: str) -> None:
    forbidden: list[str] = [r"ECONNREFUSED", r"ENOTFOUND", r"ETIMEDOUT", r"node_modules", r"\bat \S+ \(.*:\d+:\d+\)",
                            r"redis://", r"rediss://", r"postgres://", r"postgresql://", r"127\.0\.0\.1:9(?!\d)",
                            r"DATABASE_URL", r"VALKEY_URL", r"S3_ENDPOINT", r"S3_BUCKET", r"S3_SECRET_ACCESS_KEY"]
    for var in ("DATABASE_URL", "VALKEY_URL", "S3_ENDPOINT"):
        parsed = urllib.parse.urlsplit(os.environ.get(var, ""))
        if parsed.hostname and parsed.port:
            forbidden.append(re.escape(f"{parsed.hostname}:{parsed.port}") + r"(?!\d)")
    for var in ("S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        if os.environ.get(var):
            forbidden.append(re.escape(os.environ[var]))
    for pattern in forbidden:
        assert not re.search(pattern, text), f"{where_} revealed {pattern!r}"


class EventStream:
    def __init__(self, base: str, token: str, board_id: str, worker: str | None = None):
        self.frames: list[tuple[int, str, str]] = []
        self.raw: list[str] = []
        self.done = threading.Event()
        self._cond = threading.Condition()
        for _ in range(WORKER_TRIES):
            client = httpx.Client(timeout=httpx.Timeout(HTTP_S, read=None))
            request = client.build_request("GET", f"{base}/api/boards/{board_id}/events",
                                           headers={"Cookie": f"{SESSION_COOKIE}={token}", "Accept": "text/event-stream"})
            resp = client.send(request, stream=True)
            if resp.status_code != 200 or worker is None or resp.headers.get("x-kinfold-worker") == worker:
                break
            resp.close()
            client.close()
        else:
            pytest.fail(f"no event stream was served by worker {worker}")
        assert resp.status_code == 200, f"event stream answered {resp.status_code}"
        self.worker = resp.headers.get("x-kinfold-worker")
        self._client, self._resp = client, resp
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        kind: str | None = None
        data: list[str] = []
        try:
            for line in self._resp.iter_lines():
                with self._cond:
                    self.raw.append(line)
                    if line == "":
                        if kind is not None:
                            self.frames.append((len(self.frames), kind, "\n".join(data)))
                        kind, data = None, []
                    elif line.startswith("event:"):
                        kind = line[6:].strip()
                    elif line.startswith("data:"):
                        value = line[5:]
                        data.append(value[1:] if value.startswith(" ") else value)
                    self._cond.notify_all()
        except Exception:
            pass
        finally:
            self.done.set()
            with self._cond:
                self._cond.notify_all()

    def mark(self) -> int:
        with self._cond:
            return len(self.frames)

    def _match(self, kind: str, pred: Callable[[Any], bool] | None, after: int) -> Any:
        for _, t, raw in self.frames[after:]:
            if t != kind:
                continue
            try:
                data = json.loads(raw) if raw else {}
                if pred is None or pred(data):
                    return data
            except (KeyError, TypeError, ValueError):
                continue
        return None

    def find(self, kind: str, pred: Callable[[Any], bool] | None = None, after: int = 0) -> Any:
        with self._cond:
            return self._match(kind, pred, after)

    def wait_for(self, kind: str, pred: Callable[[Any], bool] | None = None, *, after: int = 0,
                 seconds: float = LIVE_MS / 1000 + SLACK_S, what: str = "") -> Any:
        with self._cond:
            if not self._cond.wait_for(lambda: self._match(kind, pred, after) is not None, timeout=seconds):
                pytest.fail(f"no {kind} event arrived {what}; frames {[t for _, t, _ in self.frames]}")
            return self._match(kind, pred, after)

    def text_after(self, mark: int) -> str:
        with self._cond:
            return "\n".join(f"event: {t}\ndata: {d}" for _, t, d in self.frames[mark:])

    def close(self) -> None:
        for closer in (self._resp.close, self._client.close):
            try:
                closer()
            except Exception:
                pass


def stream_on(base: str, token: str, bid: str, worker: str) -> EventStream:
    return EventStream(base, token, bid, worker)


@contextmanager
def app_page(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    opened = open_app(browser, url, **options)
    if hasattr(opened, "__enter__"):
        with opened as page:
            yield page
    else:
        page = next(opened)
        try:
            yield page
        finally:
            opened.close()


@contextmanager
def ui(browser: Browser, base: str, who: Any, path: str, *, size: dict[str, int] = DESKTOP,
       reduced_motion: str = "no-preference") -> Iterator[Page]:
    email, password = creds(who)
    token = login(base, email, password)
    with app_page(browser, f"{base}/signin", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size)
        page.context.add_cookies([{"name": SESSION_COOKIE, "value": token, "url": base}])
        page.goto(f"{base}{path}")
        yield page


def eventually(page: Page, probe: Callable[[], Any], *, seconds: float = UI_S, what: str = "", step_ms: int = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            probe()
            return
        except (AssertionError, PlaywrightError) as err:
            last = err
        if step_ms:
            advance(page, step_ms)
    pytest.fail(f"{what or 'condition'} did not hold within {seconds}s: {str(last)[:400]}")


def _need(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def see(page: Page, loc: Locator, what: str) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=POLL_MS), what=what)


def gone(page: Page, loc: Locator, what: str) -> None:
    eventually(page, lambda: expect(loc).to_have_count(0, timeout=POLL_MS), what=what)


def live_see(page: Page, loc: Locator, what: str) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=POLL_MS), seconds=LIVE_MS / 1000 + SLACK_S, what=what, step_ms=0)


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Board announcements", exact=True)


def say(page: Page, text: str, step_ms: int = STEP_MS) -> None:
    eventually(page, lambda: expect(announcements(page)).to_contain_text(text, timeout=POLL_MS),
               what=f"announcement {text!r}", step_ms=step_ms)


def service_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Service status", exact=True)


def notices(page: Page) -> Locator:
    return page.get_by_role("region", name="Notices", exact=True)


def lst(page: Page, name: str) -> Locator:
    return page.get_by_role("region", name=name, exact=True)


def card_button(page: Page, title: str) -> Locator:
    return page.get_by_role("button", name=title, exact=True)


def item_of(page: Page, title: str) -> Locator:
    return page.get_by_role("listitem").filter(has=card_button(page, title)).last


def cards_text(n: int) -> re.Pattern[str]:
    return re.compile(r"(?<!\d)1 card(?!s)") if n == 1 else re.compile(rf"(?<!\d){n} cards")


def has_count(page: Page, list_name: str, n: int) -> None:
    eventually(page, lambda: expect(lst(page, list_name)).to_contain_text(cards_text(n), timeout=POLL_MS),
               what=f"{list_name} did not show {n} cards")


def drawer_open(page: Page, board_name: str, count: int) -> None:
    nav = page.get_by_role("navigation", name="Boards", exact=True)
    pattern = re.compile(re.escape(board_name) + r"\s*(\d+) open")

    def read() -> None:
        text = nav.first.inner_text(timeout=POLL_MS)
        found = pattern.search(text)
        assert found and int(found.group(1)) == count, f"drawer reads {text!r}; expected {count} open"

    eventually(page, read, what=f"drawer count for {board_name}")


def board_ready(page: Page, name: str) -> None:
    see(page, page.get_by_role("heading", level=2, name=name, exact=True), f"board {name} never opened")


def actions(page: Page, title: str, item: str) -> None:
    button = page.get_by_role("button", name=f"Actions for {title}", exact=True)
    eventually(page, lambda: _need(hit(button), f"Actions for {title} is covered"), what=f"Actions for {title} never clear")
    click(button)
    click(page.get_by_role("menu", name=f"Actions for {title}", exact=True).get_by_role("menuitem", name=item, exact=True))


SETTLE_JS = "() => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); })"


def press(page: Page, *keys: str) -> None:
    for i, key in enumerate(keys):
        page.keyboard.press(key)
        if i < len(keys) - 1:
            advance(page, STEP_MS)
            page.evaluate(SETTLE_JS)


def focused(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement"))


def where(page: Page) -> tuple[str, dict[str, list[str]]]:
    parsed = urllib.parse.urlsplit(page.url)
    return parsed.path, urllib.parse.parse_qs(parsed.query)


def ui_signin(page: Page, email: str, password: str) -> None:
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in", exact=True))
    eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"/signin"), timeout=POLL_MS), what="sign-in never left /signin")


def inside_viewport(page: Page, loc: Locator) -> None:
    box, size = loc.bounding_box(), page.viewport_size
    assert box and size, "the element has no box"
    assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= size["width"] and \
        box["y"] + box["height"] <= size["height"], f"{box} is outside {size}"


def hit(loc: Locator) -> bool:
    return bool(loc.evaluate("""(el) => { const r = el.getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!e && (e === el || el.contains(e)); }"""))


def sentence_lift(title: str, list_name: str, n: int, total: int) -> str:
    return f"Picked up {title} in {list_name}, position {n} of {total}. Use the arrow keys to move, Space to drop, Escape to cancel."


def sentence_over(title: str, list_name: str, n: int, total: int) -> str:
    return f"{title} is over {list_name}, position {n} of {total}."


def sentence_moved(title: str, list_name: str, n: int, total: int) -> str:
    return f"Moved {title} to {list_name}, position {n} of {total}."


def sentence_cancel(title: str, list_name: str, n: int, total: int) -> str:
    return f"Move cancelled. {title} is back in {list_name}, position {n} of {total}."


def sentence_remote(name: str, title: str, list_name: str, n: int, total: int) -> str:
    return f"{name} moved {title} to {list_name}, position {n} of {total}."


def sentence_stale(name: str, change: str, title: str, list_name: str, n: int, total: int) -> str:
    verb = "moved" if change == "moved" else "edited"
    return f"{name} {verb} {title} first. It's back in {list_name}, position {n} of {total}."


def sentence_search(count: int, query: str) -> str:
    if count > SEARCH_RESULT_CAP:
        return f'Showing 50 of {count} cards that match "{query}".'
    if count == 0:
        return f'No cards match "{query}".'
    if count == 1:
        return f'1 card matches "{query}".'
    return f'{count} cards match "{query}".'


def lists_in_view(page: Page, names: list[str]) -> list[str]:
    vw = (page.viewport_size or DESKTOP)["width"]
    out = []
    for n in names:
        reg = lst(page, n)
        if reg.count() == 0 or not reg.first.is_visible():
            continue
        box = reg.first.bounding_box()
        if box and box["width"] > 0 and box["x"] >= -1 and box["x"] + box["width"] <= vw + 1:
            out.append(n)
    return out


def assert_pair(page: Page, pair: list[str]) -> None:
    got = lists_in_view(page, LIST_ORDER)
    assert got == pair, f"lists in view {got}; expected {pair}"
    a, c = (lst(page, n).first.bounding_box() for n in pair)
    assert a and c and a["x"] < c["x"] and a["y"] < c["y"] + c["height"] and c["y"] < a["y"] + a["height"], "lists not side by side"


def _assert_address(page: Page, path: str, list_id: str | None) -> None:
    got_path, query = where(page)
    assert got_path == path, f"address {page.url}; expected {path}"
    assert query.get("list") == ([list_id] if list_id else None), f"address {page.url}; expected list={list_id}"


def _assert_count(page: Page, n: int) -> None:
    got = lists_in_view(page, LIST_ORDER)
    assert len(got) == n, f"lists in view {got}; expected {n}"


def test_health_and_page_routes(app_url: str) -> None:
    for base in (app_url, outage_url(STORAGE_DOWN_ENV), outage_url(LIVE_DOWN_ENV)):
        res = httpx.get(f"{base}/api/health", timeout=HTTP_S)
        assert res.status_code == 200 and res.json() == {"status": "ok"}, f"{base} health answered {res.status_code} {res.text[:100]}"
    for path in ("/signin", "/", f"/boards/{uuid.uuid4()}", f"/cards/{uuid.uuid4()}", f"/workspaces/{uuid.uuid4()}/permission-log"):
        res = httpx.get(f"{app_url}{path}", timeout=HTTP_S, follow_redirects=False)
        assert res.status_code == 200 and res.text.strip(), f"{path} answered {res.status_code}"


def test_two_workers(app_url: str) -> None:
    seen = set()
    for _ in range(WORKER_CONNECTIONS):
        res = httpx.get(f"{app_url}/api/health", headers={"Connection": "close"}, timeout=HTTP_S)
        seen.add(res.headers.get("x-kinfold-worker"))
    assert seen == {"1", "2"}, f"workers seen in {WORKER_CONNECTIONS} connections: {seen}"
    for path in ("/api/me", "/signin", "/api/nope-" + tag(), "/package.json"):
        res = httpx.get(f"{app_url}{path}", timeout=HTTP_S)
        assert res.headers.get("x-kinfold-worker") in {"1", "2"}, f"{path} carried no worker header"


def test_server_boundary(app_url: str) -> None:
    head, tail_ = '{"email":"ruth@kinfold.test","password":"x","pad":"', '"}'

    def sized(n: int) -> bytes:
        return (head + "a" * (n - len(head) - len(tail_)) + tail_).encode()

    json_type = {"Content-Type": "application/json"}
    big = httpx.post(f"{app_url}/api/session", content=sized(JSON_MAX + 1), headers=json_type, timeout=HTTP_S)
    assert big.status_code == 413 and big.json() == {"error": "too_large"}
    unauth = httpx.post(f"{app_url}/api/workspaces/{uuid.uuid4()}/boards", content=sized(JSON_MAX + 1), headers=json_type, timeout=HTTP_S)
    assert unauth.status_code == 413, "the size limit is checked after authentication"
    edge = httpx.post(f"{app_url}/api/session", content=sized(JSON_MAX), headers=json_type, timeout=HTTP_S)
    assert edge.status_code in (401, 422), f"a body of exactly {JSON_MAX} bytes answered {edge.status_code}"
    wrong = httpx.post(f"{app_url}/api/session", content=json.dumps({"email": RUTH[0], "password": RUTH[1]}),
                       headers={"Content-Type": "text/plain"}, timeout=HTTP_S)
    assert wrong.status_code == 415 and wrong.json() == {"error": "unsupported_media_type"}
    bad = httpx.post(f"{app_url}/api/session", content="{not json", headers=json_type, timeout=HTTP_S)
    assert bad.status_code == 422 and "body" in bad.json()["fields"]
    evil = {"Origin": "https://evil.example"}
    cross = httpx.post(f"{app_url}/api/session", json={"email": RUTH[0], "password": RUTH[1]}, headers=evil, timeout=HTTP_S)
    assert cross.status_code == 403 and cross.json() == {"error": "cross_origin"}
    assert cookie_header(cross) == "", "a cross-origin sign-in set a session"
    assert httpx.get(f"{app_url}/api/health", headers=evil, timeout=HTTP_S).status_code == 200
    r = ruth(app_url)
    ws = workspace(r, HALE)
    name = f"Zz cross {tag()}"
    refused = r.call("POST", f"/api/workspaces/{ws}/boards", {"name": name, "visibility": "private"}, headers=evil)
    assert refused.status_code == 403 and refused.json() == {"error": "cross_origin"}
    assert name not in [b["name"] for b in r.ok("GET", f"/api/workspaces/{ws}/boards")["boards"]], "a cross-origin write changed data"
    same = r.call("POST", f"/api/workspaces/{ws}/boards", {"name": name, "visibility": "private"}, headers={"Origin": app_url})
    assert same.status_code == 201, f"a same-origin write answered {same.status_code}"
    for response in (httpx.get(f"{app_url}/api/health", timeout=HTTP_S), httpx.get(f"{app_url}/signin", timeout=HTTP_S),
                     httpx.get(f"{app_url}/", timeout=HTTP_S), httpx.get(f"{app_url}/api/me", timeout=HTTP_S),
                     r.call("GET", "/api/me"), httpx.get(f"{app_url}/nothing-{tag()}", timeout=HTTP_S)):
        assert "no-store" in response.headers.get("cache-control", ""), f"{response.request.url.path} is cacheable"
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json",
                 "/src/server.ts", "/tsconfig.json", "/%2e%2e/package.json", "/assets/..%2f..%2frun.json"):
        res = httpx.get(f"{app_url}{path}", timeout=HTTP_S)
        assert res.status_code == 404, f"{path} answered {res.status_code}"


@pytest.mark.timeout(600)
def test_upload_limits(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, {"Documents": ["Insurance card scan"]})
    cid = b.cards["Insurance card scan"]
    exact = b"%PDF-1.4\n" + bytes(UPLOAD_MAX - 9)
    ok = upload(r, cid, f"edge-{tag()}.pdf", exact, "application/pdf")
    assert ok.status_code == 201 and ok.json()["attachment"]["size"] == UPLOAD_MAX, f"a file of {UPLOAD_MAX} bytes answered {ok.status_code}"
    over = upload(r, cid, f"over-{tag()}.pdf", exact + b"x", "application/pdf")
    assert over.status_code == 413 and over.json() == {"error": "too_large"}
    anonymous = upload(Api(app_url), cid, f"anon-{tag()}.pdf", exact + b"x", "application/pdf")
    assert anonymous.status_code == 413, "the upload limit is checked after authentication"
    assert len(S3().keys(f"attachments/{ws}/{cid}/")) == 1 and len(card(r, cid)["attachments"]) == 1


def test_concurrent_requests_stay_with_caller(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    make_board(r, ws, {"Inbox": ["Refill lisinopril"]}, members=[(p, "member")])
    g = grace(app_url)
    ng = workspace(g, NG)
    gid = me_id(g)
    make_board(g, ng, {"To do": ["Call Dr. Ito's office"]})
    calls: list[Callable[[], Any]] = []
    expectations: list[tuple[str, str]] = []
    for _ in range(REQUEST_ROUNDS):
        for api, uid, wid in ((p.api, p.user_id, ws), (g, gid, ng)):
            calls.append(lambda api=api: api.call("GET", "/api/me"))
            expectations.append(("me", uid))
            calls.append(lambda api=api, wid=wid: api.call("GET", f"/api/workspaces/{wid}/boards"))
            expectations.append(("boards", wid))
    p_boards = {b["id"] for b in p.api.ok("GET", f"/api/workspaces/{ws}/boards")["boards"]}
    g_boards = {b["id"] for b in g.ok("GET", f"/api/workspaces/{ng}/boards")["boards"]}
    assert p_boards and g_boards
    for res, (kind, key) in zip(together(calls), expectations):
        assert res.status_code == 200, f"{kind} answered {res.status_code}"
        if kind == "me":
            assert res.json()["userId"] == key, "a concurrent /api/me answered for the other caller"
        else:
            ids = {b["id"] for b in res.json()["boards"]}
            other = g_boards if key == ws else p_boards
            assert not ids & other, "a concurrent board list carried the other workspace's boards"


def test_workspace_people(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    t = tag()
    body = {"displayName": f"Wren Ashby {t}", "email": f"wren-{t}@kinfold.test", "phone": "+1 312 555 0199",
            "password": f"Starting-{t}-pw", "role": "member"}
    created = r.call("POST", f"/api/workspaces/{ws}/members", body)
    assert created.status_code == 201
    first = created.json()["member"]
    assert set(first) == {"userId", "displayName", "initials", "colour", "role", "email", "phone"}
    assert first["initials"] == "W" + t[0].upper() and first["role"] == "member" and first["colour"] in COLOURS
    second = r.ok("POST", f"/api/workspaces/{ws}/members", {**body, "displayName": f"Cher {t}", "email": f"cher-{t}@kinfold.test"}, status=201)["member"]
    assert second["colour"] == COLOURS[(COLOURS.index(first["colour"]) + 1) % len(COLOURS)], "colour did not follow the last added person"
    assert second["initials"] == "C" + t[0].upper()
    mine = Api(app_url, login(app_url, body["email"], body["password"]))
    assert [w["role"] for w in mine.ok("GET", "/api/me")["workspaces"] if w["id"] == ws] == ["member"]
    dup = r.call("POST", f"/api/workspaces/{ws}/members", body)
    assert dup.status_code == 409 and dup.json() == {"error": "email_taken"}
    for bad, field in (({"displayName": ""}, "displayName"), ({"displayName": "x" * 61}, "displayName"),
                       ({"password": "x" * (PASSWORD_MIN - 1)}, "password"), ({"role": "owner"}, "role"),
                       ({"phone": "1" * 31}, "phone"), ({"colour": "sage"}, "colour")):
        res = r.call("POST", f"/api/workspaces/{ws}/members", {**body, "email": f"x-{tag()}@kinfold.test", **bad})
        assert res.status_code == 422 and field in res.json()["fields"], f"{field} answered {res.status_code}"
    assert mine.call("POST", f"/api/workspaces/{ws}/members", {**body, "email": f"y-{tag()}@kinfold.test"}).status_code == 403
    assert grace(app_url).call("GET", f"/api/workspaces/{ws}/members").status_code == 404
    uid = first["userId"]
    promoted = r.call("PATCH", f"/api/workspaces/{ws}/members/{uid}", {"role": "admin"})
    assert promoted.status_code == 200 and promoted.json()["member"]["role"] == "admin"
    same = r.call("PATCH", f"/api/workspaces/{ws}/members/{uid}", {"role": "admin"})
    assert same.status_code == 409 and same.json() == {"error": "no_change"}
    assert r.call("PATCH", f"/api/workspaces/{ws}/members/{uid}", {"role": "owner"}).status_code == 422
    assert r.call("PATCH", f"/api/workspaces/{ws}/members/{uid}", {"role": "member"}).status_code == 200
    g = grace(app_url)
    ng = workspace(g, NG)
    gid = me_id(g)
    lone = g.call("PATCH", f"/api/workspaces/{ng}/members/{gid}", {"role": "member"})
    assert lone.status_code == 409 and lone.json() == {"error": "last_admin"}
    assert g.call("DELETE", f"/api/workspaces/{ng}/members/{gid}").json() == {"error": "last_admin"}
    assert [w["role"] for w in g.ok("GET", "/api/me")["workspaces"] if w["id"] == ng] == ["admin"]
    sole = add_person(app_url, r, ws, first="Sole")
    guarded = make_board(r, ws, {"Inbox": []}, members=[(sole, "admin")])
    r.ok("PATCH", f"/api/boards/{guarded.id}/members/{me_id(r)}", {"role": "member"})
    blocked = r.call("DELETE", f"/api/workspaces/{ws}/members/{sole.user_id}")
    assert blocked.status_code == 409 and blocked.json() == {"error": "last_admin"}
    assert member_role(r, guarded.id, sole.user_id) == "admin" and sole.api.call("GET", f"/api/workspaces/{ws}").status_code == 200
    assert r.call("DELETE", f"/api/workspaces/{ws}/members/{second['userId']}").status_code == 204
    assert second["userId"] not in {m["userId"] for m in r.ok("GET", f"/api/workspaces/{ws}/members")["members"]}
    assert mine.call("GET", f"/api/workspaces/{ws}").status_code == 200
    assert r.call("DELETE", f"/api/workspaces/{ws}/members/{second['userId']}").status_code == 404


def test_board_membership_changes(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    a, c = add_person(app_url, r, ws, first="Ada"), add_person(app_url, r, ws, first="Cora")
    b = make_board(r, ws, {"Inbox": []})
    cands = {x["userId"] for x in r.ok("GET", f"/api/boards/{b.id}/candidates")["people"]}
    assert a.user_id in cands and c.user_id in cands and rid not in cands and me_id(grace(app_url)) not in cands
    for call in (r.call("PATCH", f"/api/boards/{b.id}/members/{rid}", {"role": "member"}), r.call("DELETE", f"/api/boards/{b.id}/members/{rid}")):
        assert call.status_code == 409 and call.json() == {"error": "last_admin"}
    assert member_role(r, b.id, rid) == "admin"
    added = r.call("POST", f"/api/boards/{b.id}/members", {"userId": a.user_id, "role": "member"})
    assert added.status_code == 201
    assert set(added.json()["member"]) == {"displayName", "initials", "colour", "userId", "role", "phone", "email"}
    assert a.user_id not in {x["userId"] for x in r.ok("GET", f"/api/boards/{b.id}/candidates")["people"]}
    dup = r.call("POST", f"/api/boards/{b.id}/members", {"userId": a.user_id, "role": "observer"})
    assert dup.status_code == 409 and dup.json() == {"error": "already_member"}
    assert r.call("POST", f"/api/boards/{b.id}/members", {"userId": c.user_id, "role": "owner"}).status_code == 422
    assert "userId" in r.call("POST", f"/api/boards/{b.id}/members", {"role": "member"}).json()["fields"]
    for stranger in (me_id(grace(app_url)), str(uuid.uuid4())):
        res = r.call("POST", f"/api/boards/{b.id}/members", {"userId": stranger, "role": "member"})
        assert res.status_code == 404 and res.json() == {"error": "not_found"}
    assert r.call("PATCH", f"/api/boards/{b.id}/members/{a.user_id}", {"role": "admin"}).json()["member"]["role"] == "admin"
    same = r.call("PATCH", f"/api/boards/{b.id}/members/{a.user_id}", {"role": "admin"})
    assert same.status_code == 409 and same.json() == {"error": "no_change"}
    assert r.call("PATCH", f"/api/boards/{b.id}/members/{a.user_id}", {"role": "owner"}).status_code == 422
    assert r.call("PATCH", f"/api/boards/{b.id}/members/{rid}", {"role": "member"}).status_code == 200
    for call in (a.api.call("PATCH", f"/api/boards/{b.id}/members/{a.user_id}", {"role": "member"}), a.api.call("DELETE", f"/api/boards/{b.id}/members/{a.user_id}")):
        assert call.status_code == 409 and call.json() == {"error": "last_admin"}
    assert a.api.call("PATCH", f"/api/boards/{b.id}/members/{rid}", {"role": "admin"}).status_code == 200
    r.ok("POST", f"/api/boards/{b.id}/members", {"userId": c.user_id, "role": "member"}, status=201)
    assert c.api.call("POST", f"/api/boards/{b.id}/members", {"userId": a.user_id, "role": "member"}).status_code == 403
    assert c.api.call("PATCH", f"/api/boards/{b.id}/members/{a.user_id}", {"role": "member"}).status_code == 403
    assert c.api.call("DELETE", f"/api/boards/{b.id}/members/{a.user_id}").status_code == 403
    assert c.api.call("GET", f"/api/boards/{b.id}/candidates").status_code == 403
    rows = r.ok("GET", f"/api/boards/{b.id}/members")["members"]
    assert [m["displayName"] for m in rows] == sorted(m["displayName"] for m in rows)
    assert r.call("DELETE", f"/api/boards/{b.id}/members/{c.user_id}").status_code == 204
    again = r.call("DELETE", f"/api/boards/{b.id}/members/{c.user_id}")
    assert again.status_code == 409 and again.json() == {"error": "no_change"}
    assert c.user_id not in {m["userId"] for m in r.ok("GET", f"/api/boards/{b.id}/members")["members"]}
    assert c.user_id in {x["userId"] for x in r.ok("GET", f"/api/boards/{b.id}/candidates")["people"]}
    assert r.call("POST", f"/api/boards/{b.id}/members", {"userId": c.user_id, "role": "observer"}).status_code == 201
    assert member_role(r, b.id, c.user_id) == "observer"


def test_permission_log_entries(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    x = add_person(app_url, r, ws, first="Xena")
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril"]})
    cid = b.cards["Refill lisinopril"]
    r.ok("POST", f"/api/boards/{b.id}/members", {"userId": x.user_id, "role": "member"}, status=201)
    r.ok("PUT", f"/api/cards/{cid}/private-members", {"userIds": [rid, x.user_id]})
    r.ok("PUT", f"/api/cards/{cid}/private-members", {"userIds": []})
    r.ok("PATCH", f"/api/boards/{b.id}/members/{x.user_id}", {"role": "observer"})
    r.ok("PATCH", f"/api/boards/{b.id}", {"visibility": "workspace"})
    count_before = len(log_entries(r, ws))
    assert r.call("PATCH", f"/api/boards/{b.id}/members/{x.user_id}", {"role": "observer"}).status_code == 409
    assert r.call("PATCH", f"/api/boards/{b.id}", {"visibility": "private", "workspaceId": ws}).status_code == 422
    assert r.call("PATCH", f"/api/boards/{b.id}", {}).status_code == 422
    assert len(log_entries(r, ws)) == count_before, "a refused change wrote a log entry"
    r.ok("DELETE", f"/api/boards/{b.id}/members/{x.user_id}", status=204)
    r.ok("PATCH", f"/api/workspaces/{ws}/members/{x.user_id}", {"role": "admin"})
    r.ok("PATCH", f"/api/workspaces/{ws}/members/{x.user_id}", {"role": "member"})
    entries = log_entries(r, ws)
    assert all(set(e) == ENTRY_KEYS for e in entries[:20])
    assert [iso(e["at"]) for e in entries] == sorted((iso(e["at"]) for e in entries), reverse=True), "log is not newest first"
    actor = {"userId": rid, "displayName": RUTH[2]}

    def only(action: str, target: str, board: str | None = None) -> list[dict[str, Any]]:
        return [e for e in entries if e["action"] == action and e["target"]["id"] == target and (board is None or (e["board"] or {}).get("id") == board)]

    added = only("workspace.member_added", x.user_id)
    assert len(added) == 1 and added[0]["actor"] == actor and added[0]["board"] is None
    assert added[0]["before"] is None and added[0]["after"] == "member" and added[0]["target"]["type"] == "user"
    assert added[0]["target"]["label"] == x.name
    creator = only("board.member_added", rid, b.id)
    assert len(creator) == 1 and creator[0]["before"] == "none" and creator[0]["after"] == "admin"
    assert creator[0]["board"] == {"id": b.id, "name": b.name}
    joined = only("board.member_added", x.user_id, b.id)
    assert len(joined) == 1 and joined[0]["before"] == "none" and joined[0]["after"] == "member"
    private = only("card.private_members_changed", cid)
    assert len(private) == 2 and private[0]["target"]["type"] == "card" and private[0]["target"]["label"] == "Refill lisinopril"
    assert private[1]["before"] == [] and private[1]["after"] == sorted([RUTH[2], x.name])
    assert private[0]["before"] == sorted([RUTH[2], x.name]) and private[0]["after"] == []
    role = only("board.role_changed", x.user_id, b.id)
    assert len(role) == 1 and (role[0]["before"], role[0]["after"]) == ("member", "observer")
    vis = only("board.visibility_changed", b.id)
    assert len(vis) == 1 and (vis[0]["before"], vis[0]["after"]) == ("private", "workspace")
    assert vis[0]["target"]["type"] == "board" and vis[0]["target"]["label"] == b.name
    removed = only("board.member_removed", x.user_id, b.id)
    assert len(removed) == 1 and removed[0]["after"] == "removed"
    wsroles = only("workspace.role_changed", x.user_id)
    assert {(e["before"], e["after"]) for e in wsroles} == {("member", "admin"), ("admin", "member")} and len(wsroles) == 2
    assert x.api.call("GET", f"/api/workspaces/{ws}/permission-log").status_code == 403
    assert x.api.call("GET", f"/api/workspaces/{ws}/permission-log/{added[0]['id']}").status_code == 403
    assert grace(app_url).call("GET", f"/api/workspaces/{ws}/permission-log").status_code == 404
    single = r.ok("GET", f"/api/workspaces/{ws}/permission-log/{added[0]['id']}")
    assert single == {"entry": added[0]}
    assert r.call("GET", f"/api/workspaces/{ws}/permission-log/{uuid.uuid4()}").status_code == 404
    for path in (f"/api/workspaces/{ws}/permission-log", f"/api/workspaces/{ws}/permission-log/{added[0]['id']}"):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            res = r.call(method, path, {} if method != "DELETE" else None)
            assert res.status_code == 405 and "GET" in res.headers.get("allow", ""), f"{method} {path} answered {res.status_code}"
    assert only("workspace.member_added", x.user_id)[0] == added[0], "an entry was altered"
    y = add_person(app_url, r, ws, first="Yara")
    b2 = make_board(r, ws, {"Inbox": []}, members=[(y, "member")])
    b3 = make_board(r, ws, {"Inbox": []}, members=[(y, "observer")])
    r.ok("DELETE", f"/api/workspaces/{ws}/members/{y.user_id}", status=204)
    entries = log_entries(r, ws)
    gone_ws = only("workspace.member_removed", y.user_id)
    assert len(gone_ws) == 1 and gone_ws[0]["after"] is None and gone_ws[0]["board"] is None
    for board in (b2, b3):
        left = only("board.member_removed", y.user_id, board.id)
        assert len(left) == 1 and left[0]["after"] == "removed", f"removal logged {len(left)} entries for a board"


def test_wf_organiser_setup_create_board(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    name = f"Paperwork for Mum {tag()}"
    with ui(browser, app_url, RUTH, "/") as page:
        see(page, page.get_by_role("heading", level=1, name=PARENT, exact=True), "masthead missing")
        board_ready(page, "Weekly care")
        assert where(page)[0].startswith("/boards/")
        click(page.get_by_role("button", name="New board", exact=True))
        dlg = page.get_by_role("dialog", name="New board", exact=True)
        see(page, dlg, "New board dialog never opened")
        expect(dlg.get_by_role("radio", name="Only board members", exact=True)).to_be_checked()
        fill(dlg.get_by_role("textbox", name="Board name", exact=True), name)
        start = where(page)[0]
        with held(page, "**/api/workspaces/*/boards") as hold:
            click(dlg.get_by_role("button", name="Create board", exact=True))
            see(page, page.get_by_role("button", name="Creating…", exact=True), "pending copy missing")
            hold.release()
        eventually(page, lambda: _need(re.fullmatch(r"/boards/[^/?]+", where(page)[0]) and where(page)[0] != start,
                                       f"address is {page.url}"), what="did not land on the new board")
        bid = where(page)[0].rsplit("/", 1)[1]
        assert bid != "" and not re.search(r"weekly", name, re.I)
        board_ready(page, name)
        expect(page.get_by_role("link", name=name, exact=True)).to_have_attribute("aria-current", "page")
        see(page, page.get_by_text(NO_LISTS, exact=True), "no-lists-yet copy missing")
        add_list = page.get_by_role("button", name="Add a list", exact=True)
        eventually(page, lambda: expect(add_list).to_be_focused(timeout=POLL_MS), what="focus not on Add a list")
        page.reload()
        board_ready(page, name)
        see(page, page.get_by_text(NO_LISTS, exact=True), "reload lost the no-lists-yet copy")
        click(add_list)
        field = page.get_by_role("textbox", name="New list name", exact=True)
        fill(field, "Paperwork")
        field.press("Enter")
        eventually(page, lambda: expect(page.get_by_role("button", name="Add a card to Paperwork", exact=True)).to_be_focused(timeout=POLL_MS),
                   what="focus not on the new list's add-card button")
        board = r.ok("GET", f"/api/boards/{bid}")
        assert board["board"]["visibility"] == "private" and [l["name"] for l in board["lists"]] == ["Paperwork"]
        created = [e for e in log_entries(r, ws) if (e["board"] or {}).get("id") == bid and e["action"] == "board.member_added"]
        assert len(created) == 1 and created[0]["after"] == "admin" and created[0]["actor"]["displayName"] == RUTH[2]
        r.ok("POST", f"/api/boards/{bid}/members", {"userId": s.user_id, "role": "member"}, status=201)
        with ui(browser, app_url, s, f"/boards/{bid}") as watcher:
            board_ready(watcher, name)
            title = f"Collect blood pressure cuff {tag()}"
            click(page.get_by_role("button", name="Add a card to Paperwork", exact=True))
            fill(page.get_by_role("textbox", name="New card title", exact=True), title)
            page.keyboard.press("Enter")
            say(page, f"Added {title} to Paperwork.")
            live_see(watcher, card_button(watcher, title), "the new card did not reach the member's open board")
            has_count(watcher, "Paperwork", 1)


def test_wf_organiser_setup_members(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    theo = add_person(app_url, r, ws, first="Theo")
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril"]})
    patches: list[str] = []
    with ui(browser, app_url, RUTH, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        page.on("request", lambda q: patches.append(q.post_data or "") if q.method == "PATCH" and "/members/" in q.url else None)
        click(page.get_by_role("button", name="Board settings", exact=True))
        dlg = page.get_by_role("dialog", name="Board settings", exact=True)
        see(page, dlg, "Board settings never opened")
        select(dlg.get_by_role("combobox", name="Add a person", exact=True), theo.name)
        click(dlg.get_by_role("button", name="Add to board", exact=True))
        role_button = dlg.get_by_role("button", name=f"Role for {theo.name}", exact=True)
        see(page, role_button, "Theo's row never appeared")
        assert member_role(r, b.id, theo.user_id) == "member", "new people must join as Member"
        click(role_button)
        click(page.get_by_role("menu", name=f"Role for {theo.name}", exact=True).get_by_role("menuitemradio", name="Observer", exact=True))
        poll_api(lambda: member_role(r, b.id, theo.user_id), lambda v: v == "observer", UI_S, "the role change never reached the server")
        eventually(page, lambda: _need(patches and all(set(json.loads(body)) == {"role"} for body in patches),
                                       f"role change sent {patches}"), what="the role-only PATCH")
        click(dlg.get_by_role("button", name=f"Role for {RUTH[2]}", exact=True))
        click(page.get_by_role("menu", name=f"Role for {RUTH[2]}", exact=True).get_by_role("menuitemradio", name="Member", exact=True))
        eventually(page, lambda: expect(dlg.get_by_role("alert")).to_contain_text("A board needs at least one admin.", timeout=POLL_MS),
                   what="last-admin alert missing")
        assert member_role(r, b.id, rid) == "admin"
        click(dlg.get_by_role("radio", name="Everyone in this workspace", exact=True))
        poll_api(lambda: r.ok("GET", f"/api/boards/{b.id}")["board"]["visibility"], lambda v: v == "workspace", UI_S, "visibility change never saved")
    actions_logged = {e["action"] for e in log_entries(r, ws) if (e["board"] or {}).get("id") == b.id}
    assert {"board.member_added", "board.role_changed", "board.visibility_changed"} <= actions_logged


def test_wf_organiser_setup_permission_log(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    b = make_board(r, ws, {"Inbox": []}, members=[(s, "member")])
    r.ok("PATCH", f"/api/boards/{b.id}/members/{s.user_id}", {"role": "observer"})
    with ui(browser, app_url, RUTH, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        click(page.get_by_role("button", name="Account", exact=True))
        click(page.get_by_role("menu", name="Account", exact=True).get_by_role("menuitem", name="Permission log", exact=True))
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/workspaces/{ws}/permission-log$"), timeout=POLL_MS), what="log address wrong")
        see(page, page.get_by_role("heading", level=1, name="Permission log", exact=True), "log heading missing")
        table = page.get_by_role("table", name="Permission log", exact=True)
        for column in ("When", "Who", "What", "Target", "Before", "After"):
            expect(table.get_by_role("columnheader", name=column, exact=True)).to_be_visible()
        rows = table.get_by_role("row").filter(has_text=s.name)
        eventually(page, lambda: expect(rows.first).to_be_visible(timeout=POLL_MS), what="Sam's entries missing")
        expect(rows.first).to_contain_text(RUTH[2])
    with ui(browser, app_url, s, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        click(page.get_by_role("button", name="Account", exact=True))
        see(page, page.get_by_role("menuitem", name="Sign out", exact=True), "Account menu never opened")
        expect(page.get_by_role("menuitem", name="Permission log", exact=True)).to_have_count(0)


def test_unknown_request_keys(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    ng = workspace(grace(app_url), NG)
    p, q = add_person(app_url, r, ws), add_person(app_url, r, ws)
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril", "Book podiatry follow-up"], "Pharmacy": []}, members=[(p, "member")])
    cid, lid, other = b.cards["Refill lisinopril"], b.lists["Inbox"], b.lists["Pharmacy"]
    item = r.ok("POST", f"/api/cards/{cid}/checklist", {"text": "Lunch and fluids"}, status=201)["item"]["id"]
    st = EventStream(app_url, r.token or "", b.id)
    sentinel = f"Sentinel {tag()}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": sentinel})
    st.wait_for("card.updated", lambda d: d["card"]["title"] == sentinel)
    mark = st.mark()
    log_before = len(log_entries(r, ws))
    members_before = len(r.ok("GET", f"/api/workspaces/{ws}/members")["members"])
    cases: list[tuple[Api, str, str, dict[str, Any], str]] = [
        (r, "POST", "/api/session", {"email": RUTH[0], "password": RUTH[1]}, "role"),
        (p.api, "POST", "/api/account/password", {"currentPassword": "x", "newPassword": "y" * PASSWORD_MIN}, "email"),
        (r, "PATCH", f"/api/workspaces/{ws}", {"timeZone": "America/Chicago"}, "parentName"),
        (r, "POST", f"/api/workspaces/{ws}/members", {"displayName": "Zed", "email": f"zed-{tag()}@kinfold.test", "password": "Starting-pw-12345", "role": "member"}, "userId"),
        (r, "PATCH", f"/api/workspaces/{ws}/members/{p.user_id}", {"role": "admin"}, "email"),
        (r, "POST", f"/api/workspaces/{ws}/boards", {"name": "Zz extra", "visibility": "private"}, "workspaceId"),
        (r, "PATCH", f"/api/boards/{b.id}", {"name": "Renamed " + tag()}, "workspaceId"),
        (r, "POST", f"/api/boards/{b.id}/members", {"userId": q.user_id, "role": "member"}, "id"),
        (r, "PATCH", f"/api/boards/{b.id}/members/{p.user_id}", {"role": "observer"}, "userId"),
        (r, "POST", f"/api/boards/{b.id}/lists", {"name": "Extra list"}, "position"),
        (r, "PATCH", f"/api/lists/{lid}", {"name": "Renamed list"}, "boardId"),
        (r, "POST", f"/api/lists/{lid}/cards", {"title": "Extra card"}, "version"),
        (r, "PATCH", f"/api/cards/{cid}", {"version": 2, "title": "Extra"}, "position"),
        (r, "PATCH", f"/api/cards/{cid}", {"version": 2, "title": "Extra"}, "listId"),
        (r, "PATCH", f"/api/cards/{cid}", {"version": 2, "title": "Extra"}, "status"),
        (r, "POST", f"/api/cards/{cid}/move", {"toListId": other, "position": 1, "version": 2}, "title"),
        (r, "POST", f"/api/cards/{cid}/status", {"status": "done", "version": 2}, "position"),
        (r, "PUT", f"/api/cards/{cid}/private-members", {"userIds": [rid, p.user_id]}, "notes"),
        (r, "POST", f"/api/cards/{cid}/checklist", {"text": "Extra item"}, "done"),
        (r, "PATCH", f"/api/checklist-items/{item}", {"done": True}, "cardId"),
    ]
    for api, method, path, body, extra in cases:
        res = api.call(method, path, {**body, extra: ng})
        assert res.status_code == 422, f"{method} {path} +{extra} answered {res.status_code}: {res.text[:200]}"
        assert res.json()["error"] == "validation" and extra in res.json()["fields"], f"{method} {path} did not name {extra}"
    for path in (f"/api/boards/{b.id}", f"/api/checklist-items/{item}"):
        res = r.call("PATCH", path, {})
        assert res.status_code == 422 and "body" in res.json()["fields"], f"PATCH {path} with no keys answered {res.status_code}"
    res = r.call("PATCH", f"/api/cards/{cid}", {"version": 2})
    assert res.status_code == 422 and "body" in res.json()["fields"]
    after = card(r, cid)
    assert after["version"] == 2 and after["title"] == sentinel and after["status"] == "open" and after["listId"] == lid
    assert r.ok("GET", f"/api/boards/{b.id}")["board"]["name"] == b.name and set(titles_in(r, b.id)) == {"Inbox", "Pharmacy"}
    assert member_role(r, b.id, p.user_id) == "member" and member_role(r, b.id, q.user_id) is None
    assert after["checklist"] == [{"id": item, "text": "Lunch and fluids", "done": False}] and after["isPrivate"] is False
    assert len(log_entries(r, ws)) == log_before, "a refused request wrote a log entry"
    assert len(r.ok("GET", f"/api/workspaces/{ws}/members")["members"]) == members_before
    final = f"Final {tag()}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 2, "title": final})
    st.wait_for("card.updated", lambda d: d["card"]["title"] == final, after=mark)
    seen = [t for _, t, _ in st.frames[mark:]]
    assert seen == ["card.updated"], f"refused requests broadcast {seen}"
    st.close()


def test_safe_return_path(app_url: str) -> None:
    ok_paths = ["/boards/abc?list=def", "/", "/cards/" + "a" * 20, "/" + "a" * 1999]
    bad_paths = ["/" * 2 + "evil.example", "/\\evil.example", "https://evil.example/x", "/a\\b", "/a\x01b", "/a\x7fb", "/a\nb",
                 "/" + "a" * 2000, "javascript:alert(1)", "evil.example", ""]
    first = httpx.post(f"{app_url}/api/session", json={"email": RUTH[0], "password": RUTH[1]}, timeout=HTTP_S)
    assert first.status_code == 200
    cookie = cookie_header(first)
    assert re.search("HttpOnly", cookie, re.I) and re.search("SameSite=Lax", cookie, re.I), cookie
    user = first.json()["user"]
    assert user == {"userId": user["userId"], "displayName": RUTH[2], "initials": "RH", "colour": "sage"}
    assert first.json()["redirectTo"] == "/"
    for path in ok_paths:
        res = httpx.post(f"{app_url}/api/session", json={"email": RUTH[0], "password": RUTH[1], "next": path}, timeout=HTTP_S)
        assert res.status_code == 200 and res.json()["redirectTo"] == path, f"{path[:30]!r} gave {res.json().get('redirectTo', '')[:30]!r}"
    for path in bad_paths:
        res = httpx.post(f"{app_url}/api/session", json={"email": RUTH[0], "password": RUTH[1], "next": path}, timeout=HTTP_S)
        assert res.status_code == 200 and res.json()["redirectTo"] == "/", f"{path[:30]!r} was followed to {res.json().get('redirectTo', '')[:30]!r}"
    wrong = httpx.post(f"{app_url}/api/session", json={"email": RUTH[0], "password": "wrong-" + tag()}, timeout=HTTP_S)
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"} and cookie_header(wrong) == ""
    missing = httpx.post(f"{app_url}/api/session", json={"password": "x"}, timeout=HTTP_S)
    assert missing.status_code == 422 and "email" in missing.json()["fields"]
    one, two = Api(app_url, login(app_url, RUTH[0], RUTH[1])), Api(app_url, login(app_url, RUTH[0], RUTH[1]))
    me = one.ok("GET", "/api/me")
    assert set(me) == {"userId", "displayName", "initials", "colour", "email", "workspaces"} and me["email"] == RUTH[0]
    hale = next(w for w in me["workspaces"] if w["name"] == HALE)
    assert set(hale) == {"id", "name", "parentName", "timeZone", "role"} and hale["role"] == "admin" and hale["parentName"] == PARENT
    assert one.call("DELETE", "/api/session").status_code == 204
    gone_ = one.call("GET", "/api/me")
    assert gone_.status_code == 401 and gone_.json() == {"error": "signed_out"}
    assert two.call("GET", "/api/me").status_code == 200, "sign-out ended another session"
    anonymous = httpx.get(f"{app_url}/api/me", timeout=HTTP_S)
    assert anonymous.status_code == 401 and anonymous.json() == {"error": "signed_out"}


def test_password_change_ends_other_sessions(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril"]}, members=[(p, "member")])
    second = Api(app_url, login(app_url, p.email, p.password))
    third = Api(app_url, login(app_url, p.email, p.password))
    st = EventStream(app_url, third.token or "", b.id)
    new_pw = f"Changed-{tag()}-pw"
    wrong = second.call("POST", "/api/account/password", {"currentPassword": "nope-" + tag(), "newPassword": new_pw})
    assert wrong.status_code == 422 and "currentPassword" in wrong.json()["fields"]
    for short_long in ("x" * (PASSWORD_MIN - 1), "x" * (PASSWORD_MAX + 1)):
        res = second.call("POST", "/api/account/password", {"currentPassword": p.password, "newPassword": short_long})
        assert res.status_code == 422 and "newPassword" in res.json()["fields"]
    assert p.api.call("GET", "/api/me").status_code == 200 and third.call("GET", "/api/me").status_code == 200, "a refusal ended sessions"
    changed = second.call("POST", "/api/account/password", {"currentPassword": p.password, "newPassword": new_pw})
    assert changed.status_code == 200 and changed.json() == {"signedOutSessions": 2}
    assert second.call("GET", "/api/me").status_code == 200, "the calling session was ended"
    for dead in (p.api, third):
        res = dead.call("GET", "/api/me")
        assert res.status_code == 401 and res.json() == {"error": "signed_out"}
    st.wait_for("session.ended", what="after the password change")
    assert st.done.wait(LIVE_MS / 1000 + SLACK_S), "the stream stayed open after session.ended"
    old = httpx.post(f"{app_url}/api/session", json={"email": p.email, "password": p.password}, timeout=HTTP_S)
    assert old.status_code == 401 and old.json() == {"error": "invalid_credentials"}
    fresh = Api(app_url, login(app_url, p.email, new_pw))
    short = "a" * PASSWORD_MIN
    assert fresh.call("POST", "/api/account/password", {"currentPassword": new_pw, "newPassword": short}).status_code == 200
    longest = "b" * PASSWORD_MAX
    assert fresh.call("POST", "/api/account/password", {"currentPassword": short, "newPassword": longest}).status_code == 200
    assert login(app_url, p.email, longest)


def test_next_request_new_rights(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s, k, w = add_person(app_url, r, ws), add_person(app_url, r, ws), add_person(app_url, r, ws)
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril"]}, visibility="workspace", members=[(s, "member"), (k, "member")])
    lid = b.lists["Inbox"]
    first = f"First {tag()}"
    assert s.api.call("POST", f"/api/lists/{lid}/cards", {"title": first}).status_code == 201
    r.ok("PATCH", f"/api/boards/{b.id}/members/{s.user_id}", {"role": "observer"})
    second = f"Second {tag()}"
    res = s.api.call("POST", f"/api/lists/{lid}/cards", {"title": second})
    assert res.status_code == 403 and res.json() == {"error": "forbidden"}
    assert second not in titles_in(r, b.id)["Inbox"]
    r.ok("PATCH", f"/api/boards/{b.id}/members/{s.user_id}", {"role": "member"})
    assert s.api.call("POST", f"/api/lists/{lid}/cards", {"title": second}).status_code == 201
    r.ok("DELETE", f"/api/boards/{b.id}/members/{s.user_id}", status=204)
    for call in (s.api.call("GET", f"/api/boards/{b.id}"), s.api.call("POST", f"/api/lists/{lid}/cards", {"title": "Third"})):
        assert call.status_code == 404 and call.json() == {"error": "not_found"}
    r.ok("PATCH", f"/api/boards/{b.id}", {"visibility": "private"})
    assert w.api.call("GET", f"/api/boards/{b.id}").status_code == 404, "an implicit observer kept access to a private board"
    assert k.api.call("GET", f"/api/boards/{b.id}").status_code == 200
    r.ok("PATCH", f"/api/boards/{b.id}", {"visibility": "workspace"})
    assert w.api.call("GET", f"/api/boards/{b.id}").json()["role"] == "observer"
    assert k.api.call("DELETE", "/api/session").status_code == 204
    out = k.api.call("GET", f"/api/boards/{b.id}")
    assert out.status_code == 401 and out.json() == {"error": "signed_out"}
    r.ok("DELETE", f"/api/workspaces/{ws}/members/{w.user_id}", status=204)
    for call in (w.api.call("GET", f"/api/boards/{b.id}"), w.api.call("GET", f"/api/workspaces/{ws}")):
        assert call.status_code == 404 and call.json() == {"error": "not_found"}


def test_wf_ending_access_return_path(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    b = make_board(r, ws, FIVE, members=[(s, "member")])
    cid, title = b.cards["Ride to cardiology on Thursday"], b.titles["Ride to cardiology on Thursday"]
    new_pw = f"Changed-{tag()}-pw"
    with ui(browser, app_url, s, f"/cards/{cid}") as page:
        see(page, page.get_by_role("dialog", name=title, exact=True), "card dialog never opened")
        other = Api(app_url, login(app_url, s.email, s.password))
        res = other.call("POST", "/api/account/password", {"currentPassword": s.password, "newPassword": new_pw})
        assert res.status_code == 200 and res.json()["signedOutSessions"] >= 1
        try:
            page.reload()
        except PlaywrightError:
            pass
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=POLL_MS), what="no redirect to sign-in with next")
        assert where(page)[1]["next"] == [f"/cards/{cid}"] and urllib.parse.quote(f"/cards/{cid}", safe="") in page.url, page.url
        ui_signin(page, s.email, new_pw)
        eventually(page, lambda: expect(page).to_have_url(re.compile(rf"/cards/{cid}$"), timeout=POLL_MS), what="sign-in did not follow next")
        see(page, page.get_by_role("dialog", name=title, exact=True), "the card was not reopened")
    with app_page(browser, f"{app_url}/signin?next={urllib.parse.quote('https://evil.example/x', safe='')}") as page:
        page.set_viewport_size(DESKTOP)
        ui_signin(page, s.email, new_pw)
        eventually(page, lambda: _need(same_origin(page.url, app_url) and where(page)[0].startswith("/boards/"), f"landed on {page.url}"),
                   what="an off-site next did not land on the home route")


def test_wf_ending_access_open_board(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s, d = add_person(app_url, r, ws, first="Sam"), add_person(app_url, r, ws, first="Dolores")
    b = make_board(r, ws, FIVE, visibility="workspace", members=[(s, "member"), (d, "observer")])
    cid, title = b.cards["Dental cleaning"], b.titles["Dental cleaning"]
    draft = f"Draft {tag()}"
    window = LIVE_MS / 1000 + SLACK_S
    with ui(browser, app_url, s, f"/cards/{cid}", size=PHONE) as sam, ui(browser, app_url, d, f"/boards/{b.id}", size=TABLET) as dol:
        dlg = sam.get_by_role("dialog", name=title, exact=True)
        see(sam, dlg, "Sam's card dialog never opened")
        fill(dlg.get_by_role("textbox", name="Notes", exact=True), draft)
        board_ready(dol, b.name)
        r.ok("PATCH", f"/api/boards/{b.id}/members/{s.user_id}", {"role": "observer"})
        eventually(sam, lambda: expect(notices(sam)).to_contain_text("Your access to this board is now Observer.", timeout=POLL_MS),
                   seconds=window, what="access notice missing", step_ms=0)
        eventually(sam, lambda: expect(dlg.get_by_role("textbox", name="Title")).to_have_count(0, timeout=POLL_MS),
                   seconds=window, what="the dialog stayed editable", step_ms=0)
        for control in ("Notes", "Save changes", "Delete card"):
            expect(dlg.get_by_role("textbox", name=control).or_(dlg.get_by_role("button", name=control))).to_have_count(0)
        expect(dlg).not_to_contain_text(draft)
        assert r.call("DELETE", f"/api/boards/{b.id}/members/{d.user_id}").status_code == 204
        eventually(dol, lambda: expect(dol.get_by_role("heading", name=BOARD_GONE, exact=True)).to_be_visible(timeout=POLL_MS),
                   seconds=window, what="Dolores's board did not become not-found", step_ms=0)
        see(dol, dol.get_by_text(BOARD_GONE_BODY, exact=True), "not-found body missing")
        expect(dol.get_by_role("heading", level=2, name=b.name, exact=True)).to_have_count(0)
    assert set(card(s.api, cid)) == OBSERVER_CARD_KEYS and d.api.call("GET", f"/api/boards/{b.id}").status_code == 404
    role = log_for(r, ws, "board.role_changed", s.user_id, b.id)
    assert len(role) == 1 and (role[0]["before"], role[0]["after"]) == ("member", "observer")
    assert log_for(r, ws, "board.member_removed", d.user_id, b.id)[0]["after"] == "removed"


def test_effective_board_access(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    obs, mem, adm, none, gone_ = (add_person(app_url, r, ws, first=n) for n in ("Obs", "Mem", "Adm", "Non", "Rem"))
    outsider = grace(app_url)
    boards = {}
    for visibility in ("workspace", "private"):
        b = make_board(r, ws, {"Inbox": ["Refill lisinopril"]}, visibility=visibility,
                       members=[(obs, "observer"), (mem, "member"), (adm, "admin"), (gone_, "member")])
        r.ok("DELETE", f"/api/boards/{b.id}/members/{gone_.user_id}", status=204)
        boards[visibility] = b
    expected = {"workspace": {obs: "observer", mem: "member", adm: "admin", none: "observer", gone_: None},
                "private": {obs: "observer", mem: "member", adm: "admin", none: None, gone_: None}}
    for visibility, b in boards.items():
        for person, role in expected[visibility].items():
            res = person.api.call("GET", f"/api/boards/{b.id}")
            if role is None:
                assert res.status_code == 404 and res.json() == {"error": "not_found"}, f"{visibility}: {person.name} got {res.status_code}"
            else:
                assert res.status_code == 200 and res.json()["role"] == role, f"{visibility}: {person.name} got {res.text[:100]}"
            listed = {x["id"]: x for x in person.api.ok("GET", f"/api/workspaces/{ws}/boards")["boards"]}
            assert (b.id in listed) == (role is not None)
            if role is not None:
                assert listed[b.id]["role"] == role and set(listed[b.id]) == {"id", "name", "visibility", "role", "openCards"}
        assert outsider.call("GET", f"/api/boards/{b.id}").status_code == 404
    b = boards["workspace"]
    lid = b.lists["Inbox"]
    assert obs.api.call("POST", f"/api/lists/{lid}/cards", {"title": "x"}).status_code == 403
    assert none.api.call("POST", f"/api/lists/{lid}/cards", {"title": "x"}).status_code == 403
    assert mem.api.call("POST", f"/api/lists/{lid}/cards", {"title": f"Member card {tag()}"}).status_code == 201
    assert mem.api.call("PATCH", f"/api/boards/{b.id}", {"name": "Renamed " + tag()}).status_code == 403
    assert mem.api.call("DELETE", f"/api/cards/{b.cards['Refill lisinopril']}").status_code == 403
    assert adm.api.call("PATCH", f"/api/boards/{b.id}", {"name": b.name + " v2"}).status_code == 200
    assert none.api.call("GET", f"/api/boards/{b.id}/archived").status_code == 403
    assert r.call("DELETE", f"/api/boards/{b.id}/members/{none.user_id}").status_code == 204, "removing an implicit observer must work"
    assert none.api.call("GET", f"/api/boards/{b.id}").status_code == 404
    assert r.call("POST", f"/api/boards/{b.id}/members", {"userId": none.user_id, "role": "observer"}).status_code == 201
    assert none.api.call("GET", f"/api/boards/{b.id}").json()["role"] == "observer"
    assert r.call("POST", f"/api/boards/{b.id}/members", {"userId": gone_.user_id, "role": "member"}).status_code == 201
    assert gone_.api.call("GET", f"/api/boards/{b.id}").json()["role"] == "member"


def test_hidden_answers_like_missing(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    x, n = add_person(app_url, r, ws), add_person(app_url, r, ws)
    b = make_board(r, ws, {"Inbox": ["Memory clinic results", "Refill lisinopril"]}, members=[(n, "member")])
    secret = b.cards["Memory clinic results"]
    lid = b.lists["Inbox"]
    r.ok("PUT", f"/api/cards/{secret}/private-members", {"userIds": [rid]})
    att = upload(r, secret, f"hidden-{tag()}.pdf", pdf_bytes(), "application/pdf").json()["attachment"]["id"]
    ref = r.call("GET", f"/api/cards/{uuid.uuid4()}")
    assert ref.status_code == 404 and ref.json() == {"error": "not_found"}
    g = grace(app_url)
    ng = workspace(g, NG)
    gb = make_board(g, ng, {"To do": ["Call Dr. Ito's office"]})
    gcard, glist = gb.cards["Call Dr. Ito's office"], gb.lists["To do"]
    missing = str(uuid.uuid4())
    probes: list[tuple[Api, str, str, Any]] = [
        (x.api, "GET", f"/api/boards/{b.id}", None), (x.api, "GET", f"/api/boards/{b.id}/members", None),
        (x.api, "GET", f"/api/boards/{b.id}/candidates", None), (x.api, "GET", f"/api/boards/{b.id}/archived", None),
        (x.api, "GET", f"/api/boards/{b.id}/events", None),
        (x.api, "POST", f"/api/boards/{b.id}/lists", {"name": "x"}), (x.api, "PATCH", f"/api/lists/{lid}", {"name": "y"}),
        (x.api, "POST", f"/api/lists/{lid}/cards", {"title": "z"}), (x.api, "GET", f"/api/cards/{secret}", None),
        (n.api, "GET", f"/api/cards/{secret}", None),
        (n.api, "PATCH", f"/api/cards/{secret}", {"version": 1, "title": "z"}),
        (n.api, "POST", f"/api/cards/{secret}/move", {"toListId": lid, "position": 1, "version": 1}),
        (n.api, "POST", f"/api/cards/{secret}/status", {"status": "done", "version": 1}),
        (n.api, "PUT", f"/api/cards/{secret}/private-members", {"userIds": [n.user_id]}),
        (n.api, "POST", f"/api/cards/{secret}/checklist", {"text": "x"}),
        (n.api, "DELETE", f"/api/cards/{secret}", None), (n.api, "GET", f"/api/attachments/{att}", None),
        (n.api, "DELETE", f"/api/attachments/{att}", None),
        (r, "GET", f"/api/boards/{gb.id}", None), (r, "GET", f"/api/cards/{gcard}", None),
        (r, "GET", f"/api/workspaces/{ng}", None), (r, "GET", f"/api/workspaces/{ng}/boards", None),
        (r, "PATCH", f"/api/lists/{glist}", {"name": "q"}),
        (r, "POST", f"/api/boards/{b.id}/members", {"userId": me_id(g), "role": "member"}),
        (r, "PATCH", f"/api/cards/{b.cards['Refill lisinopril']}", {"version": 1, "ownerUserId": me_id(g)}),
        (r, "PUT", f"/api/cards/{b.cards['Refill lisinopril']}/private-members", {"userIds": [rid, me_id(g)]}),
        (r, "POST", f"/api/cards/{b.cards['Refill lisinopril']}/move", {"toListId": glist, "position": 1, "version": 1}),
    ]
    for api, method, path, body in probes:
        res = api.call(method, path, body)
        assert res.status_code == 404 and res.content == ref.content, f"{method} {path} answered {res.status_code} {res.text[:80]}"
    assert upload(n, secret, f"x-{tag()}.pdf", pdf_bytes(), "application/pdf").content == ref.content
    assert n.api.call("GET", f"/api/cards/{b.cards['Refill lisinopril']}").status_code == 200
    listed = x.api.ok("GET", f"/api/workspaces/{ws}/boards")["boards"]
    assert b.id not in {y["id"] for y in listed} and b.name not in json.dumps(listed)
    found = x.api.call("GET", f"/api/workspaces/{ws}/search?q=Memory%20clinic%20results")
    assert b.name not in found.text and "Memory clinic results" not in found.text
    assert missing not in ref.text


def test_private_cards(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    pr, sam, obs, out = (add_person(app_url, r, ws, first=f) for f in ("Pri", "Sam", "Obs", "Out"))
    t = tag()
    b = make_board(r, ws, {"Inbox": [f"One {t}", f"Two {t}", f"Three {t}"]}, visibility="workspace",
                   members=[(pr, "member"), (sam, "member"), (obs, "observer")])
    c1, c2, c3 = (b.cards[f"{k} {t}"] for k in ("One", "Two", "Three"))
    res = r.call("PUT", f"/api/cards/{c2}/private-members", {"userIds": [rid, pr.user_id]})
    assert res.status_code == 200 and res.json()["card"]["isPrivate"] is True
    assert [m["displayName"] for m in res.json()["card"]["privateMembers"]] == sorted([RUTH[2], pr.name])
    for who in (sam, obs):
        assert titles_in(who, b.id)["Inbox"] == [f"One {t}", f"Three {t}"]
        assert [c["position"] for c in view(who, b.id)["lists"][0]["cards"]] == [1, 2]
        assert view(who, b.id)["lists"][0]["count"] == 2
        assert who.api.call("GET", f"/api/cards/{c2}").status_code == 404
    assert board_open(sam, ws, b.id) == board_open(r, ws, b.id) - 1
    assert card(r, c3)["position"] == 3 and card(sam, c3)["position"] == 2
    q = f"Two {t}"
    assert r.ok("GET", f"/api/workspaces/{ws}/search?q={urllib.parse.quote(q)}")["total"] == 1
    assert pr.api.ok("GET", f"/api/workspaces/{ws}/search?q={urllib.parse.quote(q)}")["total"] == 1
    assert sam.api.ok("GET", f"/api/workspaces/{ws}/search?q={urllib.parse.quote(q)}")["total"] == 0
    assert sam.api.call("PUT", f"/api/cards/{c2}/private-members", {"userIds": [sam.user_id]}).status_code == 404
    assert move(sam, c1, b.lists["Inbox"], 2, 1).status_code == 200
    assert titles_in(sam, b.id)["Inbox"] == [f"Three {t}", f"One {t}"]
    assert_dense(r, b.id, "Ruth")
    for body, code, field in (({"userIds": [pr.user_id]}, 422, "userIds"), ({"userIds": [rid, obs.user_id]}, 422, "userIds"),
                              ({"userIds": [rid, out.user_id]}, 422, "userIds"), ({"userIds": "x"}, 422, "userIds")):
        res = r.call("PUT", f"/api/cards/{c2}/private-members", body)
        assert res.status_code == code and field in res.json()["fields"], f"{body} answered {res.status_code}"
    assert r.call("PUT", f"/api/cards/{c2}/private-members", {"userIds": [rid, me_id(grace(app_url))]}).status_code == 404
    same = r.call("PUT", f"/api/cards/{c2}/private-members", {"userIds": [rid, pr.user_id]})
    assert same.status_code == 409 and same.json() == {"error": "no_change"}
    r.ok("POST", f"/api/cards/{c2}/status", {"status": "archived", "version": 1})
    assert c2 not in {c["id"] for c in sam.api.ok("GET", f"/api/boards/{b.id}/archived")["cards"]}
    assert c2 in {c["id"] for c in pr.api.ok("GET", f"/api/boards/{b.id}/archived")["cards"]}
    r.ok("PATCH", f"/api/boards/{b.id}/members/{pr.user_id}", {"role": "observer"})
    assert pr.api.call("GET", f"/api/cards/{c2}").status_code == 404, "a demoted member still sees the private card"
    r.ok("PUT", f"/api/cards/{c3}/private-members", {"userIds": [rid]})
    r.ok("PUT", f"/api/cards/{c3}/private-members", {"userIds": []})
    shared = card(sam, c3)
    assert shared["isPrivate"] is False and shared["privateMembers"] == []


def test_wf_privacy_not_found_pages(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    n = add_person(app_url, r, ws, first="Nan")
    x = add_person(app_url, r, ws, first="Xan")
    t = tag()
    b = make_board(r, ws, {"Inbox": [f"Memory clinic results {t}", "Refill lisinopril"]}, members=[(n, "member")])
    secret = b.cards[f"Memory clinic results {t}"]
    r.ok("PUT", f"/api/cards/{secret}/private-members", {"userIds": [me_id(r)]})
    with ui(browser, app_url, x, f"/boards/{b.id}") as page:
        see(page, page.get_by_role("heading", name=BOARD_GONE, exact=True), "board not-found heading missing")
        see(page, page.get_by_text(BOARD_GONE_BODY, exact=True), "board not-found body missing")
        expect(page.get_by_role("heading", level=1, name=PARENT, exact=True)).to_be_visible()
        assert b.name not in page.content()
        expect(page.get_by_role("link", name=b.name, exact=True)).to_have_count(0)
    with ui(browser, app_url, n, f"/cards/{secret}") as page:
        see(page, page.get_by_role("heading", name=CARD_GONE, exact=True), "card not-found heading missing")
        see(page, page.get_by_text(CARD_GONE_BODY, exact=True), "card not-found body missing")
        assert f"Memory clinic results {t}" not in page.content()
        page.goto(f"{app_url}/cards/{uuid.uuid4()}")
        see(page, page.get_by_role("heading", name=CARD_GONE, exact=True), "missing card heading differs")
        see(page, page.get_by_text(CARD_GONE_BODY, exact=True), "missing card body differs")


def test_wf_privacy_private_card_live(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    t = tag()
    secret = f"Dental cleaning {t}"
    b = make_board(r, ws, {"Appointments": [secret, "Dental cleaning"], "Inbox": ["Refill lisinopril"]},
                   visibility="workspace", members=[(s, "member")])
    with ui(browser, app_url, RUTH, f"/boards/{b.id}") as rp, ui(browser, app_url, s, f"/boards/{b.id}") as sp:
        board_ready(rp, b.name)
        board_ready(sp, b.name)
        has_count(sp, "Appointments", 2)
        drawer_open(sp, b.name, 3)
        r.ok("PUT", f"/api/cards/{b.cards[secret]}/private-members", {"userIds": [me_id(r)]})
        eventually(sp, lambda: expect(card_button(sp, secret)).to_have_count(0, timeout=POLL_MS),
                   seconds=LIVE_MS / 1000 + SLACK_S, what="the card stayed on Sam's board", step_ms=0)
        has_count(sp, "Appointments", 1)
        drawer_open(sp, b.name, 2)
        live_see(rp, item_of(rp, secret).get_by_role("img", name="Private card", exact=True), "lock missing")
        has_count(rp, "Appointments", 2)
        fill(sp.get_by_role("searchbox", name="Search this workspace", exact=True), secret)
        advance(sp, SEARCH_SETTLE_MS + STEP_MS)
        eventually(sp, lambda: expect(sp.get_by_role("status", name="Search results status", exact=True)).to_have_text(
            sentence_search(0, secret), timeout=POLL_MS), what="Sam's search found the hidden card")


def test_hidden_cards_never_reach_copies(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    s = add_person(app_url, r, ws, first="Sam", role="admin")
    pr = add_person(app_url, r, ws, first="Pri")
    t = tag()
    title = f"Renew home insurance {t}"
    b = make_board(r, ws, {"Bills": [f"Pay premium {t}", title]}, members=[(s, "member"), (pr, "member")])
    cid = b.cards[title]
    st, sp = EventStream(app_url, s.api.token or "", b.id), EventStream(app_url, pr.api.token or "", b.id)
    mark = st.mark()
    r.ok("PUT", f"/api/cards/{cid}/private-members", {"userIds": [rid, pr.user_id]})
    removed = st.wait_for("card.removed", lambda d: d["cardId"] == cid)
    assert set(removed) == {"cardId", "counts"}
    sp.wait_for("card.updated", lambda d: d["card"]["id"] == cid)
    secret = f"Hidden rename {t}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": secret, "notes": f"hidden notes {t}"})
    pr.api.ok("POST", f"/api/cards/{cid}/checklist", {"text": f"hidden item {t}"}, status=201)
    visible = r.ok("POST", f"/api/lists/{b.lists['Bills']}/cards", {"title": f"Visible after {t}"}, status=201)["card"]["id"]
    st.wait_for("card.created", lambda d: d["card"]["id"] == visible)
    text = st.text_after(mark)
    assert secret not in text and f"hidden notes {t}" not in text and f"hidden item {t}" not in text
    assert st.find("card.updated", lambda d: d["card"]["id"] == cid, mark) is None
    ref = s.api.call("GET", f"/api/cards/{uuid.uuid4()}")
    for res in (move(s, cid, b.lists["Bills"], 1, 1), s.api.call("PATCH", f"/api/cards/{cid}", {"version": 1, "title": "x"}),
                s.api.call("POST", f"/api/cards/{cid}/status", {"status": "done", "version": 1}),
                s.api.call("POST", f"/api/cards/{cid}/checklist", {"text": "x"}),
                upload(s, cid, f"x-{tag()}.pdf", pdf_bytes(), "application/pdf")):
        assert res.status_code == 404 and res.content == ref.content
    mine = [e for e in log_entries(s, ws) if e["target"]["id"] == cid]
    assert len(mine) == 1 and mine[0]["target"]["label"] == "Private card" and mine[0]["board"]["name"] == b.name
    labels = [e["target"]["label"] for e in log_entries(r, ws) if e["target"]["id"] == cid]
    assert labels in ([secret], [title]), f"Ruth's label {labels}"
    r.ok("DELETE", f"/api/boards/{b.id}/members/{s.user_id}", status=204)
    log = s.api.call("GET", f"/api/workspaces/{ws}/permission-log")
    ours = [e for e in log.json()["entries"] if (e["board"] or {}).get("id") == b.id]
    assert ours and all(e["board"]["name"] == "Private board" for e in ours)
    assert b.name not in log.text and secret not in log.text
    assert s.api.ok("GET", f"/api/workspaces/{ws}/search?q={t}")["total"] == 0
    st.close()
    sp.close()


def test_wf_privacy_write_meets_hidden_card(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam", role="admin")
    t = tag()
    first, title = f"Pay Medicare Part B premium {t}", f"Renew home insurance {t}"
    b = make_board(r, ws, {"Bills": [first, title], "House": ["Fix the back step railing"]}, members=[(s, "member")])
    cid = b.cards[title]
    with ui(browser, app_url, s, f"/boards/{b.id}", size=PHONE) as page:
        board_ready(page, b.name)
        with held(page, "**/api/cards/*/move") as hold:
            card_button(page, title).focus()
            press(page, "Space", "ArrowUp", "Space")
            r.ok("PUT", f"/api/cards/{cid}/private-members", {"userIds": [me_id(r)]})
            hold.release()
        sentence = f"{title} is no longer shared with you."
        eventually(page, lambda: expect(notices(page)).to_contain_text(sentence, timeout=POLL_MS), what="no-longer-shared notice missing")
        say(page, sentence)
        gone(page, card_button(page, title), "the hidden card stayed on Sam's board")
        click(page.get_by_role("button", name="Account", exact=True))
        click(page.get_by_role("menu", name="Account", exact=True).get_by_role("menuitem", name="Permission log", exact=True))
        table = page.get_by_role("table", name="Permission log", exact=True)
        eventually(page, lambda: expect(table).to_contain_text("Private card", timeout=POLL_MS), what="Private card label missing")
    assert card(r, cid)["version"] == 1 and titles_in(r, b.id)["Bills"] == [first, title], "the interrupted move was applied"


def test_role_shaped_payloads(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    phone = "+1 312 555 " + str(uuid.uuid4().int)[:4]
    m = add_person(app_url, r, ws, first="Mara", phone=phone)
    o = add_person(app_url, r, ws, first="Olin")
    t, nt = tag(), tag()
    b = make_board(r, ws, {"Inbox": [f"Refill {t}"]}, visibility="workspace", members=[(m, "member"), (o, "observer")])
    cid = b.cards[f"Refill {t}"]
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "notes": f"Private note {nt}", "labels": ["Medication"], "ownerUserId": m.user_id})
    r.ok("POST", f"/api/cards/{cid}/checklist", {"text": "Lunch and fluids"}, status=201)
    att = upload(r, cid, f"scan-{t}.pdf", pdf_bytes(), "application/pdf").json()["attachment"]
    ob = card(o, cid)
    assert set(ob) == OBSERVER_CARD_KEYS and set(ob["owner"]) == {"displayName", "initials", "colour"}
    assert set(ob["checklist"][0]) == {"id", "text", "done"}
    for who in (m, r):
        full = card(who, cid)
        assert set(full) == MEMBER_CARD_KEYS and set(full["owner"]) == {"displayName", "initials", "colour", "userId"}
        assert set(full["attachments"][0]) == ATTACHMENT_KEYS and full["attachments"][0]["uploadedBy"] == {"displayName": RUTH[2]}
    assert f"Private note {nt}" not in o.api.call("GET", f"/api/cards/{cid}").text and att["filename"] not in o.api.call("GET", f"/api/boards/{b.id}").text
    ov = view(o, b.id)
    assert set(ov) == {"board", "role", "lists"} and set(ov["board"]) == {"id", "name", "visibility", "workspaceId", "parentName"}
    assert set(ov["lists"][0]) == {"id", "name", "count", "cards"} and set(ov["lists"][0]["cards"][0]) == OBSERVER_CARD_KEYS
    assert set(view(m, b.id)["lists"][0]["cards"][0]) == MEMBER_CARD_KEYS
    keys = lambda who: {frozenset(x) for x in _api(who).ok("GET", f"/api/boards/{b.id}/members")["members"]}
    assert keys(o) == {frozenset({"displayName", "initials", "colour"})}
    assert keys(m) == {frozenset({"displayName", "initials", "colour", "userId", "role", "phone"})}
    assert keys(r) == {frozenset({"displayName", "initials", "colour", "userId", "role", "phone", "email"})}
    assert phone not in o.api.call("GET", f"/api/boards/{b.id}/members").text
    people = lambda who: {frozenset(x) for x in _api(who).ok("GET", f"/api/workspaces/{ws}/members")["members"]}
    assert people(o) == {frozenset({"displayName", "initials", "colour"})}
    assert people(r) == {frozenset({"displayName", "initials", "colour", "userId", "role", "email", "phone"})}
    assert phone not in o.api.call("GET", f"/api/workspaces/{ws}/members").text
    found = m.api.ok("GET", f"/api/workspaces/{ws}/search?q={nt}")
    assert found["total"] == 1 and set(found) == {"results", "total"}
    assert set(found["results"][0]) == {"cardId", "boardId", "boardName", "listName", "title"}
    assert o.api.ok("GET", f"/api/workspaces/{ws}/search?q={nt}")["total"] == 0, "observer search matched notes"
    for res in (o.api.call("GET", f"/api/attachments/{att['id']}"), upload(o, cid, f"o-{tag()}.pdf", pdf_bytes(), "application/pdf")):
        assert res.status_code == 404


def test_wf_aide_visit_sign_out(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    d = add_person(app_url, r, ws, first="Dolores")
    b = make_board(r, ws, FIVE, visibility="workspace", members=[(d, "observer")])
    cid, title = b.cards["Move metformin to mail order"], b.titles["Move metformin to mail order"]
    token = tag()
    note = f"Discuss results with Mum {token}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "notes": note})
    responses: list[Any] = []
    with ui(browser, app_url, RUTH, f"/cards/{cid}", size=TABLET, reduced_motion="reduce") as page:
        page.on("response", lambda resp: responses.append(resp) if same_origin(resp.url, app_url) and (
            "/api/" in resp.url or resp.request.resource_type == "document") else None)
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "card dialog never opened")
        expect(dlg.get_by_role("textbox", name="Notes", exact=True)).to_have_value(note)
        page.keyboard.press("Escape")
        box = page.get_by_role("searchbox", name="Search this workspace", exact=True)
        fill(box, token)
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        status = page.get_by_role("status", name="Search results status", exact=True)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(1, token), timeout=POLL_MS), what="search never settled")
        old_cookie = next(c["value"] for c in page.context.cookies() if c["name"] == SESSION_COOKIE)
        click(page.get_by_role("button", name="Account", exact=True))
        click(page.get_by_role("menu", name="Account").get_by_role("menuitem", name="Sign out", exact=True))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/signin$"), timeout=POLL_MS), what="sign out did not go to /signin without next")
        expect(page.get_by_text(SIGNED_OUT, exact=True)).to_have_count(0)
        page.go_back()
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/signin$"), timeout=POLL_MS), what="Back after sign-out did not return to /signin")
        html = page.content()
        assert note not in html and b.name not in html and title not in html, "Back showed Ruth's data"
        ui_signin(page, d.email, d.password)
        page.goto(f"{app_url}/boards/{b.id}")
        board_ready(page, b.name)
        expect(page.get_by_role("searchbox", name="Search this workspace", exact=True)).to_have_value("")
        expect(page.get_by_role("status", name="Search results status", exact=True)).to_have_text("")
        expect(page.get_by_role("dialog")).to_have_count(0)
        assert note not in page.content(), "the next person saw Ruth's notes"
    bad = [x.url for x in responses if "no-store" not in (x.headers.get("cache-control") or "")]
    assert responses and not bad, f"responses without no-store: {bad[:5]}"
    gone_me = Api(app_url, old_cookie).call("GET", "/api/me")
    assert gone_me.status_code == 401 and gone_me.json() == {"error": "signed_out"}


def test_wf_aide_visit_read_only(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    phone_no = "+1 312 555 " + str(uuid.uuid4().int)[:4]
    m = add_person(app_url, r, ws, phone=phone_no)
    d = add_person(app_url, r, ws, first="Dolores")
    b = make_board(r, ws, FIVE, visibility="workspace", members=[(m, "member"), (d, "observer")])
    priv = r.ok("POST", f"/api/lists/{b.lists['Appointments']}/cards", {"title": f"Memory clinic results {tag()}"}, status=201)["card"]
    r.ok("PUT", f"/api/cards/{priv['id']}/private-members", {"userIds": [me_id(r), m.user_id]})
    cid, title = b.cards["Tuesday visit"], b.titles["Tuesday visit"]
    note = f"Discuss results with Mum before telling Sam {tag()}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "notes": note, "ownerUserId": m.user_id})
    items = ["Lunch and fluids", "Evening pills set out", "Short walk to the mailbox"]
    for it in items:
        r.ok("POST", f"/api/cards/{cid}/checklist", {"text": it}, status=201)
    fname = f"care-plan-{tag()}.pdf"
    assert upload(r, cid, fname, pdf_bytes(), "application/pdf").status_code == 201
    with ui(browser, app_url, d, f"/boards/{b.id}", size=TABLET) as page:
        board_ready(page, b.name)
        click(page.get_by_role("tab", name="Aide visits", exact=True))
        eventually(page, lambda: assert_pair(page, ["Aide visits", "Waiting on others"]), what="tablet pair wrong")
        drawer_open(page, b.name, 10)
        click(card_button(page, title))
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "observer card dialog never opened")
        eventually(page, lambda: expect(dlg.get_by_role("button", name="Close", exact=True)).to_be_focused(timeout=POLL_MS),
                   what="observer dialog did not focus Close")
        group = dlg.get_by_role("group", name="Checklist", exact=True)
        for it in items:
            expect(group.get_by_role("checkbox", name=it, exact=True)).to_be_disabled()
        for loc in (dlg.get_by_role("textbox", name="Notes"), dlg.get_by_role("button", name="Attach a file"),
                    dlg.get_by_role("group", name="Who can see this card"), dlg.get_by_role("list", name="Attachments"),
                    dlg.get_by_role("button", name="Delete card"), dlg.get_by_role("button", name="Save changes")):
            expect(loc).to_have_count(0)
        html = page.content()
        for secret in (note, phone_no, fname, priv["title"]):
            assert secret not in html, f"the observer's page carried {secret!r}"
    assert board_open(d.api, ws, b.id) == 10
    assert set(card(d.api, cid)) == OBSERVER_CARD_KEYS


def test_wf_aide_visit_reduced_motion(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    d = add_person(app_url, r, ws, first="Dolores")
    b = make_board(r, ws, FIVE, visibility="workspace", members=[(d, "observer")])
    cid, title = b.cards["Friday visit"], b.titles["Friday visit"]
    with ui(browser, app_url, d, f"/boards/{b.id}", size=TABLET, reduced_motion="reduce") as page:
        board_ready(page, b.name)
        click(page.get_by_role("tab", name="Aide visits", exact=True))
        see(page, lst(page, "Aide visits").get_by_role("button", name=title, exact=True), "Friday visit not shown")
        assert move(r, cid, b.lists["Waiting on others"], 1, 1).status_code == 200
        landed = lst(page, "Waiting on others").get_by_role("button", name=title, exact=True)
        live_see(page, landed, "remote move never arrived")
        item = item_of(page, title)
        chip = item.get_by_role("img", name=f"Moved by {RUTH[2]}", exact=True)
        expect(chip).to_be_visible()
        expect(chip).to_have_text("RH")
        assert animations(item) == [], f"reduced motion still animated the card: {animations(item)}"
        assert item.evaluate(OUTLINE_JS), "no still outline on the moved card"
        say(page, sentence_remote(RUTH[2], title, "Waiting on others", 1, 1), step_ms=0)
        advance(page, CHIP_MS - STEP_MS)
        expect(chip).to_be_visible(timeout=POLL_MS)
        advance(page, CHIP_GONE_MS - CHIP_MS + STEP_MS)
        expect(chip).to_have_count(0, timeout=UI_MS)


def test_wf_attachments_upload_download(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws)
    b = make_board(r, ws, {"Documents": ["Insurance card scan"]})
    cid, title = b.cards["Insurance card scan"], b.titles["Insurance card scan"]
    fname = 'Entlassung Müller "final".pdf'
    data = pdf_bytes(8192)
    prefix = f"attachments/{ws}/{cid}/"
    with ui(browser, app_url, RUTH, f"/cards/{cid}") as page:
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "card dialog never opened")
        with held(page, "**/api/cards/*/attachments") as hold:
            with page.expect_file_chooser() as fc:
                click(dlg.get_by_role("button", name="Attach a file", exact=True))
            fc.value.set_files({"name": fname, "mimeType": "application/pdf", "buffer": data})
            eventually(page, lambda: expect(dlg).to_contain_text(f"Uploading {fname}…", timeout=POLL_MS), what="no uploading row")
            expect(dlg.get_by_role("link", name=fname, exact=True)).to_have_count(0)
            assert S3().keys(prefix) == [], "an object existed before the upload reached the app"
            hold.release()
        link = dlg.get_by_role("list", name="Attachments", exact=True).get_by_role("link", name=fname, exact=True)
        see(page, link, "the confirmed attachment never became a link")
        say(page, f"Attached {fname}.")
        with page.expect_download() as dl:
            click(link)
        assert dl.value.suggested_filename in (fname, fname.replace('"', "_")), dl.value.suggested_filename
        assert Path(dl.value.path()).read_bytes() == data, "the UI download returned different bytes"
    atts = card(r, cid)["attachments"]
    assert len(atts) == 1 and atts[0]["filename"] == fname and atts[0]["contentType"] == "application/pdf"
    assert atts[0]["size"] == len(data) and atts[0]["uploadedBy"] == {"displayName": RUTH[2]}
    got = r.call("GET", f"/api/attachments/{atts[0]['id']}")
    assert got.status_code == 200 and got.content == data
    assert got.headers["content-type"].startswith("application/pdf")
    assert got.headers["content-length"] == str(len(data))
    assert got.headers.get("x-content-type-options") == "nosniff"
    assert got.headers.get("content-disposition") == (
        "attachment; filename=\"Entlassung M_ller _final_.pdf\"; filename*=UTF-8''Entlassung%20M%C3%BCller%20%22final%22.pdf")
    assert S3().get(f"{prefix}{atts[0]['id']}") == data
    assert_opaque(json.dumps(card(r, cid)), "card payload")
    assert s.api.call("GET", f"/api/attachments/{atts[0]['id']}").status_code == 404


def test_wf_attachments_mismatch(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, {"Documents": ["Insurance card scan"]})
    cid, title = b.cards["Insurance card scan"], b.titles["Insurance card scan"]
    prefix = f"attachments/{ws}/{cid}/"
    fname = f"Discharge photo {tag()}.pdf"
    with ui(browser, app_url, RUTH, f"/cards/{cid}") as page:
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "card dialog never opened")
        with page.expect_file_chooser() as fc:
            click(dlg.get_by_role("button", name="Attach a file", exact=True))
        fc.value.set_files({"name": fname, "mimeType": "application/pdf", "buffer": PNG_SIG + os.urandom(512)})
        eventually(page, lambda: expect(dlg).to_contain_text(f"{fname} isn't a PDF, JPEG or PNG.", timeout=POLL_MS),
                   what="type mismatch copy missing")
        expect(dlg.get_by_role("link", name=fname, exact=True)).to_have_count(0)
    for name, data, ctype, status in (
            (f"x-{tag()}.png", JPEG_SIG + os.urandom(64), "image/png", 415),
            (f"x-{tag()}.txt", pdf_bytes(), "text/plain", 415),
            (f"x\x01{tag()}.pdf", pdf_bytes(), "application/pdf", 422),
            ("a" * (FILENAME_MAX_CP + 1), pdf_bytes(), "application/pdf", 422)):
        res = upload(r, cid, name, data, ctype)
        assert res.status_code == status, f"{name[:20]!r} as {ctype} answered {res.status_code}"
        if status == 415:
            assert res.json() == {"error": "unsupported_media_type"}
        else:
            assert "file" in res.json()["fields"]
    assert S3().keys(prefix) == [] and card(r, cid)["attachments"] == [], "a refused upload stored something"
    for name, data, ctype in ((f"scan-{tag()}.png", PNG_SIG + os.urandom(64), "image/png"),
                              (f"Müller scan é {tag()}.jpg", JPEG_SIG + os.urandom(64), "image/jpeg")):
        res = upload(r, cid, name, data, ctype)
        assert res.status_code == 201, f"{name!r} answered {res.status_code}"
        att = res.json()["attachment"]
        assert att["filename"] == name
        got = r.call("GET", f"/api/attachments/{att['id']}")
        assert got.content == data and got.headers.get("x-content-type-options") == "nosniff"
        assert got.headers.get("content-disposition") == disposition(name)


def test_attachment_only_after_confirm(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, {"Documents": ["Insurance card scan", "Talk to an estate agent"]})
    cid = b.cards["Insurance card scan"]
    data = pdf_bytes(5000)
    res = upload(r, cid, f"sheet-{tag()}.pdf", data, "application/pdf")
    assert res.status_code == 201
    att = res.json()["attachment"]
    assert set(att) == ATTACHMENT_KEYS and att["size"] == len(data)
    assert S3().get(f"attachments/{ws}/{cid}/{att['id']}") == data
    assert [a["id"] for a in card(r, cid)["attachments"]] == [att["id"]]
    arch = b.cards["Talk to an estate agent"]
    r.ok("POST", f"/api/cards/{arch}/status", {"status": "archived", "version": 1})
    archived = upload(r, arch, f"late-{tag()}.pdf", data, "application/pdf")
    assert archived.status_code == 409 and archived.json() == {"error": "archived"}
    url = outage_url(STORAGE_DOWN_ENV)
    dr = ruth(url)
    dws = workspace(dr, HALE)
    db = make_board(dr, dws, {"Documents": ["Insurance card scan"]})
    dcid = db.cards["Insurance card scan"]
    down = upload(dr, dcid, f"sheet-{tag()}.pdf", data, "application/pdf")
    assert down.status_code == 503 and down.json() == {"error": "storage_unavailable"}
    assert card(dr, dcid)["attachments"] == [], "a failed upload shows as attached"


def test_delete_removes_objects(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    m = add_person(app_url, r, ws)
    b = make_board(r, ws, {"Documents": ["Insurance card scan", "Pay Medicare Part B premium"]}, members=[(m, "member")])
    c1, c2 = b.cards["Insurance card scan"], b.cards["Pay Medicare Part B premium"]
    a1, a2, a3 = (upload(r, c, f"f-{tag()}.pdf", pdf_bytes(), "application/pdf").json()["attachment"]["id"] for c in (c1, c1, c2))
    assert m.api.call("DELETE", f"/api/attachments/{a1}").status_code == 204
    assert f"attachments/{ws}/{c1}/{a1}" not in S3().keys(f"attachments/{ws}/{c1}/")
    assert f"attachments/{ws}/{c1}/{a2}" in S3().keys(f"attachments/{ws}/{c1}/")
    assert r.call("GET", f"/api/attachments/{a1}").status_code == 404
    assert [a["id"] for a in card(r, c1)["attachments"]] == [a2]
    denied = m.api.call("DELETE", f"/api/cards/{c2}")
    assert denied.status_code == 403 and S3().keys(f"attachments/{ws}/{c2}/") != []
    assert r.call("DELETE", f"/api/cards/{c2}").status_code == 204
    assert S3().keys(f"attachments/{ws}/{c2}/") == [], "deleting the card left its objects"
    assert r.call("GET", f"/api/cards/{c2}").status_code == 404 and r.call("GET", f"/api/attachments/{a3}").status_code == 404
    url = outage_url(STORAGE_DOWN_ENV)
    dr = ruth(url)
    db = make_board(dr, workspace(dr, HALE), {"Bills": ["Renew home insurance"]})
    assert dr.call("DELETE", f"/api/cards/{db.cards['Renew home insurance']}").status_code == 204


def test_wf_attachments_storage_down(browser: Browser, app_url: str) -> None:
    url = outage_url(STORAGE_DOWN_ENV)
    r = ruth(url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, FIVE)
    cid, title = b.cards["Tuesday visit"], b.titles["Tuesday visit"]
    poll_api(lambda: r.ok("GET", "/api/service-status"), lambda s: s == {"live": "up", "storage": "down"},
             BANNER_DOWN_S + SLACK_S, "service-status never reported storage down")
    fname = f"discharge-{tag()}.pdf"
    with ui(browser, url, RUTH, f"/cards/{cid}") as page:
        eventually(page, lambda: expect(service_status(page)).to_have_text(STORAGE_DOWN, timeout=POLL_MS),
                   seconds=BANNER_DOWN_S + SLACK_S, what="storage banner missing")
        dlg = page.get_by_role("dialog", name=title, exact=True)
        with page.expect_file_chooser() as fc:
            click(dlg.get_by_role("button", name="Attach a file", exact=True))
        fc.value.set_files({"name": fname, "mimeType": "application/pdf", "buffer": pdf_bytes()})
        outage = f"Couldn't attach {fname}. Attachments are unavailable right now."
        eventually(page, lambda: _need(outage in dlg.inner_text(timeout=POLL_MS) or outage in notices(page).inner_text(timeout=POLL_MS),
                                       "upload outage copy in neither the dialog nor Notices"), what="upload outage copy missing")
        expect(dlg.get_by_role("link", name=fname, exact=True)).to_have_count(0)
        fill(dlg.get_by_role("textbox", name="New checklist item", exact=True), "Lunch and fluids")
        page.keyboard.press("Enter")
        say(page, "Added Lunch and fluids to the checklist.")
        page.keyboard.press("Escape")
        refill = b.titles["Refill lisinopril"]
        card_button(page, refill).focus()
        press(page, "Space", "ArrowRight", "ArrowDown", "Space")
        say(page, sentence_moved(refill, "Pharmacy", 2, 4))
    assert card(r, cid)["attachments"] == [] and [i["text"] for i in card(r, cid)["checklist"]] == ["Lunch and fluids"]
    assert titles_in(r, b.id)["Pharmacy"][1] == refill
    res = upload(r, cid, fname, pdf_bytes(), "application/pdf")
    assert res.status_code == 503 and res.json() == {"error": "storage_unavailable"}


def test_wf_live_handoff_remote_update(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    pr = add_person(app_url, r, ws, first="Priya")
    b = make_board(r, ws, FIVE, members=[(s, "member"), (pr, "member")])
    refill = b.titles["Refill lisinopril"]
    with ui(browser, app_url, pr, f"/boards/{b.id}") as watch, ui(browser, app_url, s, f"/boards/{b.id}") as mover:
        board_ready(watch, b.name)
        board_ready(mover, b.name)
        watch.evaluate("() => { window.__kitNoReload = true; }")
        card_button(mover, refill).focus()
        press(mover, "Space", "ArrowRight", "ArrowDown", "Space")
        say(mover, sentence_moved(refill, "Pharmacy", 2, 4))
        live_see(watch, lst(watch, "Pharmacy").get_by_role("button", name=refill, exact=True), "remote move not shown")
        has_count(watch, "Inbox", 2)
        has_count(watch, "Pharmacy", 4)
        say(watch, sentence_remote(s.name, refill, "Pharmacy", 2, 4))
        new = f"Collect blood pressure cuff {tag()}"
        click(mover.get_by_role("button", name="Add a card to Waiting on others", exact=True))
        fill(mover.get_by_role("textbox", name="New card title", exact=True), new)
        mover.keyboard.press("Enter")
        live_see(watch, lst(watch, "Waiting on others").get_by_role("button", name=new, exact=True), "new card not shown")
        has_count(watch, "Waiting on others", 1)
        dental = b.titles["Dental cleaning"]
        renamed = f"Dental cleaning moved {tag()}"
        card_button(mover, dental).focus()
        mover.keyboard.press("Enter")
        dlg = mover.get_by_role("dialog", name=dental, exact=True)
        fill(dlg.get_by_role("textbox", name="Title", exact=True), renamed)
        click(dlg.get_by_role("button", name="Save changes", exact=True))
        live_see(watch, card_button(watch, renamed), "rename not shown")
        assert watch.evaluate("() => window.__kitNoReload === true"), "the watching board reloaded"
    t = titles_in(r, b.id)
    assert t["Pharmacy"][1] == refill and t["Waiting on others"] == [new] and renamed in t["Appointments"]


def test_wf_live_handoff_glide(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    x = add_person(app_url, r, ws, first="Priya")
    v = add_person(app_url, r, ws, first="Theo")
    b = make_board(r, ws, FIVE, members=[(s, "member"), (x, "member"), (v, "member")])
    refill, call = b.titles["Refill lisinopril"], b.titles["Call about hearing aid batteries"]
    with ui(browser, app_url, v, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        page.evaluate(RECORDER_JS)
        assert move(s.api, b.cards["Refill lisinopril"], b.lists["Pharmacy"], 1, 1).status_code == 200
        live_see(page, lst(page, "Pharmacy").get_by_role("button", name=refill, exact=True), "remote move not shown")
        item = item_of(page, refill)
        chip = item.get_by_role("img", name=f"Moved by {s.name}", exact=True)
        expect(chip).to_be_visible()
        expect(chip).to_have_text(s.initials)
        durations = item.evaluate(RECORDED_JS)
        elapsed = 0.0
        if durations:
            assert any(GLIDE_MIN_MS <= d <= GLIDE_MAX_MS for d in durations), f"glide durations {durations}"
        else:
            path = motion(item, GLIDE_MAX_MS * 2)
            assert len(path) >= 2 and path[0] != path[-1], "the card jumped instead of gliding"
            elapsed = path[-1]["t"]
        advance(page, max(0.0, CHIP_MS - 2 * STEP_MS - elapsed))
        expect(chip).to_be_visible(timeout=POLL_MS)
        assert move(x.api, b.cards["Refill lisinopril"], b.lists["Appointments"], 1, 2).status_code == 200
        chip2 = item_of(page, refill).get_by_role("img", name=f"Moved by {x.name}", exact=True)
        live_see(page, chip2, "second mover's chip never replaced the first")
        expect(page.get_by_role("img", name=f"Moved by {s.name}", exact=True)).to_have_count(0)
        expect(lst(page, "Appointments").get_by_role("button", name=refill, exact=True)).to_be_visible()
        advance(page, CHIP_MS - 2 * STEP_MS)
        expect(chip2).to_be_visible(timeout=POLL_MS)
        assert move(s.api, b.cards["Call about hearing aid batteries"], b.lists["Pharmacy"], 1, 1).status_code == 200
        chip3 = item_of(page, call).get_by_role("img", name=f"Moved by {s.name}", exact=True)
        live_see(page, chip3, "third move's chip missing")
        advance(page, CHIP_GONE_MS - CHIP_MS + 3 * STEP_MS)
        expect(chip2).to_have_count(0, timeout=UI_MS)
        expect(chip3).to_be_visible(timeout=POLL_MS)


def test_mover_chip_contrast(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    v = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(s, "member"), (v, "member")])
    owned, late = b.titles["Pick up eye drops"], b.titles["Ask about a weekly pill organiser"]
    r.ok("PATCH", f"/api/cards/{b.cards['Pick up eye drops']}", {"version": 1, "ownerUserId": s.user_id})
    r.ok("PATCH", f"/api/cards/{b.cards['Ask about a weekly pill organiser']}", {"version": 1, "dueDate": "2000-01-01"})
    with ui(browser, app_url, v, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        refill = b.titles["Refill lisinopril"]
        assert move(s.api, b.cards["Refill lisinopril"], b.lists["Pharmacy"], 1, 1).status_code == 200
        chip = item_of(page, refill).get_by_role("img", name=f"Moved by {s.name}", exact=True)
        live_see(page, chip, "mover chip missing")
        c = chip.evaluate(CONTRAST_JS)
        assert c["text_visible"] == s.initials, f"mover chip text {c['text_visible']!r}"
        assert c["text"] >= TEXT_CONTRAST and c["against_surface"] >= MOVER_CONTRAST, f"mover chip contrast {c}"
        oc = item_of(page, owned).get_by_role("img", name=f"Owner {s.name}", exact=True).evaluate(CONTRAST_JS)
        assert oc["text_visible"] == s.initials and oc["text"] >= TEXT_CONTRAST, f"owner chip contrast {oc}"
        od = item_of(page, late).get_by_text("Overdue", exact=True)
        see(page, od, "Overdue label missing")
        assert od.evaluate(CONTRAST_JS)["text"] >= TEXT_CONTRAST


def test_events_across_workers(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    rid = me_id(r)
    m = add_person(app_url, r, ws)
    o = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(m, "member"), (o, "observer")])
    streams = {(who, w): stream_on(app_url, who.api.token or "", b.id, w) for who in (m, o) for w in ("1", "2")}
    cid = b.cards["Refill lisinopril"]
    new = f"Refill lisinopril edited {tag()}"
    r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": new})
    for (who, w), st in streams.items():
        ev = st.wait_for("card.updated", lambda d: d["card"]["title"] == new, what=f"on worker {w}")
        assert set(ev["card"]) == (MEMBER_CARD_KEYS if who is m else OBSERVER_CARD_KEYS)
    assert move(r, cid, b.lists["Pharmacy"], 2, 2).status_code == 200
    for st in streams.values():
        ev = st.wait_for("card.moved", lambda d: d["card"]["id"] == cid)
        assert set(ev) == {"card", "from", "to", "mover", "counts"}
        assert ev["mover"] == {"displayName": RUTH[2], "initials": "RH", "colour": "sage"}
        assert ev["to"] == {"listId": b.lists["Pharmacy"], "position": 2}
        assert {c["listId"]: c["count"] for c in ev["counts"]} == {b.lists["Inbox"]: 2, b.lists["Pharmacy"]: 4}
    marks = {k: st.mark() for k, st in streams.items()}
    secret = r.ok("POST", f"/api/lists/{b.lists['Inbox']}/cards", {"title": f"Memory clinic results {tag()}"}, status=201)["card"]["id"]
    r.ok("PUT", f"/api/cards/{secret}/private-members", {"userIds": [rid, m.user_id]})
    lname = f"House {tag()}"
    r.ok("POST", f"/api/boards/{b.id}/lists", {"name": lname}, status=201)
    for (who, w), st in streams.items():
        lc = st.wait_for("list.created", lambda d: d["list"]["name"] == lname, after=marks[(who, w)])
        assert set(lc["list"]) == {"id", "name"}
        if who is m:
            assert st.find("card.created", lambda d: d["card"]["id"] == secret, marks[(who, w)]) is not None
    for w in ("1", "2"):
        assert streams[(o, w)].find("card.updated", lambda d: d["card"]["id"] == secret, marks[(o, w)]) is None
    for st in streams.values():
        st.close()


OPACITY_JS = """(el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
  return o; }"""


def test_outlined_card_keeps_visible_chip(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    v = add_person(app_url, r, ws, first="Theo")
    b = make_board(r, ws, FIVE, members=[(v, "member")])
    cid, title = b.cards["Refill lisinopril"], b.titles["Refill lisinopril"]
    with ui(browser, app_url, v, f"/boards/{b.id}", reduced_motion="reduce") as page:
        board_ready(page, b.name)
        assert move(r, cid, b.lists["Pharmacy"], 1, 1).status_code == 200
        live_see(page, lst(page, "Pharmacy").get_by_role("button", name=title, exact=True), "remote move never arrived")
        item = item_of(page, title)
        chip = item.get_by_role("img", name=f"Moved by {RUTH[2]}", exact=True)
        elapsed = 0
        for at in (STEP_MS, CHIP_MS // 2, CHIP_MS - STEP_MS, (CHIP_MS + CHIP_GONE_MS) // 2):
            advance(page, at - elapsed)
            elapsed = at
            if item.evaluate(OUTLINE_JS):
                expect(chip).to_have_count(1)
                expect(chip).to_have_text("RH")
                opacity = chip.evaluate(OPACITY_JS)
                assert opacity >= 0.99, f"{at} ms after the move the card is outlined but its mover chip has opacity {opacity}"
        advance(page, CHIP_GONE_MS + STEP_MS - elapsed)
        assert not item.evaluate(OUTLINE_JS), "the mover outline outlived the published 2 seconds"
        expect(chip).to_have_count(0)


def test_wf_concurrent_moves_race(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    pr = add_person(app_url, r, ws, first="Priya")
    b = make_board(r, ws, FIVE, members=[(s, "member"), (pr, "member")])
    targets = [b.lists["Appointments"], b.lists["Aide visits"], b.lists["Waiting on others"], b.lists["Inbox"]]
    for n in (2, 8):
        cid = r.ok("POST", f"/api/lists/{b.lists['Pharmacy']}/cards", {"title": f"Pick up eye drops {tag()}"}, status=201)["card"]["id"]
        movers = [s if i % 2 == 0 else pr for i in range(n)]
        lists = [targets[i % len(targets)] for i in range(n)]
        rs = together([lambda p=p, l=l: move(p.api, cid, l, 1, 1) for p, l in zip(movers, lists)])
        wins = [i for i, x in enumerate(rs) if x.status_code == 200]
        assert len(wins) == 1, f"{n} same-version moves: {[x.status_code for x in rs]}"
        w = wins[0]
        for i, x in enumerate(rs):
            if i == w:
                continue
            body = x.json()
            assert x.status_code == 409 and body["error"] == "stale", x.text[:200]
            assert body["change"] == "moved" and body["changedBy"] == {"displayName": movers[w].name}
            assert body["card"]["listId"] == lists[w] and body["card"]["version"] == 2
        assert card(r, cid)["listId"] == lists[w]
    assert_dense(r, b.id, "Ruth")


def test_same_version_writes(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    pr = add_person(app_url, r, ws, first="Priya")
    b = make_board(r, ws, FIVE, members=[(s, "member"), (pr, "member")])
    cid = b.cards["Pick up eye drops"]
    orig = card(r, cid)
    t1, n1 = f"Title {tag()}", f"Notes {tag()}"
    ops = [("edit", s, lambda: s.api.call("PATCH", f"/api/cards/{cid}", {"version": 1, "title": t1})),
           ("edit", pr, lambda: pr.api.call("PATCH", f"/api/cards/{cid}", {"version": 1, "notes": n1})),
           ("move", s, lambda: move(s.api, cid, b.lists["Appointments"], 1, 1)),
           ("edit", pr, lambda: pr.api.call("POST", f"/api/cards/{cid}/status", {"status": "done", "version": 1})),
           ("move", pr, lambda: move(pr.api, cid, b.lists["Inbox"], 1, 1)),
           ("edit", s, lambda: s.api.call("PATCH", f"/api/cards/{cid}", {"version": 1, "labels": ["Medication", "Bills"]}))]
    rs = together([op[2] for op in ops])
    wins = [i for i, x in enumerate(rs) if x.status_code == 200]
    assert len(wins) == 1, f"statuses {[x.status_code for x in rs]}"
    w = wins[0]
    for i, x in enumerate(rs):
        if i != w:
            assert x.status_code == 409 and x.json()["error"] == "stale"
            assert x.json()["change"] == ("moved" if ops[w][0] == "move" else "edited")
            assert x.json()["changedBy"] == {"displayName": ops[w][1].name}
    now = card(r, cid)
    assert now["version"] == 2
    assert (now["title"] == t1) == (w == 0) and (now["notes"] == n1) == (w == 1)
    assert (now["listId"] != orig["listId"]) == (w in (2, 4)) and (now["status"] == "done") == (w == 3)
    assert (now["labels"] == ["Medication", "Bills"]) == (w == 5), "fields from losing writes were merged"
    loser = next(i for i in range(len(ops)) if i != w and i in (0, 1, 5))
    retry = {0: {"title": t1}, 1: {"notes": n1}, 5: {"labels": ["Medication", "Bills"]}}[loser]
    assert ops[loser][1].api.call("PATCH", f"/api/cards/{cid}", {"version": 2, **retry}).status_code == 200
    stale = s.api.call("PATCH", f"/api/cards/{cid}", {"version": 2, "notes": "other " + tag()})
    assert stale.status_code == 409 and stale.json()["card"]["version"] == 3


def test_wf_concurrent_moves_snap_back(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    pr = add_person(app_url, r, ws, first="Priya")
    b = make_board(r, ws, FIVE, members=[(s, "member"), (pr, "member")])
    eye = b.titles["Pick up eye drops"]
    with ui(browser, app_url, s, f"/boards/{b.id}") as sp, ui(browser, app_url, pr, f"/boards/{b.id}") as pp:
        board_ready(sp, b.name)
        board_ready(pp, b.name)
        with held(pp, "**/api/cards/*/move") as hold:
            card_button(pp, eye).focus()
            press(pp, "Space", "ArrowRight", "Space")
            see(pp, lst(pp, "Appointments").get_by_role("button", name=eye, exact=True), "optimistic drop not shown")
            card_button(sp, eye).focus()
            press(sp, "Space", "ArrowRight", "ArrowRight", "Space")
            say(sp, sentence_moved(eye, "Aide visits", 1, 3))
            hold.release()
        stale = sentence_stale(s.name, "moved", eye, "Aide visits", 1, 3)
        say(pp, stale)
        eventually(pp, lambda: expect(notices(pp)).to_contain_text(stale, timeout=POLL_MS), what="stale notice missing")
        see(pp, lst(pp, "Aide visits").get_by_role("button", name=eye, exact=True), "card never returned to the server's place")
        expect(card_button(pp, eye)).to_have_count(1)
        card_button(pp, eye).focus()
        press(pp, "Space", "ArrowRight", "Space")
        say(pp, sentence_moved(eye, "Waiting on others", 1, 1))
        live_see(sp, lst(sp, "Waiting on others").get_by_role("button", name=eye, exact=True), "browsers disagree")
    got = card(r, b.cards["Pick up eye drops"])
    assert got["listId"] == b.lists["Waiting on others"] and got["version"] == 3
    assert_dense(r, b.id, "Ruth")


def test_dense_ranks(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    s = add_person(app_url, r, ws)
    names = [f"Card {i}" for i in range(1, 7)]
    b = make_board(r, ws, {"A": names, "B": ["Bills one", "Bills two", "Bills three"]}, members=[(p, "member"), (s, "member")])
    r.ok("PUT", f"/api/cards/{b.cards['Card 2']}/private-members", {"userIds": [me_id(r), p.user_id]})
    t = b.titles
    assert move(s.api, b.cards["Card 6"], b.lists["A"], 2, 1).status_code == 200
    assert titles_in(r, b.id)["A"] == [t["Card 1"], t["Card 2"], t["Card 6"], t["Card 3"], t["Card 4"], t["Card 5"]]
    assert titles_in(s.api, b.id)["A"] == [t["Card 1"], t["Card 6"], t["Card 3"], t["Card 4"], t["Card 5"]]
    assert card(s.api, b.cards["Card 6"])["position"] == 2
    for who, cid, list_name, pos in ((r, "Card 1", "B", 4), (s, "Bills one", "A", 1), (p, "Card 2", "B", 1), (r, "Card 4", "A", 1)):
        res = move(who, b.cards[cid], b.lists[list_name], pos, card(who, b.cards[cid])["version"])
        assert res.status_code == 200, res.text[:200]
        assert res.json()["card"]["position"] == pos
        for viewer, label in ((r, "Ruth"), (s, "Sam"), (p, "Priya")):
            assert_dense(viewer, b.id, label)
    batch = ["Card 3", "Card 5", "Card 6", "Bills two"]
    rs = together([lambda c=c: move(r, b.cards[c], b.lists["B"], 1, card(r, b.cards[c])["version"]) for c in batch])
    assert all(x.status_code == 200 for x in rs), [x.status_code for x in rs]
    assert_dense(r, b.id, "Ruth")
    assert_dense(s.api, b.id, "Sam")
    cid = b.cards["Bills three"]
    v = card(r, cid)["version"]
    size_b = len(titles_in(r, b.id)["B"])
    for bad in (0, size_b + 1, "1", 1.5):
        res = move(r, cid, b.lists["B"], bad, v)
        assert res.status_code == 422 and "position" in res.json()["fields"], f"position {bad!r} answered {res.status_code}"
    other = make_board(r, ws, {"Elsewhere": []})
    g = grace(app_url)
    gb = make_board(g, workspace(g, NG), {"To do": []})
    for foreign in (other.lists["Elsewhere"], gb.lists["To do"]):
        res = move(r, cid, foreign, 1, v)
        assert res.status_code == 404 and res.json() == {"error": "not_found"}


def test_wf_search_and_isolation_latest_input(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    s = add_person(app_url, r, ws, first="Sam")
    t = tag()
    q1 = f"zq{t}"
    q2 = q1 + "refill"
    b = make_board(r, ws, {"Pharmacy": []}, members=[(s, "member")])
    pharm = b.lists["Pharmacy"]
    a_title, b_title = f"Refill lisinopril {q2}", f"Ask about a weekly pill organiser {q1}rest"
    pct, plain = f"Ask for the 50% copay card {t}", f"Ask for the 50 copay card {t}"
    for title in (a_title, b_title, pct, plain):
        r.ok("POST", f"/api/lists/{pharm}/cards", {"title": title}, status=201)
    pending: list[Any] = []

    def handler(route: Any) -> None:
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query).get("q", [""])[0]
        if q == q1 and not pending:
            pending.append(route)
            return
        route.continue_()

    with ui(browser, app_url, s, f"/boards/{b.id}", size=PHONE) as page:
        board_ready(page, b.name)
        page.route("**/api/workspaces/*/search*", handler)
        box = page.get_by_role("searchbox", name="Search this workspace", exact=True)
        results = page.get_by_role("region", name="Search results", exact=True)
        status = page.get_by_role("status", name="Search results status", exact=True)
        box.focus()
        page.keyboard.type(q1)
        eventually(page, lambda: _need(pending, "the earlier query never reached the network"),
                   what="the earlier query never reached the network", step_ms=SEARCH_SETTLE_MS)
        page.keyboard.type("refill")
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(1, q2), timeout=POLL_MS), what="later query never settled")
        expect(results.get_by_role("link")).to_have_count(1)
        expect(results.get_by_role("link", name=a_title, exact=True)).to_be_visible()
        results.evaluate("(el, t) => { window.__kitSeen = false; new MutationObserver(() => { if (el.textContent.includes(t)) "
                         "window.__kitSeen = true; }).observe(el, {subtree: true, childList: true, characterData: true}); }", b_title)
        try:
            with page.expect_response(lambda resp: f"q={q1}" in resp.url and "refill" not in resp.url, timeout=POLL_MS):
                pending[0].continue_()
        except Exception:
            pass
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text(sentence_search(1, q2))
        expect(results.get_by_role("link")).to_have_count(1)
        assert page.evaluate("() => window.__kitSeen") is False, "the stale reply was painted"
        fill(box, f"50% copay card {t}")
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(1, f"50% copay card {t}"), timeout=POLL_MS),
                   what="literal % search wrong")
        expect(results.get_by_role("link", name=pct, exact=True)).to_be_visible()
        expect(results.get_by_role("link", name=plain, exact=True)).to_have_count(0)
        fill(box, "z")
        expect(status).to_have_text("")
        expect(results.get_by_role("link")).to_have_count(0)
        fill(box, q2)
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(1, q2), timeout=POLL_MS), what="re-search failed")
        box.press("Escape")
        expect(box).to_have_value("")
        expect(status).to_have_text("")
        expect(results.get_by_role("link")).to_have_count(0)


def test_wf_search_and_isolation_literal(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    t = tag()
    b1 = make_board(r, ws, {"To do": []}, name=f"Zz a {t}")
    b2 = make_board(r, ws, {"First": [], "Second": []}, name=f"Zz b {t}")
    add = lambda lid, title: r.ok("POST", f"/api/lists/{lid}/cards", {"title": title}, status=201)["card"]["id"]
    add(b1.lists["To do"], f"a_b{t}")
    add(b1.lists["To do"], f"axb{t}")
    add(b1.lists["To do"], f"c\\d{t}")
    add(b1.lists["To do"], f"cxd{t}")
    add(b1.lists["To do"], f"Écho cardiaque {t}")
    search = lambda q: r.call("GET", f"/api/workspaces/{ws}/search?q={urllib.parse.quote(q)}")
    for q, want in ((f"a_b{t}", [f"a_b{t}"]), (f"c\\d{t}", [f"c\\d{t}"]), (f"ÉCHO CARDIAQUE {t}", [f"Écho cardiaque {t}"])):
        res = search(q).json()
        assert [x["title"] for x in res["results"]] == want and res["total"] == len(want), f"{q!r} gave {res}"
    assert search(EMOJI * 2).status_code == 200 and search(EMOJI * SEARCH_MAX_CP).status_code == 200
    for bad in (EMOJI, EMOJI * (SEARCH_MAX_CP + 1), ""):
        res = search(bad)
        assert res.status_code == 422 and "q" in res.json()["fields"], f"q of {len(bad)} code points answered {res.status_code}"
    bulk = f"bulk{t}"
    ids = [add(b2.lists["Second"] if i % 2 else b2.lists["First"], f"Pay {bulk} {i}") for i in range(SEARCH_RESULT_CAP + 1)]
    add(b1.lists["To do"], f"Pay {bulk} early")
    res = search(bulk).json()
    assert res["total"] == SEARCH_RESULT_CAP + 2 and len(res["results"]) == SEARCH_RESULT_CAP
    order = [(x["boardName"], x["listName"]) for x in res["results"]]
    assert order[0] == (b1.name, "To do") and order.index((b2.name, "Second")) > order.index((b2.name, "First"))
    r.ok("POST", f"/api/cards/{ids[0]}/status", {"status": "archived", "version": 1})
    assert search(bulk).json()["total"] == SEARCH_RESULT_CAP + 1, "archived cards are still searched"
    with ui(browser, app_url, RUTH, f"/boards/{b2.id}") as page:
        board_ready(page, b2.name)
        box = page.get_by_role("searchbox", name="Search this workspace", exact=True)
        status = page.get_by_role("status", name="Search results status", exact=True)
        expect(box).to_have_attribute("placeholder", "Search cards")
        fill(box, bulk)
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(SEARCH_RESULT_CAP + 1, bulk), timeout=POLL_MS),
                   what="over-50 sentence missing")
        expect(page.get_by_role("region", name="Search results").get_by_role("link")).to_have_count(SEARCH_RESULT_CAP)
        sent: list[str] = []
        page.on("request", lambda q: sent.append(q.url) if "/search" in q.url else None)
        fill(box, "x" * (SEARCH_MAX_CP + 1))
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text("Search is limited to 100 characters.", timeout=POLL_MS),
                   what="limit sentence missing")
        assert sent == [], "over-long text sent a request"
        fill(box, EMOJI * SEARCH_MAX_CP)
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(0, EMOJI * SEARCH_MAX_CP), timeout=POLL_MS),
                   what="100 astral code points were not treated as 100 characters")


def test_workspace_isolation(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    t = tag()
    theo = add_person(app_url, r, ws, first="Theo")
    rb = make_board(r, ws, {"To do": [f"Shared token {t}"]})
    g = grace(app_url)
    ng = workspace(g, NG)
    gid = me_id(g)
    gb = make_board(g, ng, {"To do": [f"Shared token {t}"]}, visibility="workspace")
    res = r.ok("GET", f"/api/workspaces/{ws}/search?q={t}")
    assert res["total"] == 1 and res["results"][0]["boardId"] == rb.id
    gres = g.ok("GET", f"/api/workspaces/{ng}/search?q={t}")
    assert gres["total"] == 1 and gres["results"][0]["boardId"] == gb.id
    cands = {c["userId"] for c in r.ok("GET", f"/api/boards/{rb.id}/candidates")["people"]}
    assert gid not in cands and theo.user_id in cands
    assert gid not in {m["userId"] for m in r.ok("GET", f"/api/workspaces/{ws}/members")["members"]}
    assert gb.id not in {b["id"] for b in r.ok("GET", f"/api/workspaces/{ws}/boards")["boards"]}
    assert board_open(r, ws, rb.id) == 1
    for path in (f"/api/workspaces/{ng}", f"/api/boards/{gb.id}", f"/api/workspaces/{ng}/search?q={t}"):
        assert r.call("GET", path).status_code == 404, f"GET {path} crossed workspaces"
    assert r.call("POST", f"/api/boards/{rb.id}/members", {"userId": gid, "role": "member"}).status_code == 404
    with ui(browser, app_url, RUTH, f"/boards/{rb.id}") as page:
        board_ready(page, rb.name)
        click(page.get_by_role("button", name="Board settings", exact=True))
        combo = page.get_by_role("dialog", name="Board settings").get_by_role("combobox", name="Add a person", exact=True)
        click(combo)
        expect(page.get_by_role("option", name=theo.name, exact=True, include_hidden=True)).not_to_have_count(0)
        expect(page.get_by_role("option", name=GRACE[2], exact=True, include_hidden=True)).to_have_count(0)


def test_search_result_opens_card(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    t = tag()
    here = make_board(r, ws, {"Inbox": [f"Call about hearing aid batteries {t}"]})
    title = f"Pick up eye drops zq{t}"
    there = make_board(r, ws, {"Pharmacy": [title]})
    cid = there.cards[title]
    with ui(browser, app_url, RUTH, f"/boards/{here.id}") as page:
        board_ready(page, here.name)
        box = page.get_by_role("searchbox", name="Search this workspace", exact=True)
        results = page.get_by_role("region", name="Search results", exact=True)
        status = page.get_by_role("status", name="Search results status", exact=True)
        fill(box, f"zq{t}")
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(status).to_have_text(sentence_search(1, f"zq{t}"), timeout=POLL_MS),
                   what="search never settled")
        click(results.get_by_role("link", name=title, exact=True))
        eventually(page, lambda: _need(where(page)[0] == f"/cards/{cid}", f"address is {page.url}"),
                   what="choosing the result did not open /cards/<cardId>")
        board_ready(page, there.name)
        see(page, page.get_by_role("dialog", name=title, exact=True), "the chosen card's dialog never opened")


def test_wf_keyboard_move_drop(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    t = b.titles
    refill, call, metformin = t["Refill lisinopril"], t["Call about hearing aid batteries"], t["Move metformin to mail order"]
    moves: list[str] = []
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        page.on("request", lambda q: moves.append(q.url) if q.method == "POST" and q.url.endswith("/move") else None)
        card_button(page, refill).focus()
        page.keyboard.press("Space")
        say(page, sentence_lift(refill, "Inbox", 1, 3))
        page.keyboard.press("ArrowRight")
        say(page, sentence_over(refill, "Pharmacy", 1, 4))
        page.keyboard.press("ArrowDown")
        say(page, sentence_over(refill, "Pharmacy", 2, 4))
        expect(card_button(page, refill)).to_be_focused()
        page.keyboard.press("Space")
        say(page, sentence_moved(refill, "Pharmacy", 2, 4))
        expect(card_button(page, refill)).to_be_focused()
        has_count(page, "Inbox", 2)
        has_count(page, "Pharmacy", 4)
        assert len(moves) == 1
        card_button(page, call).focus()
        press(page, "Space", "ArrowRight")
        say(page, sentence_over(call, "Pharmacy", 1, 5))
        page.keyboard.press("Escape")
        say(page, sentence_cancel(call, "Inbox", 1, 2))
        expect(lst(page, "Inbox").get_by_role("button", name=call, exact=True)).to_be_visible()
        card_button(page, call).focus()
        press(page, "Space", "ArrowDown", "ArrowUp", "Enter")
        say(page, sentence_cancel(call, "Inbox", 1, 2))
        card_button(page, metformin).focus()
        page.keyboard.press("Space")
        say(page, sentence_lift(metformin, "Pharmacy", 4, 4))
        page.keyboard.press("ArrowLeft")
        say(page, sentence_over(metformin, "Inbox", 3, 3))
        page.keyboard.press("Tab")
        say(page, sentence_cancel(metformin, "Pharmacy", 4, 4))
        assert len(moves) == 1, f"cancels sent move requests: {moves}"
    assert titles_in(r, b.id)["Pharmacy"] == [t["Pick up eye drops"], refill, t["Ask about a weekly pill organiser"], metformin]
    assert card(r, b.cards["Call about hearing aid batteries"])["version"] == 1


def test_wf_keyboard_move_dialog(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    refill, call = b.titles["Refill lisinopril"], b.titles["Call about hearing aid batteries"]
    moves: list[str] = []
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        page.on("request", lambda q: moves.append(q.url) if q.method == "POST" and q.url.endswith("/move") else None)
        actions(page, refill, "Move to…")
        dlg = page.get_by_role("dialog", name="Move card", exact=True)
        see(page, dlg, "Move card dialog never opened")
        select(dlg.get_by_role("combobox", name="List", exact=True), "Pharmacy")
        select(dlg.get_by_role("combobox", name="Position", exact=True), "2")
        click(dlg.get_by_role("button", name="Move", exact=True))
        gone(page, dlg, "Move card dialog stayed open")
        say(page, sentence_moved(refill, "Pharmacy", 2, 4))
        eventually(page, lambda: expect(lst(page, "Pharmacy").get_by_role("button", name=refill, exact=True)).to_be_focused(
            timeout=POLL_MS), what="focus did not return to the moved card")
        has_count(page, "Pharmacy", 4)
        actions(page, call, "Move to…")
        see(page, dlg, "Move card dialog never reopened")
        click(dlg.get_by_role("button", name="Cancel", exact=True))
        gone(page, dlg, "Cancel left the dialog open")
        assert len(moves) == 1
    assert titles_in(r, b.id)["Pharmacy"][1] == refill and titles_in(r, b.id)["Inbox"][0] == call


def test_card_dialog_keyboard(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    cid, title = b.cards["Dental cleaning"], b.titles["Dental cleaning"]
    new = f"Dental cleaning booked {tag()}"
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        card_button(page, title).focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "Enter did not open the card dialog")
        title_box = dlg.get_by_role("textbox", name="Title", exact=True)
        eventually(page, lambda: expect(title_box).to_be_focused(timeout=POLL_MS), what="dialog did not focus Title")
        inside = "el => el.contains(document.activeElement)"
        for _ in range(80):
            page.keyboard.press("Tab")
            assert dlg.evaluate(inside), "Tab left the open card dialog"
            if focused(title_box):
                break
        else:
            pytest.fail("Tab never wrapped back to Title")
        page.keyboard.press("Shift+Tab")
        assert dlg.evaluate(inside) and not focused(title_box), "Shift+Tab from Title left the dialog"
        page.keyboard.press("Tab")
        assert focused(title_box)
        fill(title_box, new)
        dlg.get_by_role("button", name="Save changes", exact=True).focus()
        page.keyboard.press("Enter")
        say(page, f"Saved changes to {new}.")
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog"), "Escape did not close the dialog")
        eventually(page, lambda: expect(card_button(page, new)).to_be_focused(timeout=POLL_MS), what="focus not back on the card")
    got = card(r, cid)
    assert got["title"] == new and got["version"] == 2, f"save wrote version {got['version']}"


def test_announcements(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    q = add_person(app_url, r, ws, first="Sam")
    b = make_board(r, ws, FIVE, members=[(p, "member"), (q, "member")])
    tuesday = b.titles["Tuesday visit"]
    r.ok("POST", f"/api/cards/{b.cards['Tuesday visit']}/checklist", {"text": "Lunch and fluids"}, status=201)
    new = f"Collect blood pressure cuff {tag()}"
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        add_btn = page.get_by_role("button", name="Add a card to Waiting on others", exact=True)
        click(add_btn)
        fill(page.get_by_role("textbox", name="New card title", exact=True), new)
        page.keyboard.press("Enter")
        say(page, f"Added {new} to Waiting on others.")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(add_btn).to_be_focused(timeout=POLL_MS), what="Escape did not return to Add a card")
        actions(page, new, "Mark done")
        say(page, f"Marked {new} done.")
        eventually(page, lambda: expect(card_button(page, new)).to_be_focused(timeout=POLL_MS), what="focus after Mark done")
        actions(page, new, "Reopen")
        say(page, f"Reopened {new}.")
        actions(page, new, "Archive")
        say(page, f"Archived {new}.")
        click(card_button(page, tuesday))
        dlg = page.get_by_role("dialog", name=tuesday, exact=True)
        box = dlg.get_by_role("group", name="Checklist").get_by_role("checkbox", name="Lunch and fluids", exact=True)
        check(box)
        say(page, "Checked off Lunch and fluids.")
        click(box)
        say(page, "Unchecked Lunch and fluids.")
        fill(dlg.get_by_role("textbox", name="New checklist item", exact=True), "Short walk to the mailbox")
        page.keyboard.press("Enter")
        say(page, "Added Short walk to the mailbox to the checklist.")
        page.keyboard.press("Escape")
        gone(page, dlg, "the card dialog did not close")
        call = b.titles["Call about hearing aid batteries"]
        x, y = center(card_button(page, call))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + DRAG_SLOP_PX * 3, y + DRAG_SLOP_PX * 3, steps=4)
        say(page, f"Picked up {call}.")
        page.keyboard.press("Escape")
        say(page, sentence_cancel(call, "Inbox", 2, 3))
        page.mouse.up()
        book = b.titles["Book podiatry follow-up"]
        assert move(q.api, b.cards["Book podiatry follow-up"], b.lists["Pharmacy"], 1, 1).status_code == 200
        say(page, sentence_remote(q.name, book, "Pharmacy", 1, 4))
    created = next(c for c in r.ok("GET", f"/api/boards/{b.id}/archived")["cards"] if c["title"] == new)
    assert created["status"] == "archived"
    assert [i["done"] for i in card(r, b.cards["Tuesday visit"])["checklist"]] == [False, False]


def test_counts_from_server(browser: Browser, app_url: str) -> None:
    url = outage_url(LIVE_DOWN_ENV)
    r = ruth(url)
    ws = workspace(r, HALE)
    p = add_person(url, r, ws)
    q = add_person(url, r, ws)
    b = make_board(r, ws, {"Inbox": ["Refill lisinopril", "Call about hearing aid batteries", "Book podiatry follow-up"],
                           "Pharmacy": ["Pick up eye drops", "Ask about a weekly pill organiser"]},
                   members=[(p, "member"), (q, "member")])
    refill, call, book = (b.titles[k] for k in ("Refill lisinopril", "Call about hearing aid batteries", "Book podiatry follow-up"))
    with ui(browser, url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        eventually(page, lambda: expect(service_status(page)).to_have_text(PAUSED, timeout=POLL_MS), what="paused banner missing")
        drawer_open(page, b.name, 5)
        q.api.ok("POST", f"/api/lists/{b.lists['Pharmacy']}/cards", {"title": f"Collect blood pressure cuff {tag()}"}, status=201)
        card_button(page, refill).focus()
        press(page, "Space", "ArrowRight", "ArrowDown", "Space")
        say(page, sentence_moved(refill, "Pharmacy", 2, 4))
        has_count(page, "Pharmacy", 4)
        has_count(page, "Inbox", 2)
        drawer_open(page, b.name, 6)
        actions(page, call, "Mark done")
        drawer_open(page, b.name, 5)
        eventually(page, lambda: expect(card_button(page, call)).to_be_focused(timeout=POLL_MS), what="focus after Mark done")
        actions(page, call, "Reopen")
        drawer_open(page, b.name, 6)
        eventually(page, lambda: expect(card_button(page, call)).to_be_focused(timeout=POLL_MS), what="focus after Reopen")
        actions(page, book, "Archive")
        has_count(page, "Inbox", 1)
        drawer_open(page, b.name, 5)
        eventually(page, lambda: expect(card_button(page, call)).to_be_focused(timeout=POLL_MS), what="focus after Archive")
        actions(page, call, "Archive")
        has_count(page, "Inbox", 0)
        eventually(page, lambda: expect(page.get_by_role("button", name="Add a card to Inbox", exact=True)).to_be_focused(
            timeout=POLL_MS), what="focus after archiving the last card")
    assert board_open(p.api, ws, b.id) == 4
    assert {l["name"]: l["count"] for l in view(p.api, b.id)["lists"]} == {"Inbox": 0, "Pharmacy": 4}


def test_wf_card_lifecycle_create(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    p2 = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member"), (p2, "member")])
    new = f"Ask for the 50% copay card {tag()}"
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        click(page.get_by_role("button", name="Add a card to Pharmacy", exact=True))
        field = page.get_by_role("textbox", name="New card title", exact=True)
        field.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(page.get_by_text("Give the card a title.", exact=True)).to_be_visible(timeout=POLL_MS),
                   what="empty-title error missing")
        fill(field, "a" * (TITLE_MAX + 1))
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(page.get_by_text("Keep the title to 120 characters or fewer.", exact=True))
                   .to_be_visible(timeout=POLL_MS), what="long-title error missing")
        fill(field, new)
        page.keyboard.press("Enter")
        say(page, f"Added {new} to Pharmacy.")
        has_count(page, "Pharmacy", 4)
        expect(field).to_be_visible()
    assert titles_in(r, b.id)["Pharmacy"][-1] == new
    lid = b.lists["Inbox"]
    key = uuid.uuid4().hex
    title = f"Book podiatry follow-up again {tag()}"
    first = p.api.call("POST", f"/api/lists/{lid}/cards", {"title": title}, headers={"Idempotency-Key": key})
    assert first.status_code == 201 and set(first.json()) == {"card", "counts", "openCards"}
    assert first.json()["card"]["position"] == 4
    p.api.ok("PATCH", f"/api/cards/{first.json()['card']['id']}", {"version": 1, "title": title + " changed"})
    replay = p.api.call("POST", f"/api/lists/{lid}/cards", {"title": title}, headers={"Idempotency-Key": key})
    assert replay.status_code == 201 and replay.headers.get("idempotent-replay") == "true"
    assert replay.json() == first.json(), "replay did not return the stored response"
    for body, list_id in (({"title": title + " other"}, lid), ({"title": title}, b.lists["Pharmacy"])):
        conflict = p.api.call("POST", f"/api/lists/{list_id}/cards", body, headers={"Idempotency-Key": key})
        assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_conflict"}
    assert len(titles_in(r, b.id)["Inbox"]) == 4
    other = p2.api.call("POST", f"/api/lists/{lid}/cards", {"title": title}, headers={"Idempotency-Key": key})
    assert other.status_code == 201 and other.headers.get("idempotent-replay") is None
    key2 = uuid.uuid4().hex
    race_title = f"Race card {tag()}"
    rs = together([lambda: p.api.call("POST", f"/api/lists/{lid}/cards", {"title": race_title}, headers={"Idempotency-Key": key2})
                   for _ in range(6)])
    assert all(x.status_code == 201 for x in rs) and len({x.json()["card"]["id"] for x in rs}) == 1
    assert titles_in(r, b.id)["Inbox"].count(race_title) == 1


def server_now(api: Api, ws: str, bid: str) -> datetime:
    for e in log_entries(api, ws):
        if (e.get("board") or {}).get("id") == bid and e["action"] == "board.member_added":
            return iso(e["at"])
    pytest.fail("no permission-log entry recorded the board's creation time")


def test_wf_card_lifecycle_due(browser: Browser, app_url: str) -> None:
    g = grace(app_url)
    ng = workspace(g, NG)
    try:
        g.ok("PATCH", f"/api/workspaces/{ng}", {"timeZone": "Pacific/Kiritimati"})
        b = make_board(g, ng, {"To do": ["Tuesday visit", "Friday visit"]})
        today_c, late_c = b.cards["Tuesday visit"], b.cards["Friday visit"]
        for _ in range(2):
            kdate = server_now(g, ng, b.id).astimezone(ZoneInfo("Pacific/Kiritimati")).date()
            g.ok("PATCH", f"/api/cards/{today_c}", {"version": card(g, today_c)["version"], "dueDate": kdate.isoformat()})
            if card(g, today_c)["dueState"] == "due_today":
                break
        assert card(g, today_c)["dueState"] == "due_today"
        late_date = (kdate - timedelta(days=2)).isoformat()
        g.ok("PATCH", f"/api/cards/{late_c}", {"version": 1, "dueDate": late_date})
        bodies: list[str] = []
        with ui(browser, app_url, GRACE, f"/boards/{b.id}") as page:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Honolulu"})
            page.clock.set_system_time(datetime(2031, 6, 1, 12, 0, tzinfo=timezone.utc))
            page.reload()
            board_ready(page, b.name)
            today_t, late_t = b.titles["Tuesday visit"], b.titles["Friday visit"]
            see(page, item_of(page, today_t).get_by_text("Due today", exact=True), "Due today label missing")
            see(page, item_of(page, late_t).get_by_text("Overdue", exact=True), "Overdue label missing")
            g.ok("PATCH", f"/api/workspaces/{ng}", {"timeZone": "Pacific/Honolulu"})
            assert card(g, today_c)["dueState"] == "upcoming"
            advance(page, REREAD_MS + STEP_MS * 10)
            gone(page, item_of(page, today_t).get_by_text("Due today", exact=True), "time-zone change not shown after a minute")
            expect(item_of(page, late_t).get_by_text("Overdue", exact=True)).to_be_visible()
            page.on("request", lambda q: bodies.append(q.post_data or "") if q.method == "PATCH" and late_c in q.url else None)
            click(card_button(page, late_t))
            dlg = page.get_by_role("dialog", name=late_t, exact=True)
            expect(dlg.get_by_role("textbox", name="Due date", exact=True)).to_have_value(late_date)
            fill(dlg.get_by_role("textbox", name="Title", exact=True), late_t + " saved")
            click(dlg.get_by_role("button", name="Save changes", exact=True))
            say(page, f"Saved changes to {late_t} saved.")
        assert card(g, late_c)["dueDate"] == late_date
        assert all(json.loads(x).get("dueDate", late_date) == late_date for x in bodies)
    finally:
        g.call("PATCH", f"/api/workspaces/{ng}", {"timeZone": NG_ZONE})


def test_versioned_edits(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    outsider = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    cid = b.cards["Ride to cardiology on Thursday"]
    t1 = f"Ride to cardiology {tag()}"
    ok = p.api.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": t1})["card"]
    assert ok["version"] == 2 and ok["title"] == t1
    stale = r.call("PATCH", f"/api/cards/{cid}", {"version": 1, "notes": "Bring the medication list."})
    body = stale.json()
    assert stale.status_code == 409 and body["error"] == "stale" and body["change"] == "edited"
    assert body["changedBy"] == {"displayName": p.name} and body["card"]["version"] == 2 and body["card"]["title"] == t1
    assert move(r, cid, b.lists["Inbox"], 1, 2).status_code == 200
    moved = p.api.call("PATCH", f"/api/cards/{cid}", {"version": 2, "notes": "x"}).json()
    assert moved["change"] == "moved" and moved["changedBy"] == {"displayName": RUTH[2]}
    p.api.ok("POST", f"/api/cards/{cid}/checklist", {"text": "Lunch and fluids"}, status=201)
    assert card(r, cid)["version"] == 3 and card(r, cid)["notes"] != "x"
    for bad, field in (({"title": "a" * (TITLE_MAX + 1)}, "title"), ({"notes": "a" * (NOTES_MAX + 1)}, "notes"),
                       ({"labels": ["Groceries"]}, "labels"), ({"dueDate": "2026-13-45"}, "dueDate"),
                       ({"ownerUserId": outsider.user_id}, "ownerUserId")):
        res = p.api.call("PATCH", f"/api/cards/{cid}", {"version": 3, **bad})
        assert res.status_code == 422 and field in res.json()["fields"], f"{field} answered {res.status_code}"
    foreign = p.api.call("PATCH", f"/api/cards/{cid}", {"version": 3, "ownerUserId": me_id(grace(app_url))})
    assert foreign.status_code == 404
    assert card(r, cid)["version"] == 3


def test_status_lifecycle(app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    o = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member"), (o, "observer")])
    cid, other = b.cards["Refill lisinopril"], b.cards["Book podiatry follow-up"]
    st = lambda s, v, c=cid: p.api.call("POST", f"/api/cards/{c}/status", {"status": s, "version": v})
    same = st("open", 1)
    assert same.status_code == 409 and same.json() == {"error": "invalid_transition", "from": "open", "to": "open"}
    done = st("done", 1)
    assert done.status_code == 200 and set(done.json()) == {"card", "counts", "openCards"}
    assert done.json()["card"]["status"] == "done" and done.json()["card"]["version"] == 2
    assert st("open", 2).status_code == 200
    arch = st("archived", 3)
    assert arch.status_code == 200 and arch.json()["card"]["position"] is None
    bad = st("done", 4)
    assert bad.json() == {"error": "invalid_transition", "from": "archived", "to": "done"}
    assert st("archived", 4).json()["error"] == "invalid_transition"
    for res in (move(p.api, cid, b.lists["Pharmacy"], 1, 4), p.api.call("PATCH", f"/api/cards/{cid}", {"version": 4, "title": "x"}),
                p.api.call("POST", f"/api/cards/{cid}/checklist", {"text": "Lunch and fluids"})):
        assert res.status_code == 409 and res.json() == {"error": "archived"}
    assert o.api.call("GET", f"/api/cards/{cid}").status_code in (403, 404)
    assert card(p.api, cid)["status"] == "archived"
    assert o.api.call("GET", f"/api/boards/{b.id}/archived").status_code == 403
    assert o.api.call("POST", f"/api/cards/{other}/status", {"status": "done", "version": 1}).status_code == 403
    restored = st("open", 4)
    assert restored.status_code == 200 and restored.json()["card"]["position"] == 3
    assert titles_in(r, b.id)["Inbox"][-1] == b.titles["Refill lisinopril"]
    assert st("done", 5).status_code == 200 and st("archived", 6).status_code == 200
    assert st("archived", 1, other).status_code == 200
    archived = [c["id"] for c in p.api.ok("GET", f"/api/boards/{b.id}/archived")["cards"]]
    assert archived[:2] == [other, cid], "archive list was not newest first"
    assert p.api.call("POST", f"/api/cards/{other}/status", {"status": "deleted", "version": 2}).status_code == 422


def test_due_state(browser: Browser, app_url: str) -> None:
    g = grace(app_url)
    ng = workspace(g, NG)
    zone = g.ok("GET", f"/api/workspaces/{ng}")["timeZone"]
    b = make_board(g, ng, {"To do": ["Tuesday visit", "Friday visit", "Dental cleaning", "Pick up eye drops", "Refill lisinopril"]})
    c = b.cards
    for _ in range(2):
        today = server_now(g, ng, b.id).astimezone(ZoneInfo(zone)).date()
        plan = {"Tuesday visit": today, "Friday visit": today - timedelta(days=1), "Dental cleaning": today + timedelta(days=1),
                "Refill lisinopril": today - timedelta(days=1)}
        for k, d in plan.items():
            g.ok("PATCH", f"/api/cards/{c[k]}", {"version": card(g, c[k])["version"], "dueDate": d.isoformat()})
        if card(g, c["Tuesday visit"])["dueState"] == "due_today":
            break
    expected = {"Tuesday visit": "due_today", "Friday visit": "overdue", "Dental cleaning": "upcoming", "Pick up eye drops": None}
    for k, want in expected.items():
        assert card(g, c[k])["dueState"] == want, f"{k} dueState {card(g, c[k])['dueState']}"
    g.ok("POST", f"/api/cards/{c['Refill lisinopril']}/status", {"status": "done", "version": card(g, c["Refill lisinopril"])["version"]})
    assert card(g, c["Refill lisinopril"])["dueState"] is None
    with ui(browser, app_url, GRACE, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        t = b.titles
        see(page, item_of(page, t["Tuesday visit"]).get_by_text("Due today", exact=True), "Due today missing")
        see(page, item_of(page, t["Friday visit"]).get_by_text("Overdue", exact=True), "Overdue missing")
        for k in ("Dental cleaning", "Pick up eye drops", "Refill lisinopril"):
            expect(item_of(page, t[k]).get_by_text(re.compile(r"^(Due today|Overdue)$"))).to_have_count(0)


def test_checklists(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    q = add_person(app_url, r, ws)
    o = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member"), (q, "member"), (o, "observer")])
    cid, title = b.cards["Friday visit"], b.titles["Friday visit"]
    with ui(browser, app_url, q, f"/cards/{cid}") as page:
        dlg = page.get_by_role("dialog", name=title, exact=True)
        see(page, dlg, "card dialog never opened")
        group = dlg.get_by_role("group", name="Checklist", exact=True)
        item = p.api.ok("POST", f"/api/cards/{cid}/checklist", {"text": "Change bed linen"}, status=201)["item"]
        assert set(item) == {"id", "text", "done"} and item["done"] is False
        live_see(page, group.get_by_role("checkbox", name="Change bed linen", exact=True), "added item not shown")
        assert p.api.ok("PATCH", f"/api/checklist-items/{item['id']}", {"done": True})["item"]["done"] is True
        eventually(page, lambda: expect(group.get_by_role("checkbox", name="Change bed linen")).to_be_checked(timeout=POLL_MS),
                   seconds=LIVE_MS / 1000 + SLACK_S, what="tick not shown", step_ms=0)
        p.api.ok("PATCH", f"/api/checklist-items/{item['id']}", {"text": "Groceries from the list"})
        live_see(page, group.get_by_role("checkbox", name="Groceries from the list", exact=True), "rename not shown")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(item_of(page, title)).to_contain_text("1/1", timeout=POLL_MS), what="progress not 1/1")
        p.api.ok("PATCH", f"/api/checklist-items/{item['id']}", {"done": False})
        eventually(page, lambda: expect(item_of(page, title)).to_contain_text("0/1", timeout=POLL_MS),
                   seconds=LIVE_MS / 1000 + SLACK_S, what="untick not shown", step_ms=0)
        assert p.api.call("DELETE", f"/api/checklist-items/{item['id']}").status_code == 204
        eventually(page, lambda: expect(item_of(page, title)).not_to_contain_text("0/1", timeout=POLL_MS),
                   seconds=LIVE_MS / 1000 + SLACK_S, what="delete not shown", step_ms=0)
    assert card(r, cid)["checklist"] == [] and card(r, cid)["version"] == 1
    empty = p.api.call("POST", f"/api/cards/{cid}/checklist", {"text": ""})
    assert empty.status_code == 422 and "text" in empty.json()["fields"]
    assert o.api.call("POST", f"/api/cards/{cid}/checklist", {"text": "Lunch and fluids"}).status_code == 403


def test_checklist_box_waits_for_reply(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    tuesday = b.titles["Tuesday visit"]
    r.ok("POST", f"/api/cards/{b.cards['Tuesday visit']}/checklist", {"text": "Lunch and fluids"}, status=201)
    pending: list[Any] = []

    def handler(route: Any) -> None:
        if route.request.method == "PATCH" and not pending:
            pending.append(route)
            return
        route.continue_()

    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        click(card_button(page, tuesday))
        dlg = page.get_by_role("dialog", name=tuesday, exact=True)
        box = dlg.get_by_role("group", name="Checklist").get_by_role("checkbox", name="Lunch and fluids", exact=True)
        see(page, box, "checklist item missing")
        page.route("**/api/checklist-items/*", handler)
        click(box)
        eventually(page, lambda: _need(pending, "the tick never reached the network"), what="the tick never reached the network")
        eventually(page, lambda: expect(box).to_be_disabled(timeout=POLL_MS), what="checkbox not disabled while its save was pending")
        pending[0].continue_()
        say(page, "Checked off Lunch and fluids.")
        eventually(page, lambda: expect(box).to_be_enabled(timeout=POLL_MS), what="checkbox stayed disabled after the reply")
        expect(box).to_be_checked()
    assert [i["done"] for i in card(r, b.cards["Tuesday visit"])["checklist"]] == [True]


def test_wf_live_outage_paused(browser: Browser, app_url: str) -> None:
    url = outage_url(LIVE_DOWN_ENV)
    r = ruth(url)
    ws = workspace(r, HALE)
    p = add_person(url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    poll_api(lambda: r.ok("GET", "/api/service-status"), lambda s: s == {"live": "paused", "storage": "up"},
             BANNER_DOWN_S + SLACK_S, "service-status never reported live paused")
    st = EventStream(url, p.api.token or "", b.id)
    st.wait_for("live.paused", seconds=BANNER_DOWN_S + SLACK_S)
    assert any(t == "live.paused" and raw == "{}" for _, t, raw in st.frames), "live.paused data was not exactly {}"
    refill = b.titles["Refill lisinopril"]
    with ui(browser, url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        eventually(page, lambda: expect(service_status(page)).to_have_text(PAUSED, timeout=POLL_MS),
                   seconds=BANNER_DOWN_S + SLACK_S, what="paused banner missing")
        card_button(page, refill).focus()
        press(page, "Space", "ArrowRight", "ArrowDown", "Space")
        say(page, sentence_moved(refill, "Pharmacy", 2, 4))
        has_count(page, "Pharmacy", 4)
        assert_opaque(page.get_by_role("status", name="Service status").inner_text(), "paused banner")
    assert titles_in(r, b.id)["Pharmacy"][1] == refill
    st.close()


class Relay:
    def __init__(self, port: int, host: str, upstream: int):
        self.port, self.host, self.upstream = port, host, upstream
        self.sock: socket.socket | None = None
        self.conns: list[socket.socket] = []

    def start(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.sock = s
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(LOOP_CAP):
            try:
                c, _ = self.sock.accept()
                u = socket.create_connection((self.host, self.upstream), timeout=10)
            except OSError:
                return
            u.settimeout(None)
            self.conns += [c, u]
            for a, d in ((c, u), (u, c)):
                threading.Thread(target=self._pump, args=(a, d), daemon=True).start()

    def _pump(self, a: socket.socket, d: socket.socket) -> None:
        try:
            for _ in range(LOOP_CAP * 10):
                data = a.recv(65536)
                if not data:
                    break
                d.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, d):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        for s in [self.sock, *self.conns]:
            if s is None:
                continue
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def via(url: str, port: int, default_port: int) -> tuple[str, str, int]:
    u = urllib.parse.urlsplit(url)
    cred = u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else ""
    return (urllib.parse.urlunsplit((u.scheme, f"{cred}127.0.0.1:{port}", u.path, u.query, u.fragment)),
            u.hostname or "", u.port or default_port)


@pytest.mark.timeout(1200)
def test_boot_and_recover(browser: Browser, app_url: str) -> None:
    for name in ("DATABASE_URL", "S3_ENDPOINT", "VALKEY_URL"):
        if not os.environ.get(name):
            pytest.fail(f"{name} is not set in the verifier; cannot start a copy of the app")
    sport, vport, aport = free_port(), free_port(), free_port()
    s3_url, s3_host, s3_up = via(os.environ["S3_ENDPOINT"], sport, 80)
    vk_url, vk_host, vk_up = via(os.environ["VALKEY_URL"], vport, 6379)
    env = {**os.environ, "APP_PUBLIC_PORT": str(aport), "S3_ENDPOINT": s3_url, "VALKEY_URL": vk_url}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve_command(), shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    relays = [Relay(sport, s3_host, s3_up), Relay(vport, vk_host, vk_up)]
    base = f"http://127.0.0.1:{aport}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-3000:]

    try:
        deadline = time.monotonic() + BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"the copy exited with {proc.returncode}:\n{tail()}")
            try:
                if httpx.get(f"{base}/api/health", timeout=5).status_code == 200:
                    break
            except httpx.HTTPError:
                _nap(0.5)
        else:
            pytest.fail(f"the copy never served /api/health with storage and relay down:\n{tail()}")
        r = ruth(base)
        poll_api(lambda: r.ok("GET", "/api/service-status"), lambda s: s == {"live": "paused", "storage": "down"},
                 BANNER_DOWN_S + SLACK_S, "degraded status not reported at boot")
        ws = workspace(r, HALE)
        b = make_board(r, ws, FIVE)
        cid = b.cards["Tuesday visit"]
        down = upload(r, cid, f"sheet-{tag()}.pdf", pdf_bytes(), "application/pdf")
        assert down.status_code == 503 and down.json() == {"error": "storage_unavailable"}
        st = EventStream(base, r.token or "", b.id)
        with ui(browser, base, RUTH, f"/boards/{b.id}") as page:
            board_ready(page, b.name)
            eventually(page, lambda: expect(service_status(page)).to_contain_text(PAUSED, timeout=POLL_MS),
                       seconds=BANNER_DOWN_S + SLACK_S, what="paused banner missing at boot")
            for relay in relays:
                relay.start()
            poll_api(lambda: r.ok("GET", "/api/service-status"), lambda s: s == {"live": "up", "storage": "up"},
                     BANNER_UP_S + SLACK_S, "services never reported up after returning")
            st.wait_for("live.resumed", seconds=BANNER_UP_S + SLACK_S)
            eventually(page, lambda: expect(service_status(page)).not_to_contain_text(PAUSED, timeout=POLL_MS),
                       seconds=BANNER_UP_S + SLACK_S, what="paused banner never cleared")
            say(page, LIVE_BACK)
        data = pdf_bytes()
        up = upload(r, cid, f"sheet-{tag()}.pdf", data, "application/pdf")
        assert up.status_code == 201, f"upload after recovery answered {up.status_code}"
        assert S3().get(f"attachments/{ws}/{cid}/{up.json()['attachment']['id']}") == data
        mark = st.mark()
        new = f"Tuesday visit back {tag()}"
        r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": new})
        st.wait_for("card.updated", lambda d: d["card"]["title"] == new, after=mark)
        st.close()
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=20)
        except Exception:
            os.killpg(proc.pid, signal.SIGKILL)
        for relay in relays:
            relay.stop()


def test_wf_live_outage_drafts(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws, first="Priya")
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    cid, title = b.cards["Tuesday visit"], b.titles["Tuesday visit"]
    draft = f"Draft notes {tag()}"
    access = "Your access to this board is now Admin."
    with ui(browser, app_url, p, f"/boards/{b.id}", size=TABLET) as page:
        board_ready(page, b.name)
        click(page.get_by_role("tab", name="Aide visits", exact=True))
        click(card_button(page, title))
        dlg = page.get_by_role("dialog", name=title, exact=True)
        notes = dlg.get_by_role("textbox", name="Notes", exact=True)
        fill(notes, draft)
        notes.focus()
        r.ok("PATCH", f"/api/boards/{b.id}/members/{p.user_id}", {"role": "admin"})
        eventually(page, lambda: expect(notices(page)).to_contain_text(access, timeout=POLL_MS), what="access notice missing")
        renamed = f"Tuesday visit renamed {tag()}"
        r.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": renamed})
        dlg2 = page.get_by_role("dialog", name=renamed, exact=True)
        eventually(page, lambda: expect(dlg2.get_by_role("textbox", name="Title", exact=True)).to_have_value(renamed, timeout=POLL_MS),
                   seconds=LIVE_MS / 1000 + SLACK_S, what="untouched Title did not take the server value", step_ms=0)

        def kept() -> None:
            box = page.get_by_role("dialog", name=renamed, exact=True).get_by_role("textbox", name="Notes", exact=True)
            expect(box).to_have_value(draft, timeout=POLL_MS)
            expect(box).to_be_focused(timeout=POLL_MS)
            expect(notices(page)).to_contain_text(access, timeout=POLL_MS)
            expect(page.get_by_role("tab", name="Aide visits", exact=True)).to_have_attribute("aria-selected", "true", timeout=POLL_MS)

        kept()
        advance(page, REREAD_MS + STEP_MS * 10)
        kept()
    assert card(r, cid)["notes"] != draft, "the draft was saved without Save changes"


def test_opaque_errors(app_url: str) -> None:
    r = ruth(app_url)
    ref = r.call("GET", f"/api/cards/{uuid.uuid4()}")
    assert ref.status_code == 404 and ref.json() == {"error": "not_found"}
    probes = ["not-an-id", "%01%02", "x" * ID_LONG, "%E2%80%AE", "1%3BDROP", "%27%20OR%201%3D1"]
    for x in probes:
        for path in (f"/api/cards/{x}", f"/api/boards/{x}", f"/api/attachments/{x}"):
            res = r.call("GET", path)
            assert res.status_code == 404 and res.content == ref.content, f"GET {path[:60]} answered {res.status_code} {res.text[:100]}"
        mv = r.call("POST", f"/api/cards/{x}/move", {"toListId": x, "position": 1, "version": 1})
        assert mv.status_code == 404 and mv.content == ref.content
    for var in (STORAGE_DOWN_ENV, LIVE_DOWN_ENV):
        url = outage_url(var)
        dr = ruth(url)
        ws = workspace(dr, HALE)
        b = make_board(dr, ws, {"Inbox": ["Refill lisinopril"]})
        cid = b.cards["Refill lisinopril"]
        st = EventStream(url, dr.token or "", b.id)
        dr.ok("PATCH", f"/api/cards/{cid}", {"version": 1, "title": f"Refill {tag()}"})
        res = [dr.call("GET", "/api/service-status"), upload(dr, cid, f"f-{tag()}.pdf", pdf_bytes(), "application/pdf"),
               dr.call("GET", f"/api/attachments/{uuid.uuid4()}"), dr.call("GET", "/api/health")]
        if var == STORAGE_DOWN_ENV:
            assert res[1].status_code == 503 and res[1].json() == {"error": "storage_unavailable"}
        for x in res:
            assert_opaque(x.text + json.dumps(dict(x.headers)), f"{var} {x.request.url.path}")
        assert_opaque("\n".join(st.raw), f"{var} event stream")
        st.close()


def test_unexpected_error_notice(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    new = f"Ask about a weekly pill organiser {tag()}"

    def handler(route: Any) -> None:
        if route.request.method == "POST":
            route.fulfill(status=500, content_type="application/json", body='{"error":"internal"}')
            return
        route.continue_()

    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        board_ready(page, b.name)
        page.route("**/api/lists/*/cards", handler)
        click(page.get_by_role("button", name="Add a card to Pharmacy", exact=True))
        fill(page.get_by_role("textbox", name="New card title", exact=True), new)
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(notices(page)).to_contain_text("Something went wrong. Try again.", timeout=POLL_MS),
                   what="the unexpected error was not shown in Notices")
        assert_opaque(notices(page).inner_text(), "Notices")
    assert new not in titles_in(r, b.id)["Pharmacy"]


def test_wf_phone_board_address(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    other = make_board(r, ws, {"Elsewhere": []})
    appt = b.lists["Appointments"]
    dental, dental_id = b.titles["Dental cleaning"], b.cards["Dental cleaning"]
    on_list = lambda page, lid: (lambda: _assert_address(page, f"/boards/{b.id}", lid))
    with ui(browser, app_url, p, f"/boards/{b.id}", size=PHONE) as page:
        board_ready(page, b.name)
        hist = page.evaluate("history.length")
        tab = page.get_by_role("tab", name="Appointments", exact=True)
        click(tab)
        eventually(page, on_list(page, appt), what="selected list not in the address")
        assert page.evaluate("history.length") == hist, "changing the tab added a history entry"
        page.reload()
        board_ready(page, b.name)
        expect(tab).to_have_attribute("aria-selected", "true")
        click(card_button(page, dental))
        eventually(page, lambda: _assert_address(page, f"/cards/{dental_id}", None), what="card address missing")
        see(page, page.get_by_role("dialog", name=dental, exact=True), "card dialog missing")
        page.go_back()
        eventually(page, on_list(page, appt), what="Back did not return to the list address")
        gone(page, page.get_by_role("dialog"), "Back did not close the dialog")
        eventually(page, lambda: expect(card_button(page, dental)).to_be_focused(timeout=POLL_MS), what="focus not on the card")
        page.go_forward()
        see(page, page.get_by_role("dialog", name=dental, exact=True), "Forward did not reopen the dialog")
        page.keyboard.press("Escape")
        eventually(page, on_list(page, appt), what="Escape did not return to the list address")
        page.goto(f"{app_url}/cards/{dental_id}")
        see(page, page.get_by_role("dialog", name=dental, exact=True), "direct card load showed no dialog")
        hist = page.evaluate("history.length")
        click(page.get_by_role("dialog", name=dental).get_by_role("button", name="Close", exact=True))
        eventually(page, on_list(page, appt), what="closing a direct card load did not land on its list")
        assert page.evaluate("history.length") == hist, "closing a direct load added history"
        expect(tab).to_have_attribute("aria-selected", "true")
        for bad in ("bogus", other.lists["Elsewhere"]):
            page.goto(f"{app_url}/boards/{b.id}?list={bad}")
            board_ready(page, b.name)
            expect(page.get_by_role("tab", name="Inbox", exact=True)).to_have_attribute("aria-selected", "true")
            eventually(page, lambda: _assert_address(page, f"/boards/{b.id}", None), what="unknown list kept in address")
        page.set_viewport_size(DESKTOP)
        page.goto(f"{app_url}/boards/{b.id}?list={appt}")
        board_ready(page, b.name)
        assert where(page)[1].get("list") == [appt]
        assert lists_in_view(page, LIST_ORDER) == LIST_ORDER


def test_wf_phone_board_breakpoints(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        for w, h, n in BREAKPOINTS:
            page.set_viewport_size({"width": w, "height": h})
            page.goto(f"{app_url}/boards/{b.id}")
            board_ready(page, b.name)
            eventually(page, lambda: _assert_count(page, n), what=f"{w}px showed the wrong lists")
            tablist = page.get_by_role("tablist", name="Lists", exact=True)
            boards_btn = page.get_by_role("button", name="Boards", exact=True)
            if n == 5:
                expect(tablist).to_have_count(0)
                got = lists_in_view(page, LIST_ORDER)
                xs = [lst(page, x).bounding_box()["x"] for x in got]
                assert got == LIST_ORDER and xs == sorted(xs), "lists not in order left to right"
            else:
                expect(tablist).to_be_visible()
            if n == 2:
                click(page.get_by_role("tab", name="Waiting on others", exact=True))
                eventually(page, lambda: assert_pair(page, ["Aide visits", "Waiting on others"]), what="last list pairing wrong")
                click(page.get_by_role("tab", name="Inbox", exact=True))
                eventually(page, lambda: assert_pair(page, ["Inbox", "Pharmacy"]), what="first list pairing wrong")
            if w < 768:
                expect(boards_btn).to_be_visible()
            else:
                expect(boards_btn).to_have_count(0)
                expect(page.get_by_role("navigation", name="Boards", exact=True)).to_be_visible()
            if (w, h) in ((375, 812), (768, 1024), (1280, 800)):
                layout(page)


def test_closed_panels_inert(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, FIVE)
    refill = b.titles["Refill lisinopril"]
    with ui(browser, app_url, RUTH, f"/boards/{b.id}", size=PHONE) as page:
        board_ready(page, b.name)
        btn = page.get_by_role("button", name="Boards", exact=True)
        link = page.get_by_role("link", name=b.name, exact=True)

        def closed() -> None:
            expect(btn).to_have_attribute("aria-expanded", "false", timeout=POLL_MS)
            expect(link).to_have_count(0, timeout=POLL_MS)
            expect(page.get_by_role("button", name="New board")).to_have_count(0, timeout=POLL_MS)

        closed()
        names = tab_order(page, 30)
        assert b.name not in names and "New board" not in names, f"closed sheet was focusable: {names}"
        click(btn)
        sheet = page.get_by_role("dialog", name="Boards", exact=True)
        see(page, sheet.get_by_role("navigation", name="Boards").get_by_role("link", name=b.name, exact=True), "sheet empty")
        expect(btn).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("Escape")
        eventually(page, closed, what="Boards sheet stayed exposed after Escape")
        eventually(page, lambda: expect(btn).to_be_focused(timeout=POLL_MS), what="focus not back on Boards")
        assert b.name not in tab_order(page, 30)
        for opener, item in ((page.get_by_role("button", name="Account", exact=True), "Sign out"),
                             (page.get_by_role("button", name=f"Actions for {refill}", exact=True), "Archive")):
            click(opener)
            see(page, page.get_by_role("menuitem", name=item, exact=True), f"{item} menu never opened")
            page.keyboard.press("Escape")
            gone(page, page.get_by_role("menuitem", name=item, exact=True), f"closed menu still exposed {item}")
        click(card_button(page, refill))
        see(page, page.get_by_role("dialog", name=refill, exact=True), "card dialog never opened")
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("textbox", name="Title"), "closed dialog still exposed Title")
        assert "Save changes" not in tab_order(page, 30)
        layout(page)


def test_menus_uncut(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    many = {"Inbox": [f"Book podiatry follow-up {i}" for i in range(1, 7)], "Waiting on others": ["Collect blood pressure cuff"]}
    b = make_board(r, ws, many, members=[(p, "member")])
    for size, last in ((PHONE, "Book podiatry follow-up 6"), (DESKTOP, "Collect blood pressure cuff")):
        title = b.titles[last]
        with ui(browser, app_url, RUTH, f"/boards/{b.id}", size=size) as page:
            board_ready(page, b.name)
            opener = page.get_by_role("button", name=f"Actions for {title}", exact=True)
            click(opener)
            menu = page.get_by_role("menu", name=f"Actions for {title}", exact=True)
            see(page, menu, "actions menu never opened")
            inside_viewport(page, menu)
            items = [menu.get_by_role("menuitem", name=n, exact=True) for n in ("Move to…", "Mark done", "Archive")]
            eventually(page, lambda: expect(items[0]).to_be_focused(timeout=POLL_MS), what="first item not focused")
            page.keyboard.press("ArrowDown")
            expect(items[1]).to_be_focused()
            assert all(hit(i) for i in items), "a menu item was covered by another layer"
            page.keyboard.press("Escape")
            gone(page, menu, "Escape left the menu open")
            eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS), what="focus not back on Actions")
            click(opener)
            click(menu.get_by_role("menuitem", name="Archive", exact=True))
            poll_api(lambda: card(r, b.cards[last]), lambda c: c["status"] == "archived", UI_S, "clicking Archive did nothing")
            click(page.get_by_role("button", name="Board settings", exact=True))
            role_btn = page.get_by_role("button", name=f"Role for {p.name}", exact=True)
            click(role_btn)
            picker = page.get_by_role("menu", name=f"Role for {p.name}", exact=True)
            see(page, picker, "role picker never opened")
            inside_viewport(page, picker)
            for n, role in (("Admin", "menuitemradio"), ("Member", "menuitemradio"), ("Observer", "menuitemradio"),
                            ("Remove from board", "menuitem")):
                assert hit(picker.get_by_role(role, name=n, exact=True)), f"{n} was not clickable at its centre"
            page.keyboard.press("Escape")
            gone(page, picker, "Escape left the role picker open")
            eventually(page, lambda: expect(role_btn).to_be_focused(timeout=POLL_MS), what="focus not back on the role button")


def test_accessible_names(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    p = add_person(app_url, r, ws)
    b = make_board(r, ws, FIVE, members=[(p, "member")])
    r.ok("PATCH", f"/api/cards/{b.cards['Refill lisinopril']}", {"version": 1, "ownerUserId": p.user_id, "labels": ["Medication"]})
    r.ok("PUT", f"/api/cards/{b.cards['Call about hearing aid batteries']}/private-members", {"userIds": [me_id(r), p.user_id]})
    refill, call = b.titles["Refill lisinopril"], b.titles["Call about hearing aid batteries"]
    with ui(browser, app_url, p, f"/boards/{b.id}") as page:
        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            page.goto(f"{app_url}/boards/{b.id}")
            board_ready(page, b.name)
            expect(card_button(page, refill)).to_have_count(1)
            expect(item_of(page, refill).get_by_role("img", name=f"Owner {p.name}", exact=True)).to_have_text(p.initials)
            expect(item_of(page, call).get_by_role("img", name="Private card", exact=True)).to_have_count(1)
            if size["width"] < 1200:
                for name in LIST_ORDER:
                    tab = page.get_by_role("tab", name=name, exact=True)
                    expect(tab).to_have_count(1)
                    assert not re.search(r"\d", tab.inner_text()), "tab name carries a count"
                    controls = tab.get_attribute("aria-controls")
                    assert controls, f"tab {name} has no aria-controls"
                    if tab.get_attribute("aria-selected") == "true":
                        assert page.get_by_role("region", name=name, exact=True).evaluate("el => el.id") == controls
            if size == PHONE:
                btn = page.get_by_role("button", name="Boards", exact=True)
                expect(btn).to_have_attribute("aria-expanded", "false")
                click(btn)
                expect(btn).to_have_attribute("aria-expanded", "true")
                page.keyboard.press("Escape")


def test_wf_cross_cutting_copy(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    ws = workspace(r, HALE)
    b = make_board(r, ws, FIVE)
    with app_page(browser, f"{app_url}/signin") as page:
        page.set_viewport_size(DESKTOP)
        see(page, page.get_by_role("heading", level=1, name="Sign in to Kinfold", exact=True), "sign-in heading missing")
        expect(page.get_by_role("button", name="Sign in", exact=True)).to_have_text("Sign in")
        fill(page.get_by_role("textbox", name="Email", exact=True), RUTH[0])
        fill(page.get_by_label("Password", exact=True), "wrong-" + tag())
        click(page.get_by_role("button", name="Sign in", exact=True))
        eventually(page, lambda: expect(page.get_by_role("alert")).to_have_text(BAD_LOGIN, timeout=POLL_MS), what="bad login copy")
        fill(page.get_by_label("Password", exact=True), RUTH[1])
        with held(page, "**/api/session") as hold:
            click(page.get_by_role("button", name="Sign in", exact=True))
            see(page, page.get_by_role("button", name="Signing in…", exact=True), "pending sign-in copy missing")
            hold.release()
        eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"/signin"), timeout=POLL_MS), what="sign-in failed")
        page.goto(f"{app_url}/boards/{b.id}")
        board_ready(page, b.name)
        expect(page.get_by_role("heading", level=1, name=PARENT, exact=True)).to_be_visible()
        expect(page.get_by_role("searchbox", name="Search this workspace")).to_have_attribute("placeholder", "Search cards")
        expect(lst(page, "Waiting on others")).to_contain_text(EMPTY_LIST)
        has_count(page, "Inbox", 3)
        click(page.get_by_role("button", name="Account", exact=True))
        menu = page.get_by_role("menu", name="Account", exact=True)
        for item in ("Change password", "Permission log", "Sign out"):
            expect(menu.get_by_role("menuitem", name=item, exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        card_button(page, b.titles["Dental cleaning"]).focus()
        page.keyboard.press("?")
        keys = page.get_by_role("dialog", name="Keyboard shortcuts", exact=True)
        see(page, keys, "? did not open the shortcuts dialog")
        for row in KEY_MAP:
            for cell in row:
                expect(keys.get_by_role("cell", name=cell, exact=True).first).to_be_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(card_button(page, b.titles["Dental cleaning"])).to_be_focused(timeout=POLL_MS),
                   what="Escape did not return to the card")
        click(page.get_by_role("button", name="New board", exact=True))
        nb = page.get_by_role("dialog", name="New board", exact=True)
        click(nb.get_by_role("button", name="Create board", exact=True))
        eventually(page, lambda: expect(nb).to_contain_text("Give the board a name.", timeout=POLL_MS), what="empty board name copy")
        fill(nb.get_by_role("textbox", name="Board name", exact=True), "a" * (BOARD_NAME_MAX + 1))
        click(nb.get_by_role("button", name="Create board", exact=True))
        eventually(page, lambda: expect(nb).to_contain_text("Keep the name to 60 characters or fewer.", timeout=POLL_MS),
                   what="long board name copy")
        click(nb.get_by_role("button", name="Cancel", exact=True))
        click(page.get_by_role("button", name="Add a list", exact=True))
        field = page.get_by_role("textbox", name="New list name", exact=True)
        field.press("Enter")
        eventually(page, lambda: expect(page.get_by_text("Give the list a name.", exact=True)).to_be_visible(timeout=POLL_MS),
                   what="empty list name copy")
        fill(field, "a" * (LIST_NAME_MAX + 1))
        field.press("Enter")
        eventually(page, lambda: expect(page.get_by_text("Keep the name to 40 characters or fewer.", exact=True))
                   .to_be_visible(timeout=POLL_MS), what="long list name copy")
        field.press("Escape")
        token = next(c["value"] for c in page.context.cookies() if c["name"] == SESSION_COOKIE)
        assert Api(app_url, token).call("DELETE", "/api/session").status_code == 204
        fill(page.get_by_role("searchbox", name="Search this workspace", exact=True), "zz")
        advance(page, SEARCH_SETTLE_MS + STEP_MS)
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=POLL_MS), what="401 did not sign out")
        see(page, page.get_by_role("status").filter(has_text=SIGNED_OUT), "signed-out status missing")


IF_ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ["Literata", "Atkinson Hyperlegible"]
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "@seald-io/nedb", "level", "leveldown",
                      "mongodb", "mongoose", "mysql", "mysql2", "lmdb", "pouchdb"}


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert isinstance(data, dict) and set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"notices omit shipped packages: {missing[:20]}"
    for font in FONTS:
        assert font in text, f"notices omit the font {font}"


OFL_NAMES = ("OFL-1.1", "OFL 1.1", "SIL Open Font License")
ENTRY_START = re.compile(r"^(\s*)(#|[-*+]\s|\d+[.)]\s|\|)")


def entry_text(lines: list[str], i: int) -> str:
    first = ENTRY_START.match(lines[i])
    indent = len(first.group(1)) if first else len(lines[i]) - len(lines[i].lstrip())
    heading = bool(first and first.group(2) == "#")
    out = [lines[i]]
    for line in lines[i + 1:]:
        nxt = ENTRY_START.match(line)
        if nxt and (nxt.group(2) == "#" or (not heading and len(nxt.group(1)) <= indent)):
            break
        out.append(line)
    return " ".join(out)


def font_licence_allowed(entry: str) -> bool:
    return any(a in entry for a in IF_ALLOWED) or any(n.lower() in entry.lower() for n in OFL_NAMES)


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, IF_ALLOWED)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    lines = Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in FONTS:
        idx = [i for i, l in enumerate(lines) if font in l]
        assert idx, f"notices omit the font {font}"
        entries = [entry_text(lines, i) for i in idx]
        assert any(font_licence_allowed(e) for e in entries), f"{font} has no allowed licence"


def test_if_datastores() -> None:
    assert Postgres().tables(), "the app created no PostgreSQL tables"
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & DATASTORE_PACKAGES, f"other datastores shipped: {shipped & DATASTORE_PACKAGES}"
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        for f in root.rglob("*"):
            if "node_modules" in f.parts:
                continue
            assert f.suffix not in {".sqlite", ".sqlite3", ".db"}, f"database file on disk: {f}"


def test_if_service_config_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    pattern = re.compile(r"(?:^|/)(?:\.env[^/]*|[^/]*compose[^/]*\.ya?ml)$")
    created: set[str] = set()
    hits: list[str] = []

    def touch(target: str, creates: bool) -> None:
        if not pattern.search(target):
            return
        full = os.path.normpath(target if target.startswith("/") else os.path.join("/app", target))
        if creates and full.startswith("/app/") and full not in created:
            created.add(full)
        elif full not in created:
            hits.append(target)

    def bash_edits(cmd: str) -> None:
        try:
            toks = shlex.split(cmd)
        except ValueError:
            return
        for i, t in enumerate(toks):
            if t in (">", ">>") and i + 1 < len(toks):
                touch(toks[i + 1], t == ">")
            redirect = re.match(r"^\d?(>>?)(.+)$", t)
            if redirect:
                touch(redirect.group(2), redirect.group(1) == ">")
        if "sed" in toks and any(t.startswith("-i") for t in toks):
            for t in toks:
                touch(t, False)
        args = [t for t in toks[1:] if not t.startswith("-")]
        if toks and toks[0] == "tee":
            for t in args:
                touch(t, "-a" not in toks)
        if toks and toks[0] == "cp" and args:
            touch(args[-1], True)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name, inp = node.get("name"), node.get("input")
            if name in {"Write", "Edit", "MultiEdit"} and isinstance(inp, dict):
                touch(str(inp.get("file_path", "")), name == "Write")
            if name == "Bash" and isinstance(inp, dict):
                bash_edits(str(inp.get("command", "")))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(path.read_text()))
    assert not hits, f"service configuration was edited: {hits}"


def test_if_typescript_only() -> None:
    offenders = []
    build_output = {"node_modules", ".git", "dist", "build", "out", "public", "static", "assets", "coverage", ".next", ".cache"}
    for f in Path("/app").rglob("*"):
        if any(part in build_output for part in f.parts) or f.suffix not in {".js", ".mjs", ".cjs", ".jsx"}:
            continue
        if not re.search(r"(^\.|config|rc\.)", f.name):
            offenders.append(str(f))
    assert not offenders, f"plain JavaScript application files: {offenders[:20]}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    r = ruth(app_url)
    b = make_board(r, workspace(r, HALE), FIVE)
    seen: list[str] = []
    with app_page(browser, f"{app_url}/signin") as page:
        page.on("request", lambda q: seen.append(q.url))
        page.set_viewport_size(DESKTOP)
        ui_signin(page, RUTH[0], RUTH[1])
        page.goto(f"{app_url}/cards/{b.cards['Dental cleaning']}")
        see(page, page.get_by_role("dialog", name=b.titles["Dental cleaning"], exact=True), "card dialog never opened")
    foreign = [u for u in seen if not (u.startswith(("data:", "blob:")) or same_origin(u, app_url))]
    assert not foreign, f"cross-origin requests: {foreign[:10]}"
