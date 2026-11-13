from __future__ import annotations

import base64
import json
import os
import re
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit

import conftest
import httpx
import pytest
from conftest import (
    KillBill,
    Mailpit,
    Postgres,
    addresses,
    advance,
    animations,
    axe,
    capture,
    changed,
    click,
    decode,
    difference,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    sample,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    until,
)
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

GRADING_HEADERS = {"X-Grading-Key": "longrail-grading-7f3c"}
PASSWORD = "chalk-and-rail"
ADULT_YEAR = 1990
MINOR_YEAR = 2012
CHILD_YEAR = 2020

HTTP_TIMEOUT_S = 40
WAIT_S = 30
WORKER_WAIT_S = 15
MAIL_WAIT_S = 45
QUICK_MS = 150
STEP_MS = 200
POLL_S = 0.25
TAB_LIMIT = 40
SLACK_S = 4
RELAY_CHUNK = 65536
TANGENT_SAMPLE_MS = 25
RENDER_LAG_S = 0.5
BOARD_PLAYERS = 40

MIN_TARGET_PX = 44
PAIRING_S = 3
PRESENCE_S = 5
BAND_WIDEN_S = 10
DROP_DETECT_S = 5
SHORT_TIMER_S = 8
DEFAULT_SHOT_CLOCK_S = 30
POWER_FLAT_MS = 200
POWER_FULL_MS = 2200
MOTION_MS = 1000
AT_ONCE_MS = 1000
TANGENT_MID_MS = 100
TANGENT_MAX_MS = 500
CROSSFADE_MAX_MS = 250
AI_TURN_MAX_MS = 20000
AI_STEP_MS = 500
BODY_LIMIT = 65536
SKEWED_CLOCK = "2031-01-01T12:00:00Z"

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

CARD_SLOTS = {
    1: "Play 1-on-1",
    2: "Play Special",
    3: "Play with Friends",
    4: "Practice Offline",
    5: "Shop",
    6: "Settings",
    7: "Tournaments",
    8: "Clubs",
    9: "Leaderboards",
}
CARDS = list(CARD_SLOTS.values())
GUEST_CARDS = ("Practice Offline", "Settings")
ONLINE_CARDS = [card for card in CARDS if card not in GUEST_CARDS]
TIERS = {
    1: ("Corner Bar", 1, 100, 180),
    2: ("Back Room", 3, 500, 900),
    3: ("Downtown", 7, 2500, 4500),
    4: ("Velvet Room", 12, 10000, 18000),
    5: ("The Penthouse", 20, 50000, 90000),
}
CORNER_ENTRY = TIERS[1][2]
CORNER_POT = TIERS[1][3]
DOWNTOWN_ENTRY = TIERS[3][2]
POT_WON = f"Pot won: {CORNER_POT} Coins"
ENTRY_LOST = f"Entry lost: {CORNER_ENTRY} Coins"
WIN_XP = 60
LOSS_XP = 20
WINNER_COINS = 1000 - CORNER_ENTRY + CORNER_POT
DAILY_COINS = 1000 + 100
ASH_BREAK_COINS = 1000 - 400
CORS_HEADER = "access-control-allow-origin"
VENV_MARKER = "pyvenv.cfg"
OTHER_STORES = ("Redis", "SQLite")
PRIZES = {
    1: (400, 160, 80, 80),
    2: (2000, 800, 400, 400),
    3: (10000, 4000, 2000, 2000),
    4: (40000, 16000, 8000, 8000),
    5: (200000, 80000, 40000, 40000),
}
MAIN_SCREENS = [
    "/home", "/play", "/play/special", "/practice", "/shop", "/tournaments", "/clubs",
    "/leaderboards", "/profile", "/settings",
]


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


class Relay:

    def __init__(self, target: str) -> None:
        self.target = target
        self.sockets: list[socket.socket] = []
        self.lock = threading.Lock()
        self.gate = threading.Event()
        self.gate.set()
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.url = f"http://127.0.0.1:{self.listener.getsockname()[1]}"
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self) -> None:
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            with self.lock:
                parts = urlsplit(self.target)
                try:
                    upstream = socket.create_connection((parts.hostname, parts.port or 80))
                except OSError:
                    client.close()
                    continue
                self.sockets += [client, upstream]
            threading.Thread(target=self.pump, args=(client, upstream, True), daemon=True).start()
            threading.Thread(target=self.pump, args=(upstream, client, False), daemon=True).start()

    def pump(self, source: socket.socket, sink: socket.socket, gated: bool) -> None:
        try:
            while data := source.recv(RELAY_CHUNK):
                if gated:
                    self.gate.wait()
                sink.sendall(data)
        except OSError:
            pass
        self.cut(source, sink)

    @staticmethod
    def cut(*ends: socket.socket) -> None:
        for end in ends:
            try:
                end.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            end.close()

    def switch(self, target: str) -> None:
        with self.lock:
            self.target = target
            ends, self.sockets = self.sockets, []
        self.cut(*ends)

    def hold(self) -> None:
        self.gate.clear()

    def release(self) -> None:
        self.gate.set()

    def close(self) -> None:
        self.release()
        self.cut(self.listener)
        self.switch(self.target)


@contextmanager
def relayed(target: str) -> Iterator[Relay]:
    relay = Relay(target)
    try:
        yield relay
    finally:
        relay.close()


def tag() -> str:
    return uuid.uuid4().hex[:8]


