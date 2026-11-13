from __future__ import annotations

import concurrent.futures
import contextlib
import hashlib
import json
import os
import re
import signal
import socket
import string
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    animations,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    shipped_packages,
    tab_order,
    tap,
    until,
)


DESK = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
JSON_LIMIT = 16384
LIVE_FRAME_LIMIT = 4096
LINK_OFF_CLOSE = 4410
TOO_BIG_CLOSE = 1009
NAME_MAX = 24
CLUE_MAX = 300
LISTED_MAX = 20
HOUR_S = 3600
LIVE_MS = 2000
BOARD_REFRESH_MS = 10000
DEFAULT_CONFIG = {"presence_grace_ms": 15000, "heartbeat_ms": 5000, "upload_max_bytes": 65536, "max_grid": 25, "max_players": 8, "live_rate": 30, "toast_ms": 4000, "replay_step_ms": 500}
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
HOUR_PLUS_MS = 3729000
CLOCK_MS = 724000
SHORT_TIME_MS = 7000
REBUS_MAX = 8
COOKIE_ATTRS = "HttpOnly; SameSite=Lax; Path=/"
CONTENT_JSON = "application/json; charset=utf-8"
TEXT_PLAIN = "text/plain; charset=utf-8"
PENCIL_MARK = ", pencil"
WRONG_MARK = ", checked wrong"
RIGHT_MARK = ", checked right"
REVEALED_MARK = ", revealed"
EMPTY = "empty"
HERE = " · Here"
AWAY = " · Away"
HOST = " · Host"

READY_MS = 15000
HTTP_TIMEOUT = 30
POLL_S = 0.2
SERVER_WAIT_S = 30
RECORD_WAIT_S = 60
COPY_BOOT_S = 180
RELAY_MAX_ACCEPTS = 100000
RELAY_MAX_CHUNKS = 10000000
RELAY_CHUNK = 65536
PIVOT_STEP_MS = 10
PIVOT_WINDOW_STEPS = 100
SCROLL_STEP_MS = 20
SCROLL_WINDOW_STEPS = 50
FRAME_MS = 16
PX_TOLERANCE = 2
TICK_S = 5
RACE_WRITES = 10
FAR_CLOCK = datetime(2031, 5, 17, 3, 0, 0)
SETTLE_S = 1.0
KEY_PACE_S = 0.08
CLOSE_SLACK_MS = 1000
UNKNOWN_CODE = "zzzzzzzzzzzz"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
LEAK_PROBES = ("/run.json", "/package-lock.json", "/package.json", "/.env", "/dist/server.js")

SHORT_URL_ENV = "APP_SHORT_URL"
DOWN_URL_ENV = "APP_MINIO_DOWN_URL"

MK = "morning-kettle"
NS = "night-shift"
LT = "long-table"
LIBRARY_TITLES = ["Morning Kettle", "Night Shift", "Harbour Lights", "Quiet Orchard", "Long Table"]
MK_ROWS = ["SCONE", "T#V#N", "EJECT", "A#N#E", "MISER"]
NS_ROWS = [["STAR", "L", "I", "N", "G"], list("S#O#U"), list("HOTEL"), list("I#A#L"), list("POSTS")]
MK_WHITE = sum(ch != "#" for row in MK_ROWS for ch in row)
MK_BLACK = sum(ch == "#" for row in MK_ROWS for ch in row)
MK_ACROSS = {1: "Crumbly bake served with jam", 4: "Push the tape out of the deck", 5: "One who hoards every coin"}
MK_DOWN = {1: "What rises from a kettle spout", 2: "Hot boxes that bake the bread", 3: "Step inside, or key in data"}
FAMILY = "\U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466"
NAMES = {"a": "Ada", "b": "Ben", "c": "Cy", "d": "Dee"}

FIRST_LINE = "first line must be Overlap 1"
TITLE_LEN = "Title must be 1 to 80 characters"
AUTHOR_LEN = "Author must be 1 to 60 characters"
SIZE_SYNTAX = "Size must look like 15x15"
REBUS_OPEN = "rebus brace is not closed"
CLUE_SYNTAX = "clue must look like 12. Clue text"
NOT_UTF8 = "file is not valid UTF-8"

MK_TEXT = (
    "Overlap 1\nTitle: Morning Kettle\nAuthor: Wren Halloway\nSize: 5x5\n\nGrid:\n"
    "SCONE\nT#V#N\nEJECT\nA#N#E\nMISER\n\nAcross:\n"
    "1. Crumbly bake served with jam\n4. Push the tape out of the deck\n5. One who hoards every coin\n\n"
    "Down:\n1. What rises from a kettle spout\n2. Hot boxes that bake the bread\n3. Step inside, or key in data\n"
)
NS_TEXT = (
    "Overlap 1\nTitle: Night Shift\nAuthor: Jun Okafor\nSize: 5x5\n\nGrid:\n"
    "{STAR}LING\nS#O#U\nHOTEL\nI#A#L\nPOSTS\n\nAcross:\n"
    "1. Speckled songbird that gathers in murmurations\n4. Place to stay with a front desk\n5. Fence uprights\n\n"
    "Down:\n1. Vessel bound for other planets\n2. Tiny amounts, or Greek letters\n3. Seaside birds that steal chips\n"
)

NAME_CASES = {"one_char": 201, "max_length": 201, "trimmed": 201, "emoji_max": 201, "too_long": 422, "blank": 422, "control": 422, "emoji_too_long": 422}
UPLOAD_CASES = {"first_line": 422, "three_errors": 422, "size_syntax": 422, "size_range": 422, "missing_grid": 422, "rebus": 422, "orphan": 422, "clue_matching": 422, "row_count": 422, "not_utf8": 422, "too_many": 422, "too_large": 413, "at_limit": 201}
PRECEDENCE = {"too_large_before_no_player": (413, "too_large"), "no_player": (401, "no_player"), "unknown_route": (404, "not_found"), "unknown_game": (404, "not_found"), "private_puzzle": (404, "not_found"), "not_found_before_invalid": (404, "not_found"), "not_host": (403, "not_host"), "invalid": (422, "invalid")}


@contextlib.contextmanager
def entered(handle: Any) -> Iterator[Any]:
    if hasattr(handle, "__enter__"):
        with handle as value:
            yield value
        return
    value = next(handle)
    try:
        yield value
    finally:
        handle.close()


def opened(browser: Browser, url: str, **options: Any) -> Any:
    return entered(open_app(browser, url, **options))


def poll(fetch: Callable[[], Any], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if last:
            return last
        threading.Event().wait(POLL_S)
    pytest.fail(f"{contract} (last seen: {last!r})")


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait()
        return call()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, call) for call in calls]
        return [future.result() for future in futures]


def short_url() -> str:
    return os.environ[SHORT_URL_ENV].rstrip("/")


def down_url() -> str:
    return os.environ[DOWN_URL_ENV].rstrip("/")


def name_for(key: str) -> str:
    return f"{NAMES.get(key, 'Pat')}{uuid.uuid4().hex[:6]}"


def marker() -> str:
    return uuid.uuid4().hex


def config(base: str) -> dict:
    response = httpx.get(base + "/api/config", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, response.text
    return response.json()


def seed(base: str, body: dict) -> dict:
    response = httpx.post(base + "/api/grading/seed", json=body, timeout=HTTP_TIMEOUT)
    assert response.status_code == 201, f"POST /api/grading/seed answered {response.status_code}: {response.text}"
    return response.json()


def seed_sq(row: int, col: int, value: str, state: str = "filled", owner: str = "a", pencil: bool = False) -> dict:
    return {"row": row, "col": col, "value": value, "pencil": pencil, "state": state, "owner": owner}


def mk_fill(skip: tuple = (), extra: tuple = ()) -> list[dict]:
    overridden = {(sq["row"], sq["col"]) for sq in extra}
    squares = [seed_sq(r, c, ch) for r, row in enumerate(MK_ROWS) for c, ch in enumerate(row)
               if ch != "#" and (r, c) not in skip and (r, c) not in overridden]
    return squares + list(extra)


class Seeded:
    def __init__(self, out: dict):
        game = out["games"]["g"]
        self.game_id = game["id"]
        self.code = game["code"]
        self.url = game["url"]
        self.puzzle_id = out["puzzles"]["p"]["id"]
        self.ids = {k: v["id"] for k, v in out["players"].items()}
        self.names = {k: v["display_name"] for k, v in out["players"].items()}
        self.room = f"/games/{self.game_id}"


def seed_game(base: str, members: tuple = ("a",), outsiders: tuple = (), fixture: str = MK, text: str | None = None,
              squares: Any = (), timer_state: str = "paused", elapsed_ms: int = 0) -> Seeded:
    keys = list(members) + [k for k in outsiders if k not in members]
    puzzle = {"key": "p", "text": text, "owner": members[0]} if text else {"key": "p", "fixture": fixture}
    body = {
        "players": [{"key": k, "display_name": name_for(k)} for k in keys],
        "puzzles": [puzzle],
        "games": [{"key": "g", "puzzle": "p", "host": members[0], "players": list(members),
                   "squares": list(squares), "elapsed_ms": elapsed_ms, "timer_state": timer_state}],
    }
    return Seeded(seed(base, body))


def seed_players(base: str, *keys: str) -> dict[str, str]:
    out = seed(base, {"players": [{"key": k, "display_name": name_for(k)} for k in keys]})
    return {k: v["id"] for k, v in out["players"].items()}


def player_client(base: str, player_id: str) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    response = client.post("/api/grading/session", json={"player_id": player_id})
    assert response.status_code == 204, response.text
    return client


def anonymous(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def get_game(client: httpx.Client, game_id: str) -> dict:
    response = client.get(f"/api/games/{game_id}")
    assert response.status_code == 200, response.text
    return response.json()


def ops_of(client: httpx.Client, game_id: str) -> list[dict]:
    response = client.get(f"/api/games/{game_id}/ops")
    assert response.status_code == 200, response.text
    return response.json()["ops"]


def sq_of(game: dict, row: int, col: int) -> dict:
    return next(s for s in game["squares"] if s["row"] == row and s["col"] == col)


def colour_of(game: dict, player_id: str) -> str:
    return next(p["colour"] for p in game["players"] if p["id"] == player_id)


def write(client: httpx.Client, game_id: str, row: int, col: int, value: str, pencil: bool = False,
          op: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"type": "cell", "row": row, "col": col, "value": value, "pencil": pencil}
    if op is not None:
        body["client_op_id"] = op
    return client.post(f"/api/games/{game_id}/ops", json=body)


def act(client: httpx.Client, game_id: str, kind: str, scope: str, row: int | None = None, col: int | None = None,
        direction: str | None = None) -> httpx.Response:
    body = {"type": kind, "scope": scope, "row": row, "col": col, "direction": direction}
    return client.post(f"/api/games/{game_id}/ops", json=body)


def media(value: str) -> str:
    return value.replace(" ", "").lower()


def assert_error(response: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert response.status_code == status, f"expected {status} {code}, got {response.status_code}: {response.text}"
    assert media(response.headers.get("content-type", "")) == media(CONTENT_JSON)
    body = response.json()
    assert body.get("error") == code, body
    assert isinstance(body.get("message"), str) and body["message"], body
    if message is not None:
        assert body["message"] == message, body
    return body


def fmt(ms: int) -> str:
    seconds = ms // 1000
    if seconds < HOUR_S:
        return f"{seconds // 60}:{seconds % 60:02d}"
    return f"{seconds // HOUR_S}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"


def seconds_of(text: str) -> int:
    total = 0
    for part in text.strip().split(":"):
        total = total * 60 + int(part)
    return total


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def segment_sum(segments: list[dict]) -> int:
    return sum(round((iso(s["ended_at"]) - iso(s["started_at"])).total_seconds() * 1000) for s in segments)


def words(rows: list) -> tuple[dict, dict]:
    def white(r: int, c: int) -> bool:
        return 0 <= r < len(rows) and 0 <= c < len(rows[0]) and rows[r][c] != "#"

    numbers: dict = {}
    found: dict = {"across": {}, "down": {}}
    n = 0
    for r in range(len(rows)):
        for c in range(len(rows[0])):
            if not white(r, c):
                continue
            across = not white(r, c - 1) and white(r, c + 1)
            down = not white(r - 1, c) and white(r + 1, c)
            if across or down:
                n += 1
                numbers[(r, c)] = n
            if across:
                found["across"][n] = [(r, k) for k in range(c, len(rows[0])) if all(white(r, j) for j in range(c, k + 1))]
            if down:
                found["down"][n] = [(k, c) for k in range(r, len(rows)) if all(white(j, c) for j in range(r, k + 1))]
    return numbers, found


def cell_name(rows: list, r: int, c: int, direction: str, content: str, marks: str = "") -> str:
    other = "down" if direction == "across" else "across"
    for d in (direction, other):
        for number, cells in words(rows)[1][d].items():
            if (r, c) in cells:
                return f"{number} {d.title()}, letter {cells.index((r, c)) + 1} of {len(cells)}, {content}{marks}"
    raise AssertionError(f"square {r},{c} has no word")


def mk(r: int, c: int, direction: str, content: str, marks: str = "") -> str:
    return cell_name(MK_ROWS, r, c, direction, content, marks)


def ns(r: int, c: int, direction: str, content: str, marks: str = "") -> str:
    return cell_name(NS_ROWS, r, c, direction, content, marks)


def mk_clue(number: int, direction: str) -> str:
    return (MK_ACROSS if direction == "across" else MK_DOWN)[number]


def bar_text(number: int, direction: str) -> str:
    return f"{number}{direction[0].upper()} {mk_clue(number, direction)}"


def spoken(number: int, direction: str) -> str:
    length = len(words(MK_ROWS)[1][direction][number])
    return f"{number} {direction.title()}: {mk_clue(number, direction)}. {length} letters."


def wrong_in(n: int, scope: str) -> str:
    return f"{n} wrong in this {scope}"


def no_errors(scope: str) -> str:
    return f"No errors in this {scope}"


def revealed_phrase(n: int) -> str:
    return "Revealed 1 square" if n == 1 else f"Revealed {n} squares"


def problems(n: int) -> str:
    return "This puzzle has 1 problem." if n == 1 else f"This puzzle has {n} problems."


def line(n: int, message: str) -> str:
    return f"Line {n}: {message}"


def expected_line(key: str) -> str:
    return f"expected the {key}: line"


def mk_text(title: str) -> str:
    return MK_TEXT.replace("Title: Morning Kettle", f"Title: {title}")


def fresh_title() -> str:
    return f"Kettle {uuid.uuid4().hex[:8]}"


def run_manifest() -> dict:
    deployed = Path(DEPLOYED_APP) / "run.json"
    return json.loads((deployed if deployed.exists() else Path("/app") / "run.json").read_text())


@contextlib.contextmanager
def as_player(browser: Browser, base: str, player_id: str | None, path: str, viewport: dict = DESK,
              reduced: str = "no-preference", before: Callable[[Page], None] | None = None) -> Iterator[Page]:
    with opened(browser, base + "/api/health", reduced_motion=reduced) as page:
        page.set_viewport_size(viewport)
        if player_id is not None:
            response = page.request.post(base + "/api/grading/session", data={"player_id": player_id})
            assert response.status == 204, response.text()
        if before is not None:
            before(page)
        page.goto(base + path)
        yield page
        threading.Event().wait(SETTLE_S)


def grid_of(page: Page) -> Locator:
    return page.get_by_role("grid", name="Puzzle grid")


def ready(page: Page) -> Locator:
    grid = grid_of(page)
    expect(grid).to_be_visible(timeout=READY_MS)
    until(page, "() => document.activeElement && document.activeElement.getAttribute('role') === 'grid'")
    return grid


def square(page: Page, row: int, col: int) -> Locator:
    return grid_of(page).locator(f'[data-row="{row}"][data-col="{col}"]')


def at(page: Page, row: int, col: int) -> None:
    expect(square(page, row, col)).to_have_attribute("aria-selected", "true")


def clue_bar(page: Page) -> Locator:
    return page.get_by_role("region", name="Current clue")


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Grid announcements")


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Game notices")


def clue_item(page: Page, direction: str, number: int) -> Locator:
    heading = direction.title()
    return page.get_by_role("list", name=f"{heading} clues").get_by_role(
        "listitem", name=f"{number} {mk_clue(number, direction)}", exact=True)


def button(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def timer_of(page: Page) -> Locator:
    return page.get_by_role("timer", name="Solve time")


def menu_action(page: Page, menu: str, item: str) -> None:
    page.keyboard.press("Alt+KeyC" if menu == "Check" else "Alt+KeyR")
    opened_menu = page.get_by_role("menu", name=menu)
    expect(opened_menu).to_be_visible()
    expect(opened_menu.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
    for _ in range(["Square", "Word", "Puzzle"].index(item)):
        page.keyboard.press("ArrowDown")
    expect(opened_menu.get_by_role("menuitem", name=item, exact=True)).to_be_focused()
    page.keyboard.press("Enter")
    expect(grid_of(page)).to_be_focused()


def paced(page: Page, text: str) -> None:
    for letter in text:
        page.keyboard.press(letter)
        threading.Event().wait(KEY_PACE_S)


def player_id_of(page: Page, base: str) -> str:
    response = page.request.get(base + "/api/players/me")
    assert response.status == 200, response.text()
    return response.json()["id"]


WS_OPEN = """([path, key]) => new Promise((resolve) => {
  window.__live = window.__live || {};
  const rec = {messages: [], closed: null};
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + path);
  window.__live[key] = {ws, rec};
  ws.onmessage = (event) => rec.messages.push(JSON.parse(event.data));
  ws.onopen = () => resolve('open');
  ws.onclose = (event) => { rec.closed = event.code; resolve('closed'); };
})"""
WS_CLOSE = """(key) => new Promise((resolve) => {
  const live = window.__live[key];
  if (live.rec.closed !== null) { resolve(); return; }
  live.ws.onclose = (event) => { live.rec.closed = event.code; resolve(); };
  live.ws.close();
})"""


def live_open(page: Page, game_id: str, key: str) -> str:
    return page.evaluate(WS_OPEN, [f"/api/games/{game_id}/live", key])


def live_close(page: Page, key: str) -> None:
    page.evaluate(WS_CLOSE, key)


def live_rec(page: Page, key: str) -> dict:
    return page.evaluate("(key) => window.__live[key].rec", key)


def raw_upgrade(base: str, path: str, origin: str | None = None, cookie: str | None = None) -> int:
    parts = urlsplit(base)
    lines = [f"GET {path} HTTP/1.1", f"Host: {parts.netloc}", "Upgrade: websocket", "Connection: Upgrade",
             "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13"]
    lines.append(f"Origin: {origin or parts.scheme + '://' + parts.netloc}")
    if cookie:
        lines.append(f"Cookie: overlap_player={cookie}")
    with socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT) as sock:
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = sock.recv(4096).split(b"\r\n", 1)[0].decode()
    return int(head.split()[1])


def raw_get(base: str, path: str) -> int:
    parts = urlsplit(base)
    request = f"GET {path} HTTP/1.1\r\nHost: {parts.netloc}\r\nConnection: close\r\n\r\n"
    with socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT) as sock:
        sock.sendall(request.encode())
        head = sock.recv(4096).split(b"\r\n", 1)[0].decode()
    return int(head.split()[1])


class Relay:

    def __init__(self, target: tuple[str, int]):
        self.target = target
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.listener: socket.socket | None = None
        self.links: list[socket.socket] = []

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._serve, args=(listener,), daemon=True).start()

    def _serve(self, listener: socket.socket) -> None:
        for _ in range(RELAY_MAX_ACCEPTS):
            try:
                inbound, _ = listener.accept()
            except OSError:
                return
            try:
                outbound = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                inbound.close()
                continue
            self.links += [inbound, outbound]
            for src, dst in ((inbound, outbound), (outbound, inbound)):
                threading.Thread(target=self._pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CHUNKS):
            try:
                data = src.recv(RELAY_CHUNK)
            except OSError:
                break
            if not data:
                break
            try:
                dst.sendall(data)
            except OSError:
                break
        for sock in (src, dst):
            with contextlib.suppress(OSError):
                sock.shutdown(socket.SHUT_RDWR)

    def stop(self) -> None:
        if self.listener is not None:
            with contextlib.suppress(OSError):
                self.listener.shutdown(socket.SHUT_RDWR)
            self.listener.close()
            self.listener = None
        for sock in self.links:
            with contextlib.suppress(OSError):
                sock.shutdown(socket.SHUT_RDWR)
            sock.close()
        self.links = []


@contextlib.contextmanager
def app_copy(overrides: dict[str, str], drop: tuple = ()) -> Iterator[tuple[str, Callable[[], str]]]:
    manifest = run_manifest()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k not in drop and k != "APP_PUBLIC_URL"}
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-4000:].decode(errors="replace")

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        up = False
        while time.monotonic() < deadline and not up:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}; log tail:\n{tail()}")
            with contextlib.suppress(httpx.HTTPError):
                up = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200
            if not up:
                threading.Event().wait(POLL_S)
        if not up:
            pytest.fail(f"app copy never answered GET /api/health with 200; log tail:\n{tail()}")
        yield base, tail
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def test_grid_semantics(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "S"), seed_sq(0, 1, "C", state="pencil", pencil=True),
                                    seed_sq(2, 0, "X", state="wrong"), seed_sq(2, 2, "E", state="right"),
                                    seed_sq(4, 0, "M", state="revealed")])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        expect(grid.get_by_role("row")).to_have_count(len(MK_ROWS))
        expect(grid.get_by_role("gridcell")).to_have_count(MK_WHITE + MK_BLACK)
        expect(grid.get_by_role("gridcell", name="Black square", exact=True)).to_have_count(MK_BLACK)
        expect(grid).to_have_attribute("data-direction", "across")
        expect(grid).to_have_attribute("data-pivot", "idle")
        expected = {
            (0, 0): (mk(0, 0, "across", "S"), "filled"),
            (0, 1): (mk(0, 1, "across", "C", PENCIL_MARK), "pencil"),
            (0, 3): (mk(0, 3, "across", EMPTY), "empty"),
            (2, 0): (mk(2, 0, "across", "X", WRONG_MARK), "wrong"),
            (2, 2): (mk(2, 2, "across", "E", RIGHT_MARK), "right"),
            (4, 0): (mk(4, 0, "across", "M", REVEALED_MARK), "revealed"),
            (1, 0): (mk(1, 0, "across", EMPTY), "empty"),
        }
        for (r, c), (name, state) in expected.items():
            expect(square(page, r, c)).to_have_accessible_name(name)
            expect(square(page, r, c)).to_have_attribute("data-state", state)
        for r, c in [(0, 0), (0, 1), (2, 0), (2, 2), (4, 0)]:
            expect(square(page, r, c)).to_have_attribute("data-owner", "Teal")
        expect(square(page, 0, 3)).not_to_have_attribute("data-owner", re.compile(".*"))
        for (r, c), n in words(MK_ROWS)[0].items():
            expect(square(page, r, c)).to_have_attribute("data-number", str(n))
        expect(square(page, 0, 1)).not_to_have_attribute("data-number", re.compile(".*"))
        for c in range(5):
            expect(square(page, 0, c)).to_have_attribute("data-in-word", "true")
        expect(square(page, 2, 0)).not_to_have_attribute("data-in-word", "true")
        expect(grid.get_by_role("gridcell", selected=True)).to_have_count(1)
        at(page, 0, 2)
        selected_id = square(page, 0, 2).get_attribute("id")
        assert selected_id, "the selected square needs an id for aria-activedescendant"
        expect(grid).to_have_attribute("aria-activedescendant", selected_id)
        page.keyboard.press("Space")
        expect(grid).to_have_attribute("data-direction", "down")
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "down", "S"))
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "down", "C", PENCIL_MARK))
        expect(square(page, 2, 2)).to_have_accessible_name(mk(2, 2, "down", "E", RIGHT_MARK))


def test_letter_auto_advance(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 2, "O"), seed_sq(0, 3, "N"), seed_sq(0, 4, "E"), seed_sq(2, 1, "J")])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 0)
        page.keyboard.press("ArrowRight")
        at(page, 0, 1)
        page.keyboard.press("c")
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C"))
        at(page, 0, 0)
        page.keyboard.press("s")
        at(page, 0, 1)
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        at(page, 0, 4)
        page.keyboard.press("e")
        at(page, 0, 4)
        click(square(page, 2, 0))
        expect(grid_of(page)).to_be_focused()
        at(page, 2, 0)
        page.keyboard.press("e")
        at(page, 2, 2)
        expect(square(page, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "E"))
    client = player_client(app_url, s.ids["a"])
    game = get_game(client, s.game_id)
    for (r, c), value in {(0, 0): "S", (0, 1): "C", (2, 0): "E"}.items():
        stored = sq_of(game, r, c)
        assert (stored["value"], stored["pencil"], stored["state"], stored["owner"]) == (value, False, "filled", "Teal")


def test_movement_and_deletion_keys(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 3, "N", state="revealed")])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        press = page.keyboard.press
        at(page, 0, 0)
        press("ArrowDown")
        expect(grid).to_have_attribute("data-direction", "down")
        at(page, 0, 0)
        press("ArrowDown")
        at(page, 1, 0)
        press("ArrowDown")
        at(page, 2, 0)
        press("ArrowRight")
        expect(grid).to_have_attribute("data-direction", "across")
        at(page, 2, 0)
        press("ArrowRight")
        at(page, 2, 1)
        press("ArrowUp")
        at(page, 0, 1)
        expect(grid).to_have_attribute("data-direction", "across")
        press("Space")
        expect(grid).to_have_attribute("data-direction", "across")
        press("ArrowLeft")
        at(page, 0, 0)
        press("ArrowLeft")
        at(page, 0, 0)
        press("Enter")
        expect(grid).to_have_attribute("data-direction", "down")
        press("ArrowUp")
        at(page, 0, 0)
        press("Space")
        expect(grid).to_have_attribute("data-direction", "across")
        for key in "sco":
            press(key)
        at(page, 0, 4)
        press("Backspace")
        at(page, 0, 3)
        press("Backspace")
        press("Delete")
        at(page, 0, 3)
        expect(square(page, 0, 3)).to_have_accessible_name(mk(0, 3, "across", "N", REVEALED_MARK))
        expect(notices(page)).to_have_text("")
        press("ArrowLeft")
        press("Backspace")
        at(page, 0, 2)
        expect(square(page, 0, 2)).to_have_accessible_name(mk(0, 2, "across", EMPTY))
        press("Backspace")
        at(page, 0, 1)
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", EMPTY))
        press("ArrowLeft")
        press("Delete")
        at(page, 0, 0)
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", EMPTY))
        press("Backspace")
        at(page, 0, 0)
    client = player_client(app_url, s.ids["a"])
    game = get_game(client, s.game_id)
    assert [sq_of(game, 0, c)["value"] for c in range(3)] == ["", "", ""]
    assert (sq_of(game, 0, 3)["value"], sq_of(game, 0, 3)["state"]) == ("N", "revealed")
    assert not [op for op in ops_of(client, s.game_id) if op["type"] == "cell" and (op["row"], op["col"]) == (0, 3)]


def test_wf_keyboard_solving_fill_and_reload(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    token = marker()
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        page.evaluate("(t) => { window.__overlapMarker = t; }", token)
        url = page.url
        for index, word in enumerate(("scone", "eject", "miser")):
            if index:
                page.keyboard.press("Tab")
            paced(page, word)
        expect(grid_of(page)).to_have_attribute("data-direction", "across")
        for r in (0, 2, 4):
            for c in range(5):
                expect(square(page, r, c)).to_have_accessible_name(mk(r, c, "across", MK_ROWS[r][c]))
                expect(square(page, r, c)).to_have_attribute("data-state", "filled")
        assert page.url == url and page.evaluate("() => window.__overlapMarker") == token
        client = player_client(app_url, s.ids["a"])
        poll(lambda: all("".join(sq_of(get_game(client, s.game_id), r, c)["value"] for c in range(5)) == MK_ROWS[r] for r in (0, 2, 4)),
             SERVER_WAIT_S, "the typed words were stored")
        page.reload()
        grid = ready(page)
        expect(grid).to_have_attribute("data-direction", "down")
        for r in (0, 2, 4):
            for c in range(5):
                expect(square(page, r, c)).to_have_accessible_name(mk(r, c, "down", MK_ROWS[r][c]))
                expect(square(page, r, c)).to_have_attribute("data-owner", "Teal")
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    for r in (0, 2, 4):
        assert "".join(sq_of(game, r, c)["value"] for c in range(5)) == MK_ROWS[r]


def test_wf_keyboard_solving_start_rule(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(r, c, MK_ROWS[r][c]) for r in (0, 2, 4) for c in range(5)])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        at(page, 1, 0)
        expect(grid).to_have_attribute("data-direction", "down")
        expect(clue_bar(page)).to_have_text(bar_text(1, "down"), use_inner_text=True)
        expect(announcements(page)).to_have_text(spoken(1, "down"))
        page.keyboard.press("t")
        at(page, 3, 0)
        page.keyboard.press("a")
        at(page, 4, 0)
        page.reload()
        grid = ready(page)
        at(page, 1, 2)
        expect(grid).to_have_attribute("data-direction", "down")
        expect(clue_bar(page)).to_have_text(bar_text(2, "down"), use_inner_text=True)
        expect(square(page, 1, 0)).to_have_accessible_name(mk(1, 0, "down", "T"))
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert (sq_of(game, 1, 0)["value"], sq_of(game, 3, 0)["value"]) == ("T", "A")


def test_tab_between_clues(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(2, 0, "E"), seed_sq(0, 4, "E")] + [seed_sq(4, c, MK_ROWS[4][c]) for c in range(5)])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        at(page, 0, 0)
        steps = [("Tab", (2, 1), "across"), ("Tab", (4, 0), "across"), ("Tab", (0, 0), "down"),
                 ("Tab", (0, 2), "down"), ("Tab", (1, 4), "down"), ("Tab", (0, 0), "across"),
                 ("Shift+Tab", (1, 4), "down"), ("Shift+Tab", (0, 2), "down")]
        for key, (r, c), direction in steps:
            page.keyboard.press(key)
            at(page, r, c)
            expect(grid).to_have_attribute("data-direction", direction)
            expect(grid).to_be_focused()


