from __future__ import annotations

import contextlib
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
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    animations,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    tap,
)


TOKEN = os.environ.get("GRADING_TOKEN", "")
PASSWORD = "deedfall-demo"
WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MINUS = "\u2212"
MAX_HEALTH = Decimal("50.0")
LEVEL_STEP = 25
FAINT_SHARE = Decimal("0.10")
PRICE_MAX = Decimal("9999.99")
USERNAME_MAX = 20
TITLE_MAX = 80
PARTY_NAME_MAX = 40
PARTY_MAX = 4
CHAT_LIMIT = 5
CHAT_MAX_CHARS = 500
IMPORT_LIMIT = 100_000
BANNER_LIMIT = 2_000_000
JSON_LIMIT = 64_000
LIVE_BUDGET_S = 2
REST_BANNER_S = 1
CLOSE_DEADLINE_S = 60
MOTION_MAX_MS = 600
BADGE_MIN_PX = 96
TOUCH_MIN_PX = 44
SEAM_TOLERANCE_PX = 1
SWIPE_PX = 80
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)

HTTP_TIMEOUT_S = 30
SETTLE_S = 15
POLL_SLACK_S = 2
STEP_MS = 100
POLL_MS = 250
BACKOFF_S = 0.2
SUBPIXEL_PX = 0.5
LAYOUT_SLACK_PX = 8
SHORT_UNDO_S = 3
SHORT_INVITE_S = 5
WAIT_MARGIN_S = 1.5
TAB_PRESSES = 12
BOOT_DEADLINE_S = 180

DROWSE = "Wake the Drowsewyrm"
CLUTTER = "Hush the Clutterhound"
MOTH = "Dim the Gloamtide Moth"
QUESTS = {
    DROWSE: {"boss": "Drowsewyrm", "max": Decimal("400.0"), "power": Decimal("1.5"), "gold": Decimal("25.00"), "xp": 100},
    CLUTTER: {"boss": "Clutterhound", "max": Decimal("250.0"), "power": Decimal("1.0"), "gold": Decimal("15.00"), "xp": 60},
    MOTH: {"boss": "Gloamtide Moth", "max": Decimal("600.0"), "power": Decimal("2.0"), "gold": Decimal("40.00"), "xp": 150},
}
DIFFICULTY = {"trivial": Decimal("0.5"), "easy": Decimal("1"), "medium": Decimal("1.5"), "hard": Decimal("2")}
LEDGER_KINDS = {"task", "reward", "quest", "faint", "undo"}
REST_BANNER = "Resting: missed dailies will not hurt you or your party."
STALE_COPY = "This task changed on another device. Close and reopen it to edit."
EMPTY_SENTENCES = {
    "Habits": "No habits yet. Add one to start scoring.",
    "Dailies": "No dailies yet. Pick the days that matter.",
    "To-dos": "No to-dos. Add one, or enjoy the quiet.",
    "Rewards": "No rewards yet. Name a treat worth the gold.",
}
WRONG_CLOCKS = ["2031-01-04T23:30:00Z", "2019-07-15T03:00:00Z"]
EVIL_ORIGIN = "http://evil.invalid"
APP = Path("/app")
RENAMED = "Drink two glasses of water"
PHONE_ITEM = "Find the phone number"
SNACK_ITEM = "Pack a snack"
IMPORT_NAME = "routine.deedlist"
GRADED_DATE = "2027-05-03"


def dec(value: Any) -> Decimal:
    return Decimal(str(value))


def q(value: Decimal, places: str) -> Decimal:
    return Decimal(value).quantize(Decimal(places), ROUND_HALF_UP)


def g2(value: Any) -> str:
    return str(q(dec(value), "0.01"))


def h1(value: Any) -> str:
    return str(q(dec(value), "0.1"))


def band(v: int) -> tuple[str, Decimal]:
    if v <= -10:
        return "Crimson", Decimal("2")
    if v <= -1:
        return "Amber", Decimal("1.5")
    if v <= 4:
        return "Sand", Decimal("1")
    if v <= 9:
        return "Teal", Decimal("0.75")
    return "Blue", Decimal("0.5")


def clamp(v: int) -> int:
    return max(-20, min(20, v))


def earned_xp(difficulty: str, v: int, checked: int = 0, total: int = 0) -> int:
    bonus = Decimal(1) + Decimal("0.5") * Decimal(checked) / Decimal(total) if total else Decimal(1)
    return int(q(10 * DIFFICULTY[difficulty] * band(v)[1] * bonus, "1"))


def gold_for(xp: int) -> Decimal:
    return q(Decimal(xp) / 10, "0.01")


def damage_for(xp: int) -> Decimal:
    return q(Decimal(xp) / 2, "0.1")


def health_loss(difficulty: str, v: int) -> Decimal:
    return q(2 * DIFFICULTY[difficulty] * band(v)[1], "0.1")


def apply_xp(level: int, xp: int, gained: int) -> tuple[int, int]:
    xp += gained
    for _ in range(100):
        if xp < LEVEL_STEP * level:
            return level, xp
        xp -= LEVEL_STEP * level
        level += 1
    pytest.fail("level rule did not settle")


def instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def close_instant(zone: str, day: date, hour: int) -> datetime:
    nxt = day + timedelta(days=1)
    return datetime(nxt.year, nxt.month, nxt.day, hour, tzinfo=ZoneInfo(zone)).astimezone(timezone.utc)


def day_start_text(at: datetime, zone: str) -> str:
    local = at.astimezone(ZoneInfo(zone))
    return f"{WEEK[local.weekday()]} {local:%H:%M} ({zone})"


def ensure(condition: bool, message: str = "") -> None:
    if not condition:
        raise AssertionError(message)


def poll(check: Callable[[], Any], what: str, seconds: float = SETTLE_S) -> Any:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return check()
        except AssertionError as exc:
            last = exc
        pause.wait(BACKOFF_S)
    pytest.fail(f"{what} (last check: {last})")


def holds(check: Callable[[], Any], what: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while time.monotonic() < deadline:
        try:
            check()
        except AssertionError as exc:
            pytest.fail(f"{what}: {exc}")
        pause.wait(BACKOFF_S)


def wait_out(seconds: float, player: "Player") -> None:
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while time.monotonic() < deadline:
        player.get("/api/me")
        pause.wait(BACKOFF_S)


def origin_of(base: str) -> str:
    u = httpx.URL(base)
    return f"{u.scheme}://{u.host}" + (f":{u.port}" if u.port else "")


def uname(tag: str) -> str:
    return (tag + uuid.uuid4().hex)[:USERNAME_MAX]


def pname(tag: str) -> str:
    return f"{tag} {uuid.uuid4().hex[:8]}"


def outage_url(var: str) -> str:
    url = os.environ.get(var, "")
    assert url, f"{var} must name the outage instance"
    return url.rstrip("/")


def answered(r: httpx.Response, status: int, body: Any = None, what: str = "") -> Any:
    label = what or f"{r.request.method} {r.request.url.path}"
    assert r.status_code == status, f"{label} answered {r.status_code} {r.text[:400]}; expected {status}"
    if body is not None:
        assert r.json() == body, f"{label} body {r.text[:400]}; expected {body}"
    if r.content and r.headers.get("content-type", "").startswith("application/json"):
        return r.json()
    return None


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(HTTP_TIMEOUT_S)
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


class Player:
    def __init__(self, base: str, username: str, password: str = PASSWORD, login: bool = True):
        self.base, self.username, self.password = base, username, password
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, headers={"Origin": origin_of(base)})
        if login:
            answered(self.http.post("/api/auth/login", json={"username": username, "password": password}), 200,
                     what=f"sign-in of {username}")

    @classmethod
    def signup(cls, base: str, username: str) -> "Player":
        p = cls(base, username, login=False)
        answered(p.http.post("/api/auth/signup", json={"username": username, "password": PASSWORD}), 201)
        return p

    @property
    def cookie(self) -> str:
        value = self.http.cookies.get("deed_session")
        assert value, "sign-in set no deed_session cookie"
        return value

    def get(self, path: str) -> httpx.Response:
        return self.http.get(path)

    def post(self, path: str, body: Any = None, key: str | None = None) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, headers={"Idempotency-Key": key} if key else {})

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def me(self) -> dict:
        return answered(self.get("/api/me"), 200)

    def tasks(self) -> dict:
        return answered(self.get("/api/tasks"), 200)

    def task(self, task_id: str) -> dict:
        for items in self.tasks().values():
            for t in items:
                if t["id"] == task_id:
                    return t
        pytest.fail(f"GET /api/tasks did not list task {task_id}")

    def quest(self, quest_id: str) -> dict:
        return answered(self.get(f"/api/quests/{quest_id}"), 200)

    def ledger(self) -> list[dict]:
        led = answered(self.get("/api/gold/ledger"), 200)
        total = sum((dec(e["amount"]) for e in led["entries"]), Decimal(0))
        assert dec(led["balance"]) == total, f"ledger balance {led['balance']} != sum of entries {total}"
        assert dec(self.me()["gold"]) == total, "Player gold differs from the ledger sum"
        assert {e["kind"] for e in led["entries"]} <= LEDGER_KINDS, led["entries"]
        return led["entries"]


def grading(base: str, path: str, body: Any, token: str | None = None) -> httpx.Response:
    headers = {"Origin": origin_of(base)}
    if token is not None:
        headers["X-Grading-Token"] = token
    return httpx.post(base + path, json=body, headers=headers, timeout=HTTP_TIMEOUT_S)


def setup(base: str, body: dict) -> dict:
    full = {"users": [], "parties": [], "quests": [], "tasks": [], **body}
    return answered(grading(base, "/api/grading/setup", full, TOKEN), 201)


def rollover(base: str, at: str) -> list[dict]:
    return answered(grading(base, "/api/grading/rollover", {"at": at}, TOKEN), 200)["closes"]


def closes_of(closes: list[dict], username: str) -> list[dict]:
    return [c for c in closes if c["username"] == username]


def world(base: str, users: list[dict], parties: Any = (), quests: Any = (), tasks: Any = ()) -> tuple[dict, dict]:
    ids = setup(base, {"users": [{"password": PASSWORD, **u} for u in users], "parties": list(parties),
                       "quests": list(quests), "tasks": list(tasks)})
    return ids, {u["username"]: Player(base, u["username"]) for u in users}


def T(owner: str, kind: str, title: str, **fields: Any) -> dict:
    spec: dict[str, Any] = {"owner": owner, "type": kind, "title": title}
    if kind != "reward":
        spec["difficulty"] = fields.pop("difficulty", "easy")
    if kind == "daily":
        spec["weekdays"] = fields.pop("weekdays", WEEK)
    if "checklist" in fields:
        fields["checklist"] = [{"text": t, "checked": c} for t, c in fields["checklist"]]
    spec.update(fields)
    return spec


def P(name: str, leader: str, *members: str) -> dict:
    return {"name": name, "leader": leader, "members": list(members)}


def Q(party: str, quest: str, **fields: Any) -> dict:
    return {"party": party, "quest": quest, "state": "active", **fields}


def utc_today(base: str) -> date:
    probe = uname("day")
    ids = setup(base, {"users": [{"username": probe, "password": PASSWORD}]})
    return date.fromisoformat(ids["users"][probe]["today"])


def png(rgb: tuple[int, int, int], size: int = 8) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + bytes(64) + b"\xff\xd9"


def padded(head: bytes, size: int) -> bytes:
    return head + b"#" * (size - len(head))


def upload_import(p: Player, name: str, data: bytes, ctype: str = "text/plain") -> httpx.Response:
    return p.http.post("/api/imports", files={"file": (name, data, ctype)})


def upload_banner(p: Player, party_id: str, name: str, data: bytes, ctype: str = "image/png") -> httpx.Response:
    return p.http.put(f"/api/parties/{party_id}/banner", files={"file": (name, data, ctype)})


class LiveStream:

    def __init__(self, player: Player):
        self.events: list[tuple[str, Any]] = []
        self.cond = threading.Condition()
        self.opened = threading.Event()
        self.status, self.ctype = 0, ""
        self.client = httpx.Client(base_url=player.base, cookies=player.http.cookies,
                                   timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=None))
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        try:
            with self.client.stream("GET", "/api/live") as r:
                self.status, self.ctype = r.status_code, r.headers.get("content-type", "")
                self.opened.set()
                name, data = "", []
                for line in r.iter_lines():
                    if line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
                    elif line == "":
                        if name and data:
                            try:
                                payload = json.loads("\n".join(data))
                            except ValueError:
                                payload = None
                            with self.cond:
                                self.events.append((name, payload))
                                self.cond.notify_all()
                        name, data = "", []
        except (httpx.HTTPError, RuntimeError, ValueError):
            self.opened.set()

    def __enter__(self) -> "LiveStream":
        self.thread.start()
        assert self.opened.wait(HTTP_TIMEOUT_S), "GET /api/live never answered"
        assert self.status == 200 and self.ctype.startswith("text/event-stream"), \
            f"GET /api/live answered {self.status} {self.ctype}"
        return self

    def __exit__(self, *exc: Any) -> None:
        self.client.close()

    def seen(self, match: Callable[[str, Any], bool]) -> bool:
        with self.cond:
            return any(isinstance(p, dict) and match(n, p) for n, p in self.events)

    def wait(self, name: str, match: Callable[[dict], bool], what: str,
             seconds: float = LIVE_BUDGET_S + POLL_SLACK_S) -> None:
        deadline = time.monotonic() + seconds
        with self.cond:
            while time.monotonic() < deadline:
                for n, p in self.events:
                    if n == name and isinstance(p, dict):
                        with contextlib.suppress(KeyError, TypeError, AttributeError):
                            if match(p):
                                return
                self.cond.wait(max(0.0, deadline - time.monotonic()))
        pytest.fail(f"/api/live sent no `{name}` event with {what} within {LIVE_BUDGET_S}s")