def call(
    base: str,
    method: str,
    path: str,
    body: Any = None,
    cookie: str | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    merged = dict(headers or {})
    if cookie:
        merged["Cookie"] = cookie
    return httpx.request(method, base + path, json=body, headers=merged, timeout=HTTP_TIMEOUT_S)


def session_cookie(response: httpx.Response) -> str:
    for line in response.headers.get_list("set-cookie"):
        if line.startswith("hs_session="):
            return line.split(";")[0]
    raise AssertionError("no hs_session cookie was set")


class Player:

    def __init__(self, base: str, player_id: str, email: str, name: str) -> None:
        self.base = base
        self.id = player_id
        self.email = email
        self.name = name
        self.cookie: str | None = None

    def signin(self) -> "Player":
        response = call(
            self.base, "POST", "/api/auth/signin", {"email": self.email, "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        self.cookie = session_cookie(response)
        return self

    def get(self, path: str) -> httpx.Response:
        return call(self.base, "GET", path, cookie=self.cookie)

    def post(self, path: str, body: Any = None, headers: dict[str, str] | None = None) -> httpx.Response:
        return call(self.base, "POST", path, body, self.cookie, headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return call(self.base, "PATCH", path, body, self.cookie)

    def delete(self, path: str) -> httpx.Response:
        return call(self.base, "DELETE", path, cookie=self.cookie)

    def me(self) -> dict[str, Any]:
        response = self.get("/api/me")
        assert response.status_code == 200, response.text
        return response.json()


def make_player(
    base: str,
    level: int = 1,
    xp: int = 0,
    coins: int = 1000,
    cash: int = 0,
    verified: bool = True,
    birth_year: int = ADULT_YEAR,
    weekly_wins: int | None = None,
) -> Player:
    name = f"P{tag()}"
    email = f"{tag()}{tag()}@example.test"
    body: dict[str, Any] = {
        "email": email, "password": PASSWORD, "displayName": name, "birthYear": birth_year,
        "level": level, "xp": xp, "coins": coins, "cash": cash, "emailVerified": verified,
    }
    if weekly_wins is not None:
        body["weeklyWins"] = weekly_wins
    response = post_json(base, "/api/grading/players", body, **GRADING_HEADERS)
    assert response.status_code == 201, response.text
    return Player(base, response.json()["id"], email, name)


def new_player(base: str) -> Player:
    name = f"P{tag()}"
    email = f"{tag()}{tag()}@example.test"
    body = {"email": email, "password": PASSWORD, "displayName": name, "birthYear": ADULT_YEAR}
    response = post_json(base, "/api/auth/signup", body)
    assert response.status_code == 201, response.text
    return Player(base, response.json()["id"], email, name)


def set_balance(player: Player, **balances: int) -> None:
    response = call(
        player.base, "PATCH", f"/api/grading/players/{player.id}", balances, headers=GRADING_HEADERS
    )
    assert response.status_code == 200, response.text


def entry(
    first: int | None,
    pots: list[list[Any]] | None = None,
    cushion: bool = True,
    scratch: bool = False,
    off: list[int] | None = None,
) -> dict[str, Any]:
    return {
        "firstContact": first,
        "pocketed": [{"ball": ball, "pocket": pocket} for ball, pocket in pots or []],
        "cushion": cushion,
        "scratch": scratch,
        "offTable": off or [],
    }


def make_table(
    base: str,
    players: list[Player],
    script: list[dict[str, Any]],
    balls: list[int],
    phase: str = "groups",
    mode: str = "eight-ball",
    tier: int = 1,
    active: int = 1,
) -> tuple[str, str]:
    groups = {"1": "solids", "2": "stripes"} if phase == "groups" else None
    response = post_json(
        base,
        "/api/grading/tables",
        {
            "mode": mode, "tier": tier, "players": [p.id for p in players], "activeSeat": active,
            "phase": phase, "groups": groups, "balls": balls, "script": script,
        },
        **GRADING_HEADERS,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return body["tableId"], body["tableUrl"]


def shot_body(called: str | None = None) -> dict[str, Any]:
    return {"aimDegrees": 12.5, "power": 60, "sideSpin": 0, "topSpin": 0, "calledPocket": called}


def pack_path(pack: str) -> str:
    return f"/api/shop/cash-packs/{pack}/purchase"


def item_path(item: str, action: str) -> str:
    return f"/api/shop/items/{item}/{action}"


def poll(read: Callable[[], Any], seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    gap = threading.Event()
    while True:
        value = read()
        if value:
            return value
        assert time.monotonic() < deadline, f"nothing settled within {seconds}s"
        gap.wait(POLL_S)


def mail_to(mail: Mailpit, email: str, subject: str, count: int = 1) -> list[dict[str, Any]]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while True:
        found = [
            m for m in mail.messages()
            if email in addresses(m.get("To")) and m.get("Subject") == subject
        ]
        if len(found) >= count or time.monotonic() > deadline:
            return found


def verify_token(message: dict[str, Any]) -> str:
    match = re.search(r"/verify\?token=([^\s\"'<>&]+)", text(message))
    assert match, "the verification mail holds no link"
    return match.group(1)


def purchases(killbill: KillBill, email: str) -> list[dict[str, Any]]:
    account = killbill.account(email)
    if account is None:
        return []
    found = []
    for payment in killbill.payments(account["accountId"]):
        for transaction in payment.get("transactions", []):
            if transaction.get("transactionType") == "PURCHASE":
                found.append({**transaction, "paymentId": payment.get("paymentId")})
    return found


def mentions(database: Postgres, needle: str) -> int:
    total = 0
    for table in database.tables():
        quoted = ".".join(f'"{part}"' for part in table.split("."))
        rows = database.rows(f"SELECT count(*) AS n FROM {quoted} t WHERE t::text LIKE '%{needle}%'")
        total += int(rows[0]["n"])
    return total


def R(scope: Any, role: str, name: str) -> Locator:
    return scope.get_by_role(role, name=name, exact=True)


def eventually(page: Page, verify: Callable[[], None], seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            verify()
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def see(page: Page, locator: Locator, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=QUICK_MS), seconds)


def shows(page: Page, locator: Locator, value: Any, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expect(locator).to_have_text(value, timeout=QUICK_MS), seconds)


def contains(page: Page, locator: Locator, value: Any, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expect(locator).to_contain_text(value, timeout=QUICK_MS), seconds)


def saw(page: Page, sentence: str, seconds: float = WAIT_S) -> None:
    until(
        page,
        "(t) => document.body.innerText.toLowerCase().includes(t.toLowerCase())",
        sentence,
        seconds=seconds,
    )


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def at(page: Page, path: str, seconds: float = WAIT_S) -> None:
    until(page, "(p) => location.pathname === p", path, seconds=seconds)


def at_table(page: Page, seconds: float = WAIT_S) -> str:
    until(page, "() => /^\\/table\\/[^/]+$/.test(location.pathname)", seconds=seconds)
    return page.evaluate("() => location.pathname")


def closed(page: Page, locator: Locator) -> None:
    def verify() -> None:
        if locator.count() == 0:
            return
        try:
            box = locator.first.bounding_box(timeout=QUICK_MS)
        except PlaywrightError:
            return
        size = page.viewport_size
        assert box is None or box["x"] >= size["width"] or box["x"] + box["width"] <= 0
    eventually(page, verify)


def number(slider: Locator) -> float:
    return float(slider.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))


def reads(page: Page, slider: Locator, value: float) -> None:
    def verify() -> None:
        assert abs(number(slider) - value) < 0.01
    eventually(page, verify)


def inside(locator: Locator) -> bool:
    return locator.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def tab_to(page: Page, locator: Locator) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if inside(locator):
            return
    raise AssertionError("Tab never reached the control")


def tab_stays_inside(page: Page, dialog: Locator) -> None:
    advance(page, MOTION_MS)
    for key in ["Tab"] * TAB_LIMIT + ["Shift+Tab"] * TAB_LIMIT:
        page.keyboard.press(key)
        assert inside(dialog), f"{key} left the dialog"


def big_targets(page: Page) -> None:
    for role in ("button", "link", "slider", "switch", "tab", "textbox"):
        for item in page.get_by_role(role).all():
            box = item.bounding_box()
            if box is None or box["width"] <= 1 or box["height"] <= 1:
                continue
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX, (
                f"{role} {item.get_attribute('aria-label')} is {box}"
            )


def columns(boxes: list[dict[str, float]]) -> int:
    return len({round(box["x"]) for box in boxes})


def box_of(locator: Locator) -> dict[str, float]:
    box = locator.bounding_box()
    assert box is not None, "the element has no box"
    return box


def left_edge(point: dict[str, float]) -> float:
    return point["x"] if "x" in point else point["left"]


def focus_mark(locator: Locator) -> None:
    rest, focused = state_styles(
        locator, "outline-style", "outline-width", "box-shadow", state="focus"
    )
    assert rest != focused, "focus changes nothing"


def touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    return cdp


def touch_at(page: Page, x: float, y: float) -> None:
    cdp = touch(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def swipe(page: Page, start: float, end: float, y: float) -> None:
    cdp = touch(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start, "y": y}]})
    for share in (0.25, 0.5, 0.75, 1):
        x = start + (end - start) * share
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


@contextmanager
def worker_app(browser: Browser, url: str) -> Iterator[Page]:
    context = browser.new_context(viewport=DESKTOP, has_touch=True, service_workers="allow")
    try:
        context.add_init_script(path=Path(conftest.__file__).with_name("instrument.js"))
        tab = context.new_page()
        tab.set_default_timeout(5000)
        tab.set_default_navigation_timeout(15000)
        now = int(time.time())
        tab.clock.install(time=now)
        tab.clock.pause_at(now + 10)
        tab.goto(url)
        yield tab
    finally:
        context.close()


@contextmanager
def signed_in(
    browser: Browser, base: str, player: Player, path: str = "/home",
    size: dict[str, int] | None = None, worker: bool = False, **options: Any,
) -> Iterator[Page]:
    with (worker_app if worker else open_app)(browser, base + "/home", **options) as page:
        if size:
            page.set_viewport_size(size)
        response = page.request.post(
            f"{base}/api/auth/signin", data={"email": player.email, "password": PASSWORD}
        )
        assert response.status == 200, response.text()
        page.goto(base + path)
        yield page


@contextmanager
def seated(
    browser: Browser, base: str, one: Player, two: Player, table_url: str, **options: Any
) -> Iterator[tuple[Page, Page]]:
    with signed_in(browser, base, one, table_url, **options) as first:
        with signed_in(browser, base, two, table_url, **options) as second:
            see(first, R(first, "status", "Turn"))
            see(second, R(second, "status", "Turn"))
            yield first, second


def me_of(page: Page, base: str) -> dict[str, Any]:
    response = page.request.get(f"{base}/api/me")
    assert response.status == 200, response.text()
    return response.json()


def table_of(page: Page, base: str, table_id: str) -> dict[str, Any]:
    response = page.request.get(f"{base}/api/tables/{table_id}")
    assert response.status == 200, response.text()
    return response.json()


def open_friends(page: Page) -> Locator:
    click(R(page, "button", "Friends"))
    panel = R(page, "region", "Friends")
    see(page, panel)
    advance(page, MOTION_MS)
    settle(panel)
    return panel


def open_home_tabs(page: Page, name: str) -> None:
    click(R(page, "tab", name))


def sign_up_form(page: Page, email: str, name: str, year: int, password: str = PASSWORD) -> Locator:
    sheet = R(page, "dialog", "Create your account")
    see(page, sheet)
    advance(page, MOTION_MS)
    settle(sheet)
    fill(R(sheet, "textbox", "Email"), email)
    fill(sheet.get_by_label("Password", exact=True), password)
    fill(R(sheet, "textbox", "Display name"), name)
    fill(R(sheet, "textbox", "Year of birth"), str(year))
    return sheet


def ledger_sum(player: Player, currency: str) -> tuple[int, int, list[dict[str, Any]]]:
    response = player.get(f"/api/wallet/ledger?currency={currency}")
    assert response.status_code == 200, response.text
    body = response.json()
    return body["balance"], sum(line["amount"] for line in body["lines"]), body["lines"]


def bracket_for(player: Player, tier: int) -> dict[str, Any]:
    response = player.get("/api/tournaments")
    assert response.status_code == 200, response.text
    return next(t for t in response.json()["tournaments"] if t["tier"] == tier)


def fill_bracket(base: str, tier: int, entrants: int) -> dict[str, Any]:
    _, level, price, _ = TIERS[tier]
    watcher = make_player(base, level=level, coins=price).signin()
    while True:
        bracket = bracket_for(watcher, tier)
        if bracket["entrantCount"] == entrants:
            return bracket
        player = make_player(base, level=level, coins=price).signin()
        response = player.post(f"/api/tournaments/{bracket['id']}/register")
        assert response.status_code == 201, response.text


def test_wf_first_shot_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        table = R(page, "img", "Table")
        strike = R(page, "button", "Strike")
        expect(R(page, "dialog", "Create your account")).to_have_count(0)
        expect(R(page, "slider", "Aim angle")).to_be_visible()
        expect(R(page, "slider", "Shot power")).to_be_visible()
        reads(page, R(page, "slider", "Shot power"), 50)
        before = decode(capture(table))
        click(strike)
        shows(page, step, "Step 2 of 3")
        contains(page, R(page, "region", "Shot receipt"), "First ball 1. Cut 0.0°.")
        assert difference(before, decode(capture(table))) > 0
        click(strike)
        shows(page, step, "Step 3 of 3")
        click(strike)
        prompt = R(page, "dialog", "Save your progress")
        see(page, prompt)
        click(R(prompt, "button", "Skip for now"))
        at(page, "/home")
        assert page.request.get(f"{base}/api/me").status == 401


def test_wf_first_shot_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        aim = R(page, "slider", "Aim angle")
        power = R(page, "slider", "Shot power")
        R(page, "button", "Strike").focus()
        page.keyboard.press("ArrowLeft")
        reads(page, aim, 359)
        page.keyboard.press("ArrowRight")
        reads(page, aim, 0)
        page.keyboard.press("ArrowRight")
        reads(page, aim, 1)
        page.keyboard.press("Shift+ArrowRight")
        reads(page, aim, 1.1)
        spin = R(page, "status", "Spin")
        for word in ("top", "back", "left", "right", "none"):
            page.keyboard.press("s")
            contains(page, spin, f"Spin: {word}")
            if word == "top":
                reads(page, R(page, "slider", "Top spin"), 50)
            if word == "left":
                reads(page, R(page, "slider", "Side spin"), -50)
        page.keyboard.down("Space")
        advance(page, POWER_FLAT_MS / 2)
        assert number(power) == 0
        advance(page, POWER_FLAT_MS * 2)
        rising = number(power)
        assert 0 < rising < 100
        advance(page, POWER_FULL_MS)
        reads(page, power, 100)
        page.keyboard.up("Space")
        shows(page, step, "Step 2 of 3")


def test_wf_first_shot_cancel(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        log = R(page, "log", "Table announcements")
        power = R(page, "slider", "Shot power")
        page.keyboard.down("Space")
        advance(page, POWER_FLAT_MS / 2)
        page.keyboard.up("Space")
        contains(page, log, "No power. Shot cancelled.")
        reads(page, power, 50)
        advance(page, MOTION_MS)
        expect(step).to_have_text("Step 1 of 3")
        page.keyboard.down("Space")
        advance(page, POWER_FLAT_MS * 3)
        page.keyboard.press("Escape")
        page.keyboard.up("Space")
        contains(page, log, "Shot cancelled.")
        reads(page, power, 50)
        advance(page, MOTION_MS)
        expect(step).to_have_text("Step 1 of 3")


def test_wf_first_shot_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(PHONE)
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        table = R(page, "img", "Table")
        box = box_of(table)
        assert box["height"] > box["width"]
        expect(table).to_be_visible()
        expect(R(page, "button", "Strike")).to_be_visible()
        expect(R(page, "slider", "Aim angle")).to_be_visible()
        layout(page)
        big_targets(page)
        aim = R(page, "slider", "Aim angle")
        table.scroll_into_view_if_needed()
        box = box_of(table)
        touch_at(page, box["x"] + box["width"] / 4, box["y"] + box["height"] / 4)

        def moved() -> None:
            assert number(aim) != 0
        eventually(page, moved)
        tap(ready_strike(page))
        shows(page, step, "Step 2 of 3")
    with open_app(browser, base + "/", reduced_motion="reduce") as page:
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        click(ready_strike(page))
        advance(page, AT_ONCE_MS)
        expect(step).to_have_text(f"Step {1 + 1} of 3")


def test_wf_sign_up_resume(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
    with open_app(browser, base + "/home") as page:
        saw(page, "Guest")
        click(R(page, "button", "Play 1-on-1"))
        sheet = sign_up_form(page, email, name, ADULT_YEAR)
        click(R(sheet, "button", "Create account"))
        at(page, "/play")
        see(page, R(page, "region", "Stake tiers"))
        tiers_focused(page)
        page.goto(base + "/home")
        shows(page, R(page, "status", "Coins"), "1,000")
        shows(page, R(page, "status", "Equipped cue"), "Starter Cue")
        identity = me_of(page, base)
        assert identity["coins"] == 1000 and identity["equippedCueId"] == "cue-starter"
        lines = page.request.get(f"{base}/api/wallet/ledger?currency=coins").json()["lines"]
        assert [line["amount"] for line in lines if line["kind"] == "grant"] == [1000]
    assert len(mail_to(mail, email, "Verify your Long Rail email")) == 1


def test_wf_sign_up_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/home") as page:
        opener = R(page, "button", "Play 1-on-1")
        see(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        sheet = R(page, "dialog", "Create your account")
        see(page, sheet)
        tab_stays_inside(page, sheet)
        R(sheet, "button", "Create account").focus()
        page.keyboard.press("Enter")
        summary = R(page, "alert", "Check these fields")
        see(page, summary)
        fields = {
            "Enter a valid email address.": R(sheet, "textbox", "Email"),
            "Use at least 8 characters.": sheet.get_by_label("Password", exact=True),
            "Use 2 to 20 characters.": R(sheet, "textbox", "Display name"),
            "Enter a four-digit year.": R(sheet, "textbox", "Year of birth"),
        }
        for sentence, field in fields.items():
            link = R(summary, "link", sentence)
            link.focus()
            page.keyboard.press("Enter")
            expect(field).to_be_focused()
        page.keyboard.press("Escape")
        closed(page, sheet)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        names = tab_order(page, 12)
        assert "Sign in instead" not in names and "Create account" not in names


def test_wf_sign_up_age_copy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
    database = Postgres()
    with relayed(base) as relay, open_app(browser, relay.url + "/home") as page:
        click(R(page, "button", "Play 1-on-1"))
        sheet = sign_up_form(page, email, name, CHILD_YEAR)
        click(R(sheet, "button", "Create account"))
        saw(page, "Headstring is for players 13 and over.")
        assert mentions(database, email) == 0
        assert mail_to_none(mail, email)
        fill(R(sheet, "textbox", "Year of birth"), str(MINOR_YEAR))
        saw(page, "Age under 18: tables are open, Cash packs are not.")
        assert mentions(database, email) == 0
        relay.hold()
        click(R(sheet, "button", "Create account"))
        saw(page, "Creating your account")
        submit = re.compile("Create account|Creating your account")
        expect(sheet.get_by_role("button", name=submit, disabled=False)).to_have_count(0)
        assert mentions(database, email) == 0
        relay.release()
        at(page, "/play")
        assert me_of(page, relay.url)["minor"] is True
        assert mentions(database, email) > 0


def mail_to_none(mail: Mailpit, email: str) -> bool:
    return not [m for m in mail.messages() if email in addresses(m.get("To"))]


def test_wf_sign_up_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/home") as page:
        page.set_viewport_size(PHONE)
        opener = R(page, "button", "Play 1-on-1")
        see(page, opener)
        tap(opener)
        sheet = R(page, "dialog", "Create your account")
        see(page, sheet)
        advance(page, MOTION_MS)
        settle(sheet)
        box = box_of(sheet)
        assert box["x"] >= 0 and box["x"] + box["width"] <= PHONE["width"]
        assert box["y"] >= 0 and box["y"] + box["height"] <= PHONE["height"]
        layout(page)
        tap(R(sheet, "button", "Close"))
        advance(page, STEP_MS / 2)
        tap(opener)
        advance(page, MOTION_MS * 2)
        expect(sheet).to_be_visible()
        box = box_of(sheet)
        assert box["y"] >= 0 and box["y"] + box["height"] <= PHONE["height"]
        email = R(sheet, "textbox", "Email")
        fill(email, "a@example.test")
        expect(email).to_have_value("a@example.test")


def test_session_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
    assert call(base, "GET", "/api/me").json()["error"] == "unauthenticated"
    form = {"email": email, "password": PASSWORD, "displayName": name, "birthYear": ADULT_YEAR}
    created = call(base, "POST", "/api/auth/signup", form)
    assert created.status_code == 201, created.text
    body = created.json()
    expected = {
        "email": email, "displayName": name, "level": 1, "xp": 0, "coins": 1000, "cash": 0,
        "emailVerified": False, "minor": False,
    }
    assert {key: body[key] for key in expected} == expected and body["id"]
    raw = next(c for c in created.headers.get_list("set-cookie") if c.startswith("hs_session="))
    flags = [part.strip().lower() for part in raw.split(";")[1:]]
    for flag in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert flag.lower() in flags, flag
    assert "Secure".lower() not in flags
    taken = call(base, "POST", "/api/auth/signup", form)
    assert taken.status_code == 409 and taken.json()["error"] == "email_taken"
    assert taken.json()["message"] == "That email already has an account."
    invalid = call(base, "POST", "/api/auth/signup", {**form, "email": "nope", "password": "short"})
    assert invalid.status_code == 422
    assert invalid.json()["error"] == "validation_failed"
    assert invalid.json()["message"] == "Check these fields"
    assert invalid.json()["errors"]["password"] == "Use at least 8 characters."
    assert invalid.json()["errors"]["email"] == "Enter a valid email address."
    child = call(
        base, "POST", "/api/auth/signup",
        {**form, "email": f"{tag()}@example.test", "birthYear": CHILD_YEAR},
    )
    assert child.status_code == 403 and child.json()["error"] == "under_age"

    signed = call(base, "POST", "/api/auth/signin", {"email": email, "password": PASSWORD})
    assert signed.status_code == 200 and signed.json()["id"] == body["id"]
    cookie = session_cookie(signed)
    assert call(base, "GET", "/api/me", cookie=cookie).json()["email"] == email
    assert call(base, "POST", "/api/auth/signout", cookie=cookie).status_code == 204
    assert call(base, "GET", "/api/me", cookie=cookie).status_code == 401

    for _ in range(5):
        wrong = call(base, "POST", "/api/auth/signin", {"email": email, "password": "wrong-password"})
        assert wrong.status_code == 401 and wrong.json()["error"] == "invalid_credentials"
        assert wrong.json()["message"] == "Email or password is wrong."
    limited = call(base, "POST", "/api/auth/signin", {"email": email, "password": PASSWORD})
    assert limited.status_code == 429 and limited.json()["error"] == "rate_limited"
    assert limited.json()["message"] == "Too many tries. Wait a minute and try again."
    assert int(limited.headers["Retry-After"]) > 0
    other = make_player(base)
    assert other.signin().cookie


def test_wf_lobby_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base, level=3, coins=1500, cash=5)
    with signed_in(browser, base, player) as page:
        for _ in range(2):
            profile = R(page, "link", "Profile")
            contains(page, profile, player.name)
            shows(page, R(page, "status", "Coins"), "1,500")
            shows(page, R(page, "status", "Cash"), "5")
            see(page, R(page, "progressbar", "XP"))
            saw(page, "0 / 520 XP")
            saw(page, "Level 3")
            saw(page, "First match")
            shows(page, R(page, "status", "Equipped cue"), "Starter Cue")
            identity = me_of(page, base)
            assert (identity["coins"], identity["cash"], identity["level"]) == (1500, 5, 3)
            assert identity["displayName"] == player.name and identity["xpToNext"] == 520
            page.reload()


def test_wf_lobby_live_chips(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base, coins=50)
    with signed_in(browser, base, player) as first:
        second = first.context.new_page()
        second.goto(base + "/home")
        chips = R(second, "status", "Coins")
        shows(second, chips, "50")
        for used in range(3):
            refill = R(first, "button", "Refill")
            see(first, refill)
            saw(first, f"{3 - used} left today")
            click(refill)
            shows(first, R(first, "status", "Home notice"), "Refill added.")
            shows(second, chips, "550")
            set_balance(player, coins=50)
            shows(second, chips, "50")
            shows(first, R(first, "status", "Coins"), "50")
        click(R(first, "button", "Refill"))
        notice = "No Refills left today. Back after midnight UTC."
        shows(first, R(first, "status", "Home notice"), notice)
        expect(chips).to_have_text("50")
        click(R(first, "button", "Claim daily reward"))
        shows(first, R(first, "status", "Home notice"), "Daily reward claimed.")
        shows(second, chips, "150")
        eventually(first, lambda: expect(R(first, "button", "Claim daily reward")).to_be_disabled(timeout=QUICK_MS))
        repeat = first.request.post(f"{base}/api/wallet/daily-reward")
        assert repeat.status == 409 and repeat.json()["error"] == "daily_claimed"
        set_balance(player, coins=50)
        repeat = first.request.post(f"{base}/api/wallet/refill")
        assert repeat.status == 409 and repeat.json()["error"] == "refill_limit"
    settled = make_player(base).signin()
    refused = settled.post("/api/wallet/refill")
    assert refused.status_code == 409 and refused.json()["error"] == "refill_not_needed"
    assert refused.json()["message"] == "Refill is for balances under 100 Coins."
    assert settled.me()["coins"] == 1000
    racer = make_player(base).signin()
    with ThreadPoolExecutor(5) as pool:
        replies = list(pool.map(lambda _: racer.post("/api/wallet/daily-reward"), range(5)))
    assert sorted(r.status_code for r in replies) == [200, 409, 409, 409, 409]
    balance, total, lines = ledger_sum(racer, "coins")
    assert balance == total == DAILY_COINS
    assert len([line for line in lines if line["kind"] == "daily_reward"]) == 1


def test_wf_lobby_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, new_player(base)) as page:
        see(page, R(page, "region", "Modes"))
        first = tab_order(page, 1)
        assert "Skip to modes" in first[0]
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(R(page, "region", "Modes")).to_be_focused(timeout=QUICK_MS))
        names = tab_order(page, len(CARDS))
        for card, name in zip(CARDS, names):
            assert card.lower() in name.lower()
        for card in CARDS:
            focus_mark(R(page, "button", card))


def test_wf_lobby_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, new_player(base), size=PHONE) as page:
        click(R(page, "button", "Claim daily reward"))
        shows(page, R(page, "status", "Home notice"), "Daily reward claimed.")
        tops = [
            box_of(R(page, "link", "Profile"))["y"],
            box_of(R(page, "status", "Coins"))["y"],
            box_of(R(page, "status", "Home notice"))["y"],
            box_of(R(page, "button", "Play 1-on-1"))["y"],
            box_of(R(page, "button", "Tournaments"))["y"],
        ]
        assert tops == sorted(tops) and len(set(tops)) == len(tops)
        boxes = [box_of(R(page, "button", card)) for card in CARDS[:6]]
        assert columns(boxes) == 1
        assert [b["y"] for b in boxes] == sorted(b["y"] for b in boxes)
        last = R(page, "button", "Leaderboards")
        last.scroll_into_view_if_needed()
        expect(last).to_be_in_viewport()
        layout(page)
        big_targets(page)
        for size, count in ((TABLET, 2), (DESKTOP, 3)):
            page.set_viewport_size(size)
            eventually(page, lambda c=count: _has_columns(page, c))


def _has_columns(page: Page, count: int) -> None:
    assert columns([box_of(R(page, "button", card)) for card in CARDS[:6]]) == count


def service_worker_ready(page: Page) -> None:
    script = "() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller"
    try:
        until(page, script, seconds=WORKER_WAIT_S)
    except AssertionError:
        page.reload()
        until(page, script, seconds=WORKER_WAIT_S)


def check(locator: Locator) -> None:
    if not locator.is_checked():
        locator.click(force=True)
    eventually(locator.page, lambda: expect(locator).to_be_checked(timeout=QUICK_MS))


def carousel_still(page: Page) -> None:
    advance(page, MOTION_MS)
    settle(R(page, "region", "Stake tiers"))


def tiers_focused(page: Page) -> None:
    stage = R(page, "region", "Stake tiers")
    eventually(page, lambda: expect(stage).to_be_focused(timeout=QUICK_MS))


def ready_strike(page: Page) -> Locator:
    button = R(page, "button", "Strike")
    eventually(page, lambda: expect(button).to_be_enabled(timeout=QUICK_MS))
    return button


def flip(locator: Locator) -> None:
    locator.focus()
    locator.page.keyboard.press("Space")


def draws_to(page: Page, bar: Locator, value: float) -> None:
    def verify() -> None:
        assert number(bar) == value
    eventually(page, verify)


def whole_at_once(page: Page, bar: Locator, value: float) -> None:
    advance(page, TANGENT_SAMPLE_MS)
    deadline = time.monotonic() + RENDER_LAG_S
    while number(bar) != value:
        assert time.monotonic() < deadline, f"Tangent draw did not jump to {value}"


def await_player(page: Page) -> None:
    turn = R(page, "status", "Turn")
    spent = 0
    while (turn.text_content() or "").strip() not in ("Your turn", "Ball in hand"):
        assert spent <= AI_TURN_MAX_MS, "the AI turn ran past its limit"
        advance(page, AI_STEP_MS)
        spent += AI_STEP_MS


def test_wf_practice_offline_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = new_player(base)
    with signed_in(browser, base, player, worker=True) as page:
        see(page, R(page, "button", "Practice Offline"))
        service_worker_ready(page)
        before = me_of(page, base)
        page.context.set_offline(True)
        saw(page, "Offline")

        def marked() -> None:
            assert body_text(page).lower().count("offline") >= len(ONLINE_CARDS) + 1
        eventually(page, marked)
        page.reload()
        see(page, R(page, "button", "Practice Offline"))
        eventually(page, marked)
        for card in ONLINE_CARDS:
            expect(R(page, "button", card)).to_be_disabled()
        expect(R(page, "button", "Practice Offline")).to_be_enabled()
        calls: list[Any] = []
        page.on("request", lambda request: calls.append(request))
        click(R(page, "button", "Practice Offline"))
        at(page, "/practice")
        check(R(page, "radio", "Rookie"))
        click(R(page, "button", "Start rack"))
        at(page, "/practice/table")
        contains(page, R(page, "log", "Table announcements"), "Rookie is thinking")
        await_player(page)
        assert not [c.url for c in calls if "/api/" in c.url and c.method != "GET"]
        page.context.set_offline(False)
        after = me_of(page, base)
        for field in ("coins", "cash", "xp", "level", "wins", "losses"):
            assert after[field] == before[field]


def test_wf_practice_offline_turns(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/practice") as page:
        check(R(page, "radio", "Rookie"))
        click(R(page, "button", "Start rack"))
        log = R(page, "log", "Table announcements")
        contains(page, log, "Rookie is thinking")
        assert log.get_attribute("aria-live") in (None, "polite")
        shows(page, R(page, "status", "Turn"), "Rookie's turn")
        await_player(page)
        contains(page, log, "Rookie finished its turn")
        lines = log.inner_text()
        assert lines.index("Rookie is thinking") < lines.index("Rookie finished its turn")


def test_wf_practice_offline_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/practice") as page:
        group = R(page, "radiogroup", "Difficulty")
        see(page, group)
        tab_to(page, group)
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Space")
        chosen = [n for n in ("Rookie", "Regular", "Shark") if R(page, "radio", n).is_checked()]
        assert len(chosen) == 1
        start = R(page, "button", "Start rack")
        tab_to(page, start)
        page.keyboard.press("Enter")
        at(page, "/practice/table")
        contains(page, R(page, "log", "Table announcements"), f"{chosen[0]} is thinking")
        await_player(page)
        page.keyboard.press("ArrowRight")
        page.keyboard.down("Space")
        advance(page, POWER_FULL_MS / 2)
        page.keyboard.up("Space")
        contains(page, R(page, "region", "Shot receipt"), re.compile(r"First ball \d+\. Cut \d+\.\d°\.|No first ball\."))
        page.goto(base + "/practice")
        saw(page, "Resume your unfinished rack?")
        unfinished = R(page, "region", "Unfinished rack")
        see(page, R(unfinished, "button", "New rack"))
        resume = R(unfinished, "button", "Resume rack")
        resume.focus()
        page.keyboard.press("Enter")
        at(page, "/practice/table")
        see(page, R(page, "status", "Turn"))


def test_wf_practice_offline_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with worker_app(browser, base + "/home") as page:
        page.set_viewport_size(PHONE)
        see(page, R(page, "button", "Practice Offline"))
        service_worker_ready(page)
        page.context.set_offline(True)
        page.goto(base + "/practice")
        see(page, R(page, "radiogroup", "Difficulty"))
        layout(page)
        R(page, "radio", "Rookie").tap(force=True)
        expect(R(page, "radio", "Rookie")).to_be_checked()
        tap(R(page, "button", "Start rack"))
        at(page, "/practice/table")
        await_player(page)
        layout(page)
        contains(page, R(page, "region", "Scoreboard"), re.compile(r"\d+ balls? left"))
        contains(page, R(page, "region", "Scoreboard"), "Rookie")
        expect(R(page, "status", "Turn")).to_have_text(re.compile("Your turn|Ball in hand"))
        receipt = R(page, "region", "Shot receipt")
        tap(ready_strike(page))
        contains(page, receipt, re.compile(r"First ball \d+\.|No first ball\."))


def test_wf_stake_table_tiers(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, make_player(base, level=3, coins=300), "/play") as page:
        see(page, R(page, "region", "Stake tiers"))
        tiers_focused(page)
        for name, _, price, pot in TIERS.values():
            card = R(page, "group", name)
            contains(page, card, f"Entry {price:,}")
            contains(page, card, f"Pot {pot:,}")
        corner = R(page, "group", "Corner Bar")
        see(page, R(corner, "button", "Join table"))
        page.keyboard.press("ArrowRight")
        shows(page, R(page, "status", "Selected tier"), "Back Room")
        back_room = R(page, "group", "Back Room")
        contains(page, back_room, f"Short by {500 - 300} Coins")
        expect(R(back_room, "button", "Join table")).to_have_count(0)
        lower = R(back_room, "link", "Lower tier")
        see(page, lower)
        expect(R(back_room, "link", "Refill")).to_have_count(0)
        page.keyboard.press("ArrowRight")
        shows(page, R(page, "status", "Selected tier"), "Downtown")
        downtown = R(page, "group", "Downtown")
        contains(page, downtown, "Reach level 7")
        expect(R(downtown, "link", "Lower tier")).to_have_count(0)
        expect(R(downtown, "link", "Refill")).to_have_count(0)
        page.keyboard.press("ArrowLeft")
        shows(page, R(page, "status", "Selected tier"), "Back Room")
        carousel_still(page)
        click(lower)
        shows(page, R(page, "status", "Selected tier"), "Corner Bar")
    with signed_in(browser, base, make_player(base, level=3, coins=50), "/play") as page:
        contains(page, R(page, "group", "Corner Bar"), f"Short by {100 - 50} Coins")
        refill = R(R(page, "group", "Corner Bar"), "link", "Refill")
        see(page, refill)
        carousel_still(page)
        click(refill)
        at(page, "/home")
    locked = make_player(base, level=1, coins=50)
    with signed_in(browser, base, locked, "/play") as page:
        see(page, R(page, "region", "Stake tiers"))
        tiers_focused(page)
        page.keyboard.press("ArrowRight")
        shows(page, R(page, "status", "Selected tier"), "Back Room")
        contains(page, R(page, "group", "Back Room"), "Reach level 3")
        expect(R(R(page, "group", "Back Room"), "link", "Refill")).to_have_count(0)
        expect(R(R(page, "group", "Back Room"), "link", "Lower tier")).to_have_count(0)


def test_wf_stake_table_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base, level=20, coins=1000)
    with signed_in(browser, base, player, "/play?mode=no-guidelines") as page:
        stage = R(page, "region", "Stake tiers")
        see(page, stage)
        tiers_focused(page)
        eventually(page, lambda: expect(stage).to_be_focused(timeout=QUICK_MS))
        selected = R(page, "status", "Selected tier")
        shows(page, selected, "Corner Bar")
        page.keyboard.press("ArrowLeft")
        advance(page, MOTION_MS)
        expect(selected).to_have_text("Corner Bar")
        names = [tier[0] for tier in TIERS.values()]
        for name in names[1:]:
            page.keyboard.press("ArrowRight")
            shows(page, selected, name)
            advance(page, MOTION_MS)
        page.keyboard.press("ArrowRight")
        advance(page, MOTION_MS)
        expect(selected).to_have_text("The Penthouse")
        for name in reversed(names[:-1]):
            page.keyboard.press("ArrowLeft")
            shows(page, selected, name)
            advance(page, MOTION_MS)
        stage.focus()
        page.keyboard.press("Enter")
        queue = R(page, "status", "Queue")
        shows(page, queue, "Searching within 3 levels")
        cancel = R(page, "button", "Cancel")
        eventually(page, lambda: expect(cancel).to_be_focused(timeout=QUICK_MS))
        page.keyboard.press("ArrowRight")
        advance(page, MOTION_MS)
        expect(selected).to_have_text("Corner Bar")
        assert page.request.get(f"{base}/api/queue").json()["status"] == "queued"
        page.keyboard.press("Escape")
        saw(page, "Left the queue. No Coins moved.")
        eventually(page, lambda: expect(stage).to_be_focused(timeout=QUICK_MS))
        assert page.request.get(f"{base}/api/queue").json()["status"] == "none"
        page.keyboard.press("Enter")
        see(page, cancel)
        click(cancel)

        def left() -> None:
            assert page.request.get(f"{base}/api/queue").json()["status"] == "none"
        eventually(page, left)


def test_wf_stake_table_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, make_player(base, level=20), "/play", size=PHONE) as page:
        stage = R(page, "region", "Stake tiers")
        see(page, stage)
        tiers_focused(page)
        selected = R(page, "status", "Selected tier")
        card = R(page, "group", "Back Room")
        rest = sample(card)
        width = box_of(R(page, "group", "Corner Bar"))["width"]
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS / 2)
        before = sample(card)
        page.keyboard.press("ArrowLeft")
        after = sample(card)
        assert abs(left_edge(after) - left_edge(before)) < width / 2
        advance(page, MOTION_MS)
        settle(stage)
        expect(selected).to_have_text("Corner Bar")
        assert abs(left_edge(sample(card)) - left_edge(rest)) < width / 2
        box = box_of(R(page, "group", "Corner Bar"))
        middle = box["y"] + box["height"] / 2
        centre = PHONE["width"] / 2
        swipe(page, centre + width / 16, centre, middle)
        advance(page, MOTION_MS)
        expect(selected).to_have_text("Corner Bar")
        swipe(page, centre + width / 2, centre - width / 2, middle)
        shows(page, selected, "Back Room")
    player = make_player(base, level=20)
    with signed_in(browser, base, player, "/play", reduced_motion="reduce") as page:
        stage = R(page, "region", "Stake tiers")
        see(page, stage)
        tiers_focused(page)
        page.keyboard.press("ArrowRight")
        for running in animations(stage):
            assert running.get("duration", 0) < CROSSFADE_MAX_MS
        card = R(page, "group", "Back Room")
        moved = sample(card)
        settle(stage)
        advance(page, MOTION_MS)
        assert abs(left_edge(sample(card)) - left_edge(moved)) <= 1
        expect(R(page, "status", "Selected tier")).to_have_text("Back Room")