def test_clue_lists_and_bar(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        for n in MK_ACROSS:
            expect(clue_item(page, "across", n)).to_have_count(1)
        for n in MK_DOWN:
            expect(clue_item(page, "down", n)).to_have_count(1)
        lists = page.get_by_role("list", name=re.compile("^(Across|Down) clues$"))
        current = lists.get_by_role("listitem").and_(page.locator('[aria-current="true"]'))
        crossing = lists.get_by_role("listitem").and_(page.locator('[data-crossing="true"]'))
        expect(clue_item(page, "across", 1)).to_have_attribute("aria-current", "true")
        expect(clue_item(page, "down", 1)).to_have_attribute("data-crossing", "true")
        expect(current).to_have_count(1)
        expect(crossing).to_have_count(1)
        expect(clue_bar(page)).to_have_text("1A Crumbly bake served with jam", use_inner_text=True)
        page.keyboard.press("ArrowRight")
        expect(crossing).to_have_count(0)
        page.keyboard.press("ArrowRight")
        expect(clue_item(page, "down", 2)).to_have_attribute("data-crossing", "true")
        page.keyboard.press("Space")
        expect(clue_item(page, "down", 2)).to_have_attribute("aria-current", "true")
        expect(clue_item(page, "across", 1)).to_have_attribute("data-crossing", "true")
        expect(clue_bar(page)).to_have_text(bar_text(2, "down"), use_inner_text=True)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        expect(clue_item(page, "across", 4)).to_have_attribute("data-crossing", "true")
        expect(current).to_have_count(1)
        expect(crossing).to_have_count(1)


@pytest.mark.parametrize("board", ["desk", "tablet"], ids=["desk", "tablet"])
def test_room_boards(browser: Browser, app_url: str, board: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=DESK if board == "desk" else TABLET) as page:
        grid = ready(page)
        layout(page)
        bar = clue_bar(page).bounding_box()
        g = grid.bounding_box()
        across = page.get_by_role("list", name="Across clues").bounding_box()
        down = page.get_by_role("list", name="Down clues").bounding_box()
        players = page.get_by_role("list", name="Players").bounding_box()
        assert bar and g and across and down and players
        assert bar["y"] + bar["height"] <= g["y"] + PX_TOLERANCE
        assert abs(across["y"] - down["y"]) <= PX_TOLERANCE
        assert down["x"] >= across["x"] + across["width"] - PX_TOLERANCE
        if board == "desk":
            assert across["x"] >= g["x"] + g["width"] - PX_TOLERANCE
            assert across["y"] < g["y"] + g["height"]
            assert players["y"] >= max(g["y"] + g["height"], across["y"] + across["height"]) - PX_TOLERANCE
        else:
            assert across["y"] >= g["y"] + g["height"] - PX_TOLERANCE
            assert g["width"] > across["width"] * 1.5, "the grid tile is full width, wider than one 6-column clue tile"
            assert players["y"] >= across["y"] + across["height"] - PX_TOLERANCE
        for name in ("Pause my timer", "Pencil", "Rebus", "Check", "Reveal", "Share"):
            expect(button(page, name)).to_have_count(1)
        expect(button(page, "Previous clue")).to_have_count(0)
        expect(button(page, "Next clue")).to_have_count(0)


def _clue_journey(page: Page, base: str, s: Seeded) -> None:
    grid = ready(page)
    expect(announcements(page)).to_have_text(spoken(1, "across"))
    for n, direction in [(4, "across"), (5, "across"), (1, "down")]:
        page.keyboard.press("Tab")
        expect(clue_item(page, direction, n)).to_have_attribute("aria-current", "true")
        expect(clue_bar(page)).to_have_text(bar_text(n, direction), use_inner_text=True)
        expect(announcements(page)).to_have_text(spoken(n, direction))
    expect(clue_item(page, "across", 1)).to_have_attribute("data-crossing", "true")
    click(clue_item(page, "down", 3))
    at(page, 0, 4)
    expect(grid).to_have_attribute("data-direction", "down")
    expect(clue_bar(page)).to_have_text(bar_text(3, "down"), use_inner_text=True)
    expect(announcements(page)).to_have_text(spoken(3, "down"))
    expect(clue_item(page, "across", 1)).to_have_attribute("data-crossing", "true")
    click(square(page, 1, 4))
    at(page, 1, 4)
    page.keyboard.press("n")
    at(page, 2, 4)
    page.keyboard.press("Escape")
    expect(button(page, "Pause my timer")).to_be_focused()
    game = get_game(player_client(base, s.ids["a"]), s.game_id)
    assert sq_of(game, 1, 4)["value"] == "N"


def test_wf_clue_navigation_tab_click_escape(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        _clue_journey(page, app_url, s)


def test_wf_clue_navigation_tablet(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=TABLET) as page:
        _clue_journey(page, app_url, s)
        layout(page)
        g = grid_of(page).bounding_box()
        across = page.get_by_role("list", name="Across clues").bounding_box()
        assert g and across and across["y"] >= g["y"] + g["height"] - PX_TOLERANCE


def test_phone_room_board(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        ready(page)
        layout(page)
        keyboard = page.get_by_role("group", name="Letter keyboard")
        boxes = [clue_bar(page).bounding_box(), grid_of(page).bounding_box(), keyboard.bounding_box(),
                 button(page, "Check").bounding_box(), page.get_by_role("list", name="Players").bounding_box()]
        assert all(boxes)
        tops = [b["y"] for b in boxes]
        assert tops == sorted(tops), f"phone order clue bar, grid, keyboard, tools, players; tops {tops}"
        expect(button(clue_bar(page), "Previous clue")).to_be_visible()
        expect(button(clue_bar(page), "Next clue")).to_be_visible()
        for letter in "AZ":
            expect(button(keyboard, letter)).to_be_visible()
        for name in ("Pencil", "Rebus"):
            expect(button(page, name)).to_have_count(1)
            expect(button(keyboard, name)).to_have_count(1)
        for name in ("Across clues", "Down clues"):
            lst = page.get_by_role("list", name=name, include_hidden=True)
            expect(lst).to_have_count(1)
            assert lst.evaluate("el => !el.checkVisibility({visibilityProperty: true, opacityProperty: true}) || !!el.closest('[inert]')")
            assert lst.evaluate("el => !el.checkVisibility() || !!el.closest('[inert]')")


def test_letter_keyboard_touch(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        grid = ready(page)
        keyboard = page.get_by_role("group", name="Letter keyboard")
        tap(square(page, 0, 2))
        at(page, 0, 2)
        expect(grid).to_have_attribute("data-direction", "across")
        tap(square(page, 0, 2))
        expect(grid).to_have_attribute("data-direction", "down")
        tap(button(keyboard, "O"))
        expect(square(page, 0, 2)).to_have_accessible_name(mk(0, 2, "down", "O"))
        at(page, 1, 2)
        tap(button(keyboard, "Switch direction"))
        expect(grid).to_have_attribute("data-direction", "down")
        tap(button(keyboard, "Backspace"))
        at(page, 0, 2)
        expect(square(page, 0, 2)).to_have_accessible_name(mk(0, 2, "down", EMPTY))
        tap(button(keyboard, "Switch direction"))
        expect(grid).to_have_attribute("data-direction", "across")
        expect(page.get_by_role("textbox")).to_have_count(0)
        assert page.evaluate("() => !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable")
    client = player_client(app_url, s.ids["a"])
    assert [op["value"] for op in ops_of(client, s.game_id) if op["type"] == "cell" and (op["row"], op["col"]) == (0, 2)][:1] == ["O"]
    assert sq_of(get_game(client, s.game_id), 0, 2)["value"] == ""


def test_wf_phone_solving_letters(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, outsiders=("c",))
    with as_player(browser, app_url, s.ids["a"], s.room) as host, \
            as_player(browser, app_url, s.ids["c"], f"/g/{s.code}", viewport=PHONE, reduced="reduce") as friend:
        ready(host)
        grid = ready(friend)
        keyboard = friend.get_by_role("group", name="Letter keyboard")
        tap(square(friend, 2, 0))
        at(friend, 2, 0)
        for letter in MK_ROWS[2]:
            tap(button(keyboard, letter))
        tap(square(friend, 0, 0))
        tap(square(friend, 0, 0))
        expect(grid).to_have_attribute("data-direction", "down")
        expect(grid).to_have_attribute("data-pivot", "idle")
        assert animations(grid) == []
        for c, letter in enumerate(MK_ROWS[2]):
            expect(square(host, 2, c)).to_have_accessible_name(mk(2, c, "across", letter), timeout=LIVE_MS)
            expect(square(host, 2, c)).to_have_attribute("data-owner", "Coral")
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert colour_of(game, s.ids["c"]) == "Coral"
    assert [(sq_of(game, 2, c)["value"], sq_of(game, 2, c)["owner"]) for c in range(5)] == [(ch, "Coral") for ch in MK_ROWS[2]]


def test_wf_phone_solving_clue_buttons(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, outsiders=("c",))
    with as_player(browser, app_url, s.ids["c"], f"/g/{s.code}", viewport=PHONE, reduced="reduce") as page:
        ready(page)
        layout(page)
        bar = clue_bar(page)
        tap(button(bar, "Next clue"))
        expect(bar).to_have_text(bar_text(4, "across"), use_inner_text=True)
        at(page, 2, 0)
        tap(button(bar, "Previous clue"))
        tap(button(bar, "Previous clue"))
        expect(bar).to_have_text(bar_text(3, "down"), use_inner_text=True)
        at(page, 0, 4)
        tap(button(page.get_by_role("group", name="Letter keyboard"), "E"))
        at(page, 1, 4)
        layout(page)
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert (sq_of(game, 0, 4)["value"], sq_of(game, 0, 4)["owner"]) == ("E", "Coral")


def test_wf_phone_solving_rebus_key(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS, outsiders=("c",))
    draft = "STAR" + "K"
    with as_player(browser, app_url, s.ids["c"], f"/g/{s.code}", viewport=PHONE, reduced="reduce") as page:
        ready(page)
        keyboard = page.get_by_role("group", name="Letter keyboard")
        tap(button(keyboard, "Rebus"))
        editor = page.get_by_role("textbox", name="Rebus entry")
        expect(editor).to_be_visible()
        for letter in draft:
            tap(button(keyboard, letter))
        expect(editor).to_have_value(draft)
        tap(button(keyboard, "Backspace"))
        expect(editor).to_have_value("STAR")
        tap(button(keyboard, "Rebus"))
        expect(editor).to_have_count(0)
        expect(square(page, 0, 0)).to_have_accessible_name("1 Across, letter 1 of 5, STAR")
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert sq_of(game, 0, 0)["value"] == "STAR"


@pytest.mark.parametrize("case", list(NAME_CASES), ids=list(NAME_CASES))
def test_guest_players(app_url: str, case: str) -> None:
    names = {"one_char": "A", "max_length": "Ada" + "x" * (NAME_MAX - 3), "trimmed": "  Ada  ",
             "emoji_max": FAMILY * NAME_MAX, "too_long": "Ada" + "x" * (NAME_MAX - 2), "blank": "   ",
             "control": "Ada\u0007", "emoji_too_long": FAMILY * (NAME_MAX + 1)}
    client = anonymous(app_url)
    response = client.post("/api/players", json={"display_name": names[case]})
    cookies = [h for h in response.headers.get_list("set-cookie") if h.startswith("overlap_player=")]
    if NAME_CASES[case] == 422:
        body = assert_error(response, 422, "invalid")
        assert isinstance(body.get("fields", {}).get("display_name"), str)
        assert cookies == []
        return
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["display_name"] == names[case].strip()
    assert len(cookies) == 1
    attributes = {part.strip().lower() for part in cookies[0].split(";")}
    required = {part.strip().lower() for part in COOKIE_ATTRS.split(";")}
    assert required <= attributes, cookies[0]
    me = client.get("/api/players/me")
    assert me.status_code == 200 and me.json() == {"id": body["id"], "display_name": body["display_name"]}


def test_share_dialog(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        ready(page)
        click(button(page, "Share"))
        dialog = page.get_by_role("dialog", name="Share game")
        expect(dialog).to_be_visible()
        link = dialog.get_by_role("textbox", name="Game link")
        expect(link).not_to_be_editable()
        value = link.input_value()
        assert value.endswith(f"/g/{s.code}"), value
        click(button(dialog, "Copy link"))
        expect(dialog.get_by_role("status", name="Share status")).to_have_text("Link copied")
        assert page.evaluate("() => navigator.clipboard.readText()") == value


def test_join_by_link(app_url: str) -> None:
    s = seed_game(app_url, outsiders=("b", "c"))
    host = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    c = player_client(app_url, s.ids["c"])
    assert_error(anonymous(app_url).get(f"/api/links/{s.code}"), 401, "no_player")
    info = b.get(f"/api/links/{s.code}")
    assert info.status_code == 200
    assert info.json()["game_id"] == s.game_id and info.json()["puzzle_title"] == "Morning Kettle"
    assert info.json()["player_count"] == 1
    joined = b.post(f"/api/links/{s.code}/join", json={})
    assert joined.status_code == 200 and colour_of(joined.json(), s.ids["b"]) == "Coral"
    assert colour_of(c.post(f"/api/links/{s.code}/join", json={}).json(), s.ids["c"]) == "Violet"
    again = b.post(f"/api/links/{s.code}/join", json={})
    assert again.status_code == 200 and colour_of(again.json(), s.ids["b"]) == "Coral"
    assert len(again.json()["players"]) == 3
    assert get_game(host, s.game_id)["players"][0]["colour"] == "Teal"
    assert_error(b.get(f"/api/links/{UNKNOWN_CODE}"), 404, "not_found")

    solved = seed_game(app_url, outsiders=("c",), squares=mk_fill(skip=((0, 0),)))
    solver = player_client(app_url, solved.ids["a"])
    assert write(solver, solved.game_id, 0, 0, "S").status_code == 200
    late = player_client(app_url, solved.ids["c"])
    assert_error(late.post(f"/api/links/{solved.code}/join", json={}), 409, "game_solved", "This puzzle is already solved.")

    short = short_url()
    cap = config(short)["max_players"]
    members = tuple(f"m{i}" for i in range(cap))
    full = seed_game(short, members=members, outsiders=("x",))
    outsider = player_client(short, full.ids["x"])
    assert_error(outsider.post(f"/api/links/{full.code}/join", json={}), 409, "game_full", "Game is full.")
    member = player_client(short, full.ids[members[-1]])
    assert member.post(f"/api/links/{full.code}/join", json={}).status_code == 200
    assert len(get_game(member, full.game_id)["players"]) == cap


def test_link_off_and_replace(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",))
    host = player_client(app_url, s.ids["a"])
    friend = player_client(app_url, s.ids["b"])
    other = player_client(app_url, s.ids["c"])
    assert friend.post(f"/api/links/{s.code}/join", json={}).status_code == 200
    assert_error(friend.post(f"/api/games/{s.game_id}/link/off", json={}), 403, "not_host")
    assert_error(friend.post(f"/api/games/{s.game_id}/link/replace", json={}), 403, "not_host")
    with as_player(browser, app_url, s.ids["b"], "/api/health") as page:
        assert live_open(page, s.game_id, "friend") == "open"
        off = host.post(f"/api/games/{s.game_id}/link/off", json={})
        assert off.status_code == 200 and off.json()["link_state"] == "off"
        until(page, "(k) => window.__live[k].rec.closed !== null", "friend")
        rec = live_rec(page, "friend")
        assert rec["closed"] == LINK_OFF_CLOSE
        assert {"type": "link_off", "reason": "off", "message": "This game link was turned off."} in [
            {k: m.get(k) for k in ("type", "reason", "message")} for m in rec["messages"]]
    assert_error(other.get(f"/api/links/{s.code}"), 410, "link_off", "This game link was turned off.")
    assert_error(other.post(f"/api/links/{s.code}/join", json={}), 410, "link_off")
    assert_error(friend.get(f"/api/games/{s.game_id}"), 404, "not_found")
    assert_error(write(friend, s.game_id, 0, 0, "S"), 404, "not_found")
    assert raw_upgrade(app_url, f"/api/games/{s.game_id}/live", cookie=friend.cookies.get("overlap_player")) == 404
    assert get_game(host, s.game_id)["link_state"] == "off"
    assert_error(host.post(f"/api/games/{s.game_id}/link/off", json={}), 409, "link_already_off")
    back = host.post(f"/api/games/{s.game_id}/link/replace", json={})
    assert back.status_code == 200 and back.json()["link_state"] == "active" and back.json()["code"] != s.code

    r = seed_game(app_url, members=("a", "b"), outsiders=("c",))
    rhost = player_client(app_url, r.ids["a"])
    rfriend = player_client(app_url, r.ids["b"])
    rother = player_client(app_url, r.ids["c"])
    assert rfriend.post(f"/api/links/{r.code}/join", json={}).status_code == 200
    replaced = rhost.post(f"/api/games/{r.game_id}/link/replace", json={})
    assert replaced.status_code == 200
    new_code = replaced.json()["code"]
    assert re.fullmatch(r"[a-z0-9]{12}", new_code) and new_code != r.code
    assert_error(rother.get(f"/api/links/{r.code}"), 410, "link_replaced", "This game link was replaced. Ask the host for the new one.")
    assert_error(rother.post(f"/api/links/{r.code}/join", json={}), 410, "link_replaced")
    assert_error(rfriend.get(f"/api/games/{r.game_id}"), 404, "not_found")
    rejoin = rfriend.post(f"/api/links/{new_code}/join", json={})
    assert rejoin.status_code == 200 and colour_of(rejoin.json(), r.ids["b"]) == "Coral"
    assert colour_of(rother.post(f"/api/links/{new_code}/join", json={}).json(), r.ids["c"]) == "Violet"


def test_live_shared_play(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    host_client = player_client(app_url, s.ids["a"])
    token = marker()
    with as_player(browser, app_url, s.ids["b"], s.room) as friend, as_player(browser, app_url, s.ids["a"], s.room) as host:
        ready(friend)
        ready(host)
        at(friend, 0, 0)
        friend.evaluate("(t) => { window.__overlapMarker = t; }", token)
        host.keyboard.press("s")
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"), timeout=LIVE_MS)
        expect(square(friend, 0, 0)).to_have_attribute("data-owner", "Teal", timeout=LIVE_MS)
        expect(square(friend, 0, 1)).to_have_attribute("data-cursor", "Teal", timeout=LIVE_MS)
        host.keyboard.press(".")
        host.keyboard.press("x")
        expect(square(friend, 0, 1)).to_have_attribute("data-state", "pencil", timeout=LIVE_MS)
        expect(square(friend, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "X", PENCIL_MARK), timeout=LIVE_MS)
        assert act(host_client, s.game_id, "check", "square", 0, 1).status_code == 200
        expect(square(friend, 0, 1)).to_have_attribute("data-state", "wrong", timeout=LIVE_MS)
        expect(square(friend, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "X", PENCIL_MARK + WRONG_MARK), timeout=LIVE_MS)
        at(friend, 0, 0)
        expect(square(friend, 0, 0)).not_to_have_attribute("data-cursor", re.compile(".*"))
        assert friend.evaluate("() => window.__overlapMarker") == token


def _join_by_name(page: Page, name: str) -> None:
    dialog = page.get_by_role("dialog", name="Choose a display name")
    expect(dialog).to_be_visible(timeout=READY_MS)
    fill(dialog.get_by_role("textbox", name="Display name"), name)
    click(button(dialog, "Continue"))


def test_wf_shared_link_join_and_turn_off(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    friend_name = name_for("b")
    with as_player(browser, app_url, s.ids["a"], s.room) as host:
        host.context.grant_permissions(["clipboard-read", "clipboard-write"])
        ready(host)
        click(button(host, "Share"))
        share = host.get_by_role("dialog", name="Share game")
        click(button(share, "Copy link"))
        expect(share.get_by_role("status", name="Share status")).to_have_text("Link copied")
        link = host.evaluate("() => navigator.clipboard.readText()")
        click(button(share, "Close"))
        with as_player(browser, app_url, None, urlsplit(link).path) as friend:
            _join_by_name(friend, friend_name)
            ready(friend)
            expect(announcements(host)).to_have_text(f"{friend_name} joined", timeout=LIVE_MS)
            friend_id = player_id_of(friend, app_url)
            click(square(host, 0, 0))
            host.keyboard.press("s")
            expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"), timeout=LIVE_MS)
            friend.keyboard.press("ArrowRight")
            friend.keyboard.press("ArrowRight")
            friend.keyboard.press("o")
            expect(square(host, 0, 2)).to_have_accessible_name(mk(0, 2, "across", "O"), timeout=LIVE_MS)
            expect(square(host, 0, 2)).to_have_attribute("data-owner", "Coral", timeout=LIVE_MS)
            click(button(host, "Share"))
            click(button(share, "Turn off link"))
            expect(share.get_by_role("status", name="Share status")).to_have_text("Link turned off")
            expect(friend.get_by_role("alert")).to_have_text("This game link was turned off.", timeout=LIVE_MS)
            friend.keyboard.press("n")
            assert friend.request.get(app_url + f"/api/games/{s.game_id}").status == 404
    host_client = player_client(app_url, s.ids["a"])
    game = get_game(host_client, s.game_id)
    assert game["link_state"] == "off"
    assert colour_of(game, friend_id) == "Coral"
    assert sq_of(game, 0, 3)["value"] == ""
    assert_error(host_client.get(f"/api/links/{s.code}"), 410, "link_off")


def test_wf_shared_link_replace(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",))
    replaced_copy = "This game link was replaced. Ask the host for the new one."
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], f"/g/{s.code}") as friend:
        ready(host)
        ready(friend)
        click(button(host, "Share"))
        share = host.get_by_role("dialog", name="Share game")
        old_link = share.get_by_role("textbox", name="Game link").input_value()
        click(button(share, "Replace link"))
        expect(share.get_by_role("status", name="Share status")).to_have_text("New link ready")
        expect(share.get_by_role("textbox", name="Game link")).not_to_have_value(old_link)
        new_link = share.get_by_role("textbox", name="Game link").input_value()
        expect(friend.get_by_role("alert")).to_have_text(replaced_copy, timeout=LIVE_MS)
        with as_player(browser, app_url, s.ids["c"], urlsplit(new_link).path) as third:
            ready(third)
        with as_player(browser, app_url, s.ids["c"], urlsplit(old_link).path) as stale:
            expect(stale.get_by_role("alert")).to_have_text(replaced_copy, timeout=READY_MS)
    host_client = player_client(app_url, s.ids["a"])
    game = get_game(host_client, s.game_id)
    assert game["code"] == urlsplit(new_link).path.rsplit("/", 1)[-1] and game["code"] != s.code
    assert colour_of(game, s.ids["c"]) == "Violet"
    assert_error(host_client.get(f"/api/links/{s.code}"), 410, "link_replaced")


def test_wf_shared_link_game_full(browser: Browser) -> None:
    short = short_url()
    cap = config(short)["max_players"]
    members = tuple(f"m{i}" for i in range(cap))
    s = seed_game(short, members=members, outsiders=("x",))
    with as_player(browser, short, s.ids["x"], f"/g/{s.code}") as page:
        expect(page.get_by_text("Game is full.", exact=True)).to_be_visible(timeout=READY_MS)
    game = get_game(player_client(short, s.ids[members[0]]), s.game_id)
    assert len(game["players"]) == cap and s.ids["x"] not in [p["id"] for p in game["players"]]


def test_server_sequenced_writes(app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    first = together(lambda: write(a, s.game_id, 0, 0, "X"), lambda: write(b, s.game_id, 0, 0, "Y"))
    assert [r.status_code for r in first] == [200, 200]
    assert sorted(r.json()["seq"] for r in first) == [1, 2]
    winner = max(first, key=lambda r: r.json()["seq"]).json()
    game = get_game(a, s.game_id)
    assert (sq_of(game, 0, 0)["value"], sq_of(game, 0, 0)["owner"]) == (winner["value"], winner["owner"])
    entries = ("STAR", "OVENS")
    rebus = together(lambda: write(a, s.game_id, 0, 1, entries[0]), lambda: write(b, s.game_id, 0, 1, entries[1]))
    top = max(rebus, key=lambda r: r.json()["seq"]).json()
    assert sq_of(get_game(a, s.game_id), 0, 1)["value"] == top["value"] and top["value"] in entries
    clients = [a, b] * (RACE_WRITES // 2)
    letters = string.ascii_uppercase
    burst = together(*[(lambda cl=cl, i=i: write(cl, s.game_id, 2, 0, letters[i])) for i, cl in enumerate(clients)])
    assert all(r.status_code == 200 for r in burst)
    seqs = sorted(r.json()["seq"] for r in burst)
    assert seqs == list(range(5, 5 + RACE_WRITES))
    last = max(burst, key=lambda r: r.json()["seq"]).json()
    assert sq_of(get_game(b, s.game_id), 2, 0)["value"] == last["value"]
    assert [op["seq"] for op in ops_of(a, s.game_id)] == list(range(1, 5 + RACE_WRITES))
    assert get_game(a, s.game_id)["seq"] == 4 + RACE_WRITES


def test_locked_squares(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "S", state="right"), seed_sq(0, 1, "C", state="revealed")])
    a = player_client(app_url, s.ids["a"])
    assert_error(write(a, s.game_id, 0, 0, "X"), 409, "square_locked", "That square is locked.")
    assert_error(write(a, s.game_id, 0, 1, ""), 409, "square_locked")
    assert ops_of(a, s.game_id) == []
    toast = config(app_url)["toast_ms"]
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 2)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("x")
        expect(notices(page)).to_have_text("That square is locked.")
        at(page, 0, 2)
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C", REVEALED_MARK))
        advance(page, toast - 1)
        expect(notices(page)).to_have_text("That square is locked.")
        advance(page, 2)
        expect(notices(page)).to_have_text("")
    game = get_game(a, s.game_id)
    assert (sq_of(game, 0, 0)["value"], sq_of(game, 0, 0)["state"]) == ("S", "right")
    assert (sq_of(game, 0, 1)["value"], sq_of(game, 0, 1)["state"]) == ("C", "revealed")
    assert ops_of(a, s.game_id) == [] and game["seq"] == 0


def test_op_replay_keys(app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    key = uuid.uuid4().hex
    first = write(a, s.game_id, 0, 0, "S", op=key)
    assert first.status_code == 200 and first.json()["client_op_id"] == key
    again = write(a, s.game_id, 0, 0, "S", op=key)
    assert again.status_code == 200 and again.json() == first.json()
    assert len(ops_of(a, s.game_id)) == 1
    assert act(a, s.game_id, "check", "square", 0, 0).status_code == 200
    locked_replay = write(a, s.game_id, 0, 0, "S", op=key)
    assert locked_replay.status_code == 200 and locked_replay.json()["seq"] == first.json()["seq"]
    assert_error(write(a, s.game_id, 2, 0, "E", op=key), 409, "op_id_reused")
    assert len(ops_of(a, s.game_id)) == 2
    other = write(b, s.game_id, 2, 0, "E", op=key)
    assert other.status_code == 200 and other.json()["seq"] == 3


def test_rate_limit(browser: Browser) -> None:
    short = short_url()
    burst = 4 * config(short)["live_rate"]
    s = seed_game(short, members=("a", "b"))
    a = player_client(short, s.ids["a"])
    letters = string.ascii_uppercase
    responses = together(*[(lambda i=i: write(a, s.game_id, 2, 0, letters[i % len(letters)])) for i in range(burst)])
    accepted = [r for r in responses if r.status_code == 200]
    refused = [r for r in responses if r.status_code != 200]
    assert refused, f"{burst} writes at once were all accepted; expected 429 rate_limited beyond the live rate"
    for response in refused:
        assert_error(response, 429, "rate_limited", "Slow down a little.")
    assert [op["seq"] for op in ops_of(a, s.game_id)] == list(range(1, len(accepted) + 1))
    with as_player(browser, short, s.ids["b"], s.room) as page:
        ready(page)
        page.keyboard.type(string.ascii_lowercase)
        expect(notices(page)).to_have_text("Slow down a little.", timeout=READY_MS)


def test_wf_same_square_race(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        host.keyboard.press("x")
        friend.keyboard.press("y")
        writes = poll(lambda: (lambda o: o if len(o) == 2 else None)(
            [op for op in ops_of(a, s.game_id) if op["type"] == "cell" and (op["row"], op["col"]) == (0, 0)]),
            SERVER_WAIT_S, "both letters to 0,0 were sequenced")
        final = max(writes, key=lambda op: op["seq"])["value"]
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", final), timeout=LIVE_MS)
    assert sq_of(get_game(a, s.game_id), 0, 0)["value"] == final


def test_wf_same_square_revealed_refused(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        menu_action(host, "Reveal", "Square")
        expect(announcements(host)).to_have_text(revealed_phrase(1))
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", REVEALED_MARK), timeout=LIVE_MS)
        seq_before = get_game(a, s.game_id)["seq"]
        at(friend, 0, 0)
        friend.keyboard.press("x")
        expect(notices(friend)).to_have_text("That square is locked.")
        at(friend, 0, 1)
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", REVEALED_MARK))
    game = get_game(a, s.game_id)
    assert game["seq"] == seq_before
    assert (sq_of(game, 0, 0)["value"], sq_of(game, 0, 0)["state"], sq_of(game, 0, 0)["owner"]) == ("S", "revealed", "Teal")


def test_check_reveal_menus(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, c, ch) for c, ch in enumerate(MK_ROWS[0])])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 2, 0)
        check = button(page, "Check")
        menu = page.get_by_role("menu", name="Check")

        def item(name: str) -> Locator:
            return menu.get_by_role("menuitem", name=name, exact=True)

        check.focus()
        page.keyboard.press("Enter")
        expect(item("Square")).to_be_focused()
        for key, name in [("ArrowDown", "Word"), ("ArrowDown", "Puzzle"), ("ArrowDown", "Square"), ("ArrowUp", "Puzzle"),
                          ("Home", "Square"), ("End", "Puzzle")]:
            page.keyboard.press(key)
            expect(item(name)).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(check).to_be_focused()
        page.keyboard.press("Space")
        expect(item("Square")).to_be_focused()
        page.keyboard.press("Tab")
        expect(menu).to_be_hidden()
        expect(check).to_be_focused()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Space")
        expect(grid_of(page)).to_be_focused()
        reveal = button(page, "Reveal")
        reveal.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("menu", name="Reveal").get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(grid_of(page)).to_be_focused()
        expect(square(page, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "E", REVEALED_MARK))
    a = player_client(app_url, s.ids["a"])
    game = get_game(a, s.game_id)
    assert game["checked_count"] == 1 and game["revealed_count"] == 1
    check_ops = [op for op in ops_of(a, s.game_id) if op["type"] == "check"]
    assert [(op["scope"], op["row"], op["direction"]) for op in check_ops] == [("word", 2, "across")]


def test_check_reveal_rules(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, 0, "S"), seed_sq(0, 1, "X"),
                                                        seed_sq(0, 2, "O", state="pencil", pencil=True),
                                                        seed_sq(0, 4, "E", state="revealed")])
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["b"], "/api/health") as page:
        assert live_open(page, s.game_id, "friend") == "open"
        checked = act(a, s.game_id, "check", "word", 0, 0, "across")
        assert checked.status_code == 200
        body = checked.json()
        assert body["type"] == "check" and body["wrong"] == 1 and body["scope"] == "word"
        assert sorted((q["row"], q["col"], q["state"]) for q in body["squares"]) == [(0, 0, "right"), (0, 1, "wrong"), (0, 2, "right")]
        until(page, "(k) => window.__live[k].rec.messages.some(m => m.type === 'check')", "friend")
        broadcast = next(m for m in live_rec(page, "friend")["messages"] if m["type"] == "check")
        assert broadcast["seq"] == body["seq"] and broadcast["wrong"] == 1
        revealed = act(b, s.game_id, "reveal", "square", 0, 3)
        assert revealed.status_code == 200
        assert revealed.json()["revealed"] == 1
        assert revealed.json()["squares"] == [{"row": 0, "col": 3, "value": "N", "state": "revealed", "owner": "Coral"}]
        until(page, "(k) => window.__live[k].rec.messages.some(m => m.type === 'reveal')", "friend")
    game = get_game(a, s.game_id)
    assert (sq_of(game, 0, 2)["state"], sq_of(game, 0, 2)["pencil"]) == ("right", False)
    assert sq_of(game, 0, 1)["state"] == "wrong" and sq_of(game, 0, 3)["owner"] == "Coral"
    assert sq_of(game, 0, 4)["state"] == "revealed" and sq_of(game, 2, 0)["state"] == "empty"
    assert game["revealed_count"] == 2 and game["checked_count"] == 1
    word = act(a, s.game_id, "reveal", "word", 0, 0, "across")
    assert word.json()["revealed"] == 1 and sq_of(get_game(a, s.game_id), 0, 1)["value"] == "C"
    assert get_game(a, s.game_id)["revealed_count"] == 3
    clean = act(a, s.game_id, "check", "puzzle")
    assert clean.status_code == 200 and clean.json()["wrong"] == 0 and clean.json()["squares"] == []
    assert get_game(a, s.game_id)["checked_count"] == 2
    assert_error(write(b, s.game_id, 0, 0, "Q"), 409, "square_locked")
    kinds = [(op["type"], op.get("scope")) for op in ops_of(a, s.game_id)]
    assert kinds == [("check", "word"), ("reveal", "square"), ("reveal", "word"), ("check", "puzzle")]


def test_wf_check_reveal_word_square_puzzle(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, c, ch) for c, ch in enumerate("S" + "X" + MK_ROWS[0][2:])])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(friend, 2, 0)
        host.keyboard.press("Shift+Tab")
        at(host, 0, 0)
        menu_action(host, "Check", "Word")
        expect(announcements(host)).to_have_text(wrong_in(1, "word"))
        expect(square(friend, 0, 1)).to_have_attribute("data-state", "wrong", timeout=LIVE_MS)
        expect(square(friend, 0, 0)).to_have_attribute("data-state", "right", timeout=LIVE_MS)
        host.keyboard.press("ArrowRight")
        menu_action(host, "Reveal", "Square")
        expect(announcements(host)).to_have_text(revealed_phrase(1))
        expect(square(friend, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C", REVEALED_MARK), timeout=LIVE_MS)
        friend.keyboard.press("x")
        expect(square(host, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "X"), timeout=LIVE_MS)
        menu_action(host, "Check", "Puzzle")
        expect(announcements(host)).to_have_text(wrong_in(1, "puzzle"))
        expect(square(friend, 2, 0)).to_have_attribute("data-state", "wrong", timeout=LIVE_MS)
        expect(announcements(friend)).not_to_have_text(re.compile("wrong in this"))
        for page in (host, friend):
            page.reload()
            ready(page)
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", RIGHT_MARK))
            expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C", REVEALED_MARK))
            expect(square(page, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "X", WRONG_MARK))
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert game["checked_count"] == 2 and game["revealed_count"] == 1
    assert [sq_of(game, 0, c)["state"] for c in range(5)] == ["right", "revealed", "right", "right", "right"]
    assert sq_of(game, 2, 0)["state"] == "wrong"


def test_wf_check_reveal_menu_survives_updates(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    friend = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host:
        ready(host)
        host.keyboard.press("Alt+KeyC")
        menu = host.get_by_role("menu", name="Check")
        host.keyboard.press("ArrowDown")
        word = menu.get_by_role("menuitem", name="Word", exact=True)
        expect(word).to_be_focused()
        assert write(friend, s.game_id, 2, 0, "E").status_code == 200
        expect(square(host, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "E"), timeout=LIVE_MS)
        advance(host, TICK_S * 1000)
        expect(menu).to_be_visible()
        expect(word).to_be_focused()
        at(host, 0, 0)
        host.keyboard.press("Enter")
        expect(grid_of(host)).to_be_focused()
        expect(announcements(host)).to_have_text(no_errors("word"))
    a = player_client(app_url, s.ids["a"])
    assert get_game(a, s.game_id)["checked_count"] == 1
    assert [(op["type"], op["scope"], op["row"], op["direction"]) for op in ops_of(a, s.game_id) if op["type"] == "check"] == [("check", "word", 0, "across")]


def test_pencil_mode(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        pencil = button(page, "Pencil")
        expect(pencil).to_have_attribute("aria-pressed", "false")
        page.keyboard.press(".")
        expect(pencil).to_have_attribute("aria-pressed", "true")
        page.keyboard.press("s")
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", PENCIL_MARK))
        expect(square(page, 0, 0)).to_have_attribute("data-state", "pencil")
        click(pencil)
        expect(pencil).to_have_attribute("aria-pressed", "false")
        click(square(page, 0, 1))
        page.keyboard.press("c")
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C"))
        click(square(page, 0, 0))
        page.keyboard.press("s")
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"))
        page.keyboard.press(".")
        expect(pencil).to_have_attribute("aria-pressed", "true")
        click(square(page, 0, 1))
        page.keyboard.press("x")
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "X", PENCIL_MARK))
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert (sq_of(game, 0, 0)["pencil"], sq_of(game, 0, 0)["state"]) == (False, "filled")
    assert (sq_of(game, 0, 1)["value"], sq_of(game, 0, 1)["pencil"], sq_of(game, 0, 1)["state"]) == ("X", True, "pencil")


def test_rebus_entry(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS)
    long_letters = string.ascii_lowercase[:REBUS_MAX + 2]
    mixed = "abcd12345"
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        editor = page.get_by_role("textbox", name="Rebus entry")
        page.keyboard.press("Insert")
        expect(editor).to_be_focused()
        expect(editor).to_have_value("")
        page.keyboard.type("st-ar")
        expect(editor).to_have_value("STAR")
        page.keyboard.press("Enter")
        expect(editor).to_have_count(0)
        expect(grid_of(page)).to_be_focused()
        expect(square(page, 0, 0)).to_have_accessible_name("1 Across, letter 1 of 5, STAR")
        at(page, 0, 1)
        click(button(page, "Rebus"))
        expect(editor).to_be_focused()
        page.keyboard.type(long_letters)
        expect(editor).to_have_value(long_letters.upper()[:REBUS_MAX])
        page.keyboard.press("Escape")
        expect(editor).to_have_count(0)
        expect(grid_of(page)).to_be_focused()
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", EMPTY))
        page.keyboard.press("Insert")
        page.keyboard.type(mixed)
        expect(editor).to_have_value(mixed.upper()[:REBUS_MAX])
        page.keyboard.press("Enter")
        at(page, 0, 2)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Insert")
        expect(editor).to_have_value("STAR")
        for _ in range(len("STAR")):
            page.keyboard.press("Backspace")
        page.keyboard.press("Enter")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", EMPTY))
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert sq_of(game, 0, 0)["value"] == "" and sq_of(game, 0, 1)["value"] == mixed.upper()[:REBUS_MAX]


def test_editors_survive_updates(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    friend = player_client(app_url, s.ids["b"])
    draft = "st"
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        page.keyboard.press("Insert")
        editor = page.get_by_role("textbox", name="Rebus entry")
        page.keyboard.type(draft)
        assert write(friend, s.game_id, 2, 0, "E").status_code == 200
        expect(square(page, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "E"), timeout=LIVE_MS)
        advance(page, TICK_S * 1000)
        expect(editor).to_be_focused()
        expect(editor).to_have_value(draft.upper())
        at(page, 0, 0)
        page.keyboard.press("Escape")
        expect(grid_of(page)).to_be_focused()
        click(button(page, "Share"))
        dialog = page.get_by_role("dialog", name="Share game")
        copy = button(dialog, "Copy link")
        copy.focus()
        assert write(friend, s.game_id, 2, 1, "J").status_code == 200
        expect(square(page, 2, 1)).to_have_accessible_name(mk(2, 1, "across", "J"), timeout=LIVE_MS)
        advance(page, TICK_S * 1000)
        expect(dialog).to_be_visible()
        expect(copy).to_be_focused()
        at(page, 0, 0)


def test_wf_pencil_rebus_journey(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS, members=("a", "b"))
    friend = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        page.keyboard.press(".")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("l")
        page.keyboard.press("x")
        expect(square(page, 0, 2)).to_have_accessible_name(ns(0, 2, "across", "X", PENCIL_MARK))
        page.keyboard.press(".")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("i")
        expect(square(page, 0, 2)).to_have_accessible_name(ns(0, 2, "across", "I"))
        for _ in range(3):
            page.keyboard.press("ArrowLeft")
        at(page, 0, 0)
        page.keyboard.press("Insert")
        editor = page.get_by_role("textbox", name="Rebus entry")
        page.keyboard.type("st")
        assert write(friend, s.game_id, 2, 0, "H").status_code == 200
        expect(square(page, 2, 0)).to_have_accessible_name(ns(2, 0, "across", "H"), timeout=LIVE_MS)
        expect(editor).to_be_focused()
        expect(editor).to_have_value("STAR"[:2])
        page.keyboard.type("ar")
        page.keyboard.press("Enter")
        expect(square(page, 0, 0)).to_have_accessible_name("1 Across, letter 1 of 5, STAR")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", "L", PENCIL_MARK))
        at(page, 0, 3)
        page.keyboard.press("Insert")
        page.keyboard.type("gull")
        page.keyboard.press("Escape")
        expect(square(page, 0, 3)).to_have_accessible_name(ns(0, 3, "across", EMPTY))
        menu_action(page, "Check", "Word")
        expect(announcements(page)).to_have_text(no_errors("word"))
        page.reload()
        ready(page)
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "STAR", RIGHT_MARK))
    game = get_game(friend, s.game_id)
    assert (sq_of(game, 0, 0)["value"], sq_of(game, 0, 0)["state"]) == ("STAR", "right")
    assert (sq_of(game, 0, 1)["value"], sq_of(game, 0, 1)["pencil"], sq_of(game, 0, 1)["state"]) == ("L", False, "right")
    assert sq_of(game, 0, 3)["value"] == ""


def test_wf_pencil_rebus_rebus_race(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS, members=("a", "b"))
    a = player_client(app_url, s.ids["a"])
    friend = player_client(app_url, s.ids["b"])
    entries = ("STAR", "OVENS")
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as other:
        ready(host)
        ready(other)
        host.keyboard.press("Insert")
        host.keyboard.type(entries[0].lower())
        racer = threading.Thread(target=lambda: write(friend, s.game_id, 0, 0, entries[1]))
        racer.start()
        host.keyboard.press("Enter")
        racer.join(HTTP_TIMEOUT)
        writes = poll(lambda: (lambda o: o if len(o) == 2 else None)(
            [op for op in ops_of(a, s.game_id) if op["type"] == "cell" and (op["row"], op["col"]) == (0, 0)]),
            SERVER_WAIT_S, "both rebus writes to 0,0 were sequenced")
        final = max(writes, key=lambda op: op["seq"])["value"]
        assert final in entries
        for page in (host, other):
            expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", final), timeout=LIVE_MS)
    assert sq_of(get_game(a, s.game_id), 0, 0)["value"] == final


@pytest.mark.timeout(900)
def test_server_timer(browser: Browser) -> None:
    short = short_url()
    grace_s = config(short)["presence_grace_ms"] / 1000
    s = seed_game(short, squares=mk_fill(skip=((4, 4),)))
    a = player_client(short, s.ids["a"])
    start = get_game(a, s.game_id)
    assert (start["status"], start["timer_state"], start["elapsed_ms"]) == ("open", "paused", 0)
    with as_player(browser, short, s.ids["a"], "/api/health") as page:
        t0 = time.monotonic()
        assert live_open(page, s.game_id, "one") == "open"
        poll(lambda: (lambda g: g if g["status"] == "live" and g["timer_state"] == "running" else None)(get_game(a, s.game_id)),
             SERVER_WAIT_S, "game went live and the timer ran on the first live connection")
        poll(lambda: get_game(a, s.game_id)["elapsed_ms"] > 0, SERVER_WAIT_S, "elapsed_ms grew while live")
        live_close(page, "one")
        t1 = time.monotonic()
        paused = poll(lambda: (lambda g: g if g["status"] == "paused" else None)(get_game(a, s.game_id)),
                      grace_s + SERVER_WAIT_S, "game paused after the presence grace")
        assert paused["timer_state"] == "paused"
        assert paused["elapsed_ms"] <= (t1 - t0) * 1000, "the grace period was counted in elapsed_ms"
        assert all(seg["ended_at"] for seg in paused["timer_segments"])
        assert segment_sum(paused["timer_segments"]) == paused["elapsed_ms"]
        assert get_game(a, s.game_id)["elapsed_ms"] == paused["elapsed_ms"]
        assert live_open(page, s.game_id, "two") == "open"
        poll(lambda: get_game(a, s.game_id)["status"] == "live", SERVER_WAIT_S, "game went live again on reconnect")
        live_close(page, "two")
        assert live_open(page, s.game_id, "three") == "open"
        watch_until = time.monotonic() + 2 * grace_s
        while time.monotonic() < watch_until:
            assert get_game(a, s.game_id)["status"] == "live", "a reconnection within the grace must keep the game live"
            threading.Event().wait(POLL_S)
        g = get_game(a, s.game_id)
        assert len(g["timer_segments"]) == len(paused["timer_segments"]) + 1
        assert g["timer_segments"][-1]["ended_at"] is None
        assert g["elapsed_ms"] >= paused["elapsed_ms"]
        assert write(a, s.game_id, 4, 4, "R").status_code == 200
    solved = get_game(a, s.game_id)
    assert (solved["status"], solved["timer_state"]) == ("solved", "solved") and solved["solved_at"]
    assert all(seg["ended_at"] for seg in solved["timer_segments"])
    assert segment_sum(solved["timer_segments"]) == solved["elapsed_ms"]
    assert get_game(a, s.game_id)["elapsed_ms"] == solved["elapsed_ms"]


def test_timer_display_personal_pause(browser: Browser, app_url: str) -> None:
    tick = TICK_S * 1000
    s = seed_game(app_url, elapsed_ms=HOUR_PLUS_MS)
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        timer = timer_of(page)
        expect(timer).to_have_attribute("data-timer-state", "running")
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS))
        advance(page, tick)
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS + tick))
        pause = button(page, "Pause my timer")
        click(pause)
        expect(pause).to_have_attribute("aria-pressed", "true")
        advance(page, tick)
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS + tick))
        assert get_game(a, s.game_id)["timer_state"] == "running"
        click(pause)
        expect(pause).to_have_attribute("aria-pressed", "false")
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS + 2 * tick))
    short = seed_game(app_url, elapsed_ms=SHORT_TIME_MS)
    with as_player(browser, app_url, short.ids["a"], short.room) as page:
        ready(page)
        expect(timer_of(page)).to_have_text(fmt(SHORT_TIME_MS))