def role(scope: Page | Locator, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


@contextlib.contextmanager
def screen(browser: Browser, player: Player, path: str = "/board", *, viewport: tuple[int, int] = DESKTOP,
           clock_at: str | None = None, **options: Any) -> Iterator[Page]:
    with open_app(browser, player.base + "/signin", **options) as page:
        page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        page.context.add_cookies([{"name": "deed_session", "value": player.cookie, "url": player.base}])
        if clock_at:
            page.clock.set_system_time(clock_at)
        page.goto(player.base + path)
        yield page


def eventually(page: Page, assertion: Callable[[], Any], what: str, seconds: float = SETTLE_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            assertion()
            return
        except AssertionError as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(f"{what} (last check: {last})")


def live(page: Page, assertion: Callable[[], Any], what: str) -> None:
    eventually(page, assertion, f"{what} within {LIVE_BUDGET_S}s", LIVE_BUDGET_S + POLL_SLACK_S)


def quiet(page: Page, assertion: Callable[[], Any], what: str, seconds: float = LIVE_BUDGET_S + POLL_SLACK_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            assertion()
        except AssertionError as exc:
            pytest.fail(f"{what}: {exc}")
        advance(page, STEP_MS)


def shows(loc: Locator) -> None:
    expect(loc.first).to_be_visible(timeout=POLL_MS)


def text_is(loc: Locator, text: str) -> None:
    expect(loc.first).to_have_text(text, timeout=POLL_MS)


def see(page: Page, loc: Locator, what: str, seconds: float = SETTLE_S) -> None:
    eventually(page, lambda: shows(loc), what, seconds)


def value_text(loc: Locator) -> str:
    return loc.first.evaluate("e => (e.getAttribute('aria-valuetext') ?? e.textContent ?? '').trim()", timeout=POLL_MS)


def value_now(loc: Locator) -> float:
    return float(loc.first.evaluate("e => e.getAttribute('aria-valuenow') ?? String(e.value)", timeout=POLL_MS))


def meter_reads(loc: Locator, text: str) -> None:
    actual = value_text(loc)
    ensure(actual == text, f"meter value text {actual!r}, expected {text!r}")


def chosen(loc: Locator) -> str:
    return loc.first.evaluate(
        "e => e.tagName === 'SELECT' ? (e.options[e.selectedIndex]?.text ?? '').trim()"
        " : (e.value || e.textContent || '').trim()", timeout=POLL_MS)


def holds_focus(loc: Locator) -> bool:
    return loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)",
                              timeout=POLL_MS)


def focused(page: Page, loc: Locator, what: str) -> None:
    eventually(page, lambda: ensure(holds_focus(loc), what), what)


def lines(loc: Locator) -> list[str]:
    return [" ".join(t.split()) for t in loc.first.get_by_role("listitem").all_inner_texts()]


def ready(page: Page) -> None:
    see(page, role(page, "meter", "Health"), "player bar health meter")


def habit_row(page: Page, title: str, v: int) -> Locator:
    return role(page, "listitem", f"Habit: {title}, score {v}")


def daily_row(page: Page, title: str, due: bool, streak: int, done: bool) -> Locator:
    return role(page, "listitem", f"Daily: {title}, {'due today' if due else 'not due today'}, "
                                  f"streak {streak}, {'done' if done else 'not done'}")


def todo_row(page: Page, title: str, done: bool, checklist: tuple[int, int] | None = None) -> Locator:
    items = f", {checklist[0]} of {checklist[1]} checklist items" if checklist else ""
    return role(page, "listitem", f"To-do: {title}{items}, {'done' if done else 'not done'}")


def reward_row(page: Page, title: str, price: Any) -> Locator:
    return role(page, "listitem", f"Reward: {title}, costs {g2(price)} gold")


def rest_banner(page: Page) -> Locator:
    return page.get_by_role("status").filter(has_text=REST_BANNER)


FEED_JS = """el => {
  window.__feed = window.__feed || [];
  const push = () => {
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t && window.__feed[window.__feed.length - 1] !== t) window.__feed.push(t);
  };
  push();
  new MutationObserver(push).observe(el, {subtree: true, childList: true, characterData: true});
}"""


def record_feed(page: Page) -> None:
    feed = role(page, "status", "Game feed")
    expect(feed).to_be_attached(timeout=SETTLE_S * 1000)
    feed.evaluate(FEED_JS)


def feed_log(page: Page) -> str:
    return " || ".join(page.evaluate("window.__feed || []"))


def heard(page: Page, sentence: str, seconds: float = SETTLE_S) -> None:
    eventually(page, lambda: ensure(sentence in feed_log(page), f"feed so far: {feed_log(page)!r}"),
               f'"Game feed" announces {sentence!r}', seconds)


def slid_in(loc: Locator) -> Locator:
    def check() -> None:
        try:
            inside = loc.first.evaluate(
                "e => { const d = e.closest('[role=dialog]'); if (!d) return true; const r = d.getBoundingClientRect();"
                " return r.left >= -1 && r.right <= window.innerWidth + 1; }", timeout=POLL_MS)
        except Exception as exc:
            raise AssertionError(str(exc)[:200]) from exc
        ensure(inside, "sheet still sliding in")
    eventually(loc.page, check, "the sheet slides fully in")
    return loc


def closed(page: Page, loc: Locator, what: str) -> None:
    def check() -> None:
        if loc.count() == 0 or not loc.first.is_visible():
            return
        try:
            box = loc.first.bounding_box(timeout=POLL_MS)
        except PlaywrightTimeout:
            return
        ensure(box is None or box["x"] >= page.viewport_size["width"] or box["x"] + box["width"] <= 0, what)
    eventually(page, check, what)


def touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def swipe(page: Page, cdp: Any, loc: Locator, dx: float) -> None:
    box = loc.first.bounding_box()
    assert box, "row has no box to swipe"
    x, y = box["x"] + box["width"] / 3, box["y"] + box["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    steps = 8
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / steps, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, MOTION_MAX_MS)


def seam_share(page: Page) -> tuple[float, float]:
    region = role(page, "region", "Quest")
    panel = region.locator('[data-seam="panel"]').first.bounding_box(timeout=POLL_MS)
    remaining = region.locator('[data-seam="remaining"]').first.bounding_box(timeout=POLL_MS)
    ensure(bool(panel and remaining), "Health Seam hooks not rendered")
    return panel["height"], remaining["height"]


def seam_at(page: Page, share: Decimal) -> None:
    panel, remaining = seam_share(page)
    want = panel * float(share)
    ensure(abs(remaining - want) <= SEAM_TOLERANCE_PX,
           f"remaining-health field {remaining:.1f}px of {panel:.1f}px; expected {want:.1f}px")


def test_seed_data(app_url):
    mira, tomas, ines = (Player(app_url, n) for n in ("mira", "tomas", "ines"))
    for p, zone, hour in ((mira, "Europe/Lisbon", 0), (tomas, "America/Toronto", 6), (ines, "Asia/Manila", 4)):
        me = p.me()
        assert (me["username"], me["timeZone"], me["dayStartHour"]) == (p.username, zone, hour), me
    party = answered(mira.get("/api/party"), 200)["party"]
    assert party["name"] == "Lantern Crew" and party["leader"] == "mira"
    assert {m["username"] for m in party["members"]} == {"mira", "tomas", "ines"}
    quest = mira.quest(party["questId"])
    assert quest["name"] == DROWSE
    strikes = [(e["username"], dec(e["amount"])) for e in quest["events"] if e["kind"] == "strike"][:3]
    assert strikes == [("mira", Decimal("100.0")), ("tomas", Decimal("60.0")), ("ines", Decimal("27.4"))]
    texts = [m["text"] for m in answered(mira.get(f"/api/parties/{party['id']}/chat"), 200)["messages"]]
    assert texts[:2] == ["Drowsewyrm is wobbling. One more push tonight.", "Walking the dog counts, right?"]
    expected = {
        mira: {"habits": {"Drink a glass of water", "Doomscroll after midnight"},
               "dailies": {"Stretch for ten minutes", "Read one chapter"}, "todos": {"Book the dentist"},
               "rewards": {"Fancy coffee", "Episode of a show"}},
        tomas: {"habits": {"Take the stairs"}, "dailies": {"Walk the dog"}, "todos": {"Return library books"},
                "rewards": {"New paperback"}},
        ines: {"dailies": {"Practice guitar"}, "rewards": {"Bubble tea"}},
    }
    for p, lists in expected.items():
        tasks = p.tasks()
        for name, titles in lists.items():
            assert titles <= {t["title"] for t in tasks[name]}, f"{p.username} {name}: {[t['title'] for t in tasks[name]]}"


def test_wf_keyboard_lists_add_by_keyboard(browser, app_url):
    u = uname("kbd")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    plan = [
        ("Habits", "Habit", "Drink a glass of water", {}, "Habit: Drink a glass of water, score 0"),
        ("Dailies", "Daily", "Walk the dog", {}, "Daily: Walk the dog, due today, streak 0, not done"),
        ("To-dos", "To-do", "Book the dentist", {"Checklist": "Find the number\nCall before noon"},
         "To-do: Book the dentist, 0 of 2 checklist items, not done"),
        ("Rewards", "Reward", "Fancy coffee", {"Price": "5"}, "Reward: Fancy coffee, costs 5.00 gold"),
    ]
    with screen(browser, p) as page:
        ready(page)
        for sentence in EMPTY_SENTENCES.values():
            see(page, page.get_by_text(sentence, exact=True), f"empty-state sentence {sentence!r}")
        for list_name, type_label, title, extra, row_name in plan:
            role(page, "list", list_name).focus()
            page.keyboard.press("n")
            dialog = role(page, "dialog", "New task")
            see(page, dialog, f'N in {list_name} opens "New task"')
            assert chosen(role(dialog, "combobox", "Type")) == type_label, f"N in {list_name} did not preselect {type_label}"
            fill(slid_in(role(dialog, "textbox", "Title")), title)
            for label, value in extra.items():
                fill(slid_in(role(dialog, "textbox", label)), value)
            role(dialog, "button", "Save task").press("Enter")
            see(page, role(page, "listitem", row_name), f"new row {row_name!r}")
            focused(page, role(page, "listitem", row_name), "after a create, focus goes to the new row")
        daily = role(page, "listitem", "Daily: Walk the dog, due today, streak 0, not done")
        daily.focus()
        page.keyboard.press("Space")
        see(page, daily_row(page, "Walk the dog", True, 0, True), "Space completes the focused daily")
        habit_row(page, "Drink a glass of water", 0).focus()
        page.keyboard.press("+")
        see(page, habit_row(page, "Drink a glass of water", 1), "+ scores the focused habit up")
        page.reload()
        for name in ("Habit: Drink a glass of water, score 1", "Daily: Walk the dog, due today, streak 0, done",
                     "To-do: Book the dentist, 0 of 2 checklist items, not done", "Reward: Fancy coffee, costs 5.00 gold"):
            see(page, role(page, "listitem", name), f"{name!r} after reload")
    t = p.tasks()
    assert [x["title"] for x in t["habits"]] == ["Drink a glass of water"] and t["habits"][0]["value"] == 1
    assert t["dailies"][0]["done"] is True and t["dailies"][0]["weekdays"] == WEEK
    assert [i["text"] for i in t["todos"][0]["checklist"]] == ["Find the number", "Call before noon"]
    assert dec(t["rewards"][0]["price"]) == Decimal("5")


def test_wf_keyboard_lists_focus_and_dialogs(browser, app_url):
    u = uname("foc")
    ids, ps = world(app_url, [{"username": u}], tasks=[
        T(u, "habit", "Drink a glass of water"), T(u, "habit", "Doomscroll after midnight", difficulty="medium"),
        T(u, "daily", "Walk the dog"), T(u, "todo", "Return library books", difficulty="trivial"),
        T(u, "reward", "Fancy coffee", price=5)])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        h1_, h2_ = habit_row(page, "Drink a glass of water", 0), habit_row(page, "Doomscroll after midnight", 0)
        daily = daily_row(page, "Walk the dog", True, 0, False)
        todo = todo_row(page, "Return library books", False)
        reward = reward_row(page, "Fancy coffee", 5)
        see(page, h1_, "first habit row")
        h1_.focus()
        for key, target, why in [("ArrowDown", h2_, "ArrowDown moves to the next row"),
                                 ("ArrowDown", h2_, "ArrowDown stops at the last row"),
                                 ("ArrowRight", daily, "ArrowRight lands on the shorter list's last row"),
                                 ("ArrowRight", todo, "ArrowRight reaches To-dos"),
                                 ("ArrowRight", reward, "ArrowRight reaches Rewards"),
                                 ("ArrowRight", reward, "focus does not wrap past Rewards"),
                                 ("ArrowLeft", todo, "ArrowLeft goes back to To-dos")]:
            page.keyboard.press(key)
            focused(page, target, why)
        reward.focus()
        page.keyboard.press("Enter")
        edit = role(page, "dialog", "Edit task")
        see(page, edit, 'Enter on a reward row opens "Edit task"')
        focused(page, edit, "focus moves into the sheet")
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            assert holds_focus(edit), "Tab moved focus out of the open sheet"
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Shift+Tab")
            assert holds_focus(edit), "Shift+Tab moved focus out of the open sheet"
        page.keyboard.press("Escape")
        closed(page, edit, 'Escape closes "Edit task"')
        focused(page, reward, "focus returns to the reward row after Escape")
        role(h1_, "button", "Score Drink a glass of water up").focus()
        page.keyboard.press("n")
        new = role(page, "dialog", "New task")
        see(page, new, "N works with focus on a row's own button")
        assert chosen(role(new, "combobox", "Type")) == "Habit"
        role(new, "button", "Cancel").press("Enter")
        closed(page, new, 'Cancel closes "New task"')
        focused(page, h1_, "focus returns to the row that opened the sheet")
        h1_.focus()
        page.keyboard.press("Enter")
        see(page, edit, 'Enter on a habit row opens "Edit task"')
        role(edit, "button", "Delete task").press("Enter")
        focused(page, h2_, "after a delete focus moves to the row that took its place")
        box = role(page, "textbox", "Party name")
        box.focus()
        page.keyboard.press("+")
        page.keyboard.press("n")
        advance(page, MOTION_MAX_MS)
        assert role(page, "dialog", "New task").count() == 0 or not role(page, "dialog", "New task").is_visible(), \
            "N in a text field opened New task"
    habits = p.tasks()["habits"]
    assert [(h["title"], h["value"]) for h in habits] == [("Doomscroll after midnight", 0)]


def test_wf_keyboard_lists_reorder(browser, app_url):
    u = uname("ord")
    _, ps = world(app_url, [{"username": u}], tasks=[
        T(u, "habit", "Drink a glass of water"), T(u, "habit", "Doomscroll after midnight"), T(u, "habit", "Take the stairs")])
    p = ps[u]

    def order() -> list[str]:
        return [h["title"] for h in p.tasks()["habits"]]

    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = habit_row(page, "Drink a glass of water", 0)
        see(page, row, "habit row")
        row.focus()
        page.keyboard.press("Alt+ArrowDown")
        heard(page, "Drink a glass of water moved to position 2 of 3")
        assert holds_focus(row), "focus left the moved task"
        eventually(page, lambda: ensure(order() == ["Doomscroll after midnight", "Drink a glass of water", "Take the stairs"],
                                        str(order())), "server order after Alt+ArrowDown")
        page.keyboard.press("Alt+ArrowDown")
        heard(page, "Drink a glass of water moved to position 3 of 3")
        before = feed_log(page).count("moved to position")
        page.keyboard.press("Alt+ArrowDown")
        quiet(page, lambda: ensure(feed_log(page).count("moved to position") == before, "announced a move at the bottom"),
              "Alt+ArrowDown at the bottom announces nothing")
        assert order() == ["Doomscroll after midnight", "Take the stairs", "Drink a glass of water"]
        page.keyboard.press("Alt+ArrowUp")
        heard(page, "Drink a glass of water moved to position 2 of 3")
        assert holds_focus(row)
        eventually(page, lambda: ensure(order()[1] == "Drink a glass of water", str(order())), "server order after Alt+ArrowUp")
        page.reload()
        rows = [habit_row(page, t, 0) for t in ("Doomscroll after midnight", "Drink a glass of water", "Take the stairs")]
        for r in rows:
            see(page, r, "row after reload")
        ys = [r.bounding_box()["y"] for r in rows]
        assert ys == sorted(ys), f"rows after reload not in the saved order: {ys}"
    assert [h["position"] for h in p.tasks()["habits"]] == [1, 2, 3]


def test_task_api_and_ordering(app_url):
    u, o = uname("api"), uname("apo")
    _, ps = world(app_url, [{"username": u}, {"username": o}])
    p, other = ps[u], ps[o]
    habit = answered(p.post("/api/tasks", {"type": "habit", "title": "Drink a glass of water", "difficulty": "easy"}), 201)
    assert habit["type"] == "habit" and habit["value"] == 0 and habit["band"] == "Sand" and habit["position"] == 1
    assert habit["weekdays"] is None and habit["checklist"] is None and habit["price"] is None
    daily = answered(p.post("/api/tasks", {"type": "daily", "title": "Walk the dog", "difficulty": "medium",
                                           "weekdays": ["Mon", "Wed", "Fri"]}), 201)
    assert daily["weekdays"] == ["Mon", "Wed", "Fri"] and daily["streak"] == 0 and daily["done"] is False
    assert daily["price"] is None and daily["position"] == 1
    todo = answered(p.post("/api/tasks", {"type": "todo", "title": "Book the dentist", "difficulty": "hard",
                                          "checklist": ["Find the number", "Call before noon"]}), 201)
    assert [(i["text"], i["checked"]) for i in todo["checklist"]] == [("Find the number", False), ("Call before noon", False)]
    reward = answered(p.post("/api/tasks", {"type": "reward", "title": "Fancy coffee", "price": 5}), 201)
    assert dec(reward["price"]) == Decimal("5") and reward["value"] is None and reward["weekdays"] is None
    bad = [
        ({"type": "habit", "title": "", "difficulty": "easy"}, "title", "Title must be 1 to 80 characters."),
        ({"type": "habit", "title": "x" * (TITLE_MAX + 1), "difficulty": "easy"}, "title", "Title must be 1 to 80 characters."),
        ({"type": "habit", "title": "Take the stairs", "difficulty": "epic"}, "difficulty", "Choose trivial, easy, medium or hard."),
        ({"type": "daily", "title": "Walk the dog", "difficulty": "easy", "weekdays": []}, "weekdays", "Choose at least one weekday."),
        ({"type": "reward", "title": "Bubble tea", "price": 0}, "price", "Price must be from 0.01 to 9999.99."),
        ({"type": "reward", "title": "Bubble tea", "price": float(PRICE_MAX + Decimal("0.01"))}, "price",
         "Price must be from 0.01 to 9999.99."),
    ]
    for body, field, message in bad:
        answered(p.post("/api/tasks", body), 422, {"errors": {field: message}}, what=f"create {body}")
    longest = answered(p.post("/api/tasks", {"type": "habit", "title": "x" * TITLE_MAX, "difficulty": "easy"}), 201)
    answered(p.http.delete(f"/api/tasks/{longest['id']}"), 204)
    for title in ("Take the stairs", "Doomscroll after midnight", "Read one chapter"):
        answered(p.post("/api/tasks", {"type": "habit", "title": title, "difficulty": "easy"}), 201)
    habits = p.tasks()["habits"]
    assert [h["position"] for h in habits] == [1, 2, 3, 4]
    by = {h["title"]: h for h in habits}
    edited = answered(p.patch(f"/api/tasks/{habit['id']}", {"updatedAt": by["Drink a glass of water"]["updatedAt"],
                                                           "title": RENAMED}), 200)
    assert edited["title"] == RENAMED and edited["position"] == 1
    first, second = todo["checklist"]
    ticked = answered(p.patch(f"/api/tasks/{todo['id']}/checklist/{first['id']}", {"checked": True}), 200)
    changed = answered(p.patch(f"/api/tasks/{todo['id']}", {"updatedAt": ticked["updatedAt"], "checklist": [
        {"id": first["id"], "text": "Find the phone number"}, {"text": "Pack a snack"}]}), 200)
    items = changed["checklist"]
    assert len(items) == 2 and items[0]["id"] == first["id"] and items[0]["text"] == PHONE_ITEM and items[0]["checked"] is True
    assert items[1]["text"] == SNACK_ITEM and items[1]["checked"] is False and items[1]["id"] != second["id"]
    answered(p.http.delete(f"/api/tasks/{by['Take the stairs']['id']}"), 204)
    habits = p.tasks()["habits"]
    assert [(h["title"], h["position"]) for h in habits] == [
        (RENAMED, 1), ("Doomscroll after midnight", 2), ("Read one chapter", 3)]
    moved = answered(p.post(f"/api/tasks/{by['Read one chapter']['id']}/move", {"position": 1}), 200)["tasks"]
    assert [(t["title"], t["position"]) for t in moved] == [
        ("Read one chapter", 1), (RENAMED, 2), ("Doomscroll after midnight", 3)]
    for pos in (0, 4):
        answered(p.post(f"/api/tasks/{habit['id']}/move", {"position": pos}), 422,
                 {"errors": {"position": "Position must be from 1 to 3."}})
    answered(p.post(f"/api/tasks/{by['Doomscroll after midnight']['id']}/move", {"position": 1}), 200)
    answered(p.post(f"/api/tasks/{habit['id']}/move", {"position": 1}), 200)
    assert [h["title"] for h in p.tasks()["habits"]] == [RENAMED, "Doomscroll after midnight", "Read one chapter"]
    ra, rb = together(lambda: p.post(f"/api/tasks/{by['Read one chapter']['id']}/move", {"position": 1}),
                      lambda: p.post(f"/api/tasks/{habit['id']}/move", {"position": 3}))
    final = [h["title"] for h in p.tasks()["habits"]]
    replies = [[t["title"] for t in answered(r, 200)["tasks"]] for r in (ra, rb)]
    assert final in replies, f"final order {final} is not the result of the last applied move {replies}"
    assert [h["position"] for h in p.tasks()["habits"]] == [1, 2, 3]
    nf = {"error": "not_found"}
    answered(other.patch(f"/api/tasks/{habit['id']}", {"updatedAt": edited["updatedAt"], "title": "Mine"}), 404, nf)
    answered(other.http.delete(f"/api/tasks/{habit['id']}"), 404, nf)
    answered(other.post(f"/api/tasks/{habit['id']}/move", {"position": 1}), 404, nf)
    assert all(t["id"] != habit["id"] for items in other.tasks().values() for t in items)
    type_error = {"errors": {"type": "This action does not fit this task type."}}
    answered(p.post(f"/api/tasks/{daily['id']}/score", {"direction": "up"}), 422, type_error)
    answered(p.post(f"/api/tasks/{habit['id']}/complete"), 422, type_error)
    answered(p.post(f"/api/tasks/{habit['id']}/score", {"direction": "sideways"}), 422,
             {"errors": {"direction": "Direction must be up or down."}})


def test_stale_edit_protection(browser, app_url):
    u = uname("stl")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Drink a glass of water")])
    p = ps[u]
    tid = ids["tasks"][u]["Drink a glass of water"]
    old = p.task(tid)["updatedAt"]
    fresh = answered(p.patch(f"/api/tasks/{tid}", {"updatedAt": old, "title": "Drink two glasses of water"}), 200)
    answered(p.patch(f"/api/tasks/{tid}", {"updatedAt": old, "title": "Doomscroll after midnight"}), 409, {"error": "stale_task"})
    assert p.task(tid)["title"] == RENAMED
    with screen(browser, p) as page:
        row = habit_row(page, "Drink two glasses of water", 0)
        see(page, row, "habit row")
        row.focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Edit task")
        see(page, dialog, '"Edit task" sheet')
        fill(slid_in(role(dialog, "textbox", "Title")), "Take the stairs")
        answered(p.patch(f"/api/tasks/{tid}", {"updatedAt": fresh["updatedAt"], "title": "Drink a glass of water"}), 200)
        save = role(dialog, "button", "Save task")
        if save.is_enabled():
            save.click()
        see(page, dialog.get_by_role("alert").filter(has_text=STALE_COPY), "stale copy inside Edit task")
    assert p.task(tid)["title"] == "Drink a glass of water"


def test_wf_keyboard_lists_live_second_device(browser, app_url):
    u = uname("dev")
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Drink a glass of water", value=3), T(u, "daily", "Walk the dog")])
    p = ps[u]
    xp = earned_xp("easy", 3)
    with screen(browser, p) as phone, screen(browser, p) as laptop:
        ready(phone)
        ready(laptop)
        see(laptop, habit_row(laptop, "Drink a glass of water", 3), "habit row on the laptop")
        click(role(laptop, "button", "Score Drink a glass of water up"))
        live(phone, lambda: shows(habit_row(phone, "Drink a glass of water", 4)), "habit score on the other screen")
        live(phone, lambda: text_is(role(phone, "status", "Gold"), f"{g2(gold_for(xp))} gold"), "gold on the other screen")
        click(role(laptop, "checkbox", "Complete Walk the dog"))
        live(phone, lambda: shows(daily_row(phone, "Walk the dog", True, 0, True)), "done daily on the other screen")
        answered(p.patch("/api/settings", {"resting": True}), 200)
        live(phone, lambda: shows(rest_banner(phone)), "rest banner from a settings change elsewhere")
    t = p.tasks()
    assert t["habits"][0]["value"] == 4 and t["dailies"][0]["done"] is True


REWARD_CASES = {
    "todo_trivial_sand": ("todo", "complete", "trivial", 0),
    "todo_easy_crimson": ("todo", "complete", "easy", -10),
    "daily_medium_amber": ("daily", "complete", "medium", -1),
    "daily_hard_teal": ("daily", "complete", "hard", 5),
    "habit_up_trivial_teal": ("habit", "up", "trivial", 9),
    "habit_up_medium_blue": ("habit", "up", "medium", 10),
    "habit_down_hard_crimson": ("habit", "down", "hard", -12),
    "habit_down_trivial_teal": ("habit", "down", "trivial", 7),
}


@pytest.mark.parametrize("case", list(REWARD_CASES), ids=list(REWARD_CASES))
def test_reward_formulas(app_url, case):
    kind, action, difficulty, v = REWARD_CASES[case]
    u, party = uname("rf"), pname("Formula")
    ids, ps = world(app_url, [{"username": u, "gold": 3}], parties=[P(party, u)], quests=[Q(party, CLUTTER)],
                    tasks=[T(u, kind, "Read one chapter", difficulty=difficulty, value=v)])
    p = ps[u]
    tid, qid = ids["tasks"][u]["Read one chapter"], ids["quests"][party]
    full = QUESTS[CLUTTER]["max"]
    before = p.me()
    if action == "complete":
        res = answered(p.post(f"/api/tasks/{tid}/complete"), 200)
    else:
        res = answered(p.post(f"/api/tasks/{tid}/score", {"direction": action}), 200)
    after, task, quest = p.me(), p.task(tid), p.quest(qid)
    if action == "down":
        assert dec(after["health"]) == MAX_HEALTH - health_loss(difficulty, v)
        assert after["experience"] == before["experience"] and dec(after["gold"]) == dec(before["gold"])
        assert res["strike"] is None and res["delta"]["experience"] == 0 and dec(res["delta"]["damage"]) == 0
        assert task["value"] == clamp(v - 1) and dec(quest["bossHealth"]) == full
        return
    xp = earned_xp(difficulty, v)
    assert res["delta"]["experience"] == xp and dec(res["delta"]["gold"]) == gold_for(xp)
    assert dec(res["delta"]["damage"]) == damage_for(xp)
    assert after["experience"] == before["experience"] + xp and dec(after["gold"]) == dec(before["gold"]) + gold_for(xp)
    assert dec(after["health"]) == MAX_HEALTH
    strike = res["strike"]
    assert strike["kind"] == "strike" and strike["username"] == u and dec(strike["amount"]) == damage_for(xp)
    assert dec(strike["bossHealthAfter"]) == full - damage_for(xp) == dec(quest["bossHealth"])
    assert task["value"] == clamp(v + 1)


BAND_VALUES = [-20, -10, -9, -1, 0, 4, 5, 9, 10, 20]


def test_task_value_and_bands(browser, app_url):
    u = uname("bnd")
    titles = {v: f"Drink water {i}" for i, v in enumerate(BAND_VALUES)}
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", titles[v], value=v) for v in BAND_VALUES])
    p = ps[u]
    for h in p.tasks()["habits"]:
        v = next(k for k, t in titles.items() if t == h["title"])
        assert h["value"] == v and h["band"] == band(v)[0], h
    with screen(browser, p) as page:
        ready(page)
        for v in BAND_VALUES:
            row = habit_row(page, titles[v], v)
            see(page, row, f"habit at value {v}")
            expect(row).to_contain_text(band(v)[0])
        tid = ids["tasks"][u]
        top, bottom = BAND_VALUES[-1], BAND_VALUES[0]
        answered(p.post(f"/api/tasks/{tid[titles[top]]}/score", {"direction": "up"}), 200)
        answered(p.post(f"/api/tasks/{tid[titles[bottom]]}/score", {"direction": "down"}), 200)
        answered(p.post(f"/api/tasks/{tid[titles[4]]}/score", {"direction": "up"}), 200)
        answered(p.post(f"/api/tasks/{tid[titles[-9]]}/score", {"direction": "down"}), 200)
        live(page, lambda: expect(habit_row(page, titles[4], 5)).to_contain_text(band(5)[0], timeout=POLL_MS),
             "chip follows the value into the next band")
        live(page, lambda: expect(habit_row(page, titles[-9], -10)).to_contain_text(band(-10)[0], timeout=POLL_MS),
             "chip follows the value down into the next band")
    vals = {h["title"]: (h["value"], h["band"]) for h in p.tasks()["habits"]}
    assert vals[titles[top]] == (clamp(top + 1), band(top)[0])
    assert vals[titles[bottom]] == (clamp(bottom - 1), band(bottom)[0])
    assert vals[titles[4]] == (5, band(5)[0]) and vals[titles[-9]] == (-10, band(-10)[0])


def test_wf_habit_scoring_keyboard_up(browser, app_url):
    u = uname("hup")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Drink a glass of water", value=-1)])
    p = ps[u]
    xp = earned_xp("easy", -1)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = habit_row(page, "Drink a glass of water", -1)
        see(page, row, "habit row at -1")
        expect(row).to_contain_text(band(-1)[0])
        role(row, "button", "Score Drink a glass of water up").focus()
        page.keyboard.press("+")
        heard(page, f"Drink a glass of water scored: +{xp} experience, +{g2(gold_for(xp))} gold")
        see(page, habit_row(page, "Drink a glass of water", 0), "row score after +")
        expect(habit_row(page, "Drink a glass of water", 0)).to_contain_text(band(0)[0])
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(gold_for(xp))} gold"), "gold status")
        eventually(page, lambda: ensure(value_now(role(page, "meter", "Experience")) == xp, "experience meter"), "experience meter")
    me = p.me()
    assert me["experience"] == xp and dec(me["gold"]) == gold_for(xp)
    assert p.task(ids["tasks"][u]["Drink a glass of water"])["value"] == 0


def test_wf_habit_scoring_keyboard_down(browser, app_url):
    u = uname("hdn")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Doomscroll after midnight", difficulty="hard", value=-10)])
    p = ps[u]
    loss = health_loss("hard", -10)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = habit_row(page, "Doomscroll after midnight", -10)
        see(page, row, "habit row")
        row.focus()
        page.keyboard.press("-")
        heard(page, f"Doomscroll after midnight scored down: you lost {h1(loss)} health")
        see(page, habit_row(page, "Doomscroll after midnight", -11), "row score after -")
        expect(habit_row(page, "Doomscroll after midnight", -11)).to_contain_text(band(-11)[0])
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - loss)} / 50.0"), "health meter")
    assert dec(p.me()["health"]) == MAX_HEALTH - loss
    assert p.task(ids["tasks"][u]["Doomscroll after midnight"])["value"] == -11


def test_checklist_todo(app_url):
    u, party = uname("chk"), pname("Checklist")
    ids, ps = world(app_url, [{"username": u, "gold": 2}], parties=[P(party, u)], quests=[Q(party, CLUTTER)],
                    tasks=[T(u, "todo", "Book the dentist", difficulty="medium",
                             checklist=[("Find the number", False), ("Call before noon", False)])])
    p = ps[u]
    tid = ids["tasks"][u]["Book the dentist"]
    first, second = p.task(tid)["checklist"]
    before, entries = p.me(), len(p.ledger())
    for item, state in ((first, True), (second, True), (second, False)):
        t = answered(p.patch(f"/api/tasks/{tid}/checklist/{item['id']}", {"checked": state}), 200)
        assert next(i for i in t["checklist"] if i["id"] == item["id"])["checked"] is state
    now = p.me()
    assert now["experience"] == before["experience"] and dec(now["gold"]) == dec(before["gold"]) and len(p.ledger()) == entries
    assert [i["checked"] for i in p.task(tid)["checklist"]] == [True, False]
    res = answered(p.post(f"/api/tasks/{tid}/complete"), 200)
    xp = earned_xp("medium", 0, 1, 2)
    assert res["delta"]["experience"] == xp and dec(res["delta"]["gold"]) == gold_for(xp)
    assert dec(res["delta"]["damage"]) == damage_for(xp) and dec(res["strike"]["amount"]) == damage_for(xp)


def test_undo_inside_window(app_url):
    u, w, party, solo = uname("und"), uname("unw"), pname("Undo"), pname("Fallen")
    gain = earned_xp("easy", 0)
    ids, ps = world(app_url, [{"username": u, "experience": LEVEL_STEP - gain + 1, "health": 30, "gold": 10},
                              {"username": w, "gold": 1}],
                    parties=[P(party, u), P(solo, w)],
                    quests=[Q(party, CLUTTER, bossHealth=100), Q(solo, CLUTTER, bossHealth=1)],
                    tasks=[T(u, "todo", "Book the dentist"), T(w, "daily", "Walk the dog")])
    p, pw = ps[u], ps[w]
    tid, qid = ids["tasks"][u]["Book the dentist"], ids["quests"][party]
    before = p.me()
    tick = answered(p.post(f"/api/tasks/{tid}/complete"), 200)
    assert tick["levelUp"] and p.me()["level"] == 2
    answered(p.post(f"/api/tasks/{tid}/uncomplete"), 200)
    after = p.me()
    for f in ("level", "experience", "health", "gold"):
        assert dec(after[f]) == dec(before[f]), f"undo left {f} at {after[f]}, was {before[f]}"
    t = p.task(tid)
    assert t["done"] is False and t["value"] == 0
    quest = p.quest(qid)
    assert dec(quest["bossHealth"]) == Decimal("100") and all(e["id"] != tick["strike"]["id"] for e in quest["events"])
    undo = [e for e in p.ledger() if e["kind"] == "undo"]
    assert [dec(e["amount"]) for e in undo] == [-gold_for(gain)]
    answered(p.post(f"/api/tasks/{tid}/uncomplete"), 409, {"error": "not_done"})
    wt, wq = ids["tasks"][w]["Walk the dog"], ids["quests"][solo]
    answered(pw.post(f"/api/tasks/{wt}/complete"), 200)
    assert pw.quest(wq)["state"] == "defeated"
    answered(pw.post(f"/api/tasks/{wt}/uncomplete"), 200)
    q2 = pw.quest(wq)
    assert dec(q2["bossHealth"]) == 0 and q2["state"] == "defeated"
    assert pw.task(wt)["value"] == 0
    kinds = sorted((e["kind"], dec(e["amount"])) for e in pw.ledger())
    assert kinds == sorted([("task", Decimal("1")), ("task", gold_for(gain)), ("quest", QUESTS[CLUTTER]["gold"]), ("undo", -gold_for(gain))])


def test_undo_after_window(app_url):
    base = outage_url("APP_SHORT_URL")
    u, party = uname("una"), pname("Late")
    ids, ps = world(base, [{"username": u}], parties=[P(party, u)], quests=[Q(party, CLUTTER)], tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    tid, qid = ids["tasks"][u]["Walk the dog"], ids["quests"][party]
    answered(p.post(f"/api/tasks/{tid}/complete"), 200)
    ticked, boss, entries = p.me(), p.quest(qid)["bossHealth"], len(p.ledger())
    wait_out(SHORT_UNDO_S + WAIT_MARGIN_S, p)
    answered(p.post(f"/api/tasks/{tid}/uncomplete"), 200)
    now = p.me()
    assert (now["experience"], dec(now["gold"]), dec(now["health"])) == (ticked["experience"], dec(ticked["gold"]), dec(ticked["health"]))
    t = p.task(tid)
    assert t["done"] is False and t["value"] == 1
    assert p.quest(qid)["bossHealth"] == boss and len(p.ledger()) == entries


def test_wf_undo_window_party_sees_undo(browser, app_url):
    a, m, party = uname("upa"), uname("upm"), pname("Undo")
    ids, ps = world(app_url, [{"username": a, "gold": 4, "health": 30}, {"username": m}],
                    parties=[P(party, a, m)], quests=[Q(party, CLUTTER)], tasks=[T(a, "daily", "Walk the dog")])
    pa = ps[a]
    dmg, mx = damage_for(earned_xp("easy", 0)), QUESTS[CLUTTER]["max"]
    with screen(browser, pa) as own, screen(browser, ps[m]) as mate:
        ready(own)
        ready(mate)
        record_feed(own)
        box = role(own, "checkbox", "Complete Walk the dog")
        click(box)
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "teammate boss meter after the tick")
        eventually(own, lambda: text_is(role(own, "status", "Gold"), f"{g2(5)} gold"), "gold after the tick")
        click(box)
        heard(own, "Walk the dog undone")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx)} / {h1(mx)}"), "teammate boss meter after the undo")
        live(mate, lambda: ensure(not any(l.startswith(a) for l in lines(role(mate, "list", "Strikes"))), "strike line still shown"),
             "strike line removed on the teammate's screen")
        eventually(own, lambda: text_is(role(own, "status", "Gold"), f"{g2(4)} gold"), "gold restored")
        eventually(own, lambda: meter_reads(role(own, "meter", "Health"), "30.0 / 50.0"), "health restored")
        see(own, own.get_by_text("Level 1", exact=True), "level text")
    me = pa.me()
    assert (me["level"], me["experience"], dec(me["gold"]), dec(me["health"])) == (1, 0, Decimal("4"), Decimal("30"))
    assert dec(pa.quest(ids["quests"][party])["bossHealth"]) == mx