def test_wf_stake_table_pairing(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = new_player(base), new_player(base)
    with signed_in(browser, base, one, "/play") as first, signed_in(browser, base, two, "/play") as second:
        see(first, R(first, "region", "Stake tiers"))
        tiers_focused(first)
        see(second, R(second, "region", "Stake tiers"))
        tiers_focused(second)
        first.keyboard.press("Enter")
        see(first, R(first, "status", "Queue"))
        click(R(first, "button", "Cancel"))
        saw(first, "Left the queue. No Coins moved.")
        shows(first, R(first, "status", "Coins"), "1,000")
        assert me_of(first, base)["coins"] == 1000
        cancelled = first.request.get(f"{base}/api/wallet/ledger?currency=coins").json()["lines"]
        assert not [line for line in cancelled if line["kind"] == "match_entry"]
        stage = R(first, "region", "Stake tiers")
        eventually(first, lambda: expect(stage).to_be_focused(timeout=QUICK_MS))
        first.keyboard.press("Enter")

        def queued() -> None:
            assert first.request.get(f"{base}/api/queue").json()["status"] == "queued"
        eventually(first, queued)
        second.keyboard.press("Enter")
        address = at_table(first, PAIRING_S + SLACK_S)
        assert at_table(second, PAIRING_S + SLACK_S) == address
        shows(first, R(first, "status", "Coins"), "900")
        shows(second, R(second, "status", "Coins"), "900")
        assert second.request.get(f"{base}/api/queue").json() in (
            {"status": "paired", "tableUrl": address}, {"status": "none"},
        )
        table_id = address.rsplit("/", 1)[1]
        table = table_of(first, base, table_id)
        assert table["seats"][0]["playerId"] == one.id and table["activeSeat"] == 1
        assert table["seats"][1]["playerId"] == two.id and table["pot"] == 180
        lines = first.request.get(f"{base}/api/matches/{table_id}/ledger").json()["lines"]
        entries = [line for line in lines if line["kind"] == "match_entry"]
        assert sorted(line["amount"] for line in entries) == [-100, -100, 100, 100]
        first.reload()
        see(first, R(first, "status", "Turn"))
        assert first.evaluate("() => location.pathname") == address


def test_queue_guards(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    poor = make_player(base, coins=50).signin()
    refused = poor.post("/api/queue", {"mode": "eight-ball", "tier": 1})
    assert refused.status_code == 409 and refused.json()["error"] == "insufficient_coins"
    assert refused.json()["message"] == "Not enough Coins for this table."
    low = make_player(base, level=4).signin()
    refused = low.post("/api/queue", {"mode": "eight-ball", "tier": 2 + 1})
    assert refused.status_code == 403 and refused.json()["error"] == "level_locked"
    refused = low.post("/api/queue", {"mode": "no-guidelines", "tier": 1})
    assert refused.status_code == 403 and refused.json()["error"] == "mode_locked"
    assert low.post("/api/queue", {"mode": "eight-ball", "tier": 0}).status_code == 422
    assert low.delete("/api/queue").json()["error"] == "not_queued"
    assert low.me()["coins"] == 1000
    unlocked = make_player(base, level=5).signin()
    assert unlocked.post("/api/queue", {"mode": "no-guidelines", "tier": 1}).status_code == 201
    again = unlocked.post("/api/queue", {"mode": "no-guidelines", "tier": 1})
    assert again.status_code == 409 and again.json()["error"] == "already_queued"
    assert unlocked.delete("/api/queue").json() == {"status": "cancelled"}

    waiting = make_player(base, level=1).signin()
    distant = make_player(base, level=7).signin()
    assert waiting.post("/api/queue", {"mode": "nine-ball", "tier": 1}).status_code == 201
    assert distant.post("/api/queue", {"mode": "nine-ball", "tier": 1}).status_code == 201
    assert waiting.get("/api/queue").json() == {"status": "queued", "band": 3}

    def paired() -> str | None:
        state = waiting.get("/api/queue").json()
        return state.get("tableUrl")
    address = poll(paired, BAND_WIDEN_S + PAIRING_S + SLACK_S)
    assert distant.get("/api/queue").json().get("tableUrl") == address
    assert waiting.delete("/api/queue").json()["error"] == "already_paired"

    one, two = make_player(base).signin(), make_player(base).signin()
    stranger = make_player(base).signin()
    table_id, table_url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    assert one.get(f"/api/tables/{table_id}").json()["seatedHere"] is True
    other = call(base, "POST", "/api/auth/signin", {"email": one.email, "password": PASSWORD})
    cookie = session_cookie(other)
    view = call(base, "GET", f"/api/tables/{table_id}", cookie=cookie)
    assert view.status_code == 200 and view.json()["seatedHere"] is False
    shot = call(base, "POST", f"/api/tables/{table_id}/shots", shot_body(), cookie)
    assert shot.status_code == 409 and shot.json()["error"] == "other_device"
    assert shot.json()["message"] == "You're in a match on another device"
    placed = call(base, "POST", f"/api/tables/{table_id}/place", {"across": 50, "along": 25}, cookie)
    assert placed.status_code == 409 and placed.json()["error"] == "other_device"
    busy = one.post("/api/queue", {"mode": "eight-ball", "tier": 1})
    assert busy.status_code == 409 and busy.json()["error"] == "in_match"
    assert stranger.get(f"/api/tables/{table_id}").json()["error"] == "not_seated"
    with signed_in(browser, base, one, table_url) as page:
        heading = R(page, "heading", "You're in a match on another device")
        see(page, heading)
        expect(R(page, "region", "Shot controls")).to_have_count(0)
    with signed_in(browser, base, stranger, table_url) as page:
        see(page, R(page, "heading", "This table is private to its players."))
        page.goto(f"{base}/table/{tag()}")
        see(page, R(page, "heading", "Table not found"))


def test_wf_table_turns_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    script = [entry(2, [[2, "top-left"]]), entry(1)]
    table_id, url = make_table(base, [one, two], script, [1, 2, 8, 9, 10], phase="open")
    with signed_in(browser, base, one, url) as first, signed_in(browser, base, two, url) as second:
        shows(first, R(first, "status", "Turn"), "Your turn")
        shows(second, R(second, "status", "Turn"), f"{one.name}'s turn")
        board = R(second, "region", "Scoreboard")
        contains(second, board, "Open")
        contains(second, board, "Pot 180")
        click(ready_strike(first))
        shows(second, R(second, "status", "Rule banner"), f"{one.name} takes solids.")
        contains(second, board, "Solids")
        contains(second, board, "Stripes")
        contains(second, board, "1 ball left")
        log = R(second, "log", "Table announcements")
        contains(second, log, "Ball 2 potted in Top left.")
        expect(R(first, "status", "Turn")).to_have_text("Your turn")
        click(ready_strike(first))
        shows(second, R(second, "status", "Turn"), "Your turn")
        shows(first, R(first, "status", "Turn"), f"{two.name}'s turn")
        contains(second, log, "Legal shot: nothing potted.")
        table = table_of(second, base, table_id)
        assert table["activeSeat"] == 2 and table["seats"][0]["group"] == "solids"
        assert table["seats"][0]["ballsLeft"] == 1 and table["seats"][1]["ballsLeft"] == 2


def test_wf_table_turns_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    script = [entry(2, [[2, "top-left"]])]
    table_id, url = make_table(base, [one, two], script, [1, 2, 8, 9, 10], phase="open")
    with seated(browser, base, one, two, url, size=PHONE) as (first, second):
        shows(first, R(first, "status", "Turn"), "Your turn")
        shows(second, R(second, "status", "Turn"), f"{one.name}'s turn")
        board = R(second, "region", "Scoreboard")
        contains(second, board, "Open")
        layout(first)
        big_targets(first)
        tap(ready_strike(first))
        contains(second, board, "Solids")
        contains(second, board, "Stripes")
        contains(second, board, "1 ball left")
        contains(second, board, "2 balls left")
        contains(first, R(first, "region", "Scoreboard"), "Solids")
        shows(first, R(first, "status", "Turn"), "Your turn")
        shows(second, R(second, "status", "Turn"), f"{one.name}'s turn")
        layout(second)
        big_targets(second)
        assert table_of(second, base, table_id)["seats"][0]["group"] == "solids"


def test_wf_table_turns_foul(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], [entry(3, scratch=True)], [3, 8, 9])
    with seated(browser, base, one, two, url) as (first, second):
        click(ready_strike(first))
        ruling = "Foul: cue ball scratched."
        for page in (first, second):
            shows(page, R(page, "status", "Rule banner"), ruling)
            log = R(page, "log", "Table announcements")
            contains(page, log, f"{two.name} has ball in hand.")
            lines = log.inner_text()
            assert lines.index(ruling) < lines.index(f"{two.name} has ball in hand.")
            assert log.get_attribute("aria-live") in (None, "polite")
        shows(second, R(second, "status", "Turn"), "Ball in hand")
        shows(first, R(first, "status", "Turn"), f"{two.name}'s turn")
        see(second, R(second, "group", "Ball placement"))
        expect(R(first, "group", "Ball placement")).to_have_count(0)
        table = table_of(second, base, table_id)
        assert table["ballInHand"] is True and table["activeSeat"] == 2


def test_wf_table_turns_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    script = [entry(3, scratch=True), entry(9, [[9, "top-left"]])]
    table_id, url = make_table(base, [one, two], script, [3, 8, 9, 10])
    with seated(browser, base, one, two, url) as (first, second):
        names = tab_order(second, 16)
        for control in ("Aim angle", "Strike", "Shot power", "Lock aim"):
            assert not [name for name in names if control in name]
        expect(R(second, "region", "Shot controls")).to_have_count(0)
        second.keyboard.press("Space")
        advance(second, MOTION_MS)
        assert table_of(second, base, table_id)["activeSeat"] == 1
        R(first, "button", "Strike").focus()
        first.keyboard.press("Enter")
        shows(second, R(second, "status", "Turn"), "Ball in hand")
        names = [name for name in tab_order(second, 20)]
        published = [
            "Cue ball across", "Cue ball along", "Place ball", "Aim angle", "Fine aim",
            "Shot power", "Side spin", "Top spin", "Lock aim", "Strike", "Back to lobby",
        ]
        seen = [control for name in names for control in published if control.lower() in name.lower()]
        assert seen[: len(published)] == published
        placement = R(second, "group", "Ball placement")
        tab_to(second, R(placement, "button", "Place ball"))
        second.keyboard.press("Enter")
        shows(second, R(second, "status", "Turn"), "Your turn")
        second.keyboard.press("ArrowRight")
        second.keyboard.down("Space")
        advance(second, POWER_FULL_MS / 2)
        second.keyboard.up("Space")
        contains(second, R(second, "log", "Table announcements"), "Ball 9 potted in Top left.")
        assert 9 not in table_of(second, base, table_id)["balls"]
        names = tab_order(first, 16)
        assert not [name for name in names if "Strike" in name]


def test_server_shot_clock(browser: Browser, app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    one, two = make_player(base).signin(), make_player(base)
    with open_app(browser, base + "/home") as page:
        page.clock.set_fixed_time(SKEWED_CLOCK)
        assert page.request.post(
            f"{base}/api/auth/signin", data={"email": two.email, "password": PASSWORD}
        ).status == 200
        script = [entry(9, [[9, "top-left"]])]
        table_id, url = make_table(base, [one, two], script, [1, 2, 9, 10, 8])
        assert one.get(f"/api/tables/{table_id}").status_code == 200
        page.goto(base + url)
        clock = R(page, "timer", "Shot clock")
        shows(page, clock, re.compile(r"^\d+s$"), SHORT_TIMER_S)
        first_reading = int(clock.inner_text().strip()[:-1])
        assert first_reading <= SHORT_TIMER_S

        def ticked() -> None:
            current = int(clock.inner_text().strip()[:-1])
            assert current < first_reading
            server = one.get(f"/api/tables/{table_id}").json()["shotClockSeconds"]
            assert server is None or abs(current - server) <= 2
        eventually(page, ticked, SHORT_TIMER_S)

        def expired() -> dict[str, Any] | None:
            state = one.get(f"/api/tables/{table_id}").json()
            return state if state["activeSeat"] == 2 else None
        state = poll(expired, SHORT_TIMER_S + SLACK_S)
        assert state["ruleBanner"] == "Foul: shot clock expired." and state["ballInHand"] is True
        late = one.post(f"/api/tables/{table_id}/shots", shot_body())
        assert late.status_code == 409 and late.json()["error"] == "shot_clock_expired"
        assert late.json()["message"] == "Too late. The shot clock ran out."
        shows(page, R(page, "status", "Turn"), "Ball in hand")
        taken = page.request.post(f"{base}/api/tables/{table_id}/shots", data=shot_body())
        assert taken.status == 200, taken.text()
        later = one.post(f"/api/tables/{table_id}/shots", shot_body())
        assert later.status_code == 409 and later.json()["error"] == "not_your_turn"


def test_reconnect_returns_to_same_state(browser: Browser) -> None:
    base = env_url("APP_SHORT_URL")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with seated(browser, base, one, two, url) as (first, second):
        context = second.context
        second.close()

        def dropped() -> dict[str, Any] | None:
            state = table_of(first, base, table_id)
            return state if state["seats"][1]["connected"] is False else None
        state = poll(dropped, DROP_DETECT_S + SLACK_S)
        assert 0 < state["reconnectSeconds"] <= SHORT_TIMER_S
        see(first, R(first, "timer", "Reconnect"))
        saw(first, f"{two.name} dropped: ")
        back = context.new_page()
        back.goto(base + url)
        see(back, R(back, "status", "Turn"))

        def rejoined() -> dict[str, Any] | None:
            view = table_of(first, base, table_id)
            return view if view["seats"][1]["connected"] else None
        assert poll(rejoined, DROP_DETECT_S + SLACK_S)["reconnectSeconds"] is None
        assert back.evaluate("() => location.pathname") == url
        back.close()
        assert poll(dropped, DROP_DETECT_S + SLACK_S)["seats"][1]["connected"] is False

        def grace_over() -> dict[str, Any] | None:
            view = table_of(first, base, table_id)
            return view if not view["reconnectSeconds"] else None
        assert poll(grace_over, SHORT_TIMER_S + SLACK_S)["result"] is None


def test_both_dropped_voids_match(browser: Browser) -> None:
    base = env_url("APP_SHORT_URL")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with seated(browser, base, one, two, url) as (first, second):
        first_requests, second_requests = first.context.request, second.context.request
        first.close()
        second.close()

        def voided() -> dict[str, Any] | None:
            state = first_requests.get(f"{base}/api/tables/{table_id}").json()
            return state["result"]
        result = poll(voided, DROP_DETECT_S + SHORT_TIMER_S + SLACK_S)
        assert result["line"] == "Match voided: both entries returned."
        assert result["coinChange"] == f"Entry returned: {CORNER_ENTRY} Coins"
        for requests in (first_requests, second_requests):
            assert requests.get(f"{base}/api/me").json()["coins"] == 1000
        lines = first_requests.get(f"{base}/api/matches/{table_id}/ledger").json()["lines"]
        assert len([line for line in lines if line["kind"] == "match_refund"]) == 4
        assert sum(line["amount"] for line in lines if line["account"] == "escrow") == 0


def test_three_timeouts_forfeit(browser: Browser) -> None:
    base = env_url("APP_SHORT_URL")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], [entry(9), entry(9), entry(9)], [1, 2, 8, 9, 10])
    with seated(browser, base, one, two, url) as (first, second):
        shots = {"taken": 0}

        def play() -> dict[str, Any] | None:
            state = table_of(second, base, table_id)
            if state["result"]:
                return state["result"]
            if state["activeSeat"] == 2:
                reply = second.request.post(f"{base}/api/tables/{table_id}/shots", data=shot_body())
                assert reply.status == 200, reply.text()
                shots["taken"] += 1
            return None
        won = poll(play, SHORT_TIMER_S * 3 + SLACK_S * 2)
        assert won["line"] == f"You won: {one.name} forfeited."
        lost = table_of(first, base, table_id)["result"]
        assert lost["line"] == "You lost: forfeited after 3 timed-out turns."
        assert shots["taken"] == 2
        assert me_of(second, base)["wins"] == 1 and me_of(second, base)["coins"] == WINNER_COINS
        assert me_of(first, base)["losses"] == 1