def _timer_bounds(page: Page, low_ms: int, client: httpx.Client, game_id: str) -> None:
    high = get_game(client, game_id)["elapsed_ms"]
    allowed = {fmt(sec * 1000) for sec in range(low_ms // 1000, high // 1000 + 1)}
    text = timer_of(page).inner_text().strip()
    assert text in allowed, f"Solve time showed {text!r}; the server's value was between {fmt(low_ms)} and {fmt(high)}"


@pytest.mark.timeout(900)
def test_wf_timer_leave_and_return(browser: Browser) -> None:
    short = short_url()
    grace_s = config(short)["presence_grace_ms"] / 1000
    s = seed_game(short, members=("a", "b"), elapsed_ms=CLOCK_MS)
    a = player_client(short, s.ids["a"])
    with as_player(browser, short, s.ids["a"], s.room) as host, as_player(browser, short, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        poll(lambda: get_game(a, s.game_id)["timer_state"] == "running", SERVER_WAIT_S, "timer ran with two players present")
        t0 = time.monotonic()
        live_ms = get_game(a, s.game_id)["elapsed_ms"]
        host.close()
        friend.close()
        t1 = time.monotonic()
    paused = poll(lambda: (lambda g: g if g["timer_state"] == "paused" else None)(get_game(a, s.game_id)),
                  grace_s + SERVER_WAIT_S, "the timer paused after both players left")
    assert paused["status"] == "paused"
    assert paused["elapsed_ms"] <= live_ms + (t1 - t0) * 1000 + CLOSE_SLACK_MS, "the paused value includes the grace period"
    assert get_game(a, s.game_id)["elapsed_ms"] == paused["elapsed_ms"]
    with as_player(browser, short, s.ids["b"], s.room) as back, as_player(browser, short, s.ids["a"], s.room) as other:
        ready(back)
        ready(other)
        expect(timer_of(back)).to_have_attribute("data-timer-state", "running")
        _timer_bounds(back, paused["elapsed_ms"], a, s.game_id)
        _timer_bounds(other, paused["elapsed_ms"], a, s.game_id)
    assert get_game(a, s.game_id)["elapsed_ms"] >= paused["elapsed_ms"]


def test_wf_timer_wrong_device_clock(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, elapsed_ms=HOUR_PLUS_MS)
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room, before=lambda p: p.clock.set_system_time(FAR_CLOCK)) as page:
        ready(page)
        poll(lambda: timer_of(page).get_attribute("data-timer-state") == get_game(a, s.game_id)["timer_state"],
             SERVER_WAIT_S, "the room's timer state matches the server's")
        _timer_bounds(page, HOUR_PLUS_MS, a, s.game_id)


def test_wf_timer_personal_pause_survives_updates(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), elapsed_ms=HOUR_PLUS_MS)
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        timer = timer_of(page)
        expect(timer).to_have_attribute("data-timer-state", "running")
        pause = button(page, "Pause my timer")
        click(pause)
        frozen = timer.inner_text().strip()
        with as_player(browser, app_url, s.ids["b"], s.room) as friend:
            ready(friend)
            expect(page.get_by_role("list", name="Players")).to_contain_text(f"Coral{HERE}", timeout=LIVE_MS)
            advance(page, TICK_S * 1000)
            expect(timer).to_have_text(frozen)
            expect(pause).to_have_attribute("aria-pressed", "true")
        click(pause)
        assert seconds_of(timer.inner_text()) >= seconds_of(frozen) + TICK_S
    assert get_game(a, s.game_id)["timer_state"] in ("running", "paused")


def test_solve_detection(app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",), squares=mk_fill(skip=((0, 0),), extra=(seed_sq(0, 1, "C", state="right"),)))
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    c = player_client(app_url, s.ids["c"])
    assert write(a, s.game_id, 0, 0, "X").status_code == 200
    assert get_game(a, s.game_id)["status"] != "solved"
    results = together(lambda: write(a, s.game_id, 0, 0, "s"), lambda: write(b, s.game_id, 0, 0, "S"))
    winners = [r for r in results if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in results]
    for loser in (r for r in results if r.status_code != 200):
        assert_error(loser, 409, "game_solved", "This puzzle is already solved.")
    game = get_game(a, s.game_id)
    assert (game["status"], game["timer_state"]) == ("solved", "solved") and game["solved_at"]
    assert game["seq"] == winners[0].json()["seq"] == ops_of(a, s.game_id)[-1]["seq"]
    assert get_game(a, s.game_id)["elapsed_ms"] == game["elapsed_ms"]
    assert_error(write(a, s.game_id, 2, 0, "E"), 409, "game_solved")
    assert_error(write(b, s.game_id, 0, 1, "Q"), 409, "game_solved")
    assert_error(act(a, s.game_id, "check", "puzzle"), 409, "game_solved")
    assert len(ops_of(a, s.game_id)) == 2
    for client in (a, b):
        assert [e["game_id"] for e in client.get("/api/history").json()["entries"]].count(s.game_id) == 1
    assert s.game_id not in [e["game_id"] for e in c.get("/api/history").json()["entries"]]
    pencil = seed_game(app_url, squares=mk_fill(skip=((0, 0),)))
    p = player_client(app_url, pencil.ids["a"])
    assert write(p, pencil.game_id, 0, 0, "S", pencil=True).status_code == 200
    assert get_game(p, pencil.game_id)["status"] == "solved"


def test_solved_dialog(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((0, 0),), extra=(seed_sq(4, 4, "R", state="revealed"),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room, reduced="reduce") as host, \
            as_player(browser, app_url, s.ids["b"], s.room, reduced="reduce") as friend:
        ready(host)
        ready(friend)
        assert write(a, s.game_id, 0, 0, "S").status_code == 200
        elapsed = get_game(a, s.game_id)["elapsed_ms"]
        for page in (host, friend):
            dialog = page.get_by_role("dialog", name="Puzzle solved")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            heading = dialog.get_by_role("heading")
            expect(heading).to_have_text(f"Solved in {fmt(elapsed)}")
            expect(heading).to_be_focused()
            expect(dialog).to_contain_text(revealed_phrase(1))
            assert animations(dialog) == []
        click(button(friend.get_by_role("dialog", name="Puzzle solved"), "Close"))
        expect(grid_of(friend)).to_be_focused()


def test_wf_solved_last_letter(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((0, 0),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(friend, 0, 0)
        friend.keyboard.press("s")
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "the last letter solved the game")
        game = get_game(a, s.game_id)
        for page in (host, friend):
            dialog = page.get_by_role("dialog", name="Puzzle solved")
            expect(dialog.get_by_role("heading")).to_have_text(f"Solved in {fmt(game['elapsed_ms'])}", timeout=LIVE_MS)
            expect(dialog).to_contain_text("No squares revealed")
            expect(timer_of(page)).to_have_attribute("data-timer-state", "solved")
            expect(timer_of(page)).to_have_text(fmt(game["elapsed_ms"]))
            advance(page, TICK_S * 1000)
            expect(timer_of(page)).to_have_text(fmt(game["elapsed_ms"]))
        host.keyboard.press("Escape")
        expect(grid_of(host)).to_be_focused()
        host.keyboard.press("x")
        expect(notices(host)).to_have_text("This puzzle is already solved.")
    after = get_game(a, s.game_id)
    assert after["seq"] == game["seq"] and after["elapsed_ms"] == game["elapsed_ms"]
    assert [sq_of(after, 0, c)["value"] for c in range(5)] == list(MK_ROWS[0])


def test_wf_solved_phone_reduced(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((4, 4),)))
    with as_player(browser, app_url, s.ids["b"], s.room, viewport=PHONE, reduced="reduce") as page:
        ready(page)
        at(page, 4, 4)
        tap(button(page.get_by_role("group", name="Letter keyboard"), "R"))
        dialog = page.get_by_role("dialog", name="Puzzle solved")
        expect(dialog).to_be_visible(timeout=LIVE_MS)
        expect(dialog.get_by_role("heading")).to_be_focused()
        assert animations(dialog) == []
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert game["status"] == "solved" and sq_of(game, 4, 4)["owner"] == "Coral"


def test_grid_announcements(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((2, 1),), extra=(seed_sq(0, 1, "X"),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        region = announcements(page)
        at(page, 2, 1)
        expect(region).to_have_text(spoken(4, "across"))
        page.keyboard.press("ArrowRight")
        expect(region).to_have_text(spoken(4, "across"))
        page.keyboard.press("Tab")
        expect(region).to_have_text(spoken(5, "across"))
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Shift+Tab")
        expect(region).to_have_text(spoken(1, "across"))
        at(page, 0, 0)
        menu_action(page, "Check", "Square")
        expect(region).to_have_text(no_errors("square"))
        page.keyboard.press("ArrowRight")
        expect(region).to_have_text(no_errors("square"))
        menu_action(page, "Check", "Square")
        expect(region).to_have_text(wrong_in(1, "square"))
        menu_action(page, "Reveal", "Square")
        expect(region).to_have_text(revealed_phrase(1))
        with as_player(browser, app_url, s.ids["b"], s.room) as friend:
            ready(friend)
            expect(region).to_have_text(f"{s.names['b']} joined", timeout=LIVE_MS)
            friend.close()
        expect(region).to_have_text(f"{s.names['b']} left", timeout=LIVE_MS)
        page.keyboard.press("Tab")
        at(page, 2, 1)
        page.keyboard.press("j")
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "typing J solved the game")
        expect(region).to_have_text(f"Puzzle solved in {fmt(get_game(a, s.game_id)['elapsed_ms'])}", timeout=LIVE_MS)


def test_presence_tiles(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",))
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        items = page.get_by_role("list", name="Players").get_by_role("listitem")
        host = items.filter(has_text=s.names["a"])
        friend = items.filter(has_text=s.names["b"])
        expect(host).to_contain_text(f"Teal{HERE}{HOST}")
        expect(friend).to_contain_text(f"Coral{AWAY}")
        with as_player(browser, app_url, s.ids["b"], s.room) as other:
            ready(other)
            expect(friend).to_contain_text(f"Coral{HERE}", timeout=LIVE_MS)
            other.close()
        expect(friend).to_contain_text(f"Coral{AWAY}", timeout=LIVE_MS)
        with as_player(browser, app_url, s.ids["c"], f"/g/{s.code}") as third:
            ready(third)
            expect(items.filter(has_text=s.names["c"])).to_contain_text(f"Violet{HERE}", timeout=LIVE_MS)
            expect(items).to_have_count(3)


def test_wf_announcements_journey(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, outsiders=("c",), squares=[seed_sq(0, 1, "X")])
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=TABLET) as page:
        ready(page)
        region = announcements(page)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        expect(region).to_have_text(spoken(2, "down"))
        expect(square(page, 0, 2)).to_have_accessible_name(mk(0, 2, "down", EMPTY))
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "down", "X"))
        with as_player(browser, app_url, s.ids["c"], f"/g/{s.code}") as friend:
            ready(friend)
            expect(region).to_have_text(f"{s.names['c']} joined", timeout=LIVE_MS)
            menu_action(page, "Check", "Puzzle")
            expect(region).to_have_text(wrong_in(1, "puzzle"))
            expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "down", "X", WRONG_MARK))
            expect(square(friend, 0, 1)).to_have_attribute("data-state", "wrong", timeout=LIVE_MS)
            expect(announcements(friend)).not_to_have_text(re.compile("wrong in this"))
            friend.close()
        expect(region).to_have_text(f"{s.names['c']} left", timeout=LIVE_MS)
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert colour_of(game, s.ids["c"]) == "Coral" and sq_of(game, 0, 1)["state"] == "wrong"


def test_wf_announcements_reveal_solve(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, 0, "S", state="right")])
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        host.keyboard.press("Alt+KeyR")
        host.keyboard.press("End")
        host.keyboard.press("Enter")
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "revealing the puzzle solved it")
        game = get_game(a, s.game_id)
        expect(announcements(friend)).to_have_text(f"Puzzle solved in {fmt(game['elapsed_ms'])}", timeout=LIVE_MS)
        expect(host.get_by_role("dialog", name="Puzzle solved")).to_contain_text(revealed_phrase(MK_WHITE - 1), timeout=LIVE_MS)
    assert game["revealed_count"] == MK_WHITE - 1


def _uploader(base: str) -> httpx.Client:
    return player_client(base, seed_players(base, "a")["a"])


def test_overlap_text_format(app_url: str) -> None:
    client = _uploader(app_url)
    title = fresh_title()
    text = ("\ufeffOverlap 1  \r\nTitle:   " + title + "  \r\nAuthor: Wren Halloway\r\n\r\nSize: 5x5\r\n\r\nGrid:\r\n"
            "scone\r\nT#V#N\r\nEJECT  \r\nA#N#E\r\nMISER\r\n\r\nAcross:\r\n5. One who hoards every coin\r\n\r\n"
            "1. Crumbly bake served with jam\r\n4. Push the tape out of the deck\r\nDown:\r\n3. Step inside, or key in data\r\n"
            "1. What rises from a kettle spout\r\n2. Hot boxes that bake the bread\r\n")
    data = text.encode()
    first = client.post("/api/puzzles", content=data)
    assert first.status_code == 201, first.text
    puzzle, solution = first.json()["puzzle"], first.json()["solution"]
    assert (puzzle["title"], puzzle["author"], puzzle["cols"], puzzle["rows"]) == (title, "Wren Halloway", 5, 5)
    assert (puzzle["source"], puzzle["fixture"]) == ("upload", None)
    assert puzzle["sha256"] == hashlib.sha256(data).hexdigest()
    assert puzzle["blocks"] == ["".join("#" if ch == "#" else "." for ch in row) for row in MK_ROWS]
    expected_numbers = sorted((r, c, n) for (r, c), n in words(MK_ROWS)[0].items())
    assert sorted((n["row"], n["col"], n["number"]) for n in puzzle["numbers"]) == expected_numbers
    found = words(MK_ROWS)[1]
    for direction, clues in (("across", MK_ACROSS), ("down", MK_DOWN)):
        got = sorted((c["number"], c["row"], c["col"], c["length"], c["text"]) for c in puzzle["clues"][direction])
        want = sorted((n, found[direction][n][0][0], found[direction][n][0][1], len(found[direction][n]), t) for n, t in clues.items())
        assert got == want
    assert solution == [list(row) for row in MK_ROWS]
    shown = client.get(f"/api/puzzles/{puzzle['id']}")
    assert shown.status_code == 200 and "SCONE" not in shown.text and "STEAM" not in shown.text
    second = client.post("/api/puzzles", content=data).json()["puzzle"]
    strip = lambda p: {k: v for k, v in p.items() if k not in ("id", "created_at")}
    assert strip(second) == strip(puzzle) and second["id"] != puzzle["id"]
    rebus = client.post("/api/puzzles", content=NS_TEXT.replace("Title: Night Shift", f"Title: {fresh_title()}").encode())
    assert rebus.status_code == 201 and rebus.json()["solution"] == NS_ROWS
    wide_rows = ["CATS", "AREA", "BEER"]
    wide = ("Overlap 1\nTitle: " + fresh_title() + "\nAuthor: Wren Halloway\nSize: 4x3\nGrid:\n" + "\n".join(wide_rows) +
            "\nAcross:\n1. Pets\n5. Region\n6. Brew\nDown:\n1. Taxi\n2. Exist\n3. Golf peg\n4. Old fish\n")
    shaped = client.post("/api/puzzles", content=wide.encode())
    assert shaped.status_code == 201, shaped.text
    p = shaped.json()["puzzle"]
    assert (p["cols"], p["rows"]) == (len(wide_rows[0]), len(wide_rows))
    assert sorted((n["row"], n["col"], n["number"]) for n in p["numbers"]) == sorted((r, c, n) for (r, c), n in words(wide_rows)[0].items())
    other = assert_error(client.post("/api/puzzles", content=b'{"title":"Morning Kettle"}'), 422, "invalid_puzzle")
    assert other["lines"] == [line(1, FIRST_LINE)]