def test_wf_undo_window_replayed_untick(browser, app_url):
    a, m, party = uname("ura"), uname("urm"), pname("Replay")
    ids, ps = world(app_url, [{"username": a, "gold": 4}, {"username": m}],
                    parties=[P(party, a, m)], quests=[Q(party, CLUTTER)], tasks=[T(a, "todo", "Book the dentist")])
    pa = ps[a]
    tid, mx = ids["tasks"][a]["Book the dentist"], QUESTS[CLUTTER]["max"]
    with screen(browser, pa) as own, screen(browser, ps[m]) as mate:
        ready(own)
        ready(mate)
        click(role(own, "checkbox", "Complete Book the dentist"))
        eventually(own, lambda: ensure(pa.task(tid)["done"] is True, "not done"), "tick saved")
        key = idempotency_key()
        r1 = pa.post(f"/api/tasks/{tid}/uncomplete", key=key)
        r2 = pa.post(f"/api/tasks/{tid}/uncomplete", key=key)
        assert r1.status_code == r2.status_code == 200 and r1.json() == r2.json()
        live(own, lambda: text_is(role(own, "status", "Gold"), f"{g2(4)} gold"), "gold back on the player's screen")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx)} / {h1(mx)}"), "boss back on the teammate's screen")
    answered(pa.post(f"/api/tasks/{tid}/uncomplete"), 409, {"error": "not_done"})
    assert len([e for e in pa.ledger() if e["kind"] == "undo"]) == 1 and dec(pa.me()["gold"]) == 4


def test_gold_ledger(browser, app_url):
    u, party = uname("led"), pname("Ledger")
    start, price = Decimal("10.00"), Decimal("2.50")
    ids, ps = world(app_url, [{"username": u, "gold": float(start), "level": 2, "health": 1}],
                    parties=[P(party, u)], quests=[Q(party, CLUTTER, bossHealth=2)],
                    tasks=[T(u, "habit", "Doomscroll after midnight", difficulty="hard"), T(u, "reward", "Fancy coffee", price=float(price)),
                           T(u, "todo", "Book the dentist"), T(u, "daily", "Walk the dog")])
    p, tid = ps[u], ids["tasks"][u]
    assert [(e["kind"], dec(e["amount"])) for e in p.ledger()] == [("task", start)]
    assert answered(p.post(f"/api/tasks/{tid['Doomscroll after midnight']}/score", {"direction": "down"}), 200)["fainted"]
    answered(p.post(f"/api/rewards/{tid['Fancy coffee']}/buy"), 200)
    answered(p.post(f"/api/tasks/{tid['Book the dentist']}/complete"), 200)
    answered(p.post(f"/api/tasks/{tid['Walk the dog']}/complete"), 200)
    answered(p.post(f"/api/tasks/{tid['Walk the dog']}/uncomplete"), 200)
    g = gold_for(earned_xp("easy", 0))
    faint = (start * FAINT_SHARE).quantize(Decimal("0.01"), ROUND_FLOOR)
    entries = p.ledger()
    assert sorted((e["kind"], dec(e["amount"])) for e in entries) == sorted(
        [("task", start), ("faint", -faint), ("reward", -price), ("task", g), ("quest", QUESTS[CLUTTER]["gold"]), ("task", g), ("undo", -g)])
    assert next(e for e in entries if e["kind"] == "reward")["taskId"] == tid["Fancy coffee"]
    balance = sum((dec(e["amount"]) for e in entries), Decimal(0))
    with screen(browser, p) as page:
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(balance)} gold"), "Gold status equals the ledger sum")


def test_refused_purchase(app_url):
    poor, exact = uname("poo"), uname("exa")
    price = Decimal("5.00")
    ids, ps = world(app_url, [{"username": poor, "gold": float(price - Decimal("0.01"))}, {"username": exact, "gold": float(price)}],
                    tasks=[T(poor, "reward", "Fancy coffee", price=float(price)), T(exact, "reward", "Fancy coffee", price=float(price))])
    pp, pe = ps[poor], ps[exact]
    before = pp.ledger()
    answered(pp.post(f"/api/rewards/{ids['tasks'][poor]['Fancy coffee']}/buy"), 422, {"errors": {"gold": "Not enough gold."}})
    assert pp.ledger() == before and dec(pp.me()["gold"]) == price - Decimal("0.01")
    res = answered(pe.post(f"/api/rewards/{ids['tasks'][exact]['Fancy coffee']}/buy"), 200)
    assert dec(res["delta"]["gold"]) == -price and dec(pe.me()["gold"]) == 0
    assert [dec(e["amount"]) for e in pe.ledger() if e["kind"] == "reward"] == [-price]


def test_wf_rewards_gold_keyboard_buy(browser, app_url):
    u = uname("buy")
    gold, cheap, dear = Decimal("6.00"), Decimal("5.00"), Decimal("12.00")
    ids, ps = world(app_url, [{"username": u, "gold": float(gold)}],
                    tasks=[T(u, "reward", "Fancy coffee", price=float(cheap)), T(u, "reward", "Episode of a show", price=float(dear))])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = reward_row(page, "Fancy coffee", cheap)
        see(page, row, "reward row")
        role(row, "button", "Buy Fancy coffee").focus()
        page.keyboard.press("Space")
        heard(page, f"Fancy coffee bought for {g2(cheap)} gold")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(gold - cheap)} gold"), "gold falls by the price")
        assert holds_focus(row), "focus left the reward row after buying"
        dear_row = reward_row(page, "Episode of a show", dear)
        role(dear_row, "button", "Buy Episode of a show").focus()
        page.keyboard.press("Space")
        see(page, page.get_by_role("alert").filter(has_text="Not enough gold."), "refusal copy")
        text_is(role(page, "status", "Gold"), f"{g2(gold - cheap)} gold")
        assert holds_focus(dear_row), "focus left the unaffordable reward row"
    assert [dec(e["amount"]) for e in p.ledger() if e["kind"] == "reward"] == [-cheap]


def test_wf_rewards_gold_ledger_matches(browser, app_url):
    u = uname("lgm")
    _, ps = world(app_url, [{"username": u, "gold": 20}],
                  tasks=[T(u, "reward", "Bubble tea", price=6.5), T(u, "todo", "Return library books", difficulty="trivial")])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        for _ in range(2):
            click(role(page, "button", "Buy Bubble tea"))
            eventually(page, lambda: ensure(True), "click settle", 1)
        click(role(page, "checkbox", "Complete Return library books"))
        eventually(page, lambda: ensure(len(p.ledger()) == 4, "ledger entries"), "four ledger entries")
        total = sum((dec(e["amount"]) for e in p.ledger()), Decimal(0))
        page.reload()
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(total)} gold"), "Gold equals ledger sum after reload")
    assert sorted(e["kind"] for e in p.ledger()) == ["reward", "reward", "task", "task"]


def test_day_close_steps(app_url):
    today = utc_today(app_url)
    u = uname("cls")
    rest = [d for d in WEEK if d != WEEK[today.weekday()]]
    ids, ps = world(app_url, [{"username": u}], tasks=[
        T(u, "daily", "Walk the dog", streak=5), T(u, "daily", "Read one chapter", difficulty="medium", value=6, streak=12, done=True),
        T(u, "daily", "Stretch for ten minutes", weekdays=rest, streak=4), T(u, "daily", "Practice guitar", difficulty="hard", value=-19),
        T(u, "habit", "Drink a glass of water", value=3), T(u, "todo", "Book the dentist", done=True)])
    p = ps[u]
    at = ids["users"][u]["nextCloseAt"]
    lost = health_loss("easy", 0) + health_loss("hard", -19)
    closes = closes_of(rollover(app_url, at), u)
    assert len(closes) == 1, closes
    c = closes[0]
    assert c["date"] == today.isoformat() and c["missed"] == 2 and dec(c["healthLost"]) == lost and dec(c["strikeBack"]) == 0
    me = p.me()
    assert dec(me["health"]) == MAX_HEALTH - lost and me["today"] == (today + timedelta(days=1)).isoformat()
    assert instant(me["nextCloseAt"]) == close_instant("UTC", today + timedelta(days=1), 0)
    t = {x["title"]: x for items in p.tasks().values() for x in items}
    assert (t["Walk the dog"]["value"], t["Walk the dog"]["streak"]) == (-2, 0)
    assert (t["Read one chapter"]["streak"], t["Read one chapter"]["done"], t["Read one chapter"]["value"]) == (13, False, 6)
    assert (t["Stretch for ten minutes"]["streak"], t["Stretch for ten minutes"]["value"]) == (4, 0)
    assert (t["Practice guitar"]["value"], t["Practice guitar"]["streak"]) == (-20, 0)
    assert t["Drink a glass of water"]["value"] == 3 and t["Book the dentist"]["done"] is True
    assert closes_of(rollover(app_url, at), u) == [] and dec(p.me()["health"]) == MAX_HEALTH - lost


DST_CASES = {
    "spring_gap": ("America/Toronto", 2, "2027-03-13"),
    "fall_repeat": ("America/Toronto", 1, "2027-11-06"),
}


@pytest.mark.parametrize("case", list(DST_CASES), ids=list(DST_CASES))
def test_daylight_saving_closes(app_url, case):
    zone, hour, day = DST_CASES[case]
    d = date.fromisoformat(day)
    u, w = uname("dst"), uname("dsw")
    ids = setup(app_url, {"users": [
        {"username": u, "password": PASSWORD, "timeZone": zone, "dayStartHour": hour, "currentDate": day},
        {"username": w, "password": PASSWORD, "timeZone": zone, "dayStartHour": hour, "currentDate": (d + timedelta(days=1)).isoformat()}]})
    first, second = close_instant(zone, d, hour), close_instant(zone, d + timedelta(days=1), hour)
    assert instant(ids["users"][u]["nextCloseAt"]) == first and instant(ids["users"][w]["nextCloseAt"]) == second
    me = Player(app_url, u).me()
    assert me["today"] == day and instant(me["nextCloseAt"]) == first and me["nextDayStart"] == day_start_text(first, zone)
    assert second > first


def test_zone_and_day_start_settings(app_url):
    u, w = uname("set"), uname("sew")
    ids, ps = world(app_url, [{"username": u}, {"username": w, "timeZone": "Pacific/Pago_Pago", "dayStartHour": 12}],
                    tasks=[T(w, "daily", "Walk the dog")])
    p = ps[u]
    before = p.me()
    hour_msg = "Day start hour must be a whole number from 0 to 23."
    for body, field, msg in [({"timeZone": "Mars/Olympus"}, "timeZone", "Unknown time zone."),
                             ({"dayStartHour": 24}, "dayStartHour", hour_msg), ({"dayStartHour": -1}, "dayStartHour", hour_msg),
                             ({"dayStartHour": 6.5}, "dayStartHour", hour_msg)]:
        answered(p.patch("/api/settings", body), 422, {"errors": {field: msg}})
    assert (p.me()["timeZone"], p.me()["dayStartHour"]) == (before["timeZone"], before["dayStartHour"])
    today = date.fromisoformat(before["today"])
    after = answered(p.patch("/api/settings", {"timeZone": "America/Toronto", "dayStartHour": 6}), 200)
    want = close_instant("America/Toronto", today, 6)
    assert after["today"] == before["today"] and instant(after["nextCloseAt"]) == want
    assert after["nextDayStart"] == day_start_text(want, "America/Toronto")
    pw = ps[w]
    wd = date.fromisoformat(pw.me()["today"])
    answered(pw.patch("/api/settings", {"timeZone": "Pacific/Kiritimati", "dayStartHour": 13}), 200)
    poll(lambda: ensure(pw.me()["today"] != wd.isoformat(), "date not closed"), "past close runs at save", CLOSE_DEADLINE_S)
    m = pw.me()
    assert m["today"] == (wd + timedelta(days=1)).isoformat()
    assert instant(m["nextCloseAt"]) == close_instant("Pacific/Kiritimati", wd + timedelta(days=1), 13)
    assert dec(m["health"]) == MAX_HEALTH - health_loss("easy", 0)


def test_due_state_ignores_device_clock(browser, app_url):
    today = utc_today(app_url)
    u = uname("clk")
    rest = [d for d in WEEK if d != WEEK[today.weekday()]]
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", "Walk the dog", done=True, streak=2),
                                                     T(u, "daily", "Stretch for ten minutes", weekdays=rest, streak=4)])
    p = ps[u]
    assert [t["dueToday"] for t in p.tasks()["dailies"]] == [True, False]
    me = p.me()
    for wrong in WRONG_CLOCKS:
        with screen(browser, p, clock_at=wrong) as page:
            see(page, daily_row(page, "Walk the dog", True, 2, True), "server due/done state")
            see(page, daily_row(page, "Stretch for ten minutes", False, 4, False), "server not-due state")
        with screen(browser, p, "/settings", clock_at=wrong) as page:
            see(page, page.get_by_text(f"Next day start: {me['nextDayStart']}", exact=True), "server next day start")


def test_wf_rollover_custom_hour_missed_dailies(browser, app_url):
    u = uname("mis")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", "Walk the dog", streak=3),
                                                       T(u, "daily", "Read one chapter", difficulty="medium", streak=12, done=True)])
    p = ps[u]
    with screen(browser, p, clock_at=WRONG_CLOCKS[0]) as page:
        ready(page)
        rollover(app_url, ids["users"][u]["nextCloseAt"])
        page.reload()
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - health_loss('easy', 0))} / 50.0"), "health after close")
        see(page, daily_row(page, "Walk the dog", True, 0, False), "reset streak")
        see(page, daily_row(page, "Read one chapter", True, 13, False), "extended streak")
    d = {t["title"]: t["streak"] for t in p.tasks()["dailies"]}
    assert d == {"Walk the dog": 0, "Read one chapter": 13}


def test_wf_rollover_custom_hour_settings_save(browser, app_url):
    u = uname("sts")
    ids, ps = world(app_url, [{"username": u}])
    p = ps[u]
    want = close_instant("America/Toronto", date.fromisoformat(ids["users"][u]["today"]), 6)
    with screen(browser, p, "/settings") as page:
        select(role(page, "combobox", "Time zone"), "America/Toronto")
        fill(role(page, "spinbutton", "Day start hour"), "6")
        click(role(page, "button", "Save settings"))
        see(page, page.get_by_text("Settings saved.", exact=True), "settings success status")
        see(page, page.get_by_text(f"Next day start: {day_start_text(want, 'America/Toronto')}", exact=True), "next day start text")
    me = p.me()
    assert (me["timeZone"], me["dayStartHour"]) == ("America/Toronto", 6) and instant(me["nextCloseAt"]) == want


def test_wf_rollover_custom_hour_dst_settings(browser, app_url):
    zone, hour, day = DST_CASES["spring_gap"]
    u = uname("dss")
    _, ps = world(app_url, [{"username": u, "currentDate": day}])
    p = ps[u]
    want = close_instant(zone, date.fromisoformat(day), hour)
    with screen(browser, p, "/settings") as page:
        select(role(page, "combobox", "Time zone"), zone)
        fill(role(page, "spinbutton", "Day start hour"), str(hour))
        click(role(page, "button", "Save settings"))
        see(page, page.get_by_text(f"Next day start: {day_start_text(want, zone)}", exact=True), "gap close in the next day start")
    assert instant(p.me()["nextCloseAt"]) == want


def test_rest_mode_rules(app_url):
    r, t, m, party = uname("rr"), uname("rt"), uname("rm"), pname("Rest")
    ids, ps = world(app_url, [{"username": r, "resting": True}, {"username": t}, {"username": m}],
                    parties=[P(party, t, r, m)], quests=[Q(party, DROWSE)],
                    tasks=[T(r, "daily", "Walk the dog", streak=3), T(r, "daily", "Read one chapter", difficulty="medium", streak=12, done=True),
                           T(r, "todo", "Book the dentist"), T(m, "daily", "Practice guitar")])
    qid, mx = ids["quests"][party], QUESTS[DROWSE]["max"]
    dmg = damage_for(earned_xp("easy", 0))
    s = answered(ps[r].post(f"/api/tasks/{ids['tasks'][r]['Book the dentist']}/complete"), 200)["strike"]
    assert s["username"] == r and dec(s["amount"]) == dmg and dec(ps[t].quest(qid)["bossHealth"]) == mx - dmg
    closes = rollover(app_url, ids["users"][r]["nextCloseAt"])
    cr, cm = closes_of(closes, r), closes_of(closes, m)
    assert len(cr) == 1 and dec(cr[0]["healthLost"]) == 0 and dec(cr[0]["strikeBack"]) == 0
    back = q(QUESTS[DROWSE]["power"] * 1, "0.1")
    assert len(cm) == 1 and dec(cm[0]["strikeBack"]) == back
    assert dec(ps[r].me()["health"]) == MAX_HEALTH
    d = {x["title"]: x for x in ps[r].tasks()["dailies"]}
    assert (d["Walk the dog"]["streak"], d["Walk the dog"]["value"], d["Read one chapter"]["streak"]) == (3, 0, 13)
    assert dec(ps[t].me()["health"]) == MAX_HEALTH - back
    assert dec(ps[m].me()["health"]) == MAX_HEALTH - health_loss("easy", 0) - back
    backs = [e for e in ps[t].quest(qid)["events"] if e["kind"] == "strikeback"]
    assert [(e["username"], e["missed"], dec(e["amount"])) for e in backs] == [(m, 1, back)]


def test_wf_rest_mode_switch_spares_party(browser, app_url):
    r, t, party = uname("rsr"), uname("rst"), pname("Nap")
    ids, ps = world(app_url, [{"username": r}, {"username": t}], parties=[P(party, r, t)], quests=[Q(party, DROWSE)],
                    tasks=[T(r, "daily", "Walk the dog")])
    pr, pt = ps[r], ps[t]
    with screen(browser, pr, "/settings", clock_at=WRONG_CLOCKS[1]) as page, screen(browser, pt) as mate:
        ready(mate)
        click(role(page, "switch", "Rest mode"))
        eventually(page, lambda: shows(rest_banner(page)), "rest banner", REST_BANNER_S + POLL_SLACK_S)
        assert page.get_by_text("Settings saved.", exact=True).count() == 0
        poll(lambda: ensure(pr.me()["resting"] is True, "not resting"), "rest mode saved")
        rollover(app_url, ids["users"][r]["nextCloseAt"])
        page.goto(pr.base + "/board")
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), "50.0 / 50.0"), "rester health after close")
        see(page, rest_banner(page), "rest banner on the board")
        quiet(mate, lambda: meter_reads(role(mate, "meter", "Health"), "50.0 / 50.0"), "teammate untouched")
    assert dec(pr.me()["health"]) == MAX_HEALTH and dec(pt.me()["health"]) == MAX_HEALTH
    assert not [e for e in pt.quest(ids["quests"][party])["events"] if e["kind"] == "strikeback"]


def test_wf_rest_mode_switch_off_before_close(browser, app_url):
    r, t, party = uname("rfr"), uname("rft"), pname("Wake")
    ids, ps = world(app_url, [{"username": r}, {"username": t}], parties=[P(party, r, t)], quests=[Q(party, DROWSE)],
                    tasks=[T(r, "daily", "Walk the dog")])
    pr = ps[r]
    with screen(browser, pr, "/settings") as page:
        sw = role(page, "switch", "Rest mode")
        click(sw)
        see(page, rest_banner(page), "banner on")
        click(sw)
        eventually(page, lambda: ensure(rest_banner(page).count() == 0 or not rest_banner(page).first.is_visible(), "banner still shown"), "banner off")
    poll(lambda: ensure(pr.me()["resting"] is False, "still resting"), "rest mode off saved")
    rollover(app_url, ids["users"][r]["nextCloseAt"])
    back = q(QUESTS[DROWSE]["power"], "0.1")
    assert dec(pr.me()["health"]) == MAX_HEALTH - health_loss("easy", 0) - back
    assert dec(ps[t].me()["health"]) == MAX_HEALTH - back


def test_levels(app_url):
    cases = [(1, 20, "easy", -10, []), (2, 40, "easy", 0, []),
             (1, 24, "hard", -10, [("Find the number", True), ("Call before noon", True)])]
    for level, xp, diff, v, items in cases:
        u = uname("lvl")
        ids, ps = world(app_url, [{"username": u, "level": level, "experience": xp, "health": 10}],
                        tasks=[T(u, "todo", "Book the dentist", difficulty=diff, value=v, **({"checklist": items} if items else {}))])
        p = ps[u]
        gain = earned_xp(diff, v, len(items), len(items))
        res = answered(p.post(f"/api/tasks/{ids['tasks'][u]['Book the dentist']}/complete"), 200)
        want_level, want_xp = apply_xp(level, xp, gain)
        me = p.me()
        assert (me["level"], me["experience"]) == (want_level, want_xp), me
        assert me["experienceToLevel"] == LEVEL_STEP * want_level and dec(me["health"]) == MAX_HEALTH and res["levelUp"]
        assert want_level in [n["level"] for n in me["notices"] if n["kind"] == "level_up"]


def test_fainting(app_url):
    for level, gold, health in [(3, "10.05", 2), (1, "3.33", 8)]:
        u = uname("fnt")
        ids, ps = world(app_url, [{"username": u, "level": level, "experience": 10, "health": health, "gold": float(gold)}],
                        tasks=[T(u, "habit", "Doomscroll after midnight", difficulty="hard", value=-10)])
        p = ps[u]
        res = answered(p.post(f"/api/tasks/{ids['tasks'][u]['Doomscroll after midnight']}/score", {"direction": "down"}), 200)
        lost = (dec(gold) * FAINT_SHARE).quantize(Decimal("0.01"), ROUND_FLOOR)
        me = p.me()
        assert res["fainted"] and (me["level"], me["experience"]) == (max(1, level - 1), 0)
        assert dec(me["health"]) == MAX_HEALTH and dec(me["gold"]) == dec(gold) - lost
        assert [dec(e["amount"]) for e in p.ledger() if e["kind"] == "faint"] == [-lost]
        notice = [n for n in me["notices"] if n["kind"] == "faint"]
        assert len(notice) == 1 and notice[0]["level"] == max(1, level - 1) and dec(notice[0]["goldLost"]) == lost


def test_wf_level_and_faint_level_up_dialog(browser, app_url):
    u = uname("lud")
    _, ps = world(app_url, [{"username": u, "experience": LEVEL_STEP - earned_xp("easy", 0)}], tasks=[T(u, "habit", "Drink a glass of water")])
    p = ps[u]
    with screen(browser, p) as page:
        row = habit_row(page, "Drink a glass of water", 0)
        see(page, row, "habit row")
        row.focus()
        page.keyboard.press("+")
        dialog = role(page, "dialog", "Level up")
        see(page, dialog, "Level up dialog")
        expect(dialog).to_contain_text("You reached level 2. Your health is full again.")
        focused(page, dialog, "focus moves into the dialog")
        role(dialog, "button", "Keep going").press("Enter")
        focused(page, habit_row(page, "Drink a glass of water", 1), "focus returns to the row whose action levelled up")
    poll(lambda: ensure(p.me()["notices"] == [], "notice not acknowledged"), "level-up notice acknowledged")


def test_wf_level_and_faint_faint_after_close(browser, app_url):
    u = uname("fac")
    gold = Decimal("10.00")
    ids, ps = world(app_url, [{"username": u, "level": 2, "health": 2, "gold": float(gold)}],
                    tasks=[T(u, "habit", "Drink a glass of water"), T(u, "daily", "Practice guitar", difficulty="hard", value=-10)])
    p = ps[u]
    rollover(app_url, ids["users"][u]["nextCloseAt"])
    lost = (gold * FAINT_SHARE).quantize(Decimal("0.01"), ROUND_FLOOR)
    with screen(browser, p) as page:
        dialog = role(page, "dialog", "You fainted")
        see(page, dialog, "faint dialog on load")
        expect(dialog).to_contain_text(f"You dropped to level 1 and lost {g2(lost)} gold. Your health is back to 50.0.")
        role(dialog, "button", "Get back up").press("Enter")
        focused(page, habit_row(page, "Drink a glass of water", 0), "focus goes to the first Habits row")
    poll(lambda: ensure(p.me()["notices"] == [], "notice not acknowledged"), "faint notice acknowledged")
    me = p.me()
    assert me["level"] == 1 and dec(me["gold"]) == gold - lost and dec(me["health"]) == MAX_HEALTH


BADGE_CASES = ["full_motion", "reduced_motion"]


@pytest.mark.parametrize("mode", BADGE_CASES, ids=BADGE_CASES)
def test_level_up_badge_motion(browser, app_url, mode):
    u = uname("bdg")
    _, ps = world(app_url, [{"username": u, "experience": LEVEL_STEP - earned_xp("easy", 0)}], tasks=[T(u, "habit", "Drink a glass of water")])
    reduce = mode == "reduced_motion"
    with screen(browser, ps[u], reduced_motion="reduce" if reduce else "no-preference") as page:
        ready(page)
        click(role(page, "button", "Score Drink a glass of water up"))
        badge = role(page, "img", "Level 2 badge")
        expect(badge).to_be_attached(timeout=SETTLE_S * 1000)
        if reduce:
            box = badge.bounding_box()
            assert box["width"] >= BADGE_MIN_PX and box["height"] >= BADGE_MIN_PX, box
            assert animations(badge) == [], "badge animates under reduced motion"
            return
        path = motion(badge, MOTION_MAX_MS)
        settle(badge)
        full = badge.bounding_box()
        assert full["width"] >= BADGE_MIN_PX and full["height"] >= BADGE_MIN_PX, full
        widths = [frame["width"] if "width" in frame else frame["w"] for frame in path]
        assert widths[0] <= full["width"] / 4 + SUBPIXEL_PX, f"growth starts at {widths[0]}px"
        assert widths[-1] >= full["width"] - SEAM_TOLERANCE_PX, "badge not full size within 0.6 s"


