import contextlib
import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Mailpit,
    addresses,
    advance,
    animations,
    axe,
    camera,
    capture,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    scene_frames,
    select,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)

APP = Path("/app")

STEPS_PER_SECOND = 60
STEP_LIMIT_PER_LAP = 7200
DRIFT_STEP_LIMIT = 5400
MAX_EVENTS = 2000
FINISH_LIMIT_BYTES = 1000000
FINISH_ANSWER_S = 2
OPENING = 1000
PRICES = {"D": (300, 700, 1500), "C": (600, 1400, 3000), "B": (1000, 2400, 5000)}
ENGINE_ACCEL = 1.0
ENGINE_TOP = 2
ENGINE_PI = 20
BRAKES_STEP = 1.5
BRAKES_PI = 10
CARS = {
    "kestrel-hatch": (4.0, 8.0, 45, 100, 220, 30),
    "wren-coupe": (3.6, 8.5, 47, 102, 230, 30),
    "moth-roadster": (4.2, 7.5, 43, 98, 215, 24),
    "halcyon-rs": (5.0, 9.0, 52, 106, 360, 24),
    "ferrule-sport": (5.4, 8.8, 54, 104, 380, 24),
    "vantor-8": (6.2, 10.0, 60, 110, 560, 18),
}
STARTERS = ("kestrel-hatch", "wren-coupe", "moth-roadster")
HALCYON_PRICE = 4000
FERRULE_PRICE = 5500
LAYOUTS = {
    "saltflat-ring": {
        "length": 1200,
        "corners": [(300, 380, 22), (600, 660, 14), (1000, 1200, 28)],
        "coins": [(120, "middle"), (200, "middle"), (340, "left"), (450, "right"),
                  (520, "right"), (640, "left"), (800, "middle"), (1100, "middle")],
    },
    "quarry-switchbacks": {
        "length": 1000,
        "corners": [(200, 260, 12), (480, 560, 16), (800, 1000, 20)],
        "coins": [(100, "middle"), (230, "left"), (400, "middle"), (520, "right"),
                  (700, "middle"), (900, "left")],
    },
}
COIN_BASE = 5
STREAK_CAP = 5
OFF_TRACK_SPEED = 8
GUIDED_PAYOUT = 300
CIRCUIT_PLACING = {1: 600, 2: 400, 3: 300}
CLEAN_BONUS_PCT = 15
TIME_TRIAL_PAYOUT = 250
DRIFT_DIVISOR = 1000
DRIFT_CAP = 500
ONLINE_PLACING = {1: 200, 2: 100}
LEAGUE_TARGET = 50
TT_SLOW_POINTS = 10
EVENT_WIN_POINTS = 25
FINALS_COINS = 1000
PAYOUT_COUNT_MS = 800
MARKER_MS = 1200
BALANCE_STEP_MS = 1700
SWEEP_DONE_MS = 2000
SWEEP_FRAME_SLACK_MS = 100
PREVIEW_MS = 250
DELTA_SAMPLE_MS = 250
RESTART_MS = 2000
RESEND_MS = 2000
LIVE_MS = 2000
BOARD_PUSH_S = 5
BANNER_S = 10
HELD_RETRY_S = 5
STATUS_PROBE_S = 2
TOUCH_TARGET_PX = 44
TWO_COLUMN_MAX = 1279
DESKTOP = (1280, 800)
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]
FOCUS_RING_PX = 2
KMH = 3.6
MPH = 2.23694
COUNTER = {
    "opening": "house:grants", "finals": "house:grants", "pickups": "house:pickups",
    "result": "house:results", "upgrade": "house:shop", "car": "house:shop", "refit": "house:refits",
}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
GUIDED = "/race?layout=saltflat-ring&mode=practice&event=guided-first-race"

AGE_ERROR = "Confirm you are 13 or older to play."
VERIFYING = "Verifying run…"
HELD = "Held for verification"
CLUB_DONE = "Club league complete. Trophy and 1,000 coins added."
TROPHY = "Club champion trophy"
REJECTED = {
    "did_not_finish": "Rejected: the replay did not reach the finish.",
    "seed_mismatch": "Rejected: the run's seed did not match.",
    "invalid_inputs": "Rejected: the inputs could not be read.",
}
OUTAGE_BANNER = "Replay storage is unavailable. Runs are held and will verify when it returns."
GHOST_UNAVAILABLE = "Ghost unavailable. Racing without it."
NOT_ENOUGH = "Not enough coins"
UNCONFIRMED = "We couldn't confirm the purchase. Nothing changes here until it is confirmed."
REFRESHED = "Garage refreshed from the server."
NO_CHANGE = "No change on the reference lap"
LOADING_TIMES = "Loading times…"
EMPTY_BOARD = "No verified times on this board yet."
LOBBY_FULL = "This lobby is full."
LOBBY_STARTED = "This lobby has already started."
CLUB_LOCKED = "Locked until the Rookie league is complete"
ROOKIE_DONE = "Rookie league complete. Club league and Quarry Switchbacks unlocked."
LINK_EXPIRED = "This sign-in link has expired or was already used. Send a new one."
MAIL_OUTAGE = "We couldn't send the email right now. Try again in a minute."
MAIL_SUBJECT = "Your Kerbline sign-in link"
WEBGL_NOTICE = "3D view needs WebGL 2. Showing a drawing instead."
DESKTOP_NOTICE = "Racing needs a desktop browser with a keyboard."

HTTP_TIMEOUT_S = 30
UI_WAIT_S = 30
POLL_S = 30
POLL_EVERY_S = 0.25
SETTLE_S = 40
LAP_DRIVE_S = 240
BOOT_S = 120
MAIL_WAIT_S = 20
EXPIRY_LINKS = 20
EXPIRY_TRY_S = 3
EXPIRY_DEADLINE_S = 60
LOBBY_RACE_S = 180
TAB_LIMIT = 60
RM_PAINT_MS = 50
SWEEP_COINS = OPENING
CAUTIOUS = 0.8
EVIL = "evil.example"
WRONG_CLOCK = datetime(2001, 1, 1, tzinfo=timezone.utc)
COAST = [{"step": 0, "throttle": 1, "brake": 0, "drift": 0, "lane": "middle"}]
FOREIGN = "https://" + EVIL
DOUBLE_SLASH = "/" * 2
ENCODED_SLASHES = "%2F%2F"
EXTRA_SEGMENT = "/x"
BAD_MODE = "sprint"
UNKNOWN_SYSTEM = "turbo"
STRUCK = "line-through"

_PAUSE = threading.Event()
PUSHES: dict[int, list[dict]] = {}


def compact(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def fmt_coins(n: int) -> str:
    return f"{n:,}"


def fmt_time(ms: int) -> str:
    return f"{ms // 60000}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}"


def fmt_delta(ms: int) -> str:
    if ms == 0:
        return "0.000 s"
    return f"{'−' if ms < 0 else '+'}{abs(ms) // 1000}.{abs(ms) % 1000:03d} s"


def upgrade_name(system: str, stage: int) -> str:
    return f"Upgrade {system} to stage {stage}"


def refit_name(system: str) -> str:
    return f"Refit {system} to stock"


def stage_img(stage: int) -> str:
    return f"Stage {stage} of 3"


def fitted(system: str, stage: int) -> str:
    return f"{system} stage {stage} fitted."


def refitted(system: str) -> str:
    return f"{system} refitted to stock."


def enter_name(event: str) -> str:
    return f"Enter {event}"


def car_img(car: str, kind: str) -> str:
    return f"{car}, {kind}"


def buy_car_name(car: str, price: int) -> str:
    return f"Buy {car} for {fmt_coins(price)} coins"


def loaner_copy(cls: str, car: str) -> str:
    return f"You have no eligible class {cls} car. Race the loaner {car} for half result coins?"


def hud_lap(lap: int, laps: int) -> str:
    return f"Lap {lap}/{laps}"


def hud_position(position: int, cars: int) -> str:
    return f"Position {position}/{cars}"


def hud_coins(coins: int) -> str:
    return f"Coins {coins}"


def hud_speed(speed: int, unit: str = "km/h") -> str:
    return f"{speed} {unit}"


def race_path(layout_id: str, mode: str, *, event: str | None = None, laps: int | None = None,
              ghost: str | None = None) -> str:
    path = f"/race?layout={layout_id}&mode={mode}"
    if event:
        path += f"&event={event}"
    if laps:
        path += f"&laps={laps}"
    if ghost:
        path += f"&ghost={ghost}"
    return path


def board_path(layout_id: str, mode: str, cls: str) -> str:
    return f"/v1/boards?layoutId={layout_id}&mode={mode}&class={cls}"


def upgrade_path(car: str, system: str) -> str:
    return f"/v1/garage/cars/{car}/upgrades/{system}"


def refit_path(car: str, system: str) -> str:
    return f"/v1/garage/cars/{car}/refits/{system}"


def struck(locator: Locator) -> bool:
    return bool(locator.evaluate(
        "(e, struck) => { for (let n = e; n; n = n.parentElement) {"
        " if (n.matches('del, s') || getComputedStyle(n).textDecorationLine.includes(struck)) return true; }"
        " return false; }", STRUCK))


def coin_value(n: int) -> int:
    return COIN_BASE + min(n - 1, STREAK_CAP)


def middle_lane_coins(layout_id: str, laps: int) -> int:
    streak = total = 0
    for _ in range(laps):
        for _, lane in LAYOUTS[layout_id]["coins"]:
            if lane == "middle":
                streak += 1
                total += coin_value(streak)
            else:
                streak = 0
    return total


def summary(ref: dict) -> str:
    if ref["deltaMs"] == 0:
        return NO_CHANGE
    deltas = ref["sectorDeltasMs"]
    worst = max(range(3), key=lambda k: (abs(deltas[k]), -k))
    return f"{fmt_delta(ref['deltaMs'])}, mostly S{worst + 1}"


def generate(layout_id: str, car_id: str, laps: int, step_limit: int, scale: float = 1.0,
             drift: bool = False) -> list[dict]:
    track = LAYOUTS[layout_id]
    accel, brake, top, grip = CARS[car_id][:4]
    corners = [(a, b, limit * grip / 100) for a, b, limit in track["corners"]]
    pos, speed, lap, off, last = 0.0, 0.0, 0, None, None
    events: list[dict] = []
    for step in range(step_limit):
        inside = next((c for c in corners if c[0] <= pos < c[1]), None)
        if inside:
            throttle, brk = (1 if speed < inside[2] * scale else 0), 0
        else:
            upcoming = next((c for c in corners if c[0] > pos), None)
            target = upcoming or corners[0]
            distance = target[0] - pos if upcoming else track["length"] - pos + corners[0][0]
            limit = target[2] * scale
            braking = speed > limit and distance <= (speed ** 2 - limit ** 2) / (2 * brake) + speed / 30
            throttle, brk = (0, 1) if braking else (1, 0)
        if (throttle, brk) != last:
            events.append({"step": step, "throttle": throttle, "brake": brk, "drift": 1 if drift else 0,
                           "lane": "middle"})
            last = (throttle, brk)
        speed += accel / 60 if throttle else 0
        speed -= brake / 60 if brk else 0
        speed -= 0.5 / 60 if not throttle and not brk else 0
        speed -= 1.0 / 60 if drift else 0
        speed = min(max(speed, 0.0), top)
        pos += speed / 60
        if pos >= track["length"]:
            pos -= track["length"]
            lap += 1
            if lap >= laps:
                break
        here = next((c for c in corners if c[0] <= pos < c[1]), None)
        if here and (speed > here[2] + 0.5 or off == here):
            off, speed = here, min(speed, OFF_TRACK_SPEED)
        elif here != off:
            off = None
    assert 1 <= len(events) <= MAX_EVENTS
    return events


def poll(fn: Callable[[], Any], cond: Callable[[Any], bool], seconds: float = POLL_S,
         every: float = POLL_EVERY_S) -> Any:
    deadline = time.monotonic() + seconds
    last = fn()
    while not cond(last):
        if time.monotonic() > deadline:
            raise AssertionError(f"condition not met within {seconds} s; last value: {last!r}")
        _PAUSE.wait(every)
        last = fn()
    return last


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)
    errors: list[BaseException] = []

    def run(i: int, fn: Callable[[], Any]) -> None:
        barrier.wait()
        try:
            results[i] = fn()
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise errors[0]
    return results


class Player:
    def __init__(self, base: str, cookie: str, player_id: str = "", name: str = ""):
        self.base = base.rstrip("/")
        self.cookie = cookie
        self._id = player_id
        self._name = name

    def _load(self) -> None:
        me = self.get("/v1/me").json()
        self._id, self._name = me["playerId"], me["name"]

    @property
    def id(self) -> str:
        if not self._id:
            self._load()
        return self._id

    @property
    def name(self) -> str:
        if not self._name:
            self._load()
        return self._name

    def _headers(self, extra: dict[str, str]) -> dict[str, str]:
        return {"Cookie": f"kerb_session={self.cookie}", **extra}

    def get(self, path: str) -> httpx.Response:
        return httpx.get(self.base + path, headers=self._headers({}), timeout=HTTP_TIMEOUT_S)

    def post(self, path: str, body: Any = None, key: str | None = None, *, raw: bytes | None = None,
             content_type: str = "application/json", **headers: str) -> httpx.Response:
        extra = {"Content-Type": content_type, **headers}
        if key is not None:
            extra["Idempotency-Key"] = key
        content = raw if raw is not None else compact({} if body is None else body)
        return httpx.post(self.base + path, content=content, headers=self._headers(extra), timeout=HTTP_TIMEOUT_S)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return httpx.patch(self.base + path, content=compact(body),
                           headers=self._headers({"Content-Type": "application/json"}), timeout=HTTP_TIMEOUT_S)