def _upload_case(case: str, cfg: dict, title: str) -> tuple[bytes, list[str] | None]:
    mk_lines = mk_text(title).split("\n")

    def put(n: int, text: str) -> None:
        mk_lines[n - 1] = text

    joined = lambda lines: "\n".join(lines).encode()
    head = mk_lines[:16]
    tail = ["", "Down:"] + [f"{n}. {t}" for n, t in MK_DOWN.items()] + [""]
    if case == "first_line":
        put(1, "Overlap 2")
        return joined(mk_lines), [line(1, FIRST_LINE)]
    if case == "three_errors":
        put(3, "Author: ")
        put(7, "SC0NE")
        put(15, "4 " + MK_ACROSS[4])
        return joined(mk_lines), [line(3, AUTHOR_LEN), line(7, f"unexpected character {'0'} in grid row"), line(15, CLUE_SYNTAX)]
    if case == "size_syntax":
        put(2, "Title: ")
        put(4, "Size: 5X5")
        return joined(mk_lines), [line(2, TITLE_LEN), line(4, SIZE_SYNTAX)]
    if case == "size_range":
        top = cfg["max_grid"]
        put(4, f"Size: {top + 1}x5")
        return joined(mk_lines), [line(4, f"grid size must be from 3x3 to {top}x{top}")]
    if case == "missing_grid":
        return f"Overlap 1\nTitle: {title}\nAuthor: Wren Halloway\nSize: 5x5\n".encode(), [line(5, expected_line("Grid"))]
    if case == "rebus":
        ns_lines = NS_TEXT.replace("Title: Night Shift", f"Title: {title}").split("\n")
        long_rebus = "STARSHIPS"
        ns_lines[6], ns_lines[8], ns_lines[9] = "{" + long_rebus + "}LING", "HOTE", "I#A#{L"
        return joined(ns_lines), [line(7, f"rebus {{{long_rebus}}} must be 1 to 8 letters or digits"),
                                  line(9, f"grid row has {4} squares, expected {5}"), line(10, REBUS_OPEN)]
    if case == "orphan":
        text = (f"Overlap 1\nTitle: {title}\nAuthor: Wren Halloway\nSize: 3x3\nGrid:\nCAT\n#A#\nX#N\nAcross:\n"
                "1. Feline pet\nDown:\n2. Doubled letter\n")
        return text.encode(), [line(8, f"square at row {3}, column {1} is not part of any word")]
    if case == "clue_matching":
        lines = head + ["6. Not in this grid", "", "Down:", f"1. {MK_DOWN[1]}", f"2. {MK_DOWN[2]}", "2. Hot boxes again", ""]
        return joined(lines), [line(17, f"clue {6} Across has no matching word in the grid"),
                               line(19, f"missing clue for {3} Down"), line(22, f"clue {2} Down appears twice")]
    if case == "row_count":
        lines = mk_lines[:10] + ["", "Across:", "1. " + "x" * (CLUE_MAX + 1), f"4. {MK_ACROSS[4]}", f"5. {MK_ACROSS[5]}"] + tail
        return joined(lines), [line(6, f"grid has {4} rows, expected {5}"), line(13, f"clue {1} Across is longer than {CLUE_MAX} characters")]
    if case == "not_utf8":
        rest = "\n".join(mk_lines[2:]).encode()
        return b"Overlap 1\nTitle: Bad \xff title\n" + rest, [line(2, NOT_UTF8)]
    if case == "too_many":
        lines = head + ["Bad clue"] * (LISTED_MAX + 5) + tail
        return joined(lines), [line(n, CLUE_SYNTAX) for n in range(17, 17 + LISTED_MAX)]
    body = mk_text(title).encode()
    limit = cfg["upload_max_bytes"]
    if case == "too_large":
        return body + b"\n" * (limit + 1 - len(body)), None
    return body + b"\n" * (limit - len(body)), None


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_errors(app_url: str, case: str) -> None:
    client = _uploader(app_url)
    cfg = config(app_url)
    title = fresh_title()
    data, expected = _upload_case(case, cfg, title)
    response = client.post("/api/puzzles", content=data)
    if UPLOAD_CASES[case] == 201:
        assert response.status_code == 201, response.text
        return
    if UPLOAD_CASES[case] == 413:
        assert_error(response, 413, "too_large", f"This file is larger than {cfg['upload_max_bytes']} bytes.")
    else:
        body = assert_error(response, 422, "invalid_puzzle")
        assert body["lines"] == expected
        count = LISTED_MAX + 5 if case == "too_many" else len(expected)
        assert body["message"] == problems(count)
    assert client.get("/api/puzzles", params={"source": "mine"}).json()["puzzles"] == []


def test_upload_stored_as_submitted(app_url: str) -> None:
    client = _uploader(app_url)
    data = ("\ufeff" + mk_text(fresh_title()).replace("\n", "  \r\n")).encode()
    created = client.post("/api/puzzles", content=data)
    assert created.status_code == 201, created.text
    pid = created.json()["puzzle"]["id"]
    key = f"uploads/{pid}/original.overlap.txt"
    store = S3()
    assert store.keys(f"uploads/{pid}/") == [key]
    assert store.get(key) == data
    assert created.json()["puzzle"]["sha256"] == hashlib.sha256(data).hexdigest()
    original = client.get(f"/api/puzzles/{pid}/original")
    assert original.status_code == 200 and original.content == data
    assert media(original.headers["content-type"]) == media(TEXT_PLAIN)
    assert original.headers["content-disposition"] == f'attachment; filename="{pid}.overlap.txt"'
    library = seed_game(app_url).puzzle_id
    assert_error(client.get(f"/api/puzzles/{library}/original"), 404, "not_found")


def test_private_uploads(app_url: str) -> None:
    ids = seed_players(app_url, "a", "b", "c")
    owner, friend, stranger = (player_client(app_url, ids[k]) for k in "abc")
    pid = owner.post("/api/puzzles", content=mk_text(fresh_title()).encode()).json()["puzzle"]["id"]
    assert_error(anonymous(app_url).get(f"/api/puzzles/{pid}"), 401, "no_player")
    for path in (f"/api/puzzles/{pid}", f"/api/puzzles/{pid}/original"):
        assert_error(friend.get(path), 404, "not_found")
    assert pid not in [p["id"] for p in friend.get("/api/puzzles").json()["puzzles"]]
    assert_error(friend.post("/api/games", json={"puzzle_id": pid}), 404, "not_found")
    game = owner.post("/api/games", json={"puzzle_id": pid})
    assert game.status_code == 201
    assert friend.post(f"/api/links/{game.json()['code']}/join", json={}).status_code == 200
    assert friend.get(f"/api/puzzles/{pid}").status_code == 200
    assert_error(stranger.get(f"/api/puzzles/{pid}"), 404, "not_found")


def _open_upload(page: Page) -> Locator:
    click(button(page, "Upload puzzle"))
    dialog = page.get_by_role("dialog", name="Upload a puzzle")
    expect(dialog).to_be_visible(timeout=READY_MS)
    return dialog


def test_wf_upload_fix_and_open(browser: Browser, app_url: str) -> None:
    title = fresh_title()
    bad, expected = _upload_case("three_errors", config(app_url), title)
    good = mk_text(title)
    with as_player(browser, app_url, None, "/upload") as page:
        name_dialog = page.get_by_role("dialog", name="Choose a display name")
        expect(name_dialog).to_be_visible(timeout=READY_MS)
        expect(name_dialog.get_by_role("textbox", name="Display name")).to_be_focused()
        page.keyboard.press("Tab")
        expect(button(name_dialog, "Continue")).to_be_focused()
        page.keyboard.press("Enter")
        expect(name_dialog).to_contain_text("Enter a name between 1 and 24 characters.")
        name_dialog.get_by_role("textbox", name="Display name").focus()
        page.keyboard.type(name_for("a"))
        page.keyboard.press("Tab")
        expect(button(name_dialog, "Continue")).to_be_focused()
        page.keyboard.press("Enter")
        expect(name_dialog).to_be_hidden()
        button(page, "Upload puzzle").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Upload a puzzle")
        expect(dialog).to_be_visible()
        fill(dialog.get_by_role("textbox", name="Puzzle text"), bad.decode())
        click(button(dialog, "Upload"))
        heading = dialog.get_by_role("heading", name=problems(len(expected)))
        expect(heading).to_be_focused()
        expect(dialog.get_by_role("list", name="Upload errors").get_by_role("listitem")).to_have_text(expected)
        fill(dialog.get_by_role("textbox", name="Puzzle text"), good)
        with entered(held(page, "**/api/puzzles")) as gate:
            click(button(dialog, "Upload"))
            expect(dialog.get_by_role("status", name="Upload status")).to_have_text("Checking your puzzle")
            expect(button(dialog, "Upload")).to_be_disabled()
            gate.release()
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}")
        click(button(dialog, "Start a room with this puzzle"))
        ready(page)
        game_id = page.url.rstrip("/").rsplit("/", 1)[-1]
        game = page.request.get(app_url + f"/api/games/{game_id}").json()
        puzzle = page.request.get(app_url + f"/api/puzzles/{game['puzzle_id']}").json()
    assert puzzle["title"] == title and puzzle["source"] == "upload"
    assert S3().get(f"uploads/{puzzle['id']}/original.overlap.txt") == good.encode()


def test_wf_upload_file_input(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    data = ("\ufeff" + mk_text(title).replace("\n", "\r\n")).encode()
    with as_player(browser, app_url, owner, "/upload") as page:
        dialog = _open_upload(page)
        dialog.get_by_label("Puzzle file").set_input_files({"name": "kettle.overlap.txt", "mimeType": "text/plain", "buffer": data})
        expect(dialog.get_by_role("textbox", name="Puzzle text")).to_have_value(re.compile(re.escape(title)))
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}")
        click(button(dialog, "Start a room with this puzzle"))
        ready(page)
        with page.expect_download() as info:
            click(button(page, "Download original"))
        downloaded = Path(info.value.path()).read_bytes()
        game_id = page.url.rstrip("/").rsplit("/", 1)[-1]
        pid = page.request.get(app_url + f"/api/games/{game_id}").json()["puzzle_id"]
    assert downloaded == data
    assert S3().get(f"uploads/{pid}/original.overlap.txt") == data


def test_wf_upload_too_large(browser: Browser) -> None:
    short = short_url()
    limit = config(short)["upload_max_bytes"]
    player = seed_players(short, "a")["a"]
    title = fresh_title()
    text = mk_text(title)
    with as_player(browser, short, player, "/upload") as page:
        dialog = _open_upload(page)
        fill(dialog.get_by_role("textbox", name="Puzzle text"), text + "\n" * (limit + 1 - len(text.encode())))
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("heading", name=f"This file is larger than {limit} bytes.")).to_be_visible()
        expect(dialog.get_by_role("list", name="Upload errors")).to_have_count(0)
        assert page.request.get(short + "/api/puzzles?source=mine").json()["puzzles"] == []
        fill(dialog.get_by_role("textbox", name="Puzzle text"), text)
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}")
        mine = page.request.get(short + "/api/puzzles?source=mine").json()["puzzles"]
    assert [p["title"] for p in mine] == [title]
    assert S3("-short").get(f"uploads/{mine[0]['id']}/original.overlap.txt") == text.encode()


def _solved_game(base: str, members: tuple = ("a", "b"), outsiders: tuple = ("c",), timer_state: str = "paused") -> tuple[Seeded, dict]:
    s = seed_game(base, members=members, outsiders=outsiders, timer_state=timer_state,
                  squares=mk_fill(skip=((0, 0),), extra=(seed_sq(4, 4, "R", state="revealed"),)))
    b = player_client(base, s.ids[members[-1]])
    assert write(b, s.game_id, 0, 0, "S").status_code == 200
    return s, get_game(b, s.game_id)


def history_row(game: dict) -> str:
    return f"Morning Kettle · {fmt(game['elapsed_ms'])} · {game['solved_at'][:10]}"


def test_history_entries(browser: Browser, app_url: str) -> None:
    s, game = _solved_game(app_url)
    entries = player_client(app_url, s.ids["a"]).get("/api/history").json()["entries"]
    mine = [e for e in entries if e["game_id"] == s.game_id]
    assert len(mine) == 1
    entry = mine[0]
    assert (entry["puzzle_title"], entry["cols"], entry["rows"], entry["revealed_count"]) == ("Morning Kettle", 5, 5, 1)
    assert entry["elapsed_ms"] == game["elapsed_ms"] and entry["solved_at"] == game["solved_at"]
    assert [(p["display_name"], p["colour"]) for p in entry["players"]] == [(s.names["a"], "Teal"), (s.names["b"], "Coral")]
    assert {(q["row"], q["col"]): q["owner"] for q in entry["squares"]}[(0, 0)] == "Coral"
    assert s.game_id not in [e["game_id"] for e in player_client(app_url, s.ids["c"]).get("/api/history").json()["entries"]]
    for key in ("a", "b"):
        with as_player(browser, app_url, s.ids[key], "/history") as page:
            item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text=history_row(game))
            expect(item).to_have_count(1, timeout=READY_MS)
            expect(item).to_contain_text(revealed_phrase(1))
            page.reload()
            expect(item).to_have_count(1, timeout=READY_MS)


def test_solve_record_object(app_url: str) -> None:
    s, game = _solved_game(app_url, timer_state="running")
    a = player_client(app_url, s.ids["a"])
    key = f"records/{s.game_id}.json"
    store = S3()
    poll(lambda: store.keys(key) == [key], RECORD_WAIT_S, f"object {key} was written")
    raw = store.get(key)
    record = json.loads(raw)
    assert record["format"] == "overlap-solve-record-1"
    assert (record["game_id"], record["puzzle_id"], record["puzzle_title"]) == (s.game_id, s.puzzle_id, "Morning Kettle")
    assert (record["elapsed_ms"], record["revealed_count"], record["solved_at"]) == (game["elapsed_ms"], 1, game["solved_at"])
    assert record["ops"] == ops_of(a, s.game_id)
    assert record["timer_segments"] == game["timer_segments"]
    assert segment_sum(record["timer_segments"]) == record["elapsed_ms"]
    initial = {(q["row"], q["col"]): q["value"] for q in record["initial"]}
    assert initial[(0, 0)] == "" and initial[(4, 4)] == "R"
    assert sorted((q["row"], q["col"], q["value"]) for q in record["final"]) == sorted((q["row"], q["col"], q["value"]) for q in game["squares"])
    download = a.get(f"/api/history/{s.game_id}/record")
    assert download.status_code == 200 and download.content == raw
    assert_error(player_client(app_url, s.ids["c"]).get(f"/api/history/{s.game_id}/record"), 404, "not_found")


def test_replay_from_record(browser: Browser, app_url: str) -> None:
    base_squares = [q for q in mk_fill(skip=tuple((4, c) for c in range(5))) if (q["row"], q["col"]) != (0, 1)]
    s = seed_game(app_url, members=("a", "b"), squares=base_squares + [seed_sq(0, 1, "X")])
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    assert write(a, s.game_id, 4, 0, "M").status_code == 200
    assert write(b, s.game_id, 4, 1, "I").status_code == 200
    assert act(a, s.game_id, "check", "word", 0, 0, "across").status_code == 200
    assert write(a, s.game_id, 0, 1, "C").status_code == 200
    assert act(b, s.game_id, "reveal", "word", 4, 2, "across").status_code == 200
    assert get_game(a, s.game_id)["status"] == "solved"
    poll(lambda: next((e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id and e["record_ready"]), None),
         RECORD_WAIT_S, "history entry reported record_ready")
    record = a.get(f"/api/history/{s.game_id}/record").json()
    values = {(q["row"], q["col"]): q["value"] for q in record["initial"]}
    steps = [dict(values)]
    for op in record["ops"]:
        if op["type"] == "cell":
            values[(op["row"], op["col"])] = op["value"]
        for q in op.get("squares") or []:
            if "value" in q:
                values[(q["row"], q["col"])] = q["value"]
        steps.append(dict(values))
    n = len(record["ops"])
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text="Morning Kettle")
        click(button(item, "Replay"))
        dialog = page.get_by_role("dialog", name="Replay")
        grid = dialog.get_by_role("group", name="Replay grid")
        expect(grid.locator("[data-row][data-col]")).to_have_count(MK_WHITE)
        for k in range(n + 1):
            expect(dialog.get_by_role("status", name="Replay step")).to_have_text(f"Step {k} of {n}")
            for (r, c), v in steps[k].items():
                expect(grid.locator(f'[data-row="{r}"][data-col="{c}"]')).to_have_attribute("data-value", v)
            if k == 0:
                expect(button(dialog, "Previous step")).to_be_disabled()
                for q in record["initial"]:
                    expect(grid.locator(f'[data-row="{q["row"]}"][data-col="{q["col"]}"]')).to_have_attribute("data-state", q["state"])
            if k < n:
                click(button(dialog, "Next step"))
        expect(button(dialog, "Next step")).to_be_disabled()
        for q in record["final"]:
            cell = grid.locator(f'[data-row="{q["row"]}"][data-col="{q["col"]}"]')
            expect(cell).to_have_attribute("data-state", q["state"])
            if q["owner"]:
                expect(cell).to_have_attribute("data-owner", q["owner"])
        click(button(dialog, "Previous step"))
        expect(dialog.get_by_role("status", name="Replay step")).to_have_text(f"Step {n - 1} of {n}")


def test_wf_history_two_players(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",), squares=mk_fill(skip=((0, 0),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        friend.keyboard.press("s")
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "the friend's letter solved the game")
    game = get_game(a, s.game_id)
    key = f"records/{s.game_id}.json"
    poll(lambda: S3().keys(key) == [key], RECORD_WAIT_S, f"object {key} was written")
    for who in ("a", "b"):
        with as_player(browser, app_url, s.ids[who], "/history") as page:
            page.reload()
            item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text=history_row(game))
            expect(item).to_have_count(1, timeout=READY_MS)
            expect(item).not_to_contain_text("Revealed")
            with page.expect_download() as info:
                click(button(item, "Download solve record"))
            data = Path(info.value.path()).read_bytes()
            assert data == S3().get(key)
            assert json.loads(data)["ops"] == ops_of(a, s.game_id)
    with as_player(browser, app_url, s.ids["c"], "/history") as page:
        expect(page.get_by_text("No finished games yet.", exact=True)).to_be_visible(timeout=READY_MS)


def test_wf_history_wrong_device_clock(browser: Browser, app_url: str) -> None:
    s, game = _solved_game(app_url)
    with as_player(browser, app_url, s.ids["a"], "/history", before=lambda p: p.clock.set_system_time(FAR_CLOCK)) as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text=history_row(game))
        expect(item).to_have_count(1, timeout=READY_MS)


def test_storage_outage(app_url: str) -> None:
    down = down_url()
    health = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    client = _uploader(down)
    assert_error(client.post("/api/puzzles", content=mk_text(fresh_title()).encode()), 503, "storage_unavailable")
    bad, _ = _upload_case("first_line", config(down), fresh_title())
    assert_error(client.post("/api/puzzles", content=bad), 422, "invalid_puzzle")
    assert client.get("/api/puzzles", params={"source": "mine"}).json()["puzzles"] == []
    s, game = _solved_game(down)
    assert game["status"] == "solved" and game["solved_at"]
    a = player_client(down, s.ids["a"])
    entry = next(e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id)
    key = f"records/{s.game_id}.json"
    if entry["record_ready"]:
        assert S3().keys(key) == [key], "record_ready was true but no record object exists"
    else:
        assert_error(a.get(f"/api/history/{s.game_id}/record"), 503, "storage_unavailable")


@pytest.mark.timeout(1200)
def test_storage_recovery_without_restart() -> None:
    endpoint = urlsplit(os.environ["S3_ENDPOINT"])
    relay = Relay((endpoint.hostname, endpoint.port or 80))
    relay.start()
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}", "OVERLAP_GRADING": "1"}) as (base, tail):
            poll(lambda: httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}, SERVER_WAIT_S,
                 "copy reported storage ok through the relay")
            relay.stop()
            poll(lambda: httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "unavailable"}, SERVER_WAIT_S,
                 "copy reported storage unavailable once the relay was cut")
            client = _uploader(base)
            data = mk_text(fresh_title()).encode()
            assert_error(client.post("/api/puzzles", content=data), 503, "storage_unavailable")
            s, _ = _solved_game(base)
            a = player_client(base, s.ids["a"])
            deferred = next(e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id)["record_ready"]
            assert deferred is False or S3().keys(f"records/{s.game_id}.json")
            relay.start()
            created = poll(lambda: (lambda r: r if r.status_code == 201 else None)(client.post("/api/puzzles", content=data)),
                           SERVER_WAIT_S, f"upload succeeded after storage returned; log tail:\n{tail()}")
            pid = created.json()["puzzle"]["id"]
            assert S3().get(f"uploads/{pid}/original.overlap.txt") == data
            assert client.get(f"/api/puzzles/{pid}/original").content == data
            poll(lambda: next(e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id)["record_ready"],
                 RECORD_WAIT_S, "the deferred solve record was written")
            key = f"records/{s.game_id}.json"
            assert S3().keys(key) == [key]
            assert a.get(f"/api/history/{s.game_id}/record").content == S3().get(key)
            assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    finally:
        relay.stop()


def test_wf_storage_outage_upload(browser: Browser, app_url: str) -> None:
    down = down_url()
    title = fresh_title()
    text = mk_text(title)
    with as_player(browser, down, seed_players(down, "a")["a"], "/upload") as page:
        dialog = _open_upload(page)
        fill(dialog.get_by_role("textbox", name="Puzzle text"), text)
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("alert")).to_have_text(
            "Puzzle storage is unreachable right now. Your text is still here; try again in a moment.", timeout=READY_MS)
        expect(dialog.get_by_role("textbox", name="Puzzle text")).to_have_value(text)
        expect(button(dialog, "Upload")).to_be_focused()
        assert page.request.get(down + "/api/puzzles?source=mine").json()["puzzles"] == []
    with as_player(browser, app_url, seed_players(app_url, "a")["a"], "/upload") as page:
        dialog = _open_upload(page)
        fill(dialog.get_by_role("textbox", name="Puzzle text"), text)
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}")
        expect(dialog.get_by_role("alert")).to_have_count(0)
        mine = page.request.get(app_url + "/api/puzzles?source=mine").json()["puzzles"]
    assert [p["title"] for p in mine] == [title]
    assert S3().get(f"uploads/{mine[0]['id']}/original.overlap.txt") == text.encode()


def test_wf_storage_outage_history_pending(browser: Browser) -> None:
    down = down_url()
    s, game = _solved_game(down)
    with as_player(browser, down, s.ids["a"], "/history") as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text="Morning Kettle")
        expect(item).to_have_count(1, timeout=READY_MS)

        poll(lambda: "Solve record pending" in item.inner_text(), SERVER_WAIT_S,
             "history row showed Solve record pending while storage is unreachable")
        expect(button(item, "Download solve record")).to_be_disabled()
        expect(button(item, "Replay")).to_be_disabled()
    entry = next(e for e in player_client(down, s.ids["a"]).get("/api/history").json()["entries"] if e["game_id"] == s.game_id)
    assert entry["record_ready"] is False
    assert entry["game_id"] == s.game_id and game["status"] == "solved"


def test_run_health_config(app_url: str) -> None:
    health = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert media(health.headers["content-type"]) == media(CONTENT_JSON)
    cfg = config(app_url)
    assert set(cfg) == set(DEFAULT_CONFIG)
    assert all(isinstance(v, int) for v in cfg.values())
    assert cfg == DEFAULT_CONFIG
    assert config(short_url()) != cfg


@pytest.mark.timeout(1200)
def test_grading_routes(app_url: str) -> None:
    title = fresh_title()
    text = mk_text(title)
    body = {"players": [{"key": k, "display_name": name_for(k)} for k in "abc"],
            "puzzles": [{"key": "p1", "fixture": MK}, {"key": "p2", "text": text, "owner": "a"}],
            "games": [{"key": "g1", "puzzle": "p1", "host": "a", "players": ["a", "b"],
                       "squares": [seed_sq(0, 0, "S")], "elapsed_ms": 0, "timer_state": "paused"}]}
    out = seed(app_url, body)
    g = out["games"]["g1"]
    assert re.fullmatch(r"[a-z0-9]{12}", g["code"]) and g["url"] == f"/g/{g['code']}"
    a = player_client(app_url, out["players"]["a"]["id"])
    me = a.get("/api/players/me").json()
    assert me == {"id": out["players"]["a"]["id"], "display_name": body["players"][0]["display_name"]}
    game = get_game(a, g["id"])
    assert [p["colour"] for p in game["players"]] == ["Teal", "Coral"] and game["host_player_id"] == me["id"]
    assert (sq_of(game, 0, 0)["value"], sq_of(game, 0, 0)["state"], sq_of(game, 0, 0)["owner"]) == ("S", "filled", "Teal")
    pid = out["puzzles"]["p2"]["id"]
    assert S3().get(f"uploads/{pid}/original.overlap.txt") == text.encode()
    assert a.get(f"/api/puzzles/{pid}").json()["title"] == title
    assert_error(player_client(app_url, out["players"]["c"]["id"]).get(f"/api/puzzles/{pid}"), 404, "not_found")
    assert_error(anonymous(app_url).post("/api/grading/session", json={"player_id": str(uuid.uuid4())}), 404, "not_found")
    broken = {"players": [{"key": "a", "display_name": name_for("a")}, {"key": "b", "display_name": name_for("b")}],
              "puzzles": [{"key": "p", "fixture": MK}], "games": [{"key": "g", "puzzle": "p", "host": "b", "players": ["a"]}]}
    assert_error(httpx.post(app_url + "/api/grading/seed", json=broken, timeout=HTTP_TIMEOUT), 422, "invalid")
    with app_copy({}, drop=("OVERLAP_GRADING",)) as (base, _tail):
        assert httpx.post(base + "/api/grading/seed", json={"players": []}, timeout=HTTP_TIMEOUT).status_code == 404
        assert httpx.post(base + "/api/grading/session", json={"player_id": me["id"]}, timeout=HTTP_TIMEOUT).status_code == 404


@pytest.mark.parametrize("case", list(PRECEDENCE), ids=list(PRECEDENCE))
def test_error_shape_precedence(app_url: str, case: str) -> None:
    status, code = PRECEDENCE[case]
    s = seed_game(app_url, members=("a", "b"), outsiders=("c",))
    host, friend, stranger = (player_client(app_url, s.ids[k]) for k in "abc")
    friend.post(f"/api/links/{s.code}/join", json={})
    if case == "too_large_before_no_player":
        padded = '{"puzzle_id":"x"' + " " * JSON_LIMIT + "}"
        response = anonymous(app_url).post("/api/games", content=padded, headers={"content-type": "application/json"})
    elif case == "no_player":
        response = anonymous(app_url).get(f"/api/games/{s.game_id}")
    elif case == "unknown_route":
        response = host.get("/api/no-such-route")
    elif case == "unknown_game":
        response = host.get(f"/api/games/{uuid.uuid4()}")
    elif case == "private_puzzle":
        pid = host.post("/api/puzzles", content=mk_text(fresh_title()).encode()).json()["puzzle"]["id"]
        response = stranger.get(f"/api/puzzles/{pid}")
    elif case == "not_found_before_invalid":
        response = host.post(f"/api/games/{uuid.uuid4()}/ops", json={"type": "nonsense"})
    elif case == "not_host":
        response = friend.post(f"/api/games/{s.game_id}/link/replace", json={})
    else:
        response = host.post("/api/games", json={})
    body = assert_error(response, status, code)
    if status == 422:
        assert isinstance(body.get("fields"), dict) and body["fields"]


def test_server_boundary(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, outsiders=("c",))
    host = player_client(app_url, s.ids["a"])
    cookie = host.cookies.get("overlap_player")
    path = f"/api/games/{s.game_id}/live"
    assert raw_upgrade(app_url, path, origin=FOREIGN_ORIGIN, cookie=cookie) == 403
    assert raw_upgrade(app_url, path, cookie=player_client(app_url, s.ids["c"]).cookies.get("overlap_player")) == 404
    probe = httpx.get(app_url + "/api/health", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_TIMEOUT)
    assert not [h for h in probe.headers if h.lower().startswith("access-control-")]
    exact = '{"display_name":"Ada"' + " " * (JSON_LIMIT - len('{"display_name":"Ada"}')) + "}"
    assert len(exact.encode()) == JSON_LIMIT
    assert anonymous(app_url).post("/api/players", content=exact, headers={"content-type": "application/json"}).status_code == 201
    assert_error(anonymous(app_url).post("/api/players", content=exact + " ", headers={"content-type": "application/json"}), 413, "too_large")
    for leaked in LEAK_PROBES:
        assert httpx.get(app_url + leaked, timeout=HTTP_TIMEOUT).status_code == 404, leaked
    assert raw_get(app_url, "/../run.json") == 404
    secrets = [v for v in (os.environ.get("S3_SECRET_ACCESS_KEY"), os.environ.get("S3_ACCESS_KEY_ID"),
                           urlsplit(os.environ.get("DATABASE_URL", "")).password) if v]
    assert secrets, "the verifier needs the service credentials in its environment"
    bodies: list[bytes] = []

    def collect(response: Any) -> None:
        if same_origin(response.url, app_url) and response.ok:
            with contextlib.suppress(Exception):
                bodies.append(response.body())

    with as_player(browser, app_url, s.ids["a"], "/api/health") as page:
        page.on("response", collect)
        for target in ("/", "/puzzles", s.room):
            page.goto(app_url + target)
            page.wait_for_load_state("load")
        assert live_open(page, s.game_id, "big") == "open"
        page.evaluate("([k, n]) => window.__live[k].ws.send(JSON.stringify({type: 'cursor', row: 0, col: 0, direction: 'across', pad: 'x'.repeat(n)}))",
                      ["big", LIVE_FRAME_LIMIT])
        until(page, "(k) => window.__live[k].rec.closed !== null", "big")
        assert live_rec(page, "big")["closed"] == TOO_BIG_CLOSE
    for body in bodies:
        for secret in secrets:
            assert secret.encode() not in body