def test_parties_and_invites(app_url):
    lead, a, b, c, d, x = (uname(t) for t in ("pl", "pa", "pb", "pc", "pd", "px"))
    other = pname("Other")
    ids, ps = world(app_url, [{"username": n} for n in (lead, a, b, c, d, x)], parties=[P(other, x)])
    pl, pa = ps[lead], ps[a]
    name_err = {"errors": {"name": "Party name must be 1 to 40 characters."}}
    answered(pl.post("/api/parties", {"name": ""}), 422, name_err)
    answered(pl.post("/api/parties", {"name": "x" * (PARTY_NAME_MAX + 1)}), 422, name_err)
    name = pname("Crew")
    party = answered(pl.post("/api/parties", {"name": name}), 201)
    pid = party["id"]
    assert party["leader"] == lead and [mm["username"] for mm in party["members"]] == [lead]
    answered(pl.post("/api/parties", {"name": pname("Again")}), 409, {"error": "already_in_party"})
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": uname("ghost")}), 422,
             {"errors": {"username": "No player with that username."}})
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": x}), 409, {"error": "already_in_party"})
    inv = answered(pl.post(f"/api/parties/{pid}/invites", {"username": a}), 201)
    assert inv["username"] == a
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": a}), 409, {"error": "already_invited"})
    answered(ps[x].post(f"/api/parties/{ids['parties'][other]}/invites", {"username": a}), 201)
    invites = answered(pa.get("/api/invites"), 200)["invites"]
    mine = next(i for i in invites if i["partyId"] == pid)
    assert mine["partyName"] == name and mine["from"] == lead and len(invites) == 2
    joined = answered(pa.post(f"/api/invites/{mine['id']}/accept"), 200)
    assert {mm["username"] for mm in joined["members"]} == {lead, a}
    assert answered(pa.get("/api/invites"), 200)["invites"] == []
    answered(pa.post(f"/api/parties/{pid}/invites", {"username": b}), 403, {"error": "leader_only"})
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": b}), 201)
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": c}), 201)
    answered(pl.post(f"/api/parties/{pid}/invites", {"username": d}), 409, {"error": "party_full"})
    binv = answered(ps[b].get("/api/invites"), 200)["invites"][0]
    answered(ps[b].post(f"/api/invites/{binv['id']}/decline"), 204)
    assert b not in answered(pl.get(f"/api/parties/{pid}"), 200)["pendingInvites"]
    assert answered(ps[b].get("/api/invites"), 200)["invites"] == []
    answered(pl.post(f"/api/parties/{pid}/leave"), 204)
    assert answered(pa.get(f"/api/parties/{pid}"), 200)["leader"] == a
    answered(pa.post(f"/api/parties/{pid}/leave"), 204)
    answered(pa.get(f"/api/parties/{pid}"), 404, {"error": "not_found"})


def test_quest_lifecycle(app_url):
    lead, m, n, party = uname("ql"), uname("qm"), uname("qn"), pname("Quest")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}, {"username": n}], parties=[P(party, lead, m, n)])
    pl, pm, pn = ps[lead], ps[m], ps[n]
    pid = ids["parties"][party]
    fixtures = {f["name"]: f for f in answered(pl.get("/api/quest-fixtures"), 200)["quests"]}
    for name, f in QUESTS.items():
        got = fixtures[name]
        assert (got["boss"], dec(got["maxHealth"]), dec(got["power"]), dec(got["rewardGold"]), got["rewardExperience"]) == \
            (f["boss"], f["max"], f["power"], f["gold"], f["xp"])
    answered(pm.post(f"/api/parties/{pid}/quests", {"quest": CLUTTER}), 403, {"error": "leader_only"})
    answered(pl.post(f"/api/parties/{pid}/quests", {"quest": "Wake the Kraken"}), 422, {"errors": {"quest": "Unknown quest."}})
    qst = answered(pl.post(f"/api/parties/{pid}/quests", {"quest": CLUTTER}), 201)
    qid = qst["id"]
    assert qst["state"] == "invited" and qst["acceptedBy"] == [lead] and dec(qst["bossHealth"]) == QUESTS[CLUTTER]["max"]
    answered(pl.post(f"/api/parties/{pid}/quests", {"quest": MOTH}), 409, {"error": "quest_in_progress"})
    answered(pl.post(f"/api/quests/{qid}/begin"), 409, {"error": "not_enough_accepted"})
    answered(pm.post(f"/api/quests/{qid}/begin"), 403, {"error": "leader_only"})
    assert m in answered(pm.post(f"/api/quests/{qid}/accept"), 200)["acceptedBy"]
    answered(pn.post(f"/api/quests/{qid}/decline"), 200)
    begun = answered(pl.post(f"/api/quests/{qid}/begin"), 200)
    assert begun["state"] == "active" and begun["startedAt"]
    nope = {"error": "quest_not_active"}
    for actor, verb in ((pm, "accept"), (pn, "decline"), (pl, "begin")):
        answered(actor.post(f"/api/quests/{qid}/{verb}"), 409, nope)
    answered(pm.post(f"/api/quests/{qid}/abandon"), 403, {"error": "leader_only"})
    ended = answered(pl.post(f"/api/quests/{qid}/abandon"), 200)
    assert ended["state"] == "abandoned" and ended["endedAt"]
    answered(pl.post(f"/api/quests/{qid}/abandon"), 409, nope)
    answered(pm.post(f"/api/quests/{qid}/accept"), 409, nope)
    again = answered(pl.post(f"/api/parties/{pid}/quests", {"quest": DROWSE}), 201)
    assert answered(pl.post(f"/api/quests/{again['id']}/abandon"), 200)["state"] == "abandoned"
    base = outage_url("APP_SHORT_URL")
    l1, m1, l2, m2, p1, p2 = uname("el"), uname("em"), uname("fl"), uname("fm"), pname("Late"), pname("Later")
    sids, sp = world(base, [{"username": x} for x in (l1, m1, l2, m2)], parties=[P(p1, l1, m1), P(p2, l2, m2)])
    q1 = answered(sp[l1].post(f"/api/parties/{sids['parties'][p1]}/quests", {"quest": CLUTTER}), 201)["id"]
    q2 = answered(sp[l2].post(f"/api/parties/{sids['parties'][p2]}/quests", {"quest": CLUTTER}), 201)["id"]
    answered(sp[m1].post(f"/api/quests/{q1}/accept"), 200)
    wait_out(SHORT_INVITE_S + WAIT_MARGIN_S, sp[l1])
    answered(sp[l1].post(f"/api/quests/{q1}/begin"), 409, {"error": "invite_expired"})
    answered(sp[m2].post(f"/api/quests/{q2}/accept"), 409, {"error": "invite_expired"})


def test_party_chat(browser, app_url):
    lead, m, party = uname("cl"), uname("cm"), pname("Chat")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)])
    pl, pm = ps[lead], ps[m]
    pid = ids["parties"][party]
    path = f"/api/parties/{pid}/chat"
    err = {"errors": {"text": "Message must be 1 to 500 characters."}}
    answered(pl.post(path, {"text": "   "}), 422, err)
    answered(pl.post(path, {"text": "x" * (CHAT_MAX_CHARS + 1)}), 422, err)
    msg = answered(pl.post(path, {"text": "  Drowsewyrm is wobbling. One more push tonight.  "}), 201)
    assert msg["username"] == lead and "Drowsewyrm is wobbling. One more push tonight." in msg["text"]
    sent = ["Walking the dog counts, right?"] + [f"push {i}" for i in range(CHAT_LIMIT - 2)] + ["x" * CHAT_MAX_CHARS]
    for text in sent:
        answered(pm.post(path, {"text": text}), 201)
    answered(pm.post(path, {"text": "one too many"}), 429, {"error": "chat_rate_limited"})
    msgs = answered(pm.get(path), 200)["messages"]
    assert [x["text"] for x in msgs if x["username"] == m] == sent
    with screen(browser, pm) as page:
        box = role(page, "textbox", "Message")
        see(page, box, "chat composer")
        fill(box, "still here")
        box.press("Enter")
        see(page, page.get_by_text(f"Slow down: you can send {CHAT_LIMIT} messages a minute.", exact=True), "rate-limit composer copy")


def test_live_stream(app_url):
    lead, m, i, o = uname("ll"), uname("lm"), uname("li"), uname("lo")
    party, other = pname("Live"), pname("Elsewhere")
    ids, ps = world(app_url, [{"username": lead, "experience": LEVEL_STEP - earned_xp("easy", 0)}, {"username": m}, {"username": i}, {"username": o}],
                    parties=[P(party, lead, m), P(other, o)],
                    tasks=[T(lead, "habit", "Drink a glass of water"), T(m, "todo", "Book the dentist")])
    pl, pm, pi = ps[lead], ps[m], ps[i]
    pid = ids["parties"][party]
    with LiveStream(pl) as sl, LiveStream(pm) as sm, LiveStream(pi) as si, LiveStream(ps[o]) as so:
        answered(pl.post("/api/tasks", {"type": "habit", "title": "Take the stairs", "difficulty": "easy"}), 201)
        sl.wait("tasks", lambda d: any(t["title"] == "Take the stairs" for t in d["habits"]), "the new habit")
        answered(pl.post(f"/api/tasks/{ids['tasks'][lead]['Drink a glass of water']}/score", {"direction": "up"}), 200)
        sl.wait("player", lambda d: d["level"] == 2, "the new level")
        sl.wait("notice", lambda d: d["kind"] == "level_up", "a level_up notice")
        answered(pm.post(f"/api/parties/{pid}/chat", {"text": "Walking the dog counts, right?"}), 201)
        sl.wait("chat", lambda d: d["partyId"] == pid and d["text"] == "Walking the dog counts, right?", "the teammate's message")
        answered(pl.post(f"/api/parties/{pid}/invites", {"username": i}), 201)
        si.wait("invite", lambda d: any(x["partyId"] == pid for x in d["invites"]), "the party invite")
        inv = answered(pi.get("/api/invites"), 200)["invites"][0]
        answered(pi.post(f"/api/invites/{inv['id']}/accept"), 200)
        sl.wait("party", lambda d: i in [x["username"] for x in (d.get("members") or (d.get("party") or {}).get("members") or [])], "the new member")
        qid = answered(pl.post(f"/api/parties/{pid}/quests", {"quest": CLUTTER}), 201)["id"]
        sm.wait("quest", lambda d: d["id"] == qid and d["state"] == "invited", "the quest invite")
        answered(pm.post(f"/api/quests/{qid}/accept"), 200)
        answered(pl.post(f"/api/quests/{qid}/begin"), 200)
        sm.wait("quest", lambda d: d["id"] == qid and d["state"] == "active", "the quest start")
        answered(pm.post(f"/api/tasks/{ids['tasks'][m]['Book the dentist']}/complete"), 200)
        sl.wait("strike", lambda d: d["questId"] == qid and d["username"] == m, "the teammate's strike")
        answered(upload_banner(pl, pid, "banner.png", png((200, 40, 120))), 201)
        sm.wait("banner", lambda d: d["partyId"] == pid and bool(d["bannerUrl"]), "the new banner")
        assert not so.seen(lambda n, d: d.get("partyId") == pid or d.get("questId") == qid or d.get("id") in (pid, qid)), \
            "another party's stream received this party's events"


def test_wf_party_quest_live_invite_join_chat(browser, app_url):
    lead, m = uname("wl"), uname("wm")
    _, ps = world(app_url, [{"username": lead}, {"username": m}])
    pl, pm = ps[lead], ps[m]
    name = pname("Lanterns")
    with screen(browser, pl) as lp, screen(browser, pm) as mp:
        ready(lp)
        ready(mp)
        fill(role(lp, "textbox", "Party name"), name)
        click(role(lp, "button", "Form party"))
        see(lp, role(lp, "textbox", "Invite by username"), "leader controls after forming")
        fill(role(lp, "textbox", "Invite by username"), m)
        click(role(lp, "button", "Invite"))
        live(mp, lambda: shows(mp.get_by_text(f"{lead} invited you to {name}.", exact=True)), "invite on the invitee's screen")
        click(role(mp, "button", "Join party"))
        live(lp, lambda: shows(role(lp, "meter", f"{m} health")), "new member on the leader's screen")
        box = role(mp, "textbox", "Message")
        fill(slid_in(box), "Walking the dog counts, right?")
        box.press("Enter")
        live(lp, lambda: expect(role(lp, "log", "Party chat")).to_contain_text(f"{m}: Walking the dog counts, right?", timeout=POLL_MS), "member chat on leader screen")
        fill(role(lp, "textbox", "Message"), "Drowsewyrm is wobbling. One more push tonight.")
        click(role(lp, "button", "Send"))
        live(mp, lambda: expect(role(mp, "log", "Party chat")).to_contain_text(f"{lead}: Drowsewyrm is wobbling. One more push tonight.", timeout=POLL_MS), "leader chat on member screen")
    party = answered(pl.get("/api/party"), 200)["party"]
    assert {x["username"] for x in party["members"]} == {lead, m}
    texts = [x["text"] for x in answered(pl.get(f"/api/parties/{party['id']}/chat"), 200)["messages"]]
    assert texts == ["Walking the dog counts, right?", "Drowsewyrm is wobbling. One more push tonight."]


def test_wf_party_quest_live_quest_start_strike(browser, app_url):
    lead, m, party = uname("ql"), uname("qm"), pname("Wyrm")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], tasks=[T(m, "todo", "Book the dentist")])
    pl = ps[lead]
    mx, dmg = QUESTS[DROWSE]["max"], damage_for(earned_xp("easy", 0))
    with screen(browser, pl) as lp, screen(browser, ps[m]) as mp:
        ready(lp)
        ready(mp)
        combo = role(lp, "combobox", "Quest")
        see(lp, combo, "quest picker")
        assert chosen(combo) == DROWSE
        click(role(lp, "button", "Invite party to quest"))
        live(mp, lambda: shows(role(mp, "button", "Accept quest")), "quest invite on the member's screen")
        see(mp, mp.get_by_text(f"{DROWSE}: 1 of 2 accepted", exact=True), "quest invite count")
        click(role(mp, "button", "Accept quest"))
        live(lp, lambda: expect(role(lp, "button", "Begin quest")).to_be_enabled(timeout=POLL_MS), "Begin quest enabled")
        record_feed(lp)
        click(role(lp, "button", "Begin quest"))
        live(mp, lambda: meter_reads(role(mp, "meter", "Boss health"), f"{h1(mx)} / {h1(mx)}"), "quest start on member screen")
        click(role(mp, "checkbox", "Complete Book the dentist"))
        live(lp, lambda: ensure(f"{m} {MINUS}{h1(dmg)}" in lines(role(lp, "list", "Strikes")), "strike line"), "strike line on leader screen")
        live(lp, lambda: meter_reads(role(lp, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "boss meter on leader screen")
        heard(lp, f"{m} hit the boss for {h1(dmg)} damage")
    quest = pl.quest(answered(pl.get("/api/party"), 200)["party"]["questId"])
    assert quest["state"] == "active" and dec(quest["bossHealth"]) == mx - dmg


def test_wf_party_quest_live_privacy(browser, app_url):
    lead, m, o, party, mine = uname("vl"), uname("vm"), uname("vo"), pname("Secret"), pname("Mine")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}, {"username": o}],
                    parties=[P(party, lead, m), P(mine, o)], quests=[Q(party, CLUTTER)])
    pid, qid = ids["parties"][party], ids["quests"][party]
    with screen(browser, ps[o]) as op, screen(browser, ps[m]) as mp:
        ready(op)
        ready(mp)
        answered(ps[lead].post(f"/api/parties/{pid}/chat", {"text": "Drowsewyrm is wobbling. One more push tonight."}), 201)
        live(mp, lambda: expect(role(mp, "log", "Party chat")).to_contain_text("Drowsewyrm is wobbling.", timeout=POLL_MS), "member sees chat")
        quiet(op, lambda: ensure(op.get_by_text("Drowsewyrm is wobbling.").count() == 0, "outsider saw the chat"), "outsider stays private")
    answered(ps[o].get(f"/api/parties/{pid}/chat"), 404, {"error": "not_found"})
    answered(ps[o].get(f"/api/quests/{qid}"), 404, {"error": "not_found"})


def test_strikes_in_server_order(app_url):
    names = [uname(f"s{i}") for i in range(PARTY_MAX)]
    party = pname("Swarm")
    ids, ps = world(app_url, [{"username": n} for n in names], parties=[P(party, names[0], *names[1:])], quests=[Q(party, MOTH)],
                    tasks=[t for n in names for t in (T(n, "todo", "Book the dentist", difficulty="hard"), T(n, "todo", "Return library books"))])
    qid, mx = ids["quests"][party], QUESTS[MOTH]["max"]
    calls = [lambda p=ps[n], t=ids["tasks"][n][title]: p.post(f"/api/tasks/{t}/complete")
             for n in names for title in ("Book the dentist", "Return library books")]
    replies = [answered(r, 200) for r in together(*calls)]
    views = [ps[n].quest(qid)["events"] for n in names]
    assert all(v == views[0] for v in views), "members read different strike lists"
    strikes = [e for e in views[0] if e["kind"] == "strike"]
    assert len(strikes) == len(calls) and [e["seq"] for e in strikes] == sorted({e["seq"] for e in strikes})
    left = mx
    for e in strikes:
        left -= dec(e["amount"])
        assert dec(e["bossHealthAfter"]) == left
    assert dec(ps[names[0]].quest(qid)["bossHealth"]) == left
    assert {r["strike"]["id"] for r in replies} == {e["id"] for e in strikes}


def test_idempotent_ticks(app_url):
    u, v = uname("idk"), uname("idv")
    ids, ps = world(app_url, [{"username": u, "gold": 20}, {"username": v}], tasks=[
        T(u, "todo", "Book the dentist"), T(u, "habit", "Drink a glass of water"), T(u, "reward", "Fancy coffee", price=5),
        T(u, "daily", "Walk the dog"), T(u, "daily", "Read one chapter"), T(v, "todo", "Book the dentist")])
    p, t = ps[u], ids["tasks"][u]
    k1 = idempotency_key()
    r1 = p.post(f"/api/tasks/{t['Book the dentist']}/complete", key=k1)
    r2 = p.post(f"/api/tasks/{t['Book the dentist']}/complete", key=k1)
    assert r1.status_code == r2.status_code == 200 and r1.json() == r2.json()
    answered(p.post(f"/api/tasks/{t['Walk the dog']}/complete", key=k1), 409, {"error": "idempotency_key_reused"})
    answered(p.post(f"/api/tasks/{t['Book the dentist']}/uncomplete"), 200)
    r3 = p.post(f"/api/tasks/{t['Book the dentist']}/complete", key=k1)
    assert r3.status_code == 200 and r3.json() == r1.json() and p.task(t["Book the dentist"])["done"] is False
    k2 = idempotency_key()
    for _ in range(2):
        answered(p.post(f"/api/tasks/{t['Drink a glass of water']}/score", {"direction": "up"}, key=k2), 200)
    answered(p.post(f"/api/tasks/{t['Drink a glass of water']}/score", {"direction": "down"}, key=k2), 409, {"error": "idempotency_key_reused"})
    assert p.task(t["Drink a glass of water"])["value"] == 1
    k3 = idempotency_key()
    for _ in range(2):
        answered(p.post(f"/api/rewards/{t['Fancy coffee']}/buy", key=k3), 200)
    assert len([e for e in p.ledger() if e["kind"] == "reward"]) == 1
    answered(p.post(f"/api/tasks/{t['Walk the dog']}/complete"), 200)
    k4 = idempotency_key()
    for _ in range(2):
        answered(p.post(f"/api/tasks/{t['Walk the dog']}/uncomplete", key=k4), 200)
    assert len([e for e in p.ledger() if e["kind"] == "undo"]) == 2
    answered(ps[v].post(f"/api/tasks/{ids['tasks'][v]['Book the dentist']}/complete", key=k1), 200)
    a, b = together(lambda: p.post(f"/api/tasks/{t['Read one chapter']}/complete"), lambda: p.post(f"/api/tasks/{t['Read one chapter']}/complete"))
    assert sorted([a.status_code, b.status_code]) == [200, 409]
    assert next(r for r in (a, b) if r.status_code == 409).json() == {"error": "already_done"}
    assert len([e for e in p.ledger() if e["taskId"] == t["Read one chapter"]]) == 1


def test_defeat_and_quest_reward(app_url):
    a, b, party = uname("da"), uname("db"), pname("Finish")
    left = Decimal("6.0")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, CLUTTER, bossHealth=float(left))],
                    tasks=[T(a, "todo", "Book the dentist", difficulty="hard"), T(b, "todo", "Book the dentist", difficulty="hard"),
                           T(a, "todo", "Return library books")])
    qid, f = ids["quests"][party], QUESTS[CLUTTER]
    rs = [answered(r, 200) for r in together(lambda: ps[a].post(f"/api/tasks/{ids['tasks'][a]['Book the dentist']}/complete"),
                                             lambda: ps[b].post(f"/api/tasks/{ids['tasks'][b]['Book the dentist']}/complete"))]
    strikes = [r["strike"] for r in rs if r["strike"]]
    assert len(strikes) == 1 and dec(strikes[0]["amount"]) == left and dec(strikes[0]["bossHealthAfter"]) == 0
    quest = ps[a].quest(qid)
    assert quest["state"] == "defeated" and quest["defeatedBy"] == strikes[0]["username"] and dec(quest["bossHealth"]) == 0
    gain = earned_xp("hard", 0)
    for n in (a, b):
        assert [dec(e["amount"]) for e in ps[n].ledger() if e["kind"] == "quest"] == [f["gold"]]
        me = ps[n].me()
        assert (me["level"], me["experience"]) == apply_xp(1, 0, gain + f["xp"])
    later = answered(ps[a].post(f"/api/tasks/{ids['tasks'][a]['Return library books']}/complete"), 200)
    assert later["strike"] is None and later["delta"]["experience"] > 0
    assert len([e for e in ps[a].ledger() if e["kind"] == "quest"]) == 1


def test_wf_simultaneous_strikes_two_screens(browser, app_url):
    a, b, party = uname("ta"), uname("tb"), pname("Pair")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, MOTH)],
                    tasks=[T(a, "todo", "Book the dentist", difficulty="hard"), T(b, "todo", "Return library books", difficulty="hard")])
    qid, mx = ids["quests"][party], QUESTS[MOTH]["max"]
    with screen(browser, ps[a]) as pa, screen(browser, ps[b]) as pb:
        ready(pa)
        ready(pb)
        role(pa, "checkbox", "Complete Book the dentist").click(no_wait_after=True)
        role(pb, "checkbox", "Complete Return library books").click(no_wait_after=True)
        poll(lambda: ensure(len(ps[a].quest(qid)["events"]) == 2, "two strikes"), "both strikes stored")
        quest = ps[a].quest(qid)
        want = [f"{e['username']} {MINUS}{h1(e['amount'])}" for e in quest["events"]]
        for page in (pa, pb):
            live(page, lambda page=page: ensure(lines(role(page, "list", "Strikes")) == want, str(lines(role(page, "list", "Strikes")))), "strike lines in server order")
            live(page, lambda page=page: meter_reads(role(page, "meter", "Boss health"), f"{h1(quest['bossHealth'])} / {h1(mx)}"), "boss meter matches server")


def test_wf_simultaneous_strikes_replayed_tick(browser, app_url):
    a, b, party = uname("ra"), uname("rb"), pname("Retry")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, MOTH)],
                    tasks=[T(b, "todo", "Return library books", difficulty="hard")])
    mx, dmg = QUESTS[MOTH]["max"], damage_for(earned_xp("hard", 0))
    tid = ids["tasks"][b]["Return library books"]
    with screen(browser, ps[a]) as pa:
        ready(pa)
        key = idempotency_key()
        for _ in range(2):
            answered(ps[b].post(f"/api/tasks/{tid}/complete", key=key), 200)
        live(pa, lambda: meter_reads(role(pa, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "boss dropped once")
        quiet(pa, lambda: ensure(lines(role(pa, "list", "Strikes")).count(f"{b} {MINUS}{h1(dmg)}") <= 1, "strike shown twice"), "one strike line")
    assert len(ps[b].quest(ids["quests"][party])["events"]) == 1
    assert len([e for e in ps[b].ledger() if e["taskId"] == tid]) == 1


def test_wf_simultaneous_strikes_defeat(browser, app_url):
    a, b, party = uname("fa"), uname("fb"), pname("Down")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, CLUTTER, bossHealth=4)],
                    tasks=[T(a, "todo", "Book the dentist")])
    with screen(browser, ps[a]) as pa, screen(browser, ps[b]) as pb:
        ready(pa)
        ready(pb)
        click(role(pa, "checkbox", "Complete Book the dentist"))
        for page in (pa, pb):
            live(page, lambda page=page: expect(role(page, "region", "Quest")).to_contain_text(f"{a} landed the last blow.", timeout=POLL_MS), "defeat line")
            expect(role(page, "region", "Quest")).to_contain_text("DOWN")
    for n in (a, b):
        assert [dec(e["amount"]) for e in ps[n].ledger() if e["kind"] == "quest"] == [QUESTS[CLUTTER]["gold"]]


def test_strike_back(app_url):
    a, b, c, x, y = (uname(t) for t in ("ba", "bb", "bc", "bx", "by"))
    party, calm = pname("Back"), pname("Calm")
    ids, ps = world(app_url, [{"username": a}, {"username": b}, {"username": c, "resting": True}, {"username": x}, {"username": y}],
                    parties=[P(party, a, b, c), P(calm, x, y)],
                    quests=[Q(party, DROWSE), Q(calm, DROWSE, state="invited")],
                    tasks=[T(a, "daily", "Walk the dog"), T(a, "daily", "Practice guitar"), T(x, "daily", "Walk the dog")])
    closes = rollover(app_url, ids["users"][a]["nextCloseAt"])
    back = q(QUESTS[DROWSE]["power"] * 2, "0.1")
    own = health_loss("easy", 0) * 2
    ca = closes_of(closes, a)
    assert len(ca) == 1 and ca[0]["missed"] == 2 and dec(ca[0]["healthLost"]) == own and dec(ca[0]["strikeBack"]) == back
    assert dec(ps[a].me()["health"]) == MAX_HEALTH - own - back
    assert dec(ps[b].me()["health"]) == MAX_HEALTH - back and dec(ps[c].me()["health"]) == MAX_HEALTH
    ev = [e for e in ps[b].quest(ids["quests"][party])["events"] if e["kind"] == "strikeback"]
    assert [(e["username"], e["missed"], dec(e["amount"]), dec(e["bossHealthAfter"])) for e in ev] == [(a, 2, back, QUESTS[DROWSE]["max"])]
    assert dec(closes_of(closes, x)[0]["strikeBack"]) == 0 and dec(ps[y].me()["health"]) == MAX_HEALTH