def new_player(base: str, coins: int | None = None, cars: list[str] | None = None, name: bool = False) -> Player:
    body: dict[str, Any] = {}
    if coins is not None:
        body["coins"] = coins
    if cars is not None:
        body["cars"] = cars
    if name:
        body["name"] = unique("racer")[0]
    r = httpx.post(base.rstrip("/") + "/v1/grading/players", json=body, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, r.text
    return Player(base, r.cookies["kerb_session"], r.json()["playerId"], body.get("name", ""))


def new_guest(base: str, car: str = "kestrel-hatch") -> Player:
    r = httpx.post(base.rstrip("/") + "/v1/guests", json={"ageConfirmed": True, "starterCarId": car},
                   timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, r.text
    return Player(base, r.cookies["kerb_session"], r.json()["playerId"], r.json()["name"])


def browser_player(page: Page, base: str) -> Player:
    cookie = next(c["value"] for c in page.context.cookies(base) if c["name"] == "kerb_session")
    return Player(base, cookie)


def balance(player: Player) -> int:
    return player.get("/v1/garage").json()["balance"]


def garage_car(player: Player, car_id: str) -> dict:
    return next(c for c in player.get("/v1/garage").json()["cars"] if c["carId"] == car_id)


def movements(player: Player, run_id: str | None = None) -> list[dict]:
    ms = player.get("/v1/ledger").json()["movements"]
    return [m for m in ms if m["runId"] == run_id] if run_id else ms


def wallet(player: Player, movement: dict) -> int:
    return sum(e["amount"] for e in movement["entries"] if e["account"] == f"wallet:{player.id}")


def payouts(player: Player, run_id: str) -> dict[str, int]:
    return {m["kind"]: wallet(player, m) for m in movements(player, run_id)}


def buy(player: Player, car: str, system: str, stage: int, layout_id: str = "saltflat-ring") -> dict:
    r = player.post(f"/v1/garage/cars/{car}/upgrades/{system}", {"stage": stage, "layoutId": layout_id},
                    key=idempotency_key())
    assert r.status_code == 201, r.text
    return r.json()


def new_run(player: Player, **body: Any) -> dict:
    r = player.post("/v1/runs", body)
    assert r.status_code == 201, r.text
    return r.json()


def finish(player: Player, run: dict, body: bytes) -> httpx.Response:
    return player.post(f"/v1/runs/{run['runId']}/finish", raw=body)


def submit(player: Player, inputs: list[dict], extra: dict | None = None, **run_body: Any) -> tuple[dict, bytes]:
    run = new_run(player, **run_body)
    body = compact({"seed": run["seed"], "inputs": inputs, **(extra or {})})
    answer = finish(player, run, body)
    assert answer.status_code == 202, answer.text
    return run, body


def race(player: Player, driver: str = "reference", **body: Any) -> str:
    r = player.post("/v1/grading/races", {**body, "driver": driver})
    assert r.status_code == 202, r.text
    return r.json()["runId"]


def settled(player: Player, run_id: str) -> dict:
    return poll(lambda: player.get(f"/v1/runs/{run_id}").json(),
                lambda r: r.get("status") in ("verified", "rejected"), SETTLE_S)


def complete_rookie(player: Player, car: str = "kestrel-hatch") -> None:
    ids = together(lambda: race(player, eventId="rookie-circuit", carId=car),
                   lambda: race(player, eventId="rookie-time-trial", carId=car))
    for rid in ids:
        assert settled(player, rid)["status"] == "verified"
    poll(lambda: league(player, "rookie")["status"], lambda s: s == "complete")


@contextlib.contextmanager
def opened(browser: Browser, base: str, path: str, player: Player | None = None, *, width: int = DESKTOP[0],
           height: int = DESKTOP[1], reduced_motion: str = "no-preference", no_webgl: bool = False,
           pushes: bool = False, clock_at: datetime | None = None) -> Iterator[Page]:
    base = base.rstrip("/")
    with open_app(browser, base + "/health", reduced_motion=reduced_motion, no_webgl=no_webgl) as p:
        p.set_viewport_size({"width": width, "height": height})
        if player is not None:
            p.context.add_cookies([{"name": "kerb_session", "value": player.cookie, "url": base,
                                    "httpOnly": True}])
        if pushes:
            frames = PUSHES.setdefault(id(p), [])

            def record(payload: Any) -> None:
                with contextlib.suppress(ValueError, TypeError):
                    frames.append(json.loads(payload))

            p.on("websocket", lambda ws: ws.on("framereceived", record))
        if clock_at is not None:
            p.clock.set_system_time(clock_at)
        p.goto(base + path)
        yield p


def pushes(page: Page) -> list[dict]:
    return list(PUSHES.get(id(page), []))


def wait_ui(page: Page, pred: Callable[[], bool], seconds: float = UI_WAIT_S, step_ms: float = 100) -> None:
    deadline = time.monotonic() + seconds
    while not pred():
        if time.monotonic() > deadline:
            raise AssertionError(f"page condition not met within {seconds} s at {page.url}")
        if step_ms:
            advance(page, step_ms)
        else:
            page.evaluate("0")


pump_until = wait_ui


def texts(locator: Locator) -> str:
    return " ".join(locator.all_inner_texts()) if locator.count() else ""


def wait_text(page: Page, locator: Locator, expected: "str | re.Pattern[str]", seconds: float = UI_WAIT_S,
              step_ms: float = 100) -> None:
    def seen() -> bool:
        t = texts(locator)
        return bool(expected.search(t)) if isinstance(expected, re.Pattern) else expected in t

    try:
        wait_ui(page, seen, seconds, step_ms)
    except AssertionError as exc:
        raise AssertionError(f"{expected!r} not shown; text was {texts(locator)!r}") from exc


def box(locator: Locator) -> dict[str, float]:
    b = locator.bounding_box()
    assert b, "element has no box"
    return b


def is_focused(locator: Locator) -> bool:
    return bool(locator.count()) and locator.evaluate("e => e === document.activeElement")


def tab_to(page: Page, target: Locator) -> None:
    for _ in range(TAB_LIMIT):
        if is_focused(target):
            return
        page.keyboard.press("Tab")
    raise AssertionError("control not reachable by Tab")


def focus_kept(page: Page, dialog: Locator, key: str, presses: int = 8) -> None:
    for _ in range(presses):
        page.keyboard.press(key)
        assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} left the dialog"


def chosen(locator: Locator) -> str:
    return locator.evaluate(
        "e => e.tagName === 'SELECT' ? e.options[e.selectedIndex].text.trim()"
        " : ('value' in e && e.value ? e.value : e.textContent).trim()")


def pick_car(page: Page, choice: str) -> None:
    car = page.get_by_role("combobox", name="Car")
    try:
        select(car, choice)
    except AssertionError as error:
        if "is not selected" not in str(error):
            raise
    wait_ui(page, lambda: car.evaluate(
        "(e, v) => [...e.selectedOptions].some(o => (o.label || o.text || '').trim() === v || o.value === v)", choice),
        step_ms=0)


def run_id_from(url: str) -> str:
    return urllib.parse.urlparse(url).path.rstrip("/").split("/")[-1]


def balance_region(p: Page) -> Locator:
    return p.get_by_role("status", name="Coin balance")


def pips(p: Page, system: str) -> Locator:
    return p.get_by_role("region", name="Upgrade slots").get_by_role("group", name=system)


def coins_shown(locator: Locator) -> int:
    return int(re.sub(r"\D", "", texts(locator)) or 0)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def tap_target(control: Locator) -> dict[str, float]:
    return control.evaluate(
        "e => { const rs = [e.getBoundingClientRect(),"
        " ...Array.from(e.labels || []).map(l => l.getBoundingClientRect())];"
        " const r = rs.reduce((a, b) => b.width * b.height > a.width * a.height ? b : a);"
        " return {width: r.width, height: r.height}; }")


@contextlib.contextmanager
def scratch_database() -> Iterator[str]:
    source = urllib.parse.urlparse(os.environ["DATABASE_URL"])
    name = "kerbline_scratch_" + os.urandom(6).hex()
    admin = os.environ["DATABASE_URL"]
    subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                   check=True, capture_output=True, timeout=HTTP_TIMEOUT_S)
    try:
        yield urllib.parse.urlunparse(source._replace(path="/" + name))
    finally:
        subprocess.run(["psql", admin, "-c", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'],
                       capture_output=True, timeout=HTTP_TIMEOUT_S)


class Announcements:

    def __init__(self, region: Locator):
        self.region = region
        self.samples: list[str] = []

    def sample(self) -> str:
        current = texts(self.region)
        self.samples.append(current)
        return current

    def count(self, copy: str) -> int:
        total, previous = 0, 0
        for s in self.samples:
            occurrences = s.count(copy)
            total += max(0, occurrences - previous)
            previous = occurrences
        return total


class Relay:

    def __init__(self, host: str, port: int):
        self.upstream = (host, port)
        self.port = free_port()
        self.server: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()

    def start(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.server = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s: socket.socket) -> None:
        while True:
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                up = socket.create_connection(self.upstream, timeout=HTTP_TIMEOUT_S)
                up.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, up]
            for a, b in ((client, up), (up, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for x in (a, b):
                with contextlib.suppress(OSError):
                    x.shutdown(socket.SHUT_RDWR)
                x.close()

    def stop(self) -> None:
        if self.server is not None:
            with contextlib.suppress(OSError):
                self.server.shutdown(socket.SHUT_RDWR)
            self.server.close()
            self.server = None
        with self.lock:
            for c in self.conns:
                with contextlib.suppress(OSError):
                    c.shutdown(socket.SHUT_RDWR)
                c.close()
            self.conns.clear()


@contextlib.contextmanager
def app_copy(env: dict[str, str]) -> Iterator[str]:
    serve = json.loads((APP / "run.json").read_text())["serve"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    log = tempfile.NamedTemporaryFile(prefix="kerbline-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True,
                            env={**os.environ, **env, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base})

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def health() -> int | None:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/health", timeout=STATUS_PROBE_S).status_code
        except httpx.HTTPError:
            return None

    try:
        poll(health, lambda s: s == 200, BOOT_S)
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


def test_guest_start_api(app_url):
    for car in STARTERS:
        r = httpx.post(app_url + "/v1/guests", json={"ageConfirmed": True, "starterCarId": car}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["balance"] == OPENING and re.fullmatch(r"Guest [A-Za-z0-9]{4}", body["name"])
        guest = Player(app_url, r.cookies["kerb_session"], body["playerId"])
        garage = guest.get("/v1/garage").json()
        assert [c["carId"] for c in garage["cars"]] == [car] and garage["selectedCarId"] == car
        assert set(garage["cars"][0]["stages"].values()) == {0}
        me = guest.get("/v1/me").json()
        assert me["guest"] is True and me["balance"] == OPENING
        ledger = movements(guest)
        assert [m["kind"] for m in ledger] == ["opening"] and wallet(guest, ledger[0]) == OPENING
        assert {e["account"] for e in ledger[0]["entries"]} == {f"wallet:{guest.id}", "house:grants"}
    for bad in ({"ageConfirmed": False, "starterCarId": "kestrel-hatch"}, {"starterCarId": "kestrel-hatch"},
                {"ageConfirmed": True, "starterCarId": "halcyon-rs"}, {"ageConfirmed": True}):
        r = httpx.post(app_url + "/v1/guests", json=bad, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED", (bad, r.text)
        assert "kerb_session" not in r.cookies


def test_wf_first_race_guest_start(browser, app_url):
    with opened(browser, app_url, "/") as p:
        expect(p.get_by_role("link", name="Leaderboards", exact=True)).to_have_count(0)
        box_ = p.get_by_role("checkbox", name="I am 13 or older")
        p.get_by_role("button", name="Start racing").focus()
        p.keyboard.press("Enter")
        expect(p.get_by_role("alert").filter(has_text=AGE_ERROR)).to_be_visible()
        expect(box_).to_be_focused()
        p.keyboard.press("Space")
        expect(box_).to_be_checked()
        group = p.get_by_role("radiogroup", name="Starter car")
        group.get_by_role("radio", name="Kestrel Hatch").focus()
        p.keyboard.press("Space")
        p.keyboard.press("ArrowDown")
        expect(group.get_by_role("radio", name="Wren Coupe")).to_be_checked()
        expect(group.get_by_role("radio", name="Wren Coupe")).to_be_focused()
        with held(p, "**/v1/guests") as gate:
            p.keyboard.press("Enter")
            expect(p.get_by_role("button", name="Starting…")).to_be_disabled()
            gate.release()
        wait_ui(p, lambda: p.url == app_url + GUIDED)
        expect(p.get_by_role("region", name="Race HUD")).to_be_focused()
        guest = browser_player(p, app_url)
    garage = guest.get("/v1/garage").json()
    assert [c["carId"] for c in garage["cars"]] == ["wren-coupe"] and garage["balance"] == OPENING
    assert guest.get("/v1/me").json()["guest"] is True


def test_wf_first_race_guided(browser, app_url):
    bodies: list[bytes] = []
    state = {"dropped": False}

    def blip(route):
        bodies.append(route.request.post_data_buffer)
        if state["dropped"]:
            route.continue_()
        else:
            state["dropped"] = True
            route.abort("connectionfailed")

    with opened(browser, app_url, "/") as p:
        p.route("**/v1/runs/*/finish", blip)
        p.get_by_role("checkbox", name="I am 13 or older").check()
        p.get_by_role("button", name="Start racing").click()
        wait_ui(p, lambda: p.url == app_url + GUIDED)
        hud = p.get_by_role("region", name="Race HUD")
        expect(hud).to_be_focused()
        wait_text(p, hud, "Press Enter to start")
        expect(hud).to_contain_text(hud_lap(1, 1))
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        wait_ui(p, lambda: "/runs/" in p.url, seconds=LAP_DRIVE_S, step_ms=1000)
        p.keyboard.up("ArrowUp")
        run_id = run_id_from(p.url)
        assert p.url == f"{app_url}/runs/{run_id}"
        expect(p.get_by_role("heading", name="Run result")).to_be_focused()
        result = p.get_by_role("status", name="Run result")
        wait_ui(p, lambda: len(bodies) >= 1, step_ms=0)
        expect(result).to_contain_text(VERIFYING)
        advance(p, RESEND_MS)
        wait_ui(p, lambda: len(bodies) >= 2, step_ms=0)
        assert bodies[1] == bodies[0], "the resent finish was not byte-identical"
        guest = browser_player(p, app_url)
        done = settled(guest, run_id)
        assert done["status"] == "verified"
        paid = GUIDED_PAYOUT + middle_lane_coins("saltflat-ring", 1)
        assert done["payout"] == paid
        wait_text(p, result, f"Verified: {fmt_time(done['raceMs'])}, +{fmt_coins(paid)} coins")
        p.go_back()
        assert "/race" not in p.url
        p.goto(app_url + "/garage")
        p.reload()
        expect(balance_region(p)).to_have_text(f"{fmt_coins(OPENING + paid)} coins")
    assert payouts(guest, run_id) == {"pickups": middle_lane_coins("saltflat-ring", 1), "result": GUIDED_PAYOUT}
    assert balance(guest) == OPENING + paid
    assert S3().get(f"replays/{run_id}.json") == bodies[0]


def test_finish_retried_once(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    run = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    body = compact({"seed": run["seed"], "inputs": COAST})
    answers = together(*[lambda: finish(racer, run, body) for _ in range(4)])
    assert [a.status_code for a in answers] == [202] * 4
    assert all(a.json()["status"] in ("submitted", "verifying", "verified") for a in answers)
    done = settled(racer, run["runId"])
    assert done["status"] == "verified"
    again = finish(racer, run, body)
    assert again.status_code == 202 and again.json() == {"runId": run["runId"], "status": "verified"}
    assert payouts(racer, run["runId"]) == {"pickups": middle_lane_coins("saltflat-ring", 1)}
    assert len(movements(racer, run["runId"])) == 1
    other = finish(racer, run, compact({"seed": run["seed"], "inputs": COAST, "note": 1}))
    assert other.status_code == 409 and other.json()["error"]["code"] == "ALREADY_SUBMITTED"
    assert S3().get(f"replays/{run['runId']}.json") == body
    assert racer.get(f"/v1/runs/{run['runId']}").json()["replaySha256"] == sha(body)


def test_wf_first_race_hud(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    accel = CARS["kestrel-hatch"][0]
    with opened(browser, app_url, race_path("saltflat-ring", "practice", laps=2), racer) as p:
        hud = p.get_by_role("region", name="Race HUD")
        expect(p.get_by_role("img", name="Race view")).to_be_visible()
        wait_text(p, hud, "Press Enter to start")
        for part in (hud_lap(1, 2), hud_speed(0), hud_coins(0)):
            expect(hud).to_contain_text(part)
        hud.focus()
        p.keyboard.press("Enter")
        p.keyboard.down("w")
        pause = p.get_by_role("button", name="Pause")
        pause.focus()
        advance(p, 2000)
        expect(hud).to_contain_text(hud_speed(round(2 * accel * KMH)))
        expect(hud).to_contain_text(hud_coins(0))
        p.keyboard.press("Space")
        advance(p, 100)
        expect(p.get_by_role("dialog", name="Paused")).to_be_hidden()
        advance(p, 9900)
        expect(hud).to_contain_text(f"Coins {coin_value(1) + coin_value(2)}")
        updates = p.get_by_role("status", name="Race updates")
        first_lap = 1
        lap_done = f"Lap {first_lap}:"
        wait_ui(p, lambda: lap_done in texts(updates), seconds=LAP_DRIVE_S, step_ms=1000)
        lap = re.search(re.escape(lap_done) + r" (\d+:\d{2}\.\d{3})(, invalid)?", texts(updates))
        assert lap, texts(updates)
        expect(hud).to_contain_text(hud_lap(2, 2))
        wait_ui(p, lambda: "/runs/" in p.url, seconds=LAP_DRIVE_S, step_ms=1000)
        p.keyboard.up("w")
        run = settled(racer, run_id_from(p.url))
    first = run["lapResults"][0]
    assert lap.group(1) == fmt_time(first["lapMs"]) and bool(lap.group(2)) == (first["valid"] is False)
    with opened(browser, app_url, race_path("saltflat-ring", "circuit"), racer) as p:
        hud = p.get_by_role("region", name="Race HUD")
        wait_text(p, hud, "Press Enter to start")
        expect(hud).to_contain_text(hud_position(1, 3))
        expect(hud).to_contain_text(hud_lap(1, 3))
    with opened(browser, app_url, race_path("saltflat-ring", "circuit"), racer, width=768, height=1024) as p:
        expect(p.get_by_text(DESKTOP_NOTICE)).to_be_visible()
        expect(p.get_by_role("img", name="Race view")).to_have_count(0)
        expect(p.get_by_role("region", name="Race HUD")).to_have_count(0)


def test_wf_first_race_landing(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"])
    lobby_id = host.post("/v1/lobbies", {"aiCount": 0}).json()["lobbyId"]
    good = f"/lobby/{lobby_id}"
    q = lambda v: urllib.parse.quote(v, safe="")
    cases = [
        (q(good), good),
        (q(FOREIGN + good), GUIDED),
        (q(DOUBLE_SLASH + EVIL + good), GUIDED),
        (ENCODED_SLASHES + EVIL, GUIDED),
        (q("/garage"), GUIDED),
        (q(good + EXTRA_SEGMENT), GUIDED),
        (q("/lobby/"), GUIDED),
    ]
    for raw, landing in cases:
        with opened(browser, app_url, f"/?next={raw}") as p:
            p.get_by_role("checkbox", name="I am 13 or older").check()
            p.get_by_role("button", name="Start racing").click()
            wait_ui(p, lambda: p.url == app_url + landing)
            focus = p.get_by_role("region", name="Race HUD") if landing == GUIDED else \
                p.get_by_role("button", name="Join lobby")
            expect(focus).to_be_focused()
    with opened(browser, app_url, "/garage") as p:
        wait_ui(p, lambda: p.url == app_url + "/")
    with opened(browser, app_url, good) as p:
        wait_ui(p, lambda: urllib.parse.urlparse(p.url).path == "/")
        assert urllib.parse.parse_qs(urllib.parse.urlparse(p.url).query)["next"] == [good]
    with opened(browser, app_url, "/", host) as p:
        wait_ui(p, lambda: p.url == app_url + "/garage")
    finishes: list[str] = []
    with opened(browser, app_url, race_path("saltflat-ring", "time-trial"), host) as p:
        p.on("request", lambda r: finishes.append(r.url) if r.url.endswith("/finish") else None)
        hud = p.get_by_role("region", name="Race HUD")
        wait_text(p, hud, "Press Enter to start")
        hud.focus()
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        advance(p, 1000)
        p.keyboard.press("Escape")
        p.get_by_role("dialog", name="Paused").get_by_role("button", name="Quit to garage").click()
        p.keyboard.up("ArrowUp")
        wait_ui(p, lambda: p.url == app_url + "/garage")
        expect(p.get_by_role("link", name="Garage", exact=True)).to_be_focused()
        advance(p, 5000)
        assert finishes == []
    run_id = race(host, eventId="rookie-time-trial", carId="kestrel-hatch")
    settled(host, run_id)
    with opened(browser, app_url, f"/runs/{run_id}", host) as p:
        p.get_by_role("link", name="Back to championship").click()
        wait_ui(p, lambda: p.url == app_url + "/championship")
        expect(p.get_by_role("button", name=enter_name("Rookie Time Trial"))).to_be_focused()
        p.goto(f"{app_url}/runs/{run_id}")
        p.get_by_role("link", name="Back to garage").click()
        wait_ui(p, lambda: p.url == app_url + "/garage")


def test_upgrade_purchase_rules(app_url):
    racer = new_player(app_url, coins=2700, cars=["kestrel-hatch"])
    path = upgrade_path("kestrel-hatch", "brakes")
    r = racer.post(path, {"stage": 1, "layoutId": "saltflat-ring", "price": 1, "balance": 99999, "pi": 999,
                          "overClassLimit": True, "stats": {"brakeMps2": 99}}, key=idempotency_key())
    assert r.status_code == 201, r.text
    b = r.json()
    pi = CARS["kestrel-hatch"][4] + BRAKES_PI
    assert (b["carId"], b["system"], b["stage"], b["price"]) == ("kestrel-hatch", "brakes", 1, PRICES["D"][0])
    assert b["balance"] == 2700 - PRICES["D"][0] and b["pi"] == pi and b["overClassLimit"] is False
    car = garage_car(racer, "kestrel-hatch")
    assert car["stages"]["brakes"] == 1 and car["pi"] == pi and car["paid"]["brakes"] == PRICES["D"][0]
    assert car["stats"]["brakeMps2"] == CARS["kestrel-hatch"][1] + BRAKES_STEP
    assert car["latestReference"] == b["reference"]
    top = movements(racer)[0]
    assert top["kind"] == "upgrade" and wallet(racer, top) == -PRICES["D"][0]

    def snapshot():
        return balance(racer), garage_car(racer, "kestrel-hatch")["stages"], len(movements(racer))

    before = snapshot()
    refusals = [
        (path, {"stage": 3, "layoutId": "saltflat-ring"}, 409, "STAGE_OUT_OF_ORDER"),
        (path, {"stage": 1, "layoutId": "saltflat-ring"}, 409, "STAGE_OUT_OF_ORDER"),
        (path, {"stage": "2", "layoutId": "saltflat-ring"}, 422, "VALIDATION_FAILED"),
        (path, {"stage": 2.5, "layoutId": "saltflat-ring"}, 422, "VALIDATION_FAILED"),
        (path, {"stage": 2, "layoutId": "quarry-switchbacks"}, 403, "LAYOUT_LOCKED"),
        (upgrade_path("kestrel-hatch", UNKNOWN_SYSTEM), {"stage": 1, "layoutId": "saltflat-ring"}, 404, "NOT_FOUND"),
        (upgrade_path("halcyon-rs", "brakes"), {"stage": 1, "layoutId": "saltflat-ring"}, 404, "NOT_FOUND"),
    ]
    for target, body, status, code in refusals:
        r = racer.post(target, body, key=idempotency_key())
        assert r.status_code == status and r.json()["error"]["code"] == code, (body, r.text)
        assert snapshot() == before
    r = racer.post(path, {"stage": 2, "layoutId": "saltflat-ring"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    assert buy(racer, "kestrel-hatch", "brakes", 2)["price"] == PRICES["D"][1]
    assert buy(racer, "kestrel-hatch", "brakes", 3)["price"] == PRICES["D"][2]
    r = racer.post(path, {"stage": 4, "layoutId": "saltflat-ring"}, key=idempotency_key())
    assert r.status_code == 409 and r.json()["error"]["code"] == "STAGE_OUT_OF_ORDER"
    poor = snapshot()
    assert poor[0] == 2700 - sum(PRICES["D"])
    tires = upgrade_path("kestrel-hatch", "tires")
    for body, status, code in (({"stage": 1, "layoutId": "saltflat-ring"}, 402, "INSUFFICIENT_COINS"),
                               ({"stage": 2, "layoutId": "saltflat-ring"}, 409, "STAGE_OUT_OF_ORDER"),
                               ({"stage": "x", "layoutId": "saltflat-ring"}, 422, "VALIDATION_FAILED")):
        r = racer.post(tires, body, key=idempotency_key())
        assert r.status_code == status and r.json()["error"]["code"] == code, r.text
        assert snapshot() == poor
    for car_id, cls in (("halcyon-rs", "C"), ("vantor-8", "B")):
        rich = new_player(app_url, coins=PRICES[cls][0], cars=[car_id])
        bought = buy(rich, car_id, "engine", 1)
        assert bought["price"] == PRICES[cls][0] and bought["balance"] == 0 == balance(rich)


def test_reference_lap_result(app_url):
    racer = new_player(app_url, coins=5000, cars=["kestrel-hatch", "halcyon-rs"])
    for car, layout_id in (("kestrel-hatch", "saltflat-ring"), ("halcyon-rs", "quarry-switchbacks")):
        if layout_id == "quarry-switchbacks":
            complete_rookie(racer)
        old = settled(racer, race(racer, layoutId=layout_id, mode="practice", carId=car))
        ref = buy(racer, car, "engine", 1, layout_id)["reference"]
        new = settled(racer, race(racer, layoutId=layout_id, mode="practice", carId=car))
        o, n = old["lapResults"][0], new["lapResults"][0]
        assert ref["layoutId"] == layout_id
        assert (ref["oldLapMs"], ref["oldSectorsMs"]) == (o["lapMs"], o["sectorsMs"])
        assert (ref["newLapMs"], ref["newSectorsMs"]) == (n["lapMs"], n["sectorsMs"])
        assert ref["deltaMs"] == n["lapMs"] - o["lapMs"] < 0
        assert ref["sectorDeltasMs"] == [b - a for a, b in zip(o["sectorsMs"], n["sectorsMs"])]
        assert ref["price"] == PRICES[{"kestrel-hatch": "D", "halcyon-rs": "C"}[car]][0]
        assert garage_car(racer, car)["latestReference"] == ref


def test_purchases_idempotent(browser, app_url):
    racer = new_player(app_url, coins=500, cars=["kestrel-hatch"])
    engine = upgrade_path("kestrel-hatch", "engine")
    tires = upgrade_path("kestrel-hatch", "tires")
    body = {"stage": 1, "layoutId": "saltflat-ring"}
    key = idempotency_key()
    answers = together(*[lambda: racer.post(engine, body, key=key) for _ in range(3)])
    assert [a.status_code for a in answers] == [201] * 3
    assert answers[0].json() == answers[1].json() == answers[2].json()
    again = racer.post(engine, body, key=key)
    assert again.status_code == 201 and again.json() == answers[0].json()
    assert [m["kind"] for m in movements(racer)].count("upgrade") == 1 and balance(racer) == 500 - PRICES["D"][0]
    reused = racer.post(engine, {"stage": 2, "layoutId": "saltflat-ring"}, key=key)
    assert reused.status_code == 409 and reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    short = idempotency_key()
    first = racer.post(tires, body, key=short)
    assert first.status_code == 402
    refit_key = idempotency_key()
    refit = racer.post(refit_path("kestrel-hatch", "engine"), {}, key=refit_key)
    assert refit.status_code == 201
    refit_again = racer.post(refit_path("kestrel-hatch", "engine"), {}, key=refit_key)
    assert refit_again.status_code == 201 and refit_again.json() == refit.json()
    assert [m["kind"] for m in movements(racer)].count("refit") == 1
    covered = balance(racer)
    assert covered == 500 - PRICES["D"][0] + PRICES["D"][0] // 2 >= PRICES["D"][0]
    replay = racer.post(tires, body, key=short)
    assert replay.status_code == 402 and replay.json() == first.json() and balance(racer) == covered
    assert racer.post(tires, body, key=idempotency_key()).status_code == 201
    shopper = new_player(app_url, coins=HALCYON_PRICE, cars=["kestrel-hatch"])
    car_key = idempotency_key()
    bought = shopper.post("/v1/garage/cars", {"carId": "halcyon-rs"}, key=car_key)
    assert bought.status_code == 201 and bought.json() == {"carId": "halcyon-rs", "balance": 0}
    replayed = shopper.post("/v1/garage/cars", {"carId": "halcyon-rs"}, key=car_key)
    assert replayed.status_code == 201 and replayed.json() == bought.json()
    assert [m["kind"] for m in movements(shopper)].count("car") == 1 and balance(shopper) == 0
    conflict = shopper.post("/v1/garage/cars", {"carId": "ferrule-sport"}, key=car_key)
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    refusals = [({"carId": "halcyon-rs"}, 409, "ALREADY_OWNED"), ({"carId": "kestrel-hatch"}, 409, "ALREADY_OWNED"),
                ({"carId": "wren-coupe"}, 409, "NOT_FOR_SALE"), ({"carId": "hover-car"}, 404, "NOT_FOUND"),
                ({}, 422, "VALIDATION_FAILED"), ({"carId": 42}, 422, "VALIDATION_FAILED"),
                ({"carId": "ferrule-sport"}, 402, "INSUFFICIENT_COINS")]
    for req, status, code in refusals:
        r = shopper.post("/v1/garage/cars", req, key=idempotency_key())
        assert r.status_code == status and r.json()["error"]["code"] == code, (req, r.text)
    assert {c["carId"] for c in shopper.get("/v1/garage").json()["cars"]} == {"kestrel-hatch", "halcyon-rs"}
    assert balance(shopper) == 0 and FERRULE_PRICE > 0
    clicker = new_player(app_url, cars=["kestrel-hatch"])
    keys: list[str] = []
    with opened(browser, app_url, "/garage", clicker) as p:
        p.on("request", lambda r: keys.append(r.header_value("Idempotency-Key") or "")
             if upgrade_path("kestrel-hatch", "tires") in r.url and r.method == "POST" else None)
        p.get_by_role("button", name=upgrade_name("Tires", 1)).click()
        p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
            "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").dblclick()
        advance(p, SWEEP_DONE_MS)
        wait_text(p, p.get_by_role("status", name="Garage updates"), fitted("Tires", 1))
    assert keys and len(set(keys)) == 1, keys
    assert [m["kind"] for m in movements(clicker)].count("upgrade") == 1
    assert balance(clicker) == OPENING - PRICES["D"][0]


def test_wf_upgrade_purchase_keyboard(browser, app_url):
    racer = new_player(app_url, coins=3000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "brakes", 1)
    start = balance(racer)
    after = start - PRICES["D"][1]
    with opened(browser, app_url, "/garage", racer) as p:
        opener = pips(p, "Brakes").get_by_role("button", name=upgrade_name("Brakes", 2))
        tab_to(p, opener)
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name="Confirm upgrade")
        buy_btn = dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][1])} coins")
        expect(buy_btn).to_be_focused()
        focus_kept(p, dialog, "Tab")
        focus_kept(p, dialog, "Shift+Tab")
        p.keyboard.press("Escape")
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert balance(racer) == start
        p.keyboard.press("Enter")
        expect(buy_btn).to_be_focused()
        p.keyboard.press("Enter")
        advance(p, 500)
        expect(pips(p, "Brakes").get_by_role("button", name=upgrade_name("Brakes", 3))).to_be_focused()
        advance(p, SWEEP_DONE_MS)
        wait_text(p, p.get_by_role("status", name="Garage updates"),
                  f"{fitted('Brakes', 2)} Balance: {fmt_coins(after)} coins.")
    assert garage_car(racer, "kestrel-hatch")["stages"]["brakes"] == 2
    assert balance(racer) == after
    assert [m["kind"] for m in movements(racer)].count("upgrade") == 2


def test_wf_upgrade_purchase_reload(browser, app_url):
    racer = new_player(app_url, coins=3000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "brakes", 1)
    after = balance(racer) - PRICES["D"][1]
    pi = CARS["kestrel-hatch"][4] + 2 * BRAKES_PI
    braking = f"{CARS['kestrel-hatch'][1] + 2 * BRAKES_STEP:.1f} m/s²"

    def committed(p: Page) -> None:
        p.evaluate("document.activeElement && document.activeElement.blur()")
        advance(p, 2 * PREVIEW_MS)
        expect(pips(p, "Brakes").get_by_role("img", name=stage_img(2))).to_be_visible()
        expect(p.get_by_role("meter", name="Braking")).to_have_attribute("aria-valuetext", braking)
        expect(p.get_by_role("region", name="Car")).to_contain_text(str(pi))
        expect(balance_region(p)).to_have_text(f"{fmt_coins(after)} coins")

    with opened(browser, app_url, "/garage", racer) as p:
        p.get_by_role("button", name=upgrade_name("Brakes", 2)).click()
        p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
            "button", name=f"Buy for {fmt_coins(PRICES['D'][1])} coins").click()
        advance(p, SWEEP_DONE_MS)
        committed(p)
        p.reload()
        committed(p)
        with opened(browser, app_url, "/garage", racer) as other:
            committed(other)
    car = garage_car(racer, "kestrel-hatch")
    assert car["stages"]["brakes"] == 2 and car["pi"] == pi and balance(racer) == after


def test_wf_upgrade_purchase_unconfirmed(browser, app_url):
    racer = new_player(app_url, coins=3000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "brakes", 1)
    start = balance(racer)
    sent: list[tuple[str, bytes]] = []
    mode = {"drop": True}

    def lossy(route):
        sent.append((route.request.header_value("Idempotency-Key") or "", route.request.post_data_buffer))
        if mode["drop"]:
            route.fetch()
            route.abort("connectionfailed")
        else:
            route.continue_()

    with opened(browser, app_url, "/garage", racer) as p:
        p.route("**/upgrades/**", lossy)
        updates = p.get_by_role("status", name="Garage updates")
        p.get_by_role("button", name=upgrade_name("Brakes", 2)).click()
        dialog = p.get_by_role("dialog", name="Confirm upgrade")
        dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][1])} coins").press("Enter")
        wait_text(p, dialog, UNCONFIRMED, step_ms=0)
        check_again = dialog.get_by_role("button", name="Check again")
        advance(p, 50)
        expect(check_again).to_be_focused()
        poll(lambda: balance(racer), lambda b: b == start - PRICES["D"][1])
        advance(p, SWEEP_DONE_MS)
        expect(pips(p, "Brakes").get_by_role("img", name=stage_img(1))).to_be_visible()
        expect(p.get_by_role("region", name="Setup sheet").get_by_role("meter", name="Braking")).to_have_attribute(
            "aria-valuetext", f"{CARS['kestrel-hatch'][1] + BRAKES_STEP:.1f} m/s²")
        expect(balance_region(p)).to_have_text(f"{fmt_coins(start)} coins")
        mode["drop"] = False
        check_again.press("Enter")
        advance(p, SWEEP_DONE_MS)
        wait_text(p, updates, fitted("Brakes", 2))
        assert len(sent) == 2 and sent[0] == sent[1], "Check again did not resend the same key and bytes"
        expect(pips(p, "Brakes").get_by_role("img", name=stage_img(2))).to_be_visible()
        expect(balance_region(p)).to_have_text(f"{fmt_coins(start - PRICES['D'][1])} coins")
        advance(p, SWEEP_DONE_MS * 2)
        assert texts(updates).count(fitted("Brakes", 2)) <= 1
        assert [m["kind"] for m in movements(racer)].count("upgrade") == 2
        p.get_by_role("button", name=upgrade_name("Tires", 1)).click()
        expect(dialog).to_be_visible()
        buy(racer, "kestrel-hatch", "tires", 1)
        dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        wait_text(p, updates, REFRESHED)
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(pips(p, "Tires").get_by_role("img", name=stage_img(1))).to_be_visible()
        expect(pips(p, "Tires").get_by_role("button", name=upgrade_name("Tires", 2))).to_be_focused()
        mode["drop"] = True
        p.get_by_role("button", name=upgrade_name("Engine", 1)).click()
        dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        wait_text(p, dialog, UNCONFIRMED, step_ms=0)
        expect(pips(p, "Engine").get_by_role("img", name=stage_img(0))).to_be_visible()
        advance(p, 50)
        p.keyboard.press("Escape")
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(pips(p, "Engine").get_by_role("img", name=stage_img(1))).to_be_visible()
        expect(pips(p, "Engine").get_by_role("button", name=upgrade_name("Engine", 2))).to_be_focused()
        final = start - PRICES["D"][1] - 2 * PRICES["D"][0]
        expect(balance_region(p)).to_have_text(f"{fmt_coins(final)} coins")
        wait_text(p, updates, REFRESHED)
    assert balance(racer) == final and [m["kind"] for m in movements(racer)].count("upgrade") == 4


def test_wf_reference_sweep_order(browser, app_url):
    racer = new_player(app_url, coins=SWEEP_COINS, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer, pushes=True) as p:
        bal = balance_region(p)
        expect(bal).to_have_text(f"{fmt_coins(SWEEP_COINS)} coins")
        figure = p.get_by_role("figure", name="Reference lap")
        p.get_by_role("button", name=upgrade_name("Engine", 1)).click()
        with p.expect_response(lambda r: upgrade_path("kestrel-hatch", "engine") in r.url
                               and r.request.method == "POST") as info:
            p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
                "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        body = info.value.json()
        ref, after = body["reference"], body["balance"]
        wait_ui(p, lambda: any(m.get("type") == "balance" and m.get("purchaseId") == body["purchaseId"]
                               for m in pushes(p)), step_ms=0)
        flips: dict[int, int] = {}
        shown: list[tuple[int, int]] = []
        for t in range(0, BALANCE_STEP_MS + 100, 100):
            now = texts(figure)
            for i, d in enumerate(ref["sectorDeltasMs"], start=1):
                if i not in flips and f"S{i} {fmt_delta(d)}" in now:
                    flips[i] = t
            shown.append((t, coins_shown(bal)))
            if t < BALANCE_STEP_MS:
                advance(p, 100)
        advance(p, SWEEP_FRAME_SLACK_MS)
        shown.append((BALANCE_STEP_MS + SWEEP_FRAME_SLACK_MS, coins_shown(bal)))
        assert set(flips) == {1, 2, 3} and flips[1] <= flips[2] <= flips[3] and flips[1] < flips[3], flips
        assert all(v == SWEEP_COINS for t, v in shown if t < MARKER_MS), shown
        values = [v for _, v in shown]
        assert values == sorted(values, reverse=True) and values[-1] == after, shown
        expect(figure).to_contain_text(f"Predicted lap {fmt_time(ref['newLapMs'])}")
        old = figure.get_by_text(fmt_time(ref["oldLapMs"]), exact=True).first
        assert struck(old)
        advance(p, SWEEP_DONE_MS - BALANCE_STEP_MS)
        expect(pips(p, "Engine").get_by_role("img", name=stage_img(1))).to_be_visible()
        wait_text(p, p.get_by_role("status", name="Garage updates"),
                  f"{fitted('Engine', 1)} Balance: {fmt_coins(after)} coins. {summary(ref)}")
        expect(figure).to_contain_text(f"Cost −{fmt_coins(PRICES['D'][0])} coins")
        p.reload()
        expect(figure).to_contain_text(f"Predicted lap {fmt_time(ref['newLapMs'])}")
        for i, d in enumerate(ref["sectorDeltasMs"], start=1):
            expect(figure).to_contain_text(f"S{i} {fmt_delta(d)}")
        assert animations(figure) == []
        expect(bal).to_have_text(f"{fmt_coins(after)} coins")
        expect(pips(p, "Engine").get_by_role("img", name=stage_img(1))).to_be_visible()


def test_wf_reference_sweep_reduced_motion(browser, app_url):
    racer = new_player(app_url, coins=2000, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer, reduced_motion="reduce") as p:
        figure = p.get_by_role("figure", name="Reference lap")
        p.get_by_role("button", name=upgrade_name("Tires", 1)).click()
        with p.expect_response(lambda r: upgrade_path("kestrel-hatch", "tires") in r.url
                               and r.request.method == "POST") as info:
            p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
                "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        body = info.value.json()
        ref = body["reference"]
        advance(p, RM_PAINT_MS)
        expect(figure).to_contain_text(summary(ref))
        expect(figure).to_contain_text(f"Predicted lap {fmt_time(ref['newLapMs'])}")
        for i, d in enumerate(ref["sectorDeltasMs"], start=1):
            expect(figure).to_contain_text(f"S{i} {fmt_delta(d)}")
        if ref["deltaMs"]:
            old = figure.get_by_text(fmt_time(ref["oldLapMs"]), exact=True).first
            assert struck(old)
        expect(balance_region(p)).to_have_text(f"{fmt_coins(body['balance'])} coins")
        expect(pips(p, "Tires").get_by_role("img", name=stage_img(1))).to_be_visible()
        expect(p.get_by_role("status", name="Garage updates")).to_contain_text(summary(ref))
        assert animations(figure) == []


def test_wf_reference_sweep_preview(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    accel, _, top = CARS["kestrel-hatch"][:3]
    rest_accel = f"{accel:.1f} m/s²"
    rest_top = f"{round(top * KMH)} km/h"
    preview_accel = f"{rest_accel} → {accel + ENGINE_ACCEL:.1f} m/s²"
    preview_top = f"{rest_top} → {round((top + ENGINE_TOP) * KMH)} km/h"
    with opened(browser, app_url, "/garage", racer) as p:
        sheet = p.get_by_role("region", name="Setup sheet")
        acc = sheet.get_by_role("meter", name="Acceleration")
        spd = sheet.get_by_role("meter", name="Top speed")
        expect(acc).to_have_attribute("aria-valuetext", rest_accel)
        expect(spd).to_have_attribute("aria-valuetext", rest_top)
        resting = decode(capture(sheet))
        button = p.get_by_role("button", name=upgrade_name("Engine", 1))
        tab_to(p, button)
        advance(p, PREVIEW_MS * 2)
        expect(acc).to_have_attribute("aria-valuetext", preview_accel)
        expect(spd).to_have_attribute("aria-valuetext", preview_top)
        extended = decode(capture(sheet))
        assert difference(resting, extended) > 0, "stat bars did not extend for the preview"
        button.evaluate("b => b.blur()")
        retracting = animations(sheet)
        advance(p, PREVIEW_MS // 2)
        mid = decode(capture(sheet))
        assert retracting or (difference(resting, mid) > 0 and difference(extended, mid) > 0), "bars jumped instead of retracting"
        advance(p, PREVIEW_MS * 2)
        expect(acc).to_have_attribute("aria-valuetext", rest_accel)
        expect(spd).to_have_attribute("aria-valuetext", rest_top)
        assert difference(resting, decode(capture(sheet))) < difference(resting, extended), "bars did not retract"
        button.hover()
        advance(p, PREVIEW_MS * 2)
        expect(acc).to_have_attribute("aria-valuetext", preview_accel)
        p.mouse.move(0, 0)
        advance(p, PREVIEW_MS * 2)
        expect(acc).to_have_attribute("aria-valuetext", rest_accel)
    with opened(browser, app_url, "/garage", racer, reduced_motion="reduce") as p:
        acc = p.get_by_role("meter", name="Acceleration")
        expect(acc).to_have_attribute("aria-valuetext", rest_accel)
        p.get_by_role("button", name=upgrade_name("Engine", 1)).focus()
        expect(acc).to_have_attribute("aria-valuetext", preview_accel)


def test_wf_reference_sweep_interrupted(browser, app_url):
    racer = new_player(app_url, coins=SWEEP_COINS, cars=["kestrel-hatch", "wren-coupe"])
    assert racer.patch("/v1/garage", {"selectedCarId": "kestrel-hatch"}).status_code == 200
    after = SWEEP_COINS - PRICES["D"][0]
    with opened(browser, app_url, "/garage", racer) as p:
        p.get_by_role("button", name=upgrade_name("Engine", 1)).click()
        with p.expect_response(lambda r: upgrade_path("kestrel-hatch", "engine") in r.url
                               and r.request.method == "POST") as info:
            p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
                "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        ref = info.value.json()["reference"]
        advance(p, 500)
        pick_car(p, "Wren Coupe")
        updates = p.get_by_role("status", name="Garage updates")
        expect(balance_region(p)).to_have_text(f"{fmt_coins(after)} coins")
        expect(updates).to_contain_text(fitted("Engine", 1))
        wren = f"{CARS['wren-coupe'][0]:.1f} m/s²"
        expect(p.get_by_role("meter", name="Acceleration")).to_have_attribute("aria-valuetext", wren)
        advance(p, SWEEP_DONE_MS * 2)
        expect(p.get_by_role("meter", name="Acceleration")).to_have_attribute("aria-valuetext", wren)
        assert texts(updates).count(fitted("Engine", 1)) == 1
        expect(balance_region(p)).to_have_text(f"{fmt_coins(after)} coins")
        pick_car(p, "Kestrel Hatch")
        figure = p.get_by_role("figure", name="Reference lap")
        expect(figure).to_contain_text(f"S1 {fmt_delta(ref['sectorDeltasMs'][0])}")
        expect(figure).to_contain_text(f"Predicted lap {fmt_time(ref['newLapMs'])}")
    assert balance(racer) == after


def test_wf_garage_phone_breakpoints(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer) as p:
        for width, height in [(375, 812), (768, 1024), (TWO_COLUMN_MAX, 800), (1280, 800)]:
            p.set_viewport_size({"width": width, "height": height})
            p.goto(app_url + "/garage")
            expect(balance_region(p)).to_be_visible()
            car, slots, sheet = (box(p.get_by_role("region", name=n)) for n in ("Car", "Upgrade slots", "Setup sheet"))
            layout(p)
            if width < 768:
                assert car["y"] + car["height"] <= slots["y"] + 1 and slots["y"] + slots["height"] <= sheet["y"] + 1
            elif width <= TWO_COLUMN_MAX:
                assert car["x"] + car["width"] <= slots["x"] + 1
                assert car["y"] < slots["y"] + slots["height"] and slots["y"] < car["y"] + car["height"]
                assert sheet["y"] >= max(car["y"] + car["height"], slots["y"] + slots["height"]) - 1
                assert sheet["width"] >= slots["x"] + slots["width"] - car["x"] - 1
            else:
                assert car["x"] + car["width"] <= slots["x"] + 1 and slots["x"] + slots["width"] <= sheet["x"] + 1
                for a, b in ((car, slots), (slots, sheet)):
                    assert a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]


def test_wf_garage_phone_touch(browser, app_url):
    racer = new_player(app_url, coins=2000, cars=["kestrel-hatch", "wren-coupe"])
    buy(racer, "kestrel-hatch", "engine", 1)
    with opened(browser, app_url, "/garage", racer, width=375, height=812) as p:
        expect(balance_region(p)).to_be_visible()
        pick_car(p, "Wren Coupe")
        poll(lambda: racer.get("/v1/garage").json()["selectedCarId"], lambda v: v == "wren-coupe")
        pick_car(p, "Kestrel Hatch")
        poll(lambda: racer.get("/v1/garage").json()["selectedCarId"], lambda v: v == "kestrel-hatch")
        for role in ("button", "link", "combobox", "radio"):
            for control in p.get_by_role(role).all():
                if control.is_visible():
                    b = tap_target(control)
                    assert b["width"] >= TOUCH_TARGET_PX and b["height"] >= TOUCH_TARGET_PX, (role, b)
        expect(p.get_by_role("meter", name="Grip")).to_be_visible()
        tap(p.get_by_role("button", name=upgrade_name("Tires", 1)))
        tap(p.get_by_role("dialog", name="Confirm upgrade").get_by_role(
            "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins"))
        wait_text(p, p.get_by_role("status", name="Garage updates"), fitted("Tires", 1))
        tap(p.get_by_role("button", name=refit_name("Engine")))
        refund = PRICES["D"][0] // 2
        tap(p.get_by_role("dialog", name="Confirm refit").get_by_role("button", name=f"Refit and refund {refund} coins"))
        wait_text(p, p.get_by_role("status", name="Garage updates"), refitted("Engine"))
        expected = 2000 - PRICES["D"][0] * 2 + refund
        tap(p.get_by_role("link", name="Coin history"))
        wait_ui(p, lambda: p.url == app_url + "/garage/coins")
        totals = p.get_by_role("region", name="Coin totals")
        expect(totals).to_contain_text(f"Balance {fmt_coins(expected)} coins")
        expect(totals).to_contain_text(f"Ledger total {fmt_coins(expected)} coins")
    car = garage_car(racer, "kestrel-hatch")
    assert car["stages"]["tires"] == 1 and car["stages"]["engine"] == 0 and balance(racer) == expected


def test_wf_garage_phone_menu(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    names = ["Garage", "Leaderboards", "Championship", "Online lobby"]
    with opened(browser, app_url, "/garage", racer, width=375, height=812) as p:
        menu = p.get_by_role("button", name="Menu")
        expect(p.get_by_role("button", name="Menu", expanded=False)).to_be_visible()
        assert menu.evaluate("b => !!b.getAttribute('aria-controls')")
        for n in names:
            assert p.get_by_role("link", name=n, exact=True).count() == 0
        assert not {n.casefold() for n in names} & {n.casefold() for n in tab_order(p, 25)}
        layout(p)
        tap(menu)
        expect(p.get_by_role("button", name="Menu", expanded=True)).to_be_visible()
        assert menu.evaluate("b => !!document.getElementById(b.getAttribute('aria-controls'))")
        links = [p.get_by_role("link", name=n, exact=True) for n in names]
        expect(links[0]).to_be_focused()
        ys = [box(l)["y"] for l in links]
        assert ys == sorted(ys) and ys[0] >= box(menu)["y"]
        layout(p)
        p.keyboard.press("Escape")
        expect(p.get_by_role("button", name="Menu", expanded=False)).to_be_visible()
        expect(menu).to_be_focused()
        tap(menu)
        tap(p.get_by_role("link", name="Leaderboards", exact=True))
        wait_ui(p, lambda: urllib.parse.urlparse(p.url).path == "/boards")
        expect(p.get_by_role("button", name="Menu", expanded=False)).to_be_visible()
        assert p.get_by_role("link", name="Leaderboards", exact=True).count() == 0
        p.set_viewport_size({"width": 768, "height": 1024})
        for n in names:
            expect(p.get_by_role("link", name=n, exact=True)).to_be_visible()
        assert p.get_by_role("button", name="Menu").count() == 0


def test_car_view_3d(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer) as p:
        view = p.get_by_role("img", name=car_img("Kestrel Hatch", "3D view"))
        expect(view).to_be_visible()
        frames = scene_frames(view, steps=4, step_ms=500)
        assert any(f["draws"] > 0 for f in frames)
        assert difference(decode(frames[1]["png"]), decode(frames[-1]["png"])) > 0, "car did not turn while idle"
    with opened(browser, app_url, "/garage", racer, reduced_motion="reduce") as p:
        view = p.get_by_role("img", name=car_img("Kestrel Hatch", "3D view"))
        expect(view).to_be_visible()
        frames = scene_frames(view, steps=4, step_ms=500)
        assert difference(decode(frames[1]["png"]), decode(frames[-1]["png"])) == 0, "idle turn under reduced motion"
        before = camera(p)
        b = box(view)
        cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        p.mouse.move(cx, cy)
        p.mouse.down()
        p.mouse.move(cx + b["width"] / 3, cy, steps=8)
        p.mouse.up()
        advance(p, 200)
        assert camera(p) != before, "dragging did not orbit the car"
    with opened(browser, app_url, "/garage", racer, no_webgl=True) as p:
        expect(p.get_by_role("img", name=car_img("Kestrel Hatch", "drawing"))).to_be_visible()
        expect(p.get_by_role("region", name="Car")).to_contain_text(WEBGL_NOTICE)


def test_purchases_never_overdraw(app_url):
    systems = ["engine", "tires", "brakes", "suspension"]
    for coins in (500, 900):
        racer = new_player(app_url, coins=coins, cars=["kestrel-hatch"])
        calls = [lambda s=s: racer.post(upgrade_path("kestrel-hatch", s),
                                        {"stage": 1, "layoutId": "saltflat-ring"}, key=idempotency_key())
                 for s in systems]
        answers = together(*calls)
        wins = coins // PRICES["D"][0]
        assert sorted(a.status_code for a in answers) == [201] * wins + [402] * (len(systems) - wins)
        assert all(a.json()["error"]["code"] == "INSUFFICIENT_COINS" for a in answers if a.status_code == 402)
        assert balance(racer) == coins - wins * PRICES["D"][0] >= 0
        assert sum(garage_car(racer, "kestrel-hatch")["stages"].values()) == wins
        assert [m["kind"] for m in movements(racer)].count("upgrade") == wins


def test_wf_two_tab_spend_simultaneous(browser, app_url):
    racer = new_player(app_url, coins=500, cars=["kestrel-hatch"])
    left = 500 - PRICES["D"][0]
    with opened(browser, app_url, "/garage", racer) as a, opened(browser, app_url, "/garage", racer) as b:
        statuses: dict[str, int] = {}
        for tab, label, system in ((a, "a", "Engine"), (b, "b", "Tires")):
            tab.on("response", lambda r, label=label: statuses.setdefault(label, r.status)
                   if "/upgrades/" in r.url and r.request.method == "POST" else None)
            tab.get_by_role("button", name=upgrade_name(system, 1)).click()
            expect(tab.get_by_role("dialog", name="Confirm upgrade")).to_be_visible()
        a.get_by_role("dialog", name="Confirm upgrade").get_by_role("button", name=re.compile("^Buy for")).focus()
        b.get_by_role("dialog", name="Confirm upgrade").get_by_role("button", name=re.compile("^Buy for")).focus()
        held: list = []
        for tab in (a, b):
            tab.route("**/upgrades/**", lambda route: held.append(route))
        a.keyboard.press("Enter")
        b.keyboard.press("Enter")
        wait_ui(a, lambda: len(held) == 2, step_ms=0)
        for route in held:
            route.continue_()
        pump_until(a, lambda: len(statuses) == 2)
        assert sorted(statuses.values()) == [201, 402]
        loser = a if statuses["a"] == 402 else b
        winner = b if loser is a else a
        dialog = loser.get_by_role("dialog", name="Confirm upgrade")
        expect(dialog).to_contain_text(NOT_ENOUGH)
        expect(dialog).to_contain_text(f"You need {fmt_coins(PRICES['D'][0] - left)} more coins.")
        advance(loser, 50)
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
        advance(winner, SWEEP_DONE_MS)
        wait_text(loser, balance_region(loser), f"{fmt_coins(left)} coins")
        wait_text(winner, balance_region(winner), f"{fmt_coins(left)} coins")
    assert balance(racer) == left and [m["kind"] for m in movements(racer)].count("upgrade") == 1


def test_wf_two_tab_spend_live_dialog(browser, app_url):
    racer = new_player(app_url, coins=500, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer) as a, opened(browser, app_url, "/garage", racer) as b:
        b.get_by_role("button", name=upgrade_name("Tires", 1)).click()
        dialog = b.get_by_role("dialog", name="Confirm upgrade")
        buy_b = dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins")
        expect(buy_b).to_be_visible()
        a.get_by_role("button", name=upgrade_name("Engine", 1)).click()
        a.get_by_role("dialog", name="Confirm upgrade").get_by_role(
            "button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        wait_text(b, dialog, NOT_ENOUGH)
        expect(dialog).to_contain_text(f"You need {fmt_coins(PRICES['D'][0] * 2 - 500)} more coins.")
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
        expect(balance_region(b)).to_have_text(f"{fmt_coins(500 - PRICES['D'][0])} coins")
        advance(a, SWEEP_DONE_MS)
        a.get_by_role("button", name=refit_name("Engine")).click()
        a.get_by_role("dialog", name="Confirm refit").get_by_role(
            "button", name=f"Refit and refund {PRICES['D'][0] // 2} coins").click()
        wait_ui(b, lambda: NOT_ENOUGH not in texts(dialog))
        expect(buy_b).to_be_enabled()
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
        buy_b.click()
        wait_text(b, b.get_by_role("status", name="Garage updates"), fitted("Tires", 1))
    car = garage_car(racer, "kestrel-hatch")
    assert car["stages"] == {"engine": 0, "tires": 1, "brakes": 0, "suspension": 0}
    assert balance(racer) == 500 - PRICES["D"][0] * 2 + PRICES["D"][0] // 2


def test_refit_to_stock(app_url):
    racer = new_player(app_url, coins=5000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "engine", 1)
    buy(racer, "kestrel-hatch", "engine", 2)
    spent = PRICES["D"][0] + PRICES["D"][1]
    assert garage_car(racer, "kestrel-hatch")["paid"]["engine"] == spent
    r = racer.post(refit_path("kestrel-hatch", "engine"), {"refund": 99999, "balance": 99999},
                   key=idempotency_key())
    assert r.status_code == 201, r.text
    assert r.json()["refund"] == spent // 2 and r.json()["pi"] == CARS["kestrel-hatch"][4]
    assert r.json()["balance"] == 5000 - spent + spent // 2 == balance(racer)
    car = garage_car(racer, "kestrel-hatch")
    assert car["stages"]["engine"] == 0 and car["paid"]["engine"] == 0
    refit = movements(racer)[0]
    assert refit["kind"] == "refit" and wallet(racer, refit) == spent // 2
    again = racer.post(refit_path("kestrel-hatch", "engine"), {}, key=idempotency_key())
    assert again.status_code == 409 and again.json()["error"]["code"] == "ALREADY_STOCK"
    for path in (refit_path("kestrel-hatch", UNKNOWN_SYSTEM), refit_path("wren-coupe", "engine")):
        miss = racer.post(path, {}, key=idempotency_key())
        assert miss.status_code == 404 and miss.json()["error"]["code"] == "NOT_FOUND"
    buy(racer, "kestrel-hatch", "engine", 1)
    second = racer.post(refit_path("kestrel-hatch", "engine"), {}, key=idempotency_key())
    assert second.json()["refund"] == PRICES["D"][0] // 2


def test_paired_ledger(app_url):
    racer = new_player(app_url, coins=6000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "brakes", 1)
    assert racer.post("/v1/garage/cars", {"carId": "halcyon-rs"}, key=idempotency_key()).status_code == 201
    assert racer.post(refit_path("kestrel-hatch", "brakes"), {}, key=idempotency_key()).status_code == 201
    settled(racer, race(racer, eventId="guided-first-race", carId="kestrel-hatch"))
    ledger = racer.get("/v1/ledger").json()
    kinds = set()
    for m in ledger["movements"]:
        assert len(m["entries"]) == 2 and sum(e["amount"] for e in m["entries"]) == 0
        accounts = sorted(e["account"] for e in m["entries"])
        assert accounts == sorted([f"wallet:{racer.id}", COUNTER[m["kind"]]]), m
        assert wallet(racer, m) != 0
        kinds.add(m["kind"])
    assert {"opening", "upgrade", "car", "refit", "pickups", "result"} <= kinds
    total = sum(wallet(racer, m) for m in ledger["movements"])
    assert ledger["balance"] == ledger["total"] == total == balance(racer) == racer.get("/v1/me").json()["balance"]
    assert ledger["movements"][-1]["kind"] == "opening"


def test_wf_refit_ledger_coin_history(browser, app_url):
    racer = new_player(app_url, coins=2000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "tires", 1)
    racer.post(refit_path("kestrel-hatch", "tires"), {}, key=idempotency_key())
    settled(racer, race(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch"))
    ledger = racer.get("/v1/ledger").json()
    with opened(browser, app_url, "/garage/coins", racer) as p:
        for width, height in VIEWPORTS:
            p.set_viewport_size({"width": width, "height": height})
            p.goto(app_url + "/garage/coins")
            totals = p.get_by_role("region", name="Coin totals")
            expect(totals).to_contain_text(f"Balance {fmt_coins(ledger['balance'])} coins")
            expect(totals).to_contain_text(f"Ledger total {fmt_coins(ledger['total'])} coins")
            table = p.get_by_role("table", name="Coin history")
            for header in ("When", "Movement", "Wallet", "Counter account"):
                h = table.locator("thead th").filter(has_text=re.compile(rf"^\s*{header}\s*$")).or_(table.get_by_role("columnheader", name=header))
                expect(h).to_be_visible()
                assert box(h)["x"] + box(h)["width"] <= width + 1
            rows = [r for r in table.get_by_role("row").all() if r.get_by_role("columnheader").count() == 0 and r.evaluate("e => !e.closest('thead')")]
            assert len(rows) == len(ledger["movements"])
            for account in {COUNTER[m["kind"]] for m in ledger["movements"]}:
                expect(table).to_contain_text(account)
            layout(p)


def test_wf_refit_ledger_refit_keyboard(browser, app_url):
    racer = new_player(app_url, coins=2000, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "brakes", 1)
    start = balance(racer)
    refund = PRICES["D"][0] // 2

    def forge(route):
        body = json.loads(route.request.post_data or "{}")
        body["refund"] = 99999
        route.continue_(post_data=compact(body))

    with opened(browser, app_url, "/garage", racer) as p:
        p.route("**/refits/brakes", forge)
        tab_to(p, p.get_by_role("button", name=refit_name("Brakes")))
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name="Confirm refit")
        refit = dialog.get_by_role("button", name=f"Refit and refund {refund} coins")
        tab_to(p, refit)
        p.keyboard.press("Enter")
        advance(p, 500)
        expect(p.get_by_role("button", name=upgrade_name("Brakes", 1))).to_be_focused()
        wait_text(p, p.get_by_role("status", name="Garage updates"),
                  f"{refitted('Brakes')} Refund: {refund} coins. Balance: {fmt_coins(start + refund)} coins.")
    m = movements(racer)[0]
    assert m["kind"] == "refit" and wallet(racer, m) == refund and balance(racer) == start + refund


def test_replay_stored_before_verification(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    run, body = submit(racer, COAST, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    assert run["stepLimit"] == STEP_LIMIT_PER_LAP
    state = racer.get(f"/v1/runs/{run['runId']}").json()
    assert state["status"] in ("verifying", "verified")
    assert S3().get(f"replays/{run['runId']}.json") == body
    assert settled(racer, run["runId"])["replaySha256"] == sha(body)
    full = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    exact = compact({"seed": full["seed"], "inputs": COAST})
    exact += b" " * (FINISH_LIMIT_BYTES - len(exact))
    assert finish(racer, full, exact).status_code == 202
    assert S3().get(f"replays/{full['runId']}.json") == exact
    assert settled(racer, full["runId"])["status"] == "verified"
    bad = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    good = compact({"seed": bad["seed"], "inputs": COAST})
    big = finish(racer, bad, good + b" " * (FINISH_LIMIT_BYTES + 1 - len(good)))
    assert big.status_code == 413 and big.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    plain = racer.post(f"/v1/runs/{bad['runId']}/finish", raw=good, content_type="text/plain")
    assert plain.status_code == 415 and plain.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"
    foreign = racer.post(f"/v1/runs/{bad['runId']}/finish", raw=good, Origin=FOREIGN)
    assert foreign.status_code == 403 and foreign.json()["error"]["code"] == "FORBIDDEN_ORIGIN"
    assert S3().keys(f"replays/{bad['runId']}") == []
    assert racer.get(f"/v1/runs/{bad['runId']}").json()["status"] == "started"


def test_server_replay_decides(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    forged = {"lapMs": 1, "raceMs": 1, "coinsCollected": 999, "position": 1, "payout": 99999, "valid": True}
    run, _ = submit(racer, COAST, forged, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    mine = settled(racer, run["runId"])
    assert mine["status"] == "verified"
    lap = mine["lapResults"][0]
    assert lap["valid"] is False and lap["offTrackSteps"] >= 60 and mine["clean"] is False
    assert mine["coinsCollected"] == middle_lane_coins("saltflat-ring", 1)
    assert mine["raceMs"] == sum(l["lapMs"] for l in mine["lapResults"]) and sum(lap["sectorsMs"]) == lap["lapMs"]
    assert mine["position"] is None
    twin = settled(racer, race(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch", driver="coast"))
    assert twin["raceMs"] == mine["raceMs"] and twin["lapResults"] == mine["lapResults"]
    assert payouts(racer, run["runId"]) == {"pickups": mine["coinsCollected"]}
    coast = settled(racer, race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch", driver="coast"))
    ref = settled(racer, race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch"))
    assert coast["position"] == 3 and ref["position"] == 1
    stop = [{"step": 0, "throttle": 0, "brake": 0, "drift": 0, "lane": "middle"}]
    cases = {
        "did_not_finish": lambda r: compact({"seed": r["seed"], "inputs": stop}),
        "seed_mismatch": lambda r: compact({"seed": "x" + r["seed"], "inputs": COAST}),
        "invalid_inputs": lambda r: b"not json",
    }
    for reason, build in cases.items():
        r = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
        assert finish(racer, r, build(r)).status_code == 202
        done = settled(racer, r["runId"])
        assert (done["status"], done["reason"]) == ("rejected", reason)
        assert movements(racer, r["runId"]) == []


def test_payouts_from_verified_runs(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    drift_inputs = generate("saltflat-ring", "kestrel-hatch", 1, DRIFT_STEP_LIMIT, drift=True)
    guided, circuit, coast, trial, drift = together(
        lambda: race(racer, eventId="guided-first-race", carId="kestrel-hatch"),
        lambda: race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch"),
        lambda: race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch", driver="coast"),
        lambda: race(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1),
        lambda: race(racer, layoutId="saltflat-ring", mode="drift", carId="kestrel-hatch", driver="inputs",
                     inputs=drift_inputs))
    runs = {k: settled(racer, v) for k, v in
            {"guided": guided, "circuit": circuit, "coast": coast, "trial": trial, "drift": drift}.items()}
    assert all(r["status"] == "verified" for r in runs.values())
    one_lap, three_laps = middle_lane_coins("saltflat-ring", 1), middle_lane_coins("saltflat-ring", 3)
    assert payouts(racer, guided) == {"pickups": one_lap, "result": GUIDED_PAYOUT}
    c = runs["circuit"]
    bonus = CIRCUIT_PLACING[1] * CLEAN_BONUS_PCT // 100 if c["clean"] else 0
    assert c["position"] == 1 and payouts(racer, circuit) == {"pickups": three_laps, "result": CIRCUIT_PLACING[1] + bonus}
    assert payouts(racer, coast) == {"pickups": three_laps, "result": CIRCUIT_PLACING[3]}
    assert payouts(racer, trial) == {"result": TIME_TRIAL_PAYOUT}
    score = runs["drift"]["driftScore"]
    drift_coins = min(score // DRIFT_DIVISOR, DRIFT_CAP)
    assert score > 0 and payouts(racer, drift) == ({"result": drift_coins} if drift_coins else {})
    guided2 = race(racer, eventId="guided-first-race", carId="kestrel-hatch")
    trial2 = race(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    settled(racer, guided2), settled(racer, trial2)
    assert payouts(racer, guided2) == {"pickups": one_lap}
    assert payouts(racer, trial2) == {}
    assert balance(racer) == sum(wallet(racer, m) for m in movements(racer))


REPLAY_CASE_IDS = [
    "duplicate-key", "depth-5", "depth-4-allowed", "top-level-array", "no-events", "too-many-events",
    "max-events-allowed", "extra-event-key", "missing-event-key", "step-decimal", "step-exponent", "step-at-limit",
    "step-below-limit-allowed", "first-step-not-zero", "steps-not-increasing", "pedal-true", "pedal-float",
    "pedal-string", "lane-unknown", "unparseable", "whitespace-heavy", "nested-heavy", "seed-checked-before-events",
]


def _event(step: Any, throttle: Any = 1, lane: Any = "middle", **extra: Any) -> dict:
    return {"step": step, "throttle": throttle, "brake": 0, "drift": 0, "lane": lane, **extra}


def build_replay(case: str, seed: str) -> tuple[bytes, str, str | None]:
    s = json.dumps(seed)
    coast = compact(COAST).decode()
    heavy = 900000
    table: dict[str, tuple[bytes, str, str | None]] = {
        "duplicate-key": (f'{{"seed":{s},"seed":{s},"inputs":{coast}}}'.encode(), "rejected", "invalid_inputs"),
        "depth-5": (compact({"seed": seed, "inputs": COAST, "meta": [[[[1]]]]}), "rejected", "invalid_inputs"),
        "depth-4-allowed": (compact({"seed": seed, "inputs": COAST, "meta": [[[1]]]}), "verified", None),
        "top-level-array": (b"[]", "rejected", "invalid_inputs"),
        "no-events": (compact({"seed": seed, "inputs": []}), "rejected", "invalid_inputs"),
        "too-many-events": (compact({"seed": seed, "inputs": [_event(i) for i in range(MAX_EVENTS + 1)]}), "rejected", "invalid_inputs"),
        "max-events-allowed": (compact({"seed": seed, "inputs": [_event(i) for i in range(MAX_EVENTS)]}), "verified", None),
        "extra-event-key": (compact({"seed": seed, "inputs": [_event(0, boost=1)]}), "rejected", "invalid_inputs"),
        "missing-event-key": (compact({"seed": seed, "inputs": [{"step": 0, "throttle": 1, "brake": 0, "drift": 0}]}), "rejected", "invalid_inputs"),
        "step-decimal": (f'{{"seed":{s},"inputs":[{coast[1:-1]},{{"step":10.0,"throttle":1,"brake":0,"drift":0,"lane":"middle"}}]}}'.encode(), "rejected", "invalid_inputs"),
        "step-exponent": (f'{{"seed":{s},"inputs":[{coast[1:-1]},{{"step":1e1,"throttle":1,"brake":0,"drift":0,"lane":"middle"}}]}}'.encode(), "rejected", "invalid_inputs"),
        "step-at-limit": (compact({"seed": seed, "inputs": [_event(0), _event(STEP_LIMIT_PER_LAP)]}), "rejected", "invalid_inputs"),
        "step-below-limit-allowed": (compact({"seed": seed, "inputs": [_event(0), _event(STEP_LIMIT_PER_LAP - 1)]}), "verified", None),
        "first-step-not-zero": (compact({"seed": seed, "inputs": [_event(1)]}), "rejected", "invalid_inputs"),
        "steps-not-increasing": (compact({"seed": seed, "inputs": [_event(0), _event(5), _event(5)]}), "rejected", "invalid_inputs"),
        "pedal-true": (compact({"seed": seed, "inputs": [_event(0, throttle=True)]}), "rejected", "invalid_inputs"),
        "pedal-float": (f'{{"seed":{s},"inputs":[{{"step":0,"throttle":1.0,"brake":0,"drift":0,"lane":"middle"}}]}}'.encode(), "rejected", "invalid_inputs"),
        "pedal-string": (compact({"seed": seed, "inputs": [_event(0, throttle="1")]}), "rejected", "invalid_inputs"),
        "lane-unknown": (compact({"seed": seed, "inputs": [_event(0, lane="centre")]}), "rejected", "invalid_inputs"),
        "unparseable": (b'{"seed":', "rejected", "invalid_inputs"),
        "whitespace-heavy": (f'{{"seed":{s},"inputs":{coast}{" " * heavy}}}'.encode(), "verified", None),
        "nested-heavy": (b"[" * (heavy // 2) + b"]" * (heavy // 2), "rejected", "invalid_inputs"),
        "seed-checked-before-events": (compact({"seed": "x" + seed, "inputs": []}), "rejected", "seed_mismatch"),
    }
    return table[case]


@pytest.mark.parametrize("case", REPLAY_CASE_IDS, ids=REPLAY_CASE_IDS)
def test_bounded_replay_files(app_url, case):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    run = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    body, status, reason = build_replay(case, run["seed"])
    started = time.monotonic()
    answer = finish(racer, run, body)
    assert answer.status_code == 202 and time.monotonic() - started <= FINISH_ANSWER_S
    done = settled(racer, run["runId"])
    assert (done["status"], done["reason"]) == (status, reason)
    assert done["replaySha256"] == sha(body)
    assert S3().get(f"replays/{run['runId']}.json") == body
    if status == "rejected":
        assert movements(racer, run["runId"]) == []


def test_wf_verification_results_screen(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    forged = {"raceMs": 1, "coinsCollected": 999, "payout": 99999}
    run, body = submit(racer, COAST, forged, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    with opened(browser, app_url, f"/runs/{run['runId']}", racer) as p:
        result = p.get_by_role("status", name="Run result")
        done = settled(racer, run["runId"])
        coins = middle_lane_coins("saltflat-ring", 1)
        assert done["payout"] == coins
        wait_text(p, result, f"Verified: {fmt_time(done['raceMs'])}, +{coins} coins", step_ms=50)
        figure = p.get_by_role("figure", name="Payout")
        seen = []
        for _ in range(PAYOUT_COUNT_MS // 100 + 3):
            seen.append(int(re.sub(r"[^\d]", "", texts(figure)) or 0))
            advance(p, 100)
        expect(figure).to_contain_text(f"+{coins} coins")
        assert seen == sorted(seen) and any(0 < v < coins for v in seen), f"payout did not count up: {seen}"
        laps = p.get_by_role("table", name="Laps")
        expect(laps).to_contain_text(fmt_time(done["lapResults"][0]["lapMs"]))
        expect(laps).to_contain_text("Invalid")
    assert S3().get(f"replays/{run['runId']}.json") == body and done["replaySha256"] == sha(body)


def test_wf_verification_rejected(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    run = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
    body = b"[" * 400000 + b"]" * 400000
    started = time.monotonic()
    assert finish(racer, run, body).status_code == 202 and time.monotonic() - started <= FINISH_ANSWER_S
    with opened(browser, app_url, f"/runs/{run['runId']}", racer) as p:
        wait_text(p, p.get_by_role("status", name="Run result"), REJECTED["invalid_inputs"])
        figure = p.get_by_role("figure", name="Payout")
        if figure.count():
            assert not re.search(r"\+[1-9]", texts(figure))
    assert S3().get(f"replays/{run['runId']}.json") == body
    assert movements(racer, run["runId"]) == []


def test_wf_verification_outage(browser):
    base = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    assert httpx.get(base + "/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    started = time.monotonic()
    assert httpx.get(base + "/v1/status", timeout=HTTP_TIMEOUT_S).json() == {"replayStorage": "unavailable"}
    assert time.monotonic() - started <= STATUS_PROBE_S + 1
    racer = new_guest(base)
    inputs = generate("saltflat-ring", "kestrel-hatch", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    run = new_run(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    body = compact({"seed": run["seed"], "inputs": inputs})
    started = time.monotonic()
    answer = finish(racer, run, body)
    assert answer.status_code == 202 and answer.json()["status"] == "held"
    assert time.monotonic() - started <= FINISH_ANSWER_S
    assert racer.get(f"/v1/runs/{run['runId']}").json()["status"] == "held"
    download = racer.get(f"/v1/runs/{run['runId']}/replay")
    assert download.status_code == 503 and download.json()["error"]["code"] == "REPLAY_STORAGE_UNAVAILABLE"
    assert S3().keys(f"replays/{run['runId']}") == []
    assert [m["kind"] for m in movements(racer)] == ["opening"]
    board = racer.get(board_path("saltflat-ring", "time-trial", "D")).json()
    assert board["mine"] is None and all(r["runId"] != run["runId"] for r in board["rows"])
    with opened(browser, base, f"/runs/{run['runId']}", racer) as p:
        expect(p.get_by_role("alert").filter(has_text=OUTAGE_BANNER)).to_be_visible()
        expect(p.get_by_role("status", name="Run result")).to_have_text(HELD)
        p.goto(base + "/garage")
        expect(p.get_by_role("alert").filter(has_text=OUTAGE_BANNER)).to_be_visible()


def test_held_run_resumes_when_storage_returns():
    endpoint = urllib.parse.urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname, endpoint.port or (443 if endpoint.scheme == "https" else 80))
    relay.start()
    try:
        with scratch_database() as database_url, \
                app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}", "DATABASE_URL": database_url}) as base:
            racer = new_guest(base)
            run = new_run(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch")
            body = compact({"seed": run["seed"], "inputs": COAST})
            relay.stop()
            poll(lambda: httpx.get(base + "/v1/status", timeout=HTTP_TIMEOUT_S).json()["replayStorage"],
                 lambda v: v == "unavailable", BANNER_S)
            answer = finish(racer, run, body)
            assert answer.status_code == 202 and answer.json()["status"] == "held"
            assert S3().keys(f"replays/{run['runId']}") == []
            assert [m["kind"] for m in movements(racer)] == ["opening"]
            relay.start()
            back = time.monotonic()
            poll(lambda: racer.get(f"/v1/runs/{run['runId']}").json()["status"], lambda s: s != "held",
                 HELD_RETRY_S * 4)
            assert time.monotonic() - back <= HELD_RETRY_S + 1
            assert settled(racer, run["runId"])["status"] == "verified"
            assert S3().get(f"replays/{run['runId']}.json") == body
            assert payouts(racer, run["runId"]) == {"pickups": middle_lane_coins("saltflat-ring", 1)}
    finally:
        relay.stop()


def test_wf_verification_isolation(browser, app_url):
    a = new_player(app_url, cars=["kestrel-hatch"])
    b = new_player(app_url, cars=["vantor-8"])
    with opened(browser, app_url, "/garage", a, pushes=True) as pa, opened(browser, app_url, "/garage", b, pushes=True) as pb:
        expect(balance_region(pa)).to_be_visible()
        expect(balance_region(pb)).to_be_visible()
        calls = []
        for _ in range(4):
            calls.append(lambda: ("a", race(a, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)))
            calls.append(lambda: ("b", race(b, layoutId="saltflat-ring", mode="time-trial", carId="vantor-8", laps=1)))
        ids = together(*calls)
        own = {"a": [r for who, r in ids if who == "a"], "b": [r for who, r in ids if who == "b"]}
        laps = {}
        for who, pl, car in (("a", a, "kestrel-hatch"), ("b", b, "vantor-8")):
            runs = [settled(pl, r) for r in own[who]]
            assert all(r["carId"] == car and r["playerId"] == pl.id for r in runs)
            assert len({r["bestLapMs"] for r in runs}) == 1
            laps[who] = runs[0]["bestLapMs"]
            paid_runs = {m["runId"] for m in movements(pl) if m["runId"]}
            assert paid_runs <= set(own[who])
        assert laps["a"] != laps["b"]
        for page, who, pl in ((pa, "a", a), (pb, "b", b)):
            wait_ui(page, lambda page=page, who=who: {m.get("runId") for m in pushes(page) if m.get("type") == "run"}
                    >= set(own[who]))
            seen = pushes(page)
            other = "b" if who == "a" else "a"
            assert not {m.get("runId") for m in seen if m.get("type") == "run"} & set(own[other])
            ledger_ids = {m["movementId"] for m in movements(pl)}
            assert {m["movementId"] for m in seen if m.get("type") == "balance"} <= ledger_ids
            for m in seen:
                if m.get("type") == "board" and m["row"]["mine"]:
                    assert m["row"]["playerId"] == pl.id


def test_replay_download(app_url):
    owner = new_player(app_url, cars=["kestrel-hatch"])
    inputs = generate("saltflat-ring", "kestrel-hatch", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    run = new_run(owner, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    body = ('{ "inputs" : ' + json.dumps(inputs, indent=1) + ',\n  "note": "x",\n "seed": ' + json.dumps(run["seed"]) + " }\n").encode()
    assert finish(owner, run, body).status_code == 202
    assert settled(owner, run["runId"])["status"] == "verified"
    other = new_player(app_url)
    for viewer in (owner, other):
        r = viewer.get(f"/v1/runs/{run['runId']}/replay")
        assert r.status_code == 200 and r.content == body
        assert r.headers["x-replay-sha256"] == sha(body)
        assert r.headers["content-type"].startswith("application/json")
        assert f'filename="kerbline-{run["runId"]}.json"' in r.headers["content-disposition"]
    assert S3().get(f"replays/{run['runId']}.json") == body
    pending = new_run(owner, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    assert other.get(f"/v1/runs/{pending['runId']}/replay").status_code == 404
    assert other.get(f"/v1/runs/{pending['runId']}").status_code == 404


def ghost_run(app_url: str) -> tuple[Player, dict, bytes]:
    owner = new_player(app_url, cars=["wren-coupe"], name=True)
    inputs = generate("saltflat-ring", "wren-coupe", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    run, body = submit(owner, inputs, layoutId="saltflat-ring", mode="time-trial", carId="wren-coupe", laps=1)
    assert settled(owner, run["runId"])["status"] == "verified"
    return owner, run, body


def board_row(p: Page, name: str) -> Locator:
    return p.get_by_role("table", name="Leaderboard").get_by_role("row").filter(has_text=name)


def choose_board(p: Page, map_name: str, mode: str, cls: str) -> None:
    select(p.get_by_role("combobox", name="Map"), map_name)
    select(p.get_by_role("combobox", name="Mode"), mode)
    select(p.get_by_role("combobox", name="Class"), cls)


def test_wf_time_trial_ghost_hunt(browser, app_url):
    owner, run, body = ghost_run(app_url)
    hunter = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/boards", hunter) as p:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        row = board_row(p, owner.name)
        expect(row).to_be_visible()
        with p.expect_download() as info:
            row.get_by_role("link", name="Download replay").click()
        assert Path(info.value.path()).read_bytes() == body == S3().get(f"replays/{run['runId']}.json")
        row.get_by_role("button", name="Race this ghost").click()
        wait_ui(p, lambda: p.url == app_url + race_path("saltflat-ring", "time-trial", ghost=run["runId"]))
        hud = p.get_by_role("region", name="Race HUD")
        expect(hud).to_be_focused()
        wait_text(p, hud, f"Ghost: {owner.name}")
        wait_text(p, hud, "Press Enter to start")
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        advance(p, 1000)
        samples = []
        for _ in range(8):
            m = re.search(r"Delta ([−+]\d+\.\d{3}|0\.000) s", texts(hud))
            assert m, texts(hud)
            samples.append(m.group(1))
            advance(p, DELTA_SAMPLE_MS)
        p.keyboard.up("ArrowUp")
        assert samples[-1].startswith("−"), samples
        changes = sum(x != y for x, y in zip(samples, samples[1:]))
        assert changes >= len(samples) // 2, f"delta not updating 4 times a second: {samples}"


def test_wf_time_trial_ghost_unavailable(browser, app_url):
    _, run, _ = ghost_run(app_url)
    hunter = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/boards", hunter) as p:
        p.route("**/v1/runs/*/replay", lambda route: route.abort("connectionfailed"))
        p.goto(app_url + race_path("saltflat-ring", "time-trial", ghost=run["runId"]))
        hud = p.get_by_role("region", name="Race HUD")
        wait_text(p, hud, GHOST_UNAVAILABLE)
        wait_text(p, hud, "Press Enter to start")
        hud.focus()
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        advance(p, 2000)
        p.keyboard.up("ArrowUp")
        assert not re.search(r"\b0 km/h", texts(hud)) and "Delta" not in texts(hud)


def test_wf_time_trial_ghost_pause(browser, app_url):
    owner, run, _ = ghost_run(app_url)
    hunter = new_player(app_url, cars=["kestrel-hatch"])
    created: list[str] = []
    finishes: list[str] = []
    with opened(browser, app_url, "/boards", hunter) as p:
        p.on("request", lambda r: created.append(r.url) if r.method == "POST" and r.url.endswith("/v1/runs") else None)
        p.on("request", lambda r: finishes.append(r.url) if r.url.endswith("/finish") else None)
        p.goto(app_url + race_path("saltflat-ring", "time-trial", ghost=run["runId"]))
        hud = p.get_by_role("region", name="Race HUD")
        wait_text(p, hud, f"Ghost: {owner.name}")
        wait_text(p, hud, "Press Enter to start")
        hud.focus()
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        advance(p, 3000)
        p.keyboard.press("Escape")
        dialog = p.get_by_role("dialog", name="Paused")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Resume")).to_be_focused()
        advance(p, 500)
        frozen, picture = texts(hud), decode(capture(p.get_by_role("img", name="Race view")))
        advance(p, 60000)
        assert texts(hud) == frozen
        assert difference(picture, decode(capture(p.get_by_role("img", name="Race view")))) == 0
        expect(dialog).to_be_visible()
        p.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        assert texts(hud) == frozen
        advance(p, 500)
        assert texts(hud) != frozen
        p.keyboard.press("Escape")
        runs_before = len(created)
        dialog.get_by_role("button", name="Restart").click()
        advance(p, RESTART_MS)
        p.keyboard.up("ArrowUp")
        advance(p, STEP_LIMIT_PER_LAP * 3 * 1000 // STEPS_PER_SECOND)
        assert len(created) == runs_before + 1
        assert finishes == []
        assert not re.search(r"Lap \d+:", texts(p.get_by_role("status", name="Race updates")))
        expect(hud).to_contain_text("Press Enter to start")


def test_wf_time_trial_ghost_keyboard_pause(browser, app_url):
    owner, run, _ = ghost_run(app_url)
    hunter = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, race_path("saltflat-ring", "time-trial", ghost=run["runId"]), hunter) as p:
        hud = p.get_by_role("region", name="Race HUD")
        wait_text(p, hud, f"Ghost: {owner.name}")
        wait_text(p, hud, "Press Enter to start")
        hud.focus()
        p.keyboard.press("Enter")
        p.keyboard.down("ArrowUp")
        advance(p, 3000)
        p.keyboard.up("ArrowUp")
        assert not re.search(r"\b0 km/h", texts(hud)), texts(hud)
        p.get_by_role("button", name="Pause").focus()
        p.keyboard.press("Escape")
        dialog = p.get_by_role("dialog", name="Paused")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Resume")).to_be_focused()
        focus_kept(p, dialog, "Tab")
        focus_kept(p, dialog, "Shift+Tab")
        p.keyboard.press("Escape")
        advance(p, 500)
        expect(dialog).to_be_hidden()
        p.get_by_role("button", name="Pause").click()
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Restart").click()
        advance(p, RESTART_MS)
        for part in (hud_lap(1, 3), hud_speed(0), f"Delta {fmt_delta(0)}", "Press Enter to start"):
            expect(hud).to_contain_text(part)


def test_leaderboard_rules(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    path = board_path("saltflat-ring", "time-trial", "D")
    slow = generate("saltflat-ring", "kestrel-hatch", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    first, _ = submit(racer, slow, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    slow_lap = settled(racer, first["runId"])["bestLapMs"]
    assert racer.get(path).json()["mine"]["value"] == slow_lap
    settled(racer, race(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1, driver="coast"))
    bad = new_run(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    finish(racer, bad, b"not json")
    settled(racer, bad["runId"])
    assert racer.get(path).json()["mine"]["value"] == slow_lap
    fast = settled(racer, race(racer, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1))
    assert fast["bestLapMs"] < slow_lap
    again, _ = submit(racer, slow, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    settled(racer, again["runId"])
    board = racer.get(path).json()
    assert board["mine"]["value"] == fast["bestLapMs"] and board["mine"]["runId"] == fast["runId"]
    rows = board["rows"]
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
    assert [r["value"] for r in rows] == sorted(r["value"] for r in rows)
    assert len({r["playerId"] for r in rows}) == len(rows)
    assert rows[0]["gapMs"] is None and all(r["gapMs"] == r["value"] - rows[0]["value"] for r in rows[1:])
    assert all(r["mine"] == (r["playerId"] == racer.id) for r in rows)
    drift = generate("saltflat-ring", "kestrel-hatch", 1, DRIFT_STEP_LIMIT, drift=True)
    d = settled(racer, race(racer, layoutId="saltflat-ring", mode="drift", carId="kestrel-hatch", driver="inputs", inputs=drift))
    dboard = racer.get(board_path("saltflat-ring", "drift", "D")).json()
    assert dboard["mine"]["value"] == d["driftScore"] and dboard["mine"]["unit"] == "points"
    assert [r["value"] for r in dboard["rows"]] == sorted((r["value"] for r in dboard["rows"]), reverse=True)
    assert all(r["gapMs"] is None for r in dboard["rows"])
    cpath = board_path("saltflat-ring", "circuit", "D")
    settled(racer, race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch", driver="coast"))
    assert racer.get(cpath).json()["mine"] is None
    c = settled(racer, race(racer, layoutId="saltflat-ring", mode="circuit", carId="kestrel-hatch"))
    assert racer.get(cpath).json()["mine"]["value"] == c["raceMs"]
    assert racer.get(board_path("saltflat-ring", BAD_MODE, "D")).status_code == 422


def test_wf_leaderboards_url_filters(browser, app_url):
    d_owner, d_run, _ = ghost_run(app_url)
    b_owner = new_player(app_url, cars=["vantor-8"], name=True)
    b_run = settled(b_owner, race(b_owner, layoutId="saltflat-ring", mode="time-trial", carId="vantor-8", laps=1))
    d = d_owner.get(f"/v1/runs/{d_run['runId']}").json()
    viewer = new_player(app_url)
    with opened(browser, app_url, "/boards", viewer) as p:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        row = board_row(p, d_owner.name)
        expect(row).to_contain_text(fmt_time(d["bestLapMs"]))
        expect(row).to_contain_text(str(round(d["topSpeedMps"] * KMH)))
        kmh_url = p.url
        p.get_by_role("radio", name="mph").click()
        wait_ui(p, lambda: p.url != kmh_url)
        expect(row).to_contain_text(fmt_time(d["bestLapMs"]))
        expect(row).to_contain_text(str(round(d["topSpeedMps"] * MPH)))
        mph_url = p.url
        select(p.get_by_role("combobox", name="Class"), "B")
        expect(board_row(p, b_owner.name)).to_contain_text(fmt_time(b_run["bestLapMs"]))
        expect(board_row(p, d_owner.name)).to_have_count(0)
        b_url = p.url
        p.go_back()
        wait_ui(p, lambda: p.url == mph_url)
        assert chosen(p.get_by_role("combobox", name="Class")) == "D"
        expect(board_row(p, d_owner.name)).to_be_visible()
        p.go_forward()
        wait_ui(p, lambda: p.url == b_url)
        expect(board_row(p, b_owner.name)).to_be_visible()
        p.reload()
        expect(board_row(p, b_owner.name)).to_be_visible()
        assert chosen(p.get_by_role("combobox", name="Class")) == "B"
    with opened(browser, app_url, urllib.parse.urlparse(b_url).path + "?" + urllib.parse.urlparse(b_url).query,
                new_player(app_url)) as shared:
        expect(board_row(shared, b_owner.name)).to_be_visible()
        assert chosen(shared.get_by_role("combobox", name="Map")) == "Saltflat Ring"
        expect(shared.get_by_role("radio", name="mph")).to_be_checked()


def test_wf_leaderboards_latest_filter(browser, app_url):
    owners = {}
    for cls, car in (("D", "kestrel-hatch"), ("C", "halcyon-rs"), ("B", "vantor-8")):
        o = new_player(app_url, cars=[car], name=True)
        settled(o, race(o, layoutId="saltflat-ring", mode="time-trial", carId=car, laps=1))
        owners[cls] = o
    viewer = new_player(app_url)
    pending: list = []

    def hold_earlier(route):
        cls = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("class")
        if cls == ["B"]:
            route.continue_()
        else:
            pending.append(route)

    with opened(browser, app_url, "/boards", viewer) as p, opened(browser, app_url, "/boards", new_player(app_url)) as c_page:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        expect(board_row(p, owners["D"].name)).to_be_visible()
        p.route("**/v1/boards?*", hold_earlier)
        select(p.get_by_role("combobox", name="Class"), "C")
        expect(p.get_by_role("table", name="Leaderboard")).to_contain_text(LOADING_TIMES)
        select(p.get_by_role("combobox", name="Class"), "B")
        expect(board_row(p, owners["B"].name)).to_be_visible()
        for route in pending:
            route.continue_()
        advance(p, 1000)
        expect(board_row(p, owners["B"].name)).to_be_visible()
        expect(board_row(p, owners["C"].name)).to_have_count(0)
        expect(board_row(p, owners["D"].name)).to_have_count(0)
        choose_board(c_page, "Saltflat Ring", "Time trial", "C")
        newcomer = new_player(app_url, cars=["halcyon-rs"], name=True)
        settled(newcomer, race(newcomer, layoutId="saltflat-ring", mode="time-trial", carId="halcyon-rs", laps=1))
        wait_ui(c_page, lambda: board_row(c_page, newcomer.name).count() == 1, seconds=BOARD_PUSH_S * 3)
        advance(p, 1000)
        expect(board_row(p, newcomer.name)).to_have_count(0)


def test_wf_leaderboards_live_board(browser, app_url):
    viewer = new_player(app_url, cars=["kestrel-hatch"])
    slow = generate("saltflat-ring", "kestrel-hatch", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    vrun, _ = submit(viewer, slow, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
    mine = settled(viewer, vrun["runId"])
    rival = new_player(app_url, cars=["kestrel-hatch"], name=True)
    path = board_path("saltflat-ring", "time-trial", "D")
    with opened(browser, app_url, "/boards", viewer) as p:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        expect(p.get_by_role("region", name="Your time")).to_contain_text(fmt_time(mine["bestLapMs"]))
        navs: list[str] = []
        p.on("framenavigated", lambda f: navs.append(f.url))
        r1, _ = submit(rival, generate("saltflat-ring", "kestrel-hatch", 1, STEP_LIMIT_PER_LAP, scale=0.6),
                       layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1)
        settled(rival, r1["runId"])
        wait_ui(p, lambda: board_row(p, rival.name).count() == 1, seconds=BOARD_PUSH_S * 3)
        fast = settled(rival, race(rival, layoutId="saltflat-ring", mode="time-trial", carId="kestrel-hatch", laps=1))
        wait_ui(p, lambda: fmt_time(fast["bestLapMs"]) in texts(board_row(p, rival.name)), seconds=BOARD_PUSH_S * 3)
        advance(p, 1500)
        expect(board_row(p, rival.name)).to_have_count(1)
        table = p.get_by_role("table", name="Leaderboard")
        rows = [r for r in table.get_by_role("row").all()
                if r.get_by_role("columnheader").count() == 0 and re.match(r"\s*\d", r.inner_text())]
        assert [int(r.inner_text().split()[0]) for r in rows] == list(range(1, len(rows) + 1))
        api = viewer.get(path).json()["rows"]
        theirs = next(r for r in api if r["playerId"] == rival.id)
        if theirs["gapMs"] is not None:
            expect(board_row(p, rival.name)).to_contain_text(fmt_delta(theirs["gapMs"]))
        assert navs == []
        for width, height in VIEWPORTS:
            p.set_viewport_size({"width": width, "height": height})
            p.mouse.wheel(0, 10000)
            advance(p, 200)
            yours = p.get_by_role("region", name="Your time")
            b = box(yours)
            assert b["y"] >= 0 and b["y"] + b["height"] <= height, (width, b)
            expect(yours).to_contain_text(fmt_time(mine["bestLapMs"]))

        def emptied(route):
            resp = route.fetch()
            body = resp.json()
            body["rows"], body["mine"] = [], None
            route.fulfill(response=resp, json=body)

        p.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        p.route("**/v1/boards?*", emptied)
        select(p.get_by_role("combobox", name="Class"), "C")
        expect(p.get_by_text(EMPTY_BOARD)).to_be_visible()


def player_item(p: Page, name: str) -> Locator:
    return p.get_by_role("list", name="Players").get_by_role("listitem").filter(has_text=name)


def test_wf_online_lobby_invite(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/lobby/new", host) as hp:
        select(hp.get_by_role("combobox", name="AI drivers"), "1")
        hp.get_by_role("button", name="Create private lobby").click()
        invite_box = hp.get_by_role("textbox", name="Invite link")
        wait_ui(hp, lambda: invite_box.count() == 1
                and re.search(r"/lobby/(?!new$)[A-Za-z0-9_-]+$", invite_box.input_value()) is not None)
        invite = invite_box.input_value()
        lobby_id = run_id_from(invite)
        with opened(browser, app_url, f"/lobby/{lobby_id}") as fp:
            wait_ui(fp, lambda: urllib.parse.urlparse(fp.url).path == "/")
            fp.get_by_role("checkbox", name="I am 13 or older").check()
            fp.get_by_role("button", name="Start racing").click()
            wait_ui(fp, lambda: fp.url == f"{app_url}/lobby/{lobby_id}")
            join = fp.get_by_role("button", name="Join lobby")
            expect(join).to_be_focused()
            join.click()
            friend = browser_player(fp, app_url)
            wait_ui(fp, lambda: player_item(fp, host.name).count() == 1 and player_item(fp, friend.name).count() == 1)
            wait_ui(hp, lambda: player_item(hp, friend.name).count() == 1)
        third = new_player(app_url)
        with opened(browser, app_url, f"/lobby/{lobby_id}", third) as tp:
            tp.get_by_role("button", name="Join lobby").click()
            expect(tp.get_by_text(LOBBY_FULL)).to_be_visible()
    refused = third.post(f"/v1/lobbies/{lobby_id}/join", {})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "LOBBY_FULL"
    assert {pl["playerId"] for pl in host.get(f"/v1/lobbies/{lobby_id}").json()["players"]} == {host.id, friend.id}


def test_wf_online_lobby_race(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"])
    friend = new_player(app_url, cars=["kestrel-hatch"])
    lobby_id = host.post("/v1/lobbies", {"aiCount": 0}).json()["lobbyId"]
    assert friend.post(f"/v1/lobbies/{lobby_id}/join", {}).status_code == 200
    with opened(browser, app_url, f"/lobby/{lobby_id}", host, clock_at=WRONG_CLOCK) as hp, \
            opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
        h_status, f_status = (pg.get_by_role("status", name="Lobby status") for pg in (hp, fp))
        wait_text(hp, h_status, "Waiting for players")
        hp.get_by_role("button", name="Ready").focus()
        hp.keyboard.press("Enter")
        wait_ui(fp, lambda: "Ready" in texts(player_item(fp, host.name)).replace("Not ready", ""))
        fp.get_by_role("button", name="Ready").focus()
        fp.keyboard.press("Space")
        wait_text(hp, h_status, re.compile(r"Starting in [123]"))
        fp.get_by_role("button", name="Not ready").press("Enter")
        wait_text(hp, h_status, "Waiting for players")
        wait_text(fp, f_status, "Waiting for players")
        lobby = host.get(f"/v1/lobbies/{lobby_id}").json()
        assert lobby["state"] == "open" and lobby["countdown"] is None
        fp.get_by_role("button", name="Ready").press("Enter")
        wait_text(hp, h_status, re.compile(r"Starting in [123]"))
        wait_text(hp, h_status, "Racing")
        hp.keyboard.down("ArrowUp")
        fp.keyboard.down("ArrowUp")
        tower = hp.get_by_role("list", name="Positions")
        wait_ui(hp, lambda: tower.get_by_role("listitem").count() == 2)
        items = tower.get_by_role("listitem").all_inner_texts()
        assert [int(t.split(".")[0]) for t in items] == [1, 2]
        assert {re.sub(r"^\d+\.\s*", "", t).replace("DNF", "").strip() for t in items} == {host.name, friend.name}
        hp.keyboard.up("ArrowUp")
        fp.keyboard.up("ArrowUp")
    assert host.get(f"/v1/lobbies/{lobby_id}").json()["state"] in ("racing", "finished")


def test_wf_online_lobby_rejoin(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"], name=True)
    friend = new_player(app_url, cars=["kestrel-hatch"], name=True)
    lobby_id = host.post("/v1/lobbies", {"aiCount": 1}).json()["lobbyId"]
    friend.post(f"/v1/lobbies/{lobby_id}/join", {})
    with opened(browser, app_url, f"/lobby/{lobby_id}", host) as hp:
        status = hp.get_by_role("status", name="Lobby status")
        hp.get_by_role("button", name="Ready").click()
        with opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
            fp.get_by_role("button", name="Ready").click()
            wait_text(hp, status, re.compile(r"Starting in [123]"))
            fp.close()
        wait_text(hp, status, "Waiting for players")
        wait_text(hp, player_item(hp, friend.name), "Reconnecting")
        with opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
            wait_ui(hp, lambda: "Reconnecting" not in texts(player_item(hp, friend.name)))
            expect(player_item(hp, friend.name)).to_contain_text("Not ready")
            fp.get_by_role("button", name="Ready").click()
            wait_text(hp, status, "Racing")
            fp.close()
        wait_text(hp, player_item(hp, friend.name), "Reconnecting")
        dropped = next(x for x in host.get(f"/v1/lobbies/{lobby_id}").json()["players"] if x["playerId"] == friend.id)
        assert dropped["connection"] == "reconnecting" and isinstance(dropped["rejoinSecondsLeft"], int)
        with opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
            wait_ui(hp, lambda: "Reconnecting" not in texts(player_item(hp, friend.name)))
        poll(lambda: next(x for x in host.get(f"/v1/lobbies/{lobby_id}").json()["players"] if x["playerId"] == friend.id),
             lambda x: x["dnf"] is True, EXPIRY_DEADLINE_S)
        wait_text(hp, status, re.compile(r"Finish grace: \d+ s"), seconds=LOBBY_RACE_S, step_ms=200)
        wait_text(hp, status, "Finished", seconds=EXPIRY_DEADLINE_S)
    final = host.get(f"/v1/lobbies/{lobby_id}").json()
    assert final["state"] == "finished" and all(x["dnf"] for x in final["players"])
    assert [m["kind"] for m in movements(host)] == ["opening"]


def league(player: Player, league_id: str) -> dict:
    return next(l for l in player.get("/v1/championship").json()["leagues"] if l["leagueId"] == league_id)


def test_league_points_and_concurrency(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch", "halcyon-rs"])
    locked = racer.post("/v1/runs", {"eventId": "club-circuit", "carId": "halcyon-rs"})
    assert locked.status_code == 403 and locked.json()["error"]["code"] == "LEAGUE_LOCKED"
    layout_locked = racer.post("/v1/runs", {"layoutId": "quarry-switchbacks", "mode": "practice", "carId": "kestrel-hatch"})
    assert layout_locked.status_code == 403 and layout_locked.json()["error"]["code"] == "LAYOUT_LOCKED"
    assert league(racer, "club")["status"] == "locked"
    complete_rookie(racer)
    rookie = league(racer, "rookie")
    assert rookie["points"] == sum(e["points"] for e in rookie["events"]) == LEAGUE_TARGET
    assert {e["eventId"]: e["points"] for e in rookie["events"]} == {
        "rookie-circuit": EVENT_WIN_POINTS, "rookie-drift": 0, "rookie-time-trial": EVENT_WIN_POINTS}
    assert league(racer, "club")["status"] == "open"
    assert racer.post("/v1/runs", {"layoutId": "quarry-switchbacks", "mode": "practice", "carId": "kestrel-hatch"}).status_code == 201
    settled(racer, race(racer, eventId="rookie-circuit", carId="kestrel-hatch", driver="coast"))
    assert league(racer, "rookie")["points"] == LEAGUE_TARGET
    ids = together(lambda: race(racer, eventId="club-circuit", carId="halcyon-rs"),
                   lambda: race(racer, eventId="club-time-trial", carId="halcyon-rs"))
    for rid in ids:
        assert settled(racer, rid)["status"] == "verified"
    champ = poll(lambda: racer.get("/v1/championship").json(), lambda c: c["trophy"] is True)
    club = next(l for l in champ["leagues"] if l["leagueId"] == "club")
    assert club["status"] == "complete" and club["points"] == sum(e["points"] for e in club["events"]) >= LEAGUE_TARGET
    settled(racer, race(racer, eventId="club-circuit", carId="halcyon-rs"))
    finals = [m for m in movements(racer) if m["kind"] == "finals"]
    assert len(finals) == 1 and wallet(racer, finals[0]) == FINALS_COINS
    assert {e["account"] for e in finals[0]["entries"]} == {f"wallet:{racer.id}", "house:grants"}


def test_wf_championship_ladder_keyboard(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/championship", racer) as p:
        rookie, club = p.get_by_role("region", name="Rookie league"), p.get_by_role("region", name="Club league")
        expect(rookie).to_contain_text(f"0 / {LEAGUE_TARGET} points")
        expect(club).to_contain_text(CLUB_LOCKED)
        tab_to(p, p.get_by_role("button", name=enter_name("Rookie Circuit")))
        p.keyboard.press("Enter")
        wait_ui(p, lambda: p.url == app_url + race_path("saltflat-ring", "circuit", event="rookie-circuit"))
        expect(p.get_by_role("region", name="Race HUD")).to_be_focused()
        complete_rookie(racer)
        p.goto(app_url + "/championship")
        expect(rookie).to_contain_text("Complete")
        expect(rookie).to_contain_text(f"{EVENT_WIN_POINTS} pts")
        expect(club).to_contain_text(f"0 / {LEAGUE_TARGET} points")
        expect(club).not_to_contain_text(CLUB_LOCKED)
        tab_to(p, p.get_by_role("button", name=enter_name("Club Circuit")))
        p.goto(app_url + "/garage")
        ref_map = p.get_by_role("combobox", name="Reference map")
        select(ref_map, "Quarry Switchbacks")
        assert chosen(ref_map) == "Quarry Switchbacks"
    assert league(racer, "rookie")["status"] == "complete"


def test_wf_championship_concurrent_completion(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch", "halcyon-rs"])
    with opened(browser, app_url, "/championship", racer) as p, opened(browser, app_url, "/garage", racer) as g:
        rookie, club = p.get_by_role("region", name="Rookie league"), p.get_by_role("region", name="Club league")
        updates = p.get_by_role("status", name="Championship updates")
        heard = Announcements(updates)
        expect(rookie).to_contain_text(f"0 / {LEAGUE_TARGET} points")
        heard.sample()
        navs: list[str] = []
        p.on("framenavigated", lambda f: navs.append(f.url))
        complete_rookie(racer)
        wait_ui(p, lambda: ROOKIE_DONE in heard.sample())
        expect(rookie).to_contain_text("Complete")
        expect(club).not_to_contain_text(CLUB_LOCKED)
        ref_map = g.get_by_role("combobox", name="Reference map")
        def quarry_offered() -> bool:
            try:
                select(ref_map, "Quarry Switchbacks")
            except Exception:
                return False
            return True

        wait_ui(g, quarry_offered)
        ids = together(lambda: race(racer, eventId="club-circuit", carId="halcyon-rs"),
                       lambda: race(racer, eventId="club-time-trial", carId="halcyon-rs"))
        for rid in ids:
            assert settled(racer, rid)["status"] == "verified"
        wait_ui(p, lambda: CLUB_DONE in heard.sample())
        expect(club).to_contain_text(TROPHY)
        for _ in range(LIVE_MS // 100):
            advance(p, 100)
            heard.sample()
        assert heard.count(ROOKIE_DONE) == 1 and heard.count(CLUB_DONE) == 1, heard.samples
        assert navs == []
    champ = racer.get("/v1/championship").json()
    assert champ["trophy"] is True
    for lg in champ["leagues"]:
        assert lg["status"] == "complete" and lg["points"] == sum(e["points"] for e in lg["events"]) >= LEAGUE_TARGET
    finals = [m for m in movements(racer) if m["kind"] == "finals"]
    assert len(finals) == 1 and wallet(racer, finals[0]) == FINALS_COINS


def test_loaner_car(app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    complete_rookie(racer)
    event = next(e for e in league(racer, "club")["events"] if e["eventId"] == "club-circuit")
    assert event["eligible"] is False and event["loanerCarId"] == "halcyon-rs"
    r = racer.post("/v1/runs", {"eventId": "club-circuit", "carId": "kestrel-hatch"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CAR_NOT_ELIGIBLE"
    r = racer.post("/v1/runs", {"eventId": "club-circuit", "carId": "halcyon-rs"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    loaned = new_run(racer, eventId="club-circuit", loaner=True, carId="kestrel-hatch")
    assert loaned["loaner"] is True and loaned["carId"] == "halcyon-rs"
    assert all(v == 0 for v in loaned["car"]["stages"].values())
    r = racer.post("/v1/runs", {"layoutId": "saltflat-ring", "mode": "circuit", "loaner": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "LOANER_NOT_OFFERED"
    run = settled(racer, race(racer, eventId="club-circuit", loaner=True))
    assert run["status"] == "verified" and run["loaner"] is True and run["position"] == 1
    placing = CIRCUIT_PLACING[1] + (CIRCUIT_PLACING[1] * CLEAN_BONUS_PCT // 100 if run["clean"] else 0)
    assert payouts(racer, run["runId"]) == {"pickups": middle_lane_coins("quarry-switchbacks", 3), "result": placing // 2}
    owner = new_player(app_url, cars=["kestrel-hatch", "halcyon-rs"])
    complete_rookie(owner)
    r = owner.post("/v1/runs", {"eventId": "club-circuit", "loaner": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "LOANER_NOT_OFFERED"


def test_wf_championship_loaner(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    complete_rookie(racer)
    with opened(browser, app_url, "/championship", racer) as p:
        enter = p.get_by_role("button", name=enter_name("Club Circuit"))
        tab_to(p, enter)
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name="Loaner car")
        expect(dialog).to_contain_text(loaner_copy("C", "Halcyon RS"))
        dialog.get_by_role("button", name="Cancel").click()
        advance(p, 500)
        expect(dialog).to_be_hidden()
        enter.click()
        with p.expect_response(lambda r: r.url.endswith("/v1/runs") and r.request.method == "POST") as info:
            p.get_by_role("dialog", name="Loaner car").get_by_role("button", name="Race the loaner").click()
        wait_ui(p, lambda: p.url == app_url + race_path("quarry-switchbacks", "circuit", event="club-circuit"))
        run = info.value.json()
        assert info.value.status == 201 and run["loaner"] is True and run["carId"] == "halcyon-rs"
    assert racer.get(f"/v1/runs/{run['runId']}").json()["loaner"] is True


def inbox(mail: Mailpit, address: str, count: int) -> list[dict]:
    return poll(lambda: [m for m in mail.messages(0, settle=0) if address in addresses(m.get("To"))],
                lambda ms: len(ms) >= count, MAIL_WAIT_S)


def token_of(message: dict) -> str:
    m = re.search(r"/sign-in/([^\s\"'<>]+)", text(message))
    assert m, text(message)
    return m.group(1)


def test_signin_link_email(app_url, mail):
    r = httpx.post(app_url + "/v1/auth/links", json={"email": "not-an-email"}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 422 and "email" in (r.json()["error"].get("fields") or r.json().get("fields") or {})
    _, email = unique("signin")
    r = httpx.post(app_url + "/v1/auth/links", json={"email": email}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 202 and r.json() == {"status": "sent"}
    inbox(mail, email, 1)
    msgs = [m for m in mail.messages(1) if email in addresses(m.get("To"))]
    assert len(msgs) == 1
    assert msgs[0]["Subject"] == MAIL_SUBJECT and addresses(msgs[0]["From"]) == [mail_from_address()]
    token = token_of(msgs[0])
    redeemed = httpx.post(app_url + "/v1/auth/redeem", json={"token": token}, timeout=HTTP_TIMEOUT_S)
    assert redeemed.status_code == 200 and redeemed.json()["outcome"] == "new_account"
    me = Player(app_url, redeemed.cookies["kerb_session"]).get("/v1/me").json()
    assert me["guest"] is False and me["email"] == email and me["name"] == email.split("@")[0]
    reused = httpx.post(app_url + "/v1/auth/redeem", json={"token": token}, timeout=HTTP_TIMEOUT_S)
    assert reused.status_code == 410 and reused.json()["error"]["code"] == "LINK_EXPIRED"
    _, later = unique("expiry")
    for _ in range(EXPIRY_LINKS):
        assert httpx.post(app_url + "/v1/auth/links", json={"email": later}, timeout=HTTP_TIMEOUT_S).status_code == 202
    tokens = iter(token_of(m) for m in sorted(inbox(mail, later, EXPIRY_LINKS), key=lambda m: m.get("Created", "")))
    outcomes: list[int] = []

    def attempt() -> int:
        status = httpx.post(app_url + "/v1/auth/redeem", json={"token": next(tokens)},
                            timeout=HTTP_TIMEOUT_S).status_code
        outcomes.append(status)
        return status

    poll(attempt, lambda s: s == 410, EXPIRY_DEADLINE_S, every=EXPIRY_TRY_S)
    assert outcomes[0] == 200 and outcomes[-1] == 410, outcomes


def test_wf_email_sign_in_guest_upgrade(browser, app_url, mail):
    _, email = unique("save")
    with opened(browser, app_url, "/") as p:
        p.get_by_role("checkbox", name="I am 13 or older").check()
        p.get_by_role("button", name="Start racing").click()
        wait_ui(p, lambda: "/race" in p.url)
        guest = browser_player(p, app_url)
        before = guest.get("/v1/garage").json()
        p.goto(app_url + "/garage")
        p.get_by_role("link", name="Save my garage").click()
        wait_ui(p, lambda: urllib.parse.urlparse(p.url).path == "/sign-in")
        p.get_by_role("textbox", name="Email").fill(email)
        p.get_by_role("button", name="Send sign-in link").click()
        expect(p.get_by_role("status", name="Sign-in status")).to_have_text(f"Check {email} for your sign-in link.")
        p.goto(f"{app_url}/sign-in/{token_of(inbox(mail, email, 1)[0])}")
        wait_text(p, p.get_by_role("status", name="Sign-in status"), f"Signed in as {email}. Your garage is saved.")
        me = browser_player(p, app_url).get("/v1/me").json()
        assert me["playerId"] == guest.id and me["guest"] is False and me["email"] == email
        assert browser_player(p, app_url).get("/v1/garage").json() == before
        p.goto(app_url + "/garage")
        expect(balance_region(p)).to_be_visible()
        assert p.get_by_role("link", name="Save my garage").count() == 0


def test_wf_email_sign_in_choice(browser, app_url, mail):
    _, email = unique("keep")
    httpx.post(app_url + "/v1/auth/links", json={"email": email}, timeout=HTTP_TIMEOUT_S)
    r = httpx.post(app_url + "/v1/auth/redeem", json={"token": token_of(inbox(mail, email, 1)[0])}, timeout=HTTP_TIMEOUT_S)
    account = Player(app_url, r.cookies["kerb_session"], r.json()["playerId"])
    buy(account, "kestrel-hatch", "engine", 1)
    device = new_guest(app_url)
    buy(device, "kestrel-hatch", "tires", 1)
    with opened(browser, app_url, "/sign-in", device) as p:
        p.get_by_role("textbox", name="Email").fill(email)
        p.get_by_role("button", name="Send sign-in link").click()
        expect(p.get_by_role("status", name="Sign-in status")).to_have_text(f"Check {email} for your sign-in link.")
        newest = max(inbox(mail, email, 2), key=lambda m: m.get("Created", ""))
        token = token_of(newest)
        p.goto(f"{app_url}/sign-in/{token}")
        dialog = p.get_by_role("dialog", name="Keep which garage?")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Keep this device's garage")).to_be_focused()
        p.keyboard.press("Escape")
        advance(p, 500)
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Keep my account's garage").click()
        wait_text(p, p.get_by_role("status", name="Sign-in status"), f"Signed in as {email}. Your garage is saved.")
        assert browser_player(p, app_url).id == account.id
    with opened(browser, app_url, f"/sign-in/{token}") as again:
        status = again.get_by_role("status", name="Sign-in status")
        wait_text(again, status, LINK_EXPIRED)
        expect(again.get_by_role("link", name="Send a new one")).to_have_attribute("href", re.compile(r"/sign-in$"))


def test_wf_email_sign_in_mail_outage(browser, mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/")
    _, api_email = unique("outage")
    r = httpx.post(base + "/v1/auth/links", json={"email": api_email}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 503 and r.json()["error"]["code"] == "MAIL_UNAVAILABLE"
    _, ui_email = unique("outage")
    with opened(browser, base, "/sign-in") as p:
        p.get_by_role("textbox", name="Email").fill(ui_email)
        p.get_by_role("button", name="Send sign-in link").click()
        wait_text(p, p.get_by_role("status", name="Sign-in status"), MAIL_OUTAGE, step_ms=250)
    assert not [m for m in mail.messages(0) if {api_email, ui_email} & set(addresses(m.get("To")))]


SCREENS = {
    "/garage": ("button", upgrade_name("Engine", 1)),
    "/garage/dealer": ("button", buy_car_name("Halcyon RS", HALCYON_PRICE)),
    "/garage/coins": ("table", "Coin history"),
    "/boards": ("combobox", "Map"),
    "/championship": ("button", enter_name("Rookie Circuit")),
    "/sign-in": ("textbox", "Email"),
}


def test_accessibility_viewports(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer) as p:
        for width, height in VIEWPORTS:
            p.set_viewport_size({"width": width, "height": height})
            for path, (role, name) in SCREENS.items():
                p.goto(app_url + path)
                landmark = p.get_by_role(role, name=name)
                expect(landmark).to_be_visible()
                axe(p)
                layout(p)
                target = landmark if role != "table" else p.get_by_role("link", name="Garage", exact=True) \
                    if width >= 768 else p.get_by_role("button", name="Menu")
                rest, focused = state_styles(target, "outline-style", "outline-width", "box-shadow", state="focus")
                ring = focused["outline-style"] != "none" and float(focused["outline-width"].rstrip("px") or 0) >= FOCUS_RING_PX
                assert ring or focused["box-shadow"] != rest["box-shadow"], (path, width, focused)


def test_health_and_grading_routes(app_url):
    for base in (app_url, os.environ["APP_MINIO_DOWN_URL"], os.environ["APP_MAILPIT_DOWN_URL"]):
        r = httpx.get(base.rstrip("/") + "/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert httpx.post(app_url + "/v1/grading/players", json={}, timeout=HTTP_TIMEOUT_S).status_code == 201
    for path in ("/package.json", "/.env", "/package-lock.json"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404
    with app_copy({"GRADING_ROUTES": "off"}) as base:
        assert httpx.get(base + "/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
        for path in ("/v1/grading/players", "/v1/grading/races"):
            r = httpx.post(base + path, json={}, timeout=HTTP_TIMEOUT_S)
            assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_wf_two_tab_spend_run_payout_push(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage", racer) as a, opened(browser, app_url, "/garage", racer) as b:
        loads: list[int] = []
        for tab in (a, b):
            wait_text(tab, balance_region(tab), f"{fmt_coins(OPENING)} coins")
            tab.on("load", lambda *_: loads.append(1))
        run = settled(racer, race(racer, layoutId="saltflat-ring", mode="practice", carId="kestrel-hatch"))
        assert run["status"] == "verified" and run["payout"] > 0
        for tab in (a, b):
            wait_text(tab, balance_region(tab), f"{fmt_coins(OPENING + run['payout'])} coins")
        assert loads == []
    assert balance(racer) == OPENING + run["payout"]


def test_wf_two_tab_spend_other_tab_at_once(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    left = OPENING - PRICES["D"][0]
    with opened(browser, app_url, "/garage", racer) as a, opened(browser, app_url, "/garage", racer) as b:
        loads: list[int] = []
        b.on("load", lambda *_: loads.append(1))
        wait_text(b, balance_region(b), f"{fmt_coins(OPENING)} coins")
        opener = pips(a, "Tires").get_by_role("button", name=upgrade_name("Tires", 1))
        expect(opener).to_be_visible()
        opener.click()
        dialog = a.get_by_role("dialog", name="Confirm upgrade")
        dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][0])} coins").click()
        wait_text(b, balance_region(b), f"{fmt_coins(left)} coins")
        assert loads == []
    assert balance(racer) == left and garage_car(racer, "kestrel-hatch")["stages"]["tires"] == 1


def test_wf_refit_ledger_refit_cancel(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    buy(racer, "kestrel-hatch", "tires", 1)
    with opened(browser, app_url, "/garage", racer) as p:
        slot = pips(p, "Tires")
        opener = slot.get_by_role("button", name=refit_name("Tires"))
        expect(opener).to_be_visible()
        opener.focus()
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name="Confirm refit")
        expect(dialog).to_be_visible()
        wait_ui(p, lambda: dialog.evaluate("d => d.contains(document.activeElement)"))
        focus_kept(p, dialog, "Tab")
        focus_kept(p, dialog, "Shift+Tab")
        p.keyboard.press("Escape")
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        p.keyboard.press("Enter")
        cancel = dialog.get_by_role("button", name="Cancel")
        expect(cancel).to_be_visible()
        cancel.focus()
        p.keyboard.press("Enter")
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(slot.get_by_role("img", name=stage_img(1))).to_be_visible()
    assert garage_car(racer, "kestrel-hatch")["stages"]["tires"] == 1
    assert [m for m in movements(racer) if m["kind"] == "refit"] == [] and balance(racer) == OPENING - PRICES["D"][0]


def test_wf_refit_ledger_stage3_refit(browser, app_url):
    paid = sum(PRICES["D"])
    refund = paid // 2
    racer = new_player(app_url, coins=paid, cars=["kestrel-hatch"])
    for stage in (1, 2):
        buy(racer, "kestrel-hatch", "engine", stage)
    with opened(browser, app_url, "/garage", racer) as p:
        slot = pips(p, "Engine")
        opener = slot.get_by_role("button", name=upgrade_name("Engine", 3))
        expect(opener).to_be_visible()
        opener.focus()
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name="Confirm upgrade")
        expect(dialog.get_by_role("button", name=f"Buy for {fmt_coins(PRICES['D'][2])} coins")).to_be_focused()
        p.keyboard.press("Enter")
        refit = slot.get_by_role("button", name=refit_name("Engine"))
        advance(p, 500)
        expect(dialog).to_be_hidden()
        expect(refit).to_be_focused()
        updates = p.get_by_role("status", name="Garage updates")
        wait_text(p, updates, fitted("Engine", 3))
        wait_ui(p, lambda: slot.get_by_role("img", name=stage_img(3)).count() == 1)
        refit.focus()
        p.keyboard.press("Enter")
        confirm = p.get_by_role("dialog", name="Confirm refit").get_by_role("button", name=f"Refit and refund {fmt_coins(refund)} coins")
        expect(confirm).to_be_visible()
        confirm.focus()
        p.keyboard.press("Enter")
        advance(p, 500)
        expect(slot.get_by_role("button", name=upgrade_name("Engine", 1))).to_be_focused()
        wait_text(p, updates, refitted("Engine"))
        expect(slot.get_by_role("img", name=stage_img(0))).to_be_visible()
    refits = [wallet(racer, m) for m in movements(racer) if m["kind"] == "refit"]
    assert refits == [refund] and garage_car(racer, "kestrel-hatch")["stages"]["engine"] == 0 and balance(racer) == refund


def test_wf_time_trial_ghost_download_link(browser, app_url):
    owner, run, body = ghost_run(app_url)
    viewer = new_player(app_url)
    with opened(browser, app_url, "/boards", viewer) as p:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        row = board_row(p, owner.name)
        wait_ui(p, lambda: row.count() == 1)
        link = row.get_by_role("link", name="Download replay")
        expect(link).to_be_visible()
        href = link.get_attribute("href") or ""
    url = href if href.startswith("http") else app_url.rstrip("/") + href
    assert same_origin(url, app_url)
    got = httpx.get(url, headers={"Cookie": f"kerb_session={viewer.cookie}"}, timeout=HTTP_TIMEOUT_S)
    assert got.status_code == 200 and got.content == body and got.headers["X-Replay-SHA256"] == sha(body)


def test_wf_leaderboards_phone_rows(browser, app_url):
    viewer = new_player(app_url, cars=["wren-coupe"])
    inputs = generate("saltflat-ring", "wren-coupe", 1, STEP_LIMIT_PER_LAP, scale=CAUTIOUS)
    run, _ = submit(viewer, inputs, layoutId="saltflat-ring", mode="time-trial", carId="wren-coupe", laps=1)
    assert settled(viewer, run["runId"])["status"] == "verified"
    with opened(browser, app_url, "/boards", viewer, width=375, height=812) as p:
        choose_board(p, "Saltflat Ring", "Time trial", "D")
        you = re.compile(r"\bYou\b")
        mine = p.get_by_role("table", name="Leaderboard").get_by_role("row").filter(
            has=p.get_by_role("cell", name=you).or_(p.get_by_role("rowheader", name=you)))
        wait_ui(p, lambda: mine.count() == 1)
        boxes = [box(p.get_by_role("combobox", name=n)) for n in ("Map", "Mode", "Class")]
        for upper, lower in zip(boxes, boxes[1:]):
            assert lower["y"] >= upper["y"] + upper["height"] - 1, boxes
        expect(mine.get_by_role("link", name="Download replay")).to_be_visible()
        ghost = mine.get_by_role("button", name="Race this ghost")
        assert ghost.count() == 0 or not ghost.is_visible()
        layout(p)
        p.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(mine.get_by_role("button", name="Race this ghost")).to_be_visible()


def test_wf_leaderboards_reduced_motion_arrival(browser, app_url):
    viewer = new_player(app_url, cars=["ferrule-sport"])
    newcomer = new_player(app_url, cars=["ferrule-sport"], name=True)
    with opened(browser, app_url, "/boards", viewer, reduced_motion="reduce") as p:
        loads: list[int] = []
        p.on("load", lambda *_: loads.append(1))
        choose_board(p, "Saltflat Ring", "Time trial", "C")
        expect(p.get_by_role("table", name="Leaderboard")).to_be_visible()
        assert settled(newcomer, race(newcomer, layoutId="saltflat-ring", mode="time-trial", carId="ferrule-sport", laps=1))["status"] == "verified"
        row = board_row(p, newcomer.name)
        wait_ui(p, lambda: row.count() == 1, seconds=BOARD_PUSH_S + UI_WAIT_S)
        advance(p, RM_PAINT_MS)
        assert animations(row) == []
        assert loads == []


def joined_lobby(host: Player, friend: Player) -> str:
    lobby_id = host.post("/v1/lobbies", {"aiCount": 0}).json()["lobbyId"]
    assert friend.post(f"/v1/lobbies/{lobby_id}/join", {}).status_code == 200
    return lobby_id


def test_wf_online_lobby_drop_and_rejoin(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"], name=True)
    friend = new_player(app_url, cars=["kestrel-hatch"], name=True)
    lobby_id = joined_lobby(host, friend)
    with opened(browser, app_url, f"/lobby/{lobby_id}", host) as hp:
        status = hp.get_by_role("status", name="Lobby status")
        friend_row = player_item(hp, friend.name)
        with opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
            wait_ui(fp, lambda: player_item(fp, host.name).count() == 1)
            for pl in (host, friend):
                assert pl.post(f"/v1/lobbies/{lobby_id}/ready", {"ready": True}).status_code == 200
            wait_text(hp, status, "Racing")
            wait_text(fp, fp.get_by_role("status", name="Lobby status"), "Racing")
        wait_text(hp, friend_row, "Reconnecting")
        away = next(x for x in host.get(f"/v1/lobbies/{lobby_id}").json()["players"] if x["playerId"] == friend.id)
        assert away["connection"] == "reconnecting" and isinstance(away["rejoinSecondsLeft"], int)
        with opened(browser, app_url, f"/lobby/{lobby_id}", friend) as back:
            wait_ui(back, lambda: player_item(back, host.name).count() == 1)
            wait_ui(hp, lambda: friend_row.count() == 1 and "Reconnecting" not in texts(friend_row))
            again = next(x for x in host.get(f"/v1/lobbies/{lobby_id}").json()["players"] if x["playerId"] == friend.id)
            assert again["connection"] == "connected" and again["dnf"] is False


def test_wf_online_lobby_started(browser, app_url):
    host, friend = new_player(app_url, name=True), new_player(app_url, name=True)
    lobby_id = joined_lobby(host, friend)
    for pl in (host, friend):
        assert pl.post(f"/v1/lobbies/{lobby_id}/ready", {"ready": True}).status_code == 200
    poll(lambda: host.get(f"/v1/lobbies/{lobby_id}").json()["state"], lambda s: s != "open")
    late = new_player(app_url)
    with opened(browser, app_url, f"/lobby/{lobby_id}", late) as p:
        join, message = p.get_by_role("button", name="Join lobby"), p.get_by_text(LOBBY_STARTED, exact=True)
        wait_ui(p, lambda: message.count() > 0 or (join.count() > 0 and join.is_visible()))
        if not message.count():
            join.focus()
            p.keyboard.press("Enter")
        expect(message).to_be_visible()
    assert late.id not in {x["playerId"] for x in host.get(f"/v1/lobbies/{lobby_id}").json()["players"]}


def test_wf_online_lobby_race_payout(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"], name=True)
    friend = new_player(app_url, cars=["kestrel-hatch"], name=True)
    lobby_id = joined_lobby(host, friend)
    with opened(browser, app_url, f"/lobby/{lobby_id}", host) as hp, opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
        h_status, f_status = (pg.get_by_role("status", name="Lobby status") for pg in (hp, fp))
        wait_ui(hp, lambda: player_item(hp, friend.name).count() == 1)
        for pl in (host, friend):
            assert pl.post(f"/v1/lobbies/{lobby_id}/ready", {"ready": True}).status_code == 200
        wait_text(hp, h_status, "Racing")
        hp.keyboard.down("ArrowUp")
        fp.keyboard.down("ArrowUp")
        wait_text(hp, h_status, "Finished", seconds=LOBBY_RACE_S, step_ms=500)
        hp.keyboard.up("ArrowUp")
        fp.keyboard.up("ArrowUp")
        wait_text(fp, f_status, "Finished")
    final = host.get(f"/v1/lobbies/{lobby_id}").json()
    assert final["state"] == "finished"
    for pl in (host, friend):
        entry = next(x for x in final["players"] if x["playerId"] == pl.id)
        assert entry["dnf"] is False
        results = [m for m in movements(pl) if m["kind"] == "result"]
        assert len(results) == 1 and wallet(pl, results[0]) == ONLINE_PLACING[entry["position"]]


def test_wf_championship_best_points_kept(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    for driver in ("reference", "coast"):
        assert settled(racer, race(racer, driver, eventId="rookie-time-trial", carId="kestrel-hatch"))["status"] == "verified"
    with opened(browser, app_url, "/championship", racer) as p:
        rookie = p.get_by_role("region", name="Rookie league")
        for _ in range(2):
            wait_text(p, rookie, f"{EVENT_WIN_POINTS} / {LEAGUE_TARGET} points")
            wait_text(p, rookie, f"{EVENT_WIN_POINTS} pts")
            assert f"{TT_SLOW_POINTS} pts" not in texts(rookie)
            p.reload()
        enter = p.get_by_role("button", name=enter_name("Rookie Time Trial"))
        expect(enter).to_be_visible()
        enter.focus()
        p.keyboard.press("Enter")
        wait_ui(p, lambda: urllib.parse.urlparse(p.url).path == "/race" and "event=rookie-time-trial" in urllib.parse.urlparse(p.url).query)
    assert league(racer, "rookie")["points"] == EVENT_WIN_POINTS


def test_wf_email_sign_in_used_link(browser, app_url, mail):
    _, email = unique("used")
    with opened(browser, app_url, "/") as p:
        p.get_by_role("checkbox", name="I am 13 or older").check()
        p.get_by_role("button", name="Start racing").click()
        wait_ui(p, lambda: "/race" in p.url)
        p.goto(app_url + "/sign-in")
        p.get_by_role("textbox", name="Email").fill(email)
        p.get_by_role("button", name="Send sign-in link").click()
        status = p.get_by_role("status", name="Sign-in status")
        expect(status).to_have_text(f"Check {email} for your sign-in link.")
        token = token_of(inbox(mail, email, 1)[0])
        p.goto(f"{app_url}/sign-in/{token}")
        wait_text(p, status, f"Signed in as {email}. Your garage is saved.")
    with opened(browser, app_url, f"/sign-in/{token}") as again:
        wait_text(again, again.get_by_role("status", name="Sign-in status"), LINK_EXPIRED)
        again.get_by_role("link", name="Send a new one").click()
        wait_ui(again, lambda: urllib.parse.urlparse(again.url).path == "/sign-in")
        expect(again.get_by_role("textbox", name="Email")).to_be_visible()


SKIP_DIRS = {"node_modules", ".git", "dist", "build"}


def app_files(root: Path = APP, skip: set[str] = SKIP_DIRS) -> Iterator[Path]:
    for path in root.rglob("*"):
        if path.is_file() and not skip & set(path.relative_to(root).parts):
            yield path


def test_if_run_manifest():
    data = json.loads((APP / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or p.version not in notices]
    assert missing == []


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert bad == []


def test_if_datastores():
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb"}
    assert not [p.name for p in shipped_packages() if p.name in banned]
    assert not [f for f in app_files() if f.suffix in {".sqlite", ".sqlite3", ".db"}]


def test_if_no_media_assets():
    media = {".glb", ".gltf", ".obj", ".fbx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ktx2", ".hdr",
             ".mp3", ".wav", ".ogg"}
    assert [str(f) for f in app_files() if f.suffix.lower() in media] == []
    deployed = app_files(Path(DEPLOYED_APP), {"node_modules", ".git"})
    assert [str(f) for f in deployed if f.suffix.lower() in media] == []


def test_if_same_origin(browser, app_url):
    racer = new_player(app_url, cars=["kestrel-hatch"])
    urls: list[str] = []
    with opened(browser, app_url, "/garage", racer) as p:
        p.on("request", lambda r: urls.append(r.url))
        p.reload()
        expect(balance_region(p)).to_be_visible()
        p.goto(app_url + "/boards")
        expect(p.get_by_role("combobox", name="Map")).to_be_visible()
    assert [u for u in urls if u.split(":")[0] in ("http", "https", "ws", "wss") and not same_origin(u, app_url)] == []


def test_if_typescript_source():
    built = {m.split("/")[0] for c in APP.glob("tsconfig*.json")
             for m in re.findall(r'"outDir"\s*:\s*"(?:\./)?([^"]+)"', c.read_text())}
    js = [f for f in app_files(skip=SKIP_DIRS | built)
          if f.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in f.name]
    assert [str(f) for f in js] == []
    assert any(f.suffix in {".ts", ".tsx"} for f in app_files())


def test_if_service_definitions():
    compose = [f for f in app_files() if re.fullmatch(r"(docker-)?compose(\.[\w-]+)?\.ya?ml", f.name)]
    assert all(all(s in f.read_text(errors="replace").lower() for s in ("postgres", "minio", "mailpit")) for f in compose), compose


def test_wf_upgrade_purchase_error_order(app_url):
    racer = new_player(app_url, coins=2000, cars=["kestrel-hatch"])
    start = balance(racer)
    path = upgrade_path("kestrel-hatch", "tires")
    r = racer.post(path, raw=b"[]")
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED", r.text
    r = racer.post(upgrade_path("halcyon-rs", "tires"), raw=b"[]", key=idempotency_key())
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND", r.text
    r = racer.post(path, raw=b"[]", key=idempotency_key())
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED", r.text
    assert balance(racer) == start


def test_wf_two_tab_spend_dealer_live_dialog(browser, app_url):
    racer = new_player(app_url, coins=HALCYON_PRICE + 200, cars=["kestrel-hatch"])
    with opened(browser, app_url, "/garage/dealer", racer) as p:
        p.get_by_role("button", name=buy_car_name("Halcyon RS", HALCYON_PRICE)).click()
        dialog = p.get_by_role("dialog", name="Confirm car purchase")
        expect(dialog).to_be_visible()
        buy(racer, "kestrel-hatch", "engine", 1)
        wait_text(p, dialog, NOT_ENOUGH)
        expect(dialog).to_contain_text(f"You need {fmt_coins(PRICES['D'][0] - 200)} more coins.")
        advance(p, 100)
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()


def test_wf_online_lobby_hud_speed(browser, app_url):
    host = new_player(app_url, cars=["kestrel-hatch"], name=True)
    friend = new_player(app_url, cars=["kestrel-hatch"], name=True)
    lobby_id = joined_lobby(host, friend)
    with opened(browser, app_url, f"/lobby/{lobby_id}", host) as hp, opened(browser, app_url, f"/lobby/{lobby_id}", friend) as fp:
        status = hp.get_by_role("status", name="Lobby status")
        wait_ui(hp, lambda: player_item(hp, friend.name).count() == 1)
        for pl in (host, friend):
            assert pl.post(f"/v1/lobbies/{lobby_id}/ready", {"ready": True}).status_code == 200
        wait_text(hp, status, "Racing")
        hp.keyboard.down("ArrowUp")
        fp.keyboard.down("ArrowUp")
        hud = hp.get_by_role("region", name="Race HUD")
        wait_ui(hp, lambda: re.search(r"\b[1-9]\d* (km/h|mph)", texts(hud)) is not None)
        hp.keyboard.up("ArrowUp")
        fp.keyboard.up("ArrowUp")


def test_wf_email_sign_in_expired_copy_exact(browser, app_url, mail):
    _, email = unique("exact")
    assert httpx.post(app_url + "/v1/auth/links", json={"email": email}, timeout=HTTP_TIMEOUT_S).status_code == 202
    token = token_of(inbox(mail, email, 1)[0])
    assert httpx.post(app_url + "/v1/auth/redeem", json={"token": token}, timeout=HTTP_TIMEOUT_S).status_code == 200
    with opened(browser, app_url, f"/sign-in/{token}") as p:
        status = p.get_by_role("status", name="Sign-in status")
        wait_text(p, status, LINK_EXPIRED)
        expect(status).to_have_text(LINK_EXPIRED)


def test_grading_routes_off_answer_first(app_url):
    with app_copy({"GRADING_ROUTES": "off"}) as base:
        for path in ("/v1/grading/players", "/v1/grading/races"):
            for name, kwargs in (("media type", {"content": b"x", "headers": {"Content-Type": "text/plain"}}),
                                 ("origin", {"json": {}, "headers": {"Origin": FOREIGN}}),
                                 ("size", {"content": b" " * 70000, "headers": {"Content-Type": "application/json"}})):
                r = httpx.post(base + path, timeout=HTTP_TIMEOUT_S, **kwargs)
                assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND", (name, r.status_code, r.text)