def test_board_filters(browser: Browser, app_url: str) -> None:
    ids = seed_players(app_url, "a", "c")
    a = player_client(app_url, ids["a"])
    t1, t2 = fresh_title(), fresh_title()
    p1 = a.post("/api/puzzles", content=mk_text(t1).encode()).json()["puzzle"]["id"]
    a.post("/api/puzzles", content=mk_text(t2).encode())
    assert [p["title"] for p in a.get("/api/puzzles").json()["puzzles"]] == LIBRARY_TITLES + [t2, t1]
    assert [p["title"] for p in a.get("/api/puzzles", params={"source": "library"}).json()["puzzles"]] == LIBRARY_TITLES
    assert [p["title"] for p in a.get("/api/puzzles", params={"source": "mine"}).json()["puzzles"]] == [t2, t1]
    assert "size" in assert_error(a.get("/api/puzzles", params={"size": "huge"}), 422, "invalid")["fields"]
    assert "source" in assert_error(a.get("/api/puzzles", params={"source": "theirs"}), 422, "invalid")["fields"]
    game_id = a.post("/api/games", json={"puzzle_id": p1}).json()["id"]
    in_progress = f"In progress with {1}"
    token = marker()
    with as_player(browser, app_url, ids["a"], "/puzzles") as board:
        expect(button(board, f"Start {t1}")).to_be_visible(timeout=READY_MS)
        board.evaluate("(t) => { window.__overlapMarker = t; }", token)
        before = board.url
        mine = button(board, "Mine")
        click(mine)
        expect(mine).to_have_attribute("aria-pressed", "true")
        expect(board).not_to_have_url(before)
        expect(button(board, "Start Morning Kettle")).to_have_count(0)
        assert board.evaluate("() => window.__overlapMarker") == token
        expect(board.get_by_text(in_progress, exact=True)).to_have_count(0)
        with as_player(browser, app_url, ids["a"], f"/games/{game_id}") as room:
            ready(room)
            poll(lambda: next(p for p in a.get("/api/puzzles", params={"source": "mine"}).json()["puzzles"] if p["id"] == p1)["in_progress"] == 1,
                 SERVER_WAIT_S, "in_progress counted the open live connection")
            advance(board, BOARD_REFRESH_MS)
            expect(board.get_by_text(in_progress, exact=True)).to_have_count(1)
        board.reload()
        expect(button(board, "Mine")).to_have_attribute("aria-pressed", "true", timeout=READY_MS)
        expect(button(board, "Start Morning Kettle")).to_have_count(0)
    with as_player(browser, app_url, ids["c"], "/puzzles") as other:
        click(button(other, "Mine"))
        expect(other.get_by_text("No puzzles match these filters.", exact=True)).to_be_visible()


def test_dialogs_menus_shortcuts(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        share = button(page, "Share")
        click(share)
        dialog = page.get_by_role("dialog", name="Share game")
        expect(dialog.get_by_role("textbox", name="Game link")).to_be_focused()
        names = set(tab_order(page, 8))
        assert names <= {"Game link", "Copy link", "Turn off link", "Replace link", "Close"}, names
        page.keyboard.press("Alt+KeyC")
        expect(page.get_by_role("menu", name="Check")).to_have_count(0)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(share).to_be_focused()
        page.keyboard.press("Alt+KeyC")
        expect(page.get_by_role("menu", name="Check").get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(button(page, "Check")).to_be_focused()
        button(page, "Pause my timer").focus()
        page.keyboard.press("Alt+KeyR")
        expect(page.get_by_role("menu", name="Reveal")).to_be_visible()
        page.keyboard.press("Escape")
        click(square(page, 0, 0))
        page.keyboard.press("Insert")
        page.keyboard.press("Alt+KeyC")
        expect(page.get_by_role("menu", name="Check")).to_have_count(0)
        expect(page.get_by_role("textbox", name="Rebus entry")).to_be_focused()


@pytest.mark.parametrize("mode", ["no-preference", "reduce"], ids=["motion", "reduced"])
def test_pivot_band_motion(browser: Browser, app_url: str, mode: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, reduced=mode) as page:
        grid = ready(page)
        page.keyboard.press("Space")
        expect(grid).to_have_attribute("data-direction", "down")
        expect(clue_item(page, "down", 1)).to_have_attribute("aria-current", "true")
        expect(clue_bar(page)).to_have_text(bar_text(1, "down"), use_inner_text=True)
        phases = [grid.get_attribute("data-pivot")]
        for _ in range(PIVOT_WINDOW_STEPS):
            advance(page, PIVOT_STEP_MS)
            phases.append(grid.get_attribute("data-pivot"))
        if mode == "reduce":
            assert set(phases) == {"idle"}, phases
            assert animations(grid) == []
        else:
            runs = [p for i, p in enumerate(phases) if i == 0 or phases[i - 1] != p]
            while runs and runs[0] == "idle":
                runs.pop(0)
            assert runs == ["shrink", "grow", "idle"], runs
            assert phases.count("shrink") < phases.count("grow")
            page.keyboard.press("Space")
            for _ in range(PIVOT_WINDOW_STEPS):
                if grid.get_attribute("data-pivot") == "grow":
                    break
                advance(page, PIVOT_STEP_MS)
            page.keyboard.press("Space")
            advance(page, FRAME_MS)
            expect(grid).to_have_attribute("data-pivot", "shrink")
            expect(grid).to_have_attribute("data-direction", "down")
    lt = seed_game(app_url, fixture=LT)
    with as_player(browser, app_url, lt.ids["a"], lt.room, reduced=mode) as page:
        ready(page)
        page.keyboard.press("Shift+Tab")
        active = page.get_by_role("list", name="Down clues").get_by_role("listitem").and_(page.locator('[aria-current="true"]'))
        expect(active).to_have_count(1)
        distance = """(item) => { let box = item.parentElement;
          while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
          if (!box) return 0;
          const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
          const want = Math.max(0, Math.min(top - box.clientHeight / 3, box.scrollHeight - box.clientHeight));
          return Math.abs(box.scrollTop - want); }"""
        advance(page, FRAME_MS)
        if mode == "reduce":
            assert active.evaluate(distance) <= PX_TOLERANCE
            return
        for _ in range(SCROLL_WINDOW_STEPS):
            if active.evaluate(distance) <= PX_TOLERANCE:
                return
            advance(page, SCROLL_STEP_MS)
        pytest.fail("the active clue never settled one third down its list")


def _lockfile() -> dict:
    lock = Path("/app/package-lock.json")
    return json.loads(lock.read_text()) if lock.exists() else {}


def _own_files() -> Iterator[Path]:
    skip = {"node_modules", "dist", "build", ".git"}
    for dirpath, dirnames, filenames in os.walk("/app"):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for name in filenames:
            yield Path(dirpath, name)


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices_text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices_text]
    assert not missing, missing
    assert "Albert Sans" in notices_text


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastores() -> None:
    banned = "SQLite".lower()
    assert not [p.name for p in shipped_packages() if banned in p.name.lower()]
    found = [str(f) for f in _own_files() if banned in f.name.lower()]
    assert not found, found


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    foreign: list[str] = []
    with as_player(browser, app_url, s.ids["a"], "/api/health") as page:
        page.on("request", lambda r: foreign.append(r.url) if r.url.startswith(("http", "ws")) and not same_origin(r.url, app_url) else None)
        for target in ("/", "/puzzles", s.room):
            page.goto(app_url + target)
            page.wait_for_load_state("load")
    assert not foreign, foreign


def test_if_typescript_lockfile() -> None:
    lock = _lockfile()
    assert lock, "package-lock.json is missing or empty"
    root = lock.get("packages", {}).get("", {})
    declared = {**root.get("dependencies", {}), **root.get("devDependencies", {})}
    assert "TypeScript".lower() in declared
    assert [f for f in _own_files() if f.suffix in (".ts", ".tsx") and not f.name.endswith(".d.ts")]


def test_if_credentials_from_environment() -> None:
    secrets = [v for v in (os.environ.get("S3_SECRET_ACCESS_KEY"), urlsplit(os.environ.get("DATABASE_URL", "")).password) if v]
    assert secrets, "the verifier needs the service credentials in its environment"
    for source in _own_files():
        if source.suffix in (".ts", ".tsx", ".js", ".mjs"):
            text = source.read_text(errors="ignore")
            assert not [s for s in secrets if s in text], str(source)


def test_wf_same_square_pencil_over_pen(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, 0, "S")])
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(friend, 0, 1)
        friend.keyboard.press("ArrowLeft")
        at(friend, 0, 0)
        friend.keyboard.press(".")
        expect(button(friend, "Pencil")).to_have_attribute("aria-pressed", "true")
        friend.keyboard.press("t")
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "T", PENCIL_MARK))
        expect(square(host, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "T", PENCIL_MARK), timeout=LIVE_MS)
        expect(square(host, 0, 0)).to_have_attribute("data-owner", "Coral")
        expect(square(host, 0, 0)).to_have_attribute("data-state", "pencil")
        at(host, 0, 1)
        host.keyboard.press("ArrowLeft")
        at(host, 0, 0)
        host.keyboard.press("s")
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"), timeout=LIVE_MS)
        expect(square(friend, 0, 0)).to_have_attribute("data-owner", "Teal")
        expect(square(friend, 0, 0)).to_have_attribute("data-state", "filled")
    stored = sq_of(get_game(a, s.game_id), 0, 0)
    assert (stored["value"], stored["pencil"], stored["owner"]) == ("S", False, "Teal")


def test_wf_check_reveal_menu_keys(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, 0, "S")])
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(host, 0, 1)
        host.keyboard.press(".")
        host.keyboard.press("x")
        host.keyboard.press(".")
        expect(button(host, "Pencil")).to_have_attribute("aria-pressed", "false")
        host.keyboard.press("Alt+KeyC")
        menu = host.get_by_role("menu", name="Check")
        item = lambda name: menu.get_by_role("menuitem", name=name, exact=True)
        expect(item("Square")).to_be_focused()
        host.keyboard.press("ArrowUp")
        expect(item("Puzzle")).to_be_focused()
        host.keyboard.press("Home")
        expect(item("Square")).to_be_focused()
        host.keyboard.press("End")
        expect(item("Puzzle")).to_be_focused()
        host.keyboard.press("ArrowDown")
        expect(item("Square")).to_be_focused()
        host.keyboard.press("ArrowDown")
        expect(item("Word")).to_be_focused()
        host.keyboard.press("Space")
        expect(grid_of(host)).to_be_focused()
        expect(announcements(host)).to_have_text(wrong_in(1, "word"))
        expect(square(friend, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "X", PENCIL_MARK + WRONG_MARK), timeout=LIVE_MS)
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", RIGHT_MARK), timeout=LIVE_MS)
        host.keyboard.press("Alt+KeyC")
        expect(item("Square")).to_be_focused()
        host.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(button(host, "Check")).to_be_focused()
        host.keyboard.press("Alt+KeyR")
        reveal = host.get_by_role("menu", name="Reveal")
        expect(reveal.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        host.keyboard.press("Tab")
        expect(reveal).to_be_hidden()
        expect(button(host, "Reveal")).to_be_focused()
    game = get_game(a, s.game_id)
    assert game["checked_count"] == 1 and game["revealed_count"] == 0
    assert (sq_of(game, 0, 1)["state"], sq_of(game, 0, 1)["pencil"]) == ("wrong", True)
    assert sq_of(game, 0, 0)["state"] == "right"


def test_wf_solved_dialog_focus_trap(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((2, 4),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(host, 2, 4)
        host.keyboard.press("t")
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "the last letter solved the game")
        game = get_game(a, s.game_id)
        expect(announcements(friend)).to_have_text(f"Puzzle solved in {fmt(game['elapsed_ms'])}", timeout=LIVE_MS)
        dialog = friend.get_by_role("dialog", name="Puzzle solved")
        expect(dialog.get_by_role("heading")).to_be_focused()
        inside = "d => d.contains(document.activeElement)"
        for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            friend.keyboard.press(key)
            assert dialog.evaluate(inside), f"{key} moved focus out of the Puzzle solved dialog"
        close = button(dialog, "Close")
        for _ in range(3):
            if close.evaluate("e => e === document.activeElement"):
                break
            friend.keyboard.press("Tab")
        expect(close).to_be_focused()
        friend.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(grid_of(friend)).to_be_focused()
        expect(timer_of(friend)).to_have_attribute("data-timer-state", "solved")
        host.keyboard.press("Escape")
        expect(host.get_by_role("dialog", name="Puzzle solved")).to_be_hidden()
        expect(grid_of(host)).to_be_focused()
    assert get_game(a, s.game_id)["seq"] == game["seq"]


def test_wf_solved_phone_touch(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((4, 4),)))
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["b"], s.room, viewport=PHONE) as page:
        ready(page)
        at(page, 4, 4)
        keys = page.get_by_role("group", name="Letter keyboard")
        tap(button(keys, "R"))
        dialog = page.get_by_role("dialog", name="Puzzle solved")
        expect(dialog).to_be_visible(timeout=LIVE_MS)
        poll(lambda: get_game(a, s.game_id)["status"] == "solved", SERVER_WAIT_S, "the tapped letter solved the game")
        game = get_game(a, s.game_id)
        expect(dialog.get_by_role("heading")).to_have_text(f"Solved in {fmt(game['elapsed_ms'])}")
        expect(dialog).to_contain_text("No squares revealed")
        layout(page)
        tap(button(dialog, "Close"))
        expect(dialog).to_be_hidden()
        expect(grid_of(page)).to_be_focused()
        tap(button(keys, "X"))
        expect(notices(page)).to_have_text("This puzzle is already solved.")
        expect(timer_of(page)).to_have_attribute("data-timer-state", "solved")
    after = get_game(a, s.game_id)
    assert after["seq"] == game["seq"] and sq_of(after, 4, 4)["value"] == "R"


def test_wf_announcements_tab_and_clue_click(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        region = announcements(page)
        expect(region).to_have_text(spoken(1, "across"))
        page.keyboard.press("ArrowRight")
        at(page, 0, 1)
        expect(region).to_have_text(spoken(1, "across"))
        page.keyboard.press("Tab")
        at(page, 2, 0)
        expect(region).to_have_text(spoken(4, "across"))
        page.keyboard.press("Shift+Tab")
        at(page, 0, 0)
        expect(region).to_have_text(spoken(1, "across"))
        page.keyboard.press("Shift+Tab")
        at(page, 0, 4)
        expect(region).to_have_text(spoken(3, "down"))
        expect(square(page, 0, 4)).to_have_accessible_name(mk(0, 4, "down", EMPTY))
        click(clue_item(page, "down", 2))
        at(page, 0, 2)
        expect(region).to_have_text(spoken(2, "down"))
        expect(clue_item(page, "down", 2)).to_have_attribute("aria-current", "true")


def test_wf_upload_dialog_keyboard(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    bad, expected = _upload_case("first_line", config(app_url), title)
    with as_player(browser, app_url, owner, "/upload") as page:
        opener = button(page, "Upload puzzle")
        expect(opener).to_be_visible(timeout=READY_MS)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Upload a puzzle")
        expect(dialog).to_be_visible()
        inside = "d => d.contains(document.activeElement)"
        assert dialog.evaluate(inside), "opening the dialog did not move focus into it"
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dialog.evaluate(inside), f"{key} moved focus out of the upload dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        dialog.get_by_role("textbox", name="Puzzle text").focus()
        page.keyboard.insert_text(bad.decode())
        button(dialog, "Upload").focus()
        page.keyboard.press("Enter")
        heading = dialog.get_by_role("heading", name=problems(1))
        expect(heading).to_be_focused()
        expect(dialog.get_by_role("list", name="Upload errors").get_by_role("listitem")).to_have_text(expected)
        assert page.request.get(app_url + "/api/puzzles?source=mine").json()["puzzles"] == []


def test_wf_upload_edit_after_file(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    chosen, edited_title = fresh_title(), fresh_title()
    edited = mk_text(edited_title)
    with as_player(browser, app_url, owner, "/upload") as page:
        dialog = _open_upload(page)
        dialog.get_by_label("Puzzle file").set_input_files(
            {"name": "kettle.overlap.txt", "mimeType": "text/plain", "buffer": mk_text(chosen).encode()})
        box = dialog.get_by_role("textbox", name="Puzzle text")
        expect(box).to_have_value(re.compile(re.escape(chosen)))
        fill(box, edited)
        button(dialog, "Upload").focus()
        page.keyboard.press("Enter")
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {edited_title}")
        button(dialog, "Start a room with this puzzle").focus()
        page.keyboard.press("Enter")
        ready(page)
        mine = page.request.get(app_url + "/api/puzzles?source=mine").json()["puzzles"]
    assert [p["title"] for p in mine] == [edited_title]
    assert S3().get(f"uploads/{mine[0]['id']}/original.overlap.txt") == edited.encode()


def test_wf_history_replay_keyboard(browser: Browser, app_url: str) -> None:
    s, game = _solved_game(app_url)
    a = player_client(app_url, s.ids["a"])
    poll(lambda: next((e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id and e["record_ready"]), None),
         RECORD_WAIT_S, "history entry reported record_ready")
    record = a.get(f"/api/history/{s.game_id}/record").json()
    n = len(record["ops"])
    final = {(q["row"], q["col"]): q for q in record["final"]}
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text=history_row(game))
        expect(item).to_have_count(1, timeout=READY_MS)
        expect(item).to_contain_text(revealed_phrase(1))
        replay = button(item, "Replay")
        replay.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Replay")
        step = dialog.get_by_role("status", name="Replay step")
        expect(step).to_have_text(f"Step 0 of {n}")
        expect(button(dialog, "Previous step")).to_be_disabled()
        grid = dialog.get_by_role("group", name="Replay grid")
        corner = grid.locator(f'[data-row="{0}"][data-col="{0}"]')
        expect(corner).to_have_attribute("data-value", "")
        for k in range(1, n + 1):
            button(dialog, "Next step").focus()
            page.keyboard.press("Enter")
            expect(step).to_have_text(f"Step {k} of {n}")
        expect(button(dialog, "Next step")).to_be_disabled()
        for (r, c), q in final.items():
            expect(grid.locator(f'[data-row="{r}"][data-col="{c}"]')).to_have_attribute("data-value", q["value"])
        expect(corner).to_have_attribute("data-owner", "Coral")
        button(dialog, "Previous step").focus()
        page.keyboard.press("Enter")
        expect(step).to_have_text(f"Step {n - 1} of {n}")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(replay).to_be_focused()


def test_wf_storage_outage_keyboard_retry(browser: Browser) -> None:
    down = down_url()
    health = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert (health.status_code, health.json()) == (200, {"status": "unavailable"})
    text = mk_text(fresh_title())
    with as_player(browser, down, seed_players(down, "a")["a"], "/upload") as page:
        opener = button(page, "Upload puzzle")
        expect(opener).to_be_visible(timeout=READY_MS)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Upload a puzzle")
        dialog.get_by_role("textbox", name="Puzzle text").focus()
        page.keyboard.insert_text(text)
        upload = button(dialog, "Upload")
        upload.focus()
        sentence = "Puzzle storage is unreachable right now. Your text is still here; try again in a moment."
        for _ in range(2):
            with page.expect_response(lambda r: urlsplit(r.url).path == "/api/puzzles" and r.request.method == "POST") as sent:
                page.keyboard.press("Enter")
            assert sent.value.status == 503
            expect(dialog.get_by_role("alert")).to_have_text(sentence, timeout=READY_MS)
            expect(upload).to_be_focused()
            expect(dialog.get_by_role("textbox", name="Puzzle text")).to_have_value(text)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert page.request.get(down + "/api/puzzles?source=mine").json()["puzzles"] == []


def test_wf_storage_outage_phone_upload(browser: Browser) -> None:
    down = down_url()
    text = mk_text(fresh_title())
    with as_player(browser, down, seed_players(down, "a")["a"], "/history", viewport=PHONE) as page:
        menu_button = button(page, "Menu")
        expect(menu_button).to_be_visible(timeout=READY_MS)
        tap(menu_button)
        tap(page.get_by_role("dialog", name="Menu").get_by_role("link", name="Upload", exact=True))
        expect(page.get_by_role("dialog", name="Menu")).to_be_hidden(timeout=READY_MS)
        opener = button(page, "Upload puzzle")
        expect(opener).to_be_visible(timeout=READY_MS)
        tap(opener)
        dialog = page.get_by_role("dialog", name="Upload a puzzle")
        expect(dialog).to_be_visible()
        box = dialog.get_by_role("textbox", name="Puzzle text")
        tap(box)
        box.fill(text)
        tap(button(dialog, "Upload"))
        alert = dialog.get_by_role("alert")
        expect(alert).to_have_text(
            "Puzzle storage is unreachable right now. Your text is still here; try again in a moment.", timeout=READY_MS)
        expect(box).to_have_value(text)
        layout(page)
        assert page.request.get(down + "/api/puzzles?source=mine").json()["puzzles"] == []


def test_wf_storage_outage_file_choice(browser: Browser) -> None:
    down = down_url()
    title = fresh_title()
    data = mk_text(title).encode()
    with as_player(browser, down, seed_players(down, "a")["a"], "/upload") as page:
        dialog = _open_upload(page)
        dialog.get_by_label("Puzzle file").set_input_files({"name": "kettle.overlap.txt", "mimeType": "text/plain", "buffer": data})
        box = dialog.get_by_role("textbox", name="Puzzle text")
        expect(box).to_have_value(re.compile(re.escape(title)))
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("alert")).to_have_text(
            "Puzzle storage is unreachable right now. Your text is still here; try again in a moment.", timeout=READY_MS)
        expect(button(dialog, "Upload")).to_be_focused()
        expect(box).to_have_value(re.compile(re.escape(title)))
        inside = "d => d.contains(document.activeElement)"
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert dialog.evaluate(inside), f"{key} moved focus out of the upload dialog"
        assert page.request.get(down + "/api/puzzles?source=mine").json()["puzzles"] == []


DEFAULT_SETTINGS = {"skip_filled": True, "jump_next_clue": False, "autocheck": False}
REPLAY_STEP_MS = 500
RACE_EMPTY_TEAM = "Each team needs at least one player."
RACE_NOT_STARTED = "The race has not started."
LOCKED_NOTICE = "That square is locked."
BUILDER_OUTAGE = "Puzzle storage is unreachable right now. Your grid is still here; try again in a moment."
REF_ACROSS = {1: "*Crumbly bake served with jam", 4: "Push the tape out, see 1 and 3-Down", 5: "One who hoards every coin"}
REF_DOWN = {1: "What rises from a kettle spout", 2: "Theme of the starred clues", 3: "*Step inside, or key in data"}


def ref_text(across: dict = REF_ACROSS, down: dict = REF_DOWN, title: str = "Linked Kettle") -> str:
    lines = ["Overlap 1", f"Title: {title}", "Author: Wren Halloway", "Size: 5x5", "", "Grid:", *MK_ROWS, "", "Across:"]
    lines += [f"{n}. {t}" for n, t in across.items()] + ["", "Down:"] + [f"{n}. {t}" for n, t in down.items()]
    return "\n".join(lines) + "\n"


def seed_custom(base: str, members: tuple = ("a",), outsiders: tuple = (), puzzle: dict | None = None,
                settings: dict | None = None, **game: Any) -> Seeded:
    keys = list(members) + [k for k in outsiders if k not in members]
    players = []
    for k in keys:
        entry = {"key": k, "display_name": name_for(k)}
        if settings and k in settings:
            entry["settings"] = {**DEFAULT_SETTINGS, **settings[k]}
        players.append(entry)
    body = {"players": players, "puzzles": [puzzle or {"key": "p", "fixture": MK}],
            "games": [{"key": "g", "puzzle": "p", "host": members[0], "players": list(members), "squares": [],
                       "elapsed_ms": 0, "timer_state": "paused", **game}]}
    return Seeded(seed(base, body))


def settings_of(client: httpx.Client) -> dict:
    response = client.get("/api/players/me/settings")
    assert response.status_code == 200, response.text
    return response.json()


def put_settings(client: httpx.Client, **values: bool) -> httpx.Response:
    return client.put("/api/players/me/settings", json={**DEFAULT_SETTINGS, **values})


def clear_op(client: httpx.Client, game_id: str, scope: str, row: int | None = None, col: int | None = None,
             direction: str | None = None) -> httpx.Response:
    return act(client, game_id, "clear", scope, row, col, direction)


def cleared_phrase(n: int) -> str:
    return "Nothing to clear" if n == 0 else ("Cleared 1 square" if n == 1 else f"Cleared {n} squares")


def count_phrase(n: int) -> str:
    return "1 square" if n == 1 else f"{n} squares"


def team_scores(a: int, b: int) -> str:
    return f"Team 1 {a} · Team 2 {b}"


def mk_puzzle_id(client: httpx.Client) -> str:
    puzzles = client.get("/api/puzzles", params={"source": "library"}).json()["puzzles"]
    return next(p["id"] for p in puzzles if p["fixture"] == MK)


def white_squares(rows: list) -> list[tuple[int, int]]:
    return [(r, c) for r, row in enumerate(rows) for c, ch in enumerate(row) if ch != "#"]


def race_sq(row: int, col: int, value: str, owner: str, team: int | None = None, state: str = "filled") -> dict:
    sq = seed_sq(row, col, value, state=state, owner=owner)
    if team is not None:
        sq["team"] = team
    return sq


def open_settings(page: Page) -> Locator:
    click(button(page, "Settings"))
    dialog = page.get_by_role("dialog", name="Solving settings")
    expect(dialog).to_be_visible()
    return dialog


def linked(page: Page) -> Locator:
    return grid_of(page).locator('[data-linked="true"]')


def linked_items(page: Page) -> Locator:
    return page.get_by_role("list", name=re.compile(r"^(Across|Down) clues$")).locator('[data-linked="true"]')


def ref_item(page: Page, direction: str, number: int) -> Locator:
    text = (REF_ACROSS if direction == "across" else REF_DOWN)[number]
    return page.get_by_role("list", name=f"{direction.title()} clues").get_by_role("listitem", name=f"{number} {text}", exact=True)


def ref_spoken(number: int, direction: str, links: list[tuple[int, str]]) -> str:
    text = (REF_ACROSS if direction == "across" else REF_DOWN)[number]
    base = f"{number} {direction.title()}: {text}. 5 letters."
    if not links:
        return base
    names = [f"{n} {d.title()}" for n, d in links]
    joined = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return f"{base} Linked to {joined}."


def test_solving_settings_dialog(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, outsiders=("c",))
    a = player_client(app_url, s.ids["a"])
    assert settings_of(a) == DEFAULT_SETTINGS
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        dialog = open_settings(page)
        skip = dialog.get_by_role("checkbox", name="Skip filled squares", exact=True)
        jump = dialog.get_by_role("checkbox", name="Jump to the next clue", exact=True)
        auto = dialog.get_by_role("checkbox", name="Autocheck my letters", exact=True)
        expect(skip).to_be_checked()
        expect(jump).not_to_be_checked()
        expect(auto).not_to_be_checked()
        skip.focus()
        page.keyboard.press("Space")
        expect(skip).not_to_be_checked()
        poll(lambda: settings_of(a)["skip_filled"] is False, SERVER_WAIT_S, "unchecking Skip filled squares saved at once")
        jump.focus()
        page.keyboard.press("Space")
        expect(jump).to_be_checked()
        poll(lambda: settings_of(a) == {"skip_filled": False, "jump_next_clue": True, "autocheck": False},
             SERVER_WAIT_S, "checking Jump to the next clue saved at once")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(button(page, "Settings")).to_be_focused()
        click(square(page, 4, 0))
        at(page, 4, 0)
        for letter in "miser":
            page.keyboard.press(letter)
        at(page, 0, 0)
        expect(grid_of(page)).to_have_attribute("data-direction", "down")
        page.reload()
        ready(page)
        dialog = open_settings(page)
        expect(dialog.get_by_role("checkbox", name="Skip filled squares", exact=True)).not_to_be_checked()
        expect(dialog.get_by_role("checkbox", name="Jump to the next clue", exact=True)).to_be_checked()
    with as_player(browser, app_url, s.ids["a"], s.room) as fresh:
        ready(fresh)
        dialog = open_settings(fresh)
        expect(dialog.get_by_role("checkbox", name="Skip filled squares", exact=True)).not_to_be_checked()
        expect(dialog.get_by_role("checkbox", name="Autocheck my letters", exact=True)).not_to_be_checked()
    c = player_client(app_url, s.ids["c"])
    assert settings_of(c) == DEFAULT_SETTINGS
    body = assert_error(c.put("/api/players/me/settings", json={"jump_next_clue": True, "autocheck": False}), 422, "invalid")
    assert list(body["fields"]) == ["skip_filled"]
    body = assert_error(c.put("/api/players/me/settings", json={"skip_filled": True, "jump_next_clue": "yes", "autocheck": 1}), 422, "invalid")
    assert list(body["fields"]) == ["jump_next_clue"]
    assert settings_of(c) == DEFAULT_SETTINGS
    stored = put_settings(c, autocheck=True)
    assert stored.status_code == 200 and stored.json() == {**DEFAULT_SETTINGS, "autocheck": True}
    assert settings_of(player_client(app_url, s.ids["c"]))["autocheck"] is True
    assert_error(anonymous(app_url).get("/api/players/me/settings"), 401, "no_player")


def test_wf_keyboard_solving_settings_cursor(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, settings={"a": {"skip_filled": False, "jump_next_clue": True}})
    a = player_client(app_url, s.ids["a"])
    assert write(a, s.game_id, 0, 2, "O").status_code == 200
    assert act(a, s.game_id, "reveal", "square", 2, 1).status_code == 200
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        at(page, 0, 0)
        paced(page, "s")
        at(page, 0, 1)
        paced(page, "c")
        at(page, 0, 2)
        paced(page, "o")
        at(page, 0, 3)
        paced(page, "n")
        at(page, 0, 4)
        paced(page, "e")
        at(page, 2, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        expect(announcements(page)).to_have_text(spoken(4, "across"))
        paced(page, "e")
        at(page, 2, 1)
        paced(page, "x")
        expect(notices(page)).to_have_text(LOCKED_NOTICE)
        at(page, 2, 2)
        expect(square(page, 2, 1)).to_have_accessible_name(mk(2, 1, "across", "J", REVEALED_MARK))
        paced(page, "ect")
        at(page, 4, 0)
        paced(page, "miser")
        at(page, 1, 0)
        expect(grid).to_have_attribute("data-direction", "down")
        expect(announcements(page)).to_have_text(spoken(1, "down"))
    poll(lambda: all("".join(sq_of(get_game(a, s.game_id), r, c)["value"] for c in range(5)) == MK_ROWS[r] for r in (0, 2, 4)),
         SERVER_WAIT_S, "the typed words were stored")
    assert sq_of(get_game(a, s.game_id), 2, 1)["state"] == "revealed"


def test_autocheck_rules(app_url: str) -> None:
    s = seed_custom(app_url, members=("a", "b"), settings={"a": {"autocheck": True}})
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    right = write(a, s.game_id, 0, 0, "s")
    assert right.status_code == 200, right.text
    assert (right.json()["type"], right.json()["value"], right.json()["state"], right.json()["autocheck"]) == ("cell", "S", "right", True)
    wrong = write(a, s.game_id, 0, 1, "X").json()
    assert (wrong["state"], wrong["autocheck"]) == ("wrong", True)
    plain = write(b, s.game_id, 0, 2, "Q").json()
    assert (plain["state"], plain["autocheck"]) == ("filled", False)
    assert_error(write(b, s.game_id, 0, 0, "T"), 409, "square_locked")
    fixed = write(a, s.game_id, 0, 1, "C").json()
    assert (fixed["state"], fixed["autocheck"]) == ("right", True)
    assert put_settings(a, autocheck=False).status_code == 200
    later = write(a, s.game_id, 0, 3, "Z").json()
    assert (later["state"], later["autocheck"]) == ("filled", False)
    game = get_game(b, s.game_id)
    assert game["checked_count"] == 0
    assert [(sq_of(game, 0, c)["value"], sq_of(game, 0, c)["state"]) for c in range(4)] == [
        ("S", "right"), ("C", "right"), ("Q", "filled"), ("Z", "filled")]
    cells = [op for op in ops_of(a, s.game_id) if op["type"] == "cell"]
    assert [(op["value"], op["state"], op["autocheck"]) for op in cells] == [
        ("S", "right", True), ("X", "wrong", True), ("Q", "filled", False), ("C", "right", True), ("Z", "filled", False)]


def test_wf_check_reveal_autocheck_two_players(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, members=("a", "b"), settings={"a": {"autocheck": True}})
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        friend.keyboard.press("Tab")
        at(friend, 2, 0)
        host.keyboard.press("s")
        host.keyboard.press("x")
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", RIGHT_MARK), timeout=LIVE_MS)
            expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "X", WRONG_MARK), timeout=LIVE_MS)
        friend.keyboard.press("e")
        for page in (host, friend):
            expect(square(page, 2, 0)).to_have_attribute("data-state", "filled", timeout=LIVE_MS)
        menu_action(friend, "Check", "Word")
        expect(announcements(friend)).to_have_text(no_errors("word"))
        expect(square(host, 2, 0)).to_have_attribute("data-state", "right", timeout=LIVE_MS)
        at(host, 0, 2)
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert game["checked_count"] == 1
    assert [sq_of(game, 0, c)["state"] for c in (0, 1)] == ["right", "wrong"]