WIN_SCRIPT = [entry(8, [[8, "bottom-right"]])]


def test_wf_match_result_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], WIN_SCRIPT, [8, 9])
    with seated(browser, base, one, two, url) as (first, second):
        shows(first, R(first, "status", "Rule banner"), "Call a pocket before you shoot.")
        expect(R(first, "button", "Strike")).to_be_disabled()
        check(R(first, "radio", "Bottom right"))
        click(ready_strike(first))
        won, lost = R(first, "dialog", "Match result"), R(second, "dialog", "Match result")
        see(first, won)
        see(second, lost)
        contains(first, won, "You won: 8 in the called pocket.")
        contains(second, lost, f"You lost: {one.name} potted the 8 in the called pocket.")
        contains(first, R(first, "status", "Coin change"), POT_WON)
        contains(second, R(second, "status", "Coin change"), ENTRY_LOST)
        contains(first, R(first, "status", "XP gained"), f"+{WIN_XP} XP")
        contains(second, R(second, "status", "XP gained"), f"+{LOSS_XP} XP")
        winner = table_of(first, base, table_id)["result"]
        loser = table_of(second, base, table_id)["result"]
        assert winner["line"] == "You won: 8 in the called pocket."
        assert winner["coinChange"] == POT_WON and winner["xpGained"] == WIN_XP
        assert loser["coinChange"] == ENTRY_LOST and loser["xpGained"] == LOSS_XP


def test_wf_match_result_reload(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    _, url = make_table(base, [one, two], WIN_SCRIPT, [8, 9])
    with seated(browser, base, one, two, url) as (first, second):
        check(R(first, "radio", "Bottom right"))
        click(ready_strike(first))
        see(first, R(first, "dialog", "Match result"))
        see(second, R(second, "dialog", "Match result"))
        record = [
            (first, f"{WINNER_COINS:,}", ["Wins 1", "Losses 0", "Win rate 100.0%", "Streak 1", "Highest pot 180"], WINNER_COINS, WIN_XP),
            (second, "900", ["Wins 0", "Losses 1", "Win rate 0.0%", "Streak 0", "Highest pot 0"], 900, 20),
        ]
        for page, chip, lines, coins, xp in record:
            page.goto(base + "/home")
            page.reload()
            shows(page, R(page, "status", "Coins"), chip)
            see(page, R(page, "progressbar", "XP"))
            saw(page, f"{xp} / 100 XP")
            page.goto(base + "/profile")
            page.reload()
            player_record = R(page, "region", "Player record")
            contains(page, player_record, "Level 1")
            for line in lines:
                contains(page, player_record, line)
            identity = me_of(page, base)
            assert (identity["coins"], identity["xp"], identity["level"]) == (coins, xp, 1)


def test_wf_match_result_called_pocket(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base), make_player(base)
    table_id, url = make_table(base, [one, two], WIN_SCRIPT, [8, 9])
    with seated(browser, base, one, two, url) as (first, _second):
        sentence = "Call a pocket before you shoot."
        strike = R(first, "button", "Strike")
        expect(strike).to_be_disabled()
        log = R(first, "log", "Table announcements")
        posted = log.inner_text().count(sentence)
        first.keyboard.down("Space")
        advance(first, POWER_FLAT_MS * 3)
        reads(first, R(first, "slider", "Shot power"), 50)
        first.keyboard.up("Space")
        eventually(first, lambda: _more_lines(log, sentence, posted))
        expect(R(first, "status", "Rule banner")).to_have_text(sentence)
        refused = first.request.post(f"{base}/api/tables/{table_id}/shots", data=shot_body())
        assert refused.status == 409 and refused.json()["error"] == "called_pocket_required"
        group = R(first, "radiogroup", "Called pocket")
        tab_to(first, group)
        target = R(first, "radio", "Bottom right")
        for _ in range(6):
            if target.is_checked():
                break
            first.keyboard.press("ArrowDown")
        expect(target).to_be_checked()
        eventually(first, lambda: expect(strike).to_be_enabled(timeout=QUICK_MS))
        tab_to(first, strike)
        first.keyboard.press("Enter")
        contains(first, R(first, "dialog", "Match result"), "You won: 8 in the called pocket.")
        assert table_of(first, base, table_id)["result"]["coins"] == WINNER_COINS


def _more_lines(log: Locator, sentence: str, before: int) -> None:
    assert log.inner_text().count(sentence) > before


def test_wf_match_result_reduced_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base, xp=90), make_player(base, coins=100)
    _, url = make_table(base, [one, two], WIN_SCRIPT, [8, 9])
    with seated(browser, base, one, two, url, reduced_motion="reduce") as (first, second):
        check(R(first, "radio", "Bottom right"))
        click(ready_strike(first))
        won, lost = R(first, "dialog", "Match result"), R(second, "dialog", "Match result")
        see(first, won)
        expect(R(first, "status", "Coin change")).to_contain_text(POT_WON)
        expect(R(first, "status", "XP gained")).to_contain_text(f"+{WIN_XP} XP")
        expect(won).to_contain_text(f"Level {1 + 1} reached: +5 Cash")
        see(second, lost)
        expect(R(lost, "button", "Rematch")).to_be_disabled()
        contains(second, lost, "Not enough Coins for a rematch.")
        expect(R(won, "button", "Rematch")).to_be_enabled()
        first.keyboard.press("Escape")
        advance(first, MOTION_MS)
        expect(won).to_be_visible()
        tab_stays_inside(first, won)
        identity = me_of(first, base)
        assert (identity["level"], identity["cash"], identity["xp"]) == (2, 5, 50)