def test_game_feed_announcements(browser, app_url):
    a, b, party = uname("ga"), uname("gb"), pname("Feed")
    gain = earned_xp("easy", 0)
    first = damage_for(gain)
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)],
                    quests=[Q(party, CLUTTER, bossHealth=float(first + 2))],
                    tasks=[T(a, "todo", "Book the dentist"), T(b, "todo", "Return library books", difficulty="hard")])
    f = QUESTS[CLUTTER]
    with screen(browser, ps[a]) as pa, screen(browser, ps[a]) as pa2, screen(browser, ps[b]) as pb:
        for page in (pa, pa2, pb):
            ready(page)
            record_feed(page)
        click(role(pa, "checkbox", "Complete Book the dentist"))
        done = f"Book the dentist complete: +{gain} experience, +{g2(gold_for(gain))} gold"
        hit = f"Boss took {h1(first)} damage"
        heard(pa, done)
        heard(pa, hit)
        assert feed_log(pa).find(done) < feed_log(pa).rfind(hit), "strike announced before the completion"
        heard(pa2, hit)
        heard(pb, f"{a} hit the boss for {h1(first)} damage")
        answered(ps[b].post(f"/api/tasks/{ids['tasks'][b]['Return library books']}/complete"), 200)
        for page in (pa, pb):
            heard(page, f"Quest complete: +{g2(f['gold'])} gold, +{f['xp']} experience")


def test_wf_strike_back_live(browser, app_url):
    a, b, party = uname("sa"), uname("sb"), pname("Hit")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog")])
    back = q(QUESTS[DROWSE]["power"], "0.1")
    with screen(browser, ps[b]) as page:
        ready(page)
        record_feed(page)
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        want = f"{h1(MAX_HEALTH - back)} / 50.0"
        live(page, lambda: meter_reads(role(page, "meter", "Health"), want), "own health meter")
        live(page, lambda: meter_reads(role(page, "meter", f"{b} health"), want), "member health meter")
        live(page, lambda: ensure(f"Drowsewyrm struck back for {h1(back)} ({a} missed 1)" in lines(role(page, "list", "Strikes")), "strike-back line"), "strike-back line")
        heard(page, f"Drowsewyrm struck back: you lost {h1(back)} health")
    assert dec(ps[b].me()["health"]) == MAX_HEALTH - back


def test_scheduler_closes_unprompted(app_url):
    today = utc_today(app_url)
    a, b, party = uname("sca"), uname("scb"), pname("Clock")
    past = (today - timedelta(days=1)).isoformat()
    ids = setup(app_url, {"users": [{"username": a, "password": PASSWORD, "currentDate": past},
                                    {"username": b, "password": PASSWORD}],
                          "parties": [P(party, a, b)], "quests": [Q(party, DROWSE)],
                          "tasks": [T(a, "daily", "Walk the dog", streak=3)]})
    watcher = Player(app_url, b)
    qid = ids["quests"][party]
    back = q(QUESTS[DROWSE]["power"], "0.1")

    def struck() -> list[dict]:
        ensure(dec(watcher.me()["health"]) == MAX_HEALTH - back, f"teammate health {watcher.me()['health']}")
        events = [e for e in watcher.quest(qid)["events"] if e["kind"] == "strikeback"]
        ensure(len(events) == 1, f"strike-back events: {events}")
        return events

    events = poll(struck, "the server ran the due close by itself (teammate untouched until then lost no health)",
                  CLOSE_DEADLINE_S + POLL_SLACK_S)
    assert (events[0]["username"], events[0]["missed"], dec(events[0]["amount"])) == (a, 1, back)
    misser = Player(app_url, a)
    me = misser.me()
    assert dec(me["health"]) == MAX_HEALTH - health_loss("easy", 0) - back
    assert me["today"] == today.isoformat()
    assert misser.tasks()["dailies"][0]["streak"] == 0


def test_wf_strike_back_resting_teammate(browser, app_url):
    a, c, party = uname("sr"), uname("sc"), pname("Snooze")
    ids, ps = world(app_url, [{"username": a}, {"username": c, "resting": True}], parties=[P(party, a, c)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog")])
    back = q(QUESTS[DROWSE]["power"], "0.1")
    with screen(browser, ps[c], clock_at=WRONG_CLOCKS[0]) as page:
        ready(page)
        record_feed(page)
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        live(page, lambda: ensure(f"Drowsewyrm struck back for {h1(back)} ({a} missed 1)" in lines(role(page, "list", "Strikes")), "line"), "strike-back line")
        meter_reads(role(page, "meter", "Health"), "50.0 / 50.0")
        assert "struck back: you lost" not in feed_log(page)
    assert dec(ps[c].me()["health"]) == MAX_HEALTH


def test_wf_phone_lists_tabs_keyboard(browser, app_url):
    u = uname("tab")
    ids, ps = world(app_url, [{"username": u, "gold": 10}], tasks=[T(u, "habit", "Drink a glass of water"), T(u, "daily", "Walk the dog"),
                                                                    T(u, "reward", "Fancy coffee", price=5)])
    p = ps[u]
    with screen(browser, p, viewport=PHONE) as page:
        tabs = role(page, "tablist", "Lists")
        see(page, tabs, "Lists tab bar")
        see(page, role(page, "list", "Habits"), "Habits shown first")
        tap(role(page, "tab", "Dailies"))
        see(page, role(page, "list", "Dailies"), "Dailies after tap")
        assert not role(page, "list", "Habits").is_visible(), "two lists shown at once"
        role(page, "tab", "Dailies").focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(role(page, "tab", "To-dos")).to_have_attribute("aria-selected", "true", timeout=POLL_MS), "ArrowRight activates To-dos")
        see(page, role(page, "list", "To-dos"), "To-dos list")
        page.keyboard.press("ArrowRight")
        see(page, role(page, "list", "Rewards"), "Rewards list")
        page.keyboard.press("ArrowLeft")
        see(page, role(page, "list", "To-dos"), "ArrowLeft goes back")
        tap(role(page, "tab", "Rewards"))
        tap(role(page, "button", "Buy Fancy coffee"))
        eventually(page, lambda: ensure(dec(p.me()["gold"]) == Decimal("5"), "gold"), "purchase reached the server")


def test_wf_phone_lists_swipe_and_party(browser, app_url):
    u, party = uname("swp"), pname("Pocket")
    ids, ps = world(app_url, [{"username": u}], parties=[P(party, u)], tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    gain = earned_xp("easy", 0)
    with screen(browser, p, viewport=PHONE) as page:
        cdp = touch(page)
        tap(role(page, "tab", "Dailies"))
        row = daily_row(page, "Walk the dog", True, 0, False)
        see(page, row, "daily row")
        record_feed(page)
        swipe(page, cdp, row, SWIPE_PX + 20)
        heard(page, f"Walk the dog complete: +{gain} experience, +{g2(gold_for(gain))} gold")
        tap(role(page, "button", "Party"))
        dialog = role(page, "dialog", "Party")
        see(page, dialog, "Party dialog")
        box = role(dialog, "textbox", "Message")
        fill(slid_in(box), "Walking the dog counts, right?")
        box.press("Enter")
        eventually(page, lambda: ensure(any(m["text"] == "Walking the dog counts, right?" for m in
                                            answered(p.get(f"/api/parties/{ids['parties'][party]}/chat"), 200)["messages"]), "no chat"), "chat from the Party dialog")
        layout(page)
    assert p.tasks()["dailies"][0]["done"] is True


def test_swipe_to_complete(browser, app_url):
    u = uname("swi")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", "Walk the dog"), T(u, "daily", "Read one chapter", done=True),
                                                       T(u, "todo", "Return library books", difficulty="trivial")])
    p, t = ps[u], ids["tasks"][u]
    with screen(browser, p, viewport=PHONE) as page:
        cdp = touch(page)
        tap(role(page, "tab", "Dailies"))
        row = daily_row(page, "Walk the dog", True, 0, False)
        see(page, row, "daily row")
        swipe(page, cdp, row, SWIPE_PX - 1)
        holds(lambda: ensure(p.task(t["Walk the dog"])["done"] is False, "short swipe completed"), "79 px swipe does nothing", LIVE_BUDGET_S)
        swipe(page, cdp, daily_row(page, "Walk the dog", True, 0, False), SWIPE_PX)
        poll(lambda: ensure(p.task(t["Walk the dog"])["done"] is True, "not done"), "80 px swipe completes the daily")
        swipe(page, cdp, daily_row(page, "Read one chapter", True, 0, True), SWIPE_PX + 40)
        holds(lambda: ensure(p.task(t["Read one chapter"])["done"] is True, "done row changed"), "swipe on a done row does nothing", LIVE_BUDGET_S)
        tap(role(page, "tab", "To-dos"))
        todo = todo_row(page, "Return library books", False)
        see(page, todo, "to-do row")
        swipe(page, cdp, todo, SWIPE_PX)
        poll(lambda: ensure(p.task(t["Return library books"])["done"] is True, "not done"), "80 px swipe completes the to-do")


VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
VIEW_IDS = ["phone", "tablet", "desktop"]
CONTROL_ROLES = ["button", "link", "checkbox", "tab", "switch", "textbox", "combobox", "spinbutton"]
TARGET_JS = """e => { const b = [e.getBoundingClientRect()];
  for (const l of (e.labels || [])) b.push(l.getBoundingClientRect());
  const c = e.closest('label'); if (c) b.push(c.getBoundingClientRect());
  return [Math.max(...b.map(r => r.width)), Math.max(...b.map(r => r.height))]; }"""


@pytest.mark.parametrize("view", VIEW_IDS, ids=VIEW_IDS)
def test_responsive_layouts(browser, app_url, view):
    u, party = uname("lay"), pname("Layout")
    _, ps = world(app_url, [{"username": u}], parties=[P(party, u)], quests=[Q(party, CLUTTER)],
                  tasks=[T(u, "habit", "Drink a glass of water"), T(u, "daily", "Walk the dog"), T(u, "todo", "Book the dentist"),
                         T(u, "reward", "Fancy coffee", price=5)])
    with screen(browser, ps[u], viewport=VIEWPORTS[view]) as page:
        ready(page)
        layout(page)
        lists = {n: role(page, "list", n) for n in ("Habits", "Dailies", "To-dos", "Rewards")}
        if view == "phone":
            see(page, role(page, "tablist", "Lists"), "Lists tabs")
            assert [n for n, l in lists.items() if l.is_visible()] == ["Habits"]
            see(page, role(page, "button", "Party"), "Party button")
            small = []
            for r in CONTROL_ROLES:
                for loc in page.get_by_role(r).all():
                    if loc.is_visible():
                        w, h = loc.evaluate(TARGET_JS)
                        if w < TOUCH_MIN_PX - SUBPIXEL_PX or h < TOUCH_MIN_PX - SUBPIXEL_PX:
                            small.append((r, round(w), round(h)))
            assert not small, f"controls under 44x44 px: {small}"
            return
        box = {n: l.bounding_box() for n, l in lists.items()}
        if view == "tablet":
            see(page, role(page, "button", "Party"), "Party button")
            assert abs(box["Habits"]["y"] - box["Dailies"]["y"]) <= LAYOUT_SLACK_PX and box["Habits"]["x"] < box["Dailies"]["x"]
            assert abs(box["To-dos"]["y"] - box["Rewards"]["y"]) <= LAYOUT_SLACK_PX and box["To-dos"]["x"] < box["Rewards"]["x"]
            assert box["To-dos"]["y"] > box["Habits"]["y"]
            return
        cols = [box[n] for n in ("Habits", "Dailies", "To-dos")]
        assert cols[0]["x"] < cols[1]["x"] < cols[2]["x"]
        assert max(c["y"] for c in cols) - min(c["y"] for c in cols) <= LAYOUT_SLACK_PX
        assert max(c["width"] for c in cols) - min(c["width"] for c in cols) <= LAYOUT_SLACK_PX
        assert box["Rewards"]["y"] >= max(c["y"] + c["height"] for c in cols) - LAYOUT_SLACK_PX
        rail = role(page, "region", "Quest").bounding_box()
        assert rail["x"] >= cols[2]["x"] + cols[2]["width"] - LAYOUT_SLACK_PX


IMPORT_CASES = {
    "valid": ("DEEDLIST 1\n# morning\n\nhabit | Drink a glass of water | easy\ndaily | Walk the dog | trivial | Mon,Wed,Fri\n"
              "todo | Book the dentist | hard | Find the number; Call before noon\ntodo | Return library books | medium\nreward | Fancy coffee | 5.5\n", []),
    "bad_first_line": ("DEEDLIST 2\nchore | Walk the dog | epic\n", [(1, "Line 1: the first line must be DEEDLIST 1")]),
    "type_and_count": ("DEEDLIST 1\nchore | Walk the dog | easy\nhabit | Drink a glass of water | epic | Mon\ndaily | Walk the dog | easy\n"
                       "todo | Book the dentist\nreward | Fancy coffee | 5 | 6\n",
                       [(2, 'Line 2: unknown task type "chore"'), (3, "Line 3: expected 3 fields, found 4"),
                        (4, "Line 4: expected 4 fields, found 3"), (5, "Line 5: expected 3 or 4 fields, found 2"),
                        (6, "Line 6: expected 3 fields, found 4")]),
    "field_errors": ("DEEDLIST 1\n\n# skipped\ndaily |  | epic | Mon,Mon\nreward | Fancy coffee | 0\nreward | Episode of a show | 12.345\n"
                     "habit | " + "x" * (TITLE_MAX + 1) + " | easy\ndaily | Walk the dog | easy | Funday\nhabit | Drink a glass of water | easy\n",
                     [(4, "Line 4: title must be 1 to 80 characters"), (4, "Line 4: difficulty must be trivial, easy, medium or hard"),
                      (4, "Line 4: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun"),
                      (5, "Line 5: price must be a number from 0.01 to 9999.99"), (6, "Line 6: price must be a number from 0.01 to 9999.99"),
                      (7, "Line 7: title must be 1 to 80 characters"),
                      (8, "Line 8: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun")]),
}


IMPORT_IDS = ["valid", "bad_first_line", "type_and_count", "field_errors"]


@pytest.mark.parametrize("case", IMPORT_IDS, ids=IMPORT_IDS)
def test_import_format(app_url, case):
    content, errors = IMPORT_CASES[case]
    u = uname("imp")
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Take the stairs")])
    p = ps[u]
    r = upload_import(p, IMPORT_NAME, content.encode())
    if errors:
        body = answered(r, 422)
        assert body["errors"] == [{"line": n, "message": msg} for n, msg in errors]
        rec = answered(p.get(f"/api/imports/{body['importId']}"), 200)
        assert rec["status"] == "rejected" and rec["errorCount"] == len(errors) and rec["taskCount"] == 0
        assert sum(len(v) for v in p.tasks().values()) == 1
        return
    rec = answered(r, 201)
    assert rec["status"] == "imported" and rec["taskCount"] == 5 and rec["errorCount"] == 0 and rec["filename"] == IMPORT_NAME
    assert [(x["line"], x["title"]) for x in rec["lines"]] == [(4, "Drink a glass of water"), (5, "Walk the dog"), (6, "Book the dentist"),
                                                             (7, "Return library books"), (8, "Fancy coffee")]
    t = p.tasks()
    assert [(h["title"], h["position"]) for h in t["habits"]] == [("Take the stairs", 1), ("Drink a glass of water", 2)]
    assert t["dailies"][0]["weekdays"] == ["Mon", "Wed", "Fri"] and t["dailies"][0]["difficulty"] == "trivial"
    assert [i["text"] for i in t["todos"][0]["checklist"]] == ["Find the number", "Call before noon"]
    assert dec(t["rewards"][0]["price"]) == Decimal("5.5")
    assert {x["taskId"] for x in rec["lines"]} == {x["id"] for v in t.values() for x in v if x["title"] != "Take the stairs"}


def test_import_originals_stored(app_url):
    u, o = uname("org"), uname("oro")
    _, ps = world(app_url, [{"username": u}, {"username": o}])
    p = ps[u]
    uid = p.me()["id"]
    good = "DEEDLIST 1\nhabit | Café au lait | easy\nreward | Fancy coffee | 5".encode()
    bad = "DEEDLIST 1\nhabit | Café au lait | epic\n".encode()
    ok = answered(upload_import(p, "café.deedlist", good), 201)["id"]
    rej = answered(upload_import(p, "broken.deedlist", bad), 422)["importId"]
    store = S3()
    for iid, data, name in ((ok, good, "café.deedlist"), (rej, bad, "broken.deedlist")):
        assert store.get(f"imports/{uid}/{iid}.deedlist") == data
        r = p.get(f"/api/imports/{iid}/original")
        assert r.status_code == 200 and r.content == data
        assert r.headers["content-type"].replace(" ", "").lower() == "text/plain; charset=utf-8".replace(" ", "")
        assert "attachment" in r.headers["content-disposition"]
        answered(ps[o].get(f"/api/imports/{iid}/original"), 404, {"error": "not_found"})


def test_upload_limits(browser, app_url):
    u, party = uname("lim"), pname("Limits")
    ids, ps = world(app_url, [{"username": u}], parties=[P(party, u)])
    p = ps[u]
    uid, pid = p.me()["id"], ids["parties"][party]
    store = S3()
    head = b"DEEDLIST 1\n"
    big, sig = {"error": "file_too_large"}, {"error": "unsupported_file_type"}
    keys = set(store.keys(f"imports/{uid}/")), set(store.keys(f"banners/{pid}/"))
    for name, data, status, body in [("big.deedlist", padded(head, IMPORT_LIMIT + 1), 413, big),
                                     ("big.txt", padded(head, IMPORT_LIMIT + 1), 413, big),
                                     ("tasks.txt", head, 415, sig), ("bytes.deedlist", head + b"\xff\xfe\n", 415, sig),
                                     ("nul.deedlist", head + b"#\x00\n", 415, sig)]:
        answered(upload_import(p, name, data), status, body, what=f"import {name}")
    for name, data, status, body in [("big.png", padded(b"\x89PNG\r\n\x1a\n", BANNER_LIMIT + 1), 413, big),
                                     ("fake.png", b"GIF89a" + bytes(64), 415, sig)]:
        answered(upload_banner(p, pid, name, data), status, body, what=f"banner {name}")
    assert (set(store.keys(f"imports/{uid}/")), set(store.keys(f"banners/{pid}/"))) == keys
    assert answered(p.get("/api/imports"), 200)["imports"] == [] and answered(p.get(f"/api/parties/{pid}"), 200)["bannerUrl"] is None
    answered(upload_import(p, "edge.deedlist", padded(head, IMPORT_LIMIT)), 201)
    answered(upload_banner(p, pid, "edge.png", padded(b"\x89PNG\r\n\x1a\n", BANNER_LIMIT)), 201)
    with screen(browser, p) as page:
        ready(page)
        for data, copy in ((b"GIF89a" + bytes(64), "Choose a PNG or JPEG image."),
                           (padded(b"\x89PNG\r\n\x1a\n", BANNER_LIMIT + 1), "The image is larger than 2,000,000 bytes.")):
            page.get_by_label("Banner image").set_input_files(files=[{"name": "banner.png", "mimeType": "image/png", "buffer": data}])
            click(role(page, "button", "Upload banner"))
            see(page, page.get_by_text(copy, exact=True), f"banner copy {copy!r}")


def test_wf_import_tasks_errors_then_fixed(browser, app_url):
    u = uname("imw")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    broken = b"DEEDLIST 1\nhabit | Drink a glass of water | epic\ndaily | Walk the dog | easy | Funday\nreward | Fancy coffee | 0\n"
    fixed = b"DEEDLIST 1\nhabit | Drink a glass of water | easy\ndaily | Walk the dog | easy | Mon,Fri\nreward | Fancy coffee | 5\n"
    with screen(browser, p) as page:
        ready(page)
        click(role(page, "button", "Import tasks"))
        dialog = role(page, "dialog", "Import tasks")
        see(page, dialog, "Import tasks dialog")
        dialog.get_by_label("Task list file").set_input_files(files=[{"name": "routine.deedlist", "mimeType": "text/plain", "buffer": broken}])
        with held(page, "**/api/imports") as gate:
            click(slid_in(role(dialog, "button", "Import")))
            see(page, role(dialog, "button", "Importing..."), "pending import button")
            expect(role(dialog, "button", "Importing...")).to_be_disabled()
            gate.release()
        errs = role(dialog, "list", "Import errors")
        want = ["Line 2: difficulty must be trivial, easy, medium or hard",
                "Line 3: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun",
                "Line 4: price must be a number from 0.01 to 9999.99"]
        eventually(page, lambda: ensure(lines(errs) == want, str(lines(errs))), "each import error by line")
        dialog.get_by_label("Task list file").set_input_files(files=[{"name": "routine-fixed.deedlist", "mimeType": "text/plain", "buffer": fixed}])
        click(slid_in(role(dialog, "button", "Import")))
        see(page, dialog.get_by_role("status").filter(has_text="Imported 3 tasks"), "import success status")
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes the Import tasks sheet")
        click(role(page, "link", "Import history"))
        history = role(page, "list", "Import history")
        see(page, history, "import history")
        rejected = history.get_by_role("listitem").filter(has_text="routine.deedlist")
        expect(rejected).to_contain_text("Rejected: 3 errors")
        expect(history.get_by_role("listitem").filter(has_text="routine-fixed.deedlist")).to_contain_text("Imported 3 tasks")
        with page.expect_download() as dl:
            click(role(rejected, "link", "Download original"))
        assert Path(dl.value.path()).read_bytes() == broken
    imports = answered(p.get("/api/imports"), 200)["imports"]
    assert [i["status"] for i in imports] == ["imported", "rejected"]
    uid = p.me()["id"]
    assert sorted(S3().get(f"imports/{uid}/{i['id']}.deedlist") for i in imports) == sorted([broken, fixed])
    assert {t["title"] for v in p.tasks().values() for t in v} == {"Drink a glass of water", "Walk the dog", "Fancy coffee"}


def test_wf_import_tasks_outage(browser):
    base = outage_url("APP_STORAGE_DOWN_URL")
    p = Player.signup(base, uname("out"))
    with screen(browser, p) as page:
        ready(page)
        click(role(page, "button", "Import tasks"))
        dialog = role(page, "dialog", "Import tasks")
        dialog.get_by_label("Task list file").set_input_files(files=[{"name": "routine.deedlist", "mimeType": "text/plain",
                                                                    "buffer": b"DEEDLIST 1\nhabit | Drink a glass of water | easy\n"}])
        click(slid_in(role(dialog, "button", "Import")))
        see(page, page.get_by_text("File storage is unavailable. Nothing was imported.", exact=True), "storage outage copy")
    assert answered(p.get("/api/imports"), 200)["imports"] == []
    assert sum(len(v) for v in p.tasks().values()) == 0


def test_wf_import_tasks_wrong_type(browser, app_url):
    u = uname("iwt")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        click(role(page, "button", "Import tasks"))
        dialog = role(page, "dialog", "Import tasks")
        for name, data, copy in (("routine.txt", b"DEEDLIST 1\n", "Choose a .deedlist text file."),
                                 ("routine.deedlist", padded(b"DEEDLIST 1\n", IMPORT_LIMIT + 1), "The file is larger than 100,000 bytes.")):
            dialog.get_by_label("Task list file").set_input_files(files=[{"name": name, "mimeType": "text/plain", "buffer": data}])
            click(slid_in(role(dialog, "button", "Import")))
            see(page, page.get_by_text(copy, exact=True), f"copy {copy!r}")
    assert S3().keys(f"imports/{p.me()['id']}/") == [] and answered(p.get("/api/imports"), 200)["imports"] == []


def test_storage_outage(browser):
    base = outage_url("APP_STORAGE_DOWN_URL")
    answered(httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})
    p, m = Player.signup(base, uname("sd")), Player.signup(base, uname("sm"))
    habit = answered(p.post("/api/tasks", {"type": "habit", "title": "Drink a glass of water", "difficulty": "easy"}), 201)
    answered(p.post(f"/api/tasks/{habit['id']}/score", {"direction": "up"}), 200)
    party = answered(p.post("/api/parties", {"name": pname("Offline")}), 201)
    pid = party["id"]
    answered(upload_import(p, "routine.deedlist", b"DEEDLIST 1\nhabit | Take the stairs | easy\n"), 503, {"error": "storage_unavailable"})
    answered(upload_banner(p, pid, "banner.png", png((10, 10, 10))), 503, {"error": "storage_unavailable"})
    assert answered(p.get("/api/imports"), 200)["imports"] == [] and len(p.tasks()["habits"]) == 1
    assert answered(p.get(f"/api/parties/{pid}"), 200)["bannerUrl"] is None
    answered(p.post(f"/api/parties/{pid}/invites", {"username": m.username}), 201)
    inv = answered(m.get("/api/invites"), 200)["invites"][0]
    answered(m.post(f"/api/invites/{inv['id']}/accept"), 200)
    with LiveStream(p) as s:
        answered(m.post(f"/api/parties/{pid}/chat", {"text": "Walking the dog counts, right?"}), 201)
        s.wait("chat", lambda d: d["partyId"] == pid, "chat during a storage outage")
    with screen(browser, p) as page:
        ready(page)
        page.get_by_label("Banner image").set_input_files(files=[{"name": "banner.png", "mimeType": "image/png", "buffer": png((10, 10, 10))}])
        click(role(page, "button", "Upload banner"))
        see(page, page.get_by_text("File storage is unavailable. The banner was not changed.", exact=True), "banner outage copy")