def test_wf_pencil_rebus_autocheck(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, puzzle={"key": "p", "fixture": NS}, settings={"a": {"autocheck": True}})
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 0)
        page.keyboard.press(".")
        page.keyboard.press("x")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "X", PENCIL_MARK))
        page.keyboard.press(".")
        page.keyboard.press("ArrowLeft")
        at(page, 0, 0)
        page.keyboard.press("Insert")
        expect(page.get_by_role("textbox", name="Rebus entry")).to_have_value("X")
        page.keyboard.press("Backspace")
        page.keyboard.type("star")
        page.keyboard.press("Enter")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "STAR", RIGHT_MARK))
        at(page, 0, 1)
        page.keyboard.press("q")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", "Q", WRONG_MARK))
        page.keyboard.press("ArrowLeft")
        at(page, 0, 1)
        page.keyboard.press("Delete")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", EMPTY))
        page.keyboard.press("Insert")
        page.keyboard.type("l")
        page.keyboard.press("Enter")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", "L", RIGHT_MARK))
        page.reload()
        ready(page)
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "STAR", RIGHT_MARK))
    cells = [op for op in ops_of(a, s.game_id) if op["type"] == "cell"]
    assert [(op["row"], op["col"], op["value"], op["pencil"], op["state"], op["autocheck"]) for op in cells] == [
        (0, 0, "X", True, "pencil", False), (0, 0, "STAR", False, "right", True), (0, 1, "Q", False, "wrong", True),
        (0, 1, "", False, "empty", False), (0, 1, "L", False, "right", True)]
    assert get_game(a, s.game_id)["checked_count"] == 0


def test_upload_reference_errors(app_url: str) -> None:
    client = _uploader(app_url)
    bad = ref_text(across={1: "Crumbly bake served with jam", 4: "Push the tape out, see 7-Down", 5: "One who hoards every coin"},
                   down={1: "What rises from a kettle spout", 2: "Theme of the starred clues", 3: "Step inside, or key in data"})
    bad = bad.rstrip("\n") + "\n3. Again, with 9-Across\n"
    body = assert_error(client.post("/api/puzzles", content=bad.encode()), 422, "invalid_puzzle")
    assert body["lines"] == [
        line(15, "clue 4 Across refers to 7 Down, which is not in the grid"),
        line(20, "clue 2 Down refers to starred clues, but no clue is starred"),
        line(22, "clue 3 Down refers to 9 Across, which is not in the grid"),
    ]
    assert body["message"] == problems(3)
    gridless = ref_text(across={1: "Crumbly", 4: "See 7-Down", 5: "Hoarder"}).replace("EJECT", "EJ?CT")
    body = assert_error(client.post("/api/puzzles", content=gridless.encode()), 422, "invalid_puzzle")
    assert body["lines"] == [line(9, "unexpected character ? in grid row")]
    plain = ref_text(across={1: "*Crumbly bake, unlike 9 Across", 4: "Push the tape out, see 1 and 3-Down", 5: "Hoarder, with 1, 4, and 5-Across"},
                     down={1: "What rises from a kettle spout", 2: "Theme of the starred clues", 3: "*Step inside, or key in data"},
                     title=fresh_title())
    created = client.post("/api/puzzles", content=plain.encode())
    assert created.status_code == 201, created.text
    clues = created.json()["puzzle"]["clues"]
    links = {(d, c["number"]): [(x["number"], x["direction"]) for x in c["links"]] for d in ("across", "down") for c in clues[d]}
    assert links == {
        ("across", 1): [(5, "across"), (2, "down")],
        ("across", 4): [(5, "across"), (1, "down"), (3, "down")],
        ("across", 5): [(1, "across"), (4, "across")],
        ("down", 1): [(4, "across")],
        ("down", 2): [(1, "across"), (3, "down")],
        ("down", 3): [(4, "across"), (2, "down")],
    }


def test_linked_clues_room(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, text=ref_text())
    puzzle = player_client(app_url, s.ids["a"]).get(f"/api/puzzles/{s.puzzle_id}").json()
    assert [(x["number"], x["direction"]) for x in puzzle["clues"]["across"][1]["links"]] == [(1, "down"), (3, "down")]
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 0)
        expect(linked(page)).to_have_count(5)
        for r in range(5):
            expect(square(page, r, 2)).to_have_attribute("data-linked", "true")
        expect(ref_item(page, "down", 2)).to_have_attribute("data-linked", "true")
        expect(linked_items(page)).to_have_count(1)
        page.keyboard.press("Tab")
        at(page, 2, 0)
        expect(linked(page)).to_have_count(10)
        for r in range(5):
            expect(square(page, r, 0)).to_have_attribute("data-linked", "true")
            expect(square(page, r, 4)).to_have_attribute("data-linked", "true")
        expect(linked_items(page)).to_have_count(2)
        expect(ref_item(page, "down", 3)).to_have_attribute("data-linked", "true")
        page.keyboard.press("Tab")
        at(page, 4, 0)
        expect(linked(page)).to_have_count(0)
        expect(page.locator('[data-linked="true"]')).to_have_count(0)
        click(ref_item(page, "down", 2))
        at(page, 0, 2)
        expect(linked(page)).to_have_count(9)
        expect(square(page, 0, 1)).to_have_attribute("data-linked", "true")
        expect(square(page, 2, 4)).to_have_attribute("data-linked", "true")
        expect(square(page, 2, 0)).not_to_have_attribute("data-linked", "true")
        expect(ref_item(page, "across", 1)).to_have_attribute("data-linked", "true")
        expect(ref_item(page, "down", 3)).to_have_attribute("data-linked", "true")


def test_wf_announcements_linked_alt_l(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, text=ref_text())
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        at(page, 0, 0)
        page.keyboard.press("Alt+KeyL")
        at(page, 0, 2)
        expect(grid).to_have_attribute("data-direction", "down")
        expect(announcements(page)).to_have_text(ref_spoken(2, "down", [(1, "across"), (3, "down")]))
        page.keyboard.press("Alt+KeyL")
        at(page, 0, 4)
        expect(announcements(page)).to_have_text(ref_spoken(3, "down", [(4, "across"), (2, "down")]))
        page.keyboard.press("Alt+KeyL")
        at(page, 2, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        expect(announcements(page)).to_have_text(ref_spoken(4, "across", [(1, "down"), (3, "down")]))
        page.keyboard.press("Tab")
        at(page, 4, 0)
        expect(announcements(page)).to_have_text(ref_spoken(5, "across", []))
        page.keyboard.press("Alt+KeyL")
        at(page, 4, 0)
        expect(announcements(page)).to_have_text(ref_spoken(5, "across", []))
        expect(grid).to_be_focused()


def test_clear_rules(browser: Browser, app_url: str) -> None:
    squares = [seed_sq(0, 0, "S"), seed_sq(0, 1, "C", state="revealed"), seed_sq(0, 2, "O"), seed_sq(0, 3, "N"),
               seed_sq(0, 4, "E"), seed_sq(1, 2, "V"), seed_sq(2, 2, "E"), seed_sq(3, 2, "N"), seed_sq(4, 2, "S"),
               seed_sq(1, 4, "N"), seed_sq(1, 0, "T")]
    s = seed_game(app_url, members=("a", "b"), squares=squares)
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 2, 0)
        page.keyboard.press("Shift+Tab")
        at(page, 0, 0)
        for expected in (3, 1, 0):
            page.keyboard.press("Alt+KeyX")
            menu = page.get_by_role("menu", name="Clear")
            expect(menu.get_by_role("menuitem", name="Word", exact=True)).to_be_focused()
            page.keyboard.press("Enter")
            expect(grid_of(page)).to_be_focused()
            expect(announcements(page)).to_have_text(cleared_phrase(expected))
        for c in range(5):
            expect(square(page, 0, c)).to_have_attribute("data-state", "revealed" if c == 1 else "empty")
        at(page, 0, 0)
    ops = [op for op in ops_of(a, s.game_id) if op["type"] == "clear"]
    assert [[(q["row"], q["col"]) for q in op["squares"]] for op in ops] == [[(0, 0), (0, 3), (0, 4)], [(0, 2)], []]
    assert [(op["scope"], op["row"], op["col"], op["direction"]) for op in ops] == [("word", 0, 0, "across")] * 3
    assert [op["seq"] for op in ops] == list(range(ops[0]["seq"], ops[0]["seq"] + 3))
    whole = clear_op(b, s.game_id, "puzzle")
    assert whole.status_code == 200, whole.text
    assert (whole.json()["type"], whole.json()["cleared"]) == ("clear", 6)
    assert [(q["row"], q["col"]) for q in whole.json()["squares"]] == [(1, 0), (1, 2), (1, 4), (2, 2), (3, 2), (4, 2)]
    game = get_game(a, s.game_id)
    assert [q for q in game["squares"] if q["value"]] == [{"row": 0, "col": 1, "value": "C", "pencil": False, "state": "revealed", "owner": "Teal"}]
    assert (sq_of(game, 1, 0)["owner"], sq_of(game, 1, 0)["pencil"]) == (None, False)
    after = write(b, s.game_id, 0, 0, "S").json()
    assert after["seq"] == whole.json()["seq"] + 1
    assert_error(clear_op(a, s.game_id, "square", 0, 0, "across"), 422, "invalid")
    solved = seed_game(app_url, squares=mk_fill(skip=((0, 0),)))
    owner = player_client(app_url, solved.ids["a"])
    assert write(owner, solved.game_id, 0, 0, "S").status_code == 200
    assert_error(clear_op(owner, solved.game_id, "word", 0, 0, "across"), 409, "game_solved")


def test_clear_menu_phone_confirmation(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "S"), seed_sq(0, 1, "C"), seed_sq(2, 0, "E"), seed_sq(4, 4, "R", state="revealed")])
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        grid = ready(page)
        for leave in ("Cancel", "Escape"):
            tap(button(page, "Clear"))
            menu = page.get_by_role("menu", name="Clear")
            expect(menu.get_by_role("menuitem", name="Word", exact=True)).to_be_focused()
            tap(menu.get_by_role("menuitem", name="Puzzle", exact=True))
            dialog = page.get_by_role("dialog", name="Clear the puzzle?")
            expect(dialog.get_by_role("heading")).to_have_text("Clear every unlocked square?")
            expect(button(dialog, "Cancel")).to_be_focused()
            if leave == "Cancel":
                tap(button(dialog, "Cancel"))
            else:
                page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(grid).to_be_focused()
            expect(square(page, 0, 0)).to_have_attribute("data-state", "filled")
        assert [op for op in ops_of(a, s.game_id) if op["type"] == "clear"] == []
        tap(button(page, "Clear"))
        tap(page.get_by_role("menu", name="Clear").get_by_role("menuitem", name="Puzzle", exact=True))
        dialog = page.get_by_role("dialog", name="Clear the puzzle?")
        tap(button(dialog, "Clear puzzle"))
        expect(dialog).to_be_hidden()
        expect(grid).to_be_focused()
        expect(announcements(page)).to_have_text(cleared_phrase(3))
        for r, c in ((0, 0), (0, 1), (2, 0)):
            expect(square(page, r, c)).to_have_attribute("data-state", "empty")
        expect(square(page, 4, 4)).to_have_attribute("data-state", "revealed")
    ops = [op for op in ops_of(a, s.game_id) if op["type"] == "clear"]
    assert [(op["scope"], len(op["squares"])) for op in ops] == [("puzzle", 3)]


def test_wf_shared_link_live_clear_and_autocheck(browser: Browser, app_url: str) -> None:
    squares = [seed_sq(0, c, ch, owner="b") for c, ch in enumerate(MK_ROWS[0])]
    s = seed_custom(app_url, members=("a", "b"), settings={"a": {"autocheck": True}})
    b = player_client(app_url, s.ids["b"])
    for q in squares:
        assert write(b, s.game_id, q["row"], q["col"], q["value"]).status_code == 200
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        at(host, 2, 0)
        click(square(friend, 4, 4))
        at(friend, 4, 4)
        host.keyboard.press("x")
        expect(square(friend, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "X", WRONG_MARK), timeout=LIVE_MS)
        host.keyboard.press("j")
        expect(square(friend, 2, 1)).to_have_accessible_name(mk(2, 1, "across", "J", RIGHT_MARK), timeout=LIVE_MS)
        host.keyboard.press("Alt+KeyX")
        expect(host.get_by_role("menu", name="Clear").get_by_role("menuitem", name="Word", exact=True)).to_be_focused()
        host.keyboard.press("Enter")
        expect(announcements(host)).to_have_text(cleared_phrase(1))
        expect(square(friend, 2, 0)).to_have_accessible_name(mk(2, 0, "across", EMPTY), timeout=LIVE_MS)
        expect(square(friend, 2, 1)).to_have_accessible_name(mk(2, 1, "across", "J", RIGHT_MARK))
        at(friend, 4, 4)
        expect(grid_of(friend)).to_have_attribute("data-direction", "across")


def test_race_lobby_and_teams(browser: Browser, app_url: str) -> None:
    ids = seed_players(app_url, "a", "b", "c")
    a, b, c = (player_client(app_url, ids[k]) for k in "abc")
    puzzle_id = mk_puzzle_id(a)
    body = assert_error(a.post("/api/games", json={"puzzle_id": puzzle_id, "mode": "relay"}), 422, "invalid")
    assert "mode" in body["fields"]
    created = a.post("/api/games", json={"puzzle_id": puzzle_id, "mode": "race"})
    assert created.status_code == 201, created.text
    game = created.json()
    assert (game["mode"], game["race_state"], game["scores"]) == ("race", "lobby", {"1": 0, "2": 0})
    assert [(p["team"], p["score"]) for p in game["players"]] == [(None, 0)]
    gid = game["id"]
    body = assert_error(a.post(f"/api/games/{gid}/race/start", json={}), 422, "invalid")
    assert body["fields"]["teams"] == RACE_EMPTY_TEAM
    assert a.post(f"/api/games/{gid}/team", json={"team": 1}).status_code == 200
    joined = b.post(f"/api/links/{game['code']}/join", json={})
    assert joined.status_code == 200 and next(p for p in joined.json()["players"] if p["id"] == ids["b"])["team"] is None
    assert b.post(f"/api/games/{gid}/team", json={"team": 2}).status_code == 200
    assert c.post(f"/api/links/{game['code']}/join", json={}).status_code == 200
    body = assert_error(c.post(f"/api/games/{gid}/team", json={"team": 3}), 422, "invalid")
    assert "team" in body["fields"]
    assert_error(b.post(f"/api/games/{gid}/race/start", json={}), 403, "not_host")
    started = a.post(f"/api/games/{gid}/race/start", json={})
    assert started.status_code == 200 and started.json()["race_state"] == "racing"
    assert_error(a.post(f"/api/games/{gid}/race/start", json={}), 409, "race_started")
    assert_error(c.post(f"/api/games/{gid}/team", json={"team": 1}), 409, "race_started")
    assert [(p["id"], p["team"]) for p in get_game(c, gid)["players"]] == [(ids["a"], 1), (ids["b"], 2), (ids["c"], None)]
    shared = a.post("/api/games", json={"puzzle_id": puzzle_id}).json()
    assert (shared["mode"], shared["race_state"], shared["scores"]) == ("shared", None, None)
    assert "team" in assert_error(a.post(f"/api/games/{shared['id']}/team", json={"team": 1}), 422, "invalid")["fields"]
    assert "mode" in assert_error(a.post(f"/api/games/{shared['id']}/race/start", json={}), 422, "invalid")["fields"]
    with as_player(browser, app_url, ids["a"], "/puzzles") as page:
        click(button(page, "Race Morning Kettle"))
        ready(page)
        teams = page.get_by_role("radiogroup", name="Team")
        expect(teams.get_by_role("radio", name="Watch", exact=True)).to_be_checked()
        expect(button(page, "Start race")).to_be_disabled()
        expect(page.get_by_role("status", name="Team scores")).to_have_text(team_scores(0, 0))
        room = page.url.rstrip("/").rsplit("/", 1)[-1]
    assert get_game(a, room)["mode"] == "race"


def test_race_team_grids(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, members=("a", "b", "c"), mode="race", race_state="racing", teams={"a": 1, "b": 2})
    a, b, c = (player_client(app_url, s.ids[k]) for k in "abc")
    assert write(a, s.game_id, 0, 0, "S").status_code == 200
    assert write(b, s.game_id, 0, 0, "Q").status_code == 200
    assert write(b, s.game_id, 0, 1, "X", pencil=True).status_code == 200
    assert_error(write(c, s.game_id, 0, 2, "O"), 403, "watching")
    assert sq_of(get_game(a, s.game_id), 0, 0)["value"] == "S" and sq_of(get_game(a, s.game_id), 0, 1)["value"] == ""
    assert (sq_of(get_game(b, s.game_id), 0, 0)["value"], sq_of(get_game(b, s.game_id), 0, 1)["pencil"]) == ("Q", True)
    assert all(q["value"] == "" for q in get_game(c, s.game_id)["squares"])
    answer = clear_op(a, s.game_id, "word", 0, 0, "across")
    assert answer.status_code == 200, answer.text
    assert answer.json()["cleared"] == 1
    assert sq_of(get_game(a, s.game_id), 0, 0)["value"] == "" and sq_of(get_game(b, s.game_id), 0, 0)["value"] == "Q"
    assert {op["team"] for op in ops_of(a, s.game_id)} == {1, 2}
    with as_player(browser, app_url, s.ids["a"], s.room) as one, as_player(browser, app_url, s.ids["b"], s.room) as two:
        ready(one)
        ready(two)
        click(square(one, 2, 1))
        one.keyboard.press("ArrowLeft")
        for letter in "eje":
            one.keyboard.press(letter)
        expect(square(one, 2, 2)).to_have_accessible_name(mk(2, 2, "across", "E"))
        click(square(two, 4, 1))
        two.keyboard.press("ArrowLeft")
        two.keyboard.press("m")
        expect(square(two, 4, 0)).to_have_accessible_name(mk(4, 0, "across", "M"))
        poll(lambda: sq_of(get_game(b, s.game_id), 4, 0)["value"] == "M", SERVER_WAIT_S, "team 2's letter stored")
        for col in range(3):
            expect(square(two, 2, col)).to_have_attribute("data-state", "empty")
        expect(square(one, 4, 0)).to_have_attribute("data-state", "empty")
        expect(grid_of(two).locator("[data-cursor]")).to_have_count(0)
        expect(grid_of(one).locator("[data-cursor]")).to_have_count(0)
    lobby = seed_custom(app_url, members=("a", "b", "c"), mode="race", race_state="lobby", teams={"a": 1, "b": 2})
    assert_error(write(player_client(app_url, lobby.ids["a"]), lobby.game_id, 0, 0, "S"), 409, "race_not_started")
    assert_error(write(player_client(app_url, lobby.ids["c"]), lobby.game_id, 0, 0, "S"), 403, "watching")
    with as_player(browser, app_url, lobby.ids["a"], lobby.room) as page:
        ready(page)
        click(square(page, 0, 1))
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("s")
        expect(notices(page)).to_have_text(RACE_NOT_STARTED)
        expect(square(page, 0, 0)).to_have_attribute("data-state", "empty")


def test_race_claims(browser: Browser, app_url: str) -> None:
    squares = [race_sq(2, 0, "E", "a", team=1), race_sq(0, 0, "S", "a", team=1), race_sq(0, 0, "S", "b", team=2),
               race_sq(0, 1, "X", "b", team=2)]
    s = seed_custom(app_url, members=("a", "b"), mode="race", race_state="racing", teams={"a": 1, "b": 2}, squares=squares)
    a, b = (player_client(app_url, s.ids[k]) for k in "ab")
    with as_player(browser, app_url, s.ids["a"], s.room) as one, as_player(browser, app_url, s.ids["b"], s.room) as two:
        ready(one)
        ready(two)
        click(square(one, 2, 1))
        one.keyboard.press("ArrowLeft")
        at(one, 2, 0)
        menu_action(one, "Check", "Square")
        for page in (one, two):
            expect(square(page, 2, 0)).to_have_attribute("data-claimed", "true", timeout=LIVE_MS)
            expect(square(page, 2, 0)).to_have_accessible_name(mk(2, 0, "across", "E", RIGHT_MARK))
            expect(square(page, 2, 0)).to_have_attribute("data-owner", "Teal")
            expect(page.get_by_role("status", name="Team scores")).to_have_text(team_scores(1, 0), timeout=LIVE_MS)
    first, second = together(lambda: act(a, s.game_id, "check", "square", 0, 0),
                             lambda: act(b, s.game_id, "check", "square", 0, 0))
    codes = sorted([first.status_code, second.status_code])
    assert codes == [200, 409], (first.text, second.text)
    winner, loser = (first, second) if first.status_code == 200 else (second, first)
    assert_error(loser, 409, "square_locked")
    claim = winner.json()
    assert (claim["type"], claim["row"], claim["col"], claim["value"]) == ("claim", 0, 0, "S")
    team = claim["team"]
    assert claim["scores"] == {"1": 1 + (team == 1), "2": int(team == 2)}
    for client in (a, b):
        sq = sq_of(get_game(client, s.game_id), 0, 0)
        assert (sq["value"], sq["state"], sq["owner"]) == ("S", "right", "Teal" if team == 1 else "Coral")
    wrong = act(b, s.game_id, "check", "square", 0, 1).json()
    assert (wrong["type"], wrong["wrong"]) == ("check", 1)
    assert sq_of(get_game(b, s.game_id), 0, 1)["state"] == "wrong"
    assert sq_of(get_game(a, s.game_id), 0, 1)["state"] == "empty"
    assert get_game(a, s.game_id)["scores"] == claim["scores"]
    assert_error(act(a, s.game_id, "check", "word", 0, 0, "across"), 422, "invalid")
    assert_error(act(a, s.game_id, "reveal", "square", 0, 2), 422, "invalid")
    claims = [op for op in ops_of(a, s.game_id) if op["type"] == "claim"]
    assert [(op["row"], op["col"], op["team"]) for op in claims] == [(2, 0, 1), (0, 0, team)]


def test_race_end_and_result(browser: Browser, app_url: str) -> None:
    whites = white_squares(MK_ROWS)
    claimed = [race_sq(r, c, MK_ROWS[r][c], "a" if i < 11 else "b", state="right") for i, (r, c) in enumerate(whites[:-1])]
    last = whites[-1]
    s = seed_custom(app_url, members=("a", "b"), outsiders=("c",), mode="race", race_state="racing", teams={"a": 1, "b": 2},
                    squares=claimed + [race_sq(*last, "R", "a", team=1)])
    a = player_client(app_url, s.ids["a"])
    assert get_game(a, s.game_id)["scores"] == {"1": 11, "2": 9}
    with as_player(browser, app_url, s.ids["a"], s.room) as one, as_player(browser, app_url, s.ids["b"], s.room) as two:
        ready(one)
        ready(two)
        assert act(a, s.game_id, "check", "square", *last).status_code == 200
        for page in (one, two):
            dialog = page.get_by_role("dialog", name="Race over")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            expect(dialog.get_by_role("heading")).to_have_text("Team 1 wins 12 to 9")
            expect(dialog.get_by_role("heading")).to_be_focused()
            expect(dialog.get_by_role("list", name="Race scores").get_by_role("listitem")).to_have_text(
                [f"{s.names['a']} · Team 1 · 12", f"{s.names['b']} · Team 2 · 9"])
    game = get_game(a, s.game_id)
    assert (game["status"], game["race_state"], game["timer_state"]) == ("solved", "finished", "solved")
    assert s.game_id not in [e["game_id"] for e in a.get("/api/history").json()["entries"]]
    rows = ["ABCD", "EFGH", "IJKL", "MNOP"]
    text = ("Overlap 1\nTitle: Even Square\nAuthor: Wren Halloway\nSize: 4x4\n\nGrid:\n" + "\n".join(rows) + "\n\nAcross:\n"
            "1. First\n5. Second\n6. Third\n7. Fourth\n\nDown:\n1. Left\n2. Next\n3. Then\n4. Right\n")
    cells = white_squares(rows)
    tie = seed_custom(app_url, members=("a", "b"), puzzle={"key": "p", "text": text, "owner": "a"}, mode="race",
                      race_state="racing", teams={"a": 1, "b": 2},
                      squares=[race_sq(r, c, rows[r][c], "a" if i < 8 else "b", state="right") for i, (r, c) in enumerate(cells[:-1])]
                      + [race_sq(3, 3, "P", "b", team=2)])
    with as_player(browser, app_url, tie.ids["b"], tie.room) as page:
        ready(page)
        assert act(player_client(app_url, tie.ids["b"]), tie.game_id, "check", "square", 3, 3).status_code == 200
        dialog = page.get_by_role("dialog", name="Race over")
        expect(dialog.get_by_role("heading")).to_have_text("Tie at 8", timeout=LIVE_MS)
        expect(dialog.get_by_role("list", name="Race scores").get_by_role("listitem")).to_have_text(
            [f"{tie.names['a']} · Team 1 · 8", f"{tie.names['b']} · Team 2 · 8"])