def test_match_ledger_lines(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base, cash=5).signin(), make_player(base).signin()
    table_id, _ = make_table(base, [one, two], [entry(8, [[8, "top-left"]])], [8, 9])
    assert two.get(f"/api/tables/{table_id}").status_code == 200
    assert one.post(f"/api/tables/{table_id}/shots", shot_body("top-left")).status_code == 200
    repeat = one.post(f"/api/tables/{table_id}/shots", shot_body("top-left"))
    assert repeat.status_code == 409 and repeat.json()["error"] == "match_over"
    lines = one.get(f"/api/matches/{table_id}/ledger").json()["lines"]
    pairs: dict[str, list[dict[str, Any]]] = {}
    for line in lines:
        assert line["currency"] == "coins"
        pairs.setdefault(line["pairId"], []).append(line)
        if line["account"] != "wallet":
            assert line["playerId"] is None
    assert len(pairs) == 4
    for pair in pairs.values():
        assert len(pair) == 2 and sum(line["amount"] for line in pair) == 0
    shapes = sorted(
        (line["kind"], line["account"], line["amount"]) for line in lines
    )
    assert shapes == sorted([
        ("match_entry", "wallet", -100), ("match_entry", "escrow", 100),
        ("match_entry", "wallet", -100), ("match_entry", "escrow", 100),
        ("match_win", "escrow", -180), ("match_win", "wallet", 180),
        ("house_cut", "escrow", -20), ("house_cut", "house", 20),
    ])
    assert sum(line["amount"] for line in lines if line["account"] == "escrow") == 0
    winner = [line for line in lines if line["kind"] == "match_win" and line["account"] == "wallet"]
    assert winner[0]["playerId"] == one.id
    for player, coins in ((one, WINNER_COINS), (two, 900)):
        balance, total, _ = ledger_sum(player, "coins")
        assert balance == total == coins == player.me()["coins"]
    balance, total, _ = ledger_sum(one, "cash")
    assert balance == total == 5
    other = make_player(base).signin()
    assert other.get(f"/api/matches/{table_id}/ledger").json()["error"] == "not_seated"


def test_profile_lists_ledger_lines(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base).signin()
    assert player.post(item_path("cue-ash-break", "buy")).status_code == 201
    with signed_in(browser, base, player, "/profile") as page:
        ledger = R(page, "table", "Ledger")
        see(page, ledger)
        rows = ledger.get_by_role("row")
        contains(page, rows.nth(1), "Cue purchase")
        contains(page, rows.nth(1), "-400 Coins")
        contains(page, rows.nth(1), "600 Coins")
        expect(rows.nth(1)).to_contain_text(re.compile(r"\d{4}-\d{2}-\d{2}"))
        contains(page, rows.nth(2), "+1,000 Coins")


def test_wf_shop_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base)
    with signed_in(browser, base, player, "/shop") as page:
        click(R(page, "button", "Ash Break"))
        dialog = R(page, "dialog", "Ash Break")
        see(page, dialog)
        click(R(dialog, "button", "Buy for 400 Coins"))
        shows(page, R(page, "status", "Shop notice"), "Bought Ash Break.")
        assert me_of(page, base)["coins"] == ASH_BREAK_COINS
        equip = R(dialog, "button", "Equip")
        eventually(page, lambda: expect(equip).to_be_focused(timeout=QUICK_MS))
        expect(R(dialog, "button", "Buy for 400 Coins")).to_have_count(0)
        saw(page, "Owned")
        click(equip)
        shows(page, R(page, "status", "Shop notice"), "Equipped Ash Break.")
        eventually(page, lambda: expect(equip).to_be_disabled(timeout=QUICK_MS))
        shop = page.request.get(f"{base}/api/shop").json()
        item = next(i for i in shop["items"] if i["id"] == "cue-ash-break")
        assert item["owned"] is True and item["equipped"] is True
        assert me_of(page, base)["equippedCueId"] == "cue-ash-break"
        again = page.request.post(f"{base}/api/shop/items/cue-ash-break/buy")
        assert again.status == 409 and again.json()["error"] == "already_owned"
        assert me_of(page, base)["coins"] == ASH_BREAK_COINS
        click(R(dialog, "button", "Close"))
        closed(page, dialog)
        shows(page, R(page, "status", "Coins"), "600")
    racer = make_player(base).signin()
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(lambda _: racer.post(item_path("cue-ash-break", "buy")), range(4)))
    assert sorted(r.status_code for r in replies) == [201, 409, 409, 409]
    assert racer.me()["coins"] == ASH_BREAK_COINS

    rich = make_player(base, level=20, coins=80000).signin()
    rival = make_player(base).signin()
    finish = [entry(8, [[8, "top-left"]])]
    live_id, _ = make_table(base, [rich, rival], finish, [8, 9])
    assert rich.post(item_path("cue-long-rail-master", "buy")).status_code == 201
    assert rich.post(item_path("cue-long-rail-master", "equip")).status_code == 200
    clock = rich.get(f"/api/tables/{live_id}").json()["shotClockSeconds"]
    assert clock <= DEFAULT_SHOT_CLOCK_S
    assert rich.post(f"/api/tables/{live_id}/shots", shot_body("top-left")).status_code == 200
    next_id, _ = make_table(base, [rich, rival], finish, [8, 9])
    assert rich.get(f"/api/tables/{next_id}").json()["shotClockSeconds"] > DEFAULT_SHOT_CLOCK_S


def test_wf_shop_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, new_player(base), "/shop") as page:
        cues = R(page, "tab", "Cues")
        see(page, cues)
        cues.focus()
        page.keyboard.press("ArrowRight")
        expect(R(page, "tab", "Cash cues")).to_be_focused()
        expect(R(page, "tab", "Cash cues")).to_have_attribute("aria-selected", "true")
        see(page, R(page, "button", "Brass Inlay"))
        page.keyboard.press("ArrowLeft")
        expect(cues).to_have_attribute("aria-selected", "true")
        item = R(page, "button", "Ash Break")
        see(page, item)
        item.focus()
        page.keyboard.press("Enter")
        dialog = R(page, "dialog", "Ash Break")
        see(page, dialog)
        tab_stays_inside(page, dialog)
        page.keyboard.press("Escape")
        closed(page, dialog)
        eventually(page, lambda: expect(item).to_be_focused(timeout=QUICK_MS))


def test_wf_shop_exact_text(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, make_player(base, coins=100), "/shop") as page:
        notice = R(page, "status", "Shop notice")
        click(R(page, "button", "Ash Break"))
        dialog = R(page, "dialog", "Ash Break")
        see(page, dialog)
        shows(page, notice, f"You need {400 - 100} more Coins.")
        expect(R(dialog, "button", "Buy for 400 Coins")).to_be_disabled()
        compare = R(dialog, "region", "Compare")
        for row in ("Aim +5%", "Power +2%", "Spin +0%", "Time +0 s", "Equipped: Starter Cue", "Aim +0%", "Power +0%"):
            contains(page, compare, row)
        click(R(dialog, "button", "Close"))
        closed(page, dialog)
        eventually(page, lambda: expect(notice).not_to_contain_text("You need", timeout=QUICK_MS))
        click(R(page, "button", "Copper Ferrule"))
        dialog = R(page, "dialog", "Copper Ferrule")
        see(page, dialog)
        shows(page, notice, "Reach level 3 to buy this.")
        expect(R(dialog, "button", "Buy for 1,500 Coins")).to_be_disabled()
        click(R(dialog, "button", "Close"))
        closed(page, dialog)
        click(R(page, "tab", "Cash cues"))
        click(R(page, "button", "Brass Inlay"))
        dialog = R(page, "dialog", "Brass Inlay")
        see(page, dialog)
        shows(page, notice, "You need 40 more Cash.")
    with signed_in(browser, base, make_player(base, level=20, coins=100), "/shop") as page:
        click(R(page, "button", "Long Rail Master"))
        see(page, R(page, "dialog", "Long Rail Master"))
        shows(page, R(page, "status", "Shop notice"), f"You need {75000 - 100:,} more Coins.")


def test_wf_shop_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    names = ["Starter Cue", "Ash Break", "Copper Ferrule", "Night Maple", "Velvet Taper", "Long Rail Master"]
    with signed_in(browser, base, new_player(base), "/shop", size=PHONE) as page:
        see(page, R(page, "button", "Ash Break"))
        for size, count in ((PHONE, 1), (TABLET, 2), (DESKTOP, 4)):
            page.set_viewport_size(size)

            def grid(expected: int = count) -> None:
                assert columns([box_of(R(page, "button", n)) for n in names]) == expected
            eventually(page, grid)
            layout(page)
        page.set_viewport_size(PHONE)
        click(R(page, "button", "Ash Break"))
        compare = R(page, "region", "Compare")
        see(page, compare)
        contains(page, compare, "Aim +5%")
        layout(page)