def test_party_banner(app_url):
    lead, m, o, party, other = uname("bl"), uname("bm"), uname("bo"), pname("Banner"), pname("Nosy")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}, {"username": o}], parties=[P(party, lead, m), P(other, o)])
    pid = ids["parties"][party]
    image = png((230, 30, 120))
    url = answered(upload_banner(ps[lead], pid, "banner.png", image), 201)["bannerUrl"]
    found = re.fullmatch(rf"/api/parties/{re.escape(pid)}/banner\?v=(.+)", url)
    assert found, url
    store = S3()
    assert store.get(f"banners/{pid}/{found.group(1)}.png") == image
    r = ps[m].get(url)
    assert r.status_code == 200 and r.content == image and r.headers["content-type"].startswith("image/png")
    answered(ps[o].get(url), 404, {"error": "not_found"})
    answered(ps[m].http.put(f"/api/parties/{pid}/banner", files={"file": ("b.png", image, "image/png")}), 403, {"error": "leader_only"})
    url2 = answered(upload_banner(ps[lead], pid, "banner.png", JPEG), 201)["bannerUrl"]
    up2 = re.fullmatch(rf"/api/parties/{re.escape(pid)}/banner\?v=(.+)", url2).group(1)
    assert store.get(f"banners/{pid}/{up2}.jpg") == JPEG
    assert answered(ps[m].get(f"/api/parties/{pid}"), 200)["bannerUrl"] == url2
    r2 = ps[m].get(f"/api/parties/{pid}/banner")
    assert r2.content == JPEG and r2.headers["content-type"].startswith("image/jpeg")
    answered(ps[o].get(f"/api/parties/{ids['parties'][other]}/banner"), 404, {"error": "not_found"})


def test_quest_history(browser, app_url):
    lead, m, party = uname("hl"), uname("hm"), pname("History")
    ids, ps = world(app_url, [{"username": lead}, {"username": m, "timeZone": "Asia/Manila"}], parties=[P(party, lead, m)],
                    quests=[Q(party, CLUTTER, bossHealth=12)],
                    tasks=[T(m, "daily", "Walk the dog"), T(m, "todo", "Book the dentist"), T(lead, "todo", "Book the dentist", difficulty="hard")])
    qid, pid = ids["quests"][party], ids["parties"][party]
    rollover(app_url, ids["users"][m]["nextCloseAt"])
    answered(ps[m].post(f"/api/tasks/{ids['tasks'][m]['Book the dentist']}/complete"), 200)
    answered(ps[lead].post(f"/api/tasks/{ids['tasks'][lead]['Book the dentist']}/complete"), 200)
    answered(ps[m].post(f"/api/parties/{pid}/leave"), 204)
    mdmg = damage_for(earned_xp("easy", 0))
    ldmg = Decimal("12") - mdmg
    back = q(QUESTS[CLUTTER]["power"], "0.1")
    hist = answered(ps[m].get("/api/history"), 200)["quests"]
    quest = next(x for x in hist if x["id"] == qid)
    assert quest["state"] == "defeated" and {x["username"]: dec(x["damage"]) for x in quest["members"]} == {lead: ldmg, m: mdmg}
    assert [(e["kind"], e["username"]) for e in quest["events"]] == [("strikeback", m), ("strike", m), ("strike", lead)]
    assert answered(ps[m].get(f"/api/quests/{qid}"), 200)["state"] == "defeated"
    assert any(x["id"] == qid for x in answered(ps[lead].get("/api/history"), 200)["quests"])
    ended = instant(quest["endedAt"]).astimezone(ZoneInfo("Asia/Manila")).date().isoformat()
    with screen(browser, ps[m], f"/quests/{qid}") as page:
        see(page, role(page, "heading", CLUTTER), "quest detail heading")
        see(page, page.get_by_text("State: defeated", exact=True), "state line")
        assert lines(role(page, "list", "Member damage")) == [f"{n} {h1(d)}" for n, d in sorted({lead: ldmg, m: mdmg}.items())]
        assert lines(role(page, "list", "Strikes")) == [f"Clutterhound struck back for {h1(back)} ({m} missed 1)",
                                                        f"{m} {MINUS}{h1(mdmg)}", f"{lead} {MINUS}{h1(ldmg)}"]
        page.goto(ps[m].base + "/history")
        item = role(page, "list", "Quest history").get_by_role("listitem").filter(has=role(page, "link", CLUTTER))
        see(page, item, "history entry")
        expect(item.first).to_contain_text(f"Clutterhound, defeated, ended {ended}")


def test_party_privacy(app_url):
    lead, m, o, z = uname("pl"), uname("pm"), uname("po"), uname("pz")
    party, mine = pname("Private"), pname("Outside")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}, {"username": o}, {"username": z}],
                    parties=[P(party, lead, m), P(mine, o)], quests=[Q(party, CLUTTER, bossHealth=1)],
                    tasks=[T(lead, "todo", "Book the dentist")])
    pid, qid = ids["parties"][party], ids["quests"][party]
    answered(upload_banner(ps[lead], pid, "banner.png", png((1, 2, 3))), 201)
    gone = answered(ps[z].post("/api/parties", {"name": pname("Gone")}), 201)["id"]
    answered(ps[z].post(f"/api/parties/{gone}/leave"), 204)
    nf = {"error": "not_found"}
    out = ps[o]
    answered(out.get(f"/api/parties/{gone}"), 404, nf)
    for target in (pid, gone):
        answered(out.get(f"/api/parties/{target}"), 404, nf)
        answered(out.get(f"/api/parties/{target}/chat"), 404, nf)
        answered(out.post(f"/api/parties/{target}/chat", {"text": ""}), 404, nf)
        answered(out.get(f"/api/parties/{target}/banner"), 404, nf)
        answered(upload_banner(out, target, "x.gif", b"GIF89a"), 404, nf)
        answered(out.post(f"/api/parties/{target}/invites", {"username": z}), 404, nf)
        answered(out.post(f"/api/parties/{target}/quests", {"quest": "nope"}), 404, nf)
        answered(out.post(f"/api/parties/{target}/leave"), 404, nf)
    for verb in ("accept", "decline", "begin", "abandon"):
        answered(out.post(f"/api/quests/{qid}/{verb}"), 404, nf)
    answered(out.get(f"/api/quests/{qid}"), 404, nf)
    answered(ps[lead].post(f"/api/tasks/{ids['tasks'][lead]['Book the dentist']}/complete"), 200)
    answered(out.get(f"/api/quests/{qid}"), 404, nf)
    assert all(x["id"] != qid for x in answered(out.get("/api/history"), 200)["quests"])


def test_wf_quest_history_banner_live_banner(browser, app_url):
    lead, m, party = uname("wbl"), uname("wbm"), pname("Flag")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER)])
    pid = ids["parties"][party]
    alt = f"{party} banner"
    with screen(browser, ps[lead]) as lp, screen(browser, ps[m]) as mp:
        ready(lp)
        ready(mp)
        urls = []
        for name, data, ctype in (("banner.png", png((240, 20, 130)), "image/png"), ("banner.jpg", JPEG, "image/jpeg")):
            lp.get_by_label("Banner image").set_input_files(files=[{"name": name, "mimeType": ctype, "buffer": data}])
            click(role(lp, "button", "Upload banner"))
            see(lp, lp.get_by_role("status").filter(has_text="Banner updated."), "banner success status")
            poll(lambda: ensure(bool(answered(ps[m].get(f"/api/parties/{pid}"), 200)["bannerUrl"]), "no bannerUrl"), "bannerUrl set")
            poll(lambda: ensure(answered(ps[m].get(f"/api/parties/{pid}"), 200)["bannerUrl"] not in urls, "unchanged"), "new bannerUrl")
            url = answered(ps[m].get(f"/api/parties/{pid}"), 200)["bannerUrl"]
            urls.append(url)
            live(mp, lambda u=url: ensure((role(mp, "img", alt).first.get_attribute("src", timeout=POLL_MS) or "").endswith(u), "old banner"), "member sees the new banner")
    keys = S3().keys(f"banners/{pid}/")
    assert any(k.endswith(".png") for k in keys) and any(k.endswith(".jpg") for k in keys)


def test_wf_quest_history_banner_defeat_history_notfound(browser, app_url):
    lead, m, o, party, other = uname("hdl"), uname("hdm"), uname("hdo"), pname("Fall"), pname("Theirs")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}, {"username": o}], parties=[P(party, lead, m), P(other, o)],
                    quests=[Q(party, CLUTTER, bossHealth=2), Q(other, MOTH)], tasks=[T(lead, "todo", "Book the dentist")])
    with screen(browser, ps[m]) as page:
        ready(page)
        answered(ps[lead].post(f"/api/tasks/{ids['tasks'][lead]['Book the dentist']}/complete"), 200)
        live(page, lambda: expect(role(page, "region", "Quest")).to_contain_text(f"{lead} landed the last blow.", timeout=POLL_MS), "defeat on the member screen")
        level_up = role(page, "dialog", "Level up")
        see(page, level_up, "Level up from the quest reward")
        click(role(level_up, "button", "Keep going"))
        closed(page, level_up, "Level up closed")
        click(role(page, "link", "Quest history"))
        page.reload()
        see(page, role(role(page, "list", "Quest history"), "link", CLUTTER), "history entry after reload")
        page.goto(ps[m].base + f"/quests/{ids['quests'][other]}")
        see(page, role(page, "heading", "Quest not found"), "not-found heading")
        see(page, page.get_by_text("This quest does not exist or is not yours to see.", exact=True), "not-found body")
    answered(ps[m].get(f"/api/quests/{ids['quests'][other]}"), 404, {"error": "not_found"})


def test_local_accounts(browser, app_url):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, headers={"Origin": origin_of(app_url)})
    umsg = {"errors": {"username": "Use 3 to 20 lowercase letters, digits or _."}}
    for bad in ("ab", "u" * (USERNAME_MAX + 1), "Mira" + uuid.uuid4().hex[:6], "bad name"):
        answered(anon.post("/api/auth/signup", json={"username": bad, "password": PASSWORD}), 422, umsg)
    answered(anon.post("/api/auth/signup", json={"username": uname("pw"), "password": "short12"}), 422,
             {"errors": {"password": "Use at least 8 characters."}})
    u = uname("acc")
    r = anon.post("/api/auth/signup", json={"username": u, "password": PASSWORD})
    me = answered(r, 201)
    assert (me["username"], me["level"], me["experience"], dec(me["health"]), dec(me["maxHealth"]), dec(me["gold"]),
            me["timeZone"], me["dayStartHour"], me["resting"], me["partyId"]) == (u, 1, 0, MAX_HEALTH, MAX_HEALTH, 0, "UTC", 0, False, None)
    cookie = r.headers.get("set-cookie", "").lower()
    assert "deed_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    answered(anon.post("/api/auth/signup", json={"username": u, "password": PASSWORD}), 409, {"error": "username_taken"})
    fresh = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, headers={"Origin": origin_of(app_url)})
    answered(fresh.get("/api/me"), 401, {"error": "unauthenticated"})
    answered(fresh.post("/api/auth/login", json={"username": u, "password": PASSWORD + "x"}), 401, {"error": "invalid_credentials"})
    answered(fresh.post("/api/auth/login", json={"username": uname("ghost"), "password": PASSWORD}), 401, {"error": "invalid_credentials"})
    answered(fresh.post("/api/auth/login", json={"username": u, "password": PASSWORD}), 200)
    assert answered(fresh.get("/api/me"), 200)["username"] == u
    answered(fresh.post("/api/auth/logout", json={}), 204)
    answered(fresh.get("/api/me"), 401, {"error": "unauthenticated"})
    with open_app(browser, app_url + "/signin") as page:
        fill(role(page, "textbox", "Username"), u)
        fill(page.get_by_label("Password", exact=True), PASSWORD + "x")
        click(role(page, "button", "Sign in"))
        see(page, page.get_by_text("Wrong username or password.", exact=True), "sign-in failure copy")
        v = uname("ui")
        fill(role(page, "textbox", "Username"), v)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(role(page, "button", "Create account"))
        eventually(page, lambda: ensure(any(c["name"] == "deed_session" for c in page.context.cookies()), "no cookie"), "session cookie after Create account")
        page.goto(app_url + "/")
        eventually(page, lambda: ensure(urlparse(page.url).path == "/board", page.url), "signed-in visitor goes to /board")


def test_grading_routes(app_url):
    for route, body in (("/api/grading/setup", {"users": []}), ("/api/grading/rollover", {"at": "2026-01-01T00:00:00Z"})):
        answered(grading(app_url, route, body), 404, {"error": "not_found"})
        answered(grading(app_url, route, body, "wrong-token"), 404, {"error": "not_found"})
    a, b, party = uname("ga"), uname("gb"), pname("Grade")
    ids = setup(app_url, {"users": [{"username": a, "password": PASSWORD, "timeZone": "Asia/Manila", "dayStartHour": 4, "level": 3,
                                     "experience": 20, "health": 42.5, "gold": 18.4, "currentDate": GRADED_DATE},
                                    {"username": b, "password": PASSWORD, "resting": True}],
                          "parties": [P(party, a, b)], "quests": [Q(party, DROWSE, state="invited")],
                          "tasks": [T(a, "daily", "Read one chapter", difficulty="medium", value=6, streak=12)]})
    pa = Player(app_url, a)
    me = pa.me()
    assert (me["timeZone"], me["dayStartHour"], me["level"], me["experience"], dec(me["health"]), dec(me["gold"]), me["today"]) == \
        ("Asia/Manila", 4, 3, 20, Decimal("42.5"), Decimal("18.4"), GRADED_DATE)
    assert ids["users"][a]["today"] == GRADED_DATE and Player(app_url, b).me()["resting"] is True
    assert [(e["kind"], dec(e["amount"])) for e in pa.ledger()] == [("task", Decimal("18.4"))]
    pty = answered(pa.get(f"/api/parties/{ids['parties'][party]}"), 200)
    assert pty["leader"] == a and {x["username"] for x in pty["members"]} == {a, b}
    qst = pa.quest(ids["quests"][party])
    assert qst["state"] == "invited" and qst["acceptedBy"] == [a] and dec(qst["bossHealth"]) == QUESTS[DROWSE]["max"]
    t = pa.task(ids["tasks"][a]["Read one chapter"])
    assert (t["value"], t["streak"], t["difficulty"]) == (6, 12, "medium")
    c, d = uname("gc"), uname("gd")
    r = grading(app_url, "/api/grading/setup", {"users": [{"username": c, "password": PASSWORD},
                                                          {"username": d, "password": PASSWORD, "timeZone": "Mars/Olympus"}],
                                                "parties": [], "quests": [], "tasks": []}, TOKEN)
    assert answered(r, 422)["errors"] == {"users[1].timeZone": "Unknown time zone."}
    answered(httpx.post(app_url + "/api/auth/login", json={"username": c, "password": PASSWORD}, headers={"Origin": origin_of(app_url)},
                        timeout=HTTP_TIMEOUT_S), 401, {"error": "invalid_credentials"})
    e = uname("ge")
    answered(grading(app_url, "/api/grading/setup", {"users": [{"username": e, "password": PASSWORD}, {"username": a, "password": PASSWORD}],
                                                     "parties": [], "quests": [], "tasks": []}, TOKEN), 409, {"error": "username_taken"})
    answered(httpx.post(app_url + "/api/auth/login", json={"username": e, "password": PASSWORD}, headers={"Origin": origin_of(app_url)},
                        timeout=HTTP_TIMEOUT_S), 401, {"error": "invalid_credentials"})


def test_error_order(app_url):
    lead, m, party = uname("el"), uname("em"), pname("Order")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER)],
                    tasks=[T(lead, "habit", "Drink a glass of water")])
    pl, pm = ps[lead], ps[m]
    tid = ids["tasks"][lead]["Drink a glass of water"]
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, headers={"Origin": origin_of(app_url)})
    answered(anon.patch(f"/api/tasks/{tid}", json={"title": ""}), 401, {"error": "unauthenticated"})
    answered(pm.patch(f"/api/tasks/{tid}", {"title": ""}), 404, {"error": "not_found"})
    answered(pm.post(f"/api/quests/{ids['quests'][party]}/begin"), 403, {"error": "leader_only"})
    old = pl.task(tid)["updatedAt"]
    answered(pl.patch(f"/api/tasks/{tid}", {"updatedAt": old, "title": "Drink two glasses of water"}), 200)
    answered(pl.patch(f"/api/tasks/{tid}", {"updatedAt": old, "title": ""}), 409, {"error": "stale_task"})
    answered(pl.http.post(f"/api/parties/{ids['parties'][party]}/chat", content=b"text", headers={"Content-Type": "text/plain"}), 415,
             {"error": "unsupported_media_type"})
    answered(pl.post("/api/tasks", {"type": "habit", "title": "", "difficulty": "easy"}), 422,
             {"errors": {"title": "Title must be 1 to 80 characters."}})


def test_health_and_manifest(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    answered(r, 200, {"status": "ok"})
    assert r.headers["content-type"].startswith("application/json")
    answered(httpx.get(outage_url("APP_STORAGE_DOWN_URL") + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})
    manifest_path = DEPLOYED_APP / "run.json" if (DEPLOYED_APP / "run.json").exists() else APP / "run.json"
    serve = json.loads(manifest_path.read_text())["serve"]
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    env = {**os.environ, "DATABASE_URL": "postgres://deedfall:deedfall@127.0.0.1:9/deedfall", "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+b", delete=False, suffix=".log")
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def booted() -> httpx.Response:
        if proc.poll() is not None:
            pytest.fail(f"database-down copy exited: {Path(log.name).read_bytes()[-2000:]!r}")
        try:
            resp = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        except httpx.HTTPError as exc:
            raise AssertionError(str(exc)) from exc
        return resp

    try:
        health = poll(booted, "database-down copy answers /api/health", BOOT_DEADLINE_S)
        answered(health, 503, {"status": "starting"})
        answered(httpx.get(base + "/api/me", timeout=HTTP_TIMEOUT_S), 503, {"error": "database_unavailable"})
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(HTTP_TIMEOUT_S)
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)


def test_server_boundary(app_url):
    u = uname("bnd")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    answered(httpx.post(app_url + "/api/auth/login", json={"username": u, "password": PASSWORD}, headers={"Origin": EVIL_ORIGIN},
                        timeout=HTTP_TIMEOUT_S), 403, {"error": "cross_origin"})
    answered(p.http.post("/api/tasks", json={"type": "habit", "title": "Take the stairs", "difficulty": "easy"},
                         headers={"Origin": EVIL_ORIGIN}), 403, {"error": "cross_origin"})
    head = json.dumps({"type": "habit", "title": "Take the stairs", "difficulty": "easy"}).encode()
    for size, status in ((JSON_LIMIT, 201), (JSON_LIMIT + 1, 413)):
        r = p.http.post("/api/tasks", content=head + b" " * (size - len(head)), headers={"Content-Type": "application/json"})
        answered(r, status, None if status == 201 else {"error": "body_too_large"})
    answered(p.http.post("/api/tasks", content=head, headers={"Content-Type": "text/plain"}), 415, {"error": "unsupported_media_type"})
    assert len(p.tasks()["habits"]) == 1
    for path in ("/package.json", "/run.json", "/.env", "/src/"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "GRADING_TOKEN")]
    secrets.append(urlparse(os.environ.get("DATABASE_URL", "")).password or "")
    secrets = [s for s in secrets if len(s) >= 6]
    seen: set[str] = set()
    queue = ["/", "/signin", "/board"]
    for _ in range(200):
        if not queue:
            break
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        r = p.http.get(path)
        for s in secrets:
            assert s not in r.text, f"a credential value appears in {path}"
        for ref in re.findall(r'["\'(](/[^"\'()\s]+\.(?:js|css|map))', r.text):
            queue.append(ref)
        for ref in re.findall(r'(?:src|href)="(/[^"#]*)"', r.text):
            queue.append(ref)


SEAM_CASES = ["motion", "reduced_motion"]


@pytest.mark.parametrize("mode", SEAM_CASES, ids=SEAM_CASES)
def test_health_seam(browser, app_url, mode):
    u, party = uname("sem"), pname("Seam")
    start = Decimal("30.0")
    ids, ps = world(app_url, [{"username": u}], parties=[P(party, u)], quests=[Q(party, CLUTTER, bossHealth=float(start))],
                    tasks=[T(u, "todo", "Book the dentist", difficulty="hard"), T(u, "todo", "Return library books", difficulty="hard", value=-10)])
    mx = QUESTS[CLUTTER]["max"]
    first = damage_for(earned_xp("hard", 0))
    reduce = mode == "reduced_motion"
    with screen(browser, ps[u], reduced_motion="reduce" if reduce else "no-preference") as page:
        ready(page)
        eventually(page, lambda: seam_at(page, start / mx), "seam at rest")
        click(role(page, "checkbox", "Complete Book the dentist"))
        left = start - first
        line = f"{u} {MINUS}{h1(first)}"
        if reduce:
            eventually(page, lambda: ensure(line in lines(role(page, "list", "Strikes")), "line"), "attribution line")
            seam_at(page, left / mx)
            meter_reads(role(page, "meter", "Boss health"), f"{h1(left)} / {h1(mx)}")
        else:
            eventually(page, lambda: seam_at(page, left / mx), "seam after the strike")
            eventually(page, lambda: meter_reads(role(page, "meter", "Boss health"), f"{h1(left)} / {h1(mx)}"), "boss numerals settle")
            eventually(page, lambda: ensure(line in lines(role(page, "list", "Strikes")), "line"), "attribution line")
        page.reload()
        eventually(page, lambda: seam_at(page, left / mx), "seam after reload")
        click(role(page, "checkbox", "Complete Return library books"))
        region = role(page, "region", "Quest")
        eventually(page, lambda: expect(region).to_contain_text(f"{u} landed the last blow.", timeout=POLL_MS), "defeat field")
        expect(region).to_contain_text("DOWN")
        page.reload()
        eventually(page, lambda: expect(region).to_contain_text(f"{u} landed the last blow.", timeout=POLL_MS), "defeat field after reload")


def test_landing_demo_quest(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        see(page, role(page, "heading", "Every chore lands a blow."), "landing headline")
        link = role(page, "link", "Start your first day")
        assert urlparse(link.get_attribute("href") or "").path == "/signin"
        demo = role(page, "region", "Demo quest")
        meter = role(demo, "meter", "Demo boss health")
        eventually(page, lambda: meter_reads(meter, "30.0 / 30.0"), "demo boss at full health")
        record_feed(page)
        calls: list[str] = []
        page.on("request", lambda req: calls.append(req.url) if "/api/" in req.url else None)
        for title, after in (("Water the plants", "20.0"), ("Stretch for ten minutes", "10.0"), ("Read one chapter", "0.0")):
            box = role(demo, "checkbox", f"Complete {title}")
            click(box)
            eventually(page, lambda a=after: meter_reads(meter, f"{a} / 30.0"), f"demo meter after {title}")
            expect(box).to_be_checked()
            expect(box).to_be_disabled()
        assert feed_log(page).count("Boss took 10.0 damage") >= 1
        eventually(page, lambda: expect(demo).to_contain_text("You landed the last blow.", timeout=POLL_MS), "demo defeat field")
        expect(demo).to_contain_text("DOWN")
        assert calls == [], f"the demo sent requests: {calls}"
        page.reload()
        eventually(page, lambda: meter_reads(role(role(page, "region", "Demo quest"), "meter", "Demo boss health"), "30.0 / 30.0"), "demo resets")
        expect(role(page, "checkbox", "Complete Water the plants")).not_to_be_checked()


def test_wf_keyboard_lists_edit_by_enter(browser, app_url):
    u = uname("ede")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Drink a glass of water")])
    p = ps[u]
    with screen(browser, p) as laptop, screen(browser, p) as phone:
        ready(laptop)
        ready(phone)
        row = habit_row(laptop, "Drink a glass of water", 0)
        see(laptop, row, "habit row")
        row.focus()
        laptop.keyboard.press("Enter")
        dialog = role(laptop, "dialog", "Edit task")
        see(laptop, dialog, 'Enter opens "Edit task"')
        fill(slid_in(role(dialog, "textbox", "Title")), RENAMED)
        role(dialog, "button", "Save task").focus()
        laptop.keyboard.press("Enter")
        closed(laptop, dialog, "the sheet closes after saving")
        renamed = habit_row(laptop, RENAMED, 0)
        see(laptop, renamed, "renamed row")
        live(phone, lambda: shows(habit_row(phone, RENAMED, 0)), "renamed row on the other device")
        renamed.focus()
        laptop.keyboard.press("Enter")
        see(laptop, dialog, '"Edit task" again')
        laptop.keyboard.press("Escape")
        closed(laptop, dialog, "Escape closes the sheet")
        focused(laptop, renamed, "focus returns to the row after Escape")
    assert p.task(ids["tasks"][u]["Drink a glass of water"])["title"] == RENAMED


def test_wf_habit_scoring_phone_tap(browser, app_url):
    u = uname("hph")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Drink a glass of water", value=4)])
    p = ps[u]
    xp = earned_xp("easy", 4)
    loss = health_loss("easy", 5)
    with screen(browser, p, viewport=PHONE) as page:
        ready(page)
        row = habit_row(page, "Drink a glass of water", 4)
        see(page, row, "habit row at 4")
        expect(row).to_contain_text(band(4)[0])
        tap(role(row, "button", "Score Drink a glass of water up"))
        up = habit_row(page, "Drink a glass of water", 5)
        see(page, up, "row score 5 after the tap")
        expect(up).to_contain_text(band(5)[0])
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(gold_for(xp))} gold"), "gold after the tap")
        tap(role(up, "button", "Score Drink a glass of water down"))
        down = habit_row(page, "Drink a glass of water", 4)
        see(page, down, "row score 4 after the down tap")
        expect(down).to_contain_text(band(4)[0])
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - loss)} / 50.0"), "health after the down tap")
    me = p.me()
    assert dec(me["gold"]) == gold_for(xp) and dec(me["health"]) == MAX_HEALTH - loss
    assert p.task(ids["tasks"][u]["Drink a glass of water"])["value"] == 4