def test_wf_race_two_teams(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, members=("a", "b"), mode="race", race_state="lobby")
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        for page, team in ((host, "Team 1"), (friend, "Team 2")):
            radio = page.get_by_role("radiogroup", name="Team").get_by_role("radio", name=team, exact=True)
            radio.focus()
            page.keyboard.press("Space")
            expect(radio).to_be_checked()
        start = button(host, "Start race")
        expect(start).to_be_enabled(timeout=LIVE_MS)
        start.focus()
        host.keyboard.press("Enter")
        for page in (host, friend):
            expect(page.get_by_role("radiogroup", name="Team").get_by_role("radio", name="Team 1", exact=True)).to_be_disabled(timeout=LIVE_MS)
        click(square(host, 0, 1))
        host.keyboard.press("ArrowLeft")
        at(host, 0, 0)
        for letter in "scone":
            host.keyboard.press(letter)
        expect(square(host, 0, 4)).to_have_accessible_name(mk(0, 4, "across", "E"))
        click(square(friend, 0, 1))
        friend.keyboard.press("ArrowLeft")
        at(friend, 0, 0)
        friend.keyboard.press("s")
        expect(square(friend, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"))
        poll(lambda: sq_of(get_game(player_client(app_url, s.ids["b"]), s.game_id), 0, 0)["value"] == "S", SERVER_WAIT_S,
             "the friend's own letter stored")
        expect(square(friend, 0, 1)).to_have_accessible_name(mk(0, 1, "across", EMPTY))
        click(square(host, 0, 1))
        host.keyboard.press("ArrowLeft")
        at(host, 0, 0)
        menu_action(host, "Check", "Square")
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", RIGHT_MARK), timeout=LIVE_MS)
            expect(square(page, 0, 0)).to_have_attribute("data-owner", "Teal")
            expect(page.get_by_role("status", name="Team scores")).to_have_text(team_scores(1, 0), timeout=LIVE_MS)
        friend.keyboard.press("ArrowLeft")
        at(friend, 0, 0)
        menu_action(friend, "Check", "Square")
        expect(notices(friend)).to_have_text(LOCKED_NOTICE)
        expect(friend.get_by_role("status", name="Team scores")).to_have_text(team_scores(1, 0))


def _timeline_game(base: str) -> tuple[Seeded, dict, list[dict]]:
    base_squares = [q for q in mk_fill(skip=tuple((4, c) for c in range(5))) if (q["row"], q["col"]) != (0, 1)]
    s = seed_game(base, members=("a", "b"), squares=base_squares + [seed_sq(0, 1, "X")])
    a = player_client(base, s.ids["a"])
    b = player_client(base, s.ids["b"])
    assert write(a, s.game_id, 4, 0, "M").status_code == 200
    assert write(b, s.game_id, 4, 1, "I").status_code == 200
    assert act(a, s.game_id, "check", "word", 0, 0, "across").status_code == 200
    assert write(a, s.game_id, 0, 1, "C").status_code == 200
    assert write(b, s.game_id, 4, 2, "Q", pencil=True).status_code == 200
    assert clear_op(b, s.game_id, "word", 4, 0, "across").json()["cleared"] == 1
    assert act(b, s.game_id, "reveal", "word", 4, 0, "across").json()["revealed"] == 5
    assert get_game(a, s.game_id)["status"] == "solved"
    poll(lambda: next((e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id and e["record_ready"]), None),
         RECORD_WAIT_S, "history entry reported record_ready")
    record = a.get(f"/api/history/{s.game_id}/record").json()
    values = {(q["row"], q["col"]): q["value"] for q in record["initial"]}
    steps = [dict(values)]
    for op in record["ops"]:
        if op["type"] == "cell":
            values[(op["row"], op["col"])] = op["value"]
        for q in op.get("squares") or []:
            values[(q["row"], q["col"])] = q.get("value", "") if op["type"] in ("reveal", "clear") else values[(q["row"], q["col"])]
        steps.append(dict(values))
    return s, record, steps


def _open_replay(page: Page, s: Seeded) -> Locator:
    item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text="Morning Kettle")
    expect(item).to_have_count(1, timeout=READY_MS)
    click(button(item, "Replay"))
    dialog = page.get_by_role("dialog", name="Replay")
    expect(dialog).to_be_visible()
    return dialog


def test_replay_timeline_keys(browser: Browser, app_url: str) -> None:
    s, record, steps = _timeline_game(app_url)
    n = len(record["ops"])
    assert n == 7
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        step = dialog.get_by_role("status", name="Replay step")
        grid = dialog.get_by_role("group", name="Replay grid")
        slider = dialog.get_by_role("slider", name="Replay position")
        slider.focus()

        def landed(k: int) -> None:
            expect(step).to_have_text(f"Step {k} of {n}")
            for (r, c), v in steps[k].items():
                expect(grid.locator(f'[data-row="{r}"][data-col="{c}"]')).to_have_attribute("data-value", v)

        landed(0)
        for key, k in (("ArrowRight", 1), ("ArrowUp", 2), ("ArrowLeft", 1), ("ArrowDown", 0), ("End", 7), ("Home", 0),
                       ("Shift+ArrowRight", 3), ("Shift+ArrowRight", 6), ("Shift+ArrowRight", 7), ("Shift+ArrowRight", 7),
                       ("Shift+ArrowLeft", 6), ("Shift+ArrowLeft", 3), ("Shift+ArrowLeft", 0), ("PageUp", 7),
                       ("PageDown", 0), ("ArrowDown", 0)):
            page.keyboard.press(key)
            landed(k)
        expect(slider).to_be_focused()


def test_replay_op_sentences(browser: Browser, app_url: str) -> None:
    s, record, steps = _timeline_game(app_url)
    a_name, b_name = s.names["a"], s.names["b"]
    expected = ["Start", f"{a_name} wrote M in row 5, column 1", f"{b_name} wrote I in row 5, column 2",
                f"{a_name} checked the word: 1 wrong", f"{a_name} wrote C in row 1, column 2",
                f"{b_name} pencilled Q in row 5, column 3", f"{b_name} cleared the word: {count_phrase(1)}",
                f"{b_name} revealed the word: {count_phrase(5)}"]
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        sentence = dialog.get_by_role("status", name="Replay op")
        for k, text in enumerate(expected):
            if k:
                button(dialog, "Next step").focus()
                page.keyboard.press("Enter")
            expect(dialog.get_by_role("status", name="Replay step")).to_have_text(f"Step {k} of 7")
            expect(sentence).to_have_text(text)
        for k in (6, 5):
            button(dialog, "Previous step").focus()
            page.keyboard.press("Enter")
            expect(sentence).to_have_text(expected[k])


def test_wf_timer_replay_autoplay(browser: Browser, app_url: str) -> None:
    s, record, _ = _timeline_game(app_url)
    assert config(app_url)["replay_step_ms"] == REPLAY_STEP_MS
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        step = dialog.get_by_role("status", name="Replay step")
        speeds = dialog.get_by_role("radiogroup", name="Replay speed")
        expect(speeds.get_by_role("radio", name="1x", exact=True)).to_be_checked()
        click(button(dialog, "Play"))
        expect(button(dialog, "Pause")).to_be_visible()
        advance(page, REPLAY_STEP_MS - 1)
        expect(step).to_have_text("Step 0 of 7")
        advance(page, 1)
        expect(step).to_have_text("Step 1 of 7")
        advance(page, REPLAY_STEP_MS / 2)
        click(speeds.get_by_role("radio", name="2x", exact=True))
        advance(page, REPLAY_STEP_MS / 2 - 1)
        expect(step).to_have_text("Step 1 of 7")
        advance(page, 1)
        expect(step).to_have_text("Step 2 of 7")
        click(speeds.get_by_role("radio", name="4x", exact=True))
        advance(page, REPLAY_STEP_MS / 4)
        expect(step).to_have_text("Step 3 of 7")
        advance(page, REPLAY_STEP_MS / 4 * 4)
        expect(step).to_have_text("Step 7 of 7")
        expect(button(dialog, "Play")).to_be_visible()
        advance(page, REPLAY_STEP_MS * 4)
        expect(step).to_have_text("Step 7 of 7")
        click(button(dialog, "Play"))
        expect(step).to_have_text("Step 0 of 7")
        advance(page, REPLAY_STEP_MS / 4)
        expect(step).to_have_text("Step 1 of 7")
        click(button(dialog, "Pause"))
        expect(button(dialog, "Play")).to_be_visible()
        advance(page, REPLAY_STEP_MS * 4)
        expect(step).to_have_text("Step 1 of 7")


def builder_grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Builder grid")


def bsq(page: Page, row: int, col: int) -> Locator:
    return builder_grid(page).locator(f'[data-row="{row}"][data-col="{col}"]')


def bname(row: int, col: int, content: str) -> str:
    return f"Row {row + 1}, column {col + 1}, {content}"


def problems_of(page: Page) -> Locator:
    return page.get_by_role("list", name="Grid problems").get_by_role("listitem")


def builder_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Builder status")


def builder_problems(rows: list[str], title: str, author: str, clues: dict) -> list[str]:
    found = words(rows)[1]
    out = []
    if not 1 <= len(title.strip()) <= 80:
        out.append("Title must be 1 to 80 characters")
    if not 1 <= len(author.strip()) <= 60:
        out.append("Author must be 1 to 60 characters")
    in_word = {cell for d in found.values() for cells in d.values() for cell in cells}
    whites = white_squares(rows)
    out += [f"Square at row {r + 1}, column {c + 1} is not part of any word" for r, c in whites if (r, c) not in in_word]
    if whites:
        seen, todo = set(), [whites[0]]
        while todo:
            r, c = todo.pop()
            if (r, c) in seen:
                continue
            seen.add((r, c))
            todo += [(r + dr, c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)) if (r + dr, c + dc) in set(whites)]
        if len(seen) != len(whites):
            out.append("The white squares are not all connected")
    for r, row in enumerate(rows):
        k = row.count(".")
        if k:
            out.append(f"Row {r + 1} has 1 empty square" if k == 1 else f"Row {r + 1} has {k} empty squares")
    for d in ("across", "down"):
        for n in sorted(found[d]):
            if not clues.get((d, n), "").strip():
                out.append(f"{n} {d.title()} has no clue")
    return out


def expect_problems(page: Page, expected: list[str]) -> None:
    if expected:
        expect(problems_of(page)).to_have_text(expected)
        expect(builder_status(page)).to_have_text("1 problem" if len(expected) == 1 else f"{len(expected)} problems")
    else:
        expect(problems_of(page)).to_have_count(0)
        expect(builder_status(page)).to_have_text("Ready to save")


def open_builder(page: Page) -> Locator:
    grid = builder_grid(page)
    expect(grid).to_be_visible(timeout=READY_MS)
    return grid


def spin_value(box: Locator) -> int:
    now = box.get_attribute("aria-valuenow")
    return int(now) if now else int(box.input_value())


def builder_size(page: Page, cols: int, rows: int) -> None:
    for name, target in (("Columns", cols), ("Rows", rows)):
        box = page.get_by_role("spinbutton", name=name, exact=True)
        box.focus()
        current = spin_value(box)
        while current != target:
            page.keyboard.press("ArrowUp" if target > current else "ArrowDown")
            current += 1 if target > current else -1
            poll(lambda: spin_value(box) == current, SERVER_WAIT_S, f"{name} shows {current}")


def type_rows(page: Page, rows: list[str]) -> None:
    for r, row in enumerate(rows):
        click(bsq(page, r, 0))
        for ch in row:
            if ch != "#":
                page.keyboard.press(ch.lower())


def fill_clues(page: Page, clues: dict) -> None:
    for (d, n), text in clues.items():
        fill(page.get_by_role("textbox", name=f"{n} {d.title()} clue", exact=True), text)


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def builder_text(title: str, author: str, rows: list[str], clues: dict) -> str:
    found = words(rows)[1]
    lines = ["Overlap 1", f"Title: {title.strip()}", f"Author: {author.strip()}", f"Size: {len(rows[0])}x{len(rows)}", "", "Grid:"]
    lines += rows + ["", "Across:"] + [f"{n}. {clues[('across', n)].strip()}" for n in sorted(found["across"])]
    lines += ["", "Down:"] + [f"{n}. {clues[('down', n)].strip()}" for n in sorted(found["down"])]
    return "\n".join(lines) + "\n"


TINY_ROWS = ["CAT", "ARE", "TEN"]
TINY_CLUES = {("across", 1): "  Pet that purrs ", ("across", 4): "Exist, plural", ("across", 5): "Ten",
              ("down", 1): "Pet that purrs, again", ("down", 2): "Exist, plural, again", ("down", 3): " Number after nine"}


def build_tiny(page: Page, title: str, author: str = "  Wren  ") -> None:
    open_builder(page)
    builder_size(page, 3, 3)
    fill(page.get_by_role("textbox", name="Title", exact=True), title)
    fill(page.get_by_role("textbox", name="Author", exact=True), author)
    type_rows(page, TINY_ROWS)
    fill_clues(page, TINY_CLUES)
    expect_problems(page, [])


def test_builder_symmetry(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    with as_player(browser, app_url, owner, "/build") as page:
        open_builder(page)
        symmetry = page.get_by_role("radiogroup", name="Symmetry")
        radio = lambda name: symmetry.get_by_role("radio", name=name, exact=True)
        expect(radio("None")).to_be_checked()
        expect(builder_grid(page).get_by_role("gridcell")).to_have_count(25)

        def toggle(r: int, c: int) -> None:
            click(bsq(page, r, c))
            page.keyboard.press(".")

        toggle(0, 1)
        expect(bsq(page, 0, 1)).to_have_accessible_name(bname(0, 1, "black"))
        expect(builder_grid(page).locator('[data-black="true"]')).to_have_count(1)
        for name, square_at, partner in (("Left-right", (1, 0), (1, 4)), ("Top-bottom", (0, 3), (4, 3)),
                                          ("Diagonal", (2, 3), (3, 2)), ("Rotational", (0, 0), (4, 4))):
            radio(name).focus()
            page.keyboard.press("Space")
            expect(radio(name)).to_be_checked()
            toggle(*square_at)
            expect(bsq(page, *square_at)).to_have_attribute("data-black", "true")
            expect(bsq(page, *partner)).to_have_attribute("data-black", "true")
        expect(builder_grid(page).locator('[data-black="true"]')).to_have_count(9)
        toggle(4, 4)
        expect(bsq(page, 4, 4)).to_have_accessible_name(bname(4, 4, "empty"))
        expect(bsq(page, 0, 0)).to_have_accessible_name(bname(0, 0, "empty"))
        click(bsq(page, 2, 2))
        page.keyboard.press("q")
        expect(bsq(page, 2, 2)).to_have_accessible_name(bname(2, 2, "Q"))
        expect(bsq(page, 2, 4)).to_have_attribute("aria-selected", "true")
        click(bsq(page, 2, 2))
        page.keyboard.press(".")
        expect(bsq(page, 2, 2)).to_have_accessible_name(bname(2, 2, "black"))
        page.keyboard.press(".")
        expect(bsq(page, 2, 2)).to_have_accessible_name(bname(2, 2, "empty"))
        click(bsq(page, 2, 3))
        page.keyboard.press(".")
        expect(bsq(page, 2, 3)).to_have_accessible_name(bname(2, 3, "empty"))
        expect(bsq(page, 2, 1)).to_have_accessible_name(bname(2, 1, "empty"))
        page.keyboard.press(".")
        expect(bsq(page, 2, 3)).to_have_accessible_name(bname(2, 3, "black"))
        expect(bsq(page, 2, 1)).to_have_accessible_name(bname(2, 1, "black"))
        builder_size(page, 7, 5)
        expect(builder_grid(page).get_by_role("gridcell")).to_have_count(35)
        expect(builder_grid(page).locator('[data-black="true"]')).to_have_count(0)
        expect(radio("None")).to_be_checked()
        expect(radio("Diagonal")).to_be_disabled()
        builder_size(page, 7, 7)
        expect(builder_grid(page).get_by_role("gridcell")).to_have_count(49)
        expect(radio("Rotational")).to_be_checked()
        expect(radio("Diagonal")).to_be_enabled()
        toggle(1, 2)
        expect(bsq(page, 5, 4)).to_have_attribute("data-black", "true")


def test_builder_numbering_and_clues(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    with as_player(browser, app_url, owner, "/build") as page:
        open_builder(page)
        numbers = {(0, 0): 1, (0, 1): 2, (0, 2): 3, (0, 3): 4, (0, 4): 5, (1, 0): 6, (2, 0): 7, (3, 0): 8, (4, 0): 9}
        for (r, c), n in numbers.items():
            expect(bsq(page, r, c)).to_have_attribute("data-number", str(n))
        clue_boxes = page.get_by_role("textbox", name=re.compile(r"^\d+ (Across|Down) clue$"))
        names = [f"{n} Across clue" for n in (1, 6, 7, 8, 9)] + [f"{n} Down clue" for n in (1, 2, 3, 4, 5)]
        expect(clue_boxes).to_have_count(len(names))
        for index, name in enumerate(names):
            expect(clue_boxes.nth(index)).to_have_accessible_name(name)
        fill_clues(page, {("across", 1): "Top row", ("down", 3): "Middle", ("down", 5): "Right"})
        click(bsq(page, 0, 1))
        page.keyboard.press(".")
        renumbered = {(0, 0): 1, (0, 2): 2, (0, 3): 3, (0, 4): 4, (1, 0): 5, (1, 1): 6, (2, 0): 7, (3, 0): 8, (4, 0): 9}
        for (r, c), n in renumbered.items():
            expect(bsq(page, r, c)).to_have_attribute("data-number", str(n))
        expect(bsq(page, 1, 2)).not_to_have_attribute("data-number", re.compile(r".*"))
        names = [f"{n} Across clue" for n in (2, 5, 7, 8, 9)] + [f"{n} Down clue" for n in (1, 2, 3, 4, 6)]
        expect(clue_boxes).to_have_count(len(names))
        for index, name in enumerate(names):
            expect(clue_boxes.nth(index)).to_have_accessible_name(name)
        expect(page.get_by_role("textbox", name="1 Across clue", exact=True)).to_have_count(0)
        expect(page.get_by_role("textbox", name="2 Across clue", exact=True)).to_have_value("")
        expect(page.get_by_role("textbox", name="2 Down clue", exact=True)).to_have_value("Middle")
        expect(page.get_by_role("textbox", name="4 Down clue", exact=True)).to_have_value("Right")
        expect(page.get_by_role("textbox", name="1 Down clue", exact=True)).to_have_value("")


def test_builder_problems(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    rows = ["....." for _ in range(5)]
    title, author, clues = "", "", {}
    with as_player(browser, app_url, owner, "/build") as page:
        open_builder(page)
        expect_problems(page, builder_problems(rows, title, author, clues))
        for r, c in ((0, 1), (1, 0)):
            click(bsq(page, r, c))
            page.keyboard.press(".")
            rows[r] = rows[r][:c] + "#" + rows[r][c + 1:]
        expected = builder_problems(rows, title, author, clues)
        assert "Square at row 1, column 1 is not part of any word" in expected
        assert "The white squares are not all connected" in expected
        expect_problems(page, expected)
        click(bsq(page, 2, 0))
        for ch in "abcde":
            page.keyboard.press(ch)
        rows[2] = "ABCDE"
        expect_problems(page, builder_problems(rows, title, author, clues))
        title, author = "x" * 81, "Wren"
        fill(page.get_by_role("textbox", name="Title", exact=True), title)
        fill(page.get_by_role("textbox", name="Author", exact=True), author)
        expect_problems(page, builder_problems(rows, title, author, clues))
        title = "  Fine  "
        fill(page.get_by_role("textbox", name="Title", exact=True), title)
        click(bsq(page, 0, 1))
        page.keyboard.press(".")
        click(bsq(page, 1, 0))
        page.keyboard.press(".")
        rows[0], rows[1] = ".....", "....."
        expected = builder_problems(rows, title, author, clues)
        expect_problems(page, expected)
        expect(button(page, "Save to my puzzles")).to_be_disabled()
        expect(button(page, "Download text")).to_be_disabled()
        clues = {("across", n): f"Across {n}" for n in (1, 6, 7, 8, 9)} | {("down", n): f"Down {n}" for n in (1, 2, 3, 4, 5)}
        clues[("down", 4)] = "   "
        fill_clues(page, clues)
        expect_problems(page, builder_problems(rows, title, author, clues))


def test_builder_text_download(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = f"Tiny Square! {uuid.uuid4().hex[:4]} 2026"
    expected = builder_text(title, "Wren", TINY_ROWS, TINY_CLUES)
    with as_player(browser, app_url, owner, "/build") as page:
        build_tiny(page, title)
        with page.expect_download() as info:
            click(button(page, "Download text"))
        assert info.value.suggested_filename == f"{slug(title)}.overlap.txt"
        data = Path(info.value.path()).read_bytes()
    assert data == expected.encode()
    created = player_client(app_url, owner).post("/api/puzzles", content=data)
    assert created.status_code == 201, created.text
    assert created.json()["solution"] == [list(row) for row in TINY_ROWS]


def test_builder_save(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    with as_player(browser, app_url, owner, "/build") as page:
        build_tiny(page, title)
        click(button(page, "Save to my puzzles"))
        expect(builder_status(page)).to_have_text(f"Saved: {title}", timeout=READY_MS)
    client = player_client(app_url, owner)
    mine = client.get("/api/puzzles", params={"source": "mine"}).json()["puzzles"]
    assert [p["title"] for p in mine] == [title]
    pid = mine[0]["id"]
    assert S3().get(f"uploads/{pid}/original.overlap.txt") == builder_text(title, "Wren", TINY_ROWS, TINY_CLUES).encode()
    assert client.get(f"/api/puzzles/{pid}").json()["source"] == "upload"


def test_wf_constructor_build_kettle(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    clues = {("across", n): t for n, t in MK_ACROSS.items()} | {("down", n): t for n, t in MK_DOWN.items()}
    with as_player(browser, app_url, owner, "/build") as page:
        open_builder(page)
        rotational = page.get_by_role("radiogroup", name="Symmetry").get_by_role("radio", name="Rotational", exact=True)
        rotational.focus()
        page.keyboard.press("Space")
        expect(rotational).to_be_checked()
        click(bsq(page, 0, 0))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowRight")
        page.keyboard.press(".")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press(".")
        for r, c in ((1, 1), (1, 3), (3, 1), (3, 3)):
            expect(bsq(page, r, c)).to_have_accessible_name(bname(r, c, "black"))
        for (r, c), n in {(0, 0): 1, (0, 2): 2, (0, 4): 3, (2, 0): 4, (4, 0): 5}.items():
            expect(bsq(page, r, c)).to_have_attribute("data-number", str(n))
        rows = list(MK_ROWS)
        model = [re.sub(r"[A-Z]", ".", row) for row in rows]
        expect_problems(page, builder_problems(model, "", "", {}))
        click(bsq(page, 0, 0))
        for r, row in enumerate(rows):
            if r:
                page.keyboard.press("ArrowDown")
                for _ in range(4):
                    page.keyboard.press("ArrowLeft")
            for ch in row:
                if ch != "#":
                    page.keyboard.press(ch.lower())
            model[r] = row
            expect_problems(page, builder_problems(model, "", "", {}))
        expect(bsq(page, 1, 4)).to_have_accessible_name(bname(1, 4, "N"))
        fill(page.get_by_role("textbox", name="Title", exact=True), title)
        fill(page.get_by_role("textbox", name="Author", exact=True), "Wren Halloway")
        fill_clues(page, clues)
        expect_problems(page, [])
        with page.expect_download() as info:
            click(button(page, "Download text"))
        data = Path(info.value.path()).read_bytes()
        assert data == mk_text(title).encode()
        click(button(page, "Save to my puzzles"))
        expect(builder_status(page)).to_have_text(f"Saved: {title}", timeout=READY_MS)
    mine = player_client(app_url, owner).get("/api/puzzles", params={"source": "mine"}).json()["puzzles"]
    assert [p["title"] for p in mine] == [title]
    assert S3().get(f"uploads/{mine[0]['id']}/original.overlap.txt") == data


def test_builder_save_outage(browser: Browser) -> None:
    down = down_url()
    owner = seed_players(down, "a")["a"]
    title = fresh_title()
    with as_player(browser, down, owner, "/build") as page:
        build_tiny(page, title)
        click(button(page, "Save to my puzzles"))
        expect(page.get_by_role("alert")).to_have_text(BUILDER_OUTAGE, timeout=READY_MS)
        expect(page.get_by_role("textbox", name="Title", exact=True)).to_have_value(title)
        expect(page.get_by_role("textbox", name="Author", exact=True)).to_have_value("  Wren  ")
        for r, row in enumerate(TINY_ROWS):
            for c, ch in enumerate(row):
                expect(bsq(page, r, c)).to_have_accessible_name(bname(r, c, ch))
        for (d, n), text in TINY_CLUES.items():
            expect(page.get_by_role("textbox", name=f"{n} {d.title()} clue", exact=True)).to_have_value(text)
        expect(builder_status(page)).to_have_text("Ready to save")
    assert player_client(down, owner).get("/api/puzzles", params={"source": "mine"}).json()["puzzles"] == []


def _stats_game(base: str) -> tuple[Seeded, dict]:
    squares = [seed_sq(r, c, MK_ROWS[r][c], owner="a" if r == 0 else "b") for r, c in white_squares(MK_ROWS)
               if (r, c) not in ((0, 0), (4, 4))]
    squares.append(seed_sq(4, 4, "R", state="revealed", owner="a"))
    s = seed_game(base, members=("a", "b"), outsiders=("c",), squares=squares)
    return s, {"a": (4, 1), "b": (16, 0)}


def stats_row(name: str, letters: int, revealed: int) -> str:
    return f"{name} · {letters} letters · {revealed} revealed"


def test_solve_stats_dialog(browser: Browser, app_url: str) -> None:
    s, stats = _stats_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, reduced="reduce") as host, \
            as_player(browser, app_url, s.ids["b"], s.room, reduced="reduce") as friend:
        ready(host)
        ready(friend)
        live_open(host, s.game_id, "watch")
        assert write(player_client(app_url, s.ids["b"]), s.game_id, 0, 0, "S").status_code == 200
        for page in (host, friend):
            dialog = page.get_by_role("dialog", name="Puzzle solved")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            expect(dialog.get_by_role("list", name="Solve stats").get_by_role("listitem")).to_have_text(
                [stats_row(s.names[k], *stats[k]) for k in ("a", "b")])
        solved = poll(lambda: next((m for m in live_rec(host, "watch")["messages"] if m["type"] == "solved"), None),
                      SERVER_WAIT_S, "the live connection got the solved message")
        assert [(x["display_name"], x["colour"], x["letters"], x["revealed"]) for x in solved["stats"]] == [
            (s.names["a"], "Teal", 4, 1), (s.names["b"], "Coral", 16, 0)]


def test_stats_history_and_record(browser: Browser, app_url: str) -> None:
    s, stats = _stats_game(app_url)
    b = player_client(app_url, s.ids["b"])
    assert write(b, s.game_id, 0, 0, "S").status_code == 200
    entry = poll(lambda: next((e for e in b.get("/api/history").json()["entries"] if e["game_id"] == s.game_id and e["record_ready"]), None),
                 RECORD_WAIT_S, "history entry reported record_ready")
    assert [(x["display_name"], x["colour"], x["letters"], x["revealed"]) for x in entry["stats"]] == [
        (s.names["a"], "Teal", 4, 1), (s.names["b"], "Coral", 16, 0)]
    record = json.loads(b.get(f"/api/history/{s.game_id}/record").content)
    assert [(x["player_id"], x["letters"], x["revealed"]) for x in record["stats"]] == [
        (s.ids["a"], 4, 1), (s.ids["b"], 16, 0)]
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text="Morning Kettle")
        expect(item).to_have_count(1, timeout=READY_MS)
        for k in ("a", "b"):
            expect(item).to_contain_text(stats_row(s.names[k], *stats[k]))


def test_wf_keyboard_solving_down_words_tablet(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=TABLET) as page:
        grid = ready(page)
        at(page, 0, 0)
        page.keyboard.press("Space")
        expect(grid).to_have_attribute("data-direction", "down")
        at(page, 0, 0)
        expect(announcements(page)).to_have_text(spoken(1, "down"))
        for letter in "steam":
            page.keyboard.press(letter)
        at(page, 4, 0)
        page.keyboard.press("Tab")
        at(page, 0, 2)
        for letter in "ovens":
            page.keyboard.press(letter)
        at(page, 4, 2)
        page.keyboard.press("Shift+Tab")
        at(page, 0, 0)
        page.keyboard.press("ArrowDown")
        at(page, 1, 0)
        page.keyboard.press("Backspace")
        at(page, 1, 0)
        expect(square(page, 1, 0)).to_have_accessible_name(mk(1, 0, "down", EMPTY))
        page.keyboard.press("Backspace")
        at(page, 0, 0)
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "down", EMPTY))
        page.keyboard.press("ArrowRight")
        at(page, 0, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        page.keyboard.press("ArrowRight")
        at(page, 0, 1)
        page.keyboard.press("Space")
        expect(grid).to_have_attribute("data-direction", "across")
        page.keyboard.press("ArrowDown")
        at(page, 2, 1)
        expect(grid).to_have_attribute("data-direction", "across")
        layout(page)
    a = player_client(app_url, s.ids["a"])
    poll(lambda: [sq_of(get_game(a, s.game_id), r, 0)["value"] for r in range(5)] == ["", "", "E", "A", "M"], SERVER_WAIT_S,
         "the stored Down word matches the keys")


def test_wf_keyboard_solving_jump_wraps(browser: Browser, app_url: str) -> None:
    wrap = seed_custom(app_url, settings={"a": {"jump_next_clue": True}}, squares=mk_fill(skip=((0, 1), (1, 4))))
    with as_player(browser, app_url, wrap.ids["a"], wrap.room) as page:
        grid = ready(page)
        at(page, 0, 1)
        page.keyboard.press("Shift+Tab")
        at(page, 1, 4)
        expect(grid).to_have_attribute("data-direction", "down")
        page.keyboard.press("n")
        at(page, 0, 1)
        expect(grid).to_have_attribute("data-direction", "across")
        expect(announcements(page)).to_have_text(spoken(1, "across"))
    full = seed_custom(app_url, settings={"a": {"jump_next_clue": True}},
                       squares=mk_fill(skip=((1, 4),), extra=(seed_sq(0, 1, "X"),)))
    with as_player(browser, app_url, full.ids["a"], full.room) as page:
        grid = ready(page)
        at(page, 1, 4)
        page.keyboard.press("n")
        at(page, 2, 4)
        expect(grid).to_have_attribute("data-direction", "down")


def test_wf_clue_navigation_phone_linked(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, text=ref_text())
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE, reduced="reduce") as page:
        grid = ready(page)
        bar = clue_bar(page)
        expect(linked(page)).to_have_count(5)
        tap(button(bar, "Previous clue"))
        at(page, 0, 4)
        expect(grid).to_have_attribute("data-direction", "down")
        expect(bar).to_contain_text(f"3D {REF_DOWN[3]}")
        expect(linked(page)).to_have_count(9)
        expect(square(page, 2, 0)).to_have_attribute("data-linked", "true")
        expect(square(page, 4, 2)).to_have_attribute("data-linked", "true")
        tap(button(bar, "Next clue"))
        at(page, 0, 0)
        expect(bar).to_contain_text(f"1A {REF_ACROSS[1]}")
        expect(linked(page)).to_have_count(5)
        layout(page)


def test_wf_clue_navigation_linked_follows_switch(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, text=ref_text())
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        page.keyboard.press("Space")
        expect(linked(page)).to_have_count(5)
        for c in range(5):
            expect(square(page, 2, c)).to_have_attribute("data-linked", "true")
        expect(ref_item(page, "across", 4)).to_have_attribute("data-linked", "true")
        page.keyboard.press("ArrowRight")
        at(page, 0, 0)
        expect(square(page, 2, 2)).to_have_attribute("data-linked", "true")
        expect(square(page, 1, 2)).to_have_attribute("data-linked", "true")
        expect(linked(page)).to_have_count(5)
        page.reload()
        ready(page)
        at(page, 0, 0)
        expect(ref_item(page, "down", 2)).to_have_attribute("data-linked", "true")
        expect(linked_items(page)).to_have_count(1)


def test_wf_phone_solving_pencil_and_long_table(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        ready(page)
        keys = page.get_by_role("group", name="Letter keyboard")
        pencil = button(keys, "Pencil")
        tap(pencil)
        expect(pencil).to_have_attribute("aria-pressed", "true")
        tap(button(keys, "S"))
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S", PENCIL_MARK))
        tap(pencil)
        expect(pencil).to_have_attribute("aria-pressed", "false")
        tap(square(page, 0, 0))
        at(page, 0, 0)
        tap(square(page, 0, 0))
        expect(grid_of(page)).to_have_attribute("data-direction", "down")
        tap(button(keys, "S"))
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "down", "S"))
    big = seed_game(app_url, fixture=LT)
    blocks = player_client(app_url, big.ids["a"]).get(f"/api/puzzles/{big.puzzle_id}").json()["blocks"]
    r, c = next((r, c) for r in range(14, -1, -1) for c in range(14, -1, -1) if blocks[r][c] == ".")
    with as_player(browser, app_url, big.ids["a"], big.room, viewport=PHONE) as page:
        ready(page)
        layout(page)
        box = square(page, r, c).bounding_box()
        assert box is not None and 18 <= box["width"] <= 26, box
        tap(square(page, r, c))
        at(page, r, c)


def test_wf_phone_solving_menu_to_room(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    with as_player(browser, app_url, owner, "/history", viewport=PHONE) as page:
        menu_button = button(page, "Menu")
        expect(menu_button).to_be_visible(timeout=READY_MS)
        tap(menu_button)
        menu = page.get_by_role("dialog", name="Menu")
        for name in ("Board", "Upload", "History", "Start a room"):
            expect(menu.get_by_role("link", name=name, exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(menu_button).to_be_focused()
        tap(menu_button)
        tap(menu.get_by_role("link", name="Board", exact=True))
        expect(menu).to_be_hidden()
        start = button(page, "Start Morning Kettle")
        expect(start).to_be_visible(timeout=READY_MS)
        layout(page)
        tap(start)
        ready(page)
        expect(page.get_by_role("group", name="Letter keyboard")).to_be_visible()


def test_wf_shared_link_phone_name_dialog(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    name = name_for("c")
    with as_player(browser, app_url, s.ids["a"], s.room) as host:
        ready(host)
        tiles = host.get_by_role("list", name="Players").get_by_role("listitem")
        with as_player(browser, app_url, None, s.url, viewport=PHONE) as friend:
            dialog = friend.get_by_role("dialog", name="Choose a display name")
            expect(dialog).to_be_visible(timeout=READY_MS)
            tap(button(dialog, "Continue"))
            expect(dialog).to_contain_text("Enter a name between 1 and 24 characters.")
            dialog.get_by_role("textbox", name="Display name").fill(name)
            tap(button(dialog, "Continue"))
            ready(friend)
            expect(announcements(host)).to_have_text(f"{name} joined", timeout=LIVE_MS)
            expect(tiles.filter(has_text=name)).to_contain_text("Coral" + HERE, timeout=LIVE_MS)
        expect(announcements(host)).to_have_text(f"{name} left", timeout=READY_MS)
        expect(tiles.filter(has_text=name)).to_contain_text("Coral" + AWAY)
        expect(grid_of(host)).to_be_focused()


def test_wf_shared_link_cursor_blocks(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b", "c"))
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as one, \
            as_player(browser, app_url, s.ids["c"], s.room) as two:
        ready(host)
        ready(one)
        ready(two)
        click(square(two, 4, 4))
        expect(square(host, 4, 4)).to_have_attribute("data-cursor", "Violet", timeout=LIVE_MS)
        click(square(one, 4, 4))
        expect(square(host, 4, 4)).to_have_attribute("data-cursor", "Coral Violet", timeout=LIVE_MS)
        one.keyboard.press("ArrowLeft")
        expect(square(host, 4, 4)).to_have_attribute("data-cursor", "Violet", timeout=LIVE_MS)
        expect(square(host, 4, 3)).to_have_attribute("data-cursor", "Coral", timeout=LIVE_MS)
        at(host, 0, 0)
        expect(grid_of(host)).to_be_focused()


def test_wf_same_square_clear_against_write(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=[seed_sq(0, c, ch) for c, ch in enumerate(MK_ROWS[0])])
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        cleared, wrote = together(lambda: clear_op(a, s.game_id, "word", 0, 0, "across"), lambda: write(b, s.game_id, 0, 1, "Q"))
        assert cleared.status_code == 200 and wrote.status_code == 200, (cleared.text, wrote.text)
        ops = ops_of(a, s.game_id)
        clear_seq = next(op["seq"] for op in ops if op["type"] == "clear")
        cell_seq = next(op["seq"] for op in ops if op["type"] == "cell")
        expected = "Q" if cell_seq > clear_seq else ""
        assert sq_of(get_game(a, s.game_id), 0, 1)["value"] == expected
        for page in (host, friend):
            expect(square(page, 0, 1)).to_have_attribute("data-state", "filled" if expected else "empty", timeout=LIVE_MS)
            expect(square(page, 0, 0)).to_have_attribute("data-state", "empty", timeout=LIVE_MS)


def test_wf_same_square_owner_follows_writer(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        host.keyboard.press("q")
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_attribute("data-owner", "Teal", timeout=LIVE_MS)
        friend.keyboard.press("s")
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_attribute("data-owner", "Coral", timeout=LIVE_MS)
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"), timeout=LIVE_MS)
        friend.keyboard.press("ArrowLeft")
        friend.keyboard.press("Delete")
        for page in (host, friend):
            expect(square(page, 0, 0)).not_to_have_attribute("data-owner", re.compile(r".*"), timeout=LIVE_MS)


def test_wf_check_reveal_menu_wrap_reveal_puzzle(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "X", state="wrong"), seed_sq(0, 1, "C", pencil=True, state="pencil"),
                                    seed_sq(0, 2, "O", state="right"), seed_sq(4, 4, "R", state="revealed")])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        page.keyboard.press("Alt+KeyR")
        menu = page.get_by_role("menu", name="Reveal")
        expect(menu.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        page.keyboard.press("End")
        expect(menu.get_by_role("menuitem", name="Puzzle", exact=True)).to_be_focused()
        page.keyboard.press("Home")
        expect(menu.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        expect(menu).to_have_count(0)
        expect(button(page, "Reveal")).to_be_focused()
        page.keyboard.press("Alt+KeyR")
        expect(menu.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(menu.get_by_role("menuitem", name="Puzzle", exact=True)).to_be_focused()
        page.keyboard.press("Space")
        dialog = page.get_by_role("dialog", name="Puzzle solved")
        expect(dialog).to_contain_text(revealed_phrase(20), timeout=LIVE_MS)
    game = get_game(player_client(app_url, s.ids["a"]), s.game_id)
    assert (game["revealed_count"], sq_of(game, 0, 2)["state"], sq_of(game, 0, 0)["value"]) == (20, "right", "S")
    reveal = [op for op in ops_of(player_client(app_url, s.ids["a"]), s.game_id) if op["type"] == "reveal"]
    assert [len(op["squares"]) for op in reveal] == [19]


def test_wf_check_reveal_phone_pencil_marks(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "X", pencil=True, state="pencil"), seed_sq(0, 1, "C", pencil=True, state="pencil"),
                                    seed_sq(0, 2, "Q")])
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        ready(page)
        tap(button(page, "Check"))
        menu = page.get_by_role("menu", name="Check")
        expect(menu.get_by_role("menuitem", name="Square", exact=True)).to_be_focused()
        tap(menu.get_by_role("menuitem", name="Puzzle", exact=True))
        expect(announcements(page)).to_have_text(wrong_in(2, "puzzle"), timeout=LIVE_MS)
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "X", PENCIL_MARK + WRONG_MARK))
        expect(square(page, 0, 0)).to_have_attribute("data-state", "wrong")
        expect(square(page, 0, 1)).to_have_accessible_name(mk(0, 1, "across", "C", RIGHT_MARK))
        expect(square(page, 0, 2)).to_have_accessible_name(mk(0, 2, "across", "Q", WRONG_MARK))
        expect(grid_of(page)).to_be_focused()


def test_wf_pencil_rebus_editor_edges(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS)
    a = player_client(app_url, s.ids["a"])
    assert act(a, s.game_id, "reveal", "square", 0, 2).status_code == 200
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 0)
        editor = page.get_by_role("textbox", name="Rebus entry")
        page.keyboard.press("Insert")
        page.keyboard.type("ab1!c-2345678")
        expect(editor).to_have_value("AB1C2345")
        page.keyboard.press("Enter")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "AB1C2345"))
        expect(grid_of(page)).to_be_focused()
        at(page, 0, 1)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Insert")
        expect(editor).to_have_value("AB1C2345")
        page.keyboard.press("Backspace")
        page.keyboard.press("Escape")
        expect(editor).to_have_count(0)
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "AB1C2345"))
        page.keyboard.press("Insert")
        for _ in range(8):
            page.keyboard.press("Backspace")
        page.keyboard.press("Enter")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", EMPTY))
        click(square(page, 0, 1))
        page.keyboard.press("Insert")
        page.keyboard.type("gh")
        page.keyboard.press("Enter")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", "GH"))
        click(square(page, 0, 2))
        page.keyboard.press("Insert")
        page.keyboard.type("zz")
        page.keyboard.press("Enter")
        expect(notices(page)).to_have_text(LOCKED_NOTICE, timeout=LIVE_MS)
        expect(square(page, 0, 2)).to_have_accessible_name(ns(0, 2, "across", "I", REVEALED_MARK))
        at(page, 0, 3)
    game = get_game(a, s.game_id)
    assert (sq_of(game, 0, 1)["value"], sq_of(game, 0, 1)["pencil"]) == ("GH", False)