def test_wf_cash_pack_happy(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    direct = app_url.rstrip("/")
    email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
    with relayed(direct) as relay, open_app(browser, relay.url + "/home") as page:
        base = relay.url
        created = page.request.post(
            f"{base}/api/auth/signup",
            data={"email": email, "password": PASSWORD, "displayName": name, "birthYear": ADULT_YEAR},
        )
        assert created.status == 201
        player_id = created.json()["id"]
        found = mail_to(mail, email, "Verify your Long Rail email")
        assert len(found) == 1
        page.goto(f"{base}/verify?token={verify_token(found[0])}")
        see(page, R(page, "heading", "Email verified"))
        assert me_of(page, base)["emailVerified"] is True
        page.goto(f"{base}/verify?token={verify_token(found[0])}")
        saw(page, "This link is no longer valid.")
        page.goto(base + "/shop")
        click(R(page, "tab", "Cash packs"))
        click(R(page, "button", "Buy Chalk Pack"))
        dialog = R(page, "dialog", "Buy Cash")
        see(page, dialog)
        contains(page, dialog, "Chalk Pack")
        contains(page, dialog, "50")
        pay = R(dialog, "button", "Pay $0.99")
        notice = R(page, "status", "Shop notice")
        watcher = Player(direct, player_id, email, name).signin()
        relay.hold()
        click(pay)
        shows(page, notice, "Confirming")
        expect(pay).to_be_disabled()
        expect(R(dialog, "button", "Cancel")).to_be_disabled()
        page.keyboard.press("Escape")
        advance(page, MOTION_MS)
        expect(dialog).to_be_visible()
        assert watcher.me()["cash"] == 0
        assert purchases(killbill, email) == []
        relay.release()
        shows(page, notice, f"Cash added: 50 Cash. Receipt sent to {email}.")
        closed(page, dialog)
        shows(page, R(page, "status", "Cash"), "50")
        assert me_of(page, base)["cash"] == 50
        lines = page.request.get(f"{base}/api/wallet/ledger?currency=cash").json()["lines"]
        assert [line["amount"] for line in lines if line["kind"] == "cash_purchase"] == [50]
    account = killbill.account_by_key(player_id)
    assert account is not None and account["email"] == email
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"
    paid = purchases(killbill, email)
    assert len(paid) == 1
    assert float(paid[0]["amount"]) == 0.99 and paid[0]["currency"] == "USD"
    assert paid[0]["status"].lower() == "success"
    receipts = mail_to(mail, email, "Your Long Rail receipt")
    assert len(receipts) == 1
    body = text(receipts[0])
    for fact in ("Chalk Pack", "50", "$0.99", paid[0]["paymentId"]):
        assert fact in body


def test_wf_cash_pack_keyboard(browser: Browser, app_url: str, killbill: KillBill) -> None:
    base = app_url.rstrip("/")
    player = make_player(base)
    with signed_in(browser, base, player, "/shop") as page:
        click(R(page, "tab", "Cash packs"))
        opener = R(page, "button", "Buy Chalk Pack")
        see(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = R(page, "dialog", "Buy Cash")
        see(page, dialog)
        tab_stays_inside(page, dialog)
        page.keyboard.press("Escape")
        closed(page, dialog)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        assert purchases(killbill, player.email) == []
        page.keyboard.press("Enter")
        see(page, dialog)
        pay = R(dialog, "button", "Pay $0.99")
        tab_to(page, pay)
        page.keyboard.press("Enter")
        notice = R(page, "status", "Shop notice")
        shows(page, notice, f"Cash added: 50 Cash. Receipt sent to {player.email}.")
        assert notice.get_attribute("aria-live") in (None, "polite")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
    assert len(purchases(killbill, player.email)) == 1


def test_wf_cash_pack_eligibility(browser: Browser, app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    base = app_url.rstrip("/")
    minor = make_player(base, birth_year=MINOR_YEAR, verified=False)
    with signed_in(browser, base, minor, "/shop") as page:
        click(R(page, "tab", "Cash packs"))
        shows(page, R(page, "status", "Shop notice"), "Players under 18 cannot buy Cash.")
        saw(page, "Chalk Pack")
        saw(page, "$0.99")
        expect(R(page, "button", "Buy Chalk Pack")).to_have_count(0)
        expect(R(page, "button", "Resend verification")).to_have_count(0)
        refused = page.request.post(
            f"{base}/api/shop/cash-packs/pack-chalk/purchase",
            headers={"Idempotency-Key": idempotency_key()},
        )
        assert refused.status == 403 and refused.json()["error"] == "age_restricted"
    assert killbill.account(minor.email) is None

    adult = make_player(base, verified=False)
    with signed_in(browser, base, adult, "/shop") as page:
        click(R(page, "tab", "Cash packs"))
        shows(page, R(page, "status", "Shop notice"), "Verify your email to buy Cash.")
        expect(R(page, "button", "Buy Chalk Pack")).to_have_count(0)
        refused = page.request.post(
            f"{base}/api/shop/cash-packs/pack-chalk/purchase",
            headers={"Idempotency-Key": idempotency_key()},
        )
        assert refused.status == 403 and refused.json()["error"] == "email_unverified"
        click(R(page, "button", "Resend verification"))
        shows(page, R(page, "status", "Shop notice"), f"Verification email sent to {adult.email}.")
        found = mail_to(mail, adult.email, "Verify your Long Rail email")
        assert len(found) == 1
        verified = page.request.post(f"{base}/api/auth/verify", data={"token": verify_token(found[0])})
        assert verified.status == 200 and verified.json() == {"emailVerified": True}
        again = page.request.post(f"{base}/api/auth/resend-verification")
        assert again.status == 409 and again.json()["error"] == "already_verified"
    assert killbill.account(adult.email) is None


def test_wf_cash_pack_outage(browser: Browser, app_url: str, killbill: KillBill) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    player = make_player(base)
    with signed_in(browser, base, player, "/shop") as page:
        click(R(page, "tab", "Cash packs"))
        click(R(page, "button", "Buy Chalk Pack"))
        dialog = R(page, "dialog", "Buy Cash")
        click(R(dialog, "button", "Pay $0.99"))
        notice = R(page, "status", "Shop notice")
        sentence = "Payments are down. You have not been charged."
        shows(page, notice, sentence)
        closed(page, dialog)
        advance(page, MOTION_MS * 3)
        expect(notice).to_have_text(sentence)
        expect(R(page, "status", "Cash")).to_have_text("0")
        key = idempotency_key()
        refused = page.request.post(
            f"{base}/api/shop/cash-packs/pack-chalk/purchase", headers={"Idempotency-Key": key}
        )
        assert refused.status == 503 and refused.json() == {"error": "payments_unavailable", "message": sentence}
        assert me_of(page, base)["cash"] == 0
        click(R(page, "tab", "Cues"))
        click(R(page, "button", "Ash Break"))
        dialog = R(page, "dialog", "Ash Break")
        click(R(dialog, "button", "Buy for 400 Coins"))
        shows(page, R(page, "status", "Shop notice"), "Bought Ash Break.")
    assert killbill.account(player.email) is None
    primary = Player(app_url.rstrip("/"), player.id, player.email, player.name).signin()
    retry = primary.post(pack_path("pack-chalk"), headers={"Idempotency-Key": key})
    assert retry.status_code == 201, retry.text
    assert primary.me()["cash"] == 50


def test_cash_pack_idempotent_credit(app_url: str, mail: Mailpit, killbill: KillBill) -> None:
    base = app_url.rstrip("/")
    player = make_player(base).signin()
    key = {"Idempotency-Key": idempotency_key()}
    first = player.post(pack_path("pack-rack"), headers=key)
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["status"] == "confirmed" and body["cash"] == 120 and body["receipt"] == "sent"
    paid = purchases(killbill, player.email)
    assert [p["paymentId"] for p in paid] == [body["paymentId"]]
    assert float(paid[0]["amount"]) == 1.99
    replay = player.post(pack_path("pack-rack"), headers=key)
    assert replay.status_code == 200 and replay.json() == body
    conflict = player.post(pack_path("pack-chalk"), headers=key)
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_conflict"
    missing = player.post(pack_path("pack-chalk"))
    assert missing.status_code == 422
    assert player.me()["cash"] == 120
    assert len(purchases(killbill, player.email)) == 1
    assert len(mail_to(mail, player.email, "Your Long Rail receipt")) == 1

    racer = make_player(base).signin()
    shared = {"Idempotency-Key": idempotency_key()}
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(
            lambda _: racer.post(pack_path("pack-chalk"), headers=shared), range(4)
        ))
    assert sorted(r.status_code for r in replies) == [200, 200, 200, 201]
    assert len({r.json()["paymentId"] for r in replies}) == 1
    assert racer.me()["cash"] == 50
    assert len(purchases(killbill, racer.email)) == 1


def befriend(one: Player, two: Player) -> None:
    code = two.me()["friendCode"]
    request = one.post("/api/friends/requests", {"code": code})
    assert request.status_code == 201, request.text
    accepted = two.post(f"/api/friends/requests/{request.json()['requestId']}/accept")
    assert accepted.status_code == 200, accepted.text


def test_wf_friends_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = new_player(base).signin(), new_player(base).signin()
    code = two.me()["friendCode"]
    assert re.fullmatch(r"[A-Z0-9]{8}", code)
    with signed_in(browser, base, one) as first, signed_in(browser, base, two) as second:
        panel = open_friends(first)
        fill(R(panel, "textbox", "Friend code"), "ZZZZZZZZ")
        click(R(panel, "button", "Send request"))
        shows(first, R(first, "status", "Friends notice"), "No player has that code.")
        fill(R(panel, "textbox", "Friend code"), code)
        click(R(panel, "button", "Send request"))
        shows(first, R(first, "status", "Friends notice"), f"Request sent to {two.name}.")
        second.reload()
        open_friends(second)
        accept = R(second, "button", f"Accept {one.name}")
        see(second, accept)
        click(accept)
        shows(second, R(second, "status", "Friends notice"), f"{one.name} is now your friend.")
        contains(second, R(second, "list", "Friends list"), one.name)
    assert [f["id"] for f in one.get("/api/friends").json()["friends"]] == [two.id]
    assert [f["id"] for f in two.get("/api/friends").json()["friends"]] == [one.id]
    stranger = new_player(base).signin()
    assert two.post(f"/api/friends/{stranger.id}/block").status_code == 204
    blocked = stranger.post("/api/friends/requests", {"code": code})
    assert blocked.status_code == 403 and blocked.json()["error"] == "blocked"
    assert blocked.json()["message"] == "You can't add this player."


def test_wf_friends_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = new_player(base).signin(), new_player(base).signin()
    befriend(one, two)
    with signed_in(browser, base, one) as host:
        open_friends(host)
        row = R(host, "list", "Friends list").get_by_role("listitem").filter(has_text=two.name)
        contains(host, row, "Offline")
        with signed_in(browser, base, two) as friend:
            contains(host, row, "Online", PRESENCE_S + SLACK_S)
            friend.close()
            contains(host, row, "Offline", PRESENCE_S + SLACK_S)
            friend = friend.context.new_page()
            friend.goto(base + "/home")
            contains(host, row, "Online", PRESENCE_S + SLACK_S)
            click(R(host, "button", "Create private table"))
            address = at_table(host)
            saw(host, "Waiting for your friend")
            link = R(host, "textbox", "Invite link").input_value()
            token = re.search(r"/invite/([^/?#\s]+)", link)
            assert token, link
            see(host, R(host, "button", "Copy link"))
            friend.goto(f"{base}/invite/{token.group(1)}")
            assert at_table(friend) == address
            see(friend, R(friend, "status", "Turn"))
            friend.reload()
            see(friend, R(friend, "status", "Turn"))
            assert friend.evaluate("() => location.pathname") == address
            state = table_of(host, base, address.rsplit("/", 1)[1])
            assert [seat["playerId"] for seat in state["seats"]] == [one.id, two.id]


SLIDE_WATCH = """() => { window.__slid = []; const note = target => window.__slid.push(target);
    document.addEventListener("transitionrun", event => {
        if (/transform|translate|left|right|inset|margin/.test(event.propertyName)) note(event.target);
    }, true);
    document.addEventListener("animationstart", event => note(event.target), true);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) { note(this); return animate.apply(this, args); }; }"""


def slid(panel: Locator) -> bool:
    return panel.evaluate("e => window.__slid.some(target => target === e || target.contains(e))")


def test_wf_friends_panel_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with signed_in(browser, base, new_player(base), size=DESKTOP) as page:
        opener = R(page, "button", "Friends")
        see(opener.page, opener)
        page.evaluate(SLIDE_WATCH)
        click(opener)
        panel = R(page, "region", "Friends")
        see(page, panel)
        start = sample(panel)
        advance(page, MOTION_MS)
        settle(panel)
        assert slid(panel) or left_edge(start) > left_edge(sample(panel))
        box = box_of(panel)
        assert abs(box["width"] - DESKTOP["width"] / 3) <= DESKTOP["width"] * 0.05
        assert abs(box["x"] + box["width"] - DESKTOP["width"]) <= 1
        expect(opener).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("Escape")
        closed(page, panel)
        advance(page, MOTION_MS)
        names = tab_order(page, 16)
        assert not [n for n in names if "Close friends" in n or "Send request" in n]
        opener.focus()
        page.keyboard.press("Enter")
        see(page, panel)
        advance(page, STEP_MS / 2)
        width = box_of(panel)["width"]
        before = sample(panel)
        handle = panel.element_handle()
        page.keyboard.press("Escape")
        after = handle.bounding_box() or {"x": before["x"]}
        assert abs(left_edge(after) - left_edge(before)) < width / 2
        opener.focus()
        page.keyboard.press("Enter")
        advance(page, MOTION_MS * 2)
        settle(panel)
        expect(panel).to_be_visible()
        expect(panel).to_be_in_viewport()
        page.keyboard.press("Escape")
        closed(page, panel)
        for size in (PHONE, TABLET):
            page.set_viewport_size(size)
            layout(page)
            names = tab_order(page, 16)
            assert not [n for n in names if "Close friends" in n]


def test_wf_friends_invite_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    host = new_player(base).signin()
    created = host.post("/api/private-tables")
    assert created.status_code == 201, created.text
    table_url, invite = created.json()["tableUrl"], created.json()["inviteUrl"]
    token = invite.rsplit("/", 1)[1]
    assert call(base, "GET", f"/api/invites/{token}").json() == {"status": "open", "hostName": host.name}
    email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
    with open_app(browser, f"{base}/invite/{token}") as page:
        page.set_viewport_size(PHONE)
        saw(page, "Sign up to join the table")
        sheet = sign_up_form(page, email, name, ADULT_YEAR)
        click(R(sheet, "button", "Create account"))
        at(page, table_url)
        see(page, R(page, "status", "Turn"))
        page.reload()
        see(page, R(page, "status", "Turn"))
        assert page.evaluate("() => location.pathname") == table_url
        layout(page)
    seats = host.get(f"/api/tables/{table_url.rsplit('/', 1)[1]}").json()["seats"]
    assert seats[1]["displayName"] == name

    short = env_url("APP_SHORT_URL")
    late_host = new_player(short).signin()
    late = late_host.post("/api/private-tables").json()["inviteUrl"].rsplit("/", 1)[1]
    assert poll(lambda: call(short, "GET", f"/api/invites/{late}").status_code == 410, SHORT_TIMER_S + SLACK_S)
    assert call(short, "GET", f"/api/invites/{late}").json()["error"] == "invite_expired"
    with open_app(browser, f"{short}/invite/{late}") as page:
        page.set_viewport_size(PHONE)
        see(page, R(page, "heading", "Expired"))


def make_club(base: str, wins: int = 0) -> tuple[Player, str, str]:
    owner = make_player(base, level=5, coins=5000, weekly_wins=wins).signin()
    name = f"Club {tag()}"
    created = owner.post("/api/clubs", {"name": name, "joinPolicy": "open"})
    assert created.status_code == 201, created.text
    return owner, name, created.json()["id"]


def test_wf_clubs_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, club_name, club_id = make_club(base, wins=5)
    assert owner.me()["coins"] == 0
    balance, total, lines = ledger_sum(owner, "coins")
    assert balance == total == 0 and [l["amount"] for l in lines if l["kind"] == "club_fee"] == [-5000]
    member = make_player(base, weekly_wins=3)
    with signed_in(browser, base, member, "/clubs") as page:
        click(R(page, "button", f"Join {club_name}"))
        saw(page, f"Joined {club_name}.")
        page.goto(f"{base}/clubs/{club_id}")
        shows(page, R(page, "status", "Weekly score"), "Weekly score 8")
        shows(page, R(page, "status", "Members"), "2 / 50")
        roster = R(page, "list", "Roster")
        contains(page, roster, member.name)
        contains(page, roster, owner.name)
        contains(page, roster, "owner")
        click(R(page, "button", "Leave club"))
        saw(page, f"Left {club_name}.")
        body = owner.get(f"/api/clubs/{club_id}").json()
        assert body["weeklyScore"] == 5 and body["memberCount"] == 1
        page.goto(base + "/clubs")
        join = R(page, "button", "Join Full House Hall")
        see(page, join)
        if join.is_enabled():
            click(join)
        saw(page, "Club is full")
        full = next(c for c in page.request.get(f"{base}/api/clubs").json()["clubs"] if c["name"] == "Full House Hall")
        assert full["memberCount"] == 50
        refused = page.request.post(f"{base}/api/clubs/{full['id']}/join")
        assert refused.status == 409 and refused.json()["error"] == "club_full"
    other = make_player(base).signin()
    assert other.post(f"/api/clubs/{club_id}/join").json() == {"status": "member"}
    with signed_in(browser, base, owner, f"/clubs/{club_id}") as page:
        click(R(page, "button", "Leave club"))
        shows(page, R(page, "status", "Club notice"), "Owners must hand over the club before leaving.")
        refused = page.request.post(f"{base}/api/clubs/{club_id}/leave")
        assert refused.status == 409 and refused.json()["error"] == "owner_must_transfer"


def test_wf_clubs_messages(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, _, club_id = make_club(base)
    member = make_player(base).signin()
    assert member.post(f"/api/clubs/{club_id}/join").status_code == 200
    path = f"/clubs/{club_id}"
    with signed_in(browser, base, owner, path) as first, signed_in(browser, base, member, path) as second:
        see(second, R(second, "group", "Preset messages"))
        click(R(R(first, "group", "Preset messages"), "button", "Nice shot"))
        contains(second, R(second, "log", "Club messages"), f"{owner.name}: Nice shot")
    assert member.post(f"/api/clubs/{club_id}/messages", {"preset": "free text"}).status_code == 422
    assert "Nice shot" in json.dumps(owner.get(f"/api/clubs/{club_id}").json()["messages"])
    outsider = make_player(base).signin()
    assert outsider.post(f"/api/clubs/{club_id}/messages", {"preset": "Nice shot"}).status_code == 403


def test_wf_clubs_roles(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    owner, _, club_id = make_club(base)
    member = make_player(base).signin()
    assert member.post(f"/api/clubs/{club_id}/join").status_code == 200
    with signed_in(browser, base, owner, f"/clubs/{club_id}") as page:
        opener = R(page, "button", f"Change role for {member.name}")
        see(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu")
        see(page, menu)
        eventually(page, lambda: expect(R(page, "menuitem", "Make owner")).to_be_focused(timeout=QUICK_MS))
        page.keyboard.press("ArrowDown")
        expect(R(page, "menuitem", "Make officer")).to_be_focused()
        page.keyboard.press("Escape")
        closed(page, menu)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        roles = owner.get(f"/api/clubs/{club_id}").json()["members"]
        assert next(m for m in roles if m["playerId"] == member.id)["role"] == "member"
        page.keyboard.press("Enter")
        see(page, menu)
        eventually(page, lambda: expect(R(page, "menuitem", "Make owner")).to_be_focused(timeout=QUICK_MS))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        notice = R(page, "status", "Club notice")
        shows(page, notice, f"{member.name} is now officer.")
        assert notice.get_attribute("aria-live") in (None, "polite")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        roles = owner.get(f"/api/clubs/{club_id}").json()["members"]
        assert next(m for m in roles if m["playerId"] == member.id)["role"] == "officer"
    refused = member.patch(f"/api/clubs/{club_id}/members/{owner.id}", {"role": "member"})
    assert refused.status_code == 403


def test_wf_clubs_leaderboard_phone(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    for _ in range(BOARD_PLAYERS):
        make_player(base, weekly_wins=4)
    player = make_player(base, weekly_wins=3)
    with signed_in(browser, base, player, "/leaderboards", size=PHONE) as page:
        click(R(page, "tab", "Global"))
        contains(page, R(page, "table", "Weekly wins"), "Mara Quill")
        own = page.request.get(f"{base}/api/leaderboards?scope=global").json()["own"]
        assert own["wins"] == 3
        rank = R(page, "region", "Your rank")
        contains(page, rank, f"#{own['rank']} {player.name} 3 wins")
        layout(page)
        expect(rank).to_be_in_viewport()
        rows = R(page, "table", "Weekly wins").get_by_role("row")
        top = box_of(rows.nth(1))["y"]
        rows.last.scroll_into_view_if_needed()
        assert box_of(rows.nth(1))["y"] < top, "the board never scrolled"
        expect(rank).to_be_in_viewport()
        rows.nth(1).scroll_into_view_if_needed()
        expect(rank).to_be_in_viewport()
        tap(R(page, "tab", "Club"))
        saw(page, "Join a club to see this board.")
        layout(page)
    with signed_in(browser, base, make_player(base), "/leaderboards", size=PHONE) as page:
        contains(page, R(page, "region", "Your rank"), "Unranked")
        tap(R(page, "tab", "Friends"))
        saw(page, "No friends on the board yet.")


def test_wf_tournaments_happy(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    player = make_player(base, level=3)
    with signed_in(browser, base, player, "/tournaments") as page:
        click(R(page, "button", "Register for Back Room"))
        saw(page, "Registered. 500 Coins moved to the bracket.")
        shows(page, R(page, "status", "Coins"), "500")
        lines = page.request.get(f"{base}/api/wallet/ledger?currency=coins").json()["lines"]
        spent = [line for line in lines if line["kind"] == "tournament_entry"]
        assert [line["amount"] for line in spent] == [-500]
        bracket_id = spent[0]["refId"]
        listed = page.request.get(f"{base}/api/tournaments/{bracket_id}")
        if listed.status != 200:
            mine = page.request.get(f"{base}/api/tournaments").json()["tournaments"]
            listed = next(t for t in mine if t["tier"] == 2)
            bracket_id = listed["id"]
        page.goto(f"{base}/tournaments/{bracket_id}")
        split = R(page, "table", "Prize split")
        for amount in ("2,000", "800", "400"):
            contains(page, split, amount)
        contains(page, R(page, "status", "Entrants"), " of 8 entered")
        again = page.request.post(f"{base}/api/tournaments/{bracket_id}/register")
        assert again.status == 409 and again.json()["error"] in ("already_registered", "tournament_closed")
    assert me_coins(player) == 500
    novice = make_player(base, level=1).signin()
    locked = novice.post(f"/api/tournaments/{bracket_for(novice, 2)['id']}/register")
    assert locked.status_code == 403 and locked.json()["error"] == "level_locked"
    assert novice.me()["coins"] == 1000


def me_coins(player: Player) -> int:
    return player.signin().me()["coins"]


def test_wf_tournaments_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    bracket = fill_bracket(base, 1, 6)
    path = f"/tournaments/{bracket['id']}"
    one, two = make_player(base), make_player(base)
    with signed_in(browser, base, one, path) as first, signed_in(browser, base, two, path) as second:
        entrants = R(first, "status", "Entrants")
        shows(first, entrants, "6 of 8 entered")
        assert first.request.post(f"{base}/api/tournaments/{bracket['id']}/register").status == 201
        shows(second, R(second, "status", "Entrants"), "7 of 8 entered")
        shows(first, entrants, "7 of 8 entered")
        assert second.request.post(f"{base}/api/tournaments/{bracket['id']}/register").status == 201
        shows(first, entrants, "8 of 8 entered")
        contains(first, R(first, "status", "Ready check"), re.compile(r"Ready check: \d+s left"))
        slots = R(first, "list", "Bracket slots").get_by_role("listitem")
        expect(slots).to_have_count(8)
        contains(first, R(first, "region", "Bracket"), one.name)
        state = first.request.get(f"{base}/api/tournaments/{bracket['id']}").json()
        assert sorted(e["slot"] for e in state["entrants"]) == list(range(1, 9))


def test_wf_tournaments_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    bracket = fill_bracket(base, 1, 7)
    player = make_player(base)
    with signed_in(browser, base, player, f"/tournaments/{bracket['id']}") as page:
        shows(page, R(page, "status", "Entrants"), "7 of 8 entered")
        assert page.request.post(f"{base}/api/tournaments/{bracket['id']}/register").status == 201
        log = R(page, "log", "Tournament announcements")
        contains(page, log, "Bracket drawn. Ready check started.")
        assert log.get_attribute("aria-live") in (None, "polite")
        slots = R(page, "list", "Bracket slots").get_by_role("listitem")
        eventually(page, lambda: expect(slots).to_have_count(8, timeout=QUICK_MS))
        slots.nth(0).focus()
        for index in range(8):
            expect(slots.nth(index)).to_be_focused()
            expect(slots.nth(index)).to_contain_text(f"Slot {index + 1}: ")
            if index < 7:
                page.keyboard.press("Tab")
        ready = R(page, "button", "Ready")
        page.keyboard.press("Tab")
        expect(ready).to_be_focused()
        page.keyboard.press("Enter")
        saw(page, "You are ready.")
        state = page.request.get(f"{base}/api/tournaments/{bracket['id']}").json()
        assert next(e for e in state["entrants"] if e["playerId"] == player.id)["ready"] is True


def test_wf_tournaments_short_window(browser: Browser) -> None:
    base = env_url("APP_SHORT_URL")
    player = new_player(base).signin()
    bracket = bracket_for(player, 1)
    with signed_in(browser, base, player, f"/tournaments/{bracket['id']}", size=PHONE) as page:
        assert page.request.post(f"{base}/api/tournaments/{bracket['id']}/register").status == 201
        region = R(page, "region", "Bracket")
        see(page, region)
        scrolls = region.evaluate(
            "e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) || e.scrollWidth > e.clientWidth"
        )
        assert scrolls
        layout(page)
        saw(page, "Not enough players. Your 100 Coins are back.", SHORT_TIMER_S + SLACK_S)
    assert player.me()["coins"] == 1000
    state = player.get(f"/api/tournaments/{bracket['id']}").json()
    assert state["status"] == "refunded"


def test_tournament_prizes_and_last_seat(app_url: str) -> None:
    base = app_url.rstrip("/")
    viewer = make_player(base).signin()
    listed = viewer.get("/api/tournaments").json()["tournaments"]
    assert {t["tier"] for t in listed} == set(TIERS)
    for tournament in listed:
        name, _, price, _ = TIERS[tournament["tier"]]
        first, second, semi, house = PRIZES[tournament["tier"]]
        assert tournament["tierName"] == name and tournament["entry"] == price
        assert tournament["prizes"] == {"first": first, "second": second, "semiFinal": semi, "house": house}
    bracket = fill_bracket(base, 3, 7)
    rivals = [make_player(base, level=7, coins=DOWNTOWN_ENTRY).signin() for _ in range(4)]
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(lambda p: p.post(f"/api/tournaments/{bracket['id']}/register"), rivals))
    assert sorted(r.status_code for r in replies) == [201, 409, 409, 409]
    for rival, reply in zip(rivals, replies):
        if reply.status_code == 201:
            assert rival.me()["coins"] == 0
        else:
            assert reply.json()["error"] == "tournament_full"
            assert rival.me()["coins"] == DOWNTOWN_ENTRY
    state = viewer.get(f"/api/tournaments/{bracket['id']}").json()
    assert state["entrantCount"] == 8
    assert bracket_for(viewer, 3)["id"] != bracket["id"]


def test_tournament_refunds_write_ledger_lines() -> None:
    base = env_url("APP_SHORT_URL")
    pair = [make_player(base, level=3).signin() for _ in range(2)]
    bracket = bracket_for(pair[0], 2)
    for player in pair:
        assert player.post(f"/api/tournaments/{bracket['id']}/register").status_code == 201
        assert player.me()["coins"] == 500

    def refunded(tournament_id: str, viewer: Player) -> bool:
        return viewer.get(f"/api/tournaments/{tournament_id}").json()["status"] == "refunded"
    assert poll(lambda: refunded(bracket["id"], pair[0]), SHORT_TIMER_S + SLACK_S)
    for player in pair:
        balance, total, lines = ledger_sum(player, "coins")
        assert balance == total == 1000
        assert [l["amount"] for l in lines if l["kind"] == "tournament_refund"] == [500]

    entrants = [make_player(base, level=7, coins=DOWNTOWN_ENTRY).signin() for _ in range(8)]
    full = bracket_for(entrants[0], 3)
    assert full["entrantCount"] == 0
    for player in entrants:
        assert player.post(f"/api/tournaments/{full['id']}/register").status_code == 201
    assert entrants[0].post(f"/api/tournaments/{full['id']}/ready").status_code == 200
    assert poll(lambda: refunded(full["id"], entrants[0]), SHORT_TIMER_S + SLACK_S)
    for player in entrants:
        balance, total, _ = ledger_sum(player, "coins")
        assert balance == total == DOWNTOWN_ENTRY


SCREENS = {
    "tutorial": "/",
    "home": "/home",
    "home-light": "/home",
    "play": "/play",
    "practice": "/practice",
    "shop": "/shop",
    "tournaments": "/tournaments",
    "clubs": "/clubs",
    "leaderboards": "/leaderboards",
    "profile": "/profile",
    "settings": "/settings",
    "table": "table",
    "table-light": "table",
}


@pytest.mark.parametrize("screen", list(SCREENS), ids=list(SCREENS))
def test_accessibility_baseline(browser: Browser, app_url: str, screen: str) -> None:
    base = app_url.rstrip("/")
    path = SCREENS[screen]
    if path == "/":
        with open_app(browser, base + "/") as page:
            see(page, R(page, "status", "Tutorial step"))
            axe(page)
            _focus_marks(page)
        return
    one, two = make_player(base).signin(), make_player(base)
    if "light" in screen:
        assert one.patch("/api/me/settings", {"theme": "light"}).status_code == 200
    if path == "table":
        _, path = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with signed_in(browser, base, one, path) as page:
        until(page, "() => document.body.innerText.trim().length > 0")
        advance(page, MOTION_MS)
        axe(page)
        _focus_marks(page)


def _focus_marks(page: Page) -> None:
    for _ in range(5):
        page.keyboard.press("Tab")
        mark = page.evaluate(
            """() => {
                const element = document.activeElement;
                if (!element || element === document.body) return true;
                const style = getComputedStyle(element);
                return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
                    || style.boxShadow !== 'none';
            }"""
        )
        assert mark, "a focused control shows no mark"


VIEWPORTS = {"phone": [375, 812], "tablet": [768, 1024], "desktop": [1280, 800]}


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_published_layouts(browser: Browser, app_url: str, viewport: str) -> None:
    base = app_url.rstrip("/")
    width, height = VIEWPORTS[viewport]
    one, two = make_player(base), make_player(base)
    _, url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with signed_in(browser, base, one, url, size={"width": width, "height": height}) as page:
        board = R(page, "region", "Scoreboard")
        table = R(page, "img", "Table")
        controls = R(page, "region", "Shot controls")
        see(page, controls)
        see(page, R(page, "status", "Coins"))
        rail, felt, panel = box_of(board), box_of(table), box_of(controls)
        if viewport == "phone":
            assert felt["height"] > felt["width"]
            assert rail["y"] + rail["height"] <= felt["y"] + 1
            assert felt["y"] + felt["height"] <= panel["y"] + 1
        if viewport == "tablet":
            assert felt["width"] > felt["height"]
            assert rail["y"] + rail["height"] <= felt["y"] + 1
            assert felt["y"] + felt["height"] <= panel["y"] + 1
            assert rail["width"] >= felt["width"]
        if viewport == "desktop":
            assert felt["width"] > felt["height"]
            assert rail["x"] + rail["width"] <= felt["x"] + 1
            assert felt["x"] + felt["width"] <= panel["x"] + 1
        layout(page)
        for path in MAIN_SCREENS:
            page.goto(base + path)
            until(page, "() => document.body.innerText.trim().length > 0")
            advance(page, STEP_MS)
            layout(page)


def test_mail_outage_screens(browser: Browser, killbill: KillBill) -> None:
    base = env_url("APP_MAILPIT_DOWN_URL")
    sentence = "Verification mail is delayed. Play on; we will retry."
    shown = False
    for _ in range(3):
        email, name = f"{tag()}{tag()}@example.test", f"S{tag()}"
        with open_app(browser, base + "/home") as page:
            created = page.request.post(
                f"{base}/api/auth/signup",
                data={"email": email, "password": PASSWORD, "displayName": name, "birthYear": ADULT_YEAR},
            )
            assert created.status == 201, created.text()
            page.goto(base + "/home")
            try:
                shows(page, R(page, "status", "Mail notice"), sentence, SLACK_S)
            except AssertionError:
                if me_of(page, base)["mailDelayed"]:
                    raise
                continue
            shown = True
            joined = page.request.post(f"{base}/api/queue", data={"mode": "nine-ball", "tier": 2 + 2})
            assert joined.status in (403, 409)
            page.goto(base + "/shop")
            click(R(page, "tab", "Cash packs"))
            click(R(page, "button", "Resend verification"))
            shows(page, R(page, "status", "Shop notice"), "Could not send mail. Try again soon.")
            assert "Verification email sent" not in body_text(page)
            refused = page.request.post(f"{base}/api/auth/resend-verification")
            assert refused.status == 503 and refused.json()["error"] == "mail_unavailable"
            break
    assert shown, "the delayed-mail notice never showed"

    player = make_player(base)
    with signed_in(browser, base, player, "/shop") as page:
        queued = page.request.post(f"{base}/api/queue", data={"mode": "nine-ball", "tier": 1})
        assert queued.status == 201
        assert page.request.delete(f"{base}/api/queue").status == 200
        click(R(page, "tab", "Cash packs"))
        click(R(page, "button", "Buy Chalk Pack"))
        click(R(page, "button", "Pay $0.99"))
        notice = R(page, "status", "Shop notice")
        shows(page, notice, "Cash added: 50 Cash. Receipt delayed. Your Cash is safe.")
        assert "Receipt sent" not in body_text(page)
        assert me_of(page, base)["cash"] == 50
    assert len(purchases(killbill, player.email)) == 1


def test_postgres_outage_screen(browser: Browser, app_url: str) -> None:
    direct = app_url.rstrip("/")
    down = env_url("APP_POSTGRES_DOWN_URL")
    sentence = "Could not reach the table"
    player = make_player(direct, coins=1500, cash=5).signin()
    refused = call(down, "GET", "/api/me", cookie=player.cookie)
    assert refused.status_code == 503
    assert refused.json() == {"error": "store_unavailable", "message": sentence}
    refused = call(down, "POST", "/api/auth/signin", {"email": "a@example.test", "password": PASSWORD})
    assert refused.status_code == 503 and refused.json()["error"] == "store_unavailable"
    with relayed(direct) as relay, signed_in(browser, relay.url, player) as page:
        coins, cash = R(page, "status", "Coins"), R(page, "status", "Cash")
        shows(page, coins, "1,500")
        shows(page, cash, "5")
        relay.switch(down)
        page.reload()
        at(page, "/home")
        contains(page, R(page, "status", "Connection"), sentence)
        shows(page, coins, re.compile(r"^1,500\s*Stale$"))
        shows(page, cash, re.compile(r"^5\s*Stale$"))
        retry = R(page, "button", "Retry")
        click(retry)
        advance(page, MOTION_MS)
        see(page, retry)
        relay.switch(direct)
        try:
            click(retry)
        except (PlaywrightError, AssertionError):
            pass
        eventually(page, lambda: expect(retry).to_have_count(0, timeout=QUICK_MS))
        shows(page, coins, "1,500")
    with open_app(browser, down + "/home") as page:
        value = player.cookie.split("=", 1)[1]
        page.context.add_cookies([{"name": "hs_session", "value": value, "url": down}])
        page.reload()
        at(page, "/home")
        contains(page, R(page, "status", "Connection"), sentence)
        see(page, R(page, "button", "Retry"))
        shows(page, R(page, "status", "Coins"), "Stale")
        shows(page, R(page, "status", "Cash"), "Stale")
    with open_app(browser, down + "/") as page:
        see(page, R(page, "status", "Tutorial step"))


def viewport_pixels(page: Page) -> Any:
    shot = session(page).send("Page.captureScreenshot", {"format": "png"})
    return decode(base64.b64decode(shot["data"]))


def test_settings_persist_and_mirror(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    one, two = make_player(base).signin(), make_player(base)
    assert one.patch("/api/me/settings", {"theme": "dark"}).status_code == 200
    with signed_in(browser, base, one, "/settings", size=DESKTOP) as page:
        see(page, R(page, "switch", "Left-handed mode"))
        dark = viewport_pixels(page)
        sound = one.me()["settings"]["sound"]
        flip(R(page, "switch", "Left-handed mode"))
        flip(R(page, "switch", "Reduced motion"))
        flip(R(page, "switch", "Sound"))
        check(R(page, "radio", "Light"))
        sensitivity = R(page, "slider", "Aim sensitivity")
        start = number(sensitivity)
        sensitivity.focus()
        page.keyboard.press("ArrowRight" if start < 10 else "ArrowLeft")

        def saved() -> None:
            settings = one.me()["settings"]
            assert settings["leftHanded"] is True and settings["reducedMotion"] is True
            assert settings["theme"] == "light" and settings["aimSensitivity"] != start
            assert settings["sound"] is not sound
        eventually(page, saved)
        eventually(page, lambda: changed(dark, viewport_pixels(page)))
        stored = one.me()["settings"]
        page.reload()
        expect(R(page, "switch", "Left-handed mode")).to_be_checked()
        expect(R(page, "switch", "Reduced motion")).to_be_checked()
        expect(R(page, "switch", "Sound")).to_be_checked(checked=not sound)
        expect(R(page, "radio", "Light")).to_be_checked()
        assert number(sensitivity) == stored["aimSensitivity"]
    bad = one.patch("/api/me/settings", {"theme": "neon"})
    assert bad.status_code == 422
    _, url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with signed_in(browser, base, one, url, size=DESKTOP) as page:
        controls = R(page, "region", "Shot controls")
        see(page, controls)
        panel, felt, rail = box_of(controls), box_of(R(page, "img", "Table")), box_of(R(page, "region", "Scoreboard"))
        assert panel["x"] + panel["width"] <= felt["x"] + 1
        assert felt["x"] + felt["width"] <= rail["x"] + 1
        page.keyboard.press("ArrowRight")
        see(page, R(page, "img", "Contact loupe view"))
        click(R(page, "button", "Lock aim"))
        whole_at_once(page, R(page, "progressbar", "Tangent draw"), 100)
    with signed_in(browser, base, one, "/settings") as page:
        expect(R(page, "switch", "Left-handed mode")).to_be_checked()


def test_contact_loupe_opens_and_locks(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        step = R(page, "status", "Tutorial step")
        shows(page, step, "Step 1 of 3")
        aim = R(page, "slider", "Aim angle")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        reads(page, aim, 0)
        loupe = R(page, "status", "Contact loupe")
        contains(page, loupe, "Legal")
        contains(page, loupe, "Cut 0.0°")
        contains(page, loupe, "First ball 1")
        see(page, R(page, "img", "Contact loupe view"))
        lock = R(page, "button", "Lock aim")
        click(lock)
        expect(lock).to_have_attribute("aria-pressed", "true")
        draw = R(page, "progressbar", "Tangent draw")
        draws_to(page, draw, 100)
        page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)
        reads(page, aim, 0)
        contains(page, loupe, "Cut 0.0°")
        click(ready_strike(page))
        shows(page, step, "Step 2 of 3")
        contains(page, R(page, "region", "Shot receipt"), "First ball 1. Cut 0.0°.")
        if lock.get_attribute("aria-pressed") == "true":
            click(lock)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        contains(page, loupe, "Wrong group")
        for _ in range(90):
            page.keyboard.press("ArrowRight")
        contains(page, loupe, "Blocked")
        contains(page, loupe, "Cut --")
    with open_app(browser, base + "/") as page:
        shows(page, R(page, "status", "Tutorial step"), "Step 1 of 3")
        box = box_of(R(page, "img", "Table"))
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 3)
        contains(page, R(page, "status", "Contact loupe"), re.compile("Legal|Wrong group|Blocked"))
    one, two = make_player(base), make_player(base)
    _, url = make_table(base, [one, two], [entry(3)], [3, 8, 9])
    with seated(browser, base, one, two, url) as (_first, second):
        box = box_of(R(second, "img", "Table"))
        second.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        advance(second, STEP_MS)
        expect(R(second, "img", "Contact loupe view")).to_have_count(0)


def test_contact_loupe_reverses_and_rests(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as page:
        shows(page, R(page, "status", "Tutorial step"), "Step 1 of 3")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        see(page, R(page, "img", "Contact loupe view"))
        draw = R(page, "progressbar", "Tangent draw")
        page.keyboard.press("l")
        advance(page, TANGENT_MID_MS)
        reached = number(draw)
        assert reached > 0
        page.keyboard.press("l")
        readings = [number(draw)]
        assert 0 < readings[0] and reached / 2 <= readings[0] <= reached + 1
        for _ in range(int(TANGENT_MAX_MS / TANGENT_SAMPLE_MS)):
            advance(page, TANGENT_SAMPLE_MS)
            readings.append(number(draw))
        assert readings == sorted(readings, reverse=True)
        assert any(0 < value < readings[0] for value in readings[1:])
        assert readings[-1] == 0
    with open_app(browser, base + "/", reduced_motion="reduce") as page:
        shows(page, R(page, "status", "Tutorial step"), "Step 1 of 3")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        view = R(page, "img", "Contact loupe view")
        see(page, view)
        assert animations(view) == []
        contains(page, R(page, "status", "Contact loupe"), "Legal")
        contains(page, R(page, "status", "Contact loupe"), "Cut 0.0°")
        draw = R(page, "progressbar", "Tangent draw")
        page.keyboard.press("l")
        whole_at_once(page, draw, 100)
        page.keyboard.press("l")
        whole_at_once(page, draw, 0)


RACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
RULINGS = {
    "scratch": {"balls": [3, 8, 9], "shot": {"first": 3, "scratch": True}, "banner": "Foul: cue ball scratched.", "active": 2, "hand": True},
    "wrong_contact": {"balls": [3, 8, 9], "shot": {"first": 9}, "banner": "Foul: first contact was not your group.", "active": 2, "hand": True},
    "no_contact": {"balls": [3, 8, 9], "shot": {"first": None}, "banner": "Foul: cue ball hit nothing.", "active": 2, "hand": True},
    "no_cushion": {"balls": [3, 8, 9], "shot": {"first": 3, "cushion": False}, "banner": "Foul: no ball reached a cushion after contact.", "active": 2, "hand": True},
    "off_table": {"balls": [3, 8, 9], "shot": {"first": 3, "off": [3]}, "banner": "Foul: ball left the table.", "active": 2, "hand": True, "kept": [3]},
    "scratch_beats_off_table": {"balls": [3, 8, 9], "shot": {"first": 3, "scratch": True, "off": [3]}, "banner": "Foul: cue ball scratched.", "active": 2, "hand": True},
    "off_table_beats_wrong_contact": {"balls": [3, 8, 9], "shot": {"first": 9, "off": [3]}, "banner": "Foul: ball left the table.", "active": 2, "hand": True},
    "legal_nothing": {"balls": [3, 8, 9], "shot": {"first": 3}, "banner": "Legal shot: nothing potted.", "active": 2, "hand": False},
    "own_pot": {"balls": [3, 5, 8, 9], "shot": {"first": 3, "pots": [[3, "top-left"]]}, "banner": "Ball 3 potted in Top left.", "active": 1, "hand": False, "left": 1},
    "opponent_pot": {"balls": [3, 8, 9, 10], "shot": {"first": 3, "pots": [[9, "middle-right"]]}, "banner": "Ball 9 potted in Middle right.", "active": 2, "hand": False, "gone": [9]},
    "break_pot": {"phase": "break", "balls": RACK, "shot": {"first": 1, "pots": [[1, "top-left"]]}, "banner": "Ball 1 potted in Top left.", "active": 1, "hand": False, "left": 13},
    "break_cushion": {"phase": "break", "balls": RACK, "shot": {"first": 1}, "banner": "Legal shot: nothing potted.", "active": 2, "hand": False},
    "illegal_break": {"phase": "break", "balls": RACK, "shot": {"first": 1, "cushion": False}, "banner": "Illegal break: opponent gets ball in hand behind the head string.", "active": 2, "hand": True, "head_string": True},
    "break_foul": {"phase": "break", "balls": RACK, "shot": {"first": 1, "scratch": True}, "banner": "Illegal break: opponent gets ball in hand behind the head string.", "active": 2, "hand": True},
    "eight_on_break": {"phase": "break", "balls": RACK, "shot": {"first": 1, "pots": [[8, "top-left"]]}, "banner": "8 on the break: re-spotted, shooter continues.", "active": 1, "hand": False, "kept": [8]},
    "eight_on_break_foul": {"phase": "break", "balls": RACK, "shot": {"first": 1, "pots": [[8, "top-left"]], "scratch": True}, "banner": "Illegal break: opponent gets ball in hand behind the head string.", "active": 2, "hand": True, "kept": [8]},
    "claim_solids": {"phase": "open", "balls": [1, 2, 8, 9, 10], "shot": {"first": 2, "pots": [[2, "top-left"]]}, "banner": "{one} takes solids.", "active": 1, "hand": False, "group": "solids"},
    "claim_stripes": {"phase": "open", "balls": [1, 2, 8, 9, 10], "shot": {"first": 9, "pots": [[9, "top-left"]]}, "banner": "{one} takes stripes.", "active": 1, "hand": False, "group": "stripes"},
    "claim_first_entry": {"phase": "open", "balls": [1, 2, 8, 9, 10], "shot": {"first": 2, "pots": [[10, "top-left"], [2, "top-right"]]}, "banner": "{one} takes stripes.", "active": 1, "hand": False, "group": "stripes"},
    "nine_wrong_contact": {"mode": "nine-ball", "phase": "open", "balls": [1, 2, 9], "shot": {"first": 2}, "banner": "Foul: first contact was not the lowest ball.", "active": 2, "hand": True},
    "nine_keeps_turn": {"mode": "nine-ball", "phase": "open", "balls": [1, 2, 9], "shot": {"first": 1, "pots": [[2, "top-left"]]}, "banner": "Ball 2 potted in Top left.", "active": 1, "hand": False, "left": 2},
    "nine_foul_respot": {"mode": "nine-ball", "phase": "open", "balls": [1, 2, 9], "shot": {"first": 1, "pots": [[9, "top-left"]], "scratch": True}, "banner": "Foul: cue ball scratched.", "active": 2, "hand": True, "kept": [9]},
    "nine_win": {"mode": "nine-ball", "phase": "open", "balls": [1, 2, 9], "shot": {"first": 1, "pots": [[9, "top-left"]]}, "banner": "You won: 9 potted legally.", "other": "You lost: {one} potted the 9."},
    "win_called": {"balls": [8, 9], "shot": {"first": 8, "pots": [[8, "top-left"]]}, "called": "top-left", "banner": "You won: 8 in the called pocket.", "other": "You lost: {one} potted the 8 in the called pocket."},
    "eight_early": {"balls": [3, 8, 9], "shot": {"first": 3, "pots": [[8, "top-left"]]}, "banner": "You lost: 8 potted before your group was cleared.", "other": "You won: {one} potted the 8 early."},
    "eight_uncalled": {"balls": [8, 9], "shot": {"first": 8, "pots": [[8, "bottom-right"]]}, "called": "top-left", "banner": "You lost: 8 potted in an uncalled pocket.", "other": "You won: {one} potted the 8 in an uncalled pocket."},
    "eight_scratch": {"balls": [8, 9], "shot": {"first": 8, "pots": [[8, "top-left"]], "scratch": True}, "called": "top-left", "banner": "You lost: scratched on the 8.", "other": "You won: {one} scratched on the 8."},
    "eight_foul": {"balls": [8, 9], "shot": {"first": 9, "pots": [[8, "top-left"]]}, "called": "top-left", "banner": "You lost: foul on the 8.", "other": "You won: {one} fouled on the 8."},
    "forged_fields": {"balls": [3, 8, 9], "shot": {"first": 3}, "forged": True},
}


RULING_IDS = [
    "scratch", "wrong_contact", "no_contact", "no_cushion", "off_table",
    "scratch_beats_off_table", "off_table_beats_wrong_contact", "legal_nothing", "own_pot",
    "opponent_pot", "break_pot", "break_cushion", "illegal_break", "break_foul",
    "eight_on_break", "eight_on_break_foul", "claim_solids", "claim_stripes",
    "claim_first_entry", "nine_wrong_contact", "nine_keeps_turn", "nine_foul_respot",
    "nine_win", "win_called", "eight_early", "eight_uncalled", "eight_scratch", "eight_foul",
    "forged_fields",
]


@pytest.mark.parametrize("ruling", RULING_IDS, ids=RULING_IDS)
def test_referee_rulings(app_url: str, ruling: str) -> None:
    base = app_url.rstrip("/")
    case = RULINGS[ruling]
    one, two = make_player(base).signin(), make_player(base).signin()
    shot = case["shot"]
    script = [entry(shot["first"], shot.get("pots"), shot.get("cushion", True), shot.get("scratch", False), shot.get("off"))]
    table_id, _ = make_table(
        base, [one, two], script, list(case["balls"]), phase=case.get("phase", "groups"),
        mode=case.get("mode", "eight-ball"),
    )
    assert two.get(f"/api/tables/{table_id}").status_code == 200
    if case.get("forged"):
        forged = one.post(f"/api/tables/{table_id}/shots", {**shot_body(), "balls": [8]})
        assert forged.status_code == 422
        assert forged.json()["errors"] == {"balls": "Not accepted."}
        outcome = one.post(f"/api/tables/{table_id}/shots", {**shot_body(), "winner": one.id})
        assert outcome.status_code == 422 and "winner" in outcome.json()["errors"]
        assert one.get(f"/api/tables/{table_id}").json()["balls"] == case["balls"]
        return
    reply = one.post(f"/api/tables/{table_id}/shots", shot_body(case.get("called")))
    assert reply.status_code == 200, reply.text
    state = reply.json()
    other = two.get(f"/api/tables/{table_id}").json()
    assert state["ruleBanner"] == case["banner"].format(one=one.name)
    if "other" in case:
        expected = case["other"].format(one=one.name)
        assert other["ruleBanner"] == expected and other["result"]["line"] == expected
        assert state["result"]["line"] == state["ruleBanner"]
        return
    assert other["ruleBanner"] == state["ruleBanner"] and state["result"] is None
    assert state["activeSeat"] == case["active"] and state["ballInHand"] is case["hand"]
    for ball in case.get("kept", []):
        assert ball in state["balls"]
    for ball in case.get("gone", []):
        assert ball not in state["balls"]
    if "left" in case:
        assert state["seats"][0]["ballsLeft"] == case["left"]
    if "group" in case:
        assert state["seats"][0]["group"] == case["group"]
    if case.get("mode") == "nine-ball":
        assert [seat["group"] for seat in state["seats"]] == [None, None]
    if case.get("head_string"):
        far = two.post(f"/api/tables/{table_id}/place", {"across": 50, "along": 26})
        assert far.status_code == 422
        assert far.json()["errors"] == {"along": "Place the ball behind the head string."}
        assert two.get(f"/api/tables/{table_id}").json()["ballInHand"] is True
        assert two.post(f"/api/tables/{table_id}/place", {"across": 50, "along": 25}).status_code == 200
        again = two.post(f"/api/tables/{table_id}/place", {"across": 50, "along": 25})
        assert again.status_code == 409 and again.json()["error"] == "no_ball_in_hand"


def test_health_and_server_boundary(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    health = call(base, "GET", "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    for name in ("APP_KILLBILL_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_POSTGRES_DOWN_URL"):
        outage = env_url(name)

        def unavailable(target: str = outage) -> bool:
            reply = call(target, "GET", "/api/health")
            assert reply.status_code == 200
            return reply.json() == {"status": "unavailable"}
        assert poll(unavailable, DROP_DETECT_S + SLACK_S)
        assert httpx.get(outage + "/", timeout=HTTP_TIMEOUT_S).status_code == 200

    missing = call(base, "GET", f"/api/{tag()}")
    assert missing.status_code == 404 and missing.json()["error"] == "not_found"
    assert isinstance(missing.json()["message"], str)
    player = make_player(base).signin()
    assert call(base, "GET", f"/api/tables/{tag()}").status_code == 401
    assert player.get(f"/api/tables/{tag()}").json()["error"] == "not_found"

    wrong = httpx.post(
        base + "/api/auth/signin", content="{", headers={"Content-Type": "application/json"},
        timeout=HTTP_TIMEOUT_S,
    )
    assert wrong.status_code == 400 and wrong.json()["error"] == "malformed_json"
    wrong = httpx.post(
        base + "/api/auth/signin", content="email", headers={"Content-Type": "text/plain"},
        timeout=HTTP_TIMEOUT_S,
    )
    assert wrong.status_code == 415 and wrong.json()["error"] == "unsupported_media_type"

    shell = json.dumps({"email": "a@example.test", "pad": ""})
    exact = shell.replace('"pad": ""', '"pad": "' + "x" * (BODY_LIMIT - len(shell)) + '"')
    assert len(exact) == BODY_LIMIT
    headers = {"Content-Type": "application/json"}
    fits = httpx.post(base + "/api/auth/signin", content=exact, headers=headers, timeout=HTTP_TIMEOUT_S)
    assert fits.status_code != 413
    over = httpx.post(base + "/api/auth/signin", content=exact + " ", headers=headers, timeout=HTTP_TIMEOUT_S)
    assert over.status_code == 413 and over.json()["error"] == "payload_too_large"

    foreign = {"Origin": "http://evil.example"}
    crossed = player.post("/api/wallet/daily-reward", headers=foreign)
    assert crossed.status_code == 403 and crossed.json()["error"] == "cross_origin"
    assert CORS_HEADER not in {key.lower() for key in crossed.headers}
    assert player.me()["coins"] == 1000
    assert CORS_HEADER not in {key.lower() for key in player.get("/api/me").headers}

    probe = {"email": f"{tag()}@example.test"}
    assert call(base, "POST", "/api/grading/players", probe).status_code == 404
    denied = call(base, "POST", "/api/grading/players", probe, headers={"X-Grading-Key": "wrong"})
    assert denied.status_code == 404 and denied.json()["error"] == "not_found"

    for path in ("/package.json", "/package-lock.json", "/.env", "/run.json", "/tsconfig.json", "/src/server.ts"):
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path

    page_source = httpx.get(base + "/", timeout=HTTP_TIMEOUT_S).text
    assets = [page_source]
    for link in re.findall(r"(?:src|href)=[\"'](/[^\"']+)[\"']", page_source):
        assets.append(httpx.get(base + link, timeout=HTTP_TIMEOUT_S).text)
    names = ("DATABASE_URL", "KILLBILL_API_SECRET", "GRADING_KEY")
    for name in names:
        value = os.environ.get(name)
        if value:
            assert not [asset for asset in assets if value in asset], name

    with open_app(browser, f"{base}/{tag()}") as page:
        see(page, R(page, "heading", "Nothing on this table"))


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field]


def test_if_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, package.name
    for font in ("Big Shoulders Display", "IBM Plex Sans"):
        assert font in notices


def test_if_licences() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}
    for package in shipped_packages():
        assert licence_allowed(package.licence, allowed), f"{package.name}: {package.licence}"


def process_names() -> str:
    names = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                names.append((entry / "comm").read_text())
            except OSError:
                continue
    return "".join(names)


def test_if_postgres_only() -> None:
    assert Postgres().tables()
    manifest = json.loads(Path("/app/package.json").read_text())
    declared = {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}
    running = process_names()
    for store in OTHER_STORES:
        assert not [name for name in declared if store.lower() in name.lower()], store
        assert store.lower() not in running.lower(), store


def test_if_no_venv_or_absolute_symlinks() -> None:
    for root, folders, files in os.walk("/app"):
        assert VENV_MARKER not in files
        for name in folders + files:
            path = os.path.join(root, name)
            if os.path.islink(path):
                assert not os.path.isabs(os.readlink(path)), path


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/home") as page:
        seen: list[str] = []
        page.on("request", lambda request: seen.append(request.url))
        page.reload()
        see(page, R(page, "button", "Shop"))
        page.goto(base + "/")
        for url in seen:
            if url.startswith("http"):
                assert same_origin(url, base), url


def test_if_service_configuration(app_url: str, mail: Mailpit) -> None:
    base = app_url.rstrip("/")
    email = f"{tag()}{tag()}@example.test"
    created = call(
        base, "POST", "/api/auth/signup",
        {"email": email, "password": PASSWORD, "displayName": f"S{tag()}", "birthYear": ADULT_YEAR},
    )
    assert created.status_code == 201
    found = mail_to(mail, email, "Verify your Long Rail email")
    assert len(found) == 1
    assert mail_from_address() in addresses(found[0].get("From"))