def test_wf_habit_scoring_band_walk_keyboard(browser, app_url):
    u = uname("hbw")
    ids, ps = world(app_url, [{"username": u, "level": 2}], tasks=[T(u, "habit", "Doomscroll after midnight", difficulty="medium", value=-9)])
    p = ps[u]
    loss = health_loss("medium", -9)
    xp = earned_xp("medium", -10)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = habit_row(page, "Doomscroll after midnight", -9)
        see(page, row, "habit row at -9")
        expect(row).to_contain_text(band(-9)[0])
        row.focus()
        page.keyboard.press("-")
        heard(page, f"Doomscroll after midnight scored down: you lost {h1(loss)} health")
        low = habit_row(page, "Doomscroll after midnight", -10)
        see(page, low, "row score -10")
        expect(low).to_contain_text(band(-10)[0])
        low.focus()
        page.keyboard.press("+")
        heard(page, f"Doomscroll after midnight scored: +{xp} experience, +{g2(gold_for(xp))} gold")
        back = habit_row(page, "Doomscroll after midnight", -9)
        see(page, back, "row score -9 again")
        expect(back).to_contain_text(band(-9)[0])
        eventually(page, lambda: ensure(value_now(role(page, "meter", "Experience")) == xp, "experience meter"), "experience meter")
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - loss)} / 50.0"), "health meter")
    me = p.me()
    assert (me["level"], me["experience"], dec(me["gold"])) == (2, xp, gold_for(xp))


def test_wf_habit_scoring_second_device(browser, app_url):
    u = uname("hsd")
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", "Take the stairs", difficulty="easy", value=-1)])
    p = ps[u]
    xp = earned_xp("easy", -1)
    loss = health_loss("easy", 0)
    with screen(browser, p) as laptop, screen(browser, p, viewport=PHONE) as phone:
        ready(laptop)
        ready(phone)
        row = habit_row(laptop, "Take the stairs", -1)
        see(laptop, row, "habit row on the laptop")
        row.focus()
        laptop.keyboard.press("+")
        live(phone, lambda: expect(habit_row(phone, "Take the stairs", 0)).to_contain_text(band(0)[0], timeout=POLL_MS), "score and chip on the phone")
        live(phone, lambda: text_is(role(phone, "status", "Gold"), f"{g2(gold_for(xp))} gold"), "gold on the phone")
        moved = habit_row(laptop, "Take the stairs", 0)
        see(laptop, moved, "row at 0 on the laptop")
        moved.focus()
        laptop.keyboard.press("-")
        live(phone, lambda: shows(habit_row(phone, "Take the stairs", -1)), "score back to -1 on the phone")
        live(phone, lambda: meter_reads(role(phone, "meter", "Health"), f"{h1(MAX_HEALTH - loss)} / 50.0"), "health on the phone")


def test_wf_undo_window_space_undo(browser, app_url):
    u = uname("usp")
    _, ps = world(app_url, [{"username": u, "gold": 4}], tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    xp = earned_xp("easy", 0)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = daily_row(page, "Walk the dog", True, 0, False)
        see(page, row, "daily row")
        row.focus()
        page.keyboard.press("Space")
        heard(page, f"Walk the dog complete: +{xp} experience, +{g2(gold_for(xp))} gold")
        done = daily_row(page, "Walk the dog", True, 0, True)
        see(page, done, "row reads done")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(Decimal(4) + gold_for(xp))} gold"), "gold after the tick")
        done.focus()
        page.keyboard.press("Space")
        heard(page, "Walk the dog undone")
        see(page, daily_row(page, "Walk the dog", True, 0, False), "row reads not done")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(4)} gold"), "gold restored")
        eventually(page, lambda: ensure(value_now(role(page, "meter", "Experience")) == 0, "experience meter"), "experience restored")
    me = p.me()
    assert (me["experience"], dec(me["gold"])) == (0, Decimal("4"))
    assert p.tasks()["dailies"][0]["value"] == 0


def test_wf_undo_window_level_up_reverted(browser, app_url):
    a, m, party = uname("ulr"), uname("ulm"), pname("Relapse")
    gain = earned_xp("easy", 0)
    ids, ps = world(app_url, [{"username": a, "experience": LEVEL_STEP - gain, "health": 30}, {"username": m}],
                    parties=[P(party, a, m)], quests=[Q(party, CLUTTER)], tasks=[T(a, "todo", "Book the dentist")])
    pa = ps[a]
    mx, dmg = QUESTS[CLUTTER]["max"], damage_for(gain)
    with screen(browser, pa) as own, screen(browser, ps[m]) as mate:
        ready(own)
        ready(mate)
        record_feed(own)
        row = todo_row(own, "Book the dentist", False)
        see(own, row, "to-do row")
        row.focus()
        own.keyboard.press("Space")
        dialog = role(own, "dialog", "Level up")
        see(own, dialog, "Level up dialog")
        live(mate, lambda: meter_reads(role(mate, "meter", f"{a} health"), "50.0 / 50.0"), "teammate sees the refilled health")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "teammate sees the strike")
        own.keyboard.press("Escape")
        closed(own, dialog, "Escape closes Level up")
        done = todo_row(own, "Book the dentist", True)
        focused(own, done, "focus returns to the row whose action levelled up")
        own.keyboard.press("Space")
        heard(own, "Book the dentist undone")
        see(own, own.get_by_text("Level 1", exact=True), "level text back to 1")
        eventually(own, lambda: meter_reads(role(own, "meter", "Health"), "30.0 / 50.0"), "health back to 30.0")
        live(mate, lambda: meter_reads(role(mate, "meter", f"{a} health"), "30.0 / 50.0"), "teammate sees health back")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx)} / {h1(mx)}"), "teammate sees the boss back")
    me = pa.me()
    assert (me["level"], me["experience"], dec(me["health"])) == (1, LEVEL_STEP - gain, Decimal("30"))


def test_wf_undo_window_after_window(browser):
    base = outage_url("APP_SHORT_URL")
    a, m, party = uname("uaw"), uname("uam"), pname("Late")
    ids, ps = world(base, [{"username": a, "gold": 4}, {"username": m}], parties=[P(party, a, m)], quests=[Q(party, CLUTTER)],
                    tasks=[T(a, "daily", "Walk the dog")])
    pa = ps[a]
    gain = earned_xp("easy", 0)
    mx, dmg = QUESTS[CLUTTER]["max"], damage_for(gain)
    with screen(browser, pa) as own, screen(browser, ps[m]) as mate:
        ready(own)
        ready(mate)
        row = daily_row(own, "Walk the dog", True, 0, False)
        see(own, row, "daily row")
        row.focus()
        own.keyboard.press("Space")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "teammate boss meter after the tick")
        gold = f"{g2(Decimal(4) + gold_for(gain))} gold"
        eventually(own, lambda: text_is(role(own, "status", "Gold"), gold), "gold after the tick")
        wait_out(SHORT_UNDO_S + WAIT_MARGIN_S, pa)
        done = daily_row(own, "Walk the dog", True, 0, True)
        see(own, done, "row reads done")
        done.focus()
        own.keyboard.press("Space")
        see(own, daily_row(own, "Walk the dog", True, 0, False), "row reads not done")
        quiet(own, lambda: text_is(role(own, "status", "Gold"), gold), "gold stays after a late untick")
        quiet(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "boss stays after a late untick")
    assert dec(pa.me()["gold"]) == Decimal(4) + gold_for(gain)
    assert pa.tasks()["dailies"][0]["value"] == 1


def test_wf_undo_window_phone_swipe_untick(browser, app_url):
    u = uname("ups")
    _, ps = world(app_url, [{"username": u, "gold": 2}], tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    gain = earned_xp("easy", 0)
    with screen(browser, p, viewport=PHONE) as page:
        cdp = touch(page)
        ready(page)
        tap(role(page, "tab", "Dailies"))
        row = daily_row(page, "Walk the dog", True, 0, False)
        see(page, row, "daily row")
        record_feed(page)
        swipe(page, cdp, row, SWIPE_PX + 20)
        heard(page, f"Walk the dog complete: +{gain} experience, +{g2(gold_for(gain))} gold")
        done = daily_row(page, "Walk the dog", True, 0, True)
        see(page, done, "row reads done")
        tap(role(done, "checkbox", "Complete Walk the dog"))
        heard(page, "Walk the dog undone")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(2)} gold"), "gold restored")
        see(page, daily_row(page, "Walk the dog", True, 0, False), "row reads not done")
    assert dec(p.me()["gold"]) == Decimal("2")


def test_wf_rewards_gold_exact_balance_keyboard(browser, app_url):
    u = uname("bex")
    price = Decimal("5.00")
    _, ps = world(app_url, [{"username": u, "gold": float(price)}], tasks=[T(u, "reward", "Fancy coffee", price=float(price))])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = reward_row(page, "Fancy coffee", price)
        see(page, row, "reward row")
        buy = role(row, "button", "Buy Fancy coffee")
        buy.focus()
        page.keyboard.press("Space")
        heard(page, f"Fancy coffee bought for {g2(price)} gold")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), "0.00 gold"), "gold at zero")
        buy.focus()
        page.keyboard.press("Space")
        see(page, page.get_by_role("alert").filter(has_text="Not enough gold."), "refusal copy")
        text_is(role(page, "status", "Gold"), "0.00 gold")
        assert holds_focus(row), "focus left the reward row"
    assert [dec(e["amount"]) for e in p.ledger() if e["kind"] == "reward"] == [-price]


def test_wf_rewards_gold_earn_then_afford(browser, app_url):
    u = uname("bea")
    start, price = Decimal("1.00"), Decimal("2.00")
    _, ps = world(app_url, [{"username": u, "gold": float(start)}],
                  tasks=[T(u, "todo", "Book the dentist", difficulty="hard"), T(u, "reward", "Fancy coffee", price=float(price))])
    p = ps[u]
    xp = earned_xp("hard", 0)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        reward = reward_row(page, "Fancy coffee", price)
        see(page, reward, "reward row")
        role(reward, "button", "Buy Fancy coffee").focus()
        page.keyboard.press("Space")
        see(page, page.get_by_role("alert").filter(has_text="Not enough gold."), "refusal copy")
        todo = todo_row(page, "Book the dentist", False)
        todo.focus()
        page.keyboard.press("Space")
        heard(page, f"Book the dentist complete: +{xp} experience, +{g2(gold_for(xp))} gold")
        earned = start + gold_for(xp)
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(earned)} gold"), "gold after the to-do")
        todo_row(page, "Book the dentist", True).focus()
        page.keyboard.press("ArrowRight")
        focused(page, reward, "ArrowRight from To-dos reaches the reward row")
        role(reward, "button", "Buy Fancy coffee").focus()
        page.keyboard.press("Space")
        heard(page, f"Fancy coffee bought for {g2(price)} gold")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(earned - price)} gold"), "gold after buying")
    assert dec(p.me()["gold"]) == earned - price


def test_wf_rewards_gold_phone_second_device(browser, app_url):
    u = uname("bph")
    gold, price = Decimal("20.00"), Decimal("6.50")
    _, ps = world(app_url, [{"username": u, "gold": float(gold)}], tasks=[T(u, "reward", "Bubble tea", price=float(price))])
    p = ps[u]
    with screen(browser, p, viewport=PHONE) as phone, screen(browser, p) as laptop:
        ready(phone)
        ready(laptop)
        tap(role(phone, "tab", "Rewards"))
        see(phone, reward_row(phone, "Bubble tea", price), "reward row on the phone")
        tap(role(phone, "button", "Buy Bubble tea"))
        eventually(phone, lambda: text_is(role(phone, "status", "Gold"), f"{g2(gold - price)} gold"), "gold on the phone")
        live(laptop, lambda: text_is(role(laptop, "status", "Gold"), f"{g2(gold - price)} gold"), "gold on the laptop")
    assert dec(p.me()["gold"]) == gold - price


def test_wf_rollover_custom_hour_settings_keyboard(browser, app_url):
    u = uname("skb")
    zone, day = "America/Toronto", date.fromisoformat(GRADED_DATE)
    _, ps = world(app_url, [{"username": u, "dayStartHour": 5, "currentDate": GRADED_DATE}])
    p = ps[u]
    want = close_instant(zone, day, 6)
    with screen(browser, p, "/settings") as page:
        hour = role(page, "spinbutton", "Day start hour")
        see(page, hour, "day start field")
        select(role(page, "combobox", "Time zone"), zone)
        hour.focus()
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: ensure(chosen(hour) == "6", f"hour reads {chosen(hour)!r}"), "ArrowUp raises the hour to 6")
        role(page, "button", "Save settings").focus()
        page.keyboard.press("Enter")
        see(page, page.get_by_text("Settings saved.", exact=True), "settings success status")
        see(page, page.get_by_text(f"Next day start: {day_start_text(want, zone)}", exact=True), "next day start text")
    me = p.me()
    assert (me["timeZone"], me["dayStartHour"]) == (zone, 6) and instant(me["nextCloseAt"]) == want


def test_wf_rollover_custom_hour_live_close(browser, app_url):
    u = uname("lcl")
    ids, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", "Walk the dog", streak=3),
                                                       T(u, "daily", "Read one chapter", difficulty="medium", streak=12, done=True)])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        see(page, daily_row(page, "Walk the dog", True, 3, False), "missed daily before the close")
        see(page, daily_row(page, "Read one chapter", True, 12, True), "done daily before the close")
        rollover(app_url, ids["users"][u]["nextCloseAt"])
        live(page, lambda: shows(daily_row(page, "Walk the dog", True, 0, False)), "reset streak in place")
        live(page, lambda: shows(daily_row(page, "Read one chapter", True, 13, False)), "extended streak in place")
        live(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - health_loss('easy', 0))} / 50.0"), "health in place")


def test_wf_rest_mode_switch_keyboard(browser, app_url):
    u = uname("rkb")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    with screen(browser, p, "/settings") as page:
        sw = role(page, "switch", "Rest mode")
        see(page, sw, "rest switch")
        sw.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: shows(rest_banner(page)), "rest banner", REST_BANNER_S + POLL_SLACK_S)
        expect(sw).to_be_checked()
        poll(lambda: ensure(p.me()["resting"] is True, "not resting"), "rest mode on saved")
        sw.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: ensure(rest_banner(page).count() == 0 or not rest_banner(page).first.is_visible(), "banner still shown"),
                   "banner off", REST_BANNER_S + POLL_SLACK_S)
        expect(sw).not_to_be_checked()
    poll(lambda: ensure(p.me()["resting"] is False, "still resting"), "rest mode off saved")


def test_wf_rest_mode_banner_other_device(browser, app_url):
    u = uname("rod")
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    with screen(browser, p, "/settings") as settings, screen(browser, p) as board:
        ready(board)
        sw = role(settings, "switch", "Rest mode")
        see(settings, sw, "rest switch")
        sw.focus()
        settings.keyboard.press("Space")
        live(board, lambda: shows(rest_banner(board)), "rest banner on the other device")
        sw.focus()
        settings.keyboard.press("Space")
        live(board, lambda: ensure(rest_banner(board).count() == 0 or not rest_banner(board).first.is_visible(), "banner still shown"),
             "rest banner gone on the other device")


def test_wf_rest_mode_strikes_still_count(browser, app_url):
    r, t, party = uname("rsc"), uname("rsm"), pname("Doze")
    ids, ps = world(app_url, [{"username": r, "resting": True}, {"username": t}], parties=[P(party, t, r)], quests=[Q(party, DROWSE)],
                    tasks=[T(r, "todo", "Book the dentist")])
    mx, dmg = QUESTS[DROWSE]["max"], damage_for(earned_xp("easy", 0))
    with screen(browser, ps[r]) as own, screen(browser, ps[t]) as mate:
        ready(own)
        ready(mate)
        see(own, rest_banner(own), "rest banner on the resting board")
        record_feed(mate)
        row = todo_row(own, "Book the dentist", False)
        see(own, row, "to-do row")
        row.focus()
        own.keyboard.press("Space")
        heard(mate, f"{r} hit the boss for {h1(dmg)} damage")
        live(mate, lambda: meter_reads(role(mate, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "boss meter on the teammate's screen")
    assert dec(ps[t].quest(ids["quests"][party])["bossHealth"]) == mx - dmg


def test_wf_rest_mode_streaks_kept_rows(browser, app_url):
    u = uname("rsk")
    ids, ps = world(app_url, [{"username": u, "resting": True}], tasks=[T(u, "daily", "Walk the dog", streak=3),
                                                                        T(u, "daily", "Read one chapter", streak=5, done=True)])
    p = ps[u]
    with screen(browser, p) as page:
        ready(page)
        see(page, rest_banner(page), "rest banner")
        see(page, daily_row(page, "Walk the dog", True, 3, False), "missed daily before the close")
        rollover(app_url, ids["users"][u]["nextCloseAt"])
        live(page, lambda: shows(daily_row(page, "Read one chapter", True, 6, False)), "done daily gains a streak")
        see(page, daily_row(page, "Walk the dog", True, 3, False), "missed daily keeps its streak")
        meter_reads(role(page, "meter", "Health"), "50.0 / 50.0")
    assert dec(p.me()["health"]) == MAX_HEALTH


def test_wf_level_and_faint_reduced_motion_keyboard(browser, app_url):
    u = uname("lrm")
    _, ps = world(app_url, [{"username": u, "experience": LEVEL_STEP - earned_xp("easy", 0), "health": 20}],
                  tasks=[T(u, "daily", "Walk the dog")])
    p = ps[u]
    with screen(browser, p, reduced_motion="reduce") as page:
        ready(page)
        row = daily_row(page, "Walk the dog", True, 0, False)
        see(page, row, "daily row")
        row.focus()
        page.keyboard.press("Space")
        dialog = role(page, "dialog", "Level up")
        see(page, dialog, "Level up dialog")
        expect(dialog).to_contain_text("You reached level 2. Your health is full again.")
        badge = role(dialog, "img", "Level 2 badge")
        expect(badge).to_be_visible(timeout=SETTLE_S * 1000)
        box = badge.bounding_box()
        assert box["width"] >= BADGE_MIN_PX and box["height"] >= BADGE_MIN_PX, box
        assert animations(badge) == [], "badge animates under reduced motion"
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes Level up")
        focused(page, daily_row(page, "Walk the dog", True, 0, True), "focus returns to the daily row")
        see(page, page.get_by_text("Level 2", exact=True), "level text")
        meter_reads(role(page, "meter", "Health"), "50.0 / 50.0")


def test_wf_level_and_faint_faint_by_keyboard(browser, app_url):
    u = uname("fkb")
    gold = Decimal("10.05")
    _, ps = world(app_url, [{"username": u, "level": 3, "health": 2, "gold": float(gold)}],
                  tasks=[T(u, "habit", "Doomscroll after midnight", difficulty="hard", value=-10)])
    p = ps[u]
    lost = (gold * FAINT_SHARE).quantize(Decimal("0.01"), ROUND_FLOOR)
    with screen(browser, p) as page:
        ready(page)
        record_feed(page)
        row = habit_row(page, "Doomscroll after midnight", -10)
        see(page, row, "habit row")
        row.focus()
        page.keyboard.press("-")
        heard(page, f"Doomscroll after midnight scored down: you lost {h1(health_loss('hard', -10))} health")
        dialog = role(page, "dialog", "You fainted")
        see(page, dialog, "faint dialog")
        expect(dialog).to_contain_text(f"You dropped to level 2 and lost {g2(lost)} gold. Your health is back to 50.0.")
        role(dialog, "button", "Get back up").focus()
        page.keyboard.press("Enter")
        closed(page, dialog, "Get back up closes the dialog")
        focused(page, habit_row(page, "Doomscroll after midnight", -11), "focus returns to the habit row")
        see(page, page.get_by_text("Level 2", exact=True), "level text")
        eventually(page, lambda: text_is(role(page, "status", "Gold"), f"{g2(gold - lost)} gold"), "gold after the faint")
        meter_reads(role(page, "meter", "Health"), "50.0 / 50.0")


def test_wf_level_and_faint_live_on_other_device(browser, app_url):
    u = uname("lod")
    _, ps = world(app_url, [{"username": u, "experience": LEVEL_STEP - earned_xp("easy", 0)}],
                  tasks=[T(u, "habit", "Drink a glass of water"), T(u, "habit", "Take the stairs")])
    p = ps[u]
    with screen(browser, p) as laptop, screen(browser, p) as phone:
        ready(laptop)
        ready(phone)
        row = habit_row(laptop, "Drink a glass of water", 0)
        see(laptop, row, "habit row")
        row.focus()
        laptop.keyboard.press("+")
        dialog = role(phone, "dialog", "Level up")
        live(phone, lambda: shows(dialog), "Level up opens on the other device")
        expect(dialog).to_contain_text("You reached level 2. Your health is full again.")
        phone.keyboard.press("Escape")
        closed(phone, dialog, "Escape closes Level up on the phone")
        focused(phone, habit_row(phone, "Drink a glass of water", 1), "focus goes to the first Habits row")


def test_wf_party_quest_live_decline_keyboard(browser, app_url):
    lead, m, party = uname("dkl"), uname("dkm"), pname("Nope")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead)])
    with screen(browser, ps[lead]) as lp, screen(browser, ps[m]) as mp:
        ready(lp)
        ready(mp)
        see(mp, mp.get_by_text("You are not in a party yet.", exact=True), "no-party sentence")
        fill(role(lp, "textbox", "Invite by username"), m)
        role(lp, "button", "Invite").focus()
        lp.keyboard.press("Enter")
        live(mp, lambda: shows(mp.get_by_text(f"{lead} invited you to {party}.", exact=True)), "invite on the invitee's screen")
        role(mp, "button", "Decline invite").focus()
        mp.keyboard.press("Enter")
        eventually(mp, lambda: ensure(mp.get_by_text(f"{lead} invited you to {party}.", exact=True).count() == 0, "invite still shown"),
                   "invite gone after declining")
        see(mp, mp.get_by_text("You are not in a party yet.", exact=True), "still outside a party")
    assert answered(ps[m].get("/api/invites"), 200)["invites"] == []
    assert [x["username"] for x in answered(ps[lead].get(f"/api/parties/{ids['parties'][party]}"), 200)["members"]] == [lead]


def test_wf_party_quest_live_quest_accept_keyboard(browser, app_url):
    lead, m, party = uname("qkl"), uname("qkm"), pname("Hush")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER, state="invited")])
    mx = QUESTS[CLUTTER]["max"]
    with screen(browser, ps[lead]) as lp, screen(browser, ps[m]) as mp:
        ready(lp)
        ready(mp)
        see(mp, mp.get_by_text(f"{CLUTTER}: 1 of 2 accepted", exact=True), "quest invite count on the member's screen")
        role(mp, "button", "Accept quest").focus()
        mp.keyboard.press("Enter")
        live(lp, lambda: shows(lp.get_by_text(f"{CLUTTER}: 2 of 2 accepted", exact=True)), "count on the leader's screen")
        begin = role(lp, "button", "Begin quest")
        live(lp, lambda: expect(begin).to_be_enabled(timeout=POLL_MS), "Begin quest enabled")
        begin.focus()
        lp.keyboard.press("Enter")
        live(mp, lambda: meter_reads(role(mp, "meter", "Boss health"), f"{h1(mx)} / {h1(mx)}"), "quest start on the member's screen")
        eventually(mp, lambda: seam_at(mp, Decimal(1)), "seam at full health")
    assert ps[lead].quest(ids["quests"][party])["state"] == "active"


def test_wf_party_quest_live_phone_accept(browser, app_url):
    lead, m, party = uname("qpl"), uname("qpm"), pname("Pocket")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, MOTH, state="invited")])
    with screen(browser, ps[lead]) as lp, screen(browser, ps[m], viewport=PHONE) as mp:
        ready(lp)
        ready(mp)
        tap(role(mp, "button", "Party"))
        dialog = role(mp, "dialog", "Party")
        see(mp, dialog, "Party dialog")
        tap(slid_in(role(dialog, "button", "Accept quest")))
        live(lp, lambda: shows(lp.get_by_text(f"{MOTH}: 2 of 2 accepted", exact=True)), "acceptance on the leader's screen")
    assert m in ps[lead].quest(ids["quests"][party])["acceptedBy"]


def test_wf_simultaneous_strikes_keyboard_feed(browser, app_url):
    a, b, party = uname("ska"), uname("skb"), pname("Duet")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, MOTH)],
                    tasks=[T(a, "todo", "Book the dentist", difficulty="hard"), T(b, "todo", "Return library books", difficulty="medium")])
    qid, mx = ids["quests"][party], QUESTS[MOTH]["max"]
    da, db = damage_for(earned_xp("hard", 0)), damage_for(earned_xp("medium", 0))
    with screen(browser, ps[a]) as pa, screen(browser, ps[b]) as pb:
        for page in (pa, pb):
            ready(page)
            record_feed(page)
        ra, rb = todo_row(pa, "Book the dentist", False), todo_row(pb, "Return library books", False)
        see(pa, ra, "a's to-do")
        see(pb, rb, "b's to-do")
        ra.focus()
        rb.focus()
        pa.keyboard.press("Space")
        pb.keyboard.press("Space")
        heard(pa, f"{b} hit the boss for {h1(db)} damage")
        heard(pb, f"{a} hit the boss for {h1(da)} damage")
        poll(lambda: ensure(len(ps[a].quest(qid)["events"]) == 2, "two strikes"), "both strikes stored")
        quest = ps[a].quest(qid)
        want = [f"{e['username']} {MINUS}{h1(e['amount'])}" for e in quest["events"]]
        for page in (pa, pb):
            live(page, lambda page=page: ensure(lines(role(page, "list", "Strikes")) == want, str(lines(role(page, "list", "Strikes")))), "strike lines in server order")
            live(page, lambda page=page: meter_reads(role(page, "meter", "Boss health"), f"{h1(mx - da - db)} / {h1(mx)}"), "boss meter")