def test_wf_timer_phone_pause_hours(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, elapsed_ms=HOUR_PLUS_MS)
    tick = TICK_S * 1000
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        ready(page)
        timer = timer_of(page)
        expect(timer).to_have_attribute("data-timer-state", "running")
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS))
        pause = button(page, "Pause my timer")
        tap(pause)
        expect(pause).to_have_attribute("aria-pressed", "true")
        advance(page, tick)
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS))
        tap(pause)
        expect(pause).to_have_attribute("aria-pressed", "false")
        expect(timer).to_have_text(fmt(HOUR_PLUS_MS + tick))
        layout(page)


def test_wf_timer_replay_stops_on_manual_step(browser: Browser, app_url: str) -> None:
    s, _, _ = _timeline_game(app_url)
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        step = dialog.get_by_role("status", name="Replay step")
        click(button(dialog, "Play"))
        advance(page, REPLAY_STEP_MS)
        expect(step).to_have_text("Step 1 of 7")
        click(button(dialog, "Next step"))
        expect(step).to_have_text("Step 2 of 7")
        expect(button(dialog, "Play")).to_be_visible()
        advance(page, REPLAY_STEP_MS * 2)
        expect(step).to_have_text("Step 2 of 7")
        click(button(dialog, "Play"))
        advance(page, REPLAY_STEP_MS)
        expect(step).to_have_text("Step 3 of 7")
        slider = dialog.get_by_role("slider", name="Replay position")
        slider.focus()
        page.keyboard.press("Home")
        expect(step).to_have_text("Step 0 of 7")
        expect(button(dialog, "Play")).to_be_visible()
        advance(page, REPLAY_STEP_MS * 2)
        expect(step).to_have_text("Step 0 of 7")


def test_wf_solved_racing_last_letters(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"), squares=mk_fill(skip=((0, 0), (4, 4))))
    a = player_client(app_url, s.ids["a"])
    b = player_client(app_url, s.ids["b"])
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        one, two = together(lambda: write(a, s.game_id, 0, 0, "S"), lambda: write(b, s.game_id, 4, 4, "R"))
        assert one.status_code == 200 and two.status_code == 200, (one.text, two.text)
        for page in (host, friend):
            dialog = page.get_by_role("dialog", name="Puzzle solved")
            expect(dialog).to_be_visible(timeout=LIVE_MS)
            expect(dialog.get_by_role("list", name="Solve stats").get_by_role("listitem")).to_have_text(
                [stats_row(s.names["a"], MK_WHITE - 1, 0), stats_row(s.names["b"], 1, 0)])
    game = get_game(a, s.game_id)
    assert game["status"] == "solved"
    assert len([e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id]) == 1


def test_wf_announcements_notice_lifetime(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "S", state="revealed")])
    toast = config(app_url)["toast_ms"]
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 1)
        page.keyboard.press("ArrowLeft")
        at(page, 0, 0)
        page.keyboard.press("x")
        expect(notices(page)).to_have_text(LOCKED_NOTICE, timeout=LIVE_MS)
        at(page, 0, 1)
        advance(page, toast - 1000)
        expect(notices(page)).to_have_text(LOCKED_NOTICE)
        page.keyboard.press("ArrowLeft")
        at(page, 0, 0)
        page.keyboard.press("x")
        threading.Event().wait(1.0)
        advance(page, 2000)
        expect(notices(page)).to_have_text(LOCKED_NOTICE)
        advance(page, toast - 2000)
        expect(notices(page)).to_have_text("")


def test_wf_upload_phone_reference_errors(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    bad = ref_text(across={1: "*Crumbly bake served with jam", 4: "Push the tape out, see 7-Down", 5: "One who hoards every coin"}, title=title)
    with as_player(browser, app_url, owner, "/upload", viewport=PHONE) as page:
        opener = button(page, "Upload puzzle")
        expect(opener).to_be_visible(timeout=READY_MS)
        tap(opener)
        dialog = page.get_by_role("dialog", name="Upload a puzzle")
        expect(dialog).to_be_visible()
        dialog.get_by_role("textbox", name="Puzzle text").fill(bad)
        tap(button(dialog, "Upload"))
        heading = dialog.get_by_role("heading", name=problems(1), exact=True)
        expect(heading).to_be_focused(timeout=READY_MS)
        expect(dialog.get_by_role("list", name="Upload errors").get_by_role("listitem")).to_have_text(
            [line(15, "clue 4 Across refers to 7 Down, which is not in the grid")])
        layout(page)
        dialog.get_by_role("textbox", name="Puzzle text").fill(ref_text(title=title))
        tap(button(dialog, "Upload"))
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}", timeout=READY_MS)
        expect(button(dialog, "Start a room with this puzzle")).to_be_visible()


def test_wf_upload_second_press_ignored(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    posts: list[str] = []

    def count(request: Any) -> None:
        if request.method == "POST" and urlsplit(request.url).path == "/api/puzzles":
            posts.append(request.url)

    with as_player(browser, app_url, owner, "/upload") as page:
        dialog = _open_upload(page)
        page.on("request", count)
        dialog.get_by_role("textbox", name="Puzzle text").fill(mk_text(title))
        with entered(held(page, "**/api/puzzles")) as gate:
            upload = button(dialog, "Upload")
            upload.focus()
            page.keyboard.press("Enter")
            expect(upload).to_be_disabled()
            page.keyboard.press("Enter")
            gate.release()
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}", timeout=READY_MS)
    assert len(posts) == 1
    assert len(player_client(app_url, owner).get("/api/puzzles", params={"source": "mine"}).json()["puzzles"]) == 1


def test_wf_history_phone_replay_states(browser: Browser, app_url: str) -> None:
    s, record, _ = _timeline_game(app_url)
    states = {(q["row"], q["col"]): q["state"] for q in record["initial"]}
    steps = [dict(states)]
    for op in record["ops"]:
        if op["type"] == "cell":
            states[(op["row"], op["col"])] = op["state"]
        for q in op.get("squares") or []:
            states[(q["row"], q["col"])] = q["state"]
        steps.append(dict(states))
    assert steps[3][(0, 1)] == "wrong" and steps[4][(0, 1)] == "filled" and steps[5][(4, 2)] == "pencil"
    assert steps[6][(4, 1)] == "empty" and steps[7][(4, 4)] == "revealed"
    with as_player(browser, app_url, s.ids["a"], "/history", viewport=PHONE) as page:
        item = page.get_by_role("list", name="History").get_by_role("listitem").filter(has_text="Morning Kettle")
        expect(item).to_have_count(1, timeout=READY_MS)
        layout(page)
        tap(button(item, "Replay"))
        dialog = page.get_by_role("dialog", name="Replay")
        grid = dialog.get_by_role("group", name="Replay grid")
        for k, expected in enumerate(steps):
            expect(dialog.get_by_role("status", name="Replay step")).to_have_text(f"Step {k} of 7")
            for (r, c), state in expected.items():
                expect(grid.locator(f'[data-row="{r}"][data-col="{c}"]')).to_have_attribute("data-state", state)
            if k < 7:
                tap(button(dialog, "Next step"))
        layout(page)


def test_wf_history_autocheck_record(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, settings={"a": {"autocheck": True}}, squares=mk_fill(skip=((0, 0), (0, 1))))
    a = player_client(app_url, s.ids["a"])
    assert write(a, s.game_id, 0, 1, "X").json()["state"] == "wrong"
    assert act(a, s.game_id, "check", "square", 0, 2).status_code == 200
    assert write(a, s.game_id, 0, 1, "C").json()["state"] == "right"
    assert write(a, s.game_id, 0, 0, "S").json()["state"] == "right"
    assert get_game(a, s.game_id)["status"] == "solved"
    poll(lambda: next((e for e in a.get("/api/history").json()["entries"] if e["game_id"] == s.game_id and e["record_ready"]), None),
         RECORD_WAIT_S, "history entry reported record_ready")
    record = a.get(f"/api/history/{s.game_id}/record").json()
    assert [op["type"] for op in record["ops"]] == ["cell", "check", "cell", "cell"]
    assert [op["autocheck"] for op in record["ops"] if op["type"] == "cell"] == [True, True, True]
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        step = dialog.get_by_role("status", name="Replay step")
        corner = dialog.get_by_role("group", name="Replay grid").locator(f'[data-row="{0}"][data-col="{1}"]')
        dialog.get_by_role("slider", name="Replay position").focus()
        page.keyboard.press("ArrowRight")
        expect(corner).to_have_attribute("data-state", "wrong")
        page.keyboard.press("Shift+ArrowRight")
        expect(step).to_have_text("Step 2 of 4")
        page.keyboard.press("Shift+ArrowRight")
        expect(step).to_have_text("Step 4 of 4")
        expect(corner).to_have_attribute("data-state", "right")
        page.keyboard.press("Shift+ArrowLeft")
        expect(step).to_have_text("Step 2 of 4")


def test_wf_storage_outage_builder_download(browser: Browser) -> None:
    down = down_url()
    owner = seed_players(down, "a")["a"]
    title = fresh_title()
    with as_player(browser, down, owner, "/build") as page:
        build_tiny(page, title)
        save = button(page, "Save to my puzzles")
        save.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("alert")).to_have_text(BUILDER_OUTAGE, timeout=READY_MS)
        save.focus()
        with page.expect_response(lambda r: urlsplit(r.url).path == "/api/puzzles" and r.request.method == "POST") as answer:
            page.keyboard.press("Enter")
        assert answer.value.status == 503
        expect(page.get_by_role("alert")).to_have_text(BUILDER_OUTAGE)
        with page.expect_download() as info:
            click(button(page, "Download text"))
        assert Path(info.value.path()).read_bytes() == builder_text(title, "Wren", TINY_ROWS, TINY_CLUES).encode()


def test_wf_race_menus_and_watcher(browser: Browser, app_url: str) -> None:
    s = seed_custom(app_url, members=("a", "b", "c"), outsiders=("d",), mode="race", race_state="racing", teams={"a": 1, "b": 2},
                    squares=[race_sq(0, 0, "S", "a", team=1)])
    a, c = player_client(app_url, s.ids["a"]), player_client(app_url, s.ids["c"])
    with as_player(browser, app_url, s.ids["a"], s.room) as racer, as_player(browser, app_url, s.ids["c"], s.room) as watcher:
        ready(racer)
        ready(watcher)
        before = len(ops_of(c, s.game_id))
        for key in ("x", ".", "Backspace"):
            watcher.keyboard.press(key)
        expect(square(watcher, 0, 0)).to_have_attribute("data-state", "empty")
        racer.keyboard.press("Alt+KeyC")
        check = racer.get_by_role("menu", name="Check")
        expect(check.get_by_role("menuitem", name="Word", exact=True)).to_have_attribute("aria-disabled", "true")
        expect(check.get_by_role("menuitem", name="Puzzle", exact=True)).to_have_attribute("aria-disabled", "true")
        racer.keyboard.press("Escape")
        racer.keyboard.press("Alt+KeyX")
        clear = racer.get_by_role("menu", name="Clear")
        expect(clear.get_by_role("menuitem", name="Puzzle", exact=True)).to_have_attribute("aria-disabled", "true")
        racer.keyboard.press("Escape")
        expect(button(racer, "Reveal")).to_be_disabled()
        for name in ("Team 1", "Team 2", "Watch"):
            expect(watcher.get_by_role("radiogroup", name="Team").get_by_role("radio", name=name, exact=True)).to_be_disabled()
        assert len(ops_of(c, s.game_id)) == before
        assert act(a, s.game_id, "check", "square", 0, 0).status_code == 200
        expect(square(watcher, 0, 0)).to_have_attribute("data-claimed", "true", timeout=LIVE_MS)
        expect(watcher.get_by_role("status", name="Team scores")).to_have_text(team_scores(1, 0), timeout=LIVE_MS)
    late = player_client(app_url, s.ids["d"]).post(f"/api/links/{s.code}/join", json={})
    assert late.status_code == 200 and next(p for p in late.json()["players"] if p["id"] == s.ids["d"])["team"] is None
    assert_error(clear_op(a, s.game_id, "puzzle"), 422, "invalid")


def test_wf_race_phone_finish(browser: Browser, app_url: str) -> None:
    whites = white_squares(MK_ROWS)
    claimed = [race_sq(r, c, MK_ROWS[r][c], "a" if i % 2 else "b", state="right") for i, (r, c) in enumerate(whites[:-1])]
    s = seed_custom(app_url, members=("a", "b"), mode="race", race_state="racing", teams={"a": 1, "b": 2}, squares=claimed)
    a = player_client(app_url, s.ids["a"])
    with as_player(browser, app_url, s.ids["a"], s.room, viewport=PHONE) as page:
        ready(page)
        at(page, 4, 4)
        tap(button(page.get_by_role("group", name="Letter keyboard"), "R"))
        expect(square(page, 4, 4)).to_have_attribute("data-state", "filled", timeout=LIVE_MS)
        poll(lambda: sq_of(get_game(a, s.game_id), 4, 4)["value"] == "R", SERVER_WAIT_S, "the racer's letter stored")
        assert get_game(a, s.game_id)["race_state"] == "racing"
        page.reload()
        ready(page)
        expect(square(page, 4, 4)).to_have_attribute("data-state", "filled")
        tap(square(page, 4, 4))
        at(page, 4, 4)
        tap(button(page, "Check"))
        menu = page.get_by_role("menu", name="Check")
        tap(menu.get_by_role("menuitem", name="Square", exact=True))
        dialog = page.get_by_role("dialog", name="Race over")
        expect(dialog).to_be_visible(timeout=LIVE_MS)
        expect(dialog.get_by_role("heading")).to_be_focused()
        layout(page)
        tap(button(dialog, "Close"))
        expect(dialog).to_be_hidden()
        expect(grid_of(page)).to_be_focused()
        expect(square(page, 4, 4)).to_have_attribute("data-claimed", "true")


def test_builder_keyboard_edges(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    with as_player(browser, app_url, owner, "/build") as page:
        open_builder(page)
        selected = lambda r, c: expect(bsq(page, r, c)).to_have_attribute("aria-selected", "true")
        expect(builder_grid(page).locator('[aria-selected="true"]')).to_have_count(1)
        selected(0, 0)
        click(bsq(page, 0, 0))
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowLeft")
        selected(0, 0)
        page.keyboard.press("ArrowRight")
        page.keyboard.press(".")
        page.keyboard.press("a")
        expect(bsq(page, 0, 1)).to_have_accessible_name(bname(0, 1, "black"))
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("a")
        selected(0, 2)
        page.keyboard.press("b")
        page.keyboard.press("c")
        page.keyboard.press("d")
        selected(0, 4)
        expect(bsq(page, 0, 4)).to_have_accessible_name(bname(0, 4, "D"))
        page.keyboard.press("Delete")
        selected(0, 4)
        expect(bsq(page, 0, 4)).to_have_accessible_name(bname(0, 4, "empty"))
        for r, c in ((0, 3), (0, 2), (0, 0), (0, 0)):
            page.keyboard.press("Backspace")
            selected(r, c)
        expect(bsq(page, 0, 0)).to_have_accessible_name(bname(0, 0, "empty"))
        box = page.get_by_role("spinbutton", name="Columns", exact=True)
        builder_size(page, 3, 3)
        box.focus()
        page.keyboard.press("ArrowDown")
        assert spin_value(box) == 3
        expect(builder_grid(page).get_by_role("gridcell")).to_have_count(9)


def test_builder_clue_problems_and_file_name(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    with as_player(browser, app_url, owner, "/build") as page:
        build_tiny(page, "!!!")
        fill_clues(page, {("across", 1): "x" * 301, ("across", 4): "See 9-Down", ("across", 5): "All the starred clues"})
        expect_problems(page, ["1 Across clue is longer than 300 characters", "4 Across refers to 9 Down, which is not in the grid",
                               "5 Across refers to starred clues, but no clue is starred"])
        expect(button(page, "Save to my puzzles")).to_be_disabled()
        fill_clues(page, {("across", 1): "x" * 300, ("across", 4): "See 2-Down", ("across", 5): "Ten"})
        expect_problems(page, [])
        with page.expect_download() as info:
            click(button(page, "Download text"))
        assert info.value.suggested_filename == "puzzle.overlap.txt"


def test_wf_constructor_saved_puzzle_plays(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    with as_player(browser, app_url, owner, "/build") as page:
        build_tiny(page, title)
        click(button(page, "Save to my puzzles"))
        expect(builder_status(page)).to_have_text(f"Saved: {title}", timeout=READY_MS)
        page.goto(app_url + "/puzzles")
        start = button(page, f"Start {title}")
        expect(start).to_be_visible(timeout=READY_MS)
        click(start)
        ready(page)
        for word in TINY_ROWS:
            for letter in word:
                page.keyboard.press(letter.lower())
            if word != TINY_ROWS[-1]:
                page.keyboard.press("Tab")
        expect(page.get_by_role("dialog", name="Puzzle solved")).to_be_visible(timeout=LIVE_MS)


def test_builder_layout(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    for viewport in (DESK, TABLET, PHONE):
        with as_player(browser, app_url, owner, "/build", viewport=viewport) as page:
            open_builder(page)
            layout(page)
            boxes = [x.bounding_box() for x in (page.get_by_role("textbox", name="Title", exact=True), builder_grid(page),
                                                page.get_by_role("textbox", name="1 Across clue", exact=True), builder_status(page))]
            assert all(boxes), boxes
            title, grid, clue, status = boxes
            if viewport == PHONE:
                assert title["y"] < grid["y"] < clue["y"] < status["y"], boxes
            else:
                assert grid["x"] + grid["width"] <= title["x"] + PX_TOLERANCE, boxes
                assert title["y"] < clue["y"] < status["y"], boxes


def test_wf_keyboard_solving_click_keeps_direction(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        at(page, 0, 0)
        click(square(page, 0, 0))
        at(page, 0, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        page.keyboard.press("s")
        at(page, 0, 1)
        expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"))


def test_wf_clue_navigation_click_selected_keeps_clue(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        click(square(page, 2, 2))
        at(page, 2, 2)
        expect(clue_bar(page)).to_have_text(bar_text(4, "across"))
        click(square(page, 2, 2))
        at(page, 2, 2)
        expect(clue_bar(page)).to_have_text(bar_text(4, "across"))
        expect(square(page, 2, 0)).to_have_attribute("data-in-word", "true")
        expect(square(page, 1, 2)).not_to_have_attribute("data-in-word", "true")


def test_wf_same_square_click_then_write(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, members=("a", "b"))
    with as_player(browser, app_url, s.ids["a"], s.room) as host, as_player(browser, app_url, s.ids["b"], s.room) as friend:
        ready(host)
        ready(friend)
        click(square(host, 0, 0))
        host.keyboard.press("q")
        at(host, 0, 1)
        expect(square(friend, 0, 0)).to_have_attribute("data-owner", "Teal", timeout=LIVE_MS)
        click(square(friend, 0, 0))
        friend.keyboard.press("s")
        at(friend, 0, 1)
        for page in (host, friend):
            expect(square(page, 0, 0)).to_have_accessible_name(mk(0, 0, "across", "S"), timeout=LIVE_MS)
            expect(grid_of(page)).to_have_attribute("data-direction", "across")


def test_wf_check_reveal_word_after_click(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, squares=[seed_sq(0, 0, "X"), seed_sq(0, 1, "C")])
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 2)
        click(square(page, 0, 2))
        at(page, 0, 2)
        menu_action(page, "Check", "Word")
        expect(announcements(page)).to_have_text(wrong_in(1, "word"), timeout=LIVE_MS)
        expect(square(page, 0, 0)).to_have_attribute("data-state", "wrong")
        expect(square(page, 0, 1)).to_have_attribute("data-state", "right")


def test_wf_pencil_rebus_click_then_pencil(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url, fixture=NS)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        ready(page)
        at(page, 0, 0)
        click(square(page, 0, 0))
        page.keyboard.press(".")
        page.keyboard.press("x")
        expect(square(page, 0, 0)).to_have_accessible_name(ns(0, 0, "across", "X", PENCIL_MARK))
        at(page, 0, 1)
        page.keyboard.press(".")
        click(square(page, 0, 1))
        page.keyboard.press("Insert")
        page.keyboard.type("l")
        page.keyboard.press("Enter")
        expect(square(page, 0, 1)).to_have_accessible_name(ns(0, 1, "across", "L"))
        at(page, 0, 2)


def test_wf_announcements_click_selected_silent(browser: Browser, app_url: str) -> None:
    s = seed_game(app_url)
    with as_player(browser, app_url, s.ids["a"], s.room) as page:
        grid = ready(page)
        page.keyboard.press("Tab")
        at(page, 2, 0)
        expect(announcements(page)).to_have_text(spoken(4, "across"))
        click(square(page, 2, 0))
        at(page, 2, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        expect(announcements(page)).to_have_text(spoken(4, "across"))


def test_upload_too_large_before_no_player(app_url: str) -> None:
    limit = config(app_url)["upload_max_bytes"]
    response = anonymous(app_url).post("/api/puzzles", content=b"x" * (limit + 1))
    assert_error(response, 413, "too_large", f"This file is larger than {limit} bytes.")
    assert_error(anonymous(app_url).post("/api/puzzles", content=b"x"), 401, "no_player")


def test_wf_history_play_from_last_step(browser: Browser, app_url: str) -> None:
    s, _, _ = _timeline_game(app_url)
    with as_player(browser, app_url, s.ids["a"], "/history") as page:
        dialog = _open_replay(page, s)
        step = dialog.get_by_role("status", name="Replay step")
        dialog.get_by_role("slider", name="Replay position").focus()
        page.keyboard.press("End")
        expect(step).to_have_text("Step 7 of 7")
        click(button(dialog, "Play"))
        expect(step).to_have_text("Step 0 of 7")
        advance(page, REPLAY_STEP_MS)
        expect(step).to_have_text("Step 1 of 7")


def test_wf_upload_room_click_keeps_direction(browser: Browser, app_url: str) -> None:
    owner = seed_players(app_url, "a")["a"]
    title = fresh_title()
    with as_player(browser, app_url, owner, "/upload") as page:
        dialog = _open_upload(page)
        dialog.get_by_role("textbox", name="Puzzle text").fill(mk_text(title))
        click(button(dialog, "Upload"))
        expect(dialog.get_by_role("status", name="Upload status")).to_have_text(f"Puzzle ready: {title}", timeout=READY_MS)
        click(button(dialog, "Start a room with this puzzle"))
        grid = ready(page)
        at(page, 0, 0)
        click(square(page, 0, 0))
        at(page, 0, 0)
        expect(grid).to_have_attribute("data-direction", "across")
        page.keyboard.press("s")
        at(page, 0, 1)