def test_wf_simultaneous_strikes_same_player_two_devices(browser, app_url):
    u, mate, party = uname("s2d"), uname("s2m"), pname("Twin")
    ids, ps = world(app_url, [{"username": u}, {"username": mate}], parties=[P(party, u, mate)], quests=[Q(party, MOTH)],
                    tasks=[T(u, "todo", "Book the dentist")])
    p = ps[u]
    dmg = damage_for(earned_xp("easy", 0))
    line = f"{u} {MINUS}{h1(dmg)}"
    with screen(browser, p) as one, screen(browser, p) as two:
        for page in (one, two):
            ready(page)
            record_feed(page)
        see(one, todo_row(one, "Book the dentist", False), "to-do on device one")
        see(two, todo_row(two, "Book the dentist", False), "to-do on device two")
        role(one, "checkbox", "Complete Book the dentist").click(no_wait_after=True)
        role(two, "checkbox", "Complete Book the dentist").click(no_wait_after=True)
        for page in (one, two):
            heard(page, f"Boss took {h1(dmg)} damage")
            live(page, lambda page=page: ensure(lines(role(page, "list", "Strikes")).count(line) == 1, str(lines(role(page, "list", "Strikes")))), "one strike line")
            live(page, lambda page=page: shows(todo_row(page, "Book the dentist", True)), "to-do done on both devices")
    assert len(p.quest(ids["quests"][party])["events"]) == 1
    assert len([e for e in p.ledger() if e["kind"] == "task" and e.get("taskId") == ids["tasks"][u]["Book the dentist"]]) == 1


def test_wf_simultaneous_strikes_reduced_motion(browser, app_url):
    a, b, w, party = uname("sra"), uname("srb"), uname("srw"), pname("Still")
    ids, ps = world(app_url, [{"username": a}, {"username": b}, {"username": w}], parties=[P(party, a, b, w)], quests=[Q(party, CLUTTER)],
                    tasks=[T(a, "todo", "Book the dentist", difficulty="hard"), T(b, "todo", "Return library books", difficulty="hard")])
    qid, mx = ids["quests"][party], QUESTS[CLUTTER]["max"]
    dmg = damage_for(earned_xp("hard", 0))
    with screen(browser, ps[w], reduced_motion="reduce") as page:
        ready(page)
        together(lambda: ps[a].post(f"/api/tasks/{ids['tasks'][a]['Book the dentist']}/complete"),
                 lambda: ps[b].post(f"/api/tasks/{ids['tasks'][b]['Return library books']}/complete"))
        quest = ps[w].quest(qid)
        want = [f"{e['username']} {MINUS}{h1(e['amount'])}" for e in quest["events"]]
        assert len(want) == 2, want
        left = mx - 2 * dmg
        live(page, lambda: meter_reads(role(page, "meter", "Boss health"), f"{h1(left)} / {h1(mx)}"), "boss meter")
        seam_at(page, left / mx)
        assert lines(role(page, "list", "Strikes")) == want


def test_wf_strike_back_misser_and_teammate(browser, app_url):
    a, b, party = uname("sma"), uname("smb"), pname("Both")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog")])
    back = q(QUESTS[DROWSE]["power"], "0.1")
    own = health_loss("easy", 0)
    with screen(browser, ps[a]) as pa, screen(browser, ps[b]) as pb:
        for page in (pa, pb):
            ready(page)
            record_feed(page)
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        heard(pa, f"Drowsewyrm struck back: you lost {h1(back)} health")
        heard(pb, f"Drowsewyrm struck back: you lost {h1(back)} health")
        live(pa, lambda: meter_reads(role(pa, "meter", f"{b} health"), f"{h1(MAX_HEALTH - back)} / 50.0"), "teammate meter on the misser's screen")
        live(pb, lambda: meter_reads(role(pb, "meter", f"{a} health"), f"{h1(MAX_HEALTH - own - back)} / 50.0"), "misser meter on the teammate's screen")
        live(pa, lambda: meter_reads(role(pa, "meter", "Health"), f"{h1(MAX_HEALTH - own - back)} / 50.0"), "misser's own health")


def test_wf_strike_back_phone_party_dialog(browser, app_url):
    a, b, party = uname("spa"), uname("spb"), pname("Phone")
    ids, ps = world(app_url, [{"username": a}, {"username": b}], parties=[P(party, a, b)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog"), T(a, "daily", "Practice guitar")])
    back = q(QUESTS[DROWSE]["power"] * 2, "0.1")
    with screen(browser, ps[b], viewport=PHONE) as page:
        ready(page)
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        live(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(MAX_HEALTH - back)} / 50.0"), "health on the phone")
        tap(role(page, "button", "Party"))
        dialog = role(page, "dialog", "Party")
        see(page, dialog, "Party dialog")
        eventually(page, lambda: ensure(f"Drowsewyrm struck back for {h1(back)} ({a} missed 2)" in lines(role(dialog, "list", "Strikes")),
                                        str(lines(role(dialog, "list", "Strikes")))), "strike-back line in the Party dialog")


def test_wf_strike_back_faint_live(browser, app_url):
    a, b, party = uname("sfa"), uname("sfb"), pname("Faint")
    gold = Decimal("5.00")
    ids, ps = world(app_url, [{"username": a}, {"username": b, "level": 2, "health": 1, "gold": float(gold)}],
                    parties=[P(party, a, b)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog"), T(b, "habit", "Drink a glass of water")])
    lost = (gold * FAINT_SHARE).quantize(Decimal("0.01"), ROUND_FLOOR)
    with screen(browser, ps[b]) as page:
        ready(page)
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        dialog = role(page, "dialog", "You fainted")
        live(page, lambda: shows(dialog), "faint dialog opens live")
        expect(dialog).to_contain_text(f"You dropped to level 1 and lost {g2(lost)} gold. Your health is back to 50.0.")
        role(dialog, "button", "Get back up").focus()
        page.keyboard.press("Enter")
        closed(page, dialog, "Get back up closes the dialog")
        focused(page, habit_row(page, "Drink a glass of water", 0), "focus goes to the first Habits row")
        meter_reads(role(page, "meter", "Health"), "50.0 / 50.0")


def test_wf_phone_lists_add_on_phone(browser, app_url):
    u = uname("pad")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    with screen(browser, p, viewport=PHONE) as page:
        ready(page)
        tap(role(page, "tab", "Dailies"))
        tap(role(page, "button", "Add daily"))
        dialog = role(page, "dialog", "New task")
        see(page, dialog, "New task sheet")
        assert chosen(role(dialog, "combobox", "Type")) == "Daily"
        fill(slid_in(role(dialog, "textbox", "Title")), "Walk the dog")
        tap(slid_in(role(dialog, "button", "Save task")))
        closed(page, dialog, "the sheet closes after saving")
        see(page, daily_row(page, "Walk the dog", True, 0, False), "new daily row")
        layout(page)
    assert [d["title"] for d in p.tasks()["dailies"]] == ["Walk the dog"]


def test_wf_phone_lists_swipe_todo_strike(browser, app_url):
    u, party = uname("pst"), pname("Swipe")
    ids, ps = world(app_url, [{"username": u}], parties=[P(party, u)], quests=[Q(party, CLUTTER)], tasks=[T(u, "todo", "Return library books")])
    p = ps[u]
    mx, dmg = QUESTS[CLUTTER]["max"], damage_for(earned_xp("easy", 0))
    with screen(browser, p, viewport=PHONE) as page:
        cdp = touch(page)
        ready(page)
        tap(role(page, "tab", "To-dos"))
        row = todo_row(page, "Return library books", False)
        see(page, row, "to-do row")
        record_feed(page)
        swipe(page, cdp, row, SWIPE_PX + 20)
        heard(page, f"Boss took {h1(dmg)} damage")
        tap(role(page, "button", "Party"))
        dialog = role(page, "dialog", "Party")
        see(page, dialog, "Party dialog")
        eventually(page, lambda: meter_reads(role(dialog, "meter", "Boss health"), f"{h1(mx - dmg)} / {h1(mx)}"), "boss meter in the dialog")
    assert dec(p.quest(ids["quests"][party])["bossHealth"]) == mx - dmg


def test_wf_import_tasks_keyboard_live(browser, app_url):
    u = uname("ikl")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    data = b"DEEDLIST 1\nhabit | Take the stairs | easy\nreward | Bubble tea | 6.5\n"
    with screen(browser, p) as laptop, screen(browser, p) as other:
        ready(laptop)
        ready(other)
        opener = role(laptop, "button", "Import tasks")
        opener.focus()
        laptop.keyboard.press("Enter")
        dialog = role(laptop, "dialog", "Import tasks")
        see(laptop, dialog, "Import tasks sheet")
        dialog.get_by_label("Task list file").set_input_files(files=[{"name": IMPORT_NAME, "mimeType": "text/plain", "buffer": data}])
        role(dialog, "button", "Import").focus()
        laptop.keyboard.press("Enter")
        see(laptop, dialog.get_by_role("status").filter(has_text="Imported 2 tasks"), "import success status")
        laptop.keyboard.press("Escape")
        closed(laptop, dialog, "Escape closes the sheet")
        focused(laptop, opener, "focus returns to Import tasks")
        live(other, lambda: shows(habit_row(other, "Take the stairs", 0)), "imported habit on the other device")
        live(other, lambda: shows(reward_row(other, "Bubble tea", Decimal("6.50"))), "imported reward on the other device")


def test_wf_import_tasks_phone(browser, app_url):
    u = uname("iph")
    _, ps = world(app_url, [{"username": u}])
    p = ps[u]
    data = b"DEEDLIST 1\ntodo | Return library books | trivial\n"
    with screen(browser, p, viewport=PHONE) as page:
        ready(page)
        tap(role(page, "button", "Import tasks"))
        dialog = role(page, "dialog", "Import tasks")
        see(page, dialog, "Import tasks sheet")
        dialog.get_by_label("Task list file").set_input_files(files=[{"name": IMPORT_NAME, "mimeType": "text/plain", "buffer": data}])
        tap(slid_in(role(dialog, "button", "Import")))
        see(page, dialog.get_by_role("status").filter(has_text="Imported 1 task"), "import success status")
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes the sheet")
        tap(role(page, "tab", "To-dos"))
        see(page, todo_row(page, "Return library books", False), "imported to-do row")
    assert [t["title"] for t in p.tasks()["todos"]] == ["Return library books"]


def test_wf_quest_history_banner_keyboard_history(browser, app_url):
    lead, m, party = uname("khl"), uname("khm"), pname("Keys")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER, bossHealth=2)],
                    tasks=[T(lead, "todo", "Book the dentist")])
    answered(ps[lead].post(f"/api/tasks/{ids['tasks'][lead]['Book the dentist']}/complete"), 200)
    want = [f"{n} {h1(d)}" for n, d in sorted({lead: Decimal("2"), m: Decimal("0")}.items())]
    with screen(browser, ps[m]) as page:
        ready(page)
        level_up = role(page, "dialog", "Level up")
        see(page, level_up, "Level up from the quest reward opens on load")
        click(role(level_up, "button", "Keep going"))
        closed(page, level_up, "Level up closed")
        role(page, "link", "Quest history").focus()
        page.keyboard.press("Enter")
        history = role(page, "list", "Quest history")
        see(page, history, "quest history list")
        role(history, "link", CLUTTER).focus()
        page.keyboard.press("Enter")
        see(page, role(page, "heading", CLUTTER), "quest detail heading")
        see(page, page.get_by_text("State: defeated", exact=True), "state line")
        eventually(page, lambda: ensure(lines(role(page, "list", "Member damage")) == want, str(lines(role(page, "list", "Member damage")))), "member damage lines")


def test_wf_quest_history_banner_abandon_keyboard(browser, app_url):
    lead, m, party = uname("abl"), uname("abm"), pname("Quit")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER)])
    qid = ids["quests"][party]
    with screen(browser, ps[lead]) as lp, screen(browser, ps[m]) as mp:
        ready(lp)
        ready(mp)
        opener = role(lp, "button", "Abandon quest")
        see(lp, opener, "Abandon quest button")
        opener.focus()
        lp.keyboard.press("Enter")
        dialog = role(lp, "dialog", "Abandon quest")
        see(lp, dialog, "Abandon quest sheet")
        lp.keyboard.press("Escape")
        closed(lp, dialog, "Escape closes the sheet")
        focused(lp, opener, "focus returns to Abandon quest")
        lp.keyboard.press("Enter")
        see(lp, dialog, "Abandon quest sheet again")
        role(dialog, "button", "Abandon").focus()
        lp.keyboard.press("Enter")
        live(mp, lambda: shows(mp.get_by_text("No quest under way.", exact=True)), "member's quest region empties")
        ended = instant(ps[m].quest(qid)["endedAt"]).date().isoformat()
        mp.goto(ps[m].base + "/history")
        item = role(mp, "list", "Quest history").get_by_role("listitem").filter(has=role(mp, "link", CLUTTER))
        see(mp, item, "history entry")
        expect(item.first).to_contain_text(f"Clutterhound, abandoned, ended {ended}")
    assert ps[lead].quest(qid)["state"] == "abandoned"


def test_wf_quest_history_banner_phone_banner(browser, app_url):
    lead, m, party = uname("pbl"), uname("pbm"), pname("Pennant")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, CLUTTER)])
    pid = ids["parties"][party]
    first = answered(upload_banner(ps[lead], pid, "banner.png", png((240, 20, 130))), 201)["bannerUrl"]
    with screen(browser, ps[m], viewport=PHONE) as page:
        ready(page)
        tap(role(page, "button", "Party"))
        dialog = role(page, "dialog", "Party")
        see(page, dialog, "Party dialog")
        img = role(dialog, "img", f"{party} banner")
        eventually(page, lambda: ensure((img.first.get_attribute("src", timeout=POLL_MS) or "").endswith(first), "banner src"), "banner in the dialog")
        second = answered(upload_banner(ps[lead], pid, "banner.jpg", JPEG, "image/jpeg"), 201)["bannerUrl"]
        live(page, lambda: ensure((img.first.get_attribute("src", timeout=POLL_MS) or "").endswith(second), "old banner"), "new banner live in the dialog")


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m.get(k), str) and m[k].strip(), k


def test_if_third_party_notices():
    text = (APP / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    missing = [pkg.name for pkg in shipped_packages() if pkg.name not in text]
    assert not missing, f"packages missing from notices: {missing}"
    for font in ("Hubot Sans", "Mona Sans"):
        assert font in text


def test_if_licences_allowed():
    bad = [(pkg.name, pkg.licence) for pkg in shipped_packages() if not licence_allowed(pkg.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert "OFL" in (APP / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")


def test_if_only_provided_datastores():
    extra = [pkg.name for pkg in shipped_packages() if "sqlite" in pkg.name.lower() or "redis" in pkg.name.lower()]
    assert not extra, extra


def test_if_no_external_resources(browser, app_url):
    u = uname("ext")
    _, ps = world(app_url, [{"username": u}])
    with screen(browser, ps[u], "/") as page:
        urls: list[str] = []
        page.on("request", lambda req: urls.append(req.url))
        page.reload()
        page.goto(app_url + "/board")
        ready(page)
        page.context.clear_cookies()
        page.goto(app_url + "/")
        see(page, role(page, "heading", "Every chore lands a blow."), "landing")
    foreign = [x for x in urls if x.startswith("http") and not same_origin(x, origin_of(app_url))]
    assert not foreign, foreign


def test_if_lockfile_used():
    lock = json.loads((APP / "package-lock.json").read_text())
    assert isinstance(lock, dict) and lock
    assert re.search(r"\bnpm (ci|install)\b", json.loads((APP / "run.json").read_text())["install"])


def test_if_service_config_untouched():
    files = [f for f in list(APP.glob("*compose*.y*ml")) + list(APP.glob("*/*compose*.y*ml")) if "node_modules" not in f.parts]
    if not files:
        return
    if (APP / ".git").exists():
        out = subprocess.run(["git", "-C", str(APP), "status", "--porcelain", "--", *map(str, files)],
                             capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)
        assert out.stdout.strip() == "", out.stdout
    text = "\n".join(f.read_text() for f in files).lower()
    assert "Postgres".lower() in text and "MinIO".lower() in text


def slides_out(page: Page, control: Locator, close: Callable[[], Any]) -> None:
    start = slid_in(control).bounding_box()
    assert start is not None, "sheet control has no box"
    handle = control.element_handle()
    width = page.viewport_size["width"]
    moved = False

    def sample() -> bool:
        nonlocal moved
        box = handle.bounding_box()
        if box is None or box["x"] >= width:
            return True
        moved = moved or box["x"] > start["x"] + 1
        return False

    close()
    done = sample()
    for _ in range(MOTION_MAX_MS // 16):
        if done:
            break
        advance(page, 16)
        done = sample()
    deadline = time.monotonic() + 1
    while not done and time.monotonic() < deadline:
        done = sample()
    assert moved, "the sheet vanished without sliding out"
    assert done, "the sheet is still on screen after 0.6 s"


def test_wf_habit_scoring_enter_on_score_button(browser, app_url):
    u, title = uname("hes"), "Drink a glass of water"
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "habit", title)])
    with screen(browser, ps[u]) as page:
        ready(page)
        row = habit_row(page, title, 0)
        see(page, row, "habit row")
        role(row, "button", f"Score {title} up").focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Edit task")
        see(page, dialog, "Edit task opens from the score button")
        expect(role(dialog, "textbox", "Title")).to_have_value(title)
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes the sheet")
        see(page, row, "row score unchanged")
    me = ps[u].me()
    assert me["experience"] == 0 and dec(me["gold"]) == 0


def test_wf_habit_scoring_teammate_sees_down(browser, app_url):
    u, mate, party, title = uname("hta"), uname("htb"), pname("Watch"), "Doomscroll after midnight"
    _, ps = world(app_url, [{"username": u}, {"username": mate}], parties=[P(party, u, mate)], tasks=[T(u, "habit", title)])
    left = MAX_HEALTH - health_loss("easy", 0)
    with screen(browser, ps[u]) as page, screen(browser, ps[mate]) as other:
        ready(page)
        ready(other)
        see(other, role(other, "meter", f"{u} health"), "teammate's member meter")
        click(role(page, "button", f"Score {title} down"))
        eventually(page, lambda: meter_reads(role(page, "meter", "Health"), f"{h1(left)} / 50.0"), "own health falls")
        live(other, lambda: meter_reads(role(other, "meter", f"{u} health"), f"{h1(left)} / 50.0"), "teammate sees the loss")


def test_wf_rewards_gold_space_on_row_no_buy(browser, app_url):
    u, title = uname("rsp"), "Fancy coffee"
    _, ps = world(app_url, [{"username": u, "gold": 20}], tasks=[T(u, "reward", title, price=5)])
    with screen(browser, ps[u]) as page:
        ready(page)
        row = reward_row(page, title, 5)
        see(page, row, "reward row")
        row.focus()
        page.keyboard.press("Space")
        quiet(page, lambda: expect(role(page, "status", "Gold")).to_have_text(f"{g2(20)} gold", timeout=POLL_MS), "Space on the row spends no gold")
    assert dec(ps[u].me()["gold"]) == 20
    assert not [e for e in ps[u].ledger() if e["kind"] == "reward"]


def test_wf_rewards_gold_enter_on_buy_opens_edit(browser, app_url):
    u, title = uname("reb"), "Fancy coffee"
    _, ps = world(app_url, [{"username": u, "gold": 20}], tasks=[T(u, "reward", title, price=5)])
    with screen(browser, ps[u]) as page:
        ready(page)
        role(reward_row(page, title, 5), "button", f"Buy {title}").focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Edit task")
        see(page, dialog, "Edit task opens from the Buy button")
        expect(role(dialog, "textbox", "Title")).to_have_value(title)
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes the sheet")
        expect(role(page, "status", "Gold")).to_have_text(f"{g2(20)} gold")
    assert dec(ps[u].me()["gold"]) == 20
    assert not [e for e in ps[u].ledger() if e["kind"] == "reward"]


def test_wf_rollover_custom_hour_live_faint_focus(browser, app_url):
    u = uname("rlf")
    ids, ps = world(app_url, [{"username": u, "level": 2, "health": 2, "gold": 10}],
                    tasks=[T(u, "habit", "Drink a glass of water"), T(u, "daily", "Practice guitar", difficulty="hard", value=-10)])
    with screen(browser, ps[u]) as page:
        ready(page)
        row = daily_row(page, "Practice guitar", True, 0, False)
        see(page, row, "daily row")
        row.focus()
        rollover(app_url, ids["users"][u]["nextCloseAt"])
        dialog = role(page, "dialog", "You fainted")
        live(page, lambda: shows(dialog), "faint dialog opens live")
        role(dialog, "button", "Get back up").focus()
        page.keyboard.press("Enter")
        closed(page, dialog, "Get back up closes the dialog")
        focused(page, habit_row(page, "Drink a glass of water", 0), "focus goes to the first Habits row")


def test_wf_rest_mode_resting_levelup_on_teammate(browser, app_url):
    u, mate, party, title = uname("rlu"), uname("rlm"), pname("Nap"), "Take the stairs"
    ids, ps = world(app_url, [{"username": u, "resting": True, "health": 30, "experience": LEVEL_STEP - earned_xp("easy", 0)}, {"username": mate}],
                    parties=[P(party, u, mate)], tasks=[T(u, "habit", title)])
    with screen(browser, ps[mate]) as page:
        ready(page)
        meter = role(page, "meter", f"{u} health")
        eventually(page, lambda: meter_reads(meter, "30.0 / 50.0"), "resting member's meter at start")
        answered(ps[u].post(f"/api/tasks/{ids['tasks'][u][title]}/score", {"direction": "up"}), 200)
        live(page, lambda: meter_reads(meter, "50.0 / 50.0"), "teammate sees the refill")
    assert ps[u].me()["level"] == 2


def test_wf_party_quest_live_two_invites(browser, app_url):
    a, b, m, one, two = uname("tia"), uname("tib"), uname("tim"), pname("First"), pname("Second")
    ids, ps = world(app_url, [{"username": a}, {"username": b}, {"username": m}], parties=[P(one, a), P(two, b)])
    with screen(browser, ps[m]) as page:
        ready(page)
        answered(ps[a].post(f"/api/parties/{ids['parties'][one]}/invites", {"username": m}), 201)
        answered(ps[b].post(f"/api/parties/{ids['parties'][two]}/invites", {"username": m}), 201)
        first, second = page.get_by_text(f"{a} invited you to {one}.", exact=True), page.get_by_text(f"{b} invited you to {two}.", exact=True)
        live(page, lambda: (shows(first), shows(second)), "both invites arrive")
        eventually(page, lambda: ensure(role(page, "button", "Join party").count() == 2, "two Join party buttons"), "one Join party per invite")
        invite = next(i for i in answered(ps[m].get("/api/invites"), 200)["invites"] if i["partyName"] == one)
        answered(ps[m].post(f"/api/invites/{invite['id']}/accept"), 200)
        live(page, lambda: ensure(second.count() == 0, "the other invite is still shown"), "joining drops the other invite")


def test_wf_party_quest_live_invited_abandoned(browser, app_url):
    lead, m, party = uname("qal"), uname("qam"), pname("Called off")
    ids, ps = world(app_url, [{"username": lead}, {"username": m}], parties=[P(party, lead, m)], quests=[Q(party, MOTH, state="invited")])
    with screen(browser, ps[m]) as page:
        ready(page)
        see(page, role(page, "button", "Accept quest"), "quest invite on the member's screen")
        answered(ps[lead].post(f"/api/quests/{ids['quests'][party]}/abandon"), 200)
        live(page, lambda: shows(page.get_by_text("No quest under way.", exact=True)), "the quest region empties")
        assert role(page, "button", "Accept quest").count() == 0


def test_wf_strike_back_faint_focus_from_row(browser, app_url):
    a, b, party = uname("sfr"), uname("sfs"), pname("Focus")
    ids, ps = world(app_url, [{"username": a}, {"username": b, "level": 2, "health": 1, "gold": 5}],
                    parties=[P(party, a, b)], quests=[Q(party, DROWSE)],
                    tasks=[T(a, "daily", "Walk the dog"), T(b, "habit", "Drink a glass of water"), T(b, "todo", "Book the dentist")])
    with screen(browser, ps[b]) as page:
        ready(page)
        row = todo_row(page, "Book the dentist", False)
        see(page, row, "to-do row")
        row.focus()
        rollover(app_url, ids["users"][a]["nextCloseAt"])
        dialog = role(page, "dialog", "You fainted")
        live(page, lambda: shows(dialog), "faint dialog opens live")
        role(dialog, "button", "Get back up").focus()
        page.keyboard.press("Enter")
        closed(page, dialog, "Get back up closes the dialog")
        focused(page, habit_row(page, "Drink a glass of water", 0), "focus goes to the first Habits row")


def test_wf_import_tasks_sheet_slides_out(browser, app_url):
    u = uname("iso")
    _, ps = world(app_url, [{"username": u}])
    with screen(browser, ps[u], reduced_motion="no-preference") as page:
        ready(page)
        opener = role(page, "button", "Import tasks")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Import tasks")
        see(page, dialog, "Import tasks sheet")
        slides_out(page, role(dialog, "button", "Import"), lambda: page.keyboard.press("Escape"))
        focused(page, opener, "focus returns to Import tasks")


def test_wf_keyboard_lists_enter_on_row_control(browser, app_url):
    u, title = uname("kec"), "Walk the dog"
    _, ps = world(app_url, [{"username": u}], tasks=[T(u, "daily", title)])
    with screen(browser, ps[u]) as page:
        ready(page)
        row = daily_row(page, title, True, 0, False)
        see(page, row, "daily row")
        role(row, "checkbox", f"Complete {title}").focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Edit task")
        see(page, dialog, "Edit task opens from the row's control")
        expect(role(dialog, "textbox", "Title")).to_have_value(title)
        page.keyboard.press("Escape")
        closed(page, dialog, "Escape closes the sheet")
        see(page, row, "daily still not done")
    assert ps[u].me()["experience"] == 0


def test_wf_phone_lists_party_sheet_slides_out(browser, app_url):
    u, party = uname("pso"), pname("Pocket")
    _, ps = world(app_url, [{"username": u}], parties=[P(party, u)])
    with screen(browser, ps[u], viewport=PHONE, reduced_motion="no-preference") as page:
        ready(page)
        tap(role(page, "button", "Party"))
        dialog = role(page, "dialog", "Party")
        see(page, dialog, "Party dialog")
        slides_out(page, role(dialog, "textbox", "Message"), lambda: page.keyboard.press("Escape"))

